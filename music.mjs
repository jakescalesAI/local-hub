// Music: what is playing on this PC (any player Windows knows: Spotify, Apple Music, a browser), on Spotify (signed in
// with your own Spotify app, for any of its devices) or on the TV, as one player, with this PC's volume and brightness.
//   GET  /api/music                       -> { source, pc, tv, spotify, now: { from, title, artist, app, playing, art }, volume, brightness }
//   POST /api/music/do { action, from? }     toggle | next | prev, on whichever is playing (or the one named)
//   POST /api/music/level { what, value }    volume | brightness of this PC, 0-100
//   POST /api/music/source { source }        auto | pc | spotify | tv
//   POST /api/music/spotify { clientId }     your Spotify app's Client ID (not a secret); '' disconnects
//   GET  /api/music/spotify/login            Spotify's own sign-in page (PKCE: there is no client secret)
//   GET  /api/music/spotify/callback         where Spotify sends you back
// Spotify's sign-in is kept in config/secrets.json, which only the hub reads. Signing in and the PC's own controls
// answer this computer and your paired TV (server.mjs decides who gets in).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PORT, secrets, saveSecrets } from './config.mjs'
import { isLocal } from './access.mjs'
import { IS_WIN } from './platform.mjs'
import { pcHelper } from './pc-helper.mjs'

const SOURCES = ['auto', 'pc', 'spotify', 'tv']
const APP_NAMES = [[/spotify/i, 'Spotify'], [/applemusic|apple.*music/i, 'Apple Music'], [/msedge/i, 'Edge'], [/chrome/i, 'Chrome'], [/firefox/i, 'Firefox'], [/amazon.*music/i, 'Amazon Music'], [/tidal/i, 'TIDAL'], [/deezer/i, 'Deezer'], [/vlc/i, 'VLC'], [/zunemusic/i, 'Media Player']]
export const appName = id => APP_NAMES.find(([re]) => re.test(String(id)))?.[1] || String(id || '').replace(/!.*$/, '').replace(/\.exe$/i, '').split(/[.\\/]/).pop()
export const validClientId = v => /^[0-9a-f]{32}$/i.test(String(v || ''))
// Whose player the card shows: the one that's playing, else the one last seen with something on.
export function pickNow(source, list) {
  if (source !== 'auto') return list.find(x => x.from === source) || null
  return list.find(x => x.playing) || list.find(x => x.title) || list[0] || null
}

