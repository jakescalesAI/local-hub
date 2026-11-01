// Runs the real module behind a real HTTP server wired the way server.mjs would wire it, including
// a stand-in for `tailscale serve`: a local proxy, so requests reach the hub from 127.0.0.1.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDeviceAuth, isLocal } from '../device-auth.mjs'

const dirs = []
const servers = []
after(() => {
  servers.forEach(s => s.close())
  dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }))
})

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(type === 'application/json' ? JSON.stringify(body) : body)
}
async function readBody(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}
const listen = server => new Promise(r => { servers.push(server); server.listen(0, '127.0.0.1', () => r(server.address().port)) })

async function hub({ on = true, url = 'https://hub.example.test' } = {}) {
  const here = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-pair-'))
  dirs.push(here)
  const auth = createDeviceAuth({ here, enabled: () => on, hubName: () => 'Test Hub', hubUrl: () => url })
  const port = await listen(http.createServer(async (req, res) => {
    const u = new URL(req.url, `http://${req.headers.host}`)
    if (req.method !== 'GET' && req.headers['x-hub'] !== '1') return send(res, 403, { error: 'missing x-hub header' })
    if (auth.gate(u, req, res, { send })) return
    if (await auth.route(u, req, res, { send, readBody })) return
    if (u.pathname === '/') return send(res, 200, '<h1>hub page</h1>', 'text/html')
    if (u.pathname === '/api/state') return send(res, 200, { secret: 'state' })
    if (u.pathname === '/api/ping') return send(res, 200, { ok: true })
    send(res, 404, { error: 'not found' })
  }))
  return { here, port, base: `http://127.0.0.1:${port}` }
}

// Forwards to the hub from 127.0.0.1 with the outside Host and forwarding headers, like Serve.
async function proxyTo(hubPort, extra = {}) {
  const port = await listen(http.createServer((req, res) => {
    const up = http.request({ host: '127.0.0.1', port: hubPort, path: req.url, method: req.method, headers: { ...req.headers, ...extra } }, r => {
      res.writeHead(r.statusCode, r.headers)
      r.pipe(res)
    })
    req.pipe(up)
  }))
  return `http://127.0.0.1:${port}`
}

const POST = (body, headers = {}) => ({ method: 'POST', headers: { 'x-hub': '1', ...headers }, body: body ? JSON.stringify(body) : undefined })
const AS = token => ({ headers: { authorization: `Bearer ${token}` } })
const SERVE = { host: 'hub.example.com', 'x-forwarded-for': '192.0.2.1', 'x-forwarded-proto': 'https', 'tailscale-user-login': 'someone@example.test' }

async function code(h) {
  const r = await fetch(`${h.base}/api/pair/start`, POST())
  assert.equal(r.status, 200)
  return r.json()
}
async function pair(h, name = 'My phone') {
  const c = await code(h)
  const r = await fetch(`${h.base}/api/pair/claim`, POST({ code: c.code, name, platform: 'ios' }))
  assert.equal(r.status, 200)
  return r.json()
}

test('this computer can make a code, and the link carries the address and code', async () => {
  const h = await hub()
  const c = await code(h)
  assert.match(c.code, /^[0-9A-HJKMNP-TV-Z]{8}$/)
  assert.equal(c.address, 'https://hub.example.test')
  assert.equal(c.link, `localhub://pair?u=https%3A%2F%2Fhub.example.test&c=${c.code}`)
  assert.match(c.qrSvg, /^<svg/)
})

test('a hub with no HTTPS address gives a code but no link or QR', async () => {
  const h = await hub({ url: 'http://192.0.2.1:3100' })
  const c = await code(h)
  assert.equal(c.address, '')
  assert.equal(c.link, '')
  assert.equal(c.qrSvg, '')
})

test('claim returns a working token, and only the hash is on disk', async () => {
  const h = await hub()
  const p = await pair(h)
  const me = await fetch(`${h.base}/api/pair/me`, AS(p.token))
  assert.equal(me.status, 200)
  const body = await me.json()
  assert.equal(body.name, 'My phone')
  assert.equal(body.hub.name, 'Test Hub')
  const disk = fs.readFileSync(path.join(h.here, 'data', 'devices.json'), 'utf8')
  assert.ok(!disk.includes(p.token), 'token must not be stored')
  assert.ok(disk.includes('"hash"'))
})

