// Search bar back end: your saved links and snippets, how often you use them, and site icons.
// The bar itself is drawn in the page (tabs/launcher.js). Format and API: LAUNCHER.md.
//   GET    /launcher                  the search bar as its own page, for a small window
//   GET    /api/launcher/library      -> { links, snippets, usage, filesHome, at, warning? }
//   GET    /api/launcher/snippets     -> { snippets: [{ id, name, keyword, text }], at }
//   POST   /api/launcher/links        body { name, kind, url | path } -> the saved link
//   PUT    /api/launcher/links/<id>   same body; DELETE removes it. /snippets takes { name, text, keyword }.
//   POST   /api/launcher/use          body { key: 'link:<id>' }, counts toward ranking
//   POST   /api/launcher/open         body { id }, opens a folder or Obsidian link on this computer
//   GET    /api/launcher/icon?id=     the saved link's own favicon
//   GET    /api/launcher/export       everything, as a JSON download
//   POST   /api/launcher/import       body { data, allowLocal } -> { added, unchanged, skipped }
// Everything personal lives in data/ (git-ignored). Nothing here logs a snippet or echoes one in
// an error, and the changing routes sit behind the x-hub check in server.mjs.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { holdsKeys } from './files.mjs'
import { isLocal } from './access.mjs'

export const FORMAT = 'local-hub-launcher'
const MAX_BODY = 8 * 1024 * 1024
const MAX_ITEMS = 5000
const MAX_NAME = 200
const MAX_URL = 2048
const MAX_TEXT = 100 * 1024
const MAX_KEYWORD = 64
const MAX_USAGE = 2000
const ICON_MAX = 256 * 1024
const HTML_MAX = 256 * 1024
const ICON_FRESH_MS = 7 * 86400_000
const ICON_MISS_MS = 86400_000
const ICON_FILES_MAX = 2000
const ICON_FETCHES_AT_ONCE = 4
const OBSIDIAN_ACTIONS = new Set(['open', 'search', 'vault'])
const USAGE_KEY = /^(link|snippet|tab|action):[\w-]{1,64}$/

const fail = (message, code = 400) => Object.assign(new Error(message), { code })
const cleanLine = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
const newId = prefix => `${prefix}-${crypto.randomBytes(6).toString('hex')}`
const isPlain = v => !!v && typeof v === 'object' && !Array.isArray(v)

/* ---------- what may be saved ---------- */

