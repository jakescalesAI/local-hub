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
const NOT_TABS = new Set(['home', 'chat', 'custom', 'setup', 'launcher', 'browser']) // files in tabs/ that are not plug-in tabs
const QUIET_TABS = ['connections'] // reached from Settings; stays out of the header until someone adds it
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
const MAX_PAGES = 40
const MAX_FILES = 60
const MAX_FILE = 512 * 1024
const MAX_IMPORT = 40 * 2 ** 20
const EXPORT_FORMAT = 'local-hub-settings'
export const PAGE_ID_RE = /^page-[a-z0-9-]{1,32}$/
export const FILE_ID_RE = /^file-[a-z0-9]{6,24}$/
// What a custom file may do: run its own code and show its own page, in an origin of its own.
// It can reach nothing: not the hub's API, not the network, not the page around it.
const FILE_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; form-action 'none'; base-uri 'none'"
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
  font: { enum: ['system', 'rounded', 'serif', 'mono'], default: 'system' },
  density: { enum: ['compact', 'regular', 'roomy'], default: 'regular' },
}

// The default look lives in themes/default.json: style defaults, these wallpapers, the icon.
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
const pageIds = s => (s.pages || []).map(p => p.id)
const stripMeta = s => { const { at, ...rest } = s; return structuredClone(rest) }
const cleanFileName = v => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || 'File'
const cleanSizes = l => { const out = ['s', 'm', 'l'].filter(x => Array.isArray(l) && l.includes(x)); return out.length ? out : ['s', 'm', 'l'] }
const blankViews = () => Object.fromEntries(VIEWS.map(vk => [vk, []]))
// Take a widget off a layout, out of stacks too. A stack left with one widget becomes that widget.
const dropWidget = (l, id) => l.flatMap(it => {
  if (it.id === id) return []
  if (it.id !== 'stack' || !it.stack?.some(x => x.id === id)) return [it]
  const stack = it.stack.filter(x => x.id !== id)
  return stack.length > 1 ? [{ ...it, stack }] : stack
})
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
const allApps = here => [...allTabs(here).filter(t => t !== 'home'), 'chat', 'tv']
const siteIds = s => (s.sites || []).map(x => x.id)
const groupIds = s => (s.groups || []).map(x => x.id)

/* ---------- defaults ---------- */

// Each view keeps its own layout. iPad starts as a copy of Desktop, reflowed to fit. TV is what
// LocalHub TV shows on its Top Shelf (tv/ui), so it starts small.
const VIEWS = ['desktop', 'ipad', 'mobile', 'tv']
// How each view moves through what doesn't fit: sideways a page at a time, or one long vertical scroll.
// The TV scrolls down through its rows like tvOS; the others page like an iPhone.
export const SCROLLS = ['pages', 'infinite']
export const SCROLL_DEFAULT = { desktop: 'pages', ipad: 'pages', mobile: 'pages', tv: 'infinite' }
// LocalHub TV's own choices: its app tiles in order (`apps`) and the ones it leaves out (`hidden`).
// Ids are the TV's: a stand-in id on a laptop (netflix, plex…), a package name on a Fire TV. An app
// in neither list (new, or from another TV) shows after the listed ones; both empty is the default order.
const TV_APP_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const MAX_TV_APPS = 200

