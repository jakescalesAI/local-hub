// Hub settings: everything that makes the hub look and feel like yours, stored once on the hub so
// all your devices and the hub assistant see the same thing.
//   GET  /api/hub/settings           -> the settings (shape below) plus `at`
//   POST /api/hub/settings           body: a partial patch (x-hub: 1). Strictly validated; every
//                                    problem comes back as 400 { error, errors: [{ path, message }] }.
//   GET  /api/hub/settings/catalog   -> every allowed id and value (tabs, apps, widgets, style, wallpapers)
//   POST /api/hub/wallpapers         raw image body (png, jpeg, webp, gif, avif; up to 10 MB) -> upload
//   POST /api/hub/wallpapers/remove  { id } -> the file moves to data/wallpapers/.removed (never erased)
//   GET  /api/hub/wallpapers/<file>  an uploaded image;  GET /wallpapers/<id>.svg  a built-in one
// The contract is written out in HUB-GUIDE.md under "Settings API". Keep the two in step.
// Stored in data/hub-settings.json (atomic writes; the previous version is kept in hub-settings.prev.json).
// The Home widget layout lives here too (`widgets`); /api/home/layout (home.mjs) is an alias for it.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { hubConfig, enabledTabs, addonOn, activeTheme, baseTheme } from './config.mjs'

export const BUILTIN_TABS = ['home', 'laptop', 'server', 'drives', 'ai', 'cloud', 'calendar', 'stripe']
const NOT_TABS = new Set(['home', 'chat', 'custom', 'setup']) // files in tabs/ that are not plug-in tabs
export const SIZES = ['s', 'm', 'l']
const MAX_ITEMS = 60
const MAX_BODY = 256 * 1024
const MAX_UPLOAD = 10 * 1024 * 1024
const MAX_CUSTOM = 24
const MAX_UPLOADS = 40
const MAX_SITES = 40
const MAX_GROUPS = 20
const MAX_IN_GROUP = 24
const MAX_STACK = 8
const MAX_APP_PLACES = 100
const APP_REF_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export const WIDGET_IDS = [
  'claude-usage', 'claude-reset', 'claude-pace', 'claude-limits', 'tokens', 'tokens-models', 'tokens-machines', 'tokens-split',
  'sessions-recent', 'openrouter', 'openrouter-spend', 'deepseek',
  'coolify', 'coolify-apps', 'coolify-down', 'deploys', 'servers', 'clients', 'client-sites', 'cloudflare', 'cloud-providers', 'euronodes',
  'drives', 'backup-drive', 'icloud',
  'services', 'server-health', 'laptop-health', 'tunnels', 'syncs', 'tailnet',
  'clock', 'date', 'world-clock', 'quick-links', 'hub-status',
  'next-event', 'event-countdown', 'today', 'tomorrow', 'week', 'month',
  'stripe-balance', 'revenue', 'mrr', 'customers', 'payouts', 'invoices', 'payments',
]
// Families: one widget per live item (a Claude account, a Coolify app, a server, a client, a drive).
export const WIDGET_FAMILIES = ['claude-account', 'coolify-app', 'server', 'client', 'drive']
const FAMILY_RE = new RegExp(`^(${WIDGET_FAMILIES.join('|')})\\.[a-z0-9-]{1,40}$`)

// Per-widget options. `tint` works on every widget; the rest only on the widget named.
export const WIDGET_OPTIONS = {
  '*': { tint: 'color' },
  clock: { face: ['digital', 'analog'], seconds: 'bool' },
  'claude-usage': { style: ['rings', 'bars'] },
  tokens: { chart: ['bars', 'line'] },
  coolify: { view: ['ring', 'bar'] },
}

export const STYLE = {
  theme: { enum: ['auto', 'light', 'dark'], default: 'auto' },
  accent: { color: true, extra: ['system'], default: 'system' },
  widgetLook: { enum: ['solid', 'glass', 'outline'], default: 'solid' },
  blur: { min: 0, max: 40, default: 20 },
  transparency: { min: 0, max: 90, default: 30 },
  radius: { min: 6, max: 32, default: 20 },
  shadow: { enum: ['none', 'soft', 'deep'], default: 'soft' },
  tabBar: { enum: ['solid', 'glass'], default: 'solid' },
  effect: { enum: ['none', 'grain', 'glow'], default: 'none' },
}

// The default look lives in themes/quartzi.json: style defaults, these wallpapers, the icon.
for (const [k, v] of Object.entries(baseTheme().style || {})) if (STYLE[k]) STYLE[k].default = v
export const BUILTIN_WALLPAPERS = (baseTheme().wallpapers || []).map(w => ({ ...w, url: `/wallpapers/${w.id}.svg` }))

const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }
const EXT_TYPE = Object.fromEntries(Object.entries(IMAGE_TYPES).map(([t, e]) => [e, t]))
const sniff = b => {
  if (b.length < 12) return ''
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif'
  if (b.toString('latin1', 4, 8) === 'ftyp' && /avi[fs]/.test(b.toString('latin1', 8, 12))) return 'image/avif'
  return ''
}

const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/
const CUSTOM_ID_RE = /^custom-[a-z0-9-]{1,24}$/
const UPLOAD_ID_RE = /^upload-[a-z0-9]{6,24}$/
const UPLOAD_FILE_RE = /^(upload-[a-z0-9]{6,24})\.(png|jpg|webp|gif|avif)$/
export const SITE_ID_RE = /^site-[a-z0-9-]{1,32}$/
export const GROUP_ID_RE = /^group-[a-z0-9-]{1,32}$/

