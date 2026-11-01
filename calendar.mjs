// Calendar tab back end: a built-in local calendar (data/calendar.json, editable from the page)
// plus read-only ICS feeds listed in secrets.json -> calendars: [{ label, icsUrl, color?, provider? }]
// (Google, Outlook and iCloud publish one; the provider is read from the address's host), and
// read-only Cal.com bookings and event types from secrets.json -> calcom: { apiKey } (GET only).
// The addresses and the key are secrets: only this process reads them. Responses carry labels,
// colours and events, never an address or key, and error text is scrubbed of them.
// Parsing is dependency free: line unfolding, VEVENT, DTSTART/DTEND/DURATION, all-day dates,
// TZID zones through Intl, RRULE expansion (DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT,
// UNTIL, BYDAY incl. ordinals, BYMONTHDAY, BYMONTH, BYSETPOS), EXDATE, RDATE, RECURRENCE-ID.
// Not supported: BYWEEKNO, BYYEARDAY, BYHOUR/BYMINUTE, SECONDLY/MINUTELY/HOURLY rules.
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { configPath, hubConfig } from './config.mjs'

const DAY = 86_400_000
const FEED_TTL = 10 * 60_000 // a feed is reused this long
const FEED_RETRY = 60_000 // a failed feed is retried after this long
const FEED_TIMEOUT = 15_000
const FILE_TTL = 2 * 60_000 // a calendar file kept fresh on the server is read again after this long
const FILE_TIMEOUT = 20_000
const QUICK_TIMEOUT = 120_000 // quick add syncs before it returns
const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8']
const FILE_RE = /^\/[\w./+-]+$/
const COMMAND_RE = /^[\w./-]+( [\w./-]+)*$/
const FEED_MAX_BYTES = 12 * 1024 * 1024
const MAX_FEEDS = 20
const MAX_RANGE_DAYS = 400
const MAX_EVENTS_OUT = 5000
const MAX_PER_SERIES = 3000
const MAX_LOCAL_EVENTS = 10_000
const LIMITS = { title: 200, location: 300, notes: 5000, icsNotes: 4000, label: 80 }
const LOCAL_COLOR = '#007aff'
// Where a feed comes from, by its host; each provider has its own colour and label.
export const PROVIDERS = {
  google: { label: 'Google', color: '#4285f4' },
  outlook: { label: 'Outlook', color: '#0a64d6' },
  icloud: { label: 'iCloud', color: '#ff3b30' },
  ics: { label: 'Calendar feed', color: '#34c759' },
  calcom: { label: 'Cal.com', color: '#8e8e93' },
}
export function providerOf(address, given) {
  if (PROVIDERS[given] && given !== 'calcom') return given
  const raw = String(address || '').trim()
  if (/^webcals?:/i.test(raw)) return 'icloud'
  let host = ''
  try { host = new URL(raw).hostname.toLowerCase() } catch {}
  if (host === 'calendar.google.com') return 'google'
  if (/^outlook\.(office365|live|office)\.com$/.test(host)) return 'outlook'
  if (/(^|\.)icloud\.com$/.test(host)) return 'icloud'
  return 'ics'
}
const CALCOM = 'https://api.cal.com/v2'
const CALCOM_TTL = 5 * 60_000
const PALETTE = ['#34c759', '#ff9500', '#af52de', '#ff2d55', '#5ac8fa', '#ffcc00', '#5856d6', '#a2845e']
const NAMED = { blue: '#007aff', green: '#34c759', orange: '#ff9500', red: '#ff3b30', purple: '#af52de', pink: '#ff2d55', teal: '#5ac8fa', yellow: '#ffcc00', indigo: '#5856d6', brown: '#a2845e', gray: '#8e8e93' }

/* ---------- time helpers ---------- */

const dayNum = (y, mo, d) => Math.round(Date.UTC(y, mo - 1, d) / DAY)
const civil = day => {
  const t = new Date(day * DAY)
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }
}
const dowOf = day => (((day + 4) % 7) + 7) % 7 // 0 = Sunday; 1970-01-01 was a Thursday
const daysInMonth = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate()
const dayKey = day => new Date(day * DAY).toISOString().slice(0, 10)
// Local (hub time zone) midnight at the start of a day number; all-day events and floating times use it.
const dayStart = day => {
  const c = civil(day)
  return new Date(c.y, c.mo - 1, c.d).getTime()
}
const keyToDay = key => {
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(key)
  return m ? dayNum(+m[1], +m[2], +m[3]) : NaN
}

const WIN_ZONES = {
  'eastern standard time': 'America/New_York',
  'central standard time': 'America/Chicago',
  'mountain standard time': 'America/Denver',
  'pacific standard time': 'America/Los_Angeles',
  'us eastern standard time': 'America/Indiana/Indianapolis',
  'alaskan standard time': 'America/Anchorage',
  'hawaiian standard time': 'Pacific/Honolulu',
  'gmt standard time': 'Europe/London',
  'w. europe standard time': 'Europe/Berlin',
  'romance standard time': 'Europe/Paris',
  'utc': 'UTC',
}
const zoneCache = new Map() // TZID text -> IANA zone or ''
const fmtCache = new Map() // IANA zone -> Intl.DateTimeFormat

function resolveZone(tzid) {
  if (!tzid) return ''
  if (zoneCache.has(tzid)) return zoneCache.get(tzid)
  const tries = [tzid, WIN_ZONES[tzid.toLowerCase()], /([A-Za-z_]+\/[A-Za-z_+\-/]+)$/.exec(tzid)?.[1]].filter(Boolean)
  let zone = ''
  for (const t of tries) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: t })
      zone = t
      break
    } catch {}
  }
  zoneCache.set(tzid, zone)
  return zone
}