test('a code works once', async () => {
  const h = await hub()
  const c = await code(h)
  assert.equal((await fetch(`${h.base}/api/pair/claim`, POST({ code: c.code }))).status, 200)
  assert.equal((await fetch(`${h.base}/api/pair/claim`, POST({ code: c.code }))).status, 400)
})

test('a typed code tolerates lower case and spaces', async () => {
  const h = await hub()
  const c = await code(h)
  const typed = `${c.code.slice(0, 4)} ${c.code.slice(4)}`.toLowerCase()
  assert.equal((await fetch(`${h.base}/api/pair/claim`, POST({ code: typed }))).status, 200)
})

test('five wrong guesses burn the code, even if the sixth is right', async () => {
  const h = await hub()
  const c = await code(h)
  for (let i = 0; i < 4; i++) assert.equal((await fetch(`${h.base}/api/pair/claim`, POST({ code: 'WRONG000' }))).status, 403)
  assert.equal((await fetch(`${h.base}/api/pair/claim`, POST({ code: 'WRONG000' }))).status, 403)
  const r = await fetch(`${h.base}/api/pair/claim`, POST({ code: c.code }))
  assert.equal(r.status, 400)
})

test('four wrong guesses still leave the code usable', async () => {
  const h = await hub()
  const c = await code(h)
  for (let i = 0; i < 4; i++) await fetch(`${h.base}/api/pair/claim`, POST({ code: 'WRONG000' }))
  assert.equal((await fetch(`${h.base}/api/pair/claim`, POST({ code: c.code }))).status, 200)
})

test('an expired code is refused', async t => {
  const h = await hub()
  const c = await code(h)
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 5 * 60e3 + 1000 })
  const r = await fetch(`${h.base}/api/pair/claim`, POST({ code: c.code }))
  t.mock.timers.reset()
  assert.equal(r.status, 400)
})

test('a code of the wrong length is a wrong guess, not a crash', async () => {
  const h = await hub()
  await code(h)
  for (const bad of ['', 'A', 'AAAAAAAAAAAAAAAAAAAA', null, 12345678, { a: 1 }]) {
    assert.equal((await fetch(`${h.base}/api/pair/claim`, POST({ code: bad }))).status, 403, JSON.stringify(bad))
    await code(h)
  }
})

test('gate on: from outside, nothing is reachable without a token', async () => {
  const h = await hub()
  const out = await proxyTo(h.port, SERVE)
  assert.equal((await fetch(`${out}/api/state`)).status, 401)
  const page = await fetch(`${out}/`, { redirect: 'manual' })
  assert.equal(page.status, 302)
  assert.equal(page.headers.get('location'), '/pair')
  assert.equal((await fetch(`${out}/api/refresh`, POST())).status, 401)
  assert.equal((await fetch(`${out}/pair`)).status, 200)
  assert.equal((await fetch(`${out}/api/ping`)).status, 200)
})

test('the failure this gate exists for: a proxied request from 127.0.0.1 is not local', async () => {
  const h = await hub()
  assert.equal((await fetch(`${h.base}/api/state`)).status, 200, 'this computer still gets in')
  for (const extra of [SERVE, { host: 'hub.example.com' }, { 'x-forwarded-for': '192.0.2.1' }, { 'tailscale-user-login': 'x@example.test' }, { forwarded: 'for=192.0.2.1' }]) {
    const out = await proxyTo(h.port, extra)
    assert.equal((await fetch(`${out}/api/state`)).status, 401, JSON.stringify(extra))
  }
})

test('a website rebinding its name to 127.0.0.1 is not local', () => {
  const req = (remote, headers) => ({ socket: { remoteAddress: remote }, headers })
  assert.equal(isLocal(req('127.0.0.1', { host: 'evil.example.test:3100' })), false)
  assert.equal(isLocal(req('192.0.2.1', { host: 'localhost:3100' })), false)
  assert.equal(isLocal(req('127.0.0.1', { host: 'localhost:3100' })), true)
  assert.equal(isLocal(req('::ffff:127.0.0.1', { host: '127.0.0.1:3100' })), true)
  assert.equal(isLocal(req('::1', { host: '[::1]:3100' })), true)
})

test('from outside, nobody can make a code or list devices', async () => {
  const h = await hub()
  const out = await proxyTo(h.port, SERVE)
  assert.equal((await fetch(`${out}/api/pair/start`, POST())).status, 401)
  assert.equal((await fetch(`${out}/api/pair/devices`)).status, 401)
  assert.equal((await fetch(`${out}/pair/new`, { redirect: 'manual' })).status, 302, 'gated to the sign-in page')
})