// Website apps: any site you want on Home. One click adds a suggestion (Coolify comes from cloud.mjs).
export const SITE_SUGGESTIONS = [
  { name: 'Infisical', url: 'https://app.infisical.com/' },
  { name: 'AWS Console', url: 'https://console.aws.amazon.com/' },
  { name: 'Cloudflare', url: 'https://dash.cloudflare.com/' },
  { name: 'Stripe', url: 'https://dashboard.stripe.com/' },
  { name: 'Supabase', url: 'https://supabase.com/dashboard' },
]
// http and https only, no user:password@ and nothing longer than 500 characters.
export function webUrl(v) {
  if (typeof v !== 'string' || v.length > 500) return null
  let u
  try { u = new URL(v.trim()) } catch { return null }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || !u.hostname) return null
  return u.href
}
const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'site'

export function pluginTabs(here) {
  try {
    return fs.readdirSync(path.join(here, 'tabs')).map(f => /^([a-z]+)\.js$/.exec(f)?.[1]).filter(n => n && !NOT_TABS.has(n) && !BUILTIN_TABS.includes(n)).sort()
  } catch { return [] }
}
const allTabs = here => [...enabledTabs(), ...pluginTabs(here)]
const allApps = here => [...allTabs(here).filter(t => t !== 'home'), 'chat']
const siteIds = s => (s.sites || []).map(x => x.id)
const groupIds = s => (s.groups || []).map(x => x.id)

/* ---------- defaults ---------- */

const WIDGET_DEFAULTS = {
  desktop: [['claude-usage', 'm'], ['clock', 's'], ['next-event', 's'], ['tokens', 'm'], ['coolify', 's'], ['services', 's'], ['today', 'm'], ['stripe-balance', 's'], ['openrouter', 's'], ['server-health', 'm'], ['deepseek', 's'], ['icloud', 's'], ['drives', 'm'], ['backup-drive', 's'], ['laptop-health', 's'], ['servers', 'l'], ['revenue', 'm'], ['clients', 'm']],
  mobile: [['claude-usage', 's'], ['clock', 's'], ['next-event', 's'], ['coolify', 's'], ['today', 'm'], ['tokens', 'm'], ['openrouter', 's'], ['deepseek', 's'], ['stripe-balance', 's'], ['icloud', 's'], ['server-health', 'm'], ['drives', 'm'], ['services', 's'], ['backup-drive', 's'], ['servers', 'm']],
}
// Which add-on a default widget needs. With few add-ons on, a hub starts from the plain layout below.
const WIDGET_NEEDS = { 'claude-usage': 'ai', tokens: 'ai', openrouter: 'ai', deepseek: 'ai', 'next-event': 'calendar', today: 'calendar', coolify: 'cloud', servers: 'cloud', clients: 'cloud', services: 'laptop', 'laptop-health': 'laptop', 'server-health': 'server', 'stripe-balance': 'stripe', revenue: 'stripe', icloud: 'icloud', drives: 'drives', 'backup-drive': 'drives' }
const WIDGET_PLAIN = {
  desktop: [['clock', 's'], ['date', 's'], ['world-clock', 's']],
  mobile: [['clock', 's'], ['date', 's'], ['world-clock', 'm']],
}
const startLayout = name => {
  const on = WIDGET_DEFAULTS[name].filter(([id]) => !WIDGET_NEEDS[id] || addonOn(WIDGET_NEEDS[id]))
  return on.length >= 4 ? on : WIDGET_PLAIN[name]
}
export const seedLayout = name => startLayout(name).map(([id, size], i) => ({ key: `${name[0]}${i + 1}-${id}`.slice(0, 40), id, size }))
const defaultStyle = () => ({ ...Object.fromEntries(Object.entries(STYLE).map(([k, v]) => [k, v.default])), ...activeTheme().style })
const defaults = here => ({
  version: 1,
  tabs: { order: allTabs(here), hidden: [] },
  apps: allApps(here),
  sites: [],
  groups: [],
  widgets: { desktop: seedLayout('desktop'), mobile: seedLayout('mobile') },
  style: defaultStyle(),
  wallpaper: { current: activeTheme().wallpaper || 'none', custom: [], uploads: [] },
})

/* ---------- validation ---------- */

class Bad extends Error {}
// A tiny checker that collects every problem with its path, so one reply lists them all.
function checker() {
  const errors = []
  const fail = (p, m) => (errors.push({ path: p, message: `${p} ${m}` }), undefined)
  const obj = (p, v, allowed) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(p, 'must be an object')
    for (const k of Object.keys(v)) if (!allowed.includes(k)) fail(`${p}.${k}`, `is not a known key (allowed: ${allowed.join(', ')})`)
    return true
  }
  const list = (p, v, max) => {
    if (!Array.isArray(v)) return fail(p, 'must be a list')
    if (v.length > max) return fail(p, `has more than ${max} entries`)
    return true
  }
  const oneOf = (p, v, values) => (values.includes(v) ? v : fail(p, `must be one of: ${values.join(', ')}`))
  const int = (p, v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : fail(p, `must be a whole number from ${min} to ${max}`))
  const color = (p, v) => (typeof v === 'string' && COLOR_RE.test(v) ? v.toLowerCase() : fail(p, 'must be a hex colour like #0a84ff or #fa0'))
  const bool = (p, v) => (typeof v === 'boolean' ? v : fail(p, 'must be true or false'))
  const text = (p, v, max) => (typeof v === 'string' && v.trim() && v.length <= max && !/[\u0000-\u001f<>]/.test(v) ? v.trim() : fail(p, `must be text of 1 to ${max} characters without < or >`))
  const ids = (p, v, values, max = 40) => {
    if (!list(p, v, max)) return undefined
    const seen = new Set()
    v.forEach((x, i) => { if (!values.includes(x)) fail(`${p}[${i}]`, `must be one of: ${values.join(', ')}`); else if (seen.has(x)) fail(`${p}[${i}]`, `repeats ${x}`); seen.add(x) })
    return v
  }
  return { errors, fail, obj, list, oneOf, int, color, bool, text, ids, done() { if (errors.length) throw Object.assign(new Bad(errors[0].message), { errors }) } }
}

