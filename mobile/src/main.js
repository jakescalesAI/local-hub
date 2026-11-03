// The app shell: pairing, status, sharing into chat. The Hub page itself opens in a separate web view
// with no bridge, so nothing on that page can reach native code or the token.
import { DEMO_ADDRESS, DEMO_CODE, cleanCode, isCode, normalizeAddress, parsePairLink, showCode } from './lib/address.js'
import { MAX_SHARE_CHARS, createClient } from './lib/client.js'
import { parseQuickAction } from './lib/actions.js'
import { lockName, lockUnavailable, unlockMessage } from './lib/lock.js'
import { createQueue } from './lib/queue.js'
import { STATES, classify } from './lib/status.js'
import * as native from './lib/native.js'
import { h } from './lib/dom.js'

const LOCAL_HTTP = __DEV__ || __LOCAL_HTTP__
const CHECK_EVERY_MS = 30_000
const DEMO_STATES = [['ok', 'Connected'], ['asleep', 'Asleep'], ['stopped', 'Stopped'], ['offline', 'Offline'], ['removed', 'Removed']]

const client = createClient({ http: native.http })
const root = document.getElementById('app')

const app = {
  screen: 'welcome',
  conn: null, // { address, hubName, hubId, deviceId, lastSeen, demo? }
  hub: null,
  queue: null,
  state: 'checking',
  online: true,
  waiting: [],
  notice: '',
  draft: '',
  shareDraft: '',
  shareFrom: 'home',
  pairForm: { address: '', code: '' },
  pairing: null, // { address, code }, waiting on the person's yes
  error: '',
  busy: false,
  demoState: 'ok',
  demoSent: [],
  lock: { enabled: false, available: false, reason: '', kind: '' },
  locked: null, // { message, changed, forgetting } while locked. Every screen but the lock's is off.
  unlocking: false,
  lockNote: '',
  hubOpen: false,
  hubWasOpen: false,
  openWhenChecked: false,
  deferredLink: '',
  deferredShare: '',
}

// --- Hubs: a real one over the network, or the built-in demo

function realHub(conn, token) {
  return {
    check: () => client.check(conn.address, token),
    send: text => client.send(conn.address, token, text),
    open: () => native.openHub(conn.address, token),
    forget: () => client.removeSelf(conn.address, token, conn.deviceId),
  }
}

function demoHub() {
  return {
    check: async () => {
      if (app.demoState === 'ok') return { status: 200, hub: { name: 'Demo Hub' } }
      return { status: { asleep: null, stopped: 503, removed: 401, offline: null }[app.demoState] }
    },
    send: async text => (app.demoSent.push(text), { result: 'sent' }),
    open: async () => show('demoHub'),
    forget: async () => true,
  }
}

function connect(conn, hub, storage) {
  app.conn = conn
  app.hub = hub
  // With the lock on there's no hub until it's unlocked, so nothing can go out.
  app.queue = createQueue({ storage, send: async text => (app.hub ? app.hub.send(text) : { result: 'stopped' }) })
  app.state = 'checking'
  app.notice = ''
}

const memoryStorage = () => {
  const data = new Map()
  return { get: async k => data.get(k) ?? null, set: async (k, v) => void data.set(k, v) }
}

function startDemo() {
  app.demoState = 'ok'
  app.demoSent = []
  connect({ address: DEMO_ADDRESS, hubName: 'Demo Hub', demo: true, lastSeen: Date.now() }, demoHub(), memoryStorage())
  show('home')
  refresh()
}

async function pair() {
  const { address, code } = app.pairing
  app.busy = true
  app.error = ''
  render()
  if (address === DEMO_ADDRESS && code === DEMO_CODE) {
    app.busy = false
    app.pairing = null
    return startDemo()
  }
  const r = await client.claim(address, code, native.deviceInfo())
  app.busy = false
  if (!r.ok) {
    app.error = r.error
    return render()
  }
  const conn = { address, hubName: r.hub.name, hubId: r.hub.id, deviceId: r.deviceId, lastSeen: Date.now() }
  try {
    // A demo's lock has nothing to do with a real Hub.
    if (app.conn?.demo && app.lock.enabled) await clearLock()
    await native.saveConnection(conn, r.token)
  } catch {
    app.error = 'This device couldn\'t store the connection securely. Nothing was saved.'
    return render()
  }
  app.pairing = null
  app.pairForm = { address: '', code: '' }
  connect(conn, realHub(conn, r.token), native.queueStorage)
  show(app.shareDraft ? 'share' : 'home')
  refresh()
}

