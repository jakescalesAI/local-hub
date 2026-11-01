// Your hub's own settings. Everything personal lives in config/ (git-ignored): hub.json, secrets.json,
// servers.json, clients.json, names.json, pinned.json and an optional notes.md for the assistant.
// config.example/ shows the shape. With no config/hub.json the page runs the first-run wizard.
// Only the hub process reads this; pageConfig() is the part that may reach the page and never holds a key.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ICLOUD, IS_WIN, OS_NAME, PC_NAME, TRASH_NAME, FILE_MANAGER } from './platform.mjs'

export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const CONFIG_DIR = path.join(HERE, 'config')
export const configPath = name => path.join(CONFIG_DIR, name)
const HUB_FILE = configPath('hub.json')
const savedPort = () => { try { return JSON.parse(fs.readFileSync(HUB_FILE, 'utf8')).port } catch { return 0 } }
export const PORT = Number(process.env.HUB_PORT || savedPort() || 3100)
const SECRETS_FILE = configPath('secrets.json')

const NEUTRAL = {
  name: 'Local Hub',
  owner: '',
  access: 'localhost', // or "tailnet"
  passcodeRequired: true, // other devices need the passcode (npm run passcode); this computer never does
  listen: [], // more addresses to answer on, such as a LAN address. Ignored until a passcode is set.
  url: '', // the address you reach the hub at from other devices, if any
  addons: {},
  server: { sshAlias: '', label: 'Server', readOnly: ['/root/.ssh'], production: { units: [], paths: [] }, notes: {} },
  // The services page sends each new local port one web request, to tell web services from the rest.
  // noProbe lists programs never to send it to. probe: false sends none, and every port shows under other services.
  laptop: { probe: true, noProbe: [] },
  keyDirs: [],
  keyPairs: [],
  browser: { profiles: { default: { label: 'Default', email: '' } }, current: 'default' },
  worldClock: [['New York', 'America/New_York'], ['London', 'Europe/London'], ['UTC', 'UTC']],
  siteSuggestions: [],
  theme: 'default',
  claudeConfigDir: '',
  // The assistant: every choice here is yours (see HUB-GUIDE.md, "Make it yours").
  assistant: {
    name: 'Hub Assistant',
    instructions: '', // added to its instructions; config/instructions.md replaces the shipped ones
    command: '', // path to a Claude Code compatible CLI; blank finds `claude`
    // login: the CLI's own login. key: secrets.json assistantKey as an Anthropic key.
    // custom: assistantKey against baseUrl (any Anthropic-compatible provider). env: whatever the environment and `env` below set.
    provider: { type: 'login', baseUrl: '' },
    env: {}, // extra environment for the CLI, for example {"CLAUDE_CODE_USE_BEDROCK": "1"}. No keys here: they go in secrets.json.
    models: [], // ["model-id"] or [["model-id", "Label"]]; empty offers the Claude models
    defaultModel: '',
    tools: { web: true, files: true, browser: true, settings: true, sites: true },
    readFolders: ['~'], // folders it may read, besides the hub's. Key files stay refused in all of them.
    writeFolders: [], // more folders it may write to, besides workspace/. Never inside the hub folder.
    mcpServers: {}, // your own tools: {"name": {"command": "...", "args": [], "env": {}}}
    maxChats: 1000, // chats listed in History; older ones stay on disk
    // Approval rules. These are the shipped defaults; a change here is owner-only and gets a warning in the log.
    // secrets: "never" | "allow"   typing passwords, cards and 2FA codes in the browser
    // actions: "ask" | "warn" | "go"   sending, posting, buying, deleting, accepting terms. ask: waits for a yes. warn: says so, then does it.
    // socialPosts: "never" | "ask"   the final Post or Share click on social sites
    approvals: { secrets: 'never', actions: 'ask', socialPosts: 'never' },
  },
}

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }

// A short cache so a page load doesn't read the same files many times; edits show within two seconds.
function cached(read) {
  let at = 0, value
  const get = () => { if (Date.now() - at > 2000) { value = read(); at = Date.now() } return value }
  get.clear = () => { at = 0 }
  return get
}
const merge = saved => ({
  ...NEUTRAL,
  ...saved,
  server: { ...NEUTRAL.server, ...saved?.server },
  browser: saved?.browser?.profiles && Object.keys(saved.browser.profiles).length ? saved.browser : NEUTRAL.browser,
  assistant: {
    ...NEUTRAL.assistant,
    ...saved?.assistant,
    provider: { ...NEUTRAL.assistant.provider, ...saved?.assistant?.provider },
    tools: { ...NEUTRAL.assistant.tools, ...saved?.assistant?.tools },
    approvals: { ...NEUTRAL.assistant.approvals, ...saved?.assistant?.approvals },
  },
})
export const hubConfig = cached(() => merge(readJson(HUB_FILE)))
export const secrets = cached(() => readJson(SECRETS_FILE) || {})
export const needsSetup = () => !fs.existsSync(HUB_FILE)

function writeJson(file, value) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, file)
}
export function saveHubConfig(patch) {
  writeJson(HUB_FILE, { ...(readJson(HUB_FILE) || {}), ...patch })
  hubConfig.clear()
}
export function saveSecrets(patch) {
  writeJson(SECRETS_FILE, { ...(readJson(SECRETS_FILE) || {}), ...patch })
  secrets.clear()
}