const widgetIdOk = id => typeof id === 'string' && (WIDGET_IDS.includes(id) || FAMILY_RE.test(id))
const itemIdOk = it => it?.id === 'stack' || it?.id === 'app' || widgetIdOk(it?.id)

function cleanOpts(c, p, id, opts) {
  const spec = { ...WIDGET_OPTIONS['*'], ...(WIDGET_OPTIONS[id] || {}) }
  if (!c.obj(p, opts, Object.keys(spec))) return undefined
  const out = {}
  for (const [k, v] of Object.entries(opts)) {
    const s = spec[k]
    if (!s) continue
    out[k] = s === 'color' ? c.color(`${p}.${k}`, v) : s === 'bool' ? c.bool(`${p}.${k}`, v) : c.oneOf(`${p}.${k}`, v, s)
  }
  return out
}

export function cleanLayout(c, p, l) {
  if (!c.list(p, l, MAX_ITEMS + MAX_APP_PLACES)) return undefined
  if (l.filter(it => it?.id !== 'app').length > MAX_ITEMS) c.fail(p, `has more than ${MAX_ITEMS} widgets`)
  const seen = new Set()
  const key = (q, k) => {
    if (typeof k !== 'string' || !KEY_RE.test(k)) c.fail(`${q}.key`, 'must be 1-40 letters, digits, - or _')
    else if (seen.has(k)) c.fail(`${q}.key`, `repeats ${k}`)
    seen.add(k)
  }
  return l.map((it, i) => {
    const q = `${p}[${i}]`
    // An app's place among the widgets: { id: "app", app }. Apps not on Home are dropped after the patch.
    if (it?.id === 'app') {
      if (!c.obj(q, it, ['key', 'id', 'app'])) return null
      if (typeof it.app !== 'string' || !APP_REF_RE.test(it.app)) return c.fail(`${q}.app`, 'must be an app id'), null
      return { id: 'app', app: it.app }
    }
    if (!c.obj(q, it, ['key', 'id', 'size', 'opts', 'stack'])) return null
    key(q, it.key)
    c.oneOf(`${q}.size`, it.size, SIZES)
    // A widget stack: 2-8 widgets sharing one place, swiped through like on iPhone. Each keeps its own options.
    if (it.id === 'stack') {
      if (it.opts !== undefined) c.fail(`${q}.opts`, 'belongs on each widget in the stack')
      if (!c.list(`${q}.stack`, it.stack, MAX_STACK)) return null
      if (it.stack.length < 2) c.fail(`${q}.stack`, 'needs at least 2 widgets')
      const stack = it.stack.map((x, j) => {
        const r = `${q}.stack[${j}]`
        if (!c.obj(r, x, ['key', 'id', 'size', 'opts'])) return null
        key(r, x.key)
        if (!widgetIdOk(x.id)) c.fail(`${r}.id`, 'is not a known widget (see /api/hub/settings/catalog)')
        const o = { key: x.key, id: x.id, size: it.size }
        if (x.opts !== undefined) { const op = cleanOpts(c, `${r}.opts`, x.id, x.opts); if (op && Object.keys(op).length) o.opts = op }
        return o
      })
      return { key: it.key, id: 'stack', size: it.size, stack }
    }
    if (it.stack !== undefined) c.fail(`${q}.stack`, 'is only for items with id "stack"')
    if (!widgetIdOk(it.id)) c.fail(`${q}.id`, `is not a known widget (see /api/hub/settings/catalog)`)
    const out = { key: it.key, id: it.id, size: it.size }
    if (it.opts !== undefined) { const o = cleanOpts(c, `${q}.opts`, it.id, it.opts); if (o && Object.keys(o).length) out.opts = o }
    return out
  })
}

function cleanCustom(c, p, w) {
  if (!c.obj(p, w, ['id', 'name', 'colors', 'angle', 'mesh'])) return null
  if (typeof w.id !== 'string' || !CUSTOM_ID_RE.test(w.id)) c.fail(`${p}.id`, 'must look like custom-<1-24 lowercase letters, digits or ->')
  const name = c.text(`${p}.name`, w.name, 40)
  if (c.list(`${p}.colors`, w.colors, 3)) {
    if (w.colors.length < 2) c.fail(`${p}.colors`, 'needs 2 or 3 colours')
    w.colors.forEach((x, i) => c.color(`${p}.colors[${i}]`, x))
  }
  c.int(`${p}.angle`, w.angle, 0, 360)
  c.bool(`${p}.mesh`, w.mesh)
  return { id: w.id, name, colors: Array.isArray(w.colors) ? w.colors.map(x => String(x).toLowerCase()) : [], angle: w.angle, mesh: w.mesh }
}