async function forget() {
  const { demo } = app.conn
  const { hub } = app
  app.busy = true
  render()
  let removed = true
  let cleared = true
  if (app.lock.enabled) await clearLock()
  if (!demo) {
    removed = await hub.forget()
    await native.clearConnection()
    await app.queue.clear()
    cleared = await native.clearHubCookies()
  }
  app.busy = false
  app.locked = null
  app.conn = app.hub = app.queue = null
  app.waiting = []
  app.draft = ''
  if (!removed) app.notice = 'This device is forgotten here, but your Hub couldn\'t be reached. It stays on the Hub\'s list until you remove it there.'
  else app.notice = cleared ? '' : 'This device is forgotten here, but its sign-in to the Hub page couldn\'t be cleared. Remove it on your Hub to end its access.'
  show('welcome')
}

// --- Status

let checkSeq = 0
async function refresh() {
  if (!app.hub) return
  const seq = ++checkSeq
  const online = app.conn.demo ? app.demoState !== 'offline' : app.online
  const { status, nameRefused } = online ? await app.hub.check() : { status: null }
  if (seq !== checkSeq || !app.hub) return // a newer check, or the person left
  app.state = classify({ online, status, nameRefused })
  if (app.state === 'ok') {
    app.conn.lastSeen = Date.now()
    if (!app.conn.demo) native.saveConnectionInfo(app.conn)
    const r = await app.queue.flush()
    if (r.sent) app.notice = r.sent === 1 ? 'Your waiting message was sent.' : `${r.sent} waiting messages were sent.`
  }
  app.waiting = await app.queue.list()
  render()
  const open = app.openWhenChecked && !app.locked && STATES[app.state].canOpen
  app.openWhenChecked = false
  if (open) native.closeHub().then(() => { if (!app.locked) openPage() })
}

// --- Sharing into chat

async function sendText(text, done) {
  const clean = text.trim().slice(0, MAX_SHARE_CHARS)
  if (!clean) return
  app.busy = true
  render()
  const queued = await app.queue.add(clean)
  if (!queued.ok) {
    app.busy = false
    app.notice = queued.error
    return render()
  }
  // Nothing goes out while the Hub is known to be unreachable. It waits, and refresh sends it.
  if (app.state === 'ok') await app.queue.flush()
  app.waiting = await app.queue.list()
  app.busy = false
  const stillThere = app.waiting.find(i => i.id === queued.item.id)
  if (!stillThere) app.notice = 'Sent. The reply will be in your Hub\'s chat.'
  else if (stillThere.error) app.notice = stillThere.error
  else if (stillThere.unsure) app.notice = 'The connection dropped while sending. It may have arrived.'
  else app.notice = 'Saved. It will send when your Hub is reachable.'
  done()
  refresh()
}

function receiveShare(text) {
  if (!text) return
  app.shareDraft = String(text).slice(0, MAX_SHARE_CHARS)
  app.shareFrom = app.screen
  if (app.conn) show('share')
  else {
    app.notice = 'Pair with your Hub first, then your shared text will be ready to send.'
    show('welcome')
  }
}

function receivePairLink(link) {
  const parsed = parsePairLink(link, { dev: LOCAL_HTTP })
  if (!parsed) return false
  // A link can't swap this device onto another computer. Forgetting is a choice made in Settings.
  if (app.conn && !app.conn.demo) {
    app.notice = 'This device is already paired. To pair with another Hub, forget this one in Settings first.'
    if (app.screen !== 'share') show('home')
    refresh()
    return true
  }
  app.pairing = parsed
  app.error = ''
  show('confirm')
  return true
}

async function scan() {
  app.error = ''
  const r = await native.scanQr()
  if (r.cancelled) return render()
  if (!receivePairLink(r.text)) {
    app.error = r.error || 'That isn\'t a LocalHub pairing code.'
    render()
  }
}

// --- Links from outside the app: pairing, and the widget's quick actions

