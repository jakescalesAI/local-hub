// Finds the Hub and keeps track of it. No Electron in here: one polling loop decides everything.
//
// A Hub that was already answering is attached to and never stopped. Only a Hub this app started
// itself (`#child`) is restarted after a crash and stopped on quit, and even that one is only stopped
// early when the port shows it isn't listening. A missed ping alone proves nothing: it may just be busy.
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
const MAX_START_TRIES = 3
const STOP_LIMIT_MS = 10_000
const STOP_WATCH_MS = 200

function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

export class HubConnection extends EventEmitter {
  #child = null
  #childStartedAt = 0
  #childQuietSince = null
  #stopAsked = null
  #failedStarts = 0
  #backoffMs = 1000
  #nextSpawnAt = 0
  #timer = null
  #running = false
  #graceUntil = 0

  // portHolders lists the pids listening on a port, or gives null when it can't tell.
  constructor({ port, spawnHub, stopTree, portHolders = async () => null, probe = probeHub, isAlive = processAlive, pollMs = 2000, offlinePollMs = 1000, startTimeoutMs = 45_000 }) {
    super()
    this.port = port
    this.spawnHub = spawnHub
    this.stopTree = stopTree
    this.portHolders = portHolders
    this.probe = probe
    this.isAlive = isAlive
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
    this.#startAfresh()
    this.checkNow()
    return true
  }

  checkNow() {
    if (!this.#running) return Promise.resolve()
    clearTimeout(this.#timer)
    return this.#tick()
  }

  // The offline page's "Try again" button, which also ends the wait after a Hub that wouldn't start.
  retry() {
    this.#startAfresh()
    return this.checkNow()
  }

  // Waits for our own child to be gone, up to limitMs. The tree stop carries on by itself after that.
  async stop({ limitMs = STOP_LIMIT_MS } = {}) {
    this.#running = false
    clearTimeout(this.#timer)
    const child = this.#child
    if (!child) return
    this.#child = null
    const isGone = () => child.exitCode !== null || child.signalCode !== null
    if (isGone()) return
    let watching
    await new Promise(resolve => {
      child.once('exit', resolve)
      setTimeout(resolve, limitMs).unref?.()
      // Under load the exit event can come many seconds after the Hub has gone, so ask the system too.
      watching = setInterval(() => { if (!this.isAlive(child.pid)) resolve() }, STOP_WATCH_MS)
      // A tree stop that finished with the Hub still here has failed. The Hub at least can still go.
      const afterTreeStop = () => { if (!isGone()) child.kill?.() }
      this.stopTree(child.pid).then(afterTreeStop, afterTreeStop)
    })
    clearInterval(watching)
  }

  async setPort(port) {
    await this.stop()
    this.port = port
    this.#startAfresh()
    this.#set({ status: 'connecting', mode: null, reason: 'starting' })
    return this.start()
  }

  #startAfresh() {
    this.#failedStarts = 0
    this.#nextSpawnAt = 0
    this.#backoffMs = 1000
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
    else await this.#onMissed(seen)
    if (!this.#running || port !== this.port) return
    this.emit('checked', this.state)
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#tick(), this.state.status === 'online' ? this.pollMs : this.offlinePollMs)
  }

  #onHub() {
    // Our child died but something answers: another Hub took the port, and that one isn't ours.
    const mode = this.#child ? 'bundled' : 'attached'
    this.#childQuietSince = null
    this.#failedStarts = 0
    this.#set({ status: 'online', mode, reason: null })
  }

  async #onMissed(seen) {
    // It answered a moment ago and something still takes the connection: busy, so its page stays up.
    if (seen === 'silent' && this.state.mode === 'attached' && this.state.status === 'online') return this.#set({ reason: 'slow' })
    const child = this.#child
    if (child) {
      const port = this.port
      const holders = await this.portHolders(port)
      if (!this.#running || port !== this.port || child !== this.#child) return
      if (holders?.includes(child.pid)) return this.#onChildListening(seen)
      // A Hub that can't get the port logs EADDRINUSE and carries on without it, and it never tries
      // again. Waiting won't help it, and the exit handler in #spawn starts a new one later.
      if (holders?.length) this.#stopChild(child)
      else if (holders) this.#stopChildIfStartTooLong(child)
    }
    if (seen === 'other') this.#set({ status: 'conflict', reason: 'port-conflict' })
    else if (seen === 'silent' && !this.#child && this.state.mode !== 'attached') this.#set({ status: 'conflict', reason: 'port-silent' })
    else await this.#onNothing()
  }

  // Alive and listening is never a reason to stop it, however slow it is. A slow Hub's page still works.
  #onChildListening(seen) {
    this.#childQuietSince = null
    this.#failedStarts = 0
    if (seen === 'silent') this.#set({ status: 'online', mode: 'bundled', reason: 'slow' })
    else this.#set({ status: 'offline', mode: 'bundled', reason: 'not-answering' })
  }

  // Alive with nothing on the port: still starting, or stuck. Each try gets twice as long as the one
  // before, so a slow computer gets there, and after the last one the app stops and says so. Timed from
  // the first check it missed, so waking from sleep doesn't count as a long silence.
  #stopChildIfStartTooLong(child) {
    const now = Date.now()
    this.#childQuietSince ??= now
    if (now - this.#childQuietSince <= this.startTimeoutMs * 2 ** this.#failedStarts) return
    this.#childQuietSince = now
    this.#failedStarts += 1
    this.#stopChild(child)
  }

  #stopChild(child) {
    if (this.#stopAsked === child) return
    this.#stopAsked = child
    this.stopTree(child.pid)
  }

  async #onNothing() {
    const { mode } = this.state
    if (mode === 'attached') return this.#set({ status: 'offline', reason: 'hub-stopped' })
    if (mode === null && Date.now() < this.#graceUntil) return this.#set({ status: 'connecting', reason: 'starting' })
    if (this.#child) {
      const late = Date.now() - this.#childStartedAt > this.startTimeoutMs
      return this.#set({ status: 'offline', mode: 'bundled', reason: late ? 'not-answering' : 'starting' })
    }
    if (this.#failedStarts >= MAX_START_TRIES) return this.#set({ status: 'offline', mode: 'bundled', reason: 'start-failed' })
    if (Date.now() < this.#nextSpawnAt) return this.#set({ status: 'offline', mode: 'bundled', reason: 'restarting' })
    // A program can drop every connection and still hold the port, so the check above saw it as empty.
    const port = this.port
    const holders = await this.portHolders(port)
    if (!this.#running || port !== this.port || this.#child) return
    if (holders?.length) return this.#set({ status: 'conflict', reason: 'port-silent' })
    this.#spawn()
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
