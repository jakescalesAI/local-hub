// Hub Assistant's own tools: a tiny MCP server (JSON-RPC over stdio) that chat.mjs hands to the
// `claude -p` run with --mcp-config:
//
//   hub_read        { path }        GET /api/<path>: the hub's live data. Never a file's content.
//   settings_update { patch }       POST /api/hub/settings (the hub's look and layout only)
//   show_site       { url?, name? } shows a website to the user as a card in the chat
//   system_info     { folder? }     memory, top programs, or one folder's size
//   git_read        { repo, op, .. } git status, log or diff of a repo. Key files are left out.
//   file_op         { op, from, to } move, copy, rename or trash a file. Trash waits for a card.
//   hub_action      { name, args }  one of the hub's named actions. Some wait for a card.
//
// The settings API keeps the previous version in data/hub-settings.prev.json, so every change can
// be undone with another patch.
import { createInterface } from 'node:readline'

const PORT = Number(process.env.HUB_PORT) || 3100
const API = `http://127.0.0.1:${PORT}`
// Top-level settings keys the assistant may send. Wallpaper uploads (raw image bodies) are not here.
const KEYS = new Set(['tabs', 'apps', 'widgets', 'style', 'wallpaper', 'sites', 'reset'])

const READ_LIMIT = 200_000

const TOOLS = [
  {
    name: 'hub_read',
    description: 'Read live data from this hub: GET /api/<path>, for example /api/state or /api/hub/settings. The guide lists the paths. It returns data, never the content of a file; use Read for files.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'A hub API path starting with /api/, query string included' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'settings_update',
    description: 'Change the hub\'s look and layout through POST /api/hub/settings: tabs (hide/show/order), Home apps, widgets, style (theme, accent, widget look, blur, transparency, radius, shadow, tab bar, effect), wallpaper, website apps (sites) and reset. Send only the parts that change, exactly as the guide\'s "Settings API" section describes. A bad patch changes nothing and returns the errors. Use it only when the user asks for that change.',
    inputSchema: {
      type: 'object',
      properties: { patch: { type: 'object', description: 'Partial settings, e.g. {"tabs":{"hide":["stripe"]}} or {"style":{"widgetLook":"glass"}}' } },
      required: ['patch'],
      additionalProperties: false,
    },
  },
  {
    name: 'show_site',
    description: 'Show the user a website as a card in the chat: a live preview when the site allows it, otherwise an Open in New Tab card. Pass url, or name to use one of their saved website apps (settings "sites", e.g. "Coolify"). You cannot see, read or click anything inside the page.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'An http or https address' },
        name: { type: 'string', description: 'A saved website app name or id, or a label for the url' },
      },
      additionalProperties: false,
    },
  },
]

TOOLS.push(
  {
    name: 'system_info',
    description: 'Look at this computer: memory, platform and the programs using the most memory. Pass folder to get that folder\'s size and its largest items instead. Listening ports are in hub_read /api/state, and a folder\'s files are in hub_read /api/files/laptop?path=.',
    inputSchema: {
      type: 'object',
      properties: { folder: { type: 'string', description: 'A full path, or one starting with ~' } },
      additionalProperties: false,
    },
  },
  {
    name: 'git_read',
    description: 'Read a git repository: status, log or diff. It can\'t change anything. Key files are left out of a diff. A repo with settings in its own config that could run programs is refused.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'A folder in the repository: a full path, or one starting with ~' },
        op: { type: 'string', enum: ['status', 'log', 'diff'] },
        ref: { type: 'string', description: 'For log and diff: a branch, commit or range such as main..HEAD or abc123^!' },
        path: { type: 'string', description: 'Only this file or folder, relative to repo' },
        staged: { type: 'boolean', description: 'For diff: what is staged' },
        n: { type: 'number', description: 'For log: how many commits, 20 by default' },
      },
      required: ['repo', 'op'],
      additionalProperties: false,
    },
  },
)

