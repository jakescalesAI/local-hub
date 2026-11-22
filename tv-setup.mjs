// "Set up a TV": what the hub's sheet needs to get LocalHub TV onto a television.
//
//   GET  /api/tv/setup        this computer only -> { lan, passcode, app, tvs }
//   POST /api/tv/setup/lan    this computer only, { on } -> turns the home-network address on or off
//
// The TV app finds the hub by scanning its own network for port 3100, so the hub has to answer on
// this computer's home-network address as well as on localhost. That address goes in hub.json
// "listen", which server.mjs only binds once a passcode guards it (a paired TV's key is a second
// way in). Turning it off takes the address out again and server.mjs stops listening on it.
//
// Pairing itself is device-auth.mjs (/api/pair/start, /api/pair/devices); the sheet calls those.
import os from 'node:os'
import { hubConfig, saveHubConfig, PORT } from './config.mjs'
import { isLocal, hasPasscode, passcodeNeeded } from './access.mjs'
import qrcode from './vendor/qrcode.mjs'

// Where the TV app is published. The newest release always carries it under this name.
export const APK_URL = 'https://github.com/jakescalesAI/local-hub/releases/latest/download/LocalHub-TV.apk'

const VIRTUAL = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|vbox|loopback|tailscale|zerotier|utun|bridge|npcap/i
const PREFERRED = /wi-?fi|wlan|wireless|ethernet|^en\d|^eth\d|^wl/i

// This computer's addresses on a home network: private IPv4 on a real adapter, best first.
export function lanAddresses(nets = os.networkInterfaces()) {
  const out = []
  for (const [name, list] of Object.entries(nets || {})) {
    if (VIRTUAL.test(name)) continue
    for (const n of list || []) {
      if (n.family !== 'IPv4' && n.family !== 4) continue
      if (n.internal) continue
      const a = n.address
      const priv = /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a)
      if (!priv) continue
      out.push({ address: a, adapter: name, rank: PREFERRED.test(name) ? 0 : 1 })
    }
  }
  return out.sort((x, y) => x.rank - y.rank).map(({ address, adapter }) => ({ address, adapter }))
}

let appQr = ''
function appQrSvg() {
  if (!appQr) {
    const qr = qrcode(0, 'M')
    qr.addData(APK_URL)
    qr.make()
    appQr = qr.createSvgTag({ cellSize: 5, margin: 8, scalable: true })
  }
  return appQr
}

export function create({ onAccessChange } = {}) {
  function state() {
    const listen = hubConfig().listen || []
    const candidates = lanAddresses()
    const on = candidates.filter(c => listen.includes(c.address))
    const best = on[0] || candidates[0] || null
    return {
      lan: {
        on: on.length > 0,
        address: best?.address || '',
        adapter: best?.adapter || '',
        url: best ? `http://${best.address}:${PORT}` : '',
        port: PORT,
        found: candidates.length > 0,
      },
      passcode: { needed: passcodeNeeded(), set: hasPasscode() },
      app: { url: APK_URL, qrSvg: appQrSvg() },
    }
  }

  return async function route(url, req, res, { send, readBody }) {
    const p = url.pathname
    if (p !== '/api/tv/setup' && p !== '/api/tv/setup/lan') return false
    if (!isLocal(req)) return send(res, 403, { error: 'A TV is set up from the computer running LocalHub.' }), true

    if (p === '/api/tv/setup' && req.method === 'GET') return send(res, 200, state()), true

    if (p === '/api/tv/setup/lan' && req.method === 'POST') {
      const { on } = await readBody(req)
      if (typeof on !== 'boolean') return send(res, 400, { error: 'on must be true or false' }), true
      const candidates = lanAddresses().map(c => c.address)
      const listen = (hubConfig().listen || []).filter(a => !candidates.includes(a))
      if (on) {
        if (!candidates.length) return send(res, 409, { error: "This computer isn't on a home network right now." }), true
        if (passcodeNeeded() && !hasPasscode()) return send(res, 409, { error: 'Set a passcode first. Anyone on your network would otherwise reach the hub.', needPasscode: true }), true
        listen.push(candidates[0])
      }
      saveHubConfig({ listen })
      await onAccessChange?.()
      return send(res, 200, state()), true
    }
    return send(res, 405, { error: 'method not allowed' }), true
  }
}
