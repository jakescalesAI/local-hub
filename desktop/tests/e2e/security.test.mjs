// The security floor, checked in the running app: web preferences, the origin rule, and that the
// Hub's own x-hub check still works through the app.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  cleanup, evalIn, freePort, launch, makeUserData, quit, recorded, removeUserData, sleep, startExternalStub,
  startForeignServer, stopExternalStub, trayItem, waitFor, waitForUrl, windows,
} from '../helpers.mjs'

async function withApp(t) {
  const foreign = await startForeignServer()
  cleanup(t, () => foreign.close())
  const port = await freePort()
  const external = await startExternalStub(port, { STUB_FOREIGN: foreign.origin })
  const userData = makeUserData({ port })
  cleanup(t, () => removeUserData(userData))
  cleanup(t, () => stopExternalStub(external))
  const handle = await launch({ userData, args: ['--hidden'] })
  cleanup(t, () => quit(handle).catch(() => {}))
  await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub')
  return { port, handle, foreign }
}

const externals = async handle => (await recorded(handle)).external

describe('web preferences', () => {
  test('every window: context isolation on, node integration off, sandbox on, no webview', async t => {
    const { handle } = await withApp(t)
    await trayItem(handle, 'settings')
    await waitFor(async () => (await windows(handle)).length === 3, 'settings window')
    const prefs = await handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id).map(win => {
      const { contextIsolation, nodeIntegration, sandbox, webSecurity, webviewTag, nodeIntegrationInSubFrames, nodeIntegrationInWorker } = win.webContents.getLastWebPreferences()
      return { title: win.getTitle(), contextIsolation, nodeIntegration, sandbox, webSecurity, webviewTag, nodeIntegrationInSubFrames, nodeIntegrationInWorker }
    }))
    for (const pref of prefs) t.diagnostic(JSON.stringify(pref))
    assert.equal(prefs.length, 3)
    for (const pref of prefs) {
      assert.equal(pref.contextIsolation, true)
      assert.equal(pref.nodeIntegration, false)
      assert.equal(pref.sandbox, true)
      assert.equal(pref.webSecurity, true)
      assert.equal(pref.webviewTag, false)
      assert.equal(pref.nodeIntegrationInSubFrames, false)
      assert.equal(pref.nodeIntegrationInWorker, false)
    }
  })

  test('Hub pages get no bridge and no Node; the app\'s own pages get only the bridge', async t => {
    const { handle } = await withApp(t)
    const hub = await evalIn(handle, 0, `({ bridge: typeof window.hubDesktop, require: typeof require, process: typeof process })`)
    t.diagnostic(`on a Hub page: ${JSON.stringify(hub)}`)
    assert.deepEqual(hub, { bridge: 'undefined', require: 'undefined', process: 'undefined' })

    await trayItem(handle, 'settings')
    await waitFor(async () => {
      const list = await windows(handle)
      return list.length === 3 && !list[2].loading && list[2].url.endsWith('settings.html')
    }, 'settings page')
    const local = await evalIn(handle, 2, `({ bridge: Object.keys(window.hubDesktop).sort(), require: typeof require, process: typeof process })`)
    t.diagnostic(`on the app's page: ${JSON.stringify(local)}`)
    assert.deepEqual(local.bridge, ['chooseHubFolder', 'closeLauncher', 'getSettings', 'openHub', 'openUrl', 'retry', 'saveSettings', 'startBundled'])
    assert.equal(local.require, 'undefined')
    assert.equal(local.process, 'undefined')
  })

  test('the IPC handlers refuse a Hub page even if it reaches the channel', async t => {
    const { handle } = await withApp(t)
    // Calls the real handler as a Hub frame would, since a Hub page has no way to send at all.
    const result = await handle.app.evaluate(async ({ ipcMain, BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0]
      const handler = ipcMain._invokeHandlers.get('desktop:get-settings')
      try {
        return { allowed: true, value: await handler({ senderFrame: main.webContents.mainFrame }) }
      } catch (error) {
        return { allowed: false, error: error.message }
      }
    })
    t.diagnostic(`from a Hub frame: ${JSON.stringify(result)}`)
    assert.deepEqual(result, { allowed: false, error: 'not allowed' })
  })
})

