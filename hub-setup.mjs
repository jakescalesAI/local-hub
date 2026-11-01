// First-run setup, add-ons, themes and what the page may know about this hub.
//   GET  /hub-config.js               window.HUB_CONF, loaded before every other script. Never holds a key.
//   GET  /icons/manifest.webmanifest  the app manifest, named after this hub
//   GET  /api/hub/setup               { needsSetup, claude: { installed, signedIn }, tailscale: { installed } }
//   POST /api/hub/setup               the wizard's answers. Only while there is no config, only from this computer.
//   POST /api/hub/addons              { id, on } turns an add-on on or off
//   GET  /api/hub/themes              the themes this hub knows
//   GET  /api/hub/themes/<id>.json    a theme as a file to share
//   POST /api/hub/themes              { theme } adds a theme from a file (stored in data/themes)
// Keys go to config/secrets.json and are never sent back: the reply only names what was saved.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { HERE, ADDONS, hubConfig, needsSetup, saveHubConfig, saveSecrets, pageConfig, themes, themeById, baseTheme } from './config.mjs'
import { IS_MAC, tailscalePath } from './platform.mjs'
import { MIN_PASSCODE, hashPasscode, isLocal, setPasscode } from './access.mjs'
import { findClaude } from './chat.mjs'
import { STYLE, BUILTIN_WALLPAPERS, webUrl } from './hub-settings.mjs'

const THEME_DIR = path.join(HERE, 'data', 'themes')
const MAX_THEME = 16 * 1024

const bad = message => Object.assign(new Error(message), { code: 400 })
function text(v, max, what) {
  if (v === undefined || v === null || v === '') return ''
  if (typeof v !== 'string' || v.length > max || /[\u0000-\u001f]/.test(v)) throw bad(`${what} is not valid`)
  return v.trim()
}

function claudeStatus() {
  const dir = hubConfig().claudeConfigDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  // A Mac keeps the login in its Keychain, so the file only proves it on the other two.
  const provider = hubConfig().assistant.provider.type
  return { installed: !!findClaude(), signedIn: provider !== 'login' || fs.existsSync(path.join(dir, '.credentials.json')) || (IS_MAC ? null : false) }
}

// Turns the wizard's answers into hub.json values and secrets.json fields. Throws on anything malformed.
function readAnswers(body) {
  const name = text(body.name, 40, 'Hub name') || 'Quartzi Hub'
  if (!['localhost', 'tailnet'].includes(body.access || 'localhost')) throw bad('Who can reach it must be localhost or tailnet')
  const claudeConfigDir = text(body.claudeConfigDir, 400, 'Claude folder')
  const passcode = typeof body.passcode === 'string' ? body.passcode : ''
  if (body.access === 'tailnet' && passcode.length < MIN_PASSCODE) throw bad(`Other devices need a passcode of at least ${MIN_PASSCODE} characters`)
  const keys = body.keys && typeof body.keys === 'object' ? body.keys : {}
  const key = id => text(keys[id], 2000, id)
  const url = (id, v) => {
    const raw = text(v, 500, id)
    if (!raw) return ''
    const ok = webUrl(raw)
    if (!ok) throw bad(`${id} needs an http or https address`)
    return ok
  }
  const secrets = passcode ? { hubPasscode: hashPasscode(passcode) } : {}
  if (key('openrouter')) secrets.openrouter = { apiKey: key('openrouter') }
  if (key('deepseek')) secrets.deepseek = { apiKey: key('deepseek') }
  if (key('stripe')) secrets.stripe = { apiKey: key('stripe') }
  if (key('coolifyToken')) secrets.coolify = { url: url('Coolify address', keys.coolifyUrl), token: key('coolifyToken') }
  if (key('cloudflareToken')) secrets.cloudflare = { apiToken: key('cloudflareToken'), accountId: key('cloudflareAccount') }
  const ics = url('Calendar link', keys.calendarUrl)
  if (ics) secrets.calendars = [{ label: text(keys.calendarLabel, 40, 'Calendar name') || 'Calendar', icsUrl: ics }]
  const config = { name, access: body.access || 'localhost', ...(claudeConfigDir ? { claudeConfigDir } : {}) }
  return { config, secrets }
}

function cleanTheme(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw bad('That file is not a theme')
  const name = text(t.name, 40, 'Theme name')
  if (!name) throw bad('A theme needs a name')
  const style = {}
  for (const [k, v] of Object.entries(t.style || {})) {
    const rule = STYLE[k]
    if (!rule) continue
    const ok = rule.enum ? rule.enum.includes(v)
      : rule.color ? rule.extra?.includes(v) || /^#[0-9a-f]{6}$/i.test(String(v))
      : Number.isFinite(v) && v >= rule.min && v <= rule.max
    if (!ok) throw bad(`Theme value style.${k} is not allowed`)
    style[k] = v
  }
  const wallpaper = t.wallpaper === undefined ? 'none' : t.wallpaper
  if (wallpaper !== 'none' && !BUILTIN_WALLPAPERS.some(w => w.id === wallpaper)) throw bad('Theme wallpaper must be one of the built-in wallpapers')
  return { name, style, wallpaper }
}

