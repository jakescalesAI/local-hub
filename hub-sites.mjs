// Website apps: can a site be shown inside the hub, and what is its icon.
//   GET /api/hub/embed-check?url=<http(s) url>  (x-hub: 1)  -> { embeddable, title, favicon }
//       Reads the site's response headers (X-Frame-Options, CSP frame-ancestors) with a short
//       timeout. Only public addresses are fetched: private, loopback and link-local ranges are
//       refused, except the hub's own pages, which are always embeddable. The page body never
//       leaves the hub; only the title and the icon address are returned.
//   GET /api/hub/app-icon/<site-id>  -> the saved website app's icon (cached in data/app-icons/),
//       204 when the site has none, so the page shows a letter tile and logs no error.
//   GET /api/hub/site-icon?url=<http(s) url>  -> the icon of any public page (kept in memory), for
//       chat cards and suggestions. Only bytes that are really an image are ever returned.
// The hub never proxies a site or strips its headers: a site that refuses framing opens in a new tab.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import { store, webUrl, SITE_ID_RE } from './hub-settings.mjs'

const TIMEOUT = 4000
const MAX_PAGE = 96 * 1024
const MAX_ICON = 512 * 1024
const CHECK_TTL = 6 * 3600 * 1000
const FAIL_TTL = 10 * 60 * 1000
const MAX_HOPS = 4

/* ---------- address safety ---------- */

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
  }
  const v = ip.toLowerCase()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
  if (mapped) return privateIp(mapped[1])
  return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v) || v.startsWith('64:ff9b:') || v.startsWith('2001:db8')
}

// Every connection resolves through this, so a name that points at a private address is refused
// at connect time (no DNS-rebinding gap between the check and the request).
function safeLookup(host, opts, cb) {
  dns.lookup(host, { all: true }, (err, list) => {
    if (err) return cb(err)
    const ok = list.filter(a => !privateIp(a.address))
    if (!ok.length || ok.length !== list.length) return cb(Object.assign(new Error('that address is on a private network'), { code: 'EPRIVATE' }))
    if (opts?.all) return cb(null, ok)
    cb(null, ok[0].address, ok[0].family)
  })
}

// One GET with redirects; resolves { url, status, headers, body (up to max bytes) }.
function fetchSafe(href, max, hops = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(href)
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && privateIp(u.hostname.replace(/^\[|\]$/g, ''))) return reject(Object.assign(new Error('private address'), { code: 'EPRIVATE' }))
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(u, {
      method: 'GET', lookup: safeLookup, timeout: TIMEOUT,
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 LocalHub/1', accept: 'text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.8', 'accept-language': 'en' },
    }, res => {
      const loc = res.headers.location
      if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
        res.resume()
        if (hops >= MAX_HOPS) return reject(new Error('too many redirects'))
        const nextUrl = webUrl(new URL(loc, u).href)
        if (!nextUrl) return reject(new Error('redirected to a non-web address'))
        return fetchSafe(nextUrl, max, hops + 1).then(resolve, reject)
      }
      const chunks = []
      let size = 0
      res.on('data', c => { size += c.length; chunks.push(c); if (size >= max) res.destroy() })
      const done = () => resolve({ url: u.href, status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).subarray(0, max) })
      res.on('end', done)
      res.on('close', done)
      res.on('error', done)
    })
    req.on('timeout', () => req.destroy(new Error('timed out')))
    req.on('error', reject)
    req.end()
  })
}

/* ---------- reading the answer ---------- */

// Blocked by X-Frame-Options (any value) or a CSP frame-ancestors that is not a wildcard.
export function frameAllowed(headers) {
  if (headers['x-frame-options']) return false
  const csp = [headers['content-security-policy']].flat().filter(Boolean).join(';')
  const fa = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(csp)
  if (!fa) return true
  const srcs = fa[1].trim().split(/\s+/)
  return srcs.includes('*') || srcs.includes('http:') || srcs.includes('https:')
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decode = t => t.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(parseInt(e.slice(e[1] === 'x' || e[1] === 'X' ? 2 : 1), e[1] === 'x' || e[1] === 'X' ? 16 : 10) || 32) : ENT[e.toLowerCase()] ?? m)