function webUrl(raw) {
  const text = String(raw ?? '').trim()
  if (!text) throw fail('Add an address')
  if (text.length > MAX_URL) throw fail('That address is too long')
  // A bare "example.com" means the website. Anything with a scheme is judged as written.
  const candidate = /^[a-z0-9-]+(\.[a-z0-9-]+)+([/:?#].*)?$/i.test(text) ? `https://${text}` : text
  let u
  try { u = new URL(candidate) } catch { throw fail('That isn’t a web address') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw fail('Only http and https links can be saved as web links')
  if (u.username || u.password) throw fail('Links can’t hold a user name or password')
  return u.href
}

function obsidianUrl(raw) {
  const text = String(raw ?? '').trim()
  if (text.length > MAX_URL) throw fail('That address is too long')
  let u
  try { u = new URL(text) } catch { throw fail('That isn’t an Obsidian link') }
  if (u.protocol !== 'obsidian:') throw fail('An Obsidian link starts with obsidian://')
  if (!OBSIDIAN_ACTIONS.has(u.hostname)) throw fail('Only Obsidian open, search and vault links can be saved')
  return u.href
}

function folderPath(raw) {
  let text = String(raw ?? '').trim()
  if (/^file:/i.test(text)) {
    try { text = decodeURIComponent(new URL(text).pathname).replace(/^\/([a-z]:)/i, '$1') } catch { throw fail('That isn’t a folder path') }
  }
  if (text === '~' || text.startsWith('~/') || text.startsWith('~\\')) text = path.join(os.homedir(), text.slice(1))
  if (!text || text.length > 1024 || /[\u0000-\u001f\u007f]/.test(text)) throw fail('That isn’t a folder path')
  // A network path would make Windows send your sign-in to whatever machine it names.
  if (/^[\\/]{2}/.test(text)) throw fail('Network paths can’t be saved; use a folder on this computer')
  if (!path.isAbsolute(text) || (process.platform === 'win32' && !/^[a-z]:[\\/]/i.test(text))) throw fail('Use the full path of the folder')
  const clean = path.normalize(text)
  if (holdsKeys(clean)) throw fail('That folder holds keys, so the hub won’t open it')
  return clean
}

// One gate for every way in: the form, an import, and a data file edited by hand.
export function cleanLink(input) {
  if (!isPlain(input)) throw fail('A link must be an object')
  const kind = input.kind ?? 'web'
  const link = { kind }
  if (kind === 'web') link.url = webUrl(input.url)
  else if (kind === 'obsidian') link.url = obsidianUrl(input.url)
  else if (kind === 'folder') link.path = folderPath(input.path)
  else throw fail('A link is a web link, a folder or an Obsidian link')
  const name = cleanLine(input.name) || (link.url ? new URL(link.url).hostname : path.basename(link.path)) || link.url || link.path
  if (name.length > MAX_NAME) throw fail(`A name can be ${MAX_NAME} characters at most`)
  return { name, ...link }
}

export function cleanSnippet(input) {
  if (!isPlain(input)) throw fail('A snippet must be an object')
  if (typeof input.text !== 'string' || !input.text.trim()) throw fail('Add the snippet’s text')
  if (input.text.length > MAX_TEXT) throw fail('That snippet is too long')
  const keyword = cleanLine(input.keyword)
  if (keyword.length > MAX_KEYWORD || /\s/.test(keyword)) throw fail(`A keyword has no spaces and ${MAX_KEYWORD} characters at most`)
  const name = cleanLine(input.name) || keyword || 'Snippet'
  if (name.length > MAX_NAME) throw fail(`A name can be ${MAX_NAME} characters at most`)
  return { name, text: input.text, keyword }
}

/* ---------- import ---------- */

// Our own export, or the plain shapes other tools write: a list of { name, link } quicklinks,
// a list of { name, text, keyword } snippets, or an object holding either list.
export function readImport(data) {
  const links = [], snippets = [], skipped = []
  const sort = item => {
    if (!isPlain(item)) return void skipped.push({ kind: 'item', name: '', reason: 'Not a link or a snippet' })
    if (typeof item.text === 'string') snippets.push(item)
    else if (item.link !== undefined || item.url !== undefined || item.path !== undefined) links.push(item)
    else skipped.push({ kind: 'item', name: cleanLine(item.name).slice(0, MAX_NAME), reason: 'Not a link or a snippet' })
  }
  if (Array.isArray(data)) data.forEach(sort)
  else if (isPlain(data)) {
    if (data.format !== undefined && data.format !== FORMAT) throw fail('That file is in a format the hub doesn’t know')
    if (data.version !== undefined && data.version !== 1) throw fail('That file is from a newer version of the hub')
    const lists = [data.links, data.quicklinks, data.snippets].filter(l => l !== undefined)
    if (lists.some(l => !Array.isArray(l))) throw fail('links, quicklinks and snippets must be lists')
    if (lists.length) lists.flat().forEach(sort)
    else sort(data)
  } else throw fail('That file holds no links or snippets')
  return { links, snippets, skipped }
}

// What the imported link means, before cleanLink judges it. A local link needs the person to have
// said yes to local links for this import.
function importedLink(item, allowLocal) {
  const raw = String(item.link ?? item.url ?? '').trim()
  const looksLocal = item.path !== undefined || /^(file:|~([\\/]|$)|[a-z]:[\\/]|[\\/])/i.test(raw)
  const kind = item.kind ?? (looksLocal ? 'folder' : /^obsidian:/i.test(raw) ? 'obsidian' : 'web')
  if (kind !== 'web' && !allowLocal) throw fail('A folder or Obsidian link: tick “Also bring in folder and Obsidian links” to import it')
  return cleanLink({ name: item.name, kind, url: raw, path: item.path ?? raw })
}

const linkKey = l => `${l.kind}|${l.url || l.path}`

/* ---------- which addresses the hub will fetch icons from ---------- */

const PRIVATE_V4 = new net.BlockList()
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) PRIVATE_V4.addSubnet(a, p, 'ipv4')
// IPv6 is the other way round: only global unicast is public. That also rules out mapped IPv4,
// NAT64, loopback, link-local and unique-local; Teredo, documentation and 6to4 sit inside it.
const GLOBAL_V6 = new net.BlockList()
GLOBAL_V6.addSubnet('2000::', 3, 'ipv6')
const TUNNEL_V6 = new net.BlockList()
TUNNEL_V6.addSubnet('2001::', 32, 'ipv6')
TUNNEL_V6.addSubnet('2001:db8::', 32, 'ipv6')
TUNNEL_V6.addSubnet('2002::', 16, 'ipv6')

export function blockedAddress(ip) {
  const family = net.isIP(ip)
  if (family === 4) return PRIVATE_V4.check(ip, 'ipv4')
  if (family === 6) return !GLOBAL_V6.check(ip, 'ipv6') || TUNNEL_V6.check(ip, 'ipv6')
  return true
}

const PRIVATE_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa|ts\.net)$/i

// `blocked` and `resolver` are parameters so the tests can run the real fetch against local servers.
function checkTarget(u, blocked) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw fail('not a web address')
  if (u.username || u.password) throw fail('address holds a sign-in')
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (net.isIP(host)) { if (blocked(host)) throw fail('private address'); return }
  if (!host.includes('.') || PRIVATE_NAMES.test(host)) throw fail('private address')
}

