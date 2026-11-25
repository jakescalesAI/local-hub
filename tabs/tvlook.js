// The TV's look on a computer: the photo wallpaper, the sidebar, the big clock, the weather, round buttons and solid
// dark cards (tv/ui/styles.css is where they come from). custom.js puts data-tvlook on <html> when the window is wide,
// has a mouse and Edit Style isn't set to Light, and data-tvtouch on a phone or an iPad; Light is as before.
;(() => {
  const R = 'html[data-tvlook]'
  const T = 'html[data-tvtouch]'
  const A = ':is(html[data-tvlook], html[data-tvtouch])' // both
  const css = document.createElement('style')
  css.textContent = `
#tvrail, #tvtop { display: none; }
/* The colours are theme.css's; here they're given to the hub's own names, so every tab, menu and sheet follows. */
:root:is([data-tvlook], [data-tvtouch])[data-theme] { --ui-u: .5px; --ui-edge: inset 0 0 0 1px rgba(255, 255, 255, .1); --tvrail: 92px; scrollbar-gutter: auto;
  --bg: var(--chat-bg); --surface: var(--ui-panel); --surface-2: var(--ui-fill); --press: #34353c; --fill: rgba(255, 255, 255, .08); --fill-2: rgba(255, 255, 255, .14);
  --sep: rgba(255, 255, 255, .1); --menu-bg: var(--ui-panel); --material: rgba(17, 18, 22, .94); --thumb: var(--ui-sel); --sheen: rgba(255, 255, 255, .06); }
${R} .nav.scrolled::after { display: none; }
${A} :is(.hc-panel, .menu) { background: var(--ui-panel) !important; box-shadow: var(--ui-edge), 0 24px 60px rgba(0, 0, 0, .5) !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }

${A} #tvpanel { position: fixed; z-index: 60; top: 0; right: 0; bottom: 0; width: 418px; overflow-y: auto; scrollbar-width: none; background: var(--ui-panel); border-radius: 26px 0 0 26px; box-shadow: inset 1px 0 0 rgba(255, 255, 255, .1), -30px 0 80px rgba(0, 0, 0, .45); color: #fff; transform: translateX(105%); visibility: hidden; transition: transform .28s var(--ease), visibility 0s .28s; }
${A} #tvpanel.on { transform: none; visibility: visible; transition: transform .28s var(--ease); }
${A} #tvpanel > div { zoom: .55; padding: 56px 48px; }
${A} #tvpanel [data-w] { cursor: pointer; touch-action: none; }
${A} #tvpanel .wpanel-title { display: flex; align-items: center; justify-content: space-between; } ${A} #tvpanel .wpanel-title button { display: grid; place-items: center; width: 76px; height: 76px; border-radius: 50%; background: var(--ui-fill); box-shadow: var(--ui-edge); } ${A} #tvpanel .wpanel-title button:hover { background: var(--ui-sel); color: #000; } ${A} #tvpanel .wpanel-title svg { width: 34px; height: 34px; }
${A} #tvpanel .mp.wide { grid-column: 1 / -1; position: relative; overflow: hidden; isolation: isolate; background: var(--ui-fill); } ${A} #tvpanel .wps { height: 354px; }
${A} #tvpanel .wpp { height: auto; min-height: 112px; padding: 16px 24px; gap: 16px; border-radius: 46px; } ${A} #tvpanel .wpp .grow { overflow: hidden; } ${A} #tvpanel .wpp .t1 { line-height: 1.2; overflow-wrap: anywhere; } ${A} #tvpanel .wpp .t2 { line-height: 1.25; white-space: normal; } ${A} #tvpanel .wpr em { white-space: normal; margin: 10px -6px 0; line-height: 1.15; overflow-wrap: anywhere; } ${A} #tvpanel .wph { margin: 18px 8px -4px; } ${A} #tvpanel .wpn { grid-column: 1 / -1; margin: -8px 10px 0; font-size: 22px; color: rgba(255, 255, 255, .6); }
${A} #tvpanel .wpq { grid-column: span 2; display: grid; grid-template-columns: 1fr 1fr; gap: 22px 24px; align-content: space-between; }
/* Docked: the page makes room, and nothing in it is covered. */
${R} { --dock: 0px; } ${R}[data-dock] { --dock: 418px; }
${R} .page, ${R} #tvmirror.on, ${R} #tvset.on { transition: padding .28s var(--ease), right .28s var(--ease); }
${R}[data-dock] .page { padding-right: calc(var(--dock) + 40px) !important; } ${R}[data-dock] #tvside { display: none !important; }
${R}[data-dock] #tvmirror.on, ${R}[data-dock] #tvset.on { right: var(--dock); } ${R}[data-dock] .bw-scrim { right: var(--dock) !important; }
${R}[data-dock] #tvset.on { grid-template-columns: minmax(120px, 22%) minmax(0, 1fr); } ${R}[data-dock] .tvs-art img { width: 110px; height: 110px; border-radius: 25px; } ${R}[data-dock] .tvs-list { padding-right: 32px; }
${R}[data-dock] .hw-root:not(.hw-edit) > #dk { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)) !important; } ${R}[data-dock] .tvt-name { max-width: 100%; }
@media (max-width: 1250px) { ${R}[data-dock] { --dock: 380px; } ${R}[data-dock] #tvpanel { width: 380px; } ${R}[data-dock] #tvpanel > div { zoom: .5; } }
${A} #tvpanel :is(.mp-b, .wpp):hover, ${A} #tvpanel .wpr:hover b { background: var(--ui-sel); color: #000; }
${A} #tvpanel .wpp:hover .t2 { color: rgba(0, 0, 0, .55); }
${A} #tvpanel .wps:hover { box-shadow: 0 0 0 5px rgba(255, 255, 255, .35); }
${A} #tvpanel :focus-visible { outline: 5px solid #0a84ff; outline-offset: 4px; }
#tvpanel { display: none; } .tvround { display: none; }
${A} #tvpanel { display: block; }
${A} #hub-wall::after { background: linear-gradient(90deg, rgba(0, 0, 0, .35), rgba(0, 0, 0, .08) 60%), rgba(0, 0, 0, .18); opacity: 1; }
${A}:not([data-wall]) body { background: #0b0b0e; }
${R} .page { max-width: 1500px; padding-left: calc(var(--tvrail) + 48px); padding-right: 48px; }
${R} .nav { pointer-events: none; }
${R} .nav-in { max-width: 1500px; padding-left: calc(var(--tvrail) + 48px); padding-right: 48px; }
${R} .nav-in button { pointer-events: auto; }
${A} .bar-btn { color: #fff; }
${R} #tvrail { position: fixed; z-index: 12; left: 0; top: 0; bottom: 0; width: var(--tvrail); display: flex; flex-direction: column; align-items: center; padding: 26px 0; background: rgba(17, 18, 22, .86); border-radius: 0 26px 26px 0; box-shadow: inset -1px 0 0 rgba(255, 255, 255, .1); color: #fff; }
${R} #tvrail img { width: 44px; height: 44px; border-radius: 12px; }
${R} #tvrail .mid { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 10px; }
${R} #tvrail button { position: relative; width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; color: rgba(255, 255, 255, .72); transition: background .15s, color .15s; }
${R} #tvrail svg { width: 27px; height: 27px; }
${R} #tvrail button:hover { background: var(--ui-fill); color: #fff; }
${R} #tvrail button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
${R} #tvrail button.on { color: #fff; }
${R} #tvrail button.on::after { content: ""; position: absolute; bottom: 3px; width: 26px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, .5); }
${R} #tvrail button span { display: none; }
#tvback2 { display: none; } ${R} #tvback2 { display: block; position: fixed; z-index: 11; left: 0; top: 0; bottom: 0; width: calc(var(--tvrail) + 40px); background: var(--chat-bg); opacity: 0; pointer-events: none; } ${R}[data-cover] #tvback2 { opacity: 1; }
${R}[data-cover]:not(:has(#tvpanel.on)) { overflow: hidden !important; scrollbar-width: none; }
${R}[data-cover] #tvrail { background: #111216; }
${R} .bw-scrim { left: var(--tvrail) !important; box-shadow: none !important; }
#tvtip { display: none; } ${R} #tvtip { display: block; position: fixed; z-index: 190; left: calc(var(--tvrail) + 12px); padding: 9px 16px; border-radius: 99px; background: var(--ui-sel); color: #000; font-size: 15px; font-weight: 600; white-space: nowrap; pointer-events: none; opacity: 0; transform: translate(-6px, -50%); transition: opacity .12s, transform .12s; box-shadow: 0 10px 30px rgba(0, 0, 0, .45); } ${R} #tvtip.on { opacity: 1; transform: translate(0, -50%); }
${R} #tvrail button b.old { position: absolute; left: 66px; padding: 7px 14px; border-radius: 99px; background: var(--ui-panel); box-shadow: var(--ui-edge); font-size: 14px; font-weight: 600; white-space: nowrap; opacity: 0; pointer-events: none; transform: translateX(-4px); transition: opacity .15s, transform .15s; }
${R} #seg-scroll { display: none; }
${A} .large-title { font-size: 52px; font-weight: 700; letter-spacing: -.03em; line-height: 1.1; }
${R}:has(.hw-root) .head, ${R}:has(.hw-root) .nav { display: none; }
${A} .tvt-clock { font: 700 76px/1 var(--display); letter-spacing: -.035em; font-variant-numeric: tabular-nums; white-space: nowrap; }
${A} .tvt-date { margin-top: 10px; font: 600 24px/1.2 var(--display); color: rgba(255, 255, 255, .9); }
${A} .tvt-wx .wxw { font-size: 13px; }
${A} .search input { height: 56px; padding: 0 44px 0 26px; border-radius: 28px; background: var(--ui-fill) !important; box-shadow: var(--ui-edge); font-size: 18px; font-weight: 600; -webkit-backdrop-filter: none; backdrop-filter: none; }
${A} .search input:focus { box-shadow: 0 0 0 3px #fff; }
${A} .search .clear { right: 18px; }
${A} .seg, ${A} .seg.hw-seg { background: var(--ui-fill) !important; box-shadow: var(--ui-edge); border-radius: 99px; padding: 4px; -webkit-backdrop-filter: none; backdrop-filter: none; }
${A} .seg-thumb { top: 4px; bottom: 4px; left: 4px; width: calc((100% - 8px) / var(--n, 3)); border-radius: 99px; background: var(--ui-sel); }
${A} .seg button { height: 34px; border-radius: 99px; font-size: 14px; font-weight: 600; }
${A} .seg button:is([aria-pressed="true"], [aria-selected="true"], [aria-checked="true"], [aria-current], .on) { color: #000; }
${A} .hw-bar .hw-btn:not(.solid), ${A} .hw-btn, ${A} .hw-pill { height: 42px; padding: 0 20px; border-radius: 99px; background: var(--ui-fill); box-shadow: var(--ui-edge); color: #fff; -webkit-backdrop-filter: none; backdrop-filter: none; }
${A} .hw-bar .hw-btn:not(.solid):hover, ${A} .hw-pill:hover { background: var(--ui-sel); color: #000; }
${A} .hw-btn.solid { background: var(--ui-sel); color: #000; }
${A} .hw-btn.red { color: var(--red) !important; }
${A} :is(.hw-card, .widget, .list, .hw-page) { background: var(--ui-panel) !important; box-shadow: var(--ui-edge) !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
${A} :is(.hw-card, .widget) { border-radius: 26px; }
${A} .list { border-radius: 22px; }
${R} .hw-page[aria-selected="true"] { background: var(--ui-sel) !important; color: #000; }
${R} .hw-card.live:hover { transform: scale(1.03); }
${R} .hw-app-b { transition: transform .2s var(--ease); }
${R} .hw-app-b:hover { transform: scale(1.06); }
${R} .hw-app-b:hover > .hc-app { background: var(--ui-sel) !important; color: #000 !important; }
${R} .hw-app-l { font-weight: 600; text-shadow: 0 1px 4px rgba(0, 0, 0, .7); }

/* ── Home: the clock, one row of buttons, then your apps; widgets in a column at the top right ── */
/* The widgets have the right half, the clock and the name the left. */
${R} { --side: calc((min(100vw, 1500px) - var(--tvrail) - 96px) / 2 - 16px); --sidegap: 32px; }
${R}:has(.hw-root) .page { position: relative; padding-right: 48px; }
${R}:has(.hw-root:is([data-view="tv"], [data-view="ipad"], [data-view="mobile"])) .page, ${R}[data-noside]:has(.hw-root) .page { padding-right: 48px; }
/* The TV's own proportions: the clock at the top, the name of what you're on above the row, the row three fifths down. */
${R}:has(.hw-root) #tvtop { display: flex; flex-direction: column; box-sizing: border-box; height: max(250px, 63vh); padding: 36px 0 22px; margin: 0; color: #fff; pointer-events: none; }
${R} .tvt-name { margin-top: auto; max-width: calc(100% - var(--side) - 20px); font: 700 clamp(44px, 5.4vw, 92px)/1.05 var(--display); padding: .06em .06em .2em 0; margin-bottom: -.2em; min-height: 1.31em; box-sizing: border-box; letter-spacing: -.035em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 2px 14px rgba(0, 0, 0, .35); }
@media (max-height: 620px) { ${R}:has(.hw-root) #tvtop { height: 150px; } ${R} .tvt-name { display: none; } }
${R} .controls { margin-bottom: 26px; top: 12px; }
${R}:has(.hw-root) .controls { position: relative; top: 0; z-index: 12; min-height: 56px; padding-right: var(--barw, 0px); gap: 12px; }
${R} .search { max-width: 520px; }
${R} .page:has(.hw-root) .search { flex: 1 1 120px; min-width: 120px; max-width: none; }
${R} .hw-root > .hw-bar { position: absolute; z-index: 13; top: var(--bartop, 0px); right: 48px; height: 56px; margin: 0; flex-wrap: nowrap; gap: 10px; }
${R} .hw-root:is([data-view="tv"], [data-view="ipad"], [data-view="mobile"]) > .hw-bar, ${R}[data-noside] .hw-root > .hw-bar { right: 48px; }
${R} .hw-root.hw-edit > .hw-bar { left: auto; }
/* Edit Home: a page of its own. */
${R}[data-editing] #tvtop { height: 118px !important; padding-top: 40px !important; } ${R}[data-editing] #tvtop > * { display: none; } ${R}[data-editing] #tvtop::before { content: "Edit Home"; font: 700 46px/1 var(--display); letter-spacing: -.03em; }
${R}[data-editing] .controls { display: none !important; } ${R}[data-editing] .hw-root > .hw-bar { position: fixed; top: 34px; right: calc(var(--dock) + 48px); z-index: 14; }
${R}[data-editing] .hw-bar .hw-btn, ${R}[data-editing] .hw-bar .hw-btn.red { height: 46px; padding: 0 20px; border-radius: 99px; background: var(--ui-fill) !important; box-shadow: var(--ui-edge); color: #fff !important; font-size: 15px; font-weight: 600; } ${R}[data-editing] .hw-bar .hw-btn:hover, ${R}[data-editing] .hw-bar .hw-btn[data-hw-act="edit"] { background: var(--ui-sel) !important; color: #000 !important; }
${R}[data-editing] .hw-root[data-view="desktop"] > #tvside { display: grid !important; left: calc(var(--tvrail) + 48px); right: calc(var(--dock) + 48px); top: 118px; bottom: 0; width: auto; max-height: none; margin: 0; padding: 14px 14px 40px; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 30px 26px; }
${R}[data-editing] .hw-root > .hw-stage { visibility: hidden; }
${R} .tve { position: relative; min-width: 0; } ${R} .tve > :not(button) { pointer-events: none; } ${R} .tve .tvs-card, ${R} .tve .tvt-wx { margin: 0; }
${R} .tve-x { position: absolute; z-index: 3; left: -12px; top: -12px; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--ui-sel); color: #000; box-shadow: 0 6px 16px rgba(0, 0, 0, .5); transition: transform .18s var(--ease); } ${R} .tve-x:hover { transform: scale(1.12); } ${R} .tve-x svg { width: 18px; height: 18px; }
${R} .tve-off, ${R} .tve-add { display: grid; place-content: center; justify-items: center; gap: 4px; width: 100%; min-height: 110px; border-radius: 22px; border: 2px dashed rgba(255, 255, 255, .2); color: rgba(255, 255, 255, .7); } ${R} .tve-off b { font-size: 17px; } ${R} .tve-off span { font-size: 13px; color: rgba(255, 255, 255, .5); }
${R} .tve-add { min-height: 140px; font-size: 15px; font-weight: 600; } ${R} .tve-add svg { width: 30px; height: 30px; } ${R} .tve-add:hover { border-color: #fff; color: #fff; }
${R} .tve-clock { display: grid; gap: 6px; } ${R} .tve-clock strong { font: 700 40px/1.1 var(--display); letter-spacing: -.03em; } ${R} .tve-clock span { font-size: 15px; color: rgba(255, 255, 255, .7); }
/* The hub's own sheets, in this look: Add to Home, Edit Tabs, Style, Set up a TV. */
${A} .hw-sheet, ${A} .hc-panel, ${A} .tvs-veil .tvs-card { background: var(--ui-panel) !important; border: 0; border-radius: 30px; box-shadow: var(--ui-edge), 0 40px 100px rgba(0, 0, 0, .6); -webkit-backdrop-filter: none; backdrop-filter: none; color: #fff; }
${A} .hw-sh-head { padding: 24px 26px 14px; } ${A} .hw-sh-head h2, ${A} .hc-head h2, ${A} .hc-head { font: 700 26px/1.1 var(--display); letter-spacing: -.02em; } ${A} .hc-head { padding: 22px 22px 12px; }
${A} :is(.hw-done, .hc-done) { height: 42px; padding: 0 20px; border-radius: 21px; background: var(--ui-sel); color: #000; font: 600 15px var(--font); } ${A} .hc-link { height: 42px; padding: 0 16px; border-radius: 21px; background: var(--ui-fill); box-shadow: var(--ui-edge); color: #fff; font: 600 14px var(--font); }
${A} .hc-line .hc-link { display: inline-flex; align-items: center; height: 34px; padding: 0 14px; text-decoration: none; } ${A} .hc-group + .hc-btn, ${A} .hc-panel .hc-btn { flex: none; margin-top: 10px; } ${A} :is(.hc-link, .hc-btn, .cn-rowbtn):hover { background: var(--ui-sel); color: #000; }
${A} .hw-gsearch { height: 46px; margin: 4px 26px 6px; padding: 0 18px; border-radius: 23px; background: var(--ui-fill); box-shadow: var(--ui-edge); } ${A} .hw-gsearch input { background: none; color: #fff; font: 600 15px var(--font); } ${A} .hw-addseg { margin-left: 26px !important; margin-right: 26px !important; }
${R} .hw-sheet { width: min(920px, 100%); max-height: min(calc(100dvh - 130px), 820px); } ${R} .hw-sheet:has(.hw-gsec) .hw-gsec { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 26px 22px; } ${R} .hw-sheet .hw-gsec h3 { grid-column: 1 / -1; margin: 6px 0 -8px; font: 700 20px var(--display); }
${R} .hw-sheet .hw-gitem { min-width: 0; padding: 16px; border-radius: 22px; background: var(--ui-fill); box-shadow: var(--ui-edge); } ${R} .hw-sheet .hw-gstage { background: rgba(0, 0, 0, .22); border-radius: 16px; } ${R} .hw-sheet .hw-ghead b { font-size: 16px; } ${R} .hw-sheet .hw-ghead span { line-height: 1.4; overflow-wrap: anywhere; } ${R} .hw-sheet .hw-gfoot { flex-wrap: wrap; margin-top: auto; } ${R} .hw-sheet .seg.hw-gsize { flex: 1 1 150px; }
${A} .hw-sheet .hw-opt h3, ${A} .hw-sheet .hw-dsec h3 { font-size: 13px; font-weight: 600; letter-spacing: .04em; color: rgba(255, 255, 255, .56); } ${A} .hw-sheet .hw-dlist { background: var(--ui-fill); box-shadow: var(--ui-edge); border-radius: 18px; } ${A} .hw-sheet .hw-dlist > * { padding: 13px 18px; flex-wrap: wrap; line-height: 1.4; } ${A} .hw-sheet :is(input[type="text"], input[type="url"], input[type="search"], select) { border-radius: 14px; } ${A} .hw-sheet .hw-btn { height: 42px; padding: 0 20px; border-radius: 21px; }
${R} .hw-scrim .row, ${R} .hw-scrim .list > * { line-height: 1.4; } ${R} .hc-panel { width: 440px; } ${R} .hc-panel .hc-body { padding: 6px 22px 26px; } ${R} .hc-panel .hc-line { padding: 10px 18px; flex-wrap: wrap; }
${A} .hw-sh-body { padding: 8px 26px 28px; } ${A} .hc-panel .hc-group, ${A} .hw-sheet .list, ${A} .tvs-veil .tvs-sec { background: var(--ui-fill); box-shadow: var(--ui-edge); border-radius: 20px; }
${A} .hc-btn { background: var(--ui-fill); box-shadow: var(--ui-edge); border-radius: 99px; color: #fff; } ${A} .hc-range { accent-color: #fff; } ${A} .hc-sw { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .2); }
${A} :is(.hw-gal, .hw-sh-body) h3 { letter-spacing: -.02em; } ${A} .hw-sheet .hw-gprev, ${A} .hw-sheet .hw-prev { border-radius: 20px; background: var(--ui-fill); box-shadow: var(--ui-edge); }
${A} .cn-rowbtn { height: 36px; padding: 0 16px; border-radius: 18px; background: var(--ui-fill); box-shadow: var(--ui-edge); color: #fff; font-size: 14px; } ${A} .cn-link { color: #fff; text-decoration: underline; text-underline-offset: 3px; }
${A} .tvs-veil { background: rgba(0, 0, 0, .5); -webkit-backdrop-filter: none; backdrop-filter: none; } ${A} .tvs-veil .tvs-card { scrollbar-width: none; } ${A} .tvs-veil .tvs-body { scrollbar-width: none; } ${A} .tvs-veil .tvs-body::-webkit-scrollbar { display: none; } ${A} .tvs-veil .tvs-head { border: 0; } ${A} .tvs-veil .tvs-head h1 { font: 700 26px/1.15 var(--display); } ${A} .tvs-veil .tvs-open { border-radius: 20px; background: var(--ui-sel) !important; color: #000 !important; } ${A} .tvs-veil .tvs-btn { height: 40px; padding: 0 18px; border-radius: 20px; background: var(--ui-sel); color: #000; } ${A} .tvs-veil .tvs-btn.plain { background: rgba(255, 255, 255, .1); color: #fff; } ${A} .tvs-veil .tvs-btn:hover { background: #fff; color: #000; } ${A} .tvs-veil .tvs-x { width: 42px; height: 42px; padding: 0; border-radius: 50%; background: var(--ui-fill); box-shadow: var(--ui-edge); color: #fff; } ${A} .tvs-veil .tvs-x:hover { background: var(--ui-sel); color: #000; } ${A} .tvs-veil .tvs-n, ${A} .tvs-veil .tvs-sec.done .tvs-n { background: rgba(255, 255, 255, .16); color: #fff; }
html[data-tvlook]:has(.tvs-veil) { overflow: hidden !important; scrollbar-width: none; } ${R} { scrollbar-width: none; } ${R}::-webkit-scrollbar { display: none; }
${R} .hw-bar-r { margin: 0; overflow: visible; }
${R} .hw-bar .hw-hint:not(:empty) { position: absolute; top: 100%; right: 0; white-space: nowrap; }
${A} .hw-bar .hw-btn { gap: 8px; }
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
${R} .tvm-b.busy { animation: tvmbusy 1s ease-in-out infinite; } @keyframes tvmbusy { 50% { opacity: .35; } }
${R} .tvm-b:hover { background: var(--ui-sel); color: #000; } ${R} .tvm-b svg { width: 22px; height: 22px; }
${R} .tvm-fit { flex: 1; min-height: 0; display: grid; place-items: center; }
${R} .tvm-screen { position: relative; overflow: hidden; border-radius: 18px; background: #000; box-shadow: 0 0 0 1px rgba(255, 255, 255, .14), 0 30px 80px rgba(0, 0, 0, .5); }
${R} .tvm-screen iframe { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; border: 0; transform-origin: 0 0; pointer-events: none; }
${R} .tvm-screen canvas { position: absolute; inset: 0; width: 100%; height: 100%; } ${R} .tvm-screen canvas[hidden] { display: none; }
${R} .tvm-cover { position: absolute; inset: 0; cursor: pointer; }
${R} .tvm-note { position: absolute; inset: 0; display: grid; place-items: center; padding: 40px; text-align: center; font-size: 20px; font-weight: 600; background: rgba(0, 0, 0, .72); pointer-events: none; }
${R} .tvm-note[hidden] { display: none; }
${A} .hw-bar .hw-btn .hw-ic { display: block; }
${A} .seg.hw-seg button { gap: 7px; }
/* Too tight for words: the buttons keep their icons. */
${R}[data-tight] .hw-bar .hw-btn { width: 42px; padding: 0; justify-content: center; }
${R}[data-tight] .hw-bar .hw-btn-t, ${R}[data-tight] .hw-bar .hw-seg span:not(.seg-thumb) { display: none; }
${R}[data-tight] .hw-bar .hw-seg { width: 190px; }
${R}[data-tight] .hw-bar .hw-ic { display: block; }
${R}[data-tighter] .hw-bar .hw-seg { display: none; }
/* Editing: a back button, what you can do, Done. */
${A} .tvround { display: none; flex: none; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: var(--ui-fill); box-shadow: var(--ui-edge); color: #fff; }
${A}:has(.hw-root) .tvround { display: grid; }
${A} .tvround:hover, ${A} .tvround.on { background: var(--ui-sel); color: #000; }
${A} .tvround svg { width: 26px; height: 26px; }
${A}:not(:has(.hw-edit)) #tvback.tvround { display: none; }
${R} #tvlayout.tvround { display: none !important; }
${A}:has(.hw-edit) :is(#tvlayout, #tvfilter, #tvgear).tvround { display: none; }
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
${A} .hw-app-b > .hc-app { border-radius: 18px !important; background: var(--ui-fill) !important; color: #fff !important; box-shadow: var(--ui-edge); }
${R} .hw-root[data-view="desktop"] .hw-app-l { display: block; width: 100%; text-align: center; font-size: 14px; }
${R} .hw-root[data-view="desktop"] .hw-app .hw-del { left: -8px; top: -8px; }
/* Widgets are drawn off screen here, at their real size, and shown in the column (#tvside). */
${R} .hw-root[data-view="desktop"] .hw-grid > .hw-cell:not(.a) { position: absolute; left: -9999px; top: 0; width: 184px; height: 184px; }
${R} .hw-root[data-view="desktop"] .hw-grid > .hw-cell.m:not(.a) { width: var(--side); }
${R} .hw-root[data-view="desktop"] .hw-grid > .hw-cell.l:not(.a) { width: var(--side); height: 380px; }
#tvside { display: none; }
${R} .hw-root[data-view="desktop"] > #tvside { display: grid; position: fixed; z-index: 11; top: 30px; right: max(48px, calc((100vw - 1500px) / 2 + 48px)); width: var(--side); max-height: max(190px, calc(63vh - 52px)); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; grid-template-columns: repeat(auto-fit, minmax(min(100%, 232px), 1fr)); gap: 14px; align-content: start; padding: 8px; margin: -8px; box-sizing: content-box; }
${R} #tvside::-webkit-scrollbar { display: none; }
${R} #tvside .hw-cell { height: 184px; min-width: 0; grid-column: auto !important; grid-row: auto !important; }
${R} #tvside .hw-cell.l { grid-column: 1 / -1 !important; }
${R} #tvside .hw-cell.l { height: 380px; }
${R} #tvside .tvp-card { grid-column: 1 / -1; } ${R} .tvp-card .mp { zoom: .62; } ${R} .tvp-card .mp-b { cursor: pointer; } ${R} .tvp-card .mp-b:hover { background: var(--ui-sel); color: #000; }
${R} #tvside .tvs-g { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; text-align: center; } ${R} #tvside .tvs-g > * { min-width: 0; width: auto; } ${R} #tvside .tvs-g svg { max-width: 100%; height: auto; } @media (max-width: 1420px) { ${R} #tvside .tvs-g > * { zoom: .88; } }
${R} #tvside :is(.tvs-card, .tvt-wx) { box-sizing: border-box; min-width: 0; overflow: hidden; } ${R} #tvside .tvs-card { display: flex; flex-direction: column; justify-content: space-between; padding: 18px 20px; border-radius: 26px; background: var(--ui-panel); box-shadow: var(--ui-edge); color: #fff; }
.tvs-h { font: 600 14px/1 var(--display); color: rgba(255, 255, 255, .6); }
.tvs-g { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; text-align: center; }
.tvs-g > div { position: relative; } .tvs-g svg { width: 76px; height: 76px; margin: 0 auto; } .tvs-g circle { transition: stroke-dasharray .6s var(--ease); }
.tvs-g b { position: absolute; left: 0; right: 0; top: 27px; font: 700 20px/1 var(--display); letter-spacing: -.02em; } .tvs-g b i { font: 600 11px/1 var(--display); color: rgba(255, 255, 255, .6); }
.tvs-g span { display: block; margin-top: 6px; font-size: 13px; font-weight: 600; } .tvs-g em { display: block; min-height: 14px; font: 500 11.5px/14px var(--font); color: rgba(255, 255, 255, .5); white-space: nowrap; }
/* The hub's own widgets, in the same cut: a tinted glow from the corner, a quiet label, big figures. */
${A} .hw-card { border-radius: 26px !important; padding: 18px 20px !important; background: radial-gradient(120% 90% at 0 0, color-mix(in srgb, var(--t, #0a84ff) 22%, transparent), transparent 62%), var(--ui-panel) !important; }
${A} .hw-card .hw-label { font: 600 14px/1 var(--display); color: rgba(255, 255, 255, .62); text-transform: none; letter-spacing: 0; }
${A} .hw-card .hw-label svg { color: var(--t, #fff); }
${A} .hw-card .hw-row { border-color: rgba(255, 255, 255, .07); }
${A} .hw-card .hw-track { height: 8px; border-radius: 4px; background: rgba(255, 255, 255, .1); } ${A} .hw-card .hw-fill { border-radius: 4px; }
${A} #tvside .tvp-card .mp { position: relative; overflow: hidden; }
${A} .mp.art::before { content: ""; position: absolute; inset: -40px; background: var(--art) center / cover; filter: blur(40px) saturate(1.5); opacity: .5; }
${A} .mp.art > * { position: relative; }
${A} .mp-art { transition: transform .3s var(--ease), box-shadow .3s var(--ease); } 
${A} .tvp-card .mp { transition: transform .3s var(--ease), box-shadow .3s var(--ease); } ${A} .tvp-card .mp.has:hover { transform: scale(1.02); box-shadow: var(--ui-edge), 0 26px 60px rgba(0, 0, 0, .55); }
${A} .mp.art::before { transition: opacity .4s; } ${A} .mp.art:hover::before { opacity: .75; }
${A} .mp:hover .mp-art[data-open] { box-shadow: 0 10px 26px rgba(0, 0, 0, .5); } ${A} .mp-art[data-open] { cursor: pointer; } ${A} .mp-art[data-open]:hover { transform: scale(1.06); } 
${A} .mp-b { transition: transform .18s var(--ease), background .15s, color .15s; } ${A} .mp-b:active { transform: scale(.9); } ${A} #tvside .mp-b:hover { transform: scale(1.08); }
${A} .mp-line { transition: height .2s var(--ease); } ${A} .mp-line i { transition: transform .5s linear; } ${A} .mp-bar em { transition: opacity .25s; }
${A} .tvp-card .mp:not(:hover) .mp-bar em { opacity: .7; }
${A} .mp-bar.seek { cursor: pointer; padding: 8px 0; margin-top: 2px !important; margin-bottom: -8px; } ${A} .mp-bar.seek .mp-line::after { content: ""; position: absolute; left: var(--at, 0%); top: 50%; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%; background: #fff; box-shadow: 0 2px 8px rgba(0, 0, 0, .5); transform: scale(0); transition: transform .2s var(--ease); } ${A} .mp-bar.seek:hover .mp-line { height: 10px; } ${A} .mp-bar.seek:hover .mp-line::after { transform: scale(1); }
${A} .mp:hover .long span { animation: mplong 7s ease-in-out .4s infinite alternate; } @keyframes mplong { 0%, 12% { transform: none; } 88%, 100% { transform: translateX(var(--over)); } }
@media (prefers-reduced-motion: reduce) { ${A} .mp *, ${A} .mp { animation: none !important; transition: none !important; } }
/* Controls on a computer: all of it, its own scroll, and headings. */
${A} #tvpanel .wpanel-list { max-height: none; overflow: visible; }
${A} #tvpanel .wph { grid-column: 1 / -1; margin: 8px 8px -6px; font: 600 24px/1 var(--display); color: rgba(255, 255, 255, .56); }
${A} #tvpanel .wpt { grid-column: 1 / -1; display: flex; padding: 8px; border-radius: 50px; background: var(--ui-fill); box-shadow: var(--ui-edge); }
${A} #tvpanel .wpt button { flex: 1; height: 74px; border-radius: 37px; font: 600 26px/1 var(--display); color: rgba(255, 255, 255, .7); }
${A} #tvpanel .wpt button.on { background: var(--ui-sel); color: #000; }
@media (max-width: 1420px) { ${R} #tvside .wxw-hours { grid-template-columns: repeat(5, 1fr); } ${R} #tvside .wxw-hours > :nth-child(n + 6) { display: none; } ${R} #tvside .tvt-wx .wxw { font-size: 12px; } }
${R} #tvside .tvt-wx { padding: 18px 20px; border-radius: 26px; background: var(--ui-panel); box-shadow: var(--ui-edge); color: #fff; }
${R}[data-tvshow="apps"] #tvside { visibility: hidden; }
${R}[data-tvshow="widgets"] .hw-grid > .hw-cell.a { display: none !important; }
${R} .hw-dots { display: none; }

/* ── Settings: the TV's page, at a computer's size ── */
#tvset { display: none; }
${A} #tvset.on { position: fixed; z-index: 55; left: var(--tvrail); right: 0; top: 0; bottom: 0; display: grid; grid-template-columns: minmax(220px, 34%) minmax(0, 1fr); background: var(--chat-bg); color: #fff; }
${A} .tvs-art { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; text-align: center; }
${R} .tvs-title.top button { display: none; } ${A} .tvs-find { flex: 0 1 260px; margin-left: auto; height: 44px; min-width: 0; padding: 0 20px; border: 0; outline: 0; border-radius: 22px; background: var(--ui-fill); box-shadow: var(--ui-edge); color: #fff; font: 600 15px var(--font); letter-spacing: 0; } ${A} .tvs-find:focus { box-shadow: 0 0 0 2px #fff; } ${A} .tvs-find::-webkit-search-cancel-button { filter: invert(1); }
${A} .tvs-range input { flex: 0 1 240px; min-width: 90px; accent-color: #fff; cursor: pointer; } ${A} .tvs-range .v { min-width: 46px; text-align: right; font-variant-numeric: tabular-nums; }
${A} .tvs-art img { width: 170px; height: 170px; border-radius: 38px; box-shadow: 0 25px 55px rgba(0, 0, 0, .55); }
${A} .tvs-art p { margin: 0; font-size: 14px; line-height: 1.5; color: rgba(255, 255, 255, .6); }
${A} .tvs-list { overflow-y: auto; scrollbar-width: none; padding: 48px 64px 90px 8px; }
${A} .tvs-list::-webkit-scrollbar { display: none; }
${A} .tvs-title { display: flex; align-items: center; gap: 16px; margin: 0 0 20px 6px; font: 700 34px/1.1 var(--display); letter-spacing: -.02em; }
${A} .tvs-title button { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--ui-fill); box-shadow: var(--ui-edge); }
${A} .tvs-title button:hover { background: var(--ui-sel); color: #000; }
${A} .tvs-title svg { width: 22px; height: 22px; }
${A} .tvs-group { margin: 24px 0 8px 16px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: rgba(255, 255, 255, .56); }
${A} .tvs-row { display: flex; align-items: center; gap: 16px; width: 100%; min-height: 58px; padding: 9px 20px; margin-bottom: 8px; border-radius: 18px; background: var(--ui-fill); box-shadow: var(--ui-edge); text-align: left; transition: transform .2s var(--ease); }
${R} button.tvs-row:is(:hover, :focus-visible) { background: var(--ui-sel); color: #000; transform: scale(1.015); outline: 0; }
${A} .tvs-row .txt { flex: 1; min-width: 0; }
${A} .tvs-row .t1 { font-size: 16px; font-weight: 600; }
${A} .tvs-row .t1, ${A} .tvs-row .t2 { white-space: normal !important; overflow: visible !important; overflow-wrap: anywhere; line-height: 1.35; } ${A} .tvs-row .t2 { margin-top: 2px; font-size: 13px; color: rgba(255, 255, 255, .6); }
${A} .tvs-note { margin: 14px 16px 0; font-size: 13.5px; line-height: 1.45; color: rgba(255, 255, 255, .56); }
${A} .tvs-step { align-items: flex-start; padding: 14px 20px; } ${A} .tvs-step > b { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: rgba(255, 255, 255, .12); font-size: 14px; } ${A} .tvs-step .tvs-x { flex: none; align-self: center; } ${A} .tvs-step .tvs-x:hover { background: var(--ui-sel); color: #000; }
${A} .tvs-form { gap: 12px; } ${A} .tvs-form input { flex: 1; min-width: 0; height: 42px; padding: 0 18px; border: 0; outline: 0; border-radius: 21px; background: rgba(255, 255, 255, .1); color: #fff; font: 600 16px var(--font) !important; } ${A} .tvs-form input:focus { box-shadow: 0 0 0 2px #fff; } ${A} .tvs-saved { font-size: 14px; color: rgba(255, 255, 255, .6); } ${A} .tvs-saved:empty { display: none; } ${A} .tvs-go { height: 42px; padding: 0 22px; border-radius: 21px; background: var(--ui-sel); color: #000; font: 600 15px var(--font); }
${A} .tvs-icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 14px; padding: 6px 4px; } ${A} .tvs-icons button { padding: 0; border-radius: 22px; transition: transform .2s var(--ease), box-shadow .2s; } ${A} .tvs-icons img { display: block; width: 100%; aspect-ratio: 1; } ${A} .tvs-icons button:hover { transform: scale(1.06); } ${A} .tvs-icons button.on { box-shadow: 0 0 0 3px #101114, 0 0 0 6px #fff; }
${A} .tvs-dots { display: flex; flex-wrap: wrap; gap: 16px; padding: 8px 6px; } ${A} .tvs-dots button { width: 40px; height: 40px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .25); transition: transform .2s var(--ease); } ${A} .tvs-dots button:hover { transform: scale(1.12); } ${A} .tvs-dots button.on { box-shadow: 0 0 0 3px #101114, 0 0 0 6px #fff; }
${A} .tvs-row .pic { width: 38px; height: 38px; margin-right: 2px; } ${R} .rmr select { width: 230px; }
${A} .tvs-row .v { font-size: 15px; color: rgba(255, 255, 255, .6); white-space: nowrap; }
${A} .tvs-row .v.on { color: #0a84ff; }
${R} button.tvs-row:is(:hover, :focus-visible) :is(.t2, .v) { color: rgba(0, 0, 0, .55); }
${A} .tvs-art .rm { height: min(86vh, 860px); } ${A} .tvs-art .rm.pad { height: auto; width: min(100%, 460px); }
${A} .tvs-seg { display: inline-flex; gap: 4px; margin: 0 0 6px 4px; padding: 4px; border-radius: 99px; background: var(--ui-fill); box-shadow: var(--ui-edge); } ${A} .tvs-seg button { height: 38px; padding: 0 18px; border-radius: 99px; font-size: 14px; font-weight: 600; color: rgba(255, 255, 255, .7); } ${A} .tvs-seg button.on { background: var(--ui-sel); color: #000; }
${A} .rmr select { height: 40px; max-width: 260px; padding: 0 14px; border: 0; border-radius: 20px; background: rgba(255, 255, 255, .1); color: #fff; font: 600 14px var(--font); } ${A} .rmr option { background: #1c1d22; }
${A} .rmr.rmsel { box-shadow: 0 0 0 2px #fff; }
body > .lk { position: fixed; z-index: 2147483000; zoom: .62; } html:not([data-tvlook]):not([data-tvtouch]) > body > .lk { --ui-fill: #26272d; --ui-sel: #f2f2f5; --ui-edge: none; }
${T} body > .lk { zoom: .58; }
${A} .tvs-x { height: 36px; padding: 0 16px; border-radius: 99px; background: rgba(255, 255, 255, .1); color: #fff; font-size: 14px; font-weight: 600; white-space: nowrap; } ${A} .tvs-x:hover { background: #ff453a; }
${A} .tvs-msg { margin: 0 4px 10px; padding: 12px 18px; border-radius: 16px; background: rgba(10, 132, 255, .2); font-size: 15px; font-weight: 600; }
${A} .tvs-pair { display: grid; grid-template-columns: 170px 1fr; gap: 24px; align-items: center; margin-bottom: 8px; } ${A} .tvs-pair > div { display: block !important; } ${A} .tvs-pair b { font: 700 34px/1 var(--mono); letter-spacing: .08em; } ${A} .tvs-pair ol { margin: 14px 0 !important; } ${A} .tvs-pair i { color: rgba(255, 255, 255, .5); font-style: normal; }
${A} .tvs-qr { border-radius: 14px; overflow: hidden; background: #fff; } ${A} .tvs-qr:empty { display: none !important; } ${A} .tvs-qr svg { display: block; width: 100%; height: auto; }
@media (max-width: 700px) { ${A} .tvs-pair { grid-template-columns: 1fr; } }
${A} .tvs-form { padding: 18px 22px; border-radius: 18px; background: var(--ui-fill); box-shadow: var(--ui-edge); font-size: 15px; line-height: 1.6; }
${A} .tvs-form ol { margin: 0 0 14px; padding-left: 20px; color: rgba(255, 255, 255, .75); } ${A} .tvs-form code { padding: 2px 8px; border-radius: 8px; background: rgba(255, 255, 255, .1); font-size: 13px; user-select: all; } ${A} .tvs-form a { color: #4aa3ff; }
${A} .tvs-form > div { display: flex; gap: 12px; } ${A} .tvs-form input { flex: 1; min-width: 0; height: 44px; padding: 0 18px; border: 0; border-radius: 22px; background: rgba(255, 255, 255, .08); color: #fff; font: 500 15px var(--mono); }
${A} .tvs-form button { height: 44px; padding: 0 20px; border-radius: 22px; background: var(--ui-sel); color: #000; font-size: 15px; font-weight: 600; white-space: nowrap; } ${A} .tvs-form p { margin: 10px 0 0; min-height: 20px; color: rgba(255, 255, 255, .7); }
${A} .tvs-walls { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 22px 18px; padding: 6px; }
${A} .tvs-wall i { display: block; aspect-ratio: 16 / 9; border-radius: 16px; background: #2c2c2e center / cover no-repeat; box-shadow: var(--ui-edge); }
${A} .tvs-wall span { display: block; margin-top: 8px; padding-left: 4px; font-size: 14px; font-weight: 600; text-align: left; color: rgba(255, 255, 255, .75); }
${A} .tvs-wall:is(:hover, :focus-visible) i { box-shadow: 0 0 0 3px #fff; } ${A} .tvs-wall { outline: 0; }
${A} .tvs-wall.on span { color: #fff; } ${A} .tvs-wall.on span::after { content: " ✓"; color: #0a84ff; }

/* ── A phone or an iPad: the clock, a row of round buttons and search, the tiles, then the widgets ── */
#tvwx { display: none; }
${T}:has(.hw-root:not(.hw-edit)) #tvwx:not(:empty) { display: block; padding: 18px 22px; margin: 0 0 18px; border-radius: 26px; background: var(--ui-panel); box-shadow: var(--ui-edge); color: #fff; }
#tvgear.tvround { display: none; }
${T}:has(.hw-root:not(.hw-edit)) #tvgear.tvround { display: grid; }
${T}:has(.hw-root) #tvfilter.tvround { display: none; }
${T}:has(.hw-root) :is(.head, .nav) { display: none; }
${T}:has(.hw-root) #tvtop { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; flex-wrap: wrap; padding: calc(env(safe-area-inset-top, 0px) + 34px) 4px 24px; color: #fff; text-shadow: 0 2px 14px rgba(0, 0, 0, .35); }
${T} .tvt-name { display: none; }
${T} .tvt-clock { font-size: 64px; }
${T} .tvt-date { font-size: 18px; margin-top: 0; flex: 1 0 100%; }
${T} #seg-scroll { margin-bottom: 4px; }
${T}:has(.hw-root) .controls { display: flex; flex-direction: row; gap: 10px; align-items: center; flex-wrap: wrap; }
${T}:has(.hw-root) #seg-scroll { flex: 1 0 100%; order: -1; margin: 0 0 4px; }
${T}:has(.hw-root) .search { flex: 1 1 100px; width: auto; min-width: 100px; max-width: none; margin: 0; }
${T} .tvround { width: 50px; height: 50px; } ${T} .search input { height: 50px; font-size: 17px; }
${T} .tvround:active { background: var(--ui-sel); color: #000; }
${T} .hw-root:not(.hw-edit) > .hw-bar { display: none; }
/* Home is as long as what's on it and the page scrolls, as the TV's does. */
html[data-tvtouch]:has(.hw-root:not(.hw-edit)):not(:has(#tvset.on)) { overflow-y: auto !important; overflow-x: clip; }
${T} .hw-root:not(.hw-edit) .hw-frame { height: auto !important; }
${T} .hw-root:not(.hw-edit) .hw-pager { overflow: visible; flex: none; overscroll-behavior: auto; touch-action: pan-y; -webkit-mask: none; mask: none; }
${T} .hw-root:not(.hw-edit) .hw-grid { padding-bottom: 120px; }
${T} .hw-bar .hw-btn.hw-iconly { width: 42px; padding: 0; justify-content: center; } ${T} .hw-bar .hw-btn svg { flex: none; } ${T} .hw-bar .hw-iconly .hw-btn-t { display: none; }
${T} #tvpanel { width: min(418px, 88vw); } ${T} #tvpanel > div { zoom: min(.55, calc(88vw / 760px)); padding: 80px 48px; }
${T} #tvset.on { position: fixed; z-index: 55; inset: 0; display: block; background: var(--chat-bg); color: #fff; }
${T} .tvs-art { display: none; } ${T} .tvs-row .t2 { white-space: normal; }
${T} .tvs-list { height: 100%; box-sizing: border-box; padding: calc(env(safe-area-inset-top, 0px) + 22px) 16px 90px; -webkit-overflow-scrolling: touch; }
${T} .tvs-walls { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
${T}:has(#tvset.on) body { overflow: hidden; }
@media (max-width: 700px) {
  ${T} .hw-root:not(.hw-edit) .hw-cell[data-dup] { display: none; }
  ${T} .hw-root:not(.hw-edit) .hw-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; grid-auto-rows: auto !important; gap: 18px 14px !important; }
  ${T} .hw-root:not(.hw-edit) .hw-cell { grid-area: auto !important; height: 168px; min-width: 0; }
  ${T} .hw-root:not(.hw-edit) .hw-cell:is(.m, .l):not(.a) { grid-column: 1 / -1 !important; }
  ${T} .hw-root:not(.hw-edit) .hw-cell.l:not(.a) { height: 360px; }
  ${T} .hw-root:not(.hw-edit) .hw-cell.a { display: block; height: auto; order: -1; }
  ${T} .hw-root:not(.hw-edit) .hw-app { width: 100%; height: auto; }
  ${T} .hw-root:not(.hw-edit) .hw-app-b { width: 100%; height: auto; padding: 0; gap: 8px; }
  ${T} .hw-root:not(.hw-edit) .hw-app-b > .hc-app { width: 100% !important; height: auto !important; aspect-ratio: 5 / 3; }
  ${T} .hw-root:not(.hw-edit) .hw-app-b svg { width: 34px; height: 34px; }
  ${T} .hw-root:not(.hw-edit) .hw-app-l { max-width: 100%; font-size: 14px; }
}

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

  let hubIcon = '/icons/hub.svg'
  const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
  const IC = {
    home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h4.5v-5.5h4V20h4.5V9.5"/>',
    files: '<path d="M4 7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    overlay: '<rect x="3.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2.2"/>',
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
  top.innerHTML = '<div class="tvt-clock"></div><div class="tvt-date"></div><div class="tvt-name"></div>'
  const wxCard = document.createElement('div')
  wxCard.id = 'tvwx'
  document.querySelector('.page').prepend(top, wxCard)

  // ── Controls: the TV's panel (its markup and styles, tv/ui/panel.js and panel.css), working the TV from here ──
  const panel = document.createElement('aside')
  panel.id = 'tvpanel'
  panel.setAttribute('aria-label', 'Controls')
  panel.innerHTML = `<div><div class="wpanel-title">Controls<button type="button" data-tvpx title="Close (Esc)" aria-label="Close">${svg('<path d="M6 6l12 12M18 6 6 18"/>')}</button></div><div class="wpanel-list"></div></div>`
  document.body.append(panel)
  const btn = document.createElement('button')
  btn.id = 'tvlayout'
  btn.className = 'tvround'
  btn.type = 'button'
  btn.title = 'Controls (Ctrl+.)'
  btn.setAttribute('aria-label', 'Controls')
  btn.innerHTML = svg('<rect x="3.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2.2"/>')
  const mk = (id, label, d) => Object.assign(document.createElement('button'), { id, type: 'button', title: label, className: 'tvround', ariaLabel: label, innerHTML: svg(d) })
  const back = mk('tvback', 'Back', '<path d="M15 5l-7 7 7 7"/>')
  const filter = mk('tvfilter', 'Filter and sort', '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>')
  const controls = document.getElementById('controls')
  const gear = mk('tvgear', 'Settings', IC.gear)
  gear.addEventListener('click', () => openSettings())
  controls.prepend(back, btn, filter)
  controls.append(gear)
  back.addEventListener('click', () => document.querySelector('.hw-root.hw-edit [data-hw-act="edit"]')?.click())

  // Filter and sort, the TV's filter button.
  const menu = document.createElement('div')
  menu.id = 'tvmenu'
  document.body.append(menu)
  function paintMenu() {
    const it = (k, v, label) => `<button type="button" data-f="${k}:${v}"><span>${label}</span><span>${(look[k] || (k === 'show' ? 'all' : 'mine')) === v ? '✓' : ''}</span></button>`
    menu.innerHTML = '<h4>Show</h4>' + it('show', 'all', 'Apps and widgets') + it('show', 'apps', 'Apps') + it('show', 'widgets', 'Widgets') + '<h4>Sort apps</h4>' + SORTS.map(([v, l]) => it('sort', v, l)).join('')
  }
  const closeMenu = () => { menu.classList.remove('on'); filter.classList.remove('on') }
  filter.addEventListener('click', () => {
    if (menu.classList.contains('on')) return closeMenu()
    paintMenu()
    const r = filter.getBoundingClientRect()
    menu.style.left = `${r.left}px`
    menu.classList.add('on')
    menu.style.maxHeight = `${innerHeight - 40}px`
    menu.style.overflowY = 'auto'
    menu.style.top = `${Math.max(20, Math.min(r.bottom + 10, innerHeight - menu.offsetHeight - 20))}px`
    menu.style.left = `${menu.offsetTop < r.bottom ? r.right + 10 : r.left}px`
    filter.classList.add('on')
    menu.querySelector('button').focus()
  })
  menu.addEventListener('click', e => { const f = e.target.closest('[data-f]')?.dataset.f; if (!f) return; const [k, v] = f.split(':'); look[k] = v; saveLook(); arrange(); paintMenu(); window.HubDesk?.paint() })
  document.addEventListener('hub-sort-mine', () => { look.sort = 'mine'; saveLook() })
  document.addEventListener('pointerdown', e => { if (!menu.contains(e.target) && !filter.contains(e.target)) closeMenu() })
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    if (menu.classList.contains('on')) { e.stopPropagation(); closeMenu(); filter.focus() }
  }, true)

  // The widget column: the weather, then Home's widgets, copied from where home.js draws them so its own clicks, edits
  // and updates work here (the column is inside .hw-root). The clock and date are already at the top left.
  let MU = null, SYS = null, KEYS = { on: false, state: 'off', why: '' }
  const gauge = (label, v, sub = '') => { const p = Math.max(0, Math.min(100, Number(v) || 0)), c = p > 90 ? '#ff453a' : p > 75 ? '#ff9f0a' : '#30d158'; return `<div><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="7"/><circle cx="32" cy="32" r="26" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(p * 1.634).toFixed(1)} 164" transform="rotate(-90 32 32)"/></svg><b>${Math.round(p)}<i>%</i></b><span>${label}</span><em>${sub}</em></div>` }
  async function readPc() {
    try { const [m, y] = await Promise.all([fetch('/api/music', { cache: 'no-store' }), fetch('/api/desk/system', { cache: 'no-store' })]); MU = m.ok ? await m.json() : null; P?.noted(MU?.now); SND = await fetch('/api/tv/audio/state', { cache: 'no-store' }).then(r => r.json(), () => null); SYS = y.ok ? await y.json() : null } catch { MU = null }
    if (!dragging) paintPanel()
    paintSide()
    moveTime()
  }
  function moveTime() {
    if (!P || document.hidden) return
    P.syncPlayer(side, MU?.now)
    if (panel.classList.contains('on')) P.syncPlayer(panel, TV?.on && look.target === 'tv' ? TV.state?.media : MU?.now)
  }
  setInterval(moveTime, 500)
  let SND = null, editB = false
  let onScreen = [] // the widgets Controls can show or hide
  let side = null, sideWatch = null, sideRoot = null
  function paintSide() {
    const w = look.weather && wxBody && window.HubWeatherCard ? window.HubWeatherCard(wxBody, 'm') : ''
    if (wxCard._html !== w) wxCard.innerHTML = wxCard._html = w
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
    onScreen = []
    const wx = look.weather && wxBody && window.HubWeatherCard ? `<div class="tvt-wx">${window.HubWeatherCard(wxBody, 'm')}</div>` : ''
    const cells = [...root.querySelectorAll('.hw-grid > .hw-cell:not(.a)')].filter(c => {
      const id = c.querySelector('[data-hw-widget], [data-hw-wid]')?.dataset.hwWidget || c.dataset.hwKey || ''
      if (/(^|-)(clock|date|weather|world-clock)$/.test(id)) return editing && c.style.display !== 'none'
      const key = c.dataset.hwKey, name = (c.querySelector('.hw-label')?.textContent || c.querySelector('[aria-label]')?.getAttribute('aria-label') || id.replace(/^[a-z]\d+-/, '').replace(/-/g, ' ')).trim()
      onScreen.push({ key, name: name.charAt(0).toUpperCase() + name.slice(1) })
      return c.style.display !== 'none' && (editing || !look.off?.includes(key))
    })
    const pl = P && MU && look.player !== false ? `<div class="tvp-card">${P.player(MU.now || {}, true)}</div>` : ''
    const sysCard = SYS && look.sys !== false ? `<div class="tvs-card"><div class="tvs-h">This PC</div><div class="tvs-g">${gauge('CPU', SYS.cpu)}${gauge('Memory', SYS.mem)}${gauge('Disk', SYS.disk, SYS.diskFree ? `${Math.round(SYS.diskFree / 2 ** 30)} GB free` : '')}</div></div>` : ''
    document.documentElement.toggleAttribute('data-editing', editing)
    // Editing: every card with its − (or a + to bring it back), filling the page.
    const held = (id, name, html2, on) => `<div class="tve${on ? '' : ' gone'}"><button type="button" class="tve-x" data-tve="${id}" aria-label="${on ? 'Remove' : 'Add'} ${name}" title="${on ? 'Remove from Home' : 'Put on Home'}">${svg(on ? '<path d="M6 12h12"/>' : '<path d="M12 6v12M6 12h12"/>')}</button>${on ? html2 : `<div class="tve-off"><b>${name}</b><span>Not on Home</span></div>`}</div>`
    const plOn = look.player !== false, sysOn = look.sys !== false
    const html = editing ? held('homeplayer', 'Music', P && MU ? `<div class="tvp-card">${P.player(MU.now || {}, true)}</div>` : '', plOn) + held('homeweather', 'Weather', wx, look.weather) + held('homesys', 'This PC', sysCard, sysOn) + held('homeclock', 'Clock', `<div class="tvs-card tve-clock"><div class="tvs-h">Clock</div><strong>${esc(top.querySelector('.tvt-clock').textContent)}</strong><span>${esc(top.querySelector('.tvt-date').textContent)}</span></div>`, look.clock !== 'Off') + cells.map(c => c.outerHTML).join('') + `<button type="button" class="tve-add" data-hw-act="add">${svg('<path d="M12 5v14M5 12h14"/>')}<span>Add a widget</span></button>` : pl + wx + sysCard + cells.map(c => c.outerHTML).join('')
    if (side._html === html) return
    const y = side.scrollTop
    // The player is kept while the song is the same: drawn again, its cover would blink.
    const was = side.querySelector('.tvp-card')
    side._html = html
    side.innerHTML = html
    const now = side.querySelector('.tvp-card')
    if (was && now && was._pl === pl) now.replaceWith(was)
    else if (now) now._pl = pl
    side.scrollTop = y
    document.documentElement.toggleAttribute('data-noside', !html)
  }
  document.addEventListener('click', e => {
    const id = e.target.closest?.('[data-tve]')?.dataset.tve
    if (!id) return
    e.stopPropagation()
    if (id === 'homeclock') { look.clock = look.clock === 'Off' ? 'Time and date' : 'Off'; saveLook() } else press(id)
    side._html = ''
    paintSide()
  }, true)
  function arrange() {
    const dup = document.documentElement.matches('[data-tvtouch]') && matchMedia('(max-width: 700px)').matches && !document.querySelector('.hw-root.hw-edit')
    for (const c of document.querySelectorAll('.hw-grid > .hw-cell:not(.a)')) c.toggleAttribute('data-dup', dup && ((id => /(^|-)(clock|date|weather)$/.test(id) && !/world-clock$/.test(id))(c.querySelector('[data-hw-widget], [data-hw-wid]')?.dataset.hwWidget || c.dataset.hwKey || '')))
    document.documentElement.dataset.tvshow = look.show || 'all'
    const cells = [...document.querySelectorAll('.hw-grid > .hw-cell.a')]
    const names = look.sort === 'az' ? cells.map(c => c.querySelector('.hw-app-l')?.textContent || '').sort((a, b) => a.localeCompare(b)) : null
    for (const c of cells) c.style.order = names ? names.indexOf(c.querySelector('.hw-app-l')?.textContent || '') : ''
  }
  // One row: the search box gives way first, then the buttons become icons.
  function fitRow() {
    const box = document.getElementById('q')
    if (box && document.querySelector('.hw-root') && document.documentElement.hasAttribute('data-tvtouch') && box.placeholder !== 'Search') box.placeholder = 'Search'
    const r = document.documentElement, bar = document.querySelector('.hw-root > .hw-bar')
    if (!bar || !r.hasAttribute('data-tvlook')) return
    r.removeAttribute('data-tight')
    r.removeAttribute('data-tighter')
    if (r.hasAttribute('data-editing')) return
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
  const SRC = { auto: 'Automatic', pc: 'This PC', spotify: 'Spotify', tv: 'Your TV' }
  const saveLook = () => { try { localStorage.setItem(PREF, JSON.stringify(look)) } catch {} applyLook(); paintPanel() }
  let P = null, TV = null, dragging = null, poll = 0
  const post = c => fetch('/api/tv/command', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify(c) }).catch(() => {})
  const soon = () => { setTimeout(readTv, 900); setTimeout(readTv, 2000) }
  async function readTv() {
    try { const r = await fetch('/api/tv/status', { cache: 'no-store' }); TV = r.ok ? (await r.json()).tv : null; P?.noted(TV?.state?.media) } catch { TV = null }
    if (!dragging) paintPanel()
    paintSide()
  }
  // Controls' round buttons: yours to choose.
  const sym = d => svg(d).replace('<svg', '<svg class="sym"')
  const BTN = [['ask', 'Assistant', () => P.IC.mic], ['pcbrowser', 'Browser', () => sym(IC.globe)], ['mirror', 'TV screen', () => P.IC.pic], ['pcfiles', 'Files', () => sym(IC.files)], ['pcmute', 'Mute', () => sym('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>')], ['pcsaver', 'Screensaver', () => P.IC.moon], ['pcadd', 'Add app', () => P.IC.plus], ['settings', 'Settings', () => P.IC.gear], ['pcedit', 'Edit Home', () => sym('<path d="m4 20 1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5z"/>')], ['displays', 'Displays', () => P.IC.sun], ['musicset', 'Platforms', () => P.IC.note], ['remotes', 'Remotes', () => P.IC.sliders], ['tvpower', 'TV power', () => P.IC.power], ['tvhome', 'TV home', () => P.IC.home]]
  const picked = () => (Array.isArray(look.btns) && look.btns.length >= 4 ? look.btns : BTN.slice(0, 8).map(b => b[0]))
  const btnOf = ([id, label, ic]) => P.round((editB ? 'eb:' : '') + id, ic(), id === 'pcmute' && MU?.volume === 0 ? 'Unmute' : label, editB ? picked().includes(id) : id === 'pcmute' && MU?.volume === 0)
  function paintPanel() {
    if (!P) return
    const on = !!TV?.on, st = (on && TV.state) || {}
    const tvSide = on && look.target === 'tv'
    const sy = d => svg(d).replace('<svg', '<svg class="sym"'), mons = MU?.monitors || [], lit = mons.filter(m => m.on)
    const list = panel.querySelector('.wpanel-list')
    const pill = (id, ic, t1, v) => P.pill(id, ic, t1, v ? 'On screen' : 'Hidden', v)
    const html = (on ? `<div class="wpt"><button type="button" data-w="to:pc" class="${tvSide ? '' : 'on'}">This PC</button><button type="button" data-w="to:tv" class="${tvSide ? 'on' : ''}">Your TV</button></div>` : '')
      + P.player(tvSide ? st.media || {} : MU?.now || {}, true)
      + (tvSide
        ? P.slider('brightness', st.brightness ?? 100, P.IC.sun, 'TV brightness') + P.slider('volume', st.volume ?? 0, P.IC.vol, 'TV volume', st.volume == null)
          + `<div class="wpq">${P.round('home', P.IC.home, 'TV home') + P.round('tvback', sy('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'), 'Back') + P.round('mirror', P.IC.pic, 'Screen') + P.round('sleep', P.IC.power, 'Power')}</div>`
          + P.pill('saver', P.IC.moon, 'Screensaver', 'Start it') + P.pill('tvmenu', P.IC.sliders, 'Menu', 'The TV’s own')
        : P.slider('brightness', MU?.brightness ?? 0, P.IC.sun, 'Brightness', MU?.brightness == null) + P.slider('volume', MU?.volume ?? 0, P.IC.vol, 'Volume', MU?.volume == null)
          + `<div class="wpq">${BTN.filter(b => picked().slice(0, 4).includes(b[0])).map(btnOf).join('')}</div>`
          + picked().slice(4).map(id => BTN.find(b => b[0] === id)).filter(Boolean).map(btnOf).join('')
          + (editB ? `<div class="wph">Tap to add or remove a button</div>${BTN.filter(b => !picked().includes(b[0])).map(btnOf).join('')}` : '')
          + (SND?.available && (on || SND.to !== 'pc') ? `<div class="wph">Sound plays on</div><div class="wpt wps3">${[['pc', 'This PC'], ['tv', 'Your TV'], ['both', 'Both']].map(([k, t]) => `<button type="button" data-w="snd:${k}" class="${SND.to === k ? 'on' : ''}">${t}</button>`).join('')}</div>${SND.to !== 'pc' && !SND.tv ? '<div class="wpn">Waiting for the TV…</div>' : ''}` : '')
          + (mons.length > 1 ? `<div class="wph">Brightness moves</div>${mons.map(m => P.pill(`mon:${m.id}`, P.IC.sun, m.name, m.on ? `${m.level}%` : 'Left alone', m.on)).join('')}` : ''))
      + (tvSide ? (st.inputs || []).map(i => P.pill(`input:${i.name}`, P.IC.input, i.name, i.sub || 'Input')).join('') : '')
      + '<div class="wph">Music</div>' + P.pill('music', P.IC.note, 'Music from', SRC[MU?.source] || 'Automatic', true) + P.pill('musicset', P.IC.sliders, 'Platforms', MU?.spotify?.connected ? 'Spotify connected' : 'Connect one')
      + '<div class="wph">On Home</div>'
      + P.pill('homeclock', P.IC.clock, 'Clock', look.clock, look.clock !== 'Off') + pill('homeweather', P.IC.cloud, 'Weather', look.weather) + pill('homeplayer', P.IC.note, 'Music', look.player !== false) + pill('homesys', P.IC.gauge, 'This PC', look.sys !== false)
      + onScreen.map(w => pill('wg:' + w.key, P.IC.widgets, w.name, !look.off?.includes(w.key))).join('')
      + P.pill('addwidget', P.IC.plus, 'More widgets', 'Add, arrange') + P.pill('editb', P.IC.sliders, editB ? 'Done' : 'Edit buttons', editB ? 'Keep these' : 'Choose yours', editB)
    if (list._html === html) return
    const had = document.activeElement?.closest?.('#tvpanel [data-w]')?.dataset.w
    list._html = html
    list.innerHTML = html
    list.querySelectorAll('[data-w]').forEach(n => { n.tabIndex = 0; if (n.tagName !== 'BUTTON') n.setAttribute('role', n.classList.contains('wps') ? 'slider' : 'button') })
    if (had) list.querySelector(`[data-w="${had}"]`)?.focus()
  }
  async function openPanel() {
    try { P ??= await import('/tv/panel.js?v=7') } catch { return }
    paintPanel()
    panel.classList.add('on')
    dock()
    setTimeout(paintRail, 60)
    readPc()
    await readTv()
    if (TV?.on) post({ type: 'state' })
    soon()
    clearInterval(poll)
    poll = setInterval(() => { if (document.hidden) return; if (TV?.on) post({ type: 'state' }); setTimeout(readTv, 800); readPc() }, 4000)
  }
  // Seek on the bar, where the player allows it; the cover brings the player forward.
  document.addEventListener('pointerdown', e => {
    const bar = e.target.closest?.('.mp-bar.seek')
    if (!bar || !bar._dur || !bar.closest('#tvside, #tvpanel')) return
    e.preventDefault()
    e.stopPropagation()
    const line = bar.querySelector('.mp-line'), tv = !!bar.closest('#tvpanel') && TV?.on && look.target === 'tv'
    const where = ev => { const r = line.getBoundingClientRect(); return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) }
    const show = k => { bar._drag = true; line.querySelector('i').style.transform = `scaleX(${k})`; bar.style.setProperty('--at', `${k * 100}%`); const n = Math.floor(k * bar._dur); bar.querySelector('.mp-at').textContent = `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` }
    show(where(e))
    const move = ev => show(where(ev))
    const up = ev => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up)
      bar._drag = false
      if (ev.type === 'pointercancel') return
      const to = where(ev) * bar._dur, m = tv ? TV.state?.media : MU?.now
      if (m) { m.pos = to; P.noted(m) }
      fetch('/api/music/do', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ action: 'seek', to, ...(tv ? { from: 'tv' } : {}) }) }).then(r => r.json()).then(r => { if (!r.ok) say(r.error || 'That player doesn’t allow it.'); setTimeout(readPc, 900) }, () => {})
    }
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up)
  }, true)
  document.addEventListener('click', e => {
    if (!e.target.closest?.('#tvside .mp-art[data-open], #tvpanel .mp-art[data-open]')) return
    e.stopPropagation()
    fetch('/api/music/open', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: '{}' }).then(r => r.json()).then(r => { if (!r.ok) say(r.error || 'That didn’t open.') }, () => {})
  }, true)
  // The player at the top right of Home is your TV's.
  document.addEventListener('click', e => { const b = e.target.closest('#tvside .mp-b'); if (b) { e.stopPropagation(); press(b.dataset.w) } }, true)
  let sideAt = 0
  async function keepTv() {
    if (document.hidden || !document.documentElement.hasAttribute('data-tvlook') || !document.querySelector('.hw-root') || Date.now() - sideAt < 4000) return
    sideAt = Date.now()
    try { P ??= await import('/tv/panel.js?v=7') } catch { return }
    if (TV?.on) post({ type: 'state' })
    await Promise.all([readTv(), readPc()])
  }
  function closePanel() { clearInterval(poll); panel.classList.remove('on'); dock(); setTimeout(paintRail, 60); if (panel.contains(document.activeElement)) btn.focus() }
  btn.addEventListener('click', e => { e.stopPropagation(); panel.classList.contains('on') ? closePanel() : openPanel() })
  // Beside the page on a computer, so everything stays clickable; over it on a phone or a narrow window, where a tap outside closes it.
  const docked = () => document.documentElement.hasAttribute('data-tvlook') && innerWidth >= 980
  const dock = () => { const on = panel.classList.contains('on') && docked(); if (document.documentElement.hasAttribute('data-dock') !== on) { document.documentElement.toggleAttribute('data-dock', on); if (mirror.classList.contains('on')) setTimeout(fitMirror, 300); setTimeout(fitRow, 320) } }
  addEventListener('resize', dock)
  document.addEventListener('pointerdown', e => { if (panel.classList.contains('on') && !docked() && !panel.contains(e.target) && !btn.contains(e.target) && !e.target.closest?.('[data-rail="overlay"]')) closePanel() })
  // From any page: Ctrl+. (and the sidebar).
  addEventListener('keydown', e => { if (e.key === '.' && (e.ctrlKey || e.metaKey) && !e.altKey && document.documentElement.matches('[data-tvlook], [data-tvtouch]')) { e.preventDefault(); panel.classList.contains('on') ? closePanel() : openPanel() } })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('on')) { e.stopPropagation(); closePanel() } }, true)
  const off = () => say('Your TV isn’t connected')
  const say = t => (window.hud ? window.hud(t) : console.warn(t))
  async function music(action, from) {
    if (MU?.now) { if (action === 'toggle') MU.now.playing = !MU.now.playing; paintPanel(); paintSide() }
    try { const r = await (await fetch('/api/music/do', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ action, ...(from ? { from } : {}) }) })).json(); if (!r.ok) say(r.error || 'That didn’t go through.') } catch { say('The hub didn’t answer.') }
    setTimeout(readPc, 700)
  }
  async function setSound(to) {
    const was = SND?.to
    if (SND) SND.to = to
    paintPanel()
    const r = await fetch('/api/tv/audio', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ to }) }).then(r => r.json(), () => ({ error: 'The hub didn’t answer.' }))
    if (!r.ok) { if (SND) SND.to = was; say(r.error || 'That didn’t change.') }
    setHtml = ''
    paintSettings()
    for (const t of [1200, 3500]) setTimeout(readPc, t)
  }
  async function setMonitor(id) {
    const m = MU?.monitors?.find(x => x.id === id)
    if (!m) return
    m.on = !m.on
    paintPanel()
    const r = await fetch('/api/music/monitors', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ id, on: m.on }) }).then(r => r.json(), () => ({}))
    if (!r.ok) say('That didn’t save.')
    await readPc()
    setHtml = ''
    paintSettings()
  }
  function press(id) {
    if (id === 'homeclock') { look.clock = CLOCKS[(CLOCKS.indexOf(look.clock) + 1) % CLOCKS.length]; return saveLook() }
    if (id === 'homeweather') { look.weather = !look.weather; return saveLook() }
    const tvSide = !!TV?.on && look.target === 'tv'
    if (id.startsWith('to:')) { look.target = id.slice(3); return saveLook() }
    if (['prev', 'play', 'next'].includes(id)) return music(id === 'play' ? 'toggle' : id, tvSide && panel.classList.contains('on') ? 'tv' : undefined)
    if (id === 'homesys') { look.sys = look.sys === false; saveLook(); return paintSide() }
    if (id === 'music') { const k = ['auto', 'pc', ...(MU?.spotify?.connected ? ['spotify'] : []), ...(TV?.on ? ['tv'] : [])], to = k[(k.indexOf(MU?.source) + 1) % k.length]; if (MU) MU.source = to; paintPanel(); return void fetch('/api/music/source', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ source: to }) }).then(readPc, () => {}) }
    const leave = () => { if (!docked()) closePanel() }
    if (id === 'musicset') { leave(); openSettings(); return onSet('musicpage') }
    if (id === 'ask') { leave(); closeSettings(); closeMirror(); return window.HubChat?.open() }
    if (id === 'pcsaver') { closePanel(); return void setTimeout(() => window.HubSaver.start(), 300) }
    if (id === 'mirror') { leave(); return openMirror() }
    if (id === 'homeplayer') { look.player = look.player === false; saveLook(); return paintSide() }
    if (id.startsWith('wg:')) { const k = id.slice(3), o = look.off || []; look.off = o.includes(k) ? o.filter(x => x !== k) : [...o, k]; saveLook(); return paintSide() }
    if (id === 'addwidget') { closePanel(); window.HubChat?.close(); closeSettings(); closeMirror(); return goHome('[data-hw-act="add"]') }
    if (id === 'settings') { leave(); closeMirror(); return openSettings() }
    if (id === 'pcbrowser') { leave(); closeSettings(); closeMirror(); window.HubChat?.close(); return window.HubBrowser?.open() }
    if (id === 'pcfiles') { leave(); closeSettings(); closeMirror(); window.HubChat?.close(); return seg.querySelector('[data-env="drives"]')?.click() }
    if (id === 'pcadd') { leave(); return window.HubDesk?.open() }
    if (id === 'pcmute') { const to = MU?.volume > 0 ? 0 : look.unmute || 40; if (MU?.volume > 0) { look.unmute = MU.volume; saveLook() } const n = panel.querySelector('.wps[data-w="volume"]'); return n && setSlide(n, to, true) }
    if (id.startsWith('mon:')) return setMonitor(id.slice(4))
    if (id === 'editb') { editB = !editB; return paintPanel() }
    if (id.startsWith('eb:')) { const b = id.slice(3), l = picked(); if (l.includes(b) && l.length <= 4) return say('Keep at least four buttons.'); look.btns = l.includes(b) ? l.filter(x => x !== b) : [...l, b]; return saveLook() }
    if (id.startsWith('snd:')) return setSound(id.slice(4))
    if (id === 'pcedit') { leave(); closeSettings(); closeMirror(); window.HubChat?.close(); return goHome('.hw-root:not(.hw-edit) [data-hw-act="edit"]') }
    if (id === 'remotes') { leave(); closeMirror(); openSettings(); return onSet('remotepage') }
    if (id === 'tvpower') return void power()
    if (id === 'tvhome') return TV?.on ? void post({ type: 'home' }) : off()
    if (id === 'displays') { leave(); closeMirror(); openSettings(); return onSet('displaypage') }
    if (!TV?.on) return off()
    if (id.startsWith('input:')) post({ type: 'input', name: id.slice(6) })
    else if (id === 'sleep') void power(false)
    else if (['home', 'saver'].includes(id)) post({ type: id })
    else if (['tvback', 'tvmenu'].includes(id)) post({ type: 'key', name: id.slice(2) })
    soon()
  }
  panel.addEventListener('click', e => { if (e.target.closest('[data-tvpx]')) return closePanel(); const n = e.target.closest('[data-w]'); if (n && !n.classList.contains('wps')) press(n.dataset.w) })
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
    const id = n.dataset.w, pcSide = !(TV?.on && look.target === 'tv'), val = Math.max(id === 'brightness' ? (pcSide ? 5 : 20) : 0, Math.min(100, Math.round(v)))
    n.querySelector('i').style.height = `${val}%`
    if (!send) return
    if (pcSide) { if (MU) MU[id] = val; return void fetch('/api/music/level', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ what: id, value: val }) }).then(r => r.json()).then(r => { if (!r.ok) say(r.error || 'That didn’t change.') }, () => {}) }
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
  mirror.innerHTML = `<div class="tvm-head">${mb('leave', 'Back to LocalHub', '<path d="M15 5l-7 7 7 7"/>')}<b class="tvm-name">Your TV</b><span>Arrow keys move · Enter opens · Esc goes back · click anything · type in a text box</span>${mb('back', 'Back on the TV', '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>')}${mb('home', 'TV home', IC.home)}${mb('power', 'Turn the TV on or off', '<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>')}</div><div class="tvm-fit"><div class="tvm-screen"><iframe title="Your TV" sandbox="allow-same-origin" tabindex="-1"></iframe><canvas width="1280" height="720" hidden></canvas><div class="tvm-cover"></div><div class="tvm-note">Connecting to your TV…</div></div></div>`
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
    const css = [...page.matchAll(/<link rel="stylesheet" href="\.\/([\w.?=-]+)">/g)].map(m => m[1]).concat('stream.css?v=2', 'assistant.css').filter((x, i, l) => l.findIndex(y => y.split('?')[0] === x.split('?')[0]) === i).map(x => `<link rel="stylesheet" href="/tv/${x}">`).join('')
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
        if (isLive()) continue
        note(m.away ? 'Another app is open on the TV. Press TV home to come back to LocalHub.' : m.stream ? 'The TV’s browser is open. The arrow keys still work in it.' : '')
      } catch { await new Promise(w => setTimeout(w, 1500)) }
    }
  }
  // The TV's real screen (tv-screen.mjs), in any app: H.264, drawn as it arrives. Without it, LocalHub's own page as before.
  const mCanvas = mirror.querySelector('canvas'), mName = mirror.querySelector('.tvm-name')
  let live = null
  const bytes = (...l) => { const o = new Uint8Array(l.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of l) { o.set(x, i); i += x.length } return o }
  async function watchScreen(run) {
    if (!('VideoDecoder' in window)) return false // an address that isn't https or this computer
    const stop = new AbortController(), g = mCanvas.getContext('2d', { alpha: false, desynchronized: true })
    let dec = null, head = [], got = false
    const reset = () => { try { dec?.close() } catch {} dec = null; head = [] }
    let r
    try { r = await fetch('/api/tv/screen', { cache: 'no-store', signal: stop.signal }) } catch { return false }
    if (run !== mRun || !r.ok) { stop.abort(); return false }
    live = { stop, state: null }
    const me = live
    const frame = f => { try { g.drawImage(f, 0, 0, 1280, 720) } finally { f.close() } if (!got) { got = true; mSeen = Date.now(); mCanvas.hidden = false; clearInterval(mBeat); post({ type: 'mirror', on: false }); screenNote() } }
    const nal = n => {
      const type = n[n[2] === 1 ? 3 : 4] & 31, at = performance.now() * 1000
      if (type === 7) { reset(); head = [n]; const o = n[2] === 1 ? 4 : 5; dec = new VideoDecoder({ output: frame, error: () => reset() }); dec.configure({ codec: `avc1.${[n[o], n[o + 1], n[o + 2]].map(v => v.toString(16).padStart(2, '0')).join('')}`, optimizeForLatency: true }) }
      else if (type === 8) head.push(n)
      else if (!dec || dec.state !== 'configured') return
      else if (type === 5) { dec.decode(new EncodedVideoChunk({ type: 'key', timestamp: at, data: bytes(...head, n) })); dec._key = true }
      else if (type === 1 && dec._key) dec.decode(new EncodedVideoChunk({ type: 'delta', timestamp: at, data: n }))
    }
    ;(async () => {
      const rd = r.body.getReader()
      let buf = new Uint8Array(0)
      try {
        for (;;) {
          const { done, value } = await rd.read()
          if (done || run !== mRun) break
          buf = buf.length ? bytes(buf, value) : value
          let i = 0
          while (buf.length - i >= 5) {
            const len = new DataView(buf.buffer, buf.byteOffset + i + 1, 4).getUint32(0)
            if (buf.length - i < 5 + len) break
            const body = buf.slice(i + 5, i + 5 + len), kind = buf[i]
            i += 5 + len
            if (kind === 1) { try { nal(body) } catch { reset() } } else if (kind === 2) { me.state = JSON.parse(new TextDecoder().decode(body)); screenNote() }
          }
          buf = buf.subarray(i)
        }
      } catch {}
      reset()
      stop.abort()
      if (live === me) live = null
      if (run !== mRun) return
      // The TV went off the network, or the hub restarted: try again.
      note('Reconnecting to your TV…')
      setTimeout(async () => { while (run === mRun && !live && !(await watchScreen(run))) await new Promise(w => setTimeout(w, 4000)) }, 1500)
    })()
    return true
  }
  function screenNote() {
    const st = live?.state
    if (!st) return
    const here = st.app === 'local.hub.tv', name = TV?.names?.[st.app]
    mName.textContent = st.awake && !here && name ? name : 'Your TV'
    if (st.awake && mCanvas.hidden) return
    note(st.awake ? '' : 'The TV is off. Press the power button to turn it on.')
    tvPower = st.awake
  }
  // Keys and clicks: straight to whatever is on the TV while its screen is live, else to LocalHub's page there.
  let sending = null
  const queue = []
  async function toScreen(ev) {
    queue.push(ev)
    if (sending) return
    while (queue.length) {
      sending = fetch('/api/tv/screen/input', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ events: queue.splice(0, 50) }) }).catch(() => {})
      const r = await sending
      if (r && !r.ok && r.status === 409) say('One moment. The TV is still connecting.')
    }
    sending = null
  }
  const isLive = () => !!live?.state && !mCanvas.hidden
  function drive(c) {
    if (!isLive()) return post(c)
    const inHub = live.state.app === 'local.hub.tv'
    if (c.type === 'tap') return inHub ? post(c) : toScreen({ tap: [c.x / 1920, c.y / 1080].map(v => Math.max(0, Math.min(1, v))) })
    if (c.type === 'type') return inHub ? post(c) : toScreen(c.text === '\b' ? { key: 'del' } : { text: c.text })
    return toScreen({ key: c.name }) // as the remote's own, so the TV's keyboard gets them too
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
    if (!TV?.on) {
      note('Your TV isn’t connected. Open LocalHub on it, and it shows here.')
      fetch('/api/tv/power', { cache: 'no-store' }).then(r => r.json()).then(r => { if (run === mRun && !mSeen && r.known) note(r.on ? 'The TV is on. Press TV home to open LocalHub on it.' : 'The TV is off. Press the power button to turn it on.') }, () => {})
    }
    mCanvas.hidden = true
    mName.textContent = 'Your TV'
    const real = watchScreen(run)
    try { await frameCss() } catch { return note('The TV’s page didn’t load') }
    if (run !== mRun || isLive()) return
    await Promise.race([real, new Promise(w => setTimeout(w, 1200))])
    if (run !== mRun || isLive()) return
    const beat = () => post({ type: 'mirror', on: true })
    beat()
    mBeat = setInterval(() => { if (!document.hidden) beat() }, 4000)
    mTimer = setInterval(() => { if (!mSeen) readTv().then(() => { if (run === mRun && !mSeen) TV?.on && note('Connecting to your TV…') }) }, 5000)
    watch(run)
  }
  function closeMirror() {
    if (!mirror.classList.contains('on')) return
    mRun++
    clearInterval(mBeat)
    clearInterval(mTimer)
    live?.stop.abort()
    live = null
    post({ type: 'mirror', on: false })
    mirror.classList.remove('on')
    setTimeout(paintRail, 60)
  }
  // On or off, asked of the TV itself, so it works while it's asleep too.
  let powering = false
  async function power(on = 'toggle') {
    if (powering) return
    powering = true
    const b = mirror.querySelector('[data-key="power"]')
    b?.classList.add('busy')
    note(on === false ? 'Turning the TV off…' : on ? 'One moment…' : '')
    try {
      const r = await (await fetch('/api/tv/power', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ on }) })).json()
      if (r.error) { note(r.error); say(r.error) }
      else if (r.on) { note('The TV is on. Opening LocalHub on it…'); mSeen = 0; setTimeout(() => { if (mirror.classList.contains('on')) post({ type: 'mirror', on: true }) }, 6000) }
      else note('The TV is off. Press the power button to turn it on.')
      tvPower = r.error ? null : r.on
    } catch { note('The hub didn’t answer.') }
    b?.classList.remove('busy')
    powering = false
    soon()
  }
  let tvPower = null
  const MKEY = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'enter', Escape: 'back', BrowserBack: 'back', ContextMenu: 'menu', PageUp: 'rew', PageDown: 'ff', MediaPlayPause: 'ai' }
  mirror.addEventListener('click', e => {
    const k = e.target.closest('[data-key]')?.dataset.key
    if (k === 'leave') return closeMirror()
    if (k === 'power') return void power()
    else if (k === 'home' && !TV?.on && !isLive()) return void power(true)
    else if (k) drive({ type: 'key', name: k })
    else if (e.target.closest('.tvm-cover')) { const r = mScreen.getBoundingClientRect(); drive({ type: 'tap', x: (e.clientX - r.left) / r.width * 1920, y: (e.clientY - r.top) / r.height * 1080 }) }
    mirror.focus()
  })
  mirror.addEventListener('wheel', e => { e.preventDefault(); const now = Date.now(); if (now - (mirror._w || 0) < 160) return; mirror._w = now; drive({ type: 'key', name: e.deltaY > 0 ? 'down' : 'up' }) }, { passive: false })
  document.addEventListener('keydown', e => {
    if (!mirror.classList.contains('on') || e.ctrlKey || e.metaKey || e.altKey || panel.classList.contains('on') || document.querySelector('#dkadd.on')) return
    if (e.target.closest?.('.tvm-b') && (e.key === 'Enter' || e.key === ' ')) return
    const name = MKEY[e.key]
    if (!name && e.key !== 'Backspace' && e.key.length !== 1) return
    e.preventDefault()
    e.stopPropagation()
    drive(name ? { type: 'key', name } : { type: 'type', text: e.key === 'Backspace' ? '\b' : e.key })
  }, true)
  addEventListener('resize', () => { if (mirror.classList.contains('on')) fitMirror() })
  document.addEventListener('click', e => { if (e.target.closest('[data-hw-takeover]')) { e.stopPropagation(); openMirror() } }, true)
  // The old TV link (/#tv and the like) and a saved device view come back to Home.
  const toDesktop = () => { const r = document.querySelector('.hw-root'); if (r && document.documentElement.hasAttribute('data-tvlook') && r.dataset.view !== 'desktop' && r.dataset.phone !== '1') r.querySelector('[data-hw-mode="desktop"]')?.click() }

  // The name of what you're on, large above the row, as on the TV.
  const nameEl = top.querySelector('.tvt-name')
  const setName = e => { const c = e.target.closest?.('#dk .dk-t, #dkfav .dk-t'); nameEl.textContent = c && c.dataset.dk !== 'add' && c.dataset.dk !== 'addfav' ? c.getAttribute('aria-label') : '' }
  document.addEventListener('pointerover', setName, { passive: true })
  document.addEventListener('focusin', setName)

  // Where you were in each tab comes back with it.
  const spots = {}
  const spotKey = () => [...seg.querySelectorAll('button[data-env]')].find(isOn)?.dataset.env || 'home'
  let homeY = 0, homePager = null, hush = 0
  document.addEventListener('scroll', e => {
    if (e.target?.classList?.contains('hw-pager')) { if (homePager === e.target) homeY = e.target.scrollTop }
    else if (e.target === document) { const k = spotKey(); if (Date.now() > hush && (k === 'home') === !!document.querySelector('#main .hw-root')) spots[k] = { y: scrollY, at: document.getElementById('title')?.textContent } }
  }, { capture: true, passive: true })
  // And at the moment you leave, before anything moves.
  document.addEventListener('click', e => { if (!e.target.closest?.('#tvrail [data-rail], #seg [data-env]')) return; const k = spotKey(); if ((k === 'home') === !!document.querySelector('#main .hw-root')) spots[k] = { y: scrollY, at: document.getElementById('title')?.textContent } }, true)
  function keepSpots() {
    const p = document.querySelector('.hw-root .hw-pager')
    if (p !== homePager) { homePager = p; if (p && homeY) requestAnimationFrame(() => { p.scrollTop = homeY }) }
  }
  let spotEnv = ''
  new MutationObserver(() => {
    const k = spotKey()
    if (k === spotEnv) return
    const first = !spotEnv
    spotEnv = k
    if (!first) { closeSettings(); closeMirror(); window.HubBrowser?.close?.() }
    keepSpots()
    const s = spots[k]
    hush = Date.now() + 700
    if (!s) return void scrollTo(0, 0)
    let tries = 40
    const back = () => { if (spotKey() !== k) return; if (document.getElementById('title')?.textContent === s.at && (k !== 'home' || document.querySelector('#dk .dk-t')) && document.documentElement.scrollHeight >= s.y + innerHeight - 4) scrollTo(0, s.y); else if (tries--) setTimeout(back, 100) }
    back()
  }).observe(seg, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] })

  // ── Settings: a page of rows, as on the TV ──
  const set = document.createElement('section')
  set.id = 'tvset'
  set.setAttribute('aria-label', 'Settings')
  document.body.append(set)
  const SORTS = [['mine', 'My order'], ['recent', 'Recently opened'], ['most', 'Most opened'], ['fav', 'Favorites first'], ['type', 'By type'], ['web', 'Websites first'], ['pc', 'Programs first'], ['az', 'A to Z'], ['za', 'Z to A']], SORT_NAMES = Object.fromEntries(SORTS)
  let forgot = false, STAT = null, find = '', ID = null, idMsg = '', idSaved = false, idT = 0, AX = null, axMsg = ''
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
      { group: 'LocalHub Settings' },
      { id: 'hubname', t1: 'Hub name', t2: 'On this computer, your phone and the TV', v: H()?.name || window.HUB_CONF?.name || 'LocalHub' },
      { id: 'hubicon', t1: 'Hub icon', t2: 'In the sidebar, the tab and the TV', v: !ID ? '' : ID.icon === 'upload' ? 'Your picture' : ID.icon ? 'Custom' : 'LocalHub', pic: hubIcon },
      { id: 'theme', t1: 'Theme', t2: 'Light is the hub’s older look', v: THEMES[st.theme] || 'Dark' },
      { id: 'style', t1: 'Accent, font and wallpapers', t2: 'The style editor, and adding your own pictures', v: '' },
      { info: true, t1: 'Version', t2: '', v: version || '' },
      { group: 'Home Screen' },
      { id: 'clock', t1: 'Home clock', t2: 'What the top left of Home shows', v: look.clock, on: look.clock !== 'Off' },
      { id: 'weather', t1: 'Home weather', t2: 'At the top right', v: look.weather ? 'On' : 'Off', on: look.weather },
      { id: 'plr', t1: 'Music on Home', t2: 'What’s playing, at the top right', v: look.player !== false ? 'On' : 'Off', on: look.player !== false },
      { id: 'syscard', t1: 'This PC on Home', t2: 'Processor, memory and disk', v: look.sys !== false ? 'On' : 'Off', on: look.sys !== false },
      { id: 'sortapps', t1: 'Sort apps', t2: 'The order of the tiles on Home', v: SORT_NAMES[look.sort] || 'My order' },
      { id: 'addapps', t1: 'Apps and websites', t2: 'What is on Home', v: '' },
      { id: 'edit', t1: 'Widgets', t2: 'Add and arrange them', v: '' },
      { id: 'tabs', t1: 'Sidebar', t2: 'Extra tabs under Files', v: '' },
      { group: 'Display and Sound' },
      { id: 'displaypage', t1: 'Brightness', t2: 'Which monitors the slider moves, and each one on its own', v: !MU?.monitors?.length ? '' : MU.monitors.every(m => m.on) ? (MU.monitors.length > 1 ? 'All monitors' : MU.monitors[0].name) : `${MU.monitors.filter(m => m.on).length} of ${MU.monitors.length} monitors` },
      ...(SND?.available ? [{ id: 'sound', t1: 'Sound plays on', t2: 'This PC’s sound here, on your TV, or both. On both, the TV is a moment behind', v: { pc: 'This PC', tv: 'Your TV', both: 'Both' }[SND.to], on: SND.to !== 'pc' }] : []),
      { id: 'panel', t1: 'Controls', t2: 'Brightness, volume, music and your TV, beside any page', v: 'Ctrl+.' },
      { group: 'Devices and Connections' },
      { id: 'devpage', t1: 'Devices and connections', t2: 'Phones, iPads and computers, your home network, Tailscale and the passcode', v: DV.summary },
      { id: 'remotepage', t1: 'Remotes and controllers', t2: 'What each button does, on the Fire TV remote or a game controller', v: KEYS.on ? 'In every app' : '' },
      { id: 'tvcontrol', t1: 'Your TV', t2: 'Its screen here, in any app, with your keyboard and mouse', v: TV?.on ? 'Connected' : 'Not connected', on: !!TV?.on },
      { id: 'tvsetup', t1: 'Set up a TV', t2: 'Put LocalHub TV on a television and pair it', v: '' },
      { id: 'musicpage', t1: 'Music platforms', t2: 'What the music widget plays and controls', v: MU?.spotify?.connected ? 'Spotify' : MU?.pc ? 'This PC' : '' },
      ...(window.HUB_CONNECTIONS ? [{ id: 'connections', t1: 'Services', t2: 'Gmail, Notion, GitHub and the rest the assistant can use', v: DV.services }] : []),
      { id: 'lockpage', t1: 'Entry code', t2: 'A 4- or 6-digit code to get into the TV, this computer, or places you choose', v: LK?.conf().on ? `On, ${LK.conf().digits} digits` : 'Off', on: !!LK?.conf().on },
      { group: 'Assistant' },
      { id: 'alexapage', t1: 'Alexa', t2: '“Alexa, ask local hub to open Netflix”, from the remote or any Echo', v: AX?.on ? 'On' : AX?.skillId ? 'Not answering' : 'Set up', on: !!AX?.on },
      { id: 'claude', t1: 'Claude', t2: 'What the assistant runs on', v: DV.claude },
      ...(listen ? [{ id: 'listen', t1: 'Hey LocalHub', t2: 'This computer’s microphone listens for it', v: listen.on ? 'On' : 'Off', on: listen.on }] : []),
      { group: 'Background and Screensaver' }, ...dev('desktop'), ...dev('mobile'),
      { group: 'Your Setup' },
      { id: 'export', t1: 'Save a copy of your settings', t2: 'One file with your tabs, websites, pages, widgets and look. No keys or passwords', v: '' },
      { id: 'import', t1: 'Bring settings back', t2: 'From a file you saved here or on another computer', v: '' },
      { id: 'forget', t1: 'Forget which apps you open', t2: 'What “Recently opened” and “Most opened” go by, on this device', v: forgot ? 'Forgotten' : '' },
      { group: 'Help' },
      { id: 'keyspage', t1: 'Keyboard shortcuts', t2: '', v: '' },
      { id: 'statuspage', t1: 'Status and storage', t2: 'What’s running, what’s connected and the room it takes', v: '' },
      { id: 'setup', t1: 'Set up LocalHub', t2: 'trylocalhub.com/setup', v: '' },
    ]
  }
  // What the search finds, under its own heading still.
  function found(list) {
    const q = find.trim().toLowerCase()
    if (!q) return list
    const out = []
    let head = null
    for (const r of list) {
      if (r.group) { head = r; continue }
      if (!`${r.t1} ${r.t2} ${r.v} ${head?.group || ''}`.toLowerCase().includes(q)) continue
      if (head) { out.push(head); head = null }
      out.push(r)
    }
    return out.length ? out : [{ group: 'Nothing by that name' }]
  }
  set.addEventListener('input', e => {
    if (!e.target.classList.contains('tvs-find')) return
    find = e.target.value
    const at = e.target.selectionStart
    paintSettings()
    const n = set.querySelector('.tvs-find')
    n.focus()
    n.setSelectionRange(at, at)
  })
  function paintSettings() {
    if (!set.classList.contains('on')) return
    const backB = `<button type="button" data-set="back" aria-label="Back">${svg('<path d="M15 5l-7 7 7 7"/>')}</button>`
    if (['display', 'keys', 'status', 'hub', 'alexa'].includes(picking)) {
      if (sliding || (picking === 'hub' && /^(hubnm|hubtx)$/.test(document.activeElement?.id || '')) || document.activeElement?.id === 'axid') return
      const art = { display: 'One slider for every screen', keys: 'Everything without the mouse', status: 'How it’s all doing', hub: ID?.name || '', alexa: 'Alexa listens, LocalHub does it' }[picking]
      const html = `<div class="tvs-art"><img src="${hubIcon}" alt=""><p>${art}</p></div><div class="tvs-list">${picking === 'hub' ? hubHtml(backB) : picking === 'alexa' ? alexaHtml(backB) : picking === 'display' ? displayHtml(backB) : picking === 'keys' ? keysHtml(backB) : statusHtml(backB)}</div>`
      if (setHtml === html) return
      const y5 = set.querySelector('.tvs-list')?.scrollTop || 0
      setHtml = html
      set.innerHTML = html
      set.querySelector('.tvs-list').scrollTop = y5
      return
    }
    if (picking === 'lock') {
      const html = `<div class="tvs-art"><img src="${hubIcon}" alt=""><p>Keeps people out of the screens you choose</p></div><div class="tvs-list">${lockHtml(backB)}</div>`
      if (setHtml === html) return
      const y4 = set.querySelector('.tvs-list')?.scrollTop || 0
      setHtml = html
      set.innerHTML = html
      set.querySelector('.tvs-list').scrollTop = y4
      return
    }
    if (picking === 'devices') {
      const a = document.activeElement
      if (a && set.contains(a) && a.matches('input')) return
      const html = `<div class="tvs-art"><img src="${hubIcon}" alt=""></div><div class="tvs-list">${devicesHtml(backB)}</div>`
      if (setHtml === html) return
      const y3 = set.querySelector('.tvs-list')?.scrollTop || 0
      setHtml = html
      set.innerHTML = html
      set.querySelector('.tvs-list').scrollTop = y3
      return
    }
    if (picking === 'music' || picking === 'remote') {
      const html2 = picking === 'music' ? musicHtml(backB) : remoteHtml(backB)
      const html = picking === 'music' ? `<div class="tvs-art"><img src="${hubIcon}" alt=""><p>Music, wherever it plays</p></div><div class="tvs-list">${html2}</div>` : `<div class="tvs-art${rmKind === 'pad' ? ' wide' : ''}">${RM ? RM.pictureHTML(rmKind, rmSel, btns()) : ''}</div><div class="tvs-list">${html2}</div>`
      if (setHtml === html || set.contains(document.activeElement) && document.activeElement.matches('input, select')) return
      const y2 = set.querySelector('.tvs-list')?.scrollTop || 0
      setHtml = html
      set.innerHTML = html
      set.querySelector('.tvs-list').scrollTop = y2
      return
    }
    const list = picking
      ? `<div class="tvs-title">${backB}${DEVS[picking]} background</div><div class="tvs-walls">${walls().map(w => `<button type="button" class="tvs-wall${devLook(picking).wallpaper === w.id ? ' on' : ''}" data-wall="${esc(w.id)}"><i style="background-image:${esc(w.css)}"></i><span>${esc(w.name)}</span></button>`).join('')}</div>`
      : `<div class="tvs-title top">${backB}Settings<input class="tvs-find" type="search" placeholder="Search settings" aria-label="Search settings" spellcheck="false" value="${esc(find)}"></div>` + found(rows()).map(r => r.group ? `<div class="tvs-group">${esc(r.group)}</div>` : `<${r.info ? 'div' : 'button type="button"'} class="tvs-row"${r.id ? ` data-set="${esc(r.id)}"` : ''}><div class="txt"><div class="t1">${esc(r.t1)}</div>${r.t2 ? `<div class="t2">${esc(r.t2)}</div>` : ''}</div>${r.pic ? `<img class="pic" src="${esc(r.pic)}" alt="">` : ''}<div class="v${r.on ? ' on' : ''}">${esc(r.v)}</div></${r.info ? 'div' : 'button'}>`).join('')
    const html = `<div class="tvs-art"><img src="${hubIcon}" alt=""></div><div class="tvs-list">${list}</div>`
    if (setHtml === html) return
    const y = set.querySelector('.tvs-list')?.scrollTop || 0, f = document.activeElement?.dataset?.set
    setHtml = html
    set.innerHTML = html
    set.querySelector('.tvs-list').scrollTop = y
    if (f) set.querySelector(`[data-set="${CSS.escape(f)}"]`)?.focus()
  }
  // ── Settings › Entry code ──
  let lkPin = '', lkMsg = ''
  const PLACE = { tv: ['LocalHub on the TV', 'Asked when it opens, and after it has been away'], desk: ['LocalHub on computers and phones', 'Asked when the page opens'], control: ['Controlling the TV from here', 'The TV page in the sidebar'], files: ['Files', 'On the TV and here'], assistant: ['Assistant', 'On the TV and here'], browser: ['Browser', 'On the TV and here'], settings: ['Settings', 'On the TV and here'] }
  const AFT = { 0: 'Every time', 1: 'After 1 minute', 5: 'After 5 minutes', 15: 'After 15 minutes', 60: 'After an hour' }
  function lockHtml(backB) {
    const c = LK?.conf() || { on: false, places: [], apps: [], after: 5, digits: 4 }
    const row = (t1, t2, v, id, on) => `<button type="button" class="tvs-row" data-set="${esc(id)}"><div class="txt"><div class="t1">${esc(t1)}</div>${t2 ? `<div class="t2">${esc(t2)}</div>` : ''}</div><div class="v${on ? ' on' : ''}">${esc(v)}</div></button>`
    const g = t => `<div class="tvs-group">${t}</div>`, msg = lkMsg ? `<div class="tvs-msg">${esc(lkMsg)}</div>` : ''
    const title = `<div class="tvs-title">${backB}Entry code</div>${msg}`
    if (!DV.local) return title + g('The code') + `<div class="tvs-row"><div class="txt"><div class="t1">${c.on ? 'On' : 'Off'}</div><div class="t2">Set it on the computer running LocalHub</div></div></div>`
    if (!c.on) return title + g('Choose a code') + row('Use a 4-digit code', 'Quick with a remote', '', 'lknew:4') + row('Use a 6-digit code', 'Harder to guess', '', 'lknew:6') + note2('Forgot it later? Delete data/lock.json in the LocalHub folder on this computer')
    return title + g('The code') + row('Change the code', `${c.digits} digits now`, '', 'lkchange') + row('Turn it off', 'Nothing asks any more', '', 'lkoff')
      + g('Ask for it at') + Object.entries(PLACE).map(([k, [a, b]]) => row(a, b, c.places.includes(k) ? 'On' : 'Off', `lkplace:${k}`, c.places.includes(k))).join('')
      + g('Ask again') + row('Once it’s unlocked', 'How long before it asks again', AFT[c.after], 'lkafter', true)
      + g('Apps on the TV') + ((TV?.apps || []).length ? TV.apps.map(n => row(n, '', c.apps.includes(n) ? 'Locked' : 'Open', `lkapp:${n}`, c.apps.includes(n))).join('') : row('No apps yet', 'They show once the TV has connected', '', 'lknone'))
      + note2('An app opened from Amazon’s own screens doesn’t ask. Forgot the code? Delete data/lock.json in the LocalHub folder on this computer')
  }
  async function setLock(body) {
    const r = await send('/api/lock', { pin: lkPin, ...body })
    if (!r.ok) { lkMsg = r.error || 'That didn’t save.'; lkPin = '' }
    else lkMsg = ''
    await LK.load()
    setHtml = ''
    paintSettings()
    return r.ok
  }
  // The code as it is now, asked once while you're on the page.
  async function lkNow() {
    if (!LK.conf().on || lkPin) return true
    const p = await LK.ask({ title: 'Enter the code', check: async pin => { const r = await send('/api/lock/check', { pin }); return r.ok === true && r.offline ? true : r.wait ? `Too many tries. Wait ${r.wait} s` : 'Wrong code' } })
    if (!p) return false
    lkPin = p
    return true
  }
  async function lkChoose(n) {
    let first = ''
    const a = await LK.ask({ title: `New ${n}-digit code`, sub: 'Choose it', digits: n, check: async p => { if (/^(\d)\1+$/.test(p) || '0123456789 9876543210'.includes(p)) return 'Too easy to guess. Try another'; return true } })
    if (!a) return
    first = a
    const b = await LK.ask({ title: 'Once more', sub: 'The same code again', digits: n, check: async p => (p === first ? true : 'Not the same. Try again') })
    if (!b) return
    const wasOn = LK.conf().on
    if (await setLock({ next: b })) { lkPin = b; deskOk = true; lkMsg = wasOn ? 'Code changed.' : 'The code is on.'; setHtml = ''; paintSettings() }
  }
  async function onLock(id) {
    const i = id.indexOf(':'), k = i < 0 ? id : id.slice(0, i), v = i < 0 ? '' : id.slice(i + 1), c = LK.conf()
    lkMsg = ''
    if (k === 'lknone') return
    if (k === 'lknew') return lkChoose(Number(v))
    if (!(await lkNow())) return
    if (k === 'lkchange') return lkChoose(c.digits)
    if (k === 'lkoff') { if (await setLock({ next: '' })) { lkPin = ''; lkMsg = 'The code is off.'; setHtml = ''; paintSettings() } return }
    if (k === 'lkplace') return setLock({ places: c.places.includes(v) ? c.places.filter(x => x !== v) : [...c.places, v] })
    if (k === 'lkapp') return setLock({ apps: c.apps.includes(v) ? c.apps.filter(x => x !== v) : [...c.apps, v] })
    if (k === 'lkafter') { const l = Object.keys(AFT).map(Number); return setLock({ after: l[(l.indexOf(c.after) + 1) % l.length] }) }
  }
  // ── Settings › Devices and connections ──
  const DV = { summary: '', services: '', claude: '', reach: null, lan: null, devices: [], power: null, pair: null, msg: '', ask: '', pass: false, local: ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) }
  const get = async u => { try { const r = await fetch(u, { cache: 'no-store' }); return r.ok ? await r.json() : null } catch { return null } }
  const send = async (u, b) => { try { const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify(b || {}) }); const j = await r.json().catch(() => ({})); return { ok: r.ok, ...j } } catch { return { ok: false, error: 'The hub didn’t answer.' } } }
  async function readDevices(all) {
    const [d, c, h, k] = await Promise.all([get('/api/pair/devices'), get('/api/connections'), get('/api/hub/setup'), get('/api/tv/keys')])
    DV.devices = d?.devices || []
    if (k) KEYS = k
    const n = (c?.connections || []).filter(x => x.connected).length
    DV.services = n ? `${n} connected` : 'None yet'
    DV.claude = !h ? '' : !h.claude?.installed ? 'Not installed' : h.claude.signedIn ? 'Signed in' : 'Not signed in'
    DV.summary = DV.devices.length ? `${DV.devices.length} paired` : ''
    if (all && DV.local) { const [r, l, p] = await Promise.all([get('/api/reach'), get('/api/tv/setup'), get('/api/tv/power')]); DV.reach = r; DV.lan = l?.lan || null; DV.power = p }
    paintSettings()
  }
  const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'Now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago` }
  const OS = { ios: 'iPhone or iPad', tv: 'Fire TV', android: 'Android', web: 'Browser', windows: 'Windows', macos: 'Mac', linux: 'Linux' }
  function devicesHtml(backB) {
    const row = (t1, t2, v = '', id = '', on = false) => `<${id ? 'button type="button"' : 'div'} class="tvs-row"${id ? ` data-set="${esc(id)}"` : ''}><div class="txt"><div class="t1">${esc(t1)}</div>${t2 ? `<div class="t2">${esc(t2)}</div>` : ''}</div><div class="v${on ? ' on' : ''}">${esc(v)}</div></${id ? 'button' : 'div'}>`
    const g = t => `<div class="tvs-group">${t}</div>`
    const R = DV.reach, ts = R?.tailscale, msg = DV.msg ? `<div class="tvs-msg">${esc(DV.msg)}</div>` : ''
    const pads = [...(navigator.getGamepads?.() || [])].filter(x => x?.connected)
    const title = `<div class="tvs-title">${backB}Devices and connections</div>${msg}`
    const devs = DV.devices.length ? DV.devices.map(d => `<div class="tvs-row"><div class="txt"><div class="t1">${esc(d.name)}</div><div class="t2">${esc(OS[d.platform] || 'Device')} · last here ${ago(d.lastSeen)}</div></div><button type="button" class="tvs-x" data-set="unpair:${esc(d.id)}">${DV.ask === d.id ? 'Remove it?' : 'Remove'}</button></div>`).join('') : row('Nothing paired yet', 'A phone or TV you add shows here')
    if (!DV.local) return title + g('Paired with this hub') + devs + g('More') + row('Do the rest on the hub’s own computer', 'Adding devices, the home network, Tailscale and the passcode are set there')
    const P = DV.pair
    const where = [R?.home?.url && ['Home network', R.home.url, R.home.qrSvg], ts?.on && ts.url && ['Tailscale, from anywhere', ts.url, ts.qrSvg]].filter(Boolean)
    const pairing = P ? `<div class="tvs-form tvs-pair"><div class="tvs-qr">${where[0] ? where[0][2] : ''}</div><div><b>${esc(P.code.replace(/(.{4})(?=.)/g, '$1 '))}</b><ol><li>On the phone, iPad or computer, ${where.length ? 'scan this or open' : 'turn on your home network below, then open'}:${where.map(x => `<br><code>${esc(x[1])}/pair</code> <i>${esc(x[0])}</i>`).join('')}</li><li>Type the code. It works once, for five minutes.</li></ol><button type="button" data-set="pairstop">Done</button></div></div>` : ''
    return title
      + g('Phones, iPads and computers') + (P ? pairing : row('Add a device', 'Shows a code to type on it once', '', 'pairstart')) + devs
      + g('Where LocalHub answers')
      + row('This computer', `http://localhost:${R?.port || 3100}`, 'Always', '', true)
      + row('Home network', DV.lan?.on ? DV.lan.url : DV.lan?.found === false ? 'This computer isn’t on one right now' : 'For the TV, and phones on your Wi-Fi', DV.lan ? (DV.lan.on ? 'On' : 'Off') : '…', 'lan', DV.lan?.on)
      + row('Tailscale', !ts ? 'Checking…' : !ts.installed ? 'Reach LocalHub from anywhere. Install it from tailscale.com, then come back' : !ts.running ? 'Installed. Open Tailscale on this computer and connect' : ts.on ? `${ts.url} · from any of your Tailscale devices` : `Connected as ${ts.name || ts.ip}. Turn on to reach LocalHub from anywhere`, !ts ? '' : !ts.installed ? 'Get it' : ts.on ? 'On' : 'Off', 'tailscale', ts?.on)
      + (DV.pass ? '<div class="tvs-form"><div><input id="dvpass" type="password" autocomplete="new-password" minlength="8" placeholder="New passcode, 8 or more characters" aria-label="New passcode"><button type="button" data-set="passsave">Save</button></div></div>' : row('Passcode', 'What another device types if it isn’t paired. Needed before the two above', R?.passcode ? (R.passcode.set ? 'Change' : 'Set one') : '', 'pass', !!R?.passcode?.set))
      + (ts?.running && ts.peers.length ? g('On your Tailscale') + ts.peers.map(x => row(x.name, x.os, x.online ? 'Online' : 'Offline', '', x.online)).join('') : '')
      + g('TV') + row('TV power', DV.power?.known === false ? DV.power.error : 'Works while it’s asleep too', DV.power?.known ? (DV.power.on ? 'On' : 'Off') : DV.power ? 'Not answering' : '…', DV.power?.known ? 'tvpower' : '', DV.power?.on) + row('Remotes and controllers', 'What each button does', KEYS.on ? 'In every app' : '', 'remotepage') + row('Set up a TV', 'Put LocalHub TV on a television and pair it', '', 'tvsetup')
      + g('Controllers on this computer') + (pads.length ? pads.map(x => row(x.id.replace(/\s*\(.*$/, ''), 'A opens, B goes back, X Controls, Y Assistant, Start Settings', 'Connected', '', true)).join('') : row('No controller yet', 'Plug one in, or pair it over Bluetooth, then press any button on it'))
      + row('Bluetooth', 'Pair a controller, keyboard or headphones with this computer', 'Open', 'os:bluetooth') + row('Wi-Fi and network', 'This computer’s own settings', 'Open', 'os:network') + row('Sound', 'Where this computer plays, and its microphone', 'Open', 'os:sound')
      + g('Accounts') + row('Claude', 'What the assistant runs on', DV.claude, '', DV.claude === 'Signed in') + row('Services', 'What the assistant can use', DV.services, 'connections') + row('Music platforms', 'What the music widget plays', MU?.spotify?.connected ? 'Spotify' : 'This PC', 'musicpage')
  }
  async function onDevice(id) {
    const [k, v] = [id.split(':')[0], id.slice(id.indexOf(':') + 1)]
    DV.msg = ''
    if (k === 'pairstart') { const r = await send('/api/pair/start'); if (r.ok && r.code) { DV.pair = r; const n = DV.devices.length; const wait = async () => { if (!DV.pair || picking !== 'devices') return; if (Date.now() > DV.pair.expires) { DV.pair = null; DV.msg = 'That code ran out. Make another.'; return paintSettings() } await readDevices(); if (DV.devices.length > n) { DV.pair = null; DV.msg = `${DV.devices.at(-1).name} is paired.`; return paintSettings() } setTimeout(wait, 2500) }; setTimeout(wait, 2500) } else DV.msg = r.error || 'That didn’t work.' }
    else if (k === 'pairstop') DV.pair = null
    else if (k === 'unpair') {
      if (DV.ask !== v) { DV.ask = v; setTimeout(() => { if (DV.ask === v) { DV.ask = ''; paintSettings() } }, 4000) }
      else { DV.ask = ''; const r = await send(`/api/pair/devices/${encodeURIComponent(v)}/remove`); if (!r.ok) DV.msg = r.error || 'That didn’t work.'; return readDevices() }
    }
    else if (k === 'lan') { const r = await send('/api/tv/setup/lan', { on: !DV.lan?.on }); if (!r.ok) { DV.msg = r.error || 'That didn’t work.'; if (r.needPasscode) DV.pass = true } return readDevices(true) }
    else if (k === 'tailscale') {
      const t = DV.reach?.tailscale
      if (t && !t.installed) return void window.open('https://tailscale.com/download', '_blank', 'noopener')
      const r = await send('/api/reach/tailscale', { on: !t?.on })
      if (!r.ok) { DV.msg = r.error || 'That didn’t work.'; if (r.needPasscode) DV.pass = true }
      return readDevices(true)
    }
    else if (k === 'pass') DV.pass = true
    else if (k === 'passsave') {
      const n = set.querySelector('#dvpass'), r = await send('/api/hub/passcode', { passcode: n?.value || '' })
      n?.blur()
      if (r.ok) { DV.pass = false; DV.msg = 'Passcode saved.' } else DV.msg = r.error || 'Use 8 or more characters.'
      return readDevices(true)
    }
    else if (k === 'tvpower') { DV.power = { ...DV.power, on: !DV.power?.on }; paintSettings(); DV.power = await send('/api/tv/power', { on: 'toggle' }); soon() }
    else if (k === 'os') { const r = await send('/api/reach/open', { what: v }); if (!r.ok) DV.msg = r.error || 'That didn’t open.' }
    paintSettings()
  }
  // ── Settings › Brightness, Keyboard shortcuts, Status and storage ──
  const note2 = t => `<p class="tvs-note">${t}</p>`
  const plainRow = (t1, t2 = '', v = '', id = '', on = false) => `<${id ? 'button type="button"' : 'div'} class="tvs-row"${id ? ` data-set="${esc(id)}"` : ''}><div class="txt"><div class="t1">${esc(t1)}</div>${t2 ? `<div class="t2">${esc(t2)}</div>` : ''}</div><div class="v${on ? ' on' : ''}">${esc(v)}</div></${id ? 'button' : 'div'}>`
  const grp = t => `<div class="tvs-group">${t}</div>`
  let sliding = false
  const range = (id, t1, t2, v) => `<div class="tvs-row tvs-range"><div class="txt"><div class="t1">${esc(t1)}</div>${t2 ? `<div class="t2">${esc(t2)}</div>` : ''}</div><input type="range" min="5" max="100" value="${v}" data-range="${esc(id)}" aria-label="${esc(t1)} brightness"><div class="v">${v}%</div></div>`
  const KIND = { inner: 'This computer’s own screen', ddc: 'Changes the monitor itself', soft: 'Dims the picture: this monitor doesn’t take brightness from a computer' }
  function displayHtml(backB) {
    const ms = MU?.monitors || []
    if (!ms.length) return `<div class="tvs-title">${backB}Brightness</div>` + plainRow('No screen here takes brightness from an app', 'On another device this shows the computer the hub runs on')
    return `<div class="tvs-title">${backB}Brightness</div>` + (ms.length > 1 ? grp('All together') + range('', 'Every monitor below that’s on', '', MU.brightness ?? 100) : '')
      + grp('Each one') + ms.map(m => range(m.id, m.name, KIND[m.kind] || '', m.level)).join('')
      + (ms.length > 1 ? grp('The brightness slider moves') + ms.map(m => plainRow(m.name, '', m.on ? 'On' : 'Off', `mon:${m.id}`, m.on)).join('') : '')
      + plainRow('Windows display settings', 'Night light, resolution and arrangement', '', 'osdisplay')
  }
  set.addEventListener('input', e => { const n = e.target.closest('[data-range]'); if (!n) return; sliding = true; n.nextElementSibling.textContent = `${n.value}%` })
  set.addEventListener('change', async e => {
    const n = e.target.closest('[data-range]')
    if (!n) return
    const r = await fetch('/api/music/level', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ what: 'brightness', value: Number(n.value), ...(n.dataset.range ? { id: n.dataset.range } : {}) }) }).then(r => r.json(), () => ({ error: 'The hub didn’t answer.' }))
    if (!r.ok) say(r.error || 'That didn’t change.')
    await readPc()
    sliding = false
    paintSettings()
  })
  const GLYPH_NAMES = { house: 'House', star: 'Star', bolt: 'Bolt', heart: 'Heart', planet: 'Planet', leaf: 'Leaf', diamond: 'Diamond', orbit: 'Orbit', grid: 'Tiles', letter: 'First letter', moon: 'Moon', sun: 'Sun', cloud: 'Cloud', flame: 'Flame', drop: 'Drop', crown: 'Crown', music: 'Music', game: 'Controller', rocket: 'Rocket', compass: 'Compass', book: 'Book', camera: 'Camera', globe: 'Globe', paw: 'Paw', smile: 'Smile', cube: 'Cube', wave: 'Wave' }
  function hubHtml(backB) {
    if (!ID) return `<div class="tvs-title">${backB}Name and icon</div>` + plainRow('Looking…')
    const on = typeof ID.icon === 'object' && ID.icon ? ID.icon : null, color = on?.color || 'night'
    return `<div class="tvs-title">${backB}Name and icon</div>` + (idMsg ? `<div class="tvs-msg">${esc(idMsg)}</div>` : '')
      + grp('Hub name') + `<div class="tvs-row tvs-form"><input id="hubnm" type="text" maxlength="40" value="${esc(ID.name)}" placeholder="LocalHub" aria-label="Hub name" spellcheck="false" autocomplete="off"><span class="tvs-saved">${idSaved ? "Saved" : ""}</span></div>`
      + grp('Hub icon') + `<div class="tvs-icons">${[['', 'LocalHub', '/api/hub/identity/preview.svg?glyph=house&color=night', !ID.icon], ...ID.glyphs.filter(x => x !== 'house' || color !== 'night').map(x => [x, GLYPH_NAMES[x] || x, `/api/hub/identity/preview.svg?glyph=${x}&color=${color}&n=${encodeURIComponent(ID.name)}`, on?.glyph === x])].map(([id, name, src, sel]) => `<button type="button" data-set="glyph:${id}" class="${sel ? 'on' : ''}" aria-label="${name}" title="${name}"><img src="${src}" alt=""></button>`).join('')}</div>`
      + grp('Color') + `<div class="tvs-dots">${Object.entries(ID.colors).map(([id, [a, b]]) => `<button type="button" data-set="hubcolor:${id}" class="${color === id ? 'on' : ''}" aria-label="${id}" title="${id.charAt(0).toUpperCase() + id.slice(1)}" style="background:linear-gradient(${a}, ${b})"></button>`).join('')}</div>`
      + grp('Your own') + `<div class="tvs-row tvs-form"><input id="hubtx" type="text" maxlength="16" value="${esc(on?.glyph === 'text' ? on.text : '')}" placeholder="An emoji, or up to three letters" aria-label="An emoji, or up to three letters" spellcheck="false" autocomplete="off"></div>` + plainRow('Use a picture', 'PNG, JPEG or WebP, up to 2 MB', ID.icon === 'upload' ? 'In use' : '', 'hubpic', ID.icon === 'upload') + (ID.icon || ID.name !== 'LocalHub' ? plainRow('Back to the LocalHub name and icon', '', '', 'hubreset') : '')
  }
  async function saveHub(body, path = '', type = 'application/json', typing = false) {
    idMsg = ''
    const r = await fetch(`/api/hub/identity${path}`, { method: 'POST', headers: { 'content-type': type, 'x-hub': '1' }, body }).then(r => r.json(), () => ({ error: 'The hub didn’t answer.' }))
    if (r.error) idMsg = r.error
    else {
      ID = r
      if (window.HUB_CONF) window.HUB_CONF.name = r.name
      hubIcon = `/icons/hub.svg?i=${Date.now()}`
      document.querySelectorAll('link[rel="icon"][type="image/svg+xml"]').forEach(n => { n.href = hubIcon })
      paintRail()
    }
    if (typing) {
      const a = set.querySelector('.tvs-art'), m = set.querySelector('.tvs-saved')
      if (a) a.innerHTML = `<img src="${hubIcon}" alt=""><p>${esc(ID?.name || '')}</p>`
      if (m) m.textContent = idMsg || 'Saved'
      return
    }
    document.activeElement?.blur?.()
    setHtml = ''
    paintSettings()
  }
  // Typing saves by itself.
  set.addEventListener('input', e => {
    const n = e.target
    if (n.id !== 'hubnm' && n.id !== 'hubtx') return
    clearTimeout(idT)
    idT = setTimeout(() => saveHub(JSON.stringify(n.id === 'hubnm' ? { name: n.value } : { icon: n.value.trim() ? { glyph: 'text', text: n.value, color: ID?.icon?.color || 'night' } : null }), '', 'application/json', true), 600)
  })
  set.addEventListener('keydown', e => { if (/^(hubnm|hubtx)$/.test(e.target.id) && e.key === 'Enter') { e.preventDefault(); e.target.blur(); setHtml = ''; paintSettings() } })
  set.addEventListener('focusout', e => { if (/^(hubnm|hubtx)$/.test(e.target.id)) setTimeout(() => { setHtml = ''; paintSettings() }, 700) })
  function alexaHtml(backB) {
    if (!AX) return `<div class="tvs-title">${backB}Alexa</div>` + plainRow('Looking…')
    const step = (n, t, d, btns = '') => `<div class="tvs-row tvs-step"><b>${n}</b><div class="txt"><div class="t1">${t}</div><div class="t2">${d}</div></div>${btns}</div>`
    const go = (id, t) => `<button type="button" class="tvs-x" data-set="${id}">${t}</button>`
    return `<div class="tvs-title">${backB}Alexa</div>` + (axMsg ? `<div class="tvs-msg">${esc(axMsg)}</div>` : '')
      + plainRow('Alexa', AX.heard ? `Last heard from ${since((Date.now() - AX.heard) / 1000)} ago` : AX.on ? 'Ready. Nothing heard from Alexa yet' : '', AX.on ? 'On' : AX.skillId ? 'Not answering' : 'Not set up', '', AX.on)
      + grp('Set it up once, about 15 minutes')
      + step(1, 'Make the skill', 'Free, with the Amazon account your Fire TV uses. Create Skill, name it LocalHub, Custom, Provision your own, Start from scratch.', go('axopen', 'Open Amazon'))
      + step(2, 'Give it the words', 'In the skill: Interaction Model, JSON Editor. Paste, Save, Build skill.', go('axcopy', 'Copy the words'))
      + step(3, 'Give it a way in', `Alexa calls from Amazon, so port ${AX.port} needs an https address of its own: a Cloudflare Tunnel to http://127.0.0.1:${AX.port} is free. It answers Amazon’s signed requests for your skill and nothing else. Never point it at port 3100. Put that address, with /alexa after it, in the skill under Endpoint, HTTPS.`, go('axtunnel', 'Copy the command'))
      + step(4, 'Paste the Skill ID', 'From the skill’s page. It starts with amzn1.ask.skill.') + `<div class="tvs-row tvs-form"><input id="axid" type="text" value="${esc(AX.skillId)}" placeholder="amzn1.ask.skill.…" aria-label="Skill ID" spellcheck="false" autocomplete="off"><button type="button" class="tvs-go" data-set="axsave">Save</button></div>`
      + step(5, 'Turn it on for your devices', 'In the skill: Test, Development. It then works on every Alexa on your account, including the Fire TV remote.')
      + grp('Say') + ['“Alexa, ask local hub to open YouTube”', '“Alexa, ask local hub to go home”', '“Alexa, ask local hub what’s on my calendar today”', '“Alexa, open local hub”, then just talk'].map(t => plainRow(t)).join('')
      + (AX.skillId ? grp('') + plainRow('Turn Alexa off', 'Forgets the Skill ID here', '', 'axoff') : '')
  }
  const readAx = async () => { try { AX = await (await fetch('/api/tv/alexa', { cache: 'no-store' })).json() } catch {} }
  async function saveAx(skillId) {
    const r = await fetch('/api/tv/alexa', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ skillId }) }).then(r => r.json(), () => ({ error: 'The hub didn’t answer.' }))
    axMsg = r.error || ''
    document.activeElement?.blur?.()
    await readAx()
    setHtml = ''
    paintSettings()
  }
  function keysHtml(backB) {
    const k = (t, v) => plainRow(t, '', v)
    return `<div class="tvs-title">${backB}Keyboard shortcuts</div>` + grp('Anywhere') + k('Controls', 'Ctrl + .') + k('Close what’s open', 'Esc') + (window.HubChat ? k('Send to the assistant', 'Enter') + k('A new line', 'Shift + Enter') : '')
      + grp('Home') + k('Open the first app that matches', 'Type in Search, Enter') + k('Scroll the favorites', 'Wheel over the row') + k('Move an app', 'Drag it') + k('An app’s menu', 'Right-click')
      + grp('Your TV’s screen') + k('Move', 'Arrow keys') + k('Open', 'Enter') + k('Back', 'Esc') + k('Menu', 'Menu key') + k('Rewind and fast forward', 'Page Up, Page Down') + k('Type', 'Just type, in a text box')
      + grp('The desktop app') + k('Launcher, from any program', 'Ctrl + Alt + Space')
  }
  const size = n => (n > 2 ** 30 ? `${(n / 2 ** 30).toFixed(1)} GB` : n > 2 ** 20 ? `${Math.round(n / 2 ** 20)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
  const since = n => (n > 172800 ? `${Math.floor(n / 86400)} days` : n > 7200 ? `${Math.floor(n / 3600)} hours` : `${Math.max(1, Math.floor(n / 60))} min`)
  function statusHtml(backB) {
    const ok = (t, t2, on, v) => plainRow(t, t2, v || (on ? 'OK' : 'Off'), '', on)
    return `<div class="tvs-title">${backB}Status and storage</div>` + grp('Running')
      + (STAT ? ok('This computer', `Running for ${since(STAT.up)}, using ${size(STAT.memory)} of memory`, true) : plainRow('Looking…'))
      + ok('Music and volume', 'What this PC is playing', !!MU?.pc, MU?.pc ? '' : 'Not available') + ok('Brightness', '', !!MU?.monitors?.length, MU?.monitors?.length ? `${MU.monitors.length} ${MU.monitors.length === 1 ? 'monitor' : 'monitors'}` : 'Not available')
      + ok('Your TV', '', !!TV?.on, TV?.on ? 'Connected' : 'Not connected') + ok('The remote in every app', KEYS.state === 'error' ? KEYS.why || '' : '', KEYS.on && KEYS.state !== 'error', !KEYS.on ? 'Off' : KEYS.state === 'error' ? 'Not working' : 'On')
      + ok('Hey LocalHub', '', !!listen?.on, listen?.on ? 'Listening' : 'Off') + ok('Claude', '', DV.claude === 'Signed in', DV.claude || 'Not signed in') + ok('Entry code', '', !!LK?.conf().on, LK?.conf().on ? 'On' : 'Off')
      + grp('Storage') + (STAT?.data?.length ? STAT.data.map(d => plainRow(d.name, '', size(d.bytes))).join('') + plainRow('All of it', '', size(STAT.data.reduce((n, d) => n + d.bytes, 0))) : plainRow(STAT ? 'Nothing kept yet' : 'Looking…')) + (SYS ? plainRow('This computer’s disk', '', `${SYS.disk}% used`) : '')
  }
  async function importSettings() {
    const n = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' })
    n.onchange = async () => {
      if (!n.files[0] || !confirm('Replace this hub’s tabs, websites, pages, widgets and look with the ones in that file?')) return
      const r = await fetch('/api/hub/settings/import', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: await n.files[0].text() }).catch(() => null), j = await r?.json().catch(() => ({}))
      if (r?.ok) location.reload()
      else say(j?.error || 'That file didn’t work.')
    }
    n.click()
  }
  // ── Settings › Music platforms ──
  const sp = () => MU?.spotify || {}
  function musicHtml(backB) {
    const row = (t1, t2, v, set, on) => `<${set ? 'button type="button"' : 'div'} class="tvs-row"${set ? ` data-set="${set}"` : ''}><div class="txt"><div class="t1">${t1}</div><div class="t2">${t2}</div></div><div class="v${on ? ' on' : ''}">${v}</div></${set ? 'button' : 'div'}>`
    const local = ['localhost', '127.0.0.1'].includes(location.hostname)
    return `<div class="tvs-title">${backB}Music platforms</div><div class="tvs-group">The music widget</div>`
      + row('Plays from', 'Automatic follows whatever is playing', SRC[MU?.source] || 'Automatic', 'musicsrc', true)
      + '<div class="tvs-group">Ready now</div>'
      + row('This PC', 'Spotify, Apple Music, Amazon Music, YouTube or any player open here. Nothing to sign in to', MU?.pc ? 'Ready' : 'Not available', '', MU?.pc)
      + row('Your TV', 'Anything playing on the Fire TV. Titles need LocalHub allowed under notification access there', TV?.on ? 'Connected' : 'Not connected', '', TV?.on)
      + '<div class="tvs-group">Spotify account</div>'
      + (sp().connected
        ? row('Spotify', 'Any of your Spotify devices. Play, pause and skip need Premium', 'Connected', '', true) + row('Disconnect Spotify', 'Forgets the sign-in on this computer', '', 'spoff')
        : !local ? row('Spotify', 'Connect it on the computer the hub runs on', '') : `<div class="tvs-form"><ol><li>Open <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> and create an app.</li><li>Give it this redirect address: <code>${esc(sp().redirect || '')}</code></li><li>Paste its Client ID here.</li></ol><div><input id="spid" type="text" maxlength="32" placeholder="Client ID" value="${esc(sp().clientId || '')}" aria-label="Spotify Client ID"><button type="button" data-set="spon">Sign in to Spotify</button></div><p id="spmsg"></p></div>`)
      + '<div class="tvs-group">Good to know</div>' + row('Apple Music, YouTube Music, Amazon Music', 'These don’t let other apps sign in, so LocalHub controls them through this PC or the TV', '')
  }
  async function spotifyOn() {
    const id = set.querySelector('#spid').value.trim(), msg = t => { const n = set.querySelector('#spmsg'); if (n) n.textContent = t }
    try {
      const r = await fetch('/api/music/spotify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ clientId: id }) }), j = await r.json()
      if (!r.ok) return msg(j.error || 'That didn’t save.')
      if (!id) return msg('Paste your Client ID first.')
      window.open('/api/music/spotify/login', '_blank')
      msg('Finish signing in on the page that opened. This updates by itself.')
      let n = 60
      const wait = async () => { await readPc(); if (MU?.spotify?.connected) { set.querySelector('#spid')?.blur(); setHtml = ''; return paintSettings() } if (n-- && picking === 'music') setTimeout(wait, 3000) }
      setTimeout(wait, 3000)
    } catch { msg('The hub didn’t answer.') }
  }
  // ── Settings › Fire TV remote ──
  let RM = null, rmSel = 'menu', rmKind = 'remote'
  async function keys(body) { try { const r = await fetch('/api/tv/keys', body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify(body) } : { cache: 'no-store' }); if (r.ok) KEYS = await r.json() } catch {} setHtml = ''; paintSettings(); if (KEYS.state === 'starting' && picking === 'remote') setTimeout(keys, 1500) }
  const btns = () => H()?.settings.tv?.buttons || {}
  function remoteHtml(backB) {
    if (!RM) return backB
    const b = RM.BUTTONS.find(x => x.id === rmSel), now = RM.actionOf(rmSel, btns())
    const apps = (TV?.apps || [])
    const opt = (v, t) => `<option value="${esc(v)}"${v === now ? ' selected' : ''}>${esc(t)}</option>`
    const pick = id => { const sys = RM.BUTTONS.find(x => x.id === id)?.sys && !btns()[id], a = sys ? id : RM.actionOf(id, btns()); const oo = (v, t) => `<option value="${esc(v)}"${v === a ? ' selected' : ''}>${esc(t)}</option>`
      return `<div class="tvs-row rmr${rmSel === id ? ' rmsel' : ''}" data-rmrow="${esc(id)}"><div class="txt"><div class="t1">${esc(RM.labelOf(id))}</div>${RM.noteOf(id) ? `<div class="t2">${esc(RM.noteOf(id))}</div>` : ''}</div><select data-rmset="${esc(id)}" aria-label="${esc(RM.labelOf(id))}">${(RM.ACTIONS.some(([v]) => v === id) ? '' : oo(id, 'Standard')) + RM.ACTIONS.map(([v, t]) => oo(v, v === id ? `${t} (standard)` : t)).join('')}${apps.length ? `<optgroup label="Open an app">${apps.map(n => oo('app:' + n, n)).join('')}${a.startsWith('app:') && !apps.includes(a.slice(4)) ? oo(a, a.slice(4)) : ''}</optgroup>` : ''}</select></div>` }
    return `<div class="tvs-title">${backB}Remotes and controllers</div><div class="tvs-seg">${RM.KINDS.map(([k, t]) => `<button type="button" data-set="rmkind:${k}" class="${k === rmKind ? 'on' : ''}">${t}</button>`).join('')}</div><div class="tvs-group">${rmKind === 'other' ? 'Buttons you have pressed on the TV’s remote page appear here' : 'Press a button on the picture, or choose here'}</div>`
      + `<button type="button" class="tvs-row" data-set="rmeverywhere"><div class="txt"><div class="t1">In every app</div><div class="t2">${esc(KEYS.state === 'error' ? KEYS.why : 'Your buttons work while Netflix or any app is open. This computer starts it on the TV after each restart')}</div></div><div class="v${KEYS.on ? ' on' : ''}">${{ off: 'Off', starting: 'Starting…', on: 'On', error: 'Couldn’t start' }[KEYS.state] || 'Off'}</div></button>`
      + RM.rowIds(btns(), rmKind).filter(x => x !== 'reset').map(pick).join('')
      + (b && !b.map ? `<div class="tvs-row"><div class="txt"><div class="t1">${esc(b.label)}</div><div class="t2">${esc(b.why)}</div></div></div>` : '')
      + '<button type="button" class="tvs-row" data-set="rmreset"><div class="txt"><div class="t1">Back to standard</div><div class="t2">Menu is the microphone, the rest do what they say</div></div></button>'
      + '<div class="tvs-group">To use these while another app is open, and for Guide and the app buttons, turn on In every app above. Saved to your TV within half a minute. Connect a controller in the TV’s own Bluetooth settings; a button that isn’t here can be added by pressing it on the TV’s remote page</div>'
  }
  async function saveButtons(map) { try { await H().patch({ tv: { buttons: map } }) } catch (e) { alert(e.message) } setHtml = ''; paintSettings() }
  set.addEventListener('change', e => { const id = e.target.dataset?.rmset; if (!id) return; const v = e.target.value; e.target.blur(); const m = { ...btns() }; if (v === id || RM.DEFAULTS[id] === v) delete m[id]; else m[id] = v; if (v === id && RM.DEFAULTS[id]) m[id] = v; rmSel = id; saveButtons(m) })
  set.addEventListener('click', e => { const id = e.target.closest?.('.tvs-art [data-rm]')?.dataset.rm || e.target.closest?.('[data-rmrow]')?.dataset.rmrow; if (!id || e.target.closest('select')) return; rmSel = id; setHtml = ''; paintSettings(); set.querySelector('.rmsel')?.scrollIntoView({ block: 'nearest' }) })
  async function readId() { try { ID = await (await fetch('/api/hub/identity', { cache: 'no-store' })).json() } catch {} }
  async function readAbout() {
    await Promise.all([readId(), readAx()])
    try { const s = await (await fetch('/api/tv/status', { cache: 'no-store' })).json(); TV = s.tv; listen = s.listen; version = s.version } catch {}
    paintSettings()
  }
  function openSettings() {
    picking = null
    find = ''
    forgot = false
    setHtml = ''
    window.HubChat?.close()
    set.classList.add('on')
    paintSettings()
    readAbout().catch(() => {})
    readDevices()
    readPc()
    setTimeout(paintRail, 60)
  }
  function closeSettings() { set.classList.remove('on'); setTimeout(paintRail, 60) }
  const saveDev = async (d, patch) => { try { await H().patch({ look: { [d]: patch } }) } catch (e) { alert(e.message) } paintSettings() }
  async function onSet(id) {
    if (id === 'back') { lkPin = ''; if (picking) { picking = null; return paintSettings() } return closeSettings() }
    const [k, d] = id.split(':')
    if (k === 'wall') { picking = d; set.querySelector('.tvs-list').scrollTop = 0; return paintSettings() }
    if (k === 'saver') return saveDev(d, { saver: MIN[(MIN.indexOf(devLook(d).saver) + 1) % MIN.length] })
    if (k === 'show') return saveDev(d, { show: devLook(d).show === 'photos' ? 'background' : 'photos' })
    if (id === 'lockpage') { picking = 'lock'; setHtml = ''; lkPin = ''; lkMsg = ''; set.querySelector('.tvs-list').scrollTop = 0; readTv(); return paintSettings() }
    if (/^lk[a-z]+(:|$)/.test(id)) return onLock(id)
    if (id === 'devpage') { picking = 'devices'; setHtml = ''; DV.msg = ''; DV.pair = null; DV.pass = false; set.querySelector('.tvs-list').scrollTop = 0; paintSettings(); return readDevices(true) }
    if (['pairstart', 'pairstop', 'unpair', 'lan', 'tailscale', 'pass', 'passsave', 'tvpower', 'os'].includes(id.split(':')[0])) return onDevice(id)
    if (id === 'claude') return void window.HubChat?.open(closeSettings())
    if (id === 'hubname' || id === 'hubicon') { picking = 'hub'; setHtml = ''; idMsg = ''; paintSettings(); await readId(); paintSettings(); if (id === 'hubname') { const n = set.querySelector('#hubnm'); n?.focus(); n?.select() } return }
    if (k === 'glyph') return saveHub(JSON.stringify({ icon: d ? { glyph: d, color: ID.icon?.color || 'night' } : null }))
    if (k === 'hubcolor') return saveHub(JSON.stringify({ icon: { glyph: ID.icon?.glyph || 'house', text: ID.icon?.text, color: d } }))
    if (id === 'hubreset') return saveHub(JSON.stringify({ name: '', icon: null }))
    if (id === 'hubpic') { const n = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/webp' }); n.onchange = () => n.files[0] && saveHub(n.files[0], '/icon', n.files[0].type); return n.click() }
    if (id === 'alexapage') { picking = 'alexa'; setHtml = ''; axMsg = ''; paintSettings(); await readAx(); return paintSettings() }
    if (id === 'axopen') return void window.open('https://developer.amazon.com/alexa/console/ask', '_blank', 'noopener')
    if (id === 'axcopy') { try { await navigator.clipboard.writeText(await (await fetch('/api/tv/alexa/model.json')).text()); say('Copied. Paste it in the JSON Editor.') } catch { say('That didn’t copy.') } return }
    if (id === 'axtunnel') { try { await navigator.clipboard.writeText(`cloudflared tunnel --url http://127.0.0.1:${AX?.port || 3109}`); say('Copied. Run it in a terminal.') } catch { say('That didn’t copy.') } return }
    if (id === 'axsave') return saveAx(set.querySelector('#axid')?.value || '')
    if (id === 'axoff') return saveAx('')
    if (id === 'displaypage') { picking = 'display'; setHtml = ''; paintSettings(); await readPc(); return paintSettings() }
    if (id === 'keyspage') { picking = 'keys'; setHtml = ''; return paintSettings() }
    if (id === 'statuspage') { picking = 'status'; setHtml = ''; paintSettings(); try { STAT = await (await fetch('/api/desk/status', { cache: 'no-store' })).json() } catch {} return paintSettings() }
    if (id === 'sound') return setSound({ pc: 'tv', tv: 'both', both: 'pc' }[SND.to])
    if (k === 'mon') return setMonitor(id.slice(4))
    if (id === 'osdisplay') { const r = await fetch('/api/reach/open', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: '{"what":"display"}' }).then(r => r.json(), () => ({})); return r.ok ? undefined : say(r.error || 'Windows settings open on the computer the hub runs on.') }
    if (id === 'export') return void Object.assign(document.createElement('a'), { href: '/api/hub/settings/export', download: 'local-hub-settings.json' }).click()
    if (id === 'import') return importSettings()
    if (id === 'forget') { localStorage.removeItem('localhub.opens'); forgot = true; window.HubDesk?.paint(); return paintSettings() }
    if (id === 'plr') { press('homeplayer'); return paintSettings() }
    if (id === 'syscard') { press('homesys'); return paintSettings() }
    if (id === 'sortapps') { const i = SORTS.findIndex(x => x[0] === (look.sort || 'mine')); look.sort = SORTS[(i + 1) % SORTS.length][0]; saveLook(); arrange(); window.HubDesk?.paint(); return paintSettings() }
    if (id === 'panel') return void openPanel()
    if (id === 'tvcontrol') { closeSettings(); return openMirror() }
    if (id === 'musicpage') { picking = 'music'; setHtml = ''; await readPc(); return paintSettings() }
    if (id === 'remotepage') { picking = 'remote'; setHtml = ''; try { RM ??= await import('/tv/remote.js?v=4') } catch {} return keys() }
    if (k === 'rmkind') { rmKind = d; rmSel = RM.rowIds(btns(), d)[0] || ''; setHtml = ''; set.querySelector('.tvs-list').scrollTop = 0; return paintSettings() }
    if (id === 'rmeverywhere') return keys({ on: !KEYS.on })
    if (id === 'musicsrc') { press('music'); return void setTimeout(() => { setHtml = ''; paintSettings() }, 500) }
    if (id === 'spon') return spotifyOn()
    if (id === 'spoff') { await fetch('/api/music/spotify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: '{"clientId":""}' }).catch(() => {}); await readPc(); setHtml = ''; return paintSettings() }
    if (id === 'rmreset') return saveButtons(null)
    if (id === 'clock') { look.clock = CLOCKS[(CLOCKS.indexOf(look.clock) + 1) % CLOCKS.length]; saveLook(); return paintSettings() }
    if (id === 'weather') { look.weather = !look.weather; saveLook(); return paintSettings() }
    if (id === 'theme') { H().save({ style: { theme: 'light' } }); return }
    if (id === 'listen') {
      try { const r = await fetch('/api/tv/listen', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ on: !listen.on }) }); if (r.ok) listen = { ...listen, on: !listen.on } } catch {}
      return paintSettings()
    }
    closeSettings()
    if (id === 'addapps') window.HubDesk?.open()
    else if (id === 'edit') goHome('.hw-root:not(.hw-edit) [data-hw-act="edit"]')
    else if (id === 'tabs') H()?.openTabs()
    else if (id === 'style') H()?.openStyle()
    else if (id === 'connections') window.HUB_CONNECTIONS?.()
    else if (id === 'tvsetup') { location.hash = ''; location.hash = '#tv-setup' }
    else if (id === 'setup') window.open('https://trylocalhub.com/setup', '_blank', 'noopener')
  }
  set.addEventListener('click', e => {
    const w = e.target.closest('[data-wall]')
    if (w && DEVS[picking]) return saveDev(picking, { wallpaper: w.dataset.wall })
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

  // ── The entry code: to get into this page, or a place in it (lock.mjs keeps it; the pad is the TV's, tv/ui/lock.js) ──
  let LK = null, deskOk = false, lkUsed = {}, lkBusy = false, lkAt = Date.now()
  const lkSpan = () => Math.max((LK?.conf().after || 0) * 60_000, 1500)
  const placeNow = () => (mirror.classList.contains('on') ? ['control', 'Your TV'] : set.classList.contains('on') ? ['settings', 'Settings'] : window.HubChat?.isOpen?.() ? ['assistant', 'Assistant'] : window.HubBrowser?.isOpen?.() ? ['browser', 'Browser'] : spotKey() === 'drives' ? ['files', 'Files'] : ['home', 'Home'])
  async function guard() {
    if (!LK || lkBusy || LK.isOpen()) return
    if (!LK.locked('desk')) deskOk = true
    if (!deskOk) {
      lkBusy = true
      const ok = await LK.ask({ title: H()?.name || 'LocalHub', cancel: false, place: () => LK.locked('desk') })
      lkBusy = false
      if (ok) { deskOk = true; lkAt = Date.now(); try { sessionStorage.setItem('lock', String(Date.now())) } catch {} }
      document.documentElement.toggleAttribute('data-lockwait', !deskOk)
      return
    }
    document.documentElement.removeAttribute('data-lockwait')
    const [p, label] = placeNow()
    for (const k in lkUsed) if (k !== p && Date.now() - lkUsed[k] > lkSpan()) delete lkUsed[k]
    if (!LK.locked(p)) return
    if (lkUsed[p] && (Date.now() - lkAt < Math.max(lkSpan(), 60_000))) { lkUsed[p] = Date.now(); return }
    lkBusy = true
    const ok = await LK.ask({ title: label, place: () => LK.locked(p) })
    lkBusy = false
    if (ok) { lkUsed[p] = Date.now(); lkAt = Date.now() }
    else document.querySelector('[data-rail="tab:home"]')?.click()
  }
  const lkTouch = () => {
    const after = LK?.conf().after || 0
    if (after && deskOk && Date.now() - lkAt > after * 60_000) { deskOk = !LK.locked('desk'); lkUsed = {}; document.documentElement.toggleAttribute('data-lockwait', !deskOk); guard() }
    lkAt = Date.now()
    if (deskOk) try { sessionStorage.setItem('lock', String(lkAt)) } catch {}
  }
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, lkTouch, true)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) lkTouch() })
  import('/tv/lock.js?v=2').then(async m => {
    LK = m.createLock({ host: document.body, store: { read: () => localStorage.getItem('localhub.lock'), write: t => localStorage.setItem('localhub.lock', t) }, changed: () => { guard(); paintSettings() } })
    // A reload just now, in this window, isn't a new visit.
    try { const t = Number(sessionStorage.getItem('lock')); if (t && Date.now() - t < Math.max(lkSpan(), 30_000)) deskOk = true } catch {}
    if (LK.conf().on) guard()
    await LK.load()
    guard()
    setInterval(() => LK.load(), 30_000)
  }, () => {})
  setInterval(guard, 400)

  // The sidebar follows the tab bar, which stays the one list of tabs (it's hidden, its buttons still work).
  const behind = Object.assign(document.createElement('div'), { id: 'tvback2' })
  document.body.append(behind)
  function paintRail() {
    document.documentElement.toggleAttribute('data-cover', set.classList.contains('on') || mirror.classList.contains('on') || !!window.HubChat?.isOpen?.())
    const chat = !!window.HubChat?.isOpen?.()
    const tabs = [...seg.querySelectorAll('button[data-env]')].filter(b => !b.hidden && b.style.display !== 'none')
    const item = (key, ic, label, on) => `<button type="button" data-rail="${esc(key)}" class="${on ? 'on' : ''}" aria-label="${esc(label)}"${on ? ' aria-current="page"' : ''}>${svg(IC[ic])}<span>${esc(label)}</span></button>`
    const name = b => (b.firstChild?.textContent || b.textContent).trim()
    const tabItem = b => item(`tab:${b.dataset.env}`, TAB_IC[b.dataset.env] || 'tab', name(b), isOn(b) && !chat && !set.classList.contains('on') && !mirror.classList.contains('on') && !window.HubBrowser?.isOpen?.())
    const at = k => tabs.find(b => b.dataset.env === k), rest = tabs.filter(b => !['home', 'drives'].includes(b.dataset.env))
    const html = `<img src="${hubIcon}" alt=""><div class="mid">`
      + (at('home') ? tabItem(at('home')) : '') + item('assistant', 'mic', 'Assistant', chat && !set.classList.contains('on'))
      + (window.HubBrowser ? item('browser', 'globe', 'Browser', !!window.HubBrowser.isOpen?.()) : '') + item('tv', 'tv', 'TV', mirror.classList.contains('on'))
      + (at('drives') ? tabItem(at('drives')) : '') + rest.map(tabItem).join('')
      + '</div>' + item('overlay', 'overlay', 'Controls', panel.classList.contains('on')) + item('settings', 'gear', 'Settings', set.classList.contains('on'))
    if (rail._html === html) return
    rail._html = html
    rail.innerHTML = html
  }
  const goHome = then => {
    seg.querySelector('[data-env="home"]')?.click()
    let tries = 40
    const wait = () => { const el = document.querySelector(then); if (el) el.click(); else if (tries--) setTimeout(wait, 50) }
    wait()
  }
  const tip = Object.assign(document.createElement('div'), { id: 'tvtip' })
  document.body.append(tip)
  const showTip = e => { const b = e.target.closest?.('#tvrail button'); tip.classList.toggle('on', !!b); if (!b) return; const r = b.getBoundingClientRect(); tip.textContent = b.getAttribute('aria-label'); tip.style.top = `${r.top + r.height / 2}px` }
  rail.addEventListener('pointerover', showTip)
  rail.addEventListener('pointerleave', () => tip.classList.remove('on'))
  rail.addEventListener('focusin', e => { if (e.target.matches(':focus-visible')) showTip(e) })
  rail.addEventListener('focusout', () => tip.classList.remove('on'))
  rail.addEventListener('click', e => {
    const key = e.target.closest('[data-rail]')?.dataset.rail
    if (!key) return
    if (key === 'overlay') return panel.classList.contains('on') ? closePanel() : openPanel()
    if (!docked()) closePanel()
    if (key !== 'settings') closeSettings()
    if (key !== 'tv') closeMirror()
    if (key !== 'assistant') window.HubChat?.close()
    if (key !== 'browser') window.HubBrowser?.close?.()
    if (key === 'browser') { if (!window.HubBrowser?.isOpen?.()) window.HubBrowser?.open() }
    else if (key.startsWith('tab:')) {
      seg.querySelector(`[data-env="${CSS.escape(key.slice(4))}"]`)?.click()
      if (key === 'tab:home') document.querySelector('[data-hw-mode="desktop"]')?.click()
    } else if (key === 'assistant') window.HubChat?.open()
    else if (key === 'tv') openMirror()
    else if (key === 'settings') openSettings()
    paintRail()
    guard()
    setTimeout(paintRail, 60)
  })
  for (const ev of ['hub-browser-state', 'hub-chat-state']) document.addEventListener(ev, () => paintRail())
  new MutationObserver(paintRail).observe(seg, { subtree: true, childList: true, attributes: true, characterData: true })

  function tick() {
    const d = new Date()
    top.querySelector('.tvt-clock').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    top.querySelector('.tvt-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  }
  let wxAt = 0
  async function weather() {
    if (!document.documentElement.matches('[data-tvlook], [data-tvtouch]') || document.hidden || Date.now() - wxAt < 15 * 60_000 || !window.HubWeatherCard) return
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