function handleLink(link) {
  if (!parseQuickAction(link) && !parsePairLink(link, { dev: LOCAL_HTTP })) return false
  // Nothing from outside acts while locked. It waits in memory until the person has unlocked.
  if (app.locked) {
    app.deferredLink = link
    return true
  }
  const action = parseQuickAction(link)
  if (action) return runQuickAction(action), true
  return receivePairLink(link)
}

function runQuickAction(action) {
  if (!app.conn) {
    app.notice = 'Pair with your Hub first.'
    return show('welcome')
  }
  // A message someone is reading before sending stays on screen.
  if (app.screen === 'share' || app.busy) return refresh()
  show('home')
  if (action === 'compose') root.querySelector('#draft')?.focus()
  app.openWhenChecked = action === 'open'
  refresh()
}

function openPage() {
  app.hubOpen = !app.conn.demo
  return app.hub.open().then(
    () => { if (app.locked) native.closeHub() }, // locked while it was opening
    () => { app.hubOpen = false },
  )
}

// --- Lock

let lockEpoch = 0
let autoPrompted = false

const lockedState = () => ({ message: '', changed: false, forgetting: false })

// Drops everything that can reach the Hub. Safe to call again, and it can't be undone from here: the
// only way back is the OS opening the token in unlock().
function lockNow() {
  if (!app.conn) return Promise.resolve()
  if (!app.locked) {
    app.hubWasOpen = app.hubWasOpen || app.hubOpen
    app.locked = lockedState()
  }
  app.hubOpen = false
  app.openWhenChecked = false
  app.hub = null
  checkSeq++
  render()
  return Promise.all([native.closeHub(), native.clearHubCookies()])
}

async function onLockEvent({ foreground }) {
  app.lock.enabled = true
  if (!foreground) {
    lockEpoch++ // a prompt still open can't unlock a lock that came after it
    autoPrompted = false
  }
  await lockNow()
  const { active } = await native.lockShown()
  if (active && foreground) promptOnce()
}

// Asks once each time the app comes back. After a cancel it waits for the Unlock button.
function promptOnce() {
  if (autoPrompted || !app.locked) return
  autoPrompted = true
  unlock()
}

async function unlock() {
  if (!app.locked || app.locked.changed || app.unlocking) return
  const epoch = lockEpoch
  app.unlocking = true
  app.locked.message = ''
  render()
  const r = await native.lockUnlock()
  app.unlocking = false
  if (!app.locked) return
  if (r.token && epoch === lockEpoch) return finishUnlock(r.token)
  if (r.changed) app.locked.changed = true
  app.locked.message = unlockMessage(r, lockName(app.lock.kind))
  render()
}

async function finishUnlock(token) {
  app.hub = app.conn.demo ? demoHub() : realHub(app.conn, token)
  app.locked = null
  app.waiting = await app.queue.list()
  if (app.locked) return // locked again while that was read
  const wasOpen = app.hubWasOpen
  const link = app.deferredLink
  const share = app.deferredShare
  app.hubWasOpen = false
  app.deferredLink = ''
  app.deferredShare = ''
  render({ focusTitle: true })
  receiveShare(share || (await native.takeShare()))
  if (app.locked) return
  if (link) handleLink(link)
  else if (wasOpen) runQuickAction('open')
  else refresh()
}

// The lock's own way out: for a key that can't be opened any more, or someone who can't unlock. No
// token is available, so the Hub can't be told, and the screen says so.
async function forgetFromLock() {
  app.unlocking = true
  render()
  try {
    await clearLock()
    await native.clearConnection()
    await app.queue.clear()
    await native.clearHubCookies()
  } catch {
    app.unlocking = false
    app.locked.message = 'That didn\'t work. Restart the device and try again.'
    return render()
  }
  app.unlocking = false
  app.locked = null
  app.conn = app.hub = app.queue = null
  app.waiting = []
  app.draft = ''
  app.deferredLink = ''
  app.deferredShare = ''
  app.hubWasOpen = false
  app.notice = 'This device is forgotten here. It stays on your Hub\'s list until you remove it there.'
  show('welcome')
}

async function clearLock() {
  await native.lockClear()
  app.lock = { ...app.lock, enabled: false }
}

async function refreshLockStatus() {
  try {
    app.lock = await native.lockStatus()
  } catch {
    app.lock = { ...app.lock, available: false, reason: '' }
  }
  if (!app.locked && app.screen === 'settings') render()
}

function openSettings() {
  app.lockNote = ''
  show('settings')
  refreshLockStatus()
}