// Offset of a zone from UTC (milliseconds, local minus UTC) at an instant.
function tzOffset(zone, ms) {
  let f = fmtCache.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    fmtCache.set(zone, f)
  }
  const p = {}
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value
  const hour = +p.hour === 24 ? 0 : +p.hour
  return Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000
}

// A parsed ICS time: { y, mo, d, h, mi, s, allDay, utc, tz } -> epoch milliseconds.
function toEpoch(w) {
  if (w.utc) return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s)
  const zone = !w.allDay && w.tz ? resolveZone(w.tz) : ''
  if (!zone) return new Date(w.y, w.mo - 1, w.d, w.h, w.mi, w.s).getTime()
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s)
  const off = tzOffset(zone, guess)
  let t = guess - off
  const off2 = tzOffset(zone, t)
  if (off2 !== off) t = guess - off2
  return t
}

function parseDateValue(value, params = {}) {
  const v = String(value || '').trim()
  let m = /^(\d{4})(\d\d)(\d\d)$/.exec(v)
  if (m) return { allDay: true, y: +m[1], mo: +m[2], d: +m[3], h: 0, mi: 0, s: 0, utc: false, tz: '' }
  m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)?(Z)?$/i.exec(v)
  if (!m) return null
  return { allDay: false, y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +(m[6] || 0), utc: !!m[7], tz: params.TZID || '' }
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(v || '').trim())
  if (!m) return null
  const ms = ((+m[2] || 0) * 7 + (+m[3] || 0)) * DAY + (+m[4] || 0) * 3_600_000 + (+m[5] || 0) * 60_000 + (+m[6] || 0) * 1000
  return m[1] === '-' ? -ms : ms
}

/* ---------- ICS parsing ---------- */

const unescapeText = s => String(s).replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c))

function parseLine(line) {
  let colon = -1
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') q = !q
    else if (c === ':' && !q) {
      colon = i
      break
    }
  }
  if (colon < 1) return null
  const head = line.slice(0, colon)
  const parts = []
  let cur = ''
  q = false
  for (const c of head) {
    if (c === '"') {
      q = !q
      cur += c
    } else if (c === ';' && !q) {
      parts.push(cur)
      cur = ''
    } else cur += c
  }
  parts.push(cur)
  const name = parts.shift().toUpperCase()
  const params = {}
  for (const p of parts) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name, params, value: line.slice(colon + 1) }
}

// ICS text -> flat list of raw VEVENTs (masters, overrides and singles).
export function parseIcs(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const events = []
  let cur = null
  let alarm = 0
  let n = 0
  for (const line of lines) {
    if (!line) continue
    const p = parseLine(line)
    if (!p) continue
    if (p.name === 'BEGIN') {
      const what = p.value.trim().toUpperCase()
      if (what === 'VEVENT') {
        cur = { uid: '', title: '', notes: '', location: '', status: '', start: null, end: null, durMs: null, rrule: '', exdates: [], rdates: [], recId: null }
        alarm = 0
      } else if (cur && what === 'VALARM') alarm++
      continue
    }
    if (p.name === 'END') {
      const what = p.value.trim().toUpperCase()
      if (what === 'VALARM' && alarm) alarm--
      else if (what === 'VEVENT' && cur) {
        if (cur.start) {
          cur.uid ||= `noid-${n}`
          events.push(cur)
        }
        n++
        cur = null
      }
      continue
    }
    if (!cur || alarm) continue
    switch (p.name) {
      case 'UID': cur.uid = p.value.trim(); break
      case 'SUMMARY': cur.title = unescapeText(p.value); break
      case 'DESCRIPTION': cur.notes = unescapeText(p.value); break
      case 'LOCATION': cur.location = unescapeText(p.value); break
      case 'STATUS': cur.status = p.value.trim().toUpperCase(); break
      case 'DTSTART': cur.start = parseDateValue(p.value, p.params); break
      case 'DTEND': cur.end = parseDateValue(p.value, p.params); break
      case 'DURATION': cur.durMs = parseDuration(p.value); break
      case 'RRULE': cur.rrule = p.value.trim(); break
      case 'RECURRENCE-ID': cur.recId = parseDateValue(p.value, p.params); break
      case 'EXDATE':
        for (const v of p.value.split(',')) {
          const dt = parseDateValue(v, p.params)
          if (dt) cur.exdates.push(dt)
        }
        break
      case 'RDATE':
        for (const v of p.value.split(',')) {
          const dt = parseDateValue(v.split('/')[0], p.params)
          if (dt) cur.rdates.push(dt)
        }
        break
    }
  }
  return events
}

/* ---------- recurrence ---------- */

const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

function parseRule(text) {
  const r = { freq: '', interval: 1, count: 0, until: null, byday: [], bymonthday: [], bymonth: [], bysetpos: [], wkst: 1 }
  for (const part of String(text).split(';')) {
    const eq = part.indexOf('=')
    if (eq < 1) continue
    const k = part.slice(0, eq).toUpperCase()
    const v = part.slice(eq + 1)
    const nums = () => v.split(',').map(Number).filter(Number.isFinite)
    if (k === 'FREQ') r.freq = v.toUpperCase()
    else if (k === 'INTERVAL') r.interval = Math.min(1000, Math.max(1, parseInt(v, 10) || 1))
    else if (k === 'COUNT') r.count = Math.min(100_000, Math.max(0, parseInt(v, 10) || 0))
    else if (k === 'UNTIL') r.until = v
    else if (k === 'BYDAY') {
      for (const x of v.split(',')) {
        const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(x.trim())
        if (m) r.byday.push({ n: m[1] ? parseInt(m[1], 10) : 0, wd: WD[m[2].toUpperCase()] })
      }
    } else if (k === 'BYMONTHDAY') r.bymonthday = nums().filter(n => n && Math.abs(n) <= 31)
    else if (k === 'BYMONTH') r.bymonth = nums().filter(n => n >= 1 && n <= 12)
    else if (k === 'BYSETPOS') r.bysetpos = nums().filter(n => n)
    else if (k === 'WKST' && v.toUpperCase() in WD) r.wkst = WD[v.toUpperCase()]
  }
  return ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.freq) ? r : null
}

