// The tray menu and the global hotkey. The hotkey is pressed for real, system-wide, on an unusual
// binding, so RegisterHotKey fires. Real focus changes are the one thing not exercised (see README).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import {
  STUB_SERVER, TEST_HOTKEY, TEST_HOTKEY_2, TEST_HOTKEY_2_KEYS, TEST_HOTKEY_KEYS, cleanup, evalIn, freePort, getJson, launch, makeUserData, ping, pressKeys,
  processAlive, quit, readSettings, recorded, removeUserData, runKey, sleep, startExternalStub, stopExternalStub, trayItem, waitFor, waitForUrl, windows,
} from '../helpers.mjs'

const LAUNCHER = 1
const isHub = port => url => url.startsWith(`http://localhost:${port}/`)
const isFallback = url => url.includes('/pages/launcher.html')

let runKeyBefore
before(() => { runKeyBefore = runKey() })
after(() => assert.equal(runKey(), runKeyBefore, 'the login items in the registry must not change'))

async function withApp(t, { stubEnv = {}, settings = {}, args = [] } = {}) {
  const port = await freePort()
  const external = await startExternalStub(port, stubEnv)
  const userData = makeUserData({ port, ...settings })
  cleanup(t, () => removeUserData(userData))
  cleanup(t, () => stopExternalStub(external))
  const handle = await launch({ userData, args })
  cleanup(t, () => quit(handle).catch(() => {}))
  await waitForUrl(handle, 0, isHub(port), 'the Hub in the main window')
  return { port, handle, userData }
}

const launcherVisible = async handle => (await windows(handle))[LAUNCHER]?.visible ?? false

const blurLauncher = handle => handle.app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[1].emit('blur')
})

async function pressUntil(keys, check, label) {
  // A real key held at that moment can swallow the combination, so it gets a few tries.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    pressKeys(keys)
    try {
      return await waitFor(check, label, 2500)
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
}

describe('tray', () => {
  test('open, launcher, settings and quit all work, and start at login defaults to off', async t => {
    const { port, handle } = await withApp(t, { args: ['--hidden'] })
    assert.equal((await windows(handle))[0].visible, false, 'hidden start keeps the main window hidden')

    const status = await trayItem(handle, 'status', 'read')
    t.diagnostic(`tray status line: ${status.label}`)
    assert.equal(status.label, 'Hub: connected')

    await trayItem(handle, 'open')
    await waitFor(async () => (await windows(handle))[0].visible, 'main window shown')

    await trayItem(handle, 'launcher')
    await waitFor(() => launcherVisible(handle), 'launcher shown')
    await blurLauncher(handle)

    await trayItem(handle, 'settings')
    await waitFor(async () => {
      const list = await windows(handle)
      return list.length === 3 && list[2].visible
    }, 'settings window shown')
    assert.match((await windows(handle))[2].url, /pages\/settings\.html$/)
    await waitFor(async () => (await evalIn(handle, 2, `document.getElementById('port').value`)) === String(port), 'settings to show the port')

    const login = await trayItem(handle, 'login', 'read')
    assert.equal(login.checked, false, 'start at login is off by default')
    assert.equal((await recorded(handle)).loginCalls.length, 0, 'nothing written until asked')

    await trayItem(handle, 'login')
    assert.equal((await trayItem(handle, 'login', 'read')).checked, true)
    await trayItem(handle, 'login')
    assert.equal((await trayItem(handle, 'login', 'read')).checked, false)
    const { loginCalls } = await recorded(handle)
    t.diagnostic(`login calls: ${JSON.stringify(loginCalls.map(call => ({ on: call.openAtLogin, lastArg: call.args?.at(-1) })))}`)
    assert.deepEqual(loginCalls.map(call => call.openAtLogin), [true, false])
    assert.equal(loginCalls[0].args.at(-1), '--hidden', 'a login start stays in the tray')

    await trayItem(handle, 'quit')
    await Promise.race([handle.exited, sleep(10_000).then(() => { throw new Error('Quit did not exit') })])
  })

  test('closing the main window keeps the app in the tray', async t => {
    const { handle } = await withApp(t)
    await waitFor(async () => (await windows(handle))[0].visible, 'main window shown')
    await handle.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].close() })
    await waitFor(async () => !(await windows(handle))[0].visible, 'main window hidden')
    assert.equal(handle.proc.exitCode, null, 'the app is still running')
    await trayItem(handle, 'open')
    await waitFor(async () => (await windows(handle))[0].visible, 'main window back')
  })
})