describe('only the Hub origin loads inside the app', () => {
  test('a link away opens in the default browser and the foreign server is never asked', async t => {
    const { handle, foreign, port } = await withApp(t)
    await evalIn(handle, 0, `document.getElementById('link').click()`)
    await waitFor(async () => (await externals(handle)).includes(`${foreign.origin}/from-link`), 'the link to go to the browser', 4000)
    await sleep(300)
    assert.deepEqual(foreign.hits, [], 'nothing loaded in the app')
    assert.ok((await windows(handle))[0].url.startsWith(`http://localhost:${port}/`), 'the window stays on the Hub')
  })

  test('target=_blank and window.open away go to the browser, with no new window', async t => {
    const { handle, foreign } = await withApp(t)
    await evalIn(handle, 0, `document.getElementById('blank').click()`)
    await evalIn(handle, 0, `(window.open(${JSON.stringify(`${foreign.origin}/from-open`)}, '_blank', 'noopener'), true)`)
    await waitFor(async () => {
      const seen = await externals(handle)
      return seen.includes(`${foreign.origin}/from-blank`) && seen.includes(`${foreign.origin}/from-open`)
    }, 'both to go to the browser', 4000)
    assert.equal((await windows(handle)).length, 2)
    assert.deepEqual(foreign.hits, [])
  })

  test('a redirect away from the Hub goes to the browser', async t => {
    const { handle, foreign, port } = await withApp(t)
    await evalIn(handle, 0, `document.getElementById('redirect').click()`)
    await waitFor(async () => (await externals(handle)).includes(`${foreign.origin}/from-redirect`), 'the redirect to go to the browser', 4000)
    await sleep(300)
    assert.deepEqual(foreign.hits, [])
    assert.ok((await windows(handle))[0].url.startsWith(`http://localhost:${port}/`))
  })

  test('an iframe from elsewhere is blocked, and a same-origin iframe loads', async t => {
    const { handle, foreign, port } = await withApp(t)
    const direct = await fetch(`${foreign.origin}/control`)
    assert.equal(direct.status, 200, 'the foreign server is up, so silence below means blocked')
    foreign.hits.length = 0

    const frameLoads = src => evalIn(handle, 0, `new Promise(resolve => {
      const frame = document.createElement('iframe')
      frame.src = ${JSON.stringify(src)}
      frame.onload = () => {
        try { resolve(frame.contentDocument?.getElementById('marker')?.textContent ?? 'no-access') } catch { resolve('no-access') }
      }
      document.body.append(frame)
      setTimeout(() => resolve('timeout'), 3000)
    })`)
    assert.equal(await frameLoads('/?frame=1'), `stub hub on ${port}`, 'same-origin frames are allowed')
    const blocked = await frameLoads(`${foreign.origin}/framed`)
    t.diagnostic(`foreign frame: ${blocked}, foreign requests ${JSON.stringify(foreign.hits)}`)
    await sleep(300)
    assert.deepEqual(foreign.hits, [], 'the foreign server was never asked for the frame')
    assert.deepEqual(await externals(handle), [], 'and no browser tab opened for it')
  })

  test('other schemes never reach the system', async t => {
    const { handle } = await withApp(t)
    await evalIn(handle, 0, `(window.open('ms-settings:'), window.open('file:///C:/Windows/notepad.exe'), true)`)
    await sleep(500)
    assert.deepEqual(await externals(handle), [])
    assert.equal((await windows(handle)).length, 2)
  })

  test('a same-origin popup opens under the same rules', async t => {
    const { handle, port, foreign } = await withApp(t)
    await evalIn(handle, 0, `document.getElementById('popup').click()`)
    await waitFor(async () => (await windows(handle)).length === 3, 'the popup window', 4000)
    const popup = await waitForUrl(handle, 2, url => url.includes('popup=1'), 'the popup page')
    assert.ok(popup.url.startsWith(`http://localhost:${port}/`))
    const pref = await handle.app.evaluate(({ BrowserWindow }) => {
      const { contextIsolation, nodeIntegration, sandbox, preload } = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[2].webContents.getLastWebPreferences()
      return { contextIsolation, nodeIntegration, sandbox, preload: preload ?? null }
    })
    t.diagnostic(`popup prefs: ${JSON.stringify(pref)}`)
    assert.deepEqual(pref, { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: null })
    await evalIn(handle, 2, `document.getElementById('link').click()`)
    await waitFor(async () => (await externals(handle)).includes(`${foreign.origin}/from-link`), 'the popup link to go to the browser', 4000)
    assert.deepEqual(foreign.hits, [])
  })
})

