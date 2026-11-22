// Attach mode, bundled mode and recovery, in the real app against real processes.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import { HubConnection, probeHub } from '../../src/hub-connection.js'
import {
  PACKAGED_EXE, STUB_SERVER, cleanup, copyHub, evalIn, freePort, getJson, launch, makeUserData, ping, processAlive, quit, removeUserData,
  runKey, sleep, startExternalStub, stopExternalStub, waitFor, waitForUrl, windows,
} from '../helpers.mjs'

const isOffline = url => url.includes('/pages/offline.html')
const reasonOf = url => new URL(url).searchParams.get('reason')

let runKeyBefore
before(() => { runKeyBefore = runKey() })
after(() => assert.equal(runKey(), runKeyBefore, 'the login items in the registry must not change'))

describe('attach mode', () => {
  test('attaches to a Hub that is already running, and quitting leaves it running', async t => {
    const port = await freePort()
    const external = await startExternalStub(port)
    const userData = makeUserData({ port })
    cleanup(t, async () => { await stopExternalStub(external); removeUserData(userData) })
    const before = await getJson(port, '/api/pid')

    const handle = await launch({ userData })
    cleanup(t, () => quit(handle).catch(() => {}))
    const main = await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub in the main window')
    t.diagnostic(`main window: ${main.url}`)
    assert.equal(await evalIn(handle, 0, `document.getElementById('marker').textContent`), `stub hub on ${port}`)

    await quit(handle)
    assert.equal(await ping(port), true, 'the Hub still answers after quit')
    const afterQuit = await getJson(port, '/api/pid')
    assert.equal(afterQuit.pid, before.pid, 'the same process, not a replacement')
    t.diagnostic(`hub pid before ${before.pid}, after quit ${afterQuit.pid}`)
  })

  test('another program on the port is not attached to and no Hub is started', async t => {
    const port = await freePort()
    let hits = 0
    const other = http.createServer((req, res) => { hits += 1; res.end('<html>some other app</html>') })
    await new Promise(resolve => other.listen(port, '127.0.0.1', resolve))
    const userData = makeUserData({ port })
    const stub = STUB_SERVER
    cleanup(t, async () => { other.closeAllConnections(); other.close(); removeUserData(userData) })

    const handle = await launch({ userData, env: { LOCAL_HUB_SERVER: stub } })
    cleanup(t, () => quit(handle).catch(() => {}))
    const main = await waitForUrl(handle, 0, url => isOffline(url) && reasonOf(url) === 'port-conflict', 'the port conflict page')
    assert.match(await evalIn(handle, 0, `document.getElementById('detail').textContent`), /isn't a Hub/)
    t.diagnostic(`main window: ${new URL(main.url).search}`)
    assert.ok(hits > 0, 'the probe reached that program')
    assert.equal(await probeHub(port), 'other')
  })
})

describe('bundled mode', () => {
  test('starts the bundled server, recovers from a crash, and quit stops it and its children', async t => {
    const port = await freePort()
    const userData = makeUserData({ port })
    cleanup(t, () => removeUserData(userData))
    const handle = await launch({ userData, env: { LOCAL_HUB_SERVER: STUB_SERVER, STUB_GRANDCHILD: '1' } })
    cleanup(t, () => quit(handle).catch(() => {}))

    await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the bundled Hub in the main window')
    const first = await getJson(port, '/api/pid')
    t.diagnostic(`bundled hub pid ${first.pid}, its child ${first.grandchild}, app pid ${handle.pid}`)
    assert.equal(first.port, port, 'started on the configured port')
    assert.notEqual(first.pid, handle.pid)
    assert.ok(processAlive(first.grandchild))

    // The crash: the Hub dies with no warning, and the app has to notice and bring it back.
    process.kill(first.pid)
    await waitFor(async () => {
      const now = await getJson(port, '/api/pid').catch(() => null)
      return now && now.pid !== first.pid
    }, 'a replacement Hub process')
    const second = await getJson(port, '/api/pid')
    t.diagnostic(`after the crash the app started pid ${second.pid}`)
    // The page stays up through it and is now talking to the new process.
    await waitFor(async () => (await evalIn(handle, 0, `fetch('/api/pid').then(r => r.json()).then(j => j.pid)`).catch(() => null)) === second.pid, 'the page to reach the new Hub')
    assert.equal(await evalIn(handle, 0, `document.getElementById('marker').textContent`), `stub hub on ${port}`)
    // A hard kill orphans the old Hub's child, as it would for any process. This test made the kill, so it tidies up.
    if (processAlive(first.grandchild)) process.kill(first.grandchild)

    await quit(handle)
    await waitFor(async () => !(await ping(port)), 'the port to go quiet', 5000)
    await waitFor(() => !processAlive(second.pid) && !processAlive(second.grandchild), 'the Hub and its child to be gone', 5000)
    t.diagnostic(`after quit: hub ${second.pid} alive=${processAlive(second.pid)}, child ${second.grandchild} alive=${processAlive(second.grandchild)}`)
  })

  test('a missing server shows a clear page instead of a blank window', async t => {
    const port = await freePort()
    const userData = makeUserData({ port })
    cleanup(t, () => removeUserData(userData))
    const handle = await launch({ userData, env: { LOCAL_HUB_SERVER: 'C:\\does\\not\\exist.mjs' } })
    cleanup(t, () => quit(handle).catch(() => {}))
    await waitForUrl(handle, 0, url => isOffline(url) && reasonOf(url) === 'no-server', 'the no-server page')
    assert.equal(await evalIn(handle, 0, `document.getElementById('title').textContent`), 'No Hub found')
  })

  test('a start in the tray waits for a Hub at login, and attaches if one turns up', async t => {
    const port = await freePort()
    const userData = makeUserData({ port })
    let external
    cleanup(t, async () => { await stopExternalStub(external); removeUserData(userData) })
    const handle = await launch({ userData, args: ['--hidden'], env: { LOCAL_HUB_SERVER: STUB_SERVER } })
    cleanup(t, () => quit(handle).catch(() => {}))
    await sleep(2500)
    assert.equal(await ping(port), false, 'no Hub started during the grace')
    external = await startExternalStub(port)
    const main = await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'attached Hub')
    assert.equal(main.visible, false, 'stays hidden in the tray')
    const pid = await getJson(port, '/api/pid')
    assert.equal(pid.pid, external.pid, 'the Hub answering is the one started elsewhere')
  })
})

