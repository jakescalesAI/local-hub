// Music: what is playing on this PC (any player Windows knows: Spotify, Apple Music, a browser), on Spotify (signed in
// with your own Spotify app, for any of its devices) or on the TV, as one player, with this PC's volume and brightness.
//   GET  /api/music                       -> { source, pc, tv, spotify, now: { from, title, artist, app, playing, art, pos, dur, seek }, volume, brightness, monitors: [{ id, name, level, kind, on }], outputs: [{ id, name, on }], lyrics }
//   GET  /api/music/art/<key>.jpg            the cover of what's playing on this PC
//   POST /api/music/open                     brings that player to the front on this PC (from this PC only)
//   POST /api/music/do { action, from?, to? } toggle | next | prev | seek (to: seconds), on whichever is playing (or the one named)
//   POST /api/music/level { what, value, id? }  volume | brightness of this PC, 0-100: every monitor that is on, or the one named
//   POST /api/music/output { id }            which of this PC's sound devices plays (Windows' own choice, so it stays in step with it)
//   GET  /api/music/lyrics?title&artist&dur   -> { lines: [{ t, x }], plain } when lyrics are on: asked of lrclib.net, kept only in memory
//   POST /api/music/lyrics { on }            off until turned on: asking sends the song's name, artist and length there
//   POST /api/music/monitors { id, on }      whether the brightness slider moves that monitor (they all do at first)
//   POST /api/music/source { source }        auto | pc | spotify | tv
//   POST /api/music/spotify { clientId }     your Spotify app's Client ID (not a secret); '' disconnects
//   GET  /api/music/spotify/login            Spotify's own sign-in page (PKCE: there is no client secret)
//   GET  /api/music/spotify/callback         where Spotify sends you back
// Spotify's sign-in is kept in config/secrets.json, which only the hub reads. Signing in and the PC's own controls
// answer this computer and your paired TV (server.mjs decides who gets in).
import crypto from 'node:crypto'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { PORT, secrets, saveSecrets } from './config.mjs'
import { isLocal } from './access.mjs'
import { IS_WIN } from './platform.mjs'
import { pcHelper } from './pc-helper.mjs'