// A website app: { id: site-<name>, name, url, icon? (an image URL), newTab }.
function cleanSite(c, p, w, { needId = true, partial = false } = {}) {
  const keys = partial || needId ? ['id', 'name', 'url', 'icon', 'newTab'] : ['id', 'name', 'url', 'icon', 'newTab', 'onHome']
  if (!c.obj(p, w, keys)) return null
  const out = {}
  if (w.id !== undefined || needId) { if (typeof w.id !== 'string' || !SITE_ID_RE.test(w.id)) c.fail(`${p}.id`, 'must look like site-<1-32 lowercase letters, digits or ->'); else out.id = w.id }
  if (w.name !== undefined || !partial) { const n = c.text(`${p}.name`, w.name, 40); if (n) out.name = n }
  if (w.url !== undefined || !partial) { const u = webUrl(w.url); if (!u) c.fail(`${p}.url`, 'must be an http or https address of up to 500 characters'); else out.url = u }
  if (w.icon === null && partial) out.icon = null
  else if (w.icon !== undefined) { const u = webUrl(w.icon); if (!u) c.fail(`${p}.icon`, 'must be an http or https image address (or null to use the site icon)'); else out.icon = u }
  if (w.newTab !== undefined) { const b = c.bool(`${p}.newTab`, w.newTab); if (b !== undefined) out.newTab = b }
  else if (!partial) out.newTab = false
  return out
}

// An app group (a folder on Home): { id: group-<name>, name, apps: [app ids] }.
function cleanGroup(c, p, g, members, { partial = false, needId = true } = {}) {
  if (!c.obj(p, g, ['id', 'name', 'apps'])) return null
  const out = {}
  if (g.id !== undefined || needId) { if (typeof g.id !== 'string' || !GROUP_ID_RE.test(g.id)) c.fail(`${p}.id`, 'must look like group-<1-32 lowercase letters, digits or ->'); else out.id = g.id }
  if (g.name !== undefined || !partial) { const n = c.text(`${p}.name`, g.name, 40); if (n) out.name = n }
  if (g.apps !== undefined || !partial) {
    const a = c.ids(`${p}.apps`, g.apps, members, MAX_IN_GROUP)
    if (a && !a.length) c.fail(`${p}.apps`, 'needs at least one app')
    else if (a) out.apps = [...a]
  }
  return out
}

