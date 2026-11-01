// The app shell: pairing, status, sharing into chat. The Hub page itself opens in a separate web view
// with no bridge, so nothing on that page can reach native code or the token.
import { DEMO_ADDRESS, DEMO_CODE, cleanCode, isCode, normalizeAddress, parsePairLink, showCode } from './lib/address.js'
import { MAX_SHARE_CHARS, createClient } from './lib/client.js'
import { createQueue } from './lib/queue.js'
import { STATES, classify } from './lib/status.js'
import * as native from './lib/native.js'
import { h } from './lib/dom.js'

const DEV = __DEV__
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
  app.queue = createQueue({ storage, send: text => app.hub.send(text) })
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
  app.busy = true
  render()
  let removed = true
  let cleared = true
  if (!demo) {
    removed = await app.hub.forget()
    await native.clearConnection()
    await app.queue.clear()
    cleared = await native.clearHubCookies()
  }
  app.busy = false
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
  const { status } = online ? await app.hub.check() : { status: null }
  if (seq !== checkSeq || !app.hub) return // a newer check, or the person left
  app.state = classify({ online, status })
  if (app.state === 'ok') {
    app.conn.lastSeen = Date.now()
    if (!app.conn.demo) native.saveConnectionInfo(app.conn)
    const r = await app.queue.flush()
    if (r.sent) app.notice = r.sent === 1 ? 'Your waiting message was sent.' : `${r.sent} waiting messages were sent.`
  }
  app.waiting = await app.queue.list()
  render()
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
  const parsed = parsePairLink(link, { dev: DEV })
  if (!parsed) return false
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
    app.error = r.error || 'That isn\'t a Local Hub pairing code.'
    render()
  }
}

// --- Rendering

function show(screen) {
  app.screen = screen
  render({ focusTitle: true })
}

