// The entry code: 4 or 6 digits to get into LocalHub on the TV, on this computer, or into the places you choose.
//   GET  /api/lock                   -> { on, digits, places, apps, after, wait }   never the code
//   POST /api/lock/check { pin }     -> { ok, wait?, offline? }   five wrong tries, then longer and longer waits
//   POST /api/lock { pin, next?, places?, apps?, after? }   this computer only. pin is the code now in use (none at first);
//                                       next is a new code, '' turns it off
// Only a salted scrypt of the code is kept (data/lock.json). offline is a second, separate hash a paired TV keeps, so it can
// still ask while this computer is off; it is only given to someone who has just typed the right code.
// It keeps people out of the screens. It is not encryption, and the passcode and pairing still decide which devices get in.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isLocal } from './access.mjs'

export const PLACES = ['tv', 'desk', 'control', 'files', 'settings', 'assistant', 'browser']
export const AFTER = [0, 1, 5, 15, 60]
const TRIES = 5
const PIN_RE = /^(\d{4}|\d{6})$/
export const validPin = p => typeof p === 'string' && PIN_RE.test(p)
export const cleanPlaces = l => PLACES.filter(p => Array.isArray(l) && l.includes(p))
export const cleanApps = l => [...new Set((Array.isArray(l) ? l : []).filter(x => typeof x === 'string').map(x => x.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60)).filter(Boolean))].slice(0, 60)
const hash = (pin, salt) => crypto.scryptSync(pin, Buffer.from(salt, 'hex'), 32).toString('hex')
// The same sum in tv/ui/lock.js: a page on http has no crypto.subtle.
export function offlineHash(pin, salt, rounds = 2000) {
  let h = `${salt}:${pin}`
  for (let i = 0; i < rounds; i++) h = crypto.createHash('sha256').update(h).digest('hex')
  return h
}
// How long after the nth wrong try: nothing up to five, then 30 s, doubling to an hour.
export const waitFor = fails => (fails < TRIES ? 0 : Math.min(3600_000, 30_000 * 2 ** Math.min(7, fails - TRIES)))

export function create({ here }) {
  const FILE = path.join(here, 'data', 'lock.json')
  const EMPTY = { hash: '', salt: '', digits: 4, places: ['tv'], apps: [], after: 5, fails: 0, until: 0, off: null }
  let cur = { ...EMPTY }
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    cur = { ...EMPTY, hash: /^[0-9a-f]{64}$/.test(j.hash) ? j.hash : '', salt: /^[0-9a-f]{32}$/.test(j.salt) ? j.salt : '', digits: j.digits === 6 ? 6 : 4, places: cleanPlaces(j.places), apps: cleanApps(j.apps), after: AFTER.includes(j.after) ? j.after : 5, fails: Math.max(0, Number(j.fails) || 0), until: Number(j.until) || 0, off: j.off && /^[0-9a-f]{64}$/.test(j.off.hash) ? { salt: String(j.off.salt), hash: j.off.hash } : null }
  } catch {}
  const on = () => !!(cur.hash && cur.salt)
  function save() {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    const tmp = `${FILE}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(cur), { mode: 0o600 })
    fs.renameSync(tmp, FILE)
  }
  const wait = () => Math.max(0, cur.until - Date.now())
  const view = () => ({ on: on(), digits: cur.digits, places: cur.places, apps: cur.apps, after: cur.after, wait: Math.ceil(wait() / 1000) })
  // One try at a time counts, whichever device it came from, so a second screen doesn't give a guesser more.
  function check(pin) {
    if (!on()) return { ok: true }
    if (wait()) return { ok: false, wait: Math.ceil(wait() / 1000) }
    const good = validPin(pin) && crypto.timingSafeEqual(Buffer.from(hash(pin, cur.salt), 'hex'), Buffer.from(cur.hash, 'hex'))
    if (good) { if (cur.fails || cur.until) { cur.fails = 0; cur.until = 0; save() } return { ok: true } }
    cur.fails++
    cur.until = Date.now() + waitFor(cur.fails)
    save()
    return { ok: false, left: Math.max(0, TRIES - cur.fails), ...(wait() ? { wait: Math.ceil(wait() / 1000) } : {}) }
  }
  return async function route(url, req, res, { send, readBody }) {
    const p = url.pathname
    if (p !== '/api/lock' && p !== '/api/lock/check') return false
    if (p === '/api/lock' && req.method === 'GET') return send(res, 200, view()), true
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true
    const b = await readBody(req).catch(() => ({})) || {}
    if (p === '/api/lock/check') {
      const r = check(b.pin)
      return send(res, 200, r.ok && on() ? { ...r, offline: { ...cur.off, digits: cur.digits } } : r), true
    }
    if (!isLocal(req)) return send(res, 403, { error: 'The code is set on the computer running LocalHub.' }), true
    if (b.next !== undefined && b.next !== '' && !validPin(b.next)) return send(res, 400, { error: 'Use 4 or 6 digits.' }), true
    if (b.after !== undefined && !AFTER.includes(b.after)) return send(res, 400, { error: 'after is one of 0, 1, 5, 15, 60 minutes' }), true
    if (on()) { const r = check(b.pin); if (!r.ok) return send(res, 403, { error: r.wait ? `Too many tries. Wait ${r.wait} seconds.` : 'That isn’t the code.', ...r }), true }
    else if (!b.next) return send(res, 400, { error: 'Choose a code first.' }), true
    if (b.next === '') cur = { ...cur, hash: '', salt: '', off: null, fails: 0, until: 0 }
    else if (b.next) {
      const salt = crypto.randomBytes(16).toString('hex'), os = crypto.randomBytes(16).toString('hex')
      cur = { ...cur, salt, hash: hash(b.next, salt), digits: b.next.length, off: { salt: os, hash: offlineHash(b.next, os) }, fails: 0, until: 0 }
    }
    if (b.places !== undefined) cur.places = cleanPlaces(b.places)
    if (b.apps !== undefined) cur.apps = cleanApps(b.apps)
    if (b.after !== undefined) cur.after = b.after
    save()
    return send(res, 200, view()), true
  }
}
