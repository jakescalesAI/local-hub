// Loaded with `-r` ahead of the app in end-to-end tests, so the app itself carries no test code.
// It keeps tests off the desktop they run on: windows open off-screen and never take focus, login
// items are never written and nothing opens in the real browser. What it stubs is recorded on
// global.__lh, so tests can read what the app asked for. The real focus change is not covered here.
const childProcess = require('node:child_process')
const { syncBuiltinESMExports } = require('node:module')
const { app, BrowserWindow, Tray, shell } = require('electron')

const OFF_SCREEN = -32000
const lh = { external: [], loginCalls: [], loginOn: false, shown: [], focusCalls: 0, trayMenu: null, tray: null }
global.__lh = lh

app.setPath('userData', process.env.LH_TEST_USER_DATA)

// Electron's main process doesn't take NODE_OPTIONS' --require, so tests/tools/net-audit.ps1 reaches it here.
if (process.env.LH_NET_AUDIT_NODE_LOG) require('../tools/connect-log.cjs')

// For the test that shows a quit doesn't depend on the Hub's exit event.
if (process.env.LH_TEST_NO_HUB_EXIT_EVENT === '1') {
  const { spawn } = childProcess
  childProcess.spawn = (command, args, ...rest) => {
    const child = spawn(command, args, ...rest)
    if (args?.some(arg => String(arg).endsWith('hub-runner.mjs'))) {
      const emit = child.emit
      child.emit = (name, ...details) => (name === 'exit' ? false : emit.call(child, name, ...details))
    }
    return child
  }
  syncBuiltinESMExports()
}

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
