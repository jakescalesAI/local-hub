// Finds the Hub and keeps track of it. No Electron in here: one polling loop decides everything.
//
// A Hub that was already answering is attached to and never stopped. Only a Hub this app started
// itself (`#child`) is restarted after a crash and stopped on quit.
import { EventEmitter } from 'node:events'

export async function probeHub(port, timeoutMs = 1500) {
  try {
    const res = await fetch(`http://localhost:${port}/api/ping`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
      cache: 'no-store',
    })
    // Read the body: another program on this port can also answer 200.
    const body = res.status === 200 ? await res.json().catch(() => null) : null
    return body?.ok === true ? 'hub' : 'other'
  } catch (error) {
    // Connection refused is an empty port. A timeout means something took the connection and said nothing.
    return error?.name === 'TimeoutError' ? 'silent' : 'none'
  }
}

const MAX_BACKOFF_MS = 30_000
const STABLE_AFTER_MS = 60_000

export class HubConnection extends EventEmitter {
  #child = null
  #childStartedAt = 0
  #childQuietSince = null
  #backoffMs = 1000
  #nextSpawnAt = 0
  #timer = null
  #running = false
  #graceUntil = 0

  constructor({ port, spawnHub, stopTree, probe = probeHub, pollMs = 2000, offlinePollMs = 1000, startTimeoutMs = 45_000 }) {
    super()
    this.port = port
    this.spawnHub = spawnHub
    this.stopTree = stopTree
    this.probe = probe
    this.pollMs = pollMs
    this.offlinePollMs = offlinePollMs
    this.startTimeoutMs = startTimeoutMs
    this.state = { status: 'connecting', mode: null, reason: 'starting' }
  }

  get origin() { return `http://localhost:${this.port}` }

  get ownsHub() { return this.#child !== null }

  // graceMs waits before starting our own Hub: at login, one started elsewhere may be seconds away.
  start({ graceMs = 0 } = {}) {
    this.#running = true
    this.#graceUntil = Date.now() + graceMs
    return this.#tick()
  }

  // The offline page's "Start the built-in Hub" button: an attached Hub went away and didn't return.
  useBundled() {
    if (this.state.mode === 'bundled' || this.state.status === 'online') return false
    this.#set({ mode: 'bundled', status: 'connecting', reason: 'starting' })
    this.#nextSpawnAt = 0
    this.#backoffMs = 1000
    this.checkNow()
    return true
  }

  checkNow() {
    if (!this.#running) return Promise.resolve()
    clearTimeout(this.#timer)
    return this.#tick()
  }

  async stop() {
    this.#running = false
    clearTimeout(this.#timer)
    const child = this.#child
    if (!child) return
    this.#child = null
    const gone = new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve()
      child.once('exit', resolve)
      setTimeout(resolve, 5000).unref?.()
    })
    await this.stopTree(child.pid)
    await gone
  }

  async setPort(port) {
    await this.stop()
    this.port = port
    this.#nextSpawnAt = 0
    this.#backoffMs = 1000
    this.#set({ status: 'connecting', mode: null, reason: 'starting' })
    return this.start()
  }

  #set(patch) {
    const next = { ...this.state, ...patch }
    const changed = ['status', 'mode', 'reason'].some(key => next[key] !== this.state[key])
    this.state = next
    if (changed) this.emit('state', next)
  }

  async #tick() {
    const port = this.port
    const seen = await this.probe(port)
    if (!this.#running || port !== this.port) return
    if (seen === 'hub') this.#onHub()
    else {
      this.#stopChildIfQuiet()
      if (seen === 'other') this.#set({ status: 'conflict', reason: 'port-conflict' })
      else if (seen === 'silent' && !this.#child && this.state.mode !== 'attached') this.#set({ status: 'conflict', reason: 'port-silent' })
      else this.#onNothing()
    }
    this.emit('checked', this.state)
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#tick(), this.state.status === 'online' ? this.pollMs : this.offlinePollMs)
  }

  #onHub() {
    // Our child died but something answers: another Hub took the port, and that one isn't ours.
    const mode = this.#child ? 'bundled' : 'attached'
    this.#childQuietSince = null
    this.#set({ status: 'online', mode, reason: null })
  }

  // A child that lost the port stays alive without listening (the real Hub logs EADDRINUSE and carries
  // on), and it never tries again. Neither will a hung one, so it's stopped, and the exit handler in
  // #spawn starts a new one with the usual backoff. Timed from the first check it missed, so waking
  // from sleep doesn't count as a long silence.
  #stopChildIfQuiet() {
    if (!this.#child) return
    const now = Date.now()
    this.#childQuietSince ??= now
    if (now - this.#childQuietSince <= this.startTimeoutMs) return
    this.#childQuietSince = now
    this.stopTree(this.#child.pid)
  }

  #onNothing() {
    const { mode } = this.state
    if (mode === 'attached') return this.#set({ status: 'offline', reason: 'hub-stopped' })
    if (mode === null && Date.now() < this.#graceUntil) return this.#set({ status: 'connecting', reason: 'starting' })
    if (this.#child) {
      const late = Date.now() - this.#childStartedAt > this.startTimeoutMs
      return this.#set({ status: 'offline', mode: 'bundled', reason: late ? 'not-answering' : 'starting' })
    }
    if (Date.now() >= this.#nextSpawnAt) return this.#spawn()
    this.#set({ status: 'offline', mode: 'bundled', reason: 'restarting' })
  }

  #spawn() {
    const child = this.spawnHub(this.port)
    if (!child) return this.#set({ status: 'offline', mode: null, reason: 'no-server' })
    this.#child = child
    this.#childStartedAt = Date.now()
    this.#childQuietSince = this.#childStartedAt
    this.#set({ status: 'offline', mode: 'bundled', reason: 'starting' })
    child.once('error', error => this.emit('child-error', error))
    child.once('exit', () => {
      if (this.#child !== child) return
      this.#child = null
      if (Date.now() - this.#childStartedAt > STABLE_AFTER_MS) this.#backoffMs = 1000
      this.#nextSpawnAt = Date.now() + this.#backoffMs
      this.#backoffMs = Math.min(this.#backoffMs * 2, MAX_BACKOFF_MS)
      this.emit('child-exit')
      this.checkNow()
    })
  }
}