TOOLS.push(
  {
    name: 'file_op',
    description: 'Move, copy, rename or trash a file or folder. Moves, renames and trash work inside workspace/ and assistant.writeFolders. Copies can come from any folder you can read and land in those. Nothing is overwritten, and a move can\'t cross drives. Key files, folders holding one, links, and places where files run as code (.git, .claude, startup folders, shell profiles) are refused. Trash waits for a card the user answers.',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['move', 'copy', 'rename', 'trash'] },
        from: { type: 'string', description: 'A full path, one starting with ~, or one relative to the hub folder such as workspace/notes.txt' },
        to: { type: 'string', description: 'For move and copy, the full new path including the name. For rename, just the new name.' },
      },
      required: ['op', 'from'],
      additionalProperties: false,
    },
  },
  {
    name: 'hub_action',
    description: 'Run one of the hub\'s named actions. refresh, refresh_ai, refresh_cloud, refresh_stripe and refresh_calendar read the latest numbers. calendar_add takes args { title, start, end, allDay, location, notes } and adds to the hub\'s own calendar. calendar_update takes id and any of those. calendar_delete takes id, and calendar_quick takes text and adds to the calendar set up for Quick Add: both wait for a card the user answers.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: ['refresh', 'refresh_ai', 'refresh_cloud', 'refresh_stripe', 'refresh_calendar', 'calendar_add', 'calendar_update', 'calendar_delete', 'calendar_quick'] },
        args: { type: 'object' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
)

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) })

async function hub(pathname, init = {}) {
  const r = await fetch(API + pathname, { ...init, headers: { 'x-hub': '1', ...(init.headers || {}) }, signal: AbortSignal.timeout(15e3) })
  let body = null
  try { body = await r.json() } catch {}
  return { status: r.status, body }
}

function webUrl(u) {
  try {
    const x = new URL(/^[a-z][\w+.-]*:/i.test(u) ? u : `https://${u}`)
    if ((x.protocol !== 'http:' && x.protocol !== 'https:') || x.username || x.password || x.href.length > 500) return null
    return x.href
  } catch { return null }
}

async function hubRead({ path } = {}) {
  let url
  try { url = new URL(String(path || '').replace(/^\/?/, '/'), API) } catch { return text('That isn\'t a hub path.', true) }
  // Parsed first, so a path like /api/../files/ can't step out of the API.
  if (url.origin !== API || !url.pathname.startsWith('/api/')) return text('hub_read only reads paths under /api/.', true)
  let plain = url.pathname + url.search
  try { plain = decodeURIComponent(plain) } catch {}
  if (/^\/api\/files\/[^/]+\/(text|write|raw)\b|secret/i.test(plain)) return text('File contents don\'t go through hub_read. Use Read, which keeps key files refused.', true)
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60e3) })
  if (!/json|text/i.test(r.headers.get('content-type') || '')) return text(`That path returns ${r.headers.get('content-type') || 'no text'}, which hub_read can't show.`, true)
  const body = await r.text()
  const shown = body.length > READ_LIMIT ? `${body.slice(0, READ_LIMIT)}\n[cut at ${READ_LIMIT} characters]` : body
  return text(r.ok ? shown : `HTTP ${r.status}: ${shown.slice(0, 2000)}`, !r.ok)
}

