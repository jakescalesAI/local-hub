// The agent's browser, live on the TV (browser.mjs's own Chrome on the laptop: the one the assistant works in).
// OK on a browser card in the assistant opens it full screen. Like the TV's own browser (stream.js):
//   arrows    jump to the nearest link, button or field that way (the hub finds it in the page: page-snap.mjs);
//             with nothing more that way, Up and Down scroll the page and carry on
//   Menu      swaps to a free cursor (arrows move it, faster while held; at the top or bottom edge the page scrolls)
//   OK        presses what's ringed (or clicks where the cursor is)
//   OK on a text box opens the keyboard to type into the page; OK on it sends the text and Enter
//   Back      closes it and gives the browser back to the agent
// Frames come over /api/browser/stream (SSE, JPEG) and clicks go to /api/browser/input, like the hub's browser pop-up.
// Clicking takes control from the agent (browser.mjs), so it never fights you while you're in there.

const STEP0 = 14, STEP_MAX = 64, EDGE = 26, SCROLL = 360
const V = { el: null, img: null, cur: null, es: null, profile: '', meta: null, x: 960, y: 540, step: STEP0, last: 0, typing: false, toast: null, onClose: null, mode: 'links', ring: null, busy: false }

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
  el.innerHTML = '<img class="agv-frame" alt=""><div class="agv-ring"></div><div class="agv-cursor"></div><div class="agv-bar"><b>The assistant’s browser</b><span>Arrows jump link to link · OK presses (on a text box, type) · Back gives it back</span></div><input class="agv-type" type="text" autocomplete="off" spellcheck="false" placeholder="Type, then OK to send">'
  ;(host || document.body).append(el)
  V.el = el
  V.img = el.querySelector('.agv-frame')
  V.cur = el.querySelector('.agv-cursor')
  V.ringEl = el.querySelector('.agv-ring')
  V.mode = 'links'; V.ring = null; V.busy = false
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

// And back: a page point (or length) on the screen's 1920x1080 grid, where the cursor and ring are drawn.
function screenPoint(px, py) {
  const w = V.meta?.deviceWidth || 1280, h = V.meta?.deviceHeight || 720
  const box = V.el.getBoundingClientRect(), r = V.img.getBoundingClientRect(), k = (box.width || 1920) / 1920
  return { x: ((r.left - box.left) + px / w * r.width) / k, y: ((r.top - box.top) + py / h * r.height) / k, sx: r.width / w / k, sy: r.height / h / k }
}

// The cursor and ring keep to the 1920x1080 grid and are drawn scaled to the view's own width (in its CSS pixels,
// which on the TV are zoomed), right over the point a click goes to.
function paint() {
  const k = (V.el.offsetWidth || 1920) / 1920
  V.cur.style.transform = `translate(${V.x * k}px, ${V.y * k}px)`
  const t = V.ring
  V.el.classList.toggle('ringed', !!t && V.mode === 'links')
  if (t) Object.assign(V.ringEl.style, { transform: `translate(${t.x * k - 6}px, ${t.y * k - 6}px)`, width: `${t.w * k + 12}px`, height: `${t.h * k + 12}px` })
}

// Links: the arrows go to the nearest thing you can press that way. With nothing left on screen, Up and Down scroll,
// then take the first thing that came into view.
async function snap(dir, again) {
  if (V.busy || !V.el) return
  V.busy = true
  const p = pagePoint()
  const r = await send([{ t: 'snap', x: p.x, y: p.y, dir }])
  V.busy = false
  if (!V.el || V.mode !== 'links') return
  const t = r?.target
  // The page can reach a little past the frame the TV shows: a thing whose middle is off screen counts as none.
  const c = t && screenPoint(t.cx, t.cy)
  if (t && c.y >= EDGE && c.y <= 1080 - EDGE) {
    const a = screenPoint(t.x, t.y)
    V.ring = { x: a.x, y: a.y, w: t.w * a.sx, h: t.h * a.sy }
    V.x = Math.max(EDGE, Math.min(1920 - EDGE, c.x)); V.y = Math.max(EDGE, Math.min(1080 - EDGE, c.y))
    return paint()
  }
  if (again || !r || dir === 'left' || dir === 'right') return
  const dy = dir === 'down' ? 1 : -1
  V.busy = true
  const w0 = await send([{ t: 'where' }])
  const s = await send([{ t: 'wheel', x: p.x, y: p.y, dx: 0, dy: dy * SCROLL * 1.6 }, { t: 'where' }])
  V.busy = false
  if (!V.el || !s?.scroll || !w0?.scroll || s.scroll.y === w0.scroll.y) return // the end of the page
  // Start from where the ringed thing is now that the page moved.
  const moved = (s.scroll.y - w0.scroll.y) * screenPoint(0, 0).sy
  V.y = Math.max(EDGE, Math.min(1080 - EDGE, V.y - moved))
  V.ring = null
  paint()
  snap(dir, true)
}

function setMode(mode) {
  V.mode = mode
  V.ring = null
  V.el.classList.toggle('mode-cursor', mode === 'cursor')
  paint()
  V.toast(mode === 'cursor' ? 'Free cursor: arrows move it · Menu for links' : 'Links: arrows jump between links · Menu for the cursor')
}

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
  // The page may change under it: the next arrow starts again from here.
  if (V.ring) { V.ring = null; paint() }
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
  if (V.mode === 'links' && ['left', 'right', 'up', 'down'].includes(name)) snap(name)
  else if (name === 'menu') setMode(V.mode === 'links' ? 'cursor' : 'links')
  else if (name === 'left') move(-1, 0)
  else if (name === 'right') move(1, 0)
  else if (name === 'up') move(0, -1)
  else if (name === 'down') move(0, 1)
  else if (name === 'enter') click(native)
  else if (name === 'back' || name === 'home') close()
  return true
}