function applySetPos(days, pos) {
  if (!pos.length) return days
  const picked = pos.map(p => (p > 0 ? days[p - 1] : days[days.length + p])).filter(x => x != null)
  return [...new Set(picked)].sort((a, b) => a - b)
}

// Days (day numbers) in one month that the rule's BY* parts select.
function monthCandidates(r, y, mo, defaultD) {
  const dim = daysInMonth(y, mo)
  let days = []
  if (r.bymonthday.length) {
    days = r.bymonthday.map(n => (n > 0 ? n : dim + 1 + n)).filter(d => d >= 1 && d <= dim)
    if (r.byday.length) days = days.filter(d => r.byday.some(b => b.wd === dowOf(dayNum(y, mo, d))))
  } else if (r.byday.length) {
    for (const b of r.byday) {
      const all = []
      for (let d = 1; d <= dim; d++) if (dowOf(dayNum(y, mo, d)) === b.wd) all.push(d)
      if (!b.n) days.push(...all)
      else {
        const x = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]
        if (x) days.push(x)
      }
    }
  } else if (defaultD <= dim) days = [defaultD]
  return [...new Set(days)].sort((a, b) => a - b).map(d => dayNum(y, mo, d))
}

function yearWeekdays(y, byday) {
  const start = dayNum(y, 1, 1)
  const end = dayNum(y + 1, 1, 1)
  const days = []
  for (const b of byday) {
    const all = []
    for (let day = start; day < end; day++) if (dowOf(day) === b.wd) all.push(day)
    if (!b.n) days.push(...all)
    else {
      const x = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]
      if (x != null) days.push(x)
    }
  }
  return [...new Set(days)].sort((a, b) => a - b)
}

// Ascending day numbers the rule selects, starting at DTSTART. skipDay jumps close to a day
// when there is no COUNT (periods stay aligned to INTERVAL).
function* ruleDays(r, st, skipDay) {
  const LIM = 100_000
  const iv = r.interval
  const inList = (list, v) => !list.length || list.includes(v)
  if (r.freq === 'DAILY') {
    const k0 = skipDay == null ? 0 : Math.max(0, Math.floor((skipDay - st.day) / iv) - 1)
    for (let k = k0, n = 0; n < LIM; k++, n++) {
      const day = st.day + k * iv
      const c = civil(day)
      if (!inList(r.bymonth, c.mo)) continue
      if (r.byday.length && !r.byday.some(b => b.wd === dowOf(day))) continue
      if (r.bymonthday.length) {
        const dim = daysInMonth(c.y, c.mo)
        if (!r.bymonthday.some(x => (x > 0 ? x : dim + 1 + x) === c.d)) continue
      }
      yield day
    }
  } else if (r.freq === 'WEEKLY') {
    const rel = wd => (wd - r.wkst + 7) % 7
    const ws0 = st.day - rel(st.dow)
    const wds = [...new Set(r.byday.length ? r.byday.map(b => b.wd) : [st.dow])].sort((a, b) => rel(a) - rel(b))
    const k0 = skipDay == null ? 0 : Math.max(0, Math.floor((skipDay - ws0) / (7 * iv)) - 1)
    for (let k = k0, n = 0; n < LIM; k++, n++) {
      const ws = ws0 + k * 7 * iv
      for (const wd of wds) {
        const day = ws + rel(wd)
        if (day < st.day || !inList(r.bymonth, civil(day).mo)) continue
        yield day
      }
    }
  } else if (r.freq === 'MONTHLY') {
    const m0 = st.y * 12 + st.mo - 1
    let k0 = 0
    if (skipDay != null) {
      const sc = civil(skipDay)
      k0 = Math.max(0, Math.floor((sc.y * 12 + sc.mo - 1 - m0) / iv) - 1)
    }
    for (let k = k0, n = 0; n < LIM; k++, n++) {
      const mi = m0 + k * iv
      const y = Math.floor(mi / 12)
      const mo = (mi % 12) + 1
      if (!inList(r.bymonth, mo)) continue
      for (const day of applySetPos(monthCandidates(r, y, mo, st.d), r.bysetpos)) if (day >= st.day) yield day
    }
  } else if (r.freq === 'YEARLY') {
    const k0 = skipDay == null ? 0 : Math.max(0, Math.floor((civil(skipDay).y - st.y) / iv) - 1)
    for (let k = k0, n = 0; n < LIM; k++, n++) {
      const y = st.y + k * iv
      let days = []
      if (!r.bymonth.length && r.byday.length && !r.bymonthday.length) days = yearWeekdays(y, r.byday)
      else for (const mo of r.bymonth.length ? [...r.bymonth].sort((a, b) => a - b) : [st.mo]) days.push(...monthCandidates(r, y, mo, st.d))
      days.sort((a, b) => a - b)
      for (const day of applySetPos(days, r.bysetpos)) if (day >= st.day) yield day
    }
  }
}