// Apply a patch to a copy of the current settings. Throws Bad (with every error) or returns the result.
export function applyPatch(cur, body, here) {
  const c = checker()
  const next = structuredClone(cur)
  const TABS = allTabs(here)
  next.sites = next.sites || []
  if (!c.obj('body', body, ['tabs', 'apps', 'sites', 'groups', 'widgets', 'style', 'wallpaper', 'reset'])) c.done()
  if (!Object.keys(body).length) c.fail('body', 'is empty: send at least one of tabs, apps, sites, groups, widgets, style, wallpaper, reset')

  if (body.reset !== undefined) {
    const parts = ['tabs', 'apps', 'widgets', 'style', 'wallpaper', 'all']
    const r = c.ids('reset', body.reset, parts, 6)
    const d = defaults(here)
    for (const k of r || []) for (const part of k === 'all' ? parts.slice(0, 5) : [k]) next[part] = part === 'wallpaper' ? { ...d.wallpaper, custom: next.wallpaper.custom, uploads: next.wallpaper.uploads } : d[part]
    if (r?.includes('apps') || r?.includes('all')) next.groups = []
  }

  if (body.tabs !== undefined && c.obj('tabs', body.tabs, ['order', 'hidden', 'hide', 'show'])) {
    const t = body.tabs
    if (t.order !== undefined && c.ids('tabs.order', t.order, TABS)) next.tabs.order = [...t.order, ...TABS.filter(x => !t.order.includes(x))]
    if (t.hidden !== undefined && c.ids('tabs.hidden', t.hidden, TABS)) next.tabs.hidden = [...t.hidden]
    if (t.hide !== undefined && c.ids('tabs.hide', t.hide, TABS)) next.tabs.hidden = [...new Set([...next.tabs.hidden, ...t.hide])]
    if (t.show !== undefined && c.ids('tabs.show', t.show, TABS)) next.tabs.hidden = next.tabs.hidden.filter(x => !t.show.includes(x))
    if (next.tabs.hidden.includes('home')) c.fail('tabs', 'cannot hide home: the Home tab is always shown')
  }

  if (body.sites !== undefined) {
    const w = body.sites
    if (Array.isArray(w)) {
      if (c.list('sites', w, MAX_SITES)) {
        const list = w.map((x, i) => cleanSite(c, `sites[${i}]`, x)).filter(Boolean)
        const seen = new Set()
        list.forEach((x, i) => { if (seen.has(x.id)) c.fail(`sites[${i}].id`, `repeats ${x.id}`); seen.add(x.id) })
        next.sites = list
      }
    } else if (c.obj('sites', w, ['add', 'remove', 'update'])) {
      if (w.remove !== undefined && c.list('sites.remove', w.remove, MAX_SITES)) {
        w.remove.forEach((x, i) => { if (!next.sites.some(s => s.id === x)) c.fail(`sites.remove[${i}]`, 'is not a saved website app') })
        next.sites = next.sites.filter(s => !w.remove.includes(s.id))
      }
      if (w.update !== undefined && c.list('sites.update', w.update, MAX_SITES)) {
        w.update.forEach((x, i) => {
          const u = cleanSite(c, `sites.update[${i}]`, x, { partial: true })
          if (!u || !u.id) return
          const at = next.sites.findIndex(s => s.id === u.id)
          if (at < 0) return c.fail(`sites.update[${i}].id`, 'is not a saved website app')
          const merged = { ...next.sites[at], ...u }
          if (merged.icon === null) delete merged.icon
          next.sites[at] = merged
        })
      }
      if (w.add !== undefined && c.list('sites.add', w.add, MAX_SITES)) {
        w.add.forEach((x, i) => {
          const u = cleanSite(c, `sites.add[${i}]`, x, { needId: false })
          if (!u || !u.name || !u.url) return
          if (x.onHome !== undefined && typeof x.onHome !== 'boolean') return c.fail(`sites.add[${i}].onHome`, 'must be true or false')
          if (u.id && next.sites.some(s => s.id === u.id)) return c.fail(`sites.add[${i}].id`, `${u.id} already exists`)
          if (next.sites.length >= MAX_SITES) return c.fail('sites.add', `there are already ${MAX_SITES} website apps`)
          let id = u.id
          if (!id) { const base = `site-${slug(u.name)}`; id = base; for (let n = 2; next.sites.some(s => s.id === id); n++) id = `${base}-${n}` }
          next.sites.push({ ...u, id })
          if (x.onHome !== false && !next.apps.includes(id)) next.apps = [...next.apps, id]
        })
      }
    }
    next.apps = next.apps.filter(a => !a.startsWith('site-') || next.sites.some(s => s.id === a))
  }
  if (body.groups !== undefined) {
    const g = body.groups, members = [...allApps(here), ...siteIds(next)]
    if (Array.isArray(g)) {
      if (c.list('groups', g, MAX_GROUPS)) {
        const list = g.map((x, i) => cleanGroup(c, `groups[${i}]`, x, members)).filter(Boolean)
        const seen = new Set()
        list.forEach((x, i) => { if (seen.has(x.id)) c.fail(`groups[${i}].id`, `repeats ${x.id}`); seen.add(x.id) })
        next.groups = list
      }
    } else if (c.obj('groups', g, ['add', 'remove', 'update'])) {
      if (g.remove !== undefined && c.list('groups.remove', g.remove, MAX_GROUPS)) {
        g.remove.forEach((x, i) => { if (!next.groups.some(s => s.id === x)) c.fail(`groups.remove[${i}]`, 'is not a saved group') })
        // Ungrouping puts the apps back on Home where the group was.
        for (const id of g.remove) {
          const grp = next.groups.find(s => s.id === id), at = next.apps.indexOf(id)
          if (grp) next.apps = at < 0 ? [...next.apps, ...grp.apps] : [...next.apps.slice(0, at), ...grp.apps, ...next.apps.slice(at + 1)]
        }
        next.groups = next.groups.filter(s => !g.remove.includes(s.id))
      }
      if (g.update !== undefined && c.list('groups.update', g.update, MAX_GROUPS)) {
        g.update.forEach((x, i) => {
          const u = cleanGroup(c, `groups.update[${i}]`, x, members, { partial: true }), cur = u?.id && next.groups.find(s => s.id === u.id)
          if (u?.id && !cur) return c.fail(`groups.update[${i}].id`, 'is not a saved group')
          if (cur) Object.assign(cur, u)
        })
      }
      if (g.add !== undefined && c.list('groups.add', g.add, MAX_GROUPS)) {
        g.add.forEach((x, i) => {
          const u = cleanGroup(c, `groups.add[${i}]`, x, members, { needId: false })
          if (!u?.name || !u.apps) return
          if (next.groups.length >= MAX_GROUPS) return c.fail(`groups.add[${i}]`, `there are already ${MAX_GROUPS} groups`)
          let id = u.id
          if (id && next.groups.some(s => s.id === id)) return c.fail(`groups.add[${i}].id`, `repeats ${id}`)
          if (!id) { const base = `group-${slug(u.name)}`; id = base; for (let n = 2; next.groups.some(s => s.id === id); n++) id = `${base}-${n}` }
          // The group takes the place of its first app on Home.
          const first = next.apps.findIndex(a => u.apps.includes(a))
          next.apps = next.apps.filter(a => !u.apps.includes(a))
          next.apps.splice(first < 0 ? next.apps.length : first, 0, id)
          next.groups.push({ id, name: u.name, apps: u.apps })
        })
      }
    }
  }
  const APPS = [...allApps(here), ...siteIds(next), ...groupIds(next)]

  if (body.apps !== undefined) {
    const a = body.apps
    if (Array.isArray(a)) { if (c.ids('apps', a, APPS)) next.apps = [...a] }
    else if (c.obj('apps', a, ['add', 'remove'])) {
      if (a.remove !== undefined && c.ids('apps.remove', a.remove, APPS)) next.apps = next.apps.filter(x => !a.remove.includes(x))
      if (a.add !== undefined && c.ids('apps.add', a.add, APPS)) next.apps = [...next.apps, ...a.add.filter(x => !next.apps.includes(x))]
    }
  }

  // Every app sits in one place: on Home or in one group. A group needs an app and a place on Home.
  {
    const ok = new Set([...allApps(here), ...siteIds(next)]), used = new Set()
    next.groups = (next.groups || []).map(g => ({ ...g, apps: g.apps.filter(a => ok.has(a) && !used.has(a) && used.add(a)) })).filter(g => g.apps.length)
    const gids = groupIds(next)
    next.apps = next.apps.filter(a => gids.includes(a) || (ok.has(a) && !used.has(a)))
    for (const id of gids) if (!next.apps.includes(id)) next.apps.push(id)
  }

  if (body.widgets !== undefined && c.obj('widgets', body.widgets, ['desktop', 'mobile', 'add', 'remove', 'reset'])) {
    const w = body.widgets
    if (w.reset !== undefined && c.oneOf('widgets.reset', w.reset, ['desktop', 'mobile', 'both'])) for (const vk of ['desktop', 'mobile']) if (w.reset === 'both' || w.reset === vk) next.widgets[vk] = seedLayout(vk)
    for (const vk of ['desktop', 'mobile']) if (w[vk] !== undefined) { const l = cleanLayout(c, `widgets.${vk}`, w[vk]); if (l) next.widgets[vk] = l }
    if (w.remove !== undefined && c.list('widgets.remove', w.remove, 120)) {
      w.remove.forEach((x, i) => { if (typeof x !== 'string' || !(KEY_RE.test(x) || widgetIdOk(x))) c.fail(`widgets.remove[${i}]`, 'must be a widget key or a widget id') })
      const gone = it => w.remove.includes(it.key) || w.remove.includes(it.id)
      // A stack that drops to one widget becomes that widget.
      for (const vk of ['desktop', 'mobile']) next.widgets[vk] = next.widgets[vk].filter(it => !gone(it)).map(it => {
        if (it.id !== 'stack') return it
        const left = it.stack.filter(x => !gone(x))
        return left.length > 1 ? { ...it, stack: left } : left.length ? { ...left[0], size: it.size } : null
      }).filter(Boolean)
    }
    if (w.add !== undefined && c.list('widgets.add', w.add, 20)) {
      w.add.forEach((a, i) => {
        const p = `widgets.add[${i}]`
        if (!c.obj(p, a, ['id', 'size', 'layout', 'opts'])) return
        if (!widgetIdOk(a.id)) return c.fail(`${p}.id`, 'is not a known widget (see /api/hub/settings/catalog)')
        const size = a.size === undefined ? 's' : c.oneOf(`${p}.size`, a.size, SIZES)
        const layout = a.layout === undefined ? 'both' : c.oneOf(`${p}.layout`, a.layout, ['desktop', 'mobile', 'both'])
        const opts = a.opts === undefined ? undefined : cleanOpts(c, `${p}.opts`, a.id, a.opts)
        if (!size || !layout) return
        for (const vk of ['desktop', 'mobile']) {
          if (layout !== 'both' && layout !== vk) continue
          if (next.widgets[vk].filter(x => x.id !== 'app').length >= MAX_ITEMS) { c.fail(p, `would put more than ${MAX_ITEMS} widgets on the ${vk} layout`); continue }
          next.widgets[vk].push({ key: `a${crypto.randomBytes(4).toString('hex')}`, id: a.id, size, ...(opts && Object.keys(opts).length ? { opts } : {}) })
        }
      })
    }
  }

  // App places follow the apps on Home: one place per app, none for an app that left Home.
  for (const vk of ['desktop', 'mobile']) {
    const seen = new Set()
    next.widgets[vk] = (next.widgets[vk] || []).filter(it => it && (it.id !== 'app' || (next.apps.includes(it.app) && !seen.has(it.app) && seen.add(it.app))))
  }

  if (body.style !== undefined && c.obj('style', body.style, Object.keys(STYLE))) {
    for (const [k, v] of Object.entries(body.style)) {
      const s = STYLE[k], p = `style.${k}`
      if (!s) continue
      let out
      if (s.enum) out = c.oneOf(p, v, s.enum)
      else if (s.color) out = s.extra.includes(v) ? v : c.color(p, v)
      else out = c.int(p, v, s.min, s.max)
      if (out !== undefined) next.style[k] = out
    }
  }

  if (body.wallpaper !== undefined && c.obj('wallpaper', body.wallpaper, ['current', 'custom', 'addCustom', 'removeCustom'])) {
    const w = body.wallpaper
    if (w.custom !== undefined && c.list('wallpaper.custom', w.custom, MAX_CUSTOM)) next.wallpaper.custom = w.custom.map((x, i) => cleanCustom(c, `wallpaper.custom[${i}]`, x)).filter(Boolean)
    if (w.removeCustom !== undefined && c.list('wallpaper.removeCustom', w.removeCustom, MAX_CUSTOM)) {
      w.removeCustom.forEach((x, i) => { if (!next.wallpaper.custom.some(g => g.id === x)) c.fail(`wallpaper.removeCustom[${i}]`, 'is not a saved custom wallpaper') })
      next.wallpaper.custom = next.wallpaper.custom.filter(g => !w.removeCustom.includes(g.id))
      if (w.removeCustom.includes(next.wallpaper.current)) next.wallpaper.current = 'none'
    }
    if (w.addCustom !== undefined) {
      const g = cleanCustom(c, 'wallpaper.addCustom', w.addCustom)
      if (g) {
        if (next.wallpaper.custom.some(x => x.id === g.id)) c.fail('wallpaper.addCustom.id', `${g.id} already exists`)
        else if (next.wallpaper.custom.length >= MAX_CUSTOM) c.fail('wallpaper.addCustom', `there are already ${MAX_CUSTOM} custom wallpapers`)
        else next.wallpaper.custom.push(g)
      }
    }
    if (w.current !== undefined) {
      const known = ['none', ...BUILTIN_WALLPAPERS.map(x => x.id), ...next.wallpaper.custom.map(x => x.id), ...next.wallpaper.uploads.map(x => x.id)]
      if (c.oneOf('wallpaper.current', w.current, known) !== undefined) next.wallpaper.current = w.current
    }
    if (!['none', ...BUILTIN_WALLPAPERS.map(x => x.id), ...next.wallpaper.custom.map(x => x.id), ...next.wallpaper.uploads.map(x => x.id)].includes(next.wallpaper.current)) next.wallpaper.current = 'none'
  }

  c.done()
  return next
}