describe('Hub restart', () => {
  test('a quick restart keeps the page, a long one shows the reconnecting page, and it comes back', async t => {
    const port = await freePort()
    let external = await startExternalStub(port)
    const userData = makeUserData({ port })
    cleanup(t, async () => { await stopExternalStub(external); removeUserData(userData) })
    const handle = await launch({ userData })
    cleanup(t, () => quit(handle).catch(() => {}))
    await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub')
    await evalIn(handle, 0, `(location.hash = 'keep-me', window.__typed = 'still here', true)`)

    // Quick: back within the grace, nothing reloads and the page's own state survives.
    await stopExternalStub(external)
    await waitFor(async () => !(await ping(port)), 'the Hub to stop')
    await sleep(2500)
    assert.equal(await evalIn(handle, 0, 'window.__typed'), 'still here', 'the page stays during a short outage')
    external = await startExternalStub(port)
    await sleep(2500)
    assert.equal(await evalIn(handle, 0, 'window.__typed'), 'still here', 'and is not reloaded when the Hub returns')

    // Long: the page says what's happening.
    await stopExternalStub(external)
    const offline = await waitForUrl(handle, 0, isOffline, 'the reconnecting page', 20_000)
    assert.equal(reasonOf(offline.url), 'hub-stopped')
    const text = await evalIn(handle, 0, `document.body.innerText`)
    t.diagnostic(`while down the window shows: ${JSON.stringify(text)}`)
    assert.match(text, /Waiting for your Hub/)
    const bundledVisible = await evalIn(handle, 0, `!document.getElementById('bundled').hidden`)
    assert.equal(bundledVisible, true, 'offers the built-in Hub for an attached one that went away')

    external = await startExternalStub(port)
    const back = await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub to return')
    assert.equal(new URL(back.url).hash, '#keep-me', 'returns to where it was')
    assert.equal(await evalIn(handle, 0, `document.getElementById('marker').textContent`), `stub hub on ${port}`)
  })

  test('a reload while the Hub is down never lands on an error page', async t => {
    const port = await freePort()
    let external = await startExternalStub(port)
    const userData = makeUserData({ port })
    cleanup(t, async () => { await stopExternalStub(external); removeUserData(userData) })
    const handle = await launch({ userData })
    cleanup(t, () => quit(handle).catch(() => {}))
    await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub')
    await stopExternalStub(external)
    await waitFor(async () => !(await ping(port)), 'the Hub to stop')

    await handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].webContents.reload())
    await waitForUrl(handle, 0, isOffline, 'the local page, not chrome-error', 8000)
    const seen = (await windows(handle))[0].url
    assert.equal(seen.startsWith('chrome-error'), false)
    external = await startExternalStub(port)
    await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub to return')
  })

  test('the renderer crashing reloads the Hub', async t => {
    const port = await freePort()
    const external = await startExternalStub(port)
    const userData = makeUserData({ port })
    cleanup(t, async () => { await stopExternalStub(external); removeUserData(userData) })
    const handle = await launch({ userData })
    cleanup(t, () => quit(handle).catch(() => {}))
    await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub')
    await evalIn(handle, 0, `(window.__before = true)`)
    await handle.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].webContents.forcefullyCrashRenderer() })
    await waitFor(async () => {
      const crashed = await handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].webContents.isCrashed())
      if (crashed) return false
      return (await evalIn(handle, 0, `Boolean(document.getElementById('marker')) && !window.__before`).catch(() => false))
    }, 'the page to reload after the crash')
  })
})

