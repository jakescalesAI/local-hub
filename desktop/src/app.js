// Wires the pieces together. Each piece owns its own behaviour; this file only connects them.
import { BrowserWindow, Menu, app, ipcMain, session, shell } from 'electron'
import path from 'node:path'

import { APP_NAME } from './app-name.js'
import { resolveServerEntry, spawnBundledHub } from './hub-bundle.js'
import { HubConnection } from './hub-connection.js'
import { Hotkey } from './hotkey.js'
import { Launcher } from './launcher.js'
import { MainWindow } from './main-window.js'
import platform from './platform/index.js'
import { canOpenExternally, guardContents, hardenSession, isLocalPage, pagePath, securePrefs } from './security.js'
import { Settings, validPort } from './settings.js'
import { createTray } from './tray.js'

// At login a Hub started some other way may be a few seconds behind us; give it the chance to answer.
const LOGIN_GRACE_MS = 10_000

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  platform.applyAppIdentity(app)
  // Not a top-level await: Electron holds `ready` back until this module has finished loading.
  app.whenReady().then(start)
}

function start() {
  const startHidden = process.argv.includes('--hidden')
  const userData = app.getPath('userData')
  const settings = new Settings(path.join(userData, 'settings.json'))
  const logFile = path.join(userData, 'logs', 'hub.log')

  const connection = new HubConnection({
    port: settings.values.port,
    stopTree: platform.stopProcessTree,
    portHolders: platform.portHolders,
    startTimeoutMs: Number(process.env.LOCAL_HUB_START_TIMEOUT_MS) || undefined,
    spawnHub: port => {
      const entry = resolveServerEntry({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        userData,
        version: app.getVersion(),
      })
      if (!entry) return null
      return spawnBundledHub({ entry, port, logFile, spawnOptions: platform.spawnOptions(), cleanEnv: app.isPackaged })
    },
  })
  connection.on('child-error', error => console.error('hub process:', error.message))

  const getOrigin = () => connection.origin
  const openExternal = url => {
    if (canOpenExternally(url)) shell.openExternal(url).catch(error => console.error('open external:', error.message))
  }

  const mainWindow = new MainWindow({ connection, settings })
  const launcher = new Launcher({ connection })
  const hotkey = new Hotkey(() => launcher.toggle())

  // A popup from the launcher goes to the main window, since the launcher hides as soon as it loses
  // focus. A popup from anywhere else (a file preview, say) gets its own window under the same rules.
  const openHubPopup = (url, contents) => {
    if (contents === launcher.window?.webContents) {
      launcher.close()
      mainWindow.openHubUrl(url)
      return { action: 'deny' }
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: securePrefs() },
    }
  }

  platform.installAppMenu(Menu)
  hardenSession(session.fromPartition('persist:hub'), getOrigin)
  app.on('web-contents-created', (_event, contents) => guardContents(contents, { getOrigin, openExternal, openHubPopup }))

  let settingsWindow = null
  const openSettings = () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow.show()
    settingsWindow = new BrowserWindow({
      width: 440,
      height: 340,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: `${APP_NAME} settings`,
      autoHideMenuBar: true,
      backgroundColor: '#14161a',
      show: false,
      webPreferences: securePrefs({ preload: true }),
    })
    settingsWindow.on('page-title-updated', event => event.preventDefault())
    settingsWindow.once('ready-to-show', () => settingsWindow.show())
    settingsWindow.loadFile(pagePath('settings.html')).catch(() => {})
  }

  // Only this app's own top-level pages may use the bridge.
  const handle = (channel, fn) => ipcMain.handle(`desktop:${channel}`, (event, ...args) => {
    const frame = event.senderFrame
    if (!frame || frame.parent || !isLocalPage(frame.url)) throw new Error('not allowed')
    return fn(...args)
  })
  handle('open-hub', () => {
    launcher.close()
    mainWindow.show()
  })
  handle('open-url', url => {
    if (typeof url !== 'string' || !/^https?:$/.test(new URL(url).protocol)) return false
    launcher.close()
    openExternal(url)
    return true
  })
  handle('close-launcher', () => launcher.close())
  handle('retry', () => connection.retry())
  handle('start-bundled', () => connection.useBundled())
  handle('get-settings', () => ({ port: connection.port, hotkey: hotkey.current ?? settings.values.hotkey }))
  handle('save-settings', async patch => {
    const changesPort = patch?.port !== undefined && patch.port !== connection.port
    // Checked first, so a refused save changes nothing.
    if (changesPort && !validPort(patch.port)) return { ok: false, error: 'The port must be a number from 1 to 65535.' }
    if (patch?.hotkey !== undefined) {
      const applied = typeof patch.hotkey === 'string' ? hotkey.set(patch.hotkey.trim()) : { ok: false, error: 'No hotkey given.' }
      if (!applied.ok) return { ok: false, error: applied.error }
      settings.update({ hotkey: applied.hotkey })
    }
    if (changesPort) {
      settings.update({ port: patch.port })
      await connection.setPort(patch.port)
    }
    trayControls.refresh()
    return { ok: true }
  })

  const hotkeyResult = hotkey.set(settings.values.hotkey)
  if (!hotkeyResult.ok) console.error(hotkeyResult.error)

  const trayControls = createTray({
    connection,
    onOpen: () => mainWindow.show(),
    onLauncher: () => launcher.open(),
    onSettings: openSettings,
    getLogin: () => platform.getLoginItem(app),
    setLogin: on => platform.setLoginItem(app, on),
    getHotkey: () => hotkey.current,
    onQuit: () => app.quit(),
  })

  app.on('second-instance', () => mainWindow.show())
  app.on('activate', () => platform.onActivate(() => mainWindow.show()))
  // Everything is hidden rather than closed, so this is only reached on the way out.
  app.on('window-all-closed', () => {})

  let stopped = false
  app.on('before-quit', () => {
    mainWindow.prepareToQuit()
    launcher.prepareToQuit()
  })
  app.on('will-quit', event => {
    hotkey.clear()
    if (stopped) return
    // Waits for our own child to be gone. An attached Hub has no child, so this leaves it running.
    event.preventDefault()
    stopped = true
    connection.stop().finally(() => setImmediate(() => app.exit(0)))
  })

  mainWindow.create({ visible: !startHidden })
  launcher.create()
  connection.start({ graceMs: startHidden ? LOGIN_GRACE_MS : 0 })
}