// Repair a stored file field by field: a broken part falls back to its default, the rest is kept.
function repair(saved, here) {
  const d = defaults(here)
  if (!saved || typeof saved !== 'object') return d
  const out = { ...d }
  const tryPart = (part, fn) => { try { fn() } catch {} }
  tryPart('tabs', () => { out.tabs = applyPatch(d, { tabs: { order: saved.tabs.order.filter(t => allTabs(here).includes(t)), hidden: saved.tabs.hidden.filter(t => allTabs(here).includes(t) && t !== 'home') } }, here).tabs })
  tryPart('sites', () => { out.sites = applyPatch(d, { sites: saved.sites.filter(x => x && SITE_ID_RE.test(x.id)) }, here).sites })
  tryPart('groups', () => { out.groups = applyPatch({ ...d, sites: out.sites, apps: [] }, { groups: saved.groups.filter(g => g && GROUP_ID_RE.test(g.id)) }, here).groups })
  tryPart('apps', () => { const ok = [...allApps(here), ...siteIds(out), ...groupIds(out)]; out.apps = applyPatch({ ...d, sites: out.sites, groups: out.groups }, { apps: saved.apps.filter(a => ok.includes(a)) }, here).apps })
  for (const vk of ['desktop', 'mobile']) tryPart(vk, () => { out.widgets = { ...out.widgets, [vk]: applyPatch(d, { widgets: { [vk]: saved.widgets[vk].filter(itemIdOk) } }, here).widgets[vk] } })
  for (const k of Object.keys(STYLE)) tryPart(k, () => { out.style = { ...out.style, [k]: applyPatch(d, { style: { [k]: saved.style[k] } }, here).style[k] } })
  tryPart('custom', () => { out.wallpaper = { ...out.wallpaper, custom: applyPatch(d, { wallpaper: { custom: saved.wallpaper.custom } }, here).wallpaper.custom } })
  out.wallpaper.uploads = (saved.wallpaper?.uploads || []).filter(u => u && UPLOAD_ID_RE.test(u.id) && UPLOAD_FILE_RE.test(u.file) && fs.existsSync(path.join(here, 'data', 'wallpapers', u.file))).slice(0, MAX_UPLOADS)
    .map(u => ({ id: u.id, name: String(u.name || 'Image').slice(0, 60), file: u.file, type: EXT_TYPE[u.file.split('.').pop()], bytes: Number(u.bytes) || 0, at: Number(u.at) || 0 }))
  const known = ['none', ...BUILTIN_WALLPAPERS.map(x => x.id), ...out.wallpaper.custom.map(x => x.id), ...out.wallpaper.uploads.map(x => x.id)]
  out.wallpaper.current = known.includes(saved.wallpaper?.current) ? saved.wallpaper.current : 'none'
  out.at = Number(saved.at) || 0
  return out
}