function readPage(html, base) {
  const title = decode((/<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim()).replace(/[<>\u0000-\u001f]/g, '').slice(0, 80)
  let best = null, score = -1
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0]
    const rel = (/\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1] || '').toLowerCase()
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || /\bhref\s*=\s*([^\s>]+)/i.exec(tag)?.[1]
    if (!href || !/\bicon\b/.test(rel)) continue
    const size = Number(/\bsizes\s*=\s*["']?(\d+)/i.exec(tag)?.[1]) || (rel.includes('apple-touch') ? 180 : 32)
    const svg = /\.svg(\?|$)/i.test(href) || /image\/svg/i.test(tag)
    const s = (svg ? 120 : Math.min(size, 256)) + (rel.includes('apple-touch') ? 5 : 0)
    let abs
    try { abs = webUrl(new URL(decode(href), base).href) } catch {}
    if (abs && s > score) (best = abs), (score = s)
  }
  return { title, small: score < 100, favicon: best || webUrl(new URL('/favicon.ico', base).href) }
}

const ICON_TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', svg: 'image/svg+xml' }
function sniffIcon(b) {
  if (b.length < 4) return ''
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg'
  if (b.toString('latin1', 0, 4) === 'GIF8') return 'gif'
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0) return 'ico'
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(b.toString('utf8', 0, 600))) return 'svg'
  return ''
}

/* ---------- route ---------- */

