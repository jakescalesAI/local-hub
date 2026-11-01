// The real Hub server from this repo, started by the app the way a new user's install starts it: no
// config, so the first-run wizard, in a temp folder so nothing lands in this clone. The from-source run
// uses a copy of the repo; the packaged run uses what the installer ships. Run `npm run dist` for that.
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'

import { APP_NAME } from '../../src/app-name.js'
import { BUNDLE_MARKER } from '../../src/as-node.js'
import {
  APP_DIR, PACKAGED_EXE, cleanup, evalIn, freePort, getJson, launch, makeUserData, ping, processAlive, quit, removeUserData,
  waitFor, waitForUrl, windows,
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
  assert.ok(!before.some(({ pid }) => pid === handle.pid), 'the Hub is its own process, not the app')

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
