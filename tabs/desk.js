// Home's apps on a computer and a phone, as on the TV: your favorites in the row, then tiles for websites and the programs
// on this PC (desk.mjs keeps them). Only with the TV's look (tabs/tvlook.js); Light keeps the hub's own Home.
;(() => {
  const A = ':is(html[data-tvlook], html[data-tvtouch])', D = 'html[data-tvlook]', T = 'html[data-tvtouch]'
  const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) // programs start on the hub's own computer
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const svg = (d, w = 1.9) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
  const PLUS = svg('<path d="M12 5v14M5 12h14"/>', 2.2)
  // The TV's own tiles for these (tv/ui/brands).
  const B = (bg, fg, icon, wide) => ({ bg, fg, icon, wide })
  const L = (bg, d, fg = '#fff') => ({ bg, fg, d })
  const M = (bg, box, art) => ({ bg, art: `<svg viewBox="${box}" aria-hidden="true">${art}</svg>` }) // a mark in its own colours
  const BRAND = {
    gmaps: L('linear-gradient(155deg,#34a853,#14612b)', '<path d="M12 21s-7-6.4-7-11.5a7 7 0 0 1 14 0C19 14.6 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/>'),
    outlook: L('linear-gradient(155deg,#0f78d4,#083f73)', '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="m3.5 8 8.5 6 8.5-6"/>'),
    gmail: M('#fff', '52 42 88 66', '<path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6"/><path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15"/><path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2"/><path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92"/><path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2"/>'),
    gcal: M('#fff', '0 0 200 200', '<path fill="#fff" d="M152.6 47.4H47.4v105.2h105.2z"/><path fill="#ea4335" d="M152.6 200 200 152.6h-47.4z"/><path fill="#fbbc04" d="M200 47.4h-47.4v105.2H200z"/><path fill="#34a853" d="M152.6 152.6H47.4V200h105.2z"/><path fill="#188038" d="M0 152.6v31.6C0 192.9 7.1 200 15.8 200h31.6v-47.4z"/><path fill="#1967d2" d="M200 47.4V15.8C200 7.1 192.9 0 184.2 0h-31.6v47.4z"/><path fill="#4285f4" d="M152.6 0H15.8C7.1 0 0 7.1 0 15.8v136.8h47.4V47.4h105.2z"/><text x="100" y="129" text-anchor="middle" fill="#4285f4" style="font:600 78px Arial,sans-serif;letter-spacing:-4px">31</text>'),
    gdrive: M('#fff', '0 0 87.3 78', '<path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z"/><path fill="#00ac47" d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 0 0 0 53h27.5z"/><path fill="#ea4335" d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z"/><path fill="#00832d" d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z"/><path fill="#2684fc" d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"/><path fill="#ffba00" d="M73.4 26.5 60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z"/>'),
    gdocs: M('#fff', '0 0 48 64', '<path fill="#4285f4" d="M30 0H4.5A4.5 4.5 0 0 0 0 4.5v55A4.5 4.5 0 0 0 4.5 64h39a4.5 4.5 0 0 0 4.5-4.5V18z"/><path fill="#a1c2fa" d="M30 0v13.5a4.5 4.5 0 0 0 4.5 4.5H48z"/><path fill="#f1f1f1" d="M12 46.5h24v-3H12zm0 6h17v-3H12zm0-21v3h24v-3zm0 9h24v-3H12z"/>'),
    instagram: L('radial-gradient(130% 150% at 28% 108%,#fdf497 0,#fd8a3f 22%,#fd3e57 45%,#c13aa5 68%,#5a50d8 100%)', '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17" cy="7" r=".6" fill="currentColor"/>'),
    x: M('#000', '0 0 24 24', '<path fill="#fff" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>'),
    linkedin: M('#0a66c2', '2.5 2.5 19 19', '<path fill="#fff" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125m1.782 13.019H3.555V9h3.564z"/>'),
    facebook: M('#0866ff', '0 0 24 24', '<path fill="#fff" d="M15.12 24v-9.3h3.13l.6-3.63h-3.73V8.72c0-1 .49-1.96 2.05-1.96h1.59V3.67s-1.44-.25-2.82-.25c-2.88 0-4.76 1.75-4.76 4.91v2.74H7.98v3.63h3.2V24z"/>'),
    youtube: B('#fff', '#ff0000', 'youtube'), netflix: B('#000', '#e50914', 'netflix'), spotify: B('#121212', '#1ed760', 'spotify'), primevideo: B('#00050d', '#1aa8f0', 'primevideo', 1),
    max: B('linear-gradient(160deg,#002be7,#000d6b)', '#fff', 'max'), appletv: B('#000', '#fff', 'appletv'), plex: B('#1f1f1f', '#ebaf00', 'plex'), crunchyroll: B('#f47521', '#fff', 'crunchyroll'),
    paramountplus: B('linear-gradient(160deg,#0064ff,#002a8f)', '#fff', 'paramountplus'), twitch: B('#9146ff', '#fff', 'twitch'), tubi: B('#7408ff', '#ffff13', 'tubi'),
    disney: B('linear-gradient(160deg,#1f3fa3,#06123b)', '#fff', 'disney-wordmark', 1), hulu: B('#1ce783', '#0b0c0f', 'hulu-wordmark', 1),
  }
  const css = document.createElement('style')
  css.textContent = `
#dk, #dkfav, #dkmenu, #dkadd { display: none; }
${A} .hw-root:not(.hw-edit) > #dk { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 26px clamp(18px, 2.3vw, 44px); padding: 10px 4px 130px; }
${A} .hw-root:not(.hw-edit) .hw-cell.a, ${A} .hw-root:not(.hw-edit) > .hw-bar, ${A} .hw-root.hw-edit .hw-cell.a { display: none !important; }
${A} .hw-root.hw-edit > #dk { display: none; }
${D}:has(.hw-root) .controls { padding-right: 0 !important; }
${D} .page:has(.hw-root:not(.hw-edit)) .search { flex: 0 1 300px !important; }
/* Home scrolls as one page, the widgets stepping aside, as on the TV. */
${D} .hw-root:not(.hw-edit) .hw-frame { height: 0 !important; } ${D} .hw-root:not(.hw-edit) .hw-pager { overflow: visible; }
${D}:has(.hw-root:not(.hw-edit)) { overflow-y: auto !important; overflow-x: clip; scrollbar-width: none; }
${D} #tvside { transition: opacity .3s; } ${D}[data-down] #tvside { opacity: 0; pointer-events: none; }
${A}:has(.hw-root:not(.hw-edit)) #dkfav { display: flex; gap: 14px; min-width: 0; }
/* More favorites than fit: the row scrolls, fading at the end there is more of. The padding leaves room for a tile's ring. */
${D}:has(.hw-root) #dkfav { flex: 1 1 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; padding: 6px; margin: -6px; --l: 0px; --r: 0px; -webkit-mask: linear-gradient(90deg, transparent, #000 var(--l), #000 calc(100% - var(--r)), transparent); mask: linear-gradient(90deg, transparent, #000 var(--l), #000 calc(100% - var(--r)), transparent); }
${D} #dkfav.more-l { --l: 44px !important; } ${D} #dkfav.more-r { --r: 44px !important; } #dkfav::-webkit-scrollbar { display: none; }
${T}:has(.hw-root) #dkfav { flex: 1 0 100%; overflow-x: auto; scrollbar-width: none; padding: 6px 2px; }
.dk-t { position: relative; min-width: 0; padding: 0; text-align: center; border-radius: 18px; outline: 0; }
.dk-a { position: relative; display: grid; place-items: center; aspect-ratio: 5 / 3; border-radius: 18px; overflow: hidden; background: var(--dk-bg, #22232a); color: var(--dk-fg, #fff); box-shadow: 0 8px 22px -10px rgba(0, 0, 0, .7); transition: box-shadow .15s; }
/* A little light along the top edge, as on the TV's tiles. */
.dk-a::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: linear-gradient(180deg, rgba(255, 255, 255, .13), rgba(255, 255, 255, 0) 45%); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .09); }
.dk-a i { display: block; width: 46%; height: 52%; background: currentColor; -webkit-mask: var(--g) center / contain no-repeat; mask: var(--g) center / contain no-repeat; }
.dk-a i.wide { width: 74%; height: 62%; } .dk-a > svg { width: auto; height: 50%; } .dk-a.mk > svg { height: 46%; max-width: 46%; }
.dk-a img { width: auto; height: 46%; max-width: 46%; object-fit: contain; border-radius: 22%; filter: drop-shadow(0 6px 12px rgba(0, 0, 0, .35)); }
.dk-a img.pc { border-radius: 0; height: 54%; }
.dk-a b { font: 700 clamp(22px, 2.6vw, 40px)/1 var(--display); letter-spacing: -.02em; }
.dk-n { display: block; margin-top: 10px; font-size: 14px; font-weight: 600; color: #fff; text-shadow: 0 1px 4px rgba(0, 0, 0, .7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Only a white border: nothing moves. */
.dk-t:hover .dk-a, .dk-t:focus-visible .dk-a { box-shadow: 0 0 0 3px rgba(255, 255, 255, .9); }
.dk-t.add .dk-a { --dk-bg: var(--ui-fill); color: rgba(255, 255, 255, .75); }
.dk-t.add .dk-a > svg { width: 34px; height: 34px; }
.dk-t.over .dk-a { box-shadow: -4px 0 0 #0a84ff; } .dk-t.drag { opacity: .35; }
#dkfav .dk-a { box-shadow: none; } #dkfav .dk-t:is(:hover, :focus-visible) .dk-a { box-shadow: 0 0 0 3px rgba(255, 255, 255, .9); }
#dkfav .dk-t { flex: none; width: 96px; } #dkfav .dk-a { height: 58px; aspect-ratio: auto; border-radius: 16px; } #dkfav .dk-n { display: none; }
#dkfav .dk-a b { font-size: 20px; } #dkfav .add .dk-a > svg { width: 24px; height: 24px; }
@media (max-width: 1250px) { ${D} .hw-root:not(.hw-edit) > #dk { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 700px) { ${T} .hw-root:not(.hw-edit) > #dk { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 12px; padding: 4px 0 24px; } .dk-n { font-size: 12.5px; margin-top: 7px; } #dkfav .dk-t { width: 84px; } }
${A} #dkadd.on { display: grid; position: fixed; z-index: 72; inset: 0; place-items: center; padding: 24px; background: rgba(0, 0, 0, .5); color: #fff; }
.dk-sheet { display: flex; flex-direction: column; width: min(760px, 100%); max-height: min(680px, 88vh); border-radius: 30px; background: var(--ui-panel); box-shadow: var(--ui-edge), 0 40px 100px rgba(0, 0, 0, .6); overflow: hidden; }
.dk-sheet header { display: flex; align-items: center; gap: 14px; padding: 24px 26px 14px; font: 700 26px/1 var(--display); }
.dk-sheet header input { flex: 1; height: 46px; padding: 0 20px; border: 0; outline: 0; border-radius: 23px; background: var(--ui-fill); box-shadow: var(--ui-edge); color: #fff; font: 600 16px var(--font); }
.dk-sheet header input:focus { box-shadow: 0 0 0 2px #fff; }
.dk-sheet header button { height: 46px; padding: 0 20px; border-radius: 23px; background: var(--ui-sel); color: #000; font-size: 15px; font-weight: 600; }
.dk-list { overflow-y: auto; scrollbar-width: none; padding: 4px 26px 28px; }
.dk-list h4 { margin: 18px 4px 12px; font-size: 13px; font-weight: 600; color: rgba(255, 255, 255, .56); }
.dk-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 18px 14px; padding: 6px 4px; }
.dk-grid .dk-t.have .dk-a::before { content: "✓"; position: absolute; z-index: 2; right: 8px; top: 8px; width: 22px; height: 22px; border-radius: 50%; background: #0a84ff; color: #fff; font: 700 13px/22px var(--font); }
.dk-none { padding: 30px; text-align: center; color: rgba(255, 255, 255, .56); }
`
  document.head.append(css)

  let S = { apps: [], favorites: [], more: [] }, pc = null, q = '', loaded = false
  const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify(b) })
  const isPc = a => a.id.startsWith('pc:')
  const visible = () => S.apps.filter(a => LOCAL || !isPc(a))
  const find = id => S.apps.find(a => a.id === id) || S.more.find(a => a.id === id) || pc?.find(a => a.id === id)
  async function load() { try { const r = await fetch('/api/desk', { cache: 'no-store' }); if (r.ok) { S = await r.json(); loaded = true; paint() } } catch {} }
  async function save() { paint(); try { const r = await post('/api/desk', { apps: S.apps, favorites: S.favorites }); if (!r.ok) throw 0 } catch { window.hud?.('That didn’t save. Try again in a moment.'); load() } }

  // A tile's colour comes from its own icon, so a site without a known logo still looks like itself.
  const tints = { ...JSON.parse(localStorage.getItem('localhub.tints3') || '{}'), claude: '#f0eee6' }
  function tint(img, id) {
    try {
      const c = document.createElement('canvas')
      c.width = c.height = 24
      const g = c.getContext('2d', { willReadFrequently: true })
      g.drawImage(img, 0, 0, 24, 24)
      const px = g.getImageData(0, 0, 24, 24).data
      let r = 0, gr = 0, b = 0, n = 0
      for (let i = 0; i < px.length; i += 4) {
        const mx = Math.max(px[i], px[i + 1], px[i + 2]), mn = Math.min(px[i], px[i + 1], px[i + 2]), w = (px[i + 3] / 255) * (mx - mn + 4)
        r += px[i] * w; gr += px[i + 1] * w; b += px[i + 2] * w; n += w
      }
      if (!n) return
      // A dark mark (GitHub's) goes on a light tile.
      let ink = 0, inkN = 0
      for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 120) { ink += (px[i] * .3 + px[i + 1] * .59 + px[i + 2] * .11); inkN++ }
      const solid = inkN > 24 * 24 * .9
      if (inkN && ink / inkN < 46 && !solid) { tints[id] = 'linear-gradient(155deg, #f4f4f6, #c9cad1)'; localStorage.setItem('localhub.tints3', JSON.stringify(tints)); document.querySelectorAll(`[data-dk="${CSS.escape(id)}"] .dk-a`).forEach(n => n.style.setProperty('--dk-bg', tints[id])); return }
      const k = v => Math.round(v / n), m = (f, v) => Math.round(Math.min(255, v * f))
      const [R, G, Bl] = [k(r), k(gr), k(b)], lum = (R * .3 + G * .59 + Bl * .11) || 1, f = Math.min(.62, 74 / lum)
      tints[id] = `linear-gradient(155deg, rgb(${m(f, R) + 16},${m(f, G) + 16},${m(f, Bl) + 16}), rgb(${m(f * .42, R)},${m(f * .42, G)},${m(f * .42, Bl)}))`
      localStorage.setItem('localhub.tints3', JSON.stringify(tints))
      document.querySelectorAll(`[data-dk="${CSS.escape(id)}"] .dk-a`).forEach(n => n.style.setProperty('--dk-bg', tints[id]))
    } catch {}
  }
  document.addEventListener('load', e => { const id = e.target?.dataset?.dkicon; if (id && !tints[id]) tint(e.target, id) }, true)
  document.addEventListener('error', e => { const i = e.target; if (!i?.dataset?.dkicon) return; i.replaceWith(Object.assign(document.createElement('b'), { textContent: (i.alt || '?').slice(0, 1).toUpperCase() })) }, true)
  function art(a) {
    const b = BRAND[a.id]
    if (b?.art) return `<span class="dk-a mk" style="--dk-bg:${b.bg}">${b.art}</span>`
    if (b?.d) return `<span class="dk-a" style="--dk-bg:${b.bg};--dk-fg:${b.fg}">${svg(b.d, 1.7)}</span>`
    if (b) return `<span class="dk-a" style="--dk-bg:${b.bg};--dk-fg:${b.fg}"><i class="${b.wide ? 'wide' : ''}" style="--g:url('/tv/brands/${b.icon}.svg')"></i></span>`
    const src = isPc(a) || (a.pc && LOCAL) ? `/api/desk/icon?id=${encodeURIComponent(a.pc || a.id)}` : `/api/hub/site-icon?url=${encodeURIComponent(a.url)}`
    return `<span class="dk-a"${tints[a.id] ? ` style="--dk-bg:${esc(tints[a.id])}"` : ''}><img class="${isPc(a) || a.pc ? 'pc' : ''}" data-dkicon="${esc(a.id)}" src="${esc(src)}" alt="${esc(a.name)}" loading="lazy" draggable="false"></span>`
  }
  const tile = (a, cls = '', label = a.name) => `<button type="button" class="dk-t ${cls}" data-dk="${esc(a.id)}" draggable="true" aria-label="${esc(a.name)}">${art(a)}<span class="dk-n">${esc(label)}</span></button>`
  const plus = label => `<button type="button" class="dk-t add" data-dk="add" aria-label="${label}"><span class="dk-a">${PLUS}</span><span class="dk-n">${label}</span></button>`
  const set = (n, html) => { if (n._html !== html) { n._html = html; n.innerHTML = html } }

  // What an app is, from its name: work, assistants, watching, music, games, then the rest.
  const TYPES = [/mail|gmail|outlook|calendar|drive|docs|sheets|slides|notion|slack|teams|zoom|word|excel|powerpoint|onenote|office|meet|trello|linear|figma|canva/i, /claude|chatgpt|gemini|copilot|perplexity/i, /netflix|youtube|disney|prime video|hulu|\bmax\b|hbo|apple ?tv|peacock|paramount|crunchyroll|twitch|plex|tubi|vlc/i, /music|spotify|soundcloud|tidal|pandora|audible/i, /steam|xbox|epic|game|minecraft|roblox|battle/i, /github|code|studio|terminal|docker|git|cursor/i, /instagram|facebook|\bx\b|twitter|reddit|tiktok|discord|whatsapp|messenger|linkedin/i]
  const typeOf = a => { const i = TYPES.findIndex(r => r.test(a.name)); return i < 0 ? TYPES.length : i }
  const opens = () => { try { return JSON.parse(localStorage.getItem('localhub.opens') || '{}') || {} } catch { return {} } }
  function opened(id) { const o = opens(); o[id] = [(o[id]?.[0] || 0) + 1, Date.now()]; try { localStorage.setItem('localhub.opens', JSON.stringify(o)) } catch {} }
  let shown = []
  // Dragging while sorted: what's on screen becomes your own order.
  function ownOrder() {
    if (shown.length !== visible().length || q) return
    S.apps = [...shown, ...S.apps.filter(a => !shown.includes(a))]
    document.dispatchEvent(new Event('hub-sort-mine'))
  }
  let grid = null, fav = null
  function edges() {
    const max = fav.scrollWidth - fav.clientWidth
    fav.classList.toggle('more-l', fav.scrollLeft > 2)
    fav.classList.toggle('more-r', max > 2 && fav.scrollLeft < max - 2)
  }
  function paint() {
    if (!document.documentElement.matches('[data-tvlook], [data-tvtouch]')) return
    const root = document.querySelector('.hw-root')
    if (!root || !loaded) return
    if (!fav) { fav = document.createElement('div'); fav.id = 'dkfav'; fav.setAttribute('aria-label', 'Favorites'); document.getElementById('controls').append(fav)
      fav.addEventListener('scroll', edges, { passive: true })
      // A mouse wheel moves the row until its end, then the page. A touchpad's sideways swipe is the browser's own.
      fav.addEventListener('wheel', e => {
        if (Math.abs(e.deltaX) >= Math.abs(e.deltaY) || e.ctrlKey) return
        const max = fav.scrollWidth - fav.clientWidth
        if (max < 2 || (e.deltaY < 0 ? fav.scrollLeft < 1 : fav.scrollLeft > max - 1)) return
        e.preventDefault()
        fav.scrollBy({ left: e.deltaY * (e.deltaMode === 1 ? 32 : 1.4), behavior: Math.abs(e.deltaY) > 40 || e.deltaMode === 1 ? 'smooth' : 'auto' })
      }, { passive: false })
      new ResizeObserver(edges).observe(fav)
    }
    if (grid?.parentElement !== root) { grid ??= Object.assign(document.createElement('div'), { id: 'dk' }); const st = root.querySelector('.hw-stage'); st ? st.before(grid) : root.append(grid) }
    const gear = document.getElementById('tvgear')
    if (gear && document.documentElement.hasAttribute('data-tvtouch') && fav.previousElementSibling !== gear) gear.after(fav)
    let sort = 'mine'
    try { sort = JSON.parse(localStorage.getItem('localhub.look') || '{}').sort || 'mine' } catch {}
    let list = visible()
    const az = (a, b) => a.name.localeCompare(b.name), use = opens()
    const by = v => (list = [...list].sort((a, b) => v(b) - v(a)))
    if (sort === 'az') list = [...list].sort(az)
    else if (sort === 'za') list = [...list].sort((a, b) => az(b, a))
    else if (sort === 'recent') by(a => use[a.id]?.[1] || 0)
    else if (sort === 'most') by(a => use[a.id]?.[0] || 0)
    else if (sort === 'fav') by(a => (isFav(a.id) ? 1 : 0))
    else if (sort === 'web') by(a => (isPc(a) ? 0 : 1))
    else if (sort === 'pc') by(a => (isPc(a) ? 1 : 0))
    else if (sort === 'type') list = [...list].sort((a, b) => typeOf(a) - typeOf(b) || az(a, b))
    shown = list
    if (q) list = list.filter(a => a.name.toLowerCase().includes(q))
    set(grid, q ? list.map(a => tile(a)).join('') || '<div class="dk-none" style="grid-column:1/-1">No apps by that name. Press Enter to search the web.</div>' : list.map(a => tile(a)).join('') + plus('Add'))
    set(fav, S.favorites.map(find).filter(a => a && (LOCAL || !isPc(a))).map(a => tile(a, 'fav')).join('') + `<button type="button" class="dk-t add" data-dk="addfav" aria-label="Add a favorite"><span class="dk-a">${PLUS}</span></button>`)
    edges()
  }

  async function open(id, web) {
    const a = find(id)
    if (!a) return
    opened(id)
    const page = () => window.open(a.url, '_blank', 'noopener,noreferrer')
    if (!LOCAL) return isPc(a) ? window.hud?.('Programs open on the computer the hub runs on.') : page()
    // On the hub's own computer it's the program if it's installed, else the website in a window of its own.
    try {
      const r = await post('/api/desk/open', { id, ...(web ? { web: true } : {}) }), j = await r.json()
      if (!r.ok) return a.url ? page() : window.hud?.(j.error || 'That didn’t open.')
      if (j.url) page()
    } catch { a.url ? page() : window.hud?.('The hub didn’t answer.') }
  }
  const isFav = id => S.favorites.includes(id)
  const toggleFav = id => { S.favorites = isFav(id) ? S.favorites.filter(x => x !== id) : [...S.favorites, id]; return save() }
  function add(a) { if (!S.apps.some(x => x.id === a.id)) S.apps.push({ id: a.id, name: a.name, ...(a.url ? { url: a.url } : {}) }) }

  // ── right click, or a long press ──
  const menu = Object.assign(document.createElement('div'), { id: 'dkmenu' })
  document.body.append(menu)
  let menuId = ''
  const closeMenu = () => menu.classList.remove('on')
  function openMenu(id, x, y) {
    const a = find(id), ic = window.HubMenuIcon || (() => ''), it = (label, icon, run, danger) => ({ label, icon: ic(icon), run, danger })
    showMenu(x, y, a?.name || 'App', [
      it('Open', 'open', () => open(id)),
      ...(LOCAL && a?.url ? [it('Open in the browser', 'link', () => open(id, true))] : []),
      ...(a?.url ? [it('Copy link', 'copy', () => navigator.clipboard.writeText(a.url).catch(() => {}))] : []),
      '-',
      it(isFav(id) ? 'Remove from favorites' : 'Add to favorites', 'star', () => toggleFav(id)),
      it('Move to the front', 'front', () => { ownOrder(); const a = S.apps.find(x => x.id === id); S.apps = [a, ...S.apps.filter(x => x !== a)]; if (isFav(id)) S.favorites = [id, ...S.favorites.filter(x => x !== id)]; save() }),
      it('Add an app…', 'plus', () => openAdd(false)),
      '-',
      it('Remove from Home', 'trash', () => { S.apps = S.apps.filter(x => x.id !== id); S.favorites = S.favorites.filter(x => x !== id); save() }, true),
    ])
  }
  document.addEventListener('pointerdown', e => { if (!menu.contains(e.target)) closeMenu() })

  // ── add: websites, this PC's programs, or any address ──
  const sheet = Object.assign(document.createElement('div'), { id: 'dkadd' })
  sheet.innerHTML = '<div class="dk-sheet" role="dialog" aria-modal="true" aria-label="Add an app or website"><header><input type="text" placeholder="Search, or type a web address" aria-label="Search, or type a web address"><button type="button" data-dkclose>Done</button></header><div class="dk-list"></div></div>'
  document.body.append(sheet)
  const sq = sheet.querySelector('input'), sl = sheet.querySelector('.dk-list')
  let forFav = false
  function paintAdd() {
    const t = sq.value.trim().toLowerCase(), hit = a => !t || a.name.toLowerCase().includes(t)
    const have = a => (forFav ? isFav(a.id) : S.apps.some(x => x.id === a.id))
    const sec = (title, list) => (list.length ? `<h4>${title}</h4><div class="dk-grid">${list.map(a => tile(a, have(a) ? 'have' : '')).join('')}</div>` : '')
    const addr = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+([/?#]\S*)?$/i.test(t) ? t : ''
    const mine = S.apps.filter(hit), more = S.more.filter(a => hit(a) && !S.apps.some(x => x.id === a.id)), progs = LOCAL ? (pc || []).filter(a => hit(a) && !S.apps.some(x => x.id === a.id)) : []
    set(sl, (addr ? `<h4>Website</h4><div class="dk-grid"><button type="button" class="dk-t" data-addr="${esc(sq.value.trim())}"><span class="dk-a">${PLUS}</span><span class="dk-n">${esc(addr)}</span></button></div>` : '')
      // Websites before programs: there are far fewer of them.
      + sec('On Home', forFav || t ? mine : []) + sec('Websites', more) + sec('On this PC', progs)
      + (LOCAL && !pc ? '<div class="dk-none">Looking at this PC’s programs…</div>' : '') || '<div class="dk-none">Nothing by that name. Type its web address to add it.</div>')
  }
  async function openAdd(asFav) {
    forFav = !!asFav
    sheet.querySelector('.dk-sheet').setAttribute('aria-label', forFav ? 'Favorites' : 'Add to Home')
    sl.scrollTop = 0
    sq.value = ''
    sheet.classList.add('on')
    paintAdd()
    if (!document.documentElement.hasAttribute('data-tvtouch')) sq.focus()
    if (LOCAL && !pc) { try { pc = (await (await fetch('/api/desk/pc')).json()).apps || [] } catch { pc = [] } paintAdd() }
  }
  const closeAdd = () => sheet.classList.remove('on')
  sq.addEventListener('input', paintAdd)
  sq.addEventListener('keydown', e => { if (e.key === 'Enter') sl.querySelector('.dk-t')?.click() })
  sheet.addEventListener('click', e => {
    if (e.target === sheet || e.target.closest('[data-dkclose]')) return closeAdd()
    const ad = e.target.closest('[data-addr]')?.dataset.addr
    let a = null
    if (ad) {
      let u
      try { u = new URL(/^https?:/i.test(ad) ? ad : `https://${ad}`) } catch { return }
      const base = u.hostname.replace(/^www\./, '').split('.')[0]
      a = { id: `w-${u.hostname.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${(u.pathname.length * 7 + u.search.length).toString(36)}`.slice(0, 46), name: base.charAt(0).toUpperCase() + base.slice(1), url: u.href }
      sq.value = ''
    } else { const id = e.target.closest('[data-dk]')?.dataset.dk; a = id && find(id) }
    if (!a) return
    if (forFav) { add(a); S.favorites = isFav(a.id) ? S.favorites.filter(x => x !== a.id) : [...S.favorites, a.id] }
    else if (S.apps.some(x => x.id === a.id)) { if (!ad) { S.apps = S.apps.filter(x => x.id !== a.id); S.favorites = S.favorites.filter(x => x !== a.id) } } else add(a)
    save()
    paintAdd()
  })
  addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (menu.classList.contains('on')) { e.stopPropagation(); closeMenu() } else if (sheet.classList.contains('on')) { e.stopPropagation(); closeAdd() } }, true)

  addEventListener('scroll', () => document.documentElement.toggleAttribute('data-down', scrollY > 60), { passive: true })
  // ── the tiles ──
  const onHome = e => e.target.closest?.('#dk .dk-t, #dkfav .dk-t')
  let pressT = 0, pressed = false
  document.addEventListener('click', e => {
    const t = onHome(e)
    if (!t) return
    if (pressed) { pressed = false; return }
    const id = t.dataset.dk
    if (id === 'add') openAdd(false)
    else if (id === 'addfav') openAdd(true)
    else open(id)
  })
  // First, and alone: Home's own menu is for what's around the tiles.
  addEventListener('contextmenu', e => { const t = onHome(e); closeMenu(); if (!t || t.classList.contains('add')) return; e.preventDefault(); e.stopImmediatePropagation(); openMenu(t.dataset.dk, e.clientX, e.clientY) }, true)
  document.addEventListener('pointerdown', e => { const t = onHome(e); if (!t || e.pointerType !== 'touch' || t.classList.contains('add')) return; pressed = false; clearTimeout(pressT); pressT = setTimeout(() => { pressed = true; openMenu(t.dataset.dk, e.clientX, e.clientY) }, 550) })
  for (const ev of ['pointerup', 'pointercancel', 'scroll']) addEventListener(ev, () => clearTimeout(pressT), true)
  // Drag to reorder, or a tile onto the favorites.
  let drag = ''
  document.addEventListener('dragstart', e => { const t = onHome(e); if (!t || t.classList.contains('add')) return; drag = t.dataset.dk; t.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.getAttribute('aria-label') || ''); e.stopPropagation() }, true)
  document.addEventListener('dragover', e => { if (!drag) return; document.querySelectorAll('.dk-t.over').forEach(n => n.classList.remove('over')); const t = onHome(e); if (fav?.contains(e.target)) { const r = fav.getBoundingClientRect(); if (e.clientX > r.right - 60) fav.scrollLeft += 10; else if (e.clientX < r.left + 60) fav.scrollLeft -= 10 } if (t || e.target.closest?.('#dkfav')) { e.preventDefault(); if (t && t.dataset.dk !== drag) t.classList.add('over') } })
  document.addEventListener('drop', e => {
    if (!drag) return
    const t = onHome(e), inFav = !!e.target.closest?.('#dkfav'), id = drag
    if (!t && !inFav) return
    e.preventDefault()
    const to = t && !t.classList.contains('add') ? t.dataset.dk : null
    if (to === id) return
    if (inFav) { const l = S.favorites.filter(x => x !== id), i = to ? l.indexOf(to) : l.length; l.splice(i < 0 ? l.length : i, 0, id); S.favorites = l }
    else { ownOrder(); const a = S.apps.find(x => x.id === id), l = S.apps.filter(x => x !== a), i = to ? l.findIndex(x => x.id === to) : l.length; if (!a) return; l.splice(i < 0 ? l.length : i, 0, a); S.apps = l }
    save()
  })
  document.addEventListener('dragend', () => { drag = ''; document.querySelectorAll('.dk-t.over, .dk-t.drag').forEach(n => n.classList.remove('over', 'drag')) })
  // The search bar: your apps, then the web.
  const box = document.getElementById('q')
  box.addEventListener('input', () => { q = document.querySelector('.hw-root') ? box.value.trim().toLowerCase() : ''; paint() })
  box.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !document.querySelector('.hw-root') || !box.value.trim()) return
    const first = grid?.querySelector('.dk-t')
    if (first) open(first.dataset.dk)
    else window.open(`https://www.google.com/search?q=${encodeURIComponent(box.value.trim())}`, '_blank', 'noopener,noreferrer')
  })
  load()
  setInterval(() => { if (!document.hidden) { if (!box.value) q = ''; paint() } }, 1000)
  addEventListener('focus', load)
  window.HubDesk = { art: id => { const a = find(id); return a ? art(a) : "" }, open: openAdd, paint, launch: id => open(id) }
})()
