// Quitting at rest and when things are slow or stuck: the CPU kept busy, a Hub stop that outlasts its limit,
// Electron stuck on its way out, a page stuck or refusing to unload. In each, the app has to be gone
// inside the limit and no Hub left behind. The tray quits go through the real menu item's click handler;
// the native menu popup would take over the desktop. A packaged app has no shim, so it quits through app.quit().
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { describe, test } from 'node:test'

import {
  PACKAGED_EXE, QUIT_LIMIT_MS, STUB_SERVER, cleanup, evalIn, freePort, getJson, launch, makeUserData, ping, processAlive, quit,
  removeUserData, sleep, trayItem, waitFor, waitForUrl,
} from '../helpers.mjs'

// A Hub goes with the app. Past this, the app has left it behind.
const LEFT_BEHIND_LIMIT_MS = 5000

// Four at most, because this may be a computer someone is working on. A loaded computer does worse than
// this, so the limits themselves are tested by making each step slow or stuck on purpose further down.
function burnCpu(t) {
  const burners = os.cpus().slice(0, 4).map(() => spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore', windowsHide: true }))
  const stop = () => burners.forEach(burner => burner.kill())
  cleanup(t, stop)
  return stop
}

async function startApp(t, { env = {}, packaged = false, args = [], again = null } = {}) {
  const port = again?.port ?? await freePort()
  const userData = again?.userData ?? makeUserData({ port })
  if (!again) cleanup(t, () => removeUserData(userData))
  const pids = []
  // Nothing here may outlive a failed test: the app and the Hub are ended by pid if they're still around.
  cleanup(t, async () => {
    for (const pid of pids) try { process.kill(pid) } catch {}
    await sleep(500)
  })
  const handle = await launch({ userData, packaged, args, env: { LOCAL_HUB_SERVER: STUB_SERVER, STUB_GRANDCHILD: '1', ...env } })
  pids.push(await handle.app.evaluate(() => process.pid))
  await waitFor(() => ping(port), 'the Hub to answer', 90_000)
  const { pid, grandchild } = await getJson(port, '/api/pid')
  pids.push(pid, grandchild)
  await sleep(1000)
  return { handle, port, userData, mainPid: pids[0], hubPid: pid, grandchild }
}

function describeProcess(pid) {
  const script = `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`
  const { stdout } = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], { input: script, encoding: 'utf8', windowsHide: true })
  return `${pid} ${stdout.trim()}`
}

// Times start from `from`, which is when Quit was pressed.
async function assertAllGone({ port, mainPid, hubPid, grandchild }, from, mainLimitMs = QUIT_LIMIT_MS) {
  await waitFor(() => !processAlive(mainPid), `the app to end within ${mainLimitMs / 1000} s`, mainLimitMs)
  const mainGone = Date.now() - from
  const left = () => [hubPid, grandchild].filter(processAlive)
  await waitFor(() => left().length === 0, 'no Hub or anything it started left behind', LEFT_BEHIND_LIMIT_MS).catch(error => {
    throw new Error(`${error.message}: ${left().map(describeProcess).join('; ')}`)
  })
  assert.equal(await ping(port), false)
  return { mainGone, allGone: Date.now() - from }
}

const pressQuit = handle => trayItem(handle, 'quit').catch(() => {})