export function create({ here }) {
  const st = store(here)
  const iconDir = path.join(st.dataDir, 'app-icons')
  const checks = new Map() // url -> { at, ttl, value, pending }

  // Behind an https proxy such as Caddy the page is https, and a browser won't frame plain http in it.
  const httpsPage = req => req.headers['x-forwarded-proto'] === 'https'
  const ownPage = (u, req) => {
    const [h, p] = String(req.headers.host || '').split(/:(?=\d+$)/)
    const port = p || (httpsPage(req) ? '443' : '80')
    const local = ['localhost', '127.0.0.1', '[::1]', h].includes(u.hostname)
    return local && (u.port || (u.protocol === 'https:' ? '443' : '80')) === port
  }

  async function check(href) {
    const hit = checks.get(href)
    if (hit && (hit.pending || Date.now() - hit.at < hit.ttl)) return hit.pending || hit.value
    const pending = (async () => {
      try {
        const r = await fetchSafe(href, MAX_PAGE)
        const page = /html|xml/i.test(r.headers['content-type'] || '') ? readPage(r.body.toString('utf8'), r.url) : { title: '', favicon: webUrl(new URL('/favicon.ico', r.url).href) }
        const value = { embeddable: frameAllowed(r.headers), title: page.title || new URL(href).hostname, favicon: page.favicon, small: !!page.small, base: r.url }
        checks.set(href, { at: Date.now(), ttl: CHECK_TTL, value })
        return value
      } catch (e) {
        const u = new URL(href)
        const value = { embeddable: false, title: u.hostname, favicon: e.code === 'EPRIVATE' ? null : webUrl(new URL('/favicon.ico', u).href) }
        checks.set(href, { at: Date.now(), ttl: FAIL_TTL, value })
        return value
      }
    })()
    checks.set(href, { pending })
    return pending
  }

  // A page's icon as { ext, body }: the given src or the page's <link rel=icon>, else /favicon.ico.
  async function loadIcon(pageUrl, src) {
    let touch = null
    if (!src) { const c = await check(pageUrl); src = c.favicon; if (c.small || !c.base) touch = webUrl(new URL('/apple-touch-icon.png', c.base || pageUrl).href) }
    const tryOne = async u => { try { const r = await fetchSafe(u, MAX_ICON); const ext = r.status < 400 ? sniffIcon(r.body) : ''; return ext ? { ext, body: r.body } : null } catch { return null } }
    const ico = new URL('/favicon.ico', pageUrl).href
    const big = touch && await tryOne(touch)
    return (big?.ext === 'png' && big) || (src && await tryOne(src)) || (src !== ico ? await tryOne(ico) : null)
  }

  // Saved sites: cached on disk per site and icon choice; a miss is tried again after a day.
  async function iconFor(site) {
    if (!site.url) return null
    const key = crypto.createHash('sha1').update(`${site.icon || ''} ${site.url}`).digest('hex').slice(0, 12)
    try {
      const f = fs.readdirSync(iconDir).find(n => n.startsWith(`${site.id}.${key}.`))
      if (f && (!f.endsWith('.none') || Date.now() - fs.statSync(path.join(iconDir, f)).mtimeMs < 86400_000)) return f.endsWith('.none') ? null : path.join(iconDir, f)
    } catch {}
    fs.mkdirSync(iconDir, { recursive: true })
    const icon = await loadIcon(site.url, site.icon)
    for (const n of fs.readdirSync(iconDir)) if (n.startsWith(`${site.id}.`)) try { fs.renameSync(path.join(iconDir, n), path.join(iconDir, `.old-${Date.now()}-${n}`)) } catch {}
    const file = path.join(iconDir, `${site.id}.${key}.${icon ? icon.ext : 'none'}`)
    fs.writeFileSync(file, icon ? icon.body : '')
    return icon ? file : null
  }

  // Any page: kept in memory (300 pages, a day; a miss for an hour).
  const icons = new Map()
  async function siteIcon(href) {
    const hit = icons.get(href)
    if (hit && (hit.pending || Date.now() - hit.at < (hit.icon ? 86400_000 : 3600_000))) return hit.pending || hit.icon
    const pending = loadIcon(href).catch(() => null).then(icon => { icons.set(href, { at: Date.now(), icon }); return icon })
    icons.set(href, { pending })
    if (icons.size > 300) icons.delete(icons.keys().next().value)
    return pending
  }
  const ICON_HEADERS = ext => ({ 'content-type': ICON_TYPES[ext], 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" })

  return async function route(url, req, res, { send }) {
    const p = url.pathname
    if (p === '/api/hub/embed-check' && req.method === 'GET') {
      if (req.headers['x-hub'] !== '1') return send(res, 403, { error: 'missing x-hub header' }), true
      const href = webUrl(url.searchParams.get('url') || '')
      if (!href) return send(res, 400, { error: 'url must be an http or https address of up to 500 characters' }), true
      const u = new URL(href)
      if (ownPage(u, req)) return send(res, 200, { embeddable: true, title: 'LocalHub', favicon: null }), true
      const c = await check(href)
      return send(res, 200, httpsPage(req) && u.protocol === 'http:' ? { ...c, embeddable: false } : c), true
    }
    if (p === '/api/hub/site-icon' && req.method === 'GET') {
      const href = webUrl(url.searchParams.get('url') || '')
      if (!href) return send(res, 400, { error: 'url must be an http or https address of up to 500 characters' }), true
      if (ownPage(new URL(href), req)) return res.writeHead(204).end(), true
      const icon = await siteIcon(href)
      if (!icon) return res.writeHead(204).end(), true
      res.writeHead(200, ICON_HEADERS(icon.ext))
      return res.end(icon.body), true
    }
    const m = /^\/api\/hub\/app-icon\/([a-z0-9-]+)$/.exec(p)
    if (m && req.method === 'GET') {
      const site = SITE_ID_RE.test(m[1]) && (st.get().sites || []).find(s => s.id === m[1])
      if (!site) return send(res, 404, { error: 'not found' }), true
      const file = await iconFor(site).catch(() => null)
      if (!file) return send(res, 404, { error: 'no icon' }), true
      res.writeHead(200, ICON_HEADERS(file.split('.').pop()))
      return res.end(fs.readFileSync(file)), true
    }
    return false
  }
}
