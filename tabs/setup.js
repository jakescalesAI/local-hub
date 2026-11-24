// First-run wizard: shows only while this hub has no config (window.HUB_CONF.needsSetup).
// Keys go straight to the hub, which saves them in config/secrets.json and never sends them back.
;(() => {
  const conf = window.HUB_CONF
  if (!conf?.needsSetup) return
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const css = `
  .hs-veil { position: fixed; inset: 0; z-index: 9000; display: grid; place-items: center; padding: 16px; overflow: auto;
    background: rgba(8, 10, 16, .55); -webkit-backdrop-filter: blur(24px) saturate(1.4); backdrop-filter: blur(24px) saturate(1.4); font: 15px/1.4 Inter, system-ui, sans-serif; }
  /* One size for every step: short steps keep the room, long ones scroll inside .hs-body. */
  .hs-card { width: min(480px, 100%); height: min(600px, calc(100vh - 32px)); height: min(600px, calc(100dvh - 32px)); display: flex; flex-direction: column; overflow: hidden; border-radius: 22px; color: var(--label, #111);
    background: color-mix(in srgb, var(--surface, #fff) 82%, transparent); border: 1px solid rgba(255,255,255,.25); box-shadow: 0 24px 70px rgba(0,0,0,.4); }
  .hs-card h1 { margin: 0 0 4px; font-size: 24px; font-weight: 700; letter-spacing: -.02em; }
  .hs-card p { margin: 0 0 16px; color: var(--label-2, #6b6b72); }
  .hs-card label { display: block; margin: 0 0 12px; font-size: 13px; font-weight: 600; }
  .hs-card input[type=text], .hs-card input[type=password] { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; padding: 10px 12px; font: 15px Inter, system-ui, sans-serif; color: inherit;
    background: var(--surface-2, #f2f2f7); border: 1px solid transparent; border-radius: 10px; outline: none; }
  .hs-card input:focus { border-color: var(--blue, #0a84ff); }
  .hs-choice { display: flex !important; gap: 10px; align-items: flex-start; padding: 12px; margin: 0 0 8px !important; border-radius: 12px; background: var(--surface-2, #f2f2f7); font-weight: 500 !important; font-size: 15px !important; cursor: pointer; }
  .hs-choice small { display: block; color: var(--label-2, #6b6b72); font-size: 13px; font-weight: 400; }
  .hs-status { padding: 12px; border-radius: 12px; background: var(--surface-2, #f2f2f7); margin: 0 0 12px; }
  .hs-status code { font: 13px ui-monospace, Menlo, Consolas, monospace; }
  /* The fields scroll inside the card; the buttons stay put at the bottom. */
  .hs-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 26px 26px 6px; --thumb: color-mix(in srgb, var(--label, #000) 22%, transparent); }
  .hs-body:hover { --thumb: color-mix(in srgb, var(--label, #000) 34%, transparent); }
  .hs-body p, .hs-body h1, .hs-body label { overflow-wrap: anywhere; }
  .hs-btns { flex: none; display: flex; gap: 8px; justify-content: flex-end; padding: 14px 26px 22px; border-top: 1px solid color-mix(in srgb, var(--label, #000) 8%, transparent); }
  @supports selector(::-webkit-scrollbar) {
    .hs-body::-webkit-scrollbar { width: 14px; background: transparent; }
    .hs-body::-webkit-scrollbar-track { background: transparent; margin: 14px 0; }
    .hs-body::-webkit-scrollbar-thumb { border: 5px solid transparent; border-radius: 10px; background: var(--thumb) padding-box; }
    .hs-body::-webkit-scrollbar-button { display: none; }
  }
  @supports not selector(::-webkit-scrollbar) { .hs-body { scrollbar-width: thin; scrollbar-color: var(--thumb) transparent; } }
  .hs-btn { padding: 10px 18px; border: 0; border-radius: 11px; font: 600 15px Inter, system-ui, sans-serif; cursor: pointer; color: inherit; background: var(--surface-2, #f2f2f7); }
  .hs-btn.go { color: #fff; background: var(--blue, #0a84ff); }
  .hs-btn:disabled { opacity: .5; cursor: default; }
  .hs-err { color: var(--red, #ff3b30); font-size: 14px; margin: 8px 0 0; min-height: 1em; }
  .hs-steps { font-size: 13px; color: var(--label-2, #6b6b72); margin-bottom: 14px; }
  /* Step 4: pick a connection, fill in just its fields, and keep a short list of the ones added. */
  .hs-card select { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; padding: 10px 34px 10px 12px; font: 15px Inter, system-ui, sans-serif; color: inherit; cursor: pointer;
    appearance: none; -webkit-appearance: none; border: 1px solid transparent; border-radius: 10px; outline: none;
    background: var(--surface-2, #f2f2f7) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%238e8e93' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E") no-repeat right 13px center; }
  .hs-card select:focus { border-color: var(--blue, #0a84ff); }
  .hs-card select option { color: var(--label, #111); background: var(--surface, #fff); }
  .hs-list { margin: 0 0 14px; padding: 0; list-style: none; border-radius: 12px; background: var(--surface-2, #f2f2f7); }
  .hs-list li { display: flex; align-items: center; gap: 4px; padding: 8px 8px 8px 12px; min-width: 0; }
  .hs-list li + li { border-top: 1px solid color-mix(in srgb, var(--label, #000) 8%, transparent); }
  .hs-list .who { flex: 1 1 auto; min-width: 0; font-weight: 600; }
  .hs-list .who small { display: block; font-weight: 400; font-size: 13px; color: var(--label-2, #6b6b72); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hs-link { flex: none; padding: 6px 8px; border: 0; border-radius: 8px; background: none; font: 600 14px Inter, system-ui, sans-serif; color: var(--blue, #0a84ff); cursor: pointer; }
  .hs-link.rm { color: var(--red, #ff3b30); }
  .hs-link:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
  .hs-conn { margin: 0 0 12px; padding: 14px 14px 12px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--label, #000) 10%, transparent); }
  .hs-conn-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 8px; margin: 0 0 10px; font-weight: 600; }
  .hs-conn-head small { font-weight: 400; font-size: 13px; color: var(--label-2, #6b6b72); }
  .hs-conn-btns { display: flex; gap: 8px; justify-content: flex-end; }
  .hs-conn-btns .hs-btn { padding: 8px 14px; font-size: 14px; }
  .hs-none { margin: 0 0 12px; font-size: 13px; color: var(--label-2, #6b6b72); }`

  const answers = { name: conf.name, access: 'localhost', claudeConfigDir: '', keys: {} }
  let status = { claude: {}, tailscale: {}, local: true }
  let step = 0
  // The connections step 4 can add, each with the fields it needs. Field ids are the keys /api/hub/setup reads.
  // A field is [id, label, input type, placeholder, required].
  const CONNECTIONS = [
    { id: 'openrouter', name: 'OpenRouter', hint: 'Models for the AI tab', fields: [['openrouter', 'API key', 'password', 'sk-or-…', true]] },
    { id: 'deepseek', name: 'DeepSeek', hint: 'Models for the AI tab', fields: [['deepseek', 'API key', 'password', 'sk-…', true]] },
    { id: 'stripe', name: 'Stripe', hint: 'Turns on the Stripe tab', fields: [['stripe', 'Restricted key', 'password', 'rk_…', true]] },
    { id: 'coolify', name: 'Coolify', hint: 'Your servers in the Cloud tab', fields: [['coolifyUrl', 'Address', 'text', 'https://coolify.example.com', true], ['coolifyToken', 'Token', 'password', '', true]] },
    { id: 'cloudflare', name: 'Cloudflare', hint: 'Your sites in the Cloud tab', fields: [['cloudflareToken', 'API token', 'password', '', true], ['cloudflareAccount', 'Account id (optional)', 'text', 'Found from the token if empty', false]] },
    { id: 'calendar', name: 'Calendar', hint: 'An ICS feed for the Calendar tab', fields: [['calendarLabel', 'Name (optional)', 'text', 'Calendar', false], ['calendarUrl', 'Link (ICS)', 'password', 'https://…', true]] },
  ]
  const connById = id => CONNECTIONS.find(c => c.id === id)
  const isAdded = c => c.fields.every(([k, , , , req]) => !req || answers.keys[k])
  const bare = label => label.replace(/ \(.*\)$/, '').toLowerCase()
  // What the list shows for an added connection. Secrets are never echoed, only that one was entered.
  const summary = c => {
    const k = answers.keys
    if (c.id === 'coolify') return k.coolifyUrl.replace(/^https?:\/\//i, '')
    if (c.id === 'cloudflare') return k.cloudflareAccount ? `Account ${k.cloudflareAccount}` : 'Token entered'
    if (c.id === 'calendar') return `${k.calendarLabel || 'Calendar'} · link entered`
    return 'Key entered'
  }
  // The connection being filled in, { id, values, editing }, or null.
  let draft = null
  const field = (key, label, type, value, ph = '') => `<label>${esc(label)}<input data-f="${key}" type="${type}" value="${esc(value)}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false"></label>`
  const STEPS = [
    () => `<h1>Set up your hub</h1><p>A private dashboard and assistant on this computer. This takes a minute, and you can change it all later.</p>${field('name', 'Hub name', 'text', answers.name, 'LocalHub')}`,
    () => `<h1>Who can reach it?</h1><p>You can widen this later.</p>
      <label class="hs-choice"><input type="radio" name="hs-access" value="localhost" ${answers.access === 'localhost' ? 'checked' : ''}><span>Only this computer<small>The safe default. The hub answers on localhost and nowhere else.</small></span></label>
      <label class="hs-choice" ${status.tailscale.installed ? '' : 'style="opacity:.55"'}><input type="radio" name="hs-access" value="tailnet" ${answers.access === 'tailnet' ? 'checked' : ''} ${status.tailscale.installed ? '' : 'disabled'}><span>My tailnet<small>${status.tailscale.installed ? 'Your own devices on Tailscale can open it too, with a passcode. Nothing on the public internet can.' : 'Needs Tailscale, which isn’t installed on this computer.'}</small></span></label>
      ${answers.access === 'tailnet' ? field('passcode', 'Passcode for other devices', 'password', answers.passcode || '', 'At least 8 characters') : ''}`,
    () => `<h1>Connect Claude</h1><p>The Chat tab runs Claude Code, signed in with your own Claude account or API key. You sign in to Claude Code yourself; LocalHub never sees your password or your sign-in.</p><p>LocalHub isn’t made by or affiliated with Anthropic.</p>
      <div class="hs-status">${!status.claude.installed ? 'Claude Code isn’t installed yet. You can finish setup now and install it later; Chat waits until then.' : status.claude.signedIn ? 'Claude Code is installed and signed in.' : status.claude.signedIn === null ? 'Claude Code is installed. If Chat asks, run <code>claude</code> in a terminal once to sign in.' : 'Claude Code is installed. Run <code>claude</code> in a terminal once to sign in.'}</div>
      ${field('claudeConfigDir', 'Claude folder (optional)', 'text', answers.claudeConfigDir, 'Leave empty to use your usual login')}`,
    () => `<h1>Optional keys</h1><p>Each one turns on a tab. Skip them all if you like, and connect them later in the hub. They stay on this computer and are never sent back to this page.</p>
      ${keysStep()}`,
  ]

  function keysStep() {
    const added = CONNECTIONS.filter(isAdded)
    const list = added.length ? `<ul class="hs-list" aria-label="Added connections">${added.map(c => `<li><span class="who">${esc(c.name)}<small>${esc(summary(c))}</small></span>
      <button type="button" class="hs-link" data-conn-edit="${c.id}" aria-label="Edit ${esc(c.name)}">Edit</button><button type="button" class="hs-link rm" data-conn-rm="${c.id}" aria-label="Remove ${esc(c.name)}">Remove</button></li>`).join('')}</ul>` : ''
    if (draft) {
      const c = connById(draft.id)
      return `${list}<div class="hs-conn" role="group" aria-label="${esc(c.name)}"><div class="hs-conn-head">${esc(c.name)}<small>${esc(c.hint)}</small></div>
        ${c.fields.map(([k, l, t, ph]) => field(`draft.${k}`, l, t, draft.values[k] || '', ph)).join('')}
        <div class="hs-conn-btns"><button type="button" class="hs-btn" data-conn="cancel">Cancel</button><button type="button" class="hs-btn go" data-conn="save">${draft.editing ? 'Save' : 'Add'}</button></div></div>`
    }
    const left = CONNECTIONS.filter(c => !isAdded(c))
    if (!left.length) return `${list}<p class="hs-none">Every connection is added.</p>`
    return `${list}<label>${added.length ? 'Add another connection' : 'Add a connection'}<select data-conn-pick>
      <option value="">Choose one…</option>${left.map(c => `<option value="${c.id}">${esc(c.name)} · ${esc(c.hint)}</option>`).join('')}</select></label>`
  }
  // Checks the open connection and moves it into answers.keys. Returns an error to show, or '' once saved.
  function saveDraft() {
    const c = connById(draft.id)
    for (const [k, l, , , req] of c.fields) {
      const v = (draft.values[k] || '').trim()
      if (req && !v) return `${c.name} needs its ${bare(l)}.`
      if (/Url$/.test(k) && v && !/^https?:\/\/\S+$/i.test(v)) return `${c.name} needs an http or https ${bare(l)}.`
    }
    for (const [k] of c.fields) {
      const v = (draft.values[k] || '').trim()
      if (v) answers.keys[k] = v
      else delete answers.keys[k]
    }
    draft = null
    return ''
  }

  let root, card
  function collect() {
    for (const i of card.querySelectorAll('[data-f]')) {
      const f = i.dataset.f
      if (f.startsWith('draft.')) { if (draft) draft.values[f.slice(6)] = i.value }
      else answers[f] = i.value
    }
    const a = card.querySelector('input[name=hs-access]:checked')
    if (a) answers.access = a.value
  }
  function paint(error = '') {
    const last = step === STEPS.length - 1
    card.innerHTML = `<div class="hs-body"><div class="hs-steps">Step ${step + 1} of ${STEPS.length}</div>${STEPS[step]()}
      <div class="hs-err" role="alert">${esc(error)}</div></div>
      <div class="hs-btns">${step ? '<button class="hs-btn" data-go="back">Back</button>' : ''}<button class="hs-btn go" data-go="next">${last ? 'Finish' : 'Continue'}</button></div>`
    card.querySelector('input:not([type=radio])')?.focus()
    for (const r of card.querySelectorAll('input[name=hs-access]')) r.onchange = () => { collect(); paint() }
    const pick = card.querySelector('[data-conn-pick]')
    if (pick) pick.onchange = () => { if (pick.value) { draft = { id: pick.value, values: {}, editing: false }; paint() } }
    // On a short card the open connection, Add button included, comes into view.
    card.querySelector('.hs-conn')?.scrollIntoView({ block: 'nearest' })
  }
  async function finish() {
    const btn = card.querySelector('[data-go=next]')
    btn.disabled = true
    try {
      const r = await fetch('/api/hub/setup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify(answers) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Setup failed')
      location.reload()
    } catch (e) {
      paint(e.message)
    }
  }
  function open() {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    root = document.createElement('div')
    root.className = 'hs-veil'
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-label', 'Set up your hub')
    root.id = 'hub-setup'
    root.innerHTML = '<div class="hs-card"></div>'
    card = root.firstChild
    document.body.append(root)
    card.addEventListener('click', e => {
      const b = e.target.closest('button')
      if (!b) return
      const { conn, connEdit, connRm } = b.dataset
      if (conn || connEdit || connRm) {
        collect()
        if (conn === 'cancel') draft = null
        if (conn === 'save') { const err = saveDraft(); if (err) return paint(err) }
        if (connEdit) {
          const c = connById(connEdit)
          draft = { id: c.id, values: Object.fromEntries(c.fields.map(([k]) => [k, answers.keys[k] || ''])), editing: true }
        }
        if (connRm) for (const [k] of connById(connRm).fields) delete answers.keys[k]
        paint()
        if (!draft) card.querySelector('[data-conn-pick]')?.focus()
        return
      }
      const go = b.dataset.go
      if (!go) return
      collect()
      if (go === 'back') { step--; return paint() }
      if (step === STEPS.length - 1) {
        // A connection left open but filled in is added rather than dropped; an empty one is ignored.
        if (draft && Object.values(draft.values).some(v => v.trim())) { const err = saveDraft(); if (err) return paint(err) }
        draft = null
        return finish()
      }
      step++
      paint()
    })
    card.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !e.target.matches('input')) return
      e.preventDefault()
      // Enter in a connection's fields adds that connection; anywhere else it moves on.
      card.querySelector(e.target.closest('.hs-conn') ? '[data-conn=save]' : '[data-go=next]').click()
    })
    paint()
  }
  const start = async () => {
    try { status = await (await fetch('/api/hub/setup')).json() } catch {}
    open()
  }
  if (document.body) start()
  else document.addEventListener('DOMContentLoaded', start)
})()
