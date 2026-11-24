// LocalHub TV: the Assistant screen. Its own small module, so the TV never loads the hub's tabs/chat.js or
// tabs/browser.js. It shows the same conversation as the hub, live, and talks the same protocol (chat.mjs):
//
//   POST /api/chat/send     { text, client, sessionId?, tab: 'tv' }  -> NDJSON: session, text_start, delta, text_end,
//                           tool, tool_result, site, browser, attachment, confirm, connect, error, ping, done
//   GET  /api/chat/live     SSE { seq, conv, from, ev }: hello | current | user | every event above, from any device.
//                           `from` is the sender's client id: this page skips its own lines (its stream showed them).
//   GET  /api/chat/sessions[/<id>]   the recent chats, and one chat (with `seq` and the reply's text so far)
//   POST /api/chat/current  { sessionId?, client }   this chat is now current on every device ('' = new chat)
//   POST /api/chat/stop     { sessionId }
//
//   import * as Assistant from "./assistant.js"
//   Assistant.init({ el, toast, native, NATIVE, intercept, speechMode, onActivity, onEdge? })
//     el: an empty, sized, positioned <section> (x 140..1920 on the 1920×1080 canvas). native/NATIVE: the shell's
//     LocalHubNative bridge (setTyping goes to it while the field has the TV keyboard). intercept(text) -> true when the
//     shell handled a TV command itself. speechMode() -> "After voice" | "Always" | "Off". onActivity(bool): a reply
//     runs / ended (this TV's or another device's). onEdge(dir): only for a shell that doesn't pass keys on while the
//     field has DOM focus; called when Left leaves the field at its left edge.
//   Assistant.show() / hide()          visible or not; show() puts focus on the field
//   Assistant.key(name) -> bool        "up" "down" "left" "right" "enter" "back" "ai". false: not mine (Left at the
//                                      screen's left edge, Back with nothing to close): the shell takes focus, and
//                                      this screen drops its focus mark until key() or focus() is called again.
//                                      preventDefault the DOM key when it returns true (it moves the caret itself).
//   Assistant.focus()                  focus comes back from the sidebar to where it was
//   Assistant.ask(text, { voice })     send a question; voice: true reads the answer aloud under "After voice"
//   Assistant.voice()                  start talking, or stop and send
//   Assistant.state()                  { busy, remote, conv, focus, voice, … } for tests and the harness
//
// Built for a Fire TV Stick drawing at 4K: flat surfaces, no blur, no masks; a reply's words are appended to the last
// message, never re-rendered; the transcript keeps its last MAX_ITEMS rows; focus is a class on one small element (or
// one ring over a message); nothing animates while idle (the dots run only while a reply is pending, the wave only
// while listening).

const MAX_ITEMS = 60
const MAX_ACT_LINES = 4
import * as AgentView from './agentview.js?v=1'
const BROWSER = 'mcp__hub-browser__browser_'
const SUGGEST = ['What’s on my calendar today?', 'Is anything down?', 'What’s the weather?', 'Open YouTube']

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const trim = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const json = s => { try { return JSON.parse(s) || {} } catch { return {} } }
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify(body || {}) })
const ago = ms => {
  if (!ms) return ''
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  const d = Math.floor(s / 86400)
  return d === 1 ? 'Yesterday' : d < 7 ? `${d} days ago` : new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

const IC = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
}

/* ---------- state ---------- */

let O = {}
let R = null // elements
let mounted = false
const S = { away: false, busy: false, remote: false, conv: '', title: '', ctrl: null, gen: 0, stopped: false, queue: [], shown: false, askedOn: '', activity: false, client: `tv${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}` }
const L = { es: null, seq: 0, current: '', ready: false, loading: false, held: [], turn: 0, retry: 0 }
const V = { state: 'idle', rec: null, speak: false, said: 0, text: '', cancelled: false, since: 0, voice: undefined, clock: 0 }
// Focus: zone bar | chips | log | list. bar holds an id (input, talk, stop, new, chats); log/chips/list an index.
const F = { zone: 'bar', bar: 'input', i: 0, sub: 0, el: null }
// The transcript: top-level rows, the reply being written, this turn's activity block and browser card.
const T = { items: [], cur: null, acts: null, bro: null, raf: 0, dirty: false }

const HV = () => (window.HubVoice && typeof window.HubVoice.listen === 'function' ? window.HubVoice : null)
const mode = () => { try { return String(O.speechMode?.() || 'After voice') } catch { return 'After voice' } }
const voiceMode = () => { try { return !!O.voiceMode?.() } catch { return false } }
// Voice mode: once the answer has been read out (about as long as reading it takes), it's your turn to talk.
function yourTurn() {
  const last = [...T.items].reverse().find(x => x.classList?.contains('as-bot'))
  const words = (last?.innerText || '').split(/\s+/).filter(Boolean).length
  clearTimeout(V.turnT)
  V.turnT = setTimeout(() => { if (mounted && !S.busy && S.shown !== false) voice() }, 900 + Math.min(words, 400) * 380)
}

/* ---------- mounting ---------- */

