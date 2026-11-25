// This hub's own name and icon (Settings › LocalHub Settings).
//   GET  /api/hub/identity        -> { name, icon, glyphs, colors, upload }   icon is { glyph, color }, 'upload', or null for LocalHub's
//   POST /api/hub/identity        { name?, icon? }   this computer only. An empty name is LocalHub again; icon null is LocalHub's
//   POST /api/hub/identity/icon   a PNG, JPEG or WebP, up to 2 MB, as the body (this computer only)
//   GET  /icons/hub.svg           the icon itself (hub-setup.mjs answers when there is none of its own)
// The name is hub.json's; the icon is kept in data/ (hub-icon.json, hub-icon.png and the like).
import fs from 'node:fs'
import path from 'node:path'
import { hubConfig, saveHubConfig } from './config.mjs'
import { isLocal } from './access.mjs'

const P = d => `<path d="${d}" fill="none" stroke="url(#h)" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>`
export const GLYPHS = {
  house: '<path d="M256 124 398 244H358V382H154V244H114Z" fill="url(#h)" stroke="url(#h)" stroke-width="26" stroke-linejoin="round"/><path d="M220 420V322a36 36 0 0 1 72 0V420Z" fill="url(#b)"/>',
  star: '<path d="m256 112 44 92 102 14-74 70 18 101-90-48-90 48 18-101-74-70 102-14z" fill="url(#h)" stroke="url(#h)" stroke-width="18" stroke-linejoin="round"/>',
  bolt: '<path d="M284 104 148 290h92l-18 118 142-194h-96z" fill="url(#h)" stroke="url(#h)" stroke-width="18" stroke-linejoin="round"/>',
  heart: '<path d="M256 398C120 306 108 246 108 208c0-48 36-84 80-84 30 0 54 16 68 42 14-26 38-42 68-42 44 0 80 36 80 84 0 38-12 98-148 190z" fill="url(#h)"/>',
  planet: '<circle cx="256" cy="256" r="92" fill="url(#h)"/>' + P('M168 300c-62 46-90 82-76 98 22 26 130-28 222-112s136-168 114-192c-14-16-56 0-112 38'),
  leaf: '<path d="M396 116c-170-8-272 66-272 178 0 28 8 56 24 78 22 16 50 24 78 24 112 0 186-102 170-280z" fill="url(#h)"/><path d="M124 396c40-92 96-148 172-182" fill="none" stroke="url(#b)" stroke-width="26" stroke-linecap="round"/>',
  diamond: '<path d="M176 132h160l72 92-152 172-152-172z" fill="url(#h)" stroke="url(#h)" stroke-width="20" stroke-linejoin="round"/>',
  orbit: P('M256 126v0M256 386v0') + '<circle cx="256" cy="256" r="118" fill="none" stroke="url(#h)" stroke-width="34"/><circle cx="256" cy="256" r="44" fill="url(#h)"/>',
  grid: [[136, 136], [272, 136], [136, 272], [272, 272]].map(([x, y]) => `<rect x="${x}" y="${y}" width="104" height="104" rx="28" fill="url(#h)"/>`).join(''),
  letter: '',
}
export const COLORS = { night: ['#2c3648', '#0b0f16'], black: ['#26272d', '#050506'], blue: ['#2f8fff', '#0a3d91'], purple: ['#a06bff', '#4a1d96'], pink: ['#ff6aa8', '#a3164f'], red: ['#ff6259', '#97140d'], orange: ['#ffab3d', '#b84e00'], green: ['#46d982', '#0c6b3a'], teal: ['#44d3d9', '#0b5f70'], light: ['#ffffff', '#c9ced8'] }
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
export const cleanIcon = i => (i && typeof i === 'object' && Object.hasOwn(GLYPHS, i.glyph ?? '') && Object.hasOwn(COLORS, i.color ?? '') ? { glyph: i.glyph, color: i.color } : i === 'upload' ? 'upload' : null)
/** The icon as a drawing. name gives the letter icon its letter. */
export function iconSvg({ glyph, color }, name = '') {
  const [a, b] = COLORS[color], ink = color === 'light' ? ['#2c3648', '#0b0f16'] : ['#ffffff', '#d9e1ec']
  const letter = esc([...String(name).trim()][0]?.toUpperCase() || 'L')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="b" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="512"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><linearGradient id="h" gradientUnits="userSpaceOnUse" x1="0" y1="110" x2="0" y2="400"><stop offset="0" stop-color="${ink[0]}"/><stop offset="1" stop-color="${ink[1]}"/></linearGradient></defs><rect width="512" height="512" rx="114" fill="url(#b)"/>${glyph === 'letter' ? `<text x="256" y="266" dy=".35em" text-anchor="middle" font-family="Inter, Segoe UI, system-ui, sans-serif" font-weight="700" font-size="290" fill="url(#h)">${letter}</text>` : GLYPHS[glyph]}</svg>`
}
export const imageType = b => (b.length > 12 && b.readUInt32BE(0) === 0x89504e47 ? 'png' : b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'jpeg' : b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : '')
const MAX = 2 * 2 ** 20

export function create({ here }) {
  const FILE = path.join(here, 'data', 'hub-icon.json'), IMG = t => path.join(here, 'data', `hub-icon.${t}`)
  let icon = null
  try { icon = cleanIcon(JSON.parse(fs.readFileSync(FILE, 'utf8')).icon) } catch {}
  const uploaded = () => ['png', 'jpeg', 'webp'].find(t => fs.existsSync(IMG(t))) || ''
  const keep = v => { icon = v; fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify({ icon })) }
  const view = () => ({ name: hubConfig().name, icon, glyphs: Object.keys(GLYPHS), colors: Object.fromEntries(Object.entries(COLORS)), upload: !!uploaded() })
  return async function route(url, req, res, { send, readBody }) {
    const p = url.pathname
    if (p === '/icons/hub.svg' && req.method === 'GET') {
      if (icon === 'upload') {
        const t = uploaded()
        if (!t) return false
        return send(res, 200, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><clipPath id="c"><rect width="512" height="512" rx="114"/></clipPath><image href="data:image/${t};base64,${fs.readFileSync(IMG(t)).toString('base64')}" width="512" height="512" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/></svg>`, 'image/svg+xml'), true
      }
      return icon ? (send(res, 200, iconSvg(icon, hubConfig().name), 'image/svg+xml'), true) : false
    }
    if (p === '/api/hub/identity/preview.svg' && req.method === 'GET') {
      const i = cleanIcon({ glyph: url.searchParams.get('glyph'), color: url.searchParams.get('color') })
      return i ? send(res, 200, iconSvg(i, hubConfig().name), 'image/svg+xml') : send(res, 404, { error: 'not found' }), true
    }
    if (p !== '/api/hub/identity' && p !== '/api/hub/identity/icon') return false
    if (req.method === 'GET') return send(res, 200, view()), true
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true
    if (!isLocal(req)) return send(res, 403, { error: 'The name and icon are changed on the computer the hub runs on.' }), true
    if (p === '/api/hub/identity/icon') {
      const parts = []
      let n = 0
      for await (const c of req) { n += c.length; if (n > MAX) return send(res, 413, { error: 'Use a picture up to 2 MB.' }), true; parts.push(c) }
      const b = Buffer.concat(parts), t = imageType(b)
      if (!t) return send(res, 415, { error: 'Use a PNG, JPEG or WebP picture.' }), true
      fs.mkdirSync(path.dirname(FILE), { recursive: true })
      for (const x of ['png', 'jpeg', 'webp']) if (x !== t) fs.rmSync(IMG(x), { force: true })
      fs.writeFileSync(IMG(t), b)
      keep('upload')
      return send(res, 200, view()), true
    }
    const b = await readBody(req).catch(() => ({})) || {}
    if (b.name !== undefined && typeof b.name !== 'string') return send(res, 400, { error: 'name is text' }), true
    if (b.icon !== undefined && b.icon !== null && !cleanIcon(b.icon)) return send(res, 400, { error: 'icon is one of the glyphs and colors' }), true
    if (b.name !== undefined) saveHubConfig({ name: b.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || 'LocalHub' })
    if (b.icon !== undefined) keep(b.icon === 'upload' && !uploaded() ? null : cleanIcon(b.icon))
    return send(res, 200, view()), true
  }
}
