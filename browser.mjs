// Hub browser: a dedicated Chrome per profile that the hub assistant drives and the user watches (and
// takes over) live in the browser pop-up. Each profile is its own Chrome with its own user-data-dir
// under data/browser/<profile>, started on demand with --remote-debugging-port on 127.0.0.1 only
// and closed after IDLE_MS without use or when no hub comes back (the profile and its sign-ins stay on disk). The page never
// talks to Chrome: frames, input and actions all go through these hub routes.
//
//   GET  /api/browser/status[?profile=]      -> { profiles, current, running, tabs, active, controller, ask, dialog, ... }
//   GET  /api/browser/stream?profile=        -> text/event-stream: frame {jpg(base64), meta} | state {...} | log {entry}
//   POST /api/browser/input  { profile, events: [...] }        the user's mouse/wheel/key/text input (from the page); snap {x,y,dir} and where for the TV remote
//   POST /api/browser/act    { profile?, act, ... }            navigation, tabs, control, and every agent action
//   GET  /api/browser/screenshot[?profile=&w=&format=png|jpeg&quality=]  -> image of the active tab
//   GET  /api/browser/snapshot[?profile=]    -> { url, title, items: [{ ref, role, name, ... }], text }
//   GET  /api/browser/text[?profile=]        -> { url, title, text }
//   GET  /api/browser/log[?since=&limit=]    -> { entries: [{ id, at, profile, who, act, detail, url, shot }] }
//   GET  /api/browser/shots/<id>.jpg         -> the thumbnail saved right after agent action <id>
//   GET  /api/browser/confirm/<id>           -> { what, label, url } while the card waits for an answer
//   POST /api/browser/confirm/<id> { allow } the user's answer to the card; an agent can't send one
// The agent's requests carry `x-hub-actor: agent` (browser-mcp.mjs sets it); everything else is the user.
// Agent actions are refused while the user has control, and the hub itself refuses typing into password,
// card and one-time-code fields and clicking Post/Share on social sites, unless the owner changed that in
// assistant.approvals (see SAFETY below).
import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hubConfig, PORT } from './config.mjs'
import { IS_MAC, IS_WIN } from './platform.mjs'
import { SNAP_JS } from './page-snap.mjs'

// Your Chrome profiles (hub.json browser.profiles); each keeps its own sign-ins under data/browser/<id>.
const PROFILES = hubConfig().browser.profiles
const IDLE_MS = 10 * 60e3
const ASK_MS = 5 * 60e3 // how long a card waits for its answer, and how long a yes waits for the retry
const DESKTOP = { w: 1280, h: 800 }
const START_URL = 'https://www.google.com/'
const MIN_FRAME_MS = 33 // at most ~30 fps
const QUALITY = [30, 45, 60, 75] // JPEG steps; the stream moves between them with the viewers' bandwidth
const AGENT_QUIET_MS = 20e3 // the user's input takes control by itself once the agent has been quiet this long
const GIVE_BACK_MS = 60e3 // control returns to the agent this long after the last viewer leaves
const MAX_LOG = 400
const LINUX_DIRS = [...new Set(['/usr/bin', '/usr/local/bin', '/snap/bin', ...(process.env.PATH || '').split(path.delimiter).filter(Boolean)])]
const CHROME = [
  process.env.HUB_CHROME,
  ...(IS_WIN ? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ] : IS_MAC ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : LINUX_DIRS.flatMap(d => ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map(n => path.join(d, n)))),
].filter(Boolean)

/* ---------- SAFETY: hard floors the hub enforces on agent actions ---------- */

// Fields the agent must never type into: passwords, card data, one-time / 2FA codes, SSNs.
const SENSITIVE_RE = /pass(word|wd|code|phrase)?\b|pwd|\bpin\b|card|cc-?(num|csc|exp)|cvv|cvc|security.?code|otp|2fa|mfa|one.?time|verification.?code|auth(entication)?.?code|totp|ssn|social.?security|routing|iban|account.?number/i
const SOCIAL_RE = /(^|\.)(linkedin\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|threads\.(net|com)|tiktok\.com|youtube\.com|bsky\.app|reddit\.com|pinterest\.com|joinhandshake\.com|medium\.com|substack\.com)$/i
const POST_RE = /^\s*(post|share|repost|re-?share|tweet|publish|send post|post now|share now|reply|comment)\b/i
// What the owner set in hub.json. The floors below are what ships; these change them, and nothing the agent does can.
const approvals = () => hubConfig().assistant.approvals
// Clicks that send, post, buy, delete or accept: allowed only after the user's Allow on a card.
const RISKY_RE = /\b(send|post|share|publish|buy|purchase|pay|checkout|check out|place order|order now|subscribe|delete|remove|discard|accept|agree|i agree|confirm|transfer|donate|submit order|book now|reserve|sign up|create account|unsubscribe|cancel (subscription|plan|account))\b/i

function luhnCard(text) {
  for (const m of String(text).matchAll(/(?:\d[ -]?){13,19}/g)) {
    const d = m[0].replace(/\D/g, '')
    let sum = 0
    for (let i = 0; i < d.length; i++) {
      let n = +d[d.length - 1 - i]
      if (i % 2) n = n * 2 > 9 ? n * 2 - 9 : n * 2
      sum += n
    }
    if (d.length >= 13 && sum % 10 === 0) return true
  }
  return false
}

/* ---------- a tiny CDP client (Node's built-in WebSocket) ---------- */

class Cdp {
  constructor(url) {
    this.url = url
    this.id = 0
    this.pending = new Map()
    this.handlers = new Set()
    this.closed = false
  }
  open() {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(this.url))
      ws.onopen = () => resolve(this)
      ws.onerror = e => reject(new Error(`cdp: ${e.message || 'connect failed'}`))
      ws.onclose = () => {
        this.closed = true
        for (const p of this.pending.values()) p.reject(new Error('cdp closed'))
        this.pending.clear()
        for (const h of this.handlers) h('closed', {}, null)
      }
      ws.onmessage = ev => {
        let m
        try { m = JSON.parse(ev.data) } catch { return }
        if (m.id) {
          const p = this.pending.get(m.id)
          if (!p) return
          this.pending.delete(m.id)
          clearTimeout(p.timer)
          m.error ? p.reject(Object.assign(new Error(m.error.message), { cdp: m.error })) : p.resolve(m.result)
        } else for (const h of this.handlers) h(m.method, m.params || {}, m.sessionId || null)
      }
    })
  }
  send(method, params = {}, sessionId, ms = 30e3) {
    if (this.closed) return Promise.reject(new Error('browser is not running'))
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => (this.pending.delete(id), reject(new Error(`${method} timed out`))), ms)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
  on(fn) { this.handlers.add(fn) }
  close() { try { this.ws.close() } catch {} }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const err = (code, message, extra) => Object.assign(new Error(message), { code, ...extra })

/* ---------- page-side scripts (run in the page with Runtime.evaluate) ---------- */

