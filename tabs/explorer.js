// Files, as a file explorer: your folders, drives and media down the left, what's recent on its front page, and every folder
// as pictures or a list, sorted and filtered. The page's own rows do the work (index.html: right click, drag, open, edit), so
// this only draws them. Only for this computer's files; the server's keep their plain list.
;(() => {
  const S = Object.assign({ view: 'grid', sort: 'name', kind: 'all' }, (() => { try { return JSON.parse(localStorage.getItem('localhub.explorer') || '{}') } catch { return {} } })())
  const keep = () => { try { localStorage.setItem('localhub.explorer', JSON.stringify(S)) } catch {} }
  const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
  const IC = {
    home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h4.5v-5.5h4V20h4.5V9.5"/>', recent: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    Desktop: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8 20h8M12 16.5V20"/>', Downloads: '<path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14"/>', Documents: '<path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M14 3.5V8h4M9 13h6M9 16.5h4"/>',
    Pictures: '<rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M4 16l4.5-4.5 4 4 2.5-2.5 5 5"/><circle cx="15.5" cy="9" r="1.2"/>', Music: '<path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>', Videos: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M10.5 9.5v5l4-2.5z"/>',
    drive: '<path d="M4 13l3-8h10l3 8v5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><path d="M4 13h16M8 16.5h.01"/>', folder: '<path d="M4 7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>', cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 11.6 3.5 3.5 0 0 0 7 18.5z"/>',
    file: '<path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M14 3.5V8h4"/>', zip: '<path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M11 4v2M11 8v2M11 12v2"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>', list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="m9 5 7 7-7 7"/>',
  }
  const EXT = { image: /\.(png|jpe?g|gif|webp|avif|bmp|heic|svg)$/i, video: /\.(mp4|m4v|webm|mov|mkv|avi)$/i, music: /\.(mp3|m4a|wav|ogg|aac|flac)$/i, doc: /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|rtf|odt|ods|odp|pages|numbers|key|ipynb)$/i, zip: /\.(zip|rar|7z|tar|gz|iso)$/i }
  const kindOf = e => (e.dir ? 'folder' : Object.keys(EXT).find(k => EXT[k].test(e.name)) || 'other')
  const KINDS = [['all', 'Everything'], ['folder', 'Folders'], ['image', 'Pictures'], ['video', 'Videos'], ['music', 'Music'], ['doc', 'Documents'], ['other', 'Other']]
  const MEDIA = [['image', 'Pictures', 'Pictures'], ['video', 'Videos', 'Videos'], ['music', 'Music', 'Music'], ['doc', 'Documents', 'Documents']]
  const SORTS = [['name', 'Name'], ['date', 'Date'], ['size', 'Size'], ['type', 'Type']]
  const SHOWS = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i, PLAYS = /\.(mp4|m4v|webm|mov|mp3|m4a|wav|ogg|aac|flac)$/i
  let virtual = 'home', places = null, found = null, loading = '', shown = []

  const css = document.createElement('style')
  css.textContent = `
.ex { display: grid; grid-template-columns: 212px minmax(0, 1fr); gap: 28px; align-items: start; }
.ex-side { position: sticky; top: 24px; display: flex; flex-direction: column; gap: 2px; max-height: calc(100dvh - 60px); overflow-y: auto; scrollbar-width: none; }
.ex-side h4 { margin: 18px 12px 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--label-2); } .ex-side h4:first-child { margin-top: 0; }
.ex-side button { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 42px; padding: 0 12px; border-radius: 14px; font-size: 15px; font-weight: 600; text-align: left; color: var(--label); } .ex-side button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .ex-side svg { flex: none; width: 20px; height: 20px; color: var(--label-2); }
.ex-side button:hover { background: var(--fill); } .ex-side button.on { background: var(--ui-fill, var(--fill)); box-shadow: var(--ui-edge, none); } .ex-side button.on svg { color: inherit; }
.ex-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; min-height: 44px; }
.ex-path { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; flex: 1 1 260px; min-width: 0; font-size: 22px; font-weight: 700; letter-spacing: -.02em; } .ex-path button { max-width: 260px; padding: 4px 8px; border-radius: 10px; font: inherit; color: var(--label-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .ex-path button:last-of-type { color: var(--label); } .ex-path button:hover { background: var(--fill); } .ex-path i { font-style: normal; color: var(--label-3); }
.ex-tool { display: flex; gap: 4px; padding: 4px; border-radius: 99px; background: var(--ui-fill, var(--fill)); box-shadow: var(--ui-edge, none); } .ex-tool button { display: grid; place-items: center; min-width: 36px; height: 34px; padding: 0 12px; border-radius: 99px; font-size: 13.5px; font-weight: 600; color: var(--label-2); } .ex-tool button.on { background: var(--ui-sel, var(--label)); color: #000; } .ex-tool svg { width: 18px; height: 18px; }
.ex-kinds { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 18px; } .ex-kinds button { height: 34px; padding: 0 14px; border-radius: 99px; background: var(--ui-fill, var(--fill)); box-shadow: var(--ui-edge, none); font-size: 13.5px; font-weight: 600; color: var(--label-2); } .ex-kinds button.on { background: var(--ui-sel, var(--label)); color: #000; }
.ex h3 { margin: 26px 0 12px; font: 700 20px/1.1 var(--display); letter-spacing: -.02em; } .ex h3:first-child { margin-top: 0; }
.ex-places { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 14px; } .ex-place { display: flex; flex-direction: column; gap: 10px; padding: 18px; border-radius: 22px; background: var(--ui-panel, var(--surface)); box-shadow: var(--ui-edge, none); text-align: left; transition: box-shadow .15s; } .ex-place:hover, .ex-place:focus-visible { box-shadow: 0 0 0 3px rgba(255, 255, 255, .9); outline: 0; } .ex-place svg { width: 30px; height: 30px; } .ex-place b { font-size: 16px; } .ex-place span { font-size: 13px; color: var(--label-2); }
.ex-place u { display: block; height: 6px; border-radius: 3px; background: rgba(128, 128, 136, .3); overflow: hidden; text-decoration: none; } .ex-place u i { display: block; height: 100%; border-radius: 3px; background: currentColor; }
.ex-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 18px 14px; } .ex-grid .row { position: relative; min-width: 0; } .ex-grid .row::before { display: none !important; } .ex-grid .row-line { display: block; min-height: 0; padding: 0; text-align: center; border-radius: 18px; background: none !important; }
.ex-th { display: grid; place-items: center; aspect-ratio: 4 / 3; border-radius: 18px; overflow: hidden; background: var(--ui-panel, var(--surface)); box-shadow: var(--ui-edge, none); color: var(--label-2); transition: box-shadow .15s; } .ex-th > svg { width: 42px; height: 42px; } .ex-th.folder { color: #6cb6ff; } .ex-th.video { color: #ff8f6b; } .ex-th.music { color: #ff6aa8; } .ex-th.doc { color: #7fd18b; } .ex-th img { width: 100%; height: 100%; object-fit: cover; } .ex-grid .row-line:hover .ex-th, .ex-grid .row-line:focus-visible .ex-th { box-shadow: 0 0 0 3px rgba(255, 255, 255, .9); }
.ex-grid .t1 { margin-top: 9px; font-size: 14px; font-weight: 600; line-height: 1.3; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; } .ex-grid .t2 { font-size: 12px; }
.ex-list { border-radius: 20px; overflow: hidden; background: var(--ui-panel, var(--surface)); box-shadow: var(--ui-edge, none); } .ex-list .row::before { left: 56px !important; } .ex-list .row-line { display: grid; grid-template-columns: 30px minmax(0, 1fr) 130px 110px 90px; gap: 14px; min-height: 48px; padding: 6px 18px; font-size: 14px; } .ex-list .row-line > svg, .ex-list .ic { width: 22px; height: 22px; color: var(--label-2); } .ex-list .ic svg { width: 100%; height: 100%; } .ex-list .t1 { font-size: 15px; font-weight: 600; } .ex-list em { font-style: normal; color: var(--label-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .ex-list em.r { text-align: right; } .ex-hd { display: grid; grid-template-columns: 30px minmax(0, 1fr) 130px 110px 90px; gap: 14px; padding: 12px 18px 8px; font-size: 12px; font-weight: 600; color: var(--label-2); } .ex-hd button { font: inherit; color: inherit; text-align: left; } .ex-hd button.on { color: var(--label); } .ex-hd button.r { text-align: right; }
.ex-none { padding: 50px 20px; text-align: center; color: var(--label-2); } .ex-foot { margin-top: 18px; font-size: 13px; color: var(--label-2); }
html[data-tvlook] .page:has(.ex) .head .updated, .page:has(.ex) #main > .widgets { display: none; }
#exview { position: fixed; z-index: 210; inset: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); background: rgba(5, 6, 8, .94); color: #fff; } #exview header { display: flex; align-items: center; gap: 12px; padding: 18px 22px; font-size: 16px; font-weight: 600; } #exview header b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } #exview button { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: rgba(255, 255, 255, .12); color: #fff; } #exview button:hover { background: #f2f2f5; color: #000; } #exview button svg { width: 22px; height: 22px; } #exview main { position: relative; display: grid; place-items: center; min-height: 0; padding: 0 76px 26px; } #exview :is(img, video) { max-width: 100%; max-height: 100%; border-radius: 12px; object-fit: contain; min-height: 0; } #exview video { width: 100%; height: 100%; } #exview audio { width: min(560px, 90%); } #exview iframe { width: 100%; height: 100%; border: 0; border-radius: 12px; background: #fff; } #exview .p { position: absolute; left: 16px; } #exview .n { position: absolute; right: 16px; }
@media (max-width: 820px) { .ex { grid-template-columns: minmax(0, 1fr); gap: 14px; } .ex-side { position: static; flex-direction: row; max-height: none; overflow-x: auto; gap: 6px; } .ex-side h4 { display: none; } .ex-side button { width: auto; flex: none; background: var(--fill); } .ex-list .row-line, .ex-hd { grid-template-columns: 26px minmax(0, 1fr) 84px; } .ex-list em:nth-of-type(2), .ex-list em:nth-of-type(1), .ex-hd > :nth-child(3), .ex-hd > :nth-child(4) { display: none; } .ex-grid { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); } #exview main { padding: 0 8px 70px; } }
`
  document.head.append(css)

  const typeOf = e => (e.dir ? 'Folder' : { image: 'Picture', video: 'Video', music: 'Music', doc: 'Document', zip: 'Archive' }[kindOf(e)] || (e.name.includes('.') ? `${e.name.split('.').pop().toUpperCase()} file` : 'File'))
  const icon = e => svg(IC[{ folder: 'folder', image: 'Pictures', video: 'Videos', music: 'Music', doc: 'Documents', zip: 'zip' }[kindOf(e)] || 'file'])
  const sorted = l => [...l].sort((a, b) => (b.dir ? 1 : 0) - (a.dir ? 1 : 0) || (S.sort === 'date' ? b.mtime - a.mtime : S.sort === 'size' ? (b.size || 0) - (a.size || 0) : S.sort === 'type' ? typeOf(a).localeCompare(typeOf(b)) : 0) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  function item(e, p) {
    const attrs = `data-menu="file" data-root="drives" data-path="${esc(p)}" data-isdir="${e.dir ? 1 : ''}" data-name="${esc(e.name)}"`
    const link = e.dir ? `href="#" data-nav="${esc(p)}"` : SHOWS.test(e.name) || PLAYS.test(e.name) || /\.pdf$/i.test(e.name) ? `href="#" data-exview="${esc(p)}"` : isText(e.name) ? `href="#" data-edit="${esc(p)}"` : `href="${rawUrl('drives', p)}" target="_blank" rel="noopener"`
    const small = e.dir ? (e.count == null ? '' : `${e.count} item${e.count === 1 ? '' : 's'}`) : size(e.size)
    if (S.view === 'list') return `<div class="row" ${attrs}><a class="row-line tap" draggable="true" ${link}><span class="ic">${icon(e)}</span><span class="t1">${esc(e.name)}</span><em>${date(e.mtime)}</em><em>${esc(typeOf(e))}</em><em class="r">${esc(small)}</em></a></div>`
    const pic = SHOWS.test(e.name) && e.size < 12e6
    return `<div class="row" ${attrs}><a class="row-line tap" draggable="true" ${link} title="${esc(e.name)}"><span class="ex-th ${kindOf(e)}">${pic ? `<img src="${rawUrl('drives', p)}" alt="" loading="lazy" decoding="async" draggable="false">` : icon(e)}</span><span class="t1">${esc(e.name)}</span><span class="t2">${esc(small)}</span></a></div>`
  }
  // l: entries; each one's own path, or its name in this folder.
  function listHtml(l, base, filters) {
    const all = l.filter(e => S.kind === 'all' || !filters || kindOf(e) === S.kind || (S.kind === 'other' && kindOf(e) === 'zip'))
    const has = new Set(l.map(kindOf))
    shown = (filters || S.sort !== 'name' ? sorted(all) : all).map(e => ({ ...e, p: e.path ?? join(base, e.name) }))
    const body = shown.map(e => item(e, e.p)).join('')
    const chips = filters && has.size > 1 ? `<div class="ex-kinds">${KINDS.filter(([k]) => k === 'all' || has.has(k) || (k === 'other' && has.has('zip'))).map(([k, t]) => `<button type="button" data-ex="kind:${k}" class="${S.kind === k ? 'on' : ''}">${t}</button>`).join('')}</div>` : ''
    const head = `<div class="ex-hd"><span></span>${[['name', 'Name', ''], ['date', 'Modified', ''], ['type', 'Type', ''], ['size', 'Size', 'r']].map(([k, t, c]) => `<button type="button" data-ex="sort:${k}" class="${c}${S.sort === k ? ' on' : ''}">${t}</button>`).join('')}</div>`
    const dirs = l.filter(e => e.dir).length
    return chips + (!shown.length ? `<div class="ex-none">${l.length ? 'Nothing of that kind in here.' : 'This folder is empty.'}</div>` : S.view === 'list' ? `<div class="ex-list">${head}${body}</div>` : `<div class="ex-grid">${body}</div>`) + (l.length ? `<div class="ex-foot">${filters ? `${dirs} folder${dirs === 1 ? '' : 's'}, ${l.length - dirs} file${l.length - dirs === 1 ? '' : 's'}` : `${l.length} file${l.length === 1 ? '' : 's'}, newest first`}</div>` : '')
  }
  const driveName = e => (e.type === 'iCloud' ? e.label : e.label && e.label !== e.name ? `${e.label} (${e.name})` : e.name)
  function side() {
    const at = fsPath.drives, b = (id, ic, t, on) => `<button type="button" data-ex="${esc(id)}" class="${on ? 'on' : ''}">${svg(ic)}<span>${esc(t)}</span></button>`
    const under = (p, deep) => !virtual && (at === p || (deep && at.startsWith(`${p}/`)))
    const ps = places?.places || []
    return `<nav class="ex-side" aria-label="Places">${b('home', IC.home, 'Home', virtual === 'home')}${b('recent', IC.recent, 'Recent', virtual === 'recent')}<h4>Folders</h4>${ps.map(p => b(`go:${p.path}`, IC[p.id] || IC.folder, p.id, under(p.path, true))).join('')}<h4>Media</h4>${MEDIA.map(([k, t, ic]) => b(`all:${k}`, IC[ic], `All ${t.toLowerCase()}`, virtual === `all:${k}`)).join('')}<h4>This computer</h4>${(drives || []).map(d => b(`go:${d.type === 'iCloud' ? 'iCloud' : d.name}`, d.type === 'iCloud' ? IC.cloud : IC.drive, driveName(d), !virtual && (at === d.name || (at.startsWith(`${d.name}/`) && !ps.some(p => at === p.path || at.startsWith(`${p.path}/`)))))).join('')}</nav>`
  }
  function bar(title) {
    const parts = virtual ? [] : fsPath.drives.split('/').filter(Boolean)
    const crumbs = virtual ? `<button type="button">${esc(title)}</button>` : parts.map((n, i) => `${i ? '<i>›</i>' : ''}<button type="button" data-ex="go:${esc(parts.slice(0, i + 1).join('/'))}">${esc(i ? n : drives?.find(d => d.name === n)?.label || n)}</button>`).join('')
    const tools = virtual === 'home' ? '' : `<div class="ex-tool" role="group" aria-label="Sort">${SORTS.map(([k, t]) => `<button type="button" data-ex="sort:${k}" class="${S.sort === k ? 'on' : ''}">${t}</button>`).join('')}</div><div class="ex-tool" role="group" aria-label="View">${[['grid', 'Pictures'], ['list', 'List']].map(([k, t]) => `<button type="button" data-ex="view:${k}" class="${S.view === k ? 'on' : ''}" aria-label="${t}" title="${t}">${svg(IC[k])}</button>`).join('')}</div>`
    return `<div class="ex-bar"><div class="ex-path">${crumbs}</div>${tools}</div>`
  }
  function homeHtml() {
    const ps = places?.places || [], rec = (places?.recent || []).slice(0, 12)
    const was = S.view
    S.view = 'list'
    const keepSort = S.sort
    S.sort = 'date'
    const recent = rec.length ? listHtml(rec, '', false).replace(/<div class="ex-hd">.*?<\/div>|<div class="ex-foot">.*?<\/div>/gs, '') : ''
    S.view = was
    S.sort = keepSort
    return `<h3>Folders</h3><div class="ex-places">${ps.map(p => `<button type="button" class="ex-place" data-ex="go:${esc(p.path)}">${svg(IC[p.id] || IC.folder)}<b>${esc(p.id)}</b><span>${p.count == null ? '' : `${p.count} item${p.count === 1 ? '' : 's'}`}</span></button>`).join('')}</div>`
      + `<h3>This computer</h3><div class="ex-places">${(drives || []).map(d => `<button type="button" class="ex-place" data-ex="go:${d.type === 'iCloud' ? 'iCloud' : esc(d.name)}">${svg(d.type === 'iCloud' ? IC.cloud : IC.drive)}<b>${esc(driveName(d))}</b>${d.size ? `<u><i style="width:${Math.round(100 * (1 - d.free / d.size))}%"></i></u><span>${size(d.free)} free of ${size(d.size)}</span>` : '<span></span>'}</button>`).join('')}</div>`
      + (recent ? `<h3>Recent</h3>${recent}` : places ? '' : '<div class="ex-none">Looking…</div>')
  }
  async function loadPlaces() { try { places = await filesApi('drives', 'places') } catch { places = { places: [], recent: [] } } if (env === 'drives') render() }
  async function loadKind(id) {
    loading = id
    found = null
    try { const r = id === 'recent' ? await filesApi('drives', 'places') : await filesApi('drives', 'kind', { q: id.slice(4) }); if (loading === id) found = r.entries || r.recent || [] } catch (e) { if (loading === id) found = [] }
    if (env === 'drives') render()
  }
  function render_(l) {
    if (!places) { places = { places: [], recent: [], wait: true }; loadPlaces() }
    if (fsPath.drives) virtual = ''
    else if (!virtual) virtual = 'home'
    let main
    if (virtual === 'home') main = homeHtml()
    else if (virtual) main = found ? listHtml(found, '', false) : '<div class="ex-none">Looking through your folders…</div>'
    else if (!l) main = '<div class="ex-none">Opening…</div>'
    else if (l.error) main = `<div class="notice err">${esc(l.error)}</div>`
    else main = listHtml(l.entries, l.path, true)
    const title = virtual === 'home' ? 'Home' : virtual === 'recent' ? 'Recent' : `All ${MEDIA.find(m => `all:${m[0]}` === virtual)?.[1].toLowerCase() || ''}`
    return `<div class="ex">${side()}<section>${bar(title)}${main}</section></div>`
  }
  document.addEventListener('click', e => {
    const v = e.target.closest?.('[data-exview]')
    if (v) { e.preventDefault(); e.stopPropagation(); return openView(v.dataset.exview) }
    const id = e.target.closest?.('.ex [data-ex]')?.dataset.ex
    if (!id) return
    e.preventDefault()
    e.stopPropagation()
    const [k, ...r] = id.split(':'), d = r.join(':')
    if (k === 'sort' || k === 'view' || k === 'kind') { S[k] = d; if (k !== 'kind') keep(); return render() }
    S.kind = 'all'
    if (k === 'go') { virtual = ''; return loadDir('drives', d) }
    virtual = id
    fsPath.drives = ''
    saveFs()
    if (k !== 'home') loadKind(id)
    else loadPlaces()
    render()
    scrollTo(0, 0)
  }, true)

  // A picture, video, song or PDF, here. Left and right go to the next one.
  let view = null
  function openView(p) {
    const l = shown.filter(e => !e.dir && (SHOWS.test(e.name) || PLAYS.test(e.name) || /\.pdf$/i.test(e.name))), i = l.findIndex(e => e.p === p), name = p.split('/').pop(), src = rawUrl('drives', p)
    if (!view) { view = Object.assign(document.createElement('div'), { id: 'exview' }); view.setAttribute('role', 'dialog'); document.body.append(view); view.addEventListener('click', e => { const g = e.target.closest('[data-g]')?.dataset.g; if (g === 'x' || e.target.tagName === 'MAIN') closeView(); else if (g) openView(g) }) }
    const next = (n, c, ic) => (l[n] ? `<button type="button" class="${c}" data-g="${esc(l[n].p)}" aria-label="${c === 'p' ? 'Previous' : 'Next'}">${svg(IC[ic])}</button>` : '')
    const body = SHOWS.test(name) ? `<img src="${src}" alt="">` : /\.pdf$/i.test(name) ? `<iframe src="${src}" title="${esc(name)}"></iframe>` : /\.(mp4|m4v|webm|mov)$/i.test(name) ? `<video src="${src}" controls autoplay></video>` : `<audio src="${src}" controls autoplay></audio>`
    view.innerHTML = `<header><b>${esc(name)}</b><button type="button" data-g="x" aria-label="Close">${svg(IC.x)}</button></header><main>${next(i - 1, 'p', 'left')}${body}${next(i + 1, 'n', 'right')}</main>`
    view._near = [l[i - 1]?.p, l[i + 1]?.p]
  }
  function closeView() { view?.remove(); view = null }
  addEventListener('keydown', e => {
    if (!view) return
    if (e.key === 'Escape') closeView()
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !view.querySelector('video, audio')) { const to = view._near[e.key === 'ArrowLeft' ? 0 : 1]; if (to) openView(to) }
    else return
    e.preventDefault()
    e.stopImmediatePropagation()
  }, true)
  window.HubFiles = { render: render_ }
})()