// True when a value holds anything a person filled in.
const filled = v => Array.isArray(v) ? v.some(filled) : v && typeof v === 'object' ? Object.entries(v).some(([k, x]) => k !== 'regions' && !k.startsWith('_') && filled(x)) : typeof v === 'string' ? !!v.trim() : false

// Add-ons: off until configured. A new hub has Home, Files, Chat and Browser. Setting addons.<id> to true
// or false in hub.json decides it outright; otherwise those with `auto` come on when their key is saved.
export const ADDONS = {
  laptop: { label: 'This Computer', tab: true, what: 'Running services, health and files of this computer' },
  server: { label: 'Server', tab: true, what: 'Services and files of a server you reach over ssh', how: 'Set server.sshAlias in config/hub.json', auto: () => !!hubConfig().server.sshAlias },
  ai: { label: 'AI', tab: true, what: 'Claude usage and AI provider balances', auto: s => filled(s.claudeAccounts) || filled(s.openrouter) || filled(s.deepseek) },
  cloud: { label: 'Cloud', tab: true, what: 'Read-only view of your hosting: Coolify, Cloudflare, AWS, Azure', how: 'Add a key to config/secrets.json', auto: s => filled(s.coolify) || filled(s.cloudflare) || filled(s.aws) || filled(s.azure) || filled(s.euronodes) },
  calendar: { label: 'Calendar', tab: true, what: 'Read-only calendar feeds and bookings', how: 'Add a calendar link to config/secrets.json', auto: s => filled(s.calendars) || filled(s.calcom) || filled(hubConfig().calendar?.sources) },
  stripe: { label: 'Stripe', tab: true, what: 'Read-only balance, revenue and payouts', how: 'Add a restricted key to config/secrets.json', auto: s => filled(s.stripe) },
  drives: { label: 'Drives', what: 'Disk space for each drive on the Files tab' },
  icloud: { label: 'iCloud', what: 'iCloud Drive and its storage on the Files tab', available: () => fs.existsSync(ICLOUD) },
}
export function addonOn(id) {
  const a = ADDONS[id]
  if (!a) return false
  const set = hubConfig().addons?.[id]
  if (typeof set === 'boolean') return set
  return a.auto ? !!a.auto(secrets()) : false
}
// The tabs this hub has. The built-in order; plug-in tabs join in hub-settings.mjs.
export const TAB_ORDER = ['home', 'laptop', 'server', 'drives', 'ai', 'cloud', 'calendar', 'stripe']
export const tabOn = id => id === 'home' || id === 'drives' || !ADDONS[id]?.tab || addonOn(id)
export const enabledTabs = () => TAB_ORDER.filter(tabOn)

// Themes: themes/default.json is the default look (glass style, wallpapers, house icon), all in one place.
// Others are shared as files and imported into data/themes. Applying one is a settings patch (Style panel).
const THEME_DIRS = [path.join(HERE, 'themes'), path.join(HERE, 'data', 'themes')]
export const baseTheme = () => readJson(path.join(THEME_DIRS[0], 'default.json')) || { name: 'Default', style: {}, wallpaper: 'none', wallpapers: [] }
export const themeById = id => {
  if (!/^[a-z0-9-]+$/.test(id || '')) return null
  for (const dir of THEME_DIRS) { const t = readJson(path.join(dir, `${id}.json`)); if (t) return { ...t, id } }
  return null
}
export const activeTheme = () => themeById(hubConfig().theme) || { ...baseTheme(), id: 'default' }
export function themes() {
  const ids = THEME_DIRS.flatMap(dir => { try { return fs.readdirSync(dir) } catch { return [] } }).map(f => /^([a-z0-9-]+)\.json$/.exec(f)?.[1]).filter(Boolean)
  return [...new Set(ids)].map(themeById).filter(Boolean).map(({ id, name, style, wallpaper }) => ({ id, name, style, wallpaper }))
}

// What the page may know. Never a key, and nothing that isn't needed to draw it.
export function pageConfig() {
  const c = hubConfig()
  return {
    name: c.name,
    owner: c.owner,
    url: c.url,
    port: PORT,
    needsSetup: needsSetup(),
    tabs: enabledTabs(),
    addons: Object.fromEntries(Object.entries(ADDONS).map(([id, a]) => [id, { label: a.label, what: a.what, how: a.how || '', on: addonOn(id), tab: !!a.tab, available: a.available ? a.available() : true }])),
    server: { label: c.server.label, notes: c.server.notes, unitPrefix: c.server.unitPrefix || '' },
    theme: { ...activeTheme(), wallpapers: baseTheme().wallpapers },
    platform: { os: OS_NAME, isWin: IS_WIN, pc: PC_NAME, trash: TRASH_NAME, fileManager: FILE_MANAGER },
    browser: c.browser,
    worldClock: c.worldClock,
    assistant: { name: c.assistant.name },
  }
}

// The assistant's extra notes for this hub (config/notes.md), if any.
export function ownerNotes() {
  try { return fs.readFileSync(configPath('notes.md'), 'utf8') } catch { return '' }
}
// config/instructions.md, if you wrote your own in place of the shipped ones.
export function ownerInstructions() {
  try { return fs.readFileSync(configPath('instructions.md'), 'utf8') } catch { return '' }
}