export function init(opts = {}) {
  if (mounted) return
  mounted = true
  O = opts
  const el = opts.el
  el.classList.add('as')
  el.hidden = true
  el.innerHTML = `
    <header class="as-head"><h2 class="as-title">New chat</h2><span class="as-state" hidden>Answering…</span></header>
    <div class="as-log" tabindex="-1">
      <div class="as-empty"><h3>Ask LocalHub anything</h3><p>Press ⏯ to talk, or OK on the box below to type.</p></div>
      <div class="as-pending" hidden><i></i><i></i><i></i></div>
      <div class="as-ring" hidden></div>
    </div>
    <div class="as-chips"></div>
    <div class="as-note" hidden></div>
    <div class="as-bar">
      <form class="as-field" data-f="input" autocomplete="off">
        <input class="as-input" type="text" enterkeyhint="send" autocomplete="off" autocapitalize="sentences" spellcheck="false" placeholder="Ask anything" aria-label="Ask LocalHub">
        <div class="as-voice" hidden><canvas class="as-wave"></canvas><span class="as-vword"></span><span class="as-vclock"></span></div>
      </form>
      <button type="button" class="as-btn as-talk" data-f="talk">${IC.mic}<span>Talk</span></button>
      <button type="button" class="as-btn as-stop" data-f="stop" hidden>${IC.stop}<span>Stop</span></button>
      <button type="button" class="as-btn" data-f="new">${IC.plus}<span>New chat</span></button>
      <button type="button" class="as-btn" data-f="chats">${IC.list}<span>Chats</span></button>
    </div>
    <aside class="as-panel" hidden><h3>Recent chats</h3><div class="as-rows"></div></aside>`
  const q = s => el.querySelector(s)
  R = {
    el, title: q('.as-title'), state: q('.as-state'), log: q('.as-log'), empty: q('.as-empty'), pending: q('.as-pending'), ring: q('.as-ring'),
    note: q('.as-note'), chips: q('.as-chips'), bar: q('.as-bar'), field: q('.as-field'), input: q('.as-input'), voice: q('.as-voice'),
    wave: q('.as-wave'), vword: q('.as-vword'), vclock: q('.as-vclock'), talk: q('.as-talk'), stop: q('.as-stop'),
    panel: q('.as-panel'), rows: q('.as-rows'),
  }
  // The header steps aside once the conversation is under it (the transcript runs to the top of the screen).
  R.log.addEventListener('scroll', () => { const on = R.log.scrollTop > 12; if (on !== R.scrolled) { R.scrolled = on; el.classList.toggle('scrolled', on) } }, { passive: true })
  R.chips.innerHTML = SUGGEST.map(s => `<button type="button" class="as-chip">${esc(s)}</button>`).join('')

  // Pointer and touch still work (the laptop preview, a phone): a click moves focus there and presses it.
  R.field.addEventListener('submit', e => { e.preventDefault(); sendInput() })
  R.input.addEventListener('focus', () => { S.away = false; setFocus('bar', 'input'); native('setTyping', true) })
  R.input.addEventListener('blur', () => { native('setTyping', false); clearTimeout(S.dictated) })
  // What the remote's mic dictates lands a phrase at a time (typing on the TV's keyboard is a letter at a time).
  // A moment after the words stop coming, it sends by itself, as if OK had been pressed.
  let was = ''
  R.input.addEventListener('input', () => {
    const now = R.input.value
    const grew = now.length - was.length
    was = now
    if (grew >= 4 || (S.dictating && grew > 0)) {
      S.dictating = true
      clearTimeout(S.dictated)
      S.dictated = setTimeout(() => { S.dictating = false; was = ''; if (R.input.value.trim()) { sendInput(); native('keyboard', false) } }, 1300)
    } else if (grew !== 0 && !S.dictating) clearTimeout(S.dictated)
  })
  // Keys the shell didn't take while the field has the browser's focus (arrows, Esc). Enter is the form's submit.
  R.input.addEventListener('keydown', e => {
    if (e.defaultPrevented) return
    const name = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Escape: 'back', MediaPlayPause: 'ai' }[e.key]
    if (!name) return
    if (key(name)) e.preventDefault()
    else if (name === 'left' || name === 'right') O.onEdge?.(name)
  })
  R.bar.addEventListener('click', e => {
    const b = e.target.closest('button[data-f]')
    if (b) { setFocus('bar', b.dataset.f); press() }
  })
  R.log.addEventListener('click', e => {
    const item = e.target.closest('.as-card, .as-msg')
    const i = item ? T.items.indexOf(item) : -1
    if (i < 0 || e.target.closest('button')) return
    F.zone = 'log'; F.i = i; F.sub = 0; paintFocus(); press()
  })
  R.chips.addEventListener('click', e => {
    const b = e.target.closest('.as-chip')
    if (b) { setFocus('chips', [...R.chips.children].indexOf(b)); press() }
  })
  R.rows.addEventListener('click', e => {
    const b = e.target.closest('.as-row')
    if (b) { F.i = [...R.rows.children].indexOf(b); F.zone = 'list'; press() }
  })
  R.log.addEventListener('click', e => {
    const b = e.target.closest('.as-confirm button')
    if (!b) return
    const item = b.closest('.as-item')
    F.zone = 'log'; F.i = T.items.indexOf(item); F.sub = [...b.parentNode.children].indexOf(b); press()
  })

  syncEmpty()
  syncBar()
  connectLive()
  fetch('/api/chat/info').then(r => r.json()).then(i => {
    if (i && i.ready === false) R.empty.querySelector('p').textContent = 'The assistant needs Claude Code on the computer running LocalHub.'
  }, () => {})
}

const native = (name, ...args) => {
  try { return typeof O.native === 'function' ? O.native(name, ...args) : undefined } catch { return undefined }
}

export function show() {
  if (!mounted) return
  S.shown = true
  S.away = false
  R.el.hidden = false
  if (F.zone !== 'list') setFocus('bar', 'input')
  scrollEnd(true)
  // On a laptop the field takes the keyboard at once; on a TV it waits for OK, which brings up the TV's keyboard.
  if (!O.NATIVE) R.input.focus({ preventScroll: true })
}

export function hide() {
  if (!mounted) return
  AgentView.close()
  S.shown = false
  R.input.blur()
  closeList()
  R.el.hidden = true
}

// "Hey LocalHub", heard by the laptop's mic: the same Listening… look as Talk, driven from the laptop.
export function hearing(stage) {
  if (!mounted) return
  if (stage === 'rec') { hush(); V.cancelled = false; V.remote = true; V.state = 'rec'; V.since = Date.now() }
  else if (stage === 'wait') { if (!V.remote) return; V.state = 'wait' }
  else { if (!V.remote) return; V.remote = false; V.state = 'idle' }
  syncVoice()
}
export function heard(text) {
  if (!mounted) return
  V.remote = false
  V.state = 'idle'
  syncVoice()
  text = String(text || '').trim()
  if (!text) return note('Didn’t catch that. Say “Hey LocalHub” and ask again.')
  submit(text, { voice: true })
}

export function ask(text, { voice = false } = {}) {
  if (!mounted) return false
  return submit(text, { voice })
}

/* ---------- focus and keys ---------- */

const barIds = () => ['input', 'talk', ...(S.busy ? ['stop'] : []), 'new', 'chats']
const barEl = id => R.bar.querySelector(`[data-f="${id}"]`)
const chipsOn = () => !R.chips.hidden
const typing = () => document.activeElement === R.input

function setFocus(zone, at, sub = 0) {
  F.zone = zone
  if (zone === 'bar') F.bar = at
  else F.i = at
  F.sub = sub
  paintFocus()
}

function paintFocus() {
  let el = null
  if (S.away) el = null
  else if (F.zone === 'bar') el = barEl(F.bar) || R.field
  else if (F.zone === 'chips') el = R.chips.children[F.i]
  else if (F.zone === 'list') el = R.rows.children[F.i]
  else if (F.zone === 'log') {
    const item = T.items[F.i]
    const btns = item?.querySelectorAll('.as-confirm-row button')
    el = btns?.length ? btns[Math.min(F.sub, btns.length - 1)] : null
  }
  if (F.el !== el) { F.el?.classList.remove('f'); el?.classList.add('f'); F.el = el }
  if (F.zone !== 'bar' || F.bar !== 'input') { if (typing()) R.input.blur() }
  // The ring: one element over the focused message, moved, never re-created.
  const item = F.zone === 'log' && !S.away ? T.items[F.i] : null
  if (item) {
    const box = item.querySelector(':scope > .as-bub') || item // hug the bubble, not the row
    R.ring.hidden = false
    R.ring.style.transform = `translate(${box.offsetLeft - 10}px, ${box.offsetTop - 10}px)`
    R.ring.style.width = `${box.offsetWidth + 20}px`
    R.ring.style.height = `${box.offsetHeight + 20}px`
  } else if (!R.ring.hidden) R.ring.hidden = true
  if (F.zone === 'list' && el) keepInView(R.panel, el, 120)
}

function keepInView(box, el, pad = 40) {
  const top = el.offsetTop, bottom = top + el.offsetHeight
  if (top - pad < box.scrollTop) box.scrollTop = Math.max(0, top - pad)
  else if (bottom + pad > box.scrollTop + box.clientHeight) box.scrollTop = bottom + pad - box.clientHeight
}

// The remote: up, down, left, right, enter, back, ai. False means "not mine": left at the screen's left edge goes to
// the sidebar, back at the bar goes wherever the shell goes back to.
export function key(name) {
  if (!mounted || !S.shown) return false
  // The assistant's browser, open full screen: the remote drives its cursor.
  if (AgentView.isOpen()) return AgentView.key(name, native)
  if (S.away) { S.away = false; paintFocus() }
  const mine = routeKey(name)
  // Not mine: the shell takes focus (the sidebar), so this screen stops showing any.
  if (!mine && (name === 'left' || name === 'back')) { S.away = true; if (typing()) R.input.blur(); paintFocus() }
  return mine
}

// Focus comes back from the shell (the sidebar) to where it was on this screen.
export function focus() {
  if (!mounted || !S.shown) return
  S.away = false
  paintFocus()
  if (!O.NATIVE && F.zone === 'bar' && F.bar === 'input') R.input.focus({ preventScroll: true })
}

