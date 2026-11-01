// Who may open this hub. This computer always can. Anyone else needs the passcode, unless the owner
// set passcodeRequired to false in config/hub.json. The passcode is kept as a scrypt hash in
// config/secrets.json, and signed-in browsers are kept hashed in data/hub-sessions.json.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { HERE, hubConfig, secrets, saveSecrets } from './config.mjs'

const SESSIONS = path.join(HERE, 'data', 'hub-sessions.json')
const SESSION_DAYS = 30
const FAIL_WINDOW = 15 * 60_000
const FAILS_PER_ADDRESS = 5
const FAILS_IN_ALL = 30
export const MIN_PASSCODE = 8

// The names this hub answers to. Any other name is a page that reached it by a trick: a website rebinding its
// own name to this computer, or another name for it in the agent's browser. "hosts" in hub.json adds more.
export function knownHost(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase()
  const me = os.hostname().toLowerCase()
  if (host === 'localhost' || host === me || host === `${me}.local`) return true
  const { url, listen, hosts } = hubConfig()
  let address = ''
  try { address = new URL(url).hostname } catch {}
  const nets = Object.values(os.networkInterfaces()).flat().map(n => n.family === 'IPv6' ? `[${n.address.split('%')[0]}]` : n.address)
  return !!host && [address, ...nets, ...(listen || []), ...(hosts || [])].some(n => String(n).toLowerCase() === host)
}

const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1']
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]']
// A request from this computer: a loopback socket, not passed on by a proxy, naming this computer in
// its Host header. The Host check also stops a web page that points its own name at 127.0.0.1.
export function isLocal(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase()
  return LOOPBACK.includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'] && LOCAL_HOSTS.includes(host)
}

export const hasPasscode = () => !!secrets().hubPasscode
export const passcodeNeeded = () => hubConfig().passcodeRequired !== false

export function hashPasscode(passcode) {
  const salt = crypto.randomBytes(16)
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(passcode, salt, 32).toString('hex')}`
}
function matches(passcode) {
  const [, salt, hash] = String(secrets().hubPasscode || '').split('$')
  if (!salt || !hash) return false
  const given = crypto.scryptSync(String(passcode), Buffer.from(salt, 'hex'), 32)
  return crypto.timingSafeEqual(given, Buffer.from(hash, 'hex'))
}
export function setPasscode(passcode) {
  if (typeof passcode !== 'string' || passcode.length < MIN_PASSCODE) throw Object.assign(new Error(`The passcode needs at least ${MIN_PASSCODE} characters`), { code: 400 })
  saveSecrets({ hubPasscode: hashPasscode(passcode) })
  writeSessions({}) // every browser signs in again
}

const hashToken = t => crypto.createHash('sha256').update(t).digest('hex')
function readSessions() {
  try { return JSON.parse(fs.readFileSync(SESSIONS, 'utf8')) } catch { return {} }
}
function writeSessions(all) {
  fs.mkdirSync(path.dirname(SESSIONS), { recursive: true })
  fs.writeFileSync(SESSIONS, JSON.stringify(all))
}
const cookieToken = req => /(?:^|;\s*)hub_session=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1]
function signedIn(req) {
  const token = cookieToken(req)
  if (!token) return false
  const until = readSessions()[hashToken(token)]
  return typeof until === 'number' && until > Date.now()
}
function startSession(req) {
  const token = crypto.randomBytes(32).toString('hex')
  const now = Date.now()
  const all = Object.fromEntries(Object.entries(readSessions()).filter(([, until]) => until > now))
  all[hashToken(token)] = now + SESSION_DAYS * 86_400_000
  writeSessions(all)
  const https = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https'
  return `hub_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86_400}${https ? '; Secure' : ''}`
}

const fails = new Map() // address -> times of recent wrong tries
function tooManyFails(address) {
  const since = Date.now() - FAIL_WINDOW
  for (const [a, times] of fails) {
    const kept = times.filter(t => t > since)
    if (kept.length) fails.set(a, kept)
    else fails.delete(a)
  }
  const total = [...fails.values()].reduce((n, t) => n + t.length, 0)
  return (fails.get(address)?.length || 0) >= FAILS_PER_ADDRESS || total >= FAILS_IN_ALL
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root { color-scheme: light dark; --bg: #f2f2f7; --card: #fff; --text: #1c1c1e; --dim: #6c6c70; --line: #d1d1d6; --accent: #007aff; --bad: #d70015 }
@media (prefers-color-scheme: dark) { :root { --bg: #000; --card: #1c1c1e; --text: #f2f2f7; --dim: #98989d; --line: #3a3a3c; --accent: #0a84ff; --bad: #ff453a } }
* { box-sizing: border-box } body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif }
main { width: 100%; max-width: 380px; background: var(--card); border-radius: 18px; padding: 28px } h1 { margin: 0 0 6px; font-size: 22px } p { margin: 0 0 18px; color: var(--dim) } code { font-size: 14px }
input, button { width: 100%; height: 46px; border-radius: 12px; font: inherit } input { border: 1px solid var(--line); background: transparent; color: inherit; padding: 0 14px } button { margin-top: 12px; border: 0; background: var(--accent); color: #fff; font-weight: 600; cursor: pointer }
#err { min-height: 22px; margin-top: 10px; color: var(--bad); font-size: 14px }
</style></head><body><main>${body}</main></body></html>`

