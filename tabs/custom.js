// Hub customisation: which tabs show in the header and in what order, the Home apps, the look
// (theme, accent, widget material, radius, depth, tab bar, effects) and the wallpaper.
// Everything is stored on the hub (/api/hub/settings, see hub-settings.mjs and HUB-GUIDE.md
// "Settings API"), cached in localStorage so the page paints in the right style straight away,
// and polled so a change made by the hub assistant shows up on its own.
// Exposes window.HUB = { settings, save(patch), on(fn), visibleTabs(), pluginTabs(), syncTabs(env),
//   apps(), appMeta(id), openApp(id), icon(name, size), openTabs(), openStyle(section),
//   contextMenu(target, x, y), sites(), openSite(url, opts), siteCard(url, opts) }, and
//   window.hub = { openSite, siteCard, embedCheck } for the chat agent (HUB-GUIDE.md "Website apps").
// Loads before tabs/home.js; uses the main script's globals
// (api, setEnv, env, render, showMenu, alertBox, hud) only at call time.
;(() => {
  const CACHE = 'hub-settings'
  const CONF = window.HUB_CONF || {}
  const THEME = CONF.theme || {}
  const BUILTIN = CONF.tabs || ['home', 'drives']
  const PHONE = window.matchMedia('(max-width: 700px)')
  const DARK = window.matchMedia('(prefers-color-scheme: dark)')
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
    laptop: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 20h20"/>',
    server: '<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
    drives: '<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01M10 16h.01"/>',
    ai: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    stripe: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
    plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
    palette: '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.43-.18-.83-.44-1.12-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.56-2.5 5.56-5.55C21.97 6.01 17.46 2 12 2z"/><circle cx="7.5" cy="11.5" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15.5" cy="7.5" r="1.2"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    grip: '<circle cx="9" cy="6" r="1.1"/><circle cx="9" cy="12" r="1.1"/><circle cx="9" cy="18" r="1.1"/><circle cx="15" cy="6" r="1.1"/><circle cx="15" cy="12" r="1.1"/><circle cx="15" cy="18" r="1.1"/>',
    tabs: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v5M15 4v5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    blend: '<circle cx="9" cy="9" r="6.5"/><circle cx="15" cy="15" r="6.5"/>',
    reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    hide: '<path d="M9.9 4.24A9 9 0 0 1 12 4c7 0 10 8 10 8a13.2 13.2 0 0 1-1.67 2.68M6.61 6.61A13.5 13.5 0 0 0 2 12s3 8 10 8a9.7 9.7 0 0 0 5.39-1.61M2 2l20 20"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    reload: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  }
  const icon = (name, size = 18, w = 2) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.plug}</svg>`

  // Labels, icons and app-tile colours (two stops of one hue) for every tab and the Chat app.
  const META = {
    home: { label: 'Home', icon: 'home', tint: ['#8e8e93', '#636366'] },
    laptop: { label: 'Laptop', icon: 'laptop', tint: ['#5ac8fa', '#007aff'] },
    server: { label: 'Server', icon: 'server', tint: ['#5ee08a', '#28a745'] },
    drives: { label: CONF.addons?.drives?.on ? 'Drives' : 'Files', icon: 'drives', tint: ['#a1a1aa', '#5b5b66'] },
    ai: { label: 'AI', icon: 'ai', tint: ['#d38bff', '#7a5af8'] },
    cloud: { label: 'Cloud', icon: 'cloud', tint: ['#7fdcff', '#1c8cff'] },
    calendar: { label: 'Calendar', icon: 'calendar', tint: ['#ff8a65', '#ff3b30'] },
    stripe: { label: 'Stripe', icon: 'stripe', tint: ['#8c84ff', '#5048e5'] },
    chat: { label: 'Chat', icon: 'chat', tint: ['#ffb340', '#ff6a2b'] },
  }
  const appMeta = id => {
    if (META[id]) return META[id]
    const s = siteOf(id)
    if (s) return { label: s.name, icon: 'globe', tint: tintFor(s.name), site: s }
    const g = groupOf(id)
    return g ? { label: g.name, icon: 'grid', tint: ['#a1a1aa', '#636366'], group: g } : { label: window.TABS?.[id]?.title || id, icon: 'plug', tint: ['#a1a1aa', '#636366'] }
  }
  // App groups (folders on Home), saved in settings.groups with ids group-*.
  const groupOf = id => typeof id === 'string' && id.startsWith('group-') ? (S.groups || []).find(g => g.id === id) || null : null

  /* ---------- website apps (saved in settings.sites, ids site-*) ---------- */

  const TINTS = [['#5ac8fa', '#007aff'], ['#5ee08a', '#28a745'], ['#d38bff', '#7a5af8'], ['#ff8a65', '#ff3b30'], ['#8c84ff', '#5048e5'], ['#ffb340', '#ff6a2b'], ['#7fdcff', '#1c8cff'], ['#a1a1aa', '#5b5b66']]
  const hash = t => { let h = 7; for (const c of String(t)) h = (h * 31 + c.codePointAt(0)) | 0; return Math.abs(h) }
  const tintFor = name => TINTS[hash(String(name).toLowerCase()) % TINTS.length]
  const siteOf = id => typeof id === 'string' && id.startsWith('site-') ? (S.sites || []).find(s => s.id === id) || null : null
  // http and https only, no user:password@ (the hub checks the same).
  const webUrl = v => { try { const u = new URL(String(v ?? '').trim()); return /^https?:$/.test(u.protocol) && !u.username && !u.password && u.href.length <= 500 ? u.href : null } catch { return null } }
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }
  const iconSrc = s => `/api/hub/app-icon/${s.id}?v=${hash(`${s.icon || ''} ${s.url}`).toString(36)}`
  const siteIcon = url => `/api/hub/site-icon?url=${encodeURIComponent(url)}`
  // A website's tile: its icon on white, over a letter tile that shows when there is no icon.
  function siteTile(name, src, size = 30, r = 8) {
    const t = tintFor(name), letter = esc((String(name ?? '').trim()[0] || '?').toUpperCase())
    return `<span class="hc-app hc-site" style="--a1:${t[0]};--a2:${t[1]};width:${size}px;height:${size}px;border-radius:${r}px;font-size:${Math.round(size * 0.46)}px"><b>${letter}</b>${src ? `<img class="hc-fav" src="${esc(src)}" alt="" referrerpolicy="no-referrer" decoding="async">` : ''}</span>`
  }
  // An icon that fails drops out so the letter shows; a large one (a touch icon) fills the tile.
  document.addEventListener('error', e => { if (e.target?.classList?.contains('hc-fav')) e.target.remove() }, true)
  document.addEventListener('load', e => { const i = e.target; if (i?.classList?.contains('hc-fav') && i.naturalWidth >= 120) i.classList.add('full') }, true)

  const WALLS = THEME.wallpapers || []
  const ACCENTS = [['system', 'System'], ['#0a84ff', 'Blue'], ['#7a5af8', 'Purple'], ['#ff2d55', 'Pink'], ['#ff3b30', 'Red'], ['#ff9500', 'Orange'], ['#ffcc00', 'Yellow'], ['#34c759', 'Green'], ['#30b0c7', 'Teal'], ['#8e8e93', 'Graphite']]
  const STYLE_DEFAULT = { theme: 'auto', accent: 'system', blur: 20, transparency: 30, radius: 20, shadow: 'soft', effect: 'none', widgetLook: 'glass', tabBar: 'glass', ...THEME.style }
  const DEFAULT = {
    tabs: { order: [...BUILTIN], hidden: [] },
    apps: [...BUILTIN.filter(t => t !== 'home'), 'chat'],
    sites: [],
    groups: [],
    widgets: { desktop: [], mobile: [] },
    style: STYLE_DEFAULT,
    wallpaper: { current: THEME.wallpaper || 'none', custom: [], uploads: [] },
    at: 0,
  }

  let S = DEFAULT
  try { const c = JSON.parse(localStorage.getItem(CACHE)); if (c && c.tabs && c.style) S = { ...DEFAULT, ...c, style: { ...STYLE_DEFAULT, ...c.style } } } catch {}
  const listeners = new Set()
  let preview = null // { style?, wall? } shown while the style panel is being edited

  /* ---------- style (once) ---------- */

  const CARDS = '.widget, .hw-card, .ai-card, .st-card, .st-connect, .cal-card, .cal-connect, .list, .notice'
  const css = `
:root { --hub-radius: 20px; --hub-blur: 20px; --hub-alpha: 70%; --hub-scrim: .45; --hub-shadow: 0 0 0 .5px var(--sep); }
html[data-shadow="soft"] { --hub-shadow: 0 0 0 .5px var(--sep), 0 1px 2px rgba(0, 0, 0, .04), 0 10px 26px -14px rgba(0, 0, 0, .28); }
html[data-shadow="deep"] { --hub-shadow: 0 0 0 .5px var(--sep), 0 2px 6px rgba(0, 0, 0, .06), 0 24px 48px -18px rgba(0, 0, 0, .55); }
.seg button[hidden] { display: none; }
#seg button.hc-peek { opacity: .72; }

#hub-wall { position: fixed; inset: 0; z-index: -1; display: none; background-color: var(--bg); background-position: center; background-size: cover; background-repeat: no-repeat; }
#hub-wall::after { content: ""; position: absolute; inset: 0; background: var(--bg); opacity: var(--hub-scrim); transition: opacity .3s; }
html[data-wall] #hub-wall { display: block; }
html[data-wall], html[data-wall] body { background: transparent; }

html :is(.widget, .hw-card, .ai-card, .st-card, .st-connect, .cal-card, .cal-connect) { border-radius: var(--hub-radius); }
html :is(.list, .notice) { border-radius: calc(var(--hub-radius) * .6); }
html[data-shadow] :is(${CARDS}) { box-shadow: var(--hub-shadow); }
html[data-look="glass"] :is(${CARDS}) { background: color-mix(in srgb, var(--surface) var(--hub-alpha), transparent); -webkit-backdrop-filter: saturate(180%) blur(var(--hub-blur)); backdrop-filter: saturate(180%) blur(var(--hub-blur)); }
html[data-look="outline"] :is(${CARDS}) { background: color-mix(in srgb, var(--surface) 20%, transparent); box-shadow: inset 0 0 0 1.5px var(--sep); }
html[data-effect="glow"] :is(${CARDS}) { box-shadow: var(--hub-shadow), 0 0 0 .5px color-mix(in srgb, var(--blue) 45%, transparent), 0 14px 40px -16px color-mix(in srgb, var(--blue) 60%, transparent); }
html[data-effect="grain"] body::after { content: ""; position: fixed; inset: 0; z-index: 85; pointer-events: none; opacity: .07; mix-blend-mode: overlay; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
html[data-tabbar="glass"] #seg, html[data-tabbar="glass"] .search input { background: color-mix(in srgb, var(--surface) 58%, transparent); -webkit-backdrop-filter: saturate(180%) blur(22px); backdrop-filter: saturate(180%) blur(22px); box-shadow: 0 0 0 .5px var(--sep), 0 8px 22px -14px rgba(0, 0, 0, .35); }
html[data-wall] .nav:not(.scrolled) .bar-btn { text-shadow: none; }
html[data-wall] .hw-bar .hw-btn:not(.solid) { background: color-mix(in srgb, var(--surface) 82%, transparent); -webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px); box-shadow: 0 0 0 .5px var(--sep); }

/* Jump to a tab from the search field (hidden tabs too). */
.hc-jump { position: absolute; z-index: 30; left: 0; right: 0; top: 42px; padding: 5px; border-radius: 13px; background: var(--menu-bg); -webkit-backdrop-filter: saturate(180%) blur(30px); backdrop-filter: saturate(180%) blur(30px); box-shadow: 0 0 0 .5px var(--sep), 0 12px 40px rgba(0, 0, 0, .22); animation: pop .16s var(--ease); }
.hc-jump button { display: flex; width: 100%; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 8px; font-size: 15px; text-align: left; }
.hc-jump button .hc-app { flex: none; width: 26px; height: 26px; border-radius: 7px; }
.hc-jump button span { flex: 1; }
.hc-jump button > svg { color: var(--label-3); }
.hc-jump button.on, .hc-jump button:hover { background: var(--blue); color: #fff; }
.hc-jump button.on > svg, .hc-jump button:hover > svg { color: #fff; }

/* App tile (used by Home apps, the tab editor and search). */
.hc-app { flex: none; display: grid; place-items: center; color: #fff; background: linear-gradient(160deg, var(--a1), var(--a2)); box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .22), 0 1px 2px rgba(0, 0, 0, .12); }
.hc-folder { place-items: stretch; align-content: start; background: rgba(120, 120, 128, .3); -webkit-backdrop-filter: blur(24px) saturate(170%); backdrop-filter: blur(24px) saturate(170%); }
.hc-folder > .hc-app { box-shadow: none; }

/* Website apps: the icon on white over a letter tile. */
.hc-site { position: relative; overflow: hidden; }
.hc-site b { font-family: var(--display); font-weight: 600; letter-spacing: -0.02em; line-height: 1; }
.hc-site .hc-fav { position: absolute; inset: 0; width: 100%; height: 100%; padding: 17%; object-fit: contain; background: #fff; }
.hc-site .hc-fav.full { padding: 0; object-fit: cover; }

/* Website preview: a large sheet with a glass bar (full screen on a phone). */
.scrim.hc-sitescrim { z-index: 77; padding: 24px; background: rgba(0, 0, 0, .34); }
.hc-siteview { width: min(1280px, 100%); height: min(920px, 100%); display: flex; flex-direction: column; border-radius: 18px; overflow: hidden; background: var(--bg); color: var(--label); box-shadow: 0 0 0 .5px var(--sep), 0 30px 80px rgba(0, 0, 0, .4); animation: rise .35s var(--ease); }
.hc-sitebar { flex: none; display: flex; align-items: center; gap: 8px; min-height: 54px; padding: 0 8px 0 14px; background: var(--menu-bg); -webkit-backdrop-filter: saturate(180%) blur(30px); backdrop-filter: saturate(180%) blur(30px); box-shadow: 0 .5px 0 var(--sep); position: relative; z-index: 1; }
.hc-sitebar .hc-app { width: 28px; height: 28px; border-radius: 7px; }
.hc-sitename { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; margin-left: 2px; }
.hc-sitename b { flex: 0 1 auto; max-width: 70%; min-width: 0; font: 600 16px var(--display); letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hc-sitename span { min-width: 0; flex: 1; font-size: 15px; color: var(--label-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hc-ibtn { flex: none; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; color: var(--label); }
.hc-ibtn:hover { background: var(--fill); }
.hc-ibtn:active { opacity: .45; }
.hc-pbtn { flex: none; height: 34px; padding: 0 14px; margin: 0 2px; border-radius: 99px; background: var(--blue); color: #fff; font-size: 15px; font-weight: 600; letter-spacing: -0.016em; display: inline-flex; align-items: center; gap: 6px; text-decoration: none; white-space: nowrap; }
.hc-pbtn:active { opacity: .6; }
.hc-ibtn:focus-visible, .hc-pbtn:focus-visible, .hc-blocked .hc-btn:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.hc-sitebody { position: relative; flex: 1; min-height: 0; background: var(--bg); }
.hc-frame { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
.hc-siteload { position: absolute; inset: 0; display: grid; place-items: center; }
.hc-spin { width: 28px; height: 28px; border-radius: 50%; border: 2.5px solid var(--fill-2); border-top-color: var(--label-2); animation: hc-spin .8s linear infinite; }
@keyframes hc-spin { to { transform: rotate(360deg); } }
.hc-blocked { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 28px 24px; text-align: center; animation: fade .25s; }
.hc-blocked > .hc-app { margin-bottom: 14px; box-shadow: 0 0 0 .5px var(--sep), 0 12px 30px -12px rgba(0, 0, 0, .4); }
.hc-blocked h3 { margin: 0; max-width: 100%; font: 700 26px var(--display); letter-spacing: -0.03em; overflow-wrap: anywhere; }
.hc-blocked p { margin: 0; max-width: 100%; font-size: 17px; letter-spacing: -0.02em; color: var(--label-2); overflow-wrap: anywhere; }
.hc-blocked .hc-btn { flex: none; margin-top: 22px; height: 52px; padding: 0 28px; border-radius: 14px; font-size: 17px; text-decoration: none; }

/* Website card (chat and other pages): a small live frame, or the same card in one row. */
.hc-sitecard { width: 100%; border-radius: 14px; overflow: hidden; background: var(--surface); color: var(--label); box-shadow: 0 0 0 .5px var(--sep); }
.hc-cardbar { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 4px 0 10px; box-shadow: 0 .5px 0 var(--sep); }
.hc-cardbar .hc-app { width: 24px; height: 24px; border-radius: 6px; }
.hc-cardbar > b { flex: 0 1 auto; max-width: 70%; min-width: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.016em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hc-cardbar > span:not(.hc-app) { flex: 1; min-width: 0; font-size: 15px; color: var(--label-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hc-cardbar .hc-ibtn { width: 34px; height: 34px; }
.hc-cardbody { position: relative; background: #fff; }
.hc-blocked.row { height: auto; flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: 10px 12px; padding: 14px; text-align: left; }
.hc-blocked.row > .hc-app { margin: 0; box-shadow: 0 0 0 .5px var(--sep); }
.hc-blocked.row > div { flex: 1; min-width: 150px; display: flex; flex-direction: column; gap: 2px; }
.hc-blocked.row h3 { font-size: 17px; font-weight: 600; letter-spacing: -0.022em; }
.hc-blocked.row p { font-size: 15px; }
.hc-blocked.row .hc-btn { margin: 0; height: 38px; padding: 0 16px; border-radius: 10px; font-size: 15px; }

/* Sheets: a centred card on desktop, slid up from the bottom on a phone. */
.scrim.hc-scrim { z-index: 76; }
.hc-sheet { width: min(440px, 100%); max-height: min(720px, 88vh); display: flex; flex-direction: column; border-radius: 22px; background: var(--bg); color: var(--label); box-shadow: 0 24px 70px rgba(0, 0, 0, .35); overflow: hidden; animation: rise .35s var(--ease); }
.hc-head { display: flex; align-items: center; gap: 10px; padding: 16px 18px 10px; flex: none; }
.hc-head h2 { flex: 1; margin: 0; font: 600 17px var(--display); letter-spacing: -0.022em; }
.hc-done { color: var(--blue); font-weight: 600; font-size: 17px; padding: 4px 6px; border-radius: 8px; }
.hc-link { color: var(--blue); font-size: 15px; padding: 4px 6px; border-radius: 8px; }
.hc-link:active, .hc-done:active { opacity: .4; }
.hc-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px 18px 22px; display: flex; flex-direction: column; gap: 22px; }
.hc-sec h3 { margin: 0 0 8px; padding: 0 4px; font-size: 13px; font-weight: 400; text-transform: uppercase; letter-spacing: -0.006em; color: var(--label-2); }
.hc-group { background: var(--surface); border-radius: 12px; overflow: hidden; }
.hc-line { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 8px 14px; font-size: 16px; letter-spacing: -0.02em; }
.hc-line + .hc-line { border-top: .5px solid var(--sep); }
.hc-line > span { flex: 1; min-width: 0; }
.hc-line output { color: var(--label-2); font-variant-numeric: tabular-nums; font-size: 15px; min-width: 42px; text-align: right; }
.hc-line.col { flex-direction: column; align-items: stretch; gap: 8px; padding: 12px 14px; }
.hc-line.col > div:not(.seg) { display: flex; align-items: center; gap: 12px; }
.hc-line.off { opacity: .4; pointer-events: none; }
.hc-trow { background: var(--surface); }
.hc-trow.drag { position: relative; z-index: 2; box-shadow: 0 12px 30px -10px rgba(0, 0, 0, .35); border-radius: 12px; }
.hc-trow .hc-app { flex: none; width: 30px; height: 30px; border-radius: 8px; }
.hc-grip { width: 34px; height: 40px; margin: -6px -8px -6px -6px; display: grid; place-items: center; color: var(--label-3); cursor: grab; touch-action: none; border-radius: 8px; }
.hc-grip:active { cursor: grabbing; }
.hc-switch { position: relative; flex: none; width: 51px; height: 31px; border-radius: 99px; background: var(--fill-2); transition: background .25s; }
.hc-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; border-radius: 50%; background: #fff; box-shadow: 0 3px 8px rgba(0, 0, 0, .15), 0 3px 1px rgba(0, 0, 0, .06); transition: transform .3s var(--ease); }
.hc-switch[aria-checked="true"] { background: var(--green); }
.hc-switch[aria-checked="true"]::after { transform: translateX(20px); }
.hc-switch:disabled { opacity: .5; }
.hc-switch:focus-visible, .hc-done:focus-visible, .hc-link:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.seg.hc-seg { min-width: 0; width: 100%; }
.hc-range { flex: 1; min-width: 0; -webkit-appearance: none; appearance: none; height: 28px; background: transparent; }
.hc-range::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: linear-gradient(90deg, var(--blue) var(--p, 50%), var(--fill-2) var(--p, 50%)); }
.hc-range::-moz-range-track { height: 4px; border-radius: 2px; background: linear-gradient(90deg, var(--blue) var(--p, 50%), var(--fill-2) var(--p, 50%)); }
.hc-range::-webkit-slider-thumb { -webkit-appearance: none; width: 26px; height: 26px; margin-top: -11px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 .5px rgba(0, 0, 0, .06), 0 3px 8px rgba(0, 0, 0, .18); }
.hc-range::-moz-range-thumb { width: 26px; height: 26px; border: 0; border-radius: 50%; background: #fff; box-shadow: 0 3px 8px rgba(0, 0, 0, .18); }
.hc-swatches { display: flex; flex-wrap: wrap; gap: 10px; padding: 12px 14px; }
.hc-sw { position: relative; width: 30px; height: 30px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 .5px rgba(0, 0, 0, .15); display: grid; place-items: center; color: #fff; }
.hc-sw.sys { background: conic-gradient(#ff3b30, #ff9500, #ffcc00, #34c759, #30b0c7, #0a84ff, #7a5af8, #ff2d55, #ff3b30); }
.hc-sw.on::before { content: ""; position: absolute; inset: -4px; border-radius: 50%; box-shadow: 0 0 0 2.5px var(--c, var(--blue)); }
.hc-sw.sys.on::before { box-shadow: 0 0 0 2.5px var(--label-3); }
.hc-sw input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
.hc-sw.pick { background: conic-gradient(from 90deg, #fff, var(--c, #888)); }
.hc-walls { display: grid; grid-template-columns: repeat(auto-fill, minmax(86px, 1fr)); gap: 10px; padding: 12px 14px 14px; }
.hc-wall { position: relative; aspect-ratio: 16 / 11; border-radius: 12px; background: var(--fill) center / cover no-repeat; box-shadow: inset 0 0 0 .5px var(--sep); overflow: hidden; display: grid; place-items: center; color: var(--label-2); }
.hc-wall b { position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 6px 5px; font-size: 11.5px; font-weight: 600; letter-spacing: -0.006em; color: #fff; background: linear-gradient(transparent, rgba(0, 0, 0, .45)); text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hc-wall.none b, .hc-wall.act b { color: var(--label-2); background: none; text-align: center; }
.hc-wall.act { background: var(--fill); flex-direction: column; gap: 4px; align-content: center; }
.hc-wall.act svg { color: var(--blue); }
.hc-wall.on::after { content: ""; position: absolute; inset: 0; border-radius: 12px; box-shadow: inset 0 0 0 3px var(--blue), inset 0 0 0 4.5px var(--bg); }
.hc-wall:active { transform: scale(.97); }
.hc-wall:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.hc-maker { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 12px; border-top: .5px solid var(--sep); }
.hc-maker[hidden] { display: none; }
.hc-mprev { height: 92px; border-radius: 12px; box-shadow: inset 0 0 0 .5px var(--sep); }
.hc-mcolors { display: flex; align-items: center; gap: 10px; }
.hc-mcolors .hc-sw { width: 36px; height: 36px; }
.hc-mcolors .hc-x { width: 26px; height: 26px; border-radius: 50%; background: var(--fill-2); color: var(--label-2); display: grid; place-items: center; }
.hc-mbtns { display: flex; gap: 10px; }
.hc-btn { flex: 1; height: 40px; border-radius: 12px; background: var(--fill); color: var(--blue); font-size: 16px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.hc-btn.solid { background: var(--blue); color: #fff; }
.hc-btn.red { color: var(--red); }
.hc-btn:active { opacity: .5; }

/* The style panel sits beside the page (no dimming) so changes show live behind it. */
.hc-panel { position: fixed; z-index: 74; top: calc(env(safe-area-inset-top) + 12px); right: 12px; bottom: 12px; width: 372px; display: flex; flex-direction: column; border-radius: 22px; background: var(--menu-bg); -webkit-backdrop-filter: saturate(180%) blur(30px); backdrop-filter: saturate(180%) blur(30px); color: var(--label); box-shadow: 0 0 0 .5px var(--sep), 0 24px 70px rgba(0, 0, 0, .3); overflow: hidden; animation: hc-in .38s var(--ease); }
.hc-panel .hc-group { background: var(--surface); }
@keyframes hc-in { from { transform: translateX(24px); opacity: 0; } }
@media (max-width: 700px) {
  .scrim.hc-scrim { place-items: end stretch; padding: 0; }
  .hc-sheet { width: 100%; max-height: 88vh; border-radius: 22px 22px 0 0; padding-bottom: env(safe-area-inset-bottom); }
  .hc-panel { top: auto; left: 0; right: 0; bottom: 0; width: auto; height: 62vh; border-radius: 22px 22px 0 0; padding-bottom: env(safe-area-inset-bottom); animation: rise .35s var(--ease); }
  .hc-grab { display: block; width: 40px; height: 5px; border-radius: 3px; background: var(--label-3); margin: 8px auto 0; flex: none; }
  .scrim.hc-sitescrim { padding: 0; }
  .hc-siteview { width: 100%; height: 100%; border-radius: 0; box-shadow: none; }
  .hc-sitebar { padding: env(safe-area-inset-top) 4px 0 12px; min-height: calc(54px + env(safe-area-inset-top)); gap: 4px; }
  .hc-sitename span, .hc-pbtn .long { display: none; }
  .hc-blocked:not(.row) .hc-btn { align-self: stretch; }
}
.hc-grab { display: none; }
@media (prefers-reduced-motion: reduce) { .hc-panel, .hc-sheet, .hc-siteview, .hc-blocked { animation: none; } }
`
  const style = document.createElement('style')
  style.id = 'hc-style'
  style.textContent = css
  document.head.append(style)
  const wall = document.createElement('div')
  wall.id = 'hub-wall'
  document.body.prepend(wall)

  /* ---------- applying settings ---------- */

  const hexRgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.replace(/./g, c => c + c); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255) }
  const lum = h => { const [r, g, b] = hexRgb(h).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const gradCss = g => {
    const [a, b, c = g.colors[0]] = g.colors
    return g.mesh
      ? `radial-gradient(at 14% 18%, ${a} 0, transparent 58%), radial-gradient(at 86% 24%, ${b} 0, transparent 56%), radial-gradient(at 52% 100%, ${c} 0, transparent 62%), linear-gradient(${g.angle}deg, ${a}, ${b})`
      : `linear-gradient(${g.angle}deg, ${g.colors.join(', ')})`
  }
  // { image, tone } for a wallpaper id, or null for None.
  function wallFor(id, s = S) {
    if (!id || id === 'none') return null
    const b = WALLS.find(w => w.id === id)
    if (b) return { image: `url("/wallpapers/${b.id}.svg")`, tone: b.tone }
    const g = s.wallpaper.custom.find(w => w.id === id)
    if (g) return { image: gradCss(g), tone: g.colors.reduce((t, c) => t + lum(c), 0) / g.colors.length < 0.4 ? 'dark' : 'light' }
    const u = s.wallpaper.uploads.find(w => w.id === id)
    if (u) return { image: `url("/api/hub/wallpapers/${u.file}")`, tone: '' }
    return null
  }

  function apply() {
    const st = { ...STYLE_DEFAULT, ...S.style, ...(preview?.style || {}) }
    const r = document.documentElement
    if (st.theme === 'auto') { r.removeAttribute('data-theme'); r.style.colorScheme = '' } else { r.setAttribute('data-theme', st.theme); r.style.colorScheme = st.theme }
    if (st.accent === 'system') r.style.removeProperty('--blue')
    else r.style.setProperty('--blue', st.accent)
    r.dataset.look = st.widgetLook
    r.dataset.shadow = st.shadow
    r.dataset.tabbar = st.tabBar
    r.dataset.effect = st.effect
    r.style.setProperty('--hub-blur', `${st.blur}px`)
    r.style.setProperty('--hub-alpha', `${100 - st.transparency}%`)
    r.style.setProperty('--hub-radius', `${st.radius}px`)
    const w = preview?.wall !== undefined ? preview.wall : wallFor(S.wallpaper.current)
    if (!w) { delete r.dataset.wall; wall.style.backgroundImage = ''; return }
    r.dataset.wall = '1'
    wall.style.backgroundImage = w.image
    // A tint of the page colour over the wallpaper keeps text readable: light over a light
    // wallpaper (or dark over dark) needs little, the opposite needs more.
    const dark = st.theme === 'dark' || (st.theme === 'auto' && DARK.matches)
    const match = w.tone === (dark ? 'dark' : 'light')
    r.style.setProperty('--hub-scrim', w.tone ? (match ? '.22' : '.62') : '.45')
  }
  DARK.addEventListener?.('change', apply)
  apply()

  /* ---------- loading and saving ---------- */

  const keep = () => { try { localStorage.setItem(CACHE, JSON.stringify(S)) } catch {} }
  function accept(next, quiet) {
    const prev = S
    S = { ...DEFAULT, ...next, style: { ...STYLE_DEFAULT, ...next.style } }
    keep()
    apply()
    const changed = ['tabs', 'apps', 'sites', 'groups', 'widgets', 'style', 'wallpaper'].filter(k => JSON.stringify(prev[k]) !== JSON.stringify(S[k]))
    if (!changed.length) return
    if (changed.includes('tabs') && typeof chrome === 'function') { try { chrome() } catch {} }
    if (!quiet) for (const fn of listeners) { try { fn(S, changed) } catch (e) { console.error(e) } }
    if (panel && (changed.includes('wallpaper') || changed.includes('style'))) paintPanel()
  }

  let pending = null, timer = 0, saving = null
  // Merge a patch locally right away, then send it (style changes are batched while a slider moves).
  function save(patch, { wait = 0 } = {}) {
    if (patch.style) { S = { ...S, style: { ...S.style, ...patch.style } }; apply() }
    pending = merge(pending || {}, patch)
    clearTimeout(timer)
    return new Promise(res => { timer = setTimeout(() => res(flush()), wait) })
  }
  const merge = (a, b) => {
    const out = { ...a }
    for (const [k, v] of Object.entries(b)) out[k] = k === 'style' ? { ...(a.style || {}), ...v } : v
    return out
  }
  async function flush() {
    if (!pending) return S
    const body = pending
    pending = null
    try {
      saving = api('/api/hub/settings', body)
      const out = await saving
      // Changes made while this one was on its way stay on screen until they are sent too.
      if (pending?.style) out.style = { ...out.style, ...pending.style }
      accept(out)
    } catch (e) {
      hud?.(`Couldn’t save: ${e.message}`)
      refresh()
    } finally { saving = null }
    return S
  }
  async function refresh() {
    if (pending || saving) return
    try {
      const res = await fetch('/api/hub/settings', { cache: 'no-store' })
      if (!res.ok) return
      const next = await res.json()
      if (!pending && !saving && (next.at !== S.at || !S.at)) accept(next)
    } catch {}
  }
  refresh()
  setInterval(refresh, 15_000)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh())

  /* ---------- tabs ---------- */

  const known = id => BUILTIN.includes(id) || !!window.TABS?.[id]
  const orderOf = () => [...S.tabs.order.filter(known), ...BUILTIN.filter(t => !S.tabs.order.includes(t))]
  const visibleTabs = () => orderOf().filter(t => t === 'home' || !S.tabs.hidden.includes(t))
  const pluginTabs = () => S.tabs.order.filter(t => !BUILTIN.includes(t) && window.TABS?.[t])

  // Put the header buttons in the saved order and hide the hidden ones. The open tab always
  // shows (dimmed when it is a hidden one), so a tab reached from an app or search has a home.
  function syncTabs(cur) {
    const seg = document.getElementById('seg')
    if (!seg) return
    const want = orderOf()
    for (const b of seg.querySelectorAll('button[data-env]')) if (!want.includes(b.dataset.env)) b.remove()
    const driveBtn = seg.querySelector('button[data-env="drives"]')
    if (driveBtn) driveBtn.textContent = appMeta('drives').label
    const moved = [...seg.querySelectorAll('button[data-env]')].map(b => b.dataset.env).join() !== want.join()
    for (const id of want) {
      let b = seg.querySelector(`button[data-env="${id}"]`)
      if (!b) {
        b = document.createElement('button')
        b.dataset.env = id
        b.setAttribute('role', 'tab')
        b.textContent = appMeta(id).label
      }
      const hidden = id !== 'home' && S.tabs.hidden.includes(id)
      b.hidden = hidden && id !== cur
      b.classList.toggle('hc-peek', hidden && id === cur)
      if (moved || !b.isConnected) seg.append(b)
    }
  }

  function openTab(id) {
    if (id === 'chat') return window.HubChat ? window.HubChat.open() : hud?.('Chat isn’t available yet')
    if (groupOf(id)) { if (typeof setEnv === 'function' && env !== 'home') setEnv('home'); return void requestAnimationFrame(() => window.HUB_OPEN_GROUP?.(id)) }
    const site = siteOf(id)
    if (site) return site.newTab ? void window.open(site.url, '_blank', 'noopener,noreferrer') : void openSite(site.url, { name: site.name, icon: iconSrc(site) })
    if (typeof setEnv === 'function') { setEnv(id); window.scrollTo({ top: 0 }) }
  }
  const tile = (id, size = 30, r = 8, is = 17) => { const s = siteOf(id); if (s) return siteTile(s.name, iconSrc(s), size, r); const g = groupOf(id); if (g) return folderTile(g, size, r); const m = appMeta(id); return `<span class="hc-app" style="--a1:${m.tint[0]};--a2:${m.tint[1]};width:${size}px;height:${size}px;border-radius:${r}px">${icon(m.icon, is, 2.1)}</span>` }

  // A group's tile: its first nine apps in a 3 by 3 grid on frosted glass, like an iPhone folder.
  function folderTile(g, size, r) {
    const pad = size * 0.12, gap = size * 0.055, mini = (size - pad * 2 - gap * 2) / 3
    const minis = g.apps.slice(0, 9).map(a => tile(a, mini, mini * 0.24, mini * 0.58)).join('')
    return `<span class="hc-app hc-folder" style="width:${size}px;height:${size}px;border-radius:${r}px;padding:${pad.toFixed(1)}px;gap:${gap.toFixed(1)}px;grid-template-columns:repeat(3,${mini.toFixed(1)}px);grid-auto-rows:${mini.toFixed(1)}px">${minis}</span>`
  }

  /* ---------- website preview ---------- */

  // { embeddable, title, favicon } from the hub (it reads the site's X-Frame-Options and CSP
  // frame-ancestors). Kept per address for this page; the hub keeps its own copy for hours.
  const checks = new Map()
  function embedCheck(url) {
    const href = webUrl(url)
    if (!href) return Promise.resolve({ embeddable: false, title: '', favicon: null })
    if (!checks.has(href)) checks.set(href, fetch(`/api/hub/embed-check?url=${encodeURIComponent(href)}`, { headers: { 'x-hub': '1' }, cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .catch(() => { checks.delete(href); return { embeddable: false, title: '', favicon: null } }))
    return checks.get(href)
  }
  const frameHtml = (href, name) => `<iframe class="hc-frame" src="${esc(href)}" title="${esc(name)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer"></iframe>`
  const openLink = (href, cls, inner) => `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener noreferrer" data-site="newtab">${inner}</a>`
  const blockedHtml = (href, name, src) => `<div class="hc-blocked">${siteTile(name, src, 88, 22)}<h3>${esc(name)}</h3><p>${esc(hostOf(href))}</p><p>This site doesn’t allow previews</p>${openLink(href, 'hc-btn solid', `${icon('external', 18)}Open in New Tab`)}</div>`
  const blockedRow = (href, name, src) => `<div class="hc-blocked row">${siteTile(name, src, 48, 12)}<div><h3>${esc(name)}</h3><p>${esc(hostOf(href))} · This site doesn’t allow previews</p></div>${openLink(href, 'hc-btn solid', `${icon('external', 16)}Open in New Tab`)}</div>`
  const loadingHtml = '<div class="hc-siteload" role="status" aria-label="Loading"><span class="hc-spin"></span></div>'

  let siteEl = null
  function closeSite() {
    const el = siteEl
    if (!el) return
    el.remove()
    siteEl = null
    document.removeEventListener('keydown', siteKey, true)
    document.documentElement.style.overflow = ''
    try { if (el._focus?.isConnected) el._focus.focus({ preventScroll: true }) } catch {}
  }
  function siteKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSite() } }
  // Open a site in a large sheet: a live frame when the site allows it, otherwise a card with
  // Open in New Tab. Returns false for an address that is not http or https.
  function openSite(url, { name, icon: src } = {}) {
    const href = webUrl(url)
    if (!href) { hud?.('That isn’t a web address'); return false }
    const focus = document.activeElement
    closeSite()
    let label = String(name || '').trim().slice(0, 80) || hostOf(href)
    src = src || siteIcon(href)
    const el = siteEl = document.createElement('div')
    el.className = 'scrim hc-sitescrim'
    el.innerHTML = `<div class="hc-siteview" role="dialog" aria-modal="true" aria-label="${esc(label)}"><header class="hc-sitebar"><span data-site="fav">${siteTile(label, src, 28, 7)}</span><div class="hc-sitename"><b>${esc(label)}</b><span>${esc(hostOf(href))}</span></div><button type="button" class="hc-ibtn" data-site="reload" aria-label="Reload" title="Reload">${icon('reload', 19)}</button>${openLink(href, 'hc-pbtn', `${icon('external', 16)}<span>Open<span class="long"> in New Tab</span></span>`)}<button type="button" class="hc-ibtn" data-site="close" aria-label="Close" title="Close">${icon('close', 19)}</button></header><div class="hc-sitebody">${loadingHtml}</div></div>`
    el._focus = focus
    const body = el.querySelector('.hc-sitebody')
    const paint = c => {
      if (siteEl !== el) return
      if (!name && c.title) { label = c.title; el.querySelector('.hc-sitename b').textContent = label; el.firstChild.setAttribute('aria-label', label) }
      body.innerHTML = c.embeddable ? frameHtml(href, label) : blockedHtml(href, label, src)
    }
    embedCheck(href).then(paint)
    el.addEventListener('pointerdown', e => { if (e.target === el) closeSite() })
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-site]')
      if (!b) return
      const act = b.dataset.site
      if (act === 'close') closeSite()
      else if (act === 'reload') { body.innerHTML = loadingHtml; checks.delete(href); embedCheck(href).then(paint) }
      else if (act === 'newtab') setTimeout(closeSite, 0)
    })
    document.body.append(el)
    document.documentElement.style.overflow = 'hidden'
    document.addEventListener('keydown', siteKey, true)
    el.querySelector('[data-site="close"]').focus({ preventScroll: true })
    return true
  }
  // A card to put on any page (the chat uses it): a live frame `height` px tall when the site
  // allows it, otherwise one row with the icon, name and Open in New Tab.
  function siteCard(url, { name, height = 360, icon: src } = {}) {
    const el = document.createElement('div')
    el.className = 'hc-sitecard'
    const href = webUrl(url)
    if (!href) { el.innerHTML = `<div class="hc-blocked row"><div><h3>Not a web address</h3><p>Only http and https links can be shown.</p></div></div>`; return el }
    const h = Math.max(160, Math.min(900, Number(height) || 360))
    let label = String(name || '').trim().slice(0, 80) || hostOf(href)
    src = src || siteIcon(href)
    const bar = () => `<div class="hc-cardbar">${siteTile(label, src, 24, 6)}<b>${esc(label)}</b><span>${esc(hostOf(href))}</span><button type="button" class="hc-ibtn" data-site="expand" aria-label="Open ${esc(label)} in a large preview" title="Large preview">${icon('expand', 17)}</button>${openLink(href, 'hc-ibtn', icon('external', 17)).replace('data-site="newtab"', `data-site="newtab" aria-label="Open ${esc(label)} in a new tab" title="Open in New Tab"`)}</div>`
    el.innerHTML = `${bar()}<div class="hc-cardbody" style="height:${h}px">${loadingHtml}</div>`
    embedCheck(href).then(c => {
      if (!name && c.title) label = c.title
      el.innerHTML = c.embeddable ? `${bar()}<div class="hc-cardbody" style="height:${h}px">${frameHtml(href, label)}</div>` : blockedRow(href, label, src)
    })
    el.addEventListener('click', e => { if (e.target.closest('[data-site="expand"]')) openSite(href, { name: label, icon: src }) })
    return el
  }

  /* ---------- sheets ---------- */

  let sheetEl = null
  function closeSheet() { sheetEl?.remove(); sheetEl = null; document.removeEventListener('keydown', sheetKey, true) }
  function sheetKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeSheet() } }
  function openSheet(title, body, onReady) {
    closeSheet()
    sheetEl = document.createElement('div')
    sheetEl.className = 'scrim hc-scrim'
    sheetEl.innerHTML = `<div class="hc-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="hc-grab"></div><div class="hc-head"><h2>${esc(title)}</h2><button class="hc-done" data-hc="close">Done</button></div><div class="hc-body">${body}</div></div>`
    sheetEl.addEventListener('pointerdown', e => { if (e.target === sheetEl) closeSheet() })
    sheetEl.addEventListener('click', e => { if (e.target.closest('[data-hc="close"]')) closeSheet() })
    document.body.append(sheetEl)
    document.addEventListener('keydown', sheetKey, true)
    onReady?.(sheetEl.querySelector('.hc-sheet'))
  }

  // Edit tabs: a switch and a drag handle per tab. Home always shows.
  function openTabs() {
    const rows = () => orderOf().map(id => {
      const on = id === 'home' || !S.tabs.hidden.includes(id)
      return `<div class="hc-line hc-trow" data-id="${id}"><span class="hc-grip" title="Drag to reorder" aria-label="Reorder ${esc(appMeta(id).label)}">${icon('grip', 18)}</span>${tile(id)}<span>${esc(appMeta(id).label)}</span><button class="hc-switch" role="switch" aria-label="Show ${esc(appMeta(id).label)}" aria-checked="${on}" data-tab="${id}" ${id === 'home' ? 'disabled' : ''}></button></div>`
    }).join('')
    const addons = Object.entries(CONF.addons || {}).filter(([, a]) => a.available).map(([id, a]) => `<div class="hc-line"><span>${esc(a.label)}<small style="display:block;font-size:13px;color:var(--text-2)">${esc(!a.on && a.how ? a.how : a.what)}</small></span><button type="button" class="hc-switch" role="switch" aria-label="${esc(a.label)}" aria-checked="${a.on}" data-addon="${id}"></button></div>`).join('')
    openSheet('Edit Tabs', `<div class="hc-sec"><h3>Header tabs</h3><div class="hc-group" id="hc-tabs">${rows()}</div></div><div class="hc-sec"><h3>Add-ons</h3><div class="hc-group">${addons}</div></div><div class="hc-mbtns"><button class="hc-btn" data-hc="tabs-reset">${icon('reset', 17)}Show All in Default Order</button></div>`, sh => {
      const list = sh.querySelector('#hc-tabs')
      const order = () => [...list.children].map(r => r.dataset.id)
      sh.addEventListener('click', e => {
        const addon = e.target.closest('[data-addon]')
        if (addon) return void api('/api/hub/addons', { id: addon.dataset.addon, on: addon.getAttribute('aria-checked') !== 'true' }).then(() => location.reload(), err => hud?.(err.message))
        const sw = e.target.closest('.hc-switch')
        if (sw && !sw.disabled) {
          const on = sw.getAttribute('aria-checked') !== 'true'
          sw.setAttribute('aria-checked', String(on))
          const hidden = [...list.querySelectorAll('.hc-switch')].filter(s => s.getAttribute('aria-checked') !== 'true').map(s => s.dataset.tab)
          S = { ...S, tabs: { ...S.tabs, hidden } }
          if (typeof chrome === 'function') chrome()
          save({ tabs: { hidden } })
        }
        if (e.target.closest('[data-hc="tabs-reset"]')) {
          api('/api/hub/settings', { reset: ['tabs'] }).then(s => { accept(s); list.innerHTML = rows() }, err => hud?.(err.message))
        }
      })
      list.addEventListener('pointerdown', e => {
        const grip = e.target.closest('.hc-grip')
        if (!grip) return
        e.preventDefault()
        const row = grip.closest('.hc-trow')
        const before = order().join()
        row.classList.add('drag')
        grip.setPointerCapture(e.pointerId)
        const move = ev => {
          const after = [...list.children].filter(r => r !== row).find(r => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2 })
          after ? list.insertBefore(row, after) : list.append(row)
        }
        const up = () => {
          grip.removeEventListener('pointermove', move)
          row.classList.remove('drag')
          if (order().join() === before) return
          S = { ...S, tabs: { ...S.tabs, order: order() } }
          if (typeof chrome === 'function') chrome()
          save({ tabs: { order: order() } })
        }
        grip.addEventListener('pointermove', move)
        grip.addEventListener('pointerup', up, { once: true })
        grip.addEventListener('pointercancel', up, { once: true })
      })
      list.addEventListener('keydown', e => {
        const row = e.target.closest?.('.hc-trow')
        if (!row || !e.target.classList.contains('hc-grip') || !['ArrowUp', 'ArrowDown'].includes(e.key)) return
        e.preventDefault()
        if (e.key === 'ArrowUp' && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling)
        if (e.key === 'ArrowDown' && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row)
        e.target.focus()
        S = { ...S, tabs: { ...S.tabs, order: order() } }
        if (typeof chrome === 'function') chrome()
        save({ tabs: { order: order() } }, { wait: 400 })
      })
      list.querySelectorAll('.hc-grip').forEach(g => g.setAttribute('tabindex', '0'))
    })
  }

  /* ---------- style panel ---------- */

  let panel = null
  let maker = null // the gradient being made: { colors, angle, mesh }
  let themeList = []
  const seg = (key, opts, cur) => `<div class="seg hc-seg" style="--n:${opts.length};--i:${Math.max(0, opts.findIndex(o => o[0] === cur))}"><span class="seg-thumb"></span>${opts.map(([v, l]) => `<button data-hc-set="${key}" data-v="${v}" aria-pressed="${v === cur}">${l}</button>`).join('')}</div>`
  const range = (key, label, min, max, cur, unit = '') => `<div class="hc-line"><span>${label}</span><input class="hc-range" type="range" min="${min}" max="${max}" value="${cur}" data-hc-range="${key}" aria-label="${label}" style="--p:${((cur - min) / (max - min)) * 100}%"><output>${cur}${unit}</output></div>`

  function panelHtml() {
    const st = { ...STYLE_DEFAULT, ...S.style, ...(preview?.style || {}) }
    const cur = S.wallpaper.current
    const custom = !ACCENTS.some(a => a[0] === st.accent)
    const walls = [
      `<button class="hc-wall none${cur === 'none' ? ' on' : ''}" data-wall="none" aria-label="No wallpaper">${icon('close', 20)}<b>None</b></button>`,
      ...WALLS.map(w => `<button class="hc-wall${cur === w.id ? ' on' : ''}" data-wall="${w.id}" style="background-image:url('/wallpapers/${w.id}.svg')"><b>${esc(w.name)}</b></button>`),
      ...S.wallpaper.custom.map(g => `<button class="hc-wall${cur === g.id ? ' on' : ''}" data-wall="${g.id}" data-own="custom" style="background-image:${esc(gradCss(g))}"><b>${esc(g.name)}</b></button>`),
      ...S.wallpaper.uploads.map(u => `<button class="hc-wall${cur === u.id ? ' on' : ''}" data-wall="${u.id}" data-own="upload" style="background-image:url('/api/hub/wallpapers/${esc(u.file)}')"><b>${esc(u.name)}</b></button>`),
      `<button class="hc-wall act" data-hc="maker">${icon('blend', 20)}<b>Gradient</b></button>`,
      `<button class="hc-wall act" data-hc="upload">${icon('upload', 20)}<b>Upload</b></button>`,
    ].join('')
    const m = maker
    const makerHtml = m ? `<div class="hc-maker"><div class="hc-mprev" style="background:${gradCss(m)}"></div>
      <div class="hc-mcolors">${m.colors.map((c, i) => `<label class="hc-sw" style="--c:${c}" title="Colour ${i + 1}"><input type="color" value="${c}" data-mc="${i}" aria-label="Colour ${i + 1}"></label>`).join('')}${m.colors.length < 3 ? `<button class="hc-x" data-hc="mc-add" aria-label="Add a colour">${icon('plus', 14, 2.4)}</button>` : `<button class="hc-x" data-hc="mc-del" aria-label="Remove the third colour">${icon('close', 14, 2.4)}</button>`}</div>
      <div class="hc-line" style="padding:0">${'<span>Angle</span>'}<input class="hc-range" type="range" min="0" max="360" value="${m.angle}" data-mk="angle" aria-label="Angle" style="--p:${(m.angle / 360) * 100}%"><output>${m.angle}°</output></div>
      <div class="hc-line" style="padding:0"><span>Mesh</span><button class="hc-switch" role="switch" aria-label="Mesh" aria-checked="${m.mesh}" data-hc="mesh"></button></div>
      <div class="hc-mbtns"><button class="hc-btn" data-hc="maker-cancel">Cancel</button><button class="hc-btn solid" data-hc="maker-save">Save Gradient</button></div></div>` : ''
    return `<div class="hc-grab"></div><div class="hc-head"><h2>Style</h2><button class="hc-link" data-hc="style-reset">Reset</button><button class="hc-done" data-hc="panel-close">Done</button></div>
<div class="hc-body">
  <div class="hc-sec" data-sec="theme"><h3>Theme</h3><div class="hc-group">${themeList.map(t => `<div class="hc-line"><span style="flex:1">${esc(t.name)}</span><a class="hc-link" href="/api/hub/themes/${esc(t.id)}.json" download>Export</a><button class="hc-link" data-hc="theme-apply" data-id="${esc(t.id)}">Apply</button></div>`).join('')}</div><div class="hc-mbtns"><button class="hc-btn" data-hc="theme-import">Import a Theme File</button></div></div>
  <div class="hc-sec" data-sec="look"><h3>Appearance</h3><div class="hc-group"><div class="hc-line">${seg('theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], st.theme)}</div></div></div>
  <div class="hc-sec"><h3>Accent</h3><div class="hc-group"><div class="hc-swatches">${ACCENTS.map(([v, l]) => `<button class="hc-sw${v === 'system' ? ' sys' : ''}${st.accent === v ? ' on' : ''}" style="--c:${v === 'system' ? 'var(--label-3)' : v}" data-hc-set="accent" data-v="${v}" title="${l}" aria-label="${l}"></button>`).join('')}<label class="hc-sw pick${custom ? ' on' : ''}" style="--c:${custom ? st.accent : '#0a84ff'}" title="Custom colour"><input type="color" value="${custom ? st.accent : '#0a84ff'}" data-hc-color="accent" aria-label="Custom accent colour"></label></div></div></div>
  <div class="hc-sec"><h3>Widgets</h3><div class="hc-group">
    <div class="hc-line">${seg('widgetLook', [['solid', 'Solid'], ['glass', 'Glass'], ['outline', 'Outline']], st.widgetLook)}</div>
    ${range('blur', 'Blur', 0, 40, st.blur, 'px').replace('class="hc-line"', `class="hc-line${st.widgetLook === 'glass' ? '' : ' off'}"`)}
    ${range('transparency', 'Transparency', 0, 90, st.transparency, '%').replace('class="hc-line"', `class="hc-line${st.widgetLook === 'glass' ? '' : ' off'}"`)}
    ${range('radius', 'Corners', 6, 32, st.radius, 'px')}
    <div class="hc-line col"><span>Depth</span>${seg('shadow', [['none', 'Flat'], ['soft', 'Soft'], ['deep', 'Deep']], st.shadow)}</div>
  </div></div>
  <div class="hc-sec"><h3>Tab bar</h3><div class="hc-group"><div class="hc-line">${seg('tabBar', [['solid', 'Solid'], ['glass', 'Glass']], st.tabBar)}</div></div></div>
  <div class="hc-sec"><h3>Effects</h3><div class="hc-group"><div class="hc-line">${seg('effect', [['none', 'None'], ['grain', 'Grain'], ['glow', 'Glow']], st.effect)}</div></div></div>
  <div class="hc-sec" data-sec="wallpaper"><h3>Wallpaper</h3><div class="hc-group"><div class="hc-walls">${walls}</div>${makerHtml}</div></div>
</div>`
  }

  function paintPanel() {
    if (!panel) return
    const body = panel.querySelector('.hc-body')
    const top = body?.scrollTop || 0
    panel.innerHTML = panelHtml()
    panel.querySelector('.hc-body').scrollTop = top
  }

  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif'
  fileInput.hidden = true
  document.body.append(fileInput)
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0]
    fileInput.value = ''
    if (!f) return
    if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(f.type)) return hud?.('Choose a PNG, JPEG, WebP, GIF or AVIF image')
    if (f.size > 10 * 2 ** 20) return hud?.('That image is over 10 MB')
    hud?.('Uploading…')
    try {
      const res = await fetch('/api/hub/wallpapers', { method: 'POST', headers: { 'content-type': f.type, 'x-hub': '1', 'x-name': encodeURIComponent(f.name.replace(/\.[^.]+$/, '').slice(0, 60)), 'x-select': '1' }, body: f })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(out.error || res.statusText)
      accept(out.settings)
      hud?.('Wallpaper set')
    } catch (e) { hud?.(`Upload failed: ${e.message}`) }
  })

  function closePanel() {
    if (!panel) return
    if (maker) { maker = null; preview = null; apply() }
    panel.remove()
    panel = null
    flush()
  }

  function openStyle(section) {
    if (panel) { panel.querySelector(`[data-sec="${section}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return }
    window.HUB_CLOSE_OVERLAYS?.()
    panel = document.createElement('aside')
    panel.className = 'hc-panel'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'Style')
    panel.innerHTML = panelHtml()
    document.body.append(panel)
    if (section) requestAnimationFrame(() => panel?.querySelector(`[data-sec="${section}"]`)?.scrollIntoView({ block: 'start' }))
    fetch('/api/hub/themes').then(r => r.json()).then(j => { themeList = j.themes || []; if (panel) paintPanel() }, () => {})

    panel.addEventListener('click', async e => {
      const t = e.target.closest('button')
      if (!t) return
      const act = t.dataset.hc
      if (act === 'panel-close') return closePanel()
      if (act === 'theme-apply') {
        const th = themeList.find(x => x.id === t.dataset.id)
        if (!th) return
        try { accept(await api('/api/hub/settings', { style: th.style, wallpaper: { current: th.wallpaper || 'none' } })); apply(); paintPanel(); hud?.(`${th.name} theme applied`) } catch (err) { hud?.(err.message) }
        return
      }
      if (act === 'theme-import') {
        const pick = document.createElement('input')
        pick.type = 'file'
        pick.accept = '.json,application/json'
        pick.onchange = async () => {
          try {
            const r = await api('/api/hub/themes', { theme: JSON.parse(await pick.files[0].text()) })
            themeList = r.themes
            paintPanel()
            hud?.('Theme added')
          } catch (err) { hud?.(err.message) }
        }
        return pick.click()
      }
      if (act === 'style-reset') {
        const ok = await alertBox({ title: 'Reset Style?', message: 'Theme, accent, widget look, tab bar and effects go back to the default. Your wallpapers stay.', ok: 'Reset', danger: true })
        if (!ok) return
        try { accept(await api('/api/hub/settings', { reset: ['style'] })) } catch (err) { hud?.(err.message) }
        return paintPanel()
      }
      if (t.dataset.hcSet) {
        save({ style: { [t.dataset.hcSet]: t.dataset.v } }, { wait: 120 })
        return paintPanel()
      }
      if (t.dataset.wall) {
        if (maker) { maker = null; preview = null }
        S = { ...S, wallpaper: { ...S.wallpaper, current: t.dataset.wall } }
        apply()
        paintPanel()
        return save({ wallpaper: { current: t.dataset.wall } })
      }
      if (act === 'upload') return fileInput.click()
      if (act === 'maker') { maker = maker || { colors: ['#4f7cff', '#c86bff', '#ff9a6b'], angle: 135, mesh: true }; return previewMaker() }
      if (act === 'mc-add') { maker.colors.push('#ffd166'); return previewMaker() }
      if (act === 'mc-del') { maker.colors.length = 2; return previewMaker() }
      if (act === 'mesh') { maker.mesh = !maker.mesh; return previewMaker() }
      if (act === 'maker-cancel') { maker = null; preview = null; apply(); return paintPanel() }
      if (act === 'maker-save') {
        const id = `custom-${Date.now().toString(36)}`
        const g = { id, name: `Gradient ${S.wallpaper.custom.length + 1}`, colors: [...maker.colors], angle: maker.angle, mesh: maker.mesh }
        try {
          accept(await api('/api/hub/settings', { wallpaper: { addCustom: g, current: id } }))
          maker = null; preview = null; apply(); paintPanel()
          hud?.('Gradient saved')
        } catch (err) { hud?.(err.message) }
      }
    })
    panel.addEventListener('input', e => {
      const t = e.target
      if (t.dataset.hcRange) {
        const k = t.dataset.hcRange, v = Number(t.value), min = Number(t.min), max = Number(t.max)
        t.style.setProperty('--p', `${((v - min) / (max - min)) * 100}%`)
        t.nextElementSibling.textContent = `${v}${k === 'transparency' ? '%' : 'px'}`
        save({ style: { [k]: v } }, { wait: 350 })
      } else if (t.dataset.hcColor) {
        t.parentElement.style.setProperty('--c', t.value)
        save({ style: { accent: t.value } }, { wait: 350 })
      } else if (t.dataset.mc !== undefined) {
        maker.colors[Number(t.dataset.mc)] = t.value
        t.parentElement.style.setProperty('--c', t.value)
        previewMaker(true)
      } else if (t.dataset.mk === 'angle') {
        maker.angle = Number(t.value)
        t.style.setProperty('--p', `${(maker.angle / 360) * 100}%`)
        t.nextElementSibling.textContent = `${maker.angle}°`
        previewMaker(true)
      }
    })
    panel.addEventListener('change', e => { if (e.target.dataset.hcColor) paintPanel() })
  }
  // Show the gradient being made on the page itself; it is only saved on Save Gradient.
  function previewMaker(soft) {
    const g = { ...maker, colors: [...maker.colors] }
    preview = { wall: { image: gradCss(g), tone: g.colors.reduce((t, c) => t + lum(c), 0) / g.colors.length < 0.4 ? 'dark' : 'light' } }
    apply()
    if (soft) { const p = panel?.querySelector('.hc-mprev'); if (p) p.style.background = gradCss(g) }
    else paintPanel()
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel && !sheetEl && !document.querySelector('.scrim, .menu')) closePanel() })

  /* ---------- menus and search ---------- */

  // Right-click (or press and hold) on the tab bar, or on a saved wallpaper in the style panel.
  function contextMenu(target, x, y) {
    const own = target.closest?.('.hc-panel [data-own]')
    if (own) {
      const id = own.dataset.wall
      showMenu(x, y, own.textContent, [{ label: 'Remove Wallpaper', danger: true, icon: icon('close', 16), run: () => removeWall(id, own.dataset.own) }])
      return true
    }
    if (!target.closest?.('#seg')) return false
    const id = target.closest('button[data-env]')?.dataset.env
    const items = [{ label: 'Edit Tabs…', icon: icon('tabs', 16), run: openTabs }]
    if (id && id !== 'home') items.push({ label: `Hide ${appMeta(id).label}`, icon: icon('hide', 16), run: () => { const hidden = [...new Set([...S.tabs.hidden, id])]; S = { ...S, tabs: { ...S.tabs, hidden } }; if (typeof chrome === 'function') chrome(); save({ tabs: { hide: [id] } }) } })
    items.push('-', { label: 'Edit Style…', icon: icon('palette', 16), run: () => openStyle() })
    showMenu(x, y, 'Tabs', items)
    return true
  }
  async function removeWall(id, kind) {
    try {
      accept(kind === 'upload' ? await api('/api/hub/wallpapers/remove', { id }) : await api('/api/hub/settings', { wallpaper: { removeCustom: [id] } }))
      paintPanel()
    } catch (e) { hud?.(e.message) }
  }

  // Typing a tab's name in the search field offers to jump there, hidden tabs included.
  let jumpEl = null, jumpSel = 0, jumpIds = []
  const closeJump = () => { jumpEl?.remove(); jumpEl = null; jumpIds = [] }
  function paintJump() {
    const q = document.getElementById('q')
    const v = q.value.trim().toLowerCase()
    const all = [...orderOf(), 'chat', ...(S.sites || []).map(x => x.id), ...(S.groups || []).map(x => x.id)]
    jumpIds = v ? all.filter(id => appMeta(id).label.toLowerCase().startsWith(v) || (v.length > 2 && appMeta(id).label.toLowerCase().includes(v))).slice(0, 4) : []
    if (!jumpIds.length || document.activeElement !== q) return closeJump()
    jumpSel = Math.min(jumpSel, jumpIds.length - 1)
    if (!jumpEl) { jumpEl = document.createElement('div'); jumpEl.className = 'hc-jump'; jumpEl.setAttribute('role', 'listbox'); q.closest('.search').append(jumpEl) }
    jumpEl.innerHTML = jumpIds.map((id, i) => `<button role="option" data-jump="${id}" class="${i === jumpSel ? 'on' : ''}" tabindex="-1">${tile(id, 26, 7, 15)}<span>${id === 'chat' || siteOf(id) || groupOf(id) ? `Open ${esc(appMeta(id).label)}` : `Go to ${esc(appMeta(id).label)}`}</span>${icon('arrow', 16)}</button>`).join('')
  }
  function jump(id) {
    closeJump()
    const q = document.getElementById('q')
    q.value = ''
    q.blur()
    openTab(id)
  }
  function wireSearch() {
    const q = document.getElementById('q')
    if (!q) return
    q.addEventListener('input', () => { jumpSel = 0; paintJump() })
    q.addEventListener('focus', paintJump)
    q.addEventListener('blur', () => setTimeout(closeJump, 150))
    q.addEventListener('keydown', e => {
      if (!jumpIds.length) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); jumpSel = (jumpSel + (e.key === 'ArrowDown' ? 1 : jumpIds.length - 1)) % jumpIds.length; paintJump() }
      else if (e.key === 'Enter') { e.preventDefault(); jump(jumpIds[jumpSel]) }
      else if (e.key === 'Escape') closeJump()
    })
    q.closest('.search').addEventListener('pointerdown', e => { const b = e.target.closest('[data-jump]'); if (b) { e.preventDefault(); jump(b.dataset.jump) } })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireSearch)
  else wireSearch()

  window.HUB = {
    get settings() { return S },
    save, flush, refresh, on: fn => (listeners.add(fn), () => listeners.delete(fn)),
    // Send a patch now (after anything queued) and take the hub's answer; throws its error.
    patch: async body => { await flush(); accept(await api('/api/hub/settings', body)); return S },
    visibleTabs, pluginTabs, syncTabs, orderOf,
    apps: () => S.apps.filter(id => id === 'chat' || known(id) || !!siteOf(id) || !!groupOf(id)),
    groups: () => S.groups || [], groupOf,
    allApps: () => [...orderOf().filter(t => t !== 'home'), 'chat', ...(S.sites || []).map(x => x.id)],
    appMeta, openApp: openTab, tile, icon,
    sites: () => S.sites || [], siteOf, siteTile, iconSrc, siteIcon, webUrl, hostOf,
    openSite, closeSite, siteCard, embedCheck,
    openTabs, openStyle, closeStyle: closePanel, contextMenu,
    walls: WALLS,
  }
  // For the chat agent and any other page: see HUB-GUIDE.md "Website apps".
  window.hub = Object.assign(window.hub || {}, { openSite, siteCard, embedCheck })
})()