// The network block and the navigation guards each have to hold without the other. These take one
// away in the running app, and the last test takes both, to show the checks can fail at all.
const dropNetworkBlock = handle => handle.app.evaluate(({ session }) => {
  session.fromPartition('persist:hub').webRequest.onBeforeRequest(null)
})
const dropGuards = handle => handle.app.evaluate(({ webContents }) => {
  for (const contents of webContents.getAllWebContents()) {
    for (const name of ['will-navigate', 'will-redirect', 'will-frame-navigate']) contents.removeAllListeners(name)
  }
})

const addFrame = (handle, src) => evalIn(handle, 0, `(() => {
  const frame = document.createElement('iframe')
  frame.src = ${JSON.stringify(src)}
  document.body.append(frame)
  return true
})()`)

describe('each navigation layer on its own', () => {
  // A cancelled load leaves Chromium's error page in the window, so each attempt starts from the Hub.
  const backToHub = async (handle, port) => {
    await handle.app.evaluate(({ BrowserWindow }, url) => {
      BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].webContents.loadURL(url).catch(() => {})
    }, `http://localhost:${port}/`)
    await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub page')
  }

  async function tryToLeave(t, handle, foreign, port) {
    assert.equal((await fetch(`${foreign.origin}/control`)).status, 200, 'the foreign server is up, so silence below means blocked')
    foreign.hits.length = 0
    for (const attempt of [
      () => evalIn(handle, 0, `document.getElementById('link').click()`),
      () => evalIn(handle, 0, `document.getElementById('redirect').click()`),
      () => addFrame(handle, `${foreign.origin}/framed`),
    ]) {
      await backToHub(handle, port)
      await attempt()
      await sleep(800)
      assert.deepEqual(foreign.hits, [], 'the foreign server was never asked')
    }
    t.diagnostic(`foreign requests ${JSON.stringify(foreign.hits)}, external ${JSON.stringify(await externals(handle))}`)
  }

  test('with the network block gone, the guards alone stop a link, a redirect and a frame', async t => {
    const { handle, foreign, port } = await withApp(t)
    await dropNetworkBlock(handle)
    await tryToLeave(t, handle, foreign, port)
    assert.ok((await windows(handle))[0].url.startsWith(`http://localhost:${port}/`), 'the window stays on the Hub')
    const seen = await externals(handle)
    assert.ok(seen.includes(`${foreign.origin}/from-link`), 'the link went to the browser')
    assert.ok(seen.includes(`${foreign.origin}/from-redirect`), 'the redirect went to the browser')
  })

  test('with the guards gone, the network block alone stops a link, a redirect and a frame', async t => {
    const { handle, foreign, port } = await withApp(t)
    await dropGuards(handle)
    await tryToLeave(t, handle, foreign, port)
    assert.deepEqual(await externals(handle), [], 'the guards are what send links to the browser, and they are gone')
  })

  test('with both gone, a link does load in the app, so the two tests above can fail', async t => {
    const { handle, foreign } = await withApp(t)
    await dropNetworkBlock(handle)
    await dropGuards(handle)
    await evalIn(handle, 0, `document.getElementById('link').click()`)
    await waitFor(() => foreign.hits.some(hit => hit.includes('from-link')), 'the foreign server to be asked', 4000)
    t.diagnostic(`foreign requests ${JSON.stringify(foreign.hits)}`)
  })
})