function guardedLookup(blocked, resolver) {
  return (host, options, cb) => {
    resolver(host, { all: true }).then(list => {
      if (!list.length || list.some(a => blocked(a.address))) return cb(fail('private address'))
      if (options?.all) cb(null, list)
      else cb(null, list[0].address, list[0].family)
    }, cb)
  }
}

function fetchOnce(u, { maxBytes, truncate, blocked, resolver, deadline }) {
  return new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? https : http).request(u, {
      method: 'GET',
      agent: false,
      lookup: guardedLookup(blocked, resolver),
      headers: { accept: 'image/*,text/html;q=0.5,*/*;q=0.1', 'accept-encoding': 'identity', 'user-agent': 'LocalHub-favicon/1' },
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) { res.resume(); clearTimeout(timer); return resolve({ redirect: res.headers.location }) }
      if (res.statusCode !== 200) { res.resume(); clearTimeout(timer); return reject(fail(`status ${res.statusCode}`, 502)) }
      if (!truncate && Number(res.headers['content-length']) > maxBytes) { req.destroy(); clearTimeout(timer); return reject(fail('too large', 502)) }
      const chunks = []
      let n = 0
      const done = () => { clearTimeout(timer); resolve({ type: String(res.headers['content-type'] || ''), body: Buffer.concat(chunks) }) }
      res.on('data', c => {
        n += c.length
        if (n <= maxBytes) return void chunks.push(c)
        if (truncate) { done(); return void req.destroy() }
        clearTimeout(timer)
        req.destroy()
        reject(fail('too large', 502))
      })
      res.on('end', done)
      res.on('error', e => { clearTimeout(timer); reject(e) })
    })
    const timer = setTimeout(() => req.destroy(fail('timed out', 502)), Math.max(1, deadline - Date.now()))
    req.on('error', e => { clearTimeout(timer); reject(e) })
    req.end()
  })
}

