// The app's own settings, kept in one JSON file in the user data folder. Hub settings stay with the Hub.
import fs from 'node:fs'
import path from 'node:path'

export const DEFAULTS = Object.freeze({ port: 3100, hotkey: 'Ctrl+Alt+Space', window: null })

export const validPort = value => Number.isInteger(value) && value >= 1 && value <= 65535

function clean(saved) {
  const out = { ...DEFAULTS }
  if (validPort(saved?.port)) out.port = saved.port
  if (typeof saved?.hotkey === 'string' && saved.hotkey.trim()) out.hotkey = saved.hotkey.trim()
  if (saved?.window && typeof saved.window === 'object') out.window = saved.window
  return out
}

export class Settings {
  constructor(file) {
    this.file = file
    this.values = this.#read()
  }

  #read() {
    let text
    try { text = fs.readFileSync(this.file, 'utf8') } catch { return { ...DEFAULTS } }
    try { return clean(JSON.parse(text)) } catch {
      // A damaged file falls back to defaults, and the copy is kept so nothing is silently lost.
      try { fs.renameSync(this.file, `${this.file}.damaged`) } catch {}
      return { ...DEFAULTS }
    }
  }

  update(patch) {
    this.values = { ...this.values, ...patch }
    // Build the bytes first and swap them in whole, so a crash mid-write can't empty the file.
    const text = `${JSON.stringify(this.values, null, 2)}\n`
    const temp = `${this.file}.${process.pid}.tmp`
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(temp, text)
    fs.renameSync(temp, this.file)
    return this.values
  }
}