describe('a page closing its own window', () => {
  test('window.close() on the main page leaves the app working from the tray', async t => {
    const { port, handle } = await withApp(t, { args: ['--hidden'] })
    const old = (await windows(handle))[0].id
    await evalIn(handle, 0, `setTimeout(() => window.close(), 0); 1`)
    const hubRoot = `http://localhost:${port}/`
    const remade = await waitFor(async () => {
      const list = await windows(handle)
      return list.length === 2 && list.every(win => win.id !== old) && list.find(win => win.url === hubRoot && !win.loading && !win.visible)
    }, 'a new main window on the Hub, hidden')
    t.diagnostic(`new main window ${remade.id}, ${remade.url}`)
    await trayItem(handle, 'open')
    await waitFor(async () => (await windows(handle)).find(win => win.id === remade.id)?.visible, 'tray Open to show it')
  })
})

describe('hotkey and launcher', () => {
  test('the real hotkey opens it on the cursor monitor; hotkey, Esc and lost focus close it', async t => {
    const { handle } = await withApp(t, { args: ['--hidden'] })
    const registered = await handle.app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), TEST_HOTKEY)
    assert.equal(registered, true)

    await waitForUrl(handle, LAUNCHER, isFallback, 'the built-in page, because /launcher returns 404')
    assert.equal(await launcherVisible(handle), false, 'hidden until asked for')

    await pressUntil(TEST_HOTKEY_KEYS, () => launcherVisible(handle), 'the hotkey to open the launcher')

    const info = await handle.app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[1]
      const shown = global.__lh.shown.filter(entry => entry.id === win.id).at(-1)
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      return { onTop: win.isAlwaysOnTop(), resizable: win.isResizable(), shown: shown.bounds, workArea: display.workArea, displays: screen.getAllDisplays().length }
    })
    t.diagnostic(`launcher bounds ${JSON.stringify(info.shown)} inside work area ${JSON.stringify(info.workArea)} (${info.displays} monitors)`)
    assert.equal(info.onTop, true)
    assert.equal(info.resizable, false)
    const { x, y, width, height } = info.shown
    assert.ok(x >= info.workArea.x && x + width <= info.workArea.x + info.workArea.width, 'inside the monitor horizontally')
    assert.ok(y >= info.workArea.y && y + height <= info.workArea.y + info.workArea.height, 'inside the monitor vertically')

    // A second press closes it.
    await pressUntil(TEST_HOTKEY_KEYS, async () => !(await launcherVisible(handle)), 'the hotkey to close the launcher')

    // Esc, through the same path a key press takes.
    await pressUntil(TEST_HOTKEY_KEYS, () => launcherVisible(handle), 'the hotkey to reopen the launcher')
    assert.equal((await windows(handle))[LAUNCHER].onTop, true, 'still on top after hiding and showing')
    await waitForUrl(handle, LAUNCHER, isFallback, 'the built-in page to be ready')
    await handle.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[1].webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    })
    await waitFor(async () => !(await launcherVisible(handle)), 'Esc to close the launcher', 3000)

    // Lost focus: the window's blur event. Real focus isn't taken from the desktop in tests.
    await pressUntil(TEST_HOTKEY_KEYS, () => launcherVisible(handle), 'the hotkey to reopen the launcher')
    await blurLauncher(handle)
    await waitFor(async () => !(await launcherVisible(handle)), 'blur to close the launcher', 3000)
  })

  test('it opens on whichever monitor holds the cursor, not the primary one', async t => {
    const { handle } = await withApp(t, { args: ['--hidden'] })
    // The real cursor stays where it is: the app is told it's on another monitor.
    const target = await handle.app.evaluate(({ screen }) => {
      const primary = screen.getPrimaryDisplay().id
      const other = screen.getAllDisplays().find(display => display.id !== primary)
      if (!other) return null
      screen.getCursorScreenPoint = () => ({ x: other.bounds.x + 5, y: other.bounds.y + 5 })
      return { workArea: other.workArea, scale: other.scaleFactor }
    })
    if (!target) return t.skip('only one monitor here (could not check; not a pass)')
    await trayItem(handle, 'launcher')
    await waitFor(() => launcherVisible(handle), 'launcher open')
    const { shown } = await recorded(handle)
    const { bounds } = shown.at(-1)
    t.diagnostic(`bounds ${JSON.stringify(bounds)} on monitor ${JSON.stringify(target)}`)
    assert.ok(bounds.x >= target.workArea.x && bounds.x + bounds.width <= target.workArea.x + target.workArea.width)
    assert.ok(bounds.y >= target.workArea.y && bounds.y + bounds.height <= target.workArea.y + target.workArea.height)
    assert.deepEqual([bounds.width, bounds.height], [640, 400])
  })

  test('the built-in page works: an address opens the browser, Enter opens the Hub, and both close it', async t => {
    const { handle } = await withApp(t, { args: ['--hidden'] })
    await waitForUrl(handle, LAUNCHER, isFallback, 'the built-in page')
    await trayItem(handle, 'launcher')
    await waitFor(() => launcherVisible(handle), 'launcher open')

    const submit = value => evalIn(handle, LAUNCHER, `(() => {
      document.getElementById('query').value = ${JSON.stringify(value)}
      document.getElementById('form').requestSubmit()
      return true
    })()`)
    await submit('example.com')
    await waitFor(async () => (await recorded(handle)).external.includes('https://example.com/'), 'the address to open in the browser', 3000)
    await waitFor(async () => !(await launcherVisible(handle)), 'launcher to close', 3000)

    await waitForUrl(handle, LAUNCHER, isFallback, 'the built-in page again')
    await trayItem(handle, 'launcher')
    await waitFor(() => launcherVisible(handle), 'launcher open again')
    await submit('')
    await waitFor(async () => (await windows(handle))[0].visible, 'the main window to open', 3000)
    await waitFor(async () => !(await launcherVisible(handle)), 'launcher to close', 3000)
  })

  test('when the Hub provides /launcher it loads that, and its popups open in the main window', async t => {
    const { port, handle } = await withApp(t, { stubEnv: { STUB_LAUNCHER: '1' }, args: ['--hidden'] })
    const win = await waitForUrl(handle, LAUNCHER, url => url === `http://localhost:${port}/launcher`, 'the route')
    t.diagnostic(`launcher window: ${win.url}`)
    assert.equal(await evalIn(handle, LAUNCHER, `document.getElementById('route').textContent`), 'launcher route')
    assert.equal(await evalIn(handle, LAUNCHER, `typeof window.hubDesktop`), 'undefined', 'no bridge on a Hub page')

    await trayItem(handle, 'launcher')
    await waitFor(() => launcherVisible(handle), 'launcher open')
    await evalIn(handle, LAUNCHER, `document.getElementById('open').click()`)
    await waitForUrl(handle, 0, url => url === `http://localhost:${port}/?from=launcher`, 'the main window to load it')
    await waitFor(async () => !(await launcherVisible(handle)), 'launcher to close', 3000)
    assert.equal((await windows(handle)).length, 2, 'no extra window')
  })

  test('the /launcher page gets Esc itself: it clears its box first, then closes', async t => {
    const { port, handle } = await withApp(t, { stubEnv: { STUB_LAUNCHER: '1' }, args: ['--hidden'] })
    await waitForUrl(handle, LAUNCHER, url => url === `http://localhost:${port}/launcher`, 'the route')
    await trayItem(handle, 'launcher')
    await waitFor(() => launcherVisible(handle), 'launcher open')
    await evalIn(handle, LAUNCHER, `document.getElementById('box').value = 'typed'; 1`)
    const pressEsc = () => handle.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[1].webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    })
    await pressEsc()
    await waitFor(async () => (await evalIn(handle, LAUNCHER, `document.getElementById('box')?.value`).catch(() => null)) === '', 'the first Esc to clear the box', 3000)
    assert.equal(await launcherVisible(handle), true, 'the first Esc leaves it open')
    await pressEsc()
    await waitFor(async () => !(await launcherVisible(handle)), 'the second Esc to close it', 5000)
    assert.equal((await windows(handle)).length, 2)
  })

  test('window.close() from the /launcher page hides it and starts it clean, every time', async t => {
    const { port, handle } = await withApp(t, { stubEnv: { STUB_LAUNCHER: '1' }, args: ['--hidden'] })
    const route = `http://localhost:${port}/launcher`
    await waitForUrl(handle, LAUNCHER, url => url === route, 'the route')
    for (let round = 1; round <= 3; round += 1) {
      await trayItem(handle, 'launcher')
      await waitFor(() => launcherVisible(handle), 'launcher open')
      await evalIn(handle, LAUNCHER, `window.__dirty = true; setTimeout(() => window.close(), 0); 1`)
      await waitFor(async () => !(await launcherVisible(handle)), `window.close() to hide it, round ${round}`, 5000)
      const win = await waitForUrl(handle, LAUNCHER, url => url === route, 'the route again')
      await waitFor(async () => (await evalIn(handle, LAUNCHER, `window.__dirty === undefined`).catch(() => false)), 'the page to reload')
      t.diagnostic(`round ${round}: hidden, reloaded, ${win.url}, window ${win.id}, windows ${(await windows(handle)).length}`)
      assert.equal((await windows(handle)).length, 2, 'one launcher, ready for next time')
    }
    // The hotkey still reaches the window that took its place.
    await pressUntil(TEST_HOTKEY_KEYS, () => launcherVisible(handle), 'the hotkey after window.close()')
    assert.equal((await windows(handle))[LAUNCHER].onTop, true)
  })

  test('a Hub action from /launcher reaches the open main page by its hash, with no reload', async t => {
    const { port, handle } = await withApp(t, { stubEnv: { STUB_LAUNCHER: '1' }, args: ['--hidden'] })
    await waitForUrl(handle, LAUNCHER, url => url === `http://localhost:${port}/launcher`, 'the route')
    await evalIn(handle, 0, `window.__typed = 'still here'; window.__got = []
      window.addEventListener('hashchange', () => window.__got.push([location.hash, localStorage.getItem('lh-request')])); 1`)

    for (const [round, request] of [[1, 'first'], [2, 'second']]) {
      await trayItem(handle, 'launcher')
      await waitFor(() => launcherVisible(handle), 'launcher open')
      await evalIn(handle, LAUNCHER, `localStorage.setItem('lh-request', ${JSON.stringify(request)}); window.open('/#launcher-run', '_blank', 'noopener'); 1`)
      await waitFor(async () => (await evalIn(handle, 0, `window.__got.length`)) === round, `hashchange ${round}`)
      await waitFor(async () => !(await launcherVisible(handle)), 'launcher to close', 3000)
    }
    const got = await evalIn(handle, 0, `window.__got`)
    t.diagnostic(`main page saw ${JSON.stringify(got)}, typed state ${await evalIn(handle, 0, `window.__typed`)}`)
    assert.deepEqual(got, [['#launcher-run', 'first'], ['#launcher-run', 'second']], 'one event each, with the shared storage already readable')
    assert.equal(await evalIn(handle, 0, `window.__typed`), 'still here', 'no reload')
    assert.equal((await windows(handle))[0].url, `http://localhost:${port}/#launcher-run`)
    assert.equal((await windows(handle)).length, 2, 'no extra window')
  })

  test('a Hub action from /launcher loads the page when the main window is elsewhere', async t => {
    const { port, handle } = await withApp(t, { stubEnv: { STUB_LAUNCHER: '1' }, args: ['--hidden'] })
    await waitForUrl(handle, LAUNCHER, url => url === `http://localhost:${port}/launcher`, 'the route')
    await handle.app.evaluate(({ BrowserWindow }, url) => {
      BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].loadURL(url)
    }, `http://localhost:${port}/?elsewhere=1`)
    await waitForUrl(handle, 0, url => url.endsWith('?elsewhere=1'), 'the other page')
    await trayItem(handle, 'launcher')
    await waitFor(() => launcherVisible(handle), 'launcher open')
    await evalIn(handle, LAUNCHER, `window.open('/#launcher-run', '_blank', 'noopener'); 1`)
    const main = await waitForUrl(handle, 0, url => url === `http://localhost:${port}/#launcher-run`, 'the main window to load it')
    t.diagnostic(`main window ${main.url}`)
  })

  test('the launcher falls back while the Hub is down, and returns to the route when it is back', async t => {
    const port = await freePort()
    let external = await startExternalStub(port, { STUB_LAUNCHER: '1' })
    const userData = makeUserData({ port })
    cleanup(t, () => removeUserData(userData))
    cleanup(t, () => stopExternalStub(external))
    const handle = await launch({ userData, args: ['--hidden'] })
    cleanup(t, () => quit(handle).catch(() => {}))
    await waitForUrl(handle, LAUNCHER, url => url.endsWith('/launcher'), 'the route')

    await stopExternalStub(external)
    await waitForUrl(handle, LAUNCHER, isFallback, 'the built-in page while the Hub is down', 8000)

    external = await startExternalStub(port, { STUB_LAUNCHER: '1' })
    await waitForUrl(handle, LAUNCHER, url => url.endsWith('/launcher'), 'the route once the Hub is back', 15_000)
  })
})

