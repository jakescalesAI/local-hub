// Calendar tab: Month / Week / Agenda over the hub's local calendar (editable) and read-only
// ICS feeds listed in secrets.json. Loaded before index.html's main script; it uses that
// script's globals (render, group, esc, ago, api, showMenu, copy, hud, overlay, alertBox,
// showError, MI, store, env, suppressClick) only at call time.
;(() => {
  const K = { ready: false, mode: 'month', cur: null, sel: null, data: null, cover: null, loading: null, t: 0, err: '', hidden: new Set(), byId: {}, scroll: null }
  const SEG = [['month', 'Month'], ['week', 'Week'], ['agenda', 'Agenda']]
  const AGENDA_DAYS = 30
  const PLUS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
  const CHEV_L = '<svg width="10" height="17" viewBox="0 0 10 17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 1.5 2 8.5l6.5 7"/></svg>'
  const CHEV_R = '<svg width="10" height="17" viewBox="0 0 10 17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m1.5 1.5 6.5 7-6.5 7"/></svg>'
  const CHECK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>'

  const CSS = `
.cal-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 12px; margin: 0 0 14px; }
.cal-title { margin: 0 6px; font: 700 22px/1.2 var(--display); letter-spacing: .005em; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal-nav, .cal-tools { display: flex; align-items: center; gap: 6px; }
.cal-pill { height: 32px; padding: 0 14px; border-radius: 99px; background: var(--fill); color: color-mix(in srgb, var(--blue) 72%, var(--label)); font-size: 15px; font-weight: 600; letter-spacing: -0.016em; transition: opacity .15s; }
.cal-ic { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; color: var(--blue); flex: none; transition: opacity .15s; }
.cal-ic.fill { background: var(--fill); }
.cal-pill:active, .cal-ic:active { opacity: .35; }
.seg.cal-seg { width: 216px; min-width: 0; margin: 0; }
.cal-card { background: var(--surface); border-radius: 14px; overflow: hidden; margin-bottom: 30px; }

.cal-dow, .cal-month { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.cal-dow { border-bottom: .5px solid var(--sep); }
.cal-dow span { padding: 8px 0 6px; text-align: center; font-size: 11px; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; color: var(--label-2); }
.cal-day { position: relative; min-height: 112px; min-width: 0; overflow: hidden; padding: 5px 4px 3px; border-right: .5px solid var(--sep); border-bottom: .5px solid var(--sep); cursor: pointer; transition: background .15s; }
.cal-day:nth-child(7n) { border-right: 0; }
.cal-day.last { border-bottom: 0; }
@media (hover: hover) { .cal-day:hover { background: color-mix(in srgb, var(--press) 35%, transparent); } }
.cal-num { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 24px; padding: 0 6px; border-radius: 12px; font-size: 14px; font-weight: 500; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.cal-day.out .cal-num { color: var(--label-3); }
.cal-day.today .cal-num { background: var(--blue); color: #fff; font-weight: 700; }
.cal-chips { display: flex; flex-direction: column; gap: 2px; margin-top: 3px; }
.cal-chip { display: flex; align-items: center; gap: 5px; width: 100%; height: 18px; padding: 0 5px; border-radius: 5px; font-size: 12px; font-weight: 500; line-height: 18px; letter-spacing: -0.006em; text-align: left; white-space: nowrap; overflow: hidden; min-width: 0; transition: background .15s; }
.cal-chip .dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--c); }
.cal-chip .tt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.cal-chip .tm { flex: none; color: var(--label-2); font-size: 11px; font-variant-numeric: tabular-nums; }
.cal-chip.all { background: var(--c); color: var(--ink, #fff); }
@media (hover: hover) { .cal-chip.timed:hover { background: var(--fill); } }
.cal-more { display: block; width: 100%; padding: 0 5px; height: 16px; font-size: 12px; font-weight: 600; line-height: 16px; color: var(--label-2); text-align: left; }
.cal-panel { display: none; }

.cal-scroll { max-height: min(68vh, 740px); overflow-y: auto; overflow-x: hidden; position: relative; -webkit-overflow-scrolling: touch; }
.cal-sticky { position: sticky; top: 0; z-index: 4; background: var(--surface); border-bottom: .5px solid var(--sep); }
.cal-wk { --gut: 48px; --hh: 48px; }
.cal-row { display: grid; grid-template-columns: var(--gut) repeat(7, minmax(0, 1fr)); }
.cal-wh { text-align: center; padding: 7px 0 6px; min-width: 0; border-left: .5px solid var(--sep); }
.cal-wh .dwl, .cal-wh .dws { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--label-2); letter-spacing: .02em; }
.cal-wh .dws { display: none; }
.cal-wh .dn { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; margin-top: 2px; border-radius: 14px; font-size: 19px; font-weight: 500; font-variant-numeric: tabular-nums; }
.cal-wh.today .dn { background: var(--blue); color: #fff; font-weight: 700; }
.cal-wh.today .dwl, .cal-wh.today .dws { color: var(--blue); }
.cal-ad { min-height: 28px; padding: 3px 2px; border-left: .5px solid var(--sep); display: flex; flex-direction: column; gap: 2px; min-width: 0; cursor: pointer; }
.cal-ad-l { font-size: 10px; color: var(--label-2); text-align: right; padding: 7px 6px 0 0; text-transform: uppercase; }
.cal-hours { position: relative; display: grid; grid-template-columns: var(--gut) repeat(7, minmax(0, 1fr)); height: calc(var(--hh) * 24); }
.cal-hl { position: absolute; left: var(--gut); right: 0; border-top: .5px solid var(--sep); pointer-events: none; }
.cal-gut { position: relative; }
.cal-gut span { position: absolute; right: 7px; transform: translateY(-50%); font-size: 10px; color: var(--label-2); white-space: nowrap; font-variant-numeric: tabular-nums; }
.cal-col { position: relative; border-left: .5px solid var(--sep); min-width: 0; cursor: pointer; }
.cal-col.today { background: color-mix(in srgb, var(--blue) 5%, transparent); }
.cal-ev { position: absolute; z-index: 1; padding: 2px 5px; border-radius: 6px; border-left: 3px solid var(--c); background: color-mix(in srgb, var(--c) 22%, var(--surface)); text-align: left; overflow: hidden; font-size: 11.5px; line-height: 1.2; letter-spacing: -0.006em; transition: filter .15s; }
.cal-ev b { display: block; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal-ev span { display: block; color: var(--label-2); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (hover: hover) { .cal-ev:hover { filter: brightness(.96); } }
.cal-now { position: absolute; left: 0; right: 0; height: 0; z-index: 3; border-top: 1.5px solid var(--red); pointer-events: none; }
.cal-now::before { content: ""; position: absolute; left: -4px; top: -5px; width: 8px; height: 8px; border-radius: 50%; background: var(--red); }

.cal-time { flex: none; width: 70px; font-size: 13px; line-height: 1.25; font-variant-numeric: tabular-nums; color: var(--label); }
.cal-time small { display: block; color: var(--label-2); font-size: 12px; }
.cal-stripe { flex: none; width: 4px; align-self: stretch; margin: 2px 0; border-radius: 2px; background: var(--c); }
.cal-check { flex: none; width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--c); display: grid; place-items: center; color: #fff; }
.cal-check.on { background: var(--c); }
.cal-check svg { display: none; }
.cal-check.on svg { display: block; }
.cal-h { margin: 8px 4px 12px; font: 700 22px/1.2 var(--display); letter-spacing: .005em; }
.cal-connect { background: var(--surface); border-radius: 14px; padding: 16px 18px 18px; margin-bottom: 30px; }
.cal-connect code { font: 13px var(--mono); letter-spacing: 0; }
.cal-prov { width: 12px; height: 12px; border-radius: 50%; background: var(--c); flex: none; margin: 0 4px; }
.cal-connect h3 { margin: 0 0 4px; font: 600 17px var(--display); }
.cal-connect ol { margin: 8px 0 12px; padding-left: 20px; font-size: 15px; color: var(--label-2); }
.cal-connect li { margin: 3px 0; }
.cal-connect li b { color: var(--label); font-weight: 500; }
.cal-snip { display: flex; align-items: center; gap: 10px; background: var(--surface-2); border-radius: 10px; padding: 9px 12px; min-width: 0; }
.cal-snip code { flex: 1; min-width: 0; font: 12.5px/1.45 var(--mono); letter-spacing: 0; overflow-wrap: anywhere; }

.cal-form .list { margin-bottom: 16px; }
.cal-f { position: relative; display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 6px 16px; }
.cal-f + .cal-f::before { content: ""; position: absolute; top: 0; left: 16px; right: 0; border-top: .5px solid var(--sep); }
.cal-f > label { flex: none; min-width: 62px; font-size: 17px; }
.cal-f input[type=text], .cal-f textarea { flex: 1; min-width: 0; border: 0; background: none; color: var(--label); font: 17px var(--font); letter-spacing: -0.022em; outline: none; padding: 0; }
.cal-f input::placeholder, .cal-f textarea::placeholder { color: var(--label-3); }
.cal-f textarea { min-height: 92px; padding: 8px 0; resize: vertical; line-height: 1.35; }
.cal-f .pick { margin-left: auto; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; min-width: 0; }
.cal-f input[type=date], .cal-f input[type=time] { height: 34px; border: 0; border-radius: 8px; background: var(--fill); color: var(--label); padding: 0 8px; font: 15px var(--font); letter-spacing: -0.016em; outline: none; min-width: 0; max-width: 100%; }
.cal-f input[hidden] { display: none; }
.cal-sw { position: relative; width: 51px; height: 31px; flex: none; margin-left: auto; }
.cal-sw input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; margin: 0; cursor: pointer; z-index: 1; }
.cal-sw i { position: absolute; inset: 0; border-radius: 99px; background: var(--fill-2); transition: background .25s var(--ease); }
.cal-sw i::after { content: ""; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; border-radius: 50%; background: #fff; box-shadow: 0 3px 8px rgba(0, 0, 0, .15), 0 3px 1px rgba(0, 0, 0, .06); transition: transform .25s var(--ease); }
.cal-sw input:checked + i { background: var(--green); }
.cal-sw input:checked + i::after { transform: translateX(20px); }
.cal-err { color: var(--red); font-size: 15px; padding: 0 16px 12px; }
.cal-err[hidden] { display: none; }
.cal-d-title { font: 700 24px/1.2 var(--display); letter-spacing: .005em; margin: 2px 0 6px; overflow-wrap: anywhere; }
.cal-d-cal { display: flex; align-items: center; gap: 7px; font-size: 15px; color: var(--label-2); margin-bottom: 14px; }
.cal-d-cal i { width: 10px; height: 10px; border-radius: 50%; background: var(--c); flex: none; }
.cal-d-row { padding: 12px 16px; font-size: 17px; overflow-wrap: anywhere; }
.cal-d-row + .cal-d-row { border-top: .5px solid var(--sep); }
.cal-d-row small { display: block; font-size: 13px; color: var(--label-2); margin-bottom: 2px; }
.cal-d-row a { color: var(--blue); }
.cal-d-notes { white-space: pre-wrap; }
.cal-d-act { display: block; width: 100%; text-align: center; padding: 12px 16px; font-size: 17px; color: var(--red); }
.cal-d-act:active { background: var(--press); }

@media (max-width: 720px) {
  .cal-title { order: -1; flex-basis: 100%; margin: 0 2px; font-size: 24px; }
  .cal-tools { margin-left: auto; }
  .seg.cal-seg { width: 190px; }
  .cal-day { min-height: 56px; padding: 4px 1px 3px; text-align: center; }
  .cal-num { font-size: 15px; min-width: 28px; height: 28px; border-radius: 14px; }
  .cal-num .mo { display: none; }
  .cal-day.sel:not(.today) .cal-num { background: var(--label); color: var(--surface); }
  .cal-chips { flex-direction: row; flex-wrap: wrap; justify-content: center; gap: 3px; margin-top: 2px; }
  .cal-month .cal-chip { width: 6px; height: 6px; padding: 0; gap: 0; border-radius: 50%; background: var(--c) !important; pointer-events: none; font-size: 0; }
  .cal-month .cal-chip .dot, .cal-month .cal-chip .tt, .cal-month .cal-chip .tm { display: none; }
  .cal-more { width: auto; padding: 0; height: 8px; font-size: 9px; line-height: 8px; text-align: center; pointer-events: none; }
  .cal-more .long { display: none; }
  .cal-panel { display: block; }
  .cal-wk { --gut: 30px; --hh: 44px; }
  .cal-wk .cal-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .cal-wk .cal-sticky, .cal-wk .cal-hours { min-width: 560px; }
  .cal-wh .dwl { display: none; }
  .cal-wh .dws { display: block; }
  .cal-wh .dn { min-width: 24px; height: 24px; font-size: 15px; border-radius: 12px; }
  .cal-ad-l { display: none; }
  .cal-gut span { right: 3px; font-size: 9px; }
  .cal-ev { padding: 1px 3px; font-size: 10px; border-left-width: 2px; }
  .cal-ev span { display: none; }
  .cal-time { width: 62px; }
  .cal-f > label { min-width: 52px; }
}
`
  const css = () => {
    if (document.getElementById('cal-css')) return
    const st = document.createElement('style')
    st.id = 'cal-css'
    st.textContent = CSS
    document.head.append(st)
  }

  /* ---------- dates ---------- */

  const isCal = () => typeof env !== 'undefined' && env === 'calendar'
  const pad = n => String(n).padStart(2, '0')
  const sod = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const parseYmd = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d) }
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const fmtTime = d => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const short = d => { const h = d.getHours(), m = d.getMinutes(); return `${h % 12 || 12}${m ? ':' + pad(m) : ''}${h < 12 ? 'a' : 'p'}` }
  const dfmt = (d, o) => d.toLocaleDateString(undefined, o)
  const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const phone = () => matchMedia('(max-width: 720px)').matches

  function init() {
    if (K.ready) return
    K.ready = true
    document.getElementById('q')?.addEventListener('input', () => isCal() && render())
    const m = store.get('cal-mode', 'month')
    if (SEG.some(s => s[0] === m)) K.mode = m
    try { K.hidden = new Set(JSON.parse(store.get('cal-hidden', '[]'))) } catch {}
    K.cur = sod(new Date())
    K.sel = sod(new Date())
  }

  function viewRange() {
    const c = K.cur
    if (K.mode === 'week') { const s = addDays(sod(c), -c.getDay()); return [s, addDays(s, 7)] }
    if (K.mode === 'agenda') { const s = sod(c); return [s, addDays(s, AGENDA_DAYS)] }
    const first = new Date(c.getFullYear(), c.getMonth(), 1)
    const s = addDays(first, -first.getDay())
    const weeks = Math.ceil((first.getDay() + new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate()) / 7)
    return [s, addDays(s, weeks * 7)]
  }

  function titleText() {
    const [s, e] = viewRange()
    if (K.mode === 'month') return dfmt(K.cur, { month: 'long', year: 'numeric' })
    const last = addDays(e, -1)
    const sameYear = s.getFullYear() === last.getFullYear()
    const a = dfmt(s, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
    const b = s.getMonth() === last.getMonth() ? `${last.getDate()}, ${last.getFullYear()}` : dfmt(last, { month: 'short', day: 'numeric', year: 'numeric' })
    return `${a} – ${b}`
  }

  /* ---------- data ---------- */

  const safeColor = c => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c || '') ? c : '#007aff')
  function ink(c) {
    let h = c.slice(1)
    if (h.length === 3) h = h.split('').map(x => x + x).join('')
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
    return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#000' : '#fff'
  }

  function prep(list, q) {
    const cals = Object.fromEntries((K.data?.calendars || []).map(c => [c.id, c]))
    const out = []
    for (const ev of list) {
      if (K.hidden.has(ev.calId)) continue
      const c = cals[ev.calId] || {}
      const s = ev.allDay ? parseYmd(ev.start) : new Date(ev.start)
      const e = ev.allDay ? parseYmd(ev.end) : new Date(ev.end)
      if (isNaN(s) || isNaN(e)) continue
      const hay = [ev.title, ev.location, ev.notes, c.label].join(' ').toLowerCase()
      if (q && !hay.includes(q)) continue
      out.push({ ...ev, s, e, color: safeColor(c.color), calLabel: c.label || '', hay })
    }
    return out
  }

  // day key -> events overlapping that day, all-day and multi-day first.
  function bucket(evs, from, to) {
    const map = new Map()
    for (const ev of evs) {
      const end = Math.max(ev.e.getTime(), ev.s.getTime() + 1)
      let d = sod(ev.s)
      if (d < from) d = from
      for (; d < to && d.getTime() < end; d = addDays(d, 1)) {
        const k = ymd(d)
        if (!map.has(k)) map.set(k, [])
        map.get(k).push(ev)
      }
    }
    for (const list of map.values()) list.sort((a, b) => (b.allDay - a.allDay) || (a.s - b.s) || (b.e - b.s) - (a.e - a.s) || a.title.localeCompare(b.title))
    return map
  }

  async function load(force) {
    init()
    if (K.loading) { if (!force) return K.loading; await K.loading }
    const [from, to] = viewRange()
    const want = [addDays(from, -35), addDays(to, 35)]
    K.loading = (async () => {
      const qs = `?from=${encodeURIComponent(want[0].toISOString())}&to=${encodeURIComponent(want[1].toISOString())}`
      try {
        K.data = force ? await api('/api/calendar/refresh' + qs, {}) : await api('/api/calendar/state' + qs)
        K.cover = [want[0].getTime(), want[1].getTime()]
        K.err = ''
      } catch (e) {
        K.err = e.message
      }
      K.t = Date.now()
      K.loading = null
      if (isCal()) render()
    })()
    return K.loading
  }
  const reload = () => { K.t = 0; K.cover = null; return load() }
  const post = (path, body) => api('/api/calendar/' + path, body)

  /* ---------- views ---------- */

  const chip = ev => {
    const style = `--c:${ev.color};--ink:${ink(ev.color)}`
    return `<button class="cal-chip ${ev.allDay ? 'all' : 'timed'}" style="${style}" data-cal="open" data-id="${esc(ev.id)}" data-menu="cal-event" data-hay="${esc(ev.hay)}" title="${esc(ev.title)}">${ev.allDay ? '' : '<i class="dot"></i>'}<span class="tt">${esc(ev.title)}</span>${ev.allDay ? '' : `<span class="tm">${short(ev.s)}</span>`}</button>`
  }

  function header() {
    const i = SEG.findIndex(s => s[0] === K.mode)
    return `<div class="cal-bar">
      <div class="cal-nav"><button class="cal-pill" data-cal="today">Today</button><button class="cal-ic" data-cal="prev" aria-label="Previous">${CHEV_L}</button><button class="cal-ic" data-cal="next" aria-label="Next">${CHEV_R}</button></div>
      <h2 class="cal-title">${esc(titleText())}</h2>
      <div class="cal-tools"><div class="seg cal-seg" role="tablist" style="--n:3;--i:${i}"><span class="seg-thumb"></span>${SEG.map(([k, l]) => `<button role="tab" data-cal="mode" data-v="${k}" aria-pressed="${k === K.mode}">${l}</button>`).join('')}</div>
        ${K.data?.quickAdd ? '<button class="cal-pill" data-cal="quick">Quick Add</button>' : ''}<button class="cal-ic fill" data-cal="new" aria-label="New event">${PLUS}</button></div>
    </div>`
  }

  function monthView(byDay, from, to) {
    const today = sod(new Date())
    const weeks = Math.round((to - from) / 86_400_000 / 7)
    if (!K.sel || K.sel.getMonth() !== K.cur.getMonth() || K.sel.getFullYear() !== K.cur.getFullYear()) {
      K.sel = today.getMonth() === K.cur.getMonth() && today.getFullYear() === K.cur.getFullYear() ? today : new Date(K.cur.getFullYear(), K.cur.getMonth(), 1)
    }
    const dow = [...Array(7)].map((_, i) => `<span>${esc(dfmt(addDays(from, i), { weekday: 'short' }))}</span>`).join('')
    let cells = ''
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(from, i)
      const k = ymd(d)
      const list = byDay.get(k) || []
      const show = list.slice(0, 3)
      const left = list.length - show.length
      const label = d.getDate() === 1 ? `<span class="mo">${esc(dfmt(d, { month: 'short' }))}&nbsp;</span>1` : String(d.getDate())
      const cls = [d.getMonth() !== K.cur.getMonth() ? 'out' : '', sameDay(d, today) ? 'today' : '', sameDay(d, K.sel) ? 'sel' : '', i >= (weeks - 1) * 7 ? 'last' : ''].filter(Boolean).join(' ')
      cells += `<div class="cal-day ${cls}" data-cal="day" data-day="${k}" data-menu="cal-day" role="button" tabindex="0" aria-label="${esc(dfmt(d, { weekday: 'long', month: 'long', day: 'numeric' }))}">
        <span class="cal-num">${label}</span>
        <div class="cal-chips">${show.map(chip).join('')}${left > 0 ? `<button class="cal-more" data-cal="more" data-day="${k}">+${left}<span class="long"> more</span></button>` : ''}</div></div>`
    }
    const sel = K.sel
    const selList = byDay.get(ymd(sel)) || []
    const panel = `<section class="group cal-panel"><div class="group-head"><h2>${esc(dfmt(sel, { weekday: 'long', month: 'short', day: 'numeric' }))}</h2><button class="more" data-cal="addsel">New Event</button></div>
      <div class="list">${selList.length ? selList.map(ev => eventRow(ev, sel)).join('') : '<div class="empty">No events</div>'}</div></section>`
    return `<div class="cal-card"><div class="cal-dow">${dow}</div><div class="cal-month">${cells}</div></div>${panel}`
  }

  // Greedy column layout so overlapping events sit side by side.
  function layoutDay(items) {
    items.sort((a, b) => a.a - b.a || b.b - a.b)
    const out = []
    let cluster = []
    let clusterEnd = -1
    let cols = []
    const flush = () => { for (const it of cluster) { it.n = cols.length; out.push(it) }; cluster = []; cols = []; clusterEnd = -1 }
    for (const it of items) {
      if (it.a >= clusterEnd && cluster.length) flush()
      let c = cols.findIndex(end => end <= it.a)
      if (c < 0) { c = cols.length; cols.push(0) }
      cols[c] = it.b
      it.c = c
      cluster.push(it)
      clusterEnd = Math.max(clusterEnd, it.b)
    }
    flush()
    return out
  }

  function weekView(byDay, from) {
    const now = new Date()
    const days = [...Array(7)].map((_, i) => addDays(from, i))
    const head = days.map(d => `<div class="cal-wh${sameDay(d, now) ? ' today' : ''}"><span class="dwl">${esc(dfmt(d, { weekday: 'short' }))}</span><span class="dws">${esc(dfmt(d, { weekday: 'narrow' }))}</span><span class="dn">${d.getDate()}</span></div>`).join('')
    const long = ev => !ev.allDay && ev.e - ev.s >= 86_400_000
    const allday = days.map(d => `<div class="cal-ad" data-cal="slotall" data-day="${ymd(d)}" data-menu="cal-day">${(byDay.get(ymd(d)) || []).filter(ev => ev.allDay || long(ev)).map(chip).join('')}</div>`).join('')
    const lines = [...Array(24)].map((_, h) => `<i class="cal-hl" style="top:calc(var(--hh) * ${h})"></i>`).join('')
    const gut = [...Array(24)].map((_, h) => (h ? `<span style="top:calc(var(--hh) * ${h})">${h % 12 || 12}${h < 12 ? ' AM' : ' PM'}</span>` : '')).join('')
    const cols = days.map(d => {
      const a0 = d.getTime()
      const a1 = addDays(d, 1).getTime()
      const items = (byDay.get(ymd(d)) || []).filter(ev => !ev.allDay && !long(ev)).map(ev => ({ ev, a: (Math.max(ev.s, a0) - a0) / 3_600_000, b: (Math.min(Math.max(ev.e, ev.s.getTime() + 1), a1) - a0) / 3_600_000 }))
      const blocks = layoutDay(items).map(it => {
        const h = Math.max(it.b - it.a, 0.42)
        const w = 100 / it.n
        const ev = it.ev
        return `<button class="cal-ev" style="--c:${ev.color};top:calc(var(--hh) * ${it.a.toFixed(3)});height:calc(var(--hh) * ${h.toFixed(3)} - 1px);left:${(it.c * w).toFixed(2)}%;width:calc(${w.toFixed(2)}% - 2px)" data-cal="open" data-id="${esc(ev.id)}" data-menu="cal-event" data-hay="${esc(ev.hay)}" title="${esc(ev.title)}"><b>${esc(ev.title)}</b>${h >= 0.7 ? `<span>${esc(fmtTime(ev.s))}${ev.e > ev.s ? ` – ${esc(fmtTime(ev.e))}` : ''}</span>` : ''}</button>`
      }).join('')
      const nowLine = sameDay(d, now) ? `<i class="cal-now" style="top:calc(var(--hh) * ${((now - a0) / 3_600_000).toFixed(3)})"></i>` : ''
      return `<div class="cal-col${sameDay(d, now) ? ' today' : ''}" data-cal="slot" data-day="${ymd(d)}" data-menu="cal-day">${blocks}${nowLine}</div>`
    }).join('')
    return `<div class="cal-card cal-wk"><div class="cal-scroll">
      <div class="cal-sticky"><div class="cal-row"><div></div>${head}</div><div class="cal-row"><div class="cal-ad-l">all-day</div>${allday}</div></div>
      <div class="cal-hours">${lines}<div class="cal-gut">${gut}</div>${cols}</div></div></div>`
  }

  function eventRow(ev, day) {
    let t1, t2 = ''
    if (ev.allDay) t1 = 'all-day'
    else {
      const d1 = addDays(day, 1)
      t1 = ev.s >= day ? fmtTime(ev.s) : 'Continues'
      if (ev.e > ev.s && ev.e < d1) t2 = fmtTime(ev.e)
    }
    const sub = [ev.location, ev.calLabel].filter(Boolean).join(' · ')
    return `<div class="row" data-hay="${esc(ev.hay)}" data-menu="cal-event" data-id="${esc(ev.id)}">
      <button class="row-line tap" style="min-height:56px" data-cal="open" data-id="${esc(ev.id)}">
        <span class="cal-time">${esc(t1)}${t2 ? `<small>${esc(t2)}</small>` : ''}</span><span class="cal-stripe" style="--c:${ev.color}"></span>
        <span class="txt"><div class="t1">${esc(ev.title)}</div>${sub ? `<div class="t2">${esc(sub)}</div>` : ''}</span></button></div>`
  }

  function agendaView(byDay, from, to) {
    const today = sod(new Date())
    let html = ''
    for (let d = from; d < to; d = addDays(d, 1)) {
      const list = byDay.get(ymd(d))
      if (!list?.length) continue
      const rel = sameDay(d, today) ? 'Today · ' : sameDay(d, addDays(today, 1)) ? 'Tomorrow · ' : sameDay(d, addDays(today, -1)) ? 'Yesterday · ' : ''
      html += group('cal-' + ymd(d), esc(rel + dfmt(d, { weekday: 'long', month: 'short', day: 'numeric' })), '', list.map(ev => eventRow(ev, d)))
    }
    return html || `<div class="list" style="margin-bottom:30px"><div class="empty">${$('#q')?.value.trim() ? 'No events match your search.' : `Nothing scheduled in these ${AGENDA_DAYS} days.`}<br><button class="link-btn" data-cal="new">New Event</button></div></div>`
  }

  // Where each calendar comes from. The hub never shows a feed address or key, only these labels.
  const PROV = {
    local: { label: 'On this hub' },
    google: {
      label: 'Google', color: '#4285f4', field: 'calendars[].icsUrl', what: 'secret iCal address',
      steps: ['In Google Calendar open <b>Settings</b>, then pick your calendar on the left.', 'Under <b>Integrate calendar</b>, copy the <b>Secret address in iCal format</b>.'],
      snip: '"calendars": [{ "label": "Personal", "icsUrl": "PASTE-THE-SECRET-ADDRESS" }]',
    },
    outlook: {
      label: 'Outlook', color: '#0a64d6', field: 'calendars[].icsUrl', what: 'published ICS link',
      steps: ['In Outlook on the web open <b>Settings</b>, then <b>Calendar</b>, then <b>Shared calendars</b>.', 'Under <b>Publish a calendar</b>, pick a calendar, choose <b>Can view all details</b>, press <b>Publish</b> and copy the <b>ICS</b> link.'],
      snip: '"calendars": [{ "label": "Work", "icsUrl": "PASTE-THE-ICS-LINK" }]',
    },
    icloud: {
      label: 'iCloud', color: '#ff3b30', field: 'calendars[].icsUrl', what: 'public calendar link',
      steps: ['In the Calendar app (or iCloud.com), press the share button next to the calendar.', 'Turn on <b>Public Calendar</b> and copy the link. A webcal:// link works as is.'],
      snip: '"calendars": [{ "label": "Family", "icsUrl": "PASTE-THE-PUBLIC-LINK" }]',
    },
    ics: { label: 'Calendar feed', color: '#34c759' },
    file: { label: 'Server calendar', color: '#34c759' },
    calcom: {
      label: 'Cal.com', color: '#8e8e93', field: 'calcom.apiKey', what: 'API key',
      steps: ['In Cal.com open <b>Settings</b>, then <b>Developer</b>, then <b>API Keys</b>.', 'Make a key and copy it. The hub only reads bookings and event types with it.'],
      snip: '"calcom": { "apiKey": "PASTE-THE-API-KEY" }',
    },
  }
  const synced = at => (at ? ago(at).replace(/^Updated/, 'Synced') : '')

  function calendarsGroup() {
    const cals = K.data?.calendars || []
    if (!cals.length) return ''
    const rows = cals.map(c => {
      const on = !K.hidden.has(c.id)
      const sub = c.error ? `Couldn’t load: ${c.error}` : [PROV[c.provider || c.source]?.label || PROV.ics.label, synced(c.at)].filter(Boolean).join(' · ')
      return `<div class="row"><button class="row-line tap" style="min-height:52px" data-cal="toggle" data-id="${esc(c.id)}" aria-pressed="${on}">
        <span class="cal-check${on ? ' on' : ''}" style="--c:${safeColor(c.color)}">${CHECK}</span>
        <span class="txt"><div class="t1">${esc(c.label)}</div><div class="t2"${c.error ? ' style="color:var(--red)"' : ''}>${esc(sub)}</div></span></button></div>`
    })
    return group('cal-cals', 'Calendars', '', rows)
  }

  function typesGroup() {
    const types = K.data?.eventTypes || []
    const rows = types.map(t => `<div class="row"><div class="row-line" style="min-height:52px"><span class="txt"><div class="t1">${esc(t.title)}</div><div class="t2">${esc([t.minutes ? `${t.minutes} min` : '', t.link ? t.link.replace(/^https:\/\//, '') : 'No booking link'].filter(Boolean).join(' · '))}</div></span>
      ${t.link ? `<a class="icon-btn" href="${esc(t.link)}" target="_blank" rel="noopener" aria-label="Open booking page">${ICON.open || '↗'}</a><button class="icon-btn" data-copy="${esc(t.link)}" aria-label="Copy booking link">${ICON.copy}</button>` : ''}</div></div>`)
    return group('cal-types', 'Cal.com Event Types', '', rows)
  }

  // One row per provider: connected ones say when they last synced, the rest open the steps.
  function connectCard() {
    if (!K.data) return ''
    const cals = K.data.calendars || []
    // A hub whose calendars are already set up doesn't ask for more.
    if (cals.some(c => c.source === 'file')) return ''
    const rows = ['google', 'outlook', 'icloud', 'calcom'].map(p => {
      const mine = cals.filter(c => c.provider === p)
      const bad = mine.find(c => c.error)
      const last = Math.max(0, ...mine.map(c => c.at || 0))
      const sub = !mine.length ? `Not connected · add the ${PROV[p].what}` : bad ? `Couldn’t load: ${bad.error}` : [`Connected${mine.length > 1 ? ` · ${mine.length} calendars` : ''}`, synced(last)].filter(Boolean).join(' · ')
      return `<div class="row"><button class="row-line tap" style="min-height:52px" data-cal="connect" data-p="${p}">
        <span class="cal-prov" style="--c:${PROV[p].color}"></span>
        <span class="txt"><div class="t1">${PROV[p].label}</div><div class="t2"${bad ? ' style="color:var(--red)"' : mine.length ? ' style="color:var(--green)"' : ''}>${esc(sub)}</div></span>${ICON.chev}</button></div>`
    })
    return group('cal-connect', 'Connect Calendars', 'Keys and addresses stay on this computer. The hub reads them and never shows them.', rows)
  }

  /* ---------- sheets ---------- */

  const topScrim = el => [...document.querySelectorAll('.scrim')].at(-1) === el

  function sheet(bar, body, { onKey, closeOnScrim } = {}) {
    const scrim = overlay(`<div class="sheet-bar">${bar}</div><div class="sheet-body cal-form">${body}</div>`, 'sheet')
    const close = () => { scrim.remove(); document.removeEventListener('keydown', key, true) }
    const key = e => {
      if (!topScrim(scrim) || document.querySelector('.alert')) return
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); (onKey ? onKey(e) : close()) }
    }
    document.addEventListener('keydown', key, true)
    if (closeOnScrim) scrim.addEventListener('click', e => { if (e.target === scrim) close() })
    return { scrim, close }
  }

  const linkify = s => esc(s).replace(/https?:\/\/[^\s<]*[^\s<.,;:!?)\]]/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)

  function whenLines(ev) {
    const long = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
    const med = { weekday: 'short', month: 'short', day: 'numeric' }
    if (ev.allDay) {
      const last = addDays(ev.e, -1)
      return sameDay(ev.s, last) ? [dfmt(ev.s, long), 'All day'] : [`${dfmt(ev.s, med)} – ${dfmt(last, { ...med, year: 'numeric' })}`, 'All day']
    }
    if (sameDay(ev.s, new Date(Math.max(ev.s, ev.e - 1)))) return [dfmt(ev.s, long), ev.e > ev.s ? `${fmtTime(ev.s)} – ${fmtTime(ev.e)}` : fmtTime(ev.s)]
    return [`${dfmt(ev.s, med)}, ${fmtTime(ev.s)}`, `to ${dfmt(ev.e, med)}, ${fmtTime(ev.e)}`]
  }

  function detail(ev) {
    const [l1, l2] = whenLines(ev)
    const body = `<div class="cal-d-title">${esc(ev.title)}</div>
      <div class="cal-d-cal" style="--c:${ev.color}"><i></i>${esc(ev.calLabel)}${ev.readonly ? ' · read-only' : ''}</div>
      <div class="list"><div class="cal-d-row">${esc(l1)}<small style="margin:2px 0 0">${esc(l2)}</small></div>
        ${ev.location ? `<div class="cal-d-row"><small>Location</small>${esc(ev.location)}</div>` : ''}
        ${ev.meetingUrl ? `<div class="cal-d-row"><small>Meeting</small><a href="${esc(ev.meetingUrl)}" target="_blank" rel="noopener">${esc(ev.meetingUrl.replace(/^https:\/\//, ''))}</a></div>` : ''}
        ${ev.attendees?.length ? `<div class="cal-d-row"><small>${ev.attendees.length > 1 ? 'Attendees' : 'Attendee'}</small>${ev.attendees.map(esc).join('<br>')}</div>` : ''}
        ${ev.notes ? `<div class="cal-d-row"><small>Notes</small><div class="cal-d-notes">${linkify(ev.notes)}</div></div>` : ''}</div>
      ${ev.readonly ? '' : '<div class="list"><button class="cal-d-act" data-a="delete">Delete Event</button></div>'}`
    const { scrim, close } = sheet(`${ev.readonly ? '<span></span>' : '<button class="bar-btn" data-a="edit">Edit</button>'}<h3>Event</h3><button class="bar-btn" data-a="close">Done</button>`, body, { closeOnScrim: true })
    scrim.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a
      if (a === 'close') close()
      else if (a === 'edit') { close(); editor({ ev }) }
      else if (a === 'delete') { if (await removeEvent(ev)) close() }
    })
  }

  async function removeEvent(ev) {
    if (!(await alertBox({ title: `Delete “${ev.title}”?`, message: 'It is removed from the local calendar.', ok: 'Delete', danger: true }))) return false
    try {
      await post(`events/${encodeURIComponent(ev.id)}/delete`, {})
      hud('Event deleted')
      reload()
      return true
    } catch (e) { showError(e); return false }
  }

  async function duplicate(ev) {
    try {
      await post('events', { title: ev.title, allDay: ev.allDay, start: ev.start, end: ev.end, location: ev.location, notes: ev.notes })
      hud('Event duplicated')
      reload()
    } catch (e) { showError(e) }
  }

  function daySheet(day) {
    const evs = prep(K.data?.events || [], '')
    const list = bucket(evs, day, addDays(day, 1)).get(ymd(day)) || []
    for (const ev of list) K.byId[ev.id] ||= ev
    const body = `<div class="list">${list.length ? list.map(ev => eventRow(ev, day)).join('') : '<div class="empty">No events</div>'}</div>`
    const { scrim, close } = sheet(`<button class="bar-btn" data-a="new">New</button><h3>${esc(dfmt(day, { weekday: 'short', month: 'short', day: 'numeric' }))}</h3><button class="bar-btn" data-a="close">Done</button>`, body, { closeOnScrim: true })
    scrim.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a
      if (a === 'close') close()
      else if (a === 'new') { close(); editor({ day }) }
      const open = e.target.closest('[data-cal=open]')
      if (open && K.byId[open.dataset.id]) detail(K.byId[open.dataset.id])
    })
  }

  function editor({ ev, day, start, allDay: wantAllDay }) {
    const now = new Date()
    let s, e, allDay
    if (ev) {
      allDay = ev.allDay
      s = ev.s
      e = ev.allDay ? addDays(ev.e, -1) : ev.e
    } else {
      allDay = !!wantAllDay
      if (start) { s = start; e = new Date(start.getTime() + 3_600_000) }
      else {
        const d = day || sod(now)
        s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sameDay(d, now) ? Math.min(23, now.getHours() + 1) : 9, 0)
        e = new Date(s.getTime() + 3_600_000)
      }
      if (allDay) { s = sod(s); e = sod(s) }
    }
    const body = `<div class="list">
        <div class="cal-f"><input type="text" name="title" placeholder="Title" maxlength="200" autocomplete="off" value="${esc(ev?.title || '')}"></div>
        <div class="cal-f"><input type="text" name="location" placeholder="Location" maxlength="300" autocomplete="off" value="${esc(ev?.location || '')}"></div></div>
      <div class="list">
        <div class="cal-f"><label>All-day</label><span class="cal-sw"><input type="checkbox" name="allDay"${allDay ? ' checked' : ''}><i></i></span></div>
        <div class="cal-f"><label>Starts</label><span class="pick"><input type="date" name="sd" value="${ymd(s)}"><input type="time" name="st" value="${hhmm(s)}"></span></div>
        <div class="cal-f"><label>Ends</label><span class="pick"><input type="date" name="ed" value="${ymd(e)}"><input type="time" name="et" value="${hhmm(e)}"></span></div></div>
      <div class="list"><div class="cal-f"><textarea name="notes" placeholder="Notes" maxlength="5000">${esc(ev?.notes || '')}</textarea></div></div>
      <div class="cal-err" hidden></div>`
    const { scrim, close } = sheet(`<button class="bar-btn" data-a="cancel">Cancel</button><h3>${ev ? 'Edit Event' : 'New Event'}</h3><button class="bar-btn" data-a="save">${ev ? 'Save' : 'Add'}</button>`, body, { onKey: () => cancel() })
    const f = n => scrim.querySelector(`[name=${n}]`)
    const err = scrim.querySelector('.cal-err')
    const fail = msg => { err.textContent = msg; err.hidden = !msg }
    const snapshot = () => JSON.stringify(['title', 'location', 'notes', 'sd', 'st', 'ed', 'et'].map(n => f(n).value).concat(f('allDay').checked))
    let before = ''
    const getS = () => new Date(`${f('sd').value}T${f('allDay').checked ? '00:00' : f('st').value || '00:00'}`)
    const getE = () => new Date(`${f('ed').value}T${f('allDay').checked ? '00:00' : f('et').value || f('st').value || '00:00'}`)
    let dur = getE() - getS()
    const sync = () => { f('st').hidden = f('et').hidden = f('allDay').checked }
    sync()
    before = snapshot()
    const cancel = async () => {
      if (snapshot() === before || (await alertBox({ title: 'Discard this event?', message: 'Your changes haven’t been saved.', ok: 'Discard', danger: true }))) close()
    }
    const setEnd = d => { f('ed').value = ymd(d); f('et').value = hhmm(d) }
    for (const n of ['sd', 'st']) f(n).addEventListener('change', () => {
      const ns = getS()
      if (isNaN(ns)) return
      if (f('allDay').checked) { if (getE() < ns) f('ed').value = f('sd').value } else setEnd(new Date(ns.getTime() + Math.max(0, dur)))
    })
    for (const n of ['ed', 'et']) f(n).addEventListener('change', () => { const d = getE() - getS(); if (!isNaN(d)) dur = d })
    f('allDay').addEventListener('change', () => {
      sync()
      if (f('allDay').checked) { if (f('ed').value < f('sd').value) f('ed').value = f('sd').value }
      else { if (!f('st').value) f('st').value = '09:00'; if (!f('et').value || f('ed').value === f('sd').value) { const ns = getS(); setEnd(new Date(ns.getTime() + 3_600_000)) } dur = getE() - getS() }
    })
    async function save() {
      fail('')
      const title = f('title').value.trim()
      if (!title) { fail('Add a title.'); return f('title').focus() }
      const sd = f('sd').value
      if (!sd) return fail('Pick a start date.')
      const body = { title, location: f('location').value.trim(), notes: f('notes').value, allDay: f('allDay').checked }
      if (body.allDay) {
        const ed = f('ed').value || sd
        if (ed < sd) return fail('The event ends before it starts.')
        body.start = sd
        body.end = ymd(addDays(parseYmd(ed), 1))
      } else {
        const a = getS(), b = getE()
        if (isNaN(a) || isNaN(b)) return fail('Check the start and end times.')
        if (b < a) return fail('The event ends before it starts.')
        body.start = a.toISOString()
        body.end = b.toISOString()
      }
      const btn = scrim.querySelector('[data-a=save]')
      btn.disabled = true
      try {
        await (ev ? post(`events/${encodeURIComponent(ev.id)}`, body) : post('events', body))
        hud(ev ? 'Event saved' : 'Event added')
        close()
        reload()
      } catch (x) {
        btn.disabled = false
        fail(x.message)
      }
    }
    scrim.addEventListener('click', e2 => {
      const a = e2.target.closest('[data-a]')?.dataset.a
      if (a === 'cancel') cancel()
      else if (a === 'save') save()
    })
    scrim.addEventListener('keydown', e2 => { if (e2.key === 'Enter' && e2.target.tagName === 'INPUT' && e2.target.type !== 'checkbox') { e2.preventDefault(); save() } })
    f('title').focus()
  }

  // Plain words ("Dentist tue 3pm 1h"); the server's calendar tool reads them and refuses what it can't.
  function quickAdd() {
    const body = `<div class="list"><div class="cal-f"><input type="text" name="quick" placeholder="Dentist tue 3pm 1h" maxlength="200" autocomplete="off" aria-label="What and when"></div></div>
      <div class="cal-err" hidden></div>`
    const { scrim, close } = sheet('<button class="bar-btn" data-a="cancel">Cancel</button><h3>Quick Add</h3><button class="bar-btn" data-a="save">Add</button>', body, { closeOnScrim: true })
    const input = scrim.querySelector('[name=quick]'), err = scrim.querySelector('.cal-err'), btn = scrim.querySelector('[data-a=save]')
    const fail = msg => { err.textContent = msg; err.hidden = !msg }
    async function save() {
      if (btn.disabled) return
      fail('')
      if (!input.value.trim()) { fail('Type what it is and when.'); return input.focus() }
      btn.disabled = true
      btn.textContent = 'Adding…'
      try {
        const r = await post('quick', { text: input.value })
        if (r.ok === false) throw new Error(r.message)
        hud(r.message || 'Event added')
        close()
        reload()
      } catch (x) {
        btn.disabled = false
        btn.textContent = 'Add'
        fail(x.message)
      }
    }
    scrim.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a
      if (a === 'cancel') close()
      else if (a === 'save') save()
    })
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save() } })
    input.focus()
  }

  /* ---------- events ---------- */

  function go(dir) {
    const c = K.cur
    K.cur = K.mode === 'month' ? new Date(c.getFullYear(), c.getMonth() + dir, 1) : addDays(c, (K.mode === 'week' ? 7 : AGENDA_DAYS) * dir)
    render()
  }

  document.addEventListener('click', e => {
    if (!isCal() || e.target.closest('.scrim, .menu')) return
    if (typeof suppressClick !== 'undefined' && suppressClick) return
    const el = e.target.closest('[data-cal]')
    if (!el || !el.closest('#main')) return
    init()
    const a = el.dataset.cal
    if (a === 'today') { K.cur = sod(new Date()); K.sel = sod(new Date()); render() }
    else if (a === 'prev') go(-1)
    else if (a === 'next') go(1)
    else if (a === 'mode') {
      K.mode = el.dataset.v
      store.set('cal-mode', K.mode)
      K.scroll = null
      render()
    } else if (a === 'new') editor({ day: K.mode === 'month' ? K.sel : sod(new Date()) })
    else if (a === 'quick') quickAdd()
    else if (a === 'addsel') editor({ day: K.sel })
    else if (a === 'open') { const ev = K.byId[el.dataset.id]; if (ev) detail(ev) }
    else if (a === 'more') daySheet(parseYmd(el.dataset.day))
    else if (a === 'day') {
      const d = parseYmd(el.dataset.day)
      if (phone()) { K.sel = d; render() } else editor({ day: d })
    } else if (a === 'slotall') editor({ day: parseYmd(el.dataset.day), allDay: true })
    else if (a === 'slot') {
      const r = el.getBoundingClientRect()
      const hours = Math.floor(((e.clientY - r.top) / r.height) * 48) / 2
      const d = parseYmd(el.dataset.day)
      editor({ start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(hours), (hours % 1) * 60) })
    } else if (a === 'connect') window.HUB_CONNECT?.(el.dataset.p === 'calcom' ? 'calcom' : 'calendar-feed')
    else if (a === 'toggle') {
      const id = el.dataset.id
      K.hidden.has(id) ? K.hidden.delete(id) : K.hidden.add(id)
      store.set('cal-hidden', JSON.stringify([...K.hidden]))
      render()
    }
  })

  document.addEventListener('keydown', e => {
    if (!isCal() || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.scrim, .menu')) return
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
    init()
    const k = e.key
    if (k === 'ArrowLeft') { e.preventDefault(); go(-1) }
    else if (k === 'ArrowRight') { e.preventDefault(); go(1) }
    else if (k === 't') { K.cur = sod(new Date()); K.sel = sod(new Date()); render() }
    else if (k === 'n') { e.preventDefault(); editor({ day: K.mode === 'month' ? K.sel : sod(new Date()) }) }
    else if ((k === 'm' || k === 'w' || k === 'a') && !e.shiftKey) {
      K.mode = { m: 'month', w: 'week', a: 'agenda' }[k]
      store.set('cal-mode', K.mode)
      K.scroll = null
      render()
    } else if (k === 'Enter' && e.target.dataset?.cal === 'day') e.target.click()
  })

  document.addEventListener('scroll', e => { if (e.target.classList?.contains('cal-scroll')) K.scroll = e.target.scrollTop }, true)

  /* ---------- tab ---------- */

  ;(window.TABS ||= {}).calendar = {
    title: 'Calendar',
    search: 'Search events',
    render() {
      css()
      init()
      const [from, to] = viewRange()
      const covered = K.cover && K.cover[0] <= from.getTime() && K.cover[1] >= to.getTime()
      const stale = Date.now() - K.t > 60_000
      if (!K.loading && (!covered || stale) && !(K.err && Date.now() - K.t < 15_000)) setTimeout(() => load(), 0)
      const q = ($('#q')?.value || '').trim().toLowerCase()
      const evs = prep(K.data?.events || [], q)
      K.byId = Object.fromEntries(evs.map(ev => [ev.id, ev]))
      const byDay = bucket(evs, from, to)
      let h = header()
      if (K.err) h += `<div class="notice err">Can’t load the calendar: ${esc(K.err)}</div>`
      if (!K.data) h += K.err ? '' : '<div class="empty">Loading your calendar…</div>'
      else h += K.mode === 'month' ? monthView(byDay, from, to) : K.mode === 'week' ? weekView(byDay, from) : agendaView(byDay, from, to)
      h += calendarsGroup() + typesGroup() + connectCard()
      if (K.mode === 'week') requestAnimationFrame(() => {
        const el = document.querySelector('.cal-scroll')
        if (!el) return
        const hh = parseFloat(getComputedStyle(el.parentElement).getPropertyValue('--hh')) || 48
        el.scrollTop = K.scroll ?? hh * 7
      })
      return h
    },
    load,
    menu(row, x, y) {
      init()
      const t = row.dataset.menu
      if (t === 'cal-event') {
        const ev = K.byId[row.dataset.id]
        if (!ev) return false
        const items = [{ label: 'Show Details', icon: MI.info, run: () => detail(ev) }]
        if (!ev.readonly) items.push({ label: 'Edit…', icon: MI.edit, run: () => editor({ ev }) }, { label: 'Duplicate', icon: MI.copy, run: () => duplicate(ev) })
        items.push({ label: 'Copy Title', icon: MI.copy, run: () => copy(ev.title, 'Title copied') })
        if (!ev.readonly) items.push('-', { label: 'Delete', icon: MI.trash, danger: true, run: () => removeEvent(ev) })
        showMenu(x, y, ev.title, items)
        return true
      }
      if (t === 'cal-day') {
        const d = parseYmd(row.dataset.day)
        showMenu(x, y, dfmt(d, { weekday: 'long', month: 'long', day: 'numeric' }), [
          { label: 'New Event…', icon: MI.edit, run: () => editor({ day: d }) },
          { label: 'New All-Day Event…', icon: MI.edit, run: () => editor({ day: d, allDay: true }) },
        ])
        return true
      }
      return false
    },
    ago() {
      if (!K.t) return K.loading ? 'Loading…' : ''
      return ago(K.t) + (K.loading ? ' · refreshing' : '')
    },
  }
})()
