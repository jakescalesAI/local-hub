// Cloud tab: Coolify deploys, live servers, Cloudflare and active clients. Read-only.
// Loaded before index.html's main script; uses its globals (render, widget, group, esc, ago,
// api, showMenu, copy, alertBox, MI, ICON, expanded, env) only at call time.
;(() => {
  const C = { s: null, err: '', loading: null, t: 0, items: {}, poll: 0 }
  const COL = { ok: 'var(--green)', warn: 'var(--orange)', down: 'var(--red)', off: 'var(--gray)', info: 'var(--blue)' }
  const CSS = `
.cl-h { display: flex; align-items: baseline; gap: 8px; margin: 40px 4px 12px; font: 700 22px/1.2 var(--display); letter-spacing: .005em; }
.cl-h.first { margin-top: 0; }
.cl-h small { font: 400 15px var(--font); color: var(--label-2); letter-spacing: -0.01em; }
.cl-pill { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 6px; background: var(--fill); color: var(--label-2); font-size: 12px; font-weight: 500; letter-spacing: -0.003em; vertical-align: 2px; }
.cl-wrap .t1, .cl-wrap .t2 { white-space: normal; overflow: visible; }
.cl-wrap .status { align-self: flex-start; margin-top: 5px; }
.cl-t3 { white-space: normal !important; }
.cl-blue { color: var(--blue); }
.cl-red { color: var(--red); }
.cl-code { font: 12px var(--mono); letter-spacing: 0; background: var(--fill); border-radius: 5px; padding: 1px 5px; color: var(--label); white-space: nowrap; }
.cl-lines { background: var(--surface-2); border-radius: 10px; overflow: hidden; }
.cl-line { display: flex; align-items: center; gap: 10px; padding: 9px 12px; min-width: 0; }
.cl-line + .cl-line { border-top: .5px solid var(--sep); }
.cl-line .t1 { font-size: 15px; }
.cl-line .status i { width: 8px; height: 8px; }
.cl-k { font-size: 13px; color: var(--label-2); margin: 12px 0 6px; }
.cl-k:first-child { margin-top: 0; }
.cl-note { font-size: 13px; color: var(--label-2); margin-top: 10px; white-space: pre-wrap; }
.widgets.cl-mini { grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); margin-bottom: 22px; }
.cl-mini .widget { padding: 12px 14px 13px; }
.cl-mini .w-value { font-size: 24px; }
@media (max-width: 720px) { .widgets.cl-mini { grid-template-columns: repeat(3, 1fr); } .cl-mini .w-value { font-size: 20px; } }
@media (max-width: 360px) { .widgets.cl-mini { grid-template-columns: repeat(2, 1fr); } }
`
  const css = () => {
    if (document.getElementById('cloud-css')) return
    const st = document.createElement('style')
    st.id = 'cloud-css'
    st.textContent = CSS
    document.head.append(st)
  }

  const isCloud = () => typeof env !== 'undefined' && env === 'cloud'
  const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '')
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
  const hostOf = u => { try { return new URL(u).host } catch { return u || '' } }
  const day = t => (t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '')
  function rel(t) {
    if (!t) return ''
    const s = Math.round((Date.now() - t) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.round(s / 60)}m ago`
    if (s < 86400) return `${Math.round(s / 3600)}h ago`
    if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`
    return day(t)
  }
  const pill = t => `<span class="cl-pill">${esc(t)}</span>`
  const head = (title, sub, first) => `<h2 class="cl-h${first ? ' first' : ''}">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</h2>`
  const errNote = (name, msg) => `<div class="notice err">${esc(name)}: ${esc(msg || 'failed')}</div>`
  const groupBy = (list, f) => list.reduce((m, x) => ((m[f(x)] ||= []).push(x), m), {})

  /* ---------- rows and menus ---------- */

  const A = {
    open: (label, url) => url && { label, icon: MI.open, run: () => window.open(url, '_blank', 'noopener') },
    copy: (label, text, done = 'Copied') => text && { label, icon: MI.copy, run: () => copy(text, done) },
  }
  function tidy(items) {
    const out = []
    for (const it of items) {
      if (!it) continue
      if (it === '-' && (!out.length || out.at(-1) === '-')) continue
      out.push(it)
    }
    while (out.at(-1) === '-') out.pop()
    return out
  }
  function reg(title, actions) {
    const k = 'c' + Object.keys(C.items).length
    C.items[k] = { title, actions: tidy(actions || []) }
    return k
  }

  // t1/t2/t3 are HTML (callers escape); hay is plain text for the search box.
  function row({ name, t1, t2, t3, dot, href, visit, hay, actions, expand, details, wrap }) {
    const ck = reg(name, actions)
    const inner = `<span class="status" style="--c:${dot || COL.off}"><i></i></span>
      <span class="txt"><div class="t1">${t1}</div>${t2 ? `<div class="t2">${t2}</div>` : ''}${t3 ? `<div class="t2 cl-t3">${t3}</div>` : ''}</span>`
    const isOpen = !!expand && expanded.has(expand)
    const main = expand
      ? `<button class="row-line tap" style="padding:0;min-height:44px" data-expand="${esc(expand)}" aria-expanded="${isOpen}">${inner}${ICON.disclose}</button>`
      : href
        ? `<a class="row-line tap" style="padding:0;min-height:44px" href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>`
        : `<span class="row-line" style="padding:0;min-height:44px">${inner}</span>`
    return `<div class="row${isOpen ? ' open' : ''}${wrap ? ' cl-wrap' : ''}" data-menu="cloud" data-ck="${ck}" data-hay="${esc(String(hay || name).toLowerCase())}">
      <div class="row-line">${main}${visit ? `<a class="get" href="${esc(visit)}" target="_blank" rel="noopener">Visit</a>` : ''}</div>
      ${details ? `<div class="details">${details}</div>` : ''}</div>`
  }

  function connectRow(cn) {
    const fields = cn.fields.map(f => `<code class="cl-code">${esc(f)}</code>`).join(' ')
    return row({
      name: `Connect ${cn.name}`,
      t1: `<span class="cl-blue">Connect ${esc(cn.name)}</span>`,
      t2: `${cn.note ? `${esc(cn.note)}<br>` : ''}Fill ${fields} in secrets.json. ${esc(cn.where)}.`,
      dot: COL.off,
      wrap: true,
      href: cn.url,
      hay: `connect ${cn.name} ${cn.fields.join(' ')} ${cn.where}`,
      actions: [A.open('Open Key Page', cn.url), A.copy('Copy secrets.json Path', C.s.files?.secrets, 'Path copied'), A.copy('Copy Field Names', cn.fields.join(', '))],
    })
  }

  function line(dot, t1, t2, href, label) {
    return `<div class="cl-line"><span class="status" style="--c:${dot}"><i></i></span><span class="txt"><div class="t1">${t1}</div>${t2 ? `<div class="t2">${t2}</div>` : ''}</span>${href ? `<a class="icon-btn" href="${esc(href)}" target="_blank" rel="noopener" aria-label="${esc(label || 'Open')}">${MI.open}</a>` : ''}</div>`
  }

  /* ---------- status words ---------- */

  function appStatus(a) {
    const word = cap(a.state || 'unknown')
    const health = a.health && a.health !== 'unknown' ? ` · ${a.health}` : ''
    const c = a.state === 'running' ? (a.health === 'unhealthy' ? COL.warn : COL.ok) : ['exited', 'stopped', 'degraded'].includes(a.state) ? COL.down : COL.warn
    return { c, text: word + health }
  }
  function deployText(d) {
    if (!d) return ''
    const when = rel(d.finished || d.at)
    if (d.status === 'finished') return `${d.restartOnly ? 'restarted' : 'deployed'} ${when}`
    if (d.status === 'failed') return `deploy failed ${when}`
    if (/progress|queued/.test(d.status)) return 'deploying now'
    return `${d.status.replace(/-/g, ' ')} ${when}`
  }
  const deployColor = d => (d?.status === 'failed' ? 'cl-red' : '')

  /* ---------- widgets ---------- */

  function topWidgets() {
    const s = C.s
    const c = s.coolify || {}
    const apps = c.apps || []
    const up = apps.filter(a => a.state === 'running').length
    const w = []
    if (c.status === 'ok') w.push(widget('Apps running', `${up}<small>/ ${apps.length}</small>`, apps.length - up ? `${apps.length - up} stopped` : 'All running', apps.length ? (up / apps.length) * 100 : 0, up === apps.length ? COL.ok : COL.warn))
    else w.push(widget('Apps running', '–', c.status === 'connect' ? 'Connect Coolify' : 'Coolify error', null, c.status === 'connect' ? COL.off : COL.down))
    const list = s.servers?.list || []
    const sUp = list.filter(x => x.up).length
    w.push(widget('Servers up', `${sUp}<small>/ ${list.length}</small>`, list.length - sUp ? `${list.length - sUp} not answering` : list.length ? 'All answering' : 'None listed', list.length ? (sUp / list.length) * 100 : 0, sUp === list.length ? COL.ok : COL.down))
    const cl = s.clients?.list || []
    const ok = cl.filter(x => x.health === 'ok').length
    const down = cl.filter(x => x.health === 'down').length
    const warn = cl.filter(x => x.health === 'warn').length
    w.push(widget('Clients healthy', `${ok}<small>/ ${cl.length}</small>`, down ? `${down} down` : warn ? `${plural(warn, 'client')} need a look` : cl.length ? 'All healthy' : 'None listed', cl.length ? (ok / cl.length) * 100 : 0, down ? COL.down : warn ? COL.warn : COL.ok))
    const cf = s.cloudflare || {}
    if (cf.status === 'ok') {
      const z = cf.zones?.items || []
      w.push(widget('Cloudflare zones', String(z.length), `${z.filter(x => x.status === 'active').length} active`, null, 'var(--orange)'))
    } else w.push(widget('Cloudflare zones', '–', cf.status === 'connect' ? 'Connect Cloudflare' : 'Cloudflare error', null, cf.status === 'connect' ? COL.off : COL.down))
    return `<div class="widgets">${w.join('')}</div>`
  }

  /* ---------- 1. Coolify ---------- */

  function coolifySection() {
    const c = C.s.coolify || {}
    let h = head('Coolify', c.version ? `v${c.version}` : '', true)
    if (c.status === 'connect') return h + group('cl-coolify', 'Deploys', '', [connectRow(c.connect)])
    if (c.status !== 'ok') return h + errNote('Coolify', c.error)
    if (c.running?.length)
      h += group('cl-deploying', 'Deploying now', '', c.running.map(d => row({
        name: d.app, t1: esc(d.app), t2: esc([cap(d.status.replace(/_/g, ' ')), d.server, rel(d.at)].filter(Boolean).join(' · ')), dot: COL.info, hay: `deploying ${d.app} ${d.server}`,
        actions: [A.open('Open Coolify', c.url)],
      })))
    const byProject = groupBy(c.apps || [], a => a.project || 'Other')
    const order = a => (a.state === 'running' ? 1 : 0)
    for (const p of Object.keys(byProject).sort((a, b) => a.localeCompare(b))) {
      const apps = byProject[p].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
      h += group(`cl-p-${p}`, esc(p), '', apps.map(appRow))
    }
    const extras = [...(c.services || []), ...(c.databases || [])]
    if (extras.length) h += group('cl-svc', 'Services and databases', '', extras.map(resourceRow))
    const foot = [extras.length ? '' : 'No services or databases.', c.deploysEndpoint === false ? 'This Coolify has no per-app deploy history endpoint.' : '', 'Read-only: deploys, restarts and stops stay in Coolify.'].filter(Boolean).join(' ')
    h += group('cl-csrv', 'Coolify servers', esc(foot), (c.servers || []).map(s => row({
      name: s.name,
      t1: esc(s.name) + (s.coolifyHost ? pill('Coolify host') : ''),
      t2: esc([s.reachable ? 'Reachable' : 'Not reachable', s.usable ? '' : 'not usable', s.ip].filter(Boolean).join(' · ')),
      dot: s.reachable && s.usable ? COL.ok : s.reachable ? COL.warn : COL.down,
      href: s.console,
      hay: `coolify server ${s.name} ${s.ip}`,
      actions: [A.open('Open in Coolify', s.console), '-', A.copy('Copy IP', s.ip, 'IP copied')],
    })))
    const parts = Object.entries(c.partErrors || {})
    if (parts.length) h += errNote('Coolify', parts.map(([k, v]) => `${k}: ${v}`).join('; '))
    return h
  }

  function appRow(a) {
    const st = appStatus(a)
    const dep = deployText(a.deploy)
    const t2 = [esc(st.text), esc(a.url ? hostOf(a.url) : a.server), dep ? `<span class="${deployColor(a.deploy)}">${esc(dep)}</span>` : ''].filter(Boolean).join(' · ')
    const more = a.fqdns.slice(1).map(u => A.copy(`Copy ${hostOf(u)}`, u, 'URL copied'))
    return row({
      name: a.name,
      t1: esc(a.name),
      t2,
      dot: st.c,
      href: a.console,
      visit: a.url,
      hay: [a.name, a.project, a.fqdns.join(' '), a.status, a.server, a.branch, a.buildPack].join(' '),
      actions: [A.open('Open in Coolify', a.console), A.open('Open Site', a.url), '-', A.copy('Copy URL', a.url, 'URL copied'), ...more, A.copy('Copy Coolify Link', a.console, 'Link copied')],
    })
  }

  function resourceRow(r) {
    const st = appStatus(r)
    return row({
      name: r.name,
      t1: esc(r.name) + pill(r.kind === 'database' ? r.type || 'database' : 'service'),
      t2: esc([st.text, r.project].filter(Boolean).join(' · ')),
      dot: st.c,
      href: r.console,
      hay: [r.name, r.kind, r.type, r.project, r.status].join(' '),
      actions: [A.open('Open in Coolify', r.console), A.copy('Copy Coolify Link', r.console, 'Link copied')],
    })
  }

  /* ---------- 2. Live servers ---------- */

  function serversSection() {
    const sv = C.s.servers || {}
    let h = head('Live servers', '')
    if (sv.status !== 'ok') h += errNote('Server checks', sv.error)
    const rows = (sv.list || []).map(serverRow)
    h += group('cl-servers', 'Servers', 'TCP check on port 22, or 443 for web hosts; ssh aliases fall back to ssh. Add servers in servers.json.', rows.length ? rows : [`<div class="empty">No servers yet. Add them to servers.json.</div>`])
    h += group('cl-providers', 'Providers', '', [...(sv.euronodes?.apiKeySet || (C.s.servers?.list || []).some(s => /euronodes/i.test(s.provider)) ? [euronodesRow(sv.euronodes || {})] : []), providerRow('AWS', C.s.aws, r => `${plural(r.instances.length, 'EC2 instance')} in ${r.regions.join(', ')}`), providerRow('Azure', C.s.azure, r => plural(r.vms.length, 'virtual machine'))])
    return h
  }

  function serverRow(s) {
    const checks = s.checks || []
    const best = checks.filter(k => k.ok).sort((a, b) => a.ms - b.ms)[0]
    const cloudState = s.aws?.state || s.azure?.state || ''
    const check = checks.length
      ? best ? `${best.port === 'ssh' ? 'ssh' : `port ${best.port}`} ${best.ms} ms` : `no answer on ${checks.map(k => (k.port === 'ssh' ? 'ssh' : k.port)).join(', ')}`
      : cloudState ? cap(cloudState) : s.host ? 'Not checked' : 'No public IP'
    const label = s.provider || s.sources[0]
    const extra = s.sources.filter(x => x !== 'servers.json' && !label.includes(x)).map(pill).join('')
    const coolifyName = s.coolify && !s.name.startsWith(s.coolify.name) ? `Coolify: ${s.coolify.name}` : ''
    const t3 = [s.notes, coolifyName, s.aws ? `${s.aws.type} · ${s.aws.region}` : '', s.azure ? `${s.azure.size} · ${s.azure.location}` : ''].filter(Boolean).join(' · ')
    return row({
      name: s.name,
      t1: esc(s.name) + extra,
      t2: esc([label, s.host, check].filter(Boolean).join(' · ')),
      t3: t3 ? esc(t3) : '',
      dot: s.up == null ? COL.off : s.up ? COL.ok : COL.down,
      href: s.url || s.coolify?.console || s.aws?.console || s.azure?.console || '',
      hay: [s.name, s.provider, s.host, s.sshAlias, s.notes, s.sources.join(' '), s.coolify?.name].join(' '),
      actions: [
        A.open('Open Site', s.url),
        A.open('Open in Coolify', s.coolify?.console),
        A.open('Open in AWS Console', s.aws?.console),
        A.open('Open in Azure Portal', s.azure?.console),
        '-',
        A.copy('Copy IP', s.host, 'IP copied'),
        s.sshAlias && A.copy('Copy ssh Command', `ssh ${s.sshAlias}`, 'Command copied'),
        A.copy('Copy URL', s.url, 'URL copied'),
        '-',
        A.copy('Copy servers.json Path', C.s.files?.servers, 'Path copied'),
      ],
    })
  }

  function euronodesRow(e) {
    const tagged = (C.s.servers?.list || []).filter(s => /euronodes/i.test(s.provider)).map(s => s.name)
    return row({
      name: 'Euronodes',
      t1: 'Euronodes' + pill('API pending'),
      t2: esc(`${e.note || 'Euronodes API docs are pending.'}${e.apiKeySet ? ' The key is saved; the hookup waits on the docs.' : ''}`),
      t3: esc(tagged.length ? `Listed by hand: ${tagged.join(', ')}` : 'No servers tagged Euronodes in servers.json.'),
      dot: COL.off,
      wrap: true,
      hay: `euronodes api ${tagged.join(' ')}`,
      actions: [A.copy('Copy Ticket Number', e.ticket, 'Ticket copied'), A.copy('Copy servers.json Path', C.s.files?.servers, 'Path copied')],
    })
  }

  function providerRow(name, r, summary) {
    if (!r) return ''
    if (r.status === 'connect') return connectRow(r.connect)
    if (r.status !== 'ok') return row({ name, t1: esc(name), t2: `<span class="cl-red">${esc(r.error || 'failed')}</span>`, dot: COL.down, wrap: true, hay: `${name} error`, actions: [A.copy('Copy secrets.json Path', C.s.files?.secrets, 'Path copied')] })
    const errs = r.regionErrors?.length ? ` · ${r.regionErrors.join('; ')}` : ''
    return row({ name, t1: esc(name), t2: esc(summary(r) + errs), dot: errs ? COL.warn : COL.ok, hay: `${name} provider`, actions: [] })
  }

  /* ---------- 3. Cloudflare ---------- */

  function cloudflareSection() {
    const cf = C.s.cloudflare || {}
    let h = head('Cloudflare', cf.status === 'ok' ? [cf.accountName, cf.from === 'wrangler login' ? 'via wrangler login' : ''].filter(Boolean).join(' · ') : '')
    if (cf.status === 'connect') return h + group('cl-cf', 'Account', '', [connectRow(cf.connect)])
    if (cf.status !== 'ok') return h + errNote('Cloudflare', cf.error)
    const parts = [
      ['zones', 'Zones', 'var(--orange)'], ['workers', 'Workers', 'var(--blue)'], ['pages', 'Pages', 'var(--indigo)'],
      ['r2', 'R2', 'var(--green)'], ['d1', 'D1', 'var(--green)'], ['kv', 'KV', 'var(--green)'],
    ]
    h += `<div class="widgets cl-mini">${parts.map(([k, label, color]) => widget(label, cf[k]?.error ? '–' : String(cf[k]?.items?.length || 0), cf[k]?.error ? 'No access' : k === 'zones' ? `${(cf.zones.items || []).filter(z => z.status === 'active').length} active` : '', null, color)).join('')}</div>`
    const big = n => n > 8
    const section = (k, title, mk, foot = '') => {
      const p = cf[k] || {}
      const rows = p.error ? [row({ name: title, t1: esc(title), t2: `<span class="cl-red">${esc(p.error)}</span>`, dot: COL.down, wrap: true, hay: `${title} error`, actions: [] })] : (p.items || []).map(mk)
      return group(`cl-cf-${k}`, title, foot, rows, big(rows.length))
    }
    h += section('zones', 'Zones', z => row({
      name: z.name, t1: esc(z.name), t2: esc([cap(z.status), z.plan, z.paused ? 'paused' : ''].filter(Boolean).join(' · ')),
      dot: z.paused ? COL.warn : z.status === 'active' ? COL.ok : z.status === 'pending' ? COL.warn : COL.off,
      href: z.console, visit: `https://${z.name}`, hay: `zone ${z.name} ${z.status} ${z.plan}`,
      actions: [A.open('Open in Cloudflare', z.console), A.open('Open Site', `https://${z.name}`), '-', A.copy('Copy Domain', z.name, 'Domain copied')],
    }))
    h += section('workers', 'Workers', w => row({
      name: w.name, t1: esc(w.name), t2: esc(w.modified ? `Updated ${rel(w.modified)}` : 'Worker'), dot: COL.ok, href: w.console, hay: `worker ${w.name}`,
      actions: [A.open('Open in Cloudflare', w.console), A.copy('Copy Name', w.name)],
    }))
    h += section('pages', 'Pages', p => {
      const site = p.domains[0] ? `https://${p.domains[0]}` : p.url
      const ok = p.status === 'success'
      return row({
        name: p.name, t1: esc(p.name),
        t2: esc([p.status ? `${cap(p.stage || 'deploy')} ${p.status}` : 'No deployments', rel(p.at), p.branch].filter(Boolean).join(' · ')),
        dot: !p.status ? COL.off : ok ? COL.ok : p.status === 'failure' ? COL.down : COL.warn,
        href: p.console, visit: site, hay: `pages ${p.name} ${p.domains.join(' ')} ${p.status}`,
        actions: [A.open('Open in Cloudflare', p.console), A.open('Open Site', site), A.open('Open Latest Deployment', p.deployUrl), '-', A.copy('Copy URL', site, 'URL copied')],
      })
    })
    h += section('r2', 'R2 buckets', b => row({
      name: b.name, t1: esc(b.name), t2: esc([b.created ? `Created ${day(b.created)}` : '', b.location].filter(Boolean).join(' · ')), dot: COL.ok, href: b.console, hay: `r2 bucket ${b.name}`,
      actions: [A.open('Open in Cloudflare', b.console), A.copy('Copy Name', b.name)],
    }))
    h += section('d1', 'D1 databases', d => row({
      name: d.name, t1: esc(d.name), t2: esc(d.created ? `Created ${day(d.created)}` : 'Database'), dot: COL.ok, href: d.console, hay: `d1 database ${d.name}`,
      actions: [A.open('Open in Cloudflare', d.console), A.copy('Copy Name', d.name), A.copy('Copy ID', d.uuid, 'ID copied')],
    }))
    h += section('kv', 'KV namespaces', n => row({
      name: n.name, t1: esc(n.name), t2: 'Namespace', dot: COL.ok, href: n.console, hay: `kv namespace ${n.name}`,
      actions: [A.open('Open in Cloudflare', n.console), A.copy('Copy Name', n.name), A.copy('Copy ID', n.id, 'ID copied')],
    }))
    return h
  }

  /* ---------- 4. Active clients ---------- */

  const HEALTH = { ok: ['Healthy', COL.ok], warn: ['Needs a look', COL.warn], down: ['Down', COL.down], unlinked: ['Nothing linked yet', COL.off] }

  function siteColor(d) {
    if (!d.code) return COL.down
    if (d.code >= 500 || (d.tlsDays != null && d.tlsDays < 7)) return COL.warn
    if (d.tlsDays != null && d.tlsDays < 14) return COL.warn
    return COL.ok
  }
  function siteText(d) {
    if (!d.code) return d.error || 'No answer'
    const tls = d.tlsDays == null ? (d.tlsError ? `TLS ${d.tlsError}` : '') : d.tlsDays < 0 ? 'TLS expired' : `TLS ${plural(d.tlsDays, 'day')}`
    return [`${d.code}`, `${d.ms} ms`, tls, d.tlsValid === false && d.tlsDays != null ? 'cert not trusted' : ''].filter(Boolean).join(' · ')
  }

  function editClients() {
    const p = C.s.files?.clients || 'clients.json'
    alertBox({ title: 'Edit clients.json', message: `${p}\n\nAdd domains, Coolify app names and notes per client. The tab picks changes up on the next refresh.`, ok: 'Copy Path' }).then(v => v && copy(p, 'Path copied'))
  }

  function clientRow(cl) {
    const [word, dot] = HEALTH[cl.health] || HEALTH.unlinked
    const stopped = cl.apps.filter(a => a.state !== 'running').length
    const failing = cl.checks.filter(d => siteColor(d) !== COL.ok).length
    const tlsMin = cl.checks.map(d => d.tlsDays).filter(n => n != null).sort((a, b) => a - b)[0]
    const t2 = [
      word,
      cl.apps.length ? `${plural(cl.apps.length, 'app')}${stopped ? ` (${stopped} stopped)` : ''}` : 'no Coolify apps',
      cl.checks.length ? `${plural(cl.checks.length, 'domain')}${failing ? ` (${failing} failing)` : ''}` : 'no domains',
      tlsMin != null ? `TLS ${tlsMin} d` : '',
    ].filter(Boolean).join(' · ')
    const apps = cl.apps.map(a => {
      const st = appStatus(a)
      const dep = deployText(a.deploy)
      return line(st.c, esc(a.name), esc([st.text, a.project, dep].filter(Boolean).join(' · ')), a.console, `Open ${a.name} in Coolify`)
    })
    const sites = cl.checks.map(d => line(siteColor(d), esc(d.domain) + (d.fromCoolify ? '' : pill('clients.json')), esc(siteText(d)), `https://${d.domain}`, `Open ${d.domain}`))
    const details = [
      apps.length ? `<div class="cl-k">Coolify apps</div><div class="cl-lines">${apps.join('')}</div>` : '<div class="cl-k">No Coolify app name, domain or project contains this client’s name.</div>',
      sites.length ? `<div class="cl-k">Domains</div><div class="cl-lines">${sites.join('')}</div>` : '',
      cl.notes ? `<div class="cl-note">${esc(cl.notes)}</div>` : '',
    ].join('')
    return row({
      name: cl.name,
      t1: esc(cl.name) + (cl.status ? pill(cap(cl.status)) : ''),
      t2: esc(t2),
      dot,
      expand: `cloud:client:${cl.name}`,
      details,
      hay: [cl.name, cl.status, cl.notes, cl.domains.join(' '), cl.apps.map(a => a.name).join(' '), cl.checks.map(d => d.domain).join(' ')].join(' '),
      actions: [
        ...cl.apps.map(a => A.open(`Open ${a.name} in Coolify`, a.console)),
        '-',
        ...cl.checks.slice(0, 6).map(d => A.open(`Visit ${d.domain}`, `https://${d.domain}`)),
        '-',
        { label: 'Edit clients.json', icon: MI.edit, run: editClients },
        A.copy('Copy Name', cl.name),
      ],
    })
  }

  function clientsSection() {
    const s = C.s.clients || {}
    let h = head('Active clients', '')
    if (s.status === 'error') return h + errNote('Clients', s.error)
    if (C.s.coolify?.status !== 'ok') h += `<div class="notice">Coolify isn’t connected, so client apps can’t be linked yet.</div>`
    const rows = (s.list || []).map(clientRow)
    h += group('cl-clients', 'Clients', 'Apps link when their name, domain or project contains the client name. Their domains get an HTTPS and certificate check.', rows.length ? rows : [row({ name: 'clients.json', t1: 'No clients yet', t2: 'Add them to clients.json.', dot: COL.off, hay: 'clients', actions: [{ label: 'Edit clients.json', icon: MI.edit, run: editClients }] })])
    return h
  }

  /* ---------- tab ---------- */

  async function load(force) {
    if (C.loading) return C.loading
    C.loading = (async () => {
      try {
        C.s = force ? await api('/api/cloud/refresh', {}) : await api('/api/cloud/state')
        C.err = ''
      } catch (e) {
        C.err = e.message
      }
      C.t = Date.now()
      C.loading = null
      if (isCloud()) render()
      clearTimeout(C.poll)
      // The hub answers from cache while it refreshes in the background; ask again shortly.
      if (C.s?.refreshing || C.s?.cached) C.poll = setTimeout(() => isCloud() && load(), 4000)
    })()
    return C.loading
  }

  ;(window.TABS ||= {}).cloud = {
    title: 'Cloud',
    search: 'Search cloud',
    render() {
      css()
      C.items = {}
      // The hub re-renders every few seconds; refetch once the 60 s cache has gone stale.
      if (!C.loading && Date.now() - C.t > 60_000) setTimeout(() => load(), 0)
      if (!C.s) return C.err ? errNote('Can’t load the cloud tab', C.err) : `<div class="empty">Checking Coolify, servers, Cloudflare and clients…</div>`
      try {
        return (C.err ? errNote('Last refresh failed', C.err) : '') + topWidgets() + coolifySection() + serversSection() + cloudflareSection() + clientsSection()
      } catch (e) {
        return errNote('Cloud tab', e.message)
      }
    },
    load,
    menu(rowEl, x, y) {
      const it = C.items[rowEl.dataset.ck]
      if (!it || !it.actions.length) return false
      showMenu(x, y, it.title, it.actions)
      return true
    },
    ago() {
      if (!C.s) return C.loading ? 'Loading…' : ''
      return ago(C.s.at) + (C.s.refreshing || C.loading ? ' · refreshing' : C.s.cached ? ' · cached' : '')
    },
  }
})()