function untilMs(text, startWall) {
  const w = parseDateValue(text, { TZID: startWall.tz })
  if (!w) return null
  if (w.allDay) return dayStart(dayNum(w.y, w.mo, w.d) + 1) - 1 // through the end of that day
  return toEpoch(w)
}

// Every instance of one VEVENT (master, single or override) overlapping [fromMs, toMs).
// `skip` holds recurrence-ids replaced by overrides: { epochs:Set, days:Set }.
function expandEvent(ev, fromMs, toMs, skip, push) {
  const s = ev.start
  const startDay = dayNum(s.y, s.mo, s.d)
  const allDay = s.allDay
  let spanDays = 1
  let durMs = 0
  if (allDay) {
    if (ev.end) spanDays = Math.max(1, dayNum(ev.end.y, ev.end.mo, ev.end.d) - startDay)
    else if (ev.durMs != null) spanDays = Math.max(1, Math.round(ev.durMs / DAY))
  } else durMs = ev.end ? Math.max(0, toEpoch(ev.end) - toEpoch(s)) : Math.max(0, ev.durMs ?? 0)

  const exEpochs = new Set()
  const exDays = new Set()
  for (const x of ev.exdates) {
    exEpochs.add(toEpoch(x))
    if (x.allDay) exDays.add(dayNum(x.y, x.mo, x.d))
  }

  const instance = (y, mo, d) => {
    const day = dayNum(y, mo, d)
    if (allDay) return { st: dayStart(day), en: dayStart(day + spanDays), start: dayKey(day), end: dayKey(day + spanDays), day }
    const st = toEpoch({ ...s, y, mo, d })
    const en = st + durMs
    return { st, en, start: new Date(st).toISOString(), end: new Date(en).toISOString(), day }
  }
  let emitted = 0
  const consider = inst => {
    if (!(inst.st < toMs && Math.max(inst.en, inst.st + 1) > fromMs)) return
    if (exEpochs.has(inst.st) || exDays.has(inst.day)) return
    if (skip && (skip.epochs.has(inst.st) || skip.days.has(inst.day))) return
    emitted++
    push({ ...ev, ...inst, allDay })
  }

  const rule = ev.rrule ? parseRule(ev.rrule) : null
  if (!rule) consider(instance(s.y, s.mo, s.d))
  else {
    const until = rule.until ? untilMs(rule.until, s) : null
    const lo = fromMs - (allDay ? spanDays * DAY : durMs) - 2 * DAY
    const skipDay = rule.count ? null : Math.floor(lo / DAY)
    const st = { y: s.y, mo: s.mo, d: s.d, day: startDay, dow: dowOf(startDay) }
    let n = 0
    for (const day of ruleDays(rule, st, skipDay)) {
      if (rule.count && ++n > rule.count) break
      const c = civil(day)
      const inst = instance(c.y, c.mo, c.d)
      if (until != null && inst.st > until) break
      if (inst.st >= toMs) break
      consider(inst)
      if (emitted >= MAX_PER_SERIES) break
    }
  }
  for (const r of ev.rdates) {
    const inst = instance(r.y, r.mo, r.d)
    if (!allDay) {
      const st = toEpoch(r)
      inst.st = st
      inst.en = st + durMs
      inst.start = new Date(st).toISOString()
      inst.end = new Date(st + durMs).toISOString()
    }
    consider(inst)
  }
}

// Raw VEVENTs -> event objects overlapping [fromMs, toMs).
export function expandIcs(raw, fromMs, toMs, calId, readonly = true) {
  const byUid = new Map()
  for (const ev of raw) {
    if (!byUid.has(ev.uid)) byUid.set(ev.uid, { masters: [], overrides: [] })
    byUid.get(ev.uid)[ev.recId ? 'overrides' : 'masters'].push(ev)
  }
  const out = []
  const emit = inst => {
    out.push({
      id: `${calId}:${inst.uid}:${inst.allDay ? inst.start : Date.parse(inst.start)}`,
      calId,
      title: String(inst.title || '(No title)').slice(0, LIMITS.title),
      start: inst.start,
      end: inst.end,
      allDay: inst.allDay,
      location: String(inst.location || '').slice(0, LIMITS.location),
      notes: String(inst.notes || '').slice(0, LIMITS.icsNotes),
      readonly,
    })
  }
  for (const { masters, overrides } of byUid.values()) {
    const skip = { epochs: new Set(), days: new Set() }
    for (const o of overrides) {
      skip.epochs.add(toEpoch(o.recId))
      if (o.recId.allDay) skip.days.add(dayNum(o.recId.y, o.recId.mo, o.recId.d))
    }
    for (const m of masters) if (m.status !== 'CANCELLED') expandEvent(m, fromMs, toMs, skip, emit)
    for (const o of overrides) if (o.status !== 'CANCELLED') expandEvent({ ...o, rrule: '', exdates: [], rdates: [] }, fromMs, toMs, null, emit)
    if (out.length > MAX_EVENTS_OUT * 2) break
  }
  return out
}

/* ---------- validation of local events ---------- */

const fail = (code, message) => Object.assign(new Error(message), { code })
const isDateKey = s => typeof s === 'string' && /^\d{4}-\d\d-\d\d/.test(s) && !Number.isNaN(keyToDay(s)) && civil(keyToDay(s)).y >= 1970 && civil(keyToDay(s)).y <= 2200

function okColor(c, fallback) {
  if (typeof c !== 'string') return fallback
  const v = c.trim().toLowerCase()
  if (NAMED[v]) return NAMED[v]
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v) ? v : fallback
}

