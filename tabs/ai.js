// AI tab: Claude plan usage per account (with a 7-day history graph), Claude Code token use by
// day, model and machine, and optional OpenRouter / DeepSeek balances. Data: /api/ai/state.
// Uses the main script's globals at call time: render, widget, group, esc, ago, api, showMenu,
// copy, hud, MI, ICON, env, store.
;(() => {
  const S = { data: null, err: '', at: 0, loading: null, timer: 0, hover: null }
  const pref = (k, d, ok) => { try { const v = localStorage.getItem(k); return ok.includes(v) ? v : d } catch { return d } }
  const save = (k, v) => { try { localStorage.setItem(k, v) } catch {} }
  S.metric = pref('hub-ai-metric', 'io', ['io', 'cache'])
  S.by = pref('hub-ai-by', 'model', ['model', 'source'])

  /* ---------- style (once) ---------- */

  const css = `
:root { --ai-1: #007aff; --ai-2: #ff9500; --ai-3: #5856d6; --ai-4: #34c759; --ai-other: #8e8e93; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --ai-1: #0a84ff; --ai-2: #d07800; --ai-3: #6e6cf0; --ai-4: #209e44; --ai-other: #8e8e93; } }
:root[data-theme="dark"] { --ai-1: #0a84ff; --ai-2: #d07800; --ai-3: #6e6cf0; --ai-4: #209e44; --ai-other: #8e8e93; }
.ai-acc .widgets, .ai-tok .widgets { margin-bottom: 12px; }
.ai-card { background: var(--surface); border-radius: 18px; padding: 14px 16px 12px; margin-bottom: 30px; min-width: 0; }
.ai-card-head { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 4px 16px; margin-bottom: 14px; }
.ai-card-title { font-size: 15px; font-weight: 600; letter-spacing: -0.016em; }
.ai-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; color: var(--label-2); letter-spacing: -0.006em; }
.ai-legend span { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.ai-legend b { color: var(--label); font-weight: 600; font-variant-numeric: tabular-nums; }
.ai-key { flex: none; width: 10px; height: 10px; border-radius: 3px; background: var(--c); }
.ai-key.line { width: 14px; height: 2px; border-radius: 1px; }
.ai-plot { position: relative; height: 150px; margin-right: 40px; touch-action: pan-y; }
.ai-plot svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.ai-grid { position: absolute; left: 0; right: 0; border-top: 1px solid var(--fill); }
.ai-grid.base { border-top-color: var(--sep); }
.ai-grid span { position: absolute; left: 100%; top: 0; transform: translateY(-50%); padding-left: 8px; font-size: 11px; color: var(--label-2); font-variant-numeric: tabular-nums; white-space: nowrap; letter-spacing: 0; }
.ai-reset { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--sep); }
.ai-reset span { position: absolute; top: -2px; left: 4px; font-size: 11px; color: var(--label-2); white-space: nowrap; letter-spacing: 0; }
.ai-dot { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 2px var(--surface); pointer-events: none; }
.ai-x { position: relative; height: 18px; margin: 6px 40px 0 0; font-size: 11px; color: var(--label-2); letter-spacing: 0; }
.ai-x span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
.ai-x span.l { transform: none; }
.ai-x span.r { transform: translateX(-100%); }
.ai-cross { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--label-3); pointer-events: none; display: none; }
.ai-tip { position: absolute; z-index: 5; top: 0; min-width: 130px; padding: 8px 10px; border-radius: 10px; background: var(--menu-bg); -webkit-backdrop-filter: saturate(180%) blur(30px); backdrop-filter: saturate(180%) blur(30px); box-shadow: 0 0 0 .5px var(--sep), 0 8px 24px rgba(0, 0, 0, .16); font-size: 13px; letter-spacing: -0.006em; pointer-events: none; display: none; white-space: nowrap; }
.ai-tip .h { color: var(--label-2); margin-bottom: 4px; }
.ai-tip .r { display: flex; align-items: center; gap: 7px; line-height: 1.5; }
.ai-tip .r b { font-weight: 600; font-variant-numeric: tabular-nums; }
.ai-tip .r em { font-style: normal; color: var(--label-2); }
.ai-tip .ai-key { width: 12px; height: 2px; border-radius: 1px; }
.ai-cols { position: absolute; inset: 0; display: flex; gap: 3px; }
.ai-col { flex: 1 1 0; min-width: 0; display: flex; align-items: flex-end; justify-content: center; outline: none; }
.ai-stack { width: min(100%, 24px); display: flex; flex-direction: column-reverse; gap: 2px; transition: opacity .2s; }
.ai-stack i { display: block; flex: 1 1 0; min-height: 1px; background: var(--c); }
.ai-stack i:last-child { border-radius: 4px 4px 0 0; }
.ai-cols.hovering .ai-col:not(.on) .ai-stack { opacity: .45; }
.ai-col:focus-visible .ai-stack { box-shadow: 0 0 0 2px var(--blue); }
.ai-empty { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; color: var(--label-2); font-size: 13px; padding: 0 12px; }
.ai-foot { color: var(--label-2); font-size: 13px; letter-spacing: -0.006em; margin-top: 10px; }
.ai-controls { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
.seg.ai-seg { min-width: 0; width: 220px; flex: 0 1 220px; }
.ai-code { padding: 0 16px 14px 40px; }
.ai-code .url code { white-space: normal; word-break: break-all; }
@media (max-width: 720px) {
  .ai-plot { margin-right: 34px; } .ai-x { margin-right: 34px; }
  .seg.ai-seg { flex: 1 1 140px; width: auto; }
  .ai-cols { gap: 2px; }
}`
  if (!document.getElementById('ai-tab-style')) {
    const el = document.createElement('style')
    el.id = 'ai-tab-style'
    el.textContent = css
    document.head.append(el)
  }

  /* ---------- formatting ---------- */

  const compact = n => {
    n = Number(n) || 0
    const a = Math.abs(n)
    const f = (v, u) => `${(v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.?0+$/, '')}${u}`
    return a >= 1e12 ? f(n / 1e12, 'T') : a >= 1e9 ? f(n / 1e9, 'B') : a >= 1e6 ? f(n / 1e6, 'M') : a >= 1e3 ? f(n / 1e3, 'K') : String(Math.round(n))
  }
  const pct = v => (v == null ? '–' : `${Math.round(v)}`)
  const usd = (v, cur = 'USD') => (v == null ? '–' : `${{ USD: '$', CNY: '¥', EUR: '€' }[cur] ?? ''}${Number(v).toFixed(2)}${{ USD: 1, CNY: 1, EUR: 1 }[cur] ? '' : ' ' + cur}`)
  const clock = t => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const resets = t => {
    if (!t) return ''
    const d = t - Date.now()
    if (d < 20 * 3600e3) return `Resets ${clock(t)}`
    if (d < 6 * 864e5) return `Resets ${new Date(t).toLocaleDateString(undefined, { weekday: 'short' })} ${clock(t)}`
    return `Resets ${new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  }
  const since = t => { if (!t) return 'never'; const s = (Date.now() - t) / 1000; return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 129600 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago` }
  const dayLabel = d => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const niceMax = v => { if (!(v > 0)) return 1; const p = 10 ** Math.floor(Math.log10(v)); return [1, 2, 2.5, 5, 10].map(m => m * p).find(x => x >= v) }
  const baseName = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p || ''
  const STATUS_C = { ok: 'var(--green)', stale: 'var(--orange)', expired: 'var(--red)', error: 'var(--red)', connect: 'var(--gray)', mismatch: 'var(--orange)' }

  /* ---------- series colors: follow the entity, never its rank ---------- */

  const FAMILY_SLOT = { opus: 1, sonnet: 2, fable: 3, haiku: 4 }
  const family = id => (/claude-(?:\d-\d-)?([a-z]+)/.exec(id) || [])[1] || ''
  const version = id => { const m = /-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id.replace(/-\d{8}$/, '')) || /(\d+)/.exec(id); return m ? Number(m[1]) + (Number(m[2]) || 0) / 100 : 0 }
  function seriesFor(t) {
    if (S.by === 'source') {
      const list = t.sources.map(s => ({ key: s.key, name: `${s.machine} · ${s.machine === 'Server' ? s.home : s.account || s.home}` }))
      return list.map((s, i) => ({ ...s, c: i < 4 ? `var(--ai-${i + 1})` : 'var(--ai-other)', other: i >= 4 }))
    }
    const slot = {}
    const used = new Set()
    // Models with a trace of use (under 0.1% of all tokens) fold into Other instead of taking a color.
    const vol = {}
    for (const r of t.rows) vol[r.model] = (vol[r.model] || 0) + r.i + r.o + r.cw + r.cr
    const all = Object.values(vol).reduce((a, b) => a + b, 0)
    const byNew = t.models.filter(m => vol[m.id] >= all * 0.001).sort((a, b) => version(b.id) - version(a.id))
    for (const m of byNew) { const s = FAMILY_SLOT[family(m.id)]; if (s && !used.has(s)) { slot[m.id] = s; used.add(s) } }
    for (const m of byNew) if (!slot[m.id]) { const s = [1, 2, 3, 4].find(x => !used.has(x)); if (s) { slot[m.id] = s; used.add(s) } }
    const out = t.models.filter(m => slot[m.id]).map(m => ({ key: m.id, name: m.name, c: `var(--ai-${slot[m.id]})` }))
    if (t.models.some(m => !slot[m.id])) out.push({ key: '_other', name: 'Other', c: 'var(--ai-other)', other: true })
    return out
  }
  const rowKey = (r, series) => { const k = S.by === 'source' ? r.src : r.model; return series.some(s => s.key === k && !s.other) ? k : '_other' }
  const metricOf = r => (S.metric === 'io' ? r.i + r.o : r.cw + r.cr)

  /* ---------- plan usage ---------- */

  function usageChart(a) {
    const u = a.usage || {}
    const now = Date.now()
    const t0 = now - 7 * 864e5
    const X = t => ((t - t0) / (now - t0)) * 100
    const pts = (a.history || []).filter(p => p[0] >= t0)
    const path = idx => {
      let d = ''
      let prev = 0
      for (const p of pts) {
        if (p[idx] == null) { prev = 0; continue }
        d += `${prev && p[0] - prev < 20 * 60e3 ? 'L' : 'M'}${(X(p[0]) * 10).toFixed(1)} ${(100 - p[idx]).toFixed(2)}`
        prev = p[0]
      }
      return d
    }
    const series = [{ idx: 1, name: '5-hour', c: 'var(--ai-1)', cur: u.fiveHour?.pct }, { idx: 2, name: '7-day', c: 'var(--ai-2)', cur: u.sevenDay?.pct }]
    const last = pts.at(-1)
    const grid = [100, 50, 0].map(v => `<div class="ai-grid${v ? '' : ' base'}" style="top:${100 - v}%"><span>${v}%</span></div>`).join('')
    // Weekly resets inside the window, counted back from the next one.
    let marks = ''
    if (u.sevenDay?.resetsAt) for (let r = u.sevenDay.resetsAt - 7 * 864e5; r > t0; r -= 7 * 864e5) if (r < now) marks += `<div class="ai-reset" style="left:${X(r).toFixed(2)}%"><span>Weekly reset</span></div>`
    const ticks = []
    const mid = new Date(t0); mid.setHours(24, 0, 0, 0)
    for (let t = mid.getTime(); t < now; t += 864e5) { const x = X(t); if (x < 97) ticks.push(`<span style="left:${x.toFixed(2)}%">${new Date(t).toLocaleDateString(undefined, { weekday: 'short' })}</span>`) }
    const dots = last ? series.filter(s => last[s.idx] != null && now - last[0] < 20 * 60e3).map(s => `<i class="ai-dot" style="--c:${s.c};left:${X(last[0]).toFixed(2)}%;top:${100 - last[s.idx]}%"></i>`).join('') : ''
    const legend = series.map(s => `<span><i class="ai-key line" style="--c:${s.c}"></i>${s.name} <b>${pct(s.cur)}%</b></span>`).join('')
    const empty = pts.length < 2 ? `<div class="ai-empty">${pts.length ? 'History started. A point is added every 5 minutes.' : 'No history yet. A point is added every 5 minutes.'}</div>` : ''
    const br = (u.breakdown || []).map(b => `${esc(b.name)} ${Math.round(b.pct)}%`).join(' · ')
    return `<div class="ai-card">
      <div class="ai-card-head"><div class="ai-card-title">Last 7 days</div><div class="ai-legend">${legend}</div></div>
      <div class="ai-plot" data-ai-chart="usage" data-acc="${esc(a.id)}">${grid}${marks}
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">${series.map(s => `<path d="${path(s.idx)}" fill="none" stroke="${s.c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`).join('')}</svg>
        ${dots}${empty}<div class="ai-cross"></div><div class="ai-tip"></div></div>
      <div class="ai-x">${ticks.join('')}</div>
      ${br ? `<div class="ai-foot">This week by surface: ${br}</div>` : ''}
    </div>`
  }

  function accountSection(a) {
    const hay = esc([a.label, a.email, a.plan, a.configDir, 'claude usage plan'].join(' ').toLowerCase())
    const head = `<div class="group-head"><h2>${esc(a.label || a.email)}</h2>${a.plan ? `<span class="n">${esc(a.plan)}</span>` : ''}</div>`
    const fixRow = (title, sub) => `<div class="list"><div class="row" data-menu="ai" data-kind="fix" data-v="${esc(a.fix || '')}"><div class="row-line"><span class="status" style="--c:${STATUS_C[a.status] || 'var(--gray)'}"><i></i></span><span class="txt"><div class="t1">${esc(title)}</div><div class="t2" style="white-space:normal">${esc(sub)}</div></span></div>
      ${a.fix ? `<div class="ai-code"><div class="urls"><div class="url"><code>${esc(a.fix)}</code><button class="icon-btn" data-copy="${esc(a.fix)}" aria-label="Copy command">${ICON.copy}</button></div></div></div>` : ''}</div></div>`
    if (a.status === 'connect')
      return `<section class="group ai-acc" data-hay="${hay}">${head}<div class="list"><div class="row"><div class="row-line"><span class="status" style="--c:var(--gray)"><i></i></span><span class="txt"><div class="t1">${esc(`Connect ${a.label}`)}</div><div class="t2">Sign in once. The hub reads its plan usage after that.</div></span><button type="button" class="get" data-connect="claude-account">Sign In</button></div></div></div></section>`
    const u = a.usage
    let notice = ''
    if (a.status !== 'ok') notice = a.fix && !a.isDefault
      ? `<div class="list" style="margin-bottom:12px"><div class="row"><div class="row-line"><span class="status" style="--c:${STATUS_C[a.status] || 'var(--gray)'}"><i></i></span><span class="txt"><div class="t1">${esc(a.message || 'Usage unavailable')}</div><div class="t2">Sign in again to keep reading this account’s usage.</div></span><button type="button" class="get" data-connect="claude-account">Sign In</button></div></div></div>`
      : `<div style="margin-bottom:12px">${fixRow(a.message || 'Usage unavailable', a.fix ? 'Run this in a terminal to sign in again, then press Refresh.' : a.usageAt ? `Showing numbers from ${since(a.usageAt)}.` : 'Trying again in a few minutes.')}</div>`
    if (!u) return `<section class="group ai-acc" data-hay="${hay}">${head}${notice}</section>`
    const w = []
    if (u.fiveHour) w.push(widget('5-hour', `${pct(u.fiveHour.pct)}<small>%</small>`, esc(resets(u.fiveHour.resetsAt)), u.fiveHour.pct))
    if (u.sevenDay) w.push(widget('7-day', `${pct(u.sevenDay.pct)}<small>%</small>`, esc(resets(u.sevenDay.resetsAt)), u.sevenDay.pct))
    for (const l of u.limits || []) w.push(widget(`${esc(l.name)} · 7-day`, `${pct(l.pct)}<small>%</small>`, esc(resets(l.resetsAt)), l.pct))
    for (const c of u.credits || []) w.push(widget('Credit', `${usd(c.used)}`, `of ${usd(c.limit)}${c.resetsAt ? ` · ${esc(resets(c.resetsAt).replace(/^Resets/, 'resets'))}` : ''}`, c.pct))
    if (u.extra) {
      const e = u.extra
      w.push(e.enabled
        ? widget('Extra usage', usd(e.used, e.currency), e.limit != null ? `of ${usd(e.limit, e.currency)} this month` : 'this month', e.limit ? (100 * e.used) / e.limit : null, e.limit ? null : 'var(--blue)')
        : widget('Extra usage', 'Off', e.used ? `${usd(e.used, e.currency)} used` : 'Not turned on', null, 'var(--gray)'))
    }
    return `<section class="group ai-acc" data-hay="${hay}" data-menu="ai" data-kind="account" data-v="${esc(a.email || a.label)}">${head}${notice}<div class="widgets">${w.join('')}</div>${usageChart(a)}</section>`
  }

  /* ---------- tokens ---------- */

  function tokenSection(t) {
    const series = seriesFor(t)
    const days = t.days
    const today = days.at(-1)
    const week = days[days.length - 7]
    const sum = (from, f) => t.rows.filter(r => r.d >= from).reduce((a, r) => a + f(r), 0)
    const stat = (label, from) => widget(label, compact(sum(from, r => r.i + r.o)), `in + out · ${compact(sum(from, r => r.cw + r.cr))} cache · ${compact(sum(from, r => r.n))} calls`, null, 'var(--indigo)')
    // Per day, per series.
    const grid = days.map(() => ({}))
    const idx = Object.fromEntries(days.map((d, i) => [d, i]))
    for (const r of t.rows) { const i = idx[r.d]; if (i == null) continue; const k = rowKey(r, series); grid[i][k] = (grid[i][k] || 0) + metricOf(r) }
    const totals = grid.map(g => Object.values(g).reduce((a, b) => a + b, 0))
    const max = niceMax(Math.max(...totals))
    const cols = grid.map((g, i) => {
      const segs = series.filter(s => (g[s.key] || 0) > max * 0.004).map(s => `<i style="--c:${s.c};flex-grow:${g[s.key]}"></i>`).join('')
      return `<div class="ai-col" data-i="${i}" tabindex="0" aria-label="${esc(dayLabel(days[i]))}: ${compact(totals[i])}"><div class="ai-stack" style="height:${((totals[i] / max) * 100).toFixed(2)}%">${segs}</div></div>`
    }).join('')
    const gridLines = [max, max / 2, 0].map((v, i) => `<div class="ai-grid${i === 2 ? ' base' : ''}" style="top:${i * 50}%"><span>${compact(v)}</span></div>`).join('')
    const ticks = [0, 7, 14, 21, 29].map(i => `<span class="${i === 0 ? 'l' : i === 29 ? 'r' : ''}" style="left:${i === 29 ? 100 : ((i + 0.5) / 30) * 100}%">${i === 29 ? 'Today' : esc(dayLabel(days[i]))}</span>`).join('')
    const legendTotals = {}
    for (const r of t.rows) { const k = rowKey(r, series); legendTotals[k] = (legendTotals[k] || 0) + metricOf(r) }
    const legend = series.filter(s => legendTotals[s.key] > 0).map(s => `<span><i class="ai-key" style="--c:${s.c}"></i>${esc(s.name)} <b>${compact(legendTotals[s.key] || 0)}</b></span>`).join('')
    const seg = (name, cur, opts) => `<div class="seg ai-seg" style="--n:${opts.length};--i:${opts.findIndex(o => o[0] === cur)}"><span class="seg-thumb"></span>${opts.map(([v, l]) => `<button data-ai-${name}="${v}" aria-pressed="${v === cur}">${l}</button>`).join('')}</div>`
    const scan = t.scan
    const busy = []
    if (scan.laptop.scanning) busy.push(scan.laptop.pendingBytes ? `reading ${(scan.laptop.pendingBytes / 2 ** 30).toFixed(1)} GB of laptop logs` : 'reading laptop logs')
    if (scan.server.scanning) busy.push('reading server logs')
    const errs = [scan.laptop.error && `Laptop logs: ${scan.laptop.error}`, scan.server.error && `Server logs: ${scan.server.error}`].filter(Boolean)
    const anyData = totals.some(Boolean)
    const html = [`<section class="ai-tok" data-hay="tokens claude code usage day model machine laptop server cache input output">
      <div class="group-head"><h2>Claude Code tokens</h2><span class="n">Last 30 days</span></div>
      <div class="widgets">${stat('Today', today)}${stat('7 days', week)}${stat('30 days', days[0])}</div>
      <div class="ai-controls">${seg('metric', S.metric, [['io', 'In + Out'], ['cache', 'Cache']])}${seg('by', S.by, [['model', 'Model'], ['source', 'Machine']])}</div>
      <div class="ai-card">
        <div class="ai-card-head"><div class="ai-card-title">${S.metric === 'io' ? 'Input + output tokens per day' : 'Cache tokens per day (reads + writes)'}</div><div class="ai-legend">${legend}</div></div>
        <div class="ai-plot" data-ai-chart="tokens">${gridLines}<div class="ai-cols">${cols}</div>${anyData ? '' : `<div class="ai-empty">${busy.length ? 'Reading session logs…' : 'No Claude Code sessions in the last 30 days.'}</div>`}<div class="ai-tip"></div></div>
        <div class="ai-x">${ticks}</div>
        ${busy.length || errs.length ? `<div class="ai-foot">${esc([busy.length ? cap(busy.join(' and ')) + '…' : '', ...errs].filter(Boolean).join(' · '))}</div>` : ''}
      </div></section>`]
    // Table view of the chart: one row per series over 30 days.
    const per = {}
    for (const r of t.rows) { const k = S.by === 'source' ? r.src : r.model; const p = (per[k] ||= { i: 0, o: 0, cw: 0, cr: 0, n: 0 }); p.i += r.i; p.o += r.o; p.cw += r.cw; p.cr += r.cr; p.n += r.n }
    const keys = Object.keys(per).sort((a, b) => metricOf(per[b]) - metricOf(per[a]))
    const nameOfKey = k => S.by === 'source' ? (series.find(s => s.key === k)?.name || k) : (t.models.find(m => m.id === k)?.name || k)
    const colorOfKey = k => (series.find(s => s.key === k && !s.other) || series.find(s => s.other) || {}).c || 'var(--ai-other)'
    html.push(group('ai-table', S.by === 'source' ? 'By machine · 30 days' : 'By model · 30 days', '', keys.map(k => {
      const p = per[k]
      return `<div class="row" data-hay="${esc(`${nameOfKey(k)} ${k}`.toLowerCase())}"><div class="row-line" style="min-height:52px"><span class="status" style="--c:${colorOfKey(k)}"><i></i></span><span class="txt"><div class="t1">${esc(nameOfKey(k))}</div><div class="t2">in ${compact(p.i)} · out ${compact(p.o)} · cache write ${compact(p.cw)} · cache read ${compact(p.cr)} · ${compact(p.n)} calls</div></span><span class="trail">${compact(metricOf(p))}</span></div></div>`
    })))
    // Where sessions ran.
    const io30 = {}
    for (const r of t.rows) io30[r.src] = (io30[r.src] || 0) + r.i + r.o
    html.push(group('ai-sources', 'Where sessions ran', 'Both server homes sign in as the account shown. A session counts once, with its subagents.', t.sources.map(s => `<div class="row" data-hay="${esc(`${s.machine} ${s.account} ${s.home}`.toLowerCase())}" data-menu="ai" data-kind="source" data-v="${esc(s.home)}"><div class="row-line" style="min-height:52px"><span class="status" style="--c:${s.last && Date.now() - s.last < 15 * 60e3 ? 'var(--green)' : 'var(--gray)'}"><i></i></span><span class="txt"><div class="t1">${esc(s.machine)} · ${esc(s.account || 'unknown account')}</div><div class="t2">${esc(s.home)} · ${s.sessions} session${s.sessions === 1 ? '' : 's'} · active ${since(s.last)}</div></span><span class="trail">${compact(io30[s.key] || 0)}</span></div></div>`)))
    // Recent sessions.
    const srcName = k => { const s = t.sources.find(x => x.key === k); return s ? `${s.machine} · ${s.machine === 'Server' ? s.home : s.account}` : k }
    html.push(group('ai-sessions', 'Recent sessions', 'In + out tokens over the last 7 days.', t.sessions.map(s => `<div class="row" data-hay="${esc(`${baseName(s.cwd)} ${s.cwd} ${srcName(s.src)} ${s.sid} ${s.model}`.toLowerCase())}" data-menu="ai" data-kind="session" data-v="${esc(s.cwd)}"><div class="row-line" style="min-height:52px"><span class="txt"><div class="t1">${esc(baseName(s.cwd) || s.sid)}</div><div class="t2">${esc(srcName(s.src))} · ${esc(t.models.find(m => m.id === s.model)?.name || s.model)} · ${since(s.last)}</div></span><span class="trail">${compact(s.io7)}</span></div></div>`), true))
    return html.join('')
  }
  const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '')

  /* ---------- other providers ---------- */

  function providerRows(list) {
    return group('ai-providers', 'Other AI providers', 'Keys stay on this computer. The page only sees balances.', list.map(p => {
      const hay = esc(`${p.name} ${p.field || ''} provider api key balance`.toLowerCase())
      if (!p.connected) return `<div class="row" data-hay="${hay}"><div class="row-line" style="min-height:52px"><span class="status" style="--c:var(--gray)"><i></i></span><span class="txt"><div class="t1">${esc(p.name)}</div><div class="t2">Not connected</div></span><button type="button" class="get" data-connect="${esc(p.id)}">Connect</button></div></div>`
      let sub = '', trail = ''
      if (p.error) { sub = `Couldn’t read balance (${p.error})`; trail = '–' }
      else if (p.id === 'openrouter') {
        sub = [p.credits != null ? `${usd(p.used)} used of ${usd(p.credits)} credits` : '', p.daily != null ? `today ${usd(p.daily)}` : '', p.monthly != null ? `this month ${usd(p.monthly)}` : '', p.keyLimit != null ? `key limit ${usd(p.keyLimit)}` : ''].filter(Boolean).join(' · ')
        trail = p.balance != null ? `${usd(p.balance)} left` : p.keyUsage != null ? `${usd(p.keyUsage)} used` : ''
      } else if (p.id === 'deepseek') {
        const b = p.balances[0]
        sub = b ? [`topped up ${usd(b.toppedUp, b.currency)}`, `granted ${usd(b.granted, b.currency)}`, p.available === false ? 'balance too low to call' : ''].filter(Boolean).join(' · ') : 'No balance reported'
        trail = b ? usd(b.total, b.currency) : ''
      }
      return `<div class="row" data-hay="${hay}"><div class="row-line" style="min-height:52px"><span class="status" style="--c:${p.error ? 'var(--red)' : 'var(--green)'}"><i></i></span><span class="txt"><div class="t1">${esc(p.name)}</div><div class="t2">${esc(sub)}</div></span><span class="trail">${esc(trail)}</span></div></div>`
    }))
  }

  /* ---------- render ---------- */

  function renderAI() {
    const d = S.data
    if (!d) return S.err ? `<div class="notice err">Can’t load AI usage: ${esc(S.err)}</div>` : '<div class="empty">Loading…</div>'
    let html = S.err ? `<div class="notice err">Couldn’t refresh: ${esc(S.err)}</div>` : ''
    html += [...d.accounts].sort((a, b) => (a.status === 'connect') - (b.status === 'connect')).map(accountSection).join('') || '<div class="notice">No Claude account yet. <button type="button" class="get" data-connect="claude-account">Connect</button></div>'
    html += tokenSection(d.tokens)
    if (d.providers?.list?.length) html += providerRows(d.providers.list)
    queueMicrotask(restoreHover)
    return html
  }

  /* ---------- hover: crosshair on lines, per-column on bars ---------- */

  function tipRows(tip, head, rows) {
    tip.replaceChildren()
    const h = document.createElement('div'); h.className = 'h'; h.textContent = head; tip.append(h)
    for (const [c, value, name] of rows) {
      const r = document.createElement('div'); r.className = 'r'
      const k = document.createElement('i'); k.className = 'ai-key'; k.style.setProperty('--c', c)
      const b = document.createElement('b'); b.textContent = value
      const e = document.createElement('em'); e.textContent = name
      r.append(k, b, e); tip.append(r)
    }
  }
  function placeTip(plot, tip, xPx) {
    tip.style.display = 'block'
    const w = tip.offsetWidth, W = plot.clientWidth
    tip.style.left = `${Math.max(-4, Math.min(W - w + 4, xPx + 12 + w > W ? xPx - w - 12 : xPx + 12))}px`
  }

  function hoverUsage(plot, clientX) {
    const a = S.data?.accounts.find(x => x.id === plot.dataset.acc)
    const pts = a?.history || []
    if (!pts.length) return
    const r = plot.getBoundingClientRect()
    const now = Date.now(), t0 = now - 7 * 864e5
    const t = t0 + ((clientX - r.left) / r.width) * (now - t0)
    let best = pts[0]
    for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p
    const x = ((best[0] - t0) / (now - t0)) * r.width
    const cross = plot.querySelector('.ai-cross')
    cross.style.display = 'block'
    cross.style.left = `${x}px`
    const tip = plot.querySelector('.ai-tip')
    tipRows(tip, new Date(best[0]).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }), [['var(--ai-1)', `${pct(best[1])}%`, '5-hour'], ['var(--ai-2)', `${pct(best[2])}%`, '7-day']])
    placeTip(plot, tip, x)
    S.hover = { chart: 'usage', acc: a.id, clientX }
  }

  function hoverTokens(plot, col) {
    const t = S.data?.tokens
    if (!t || !col) return
    const i = Number(col.dataset.i)
    const series = seriesFor(t)
    const vals = {}
    for (const r of t.rows) if (r.d === t.days[i]) { const k = rowKey(r, series); vals[k] = (vals[k] || 0) + metricOf(r) }
    const total = Object.values(vals).reduce((a, b) => a + b, 0)
    plot.querySelector('.ai-cols').classList.add('hovering')
    plot.querySelectorAll('.ai-col.on').forEach(c => c !== col && c.classList.remove('on'))
    col.classList.add('on')
    const tip = plot.querySelector('.ai-tip')
    const head = `${new Date(`${t.days[i]}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${compact(total)} ${S.metric === 'io' ? 'in + out' : 'cache'}`
    tipRows(tip, head, series.filter(s => vals[s.key]).map(s => [s.c, compact(vals[s.key]), s.name]))
    const pr = plot.getBoundingClientRect(), cr = col.getBoundingClientRect()
    placeTip(plot, tip, cr.left - pr.left + cr.width / 2)
    S.hover = { chart: 'tokens', i }
  }

  function clearHover(plot) {
    plot.querySelectorAll('.ai-cross, .ai-tip').forEach(el => (el.style.display = 'none'))
    plot.querySelector('.ai-cols')?.classList.remove('hovering')
    plot.querySelectorAll('.ai-col.on').forEach(c => c.classList.remove('on'))
    S.hover = null
  }

  // The main page re-renders every few seconds; put the readout back where it was.
  function restoreHover() {
    const h = S.hover
    if (!h) return
    if (h.chart === 'usage') { const p = document.querySelector(`[data-ai-chart="usage"][data-acc="${CSS.escape(h.acc)}"]`); if (p) hoverUsage(p, h.clientX) }
    else { const p = document.querySelector('[data-ai-chart="tokens"]'); const c = p?.querySelector(`.ai-col[data-i="${h.i}"]`); if (c) hoverTokens(p, c) }
  }

  const onPoint = e => {
    if (typeof env !== 'undefined' && env !== 'ai') return
    const plot = e.target.closest?.('[data-ai-chart]')
    document.querySelectorAll('[data-ai-chart]').forEach(p => p !== plot && (p.querySelector('.ai-tip')?.style.display === 'block') && clearHover(p))
    if (!plot) return
    if (plot.dataset.aiChart === 'usage') hoverUsage(plot, e.clientX)
    else hoverTokens(plot, e.target.closest('.ai-col'))
  }
  document.addEventListener('pointermove', onPoint, { passive: true })
  document.addEventListener('pointerdown', onPoint, { passive: true })
  document.addEventListener('pointerleave', e => { const p = e.target.closest?.('[data-ai-chart]'); if (p && e.target === p) clearHover(p) }, true)
  document.addEventListener('focusin', e => { const c = e.target.closest?.('.ai-col'); if (c) hoverTokens(c.closest('[data-ai-chart]'), c) })
  document.addEventListener('focusout', e => { const c = e.target.closest?.('.ai-col'); if (c) clearHover(c.closest('[data-ai-chart]')) })

  document.addEventListener('click', e => {
    const b = e.target.closest?.('[data-ai-metric], [data-ai-by]')
    if (!b) return
    if (b.dataset.aiMetric) { S.metric = b.dataset.aiMetric; save('hub-ai-metric', S.metric) }
    if (b.dataset.aiBy) { S.by = b.dataset.aiBy; save('hub-ai-by', S.by) }
    render()
  })

  /* ---------- data ---------- */

  function load(force) {
    if (!S.timer) S.timer = setInterval(() => {
      if (typeof env === 'undefined' || env !== 'ai' || document.hidden) return
      // Poll faster while the log scan is catching up so its progress shows.
      const sc = S.data?.tokens?.scan
      const busy = sc && (sc.laptop.scanning || sc.server.scanning)
      if (busy || Date.now() - S.at > 30e3) load()
    }, 5000)
    if (S.loading && !force) return S.loading
    S.loading = (async () => {
      try {
        S.data = force ? await api('/api/ai/refresh', {}) : await api('/api/ai/state')
        S.at = Date.now()
        S.err = ''
      } catch (e) { S.err = e.message }
      S.loading = null
      if (typeof env === 'undefined' || env === 'ai') render()
    })()
    return S.loading
  }

  function menu(row, x, y) {
    const { kind, v } = row.dataset
    const items = []
    if (kind === 'account') items.push({ label: 'Copy Email', icon: MI.copy, run: () => copy(v, 'Email copied') })
    if (kind === 'fix' && v) items.push({ label: 'Copy Command', icon: MI.copy, run: () => copy(v, 'Command copied') })
    if ((kind === 'session' || kind === 'source') && v) items.push({ label: 'Copy Folder Path', icon: MI.copy, run: () => copy(v, 'Path copied') })
    items.push({ label: 'Refresh', icon: MI.refresh, run: () => load(true) })
    showMenu(x, y, kind === 'session' ? baseName(v) : v || 'AI', items)
    return true
  }

  ;(window.TABS ||= {}).ai = {
    title: 'AI',
    search: 'Search AI',
    render: renderAI,
    load,
    menu,
    ago: () => (S.at ? ago(S.at) : ''),
  }
})()
