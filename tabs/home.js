// Home tab: a homescreen of widgets drawn from everything in the hub, built on one
// widget system (three sizes, 20px cards, fit rule, detail view, lift on hover).
//   * Desktop layout: cells at least 202px, 22px gaps, as many columns as fit the shared page
//     width, stretched so the grid lines up with every other tab.
//   * Mobile layout: 2 columns (168px), shown in a phone frame on a desktop and used as is on a phone.
//   * Edit: wiggle, drag to reorder (touch + mouse), size button, remove badge, "Add widget" gallery.
//   * Layouts are saved on the hub (/api/home/layout) so all your devices share them.
// Other tabs add widgets with window.registerHomeWidget(def) or HOME_WIDGETS.push(def):
//   { id, label, labels?: { s: 'Short' }, cat, icon, tint, tab, sizes: ['s','m','l'], defaultSize,
//     sources: ['ai', ...], blurb, connect?, render(data, size, ui) -> html, detail?(data, ui, size) -> html }
// Sources are in HOME_SOURCES ({ url, optional?, check?, pick? } or { read() }). ui is HOME_UI (parts).
// Uses the main script's globals at call time: api, setEnv, env, ago, hud, alertBox, data, store.
;(() => {
  const SRC_STALE = 55_000
  const EASE = 'cubic-bezier(.32,.72,0,1)'
  const mq = q => (window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} })
  const PHONE = mq('(max-width: 720px)')
  const TABLET = mq('(pointer: coarse) and (hover: none) and (min-width: 721px)')
  const VIEWS = ['desktop', 'ipad', 'mobile', 'tv']
  const REDUCED = mq('(prefers-reduced-motion: reduce)')
  const pref = (k, d, ok) => { try { const v = localStorage.getItem(k); return ok.includes(v) ? v : d } catch { return d } }
  const save = (k, v) => { try { localStorage.setItem(k, v) } catch {} }
  const showing = () => typeof env !== 'undefined' && env === 'home'

  /* ---------- small helpers ---------- */

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const clamp = (n, a = 0, b = 100) => Math.min(b, Math.max(a, Number.isFinite(n) ? n : 0))
  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3)
  const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0)
  const compact = n => {
    const a = Math.abs(n)
    const f = (v, u) => `${v.toFixed(v >= 100 ? 0 : 1).replace(/\.0$/, '')}${u}`
    return a >= 1e9 ? f(n / 1e9, 'B') : a >= 1e6 ? f(n / 1e6, 'M') : a >= 1e3 ? f(n / 1e3, 'K') : String(Math.round(n))
  }
  const bytes = b => {
    if (!(b >= 0)) return '–'
    const u = ['B', 'KB', 'MB', 'GB', 'TB']
    let i = 0
    while (b >= 1024 && i < 4) { b /= 1024; i++ }
    return `${i < 2 ? b.toFixed(0) : b >= 100 ? b.toFixed(0) : b >= 10 ? b.toFixed(1) : b.toFixed(2)} ${u[i]}`.replace(/(\.\d*?)0+ /, '$1 ').replace(/\. /, ' ')
  }
  const until = ms => {
    if (!(ms > 0)) return 'now'
    const m = Math.round(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24)
    return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${Math.max(1, m)}m`
  }
  const tone = (p, warn = 65, bad = 85) => (p >= bad ? 'bad' : p >= warn ? 'warn' : '')
  const TONE = { '': 'var(--green)', warn: 'var(--orange)', bad: 'var(--red)', blue: 'var(--blue)' }
  const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  const fmtTime = d => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const fmtDay = d => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const toDate = v => {
    if (v == null || v === '') return null
    if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v)
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v))
    if (m) return new Date(+m[1], +m[2] - 1, +m[3])
    const d = new Date(v)
    return isNaN(d) ? null : d
  }
  const digitsOf = cur => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(cur).toUpperCase() }).resolvedOptions().maximumFractionDigits } catch { return 2 } }
  const moneyMajor = (v, cur = 'USD', round) => {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(cur).toUpperCase(), maximumFractionDigits: round ? 0 : 2, minimumFractionDigits: round ? 0 : 2 }).format(v) } catch { return `${Number(v).toFixed(2)} ${cur}` }
  }
  const money = (minor, cur = 'usd', round) => moneyMajor((Number(minor) || 0) / 10 ** digitsOf(cur), cur, round)

  const ICONS = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 18 4-5"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M14.6 9.4C14.1 8.5 13.2 8 12 8c-1.5 0-2.6.8-2.6 2s1 1.6 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.2 0-2.1-.5-2.6-1.4M12 6.5V8m0 8v1.5"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>',
    cloud: '<path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.2 4.5 4.5 0 0 0 7 18z"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6 6 0 0 1 3.5 5.5"/>',
    drive: '<path d="M3 15.5 6.6 5.6A2.5 2.5 0 0 1 9 4h6a2.5 2.5 0 0 1 2.4 1.6L21 15.5"/><rect x="3" y="15.5" width="18" height="5" rx="2"/><path d="M17 18h.01"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4m8-4v4"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/>',
    trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    laptop: '<rect x="4.5" y="5" width="15" height="10.5" rx="2"/><path d="M2.5 19h19"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    resize: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    open: '<path d="M7 17 17 7M8 7h9v9"/>',
    pencil: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    dot: '',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  }
  Object.assign(ICONS, {
    minus: '<path d="M5 12h14"/>',
    layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  })
  const hic = (name, size) => (window.HUB ? window.HUB.icon(name, size) : icon(name, size))
  const icon = (name, size = 13) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.grid}</svg>`

  /* ---------- style (once) ---------- */

  const css = `
:root { --hw-lift: 0 18px 34px -16px rgba(0, 0, 0, .3); --hw-sheet-shadow: 0 24px 70px rgba(0, 0, 0, .35); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --hw-lift: 0 18px 34px -14px rgba(0, 0, 0, .85); --hw-sheet-shadow: 0 24px 70px rgba(0, 0, 0, .7); } }
:root[data-theme="dark"] { --hw-lift: 0 18px 34px -14px rgba(0, 0, 0, .85); --hw-sheet-shadow: 0 24px 70px rgba(0, 0, 0, .7); }

.hw-root { --u: 202px; --uh: 190px; --gap: 22px; --tile: 58px; min-width: 0; }
.hw-root[data-view="mobile"] { --uh: 198px; --gap: 14px; --tile: 54px; }

.hw-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 12px; margin: 0 0 20px; min-height: 32px; }
:root[data-density="compact"] .hw-root { --gap: 14px; --tile: 52px; }
:root[data-density="roomy"] .hw-root { --gap: 30px; --tile: 64px; }
:root[data-density="compact"] .hw-root[data-view="mobile"] { --gap: 10px; --tile: 50px; }
:root[data-density="roomy"] .hw-root[data-view="mobile"] { --gap: 20px; --tile: 60px; }
.scrim:has(> .alert) { z-index: 90; }
.hw-dlist + .hw-wide { margin-top: 12px; }
.hw-pages { display: flex; gap: 6px; margin: -8px 0 16px; overflow-x: auto; scrollbar-width: none; }
.hw-pages::-webkit-scrollbar { display: none; }
.hw-pages[hidden] { display: none; }
.hw-page { flex: none; height: 32px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--fill); color: var(--label); font: 500 14px var(--font); cursor: pointer; }
.hw-page[aria-selected="true"] { background: var(--blue); color: #fff; }
.hw-file { display: block; flex: 1; width: 100%; height: 100%; min-height: 0; border: 0; border-radius: 10px; background: transparent; }
.hw-prev .hw-file, .hw-drag-on .hw-file { pointer-events: none; }
.seg.hw-seg { min-width: 0; width: 320px; margin: 0; flex: none; }
.hw-root[data-phone="1"] .hw-seg { display: none; }
.hw-hint { flex: 1 1 180px; min-width: 0; color: var(--label-2); font-size: 13px; letter-spacing: -0.006em; }
.hw-hint:empty { display: none; }
.hw-hint.err { color: var(--red); }
.hw-bar-r { margin-left: auto; display: flex; gap: 8px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.hw-bar-r::-webkit-scrollbar { display: none; }
.hw-bar-r > .hw-btn { flex: none; }
@media (max-width: 900px) {
  .hw-btn.hw-iconly { width: 32px; padding: 0; justify-content: center; }
  .hw-btn.hw-iconly .hw-btn-t { display: none; }
}
.hw-btn { height: 32px; padding: 0 14px; border-radius: 99px; background: var(--fill); color: var(--blue); font-size: 15px; font-weight: 600; letter-spacing: -0.016em; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; transition: opacity .15s, transform .15s; }
.hw-btn:active { opacity: .45; transform: scale(.96); }
.hw-btn[hidden] { display: none; }
.hw-btn.solid { background: var(--blue); color: #fff; }
.hw-btn.tint { background: color-mix(in srgb, var(--blue) 14%, transparent); }
.hw-btn.red { color: var(--red); }
.hw-pill { height: 30px; padding: 0 14px; border-radius: 99px; background: var(--fill); color: var(--blue); font-size: 15px; font-weight: 600; letter-spacing: -0.016em; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; transition: opacity .15s, transform .15s; }
.hw-pill:active { opacity: .45; transform: scale(.96); }
.hw-btn:focus-visible, .hw-pill:focus-visible, .hw-x:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }

.hw-stage { display: flex; justify-content: center; }
/* Home never scrolls: its pages move sideways, and each holds what fits between the top and the chat bar. */
html:has(.hw-root) { overflow: hidden; overscroll-behavior: none; }
html:has(.hw-root) .page { padding-bottom: 0 !important; }
.hw-frame { display: flex; flex-direction: column; width: 100%; min-width: 0; padding-bottom: calc(76px + env(safe-area-inset-bottom)); }
.hw-device { display: contents; }
/* iPad and Mobile on a bigger screen: a device drawn at scale, whose pages move inside it. */
.hw-root[data-framed="1"] .hw-stage { display: block; position: relative; height: calc((var(--fh) + 2 * var(--fb)) * var(--fk)); }
.hw-root[data-framed="1"] .hw-device { display: block; position: absolute; left: 50%; top: calc(var(--fb) * var(--fk)); width: var(--fw); height: var(--fh); margin-left: calc(var(--fw) / -2); transform: scale(var(--fk)); transform-origin: top center; border-radius: var(--fr); overflow: hidden; box-shadow: 0 0 0 1px rgba(255, 255, 255, .14), 0 0 0 var(--fb) #101012, 0 0 0 calc(var(--fb) + 1px) rgba(255, 255, 255, .16), 0 18px 60px rgba(0, 0, 0, .4); }
.hw-root[data-framed="1"] .hw-frame { width: 100%; height: 100%; padding: var(--fpt) var(--fpx) 18px; }
.hw-root[data-framed="1"][data-view="mobile"] .hw-device::before { content: ""; position: absolute; z-index: 3; top: 11px; left: 50%; width: 112px; height: 32px; margin-left: -56px; border-radius: 99px; background: #101012; pointer-events: none; }
.hw-root[data-framed="1"] .hw-device::after { content: ""; position: absolute; z-index: 3; bottom: 8px; left: 50%; width: 134px; height: 5px; margin-left: -67px; border-radius: 99px; background: var(--label); opacity: .35; pointer-events: none; }
.hw-root[data-framed="1"][data-view="ipad"] .hw-device::after { width: 220px; margin-left: -110px; }
/* Infinite scroll: the pages become one long grid that scrolls down, and there are no page dots. */
.hw-root[data-scroll="infinite"] .hw-pager { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; }
.hw-root[data-scroll="infinite"] .hw-pager::-webkit-scrollbar { display: none; }
.hw-root[data-scroll="infinite"] .hw-grid { padding-bottom: var(--gap); }
.hw-root[data-scroll="infinite"] .hw-dots { display: none; }
.seg.hw-scroll { flex: none; width: 236px; min-width: 0; margin: 0; }
.seg.hw-scroll[hidden] { display: none; }
/* TV: LocalHub TV itself (/tv/), live and scaled onto a 16:9 screen on a stand, with what it uses beside it in Edit. */
.hw-tv { display: flex; justify-content: center; align-items: flex-start; gap: 28px; height: var(--tvh, 600px); min-width: 0; }
.hw-tv[hidden], .hw-root[data-view="tv"] .hw-stage, .hw-root[data-view="tv"] .hw-pages { display: none; }
.hw-tv-screen { flex: none; display: flex; flex-direction: column; align-items: center; width: var(--tvw, 960px); padding: 12px 12px 0; }
.hw-tv-glass { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 10px; overflow: hidden; background: #000; box-shadow: 0 0 0 1px rgba(255, 255, 255, .14), 0 0 0 12px #101012, 0 0 0 13px rgba(255, 255, 255, .16), 0 18px 60px rgba(0, 0, 0, .4); }
.hw-tv-float { position: fixed; z-index: 9; border-radius: 10px; overflow: hidden; background: #000; visibility: hidden; }
.hw-tv-float iframe { width: 100%; height: 100%; border: 0; display: block; }
.hw-tv-neck { width: 70px; height: 30px; margin-top: 12px; background: #1c1c1e; }
.hw-tv-base { width: 260px; height: 12px; border-radius: 0 0 10px 10px; background: #2c2c2e; }
.hw-tv-side { flex: 0 1 360px; min-width: 280px; height: 100%; overflow-y: auto; overscroll-behavior: contain; padding: 0 2px 24px; scrollbar-width: thin; }
.hw-tv-side[hidden] { display: none; }
.hw-tv-side .hw-dsec + .hw-dsec { margin-top: 22px; }
.hw-tv-side .hw-dsec > p { margin: 8px 2px 0; font-size: 13px; line-height: 1.35; color: var(--label-2); letter-spacing: -0.006em; }
.hw-tv-side .hw-applist .hw-row .t { flex: 1; max-width: none; }
.hw-tv-mini { flex: none; position: relative; width: 44px; height: 28px; border-radius: 7px; overflow: hidden; display: grid; place-items: center; background: var(--a-bg, #2c2c2e); color: var(--a-fg, #fff); box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .18); font: 800 13px var(--font); }
.hw-tv-mini i { width: 70%; height: 66%; background: currentColor; -webkit-mask: var(--glyph) center / contain no-repeat; mask: var(--glyph) center / contain no-repeat; }
.hw-tv-mini img { width: 100%; height: 100%; object-fit: cover; }
.hw-tv-side .seg.hw-tv-seg { min-width: 0; width: 100%; margin: 0; }
.hw-tv-side p.err { color: var(--red); }
.hw-tv-side input[type="range"] { flex: 1 1 auto; min-width: 0; accent-color: var(--blue); }
.hw-tv-side .hw-row .s.hw-tv-secs { flex: none; width: 44px; max-width: none; text-align: right; font-variant-numeric: tabular-nums; }
.hw-tv-input { flex: 1 1 auto; min-width: 0; height: 30px; padding: 0 10px; border-radius: 8px; border: 0; background: var(--fill); color: var(--label); font: 14px var(--font); }
.hw-tv-input:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; }
.hw-tv-photos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 10px; }
.hw-tv-photos img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px; background: var(--fill); display: block; }
.hw-tv-wait { padding: 28px 4px; color: var(--label-2); font-size: 15px; }
.hw-root[data-intv="1"] .hw-tv-side { flex: 1 1 auto; max-width: 720px; }
@media (max-width: 900px) {
  .hw-tv { flex-direction: column; align-items: center; overflow-y: auto; }
  .hw-tv-side { flex: none; width: 100%; max-width: 560px; height: auto; overflow: visible; }
}
/* One grid for apps and widgets, like an iPhone: an app takes one slot, a small widget 2 by 2, medium 4 by 2, large 4 by 4. */
/* A page reaches the edges of the window or device, so one sliding away leaves the whole screen. */
.hw-pager { position: relative; flex: 1 1 0; min-height: 0; margin-left: calc(var(--hw-bl, 0px) * -1); margin-right: calc(var(--hw-br, 0px) * -1); padding-left: var(--hw-bl, 0px); padding-right: var(--hw-br, 0px); overflow-x: clip; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
.hw-grid { display: grid; grid-template-columns: repeat(var(--cols, 8), minmax(0, 1fr)); grid-auto-rows: var(--hw-rh, calc((var(--uh) - var(--gap)) / 2)); gap: var(--gap); }
.hw-dots { flex: none; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, auto) minmax(0, 1fr); align-items: center; gap: 8px; height: 32px; margin-top: 6px; }
.hw-dots-in { grid-column: 2; display: flex; align-items: center; justify-content: center; width: calc(var(--n, 1) * 18px); max-width: 100%; min-width: 0; }
.hw-pdot { flex: 0 1 18px; min-width: 6px; height: 32px; display: grid; place-items: center; border-radius: 8px; }
.hw-pdot::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--label); opacity: .28; transition: opacity .2s; }
.hw-pdot[aria-current="true"]::before { opacity: .85; }
.hw-pdot:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
.hw-dots .hw-pgl { grid-column: 1; justify-self: start; }
.hw-dots .hw-pgr { grid-column: 3; justify-self: end; }
.hw-blank { display: flex; align-items: center; justify-content: center; text-align: center; padding: 0 16px; color: var(--label-2); font-size: 15px; }
.hw-root[data-view="mobile"] .hw-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); justify-content: stretch; }
.hw-cell { position: relative; min-width: 0; min-height: 0; }
.hw-cell.s { grid-column: span 2; grid-row: span 2; }
.hw-cell.m { grid-column: span 4; grid-row: span 2; }
.hw-cell.l { grid-column: span 4; grid-row: span 4; }
.hw-cell.a { display: flex; align-items: center; justify-content: center; }
.hw-cell.a > .hw-app { width: 100%; }
.hw-empty { grid-column: 1 / span var(--cols, 4); text-align: center; color: var(--label-2); padding: 56px 16px; font-size: 15px; }

/* The widget card */
.hw-card { position: relative; width: 100%; height: 100%; overflow: hidden; border-radius: var(--hub-radius, 20px); padding: 16px; display: flex; flex-direction: column; gap: 10px; min-width: 0; background: var(--surface); color: var(--label); box-shadow: 0 0 0 .5px var(--sep); text-align: left; }
.hw-label { display: flex; align-items: center; gap: 8px; align-self: flex-start; max-width: 100%; flex: none; font-size: 13px; font-weight: 600; color: var(--label-2); letter-spacing: -0.006em; }
.hw-tile { width: 20px; height: 20px; border-radius: 6px; background: color-mix(in srgb, var(--t, var(--blue)) 16%, transparent); color: var(--t, var(--blue)); display: grid; place-items: center; flex: none; }
.hw-body { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 10px; }
.hw-body:has(> .hw-list) { justify-content: flex-start; }
.hw-card[data-size="l"] .hw-list { gap: 14px; }
.hw-cell { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
.hw-body > * { flex: none; }
.hw-body > .hw-grow { flex: 1 1 0; min-height: 64px; }
.hw-body.hw-inline { display: block; height: auto; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

.hw-card.live { cursor: pointer; transition: transform .2s var(--ease), box-shadow .2s ease; }
@media (hover: hover) { .hw-card.live:hover { transform: translateY(-3px); box-shadow: 0 0 0 .5px var(--sep), var(--hw-lift); } }
.hw-card.live:active { transform: translateY(0) scale(.985); }
.hw-card.live:focus-visible { outline: 2px solid var(--blue); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { .hw-card.live { transition: none; } .hw-card.live:hover, .hw-card.live:active { transform: none; } }

/* Parts */
.hw-fig { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.hw-fig .v { display: flex; align-items: baseline; gap: 6px; font: 700 32px/1.05 var(--rounded); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hw-fig .v small { font-size: 15px; font-weight: 600; color: var(--label-2); letter-spacing: -0.01em; }
.hw-fig.sm .v { font-size: 26px; }
.hw-card[data-dev="mobile"][data-size="s"] .hw-fig .v { font-size: 26px; }
.hw-sub { font-size: 13px; color: var(--label-2); letter-spacing: -0.006em; min-width: 0; }
.hw-sub.c { text-align: center; }
.hw-sub b { color: var(--label); font-weight: 600; }
.hw-meter { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.hw-meter .ml { display: flex; gap: 8px; font-size: 13px; letter-spacing: -0.006em; }
.hw-meter .ml em { flex: 1; font-style: normal; color: var(--label-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.hw-meter .ml b { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.hw-track { display: block; height: 6px; border-radius: 3px; background: var(--fill-2); overflow: hidden; }
.hw-fill { display: block; height: 100%; border-radius: 3px; background: var(--green); }
.hw-fill.warn { background: var(--orange); }
.hw-fill.bad { background: var(--red); }
.hw-fill.blue { background: var(--blue); }
.hw-list { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.hw-row { display: flex; align-items: center; gap: 9px; min-width: 0; font-size: 15px; letter-spacing: -0.016em; line-height: 1.25; }
.hw-row .t { flex: 1 1 auto; min-width: 0; }
.hw-row .s { flex: 0 1 auto; max-width: 45%; color: var(--label-2); font-size: 13px; letter-spacing: -0.006em; }
.hw-row .r { flex: none; font-weight: 600; font-size: 13px; font-variant-numeric: tabular-nums; }
.hw-row .tm { flex: none; width: 62px; color: var(--label-2); font-size: 13px; font-variant-numeric: tabular-nums; }
.hw-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--c, var(--gray)); }
.hw-dayh { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--label-2); padding-top: 2px; }
.hw-cols { display: grid; grid-template-columns: repeat(var(--n, 2), minmax(0, 1fr)); gap: 14px; min-width: 0; }
.hw-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.hw-col h4 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.016em; }
.hw-col .hw-sub { margin-top: -4px; }
.hw-ringwrap { display: grid; place-items: center; }
.hw-ring { position: relative; flex: none; }
.hw-ring svg { display: block; }
.hw-ring span { position: absolute; inset: 0; display: grid; place-items: center; font: 700 var(--rs, 20px) var(--rounded); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.hw-rings { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; justify-items: center; }
.hw-rings > div { display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 13px; color: var(--label-2); }
.hw-split { display: flex; gap: 1.5px; height: 10px; border-radius: 5px; overflow: hidden; background: var(--fill-2); }
.hw-split i { display: block; height: 100%; }
.hw-spark { display: block; width: 100%; height: 44px; }
.hw-spark .l { fill: none; stroke: var(--c, var(--blue)); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.hw-spark .a { fill: var(--c, var(--blue)); opacity: .14; stroke: none; }
.hw-chart { position: relative; }
.hw-chart svg { display: block; width: 100%; height: 100%; overflow: visible; }
.hw-chart .g { fill: none; stroke: var(--sep); stroke-width: 1; vector-effect: non-scaling-stroke; }
.hw-chart .ln { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.hw-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--label-2); }
.hw-legend span { display: inline-flex; align-items: center; gap: 6px; }
.hw-legend i { display: inline-block; width: 10px; height: 3px; border-radius: 2px; }
.hw-clock .v { display: flex; align-items: baseline; gap: 5px; font: 700 40px/1 var(--rounded); letter-spacing: -0.03em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.hw-clock .v small { font-size: 15px; font-weight: 600; color: var(--label-2); letter-spacing: -0.01em; }
.hw-card[data-dev="mobile"][data-size="s"] .hw-clock .v { font-size: 32px; }
.hw-clock .d { margin-top: 6px; font-size: 15px; font-weight: 500; letter-spacing: -0.016em; }
.hw-split2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; min-width: 0; }
.hw-evt .t { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 17px; font-weight: 600; letter-spacing: -0.022em; line-height: 1.22; }
.hw-note { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; color: var(--label-2); font-size: 13px; letter-spacing: -0.006em; }
.hw-skel { display: flex; flex-direction: column; justify-content: center; gap: 10px; }
.hw-skel i { display: block; border-radius: 8px; background: var(--fill); animation: hw-pulse 1.4s ease-in-out infinite; }
@keyframes hw-pulse { 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) { .hw-skel i { animation: none; } }

.hw-donutwrap { display: flex; align-items: center; gap: 16px; min-width: 0; }
.hw-donutwrap .hw-list { flex: 1; min-width: 0; }
.hw-links { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
.hw-link { height: 40px; border-radius: 12px; background: var(--fill); color: var(--label); font-size: 15px; font-weight: 600; letter-spacing: -0.016em; display: flex; align-items: center; justify-content: center; gap: 7px; min-width: 0; padding: 0 8px; transition: opacity .15s, transform .15s; }
.hw-link:active { opacity: .5; transform: scale(.97); }
.hw-link svg { color: var(--blue); flex: none; }
.hw-month { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 1px 0; text-align: center; font-size: 13px; font-variant-numeric: tabular-nums; }
.hw-mhead { display: flex; align-items: baseline; justify-content: space-between; font-size: 15px; font-weight: 600; letter-spacing: -0.016em; margin-bottom: 6px; }
.hw-mhead span { color: var(--label-2); font-size: 12px; font-weight: 500; }
.hw-month .wd { color: var(--label-2); font-size: 12px; font-weight: 600; padding-bottom: 2px; }
.hw-month .dn { position: relative; height: 31px; display: grid; place-items: center; }
.hw-month .dn b { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-weight: 500; }
.hw-month .dn.td b { background: var(--red); color: #fff; font-weight: 700; }
.hw-month .dn.off { color: var(--label-3); }
.hw-month .dn i { position: absolute; bottom: 0; width: 5px; height: 5px; border-radius: 50%; background: var(--blue); }
.hw-bigdate { display: flex; flex-direction: column; gap: 2px; }
.hw-bigdate .n { font: 700 56px/1 var(--rounded); letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.hw-bigdate .w { font-size: 15px; font-weight: 600; color: var(--red); text-transform: uppercase; letter-spacing: .04em; }
.hw-bigdate .m { font-size: 15px; color: var(--label-2); letter-spacing: -0.016em; }
.hw-gsearch { margin: 0 20px 12px; flex: none; position: relative; }
.hw-gsearch input { width: 100%; height: 36px; border: 0; outline: 0; -webkit-appearance: none; appearance: none; border-radius: 10px; background: var(--fill); padding: 0 12px 0 34px; font-size: 16px; color: var(--label); letter-spacing: -0.016em; transition: box-shadow .2s var(--ease); }
.hw-gsearch input:focus { box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--blue) 30%, transparent); }
.hw-gsearch svg { position: absolute; left: 11px; top: 10px; color: var(--label-2); pointer-events: none; }
.hw-gnone { text-align: center; color: var(--label-2); padding: 30px 0; font-size: 15px; }

/* Edit mode */
.hw-edit .hw-cell { cursor: grab; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: pan-y; }
.hw-edit .hw-card { animation: hw-wiggle .27s ease-in-out infinite alternate; pointer-events: none; }
.hw-edit .hw-cell:nth-child(even) .hw-card { animation-duration: .31s; animation-direction: alternate-reverse; }
.hw-edit .hw-cell:nth-child(3n) .hw-card { animation-delay: -.12s; }
@keyframes hw-wiggle { from { transform: rotate(-.5deg); } to { transform: rotate(.5deg); } }
@media (prefers-reduced-motion: reduce) { .hw-edit .hw-card { animation: none; } }
.hw-ctl { position: absolute; z-index: 4; }
.hw-del { top: -7px; left: -7px; width: 22px; height: 22px; border-radius: 50%; background: var(--gray); color: #fff; display: grid; place-items: center; box-shadow: 0 1px 3px rgba(0, 0, 0, .3); }
.hw-del::after, .hw-size::after { content: ""; position: absolute; inset: -8px; }
.hw-size { right: 10px; top: 10px; height: 24px; padding: 0 10px; border-radius: 99px; background: var(--menu-bg); -webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px); color: var(--blue); font-size: 13px; font-weight: 600; box-shadow: 0 0 0 .5px var(--sep); }
.hw-ctl:active { opacity: .5; }
.hw-cell.hw-dragging { z-index: 20; cursor: grabbing; will-change: transform; }
.hw-cell.hw-dragging .hw-card { animation: none; box-shadow: 0 26px 50px -14px rgba(0, 0, 0, .45), 0 0 0 .5px var(--sep); }
.hw-sorting, .hw-sorting .hw-cell, .hw-sorting .hw-app-b, .hw-sorting .hw-ctl { cursor: grabbing !important; }
/* A drag holds still what it doesn't need: each running wiggle is restyled on every frame. Paused, they carry on from where they stopped. */
.hw-sorting .hw-card, .hw-sorting .hw-app-b, .hw-sorting .hw-sk { animation-play-state: paused !important; }
.hw-sorting .hw-size { -webkit-backdrop-filter: none; backdrop-filter: none; }
[data-hw-fgrid] > .hw-app.drag { will-change: transform; }
html[data-effect="grain"] body::after { transition: opacity .2s ease; }
html.hw-drag-on[data-effect="grain"] body::after { opacity: 0; }

/* Detail view + gallery: a centered popup on desktop, a slide-up sheet at phone width */
/* One sheet for everything: Add to Home, Edit Tabs, details and options. One inset (20), one rhythm (20), one type scale. */
.scrim.hw-scrim { display: flex; align-items: center; justify-content: center; padding: 24px 16px 96px; background: rgba(0, 0, 0, 0); animation: none; transition: background .22s ease; z-index: 75; }
.scrim.hw-scrim.on { background: rgba(0, 0, 0, .34); }
.hw-sheet { position: relative; width: min(560px, 100%); max-height: min(calc(100dvh - 120px), 720px); display: flex; flex-direction: column; background: var(--menu-bg); -webkit-backdrop-filter: saturate(180%) blur(30px); backdrop-filter: saturate(180%) blur(30px); color: var(--label); border-radius: 22px; box-shadow: 0 0 0 .5px var(--sep), var(--hw-sheet-shadow); opacity: 0; transform: translateY(14px) scale(.98); transition: opacity .2s ease, transform .3s var(--ease); overflow: hidden; }
.hw-sheet:focus { outline: 0; }
.hw-scrim.on .hw-sheet { opacity: 1; transform: none; }
.hw-sh-top { flex: none; touch-action: none; }
.hw-grab { display: none; width: 40px; height: 5px; border-radius: 3px; background: var(--label-3); margin: 8px auto 0; }
.hw-sh-head { display: flex; align-items: center; gap: 10px; padding: 18px 20px 12px; }
.hw-sh-head h2 { flex: 1; min-width: 0; margin: 0; font: 600 17px var(--display); letter-spacing: -0.022em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hw-sh-head .hw-tile { width: 26px; height: 26px; border-radius: 8px; }
.hw-x { width: 32px; height: 32px; border-radius: 50%; background: var(--fill-2); color: var(--label-2); display: grid; place-items: center; flex: none; }
.hw-done { color: var(--blue); font-weight: 600; font-size: 17px; padding: 4px 0 4px 6px; }
.hw-sh-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-width: none; display: flex; flex-direction: column; gap: 20px; padding: 8px 20px 24px; -webkit-mask-image: linear-gradient(transparent, #000 8px, #000 calc(100% - 20px), transparent); mask-image: linear-gradient(transparent, #000 8px, #000 calc(100% - 20px), transparent); }
.hw-sh-body::-webkit-scrollbar { display: none; }
.hw-sh-body > * { flex: none; }
.hw-sh-foot { flex: none; display: flex; flex-wrap: wrap; gap: 10px; padding: 12px 20px calc(16px + env(safe-area-inset-bottom)); border-top: .5px solid var(--sep); }
.hw-sh-foot[hidden] { display: none; }
.hw-sh-foot .hw-btn { height: 40px; padding: 0 20px; font-size: 15px; flex: 1 1 140px; justify-content: center; }
@media (max-width: 700px) {
  .scrim.hw-scrim { align-items: flex-end; padding: 0; }
  .hw-sheet { width: 100%; max-height: calc(100dvh - 44px - env(safe-area-inset-top)); border-radius: 22px 22px 0 0; transform: translateY(100%); opacity: 1; padding-bottom: env(safe-area-inset-bottom); }
  .hw-scrim.on .hw-sheet { transform: none; }
  .hw-grab { display: block; }
  .hw-sh-top { cursor: grab; }
  .hw-sh-head { padding-top: 10px; }
}
@media (prefers-reduced-motion: reduce) { .scrim.hw-scrim, .hw-sheet { transition: none; } .hw-sheet { transform: none; } }
@media (max-width: 700px) and (prefers-reduced-motion: reduce) { .hw-sheet { transform: none; } .hw-scrim:not(.on) .hw-sheet { opacity: 0; } }

.hw-dsec h3 { margin: 0 0 8px; padding: 0; font-size: 13px; font-weight: 400; text-transform: uppercase; letter-spacing: -0.006em; color: var(--label-2); }
.hw-dlist { background: var(--fill); border-radius: 12px; overflow: hidden; }
.hw-dlist > * { padding: 11px 14px; min-height: 44px; display: flex; align-items: center; gap: 12px; font-size: 15px; letter-spacing: -0.016em; }
.hw-dlist > * + * { border-top: .5px solid var(--sep); }
.hw-dlist .hw-row { font-size: 15px; }
.hw-dlist .hw-row .s { max-width: 55%; }
.hw-dlist .hw-meter { display: flex; flex-direction: column; align-items: stretch; gap: 6px; }
.hw-dkv > span { flex: 1; min-width: 0; }
.hw-dkv > b { font-weight: 500; color: var(--label-2); font-variant-numeric: tabular-nums; text-align: right; }
.hw-dhero .v { font: 700 40px/1.05 var(--rounded); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.hw-dhero .v small { font-size: 18px; font-weight: 600; color: var(--label-2); margin-left: 4px; }
.hw-dhero .hw-sub { font-size: 15px; margin-top: 4px; }
.hw-dchart { height: 120px; }
.hw-dnote { color: var(--label-2); font-size: 15px; }

.hw-gsec { display: flex; flex-direction: column; gap: 20px; }
.hw-gsec + .hw-gsec { margin-top: 8px; }
.hw-gsec h3 { margin: 0 0 -8px; font: 600 17px var(--display); letter-spacing: -0.022em; color: var(--label); }
.hw-gitem { display: flex; flex-direction: column; gap: 10px; }
.hw-ghead { display: flex; flex-direction: column; gap: 2px; }
.hw-ghead b { font-size: 15px; font-weight: 600; letter-spacing: -0.016em; }
.hw-ghead span { color: var(--label-2); font-size: 13px; letter-spacing: -0.006em; }
.hw-gstage { display: flex; align-items: center; justify-content: center; height: calc(var(--ph) * var(--k) + 24px); border-radius: 16px; background: var(--fill); overflow: hidden; transition: height .25s var(--ease); }
.hw-gfoot { display: flex; align-items: center; gap: 12px; }
.seg.hw-seg.hw-gsize { flex: 0 1 240px; width: auto; min-width: 0; }
.hw-gfoot .hw-btn { margin-left: auto; flex: none; }
.hw-prev { position: relative; width: calc(var(--pw) * var(--k)); height: calc(var(--ph) * var(--k)); flex: none; }
.hw-prev > .hw-card { position: absolute; left: 0; top: 0; width: var(--pw); height: var(--ph); transform: scale(var(--k)); transform-origin: 0 0; pointer-events: none; }

/* Depth: a soft wash of the widget's colour from the top corner, and a solid colour tile. */
.hw-card::before { content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: inherit; background: radial-gradient(130% 90% at 0% 0%, color-mix(in srgb, var(--t, var(--blue)) 13%, transparent), transparent 62%); }
.hw-card > * { position: relative; }
.hw-label .hw-tile { background: linear-gradient(160deg, color-mix(in srgb, var(--t, var(--blue)) 72%, #fff), var(--t, var(--blue))); color: #fff; box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .25); }
.hw-label .hw-tile svg { width: 12px; height: 12px; }
.hw-fig .v { background: linear-gradient(180deg, var(--label), color-mix(in srgb, var(--label) 78%, var(--t, var(--blue)))); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.hw-fig .v small { -webkit-text-fill-color: var(--label-2); }

/* Apps: iOS-style icons that open a tab */
.hw-app { position: relative; display: flex; justify-content: center; min-width: 0; }
.hw-app-b { display: flex; flex-direction: column; align-items: center; gap: 7px; min-width: 0; width: 100%; padding: 2px 0; border-radius: 16px; color: var(--label); transition: transform .15s var(--ease), opacity .15s; }
.hw-app-b:active { transform: scale(.92); opacity: .7; }
.hw-app-b:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.hw-app-b .hc-app { box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .25), 0 6px 14px -6px rgba(0, 0, 0, .35); }
.hw-app-l { max-width: 100%; font-size: 13px; font-weight: 500; letter-spacing: -0.006em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hw-app-b > .hc-app { width: var(--tile) !important; height: var(--tile) !important; }
html[data-wall] .hw-app-l { text-shadow: 0 1px 3px color-mix(in srgb, var(--bg) 70%, transparent); }
.hw-edit .hw-app:not(.add) .hw-app-b { animation: hw-wiggle .27s ease-in-out infinite alternate; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.hw-edit .hw-cell:nth-child(even) > .hw-app .hw-app-b { animation-direction: alternate-reverse; animation-duration: .31s; }
@media (prefers-reduced-motion: reduce) { .hw-edit .hw-app .hw-app-b { animation: none; } }
.hw-app .hw-del { top: -5px; left: calc(50% - var(--tile) / 2 - 7px); }
.hw-app.drag { z-index: 30; }
.hw-app.drag .hw-app-b { animation: none; transform: scale(1.12); opacity: .94; }
.hw-app.drag .hw-app-b > .hc-app { box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .25), 0 18px 30px -10px rgba(0, 0, 0, .5); }
.hw-app.drag .hw-del { display: none; }
.hw-app.merge .hw-app-b { animation: none; transform: scale(1.12); }
.hw-app.merge .hw-app-b > .hc-app { box-shadow: 0 0 0 6px rgba(120, 120, 128, .38), 0 10px 22px -8px rgba(0, 0, 0, .4); }
.hw-app-b .hc-folder > .hc-app { box-shadow: none; }
.hw-cell.a.hw-dragging { z-index: 30; }
.hw-cell.a.hw-merge { transform: none; }
.hw-cell.a.hw-merge .hw-app-b { animation: none; transform: scale(1.12); }
.hw-cell.a.hw-merge .hw-app-b > .hc-app { box-shadow: 0 0 0 6px rgba(120, 120, 128, .38), 0 10px 22px -8px rgba(0, 0, 0, .4); }

/* App icons follow Edit Style like the widgets do: corners, depth, Solid / Glass / Outline and Glow. */
.hw-app-b > .hc-app { border-radius: min(calc(var(--hub-radius, 20px) * .75), 26%) !important; }
html[data-shadow] .hw-app-b > .hc-app { box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .25), var(--hub-shadow); }
html[data-look="glass"] .hw-app-b > .hc-app:not(.hc-folder) { color: color-mix(in srgb, var(--a1) 55%, var(--a2)); background: linear-gradient(160deg, color-mix(in srgb, var(--a1) 30%, transparent), color-mix(in srgb, var(--a2) 16%, transparent)), color-mix(in srgb, var(--surface) var(--hub-alpha), transparent); -webkit-backdrop-filter: saturate(180%) blur(var(--hub-blur)); backdrop-filter: saturate(180%) blur(var(--hub-blur)); box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .4), var(--hub-shadow); }
html[data-look="outline"] .hw-app-b > .hc-app:not(.hc-folder) { color: color-mix(in srgb, var(--a1) 55%, var(--a2)); background: color-mix(in srgb, var(--surface) 20%, transparent); box-shadow: inset 0 0 0 1.5px var(--sep); }
html[data-look="outline"] .hw-app-b > .hc-folder { background: color-mix(in srgb, var(--surface) 20%, transparent); box-shadow: inset 0 0 0 1.5px var(--sep); }
html[data-effect="glow"] .hw-app-b > .hc-app { box-shadow: var(--hub-shadow), 0 0 0 .5px color-mix(in srgb, var(--blue) 45%, transparent), 0 10px 28px -12px color-mix(in srgb, var(--blue) 60%, transparent); }
.seg.hw-seg.hw-addseg { margin: 0 20px 12px; width: auto; }
.hw-addon small { display: block; font-size: 13px; color: var(--label-2); letter-spacing: -0.006em; margin-top: 2px; }
.hw-hrow .hw-rename { flex: 1; min-width: 0; height: 30px; border: 0; outline: 0; border-radius: 8px; background: var(--fill); padding: 0 8px; font-size: 15px; color: var(--label); letter-spacing: -0.016em; }
.hw-hrow .hw-rename:focus { box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 30%, transparent); }
.hw-applist .hw-row.hw-hrow .t { flex: 1; max-width: none; }

/* Groups: a frosted folder that grows out of its icon */
.scrim.hw-fscrim { -webkit-backdrop-filter: blur(0); backdrop-filter: blur(0); transition: background .22s ease, backdrop-filter .3s ease, -webkit-backdrop-filter .3s ease; }
.scrim.hw-fscrim.on { background: rgba(0, 0, 0, .22); -webkit-backdrop-filter: blur(22px) saturate(140%); backdrop-filter: blur(22px) saturate(140%); }
.scrim.hw-scrim.hw-fscrim { align-items: center; padding: 16px; }
.hw-fold { width: min(440px, 100%); max-height: min(80vh, 640px); overflow: auto; padding: 22px 18px 26px; border-radius: 38px; background: color-mix(in srgb, var(--surface) 64%, transparent); -webkit-backdrop-filter: blur(40px) saturate(180%); backdrop-filter: blur(40px) saturate(180%); box-shadow: 0 0 0 .5px var(--sep), var(--hw-sheet-shadow); opacity: 0; transform: scale(.92); transition: opacity .2s ease, transform .3s var(--ease); }
.hw-fscrim.on .hw-fold { opacity: 1; transform: none; }
.hw-ftitle { display: block; width: 100%; margin: 0 0 18px; padding: 6px 12px; border: 0; border-radius: 12px; background: transparent; color: var(--label); font: inherit; font-size: 26px; font-weight: 700; letter-spacing: -0.022em; text-align: center; outline: none; transition: background .15s; }
.hw-ftitle:hover, .hw-ftitle:focus { background: var(--fill); }
.hw-fgrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px 6px; }
.hw-fscrim { --tile: 58px; }
.hw-fedit .hw-app:not(.drag) .hw-app-b { animation: hw-wiggle .27s ease-in-out infinite alternate; }
.hw-fedit .hw-app-b { cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.hw-fedit .hw-app:nth-child(even) .hw-app-b { animation-direction: alternate-reverse; animation-duration: .31s; }
@media (prefers-reduced-motion: reduce) { .hw-fedit .hw-app .hw-app-b { animation: none; } }

/* Stacks: same-size widgets in one cell, swiped through like an iPhone Smart Stack */
.hw-sk { position: absolute; inset: 0; overflow-x: hidden; overflow-y: auto; scroll-snap-type: y mandatory; border-radius: var(--hub-radius, 20px); scrollbar-width: none; }
.hw-sk::-webkit-scrollbar { display: none; }
.hw-sk-pg { height: 100%; scroll-snap-align: start; scroll-snap-stop: always; }
.hw-sk-dots { position: absolute; z-index: 3; right: 6px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 4px; pointer-events: none; }
.hw-sk-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--label); opacity: .2; transition: opacity .2s; }
.hw-sk-dots i.on { opacity: .7; }
.hw-edit .hw-sk-cell .hw-card { animation: none; }
.hw-edit .hw-sk { animation: hw-wiggle .27s ease-in-out infinite alternate; }
@media (prefers-reduced-motion: reduce) { .hw-edit .hw-sk { animation: none; } }
.hw-cell.hw-dragging > .hw-sk { animation: none; box-shadow: 0 26px 50px -14px rgba(0, 0, 0, .45), 0 0 0 .5px var(--sep); }
.hw-cell.hw-merge { transform: scale(.95); transition: transform .2s var(--ease); }
.hw-cell.hw-merge > .hw-card, .hw-cell.hw-merge > .hw-sk { box-shadow: 0 0 0 3px var(--blue); }

/* Richer parts */
.hw-dual { display: grid; place-items: center; }
.hw-dual svg { display: block; overflow: visible; }
.hw-acc { display: flex; align-items: center; gap: 12px; min-width: 0; }
.hw-acc > div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.hw-acc h4 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.016em; }
.hw-acc .k { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--label-2); font-variant-numeric: tabular-nums; }
.hw-acc .k b { color: var(--label); font-weight: 600; }
.hw-acc .k i { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.hw-card[data-dev="mobile"] .hw-acc { gap: 8px; }
.hw-card[data-dev="mobile"][data-size="s"] .hw-wc, .hw-card[data-dev="mobile"][data-size="s"] .hw-wc .r { font-size: 13px !important; }
.hw-ringrow { display: flex; align-items: center; gap: 14px; min-width: 0; }
.hw-ringrow > div:last-child { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
.hw-bars { display: flex; align-items: stretch; gap: 7px; min-height: 70px; }
.hw-bars .b { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; min-width: 0; }
.hw-bars .b > span { flex: 1; width: 100%; display: flex; align-items: flex-end; }
.hw-bars .b i { display: block; width: 100%; min-height: 3px; border-radius: 5px; background: linear-gradient(180deg, color-mix(in srgb, var(--t) 60%, #fff), var(--t)); opacity: .45; }
.hw-bars .b.on i { opacity: 1; }
.hw-bars .b em { font-style: normal; font-size: 12px; font-weight: 600; color: var(--label-2); }
.hw-bars .b.on em { color: var(--label); }
.hw-analog { display: grid; place-items: center; }
.hw-analog svg { display: block; }
.hw-analog .face { fill: color-mix(in srgb, var(--surface) 70%, var(--fill)); stroke: var(--sep); }
.hw-analog .tk { stroke: var(--label-2); stroke-linecap: round; }
.hw-analog .hh, .hw-analog .mh { stroke: var(--label); stroke-linecap: round; }
.hw-analog .sh { stroke: var(--t, var(--orange)); stroke-linecap: round; }
.hw-clockm { display: flex; align-items: center; gap: 18px; min-width: 0; }
.hw-clockm .hw-clock { min-width: 0; }
.hw-clock .v .sec { font-size: .5em; color: var(--label-2); font-weight: 600; margin-left: 2px; }
.hw-clock.big .v { font-size: 56px; }
.hw-card[data-dev="mobile"][data-size="s"] .hw-clock.big .v { font-size: 40px; }
.hw-evt2 { display: flex; gap: 12px; min-width: 0; }
.hw-evt2 .rail { flex: none; width: 4px; border-radius: 2px; background: linear-gradient(180deg, var(--t), color-mix(in srgb, var(--t) 40%, transparent)); }
.hw-evt2 > div { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.hw-evt2 .cd { font: 700 26px/1.05 var(--rounded); letter-spacing: -0.02em; color: var(--t); font-variant-numeric: tabular-nums; white-space: nowrap; }
.hw-evt2 .t { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 15px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.22; }
.hw-tl { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.hw-tlrow { display: flex; align-items: stretch; gap: 10px; min-width: 0; font-size: 15px; letter-spacing: -0.016em; }
.hw-tlrow .tm { flex: none; width: 64px; color: var(--label-2); font-size: 13px; font-variant-numeric: tabular-nums; padding-top: 1px; }
.hw-tlrow .bar { flex: none; width: 3px; border-radius: 2px; background: var(--t); }
.hw-tlrow .t { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.hw-tlrow .t b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hw-tlrow .t span { color: var(--label-2); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hw-tlrow.past { opacity: .5; }
.hw-tlrow.now .bar { background: var(--green); box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 25%, transparent); }
.hw-stack { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.hw-stk { display: flex; align-items: center; gap: 10px; min-width: 0; }
.hw-stk .ic { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; color: #fff; flex: none; background: linear-gradient(160deg, color-mix(in srgb, var(--c) 70%, #fff), var(--c)); }
.hw-stk .l { flex: 1; min-width: 0; font-size: 15px; color: var(--label-2); letter-spacing: -0.016em; }
.hw-stk .n { font: 700 26px/1 var(--rounded); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.hw-connect { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 8px; min-height: 0; }
.hw-connect .ic { width: 44px; height: 44px; border-radius: 13px; display: grid; place-items: center; color: #fff; background: linear-gradient(160deg, color-mix(in srgb, var(--t) 70%, #fff), var(--t)); box-shadow: 0 8px 18px -8px var(--t); }
.hw-connect b { font-size: 15px; font-weight: 600; letter-spacing: -0.02em; }
.hw-connect span { font-size: 13px; color: var(--label-2); line-height: 1.3; max-width: 300px; }
.hw-card[data-size="s"] .hw-connect > span:not(.ic) { display: none; }

/* Widget options sheet */
.hw-opt { display: flex; flex-direction: column; gap: 10px; }
.hw-opt h3 { margin: 0; padding: 0; font-size: 13px; font-weight: 400; text-transform: uppercase; color: var(--label-2); letter-spacing: -0.006em; }
.hw-swatches { display: flex; flex-wrap: wrap; gap: 10px; padding: 0 2px; }
.hw-sw { width: 34px; height: 34px; border-radius: 50%; background: var(--c); display: grid; place-items: center; color: #fff; box-shadow: inset 0 0 0 .5px rgba(0, 0, 0, .15); transition: transform .15s; }
.hw-sw.def { background: conic-gradient(from 90deg, #ff3b30, #ff9500, #ffcc00, #34c759, #0a84ff, #7a5af8, #ff3b30); }
.hw-sw[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--c, var(--blue)); }
.hw-sw:active { transform: scale(.9); }
.hw-segopt { display: flex; gap: 4px; padding: 3px; border-radius: 10px; background: var(--fill); }
.hw-segopt button { flex: 1; height: 32px; border-radius: 8px; font-size: 15px; font-weight: 600; color: var(--label); letter-spacing: -0.016em; }
.hw-segopt button[aria-pressed="true"] { background: var(--thumb); box-shadow: var(--thumb-shadow); }
.hw-applist .hw-row { font-size: 15px; }
.hw-applist .hw-row .s { flex: 1; min-width: 0; max-width: none; color: var(--label-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hw-applist .hw-row .t { flex: none; max-width: 45%; }
@media (max-width: 720px) {
  .hw-applist .hw-row:not(.hw-hrow):has(> .s:not(:empty)) { display: grid; grid-template-columns: auto minmax(0, 1fr); grid-auto-columns: auto; column-gap: 9px; row-gap: 1px; }
  .hw-applist .hw-row:not(.hw-hrow):has(> .s:not(:empty)) > :first-child { grid-row: 1 / 3; }
  .hw-applist .hw-row:not(.hw-hrow):has(> .s:not(:empty)) > .t { grid-column: 2; grid-row: 1; max-width: none; }
  .hw-applist .hw-row:not(.hw-hrow):has(> .s:not(:empty)) > .s { grid-column: 2; grid-row: 2; }
  .hw-applist .hw-row:not(.hw-hrow):has(> .s:not(:empty)) > :nth-child(n+4) { grid-row: 1 / 3; }
}
.hw-applist .hw-ib { flex: none; width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; color: var(--label-2); }
.hw-applist .hw-ib:active { opacity: .45; }
.hw-applist .hw-ib:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.hw-siteform > .hw-frow { gap: 12px; padding: 0 14px; min-height: 48px; }
.hw-frow > span { flex: none; width: 74px; color: var(--label); }
.hw-frow input { flex: 1; min-width: 0; height: 46px; background: none; border: 0; outline: 0; font-size: 16px; letter-spacing: -0.02em; color: var(--label); }
.hw-frow input::placeholder { color: var(--label-3); }
.hw-frow.sw > span { flex: 1; width: auto; }
.hw-siteform + .hw-wide, .hw-wide + .hw-wide { margin-top: 12px; }
.hw-wide { width: 100%; height: 48px; border-radius: 13px; background: var(--fill); color: var(--blue); font-size: 17px; font-weight: 600; letter-spacing: -0.022em; display: flex; align-items: center; justify-content: center; gap: 7px; }
.hw-wide.solid { background: var(--blue); color: #fff; }
.hw-wide.red { color: var(--red); }
.hw-wide:active { opacity: .5; }
.hw-wide:disabled { opacity: .45; }
.hw-wide:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.hw-applist .hc-app { width: 32px; height: 32px; border-radius: 9px; }
`
  if (!document.getElementById('hw-style')) {
    const el = document.createElement('style')
    el.id = 'hw-style'
    el.textContent = css
    document.head.append(el)
  }

  /* ---------- parts shared by every widget (also exported as HOME_UI) ---------- */

  const dot = c => `<i class="hw-dot" style="--c:${c}"></i>`
  const fig = (v, sub, o = {}) => `<div class="hw-fig${o.sm ? ' sm' : ''}"><div class="v">${v}</div>${sub ? `<div class="hw-sub ell">${sub}</div>` : ''}</div>`
  const meter = (label, value, p, t = '') => `<div class="hw-meter" data-fit><div class="ml"><em>${esc(label)}</em><b>${value}</b></div><div class="hw-track"><span class="hw-fill ${t}" style="width:${clamp(p)}%"></span></div></div>`
  const row = o => `<div class="hw-row">${o.dot ? dot(o.dot) : ''}${o.tm ? `<span class="tm ell">${esc(o.tm)}</span>` : ''}<span class="t ell">${esc(o.t)}</span>${o.s ? `<span class="s ell">${esc(o.s)}</span>` : ''}${o.r != null ? `<span class="r">${o.r}</span>` : ''}</div>`
  const list = rows => `<div class="hw-list" data-fit-list>${rows.join('')}</div>`
  const note = (text, btn = '') => `<div class="hw-note" data-fit><span>${text}</span>${btn}</div>`
  const openBtn = (tab, label) => `<button type="button" class="hw-pill" data-hw-open="${esc(tab)}">${esc(label)}</button>`
  const cols = (n, items) => `<div class="hw-cols" style="--n:${n}">${items.join('')}</div>`
  const SKELETON = '<div class="hw-skel" aria-busy="true" aria-label="Loading"><i style="width:55%;height:24px"></i><i style="width:82%;height:12px"></i></div>'
  const split = parts => `<div class="hw-split" data-fit>${parts.filter(p => p.p > 0).map(p => `<i style="width:${p.p}%;background:${p.c}" title="${esc(p.l || '')}"></i>`).join('')}</div>`
  const ring = (p, t, center, size = 84, sw = 9, fs = 20) => {
    const r = (size - sw) / 2, c = 2 * Math.PI * r, m = size / 2
    return `<div class="hw-ring" style="width:${size}px;height:${size}px;--rs:${fs}px"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${m}" cy="${m}" r="${r}" fill="none" stroke="var(--fill-2)" stroke-width="${sw}"/>${p > 0.5 ? `<circle cx="${m}" cy="${m}" r="${r}" fill="none" stroke="${TONE[t] || t}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${((c * clamp(p)) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${m} ${m})"/>` : ''}</svg><span>${center}</span></div>`
  }
  function spark(vals, o = {}) {
    const v = (vals || []).map(x => Number(x) || 0)
    if (v.length < 2) return ''
    const h = o.h || 44, max = Math.max(...v), min = Math.min(...v, 0), span = max - min || 1
    const pts = v.map((x, i) => [(i / (v.length - 1)) * 100, h - 3 - ((x - min) / span) * (h - 6)])
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ')
    return `<svg class="hw-spark" viewBox="0 0 100 ${h}" preserveAspectRatio="none" style="${o.c ? `--c:${o.c};` : ''}height:${h}px" aria-hidden="true"><path class="a" d="${line} L100 ${h} L0 ${h} Z"/><path class="l" d="${line}"/></svg>`
  }
  const dsec = (title, html) => `<section class="hw-dsec"><h3>${esc(title)}</h3>${html}</section>`
  const dlist = rows => `<div class="hw-dlist">${rows.join('')}</div>`
  const dkv = (k, v) => `<div class="hw-dkv"><span>${esc(k)}</span><b>${v}</b></div>`
  const dhero = (v, sub) => `<div class="hw-dhero"><div class="v">${v}</div>${sub ? `<div class="hw-sub">${sub}</div>` : ''}</div>`
  const empty = text => `<div class="hw-dnote">${text}</div>`

  // Two lines: the 5-hour and the 7-day Claude limits, as percent of the plan, over time.
  function usageChart(hist, cls = 'hw-grow') {
    const pts = (hist || []).filter(p => Array.isArray(p) && p.length >= 3 && Number.isFinite(p[0]))
    if (pts.length < 2) return `<div class="hw-sub" data-fit>Usage history shows here once a few readings are in.</div>`
    const t0 = pts[0][0], span = Math.max(1, pts[pts.length - 1][0] - t0)
    const line = i => pts.map((p, k) => `${k ? 'L' : 'M'}${(((p[0] - t0) / span) * 100).toFixed(2)} ${(100 - clamp(p[i])).toFixed(2)}`).join(' ')
    return `<div class="${cls}"><div class="hw-chart" style="height:100%;min-height:56px"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Claude usage over time" role="img"><path class="g" d="M0 0H100M0 50H100M0 100H100"/><path class="ln" stroke="var(--orange)" d="${line(2)}"/><path class="ln" stroke="var(--blue)" d="${line(1)}"/></svg></div></div>`
      + `<div class="hw-legend" data-fit><span><i style="background:var(--blue)"></i>5 hour</span><span><i style="background:var(--orange)"></i>7 day</span></div>`
  }

  // Two rings, one inside the other (the 5-hour limit outside, the 7-day limit inside).
  function dualRing(a, b, center, size = 92, ca = 'var(--blue)', cb = 'var(--orange)') {
    const sw = Math.max(7, Math.round(size / 10)), m = size / 2, r1 = (size - sw) / 2, r2 = r1 - sw - 3
    const arc = (r, p, c) => { const L = 2 * Math.PI * r; return `<circle cx="${m}" cy="${m}" r="${r}" fill="none" style="stroke:color-mix(in srgb, ${c} 18%, transparent)" stroke-width="${sw}"/>${p > 0.5 ? `<circle cx="${m}" cy="${m}" r="${r}" fill="none" style="stroke:${c}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${((L * clamp(p)) / 100).toFixed(1)} ${L.toFixed(1)}" transform="rotate(-90 ${m} ${m})"/>` : ''}` }
    return `<div class="hw-ring" style="width:${size}px;height:${size}px;--rs:${Math.round(size / 4.6)}px"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">${arc(r1, a, ca)}${arc(r2, b, cb)}</svg><span>${center}</span></div>`
  }
  // Vertical bars with a short label under each; the last one is highlighted.
  const bars = (vals, labels, cls = 'hw-grow') => {
    const max = Math.max(1, ...vals)
    return `<div class="hw-bars ${cls}" data-fit>${vals.map((v, i) => `<div class="b${i === vals.length - 1 ? ' on' : ''}" title="${esc(labels[i])}: ${compact(v)}"><span><i style="height:${Math.max(3, (v / max) * 100).toFixed(1)}%"></i></span><em>${esc(labels[i])}</em></div>`).join('')}</div>`
  }
  // An empty state that asks to connect something, with a button to the tab that does it.
  // Where a key or sign-in is what's missing, the button opens that service's sheet right here.
  const connectBtn = (service, tab) => (service && window.HUB_CONNECT ? `<button type="button" class="hw-pill" data-connect="${esc(service)}">Connect</button>` : tab ? openBtn(tab, `Open ${tabName(tab)}`) : '')
  const connect = (title, sub, tab, ic = 'card', service) => `<div class="hw-connect" data-fit><span class="ic">${icon(ic, 22)}</span><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}${connectBtn(service, tab)}</div>`

  const H = { esc, clamp, pct, compact, bytes, until, tone, money, moneyMajor, toDate, dot, fig, meter, row, list, note, openBtn, cols, split, ring, spark, usageChart, dsec, dlist, dkv, dhero, empty, icon, SKELETON, TONE, dualRing, bars, connect }
  window.HOME_UI = Object.assign(window.HOME_UI || {}, H)

  /* ---------- registry ---------- */

  if (!Array.isArray(window.HOME_WIDGETS)) window.HOME_WIDGETS = Object.values(window.HOME_WIDGETS || {})
  window.registerHomeWidget = def => {
    const l = window.HOME_WIDGETS
    const i = l.findIndex(w => w && w.id === def.id)
    if (i < 0) l.push(def)
    else l[i] = def
    if (S.root) scheduleRepaint()
  }
  const normWidget = w => {
    const sizes = (w.sizes || ['s', 'm', 'l']).filter(s => 's m l'.includes(s))
    return { ...w, sizes: sizes.length ? sizes : ['s'], defaultSize: sizes.includes(w.defaultSize) ? w.defaultSize : sizes[0] || 's', sources: w.sources || (w.source ? [].concat(w.source) : []) }
  }
  // A widget of an add-on that is off stays out of the gallery and the page, and fetches nothing.
  const CONF = window.HUB_CONF || {}
  const SOURCE_ADDON = { ai: 'ai', cloud: 'cloud', stripe: 'stripe', calendar: 'calendar', 'calendar-month': 'calendar', drives: 'drives', icloud: 'icloud' }
  const addonOff = id => !!CONF.addons?.[id] && !CONF.addons[id].on
  const tabOff = t => !!CONF.addons?.[t]?.tab && !CONF.addons[t].on
  const widgetOn = w => w.id === 'hub-status' ? ['laptop', 'server', 'ai', 'cloud'].some(t => !tabOff(t)) : !w.sources.some(s => addonOff(SOURCE_ADDON[s])) && (!w.sources.includes('state') || !tabOff(w.tab))
  const tidy = w => (tabOff(w.tab) ? { ...w, tab: '' } : w)
  // A family is a set of widgets made from live data (one per Claude account, per Coolify app, per drive...).
  // { prefix: 'drive.', source: 'drives', cat, items(data) -> [{ key, label }], make(key, label) -> widget def }
  const FAMILIES = (window.HOME_FAMILIES ||= [])
  window.registerHomeFamily = fam => {
    const i = FAMILIES.findIndex(f => f.prefix === fam.prefix)
    if (i < 0) FAMILIES.push(fam)
    else FAMILIES[i] = fam
    if (S.root) scheduleRepaint()
  }
  const slug = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'x'
  const prettyKey = k => String(k).replace(/[-_.]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  function familyWidget(f, key, label) {
    return normWidget({ cat: f.cat, tab: f.tab, icon: f.icon, tint: f.tint, ...f.make(key, label), id: f.prefix + key, label, sources: f.make(key, label).sources || [f.source] })
  }
  const widgetMap = (withItems = false) => {
    const m = new Map()
    for (const w of Object.values(window.HOME_WIDGETS || {})) if (w && w.id && typeof w.render === 'function' && widgetOn(normWidget(w))) m.set(w.id, tidy(normWidget(w)))
    for (const f of window.HUB?.files?.() || []) m.set(f.id, tidy(normWidget({ id: f.id, label: f.name, cat: 'Your Files', blurb: 'Your own file, shown sandboxed', sizes: f.sizes, defaultSize: f.sizes?.[0], sources: [], render: () => `<iframe class="hw-file" src="/api/hub/custom/${esc(f.id)}" title="${esc(f.name)}" sandbox="allow-scripts" loading="lazy" referrerpolicy="no-referrer"></iframe>` })))
    const used = new Set()
    for (const vk of VIEWS) for (const it of S.layout?.[vk] || []) used.add(it.id)
    for (const f of FAMILIES) {
      if (addonOff(SOURCE_ADDON[f.source]) || (f.source === 'state' && tabOff(f.tab))) continue
      const live = new Map()
      try { for (const x of f.items(srcStatus(f.source) === 'ok' ? dataFor({ sources: [f.source] }) : {}) || []) live.set(x.key, x.label) } catch {}
      for (const [key, label] of live) if (withItems || used.has(f.prefix + key)) m.set(f.prefix + key, familyWidget(f, key, label))
      for (const id of used) if (id.startsWith(f.prefix) && !m.has(id)) { const key = id.slice(f.prefix.length); m.set(id, familyWidget(f, key, `${f.title || ''}${prettyKey(key)}`)) }
    }
    return m
  }
  const TAB_NAMES = { ai: 'AI', cloud: 'Cloud', calendar: 'Calendar', stripe: 'Stripe', drives: CONF.addons?.drives?.on ? 'Drives' : 'Files', laptop: 'Laptop', server: 'Server', home: 'Home' }
  const tabName = t => TAB_NAMES[t] || (window.TABS?.[t]?.title) || String(t || '')

  /* ---------- data sources ---------- */

  const SOURCES = {
    state: { read: () => (typeof data !== 'undefined' ? data : null) },
    ai: { url: '/api/ai/state' },
    cloud: { url: '/api/cloud/state' },
    drives: { url: '/api/files/drives?path=' },
    icloud: { url: '/api/icloud/storage', check: j => { if (j && j.error) throw new Error(j.error) } },
    stripe: { url: '/api/stripe/state', optional: true },
    calendar: { url: '/api/calendar/upcoming?days=7', optional: true },
    'calendar-month': { url: '/api/calendar/upcoming?days=62', optional: true },
    downloads: { url: '/api/files/laptop?path=Downloads', pick: recentPick },
    desktop: { url: '/api/files/laptop?path=Desktop', pick: recentPick },
  }
  function recentPick(j) {
    return (j.entries || []).filter(e => e && e.name && !e.name.startsWith('.') && !/^desktop\.ini$/i.test(e.name)).sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).slice(0, 25)
  }
  const isNet = e => e instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed|aborted/i.test(e?.message || '')
  const sourceDefs = () => ({ ...SOURCES, ...(window.HOME_SOURCES || {}) })
  const savedPage = () => { try { return localStorage.getItem('hub-home-page') || 'main' } catch { return 'main' } }
  const S = {
    page: savedPage(), pages: [], layouts: null,
    root: null, layout: null, layoutErr: '', mode: (() => { try { const v = new URLSearchParams(location.search).get('view'); if (VIEWS.includes(v)) { save('hub-home-mode', v); return v } } catch {} return pref('hub-home-mode', 'desktop', VIEWS) })(), editing: false,
    framed: false, frameK: 1, dirty: { desktop: false, ipad: false, mobile: false, tv: false }, timers: {}, saving: {}, lastLoad: 0, src: {}, sig: '', drag: null, overlay: null,
    pending: false, started: false, hubSig: '', raf: 0,
    // Sideways pages: the one on screen in each view, an empty one just added, how far the grid is moved, and what fits.
    at: { desktop: 0, ipad: 0, mobile: 0, tv: 0 }, extra: 0, px: 0, sheets: [[]], q: '', geo: { w: 0, h: 0, gap: 22, unit: 84, bleed: 0, cols: 8, rows: 6, stride: 0 },
  }
  const onMain = () => S.page === 'main'
  const rec = id => (S.src[id] ||= { data: null, err: '', missing: false, at: 0, p: null })

  function srcStatus(id) {
    const def = sourceDefs()[id]
    if (!def) return 'error'
    if (def.read) return def.read() ? 'ok' : 'loading'
    const r = rec(id)
    return r.data ? 'ok' : r.missing ? 'missing' : r.err ? 'error' : 'loading'
  }
  const srcData = id => { const def = sourceDefs()[id]; return def?.read ? def.read() : rec(id).data }

  function loadSource(id, force) {
    const def = sourceDefs()[id]
    if (!def || def.read || !def.url) return Promise.resolve()
    const r = rec(id)
    if (r.p) return r.p
    if (!force && r.data && Date.now() - r.at < SRC_STALE) return Promise.resolve()
    r.p = (async () => {
      let again = 0
      try {
        const res = await hubFetch(def.url, { cache: 'no-store' })
        const j = await res.json().catch(() => ({}))
        if (res.status === 404 && def.optional) { r.missing = true; r.data = null; r.err = '' }
        else if (!res.ok) { const er = new Error(j.error || `${res.status} ${res.statusText}`); er.transient = res.status === 502 || res.status === 503 || res.status === 504; throw er }
        else {
          def.check?.(j)
          r.data = def.pick ? def.pick(j) : j
          r.err = ''
          r.missing = false
          r.fails = 0
        }
      } catch (e) {
        // The hub restarts now and then while it is being worked on. A dropped request is retried
        // quietly (cards keep the last good numbers, or a skeleton); only a long outage shows a message.
        r.fails = (r.fails || 0) + 1
        if (isNet(e) || e.transient) {
          if (r.fails <= 6) again = Math.min(1500 * r.fails, 8000)
          else if (!r.data) r.err = 'The hub isn’t answering right now.'
        } else if (!r.data) r.err = e.message || 'failed'
      }
      r.at = Date.now()
      r.p = null
      if (again) setTimeout(() => { if (!r.p && showing()) loadSource(id, true) }, again)
      scheduleRepaint()
    })()
    return r.p
  }
  const loadSources = (ids, force) => Promise.all([...new Set(ids)].map(id => loadSource(id, force)))

  /* ---------- layouts ---------- */

  const DEFAULTS = {
    desktop: [['claude-usage', 'm'], ['clock', 's'], ['next-event', 's'], ['tokens', 'm'], ['coolify', 's'], ['services', 's'], ['today', 'm'], ['stripe-balance', 's'], ['openrouter', 's'], ['server-health', 'm'], ['deepseek', 's'], ['icloud', 's'], ['drives', 'm'], ['backup-drive', 's'], ['laptop-health', 's'], ['servers', 'l'], ['revenue', 'm'], ['clients', 'm']],
    tv: [['clock', 's'], ['date', 's'], ['world-clock', 's'], ['next-event', 's'], ['claude-usage', 's']],
    mobile: [['claude-usage', 's'], ['clock', 's'], ['next-event', 's'], ['coolify', 's'], ['today', 'm'], ['tokens', 'm'], ['openrouter', 's'], ['deepseek', 's'], ['stripe-balance', 's'], ['icloud', 's'], ['server-health', 'm'], ['drives', 'm'], ['services', 's'], ['backup-drive', 's'], ['servers', 'm']],
  }
  const PLAIN = {
    desktop: [['clock', 's'], ['date', 's'], ['world-clock', 's']],
    mobile: [['clock', 's'], ['date', 's'], ['world-clock', 'm']],
    tv: [['clock', 's'], ['date', 's'], ['world-clock', 's']],
  }
  const startLayout = name => {
    if (name === 'ipad') name = 'desktop'
    const on = DEFAULTS[name].filter(([id]) => { const w = Object.values(window.HOME_WIDGETS || {}).find(x => x?.id === id); return w && widgetOn(normWidget(w)) })
    return on.length >= (name === 'tv' ? 3 : 4) ? on : PLAIN[name]
  }
  const seedLayout = name => startLayout(name).map(([id, size], i) => ({ key: `${name[0]}${i + 1}-${id}`.slice(0, 40), id, size }))
  // A real phone or iPad always shows its own layout, full screen. On a bigger screen the toggle picks one.
  // Inside LocalHub TV the hub is a full-screen app on a TV, not a tablet, so the toggle stays.
  const IN_TV = (() => { try { return window.parent !== window && !!window.parent.haven } catch { return false } })()
  const realDevice = () => !IN_TV && (PHONE.matches || TABLET.matches)
  const viewKey = () => (realDevice() ? (PHONE.matches ? 'mobile' : 'ipad') : S.mode)
  // Pages (sideways, like an iPhone) or one long vertical scroll, chosen per view in Edit and kept on the hub.
  // The TV scrolls by default, like tvOS; its view here is LocalHub TV itself.
  const SCROLL_DEFAULT = { desktop: 'pages', ipad: 'pages', mobile: 'pages', tv: 'infinite' }
  const scrollOf = vk => S.scroll?.[vk] || SCROLL_DEFAULT[vk] || 'pages'
  const infinite = () => viewKey() !== 'tv' && scrollOf(viewKey()) === 'infinite'
  const layoutItems = vk => (S.layout ? S.layout[vk] || [] : [])
  // A layout holds widgets and app places ({ id: 'app', app }); in memory an app place has the key app:<id>.
  const isAppItem = it => it?.id === 'app'
  const appItem = id => ({ key: `app:${id}`, id: 'app', app: id })
  const withKeys = l => l.map(it => (isAppItem(it) ? { ...appItem(it.app), ...(it.br ? { br: true } : {}) } : it))
  // What Home shows, in order: every widget, and every app on Home at its place. An app with no place yet
  // (new, or a group that took another app's spot) goes next to its neighbour in the app order; with no
  // placed app at all, apps go first, so older layouts keep their apps on top.
  function homeItems(vk) {
    if (!onMain()) return [...layoutItems(vk)]
    const on = appList(), seen = new Set(), out = []
    let carry = false
    const put = it => { if (carry) it.br = true; carry = false; out.push(it) }
    for (const it of layoutItems(vk)) {
      if (!isAppItem(it)) { put(it); continue }
      if (on.includes(it.app) && !seen.has(it.app)) { seen.add(it.app); put(it) }
      // An app that left Home doesn't take its page's start with it.
      else if (it.br) carry = true
    }
    const at = id => out.findIndex(x => isAppItem(x) && x.app === id)
    let lead = 0
    on.forEach((id, n) => {
      if (seen.has(id)) return
      const prev = on.slice(0, n).reverse().find(x => seen.has(x)), next = on.slice(n + 1).find(x => seen.has(x))
      const i = prev ? at(prev) + 1 : next ? at(next) : lead++
      out.splice(i, 0, appItem(id))
      seen.add(id)
    })
    return out
  }
  const sizeOf = (it, w) => (w.sizes.includes(it.size) ? it.size : w.defaultSize)

  async function fetchJson(url) {
    const res = await hubFetch(url, { cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error || `${res.status} ${res.statusText}`)
    return j
  }

  // Home and each extra page have their own three layouts; S.layout is always the one on screen.
  function takeLayout(pid, src, force) {
    const l = (S.layouts[pid] ||= { desktop: [], mobile: [], tv: [] }), live = pid === S.page
    for (const k of VIEWS) if ((force || !live || (!S.dirty[k] && !S.editing)) && Array.isArray(src[k])) l[k] = withKeys(src[k])
    l.ipad ||= l.desktop.map(it => ({ ...it }))
  }
  function takePages(list, force) {
    S.pages = list
    for (const p of list) takeLayout(p.id, p.widgets || {}, force)
    for (const id of Object.keys(S.layouts)) if (id !== 'main' && !list.some(p => p.id === id)) delete S.layouts[id]
    if (!S.layouts[S.page]) S.page = 'main'
    S.layout = S.layouts[S.page]
  }
  async function loadLayout(force) {
    try {
      const j = await fetchJson('/api/home/layout')
      S.layoutErr = ''
      S.layoutAt = Number(j.at) || S.layoutAt
      if (j.scroll && !S.scrollSaving) S.scroll = { ...SCROLL_DEFAULT, ...j.scroll }
      S.layouts ||= {}
      takeLayout('main', j, force)
      takePages(j.pages || [], force)
    } catch (e) {
      S.layoutErr = isNet(e) ? 'reconnecting' : e.message || 'unreachable'
      if (!S.layout) {
        S.page = 'main'
        S.layouts = { main: { desktop: seedLayout('desktop'), ipad: seedLayout('ipad'), mobile: seedLayout('mobile'), tv: seedLayout('tv') } }
        S.layout = S.layouts.main
      }
      clearTimeout(S.layoutRetry)
      S.layoutRetry = setTimeout(async () => { await loadLayout(); scheduleRepaint() }, 2500)
    }
  }

  function saveSoon(vk, now) {
    S.dirty[vk] = true
    clearTimeout(S.timers[vk])
    S.timers[vk] = setTimeout(() => flush(vk), now ? 0 : 700)
  }
  const layoutBody = vk => (onMain() ? { [vk]: S.layout[vk] } : { page: S.page, [vk]: S.layout[vk] })
  async function flush(vk) {
    if (!S.dirty[vk] || S.saving[vk]) return
    const page = S.page
    S.dirty[vk] = false
    S.saving[vk] = true
    try {
      const out = await api('/api/home/layout', layoutBody(vk))
      S.layoutAt = Number(out?.at) || S.layoutAt
      S.layoutErr = ''
    } catch (e) {
      if (page === S.page) S.dirty[vk] = true
      const net = isNet(e) || /502|503|504/.test(e?.message || '')
      S.layoutErr = net ? 'reconnecting' : e.message || 'unreachable'
      if (!net) hud('Couldn’t save the layout')
      clearTimeout(S.timers[vk])
      S.timers[vk] = setTimeout(() => flush(vk), 3000)
    }
    S.saving[vk] = false
    updateBar()
  }
  addEventListener('pagehide', () => {
    for (const vk of VIEWS) if (S.dirty[vk]) try { fetch('/api/home/layout', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify(layoutBody(vk)) }) } catch {}
  })

  // Show another Home page. What is unsaved on this one goes out first.
  async function openPage(id) {
    if (!S.layouts) { S.page = id; return }
    if (id !== 'main' && !S.layouts[id]) {
      if (!window.HUB?.pageOf?.(id)) return
      S.layouts[id] = { desktop: [], ipad: [], mobile: [], tv: [] }
    }
    if (id === S.page) return
    for (const k of VIEWS) if (S.dirty[k]) { clearTimeout(S.timers[k]); flush(k) }
    for (let i = 0; i < 40 && VIEWS.some(k => S.saving[k]); i++) await new Promise(r => setTimeout(r, 50))
    S.page = id
    S.layout = S.layouts[id]
    S.at = { desktop: 0, ipad: 0, mobile: 0, tv: 0 }
    S.extra = 0
    try { localStorage.setItem('hub-home-page', id) } catch {}
    S.apps = null
    S.sig = ''
    if (S.root?.isConnected && showing()) {
      paint()
      frameFit()
      if (!REDUCED.matches) S.root.querySelector('[data-hw-grid]')?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' })
    }
    loadSources(neededSources())
    if (typeof chrome === 'function') { try { chrome() } catch {} }
  }
  window.HUB_OPEN_PAGE = openPage
  window.HUB_PAGE = () => S.page
  // After an undo or an import: everything comes from the hub again, even in edit mode.
  window.HUB_HOME_RELOAD = async () => {
    for (const k of VIEWS) { clearTimeout(S.timers[k]); S.dirty[k] = false }
    await loadLayout(true)
    S.apps = null
    S.sig = ''
    if (S.root?.isConnected && showing()) { paint(); frameFit() }
    loadSources(neededSources())
    if (typeof chrome === 'function') { try { chrome() } catch {} }
  }

  /* ---------- widget card html ---------- */

  const DIMS = { desktop: { s: [234, 190], m: [490, 190], l: [490, 402] }, ipad: { s: [234, 190], m: [490, 190], l: [490, 402] }, tv: { s: [234, 190], m: [490, 190], l: [490, 402] }, mobile: { s: [164, 198], m: [343, 198], l: [343, 410] } }
  const SIZE_NAME = { s: 'Small', m: 'Medium', l: 'Large' }

  const stateBody = (w, ids = w.sources) => {
    const sts = ids.map(srcStatus)
    if (sts.includes('missing')) return connect(`Connect ${tabName(w.tab)}`, w.connect || '', w.tab, w.icon)
    if (sts.includes('error')) return note('Couldn’t load this.', `<button type="button" class="hw-pill" data-hw-retry="${esc(ids[sts.indexOf('error')])}">Try again</button>`)
    if (sts.includes('loading')) return SKELETON
    return ''
  }
  const dataFor = w => Object.fromEntries(w.sources.map(id => [id, srcData(id)]))

  // opts are the per-widget choices from Widget Options (tint, clock face, chart type...), saved on the layout item.
  function bodyFor(w, size, opts = {}) {
    const st = stateBody(w)
    if (st) return st
    try { return w.render(dataFor(w), size, H, opts) || '' } catch (e) { console.error('home widget', w.id, e); return note('Couldn’t show this.') }
  }
  const tintOf = (w, opts) => (opts && opts.tint) || w.tint || 'var(--blue)'

  function cardHtml(w, size, dev, body, live, opts) {
    const lab = (w.labels && w.labels[size]) || w.label
    const a11y = live ? `tabindex="0" role="button" aria-haspopup="dialog" aria-label="${esc(w.label)}, opens details"` : `aria-label="${esc(w.label)}"`
    return `<section class="hw-card${live ? ' live' : ''}" data-size="${size}" data-dev="${dev}" ${a11y} style="--t:${esc(tintOf(w, opts))}"><div class="hw-label"><span class="ell">${esc(lab)}</span></div><div class="hw-body">${body}</div></section>`
  }

  function appCellHtml(id) {
    const HUB = window.HUB
    if (!HUB) return ''
    const m = HUB.appMeta(id), sz = viewKey() === 'mobile' ? 54 : 58
    return `<div class="hw-cell a" role="listitem" data-hw-key="app:${esc(id)}" data-hay="${esc(`${m.label} ${id} app`.toLowerCase())}"><div class="hw-app" data-hw-app="${esc(id)}"><button type="button" class="hw-app-b" data-hw-appopen="${esc(id)}" aria-label="${S.editing ? `${esc(m.label)}. Drag or use the arrow keys to move` : id === 'chat' ? 'Open Chat' : `Open ${esc(m.label)}`}">${HUB.tile(id, sz, Math.round(sz * 0.26), Math.round(sz * 0.45))}<span class="hw-app-l">${esc(m.label)}</span></button>${S.editing ? `<button type="button" class="hw-ctl hw-del" data-hw-appdel="${esc(id)}" aria-label="Remove ${esc(m.label)} from Home">${icon('close', 11)}</button>` : ''}</div></div>`
  }

  function cellHtml(it, wm, vk) {
    if (isAppItem(it)) return appCellHtml(it.app)
    if (isStack(it)) return stackHtml(it, wm, vk)
    const w = wm.get(it.id)
    if (!w) return S.editing ? `<div class="hw-cell s" data-hw-key="${esc(it.key)}"><section class="hw-card" data-size="s" data-dev="${vk}"><div class="hw-label"><span class="ell">Missing widget</span></div><div class="hw-body"><div class="hw-sub">${esc(it.id)} isn’t available here.</div></div></section>${ctlHtml(it, null, 's')}</div>` : ''
    const size = sizeOf(it, w)
    const hay = `${w.label} ${w.id} ${tabName(w.tab)} ${w.cat || ''}`.toLowerCase()
    return `<div class="hw-cell ${size}" data-hw-key="${esc(it.key)}" data-hw-wkey="${esc(it.key)}" data-hay="${esc(hay)}">${cardHtml(w, size, vk, bodyFor(w, size, it.opts), !S.editing, it.opts)}${S.editing ? ctlHtml(it, w, size) : ''}</div>`
  }
  const appSig = id => { const H = window.HUB; return H ? `${H.appMeta(id).label}:${H.groupOf?.(id)?.apps?.join('+') || ''}:${H.siteOf?.(id)?.icon || ''}` : '' }
  const sigOne = (i, wm) => (isAppItem(i) ? `${i.key}:${appSig(i.app)}` : `${i.key}:${i.size}:${wm.get(i.id)?.label || ''}:${JSON.stringify(i.opts || {})}`)
  const sigOf = (vk, items, wm) => `${vk}|${S.editing}|${items.map(i => (i.br ? '/' : '') + (isStack(i) ? `${i.key}:${i.size}[${i.stack.map(x => sigOne(x, wm)).join('+')}]` : sigOne(i, wm))).join(',')}`
  const ctlHtml = (it, w, size) => `<button type="button" class="hw-ctl hw-del" data-hw-del aria-label="Remove ${esc(w?.label || it.id)}">${icon('close', 11)}</button>${w && w.sizes.length > 1 ? `<button type="button" class="hw-ctl hw-size" data-hw-size aria-label="Change size, now ${SIZE_NAME[size]}">${SIZE_NAME[size]}</button>` : ''}`

  /* ---------- stacks: same-size widgets sharing one cell, swiped through ---------- */

  const isStack = it => it?.id === 'stack' && Array.isArray(it.stack)
  // The item with this key, on the layout itself or inside a stack (parent is then that stack).
  function findItem(vk, key) {
    for (const it of layoutItems(vk)) {
      if (it.key === key) return { it, parent: null }
      const x = isStack(it) && it.stack.find(i => i.key === key)
      if (x) return { it: x, parent: it }
    }
    return null
  }
  const flatItems = vk => layoutItems(vk).flatMap(it => (isStack(it) ? it.stack : [it]))
  // A stack can only take the sizes every widget in it has.
  const stackSizes = (st, wm) => ['s', 'm', 'l'].filter(sz => st.stack.every(x => !wm.get(x.id) || wm.get(x.id).sizes.includes(sz)))
  const skPage = st => Math.max(0, Math.min(st.stack.length - 1, S.skPage?.[st.key] || 0))
  const skCurrent = st => st.stack[skPage(st)]
  const resize = (it, size) => { it.size = size; if (isStack(it)) it.stack.forEach(x => (x.size = size)) }

  function stackHtml(st, wm, vk) {
    const size = st.size, ws = st.stack.map(x => wm.get(x.id)), names = ws.map(w => w?.label || 'Missing widget'), cur = skPage(st)
    const hay = ws.filter(Boolean).map(w => `${w.label} ${w.id} ${tabName(w.tab)} ${w.cat || ''}`).join(' ').toLowerCase()
    const pages = st.stack.map((x, i) => `<div class="hw-sk-pg" data-hw-wkey="${esc(x.key)}">${ws[i] ? cardHtml(ws[i], size, vk, bodyFor(ws[i], size, x.opts), !S.editing, x.opts) : `<section class="hw-card" data-size="${size}" data-dev="${vk}"><div class="hw-label"><span class="ell">Missing widget</span></div><div class="hw-body"><div class="hw-sub">${esc(x.id)} isn’t available here.</div></div></section>`}</div>`).join('')
    const dots = `<div class="hw-sk-dots" aria-hidden="true">${st.stack.map((_, i) => `<i${i === cur ? ' class="on"' : ''}></i>`).join('')}</div>`
    const ctl = S.editing ? ctlHtml(st, { label: `Stack of ${names.join(', ')}`, sizes: stackSizes(st, wm) }, size) : ''
    return `<div class="hw-cell ${size} hw-sk-cell" data-hw-key="${esc(st.key)}" data-hay="${esc(hay)}"><div class="hw-sk" data-hw-sk="${esc(st.key)}" aria-label="Stack: ${esc(names.join(', '))}">${pages}</div>${dots}${ctl}</div>`
  }
  // Each stack shows the page it was left on, across repaints.
  function restoreStacks(scope) {
    scope.querySelectorAll('[data-hw-sk]').forEach(sk => {
      const st = layoutItems(viewKey()).find(i => i.key === sk.dataset.hwSk)
      if (st) sk.scrollTop = skPage(st) * sk.clientHeight
    })
  }
  function onStackScroll(e) {
    const sk = e.target.closest?.('[data-hw-sk]')
    if (!sk || !sk.clientHeight) return
    const st = layoutItems(viewKey()).find(i => i.key === sk.dataset.hwSk)
    if (!isStack(st)) return
    const p = Math.max(0, Math.min(st.stack.length - 1, Math.round(sk.scrollTop / sk.clientHeight)))
    ;(S.skPage ||= {})[st.key] = p
    sk.parentElement.querySelectorAll('.hw-sk-dots i').forEach((d, i) => d.classList.toggle('on', i === p))
  }

  /* ---------- fit rule: a row or part that doesn't fit is hidden whole, never cut ---------- */

  function fit(body) {
    if (!body.isConnected) return
    // A big figure that's too wide for its card shrinks to fit, so it's never cut mid-character.
    body.querySelectorAll('.hw-fig .v, .hw-clock .v').forEach(v => {
      v.style.fontSize = ''
      if (v.scrollWidth > v.clientWidth + 0.5 && v.clientWidth) v.style.fontSize = `${Math.max(15, Math.floor(parseFloat(getComputedStyle(v).fontSize) * v.clientWidth / v.scrollWidth))}px`
    })
    const rows = [...body.querySelectorAll('[data-fit]')]
    const lists = [...body.querySelectorAll('[data-fit-list]')].flatMap(l => [...l.children].filter(e => !e.querySelector('[data-fit]')))
    const base = rows.concat(lists)
    const own = [...body.children].filter(e => !base.includes(e) && !e.hasAttribute('data-fit-list') && !e.querySelector('[data-fit],[data-fit-list]'))
    const all = base.concat(own)
    all.forEach(e => { e.style.visibility = ''; e.removeAttribute('data-clipped') })
    const b = body.getBoundingClientRect()
    all.forEach(e => {
      const r = e.getBoundingClientRect()
      if (r.height && (r.bottom > b.bottom + 0.5 || r.top < b.top - 0.5)) { e.style.visibility = 'hidden'; e.setAttribute('data-clipped', '1') }
    })
    // A day heading never sits alone at the end of a list.
    body.querySelectorAll('[data-fit-head]').forEach(h => {
      const nx = h.nextElementSibling
      if (!nx || nx.hasAttribute('data-clipped') || nx.hasAttribute('data-fit-head')) { h.style.visibility = 'hidden'; h.setAttribute('data-clipped', '1') }
    })
  }
  const ro = window.ResizeObserver ? new ResizeObserver(es => es.forEach(e => fit(e.target))) : null
  function fitAll(scope = S.root) {
    if (!scope) return
    scope.querySelectorAll('.hw-body:not(.hw-inline)').forEach(b => { fit(b); ro?.observe(b) })
  }

  /* ---------- painting ---------- */

  function buildRoot() {
    const root = document.createElement('div')
    root.className = 'hw-root'
    root.innerHTML = `<div class="hw-bar">
      <div class="seg hw-seg" role="tablist" aria-label="Layout" style="--n:4;--i:0"><span class="seg-thumb"></span><button type="button" role="tab" data-hw-mode="desktop">Desktop</button><button type="button" role="tab" data-hw-mode="ipad">iPad</button><button type="button" role="tab" data-hw-mode="mobile">Mobile</button><button type="button" role="tab" data-hw-mode="tv">TV</button></div>
      <div class="hw-hint" data-hw-hint></div>
      <div class="hw-bar-r"><div class="seg hw-scroll" role="radiogroup" aria-label="Scrolling" style="--n:2;--i:0" hidden><span class="seg-thumb"></span><button type="button" role="radio" data-hw-scroll="pages">Pages</button><button type="button" role="radio" data-hw-scroll="infinite">Infinite Scroll</button></div><button type="button" class="hw-btn red" data-hw-act="reset" hidden>Reset</button><button type="button" class="hw-btn tint hw-iconly" data-hw-act="tabs" aria-label="Edit Tabs" hidden>${hic('tabs', 15)}<span class="hw-btn-t">Edit Tabs</span></button><button type="button" class="hw-btn tint hw-iconly" data-hw-act="style" aria-label="Edit Style" hidden>${hic('palette', 15)}<span class="hw-btn-t">Edit Style</span></button><button type="button" class="hw-btn tint hw-iconly" data-hw-act="pages" aria-label="Named Pages" hidden>${icon('layers', 15)}<span class="hw-btn-t">Named Pages</span></button><button type="button" class="hw-btn tint" data-hw-act="add" hidden>${icon('plus', 15)}Add</button><button type="button" class="hw-btn tint" data-hw-act="edit">Edit</button></div>
    </div>
    <div class="hw-pages" data-hw-pages role="tablist" aria-label="Home Pages" hidden></div>
    <div class="hw-stage"><div class="hw-device"><div class="hw-frame"><div class="hw-pager"><div class="hw-grid" data-hw-grid role="list" aria-label="Home"></div></div><div class="hw-dots" data-hw-dots></div></div></div></div>
    <div class="hw-tv" data-hw-tv hidden></div>`
    return root
  }

  // Logical size of each device, its bezel, corners, and the insets of its screen.
  const FRAME = { ipad: { w: 1024, h: 768, b: 13, r: 26, pt: 26, px: 26 }, mobile: { w: 390, h: 844, b: 11, r: 48, pt: 58, px: 20 } }
  // Fits the device between the toggle and the chat bar. Off a device, Home takes what's left of the window.
  function frameFit() {
    const root = S.root, vk = viewKey(), f = !realDevice() && FRAME[vk]
    if (!root?.isConnected || S.drag?.on) return
    if (vk === 'tv') { S.framed = false; root.dataset.framed = '0'; return tvFit() }
    S.framed = !!f
    root.dataset.framed = f ? '1' : '0'
    const stage = root.querySelector('.hw-stage'), frame = root.querySelector('.hw-frame'), top = stage.getBoundingClientRect().top
    if (f) {
      frame.style.height = ''
      S.frameK = Math.max(0.25, Math.min(1, root.clientWidth / (f.w + 2 * f.b), (innerHeight - top - 84) / (f.h + 2 * f.b)))
      for (const [k, v] of [['--fw', f.w], ['--fh', f.h], ['--fb', f.b], ['--fr', f.r], ['--fpt', f.pt], ['--fpx', f.px]]) stage.style.setProperty(k, `${v}px`)
      stage.style.setProperty('--fk', S.frameK.toFixed(4))
    } else {
      S.frameK = 1
      frame.style.height = `${Math.max(0, innerHeight - top)}px`
    }
    pagerFit()
  }
  // What a drag's numbers are measured in. In a device they are the device's own pixels, so a move stays arithmetic.
  // The pages moving under a held card count as its scroll.
  // In one long scroll the pager's own scroll is the drag's.
  function view() {
    const el = S.framed && S.root?.querySelector('.hw-frame'), pg = infinite() ? S.root?.querySelector('.hw-pager') : null, y = () => (pg ? pg.scrollTop : 0)
    if (!el) return { el: null, pg, k: 1, left: 0, top: 0, x: () => S.px, y }
    const r = el.getBoundingClientRect()
    return { el, pg, k: S.frameK, left: r.left, top: r.top, x: () => S.px, y }
  }

  /* ---------- pages: Home moves sideways, a page at a time ---------- */

  const at = () => S.at[viewKey()] || 0
  const pageCount = () => S.sheets.length + (S.extra ? 1 : 0)
  // Measures what fits on a page at this size, then lays the cells out again.
  function pagerFit() {
    const root = S.root, pager = root.querySelector('.hw-pager'), grid = root.querySelector('[data-hw-grid]'), cs = getComputedStyle(root), g = S.geo
    const rr = root.getBoundingClientRect(), side = S.framed ? FRAME[viewKey()].px : rr.left
    g.bleed = S.framed ? side : Math.max(side, document.documentElement.clientWidth - rr.right, innerWidth - rr.right)
    g.left = side
    pager.style.setProperty('--hw-bl', `${side}px`)
    pager.style.setProperty('--hw-br', `${g.bleed}px`)
    g.gap = parseFloat(cs.getPropertyValue('--gap')) || 22
    g.unit = ((parseFloat(cs.getPropertyValue('--uh')) || 190) - g.gap) / 2
    setCols(grid)
    g.w = grid.clientWidth
    g.h = pager.clientHeight
    place(grid, S.drag?.order)
  }
  function pagerSet(x) {
    S.px = x
    const grid = S.root?.querySelector('[data-hw-grid]')
    if (grid) grid.style.transform = x ? `translate3d(${(-x).toFixed(1)}px, 0, 0)` : ''
    // A held card rides along, in the same frame.
    const d = S.drag
    if (d?.on) { d.px = x; dragPlace(d) }
  }
  let turn = null
  function pagerStep(now) {
    if (!turn) return
    const t = Math.min(1, (now - turn.t0) / turn.ms)
    pagerSet(turn.from + (turn.to - turn.from) * (1 - (1 - t) ** 3))
    if (t < 1) requestAnimationFrame(pagerStep)
    else turn = null
  }
  // Puts the page on screen at once, for anything that isn't the person turning it.
  function pagerSnap() {
    if (turn || swipe?.on) return
    pagerSet(at() * S.geo.stride)
  }
  function pagerGo(i) {
    const vk = viewKey()
    i = Math.max(0, Math.min(pageCount() - 1, i))
    S.at[vk] = i
    paintDots()
    const to = i * S.geo.stride
    if (S.px === to) { turn = null; return }
    if (REDUCED.matches || document.hidden) { turn = null; return pagerSet(to) }
    const run = !turn
    turn = { from: S.px, to, t0: performance.now(), ms: 320 }
    if (run) requestAnimationFrame(pagerStep)
  }
  // Shows whichever page the cell with this key is on.
  function pagerShow(key) {
    const c = S.root?.querySelector(`.hw-cell[data-hw-key="${CSS.escape(key)}"]`)
    if (c && c.hwPage != null) pagerGo(c.hwPage)
  }
  function paintDots() {
    const box = S.root?.querySelector('[data-hw-dots]')
    if (!box) return
    const n = pageCount(), i = at(), shape = `${n}|${S.editing}`
    if (box._shape !== shape) {
      box._shape = shape
      const dots = n > 1 ? Array.from({ length: n }, (_, k) => `<button type="button" class="hw-pdot" data-hw-dot="${k}" aria-label="Page ${k + 1} of ${n}"></button>`).join('') : ''
      box.innerHTML = `${S.editing && n > 1 ? `<button type="button" class="hw-btn red hw-iconly hw-pgl" data-hw-pagebtn="remove" aria-label="Remove Page" title="Remove Page">${icon('trash', 15)}<span class="hw-btn-t">Remove Page</span></button>` : ''}<div class="hw-dots-in" role="group" aria-label="Pages" style="--n:${n > 1 ? n : 0}">${dots}</div>${S.editing ? `<button type="button" class="hw-btn tint hw-iconly hw-pgr" data-hw-pagebtn="add" aria-label="Add Page" title="Add Page">${icon('plus', 15)}<span class="hw-btn-t">Add Page</span></button>` : ''}`
    }
    box.querySelectorAll('[data-hw-dot]').forEach(b => { if (Number(b.dataset.hwDot) === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current') })
  }
  // A new page goes last and stays empty until something lands on it; like an iPhone, an empty one is gone when editing ends.
  function addPage() {
    if (!S.editing) toggleEdit()
    if (!S.sheets.at(-1)?.length || S.extra) return pagerGo(pageCount() - 1)
    S.extra = 1
    place(S.root.querySelector('[data-hw-grid]'))
    pagerGo(pageCount() - 1)
  }
  async function removePage() {
    const vk = viewKey(), i = at(), cells = S.sheets[i] || []
    if (pageCount() < 2) return
    if (!cells.length) {
      S.extra = 0
      place(S.root.querySelector('[data-hw-grid]'))
      return pagerGo(i - 1)
    }
    const apps = cells.filter(c => c.classList.contains('a')).map(c => c.querySelector('.hw-app')?.dataset.hwApp).filter(Boolean)
    const n = cells.length, also = apps.length && onMain() ? ' Apps come off your other layouts too.' : ''
    const ok = typeof alertBox === 'function'
      ? await alertBox({ title: 'Remove this page?', message: `${n === 1 ? 'The item' : `The ${n} items`} on it come off this layout. You can add ${n === 1 ? 'it' : 'them'} back with Add.${also}`, ok: 'Remove', danger: true })
      : confirm('Remove this page?')
    if (!ok) return
    const gone = new Set(cells.map(c => c.dataset.hwKey)), list_ = homeItems(vk), first = list_.findIndex(it => gone.has(it.key)), rest = list_.filter(it => !gone.has(it.key))
    // The page after it stays a page of its own.
    if (i > 0 && rest[first]) rest[first].br = true
    S.layout[vk] = rest
    saveSoon(vk)
    S.at[vk] = Math.max(0, i - 1)
    if (apps.length && onMain()) setApps(appList().filter(x => !apps.includes(x)))
    S.sig = ''
    paint(true)
    pagerSnap()
    hud('Page removed')
  }

  function paintPages(root) {
    const box = root.querySelector('[data-hw-pages]'), html = S.pages.length ? [{ id: 'main', name: 'Home' }, ...S.pages].map(p => `<button type="button" role="tab" class="hw-page" data-hw-page="${esc(p.id)}" aria-selected="${p.id === S.page}">${esc(p.name)}</button>`).join('') : ''
    box.hidden = !html
    if (box._h !== html) { box._h = html; box.innerHTML = html }
  }
  function updateBar() {
    const root = S.root
    if (!root) return
    const vk = viewKey()
    root.dataset.view = vk
    root.dataset.phone = realDevice() ? '1' : '0'
    root.dataset.scroll = infinite() ? 'infinite' : 'pages'
    root.dataset.intv = IN_TV ? '1' : '0'
    root.querySelector('[data-hw-tv]').hidden = vk !== 'tv'
    const sc = root.querySelector('.hw-scroll'), how = scrollOf(vk)
    sc.hidden = !S.editing
    sc.style.setProperty('--i', how === 'infinite' ? 1 : 0)
    sc.querySelectorAll('[data-hw-scroll]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.hwScroll === how)))
    frameFit()
    root.classList.toggle('hw-edit', S.editing)
    if (S.stripEditing !== S.editing) { S.stripEditing = S.editing; window.HUB?.setTabsEditing?.(S.editing) }
    const seg = root.querySelector('.hw-seg')
    seg.style.setProperty('--i', VIEWS.indexOf(vk))
    seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.hwMode === vk)))
    const edit = root.querySelector('[data-hw-act=edit]')
    edit.textContent = S.editing ? 'Done' : 'Edit'
    edit.classList.toggle('solid', S.editing)
    edit.classList.toggle('tint', !S.editing)
    paintPages(root)
    // The TV view edits LocalHub TV beside its screen; of the rest, only the look (the hub's own) applies to it.
    for (const a of ['add', 'reset', 'style', 'tabs', 'pages']) root.querySelector(`[data-hw-act=${a}]`).hidden = !S.editing || (a !== 'add' && a !== 'reset' && !window.HUB) || (a === 'pages' && !S.pages.length) || (vk === 'tv' && a !== 'style')
    const hint = root.querySelector('[data-hw-hint]')
    const bad = S.layoutErr
    hint.classList.toggle('err', !!bad)
    hint.textContent = bad ? (bad === 'reconnecting' ? 'Reconnecting to the hub. Changes save as soon as it’s back.' : `The layout couldn’t be saved (${bad}). Trying again.`) : ''
    // The bar can wrap in edit mode, which changes what fits below it.
    frameFit()
  }

  function rectMap(grid) {
    const m = new Map()
    grid.querySelectorAll('.hw-cell').forEach(c => m.set(c.dataset.hwKey, c.getBoundingClientRect()))
    return m
  }
  function playFlip(grid, before, skip) {
    if (REDUCED.matches || !grid.animate) return
    grid.querySelectorAll('.hw-cell').forEach(c => {
      if (c === skip) return
      const a = before.get(c.dataset.hwKey)
      if (!a) { c.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE }); return }
      const b = c.getBoundingClientRect()
      const dx = (a.left - b.left) / S.frameK, dy = (a.top - b.top) / S.frameK
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
      c.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 260, easing: EASE })
    })
  }

  function paint(flip) {
    const root = S.root
    if (!root) return
    updateBar()
    const grid = root.querySelector('[data-hw-grid]')
    const vk = viewKey()
    if (vk === 'tv') return paintTv()
    if (!S.layout) { grid.innerHTML = '<div class="hw-empty">Loading your homescreen…</div>'; S.sig = ''; return }
    const items = homeItems(vk)
    const wm = widgetMap()
    setCols(grid)
    const sig = sigOf(vk, items, wm)
    if (sig === S.sig && grid.querySelector('.hw-cell, .hw-empty')) {
      grid.querySelectorAll('[data-hw-wkey]').forEach(el => {
        const f = findItem(vk, el.dataset.hwWkey), it = f?.it, w = it && wm.get(it.id)
        const body = el.querySelector('.hw-body')
        if (!w || !body) return
        const html = bodyFor(w, f.parent ? f.parent.size : sizeOf(it, w), it.opts)
        if (body._h !== html) { body.innerHTML = html; body._h = html; fit(body) }
      })
      return
    }
    const before = flip && S.sig ? rectMap(grid) : null
    const html = items.map(it => cellHtml(it, wm, vk)).join('')
    grid.innerHTML = html || `<div class="hw-empty">Nothing on Home yet.${S.editing ? ' Tap Add.' : ' Tap Edit, then Add.'}</div>`
    S.sig = sig
    const byKey = new Map(items.map(it => [it.key, it]))
    grid.querySelectorAll('.hw-cell').forEach(c => { c.hwBr = !!byKey.get(c.dataset.hwKey)?.br })
    // What each body was built from, not the browser's rewrite of it, or the next paint redoes every widget.
    grid.querySelectorAll('[data-hw-wkey]').forEach(el => {
      const f = findItem(vk, el.dataset.hwWkey), it = f?.it, w = it && wm.get(it.id), body = el.querySelector('.hw-body')
      if (w && body) body._h = bodyFor(w, f.parent ? f.parent.size : sizeOf(it, w), it.opts)
    })
    fitAll()
    restoreStacks(grid)
    applyFilter()
    if (before) playFlip(grid, before)
  }

  // Widget columns of at least 202 px; the grid has two app slots per widget column, and a small widget is square.
  function setCols(grid) {
    if (!grid) return
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 22, w = grid.clientWidth
    if (!w) return
    const n = Math.max(2, Math.floor((w + gap) / (202 + gap))), cols = viewKey() === 'mobile' ? 4 : n * 2
    if (grid.style.getPropertyValue('--cols') !== String(cols)) { grid.style.setProperty('--cols', String(cols)); place(grid, S.drag?.order) }
  }

  // Where each cell goes. Items stay in the order they were put, and each fills the current shelf: a band of
  // rows as tall as the tallest thing on it. A widget snaps to even columns, so widgets line up across the
  // page, and it never stretches a row of apps, which would leave an empty band under them.
  // Pages come from the same walk: what doesn't fit goes to the next page, and a cell marked br starts one.
  // What spills over joins the page after it instead of making a page of its own, so a smaller window closes up.
  const CELL_SPAN = { a: [1, 1], s: [2, 2], m: [4, 2], l: [4, 4] }
  const spanOf = el => CELL_SPAN[['a', 's', 'm', 'l'].find(k => el.classList.contains(k))] || CELL_SPAN.s
  function place(grid, cells = [...grid.querySelectorAll('.hw-cell')]) {
    const g = S.geo, cols = viewKey() === 'mobile' ? 4 : Number(grid.style.getPropertyValue('--cols')) || 8, shown = cells.filter(el => el.style.display !== 'none')
    // Every size has to fit on a page, so a short window makes the rows shorter rather than clipping a large widget.
    // In one long scroll there's no bottom: rows keep their height and nothing goes to a next page.
    const inf = infinite(), need = shown.reduce((m, el) => Math.max(m, spanOf(el)[1]), 1), fits = inf ? 1e4 : g.h ? Math.floor((g.h + g.gap) / (g.unit + g.gap)) : 999
    const rows = Math.max(1, need, fits), rh = rows > fits ? Math.max(44, (g.h - (rows - 1) * g.gap) / rows) : g.unit
    const used = new Set(), key = (r, c) => r * 64 + c
    const free = (r, c, w, h) => { for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (used.has(key(y, x))) return false; return true }
    const sheets = [[]]
    let top = 0, height = 1, apps = false, spilled = false
    const next = over => { sheets.push([]); used.clear(); top = 0; height = 1; apps = false; spilled = over }
    for (const el of shown) {
      const [w, h] = spanOf(el)
      if (el.hwBr && !S.q && !inf && sheets.at(-1).length) { if (spilled) spilled = false; else next(false) }
      let spot = null
      for (let r = top; r < top + height && !spot; r++) {
        if (r + h > rows || (r + h > top + height && (r !== top || apps))) continue
        for (let c = 0; c + w <= cols && !spot; c += w > 1 ? 2 : 1) if (free(r, c, w, h)) spot = [r, c]
      }
      if (!spot) {
        top += height; height = 1; apps = false
        if (top + h > rows) next(true)
        spot = [top, 0]
      }
      height = Math.max(height, spot[0] + h - top)
      if (h === 1) apps = true
      for (let y = spot[0]; y < spot[0] + h; y++) for (let x = spot[1]; x < spot[1] + w; x++) used.add(key(y, x))
      el.hwPage = sheets.length - 1
      sheets.at(-1).push(el)
      // Only a cell that really moved gets a new style, so a swap restyles two or three cells, not all of them.
      const area = `${spot[0] + 1} / ${el.hwPage * (cols + 1) + spot[1] + 1} / span ${h} / span ${w}`
      if (el.hwArea !== area) { el.hwArea = area; el.style.gridArea = area }
    }
    S.sheets = sheets
    if (S.q || !S.editing || inf) S.extra = 0
    const n = pageCount()
    // One set of columns per page, with a spacer so the next page starts off the screen.
    const cw = g.w ? (g.w - (cols - 1) * g.gap) / cols : 0, gutter = Math.max(0, g.bleed - 2 * g.gap + 4)
    if (cw) {
      const tracks = Array.from({ length: n }, () => `repeat(${cols}, ${cw.toFixed(3)}px)`).join(` ${gutter.toFixed(1)}px `)
      if (grid.hwTracks !== tracks) { grid.hwTracks = tracks; grid.style.gridTemplateColumns = tracks }
      g.stride = g.w + 2 * g.gap + gutter
    }
    if (g.rows !== rows || grid.hwRh !== rh) { grid.hwRh = rh; grid.style.setProperty('--hw-rh', `${rh.toFixed(2)}px`) }
    g.cols = cols
    g.rows = rows
    placeBlank(grid, cols, rows)
    const vk = viewKey()
    if (S.at[vk] > n - 1) S.at[vk] = n - 1
    paintDots()
    pagerSnap()
  }
  // The empty page says what it's for.
  function placeBlank(grid, cols, rows) {
    let el = grid.querySelector(':scope > .hw-blank')
    if (!S.extra) return el?.remove()
    if (!el) { el = document.createElement('div'); el.className = 'hw-blank'; el.textContent = 'Drag apps and widgets here, or use Add.'; grid.append(el) }
    el.style.gridArea = `1 / ${S.sheets.length * (cols + 1) + 1} / span ${rows} / span ${cols}`
  }

  function scheduleRepaint() {
    if (S.raf) return
    S.raf = requestAnimationFrame(() => {
      S.raf = 0
      if (S.drag?.on) { S.pending = true; return }
      if (S.root?.isConnected && showing()) paint()
      S.gallery?.refresh()
      S.detail?.refresh()
    })
  }

  function applyFilter() {
    const q = (document.getElementById('q')?.value || '').trim().toLowerCase()
    S.root?.querySelectorAll('[data-hay]').forEach(c => { c.style.display = !q || c.dataset.hay.includes(q) ? '' : 'none' })
    // What a search finds runs together from the first page.
    if (q !== S.q) { S.q = q; S.at[viewKey()] = 0 }
    const grid = S.root?.querySelector('[data-hw-grid]')
    if (grid) place(grid)
  }

  function tickClock() {
    const now = new Date()
    const t = fmtTime(now).replace(/\s?([AP]M)$/i, '')
    const ap = (/([AP]M)$/i.exec(fmtTime(now)) || [])[1] || ''
    S.root?.querySelectorAll('[data-hw-time]').forEach(el => { if (el.textContent !== t) el.textContent = t })
    S.root?.querySelectorAll('[data-hw-ampm]').forEach(el => { if (el.textContent !== ap) el.textContent = ap })
    const ss = String(now.getSeconds()).padStart(2, '0'), [ha, ma, sa] = handAngles(now)
    S.root?.querySelectorAll('[data-hw-sec]').forEach(el => { if (el.textContent !== ss) el.textContent = ss })
    S.root?.querySelectorAll('[data-hw-hand]').forEach(el => el.setAttribute('transform', `rotate(${{ h: ha, m: ma, s: sa }[el.dataset.hwHand].toFixed(1)} 50 50)`))
    S.root?.querySelectorAll('[data-hw-tz]').forEach(el => { const v = zoneTime(el.dataset.hwTz); if (el.textContent !== v) el.textContent = v })
    S.root?.querySelectorAll('[data-hw-date]').forEach(el => {
      const v = el.dataset.hwDate === 'm' ? now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : fmtDay(now)
      if (el.textContent !== v) el.textContent = v
    })
  }

  /* ---------- widgets ---------- */

  const reg = def => window.registerHomeWidget(def)
  const GIB = 1024 ** 3

  // --- Claude usage
  const accountsOf = d => d.ai?.accounts || []
  const mainAccount = accs => accs.find(a => a.isDefault && a.usage) || accs.find(a => a.usage) || null
  const shortName = a => String(a.label || a.email || a.id || '').split('@')[0] || 'Account'
  const resetIn = at => (at ? `resets in ${until(at - Date.now())}` : '')
  function accountCol(a, withReset) {
    const u = a.usage
    if (!u) return `<div class="hw-col" data-fit><h4 class="ell">${esc(shortName(a))}</h4><div class="hw-sub">${esc(a.message || 'Not signed in')}</div></div>`
    const f = u.fiveHour?.pct ?? 0, s = u.sevenDay?.pct ?? 0
    return `<div class="hw-col" data-fit><h4 class="ell">${esc(shortName(a))}</h4>${a.plan ? `<div class="hw-sub ell">${esc(a.plan)}</div>` : ''}${meter('5 hour', `${Math.round(f)}%`, f, tone(f))}${meter('7 day', `${Math.round(s)}%`, s, tone(s))}${withReset && u.fiveHour?.resetsAt ? `<div class="hw-sub ell">5 hour ${esc(resetIn(u.fiveHour.resetsAt))}</div>` : ''}</div>`
  }
  // A colour for a usage ring: the widget's own until it gets high, then orange or red.
  const ringTone = (p, base) => (p >= 65 ? TONE[tone(p)] : base)
  function accountRing(a, size = 64) {
    if (viewKey() === 'mobile') size = Math.min(size, 48)
    const u = a.usage
    if (!u) return `<div class="hw-acc" data-fit><div><h4 class="ell">${esc(shortName(a))}</h4><span class="hw-sub ell">${esc(a.message || 'Not signed in')}</span></div></div>`
    const f = u.fiveHour?.pct ?? 0, s = u.sevenDay?.pct ?? 0, c5 = ringTone(f, 'var(--t)'), c7 = ringTone(s, 'var(--teal, #30b0c7)')
    return `<div class="hw-acc" data-fit>${dualRing(f, s, '', size, c5, c7)}<div><h4 class="ell">${esc(shortName(a))}</h4><span class="k"><i style="background:${c5}"></i>5 hour <b>${Math.round(f)}%</b></span><span class="k"><i style="background:${c7}"></i>7 day <b>${Math.round(s)}%</b></span></div></div>`
  }
  reg({
    id: 'claude-usage', label: 'Claude usage', labels: { s: 'Claude 5h' }, cat: 'AI', icon: 'gauge', tint: 'var(--indigo)', tab: 'ai',
    sizes: ['s', 'm', 'l'], defaultSize: 's', sources: ['ai'], blurb: 'Plan usage per Claude account: the 5-hour and 7-day limits.',
    render(d, size, ui, o = {}) {
      const accs = accountsOf(d)
      if (!accs.length) return connect('Add a Claude account', 'Usage for each account shows here.', 'ai', 'gauge', 'claude-account')
      const main = mainAccount(accs), rings = o.style !== 'bars'
      if (size === 's') {
        if (!main) return note('Sign in to a Claude account to see its usage.', openBtn('ai', 'Open AI'))
        const p = main.usage.fiveHour?.pct ?? 0, s7 = main.usage.sevenDay?.pct ?? 0
        const r = rings ? dualRing(p, s7, `${Math.round(p)}%`, 92, ringTone(p, 'var(--t)'), ringTone(s7, 'var(--teal, #30b0c7)')) : ring(p, tone(p), `${Math.round(p)}%`, 84, 9, 20)
        const sub = rings ? `7 day ${Math.round(s7)}%${main.usage.fiveHour?.resetsAt ? ` · ${until(main.usage.fiveHour.resetsAt - Date.now())}` : ''}` : resetIn(main.usage.fiveHour?.resetsAt)
        return `<div class="hw-ringwrap" data-fit>${r}</div>${sub ? `<div class="hw-sub c ell" data-fit>${esc(sub)}</div>` : ''}`
      }
      if (rings) {
        const shown = accs.slice(0, size === 'm' ? 2 : 4)
        return cols(Math.min(2, shown.length), shown.map(a => accountRing(a, size === 'm' ? 66 : 72))) + (size === 'l' && main ? usageChart(main.history) : '')
      }
      const n = Math.min(accs.length, size === 'm' ? 2 : 3)
      let html = cols(n, accs.slice(0, n).map(a => accountCol(a, size === 'l')))
      if (size === 'l') html += main ? usageChart(main.history) : ''
      return html
    },
    detail(d) {
      const accs = accountsOf(d)
      let html = ''
      for (const a of accs) {
        const u = a.usage
        if (!u) { html += dsec(shortName(a), dlist([dkv('Status', esc(a.message || 'Not signed in'))])); continue }
        const rows = []
        for (const [name, v] of [['5 hour', u.fiveHour], ['7 day', u.sevenDay]]) if (v) rows.push(`<div>${meter(name, `${Math.round(v.pct)}%${v.resetsAt ? ` · ${resetIn(v.resetsAt)}` : ''}`, v.pct, tone(v.pct))}</div>`)
        for (const l of u.limits || []) rows.push(dkv(`${l.name} limit`, `${Math.round(l.pct)}%${l.resetsAt ? ` · ${resetIn(l.resetsAt)}` : ''}`))
        for (const c of u.credits || []) rows.push(dkv('Credits', `${moneyMajor(c.used, 'USD')} of ${moneyMajor(c.limit, 'USD')}`))
        for (const b of u.breakdown || []) rows.push(dkv(b.name, `${Math.round(b.pct)}%`))
        html += dsec(`${shortName(a)}${a.plan ? ` · ${a.plan}` : ''}`, dlist(rows))
      }
      const main = mainAccount(accs)
      if (main) html += dsec('Last readings', `<div class="hw-dchart">${usageChart(main.history, 'hw-chart-wrap')}</div>`.replace('hw-chart-wrap', ''))
      return html
    },
  })

  // --- OpenRouter / DeepSeek balances
  const provider = (d, id) => (d.ai?.providers?.list || []).find(p => p.id === id)
  reg({
    id: 'openrouter', label: 'OpenRouter balance', labels: { s: 'OpenRouter' }, cat: 'AI', icon: 'coin', tint: 'var(--blue)', tab: 'ai',
    sizes: ['s'], defaultSize: 's', sources: ['ai'], blurb: 'Credits left on your OpenRouter key.',
    render(d) {
      const p = provider(d, 'openrouter')
      if (!p || !p.connected) return connect('Connect OpenRouter', 'Credits left show here.', 'ai', 'coin', 'openrouter')
      if (p.error) return note(esc(p.error), openBtn('ai', 'Open AI'))
      const left = clamp(pct(p.balance, p.credits)), t = left < 10 ? 'bad' : left < 25 ? 'warn' : 'var(--t)'
      return `<div class="hw-ringwrap" data-fit>${ring(left, t, `${Math.round(left)}%`, 80, 9, 18)}</div><div class="hw-sub c ell" data-fit><b>${moneyMajor(p.balance, 'USD')}</b> of ${moneyMajor(p.credits, 'USD', true)}</div>`
    },
    detail(d) {
      const p = provider(d, 'openrouter')
      if (!p || !p.connected) return empty('OpenRouter isn’t connected. Add a key in the AI tab.')
      return dhero(moneyMajor(p.balance, 'USD'), 'credits left') + dsec('Account', dlist([dkv('Total credits', moneyMajor(p.credits, 'USD')), dkv('Used', moneyMajor(p.used, 'USD'))])) + dsec('This key', dlist([dkv('Used today', moneyMajor(p.daily, 'USD')), dkv('This week', moneyMajor(p.weekly, 'USD')), dkv('This month', moneyMajor(p.monthly, 'USD')), p.keyLimit != null ? dkv('Key limit', `${moneyMajor(p.keyRemaining, 'USD')} left of ${moneyMajor(p.keyLimit, 'USD')}`) : ''].filter(Boolean)))
    },
  })
  reg({
    id: 'deepseek', label: 'DeepSeek balance', labels: { s: 'DeepSeek' }, cat: 'AI', icon: 'coin', tint: 'var(--indigo)', tab: 'ai',
    sizes: ['s'], defaultSize: 's', sources: ['ai'], blurb: 'Your DeepSeek account balance.',
    render(d) {
      const p = provider(d, 'deepseek')
      if (!p || !p.connected) return note('Add a DeepSeek key to see your balance.', connectBtn('deepseek', 'ai'))
      if (p.error) return note(esc(p.error), openBtn('ai', 'Open AI'))
      const b = (p.balances || [])[0]
      if (!b) return note('No balance reported.')
      return fig(moneyMajor(b.total, b.currency || 'USD'), p.available === false ? 'Unavailable' : 'Available') + (p.balances.length > 1 ? `<div class="hw-sub ell" data-fit>+ ${p.balances.slice(1).map(x => moneyMajor(x.total, x.currency)).join(', ')}</div>` : '') + `<div class="hw-sub ell" data-fit>${b.toppedUp ? `Topped up ${moneyMajor(b.toppedUp, b.currency || 'USD')}` : ''}${b.granted ? ` · Granted ${moneyMajor(b.granted, b.currency || 'USD')}` : ''}</div>`
    },
    detail(d) {
      const p = provider(d, 'deepseek')
      if (!p || !p.connected) return empty('DeepSeek isn’t connected. Add a key in the AI tab.')
      return (p.balances || []).map(b => dsec(b.currency || 'Balance', dhero(moneyMajor(b.total, b.currency || 'USD'), p.available === false ? 'Unavailable' : 'Available') + dlist([dkv('Topped up', moneyMajor(b.toppedUp, b.currency || 'USD')), dkv('Granted', moneyMajor(b.granted, b.currency || 'USD'))]))).join('')
    },
  })

  // --- Tokens
  function tokenStats(d) {
    const t = d.ai?.tokens || {}
    const days = t.days || []
    const per = Object.fromEntries(days.map(x => [x, 0]))
    const today = dayKey(new Date())
    const st = { days, today: 0, io30: 0, cache30: 0, calls30: 0, byModel: {}, models: t.models || [] }
    for (const r of t.rows || []) {
      const io = r.i + r.o
      if (r.d in per) per[r.d] += io
      st.io30 += io
      st.cache30 += r.cw + r.cr
      st.calls30 += r.n
      if (r.d === today) st.today += io
      st.byModel[r.model] = (st.byModel[r.model] || 0) + io
    }
    st.series = days.map(x => per[x])
    return st
  }
  const modelName = (st, id) => st.models.find(m => m.id === id)?.name || id
  reg({
    id: 'tokens', label: 'Tokens', cat: 'AI', icon: 'chip', tint: 'var(--indigo)', tab: 'ai',
    sizes: ['m', 'l'], defaultSize: 'm', sources: ['ai'], blurb: 'Claude Code tokens (input + output) today and over 30 days.',
    render(d, size, ui, o = {}) {
      const st = tokenStats(d)
      let html = `<div class="hw-split2" data-fit>${fig(compact(st.today), 'today · in + out', { sm: true })}${fig(compact(st.io30), '30 days · in + out', { sm: true })}</div>`
      if (o.chart === 'line') html += `<div class="hw-grow" data-fit>${spark(st.series, { h: size === 'l' ? 70 : 40, c: 'var(--t)' })}</div>`
      else html += bars(st.series.slice(-7), st.days.slice(-7).map(x => toDate(x)?.toLocaleDateString(undefined, { weekday: 'narrow' }) || ''))
      if (size === 'l') {
        const top = Object.entries(st.byModel).sort((a, b) => b[1] - a[1]).slice(0, 4)
        const max = top[0]?.[1] || 1
        html += top.map(([m, v]) => meter(modelName(st, m), compact(v), pct(v, max), 'blue')).join('')
      }
      return html
    },
    detail(d) {
      const st = tokenStats(d)
      const last7 = st.days.slice(-7).map((day, i, a) => ({ day, v: st.series[st.series.length - a.length + i] })).reverse()
      return dhero(compact(st.today), 'tokens today (input + output)')
        + dsec('30 days', dlist([dkv('Input + output', compact(st.io30)), dkv('Cache reads + writes', compact(st.cache30)), dkv('Calls', compact(st.calls30))]) + `<div style="margin-top:10px">${spark(st.series, { h: 70, c: 'var(--indigo)' })}</div>`)
        + dsec('Last 7 days', dlist(last7.map(x => dkv(fmtDay(toDate(x.day)), compact(x.v)))))
        + dsec('By model', dlist(Object.entries(st.byModel).sort((a, b) => b[1] - a[1]).map(([m, v]) => dkv(modelName(st, m), compact(v)))))
    },
  })

  // --- Coolify, servers, clients
  const coolify = d => d.cloud?.coolify || {}
  const appUp = a => a.state === 'running'
  const appNote = a => (a.state === 'running' ? (a.health && a.health !== 'unknown' ? a.health : 'running') : a.health && a.health !== 'unknown' ? `${a.state} · ${a.health}` : a.state || 'down')
  reg({
    id: 'coolify', label: 'Coolify apps', cat: 'Cloud', icon: 'cloud', tint: 'var(--blue)', tab: 'cloud',
    sizes: ['s', 'm'], defaultSize: 's', sources: ['cloud'], blurb: 'How many of your Coolify apps are up, and which ones are down.',
    render(d, size, ui, o = {}) {
      const c = coolify(d)
      if (c.status && c.status !== 'ok') return connect('Connect Coolify', 'App status shows here.', 'cloud', 'cloud', 'coolify')
      const apps = c.apps || [], up = apps.filter(appUp).length, down = apps.filter(a => !appUp(a))
      if (o.view !== 'bar') {
        const p = pct(up, apps.length), t = down.length ? (p < 60 ? 'bad' : 'warn') : 'var(--t)'
        const head = `<div class="hw-ringrow" data-fit>${ring(p, t, `${up}/${apps.length}`, size === 's' ? 70 : 78, 9, 16)}<div><div class="hw-fig sm"><div class="v">${Math.round(p)}%</div></div><div class="hw-sub ell">${down.length ? `${down.length} down` : 'All up'}</div></div></div>`
        if (size === 's') return head
        return head + (down.length ? list(down.map(a => row({ dot: 'var(--red)', t: a.name, s: appNote(a) }))) : `<div class="hw-sub" data-fit>Every app is running.</div>`)
      }
      const f = fig(`${up}<small>of ${apps.length}</small>`, down.length ? `${down.length} down` : 'All up')
      if (size === 's') return f + `<div data-fit>${meter('Up', `${Math.round(pct(up, apps.length))}%`, pct(up, apps.length), down.length ? (pct(up, apps.length) < 60 ? 'bad' : 'warn') : '')}</div>`
      return f + (down.length ? list(down.map(a => row({ dot: 'var(--red)', t: a.name, s: appNote(a) }))) : `<div class="hw-sub" data-fit>Every app is running.</div>`)
    },
    detail(d) {
      const c = coolify(d), apps = (c.apps || []).slice().sort((a, b) => appUp(a) - appUp(b) || a.name.localeCompare(b.name))
      return dhero(`${apps.filter(appUp).length}<small>of ${apps.length} up</small>`, c.version ? `Coolify ${esc(c.version)}` : '') + dsec('Apps', dlist(apps.map(a => row({ dot: appUp(a) ? 'var(--green)' : 'var(--red)', t: a.name, s: `${a.project || ''}${a.project ? ' · ' : ''}${appNote(a)}` }))))
    },
  })
  const upDot = ok => (ok ? 'var(--green)' : 'var(--red)')
  reg({
    id: 'servers', label: 'Servers', cat: 'Cloud', icon: 'server', tint: 'var(--green)', tab: 'cloud',
    sizes: ['m', 'l'], defaultSize: 'm', sources: ['cloud'], blurb: 'Every server you run, with a dot for up or down.',
    render(d) {
      const l = d.cloud?.servers?.list || []
      if (!l.length) return note('No servers are listed yet.', openBtn('cloud', 'Open Cloud'))
      const up = l.filter(s => s.up).length
      return fig(`${up}<small>of ${l.length} up</small>`, l.length - up ? `${l.length - up} down` : 'All reachable', { sm: true }) + list(l.slice().sort((a, b) => a.up - b.up).map(s => row({ dot: upDot(s.up), t: s.name, s: s.provider || s.host || '' })))
    },
    detail(d) {
      const l = d.cloud?.servers?.list || []
      return dhero(`${l.filter(s => s.up).length}<small>of ${l.length} up</small>`, '') + dsec('Servers', dlist(l.map(s => row({ dot: upDot(s.up), t: s.name, s: [s.provider, s.host].filter(Boolean).join(' · '), r: s.checks?.[0]?.ms != null ? `${s.checks[0].ms} ms` : '' }))))
    },
  })
  const clientDot = h => (/^(up|ok|healthy|running|active)/i.test(h || '') ? 'var(--green)' : /down|fail|unhealthy|exited/i.test(h || '') ? 'var(--red)' : 'var(--orange)')
  reg({
    id: 'clients', label: 'Clients', cat: 'Cloud', icon: 'users', tint: 'var(--orange)', tab: 'cloud',
    sizes: ['m'], defaultSize: 'm', sources: ['cloud'], blurb: 'Each client’s health at a glance.',
    render(d) {
      const l = d.cloud?.clients?.list || []
      if (!l.length) return note('No clients are set up yet.', openBtn('cloud', 'Open Cloud'))
      return list(l.map(c => row({ dot: clientDot(c.health), t: c.name, s: `${(c.apps || []).length} app${(c.apps || []).length === 1 ? '' : 's'}`, r: esc(c.health || c.status || '') })))
    },
    detail(d) {
      const l = d.cloud?.clients?.list || []
      return l.map(c => dsec(c.name, dlist([dkv('Status', esc(c.status || '–')), dkv('Health', esc(c.health || '–')), ...(c.apps || []).map(a => row({ dot: appUp(a) ? 'var(--green)' : 'var(--red)', t: a.name, s: appNote(a) }))]))).join('') || empty('No clients yet.')
    },
  })

  // --- Drives and iCloud
  const driveList = d => (d.drives?.entries || d.drives || []).filter(x => x && x.drive && x.type !== 'iCloud' && x.size)
  const backupDrive = d => driveList(d).slice(1).sort((a, b) => b.size - a.size)[0]
  const driveName = x => `${x.name}${x.label ? ` ${x.label}` : ''}`
  reg({
    id: 'drives', label: 'Drives', cat: 'Storage', icon: 'drive', tint: 'var(--gray)', tab: 'drives',
    sizes: ['s', 'm'], defaultSize: 'm', sources: ['drives'], blurb: 'Free space on this PC’s drives.',
    render(d, size) {
      const dr = driveList(d)
      if (!dr.length) return note('No drives found.')
      if (size === 's') {
        const c = dr.find(x => x.name === 'C:') || dr[0], p = pct(c.size - c.free, c.size)
        return fig(bytes(c.free), `free of ${bytes(c.size)}`) + meter(driveName(c), `${Math.round(p)}%`, p, tone(p))
      }
      return dr.map(x => { const p = pct(x.size - x.free, x.size); return meter(driveName(x), `${bytes(x.free)} free`, p, tone(p)) }).join('')
    },
    detail(d) {
      return dsec('Drives', dlist(driveList(d).map(x => { const p = pct(x.size - x.free, x.size); return `<div>${meter(driveName(x), `${bytes(x.free)} free of ${bytes(x.size)}`, p, tone(p))}</div>` })))
    },
  })
  reg({
    id: 'backup-drive', label: 'Backup drive', labels: { s: 'Backup' }, cat: 'Storage', icon: 'drive', tint: 'var(--green)', tab: 'drives',
    sizes: ['s'], defaultSize: 's', sources: ['drives'], blurb: 'Free space on your largest drive besides the system one, and whether it’s plugged in.',
    render(d) {
      const x = backupDrive(d)
      if (!x) return fig('Not found', 'Plug in a backup drive', { sm: true })
      const p = pct(x.size - x.free, x.size)
      return fig(bytes(x.free), `free of ${bytes(x.size)}`) + meter(x.label || x.name, `${Math.round(p)}%`, p, tone(p))
    },
    detail(d) {
      const x = backupDrive(d)
      if (!x) return empty('No drive besides the system one is plugged in.')
      return dhero(bytes(x.free), 'free') + dsec(x.label || x.name, dlist([dkv('Size', bytes(x.size)), dkv('Used', bytes(x.size - x.free)), dkv('Type', esc(x.type || '–'))]))
    },
  })
  reg({
    id: 'icloud', label: 'iCloud storage', labels: { s: 'iCloud' }, cat: 'Storage', icon: 'cloud', tint: 'var(--blue)', tab: 'drives',
    sizes: ['s', 'm'], defaultSize: 's', sources: ['icloud'], blurb: 'How much of your iCloud storage is used, by kind.',
    render(d, size) {
      const s = d.icloud
      if (!s?.total) return note('iCloud storage isn’t available.')
      const p = pct(s.used, s.total)
      if (size === 's') return fig(bytes(s.used), `of ${bytes(s.total)} used`) + meter('Used', `${Math.round(p)}%`, p, tone(p, 75, 90))
      const top = (s.media || []).slice().sort((a, b) => b.bytes - a.bytes).slice(0, size === 'l' ? 8 : 3)
      return fig(bytes(s.used), `of ${bytes(s.total)} · ${bytes(s.available)} free`, { sm: true }) + split((s.media || []).map(m => ({ p: pct(m.bytes, s.total), c: m.color, l: m.label }))) + list(top.map(m => row({ dot: m.color, t: m.label, r: bytes(m.bytes) })))
    },
    detail(d) {
      const s = d.icloud
      if (!s?.total) return empty('iCloud storage isn’t available.')
      return dhero(bytes(s.used), `of ${bytes(s.total)} used · ${bytes(s.available)} free`) + split((s.media || []).map(m => ({ p: pct(m.bytes, s.total), c: m.color, l: m.label }))) + dsec('What’s using it', dlist((s.media || []).slice().sort((a, b) => b.bytes - a.bytes).map(m => row({ dot: m.color, t: m.label, r: bytes(m.bytes) }))))
    },
  })

  // --- Services and health (the hub's own state)
  const hubState = d => d.state || {}
  reg({
    id: 'services', label: 'Services', cat: 'Laptop & Server', icon: 'list', tint: 'var(--green)', tab: 'laptop',
    sizes: ['s', 'm'], defaultSize: 's', sources: ['state'], blurb: 'Running web services on the laptop and the server.',
    render(d, size) {
      const st = hubState(d), lap = (st.laptop?.services || []).filter(s => s.kind === 'web').length, srv = (st.server?.services || []).length
      const stk = (ic, c, l, n) => `<div class="hw-stk" data-fit><span class="ic" style="--c:${c}">${icon(ic, 15)}</span><span class="l ell">${l}</span><span class="n">${n}</span></div>`
      const two = stk('laptop', 'var(--blue)', 'Laptop', lap) + stk('server', 'var(--green)', 'Server', srv)
      if (size === 's') return two + `<div class="hw-sub" data-fit>running web services</div>`
      const kinds = {}
      for (const s of st.server?.services || []) kinds[s.kind] = (kinds[s.kind] || 0) + 1
      const syncs = st.syncs?.list || [], live = syncs.filter(s => /watching/i.test(s.status)).length
      return two + list([row({ t: 'Dev servers', r: kinds.dev || 0 }), row({ t: 'Session previews', r: kinds.session || 0 }), row({ t: 'Production', r: kinds.production || 0 }), row({ t: 'Syncs up to date', r: `${live} of ${syncs.length}` })])
    },
    detail(d) {
      const st = hubState(d), kinds = {}
      for (const s of st.server?.services || []) kinds[s.kind] = (kinds[s.kind] || 0) + 1
      const syncs = st.syncs?.list || []
      return dsec('Laptop', dlist([dkv('Web services', (st.laptop?.services || []).filter(s => s.kind === 'web').length), dkv('Other listeners', (st.laptop?.services || []).filter(s => s.kind !== 'web').length)]))
        + dsec('Server', dlist(Object.entries(kinds).map(([k, v]) => dkv(k, v))))
        + (syncs.length ? dsec('Syncs', dlist(syncs.map(s => row({ dot: /watching/i.test(s.status) ? 'var(--green)' : 'var(--orange)', t: s.name, s: s.status })))) : '')
    },
  })
  const healthOf = (which, d) => {
    const st = hubState(d), side = st[which], h = side?.health
    if (!h) return null
    const cpu = which === 'server' ? pct(h.load?.[0] || 0, h.cores) : h.cpu
    const memUsed = h.memTotal - h.memAvailable
    return { h, cpu: cpu == null ? null : clamp(cpu), mem: pct(memUsed, h.memTotal), memUsed, disk: pct(h.diskTotal - h.diskFree, h.diskTotal), side }
  }
  function healthWidget(which, label, icon_, tint, tab) {
    reg({
      id: `${which}-health`, label: `${label} health`, labels: { s: label }, cat: 'Laptop & Server', icon: icon_, tint, tab,
      sizes: ['s', 'm'], defaultSize: 's', sources: ['state'], blurb: `CPU, memory and disk on the ${label.toLowerCase()}.`,
      render(d, size) {
        const m = healthOf(which, d)
        if (!m) return note(which === 'server' ? 'Can’t reach the server.' : 'No laptop readings yet.', openBtn(tab, `Open ${tabName(tab)}`))
        const parts = [['CPU', m.cpu], ['Memory', m.mem], ['Disk', m.disk]]
        if (size === 's') return parts.map(([n, p]) => meter(n, p == null ? '–' : `${Math.round(p)}%`, p ?? 0, tone(p ?? 0))).join('')
        return `<div class="hw-rings" data-fit>${parts.map(([n, p]) => `<div>${ring(p ?? 0, tone(p ?? 0), p == null ? '–' : `${Math.round(p)}%`, 70, 8, 17)}<span>${n}</span></div>`).join('')}</div><div class="hw-sub c ell" data-fit>${m.h.cores} cores · ${bytes(m.memUsed)} of ${bytes(m.h.memTotal)} memory · up ${until(m.h.uptime * 1000)}</div>`
      },
      detail(d) {
        const m = healthOf(which, d)
        if (!m) return empty('No readings yet.')
        const { h } = m
        const rows = [dkv('CPU', m.cpu == null ? '–' : `${Math.round(m.cpu)}%`), dkv('Cores', h.cores)]
        if (h.load) rows.push(dkv('Load (1, 5, 15 min)', h.load.map(x => x.toFixed(1)).join(' · ')))
        rows.push(dkv('Memory', `${bytes(m.memUsed)} of ${bytes(h.memTotal)}`))
        if (h.swapTotal) rows.push(dkv('Swap', `${bytes(h.swapTotal - h.swapFree)} of ${bytes(h.swapTotal)}`))
        rows.push(dkv('Disk', `${bytes(h.diskTotal - h.diskFree)} of ${bytes(h.diskTotal)} (${bytes(h.diskFree)} free)`), dkv('Up for', until(h.uptime * 1000)))
        return dhero(`${Math.round(m.mem)}<small>% memory</small>`, '') + dsec(label, dlist(rows))
      },
    })
  }
  healthWidget('server', 'Server', 'pulse', 'var(--green)', 'server')
  healthWidget('laptop', 'Laptop', 'laptop', 'var(--blue)', 'laptop')

  // --- Clock
  const isoWeek = d => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)
  }
  // Hour, minute and second hand angles, in degrees from twelve o'clock.
  const handAngles = now => [(now.getHours() % 12) * 30 + now.getMinutes() * 0.5, now.getMinutes() * 6 + now.getSeconds() * 0.1, now.getSeconds() * 6]
  function faceSvg(now, px, secs) {
    const ticks = Array.from({ length: 12 }, (_, i) => {
      const a = (i * Math.PI) / 6, r1 = i % 3 ? 40 : 36, r2 = 43
      return `<line class="tk" x1="${(50 + r1 * Math.sin(a)).toFixed(2)}" y1="${(50 - r1 * Math.cos(a)).toFixed(2)}" x2="${(50 + r2 * Math.sin(a)).toFixed(2)}" y2="${(50 - r2 * Math.cos(a)).toFixed(2)}" stroke-width="${i % 3 ? 1.4 : 2.6}"/>`
    }).join('')
    const [h, m, s] = handAngles(now)
    return `<svg viewBox="0 0 100 100" width="${px}" height="${px}" role="img" aria-label="Clock"><circle class="face" cx="50" cy="50" r="48" stroke-width=".6"/>${ticks}<line class="hh" data-hw-hand="h" x1="50" y1="52" x2="50" y2="27" stroke-width="4.2" transform="rotate(${h.toFixed(1)} 50 50)"/><line class="mh" data-hw-hand="m" x1="50" y1="53" x2="50" y2="14" stroke-width="2.8" transform="rotate(${m.toFixed(1)} 50 50)"/>${secs ? `<line class="sh" data-hw-hand="s" x1="50" y1="60" x2="50" y2="11" stroke-width="1.2" transform="rotate(${s.toFixed(1)} 50 50)"/>` : ''}<circle cx="50" cy="50" r="2.8" style="fill:var(--t, var(--orange))"/></svg>`
  }
  reg({
    id: 'clock', label: 'Clock & date', cat: 'Utility', icon: 'clock', tint: 'var(--orange)', tab: 'calendar',
    sizes: ['s', 'm'], defaultSize: 's', sources: [], blurb: 'The time and today’s date.',
    render(d, size, ui, o = {}) {
      const now = new Date(), full = fmtTime(now), t = full.replace(/\s?([AP]M)$/i, ''), ap = (/([AP]M)$/i.exec(full) || [])[1] || ''
      const dayOfYear = Math.round((startOfDay(now) - new Date(now.getFullYear(), 0, 0)) / 86400000), secs = !!o.seconds
      const digital = (fitted, big) => `<div class="hw-clock${big ? ' big' : ''}"${fitted ? ' data-fit' : ''}><div class="v"><span data-hw-time>${esc(t)}</span>${secs ? `<span class="sec" data-hw-sec>${String(now.getSeconds()).padStart(2, '0')}</span>` : ''}<small data-hw-ampm>${esc(ap)}</small></div><div class="d ell" data-hw-date="${size}">${esc(size === 'm' ? now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : fmtDay(now))}</div></div>`
      const week = size === 'm' ? `<div class="hw-sub" data-fit>Week ${isoWeek(now)} · day ${dayOfYear} of the year</div>` : ''
      if (o.face !== 'analog') return digital(true, !secs) + week
      if (size === 's') return `<div class="hw-analog" data-fit>${faceSvg(now, 116, secs)}</div>`
      return `<div class="hw-clockm" data-fit><div class="hw-analog">${faceSvg(now, 112, secs)}</div>${digital(false, false)}</div>`
    },
    detail() {
      const now = new Date(), dayOfYear = Math.round((startOfDay(now) - new Date(now.getFullYear(), 0, 0)) / 86400000)
      return dhero(esc(fmtTime(now)), esc(now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))) + dsec('Today', dlist([dkv('Week', isoWeek(now)), dkv('Day of the year', dayOfYear), dkv('Time zone', esc(Intl.DateTimeFormat().resolvedOptions().timeZone || '–'))]))
    },
  })

  // --- Calendar
  const eventsOf = d => (d.calendar?.events || []).map(ev => { const from = toDate(ev.start), to = toDate(ev.end) || toDate(ev.start); return { ...ev, from, to } }).filter(ev => ev.from).sort((a, b) => a.from - b.from)
  const calGate = d => (d.calendar && d.calendar.connected === false ? note('Connect a calendar to see your events.', connectBtn('calendar-feed', 'calendar')) : '')
  const whenOf = ev => (ev.allDay ? 'All day' : fmtTime(ev.from))
  const dayName = day => { const t = startOfDay(new Date()), k = Math.round((startOfDay(day) - t) / 86400000); return k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : fmtDay(day) }
  const overlaps = (ev, a, b) => ev.from < b && (ev.to > a || (ev.to <= ev.from && ev.from >= a))
  const evRow = ev => row({ tm: whenOf(ev), t: ev.title || 'Untitled', s: ev.location || '' })
  reg({
    id: 'next-event', label: 'Next event', cat: 'Calendar', icon: 'calendar', tint: 'var(--red)', tab: 'calendar',
    sizes: ['s'], defaultSize: 's', sources: ['calendar'], blurb: 'The next thing on your calendar.',
    render(d) {
      const g = calGate(d)
      if (g) return g
      const now = Date.now(), evs = eventsOf(d).filter(ev => ev.to > now)
      const ev = evs.find(e => !e.allDay) || evs[0]
      if (!ev) return fig('Free', 'Nothing in the next 7 days', { sm: true })
      const started = ev.from <= now
      return `<div class="hw-evt2" data-fit><i class="rail"></i><div><div class="cd">${started ? 'Now' : `in ${esc(until(ev.from - now))}`}</div><div class="t">${esc(ev.title || 'Untitled')}</div><div class="hw-sub ell">${esc(ev.allDay ? `${dayName(ev.from)} · all day` : `${dayName(ev.from)} ${fmtTime(ev.from)}`)}</div></div></div>`
    },
    detail(d) {
      const now = Date.now(), evs = eventsOf(d).filter(ev => ev.to > now).slice(0, 8)
      return evs.length ? dsec('Coming up', dlist(evs.map(ev => row({ t: ev.title || 'Untitled', s: `${dayName(ev.from)} ${ev.allDay ? 'all day' : fmtTime(ev.from)}${ev.location ? ` · ${ev.location}` : ''}` })))) : empty('Nothing in the next 7 days.')
    },
  })
  reg({
    id: 'today', label: 'Today', cat: 'Calendar', icon: 'calendar', tint: 'var(--red)', tab: 'calendar',
    sizes: ['m', 'l'], defaultSize: 'm', sources: ['calendar'], blurb: 'Today’s agenda.',
    render(d) {
      const g = calGate(d)
      if (g) return g
      const a = startOfDay(new Date()), b = addDays(a, 1), evs = eventsOf(d).filter(ev => overlaps(ev, a, b))
      if (!evs.length) return fig('Clear', 'Nothing on today', { sm: true })
      const now = Date.now(), left = evs.filter(ev => ev.to > now).length
      return `<div class="hw-sub ell" data-fit><b>${evs.length} ${evs.length === 1 ? 'event' : 'events'}</b>${left && left < evs.length ? ` · ${left} to go` : ''}</div><div class="hw-tl" data-fit-list>${evs.map(ev => {
        const past = !ev.allDay && ev.to <= now, on = !ev.allDay && ev.from <= now && ev.to > now
        return `<div class="hw-tlrow${past ? ' past' : ''}${on ? ' now' : ''}"><span class="tm">${esc(on ? 'Now' : whenOf(ev))}</span><i class="bar"></i><span class="t"><b>${esc(ev.title || 'Untitled')}</b>${ev.location ? `<span>${esc(ev.location)}</span>` : ''}</span></div>`
      }).join('')}</div>`
    },
    detail(d) {
      const a = startOfDay(new Date()), b = addDays(a, 1), evs = eventsOf(d).filter(ev => overlaps(ev, a, b))
      return evs.length ? dsec(fmtDay(a), dlist(evs.map(ev => row({ t: ev.title || 'Untitled', s: `${ev.allDay ? 'All day' : `${fmtTime(ev.from)} – ${fmtTime(ev.to)}`}${ev.location ? ` · ${ev.location}` : ''}` })))) : empty('Nothing on today.')
    },
  })
  reg({
    id: 'week', label: 'This week', cat: 'Calendar', icon: 'calendar', tint: 'var(--red)', tab: 'calendar',
    sizes: ['l'], defaultSize: 'l', sources: ['calendar'], blurb: 'The next seven days, day by day.',
    render(d) {
      const g = calGate(d)
      if (g) return g
      const t0 = startOfDay(new Date()), evs = eventsOf(d)
      const out = []
      for (let i = 0; i < 7; i++) {
        const a = addDays(t0, i), b = addDays(a, 1), day = evs.filter(ev => overlaps(ev, a, b))
        if (!day.length) continue
        out.push(`<div class="hw-dayh" data-fit-head>${esc(dayName(a))}</div>`, ...day.map(evRow))
      }
      return out.length ? `<div class="hw-list" data-fit-list>${out.join('')}</div>` : fig('Clear', 'Nothing in the next 7 days', { sm: true })
    },
    detail(d) {
      const t0 = startOfDay(new Date()), evs = eventsOf(d)
      let html = ''
      for (let i = 0; i < 7; i++) {
        const a = addDays(t0, i), b = addDays(a, 1), day = evs.filter(ev => overlaps(ev, a, b))
        if (day.length) html += dsec(dayName(a), dlist(day.map(ev => row({ t: ev.title || 'Untitled', s: `${ev.allDay ? 'All day' : `${fmtTime(ev.from)} – ${fmtTime(ev.to)}`}${ev.location ? ` · ${ev.location}` : ''}` }))))
      }
      return html || empty('Nothing in the next 7 days.')
    },
  })

  // --- Stripe
  const stripeAccts = d => d.stripe?.accounts || []
  const stripeLive = d => stripeAccts(d).filter(a => a.connected && !a.error)
  const curOf = a => String(a.currency || a.balance?.available?.[0]?.currency || 'usd').toLowerCase()
  function sumBy(accts, pick) {
    const m = new Map()
    for (const a of accts) {
      const v = pick(a)
      const items = Array.isArray(v) ? v : v == null ? [] : [{ amount: v, currency: curOf(a) }]
      for (const x of items) { const c = String(x.currency || curOf(a)).toLowerCase(); m.set(c, (m.get(c) || 0) + (Number(x.amount) || 0)) }
    }
    return m
  }
  const primaryCur = m => [...m.entries()].sort((a, b) => b[1] - a[1])[0] || ['usd', 0]
  const stripeGate = d => {
    if (stripeLive(d).length) return ''
    const err = stripeAccts(d).find(a => a.error)
    if (err) return note(esc(`Stripe: ${err.error}`), openBtn('stripe', 'Open Stripe'))
    return connect('Connect Stripe', 'Balance, sales and MRR show here.', 'stripe', 'card', 'stripe')
  }
  const modeNote = d => (stripeLive(d).every(a => a.mode === 'test') ? 'Test mode' : '')
  const stripeDaily = d => {
    const m = new Map()
    for (const a of stripeLive(d)) for (const x of a.daily || []) m.set(x.day, (m.get(x.day) || 0) + (Number(x.gross) || 0))
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-30)
  }
  reg({
    id: 'stripe-balance', label: 'Stripe balance', labels: { s: 'Stripe' }, cat: 'Stripe', icon: 'coin', tint: 'var(--indigo)', tab: 'stripe',
    sizes: ['s', 'm'], defaultSize: 's', sources: ['stripe'], blurb: 'Your available Stripe balance, and what’s still pending.', connect: 'Connect Stripe to see your balance.',
    render(d, size) {
      const g = stripeGate(d)
      if (g) return g
      const acc = stripeLive(d), av = sumBy(acc, a => a.balance?.available), pe = sumBy(acc, a => a.balance?.pending)
      const [cur, amt] = primaryCur(av), pend = pe.get(cur) || 0
      const f = fig(money(amt, cur, amt >= 1e7), `${money(pend, cur)} pending${modeNote(d) ? ` · ${modeNote(d)}` : ''}`)
      if (size === 's') return f
      const last = sumBy(acc, a => a.last30?.gross).get(cur) || 0, mrr = sumBy(acc, a => a.mrr).get(cur) || 0
      return f + `<div class="hw-split2" data-fit>${fig(money(last, cur, last >= 1e7), '30 day sales', { sm: true })}${fig(money(mrr, cur, mrr >= 1e7), 'MRR', { sm: true })}</div>`
    },
    detail(d) {
      const acc = stripeLive(d)
      return acc.map(a => { const c = curOf(a), av = sumBy([a], x => x.balance?.available), pe = sumBy([a], x => x.balance?.pending); return dsec(`${a.label || 'Stripe'}${a.mode ? ` · ${a.mode}` : ''}`, dlist([dkv('Available', [...av.entries()].map(([k, v]) => money(v, k)).join(', ') || money(0, c)), dkv('Pending', [...pe.entries()].map(([k, v]) => money(v, k)).join(', ') || money(0, c)), a.mrr != null ? dkv('MRR', money(a.mrr, c)) : '', a.activeSubs != null ? dkv('Active subscriptions', a.activeSubs) : ''].filter(Boolean))) }).join('') || empty('No connected Stripe accounts.')
    },
  })
  reg({
    id: 'revenue', label: 'Revenue, 30 days', labels: { m: 'Revenue 30 days' }, cat: 'Stripe', icon: 'trend', tint: 'var(--green)', tab: 'stripe',
    sizes: ['m', 'l'], defaultSize: 'm', sources: ['stripe'], blurb: 'Sales over the last 30 days with a daily trend.', connect: 'Connect Stripe to see your revenue.',
    render(d, size) {
      const g = stripeGate(d)
      if (g) return g
      const acc = stripeLive(d), [cur, gross] = primaryCur(sumBy(acc, a => a.last30?.gross))
      const net = sumBy(acc, a => a.last30?.net).get(cur) || 0, n = acc.reduce((s, a) => s + (Number(a.last30?.count) || 0), 0)
      const daily = stripeDaily(d).map(x => x[1])
      return fig(money(gross, cur, gross >= 1e7), `${n} payment${n === 1 ? '' : 's'} · ${money(net, cur)} net`) + `<div class="hw-grow" data-fit>${spark(daily, { h: size === 'l' ? 110 : 40, c: 'var(--green)' })}</div>`
    },
    detail(d) {
      const acc = stripeLive(d)
      if (!acc.length) return empty('No connected Stripe accounts.')
      const [cur, gross] = primaryCur(sumBy(acc, a => a.last30?.gross)), net = sumBy(acc, a => a.last30?.net).get(cur) || 0
      return dhero(money(gross, cur), 'gross sales, last 30 days') + `<div>${spark(stripeDaily(d).map(x => x[1]), { h: 90, c: 'var(--green)' })}</div>` + dsec('Totals', dlist([dkv('Net', money(net, cur)), dkv('Payments', acc.reduce((s, a) => s + (Number(a.last30?.count) || 0), 0)), dkv('MRR', money(sumBy(acc, a => a.mrr).get(cur) || 0, cur)), dkv('Active subscriptions', acc.reduce((s, a) => s + (Number(a.activeSubs) || 0), 0))]))
    },
  })
  const chargesOf = d => stripeLive(d).flatMap(a => (a.recentCharges || []).map(c => ({ ...c, at: toDate(c.created) }))).filter(c => c.at).sort((a, b) => b.at - a.at)
  const chargeDot = c => (/succeed|paid/i.test(c.status || '') ? 'var(--green)' : /fail|refund|dispute/i.test(c.status || '') ? 'var(--red)' : 'var(--orange)')
  const ago_ = t => { const s = (Date.now() - t) / 1000; return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago` }
  reg({
    id: 'payments', label: 'Recent payments', cat: 'Stripe', icon: 'card', tint: 'var(--indigo)', tab: 'stripe',
    sizes: ['m', 'l'], defaultSize: 'l', sources: ['stripe'], blurb: 'The latest charges across your Stripe accounts.', connect: 'Connect Stripe to see your payments.',
    render(d) {
      const g = stripeGate(d)
      if (g) return g
      const cs = chargesOf(d)
      if (!cs.length) return fig('None yet', 'No payments to show', { sm: true })
      return list(cs.map(c => row({ dot: chargeDot(c), t: c.description || c.customer || 'Payment', s: ago_(c.at), r: money(c.amount, c.currency || 'usd') })))
    },
    detail(d) {
      const cs = chargesOf(d)
      return cs.length ? dsec('Latest charges', dlist(cs.map(c => row({ dot: chargeDot(c), t: c.description || c.customer || 'Payment', s: `${c.status || ''} · ${ago_(c.at)}`, r: money(c.amount, c.currency || 'usd') })))) : empty('No payments to show yet.')
    },
  })

  /* ---------- more widgets: every one reads live hub data, nothing is sample ---------- */

  const PAL = ['var(--indigo)', 'var(--blue)', 'var(--green)', 'var(--orange)', 'var(--red)', 'var(--gray)']
  const srcOf = w => [...(w.sources || []), ...(w.also || []).filter(s => !addonOff(SOURCE_ADDON[s]))]
  const baseName = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '')
  const capital = s => String(s || '').replace(/^\w/, c => c.toUpperCase())
  function donut(parts, size = 96, sw = 14, center = '') {
    const total = parts.reduce((s, p) => s + p.v, 0), r = (size - sw) / 2, c = 2 * Math.PI * r, m = size / 2
    let off = 0
    const segs = total > 0 ? parts.filter(p => p.v > 0).map(p => {
      const len = (c * p.v) / total, shown = Math.max(0.5, len - 1.5)
      const el = `<circle cx="${m}" cy="${m}" r="${r}" fill="none" stroke="${p.c}" stroke-width="${sw}" stroke-dasharray="${shown.toFixed(1)} ${(c - shown).toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 ${m} ${m})"/>`
      off += len
      return el
    }).join('') : ''
    return `<div class="hw-ring" style="width:${size}px;height:${size}px;--rs:${size > 110 ? 20 : 16}px"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${m}" cy="${m}" r="${r}" fill="none" stroke="var(--fill-2)" stroke-width="${sw}"/>${segs}</svg><span>${center}</span></div>`
  }
  const unavailable = (what, tab, service) => note(esc(what), connectBtn(service, tab))

  /* --- AI --- */
  const acctSlug = a => slug(shortName(a))
  const limitRows = a => {
    const u = a.usage
    if (!u) return []
    const out = []
    for (const l of u.limits || []) out.push(meter(`${l.name} limit`, `${Math.round(l.pct)}%${l.resetsAt ? ` · ${until(l.resetsAt - Date.now())}` : ''}`, l.pct, tone(l.pct)))
    for (const c of u.credits || []) out.push(meter('Credits', `${moneyMajor(c.used, 'USD', true)} of ${moneyMajor(c.limit, 'USD', true)}`, c.pct, tone(c.pct)))
    for (const b of u.breakdown || []) out.push(meter(b.name, `${Math.round(b.pct)}%`, b.pct, 'blue'))
    return out
  }
  const acctDetail = a => {
    const u = a.usage
    if (!u) return dsec(shortName(a), dlist([dkv('Status', esc(a.message || 'Not signed in'))]))
    const rows = []
    for (const [name, v] of [['5 hour', u.fiveHour], ['7 day', u.sevenDay]]) if (v) rows.push(`<div>${meter(name, `${Math.round(v.pct)}%${v.resetsAt ? ` · ${resetIn(v.resetsAt)}` : ''}`, v.pct, tone(v.pct))}</div>`)
    for (const l of u.limits || []) rows.push(dkv(`${l.name} limit`, `${Math.round(l.pct)}%${l.resetsAt ? ` · ${resetIn(l.resetsAt)}` : ''}`))
    for (const c of u.credits || []) rows.push(dkv('Credits', `${moneyMajor(c.used, 'USD')} of ${moneyMajor(c.limit, 'USD')}`))
    for (const b of u.breakdown || []) rows.push(dkv(b.name, `${Math.round(b.pct)}%`))
    return dsec(`${shortName(a)}${a.plan ? ` · ${a.plan}` : ''}`, dlist(rows)) + (a.history?.length > 1 ? dsec('Last readings', `<div class="hw-dchart">${usageChart(a.history, 'hw-grow')}</div>`) : '')
  }
  window.registerHomeFamily({
    prefix: 'claude-account.', title: 'Claude: ', source: 'ai', cat: 'AI', icon: 'gauge', tint: 'var(--indigo)', tab: 'ai',
    items: d => accountsOf(d).map(a => ({ key: acctSlug(a), label: `Claude: ${shortName(a)}` })),
    make: key => ({
      sizes: ['s', 'm', 'l'], defaultSize: 's', blurb: 'One Claude account: its 5-hour and 7-day usage, resets and history.',
      render(d, size) {
        const a = accountsOf(d).find(x => acctSlug(x) === key)
        if (!a) return unavailable('This account isn’t listed on this hub.', 'ai')
        if (!a.usage) return unavailable(a.message || 'Sign in to see its usage.', 'ai')
        const f = a.usage.fiveHour, s7 = a.usage.sevenDay
        if (size === 's') return `<div class="hw-ringwrap" data-fit>${ring(f?.pct ?? 0, tone(f?.pct ?? 0), `${Math.round(f?.pct ?? 0)}%`, 84, 9, 20)}</div><div class="hw-sub c ell" data-fit>${f?.resetsAt ? esc(resetIn(f.resetsAt)) : esc(a.plan || '5 hour')}</div>`
        let html = (a.plan ? `<div class="hw-sub ell" data-fit>${esc(a.plan)}</div>` : '') + meter('5 hour', `${Math.round(f?.pct ?? 0)}%${f?.resetsAt ? ` · ${until(f.resetsAt - Date.now())}` : ''}`, f?.pct ?? 0, tone(f?.pct ?? 0)) + meter('7 day', `${Math.round(s7?.pct ?? 0)}%${s7?.resetsAt ? ` · ${until(s7.resetsAt - Date.now())}` : ''}`, s7?.pct ?? 0, tone(s7?.pct ?? 0))
        if (size === 'l') html += limitRows(a).join('') + usageChart(a.history)
        return html
      },
      detail: d => { const a = accountsOf(d).find(x => acctSlug(x) === key); return a ? acctDetail(a) : empty('This account isn’t listed on this hub.') },
    }),
  })
  reg({
    id: 'claude-reset', label: 'Claude reset timer', labels: { s: 'Resets in' }, cat: 'AI', icon: 'clock', tint: 'var(--indigo)', tab: 'ai',
    sizes: ['s', 'm'], defaultSize: 's', sources: ['ai'], blurb: 'Countdown to the next 5-hour and 7-day Claude limit resets.',
    render(d, size) {
      const accs = accountsOf(d).filter(a => a.usage)
      if (!accs.length) return unavailable('Sign in to a Claude account to see resets.', 'ai', 'claude-account')
      const t = x => (x ? until(x - Date.now()) : '–')
      if (size === 's') { const a = mainAccount(accs); return fig(t(a.usage.fiveHour?.resetsAt), '5 hour window resets') + `<div class="hw-sub ell" data-fit>${esc(shortName(a))} · ${Math.round(a.usage.fiveHour?.pct ?? 0)}% used</div>` }
      return list(accs.flatMap(a => [row({ t: `${shortName(a)} · 5 hour`, r: t(a.usage.fiveHour?.resetsAt) }), row({ t: `${shortName(a)} · 7 day`, r: t(a.usage.sevenDay?.resetsAt) })]))
    },
  })
  const paceOf = a => {
    const s = a.usage?.sevenDay
    if (!s?.resetsAt) return null
    const el = clamp(100 - ((s.resetsAt - Date.now()) / (7 * 86400000)) * 100), used = s.pct ?? 0
    return { used, el, proj: el > 3 ? (used / el) * 100 : null, state: used > el + 8 ? 'ahead' : used < el - 8 ? 'behind' : 'on' }
  }
  const PACE = { ahead: ['Burning fast', 'var(--orange)'], behind: ['Room to spare', 'var(--green)'], on: ['On pace', 'var(--green)'] }
  reg({
    id: 'claude-pace', label: 'Claude 7-day pace', labels: { s: 'Weekly pace' }, cat: 'AI', icon: 'trend', tint: 'var(--indigo)', tab: 'ai',
    sizes: ['s', 'm'], defaultSize: 's', sources: ['ai'], blurb: 'How your 7-day usage compares with how much of the week has passed.',
    render(d, size) {
      const accs = accountsOf(d).filter(a => a.usage && paceOf(a))
      if (!accs.length) return unavailable('No 7-day window to compare yet.', 'ai')
      const one = a => { const p = paceOf(a), [txt, col] = PACE[p.state]; return { p, txt, col } }
      if (size === 's') {
        const a = mainAccount(accs), { p, txt, col } = one(a)
        return `<div class="hw-fig"><div class="v" style="color:${col};font-size:26px">${txt}</div><div class="hw-sub ell">${Math.round(p.used)}% used · ${Math.round(p.el)}% of week</div></div>` + meter('Used', `${Math.round(p.used)}%`, p.used, tone(p.used)) + meter('Week gone', `${Math.round(p.el)}%`, p.el, 'blue')
      }
      return cols(Math.min(accs.length, 2), accs.slice(0, 2).map(a => {
        const { p, txt, col } = one(a)
        return `<div class="hw-col"><h4 class="ell">${esc(shortName(a))}</h4><div class="hw-sub" data-fit style="color:${col};font-weight:600">${txt}</div>${meter('Used', `${Math.round(p.used)}%`, p.used, tone(p.used))}${meter('Week gone', `${Math.round(p.el)}%`, p.el, 'blue')}${p.proj != null ? `<div class="hw-sub ell" data-fit>On track for ${Math.round(p.proj)}% at reset</div>` : ''}</div>`
      }))
    },
  })
  reg({
    id: 'claude-limits', label: 'Claude model limits', labels: { m: 'Model limits' }, cat: 'AI', icon: 'list', tint: 'var(--indigo)', tab: 'ai',
    sizes: ['m', 'l'], defaultSize: 'm', sources: ['ai'], blurb: 'Fable and other per-model limits, credits and where usage goes, per account.',
    render(d, size) {
      const accs = accountsOf(d).filter(a => a.usage)
      if (!accs.length) return unavailable('Sign in to a Claude account to see limits.', 'ai', 'claude-account')
      return cols(Math.min(accs.length, size === 'l' ? 2 : 2), accs.slice(0, 2).map(a => `<div class="hw-col"><h4 class="ell">${esc(shortName(a))}</h4>${limitRows(a).join('') || '<div class="hw-sub" data-fit>No extra limits.</div>'}</div>`))
    },
    detail: d => accountsOf(d).map(acctDetail).join('') || empty('No Claude accounts.'),
  })
  const modelParts = d => {
    const st = tokenStats(d), top = Object.entries(st.byModel).sort((a, b) => b[1] - a[1]), total = top.reduce((s, x) => s + x[1], 0)
    const shown = top.slice(0, 5).map(([m, v], i) => ({ v, c: PAL[i], l: modelName(st, m) }))
    const rest = top.slice(5).reduce((s, x) => s + x[1], 0)
    if (rest > 0) shown.push({ v: rest, c: PAL[5], l: 'Other' })
    return { st, parts: shown, total }
  }
  reg({
    id: 'tokens-models', label: 'Tokens by model', labels: { s: 'By model' }, cat: 'AI', icon: 'chip', tint: 'var(--indigo)', tab: 'ai',
    sizes: ['s', 'm', 'l'], defaultSize: 'm', sources: ['ai'], blurb: 'A donut of the last 30 days of tokens, split by model.',
    render(d, size) {
      const { parts, total } = modelParts(d)
      if (!total) return fig('0', 'No tokens in 30 days')
      if (size === 's') return `<div class="hw-ringwrap" data-fit>${donut(parts, 92, 13, compact(total))}</div><div class="hw-sub c ell" data-fit>${esc(parts[0].l)} leads</div>`
      return `<div class="hw-donutwrap">${donut(parts, size === 'l' ? 128 : 100, size === 'l' ? 17 : 14, compact(total))}${list(parts.map(p => row({ dot: p.c, t: p.l, r: `${Math.round(pct(p.v, total))}%` })))}</div>`
    },
    detail(d) { const { parts, total } = modelParts(d); return dhero(compact(total), 'tokens in 30 days (input + output)') + dsec('Models', dlist(parts.map(p => row({ dot: p.c, t: p.l, s: `${Math.round(pct(p.v, total))}%`, r: compact(p.v) })))) },
  })
  const machineTotals = d => {
    const st = tokenStats(d), t = d.ai?.tokens || {}, mach = {}, acct = {}
    const info = Object.fromEntries((t.sources || []).map(s => [s.key, s]))
    for (const r of t.rows || []) {
      if (!st.days.includes(r.d)) continue
      const s = info[r.src], m = s?.machine || String(r.src).split(':')[0], io = r.i + r.o
      mach[m] = (mach[m] || 0) + io
      const k = `${m} · ${String(s?.account || r.src).split('@')[0]}`
      acct[k] = (acct[k] || 0) + io
    }
    return { mach, acct }
  }
  reg({
    id: 'tokens-machines', label: 'Tokens by machine', cat: 'AI', icon: 'chip', tint: 'var(--indigo)', tab: 'ai',
    sizes: ['m', 'l'], defaultSize: 'm', sources: ['ai'], blurb: 'Which machine, and which account on it, used the tokens this month.',
    render(d, size) {
      const { mach, acct } = machineTotals(d), top = Object.entries(mach).sort((a, b) => b[1] - a[1])
      if (!top.length) return fig('0', 'No tokens in 30 days')
      const max = top[0][1]
      let html = top.map(([m, v]) => meter(m, compact(v), pct(v, max), 'blue')).join('')
      if (size === 'l') html += Object.entries(acct).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => meter(k, compact(v), pct(v, max), '')).join('')
      return html
    },
  })
  reg({
    id: 'tokens-split', label: 'Laptop vs server tokens', labels: { s: 'Laptop / server' }, cat: 'AI', icon: 'chip', tint: 'var(--indigo)', tab: 'ai',
    sizes: ['s', 'm'], defaultSize: 's', sources: ['ai'], blurb: 'How the last 30 days of tokens split between the laptop and the server.',
    render(d, size) {
      const { mach } = machineTotals(d), lap = mach.Laptop || 0, srv = mach.Server || 0, tot = lap + srv
      if (!tot) return fig('0', 'No tokens in 30 days')
      const lp = pct(lap, tot)
      const bar = split([{ p: lp, c: 'var(--blue)', l: 'Laptop' }, { p: 100 - lp, c: 'var(--indigo)', l: 'Server' }])
      if (size === 's') return fig(`${Math.round(lp)}<small>% laptop</small>`, `${compact(lap)} laptop · ${compact(srv)} server`) + bar
      return `<div class="hw-split2" data-fit>${fig(compact(lap), 'laptop · 30 days', { sm: true })}${fig(compact(srv), 'server · 30 days', { sm: true })}</div>` + bar + `<div class="hw-legend" data-fit><span><i style="background:var(--blue)"></i>Laptop ${Math.round(lp)}%</span><span><i style="background:var(--indigo)"></i>Server ${Math.round(100 - lp)}%</span></div>`
    },
  })
  reg({
    id: 'sessions-recent', label: 'Recent Claude sessions', labels: { m: 'Recent sessions' }, cat: 'AI', icon: 'list', tint: 'var(--indigo)', tab: 'ai',
    sizes: ['m', 'l'], defaultSize: 'm', sources: ['ai'], blurb: 'The latest Claude Code sessions with the tokens each used this week.',
    render(d) {
      const st = tokenStats(d), ss = (d.ai?.tokens?.sessions || []).slice().sort((a, b) => b.last - a.last)
      if (!ss.length) return fig('None', 'No sessions yet', { sm: true })
      return list(ss.map(s => row({ t: baseName(s.cwd) || s.sid, s: `${modelName(st, s.model)} · ${ago_(s.last)}`, r: compact(s.io7) })))
    },
  })
  reg({
    id: 'openrouter-spend', label: 'OpenRouter spend', labels: { s: 'OR spend' }, cat: 'AI', icon: 'coin', tint: 'var(--blue)', tab: 'ai',
    sizes: ['s', 'm'], defaultSize: 's', sources: ['ai'], blurb: 'What your OpenRouter key spent today, this week and this month.',
    render(d, size) {
      const p = provider(d, 'openrouter')
      if (!p || !p.connected) return unavailable('Add an OpenRouter key to see spend.', 'ai', 'openrouter')
      if (size === 's') return fig(moneyMajor(p.monthly, 'USD'), 'this month') + `<div class="hw-sub ell" data-fit>${moneyMajor(p.weekly, 'USD')} this week</div>`
      return `<div class="hw-cols" style="--n:3" data-fit>${[['Today', p.daily], ['Week', p.weekly], ['Month', p.monthly]].map(([n, v]) => fig(moneyMajor(v, 'USD'), n, { sm: true })).join('')}</div>` + (p.keyLimit != null ? meter('Key limit', `${moneyMajor(p.keyRemaining, 'USD')} left`, pct(p.keyLimit - p.keyRemaining, p.keyLimit), tone(pct(p.keyLimit - p.keyRemaining, p.keyLimit))) : '')
    },
  })

  /* --- Cloud --- */
  const appsOf = d => d.cloud?.coolify?.apps || []
  const coolGate = d => { const c = d.cloud?.coolify; return c && c.status && c.status !== 'ok' ? unavailable('Coolify isn’t connected.', 'cloud', 'coolify') : '' }
  reg({
    id: 'coolify-apps', label: 'All Coolify apps', labels: { m: 'Coolify apps' }, cat: 'Cloud', icon: 'cloud', tint: 'var(--blue)', tab: 'cloud',
    sizes: ['m', 'l'], defaultSize: 'l', sources: ['cloud'], blurb: 'Every Coolify app with its status, down ones first.',
    render(d) {
      const g = coolGate(d)
      if (g) return g
      const apps = appsOf(d).slice().sort((a, b) => appUp(a) - appUp(b) || a.name.localeCompare(b.name))
      if (!apps.length) return fig('No apps', 'Coolify has no apps yet', { sm: true })
      return list(apps.map(a => row({ dot: upDot(appUp(a)), t: a.name, s: `${a.project || ''}${a.project ? ' · ' : ''}${appNote(a)}` })))
    },
  })
  reg({
    id: 'coolify-down', label: 'Apps that are down', labels: { s: 'Down' }, cat: 'Cloud', icon: 'cloud', tint: 'var(--red)', tab: 'cloud',
    sizes: ['s', 'm'], defaultSize: 's', sources: ['cloud'], blurb: 'Coolify apps that are not running right now.',
    render(d, size) {
      const g = coolGate(d)
      if (g) return g
      const down = appsOf(d).filter(a => !appUp(a))
      if (size === 's') return `<div class="hw-fig"><div class="v" style="color:${down.length ? 'var(--red)' : 'var(--green)'}">${down.length || 'None'}</div><div class="hw-sub ell">${down.length ? `app${down.length === 1 ? '' : 's'} down` : 'down right now'}</div></div>${down[0] ? `<div class="hw-sub ell" data-fit>${esc(down[0].name)}${down.length > 1 ? ` +${down.length - 1}` : ''}</div>` : ''}`
      return down.length ? list(down.map(a => row({ dot: 'var(--red)', t: a.name, s: appNote(a), r: a.lastOnline ? ago_(a.lastOnline) : '' }))) : fig('All up', `${appsOf(d).length} apps running`, { sm: true })
    },
  })
  const deployDot = s => (/finish|success|ok/i.test(s || '') ? 'var(--green)' : /fail|error|cancel/i.test(s || '') ? 'var(--red)' : 'var(--orange)')
  reg({
    id: 'deploys', label: 'Recent deploys', cat: 'Cloud', icon: 'trend', tint: 'var(--blue)', tab: 'cloud',
    sizes: ['m', 'l'], defaultSize: 'm', sources: ['cloud'], blurb: 'The latest deployments across your Coolify apps.',
    render(d) {
      const g = coolGate(d)
      if (g) return g
      const dep = appsOf(d).filter(a => a.deploy?.at).sort((a, b) => b.deploy.at - a.deploy.at)
      if (!dep.length) return fig('None', 'No deploys recorded', { sm: true })
      return list(dep.map(a => row({ dot: deployDot(a.deploy.status), t: a.name, s: `${a.deploy.commit || ''} ${a.deploy.restartOnly ? 'restart' : a.deploy.status || ''}`.trim(), r: ago_(a.deploy.at) })))
    },
  })
  window.registerHomeFamily({
    prefix: 'coolify-app.', title: 'App: ', source: 'cloud', cat: 'Coolify Apps', icon: 'cloud', tint: 'var(--blue)', tab: 'cloud',
    items: d => appsOf(d).map(a => ({ key: String(a.uuid).toLowerCase().replace(/[^a-z0-9]/g, ''), label: `App: ${a.name}` })),
    make: key => ({
      sizes: ['s', 'm'], defaultSize: 's', blurb: 'One Coolify app: is it running, where, and when it last deployed.',
      render(d, size) {
        const g = coolGate(d)
        if (g) return g
        const a = appsOf(d).find(x => String(x.uuid).toLowerCase().replace(/[^a-z0-9]/g, '') === key)
        if (!a) return unavailable('This app isn’t in Coolify any more.', 'cloud')
        const up = appUp(a), head = `<div class="hw-fig"><div class="v" style="color:${up ? 'var(--green)' : 'var(--red)'};font-size:26px">${up ? 'Running' : esc(capital(a.state || 'Down'))}</div><div class="hw-sub ell">${esc(a.name)}</div></div>`
        if (size === 's') return head + `<div class="hw-sub ell" data-fit>${esc(a.project || '')}${a.branch ? ` · ${esc(a.branch)}` : ''}</div>` + (a.deploy?.at ? `<div class="hw-sub ell" data-fit>Deployed ${esc(ago_(a.deploy.at))}</div>` : '')
        return head + list([a.project && row({ t: 'Project', r: esc(a.project) }), a.branch && row({ t: 'Branch', r: esc(a.branch) }), a.server && row({ t: 'Server', r: esc(a.server) }), a.deploy?.at && row({ dot: deployDot(a.deploy.status), t: 'Last deploy', s: a.deploy.commit || '', r: ago_(a.deploy.at) }), a.url && row({ t: 'Address', r: esc(String(a.url).replace(/^https?:\/\//, '')) })].filter(Boolean))
      },
    }),
  })
  window.registerHomeFamily({
    prefix: 'server.', title: 'Server: ', source: 'cloud', cat: 'Cloud', icon: 'server', tint: 'var(--green)', tab: 'cloud',
    items: d => (d.cloud?.servers?.list || []).map(s => ({ key: slug(s.name), label: `Server: ${s.name}` })),
    make: key => ({
      sizes: ['s', 'm'], defaultSize: 's', blurb: 'One server: reachable or not, its checks and response time.',
      render(d, size) {
        const s = (d.cloud?.servers?.list || []).find(x => slug(x.name) === key)
        if (!s) return unavailable('This server isn’t in the list.', 'cloud')
        const ms = s.checks?.find(c => c.ms != null)?.ms
        const head = `<div class="hw-fig"><div class="v" style="color:${upDot(s.up)};font-size:26px">${s.up ? 'Up' : 'Down'}</div><div class="hw-sub ell">${esc(s.name)}</div></div>`
        if (size === 's') return head + `<div class="hw-sub ell" data-fit>${esc(s.provider || '')}${ms != null ? ` · ${ms} ms` : ''}</div>`
        return head + list([s.provider && row({ t: 'Provider', r: esc(s.provider) }), s.host && row({ t: 'Address', r: esc(s.host) }), ...(s.checks || []).map(c => row({ dot: upDot(c.ok), t: `Port ${c.port}`, r: c.ms != null ? `${c.ms} ms` : c.ok ? 'open' : 'closed' }))].filter(Boolean))
      },
    }),
  })
  reg({
    id: 'cloudflare', label: 'Cloudflare', cat: 'Cloud', icon: 'cloud', tint: 'var(--orange)', tab: 'cloud',
    sizes: ['s', 'm', 'l'], defaultSize: 's', sources: ['cloud'], blurb: 'Zones, workers, pages, R2, D1 and KV on your Cloudflare account.',
    render(d, size) {
      const c = d.cloud?.cloudflare
      if (!c || c.status === 'connect') return unavailable('Connect Cloudflare to see zones and workers.', 'cloud', 'cloudflare')
      if (c.status !== 'ok') return unavailable(c.error || 'Cloudflare isn’t answering.', 'cloud')
      const n = k => (c[k]?.items || []).length
      const kinds = [['Zones', 'zones'], ['Workers', 'workers'], ['Pages', 'pages'], ['R2 buckets', 'r2'], ['D1', 'd1'], ['KV', 'kv']]
      if (size === 's') return fig(n('zones'), `zone${n('zones') === 1 ? '' : 's'}`) + `<div class="hw-sub ell" data-fit>${n('workers')} workers · ${n('pages')} pages</div>`
      if (size === 'm') return `<div class="hw-cols" style="--n:3" data-fit>${kinds.slice(0, 3).map(([l, k]) => fig(n(k), l, { sm: true })).join('')}</div>` + `<div class="hw-cols" style="--n:3" data-fit>${kinds.slice(3).map(([l, k]) => fig(n(k), l, { sm: true })).join('')}</div>`
      return list([...(c.zones?.items || []).map(z => row({ dot: z.paused ? 'var(--orange)' : z.status === 'active' ? 'var(--green)' : 'var(--gray)', t: z.name, s: z.plan, r: z.status })), ...(c.pages?.items || []).map(p => row({ dot: deployDot(p.status), t: p.name, s: 'Pages', r: p.at ? ago_(p.at) : '' }))])
    },
  })
  reg({
    id: 'cloud-providers', label: 'Cloud accounts', cat: 'Cloud', icon: 'cloud', tint: 'var(--blue)', tab: 'cloud',
    sizes: ['m'], defaultSize: 'm', sources: ['cloud'], blurb: 'Which cloud providers are connected to the hub.',
    render(d) {
      const c = d.cloud || {}, ok = x => x && x.status === 'ok'
      return list([
        row({ dot: ok(c.coolify) ? 'var(--green)' : 'var(--red)', t: 'Coolify', r: ok(c.coolify) ? 'Connected' : 'Not connected' }),
        row({ dot: ok(c.cloudflare) ? 'var(--green)' : 'var(--gray)', t: 'Cloudflare', r: ok(c.cloudflare) ? 'Connected' : 'Not connected' }),
        row({ dot: ok(c.aws) ? 'var(--green)' : 'var(--gray)', t: 'AWS', r: ok(c.aws) ? 'Connected' : 'Not connected' }),
        row({ dot: ok(c.azure) ? 'var(--green)' : 'var(--gray)', t: 'Azure', r: ok(c.azure) ? 'Connected' : 'Not connected' }),
        row({ dot: c.servers?.euronodes?.apiKeySet ? 'var(--green)' : 'var(--orange)', t: 'Euronodes', r: c.servers?.euronodes?.apiKeySet ? 'Connected' : 'API pending' }),
      ])
    },
  })
  const clientList = d => d.cloud?.clients?.list || []
  window.registerHomeFamily({
    prefix: 'client.', title: 'Client: ', source: 'cloud', cat: 'Cloud', icon: 'users', tint: 'var(--orange)', tab: 'cloud',
    items: d => clientList(d).map(c => ({ key: slug(c.name), label: `Client: ${c.name}` })),
    make: key => ({
      sizes: ['s', 'm'], defaultSize: 's', blurb: 'One client: overall health, their apps and their site checks.',
      render(d, size) {
        const c = clientList(d).find(x => slug(x.name) === key)
        if (!c) return unavailable('This client isn’t listed.', 'cloud')
        const col = clientDot(c.health), n = (c.apps || []).length
        const head = `<div class="hw-fig"><div class="v" style="color:${col};font-size:26px">${esc(capital(c.health || c.status || 'Unknown'))}</div><div class="hw-sub ell">${esc(c.name)}</div></div>`
        if (size === 's') return head + `<div class="hw-sub ell" data-fit>${n} app${n === 1 ? '' : 's'}${(c.checks || []).length ? ` · ${c.checks.length} site check${c.checks.length === 1 ? '' : 's'}` : ''}</div>`
        return head + list([...(c.apps || []).map(a => row({ dot: upDot(appUp(a)), t: a.name, s: appNote(a) })), ...(c.checks || []).map(k => row({ dot: siteOk(k) ? 'var(--green)' : 'var(--red)', t: k.domain, s: k.tlsError ? 'TLS error' : '', r: k.code ? `${k.code}${k.ms != null ? ` · ${k.ms} ms` : ''}` : k.error || '' }))])
      },
    }),
  })
  const siteOk = k => !k.error && !k.tlsError && k.code > 0 && k.code < 400
  reg({
    id: 'client-sites', label: 'Client sites', cat: 'Cloud', icon: 'users', tint: 'var(--orange)', tab: 'cloud',
    sizes: ['m', 'l'], defaultSize: 'm', sources: ['cloud'], blurb: 'Every client site check: up or down, response code, speed and TLS.',
    render(d) {
      const all = clientList(d).flatMap(c => (c.checks || []).map(k => ({ ...k, client: c.name })))
      if (!all.length) return fig('None', 'No site checks yet', { sm: true })
      return list(all.map(k => row({ dot: siteOk(k) ? 'var(--green)' : 'var(--red)', t: k.domain, s: k.tlsError ? 'TLS error' : k.client, r: k.code ? `${k.code}${k.ms != null ? ` · ${k.ms} ms` : ''}` : esc(k.error || 'no answer') })))
    },
  })
  reg({
    id: 'euronodes', label: 'Euronodes', cat: 'Cloud', icon: 'server', tint: 'var(--green)', tab: 'cloud',
    sizes: ['s', 'm'], defaultSize: 's', sources: ['cloud'], blurb: 'Your Euronodes servers and the state of the API connection.',
    render(d, size) {
      const l = (d.cloud?.servers?.list || []).filter(s => /euronodes/i.test(s.provider || '')), e = d.cloud?.servers?.euronodes || {}
      if (!l.length) return unavailable('No Euronodes servers are listed.', 'cloud')
      const up = l.filter(s => s.up).length
      if (size === 's') return fig(`${up}<small>of ${l.length} up</small>`, e.apiKeySet ? 'API connected' : 'API pending')
      return list([...l.map(s => row({ dot: upDot(s.up), t: s.name, s: s.host, r: s.checks?.find(c => c.ms != null)?.ms != null ? `${s.checks.find(c => c.ms != null).ms} ms` : '' })), row({ dot: e.apiKeySet ? 'var(--green)' : 'var(--orange)', t: 'API', r: e.apiKeySet ? 'Connected' : `Pending${e.ticket ? ` · ticket ${e.ticket}` : ''}` })])
    },
  })

  /* --- Laptop & Server --- */
  const svcName = (d, side, s) => d.state?.names?.[side]?.[s.port] || s.title || s.process || `Port ${s.port}`
  const svcWidget = (side, label, filter) => reg({
    id: `${side}-services`, label: `${label} services`, cat: 'Laptop & Server', icon: 'list', tint: side === 'server' ? 'var(--green)' : 'var(--blue)', tab: side,
    sizes: ['m', 'l'], defaultSize: 'm', sources: ['state'], blurb: `What is listening on the ${label.toLowerCase()}, by name and port.`,
    render(d) {
      const l = (d.state?.[side]?.services || []).filter(filter).sort((a, b) => a.port - b.port)
      if (!l.length) return fig('None', 'Nothing listening', { sm: true })
      return list(l.map(s => row({ dot: s.code >= 200 && s.code < 400 ? 'var(--green)' : s.code ? 'var(--orange)' : 'var(--gray)', t: svcName(d, side, s), s: s.kind || '', r: `:${s.port}` })))
    },
  })
  svcWidget('laptop', 'Laptop', s => s.kind === 'web')
  svcWidget('server', 'Server', () => true)
  reg({
    id: 'tunnels', label: 'Tunnels', cat: 'Laptop & Server', icon: 'server', tint: 'var(--blue)', tab: 'server',
    sizes: ['s', 'm'], defaultSize: 's', sources: ['state'], blurb: 'Server ports tunnelled to this laptop.',
    render(d, size) {
      const t = d.state?.tunnels || []
      if (size === 's') return fig(t.length, `tunnelled port${t.length === 1 ? '' : 's'}`) + `<div class="hw-sub ell" data-fit>${t.filter(x => x.auto).length} automatic</div>`
      return t.length ? list(t.slice().sort((a, b) => a.local - b.local).map(x => row({ t: d.state?.names?.server?.[x.remote] || `Port ${x.remote}`, s: x.auto ? 'auto' : 'manual', r: `:${x.local}` }))) : fig('None', 'No tunnels open', { sm: true })
    },
  })
  reg({
    id: 'syncs', label: 'Mutagen syncs', labels: { s: 'Syncs' }, cat: 'Laptop & Server', icon: 'pulse', tint: 'var(--green)', tab: 'server',
    sizes: ['s', 'm', 'l'], defaultSize: 's', sources: ['state'], blurb: 'The two-way folder syncs between the laptop and the server.',
    render(d, size) {
      const l = d.state?.syncs?.list || [], ok = s => /watching/i.test(s.status || '')
      if (!l.length) return d.state?.syncs?.error ? unavailable('Sync status isn’t available.', 'server') : fig('None', 'No syncs set up', { sm: true })
      const live = l.filter(ok).length
      if (size === 's') return fig(`${live}<small>of ${l.length}</small>`, live === l.length ? 'all watching' : `${l.length - live} need attention`) + meter('Watching', `${Math.round(pct(live, l.length))}%`, pct(live, l.length), live === l.length ? '' : 'warn')
      return list(l.slice().sort((a, b) => ok(a) - ok(b)).map(s => row({ dot: ok(s) ? 'var(--green)' : 'var(--orange)', t: s.name, s: ok(s) ? '' : s.status, r: ok(s) ? 'watching' : '' })))
    },
  })
  const GAUGES = { cpu: ['CPU', 'pulse'], memory: ['Memory', 'chip'], disk: ['Disk', 'drive'] }
  for (const which of ['server', 'laptop']) for (const [metric, [mlabel, ico]] of Object.entries(GAUGES)) {
    const who = capital(which)
    reg({
      id: `${which}-${metric}`, label: `${who} ${mlabel.toLowerCase()}`, labels: { s: `${who} ${mlabel}` }, cat: 'Laptop & Server', icon: ico, tint: which === 'server' ? 'var(--green)' : 'var(--blue)', tab: which,
      sizes: ['s', 'm'], defaultSize: 's', sources: ['state'], blurb: `A live ${mlabel.toLowerCase()} gauge for the ${which}.`,
      render(d, size) {
        const m = healthOf(which, d)
        if (!m) return unavailable(which === 'server' ? 'Can’t reach the server right now.' : 'No laptop readings yet.', which)
        const p = metric === 'cpu' ? m.cpu : metric === 'memory' ? m.mem : m.disk
        const sub = metric === 'cpu' ? `${m.h.cores} cores${m.h.load ? ` · load ${m.h.load[0].toFixed(1)}` : ''}` : metric === 'memory' ? `${bytes(m.memUsed)} of ${bytes(m.h.memTotal)}` : `${bytes(m.h.diskFree)} free of ${bytes(m.h.diskTotal)}`
        const g = ring(p ?? 0, tone(p ?? 0), p == null ? '–' : `${Math.round(p)}%`, size === 's' ? 92 : 100, 10, 22)
        if (size === 's') return `<div class="hw-ringwrap" data-fit>${g}</div><div class="hw-sub c ell" data-fit>${esc(sub)}</div>`
        const rows = metric === 'cpu' ? [row({ t: 'Cores', r: m.h.cores }), m.h.load && row({ t: 'Load (1 / 5 / 15 min)', r: m.h.load.map(x => x.toFixed(1)).join(' · ') }), row({ t: 'Up for', r: until(m.h.uptime * 1000) })] : metric === 'memory' ? [row({ t: 'Used', r: bytes(m.memUsed) }), row({ t: 'Available', r: bytes(m.h.memAvailable) }), row({ t: 'Total', r: bytes(m.h.memTotal) }), m.h.swapTotal && row({ t: 'Swap used', r: bytes(m.h.swapTotal - m.h.swapFree) })] : [row({ t: 'Used', r: bytes(m.h.diskTotal - m.h.diskFree) }), row({ t: 'Free', r: bytes(m.h.diskFree) }), row({ t: 'Total', r: bytes(m.h.diskTotal) })]
        return `<div class="hw-donutwrap">${g}${list(rows.filter(Boolean))}</div>`
      },
    })
  }
  reg({
    id: 'tailnet', label: 'Tailnet devices', labels: { s: 'Tailnet' }, cat: 'Laptop & Server', icon: 'users', tint: 'var(--indigo)', tab: 'laptop',
    sizes: ['s', 'm'], defaultSize: 's', sources: ['state'], blurb: 'Devices on your Tailscale network and who is online.',
    render(d, size) {
      const t = d.state?.tailnet
      if (!t) return unavailable('Tailscale isn’t reporting.', 'laptop')
      const peers = t.peers || [], on = peers.filter(p => p.online).length
      if (size === 's') return fig(`${on}<small>of ${peers.length} online</small>`, esc(t.ip || '')) + `<div class="hw-sub ell" data-fit>${esc(String(t.dns || '').split('.')[0])}</div>`
      return list([row({ dot: 'var(--green)', t: String(t.dns || 'This laptop').split('.')[0], s: 'this laptop', r: esc(t.ip || '') }), ...peers.map(p => row({ dot: p.online ? 'var(--green)' : 'var(--gray)', t: p.name, s: p.os || '', r: p.online ? 'online' : 'offline' }))])
    },
  })

  /* --- Storage --- */
  window.registerHomeFamily({
    prefix: 'drive.', title: 'Drive ', source: 'drives', cat: 'Storage', icon: 'drive', tint: 'var(--gray)', tab: 'drives',
    items: d => driveList(d).map(x => ({ key: slug(x.name), label: `Drive ${x.name}` })),
    make: key => ({
      sizes: ['s', 'm'], defaultSize: 's', blurb: 'Free space on one drive.',
      render(d, size) {
        const x = driveList(d).find(e => slug(e.name) === key)
        if (!x) return fig('Not found', 'This drive isn’t connected', { sm: true })
        const p = pct(x.size - x.free, x.size)
        if (size === 's') return fig(bytes(x.free), `free of ${bytes(x.size)}`) + meter(driveName(x), `${Math.round(p)}%`, p, tone(p))
        return `<div class="hw-donutwrap">${ring(p, tone(p), `${Math.round(p)}%`, 92, 10, 20)}${list([row({ t: 'Free', r: bytes(x.free) }), row({ t: 'Used', r: bytes(x.size - x.free) }), row({ t: 'Size', r: bytes(x.size) }), row({ t: 'Label', r: esc(x.label || x.name) })])}</div>`
      },
    }),
  })
  const recentWidget = (id, label, srcId, folder) => reg({
    id, label, cat: 'Storage', icon: 'list', tint: 'var(--blue)', tab: 'drives', sizes: ['m', 'l'], defaultSize: 'm', sources: [srcId], blurb: `The newest items in your ${folder} folder.`,
    render(d) {
      const l = d[srcId] || []
      if (!l.length) return fig('Empty', `Nothing in ${folder}`, { sm: true })
      return list(l.map(e => row({ t: e.name, s: e.dir ? `folder${e.count != null ? ` · ${e.count}` : ''}` : bytes(e.size), r: e.mtime ? ago_(e.mtime) : '' })))
    },
  })
  recentWidget('recent-downloads', 'Recent downloads', 'downloads', 'Downloads')
  recentWidget('recent-desktop', 'Recent on Desktop', 'desktop', 'Desktop')

  /* --- Calendar --- */
  const nextEvents = d => { const now = Date.now(); return eventsOf(d).filter(ev => ev.to > now || ev.from > now) }
  reg({
    id: 'event-countdown', label: 'Next event countdown', labels: { s: 'Countdown' }, cat: 'Calendar', icon: 'clock', tint: 'var(--red)', tab: 'calendar',
    sizes: ['s'], defaultSize: 's', sources: ['calendar'], blurb: 'How long until your next calendar event starts.',
    render(d) {
      const g = calGate(d)
      if (g) return g
      const now = Date.now(), ev = nextEvents(d).find(e => !e.allDay && e.from > now)
      if (!ev) return fig('None', 'No timed events in 7 days', { sm: true })
      return fig(until(ev.from - now), 'until it starts') + `<div class="hw-evt" data-fit><div class="t" style="font-size:15px">${esc(ev.title || 'Untitled')}</div></div><div class="hw-sub ell" data-fit>${esc(dayName(ev.from))} ${esc(fmtTime(ev.from))}</div>`
    },
  })
  reg({
    id: 'tomorrow', label: 'Tomorrow', cat: 'Calendar', icon: 'calendar', tint: 'var(--red)', tab: 'calendar',
    sizes: ['m', 'l'], defaultSize: 'm', sources: ['calendar'], blurb: 'Tomorrow’s agenda.',
    render(d) {
      const g = calGate(d)
      if (g) return g
      const a = addDays(startOfDay(new Date()), 1), b = addDays(a, 1), evs = eventsOf(d).filter(ev => overlaps(ev, a, b))
      if (!evs.length) return fig('Clear', 'Nothing tomorrow', { sm: true })
      return fig(`${evs.length}<small>${evs.length === 1 ? 'event' : 'events'} tomorrow</small>`, '', { sm: true }) + list(evs.map(evRow))
    },
  })
  reg({
    id: 'month', label: 'Month', cat: 'Calendar', icon: 'calendar', tint: 'var(--red)', tab: 'calendar',
    sizes: ['l'], defaultSize: 'l', sources: ['calendar-month'], blurb: 'A month grid with a dot on days that have events.',
    render(d) {
      const cal = d['calendar-month']
      if (cal && cal.connected === false) return unavailable('Connect a calendar to see your month.', 'calendar', 'calendar-feed')
      const now = new Date(), first = new Date(now.getFullYear(), now.getMonth(), 1), lead = first.getDay(), dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      const evs = eventsOf({ calendar: cal })
      const cells = []
      for (let i = 0; i < 42; i++) {
        const dd = new Date(first.getFullYear(), first.getMonth(), 1 - lead + i)
        if (i >= 35 && dd.getMonth() !== first.getMonth()) break
        const inMonth = dd.getMonth() === first.getMonth(), a = startOfDay(dd), b = addDays(a, 1), has = evs.some(ev => overlaps(ev, a, b))
        cells.push(`<div class="dn${inMonth ? '' : ' off'}${dayKey(dd) === dayKey(now) ? ' td' : ''}"><b>${dd.getDate()}</b>${has ? '<i></i>' : ''}</div>`)
      }
      const month = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), n = evs.filter(ev => ev.from >= startOfDay(now) && ev.from.getMonth() === now.getMonth()).length
      return `<div data-fit><div class="hw-mhead">${esc(month)}<span>${n} upcoming</span></div><div class="hw-month">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => `<div class="wd">${x}</div>`).join('')}${cells.join('')}</div></div>`
    },
    detail(d) {
      const cal = d['calendar-month'], evs = eventsOf({ calendar: cal }).slice(0, 40)
      if (!evs.length) return empty('Nothing on the calendar in the next two months.')
      const days = new Map()
      for (const ev of evs) { const k = dayKey(ev.from); (days.get(k) || days.set(k, []).get(k)).push(ev) }
      return [...days.values()].map(g => dsec(dayName(g[0].from), dlist(g.map(ev => row({ t: ev.title || 'Untitled', s: `${ev.allDay ? 'All day' : fmtTime(ev.from)}${ev.location ? ` · ${ev.location}` : ''}` }))))).join('')
    },
  })

  /* --- Stripe --- */
  reg({
    id: 'mrr', label: 'MRR', cat: 'Stripe', icon: 'trend', tint: 'var(--green)', tab: 'stripe',
    sizes: ['s', 'm'], defaultSize: 's', sources: ['stripe'], blurb: 'Monthly recurring revenue and active subscriptions.', connect: 'Connect Stripe to see MRR.',
    render(d, size) {
      const g = stripeGate(d)
      if (g) return g
      const acc = stripeLive(d), [cur, mrr] = primaryCur(sumBy(acc, a => a.mrr)), subs = acc.reduce((s, a) => s + (Number(a.activeSubs) || 0), 0), cust = acc.reduce((s, a) => s + (Number(a.customers) || 0), 0)
      const f = fig(money(mrr, cur, mrr >= 1e7), `${subs} active subscription${subs === 1 ? '' : 's'}`)
      return size === 's' ? f : f + `<div class="hw-split2" data-fit>${fig(subs, 'subscribers', { sm: true })}${fig(cust || '–', 'customers', { sm: true })}</div>`
    },
  })
  reg({
    id: 'customers', label: 'Stripe customers', labels: { s: 'Customers' }, cat: 'Stripe', icon: 'users', tint: 'var(--indigo)', tab: 'stripe',
    sizes: ['s'], defaultSize: 's', sources: ['stripe'], blurb: 'How many customers your Stripe account has.', connect: 'Connect Stripe to see customers.',
    render(d) {
      const g = stripeGate(d)
      if (g) return g
      const acc = stripeLive(d), n = acc.reduce((s, a) => s + (Number(a.customers) || 0), 0), subs = acc.reduce((s, a) => s + (Number(a.activeSubs) || 0), 0)
      return fig(compact(n), 'customers') + `<div class="hw-sub ell" data-fit>${subs} on a subscription</div>`
    },
  })
  const payoutsOf = d => stripeLive(d).flatMap(a => (a.payouts || []).map(p => ({ ...p, at: toDate(p.arrival) }))).sort((a, b) => (b.at || 0) - (a.at || 0))
  reg({
    id: 'payouts', label: 'Payouts', cat: 'Stripe', icon: 'card', tint: 'var(--green)', tab: 'stripe',
    sizes: ['m', 'l'], defaultSize: 'm', sources: ['stripe'], blurb: 'Money Stripe is sending to your bank, and when it lands.', connect: 'Connect Stripe to see payouts.',
    render(d) {
      const g = stripeGate(d)
      if (g) return g
      const l = payoutsOf(d)
      if (!l.length) return fig('None yet', 'No payouts to show', { sm: true })
      return list(l.map(p => row({ dot: p.status === 'paid' ? 'var(--green)' : /fail|cancel/i.test(p.status) ? 'var(--red)' : 'var(--orange)', t: p.at ? fmtDay(p.at) : 'Payout', s: capital(p.status), r: money(p.amount, p.currency) })))
    },
  })
  const invoicesOf = d => stripeLive(d).flatMap(a => (a.openInvoices || []).map(i => ({ ...i, at: i.due ? toDate(i.due) : null }))).sort((a, b) => (a.at || 9e15) - (b.at || 9e15))
  reg({
    id: 'invoices', label: 'Open invoices', cat: 'Stripe', icon: 'card', tint: 'var(--orange)', tab: 'stripe',
    sizes: ['s', 'm', 'l'], defaultSize: 'm', sources: ['stripe'], blurb: 'Invoices waiting to be paid, soonest due first.', connect: 'Connect Stripe to see invoices.',
    render(d, size) {
      const g = stripeGate(d)
      if (g) return g
      const l = invoicesOf(d), [cur, due] = primaryCur(sumBy(stripeLive(d), a => (a.openInvoices || []).map(i => ({ amount: i.amount_due, currency: i.currency }))))
      if (!l.length) return fig('None open', 'Nothing waiting to be paid', { sm: true })
      const f = fig(money(due, cur, due >= 1e7), `${l.length} open invoice${l.length === 1 ? '' : 's'}`, { sm: size !== 's' })
      if (size === 's') return f
      const late = x => x.at && x.at < Date.now()
      return f + list(l.map(i => row({ dot: late(i) ? 'var(--red)' : 'var(--orange)', t: i.customer || i.number || 'Invoice', s: i.at ? `${late(i) ? 'overdue ' : 'due '}${fmtDay(i.at)}` : 'no due date', r: money(i.amount_due, i.currency) })))
    },
  })

  /* --- Utility --- */
  reg({
    id: 'date', label: 'Date', cat: 'Utility', icon: 'calendar', tint: 'var(--red)', tab: 'calendar',
    sizes: ['s'], defaultSize: 's', sources: [], blurb: 'Today’s date, big.',
    render() {
      const n = new Date()
      return `<div class="hw-bigdate" data-fit><div class="w">${esc(n.toLocaleDateString(undefined, { weekday: 'long' }))}</div><div class="n">${n.getDate()}</div><div class="m">${esc(n.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</div></div>`
    },
  })
  const ZONES = window.HUB_CONF?.worldClock?.length ? window.HUB_CONF.worldClock : [['New York', 'America/New_York'], ['London', 'Europe/London'], ['UTC', 'UTC']]
  const zoneTime = tz => { try { return new Date().toLocaleTimeString(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }) } catch { return '–' } }
  reg({
    id: 'world-clock', label: 'World clock', cat: 'Utility', icon: 'clock', tint: 'var(--orange)', tab: 'calendar',
    sizes: ['s', 'm'], defaultSize: 's', sources: [], blurb: 'Your world clocks side by side.',
    render(d, size) {
      const zs = size === 's' ? ZONES.slice(0, 2) : ZONES
      return `<div class="hw-list" data-fit-list>${zs.map(([n, tz]) => `<div class="hw-row hw-wc" style="font-size:${size === 's' ? 15 : 17}px"><span class="t ell">${esc(n)}</span><span class="r" style="font-size:${size === 's' ? 17 : 19}px" data-hw-tz="${esc(tz)}">${esc(zoneTime(tz))}</span></div>`).join('')}</div>`
    },
  })
  const LINKS = [['laptop', 'Laptop', 'laptop'], ['server', 'Server', 'server'], ['drives', 'Drives', 'drive'], ['ai', 'AI', 'gauge'], ['cloud', 'Cloud', 'cloud'], ['calendar', 'Calendar', 'calendar'], ['stripe', 'Stripe', 'card']]
  reg({
    id: 'quick-links', label: 'Quick links', cat: 'Utility', icon: 'grid', tint: 'var(--blue)', tab: null,
    sizes: ['m', 'l'], defaultSize: 'm', sources: [], blurb: 'One tap to any tab in the hub.',
    render() { return `<div class="hw-links" data-fit-list>${LINKS.filter(([t]) => !tabOff(t)).map(([t, n, ic]) => `<button type="button" class="hw-link" data-hw-open="${t}">${icon(ic, 16)}<span class="ell">${t === 'drives' ? TAB_NAMES.drives : n}</span></button>`).join('')}</div>` },
  })
  reg({
    id: 'hub-status', label: 'Hub status', cat: 'Utility', icon: 'pulse', tint: 'var(--green)', tab: 'laptop',
    sizes: ['s', 'm'], defaultSize: 's', sources: ['state'], also: ['ai', 'cloud', 'drives'], blurb: 'Whether every part of the hub is reporting.',
    render(d, size) {
      const st = d.state || {}
      const checks = [['Laptop', st.laptop && !st.laptop.error, 'laptop'], ['Server', st.server && !st.server.error, 'server'], ['Syncs', st.syncs && !st.syncs.error, 'laptop']].filter(c => !tabOff(c[2])).concat(['ai', 'cloud', 'drives'].filter(id => !addonOff(id)).map(id => [TAB_NAMES[id], srcStatus(id) === 'ok' ? true : srcStatus(id) === 'loading' ? null : false]))
      const bad = checks.filter(c => c[1] === false).length
      if (size === 's') return fig(bad ? `${bad}<small>need${bad === 1 ? 's' : ''} a look</small>` : 'All good', `${checks.length - bad} of ${checks.length} reporting`) + `<div class="hw-sub ell" data-fit>${st.laptop?.at ? `Updated ${esc(ago_(st.laptop.at))}` : ''}</div>`
      return list(checks.map(([n, ok]) => row({ dot: ok === true ? 'var(--green)' : ok === false ? 'var(--red)' : 'var(--gray)', t: n, r: ok === true ? 'OK' : ok === false ? 'Not answering' : 'Checking' })))
    },
  })

  // These widgets are bigger than before: the layout gets their sizes without more code.
  Object.assign(window.HOME_WIDGETS.find(w => w.id === 'icloud'), { sizes: ['s', 'm', 'l'] })

  /* ---------- detail view (popup on desktop, slide-up sheet on a phone) ---------- */

  let lastFocus = null
  const sheetOf = el => el.querySelector('.hw-sheet')

  function showOverlay(el, extra) {
    closeOverlay(true)
    lastFocus = document.activeElement
    document.body.append(el)
    S.overlay = { el, ...extra }
    document.documentElement.style.overflow = 'hidden'
    void el.offsetWidth
    el.classList.add('on')
    // Focus lands on the sheet itself, so nothing lights up until the keyboard is used.
    const sh = sheetOf(el)
    sh?.setAttribute('tabindex', '-1')
    setTimeout(() => (sh || el.querySelector('.hw-x, .hw-done'))?.focus({ preventScroll: true }), REDUCED.matches ? 0 : 30)
    wireSheetDrag(el)
  }
  function closeOverlay(immediate) {
    const o = S.overlay
    if (!o) return
    S.overlay = null
    S.gallery = null
    S.detail = null
    try { o.onClose?.() } catch (e) { console.error(e) }
    o.el.classList.remove('on')
    document.documentElement.style.overflow = ''
    const sh = sheetOf(o.el)
    if (sh) sh.style.transition = ''
    if (immediate || REDUCED.matches) o.el.remove()
    else setTimeout(() => o.el.remove(), 260)
    if (lastFocus?.isConnected) try { lastFocus.focus({ preventScroll: true }) } catch {}
  }

  // Drag the sheet down to close (phone width): from the grabber and header, or from the body when it is scrolled to the top.
  function wireSheetDrag(el) {
    const sheet = sheetOf(el), top = el.querySelector('.hw-sh-top'), body = el.querySelector('.hw-sh-body')
    if (!sheet || !top || !body) return
    let drag = null
    const move = dy => { dy = Math.max(0, dy); sheet.style.transform = `translateY(${dy}px)`; el.style.background = `rgba(0,0,0,${(0.34 * Math.max(0, 1 - dy / Math.max(1, sheet.offsetHeight))).toFixed(3)})`; return dy }
    const end = () => {
      if (!drag) return
      const dt = Math.max(1, performance.now() - drag.t), far = drag.dy > 110 || drag.dy / dt > 0.6
      drag = null
      sheet.style.transition = ''
      el.style.background = ''
      if (far) closeOverlay()
      else sheet.style.transform = ''
    }
    top.addEventListener('pointerdown', e => {
      if (!PHONE.matches || e.target.closest('button')) return
      drag = { y: e.clientY, dy: 0, t: performance.now() }
      try { top.setPointerCapture(e.pointerId) } catch {}
      sheet.style.transition = 'none'
    })
    top.addEventListener('pointermove', e => { if (drag) drag.dy = move(e.clientY - drag.y) })
    top.addEventListener('pointerup', end)
    top.addEventListener('pointercancel', end)
    body.addEventListener('touchstart', e => { drag = PHONE.matches && body.scrollTop <= 0 && !e.target.closest('.hc-grip') ? { y: e.touches[0].clientY, dy: 0, t: performance.now(), body: true, on: false } : null }, { passive: true })
    body.addEventListener('touchmove', e => {
      if (!drag?.body) return
      const dy = e.touches[0].clientY - drag.y
      if (dy > 6 && body.scrollTop <= 0) { if (!drag.on) { drag.on = true; sheet.style.transition = 'none' } e.preventDefault(); drag.dy = move(dy) }
      else if (!drag.on) drag = null
    }, { passive: false })
    body.addEventListener('touchend', () => (drag?.on ? end() : (drag = null)))
    body.addEventListener('touchcancel', () => (drag?.on ? end() : (drag = null)))
  }

  function detailBody(w, size) {
    const st = stateBody(w)
    if (st) return st
    try {
      if (w.detail) return w.detail(dataFor(w), H, size) || ''
      return `<div class="hw-card" style="box-shadow:none;height:auto;--t:${w.tint || 'var(--blue)'}"><div class="hw-body hw-inline">${w.render(dataFor(w), w.sizes[w.sizes.length - 1], H)}</div></div>`
    } catch (e) { console.error('home detail', w.id, e); return empty('Couldn’t show this.') }
  }

  function openDetail(key) {
    const vk = viewKey(), it = findItem(vk, key)?.it, wm = widgetMap(), w = it && wm.get(it.id)
    if (!w) return
    const size = sizeOf(it, w)
    const el = document.createElement('div')
    el.className = 'scrim hw-scrim'
    const foot = `${w.tab ? `<button type="button" class="hw-btn solid" data-hw-open="${esc(w.tab)}">Open ${esc(tabName(w.tab))}</button>` : ''}<button type="button" class="hw-btn tint" data-hw-refresh>Refresh</button>`
    el.innerHTML = `<div class="hw-sheet" role="dialog" aria-modal="true" aria-label="${esc(w.label)}"><div class="hw-sh-top"><div class="hw-grab"></div><div class="hw-sh-head"><span class="hw-tile" style="--t:${w.tint || 'var(--blue)'}">${icon(w.icon, 16)}</span><h2>${esc(w.label)}</h2><button type="button" class="hw-x" data-hw-close aria-label="Close">${icon('close', 16)}</button></div></div><div class="hw-sh-body"></div><div class="hw-sh-foot">${foot}</div></div>`
    const body = el.querySelector('.hw-sh-body')
    const fill = () => { const y = body.scrollTop; body.innerHTML = detailBody(w, size); body.scrollTop = y }
    fill()
    showOverlay(el)
    S.detail = { refresh: fill }
    loadSources(srcOf(w))
    el.addEventListener('click', async e => {
      if (e.target === el || e.target.closest('[data-hw-close]')) return closeOverlay()
      const op = e.target.closest('[data-hw-open]')
      if (op) { closeOverlay(); return setEnv(op.dataset.hwOpen) }
      const retry = e.target.closest('[data-hw-retry]')
      if (retry) { await loadSource(retry.dataset.hwRetry, true); return fill() }
      if (e.target.closest('[data-hw-refresh]')) { await loadSources(srcOf(w), true); fill() }
    })
  }

  /* ---------- add-widget gallery ---------- */

  const CAT_ORDER = ['AI', 'Cloud', 'Coolify Apps', 'Laptop & Server', 'Storage', 'Calendar', 'Stripe', 'Utility']
  function openGallery() {
    const vk = viewKey(), el = document.createElement('div'), chosen = new Map()
    el.className = 'scrim hw-scrim'
    el.innerHTML = `<div class="hw-sheet" role="dialog" aria-modal="true" aria-label="Add to Home"><div class="hw-sh-top"><div class="hw-grab"></div><div class="hw-sh-head"><h2>Add to Home</h2><button type="button" class="hw-done" data-hw-close>Done</button></div><div class="seg hw-seg hw-addseg" role="tablist" aria-label="Add to Home" style="--n:2;--i:0"><span class="seg-thumb"></span><button type="button" role="tab" data-hw-addtab="widgets" aria-pressed="true">Widgets</button><button type="button" role="tab" data-hw-addtab="apps" aria-pressed="false">Apps</button></div></div><div class="hw-gsearch">${icon('search', 15)}<input type="search" placeholder="Search widgets" aria-label="Search widgets" autocomplete="off" enterkeyhint="search"></div><div class="hw-sh-body"></div></div>`
    const body = el.querySelector('.hw-sh-body'), input = el.querySelector('input')
    // One preview per widget, centred on its stage; the size picker swaps it, as on an iPhone. The scale is fixed, so sizes compare truthfully.
    const sizeOfItem = w => chosen.get(w.id) || w.defaultSize || w.sizes[0]
    const scale = () => Math.min(0.8, Math.max(120, sheetOf(el).clientWidth - 64) / DIMS[vk].m[0]).toFixed(3)
    const preview = (w, size) => { const [pw, ph] = DIMS[vk][size]; return `<div class="hw-prev" style="--pw:${pw}px;--ph:${ph}px;--k:${scale()}">${cardHtml(w, size, vk, bodyFor(w, size), false)}</div>` }
    const item = w => {
      const size = sizeOfItem(w), seg = w.sizes.length < 2 ? '' : `<div class="seg hw-seg hw-gsize" role="group" aria-label="${esc(w.label)} size" style="--n:${w.sizes.length};--i:${w.sizes.indexOf(size)}"><span class="seg-thumb"></span>${w.sizes.map(sz => `<button type="button" data-hw-gsize="${sz}" aria-pressed="${sz === size}">${SIZE_NAME[sz]}</button>`).join('')}</div>`
      return `<div class="hw-gitem" data-hw-wid="${esc(w.id)}" data-hay="${esc(`${w.label} ${w.blurb || ''} ${w.cat || 'Other'} ${w.id}`.toLowerCase())}"><div class="hw-ghead"><b>${esc(w.label)}</b>${w.blurb ? `<span>${esc(w.blurb)}</span>` : ''}</div><div class="hw-gstage" style="--ph:${DIMS[vk][size][1]}px;--k:${scale()}">${preview(w, size)}</div><div class="hw-gfoot">${seg}<button type="button" class="hw-btn solid" data-hw-add="${esc(w.id)}">${icon('plus', 14)}Add</button></div></div>`
    }
    const build = () => {
      const all = [...widgetMap(true).values()]
      const cats = [...new Set(all.map(w => w.cat || 'Other'))].sort((a, b) => (CAT_ORDER.indexOf(a) + 1 || 99) - (CAT_ORDER.indexOf(b) + 1 || 99))
      return cats.map(cat => {
        const items = all.filter(w => (w.cat || 'Other') === cat)
        return `<section class="hw-gsec" data-cat="${esc(cat)}"><h3>${esc(cat)}</h3>${items.map(item).join('')}</section>`
      }).join('') + '<div class="hw-gnone" hidden>No widgets match that.</div>'
    }
    const filter = () => {
      const q = input.value.trim().toLowerCase(), terms = q.split(/\s+/).filter(Boolean)
      let shown = 0
      body.querySelectorAll('.hw-gsec').forEach(sec => {
        let n = 0
        sec.querySelectorAll('.hw-gitem').forEach(it => { const ok = terms.every(t => new RegExp(`(^|[^a-z0-9])${t.replace(/[^a-z0-9]/g, '\\$&')}`).test(it.dataset.hay)); it.style.display = ok ? '' : 'none'; if (ok) n++ })
        sec.style.display = n ? '' : 'none'
        shown += n
      })
      const none = body.querySelector('.hw-gnone')
      if (none) none.hidden = shown > 0
      fitAll(body)
    }
    const fill = () => { const y = body.scrollTop; body.innerHTML = build(); filter(); body.scrollTop = y }
    let timer = 0, last = 0
    const refresh = () => { clearTimeout(timer); const wait = Math.max(0, 900 - (Date.now() - last)); timer = setTimeout(() => { if (S.overlay?.el === el) { last = Date.now(); fill() } }, wait) }
    showOverlay(el)
    last = Date.now()
    fill()
    S.gallery = { refresh }
    input.addEventListener('input', filter)
    loadSources([...widgetMap(true).values()].flatMap(srcOf))
    el.addEventListener('click', e => {
      if (e.target === el || e.target.closest('[data-hw-close]')) return closeOverlay()
      if (e.target.closest('[data-hw-addtab="apps"]')) return switchAdd(openAppPicker)
      const pick = e.target.closest('[data-hw-gsize]')
      if (pick) {
        const it = pick.closest('.hw-gitem'), w = widgetMap(true).get(it.dataset.hwWid), size = pick.dataset.hwGsize, seg = pick.closest('.seg'), stage = it.querySelector('.hw-gstage')
        if (!w) return
        chosen.set(w.id, size)
        seg.style.setProperty('--i', w.sizes.indexOf(size))
        seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === pick)))
        stage.style.setProperty('--ph', `${DIMS[vk][size][1]}px`)
        stage.innerHTML = preview(w, size)
        return fitAll(stage)
      }
      const add = e.target.closest('[data-hw-add]')
      if (!add) return
      const w = widgetMap(true).get(add.dataset.hwAdd)
      if (!w) return
      addWidget(w.id, sizeOfItem(w))
      add.innerHTML = `${icon('check', 14)}Added`
      setTimeout(() => { if (add.isConnected) add.innerHTML = `${icon('plus', 14)}Add` }, 1400)
    })
  }

  // The Add sheet has two tabs, Widgets and Apps; switching replaces the sheet without the close animation.
  function switchAdd(open) {
    closeOverlay(true)
    open()
  }

  function addWidget(id, size) {
    const vk = viewKey(), w = widgetMap().get(id)
    if (!w || !S.layout) return
    const it = { key: uid(), id, size: w.sizes.includes(size) ? size : w.defaultSize }
    if (layoutItems(vk).filter(i => !isAppItem(i)).length >= 60) return hud('That layout is full')
    // It lands on the page on screen; if there's no room there, the next page takes it.
    const after = S.sheets[at() + 1]?.[0]?.dataset.hwKey, l = S.layout[vk], before = after ? l.findIndex(x => (isAppItem(x) ? appItem(x.app).key : x.key) === after) : -1
    if (at() >= S.sheets.length) it.br = true
    if (before >= 0) l.splice(before, 0, it)
    else l.push(it)
    if (it.br) S.extra = 0
    saveSoon(vk)
    loadSources(srcOf(w))
    paint(true)
    hud(`${w.label} added`)
    pagerShow(it.key)
  }

  /* ---------- editing: size, remove, reorder by dragging ---------- */

  // An item leaving the list leaves the page it started as it was: the next item starts it now.
  function passBreak(l, it) {
    if (!it?.br) return
    const next = l[l.indexOf(it) + 1]
    if (next) next.br = true
    delete it.br
  }
  // Sizes a top-level item can take, and the one it shows now.
  function sizesOf(it, wm) {
    if (isStack(it)) return [stackSizes(it, wm), it.size]
    const w = wm.get(it.id)
    return w ? [w.sizes, sizeOf(it, w)] : [[], it.size]
  }
  function cycleSize(key) {
    const vk = viewKey(), it = layoutItems(vk).find(i => i.key === key)
    if (!it) return
    const [sizes, now] = sizesOf(it, widgetMap())
    if (sizes.length < 2) return
    resize(it, sizes[(sizes.indexOf(now) + 1) % sizes.length])
    saveSoon(vk)
    paint(true)
  }
  // Take one widget out of its stack; a stack left with one widget becomes that widget.
  function removeFromStack(key) {
    const vk = viewKey(), f = findItem(vk, key)
    if (!f?.parent) return
    const st = f.parent, l = layoutItems(vk)
    st.stack = st.stack.filter(x => x !== f.it)
    if (st.stack.length < 2) { if (st.br) st.stack[0].br = true; l.splice(l.indexOf(st), 1, ...st.stack) }
    saveSoon(vk)
    paint(true)
  }
  function unstack(key) {
    const vk = viewKey(), l = layoutItems(vk), i = l.findIndex(x => x.key === key)
    if (i < 0 || !isStack(l[i])) return
    l.splice(i, 1, ...l[i].stack.map((x, n) => ({ ...x, size: l[i].size, ...(n === 0 && l[i].br ? { br: true } : {}) })))
    saveSoon(vk)
    paint(true)
  }
  // Drop widget a onto b: b becomes a stack (or b's stack grows) with a on top.
  function stackOnto(aKey, bKey) {
    const vk = viewKey(), l = layoutItems(vk), a = l.find(i => i.key === aKey), b = l.find(i => i.key === bKey), wm = widgetMap()
    if (!a || !b || a === b || isStack(a)) return
    if (isStack(b) && b.stack.length >= 8) return hud('A stack holds up to 8 widgets')
    const size = isStack(b) ? b.size : sizesOf(b, wm)[1]
    const top = { key: a.key, id: a.id, size, ...(a.opts ? { opts: a.opts } : {}) }
    passBreak(l, a)
    l.splice(l.indexOf(a), 1)
    let st = b
    if (isStack(b)) b.stack.unshift(top)
    else {
      const { br, ...rest } = b
      l.splice(l.indexOf(b), 1, (st = { key: uid(), id: 'stack', size, ...(br ? { br: true } : {}), stack: [top, { ...rest, size }] }))
    }
    ;(S.skPage ||= {})[st.key] = 0
    saveSoon(vk)
    paint(true)
  }
  function canStack(cell, target) {
    if (cell.classList.contains('a') || target.classList.contains('a')) return false
    const l = layoutItems(viewKey()), a = l.find(i => i.key === cell.dataset.hwKey), b = l.find(i => i.key === target.dataset.hwKey), wm = widgetMap()
    if (!a || !b || isStack(a) || !wm.get(a.id)) return false
    if (isStack(b)) return b.stack.length < 8 && sizesOf(a, wm)[1] === b.size
    return !!wm.get(b.id) && sizesOf(a, wm)[1] === sizesOf(b, wm)[1]
  }
  function removeItem(key) {
    const vk = viewKey(), list_ = layoutItems(vk), i = list_.findIndex(x => x.key === key)
    if (i < 0) return removeFromStack(key)
    const cell = S.root.querySelector(`[data-hw-key="${CSS.escape(key)}"]`)
    const done = () => { passBreak(list_, list_[list_.findIndex(x => x.key === key)]); list_.splice(list_.findIndex(x => x.key === key), 1); saveSoon(vk); paint(true) }
    if (cell?.animate && !REDUCED.matches) cell.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.82)' }], { duration: 170, easing: EASE }).finished.then(done, done)
    else done()
  }
  function syncLayoutFromDom() {
    const vk = viewKey(), grid = S.root.querySelector('[data-hw-grid]'), cur = homeItems(vk)
    const order = [...grid.querySelectorAll('.hw-cell')].map(c => {
      const it = cur.find(i => i.key === c.dataset.hwKey)
      if (it) { if (c.hwBr) it.br = true; else delete it.br }
      return it
    }).filter(Boolean)
    if (order.length === cur.length) S.layout[vk] = order
    S.sig = ''
    paintSigFix()
  }
  // After a drag the DOM already shows the new order; record it so the next paint keeps the cells.
  function paintSigFix() {
    const vk = viewKey(), items = homeItems(vk), wm = widgetMap()
    S.sig = sigOf(vk, items, wm)
  }

  const inside = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  const near = (r, x, y, s) => x >= r.left - s && x <= r.right + s && y >= r.top - s && y <= r.bottom + s

  // What a drag needs from layout, read when it begins and after each swap. In between a move is
  // arithmetic and one style write, with no layout read. Rects are in page coordinates, so scrolling
  // only changes d.px and d.py. offsetLeft ignores transforms, so cells still sliding count where they land.
  function dragMeasure(d) {
    const v = (d.v = view()), c = d.cell, r = c.getBoundingClientRect(), w = r.width / v.k / d.scale, h = r.height / v.k / d.scale
    d.px = v.x()
    d.py = v.y()
    const left = ((r.left + r.right) / 2 - v.left) / v.k - w / 2 - d.tx + d.px, top = ((r.top + r.bottom) / 2 - v.top) / v.k - h / 2 - d.ty + d.py
    d.nat = { left, top, right: left + w, bottom: top + h }
    const ox = left - c.offsetLeft, oy = top - c.offsetTop
    d.rects = [...c.parentElement.querySelectorAll('.hw-cell')].filter(o => o !== c && o.offsetWidth).map(el => {
      const l = ox + el.offsetLeft, t = oy + el.offsetTop, o = { el, left: l, top: t, right: l + el.offsetWidth, bottom: t + el.offsetHeight }
      const icon = d.isApp && el.classList.contains('a') && el.querySelector('.hc-app')
      if (icon) {
        const a = icon.getBoundingClientRect(), b = el.getBoundingClientRect()
        o.ic = { left: l + (a.left - b.left) / v.k, right: l + (a.right - b.left) / v.k, top: t + (a.top - b.top) / v.k, bottom: t + (a.bottom - b.top) / v.k }
      }
      return o
    })
  }
  const vx = d => (d.x - d.v.left) / d.v.k, vy = d => (d.y - d.v.top) / d.v.k
  function dragPlace(d) {
    d.tx = vx(d) + d.px - d.ox - d.nat.left
    d.ty = vy(d) + d.py - d.oy - d.nat.top
    d.cell.style.transform = `translate(${d.tx.toFixed(1)}px, ${d.ty.toFixed(1)}px)${d.scale === 1 ? '' : ` scale(${d.scale})`}`
  }

  // Press and hold anything on Home to start editing with it in hand, as on an iPhone. Moving or scrolling
  // cancels the hold, and a short press still opens. The finger's own element keeps the page from scrolling,
  // because edit mode rebuilds the cells while the finger is still down.
  let hold = null
  const HOLD_MS = 450
  function holdCancel() {
    if (!hold) return
    clearTimeout(hold.t)
    hold = null
  }
  function holdStart(e) {
    if (S.editing || S.drag || S.overlay || hold || (e.pointerType === 'mouse' && e.button !== 0)) return
    const cell = e.target.closest('.hw-cell')
    if (!cell || e.target.closest('input, a[href]')) return
    hold = { x: e.clientX, y: e.clientY, pid: e.pointerId, touch: e.pointerType !== 'mouse', key: cell.dataset.hwKey, t: setTimeout(holdFire, HOLD_MS) }
    if (hold.touch) pinTouch(e.target)
  }
  function pinTouch(el) {
    const stop = ev => { if ((S.drag?.on || appDrag?.on) && ev.cancelable) ev.preventDefault() }
    const off = () => { el.removeEventListener('touchmove', stop); document.removeEventListener('pointerup', off); document.removeEventListener('pointercancel', off) }
    el.addEventListener('touchmove', stop, { passive: false })
    document.addEventListener('pointerup', off)
    document.addEventListener('pointercancel', off)
  }
  // Letting go opens nothing: the click that ends this press is not a tap.
  function eatReleaseClick() {
    const eat = c => { c.stopPropagation(); c.preventDefault() }
    document.addEventListener('pointerup', () => {
      document.addEventListener('click', eat, { capture: true, once: true })
      setTimeout(() => document.removeEventListener('click', eat, true), 60)
    }, { once: true, capture: true })
  }
  function holdFire() {
    const h = hold
    hold = null
    if (!h || S.editing) return
    toggleEdit()
    eatReleaseClick()
    const cell = h.key && S.root?.querySelector(`.hw-cell[data-hw-key="${CSS.escape(h.key)}"]`)
    if (!cell) return
    S.drag = { cell, pid: h.pid, sx: h.x, sy: h.y, x: h.x, y: h.y, on: false, touch: h.touch, raf: 0, swapAt: 0, t: 0, ox: 0, oy: 0 }
    dragBegin()
  }
  document.addEventListener('pointermove', e => { if (hold && e.pointerId === hold.pid && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) holdCancel() }, { passive: true })
  for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, holdCancel)
  window.addEventListener('scroll', holdCancel, { passive: true, capture: true })

  function dragStart(e) {
    if (!S.editing || S.drag || S.overlay) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const cell = e.target.closest('.hw-cell')
    if (!cell || e.target.closest('.hw-ctl')) return
    const d = (S.drag = { cell, pid: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, on: false, touch: e.pointerType !== 'mouse', raf: 0, swapAt: 0, t: 0, ox: 0, oy: 0 })
    if (d.touch) d.t = setTimeout(dragBegin, 230)
  }
  function dragBegin() {
    const d = S.drag
    if (!d || d.on) return
    clearTimeout(d.t)
    d.on = true
    d.cell.getAnimations?.().forEach(a => a.cancel())
    d.isApp = d.cell.classList.contains('a')
    d.scale = 1
    d.tx = d.ty = 0
    dragMeasure(d)
    d.slack = (parseFloat(getComputedStyle(d.cell.parentElement).columnGap) || 0) / 2 + 1
    d.ox = vx(d) + d.px - d.nat.left
    d.oy = vy(d) + d.py - d.nat.top
    d.order = [...d.cell.parentElement.querySelectorAll('.hw-cell')]
    d.was = [...d.order]
    // While a card is held every page stays a page: taking one off doesn't pull the next page's cards back.
    d.brWas = d.order.map(el => el.hwBr)
    if (!S.q) pinPages()
    d.cell.classList.add('hw-dragging')
    d.app = d.isApp ? d.cell.querySelector(':scope > .hw-app') : null
    d.app?.classList.add('drag')
    S.root.classList.add('hw-sorting')
    document.documentElement.classList.add('hw-drag-on')
    if (!d.isApp) d.scale = 1.03
    dragPlace(d)
    try { d.cell.setPointerCapture(d.pid) } catch {}
    try { dragging = true } catch {}
    navigator.vibrate?.(8)
    const loop = () => { d.raf = requestAnimationFrame(loop); dragFrame(d) }
    loop()
  }
  // Still closing in on a cell's middle isn't a swap yet, however slow the drag.
  const settling = (d, hit, x, y, now) => {
    const off = Math.hypot(x - (hit.left + hit.right) / 2, y - (hit.top + hit.bottom) / 2)
    if (off < (d.hover.off ?? Infinity) - 1.5) { d.hover.off = off; d.hover.at = now }
    return now - d.hover.at < 150
  }
  // Marks where each page starts now, so it stays that way when a card leaves or joins.
  const pinPages = () => !infinite() && S.sheets.forEach((sheet, n) => sheet.forEach((el, i) => { el.hwBr = n > 0 && i === 0 }))
  // Held at the side of the page for a moment, the card goes on to the next page, as on an iPhone.
  // It lands first on that page and the rest make room; past the last page there's a new one.
  function dragTurn(d, dir) {
    const c = d.cell, grid = c.parentElement, o = d.order, sheets = S.sheets, from = c.hwPage, to = at() + dir
    if (to < 0) return
    if (to >= pageCount()) {
      if (from === sheets.length - 1 && sheets[from].length === 1) return
      S.extra = 1
    }
    pinPages()
    const before = rectMap(grid), t = sheets[to]?.find(el => el !== c)
    if (c.hwBr) {
      const after = o[o.indexOf(c) + 1]
      if (after?.hwPage === from) after.hwBr = true
      c.hwBr = false
    }
    o.splice(o.indexOf(c), 1)
    if (t) { c.hwBr = t.hwBr; t.hwBr = false; o.splice(o.indexOf(t), 0, c) }
    else { c.hwBr = true; o.push(c); S.extra = 0 }
    d.moved = true
    d.last = null
    place(grid, o)
    playFlip(grid, before, c)
    pagerGo(c.hwPage)
    dragMeasure(d)
    dragPlace(d)
    navigator.vibrate?.(6)
  }
  const EDGE = 28, EDGE_MS = 420
  function dragFrame(d) {
    const py = vy(d), vxx = vx(d), now = performance.now(), g = S.geo
    const side = S.q || d.v.pg ? 0 : vxx < g.left + EDGE ? -1 : vxx > g.left + g.w - EDGE ? 1 : 0
    // In one long scroll, a card held near the top or bottom scrolls the grid under it.
    if (d.v.pg) {
      const r = d.v.pg.getBoundingClientRect(), v = d.y < r.top + 48 ? -1 : d.y > r.bottom - 48 ? 1 : 0
      if (v) { const was = d.v.pg.scrollTop; d.v.pg.scrollTop += v * 9; if (d.v.pg.scrollTop !== was) { d.py = d.v.y(); dragPlace(d) } }
    }
    if (side !== d.side) {
      d.side = side
      d.sideAt = now
      if (side) { setMerge(d, null); d.hover = null }
    }
    if (side && now - d.sideAt >= EDGE_MS) {
      d.sideAt = now + 600
      dragTurn(d, side)
    }
    if (side || turn) return
    const c = d.cell, x = vxx + d.px, y = py + d.py
    // Each cell owns half the gap beside it, so a pointer in a gap still means the nearest cell.
    const hit = inside(d.nat, x, y) ? null : d.rects.find(o => inside(o, x, y)) || (near(d.nat, x, y, d.slack) ? null : d.rects.find(o => near(o, x, y, d.slack))) || null
    const target = hit?.el || null
    if (target !== d.hover?.el) { setMerge(d, null); d.hover = target ? { el: target, at: now, mid: 0, stack: canStack(c, target) } : null }
    if (!target) return
    // An app held over the middle of another app's icon makes a group (or joins it); a group never goes inside another.
    const ic = d.app && !d.app.dataset.hwApp.startsWith('group-') && hit.ic
    if (ic) {
      if (inside({ left: ic.left + (ic.right - ic.left) * 0.18, right: ic.right - (ic.right - ic.left) * 0.18, top: ic.top + (ic.bottom - ic.top) * 0.18, bottom: ic.bottom - (ic.bottom - ic.top) * 0.18 }, x, y)) {
        d.hover.mid ||= now
        if (now - d.hover.mid >= 380) setMerge(d, target)
        return
      }
      d.hover.mid = 0
      setMerge(d, null)
      if (settling(d, hit, x, y, now)) return
    }
    // Held over the middle of a widget it can stack with, the card stacks on drop; near the edge it swaps.
    if (d.hover.stack) {
      const w = hit.right - hit.left, h = hit.bottom - hit.top
      if (inside({ left: hit.left + w / 4, right: hit.right - w / 4, top: hit.top + h / 4, bottom: hit.bottom - h / 4 }, x, y)) {
        d.hover.mid ||= now
        if (now - d.hover.mid >= 420) setMerge(d, target)
        return
      }
      d.hover.mid = 0
      setMerge(d, null)
      if (settling(d, hit, x, y, now)) return
    }
    if (now - d.swapAt < 170) return
    // After a swap the grid reflows under the finger; wait for real movement before swapping again.
    if (d.last && Math.hypot(d.x - d.last[0], d.y - d.last[1]) < 14) return
    d.hover = null
    const grid = c.parentElement, before = rectMap(grid), o = d.order
    const fi = o.indexOf(c), ti = o.indexOf(target)
    // A swap only re-places the cells; moving nodes would restyle and repaint every cell they pass. The document catches up on the drop.
    o.splice(fi, 1)
    o.splice(ti, 0, c)
    place(grid, o)
    d.moved = true
    d.swapAt = now
    d.last = [d.x, d.y]
    playFlip(grid, before, c)
    dragMeasure(d)
    dragPlace(d)
  }
  // Moves the cells around the card, never the card itself: it stays in the document so the drag keeps its pointer.
  function dragCommit(d) {
    const c = d.cell, grid = c.parentElement, o = d.order, at = o.indexOf(c), cur = [...grid.querySelectorAll('.hw-cell')]
    if (o.some((el, i) => el !== cur[i])) {
      o.slice(0, at).forEach(el => c.before(el))
      o.slice(at + 1).reduce((prev, el) => (prev.after(el), el), c)
    }
  }
  function setMerge(d, el) {
    if (d.app && !onMain()) el = null
    if (d.merge === el) return
    d.merge?.classList.remove('hw-merge')
    d.merge = el
    if (el) { el.classList.add('hw-merge'); navigator.vibrate?.(6) }
  }
  function dragEnd() {
    const d = S.drag
    if (!d) return
    clearTimeout(d.t)
    cancelAnimationFrame(d.raf)
    S.drag = null
    if (!d.on) return
    const c = d.cell, merge = d.merge
    setMerge(d, null)
    const k = d.v?.k || 1, cur = c.getBoundingClientRect()
    c.style.transform = 'none'
    const nat = c.getBoundingClientRect()
    const shift = (a, b) => `translate(${(a.left - b.left) / k}px, ${(a.top - b.top) / k}px)`
    c.classList.remove('hw-dragging')
    d.app?.classList.remove('drag')
    if (d.app) S.appDragged = Date.now()
    S.root.classList.remove('hw-sorting')
    document.documentElement.classList.remove('hw-drag-on')
    c.style.transform = ''
    try { dragging = false } catch {}
    try { c.releasePointerCapture(d.pid) } catch {}
    dragCommit(d)
    // After a real move the pages stay as they are now. Picked up and put back, or Escape, changes nothing.
    if (d.moved) pinPages()
    else d.was.forEach((el, i) => { el.hwBr = d.brWas[i] })
    syncLayoutFromDom()
    if (c.hwPage !== at()) pagerGo(c.hwPage)
    if (merge?.isConnected && d.app) {
      // The icon shrinks into the one it lands on, then the group takes that place.
      const t = merge.querySelector('.hc-app').getBoundingClientRect(), done = () => groupWith(d.app.dataset.hwApp, merge.querySelector('.hw-app').dataset.hwApp)
      saveSoon(viewKey())
      if (c.animate && !REDUCED.matches) c.animate([{ transform: shift(cur, nat), opacity: 1 }, { transform: `${shift(t, nat)} scale(.45)`, opacity: 0 }], { duration: 200, easing: EASE, fill: 'forwards' }).finished.then(done, done)
      else done()
    } else if (merge?.isConnected) {
      // The card shrinks into the widget it lands on, then the stack takes its place.
      const t = merge.getBoundingClientRect(), done = () => stackOnto(c.dataset.hwKey, merge.dataset.hwKey)
      if (c.animate && !REDUCED.matches) c.animate([{ transform: `${shift(cur, nat)} scale(1.03)`, opacity: 1 }, { transform: `${shift(t, nat)} scale(.8)`, opacity: 0 }], { duration: 200, easing: EASE, fill: 'forwards' }).finished.then(done, done)
      else done()
    } else {
      if (c.animate && !REDUCED.matches) c.animate([{ transform: `${shift(cur, nat)}${d.app ? '' : ' scale(1.03)'}` }, { transform: 'none' }], { duration: 240, easing: EASE })
      saveSoon(viewKey())
      saveAppOrder()
    }
    if (S.pending) { S.pending = false; scheduleRepaint() }
  }
  document.addEventListener('pointermove', e => {
    const d = S.drag
    if (!d || e.pointerId !== d.pid) return
    d.x = e.clientX
    d.y = e.clientY
    if (d.on) return dragPlace(d)
    const dist = Math.hypot(d.x - d.sx, d.y - d.sy)
    if (d.touch) { if (dist > 9) { clearTimeout(d.t); S.drag = null } }
    else if (dist > 4) dragBegin()
  })
  document.addEventListener('pointerup', e => { if (S.drag && e.pointerId === S.drag.pid) dragEnd() })
  document.addEventListener('pointercancel', e => { if (S.drag && e.pointerId === S.drag.pid) dragEnd() })
  // Once a touch drag has begun, the page must not scroll under the finger.
  document.addEventListener('touchmove', e => { if ((S.drag?.on || swipe?.on) && e.cancelable) e.preventDefault() }, { passive: false })

  /* ---------- turning pages: swipe, mouse drag, wheel, arrow keys ---------- */

  let swipe = null
  function swipeStart(e) {
    if (infinite() || S.overlay || swipe || S.drag?.on || appDrag || (e.pointerType === 'mouse' && e.button !== 0) || !e.isPrimary) return
    if (!e.target.closest('.hw-frame') || e.target.closest('.hw-ctl, input, textarea, select, [data-hw-pagebtn]')) return
    // With a mouse, a card in edit mode moves the card. A finger has a moment first, so a quick swipe still turns the page.
    if (S.editing && e.pointerType === 'mouse' && e.target.closest('.hw-cell')) return
    swipe = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, t: performance.now(), v: 0, on: false, base: 0, target: e.target }
  }
  function swipeMove(e) {
    const w = swipe
    if (!w || e.pointerId !== w.pid) return
    if (S.drag?.on) { swipe = null; return }
    const dx = e.clientX - w.sx, dy = e.clientY - w.sy, now = performance.now()
    if (!w.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return }
      if (Math.abs(dx) < 9 || Math.abs(dx) < Math.abs(dy) * 1.2) return
      w.on = true
      turn = null
      w.base = S.px
      w.sx = e.clientX
      holdCancel()
      eatReleaseClick()
      // A file shown in a widget would otherwise keep the pointer.
      document.documentElement.classList.add('hw-drag-on')
      try { S.root.setPointerCapture(w.pid) } catch {}
    }
    const moved = (e.clientX - w.sx) / S.frameK, last = S.geo.stride * (pageCount() - 1)
    let x = w.base - moved
    // Past the first or last page it follows less and less.
    if (x < 0) x /= 3
    else if (x > last) x = last + (x - last) / 3
    pagerSet(x)
    const dt = now - w.t
    if (dt > 0) w.v = ((e.clientX - w.x) / dt) * 0.7 + w.v * 0.3
    w.x = e.clientX
    w.t = now
  }
  function swipeEnd(e) {
    const w = swipe
    if (!w || e.pointerId !== w.pid) return
    swipe = null
    if (!w.on) return
    document.documentElement.classList.remove('hw-drag-on')
    try { S.root.releasePointerCapture(w.pid) } catch {}
    const moved = (w.x - w.sx) / S.frameK, cancelled = e.type === 'pointercancel', quick = performance.now() - w.t < 120 && Math.abs(w.v) > 0.35
    let i = at()
    if (!cancelled) {
      if (moved < 0 && (quick || -moved > S.geo.stride * 0.3)) i++
      else if (moved > 0 && (quick || moved > S.geo.stride * 0.3)) i--
    }
    pagerGo(i)
  }
  document.addEventListener('pointermove', swipeMove)
  document.addEventListener('pointerup', swipeEnd)
  document.addEventListener('pointercancel', swipeEnd)
  // Only a list that can really scroll keeps a wheel for itself.
  function wheelScroller(el, stop) {
    for (; el && el !== stop; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return el
    }
    return null
  }
  let wheel = { sum: 0, at: 0, quiet: 0 }
  function onWheel(e) {
    if (infinite() || S.overlay || S.drag?.on || swipe?.on || e.ctrlKey) return
    const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? innerHeight : 1, dx = e.deltaX * unit, dy = e.deltaY * unit, sideways = Math.abs(dx) >= Math.abs(dy)
    if (!sideways && wheelScroller(e.target, S.root)) return
    e.preventDefault()
    const now = performance.now()
    // One flick of a trackpad sends many events and keeps sending them as it coasts: one flick, one page.
    if (now < wheel.quiet) { if (now - wheel.at < 120) { wheel.at = now; return } wheel.quiet = 0 }
    if (now - wheel.at > 200) wheel.sum = 0
    wheel.at = now
    wheel.sum += sideways ? dx : dy
    if (Math.abs(wheel.sum) < 50) return
    pagerGo(at() + Math.sign(wheel.sum))
    wheel.sum = 0
    wheel.quiet = now + 1100
  }
  document.addEventListener('keydown', e => {
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || !showing() || !S.root?.isConnected) return
    if (e.defaultPrevented || S.overlay || S.drag?.on || appDrag || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || document.querySelector('.scrim, body > .menu, #hub-setup')) return
    if (e.composedPath()[0]?.closest?.('input, textarea, select, [contenteditable]')) return
    e.preventDefault()
    pagerGo(at() + (e.key === 'ArrowRight' ? 1 : -1))
  })

  /* ---------- apps: icons that open a tab (chosen with Add App or in edit mode, saved in hub settings) ---------- */

  const appList = () => S.apps || window.HUB?.apps() || []
  // Apps are cells of the Home grid; a change to them repaints the grid where it differs.
  function paintApps() {
    if (S.root?.isConnected && showing() && !S.drag?.on) paint(true)
  }
  // After a drag the apps keep the order they now have on Home.
  function saveAppOrder() {
    if (!onMain()) return
    const ids = homeItems(viewKey()).filter(isAppItem).map(i => i.app)
    if (ids.join() !== appList().join()) setApps(ids)
  }
  // Shown at once, then saved; the hub's answer replaces the local copy.
  function setApps(ids) {
    S.apps = ids
    paintApps()
    S.detail?.refresh()
    window.HUB?.save({ apps: ids }).then(() => { S.apps = null; paintApps() })
  }
  // On a page an app is only a place in its layouts.
  function pageApp(id, on) {
    for (const k of VIEWS) {
      const l = S.layout[k] || [], rest = l.filter(x => !(isAppItem(x) && x.app === id))
      S.layout[k] = on ? (rest.length === l.length ? [...l, appItem(id)] : l) : rest
      saveSoon(k)
    }
    paint(true)
    S.detail?.refresh()
  }
  const removeApp = id => { if (!onMain()) return pageApp(id, false); if (window.HUB?.groupOf?.(id)) return removeGroup(id); setApps(appList().filter(x => x !== id)); hud(`${window.HUB.appMeta(id).label} removed from Home`) }
  const addApp = id => { if (!onMain()) pageApp(id, true); else if (!appList().includes(id)) setApps([...appList(), id]); pagerShow(`app:${id}`) }
  function moveApp(id, by) {
    const vk = viewKey(), l = homeItems(vk), i = l.findIndex(x => isAppItem(x) && x.app === id), j = i + by
    if (i < 0 || j < 0 || j >= l.length) return
    passBreak(l, l[i])
    const [x] = l.splice(i, 1)
    l.splice(j, 0, x)
    S.layout[vk] = l
    saveSoon(vk)
    paint(true)
    saveAppOrder()
    pagerShow(`app:${id}`)
    requestAnimationFrame(() => S.root?.querySelector(`[data-hw-appopen="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }))
  }
  const openApp = id => window.HUB?.openApp(id)

  // Edit mode: an app picked up follows the pointer and the others slide out of its way.
  // On Home, holding it over the middle of another icon makes a group, or adds it to that group.
  let appDrag = null
  function appDown(e) {
    const el = e.target.closest('.hw-app:not(.add)')
    // Home icons move with the grid's drag; this one is for the icons inside an open folder.
    if (!S.editing || !el || !el.parentElement?.dataset.hwFgrid || e.target.closest('.hw-del') || (e.pointerType === 'mouse' && e.button !== 0)) return
    const d = (appDrag = { el, box: el.parentElement, folder: el.parentElement.dataset.hwFgrid || null, pid: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, on: false, touch: e.pointerType !== 'mouse', t: 0, raf: 0, hover: null, merge: null, swapAt: 0 })
    if (d.touch) d.t = setTimeout(appBegin, 230)
  }
  function appBegin() {
    const d = appDrag
    if (!d || d.on) return
    clearTimeout(d.t)
    d.on = true
    d.el.getAnimations?.().forEach(a => a.cancel())
    d.tx = d.ty = 0
    d.was = [...d.box.children]
    appMeasure(d)
    d.ox = d.x - d.nat.left
    d.oy = d.y - d.nat.top
    d.el.classList.add('drag')
    d.box.classList.add('hw-sorting')
    S.root?.classList.add('hw-sorting')
    document.documentElement.classList.add('hw-drag-on')
    navigator.vibrate?.(8)
    const loop = () => { d.raf = requestAnimationFrame(loop); appFrame(d) }
    loop()
  }
  function appMerge(d, el) {
    if (!onMain()) el = null
    if (d.merge === el) return
    d.merge?.classList.remove('merge')
    d.merge = el
    if (el) { el.classList.add('merge'); navigator.vibrate?.(6) }
  }
  // As for the Home grid: layout is read at the start, after a swap and after a scroll, never on a move.
  function appMeasure(d) {
    const el = d.el, r = el.getBoundingClientRect(), left = r.left - d.tx, top = r.top - d.ty
    d.nat = { left, top, right: left + r.width, bottom: top + r.height }
    const ox = left - el.offsetLeft, oy = top - el.offsetTop
    d.rects = [...d.box.children].filter(o => o !== el && o.classList.contains('hw-app') && !o.classList.contains('add')).map(o => {
      const l = ox + o.offsetLeft, t = oy + o.offsetTop
      return { el: o, left: l, top: t, right: l + o.offsetWidth, bottom: t + o.offsetHeight }
    })
  }
  function appPlace(d) {
    d.tx = d.x - d.ox - d.nat.left
    d.ty = d.y - d.oy - d.nat.top
    d.el.style.transform = `translate(${d.tx.toFixed(1)}px, ${d.ty.toFixed(1)}px)`
  }
  function appFrame(d) {
    if (!d.folder) {
      let dy = 0
      if (d.y < 90) dy = -Math.min(18, Math.ceil((90 - d.y) / 5))
      else if (d.y > innerHeight - 90) dy = Math.min(18, Math.ceil((d.y - (innerHeight - 90)) / 5))
      if (dy) scrollBy(0, dy)
    }
    const el = d.el
    const now = performance.now()
    const over = inside(d.nat, d.x, d.y) ? null : d.rects.find(o => inside(o, d.x, d.y))?.el || null
    if (over !== d.hover?.el) { appMerge(d, null); d.hover = over ? { el: over, at: now, mid: 0 } : null }
    if (!over) return
    // The middle of the icon (not its label) means "put these together"; a group never goes inside another.
    const canGroup = !d.folder && !el.dataset.hwApp.startsWith('group-')
    const ic = canGroup && over.querySelector('.hc-app')?.getBoundingClientRect()
    if (ic && inside({ left: ic.left + ic.width * 0.18, right: ic.right - ic.width * 0.18, top: ic.top + ic.height * 0.18, bottom: ic.bottom - ic.height * 0.18 }, d.x, d.y)) {
      d.hover.mid ||= now
      if (now - d.hover.mid >= 380) appMerge(d, over)
      return
    }
    d.hover.mid = 0
    appMerge(d, null)
    if (now - d.hover.at < (canGroup ? 140 : 60) || now - d.swapAt < 150) return
    const kids = [...d.box.children], before = new Map(kids.map(c => [c, c.getBoundingClientRect()]))
    if (kids.indexOf(over) > kids.indexOf(el)) over.after(el)
    else over.before(el)
    d.swapAt = now
    d.hover = null
    if (!REDUCED.matches) for (const c of d.box.children) {
      if (c === el) continue
      const a = before.get(c), b = c.getBoundingClientRect()
      if (a && (Math.abs(a.left - b.left) > 0.5 || Math.abs(a.top - b.top) > 0.5)) c.animate?.([{ transform: `translate(${a.left - b.left}px,${a.top - b.top}px)` }, { transform: 'none' }], { duration: 260, easing: EASE })
    }
    appMeasure(d)
    appPlace(d)
  }
  document.addEventListener('pointermove', e => {
    const d = appDrag
    if (!d || e.pointerId !== d.pid) return
    d.x = e.clientX
    d.y = e.clientY
    if (d.on) appPlace(d)
    else if (Math.hypot(d.x - d.sx, d.y - d.sy) > (d.touch ? 6 : 4)) appBegin()
  })
  // A scroll or resize is the one thing besides a swap that moves the cells under a drag.
  addEventListener('scroll', e => {
    const d = S.drag
    if (e.target === document && showing() && S.root?.isConnected && scrollY) scrollTo(0, 0)
    if (d?.on && (e.target === document || e.target === d.v.el || e.target === d.v.pg)) { d.px = d.v.x(); d.py = d.v.y(); dragPlace(d) }
    if (appDrag?.on) { appMeasure(appDrag); appPlace(appDrag) }
  }, { capture: true, passive: true })
  addEventListener('resize', () => {
    if (S.root?.isConnected) frameFit()
    if (S.drag?.on) { pagerFit(); pagerSet(at() * S.geo.stride); dragMeasure(S.drag); dragPlace(S.drag) }
    if (appDrag?.on) { appMeasure(appDrag); appPlace(appDrag) }
    if (!S.drag?.on && S.root?.isConnected) setCols(S.root.querySelector('[data-hw-grid]'))
  }, { passive: true })
  const appRelease = e => {
    const d = appDrag
    if (!d || e.pointerId !== d.pid) return
    appDrag = null
    clearTimeout(d.t)
    cancelAnimationFrame(d.raf)
    if (!d.on) return
    S.appDragged = Date.now()
    const el = d.el, merge = d.merge, id = el.dataset.hwApp
    appMerge(d, null)
    d.box.classList.remove('hw-sorting')
    S.root?.classList.remove('hw-sorting')
    document.documentElement.classList.remove('hw-drag-on')
    const cur = el.getBoundingClientRect()
    el.style.transform = ''
    const nat = el.getBoundingClientRect()
    el.classList.remove('drag')
    const anim = !REDUCED.matches && el.animate
    if (merge?.isConnected) {
      const t = merge.querySelector('.hc-app').getBoundingClientRect(), done = () => groupWith(id, merge.dataset.hwApp)
      if (anim) el.animate([{ transform: `translate(${cur.left - nat.left}px, ${cur.top - nat.top}px)`, opacity: 1 }, { transform: `translate(${t.left - nat.left}px, ${t.top - nat.top}px) scale(.45)`, opacity: 0 }], { duration: 200, easing: EASE, fill: 'forwards' }).finished.then(done, done)
      else done()
      return
    }
    if (anim) el.animate([{ transform: `translate(${cur.left - nat.left}px, ${cur.top - nat.top}px) scale(1.06)` }, { transform: 'none' }], { duration: 260, easing: EASE })
    const ids = [...d.box.children].filter(x => x.classList.contains('hw-app') && !x.classList.contains('add')).map(x => x.dataset.hwApp)
    if (d.folder) {
      const g = window.HUB.groupOf(d.folder)
      if (g && ids.join() !== g.apps.join()) groupPatch({ groups: { update: [{ id: d.folder, apps: ids }] } })
    } else if (onMain() && ids.join() !== appList().join()) setApps(ids)
  }
  document.addEventListener('pointerup', appRelease)
  document.addEventListener('pointercancel', appRelease)
  // Escape puts everything back and drops nothing, so letting go afterwards does nothing either.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || (!S.drag?.on && !appDrag?.on)) return
    e.preventDefault()
    e.stopImmediatePropagation()
    eatReleaseClick()
    if (S.drag?.on) {
      const d = S.drag, grid = d.cell.parentElement, before = rectMap(grid)
      setMerge(d, null)
      d.order = d.was
      d.moved = false
      d.was.forEach((el, i) => { el.hwBr = d.brWas[i] })
      place(grid, d.was)
      playFlip(grid, before, d.cell)
      dragEnd()
    } else {
      const d = appDrag
      appMerge(d, null)
      d.was.forEach(c => d.box.append(c))
      appRelease({ pointerId: d.pid })
    }
  }, true)

  /* ---------- groups: folders of apps on Home, saved in hub settings ---------- */

  // Saved first, then shown: the hub checks names and ids, and its answer repaints Home.
  async function groupPatch(body, done) {
    try { if (body) await window.HUB.patch(body); done?.() } catch (e) { hud(e.message || 'Couldn’t save that') }
    S.apps = null
    paintApps()
    S.detail?.refresh()
  }
  const groupName = ids => (ids.every(id => id.startsWith('site-')) ? 'Websites' : 'Apps')
  function newGroupId(name) {
    const base = `group-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'apps'}`, have = new Set(window.HUB.groups().map(g => g.id))
    let id = base, n = 2
    while (have.has(id)) id = `${base}-${n++}`
    return id
  }
  // App a dropped on b: b's group takes it, or the two become a new group where b was.
  function groupWith(a, b) {
    const HUB = window.HUB, groups = HUB.groups(), apps = appList(), tg = HUB.groupOf(b)
    if (tg) {
      if (tg.apps.length >= 24) { hud(`${tg.name} is full`); return groupPatch(null) }
      return groupPatch({ groups: groups.map(g => (g.id === b ? { ...g, apps: [...g.apps, a] } : g)), apps: apps.filter(x => x !== a) }, () => hud(`Added to ${tg.name}`))
    }
    if (groups.length >= 20) { hud('Home holds up to 20 groups'); return groupPatch(null) }
    const name = groupName([a, b]), id = newGroupId(name)
    return groupPatch({ groups: [...groups, { id, name, apps: [b, a] }], apps: apps.filter(x => x !== a).map(x => (x === b ? id : x)) }, () => openGroup(id, true))
  }
  // Take an app out of a group: back on Home right after the group, or off Home altogether.
  // A group left with one app turns back into that app.
  function moveOut(gid, a, drop) {
    const HUB = window.HUB, g = HUB.groupOf(gid)
    if (!g) return
    const label = HUB.appMeta(a).label, rest = g.apps.filter(x => x !== a), apps = appList().slice(), put = drop ? [] : [a]
    let at = apps.indexOf(gid), groups = HUB.groups()
    if (at < 0) at = apps.push(gid) - 1
    if (rest.length < 2) { groups = groups.filter(x => x.id !== gid); apps.splice(at, 1, ...rest, ...put) }
    else { groups = groups.map(x => (x.id === gid ? { ...x, apps: rest } : x)); apps.splice(at + 1, 0, ...put) }
    groupPatch({ groups, apps }, () => hud(drop ? `${label} removed from Home` : `${label} moved to Home`))
  }
  async function removeGroup(id) {
    const HUB = window.HUB, g = HUB?.groupOf(id)
    if (!g) return
    const ok = await alertBox({ title: `Remove ${g.name} from Home?`, message: 'The group and the apps in it come off Home. You can add the apps again with Add App.', ok: 'Remove', danger: true })
    if (ok) groupPatch({ groups: HUB.groups().filter(x => x.id !== id), apps: appList().filter(x => x !== id) }, () => hud(`${g.name} removed from Home`))
  }
  function folderAppMenu(gid, a, x, y) {
    const label = window.HUB.appMeta(a).label
    showMenu(x, y, label, [
      editItem(), '-',
      { label: a === 'chat' ? 'Open Chat' : `Open ${label}`, icon: icon('open', 16), run: () => { closeOverlay(true); openApp(a) } },
      { label: 'Move to Home', icon: icon('minus', 16), run: () => moveOut(gid, a) },
      '-',
      { label: 'Remove from Home', danger: true, icon: icon('trash', 16), run: () => moveOut(gid, a, true) },
    ])
    // The folder sits above the page's menus; lift this one over it.
    const m = document.querySelector('body > .menu')
    if (m) m.style.zIndex = '90'
  }

  // A group opens as a frosted panel over Home, grown out of its icon. The title is its name, edited in place.
  function openGroup(id, rename) {
    const HUB = window.HUB, g0 = HUB?.groupOf(id)
    if (!g0) return
    const from = S.root?.querySelector(`[data-hw-app="${CSS.escape(id)}"] .hc-app`)?.getBoundingClientRect()
    const el = document.createElement('div')
    el.className = 'scrim hw-scrim hw-fscrim'
    const tile = S.root && getComputedStyle(S.root).getPropertyValue('--tile')
    if (tile) el.style.setProperty('--tile', tile)
    el.innerHTML = `<div class="hw-fold${S.editing ? ' hw-fedit' : ''}" role="dialog" aria-modal="true" aria-label="${esc(g0.name)}"><input class="hw-ftitle" value="${esc(g0.name)}" maxlength="40" aria-label="Group name" autocomplete="off" spellcheck="false" enterkeyhint="done"><div class="hw-fgrid" role="list" data-hw-fgrid="${esc(id)}"></div></div>`
    const fold = el.querySelector('.hw-fold'), title = el.querySelector('.hw-ftitle'), grid = el.querySelector('.hw-fgrid')
    const fill = () => {
      const g = HUB.groupOf(id)
      if (!g) return closeOverlay()
      if (document.activeElement !== title) title.value = g.name
      fold.setAttribute('aria-label', g.name)
      const sz = PHONE.matches ? 54 : 58
      const html = g.apps.map(a => {
        const m = HUB.appMeta(a)
        return `<div class="hw-app" role="listitem" data-hw-app="${esc(a)}"><button type="button" class="hw-app-b" data-hw-fopen="${esc(a)}" aria-label="${a === 'chat' ? 'Open Chat' : `Open ${esc(m.label)}`}">${HUB.tile(a, sz, Math.round(sz * 0.26), Math.round(sz * 0.45))}<span class="hw-app-l">${esc(m.label)}</span></button>${S.editing ? `<button type="button" class="hw-ctl hw-del" data-hw-fout="${esc(a)}" aria-label="Move ${esc(m.label)} to Home">${icon('minus', 12)}</button>` : ''}</div>`
      }).join('')
      if (grid._h !== html && !appDrag?.on) { grid.innerHTML = html; grid._h = html }
    }
    const commit = () => {
      const g = HUB.groupOf(id), v = title.value.trim()
      if (!g) return
      if (!v) title.value = g.name
      else if (v !== g.name) groupPatch({ groups: { update: [{ id, name: v }] } })
    }
    fill()
    showOverlay(el, { onClose: commit })
    S.detail = { refresh: fill }
    if (from && fold.animate && !REDUCED.matches) {
      const to = fold.getBoundingClientRect()
      fold.animate([{ transform: `translate(${(from.left + from.width / 2 - (to.left + to.width / 2)).toFixed(1)}px, ${(from.top + from.height / 2 - (to.top + to.height / 2)).toFixed(1)}px) scale(${(from.width / to.width).toFixed(3)})`, opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 360, easing: EASE })
    }
    if (rename) setTimeout(() => { title.focus(); title.select() }, REDUCED.matches ? 0 : 380)
    title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); title.blur() } })
    title.addEventListener('change', commit)
    el.addEventListener('click', e => {
      if (e.target === el) return closeOverlay()
      const out = e.target.closest('[data-hw-fout]')
      if (out) return moveOut(id, out.dataset.hwFout)
      const op = e.target.closest('[data-hw-fopen]')
      if (op && !S.editing && Date.now() - (S.appDragged || 0) > 300) { closeOverlay(true); openApp(op.dataset.hwFopen) }
    })
    el.addEventListener('pointerdown', appDown)
    el.addEventListener('contextmenu', e => {
      const a = e.target.closest('.hw-app')
      if (!a || e.target === title) return
      e.preventDefault()
      if (!appDrag?.on) folderAppMenu(id, a.dataset.hwApp, e.clientX, e.clientY)
    })
    // Press and hold an app in the folder to edit with it in hand, the same as on Home.
    let hold = null
    el.addEventListener('pointerdown', e => {
      const a = e.target.closest('.hw-app')
      if (!a || S.editing || (e.pointerType === 'mouse' && e.button !== 0)) return
      const { pointerId, clientX, clientY, pointerType } = e, app = a.dataset.hwApp
      if (pointerType !== 'mouse') pinTouch(e.target)
      hold = { x: clientX, y: clientY, t: setTimeout(() => {
        hold = null
        S.editing = true
        paint(true)
        fill()
        const now = [...el.querySelectorAll('.hw-app')].find(x => x.dataset.hwApp === app)
        if (!now) return
        appDown({ target: now, pointerId, clientX, clientY, pointerType, button: 0 })
        appBegin()
      }, HOLD_MS) }
    })
    el.addEventListener('pointermove', e => { if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) { clearTimeout(hold.t); hold = null } })
    for (const t of ['pointerup', 'pointercancel']) el.addEventListener(t, () => { if (hold) { clearTimeout(hold.t); hold = null } })
  }
  window.HUB_OPEN_GROUP = openGroup

  // Website apps: one-click suggestions from the hub (plus your Coolify from the Cloud tab).
  let siteSuggest = null
  function suggestions() {
    if (!siteSuggest) siteSuggest = Promise.all([
      fetch('/api/hub/settings/catalog').then(r => r.json()).then(c => c.sites?.suggestions || []).catch(() => []),
      tabOff('cloud') ? null : fetch('/api/cloud/state').then(r => r.json()).then(c => c.coolify?.url).catch(() => null),
    ]).then(([list, coolify]) => (coolify ? [{ name: 'Coolify', url: coolify }, ...list] : list))
    return siteSuggest
  }
  // "my.site.com/x" -> "https://my.site.com/x"; null when it still isn't a web address.
  const typedUrl = v => { v = String(v || '').trim(); if (!v) return null; return window.HUB.webUrl(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`) }
  const siteName = (name, url) => String(name || '').trim().slice(0, 40) || window.HUB.hostOf(url).split('.').slice(-2, -1)[0]?.replace(/^./, c => c.toUpperCase()) || 'Website'
  const siteForm = (site = {}) => `<form class="hw-dlist hw-siteform" data-hw-siteform novalidate>
      <label class="hw-frow"><span>Name</span><input name="name" value="${esc(site.name || '')}" placeholder="My Site" maxlength="40" autocomplete="off" enterkeyhint="next"></label>
      <label class="hw-frow"><span>Address</span><input name="url" value="${esc(site.url || '')}" type="url" inputmode="url" placeholder="example.com" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="next"></label>
      <label class="hw-frow"><span>Icon</span><input name="icon" value="${esc(site.icon || '')}" type="url" inputmode="url" placeholder="Site icon" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"></label>
      <div class="hw-frow sw"><span>Always open in new tab</span><button type="button" class="hc-switch" role="switch" aria-label="Always open in new tab" aria-checked="${!!site.newTab}" data-hw-newtab></button></div>
    </form>`
  // Read the form; hud() and null when the address isn't usable.
  function readSiteForm(form) {
    const f = new FormData(form), url = typedUrl(f.get('url'))
    if (!url) { hud('Enter a web address that starts with http or https'); form.querySelector('[name=url]').focus(); return null }
    const iconRaw = String(f.get('icon') || '').trim(), iconUrl = iconRaw ? typedUrl(iconRaw) : null
    if (iconRaw && !iconUrl) { hud('The icon must be an http or https image address'); form.querySelector('[name=icon]').focus(); return null }
    return { name: siteName(f.get('name'), url), url, icon: iconUrl, newTab: form.querySelector('[data-hw-newtab]').getAttribute('aria-checked') === 'true' }
  }
  async function sitePatch(body, done) {
    try { await window.HUB.patch(body); S.apps = null; paintApps(); done?.() } catch (e) { hud(e.message) }
  }

  function openAppPicker() { openPicker('home') }

  // One picker for Home and the header: apps, websites, suggestions and your own website. The header adds the
  // list of what is in it now, which drags to reorder; Home is in that list for good, so there is always a way back.
  function openPicker(target) {
    if (!window.HUB) return
    const HUB = window.HUB, header = target === 'header', place = header ? 'Header' : onMain() ? 'Home' : 'Page', el = document.createElement('div')
    el.className = 'scrim hw-scrim'
    const tabsSeg = header ? '' : `<div class="seg hw-seg hw-addseg" role="tablist" aria-label="Add to Home" style="--n:2;--i:1"><span class="seg-thumb"></span><button type="button" role="tab" data-hw-addtab="widgets" aria-pressed="false">Widgets</button><button type="button" role="tab" data-hw-addtab="apps" aria-pressed="true">Apps</button></div>`
    el.innerHTML = `<div class="hw-sheet" role="dialog" aria-modal="true" aria-label="${header ? 'Edit Tabs' : 'Add to Home'}"><div class="hw-sh-top"><div class="hw-grab"></div><div class="hw-sh-head"><h2>${header ? 'Edit Tabs' : 'Add to Home'}</h2><button type="button" class="hw-done" data-hw-close>Done</button></div>${tabsSeg}</div><div class="hw-sh-body"></div></div>`
    const body = el.querySelector('.hw-sh-body')
    let sugg = [], draft = null, renaming = null
    // On Home means on the Home row or inside one of its groups.
    const onNow = () => header ? HUB.headerItems() : onMain() ? [...appList(), ...HUB.groups().flatMap(g => g.apps)] : layoutItems(viewKey()).filter(isAppItem).map(i => i.app)
    const pill = (id, has, label) => `<button type="button" class="hw-pill" data-hw-pick="${esc(id)}" aria-pressed="${has}" aria-label="${has ? `Remove ${esc(label)} from ${place}` : `Add ${esc(label)} to ${place}`}">${has ? `${icon('check', 14)}On ${place}` : `${icon('plus', 14)}Add`}</button>`
    const headerRow = id => {
      const label = HUB.labelOf(id)
      const name = renaming === id ? `<input class="hw-rename" value="${esc(label)}" maxlength="24" aria-label="Name for ${esc(label)}" autocomplete="off">` : `<span class="t ell">${esc(label)}</span>`
      return `<div class="hw-row hw-hrow hc-trow" data-id="${esc(id)}"><span class="hc-grip" tabindex="0" role="button" title="Drag to reorder" aria-label="Reorder ${esc(label)}">${hic('grip', 18)}</span>${HUB.tile(id, 32, 9, 17)}${name}<button type="button" class="hw-ib" data-hw-rename="${esc(id)}" aria-label="Rename ${esc(label)}" title="Rename">${icon('pencil', 17)}</button>${id === 'home' ? '<span class="hw-ib" aria-hidden="true"></span>' : `<button type="button" class="hw-ib" data-hw-pick="${esc(id)}" aria-label="Remove ${esc(label)} from Header" title="Remove">${icon('minus', 17)}</button>`}</div>`
    }
    const headerOrder = () => [...body.querySelectorAll('#hc-tabs .hc-trow')].map(r => r.dataset.id)
    const fill = () => {
      if (body.querySelector('.hc-sorting') || (renaming && body.querySelector('.hw-rename'))) return
      const on = onNow(), sites = HUB.sites().filter(x => !x.file), hosts = new Set(sites.map(x => HUB.hostOf(x.url)))
      const pages = header ? HUB.pages().filter(p => !on.includes(p.id)).map(p => `<div class="hw-row">${HUB.tile(p.id, 32, 9, 17)}<span class="t ell">${esc(p.name)}</span><span class="s"></span>${pill(p.id, false, p.name)}</div>`).join('') : ''
      const files = HUB.files().map(f => ({ ...f, sid: `site-${f.id}` })).filter(f => !(header && on.includes(f.sid))).map(f => `<div class="hw-row">${HUB.tile(f.sid, 32, 9)}<span class="t ell">${esc(f.name)}</span><span class="s"></span><button type="button" class="hw-ib" data-hw-filedel="${esc(f.id)}" aria-label="Delete ${esc(f.name)}" title="Delete">${icon('trash', 16)}</button>${pill(f.sid, on.includes(f.sid), f.name)}</div>`).join('')
      // Keep what is typed in the form across repaints.
      const form = body.querySelector('[data-hw-siteform]')
      if (form) draft = { ...Object.fromEntries(new FormData(form)), newTab: form.querySelector('[data-hw-newtab]').getAttribute('aria-checked') === 'true' }
      const y = body.scrollTop
      const apps = HUB.allApps().filter(id => !id.startsWith('site-') && !id.startsWith('group-') && id !== 'browser' && !(header && on.includes(id))).map(id => {
        const has = on.includes(id), label = HUB.appMeta(id).label
        return `<div class="hw-row">${HUB.tile(id, 32, 9, 17)}<span class="t ell">${esc(label)}</span><span class="s"></span>${pill(id, has, label)}</div>`
      }).join('')
      const saved = sites.filter(x => !(header && on.includes(x.id))).map(x => `<div class="hw-row">${HUB.tile(x.id, 32, 9)}<span class="t ell">${esc(x.name)}</span><span class="s">${esc(HUB.hostOf(x.url))}</span><button type="button" class="hw-ib" data-hw-siteedit="${esc(x.id)}" aria-label="Edit ${esc(x.name)}" title="Edit">${icon('pencil', 17)}</button>${pill(x.id, on.includes(x.id), x.name)}</div>`).join('')
      const left = sugg.filter(x => !hosts.has(HUB.hostOf(x.url)))
      const sug = left.map((x, i) => `<div class="hw-row">${HUB.siteTile(x.name, HUB.siteIcon(x.url), 32, 9)}<span class="t ell">${esc(x.name)}</span><span class="s">${esc(HUB.hostOf(x.url))}</span><button type="button" class="hw-pill" data-hw-sugg="${i}" aria-label="Add ${esc(x.name)} to ${place}">${icon('plus', 14)}Add</button></div>`).join('')
      const addons = header ? Object.entries(window.HUB_CONF?.addons || {}).filter(([, a]) => a.available).map(([id, a]) => `<div class="hw-row hw-addon"><span class="t">${esc(a.label)}<small>${esc(!a.on && a.how ? a.how : a.what)}</small></span><button type="button" class="hc-switch" role="switch" aria-label="${esc(a.label)}" aria-checked="${a.on}" data-addon="${esc(id)}"></button></div>`).join('') : ''
      body.innerHTML = (header ? dsec('In the Header', `<div class="hw-dlist hw-applist" id="hc-tabs">${on.map(headerRow).join('')}</div>`) : '') +
        (apps ? dsec('Apps', `<div class="hw-dlist hw-applist">${apps}</div>`) : '') +
        (pages ? dsec('Home Pages', `<div class="hw-dlist hw-applist">${pages}</div>`) : '') +
        (saved ? dsec('Websites', `<div class="hw-dlist hw-applist">${saved}</div>`) : '') +
        (sug ? dsec('Suggested Websites', `<div class="hw-dlist hw-applist" data-hw-sugglist>${sug}</div>`) : '') +
        dsec('Add a Website', `${siteForm(draft || {})}<button type="button" class="hw-wide solid" data-hw-siteadd>${icon('plus', 18)}Add to ${place}</button>`) +
        dsec('Your Files', `${files ? `<div class="hw-dlist hw-applist">${files}</div>` : ''}<button type="button" class="hw-wide" data-hw-fileadd>${icon('plus', 18)}Add from File…</button>`) +
        (addons ? dsec('Add-ons', `<div class="hw-dlist">${addons}</div>`) : '') +
        (header ? `<button type="button" class="hw-wide" data-hw-tabsreset>${hic('reset', 17)}Reset to Default</button>` : '')
      body._left = left
      body.scrollTop = y
      const list = body.querySelector('#hc-tabs')
      if (list) HUB.sortable(list, { item: '.hc-trow', handle: '.hc-grip', scroller: body, onDrop: ids => HUB.setHeader(ids) })
      const rn = body.querySelector('.hw-rename')
      if (rn) { rn.focus(); rn.select() }
    }
    // A new website joins this place; the server names it, so find it by what is new.
    const addSite = (site, done) => {
      const had = new Set(HUB.sites().map(x => x.id))
      sitePatch({ sites: { add: [header || !onMain() ? { ...site, onHome: false } : site] } }, () => {
        const made = HUB.sites().find(x => !had.has(x.id))
        if (header && made) HUB.setHeader([...HUB.headerItems(), made.id])
        else if (!onMain() && made) pageApp(made.id, true)
        hud(`${site.name} added to ${place}`)
        done?.()
        fill()
      })
    }
    fill()
    showOverlay(el)
    S.detail = { refresh: fill }
    suggestions().then(list => {
      sugg = list
      if (el.isConnected) fill()
    })
    el.addEventListener('submit', e => e.preventDefault())
    el.addEventListener('focusout', e => {
      if (!e.target.matches?.('.hw-rename')) return
      const id = e.target.closest('.hc-trow').dataset.id
      renaming = null
      if (!e.target.dataset.cancel) HUB.renameHeader(id, e.target.value)
      fill()
    })
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches?.('.hw-rename')) { e.preventDefault(); return e.target.blur() }
      const grip = e.target.closest?.('.hc-grip')
      if (grip && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault()
        const ids = headerOrder(), at = ids.indexOf(grip.closest('.hc-trow').dataset.id), to = at + (e.key === 'ArrowUp' ? -1 : 1)
        if (to < 0 || to >= ids.length) return
        ids.splice(to, 0, ids.splice(at, 1)[0])
        HUB.setHeader(ids)
        fill()
        return body.querySelector(`.hc-trow[data-id="${CSS.escape(ids[to])}"] .hc-grip`)?.focus()
      }
      if (e.key !== 'Enter' || !e.target.closest?.('[data-hw-siteform] input')) return
      e.preventDefault()
      const ins = [...el.querySelectorAll('[data-hw-siteform] input')], i = ins.indexOf(e.target)
      if (i < ins.length - 1) ins[i + 1].focus()
      else el.querySelector('[data-hw-siteadd]')?.click()
    })
    el.addEventListener('click', e => {
      if (e.target === el || e.target.closest('[data-hw-close]')) return closeOverlay()
      if (e.target.closest('[data-hw-addtab="widgets"]')) return switchAdd(openGallery)
      const sw = e.target.closest('[data-hw-newtab]')
      if (sw) return sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true'))
      const ed = e.target.closest('[data-hw-siteedit]')
      if (ed) return openSiteEditor(ed.dataset.hwSiteedit)
      const rn = e.target.closest('[data-hw-rename]')
      if (rn) { renaming = rn.dataset.hwRename; return fill() }
      if (e.target.closest('[data-hw-fileadd]')) {
        return void HUB.addFile().then(j => {
          if (!j) return
          if (header) HUB.setHeader([...HUB.headerItems(), j.site])
          else addApp(j.site)
          hud(`${HUB.siteOf(j.site)?.name || 'Your file'} added to ${place}`)
          fill()
        })
      }
      const fd = e.target.closest('[data-hw-filedel]')
      if (fd) return void deleteFile(fd.dataset.hwFiledel).then(fill)
      const addon = e.target.closest('[data-addon]')
      if (addon) return void api('/api/hub/addons', { id: addon.dataset.addon, on: addon.getAttribute('aria-checked') !== 'true' }).then(() => location.reload(), err => hud(err.message))
      if (e.target.closest('[data-hw-tabsreset]')) return void HUB.patch({ reset: ['tabs'] }).then(fill, err => hud(err.message))
      const sg = e.target.closest('[data-hw-sugg]')
      if (sg) {
        const x = body._left[Number(sg.dataset.hwSugg)]
        sg.disabled = true
        return x && addSite({ name: x.name, url: x.url })
      }
      if (e.target.closest('[data-hw-siteadd]')) {
        const form = body.querySelector('[data-hw-siteform]'), v = form && readSiteForm(form)
        if (!v) return
        const add = { name: v.name, url: v.url, newTab: v.newTab }
        if (v.icon) add.icon = v.icon
        return addSite(add, () => {
          // The sheet may have repainted while saving; clear the form that is on screen now.
          draft = null
          const now = body.querySelector('[data-hw-siteform]')
          now?.querySelectorAll('input').forEach(i => (i.value = ''))
          now?.querySelector('[data-hw-newtab]')?.setAttribute('aria-checked', 'false')
        })
      }
      const b = e.target.closest('[data-hw-pick]')
      if (!b) return
      const id = b.dataset.hwPick
      if (header) {
        const now = HUB.headerItems()
        HUB.setHeader(now.includes(id) ? now.filter(x => x !== id) : [...now, id])
      } else if (!onMain()) {
        pageApp(id, !onNow().includes(id))
      } else {
        const g = HUB.groups().find(x => x.apps.includes(id))
        if (g) moveOut(g.id, id, true)
        else if (appList().includes(id)) setApps(appList().filter(x => x !== id))
        else addApp(id)
      }
      fill()
      body.querySelector(`[data-hw-pick="${CSS.escape(id)}"]`)?.focus()
    })
  }
  window.HUB_OPEN_PICKER = openPicker
  // The one sheet, for anything else on the page that needs it. Connections open theirs here.
  window.HUB_SHEET = ({ title, onClose }) => {
    const el = document.createElement('div')
    el.className = 'scrim hw-scrim'
    el.innerHTML = `<div class="hw-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="hw-sh-top"><div class="hw-grab"></div><div class="hw-sh-head"><h2>${esc(title)}</h2><button type="button" class="hw-done" data-hw-close>Done</button></div></div><div class="hw-sh-body"></div><div class="hw-sh-foot"></div></div>`
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-hw-close]')) closeOverlay() })
    showOverlay(el, { onClose })
    return { el, body: el.querySelector('.hw-sh-body'), foot: el.querySelector('.hw-sh-foot'), close: () => closeOverlay() }
  }

  async function deleteFile(id) {
    const f = window.HUB?.files().find(x => x.id === id)
    if (!f) return
    const ok = await alertBox({ title: `Delete ${f.name}?`, message: 'It comes off Home, your pages and the header.', ok: 'Delete', danger: true })
    if (!ok) return
    try { await window.HUB.removeFile(id); hud(`${f.name} deleted`) } catch (e) { hud(e.message) }
  }

  // Home always stays first; the pages after it can be added, named, reordered and removed.
  function openPagesSheet() {
    const HUB = window.HUB
    if (!HUB) return
    const el = document.createElement('div')
    el.className = 'scrim hw-scrim'
    el.innerHTML = `<div class="hw-sheet" role="dialog" aria-modal="true" aria-label="Home Pages"><div class="hw-sh-top"><div class="hw-grab"></div><div class="hw-sh-head"><h2>Home Pages</h2><button type="button" class="hw-done" data-hw-close>Done</button></div></div><div class="hw-sh-body"></div></div>`
    const body = el.querySelector('.hw-sh-body')
    let renaming = null
    const row = p => `<div class="hw-row hw-hrow hc-trow" data-id="${esc(p.id)}"><span class="hc-grip" tabindex="0" role="button" title="Drag to reorder" aria-label="Reorder ${esc(p.name)}">${hic('grip', 18)}</span>${renaming === p.id ? `<input class="hw-rename" value="${esc(p.name)}" maxlength="24" aria-label="Name for ${esc(p.name)}" autocomplete="off">` : `<span class="t ell">${esc(p.name)}</span>`}<button type="button" class="hw-ib" data-hw-pagename="${esc(p.id)}" aria-label="Rename ${esc(p.name)}" title="Rename">${icon('pencil', 16)}</button><button type="button" class="hw-ib" data-hw-pagedel="${esc(p.id)}" aria-label="Remove ${esc(p.name)}" title="Remove">${icon('trash', 16)}</button></div>`
    const fill = () => {
      if (body.querySelector('.hc-sorting') || (renaming && body.querySelector('.hw-rename'))) return
      const list = HUB.pages()
      body.innerHTML = dsec('Pages', `<div class="hw-dlist hw-applist"><div class="hw-row hw-hrow"><span class="t ell">Home</span></div>${list.length ? `<div id="hw-pagelist">${list.map(row).join('')}</div>` : ''}</div>`) + `<button type="button" class="hw-wide solid" data-hw-pageadd>${icon('plus', 18)}Add Page</button>`
      const sortList = body.querySelector('#hw-pagelist')
      if (sortList) HUB.sortable(sortList, { item: '.hc-trow', handle: '.hc-grip', scroller: body, onDrop: ids => send({ pages: { order: ids } }) })
      const rn = body.querySelector('.hw-rename')
      if (rn) { rn.focus(); rn.select() }
    }
    const send = async patchBody => { try { await HUB.patch(patchBody) } catch (e) { hud(e.message) } fill() }
    fill()
    showOverlay(el)
    S.detail = { refresh: fill }
    el.addEventListener('submit', e => e.preventDefault())
    el.addEventListener('focusout', e => {
      if (!e.target.matches?.('.hw-rename')) return
      const id = e.target.closest('.hc-trow').dataset.id, name = e.target.value.trim()
      renaming = null
      if (!e.target.dataset.cancel && name) send({ pages: { rename: { id, name } } })
      else fill()
    })
    el.addEventListener('keydown', e => {
      if (e.target.matches?.('.hw-rename')) {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur() }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.target.dataset.cancel = '1'; e.target.blur() }
        return
      }
      const grip = e.target.closest?.('.hc-grip')
      if (!grip || !['ArrowUp', 'ArrowDown'].includes(e.key)) return
      e.preventDefault()
      const ids = HUB.pages().map(p => p.id), at = ids.indexOf(grip.closest('.hc-trow').dataset.id), to = at + (e.key === 'ArrowUp' ? -1 : 1)
      if (to < 0 || to >= ids.length) return
      ids.splice(to, 0, ids.splice(at, 1)[0])
      send({ pages: { order: ids } }).then(() => body.querySelector(`.hc-trow[data-id="${CSS.escape(ids[to])}"] .hc-grip`)?.focus())
    })
    el.addEventListener('click', async e => {
      if (e.target === el || e.target.closest('[data-hw-close]')) return closeOverlay()
      if (e.target.closest('[data-hw-pageadd]')) {
        const had = new Set(HUB.pages().map(p => p.id))
        try { await HUB.patch({ pages: { add: { name: `Page ${had.size + 1}` } } }) } catch (err) { return hud(err.message) }
        const made = HUB.pages().find(p => !had.has(p.id))
        if (made) { renaming = made.id; await openPage(made.id) }
        return fill()
      }
      const rn = e.target.closest('[data-hw-pagename]')
      if (rn) { renaming = rn.dataset.hwPagename; return fill() }
      const del = e.target.closest('[data-hw-pagedel]')
      if (del) {
        const p = HUB.pageOf(del.dataset.hwPagedel)
        if (!p) return
        const ok = await alertBox({ title: `Remove ${p.name}?`, message: 'The page and everything placed on it come off. Undo in Edit Style brings it back.', ok: 'Remove', danger: true })
        if (ok) send({ pages: { remove: [p.id] } })
      }
    })
  }

  function openSiteEditor(id) {
    const HUB = window.HUB, site = HUB?.siteOf(id)
    if (!site) return
    const el = document.createElement('div')
    el.className = 'scrim hw-scrim'
    el.innerHTML = `<div class="hw-sheet" role="dialog" aria-modal="true" aria-label="Edit ${esc(site.name)}"><div class="hw-sh-top"><div class="hw-grab"></div><div class="hw-sh-head">${HUB.tile(id, 26, 7)}<h2>${esc(site.name)}</h2><button type="button" class="hw-done" data-hw-close>Cancel</button></div></div><div class="hw-sh-body">${dsec('Website', siteForm(site))}<div><button type="button" class="hw-wide solid" data-hw-sitesave>Save</button><button type="button" class="hw-wide red" data-hw-sitedel>Delete Website</button></div></div></div>`
    showOverlay(el)
    el.addEventListener('submit', e => e.preventDefault())
    el.addEventListener('click', async e => {
      if (e.target === el || e.target.closest('[data-hw-close]')) return closeOverlay()
      const sw = e.target.closest('[data-hw-newtab]')
      if (sw) return sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true'))
      if (e.target.closest('[data-hw-sitesave]')) {
        const v = readSiteForm(el.querySelector('[data-hw-siteform]'))
        if (!v) return
        return sitePatch({ sites: { update: [{ id, name: v.name, url: v.url, icon: v.icon, newTab: v.newTab }] } }, () => { closeOverlay(); hud('Saved') })
      }
      if (e.target.closest('[data-hw-sitedel]')) return deleteSite(id)
    })
  }
  async function deleteSite(id) {
    const site = window.HUB?.siteOf(id)
    if (!site) return
    const ok = await alertBox({ title: `Delete ${site.name}?`, message: 'It comes off Home and out of your websites. You can add it again any time.', ok: 'Delete', danger: true })
    if (ok) sitePatch({ sites: { remove: [id] } }, () => { closeOverlay(); hud(`${site.name} deleted`) })
  }

  /* ---------- widget options: colour, plus each widget's own choices ---------- */

  // Must match WIDGET_OPTIONS in hub-settings.mjs; the hub rejects anything else.
  const OPTS = {
    clock: [['face', 'Face', [['digital', 'Digital'], ['analog', 'Analog']]], ['seconds', 'Seconds', [[false, 'Off'], [true, 'On']]]],
    'claude-usage': [['style', 'Style', [['rings', 'Rings'], ['bars', 'Bars']]]],
    tokens: [['chart', 'Chart', [['bars', 'Bars'], ['line', 'Line']]]],
    coolify: [['view', 'Show', [['ring', 'Ring'], ['bar', 'Bar']]]],
  }
  const TINTS = [['#0a84ff', 'Blue'], ['#5e5ce6', 'Indigo'], ['#7a5af8', 'Purple'], ['#ff2d55', 'Pink'], ['#ff3b30', 'Red'], ['#ff9500', 'Orange'], ['#ffcc00', 'Yellow'], ['#34c759', 'Green'], ['#30b0c7', 'Teal'], ['#8e8e93', 'Graphite']]
  function openOptions(key) {
    const vk = viewKey(), cur = () => findItem(vk, key)?.it, first = cur(), w = first && widgetMap().get(first.id)
    if (!w) return
    const el = document.createElement('div')
    el.className = 'scrim hw-scrim'
    el.innerHTML = `<div class="hw-sheet" role="dialog" aria-modal="true" aria-label="${esc(w.label)} options"><div class="hw-sh-top"><div class="hw-grab"></div><div class="hw-sh-head"><h2>${esc(w.label)}</h2><button type="button" class="hw-done" data-hw-close>Done</button></div></div><div class="hw-sh-body"></div></div>`
    const body = el.querySelector('.hw-sh-body')
    const fill = () => {
      const it = cur()
      if (!it) return closeOverlay()
      const o = it.opts || {}, size = sizeOf(it, w), [pw, ph] = DIMS[vk][size]
      const k = Math.min(1, ((sheetOf(el).clientWidth || 360) - 40) / pw)
      let html = `<div class="hw-opt"><h3>Colour</h3><div class="hw-swatches" role="group" aria-label="Colour"><button type="button" class="hw-sw def" data-tint="" aria-label="Default colour" aria-pressed="${!o.tint}">${o.tint ? '' : icon('check', 16)}</button>${TINTS.map(([c, n]) => `<button type="button" class="hw-sw" style="--c:${c}" data-tint="${c}" aria-label="${n}" aria-pressed="${o.tint === c}">${o.tint === c ? icon('check', 16) : ''}</button>`).join('')}</div></div>`
      for (const [opt, label, vals] of OPTS[w.id] || []) {
        const now = o[opt] ?? vals[0][0]
        html += `<div class="hw-opt"><h3>${label}</h3><div class="hw-segopt" role="group" aria-label="${label}">${vals.map(([v, n]) => `<button type="button" data-opt="${opt}" data-v="${v}" aria-pressed="${now === v}">${n}</button>`).join('')}</div></div>`
      }
      html += `<div class="hw-opt"><h3>Preview</h3><div class="hw-prev" style="--pw:${pw}px;--ph:${ph}px;--k:${k.toFixed(3)}">${cardHtml(w, size, vk, bodyFor(w, size, o), false, o)}</div></div>`
      body.innerHTML = html
      fitAll(body)
    }
    showOverlay(el)
    fill()
    S.detail = { refresh: fill }
    el.addEventListener('click', e => {
      if (e.target === el || e.target.closest('[data-hw-close]')) return closeOverlay()
      const b = e.target.closest('[data-tint], [data-opt]')
      const it = b && cur()
      if (!it) return
      const o = { ...(it.opts || {}) }
      if (b.dataset.opt) {
        const v = b.dataset.v, val = v === 'true' ? true : v === 'false' ? false : v, def = (OPTS[w.id] || []).find(x => x[0] === b.dataset.opt)?.[2][0][0]
        if (val === def) delete o[b.dataset.opt]
        else o[b.dataset.opt] = val
      }
      else if (b.dataset.tint) o.tint = b.dataset.tint
      else delete o.tint
      if (Object.keys(o).length) it.opts = o
      else delete it.opts
      saveSoon(vk)
      paint()
      fill()
      body.querySelector(b.dataset.opt ? `[data-opt="${b.dataset.opt}"][data-v="${b.dataset.v}"]` : `[data-tint="${b.dataset.tint}"]`)?.focus()
    })
  }

  /* ---------- right-click (press and hold on touch) ---------- */

  function setSize(key, size) {
    const vk = viewKey(), it = layoutItems(vk).find(i => i.key === key)
    if (!it) return
    const [sizes, now] = sizesOf(it, widgetMap())
    if (!sizes.includes(size) || now === size) return
    resize(it, size)
    saveSoon(vk)
    paint(true)
  }
  const editItem = () => ({ label: S.editing ? 'Done Editing' : 'Edit Home', icon: S.editing ? icon('check', 16) : icon('pencil', 16), run: toggleEdit })
  function contextMenu(target, x, y) {
    if (!showing() || !S.root?.isConnected || !target.closest?.('#main')) return false
    if (S.drag?.on || appDrag?.on) return true
    const HUB = window.HUB
    // The margin around an icon belongs to that app.
    const app = target.closest('.hw-app:not(.add)') || target.closest('.hw-cell.a')?.querySelector('.hw-app:not(.add)')
    if (app && HUB) {
      const id = app.dataset.hwApp, label = HUB.appMeta(id).label
      const site = HUB.siteOf?.(id), g = HUB.groupOf?.(id)
      if (g) {
        showMenu(x, y, g.name, [
          editItem(), '-',
          { label: 'Open', icon: icon('open', 16), run: () => openGroup(id) },
          { label: 'Rename…', icon: icon('pencil', 16), run: () => openGroup(id, true) },
          { label: 'Ungroup', icon: icon('grid', 16), run: () => groupPatch({ groups: { remove: [id] } }, () => hud(`${g.name} ungrouped`)) },
          ...(S.editing ? [{ label: 'Move Left', icon: '', run: () => moveApp(id, -1) }, { label: 'Move Right', icon: '', run: () => moveApp(id, 1) }] : []),
          '-',
          { label: 'Remove from Home…', danger: true, icon: icon('trash', 16), run: () => removeGroup(id) },
        ])
        return true
      }
      const items = [editItem(), '-', { label: id === 'chat' ? 'Open Chat' : `Open ${label}`, icon: icon('open', 16), run: () => openApp(id) }]
      if (site && !site.file) items.push(
        { label: 'Open in New Tab', icon: hic('external', 16), run: () => window.open(site.url, '_blank', 'noopener,noreferrer') },
        { label: 'Always Open in New Tab', icon: site.newTab ? icon('check', 16) : '', run: () => sitePatch({ sites: { update: [{ id, newTab: !site.newTab }] } }, () => hud(site.newTab ? `${label} opens in a preview` : `${label} opens in a new tab`)) },
        { label: 'Edit Website…', icon: icon('pencil', 16), run: () => openSiteEditor(id) },
      )
      if (S.editing) items.push({ label: 'Move Left', icon: '', run: () => moveApp(id, -1) }, { label: 'Move Right', icon: '', run: () => moveApp(id, 1) })
      items.push('-', { label: 'Remove from Home', danger: true, icon: icon('trash', 16), run: () => removeApp(id) })
      if (site?.file) items.push({ label: 'Delete File…', danger: true, icon: icon('trash', 16), run: () => deleteFile(site.file) })
      else if (site) items.push({ label: 'Delete Website…', danger: true, icon: icon('trash', 16), run: () => deleteSite(id) })
      showMenu(x, y, label, items)
      return true
    }
    const cell = target.closest('.hw-cell')
    const top = cell && layoutItems(viewKey()).find(i => i.key === cell.dataset.hwKey)
    if (isStack(top)) {
      const key = top.key, cur = skCurrent(top), wm = widgetMap(), w = wm.get(cur.id), name = w?.label || 'Missing widget', sizes = stackSizes(top, wm)
      const items = []
      if (sizes.length > 1) items.push(...sizes.map(sz => ({ label: SIZE_NAME[sz], icon: sz === top.size ? icon('check', 16) : '', run: () => setSize(key, sz) })), '-')
      if (w) items.push({ label: `${name} Options…`, icon: icon('sliders', 16), run: () => openOptions(cur.key) })
      if (w?.tab && !S.editing) items.push({ label: `Open ${tabName(w.tab)}`, icon: icon('open', 16), run: () => setEnv(w.tab) })
      items.push({ label: `Remove “${name}” from Stack`, icon: icon('minus', 16), run: () => removeFromStack(cur.key) }, { label: 'Unstack', icon: icon('layers', 16), run: () => unstack(key) }, '-', { label: 'Remove Stack', danger: true, icon: icon('trash', 16), run: () => removeItem(key) })
      showMenu(x, y, 'Stack', items)
      return true
    }
    if (cell) {
      const key = cell.dataset.hwKey, it = top, w = it && widgetMap().get(it.id)
      const items = [editItem(), '-']
      if (w) {
        const size = sizeOf(it, w)
        if (w.sizes.length > 1) items.push(...w.sizes.map(sz => ({ label: SIZE_NAME[sz], icon: sz === size ? icon('check', 16) : '', run: () => setSize(key, sz) })), '-')
        items.push({ label: 'Widget Options…', icon: icon('sliders', 16), run: () => openOptions(key) })
        if (w.tab && !S.editing) items.push({ label: `Open ${tabName(w.tab)}`, icon: icon('open', 16), run: () => setEnv(w.tab) })
        items.push('-')
      }
      items.push({ label: 'Remove Widget', danger: true, icon: icon('trash', 16), run: () => removeItem(key) })
      showMenu(x, y, w ? w.label : 'Missing widget', items)
      return true
    }
    const items = [
      { label: 'Add Widget…', icon: icon('plus', 16), run: openGallery },
      ...(HUB ? [{ label: 'Add App…', icon: icon('grid', 16), run: openAppPicker }] : []),
      { label: 'Add Page', icon: icon('layers', 16), run: addPage },
      editItem(),
    ]
    if (HUB) items.push('-', { label: 'Edit Style…', icon: hic('palette', 16), run: () => HUB.openStyle() }, { label: 'Change Wallpaper…', icon: hic('image', 16), run: () => HUB.openStyle('wallpaper') }, { label: 'Edit Tabs…', icon: hic('tabs', 16), run: () => HUB.openTabs() }, ...(window.HUB_CONNECTIONS ? [{ label: 'Connections…', icon: hic('plug', 16), run: () => window.HUB_CONNECTIONS() }] : []))
    items.push('-', { label: 'Reset Layout…', danger: true, icon: hic('reset', 16), run: resetLayout })
    showMenu(x, y, 'Home', items)
    return true
  }

  // Style and tab sheets close Home's popups first; settings changed elsewhere (another device,
  // the hub's chat agent) show up here without a reload.
  window.HUB_CLOSE_OVERLAYS = () => closeOverlay(true)
  window.HUB?.on((s, changed) => {
    if (['apps', 'sites', 'groups', 'tabs', 'files'].some(k => changed.includes(k))) { S.apps = null; paintApps(); S.detail?.refresh() }
    if (changed.includes('pages') && S.layouts && !(S.layoutAt && Number(s.at) < S.layoutAt)) {
      const was = S.page
      takePages(s.pages || [])
      if (was !== S.page) S.sig = ''
      scheduleRepaint()
      S.detail?.refresh()
      if (was !== S.page && typeof chrome === 'function') { try { chrome() } catch {} }
    }
    if (!changed.includes('widgets') || !S.layout || S.editing || S.drag || VIEWS.some(k => S.dirty[k] || S.saving[k])) return
    if (S.layoutAt && Number(s.at) < S.layoutAt) return
    let moved = false
    const main = S.layouts?.main || S.layout
    for (const k of VIEWS) if (Array.isArray(s.widgets?.[k])) { const next = withKeys(s.widgets[k]); if (JSON.stringify(next) !== JSON.stringify(main[k])) { main[k] = next; moved = true } }
    if (moved && onMain()) { scheduleRepaint(); loadSources(neededSources()) }
  })

  /* ---------- scrolling: pages or one long scroll, per view ---------- */

  async function setScroll(vk, how) {
    if (scrollOf(vk) === how || !SCROLL_DEFAULT[vk]) return
    S.scroll = { ...SCROLL_DEFAULT, ...S.scroll, [vk]: how }
    S.at[vk] = 0
    S.extra = 0
    S.sig = ''
    const pager = S.root?.querySelector('.hw-pager')
    if (pager) pager.scrollTop = 0
    if (S.kept) S.kept['hw-pager'] = 0
    pagerSet(0)
    paint()
    if (vk === 'tv') tvPush()
    S.scrollSaving = (S.scrollSaving || 0) + 1
    try {
      const out = await api('/api/home/layout', { scroll: { [vk]: how } })
      if (out?.scroll && S.scrollSaving === 1) S.scroll = { ...SCROLL_DEFAULT, ...out.scroll }
      S.layoutAt = Number(out?.at) || S.layoutAt
      hud(how === 'infinite' ? 'Infinite scroll' : 'Pages')
    } catch (e) { hud(`Couldn’t save: ${e.message}`) }
    S.scrollSaving--
    if (vk === 'tv') tvPush(true)
  }

  /* ---------- TV: LocalHub TV as it really is, and what it uses ----------
     The TV view is the real /tv/ page in preview mode, scaled onto a screen, so it can't drift from
     the TV. Edit shows beside it what the TV takes from the hub: its apps and their order (tv.apps,
     tv.hidden) and how it scrolls (scroll.tv); the look and wallpaper are the hub's own. Opened
     inside LocalHub TV, the TV itself is the preview. */

  const tvTarget = () => { try { return IN_TV ? window.parent.LocalHubTV : S.tvHost?.firstChild?.contentWindow?.LocalHubTV } catch { return null } }
  // What the TV uses, with edits on their way to the hub on top.
  function tvState() {
    const st = window.HUB?.settings || {}
    return {
      apps: S.tvApps?.apps ?? st.tv?.apps ?? [],
      hidden: S.tvApps?.hidden ?? st.tv?.hidden ?? [],
    }
  }
  // Shows an edit on the TV at once (the preview, or the TV around this page); sync reads the hub again.
  function tvPush(sync) {
    const tv = tvTarget()
    if (!tv) return
    if (sync || !window.HUB?.settings) return void tv.sync?.()
    const st = window.HUB.settings, cur = tvState()
    tv.apply?.({ ...st, tv: { ...(st.tv || {}), apps: cur.apps, hidden: cur.hidden, saver: saverOf() }, scroll: { ...SCROLL_DEFAULT, ...(st.scroll || {}), ...S.scroll } })
  }

  function paintTv() {
    const box = S.root.querySelector('[data-hw-tv]')
    if (!box.firstChild) {
      box.innerHTML = (IN_TV ? '' : '<div class="hw-tv-screen"><div class="hw-tv-glass"></div><div class="hw-tv-neck"></div><div class="hw-tv-base"></div></div>') +
        '<aside class="hw-tv-side" data-hw-tvside aria-label="What LocalHub TV shows" hidden></aside>'
    }
    // The hub puts Home back into the page every few seconds, and a moved iframe starts over. So the TV
    // lives in a frame of its own on <body>, kept over the screen drawn here.
    if (!IN_TV && !S.tvHost) {
      S.tvHost = document.createElement('div')
      S.tvHost.className = 'hw-tv-float'
      S.tvHost.innerHTML = '<iframe src="/tv/?preview" title="LocalHub TV, as it looks now"></iframe>'
      S.tvHost.firstChild.addEventListener('load', () => { const side = S.root?.querySelector('[data-hw-tvside]'); if (side) side._sig = ''; paintTvSide() })
      document.body.append(S.tvHost)
    }
    const side = box.querySelector('[data-hw-tvside]'), opening = side.hidden && (S.editing || IN_TV)
    side.hidden = !S.editing && !IN_TV
    if (opening) saverPreview()
    paintTvSide()
    tvFit()
    tvTrack()
  }
  // Follows the screen while Home's TV view is showing, and hides when it isn't.
  function tvTrack() {
    if (!S.tvHost || S.tvRaf) return
    const host = S.tvHost, step = () => {
      const glass = S.root?.querySelector('.hw-tv-glass'), box = glass?.closest('.hw-tv')
      if (!glass?.isConnected || !showing() || viewKey() !== 'tv' || !box || box.hidden) { host.style.visibility = 'hidden'; S.tvRaf = 0; return }
      const r = glass.getBoundingClientRect(), b = box.getBoundingClientRect()
      const k = `${r.left}|${r.top}|${r.width}|${r.height}|${b.top}|${b.bottom}`
      if (host._k !== k) {
        host._k = k
        Object.assign(host.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, clipPath: `inset(${Math.max(0, b.top - r.top)}px 0 ${Math.max(0, r.bottom - b.bottom)}px 0 round 10px)` })
      }
      host.style.visibility = 'visible'
      S.tvRaf = requestAnimationFrame(step)
    }
    S.tvRaf = requestAnimationFrame(step)
  }
  // The screen as big as fits between the bar and the chat bar, beside the panel when it's open.
  function tvFit() {
    const root = S.root, box = root?.querySelector('[data-hw-tv]')
    if (!box || box.hidden) return
    const h = Math.max(260, innerHeight - box.getBoundingClientRect().top - 84), side = box.querySelector('[data-hw-tvside]')
    const beside = side && !side.hidden && innerWidth > 900 ? 360 + 28 : 0
    const w = Math.max(280, Math.min(root.clientWidth - beside - 8, (h - 66) * 16 / 9 + 24))
    box.style.setProperty('--tvh', `${Math.floor(h)}px`)
    box.style.setProperty('--tvw', `${Math.floor(w)}px`)
  }

  const tvMini = a => `<span class="hw-tv-mini" style="--a-bg:${esc(a.bg || '#2c2c2e')};--a-fg:${esc(a.fg || '#fff')}" aria-hidden="true">${a.img ? `<img src="${esc(a.img)}" alt="">` : a.icon ? `<i style="--glyph:url('/tv/brands/${esc(a.icon)}.svg')"></i>` : esc((a.letter || a.name || '?').slice(0, 1))}</span>`
  // The apps as the TV draws them: its order, then the ones it leaves out.
  function tvLists() {
    const tv = tvTarget()
    if (!tv?.apps) return null
    const all = tv.apps(), st = tvState()
    const byId = new Map(all.map(a => [a.id, a])), hidden = new Set(st.hidden), listed = st.apps.filter(id => byId.has(id))
    const shown = [...listed, ...all.map(a => a.id).filter(id => !listed.includes(id))].filter(id => !hidden.has(id))
    return { all, byId, st, shown, off: all.filter(a => hidden.has(a.id)).map(a => a.id) }
  }
  function paintTvSide() {
    const side = S.root?.querySelector('[data-hw-tvside]')
    if (!side || side.hidden || side.querySelector('.hc-sorting')) return
    const L = tvLists()
    if (!L) { if (!side.querySelector('.hw-tv-wait')) { side._sig = ''; side.innerHTML = '<div class="hw-tv-wait">Loading LocalHub TV…</div>' } return }
    // A field being typed in keeps its text: the panel waits until it's left.
    if (side.contains(document.activeElement) && document.activeElement.matches('input[type="text"]')) return
    const sig = JSON.stringify([L.shown, L.off, saverOf(), S.tvSaverErr || '', S.tvSaverPrev || null, Object.keys(tvTarget()?.widgets?.() || {})])
    if (side._sig === sig) return
    side._sig = sig
    const grip = (kind, id, label) => `<span class="hc-grip" tabindex="0" role="button" data-hw-tvgrip="${kind}" data-id="${esc(id)}" title="Drag to reorder" aria-label="Move ${esc(label)}, with the arrow keys">${hic('grip', 18)}</span>`
    const apps = L.shown.map(id => { const a = L.byId.get(id); return `<div class="hw-row hc-trow" data-id="${esc(id)}">${grip('apps', id, a.name)}${tvMini(a)}<span class="t ell">${esc(a.name)}</span><button type="button" class="hw-ib" data-hw-tvact="app-hide" data-id="${esc(id)}" aria-label="Hide ${esc(a.name)} on the TV" title="Hide">${icon('minus', 17)}</button></div>` }).join('')
    const off = L.off.map(id => { const a = L.byId.get(id); return `<div class="hw-row">${tvMini(a)}<span class="t ell">${esc(a.name)}</span><button type="button" class="hw-pill" data-hw-tvact="app-show" data-id="${esc(id)}" aria-label="Show ${esc(a.name)} on the TV">${icon('plus', 14)}Show</button></div>` }).join('')
    const name = esc(window.HUB_CONF?.name || 'LocalHub'), y = side.scrollTop
    side.innerHTML =
      dsec('Apps', `<div class="hw-dlist hw-applist" data-hw-tvlist="apps">${apps || '<div class="hw-row"><span class="t">No apps on the TV</span></div>'}</div><p>After ${name}, in this order. Inputs and Settings follow them.</p>`) +
      (off ? dsec('Hidden Apps', `<div class="hw-dlist hw-applist">${off}</div>`) : '') +
      `<button type="button" class="hw-wide" data-hw-tvact="apps-reset" style="margin-top:22px">${hic('reset', 17)}Default Order</button>` +
      (window.HUB?.openStyle ? `<button type="button" class="hw-wide" data-hw-tvact="style">${hic('palette', 17)}Wallpaper and Style</button>` : '') +
      saverHtml() +
      (IN_TV ? '' : `<button type="button" class="hw-wide" data-hw-tvact="open" style="margin-top:22px">${icon('open', 17)}Open LocalHub TV</button>`) +
      `<section class="hw-dsec"><p>Saved on the hub. A TV showing LocalHub picks it up within 30 seconds. The wallpaper and style are the hub’s own.</p></section>`
    side.scrollTop = y
    if (window.HUB?.sortable) {
      const al = side.querySelector('[data-hw-tvlist="apps"]')
      if (al) window.HUB.sortable(al, { item: '.hc-trow', handle: '.hc-grip', scroller: side, onDrop: ids => tvSaveOrder(ids) })
    }
  }

  /* The TV's screensaver (tv.saver): photos from a library, how they move, and the widgets over them.
     The screensaver itself (GET /api/tv/saver and the TV's drawing of it) is its own part of the hub;
     this only edits the setting and shows a few of the photos it would use. */
  const SAVER_DEFAULT = { source: 'wallpapers', folder: '', interval: 12, shuffle: true, motion: 'kenburns', widgets: ['clock', 'date'] }
  const SAVER_SOURCES = [['wallpapers', 'Wallpapers'], ['folder', 'Folder'], ['icloud', 'iCloud'], ['pictures', 'Pictures']]
  const SAVER_MAX = 4
  const saverOf = () => ({ ...SAVER_DEFAULT, ...(window.HUB?.settings?.tv?.saver || {}), ...(S.tvSaver || {}) })
  const segOf = (field, opts, cur, label) => `<div class="seg hw-tv-seg" role="radiogroup" aria-label="${esc(label)}" style="--n:${opts.length};--i:${Math.max(0, opts.findIndex(([v]) => v === cur))}"><span class="seg-thumb"></span>${opts.map(([v, t]) => `<button type="button" role="radio" aria-checked="${v === cur}" data-hw-tvact="saver-${field}" data-id="${esc(v)}">${esc(t)}</button>`).join('')}</div>`
  function saverHtml() {
    const v = saverOf(), wid = tvTarget()?.widgets?.() || {}, on = v.widgets.filter(id => wid[id]), full = on.length >= SAVER_MAX, P = S.tvSaverPrev
    const widgets = Object.entries(wid).map(([id, label]) => { const has = on.includes(id); return `<div class="hw-row"><span class="t">${esc(label)}</span><button type="button" class="hc-switch" role="switch" aria-label="${esc(label)} on the screensaver" aria-checked="${has}" data-hw-tvact="saver-widget" data-id="${esc(id)}"${!has && full ? ' disabled' : ''}></button></div>` }).join('')
    const photos = P?.photos?.length ? `<div class="hw-tv-photos">${P.photos.slice(0, 6).map(ph => `<img src="${esc(ph.url)}" alt="" loading="lazy">`).join('')}</div>` : ''
    const src = P?.source ? `<p${P.source.ok === false ? ' class="err"' : ''}>${esc(P.source.ok === false ? P.source.error || `${P.source.label || 'This library'} can’t be read.` : P.source.label || '')}</p>` : ''
    return dsec('Screensaver', `${segOf('source', SAVER_SOURCES, v.source, 'Photos from')}` +
      (v.source === 'folder' ? `<div class="hw-dlist" style="margin-top:8px"><label class="hw-row"><span class="t">Folder</span><input type="text" class="hw-tv-input" data-hw-saver="folder" value="${esc(v.folder || '')}" placeholder="A folder on this computer" spellcheck="false" autocomplete="off"></label></div><p>A folder on this computer, read by the hub.</p>` : '') +
      photos + src +
      `<div class="hw-dlist" style="margin-top:12px"><label class="hw-row"><span class="t">Each photo</span><input type="range" min="5" max="300" step="1" value="${Number(v.interval) || 12}" data-hw-saver="interval" aria-label="Seconds each photo shows"><span class="s hw-tv-secs" data-hw-secs>${Number(v.interval) || 12} s</span></label>` +
      `<div class="hw-row"><span class="t">Shuffle</span><button type="button" class="hc-switch" role="switch" aria-label="Shuffle" aria-checked="${!!v.shuffle}" data-hw-tvact="saver-shuffle"></button></div></div>` +
      `<div style="margin-top:12px">${segOf('motion', [['kenburns', 'Ken Burns'], ['fade', 'Fade']], v.motion, 'Motion')}</div>` +
      (widgets ? `<h3 style="margin-top:18px">On the Screensaver</h3><div class="hw-dlist">${widgets}</div><p>Up to ${SAVER_MAX}.</p>` : '') +
      (S.tvSaverErr ? `<p class="err">${esc(S.tvSaverErr)}</p>` : ''))
  }
  // Shown at once, then saved whole; the hub's answer (or its refusal) comes back to the panel.
  async function tvSaveSaver(change) {
    const next = { ...saverOf(), ...change }, seq = (S.tvSaverSeq = (S.tvSaverSeq || 0) + 1)
    S.tvSaver = next
    tvPush()
    paintTvSide()
    try {
      if (window.HUB?.patch) await window.HUB.patch({ tv: { saver: next } })
      else await api('/api/hub/settings', { tv: { saver: next } })
      S.tvSaverErr = ''
      if (seq === S.tvSaverSeq) S.tvSaver = null
      tvPush(true)
      saverPreview()
    } catch (e) {
      // Kept on screen, so nothing chosen is lost while the hub catches up.
      S.tvSaverErr = /tv\.saver is not a known key/.test(e.message) ? 'This hub can’t keep screensaver settings yet. Update LocalHub, then choose again.' : `Couldn’t save: ${e.message}`
    }
    paintTvSide()
  }
  // A few of the photos the screensaver would show. A hub without the screensaver has no preview.
  function saverPreview() {
    clearTimeout(S.tvSaverT)
    S.tvSaverT = setTimeout(async () => {
      let next = null
      try {
        const r = await fetch('/api/tv/saver', { cache: 'no-store' })
        const j = r.ok ? await r.json().catch(() => null) : null
        if (j && (Array.isArray(j.photos) || j.source)) next = { photos: (j.photos || []).filter(p => p && typeof p.url === 'string').slice(0, 6), source: j.source || null }
      } catch {}
      S.tvSaverPrev = next
      paintTvSide()
    }, 250)
  }
  function saverField(field, value) {
    if (field === 'interval') return tvSaveSaver({ interval: Math.max(5, Math.min(300, Math.round(Number(value) || 12))) })
    if (field === 'folder') { const f = String(value || '').trim(); if (f !== (saverOf().folder || '')) tvSaveSaver({ folder: f }) }
  }

  // tv.apps keeps the ids this screen doesn't have (another TV's apps), so one TV's edit keeps the other's order.
  async function tvSaveApps(shown, off) {
    const L = tvLists()
    if (!L) return
    const mine = new Set(L.all.map(a => a.id)), seq = (S.tvSeq = (S.tvSeq || 0) + 1)
    const apps = [...shown, ...L.st.apps.filter(id => !mine.has(id))], hidden = [...off, ...L.st.hidden.filter(id => !mine.has(id))]
    S.tvApps = { apps, hidden }
    tvPush()
    paintTvSide()
    try {
      if (window.HUB?.patch) await window.HUB.patch({ tv: { apps, hidden } })
      else await api('/api/hub/settings', { tv: { apps, hidden } })
      tvPush(true)
    } catch (e) { hud(`Couldn’t save: ${e.message}`) }
    if (seq === S.tvSeq) { S.tvApps = null; paintTvSide() }
  }
  const tvSaveOrder = ids => { const L = tvLists(); if (L) tvSaveApps(ids, L.off) }
  function tvAction(act, id) {
    if (act === 'style') return window.HUB?.openStyle?.()
    if (act === 'open') return void window.open('/tv/', '_blank', 'noopener')
    if (act === 'saver-source') return tvSaveSaver({ source: id })
    if (act === 'saver-motion') return tvSaveSaver({ motion: id })
    if (act === 'saver-shuffle') return tvSaveSaver({ shuffle: !saverOf().shuffle })
    if (act === 'saver-widget') { const cur = saverOf().widgets, w = cur.filter(x => x !== id); return tvSaveSaver({ widgets: w.length === cur.length ? [...w, id].slice(0, SAVER_MAX) : w }) }
    const L = tvLists()
    if (!L) return
    if (act === 'app-hide') return tvSaveApps(L.shown.filter(x => x !== id), [...L.off, id])
    if (act === 'app-show') return tvSaveApps(L.shown.includes(id) ? L.shown : [...L.shown, id], L.off.filter(x => x !== id))
    if (act === 'apps-reset') {
      const seq = (S.tvSeq = (S.tvSeq || 0) + 1)
      S.tvApps = { apps: [], hidden: [] }
      tvPush()
      paintTvSide()
      const done = () => { if (seq === S.tvSeq) { S.tvApps = null; paintTvSide() } tvPush(true) }
      const body = { tv: { apps: null, hidden: null } }
      return (window.HUB?.patch ? window.HUB.patch(body) : api('/api/hub/settings', body)).then(() => { hud('Default order'); done() }, e => { hud(`Couldn’t save: ${e.message}`); done() })
    }
  }
  // The arrow keys on a grip move that row, for anyone not dragging.
  function tvMove(kind, id, dir) {
    const L = tvLists()
    if (!L) return
    const list = [...L.shown], i = list.indexOf(id), j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    list.splice(i, 1)
    list.splice(j, 0, id)
    tvSaveOrder(list)
    requestAnimationFrame(() => S.root?.querySelector(`[data-hw-tvgrip="${kind}"][data-id="${CSS.escape(id)}"]`)?.focus())
  }

  /* ---------- actions ---------- */

  function setMode(m) {
    if (S.mode === m || realDevice()) return
    S.mode = m
    save('hub-home-mode', m)
    S.extra = 0
    S.sig = ''
    scrollTo(0, 0)
    const pager = S.root?.querySelector('.hw-pager')
    if (pager) pager.scrollTop = 0
    S.kept = {}
    paint()
    const dev = S.root?.querySelector('.hw-device'), grid = S.root?.querySelector('[data-hw-grid]')
    if (m === 'tv') { const tv = S.root?.querySelector('[data-hw-tv]'); if (tv?.animate && !REDUCED.matches) tv.animate([{ opacity: 0, transform: 'scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE }) }
    if (S.framed) {
      if (dev.animate && !REDUCED.matches) dev.animate([{ opacity: 0, transform: `scale(${S.frameK * 0.96})` }, { opacity: 1, transform: `scale(${S.frameK})` }], { duration: 280, easing: EASE })
    } else if (m !== 'tv' && grid?.animate && !REDUCED.matches) grid.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE })
    loadSources(neededSources())
  }
  function toggleEdit() {
    S.editing = !S.editing
    if (!S.editing) S.extra = 0
    closeOverlay(true)
    if (!S.editing) { for (const vk of VIEWS) { clearTimeout(S.timers[vk]); flush(vk) } hud('Layout saved') }
    paint(true)
    S.sig = ''
    paint()
  }
  async function resetLayout() {
    const vk = viewKey(), name = { desktop: 'desktop', ipad: 'iPad', mobile: 'phone', tv: 'TV' }[vk]
    const ok = typeof alertBox === 'function'
      ? await alertBox({ title: `Reset the ${name} layout?`, message: onMain() ? 'Widgets go back to the new default arrangement. The other layout stays as it is.' : 'Everything comes off this page in this layout. The other layouts stay as they are.', ok: 'Reset', danger: true })
      : confirm(`Reset the ${name} layout?`)
    if (!ok) return
    try {
      const out = await api('/api/home/layout', onMain() ? { reset: vk } : { page: S.page, reset: vk })
      S.layout[vk] = onMain() ? out[vk] : withKeys(out.pages?.find(p => p.id === S.page)?.widgets?.[vk] || [])
      S.dirty[vk] = false
      S.layoutErr = ''
    } catch (e) {
      S.layout[vk] = onMain() ? seedLayout(vk) : []
      S.layoutErr = isNet(e) ? 'reconnecting' : e.message
      saveSoon(vk)
    }
    S.extra = 0
    S.at[vk] = 0
    paint(true)
    pagerSnap()
    loadSources(neededSources())
    hud('Layout reset')
  }
  const neededSources = () => {
    if (viewKey() === 'tv') return []
    const wm = widgetMap(), ids = new Set()
    for (const it of flatItems(viewKey())) for (const s of (wm.get(it.id) ? srcOf(wm.get(it.id)) : [])) ids.add(s)
    return [...ids]
  }

  function wireRoot(root) {
    root.addEventListener('click', e => {
      const t = e.target
      const mode = t.closest('[data-hw-mode]')
      if (mode) return setMode(mode.dataset.hwMode)
      const how = t.closest('[data-hw-scroll]')
      if (how) return setScroll(viewKey(), how.dataset.hwScroll)
      const tvAct = t.closest('[data-hw-tvact]')
      if (tvAct) return tvAction(tvAct.dataset.hwTvact, tvAct.dataset.id)
      const act = t.closest('[data-hw-act]')
      if (act) {
        const a = act.dataset.hwAct
        return a === 'edit' ? toggleEdit() : a === 'add' ? openGallery() : a === 'style' ? window.HUB?.openStyle() : a === 'tabs' ? window.HUB?.openTabs() : a === 'pages' ? openPagesSheet() : resetLayout()
      }
      const pg = t.closest('[data-hw-page]')
      if (pg) return void openPage(pg.dataset.hwPage)
      const dot = t.closest('[data-hw-dot]')
      if (dot) return pagerGo(Number(dot.dataset.hwDot))
      const pb = t.closest('[data-hw-pagebtn]')
      if (pb) return pb.dataset.hwPagebtn === 'add' ? addPage() : removePage()
      const adel = t.closest('[data-hw-appdel]')
      if (adel) return removeApp(adel.dataset.hwAppdel)
      const ao = t.closest('[data-hw-appopen]')
      if (ao) {
        // A group opens even while editing, so its apps can be rearranged or moved out.
        const id = ao.dataset.hwAppopen, group = id.startsWith('group-')
        if ((!S.editing || group) && Date.now() - (S.appDragged || 0) > 300) group ? openGroup(id) : openApp(id)
        return
      }
      const cell = t.closest('.hw-cell')
      if (t.closest('[data-hw-del]')) return cell && removeItem(cell.dataset.hwKey)
      if (t.closest('[data-hw-size]')) return cell && cycleSize(cell.dataset.hwKey)
      const retry = t.closest('[data-hw-retry]')
      if (retry) { e.stopPropagation(); return void loadSource(retry.dataset.hwRetry, true) }
      const op = t.closest('[data-hw-open]')
      if (op) { e.stopPropagation(); return setEnv(op.dataset.hwOpen) }
      if (t.closest('[data-connect]')) return
      if (cell && !S.editing && t.closest('.hw-card')) openDetail(t.closest('[data-hw-wkey]')?.dataset.hwWkey || cell.dataset.hwKey)
    })
    root.addEventListener('keydown', e => {
      const grip = e.target.closest?.('[data-hw-tvgrip]')
      if (grip && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); return tvMove(grip.dataset.hwTvgrip, grip.dataset.id, e.key === 'ArrowUp' ? -1 : 1) }
      const ao = S.editing && e.target.closest?.('[data-hw-appopen]')
      if (ao && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) { e.preventDefault(); return moveApp(ao.dataset.hwAppopen, /Left|Up/.test(e.key) ? -1 : 1) }
      if (ao && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); return removeApp(ao.dataset.hwAppopen) }
      if ((e.key !== 'Enter' && e.key !== ' ') || S.editing) return
      const card = e.target.closest?.('.hw-card.live')
      if (card && e.target === card) { e.preventDefault(); openDetail(card.closest('[data-hw-wkey]').dataset.hwWkey) }
    })
    root.addEventListener('pointerdown', holdStart)
    root.addEventListener('pointerdown', dragStart)
    root.addEventListener('pointerdown', appDown)
    root.addEventListener('pointerdown', swipeStart)
    root.addEventListener('wheel', onWheel, { passive: false })
    // Tabbing to a card on another page brings that page.
    root.addEventListener('focusin', e => { const c = e.target.closest?.('.hw-cell'); if (c && !S.drag?.on && c.hwPage != null && c.hwPage !== at()) pagerGo(c.hwPage) })
    root.addEventListener('scroll', onStackScroll, true)
    // The screensaver's slider shows its value as it moves, and saves where it stops; the folder saves when left.
    root.addEventListener('input', e => { if (e.target.dataset?.hwSaver === 'interval') { const o = e.target.parentElement.querySelector('[data-hw-secs]'); if (o) o.textContent = `${e.target.value} s` } })
    root.addEventListener('change', e => { const f = e.target.dataset?.hwSaver; if (f) saverField(f, e.target.value) })
    root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset?.hwSaver === 'folder') { e.preventDefault(); e.target.blur() } })
    root.addEventListener('contextmenu', e => {
      // A held finger means edit, never the phone's own menu.
      if (e.pointerType === 'touch' && e.target.closest('.hw-cell')) { e.preventDefault(); e.stopPropagation(); return }
      if (S.editing) e.preventDefault()
    })
    root.addEventListener('dragstart', e => { if (S.editing || e.target.closest?.('.hw-pager')) e.preventDefault() })
  }

  document.addEventListener('keydown', e => {
    if (!S.overlay) return
    if (e.key === 'Escape' && e.target.matches?.('.hw-rename')) { e.preventDefault(); e.stopPropagation(); e.target.dataset.cancel = '1'; return e.target.blur() }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return closeOverlay() }
    if (e.key === 'Tab') {
      const f = [...S.overlay.el.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null)
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }, true)

  for (const q of [PHONE, TABLET]) q.addEventListener?.('change', () => { if (S.root?.isConnected) { S.sig = ''; paint(); loadSources(neededSources()) } })

  /* ---------- tab plumbing ---------- */

  function startTimers() {
    if (S.started) return
    S.started = true
    setInterval(() => {
      if (!showing() || document.hidden || S.drag?.on || appDrag?.on) return
      tickClock()
      if (Date.now() - S.lastLoad >= 60_000) load()
    }, 5000)
    // Second hands and seconds digits tick every second, only while one is on screen.
    setInterval(() => { if (showing() && !document.hidden && !S.drag?.on && !appDrag?.on && S.root?.querySelector('[data-hw-sec], [data-hw-hand="s"]')) tickClock() }, 1000)
    document.addEventListener('visibilitychange', () => { if (!document.hidden && showing() && Date.now() - S.lastLoad > 30_000) load() })
    // A service was just connected or disconnected from a sheet: the cards catch up now.
    document.addEventListener('hub-connection', () => { if (showing()) load(true) })
    document.fonts?.ready.then(() => { fitAll(); if (showing()) frameFit() })
  }

  async function load(force) {
    startTimers()
    S.lastLoad = Date.now()
    for (const vk of VIEWS) if (S.dirty[vk]) flush(vk)
    await loadLayout()
    scheduleRepaint()
    await loadSources(neededSources(), force)
    scheduleRepaint()
  }

  const KEEP_SCROLL = ['hw-pager', 'hw-tv', 'hw-tv-side']
  function mount() {
    const slot = document.getElementById('hw-slot')
    if (!slot || !S.root) return
    slot.replaceWith(S.root)
    if (scrollY) scrollTo(0, 0)
    for (const k of KEEP_SCROLL) { const el = S.root.querySelector(`.${k}`); if (el && S.kept?.[k] && el.scrollTop !== S.kept[k]) el.scrollTop = S.kept[k] }
    // The hub replaces the page every few seconds; cards update only if the hub's own data moved.
    const st = typeof data !== 'undefined' && data ? `${data.laptop?.at}:${data.server?.at}:${data.syncs?.at}` : ''
    const moved = st !== S.hubSig
    S.hubSig = st
    if (!S.drag?.on) paint(false)
    else if (moved) S.pending = true
    // Re-attaching resets scroll inside the stacks; put each back on its page.
    restoreStacks(S.root)
    applyFilter()
    fitAll()
    tickClock()
  }

  function render() {
    if (!S.root) { S.root = buildRoot(); wireRoot(S.root); startTimers() }
    // The hub puts Home back into the page every few seconds, which starts every scroller at the top
    // again: what was scrolled is noted here, while Home is still in the page, and put back in mount.
    else if (S.root.isConnected) for (const k of KEEP_SCROLL) { const el = S.root.querySelector(`.${k}`); if (el) (S.kept ||= {})[k] = el.scrollTop }
    queueMicrotask(mount)
    return '<div id="hw-slot"></div>'
  }

  ;(window.TABS ||= {}).home = {
    title: 'Home',
    search: 'Search widgets',
    render,
    load,
    ago: () => (S.lastLoad ? ago(S.lastLoad) : ''),
    contextMenu,
  }
})()
