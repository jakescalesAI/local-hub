// The main window. It shows the Hub when the Hub answers and the local "reconnecting" page when it
// doesn't, so a Hub restart never leaves a blank or error screen.
import { BrowserWindow, screen } from 'electron'

import { APP_ICON, APP_NAME } from './app-name.js'
import { pagePath, securePrefs, isHubUrl, isLocalPage } from './security.js'
import { fitToDisplays, MIN_SIZE } from './window-state.js'

// A quick restart keeps the page and whatever is typed into it. Past this, say what's going on.
const OFFLINE_AFTER_MS = 10_000
const SAVE_DELAY_MS = 400

const samePage = (current, target) => {
  try {
    const here = new URL(current)
    return here.origin === target.origin && here.pathname === target.pathname && here.search === target.search
  } catch {
    return false
  }
}

export class MainWindow {
  #win = null
  #connection
  #settings
  #showing = 'nothing'
  #lastHubUrl = null
  #offlineTimer = null
  #saveTimer = null
  #quitting = false
  #maximizeOnShow = false

  constructor({ connection, settings }) {
    this.#connection = connection
    this.#settings = settings
    connection.on('state', state => this.#onConnection(state))
    // A restart can fit between two polls, so no state change arrives. Check against what's on screen.
    connection.on('checked', state => { if (state.status === 'online') this.#onConnection(state) })
  }

  get window() { return this.#win }

  get showing() { return this.#showing }

  create({ visible }) {
    const fitted = fitToDisplays(this.#settings.values.window, screen.getAllDisplays())
    const win = new BrowserWindow({ icon: APP_ICON,
      ...fitted,
      minWidth: MIN_SIZE.width,
      minHeight: MIN_SIZE.height,
      title: APP_NAME,
      backgroundColor: '#14161a',
      show: false,
      autoHideMenuBar: true,
      webPreferences: securePrefs({ preload: true }),
    })
    this.#win = win
    // On a scaled display the constructor rounds the size up, so the window grew a little at every start.
    if (fitted.x !== undefined) win.setBounds(fitted)
    // maximize() also shows the window, so a start in the tray has to wait until it's opened.
    this.#maximizeOnShow = Boolean(this.#settings.values.window?.maximized)

    // The window keeps the app's name, whatever the page calls itself.
    win.on('page-title-updated', event => event.preventDefault())

    const contents = win.webContents
    contents.on('did-navigate', (_event, url) => this.#noteUrl(url))
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => { if (isMainFrame) this.#noteUrl(url) })
    contents.on('did-fail-load', (_event, code, _text, url, isMainFrame) => {
      // -3 is an aborted load, which is what our own next navigation does to the previous one.
      if (isMainFrame && code !== -3 && isHubUrl(url, this.#connection.origin)) this.#showOffline()
    })
    contents.on('render-process-gone', () => {
      this.#showing = 'nothing'
      if (this.#connection.state.status === 'online') this.#loadHub()
      else this.#showOffline()
    })
    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r'))) {
        event.preventDefault()
        if (this.#showing === 'hub') contents.reload()
        else this.#connection.checkNow()
      }
    })

    for (const change of ['move', 'resize', 'maximize', 'unmaximize']) win.on(change, () => this.#scheduleSave())
    win.on('close', event => {
      this.#saveNow()
      if (this.#quitting) return
      // Closing the window leaves the app in the tray; Quit is on the tray menu.
      event.preventDefault()
      win.hide()
    })
    // A page's own window.close() ends the window without asking 'close'. The tray has to keep working.
    win.on('closed', () => {
      this.#win = null
      clearTimeout(this.#offlineTimer)
      this.#showing = 'nothing'
      if (!this.#quitting) this.create({ visible: false })
    })
    win.once('ready-to-show', () => { if (visible) this.show() })

    this.#onConnection(this.#connection.state)
    return win
  }

  show() {
    const win = this.#win
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    if (this.#maximizeOnShow) win.maximize()
    this.#maximizeOnShow = false
    win.focus()
  }

  openHubUrl(url) {
    this.show()
    if (!this.#win || this.#win.isDestroyed()) return
    const contents = this.#win.webContents
    const target = new URL(url)
    // A link to the page already open only changes its hash, so a chat reply in progress isn't cut
    // off. Clearing the hash first means hashchange fires even when the same link comes twice.
    if (target.hash && this.#showing === 'hub' && samePage(contents.getURL(), target)) {
      contents.executeJavaScript(`history.replaceState(null, '', location.pathname + location.search); location.hash = ${JSON.stringify(target.hash)}`).catch(() => {})
      return
    }
    this.#win.loadURL(url).catch(() => {})
  }

  // Destroyed, not closed: closing asks the page first, and a stuck page or one that says no would keep
  // the app open.
  prepareToQuit() {
    this.#quitting = true
    clearTimeout(this.#offlineTimer)
    this.#saveNow()
    this.#win?.destroy()
  }

  #noteUrl(url) {
    if (isHubUrl(url, this.#connection.origin)) {
      this.#lastHubUrl = url
      this.#showing = 'hub'
    } else if (isLocalPage(url)) {
      this.#showing = 'offline'
    }
  }

  #onConnection(state) {
    clearTimeout(this.#offlineTimer)
    if (!this.#win || this.#win.isDestroyed()) return
    if (state.status === 'online') {
      // The URL check covers a port change: the old page is a Hub page, just not this Hub's.
      const onThisHub = this.#showing === 'hub' && isHubUrl(this.#win.webContents.getURL(), this.#connection.origin)
      if (!onThisHub && !this.#win.webContents.isLoading()) this.#loadHub()
      return
    }
    if (state.status === 'connecting' && this.#showing === 'nothing') return this.#showOffline()
    if (this.#showing === 'hub') {
      this.#offlineTimer = setTimeout(() => this.#showOffline(), OFFLINE_AFTER_MS)
      return
    }
    this.#showOffline()
  }

  #loadHub() {
    const origin = this.#connection.origin
    const url = this.#lastHubUrl && isHubUrl(this.#lastHubUrl, origin) ? this.#lastHubUrl : `${origin}/`
    this.#win.loadURL(url).catch(() => {})
  }

  #showOffline() {
    const { status, mode, reason } = this.#connection.state
    this.#showing = 'offline'
    this.#win.loadFile(pagePath('offline.html'), {
      query: { status, mode: mode ?? '', reason: reason ?? 'hub-stopped', port: String(this.#connection.port) },
    }).catch(() => {})
  }

  #scheduleSave() {
    clearTimeout(this.#saveTimer)
    this.#saveTimer = setTimeout(() => this.#saveNow(), SAVE_DELAY_MS)
  }

  #saveNow() {
    clearTimeout(this.#saveTimer)
    const win = this.#win
    if (!win || win.isDestroyed() || win.isMinimized()) return
    try {
      this.#settings.update({ window: { ...win.getNormalBounds(), maximized: win.isMaximized() } })
    } catch (error) {
      console.error('could not save the window position:', error.message)
    }
  }
}