function routeKey(name) {
  if (name === 'ai') { voice(); return true }
  if (name === 'rew' || name === 'ff') { R.log.scrollBy({ top: (name === 'ff' ? 0.8 : -0.8) * R.log.clientHeight, behavior: 'smooth' }); return true }
  if (name === 'back' && V.state === 'rec') { cancelVoice(); return true }
  if (F.zone === 'list') return listKey(name)
  if (F.zone === 'log') return logKey(name)
  if (F.zone === 'chips') return chipsKey(name)
  return barKey(name)
}

function barKey(name) {
  const ids = barIds()
  let k = ids.indexOf(F.bar)
  if (k < 0) { F.bar = 'input'; k = 0 }
  const inp = R.input
  if (name === 'left') {
    if (F.bar === 'input') {
      if (typing() && inp.selectionStart > 0) { const p = inp.selectionStart - 1; inp.setSelectionRange(p, p); return true }
      return false
    }
    setFocus('bar', ids[k - 1])
    return true
  }
  if (name === 'right') {
    if (F.bar === 'input' && typing() && inp.selectionEnd < inp.value.length) { const p = inp.selectionEnd + 1; inp.setSelectionRange(p, p); return true }
    if (k < ids.length - 1) setFocus('bar', ids[k + 1])
    return true
  }
  if (name === 'up') {
    if (chipsOn()) setFocus('chips', 0)
    else if (T.items.length) focusItem(T.items.length - 1, -1)
    return true
  }
  if (name === 'down') return true
  if (name === 'enter') { press(); return true }
  if (name === 'back') {
    if (typing()) { inp.blur(); return true }
    return false
  }
  return false
}

function chipsKey(name) {
  const n = R.chips.children.length
  if (name === 'left') { if (F.i === 0) return false; setFocus('chips', F.i - 1); return true }
  if (name === 'right') { if (F.i < n - 1) setFocus('chips', F.i + 1); return true }
  if (name === 'down' || name === 'back') { setFocus('bar', 'input'); return true }
  if (name === 'up') { if (T.items.length) focusItem(T.items.length - 1, -1); return true }
  if (name === 'enter') { press(); return true }
  return false
}

// Messages: up and down step through them; a message taller than the screen scrolls through first.
function logKey(name) {
  const box = R.log
  const item = T.items[F.i]
  if (!item) { setFocus('bar', 'input'); return true }
  const step = box.clientHeight * 0.75
  if (name === 'up') {
    if (item.offsetTop < box.scrollTop - 4) { box.scrollTop = Math.max(item.offsetTop - 40, box.scrollTop - step); return true }
    if (F.i > 0) focusItem(F.i - 1, -1)
    return true
  }
  if (name === 'down') {
    const bottom = item.offsetTop + item.offsetHeight
    if (bottom > box.scrollTop + box.clientHeight + 4) { box.scrollTop = Math.min(bottom - box.clientHeight + 40, box.scrollTop + step); return true }
    if (F.i < T.items.length - 1) focusItem(F.i + 1, 1)
    else { setFocus('bar', 'input'); scrollEnd(true) }
    return true
  }
  if (name === 'left') {
    if (F.sub > 0) { F.sub--; paintFocus(); return true }
    return false
  }
  if (name === 'right') {
    const n = item.querySelectorAll('.as-confirm-row button').length
    if (F.sub < n - 1) { F.sub++; paintFocus() }
    return true
  }
  if (name === 'enter') { press(); return true }
  if (name === 'back') { setFocus('bar', 'input'); scrollEnd(true); return true }
  return false
}

function listKey(name) {
  const n = R.rows.children.length
  if (name === 'up') { if (F.i > 0) setFocus('list', F.i - 1); return true }
  if (name === 'down') { if (F.i < n - 1) setFocus('list', F.i + 1); return true }
  if (name === 'enter') { press(); return true }
  if (name === 'back' || name === 'left') { closeList(); return true }
  return true
}

function focusItem(i, dir) {
  F.zone = 'log'
  F.i = Math.max(0, Math.min(T.items.length - 1, i))
  F.sub = 0
  const item = T.items[F.i]
  const box = R.log
  // Coming up from below shows the end of a tall message, coming down shows its start.
  if (item.offsetHeight > box.clientHeight - 80) box.scrollTop = dir < 0 ? item.offsetTop + item.offsetHeight - box.clientHeight + 40 : item.offsetTop - 40
  else keepInView(box, item, 40)
  paintFocus()
}

// OK on whatever has focus.
function press() {
  if (F.zone === 'bar') {
    if (F.bar === 'input') {
      if (typing()) sendInput()
      else R.input.focus({ preventScroll: true })
    } else if (F.bar === 'talk') voice()
    else if (F.bar === 'stop') stop()
    else if (F.bar === 'new') newChat()
    else if (F.bar === 'chats') openList()
    return
  }
  if (F.zone === 'chips') {
    const t = R.chips.children[F.i]?.textContent
    setFocus('bar', 'input')
    if (t) submit(t)
    return
  }
  if (F.zone === 'list') {
    const row = R.rows.children[F.i]
    if (!row) return
    const id = row.dataset.id
    closeList()
    if (id && id !== S.conv) openConv(id, { announce: true })
    return
  }
  if (F.zone === 'log') {
    const item = T.items[F.i]
    const b = item?.querySelectorAll('.as-confirm-row button')[F.sub]
    if (b && item.__confirm) return answerConfirm(item.__confirm, b.dataset.allow === '1')
    // OK on a message reads it aloud (whatever "Read answers aloud" is set to: you asked); OK again stops it.
    if (item?.classList.contains('as-msg')) return readAloud(item)
    if (item?.__app) return O.openApp?.(item.__app)
    // A page the assistant opened for you: in the TV's own browser, to use with the remote.
    if (item?.__site?.url) return O.openUrl?.(item.__site.url, item.__site.name)
    // OK on the browser card: the assistant's browser, live, driven with the remote.
    if (item?.__browser) return AgentView.open({ host: R.el, toast: msg => O.toast?.(msg), onClose: () => paintFocus() })
  }
}

function readAloud(item) {
  if (V.reading === item) { hush(); V.reading = null; item.classList.remove('reading'); return }
  hush()
  T.items.forEach(x => x.classList?.remove('reading'))
  const text = (item.innerText || item.textContent || '').trim()
  if (!text) return
  V.reading = item
  item.classList.add('reading')
  if (window.HubVoice?.speak) window.HubVoice.speak(text)
  else if (window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(text)
    const v = pickVoice()
    if (v) u.voice = v
    u.rate = 1.08
    u.onend = () => { if (V.reading === item) { V.reading = null; item.classList.remove('reading') } }
    speechSynthesis.speak(u)
  }
  // The TV's voice doesn't say when it's done: the mark goes after about as long as reading it takes.
  clearTimeout(V.readT)
  V.readT = setTimeout(() => { if (V.reading === item) { V.reading = null; item.classList.remove('reading') } }, 1500 + text.split(/\s+/).length * 380)
}

/* ---------- the bar ---------- */

function syncBar() {
  R.stop.hidden = !S.busy
  if (!S.busy && F.zone === 'bar' && F.bar === 'stop') F.bar = 'input'
  R.input.placeholder = S.busy ? 'Ask a follow-up' : 'Ask anything'
  R.state.hidden = !S.busy
  const on = S.busy
  if (on !== S.activity) {
    S.activity = on
    try { O.onActivity?.(on) } catch {}
  }
  if (S.shown) paintFocus()
}