function saveTheme(theme) {
  const base = theme.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'theme'
  let id = base
  for (let i = 2; themeById(id) && !fs.existsSync(path.join(THEME_DIR, `${id}.json`)) && i < 100; i++) id = `${base}-${i}`
  fs.mkdirSync(THEME_DIR, { recursive: true })
  const file = path.join(THEME_DIR, `${id}.json`)
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(theme, null, 2))
  fs.renameSync(`${file}.tmp`, file)
  return id
}

export function create({ onAccessChange }) {
  return async function route(url, req, res, { send, readBody }) {
    const p = url.pathname
    if (p === '/hub-config.js' && req.method === 'GET') {
      send(res, 200, `window.HUB_CONF = ${JSON.stringify(pageConfig()).replace(/</g, '\\u003c')};\n`, 'text/javascript; charset=utf-8')
      return true
    }
    if (p === '/icons/manifest.webmanifest' && req.method === 'GET') {
      const m = JSON.parse(fs.readFileSync(path.join(HERE, 'icons', 'manifest.webmanifest'), 'utf8'))
      send(res, 200, JSON.stringify({ ...m, name: hubConfig().name }), 'application/manifest+json')
      return true
    }
    if (p === '/icons/hub.svg' && req.method === 'GET') {
      const icon = baseTheme().icon
      send(res, 200, fs.readFileSync(path.join(HERE, /^icons\/[\w.-]+\.svg$/.test(icon || '') ? icon : 'icons/hub.svg')), 'image/svg+xml')
      return true
    }
    if (p === '/api/hub/setup' && req.method === 'GET') {
      send(res, 200, { needsSetup: needsSetup(), local: isLocal(req), claude: claudeStatus(), tailscale: { installed: !!tailscalePath() } })
      return true
    }
    if (p === '/api/hub/setup' && req.method === 'POST') {
      if (!needsSetup()) return send(res, 409, { error: 'This hub is already set up' }), true
      if (!isLocal(req)) return send(res, 403, { error: 'Setup only runs from this computer' }), true
      const { config, secrets } = readAnswers(await readBody(req))
      // Keys first: hub.json is what ends the wizard, so a failed key write leaves it open to try again.
      if (Object.keys(secrets).length) saveSecrets(secrets)
      saveHubConfig(config)
      onAccessChange?.()
      send(res, 200, { ok: true, name: config.name, access: config.access, saved: Object.keys(secrets).filter(k => k !== 'hubPasscode') })
      return true
    }
    if (p === '/api/hub/passcode' && req.method === 'POST') {
      if (!isLocal(req)) return send(res, 403, { error: 'The passcode is set from this computer' }), true
      setPasscode((await readBody(req)).passcode)
      onAccessChange?.()
      send(res, 200, { ok: true })
      return true
    }
    if (p === '/api/hub/addons' && req.method === 'POST') {
      const { id, on } = await readBody(req)
      if (!ADDONS[id]) return send(res, 400, { error: 'unknown add-on' }), true
      if (typeof on !== 'boolean') return send(res, 400, { error: 'on must be true or false' }), true
      if (on && ADDONS[id].available && !ADDONS[id].available()) return send(res, 409, { error: `${ADDONS[id].label} isn't available on this computer` }), true
      saveHubConfig({ addons: { ...hubConfig().addons, [id]: on } })
      send(res, 200, pageConfig().addons)
      return true
    }
    if (p === '/api/hub/themes' && req.method === 'GET') {
      send(res, 200, { themes: themes(), current: hubConfig().theme })
      return true
    }
    if (p === '/api/hub/themes' && req.method === 'POST') {
      const body = await readBody(req)
      if (JSON.stringify(body).length > MAX_THEME) return send(res, 400, { error: 'That theme file is too large' }), true
      const id = saveTheme(cleanTheme(body.theme))
      send(res, 200, { id, themes: themes() })
      return true
    }
    const file = /^\/api\/hub\/themes\/([a-z0-9-]+)\.json$/.exec(p)
    if (file && req.method === 'GET') {
      const t = themeById(file[1])
      if (!t) return send(res, 404, { error: 'no such theme' }), true
      res.setHeader('content-disposition', `attachment; filename="${file[1]}.theme.json"`)
      send(res, 200, { name: t.name, style: t.style, wallpaper: t.wallpaper })
      return true
    }
    return false
  }
}
