// Owns the one global hotkey. A binding that can't be registered never costs the working one.
import { globalShortcut } from 'electron'

export class Hotkey {
  #current = null
  #onPress

  constructor(onPress) {
    this.#onPress = onPress
  }

  get current() { return this.#current }

  #register(accelerator) {
    try { return globalShortcut.register(accelerator, this.#onPress) } catch { return false }
  }

  set(accelerator) {
    if (accelerator === this.#current) return { ok: true, hotkey: accelerator }
    const previous = this.#current
    if (previous) globalShortcut.unregister(previous)
    if (this.#register(accelerator)) {
      this.#current = accelerator
      return { ok: true, hotkey: accelerator }
    }
    if (previous) this.#register(previous)
    return { ok: false, hotkey: previous, error: `${accelerator} isn't available. It may be invalid or in use by another app.` }
  }

  clear() {
    globalShortcut.unregisterAll()
    this.#current = null
  }
}
