// First-run wizard: shows only while this hub has no config (window.HUB_CONF.needsSetup).
// Keys go straight to the hub, which saves them in config/secrets.json and never sends them back.
;(() => {
  const conf = window.HUB_CONF
  if (!conf?.needsSetup) return
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const css = `
  .hs-veil { position: fixed; inset: 0; z-index: 9000; display: grid; place-items: center; padding: 16px; overflow: auto;
    background: rgba(8, 10, 16, .55); -webkit-backdrop-filter: blur(24px) saturate(1.4); backdrop-filter: blur(24px) saturate(1.4); font: 15px/1.4 Inter, system-ui, sans-serif; }
  .hs-card { width: min(480px, 100%); max-height: calc(100dvh - 32px); display: flex; flex-direction: column; overflow: hidden; border-radius: 22px; color: var(--label, #111);
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
  .hs-steps { font-size: 13px; color: var(--label-2, #6b6b72); margin-bottom: 14px; }`

  const answers = { name: conf.name, access: 'localhost', claudeConfigDir: '', keys: {} }
  let status = { claude: {}, tailscale: {}, local: true }
  let step = 0
  const KEYS = [
    ['openrouter', 'OpenRouter key', 'password'], ['deepseek', 'DeepSeek key', 'password'], ['stripe', 'Stripe restricted key', 'password'],
    ['coolifyUrl', 'Coolify address', 'text'], ['coolifyToken', 'Coolify token', 'password'],
    ['cloudflareToken', 'Cloudflare token', 'password'], ['cloudflareAccount', 'Cloudflare account id', 'text'],
    ['calendarLabel', 'Calendar name', 'text'], ['calendarUrl', 'Calendar link (ICS)', 'password'],
  ]
  const field = (key, label, type, value, ph = '') => `<label>${esc(label)}<input data-f="${key}" type="${type}" value="${esc(value)}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false"></label>`
  const STEPS = [
    () => `<h1>Set up your hub</h1><p>A private dashboard and assistant on this computer. This takes a minute, and you can change it all later.</p>${field('name', 'Hub name', 'text', answers.name, 'LocalHub')}`,
    () => `<h1>Who can reach it?</h1><p>You can widen this later.</p>
      <label class="hs-choice"><input type="radio" name="hs-access" value="localhost" ${answers.access === 'localhost' ? 'checked' : ''}><span>Only this computer<small>The safe default. The hub answers on localhost and nowhere else.</small></span></label>
      <label class="hs-choice" ${status.tailscale.installed ? '' : 'style="opacity:.55"'}><input type="radio" name="hs-access" value="tailnet" ${answers.access === 'tailnet' ? 'checked' : ''} ${status.tailscale.installed ? '' : 'disabled'}><span>My tailnet<small>${status.tailscale.installed ? 'Your own devices on Tailscale can open it too, with a passcode. Nothing on the public internet can.' : 'Needs Tailscale, which isn’t installed on this computer.'}</small></span></label>
      ${answers.access === 'tailnet' ? field('passcode', 'Passcode for other devices', 'password', answers.passcode || '', 'At least 8 characters') : ''}`,
    () => `<h1>Connect Claude</h1><p>The Chat tab uses your own Claude Code login on this computer. Your hub never sees your password.</p>
      <div class="hs-status">${!status.claude.installed ? 'Claude Code isn’t installed yet. You can finish setup now and install it later; Chat waits until then.' : status.claude.signedIn ? 'Claude Code is installed and signed in.' : status.claude.signedIn === null ? 'Claude Code is installed. If Chat asks, run <code>claude</code> in a terminal once to sign in.' : 'Claude Code is installed. Run <code>claude</code> in a terminal once to sign in.'}</div>
      ${field('claudeConfigDir', 'Claude folder (optional)', 'text', answers.claudeConfigDir, 'Leave empty to use your usual login')}`,
    () => `<h1>Optional keys</h1><p>Each one turns on a tab. Skip them all if you like, and connect them later in the hub. They stay on this computer and are never sent back to this page.</p>
      ${KEYS.map(([k, l, t]) => field(`key.${k}`, l, t, answers.keys[k] || '')).join('')}`,
  ]

  let root, card
  function collect() {
    for (const i of card.querySelectorAll('[data-f]')) {
      const f = i.dataset.f
      if (f.startsWith('key.')) answers.keys[f.slice(4)] = i.value
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
      const go = e.target.closest('[data-go]')?.dataset.go
      if (!go) return
      collect()
      if (go === 'back') { step--; return paint() }
      if (step === STEPS.length - 1) return finish()
      step++
      paint()
    })
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); card.querySelector('[data-go=next]').click() }
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
