// The TV's real screen on a computer, in any app, and that computer's keys and clicks sent to it. Both go over the debugging
// connection the TV allowed when LocalHub was put on it (see tv-keys.mjs), and only while somebody is watching.
//   GET  /api/tv/screen         -> application/octet-stream, packets [u8 kind][u32 length][payload] until closed:
//                                  1 a piece of H.264 video (one NAL unit, with its start code), 2 JSON { awake, app } when it changes,
//                                  3 the video starts over. A 503 with the reason when the TV can't be reached
//   POST /api/tv/screen/input { events: [{ key } | { tap: [x, y] } | { text }] }   x, y from 0 to 1; key is a name in KEYS or "home"
// What a video app protects (Netflix's, Disney+'s own picture while it plays) is black in here: Android leaves it out.
import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { hubConfig } from './config.mjs'
import { isPrivate } from './tv-keys.mjs'

export const KEYS = { left: 21, right: 22, up: 19, down: 20, enter: 23, back: 4, menu: 82, rew: 89, ff: 90, ai: 85, del: 67, volup: 24, voldown: 25, mute: 164 }
/** One event from the page as the TV's helper reads it, or '' for anything else. */
export function eventLine(e) {
  if (!e || typeof e !== 'object') return ''
  if (e.key === 'home') return 'h'
  if (Object.hasOwn(KEYS, e.key ?? '')) return `k ${KEYS[e.key]}`
  if (Array.isArray(e.tap) && e.tap.length === 2 && e.tap.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) return `t ${e.tap.map(v => v.toFixed(4)).join(' ')}`
  const text = typeof e.text === 'string' && e.text.length <= 200 ? e.text.replace(/[\u0000-\u001f\u007f]/g, '') : ''
  return text ? `x ${Buffer.from(text).toString('base64')}` : ''
}
/** Cuts a stream into NAL units. A unit ends where the next begins, or after a quiet moment (flush): a still screen sends nothing more. */
export function nalCutter(out) {
  let buf = Buffer.alloc(0)
  const start = (b, from) => { const i = b.indexOf('\u0000\u0000\u0001', from, 'latin1'); return i > 0 && b[i - 1] === 0 ? i - 1 : i }
  return {
    push(chunk) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
      for (let i; (i = start(buf, 4)) > 0;) { out(buf.subarray(0, i)); buf = buf.subarray(i) }
    },
    flush() { if (buf.length > 4) { out(buf); buf = Buffer.alloc(0) } },
  }
}
export const nalType = n => n[n[2] === 1 ? 3 : 4] & 31
const packet = (kind, body) => { const h = Buffer.alloc(5); h[0] = kind; h.writeUInt32BE(body.length, 1); return Buffer.concat([h, body]) }
const MAX_HELD = 8 * 2 ** 20

