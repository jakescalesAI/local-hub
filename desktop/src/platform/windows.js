import { execFile } from 'node:child_process'
import path from 'node:path'

import { APP_ID } from '../app-name.js'

const TASKKILL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')

// A programmatic kill on Windows runs no signal handler and leaves grandchildren (the Hub's ssh
// tunnels, say) behind, so the whole tree goes by its root pid. Only ever called with our own child.
export const stopProcessTree = pid => new Promise(resolve => {
  execFile(TASKKILL, ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve())
})

export const spawnOptions = () => ({})

// The installed app starts itself; a from-source run also has to name the app folder.
const loginArgs = app => (app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'])

export const getLoginItem = app =>
  app.getLoginItemSettings({ path: process.execPath, args: loginArgs(app) }).openAtLogin

export const setLoginItem = (app, on) =>
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: loginArgs(app) })

export const applyAppIdentity = app => app.setAppUserModelId(APP_ID)

// Windows handles copy, paste and the like without a menu, so the app needs none.
export const installAppMenu = Menu => Menu.setApplicationMenu(null)

// The tray is how you get back to a hidden window; there's nothing to do when the app is re-activated.
export const onActivate = () => {}
