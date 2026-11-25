// Settings › Devices and connections: how this hub can be reached, in one place.
//   GET  /api/reach             this computer only -> { home, tailscale, passcode, adb }
//   POST /api/reach/tailscale   { on }   answer on this computer's Tailscale address, or stop
//   POST /api/reach/open        { what } opens a page of this computer's own settings: bluetooth | network | sound | display
// Turning an address on needs a passcode, as everywhere else (access.mjs); the server binds and closes it. The home network
// is tv-setup.mjs's, the passcode hub-setup.mjs's, and pairing device-auth.mjs's: the page uses those as they are.
import { spawn } from 'node:child_process'
import { hubConfig, saveHubConfig, PORT } from './config.mjs'
import { hasPasscode, isLocal, passcodeNeeded } from './access.mjs'
import { IS_WIN, tailscalePath } from './platform.mjs'
import qrcode from './vendor/qrcode.mjs'

const PAGES = { bluetooth: 'ms-settings:bluetooth', network: 'ms-settings:network', sound: 'ms-settings:sound', display: 'ms-settings:display' }
// What tailscale status says, cut to what the page shows.
export function readTailscale(json) {
  const s = json?.Self || {}
  const name = p => String(p?.DNSName || p?.HostName || '').split('.')[0].slice(0, 60)
  return {
    running: json?.BackendState === 'Running',
    state: String(json?.BackendState || ''),
    ip: (s.TailscaleIPs || []).find(ip => /^100\./.test(ip)) || '',
    dns: String(s.DNSName || '').replace(/\.$/, ''),
    name: name(s),
    peers: Object.values(json?.Peer || {}).map(p => ({ name: name(p), os: String(p.OS || '').slice(0, 20), online: !!p.Online })).filter(p => p.name).sort((a, b) => b.online - a.online || a.name.localeCompare(b.name)).slice(0, 40),
  }
}
export function qrFor(text) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createSvgTag({ cellSize: 5, margin: 8, scalable: true })
}

export function create({ run, onAccessChange } = {}) {
  async function tailscale() {
    const exe = tailscalePath()
    const on = hubConfig().access === 'tailnet'
    if (!exe) return { installed: false, on, running: false, state: '', ip: '', dns: '', name: '', peers: [] }
    const r = await run(exe, ['status', '--json'], { timeout: 6000 }).catch(() => null)
    let j = null
    try { j = JSON.parse(r?.stdout || 'null') } catch {}
    const t = readTailscale(j)
    return { installed: true, on, ...t, url: t.ip ? `http://${t.ip}:${PORT}` : '', qrSvg: on && t.ip ? qrFor(`http://${t.ip}:${PORT}/pair`) : '' }
  }
  return async function route(url, req, res, { send, readBody }) {
    const p = url.pathname
    if (p !== '/api/reach' && !p.startsWith('/api/reach/')) return false
    if (!isLocal(req)) return send(res, 403, { error: 'Do this on the computer running LocalHub.' }), true
    if (p === '/api/reach' && req.method === 'GET') {
      const listen = hubConfig().listen || []
      const home = listen.find(a => /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(a)) || ''
      return send(res, 200, { port: PORT, home: { address: home, url: home ? `http://${home}:${PORT}` : '', qrSvg: home ? qrFor(`http://${home}:${PORT}/pair`) : '' }, tailscale: await tailscale(), passcode: { set: hasPasscode(), needed: passcodeNeeded() } }), true
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true
    const b = await readBody(req).catch(() => ({})) || {}
    if (p === '/api/reach/tailscale') {
      if (typeof b.on !== 'boolean') return send(res, 400, { error: 'on must be true or false' }), true
      if (b.on) {
        const t = await tailscale()
        if (!t.installed) return send(res, 409, { error: 'Install Tailscale on this computer first.' }), true
        if (!t.running || !t.ip) return send(res, 409, { error: 'Open Tailscale on this computer and connect first.' }), true
        if (passcodeNeeded() && !hasPasscode()) return send(res, 409, { error: 'Set a passcode first.', needPasscode: true }), true
      }
      saveHubConfig({ access: b.on ? 'tailnet' : 'localhost' })
      await onAccessChange?.()
      return send(res, 200, { tailscale: await tailscale() }), true
    }
    if (p === '/api/reach/open') {
      const page = PAGES[b.what]
      if (!page || !IS_WIN) return send(res, 400, { error: 'This computer has no such page.' }), true
      spawn('explorer.exe', [page], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref()
      return send(res, 200, { ok: true }), true
    }
    return send(res, 404, { error: 'not found' }), true
  }
}
