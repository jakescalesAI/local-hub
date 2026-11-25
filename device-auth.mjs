// Paired devices: how a phone (or a browser on your private network) signs in to the hub.
//
//   GET  /pair/new                    this computer only: page with the QR code and pairing code
//   POST /api/pair/start { urls? }    this computer or a paired device -> { code, expires, address, link, qrSvg, links: [{ url, qrSvg }] }
//                                      each of urls (where this hub answers) as a page to open with the code already in it
//   POST /api/pair/claim              { code, name?, platform? } -> { token, deviceId, hub: { id, name } }
//   GET  /api/pair/me                 paired device -> { deviceId, name, hub: { id, name } }, or 401
//   GET  /api/pair/devices            this computer or a paired device -> { devices: [...] }
//   POST /api/pair/devices/<id>/remove
//   GET  /pair                        anyone: enter a code to sign this browser in
//
// The token is 32 random bytes. The hub keeps only its SHA-256 hash, in data/devices.json. The
// phone sends it as a Bearer header, or as an HttpOnly cookie once the hub page is open.
//
// The Hub's passcode gate (access.mjs) still decides who may open the hub. A paired device is a
// second way past it, and /pair and /api/pair/claim stay open so a phone can get its first key.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import qrcode from './vendor/qrcode.mjs'

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // no I, L, O, U: they read as other letters
const CODE_LENGTH = 8
const CODE_TTL_MS = 5 * 60e3
const MAX_GUESSES = 5
const COOKIE = 'hub_device'
const COOKIE_DAYS = 365
const SEEN_FLUSH_MS = 60e3
const MAX_DEVICES = 50
const MAX_CLAIM_BYTES = 4096

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const FORWARD_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip']

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex')
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
const cleanCode = s => String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '')
const cleanLabel = (s, fallback) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60) || fallback
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

// A request is from this computer only when all three agree. Behind `tailscale serve` (or any
// local proxy) every request arrives from 127.0.0.1, so the source address alone would let the
// whole Tailscale network in. The Host check also stops a website rebinding its own name to 127.0.0.1.
export function isLocal(req) {
  if (!LOOPBACK.has(req.socket.remoteAddress)) return false
  if (!LOCAL_HOSTS.has(String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase())) return false
  if (FORWARD_HEADERS.some(h => h in req.headers)) return false
  return !Object.keys(req.headers).some(h => h.startsWith('tailscale-'))
}

function bearerOf(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')
  return m ? m[1] : ''
}

function cookieOf(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === COOKIE) return v.join('=')
  }
  return ''
}

