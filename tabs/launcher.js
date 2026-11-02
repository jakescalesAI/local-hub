// The search bar: Ctrl+K on any hub page, window.LAUNCHER.open() for a button, and the same thing as
// its own small page at /launcher. Finds links, snippets, tabs, actions and files, and hands anything
// else to the chat. Ranked by what you use. Saved data and rules live in launcher.mjs; LAUNCHER.md
// documents the format. Nothing here needs the rest of the page, so the page runs fine without it.
;(() => {
  // A second copy would fight this one for every key, so loading the file again does nothing.
  if (window.LAUNCHER) return
  const STANDALONE = location.pathname === '/launcher'
  const PENDING = 'hub-launcher-pending'
  const PENDING_MS = 30_000
  const LIST_MAX = 50
  const FILES_MAX = 8
  const CONF = window.HUB_CONF || {}

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const svg = d => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
  const GLYPH = {
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    file: svg('<path d="M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/>'),
    snippet: svg('<path d="M5 7h14M5 12h14M5 17h9"/>'),
    tab: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>'),
    action: svg('<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>'),
    chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-5A8 8 0 1 1 21 12z"/>'),
    edit: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>'),
  }

  // How long Delete ignores clicks after it turns into the confirmation.
  const CONFIRM_PAUSE_MS = 400

  const S = {
    open: STANDALONE, view: 'list', q: '', sel: 0, rows: [],
    lib: { links: [], snippets: [], usage: {} }, loaded: false, loading: false, enterQueued: false, loadError: '', saving: false,
    files: [], filesFor: '', filesBusy: false,
    form: null, formError: '', confirmDelete: false, report: null, copyFallback: '',
  }
  let root, panel, input, list, foot, toastEl, lastFocus = null, filesTimer = 0, filesAbort = null, toastTimer = 0, itemsCache = null, confirmAt = 0

  /* ---------- talking to the hub ---------- */

  async function call(url, { method = 'GET', body, keepalive = false } = {}) {
    const res = await fetch(url, {
      method, keepalive,
      headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-hub': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(out.error || `The hub answered ${res.status}`)
    return out
  }

  async function refresh() {
    S.loading = true
    try {
      S.lib = await call('/api/launcher/library')
      itemsCache = null
      S.loaded = true
      S.loadError = ''
    } catch (e) {
      S.loadError = e.message
    }
    S.loading = false
    if (S.open && S.view === 'list') paintList()
    // Enter was pressed while the list was on its way. If it never came, the warning shows and nothing runs by itself.
    const queued = S.enterQueued
    S.enterQueued = false
    if (queued && S.loaded && S.open && S.view === 'list') S.rows[S.sel]?.run()
  }

  function countUse(key) {
    const u = S.lib.usage[key] || { n: 0, at: 0 }
    S.lib.usage[key] = { n: u.n + 1, at: Date.now() }
    call('/api/launcher/use', { method: 'POST', body: { key }, keepalive: true }).catch(() => {})
  }

  /* ---------- what can be found ---------- */

  const tabLabel = id => {
    if (window.HUB?.appMeta) return window.HUB.appMeta(id).label
    if (id === 'chat') return 'Chat'
    if (id === 'home') return 'Home'
    if (id === 'drives') return CONF.addons?.drives?.on ? 'Drives' : 'Files'
    return CONF.addons?.[id]?.label || id[0].toUpperCase() + id.slice(1)
  }
  const tabIds = () => {
    if (window.HUB?.allApps) return [...new Set(['home', ...window.HUB.allApps()])]
    return [...new Set([...(CONF.tabs || ['home', 'drives']), 'chat'])]
  }

  function actions() {
    const onPage = !STANDALONE
    const list = [
      { key: 'add-link', title: 'Add a link', run: () => openForm('link') },
      { key: 'add-snippet', title: 'Add a snippet', run: () => openForm('snippet') },
      // A file picker or a download would take focus from the small window, and that closes it.
      { key: 'import', title: 'Import links and snippets', run: () => onPage ? openImport() : handOff({ do: 'import' }) },
      { key: 'export', title: 'Export links and snippets', run: () => onPage ? exportAll() : handOff({ do: 'export' }) },
    ]
    if (onPage && typeof window.load === 'function') list.push({ key: 'refresh', title: 'Refresh this page’s numbers', run: () => { window.load(true); finish('Refreshing') } })
    if (window.HUB?.openStyle) list.push({ key: 'style', title: 'Edit Style', run: () => { close(); window.HUB.openStyle() } })
    if (window.HUB?.openTabs) list.push({ key: 'tabs', title: 'Edit Tabs', run: () => { close(); window.HUB.openTabs() } })
    return list
  }

  const linkDetail = l => {
    if (l.kind === 'folder') return l.path
    if (l.kind === 'obsidian') return l.url
    try { const u = new URL(l.url); return u.host + (u.pathname === '/' ? '' : u.pathname) } catch { return l.url }
  }
  const previewOf = text => String(text).slice(0, 400).replace(/\s+/g, ' ').trim().slice(0, 90)

  // Rebuilt only when the saved list arrives, so typing stays quick with a big library.
  function allItems() {
    if (itemsCache) return itemsCache
    const out = []
    for (const l of S.lib.links || []) out.push({ id: `link:${l.id}`, type: 'link', word: 'Link', title: l.name, sub: linkDetail(l), hay: [l.url, l.path].filter(Boolean).join(' '), link: l, edit: () => openForm('link', l), run: () => openLink(l) })
    for (const s of S.lib.snippets || []) out.push({ id: `snippet:${s.id}`, type: 'snippet', word: 'Snippet', title: s.name, sub: previewOf(s.text), keyword: s.keyword, hay: String(s.text).slice(0, 2000), edit: () => openForm('snippet', s), run: () => copySnippet(s) })
    for (const t of tabIds()) out.push({ id: `tab:${t.replace(/[^\w-]/g, '-').slice(0, 64)}`, type: 'tab', word: 'Tab', title: tabLabel(t), sub: '', hay: t, run: () => openTab(t) })
    for (const a of actions()) out.push({ id: `action:${a.key}`, type: 'action', word: 'Action', title: a.title, sub: '', hay: '', run: a.run })
    for (const item of out) {
      item.titleL = String(item.title).toLowerCase()
      item.keywordL = String(item.keyword || '').toLowerCase()
      item.subL = String(item.sub || '').toLowerCase()
      item.hayL = String(item.hay || '').toLowerCase()
    }
    itemsCache = out
    return out
  }

  // Rising with use, fading over a couple of weeks.
  function used(id) {
    const u = S.lib.usage?.[id]
    if (!u) return 0
    return Math.log2(1 + u.n) * 2 ** (-(Date.now() - u.at) / (14 * 86400_000)) * 10
  }

  function inOrder(needle, hay) {
    let i = 0
    for (const c of hay) if (c === needle[i] && ++i === needle.length) return true
    return false
  }

  function matchOne(t, item) {
    const name = item.titleL
    if (item.keywordL && item.keywordL === t) return 120
    if (name === t) return 100
    if (name.startsWith(t)) return 80
    if (name.split(/[\s/._-]+/).some(w => w.startsWith(t))) return 60
    if (item.keywordL?.startsWith(t)) return 55
    if (name.includes(t)) return 45
    if (item.subL.includes(t)) return 25
    if (t.length >= 2 && inOrder(t, name)) return 15
    if (item.hayL.includes(t)) return 12
    return 0
  }

  function ranked(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const items = allItems()
    // With nothing typed, what you use comes first, then your own things, then the hub's.
    const base = { link: 3, snippet: 2, tab: 1, action: 0 }
    if (!words.length) return items.map(i => ({ i, s: used(i.id) + base[i.type] })).sort((a, b) => b.s - a.s || a.i.title.localeCompare(b.i.title)).slice(0, LIST_MAX).map(x => x.i)
    const hits = []
    for (const item of items) {
      let total = 0
      for (const w of words) {
        const m = matchOne(w, item)
        if (!m) { total = 0; break }
        total += m
      }
      if (total) hits.push({ i: item, s: total / words.length + used(item.id) })
    }
    return hits.sort((a, b) => b.s - a.s || a.i.title.localeCompare(b.i.title)).slice(0, LIST_MAX).map(x => x.i)
  }

  const canAsk = () => STANDALONE || !!window.HubChat

  function computeRows() {
    const q = S.q.trim()
    const rows = ranked(q)
    if (q && canAsk()) rows.push({ id: 'ask', type: 'chat', word: 'Chat', title: `Ask chat: ${q}`, sub: '', run: () => askChat(q) })
    if (q && S.filesFor === q) {
      for (const f of S.files.slice(0, FILES_MAX)) {
        rows.push({ id: `file:${f.path}`, type: f.dir ? 'folder' : 'file', word: f.dir ? 'Folder' : 'File', title: f.name, sub: f.path, run: () => openFile(f) })
      }
    }
    return rows
  }

  /* ---------- doing things ---------- */

  function toast(msg) {
    if (!toastEl) return
    toastEl.textContent = msg
    toastEl.classList.add('on')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 1800)
  }

  // Done with the bar. The desktop app turns window.close() into hiding the small window; in a
  // plain browser tab nothing closes, so the box clears and the message stays readable.
  function finish(message) {
    if (message) toast(message)
    if (STANDALONE) {
      S.q = ''
      if (input) input.value = ''
      S.files = []
      S.filesFor = ''
      S.sel = 0
      paintList()
      input?.focus()
      window.close()
      return
    }
    close()
  }

  // The small page can't drive the main page directly. It leaves a note only this origin can write
  // and opens the main page, which acts on it. The address itself carries nothing, so a link from
  // somewhere else can't start a chat or open anything.
  function handOff(request) {
    try {
      localStorage.setItem(PENDING, JSON.stringify({ ...request, at: Date.now() }))
    } catch {
      return showError('This browser won’t let the search bar reach the hub page')
    }
    window.open('/#launcher-run', '_blank', 'noopener')
    finish()
  }

  function runPending() {
    if (STANDALONE || location.hash !== '#launcher-run') return
    history.replaceState(null, '', location.pathname + location.search)
    let note = null
    try {
      note = JSON.parse(localStorage.getItem(PENDING))
      localStorage.removeItem(PENDING)
    } catch {}
    if (!note || !(Date.now() - note.at < PENDING_MS)) return
    if (note.do === 'ask' && typeof note.text === 'string') askChat(note.text)
    else if (note.do === 'tab' && typeof note.id === 'string') openTab(note.id)
    else if (note.do === 'file' && typeof note.path === 'string') openFile({ path: note.path, name: note.name || '', dir: !!note.dir })
    else if (note.do === 'import') { openPanel(); openImport() }
    else if (note.do === 'export') exportAll()
  }

  function openLink(l) {
    countUse(`link:${l.id}`)
    if (l.kind === 'web') {
      // The hub only saves http and https; this holds even if a saved file was changed by hand.
      if (!/^https?:\/\//i.test(l.url)) return showError('That link isn’t a web address')
      window.open(l.url, '_blank', 'noopener,noreferrer')
      return finish()
    }
    call('/api/launcher/open', { method: 'POST', body: { id: l.id } }).then(out => {
      if (out.open && /^obsidian:\/\//i.test(out.open)) location.assign(out.open)
      finish(l.kind === 'folder' ? 'Opened on this computer' : 'Opening Obsidian')
    }, e => showError(e.message))
  }

  function fallbackCopy(text) {
    const x = document.createElement('textarea')
    x.value = text
    x.setAttribute('readonly', '')
    x.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0'
    root.append(x)
    x.select()
    x.setSelectionRange(0, text.length)
    let ok = false
    try { ok = document.execCommand('copy') } catch {}
    x.remove()
    return ok
  }

  // The clipboard API exists only on a secure origin, so a hub reached over plain http on another
  // device takes the older route. If that fails too, the text is shown ready to select.
  async function copyText(text) {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); return true } catch {}
    }
    return fallbackCopy(text)
  }

  async function copySnippet(s) {
    countUse(`snippet:${s.id}`)
    if (await copyText(s.text)) return finish(`Copied ${s.name}`)
    S.copyFallback = s.text
    S.view = 'copy'
    paint()
  }

  function askChat(text) {
    if (STANDALONE) return handOff({ do: 'ask', text })
    if (!window.HubChat) return showError('Chat isn’t available yet')
    close()
    window.HubChat.open()
    window.HubChat.ask(text)
  }

  function openTab(id) {
    countUse(`tab:${id.replace(/[^\w-]/g, '-').slice(0, 64)}`)
    if (STANDALONE) return handOff({ do: 'tab', id })
    close()
    if (window.HUB?.openApp) window.HUB.openApp(id)
    else if (id === 'chat') window.HubChat?.open()
    else if (typeof window.setEnv === 'function') window.setEnv(id)
  }

  const rawUrl = p => `/files/laptop/raw?path=${encodeURIComponent(p)}`

  // isText is a const on the main page, so it's in scope here but isn't a property of window.
  function openFile(f) {
    if (STANDALONE) return handOff({ do: 'file', path: f.path, name: f.name, dir: !!f.dir })
    close()
    const home = S.lib.filesHome
    if (f.dir && home && typeof window.setEnv === 'function' && typeof window.loadDir === 'function') {
      window.setEnv('drives')
      window.loadDir('drives', `${home}/${f.path}`)
    } else if (!f.dir && typeof isText === 'function' && typeof window.editFile === 'function' && isText(f.name)) {
      window.editFile('laptop', f.path)
    } else {
      window.open(rawUrl(f.path), '_blank', 'noopener')
    }
  }

  function exportAll() {
    const a = document.createElement('a')
    a.href = '/api/launcher/export'
    a.download = 'local-hub-links-and-snippets.json'
    document.body.append(a)
    a.click()
    a.remove()
    if (S.open) finish('Exported')
  }

  function showError(message) {
    toast(message)
  }

  /* ---------- file search, through the hub's own search and its key-file blocks ---------- */

  function searchFiles() {
    clearTimeout(filesTimer)
    filesAbort?.abort()
    const q = S.q.trim()
    if (q.length < 2) {
      S.files = []
      S.filesFor = ''
      S.filesBusy = false
      return
    }
    S.filesBusy = true
    filesTimer = setTimeout(async () => {
      const ctl = new AbortController()
      filesAbort = ctl
      try {
        const res = await fetch(`/api/files/laptop/search?${new URLSearchParams({ path: '', q })}`, { signal: ctl.signal })
        const out = await res.json()
        if (ctl.signal.aborted || S.q.trim() !== q) return
        S.files = res.ok && Array.isArray(out.results) ? out.results : []
        S.filesFor = q
      } catch {
        if (ctl.signal.aborted) return
        S.files = []
        S.filesFor = q
      }
      S.filesBusy = false
      if (S.open && S.view === 'list') paintList(true)
    }, 300)
  }

  /* ---------- drawing ---------- */

  const CSS = `
  .lch-root { position: fixed; inset: 0; z-index: 8500; display: none; justify-content: center; align-items: flex-start; --lch-top: max(calc(env(safe-area-inset-top, 0px) + 12px), calc(var(--lch-vh, 100vh) * .12)); padding: calc(var(--lch-vt, 0px) + var(--lch-top)) 16px 0; box-sizing: border-box;
    background: rgba(8, 10, 16, .38); font: 15px/1.35 var(--font, system-ui, sans-serif); color: var(--label, #111); }
  .lch-root.on { display: flex; }
  .lch-root *, .lch-root *::before { box-sizing: border-box; }
  .lch-panel { display: flex; flex-direction: column; width: min(640px, 100%); max-height: min(560px, calc(var(--lch-vh, 100vh) - var(--lch-top) - var(--lch-bot, calc(env(safe-area-inset-bottom, 0px) + 16px)))); overflow: hidden; border-radius: 16px;
    background: var(--surface, #fff); border: 1px solid var(--sep, rgba(0,0,0,.15)); box-shadow: 0 24px 70px rgba(0,0,0,.35); }
  .lch-root.alone { padding: 0; background: none; }
  .lch-root.alone .lch-panel { width: 100%; height: 100%; max-height: none; border: 0; border-radius: 0; box-shadow: none; }
  .lch-top { flex: none; display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 16px; border-bottom: 1px solid var(--sep, rgba(0,0,0,.15)); }
  .lch-input { flex: 1; min-width: 0; height: 44px; padding: 0; border: 0; outline: 0; background: none; color: inherit; font: 18px var(--font, system-ui, sans-serif); }
  .lch-input::placeholder { color: var(--label-2, #777); }
  .lch-x { flex: none; width: 44px; height: 44px; border: 0; border-radius: 10px; background: none; color: var(--label-2, #777); font-size: 20px; line-height: 1; cursor: pointer; display: none; }
  .lch-list { flex: 1 1 auto; min-height: 0; margin: 0; padding: 6px; list-style: none; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
  .lch-row { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 6px 6px 6px 10px; border-radius: 10px; cursor: pointer; }
  .lch-row.sel { background: var(--fill, rgba(120,120,128,.14)); }
  .lch-ic { flex: none; width: 28px; height: 28px; border-radius: 7px; display: grid; place-items: center; overflow: hidden; color: var(--label-2, #777); background: var(--fill, rgba(120,120,128,.14)); font-weight: 600; font-size: 14px; }
  .lch-ic img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .lch-txt { flex: 1; min-width: 0; }
  .lch-title, .lch-sub { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .lch-title { font-weight: 500; }
  .lch-sub { font-size: 13px; color: var(--label-2, #777); }
  .lch-kw { flex: none; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 6px; border-radius: 6px; font: 12px var(--mono, monospace); color: var(--label-2, #777); background: var(--fill, rgba(120,120,128,.14)); }
  .lch-word { flex: none; font-size: 12px; color: var(--label-2, #777); }
  .lch-edit { flex: none; width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: 8px; background: none; color: var(--label-2, #777); cursor: pointer; visibility: hidden; }
  .lch-row.sel .lch-edit, .lch-row:hover .lch-edit { visibility: visible; }
  .lch-edit:hover { background: var(--fill-2, rgba(120,120,128,.24)); color: var(--label, #111); }
  .lch-empty { padding: 28px 16px; text-align: center; color: var(--label-2, #777); }
  .lch-foot { flex: none; display: flex; gap: 14px; flex-wrap: wrap; padding: 8px 16px; border-top: 1px solid var(--sep, rgba(0,0,0,.15)); font-size: 12px; color: var(--label-2, #777); }
  .lch-foot:empty { display: none; }
  .lch-foot kbd { font: 11px var(--mono, monospace); padding: 0 4px; border-radius: 4px; background: var(--fill, rgba(120,120,128,.14)); }
  .lch-warn { flex: none; padding: 8px 16px; font-size: 13px; color: var(--red, #c00); border-bottom: 1px solid var(--sep, rgba(0,0,0,.15)); }
  .lch-form { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .lch-form h2 { margin: 0; font-size: 17px; font-weight: 600; }
  .lch-form label { display: block; font-size: 13px; font-weight: 500; }
  .lch-field { display: block; width: 100%; margin-top: 4px; padding: 10px 12px; border: 1px solid transparent; border-radius: 10px; outline: 0; color: inherit; background: var(--surface-2, #f2f2f7); font: 16px var(--font, system-ui, sans-serif); }
  .lch-field:focus { border-color: var(--blue, #0a84ff); }
  textarea.lch-field { min-height: 120px; resize: vertical; font: 14px/1.4 var(--mono, monospace); }
  .lch-check { display: flex !important; gap: 8px; align-items: flex-start; font-weight: 400 !important; }
  .lch-err { min-height: 1em; font-size: 13px; color: var(--red, #c00); }
  .lch-btns { display: flex; gap: 8px; flex-wrap: wrap; }
  .lch-btns .lch-grow { flex: 1; }
  .lch-btn { min-height: 40px; padding: 8px 14px; border: 0; border-radius: 10px; cursor: pointer; font: 500 14px var(--font, system-ui, sans-serif); color: inherit; background: var(--fill, rgba(120,120,128,.14)); }
  .lch-btn.go { color: #fff; background: var(--blue, #0a84ff); }
  .lch-btn.bad { color: var(--red, #c00); }
  .lch-btn:disabled { opacity: .5; cursor: default; }
  .lch-report { margin: 0; padding: 0; list-style: none; font-size: 13px; }
  .lch-report li { padding: 4px 0; border-top: 1px solid var(--sep, rgba(0,0,0,.15)); overflow-wrap: anywhere; }
  .lch-toast { position: fixed; z-index: 8600; left: 50%; bottom: 24px; max-width: calc(100vw - 32px); transform: translate(-50%, 8px); padding: 8px 14px; border-radius: 10px; opacity: 0; pointer-events: none; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    background: var(--label, #111); color: var(--surface, #fff); font: 500 14px var(--font, system-ui, sans-serif); transition: opacity .15s, transform .15s; }
  .lch-toast.on { opacity: 1; transform: translate(-50%, 0); }
  @media (max-width: 600px) {
    .lch-root { --lch-top: calc(env(safe-area-inset-top, 0px) + 12px); padding-left: 8px; padding-right: 8px; }
    .lch-panel { max-height: calc(var(--lch-vh, 100vh) - var(--lch-top) - var(--lch-bot, calc(env(safe-area-inset-bottom, 0px) + 16px))); }
  }
  @media (max-width: 600px), (hover: none) {
    .lch-x { display: block; }
    .lch-row { min-height: 52px; }
    .lch-edit { width: 44px; height: 44px; visibility: visible; }
    .lch-word { display: none; }
    .lch-foot { display: none; }
    .lch-btn { min-height: 44px; }
  }`

  function paint() {
    if (!panel) return
    if (S.view === 'list') return paintFrame()
    if (S.view === 'copy') return paintCopy()
    if (S.view === 'import') return paintImport()
    paintForm()
  }

  // The search box stays in place while the list changes, so typing never loses focus.
  function paintFrame() {
    if (panel.dataset.view !== 'list') {
      panel.dataset.view = 'list'
      panel.innerHTML = `<div class="lch-top"><input class="lch-input" type="text" role="combobox" aria-expanded="true" aria-controls="lch-list" aria-autocomplete="list" aria-label="Search" placeholder="Search links, snippets, tabs and files" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"><button type="button" class="lch-x" data-close aria-label="Close">&times;</button></div>
        <div class="lch-warn" hidden role="alert"></div><ul class="lch-list" id="lch-list" role="listbox" aria-label="Results"></ul><div class="lch-foot"></div>`
      input = panel.querySelector('.lch-input')
      list = panel.querySelector('.lch-list')
      foot = panel.querySelector('.lch-foot')
      input.value = S.q
    }
    paintList()
  }

  const iconOf = r => {
    if (r.link?.kind === 'web') return `<span class="lch-ic" data-letter="${esc(String(r.title).slice(0, 1).toUpperCase())}"><img src="/api/launcher/icon?id=${encodeURIComponent(r.link.id)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`
    if (r.link?.kind === 'folder') return `<span class="lch-ic">${GLYPH.folder}</span>`
    return `<span class="lch-ic">${GLYPH[r.type] || GLYPH.action}</span>`
  }

  function paintList(keepSelection) {
    if (!list) return paintFrame()
    const before = keepSelection ? S.rows[S.sel]?.id : null
    S.rows = computeRows()
    if (before) {
      const at = S.rows.findIndex(r => r.id === before)
      S.sel = at >= 0 ? at : 0
    }
    if (S.sel >= S.rows.length) S.sel = Math.max(0, S.rows.length - 1)
    list.innerHTML = S.rows.length ? S.rows.map((r, i) => `<li class="lch-row${i === S.sel ? ' sel' : ''}" id="lch-opt-${i}" role="option" aria-selected="${i === S.sel}" data-i="${i}">
        ${iconOf(r)}<span class="lch-txt"><span class="lch-title">${esc(r.title)}</span>${r.sub ? `<span class="lch-sub">${esc(r.sub)}</span>` : ''}</span>
        ${r.keyword ? `<span class="lch-kw">${esc(r.keyword)}</span>` : ''}<span class="lch-word">${esc(r.word)}</span>
        ${r.edit ? `<button type="button" class="lch-edit" data-edit="${i}" aria-label="Edit ${esc(r.title)}" title="Edit">${GLYPH.edit}</button>` : ''}</li>`).join('')
      : `<li class="lch-empty">${S.q.trim() ? 'Nothing found' : 'Nothing saved yet'}</li>`
    input.setAttribute('aria-activedescendant', S.rows.length ? `lch-opt-${S.sel}` : '')
    const warn = panel.querySelector('.lch-warn')
    const message = S.loadError ? `The saved list couldn’t load: ${S.loadError}` : S.lib.warning || ''
    warn.textContent = message
    warn.hidden = !message
    const sel = S.rows[S.sel]
    foot.innerHTML = `<span><kbd>↑↓</kbd> move</span><span><kbd>Enter</kbd> ${sel?.type === 'snippet' ? 'copy' : 'open'}</span>${sel?.edit ? '<span><kbd>Ctrl+E</kbd> edit</span>' : ''}<span><kbd>Esc</kbd> ${STANDALONE && !S.q ? 'close' : S.q ? 'clear' : 'close'}</span>`
  }

  function select(i) {
    if (!S.rows.length) return
    S.sel = (i + S.rows.length) % S.rows.length
    for (const el of list.querySelectorAll('.lch-row.sel')) { el.classList.remove('sel'); el.setAttribute('aria-selected', 'false') }
    const el = list.querySelector(`[data-i="${S.sel}"]`)
    el?.classList.add('sel')
    el?.setAttribute('aria-selected', 'true')
    el?.scrollIntoView({ block: 'nearest' })
    input.setAttribute('aria-activedescendant', `lch-opt-${S.sel}`)
    const sel = S.rows[S.sel]
    foot.innerHTML = `<span><kbd>↑↓</kbd> move</span><span><kbd>Enter</kbd> ${sel?.type === 'snippet' ? 'copy' : 'open'}</span>${sel?.edit ? '<span><kbd>Ctrl+E</kbd> edit</span>' : ''}<span><kbd>Esc</kbd> ${S.q ? 'clear' : 'close'}</span>`
  }

  function fieldsHtml() {
    const f = S.form
    if (f.type === 'snippet') {
      return `<label>Name<input class="lch-field" data-f="name" value="${esc(f.name)}" autocomplete="off"></label>
        <label>Keyword (optional)<input class="lch-field" data-f="keyword" value="${esc(f.keyword)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
        <label>Text<textarea class="lch-field" data-f="text" spellcheck="false">${esc(f.text)}</textarea></label>`
    }
    const local = f.kind === 'folder'
    return `<label>Type<select class="lch-field" data-f="kind">
        <option value="web"${f.kind === 'web' ? ' selected' : ''}>Web link</option>
        <option value="folder"${local ? ' selected' : ''}>Folder on this computer</option>
        <option value="obsidian"${f.kind === 'obsidian' ? ' selected' : ''}>Obsidian link</option></select></label>
      <label>Name<input class="lch-field" data-f="name" value="${esc(f.name)}" autocomplete="off"></label>
      <label>${local ? 'Folder path' : 'Address'}<input class="lch-field" data-f="target" value="${esc(f.target)}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${local ? 'Full path of the folder' : f.kind === 'obsidian' ? 'obsidian://open?vault=…' : 'https://…'}"></label>`
  }

  function paintForm() {
    const f = S.form
    panel.dataset.view = 'form'
    input = list = foot = null
    const noun = f.type === 'snippet' ? 'snippet' : 'link'
    panel.innerHTML = `<form class="lch-form" novalidate><h2>${f.id ? 'Edit' : 'Add'} ${noun}</h2>${fieldsHtml()}
      <div class="lch-err" role="alert">${esc(S.formError)}</div>
      <div class="lch-btns"><button type="submit" class="lch-btn go">Save</button><button type="button" class="lch-btn" data-back>Cancel</button><span class="lch-grow"></span>
      ${f.id ? `<button type="button" class="lch-btn bad" data-delete>${S.confirmDelete ? 'Confirm delete' : 'Delete'}</button>` : ''}</div></form>`
    panel.querySelector('[data-f]:not(select)')?.focus()
  }

  function readForm() {
    for (const el of panel.querySelectorAll('[data-f]')) S.form[el.dataset.f] = el.value
  }

  function paintImport() {
    panel.dataset.view = 'import'
    input = list = foot = null
    const r = S.report
    const summary = r ? `<ul class="lch-report" aria-live="polite"><li>Added ${r.added.links} link${r.added.links === 1 ? '' : 's'} and ${r.added.snippets} snippet${r.added.snippets === 1 ? '' : 's'}. ${r.unchanged} already here. ${r.skippedCount} skipped.</li>${r.skipped.map(x => `<li>${esc(x.name || x.kind)}: ${esc(x.reason)}</li>`).join('')}</ul>` : ''
    panel.innerHTML = `<form class="lch-form" novalidate><h2>Import links and snippets</h2>
      <label>JSON file<input class="lch-field" data-file type="file" accept=".json,application/json" multiple></label>
      <label>Or paste JSON<textarea class="lch-field" data-paste spellcheck="false"></textarea></label>
      <label class="lch-check"><input type="checkbox" data-local><span>Also bring in folder and Obsidian links from this file</span></label>
      <div class="lch-err" role="alert">${esc(S.formError)}</div>${summary}
      <div class="lch-btns"><button type="submit" class="lch-btn go">Import</button><button type="button" class="lch-btn" data-back>${r ? 'Done' : 'Cancel'}</button></div></form>`
    panel.querySelector('[data-file]').focus()
  }

  function paintCopy() {
    panel.dataset.view = 'copy'
    input = list = foot = null
    panel.innerHTML = `<form class="lch-form" novalidate><h2>Copy this</h2><p style="margin:0">This browser wouldn’t copy it. Select the text and copy it yourself.</p>
      <textarea class="lch-field" data-copy readonly>${esc(S.copyFallback)}</textarea>
      <div class="lch-btns"><button type="button" class="lch-btn" data-back>Done</button></div></form>`
    const t = panel.querySelector('[data-copy]')
    t.focus()
    t.select()
  }

  function backToList() {
    S.view = 'list'
    S.form = null
    S.formError = ''
    S.confirmDelete = false
    S.report = null
    S.copyFallback = ''
    delete panel.dataset.view
    input = list = foot = null
    paintFrame()
    input.focus()
    input.select()
  }

  function openForm(type, item) {
    S.view = 'form'
    S.formError = ''
    S.confirmDelete = false
    if (type === 'snippet') S.form = { type, id: item?.id || '', name: item?.name || '', keyword: item?.keyword || '', text: item?.text || '' }
    else S.form = { type, id: item?.id || '', name: item?.name || '', kind: item?.kind || 'web', target: item?.path || item?.url || '' }
    paint()
  }

  function openImport() {
    S.view = 'import'
    S.formError = ''
    S.report = null
    paint()
  }

  // One at a time, so a double click or a repeated key can't do it twice.
  async function once(task) {
    if (S.saving) return
    S.saving = true
    const submit = panel.querySelector('[type=submit]')
    if (submit) submit.disabled = true
    try { await task() } finally {
      S.saving = false
      if (submit) submit.disabled = false
    }
  }

  async function saveForm() {
    readForm()
    const f = S.form
    const body = f.type === 'snippet'
      ? { name: f.name, keyword: f.keyword, text: f.text }
      : { name: f.name, kind: f.kind, ...(f.kind === 'folder' ? { path: f.target } : { url: f.target }) }
    const base = `/api/launcher/${f.type === 'snippet' ? 'snippets' : 'links'}`
    try {
      await call(f.id ? `${base}/${encodeURIComponent(f.id)}` : base, { method: f.id ? 'PUT' : 'POST', body })
    } catch (e) {
      if (S.form !== f) return toast(e.message)
      S.formError = e.message
      return paint()
    }
    await refresh()
    if (S.form === f) backToList()
    toast('Saved')
  }

  async function deleteItem() {
    readForm()
    if (!S.confirmDelete) { S.confirmDelete = true; confirmAt = Date.now(); return paint() }
    // The button turns into the confirmation under the pointer, so the second click of a double click isn't a yes.
    if (Date.now() - confirmAt < CONFIRM_PAUSE_MS) return
    const f = S.form
    try {
      await call(`/api/launcher/${f.type === 'snippet' ? 'snippets' : 'links'}/${encodeURIComponent(f.id)}`, { method: 'DELETE' })
    } catch (e) {
      if (S.form !== f) return toast(e.message)
      S.formError = e.message
      S.confirmDelete = false
      return paint()
    }
    await refresh()
    if (S.form === f) backToList()
    toast('Deleted')
  }

  async function runImport() {
    const files = [...(panel.querySelector('[data-file]').files || [])]
    const pasted = panel.querySelector('[data-paste]').value.trim()
    const allowLocal = panel.querySelector('[data-local]').checked
    // Shown in place, so the file and the pasted text are still there to fix.
    const problem = message => { panel.querySelector('.lch-err').textContent = message }
    if (!files.length && !pasted) return problem('Choose a file or paste some JSON')
    const total = { added: { links: 0, snippets: 0 }, unchanged: 0, skipped: [], skippedCount: 0 }
    try {
      const texts = [...await Promise.all(files.map(f => f.text())), ...(pasted ? [pasted] : [])]
      for (const text of texts) {
        let data
        try { data = JSON.parse(text.replace(/^﻿/, '')) } catch { throw new Error('That isn’t valid JSON') }
        const out = await call('/api/launcher/import', { method: 'POST', body: { data, allowLocal } })
        total.added.links += out.added.links
        total.added.snippets += out.added.snippets
        total.unchanged += out.unchanged
        total.skipped.push(...out.skipped)
        total.skippedCount += out.skippedCount
      }
    } catch (e) {
      return problem(e.message)
    }
    S.report = total
    await refresh()
    paint()
  }

  /* ---------- events ---------- */

  function onKeydown(e) {
    // Nothing typed in here may reach the page's own shortcuts.
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      S.enterQueued = false
      if (S.view !== 'list') return backToList()
      if (S.q) {
        S.q = ''
        input.value = ''
        searchFiles()
        S.sel = 0
        return paintList()
      }
      return STANDALONE ? window.close() : close()
    }
    if (e.key === 'Tab') return trapTab(e)
    if (S.view === 'form' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); return void once(saveForm) }
    if (S.view !== 'list' || (e.key === 'Enter' && e.target !== input)) return
    if (e.key === 'ArrowDown') { e.preventDefault(); S.enterQueued = false; select(S.sel + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); S.enterQueued = false; select(S.sel - 1) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.isComposing) return
      // Until the saved list arrives the top row could be Ask chat, and that would message the agent. So Enter waits for it.
      if (!S.loaded && S.loading) S.enterQueued = true
      else S.rows[S.sel]?.run()
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
      e.preventDefault()
      S.rows[S.sel]?.edit?.()
    }
  }

  function trapTab(e) {
    const stops = [...panel.querySelectorAll('input, select, textarea, button, a[href]')].filter(el => !el.disabled && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden')
    if (!stops.length) return
    const first = stops[0], last = stops.at(-1)
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  function onClick(e) {
    if (!STANDALONE && e.target === root) return close()
    if (e.target.closest('[data-close]')) return STANDALONE ? window.close() : close()
    if (e.target.closest('[data-back]')) return backToList()
    if (e.target.closest('[data-delete]')) return void once(deleteItem)
    const edit = e.target.closest('[data-edit]')
    if (edit) { e.stopPropagation(); return S.rows[Number(edit.dataset.edit)]?.edit?.() }
    const row = e.target.closest('.lch-row')
    // The second click of a double click on Save or Cancel lands on whichever row has just appeared there.
    if (row && e.detail < 2) S.rows[Number(row.dataset.i)]?.run()
  }

  function onSubmit(e) {
    e.preventDefault()
    if (S.view === 'form') once(saveForm)
    else if (S.view === 'import') once(runImport)
  }

  function onChange(e) {
    // Changing a link's type redraws the address field for that type, keeping what was typed.
    if (S.view === 'form' && e.target.dataset?.f === 'kind') { readForm(); paint() }
  }

  function fitViewport() {
    const vv = window.visualViewport
    const h = vv?.height || window.innerHeight
    if (!root) return
    root.style.setProperty('--lch-vh', `${h}px`)
    // Follows the visible screen, which the on-screen keyboard shrinks and can scroll.
    root.style.setProperty('--lch-vt', `${vv?.offsetTop || 0}px`)
    if (window.innerHeight - h > 60) root.style.setProperty('--lch-bot', '8px')
    else root.style.removeProperty('--lch-bot')
  }

  function build() {
    if (root) return
    const style = document.createElement('style')
    style.id = 'hub-launcher-style'
    style.textContent = CSS
    document.head.append(style)
    root = document.createElement('div')
    root.id = 'hub-launcher'
    root.className = `lch-root${STANDALONE ? ' alone' : ''}`
    root.innerHTML = '<div class="lch-panel" role="dialog" aria-modal="true" aria-label="Search"></div>'
    panel = root.querySelector('.lch-panel')
    // Outside the bar, so a message stays readable after the bar closes.
    toastEl = document.createElement('div')
    toastEl.className = 'lch-toast'
    toastEl.setAttribute('role', 'status')
    document.body.append(root, toastEl)
    for (const t of ['keyup', 'keypress']) root.addEventListener(t, e => e.stopPropagation())
    root.addEventListener('keydown', onKeydown)
    root.addEventListener('click', onClick)
    root.addEventListener('submit', onSubmit)
    root.addEventListener('change', onChange)
    root.addEventListener('input', e => {
      if (e.target !== input) return
      S.enterQueued = false
      S.q = input.value
      S.sel = 0
      searchFiles()
      paintList()
    })
    root.addEventListener('pointermove', e => {
      const row = e.target.closest?.('.lch-row')
      if (row && e.pointerType === 'mouse' && Number(row.dataset.i) !== S.sel) select(Number(row.dataset.i))
    })
    // A site with no icon shows its first letter. Load errors don't bubble, so this listens on the way down.
    root.addEventListener('error', e => {
      if (e.target.tagName !== 'IMG') return
      const box = e.target.parentElement
      box.textContent = box.dataset.letter || ''
    }, true)
    window.visualViewport?.addEventListener('resize', fitViewport)
    window.visualViewport?.addEventListener('scroll', fitViewport)
    window.addEventListener('resize', fitViewport)
    fitViewport()
  }

  function openPanel() {
    build()
    if (!S.open) lastFocus = document.activeElement
    S.open = true
    root.classList.add('on')
    if (S.view === 'list') {
      paint()
      input.focus()
    }
    refresh()
  }

  function close() {
    if (!root || STANDALONE) return
    S.open = false
    root.classList.remove('on')
    S.view = 'list'
    S.form = null
    S.report = null
    S.formError = ''
    S.confirmDelete = false
    S.enterQueued = false
    S.q = ''
    S.files = []
    S.filesFor = ''
    S.sel = 0
    clearTimeout(filesTimer)
    filesAbort?.abort()
    delete panel.dataset.view
    panel.innerHTML = ''
    input = list = foot = null
    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true })
    lastFocus = null
  }

  /* ---------- starting up ---------- */

  async function startAlone() {
    build()
    root.classList.add('on')
    paint()
    input.focus()
    // Match the hub's chosen light or dark and accent colour. The default look is fine if this fails.
    call('/api/hub/settings').then(s => {
      const r = document.documentElement
      if (s.style?.theme === 'light' || s.style?.theme === 'dark') { r.setAttribute('data-theme', s.style.theme); r.style.colorScheme = s.style.theme }
      if (/^#[0-9a-f]{3,8}$/i.test(s.style?.accent || '')) r.style.setProperty('--blue', s.style.accent)
    }).catch(() => {})
    await refresh()
    window.addEventListener('focus', () => { if (S.view === 'list') { input?.focus(); input?.select() } refresh() })
  }

  if (STANDALONE) {
    if (document.body) startAlone()
    else document.addEventListener('DOMContentLoaded', startAlone)
    return
  }

  window.addEventListener('keydown', e => {
    // While the bar is open it keeps the keyboard, even after a click left focus on the page.
    if (S.open && !root.contains(e.target)) {
      e.stopPropagation()
      if (e.key === 'Escape') { e.preventDefault(); return close() }
      if (!(e.ctrlKey || e.metaKey)) panel.querySelector('input, textarea, select, button')?.focus()
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return
    if (document.getElementById('hub-setup')) return
    e.preventDefault()
    e.stopPropagation()
    if (e.repeat) return
    if (!S.open) return openPanel()
    const first = panel.querySelector('input, textarea, select, button')
    first?.focus()
    first?.select?.()
  }, true)

  window.LAUNCHER = {
    open: openPanel,
    close,
    toggle: () => (S.open ? close() : openPanel()),
    get isOpen() { return S.open },
  }

  window.addEventListener('hashchange', runPending)
  if (document.readyState === 'complete') runPending()
  else window.addEventListener('load', runPending)
})()