const WIDGET_DEFAULTS = {
  desktop: [['claude-usage', 'm'], ['clock', 's'], ['next-event', 's'], ['tokens', 'm'], ['coolify', 's'], ['services', 's'], ['today', 'm'], ['stripe-balance', 's'], ['openrouter', 's'], ['server-health', 'm'], ['deepseek', 's'], ['icloud', 's'], ['drives', 'm'], ['backup-drive', 's'], ['laptop-health', 's'], ['servers', 'l'], ['revenue', 'm'], ['clients', 'm']],
  tv: [['clock', 's'], ['date', 's'], ['world-clock', 's'], ['next-event', 's'], ['claude-usage', 's']],
  mobile: [['claude-usage', 's'], ['clock', 's'], ['next-event', 's'], ['coolify', 's'], ['today', 'm'], ['tokens', 'm'], ['openrouter', 's'], ['deepseek', 's'], ['stripe-balance', 's'], ['icloud', 's'], ['server-health', 'm'], ['drives', 'm'], ['services', 's'], ['backup-drive', 's'], ['servers', 'm']],
}
// Which add-on a default widget needs. With few add-ons on, a hub starts from the plain layout below.
const WIDGET_NEEDS = { 'claude-usage': 'ai', tokens: 'ai', openrouter: 'ai', deepseek: 'ai', 'next-event': 'calendar', today: 'calendar', coolify: 'cloud', servers: 'cloud', clients: 'cloud', services: 'laptop', 'laptop-health': 'laptop', 'server-health': 'server', 'stripe-balance': 'stripe', revenue: 'stripe', icloud: 'icloud', drives: 'drives', 'backup-drive': 'drives' }
const WIDGET_PLAIN = {
  desktop: [['clock', 's'], ['date', 's'], ['world-clock', 's']],
  mobile: [['clock', 's'], ['date', 's'], ['world-clock', 'm']],
  tv: [['clock', 's'], ['date', 's'], ['world-clock', 's']],
}
const startLayout = name => {
  const from = name === 'ipad' ? 'desktop' : name
  const on = WIDGET_DEFAULTS[from].filter(([id]) => !WIDGET_NEEDS[id] || addonOn(WIDGET_NEEDS[id]))
  return on.length >= (from === 'tv' ? 3 : 4) ? on : WIDGET_PLAIN[from]
}
export const seedLayout = name => startLayout(name).map(([id, size], i) => ({ key: `${name[0]}${i + 1}-${id}`.slice(0, 40), id, size }))
const defaultStyle = () => ({ ...Object.fromEntries(Object.entries(STYLE).map(([k, v]) => [k, v.default])), ...activeTheme().style })
const defaults = here => ({
  version: 1,
  tabs: { order: allTabs(here), hidden: QUIET_TABS.filter(t => allTabs(here).includes(t)), names: {} },
  apps: allApps(here),
  sites: [],
  groups: [],
  widgets: Object.fromEntries(VIEWS.map(vk => [vk, seedLayout(vk)])),
  pages: [],
  files: [],
  style: defaultStyle(),
  wallpaper: { current: activeTheme().wallpaper || 'none', custom: [], uploads: [] },
  scroll: { ...SCROLL_DEFAULT },
  tv: { apps: [], hidden: [] },
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

// x-<name> is your own widget, from a tab file (HUB-GUIDE.md, "Extending the hub").
const widgetIdOk = id => typeof id === 'string' && (WIDGET_IDS.includes(id) || FAMILY_RE.test(id) || /^x-[a-z0-9-]{1,40}$/.test(id) || FILE_ID_RE.test(id))
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
    // br: this item starts a new Home page.
    if (it?.br !== undefined && it.br !== true) c.fail(`${q}.br`, 'must be true or left out')
    const br = it?.br ? { br: true } : {}
    // An app's place among the widgets: { id: "app", app }. Apps not on Home are dropped after the patch.
    if (it?.id === 'app') {
      if (!c.obj(q, it, ['key', 'id', 'app', 'br'])) return null
      if (typeof it.app !== 'string' || !APP_REF_RE.test(it.app)) return c.fail(`${q}.app`, 'must be an app id'), null
      return { id: 'app', app: it.app, ...br }
    }
    if (!c.obj(q, it, ['key', 'id', 'size', 'opts', 'stack', 'br'])) return null
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
      return { key: it.key, id: 'stack', size: it.size, ...br, stack }
    }
    if (it.stack !== undefined) c.fail(`${q}.stack`, 'is only for items with id "stack"')
    if (!widgetIdOk(it.id)) c.fail(`${q}.id`, `is not a known widget (see /api/hub/settings/catalog)`)
    const out = { key: it.key, id: it.id, size: it.size, ...br }
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
  const keys = partial || needId ? ['id', 'name', 'url', 'file', 'icon', 'newTab'] : ['id', 'name', 'url', 'file', 'icon', 'newTab', 'onHome']
  if (!c.obj(p, w, keys)) return null
  const out = {}
  if (w.id !== undefined || needId) { if (typeof w.id !== 'string' || !SITE_ID_RE.test(w.id)) c.fail(`${p}.id`, 'must look like site-<1-32 lowercase letters, digits or ->'); else out.id = w.id }
  if (w.name !== undefined || !partial) { const n = c.text(`${p}.name`, w.name, 40); if (n) out.name = n }
  if (w.file !== undefined) { if (typeof w.file !== 'string' || !FILE_ID_RE.test(w.file)) c.fail(`${p}.file`, 'must be a custom file id'); else out.file = w.file }
  if (w.url !== undefined || (!partial && w.file === undefined)) { const u = webUrl(w.url); if (!u) c.fail(`${p}.url`, 'must be an http or https address of up to 500 characters'); else out.url = u }
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
  next.pages = next.pages || []
  next.scroll = { ...SCROLL_DEFAULT, ...(next.scroll || {}) }
  next.tv = { apps: [], hidden: [], ...(next.tv || {}) }
  if (!c.obj('body', body, ['tabs', 'apps', 'sites', 'groups', 'pages', 'widgets', 'scroll', 'tv', 'style', 'wallpaper', 'reset'])) c.done()
  if (!Object.keys(body).length) c.fail('body', 'is empty: send at least one of tabs, apps, sites, groups, pages, widgets, scroll, tv, style, wallpaper, reset')

  if (body.reset !== undefined) {
    const parts = ['tabs', 'apps', 'widgets', 'scroll', 'tv', 'style', 'wallpaper', 'pages', 'all']
    const r = c.ids('reset', body.reset, parts, parts.length)
    const d = defaults(here)
    for (const k of r || []) for (const part of k === 'all' ? parts.filter(x => x !== 'all') : [k]) next[part] = part === 'wallpaper' ? { ...d.wallpaper, custom: next.wallpaper.custom, uploads: next.wallpaper.uploads } : d[part]
    if (r?.includes('apps') || r?.includes('all')) next.groups = []
  }

  // Extra Home pages: { id: page-<name>, name, widgets: { desktop, ipad, mobile, tv } }. Home itself stays in `widgets`.
  if (body.pages !== undefined && c.obj('pages', body.pages, ['list', 'add', 'rename', 'remove', 'order', 'layout'])) {
    const g = body.pages
    const views = (p, w) => Object.fromEntries(VIEWS.map(vk => [vk, (w?.[vk] === undefined ? [] : cleanLayout(c, `${p}.${vk}`, w[vk])) || []]))
    const pageId = (p, id) => { if (typeof id !== 'string' || !PAGE_ID_RE.test(id)) { c.fail(p, 'must look like page-<1-32 lowercase letters, digits or ->'); return null } return id }
    if (g.list !== undefined && c.list('pages.list', g.list, MAX_PAGES)) {
      next.pages = g.list.map((x, i) => {
        const p = `pages.list[${i}]`
        if (!c.obj(p, x, ['id', 'name', 'widgets'])) return null
        const id = pageId(`${p}.id`, x.id), name = c.text(`${p}.name`, x.name, 24)
        return id && name ? { id, name, widgets: views(p, x.widgets) } : null
      }).filter(Boolean)
      if (new Set(pageIds(next)).size !== next.pages.length) c.fail('pages.list', 'repeats a page id')
    }
    if (g.add !== undefined && c.obj('pages.add', g.add, ['id', 'name'])) {
      const name = c.text('pages.add.name', g.add.name, 24)
      const id = g.add.id === undefined ? `page-${crypto.randomBytes(4).toString('hex')}` : pageId('pages.add.id', g.add.id)
      if (next.pages.length >= MAX_PAGES) c.fail('pages.add', `there are already ${MAX_PAGES} pages`)
      else if (id && pageIds(next).includes(id)) c.fail('pages.add.id', `${id} already exists`)
      else if (id && name) next.pages.push({ id, name, widgets: blankViews() })
    }
    if (g.rename !== undefined && c.obj('pages.rename', g.rename, ['id', 'name'])) {
      const pg = next.pages.find(x => x.id === g.rename.id), name = c.text('pages.rename.name', g.rename.name, 24)
      if (!pg) c.fail('pages.rename.id', 'is not a page')
      else if (name) pg.name = name
    }
    if (g.remove !== undefined && c.ids('pages.remove', g.remove, pageIds(next), MAX_PAGES)) next.pages = next.pages.filter(x => !g.remove.includes(x.id))
    if (g.order !== undefined && c.ids('pages.order', g.order, pageIds(next), MAX_PAGES)) next.pages = [...g.order.map(id => next.pages.find(x => x.id === id)), ...next.pages.filter(x => !g.order.includes(x.id))]
    if (g.layout !== undefined && c.obj('pages.layout', g.layout, ['id', ...VIEWS])) {
      const pg = next.pages.find(x => x.id === g.layout.id)
      if (!pg) c.fail('pages.layout.id', 'is not a page')
      else for (const vk of VIEWS) if (g.layout[vk] !== undefined) { const l = cleanLayout(c, `pages.layout.${vk}`, g.layout[vk]); if (l) pg.widgets[vk] = l }
    }
  }

  if (body.tabs !== undefined && c.obj('tabs', body.tabs, ['order', 'hidden', 'hide', 'show', 'names'])) {
    const t = body.tabs, ITEMS = [...TABS, 'chat', ...siteIds(next), ...pageIds(next)]
    if (t.order !== undefined && c.ids('tabs.order', t.order, ITEMS, 80)) next.tabs.order = [...t.order, ...TABS.filter(x => !t.order.includes(x))]
    if (t.names !== undefined && c.obj('tabs.names', t.names, ITEMS)) {
      const names = {}
      for (const [id, v] of Object.entries(t.names)) { const n = c.text(`tabs.names.${id}`, v, 24); if (n) names[id] = n }
      next.tabs.names = names
    }
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

  if (body.sites !== undefined) {
    const gone = id => id.startsWith('site-') && !next.sites.some(x => x.id === id)
    next.tabs.order = next.tabs.order.filter(x => !gone(x))
    next.tabs.names = Object.fromEntries(Object.entries(next.tabs.names || {}).filter(([id]) => !gone(id)))
  }

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

  if (body.widgets !== undefined && c.obj('widgets', body.widgets, [...VIEWS, 'add', 'remove', 'reset'])) {
    const w = body.widgets
    if (w.reset !== undefined && c.oneOf('widgets.reset', w.reset, [...VIEWS, 'both'])) for (const vk of VIEWS) if (w.reset === 'both' || w.reset === vk) next.widgets[vk] = seedLayout(vk)
    for (const vk of VIEWS) if (w[vk] !== undefined) { const l = cleanLayout(c, `widgets.${vk}`, w[vk]); if (l) next.widgets[vk] = l }
    if (w.remove !== undefined && c.list('widgets.remove', w.remove, 120)) {
      w.remove.forEach((x, i) => { if (typeof x !== 'string' || !(KEY_RE.test(x) || widgetIdOk(x))) c.fail(`widgets.remove[${i}]`, 'must be a widget key or a widget id') })
      const gone = it => w.remove.includes(it.key) || w.remove.includes(it.id)
      // A stack that drops to one widget becomes that widget.
      for (const vk of VIEWS) next.widgets[vk] = next.widgets[vk].filter(it => !gone(it)).map(it => {
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
        const layout = a.layout === undefined ? 'both' : c.oneOf(`${p}.layout`, a.layout, [...VIEWS, 'both'])
        const opts = a.opts === undefined ? undefined : cleanOpts(c, `${p}.opts`, a.id, a.opts)
        if (!size || !layout) return
        for (const vk of VIEWS) {
          if (layout !== 'both' && layout !== vk) continue
          if (next.widgets[vk].filter(x => x.id !== 'app').length >= MAX_ITEMS) { c.fail(p, `would put more than ${MAX_ITEMS} widgets on the ${vk} layout`); continue }
          next.widgets[vk].push({ key: `a${crypto.randomBytes(4).toString('hex')}`, id: a.id, size, ...(opts && Object.keys(opts).length ? { opts } : {}) })
        }
      })
    }
  }

  // A page holds its own app places, for any app that exists. A page that is gone leaves the header too.
  {
    const ok = new Set([...allApps(here), ...siteIds(next), ...groupIds(next)]), ids = pageIds(next)
    for (const pg of next.pages) for (const vk of VIEWS) { const seen = new Set(); pg.widgets[vk] = (pg.widgets[vk] || []).filter(it => it && (it.id !== 'app' || (ok.has(it.app) && !seen.has(it.app) && seen.add(it.app)))) }
    const gone = id => id.startsWith('page-') && !ids.includes(id)
    next.tabs.order = next.tabs.order.filter(id => !gone(id))
    if (next.tabs.names) next.tabs.names = Object.fromEntries(Object.entries(next.tabs.names).filter(([id]) => !gone(id)))
  }

  // App places follow the apps on Home: one place per app, none for an app that left Home.
  for (const vk of VIEWS) {
    const seen = new Set()
    next.widgets[vk] = (next.widgets[vk] || []).filter(it => it && (it.id !== 'app' || (next.apps.includes(it.app) && !seen.has(it.app) && seen.add(it.app))))
  }

  // Pages or one long scroll, per view: { desktop?, ipad?, mobile?, tv? }.
  if (body.scroll !== undefined && c.obj('scroll', body.scroll, VIEWS)) {
    for (const [vk, v] of Object.entries(body.scroll)) if (VIEWS.includes(vk) && c.oneOf(`scroll.${vk}`, v, SCROLLS) !== undefined) next.scroll[vk] = v
  }

  // LocalHub TV: { apps?: [ids in order] | null, hidden?: [ids] }. null or [] puts back the default order.
  if (body.tv !== undefined && c.obj('tv', body.tv, ['apps', 'hidden'])) {
    for (const k of ['apps', 'hidden']) {
      const v = body.tv[k]
      if (v === undefined) continue
      if (v === null) { next.tv[k] = []; continue }
      if (!c.list(`tv.${k}`, v, MAX_TV_APPS)) continue
      const seen = new Set()
      v.forEach((x, i) => {
        if (typeof x !== 'string' || !TV_APP_RE.test(x)) c.fail(`tv.${k}[${i}]`, 'must be a TV app id: letters, digits, . _ : or -, up to 128')
        else if (seen.has(x)) c.fail(`tv.${k}[${i}]`, `repeats ${x}`)
        seen.add(x)
      })
      next.tv[k] = [...v]
    }
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
  tryPart('sites', () => { out.sites = applyPatch(d, { sites: saved.sites.filter(x => x && SITE_ID_RE.test(x.id)) }, here).sites })
  tryPart('tabs', () => {
    const stubs = (Array.isArray(saved.pages) ? saved.pages : []).filter(p => p && PAGE_ID_RE.test(p.id)).map(p => ({ id: p.id, name: 'Page', widgets: blankViews() }))
    const items = [...allTabs(here), 'chat', ...siteIds(out), ...pageIds({ pages: stubs })]
    out.tabs = applyPatch({ ...d, sites: out.sites, pages: stubs }, { tabs: { order: saved.tabs.order.filter(t => items.includes(t)), hidden: saved.tabs.hidden.filter(t => allTabs(here).includes(t) && t !== 'home') } }, here).tabs
    if (saved.tabs.names) out.tabs = applyPatch({ ...d, sites: out.sites, pages: stubs, tabs: out.tabs }, { tabs: { names: Object.fromEntries(Object.entries(saved.tabs.names).filter(([id]) => items.includes(id))) } }, here).tabs
  })
  tryPart('groups', () => { out.groups = applyPatch({ ...d, sites: out.sites, apps: [] }, { groups: saved.groups.filter(g => g && GROUP_ID_RE.test(g.id)) }, here).groups })
  tryPart('apps', () => { const ok = [...allApps(here), ...siteIds(out), ...groupIds(out)]; out.apps = applyPatch({ ...d, sites: out.sites, groups: out.groups }, { apps: saved.apps.filter(a => ok.includes(a)) }, here).apps })
  tryPart('pages', () => { out.pages = applyPatch({ ...d, sites: out.sites, groups: out.groups, apps: out.apps }, { pages: { list: saved.pages.filter(p => p && PAGE_ID_RE.test(p.id)).map(p => ({ id: p.id, name: p.name, widgets: Object.fromEntries(VIEWS.map(vk => [vk, (p.widgets?.[vk] ?? p.widgets?.desktop ?? []).filter(itemIdOk)])) })) } }, here).pages })
  out.files = (Array.isArray(saved.files) ? saved.files : []).filter(f => f && FILE_ID_RE.test(f.id) && fs.existsSync(path.join(here, 'data', 'custom', `${f.id}.html`))).slice(0, MAX_FILES)
    .map(f => ({ id: f.id, name: String(f.name || 'File').slice(0, 40), sizes: cleanSizes(f.sizes), at: Number(f.at) || 0 }))
  for (const vk of VIEWS) tryPart(vk, () => { out.widgets = { ...out.widgets, [vk]: applyPatch(d, { widgets: { [vk]: (saved.widgets[vk] ?? (vk === 'tv' ? seedLayout('tv') : saved.widgets.desktop)).filter(itemIdOk) } }, here).widgets[vk] } })
  tryPart('scroll', () => { out.scroll = applyPatch(d, { scroll: Object.fromEntries(Object.entries(saved.scroll || {}).filter(([vk, v]) => VIEWS.includes(vk) && SCROLLS.includes(v))) }, here).scroll })
  for (const k of ['apps', 'hidden']) tryPart(`tv.${k}`, () => { out.tv = { ...out.tv, [k]: applyPatch(d, { tv: { [k]: [...new Set((saved.tv?.[k] || []).filter(x => typeof x === 'string' && TV_APP_RE.test(x)))].slice(0, MAX_TV_APPS) } }, here).tv[k] } })
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
      for (const vk of VIEWS) {
        try { d.widgets[vk] = applyPatch(d, { widgets: { [vk]: (old[vk] || old.desktop || []).filter(itemIdOk) } }, here).widgets[vk] } catch {}
      }
    } catch {}
    return write(d)
  }

  function get() {
    // A tabs/<name>.js added or removed re-reads, so the tab joins or leaves without a restart.
    const tabs = allTabs(here)
    const listed = cache?.tabs.order.filter(t => t !== 'chat' && !t.startsWith('site-') && !t.startsWith('page-'))
    if (cache && tabs.length === listed.length && tabs.every(t => listed.includes(t))) return cache
    let saved = null
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) {
      if (e.code === 'ENOENT') return migrate()
    }
    const fixed = repair(saved, here)
    // New plug-in tabs join the end of the saved order.
    for (const t of allTabs(here)) if (!fixed.tabs.order.includes(t)) fixed.tabs.order.push(t)
    // Seen for the first time, a quiet tab starts hidden; after that the owner's choice stands.
    for (const t of QUIET_TABS) if (saved?.tabs?.order && !saved.tabs.order.includes(t) && tabs.includes(t) && !fixed.tabs.hidden.includes(t)) fixed.tabs.hidden.push(t)
    cache = JSON.stringify(fixed) === JSON.stringify(saved) ? fixed : write(fixed)
    return cache
  }
  // Undo puts back the settings from before the last save. Undoing again redoes it.
  function undo() {
    let before
    try { before = JSON.parse(fs.readFileSync(prev, 'utf8')) } catch { throw Object.assign(new Bad('there is nothing to undo yet'), { code: 400 }) }
    return write(stripMeta(repair(before, here)))
  }
  const patch = body => (body?.undo === true && Object.keys(body).length === 1 ? undo() : write(applyPatch(stripMeta(get()), body, here)))

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