// Secure only where the browser really is on HTTPS: a Secure cookie on plain HTTP is thrown away.
function cookieHeader(req, token) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https'
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_DAYS * 86400}${secure ? '; Secure' : ''}`
}

// The claim route is open to anyone who can reach the hub, so it reads only a small body.
async function readClaim(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > MAX_CLAIM_BYTES) return {}
  }
  try { return JSON.parse(raw) } catch { return {} }
}

export function createDeviceAuth({ here, hubName = () => 'Hub', hubUrl = () => '' }) {
  const file = path.join(here, 'data', 'devices.json')
  let store = null
  let pending = null // { code, expires, guesses }; only one at a time, and only in memory
  let seenDirty = false

  function load() {
    if (store) return store
    try {
      store = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
      store = { hubId: crypto.randomUUID(), devices: [] }
      save()
    }
    return store
  }

  // Temp file then rename: a crash mid-write must never leave a half-written device list.
  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, file)
  }

  const timer = setInterval(() => { if (seenDirty) { seenDirty = false; save() } }, SEEN_FLUSH_MS)
  timer.unref()

  function deviceFor(token) {
    if (!token) return null
    const hash = sha256(token)
    return load().devices.find(d => sameHash(d.hash, hash)) || null
  }

  function authenticate(req) {
    const bearer = bearerOf(req)
    const device = deviceFor(bearer || cookieOf(req))
    if (device) {
      device.lastSeen = Date.now()
      seenDirty = true
    }
    return { device, viaBearer: !!(device && bearer), token: bearer }
  }

  function startPairing(urls) {
    const bytes = crypto.randomBytes(CODE_LENGTH)
    const code = Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
    pending = { code, expires: Date.now() + CODE_TTL_MS, guesses: 0 }
    const address = String(hubUrl() || '').replace(/\/+$/, '')
    const usable = /^https:\/\//i.test(address)
    const link = usable ? `localhub://pair?u=${encodeURIComponent(address)}&c=${code}` : ''
    let qrSvg = ''
    if (link) {
      const qr = qrcode(0, 'M')
      qr.addData(link)
      qr.make()
      qrSvg = qr.createSvgTag({ cellSize: 6, margin: 12, scalable: true })
    }
    // The code travels after the #, which no server or log sees.
    const links = (Array.isArray(urls) ? urls : [address]).filter(u => typeof u === 'string' && u.length < 200 && /^https?:\/\/[\w.:[\]-]+$/i.test(u)).slice(0, 4).map(u => {
      const q = qrcode(0, 'M')
      q.addData(`${u}/pair#${code}`)
      q.make()
      return { url: u, qrSvg: q.createSvgTag({ cellSize: 6, margin: 12, scalable: true }) }
    })
    return { code, expires: pending.expires, address: usable ? address : '', link, qrSvg, links }
  }

  // Wrong guesses count against the code, not against the caller: five and it is gone, so a
  // guesser gets five tries in 32^8 no matter how many addresses they come from.
  function claim(input) {
    const body = input && typeof input === 'object' ? input : {}
    if (!pending || Date.now() > pending.expires) {
      pending = null
      return { status: 400, body: { error: 'That code has expired. Make a new one on your computer.' } }
    }
    const given = Buffer.from(cleanCode(body.code).padEnd(CODE_LENGTH, '?').slice(0, CODE_LENGTH))
    if (!crypto.timingSafeEqual(given, Buffer.from(pending.code))) {
      pending.guesses++
      if (pending.guesses >= MAX_GUESSES) pending = null
      return { status: 403, body: { error: 'That code is not right.' } }
    }
    pending = null
    const s = load()
    if (s.devices.length >= MAX_DEVICES) return { status: 409, body: { error: 'Too many devices are paired. Remove one first.' } }
    const token = crypto.randomBytes(32).toString('base64url')
    const device = {
      id: crypto.randomUUID(),
      name: cleanLabel(body.name, 'Phone'),
      platform: cleanLabel(body.platform, 'unknown').slice(0, 16),
      hash: sha256(token),
      created: Date.now(),
      lastSeen: Date.now(),
    }
    s.devices.push(device)
    save()
    return { status: 200, token, device, body: { token, deviceId: device.id, hub: hubInfo() } }
  }

  const hubInfo = () => ({ id: load().hubId, name: hubName() })
  const publicDevice = ({ id, name, platform, created, lastSeen }) => ({ id, name, platform, created, lastSeen })

  // Runs before the passcode gate. True means this request doesn't need the passcode. A valid Bearer
  // on the page load is swapped for a cookie, so the page's own requests work without the token ever
  // reaching its scripts. The TV app opens /tv/ the same way the phone opens /.
  function admit(url, req, res) {
    const { device, viaBearer, token } = authenticate(req)
    req.hubDevice = device
    if (viaBearer && req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/tv/')) res.setHeader('set-cookie', cookieHeader(req, token))
    if (device) return true
    return (url.pathname === '/pair' && req.method === 'GET') || (url.pathname === '/api/pair/claim' && req.method === 'POST')
  }

  async function route(url, req, res, { send }) {
    const p = url.pathname
    if (p !== '/pair' && p !== '/pair/new' && !p.startsWith('/api/pair/')) return false
    const trusted = isLocal(req) || !!req.hubDevice

    if (p === '/pair' && req.method === 'GET') return send(res, 200, signInPage(hubName()), 'text/html; charset=utf-8'), true
    if (p === '/pair/new' && req.method === 'GET') {
      if (!isLocal(req)) return send(res, 403, 'Open this page on the computer running the hub.', 'text/plain; charset=utf-8'), true
      return send(res, 200, newCodePage(hubName()), 'text/html; charset=utf-8'), true
    }
    if (p === '/api/pair/claim' && req.method === 'POST') {
      const r = claim(await readClaim(req))
      if (r.token && req.headers['x-hub-browser'] === '1') res.setHeader('set-cookie', cookieHeader(req, r.token))
      return send(res, r.status, r.body), true
    }
    if (p === '/api/pair/me' && req.method === 'GET') {
      if (!req.hubDevice) return send(res, 401, { error: 'This device is not paired.' }), true
      return send(res, 200, { deviceId: req.hubDevice.id, name: req.hubDevice.name, hub: hubInfo() }), true
    }
    if (!trusted) return send(res, 401, { error: 'Pair this device first.' }), true
    if (p === '/api/pair/start' && req.method === 'POST') return send(res, 200, startPairing((await readClaim(req)).urls)), true
    if (p === '/api/pair/devices' && req.method === 'GET') return send(res, 200, { devices: load().devices.map(publicDevice) }), true
    const remove = /^\/api\/pair\/devices\/([0-9a-f-]{36})\/remove$/.exec(p)
    if (remove && req.method === 'POST') {
      const s = load()
      const before = s.devices.length
      s.devices = s.devices.filter(d => d.id !== remove[1])
      if (s.devices.length === before) return send(res, 404, { error: 'No such device.' }), true
      save()
      return send(res, 200, { ok: true }), true
    }
    return send(res, 404, { error: 'not found' }), true
  }

  return { admit, route }
}

