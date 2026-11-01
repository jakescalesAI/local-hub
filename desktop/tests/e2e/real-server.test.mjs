// The real Hub server from this repo, started by the app the way a new user's install starts it: no
// config, so the first-run wizard, in a temp folder so nothing lands in this clone. The from-source run
// uses a copy of the repo; the packaged run uses what the installer ships. Run `npm run dist` for that.
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'

import { APP_NAME } from '../../src/app-name.js'
import { BUNDLE_MARKER } from '../../src/as-node.js'
import {
  APP_DIR, PACKAGED_EXE, cleanup, evalIn, freePort, getJson, launch, makeUserData, ping, processAlive, quit, removeUserData,
  trayItem, waitFor, waitForUrl, windows,
} from '../helpers.mjs'

const REPO = path.resolve(APP_DIR, '..')
const NOT_THE_HUB = new Set(['desktop', '.git', 'config', 'data', 'workspace', 'node_modules', 'handoffs', 'caddy', 'logs'])
const SHIPPED = path.join(path.dirname(PACKAGED_EXE), 'resources', 'hub')

function copyHub(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-hub-e2e-real-'))
  cleanup(t, () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))
  fs.cpSync(REPO, dir, { recursive: true, filter: from => !NOT_THE_HUB.has(path.relative(REPO, from).split(path.sep)[0]) })
  fs.writeFileSync(path.join(dir, BUNDLE_MARKER), 'test')
  return dir
}

// Who is listening on this port, and on which addresses.
const listeners = port => execFileSync('netstat.exe', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true })
  .split(/\r?\n/)
  .map(line => line.trim().split(/\s+/))
  .filter(cols => cols[3] === 'LISTENING' && cols[1]?.endsWith(`:${port}`))
  .map(cols => ({ address: cols[1], pid: Number(cols[4]) }))

const inPage = (handle, code) => evalIn(handle, 0, code).catch(() => null)

async function finishWizard(t, handle) {
  await waitFor(async () => (await inPage(handle, `document.querySelector('.hs-card h1')?.textContent`)) === 'Set up your hub', 'the first-run wizard', 30_000)
  t.diagnostic('the first-run wizard is showing')
  for (let step = 1; step <= 4; step += 1) {
    await waitFor(async () => (await inPage(handle, `document.querySelector('.hs-steps')?.textContent`)) === `Step ${step} of 4`, `wizard step ${step}`)
    await inPage(handle, `document.querySelector('.hs-btn.go').click(); 1`)
  }
  await waitFor(async () => (await inPage(handle, `window.HUB_CONF.needsSetup === false && !document.getElementById('hub-setup')`)) === true, 'the page after the wizard', 20_000)
}

// Everything both runs have to show. `hubDir` is where the app is running the Hub from.
async function exercise(t, handle, port, hubDir) {
  const main = await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the real Hub in the main window', 60_000)
  t.diagnostic(`main window ${main.url}`)
  assert.equal(await ping(port), true)
  assert.equal(main.title, APP_NAME, 'the window has the app name, whatever the Hub calls itself')

  const before = listeners(port)
  t.diagnostic(`listening: ${JSON.stringify(before)}`)
  assert.ok(before.length > 0)
  assert.ok(before.every(({ address }) => address.startsWith('127.0.0.1:')), 'this computer only')
  const appPid = await handle.app.evaluate(() => process.pid)
  assert.ok(!before.some(({ pid }) => pid === appPid), 'the Hub is its own process, not the app')

  // The Hub's own write check still stands, from outside the page.
  const clone = fs.existsSync(path.join(REPO, 'config'))
  const refused = await fetch(`http://localhost:${port}/api/hub/setup`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })
  t.diagnostic(`POST with no x-hub: ${refused.status} ${await refused.text()}`)
  assert.equal(refused.status, 403)
  assert.equal(fs.existsSync(path.join(hubDir, 'config', 'hub.json')), false)
  assert.equal((await getJson(port, '/api/hub/setup')).needsSetup, true, 'a new install runs the wizard')

  await finishWizard(t, handle)
  assert.equal((await getJson(port, '/api/hub/setup')).needsSetup, false)
  assert.ok(fs.existsSync(path.join(hubDir, 'config', 'hub.json')), 'the answers are saved beside the running Hub')
  assert.equal(fs.existsSync(path.join(REPO, 'config')), clone, 'nothing landed in this clone')
  t.diagnostic(`wizard finished, config in the run folder (${fs.readdirSync(path.join(hubDir, 'config')).join(', ')})`)

  // A crash of the real server: the app brings it back and the page reaches it.
  const { pid } = before[0]
  process.kill(pid)
  await waitFor(() => { const now = listeners(port); return now.length && now[0].pid !== pid }, 'a replacement Hub', 45_000)
  const replacement = listeners(port)[0].pid
  t.diagnostic(`killed Hub ${pid}, the app started ${replacement}`)
  await waitFor(async () => (await inPage(handle, `fetch('/api/hub/setup').then(r => r.json()).then(j => j.needsSetup)`)) === false, 'the page to reach the new Hub with the same config', 30_000)
  assert.equal((await windows(handle))[0].url.startsWith(`http://localhost:${port}/`), true)
  return replacement
}