const loginPage = name => page(name, `<h1>${esc(name)}</h1><p>Enter the passcode to open this hub.</p>
<form id="f"><input id="p" type="password" autocomplete="current-password" aria-label="Passcode" autofocus><button>Open</button><div id="err" role="alert"></div></form>
<script>document.getElementById('f').onsubmit = async e => { e.preventDefault(); const err = document.getElementById('err'); err.textContent = ''
  try { const r = await fetch('/api/hub/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ passcode: document.getElementById('p').value }) })
    if (r.ok) return location.reload(); err.textContent = (await r.json()).error || 'That didn’t work' } catch { err.textContent = 'The hub didn’t answer' } }</script>`)

const noPasscodePage = name => page(name, `<h1>${esc(name)}</h1><p>This hub is set to take visits from other devices, but it has no passcode yet, so it stays closed to them. On the hub’s own computer, run <code>npm run passcode</code> in its folder, then come back.</p>`)

async function readJsonBody(req) {
  let raw = ''
  req.setEncoding('utf8') // so a character split across two chunks stays whole
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 4096) return {}
  }
  try { return JSON.parse(raw) } catch { return {} }
}

// Answers the request and returns true unless this visitor may go on to the hub.
export async function gate(req, res, url, send) {
  if (!passcodeNeeded() || isLocal(req)) return false
  const name = hubConfig().name
  if (url.pathname === '/api/hub/login' && req.method === 'POST') {
    if (req.headers['x-hub'] !== '1') return send(res, 403, { error: 'missing x-hub header' }), true
    const address = req.socket.remoteAddress
    if (tooManyFails(address)) return send(res, 429, { error: 'Too many tries. Wait 15 minutes.' }), true
    const { passcode } = await readJsonBody(req)
    if (!hasPasscode() || typeof passcode !== 'string' || !matches(passcode)) {
      fails.set(address, [...(fails.get(address) || []), Date.now()])
      return send(res, 401, { error: 'That passcode isn’t right' }), true
    }
    fails.delete(address)
    res.setHeader('set-cookie', startSession(req))
    return send(res, 200, { ok: true }), true
  }
  if (signedIn(req)) {
    if (url.pathname === '/api/hub/logout' && req.method === 'POST' && req.headers['x-hub'] === '1') {
      const all = readSessions()
      delete all[hashToken(cookieToken(req))]
      writeSessions(all)
      res.setHeader('set-cookie', 'hub_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
      return send(res, 200, { ok: true }), true
    }
    return false
  }
  if (/^\/icons\//.test(url.pathname) && req.method === 'GET') return false
  res.setHeader('cache-control', 'no-store')
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return send(res, hasPasscode() ? 200 : 403, hasPasscode() ? loginPage(name) : noPasscodePage(name), 'text/html; charset=utf-8'), true
  }
  return send(res, 401, { error: 'This hub needs its passcode' }), true
}