describe('the Hub\'s own protections', () => {
  test('its x-hub check still refuses a write without the header, and passes with it', async t => {
    const { handle } = await withApp(t)
    const status = header => evalIn(handle, 0, `fetch('/api/write', { method: 'POST'${header ? `, headers: { 'x-hub': '1' }` : ''} }).then(r => r.status)`)
    assert.equal(await status(false), 403, 'the app adds no header of its own')
    assert.equal(await status(true), 200)
  })

  test('permissions off the short list are refused', async t => {
    const { handle } = await withApp(t)
    const media = await evalIn(handle, 0, `navigator.mediaDevices.getUserMedia({ audio: true }).then(() => 'granted', e => e.name)`)
    t.diagnostic(`microphone request: ${media}`)
    assert.notEqual(media, 'granted')
    const geo = await evalIn(handle, 0, `new Promise(resolve => navigator.geolocation.getCurrentPosition(() => resolve('granted'), e => resolve('refused ' + e.code), { timeout: 2000 }))`)
    t.diagnostic(`location request: ${geo}`)
    assert.notEqual(geo, 'granted')
  })
})

describe('window position', () => {
  test('size and position are saved and come back', async t => {
    const port = await freePort()
    const external = await startExternalStub(port)
    const userData = makeUserData({ port })
    cleanup(t, () => removeUserData(userData))
    cleanup(t, () => stopExternalStub(external))
    // Hidden throughout, so nothing shows on the desktop.
    const first = await launch({ userData, args: ['--hidden'] })
    cleanup(t, () => quit(first).catch(() => {}))
    await waitFor(async () => (await windows(first)).length >= 2, 'windows')
    const target = await first.app.evaluate(({ BrowserWindow, screen }) => {
      const { workArea } = screen.getPrimaryDisplay()
      const bounds = { x: workArea.x + 80, y: workArea.y + 60, width: 900, height: 600 }
      const win = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0]
      win.setBounds(bounds)
      return win.getBounds()
    })
    await sleep(800)
    await quit(first)
    const second = await launch({ userData, args: ['--hidden'] })
    cleanup(t, () => quit(second).catch(() => {}))
    await waitFor(async () => (await windows(second)).length >= 2, 'windows')
    const restored = (await windows(second))[0].bounds
    t.diagnostic(`saved ${JSON.stringify(target)}, restored ${JSON.stringify(restored)}`)
    assert.deepEqual(restored, target)
  })

  test('a saved position on a monitor that is gone comes back on screen', async t => {
    const port = await freePort()
    const external = await startExternalStub(port)
    const userData = makeUserData({ port, window: { x: 50000, y: 50000, width: 900, height: 600 } })
    cleanup(t, () => removeUserData(userData))
    cleanup(t, () => stopExternalStub(external))
    const handle = await launch({ userData, args: ['--hidden'] })
    cleanup(t, () => quit(handle).catch(() => {}))
    await waitFor(async () => (await windows(handle)).length >= 2, 'windows')
    const { bounds, displays } = await handle.app.evaluate(({ BrowserWindow, screen }) => ({
      bounds: BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].getBounds(),
      displays: screen.getAllDisplays().map(display => display.workArea),
    }))
    t.diagnostic(`restored to ${JSON.stringify(bounds)} on ${JSON.stringify(displays)}`)
    assert.ok(displays.some(area => bounds.x >= area.x && bounds.x < area.x + area.width && bounds.y >= area.y && bounds.y < area.y + area.height))
  })

  test('a saved maximized state does not show a window started in the tray', async t => {
    const port = await freePort()
    const external = await startExternalStub(port)
    const userData = makeUserData({ port, window: { x: 100, y: 100, width: 900, height: 600, maximized: true } })
    cleanup(t, () => removeUserData(userData))
    cleanup(t, () => stopExternalStub(external))
    const handle = await launch({ userData, args: ['--hidden'] })
    cleanup(t, () => quit(handle).catch(() => {}))
    await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub')
    assert.equal((await windows(handle))[0].visible, false)
    assert.equal(await handle.app.evaluate(() => Boolean(global.__lh.maximized)), false, 'not yet')
    await trayItem(handle, 'open')
    await waitFor(() => handle.app.evaluate(() => Boolean(global.__lh.maximized)), 'maximize on opening')
  })
})
