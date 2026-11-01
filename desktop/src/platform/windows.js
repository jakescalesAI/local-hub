import { execFile } from 'node:child_process'
import path from 'node:path'

import { APP_ID } from '../app-name.js'

const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
const TASKKILL = path.join(SYSTEM32, 'taskkill.exe')
const NETSTAT = path.join(SYSTEM32, 'netstat.exe')

// A programmatic kill on Windows runs no signal handler and leaves grandchildren (the Hub's ssh
// tunnels, say) behind, so the whole tree goes by its root pid. Only ever called with our own child.
export const stopProcessTree = pid => new Promise(resolve => {
  // Quitting waits on this, so a taskkill that hangs mustn't hold the app open for good.
  execFile(TASKKILL, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }, () => resolve())
})

// Only addresses a check on localhost reaches. A listener has foreign port 0, which is read instead of
// the state column because Windows translates that word.
const LOOPBACK = new Set(['127.0.0.1', '0.0.0.0', '[::1]', '[::]'])

export function listenersIn(netstatText, port) {
  const pids = new Set()
  for (const line of netstatText.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols[0] !== 'TCP' || !cols[2]?.endsWith(':0')) continue
    const split = cols[1].lastIndexOf(':')
    if (cols[1].slice(split + 1) === String(port) && LOOPBACK.has(cols[1].slice(0, split))) pids.add(Number(cols.at(-1)))
  }
  return [...pids]
}

export const portHolders = port => new Promise(resolve => {
  execFile(NETSTAT, ['-ano'], { windowsHide: true, timeout: 5000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
    resolve(error ? null : listenersIn(stdout, port))
  })
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
