import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

import { BUNDLE_MARKER } from '../src/as-node.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const APP_DIR = path.resolve(HERE, '..')
export const REPO = path.resolve(APP_DIR, '..')
export const PACKAGED_EXE = path.join(APP_DIR, 'dist', 'win-unpacked', 'LocalHub.exe')
const SHIM = path.join(HERE, 'fixtures', 'test-shim.cjs')
export const STUB_DIR = path.join(HERE, 'fixtures', 'stub-hub')
export const STUB_SERVER = path.join(STUB_DIR, 'server.mjs')

// Unusual on purpose, so tests never fight a binding anyone actually uses.
export const TEST_HOTKEY = 'Ctrl+Alt+Shift+F23'
export const TEST_HOTKEY_KEYS = [0x11, 0x12, 0x10, 0x86]
export const TEST_HOTKEY_2 = 'Ctrl+Alt+Shift+F22'
export const TEST_HOTKEY_2_KEYS = [0x11, 0x12, 0x10, 0x85]

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function waitFor(check, label, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs
  let last
  while (Date.now() < until) {
    last = await check()
    if (last) return last
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${label}; last value: ${JSON.stringify(last)}`)
}

export const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => resolve(port))
  })
})

export async function ping(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/ping`, { signal: AbortSignal.timeout(1500) })
    return (await res.json()).ok === true
  } catch {
    return false
  }
}

const callHub = (port, route) => fetch(`http://localhost:${port}${route}`, { signal: AbortSignal.timeout(25_000) })

// A call that fails stays failed. This only says why, for a failure that may not come back: each address
// tried, what held the port, what the Hub wrote (no log means this app never started one), and a second look.
async function whyNoAnswer(error, port, route, userData) {
  const attempts = (error.cause?.errors ?? [error.cause]).map(item => `${item?.code ?? item?.name} ${item?.address ?? ''}`.trim())
  const holders = () => spawnSync('netstat.exe', ['-ano'], { encoding: 'utf8', windowsHide: true }).stdout.split(/\r?\n/)
    .filter(line => line.includes(`:${port} `)).map(line => line.trim().replace(/\s+/g, ' '))
  const details = [`tried: ${attempts.join(', ')}`, `port: ${JSON.stringify(holders())}`]
  if (userData) {
    const log = path.join(userData, 'logs', 'hub.log')
    details.push(`hub.log: ${fs.existsSync(log) ? fs.readFileSync(log, 'utf8').slice(-1000) : '(none)'}`)
  }
  await sleep(1500)
  const later = await callHub(port, route).then(res => `answered ${res.status}`, e => `refused again: ${e.cause?.code ?? e.message}`)
  details.push(`1.5 s later: ${later}`, `port then: ${JSON.stringify(holders())}`)
  return new Error(`${error.message} (${details.join('; ')})`, { cause: error })
}

export async function getJson(port, route, { userData } = {}) {
  const res = await callHub(port, route).catch(async error => { throw await whyNoAnswer(error, port, route, userData) })
  return res.json()
}

export const processAlive = pid => {
  try { process.kill(pid, 0); return true } catch { return false }
}

// A stub Hub this test started itself, playing a Hub that was already running.
export async function startExternalStub(port, env = {}) {
  const child = spawn(process.execPath, [STUB_SERVER], { env: { ...process.env, HUB_PORT: String(port), ...env }, stdio: 'ignore', windowsHide: true })
  await waitFor(() => ping(port), `stub hub on ${port}`)
  return child
}

export const stopExternalStub = child => new Promise(resolve => {
  if (!child || child.exitCode !== null) return resolve()
  child.once('exit', resolve)
  child.kill()
})

// A server elsewhere that counts its requests, so "blocked" means it was never asked.
export async function startForeignServer() {
  const port = await freePort()
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push(req.url)
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><title>foreign</title><h1>foreign page</h1>')
  })
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  return { port, origin: `http://localhost:${port}`, hits, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }) }
}

// A copy of the real Hub with no config, in a temp folder, so nothing lands in this clone.
const NOT_THE_HUB = new Set(['desktop', '.git', 'config', 'data', 'workspace', 'node_modules', 'handoffs', 'caddy', 'logs'])

export function copyHub(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-hub-e2e-real-'))
  cleanup(t, () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))
  fs.cpSync(REPO, dir, { recursive: true, filter: from => !NOT_THE_HUB.has(path.relative(REPO, from).split(path.sep)[0]) })
  fs.writeFileSync(path.join(dir, BUNDLE_MARKER), 'test')
  return dir
}

export function makeUserData(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-hub-e2e-'))
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ hotkey: TEST_HOTKEY, ...settings }))
  return dir
}

export function removeUserData(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

// Node runs after-hooks oldest first, and the app has to be gone before its folder can go. These run
// newest first, and one failing doesn't stop the rest.
const cleanups = new WeakMap()
export function cleanup(t, fn) {
  if (!cleanups.has(t)) {
    const stack = []
    cleanups.set(t, stack)
    t.after(async () => {
      while (stack.length) await Promise.resolve().then(stack.pop()).catch(error => t.diagnostic(`cleanup: ${error.message}`))
    })
  }
  cleanups.get(t).push(fn)
}

export const readSettings = dir => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))