describe('settings', () => {
  const settingsPage = async handle => {
    await trayItem(handle, 'settings')
    await waitFor(async () => {
      const list = await windows(handle)
      return list.length === 3 && !list[2].loading && list[2].url.endsWith('settings.html')
    }, 'settings page')
  }

  test('a new hotkey replaces the old one, survives a restart, and a bad one changes nothing', async t => {
    const { handle, userData, port } = await withApp(t, { args: ['--hidden'] })
    await settingsPage(handle)
    await waitFor(async () => (await evalIn(handle, 2, `document.getElementById('hotkey').value`)) === TEST_HOTKEY, 'current hotkey shown')

    const isRegistered = key => handle.app.evaluate(({ globalShortcut }, value) => globalShortcut.isRegistered(value), key)
    const save = value => evalIn(handle, 2, `window.hubDesktop.saveSettings(${JSON.stringify(value)})`)

    // Key capture in the page. Dispatched into the field, with no real keys involved.
    const captured = await evalIn(handle, 2, `(() => {
      const input = document.getElementById('hotkey')
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }))
      const combo = input.value
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', bubbles: true, cancelable: true }))
      return { combo, plainKeyIgnored: input.value === combo }
    })()`)
    assert.deepEqual(captured, { combo: 'Ctrl+Alt+K', plainKeyIgnored: true })

    const invalid = await save({ hotkey: 'Not+A+Key' })
    t.diagnostic(`invalid binding: ${JSON.stringify(invalid)}`)
    assert.equal(invalid.ok, false)
    assert.equal(await isRegistered(TEST_HOTKEY), true, 'the old binding still works')
    assert.equal(readSettings(userData).hotkey, TEST_HOTKEY)

    assert.deepEqual(await save({ hotkey: TEST_HOTKEY_2 }), { ok: true })
    assert.equal(await isRegistered(TEST_HOTKEY_2), true)
    assert.equal(await isRegistered(TEST_HOTKEY), false)
    assert.equal(readSettings(userData).hotkey, TEST_HOTKEY_2)
    await pressUntil(TEST_HOTKEY_2_KEYS, () => launcherVisible(handle), 'the new hotkey to open the launcher')
    await blurLauncher(handle)

    // A second app holding the binding makes it unavailable, as another program would.
    const userData2 = makeUserData({ port, hotkey: TEST_HOTKEY })
    cleanup(t, () => removeUserData(userData2))
    const other = await launch({ userData: userData2, args: ['--hidden'] })
    cleanup(t, () => quit(other).catch(() => {}))
    await waitFor(() => other.app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), TEST_HOTKEY), 'the other app to hold the binding')
    const taken = await save({ hotkey: TEST_HOTKEY })
    t.diagnostic(`binding held by another app: ${JSON.stringify(taken)}`)
    assert.equal(taken.ok, false)
    assert.equal(await isRegistered(TEST_HOTKEY_2), true, 'the working binding is kept')
    await quit(other)

    await quit(handle)
    const again = await launch({ userData, args: ['--hidden'] })
    cleanup(t, () => quit(again).catch(() => {}))
    await waitFor(() => again.app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), TEST_HOTKEY_2), 'the binding after a restart')
  })

  test('changing the port moves the app to the Hub on the new port', async t => {
    const { handle } = await withApp(t, { args: ['--hidden'] })
    const port2 = await freePort()
    const external2 = await startExternalStub(port2)
    cleanup(t, () => stopExternalStub(external2))
    await settingsPage(handle)
    const bad = await evalIn(handle, 2, `window.hubDesktop.saveSettings({ port: 70000 })`)
    assert.equal(bad.ok, false)
    assert.deepEqual(await evalIn(handle, 2, `window.hubDesktop.saveSettings({ port: ${port2} })`), { ok: true })
    const main = await waitForUrl(handle, 0, isHub(port2), 'the Hub on the new port')
    t.diagnostic(`main window now ${main.url}`)
  })

  // Quitting can't prove the tree is stopped: Windows also ends a process's children when it exits.
  // Here the app keeps running, so only the app's own stop can have ended them.
  test('changing the port stops the bundled server and its children while the app keeps running', async t => {
    const port = await freePort()
    const userData = makeUserData({ port })
    cleanup(t, () => removeUserData(userData))
    const handle = await launch({ userData, args: ['--hidden'], env: { LOCAL_HUB_SERVER: STUB_SERVER, STUB_GRANDCHILD: '1' } })
    cleanup(t, () => quit(handle).catch(() => {}))
    await waitForUrl(handle, 0, isHub(port), 'the bundled Hub')
    const first = await getJson(port, '/api/pid')
    assert.ok(processAlive(first.grandchild))

    const port2 = await freePort()
    await settingsPage(handle)
    assert.deepEqual(await evalIn(handle, 2, `window.hubDesktop.saveSettings({ port: ${port2} })`), { ok: true })
    await waitForUrl(handle, 0, isHub(port2), 'the Hub on the new port')
    await waitFor(() => !processAlive(first.pid) && !processAlive(first.grandchild), 'the old Hub and its child to be gone', 8000)
    const second = await getJson(port2, '/api/pid')
    t.diagnostic(`old hub ${first.pid} and child ${first.grandchild} gone, new hub ${second.pid} on ${port2}, app pid ${handle.pid} still running`)
    assert.equal(await ping(port), false, 'the old port is quiet')
    assert.notEqual(second.pid, first.pid)
  })
})
