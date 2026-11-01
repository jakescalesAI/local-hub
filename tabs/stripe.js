// Stripe tab: balance, last-30-day revenue with a daily chart, MRR, recent payments, payouts and
// open invoices for each Stripe account in secrets.json. Read only. Data: /api/stripe/state.
// Uses the main script's globals at call time: render, widget, group, esc, ago, api, showMenu,
// copy, hud, MI, ICON, env.
;(() => {
  const S = { data: null, err: '', at: 0, loading: null, timer: 0, hover: null, acc: '' }
  try { S.acc = localStorage.getItem('hub-stripe-acc') || '' } catch {}

  /* ---------- style (once) ---------- */

  const css = `
.st-card { background: var(--surface); border-radius: 18px; padding: 14px 16px 12px; margin-bottom: 30px; min-width: 0; }
.st-card-head { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 4px 16px; margin-bottom: 14px; }
.st-card-title { font-size: 15px; font-weight: 600; letter-spacing: -0.016em; }
.st-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; color: var(--label-2); letter-spacing: -0.006em; }
.st-legend span { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.st-legend b { color: var(--label); font-weight: 600; font-variant-numeric: tabular-nums; }
.st-key { flex: none; width: 10px; height: 10px; border-radius: 3px; background: var(--c); }
.st-plot { position: relative; height: 150px; margin-right: 48px; touch-action: pan-y; }
.st-grid { position: absolute; left: 0; right: 0; border-top: 1px solid var(--fill); }
.st-grid.base { border-top-color: var(--sep); }
.st-grid span { position: absolute; left: 100%; top: 0; transform: translateY(-50%); padding-left: 8px; font-size: 11px; color: var(--label-2); font-variant-numeric: tabular-nums; white-space: nowrap; letter-spacing: 0; }
.st-x { position: relative; height: 18px; margin: 6px 48px 0 0; font-size: 11px; color: var(--label-2); letter-spacing: 0; }
.st-x span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
.st-x span.l { transform: none; }
.st-x span.r { transform: translateX(-100%); }
.st-cols { position: absolute; inset: 0; display: flex; gap: 3px; }
.st-col { flex: 1 1 0; min-width: 0; display: flex; align-items: flex-end; justify-content: center; outline: none; }
.st-bar { width: min(100%, 24px); background: var(--indigo); border-radius: 4px 4px 0 0; min-height: 0; transition: opacity .2s; }
.st-bar.zero { background: var(--fill-2); height: 2px !important; border-radius: 1px; }
.st-cols.hovering .st-col:not(.on) .st-bar { opacity: .45; }
.st-col:focus-visible .st-bar { box-shadow: 0 0 0 2px var(--blue); }
.st-empty { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; color: var(--label-2); font-size: 13px; padding: 0 12px; pointer-events: none; }
.st-tip { position: absolute; z-index: 5; top: 0; min-width: 130px; padding: 8px 10px; border-radius: 10px; background: var(--menu-bg); -webkit-backdrop-filter: saturate(180%) blur(30px); backdrop-filter: saturate(180%) blur(30px); box-shadow: 0 0 0 .5px var(--sep), 0 8px 24px rgba(0, 0, 0, .16); font-size: 13px; letter-spacing: -0.006em; pointer-events: none; display: none; white-space: nowrap; }
.st-tip .h { color: var(--label-2); margin-bottom: 4px; }
.st-tip .r { display: flex; align-items: center; gap: 7px; line-height: 1.5; }
.st-tip .r b { font-weight: 600; font-variant-numeric: tabular-nums; }
.st-tip .r em { font-style: normal; color: var(--label-2); }
.st-tip .st-key { width: 12px; height: 2px; border-radius: 1px; }
.st-foot { color: var(--label-2); font-size: 13px; letter-spacing: -0.006em; margin-top: 10px; }
.st-acc .widgets { margin-bottom: 12px; }
.st-acc .notice { margin-bottom: 12px; }
.st-controls { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
.seg.st-seg { min-width: 0; width: auto; max-width: 100%; }
.seg.st-seg button { padding: 0 14px; min-width: 0; }
.seg.st-seg button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-connect { background: var(--surface); border-radius: 18px; padding: 18px 16px 16px; margin-bottom: 30px; }
.st-connect h3 { margin: 0 0 6px; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
.st-connect p { margin: 0; font-size: 15px; line-height: 1.4; color: var(--label-2); letter-spacing: -0.012em; }
.st-connect code { font: 13px var(--mono); letter-spacing: 0; color: var(--label); background: var(--fill); border-radius: 6px; padding: 1px 6px; word-break: break-word; }
.st-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.st-mode { font-size: 12px; font-weight: 600; letter-spacing: -0.003em; border-radius: 6px; padding: 2px 8px; color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); }
.st-acc .row .trail { color: var(--label); font-variant-numeric: tabular-nums; font-weight: 500; }
@media (max-width: 720px) {
  .st-plot { margin-right: 44px; } .st-x { margin-right: 44px; }
  .st-cols { gap: 2px; }
}`
  if (!document.getElementById('stripe-tab-style')) {
    const el = document.createElement('style')
    el.id = 'stripe-tab-style'
    el.textContent = css
    document.head.append(el)
  }

  /* ---------- formatting ---------- */

  const digitsMemo = {}
  const cur = c => String(c || 'usd').toUpperCase()
  const digits = c => {
    const k = cur(c)
    if (digitsMemo[k] == null) { try { digitsMemo[k] = new Intl.NumberFormat(undefined, { style: 'currency', currency: k }).resolvedOptions().maximumFractionDigits } catch { digitsMemo[k] = 2 } }
    return digitsMemo[k]
  }
  function money(minor, c, opt) {
    if (minor == null) return '–'
    const v = minor / 10 ** digits(c)
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur(c), ...opt }).format(v) } catch { return `${v.toFixed(digits(c))} ${cur(c)}` }
  }
  // Headline sizes drop the cents once an amount reaches 1,000 so it fits a widget.
  const headline = (minor, c) => money(minor, c, Math.abs(minor) >= 1000 * 10 ** digits(c) ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : undefined)
  const axis = (minor, c) => money(minor, c, { notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 })
  const niceMax = v => { if (!(v > 0)) return 0; const p = 10 ** Math.floor(Math.log10(v)); return [1, 2, 2.5, 5, 10].map(m => m * p).find(x => x >= v) }
  const dayLabel = d => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
  const since = t => { if (!t) return 'never'; const s = (Date.now() - t) / 1000; return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 129600 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago` }
  const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '')
  const nice = s => cap(String(s || '').replace(/_/g, ' '))
  const clock = ms => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  function when(sec) {
    if (!sec) return ''
    const ms = sec * 1000
    const d = new Date(ms), n = new Date()
    const day0 = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const diff = Math.round((day0(n) - day0(d)) / 864e5)
    if (diff === 0) return `Today ${clock(ms)}`
    if (diff === 1) return 'Yesterday'
    if (diff === -1) return 'Tomorrow'
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' })
  }
  const sumBy = list => {
    const m = new Map()
    for (const b of list || []) m.set(b.currency, (m.get(b.currency) || 0) + b.amount)
    return [...m].map(([currency, amount]) => ({ currency, amount }))
  }

  /* ---------- sections ---------- */

  const dashBase = a => `https://dashboard.stripe.com${a.mode === 'test' ? '/test' : ''}`
  const accName = a => a.label || a.account?.name || 'Stripe'

  function connectCard(a) {
    const field = a.field || 'stripe.apiKey'
    return `<div class="st-connect">
      <h3>Connect ${esc(a.label && a.label !== 'Stripe' ? a.label : 'Stripe')}</h3>
      <p>Create a restricted key in Stripe → Developers → API keys with Read access to Balance, Charges, Payouts, Subscriptions, Customers and Invoices, then add it to local-hub\\secrets.json as <code>${esc(field)}</code>.</p>
      <div class="st-actions">
        <a class="get" href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener">Open API Keys</a>
        <button class="get" data-copy="${esc(field)}">Copy Field Name</button>
        ${S.data?.secretsPath ? `<button class="get" data-copy="${esc(S.data.secretsPath)}">Copy File Path</button>` : ''}
      </div>
    </div>`
  }

  function widgets(a) {
    const c = a.account?.currency || a.last30?.currency || 'usd'
    const order = list => sumBy(list).sort((x, y) => (y.currency === c) - (x.currency === c) || y.amount - x.amount)
    const bal = (label, list, color, none) => {
      if (!a.balance) return widget(label, '–', 'Not available', null, 'var(--gray)')
      const l = order(list)
      if (!l.length) return widget(label, esc(headline(0, c)), esc(none), null, color)
      return widget(label, esc(headline(l[0].amount, l[0].currency)), esc(l.length > 1 ? l.slice(1).map(x => headline(x.amount, x.currency)).join(' · ') : none), null, color)
    }
    const w = [bal('Available', a.balance?.available, 'var(--green)', 'Ready to pay out'), bal('Pending', a.balance?.pending, 'var(--orange)', 'On the way')]
    const l = a.last30
    if (l) {
      const bits = [`${headline(l.net, l.currency)} net`, plural(l.count, 'payment')]
      if (l.refunds) bits.push(`${headline(l.refunds, l.currency)} refunded`)
      if (l.otherCurrencies?.length) bits.push(`plus ${l.otherCurrencies.map(o => headline(o.gross, o.currency)).join(', ')}`)
      w.push(widget('Last 30 days', esc(headline(l.gross, l.currency)), esc(bits.join(' · ')), null, 'var(--indigo)'))
    } else w.push(widget('Last 30 days', '–', 'Not available', null, 'var(--gray)'))
    if (a.mrr != null) {
      const sub = [plural(a.activeSubs ?? 0, 'active subscription'), a.customers != null ? plural(a.customers, 'customer') + (a.customersApprox ? '+' : '') : ''].filter(Boolean).join(' · ')
      w.push(widget('MRR', `${esc(headline(a.mrr, a.mrrCurrency))}<small>/mo</small>`, esc(sub + (a.mrrApprox ? ' · estimate' : '')), null, 'var(--blue)'))
    } else w.push(widget('MRR', '–', a.customers != null ? esc(plural(a.customers, 'customer')) : 'Not available', null, 'var(--gray)'))
    return `<div class="widgets">${w.join('')}</div>`
  }

  function chart(a) {
    const d = a.daily
    if (!d) return ''
    const c = a.last30?.currency || a.account?.currency || 'usd'
    const peak = Math.max(0, ...d.map(x => x.gross))
    const max = niceMax(peak)
    const total = d.reduce((s, x) => s + x.gross, 0)
    const cols = d.map((x, i) => {
      const h = max ? (Math.max(0, x.gross) / max) * 100 : 0
      return `<div class="st-col" data-i="${i}" tabindex="0" aria-label="${esc(dayLabel(x.day))}: ${esc(money(x.gross, c))}"><div class="st-bar${x.gross > 0 ? '' : ' zero'}" style="height:${h.toFixed(2)}%"></div></div>`
    }).join('')
    const lines = max ? [max, max / 2, 0] : [0]
    const grid = lines.map((v, i) => `<div class="st-grid${v === 0 ? ' base' : ''}" style="top:${max ? i * 50 : 100}%"><span>${esc(axis(v, c))}</span></div>`).join('')
    const ticks = [0, 7, 14, 21, 29].map(i => `<span class="${i === 0 ? 'l' : i === 29 ? 'r' : ''}" style="left:${i === 29 ? 100 : ((i + 0.5) / 30) * 100}%">${i === 29 ? 'Today' : esc(dayLabel(d[i].day))}</span>`).join('')
    const best = d.reduce((p, x) => (x.gross > p.gross ? x : p), d[0])
    return `<div class="st-card">
      <div class="st-card-head"><div class="st-card-title">Revenue per day</div><div class="st-legend"><span><i class="st-key" style="--c:var(--indigo)"></i>30 days <b>${esc(money(total, c))}</b></span>${peak > 0 ? `<span>Best day <b>${esc(money(best.gross, c))}</b> ${esc(dayLabel(best.day))}</span>` : ''}</div></div>
      <div class="st-plot" data-st-chart data-acc="${esc(a.id)}">${grid}<div class="st-cols">${cols}</div>${peak > 0 ? '' : '<div class="st-empty">No payments in the last 30 days.</div>'}<div class="st-tip"></div></div>
      <div class="st-x">${ticks}</div>
      ${a.last30?.truncated ? '<div class="st-foot">Only the newest 1,500 transactions are counted, so the oldest days may read low.</div>' : ''}
    </div>`
  }

  const DOT = { succeeded: 'var(--green)', paid: 'var(--green)', pending: 'var(--orange)', in_transit: 'var(--orange)', failed: 'var(--red)', canceled: 'var(--red)', refunded: 'var(--gray)' }

  function rowHtml({ hay, dot, t1, t2, trail, kind, url, v }) {
    return `<div class="row" data-hay="${esc(String(hay).toLowerCase())}" data-menu="stripe" data-kind="${kind}" data-url="${esc(url || '')}" data-v="${esc(v || '')}"><div class="row-line" style="min-height:52px"><span class="status" style="--c:${dot}"><i></i></span><span class="txt"><div class="t1">${esc(t1)}</div><div class="t2">${esc(t2)}</div></span><span class="trail">${esc(trail)}</span></div></div>`
  }

  function lists(a) {
    const out = []
    const base = dashBase(a)
    const name = accName(a)
    const rows = (a.recentCharges || []).map(p => rowHtml({
      hay: `${name} payment ${p.description} ${p.customer} ${p.status} ${money(p.amount, p.currency)}`, dot: DOT[p.status] || 'var(--gray)',
      t1: p.description || p.customer || 'Payment', t2: [p.description && p.customer ? p.customer : '', nice(p.status), when(p.created)].filter(Boolean).join(' · '),
      trail: money(p.amount, p.currency), kind: 'payment', url: `${base}/payments`, v: money(p.amount, p.currency),
    }))
    out.push(group(`st-pay-${a.id}`, 'Recent payments', '', rows))
    const po = (a.payouts || []).map(p => rowHtml({
      hay: `${name} payout ${p.status} ${money(p.amount, p.currency)}`, dot: DOT[p.status] || 'var(--gray)',
      t1: 'Payout', t2: `${nice(p.status)} · ${p.arrival * 1000 > Date.now() ? 'arrives' : 'arrived'} ${when(p.arrival)}`,
      trail: money(p.amount, p.currency), kind: 'payout', url: `${base}/payouts`, v: money(p.amount, p.currency),
    }))
    out.push(group(`st-po-${a.id}`, 'Payouts', '', po))
    const inv = a.openInvoices || []
    const totals = sumBy(inv.map(i => ({ amount: i.amount_due, currency: i.currency })))
    const now = Date.now()
    const ir = inv.map(i => {
      const late = i.due && i.due * 1000 < now
      return rowHtml({
        hay: `${name} invoice ${i.customer} ${i.number} ${money(i.amount_due, i.currency)}`, dot: late ? 'var(--red)' : i.due ? 'var(--orange)' : 'var(--gray)',
        t1: i.customer || 'Invoice', t2: [i.number, i.due ? `${late ? 'Overdue since' : 'Due'} ${when(i.due)}` : 'No due date'].filter(Boolean).join(' · '),
        trail: money(i.amount_due, i.currency), kind: 'invoice', url: i.url || `${base}/invoices`, v: money(i.amount_due, i.currency),
      })
    })
    out.push(group(`st-inv-${a.id}`, 'Open invoices', totals.length ? esc(`${totals.map(t => money(t.amount, t.currency)).join(' + ')} outstanding`) : '', ir))
    const loaded = a.recentCharges && a.payouts && a.openInvoices
    if (loaded && !rows.length && !po.length && !ir.length) out.push('<div class="notice">Nothing to show yet: no payments, payouts or open invoices on this account.</div>')
    return out.join('')
  }

  function accountSection(a) {
    if (!a.connected) return `<section class="group st-acc" data-hay="stripe connect ${esc((a.field || '').toLowerCase())} api key">${connectCard(a)}</section>`
    const mode = a.mode === 'test' ? '<span class="st-mode" style="--c:var(--orange)">Test mode</span>' : '<span class="st-mode" style="--c:var(--green)">Live</span>'
    const meta = [a.account?.country, a.account?.currency ? cur(a.account.currency) : ''].filter(Boolean).join(' · ')
    const head = `<div class="group-head"><h2>${esc(accName(a))}</h2>${mode}${meta ? `<span class="n">${esc(meta)}</span>` : ''}<a class="more" href="${esc(dashBase(a))}" target="_blank" rel="noopener">Dashboard</a></div>`
    let notes = ''
    if (a.error) notes += `<div class="notice err">${a.stale ? `Couldn’t refresh: ${esc(a.error)} Showing numbers from ${since(a.cachedAt)}.` : esc(a.error)}</div>`
    if (a.warnings?.length) notes += `<div class="notice">Some numbers are unavailable. ${esc(a.warnings.join('. '))}. Give the key Read access to these in Stripe, then press Refresh.</div>`
    const hasData = a.balance || a.last30 || a.recentCharges || a.mrr != null
    if (!hasData) return `<section class="group st-acc">${head}${notes}</section>`
    return `<section class="group st-acc">${head}${notes}${widgets(a)}${chart(a)}${lists(a)}</section>`
  }

  /* ---------- render ---------- */

  function selected(d) {
    return d.accounts.find(a => a.id === S.acc) || d.accounts[0]
  }

  function renderStripe() {
    const d = S.data
    if (!d) return S.err ? `<div class="notice err">Can’t load Stripe: ${esc(S.err)}</div>` : '<div class="empty">Loading…</div>'
    let html = S.err ? `<div class="notice err">Couldn’t refresh: ${esc(S.err)}</div>` : ''
    const a = selected(d)
    if (!a) return html + '<div class="notice">No Stripe accounts found in secrets.json.</div>'
    if (d.accounts.length > 1) {
      const i = Math.max(0, d.accounts.indexOf(a))
      html += `<div class="st-controls"><div class="seg st-seg" role="group" style="--n:${d.accounts.length};--i:${i}"><span class="seg-thumb"></span>${d.accounts.map(x => `<button data-st-acc="${esc(x.id)}" aria-pressed="${x.id === a.id}"><span>${esc(accName(x))}</span></button>`).join('')}</div></div>`
    }
    html += accountSection(a)
    queueMicrotask(restoreHover)
    return html
  }

  /* ---------- hover on the bar chart ---------- */

  function placeTip(plot, tip, xPx) {
    tip.style.display = 'block'
    const w = tip.offsetWidth, W = plot.clientWidth
    tip.style.left = `${Math.max(-4, Math.min(W - w + 4, xPx + 12 + w > W ? xPx - w - 12 : xPx + 12))}px`
  }

  function hoverBar(plot, col) {
    const a = S.data?.accounts.find(x => x.id === plot.dataset.acc)
    if (!a?.daily || !col) return
    const i = Number(col.dataset.i)
    const x = a.daily[i]
    if (!x) return
    const c = a.last30?.currency || a.account?.currency || 'usd'
    plot.querySelector('.st-cols').classList.add('hovering')
    plot.querySelectorAll('.st-col.on').forEach(el => el !== col && el.classList.remove('on'))
    col.classList.add('on')
    const tip = plot.querySelector('.st-tip')
    tip.replaceChildren()
    const h = document.createElement('div'); h.className = 'h'
    h.textContent = new Date(`${x.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    tip.append(h)
    const r = document.createElement('div'); r.className = 'r'
    const k = document.createElement('i'); k.className = 'st-key'; k.style.setProperty('--c', 'var(--indigo)')
    const b = document.createElement('b'); b.textContent = money(x.gross, c)
    const e = document.createElement('em'); e.textContent = x.count ? plural(x.count, 'payment') : 'no payments'
    r.append(k, b, e); tip.append(r)
    const pr = plot.getBoundingClientRect(), cr = col.getBoundingClientRect()
    placeTip(plot, tip, cr.left - pr.left + cr.width / 2)
    S.hover = { acc: a.id, i }
  }

  function clearHover(plot) {
    plot.querySelectorAll('.st-tip').forEach(el => (el.style.display = 'none'))
    plot.querySelector('.st-cols')?.classList.remove('hovering')
    plot.querySelectorAll('.st-col.on').forEach(c => c.classList.remove('on'))
    S.hover = null
  }

  // The main page re-renders every few seconds; put the readout back where it was.
  function restoreHover() {
    const h = S.hover
    if (!h) return
    const p = document.querySelector(`[data-st-chart][data-acc="${CSS.escape(h.acc)}"]`)
    const c = p?.querySelector(`.st-col[data-i="${h.i}"]`)
    if (c) hoverBar(p, c)
  }

  const onPoint = e => {
    if (typeof env !== 'undefined' && env !== 'stripe') return
    const plot = e.target.closest?.('[data-st-chart]')
    document.querySelectorAll('[data-st-chart]').forEach(p => p !== plot && p.querySelector('.st-tip')?.style.display === 'block' && clearHover(p))
    if (plot) hoverBar(plot, e.target.closest('.st-col'))
  }
  document.addEventListener('pointermove', onPoint, { passive: true })
  document.addEventListener('pointerdown', onPoint, { passive: true })
  document.addEventListener('pointerleave', e => { const p = e.target.closest?.('[data-st-chart]'); if (p && e.target === p) clearHover(p) }, true)
  document.addEventListener('focusin', e => { const c = e.target.closest?.('.st-col'); if (c) hoverBar(c.closest('[data-st-chart]'), c) })
  document.addEventListener('focusout', e => { const c = e.target.closest?.('.st-col'); if (c) clearHover(c.closest('[data-st-chart]')) })

  document.addEventListener('click', e => {
    const b = e.target.closest?.('[data-st-acc]')
    if (!b) return
    S.acc = b.dataset.stAcc
    try { localStorage.setItem('hub-stripe-acc', S.acc) } catch {}
    S.hover = null
    render()
  })

  /* ---------- data ---------- */

  function load(force) {
    if (!S.timer) S.timer = setInterval(() => {
      if (typeof env === 'undefined' || env !== 'stripe' || document.hidden) return
      if (Date.now() - S.at > 30e3) load()
    }, 5000)
    if (S.loading && !force) return S.loading
    S.loading = (async () => {
      try {
        S.data = force ? await api('/api/stripe/refresh', {}) : await api('/api/stripe/state')
        S.at = Date.now()
        S.err = ''
      } catch (e) { S.err = e.message }
      S.loading = null
      if (typeof env === 'undefined' || env === 'stripe') render()
    })()
    return S.loading
  }

  function menu(row, x, y) {
    const { kind, url, v } = row.dataset
    const items = []
    if (url) items.push({ label: kind === 'invoice' && url.includes('invoice.stripe.com') ? 'Open Invoice' : 'Open in Stripe', icon: MI.open, run: () => window.open(url, '_blank', 'noopener') })
    if (v) items.push({ label: 'Copy Amount', icon: MI.copy, run: () => copy(v, 'Amount copied') })
    items.push({ label: 'Refresh', icon: MI.refresh, run: () => load(true) })
    showMenu(x, y, cap(kind || 'Stripe'), items)
    return true
  }

  ;(window.TABS ||= {}).stripe = {
    title: 'Stripe',
    search: 'Search Stripe',
    render: renderStripe,
    load,
    menu,
    ago: () => (S.at ? ago(S.at) : ''),
  }
})()
