// The TV's look on a computer: the photo wallpaper, the sidebar, the big clock, the weather, round buttons and solid
// dark cards (tv/ui/styles.css is where they come from). custom.js puts data-tvlook on <html> when the window is wide,
// has a mouse and Edit Style isn't set to Light; everything here hangs off that, so a phone, an iPad or Light is as before.
;(() => {
  const R = 'html[data-tvlook]'
  const css = document.createElement('style')
  css.textContent = `
#tvrail, #tvtop { display: none; }
/* The colours are theme.css's; here they're given to the hub's own names, so every tab, menu and sheet follows. */
:root[data-tvlook][data-theme] { --ui-u: .5px; --ui-edge: inset 0 0 0 1px rgba(255, 255, 255, .1); --tvrail: 92px; scrollbar-gutter: auto;
  --bg: var(--chat-bg); --surface: var(--ui-panel); --surface-2: var(--ui-fill); --press: #34353c; --fill: rgba(255, 255, 255, .08); --fill-2: rgba(255, 255, 255, .14);
  --sep: rgba(255, 255, 255, .1); --menu-bg: var(--ui-panel); --material: rgba(17, 18, 22, .94); --thumb: var(--ui-sel); --sheen: rgba(255, 255, 255, .06); }
${R} .nav.scrolled::after { display: none; }
${R} :is(.hc-panel, .menu) { background: var(--ui-panel) !important; box-shadow: var(--ui-edge), 0 24px 60px rgba(0, 0, 0, .5) !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }

${R} #tvpanel { position: fixed; z-index: 60; top: 0; right: 0; bottom: 0; width: 418px; overflow-y: auto; scrollbar-width: none; background: var(--ui-panel); border-radius: 26px 0 0 26px; box-shadow: inset 1px 0 0 rgba(255, 255, 255, .1), -30px 0 80px rgba(0, 0, 0, .45); color: #fff; transform: translateX(105%); visibility: hidden; transition: transform .28s var(--ease), visibility 0s .28s; }
${R} #tvpanel.on { transform: none; visibility: visible; transition: transform .28s var(--ease); }
${R} #tvpanel > div { zoom: .55; padding: 56px 48px; }
${R} #tvpanel [data-w] { cursor: pointer; touch-action: none; }
${R} #tvpanel .tvp-sub { margin: -16px 0 30px 8px; font-size: 26px; color: rgba(255, 255, 255, .6); }
${R} #tvpanel :is(.mp-b, .wpp):hover, ${R} #tvpanel .wpr:hover b { background: var(--ui-sel); color: #000; }
${R} #tvpanel .wpp:hover .t2 { color: rgba(0, 0, 0, .55); }
${R} #tvpanel .wps:hover { box-shadow: 0 0 0 5px rgba(255, 255, 255, .35); }
${R} #tvpanel :focus-visible { outline: 5px solid #0a84ff; outline-offset: 4px; }
#tvpanel { display: none; } .tvround { display: none; }
${R} #tvpanel { display: block; }
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
${R} .tvt-clock { font: 700 76px/1 var(--display); letter-spacing: -.035em; font-variant-numeric: tabular-nums; white-space: nowrap; }
${R} .tvt-date { margin-top: 10px; font: 600 24px/1.2 var(--display); color: rgba(255, 255, 255, .9); }
${R} .tvt-wx .wxw { font-size: 13px; }
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
${R} .hw-app-b { transition: transform .2s var(--ease); }
${R} .hw-app-b:hover { transform: scale(1.06); }
${R} .hw-app-b:hover > .hc-app { background: var(--ui-sel) !important; color: #000 !important; }
${R} .hw-app-l { font-weight: 600; text-shadow: 0 1px 4px rgba(0, 0, 0, .7); }

/* ── Home: the clock, one row of buttons, then your apps; widgets in a column at the top right ── */
${R} { --side: 380px; --sidegap: 40px; }
@media (max-width: 1250px) { ${R} { --side: 300px; --sidegap: 28px; } }
${R}:has(.hw-root) .page { position: relative; padding-right: 48px; }
${R}:has(.hw-root:is([data-view="tv"], [data-view="ipad"], [data-view="mobile"])) .page, ${R}[data-noside]:has(.hw-root) .page { padding-right: 48px; }
/* The TV's own proportions: the clock at the top, the name of what you're on above the row, the row three fifths down. */
${R}:has(.hw-root) #tvtop { display: flex; flex-direction: column; box-sizing: border-box; height: max(250px, 59vh); padding: 36px 0 22px; margin: 0; color: #fff; pointer-events: none; }
${R} .tvt-name { margin-top: auto; max-width: calc(100% - var(--side) - 20px); font: 700 clamp(54px, 7.2vw, 120px)/1.05 var(--display); letter-spacing: -.035em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 2px 14px rgba(0, 0, 0, .35); }
@media (max-height: 620px) { ${R}:has(.hw-root) #tvtop { height: 150px; } ${R} .tvt-name { display: none; } }
${R} .controls { margin-bottom: 26px; top: 12px; }
${R}:has(.hw-root) .controls { position: relative; top: 0; z-index: 12; min-height: 56px; padding-right: var(--barw, 0px); gap: 12px; }
${R} .search { max-width: 520px; }
${R} .page:has(.hw-root) .search { flex: 1 1 120px; min-width: 120px; max-width: none; }
${R} .hw-root > .hw-bar { position: absolute; z-index: 13; top: var(--bartop, 0px); right: 48px; height: 56px; margin: 0; flex-wrap: nowrap; gap: 10px; }
${R} .hw-root:is([data-view="tv"], [data-view="ipad"], [data-view="mobile"]) > .hw-bar, ${R}[data-noside] .hw-root > .hw-bar { right: 48px; }
${R} .hw-root.hw-edit > .hw-bar { left: auto; }
${R} .hw-bar-r { margin: 0; overflow: visible; }
${R} .hw-bar .hw-hint:not(:empty) { position: absolute; top: 100%; right: 0; white-space: nowrap; }
${R} .hw-bar .hw-btn { gap: 8px; }
/* No device views: Home is this one; the TV button goes to your TV. */
${R} .hw-bar > .hw-seg { display: none !important; }
${R} .hw-root.hw-edit .hw-tvbtn { display: none; }
.hw-tvbtn { display: none; } ${R} .hw-tvbtn { display: inline-flex; }
/* ── Your TV, driven from here ── */
#tvmirror { display: none; }
${R} #tvmirror.on { display: flex; flex-direction: column; position: fixed; z-index: 54; left: var(--tvrail); right: 0; top: 0; bottom: 0; background: var(--chat-bg); color: #fff; padding: 26px 40px 22px; gap: 16px; outline: 0; }
${R} .tvm-head { display: flex; align-items: center; gap: 16px; font: 700 26px/1.1 var(--display); }
${R} .tvm-head span { flex: 1; font: 500 15px var(--font); color: rgba(255, 255, 255, .6); }
${R} .tvm-b { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 50%; background: var(--ui-fill); box-shadow: var(--ui-edge); color: #fff; }
${R} .tvm-b:hover { background: var(--ui-sel); color: #000; } ${R} .tvm-b svg { width: 22px; height: 22px; }
${R} .tvm-fit { flex: 1; min-height: 0; display: grid; place-items: center; }
${R} .tvm-screen { position: relative; overflow: hidden; border-radius: 18px; background: #000; box-shadow: 0 0 0 1px rgba(255, 255, 255, .14), 0 30px 80px rgba(0, 0, 0, .5); }
${R} .tvm-screen iframe { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; border: 0; transform-origin: 0 0; pointer-events: none; }
${R} .tvm-cover { position: absolute; inset: 0; cursor: pointer; }
${R} .tvm-note { position: absolute; inset: 0; display: grid; place-items: center; padding: 40px; text-align: center; font-size: 20px; font-weight: 600; background: rgba(0, 0, 0, .72); pointer-events: none; }
${R} .tvm-note[hidden] { display: none; }
${R} .hw-bar .hw-btn .hw-ic { display: block; }
${R} .seg.hw-seg button { gap: 7px; }
/* Too tight for words: the buttons keep their icons. */
${R}[data-tight] .hw-bar .hw-btn { width: 42px; padding: 0; justify-content: center; }
${R}[data-tight] .hw-bar .hw-btn-t, ${R}[data-tight] .hw-bar .hw-seg span:not(.seg-thumb) { display: none; }
${R}[data-tight] .hw-bar .hw-seg { width: 190px; }
${R}[data-tight] .hw-bar .hw-ic { display: block; }
${R}[data-tighter] .hw-bar .hw-seg { display: none; }
/* Editing: a back button, what you can do, Done. */
${R} .tvround { display: none; flex: none; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: var(--ui-fill); box-shadow: var(--ui-edge); color: #fff; }
${R}:has(.hw-root) .tvround { display: grid; }
${R} .tvround:hover, ${R} .tvround.on { background: var(--ui-sel); color: #000; }
${R} .tvround svg { width: 26px; height: 26px; }
${R}:not(:has(.hw-edit)) #tvback.tvround { display: none; }
${R}:has(.hw-edit) :is(#tvlayout, #tvfilter).tvround { display: none; }
#tvmenu { display: none; }
${R}:not(:has(#tvset.on)) #tvmenu.on { display: block; position: fixed; z-index: 70; min-width: 220px; padding: 8px; border-radius: 24px; background: var(--ui-panel); box-shadow: var(--ui-edge), 0 24px 60px rgba(0, 0, 0, .5); color: #fff; }
${R} #tvmenu h4 { margin: 8px 16px 6px; font-size: 13px; font-weight: 600; color: rgba(255, 255, 255, .56); }
${R} #tvmenu button { display: flex; justify-content: space-between; gap: 20px; width: 100%; padding: 11px 16px; border-radius: 16px; font-size: 15px; font-weight: 600; text-align: left; }
${R} #tvmenu button:is(:hover, :focus-visible) { background: var(--ui-sel); color: #000; outline: 0; }

/* Apps: the TV's tiles, all one shape, in rows that fit the window. */
${R} .hw-root[data-view="desktop"] .hw-grid { grid-template-columns: repeat(5, minmax(0, 1fr)) !important; grid-auto-rows: auto !important; gap: 26px clamp(18px, 2.3vw, 44px) !important; padding: 10px 4px 120px; align-items: start; }
${R} .hw-root[data-view="desktop"] .hw-cell.a { display: block; grid-column: auto !important; grid-row: auto !important; }
${R} .hw-root[data-view="desktop"] .hw-app-b { padding: 0; gap: 10px; }
${R} .hw-root[data-view="desktop"] .hw-app-b > .hc-app { width: 100% !important; height: auto !important; aspect-ratio: 5 / 3; }
${R} .hw-app-b > .hc-app { border-radius: 18px !important; background: var(--ui-fill) !important; color: #fff !important; box-shadow: var(--ui-edge); }
${R} .hw-root[data-view="desktop"] .hw-app-l { display: block; width: 100%; text-align: center; font-size: 14px; }
${R} .hw-root[data-view="desktop"] .hw-app .hw-del { left: -8px; top: -8px; }
/* Widgets are drawn off screen here, at their real size, and shown in the column (#tvside). */
${R} .hw-root[data-view="desktop"] .hw-grid > .hw-cell:not(.a) { position: absolute; left: -9999px; top: 0; width: 184px; height: 184px; }
${R} .hw-root[data-view="desktop"] .hw-grid > .hw-cell.m:not(.a) { width: var(--side); }
${R} .hw-root[data-view="desktop"] .hw-grid > .hw-cell.l:not(.a) { width: var(--side); height: 380px; }
#tvside { display: none; }
${R} .hw-root[data-view="desktop"] > #tvside { display: grid; position: fixed; z-index: 11; top: 30px; right: max(48px, calc((100vw - 1500px) / 2 + 48px)); width: var(--side); max-height: max(190px, calc(59vh - 70px)); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-content: start; padding: 8px; margin: -8px; box-sizing: content-box; }
${R} #tvside::-webkit-scrollbar { display: none; }
${R} #tvside .hw-cell { height: 184px; min-width: 0; grid-column: auto !important; grid-row: auto !important; }
${R} #tvside .hw-cell:is(.m, .l), ${R} #tvside .tvt-wx { grid-column: 1 / -1 !important; }
${R} #tvside .hw-cell.l { height: 380px; }
${R} #tvside .tvp-card { grid-column: 1 / -1; } ${R} .tvp-card .mp { zoom: .62; } ${R} .tvp-card .mp-b { cursor: pointer; } ${R} .tvp-card .mp-b:hover { background: var(--ui-sel); color: #000; }
${R} #tvside .tvt-wx { padding: 18px 22px; border-radius: 26px; background: var(--ui-panel); box-shadow: var(--ui-edge); color: #fff; }
${R}[data-tvshow="apps"] #tvside { visibility: hidden; }
${R}[data-tvshow="widgets"] .hw-grid > .hw-cell.a { display: none !important; }
${R} .hw-dots { display: none; }

/* ── Settings: the TV's page, at a computer's size ── */
#tvset { display: none; }
${R} #tvset.on { position: fixed; z-index: 55; left: var(--tvrail); right: 0; top: 0; bottom: 0; display: grid; grid-template-columns: minmax(220px, 34%) minmax(0, 1fr); background: var(--chat-bg); color: #fff; }
${R} .tvs-art { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; text-align: center; }
${R} .tvs-art img { width: 170px; height: 170px; border-radius: 38px; box-shadow: 0 25px 55px rgba(0, 0, 0, .55); }
${R} .tvs-art p { margin: 0; font-size: 14px; line-height: 1.5; color: rgba(255, 255, 255, .6); }
${R} .tvs-list { overflow-y: auto; scrollbar-width: none; padding: 48px 64px 90px 8px; }
${R} .tvs-list::-webkit-scrollbar { display: none; }
${R} .tvs-title { display: flex; align-items: center; gap: 16px; margin: 0 0 20px 6px; font: 700 34px/1.1 var(--display); letter-spacing: -.02em; }
${R} .tvs-title button { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--ui-fill); box-shadow: var(--ui-edge); }
${R} .tvs-title button:hover { background: var(--ui-sel); color: #000; }
${R} .tvs-title svg { width: 22px; height: 22px; }
${R} .tvs-group { margin: 24px 0 8px 16px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: rgba(255, 255, 255, .56); }
${R} .tvs-row { display: flex; align-items: center; gap: 16px; width: 100%; min-height: 58px; padding: 9px 20px; margin-bottom: 8px; border-radius: 18px; background: var(--ui-fill); box-shadow: var(--ui-edge); text-align: left; transition: transform .2s var(--ease); }
${R} button.tvs-row:is(:hover, :focus-visible) { background: var(--ui-sel); color: #000; transform: scale(1.015); outline: 0; }
${R} .tvs-row .txt { flex: 1; min-width: 0; }
${R} .tvs-row .t1 { font-size: 16px; font-weight: 600; }
${R} .tvs-row .t2 { margin-top: 2px; font-size: 13px; color: rgba(255, 255, 255, .6); }
${R} .tvs-row .v { font-size: 15px; color: rgba(255, 255, 255, .6); white-space: nowrap; }
${R} .tvs-row .v.on { color: #0a84ff; }
${R} button.tvs-row:is(:hover, :focus-visible) :is(.t2, .v) { color: rgba(0, 0, 0, .55); }
${R} .tvs-walls { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 22px 18px; padding: 6px; }
${R} .tvs-wall i { display: block; aspect-ratio: 16 / 9; border-radius: 16px; background: #2c2c2e center / cover no-repeat; box-shadow: var(--ui-edge); }
${R} .tvs-wall span { display: block; margin-top: 8px; padding-left: 4px; font-size: 14px; font-weight: 600; text-align: left; color: rgba(255, 255, 255, .75); }
${R} .tvs-wall:is(:hover, :focus-visible) i { box-shadow: 0 0 0 3px #fff; } ${R} .tvs-wall { outline: 0; }
${R} .tvs-wall.on span { color: #fff; } ${R} .tvs-wall.on span::after { content: " ✓"; color: #0a84ff; }

/* ── Screensaver, on a computer or a phone ── */
#hubsaver { position: fixed; inset: 0; z-index: 200; background: #000; color: #fff; opacity: 0; transition: opacity .6s; cursor: none; overflow: hidden; }
#hubsaver.on { opacity: 1; }
#hubsaver i { position: absolute; inset: -3%; background: center / cover no-repeat; opacity: 0; transition: opacity 1.6s; animation: hubsaver 24s ease-in-out infinite alternate; }
#hubsaver i.on { opacity: 1; }
#hubsaver::after { content: ""; position: absolute; inset: 0; background: linear-gradient(0deg, rgba(0, 0, 0, .45), transparent 45%); }
#hubsaver div { position: absolute; z-index: 1; left: max(6vw, 28px); bottom: max(7vh, 40px); }
#hubsaver b { display: block; font: 700 clamp(56px, 8vw, 120px)/1 var(--display); letter-spacing: -.035em; font-variant-numeric: tabular-nums; }
#hubsaver span { font: 600 clamp(18px, 2vw, 30px)/1.4 var(--display); }
@keyframes hubsaver { from { transform: scale(1); } to { transform: scale(1.06); } }
@media (prefers-reduced-motion: reduce) { #hubsaver i { animation: none; } }
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

  let wxBody = null
  const seg = document.getElementById('seg')
  const isOn = b => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-selected') === 'true' || b.classList.contains('on')
  const PREF = 'localhub.look'
  let look = { clock: 'Time and date', weather: true, show: 'all', sort: 'mine' }
  try { look = { ...look, ...JSON.parse(localStorage.getItem(PREF) || '{}') } } catch {}
  const rail = document.createElement('nav')
  rail.id = 'tvrail'
  rail.setAttribute('aria-label', 'Main')
  document.body.append(rail)
  const top = document.createElement('div')
  top.id = 'tvtop'
  top.innerHTML = '<div class="tvt-clock"></div><div class="tvt-date"></div><div class="tvt-name">LocalHub</div>'
  document.querySelector('.page').prepend(top)

  // ── Layout: the TV's panel (its markup and styles, tv/ui/panel.js and panel.css), working the TV from here ──
  const panel = document.createElement('aside')
  panel.id = 'tvpanel'
  panel.setAttribute('aria-label', 'Layout')
  panel.innerHTML = '<div><div class="wpanel-title">Layout</div><div class="tvp-sub"></div><div class="wpanel-list"></div></div>'
  document.body.append(panel)
  const btn = document.createElement('button')
  btn.id = 'tvlayout'
  btn.className = 'tvround'
  btn.type = 'button'
  btn.title = 'Layout'
  btn.setAttribute('aria-label', 'Layout')
  btn.innerHTML = svg('<rect x="3.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2.2"/>')
  const mk = (id, label, d) => Object.assign(document.createElement('button'), { id, type: 'button', title: label, className: 'tvround', ariaLabel: label, innerHTML: svg(d) })
  const back = mk('tvback', 'Back', '<path d="M15 5l-7 7 7 7"/>')
  const filter = mk('tvfilter', 'Filter and sort', '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>')
  const controls = document.getElementById('controls')
  controls.prepend(back, btn, filter)
  back.addEventListener('click', () => document.querySelector('.hw-root.hw-edit [data-hw-act="edit"]')?.click())

  // Filter and sort, the TV's filter button.
  const menu = document.createElement('div')
  menu.id = 'tvmenu'
  document.body.append(menu)
  function paintMenu() {
    const it = (k, v, label) => `<button type="button" data-f="${k}:${v}"><span>${label}</span><span>${(look[k] || (k === 'show' ? 'all' : 'mine')) === v ? '✓' : ''}</span></button>`
    menu.innerHTML = '<h4>Show</h4>' + it('show', 'all', 'Apps and widgets') + it('show', 'apps', 'Apps') + it('show', 'widgets', 'Widgets') + '<h4>Sort apps</h4>' + it('sort', 'mine', 'My order') + it('sort', 'az', 'A to Z')
  }
  const closeMenu = () => { menu.classList.remove('on'); filter.classList.remove('on') }
  filter.addEventListener('click', () => {
    if (menu.classList.contains('on')) return closeMenu()
    paintMenu()
    const r = filter.getBoundingClientRect()
    menu.style.left = `${r.left}px`
    menu.style.top = `${r.bottom + 10}px`
    menu.classList.add('on')
    filter.classList.add('on')
    menu.querySelector('button').focus()
  })
  menu.addEventListener('click', e => { const f = e.target.closest('[data-f]')?.dataset.f; if (!f) return; const [k, v] = f.split(':'); look[k] = v; saveLook(); arrange(); paintMenu() })
  document.addEventListener('pointerdown', e => { if (!menu.contains(e.target) && !filter.contains(e.target)) closeMenu() })
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    if (menu.classList.contains('on')) { e.stopPropagation(); closeMenu(); filter.focus() }
  }, true)

  // The widget column: the weather, then Home's widgets, copied from where home.js draws them so its own clicks, edits
  // and updates work here (the column is inside .hw-root). The clock and date are already at the top left.
  let side = null, sideWatch = null, sideRoot = null
  function paintSide() {
    const root = document.querySelector('.hw-root')
    if (!root) return
    if (sideRoot !== root) {
      sideRoot = root
      sideWatch?.disconnect()
      side = document.createElement('div')
      side.id = 'tvside'
      side.setAttribute('role', 'list')
      side.setAttribute('aria-label', 'Widgets')
      root.append(side)
      sideWatch = new MutationObserver(() => { cancelAnimationFrame(paintSide.raf); paintSide.raf = requestAnimationFrame(() => { paintSide(); arrange(); fitRow() }) })
      sideWatch.observe(root.querySelector('.hw-pager'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-hw-key'] })
      new MutationObserver(() => { paintSide(); fitRow() }).observe(root, { attributes: true, attributeFilter: ['class', 'data-view'] })
    }
    const editing = root.classList.contains('hw-edit')
    const wx = look.weather && wxBody && window.HubWeatherCard ? `<div class="tvt-wx">${window.HubWeatherCard(wxBody, 'm')}</div>` : ''
    const cells = [...root.querySelectorAll('.hw-grid > .hw-cell:not(.a)')].filter(c => {
      const id = c.querySelector('[data-hw-widget], [data-hw-wid]')?.dataset.hwWidget || c.dataset.hwKey || ''
      return c.style.display !== 'none' && (editing || !/(^|-)(clock|date|weather)$/.test(id) || /world-clock$/.test(id))
    })
    const pl = P && TV?.on ? `<div class="tvp-card">${P.player(TV.state?.media || {}, true)}</div>` : ''
    const html = pl + wx + cells.map(c => c.outerHTML).join('')
    if (side._html === html) return
    const y = side.scrollTop
    side._html = html
    side.innerHTML = html
    side.scrollTop = y
    document.documentElement.toggleAttribute('data-noside', !html)
  }
  function arrange() {
    document.documentElement.dataset.tvshow = look.show || 'all'
    const cells = [...document.querySelectorAll('.hw-grid > .hw-cell.a')]
    const names = look.sort === 'az' ? cells.map(c => c.querySelector('.hw-app-l')?.textContent || '').sort((a, b) => a.localeCompare(b)) : null
    for (const c of cells) c.style.order = names ? names.indexOf(c.querySelector('.hw-app-l')?.textContent || '') : ''
  }
  // One row: the search box gives way first, then the buttons become icons.
  function fitRow() {
    const r = document.documentElement, bar = document.querySelector('.hw-root > .hw-bar')
    if (!bar || !r.hasAttribute('data-tvlook')) return
    r.removeAttribute('data-tight')
    r.removeAttribute('data-tighter')
    const used = () => bar.getBoundingClientRect().width + 14
    const room = controls.getBoundingClientRect().width - [...controls.querySelectorAll('.tvround')].reduce((n, b) => n + (b.offsetWidth ? b.offsetWidth + 12 : 0), 0)
    if (room - used() < 200) r.setAttribute('data-tight', '')
    if (room - used() < 130) r.setAttribute('data-tighter', '')
    const q = document.getElementById('q')
    if (q && document.querySelector('.hw-root') && q.placeholder !== 'Search') q.placeholder = 'Search'
    r.style.setProperty('--barw', `${Math.ceil(used())}px`)
    r.style.setProperty('--bartop', `${controls.offsetTop}px`)
  }
  addEventListener('resize', () => fitRow())
  const CLOCKS = ['Time and date', 'Time', 'Off']
  function applyLook() {
    top.querySelector('.tvt-clock').style.display = look.clock === 'Off' ? 'none' : ''
    top.querySelector('.tvt-date').style.display = look.clock === 'Time and date' ? '' : 'none'
    paintSide()
  }
  const saveLook = () => { try { localStorage.setItem(PREF, JSON.stringify(look)) } catch {} applyLook(); paintPanel() }
  let P = null, TV = null, dragging = null, poll = 0
  const post = c => fetch('/api/tv/command', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify(c) }).catch(() => {})
  const soon = () => { setTimeout(readTv, 900); setTimeout(readTv, 2000) }
  async function readTv() {
    try { const r = await fetch('/api/tv/status', { cache: 'no-store' }); TV = r.ok ? (await r.json()).tv : null } catch { TV = null }
    if (!dragging) paintPanel()
    paintSide()
  }
  function paintPanel() {
    if (!P) return
    const on = !!TV?.on, st = (on && TV.state) || {}
    panel.querySelector('.tvp-sub').textContent = on ? 'Your TV' : 'Your TV isn’t connected'
    const list = panel.querySelector('.wpanel-list')
    const html = P.player(on ? st.media || {} : {})
      + P.slider('brightness', st.brightness ?? 100, P.IC.sun, 'TV brightness', !on) + P.slider('volume', st.volume ?? 0, P.IC.vol, 'TV volume', !on || st.volume == null)
      + P.round('home', P.IC.home, 'TV home') + P.round('saver', P.IC.moon, 'Screensaver') + P.round('sleep', P.IC.power, 'Sleep') + P.round('settings', P.IC.gear, 'Settings')
      + (st.inputs || []).map(i => P.pill(`input:${i.name}`, P.IC.input, i.name, i.sub || 'Input')).join('')
      + P.pill('homeclock', P.IC.clock, 'Home clock', look.clock, look.clock !== 'Off') + P.pill('homeweather', P.IC.cloud, 'Home weather', look.weather ? 'On' : 'Off', look.weather)
      + `<div class="wpx">${wxBody && window.HubWeatherCard ? window.HubWeatherCard(wxBody, 'm') : '<div class="t2">Finding the weather…</div>'}</div>`
    if (list._html === html) return
    const had = document.activeElement?.closest?.('#tvpanel [data-w]')?.dataset.w
    list._html = html
    list.innerHTML = html
    list.querySelectorAll('[data-w]').forEach(n => { n.tabIndex = 0; if (n.tagName !== 'BUTTON') n.setAttribute('role', n.classList.contains('wps') ? 'slider' : 'button') })
    if (had) list.querySelector(`[data-w="${had}"]`)?.focus()
  }
  async function openPanel() {
    try { P ??= await import('/tv/panel.js?v=3') } catch { return }
    paintPanel()
    panel.classList.add('on')
    await readTv()
    if (TV?.on) post({ type: 'state' })
    soon()
    clearInterval(poll)
    poll = setInterval(() => { if (document.hidden) return; if (TV?.on) post({ type: 'state' }); setTimeout(readTv, 800) }, 6000)
  }
  // The player at the top right of Home is your TV's.
  document.addEventListener('click', e => { const b = e.target.closest('#tvside .mp-b'); if (b) { e.stopPropagation(); press(b.dataset.w) } }, true)
  let sideAt = 0
  async function keepTv() {
    if (document.hidden || !document.documentElement.hasAttribute('data-tvlook') || !document.querySelector('.hw-root') || Date.now() - sideAt < 8000) return
    sideAt = Date.now()
    try { P ??= await import('/tv/panel.js?v=3') } catch { return }
    if (TV?.on) post({ type: 'state' })
    await readTv()
  }
  function closePanel() { clearInterval(poll); panel.classList.remove('on'); if (panel.contains(document.activeElement)) btn.focus() }
  btn.addEventListener('click', e => { e.stopPropagation(); panel.classList.contains('on') ? closePanel() : openPanel() })
  document.addEventListener('pointerdown', e => { if (panel.classList.contains('on') && !panel.contains(e.target) && !btn.contains(e.target)) closePanel() })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('on')) { e.stopPropagation(); closePanel() } }, true)
  const off = () => { panel.querySelector('.tvp-sub').textContent = 'Your TV isn’t connected' }
  function press(id) {
    if (id === 'homeclock') { look.clock = CLOCKS[(CLOCKS.indexOf(look.clock) + 1) % CLOCKS.length]; return saveLook() }
    if (id === 'homeweather') { look.weather = !look.weather; return saveLook() }
    if (id === 'settings') { closePanel(); return openSettings() }
    if (!TV?.on) return off()
    if (id.startsWith('input:')) post({ type: 'input', name: id.slice(6) })
    else if (id === 'prev' || id === 'next') post({ type: 'media', action: id })
    else if (id === 'play') post({ type: 'media', action: 'toggle' })
    else if (['home', 'saver', 'sleep'].includes(id)) post({ type: id })
    soon()
  }
  panel.addEventListener('click', e => { const n = e.target.closest('[data-w]'); if (n && !n.classList.contains('wps')) press(n.dataset.w) })
  panel.addEventListener('keydown', e => {
    const n = e.target.closest('[data-w]')
    if (!n) return
    if (n.classList.contains('wps')) {
      const d = e.key === 'ArrowUp' ? 10 : e.key === 'ArrowDown' ? -10 : 0
      if (d) { e.preventDefault(); setSlide(n, (parseFloat(n.querySelector('i').style.height) || 0) + d, true) }
    } else if ((e.key === 'Enter' || e.key === ' ') && n.tagName !== 'BUTTON') { e.preventDefault(); press(n.dataset.w) }
  })
  function setSlide(n, v, send) {
    if (n.classList.contains('off')) return
    const id = n.dataset.w, val = Math.max(id === 'brightness' ? 20 : 0, Math.min(100, Math.round(v)))
    n.querySelector('i').style.height = `${val}%`
    if (!send) return
    if (TV?.state) TV.state[id] = val
    post({ type: id, value: val })
    soon()
  }
  const at = (n, e) => { const r = n.getBoundingClientRect(); return (1 - (e.clientY - r.top) / r.height) * 100 }
  panel.addEventListener('pointerdown', e => { const n = e.target.closest('.wps'); if (!n || n.classList.contains('off')) return; dragging = n; n.setPointerCapture(e.pointerId); setSlide(n, at(n, e), false) })
  panel.addEventListener('pointermove', e => { if (dragging) setSlide(dragging, at(dragging, e), false) })
  panel.addEventListener('pointerup', e => { if (dragging) { const n = dragging; dragging = null; setSlide(n, at(n, e), true) } })
  panel.addEventListener('pointercancel', () => { dragging = null })

  // ── Your TV, driven from here: its screen as it is (tv/ui/mirror.js sends it) and the remote's keys, sent to it ──
  const mirror = document.createElement('section')
  mirror.id = 'tvmirror'
  mirror.tabIndex = -1
  mirror.setAttribute('aria-label', 'Your TV')
  const mb = (k, label, d) => `<button type="button" class="tvm-b" data-key="${k}" title="${label}" aria-label="${label}">${svg(d)}</button>`
  mirror.innerHTML = `<div class="tvm-head">${mb('leave', 'Back to LocalHub', '<path d="M15 5l-7 7 7 7"/>')}Your TV<span>Arrow keys move · Enter opens · Esc goes back · click anything · type in a text box</span>${mb('back', 'Back on the TV', '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>')}${mb('home', 'TV home', IC.home)}${mb('sleep', 'Put the TV to sleep', '<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>')}</div><div class="tvm-fit"><div class="tvm-screen"><iframe title="Your TV" sandbox="allow-same-origin" tabindex="-1"></iframe><div class="tvm-cover"></div><div class="tvm-note">Connecting to your TV…</div></div></div>`
  document.body.append(mirror)
  const mFrame = mirror.querySelector('iframe'), mNote = mirror.querySelector('.tvm-note'), mScreen = mirror.querySelector('.tvm-screen')
  let mBeat = 0, mRun = 0, mSeen = 0, mTimer = 0
  const note = s => { mNote.hidden = !s; mNote.textContent = s }
  function fitMirror() {
    const b = mirror.querySelector('.tvm-fit').getBoundingClientRect(), w = Math.min(b.width, b.height * 16 / 9)
    mScreen.style.width = `${w}px`
    mScreen.style.height = `${w * 9 / 16}px`
    mFrame.style.transform = `scale(${w / 1920})`
  }
  async function frameCss() {
    // The TV page's own stylesheets, from the same list it uses. No scripts run in here (sandbox).
    const page = await (await fetch('/tv/', { cache: 'no-store' })).text()
    const css = [...page.matchAll(/<link rel="stylesheet" href="\.\/([\w.?=-]+)">/g)].map(m => `<link rel="stylesheet" href="/tv/${m[1]}">`).join('')
    await new Promise(done => { mFrame.onload = done; mFrame.srcdoc = `<!doctype html><html><head><base href="/tv/">${css}<style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#000}#stage{left:0!important;top:0!important;transform:none!important}*{transition:none!important;animation:none!important;cursor:pointer!important}#hub-wall{display:block!important;position:absolute;inset:0;z-index:0;background:#000 center/cover;--hub-scrim:.22}#hub-wall::after{background:#000!important}</style></head><body></body></html>` })
  }
  async function watch(run) {
    let n = 0
    while (run === mRun) {
      try {
        const r = await fetch(`/api/tv/mirror?after=${n}`, { cache: 'no-store' })
        if (run !== mRun) return
        if (r.status !== 200) { await new Promise(w => setTimeout(w, r.status === 204 ? 50 : 2000)); continue }
        const m = await r.json()
        n = m.n
        if (!m.html || Date.now() - m.at > 15_000) continue // from an earlier time
        mSeen = Date.now()
        const d = mFrame.contentDocument
        const [hc, bc] = m.cls.split('|')
        d.documentElement.className = hc
        d.documentElement.style.setProperty('--k', '1')
        d.body.className = bc || ''
        d.body.innerHTML = `<div id="hub-wall"></div>${m.html.replace(/ on[a-z]+="[^"]*"/g, '')}`
        if (m.wall) d.getElementById('hub-wall').style.backgroundImage = `url("${m.wall.replace(/["\\\n]/g, '')}")`
        note(m.away ? 'Another app is open on the TV. Press TV home to come back to LocalHub.' : m.stream ? 'The TV’s browser is open. The arrow keys still work in it.' : '')
      } catch { await new Promise(w => setTimeout(w, 1500)) }
    }
  }
  async function openMirror() {
    if (mirror.classList.contains('on')) return
    closeSettings()
    closePanel()
    window.HubChat?.close()
    mirror.classList.add('on')
    mirror.focus()
    fitMirror()
    setTimeout(paintRail, 60)
    note('Connecting to your TV…')
    const run = ++mRun
    mSeen = 0
    await readTv()
    if (run !== mRun) return
    if (!TV?.on) note('Your TV isn’t connected. Open LocalHub on it, and it shows here.')
    try { await frameCss() } catch { return note('The TV’s page didn’t load') }
    if (run !== mRun) return
    const beat = () => post({ type: 'mirror', on: true })
    beat()
    mBeat = setInterval(() => { if (!document.hidden) beat() }, 4000)
    mTimer = setInterval(() => { if (!mSeen) readTv().then(() => { if (run === mRun && !mSeen) note(TV?.on ? 'Connecting to your TV…' : 'Your TV isn’t connected. Open LocalHub on it, and it shows here.') }) }, 5000)
    watch(run)
  }
  function closeMirror() {
    if (!mirror.classList.contains('on')) return
    mRun++
    clearInterval(mBeat)
    clearInterval(mTimer)
    post({ type: 'mirror', on: false })
    mirror.classList.remove('on')
    setTimeout(paintRail, 60)
  }
  const MKEY = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'enter', Escape: 'back', BrowserBack: 'back', ContextMenu: 'menu', PageUp: 'rew', PageDown: 'ff', MediaPlayPause: 'ai' }
  mirror.addEventListener('click', e => {
    const k = e.target.closest('[data-key]')?.dataset.key
    if (k === 'leave') return closeMirror()
    if (k === 'sleep') post({ type: 'sleep' })
    else if (k) post({ type: 'key', name: k })
    else if (e.target.closest('.tvm-cover')) { const r = mScreen.getBoundingClientRect(); post({ type: 'tap', x: (e.clientX - r.left) / r.width * 1920, y: (e.clientY - r.top) / r.height * 1080 }) }
    mirror.focus()
  })
  mirror.addEventListener('wheel', e => { e.preventDefault(); const now = Date.now(); if (now - (mirror._w || 0) < 160) return; mirror._w = now; post({ type: 'key', name: e.deltaY > 0 ? 'down' : 'up' }) }, { passive: false })
  document.addEventListener('keydown', e => {
    if (!mirror.classList.contains('on') || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target.closest?.('.tvm-b') && (e.key === 'Enter' || e.key === ' ')) return
    const name = MKEY[e.key]
    if (!name && e.key !== 'Backspace' && e.key.length !== 1) return
    e.preventDefault()
    e.stopPropagation()
    post(name ? { type: 'key', name } : { type: 'type', text: e.key === 'Backspace' ? '\b' : e.key })
  }, true)
  addEventListener('resize', () => { if (mirror.classList.contains('on')) fitMirror() })
  document.addEventListener('click', e => { if (e.target.closest('[data-hw-takeover]')) { e.stopPropagation(); openMirror() } }, true)
  // The old TV link (/#tv and the like) and a saved device view come back to Home.
  const toDesktop = () => { const r = document.querySelector('.hw-root'); if (r && document.documentElement.hasAttribute('data-tvlook') && r.dataset.view !== 'desktop' && r.dataset.phone !== '1') r.querySelector('[data-hw-mode="desktop"]')?.click() }

  // The name of what you're on, large above the row, as on the TV.
  const nameEl = top.querySelector('.tvt-name')
  const setName = e => { const c = e.target.closest?.('.hw-grid .hw-cell.a'); nameEl.textContent = c?.querySelector('.hw-app-l')?.textContent || 'LocalHub' }
  document.addEventListener('pointerover', setName, { passive: true })
  document.addEventListener('focusin', setName)

  // Where you were in each tab comes back with it.
  const spots = {}
  const spotKey = () => [...seg.querySelectorAll('button[data-env]')].find(isOn)?.dataset.env || 'home'
  let homeY = 0, homePager = null
  document.addEventListener('scroll', e => {
    if (e.target?.classList?.contains('hw-pager')) { if (homePager === e.target) homeY = e.target.scrollTop }
    else if (e.target === document) { const k = spotKey(); if (k !== 'home') spots[k] = { y: scrollY, at: document.getElementById('title')?.textContent } }
  }, { capture: true, passive: true })
  function keepSpots() {
    const p = document.querySelector('.hw-root .hw-pager')
    if (p !== homePager) { homePager = p; if (p && homeY) requestAnimationFrame(() => { p.scrollTop = homeY }) }
  }
  let spotEnv = ''
  new MutationObserver(() => {
    const k = spotKey()
    if (k === spotEnv) return
    spotEnv = k
    keepSpots()
    const s = spots[k]
    if (!s || k === 'home') return
    let tries = 20
    const back = () => { if (spotKey() !== k) return; if (document.getElementById('title')?.textContent === s.at && document.documentElement.scrollHeight >= s.y + innerHeight - 4) scrollTo(0, s.y); else if (tries--) setTimeout(back, 100) }
    back()
  }).observe(seg, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] })

  // ── Settings: a page of rows, as on the TV ──
  const set = document.createElement('section')
  set.id = 'tvset'
  set.setAttribute('aria-label', 'Settings')
  document.body.append(set)
  let picking = null, listen = null, version = '', setHtml = ''
  const H = () => window.HUB
  const devLook = d => ({ wallpaper: '', saver: 0, show: 'photos', ...(H()?.settings.look?.[d] || {}) })
  const walls = () => {
    const w = H()?.settings.wallpaper || {}, built = window.HUB_CONF?.theme?.wallpapers || []
    return [
      { id: '', name: 'Shared', css: '' }, { id: 'none', name: 'None', css: '' },
      ...built.map(b => ({ id: b.id, name: b.name, css: `url("${['aurora', 'dusk', 'graphite', 'ocean', 'sand'].includes(b.id) ? `/tv/photos/thumbs/${b.id}.jpg` : `/wallpapers/${b.id}.svg`}")` })),
      ...(w.custom || []).map(g => ({ id: g.id, name: g.name, css: `linear-gradient(${Number(g.angle) || 0}deg, ${g.colors.join(', ')})` })),
      ...(w.uploads || []).map(u => ({ id: u.id, name: u.name, css: `url("/api/hub/wallpapers/${u.file}")` })),
    ]
  }
  const wallName = d => { const id = devLook(d).wallpaper; return id ? walls().find(w => w.id === id)?.name || 'Shared' : 'Shared' }
  const MIN = [0, 2, 5, 10, 15], mins = n => (n ? `${n} min` : 'Off')
  const DEVS = { desktop: 'Desktop', mobile: 'Mobile' }
  const THEMES = { auto: 'Dark', dark: 'Dark', light: 'Light' }
  function rows() {
    const st = H()?.settings.style || {}
    const dev = d => [
      { id: `wall:${d}`, t1: `${DEVS[d]} background`, t2: d === 'mobile' ? 'On a phone' : 'On a computer or iPad', v: wallName(d) },
      { id: `saver:${d}`, t1: `${DEVS[d]} screensaver`, t2: 'After it has been left alone', v: mins(devLook(d).saver), on: !!devLook(d).saver },
      { id: `show:${d}`, t1: `${DEVS[d]} screensaver shows`, t2: 'The photos you chose for the TV, or the background', v: devLook(d).show === 'photos' ? 'Photos' : 'Background' },
    ]
    return [
      { group: 'Home Screen' },
      { id: 'clock', t1: 'Home clock', t2: 'What the top left of Home shows', v: look.clock, on: look.clock !== 'Off' },
      { id: 'weather', t1: 'Home weather', t2: 'At the top right', v: look.weather ? 'On' : 'Off', on: look.weather },
      { id: 'edit', t1: 'Apps and widgets', t2: 'Pick what is on Home and where', v: '' },
      { id: 'tabs', t1: 'Sidebar', t2: 'Which tabs show, and their order', v: '' },
      { group: 'Background and Screensaver' }, ...dev('desktop'), ...dev('mobile'),
      { group: 'Look' },
      { id: 'theme', t1: 'Theme', t2: 'Light is the hub’s older look', v: THEMES[st.theme] || 'Dark' },
      { id: 'style', t1: 'Accent, font and wallpapers', t2: 'The style editor, and adding your own pictures', v: '' },
      { group: 'Assistant' },
      ...(listen ? [{ id: 'listen', t1: 'Hey LocalHub', t2: 'This computer’s microphone listens for it', v: listen.on ? 'On' : 'Off', on: listen.on }] : []),
      ...(window.HUB_CONNECTIONS ? [{ id: 'connections', t1: 'Connections', t2: 'The services the assistant can use', v: '' }] : []),
      { group: 'TV' },
      { id: 'panel', t1: 'Your TV', t2: 'Its player, brightness, volume and more', v: TV?.on ? 'Connected' : 'Not connected', on: !!TV?.on },
      { id: 'tvsetup', t1: 'Set up a TV', t2: 'Put LocalHub TV on a television and pair it', v: '' },
      { group: 'About' },
      { id: 'setup', t1: 'Set up LocalHub', t2: 'trylocalhub.com/setup', v: '' },
      { info: true, t1: 'Version', t2: 'LocalHub on this computer', v: version || '' },
    ]
  }
  function paintSettings() {
    if (!set.classList.contains('on')) return
    const backB = `<button type="button" data-set="back" aria-label="Back">${svg('<path d="M15 5l-7 7 7 7"/>')}</button>`
    const list = picking
      ? `<div class="tvs-title">${backB}${DEVS[picking]} background</div><div class="tvs-walls">${walls().map(w => `<button type="button" class="tvs-wall${devLook(picking).wallpaper === w.id ? ' on' : ''}" data-wall="${esc(w.id)}"><i style="background-image:${esc(w.css)}"></i><span>${esc(w.name)}</span></button>`).join('')}</div>`
      : `<div class="tvs-title">${backB}Settings</div>` + rows().map(r => r.group ? `<div class="tvs-group">${esc(r.group)}</div>` : `<${r.info ? 'div' : 'button type="button"'} class="tvs-row"${r.id ? ` data-set="${esc(r.id)}"` : ''}><div class="txt"><div class="t1">${esc(r.t1)}</div><div class="t2">${esc(r.t2)}</div></div><div class="v${r.on ? ' on' : ''}">${esc(r.v)}</div></${r.info ? 'div' : 'button'}>`).join('')
    const html = `<div class="tvs-art"><img src="/icons/hub.svg" alt=""><p>LocalHub on this computer</p></div><div class="tvs-list">${list}</div>`
    if (setHtml === html) return
    const y = set.querySelector('.tvs-list')?.scrollTop || 0, f = document.activeElement?.dataset?.set
    setHtml = html
    set.innerHTML = html
    set.querySelector('.tvs-list').scrollTop = y
    if (f) set.querySelector(`[data-set="${CSS.escape(f)}"]`)?.focus()
  }
  async function readAbout() {
    try { const s = await (await fetch('/api/tv/status', { cache: 'no-store' })).json(); TV = s.tv; listen = s.listen; version = s.version } catch {}
    paintSettings()
  }
  function openSettings() {
    picking = null
    setHtml = ''
    window.HubChat?.close()
    set.classList.add('on')
    paintSettings()
    readAbout()
    setTimeout(paintRail, 60)
  }
  function closeSettings() { set.classList.remove('on'); setTimeout(paintRail, 60) }
  const saveDev = async (d, patch) => { try { await H().patch({ look: { [d]: patch } }) } catch (e) { alert(e.message) } paintSettings() }
  async function onSet(id) {
    if (id === 'back') { if (picking) { picking = null; return paintSettings() } return closeSettings() }
    const [k, d] = id.split(':')
    if (k === 'wall') { picking = d; set.querySelector('.tvs-list').scrollTop = 0; return paintSettings() }
    if (k === 'saver') return saveDev(d, { saver: MIN[(MIN.indexOf(devLook(d).saver) + 1) % MIN.length] })
    if (k === 'show') return saveDev(d, { show: devLook(d).show === 'photos' ? 'background' : 'photos' })
    if (id === 'clock') { look.clock = CLOCKS[(CLOCKS.indexOf(look.clock) + 1) % CLOCKS.length]; saveLook(); return paintSettings() }
    if (id === 'weather') { look.weather = !look.weather; saveLook(); return paintSettings() }
    if (id === 'theme') { H().save({ style: { theme: 'light' } }); return }
    if (id === 'listen') {
      try { const r = await fetch('/api/tv/listen', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ on: !listen.on }) }); if (r.ok) listen = { ...listen, on: !listen.on } } catch {}
      return paintSettings()
    }
    closeSettings()
    if (id === 'edit') goHome('.hw-root:not(.hw-edit) [data-hw-act="edit"]')
    else if (id === 'tabs') H()?.openTabs()
    else if (id === 'style') H()?.openStyle()
    else if (id === 'connections') window.HUB_CONNECTIONS?.()
    else if (id === 'panel') { seg.querySelector('[data-env="home"]')?.click(); openPanel() }
    else if (id === 'tvsetup') { location.hash = ''; location.hash = '#tv-setup' }
    else if (id === 'setup') window.open('https://trylocalhub.com/setup', '_blank', 'noopener')
  }
  set.addEventListener('click', e => {
    const w = e.target.closest('[data-wall]')
    if (w && picking) return saveDev(picking, { wallpaper: w.dataset.wall })
    const s = e.target.closest('[data-set]')
    if (s) onSet(s.dataset.set)
  })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && set.classList.contains('on')) { e.stopPropagation(); onSet('back') } }, true)

  // ── Screensaver: the TV's photos (or the background) with the time, when this device has been left alone ──
  const PHONE = matchMedia('(max-width: 700px)')
  let still = Date.now(), saver = null, saverTimer = 0
  async function startSaver() {
    if (saver) return
    saver = document.createElement('div')
    saver.id = 'hubsaver'
    saver.innerHTML = '<i></i><i></i><div><b></b><span></span></div>'
    document.body.append(saver)
    const mine = saver, d = devLook(PHONE.matches ? 'mobile' : 'desktop')
    let pics = [getComputedStyle(document.getElementById('hub-wall')).backgroundImage].filter(x => x && x !== 'none')
    if (d.show === 'photos') try { const r = await (await fetch('/api/tv/saver', { cache: 'no-store' })).json(); if (r.photos?.length) pics = r.photos.map(p => `url("${p.url}")`) } catch {}
    if (saver !== mine) return
    let n = Math.floor(Math.random() * Math.max(1, pics.length)), side = 0
    const turn = () => { const [a, b] = [mine.children[side], mine.children[1 - side]]; if (pics.length) a.style.backgroundImage = pics[n++ % pics.length]; a.classList.add('on'); b.classList.remove('on'); side = 1 - side }
    const time = () => { const t = new Date(); mine.querySelector('b').textContent = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); mine.querySelector('span').textContent = t.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) }
    turn()
    time()
    requestAnimationFrame(() => mine.classList.add('on'))
    let k = 0
    saverTimer = setInterval(() => { time(); if (pics.length > 1 && ++k % 12 === 0) turn() }, 1000)
  }
  function stir(e) {
    still = Date.now()
    if (!saver) return
    e?.preventDefault?.()
    e?.stopPropagation?.()
    clearInterval(saverTimer)
    const s = saver
    saver = null
    s.classList.remove('on')
    setTimeout(() => s.remove(), 600)
  }
  let lastAt = ''
  addEventListener('pointermove', e => { const at = `${e.screenX},${e.screenY}`; if (at === lastAt) return; lastAt = at; stir() }, { passive: true })
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, stir, true)
  for (const ev of ['wheel', 'touchstart']) addEventListener(ev, () => stir(), { passive: true, capture: true })
  setInterval(() => {
    if (saver || window.parent !== window) return
    const min = devLook(PHONE.matches ? 'mobile' : 'desktop').saver
    // Not while you're in a page shown inside the hub, a video plays, or the assistant is busy or listening.
    if (!min || document.hidden || document.activeElement?.tagName === 'IFRAME' || window.HubChat?.busy?.() || window.HubChat?.listening?.() || [...document.querySelectorAll('video')].some(v => !v.paused)) { if (min && !document.hidden) still = Math.max(still, Date.now() - min * 30_000); return }
    if (Date.now() - still > min * 60_000) startSaver()
  }, 5000)
  window.HubSaver = { start: startSaver, stop: stir }

  // The sidebar follows the tab bar, which stays the one list of tabs (it's hidden, its buttons still work).
  function paintRail() {
    const chat = !!window.HubChat?.isOpen?.()
    const tabs = [...seg.querySelectorAll('button[data-env]')].filter(b => !b.hidden && b.style.display !== 'none')
    const item = (key, ic, label, on) => `<button type="button" data-rail="${esc(key)}" class="${on ? 'on' : ''}" aria-label="${esc(label)}"${on ? ' aria-current="page"' : ''}>${svg(IC[ic])}<span>${esc(label)}</span></button>`
    const name = b => (b.firstChild?.textContent || b.textContent).trim()
    const html = '<img src="/icons/hub.svg" alt=""><div class="mid">'
      + tabs.map(b => item(`tab:${b.dataset.env}`, TAB_IC[b.dataset.env] || 'tab', name(b), isOn(b) && !chat && !set.classList.contains('on') && !mirror.classList.contains('on'))).join('')
      + item('assistant', 'mic', 'Assistant', chat && !set.classList.contains('on')) + item('tv', 'tv', 'TV', mirror.classList.contains('on'))
      + '</div>' + item('settings', 'gear', 'Settings', set.classList.contains('on'))
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
    closePanel()
    if (key !== 'settings') closeSettings()
    if (key !== 'tv') closeMirror()
    if (key !== 'assistant') window.HubChat?.close()
    if (key.startsWith('tab:')) {
      seg.querySelector(`[data-env="${CSS.escape(key.slice(4))}"]`)?.click()
      if (key === 'tab:home') document.querySelector('[data-hw-mode="desktop"]')?.click()
    } else if (key === 'assistant') window.HubChat?.open()
    else if (key === 'tv') openMirror()
    else if (key === 'settings') openSettings()
    setTimeout(paintRail, 60)
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
      if (r.ok) { wxBody = await r.json(); paintSide(); paintPanel() }
    } catch {}
  }
  paintRail()
  applyLook()
  tick()
  weather()
  window.HUB?.on?.(() => paintSettings())
  setInterval(() => { tick(); weather(); paintRail(); paintSide(); arrange(); fitRow(); toDesktop(); keepSpots(); keepTv() }, 1000)
})()