// GET with a byte limit and a time limit, following at most three redirects. Every hop is checked
// again, and the connection uses only the addresses that passed, so a name can't change its answer
// between the check and the request.
export async function safeGet(start, { maxBytes = ICON_MAX, truncate = false, timeoutMs = 6000, blocked = blockedAddress, resolver = dns.lookup } = {}) {
  const deadline = Date.now() + timeoutMs
  let u = new URL(start)
  for (let hop = 0; hop < 4; hop++) {
    checkTarget(u, blocked)
    const out = await fetchOnce(u, { maxBytes, truncate, blocked, resolver, deadline })
    if (!out.redirect) return { ...out, url: u.href }
    u = new URL(out.redirect, u)
  }
  throw fail('too many redirects', 502)
}

// The bytes decide, not the header. SVG can carry script, so it isn't accepted.
export function sniffImage(b) {
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47) return { type: 'image/png', ext: 'png' }
  if (b.length >= 4 && b.readUInt32BE(0) === 0x00000100) return { type: 'image/x-icon', ext: 'ico' }
  if (b.length >= 6 && b.toString('latin1', 0, 4) === 'GIF8') return { type: 'image/gif', ext: 'gif' }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' }
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { type: 'image/webp', ext: 'webp' }
  return null
}

export function iconLinks(html, base) {
  const out = []
  for (const tag of String(html).match(/<link\b[^>]*>/gi) || []) {
    if (!/\brel\s*=\s*["']?[^"'>]*\bicon\b/i.test(tag)) continue
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
    if (!href) continue
    try { out.push(new URL(href[1] ?? href[2] ?? href[3], base).href) } catch {}
  }
  return out.slice(0, 3)
}

/* ---------- opening local links ---------- */

function openOnThisComputer(file, args) {
  const child = spawn(file, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}
const defaultOpeners = {
  folder: p => openOnThisComputer(process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open', [p]),
  url: u => process.platform === 'win32' ? openOnThisComputer('rundll32.exe', ['url.dll,FileProtocolHandler', u]) : openOnThisComputer(process.platform === 'darwin' ? 'open' : 'xdg-open', [u]),
}

/* ---------- the route ---------- */

export function create({ here, fetchOptions = {}, openers = defaultOpeners } = {}) {
  const dataDir = path.join(here, 'data')
  const file = path.join(dataDir, 'launcher.json')
  const iconDir = path.join(dataDir, 'launcher-icons')
  let warning = ''

  function setAside(tag) {
    const copy = path.join(dataDir, `launcher.${tag}-${Date.now()}.json`)
    try { fs.copyFileSync(file, copy) } catch {}
    return path.basename(copy)
  }

  // A broken file never stops the hub: it is kept beside the new one and the bar starts empty.
  function load() {
    let raw
    try { raw = fs.readFileSync(file, 'utf8') } catch (e) {
      if (e.code !== 'ENOENT') warning = 'Your saved links couldn’t be read.'
      return { links: [], snippets: [], usage: {} }
    }
    let saved
    try { saved = JSON.parse(raw.replace(/^﻿/, '')) } catch { saved = null }
    if (!isPlain(saved)) {
      warning = `Your saved links file was damaged, so it was kept as ${setAside('damaged')} and the list starts empty.`
      return { links: [], snippets: [], usage: {} }
    }
    const keep = (list, clean, prefix) => (Array.isArray(list) ? list : []).flatMap(item => {
      try { return [{ id: /^[\w-]{1,40}$/.test(item?.id) ? item.id : newId(prefix), ...clean(item) }] } catch { return [] }
    })
    const links = keep(saved.links, cleanLink, 'l')
    const snippets = keep(saved.snippets, cleanSnippet, 's')
    const dropped = (saved.links?.length || 0) + (saved.snippets?.length || 0) - links.length - snippets.length
    if (dropped > 0) warning = `${dropped} saved item${dropped === 1 ? ' wasn’t' : 's weren’t'} valid, so the file was kept as ${setAside('invalid')}.`
    const usage = {}
    for (const [k, v] of Object.entries(isPlain(saved.usage) ? saved.usage : {})) if (USAGE_KEY.test(k) && Number.isFinite(v?.n) && Number.isFinite(v?.at)) usage[k] = { n: v.n, at: v.at }
    return { links, snippets, usage }
  }

  const db = load()
  let at = Date.now()

  function saveNow() {
    fs.mkdirSync(dataDir, { recursive: true })
    const json = JSON.stringify({ format: FORMAT, version: 1, links: db.links, snippets: db.snippets, usage: db.usage }, null, 2)
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, json)
    try { fs.renameSync(tmp, file) } catch { fs.writeFileSync(file, json); try { fs.unlinkSync(tmp) } catch {} }
  }
  function changed() { at = Date.now(); clearTimeout(usageTimer); saveNow() }
  let usageTimer = 0
  function saveUsageSoon() {
    clearTimeout(usageTimer)
    usageTimer = setTimeout(() => { try { saveNow() } catch {} }, 1500)
    usageTimer.unref?.()
  }

  function count(key) {
    const u = db.usage[key] || { n: 0, at: 0 }
    db.usage[key] = { n: u.n + 1, at: Date.now() }
    const keys = Object.keys(db.usage)
    if (keys.length > MAX_USAGE) for (const k of keys.sort((a, b) => db.usage[a].at - db.usage[b].at).slice(0, keys.length - MAX_USAGE)) delete db.usage[k]
    saveUsageSoon()
  }

  const keywordTaken = (keyword, id) => !!keyword && db.snippets.some(s => s.keyword === keyword && s.id !== id)

  async function readJsonBody(req) {
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
      if (raw.length > MAX_BODY) throw fail('That is too large to send', 413)
    }
    // JSON.parse quotes the input in its error, and the input may be a snippet.
    try { return raw ? JSON.parse(raw) : {} } catch { throw fail('The request wasn’t valid JSON') }
  }

  function importInto(data, allowLocal) {
    const { links, snippets, skipped } = readImport(data)
    if (links.length + snippets.length > 2 * MAX_ITEMS) throw fail('That file holds too many items')
    const added = { links: 0, snippets: 0 }
    let unchanged = 0
    const seen = new Set(db.links.map(linkKey))
    for (const item of links) {
      try {
        const link = importedLink(item, allowLocal === true)
        if (seen.has(linkKey(link))) { unchanged++; continue }
        if (db.links.length >= MAX_ITEMS) throw fail('The library is full')
        db.links.push({ id: newId('l'), ...link })
        seen.add(linkKey(link))
        added.links++
      } catch (e) { skipped.push({ kind: 'link', name: cleanLine(item.name).slice(0, MAX_NAME), reason: e.message }) }
    }
    for (const item of snippets) {
      try {
        const snippet = cleanSnippet(item)
        if (db.snippets.some(s => s.name === snippet.name && s.text === snippet.text)) { unchanged++; continue }
        if (keywordTaken(snippet.keyword)) throw fail(`The keyword ${snippet.keyword} is already in use`)
        if (db.snippets.length >= MAX_ITEMS) throw fail('The library is full')
        db.snippets.push({ id: newId('s'), ...snippet })
        added.snippets++
      } catch (e) { skipped.push({ kind: 'snippet', name: cleanLine(item.name).slice(0, MAX_NAME), reason: e.message }) }
    }
    if (added.links || added.snippets) changed()
    return { added, unchanged, skipped: skipped.slice(0, 200), skippedCount: skipped.length }
  }

  /* ---------- icons ---------- */

  const inFlight = new Map()
  let fetching = 0
  const waiting = []
  async function slot(fn) {
    if (fetching >= ICON_FETCHES_AT_ONCE) await new Promise(r => waiting.push(r))
    fetching++
    try { return await fn() } finally { fetching--; waiting.shift()?.() }
  }

  async function fetchIcon(link) {
    const get = (u, o) => safeGet(u, { ...fetchOptions, ...o })
    const origin = new URL(link.url).origin
    const candidates = [`${origin}/favicon.ico`]
    for (let i = 0; i < candidates.length && i < 4; i++) {
      try {
        const r = await get(candidates[i], { maxBytes: ICON_MAX })
        const image = sniffImage(r.body)
        if (image) return { ...image, body: r.body }
      } catch (e) { if (e.message === 'private address') return null }
      if (i === 0) {
        try {
          const page = await get(link.url, { maxBytes: HTML_MAX, truncate: true })
          if (/html/i.test(page.type)) candidates.push(...iconLinks(page.body.toString('utf8'), page.url))
        } catch {}
      }
    }
    return null
  }

  function iconFiles(hash) {
    try { return fs.readdirSync(iconDir).filter(f => f.startsWith(`${hash}.`)) } catch { return [] }
  }
  function pruneIcons() {
    try {
      const names = fs.readdirSync(iconDir)
      if (names.length <= ICON_FILES_MAX) return
      const dated = names.map(f => ({ f, t: fs.statSync(path.join(iconDir, f)).mtimeMs })).sort((a, b) => a.t - b.t)
      for (const { f } of dated.slice(0, names.length - ICON_FILES_MAX)) fs.unlinkSync(path.join(iconDir, f))
    } catch {}
  }

  async function iconFor(link) {
    const hash = crypto.createHash('sha256').update(new URL(link.url).origin).digest('hex').slice(0, 32)
    const read = () => {
      const name = iconFiles(hash).find(f => !f.endsWith('.miss'))
      if (!name) return null
      const full = path.join(iconDir, name)
      const body = fs.readFileSync(full)
      const image = sniffImage(body)
      return image ? { ...image, body, fresh: Date.now() - fs.statSync(full).mtimeMs < ICON_FRESH_MS } : null
    }
    const have = read()
    if (have?.fresh) return have
    const miss = path.join(iconDir, `${hash}.miss`)
    try { if (Date.now() - fs.statSync(miss).mtimeMs < ICON_MISS_MS) return have } catch {}
    if (!inFlight.has(hash)) {
      inFlight.set(hash, slot(() => fetchIcon(link)).catch(() => null).then(image => {
        inFlight.delete(hash)
        fs.mkdirSync(iconDir, { recursive: true })
        for (const old of iconFiles(hash)) if (image || old.endsWith('.miss')) { try { fs.unlinkSync(path.join(iconDir, old)) } catch {} }
        if (image) fs.writeFileSync(path.join(iconDir, `${hash}.${image.ext}`), image.body)
        else fs.writeFileSync(miss, '')
        pruneIcons()
        return image
      }))
    }
    return (await inFlight.get(hash)) || have
  }

  /* ---------- requests ---------- */

  return async function route(url, req, res, { send }) {
    const p = url.pathname
    if (p === '/launcher') {
      if (req.method !== 'GET') return false
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      })
      res.end(fs.readFileSync(path.join(here, 'launcher.html')))
      return true
    }
    if (!p.startsWith('/api/launcher/')) return false
    try {
      const rest = p.slice('/api/launcher/'.length)
      const m = /^(links|snippets)(?:\/([\w-]{1,40}))?$/.exec(rest)
      if (m) {
        const list = m[1] === 'links' ? db.links : db.snippets
        const clean = m[1] === 'links' ? cleanLink : cleanSnippet
        if (!m[2]) {
          if (req.method === 'GET') return send(res, 200, { [m[1]]: list, at }), true
          if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true
          if (list.length >= MAX_ITEMS) throw fail('The library is full', 409)
          const item = clean(await readJsonBody(req))
          if (m[1] === 'snippets' && keywordTaken(item.keyword)) throw fail(`The keyword ${item.keyword} is already in use`, 409)
          const saved = { id: newId(m[1] === 'links' ? 'l' : 's'), ...item }
          list.push(saved)
          changed()
          return send(res, 200, saved), true
        }
        const i = list.findIndex(x => x.id === m[2])
        if (i < 0) throw fail('That item is gone', 404)
        if (req.method === 'PUT') {
          const item = clean(await readJsonBody(req))
          if (m[1] === 'snippets' && keywordTaken(item.keyword, m[2])) throw fail(`The keyword ${item.keyword} is already in use`, 409)
          list[i] = { id: m[2], ...item }
          changed()
          return send(res, 200, list[i]), true
        }
        if (req.method === 'DELETE') {
          list.splice(i, 1)
          delete db.usage[`${m[1] === 'links' ? 'link' : 'snippet'}:${m[2]}`]
          changed()
          return send(res, 200, { ok: true }), true
        }
        return send(res, 405, { error: 'method not allowed' }), true
      }
      if (rest === 'library' && req.method === 'GET') {
        return send(res, 200, { links: db.links, snippets: db.snippets, usage: db.usage, filesHome: os.homedir().replace(/\\/g, '/'), at, ...(warning ? { warning } : {}) }), true
      }
      if (rest === 'snippets' && req.method === 'GET') return send(res, 200, { snippets: db.snippets, at }), true
      if (rest === 'use' && req.method === 'POST') {
        const { key } = await readJsonBody(req)
        if (typeof key !== 'string' || !USAGE_KEY.test(key)) throw fail('Unknown item')
        count(key)
        return send(res, 200, { ok: true }), true
      }
      if (rest === 'open' && req.method === 'POST') {
        const { id } = await readJsonBody(req)
        const link = db.links.find(l => l.id === id)
        if (!link) throw fail('That link is gone', 404)
        // A web link opens in the page. Only a link that is already saved can start anything here.
        if (link.kind === 'web') throw fail('Web links open in the page')
        if (link.kind === 'obsidian') {
          // From another device, the link belongs to that device's Obsidian.
          if (!isLocal(req)) return send(res, 200, { open: link.url }), true
          openers.url(link.url)
          return send(res, 200, { ok: true }), true
        }
        if (!isLocal(req)) throw fail('Folders open only on the computer running the hub', 409)
        // holdsKeys checks the saved path, a junction can still lead elsewhere; the real path decides.
        let real
        try { real = fs.realpathSync(link.path) } catch { throw fail('That folder isn’t there', 404) }
        if (holdsKeys(real)) throw fail('That folder holds keys, so the hub won’t open it', 403)
        if (!fs.statSync(real).isDirectory()) throw fail('That isn’t a folder', 409)
        openers.folder(link.path)
        return send(res, 200, { ok: true }), true
      }
      if (rest === 'icon' && req.method === 'GET') {
        // Only a saved link's icon can be asked for, so this can't be pointed at an address from outside.
        const link = db.links.find(l => l.id === url.searchParams.get('id'))
        const icon = link?.kind === 'web' ? await iconFor(link) : null
        // No content rather than an error: most sites without an icon aren't a fault worth logging.
        if (!icon) { res.writeHead(204, { 'cache-control': 'private, max-age=3600' }); res.end(); return true }
        res.writeHead(200, {
          'content-type': icon.type,
          'content-length': icon.body.length,
          'cache-control': 'private, max-age=86400',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
        })
        res.end(icon.body)
        return true
      }
      if (rest === 'export' && req.method === 'GET') {
        const out = {
          format: FORMAT,
          version: 1,
          links: db.links.map(({ id, ...l }) => l),
          snippets: db.snippets.map(({ id, ...s }) => s),
        }
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': 'attachment; filename="local-hub-links-and-snippets.json"',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        res.end(JSON.stringify(out, null, 2))
        return true
      }
      if (rest === 'import' && req.method === 'POST') {
        const body = await readJsonBody(req)
        if (!isPlain(body) || body.data === undefined) throw fail('Send the file as { data }')
        return send(res, 200, importInto(body.data, body.allowLocal)), true
      }
      send(res, 404, { error: 'not found' })
    } catch (e) {
      send(res, Number.isInteger(e.code) ? e.code : 500, { error: Number.isInteger(e.code) ? e.message : 'The hub couldn’t do that' })
    }
    return true
  }
}
