// Applies the changes to a temporary copy of a Hub checkout, boots the real server.mjs on a spare
// port and exercises it from outside, the way `tailscale serve` would reach it. The running Hub and
// its config are not touched. A small fake claude.exe stands in for the assistant, so no real chat
// runs. Windows only, like the Hub.
//
//   node test/real-hub.mjs <path-to-hub-checkout> [git-ref]
import { spawn, execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../apply.mjs'

const [repo, ref = 'HEAD'] = process.argv.slice(2)
if (!repo) {
  console.error('Usage: node test/real-hub.mjs <path-to-hub-checkout> [git-ref]')
  process.exit(2)
}

const PORT = 3199
const REPLY_MS = 4000
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-real-'))
const copy = path.join(tmp, 'hub')
const home = path.join(tmp, 'home')
const marker = path.join(copy, 'fake-claude-finished.txt')
let child = null
let log = ''

const sleep = ms => new Promise(r => setTimeout(r, ms))
const OUTSIDE = { host: 'hub.example.com', 'x-forwarded-for': '192.0.2.1', 'x-forwarded-proto': 'https', 'tailscale-user-login': 'someone@example.test' }

function call(pathname, { method = 'GET', headers = {}, body, abortAfterFirstLine = false } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body)
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method, headers: { ...(method === 'GET' ? {} : { 'x-hub': '1' }), ...headers, ...(payload ? { 'content-type': 'application/json' } : {}) } }, res => {
      let text = ''
      res.on('data', chunk => {
        text += chunk
        if (abortAfterFirstLine && text.includes('\n')) {
          req.destroy()
          resolve({ status: res.statusCode, headers: res.headers, text })
        }
      })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
      res.on('error', () => {})
    })
    req.on('error', e => { if (!abortAfterFirstLine) reject(e) })
    if (payload) req.write(payload)
    req.end()
  })
}

const steps = []
async function step(name, fn) {
  await fn()
  steps.push(name)
  console.log(`ok  ${name}`)
}

function fakeClaude() {
  const bin = path.join(home, '.local', 'bin')
  fs.mkdirSync(bin, { recursive: true })
  const src = path.join(tmp, 'fake.cs')
  fs.writeFileSync(src, `using System; using System.IO; using System.Threading;
class P { static void Main() { Thread.Sleep(${REPLY_MS}); File.WriteAllText("fake-claude-finished.txt", "done");
Console.WriteLine("{\\"type\\":\\"assistant\\",\\"message\\":{\\"content\\":[{\\"type\\":\\"text\\",\\"text\\":\\"fake reply\\"}]}}");
Console.WriteLine("{\\"type\\":\\"result\\",\\"subtype\\":\\"success\\",\\"is_error\\":false,\\"result\\":\\"fake reply\\"}"); } }`)
  const csc = path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  execFileSync(csc, ['/nologo', `/out:${path.join(bin, 'claude.exe')}`, src], { stdio: 'pipe' })
}

function setConfig(extra) {
  fs.mkdirSync(path.join(copy, 'config'), { recursive: true })
  fs.writeFileSync(path.join(copy, 'config', 'hub.json'), JSON.stringify({ name: 'Test Hub', access: 'localhost', url: 'https://hub.example.com', ...extra }))
}