async function settingsUpdate({ patch } = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return text('patch must be an object.', true)
  const bad = Object.keys(patch).filter(k => !KEYS.has(k))
  if (bad.length) return text(`Not allowed: ${bad.join(', ')}. Only ${[...KEYS].join(', ')} can change.`, true)
  if (!Object.keys(patch).length) return text('Empty patch: nothing to change.', true)
  const prev = (await hub('/api/hub/settings').catch(() => ({}))).body || {}
  const { status, body } = await hub('/api/hub/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
  if (status !== 200) {
    const errs = Array.isArray(body?.errors) ? body.errors.map(e => `${e.path}: ${e.message}`).join('; ') : ''
    return text(`Not saved (HTTP ${status}). ${body?.error || ''}${errs ? ` ${errs}` : ''}`.trim(), true)
  }
  const keys = Object.keys(patch)
  // Changed keys plus whatever a reset touched, so "undo that" can send the Before values back.
  const touched = [...new Set([...keys.filter(k => k !== 'reset'), ...(Array.isArray(patch.reset) ? patch.reset : [])])].filter(k => KEYS.has(k))
  const pick = src => Object.fromEntries(touched.filter(k => src && k in src).map(k => [k, src[k]]))
  return text(`Saved. Changed: ${keys.join(', ')}. The page shows it within a few seconds. Before: ${JSON.stringify(pick(prev)).slice(0, 1500)} Now: ${JSON.stringify(pick(body)).slice(0, 1200)}`)
}

async function showSite({ url, name } = {}) {
  let href = url ? webUrl(String(url)) : null
  let label = name ? String(name).slice(0, 80) : ''
  let icon
  if (url && !href) return text('Not a web address: only http and https links can be shown.', true)
  if (!href) {
    if (!label) return text('Pass url or name.', true)
    const { status, body } = await hub('/api/hub/settings')
    const sites = status === 200 && Array.isArray(body?.sites) ? body.sites : []
    // Then the same one-click suggestions Home offers: the catalog's list plus Coolify from the Cloud tab.
    const [cat, cloud] = await Promise.all([hub('/api/hub/settings/catalog').catch(() => ({})), hub('/api/cloud/state').catch(() => ({}))])
    const suggested = [...(cloud.body?.coolify?.url ? [{ name: 'Coolify', url: cloud.body.coolify.url }] : []), ...(Array.isArray(cat.body?.sites?.suggestions) ? cat.body.sites.suggestions : [])]
    const q = label.toLowerCase()
    const find = list => list.find(s => s.id?.toLowerCase() === q || s.name?.toLowerCase() === q) || list.find(s => s.name?.toLowerCase().includes(q) || q.includes(s.name?.toLowerCase()))
    const site = find(sites) || find(suggested)
    if (!site) return text(`No saved website app called "${label}". Saved: ${sites.map(s => s.name).join(', ') || 'none'}. Pass its url instead, or the user can add it on Home (Edit, Add App).`, true)
    href = webUrl(site.url)
    label = site.name
    if (site.icon) icon = `/api/hub/app-icon/${encodeURIComponent(site.id)}`
    if (!href) return text(`The saved address for ${site.name} is not a web address.`, true)
  }
  return text(JSON.stringify({ shown: true, url: href, name: label || undefined, icon, note: 'The user now sees this as a card in the chat. You cannot see or click inside it.' }))
}

async function looked(pathname, params) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== false).map(([k, v]) => [k, String(v)]))
  const r = await fetch(`${API}${pathname}?${q}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60e3) })
  const body = await r.json().catch(() => ({}))
  return r.ok ? text(JSON.stringify(body)) : text(body.error || `HTTP ${r.status}`, true)
}
const systemInfo = ({ folder } = {}) => folder ? looked('/api/system/size', { path: folder }) : looked('/api/system/info', {})
const gitRead = ({ repo, op, ref, path, staged, n } = {}) => ['status', 'log', 'diff'].includes(op) ? looked(`/api/git/${op}`, { repo, ref, path, staged: staged ? 1 : '', n }) : text('op must be status, log or diff.', true)

// A step that waits for a card comes back with its id on the last line, which is how the chat knows to show it.
async function acted(pathname, body) {
  const { status, body: out } = await hub(pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (status === 428 && out?.id) return text(`${out.error}\n[confirm:${out.id}]`, true)
  return status === 200 ? text(JSON.stringify(out)) : text(out?.error || `HTTP ${status}`, true)
}
const fileOp = args => acted('/api/agent/file', args || {})
const hubAction = args => acted('/api/agent/action', args || {})

const HANDLERS = { hub_read: hubRead, settings_update: settingsUpdate, show_site: showSite, system_info: systemInfo, git_read: gitRead, file_op: fileOp, hub_action: hubAction }

function reply(id, result, error) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) }) + '\n')
}

createInterface({ input: process.stdin }).on('line', async line => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  const { id, method, params } = msg || {}
  if (id === undefined || id === null) return // notifications need no answer
  try {
    if (method === 'initialize') return reply(id, { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'hub', version: '1.0.0' } })
    if (method === 'ping') return reply(id, {})
    if (method === 'tools/list') return reply(id, { tools: TOOLS })
    if (method === 'tools/call') {
      const fn = HANDLERS[params?.name]
      if (!fn) return reply(id, text(`Unknown tool ${params?.name}.`, true))
      return reply(id, await fn(params?.arguments || {}))
    }
    reply(id, undefined, { code: -32601, message: `Method not found: ${method}` })
  } catch (e) {
    reply(id, text(`Failed: ${e?.message || e}`, true))
  }
})
