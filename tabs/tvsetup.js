// "Set up a TV": one sheet that gets LocalHub TV onto a television and keeps it connected.
//   1. Install the app on the TV (the newest release's LocalHub-TV.apk, through Downloader).
//   2. Let TVs on this network find LocalHub (the home-network address, behind the passcode).
//   3. Pair: a code from /api/pair/start, typed on the TV; paired TVs listed, each removable.
// It also opens the TV here on this computer. Opens from the Home TV tile, from /#tv-setup, and
// from LocalHub TV's own Control Center on this computer. window.HubTVSetup.open() / .close().
;(() => {
  if (window.HubTVSetup) return
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify(body || {}) })
  const ago = t => {
    if (!t) return 'not yet'
    const s = Math.max(0, (Date.now() - t) / 1000)
    return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`
  }

  const css = `
  .tvs-veil { position: fixed; inset: 0; z-index: 9100; display: grid; place-items: center; padding: 16px; background: rgba(8, 10, 16, .5); -webkit-backdrop-filter: blur(22px) saturate(1.4); backdrop-filter: blur(22px) saturate(1.4); font: 15px/1.45 Inter, system-ui, sans-serif; animation: tvs-in .3s cubic-bezier(.32,.72,0,1); }
  @keyframes tvs-in { from { opacity: 0; } }
  .tvs-card { width: min(560px, 100%); height: min(760px, calc(100dvh - 32px)); display: flex; flex-direction: column; overflow: hidden; border-radius: 24px; color: var(--label, #111);
    background: color-mix(in srgb, var(--surface, #fff) 86%, transparent); border: 1px solid rgba(255,255,255,.22); box-shadow: 0 24px 70px rgba(0,0,0,.4); }
  .tvs-head { flex: none; display: flex; align-items: center; gap: 14px; padding: 20px 22px 16px; border-bottom: 1px solid color-mix(in srgb, var(--label, #000) 8%, transparent); }
  .tvs-head img { width: 44px; height: 44px; border-radius: 11px; }
  .tvs-head h1 { flex: 1; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -.02em; }
  .tvs-head h1 small { display: block; font-size: 13px; font-weight: 500; color: var(--label-2, #6b6b72); letter-spacing: 0; }
  .tvs-x { width: 32px; height: 32px; border: 0; border-radius: 50%; cursor: pointer; font-size: 18px; line-height: 1; color: var(--label-2, #6b6b72); background: var(--surface-2, #f2f2f7); }
  .tvs-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 18px 22px 22px; --thumb: color-mix(in srgb, var(--label, #000) 22%, transparent); }
  @supports selector(::-webkit-scrollbar) {
    .tvs-body::-webkit-scrollbar { width: 14px; } .tvs-body::-webkit-scrollbar-track { background: transparent; margin: 10px 0; }
    .tvs-body::-webkit-scrollbar-thumb { border: 5px solid transparent; border-radius: 10px; background: var(--thumb) padding-box; } .tvs-body::-webkit-scrollbar-button { display: none; }
  }
  @supports not selector(::-webkit-scrollbar) { .tvs-body { scrollbar-width: thin; scrollbar-color: var(--thumb) transparent; } }
  .tvs-open { display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px 16px; margin-bottom: 18px; border: 0; border-radius: 14px; cursor: pointer; text-align: left; font: inherit; color: #fff; background: var(--blue, #0a84ff); }
  .tvs-open b { display: block; font-size: 16px; } .tvs-open span { flex: 1; } .tvs-open small { opacity: .85; }
  .tvs-sec { padding: 16px; margin-bottom: 12px; border-radius: 16px; background: var(--surface-2, #f2f2f7); }
  .tvs-sec h2 { display: flex; align-items: center; gap: 10px; margin: 0 0 8px; font-size: 16px; font-weight: 700; letter-spacing: -.01em; }
  .tvs-n { display: grid; place-items: center; width: 24px; height: 24px; flex: none; border-radius: 50%; font-size: 13px; color: #fff; background: var(--label-2, #8e8e93); }
  .tvs-sec.done .tvs-n { background: var(--green, #34c759); }
  .tvs-sec p, .tvs-sec li { margin: 0 0 8px; color: var(--label-2, #6b6b72); }
  .tvs-sec ol { margin: 0 0 10px; padding-left: 20px; }
  .tvs-sec b { color: var(--label, #111); font-weight: 600; }
  .tvs-link { display: flex; gap: 14px; align-items: center; }
  .tvs-qr { width: 112px; flex: none; border-radius: 10px; background: #fff; padding: 2px; } .tvs-qr svg { display: block; width: 100%; height: auto; }
  .tvs-url { font: 13px/1.4 ui-monospace, Menlo, Consolas, monospace; word-break: break-all; color: var(--label, #111); user-select: all; }
  .tvs-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .tvs-btn { padding: 9px 16px; border: 0; border-radius: 11px; cursor: pointer; font: 600 14px Inter, system-ui, sans-serif; color: #fff; background: var(--blue, #0a84ff); }
  .tvs-btn.plain { color: var(--label, #111); background: var(--surface, #fff); }
  .tvs-btn:disabled { opacity: .5; cursor: default; }
  .tvs-pill { display: inline-flex; align-items: center; gap: 7px; font-weight: 600; }
  .tvs-pill i { width: 9px; height: 9px; border-radius: 50%; background: var(--c, #8e8e93); }
  .tvs-input { flex: 1; min-width: 160px; padding: 9px 12px; border: 1px solid transparent; border-radius: 10px; font: 15px Inter, system-ui, sans-serif; color: inherit; background: var(--surface, #fff); outline: none; }
  .tvs-input:focus { border-color: var(--blue, #0a84ff); }
  .tvs-code { margin: 8px 0 6px; font: 700 34px/1.1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .14em; color: var(--label, #111); }
  .tvs-tvs { margin-top: 10px; display: grid; gap: 6px; }
  .tvs-tv { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--surface, #fff); }
  .tvs-tv span { flex: 1; } .tvs-tv small { display: block; color: var(--label-2, #6b6b72); }
  .tvs-err { color: var(--red, #ff3b30); min-height: 1.2em; margin-top: 6px; font-size: 14px; }`

  let root = null, card = null, timer = null, state = null, devices = [], code = null, error = ''

  async function load() {
    try { state = await (await fetch('/api/tv/setup', { cache: 'no-store' })).json() } catch { state = null }
    try { devices = ((await (await fetch('/api/pair/devices', { cache: 'no-store' })).json()).devices || []).filter(d => d.platform === 'tv') } catch { devices = [] }
  }

  function paint() {
    if (!card) return
    if (!state || state.error) {
      card.querySelector('.tvs-body').innerHTML = `<p>${esc(state?.error || 'A TV is set up from the computer running LocalHub.')}</p>`
      return
    }
    const lan = state.lan, pass = state.passcode
    const needPass = pass.needed && !pass.set
    const left = code ? Math.max(0, Math.round((code.expires - Date.now()) / 1000)) : 0
    if (code && !left) code = null
    card.querySelector('.tvs-body').innerHTML = `
      <button class="tvs-open" data-tvs="open"><span><b>Open LocalHub TV here</b><small>Full screen on this computer. The keyboard is the remote.</small></span>›</button>
      <div class="tvs-sec${devices.length ? ' done' : ''}"><h2><span class="tvs-n">1</span>Put the app on the TV</h2>
        <ol><li>On a Fire TV: <b>Settings → My Fire TV → Developer options</b>, and turn on <b>Install unknown apps</b> for <b>Downloader</b> (free, from the Appstore).</li>
        <li>In Downloader, type this address and install <b>LocalHub TV</b>.</li>
        <li>On Google TV or Android TV, do the same with Downloader from Google Play.</li></ol>
        <div class="tvs-link"><div class="tvs-qr">${state.app.qrSvg}</div><div class="tvs-url">${esc(state.app.url)}</div></div></div>
      <div class="tvs-sec${lan.on ? ' done' : ''}"><h2><span class="tvs-n">2</span>Let the TV find LocalHub</h2>
        <p>The TV looks for LocalHub on your home network. It stays off the internet, and anything on the network other than a paired TV needs the passcode.</p>
        ${needPass ? `<p><b>First, a passcode</b> (at least 8 characters).</p><div class="tvs-row"><input class="tvs-input" type="password" data-tvs="pass" placeholder="Passcode" autocomplete="new-password"><button class="tvs-btn" data-tvs="setpass">Set</button></div>` : ''}
        <div class="tvs-row" style="margin-top:${needPass ? 12 : 4}px">
          <span class="tvs-pill" style="--c:${lan.on ? 'var(--green, #34c759)' : '#8e8e93'}"><i></i>${lan.on ? `On at ${esc(lan.address)}:${lan.port}` : lan.found ? 'Off' : 'No home network'}</span>
          <span style="flex:1"></span>
          <button class="tvs-btn${lan.on ? ' plain' : ''}" data-tvs="lan" ${(!lan.found || (needPass && !lan.on)) ? 'disabled' : ''}>${lan.on ? 'Turn off' : 'Turn on'}</button></div>
        ${lan.on ? '<p style="margin-top:10px">If Windows asks whether Node.js may use the network, allow it on private networks.</p>' : ''}</div>
      <div class="tvs-sec${devices.length ? ' done' : ''}"><h2><span class="tvs-n">3</span>Pair the TV</h2>
        ${code ? `<p>On the TV, open LocalHub TV, choose <b>Pair</b> and type:</p><div class="tvs-code">${esc(code.code.replace(/(.{4})/, '$1 '))}</div><p>This code works for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} more.</p>`
          : `<p>${lan.on ? 'When the TV says it found LocalHub, show a code and type it on the TV.' : 'Turn on step 2 first, so the TV can find LocalHub.'}</p>`}
        <div class="tvs-row"><button class="tvs-btn${code ? ' plain' : ''}" data-tvs="code" ${lan.on ? '' : 'disabled'}>${code ? 'New code' : 'Show a pairing code'}</button></div>
        ${devices.length ? `<div class="tvs-tvs">${devices.map(d => `<div class="tvs-tv"><span>${esc(d.name || 'TV')}<small>Paired ${esc(ago(d.created))} · seen ${esc(ago(d.lastSeen))}</small></span><button class="tvs-btn plain" data-tvs="forget" data-id="${esc(d.id)}">Remove</button></div>`).join('')}</div>` : ''}</div>
      <div class="tvs-err" role="alert">${esc(error)}</div>`
  }

  async function act(what, el) {
    error = ''
    try {
      if (what === 'open') { window.open('/tv/', 'localhub-tv'); return }
      if (what === 'setpass') {
        const v = card.querySelector('[data-tvs=pass]').value
        const r = await post('/api/hub/passcode', { passcode: v })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'That passcode was not saved')
      }
      if (what === 'lan') {
        const r = await post('/api/tv/setup/lan', { on: !state.lan.on })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'That did not work')
        state = j
      }
      if (what === 'code') {
        const r = await post('/api/pair/start')
        if (!r.ok) throw new Error('No code came back')
        code = await r.json()
      }
      if (what === 'forget') {
        const r = await post(`/api/pair/devices/${encodeURIComponent(el.dataset.id)}/remove`)
        if (!r.ok) throw new Error('That TV was not removed')
      }
    } catch (e) { error = e.message }
    await load()
    paint()
  }

  function open() {
    if (root) return
    if (!document.getElementById('tvs-style')) { const st = document.createElement('style'); st.id = 'tvs-style'; st.textContent = css; document.head.append(st) }
    root = document.createElement('div')
    root.className = 'tvs-veil'
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-label', 'Set up a TV')
    root.innerHTML = `<div class="tvs-card"><div class="tvs-head"><img src="/icons/hub.svg" alt=""><h1>LocalHub TV<small>Set up a TV</small></h1><button class="tvs-x" data-tvs="close" aria-label="Close">✕</button></div><div class="tvs-body"><p>Loading…</p></div></div>`
    card = root.firstChild
    document.body.append(root)
    root.addEventListener('click', e => {
      if (e.target === root) return close()
      const b = e.target.closest('[data-tvs]')
      if (!b || b.disabled) return
      if (b.dataset.tvs === 'close') return close()
      if (b.dataset.tvs !== 'pass') act(b.dataset.tvs, b)
    })
    root.addEventListener('keydown', e => {
      if (e.key === 'Escape') close()
      if (e.key === 'Enter' && e.target.matches('[data-tvs=pass]')) act('setpass')
    })
    load().then(paint)
    // While it's open: the code's countdown, and a TV showing up once it pairs.
    let n = 0
    timer = setInterval(async () => { if (++n % 4 === 0) await load(); if (!card.contains(document.activeElement) || !document.activeElement.matches('input')) paint() }, 1000)
  }

  function close() {
    clearInterval(timer)
    root?.remove()
    root = card = null
    code = null
    if (location.hash === '#tv-setup') history.replaceState(null, '', location.pathname + location.search)
  }

  window.HubTVSetup = { open, close }
  const fromHash = () => { if (location.hash === '#tv-setup') open() }
  addEventListener('hashchange', fromHash)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fromHash)
  else fromHash()
})()
