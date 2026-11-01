import { Menu, Tray, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'

import { APP_NAME } from './app-name.js'

const ICON = fileURLToPath(new URL('../assets/tray.png', import.meta.url))

const STATUS_TEXT = {
  online: mode => (mode === 'bundled' ? 'Hub: running inside this app' : 'Hub: connected'),
  connecting: () => 'Hub: starting',
  offline: () => 'Hub: not answering',
  conflict: () => 'Hub: port in use by another program',
}

export function createTray({ connection, onOpen, onLauncher, onSettings, getLogin, setLogin, getHotkey, onQuit }) {
  const tray = new Tray(nativeImage.createFromPath(ICON))
  const refresh = () => {
    const { status, mode } = connection.state
    const summary = STATUS_TEXT[status]?.(mode) ?? 'Hub'
    tray.setToolTip(`${APP_NAME}\n${summary}`)
    tray.setContextMenu(Menu.buildFromTemplate([
      { id: 'status', label: summary, enabled: false },
      { type: 'separator' },
      { id: 'open', label: `Open ${APP_NAME}`, click: onOpen },
      { id: 'launcher', label: 'Open launcher', accelerator: getHotkey() ?? undefined, registerAccelerator: false, click: onLauncher },
      { id: 'settings', label: 'Settings…', click: onSettings },
      { type: 'separator' },
      { id: 'login', label: 'Start at login', type: 'checkbox', checked: getLogin(), click: item => { setLogin(item.checked); refresh() } },
      { type: 'separator' },
      { id: 'quit', label: 'Quit', click: onQuit },
    ]))
  }
  tray.on('click', onOpen)
  connection.on('state', refresh)
  refresh()
  return { tray, refresh }
}