const PAGE_CSS = `:root{color-scheme:light dark;--bg:#f2f2f7;--surface:#fff;--label:#000;--label-2:rgba(60,60,67,.6);--blue:#007aff;--red:#ff3b30;--sep:rgba(60,60,67,.18)}
@media(prefers-color-scheme:dark){:root{--bg:#000;--surface:#1c1c1e;--label:#fff;--label-2:rgba(235,235,245,.6);--blue:#0a84ff;--red:#ff453a;--sep:rgba(84,84,88,.6)}}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--label);font:17px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,"Segoe UI",system-ui,sans-serif;letter-spacing:-.022em}
main{width:100%;max-width:400px;background:var(--surface);border-radius:14px;padding:24px}h1{margin:0 0 8px;font-size:28px;line-height:1.15}p{margin:8px 0;color:var(--label-2)}
input{width:100%;font:inherit;font-size:22px;letter-spacing:.12em;text-align:center;padding:12px;margin:12px 0;border:.5px solid var(--sep);border-radius:10px;background:transparent;color:inherit;text-transform:uppercase}
button{width:100%;font:inherit;font-weight:600;padding:12px;border:0;border-radius:10px;background:var(--blue);color:#fff}
.err{color:var(--red);min-height:1.4em}.code{font:600 30px/1.2 ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.14em;text-align:center;margin:16px 0}
.qr{background:#fff;border-radius:10px;padding:4px;margin:16px 0}.qr svg{display:block;width:100%;height:auto}.addr{word-break:break-all;text-align:center}`