// Numbers every visible interactive element with data-hub-ref and lists them for the agent.
const SNAPSHOT_JS = `(() => {
  const SEL = 'a[href],button,input,textarea,select,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=textbox],[role=combobox],[role=searchbox],[contenteditable=""],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"])'
  const SENS = ${SENSITIVE_RE}
  let next = +(document.documentElement.dataset.hubRefNext || 1)
  const vw = innerWidth, vh = innerHeight, out = []
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue
    if (el.disabled) continue
    if (!el.dataset.hubRef) el.dataset.hubRef = String(next++)
    const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase()
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? (type || 'text') : tag)
    const hay = [type, el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.placeholder].join(' ')
    const sensitive = type === 'password' || /cc-|one-time-code|password/.test(el.getAttribute('autocomplete') || '') || ((tag === 'input' || tag === 'textarea') && SENS.test(hay))
    let name = el.getAttribute('aria-label') || (tag === 'input' || tag === 'textarea' ? el.placeholder || el.labels?.[0]?.innerText : '') || el.innerText || el.title || el.alt || el.value || el.getAttribute('href') || ''
    if (tag === 'input' && ['submit', 'button'].includes(type)) name = el.value || name
    name = String(name).replace(/\\s+/g, ' ').trim().slice(0, 80)
    const value = tag === 'select' ? el.options[el.selectedIndex]?.text : (tag === 'input' || tag === 'textarea') && !sensitive ? String(el.value || '').slice(0, 60) : undefined
    const inView = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw
    out.push({ ref: +el.dataset.hubRef, role, name, value, sensitive: sensitive || undefined, checked: el.checked || undefined, href: tag === 'a' ? el.href.slice(0, 120) : undefined, inView, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
  }
  document.documentElement.dataset.hubRefNext = String(next)
  out.sort((a, b) => b.inView - a.inView)
  return { url: location.href, title: document.title, scrollY: Math.round(scrollY), pageHeight: document.documentElement.scrollHeight, viewport: { w: vw, h: vh }, items: out.slice(0, 250), text: (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 6000) }
})()`

// Describes the element for a ref or a point: its label (for the click guards) and where to click.
// A form that only finds things or moves between pages: a search, or a plain Next or Sign in. Any other submit counts as risky, whatever its button says.
const QUIET_FORM = `const quietForm = (f, label) => f.getAttribute('role') === 'search' || !!f.closest('[role=search]') || !!f.querySelector('input[type=search],input[name=q],input[name=query],input[name=search],input[name=s]') || /(^|[\\/?#])(search|find|results)\\b/i.test(f.getAttribute('action') || '') || /^(search|find|go|filter|sort|next|continue|back|previous|sign in|log ?in)\\b/i.test(label)`

const describeJs = (ref, x, y) => `(() => {
  const SENS = ${SENSITIVE_RE}
  ${QUIET_FORM}
  let el = ${ref ? `document.querySelector('[data-hub-ref="${Number(ref)}"]')` : `document.elementFromPoint(${Number(x)}, ${Number(y)})`}
  if (!el) return null
  ${ref ? `el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })` : ''}
  const hit = el.closest('a,button,input,textarea,select,summary,label,[role],[onclick],[contenteditable]') || el
  const r = el.getBoundingClientRect()
  const tag = hit.tagName.toLowerCase(), type = (hit.getAttribute('type') || '').toLowerCase()
  const hay = [type, hit.name, hit.id, hit.getAttribute('autocomplete'), hit.getAttribute('aria-label'), hit.placeholder].join(' ')
  const editable = tag === 'textarea' || (tag === 'input' && !['button', 'submit', 'checkbox', 'radio', 'file', 'image', 'reset', 'range', 'color'].includes(type)) || hit.isContentEditable
  const sensitive = editable && (type === 'password' || /cc-|one-time-code|password/.test(hit.getAttribute('autocomplete') || '') || SENS.test(hay))
  const label = String(hit.getAttribute('aria-label') || (tag === 'input' ? (sensitive || type === 'password' ? hit.placeholder || type : hit.value || hit.placeholder) : '') || hit.innerText || hit.title || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
  const submits = !!hit.form && hit.matches('button:not([type]),button[type=submit],input[type=submit],input[type=image]')
  const unnamedSubmit = !/[\\p{L}\\p{N}]/u.test(label) && submits && !!hit.form.querySelector('textarea,[contenteditable]')
  const formSubmit = submits && !quietForm(hit.form, label)
  return { tag, type, label, editable, sensitive, unnamedSubmit, formSubmit, x: ${ref ? 'Math.round(r.left + r.width / 2)' : Number(x)}, y: ${ref ? 'Math.round(r.top + r.height / 2)' : Number(y)} }
})()`

// The focused element, checked before any agent typing.
const FOCUS_JS = `(() => {
  const SENS = ${SENSITIVE_RE}
  let el = document.activeElement
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
  if (!el || el === document.body) return { editable: false }
  const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase()
  const hay = [type, el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.placeholder].join(' ')
  const editable = tag === 'textarea' || tag === 'input' || el.isContentEditable
  return { tag, type, editable, sensitive: editable && (type === 'password' || /cc-|one-time-code|password/.test(el.getAttribute('autocomplete') || '') || SENS.test(hay)) }
})()`

// What Enter would do in the focused field: it presses the form's button, so it gets the same check as clicking it.
const ENTER_JS = `(() => {
  ${QUIET_FORM}
  let el = document.activeElement
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
  if (!el || el === document.body) return null
  const tag = el.tagName.toLowerCase(), form = el.form || el.closest('form')
  const b = form && form.querySelector('button[type=submit],button:not([type]),input[type=submit],input[type=image]')
  const label = b ? String(b.getAttribute('aria-label') || b.innerText || b.value || b.title || '').replace(/\\s+/g, ' ').trim().slice(0, 80) : ''
  return { tag, rich: !!el.isContentEditable, label, unnamed: !!b && !/[\\p{L}\\p{N}]/u.test(label), compose: !!form && !!form.querySelector('textarea,[contenteditable]'), submits: !!form && tag === 'input' && !quietForm(form, label) }
})()`

const KEYS = {
  Enter: [13, 'Enter', '\r'], Tab: [9, 'Tab'], Escape: [27, 'Escape'], Backspace: [8, 'Backspace'], Delete: [46, 'Delete'],
  ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'], ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'],
  Home: [36, 'Home'], End: [35, 'End'], PageUp: [33, 'PageUp'], PageDown: [34, 'PageDown'], ' ': [32, 'Space', ' '],
}