async function quitAndCheck(handle, port, pid) {
  await quit(handle)
  await waitFor(async () => !(await ping(port)), 'the port to go quiet', 8000)
  await waitFor(() => !processAlive(pid), 'the Hub to be gone', 8000)
  assert.deepEqual(listeners(port), [])
}

// Starts a helper the way the Hub's assistant does: process.execPath, the script, a bare environment.
function askHelper(script, env) {
  return new Promise((resolve, reject) => {
    const helper = spawn(PACKAGED_EXE, [script], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    let err = ''
    const finish = (fn, value) => {
      clearTimeout(timer)
      spawnSync('taskkill.exe', ['/PID', String(helper.pid), '/T', '/F'], { windowsHide: true })
      fn(value)
    }
    const timer = setTimeout(() => finish(reject, new Error(`no reply from ${path.basename(script)}: ${out} ${err}`)), 30_000)
    helper.stderr.on('data', chunk => { err += chunk })
    helper.stdout.on('data', chunk => {
      out += chunk
      const line = out.split('\n').find(text => text.includes('"id":1'))
      if (line) finish(resolve, JSON.parse(line))
    })
    helper.on('error', error => finish(reject, error))
    helper.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } })}\n`)
  })
}

// Holds a port the way another program would. 'silent' takes connections and says nothing. 'resetting'
// drops each one, so a check sees an empty port and starts a Hub, which then can't get the port.
async function holdPort(t, port, kind) {
  const sockets = new Set()
  const server = net.createServer(socket => {
    socket.on('error', () => {})
    if (kind === 'resetting') socket.resetAndDestroy()
    else sockets.add(socket)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const release = () => new Promise(resolve => {
    if (!server.listening) return resolve()
    sockets.forEach(socket => socket.destroy())
    server.close(resolve)
  })
  cleanup(t, release)
  return release
}

// The app's own Hub processes, found by what they run. handle.pid can be a shell wrapper around the app.
const hubChildren = async handle => {
  const appPid = await handle.app.evaluate(() => process.pid)
  const { stdout } = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
    input: `Get-CimInstance Win32_Process -Filter "ParentProcessId=${appPid}" | Where-Object { $_.CommandLine -like '*hub-runner*' } | ForEach-Object { $_.ProcessId }\n`,
    encoding: 'utf8',
    windowsHide: true,
  })
  return stdout.split(/\s+/).filter(Boolean).map(Number)
}

const hubLog = userData => {
  try { return fs.readFileSync(path.join(userData, 'logs', 'hub.log'), 'utf8') } catch { return '' }
}

const onHub = port => url => url.startsWith(`http://localhost:${port}/`)
const offlineReason = url => (url.includes('offline.html') ? new URL(url).searchParams.get('reason') : null)

