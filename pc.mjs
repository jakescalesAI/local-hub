// The Sidebar's controls for this computer (pc-quick.ps1 does them).
//   GET  /api/pc                 -> { here, mix: [{ id, name, level, muted, playing }], mic, muted, bt, net, dark, battery, awake }
//   GET  /api/pc/icon?id=        an app's icon, from the mixer
//   POST /api/pc { what, value?, id? }   mic | mute | bt | dark | awake (value true/false), mix { id, level?, mute? },
//                                        lock | screens, open (value one of OPEN)
// Levels and switches may be changed by any paired device, as the volume may. What only makes sense at the computer (locking it,
// opening its windows), or could cut someone off from it (Bluetooth), only on the computer itself.
import { spawn } from 'node:child_process'
import { isLocal } from './access.mjs'
import { IS_WIN } from './platform.mjs'
import { helperFor } from './pc-helper.mjs'

export const OPEN = { wifi: 'ms-availablenetworks:', bluetooth: 'ms-settings:bluetooth', sound: 'ms-settings:sound', display: 'ms-settings:display', snip: 'ms-screenclip:', tasks: 'taskmgr.exe', settings: 'ms-settings:', battery: 'ms-settings:powersleep', phone: 'ms-phone:' }
const SWITCH = ['mic', 'mute', 'bt', 'dark', 'awake'], HERE = new Set(['bt', 'lock', 'screens', 'open', 'dark'])
/** What may be asked of it -> [command, argument], or null. */
export function command(b) {
  const what = b?.what
  if (SWITCH.includes(what)) return typeof b.value === 'boolean' ? [what, b.value] : null
  if (what === 'lock' || what === 'screens') return [what]
  if (what === 'open') return Object.hasOwn(OPEN, b.value) ? [what, b.value] : null
  if (what !== 'mix' || !/^[\w .+()&-]{1,80}$/.test(b.id || '')) return null
  const level = Number.isFinite(b.level) ? Math.round(Math.max(0, Math.min(100, b.level))) : -1, mute = typeof b.mute === 'boolean' ? Number(b.mute) : -1
  return level < 0 && mute < 0 ? null : ['mix', { id: b.id, level, mute }]
}
export function create({ here }) {
  const helper = helperFor(here, 'pc-quick.ps1')
  let cache = { at: 0, v: null }, pending = null, keep = null
  const icons = new Map()
  async function state() {
    if (cache.v && Date.now() - cache.at < 900) return cache.v
    pending ??= helper.ask('state').then(s => {
      const mix = (Array.isArray(s.mix) ? s.mix : []).map(x => ({ id: String(x.id), name: String(x.name || x.id).slice(0, 60), level: Number(x.level) || 0, muted: !!x.muted, playing: !!x.playing }))
      cache = { at: Date.now(), v: { mix, mic: s.mic === 0 ? true : s.mic === 1 ? false : null, muted: !!s.muted, bt: s.bt ? { on: !!s.bt.on, devices: (Array.isArray(s.bt.devices) ? s.bt.devices : s.bt.devices ? [s.bt.devices] : []).map(String).slice(0, 6) } : null, net: s.net ? { name: String(s.net.name || '').slice(0, 60), wifi: !!s.net.wifi, bars: Number(s.net.bars) || 0 } : null, dark: typeof s.dark === 'boolean' ? s.dark : null, battery: s.battery || null, awake: !!s.awake } }
      return cache.v
    }).finally(() => { pending = null })
    return pending
  }
  return async function route(url, req, res, { send, readBody }) {
    const p = url.pathname
    if (p !== '/api/pc' && p !== '/api/pc/icon') return false
    if (!IS_WIN) return send(res, 200, { off: true }), true
    if (p === '/api/pc/icon') {
      const id = url.searchParams.get('id') || ''
      try {
        if (!(await state()).mix.some(x => x.id === id)) throw new Error('unknown')
        if (!icons.has(id)) icons.set(id, Buffer.from(String((await helper.ask('icon', id)).png || ''), 'base64'))
        const png = icons.get(id)
        if (!png.length) throw new Error('none')
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' })
        return res.end(png), true
      } catch { return send(res, 404, { error: 'not found' }), true }
    }
    if (req.method === 'GET') {
      try { return send(res, 200, { here: isLocal(req), ...(await state()) }), true } catch { return send(res, 200, { off: true }), true }
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST' }), true
    const b = await readBody(req).catch(() => null) || {}, c = command(b)
    if (!c) return send(res, 400, { error: 'not something this can do' }), true
    if (HERE.has(b.what) && !isLocal(req)) return send(res, 403, { error: 'Only at the computer itself.' }), true
    try {
      if (c[0] === 'open') spawn(OPEN[c[1]].endsWith('.exe') ? OPEN[c[1]] : 'explorer.exe', OPEN[c[1]].endsWith('.exe') ? [] : [OPEN[c[1]]], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref()
      else {
        const r = await helper.ask(c[0], c[1])
        if (!r.ok) throw new Error('Windows didn’t allow it.')
        // Staying awake lasts as long as the helper does, so it's kept going.
        if (c[0] === 'awake') { clearInterval(keep); keep = c[1] ? setInterval(() => helper.ask('state').catch(() => {}), 60_000) : null; keep?.unref?.() }
      }
      cache.at = 0
      return send(res, 200, { ok: true }), true
    } catch (e) { return send(res, 200, { ok: false, error: /timed out|too long/.test(e.message) ? 'Windows didn’t answer.' : 'Windows didn’t allow it.' }), true }
  }
}