export function create({ here }) {
  const DIR = path.join(here, 'data', 'browser')
  const SHOTS = path.join(DIR, 'shots')
  const LOG_FILE = path.join(DIR, 'actions.jsonl')
  const STATE_FILE = path.join(DIR, 'state.json')
  fs.mkdirSync(SHOTS, { recursive: true })

  let saved = {}
  try { saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch {}
  const conf = { current: PROFILES[saved.current] ? saved.current : PROFILES[hubConfig().browser.current] ? hubConfig().browser.current : Object.keys(PROFILES)[0], mode: { ...saved.mode }, size: { ...saved.size } }
  const saveConf = () => fs.promises.writeFile(STATE_FILE, JSON.stringify(conf, null, 2)).catch(() => {})

  // The action log: last MAX_LOG in memory, everything appended to actions.jsonl (rotated at 2 MB).
  const log = []
  let logId = 0
  try {
    for (const line of fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-MAX_LOG)) {
      const e = JSON.parse(line)
      log.push(e)
      logId = Math.max(logId, e.id || 0)
    }
  } catch {}

  const insts = new Map() // profile -> instance

  function addLog(inst, who, act, detail = '', extra = {}) {
    const tab = inst?.tabs.get(inst.active)
    const e = { id: ++logId, at: Date.now(), profile: inst?.profile || conf.current, who, act, detail: String(detail).slice(0, 300), url: tab?.url || '', ...extra }
    log.push(e)
    if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG)
    fs.promises.stat(LOG_FILE).then(s => s.size > 2 << 20 && fs.promises.rename(LOG_FILE, LOG_FILE + '.1')).catch(() => {})
      .then(() => fs.promises.appendFile(LOG_FILE, JSON.stringify(e) + '\n')).catch(() => {})
    for (const i of insts.values()) broadcast(i, 'log', e)
    return e
  }

  /* ---------- Chrome lifecycle ---------- */

  const chromeExe = () => CHROME.find(p => fs.existsSync(p))
  // A real (not "HeadlessChrome") UA; fit mode on a phone switches to the Android one so sites send their mobile layout
  const major = (() => {
    try {
      const exe = chromeExe()
      // Windows Chrome has no --version: it opens a window instead. Its version is a folder beside it.
      if (IS_WIN) return /^(\d+)\./.exec(fs.readdirSync(path.dirname(exe)).find(f => /^\d+\.\d+\.\d+\.\d+$/.test(f)) || '')?.[1] || '156'
      return /(\d+)\.\d+\.\d+/.exec(execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 5000 }))?.[1] || '156'
    } catch { return '156' }
  })()
  const UA_OS = IS_WIN ? 'Windows NT 10.0; Win64; x64' : IS_MAC ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64'
  const UA_PLATFORM = IS_WIN ? 'Win32' : IS_MAC ? 'MacIntel' : 'Linux x86_64'
  const UA_DESKTOP = `Mozilla/5.0 (${UA_OS}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
  const UA_MOBILE = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`

  async function devtoolsPort(dir) {
    try {
      const [port] = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })
      if (res.ok) return { port: +port, version: await res.json() }
    } catch {}
    return null
  }

  function get(profile) {
    profile = profile || conf.current
    if (!PROFILES[profile]) throw err(400, `unknown profile ${profile}; use ${Object.keys(PROFILES).join(' or ')}`)
    return profile
  }

  // Starts (or adopts, after a hub restart) the profile's Chrome. One start at a time per profile.
  function ensure(profile) {
    profile = get(profile)
    const live = insts.get(profile)
    if (live && !live.cdp.closed) return (live.lastUse = Date.now()), Promise.resolve(live)
    if (live?.starting) return live.starting
    const starting = start(profile).finally(() => { const i = insts.get(profile); if (i) delete i.starting })
    insts.set(profile, { profile, starting, viewers: new Set(), tabs: new Map(), cdp: { closed: true } })
    return starting.catch(e => { insts.delete(profile); throw e })
  }

  async function start(profile) {
    const dir = path.join(DIR, profile)
    fs.mkdirSync(dir, { recursive: true })
    let found = await devtoolsPort(dir)
    const adopted = !!found // a Chrome left running by the last hub process is reused as is
    let proc = null
    if (!found) {
      const exe = chromeExe()
      if (!exe) throw err(500, `Chrome is not installed (set HUB_CHROME to ${IS_WIN ? 'chrome.exe' : 'the Chrome program'})`)
      try { fs.unlinkSync(path.join(dir, 'DevToolsActivePort')) } catch {}
      const headed = conf.mode[profile] === 'headed'
      const args = [
        `--user-data-dir=${dir}`,
        '--remote-debugging-port=0', // Chrome picks a free port and binds it to 127.0.0.1 only
        '--remote-debugging-address=127.0.0.1',
        '--no-first-run', '--no-default-browser-check', '--hide-crash-restore-bubble',
        ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), // Chrome won't start as root on Linux without it
        '--disable-blink-features=AutomationControlled',
        '--disable-features=CalculateNativeWinOcclusion,Translate',
        '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
        `--window-size=${DESKTOP.w},${DESKTOP.h + (headed ? 90 : 0)}`,
        ...(headed ? [] : ['--headless=new', `--user-agent=${UA_DESKTOP}`]),
        'about:blank',
      ]
      // Detached, so a hub restart leaves Chrome (and the agent's page) running; the next hub adopts it
      // through DevToolsActivePort and the idle timer still closes it. If no hub comes back, watchHub does.
      proc = spawn(exe, args, { windowsHide: !headed, stdio: 'ignore', detached: true })
      proc.on('error', () => {})
      proc.unref()
      for (let i = 0; i < 80 && !found; i++) {
        await sleep(200)
        found = await devtoolsPort(dir)
        if (proc.exitCode !== null && !found) throw err(500, 'Chrome exited at start (is this profile open in another Chrome?)')
      }
      if (!found) { proc.kill(); throw err(500, 'Chrome did not open its debugging port') }
    }
    watchHub(dir, found.port)
    const cdp = await new Cdp(found.version.webSocketDebuggerUrl).open()
    const inst = Object.assign(insts.get(profile), {
      profile, cdp, proc, port: found.port, chrome: found.version.Browser, started: Date.now(), lastUse: Date.now(),
      lastAgent: 0, controller: 'agent', ask: '', dialog: null, size: conf.size[profile] || { mode: 'desktop', ...DESKTOP, mobile: false },
      tabs: new Map(), active: '', session: '', frame: null, q: 2, casting: false, acking: false, fast: 0, slowAt: [],
    })
    cdp.on((method, p, sid) => onEvent(inst, method, p, sid))
    await cdp.send('Target.setDiscoverTargets', { discover: true })
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {})
    const { targetInfos } = await cdp.send('Target.getTargets')
    for (const t of targetInfos) if (t.type === 'page') inst.tabs.set(t.targetId, tabInfo(t))
    let first = [...inst.tabs.keys()][0]
    if (!first) first = (await cdp.send('Target.createTarget', { url: START_URL })).targetId
    else if (inst.tabs.get(first).url === 'about:blank' && !adopted) await attach(inst, first).then(s => cdp.send('Page.navigate', { url: START_URL }, s)).catch(() => {})
    await activate(inst, first)
    addLog(inst, 'hub', 'start', `Chrome ${adopted ? 'reconnected' : 'started'} (${conf.mode[profile] === 'headed' ? 'window on the laptop' : 'headless'})`)
    return inst
  }

  // A small watcher lives as long as Chrome does. When this hub's port stays silent for 30 seconds it closes Chrome, however
  // the hub went away: a crash, a kill, or a desktop app that quit. A plain restart comes back in time and adopts Chrome.
  const WATCH_JS = `const [port, hub, file] = process.argv.slice(1)
let silent = 0
setInterval(async () => {
  try { if (!require('node:fs').readFileSync(file, 'utf8').startsWith(process.pid + ' ')) process.exit(0) } catch { process.exit(0) }
  const v = await fetch('http://127.0.0.1:' + port + '/json/version', { signal: AbortSignal.timeout(3000) }).then(r => r.json()).catch(() => null)
  if (!v) process.exit(0)
  const up = await fetch('http://127.0.0.1:' + hub + '/api/ping', { signal: AbortSignal.timeout(3000) }).then(() => true).catch(() => false)
  silent = up ? 0 : silent + 1
  if (silent < 6) return
  const ws = new WebSocket(v.webSocketDebuggerUrl)
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
  setTimeout(() => process.exit(0), 2000)
}, 5000)`
  function watchHub(dir, port) {
    const file = path.join(dir, 'hub-watch.pid'), key = `${port} ${PORT}`
    try {
      const [pid, ...was] = fs.readFileSync(file, 'utf8').split(' ')
      process.kill(+pid, 0)
      if (was.join(' ') === key) return // the last hub's watcher is still on this Chrome
    } catch {}
    // A watcher for another Chrome or port sees this file change and leaves by itself.
    const kid = spawn(process.execPath, ['-e', WATCH_JS, String(port), String(PORT), file], {
      windowsHide: true, stdio: 'ignore', detached: true,
      // Nothing of the hub's environment goes with it. Inside the desktop app process.execPath is Electron, and this asks it for plain Node.
      env: { ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
    })
    kid.on('error', () => {})
    kid.unref()
    if (kid.pid) try { fs.writeFileSync(file, `${kid.pid} ${key}`) } catch {}
  }

  async function stop(inst, why) {
    if (!inst || inst.cdp.closed) return
    addLog(inst, 'hub', 'stop', why)
    await inst.cdp.send('Browser.close', {}, null, 5e3).catch(() => {})
    inst.cdp.close()
    setTimeout(() => inst.proc?.exitCode === null && inst.proc.kill(), 5e3)
  }

  // Idle-out: no viewers and no use for IDLE_MS closes the profile's Chrome; the profile stays.
  setInterval(() => {
    for (const inst of insts.values()) {
      if (inst.cdp.closed || inst.starting) continue
      if (inst.viewers.size) inst.lastUse = Date.now()
      else if (Date.now() - inst.lastUse > IDLE_MS) stop(inst, `idle for ${IDLE_MS / 60e3} minutes`)
    }
  }, 30e3).unref()

  /* ---------- tabs, sessions, events ---------- */

  const tabInfo = t => ({ id: t.targetId, url: t.url, title: t.title, opener: t.openerId || '' })

  // The hub's own addresses are off limits inside this Chrome: its file routes would hand the agent what its own read rules refuse, by a link or a page as well as by browser_open.
  function hubPatterns() {
    const nets = Object.values(os.networkInterfaces()).flat().map(n => n.family === 'IPv6' ? `[${n.address.split('%')[0]}]` : n.address)
    // Any name on the hub's port, too: x.localhost, localhost. or a public name pointing back here all reach it, and the
    // hub's own page would let the agent press its own Allow.
    const hosts = [`*://*:${PORT}/*`, ...new Set(['127.0.0.1', 'localhost', '[::1]', ...nets])].map(h => h.startsWith('*') ? h : `*://${h}:${PORT}/*`)
    try { const u = new URL(hubConfig().url); hosts.push(`*://${u.host}/*`) } catch {}
    return hosts
  }

  async function attach(inst, targetId) {
    const tab = inst.tabs.get(targetId)
    if (tab?.session) return tab.session
    const { sessionId } = await inst.cdp.send('Target.attachToTarget', { targetId, flatten: true })
    if (tab) tab.session = sessionId
    await Promise.all([
      inst.cdp.send('Page.enable', {}, sessionId),
      inst.cdp.send('Runtime.enable', {}, sessionId).catch(() => {}),
      inst.cdp.send('Fetch.enable', { patterns: hubPatterns().map(urlPattern => ({ urlPattern })) }, sessionId).catch(() => {}),
      // Headless pages count as focused, so key events and :focus work while nobody looks at a window.
      inst.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => {}),
      applySize(inst, sessionId),
    ])
    return sessionId
  }

  function applySize(inst, sid) {
    const s = inst.size
    return Promise.all([
      inst.cdp.send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: !!s.mobile }, sid),
      inst.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: !!s.mobile, maxTouchPoints: s.mobile ? 5 : 0 }, sid).catch(() => {}),
      inst.cdp.send('Emulation.setUserAgentOverride', { userAgent: s.mobile ? UA_MOBILE : UA_DESKTOP, platform: s.mobile ? 'Android' : UA_PLATFORM }, sid).catch(() => {}),
    ]).catch(() => {})
  }

  async function activate(inst, targetId) {
    if (!inst.tabs.has(targetId)) throw err(404, `no tab ${targetId}`)
    const old = inst.session
    if (old && inst.casting) await inst.cdp.send('Page.stopScreencast', {}, old).catch(() => {})
    inst.casting = false
    inst.active = targetId
    inst.session = await attach(inst, targetId)
    await inst.cdp.send('Target.activateTarget', { targetId }).catch(() => {})
    await inst.cdp.send('Page.bringToFront', {}, inst.session).catch(() => {})
    inst.dialog = null
    await refreshHistory(inst)
    if (inst.viewers.size) await startCast(inst)
    pushState(inst)
  }

  async function refreshHistory(inst) {
    try {
      const h = await inst.cdp.send('Page.getNavigationHistory', {}, inst.session)
      inst.canBack = h.currentIndex > 0
      inst.canForward = h.currentIndex < h.entries.length - 1
    } catch {}
  }

  function onEvent(inst, method, p, sid) {
    if (method === 'closed') {
      for (const res of inst.viewers) sse(res, 'state', { running: false, profile: inst.profile })
      return
    }
    if (method === 'Fetch.requestPaused') return inst.cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }, sid).catch(() => {})
    if (method === 'Page.screencastFrame') return sid === inst.session ? onFrame(inst, p) : inst.cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }, sid).catch(() => {})
    if (method === 'Target.targetCreated' && p.targetInfo.type === 'page') {
      inst.tabs.set(p.targetInfo.targetId, tabInfo(p.targetInfo))
      // A popup or target=_blank from the tab being watched comes to the front, like a real browser.
      if (p.targetInfo.openerId && p.targetInfo.openerId === inst.active) activate(inst, p.targetInfo.targetId).catch(() => {})
      return pushState(inst)
    }
    if (method === 'Target.targetInfoChanged' && inst.tabs.has(p.targetInfo.targetId)) {
      Object.assign(inst.tabs.get(p.targetInfo.targetId), { url: p.targetInfo.url, title: p.targetInfo.title })
      if (p.targetInfo.targetId === inst.active) refreshHistory(inst).then(() => pushState(inst))
      else pushState(inst)
      return
    }
    if (method === 'Target.targetDestroyed' && inst.tabs.has(p.targetId)) {
      inst.tabs.delete(p.targetId)
      if (p.targetId === inst.active) {
        inst.session = ''
        const next = [...inst.tabs.keys()].pop()
        if (next) activate(inst, next).catch(() => {})
        else inst.cdp.send('Target.createTarget', { url: START_URL }).then(r => activate(inst, r.targetId)).catch(() => {})
      }
      return pushState(inst)
    }
    if (method === 'Page.javascriptDialogOpening' && sid === inst.session) {
      // Alerts just get OK; confirm/prompt/leave-page wait for the user or the agent (act: dialog).
      if (p.type === 'alert') return inst.cdp.send('Page.handleJavaScriptDialog', { accept: true }, sid).catch(() => {})
      inst.dialog = { type: p.type, message: String(p.message).slice(0, 300) }
      addLog(inst, 'hub', 'dialog', `${p.type}: ${inst.dialog.message}`)
      return pushState(inst)
    }
    if (method === 'Page.javascriptDialogClosed' && sid === inst.session) return (inst.dialog = null), pushState(inst)
    if (method === 'Page.loadEventFired' && sid === inst.session) return refreshHistory(inst).then(() => pushState(inst))
  }

  /* ---------- the live stream ---------- */

  function sse(res, event, body) {
    if (res.destroyed) return true
    return res.write(`event: ${event}\ndata: ${JSON.stringify(body)}\n\n`)
  }
  function broadcast(inst, event, body) { for (const res of inst.viewers) sse(res, event, body) }

  function state(inst) {
    return {
      running: !inst.cdp.closed, profile: inst.profile, controller: inst.controller, ask: inst.ask, dialog: inst.dialog,
      tabs: [...inst.tabs.values()].map(({ id, url, title }) => ({ id, url, title })), active: inst.active,
      url: inst.tabs.get(inst.active)?.url || '', title: inst.tabs.get(inst.active)?.title || '',
      canBack: !!inst.canBack, canForward: !!inst.canForward, size: inst.size, quality: QUALITY[inst.q],
      viewers: inst.viewers.size, mode: conf.mode[inst.profile] || 'headless', agentAt: inst.lastAgent,
    }
  }
  function pushState(inst) {
    clearTimeout(inst.stateTimer)
    inst.stateTimer = setTimeout(() => broadcast(inst, 'state', state(inst)), 60)
  }

  async function startCast(inst) {
    if (inst.casting || !inst.session) return
    inst.casting = true
    inst.acking = false
    await inst.cdp.send('Page.startScreencast', { format: 'jpeg', quality: QUALITY[inst.q], maxWidth: inst.size.w, maxHeight: inst.size.h, everyNthFrame: 1 }, inst.session).catch(() => (inst.casting = false))
  }
  async function stopCast(inst) {
    if (!inst.casting) return
    inst.casting = false
    await inst.cdp.send('Page.stopScreencast', {}, inst.session).catch(() => {})
  }
  async function recast(inst) { await stopCast(inst); await startCast(inst) }

  // Chrome sends the next frame only after an ack, so acking once every viewer's socket has flushed
  // the frame is the flow control: a slow iPad link gets fewer frames. How long the flush took also
  // moves the JPEG quality: three slow flushes (over 150 ms) within 3 s step it down, thirty quick
  // ones (under 40 ms) in a row step it back up.
  function onFrame(inst, p) {
    const at = Date.now()
    inst.frame = { jpg: p.data, meta: p.metadata, at }
    const msg = { jpg: p.data, meta: p.metadata, at }
    const pending = []
    for (const res of inst.viewers) if (!sse(res, 'frame', msg)) pending.push(res)
    const ack = () => {
      const took = Date.now() - at
      if (took > 150) {
        inst.fast = 0
        inst.slowAt = [...inst.slowAt.filter(t => at - t < 3000), at]
        if (inst.slowAt.length >= 3 && inst.q > 0) { inst.q--; inst.slowAt = []; recast(inst); pushState(inst) }
      } else if (took < 40 && ++inst.fast >= 30 && inst.q < QUALITY.length - 1) { inst.q++; inst.fast = 0; recast(inst); pushState(inst) }
      setTimeout(() => inst.cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }, inst.session).catch(() => {}), Math.max(0, MIN_FRAME_MS - took))
    }
    if (!pending.length) return ack()
    let left = pending.length
    const done = () => --left === 0 && ack()
    for (const res of pending) {
      const once = () => (res.off('drain', once), res.off('close', once), done())
      res.on('drain', once)
      res.on('close', once)
    }
  }

  async function openStream(profile, req, res) {
    const inst = await ensure(profile)
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    res.socket?.setNoDelay(true)
    clearTimeout(inst.giveBackTimer)
    inst.viewers.add(res)
    sse(res, 'state', state(inst))
    for (const e of log.filter(e => e.profile === inst.profile).slice(-30)) sse(res, 'log', e)
    if (inst.frame) sse(res, 'frame', inst.frame)
    await startCast(inst)
    // A still page sends no frames; a fresh viewer gets one now so it never sits blank.
    if (!inst.frame) shot(inst, { format: 'jpeg', quality: 60 }).then(b => sse(res, 'frame', { jpg: b.toString('base64'), meta: { deviceWidth: inst.size.w, deviceHeight: inst.size.h }, at: Date.now() })).catch(() => {})
    const ping = setInterval(() => res.write(': ping\n\n'), 15e3)
    req.on('close', () => {
      clearInterval(ping)
      inst.viewers.delete(res)
      inst.lastUse = Date.now()
      if (!inst.viewers.size) {
        stopCast(inst)
        // Nobody is watching and the agent didn't ask for anything: a phone that just lost its link must
        // not leave the agent locked out. A handoff stays yours until you say Done.
        clearTimeout(inst.giveBackTimer)
        inst.giveBackTimer = setTimeout(() => {
          if (inst.viewers.size || inst.controller !== 'owner' || inst.ask) return
          inst.controller = 'agent'
          addLog(inst, 'hub', 'control', 'Nobody was watching, so control went back to the agent')
        }, GIVE_BACK_MS)
      }
      pushState(inst)
    })
    pushState(inst)
  }

  /* ---------- screenshots ---------- */

  async function shot(inst, { format = 'jpeg', quality = 70, w } = {}) {
    if (!inst.session) throw err(409, 'no tab is open')
    const params = { format: format === 'png' ? 'png' : 'jpeg', ...(format === 'png' ? {} : { quality: Math.max(20, Math.min(95, +quality || 70)) }) }
    if (w && +w < inst.size.w) params.clip = { x: 0, y: 0, width: inst.size.w, height: inst.size.h, scale: Math.max(0.1, +w / inst.size.w) }
    const { data } = await inst.cdp.send('Page.captureScreenshot', params, inst.session)
    return Buffer.from(data, 'base64')
  }

  // A small JPEG kept per agent action, so a chat reply can show what that step looked like.
  async function keepShot(inst, entry) {
    await sleep(600)
    try {
      const buf = await shot(inst, { format: 'jpeg', quality: 60, w: 640 })
      await fs.promises.writeFile(path.join(SHOTS, `${entry.id}.jpg`), buf)
      entry.shot = `/api/browser/shots/${entry.id}.jpg`
      const files = (await fs.promises.readdir(SHOTS)).filter(f => f.endsWith('.jpg')).sort((a, b) => parseInt(a) - parseInt(b))
      for (const f of files.slice(0, Math.max(0, files.length - 300))) fs.promises.unlink(path.join(SHOTS, f)).catch(() => {})
    } catch {}
  }

  /* ---------- actions ---------- */

  const evalPage = async (inst, expression) => {
    const r = await inst.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, inst.session)
    if (r.exceptionDetails) throw err(500, r.exceptionDetails.exception?.description?.split('\n')[0] || 'page script failed')
    return r.result.value
  }

  function normUrl(raw) {
    const s = String(raw || '').trim()
    if (!s) throw err(400, 'url is empty')
    if (/^about:blank$/i.test(s)) return s
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s) && !/^[\w.-]+:\d+/.test(s)) throw err(400, 'only http and https pages can be opened')
    if (/^https?:\/\//i.test(s)) return s
    if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$|^localhost(:\d+)?(\/.*)?$/i.test(s)) return (/^(localhost|127\.|100\.)/.test(s) ? 'http://' : 'https://') + s
    return `https://www.google.com/search?q=${encodeURIComponent(s)}`
  }

  async function mouseClick(inst, x, y, button = 'left', clickCount = 1) {
    const s = inst.session
    await inst.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, s)
    await inst.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount }, s)
    await inst.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount }, s)
  }

  // An agent's Enter that would send: a form whose button sends, a compose form with an unnamed button, or a rich editor, where Enter or Ctrl+Enter is how mail and chat pages send.
  async function checkEnter(inst, ctrl, confirmed) {
    const f = await evalPage(inst, ENTER_JS)
    if (!f) return
    const editor = f.rich || f.tag === 'textarea'
    const what = (ctrl && editor) || f.rich ? 'Enter in this editor' : f.tag === 'textarea' ? '' : RISKY_RE.test(f.label) || f.submits ? `Enter, which presses "${f.label || 'the form\'s button'}",` : f.unnamed && f.compose ? 'Enter in this form' : ''
    if (!what) return
    const social = SOCIAL_RE.test(hostOf(inst)) && POST_RE.test(f.label)
    if (social && approvals().socialPosts !== 'ask') throw err(403, `Refused: "${f.label}" on ${hostOf(inst)}. The agent never posts or shares on the user's social accounts; the user does that.`)
    needYes(inst, f.label || 'Enter', `Press Enter here?`, `${what} may send something.`, 'call again', confirmed, social)
  }

  /* ---------- the user's yes: a card only they can answer, good for one try ---------- */

  const asks = new Map()
  const hostOf = inst => { try { return new URL(inst.tabs.get(inst.active)?.url).hostname } catch { return '' } }
  const originOf = inst => { try { return new URL(inst.tabs.get(inst.active)?.url).origin } catch { return '' } }
  const liveAsk = id => { const a = asks.get(id); return a && a.expires > Date.now() ? a : null }

  // The agent's word isn't enough: confirmed: true passes only with a yes from a card, for this same Chrome, thing and site.
  // always keeps the card when the owner turned cards off for other actions (a Post they set to ask).
  function needYes(inst, label, what, why, retry, confirmed, always) {
    const mode = approvals().actions
    if (!always && (mode === 'go' || mode === 'warn')) {
      if (mode === 'warn') addLog(inst, 'hub', 'warned', `${label}: ${why}`)
      return
    }
    const origin = originOf(inst)
    if (confirmed === true) {
      for (const [id, a] of asks) {
        if (a.yes && a.expires > Date.now() && a.inst === inst && a.label === label && a.origin === origin) { asks.delete(id); return }
      }
    }
    for (const [id, a] of asks) if (a.expires <= Date.now()) asks.delete(id)
    while (asks.size >= 20) asks.delete(asks.keys().next().value)
    const id = crypto.randomBytes(16).toString('hex')
    asks.set(id, { inst, label, what, url: inst.tabs.get(inst.active)?.url || '', origin, yes: false, expires: Date.now() + ASK_MS })
    throw err(428, `${why} A card is on screen. Stop and wait. Only the card's Allow counts; a typed yes doesn't. After Allow, ${retry} with confirmed: true.`, { needsConfirmation: label, confirmId: id })
  }

  async function pressKey(inst, name, modifiers = 0) {
    const k = KEYS[name] || (name.length === 1 ? [name.toUpperCase().charCodeAt(0), name, name] : null)
    if (!k) throw err(400, `unknown key ${name}; use one of ${Object.keys(KEYS).join(', ')} or a single character`)
    const [vk, key, text] = k
    const base = { key: name === ' ' ? ' ' : key, code: name.length === 1 && /[a-z]/i.test(name) ? `Key${name.toUpperCase()}` : key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
    await inst.cdp.send('Input.dispatchKeyEvent', { type: text && !modifiers ? 'keyDown' : 'rawKeyDown', ...base, ...(text && !modifiers ? { text, unmodifiedText: text } : {}) }, inst.session)
    await inst.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, inst.session)
  }

  // Asks the user to take over: control moves to them and the pop-up shows the reason.
  function handoff(inst, reason) {
    inst.controller = 'owner'
    inst.ask = String(reason || 'The agent needs you to take over').slice(0, 200)
    pushState(inst)
  }

  async function act(body, who) {
    const a = String(body.act || '')
    // Profile switching and per-profile settings work without starting Chrome.
    if (a === 'profile') {
      conf.current = get(body.to)
      saveConf()
      addLog(null, who, 'profile', `switched to ${PROFILES[conf.current].label}`)
      return { ok: true, current: conf.current }
    }
    if (a === 'mode') {
      const p = get(body.profile)
      conf.mode[p] = body.mode === 'headed' ? 'headed' : 'headless'
      saveConf()
      const inst = insts.get(p)
      if (inst && !inst.cdp.closed) { await stop(inst, `restarting ${conf.mode[p]}`); await sleep(1500) }
      return { ok: true, mode: conf.mode[p] }
    }
    if (a === 'close') {
      const inst = insts.get(get(body.profile))
      await stop(inst, `closed by ${who}`)
      return { ok: true }
    }
    const inst = await ensure(body.profile)
    inst.lastUse = Date.now()
    if (a === 'control') {
      const to = body.to === 'agent' ? 'agent' : 'owner'
      if (to !== inst.controller) addLog(inst, who, 'control', to === 'owner' ? 'You took control' : 'You gave control back to the agent')
      inst.controller = to
      inst.ask = ''
      pushState(inst)
      return { ok: true, controller: to }
    }
    if (who === 'agent') {
      if (inst.controller === 'owner') throw err(409, `The user has control of the browser${inst.ask ? ` (you asked: ${inst.ask})` : ''}. Wait for them to give it back, or ask them in chat.`)
      inst.lastAgent = Date.now()
    }
    const s = inst.session
    const done = async (actName, detail, extra = {}) => {
      const e = addLog(inst, who, actName, detail)
      if (who === 'agent') await keepShot(inst, e)
      pushState(inst)
      return { ok: true, id: e.id, shot: e.shot, url: inst.tabs.get(inst.active)?.url, title: inst.tabs.get(inst.active)?.title, ...extra }
    }
    switch (a) {
      case 'open': {
        const url = normUrl(body.url)
        if (body.newTab) {
          const { targetId } = await inst.cdp.send('Target.createTarget', { url })
          inst.tabs.set(targetId, inst.tabs.get(targetId) || { id: targetId, url, title: '' })
          await activate(inst, targetId)
        } else await inst.cdp.send('Page.navigate', { url }, s)
        await waitLoad(inst)
        return done('open', url)
      }
      case 'back': case 'forward': {
        const h = await inst.cdp.send('Page.getNavigationHistory', {}, s)
        const entry = h.entries[h.currentIndex + (a === 'back' ? -1 : 1)]
        if (!entry) throw err(409, `nothing to go ${a} to`)
        await inst.cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id }, s)
        await waitLoad(inst)
        return done(a, entry.url)
      }
      case 'reload':
        await inst.cdp.send('Page.reload', {}, s)
        await waitLoad(inst)
        return done('reload', '')
      case 'stop':
        await inst.cdp.send('Page.stopLoading', {}, s)
        return done('stop', '')
      case 'tab_new': {
        const url = body.url ? normUrl(body.url) : START_URL
        const { targetId } = await inst.cdp.send('Target.createTarget', { url })
        inst.tabs.set(targetId, inst.tabs.get(targetId) || { id: targetId, url, title: '' })
        await activate(inst, targetId)
        return done('tab_new', url)
      }
      case 'tab_select':
        await activate(inst, String(body.id))
        return done('tab_select', inst.tabs.get(inst.active)?.title || body.id)
      case 'tab_close': {
        const id = String(body.id || inst.active)
        if (!inst.tabs.has(id)) throw err(404, `no tab ${id}`)
        const t = inst.tabs.get(id)
        await inst.cdp.send('Target.closeTarget', { targetId: id })
        return done('tab_close', t.title || t.url)
      }
      case 'click': {
        const d = await evalPage(inst, describeJs(body.ref, body.x, body.y))
        if (!d) throw err(404, body.ref ? `no element [${body.ref}] on the page; take a new snapshot` : 'nothing at that point')
        if (who === 'agent') {
          const host = hostOf(inst)
          const social = SOCIAL_RE.test(host) && POST_RE.test(d.label)
          if (social && approvals().socialPosts !== 'ask') throw err(403, `Refused: "${d.label}" on ${host}. The agent never posts or shares on the user's social accounts; the user does that.`)
          if (social || RISKY_RE.test(d.label) || d.unnamedSubmit || d.formSubmit) needYes(inst, d.label || 'This button', 'Click this in the browser?', `"${d.label || 'This button'}" may send, buy, delete or accept something.`, 'call click again', body.confirmed, social)
        }
        await mouseClick(inst, d.x, d.y, body.button === 'right' ? 'right' : 'left', body.double ? 2 : 1)
        await sleep(250)
        await waitLoad(inst, 4000)
        return done('click', `${d.label || d.tag}${body.ref ? ` [${body.ref}]` : ` at ${d.x},${d.y}`}${body.confirmed === true ? ' (confirmed)' : ''}`)
      }
      case 'hover': {
        const d = await evalPage(inst, describeJs(body.ref, body.x, body.y))
        if (!d) throw err(404, 'element not found')
        await inst.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: d.x, y: d.y }, s)
        return done('hover', d.label || d.tag)
      }
      case 'type': {
        const text = String(body.text ?? '')
        const mayType = approvals().secrets === 'allow' // the owner's choice; off unless they set it
        let secret = false
        if (body.ref) {
          const d = await evalPage(inst, describeJs(body.ref))
          if (!d) throw err(404, `no element [${body.ref}] on the page; take a new snapshot`)
          if (who === 'agent' && d.sensitive && !mayType) return refuseSensitive(inst, `the ${d.type === 'password' ? 'password' : d.label || 'sensitive'} field`)
          secret = d.sensitive
          await mouseClick(inst, d.x, d.y)
          await sleep(80)
        }
        if (who === 'agent') {
          const f = await evalPage(inst, FOCUS_JS)
          secret = secret || f.sensitive || luhnCard(text)
          if (f.sensitive && !mayType) return refuseSensitive(inst, `the ${f.type === 'password' ? 'password' : 'sensitive'} field`)
          if (secret && !mayType) return refuseSensitive(inst, 'a card number')
        }
        if (body.submit && who === 'agent') await checkEnter(inst, false, body.confirmed)
        if (body.clear) {
          await inst.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 }, s)
          await inst.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 }, s)
          await pressKey(inst, 'Backspace')
        }
        if (text) await inst.cdp.send('Input.insertText', { text }, s)
        if (body.submit) { await pressKey(inst, 'Enter'); await sleep(250); await waitLoad(inst, 4000) }
        return done('type', who === 'agent' && !secret ? `"${text.slice(0, 120)}"${body.submit ? ' + Enter' : ''}` : `${text.length} characters`)
      }
      case 'key': {
        const mods = (body.ctrl ? 2 : 0) | (body.shift ? 8 : 0) | (body.alt ? 1 : 0)
        if (who === 'agent' && body.key === 'Enter' && !body.shift) await checkEnter(inst, !!body.ctrl, body.confirmed)
        await pressKey(inst, String(body.key || ''), mods)
        if (body.key === 'Enter') { await sleep(250); await waitLoad(inst, 4000) }
        return done('key', `${body.ctrl ? 'Ctrl+' : ''}${body.shift ? 'Shift+' : ''}${body.key}`)
      }
      case 'scroll': {
        let x = inst.size.w / 2, y = inst.size.h / 2
        if (body.ref) { const d = await evalPage(inst, describeJs(body.ref)); if (d) ({ x, y } = d) }
        const dy = body.dy != null ? +body.dy : (body.direction === 'up' ? -1 : 1) * (+body.amount || 0.8) * inst.size.h
        await inst.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: +body.dx || 0, deltaY: dy }, s)
        await sleep(300)
        return done('scroll', `${dy > 0 ? 'down' : 'up'} ${Math.abs(Math.round(dy))}px`)
      }
      case 'select': {
        const ok = await evalPage(inst, `(() => { const el = document.querySelector('[data-hub-ref="${Number(body.ref)}"]'); if (!el || el.tagName !== 'SELECT') return false
          const v = ${JSON.stringify(String(body.value ?? ''))}; const o = [...el.options].find(o => o.value === v || o.text.trim() === v); if (!o) return false
          el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return o.text })()`)
        if (!ok) throw err(404, `no select [${body.ref}] with option "${body.value}"`)
        return done('select', `${ok} [${body.ref}]`)
      }
      case 'dialog': {
        if (!inst.dialog) throw err(409, 'no dialog is open')
        if (who === 'agent' && body.accept && inst.dialog.type === 'beforeunload') needYes(inst, 'Leave this page', 'Leave this page?', 'Leaving this page may lose what was typed.', 'call dialog again', body.confirmed)
        await inst.cdp.send('Page.handleJavaScriptDialog', { accept: !!body.accept, ...(body.text ? { promptText: String(body.text) } : {}) }, s)
        inst.dialog = null
        return done('dialog', body.accept ? 'OK' : 'Cancel')
      }
      case 'wait':
        await sleep(Math.max(0, Math.min(10e3, +body.ms || 1000)))
        return done('wait', `${body.ms || 1000} ms`)
      case 'handoff':
        handoff(inst, body.reason)
        return done('handoff', inst.ask)
      case 'size': {
        const fit = body.mode === 'fit'
        const wasMobile = !!inst.size?.mobile
        inst.size = fit
          ? { mode: 'fit', w: Math.round(Math.max(320, Math.min(1920, +body.w || DESKTOP.w))), h: Math.round(Math.max(300, Math.min(1400, +body.h || DESKTOP.h))), mobile: (+body.w || DESKTOP.w) < 700 }
          : { mode: 'desktop', ...DESKTOP, mobile: false }
        conf.size[inst.profile] = inst.size
        saveConf()
        for (const t of inst.tabs.values()) if (t.session) await applySize(inst, t.session)
        // The UA switch only shows after a load, so reload the open page when phone/desktop flips
        if (wasMobile !== !!inst.size.mobile && inst.session) await inst.cdp.send('Page.reload', {}, inst.session).catch(() => {})
        await recast(inst)
        // That first frame can still be the old layout, and a page that isn't moving sends no other.
        setTimeout(() => { if (inst.viewers.size) recast(inst).catch(() => {}) }, 400)
        pushState(inst)
        return { ok: true, size: inst.size }
      }
      default:
        throw err(400, `unknown act "${a}"`)
    }
  }

  function refuseSensitive(inst, what) {
    handoff(inst, `Type the ${what || 'password or code'} yourself, then give control back`)
    addLog(inst, 'hub', 'refused', `agent tried to type into ${what || 'a sensitive field'}; asked the user to take over`)
    throw err(403, `Refused: that is a password, card or one-time-code field (${what}). The agent never types these. Control was handed to the user with a note; tell them in chat what to enter and wait for them to give control back.`)
  }

  async function waitLoad(inst, ms = 8000) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      try {
        const r = await inst.cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, inst.session, 2000)
        if (r.result.value === 'complete' || r.result.value === 'interactive') return
      } catch {}
      await sleep(200)
    }
  }

  /* ---------- the user's raw input from the stream ---------- */

  async function input(body) {
    const inst = await ensure(body.profile)
    inst.lastUse = Date.now()
    if (inst.controller !== 'owner') {
      if (Date.now() - inst.lastAgent < AGENT_QUIET_MS) throw err(409, 'The agent is working. Take control first.')
      inst.controller = 'owner'
      inst.ask = ''
      addLog(inst, 'owner', 'control', 'You took control')
      pushState(inst)
    }
    const s = inst.session
    const out = { ok: true }
    for (const e of (body.events || []).slice(0, 200)) {
      const mods = +e.mods || 0
      if (e.t === 'focus') {
        // After a click: did it land in a text field? (The TV then opens its typing sheet at once.)
        await new Promise(r => setTimeout(r, 120))
        const r = await inst.cdp.send('Runtime.evaluate', { expression: `(() => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; if (!a) return false; if (a.isContentEditable) return true; if (a.tagName === 'TEXTAREA') return !a.readOnly && !a.disabled; if (a.tagName !== 'INPUT') return false; return !a.readOnly && !a.disabled && !/^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i.test(a.type) })()`, returnByValue: true }, s).catch(() => null)
        out.editable = r?.result?.value === true
      } else if (e.t === 'mouse') {
        await inst.cdp.send('Input.dispatchMouseEvent', { type: e.type, x: +e.x, y: +e.y, button: e.button || 'none', buttons: +e.buttons || 0, clickCount: +e.clicks || (e.type === 'mouseMoved' ? 0 : 1), modifiers: mods }, s)
      } else if (e.t === 'wheel') {
        await inst.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: +e.x, y: +e.y, deltaX: +e.dx || 0, deltaY: +e.dy || 0, modifiers: mods }, s)
      } else if (e.t === 'touch') {
        await inst.cdp.send('Input.dispatchTouchEvent', { type: e.type, touchPoints: (e.points || []).map(p => ({ x: +p.x, y: +p.y, id: +p.id || 0 })), modifiers: mods }, s)
      } else if (e.t === 'key') {
        await inst.cdp.send('Input.dispatchKeyEvent', {
          type: e.type, key: e.key, code: e.code, windowsVirtualKeyCode: +e.vk || 0, nativeVirtualKeyCode: +e.vk || 0, modifiers: mods,
          ...(e.text ? { text: e.text, unmodifiedText: e.text } : {}),
          ...(Array.isArray(e.commands) ? { commands: e.commands.filter(c => ['selectAll', 'copy', 'cut', 'undo', 'redo'].includes(c)) } : {}),
        }, s)
      } else if (e.t === 'text') {
        await inst.cdp.send('Input.insertText', { text: String(e.text || '') }, s)
      } else if (e.t === 'snap') {
        // The TV remote's arrows: the nearest link, button or field that way from (x, y), in page pixels, hovered.
        if (!['up', 'down', 'left', 'right'].includes(e.dir)) throw err(400, 'snap needs dir: up, down, left or right')
        const r = await evalPage(inst, SNAP_JS(+e.x || 0, +e.y || 0, e.dir)).catch(() => null)
        out.target = r && Number.isFinite(r.cx) ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), cx: Math.round(r.cx), cy: Math.round(r.cy) } : null
        if (out.target) await inst.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: out.target.cx, y: out.target.cy, button: 'none', buttons: 0, modifiers: 0 }, s)
      } else if (e.t === 'where') {
        // How far down the page is (after a wheel): lets the TV carry on link to link past the screen's edge.
        await new Promise(r => setTimeout(r, 80))
        out.scroll = await evalPage(inst, `({ y: Math.round(scrollY), max: Math.max(0, document.documentElement.scrollHeight - innerHeight) })`).catch(() => null)
      }
    }
    return out
  }

  /* ---------- routes ---------- */

  const status = async profile => {
    const p = get(profile)
    const inst = insts.get(p)
    const run = inst && !inst.cdp.closed && !inst.starting
    return {
      profiles: Object.entries(PROFILES).map(([id, v]) => ({ id, ...v, running: !!insts.get(id) && !insts.get(id).cdp.closed && !insts.get(id).starting, mode: conf.mode[id] || 'headless' })),
      current: conf.current,
      ...(run ? state(inst) : { running: false, profile: p, controller: 'agent', mode: conf.mode[p] || 'headless' }),
      idleMinutes: IDLE_MS / 60e3,
      chrome: run ? inst.chrome : undefined,
      startedAt: run ? inst.started : undefined,
    }
  }

  return async function route(url, req, res, { send, readBody }) {
    if (!url.pathname.startsWith('/api/browser/')) return false
    const p = url.pathname.slice('/api/browser/'.length)
    const q = url.searchParams
    const who = req.headers['x-hub-actor'] === 'agent' ? 'agent' : 'owner'
    if (req.method === 'GET') {
      if (p === 'status') return send(res, 200, await status(q.get('profile'))), true
      if (p === 'stream') return await openStream(q.get('profile'), req, res), true
      if (p === 'log') {
        const since = +q.get('since') || 0
        const prof = q.get('profile')
        const entries = log.filter(e => e.id > since && (!prof || e.profile === prof)).slice(-Math.min(400, +q.get('limit') || 100))
        return send(res, 200, { entries }), true
      }
      const yes = /^confirm\/([0-9a-f]{32})$/.exec(p)
      if (yes) {
        const a = liveAsk(yes[1])
        if (!a || a.yes) return send(res, 404, { error: 'That card has gone.' }), true
        return send(res, 200, { what: a.what, label: a.label, url: a.url }), true
      }
      const sh = /^shots\/(\d+)\.jpg$/.exec(p)
      if (sh) {
        const buf = await fs.promises.readFile(path.join(SHOTS, `${sh[1]}.jpg`)).catch(() => null)
        if (!buf) return send(res, 404, { error: 'no such shot' }), true
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' })
        return res.end(buf), true
      }
      if (p === 'screenshot') {
        const inst = await ensure(q.get('profile'))
        inst.lastUse = Date.now()
        const format = q.get('format') === 'png' ? 'png' : 'jpeg'
        const buf = await shot(inst, { format, quality: q.get('quality'), w: q.get('w') })
        res.writeHead(200, { 'content-type': `image/${format}`, 'cache-control': 'no-store', 'x-url': encodeURI(inst.tabs.get(inst.active)?.url || ''), 'x-controller': inst.controller })
        return res.end(buf), true
      }
      if (p === 'snapshot' || p === 'text') {
        const inst = await ensure(q.get('profile'))
        inst.lastUse = Date.now()
        const snap = await evalPage(inst, SNAPSHOT_JS)
        if (p === 'text') return send(res, 200, { url: snap.url, title: snap.title, text: snap.text }), true
        return send(res, 200, { ...snap, controller: inst.controller, ask: inst.ask, dialog: inst.dialog, profile: inst.profile }), true
      }
      return send(res, 404, { error: 'not found' }), true
    }
    if (req.method === 'POST') {
      const body = await readBody(req).catch(() => { throw err(400, 'body must be JSON') })
      if (p === 'act') {
        try {
          return send(res, 200, await act(body, who)), true
        } catch (e) {
          if ([403, 409, 428].includes(e.code)) {
            if (who === 'agent' && e.code !== 409) addLog(insts.get(body.profile || conf.current), 'hub', 'refused', e.message.slice(0, 200))
            return send(res, e.code, { error: e.message, ...(e.needsConfirmation ? { needsConfirmation: e.needsConfirmation } : {}), ...(e.confirmId ? { confirmId: e.confirmId } : {}) }), true
          }
          throw e
        }
      }
      const yes = /^confirm\/([0-9a-f]{32})$/.exec(p)
      if (yes) {
        if (who === 'agent') return send(res, 403, { error: 'Only the user answers a card.' }), true
        // The body is already read, so this check and the change below happen together: one answer per card.
        const a = liveAsk(yes[1])
        if (!a || a.yes) return send(res, 404, { error: 'That card has gone.' }), true
        if (body?.allow !== true) { asks.delete(yes[1]); addLog(a.inst, 'owner', 'confirm', `Not allowed: ${a.label}`); return send(res, 200, { ok: true, allowed: false, message: 'Not allowed.' }), true }
        a.yes = true
        a.expires = Date.now() + ASK_MS
        addLog(a.inst, 'owner', 'confirm', `Allowed: ${a.label}`)
        return send(res, 200, { ok: true, allowed: true, message: 'Allowed once.' }), true
      }
      if (p === 'input') {
        if (who === 'agent') return send(res, 403, { error: 'agents use /api/browser/act' }), true
        try { return send(res, 200, await input(body)), true } catch (e) { if (e.code === 409) return send(res, 409, { error: e.message }), true; throw e }
      }
      return send(res, 404, { error: 'not found' }), true
    }
    return send(res, 405, { error: 'method not allowed' }), true
  }
}
