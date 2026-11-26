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

// "&" marks a shortcut letter in a Windows menu, so a name with one has it doubled.
const plain = name => name.replaceAll('&', '&&')

function tvLine(status, tv) {
  if (status !== 'online') return 'TV: waiting for the hub'
  if (!tv) return null
  if (tv.on) return 'TV: connected'
  return tv.setUp ? 'TV: not connected' : 'TV: not set up'
}

function tvItems(status, tv, { onTv, onTvListen, onTvLink, onTvSetup }) {
  if (status !== 'online' || !tv) return []
  const items = [{ type: 'separator' }]
  if (tv.on) {
    items.push({ id: 'tv-home', label: 'Show home screen', click: () => onTv({ type: 'home' }) })
    if (tv.apps.length) items.push({ id: 'tv-apps', label: 'Open an app', submenu: tv.apps.map(name => ({ label: plain(name), click: () => onTv({ type: 'launch', app: name }) })) })
    items.push(
      { id: 'tv-link', label: 'Send copied link', click: onTvLink },
      { id: 'tv-saver', label: 'Start screensaver', click: () => onTv({ type: 'saver' }) },
      { id: 'tv-sleep', label: 'Put to sleep', click: () => onTv({ type: 'sleep' }) },
    )
  }
  if (tv.on || tv.setUp) items.push({ id: 'tv-listen', label: `Hey ${APP_NAME}`, type: 'checkbox', checked: tv.listening, click: item => onTvListen(item.checked) })
  items.push({ id: 'tv-setup', label: 'Set up a TV', click: onTvSetup })
  return items
}

export function createTray({ connection, tv, tvActions, onOpen, onLauncher, onSettings, getLogin, setLogin, getHotkey, getUpdate = () => null, onUpdate = () => {}, onQuit }) {
  const tray = new Tray(nativeImage.createFromPath(ICON))
  const refresh = () => {
    if (tray.isDestroyed()) return
    const { status, mode } = connection.state
    const summary = STATUS_TEXT[status]?.(mode) ?? 'Hub'
    const line = tvLine(status, tv.state)
    tray.setToolTip([APP_NAME, summary, line].filter(Boolean).join('\n'))
    tray.setContextMenu(Menu.buildFromTemplate([
      { id: 'status', label: summary, enabled: false },
      ...(line ? [{ id: 'tv-status', label: line, enabled: false }] : []),
      { type: 'separator' },
      { id: 'open', label: `Open ${APP_NAME}`, click: onOpen },
      { id: 'launcher', label: 'Open launcher', accelerator: getHotkey() ?? undefined, registerAccelerator: false, click: onLauncher },
      ...tvItems(status, tv.state, tvActions),
      { type: 'separator' },
      { id: 'settings', label: 'Settings…', click: onSettings },
      { type: 'separator' },
      { id: 'login', label: 'Start at login', type: 'checkbox', checked: getLogin(), click: item => { setLogin(item.checked); refresh() } },
      { type: 'separator' },
      ...(getUpdate()?.status === 'ready' ? [{ id: 'update', label: `Restart to update to ${getUpdate().version}`, click: onUpdate }] : []),
      { id: 'quit', label: 'Quit', click: onQuit },
    ]))
  }
  tray.on('click', onOpen)
  connection.on('state', refresh)
  tv.on('state', refresh)
  refresh()
  return { tray, refresh }
}
