// The agent's browser, live on the TV (browser.mjs's own Chrome on the laptop: the one the assistant works in).
// OK on a browser card in the assistant opens it full screen. The remote drives a cursor over it:
//   arrows    move the cursor (faster while held); at the top or bottom edge the page scrolls
//   OK        clicks where the cursor is
//   OK on a text box opens the keyboard to type into the page; OK on it sends the text and Enter
//   Back      closes it and gives the browser back to the agent
// Frames come over /api/browser/stream (SSE, JPEG) and clicks go to /api/browser/input, like the hub's browser pop-up.
// Clicking takes control from the agent (browser.mjs), so it never fights you while you're in there.

const STEP0 = 14, STEP_MAX = 64, EDGE = 26, SCROLL = 360
const V = { el: null, img: null, cur: null, es: null, profile: '', meta: null, x: 960, y: 540, step: STEP0, last: 0, typing: false, toast: null, onClose: null }

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify(body) })
  .then(async r => { if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error || `LocalHub answered ${r.status}`), { status: r.status }); return r.json() })

export const isOpen = () => !!V.el

export async function open({ host, toast, onClose } = {}) {
  if (V.el) return
  V.toast = toast || (() => {})
  V.onClose = onClose || null
  const st = await fetch('/api/browser/status', { cache: 'no-store' }).then(r => (r.ok ? r.json() : {})).catch(() => ({}))
  V.profile = st.current || ''
  const el = document.createElement('div')
  el.className = 'agv'
  el.innerHTML = '<img class="agv-frame" alt=""><div class="agv-cursor"></div><div class="agv-bar"><b>The assistant’s browser</b><span>Arrows move · OK clicks (on a text box, type) · Back gives it back</span></div><input class="agv-type" type="text" autocomplete="off" spellcheck="false" placeholder="Type, then OK to send">'
  ;(host || document.body).append(el)
  V.el = el
  V.img = el.querySelector('.agv-frame')
  V.cur = el.querySelector('.agv-cursor')
  V.field = el.querySelector('.agv-type')
  V.x = 960; V.y = 540
  paint()
  requestAnimationFrame(() => el.classList.add('on'))
  const q = V.profile ? `?profile=${encodeURIComponent(V.profile)}` : ''
  V.es = new EventSource(`/api/browser/stream${q}`)
  V.es.addEventListener('frame', e => {
    try {
      const f = JSON.parse(e.data)
      if (f.meta) V.meta = f.meta
      V.img.src = `data:image/jpeg;base64,${f.jpg}`
    } catch { /* a bad frame: the next one comes */ }
  })
  V.es.onerror = () => {} // EventSource reconnects by itself
}

export function close() {
  if (!V.el) return
  try { V.es?.close() } catch {}
  V.es = null
  post('/api/browser/act', { profile: V.profile, act: 'control', to: 'agent' }).catch(() => {})
  const el = V.el
  V.el = null
  el.classList.remove('on')
  setTimeout(() => el.remove(), 260)
  V.onClose?.()
}

// Where the cursor is on the page: the screen is 1920x1080, the page is the frame's own size.
function pagePoint() {
  const w = V.meta?.deviceWidth || 1280, h = V.meta?.deviceHeight || 720
  const r = V.img.getBoundingClientRect(), k = (V.el.getBoundingClientRect().width || 1920) / 1920
  const fx = (V.x * k - (r.left - V.el.getBoundingClientRect().left)) / (r.width || 1), fy = (V.y * k - (r.top - V.el.getBoundingClientRect().top)) / (r.height || 1)
  return { x: Math.round(Math.max(0, Math.min(1, fx)) * w), y: Math.round(Math.max(0, Math.min(1, fy)) * h) }
}

function paint() { V.cur.style.transform = `translate(${V.x}px, ${V.y}px)` }

function send(events) {
  return post('/api/browser/input', { profile: V.profile, events }).catch(e => V.toast(e.status === 409 ? 'The assistant is working in it. Try again in a moment' : e.message))
}

function move(dx, dy) {
  const now = performance.now()
  V.step = now - V.last < 160 ? Math.min(STEP_MAX, V.step * 1.22) : STEP0
  V.last = now
  const ny = V.y + dy * V.step
  // At the top or bottom edge, the page scrolls instead.
  if (dy && (ny < EDGE || ny > 1080 - EDGE)) {
    const p = pagePoint()
    send([{ t: 'wheel', x: p.x, y: p.y, dx: 0, dy: dy * SCROLL }])
  }
  V.x = Math.max(EDGE, Math.min(1920 - EDGE, V.x + dx * V.step))
  V.y = Math.max(EDGE, Math.min(1080 - EDGE, ny))
  paint()
  const p = pagePoint()
  send([{ t: 'mouse', type: 'mouseMoved', x: p.x, y: p.y }])
}

async function click(native) {
  const p = pagePoint()
  V.cur.classList.remove('press'); void V.cur.offsetWidth; V.cur.classList.add('press')
  const r = await send([
    { t: 'mouse', type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clicks: 1 },
    { t: 'mouse', type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clicks: 1 },
    { t: 'focus' },
  ])
  // OK on a text box opens the typing sheet (and the TV's keyboard) at once.
  if (r?.editable && V.el && !V.typing) startTyping(native)
}

function startTyping(native) {
  V.typing = true
  V.el.classList.add('typing')
  V.field.value = ''
  V.field.focus()
  native?.('setTyping', true)
}
function endTyping(native, sendIt) {
  const text = V.field.value
  V.typing = false
  V.el.classList.remove('typing')
  V.field.blur()
  native?.('setTyping', false)
  if (sendIt && text) send([{ t: 'text', text }, { t: 'key', type: 'keyDown', key: 'Enter', code: 'Enter', vk: 13, text: '\r' }, { t: 'key', type: 'keyUp', key: 'Enter', code: 'Enter', vk: 13 }])
}

// The remote's keys while it's open. True when used.
export function key(name, native) {
  if (!V.el) return false
  if (V.typing) {
    if (name === 'enter') endTyping(native, true)
    else if (name === 'back') endTyping(native, false)
    return true
  }
  if (name === 'left') move(-1, 0)
  else if (name === 'right') move(1, 0)
  else if (name === 'up') move(0, -1)
  else if (name === 'down') move(0, 1)
  else if (name === 'enter') click(native)
  else if (name === 'back' || name === 'home') close()
  return true
}
