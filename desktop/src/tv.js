// The TV, as the tray knows it: asks the Hub every few seconds while the Hub answers, and sends it commands.
// No Electron in here.
import { EventEmitter } from 'node:events'

const POLL_MS = 10_000
const TIMEOUT_MS = 4000
const MAX_LINK = 2000

// The one web link on the clipboard, or null: only an ordinary http(s) page goes to the TV.
export function linkFrom(text) {
  const raw = String(text ?? '').trim()
  if (!raw || raw.length > MAX_LINK || /\s/.test(raw)) return null
  try {
    const url = new URL(raw)
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

// What the Hub said, or null when it has no TV part (an older Hub).
export function readStatus(body) {
  const tv = body?.tv
  if (!tv || typeof tv !== 'object') return null
  return {
    on: tv.on === true,
    setUp: tv.setUp === true,
    apps: Array.isArray(tv.apps) ? tv.apps.filter(name => typeof name === 'string' && name) : [],
    listening: body.listen?.on === true,
  }
}

export class TvStatus extends EventEmitter {
  #connection
  #state = null
  #timer = null
  #polling = false
  #again = false
  #running = false

  constructor({ connection }) {
    super()
    this.#connection = connection
    connection.on('state', () => { if (this.#running) this.check() })
  }

  // null: the Hub is down, or hasn't said.
  get state() { return this.#state }

  start() {
    this.#running = true
    this.check()
  }

  stop() {
    this.#running = false
    clearTimeout(this.#timer)
  }

  async check() {
    if (this.#polling) { this.#again = true; return }
    this.#polling = true
    clearTimeout(this.#timer)
    let next = null
    if (this.#connection.state.status === 'online') {
      try {
        const res = await this.#fetch('/api/tv/status')
        if (res.ok) next = readStatus(await res.json())
      } catch {}
    }
    this.#polling = false
    if (!this.#running) return
    if (JSON.stringify(next) !== JSON.stringify(this.#state)) {
      this.#state = next
      this.emit('state', next)
    }
    if (this.#again) { this.#again = false; return this.check() }
    this.#timer = setTimeout(() => this.check(), POLL_MS)
    this.#timer.unref?.()
  }

  command(command) { return this.#post('/api/tv/command', command) }

  async setListening(on) {
    const ok = await this.#post('/api/tv/listen', { on })
    await this.check()
    return ok
  }

  async #post(path, body) {
    try {
      const res = await this.#fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify(body) })
      return res.ok
    } catch { return false }
  }

  #fetch(path, options = {}) {
    return fetch(this.#connection.origin + path, { ...options, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
  }
}
