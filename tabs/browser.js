// Browser tab: the hub browser (browser.mjs) streamed live. A tab strip, address bar, back/forward/
// reload, profile switcher, Take control / Give back, fullscreen and the agent's activity log. Frames
// arrive over /api/browser/stream (SSE, JPEG); Your mouse, touch and keys go to /api/browser/input.
// The view is one persistent node: the tab is `persistent`, so index.html renders it once and then
// only calls refresh(); render() returns a placeholder that the node (canvas, focus, iPad keyboard) mounts into.
// Also exposes window.HubBrowser = { open(), mini(el, opts) -> { close() }, shotUrl(entry) } for chat.
;(() => {
  const L = d => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
  const IC = {
    back: L('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'),
    fwd: L('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
    reload: L('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'),
    stop: L('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    x: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    plus: L('<path d="M5 12h14"/><path d="M12 5v14"/>'),
    max: L('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>'),
    min: L('<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>'),
    hand: L('<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>'),
    bot: L('<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>'),
    kbd: L('<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>'),
    lock: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    globe: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
    down: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    list: L('<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>'),
    monitor: L('<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>'),
    phone: L('<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>'),
    power: L('<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>'),
    eye: L('<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>'),
    check: L('<path d="M20 6 9 17l-5-5"/>'),
    shield: L('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'),
  }
  const PLACEHOLDER = '<div id="bw-host" class="bw-host"></div>'
  const S = {
    profile: '', status: null, st: null, es: null, log: [], meta: null, frames: [], decoding: false, pending: null,
    root: null, canvas: null, ctx: null, detachedAt: 0, fit: false, actOpen: false, max: false, err: '', reconnect: 0,
  }
  try { S.profile = localStorage.getItem('hub-browser-profile') || '' } catch {}
  try { S.actOpen = localStorage.getItem('hub-browser-activity') === '1' } catch {}
  const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const post = (p, body) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify(body) }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status }); return j })
  const toast = m => (typeof hud === 'function' ? hud(m) : console.log(m))

  /* ---------- style ---------- */

  const css = `
.bw-host { min-width: 0; }
.bw { display: flex; flex-direction: column; gap: 10px; min-width: 0; margin-bottom: 30px; }
.bw-bar { display: flex; align-items: center; gap: 6px; min-width: 0; }
.bw-ib { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 10px; background: transparent; color: var(--label); cursor: pointer; -webkit-tap-highlight-color: transparent; }
.bw-ib:hover { background: var(--fill); }
.bw-ib:active { background: var(--fill-2); }
.bw-ib:disabled { color: var(--label-3); background: transparent; cursor: default; }
.bw-url { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 7px; height: 36px; padding: 0 12px; border-radius: 10px; background: var(--fill); color: var(--label-2); }
.bw-url:focus-within { box-shadow: 0 0 0 2px var(--blue); background: var(--surface); }
.bw-url input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--label); font: 15px var(--font); letter-spacing: -0.012em; padding: 0; }
.bw-pill { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 12px; border: 0; border-radius: 10px; background: var(--fill); color: var(--label); font: 500 14px var(--font); letter-spacing: -0.01em; cursor: pointer; white-space: nowrap; -webkit-tap-highlight-color: transparent; }
.bw-pill:hover { background: var(--fill-2); }
.bw-pill .av { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: #fff; background: var(--c, var(--blue)); }
.bw-pill.ctl { background: var(--blue); color: #fff; }
.bw-pill.ctl.give { background: color-mix(in srgb, var(--green) 16%, transparent); color: var(--green); }
.bw-tabs { display: flex; align-items: center; gap: 6px; overflow-x: auto; scrollbar-width: none; min-width: 0; padding: 1px; }
.bw-tabs::-webkit-scrollbar { display: none; }
.bw-tab { flex: 0 1 200px; min-width: 110px; display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 6px 0 12px; border-radius: 9px; background: var(--fill); color: var(--label-2); font: 13px var(--font); letter-spacing: -0.006em; cursor: pointer; border: 0; text-align: left; }
.bw-tab span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bw-tab.on { background: var(--surface); color: var(--label); box-shadow: 0 0 0 .5px var(--sep), 0 1px 3px rgba(0,0,0,.08); font-weight: 500; }
.bw-tab i { flex: none; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; color: var(--label-2); }
.bw-tab i:hover { background: var(--fill-2); color: var(--label); }
.bw-body { display: flex; gap: 12px; min-width: 0; align-items: stretch; }
.bw-stage { position: relative; flex: 1 1 auto; min-width: 0; height: calc(100dvh - 300px); min-height: 300px; border-radius: 16px; background: #111; overflow: hidden; display: grid; place-items: center; box-shadow: 0 0 0 .5px var(--sep); }
.bw-canvas { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; outline: none; cursor: default; }
.bw.agent .bw-canvas { cursor: not-allowed; }
.bw-kbd { position: absolute; left: 0; bottom: 0; width: 1px; height: 1px; opacity: 0; border: 0; padding: 0; font-size: 16px; pointer-events: none; }
.bw-msg { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; color: rgba(255,255,255,.8); font: 15px var(--font); padding: 20px; }
.bw-msg[hidden] { display: none; }
.bw-msg b { display: block; font-size: 17px; color: #fff; margin-bottom: 6px; }
.bw-msg button { margin-top: 14px; }
.bw-banner { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); max-width: calc(100% - 24px); display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 14px; border-radius: 14px; background: var(--menu-bg); -webkit-backdrop-filter: saturate(180%) blur(30px); backdrop-filter: saturate(180%) blur(30px); box-shadow: 0 0 0 .5px var(--sep), 0 8px 24px rgba(0,0,0,.25); color: var(--label); font: 14px var(--font); letter-spacing: -0.01em; z-index: 2; }
.bw-banner[hidden] { display: none; }
.bw-banner .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.bw-banner .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 4px color-mix(in srgb, var(--green) 25%, transparent); animation: bw-pulse 1.6s infinite; }
.bw-banner.ask .dot { background: var(--orange); box-shadow: 0 0 0 4px color-mix(in srgb, var(--orange) 25%, transparent); }
@keyframes bw-pulse { 50% { opacity: .45 } }
.bw-btn { flex: none; height: 30px; padding: 0 12px; border: 0; border-radius: 9px; background: var(--blue); color: #fff; font: 600 13px var(--font); cursor: pointer; white-space: nowrap; }
.bw-btn.sec { background: var(--fill-2); color: var(--label); }
.bw-live { position: absolute; right: 10px; bottom: 10px; padding: 3px 8px; border-radius: 7px; background: rgba(0,0,0,.55); color: rgba(255,255,255,.85); font: 600 11px var(--font); letter-spacing: .01em; font-variant-numeric: tabular-nums; pointer-events: none; }
.bw-act { flex: 0 0 290px; min-width: 0; display: flex; flex-direction: column; background: var(--surface); border-radius: 16px; overflow: hidden; height: calc(100dvh - 300px); min-height: 300px; }
.bw-act[hidden] { display: none; }
.bw-act h4 { margin: 0; padding: 12px 14px 8px; font: 600 15px var(--font); letter-spacing: -0.016em; display: flex; justify-content: space-between; align-items: center; }
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
.bw-act li img { display: block; width: 100%; margin-top: 6px; border-radius: 8px; box-shadow: 0 0 0 .5px var(--sep); cursor: zoom-in; }
.bw-act .empty { padding: 16px 14px; color: var(--label-2); font: 13px var(--font); }
.bw.max { position: fixed; inset: 0; z-index: 900; margin: 0; padding: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)); background: var(--bg); }
.bw:fullscreen { padding: 8px; background: var(--bg); }
.bw.max .bw-stage, .bw:fullscreen .bw-stage, .bw.max .bw-act, .bw:fullscreen .bw-act { height: auto; flex: 1 1 auto; }
.bw.max .bw-body, .bw:fullscreen .bw-body { flex: 1 1 auto; min-height: 0; }
.bw-only-wide { }
@media (max-width: 420px) { .bw-bar.top [data-a="forward"] { display: none; } }
@media (max-width: 720px) {
  .bw { gap: 8px; }
  .bw-bar.top { flex-wrap: wrap; }
  .bw-bar.top .bw-url { order: 9; flex-basis: 100%; }
  .bw-pill .lbl { display: none; }
  .bw-pill { padding: 0 10px; }
  .bw-bar.top { gap: 2px; justify-content: space-between; }
  .bw-bar.top .bw-ib { width: 34px; }
  .bw-body { flex-direction: column; }
  .bw-stage { height: auto; min-height: 220px; max-height: calc(100dvh - 260px); }
  .bw-stage.fitmode { height: calc(100dvh - 260px); }
  .bw-act { flex: none; height: auto; max-height: 50vh; }
  .bw.max .bw-act { display: none; }
  .bw-tab { flex-basis: 150px; min-width: 96px; }
}`
  if (!document.getElementById('browser-tab-style')) {
    const el = document.createElement('style')
    el.id = 'browser-tab-style'
    el.textContent = css
    document.head.append(el)
  }

  /* ---------- the persistent view ---------- */

  function build() {
    const root = document.createElement('div')
    root.className = 'bw agent'
    root.innerHTML = `
<div class="bw-bar top">
  <button class="bw-ib" data-a="back" title="Back" aria-label="Back">${IC.back}</button>
  <button class="bw-ib" data-a="forward" title="Forward" aria-label="Forward">${IC.fwd}</button>
  <button class="bw-ib" data-a="reload" title="Reload" aria-label="Reload">${IC.reload}</button>
  <form class="bw-url" autocomplete="off"><span class="ic">${IC.globe}</span><input type="text" inputmode="url" enterkeyhint="go" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Search or enter address" aria-label="Address"></form>
  <button class="bw-pill prof" data-a="profile" title="Profile"><span class="av"></span><span class="lbl"></span>${IC.down}</button>
  <button class="bw-pill ctl" data-a="control">${IC.hand}<span class="lbl">Take control</span></button>
  <button class="bw-ib" data-a="kbd" title="Keyboard" aria-label="Show keyboard">${IC.kbd}</button>
  <button class="bw-ib" data-a="activity" title="Activity" aria-label="Activity">${IC.list}</button>
  <button class="bw-ib" data-a="max" title="Full screen" aria-label="Full screen">${IC.max}</button>
</div>
<div class="bw-bar"><div class="bw-tabs" role="tablist"></div><button class="bw-ib" data-a="newtab" title="New tab" aria-label="New tab">${IC.plus}</button></div>
<div class="bw-body">
  <div class="bw-stage">
    <canvas class="bw-canvas" tabindex="-1" aria-label="Live browser"></canvas>
    <input class="bw-kbd" type="text" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" aria-hidden="true">
    <div class="bw-msg"><div><b>Starting Chrome…</b><span class="sub">The hub browser opens on demand.</span></div></div>
    <div class="bw-banner" hidden></div>
    <div class="bw-live" hidden></div>
  </div>
  <aside class="bw-act" hidden><h4>Activity</h4><ol></ol></aside>
</div>`
    S.canvas = root.querySelector('.bw-canvas')
    S.ctx = S.canvas.getContext('2d')
    S.canvas.width = 1280
    S.canvas.height = 800
    wire(root)
    return root
  }

  function mount() {
    const host = document.getElementById('bw-host')
    if (!host) return
    if (!S.root) S.root = build()
    if (S.root.parentElement !== host) host.append(S.root)
    S.detachedAt = 0
    connect()
    paint()
  }

  // Leaving the tab (or hiding the page) closes the stream after a moment, so Chrome can idle out.
  setInterval(() => {
    const on = S.root?.isConnected && document.visibilityState === 'visible'
    if (on) { S.detachedAt = 0; return }
    if (!S.detachedAt) S.detachedAt = Date.now()
    else if (Date.now() - S.detachedAt > 3000) disconnect()
    S.frames = S.frames.filter(t => Date.now() - t < 1000)
  }, 1000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.root?.isConnected) connect() })

  /* ---------- stream ---------- */

  function connect() {
    if (S.es || !S.profile) return
    const es = (S.es = new EventSource(`/api/browser/stream?profile=${encodeURIComponent(S.profile)}`))
    es.addEventListener('state', e => {
      S.st = JSON.parse(e.data)
      S.err = ''
      if (S.st.running === false) { disconnect(); S.st = null; S.err = 'off' }
      paint()
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
      paint()
    }
  }
  function disconnect() {
    S.es?.close()
    S.es = null
  }
  function restart() { disconnect(); S.st = null; S.log = []; S.frame = null; connect(); paint() }

  function onFrame(f) {
    S.meta = f.meta || S.meta
    S.frames.push(Date.now())
    S.pending = f.jpg
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
        S.drawn = true
        for (const m of minis) m.draw(b64)
      } catch {}
    }
    S.decoding = false
    paintLive()
  }

  /* ---------- painting the chrome around the stream ---------- */

  const PROF_COLOR = Object.fromEntries(Object.keys(window.HUB_CONF?.browser?.profiles || {}).map((id, i) => [id, ['var(--blue)', 'var(--indigo)', 'var(--green)', 'var(--orange)'][i % 4]]))
  function paint() {
    const r = S.root
    if (!r) return
    const st = S.st
    const mine = st?.controller === 'owner'
    r.classList.toggle('agent', !mine)
    r.querySelector('[data-a=back]').disabled = !st?.canBack
    r.querySelector('[data-a=forward]').disabled = !st?.canForward
    const input = r.querySelector('.bw-url input')
    if (document.activeElement !== input) input.value = st?.url && st.url !== 'about:blank' ? st.url : ''
    r.querySelector('.bw-url .ic').innerHTML = /^https:/.test(st?.url || '') ? IC.lock : IC.globe
    const prof = S.status?.profiles?.find(p => p.id === S.profile)
    const pb = r.querySelector('.prof')
    pb.style.setProperty('--c', PROF_COLOR[S.profile] || 'var(--blue)')
    pb.querySelector('.av').textContent = (prof?.label || S.profile || '?')[0].toUpperCase()
    pb.querySelector('.lbl').textContent = prof?.label || S.profile
    pb.title = prof ? `${prof.label} (${prof.email})` : 'Profile'
    const ctl = r.querySelector('.ctl')
    ctl.classList.toggle('give', mine)
    ctl.innerHTML = mine ? `${IC.bot}<span class="lbl">Give back to agent</span>` : `${IC.hand}<span class="lbl">Take control</span>`
    ctl.title = mine ? 'You have control. Give it back to the agent' : 'Take control from the agent'
    r.querySelector('[data-a=max]').innerHTML = S.max ? IC.min : IC.max
    r.querySelector('.bw-stage').classList.toggle('fitmode', st?.size?.mode === 'fit')
    // tabs
    const tabs = r.querySelector('.bw-tabs')
    const sig = JSON.stringify([st?.tabs, st?.active])
    if (tabs._sig !== sig) {
      tabs._sig = sig
      tabs.innerHTML = (st?.tabs || []).map(t => `<button class="bw-tab${t.id === st.active ? ' on' : ''}" role="tab" aria-selected="${t.id === st.active}" data-tab="${escH(t.id)}" title="${escH(t.url)}"><span>${escH(t.title || t.url || 'New tab')}</span><i data-close="${escH(t.id)}" aria-label="Close tab">${IC.x}</i></button>`).join('')
      const on = tabs.querySelector('.on') // scroll the strip only, never the page
      if (on && (on.offsetLeft < tabs.scrollLeft || on.offsetLeft + on.offsetWidth > tabs.scrollLeft + tabs.clientWidth)) tabs.scrollLeft = on.offsetLeft - 8
    }
    // message over the stage
    const msg = r.querySelector('.bw-msg')
    const off = S.err === 'off'
    msg.hidden = !!(st && S.drawn) && !off
    msg.innerHTML = off
      ? `<div><b>The browser is closed</b><span class="sub">${escH(prof?.label || S.profile)} keeps its sign-ins. Chrome closes itself after ${S.status?.idleMinutes || 15} minutes unused.</span><br><button class="bw-btn" data-a="start">Open browser</button></div>`
      : S.err === 'reconnecting' ? '<div><b>Reconnecting…</b><span class="sub">The hub is restarting or the link dropped.</span></div>'
      : '<div><b>Starting Chrome…</b><span class="sub">The hub browser opens on demand.</span></div>'
    // banner: dialog > the agent's ask > the agent is working
    const ban = r.querySelector('.bw-banner')
    let html = '', cls = ''
    if (st?.dialog) {
      html = `<span class="dot"></span><span class="t">${escH(st.dialog.message || st.dialog.type)}</span><button class="bw-btn sec" data-a="dlg-no">Cancel</button><button class="bw-btn" data-a="dlg-yes">OK</button>`
      cls = 'ask'
    } else if (mine && st?.ask) {
      html = `<span class="dot"></span><span class="t"><b>Agent:</b> ${escH(st.ask)}</span><button class="bw-btn" data-a="giveback">Done</button>`
      cls = 'ask'
    } else if (!mine && st && Date.now() - (st.agentAt || 0) < 20e3) {
      html = `<span class="dot"></span><span class="t">The agent is working</span><button class="bw-btn" data-a="take">Take control</button>`
    }
    ban.hidden = !html
    ban.className = `bw-banner ${cls}`
    if (ban._html !== html) { ban._html = html; ban.innerHTML = html }
    paintLive()
  }
  // The agent banner fades 20 s after its last step without a new state push.
  setInterval(() => S.root?.isConnected && S.st && paint(), 5000)

  function paintLive() {
    const el = S.root?.querySelector('.bw-live')
    if (!el) return
    const fps = S.frames.filter(t => Date.now() - t < 1000).length
    el.hidden = !S.st
    el.textContent = `${S.st?.controller === 'owner' ? 'You' : 'Agent'} · ${fps} fps · q${S.st?.quality ?? ''}`
  }

  const WHO = { agent: IC.bot, owner: IC.hand, hub: IC.shield }
  function paintLog() {
    const box = S.root?.querySelector('.bw-act')
    if (!box) return
    box.hidden = !S.actOpen
    const ol = box.querySelector('ol')
    const rows = S.log.filter(e => e.profile === S.profile).slice(-60).reverse()
    const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }
    ol.innerHTML = rows.length ? rows.map((e, i) => `<li class="${e.act === 'refused' ? 'refused' : e.who}" data-hay="${escH(`${e.act} ${e.detail} ${e.url}`.toLowerCase())}"><span class="w">${WHO[e.who] || IC.shield}</span><div class="m"><div class="d"><b>${escH(e.act)}</b> ${escH(e.detail)}</div><div class="s">${escH(ago(e.at))}${e.url ? ` · ${escH(e.url.replace(/^https?:\/\//, ''))}` : ''}</div>${e.shot && i < 6 ? `<img loading="lazy" src="${escH(e.shot)}" alt="">` : ''}</div></li>`).join('') : '<div class="empty">Nothing yet. When the hub assistant uses the browser, each step shows here with a screenshot.</div>'
  }

  /* ---------- actions ---------- */

  async function act(body) {
    try { return await post('/api/browser/act', { profile: S.profile, ...body }) } catch (e) { toast(e.message); throw e }
  }

  function profileMenu(x, y) {
    const items = (S.status?.profiles || []).map(p => ({ label: `${p.label} · ${p.email}`, icon: p.id === S.profile ? IC.check : '', run: () => switchProfile(p.id) }))
    const mode = S.st?.mode || S.status?.profiles?.find(p => p.id === S.profile)?.mode
    const fit = S.st?.size?.mode === 'fit'
    items.push('-',
      { label: fit ? 'Desktop size (1280×800)' : 'Fit to this screen', icon: fit ? IC.monitor : IC.phone, run: () => setFit(!fit) },
      { label: mode === 'headed' ? 'Run hidden (headless)' : 'Show window on the laptop', icon: IC.eye, run: () => act({ act: 'mode', mode: mode === 'headed' ? 'headless' : 'headed' }).then(() => setTimeout(restart, 600)) },
      { label: 'Close browser', icon: IC.power, danger: true, run: () => act({ act: 'close' }).then(() => { disconnect(); S.st = null; S.err = 'off'; S.drawn = false; paint() }) })
    if (typeof showMenu === 'function') showMenu(x, y, 'Chrome profile', items)
  }

  function switchProfile(id) {
    if (id === S.profile) return
    S.profile = id
    try { localStorage.setItem('hub-browser-profile', id) } catch {}
    post('/api/browser/act', { act: 'profile', to: id }).catch(() => {})
    S.drawn = false
    S.err = ''
    restart()
  }

  function stageSize() {
    const st = S.root.querySelector('.bw-stage')
    return { w: Math.round(st.clientWidth), h: Math.round(st.clientHeight) }
  }
  function setFit(on) {
    S.fit = on
    act(on ? { act: 'size', mode: 'fit', ...stageSize() } : { act: 'size', mode: 'desktop' }).catch(() => {})
  }

  async function toggleMax() {
    const r = S.root
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement
    if (fsEl) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return }
    if (S.max) { S.max = false; r.classList.remove('max'); paint(); return }
    const req = r.requestFullscreen || r.webkitRequestFullscreen
    try { if (req) { await req.call(r); return } } catch {}
    S.max = true // iPhone Safari has no element full screen: fill the window instead
    r.classList.add('max')
    paint()
  }
  document.addEventListener('fullscreenchange', () => { S.max = !!document.fullscreenElement && document.fullscreenElement === S.root; paint() })
  document.addEventListener('webkitfullscreenchange', () => { S.max = document.webkitFullscreenElement === S.root; paint() })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.max && !document.fullscreenElement) { S.max = false; S.root.classList.remove('max'); paint() } })

  /* ---------- Your input ---------- */

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
    const isOwner = () => S.st?.controller === 'owner'
    const takeIfQuiet = () => !isOwner() && S.st && Date.now() - (S.st.agentAt || 0) > 20e3

    root.addEventListener('click', e => {
      const b = e.target.closest('[data-a],[data-tab],[data-close]')
      if (!b) return
      if (b.dataset.close) { e.stopPropagation(); return act({ act: 'tab_close', id: b.dataset.close }).catch(() => {}) }
      if (b.dataset.tab) return b.classList.contains('on') || act({ act: 'tab_select', id: b.dataset.tab }).catch(() => {})
      const a = b.dataset.a
      if (a === 'back' || a === 'forward' || a === 'reload') return act({ act: a }).catch(() => {})
      if (a === 'newtab') return act({ act: 'tab_new' }).then(() => root.querySelector('.bw-url input').focus()).catch(() => {})
      if (a === 'profile') { const r = b.getBoundingClientRect(); return profileMenu(r.left, r.bottom + 6) }
      if (a === 'control' || a === 'take' || a === 'giveback') {
        const to = a === 'take' ? 'owner' : a === 'giveback' ? 'agent' : isOwner() ? 'agent' : 'owner'
        return act({ act: 'control', to }).then(() => { if (to === 'owner' && S.fit) setFit(true) }).catch(() => {})
      }
      if (a === 'kbd') { kbd.style.pointerEvents = 'auto'; kbd.focus(); kbd.style.pointerEvents = ''; return }
      if (a === 'activity') { S.actOpen = !S.actOpen; try { localStorage.setItem('hub-browser-activity', S.actOpen ? '1' : '0') } catch {}; return paintLog() }
      if (a === 'max') return toggleMax()
      if (a === 'start') { S.err = ''; S.drawn = false; return restart() }
      if (a === 'dlg-yes' || a === 'dlg-no') return act({ act: 'dialog', accept: a === 'dlg-yes' }).catch(() => {})
    })
    root.querySelector('.bw-url').addEventListener('submit', e => {
      e.preventDefault()
      const input = e.target.querySelector('input')
      const url = input.value.trim()
      if (!url) return
      input.blur()
      act({ act: 'open', url }).catch(() => {})
    })
    root.querySelector('.bw-url input').addEventListener('focus', e => setTimeout(() => e.target.select(), 0))
    root.querySelector('.bw-url input').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.target.blur(); paint() } })

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

    // Fit mode follows the stage size when it changes (rotate the iPad, resize the window).
    let rt = 0
    new ResizeObserver(() => {
      if (!S.fit || S.st?.size?.mode !== 'fit' || !isOwner()) return
      clearTimeout(rt)
      rt = setTimeout(() => { const s = stageSize(); if (Math.abs(s.w - S.st.size.w) > 8 || Math.abs(s.h - S.st.size.h) > 8) setFit(true) }, 400)
    }).observe(root.querySelector('.bw-stage'))
  }

  /* ---------- mini live views for chat ---------- */

  const minis = new Set()
  window.HubBrowser = {
    open() { if (typeof setEnv === 'function') setEnv('browser') },
    shotUrl: e => (e && e.shot) || '',
    // A small live view inside any element (the chat card). Uses this page's stream when the Browser
    // tab is open, otherwise its own low-cost stream. Click opens the Browser tab.
    mini(el, opts = {}) {
      const cv = document.createElement('canvas')
      cv.style.cssText = 'display:block;width:100%;height:auto;border-radius:10px;background:#111;cursor:pointer;box-shadow:0 0 0 .5px var(--sep)'
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
        close() { minis.delete(m); own?.close(); cv.remove() },
      }
      cv.addEventListener('click', () => window.HubBrowser.open())
      minis.add(m)
      let own = null
      if (!S.es) {
        own = new EventSource(`/api/browser/stream?profile=${encodeURIComponent(opts.profile || S.profile || '')}`)
        own.addEventListener('frame', e => { if (!S.es) m.draw(JSON.parse(e.data).jpg) })
      }
      return m
    },
  }

  /* ---------- tab ---------- */

  ;(window.TABS ||= {}).browser = {
    title: 'Browser',
    search: 'Filter activity',
    persistent: true, // index.html renders once and then only calls refresh(), so the canvas and stream stay
    refresh() { if (S.root?.isConnected) paint() },
    render() {
      queueMicrotask(mount)
      return PLACEHOLDER
    },
    async load() {
      try {
        S.status = await (await fetch('/api/browser/status', { cache: 'no-store' })).json()
        if (!S.profile || !S.status.profiles.some(p => p.id === S.profile)) S.profile = S.status.current
      } catch {}
      if (S.root?.isConnected) { connect(); paint() }
    },
    ago() {
      if (!S.st) return ''
      return S.st.controller === 'owner' ? 'You have control' : Date.now() - (S.st.agentAt || 0) < 20e3 ? 'Agent working' : 'Live'
    },
  }
})()
