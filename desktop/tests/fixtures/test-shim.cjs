// Loaded with `-r` ahead of the app in end-to-end tests, so the app itself carries no test code.
// It keeps tests off the desktop they run on: windows open off-screen and never take focus, login
// items are never written and nothing opens in the real browser. What it stubs is recorded on
// global.__lh, so tests can read what the app asked for. The real focus change is not covered here.
const { app, BrowserWindow, Tray, shell } = require('electron')

const OFF_SCREEN = -32000
const lh = { external: [], loginCalls: [], loginOn: false, shown: [], focusCalls: 0, trayMenu: null, tray: null }
global.__lh = lh

app.setPath('userData', process.env.LH_TEST_USER_DATA)

app.setLoginItemSettings = settings => {
  lh.loginCalls.push(settings)
  lh.loginOn = Boolean(settings.openAtLogin)
}
app.getLoginItemSettings = () => ({ openAtLogin: lh.loginOn })

shell.openExternal = async url => { lh.external.push(url) }

const showInactive = BrowserWindow.prototype.showInactive
BrowserWindow.prototype.show = function show() {
  lh.shown.push({ id: this.id, bounds: this.getBounds() })
  this.setSkipTaskbar(true)
  this.setPosition(OFF_SCREEN, OFF_SCREEN)
  showInactive.call(this)
}
BrowserWindow.prototype.focus = function focus() { lh.focusCalls += 1 }
BrowserWindow.prototype.moveTop = function moveTop() {}
// maximize() would also show the window on whichever monitor it lands on.
BrowserWindow.prototype.maximize = function maximize() { lh.maximized = true }

app.on('web-contents-created', (_event, contents) => {
  contents.focus = () => { lh.focusCalls += 1 }
})

const setContextMenu = Tray.prototype.setContextMenu
Tray.prototype.setContextMenu = function capture(menu) {
  lh.tray = this
  lh.trayMenu = menu
  return setContextMenu.call(this, menu)
}