function render({ focusTitle = false } = {}) {
  const active = document.activeElement
  const keep = active?.dataset?.keep ? { key: active.dataset.keep, start: active.selectionStart, end: active.selectionEnd } : null
  root.replaceChildren(SCREENS[app.screen]())
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
      title('Local Hub'),
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
      const address = normalizeAddress(app.pairForm.address, { dev: DEV })
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
      back('welcome', 'Cancel'),
      title('Connect to this computer?'),
      h('div', { class: 'card rows' },
        h('div', { class: 'row' }, h('span', {}, 'Address'), h('strong', { 'data-test': 'confirm-address' }, app.pairing?.address)),
        h('div', { class: 'row' }, h('span', {}, 'Code'), h('strong', { class: 'mono' }, showCode(app.pairing?.code ?? '')))),
      h('p', { class: 'sub' }, 'Only connect to a Hub you run. It will be able to show pages inside this app, and anything you share goes to it.'),
      app.error ? errorLine(app.error) : null,
      h('div', { class: 'stack' }, button(app.busy ? 'Connecting' : 'Connect', pair, { kind: 'primary', test: 'pair-confirm' }))),

  home: () => {
    const s = STATES[app.state]
    return h('main', { class: 'screen' },
      h('div', { class: 'topbar' }, h('button', { class: 'link', type: 'button', onclick: () => show('settings'), 'data-test': 'settings' }, 'Settings')),
      title(app.conn.hubName),
      app.conn.demo ? h('p', { class: 'demo-note' }, 'Demo: sample data. Nothing leaves this device.') : null,
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
      button('Open Hub', () => app.hub.open(), { kind: 'primary', disabled: !s.canOpen, test: 'open' }),
      noticeLine(),
      h('section', { class: 'card compose' },
        h('label', { for: 'draft' }, 'Send to Hub chat'),
        h('textarea', { id: 'draft', 'data-keep': 'draft', rows: '3', maxlength: String(MAX_SHARE_CHARS), placeholder: 'Message your Hub\'s assistant', value: app.draft, oninput: e => (app.draft = e.target.value) }),
        button(app.state === 'ok' ? 'Send' : 'Send when reachable', () => sendText(app.draft, () => (app.draft = '')), { kind: 'tinted', test: 'send' })),
      waitingList())
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
    h('main', { class: 'screen' },
      back('home'),
      title('Settings'),
      h('div', { class: 'card rows' },
        h('div', { class: 'row' }, h('span', {}, 'Hub'), h('strong', {}, app.conn.hubName)),
        h('div', { class: 'row' }, h('span', {}, 'Address'), h('strong', {}, app.conn.demo ? 'Built-in demo' : app.conn.address)),
        h('div', { class: 'row' }, h('span', {}, 'Version'), h('strong', {}, __VERSION__))),
      h('h2', {}, 'Your data'),
      h('div', { class: 'card prose' },
        h('p', {}, 'This app has no account, no analytics and no server of its own. Everything you send goes only to the Hub address above.'),
        h('p', {}, 'The key that connects this device is kept in the system\'s secure storage. It isn\'t backed up and it never appears in a web page.'),
        h('p', {}, 'Your Hub\'s address and any text waiting to send are ordinary app data. On iPhone and iPad, a device backup such as iCloud Backup can include them. On Android they\'re left out of backups.'),
        h('p', {}, 'Hub chat runs on your computer, using the AI login you set up there. What you send to chat goes wherever that assistant sends it.')),
      h('div', { class: 'stack' }, button(app.conn.demo ? 'Leave the demo' : 'Forget this Hub', () => (app.conn.demo ? forget() : show('forget')), { kind: 'danger', test: 'forget' }))),

  forget: () =>
    h('main', { class: 'screen' },
      back('settings', 'Cancel'),
      title('Forget this Hub?'),
      h('p', { class: 'sub' }, `This device disconnects from ${app.conn.hubName}. Messages still waiting here are deleted. To connect again, you'll need a new code.`),
      h('div', { class: 'stack' }, button(app.busy ? 'Forgetting' : 'Forget this Hub', forget, { kind: 'danger', test: 'forget-confirm' }))),

  startFailed: () =>
    h('main', { class: 'screen center' },
      h('img', { class: 'logo', src: 'icon.png', alt: '', width: '72', height: '72' }),
      title('Local Hub couldn\'t start'),
      h('p', { class: 'lead' }, 'This device\'s secure storage didn\'t respond. Nothing was changed. Try again, or restart the device if this keeps happening.'),
      h('div', { class: 'stack' }, button('Try again', () => location.reload(), { kind: 'primary', test: 'start-retry' }))),

  demoHub: () =>
    h('main', { class: 'hubview' },
      h('div', { class: 'hubbar' }, h('button', { class: 'link', type: 'button', onclick: () => show('home'), 'data-test': 'demo-done' }, 'Done'), h('span', {}, 'Demo Hub')),
      h('iframe', { src: 'demo-hub.html', title: 'Demo Hub', sandbox: '' })),
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
  if (!app.conn.demo) {
    await native.clearConnection()
    await native.clearHubCookies()
  }
  app.conn = app.hub = app.queue = null
  app.waiting = []
  show('welcome')
}

// --- Start

async function start() {
  try {
    await native.prepareStorage()
    const saved = await native.loadConnection().catch(() => null)
    if (saved) {
      connect(saved.conn, realHub(saved.conn, saved.token), native.queueStorage)
      app.waiting = await app.queue.list()
      app.screen = 'home'
    }
  } catch {
    app.screen = 'startFailed'
    return render()
  }
  render()

  app.online = await native.isOnline()
  native.onOnlineChange(online => {
    app.online = online
    refresh()
  })
  native.onResume(async () => {
    receiveShare(await native.takeShare())
    refresh()
  })
  native.onHubClosed(refresh)
  native.onShare(receiveShare)
  native.onLink(receivePairLink)
  native.onBack(() => {
    const parent = { pair: 'welcome', confirm: 'welcome', settings: 'home', forget: 'settings', share: 'home', demoHub: 'home' }[app.screen]
    if (parent) show(parent)
    else native.minimize()
  })
  setInterval(() => {
    if (!document.hidden && app.screen === 'home') refresh()
  }, CHECK_EVERY_MS)

  const link = await native.launchLink()
  if (link) receivePairLink(link)
  receiveShare(await native.takeShare())
  refresh()

  if (__DEV__) window.__hubTest = { share: receiveShare, link: receivePairLink, refresh }
}

start()
