// Home's apps on the computer and the phone: websites and the programs installed on this PC, and your favorites.
//   GET  /api/desk                      -> { apps: [{ id, name, url? | pc? }], favorites: [id], more: [..] }
//   POST /api/desk { apps?, favorites? }   saves them, whole (data/desk.json)
//   GET  /api/desk/pc                   -> { apps: [{ id, name }] } what's installed on this PC
//   GET  /api/desk/icon?id=pc:…            its icon
//   POST /api/desk/open { id }             opens one on this PC (from this PC only): its installed program, or a website in a window of its own
//   GET  /api/desk/system               -> { cpu, mem, disk, diskFree } of this PC, in percent and bytes
// Only a program Windows lists in its own Start menu can be started, and only from this computer.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { webUrl } from './hub-settings.mjs'
import { isLocal } from './access.mjs'
import { IS_WIN } from './platform.mjs'
import { pcHelper } from './pc-helper.mjs'

const MAX = 120
const W = (id, name, url) => ({ id, name, url })
// A new hub's Home: things people open every day.
export const START = [
  W('youtube', 'YouTube', 'https://www.youtube.com/'), W('netflix', 'Netflix', 'https://www.netflix.com/browse'), W('spotify', 'Spotify', 'https://open.spotify.com/'),
  W('gmail', 'Gmail', 'https://mail.google.com/'), W('gcal', 'Google Calendar', 'https://calendar.google.com/'), W('gdrive', 'Google Drive', 'https://drive.google.com/'),
  W('claude', 'Claude', 'https://claude.ai/'), W('chatgpt', 'ChatGPT', 'https://chatgpt.com/'), W('github', 'GitHub', 'https://github.com/'), W('notion', 'Notion', 'https://www.notion.so/'),
  W('instagram', 'Instagram', 'https://www.instagram.com/'), W('x', 'X', 'https://x.com/'), W('reddit', 'Reddit', 'https://www.reddit.com/'), W('linkedin', 'LinkedIn', 'https://www.linkedin.com/'), W('amazon', 'Amazon', 'https://www.amazon.com/'),
]
export const MORE = [
  W('primevideo', 'Prime Video', 'https://www.primevideo.com/'), W('disney', 'Disney+', 'https://www.disneyplus.com/'), W('max', 'Max', 'https://play.max.com/'), W('hulu', 'Hulu', 'https://www.hulu.com/'), W('appletv', 'Apple TV', 'https://tv.apple.com/'),
  W('twitch', 'Twitch', 'https://www.twitch.tv/'), W('plex', 'Plex', 'https://app.plex.tv/'), W('crunchyroll', 'Crunchyroll', 'https://www.crunchyroll.com/'), W('paramountplus', 'Paramount+', 'https://www.paramountplus.com/'), W('tubi', 'Tubi', 'https://tubitv.com/'),
  W('applemusic', 'Apple Music', 'https://music.apple.com/'), W('ytmusic', 'YouTube Music', 'https://music.youtube.com/'), W('tiktok', 'TikTok', 'https://www.tiktok.com/'), W('facebook', 'Facebook', 'https://www.facebook.com/'), W('whatsapp', 'WhatsApp', 'https://web.whatsapp.com/'),
  W('discord', 'Discord', 'https://discord.com/app'), W('slack', 'Slack', 'https://app.slack.com/'), W('figma', 'Figma', 'https://www.figma.com/'), W('canva', 'Canva', 'https://www.canva.com/'), W('outlook', 'Outlook', 'https://outlook.live.com/'),
  W('gdocs', 'Google Docs', 'https://docs.google.com/'), W('gmaps', 'Google Maps', 'https://maps.google.com/'), W('gphotos', 'Google Photos', 'https://photos.google.com/'), W('stripe', 'Stripe', 'https://dashboard.stripe.com/'), W('supabase', 'Supabase', 'https://supabase.com/dashboard'), W('vercel', 'Vercel', 'https://vercel.com/'),
]
const PC_RE = /^pc:[^\u0000-\u001f"]{1,300}$/
const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/
export function cleanDesk(raw) {
  const seen = new Set(), apps = []
  for (const a of Array.isArray(raw?.apps) ? raw.apps.slice(0, MAX) : []) {
    const name = String(a?.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60)
    const id = String(a?.id || '')
    if (!name || seen.has(id)) continue
    if (PC_RE.test(id)) { seen.add(id); apps.push({ id, name }); continue }
    const url = webUrl(a?.url)
    if (ID_RE.test(id) && url) { seen.add(id); apps.push({ id, name, url }) }
  }
  return { apps, favorites: [...new Set((Array.isArray(raw?.favorites) ? raw.favorites : []).filter(x => seen.has(x)))].slice(0, 24) }
}
// Not programs: web links, uninstallers, manuals.
export const realApp = a => a && typeof a.id === 'string' && PC_RE.test(`pc:${a.id}`) && !/^https?:|^microsoft-edge:/i.test(a.id) && !/\.(url|chm|html?|txt|pdf|rtf)$/i.test(a.id) && !/uninstall|readme|release notes|user guide|manual|documentation|help file|administrative|odbc|iscsi|msys2|command prompt|powershell ise|wow\)|application verifier|windows software development|energy star|performance monitor|event viewer|registry editor|component services|computer management|resource monitor|task scheduler|steps recorder|memory diagnostic|recovery drive|disk cleanup|defragment|print management|xps viewer|promotion|troubleshooter|cross tools|native tools|debuggable|module docs|narrator|magnifier|on-screen keyboard|voice access|live captions|character map|with advanced security/i.test(a.name || '')