export function signInPage(name) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#0b0c10"><meta name="apple-mobile-web-app-capable" content="yes"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><title>${esc(name)}</title><style>
*{box-sizing:border-box}html{background:#0b0c10;color-scheme:dark}body{margin:0;min-height:100dvh;display:flex;flex-direction:column;justify-content:center;padding:calc(28px + env(safe-area-inset-top)) 24px calc(28px + env(safe-area-inset-bottom));max-width:480px;margin-inline:auto;color:#fff;font:17px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,"Segoe UI",system-ui,sans-serif;background:radial-gradient(120% 60% at 50% 0,#1b2a52,transparent 70%)}
.ic{width:76px;height:76px;border-radius:19px;display:block}h1{margin:22px 0 8px;font-size:34px;line-height:1.1;letter-spacing:-.03em}p{margin:0 0 22px;color:rgba(255,255,255,.64)}
input{width:100%;height:66px;border:0;outline:0;border-radius:22px;background:rgba(255,255,255,.09);color:#fff;font:700 28px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.16em;text-align:center;text-transform:uppercase}input:focus{box-shadow:0 0 0 2px #fff}input::placeholder{color:rgba(255,255,255,.25)}
button{width:100%;height:58px;margin-top:12px;border:0;border-radius:29px;background:#f2f2f5;color:#000;font:600 18px inherit;font-family:inherit}button:disabled{opacity:.5}.err{color:#ff8f89;min-height:1.5em;margin:10px 4px 0}
details{margin-top:14px;border-radius:20px;background:rgba(255,255,255,.06);padding:0 18px}summary{padding:15px 0;font-weight:600;list-style:none}summary::-webkit-details-marker{display:none}summary::after{content:"+";float:right;opacity:.5;font-weight:400}details[open] summary::after{content:"–"}ol{margin:0 0 16px;padding-left:20px;color:rgba(255,255,255,.72)}li{margin:6px 0}code{padding:2px 7px;border-radius:7px;background:rgba(255,255,255,.12);font-size:14px}a{display:block;margin-top:20px;text-align:center;color:rgba(255,255,255,.56);font-size:15px}</style>
<main id="m"><img class="ic" src="/icons/icon-192.png" alt=""><h1>Pair with ${esc(name)}</h1><p>LocalHub runs on a computer of yours. Pair this device with it once, and it stays signed in.</p>
<form id="f"><input id="c" autocomplete="one-time-code" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="10" placeholder="XXXX XXXX" aria-label="Pairing code" required><p class="err" id="e" role="alert"></p><button id="b">Pair this device</button></form>
<details open><summary>It runs on a laptop or computer</summary><ol><li>Open LocalHub on it, then <b>Phone</b> on the left.</li><li>Press <b>Connect a phone</b>.</li><li>Scan the code with this phone’s camera, or type it above.</li></ol></details>
<details><summary>It runs on a VM, server or container</summary><ol><li>In its LocalHub folder run <code>npm run pair</code>. In a container: <code>docker exec -it localhub npm run pair</code>.</li><li>Scan what it prints, or type the code above.</li></ol></details>
<a href="/?passcode">Use the passcode instead</a></main>
<script>const ua=navigator.userAgent,ipad=/iPad/.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1),kind=/iPhone/.test(ua)?['iPhone','ios']:ipad?['iPad','ios']:/Android/.test(ua)?['Android','android']:/Windows/.test(ua)?['Windows PC','windows']:/Mac/.test(ua)?['Mac','macos']:['Browser','web'];
const show=()=>{const v=c.value.toUpperCase().replace(/[^0-9A-Z]/g,'').slice(0,8);c.value=v.length>4?v.slice(0,4)+' '+v.slice(4):v};c.oninput=show;
if(location.hash.length>4){c.value=decodeURIComponent(location.hash.slice(1));show();history.replaceState(null,'','/pair')}
f.onsubmit=async ev=>{ev.preventDefault();e.textContent='';b.disabled=true;
const r=await fetch('/api/pair/claim',{method:'POST',headers:{'x-hub':'1','x-hub-browser':'1','content-type':'application/json'},body:JSON.stringify({code:c.value,name:kind[0],platform:kind[1]})}).catch(()=>null);
b.disabled=false;if(r&&r.ok){if(kind[1]!=='ios'||navigator.standalone)return location.replace('/');m.innerHTML='<img class="ic" src="/icons/icon-192.png" alt=""><h1>Paired</h1><p>Keep it like an app: press Share, then Add to Home Screen. It opens full screen from there.</p><button onclick="location.replace(\\'/\\')">Open LocalHub</button>';return}
const d=r?await r.json().catch(()=>({})):{};e.textContent=d.error||'Could not reach the hub.'}</script></html>`
}

function newCodePage(name) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pair a phone</title><style>${PAGE_CSS}</style>
<main><h1>Pair a phone</h1><p>Connect a device to ${esc(name)}. This code works once and lasts 5 minutes.</p><div id="o"></div><button id="n">Make a new code</button></main>
<script>async function go(){const r=await fetch('/api/pair/start',{method:'POST',headers:{'x-hub':'1'}});const d=await r.json();
o.innerHTML=(d.qrSvg?'<div class="qr">'+d.qrSvg+'</div><p>Scan this with the LocalHub app, or type:</p><p class="addr" id="a"></p>':'<p class="err">This hub has no HTTPS address yet. Run <b>tailscale serve --bg http://127.0.0.1:3100</b>, then put the https address in <b>url</b> in config/hub.json.</p>')+'<div class="code" id="k"></div>';
k.textContent=d.code.replace(/(.{4})/,'$1 ');if(d.address)a.textContent=d.address}n.onclick=go;go()</script></html>`
}
