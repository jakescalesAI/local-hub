// The hotkey launcher: a small frameless always-on-top window that shows <hub>/launcher, or a
// built-in page when that route isn't there. It stays loaded while hidden so it opens instantly.
import { BrowserWindow, screen } from 'electron'

import { APP_NAME } from './app-name.js'
import { pagePath, securePrefs, isHubUrl } from './security.js'
import { launcherBounds, LAUNCHER_SIZE } from './window-state.js'

// Electron's default level only sits behind the taskbar, which on Windows can leave a window not on
// top at all. This one is above it.
const ON_TOP_LEVEL = 'pop-up-menu'

export class Launcher {
  #win = null
  #connection
  #onFallback = false
  #quitting = false

  constructor({ connection }) {
    this.#connection = connection
    connection.on('state', state => {
      if (!this.#live || this.isOpen) return
      if (state.status === 'online') this.#load()
      else if (!this.#onFallback) this.#showFallback()
    })
  }

  get window() { return this.#win }

  get #live() { return this.#win && !this.#win.isDestroyed() ? this.#win : null }

  get isOpen() { return Boolean(this.#live?.isVisible()) }

  get onFallback() { return this.#onFallback }

  create() {
    const win = new BrowserWindow({
      ...LAUNCHER_SIZE,
      title: `${APP_NAME} launcher`,
      frame: false,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      backgroundColor: '#14161a',
      webPreferences: securePrefs({ preload: true }),
    })
    this.#win = win
    win.on('page-title-updated', event => event.preventDefault())
    const contents = win.webContents
    // A Hub page handles Esc itself, since it may have a box to clear first, and calls window.close()
    // when it's done.
    contents.on('before-input-event', (event, input) => {
      if (this.#onFallback && input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        this.close()
      }
    })
    contents.on('did-navigate', (_event, url, code) => {
      if (isHubUrl(url, this.#connection.origin) && code >= 400) this.#showFallback()
    })
    contents.on('did-fail-load', (_event, code, _text, url, isMainFrame) => {
      if (isMainFrame && code !== -3 && isHubUrl(url, this.#connection.origin)) this.#showFallback()
    })
    contents.on('render-process-gone', () => this.#load())
    win.on('blur', () => this.close())
    win.on('close', event => {
      if (this.#quitting) return
      event.preventDefault()
      this.close()
    })
    // A page's own window.close() ends the window without asking 'close', so a new one takes its
    // place: hidden and freshly loaded, the same as closing it any other way.
    win.on('closed', () => {
      this.#win = null
      if (!this.#quitting) this.create()
    })
    this.#load()
    return win
  }

  toggle() {
    if (this.isOpen) this.close()
    else this.open()
  }

  open() {
    const win = this.#live
    if (!win) return
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const bounds = launcherBounds(workArea)
    // Twice on purpose: moving to a monitor with a different scale can size wrongly on the first call.
    win.setBounds(bounds)
    win.setBounds(bounds)
    win.setAlwaysOnTop(true, ON_TOP_LEVEL)
    win.show()
    win.focus()
    win.webContents.focus()
  }

  close() {
    const win = this.#live
    if (!win || !win.isVisible()) return
    win.hide()
    // Next time starts clean, and picks up the route as soon as a Hub provides it.
    this.#load()
  }

  prepareToQuit() {
    this.#quitting = true
  }

  #load() {
    if (!this.#live) return
    this.#onFallback = false
    this.#win.loadURL(`${this.#connection.origin}/launcher`).catch(() => {})
  }

  #showFallback() {
    if (!this.#live) return
    this.#onFallback = true
    this.#win.loadFile(pagePath('launcher.html')).catch(() => {})
  }
}
