// Hub browser pop-up: the hub browser (browser.mjs) streamed live over whatever page you are on. The one
// place a website opens: a clicked site, a Home app, an agent's show_site or the agent opening a page.
// Frames arrive over /api/browser/stream (SSE, JPEG); your mouse, touch and keys go to /api/browser/input.
// Because it is a real Chrome and not an iframe, a site's frame rules do not matter here.
// It sits under the chat (z-index 50) and stops above the chat bar, so chat stays bottom center and an
// expanded chat grows over the stream. The node stays in the page when closed, so reopening is instant.
// window.HubBrowser = { open(url, { name, icon }), close(), isOpen(), mini(el, opts) -> { close() }, shotUrl(entry) }
// `hub-browser-state` fires on document when it opens or closes.
;(() => {
  const L = d => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
  const IC = {
    back: L('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'),
    fwd: L('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
    reload: L('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'),
    close: L('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    x: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    plus: L('<path d="M5 12h14"/><path d="M12 5v14"/>'),
    ext: L('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
    more: L('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'),
    hand: L('<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>'),
    bot: L('<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>'),
    kbd: L('<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>'),
    globe: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
    list: L('<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>'),
    monitor: L('<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>'),
    phone: L('<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>'),
    power: L('<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>'),
    eye: L('<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>'),
    check: L('<path d="M20 6 9 17l-5-5"/>'),
    shield: L('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'),
  }
  const AGENT_QUIET_MS = 20e3 // same as browser.mjs: your input takes control by itself once the agent has been quiet this long
  const START_URL = /^https:\/\/www\.google\.com\/?$/
  const S = {
    profile: '', status: null, st: null, fresh: false, es: null, log: [], meta: null, decoding: false, pending: null, last: '',
    root: null, scrim: null, canvas: null, ctx: null, open: false, hiddenAt: 0, fit: true, actOpen: false, err: '', drawn: false,
    want: '', told: false, going: '', goingAt: 0, icon: null,
  }
  try { S.actOpen = localStorage.getItem('hub-browser-activity') === '1' } catch {}
  try { S.fit = localStorage.getItem('hub-browser-fit') !== '0' } catch {}
  const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const post = (p, body) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify(body) }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status }); return j })
  const toast = m => (typeof hud === 'function' ? hud(m) : console.log(m))
  const isOwner = () => S.st?.controller === 'owner'
  const working = () => !!S.st && !isOwner() && Date.now() - (S.st.agentAt || 0) < AGENT_QUIET_MS
  const takeIfQuiet = () => !!S.st && !isOwner() && !working()
  const pretty = url => (!url || url === 'about:blank' ? '' : url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))
  const parse = url => { try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`) } catch { return null } }

  /* ---------- style ---------- */

  const css = `
.bw-scrim { --bw-side: 24px; --bw-base: 16px; position: fixed; inset: 0; z-index: 45; display: flex; align-items: center; justify-content: center; padding: 24px var(--bw-side) calc(var(--bw-base) + env(safe-area-inset-bottom, 0px) + 64px + var(--bw-kb, 0px)); background: rgba(0,0,0,.34); box-shadow: 0 0 0 40px rgba(0,0,0,.34); animation: fade .2s ease; }
.bw-scrim.nochat { padding-bottom: calc(var(--bw-base) + env(safe-area-inset-bottom, 0px) + var(--bw-kb, 0px)); }
.bw-scrim[hidden] { display: none; }
.bw { position: relative; display: flex; flex-direction: column; width: min(1280px, 100%); height: min(920px, 100%); min-width: 0; border-radius: 18px; overflow: hidden; background: var(--bg); outline: 0; box-shadow: 0 0 0 .5px var(--sep), 0 30px 80px rgba(0,0,0,.4); animation: rise .35s var(--ease); }
.bw-top { flex: none; display: flex; align-items: center; gap: 4px; min-width: 0; min-height: 54px; padding: 0 8px; background: var(--menu-bg); -webkit-backdrop-filter: saturate(180%) blur(30px); backdrop-filter: saturate(180%) blur(30px); box-shadow: 0 .5px 0 var(--sep); position: relative; z-index: 1; }
.bw-ib { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 10px; background: transparent; color: var(--label); cursor: pointer; -webkit-tap-highlight-color: transparent; }
.bw-ib:hover { background: var(--fill); }
.bw-ib:active { background: var(--fill-2); }
.bw-ib:disabled { color: var(--label-3); background: transparent; cursor: default; }
.bw-ib.touch { display: none; }
@media (pointer: coarse) { .bw-ib.touch { display: grid; } .bw.working .bw-ib.touch { display: none; } }
.bw-url { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; height: 36px; margin: 0 4px; padding: 0 12px 0 10px; border-radius: 10px; background: var(--fill); color: var(--label-2); }
.bw-url:focus-within { box-shadow: 0 0 0 2px var(--blue); background: var(--surface); }
.bw-url .ic { flex: none; display: grid; place-items: center; width: 18px; height: 18px; }
.bw-url .ic img { display: block; width: 18px; height: 18px; border-radius: 4px; object-fit: contain; }
.bw-url input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--label); font: 15px var(--font); letter-spacing: -0.012em; padding: 0; text-overflow: ellipsis; }
.bw-work { flex: none; display: inline-flex; align-items: center; gap: 7px; margin: 0 4px; color: var(--label-2); font: 13px var(--font); letter-spacing: -0.006em; white-space: nowrap; }
.bw-work[hidden] { display: none; }
.bw-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 25%, transparent); animation: bw-pulse 1.6s infinite; }
.bw-strip .bw-dot { background: var(--orange); box-shadow: 0 0 0 3px color-mix(in srgb, var(--orange) 25%, transparent); }
@keyframes bw-pulse { 50% { opacity: .45 } }
.bw-pill { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 12px; margin: 0 2px; border: 0; border-radius: 10px; background: var(--blue); color: #fff; font: 500 14px var(--font); letter-spacing: -0.01em; cursor: pointer; white-space: nowrap; -webkit-tap-highlight-color: transparent; }
.bw-pill[hidden] { display: none; }
.bw-pill.give { background: var(--fill); color: var(--label); }
.bw-pill.give:hover { background: var(--fill-2); }
.bw-strip { flex: none; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 8px 6px 16px; background: color-mix(in srgb, var(--orange) 12%, var(--bg)); box-shadow: 0 .5px 0 var(--sep); color: var(--label); font: 14px var(--font); letter-spacing: -0.01em; }
.bw-strip[hidden] { display: none; }
.bw-strip .t { flex: 1; min-width: 0; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.bw-btn { flex: none; height: 32px; padding: 0 12px; border: 0; border-radius: 9px; background: var(--blue); color: #fff; font: 600 13px var(--font); cursor: pointer; white-space: nowrap; }
.bw-btn.sec { background: var(--fill-2); color: var(--label); }
.bw-tabbar { flex: none; display: flex; align-items: center; gap: 4px; min-width: 0; padding: 6px 8px; box-shadow: 0 .5px 0 var(--sep); }
.bw-tabbar[hidden] { display: none; }
.bw-tabbar .bw-ib { width: 32px; height: 32px; }
.bw-tabs { flex: 1; display: flex; align-items: center; gap: 6px; overflow-x: auto; scrollbar-width: none; min-width: 0; padding: 1px; }
.bw-tabs::-webkit-scrollbar { display: none; }
.bw-tab { flex: 0 1 200px; min-width: 110px; display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 6px 0 12px; border-radius: 9px; background: var(--fill); color: var(--label-2); font: 13px var(--font); letter-spacing: -0.006em; cursor: pointer; border: 0; text-align: left; }
.bw-tab span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bw-tab.on { background: var(--surface); color: var(--label); box-shadow: 0 0 0 .5px var(--sep), 0 1px 3px rgba(0,0,0,.08); font-weight: 500; }
.bw-tab i { flex: none; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; color: var(--label-2); }
.bw-tab i:hover { background: var(--fill-2); color: var(--label); }
.bw-body { flex: 1 1 auto; display: flex; min-width: 0; min-height: 0; }
.bw-stage { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; background: var(--bg); overflow: hidden; display: grid; place-items: center; }
.bw-canvas { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; outline: none; cursor: default; }
.bw.working .bw-canvas { cursor: not-allowed; }
.bw-kbd { position: absolute; left: 0; bottom: 0; width: 1px; height: 1px; opacity: 0; border: 0; padding: 0; font-size: 16px; pointer-events: none; }
.bw-load { position: absolute; left: 0; top: 0; width: 100%; height: 2px; overflow: hidden; pointer-events: none; }
.bw-load[hidden] { display: none; }
.bw-load::after { content: ''; display: block; width: 35%; height: 100%; background: var(--blue); animation: bw-slide 1.1s var(--ease) infinite; }
@keyframes bw-slide { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
.bw-msg { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; background: color-mix(in srgb, var(--bg) 88%, transparent); color: var(--label-2); font: 15px var(--font); padding: 20px; }
.bw-msg[hidden] { display: none; }
.bw-msg.solid { background: var(--bg); }
.bw-msg b { display: block; font-size: 17px; font-weight: 600; color: var(--label); margin-bottom: 6px; }
.bw-msg button { margin-top: 14px; }
.bw-act { flex: 0 0 300px; min-width: 0; display: flex; flex-direction: column; background: var(--surface); box-shadow: -.5px 0 0 var(--sep); overflow: hidden; }
.bw-act[hidden] { display: none; }
.bw-act header { flex: none; display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 4px 14px; font: 600 15px var(--font); letter-spacing: -0.016em; }
.bw-act header .bw-ib { width: 32px; height: 32px; }
.bw-act ol { list-style: none; margin: 0; padding: 0 6px 8px; overflow-y: auto; flex: 1; }
.bw-act li { display: flex; gap: 9px; padding: 8px; border-radius: 10px; font: 13px var(--font); letter-spacing: -0.006em; color: var(--label); }
.bw-act li:hover { background: var(--fill); }
.bw-act li .w { flex: none; width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; background: var(--fill); color: var(--label-2); }
.bw-act li .w svg { width: 14px; height: 14px; }
.bw-act li.agent .w { background: color-mix(in srgb, var(--indigo) 16%, transparent); color: var(--indigo); }
.bw-act li.owner .w { background: color-mix(in srgb, var(--blue) 16%, transparent); color: var(--blue); }
.bw-act li.refused .w { background: color-mix(in srgb, var(--red) 16%, transparent); color: var(--red); }
.bw-act li .m { min-width: 0; flex: 1; }
.bw-act li .d { overflow-wrap: anywhere; }
.bw-act li .s { color: var(--label-2); font-size: 12px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bw-act li img { display: block; width: 100%; margin-top: 6px; border-radius: 8px; box-shadow: 0 0 0 .5px var(--sep); }
.bw-act .empty { padding: 8px 14px 16px; color: var(--label-2); font: 13px var(--font); }
@media (max-width: 720px) {
  .bw-scrim { --bw-side: 8px; --bw-base: 12px; padding-top: max(8px, env(safe-area-inset-top, 0px)); }
  .bw { border-radius: 16px; }
  .bw-top { gap: 0; padding: 0 4px; }
  .bw-top .bw-ib { width: 34px; }
  .bw-top [data-a="forward"], .bw-work .lbl, .bw-pill .lbl { display: none; }
  .bw-pill { padding: 0 9px; }
  .bw-url { padding: 0 8px; gap: 6px; margin: 0 2px; }
  .bw-url input { font-size: 16px; }
  .bw-body { flex-direction: column; }
  .bw-act { flex: 0 0 42%; box-shadow: 0 -.5px 0 var(--sep); }
  .bw-tab { flex-basis: 150px; min-width: 96px; }
}
@media (prefers-reduced-motion: reduce) { .bw-scrim, .bw, .bw-dot, .bw-load::after { animation: none; } }`
  if (!document.getElementById('hub-browser-style')) {
    const el = document.createElement('style')
    el.id = 'hub-browser-style'
    el.textContent = css
    document.head.append(el)
  }

  /* ---------- the view: built once, kept in the page ---------- */

  function build() {
    if (S.root) return
    const scrim = document.createElement('div')
    scrim.className = 'bw-scrim'
    scrim.hidden = true
    scrim.innerHTML = `
<div class="bw" role="dialog" aria-label="Browser" tabindex="-1">
  <div class="bw-top">
    <button class="bw-ib" data-a="back" title="Back" aria-label="Back">${IC.back}</button>
    <button class="bw-ib" data-a="forward" title="Forward" aria-label="Forward">${IC.fwd}</button>
    <form class="bw-url" autocomplete="off"><span class="ic">${IC.globe}</span><input type="text" inputmode="url" enterkeyhint="go" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Search or enter address" aria-label="Address"></form>
    <button class="bw-ib" data-a="reload" title="Refresh" aria-label="Refresh">${IC.reload}</button>
    <span class="bw-work" hidden><i class="bw-dot"></i><span class="lbl">Agent working</span></span>
    <button class="bw-pill" data-a="control" hidden></button>
    <button class="bw-ib touch" data-a="kbd" title="Keyboard" aria-label="Show keyboard">${IC.kbd}</button>
    <button class="bw-ib" data-a="external" title="Open in New Tab" aria-label="Open in New Tab">${IC.ext}</button>
    <button class="bw-ib" data-a="more" title="More" aria-label="More">${IC.more}</button>
    <button class="bw-ib" data-a="close" title="Close" aria-label="Close">${IC.close}</button>
  </div>
  <div class="bw-strip" hidden></div>
  <div class="bw-tabbar" hidden><div class="bw-tabs" role="tablist"></div><button class="bw-ib" data-a="newtab" title="New tab" aria-label="New tab">${IC.plus}</button></div>
  <div class="bw-body">
    <div class="bw-stage">
      <canvas class="bw-canvas" tabindex="-1" aria-label="Live browser"></canvas>
      <input class="bw-kbd" type="text" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" aria-hidden="true">
      <div class="bw-load" hidden></div>
      <div class="bw-msg"></div>
    </div>
    <aside class="bw-act" hidden><header><span>Activity</span><button class="bw-ib" data-a="activity" title="Close activity" aria-label="Close activity">${IC.close}</button></header><ol></ol></aside>
  </div>
</div>`
    S.scrim = scrim
    S.root = scrim.firstElementChild
    S.canvas = S.root.querySelector('.bw-canvas')
    S.ctx = S.canvas.getContext('2d')
    S.canvas.width = 1280
    S.canvas.height = 800
    wire(S.root)
    scrim.addEventListener('pointerdown', e => { if (e.target === scrim) close() })
    document.body.append(scrim)
  }

  const announce = () => document.dispatchEvent(new CustomEvent('hub-browser-state', { detail: { open: S.open } }))

  // The keyboard pushes the chat bar up, so the stage's bottom edge goes with it.
  function trackKeyboard() {
    const vv = window.visualViewport
    if (S.open && vv) S.scrim.style.setProperty('--bw-kb', `${Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop))}px`)
  }
  window.visualViewport?.addEventListener('resize', trackKeyboard)
  window.visualViewport?.addEventListener('scroll', trackKeyboard)

  async function open(url, info = {}) {
    build()
    if (url) {
      S.want = String(url)
      S.told = false
      const u = parse(S.want)
      if (u && info.icon) S.icon = { host: u.hostname, src: info.icon }
    }
    if (!S.open) {
      S.open = true
      S.scrim.hidden = false
      S.scrim.classList.toggle('nochat', !document.getElementById('hub-chat'))
      document.documentElement.style.overflow = 'hidden'
      if (S.err === 'off') S.err = ''
      trackKeyboard()
      // Typing goes straight to the page on a desktop; a phone keeps its keyboard down until asked.
      if (matchMedia('(pointer: fine)').matches) S.root.querySelector('.bw-kbd').focus({ preventScroll: true })
      else S.root.focus({ preventScroll: true })
      announce()
    }
    paint()
    paintLog()
    await loadStatus()
    connect()
    paint()
    applyFit()
    go()
  }

  // Closing keeps Chrome and its tabs for a quick reopen and hands the browser back, so the agent is never stuck behind you.
  function close() {
    if (!S.open) return
    S.open = false
    S.want = ''
    S.going = ''
    S.scrim.hidden = true
    document.documentElement.style.overflow = ''
    if (isOwner() && !S.st.ask) post('/api/browser/act', { profile: S.profile, act: 'control', to: 'agent' }).catch(() => {})
    announce()
  }

  document.addEventListener('keydown', e => {
    if (!S.open || e.composedPath().includes(document.getElementById('hub-chat'))) return
    if (document.querySelector('.menu, .scrim')) return // whatever sits above the pop-up handles its own keys
    if (S.root.contains(e.target) && e.target.closest('.bw-kbd, .bw-url')) return // Esc belongs to the page or the address
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return close() }
    if (!S.root.contains(e.target)) e.stopPropagation() // the hub's own shortcuts (1-9, /, f, r) stay off under the pop-up
  }, true)

  // A hidden pop-up with nothing else watching closes the stream after a moment, so Chrome can idle out.
  setInterval(() => {
    if ((S.open || minis.size) && document.visibilityState === 'visible') { S.hiddenAt = 0; return }
    if (!S.es) return
    if (!S.hiddenAt) S.hiddenAt = Date.now()
    else if (Date.now() - S.hiddenAt > 3000) disconnect()
  }, 1000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (S.open || minis.size)) connect() })

  /* ---------- stream ---------- */

  async function loadStatus() {
    try {
      S.status = await (await fetch('/api/browser/status', { cache: 'no-store' })).json()
      if (S.status.current && S.status.current !== S.profile) {
        const had = !!S.profile
        S.profile = S.status.current
        if (had) restart()
      }
    } catch {}
  }

  function connect() {
    if (S.es || !S.profile) return
    S.fresh = false
    const es = (S.es = new EventSource(`/api/browser/stream?profile=${encodeURIComponent(S.profile)}`))
    es.addEventListener('state', e => {
      S.st = JSON.parse(e.data)
      S.err = ''
      if (S.st.running === false) { disconnect(); S.st = null; S.err = 'off' }
      const first = !S.fresh && !!S.st
      if (S.st) S.fresh = true
      paint()
      if (first) applyFit()
      go()
    })
    es.addEventListener('log', e => {
      const entry = JSON.parse(e.data)
      if (S.log.some(x => x.id === entry.id)) return
      S.log.push(entry)
      if (S.log.length > 200) S.log.shift()
      paintLog()
    })
    es.addEventListener('frame', e => onFrame(JSON.parse(e.data)))
    es.onerror = () => {
      // EventSource retries by itself; after a hub restart it reconnects and the state comes back.
      S.err = S.st ? 'reconnecting' : S.err || 'starting'
      if (es.readyState === EventSource.CLOSED) { S.es = null; setTimeout(() => (S.open || minis.size) && connect(), 3000) }
      paint()
    }
  }
  function disconnect() {
    S.es?.close()
    S.es = null
    S.fresh = false
  }
  function restart() { disconnect(); S.st = null; S.log = []; S.drawn = false; S.err = ''; connect(); paint(); paintLog() }

  function onFrame(f) {
    S.meta = f.meta || S.meta
    S.pending = f.jpg
    S.last = f.jpg
    if (!S.decoding) decode()
  }
  // Only the newest frame is drawn; frames that arrive while one decodes are dropped.
  async function decode() {
    S.decoding = true
    while (S.pending) {
      const b64 = S.pending
      S.pending = null
      try {
        const bin = atob(b64)
        const buf = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
        const bmp = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }))
        if (S.canvas.width !== bmp.width || S.canvas.height !== bmp.height) { S.canvas.width = bmp.width; S.canvas.height = bmp.height }
        S.ctx.drawImage(bmp, 0, 0)
        bmp.close?.()
        if (!S.drawn) { S.drawn = true; paint() }
        for (const m of minis) m.draw(b64)
      } catch {}
    }
    S.decoding = false
  }

  /* ---------- where a site opens ---------- */

  // A site already open in a tab is reused; the start page is replaced; anything else gets its own tab.
  // While the agent is working the request waits, so a click never pulls the page out from under it.
  async function go() {
    if (!S.want || !S.fresh || !S.st) return
    const u = parse(S.want)
    if (working()) {
      if (!S.told) { S.told = true; toast(`The agent is using the browser. Take control to open ${u?.hostname || S.want}`) }
      return
    }
    const target = u ? u.href : S.want
    S.want = ''
    const st = S.st
    const tab = u && st.tabs?.find(t => parse(t.url)?.origin === u.origin)
    S.going = target
    S.goingAt = Date.now()
    paint()
    try {
      if (tab) {
        if (tab.id !== st.active) await act({ act: 'tab_select', id: tab.id })
        if (u.pathname !== '/' && parse(tab.url)?.href !== u.href) await act({ act: 'open', url: target })
      } else {
        const start = !st.url || st.url === 'about:blank' || START_URL.test(st.url)
        await act({ act: 'open', url: target, ...(start ? {} : { newTab: true }) })
      }
    } catch {}
    S.going = ''
    paint()
  }

  /* ---------- painting the chrome around the stream ---------- */

  function paintIcon(url) {
    const box = S.root.querySelector('.bw-url .ic')
    const u = url ? parse(url) : null
    const host = u && /^https?:$/.test(u.protocol) && !/^(localhost|127\.|10\.|192\.168\.|100\.|\[)/.test(u.hostname) ? u.hostname : '' // no icon lookup for this machine's own addresses
    if (box._host === host) return
    box._host = host
    if (!host) { box.innerHTML = IC.globe; return }
    const src = S.icon?.host === host ? S.icon.src : `/api/hub/site-icon?url=${encodeURIComponent(u.origin)}`
    box.innerHTML = `<img alt="" src="${escH(src)}">`
    box.firstElementChild.onerror = () => { box.innerHTML = IC.globe }
  }

  function paint() {
    const r = S.root
    if (!r || !S.open) return
    const st = S.st, mine = isOwner(), busy = working()
    if (S.going && Date.now() - S.goingAt > 15e3) S.going = ''
    r.classList.toggle('working', busy)
    r.querySelector('[data-a=back]').disabled = !st?.canBack
    r.querySelector('[data-a=forward]').disabled = !st?.canForward
    const url = S.going || S.want || st?.url || ''
    const input = r.querySelector('.bw-url input')
    if (document.activeElement !== input) input.value = pretty(url)
    paintIcon(url)
    r.querySelector('[data-a=external]').disabled = !/^https?:/.test(url)
    r.querySelector('.bw-load').hidden = !S.going
    r.querySelector('.bw-work').hidden = !busy
    // One control button, and only when there is something to hand over.
    const ctl = r.querySelector('[data-a=control]')
    const give = mine && !st?.ask && Date.now() - (st?.agentAt || 0) < 5 * 60e3
    ctl.hidden = !busy && !give
    ctl.classList.toggle('give', give)
    const label = busy ? 'take' : give ? 'give' : ''
    if (ctl._label !== label) {
      ctl._label = label
      ctl.innerHTML = give ? `${IC.bot}<span class="lbl">Give back</span>` : `${IC.hand}<span class="lbl">Take control</span>`
      ctl.title = give ? 'Give control back to the agent' : 'Take control from the agent'
      ctl.setAttribute('aria-label', ctl.title)
    }
    // Tabs show up only once there is more than one.
    const bar = r.querySelector('.bw-tabbar')
    bar.hidden = (st?.tabs?.length || 0) < 2
    const tabs = r.querySelector('.bw-tabs')
    const sig = JSON.stringify([st?.tabs, st?.active])
    if (tabs._sig !== sig) {
      tabs._sig = sig
      tabs.innerHTML = (st?.tabs || []).map(t => `<button class="bw-tab${t.id === st.active ? ' on' : ''}" role="tab" aria-selected="${t.id === st.active}" data-tab="${escH(t.id)}" title="${escH(t.url)}"><span>${escH(t.title || t.url || 'New tab')}</span><i data-close="${escH(t.id)}" aria-label="Close tab">${IC.x}</i></button>`).join('')
      const on = tabs.querySelector('.on') // scroll the strip only, never the page
      if (on && (on.offsetLeft < tabs.scrollLeft || on.offsetLeft + on.offsetWidth > tabs.scrollLeft + tabs.clientWidth)) tabs.scrollLeft = on.offsetLeft - 8
    }
    // A note over the stage only while there is nothing to show, or the link is down.
    const msg = r.querySelector('.bw-msg')
    const off = S.err === 'off', down = S.err === 'reconnecting'
    msg.hidden = !!(st && S.drawn) && !off && !down
    msg.classList.toggle('solid', off)
    const prof = S.status?.profiles?.find(p => p.id === S.profile)
    const html = off
      ? `<div><b>The browser is closed</b><span>${escH(prof?.label || S.profile)} keeps its sign-ins. Chrome closes itself after ${S.status?.idleMinutes || 15} minutes unused.</span><br><button class="bw-btn" data-a="start">Open browser</button></div>`
      : down ? '<div><b>Reconnecting…</b><span>The hub is restarting or the link dropped.</span></div>'
      : '<div><b>Starting Chrome…</b><span>The browser opens on demand.</span></div>'
    if (msg._html !== html) { msg._html = html; msg.innerHTML = html }
    // In line, never over the page: a dialog first, then the agent's ask.
    const strip = r.querySelector('.bw-strip')
    const note = st?.dialog
      ? `<i class="bw-dot"></i><span class="t">${escH(st.dialog.message || st.dialog.type)}</span><button class="bw-btn sec" data-a="dlg-no">Cancel</button><button class="bw-btn" data-a="dlg-yes">OK</button>`
      : mine && st?.ask ? `<i class="bw-dot"></i><span class="t"><b>Agent:</b> ${escH(st.ask)}</span><button class="bw-btn" data-a="giveback">Done</button>`
      : ''
    strip.hidden = !note
    if (strip._html !== note) { strip._html = note; strip.innerHTML = note }
  }
  // The agent's "working" state fades 20 s after its last step without a new state push.
  setInterval(() => { if (S.open && S.st) { paint(); go(); applyFit() } }, 5000)

  const WHO = { agent: IC.bot, owner: IC.hand, hub: IC.shield }
  function paintLog() {
    const box = S.root?.querySelector('.bw-act')
    if (!box) return
    box.hidden = !S.actOpen
    if (!S.actOpen || !S.open) return
    const rows = S.log.filter(e => e.profile === S.profile).slice(-60).reverse()
    const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }
    box.querySelector('ol').innerHTML = rows.length ? rows.map((e, i) => `<li class="${e.act === 'refused' ? 'refused' : escH(e.who)}"><span class="w">${WHO[e.who] || IC.shield}</span><div class="m"><div class="d"><b>${escH(e.act)}</b> ${escH(e.detail)}</div><div class="s">${escH(ago(e.at))}${e.url ? ` · ${escH(pretty(e.url))}` : ''}</div>${e.shot && i < 6 ? `<img loading="lazy" src="${escH(e.shot)}" alt="">` : ''}</div></li>`).join('') : '<div class="empty">Nothing yet. When the agent uses the browser, each step shows here with a screenshot.</div>'
  }

  /* ---------- actions ---------- */

  async function act(body) {
    try { return await post('/api/browser/act', { profile: S.profile, ...body }) } catch (e) { toast(e.message); throw e }
  }

  function moreMenu(x, y) {
    const profiles = S.status?.profiles || []
    const items = profiles.length > 1 ? [...profiles.map(p => ({ label: p.email ? `${p.label} · ${p.email}` : p.label, icon: p.id === S.profile ? IC.check : '', run: () => switchProfile(p.id) })), '-'] : []
    const mode = S.st?.mode || profiles.find(p => p.id === S.profile)?.mode
    const fit = S.st?.size?.mode === 'fit'
    items.push(
      { label: 'New tab', icon: IC.plus, run: newTab },
      { label: S.actOpen ? 'Hide activity' : 'Show activity', icon: IC.list, run: toggleActivity },
      '-',
      { label: fit ? 'Desktop size (1280×800)' : 'Fit to this screen', icon: fit ? IC.monitor : IC.phone, run: () => setFit(!fit) },
      { label: mode === 'headed' ? 'Run hidden' : 'Show window on this computer', icon: IC.eye, run: () => act({ act: 'mode', mode: mode === 'headed' ? 'headless' : 'headed' }).then(() => setTimeout(restart, 600)).catch(() => {}) },
      { label: 'Close browser', icon: IC.power, danger: true, run: () => act({ act: 'close' }).then(() => { disconnect(); S.st = null; S.err = 'off'; S.drawn = false; paint() }).catch(() => {}) })
    if (typeof showMenu === 'function') showMenu(x, y, profiles.find(p => p.id === S.profile)?.label || 'Browser', items)
  }

  function newTab() { act({ act: 'tab_new' }).then(() => S.root.querySelector('.bw-url input').focus()).catch(() => {}) }
  function toggleActivity() {
    S.actOpen = !S.actOpen
    try { localStorage.setItem('hub-browser-activity', S.actOpen ? '1' : '0') } catch {}
    paintLog()
  }

  function switchProfile(id) {
    if (id === S.profile) return
    S.profile = id
    post('/api/browser/act', { act: 'profile', to: id }).catch(() => {})
    restart()
  }

  // Fit is the default: the page renders at the stage's own size, so nothing is scaled down. Never
  // while the agent is working, because it would change the page under it.
  // One resize at a time: with many tabs it is slow, and the state it answers with would be stale.
  let fitting = false, refit = false
  function applyFit() {
    if (!S.open || !S.st || working()) return
    if (fitting) { refit = true; return }
    const stage = S.root.querySelector('.bw-stage')
    const w = Math.round(stage.clientWidth), h = Math.round(stage.clientHeight)
    if (!w || !h) return
    const size = S.st.size
    if (!S.fit) { if (size?.mode === 'fit') act({ act: 'size', mode: 'desktop' }).catch(() => {}); return }
    if (size?.mode === 'fit' && Math.abs(size.w - w) <= 8 && Math.abs(size.h - h) <= 8) return
    fitting = true
    act({ act: 'size', mode: 'fit', w, h })
      .then(r => { if (S.st && r?.size) S.st.size = r.size })
      .catch(() => {})
      .finally(() => { fitting = false; if (refit) { refit = false; applyFit() } })
  }
  function setFit(on) {
    S.fit = on
    try { localStorage.setItem('hub-browser-fit', on ? '1' : '0') } catch {}
    applyFit()
  }


  /* ---------- your input ---------- */

  let queue = [], sending = false, lastMove = null
  function sendInput(ev) {
    if (ev.t === 'mouse' && ev.type === 'mouseMoved') { lastMove = ev; return flushSoon() }
    if (lastMove) { queue.push(lastMove); lastMove = null }
    queue.push(ev)
    flushSoon()
  }
  function flushSoon() { if (!sending) requestAnimationFrame(flush) }
  async function flush() {
    if (sending) return
    if (lastMove) { queue.push(lastMove); lastMove = null }
    if (!queue.length) return
    const events = queue
    queue = []
    sending = true
    try {
      await post('/api/browser/input', { profile: S.profile, events })
    } catch (e) {
      if (e.status === 409) { toast('The agent is working: tap Take control first'); queue = [] }
    }
    sending = false
    if (queue.length || lastMove) flush()
  }

  function toPage(e) {
    const r = S.canvas.getBoundingClientRect()
    const w = S.meta?.deviceWidth || S.st?.size?.w || 1280
    const h = S.meta?.deviceHeight || S.st?.size?.h || 800
    return { x: Math.round(((e.clientX - r.left) / r.width) * w * 10) / 10, y: Math.round(((e.clientY - r.top) / r.height) * h * 10) / 10, k: w / r.width }
  }
  const mods = e => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)
  const BTN = ['left', 'middle', 'right']

  const VK = { Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Pause: 19, CapsLock: 20, Escape: 27, ' ': 32, PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Insert: 45, Delete: 46, Meta: 91, F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117, F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123, ';': 186, '=': 187, ',': 188, '-': 189, '.': 190, '/': 191, '`': 192, '[': 219, '\\': 220, ']': 221, "'": 222 }
  const vkOf = e => VK[e.key] ?? (/^[a-z0-9]$/i.test(e.key) ? e.key.toUpperCase().charCodeAt(0) : 0)
  const COMMANDS = { a: 'selectAll', c: 'copy', x: 'cut', z: 'undo', y: 'redo' }

  function wire(root) {
    const cv = root.querySelector('.bw-canvas')
    const kbd = root.querySelector('.bw-kbd')

    // Nothing pressed inside the pop-up reaches the hub's own shortcuts.
    root.addEventListener('keydown', e => e.stopPropagation())
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-a],[data-tab],[data-close]')
      if (!b) return
      if (b.dataset.close) { e.stopPropagation(); return act({ act: 'tab_close', id: b.dataset.close }).catch(() => {}) }
      if (b.dataset.tab) return b.classList.contains('on') || act({ act: 'tab_select', id: b.dataset.tab }).catch(() => {})
      const a = b.dataset.a
      if (a === 'close') return close()
      if (a === 'back' || a === 'forward' || a === 'reload') return act({ act: a }).catch(() => {})
      if (a === 'newtab') return newTab()
      if (a === 'external') { const u = S.going || S.want || S.st?.url; if (u) window.open(u, '_blank', 'noopener'); return }
      if (a === 'more') { const r = b.getBoundingClientRect(); return moreMenu(r.left, r.bottom + 6) }
      if (a === 'activity') return toggleActivity()
      if (a === 'control' || a === 'giveback') {
        const to = a === 'giveback' || (isOwner() && !working()) ? 'agent' : 'owner'
        return act({ act: 'control', to }).then(() => {
          if (to !== 'owner') return
          if (S.st) { S.st.controller = 'owner'; S.st.agentAt = 0 }
          paint()
          applyFit()
          go()
        }).catch(() => {})
      }
      if (a === 'kbd') { kbd.style.pointerEvents = 'auto'; kbd.focus(); kbd.style.pointerEvents = ''; return }
      if (a === 'start') { S.err = ''; return restart() }
      if (a === 'dlg-yes' || a === 'dlg-no') return act({ act: 'dialog', accept: a === 'dlg-yes' }).catch(() => {})
    })
    root.querySelector('.bw-url').addEventListener('submit', async e => {
      e.preventDefault()
      const input = e.target.querySelector('input')
      const url = input.value.trim()
      if (!url) return
      input.blur()
      S.going = url
      S.goingAt = Date.now()
      paint()
      try {
        if (working()) await act({ act: 'control', to: 'owner' }) // typing an address takes the browser over
        await act({ act: 'open', url })
      } catch {}
      S.going = ''
      paint()
    })
    const address = root.querySelector('.bw-url input')
    address.addEventListener('focus', e => { e.target.value = S.st?.url && S.st.url !== 'about:blank' ? S.st.url : e.target.value; setTimeout(() => e.target.select(), 0) })
    address.addEventListener('blur', () => paint())
    address.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.target.blur(); paint() } })

    // Mouse and pen: real mouse events. Touch: a tap is a click, a one-finger drag scrolls.
    let touch = null, lastDown = { t: 0, x: 0, y: 0, n: 1 }
    cv.addEventListener('contextmenu', e => e.preventDefault())
    cv.addEventListener('pointerdown', e => {
      if (!isOwner() && !takeIfQuiet()) { toast('The agent is working: tap Take control first'); return }
      e.preventDefault()
      const p = toPage(e)
      if (e.pointerType === 'touch') {
        if (!e.isPrimary) return
        touch = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: Date.now(), moved: false, p }
        return
      }
      cv.setPointerCapture(e.pointerId)
      const now = Date.now()
      const n = now - lastDown.t < 400 && Math.abs(p.x - lastDown.x) < 5 && Math.abs(p.y - lastDown.y) < 5 ? Math.min(3, lastDown.n + 1) : 1
      lastDown = { t: now, x: p.x, y: p.y, n }
      sendInput({ t: 'mouse', type: 'mousePressed', x: p.x, y: p.y, button: BTN[e.button] || 'left', buttons: e.buttons, clicks: n, mods: mods(e) })
      kbd.focus({ preventScroll: true }) // desktop typing goes through the hidden field
    })
    cv.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') {
        if (!touch || e.pointerId !== touch.id) return
        e.preventDefault()
        const k = toPage(e).k
        const dx = touch.x - e.clientX, dy = touch.y - e.clientY
        if (!touch.moved && Math.hypot(e.clientX - touch.x0, e.clientY - touch.y0) < 8) return
        touch.moved = true
        touch.x = e.clientX
        touch.y = e.clientY
        if (isOwner() || takeIfQuiet()) sendInput({ t: 'wheel', x: touch.p.x, y: touch.p.y, dx: dx * k, dy: dy * k })
        return
      }
      if (!isOwner()) return
      const p = toPage(e)
      sendInput({ t: 'mouse', type: 'mouseMoved', x: p.x, y: p.y, button: e.buttons & 1 ? 'left' : 'none', buttons: e.buttons, mods: mods(e) })
    })
    const up = e => {
      if (e.pointerType === 'touch') {
        if (!touch || e.pointerId !== touch.id) return
        const t = touch
        touch = null
        if (e.type === 'pointercancel' || t.moved || Date.now() - t.t > 700) return
        const p = t.p
        sendInput({ t: 'mouse', type: 'mouseMoved', x: p.x, y: p.y })
        sendInput({ t: 'mouse', type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clicks: 1 })
        sendInput({ t: 'mouse', type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clicks: 1 })
        return
      }
      if (!isOwner()) return
      const p = toPage(e)
      sendInput({ t: 'mouse', type: 'mouseReleased', x: p.x, y: p.y, button: BTN[e.button] || 'left', buttons: e.buttons, clicks: lastDown.n, mods: mods(e) })
    }
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointercancel', up)
    cv.addEventListener('wheel', e => {
      if (!isOwner() && !takeIfQuiet()) return
      e.preventDefault()
      const p = toPage(e)
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1
      sendInput({ t: 'wheel', x: p.x, y: p.y, dx: e.deltaX * unit, dy: e.deltaY * unit, mods: mods(e) })
    }, { passive: false })

    // Keys: printable text arrives through the hidden field's input event (works with the iPad
    // keyboard, autocorrect and dictation); everything else goes as a key event.
    kbd.addEventListener('keydown', e => {
      e.stopPropagation()
      if (!isOwner() && !takeIfQuiet()) return
      if (e.isComposing) return
      const ctl = e.ctrlKey || e.metaKey
      const printable = e.key.length === 1 && !ctl && !e.altKey
      if (printable) return // handled by input
      if (ctl && e.key.toLowerCase() === 'v') return // handled by paste
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return
      e.preventDefault()
      const vk = vkOf(e)
      const cmd = ctl && COMMANDS[e.key.toLowerCase()]
      const text = e.key === 'Enter' ? '\r' : ''
      sendInput({ t: 'key', type: text ? 'keyDown' : 'rawKeyDown', key: e.key, code: e.code, vk, text, mods: e.metaKey ? (mods(e) & ~4) | 2 : mods(e), ...(cmd ? { commands: [cmd] } : {}) })
      sendInput({ t: 'key', type: 'keyUp', key: e.key, code: e.code, vk, mods: mods(e) })
    })
    kbd.addEventListener('input', () => {
      const v = kbd.value
      kbd.value = ''
      if (v && (isOwner() || takeIfQuiet())) sendInput({ t: 'text', text: v })
    })
    kbd.addEventListener('paste', e => {
      e.preventDefault()
      const v = e.clipboardData?.getData('text') || ''
      if (v && isOwner()) sendInput({ t: 'text', text: v })
    })

    // Fit follows the stage size when it changes (rotate the phone, resize the window, show the activity).
    let rt = 0
    new ResizeObserver(() => {
      clearTimeout(rt)
      rt = setTimeout(applyFit, 400)
    }).observe(root.querySelector('.bw-stage'))
  }

  /* ---------- mini live views for chat ---------- */

  const minis = new Set()
  window.HubBrowser = {
    open,
    close,
    isOpen: () => S.open,
    shotUrl: e => (e && e.shot) || '',
    // A small live view inside any element (the chat card), fed by the same stream. Click opens the pop-up.
    mini(el) {
      const cv = document.createElement('canvas')
      cv.style.cssText = 'display:block;width:100%;height:auto;border-radius:10px;background:var(--fill);cursor:pointer;box-shadow:0 0 0 .5px var(--sep)'
      cv.width = 640
      cv.height = 400
      el.append(cv)
      const ctx = cv.getContext('2d')
      let busy = false, next = null
      const m = {
        async draw(b64) {
          next = b64
          if (busy) return
          busy = true
          while (next) {
            const s = next
            next = null
            try {
              const bmp = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${s}`)).blob())
              cv.height = Math.round((bmp.height / bmp.width) * cv.width)
              ctx.drawImage(bmp, 0, 0, cv.width, cv.height)
              bmp.close?.()
            } catch {}
          }
          busy = false
        },
        close() { minis.delete(m); cv.remove() },
      }
      cv.addEventListener('click', () => open())
      minis.add(m)
      build()
      if (S.last) m.draw(S.last)
      loadStatus().then(connect)
      return m
    },
  }
})()
