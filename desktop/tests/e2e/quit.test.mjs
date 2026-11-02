// Quitting at rest and when things are slow or stuck: the CPU kept busy, a Hub stop that outlasts its limit,
// Electron stuck on its way out, a page stuck or refusing to unload. In each, the app has to be gone
// inside the limit and no Hub left behind. The tray quits go through the real menu item's click handler;
// the native menu popup would take over the desktop. A packaged app has no shim, so it quits through app.quit().
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'

import {
  PACKAGED_EXE, QUIT_LIMIT_MS, STUB_SERVER, cleanup, evalIn, freePort, getJson, launch, makeUserData, ping, processAlive, quit,
  removeUserData, sleep, trayItem, waitFor, waitForUrl,
} from '../helpers.mjs'

// A Hub goes with the app. Past this, the app has left it behind.
const LEFT_BEHIND_LIMIT_MS = 5000
// Under load the app sees its Hub go in under a second, and can take a few more to start the guard. Sitting
// out the limit takes over 11 s.
const HUB_NOTICED_LIMIT_MS = 8000

const powershell = script => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], { input: script, encoding: 'utf8', windowsHide: true }).stdout.trim()

// This may be a computer someone is working on, so the app and the burners share two cores and the rest
// stay free. That's a real load for the app: a quit takes 10 to 20 s this way and 2 to 3 s with the same
// burners spread out. What this process starts inherits the cores, so call this before starting anything.
function keepToTwoCores(t) {
  const affinity = value => powershell(`$p = Get-Process -Id ${process.pid}; ${value ? `$p.ProcessorAffinity = ${value}; ` : ''}$p.ProcessorAffinity`)
  const all = BigInt(affinity())
  const cores = [...Array(64).keys()].map(BigInt).filter(core => (all >> core) & 1n)
  affinity((1n << cores.at(-1)) | (1n << cores.at(-2)))
  cleanup(t, () => affinity(all))
}

function burnCpu(t) {
  const burners = [1, 2, 3, 4].map(() => spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore', windowsHide: true }))
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

const describeProcess = pid => `${pid} ${powershell(`(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`)}`

// Times start from `from`, which is when Quit was pressed.
async function assertAllGone({ port, mainPid, hubPid, grandchild }, from, mainLimitMs = QUIT_LIMIT_MS) {
  let hubGone
  const watching = setInterval(() => { if (!hubGone && !processAlive(hubPid)) hubGone = Date.now() - from }, 100)
  await waitFor(() => !processAlive(mainPid), `the app to end within ${mainLimitMs / 1000} s`, mainLimitMs).catch(error => {
    clearInterval(watching)
    throw error
  })
  const mainGone = Date.now() - from
  const left = () => [hubPid, grandchild].filter(processAlive)
  await waitFor(() => left().length === 0, 'no Hub or anything it started left behind', LEFT_BEHIND_LIMIT_MS).catch(error => {
    clearInterval(watching)
    throw new Error(`${error.message}: ${left().map(describeProcess).join('; ')}`)
  })
  clearInterval(watching)
  assert.equal(await ping(port), false)
  return { hubGone, mainGone, allGone: Date.now() - from }
}

// The app has to go on as soon as its Hub has gone. Under load the exit event can come many seconds late,
// and the app once sat out its whole 15 s limit in about half of all quits, with the Hub gone after 3 to 4 s.
// So this marks when it goes on.
const hubWaitMark = userData => path.join(userData, 'hub-wait-ended.txt')

const markWhenHubWaitEnds = (handle, userData) => handle.app.evaluate(({ app }, file) => {
  const exit = app.exit.bind(app)
  app.exit = code => { process.getBuiltinModule('fs').writeFileSync(file, String(Date.now())); exit(code) }
}, hubWaitMark(userData))

function assertWentOnWithTheHub(userData, from, { hubGone }) {
  const wentOn = Number(fs.readFileSync(hubWaitMark(userData), 'utf8')) - from
  assert.ok(wentOn - hubGone < HUB_NOTICED_LIMIT_MS, `the Hub went at ${hubGone} ms, and the app went on at ${wentOn} ms`)
  return wentOn
}

const pressQuit = handle => trayItem(handle, 'quit').catch(() => {})

// The Hub's watcher closes the browser after 30 s of silence from the Hub, checking every 5 s.
const BROWSER_GONE_LIMIT_MS = 60_000

// Everything a packaged app on this profile has running: app, Hub, browser and the browser's watcher.
function running(userData) {
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -ne 'powershell.exe' -and $_.CommandLine -like '*${path.basename(userData)}*' } | ForEach-Object { '' + $_.ProcessId + ' ' + $_.Name }`
  return powershell(script).split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

function endWhatIsLeft(t, userData) {
  cleanup(t, async () => {
    for (const line of running(userData)) try { process.kill(Number(line.split(' ')[0])) } catch {}
    await sleep(1000)
  })
}

// Headless, on a profile inside the test's own folder, so nothing shows and no real sign-ins are near it.
async function openBrowser(port) {
  const res = await fetch(`http://localhost:${port}/api/browser/act`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub': '1' },
    body: JSON.stringify({ act: 'open', url: `http://localhost:${port}/api/ping` }),
    signal: AbortSignal.timeout(60_000),
  })
  return { ok: res.ok, text: await res.text() }
}

