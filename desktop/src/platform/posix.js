// Mac and Linux placeholders so the rest of the app stays platform-neutral. Written, not yet run:
// Windows is the only platform tested in phase 1.

// The child runs as its own process group (spawnOptions), so the group can be signalled as a whole.
export const stopProcessTree = pid => new Promise(resolve => {
  try { process.kill(-pid, 'SIGTERM') } catch {}
  resolve()
})

// Can't tell yet, and the app only stops its own Hub early on evidence, so here it never does.
export const portHolders = async () => null

export const spawnOptions = () => ({ detached: true })

export const getLoginItem = app => app.getLoginItemSettings().openAtLogin

export const setLoginItem = (app, on) => app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] })

export const applyAppIdentity = () => {}

// Mac needs a real menu for copy and paste to work.
export const installAppMenu = Menu => {
  if (process.platform !== 'darwin') return Menu.setApplicationMenu(null)
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]))
}

export const onActivate = showMainWindow => showMainWindow()