async function turnLockOn() {
  app.busy = true
  app.lockNote = ''
  render()
  try {
    const token = app.conn.demo ? 'demo' : (await native.loadConnection())?.token
    if (!token) throw new Error('no token')
    const r = await native.lockEnable(token)
    if (r.enabled) {
      // The token now lives in one place only. If the old copy can't go, the lock isn't really on.
      if (!app.conn.demo) {
        try {
          await native.removePlainToken()
        } catch (e) {
          await native.lockClear()
          throw e
        }
        await native.clearHubCookies()
      }
      app.lock = { ...app.lock, enabled: true }
    } else if (!r.cancelled) {
      app.lockNote = unlockMessage(r, lockName(app.lock.kind)) || 'The lock couldn\'t be turned on. Nothing changed.'
    }
  } catch {
    app.lockNote = 'The lock couldn\'t be turned on. Nothing changed.'
  }
  app.busy = false
  await refreshLockStatus()
  render()
}

async function turnLockOff() {
  const epoch = lockEpoch
  app.busy = true
  app.lockNote = ''
  render()
  const r = await native.lockUnlock()
  app.busy = false
  if (app.locked) return render()
  if (r.changed) {
    lockNow()
    app.locked.changed = true
    return render()
  }
  if (r.token && epoch === lockEpoch) {
    try {
      if (!app.conn.demo) await native.saveConnection(app.conn, r.token)
      await clearLock()
    } catch {
      await native.removePlainToken().catch(() => {})
      app.lockNote = 'The lock couldn\'t be turned off. It stays on.'
    }
  } else {
    app.lockNote = unlockMessage(r, lockName(app.lock.kind))
  }
  await refreshLockStatus()
  render()
}

// --- Rendering

function show(screen) {
  app.screen = screen
  render({ focusTitle: true })
}

function render({ focusTitle = false } = {}) {
  const active = document.activeElement
  const keep = active?.dataset?.keep ? { key: active.dataset.keep, start: active.selectionStart, end: active.selectionEnd } : null
  root.replaceChildren(SCREENS[app.locked ? 'locked' : app.screen]())
  if (focusTitle) root.querySelector('h1')?.focus({ preventScroll: true })
  else if (keep) {
    const el = root.querySelector(`[data-keep="${keep.key}"]`)
    el?.focus()
    if (el && keep.start != null) el.setSelectionRange(keep.start, keep.end)
  }
}

const title = text => h('h1', { tabindex: '-1' }, text)
const button = (label, onclick, { kind = 'plain', disabled = false, test } = {}) =>
  h('button', { class: `btn ${kind}`, type: 'button', onclick, disabled: disabled || app.busy, 'data-test': test }, label)
const errorLine = text => h('p', { class: 'error', role: 'alert' }, text)
const noticeLine = () => (app.notice ? h('p', { class: 'notice', role: 'status', 'data-test': 'notice' }, app.notice) : null)
const back = (to, label = 'Back') => h('button', { class: 'link back', type: 'button', onclick: () => ((app.error = ''), show(to)) }, label)

// Not `button`: these stay live whatever else is still finishing behind the lock.
const lockButton = (label, onclick, { kind = 'plain', test } = {}) =>
  h('button', { class: `btn ${kind}`, type: 'button', onclick, disabled: app.unlocking, 'data-test': test }, label)