describe('quitting', () => {
  test('at rest, a tray quit ends the app and leaves no Hub or anything it started behind', async t => {
    const app = await startApp(t)
    const from = Date.now()
    await pressQuit(app.handle)
    t.diagnostic(JSON.stringify(await assertAllGone(app, from, 10_000)))
  })

  test('with the CPU kept busy, a tray quit ends the app in time and leaves no Hub behind', async t => {
    const app = await startApp(t)
    const stopBurning = burnCpu(t)
    await sleep(2000)
    const from = Date.now()
    await pressQuit(app.handle)
    const times = await assertAllGone(app, from)
    stopBurning()
    t.diagnostic(JSON.stringify(times))
  })

  test('with the CPU kept busy, the built app ends in time too, with the real Hub and with a stub', async t => {
    if (!fs.existsSync(PACKAGED_EXE)) return t.skip('no build at dist/win-unpacked (could not check; not a pass)')
    const stub = await startApp(t, { packaged: true, args: ['--hidden'] })

    // A Hub's child must be its own small process and not a second copy of the app. That once opened a
    // real window on the default profile.
    const script = `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${stub.grandchild}" | Measure-Object).Count`
    const { stdout } = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], { input: script, encoding: 'utf8', windowsHide: true })
    assert.equal(stdout.trim(), '0')

    const stopBurning = burnCpu(t)
    await sleep(2000)
    let from = Date.now()
    await stub.handle.app.evaluate(({ app }) => { setImmediate(() => app.quit()) }).catch(() => {})
    t.diagnostic(`stub: ${JSON.stringify(await assertAllGone(stub, from))}`)
    stopBurning()

    // The real Hub starts with nothing to run from, in its first-run state, on a free port.
    const port = await freePort()
    const userData = makeUserData({ port })
    cleanup(t, () => removeUserData(userData))
    const handle = await launch({ userData, packaged: true, args: ['--hidden'] })
    const mainPid = await handle.app.evaluate(() => process.pid)
    const pids = [mainPid]
    cleanup(t, async () => { for (const pid of pids) try { process.kill(pid) } catch {} ; await sleep(500) })
    await waitFor(() => ping(port), 'the real Hub to answer', 90_000)
    const list = spawnSync('netstat.exe', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true }).stdout
    const hubPid = Number(list.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(cols => cols[3] === 'LISTENING' && cols[1]?.endsWith(`:${port}`))?.[4])
    assert.ok(hubPid > 0)
    pids.push(hubPid)
    const stopAgain = burnCpu(t)
    await sleep(2000)
    from = Date.now()
    await handle.app.evaluate(({ app }) => { setImmediate(() => app.quit()) }).catch(() => {})
    t.diagnostic(`real Hub: ${JSON.stringify(await assertAllGone({ port, mainPid, hubPid, grandchild: hubPid }, from))}`)
    stopAgain()
  })

  test('a Hub stop that outlasts the limit can\'t hold the app, and the Hub goes with it', async t => {
    // taskkill takes about 2 s, so with this limit the app always leaves first. What the Hub started can
    // stay in this one case, which the README says. This test's cleanup ends it.
    const app = await startApp(t, { env: { LOCAL_HUB_QUIT_LIMIT_MS: '1' } })
    const from = Date.now()
    await pressQuit(app.handle)
    await waitFor(() => !processAlive(app.mainPid), 'the app to end', 10_000)
    t.diagnostic(`app gone after ${Date.now() - from} ms`)
    await waitFor(() => !processAlive(app.hubPid), 'the Hub to go with the app', LEFT_BEHIND_LIMIT_MS)
    assert.equal(await ping(app.port), false)
  })

  test('Electron stuck on its way out is ended from outside, and the page\'s saved data survives', async t => {
    const app = await startApp(t)
    const { handle, port } = app
    await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub page')
    await evalIn(handle, 0, `localStorage.setItem('quit-test', 'kept')`)
    await handle.app.evaluate(({ app: electronApp }) => {
      electronApp.exit = () => { for (;;) {} }
    })
    const from = Date.now()
    await pressQuit(handle)
    const times = await assertAllGone(app, from)
    t.diagnostic(JSON.stringify(times))
    assert.ok(times.mainGone >= 4000, `ended by the guard, not by itself: ${times.mainGone} ms`)

    // The same port comes back from the saved settings, so this is the same origin and the same storage.
    const again = await startApp(t, { again: app })
    await waitForUrl(again.handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub page')
    assert.equal(await evalIn(again.handle, 0, `localStorage.getItem('quit-test')`), 'kept')
    await quit(again.handle)
  })

  test('a page that refuses to unload can\'t stop the app quitting', async t => {
    const app = await startApp(t)
    const { handle, port } = app
    await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub page')
    await evalIn(handle, 0, `window.addEventListener('beforeunload', event => { event.preventDefault(); event.returnValue = 'no' }); true`)
    const from = Date.now()
    await pressQuit(handle)
    t.diagnostic(JSON.stringify(await assertAllGone(app, from, 10_000)))
  })

  test('a page stuck in a loop can\'t stop the app quitting', async t => {
    const app = await startApp(t)
    const { handle, port } = app
    await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub page')
    await evalIn(handle, 0, `setTimeout(() => { for (;;) {} }, 0); true`)
    await sleep(300)
    const from = Date.now()
    await pressQuit(handle)
    t.diagnostic(JSON.stringify(await assertAllGone(app, from, 10_000)))
  })
})
