// Home's widgets, for every screen: which ones, their sizes and order, and what's kept in them (tv/ui/widgets.js draws them).
//   GET  /api/board            -> { screens: { desk, tv, phone }, data: { notes, todos, timer } }   each screen a list of { k, id, size, opts? }
//   POST /api/board { screen, items }         a screen's whole list
//   POST /api/board { data: { note? { k, text }, todos?, timer? } }   what's in a widget, the same on every screen
// Kept in data/board.json (the last one in board.prev.json). Any paired device may change it, as with Home's other widgets.
import fs from 'node:fs'
import path from 'node:path'

export const SCREENS = ['desk', 'tv', 'phone']
export const SIZES = ['s', 'm', 'l', 'w', 'x']
export const IDS = ['music', 'weather', 'pc', 'clock', 'world', 'calendar', 'photos', 'countdown', 'timer', 'notes', 'todo', 'storage', 'files', 'apps', 'sound', 'remote', 'devices']
const START = [{ k: 'a', id: 'music', size: 'w' }, { k: 'b', id: 'weather', size: 'l' }, { k: 'c', id: 'pc', size: 'l' }]
const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, n) : '')
export function cleanOpts(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined
  const out = {}
  if (typeof o.title === 'string') out.title = text(o.title, 60).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(o.date || '')) out.date = o.date
  if (Array.isArray(o.zones)) out.zones = o.zones.filter(z => typeof z === 'string' && /^[A-Za-z_]+(\/[A-Za-z_+-]+){0,2}$/.test(z)).slice(0, 6)
  return Object.keys(out).length ? out : undefined
}
export function cleanItems(list) {
  const seen = new Set()
  return (Array.isArray(list) ? list : []).filter(x => x && IDS.includes(x.id) && typeof x.k === 'string' && /^[a-z0-9-]{1,20}$/.test(x.k) && !seen.has(x.k) && seen.add(x.k)).slice(0, 24)
    .map(x => { const opts = cleanOpts(x.opts); return { k: x.k, id: x.id, size: SIZES.includes(x.size) ? x.size : 'm', ...(opts ? { opts } : {}) } })
}
export function cleanData(d, was = { notes: {}, todos: [], timer: null }) {
  const out = { notes: { ...was.notes }, todos: was.todos, timer: was.timer }
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
  let cur = { screens: Object.fromEntries(SCREENS.map(s => [s, START])), data: { notes: {}, todos: [], timer: null } }
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    for (const s of SCREENS) if (Array.isArray(j.screens?.[s])) cur.screens[s] = cleanItems(j.screens[s])
    cur.data = cleanData({ todos: j.data?.todos, timer: j.data?.timer })
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
      if (!SCREENS.includes(b.screen) || !Array.isArray(b.items)) return send(res, 400, { error: 'screen is desk, tv or phone, with its items' }), true
      cur = { ...cur, screens: { ...cur.screens, [b.screen]: cleanItems(b.items) } }
    } else if (b.data && typeof b.data === 'object') cur = { ...cur, data: cleanData(b.data, cur.data) }
    else return send(res, 400, { error: 'send a screen and its items, or data' }), true
    save()
    return send(res, 200, cur), true
  }
}
