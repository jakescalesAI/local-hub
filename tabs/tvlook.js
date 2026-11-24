// The TV's look on a computer: the photo wallpaper, the sidebar, the big clock, the weather, round buttons and solid
// dark cards (tv/ui/styles.css is where they come from). custom.js puts data-tvlook on <html> when the window is wide,
// has a mouse and Edit Style isn't set to Light; everything here hangs off that, so a phone, an iPad or Light is as before.
;(() => {
  const R = 'html[data-tvlook]'
  const css = document.createElement('style')
  css.textContent = `
#tvrail, #tvtop { display: none; }
${R} { --ui-fill: #26272d; --ui-edge: inset 0 0 0 1px rgba(255, 255, 255, .1); --ui-panel: #1c1d22; --ui-sel: #f2f2f5; --tvrail: 92px; scrollbar-gutter: auto; }
${R} #hub-wall::after { background: linear-gradient(90deg, rgba(0, 0, 0, .35), rgba(0, 0, 0, .08) 60%), rgba(0, 0, 0, .18); opacity: 1; }
${R}:not([data-wall]) body { background: #0b0b0e; }
${R} .page { max-width: 1500px; padding-left: calc(var(--tvrail) + 48px); padding-right: 48px; }
${R} .nav { pointer-events: none; }
${R} .nav-in { max-width: 1500px; padding-left: calc(var(--tvrail) + 48px); padding-right: 48px; }
${R} .nav-in button { pointer-events: auto; }
${R} .bar-btn { color: #fff; }

${R} #tvrail { position: fixed; z-index: 12; left: 0; top: 0; bottom: 0; width: var(--tvrail); display: flex; flex-direction: column; align-items: center; padding: 26px 0; background: rgba(17, 18, 22, .86); border-radius: 0 26px 26px 0; box-shadow: inset -1px 0 0 rgba(255, 255, 255, .1); color: #fff; }
${R} #tvrail img { width: 44px; height: 44px; border-radius: 12px; }
${R} #tvrail .mid { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 10px; }
${R} #tvrail button { position: relative; width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; color: rgba(255, 255, 255, .72); transition: background .15s, color .15s; }
${R} #tvrail svg { width: 27px; height: 27px; }
${R} #tvrail button:hover { background: var(--ui-fill); color: #fff; }
${R} #tvrail button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
${R} #tvrail button.on { color: #fff; }
${R} #tvrail button.on::after { content: ""; position: absolute; bottom: 3px; width: 26px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, .5); }
${R} #tvrail button span { position: absolute; left: 66px; padding: 7px 14px; border-radius: 99px; background: var(--ui-panel); box-shadow: var(--ui-edge); font-size: 14px; font-weight: 600; white-space: nowrap; opacity: 0; pointer-events: none; transform: translateX(-4px); transition: opacity .15s, transform .15s; }
${R} #tvrail button:hover span, ${R} #tvrail button:focus-visible span { opacity: 1; transform: none; }

${R} #seg-scroll { display: none; }
${R} .large-title { font-size: 52px; font-weight: 700; letter-spacing: -.03em; line-height: 1.1; }
${R}:has(.hw-root) .head, ${R}:has(.hw-root) .nav { display: none; }
${R}:has(.hw-root) #tvtop { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-top: 30px; margin-bottom: 20px; min-height: 150px; color: #fff; }
${R} .tvt-clock { font: 700 76px/1 var(--display); letter-spacing: -.035em; font-variant-numeric: tabular-nums; white-space: nowrap; }
${R} .tvt-date { margin-top: 10px; font: 600 24px/1.2 var(--display); color: rgba(255, 255, 255, .9); }
${R} .tvt-wx { width: 380px; padding: 18px 22px; border-radius: 26px; background: var(--ui-panel); box-shadow: var(--ui-edge); }
${R} .tvt-wx .wxw { font-size: 13px; }
${R} .tvt-wx:empty { display: none; }

${R} .controls { margin-bottom: 20px; top: 12px; }
/* Home: search and the view buttons share one row, as on the TV. */
${R} .page:has(.hw-root) .search { flex: 0 1 420px; }
${R} .hw-root > .hw-bar { margin: -69px 0 20px 440px; height: 49px; position: relative; z-index: 12; flex-wrap: nowrap; }
/* Editing needs the whole width for its buttons. */
${R} .hw-root:is(.hw-edit, :has(.hw-edit)) > .hw-bar { margin: 0 0 20px; height: auto; flex-wrap: wrap; }
@media (max-width: 1250px) { ${R} .page:has(.hw-root) .search { flex-basis: 280px; } ${R} .hw-root:not(.hw-edit) > .hw-bar { margin-left: 300px; } ${R}:has(.hw-root) #tvtop { padding-top: 20px; margin-bottom: 14px; } }
${R} .search { max-width: 520px; }
${R} .search input { height: 56px; padding: 0 44px 0 26px; border-radius: 28px; background: var(--ui-fill) !important; box-shadow: var(--ui-edge); font-size: 18px; font-weight: 600; -webkit-backdrop-filter: none; backdrop-filter: none; }
${R} .search input:focus { box-shadow: 0 0 0 3px #fff; }
${R} .search .clear { right: 18px; }
${R} .seg, ${R} .seg.hw-seg { background: var(--ui-fill) !important; box-shadow: var(--ui-edge); border-radius: 99px; padding: 4px; -webkit-backdrop-filter: none; backdrop-filter: none; }
${R} .seg-thumb { top: 4px; bottom: 4px; left: 4px; width: calc((100% - 8px) / var(--n, 3)); border-radius: 99px; background: var(--ui-sel); }
${R} .seg button { height: 34px; border-radius: 99px; font-size: 14px; font-weight: 600; }
${R} .seg button:is([aria-pressed="true"], [aria-selected="true"], [aria-checked="true"], [aria-current], .on) { color: #000; }
${R} .hw-bar .hw-btn:not(.solid), ${R} .hw-btn, ${R} .hw-pill { height: 42px; padding: 0 20px; border-radius: 99px; background: var(--ui-fill); box-shadow: var(--ui-edge); color: #fff; -webkit-backdrop-filter: none; backdrop-filter: none; }
${R} .hw-bar .hw-btn:not(.solid):hover, ${R} .hw-pill:hover { background: var(--ui-sel); color: #000; }
${R} .hw-btn.solid { background: var(--ui-sel); color: #000; }
${R} .hw-btn.red { color: var(--red) !important; }

${R} :is(.hw-card, .widget, .list, .hw-page) { background: var(--ui-panel) !important; box-shadow: var(--ui-edge) !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
${R} :is(.hw-card, .widget) { border-radius: 26px; }
${R} .list { border-radius: 22px; }
${R} .hw-page[aria-selected="true"] { background: var(--ui-sel) !important; color: #000; }
${R} .hw-card.live:hover { transform: scale(1.03); }
${R} .hw-app-b > .hc-app { width: 100% !important; max-width: 148px; height: 84px !important; border-radius: 18px !important; background: var(--ui-fill) !important; color: #fff !important; box-shadow: var(--ui-edge); }
${R} .hw-app-b { transition: transform .2s var(--ease); }
${R} .hw-app-b:hover { transform: scale(1.06); }
${R} .hw-app-b:hover > .hc-app { background: var(--ui-sel) !important; color: #000 !important; }
${R} .hw-app-l { font-weight: 600; text-shadow: 0 1px 4px rgba(0, 0, 0, .7); }
`
  document.head.append(css)

  const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
  const IC = {
    home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h4.5v-5.5h4V20h4.5V9.5"/>',
    files: '<path d="M4 7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
    tab: '<rect x="4" y="4" width="16" height="16" rx="4"/>',
    laptop: '<rect x="4" y="5" width="16" height="11" rx="1.6"/><path d="M2 19h20"/>',
    server: '<rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><path d="M7.5 7.5h.01M7.5 16.5h.01"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>',
    cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 11.6 3.5 3.5 0 0 0 7 18.5z"/>',
    connections: '<path d="M9 3v5M15 3v5M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0zM12 17v4"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    tv: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8 20h8M12 16.5V20"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z"/>',
  }
  const TAB_IC = { home: 'home', drives: 'files', laptop: 'laptop', server: 'server', calendar: 'calendar', cloud: 'cloud', connections: 'connections' }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

  const rail = document.createElement('nav')
  rail.id = 'tvrail'
  rail.setAttribute('aria-label', 'Main')
  document.body.append(rail)
  const top = document.createElement('div')
  top.id = 'tvtop'
  top.innerHTML = '<div><div class="tvt-clock"></div><div class="tvt-date"></div></div><div class="tvt-wx"></div>'
  document.querySelector('.page').prepend(top)

  // The sidebar follows the tab bar, which stays the one list of tabs (it's hidden, its buttons still work).
  const seg = document.getElementById('seg')
  const isOn = b => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-selected') === 'true' || b.classList.contains('on')
  function paintRail() {
    const tabs = [...seg.querySelectorAll('button[data-env]')].filter(b => !b.hidden && b.style.display !== 'none')
    const item = (key, ic, label, on) => `<button type="button" data-rail="${esc(key)}" class="${on ? 'on' : ''}" aria-label="${esc(label)}"${on ? ' aria-current="page"' : ''}>${svg(IC[ic])}<span>${esc(label)}</span></button>`
    const name = b => (b.firstChild?.textContent || b.textContent).trim()
    const html = '<img src="/icons/hub.svg" alt=""><div class="mid">'
      + tabs.map(b => item(`tab:${b.dataset.env}`, TAB_IC[b.dataset.env] || 'tab', name(b), isOn(b))).join('')
      + item('assistant', 'mic', 'Assistant', false) + item('tv', 'tv', 'TV', false)
      + '</div>' + item('style', 'gear', 'Settings', false)
    if (rail._html === html) return
    rail._html = html
    rail.innerHTML = html
  }
  const goHome = then => {
    seg.querySelector('[data-env="home"]')?.click()
    let tries = 20
    const wait = () => { const el = document.querySelector(then); if (el) el.click(); else if (tries--) setTimeout(wait, 50) }
    wait()
  }
  rail.addEventListener('click', e => {
    const key = e.target.closest('[data-rail]')?.dataset.rail
    if (!key) return
    if (key.startsWith('tab:')) {
      seg.querySelector(`[data-env="${CSS.escape(key.slice(4))}"]`)?.click()
      if (key === 'tab:home') document.querySelector('[data-hw-mode="desktop"]')?.click()
    } else if (key === 'assistant') window.HubChat?.open()
    else if (key === 'tv') goHome('[data-hw-mode="tv"]')
    else if (key === 'style') goHome('[data-hw-act="style"]')
    paintRail()
  })
  new MutationObserver(paintRail).observe(seg, { subtree: true, childList: true, attributes: true, characterData: true })

  function tick() {
    const d = new Date()
    top.querySelector('.tvt-clock').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    top.querySelector('.tvt-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  }
  let wxAt = 0
  async function weather() {
    if (!document.documentElement.hasAttribute('data-tvlook') || document.hidden || Date.now() - wxAt < 15 * 60_000 || !window.HubWeatherCard) return
    wxAt = Date.now()
    try {
      const r = await fetch('/api/tv/weather', { cache: 'no-store' })
      if (r.ok) top.querySelector('.tvt-wx').innerHTML = window.HubWeatherCard(await r.json(), 'm')
    } catch {}
  }
  paintRail()
  tick()
  weather()
  setInterval(() => { tick(); weather() }, 5000)
})()