// A real Hub the app didn't start: a scratch copy with no config, so nothing here reaches a Hub already on
// this computer. To check against a running one, set LOCAL_HUB_TEST_HUB_PORT to its port. The app reaches
// it through a proxy that refuses anything but GET and HEAD, so nothing the page does can change it.
describe('a real Hub started apart from the app', () => {
  const startOtherHub = async t => {
    const given = Number(process.env.LOCAL_HUB_TEST_HUB_PORT)
    if (given) return given
    const dir = copyHub(t)
    const port = await freePort()
    const hub = spawn(process.execPath, [path.join(dir, 'server.mjs')], { cwd: dir, env: { ...process.env, HUB_PORT: String(port) }, stdio: 'ignore', windowsHide: true })
    cleanup(t, () => { spawnSync('taskkill.exe', ['/PID', String(hub.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) })
    await waitFor(() => ping(port), 'the scratch Hub to answer', 30_000)
    return port
  }

  test('the connection attaches, sends only pings, and leaves it running', async t => {
    const other = await startOtherHub(t)
    let spawned = 0
    let stops = 0
    const connection = new HubConnection({ port: other, spawnHub: () => { spawned += 1; return null }, stopTree: async () => { stops += 1 } })
    await connection.start()
    assert.deepEqual(connection.state, { status: 'online', mode: 'attached', reason: null })
    await connection.stop()
    assert.equal(spawned, 0)
    assert.equal(stops, 0)
    assert.equal(await ping(other), true)
  })

  const viewThroughProxy = async (t, launchOptions) => {
    const other = await startOtherHub(t)
    const port = await freePort()
    const refused = []
    const seen = []
    const proxy = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url.split('?')[0]}`)
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        refused.push(`${req.method} ${req.url.split('?')[0]}`)
        res.writeHead(403, { 'content-type': 'application/json' })
        return res.end('{"error":"read-only test proxy"}')
      }
      const upstream = http.request({ host: '127.0.0.1', port: other, path: req.url, method: req.method, headers: { ...req.headers, host: `localhost:${other}` } }, reply => {
        res.writeHead(reply.statusCode, reply.headers)
        reply.pipe(res)
      })
      upstream.on('error', () => { res.writeHead(502); res.end() })
      req.on('close', () => { if (!res.writableEnded) upstream.destroy() })
      upstream.end()
    })
    await new Promise(resolve => proxy.listen(port, '127.0.0.1', resolve))
    const userData = makeUserData({ port })
    cleanup(t, async () => { proxy.closeAllConnections(); proxy.close(); removeUserData(userData) })

    const handle = await launch({ userData, ...launchOptions, args: ['--hidden'] })
    cleanup(t, () => quit(handle).catch(() => {}))
    const main = await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the other Hub')
    await sleep(3000)
    const [{ title }, launcher] = await windows(handle)
    const textLength = await evalIn(handle, 0, `document.body.innerText.length`)
    t.diagnostic(`main window ${main.url}, title ${JSON.stringify(title)}, body text ${textLength} chars, requests ${seen.length}, writes refused ${refused.length}`)
    t.diagnostic(`launcher window on ${new URL(launcher.url).protocol} ${launcher.url.split('/').pop()}, visible ${launcher.visible}`)
    t.diagnostic(`routes refused: ${JSON.stringify([...new Set(refused)])}`)
    assert.ok(textLength > 0, 'the page has content')
    await quit(handle)
    assert.equal(await ping(other), true, 'the other Hub still answers')
  }

  test('the real Hub page renders in the app through a read-only proxy', async t => {
    await viewThroughProxy(t, {})
  })

  test('the real Hub page renders in the built app through a read-only proxy', async t => {
    if (!fs.existsSync(PACKAGED_EXE)) return t.skip('no build at dist/win-unpacked (could not check; not a pass)')
    await viewThroughProxy(t, { packaged: true })
  })
})