/* ---------- the store (one per hub folder; home.mjs shares it) ---------- */

const stores = new Map()
export function store(here) {
  if (stores.has(here)) return stores.get(here)
  const dataDir = path.join(here, 'data')
  const file = path.join(dataDir, 'hub-settings.json')
  const prev = path.join(dataDir, 'hub-settings.prev.json')
  const legacy = path.join(dataDir, 'home-layout.json')
  try { fs.mkdirSync(dataDir, { recursive: true }) } catch {}
  let cache = null

  function write(s) {
    const body = { ...s, at: Date.now() }
    const json = JSON.stringify(body, null, 2)
    try { if (fs.existsSync(file)) fs.copyFileSync(file, prev) } catch {}
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, json)
    try { fs.renameSync(tmp, file) } catch { fs.writeFileSync(file, json); try { fs.unlinkSync(tmp) } catch {} }
    cache = body
    return body
  }

  // First run: start from an old Home layout if there is one, so nothing is lost (a dated copy is kept).
  function migrate() {
    const d = defaults(here)
    try {
      const old = JSON.parse(fs.readFileSync(legacy, 'utf8'))
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      try { fs.copyFileSync(legacy, path.join(dataDir, `home-layout.backup-${stamp}.json`)) } catch {}
      for (const vk of ['desktop', 'mobile']) {
        try { d.widgets[vk] = applyPatch(d, { widgets: { [vk]: (old[vk] || []).filter(itemIdOk) } }, here).widgets[vk] } catch {}
      }
    } catch {}
    return write(d)
  }

  function get() {
    // A tabs/<name>.js added or removed re-reads, so the tab joins or leaves without a restart.
    const tabs = allTabs(here)
    if (cache && tabs.length === cache.tabs.order.length && tabs.every(t => cache.tabs.order.includes(t))) return cache
    let saved = null
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) {
      if (e.code === 'ENOENT') return migrate()
    }
    const fixed = repair(saved, here)
    // New plug-in tabs join the end of the saved order.
    for (const t of allTabs(here)) if (!fixed.tabs.order.includes(t)) fixed.tabs.order.push(t)
    cache = JSON.stringify(fixed) === JSON.stringify(saved) ? fixed : write(fixed)
    return cache
  }
  const patch = body => write(applyPatch(stripMeta(get()), body, here))
  const stripMeta = s => { const { at, ...rest } = s; return rest }

  const api = { get, patch, write: s => write(s), file, dataDir }
  stores.set(here, api)
  return api
}

/* ---------- HTTP ---------- */

async function readJson(req, max) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > max) throw Object.assign(new Error(`body is larger than ${max / 1024} KB`), { code: 413 })
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { throw Object.assign(new Error('body is not valid JSON'), { code: 400 }) }
}