export function create({ here }) {
  const FILE = path.join(here, 'data', 'music.json')
  let pref = { source: 'auto' }
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (SOURCES.includes(j.source)) pref = { source: j.source } } catch {}
  const helper = pcHelper(here)
  const redirect = () => `http://127.0.0.1:${PORT}/api/music/spotify/callback`
  const box = () => (secrets().spotify && typeof secrets().spotify === 'object' ? secrets().spotify : {})
  let token = null // { value, until }
  let login = null // { state, verifier, at }
  let cache = { at: 0, data: null }

  async function spotifyToken() {
    const b = box()
    if (!b.refresh) return null
    if (token && token.until > Date.now()) return token.value
    const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: b.refresh, client_id: b.clientId }), signal: AbortSignal.timeout(8000) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.access_token) { if (r.status === 400 || r.status === 401) saveSecrets({ spotify: { clientId: b.clientId } }); return null }
    if (j.refresh_token && j.refresh_token !== b.refresh) saveSecrets({ spotify: { ...b, refresh: j.refresh_token } })
    token = { value: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60_000 }
    return token.value
  }
  async function spotify(method, p) {
    const t = await spotifyToken()
    if (!t) return null
    return fetch(`https://api.spotify.com/v1${p}`, { method, headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(6000) })
  }
  let spot = { at: 0, v: null }
  async function spotifyNow() {
    if (!box().refresh) return null
    if (Date.now() - spot.at < 4000) return spot.v
    spot.at = Date.now()
    try {
      const r = await spotify('GET', '/me/player')
      if (!r || r.status === 204 || !r.ok) spot.v = r?.status === 204 ? { from: 'spotify', title: '', artist: '', app: 'Spotify', playing: false, art: '' } : spot.v
      else {
        const j = await r.json()
        spot.v = { from: 'spotify', title: String(j.item?.name || '').slice(0, 200), artist: (j.item?.artists || []).map(a => a.name).join(', ').slice(0, 200) || String(j.item?.show?.name || ''), app: `Spotify${j.device?.name ? ` · ${j.device.name}` : ''}`, playing: !!j.is_playing, art: /^https:\/\/i\.scdn\.co\//.test(j.item?.album?.images?.[1]?.url || '') ? j.item.album.images[1].url : '' }
      }
    } catch {}
    return spot.v
  }
  async function tvNow() {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/tv/status`, { signal: AbortSignal.timeout(1500) }); const t = (await r.json()).tv; if (t?.on) { const m = t.state?.media || {}; return { from: 'tv', title: m.title || '', artist: m.artist || '', app: m.app || 'Your TV', playing: !!m.playing, art: m.art || '' } } } catch {}
    return null
  }
  async function state() {
    if (cache.data && Date.now() - cache.at < 900) return cache.data
    const [pcs, sp, tv] = await Promise.all([helper.ask('state').catch(() => null), spotifyNow(), tvNow()])
    const m = pcs?.media || {}
    const pc = pcs ? { from: 'pc', title: String(m.title || '').slice(0, 200), artist: String(m.artist || '').slice(0, 200), app: m.on ? appName(m.app) : 'This PC', playing: !!m.playing, art: /^data:image\/[a-z.+-]+;base64,/.test(m.art || '') ? m.art : '' } : null
    const now = pickNow(pref.source, [pc, sp, tv].filter(Boolean))
    const b = box()
    const data = { source: pref.source, now, pc: !!pcs, tv: !!tv, spotify: { clientId: b.clientId || '', connected: !!b.refresh, redirect: redirect() }, volume: pcs?.volume ?? null, brightness: pcs?.brightness ?? null }
    cache = { at: Date.now(), data }
    return data
  }
  const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0b0e;color:#fff;font:600 20px system-ui"><div style="text-align:center"><h1 style="font-size:34px;margin:0 0 8px">${title}</h1>${text}</div>`

  return async function route(url, req, res, { send, readBody }) {
    const p = url.pathname
    if (p !== '/api/music' && !p.startsWith('/api/music/')) return false
    if (p === '/api/music' && req.method === 'GET') return send(res, 200, await state()), true
    const b = req.method === 'POST' ? await readBody(req).catch(() => ({})) || {} : {}
    if (p === '/api/music/do' && req.method === 'POST') {
      if (!['toggle', 'next', 'prev'].includes(b.action)) return send(res, 400, { error: 'action must be toggle, next or prev' }), true
      const s = await state(), from = SOURCES.includes(b.from) && b.from !== 'auto' ? b.from : s.now?.from
      let ok = false
      if (from === 'pc') ok = !!(await helper.ask('media', b.action).catch(() => null))?.ok
      else if (from === 'tv') ok = await fetch(`http://127.0.0.1:${PORT}/api/tv/command`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ type: 'media', action: b.action }) }).then(r => r.ok, () => false)
      else if (from === 'spotify') {
        const r = await (b.action === 'toggle' ? spotify('PUT', s.now?.playing ? '/me/player/pause' : '/me/player/play') : spotify('POST', b.action === 'next' ? '/me/player/next' : '/me/player/previous')).catch(() => null)
        ok = !!r?.ok
        spot.at = 0
        if (r && !ok) { const j = await r.json().catch(() => ({})); return send(res, 200, { ok, error: r.status === 403 ? 'Spotify allows this with Premium only.' : r.status === 404 ? 'Open Spotify on a device first.' : String(j.error?.message || 'Spotify said no.').slice(0, 160) }), true }
      }
      cache.at = 0
      return send(res, 200, { ok, ...(ok ? {} : { error: from === 'pc' ? 'Nothing is open to play. Start a song in any player on this PC.' : 'That didn’t go through.' }) }), true
    }
    if (p === '/api/music/level' && req.method === 'POST') {
      const v = Number(b.value)
      if (!['volume', 'brightness'].includes(b.what) || !(v >= 0 && v <= 100)) return send(res, 400, { error: 'what is volume or brightness, value 0 to 100' }), true
      const r = await helper.ask(b.what, Math.round(b.what === 'brightness' ? Math.max(5, v) : v)).catch(e => ({ error: e.message }))
      cache.at = 0
      return send(res, 200, { ok: !!r.ok, ...(r.error ? { error: 'This screen doesn’t let apps change that.' } : {}) }), true
    }
    if (p === '/api/music/source' && req.method === 'POST') {
      if (!SOURCES.includes(b.source)) return send(res, 400, { error: 'unknown source' }), true
      pref = { source: b.source }
      cache.at = 0
      fs.mkdirSync(path.dirname(FILE), { recursive: true })
      fs.writeFileSync(FILE, JSON.stringify(pref))
      return send(res, 200, { ok: true }), true
    }
    if (p === '/api/music/spotify' && req.method === 'POST') {
      if (!isLocal(req)) return send(res, 403, { error: 'Do this on the computer the hub runs on.' }), true
      const id = String(b.clientId || '').trim()
      if (id && !validClientId(id)) return send(res, 400, { error: 'A Client ID is 32 letters and digits, from your app at developer.spotify.com.' }), true
      token = null
      spot = { at: 0, v: null }
      cache.at = 0
      saveSecrets({ spotify: id ? { clientId: id } : {} })
      return send(res, 200, { ok: true }), true
    }
    if (p === '/api/music/spotify/login' && req.method === 'GET') {
      if (!isLocal(req)) return send(res, 403, 'Do this on the computer the hub runs on.', 'text/plain; charset=utf-8'), true
      const { clientId } = box()
      if (!clientId) return send(res, 400, 'Add your Client ID first.', 'text/plain; charset=utf-8'), true
      login = { state: crypto.randomBytes(16).toString('hex'), verifier: crypto.randomBytes(48).toString('base64url'), at: Date.now() }
      const q = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirect(), state: login.state, code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(login.verifier).digest('base64url'), scope: 'user-read-playback-state user-modify-playback-state user-read-currently-playing' })
      res.writeHead(302, { location: `https://accounts.spotify.com/authorize?${q}`, 'cache-control': 'no-store' })
      return res.end(), true
    }
    if (p === '/api/music/spotify/callback' && req.method === 'GET') {
      const html = (c, t, x) => (send(res, c, page(t, x), 'text/html; charset=utf-8'), true)
      const l = login
      login = null
      if (!isLocal(req) || !l || Date.now() - l.at > 600_000 || url.searchParams.get('state') !== l.state) return html(400, 'That sign-in expired', 'Start it again from LocalHub’s Settings.')
      const code = url.searchParams.get('code')
      if (!code) return html(400, 'Spotify wasn’t connected', 'You can close this and try again.')
      const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect(), client_id: box().clientId, code_verifier: l.verifier }), signal: AbortSignal.timeout(10_000) }).catch(() => null)
      const j = await r?.json().catch(() => ({}))
      if (!r?.ok || !j.refresh_token) return html(400, 'Spotify wasn’t connected', 'Check that the redirect address in your Spotify app matches the one in Settings.')
      saveSecrets({ spotify: { clientId: box().clientId, refresh: j.refresh_token } })
      token = { value: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60_000 }
      spot.at = 0
      cache.at = 0
      return html(200, 'Spotify is connected', 'You can close this and go back to LocalHub.')
    }
    send(res, 404, { error: 'not found' })
    return true
  }
}
