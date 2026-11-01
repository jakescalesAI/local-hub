const hotkeyInput = document.getElementById('hotkey')
const portInput = document.getElementById('port')
const errorLine = document.getElementById('error')

const NAMED_KEYS = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
}

function acceleratorKey(event) {
  if (NAMED_KEYS[event.key]) return NAMED_KEYS[event.key]
  if (/^F([1-9]|1\d|2[0-4])$/.test(event.key)) return event.key
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
  if (/^Digit\d$/.test(event.code)) return event.code.slice(5)
  return null
}

hotkeyInput.addEventListener('keydown', event => {
  event.preventDefault()
  const key = acceleratorKey(event)
  const modifiers = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'].filter(Boolean)
  // A plain key would fire on every press of it everywhere, so a modifier is required (F-keys excepted).
  if (!key || (!modifiers.length && !/^F\d+$/.test(key))) return
  hotkeyInput.value = [...modifiers, key].join('+')
})

document.getElementById('form').addEventListener('submit', async event => {
  event.preventDefault()
  errorLine.textContent = ''
  const result = await window.hubDesktop.saveSettings({ hotkey: hotkeyInput.value, port: Number(portInput.value) })
  errorLine.textContent = result.ok ? '' : result.error
  if (result.ok) window.close()
})

document.getElementById('close').addEventListener('click', () => window.close())

window.hubDesktop.getSettings().then(({ hotkey, port }) => {
  hotkeyInput.value = hotkey
  portInput.value = port
})