function when(at) {
  if (!at) return ''
  const mins = Math.round((Date.now() - at) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(at).toLocaleDateString()
}

const SCREENS = {
  welcome: () =>
    h('main', { class: 'screen center' },
      h('img', { class: 'logo', src: 'icon.png', alt: '', width: '72', height: '72' }),
      title('LocalHub'),
      h('p', { class: 'lead' }, 'Your own Hub, on this device. It connects straight to a computer you run, with no account and no server in between.'),
      noticeLine(),
      app.error ? errorLine(app.error) : null,
      h('div', { class: 'stack' },
        button('Scan pairing code', scan, { kind: 'primary', test: 'scan' }),
        button('Enter by hand', () => ((app.error = ''), show('pair')), { kind: 'tinted', test: 'by-hand' }),
        button('Try the demo', startDemo, { test: 'demo' })),
      h('p', { class: 'foot' }, 'To get a code, open /pair/new in your Hub on your computer.')),

  pair: () => {
    const submit = e => {
      e.preventDefault()
      const address = normalizeAddress(app.pairForm.address, { dev: LOCAL_HTTP })
      if (!address.ok) return ((app.error = address.error), render())
      const code = cleanCode(app.pairForm.code)
      if (!isCode(code)) return ((app.error = 'The code has 8 letters and numbers.'), render())
      app.pairing = { address: address.url, code }
      app.error = ''
      show('confirm')
    }
    return h('main', { class: 'screen' },
      back('welcome'),
      title('Enter by hand'),
      h('p', { class: 'sub' }, 'Your Hub\'s pairing page shows both of these. The code lasts 5 minutes.'),
      h('form', { class: 'card form', onsubmit: submit, novalidate: true },
        h('label', { for: 'address' }, 'Address'),
        h('input', { id: 'address', 'data-keep': 'address', type: 'url', inputmode: 'url', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'https://your-computer.example', value: app.pairForm.address, oninput: e => (app.pairForm.address = e.target.value) }),
        h('label', { for: 'code' }, 'Pairing code'),
        h('input', { id: 'code', 'data-keep': 'code', class: 'code', autocomplete: 'one-time-code', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', maxlength: '10', placeholder: 'ABCD 1234', value: app.pairForm.code, oninput: e => (app.pairForm.code = e.target.value) }),
        app.error ? errorLine(app.error) : null,
        h('button', { class: 'btn primary', type: 'submit', 'data-test': 'pair-next' }, 'Continue')))
  },

  // Everything that pairs comes through here, QR and links included, so a hostile link can't connect
  // the phone to someone else's server without the person seeing where it goes.
  confirm: () =>
    h('main', { class: 'screen' },
      back(app.conn ? 'home' : 'welcome', 'Cancel'),
      title('Connect to this computer?'),
      h('div', { class: 'card rows' },
        h('div', { class: 'row' }, h('span', {}, 'Address'), h('strong', { 'data-test': 'confirm-address' }, app.pairing?.address)),
        h('div', { class: 'row' }, h('span', {}, 'Code'), h('strong', { class: 'mono' }, showCode(app.pairing?.code ?? '')))),
      h('p', { class: 'sub' }, 'Only connect to a Hub you run. It will be able to show pages inside this app, and anything you share goes to it.'),
      app.error ? errorLine(app.error) : null,
      h('div', { class: 'stack' }, button(app.busy ? 'Connecting' : 'Connect', pair, { kind: 'primary', test: 'pair-confirm' }))),

  home: () => {
    const s = STATES[app.state]
    return h('main', { class: 'screen home' },
      h('div', { class: 'topbar' }, h('button', { class: 'link', type: 'button', onclick: openSettings, 'data-test': 'settings' }, 'Settings')),
      title(app.conn.hubName),
      app.conn.demo ? h('p', { class: 'demo-note' }, 'Demo: sample data. Nothing leaves this device.') : null,
      h('div', { class: 'panes' },
        h('div', { class: 'pane', 'data-test': 'pane-status' },
          h('section', { class: `card status ${s.tone}`, 'aria-live': 'polite', 'data-test': 'status', 'data-state': app.state },
            h('div', { class: 'status-line' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('strong', {}, s.title)),
            s.body ? h('p', {}, s.body) : null,
            app.state !== 'ok' && app.conn.lastSeen ? h('p', { class: 'seen' }, `Last connected ${when(app.conn.lastSeen)}`) : null,
            s.canRetry ? button('Try again', refresh, { test: 'retry' }) : null,
            app.state === 'removed' ? button('Pair again', () => forgetLocal(), { kind: 'tinted', test: 'pair-again' }) : null),
          app.conn.demo
            ? h('div', { class: 'segments', role: 'group', 'aria-label': 'Show a state' },
                ...DEMO_STATES.map(([key, label]) => h('button', { type: 'button', class: key === app.demoState ? 'on' : '', 'aria-pressed': String(key === app.demoState), 'data-test': `demo-${key}`, onclick: () => ((app.demoState = key), refresh()) }, label)))
            : null,
          button('Open Hub', openPage, { kind: 'primary', disabled: !s.canOpen, test: 'open' }),
          noticeLine()),
        h('div', { class: 'pane', 'data-test': 'pane-compose' },
          h('section', { class: 'card compose' },
            h('label', { for: 'draft' }, 'Send to Hub chat'),
            h('textarea', { id: 'draft', 'data-keep': 'draft', rows: '3', maxlength: String(MAX_SHARE_CHARS), placeholder: 'Message your Hub\'s assistant', value: app.draft, oninput: e => (app.draft = e.target.value) }),
            button(app.state === 'ok' ? 'Send' : 'Send when reachable', () => sendText(app.draft, () => (app.draft = '')), { kind: 'tinted', test: 'send' })),
          waitingList())))
  },

  share: () =>
    h('main', { class: 'screen' },
      h('button', { class: 'link back', type: 'button', onclick: () => ((app.shareDraft = ''), show('home')), 'data-test': 'share-cancel' }, 'Cancel'),
      title('Send to Hub chat'),
      h('p', { class: 'sub' }, 'This goes to the assistant on your computer, which can use its tools. Read it first: text from a website can contain instructions you didn\'t write.'),
      h('section', { class: 'card compose' },
        h('label', { for: 'share', class: 'sr' }, 'Text to send'),
        h('textarea', { id: 'share', 'data-keep': 'share', 'data-test': 'share-text', rows: '8', maxlength: String(MAX_SHARE_CHARS), value: app.shareDraft, oninput: e => (app.shareDraft = e.target.value) })),
      h('div', { class: 'stack' },
        button(app.state === 'ok' ? 'Send' : 'Send when reachable', () => sendText(app.shareDraft, () => { app.shareDraft = ''; show('home') }), { kind: 'primary', test: 'share-send' }))),

  settings: () =>
    h('main', { class: 'screen wide' },
      back('home'),
      title('Settings'),
      h('div', { class: 'card rows' },
        h('div', { class: 'row' }, h('span', {}, 'Hub'), h('strong', {}, app.conn.hubName)),
        h('div', { class: 'row' }, h('span', {}, 'Address'), h('strong', {}, app.conn.demo ? 'Built-in demo' : app.conn.address)),
        h('div', { class: 'row' }, h('span', {}, 'Version'), h('strong', {}, __VERSION__))),
      h('h2', {}, 'Lock'),
      lockCard(),
      h('h2', {}, 'Your data'),
      h('div', { class: 'card prose' },
        h('p', {}, 'This app has no account, no analytics and no server of its own. Everything you send goes only to the Hub address above.'),
        h('p', {}, 'The key that connects this device is kept in the system\'s secure storage. It isn\'t backed up and it never appears in a web page. With the lock on, the system only opens it after a biometric check.'),
        h('p', {}, 'Your Hub\'s address and any text waiting to send are ordinary app data, with or without the lock. On iPhone and iPad, a device backup such as iCloud Backup can include them. On Android they\'re left out of backups.'),
        h('p', {}, 'Hub chat runs on your computer, using the AI login you set up there. What you send to chat goes wherever that assistant sends it.')),
      h('div', { class: 'stack' }, button(app.conn.demo ? 'Leave the demo' : 'Forget this Hub', () => (app.conn.demo ? forget() : show('forget')), { kind: 'danger', test: 'forget' }))),

  forget: () =>
    h('main', { class: 'screen' },
      back('settings', 'Cancel'),
      title('Forget this Hub?'),
      h('p', { class: 'sub' }, `This device disconnects from ${app.conn.hubName}. Messages still waiting here are deleted. To connect again, you'll need a new code.`),
      h('div', { class: 'stack' }, button(app.busy ? 'Forgetting' : 'Forget this Hub', forget, { kind: 'danger', test: 'forget-confirm' }))),

  // Says nothing about the Hub: anyone holding the device can see this screen.
  locked: () => {
    const l = app.locked
    const name = lockName(app.lock.kind)
    if (l.forgetting) {
      return h('main', { class: 'screen', 'data-test': 'lock-forget' },
        h('button', { class: 'link back', type: 'button', onclick: () => ((l.forgetting = false), render({ focusTitle: true })), 'data-test': 'lock-forget-cancel' }, 'Cancel'),
        title('Forget this Hub here?'),
        h('p', { class: 'sub' }, 'The key on this device is deleted and the app starts over. It doesn\'t open anything. Messages still waiting here are deleted. To connect again, you\'ll need a new code.'),
        h('p', { class: 'sub' }, 'This device stays on your Hub\'s list until you remove it there.'),
        l.message ? errorLine(l.message) : null,
        h('div', { class: 'stack' }, lockButton('Forget this Hub', forgetFromLock, { kind: 'danger', test: 'lock-forget-confirm' })))
    }
    if (l.changed) {
      return h('main', { class: 'screen center', 'data-test': 'lock-changed' },
        h('img', { class: 'logo', src: 'icon.png', alt: '', width: '72', height: '72' }),
        title('Pair this device again'),
        h('p', { class: 'lead' }, 'The biometrics on this device changed, or the app was moved to a new device, so the system won\'t open the key that connects it. That\'s on purpose: someone who added a fingerprint or face can\'t get in with it.'),
        h('p', { class: 'foot' }, 'Nothing was deleted yet. Pairing again forgets this Hub here and needs a new code. This device stays on your Hub\'s list until you remove it there.'),
        l.message ? errorLine(l.message) : null,
        h('div', { class: 'stack' }, lockButton('Pair again', forgetFromLock, { kind: 'primary', test: 'lock-pair-again' })))
    }
    return h('main', { class: 'screen center', 'data-test': 'locked' },
      h('img', { class: 'logo', src: 'icon.png', alt: '', width: '72', height: '72' }),
      title('LocalHub is locked'),
      h('p', { class: 'lead' }, `Unlock with ${name} to continue.`),
      l.message ? h('p', { class: 'error', role: 'alert', 'data-test': 'lock-message' }, l.message) : null,
      h('div', { class: 'stack' },
        lockButton(app.unlocking ? 'Waiting' : 'Unlock', unlock, { kind: 'primary', test: 'unlock' }),
        lockButton('Can\'t unlock?', () => ((l.forgetting = true), render({ focusTitle: true })), { test: 'lock-cant' })))
  },

  startFailed: () =>
    h('main', { class: 'screen center' },
      h('img', { class: 'logo', src: 'icon.png', alt: '', width: '72', height: '72' }),
      title('LocalHub couldn\'t start'),
      h('p', { class: 'lead' }, 'This device\'s secure storage didn\'t respond. Nothing was changed. Try again, or restart the device if this keeps happening.'),
      noticeLine(),
      h('div', { class: 'stack' },
        button('Try again', () => location.reload(), { kind: 'primary', test: 'start-retry' }),
        button('Forget this Hub here', forgetAndRestart, { disabled: app.busy, test: 'start-forget' })),
      h('p', { class: 'foot' }, 'Forgetting lets you pair again. Text waiting to send is lost, and this device stays on your Hub\'s list until you remove it there.')),

  demoHub: () =>
    h('main', { class: 'hubview' },
      h('div', { class: 'hubbar' }, h('button', { class: 'link', type: 'button', onclick: () => show('home'), 'data-test': 'demo-done' }, 'Done'), h('span', {}, 'Demo Hub')),
      h('iframe', { src: 'demo-hub.html', title: 'Demo Hub', sandbox: '' })),
}

function lockCard() {
  const name = lockName(app.lock.kind)
  const note = app.lockNote ? h('p', { class: 'error', role: 'alert', 'data-test': 'lock-note' }, app.lockNote) : null
  if (app.lock.enabled) {
    return h('div', { class: 'card prose', 'data-test': 'lock-card', 'data-lock': 'on' },
      h('p', {}, `On. LocalHub locks as soon as you leave it, and only ${name} unlocks it. The device passcode doesn't.`),
      h('p', {}, 'If your biometrics change, you\'ll need to pair again. That\'s on purpose.'),
      note,
      button('Turn off', turnLockOff, { test: 'lock-off' }))
  }
  if (!app.lock.available) {
    return h('div', { class: 'card prose', 'data-test': 'lock-card', 'data-lock': 'unavailable' },
      h('p', {}, lockUnavailable(app.lock.reason, name)),
      note,
      button('Turn on', () => {}, { disabled: true, test: 'lock-on' }))
  }
  return h('div', { class: 'card prose', 'data-test': 'lock-card', 'data-lock': 'off' },
    h('p', {}, `Require ${name} each time you come back to this app. The app switcher stops showing its screen, and on Android screenshots of it are blocked too.`),
    note,
    button('Turn on', turnLockOn, { kind: 'tinted', test: 'lock-on' }))
}

function waitingList() {
  if (!app.waiting.length) return null
  return h('section', { class: 'group' },
    h('h2', {}, 'Waiting to send'),
    h('ul', { class: 'card waiting', 'data-test': 'waiting' },
      ...app.waiting.map(item =>
        h('li', {},
          h('p', { class: 'clip' }, item.text),
          item.unsure ? h('p', { class: 'seen' }, item.error || 'May have been sent. Check your Hub\'s chat first.') : null,
          h('div', { class: 'row-actions' },
            item.unsure ? button('Send again', () => resend(item.id), { test: 'resend' }) : null,
            button('Discard', () => discard(item.id), { test: 'discard' }))))))
}

async function resend(id) {
  await app.queue.retry(id)
  await refresh()
}

async function discard(id) {
  await app.queue.remove(id)
  app.waiting = await app.queue.list()
  render()
}

// This device was removed on the Hub: its key is useless, so drop it and start over.
async function forgetLocal() {
  if (app.lock.enabled) await clearLock()
  if (!app.conn.demo) {
    await native.clearConnection()
    await native.clearHubCookies()
  }
  app.conn = app.hub = app.queue = null
  app.waiting = []
  show('welcome')
}

// --- Start

// The way out when secure storage keeps failing, since nothing else can be reached from that screen.
async function forgetAndRestart() {
  app.busy = true
  render()
  try {
    await native.lockClear()
    await native.clearConnection()
    await createQueue({ storage: native.queueStorage, send: async () => {} }).clear()
    await native.clearHubCookies()
    location.reload()
  } catch {
    app.busy = false
    app.notice = 'That didn\'t work either. Restart the device and try again.'
    render()
  }
}

async function start() {
  native.onLocked(onLockEvent)
  try {
    await native.prepareStorage()
    // Asked first, and a failure lands on the screen below: unknown never means unlocked.
    app.lock = await native.lockStatus()
    const conn = app.lock.enabled ? await native.loadConnectionInfo() : null
    if (conn) {
      // Only the OS's copy counts. A plain one could be left by a crash while the lock was turned on or off.
      await native.removePlainToken()
      await native.clearHubCookies()
      connect(conn, null, native.queueStorage)
      app.screen = 'home'
      app.locked = lockedState()
    } else {
      if (app.lock.enabled) await clearLock() // nothing to protect: a demo's lock
      const saved = await native.loadConnection()
      if (saved) {
        connect(saved.conn, realHub(saved.conn, saved.token), native.queueStorage)
        app.waiting = await app.queue.list()
        app.screen = 'home'
      }
    }
  } catch {
    app.screen = 'startFailed'
    render()
    return native.lockShown()
  }
  render()
  const { active } = await native.lockShown()

  app.online = await native.isOnline()
  native.onOnlineChange(online => {
    app.online = online
    refresh()
  })
  native.onResume(async () => {
    if (app.locked) return
    app.hubOpen = false // this screen is back on top
    if (app.screen === 'settings') refreshLockStatus()
    receiveShare(await native.takeShare())
    refresh()
  })
  native.onHubClosed(() => {
    app.hubOpen = false
    refresh()
  })
  native.onShare(text => {
    if (app.locked) app.deferredShare = text
    else receiveShare(text)
  })
  native.onLink(handleLink)
  native.onBack(() => {
    if (app.locked) {
      if (app.locked.forgetting) {
        app.locked.forgetting = false
        return render({ focusTitle: true })
      }
      return native.minimize()
    }
    const parent = { pair: 'welcome', confirm: app.conn ? 'home' : 'welcome', settings: 'home', forget: 'settings', share: 'home', demoHub: 'home' }[app.screen]
    if (parent) show(parent)
    else native.minimize()
  })
  setInterval(() => {
    if (!document.hidden && app.screen === 'home') refresh()
  }, CHECK_EVERY_MS)

  const link = await native.launchLink()
  if (app.locked) {
    if (link) handleLink(link)
    if (active) promptOnce()
  } else {
    if (link) handleLink(link)
    receiveShare(await native.takeShare())
    refresh()
  }

  if (__DEV__) {
    window.__hubTest = {
      share: text => (app.locked ? (app.deferredShare = text) : receiveShare(text)),
      link: handleLink,
      refresh,
      locked: onLockEvent,
    }
  }
}

start()