const browserRunning = userData => running(userData).some(line => /chrome|msedge/i.test(line))

async function allGoneWithin(userData, ms, from) {
  await waitFor(() => running(userData).length === 0, 'nothing of this profile left', ms).catch(error => {
    throw new Error(`${error.message}: ${running(userData).join('; ')}`)
  })
  return Date.now() - from
}

describe('quitting', () => {
  test('at rest, a tray quit ends the app and leaves no Hub or anything it started behind', async t => {
    const app = await startApp(t)
    const from = Date.now()
    await pressQuit(app.handle)
    t.diagnostic(JSON.stringify(await assertAllGone(app, from, 10_000)))
  })

  test('with the CPU kept busy, a tray quit ends the app in time and leaves no Hub behind', async t => {
    keepToTwoCores(t)
    const app = await startApp(t)
    await markWhenHubWaitEnds(app.handle, app.userData)
    const stopBurning = burnCpu(t)
    await sleep(2000)
    const from = Date.now()
    await pressQuit(app.handle)
    const times = await assertAllGone(app, from)
    stopBurning()
    t.diagnostic(JSON.stringify({ ...times, wentOn: assertWentOnWithTheHub(app.userData, from, times) }))
  })

  test('with the CPU kept busy, the built app ends in time too, with the real Hub and with a stub', async t => {
    if (!fs.existsSync(PACKAGED_EXE)) return t.skip('no build at dist/win-unpacked (could not check; not a pass)')
    keepToTwoCores(t)
    const stub = await startApp(t, { packaged: true, args: ['--hidden'] })

    // A Hub's child must be its own small process and not a second copy of the app. That once opened a
    // real window on the default profile.
    assert.equal(powershell(`(Get-CimInstance Win32_Process -Filter "ParentProcessId=${stub.grandchild}" | Measure-Object).Count`), '0')

    await markWhenHubWaitEnds(stub.handle, stub.userData)
    const stopBurning = burnCpu(t)
    await sleep(2000)
    let from = Date.now()
    await stub.handle.app.evaluate(({ app }) => { setImmediate(() => app.quit()) }).catch(() => {})
    const stubTimes = await assertAllGone(stub, from)
    t.diagnostic(`stub: ${JSON.stringify({ ...stubTimes, wentOn: assertWentOnWithTheHub(stub.userData, from, stubTimes) })}`)
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
    await markWhenHubWaitEnds(handle, userData)
    const stopAgain = burnCpu(t)
    await sleep(2000)
    from = Date.now()
    await handle.app.evaluate(({ app }) => { setImmediate(() => app.quit()) }).catch(() => {})
    const hubTimes = await assertAllGone({ port, mainPid, hubPid, grandchild: hubPid }, from)
    t.diagnostic(`real Hub: ${JSON.stringify({ ...hubTimes, wentOn: assertWentOnWithTheHub(userData, from, hubTimes) })}`)
    stopAgain()
  })

  test('the built app with the browser open: a quit ends the browser too', async t => {
    if (!fs.existsSync(PACKAGED_EXE)) return t.skip('no build at dist/win-unpacked (could not check; not a pass)')
    const port = await freePort()
    const userData = makeUserData({ port })
    cleanup(t, () => removeUserData(userData))
    endWhatIsLeft(t, userData)
    const handle = await launch({ userData, packaged: true, args: ['--hidden'] })
    await waitFor(() => ping(port), 'the real Hub to answer', 90_000)
    const opened = await openBrowser(port)
    if (!opened.ok && /chrome|edge/i.test(opened.text)) return t.skip(`no browser to open (could not check; not a pass): ${opened.text}`)
    assert.ok(opened.ok, opened.text)
    assert.ok(browserRunning(userData))
    const from = Date.now()
    await handle.app.evaluate(({ app }) => { setImmediate(() => app.quit()) }).catch(() => {})
    t.diagnostic(`all gone after ${await allGoneWithin(userData, QUIT_LIMIT_MS, from)} ms`)
  })

  test('the built app crashing with the browser open: the Hub goes at once and the browser soon after', async t => {
    if (!fs.existsSync(PACKAGED_EXE)) return t.skip('no build at dist/win-unpacked (could not check; not a pass)')
    const port = await freePort()
    const userData = makeUserData({ port })
    cleanup(t, () => removeUserData(userData))
    endWhatIsLeft(t, userData)
    // Started directly, because Playwright has its own way of ending what it started.
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const app = spawn(PACKAGED_EXE, [`--user-data-dir=${userData}`, '--hidden'], { env, stdio: 'ignore', windowsHide: true })
    await waitFor(() => ping(port), 'the real Hub to answer', 90_000)
    const opened = await openBrowser(port)
    if (!opened.ok && /chrome|edge/i.test(opened.text)) return t.skip(`no browser to open (could not check; not a pass): ${opened.text}`)
    assert.ok(opened.ok, opened.text)
    assert.ok(browserRunning(userData))
    const from = Date.now()
    process.kill(app.pid, 'SIGKILL')
    await waitFor(async () => !await ping(port), 'the Hub to stop answering', 5000)
    t.diagnostic(`at the crash: ${running(userData).join('; ')}`)
    t.diagnostic(`all gone after ${await allGoneWithin(userData, BROWSER_GONE_LIMIT_MS, from)} ms`)
  })

  test('the built app restarted after a crash picks the browser up, and then a quit still ends it', async t => {
    if (!fs.existsSync(PACKAGED_EXE)) return t.skip('no build at dist/win-unpacked (could not check; not a pass)')
    const port = await freePort()
    const userData = makeUserData({ port })
    cleanup(t, () => removeUserData(userData))
    endWhatIsLeft(t, userData)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const app = spawn(PACKAGED_EXE, [`--user-data-dir=${userData}`, '--hidden'], { env, stdio: 'ignore', windowsHide: true })
    await waitFor(() => ping(port), 'the real Hub to answer', 90_000)
    const opened = await openBrowser(port)
    if (!opened.ok && /chrome|edge/i.test(opened.text)) return t.skip(`no browser to open (could not check; not a pass): ${opened.text}`)
    assert.ok(opened.ok, opened.text)
    process.kill(app.pid, 'SIGKILL')
    await waitFor(async () => !await ping(port), 'the Hub to stop answering', 5000)

    const handle = await launch({ userData, packaged: true, args: ['--hidden'] })
    await waitFor(() => ping(port), 'the real Hub to answer again', 90_000)
    assert.ok((await openBrowser(port)).ok)
    const from = Date.now()
    await handle.app.evaluate(({ app: electronApp }) => { setImmediate(() => electronApp.quit()) }).catch(() => {})
    await waitFor(async () => !await ping(port), 'the Hub to go', QUIT_LIMIT_MS)
    t.diagnostic(`after the quit: ${running(userData).join('; ')}`)
    t.diagnostic(`all gone after ${await allGoneWithin(userData, BROWSER_GONE_LIMIT_MS, from)} ms`)
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

    // By now Chromium has saved the write by itself, so this doesn't show the flush. The tests below do.
    // The same port comes back from the saved settings, so this is the same origin and the same storage.
    const again = await startApp(t, { again: app })
    await waitForUrl(again.handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub page')
    assert.equal(await evalIn(again.handle, 0, `localStorage.getItem('quit-test')`), 'kept')
    await quit(again.handle)
  })

  // Chromium holds a page's writes back for a few seconds before they reach the disk, so a hard end in that
  // time loses them. This reads the disk, because a restart can't tell: under Playwright a Hub outlives a
  // hard end by many seconds and the next app attaches to it.
  const onDisk = ({ userData }, key) => {
    const dir = path.join(userData, 'Partitions', 'hub', 'Local Storage', 'leveldb')
    return fs.readdirSync(dir).some(name => {
      try { return fs.readFileSync(path.join(dir, name)).includes(key) } catch { return false }
    })
  }

  test('a page\'s write reaches the disk only later, unless the storage is flushed', async t => {
    const app = await startApp(t)
    const { handle, port } = app
    await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub page')
    await evalIn(handle, 0, `localStorage.setItem('quit-test-flushed', 'kept')`)
    await sleep(300)
    assert.equal(onDisk(app, 'quit-test-flushed'), false, 'still in memory, or this test shows nothing')
    await handle.app.evaluate(({ session }) => session.fromPartition('persist:hub').flushStorageData())
    await waitFor(() => onDisk(app, 'quit-test-flushed'), 'the flush to reach the disk', 2000)
    await quit(handle)
  })

  test('a quit flushes what the page just saved, before it waits for anything', async t => {
    const app = await startApp(t)
    const { handle, port } = app
    await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub page')
    const mark = path.join(app.userData, 'flushed-at')
    await handle.app.evaluate(({ session }, file) => {
      const hub = session.fromPartition('persist:hub')
      const flush = hub.flushStorageData.bind(hub)
      hub.flushStorageData = () => { process.getBuiltinModule('fs').writeFileSync(file, String(Date.now())); flush() }
    }, mark)
    await evalIn(handle, 0, `localStorage.setItem('quit-test-quit', 'kept')`)
    const from = Date.now()
    await pressQuit(handle)
    const { hubGone } = await assertAllGone(app, from)
    // Closing the windows can save the write too, so what's on the disk can't show the flush alone. The
    // call has to be seen as well.
    assert.ok(fs.existsSync(mark), 'the quit has to flush the page\'s storage')
    const flushedAt = Number(fs.readFileSync(mark, 'utf8')) - from
    assert.ok(flushedAt <= hubGone, `the flush came at ${flushedAt} ms, after the Hub went at ${hubGone} ms`)
    assert.ok(onDisk(app, 'quit-test-quit'), 'the write has to be on the disk')
  })

  test('a launcher page that refuses to unload can\'t stop the app quitting', async t => {
    const app = await startApp(t, { env: { STUB_LAUNCHER: '1' } })
    const { handle, port } = app
    await waitForUrl(handle, 1, url => url === `http://localhost:${port}/launcher`, 'the launcher page')
    await evalIn(handle, 1, `window.addEventListener('beforeunload', event => { event.preventDefault(); event.returnValue = 'no' }); true`)
    const from = Date.now()
    await pressQuit(handle)
    t.diagnostic(JSON.stringify(await assertAllGone(app, from)))
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
