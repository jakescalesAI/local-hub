// This PC's sound on this PC, on the TV, or on both (Controls, and Settings › Sound plays on).
//   GET  /api/tv/audio/state    -> { to, available, tv }   to is pc | tv | both; tv is whether a TV is playing it now
//   POST /api/tv/audio { to }   chooses. This PC is silent only while a TV really is playing it
//   GET  /api/tv/audio          -> application/octet-stream, for a paired TV: 48 kHz, 16-bit, stereo, as it plays, until closed
// The sound goes over the home network and is kept nowhere. pc-audio.ps1 does the capturing; Windows only.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { PORT } from './config.mjs'
import { IS_WIN } from './platform.mjs'

export const PLACES = ['pc', 'tv', 'both']
const BEHIND = 48_000 * 4 * 0.4 // a TV this far behind has its wait thrown away

export function create({ here }) {
  let to = 'pc', proc = null, stopT = 0
  const tvs = new Set()
  const wanted = () => to !== 'pc' && tvs.size > 0
  function settle() {
    clearTimeout(stopT)
    if (wanted()) {
      if (!proc) {
        const p = proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'pc-audio.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
        p.stdin.on('error', () => {})
        p.stdout.on('data', d => { for (const r of tvs) if (r.writableLength < BEHIND) r.write(d) })
        const gone = () => { if (proc !== p) return; proc = null; if (wanted()) setTimeout(settle, 2000) }
        p.on('error', gone)
        p.on('exit', gone)
      }
      proc.stdin.write(`mute ${to === 'tv' ? 1 : 0}\n`)
    } else if (proc) {
      // Its speakers are given back at once; the rest can wait a moment in case the TV is only reconnecting.
      proc.stdin.write('mute 0\n')
      stopT = setTimeout(() => { if (!wanted() && proc) { proc.stdin.end(); proc = null } }, 3000)
    }
  }
  const tell = () => fetch(`http://127.0.0.1:${PORT}/api/tv/command`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ type: 'audio', on: to !== 'pc' }) }).catch(() => {})
  return async function route(url, req, res, { send, readBody }) {
    const p = url.pathname
    if (p !== '/api/tv/audio' && p !== '/api/tv/audio/state') return false
    if (p === '/api/tv/audio/state') return send(res, 200, { to, available: IS_WIN, tv: tvs.size > 0 }), true
    if (req.method === 'POST') {
      const b = await readBody(req).catch(() => ({})) || {}
      if (!PLACES.includes(b.to)) return send(res, 400, { error: 'to is pc, tv or both' }), true
      if (!IS_WIN && b.to !== 'pc') return send(res, 400, { error: 'Only a Windows PC’s sound can be sent.' }), true
      to = b.to
      settle()
      if (to === 'pc') for (const r of tvs) r.end()
      await tell()
      return send(res, 200, { ok: true, to, tv: tvs.size > 0 }), true
    }
    if (to === 'pc') return send(res, 409, { error: 'This PC’s sound isn’t going to a TV.' }), true
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    res.socket?.setNoDelay(true)
    res.flushHeaders()
    tvs.add(res)
    res.on('error', () => {})
    res.on('close', () => { tvs.delete(res); settle() })
    settle()
    return true
  }
}