async function main() {
  fs.mkdirSync(copy, { recursive: true })
  const tar = path.join(tmp, 'hub.tar')
  execFileSync('git', ['-C', repo, '-c', 'core.autocrlf=false', 'archive', '-o', tar, ref])
  execFileSync('tar', ['-xf', path.basename(tar), '-C', 'hub'], { cwd: tmp })
  fakeClaude()

  await step('the edits apply to this Hub, and applying twice changes nothing more', async () => {
    apply(copy)
    const once = fs.readFileSync(path.join(copy, 'server.mjs'), 'utf8')
    apply(copy)
    assert.equal(fs.readFileSync(path.join(copy, 'server.mjs'), 'utf8'), once)
  })
  await step('a moved anchor line refuses and changes nothing', async () => {
    const other = path.join(tmp, 'moved')
    fs.mkdirSync(other)
    fs.writeFileSync(path.join(other, 'server.mjs'), 'nothing to see\n')
    fs.writeFileSync(path.join(other, 'chat.mjs'), 'nothing\n')
    assert.throws(() => apply(other), /line not found/)
    assert.equal(fs.readFileSync(path.join(other, 'server.mjs'), 'utf8'), 'nothing to see\n')
    assert.ok(!fs.existsSync(path.join(other, 'device-auth.mjs')))
  })

  setConfig()
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: copy,
    env: { ...process.env, HUB_PORT: String(PORT), USERPROFILE: home, HOME: home, LOCALAPPDATA: path.join(home, 'none') },
    windowsHide: true,
  })
  child.stdout.on('data', d => (log += d))
  child.stderr.on('data', d => (log += d))
  for (let i = 0; ; i++) {
    const up = await call('/api/ping').then(r => r.status === 200, () => false)
    if (up) break
    if (i > 100) throw new Error(`Hub did not start:\n${log}`)
    await sleep(200)
  }

  let token, code, deviceId, cookie
  await step('this computer gets in with no token, as it does today', async () => {
    assert.equal((await call('/', { headers: { host: `localhost:${PORT}` } })).status, 200)
    assert.equal((await call('/api/state', { headers: { host: `localhost:${PORT}` } })).status, 200)
  })
  await step('from outside, with no passcode set, only the two pairing routes are open', async () => {
    assert.equal((await call('/', { headers: OUTSIDE })).status, 403)
    assert.equal((await call('/tabs/chat.js', { headers: OUTSIDE })).status, 401)
    assert.equal((await call('/api/state', { headers: OUTSIDE })).status, 401)
    assert.equal((await call('/api/refresh', { method: 'POST', headers: OUTSIDE })).status, 401)
    assert.equal((await call('/api/chat/send', { method: 'POST', headers: OUTSIDE, body: { text: 'hi', detached: true } })).status, 401)
    assert.equal((await call('/api/pair/start', { method: 'POST', headers: OUTSIDE })).status, 401)
    assert.equal((await call('/pair/new', { headers: OUTSIDE })).status, 401)
    assert.equal((await call('/api/pair/me', { headers: OUTSIDE })).status, 401)
    assert.equal((await call('/pair', { headers: OUTSIDE })).status, 200)
    assert.equal((await call('/api/pair/claim', { method: 'POST', headers: OUTSIDE, body: { code: 'WRONG000' } })).status, 400)
  })
  await step('the pairing page works on this computer and shows a QR code', async () => {
    assert.equal((await call('/pair/new', { headers: { host: `localhost:${PORT}` } })).status, 200)
    const started = JSON.parse((await call('/api/pair/start', { method: 'POST', headers: { host: `localhost:${PORT}` } })).text)
    code = started.code
    assert.match(started.qrSvg, /^<svg/)
    assert.ok(started.link.startsWith('localhub://pair?u=https%3A%2F%2Fhub'))
  })
  await step('a phone claims the code from outside and gets in', async () => {
    const r = await call('/api/pair/claim', { method: 'POST', headers: OUTSIDE, body: { code, name: 'Test phone', platform: 'ios' } })
    assert.equal(r.status, 200, r.text)
    ;({ token, deviceId } = JSON.parse(r.text))
    assert.equal((await call('/api/pair/me', { headers: { ...OUTSIDE, authorization: `Bearer ${token}` } })).status, 200)
    assert.equal((await call('/api/state', { headers: { ...OUTSIDE, authorization: `Bearer ${token}` } })).status, 200)
  })
  await step('opening the page swaps the token for a cookie, which then opens everything else', async () => {
    const page = await call('/', { headers: { ...OUTSIDE, authorization: `Bearer ${token}` } })
    assert.equal(page.status, 200)
    assert.match(page.text, /<html/i)
    const set = page.headers['set-cookie'][0]
    assert.match(set, /HttpOnly/)
    assert.match(set, /Secure/)
    cookie = set.split(';')[0]
    assert.equal((await call('/tabs/chat.js', { headers: { ...OUTSIDE, cookie } })).status, 200)
    assert.equal((await call('/api/state', { headers: { ...OUTSIDE, cookie } })).status, 200)
  })
  await step(`a detached share answers at once, and the reply still finishes after ${REPLY_MS / 1000}s`, async () => {
    const started = Date.now()
    const r = await call('/api/chat/send', { method: 'POST', headers: { ...OUTSIDE, authorization: `Bearer ${token}` }, body: { text: 'shared from the test', detached: true } })
    assert.equal(r.status, 200, r.text)
    assert.ok(Date.now() - started < REPLY_MS - 1000, `took ${Date.now() - started} ms`)
    assert.match(r.text, /"type":"session"/)
    await sleep(REPLY_MS + 1500)
    assert.ok(fs.existsSync(marker), 'the reply was killed when the phone went away')
    fs.rmSync(marker)
  })
  await step('a normal send still stops when the connection drops, as it does today', async () => {
    await call('/api/chat/send', { method: 'POST', headers: { ...OUTSIDE, authorization: `Bearer ${token}` }, body: { text: 'normal send' }, abortAfterFirstLine: true })
    await sleep(REPLY_MS + 1500)
    assert.ok(!fs.existsSync(marker), 'the reply kept running after the page went away')
  })
  await step('with a passcode set, a browser signs in with it, and the phone needs no passcode', async () => {
    const salt = crypto.randomBytes(16)
    const hubPasscode = `scrypt$${salt.toString('hex')}$${crypto.scryptSync('test passcode', salt, 32).toString('hex')}`
    fs.writeFileSync(path.join(copy, 'config', 'secrets.json'), JSON.stringify({ hubPasscode }))
    await sleep(2200) // secrets are cached for two seconds
    const login = await call('/', { headers: OUTSIDE })
    assert.equal(login.status, 200)
    assert.match(login.text, /passcode/i)
    assert.equal((await call('/api/state', { headers: OUTSIDE })).status, 401)
    const signedIn = await call('/api/hub/login', { method: 'POST', headers: OUTSIDE, body: { passcode: 'test passcode' } })
    assert.equal(signedIn.status, 200, signedIn.text)
    const session = signedIn.headers['set-cookie'][0].split(';')[0]
    assert.equal((await call('/api/state', { headers: { ...OUTSIDE, cookie: session } })).status, 200)
    assert.equal((await call('/api/pair/start', { method: 'POST', headers: { ...OUTSIDE, cookie: session } })).status, 401, 'making codes stays with this computer and paired devices')
    assert.equal((await call('/api/state', { headers: { ...OUTSIDE, authorization: `Bearer ${token}` } })).status, 200)
    assert.equal((await call('/api/state', { headers: { ...OUTSIDE, authorization: 'Bearer nope' } })).status, 401)
  })
  await step('removing the phone ends its access at once, by token and by cookie', async () => {
    assert.equal((await call(`/api/pair/devices/${deviceId}/remove`, { method: 'POST', headers: { host: `localhost:${PORT}` } })).status, 200)
    assert.equal((await call('/api/pair/me', { headers: { ...OUTSIDE, authorization: `Bearer ${token}` } })).status, 401)
    assert.equal((await call('/api/state', { headers: { ...OUTSIDE, cookie } })).status, 401)
  })
  await step('the token and the code never reach the Hub log', async () => {
    assert.ok(!log.includes(token), 'token in log')
    assert.ok(!log.includes(code), 'code in log')
  })
  await step('the token is not on disk, only its hash', async () => {
    const disk = fs.readFileSync(path.join(copy, 'data', 'devices.json'), 'utf8')
    assert.ok(!disk.includes(token))
  })
  await step('with passcodeRequired off, the Hub is open as the owner chose, and pairing stays closed', async () => {
    setConfig({ passcodeRequired: false })
    await sleep(2200) // hubConfig caches for two seconds
    assert.equal((await call('/api/state', { headers: OUTSIDE })).status, 200)
    assert.equal((await call('/api/pair/start', { method: 'POST', headers: OUTSIDE })).status, 401)
  })
  console.log(`\n${steps.length} of ${steps.length} checks passed against the real server.mjs at ${ref}`)
}

function cleanup() {
  if (child?.pid) {
    try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
  }
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); break } catch { execFileSync('ping', ['-n', '2', '127.0.0.1'], { stdio: 'ignore' }) }
  }
}

main().then(
  () => { cleanup(); process.exit(0) },
  e => {
    console.error(`FAILED: ${e.message}`)
    console.error(log.split('\n').slice(-15).join('\n'))
    cleanup()
    process.exit(1)
  },
)