const liveApps = new Set()
process.on('exit', () => {
  for (const proc of liveApps) spawnSync('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true })
})

// While tests/tools/net-audit.ps1 is watching, Chromium also writes down each connection the app makes.
let netLogs = 0
export const netLogArgs = () => (process.env.LH_NET_LOG_DIR
  ? [`--log-net-log=${path.join(process.env.LH_NET_LOG_DIR, `net-${process.pid}-${netLogs += 1}.json`)}`]
  : [])

export async function launch({ userData, args = [], env = {}, packaged = false }) {
  const launchEnv = { ...process.env, LH_TEST_USER_DATA: userData, ...env }
  delete launchEnv.ELECTRON_RUN_AS_NODE
  const app = await electron.launch(packaged
    ? { executablePath: PACKAGED_EXE, args: [`--user-data-dir=${userData}`, ...netLogArgs(), ...args], env: launchEnv, timeout: 60_000 }
    : { args: ['-r', SHIM, ...netLogArgs(), APP_DIR, ...args], env: launchEnv, cwd: APP_DIR, timeout: 60_000 })
  const proc = app.process()
  // A failed test must not leave the app behind, or the runner waits on it forever.
  liveApps.add(proc)
  proc.once('exit', () => liveApps.delete(proc))
  const exited = new Promise(resolve => proc.once('exit', resolve))
  const output = []
  proc.stderr?.on('data', chunk => output.push(String(chunk)))
  proc.stdout?.on('data', chunk => output.push(String(chunk)))
  return { app, proc, exited, output, pid: proc.pid }
}

// The most a quit can take when everything is slow: 15 s for the Hub, 5 s for Electron, then the guard
// has to start and end it, which came to 21 to 23 s under load. Idle it takes 2 to 3 s with a built-in Hub
// and under 1 s with an attached one. Don't raise this to get a test through: past it, something is wrong.
export const QUIT_LIMIT_MS = 25_000

export async function quit(handle) {
  await handle.app.evaluate(({ app }) => { setImmediate(() => app.quit()) }).catch(() => {})
  await Promise.race([handle.exited, sleep(QUIT_LIMIT_MS).then(() => { throw new Error(`app did not exit within ${QUIT_LIMIT_MS / 1000} s`) })])
}

// Windows in creation order: [0] main, [1] launcher, then anything opened later.
export const windows = handle => handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .sort((a, b) => a.id - b.id)
  .map(win => ({
    id: win.id,
    url: win.webContents.getURL(),
    title: win.getTitle(),
    visible: win.isVisible(),
    bounds: win.getBounds(),
    onTop: win.isAlwaysOnTop(),
    loading: win.webContents.isLoading(),
  })))

export async function evalIn(handle, index, code) {
  return handle.app.evaluate(({ BrowserWindow }, { index, code }) => {
    const win = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[index]
    return win.webContents.executeJavaScript(code, true)
  }, { index, code })
}

export const waitForUrl = (handle, index, test, label, timeoutMs) =>
  waitFor(async () => {
    const list = await windows(handle)
    const win = list[index]
    return win && !win.loading && test(win.url) ? win : null
  }, label, timeoutMs)

export const trayItem = (handle, id, action = 'click') => handle.app.evaluate(({}, { id, action }) => {
  const item = global.__lh.trayMenu.getMenuItemById(id)
  if (action === 'click') item.click()
  return { label: item.label, checked: item.checked, enabled: item.enabled }
}, { id, action })

export const recorded = handle => handle.app.evaluate(() => ({
  external: global.__lh.external,
  loginCalls: global.__lh.loginCalls,
  loginOn: global.__lh.loginOn,
  shown: global.__lh.shown,
}))

export function pressKeys(keys) {
  // Sent on stdin: with no script file, PowerShell's script policy doesn't apply.
  const script = [
    `$ErrorActionPreference = 'Stop'`,
    `Add-Type -Namespace LocalHubTest -Name Keys -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);'`,
    ...keys.map(key => `[LocalHubTest.Keys]::keybd_event(${key}, 0, 0, [UIntPtr]::Zero)`),
    ...keys.toReversed().map(key => `[LocalHubTest.Keys]::keybd_event(${key}, 0, 2, [UIntPtr]::Zero)`),
    '',
  ].join('\n')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], { input: script, windowsHide: true, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`press-hotkey failed: ${result.stderr}`)
}

// The login items in the registry: read-only, to prove the suite left them alone. Only the entries count:
// on a fresh Windows (a CI runner) the Run key may not exist until Electron reads the login settings and
// creates it empty, which adds no login item.
export const runKey = () => (spawnSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'], { encoding: 'utf8', windowsHide: true }).stdout || '')
  .split(/\r?\n/).filter(line => /^\s+\S/.test(line)).map(line => line.trim()).sort().join('\n')
