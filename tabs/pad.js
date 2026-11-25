// A game controller on this computer: the stick or D-pad moves between things on the page, A opens, B goes back, X is the
// Sidebar, Y the assistant, Start the settings. With the TV open here it drives the TV instead. Bluetooth or USB, any pad the
// browser knows (navigator.getGamepads). Nothing runs until one is connected.
;(() => {
  let raf = 0, was = {}, repeat = {}, ring = null
  const on = () => document.documentElement.hasAttribute('data-tvlook') && !document.hidden && document.hasFocus()
  const tv = () => document.getElementById('tvmirror')?.classList.contains('on')
  const send = name => fetch('/api/tv/command', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ type: 'key', name }) }).catch(() => {})
  const SEL = 'button, a[href], input, select, [role="button"], [tabindex="0"]'
  // Only what is on top: a sheet or a panel keeps the focus inside it.
  function scope() {
    for (const q of ['#dkmenu.on', '#dkadd.on', '#tvpanel.on', '#tvset.on', '.hw-sheet']) { const n = document.querySelector(q); if (n) return [n] }
    return [document.getElementById('tvrail'), document.querySelector('.page')].filter(Boolean)
  }
  function things() {
    return scope().flatMap(n => [...n.querySelectorAll(SEL)]).filter(n => {
      if (n.disabled || n.closest('[hidden], [inert]')) return false
      const r = n.getBoundingClientRect()
      return r.width > 8 && r.height > 8 && r.right > 0 && r.left < innerWidth && getComputedStyle(n).visibility !== 'hidden'
    })
  }
  function move(dx, dy) {
    const all = things(), cur = document.activeElement
    if (!all.includes(cur)) { (all.find(n => n.closest('#dkfav, #dk')) || all[0])?.focus({ focusVisible: true }); return mark() }
    const a = cur.getBoundingClientRect()
    let best = null, score = Infinity
    for (const n of all) {
      if (n === cur) continue
      const b = n.getBoundingClientRect()
      const main = dx ? (dx > 0 ? b.left - a.right : a.left - b.right) : (dy > 0 ? b.top - a.bottom : a.top - b.bottom)
      if (main < -6) continue
      const off = dx ? Math.max(0, b.top - a.bottom, a.top - b.bottom) : Math.max(0, b.left - a.right, a.left - b.right)
      const mid = dx ? Math.abs(b.top + b.height / 2 - a.top - a.height / 2) : Math.abs(b.left + b.width / 2 - a.left - a.width / 2)
      const s = Math.max(0, main) + off * 4 + mid * .4
      if (s < score) { score = s; best = n }
    }
    if (best) { best.focus({ focusVisible: true }); best.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }
    mark()
  }
  // The white ring, so you can see where you are from the sofa.
  function mark() {
    ring ??= Object.assign(document.createElement('style'), { textContent: 'html[data-pad] :focus { outline: 3px solid #fff !important; outline-offset: 3px; }' })
    if (!ring.isConnected) document.head.append(ring)
    document.documentElement.setAttribute('data-pad', '')
  }
  addEventListener('pointermove', () => document.documentElement.removeAttribute('data-pad'), { passive: true })
  const esc = () => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  function back() {
    if (window.HubChat?.isOpen?.()) return window.HubChat.close()
    if (window.HubBrowser?.isOpen?.()) return window.HubBrowser.close()
    if (document.querySelector('#dkmenu.on, #dkadd.on, #tvpanel.on, #tvset.on, .hw-sheet')) return esc()
    document.querySelector('[data-rail="tab:home"]')?.click()
  }
  const DO = {
    0: () => { const n = document.activeElement; if (n && n !== document.body) n.click(); else move(0, 1) },
    1: back,
    2: () => document.querySelector('[data-rail="overlay"]')?.click(),
    3: () => (window.HubChat?.isOpen?.() ? window.HubChat.close() : window.HubChat?.open()),
    8: () => document.querySelector('[data-rail="tv"]')?.click(),
    9: () => document.querySelector('[data-rail="settings"]')?.click(),
    16: () => document.querySelector('[data-rail="tab:home"]')?.click(),
  }
  const TV = { 0: 'enter', 1: 'back', 2: 'menu', 3: 'ai', 4: 'rew', 5: 'ff', 9: 'menu', 16: 'home' }
  const DIR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
  function frame() {
    raf = requestAnimationFrame(frame)
    const p = [...(navigator.getGamepads?.() || [])].find(g => g && g.connected)
    if (!p || !on()) { was = {}; repeat = {}; return }
    const now = performance.now(), b = i => !!p.buttons[i]?.pressed, ax = i => p.axes[i] || 0
    const dirs = { up: b(12) || ax(1) < -.55, down: b(13) || ax(1) > .55, left: b(14) || ax(0) < -.55, right: b(15) || ax(0) > .55 }
    for (const d in dirs) {
      if (!dirs[d]) { repeat[d] = 0; continue }
      if (repeat[d] && now < repeat[d]) continue
      repeat[d] = now + (repeat[d] ? 120 : 380)
      if (tv()) send(d); else if (window.HubChat?.isOpen?.()) document.querySelector('#hub-chat')?.shadowRoot?.querySelector('.flog')?.scrollBy({ top: DIR[d][1] * 160, behavior: 'smooth' }); else move(...DIR[d])
    }
    for (let i = 0; i < p.buttons.length; i++) {
      const down = b(i)
      if (down && !was[i]) { if (tv() && i !== 8) { if (TV[i]) send(TV[i]) } else if (DO[i]) DO[i]() }
      was[i] = down
    }
  }
  const start = () => { if (!raf) raf = requestAnimationFrame(frame) }
  const stop = () => { if (![...(navigator.getGamepads?.() || [])].some(g => g?.connected)) { cancelAnimationFrame(raf); raf = 0 } }
  addEventListener('gamepadconnected', e => { start(); window.hud?.(`${e.gamepad.id.replace(/\s*\(.*$/, '').slice(0, 40) || 'Controller'} connected`) })
  addEventListener('gamepaddisconnected', stop)
  if ([...(navigator.getGamepads?.() || [])].some(g => g?.connected)) start()
})()