function cleanText(v, max, name) {
  if (v == null) return ''
  if (typeof v !== 'string') throw fail(400, `${name} must be text`)
  if (v.length > max) throw fail(400, `${name} is too long (max ${max} characters)`)
  return v.replace(/\r\n?/g, '\n')
}

// Merge `input` over `base`, validate and return the stored shape.
function cleanEvent(input, base = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'expected a JSON object')
  const m = { title: '', allDay: false, start: '', end: '', location: '', notes: '', ...base }
  for (const k of ['title', 'allDay', 'start', 'end', 'location', 'notes']) if (k in input) m[k] = input[k]
  const title = cleanText(m.title, LIMITS.title, 'Title').trim()
  if (!title) throw fail(400, 'Title is required')
  const location = cleanText(m.location, LIMITS.location, 'Location').trim()
  const notes = cleanText(m.notes, LIMITS.notes, 'Notes')
  if (typeof m.allDay !== 'boolean') throw fail(400, 'allDay must be true or false')
  let start, end
  if (m.allDay) {
    if (!isDateKey(m.start)) throw fail(400, 'start must be a date like 2026-11-02')
    const sd = keyToDay(m.start)
    let ed = m.end ? (isDateKey(m.end) ? keyToDay(m.end) : NaN) : sd + 1
    if (Number.isNaN(ed)) throw fail(400, 'end must be a date like 2026-11-03')
    if (ed < sd) throw fail(400, 'end is before start')
    if (ed === sd) ed = sd + 1 // end is the day after the last day
    if (ed - sd > 3660) throw fail(400, 'an all-day event can span at most 3660 days')
    start = dayKey(sd)
    end = dayKey(ed)
  } else {
    const parse = s => (typeof s === 'string' && s.length <= 40 ? Date.parse(s) : NaN)
    const st = parse(m.start)
    if (Number.isNaN(st)) throw fail(400, 'start must be an ISO date and time')
    let en = m.end ? parse(m.end) : st + 3_600_000
    if (Number.isNaN(en)) throw fail(400, 'end must be an ISO date and time')
    if (en < st) throw fail(400, 'end is before start')
    const y = new Date(st).getUTCFullYear()
    if (y < 1970 || y > 2200 || en - st > 366 * DAY) throw fail(400, 'start or end is out of range')
    start = new Date(st).toISOString()
    end = new Date(en).toISOString()
  }
  return { title, allDay: m.allDay, start, end, location, notes }
}

// [startMs, endMs) of an output event, in hub time for all-day events.
const bounds = ev => (ev.allDay ? [dayStart(keyToDay(ev.start)), dayStart(keyToDay(ev.end))] : [Date.parse(ev.start), Date.parse(ev.end)])
const overlaps = (ev, fromMs, toMs) => {
  const [st, en] = bounds(ev)
  return st < toMs && Math.max(en, st + 1) > fromMs
}

function parseWhen(s, name) {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s)
  const t = m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : Date.parse(s)
  if (!Number.isFinite(t)) throw fail(400, `${name} must be an ISO date`)
  return t
}

function shortError(e, secrets) {
  let msg
  const code = e?.cause?.code
  const words = { ENOTFOUND: 'DNS name not found', ECONNREFUSED: 'connection refused', ECONNRESET: 'connection reset', ETIMEDOUT: 'connection timed out', EHOSTUNREACH: 'host unreachable', CERT_HAS_EXPIRED: 'certificate expired' }
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') msg = `timed out after ${FEED_TIMEOUT / 1000} s`
  else if (e?.message === 'fetch failed') msg = words[code] || code || 'could not connect'
  else msg = String(e?.message || 'failed')
  for (const s of secrets) if (s) msg = msg.split(s).join('')
  return msg.slice(0, 160)
}

/* ---------- the hub route ---------- */