describe('a port that is already taken', () => {
  async function start(t, port) {
    const hubDir = copyHub(t)
    const userData = makeUserData({ port })
    cleanup(t, () => removeUserData(userData))
    const handle = await launch({ userData, args: ['--hidden'], env: { LOCAL_HUB_SERVER: path.join(hubDir, 'server.mjs') } })
    cleanup(t, () => quit(handle).catch(() => {}))
    return { handle, userData }
  }

  // The Hub is alive and logged the error, but isn't listening and never will be.
  async function stuckChild(t, handle, userData, port) {
    await waitFor(() => hubLog(userData).includes('EADDRINUSE') && hubLog(userData).includes(String(port)), 'the Hub to lose the port', 60_000)
    const [stuck] = await hubChildren(handle)
    t.diagnostic(`Hub ${stuck} is alive without the port: ${hubLog(userData).trim().split(/\r?\n/).find(line => line.includes('EADDRINUSE'))}`)
    assert.ok(processAlive(stuck))
    assert.equal(await ping(port), false)
    return stuck
  }

  async function recovers(t, handle, port, stuck) {
    const freedAt = Date.now()
    await waitForUrl(handle, 0, onHub(port), 'the Hub once the port is free', 120_000)
    t.diagnostic(`back ${Math.round((Date.now() - freedAt) / 1000)} s after the port came free`)
    assert.equal(await ping(port), true)
    const now = listeners(port)
    assert.ok(now.length > 0)
    assert.ok(now.every(({ address }) => address.startsWith('127.0.0.1:')), 'this computer only')
    if (stuck) {
      assert.equal(processAlive(stuck), false, 'the stuck Hub was stopped')
      assert.notEqual(now[0].pid, stuck)
    }
    assert.deepEqual(await hubChildren(handle), [now[0].pid], 'one Hub, and it is the one listening')
    return now[0].pid
  }

  test('something silent on the port: no Hub starts, the page says so, and it recovers when it leaves', async t => {
    const port = await freePort()
    const release = await holdPort(t, port, 'silent')
    const { handle, userData } = await start(t, port)
    await waitForUrl(handle, 0, url => offlineReason(url) === 'port-silent', 'the port-in-use page', 30_000)
    assert.match(await evalIn(handle, 0, `document.getElementById('detail').textContent`), /holding port/)
    assert.deepEqual(await hubChildren(handle), [], 'nothing pointless started')
    await release()
    const pid = await recovers(t, handle, port, null)
    assert.equal(hubLog(userData).includes('EADDRINUSE'), false)
    await quitAndCheck(handle, port, pid)
  })

  test('a Hub that lost the port is replaced once the port is free', async t => {
    const port = await freePort()
    const release = await holdPort(t, port, 'resetting')
    const { handle, userData } = await start(t, port)
    const stuck = await stuckChild(t, handle, userData, port)
    await release()
    const pid = await recovers(t, handle, port, stuck)
    await quitAndCheck(handle, port, pid)
  })

  test('changing to a port that is taken recovers the same way', async t => {
    const port = await freePort()
    const { handle, userData } = await start(t, port)
    await waitForUrl(handle, 0, onHub(port), 'the Hub on the first port', 60_000)
    const port2 = await freePort()
    const release = await holdPort(t, port2, 'resetting')
    await trayItem(handle, 'settings')
    await waitFor(async () => {
      const list = await windows(handle)
      return list.length === 3 && !list[2].loading && list[2].url.endsWith('settings.html')
    }, 'the settings page')
    assert.deepEqual(await evalIn(handle, 2, `window.hubDesktop.saveSettings({ port: ${port2} })`), { ok: true })
    const stuck = await stuckChild(t, handle, userData, port2)
    assert.deepEqual(listeners(port), [], 'the first port is free again')
    await release()
    const pid = await recovers(t, handle, port2, stuck)
    await quitAndCheck(handle, port2, pid)
  })
})

describe('the real Hub server', () => {
  test('from source: first run, write check, wizard, crash recovery and quit', async t => {
    const port = await freePort()
    const hubDir = copyHub(t)
    const userData = makeUserData({ port })
    cleanup(t, () => removeUserData(userData))
    const handle = await launch({ userData, args: ['--hidden'], env: { LOCAL_HUB_SERVER: path.join(hubDir, 'server.mjs') } })
    cleanup(t, () => quit(handle).catch(() => {}))
    const pid = await exercise(t, handle, port, hubDir)
    await quitAndCheck(handle, port, pid)
  })

  test('packaged: runs what the installer ships, with helpers working', async t => {
    if (!fs.existsSync(PACKAGED_EXE)) return t.skip('no build at dist/win-unpacked (could not check; not a pass)')
    for (const name of ['server.mjs', 'chat-tools.mjs', 'browser-mcp.mjs', 'index.html', 'config.example']) assert.ok(fs.existsSync(path.join(SHIPPED, name)), `ships ${name}`)
    for (const name of ['desktop', '.git', 'config', 'data', 'workspace', 'node_modules', 'start-hidden.vbs', 'start.sh', 'restart.ps1', 'restart.sh']) assert.equal(fs.existsSync(path.join(SHIPPED, name)), false, `doesn't ship ${name}`)

    const port = await freePort()
    const userData = makeUserData({ port })
    cleanup(t, () => removeUserData(userData))
    const handle = await launch({ userData, packaged: true, args: ['--hidden'] })
    cleanup(t, () => quit(handle).catch(() => {}))
    const hubDir = path.join(userData, 'hub')
    const pid = await exercise(t, handle, port, hubDir)
    assert.ok(fs.existsSync(path.join(hubDir, BUNDLE_MARKER)))

    for (const [script, env] of [['chat-tools.mjs', { HUB_PORT: String(port) }], ['browser-mcp.mjs', { HUB_URL: `http://127.0.0.1:${port}` }]]) {
      const reply = await askHelper(path.join(hubDir, script), env)
      t.diagnostic(`${script} answered: ${JSON.stringify(reply.result?.serverInfo)}`)
      assert.ok(reply.result?.serverInfo, `${script} speaks MCP through the app's own exe`)
    }
    await quitAndCheck(handle, port, pid)
  })
})