const SOURCES = ['auto', 'pc', 'spotify', 'tv']
const APP_NAMES = [[/spotify/i, 'Spotify'], [/applemusic|apple.*music/i, 'Apple Music'], [/msedge/i, 'Edge'], [/chrome/i, 'Chrome'], [/firefox/i, 'Firefox'], [/amazon.*music/i, 'Amazon Music'], [/tidal/i, 'TIDAL'], [/deezer/i, 'Deezer'], [/vlc/i, 'VLC'], [/zunemusic/i, 'Media Player']]
export const appName = id => APP_NAMES.find(([re]) => re.test(String(id)))?.[1] || String(id || '').replace(/!.*$/, '').replace(/\.exe$/i, '').split(/[.\\/]/).pop()
export function readLyrics(j) {
  const lines = [], text = String(j?.syncedLyrics || '').slice(0, 60_000)
  // A line can be sung at several times, and a file can say all its times are off by so much.
  const off = (Number(/\[offset:\s*([+-]?\d{1,5})\]/i.exec(text)?.[1]) || 0) / 1000
  for (const l of text.split('\n')) {
    const m = /^((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+)(.*)$/.exec(l.trim())
    if (m) for (const t of m[1].matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)) lines.push({ t: Math.max(0, Number(t[1]) * 60 + Number(t[2]) + Number(`0.${t[3] || 0}`) - off), x: m[2].replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim().slice(0, 300) })
  }
  if (Number.isFinite(j?.fix)) for (const l of lines) l.t = Math.max(0, Math.round((l.t + j.fix) * 1000) / 1000)
  lines.sort((a, b) => a.t - b.t)
  return { lines, plain: lines.length ? [] : String(j?.plainLyrics || '').slice(0, 60_000).split('\n').slice(0, 400).map(x => x.slice(0, 300)) }
}
const bare = s => String(s || '').toLowerCase().replace(/\s*[([](feat|ft|with|remaster|deluxe|explicit|bonus)[^)\]]*[)\]]/g, '').replace(/\s+-\s+.*(remaster|version|edit|mix).*$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const lineTimes = x => { const m = new Map(); for (const l of readLyrics(x).lines) { const k = bare(l.x); if (k.length > 3 && !m.has(k)) m.set(k, l.t) } return m }
const median = l => { const a = [...l].sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : 0 }
const people = s => bare(s).split(/ and | x | feat | with /).flatMap(x => x.split(',')).map(x => x.trim()).filter(Boolean)
/** The one for this recording: the same song, by the same artist, as long. People made these, and several are often there for one
 * song, some of them off: the one most of the others agree with is taken, and what it's off from them by is put right. */
export function pickLyrics(list, { title, artist = '', album = '', dur = 0 }) {
  const seen = new Set(), who = bare(artist)
  const same = x => !who || !x.artistName || bare(x.artistName).includes(who) || who.includes(bare(x.artistName)) || people(artist).some(p => people(x.artistName).includes(p))
  const ok = (Array.isArray(list) ? list : []).filter(x => x && (x.syncedLyrics || x.plainLyrics) && bare(x.trackName) === bare(title) && same(x) && (!dur || Math.abs(Number(x.duration) - dur) <= 3) && !seen.has(x.id ?? x) && seen.add(x.id ?? x))
  const near = x => Math.abs(Number(x.duration) - dur) * 0.4 + (album && bare(x.albumName) === bare(album) ? 0 : 0.2)
  const timed = ok.filter(x => x.syncedLyrics && readLyrics(x).lines.length > 3).slice(0, 14)
  if (!timed.length) return ok.sort((a, b) => near(a) - near(b))[0] || null
  if (timed.length < 3) return timed.sort((a, b) => near(a) - near(b))[0]
  const times = timed.map(lineTimes)
  // For each: how far off the others it is, line by line. A copy of the same file isn't another opinion.
  const prints = times.map(m => [...m.values()].map(v => v.toFixed(1)).join())
  const rated = timed.map((x, i) => {
    const offs = [], voted = new Set([prints[i]])
    times.forEach((m, j) => {
      if (j === i || voted.has(prints[j])) return
      const d = [...times[i]].filter(([k]) => m.has(k)).map(([k, t]) => m.get(k) - t)
      if (d.length < 4 || d.length < times[i].size * 0.4) return
      voted.add(prints[j])
      offs.push(median(d))
    })
    return { x, off: median(offs), n: offs.length, rough: offs.length ? median(offs.map(v => Math.abs(v))) : 1 }
  })
  const best = rated.sort((a, b) => a.rough + near(a.x) * 0.3 - (b.rough + near(b.x) * 0.3) || b.n - a.n)[0]
  // Only a shift the others agree about: a whole second off is another edit of the song, not a late hand.
  return best.n >= 2 && Math.abs(best.off) > 0.08 && Math.abs(best.off) < 1 ? { ...best.x, fix: best.off } : best.x
}
/** Where a song is, from a player that only says whole seconds, rounded down, and when it said so: each says the song began within
 * one second, and what they all agree on gets narrower. A player that says parts of a second is taken at its word. */
export function songClock() {
  let s = null
  return {
    see(key, raw, upd, playing, rate = 1) {
      if (!playing || rate !== 1 || !(upd > 0) || !Number.isFinite(raw)) { s = null; return }
      if (raw < 1) return // as a song starts it says 0 a while before there is sound
      const base = upd / 1000 - raw, whole = Math.abs(raw - Math.round(raw)) < 0.015
      if (!whole) { s = { key, lo: base, hi: base, exact: true }; return }
      if (!s || s.key !== key || s.exact ? !s?.exact || s.key !== key || Math.abs(base - s.hi) > 1.2 : base < s.lo - 0.12 || base - 1 > s.hi + 0.12) { s = { key, lo: base - 1, hi: base }; return }
      if (s.exact) return
      s.lo = Math.max(s.lo, base - 1)
      s.hi = Math.min(s.hi, base)
      if (s.lo > s.hi) s.lo = s.hi = (s.lo + s.hi) / 2
    },
    forget() { s = null },
    at(key, ms) { return s && s.key === key ? Math.max(0, ms / 1000 - (s.lo + s.hi) / 2) : null },
  }
}
// How far behind its own sound a player says it is, in seconds.
export const LEAD = { 'Apple Music': 1 }
const SITES = { 'YouTube Music': 'https://music.youtube.com', SoundCloud: 'https://soundcloud.com', Spotify: 'https://open.spotify.com', 'Apple Music': 'https://music.apple.com', 'Amazon Music': 'https://music.amazon.com', TIDAL: 'https://tidal.com', Deezer: 'https://www.deezer.com', Bandcamp: 'https://bandcamp.com', YouTube: 'https://www.youtube.com' }
const siteIcon = u => `/api/hub/site-icon?url=${encodeURIComponent(u)}`
export const validClientId = v => /^[0-9a-f]{32}$/i.test(String(v || ''))
// Whose player the card shows: the one that's playing, else the one last seen with something on.
export function pickNow(source, list) {
  if (source !== 'auto') return list.find(x => x.from === source) || null
  // A player that says it plays but not what doesn't take the place of a paused song.
  return list.find(x => x.playing && x.title) || list.find(x => x.title) || list.find(x => x.playing) || list[0] || null
}

export function create({ here }) {
  const FILE = path.join(here, 'data', 'music.json')
  let pref = { source: 'auto', skip: [], lyrics: false }
  const keep = () => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(pref)) }
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); pref = { source: SOURCES.includes(j.source) ? j.source : 'auto', skip: (Array.isArray(j.skip) ? j.skip : []).filter(x => typeof x === 'string' && x.length < 120).slice(0, 20), lyrics: j.lyrics === true } } catch {}
  const helper = pcHelper(here)
  const redirect = () => `http://127.0.0.1:${PORT}/api/music/spotify/callback`
  const box = () => (secrets().spotify && typeof secrets().spotify === 'object' ? secrets().spotify : {})
  let token = null // { value, until }
  let login = null // { state, verifier, at }
  let cache = { at: 0, data: null }
  let monitors = [], outputs = []
  const words = new Map()
  let cover = { key: '', body: null }, player = ''
  const secs = v => (Number.isFinite(v) && v >= 0 && v < 1e6 ? Math.round(v * 100) / 100 : null)

  const clock = songClock()
  // What was read a moment ago, moved on to now: a song doesn't wait for whoever asks.
  let sought = { at: 0 }
  const fresh = d => { const n = d.now; if (n && n.title === sought.title && Date.now() - sought.at < 2500 && Number.isFinite(n.pos)) return { ...d, now: { ...n, pos: secs(Math.min(n.dur || 1e6, sought.to + (n.playing ? (Date.now() - sought.at) / 1000 : 0))) } }; if (!n?.playing || !Number.isFinite(n.pos)) return d; const ms = Date.now(), exact = n.from === 'pc' ? clock.at(n.song, ms) : null; return { ...d, now: { ...n, pos: secs(Math.min(n.dur || 1e6, (exact ?? n.pos + (ms - (n.read || d.read)) / 1000) + (n.from === 'pc' ? LEAD[n.app] || 0 : 0))) } } }
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
      const asked = Date.now()
      const r = await spotify('GET', '/me/player')
      if (!r || r.status === 204 || !r.ok) spot.v = r?.status === 204 ? { from: 'spotify', title: '', artist: '', app: 'Spotify', playing: false, art: '' } : spot.v
      else {
        const j = await r.json()
        spot.v = { from: 'spotify', title: String(j.item?.name || '').slice(0, 200), artist: (j.item?.artists || []).map(a => a.name).join(', ').slice(0, 200) || String(j.item?.show?.name || ''), app: `Spotify${j.device?.name ? ` · ${j.device.name}` : ''}`, playing: !!j.is_playing, pos: secs(j.progress_ms / 1000), dur: secs((j.item?.duration_ms || 0) / 1000), seek: true, read: (asked + Date.now()) / 2, icon: siteIcon(SITES.Spotify), art: /^https:\/\/i\.scdn\.co\//.test(j.item?.album?.images?.[1]?.url || '') ? j.item.album.images[1].url : '' }
      }
    } catch {}
    return spot.v
  }
  async function tvNow() {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/tv/status`, { signal: AbortSignal.timeout(1500) }); const t = (await r.json()).tv; if (t?.on) { const m = t.state?.media || {}; return { from: 'tv', title: m.title || '', artist: m.artist || '', app: m.app || 'Your TV', playing: !!m.playing, pos: secs(m.pos), dur: secs(m.dur), seek: !!m.seek, art: m.art || '' } } } catch {}
    return null
  }
  async function state() {
    if (cache.data && Date.now() - cache.at < 900) return cache.data
    const asked = Date.now()
    const [pcs, sp, tv] = await Promise.all([helper.ask('state').catch(() => null), spotifyNow(), tvNow()])
    const m = pcs?.media || {}
    if (m.art) {
      const key = crypto.createHash('sha1').update(m.art).digest('hex').slice(0, 16)
      if (key !== cover.key) cover = { key, body: Buffer.from(m.art, 'base64') }
    }
    player = m.on ? String(m.app || '') : ''
    const song = `${m.app}|${m.title}|${m.artist}|${Math.round(m.dur || 0)}`, site = SITES[m.site] ? m.site : ''
    clock.see(song, m.raw, m.upd, !!m.playing, m.rate || 1)
    const pc = pcs ? { from: 'pc', title: String(m.title || '').slice(0, 200), artist: String(m.artist || '').slice(0, 200), app: m.on ? site || appName(m.app) : 'This PC', icon: !m.on ? '' : site ? siteIcon(SITES[site]) : `/api/desk/icon?id=${encodeURIComponent(`pc:${player}`)}`, song, album: String(m.album || '').slice(0, 200), playing: !!m.playing, pos: secs(m.pos), dur: secs(m.dur), seek: !!m.seek, art: m.art ? `/api/music/art/${cover.key}.jpg` : '' } : null
    const now = pickNow(pref.source, [pc, sp, tv].filter(Boolean))
    const mons = (Array.isArray(pcs?.monitors) ? pcs.monitors : []).map(x => ({ id: String(x.id), name: String(x.name).slice(0, 60), level: Number(x.level) || 0, kind: String(x.kind), on: !pref.skip.includes(x.id) }))
    monitors = mons
    outputs = (Array.isArray(pcs?.outputs) ? pcs.outputs : []).map(x => ({ id: String(x.id), name: String(x.name || 'Speakers').slice(0, 80), on: !!x.on }))
    const lit = mons.filter(x => x.on)
    const b = box()
    const data = { source: pref.source, now, pc: !!pcs, tv: !!tv, spotify: { clientId: b.clientId || '', connected: !!b.refresh, redirect: redirect() }, volume: pcs?.volume ?? null, brightness: lit.length ? Math.round(lit.reduce((n, x) => n + x.level, 0) / lit.length) : null, monitors: mons, outputs, lyrics: pref.lyrics }
    data.read = (asked + Date.now()) / 2
    if (now && now.from === 'pc') data.read = Date.now()
    cache = { at: Date.now(), data }
    return data
  }
  const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0b0e;color:#fff;font:600 20px system-ui"><div style="text-align:center"><h1 style="font-size:34px;margin:0 0 8px">${title}</h1>${text}</div>`

  return async function route(url, req, res, { send, readBody }) {
    const p = url.pathname
    if (p !== '/api/music' && !p.startsWith('/api/music/')) return false
    if (p === '/api/music' && req.method === 'GET') return send(res, 200, fresh(await state())), true
    const am = /^\/api\/music\/art\/([0-9a-f]{16})\.jpg$/.exec(p)
    if (am && req.method === 'GET') {
      if (am[1] !== cover.key || !cover.body) return send(res, 404, { error: 'not found' }), true
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': cover.body.length, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' })
      return res.end(cover.body), true
    }
    const b = req.method === 'POST' ? await readBody(req).catch(() => ({})) || {} : {}
    if (p === '/api/music/do' && req.method === 'POST') {
      const to = Number(b.to)
      if (b.action === 'seek' && !(to >= 0 && to < 1e6)) return send(res, 400, { error: 'to is in seconds' }), true
      if (!['toggle', 'next', 'prev', 'seek'].includes(b.action)) return send(res, 400, { error: 'action must be toggle, next or prev' }), true
      const s = await state(), from = SOURCES.includes(b.from) && b.from !== 'auto' ? b.from : s.now?.from
      let ok = false
      if (from === 'pc') ok = !!(await helper.ask('media', b.action === 'seek' ? `seek:${to}` : b.action).catch(() => null))?.ok
      else if (from === 'tv') ok = await fetch(`http://127.0.0.1:${PORT}/api/tv/command`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ type: 'media', action: b.action, ...(b.action === 'seek' ? { value: to } : {}) }) }).then(r => r.ok, () => false)
      else if (from === 'spotify') {
        const r = await (b.action === 'seek' ? spotify('PUT', `/me/player/seek?position_ms=${Math.round(to * 1000)}`) : b.action === 'toggle' ? spotify('PUT', s.now?.playing ? '/me/player/pause' : '/me/player/play') : spotify('POST', b.action === 'next' ? '/me/player/next' : '/me/player/previous')).catch(() => null)
        ok = !!r?.ok
        spot.at = 0
        if (r && !ok) { const j = await r.json().catch(() => ({})); return send(res, 200, { ok, error: r.status === 403 ? 'Spotify allows this with Premium only.' : r.status === 404 ? 'Open Spotify on a device first.' : String(j.error?.message || 'Spotify said no.').slice(0, 160) }), true }
      }
      cache.at = 0
      clock.forget()
      if (ok && b.action === 'seek') sought = { at: Date.now(), to, title: s.now?.title }
      return send(res, 200, { ok, ...(ok ? {} : { error: from === 'pc' ? 'Nothing is open to play. Start a song in any player on this PC.' : 'That didn’t go through.' }) }), true
    }
    if (p === '/api/music/open' && req.method === 'POST') {
      if (!isLocal(req)) return send(res, 403, { error: 'Players open on the computer the hub runs on.' }), true
      await state()
      if (!IS_WIN || !/^[\w.!-]{1,200}$/.test(player)) return send(res, 200, { ok: false, error: 'That player can’t be opened from here.' }), true
      spawn('explorer.exe', [`shell:AppsFolder\\${player}`], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref()
      return send(res, 200, { ok: true }), true
    }
    if (p === '/api/music/level' && req.method === 'POST') {
      const v = Number(b.value)
      if (!['volume', 'brightness'].includes(b.what) || !(v >= 0 && v <= 100)) return send(res, 400, { error: 'what is volume or brightness, value 0 to 100' }), true
      if (b.what === 'brightness' && !monitors.length) await state()
      const ids = b.id === undefined ? monitors.filter(x => x.on).map(x => x.id) : monitors.filter(x => x.id === b.id).map(x => x.id)
      const r = await (b.what === 'volume' ? helper.ask('volume', Math.round(v)) : helper.ask('brightness', { ids, value: Math.round(Math.max(5, v)) })).catch(e => ({ error: e.message }))
      cache.at = 0
      const no = r.bad?.length ? `${r.bad.join(' and ')} didn’t take it.` : r.ok ? '' : b.what === 'volume' ? 'The volume didn’t change.' : 'No monitor is set to follow the slider.'
      return send(res, 200, { ok: !!r.ok && !no, ...(no ? { error: no } : {}) }), true
    }
    if (p === '/api/music/output' && req.method === 'POST') {
      if (!outputs.some(x => x.id === b.id)) return send(res, 400, { error: 'That sound device isn’t connected any more.' }), true
      const r = await helper.ask('output', b.id).catch(e => ({ error: e.message }))
      cache.at = 0
      return send(res, 200, { ok: !!r.ok, ...(r.ok ? {} : { error: 'Windows didn’t change the sound device.' }) }), true
    }
    if (p === '/api/music/lyrics' && req.method === 'POST') { pref.lyrics = b.on === true; keep(); cache.at = 0; return send(res, 200, { ok: true, on: pref.lyrics }), true }
    if (p === '/api/music/lyrics' && req.method === 'GET') {
      if (!pref.lyrics) return send(res, 200, { off: true, lines: [], plain: [] }), true
      const q = k => String(url.searchParams.get(k) || '').slice(0, 200).trim(), title = q('title'), [artist, album = ''] = q('artist').split(' — ').map(x => x.trim()), dur = Math.round(Number(q('dur')) || 0)
      if (!title) return send(res, 200, { lines: [], plain: [] }), true
      const key = JSON.stringify([title, artist, dur])
      if (!words.has(key)) {
        let found = { lines: [], plain: [] }
        try {
          const ask = async (path, o) => { const r = await fetch(`https://lrclib.net/api/${path}?${new URLSearchParams(o)}`, { headers: { 'user-agent': 'media-player' }, signal: AbortSignal.timeout(9000) }); return r.ok ? r.json() : null }
          const plainTitle = title.replace(/\s*[([](feat|ft|with)\b[^)\]]*[)\]]/i, '').trim()
          const one = dur ? await ask('get', { track_name: title, artist_name: artist, ...(album ? { album_name: album } : {}), duration: String(dur) }).catch(() => null) : null
          const more = await Promise.all([ask('search', { track_name: plainTitle, artist_name: artist }), ask('search', { q: `${plainTitle} ${artist}` })].map(p => p.catch(() => [])))
          found = readLyrics(pickLyrics([one, ...more.flat()], { title, artist, album, dur }) || (one?.plainLyrics ? { plainLyrics: one.plainLyrics } : null))
        } catch {}
        words.set(key, found)
        if (words.size > 20) words.delete(words.keys().next().value)
      }
      return send(res, 200, words.get(key)), true
    }
    if (p === '/api/music/monitors' && req.method === 'POST') {
      if (typeof b.id !== 'string' || typeof b.on !== 'boolean' || !monitors.some(x => x.id === b.id)) return send(res, 400, { error: 'id is one of the monitors, on is true or false' }), true
      pref.skip = b.on ? pref.skip.filter(x => x !== b.id) : [...new Set([...pref.skip, b.id])].slice(-20)
      keep()
      cache.at = 0
      return send(res, 200, { ok: true }), true
    }
    if (p === '/api/music/source' && req.method === 'POST') {
      if (!SOURCES.includes(b.source)) return send(res, 400, { error: 'unknown source' }), true
      pref = { ...pref, source: b.source }
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