function syncEmpty() {
  const empty = !T.items.length && !S.busy
  R.empty.hidden = !empty
  R.chips.hidden = !empty
  if (!empty && F.zone === 'chips') setFocus('bar', 'input')
  R.title.textContent = S.title || 'New chat'
}

let noteTimer = 0
function note(msg, ms = 6000) {
  R.note.textContent = msg
  R.note.hidden = false
  R.el.classList.add('noted') // the transcript makes room above the note
  scrollEnd()
  clearTimeout(noteTimer)
  noteTimer = setTimeout(() => { R.note.hidden = true; R.el.classList.remove('noted'); scrollEnd() }, ms)
  if (!S.shown) O.toast?.(msg)
}

function sendInput() {
  clearTimeout(S.dictated); S.dictating = false
  const t = R.input.value.trim()
  if (!t) return
  R.input.blur()
  submit(t)
}

/* ---------- the transcript ---------- */

function addItem(el) {
  el.classList.add('as-item')
  R.log.insertBefore(el, R.pending)
  T.items.push(el)
  // A capped transcript: the oldest rows go as new ones come.
  while (T.items.length > MAX_ITEMS) {
    const old = T.items.shift()
    if (old === T.acts?.el) T.acts = null
    if (old === T.bro?.el) T.bro = null
    old.remove()
    if (F.zone === 'log') F.i = Math.max(0, F.i - 1)
  }
  if (R.empty.hidden === false || !R.chips.hidden) syncEmpty()
  scrollEnd()
  return el
}

function clearLog() {
  for (const el of T.items) el.remove()
  T.items = []
  T.cur = T.acts = T.bro = null
  hidePending()
  if (F.zone === 'log') setFocus('bar', 'input')
  syncEmpty()
}

// Follows the end while the user isn't reading back through the messages.
function scrollEnd(force) {
  if (!force && F.zone === 'log') return
  R.log.scrollTop = R.log.scrollHeight
}

function showPending() { R.pending.hidden = false; scrollEnd() }
function hidePending() { R.pending.hidden = true }

function addUser(text, atts) {
  T.acts = null
  const el = document.createElement('div')
  el.className = 'as-msg as-user'
  el.innerHTML = `<div class="as-bub"></div>`
  el.firstChild.textContent = text
  const files = (atts || []).map(f => (typeof f === 'string' ? f : f?.name)).filter(Boolean)
  if (files.length) el.insertAdjacentHTML('beforeend', `<div class="as-files">${esc(files.length === 1 ? `Attached ${files[0]}` : `${files.length} files attached`)}</div>`)
  return addItem(el)
}

// An answer: finished blocks are rendered once, the paragraph still being written is one text node that grows.
function addAssistant(text, final) {
  T.acts = null
  const el = document.createElement('div')
  el.className = 'as-msg as-bot'
  el.innerHTML = '<div class="as-bub as-md"><p class="as-tail"></p></div>'
  const md = el.firstChild
  const c = { el, md, tail: md.firstChild, text: document.createTextNode(''), raw: '', done: 0, final: false }
  c.tail.append(c.text)
  c.tail.hidden = true
  addItem(el)
  if (final) setText(c, text)
  else if (text) feed(c, text)
  return c
}

function feed(c, chunk) {
  c.raw += chunk
  hidePending()
  if (!T.dirty) { T.dirty = true; T.raf = requestAnimationFrame(flush) }
}