export function create({ here }) {
  const adbPath = () => hubConfig().tv?.adb || 'adb'
  const host = () => { try { const h = JSON.parse(fs.readFileSync(path.join(here, 'data', 'tv-keys.json'), 'utf8')).host; return isPrivate(h) ? h : '' } catch { return '' } }
  const adb = (args, timeout = 8000) => new Promise((ok, no) => execFile(adbPath(), args, { windowsHide: true, timeout }, (e, out) => (e ? no(new Error(e.code === 'ENOENT' ? 'adb isn’t on this computer.' : 'The TV isn’t answering on the network.')) : ok(String(out)))))
  const viewers = new Set()
  let video = null, hands = null, held = [], heldSize = 0, state = null, stopT = 0, starting = null
  const tell = p => { for (const v of viewers) if (v.writableLength < MAX_HELD) v.write(p); else v.destroy() }
  function startVideo() {
    if (video || !viewers.size) return
    const me = video = spawn(adbPath(), ['-s', `${host()}:5555`, 'exec-out', 'screenrecord --output-format=h264 --size 1280x720 --bit-rate 5000000 -'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const begun = Date.now()
    let t = 0
    held = []
    heldSize = 0
    tell(packet(3, Buffer.alloc(0)))
    const cut = nalCutter(n => {
      const type = nalType(n), p = packet(1, n)
      // Someone who joins later gets everything since the last whole picture.
      if (type === 5) { held = held.filter(x => x.head); heldSize = 0 }
      if (type === 7) { held = []; heldSize = 0 }
      held.push({ p, head: type === 7 || type === 8 })
      heldSize += p.length
      tell(p)
    })
    me.stdout.on('data', d => { if (me !== video) return; cut.push(d); clearTimeout(t); t = setTimeout(() => me === video && cut.flush(), 25); if (heldSize > 4 * MAX_HELD) me.kill() })
    me.on('error', () => {})
    // It stops by itself after three minutes (Android's limit): another follows on.
    me.on('close', () => { clearTimeout(t); if (video === me) { video = null; if (viewers.size) setTimeout(startVideo, Date.now() - begun < 2000 ? 2500 : 0) } })
  }
  function startHands() {
    if (hands || !viewers.size) return
    const me = hands = spawn(adbPath(), ['-s', `${host()}:5555`, 'shell', '-T', 'CLASSPATH=$(pm path local.hub.tv | cut -d: -f2) exec app_process /system/bin --nice-name=localhub.screen local.hub.tv.ScreenInput'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    let rest = ''
    me.stdin.on('error', () => {})
    me.stdout.on('data', d => {
      const l = (rest + d).split('\n')
      rest = l.pop()
      for (const x of l) {
        const m = /^s ([01]) ([\w.]*)/.exec(x.trim())
        if (!m || me !== hands) continue
        state = { awake: m[1] === '1', app: m[2] }
        tell(packet(2, Buffer.from(JSON.stringify(state))))
      }
    })
    me.on('error', () => {})
    me.on('close', () => { if (hands === me) { hands = null; state = null; if (viewers.size) setTimeout(startHands, 2500) } })
  }
  function stop() {
    if (viewers.size) return
    const h = host(), v = video, a = hands
    video = hands = state = null
    held = []
    v?.kill()
    a?.stdin.end()
    a?.kill()
    // The TV's end doesn't notice until it next has something to send.
    if (h) adb(['-s', `${h}:5555`, 'shell', 'pkill -2 -f output-format=h264; true']).catch(() => {})
  }
  async function begin() {
    if (!host()) throw new Error('The TV hasn’t talked to this hub yet. Open LocalHub on it.')
    await adb(['connect', `${host()}:5555`])
    if ((await adb(['-s', `${host()}:5555`, 'get-state'])).trim() !== 'device') throw new Error('The TV hasn’t allowed this computer.')
  }
  return async function route(url, req, res, { send, readBody }) {
    const p = url.pathname
    if (p !== '/api/tv/screen' && p !== '/api/tv/screen/input') return false
    if (p === '/api/tv/screen' && req.method === 'GET') {
      try { await (starting ??= begin().finally(() => { starting = null })) } catch (e) { return send(res, 503, { error: e.message }), true }
      if (res.destroyed) return true
      clearTimeout(stopT)
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      res.socket?.setNoDelay(true)
      res.write(packet(3, Buffer.alloc(0)))
      if (state) res.write(packet(2, Buffer.from(JSON.stringify(state))))
      for (const x of held) res.write(x.p)
      viewers.add(res)
      res.on('error', () => {})
      res.on('close', () => { viewers.delete(res); clearTimeout(stopT); if (!viewers.size) stopT = setTimeout(stop, 2000) })
      startVideo()
      startHands()
      return true
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true
    const b = await readBody(req).catch(() => ({})) || {}
    const lines = (Array.isArray(b.events) ? b.events.slice(0, 50) : []).map(eventLine).filter(Boolean)
    if (!lines.length) return send(res, 400, { error: 'events is a list of { key }, { tap } or { text }' }), true
    if (!hands?.stdin.writable) return send(res, 409, { error: 'Open the TV’s screen first.' }), true
    hands.stdin.write(`${lines.join('\n')}\n`)
    return send(res, 200, { ok: true }), true
  }
}