test('gate off: same refusals for pairing, hub open as it is today', async () => {
  const h = await hub({ on: false })
  const out = await proxyTo(h.port, SERVE)
  assert.equal((await fetch(`${out}/api/state`)).status, 200)
  assert.equal((await fetch(`${out}/api/pair/start`, POST())).status, 401)
  assert.equal((await fetch(`${out}/pair/new`)).status, 403)
})

test('a paired device gets through from outside, and POSTs still need x-hub', async () => {
  const h = await hub()
  const p = await pair(h)
  const out = await proxyTo(h.port, SERVE)
  assert.equal((await fetch(`${out}/api/state`, AS(p.token))).status, 200)
  assert.equal((await fetch(`${out}/api/pair/start`, { method: 'POST', ...AS(p.token) })).status, 403)
  assert.equal((await fetch(`${out}/api/pair/start`, POST(null, AS(p.token).headers))).status, 200)
})

test('the page load swaps the Bearer for an HttpOnly, Secure cookie, and the cookie alone works', async () => {
  const h = await hub()
  const p = await pair(h)
  const out = await proxyTo(h.port, SERVE)
  const page = await fetch(`${out}/`, AS(p.token))
  assert.equal(page.status, 200)
  const cookie = page.headers.get('set-cookie')
  assert.match(cookie, /^hub_device=/)
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Strict/)
  assert.match(cookie, /Secure/)
  const api = await fetch(`${out}/api/state`, { headers: { cookie: cookie.split(';')[0] } })
  assert.equal(api.status, 200)
})

test('no cookie is set on API calls, or on plain HTTP with Secure', async () => {
  const h = await hub()
  const p = await pair(h)
  assert.equal((await fetch(`${h.base}/api/state`, AS(p.token))).headers.get('set-cookie'), null)
  const plain = await fetch(`${h.base}/`, AS(p.token))
  assert.ok(!/Secure/.test(plain.headers.get('set-cookie')))
})

test('a bad token is refused, and removal ends access at once', async () => {
  const h = await hub()
  const a = await pair(h, 'A')
  const b = await pair(h, 'B')
  const out = await proxyTo(h.port, SERVE)
  assert.equal((await fetch(`${out}/api/pair/me`, AS('nope'))).status, 401)
  assert.equal((await fetch(`${out}/api/state`, AS('nope'))).status, 401)
  const list = await (await fetch(`${out}/api/pair/devices`, AS(a.token))).json()
  assert.deepEqual(list.devices.map(d => d.name).sort(), ['A', 'B'])
  assert.ok(list.devices.every(d => !('hash' in d)), 'hashes stay on the hub')
  assert.equal((await fetch(`${out}/api/pair/devices/${b.deviceId}/remove`, POST(null, AS(a.token).headers))).status, 200)
  assert.equal((await fetch(`${out}/api/pair/me`, AS(b.token))).status, 401)
  assert.equal((await fetch(`${out}/api/state`, AS(b.token))).status, 401)
  assert.equal((await fetch(`${out}/api/pair/me`, AS(a.token))).status, 200)
  assert.equal((await fetch(`${out}/api/pair/devices/${b.deviceId}/remove`, POST(null, AS(a.token).headers))).status, 404)
})

test('devices survive a hub restart', async () => {
  const h = await hub()
  const p = await pair(h)
  const again = createDeviceAuth({ here: h.here, enabled: () => true, hubName: () => 'Test Hub' })
  const port = await listen(http.createServer(async (req, res) => {
    const u = new URL(req.url, `http://${req.headers.host}`)
    if (again.gate(u, req, res, { send })) return
    if (await again.route(u, req, res, { send, readBody })) return
    send(res, 404, { error: 'not found' })
  }))
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/pair/me`, AS(p.token))).status, 200)
})

test('device names cannot carry markup into a page', async () => {
  const h = await hub()
  const c = await code(h)
  const r = await (await fetch(`${h.base}/api/pair/claim`, POST({ code: c.code, name: '<img src=x onerror=alert(1)>' }))).json()
  const me = await (await fetch(`${h.base}/api/pair/me`, AS(r.token))).json()
  assert.ok(!/[<>]/.test(me.name))
})

test('a malformed claim body is an error from the caller, not a hang', async () => {
  const h = await hub()
  await code(h)
  const r = await Promise.race([
    fetch(`${h.base}/api/pair/claim`, POST({})).then(x => x.status),
    new Promise(resolve => setTimeout(() => resolve('hung'), 3000)),
  ])
  assert.equal(r, 403)
})