async function readRaw(req, max, tooBig = 'the image is larger than 10 MB') {
  const len = Number(req.headers['content-length'])
  if (len > max) throw Object.assign(new Error(tooBig), { code: 413 })
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > max) throw Object.assign(new Error(tooBig), { code: 413 })
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
    scroll: { views: VIEWS, values: SCROLLS, default: SCROLL_DEFAULT },
    tv: { apps: 'the TV app tiles in order, as the TV’s own app ids', hidden: 'TV app ids left off the TV', max: MAX_TV_APPS, note: 'apps in neither list show after the listed ones; send null or [] for the default order' },
    style: STYLE,
    wallpapers: { builtin: BUILTIN_WALLPAPERS, maxCustom: MAX_CUSTOM, maxUploads: MAX_UPLOADS, uploadTypes: Object.keys(IMAGE_TYPES), uploadMaxBytes: MAX_UPLOAD },
    pages: { idPattern: PAGE_ID_RE.source, max: MAX_PAGES, patch: ['list', 'add', 'rename', 'remove', 'order', 'layout'] },
    files: { idPattern: FILE_ID_RE.source, max: MAX_FILES, maxBytes: MAX_FILE, note: 'custom .html files are added by the owner from the page and run sandboxed with no keys' },
    undo: 'send { undo: true } to put back the settings from before the last save',
    reset: ['tabs', 'apps', 'widgets', 'scroll', 'tv', 'style', 'wallpaper', 'pages', 'all'],
  }
}