async function readRaw(req, max) {
  const len = Number(req.headers['content-length'])
  if (len > max) throw Object.assign(new Error('the image is larger than 10 MB'), { code: 413 })
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > max) throw Object.assign(new Error('the image is larger than 10 MB'), { code: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export function catalog(here) {
  return {
    tabs: allTabs(here), builtinTabs: BUILTIN_TABS, pluginTabs: pluginTabs(here), apps: allApps(here),
    sites: { idPattern: SITE_ID_RE.source, max: MAX_SITES, suggestions: [...hubConfig().siteSuggestions, ...SITE_SUGGESTIONS] },
    groups: { idPattern: GROUP_ID_RE.source, max: MAX_GROUPS, maxApps: MAX_IN_GROUP },
    widgets: { ids: WIDGET_IDS, families: WIDGET_FAMILIES.map(f => `${f}.<key>`), sizes: SIZES, options: WIDGET_OPTIONS, maxPerLayout: MAX_ITEMS, stack: { id: 'stack', min: 2, max: MAX_STACK }, app: { id: 'app', note: 'an app place: { id: "app", app: <id on Home> }' } },
    style: STYLE,
    wallpapers: { builtin: BUILTIN_WALLPAPERS, maxCustom: MAX_CUSTOM, maxUploads: MAX_UPLOADS, uploadTypes: Object.keys(IMAGE_TYPES), uploadMaxBytes: MAX_UPLOAD },
    reset: ['tabs', 'apps', 'widgets', 'style', 'wallpaper', 'all'],
  }
}

export function create({ here }) {
  const st = store(here)
  const upDir = path.join(st.dataDir, 'wallpapers')
  const wallDir = path.join(here, 'wallpapers')

  return async function route(url, req, res, { send }) {
    const p = url.pathname
    const fail = (e, code = e.code) => send(res, [400, 404, 413, 415].includes(code) ? code : e instanceof Bad ? 400 : 500, { error: e.message, ...(e.errors ? { errors: e.errors } : {}) })
    try {
      if (p === '/api/hub/settings') {
        if (req.method === 'GET') return send(res, 200, st.get()), true
        if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true
        if (!/application\/json/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'send JSON with content-type: application/json' }), true
        const body = await readJson(req, MAX_BODY)
        return send(res, 200, st.patch(body)), true
      }
      if (p === '/api/hub/settings/catalog' && req.method === 'GET') return send(res, 200, catalog(here)), true

      if (p === '/api/hub/wallpapers' && req.method === 'POST') {
        const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
        if (!IMAGE_TYPES[type]) return send(res, 415, { error: `only images can be uploaded: ${Object.keys(IMAGE_TYPES).join(', ')}` }), true
        const cur = st.get()
        if (cur.wallpaper.uploads.length >= MAX_UPLOADS) return send(res, 400, { error: `there are already ${MAX_UPLOADS} uploaded wallpapers; remove one first` }), true
        const buf = await readRaw(req, MAX_UPLOAD)
        if (!buf.length) return send(res, 400, { error: 'the image is empty' }), true
        const real = sniff(buf)
        if (real !== type) return send(res, 415, { error: 'that file is not the image type it says it is' }), true
        let name = 'Image'
        try { name = decodeURIComponent(String(req.headers['x-name'] || 'Image')).replace(/[\u0000-\u001f<>]/g, '').slice(0, 60) || 'Image' } catch {}
        const id = `upload-${crypto.randomBytes(6).toString('hex')}`
        const fileName = `${id}.${IMAGE_TYPES[type]}`
        fs.mkdirSync(upDir, { recursive: true })
        fs.writeFileSync(path.join(upDir, fileName), buf)
        const next = structuredClone(cur)
        delete next.at
        next.wallpaper.uploads.push({ id, name, file: fileName, type, bytes: buf.length, at: Date.now() })
        if (req.headers['x-select'] === '1') next.wallpaper.current = id
        const saved = st.write(next)
        return send(res, 200, { id, url: `/api/hub/wallpapers/${fileName}`, settings: saved }), true
      }
      if (p === '/api/hub/wallpapers/remove' && req.method === 'POST') {
        const body = await readJson(req, 4096)
        const cur = st.get()
        const u = cur.wallpaper.uploads.find(x => x.id === body?.id)
        if (!u || typeof body.id !== 'string' || Object.keys(body).length !== 1) return send(res, 400, { error: 'send { id } of an uploaded wallpaper' }), true
        const bin = path.join(upDir, '.removed')
        fs.mkdirSync(bin, { recursive: true })
        try { fs.renameSync(path.join(upDir, u.file), path.join(bin, `${Date.now()}-${u.file}`)) } catch {}
        const next = structuredClone(cur)
        delete next.at
        next.wallpaper.uploads = next.wallpaper.uploads.filter(x => x.id !== u.id)
        if (next.wallpaper.current === u.id) next.wallpaper.current = 'none'
        return send(res, 200, st.write(next)), true
      }
      const up = /^\/api\/hub\/wallpapers\/([^/]+)$/.exec(p)
      if (up && req.method === 'GET') {
        const m = UPLOAD_FILE_RE.exec(up[1])
        if (!m || !st.get().wallpaper.uploads.some(x => x.file === up[1])) return send(res, 404, { error: 'not found' }), true
        const buf = fs.readFileSync(path.join(upDir, up[1]))
        res.writeHead(200, { 'content-type': EXT_TYPE[m[2]], 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' })
        return res.end(buf), true
      }
      const wp = /^\/wallpapers\/([a-z-]+)\.svg$/.exec(p)
      if (wp && req.method === 'GET') {
        if (!BUILTIN_WALLPAPERS.some(x => x.id === wp[1])) return send(res, 404, { error: 'not found' }), true
        const buf = fs.readFileSync(path.join(wallDir, `${wp[1]}.svg`))
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff' })
        return res.end(buf), true
      }
    } catch (e) {
      fail(e)
      return true
    }
    return false
  }
}