// At most once a frame: move whole blocks out of the tail, grow the tail, keep the end in view.
function flush() {
  T.dirty = false
  const c = T.cur
  if (c && !c.final) {
    const cut = c.raw.lastIndexOf('\n\n')
    if (cut > c.done && (c.raw.slice(0, cut).match(/```/g) || []).length % 2 === 0) {
      c.tail.insertAdjacentHTML('beforebegin', md(c.raw.slice(c.done, cut)))
      c.done = cut + 2
    }
    const tail = c.raw.slice(c.done).replace(/^\s*[-*+]\s+/gm, '• ').replace(/\*\*|__|`/g, '').replace(/^#+\s+/gm, '')
    if (c.text.data !== tail) { c.text.data = tail; c.tail.hidden = !tail }
  }
  scrollEnd()
  if (F.zone === 'log') paintFocus()
}

function setText(c, full) {
  c.raw = full
  c.final = true
  c.md.innerHTML = md(full) || '<p></p>'
  scrollEnd()
}

function finishCur() {
  const c = T.cur
  if (!c) return
  if (!c.final) setText(c, c.raw)
  T.cur = null
}

// The turn's steps, in one compact block: the newest few lines, and how many came before.
function addTool(t) {
  const name = String(t.name || '')
  if (name.startsWith(BROWSER)) {
    if (!T.bro) T.bro = addBrowser({}, true)
    T.bro.step = String(t.label || '').trim()
    setBrowser(T.bro, {})
    return
  }
  if (name === 'mcp__hub__show_site') return // its site card says it
  return // the agent's steps aren't shown on the TV: the dots say it's working, the answer says what it did
  if (!T.acts) {
    const el = document.createElement('div')
    el.className = 'as-acts'
    el.innerHTML = '<div class="as-more" hidden></div>'
    T.acts = { el, more: el.firstChild, hidden: 0, lines: new Map() }
    addItem(el)
  }
  const a = T.acts
  const line = document.createElement('div')
  line.className = 'as-act'
  line.innerHTML = '<i></i><span></span>'
  line.lastChild.textContent = tvLabel(t)
  a.el.append(line)
  a.lines.set(String(t.id || Math.random()), line)
  const shown = a.el.querySelectorAll('.as-act')
  if (shown.length > MAX_ACT_LINES) {
    shown[0].remove()
    a.hidden++
    a.more.hidden = false
    a.more.textContent = `${a.hidden} earlier step${a.hidden === 1 ? '' : 's'}`
  }
  if (t.ok != null || t.result != null) setToolResult(t.id, t.ok !== false)
  scrollEnd()
}

function setToolResult(id, ok) {
  const line = T.acts?.lines.get(String(id))
  if (line) line.classList.add(ok ? 'ok' : 'bad')
}

// What the agent did, said for a TV: "Opened Netflix on the TV", "Searched the web".
function tvLabel(t) {
  const n = String(t.name || ''), label = String(t.label || n)
  if (n === 'mcp__hub__tv_control') {
    const d = json(t.detail)
    return ({
      open_app: `Opened ${d.app || 'an app'} on the TV`, switch_input: `Switched the TV to ${d.name || 'another input'}`, home: 'Went to the TV’s home screen',
      screensaver: 'Started the screensaver', say: 'Spoke on the TV', show: 'Showed it on the TV',
    })[d.action] || 'Used the TV'
  }
  if (n === 'mcp__hub__hub_read') return 'Checked the hub'
  if (n === 'Bash') return /^Checked \/api\//.test(label) ? 'Checked the hub' : 'Ran a command on the computer'
  if (n === 'mcp__hub__settings_update') return 'Changed the hub’s settings'
  if (n === 'mcp__hub__system_info') return 'Checked the computer'
  if (n === 'Read' || n === 'Glob' || n === 'Grep') return label.replace(/^Listed /, 'Looked for ')
  return label
}

// A site the agent opened (show_site) or the hub browser at work: on the laptop, with its icon, title and host, and
// the last step's screenshot when there is one.
// An app the TV opened for you ("open Netflix"): its tile, and OK opens it again.
function addAppCard(app) {
  T.acts = null
  const el = document.createElement('div')
  el.className = 'as-card as-appcard'
  el.__app = app.id
  el.innerHTML = `<span class="as-tile"><span class="app">${O.appArt?.(app.id) || ''}</span></span><div class="as-ctx"><b></b><small>Opened on the TV · OK opens it again</small></div>`
  el.querySelector('b').textContent = app.name
  return addItem(el)
}

function addSite(s) {
  T.acts = null
  const c = addBrowser({ url: s.url, title: s.name, icon: s.icon }, false)
  c.site = true
  c.el.__site = { url: s.url, name: s.name } // OK opens it in the TV's browser
  setBrowser(c, {})
  return c
}

function addBrowser(b, live) {
  T.acts = null
  const el = document.createElement('div')
  el.className = 'as-card'
  el.__browser = true // OK on it opens the browser live, with the remote's cursor (agentview.js)
  el.innerHTML = '<div class="as-shot" hidden></div><span class="as-fav"></span><div class="as-ctx"><b></b><small></small></div>'
  const c = { el, b: {}, icon: null, step: '', live, site: false }
  addItem(el)
  setBrowser(c, b)
  return c
}

function setBrowser(c, b) {
  for (const k of ['shot', 'url', 'title', 'handoff', 'icon']) if (b[k] != null) c.b[k] = b[k]
  const d = c.b, el = c.el
  const host = hostOf(d.url)
  el.querySelector('b').textContent = d.title || host || 'The hub browser'
  const where = c.site ? 'OK opens it on the TV' : d.handoff ? `Your turn · OK to use it here: ${trim(d.handoff, 70)}` : c.step ? `${c.step} · OK to watch it live` : 'The hub browser · OK to use it here'
  el.querySelector('small').textContent = d.title && host ? `${where} · ${host}` : where
  const icon = typeof d.icon === 'string' && d.icon.startsWith('/api/hub/') ? d.icon : d.url ? `/api/hub/site-icon?url=${encodeURIComponent(d.url)}` : ''
  if (icon !== c.icon) {
    c.icon = icon
    const f = el.querySelector('.as-fav')
    if (icon) {
      const img = new Image()
      img.alt = ''
      img.decoding = 'async'
      img.referrerPolicy = 'no-referrer'
      img.onerror = () => { f.innerHTML = IC.globe }
      img.src = icon
      f.replaceChildren(img)
    } else f.innerHTML = IC.globe
  }
  if (typeof d.shot === 'string' && d.shot.startsWith('/api/browser/shots/')) {
    const box = el.querySelector('.as-shot')
    let img = box.firstChild
    if (!img) {
      img = new Image()
      img.alt = ''
      img.decoding = 'async'
      img.width = 320
      img.height = 200
      img.onload = () => { box.hidden = false }
      img.onerror = () => { box.hidden = true } // gone from the hub: the card goes on without it
      box.append(img)
    }
    if (img.getAttribute('src') !== d.shot) img.src = d.shot
  }
}

function endBrowser() { T.bro = null }

function addError(msg) {
  T.acts = null
  const el = document.createElement('div')
  el.className = 'as-err'
  el.textContent = msg
  return addItem(el)
}

function addAttachment(f) {
  const el = addNote(`Attached ${f?.name || 'a file'}, on the laptop`)
  el.firstChild.classList.add('ok')
  return el
}

function addNote(text) {
  const el = document.createElement('div')
  el.className = 'as-acts'
  el.innerHTML = '<div class="as-act"><i></i><span></span></div>'
  el.querySelector('span').textContent = text
  T.acts = null
  return addItem(el)
}

function addConnect(c) {
  return addNote(`Connect ${c?.name || 'an account'} from LocalHub on the laptop`)
}

// A step the agent can't take without a yes: Allow or Don't allow, right here.
function addConfirm(c, answered) {
  T.acts = null
  const el = document.createElement('div')
  el.className = 'as-confirm'
  el.innerHTML = '<b></b><p></p><div class="as-confirm-row"><button type="button" class="as-btn" data-allow="1">Allow</button><button type="button" class="as-btn" data-allow="0">Don’t allow</button></div>'
  el.querySelector('b').textContent = c.what || 'Allow this?'
  el.querySelector('p').textContent = trim(c.label || c.url || '', 280)
  el.__confirm = c
  if (answered) settleEl(el, 'Answered')
  return addItem(el)
}

function settleEl(el, msg) {
  const row = el.querySelector('.as-confirm-row')
  if (!row) return
  const d = document.createElement('div')
  d.className = 'as-confirm-on'
  d.textContent = msg
  row.replaceWith(d)
  el.__confirm = null
  if (F.zone === 'log' && T.items[F.i] === el) { F.sub = 0; paintFocus() }
}

function settleConfirm(id, msg) {
  for (const el of T.items) if (el.__confirm && el.__confirm.id === id) settleEl(el, msg)
}

async function answerConfirm(c, allow) {
  const id = c.id
  let out = {}
  try {
    const r = await post(`/api/${['agent', 'connections'].includes(c.via) ? c.via : 'browser'}/confirm/${encodeURIComponent(id)}`, { allow })
    if (!r.ok) return settleConfirm(id, 'This ask has run out. Ask again if you still want it.')
    out = await r.json().catch(() => ({}))
  } catch { return settleConfirm(id, 'Couldn’t reach the hub, so nothing happened. Ask again.') }
  setFocus('bar', 'input')
  if (!allow) { settleConfirm(id, 'Not allowed'); return submit('Not allowed. Don’t do that.') }
  settleConfirm(id, out.message || 'Allowed')
  submit(out.ok === false ? `Allowed, but it didn’t work: ${out.message}` : out.message ? `Allowed. ${out.message}` : 'Allowed. Go ahead.')
}

/* ---------- markdown, kept small: paragraphs, lists, headings, code, bold ---------- */

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<b>${a || b}</b>`)
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
}

export function md(text) {
  const out = []
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  let para = []
  let list = null
  const endP = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = [] }
  const endL = () => { if (list) out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null }
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]
    let m
    if (/^\s*```/.test(line)) {
      endP(); endL()
      const code = []
      for (k++; k < lines.length && !/^\s*```/.test(lines[k]); k++) code.push(lines[k])
      out.push(`<pre>${esc(code.join('\n'))}</pre>`)
      continue
    }
    if (!line.trim() || /^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { endP(); endL(); continue }
    if ((m = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line))) { endP(); endL(); out.push(`<h4>${inline(m[1])}</h4>`); continue }
    if ((m = /^\s*[-*+•]\s+(.*)$/.exec(line))) { endP(); if (list?.tag !== 'ul') { endL(); list = { tag: 'ul', items: [] } } list.items.push(m[1]); continue }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { endP(); if (list?.tag !== 'ol') { endL(); list = { tag: 'ol', items: [] } } list.items.push(m[1]); continue }
    if (/^\s*\|/.test(line)) {
      // A table, said as rows: "a · b · c". The |---| line goes.
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) continue
      endP(); endL()
      out.push(`<p class="as-row-t">${inline(line.replace(/^\s*\||\|\s*$/g, '').split('|').map(x => x.trim()).filter(Boolean).join(' · '))}</p>`)
      continue
    }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue }
    endL()
    para.push(line.replace(/^\s*>\s?/, '').trim())
  }
  endP(); endL()
  return out.join('')
}

/* ---------- sending ---------- */

function submit(text, { voice = false } = {}) {
  text = String(text || '').trim()
  if (!text) return false
  // TV commands ("open Netflix") happen in the shell, at once, without the agent.
  try {
    const done = O.intercept?.(text)
    if (done) {
      R.input.value = ''; V.speak = false
      // The request stays in the chat, and an app it opened is a card there.
      addUser(text)
      if (done.app) addAppCard(done.app)
      scrollEnd(true)
      return true
    }
  } catch (e) { console.error(e) }
  R.input.value = ''
  if (S.busy) {
    S.queue.push({ text, voice })
    note(S.queue.length === 1 ? 'That goes as soon as this answer ends.' : `${S.queue.length} messages wait for this answer.`)
    return true
  }
  if (voice) { V.speak = true; V.said = 0; V.text = '' } else if (!V.speak) hush()
  send(text)
  return true
}

async function send(text) {
  // "Read answers aloud": Off never speaks, Always speaks typed questions' answers too, After voice only spoken ones.
  const m = mode()
  if (m === 'Off') V.speak = false
  else if (m === 'Always' && !V.speak) { V.speak = true; V.said = 0; V.text = '' }
  S.busy = true
  S.remote = false
  S.stopped = false
  const gen = ++S.gen
  if (F.zone === 'log' || F.zone === 'chips') setFocus('bar', 'input')
  addUser(text)
  showPending()
  syncBar()
  syncEmpty()
  scrollEnd(true)
  const ctrl = (S.ctrl = new AbortController())
  let finished = false
  let accepted = false
  try {
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub': '1' },
      body: JSON.stringify({ text, client: S.client, sessionId: S.conv || undefined, tab: 'tv', tabTitle: 'TV', model: O.model?.() || undefined }),
      signal: ctrl.signal,
    })
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error || `The hub answered ${res.status}`)
    }
    accepted = true
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let ev
        try { ev = JSON.parse(line) } catch { continue }
        if (gen === S.gen && handle(ev)) finished = true
      }
    }
    if (!finished && gen === S.gen) addError('The connection closed before the reply finished.')
  } catch (e) {
    if (e && e.name !== 'AbortError' && gen === S.gen) {
      if (!accepted && !R.input.value) R.input.value = text // not sent: the words come back to the field
      addError(accepted ? 'The connection closed before the reply finished.' : e instanceof TypeError ? 'The hub didn’t answer, so that wasn’t sent.' : e.message || 'Could not reach the hub.')
    }
  } finally {
    if (gen === S.gen) {
      hidePending()
      finishCur()
      endBrowser()
      if (S.stopped) addNote('Stopped')
      if (V.speak) { voiceFeed('', true); V.speak = false }
      S.busy = false
      S.ctrl = null
      syncBar()
      syncEmpty()
      next()
      // Another device made a different chat current while this reply ran: follow it now.
      if (!S.queue.length && L.current !== S.conv && L.ready) followCurrent(L.current)
    }
  }
}

function next() {
  if (S.busy || !S.queue.length) return
  if (S.stopped) { S.queue = []; note('Stopped. The waiting messages weren’t sent.'); return }
  const n = S.queue.shift()
  setTimeout(() => submit(n.text, { voice: n.voice }), 60)
}

// One event of a reply, this page's own (from its stream) or another device's (remote, over the live channel).
// True on "done".
function handle(ev, remote = false) {
  switch (ev.type) {
    case 'session':
      if (remote) break
      S.conv = ev.sessionId || S.conv
      if (ev.title && !S.title) { S.title = ev.title; syncEmpty() }
      break
    case 'attachment':
      hidePending(); finishCur(); addAttachment(ev.file); showPending()
      break
    case 'text_start':
      finishCur()
      T.cur = addAssistant('', false)
      break
    case 'delta':
      if (!T.cur) T.cur = addAssistant('', false)
      feed(T.cur, String(ev.text || ''))
      if (V.speak && !remote) voiceFeed(String(ev.text || ''), false)
      break
    case 'text_end':
      if (!T.cur) { hidePending(); T.cur = addAssistant('', false) }
      if (typeof ev.text === 'string') setText(T.cur, ev.text)
      finishCur()
      break
    case 'tool':
      hidePending(); finishCur(); addTool(ev); showPending()
      break
    case 'tool_result':
      setToolResult(ev.id || '', !!ev.ok)
      break
    case 'error':
      hidePending(); finishCur(); addError(ev.message || 'Something went wrong.')
      break
    case 'site':
      if (ev.url) { hidePending(); finishCur(); addSite(ev); showPending() }
      break
    case 'browser':
      hidePending(); finishCur()
      if (T.bro) setBrowser(T.bro, ev)
      else T.bro = addBrowser(ev, true)
      showPending()
      break
    case 'confirm':
      hidePending(); finishCur(); addConfirm(ev); showPending()
      break
    case 'connect':
      hidePending(); finishCur(); addConnect(ev); showPending()
      break
    case 'done':
      hidePending(); finishCur(); endBrowser()
      if (V.speak && !remote) { voiceFeed('', true); V.speak = false }
      if (!remote && voiceMode()) yourTurn()
      return true
  }
  return false
}

async function stop() {
  if (!S.busy) return
  hush()
  S.stopped = true
  try { await post('/api/chat/stop', { sessionId: S.conv || undefined }) } catch {}
  const c = S.ctrl
  setTimeout(() => { if (c && S.ctrl === c) c.abort() }, 1500)
}

/* ---------- conversations: new, open, recent ---------- */

// announce: tell the hub, so every other open chat starts a new one too. A new chat from another device doesn't.
function newChat(announce = true) {
  if (S.busy) {
    S.gen++
    S.ctrl?.abort()
    if (announce) post('/api/chat/stop', { sessionId: S.conv || undefined }).catch(() => {})
    S.busy = false; S.remote = false; S.ctrl = null
  }
  hush()
  if (announce && S.conv) setCurrent('')
  L.current = ''
  S.conv = ''
  S.title = ''
  S.queue = []
  clearLog()
  syncBar()
  syncEmpty()
  if (S.shown && announce) setFocus('bar', 'input')
}

// A saved chat, its last rows. running: its reply is still coming, so the text so far (partial) becomes the answer
// that the next deltas continue.
function renderItems(items, running, partial) {
  clearLog()
  const list = items.slice(-MAX_ITEMS * 2)
  let card = null
  list.forEach((it, n) => {
    if (it.kind === 'user') { addUser(it.text || '', it.atts || it.files); card = null }
    else if (it.kind === 'assistant') { T.cur = null; addAssistant(it.text || '', true) }
    else if (it.kind === 'tool') { if (!String(it.name || '').startsWith(BROWSER)) addTool(it) }
    else if (it.kind === 'site') card = addSite(it)
    else if (it.kind === 'browser') { card = addBrowser(it, false) }
    else if (it.kind === 'attachment') addAttachment(it)
    else if (it.kind === 'confirm') addConfirm(it, list.slice(n + 1).some(x => x.kind === 'user'))
    else if (it.kind === 'connect') addConnect(it)
    else if (it.kind === 'error') addError(it.text || '')
  })
  if (running && card && !card.site) T.bro = card
  if (running && typeof partial === 'string') {
    const c = T.cur = addAssistant('', false)
    c.raw = partial
    flush()
  } else if (running) showPending()
  syncEmpty()
}

// Opens a chat here. announce: make it current on every device (picked from Recent chats). Without it, this page is
// following the hub's current chat. Live lines that arrive while it loads wait, then the ones newer than the chat's
// seq are played on top, so nothing shows twice or goes missing.
async function openConv(id, { announce = true } = {}) {
  if (S.busy && !S.remote) { if (announce) note('Stop this answer first.'); return }
  const turn = ++L.turn
  L.loading = true
  try {
    const r = await fetch(`/api/chat/sessions/${encodeURIComponent(id)}`)
    if (!r.ok) throw Object.assign(new Error('gone'), { gone: r.status === 404 })
    const c = await r.json()
    if (turn !== L.turn) return
    if (S.busy && !S.remote) return // this page sent something while it loaded; that goes on
    if (typeof c.seq === 'number') L.seq = c.seq
    if (S.conv !== c.id) S.queue = []
    S.conv = c.id
    S.title = c.title || ''
    L.current = announce ? c.id : L.current
    S.busy = S.remote = !!c.running
    renderItems(c.items || [], c.running, c.partial)
    syncBar()
    syncEmpty()
    scrollEnd(true)
    if (announce) { setCurrent(c.id); if (S.shown) setFocus('bar', 'input') }
  } catch (e) {
    if (turn !== L.turn) return
    if (e.gone && !announce) { if (S.conv) newChat(false); return }
    console.warn('openConv', e)
    if (announce) note('That chat could not be opened.')
  } finally {
    if (turn === L.turn) {
      L.loading = false
      const held = L.held
      L.held = []
      for (const m of held) onLive(m)
    }
  }
}

async function openList() {
  R.panel.hidden = false
  R.rows.innerHTML = '<div class="as-none">Loading…</div>'
  F.zone = 'list'
  F.i = 0
  paintFocus()
  let list = []
  try { list = (await (await fetch('/api/chat/sessions')).json()).sessions || [] } catch { R.rows.innerHTML = '<div class="as-none">Couldn’t load your chats.</div>'; return }
  if (F.zone !== 'list') return
  list.sort((a, b) => (b.updated || 0) - (a.updated || 0))
  list = list.slice(0, 40)
  if (!list.length) { R.rows.innerHTML = '<div class="as-none">No chats yet. Ask something and it shows up here.</div>'; return }
  R.rows.innerHTML = list.map(s => `<button type="button" class="as-row${s.id === S.conv ? ' cur' : ''}" data-id="${esc(s.id)}"><b>${esc(s.title || 'New chat')}</b><small>${esc([s.running ? 'Answering now' : ago(s.updated || 0), s.count ? `${s.count} message${s.count === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '))}${s.running ? '<i class="as-live"></i>' : ''}</small></button>`).join('')
  const at = list.findIndex(s => s.id === S.conv)
  F.i = at > 0 ? at : 0
  paintFocus()
}

function closeList() {
  if (R.panel.hidden) return
  R.panel.hidden = true
  R.rows.innerHTML = ''
  if (F.zone === 'list') setFocus('bar', 'chats')
}

/* ---------- live: every open chat follows the one current conversation ---------- */

function setCurrent(id) {
  L.current = id
  post('/api/chat/current', { sessionId: id || undefined, client: S.client }).catch(() => {})
}

function connectLive() {
  if (L.es || !window.EventSource) return
  const es = (L.es = new EventSource('/api/chat/live'))
  es.onmessage = e => { let m = null; try { m = JSON.parse(e.data) } catch {} if (m && m.ev) onLive(m) }
  es.onerror = () => {
    // EventSource comes back by itself after a hub restart, and its hello brings this page up to date.
    if (es.readyState !== EventSource.CLOSED) return
    L.es = null
    clearTimeout(L.retry)
    L.retry = setTimeout(connectLive, 3000)
  }
}

function followCurrent(id) {
  L.current = id || ''
  if (S.busy && !S.remote) return // this page's own reply is streaming; it follows when that ends
  if (!id) { if (S.conv || S.remote) newChat(false); return }
  return openConv(id, { announce: false })
}

function onLive(m) {
  const ev = m.ev
  if (ev.type === 'hello') { L.ready = true; L.seq = m.seq; return followCurrent(m.conv) }
  if (L.loading) { L.held.push(m); return }
  if (m.seq <= L.seq) return
  L.seq = m.seq
  if (ev.type === 'current') {
    if (m.from === S.client) { L.current = m.conv; return }
    if (m.conv !== S.conv) followCurrent(m.conv)
    else L.current = m.conv
    return
  }
  if (m.from === S.client) return
  if (m.conv !== S.conv) {
    // A chat this page isn't showing: it follows the current one, and only when its own reply isn't running.
    if (m.conv === L.current && (!S.busy || S.remote)) followCurrent(m.conv)
    return
  }
  if (S.busy && !S.remote) return
  remoteEvent(ev)
}

// Another device's message or reply, in this page's chat.
function remoteEvent(ev) {
  if (ev.type === 'user') {
    for (const el of T.items) if (el.__confirm) settleEl(el, 'Answered')
    S.busy = S.remote = true
    S.askedOn = ev.tab || ''
    S.stopped = false
    addUser(ev.text || '', ev.atts)
    showPending()
    syncBar()
    syncEmpty()
    return
  }
  if (ev.type === 'session' || ev.type === 'ping') return
  if (!S.remote) { S.busy = S.remote = true; syncBar() }
  if (handle(ev, true)) {
    hidePending(); finishCur(); endBrowser()
    S.busy = S.remote = false
    syncBar()
    syncEmpty()
    next()
  }
}

/* ---------- voice ---------- */

// Talk, or stop talking (it sends). On a TV with LocalHub's app, window.HubVoice lends the TV's mic and voice;
// elsewhere the browser's mic records WAV for Whisper on the hub (/api/voice/transcribe).
export async function voice() {
  if (!mounted) return
  if (V.remote) return // the laptop is listening; it ends when they stop talking
  if (V.state === 'rec') { if (HV()) HV().stop?.(); else V.rec?.stop(); return }
  if (V.state === 'wait') return
  hush()
  V.cancelled = false
  fetch('/api/voice/warm', { method: 'POST', headers: { 'x-hub': '1' } }).catch(() => {}) // wake Whisper while they talk
  V.state = 'rec'
  V.since = Date.now()
  syncVoice()
  let text = ''
  try {
    if (HV()) {
      text = await HV().listen({ onLevel: level, onWorking: () => { V.state = 'wait'; syncVoice() } })
    } else {
      const wav = await recordWav()
      if (!wav) { V.state = 'idle'; syncVoice(); if (!V.cancelled) note('Didn’t catch that. Press ⏯ and talk.'); return }
      V.state = 'wait'
      syncVoice()
      text = await transcribe(wav)
    }
  } catch (e) {
    V.state = 'idle'
    syncVoice()
    if (e?.dictate) return dictate()
    note(e?.message || 'Couldn’t hear that.', 9000)
    return
  }
  V.state = 'idle'
  syncVoice()
  text = String(text || '').trim()
  if (V.cancelled) return
  if (!text) { note('Didn’t catch that. Press ⏯ and talk.'); return }
  submit(text, { voice: true })
}

// No mic LocalHub can record from (a Fire TV Stick's belongs to Alexa): the remote's own dictation. The box takes the
// focus; OK opens the TV's keyboard, and holding the remote's mic button there types what's said.
function dictate() {
  S.away = false
  setFocus('bar', 'input')
  note('Press OK, then hold the remote’s mic button and speak. It sends when you stop.', 10000)
}

function cancelVoice() {
  if (V.state !== 'rec') return
  V.cancelled = true
  if (HV()) HV().cancel?.()
  else V.rec?.cancel()
}

// The bar's voice face: a level wave and a clock while listening, words while it's written down.
const W = { cv: null, ctx: null, raf: 0, on: false, bars: [], level: 0, w: 0, h: 0, ratio: 1, last: 0 }
function level(v) { W.level = Math.max(W.level, Math.min(1, Math.sqrt(Math.max(0, Number(v) || 0)))) }

function syncVoice() {
  const on = V.state !== 'idle'
  R.field.classList.toggle('voicing', on)
  R.voice.hidden = !on
  R.input.style.visibility = on ? 'hidden' : ''
  R.talk.classList.toggle('rec', V.state === 'rec')
  R.talk.querySelector('span').textContent = V.state === 'rec' ? 'Done' : 'Talk'
  R.vword.textContent = V.state === 'rec' ? 'Listening…' : V.state === 'wait' ? 'Turning it into words…' : ''
  R.wave.hidden = V.state !== 'rec' || V.remote // the laptop's mic sends no levels
  R.vclock.hidden = V.state !== 'rec'
  clearInterval(V.clock)
  if (V.state === 'rec') {
    const tick = () => { const s = Math.floor((Date.now() - V.since) / 1000); const t = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; if (R.vclock.textContent !== t) R.vclock.textContent = t }
    tick()
    V.clock = setInterval(tick, 500)
    waveStart()
  } else waveStop()
  // While listening, OK on Talk (now Done) sends what was said.
  if (on && !(F.zone === 'bar' && F.bar === 'talk')) setFocus('bar', 'talk')
}

function waveStart() {
  if (W.on) return
  W.on = true
  W.cv = R.wave
  W.ctx = W.cv.getContext('2d')
  const r = W.cv.getBoundingClientRect()
  W.ratio = window.devicePixelRatio || 1
  W.w = Math.max(1, Math.round(r.width * W.ratio))
  W.h = Math.max(1, Math.round(r.height * W.ratio))
  W.cv.width = W.w
  W.cv.height = W.h
  W.bars = new Array(32).fill(0)
  W.level = 0
  W.last = 0
  W.raf = requestAnimationFrame(waveFrame)
}

function waveStop() {
  W.on = false
  cancelAnimationFrame(W.raf)
  if (W.ctx) W.ctx.clearRect(0, 0, W.w, W.h)
}

// 32 bars, one new every 80 ms from the loudest level heard in that slice.
function waveFrame(t) {
  if (!W.on) return
  if (t - W.last >= 80) {
    W.last = t
    W.bars.push(W.level)
    W.bars.shift()
    W.level *= 0.35
    const { ctx, w, h } = W
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#fff' // the voicing field is always dark
    const n = W.bars.length, pitch = w / n, bw = Math.max(2, pitch * 0.5)
    for (let i = 0; i < n; i++) {
      const tall = Math.max(bw, W.bars[i] * h * 0.9)
      ctx.globalAlpha = 0.35 + 0.65 * (i / n)
      ctx.fillRect(i * pitch, (h - tall) / 2, bw, tall)
    }
    ctx.globalAlpha = 1
  }
  W.raf = requestAnimationFrame(waveFrame)
}

// Records until you stop talking (0.7 s of quiet), straight to 16 kHz WAV (as tabs/chat.js does).
function recordWav() {
  return new Promise(async (resolve, reject) => {
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
    } catch {
      return reject(new Error(window.isSecureContext ? 'The microphone is blocked for this page. Allow it in the browser’s site settings.' : 'The browser only allows the microphone on https or on the computer running LocalHub.'))
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const src = ctx.createMediaStreamSource(stream)
    const node = ctx.createScriptProcessor(2048, 1, 1)
    const rate = ctx.sampleRate
    const chunks = []
    let heard = false, quiet = 0, total = 0, done = false, floor = 0.006
    const finish = keep => {
      if (done) return
      done = true
      try { node.disconnect(); src.disconnect() } catch {}
      stream.getTracks().forEach(tr => tr.stop())
      ctx.close().catch(() => {})
      V.rec = null
      resolve(keep && heard ? wav16k(chunks, rate) : null)
    }
    node.onaudioprocess = e => {
      if (done) return
      const d = e.inputBuffer.getChannelData(0)
      chunks.push(new Float32Array(d))
      let sum = 0
      for (let i = 0; i < d.length; i++) sum += d[i] * d[i]
      const rms = Math.sqrt(sum / d.length)
      const sec = d.length / rate
      total += sec
      if (total < 0.25) floor = Math.max(floor, rms * 1.8)
      level(rms * 9)
      if (rms > Math.max(0.018, floor)) { heard = true; quiet = 0 } else if (heard) quiet += sec
      if ((heard && quiet > 0.7) || total > 30 || (!heard && total > 7)) finish(true)
    }
    src.connect(node)
    node.connect(ctx.destination)
    V.rec = { stop: () => finish(true), cancel: () => finish(false) }
    if (V.cancelled) finish(false)
  })
}

function wav16k(chunks, rate) {
  const n = chunks.reduce((a, c) => a + c.length, 0)
  const all = new Float32Array(n)
  let o = 0
  for (const c of chunks) { all.set(c, o); o += c.length }
  const ratio = rate / 16000
  const len = Math.floor(n / ratio)
  const pcm = new Int16Array(len)
  for (let i = 0; i < len; i++) {
    const a = Math.floor(i * ratio), b = Math.min(n, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = a; j < b; j++) sum += all[j]
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, b - a)))
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const dv = new DataView(buf)
  const str = (at, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(at + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true)
  dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, pcm.length * 2, true)
  new Int16Array(buf, 44).set(pcm)
  return new Blob([buf], { type: 'audio/wav' })
}

async function transcribe(wav) {
  let r
  try {
    r = await fetch('/api/voice/transcribe', { method: 'POST', headers: { 'x-hub': '1', 'content-type': 'audio/wav' }, body: wav })
  } catch { throw new Error('The hub didn’t answer, so that wasn’t written down.') }
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.ok) throw new Error(j.error || `Couldn’t write that down (${r.status}).`)
  return j.text || ''
}

// Reading the answer aloud: the first phrase goes as soon as it's there, then whole sentences.
const plainSpeech = t => String(t).replace(/```[\s\S]*?```/g, '').replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/[*_#>|]/g, '').replace(/\s+/g, ' ')
function voiceFeed(chunk, final) {
  V.text += chunk
  const text = plainSpeech(V.text)
  const rest = text.slice(V.said)
  let cut = -1
  const sentence = /[.!?](\s|$)/g
  let m
  while ((m = sentence.exec(rest))) cut = m.index + 1
  if (cut < 0 && V.said === 0) {
    const comma = rest.search(/[,;:—–](\s)/)
    if (comma > 0 && rest.slice(0, comma).trim().split(/\s+/).length >= 4) cut = comma + 1
  }
  if (final) cut = rest.length
  if (cut <= 0) return
  const piece = rest.slice(0, cut).trim()
  V.said += cut
  if (piece) say(piece)
}

function pickVoice() {
  if (V.voice !== undefined) return V.voice
  const all = window.speechSynthesis?.getVoices?.() || []
  const lang = (navigator.language || 'en-US').toLowerCase()
  const mine = all.filter(v => v.lang && v.lang.toLowerCase().startsWith(lang.slice(0, 2)))
  V.voice = mine.find(v => v.localService && v.lang.toLowerCase() === lang) || mine.find(v => v.localService) || mine[0] || null
  return V.voice
}

function say(text) {
  if (!text || mode() === 'Off') return
  if (window.HubVoice?.speak) return window.HubVoice.speak(text)
  if (!window.speechSynthesis) return
  const u = new SpeechSynthesisUtterance(text)
  const v = pickVoice()
  if (v) u.voice = v
  u.rate = 1.08
  speechSynthesis.speak(u)
}

function hush() {
  V.said = 0
  V.text = ''
  try { if (window.HubVoice?.hush) window.HubVoice.hush(); else window.speechSynthesis?.cancel() } catch {}
}

// For the harness and tests: what the screen holds, without reaching into its DOM.
export function state() {
  return { busy: S.busy, remote: S.remote, conv: S.conv, title: S.title, current: L.current, seq: L.seq, items: T.items.length, focus: F.zone === 'bar' ? `bar:${F.bar}` : `${F.zone}:${F.i}`, voice: V.state, client: S.client }
}