export function create({ here }) {
  const FILE = path.join(here, 'data', 'desk.json')
  const helper = pcHelper(here)
  let cur = null
  const get = () => {
    if (cur) return cur
    try { cur = cleanDesk(JSON.parse(fs.readFileSync(FILE, 'utf8'))) } catch { cur = cleanDesk({ apps: START, favorites: ['youtube', 'gmail', 'spotify'] }) }
    return cur
  }
  let pc = { at: 0, list: [] }
  async function pcApps() {
    if (pc.list.length && Date.now() - pc.at < 600_000) return pc.list
    const r = await helper.ask('apps')
    const seen = new Set()
    const list = (r.apps || []).filter(realApp).filter(a => !seen.has(a.name) && seen.add(a.name)).map(a => ({ id: `pc:${a.id}`, name: String(a.name).slice(0, 60) })).sort((a, b) => a.name.localeCompare(b.name))
    pc = { at: Date.now(), list }
    return list
  }
  // A website that's also installed here opens as the program; the rest as a window of their own (Chrome's or Edge's app window).
  const squash = t => String(t).toLowerCase().replace(/[^a-z0-9+]/g, '')
  const ALSO = { outlook: ['outlook', 'outlooknew'], applemusic: ['applemusic'], slack: ['slack'], whatsapp: ['whatsapp'], x: [], gdrive: ['googledrive'] }
  const programFor = a => { if (!a.url) return null; const want = ALSO[a.id] || [squash(a.name)]; return pc.list.find(p => want.includes(squash(p.name))) || null }
  const BROWSERS = () => [[process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'], [process.env['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe'], [process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'], [process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'], [process.env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe']].filter(x => x[0]).map(x => path.join(...x)).find(x => fs.existsSync(x))
  const start = (file, args) => spawn(file, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref()
  const icons = new Map()
  const cpuTimes = () => os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + Object.values(c.times).reduce((x, y) => x + y, 0) }), { idle: 0, total: 0 })
  let last = cpuTimes(), load = 0
  return async function route(url, req, res, { send, readBody }) {
    const p = url.pathname
    if (p !== '/api/desk' && !p.startsWith('/api/desk/')) return false
    if (p === '/api/desk' && req.method === 'GET') {
      if (IS_WIN && Date.now() - pc.at > 600_000) pcApps().catch(() => {})
      return send(res, 200, { ...get(), apps: get().apps.map(a => (programFor(a) ? { ...a, pc: programFor(a).id } : a)), more: MORE.concat(START) }), true
    }
    if (p === '/api/desk' && req.method === 'POST') {
      const b = await readBody(req).catch(() => null)
      if (!b || (!Array.isArray(b.apps) && !Array.isArray(b.favorites))) return send(res, 400, { error: 'send apps or favorites' }), true
      cur = cleanDesk({ ...get(), ...b })
      fs.mkdirSync(path.dirname(FILE), { recursive: true })
      fs.writeFileSync(FILE, JSON.stringify(cur))
      return send(res, 200, cur), true
    }
    if (p === '/api/desk/pc' && req.method === 'GET') {
      try { return send(res, 200, { apps: await pcApps() }), true } catch { return send(res, 200, { apps: [] }), true }
    }
    if (p === '/api/desk/icon' && req.method === 'GET') {
      const id = url.searchParams.get('id') || ''
      try {
        if (!icons.has(id)) {
          if (!(await pcApps()).some(a => a.id === id)) throw new Error('unknown')
          icons.set(id, Buffer.from(String((await helper.ask('icon', id.slice(3))).png || ''), 'base64'))
        }
        const png = icons.get(id)
        if (!png.length) throw new Error('none')
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' })
        return res.end(png), true
      } catch { return send(res, 404, { error: 'not found' }), true }
    }
    if (p === '/api/desk/open' && req.method === 'POST') {
      if (!isLocal(req)) return send(res, 403, { error: 'Programs open on the computer the hub runs on.' }), true
      const b = await readBody(req).catch(() => ({}))
      const list = await pcApps().catch(() => [])
      const web = [...get().apps, ...MORE, ...START].find(a => a.url && a.id === b?.id)
      if (web) {
        const prog = b.web === true ? null : programFor(web), exe = BROWSERS()
        if (prog) start('explorer.exe', [`shell:AppsFolder\\${prog.id.slice(3)}`])
        else if (b.web !== true && exe) start(exe, [`--app=${web.url}`])
        else return send(res, 200, { ok: true, url: web.url }), true
        return send(res, 200, { ok: true, as: prog ? 'program' : 'window' }), true
      }
      const app = list.find(a => a.id === b?.id)
      if (!app) return send(res, 404, { error: 'That isn’t installed on this PC any more.' }), true
      start('explorer.exe', [`shell:AppsFolder\\${app.id.slice(3)}`])
      return send(res, 200, { ok: true }), true
    }
    if (p === '/api/desk/system' && req.method === 'GET') {
      const now = cpuTimes(), busy = now.total - last.total > 0 ? 100 * (1 - (now.idle - last.idle) / (now.total - last.total)) : 0
      if (now.total - last.total > 0) { last = now; load = Math.round(busy) }
      let disk = null, diskFree = null
      try { const d = fs.statfsSync(IS_WIN ? 'C:\\' : '/'); disk = Math.round(100 * (1 - d.bavail / d.blocks)); diskFree = d.bavail * d.bsize } catch {}
      return send(res, 200, { cpu: load, mem: Math.round(100 * (1 - os.freemem() / os.totalmem())), disk, diskFree }), true
    }
    send(res, 404, { error: 'not found' })
    return true
  }
}