export function create({ here, run, sshHost }) {
  const FILE = path.join(here, 'data', 'calendar.json')
  const SECRETS = [configPath('secrets.json'), path.join(here, 'secrets.json')]

  /* local calendar store */
  let store = { label: 'Local', color: LOCAL_COLOR, events: [] }
  let storeStamp = -1
  let chain = Promise.resolve()

  async function loadStore() {
    let st
    try {
      st = await stat(FILE)
    } catch {
      storeStamp = 0
      store = { label: 'Local', color: LOCAL_COLOR, events: [] }
      return store
    }
    if (st.mtimeMs === storeStamp) return store
    try {
      const j = JSON.parse(await readFile(FILE, 'utf8'))
      const events = []
      for (const e of Array.isArray(j.events) ? j.events : []) {
        try {
          events.push({ id: String(e.id), ...cleanEvent(e), created: e.created || '', updated: e.updated || '' })
        } catch {}
      }
      store = { label: cleanText(j.label || 'Local', LIMITS.label, 'label') || 'Local', color: okColor(j.color, LOCAL_COLOR), events }
      storeStamp = st.mtimeMs
    } catch (e) {
      console.error('calendar.json', e.message)
    }
    return store
  }

  // Edits run one at a time: read the file, change it, write it atomically.
  function mutate(fn) {
    const run = chain.then(async () => {
      await loadStore()
      const out = await fn(store)
      await mkdir(path.dirname(FILE), { recursive: true })
      const tmp = `${FILE}.${process.pid}.tmp`
      const body = JSON.stringify({ version: 1, label: store.label, color: store.color, events: store.events }, null, 2) + '\n'
      await writeFile(tmp, body)
      try {
        await rename(tmp, FILE)
      } catch {
        await writeFile(FILE, body)
      }
      storeStamp = (await stat(FILE)).mtimeMs
      return out
    })
    chain = run.catch(() => {})
    return run
  }

  const publicLocal = e => ({ id: e.id, calId: 'local', title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, notes: e.notes, readonly: false })

  /* ICS feeds */
  const feeds = new Map() // calendar id -> { raw, at, error, okAt, inflight }

  // `calendar: { sources: [{ label, file, color? }], quickAdd: { command, check? } }` in the hub's config,
  // or in the secrets file while a hub has no config yet. A source's `file` is an .ics on the hub's SSH server.
  let calendarConfig = {}

  async function readFeedConfig() {
    let list = []
    let saved = {}
    calcomKey = ''
    for (const file of SECRETS) {
      try {
        saved = JSON.parse(await readFile(file, 'utf8'))
        break
      } catch {}
    }
    list = Array.isArray(saved.calendars) ? saved.calendars : []
    calcomKey = typeof saved.calcom?.apiKey === 'string' ? saved.calcom.apiKey.trim() : ''
    calendarConfig = hubConfig().calendar || saved.calendar || {}
    if (Array.isArray(calendarConfig.sources)) list = [...calendarConfig.sources, ...list]
    const out = []
    const used = new Set()
    for (const c of list) {
      if (out.length >= MAX_FEEDS) break
      if (c && typeof c.file === 'string') {
        const file = c.file.trim()
        const label = String(c.label || 'Calendar').slice(0, LIMITS.label)
        const id = 'ics_' + crypto.createHash('sha1').update(`${label}\n${file}`).digest('hex').slice(0, 8)
        if (out.some(x => x.id === id)) continue
        out.push({ id, label, provider: 'file', color: okColor(c.color, PALETTE[out.length % PALETTE.length]), file: FILE_RE.test(file) && !file.includes('..') ? file : '' })
        continue
      }
      if (!c || typeof c.icsUrl !== 'string') continue
      const raw = c.icsUrl.trim().replace(/^webcal:/i, 'https:')
      let ok = false
      try {
        ok = /^https?:$/.test(new URL(raw).protocol)
      } catch {}
      const label = String(c.label || 'Calendar').slice(0, LIMITS.label)
      const id = 'ics_' + crypto.createHash('sha1').update(`${label}\n${raw}`).digest('hex').slice(0, 8)
      if (out.some(x => x.id === id)) continue
      // The first calendar from a provider wears its colour; more from the same one take the palette.
      const provider = providerOf(c.icsUrl, c.provider)
      const color = okColor(c.color, used.has(provider) ? PALETTE[out.length % PALETTE.length] : PROVIDERS[provider].color)
      used.add(provider)
      out.push({ id, label, provider, color, url: ok ? raw : '', icsUrl: c.icsUrl })
    }
    return out
  }

  // Read over the hub's SSH with no shell quoting to get wrong: the path passed FILE_RE above.
  async function fetchFile(cal) {
    const f = feeds.get(cal.id)
    try {
      if (!cal.file) throw new Error('Not a valid file path')
      if (!run || !sshHost) throw new Error('No SSH server is set up')
      const r = await run('ssh', ['-n', ...SSH_OPTIONS, sshHost, 'cat', '--', cal.file], { timeout: FILE_TIMEOUT, maxBuffer: FEED_MAX_BYTES })
      if (!r.ok) throw new Error(/no such file/i.test(r.stderr) ? 'The calendar file isn’t on the server' : 'Can’t reach the server')
      if (!/BEGIN:VCALENDAR/i.test(r.stdout)) throw new Error('Not an ICS calendar')
      f.raw = parseIcs(r.stdout)
      f.error = ''
      f.okAt = Date.now()
    } catch (e) {
      f.error = shortError(e, [cal.file, sshHost])
    }
    f.at = Date.now()
  }

  async function fetchFeed(cal) {
    if (cal.provider === 'file') return fetchFile(cal)
    const f = feeds.get(cal.id)
    const secretsToScrub = [cal.url, cal.icsUrl, (() => { try { return new URL(cal.url).pathname } catch { return '' } })()].filter(s => s && s.length > 6)
    try {
      if (!cal.url) throw new Error('Not a valid http(s) or webcal address')
      const res = await fetch(cal.url, { signal: AbortSignal.timeout(FEED_TIMEOUT), headers: { 'user-agent': 'LocalHub/1 (calendar)', accept: 'text/calendar, text/plain, */*' }, redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (Number(res.headers.get('content-length')) > FEED_MAX_BYTES) throw new Error('calendar is too large')
      const text = await res.text()
      if (text.length > FEED_MAX_BYTES) throw new Error('calendar is too large')
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('not an ICS calendar (check the secret address)')
      f.raw = parseIcs(text)
      f.error = ''
      f.okAt = Date.now()
    } catch (e) {
      f.error = shortError(e, secretsToScrub)
    }
    f.at = Date.now()
  }

  // Make sure every feed has been fetched; stale ones refresh in the background unless forced.
  async function syncFeeds(cals, force) {
    for (const id of [...feeds.keys()]) if (!cals.some(c => c.id === id)) feeds.delete(id)
    const waits = []
    for (const cal of cals) {
      let f = feeds.get(cal.id)
      if (!f) feeds.set(cal.id, (f = { raw: [], at: 0, okAt: 0, error: '', inflight: null }))
      const ttl = f.error ? FEED_RETRY : cal.provider === 'file' ? FILE_TTL : FEED_TTL
      const stale = Date.now() - f.at > ttl
      if (!f.inflight && (force || stale)) f.inflight = fetchFeed(cal).finally(() => { f.inflight = null })
      if (f.inflight && (force || !f.at)) waits.push(f.inflight)
    }
    await Promise.all(waits)
  }

  /* Cal.com: GET only. Upcoming bookings become a read-only calendar; event types a link list. */
  let calcomKey = ''
  const calcom = { key: '', bookings: [], types: [], at: 0, okAt: 0, error: '', inflight: null }

  async function calcomGet(pathname, version) {
    const headers = { authorization: `Bearer ${calcomKey}`, accept: 'application/json' }
    if (version) headers['cal-api-version'] = version
    const res = await fetch(CALCOM + pathname, { headers, signal: AbortSignal.timeout(FEED_TIMEOUT) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || j.status === 'error') throw new Error(res.status === 401 || res.status === 403 ? 'the API key was refused' : j.error?.message || `HTTP ${res.status}`)
    return j.data
  }

  const httpsOnly = u => (typeof u === 'string' && /^https:\/\//.test(u) ? u : '')
  async function fetchCalcom() {
    try {
      const [bookings, types, me] = await Promise.all([
        calcomGet('/bookings?status=upcoming&take=100', '2024-08-13'),
        calcomGet('/event-types', '2024-06-14').catch(() => []),
        calcomGet('/me').catch(() => ({})),
      ])
      const user = String(me?.username || '')
      calcom.bookings = (Array.isArray(bookings) ? bookings : []).filter(b => b && b.start && b.end && b.status !== 'cancelled' && b.status !== 'rejected').map(b => {
        const link = httpsOnly(b.meetingUrl) || httpsOnly(b.location)
        const people = (b.attendees || []).map(a => [a.name, a.email && `<${a.email}>`].filter(Boolean).join(' ')).filter(Boolean)
        return {
          id: `cal_${String(b.uid || b.id).replace(/[^\w-]/g, '').slice(0, 40)}`,
          calId: 'calcom',
          title: String(b.title || 'Booking').slice(0, LIMITS.title),
          start: new Date(b.start).toISOString(),
          end: new Date(b.end).toISOString(),
          allDay: false,
          location: String((link ? '' : b.location) || '').slice(0, LIMITS.location),
          notes: String(b.description || '').slice(0, LIMITS.icsNotes),
          attendees: people.slice(0, 20),
          meetingUrl: link,
          readonly: true,
        }
      })
      calcom.types = (Array.isArray(types) ? types : []).filter(t => t && !t.hidden).slice(0, 30).map(t => ({
        title: String(t.title || t.slug || 'Event'),
        minutes: Number(t.lengthInMinutes || t.length) || null,
        link: httpsOnly(t.bookingUrl) || (user && t.slug ? `https://cal.com/${encodeURIComponent(user)}/${encodeURIComponent(t.slug)}` : ''),
      }))
      calcom.error = ''
      calcom.okAt = Date.now()
    } catch (e) {
      calcom.error = shortError(e, [calcomKey])
    }
    calcom.at = Date.now()
  }

  async function syncCalcom(force) {
    if (!calcomKey) return Object.assign(calcom, { key: '', bookings: [], types: [], at: 0, okAt: 0, error: '' })
    if (calcom.key !== calcomKey) Object.assign(calcom, { key: calcomKey, bookings: [], types: [], at: 0, okAt: 0, error: '' })
    const stale = Date.now() - calcom.at > (calcom.error ? FEED_RETRY : CALCOM_TTL)
    if (!calcom.inflight && (force || stale)) calcom.inflight = fetchCalcom().finally(() => { calcom.inflight = null })
    if (calcom.inflight && (force || !calcom.at)) await calcom.inflight
  }

  /* views */
  async function view(fromMs, toMs, force) {
    const [st, cals] = await Promise.all([loadStore(), readFeedConfig()])
    await Promise.all([syncFeeds(cals, force), syncCalcom(force)])
    const calendars = [{ id: 'local', label: st.label, color: st.color, source: 'local', provider: 'local', error: '' }]
    let events = st.events.filter(e => overlaps(e, fromMs, toMs)).map(publicLocal)
    for (const cal of cals) {
      const f = feeds.get(cal.id)
      calendars.push({ id: cal.id, label: cal.label, color: cal.color, source: cal.provider === 'file' ? 'file' : 'ics', provider: cal.provider, error: f.error, at: f.okAt })
      if (f.raw.length) events.push(...expandIcs(f.raw, fromMs, toMs, cal.id))
    }
    if (calcomKey) {
      calendars.push({ id: 'calcom', label: 'Cal.com', color: PROVIDERS.calcom.color, source: 'calcom', provider: 'calcom', error: calcom.error, at: calcom.okAt })
      events.push(...calcom.bookings.filter(e => overlaps(e, fromMs, toMs)))
    }
    events = events.filter(e => overlaps(e, fromMs, toMs))
    events.sort((a, b) => bounds(a)[0] - bounds(b)[0] || a.title.localeCompare(b.title))
    return { at: Date.now(), calendars, events: events.slice(0, MAX_EVENTS_OUT), eventTypes: calcomKey ? calcom.types : [], quickAdd: !!quickCommand() }
  }

  /* Quick add: the configured command takes the text as one argument, read from stdin on the server,
     so the words never pass through a shell. The command's own check runs first. */
  function quickCommand() {
    const q = calendarConfig.quickAdd
    if (!run || !sshHost || !q || !COMMAND_RE.test(q.command || '')) return null
    const check = q.check === undefined ? '--check' : q.check
    return COMMAND_RE.test(check) ? { command: q.command, check } : null
  }

  async function quickRun(q, text, check) {
    const script = `IFS= read -r t && exec ${q.command}${check ? ` ${q.check}` : ''} "$t"`
    const r = await run('ssh', [...SSH_OPTIONS, sshHost, script], { input: `${text}\n`, timeout: QUICK_TIMEOUT })
    const lines = `${r.stdout}\n${r.ok ? '' : r.stderr}`.split('\n').map(l => l.trim()).filter(l => l && !/^(ssh|ssh_|kex_|command failed|connection |permission denied|banner |warning:|channel )/i.test(l))
    const said = shortError(new Error(lines.at(-1) || ''), [sshHost])
    if (r.ok) return said
    throw fail(lines.length ? 400 : 502, said || 'Can’t reach the server')
  }

  function quickText(v) {
    const text = String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
    if (!text) throw fail(400, 'Type what it is and when')
    if (text.length > LIMITS.title) throw fail(400, `Keep it under ${LIMITS.title} characters`)
    if (text.split(/\s+/).some(w => w.startsWith('--'))) throw fail(400, 'Words starting with -- aren’t allowed')
    return text
  }

  function defaultRange() {
    const n = new Date()
    return [new Date(n.getFullYear(), n.getMonth(), 1).getTime() - 7 * DAY, new Date(n.getFullYear(), n.getMonth() + 1, 1).getTime() + 7 * DAY]
  }

  function rangeOf(url) {
    const [df, dt] = defaultRange()
    const fromMs = url.searchParams.get('from') ? parseWhen(url.searchParams.get('from'), 'from') : df
    const toMs = url.searchParams.get('to') ? parseWhen(url.searchParams.get('to'), 'to') : dt
    if (toMs <= fromMs) throw fail(400, 'to must be after from')
    if (toMs - fromMs > MAX_RANGE_DAYS * DAY) throw fail(400, `range is limited to ${MAX_RANGE_DAYS} days`)
    return [fromMs, toMs]
  }

  async function body(req, readBody) {
    try {
      return await readBody(req)
    } catch {
      throw fail(400, 'invalid JSON')
    }
  }

  return async function route(url, req, res, { send, readBody }) {
    if (!url.pathname.startsWith('/api/calendar/')) return false
    try {
      const p = url.pathname
      if (p === '/api/calendar/state' && req.method === 'GET') {
        const [f, t] = rangeOf(url)
        send(res, 200, await view(f, t, false))
        return true
      }
      if (p === '/api/calendar/upcoming' && req.method === 'GET') {
        const days = Math.min(60, Math.max(1, parseInt(url.searchParams.get('days') || '7', 10) || 7))
        const now = Date.now()
        const v = await view(now, now + days * DAY, false)
        const by = Object.fromEntries(v.calendars.map(c => [c.id, c]))
        send(res, 200, { at: v.at, events: v.events.slice(0, 200).map(e => ({ ...e, calLabel: by[e.calId]?.label || '', color: by[e.calId]?.color || LOCAL_COLOR })) })
        return true
      }
      if (p === '/api/calendar/quick' && req.method === 'POST') {
        const cals = await readFeedConfig()
        const q = quickCommand()
        if (!q) throw fail(404, 'Quick add isn’t set up')
        const input = await body(req, readBody)
        const text = quickText(input?.text)
        const checked = await quickRun(q, text, true)
        if (input?.check) return send(res, 200, { ok: true, added: false, message: checked }), true
        try {
          await quickRun(q, text, false)
        } catch (e) {
          // It may have got as far as adding, so a blind retry could double it.
          throw fail(e.code, `${e.message}. Check the calendar before adding it again`)
        }
        await syncFeeds(cals, true)
        send(res, 200, { ok: true, added: true, message: checked })
        return true
      }
      if (p === '/api/calendar/refresh' && req.method === 'POST') {
        const [f, t] = rangeOf(url)
        send(res, 200, await view(f, t, true))
        return true
      }
      if (p === '/api/calendar/events' && req.method === 'POST') {
        const input = await body(req, readBody)
        const clean = cleanEvent(input)
        const event = await mutate(st => {
          if (st.events.length >= MAX_LOCAL_EVENTS) throw fail(409, `the local calendar is full (${MAX_LOCAL_EVENTS} events)`)
          const now = new Date().toISOString()
          const e = { id: 'l' + crypto.randomBytes(6).toString('hex'), ...clean, created: now, updated: now }
          st.events.push(e)
          return publicLocal(e)
        })
        send(res, 200, { event })
        return true
      }
      const m = /^\/api\/calendar\/events\/([^/]+)(\/delete)?$/.exec(p)
      if (m && req.method === 'POST') {
        let id
        try {
          id = decodeURIComponent(m[1])
        } catch {
          throw fail(400, 'bad event id')
        }
        if (!/^l[0-9a-f]{12}$/.test(id)) throw fail(/^(ics|cal)_/.test(id) ? 403 : 404, /^(ics|cal)_/.test(id) ? 'feed and Cal.com events are read-only' : 'no such event')
        if (m[2]) {
          await mutate(st => {
            const i = st.events.findIndex(e => e.id === id)
            if (i < 0) throw fail(404, 'no such event')
            st.events.splice(i, 1)
          })
          send(res, 200, { ok: true, id })
          return true
        }
        const input = await body(req, readBody)
        const event = await mutate(st => {
          const e = st.events.find(x => x.id === id)
          if (!e) throw fail(404, 'no such event')
          Object.assign(e, cleanEvent(input, e), { updated: new Date().toISOString() })
          return publicLocal(e)
        })
        send(res, 200, { event })
        return true
      }
      send(res, 404, { error: 'not found' })
      return true
    } catch (e) {
      const code = [400, 403, 404, 409, 502].includes(e.code) ? e.code : 500
      send(res, code, { error: e.message })
      return true
    }
  }
}
