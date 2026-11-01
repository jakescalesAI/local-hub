// Hub Assistant's own tools: a tiny MCP server (JSON-RPC over stdio) that chat.mjs hands to the
// `claude -p` run with --mcp-config. It gives the assistant exactly two ways to act, nothing more:
//
//   settings_update { patch }      POST /api/hub/settings (the hub's look and layout only)
//   show_site       { url?, name? } shows a website to the user as a card in the chat
//
// Everything else stays read-only (see chat.mjs ALLOW/DENY). The settings API keeps the previous
// version in data/hub-settings.prev.json, so every change can be undone with another patch.
import { createInterface } from 'node:readline'

const PORT = Number(process.env.HUB_PORT) || 3100
const API = `http://127.0.0.1:${PORT}`
// Top-level settings keys the assistant may send. Wallpaper uploads (raw image bodies) are not here.
const KEYS = new Set(['tabs', 'apps', 'widgets', 'style', 'wallpaper', 'sites', 'reset'])

const TOOLS = [
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

const HANDLERS = { settings_update: settingsUpdate, show_site: showSite }

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
