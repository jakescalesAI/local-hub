// Wires the pieces together. Each piece owns its own behaviour; this file only connects them.
import { BrowserWindow, Menu, Notification, app, clipboard, dialog, ipcMain, nativeTheme, session, shell } from 'electron'
import path from 'node:path'

import { APP_ICON, APP_NAME } from './app-name.js'
import { findNode, isHubFolder, resolveServerEntry, spawnBundledHub, spawnQuitGuard } from './hub-bundle.js'
import { HubConnection } from './hub-connection.js'
import { Hotkey } from './hotkey.js'
import { Launcher } from './launcher.js'
import { MainWindow } from './main-window.js'
import platform from './platform/index.js'
import { canOpenExternally, guardContents, hardenSession, isLocalPage, pagePath, securePrefs } from './security.js'
import { Settings, validPort } from './settings.js'
import { createTray } from './tray.js'
import { TvStatus, linkFrom } from './tv.js'

// At login a Hub started some other way may be a few seconds behind us; give it the chance to answer.
const LOGIN_GRACE_MS = 10_000

// Quitting on a busy computer. The app waits this long for its Hub to go, then this long for Electron
// to end, which a process outside it enforces. The first wait can't be cut short: Windows ends a child
// with its parent, and a tree stop can't find what the Hub started once the Hub has gone.
const QUIT_HUB_LIMIT_MS = Number(process.env.LOCAL_HUB_QUIT_LIMIT_MS) || 15_000
const QUIT_MAIN_AFTER_MS = 5000

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  platform.applyAppIdentity(app)
  // Not a top-level await: Electron holds `ready` back until this module has finished loading.
  app.whenReady().then(start)
}

function start() {
  nativeTheme.themeSource = 'dark' // the title bar goes with the Hub's dark look
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
      const { hubFolder } = settings.values
      const entry = resolveServerEntry({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        userData,
        version: app.getVersion(),
        hubFolder,
      })
      if (!entry) return null
      const ownFolder = hubFolder && entry === path.join(hubFolder, 'server.mjs')
      return spawnBundledHub({ entry, port, logFile, spawnOptions: platform.spawnOptions(), cleanEnv: app.isPackaged && !ownFolder, node: ownFolder ? findNode() : null })
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
    settingsWindow = new BrowserWindow({ icon: APP_ICON,
      width: 440,
      height: 440,
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
  handle('get-settings', () => ({ port: connection.port, hotkey: hotkey.current ?? settings.values.hotkey, hubFolder: settings.values.hubFolder }))
  handle('choose-hub-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(settingsWindow, { title: 'Choose the Hub folder', properties: ['openDirectory'], defaultPath: settings.values.hubFolder || undefined })
    return canceled ? null : filePaths[0] ?? null
  })
  handle('save-settings', async patch => {
    const changesFolder = patch?.hubFolder !== undefined && patch.hubFolder !== settings.values.hubFolder
    const changesPort = patch?.port !== undefined && patch.port !== connection.port
    // Checked first, so a refused save changes nothing.
    if (changesPort && !validPort(patch.port)) return { ok: false, error: 'The port must be a number from 1 to 65535.' }
    if (changesFolder && patch.hubFolder !== '' && !(typeof patch.hubFolder === 'string' && isHubFolder(patch.hubFolder))) return { ok: false, error: 'That folder has no Hub in it. Choose the one with server.mjs.' }
    if (patch?.hotkey !== undefined) {
      const applied = typeof patch.hotkey === 'string' ? hotkey.set(patch.hotkey.trim()) : { ok: false, error: 'No hotkey given.' }
      if (!applied.ok) return { ok: false, error: applied.error }
      settings.update({ hotkey: applied.hotkey })
    }
    if (changesFolder) settings.update({ hubFolder: patch.hubFolder })
    if (changesPort) settings.update({ port: patch.port })
    // Our own Hub starts again from the new place. One started elsewhere is left running.
    if (changesPort || (changesFolder && (connection.ownsHub || connection.state.status !== 'online'))) await connection.setPort(settings.values.port)
    trayControls.refresh()
    return { ok: true }
  })

  const hotkeyResult = hotkey.set(settings.values.hotkey)
  if (!hotkeyResult.ok) console.error(hotkeyResult.error)

  const tv = new TvStatus({ connection })
  const tell = body => { if (Notification.isSupported()) new Notification({ title: APP_NAME, body }).show() }
  const sendToTv = async command => { if (!(await tv.command(command))) tell('The hub didn’t pass that to the TV. Try again in a moment.') }

  const trayControls = createTray({
    connection,
    tv,
    tvActions: {
      onTv: sendToTv,
      onTvListen: async on => {
        if (!(await tv.setListening(on))) tell('That setting didn’t save. Try again in a moment.')
        trayControls.refresh()
      },
      onTvLink: () => {
        const url = linkFrom(clipboard.readText())
        if (url) sendToTv({ type: 'open', url })
        else tell('Copy a web link first, then send it to the TV.')
      },
      onTvSetup: () => mainWindow.openHubUrl(`${connection.origin}/#tv-setup`),
    },
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
    tv.stop()
    if (stopped) return
    event.preventDefault()
    stopped = true
    // Gone at once however long the rest takes, and saved first in case Electron has to be ended.
    trayControls.tray.destroy()
    session.fromPartition('persist:hub').flushStorageData()
    // Waits for our own child to be gone. An attached Hub has no child, so this leaves it running.
    connection.stop({ limitMs: QUIT_HUB_LIMIT_MS }).finally(() => setImmediate(() => {
      spawnQuitGuard(QUIT_MAIN_AFTER_MS)
      app.exit(0)
    }))
  })

  mainWindow.create({ visible: !startHidden })
  launcher.create()
  tv.start()
  connection.start({ graceMs: startHidden ? LOGIN_GRACE_MS : 0 })
}
