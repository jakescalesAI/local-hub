// Home's widgets, for every screen: which ones, their sizes and order, and what's kept in them (tv/ui/widgets.js draws them).
//   GET  /api/board            -> { screens: { desk, tv, phone, saver, side }, data: { notes, todos, timer, clock } }   each screen a list of { k, id, size, at?: [column, row], opts? }
//   POST /api/board { screen, items }         a screen's whole list
//   POST /api/board { data: { note? { k, text }, todos?, timer?, clock? } }   what's in a widget, the same on every screen
// Kept in data/board.json (the last one in board.prev.json). Any paired device may change it, as with Home's other widgets.
import fs from 'node:fs'
import path from 'node:path'

export const SCREENS = ['desk', 'tv', 'phone', 'saver', 'side']
export const SIZES = ['s', 'm', 'l', 'w', 'xl', 'xxl']
export const IDS = ['music', 'weather', 'pc', 'clock', 'world', 'calendar', 'photos', 'countdown', 'timer', 'notes', 'todo', 'storage', 'files', 'apps', 'sound', 'remote', 'devices']
const START = [{ k: 'a', id: 'music', size: 'w' }, { k: 'b', id: 'weather', size: 'l' }, { k: 'c', id: 'pc', size: 'l' }]
// The screensaver has its own, the same on the computer and the TV: half the screen, so there is room for more.
const START_SAVER = [...START, { k: 'd', id: 'calendar', size: 'xl' }]
const START_SIDE = [{ k: 'a', id: 'pc', size: 'xl' }, { k: 'b', id: 'timer', size: 'm' }, { k: 'c', id: 'todo', size: 'm' }, { k: 'd', id: 'weather', size: 'l' }, { k: 'e', id: 'calendar', size: 'l' }]
const CLOCK = { style: ['digital', 'stacked', 'flip', 'analog', 'both', 'words'], font: ['display', 'rounded', 'serif', 'elegant', 'slab', 'mono', 'condensed', 'poster', 'script', 'casual'], date: ['full', 'short', 'day', 'off'], where: ['under', 'over'], h24: ['', '12', '24'], shadow: ['none', 'soft', 'strong', 'glow'], align: ['left', 'center', 'right'] }
const CLOCK_N = { weight: [100, 900], size: [40, 250], saver: [40, 250], spacing: [-8, 20] }
/** How the big clock looks (tv/ui/clock.js draws it): only what it knows, so nothing typed elsewhere reaches a page. */
export function cleanClock(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined
  const out = {}
  for (const [k, l] of Object.entries(CLOCK)) if (l.includes(o[k])) out[k] = o[k]
  for (const [k, [a, b]] of Object.entries(CLOCK_N)) if (Number.isFinite(o[k])) out[k] = Math.round(Math.min(b, Math.max(a, o[k])))
  for (const k of ['color', 'color2', 'dateColor']) if (o[k] === '' || /^#[0-9a-f]{6}$/i.test(o[k])) out[k] = o[k]
  for (const k of ['secs', 'ampm', 'italic']) if (typeof o[k] === 'boolean') out[k] = o[k]
  return Object.keys(out).length ? out : undefined
}
const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, n) : '')
export function cleanOpts(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined
  const out = {}
  if (typeof o.title === 'string') out.title = text(o.title, 60).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(o.date || '')) out.date = o.date
  if (Array.isArray(o.zones)) out.zones = o.zones.filter(z => typeof z === 'string' && /^[A-Za-z_]+(\/[A-Za-z_+-]+){0,2}$/.test(z)).slice(0, 6)
  const clock = cleanClock(o.clock)
  if (clock) out.clock = clock
  return Object.keys(out).length ? out : undefined
}
export function cleanItems(list) {
  const seen = new Set()
  return (Array.isArray(list) ? list : []).filter(x => x && IDS.includes(x.id) && typeof x.k === 'string' && /^[a-z0-9-]{1,20}$/.test(x.k) && !seen.has(x.k) && seen.add(x.k)).slice(0, 24)
    .map(x => { const opts = cleanOpts(x.opts); return { k: x.k, id: x.id, size: SIZES.includes(x.size) ? x.size : x.size === 'x' ? 'xl' : 'm', ...(Array.isArray(x.at) && x.at.length === 2 && x.at.every(n => Number.isInteger(n) && n > 0 && n < 9) ? { at: x.at } : {}), ...(opts ? { opts } : {}) } })
}
export function cleanData(d, was = { notes: {}, todos: [], timer: null }) {
  const out = { notes: { ...was.notes }, todos: was.todos, timer: was.timer, clock: was.clock || null }
  if (d?.clock === null) out.clock = null
  else if (d?.clock) out.clock = cleanClock(d.clock) || null
  if (d?.note && typeof d.note === 'object' && /^[a-z0-9-]{1,20}$/.test(d.note.k || '')) {
    const t = text(d.note.text, 4000)
    if (t) out.notes[d.note.k] = t; else delete out.notes[d.note.k]
    for (const k of Object.keys(out.notes).slice(0, -40)) delete out.notes[k]
  }
  if (Array.isArray(d?.todos)) out.todos = d.todos.filter(t => t && typeof t === 'object' && text(t.text, 200).trim()).slice(0, 100).map(t => ({ text: text(t.text, 200).trim(), done: t.done === true }))
  if (d?.timer === null) out.timer = null
  else if (d?.timer && typeof d.timer === 'object') {
    const n = v => (Number.isFinite(v) && v >= 0 && v < 1e14 ? Math.round(v) : 0)
    out.timer = { total: Math.min(n(d.timer.total), 86_400_000) || 300_000, left: Math.min(n(d.timer.left), 86_400_000), end: n(d.timer.end) }
  }
  return out
}

export function create({ here }) {
  const FILE = path.join(here, 'data', 'board.json')
  let cur = { screens: Object.fromEntries(SCREENS.map(s => [s, s === 'saver' ? START_SAVER : s === 'side' ? START_SIDE : START])), data: { notes: {}, todos: [], timer: null, clock: null } }
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    for (const s of SCREENS) if (Array.isArray(j.screens?.[s])) cur.screens[s] = cleanItems(j.screens[s])
    cur.data = cleanData({ todos: j.data?.todos, timer: j.data?.timer, clock: j.data?.clock })
    for (const [k, t] of Object.entries(j.data?.notes || {})) cur.data = cleanData({ note: { k, text: t } }, cur.data)
  } catch {}
  function save() {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    try { fs.copyFileSync(FILE, FILE.replace('.json', '.prev.json')) } catch {}
    const tmp = `${FILE}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(cur))
    fs.renameSync(tmp, FILE)
  }
  return async function route(url, req, res, { send, readBody }) {
    if (url.pathname !== '/api/board') return false
    if (req.method === 'GET') return send(res, 200, cur), true
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true
    const b = await readBody(req).catch(() => null) || {}
    if (b.screen !== undefined) {
      if (!SCREENS.includes(b.screen) || !Array.isArray(b.items)) return send(res, 400, { error: 'screen is desk, tv, phone, saver or side, with its items' }), true
      cur = { ...cur, screens: { ...cur.screens, [b.screen]: cleanItems(b.items) } }
    } else if (b.data && typeof b.data === 'object') cur = { ...cur, data: cleanData(b.data, cur.data) }
    else return send(res, 400, { error: 'send a screen and its items, or data' }), true
    save()
    return send(res, 200, cur), true
  }
}
