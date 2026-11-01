// Connections: browse every service, connect one in a short sheet, add your own (REST, OpenAPI, MCP).
// window.HUB_CONNECT(id) opens a service's sheet from anywhere: Home, a tab that says "not connected", a chat card.
// window.HUB_CONNECTIONS() opens this page. A key typed here goes to the server once and is never kept or shown again.
;(() => {
  const S = { list: null, at: 0, error: '' }
  const byId = id => S.list?.find(c => c.id === id)

  const css = document.createElement('style')
  css.textContent = `
.cn-form { display: flex; flex-direction: column; gap: 14px; }
.cn-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--label-2); letter-spacing: -0.006em; }
.cn-field input, .cn-field select { width: 100%; height: 40px; padding: 0 12px; border: 0; border-radius: 10px; background: var(--fill); color: var(--label); font: 15px var(--font); letter-spacing: -0.016em; }
.cn-field input:focus, .cn-field select:focus { outline: 0; box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--blue) 30%, transparent); }
.cn-field input::placeholder { color: var(--label-2); }
.cn-help { margin: 0; font-size: 15px; line-height: 1.35; letter-spacing: -0.016em; color: var(--label-2); }
.cn-link { color: var(--blue); font-size: 15px; font-weight: 600; letter-spacing: -0.016em; text-decoration: none; align-self: flex-start; }
.cn-link[aria-disabled="true"] { color: var(--label-3); pointer-events: none; }
.cn-msg { font-size: 15px; line-height: 1.35; letter-spacing: -0.016em; padding: 11px 14px; border-radius: 12px; background: var(--fill); overflow-wrap: anywhere; }
.cn-msg-slot:empty { display: none; }
.cn-msg.good { color: color-mix(in srgb, var(--green) 72%, var(--label)); }
.cn-msg.bad { color: var(--red); }
.cn-msg.warn { color: color-mix(in srgb, var(--orange) 78%, var(--label)); }
.cn-help, .cn-steps, .cn-steps a { overflow-wrap: anywhere; }
.cn-steps { font-size: 15px; line-height: 1.35; letter-spacing: -0.016em; color: var(--label-2); }
.cn-steps summary { color: var(--blue); font-weight: 600; cursor: pointer; }
.cn-steps ol { margin: 10px 0 0; padding-left: 22px; display: flex; flex-direction: column; gap: 8px; }
.cn-steps p { margin: 10px 0 0; }
.cn-steps a { color: var(--blue); text-decoration: none; }
.hw-row select[data-perm] { appearance: none; -webkit-appearance: none; height: 30px; max-width: 60%; padding: 0 26px 0 10px; border: 0; border-radius: 8px; color: var(--label); font: 15px var(--font); letter-spacing: -0.016em; background: var(--fill) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%238e8e93' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E") no-repeat right 9px center; }
.hw-row select[data-perm]:focus { outline: 0; box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--blue) 30%, transparent); }
.cn-field input[type="file"] { display: flex; align-items: center; height: 40px; padding: 5px; font-size: 15px; color: var(--label-2); }
.cn-field input[type="file"]::file-selector-button { height: 30px; margin-right: 10px; padding: 0 12px; border: 0; border-radius: 8px; background: var(--thumb); box-shadow: var(--thumb-shadow); color: var(--label); font: 600 15px var(--font); letter-spacing: -0.016em; cursor: pointer; }
.alert p { white-space: pre-line; overflow-wrap: anywhere; }
.cn-page .row + .row::before { left: 16px; }
.cn-code { font: 600 28px var(--display); letter-spacing: .06em; text-align: center; padding: 14px; border-radius: 12px; background: var(--fill); user-select: all; }
.cn-sub { color: var(--label-2); font-size: 13px; letter-spacing: -0.006em; }
.cn-checks { display: flex; flex-wrap: wrap; gap: 8px 16px; color: var(--label); font-size: 15px; }
.cn-checks label { display: inline-flex; align-items: center; gap: 6px; }
.cn-page-actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 22px; }
.cn-state { flex: none; color: var(--label-2); font-size: 13px; letter-spacing: -0.006em; }
.cn-state.on { color: var(--green); }
.cn-rowbtn { flex: none; color: var(--blue); font-size: 15px; font-weight: 600; padding: 4px 0 4px 8px; }
`
  document.head.append(css)

  const post = async (p, body) => {
    const r = await api(`/api/connections${p}`, body || {})
    if (r.ok === false && r.error) throw new Error(r.error)
    return r
  }
  const load = async force => {
    if (S.list && !force && Date.now() - S.at < 15e3) return
    try {
      const r = await api('/api/connections')
      S.list = r.connections
      S.localCommands = r.localCommands === true
      S.at = Date.now()
      S.error = ''
    } catch (e) { S.error = e.message }
    if (typeof env !== 'undefined' && env === 'connections') render()
  }

  const stateText = c => {
    if (!c.connected) return 'Not connected'
    return c.account ? `Connected as ${c.account}` : 'Connected'
  }
  const row = c => `<div class="row" data-hay="${esc([c.name, c.category, c.connected ? 'connected' : ''].join(' ').toLowerCase())}"><button class="row-line tap" data-cn="${esc(c.id)}"><span class="txt"><div class="t1">${esc(c.name)}</div><div class="t2">${esc(stateText(c))}</div></span><span class="get">${c.connected ? 'Manage' : 'Connect'}</span></button></div>`

  const renderPage = () => {
    if (S.error && !S.list) return `<div class="notice">Couldn’t load connections: ${esc(S.error)}</div>`
    if (!S.list) return '<div class="notice">Loading…</div>'
    const on = S.list.filter(c => c.connected)
    const cats = [...new Set(S.list.filter(c => !c.connected && !c.custom).map(c => c.category))].sort()
    const custom = S.list.filter(c => c.custom && !c.connected)
    return `<div class="cn-page"><div class="cn-page-actions"><button class="hw-btn" data-cn-add>Add Your Own</button><a class="hw-btn" href="/api/connections/export" download>Export</a><button class="hw-btn" data-cn-import>Import</button></div>${[
      group('cn-on', 'Connected', '', on.map(row)),
      ...cats.map(cat => group(`cn-${cat}`, esc(cat), '', S.list.filter(c => !c.connected && !c.custom && c.category === cat).map(row))),
      group('cn-custom', 'Your Connections', '', custom.map(row)),
    ].join('')}</div>`
  }

  // Sits on the document, so any page's button can use data-connect="<id>" to open a sheet.
  document.addEventListener('click', e => {
    const t = (e.composedPath?.()[0] || e.target).closest?.('[data-cn], [data-connect], [data-cn-add], [data-cn-import]')
    if (!t) return
    if (t.dataset.cn || t.dataset.connect) { e.preventDefault(); openSheet(t.dataset.cn || t.dataset.connect) }
    else if ('cnAdd' in t.dataset) openCustom()
    else if ('cnImport' in t.dataset) importFile()
  })

  const fieldHtml = (f, i, keep) => {
    // Named by position, with a one-time-code style off switch, so no browser or password manager offers to save it.
    const type = f.secret ? 'password' : /^(site|url)$/.test(f.name) ? 'url' : 'text'
    return `<label class="cn-field"><span>${esc(f.label)}${f.optional ? ' (optional)' : ''}</span><input data-f="${esc(f.name)}" name="cn-${i}-${Math.random().toString(36).slice(2, 8)}" type="${type}" placeholder="${esc(f.placeholder || '')}" value="${esc(keep || '')}" autocomplete="${f.secret ? 'new-password' : 'off'}" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-bwignore></label>`
  }
  const values = root => Object.fromEntries([...root.querySelectorAll('[data-f]')].map(i => [i.dataset.f, i.value]))
  const message = (root, kind, text) => {
    const m = root.querySelector('.cn-msg-slot'), status = root.querySelector('.cn-status')
    if (status && kind === 'good') { status.textContent = text; if (m) m.innerHTML = ''; return }
    if (m) m.innerHTML = text ? `<div class="cn-msg ${kind}" role="status">${esc(text)}</div>` : ''
  }
  const keyLink = (c, root) => {
    const a = root.querySelector('.cn-link')
    if (!a || !c.keyUrl) return
    const site = root.querySelector('[data-f="site"]')?.value.trim().replace(/\/+$/, '')
    const need = c.keyUrl.includes('{site}')
    a.href = need ? (site && /^https?:\/\//i.test(site) ? c.keyUrl.replace('{site}', site) : '#') : c.keyUrl
    a.setAttribute('aria-disabled', need && a.getAttribute('href') === '#' ? 'true' : 'false')
  }

  let pollStop = null
  const stopPoll = () => { pollStop?.(); pollStop = null }

  async function openSheet(id) {
    if (!S.list || !byId(id)) await load(true)
    const c = byId(id)
    if (!c) return hud('That connection isn’t in the list')
    const sheet = window.HUB_SHEET({ title: c.name, onClose: () => { stopPoll(); if (env === 'connections') render() } })
    paint(sheet, c, false)
  }

  const permRow = c => `<section class="hw-dsec"><h3>What the assistant may do</h3><div class="hw-dlist">
    <label class="hw-row"><span class="t">Read</span><select data-perm="read" class="cn-sub" aria-label="Read"><option value="on"${c.permissions.read === 'on' ? ' selected' : ''}>On</option><option value="off"${c.permissions.read === 'off' ? ' selected' : ''}>Off</option></select></label>
    <label class="hw-row"><span class="t">Make changes</span><select data-perm="write" class="cn-sub" aria-label="Make changes"><option value="ask"${c.permissions.write === 'ask' ? ' selected' : ''}>Ask me each time</option><option value="allow"${c.permissions.write === 'allow' ? ' selected' : ''}>Allow</option><option value="off"${c.permissions.write === 'off' ? ' selected' : ''}>Off</option></select></label>
  </div></section>`

  const short = c => esc(c.name.replace(/\s*\(.*\)$/, ''))
  const linkText = c => (c.auth === 'calendarFeed' ? 'Open your calendar’s settings' : c.signIn && !c.signIn.givesKey ? `Open the ${short(c)} setup page` : `Get a key from ${short(c)}`)
  const linked = text => esc(text).replace(/https?:\/\/[^\s<]*[^\s<.,;:)]/g, u => /\/\/(127\.|localhost)/.test(u) ? u : `<a target="_blank" rel="noopener noreferrer" href="${u}">${u.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>`)
  const stepsHtml = text => {
    const steps = text.split(/\s*(?=\b\d\)\s)/).map(s => s.replace(/\s+\.(?=\s|$)/g, '').trim()).filter(Boolean)
    const numbered = steps.length > 1 && /^1\)/.test(steps[0])
    const inner = numbered ? `<ol>${steps.map(s => `<li>${linked(s.replace(/^\d\)\s*/, ''))}</li>`).join('')}</ol>` : `<p>${linked(text)}</p>`
    return `<details class="cn-steps"><summary>How to set this up</summary>${inner}</details>`
  }

  const listRows = (c, names) => `<section class="hw-dsec"><h3>${c.auth === 'calendarFeed' ? 'Your Calendars' : 'Your Accounts'}</h3><div class="hw-dlist">${names.map(n => `<div class="hw-row"><span class="t ell">${esc(n)}</span><button type="button" class="cn-rowbtn" data-remove="${esc(n)}">Remove</button></div>`).join('')}</div></section>`

  function paint(sheet, c, replacing) {
    const { body, foot } = sheet
    stopPoll()
    const lists = c.auth === 'calendarFeed' ? c.feeds : c.auth === 'claudeLogin' ? c.accounts : null
    const showForm = !c.connected || replacing || lists
    const signInOnly = c.signIn && !c.signIn.givesKey
    const parts = []
    for (const w of c.warn || []) parts.push(`<div class="cn-msg warn">${esc(w)}</div>`)
    if (c.connected && !lists) parts.push(`<div class="cn-msg good cn-status" role="status">${esc(stateText(c))}</div>`)
    if (lists?.length) parts.push(listRows(c, lists))
    parts.push('<div class="cn-msg-slot"></div>')
    if (showForm) {
      parts.push(`<div class="cn-form">`)
      if (c.keyHelp) parts.push(`<p class="cn-help">${esc(c.keyHelp)}</p>`)
      if (c.signIn?.clientHelp) parts.push(stepsHtml(c.signIn.clientHelp))
      if (c.keyUrl) parts.push(`<a class="cn-link" target="_blank" rel="noopener noreferrer" href="#">${c.keyUrl.includes('{site}') ? 'Open the key page on your server' : linkText(c)}</a>`)
      parts.push(c.fields.map((f, i) => fieldHtml(f, i)).join(''))
      parts.push('</div>')
    }
    if (c.connected && !lists) parts.push(permRow(c))
    if (c.mcp?.auth === 'bearer' && !c.connected) parts.push(`<section class="hw-dsec"><h3>Official MCP server</h3><div class="hw-dlist"><div class="hw-row"><span class="t ell">${esc(c.mcp.url)}</span></div></div></section>`)
    body.innerHTML = parts.join('')
    foot.innerHTML = showForm
      ? `${c.signIn ? `<button type="button" class="hw-btn ${signInOnly ? 'solid' : 'tint'}" data-do="signin">Sign In</button>` : ''}${signInOnly || c.auth === 'claudeLogin' ? '' : `<button type="button" class="hw-btn solid" data-do="save">${c.connected && !lists ? 'Save New Key' : 'Connect'}</button>`}${replacing ? '<button type="button" class="hw-btn" data-do="back">Cancel</button>' : ''}`
      : `<button type="button" class="hw-btn" data-do="replace">${signInOnly ? 'Sign In Again' : 'Replace Key'}</button><button type="button" class="hw-btn" data-do="test">Test Again</button><button type="button" class="hw-btn red" data-do="disconnect">Disconnect</button>${c.custom ? '<button type="button" class="hw-btn red" data-do="remove">Remove</button>' : ''}`
    foot.hidden = !foot.innerHTML
    keyLink(c, body)
    body.querySelector('[data-f="site"]')?.addEventListener('input', () => keyLink(c, body))
    body.querySelector('input')?.focus({ preventScroll: true })

    body.onchange = async e => {
      const p = e.target.dataset?.perm
      if (!p) return
      try { const r = await post(`/${c.id}/permission`, { [p]: e.target.value }); swap(r.connection) } catch (err) { message(body, 'bad', err.message) }
    }
    const swap = next => { if (next) { Object.assign(c, next); const at = S.list.findIndex(x => x.id === c.id); if (at >= 0) S.list[at] = c } }
    body.onclick = async e => {
      const name = e.target.dataset?.remove
      if (!name) return
      const ok = await alertBox({ title: `Remove ${name}?`, message: c.auth === 'calendarFeed' ? 'Its events leave the Calendar tab. Nothing changes on the calendar itself.' : 'It leaves the hub. Its sign-in stays in its own folder.', ok: 'Remove', danger: true })
      if (!ok) return
      try { const r = await post(`/${c.id}/disconnect`, { label: name }); swap(r.connection); paint(sheet, c, false) } catch (err) { message(body, 'bad', err.message) }
    }
    foot.onclick = async e => {
      const what = e.target.closest('[data-do]')?.dataset.do
      if (!what) return
      if (what === 'back') return paint(sheet, c, false)
      if (what === 'replace') return paint(sheet, c, true)
      const b = e.target.closest('button')
      b.disabled = true
      try {
        if (what === 'save') {
          message(body, '', '')
          const r = await post(`/${c.id}/save`, { fields: values(body) })
          if (!r.ok) return message(body, 'bad', r.message)
          // The key leaves the page here: the fields are gone with this repaint.
          swap(r.connection)
          paint(sheet, c, false)
          message(body, r.unproven ? 'warn' : 'good', r.message)
          S.at = 0
          document.dispatchEvent(new CustomEvent('hub-connection', { detail: { id: c.id, connected: true } }))
        } else if (what === 'test') {
          const r = await post(`/${c.id}/test`)
          swap(r.connection)
          paint(sheet, c, false)
          message(body, r.ok ? 'good' : 'bad', r.message)
        } else if (what === 'disconnect') {
          const ok = await alertBox({ title: `Disconnect ${c.name}?`, message: 'The key is removed from this computer. Nothing changes on the service itself.', ok: 'Disconnect', danger: true })
          if (!ok) return
          const r = await post(`/${c.id}/disconnect`)
          swap(r.connection)
          paint(sheet, c, false)
          document.dispatchEvent(new CustomEvent('hub-connection', { detail: { id: c.id, connected: false } }))
        } else if (what === 'remove') {
          const ok = await alertBox({ title: `Remove ${c.name}?`, message: 'Its definition and its key are removed from this computer.', ok: 'Remove', danger: true })
          if (!ok) return
          await post('/custom/remove', { id: c.id })
          S.list = S.list.filter(x => x.id !== c.id)
          sheet.close()
        } else if (what === 'signin') {
          await startSignIn(sheet, c, swap)
        }
      } catch (err) { message(body, 'bad', err.message) } finally { b.disabled = false }
    }
  }

  async function startSignIn(sheet, c, swap) {
    const { body } = sheet
    message(body, '', '')
    const r = await post(`/${c.id}/signin`, { fields: values(body) })
    let opened = null
    if (r.authorizeUrl) opened = window.open(r.authorizeUrl, '_blank', 'noopener')
    const waiting = document.createElement('div')
    waiting.className = 'cn-form'
    waiting.innerHTML = r.kind === 'deviceCode'
      ? `<p class="cn-help">Open the page below and enter this code.</p><div class="cn-code">${esc(r.userCode)}</div><a class="cn-link" target="_blank" rel="noopener noreferrer" href="${esc(r.verifyUrl)}">Open the sign-in page</a>`
      : `<p class="cn-help">Finish signing in on the page that opened${opened ? '' : ''}. This sheet updates when it’s done.</p><a class="cn-link" target="_blank" rel="noopener noreferrer" href="${esc(r.authorizeUrl)}">Open the sign-in page again</a>${c.auth === 'claudeLogin' ? '' : `<label class="cn-field"><span>If that page ended on an address that wouldn’t load, paste it here</span><input data-paste type="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="http://127.0.0.1…"></label><button type="button" class="hw-btn tint" data-finish>Finish Sign-In</button>`}`
    body.querySelector('.cn-form')?.replaceWith(waiting)
    waiting.querySelector('[data-finish]')?.addEventListener('click', async () => {
      try {
        const d = await post(`/${c.id}/signin/finish`, { url: waiting.querySelector('[data-paste]').value })
        if (!d.ok) return message(body, 'bad', d.message)
        swap(d.connection)
        paint(sheet, c, false)
        message(body, 'good', d.message)
      } catch (err) { message(body, 'bad', err.message) }
    })
    let live = true
    pollStop = () => { live = false }
    const tick = async () => {
      if (!live) return
      try {
        const s = await api(`/api/connections/${c.id}/signin`)
        if (!live) return
        if (s.state === 'done') {
          stopPoll()
          if (s.connection) swap(s.connection)
          paint(sheet, c, false)
          message(body, 'good', s.message || 'Connected')
          document.dispatchEvent(new CustomEvent('hub-connection', { detail: { id: c.id, connected: true } }))
          return
        }
        if (s.state === 'failed') { stopPoll(); paint(sheet, c, false); message(body, 'bad', s.message || 'The sign-in didn’t finish'); return }
      } catch {}
      setTimeout(tick, 2500)
    }
    setTimeout(tick, 2500)
  }

  /* ---------- your own connections ---------- */

  function openCustom() {
    const sheet = window.HUB_SHEET({ title: 'Add Your Own' })
    const { body, foot } = sheet
    let kind = 'rest'
    const forms = {
      rest: `<p class="cn-help">Any web API. Calls can only go to the address you enter here, and never follow a redirect to another one.</p>
        ${fieldHtml({ name: 'name', label: 'Name', placeholder: 'My API' }, 0)}${fieldHtml({ name: 'baseUrl', label: 'Address', placeholder: 'https://api.example.com', site: 1 }, 1)}
        ${fieldHtml({ name: 'header', label: 'Key header', placeholder: 'Authorization' }, 2)}${fieldHtml({ name: 'prefix', label: 'Before the key', placeholder: 'Bearer ' }, 3)}
        ${fieldHtml({ name: 'testPath', label: 'Path to check the key with', optional: true, placeholder: '/me' }, 4)}
        <div class="cn-field"><span>Allowed methods</span><div class="cn-checks">${['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].map(x => `<label><input type="checkbox" data-method="${x}"${x === 'GET' ? ' checked' : ''}>${x}</label>`).join('')}</div></div>
        <p class="cn-help">GET and HEAD count as reading. Anything else asks you in chat first, every time, until you change it.</p>`,
      openapi: `<p class="cn-help">An OpenAPI file in JSON or YAML. Each operation becomes an action, and only the file’s own server can be called.</p>
        ${fieldHtml({ name: 'name', label: 'Name', optional: true, placeholder: 'From the file' }, 0)}<label class="cn-field"><span>File</span><input data-file type="file" accept=".json,.yaml,.yml,application/json,text/yaml"></label>
        ${fieldHtml({ name: 'testPath', label: 'Path to check the key with', optional: true, placeholder: '/me' }, 1)}`,
      mcp: `<p class="cn-help">${S.localCommands ? 'Any MCP server, at a web address or as a program on this computer.' : 'Any MCP server at a web address. A program on the hub’s computer can only be added from that computer, at localhost.'}</p>
        ${fieldHtml({ name: 'name', label: 'Name', placeholder: 'My tools' }, 0)}${fieldHtml({ name: 'url', label: 'Web address', optional: !!S.localCommands, placeholder: 'https://…/mcp' }, 1)}
        ${S.localCommands ? `${fieldHtml({ name: 'command', label: 'Or a command to run here', optional: true, placeholder: 'npx' }, 2)}${fieldHtml({ name: 'args', label: 'Its arguments', optional: true, placeholder: '-y some-server' }, 3)}
        ${fieldHtml({ name: 'envKey', label: 'Variable that holds its key', optional: true, placeholder: 'API_KEY' }, 4)}` : ''}
        <p class="cn-help">Tools the server marks read-only count as reading. Anything else asks you in chat first.</p>`,
    }
    const paintForm = () => {
      body.innerHTML = `<div class="seg hw-seg" role="tablist" style="width:100%;--n:3;--i:${['rest', 'openapi', 'mcp'].indexOf(kind)}"><span class="seg-thumb"></span>${[['rest', 'Web API'], ['openapi', 'OpenAPI File'], ['mcp', 'MCP Server']].map(([k, l]) => `<button type="button" role="tab" data-kind="${k}" aria-pressed="${k === kind}" aria-selected="${k === kind}">${l}</button>`).join('')}</div><div class="cn-msg-slot"></div><div class="cn-form">${forms[kind]}</div>`
      foot.innerHTML = '<button type="button" class="hw-btn solid" data-do="add">Add</button>'
    }
    paintForm()
    body.addEventListener('click', e => {
      const k = e.target.dataset?.kind
      if (k && k !== kind) { kind = k; paintForm() }
    })
    foot.addEventListener('click', async e => {
      if (!e.target.closest('[data-do]')) return
      const b = e.target.closest('button')
      b.disabled = true
      try {
        const v = values(body)
        let def
        if (kind === 'rest') {
          def = { kind, name: v.name, baseUrl: v.baseUrl, testPath: v.testPath, methods: [...body.querySelectorAll('[data-method]:checked')].map(x => x.dataset.method), auth: v.header === 'none' ? { type: 'none' } : { type: 'token', header: v.header || 'Authorization', ...(v.prefix || !v.header ? { prefix: v.prefix || 'Bearer ' } : { prefix: '' }) } }
        } else if (kind === 'openapi') {
          const file = body.querySelector('[data-file]').files[0]
          if (!file) return message(body, 'bad', 'Pick a file first')
          def = { kind, name: v.name, testPath: v.testPath, spec: await file.text() }
        } else if (v.command) {
          const args = v.args.match(/"[^"]*"|\S+/g)?.map(x => x.replace(/^"|"$/g, '')) || []
          const line = [v.command, ...args].join(' ')
          const ok = await alertBox({ title: 'Run this program?', message: `This runs code on this computer, each time the assistant uses it:\n\n${line}\n\nOnly add a command you trust.`, ok: 'Add and Run', danger: true })
          if (!ok) return
          def = { kind, transport: 'stdio', name: v.name, command: v.command, args, envKey: v.envKey, confirmed: true }
        } else {
          def = { kind, transport: 'http', name: v.name, url: v.url, auth: { type: 'token', header: 'Authorization', prefix: 'Bearer ' } }
        }
        const r = await post('/custom', def)
        S.list = [...(S.list || []), r.connection]
        sheet.close()
        setTimeout(() => openSheet(r.id), 280)
      } catch (err) { message(body, 'bad', err.message) } finally { b.disabled = false }
    })
  }

  function importFile() {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' })
    input.onchange = async () => {
      try {
        const doc = JSON.parse(await input.files[0].text())
        const cmds = (doc.connections || []).filter(c => c.transport === 'stdio').map(c => [c.command, ...(c.args || [])].join(' '))
        if (cmds.length) {
          const ok = await alertBox({ title: 'Run these programs?', message: `This file adds programs that run on this computer:\n\n${cmds.join('\n')}\n\nOnly import a file you trust.`, ok: 'Import', danger: true })
          if (!ok) return
          doc.confirmed = true
        }
        const r = await post('/import', doc)
        hud(`Added ${r.added.length}`)
        await load(true)
      } catch (e) { alertBox({ title: 'Couldn’t import that file', message: e.message, cancel: '' }) }
    }
    input.click()
  }

  window.HUB_CONNECT = openSheet
  // A tab that said "not connected" shows the service as soon as it is. Home and this page repaint themselves.
  document.addEventListener('hub-connection', () => { if (!['home', 'connections', 'chat'].includes(env)) window.TABS?.[env]?.load?.(true) })
  window.HUB_CONNECTIONS = () => setEnv('connections')
  ;(window.TABS ||= {}).connections = {
    title: 'Connections',
    search: 'Search connections',
    render: renderPage,
    load,
    ago: () => (S.at ? ago(S.at) : ''),
  }
})()