export function create({ here }) {
  const st = store(here)
  const upDir = path.join(st.dataDir, 'wallpapers')
  const wallDir = path.join(here, 'wallpapers')
  const fileDir = path.join(st.dataDir, 'custom')
  const fileOf = id => path.join(fileDir, `${id}.html`)

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

      // The whole hub's choices as one file. Settings hold no keys, and uploaded images stay here.
      if (p === '/api/hub/settings/export' && req.method === 'GET') {
        const s = st.get()
        const out = {
          format: EXPORT_FORMAT, version: 1,
          tabs: s.tabs, apps: s.apps, sites: s.sites, groups: s.groups, pages: s.pages, widgets: s.widgets, scroll: s.scroll, tv: s.tv, style: s.style,
          wallpaper: { current: s.wallpaper.uploads.some(u => u.id === s.wallpaper.current) ? 'none' : s.wallpaper.current, custom: s.wallpaper.custom },
          files: s.files.map(f => ({ ...f, html: fs.readFileSync(fileOf(f.id), 'utf8') })),
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="local-hub-settings.json"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        return res.end(JSON.stringify(out, null, 2)), true
      }
      if (p === '/api/hub/settings/import' && req.method === 'POST') {
        const b = await readJson(req, MAX_IMPORT)
        if (b?.format !== EXPORT_FORMAT) return send(res, 400, { error: 'that isn’t a LocalHub settings file' }), true
        // A wrong type refuses the whole file, so a bad one can't quietly empty a part of the hub.
        const isList = (o, k) => o?.[k] == null || Array.isArray(o[k])
        const isObject = k => b[k] == null || (typeof b[k] === 'object' && !Array.isArray(b[k]))
        const isNames = (o, k) => o?.[k] == null || o[k].every(x => typeof x === 'string')
        const lists = [[b, 'apps'], [b, 'groups'], [b, 'sites'], [b, 'pages'], [b, 'files'], [b.tabs, 'order'], [b.tabs, 'hidden'], [b.wallpaper, 'custom']]
        if (!lists.every(([o, k]) => isList(o, k)) || ![[b, 'apps'], [b.tabs, 'order'], [b.tabs, 'hidden']].every(([o, k]) => isNames(o, k)) || !['tabs', 'widgets', 'scroll', 'tv', 'style', 'wallpaper'].every(isObject)) return send(res, 400, { error: 'that settings file has the wrong shape' }), true
        const cur = stripMeta(st.get())
        const files = (Array.isArray(b.files) ? b.files : []).filter(f => f && FILE_ID_RE.test(f.id) && typeof f.html === 'string' && Buffer.byteLength(f.html) <= MAX_FILE).slice(0, MAX_FILES)
        const have = new Set(files.map(f => f.id))
        const start = { ...cur, files: [...cur.files.filter(f => !have.has(f.id)), ...files.map(f => ({ id: f.id, name: cleanFileName(f.name), sizes: cleanSizes(f.sizes), at: Date.now() }))].slice(0, MAX_FILES) }
        // What this hub doesn't have is left out; the rest is checked like any other change.
        const fileIds = new Set(start.files.map(f => f.id))
        const sites = (Array.isArray(b.sites) ? b.sites : []).filter(x => !x?.file || fileIds.has(x.file))
        const items = new Set([...allTabs(here), 'chat', ...sites.map(x => x?.id), ...(Array.isArray(b.pages) ? b.pages : []).map(x => x?.id)])
        const uses = it => !String(it?.id).startsWith('file-') || fileIds.has(it.id)
        const lay = l => (Array.isArray(l) ? l.filter(uses) : [])
        const tabs = b.tabs && typeof b.tabs === 'object' ? { order: (b.tabs.order || []).filter(t => items.has(t)), hidden: (b.tabs.hidden || []).filter(t => allTabs(here).includes(t) && t !== 'home'), names: Object.fromEntries(Object.entries(b.tabs.names || {}).filter(([id]) => items.has(id))) } : undefined
        const known = ['none', ...BUILTIN_WALLPAPERS.map(x => x.id), ...(b.wallpaper?.custom || []).map(x => x?.id), ...cur.wallpaper.uploads.map(x => x.id)]
        const change = {
          sites,
          pages: { list: (Array.isArray(b.pages) ? b.pages : []).map(x => ({ ...x, widgets: Object.fromEntries(VIEWS.map(vk => [vk, lay(x?.widgets?.[vk])])) })) },
          ...(tabs ? { tabs } : {}),
          ...(b.groups ? { groups: b.groups } : {}),
          ...(b.apps ? { apps: b.apps.filter(a => allApps(here).includes(a) || sites.some(x => x?.id === a) || b.groups?.some(g => g?.id === a)) } : {}),
          widgets: Object.fromEntries(VIEWS.map(vk => [vk, lay(b.widgets?.[vk] ?? b.widgets?.desktop)])),
          ...(b.scroll ? { scroll: Object.fromEntries(Object.entries(b.scroll).filter(([vk]) => VIEWS.includes(vk))) } : {}),
          ...(b.tv ? { tv: { apps: Array.isArray(b.tv.apps) ? b.tv.apps : [], hidden: Array.isArray(b.tv.hidden) ? b.tv.hidden : [] } } : {}),
          ...(b.style ? { style: b.style } : {}),
          wallpaper: { custom: b.wallpaper?.custom || [], current: known.includes(b.wallpaper?.current) ? b.wallpaper.current : 'none' },
        }
        // Checked first, so a refused file changes nothing on disk.
        const next = applyPatch(start, change, here)
        const bin = path.join(fileDir, '.removed')
        fs.mkdirSync(bin, { recursive: true })
        for (const f of files) {
          // A file this replaces moves aside, the same as removing it. Nothing is erased.
          if (fs.existsSync(fileOf(f.id)) && fs.readFileSync(fileOf(f.id), 'utf8') !== f.html) fs.renameSync(fileOf(f.id), path.join(bin, `${Date.now()}-${f.id}.html`))
          fs.writeFileSync(fileOf(f.id), f.html)
        }
        return send(res, 200, st.write(next)), true
      }

      // A custom file: one plain .html the owner adds from the page. It becomes a widget and an app.
      if (p === '/api/hub/custom' && req.method === 'POST') {
        const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
        if (type !== 'text/html') return send(res, 415, { error: 'choose an .html file' }), true
        const cur = stripMeta(st.get())
        if (cur.files.length >= MAX_FILES) return send(res, 400, { error: `there are already ${MAX_FILES} custom files; remove one first` }), true
        const buf = await readRaw(req, MAX_FILE, 'the file is larger than 512 KB')
        if (!buf.length) return send(res, 400, { error: 'the file is empty' }), true
        const html = buf.toString('utf8')
        let asked = ''
        try { asked = decodeURIComponent(String(req.headers['x-name'] || '')).replace(/\.html?$/i, '') } catch {}
        const name = cleanFileName(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || asked)
        const meta = /<meta[^>]+name=["']hub-sizes["'][^>]*>/i.exec(html)?.[0] || ''
        const sizes = cleanSizes((/content=["']([^"']*)["']/i.exec(meta)?.[1] || '').split(/[\s,]+/))
        const id = `file-${crypto.randomBytes(6).toString('hex')}`
        fs.mkdirSync(fileDir, { recursive: true })
        fs.writeFileSync(fileOf(id), buf)
        cur.files.push({ id, name, sizes, at: Date.now() })
        cur.sites.push({ id: `site-${id}`, name, file: id, newTab: false })
        return send(res, 200, { id, site: `site-${id}`, settings: st.write(cur) }), true
      }
      if (p === '/api/hub/custom/remove' && req.method === 'POST') {
        const body = await readJson(req, 4096)
        const cur = stripMeta(st.get())
        const f = cur.files.find(x => x.id === body?.id)
        if (!f || Object.keys(body).length !== 1) return send(res, 400, { error: 'send { id } of a custom file' }), true
        const bin = path.join(fileDir, '.removed')
        fs.mkdirSync(bin, { recursive: true })
        try { fs.renameSync(fileOf(f.id), path.join(bin, `${Date.now()}-${f.id}.html`)) } catch {}
        const sid = `site-${f.id}`
        cur.files = cur.files.filter(x => x.id !== f.id)
        cur.sites = cur.sites.filter(x => x.id !== sid)
        cur.apps = cur.apps.filter(x => x !== sid)
        cur.tabs.order = cur.tabs.order.filter(x => x !== sid)
        cur.groups = cur.groups.map(g => ({ ...g, apps: g.apps.filter(x => x !== sid) })).filter(g => g.apps.length)
        const clean = l => dropWidget(l, f.id).filter(it => it.app !== sid)
        for (const vk of VIEWS) cur.widgets[vk] = clean(cur.widgets[vk])
        for (const pg of cur.pages) for (const vk of VIEWS) pg.widgets[vk] = clean(pg.widgets[vk])
        return send(res, 200, st.write(cur)), true
      }
      const cf = /^\/api\/hub\/custom\/([a-z0-9-]+)$/.exec(p)
      if (cf && req.method === 'GET') {
        if (!FILE_ID_RE.test(cf[1]) || !st.get().files.some(f => f.id === cf[1])) return send(res, 404, { error: 'not found' }), true
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': FILE_CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' })
        return res.end(fs.readFileSync(fileOf(cf[1]))), true
      }

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
