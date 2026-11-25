// TV back end: LocalHub on your TV (tv/README.md).
//
//   GET  /tv/…                          the TV interface, tv/ui: the same files the Fire TV app ships
//   GET  /api/tv/next                   -> { seq } the newest command number, to start from
//   GET  /api/tv/next?after=n&wait=25   -> { seq, command } as soon as one is newer than n, else 204
//   POST /api/tv/command  { type, … }   -> { ok, seq, tvs } queue a command for every TV showing LocalHub
//   POST /api/tv/transcribe  <audio>    -> { ok, text, ms } speech to text with Whisper, on this computer
//   POST /api/voice/transcribe <audio>  the same, for the hub's chat mic (the dashboard and the TV)
//   POST /api/voice/warm                 -> { whisper } start Whisper now, while someone is still talking
//   GET  /api/tv/status                 -> { whisper, alexa, tvs, tv: { on, setUp, apps } }
//   POST /api/tv/mirror { html, … }       the TV's screen, while a computer watches; GET ?after=n waits for the next
//   POST|GET /api/tv/art/<app>/<banner|icon>.png   its apps' pictures, for the mirror
//   POST /api/tv/state { brightness, volume, media }  what the TV is doing, for the Layout panel on the computer
//   POST /api/tv/apps  { apps }          the Fire TV app's app names, for the desktop app's tray menu
//   GET  /api/tv/listen                 -> { on, state, mic } "Hey LocalHub" from this computer's mic (tv/listen.py)
//   POST /api/tv/listen  { on }         turns it on or off (kept in data/tv-listen.json)
//   POST /api/tv/listen/now             the remote's mic button: listen for a request at once -> { ok }
//
// Commands: { type: 'launch', app } · { type: 'input', name } · { type: 'home' } · { type: 'saver' } ·
// { type: 'mirror', on } · { type: 'key', name } · { type: 'tap', x, y } · { type: 'type', text } (a computer driving the TV) ·
// { type: 'state' } · { type: 'media', action: 'toggle' | 'next' | 'prev' } · { type: 'brightness' | 'volume', value: 0-100 } ·
// { type: 'open', url } (a web page, in the TV's browser) · { type: 'sleep' } · { type: 'say', text } · { type: 'answer', text, heard?, from? } ·
// { type: 'listen', stage: 'wake' | 'again' | 'working' | 'heard' | 'off', text? } ("Hey LocalHub", step by step)
//
// Alexa ("Alexa, ask local hub to open Netflix") reaches a second listener, 127.0.0.1:<tv.alexa.port>,
// that answers POST /alexa and nothing else, and only after Amazon's request signature checks out.
// Point a tunnel at that port, never at the hub: the hub itself stays off the internet.
//
// Settings in config/hub.json, all optional:
//   "tv": { "whisper": { "model": "base.en", "fast": "tiny.en", "python": "python", "device": "cpu" },
//           "alexa": { "skillId": "amzn1.ask.skill.…", "port": 3109 } }
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import tls from 'node:tls'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { hubConfig, saveHubConfig, PORT } from './config.mjs'
import { isLocal } from './access.mjs'
import { create as createStream } from './stream.mjs'
import { create as createWeather } from './weather.mjs'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.json': 'application/json; charset=utf-8',
}
const AUDIO_EXT = { 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav', 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3' }
const MAX_AUDIO = 8 * 2 ** 20
const COMMAND_TTL = 90e3
const MAX_WAIT = 30e3
const TV_SEEN = 60e3
const TYPES = new Set(['launch', 'input', 'home', 'saver', 'sleep', 'say', 'answer', 'listen', 'open', 'state', 'media', 'brightness', 'volume', 'mirror', 'key', 'tap', 'type', 'audio'])
// The remote from a computer is for now: one that waited (the TV was asleep) is dropped, never played back later.
const NOW_ONLY = new Set(['key', 'tap', 'type', 'mirror'])
const NOW_TTL = 4000
const KEYS = new Set(['left', 'right', 'up', 'down', 'enter', 'back', 'home', 'menu', 'rew', 'ff', 'ai'])
const MAX_MIRROR = 3 * 2 ** 20
const MAX_ART = 600 * 1024
const LISTEN_STAGES = new Set(['wake', 'again', 'working', 'heard', 'off'])

const tvConfig = () => hubConfig().tv || {}

let VERSION = null
function hubVersion(here) {
  if (VERSION == null) {
    try { VERSION = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')).version || '' } catch { VERSION = '' }
  }
  return VERSION
}

export function create({ here }) {
  const uiDir = path.join(here, 'tv', 'ui')
  const whisper = createWhisper(here)
  const stream = createStream({ here }) // /api/tv/stream/*: the TV's browsers (stream.mjs)
  const weather = createWeather({ here }) // /api/tv/weather: the weather widget's (weather.mjs)
  const tts = createTts(here) // /api/tv/speak: the TV's voice, Kokoro on this computer (tv/tts.py)
  const commands = []
  const waiters = new Set()
  let seq = 0
  let lastPoll = 0
  let lastTvPoll = 0 // a real TV (the Fire TV app), not the TV page open on a laptop

  const known = knownTv(here)
  let tvState = null // what the TV last said of itself (POST /api/tv/state), for the Layout panel on the computer
  const tvOn = () => Date.now() - lastTvPoll < TV_SEEN
  const tvsOnline = () => waiters.size > 0 || Date.now() - lastPoll < TV_SEEN

  function queue(raw) {
    const command = cleanCommand(raw)
    if (!command) return null
    // "Hey LocalHub" is for the TV when one is on: a laptop with the TV page open leaves it alone.
    if (command.type === 'listen') command.tv = Date.now() - lastTvPoll < TV_SEEN
    seq += 1
    commands.push({ seq, at: Date.now(), command })
    while (commands.length && Date.now() - commands[0].at > COMMAND_TTL) commands.shift()
    if (commands.length > 50) commands.splice(0, commands.length - 50)
    for (const w of [...waiters]) {
      const found = nextAfter(w.after)
      if (found) w.deliver(found)
    }
    return seq
  }

  const nextAfter = after => commands.find(c => c.seq > after && Date.now() - c.at < (NOW_ONLY.has(c.command.type) ? NOW_TTL : COMMAND_TTL))

  // What's on the TV's screen, as its page last sent it (only while a computer is watching), and its apps' pictures.
  let mirror = { n: 0 }
  const mirrorWaiters = new Set()
  const art = new Map()

  async function route(url, req, res, { send }) {
    const p = url.pathname
    if (p === '/tv' && req.method === 'GET') {
      res.writeHead(302, { location: '/tv/', 'cache-control': 'no-store' })
      res.end()
      return true
    }
    if (p.startsWith('/tv/') && req.method === 'GET') return serveUi(p, res, send), true
    if (!p.startsWith('/api/tv/') && !p.startsWith('/api/voice/')) return false
    if (await stream(url, req, res, { send })) return true

    if (p === '/api/voice/warm' && req.method === 'POST') {
      whisper.warm()
      return send(res, 200, { whisper: whisper.state() }), true
    }

    if (p === '/api/tv/next' && req.method === 'GET') {
      lastPoll = Date.now()
      if (url.searchParams.get('tv') === '1') lastTvPoll = lastPoll
      const after = url.searchParams.get('after')
      if (after == null || after === '') return send(res, 200, { seq }), true
      const n = Number(after)
      if (!Number.isInteger(n) || n < 0) return send(res, 400, { error: 'after must be a whole number' }), true
      // A number from before the hub restarted (it counts from 0 again): start over from now, or the TV would wait
      // for the count to pass its old number and miss everything until then.
      if (n > seq) return send(res, 200, { seq }), true
      const found = nextAfter(n)
      if (found) return send(res, 200, { seq: found.seq, command: found.command }), true
      const wait = Math.min(MAX_WAIT, Math.max(0, Number(url.searchParams.get('wait') || 0) * 1000))
      if (!wait) return noContent(res), true
      await new Promise(resolve => {
        const w = {
          after: n,
          deliver: c => { finish(); send(res, 200, { seq: c.seq, command: c.command }) },
        }
        const timer = setTimeout(() => { finish(); noContent(res) }, wait)
        function finish() {
          clearTimeout(timer)
          waiters.delete(w)
          lastPoll = Date.now()
          if (url.searchParams.get('tv') === '1') lastTvPoll = lastPoll
          resolve()
        }
        req.on('close', () => { if (waiters.has(w)) finish() })
        waiters.add(w)
      })
      return true
    }

    if (p === '/api/tv/mirror' && req.method === 'POST') {
      let b
      try { b = JSON.parse((await readRaw(req, MAX_MIRROR)).toString('utf8') || '{}') } catch { return send(res, 400, { error: 'body is not valid JSON' }), true }
      const s = v => (typeof v === 'string' ? v : '')
      mirror = { n: mirror.n + 1, at: Date.now(), html: s(b.html), cls: s(b.cls).slice(0, 400), style: s(b.style).slice(0, 4000), wall: s(b.wall).slice(0, 600), away: b.away === true, stream: b.stream === true, k: Number(b.k) || 1 }
      for (const w of [...mirrorWaiters]) w()
      return send(res, 200, { ok: true, n: mirror.n }), true
    }
    if (p === '/api/tv/mirror' && req.method === 'GET') {
      const after = Number(url.searchParams.get('after')) || 0
      if (mirror.n <= after) await new Promise(done => {
        const fin = () => { clearTimeout(t); mirrorWaiters.delete(fin); done() }
        const t = setTimeout(fin, 10_000)
        mirrorWaiters.add(fin)
        req.on('close', fin)
      })
      if (mirror.n <= after) return noContent(res), true
      return send(res, 200, mirror), true
    }
    const am = /^\/api\/tv\/art\/([\w.]{1,160})\/(banner|icon)\.png$/.exec(p)
    if (am && req.method === 'POST') {
      const png = await readRaw(req, MAX_ART)
      if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) return send(res, 415, { error: 'only PNG pictures' }), true
      art.delete(p)
      art.set(p, png)
      while (art.size > 240) art.delete(art.keys().next().value)
      return send(res, 200, { ok: true }), true
    }
    if (am && req.method === 'GET') {
      const png = art.get(p)
      if (!png) return send(res, 404, { error: 'not found' }), true
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length, 'cache-control': 'private, max-age=600', 'x-content-type-options': 'nosniff' })
      return res.end(png), true
    }

    if (p === '/api/tv/state' && req.method === 'POST') {
      let body
      try { body = JSON.parse((await readRaw(req, 256 * 1024)).toString('utf8') || '{}') } catch { return send(res, 400, { error: 'body is not valid JSON' }), true }
      tvState = cleanState(body)
      return send(res, 200, { ok: true }), true
    }

    if (p === '/api/tv/apps' && req.method === 'POST') {
      let body
      try { body = JSON.parse((await readRaw(req, 64 * 1024)).toString('utf8') || '{}') } catch { return send(res, 400, { error: 'body is not valid JSON' }), true }
      if (!Array.isArray(body?.apps)) return send(res, 400, { error: 'apps must be a list of names' }), true
      known.save(cleanApps(body.apps), cleanNames(body.names))
      return send(res, 200, { ok: true }), true
    }

    if (p === '/api/tv/command' && req.method === 'POST') {
      let body
      try { body = JSON.parse((await readRaw(req, 64 * 1024)).toString('utf8') || '{}') } catch { return send(res, 400, { error: 'body is not valid JSON' }), true }
      const n = queue(body)
      if (!n) return send(res, 400, { error: `type must be one of ${[...TYPES].join(', ')}, with the fields it needs` }), true
      return send(res, 200, { ok: true, seq: n, tvs: tvsOnline() }), true
    }

    if ((p === '/api/tv/transcribe' || p === '/api/voice/transcribe') && req.method === 'POST') {
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
      const ext = AUDIO_EXT[type]
      if (!ext) return send(res, 415, { ok: false, error: 'Send audio: wav, webm, ogg, m4a or mp3.' }), true
      let audio
      try { audio = await readRaw(req, MAX_AUDIO) } catch (e) { return send(res, e.tooBig ? 413 : 400, { ok: false, error: e.tooBig ? 'That recording is too long.' : 'bad body' }), true }
      if (audio.length < 1000) return send(res, 400, { ok: false, error: 'That recording is empty.' }), true
      const dir = path.join(os.tmpdir(), 'localhub-tv')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${ext}`)
      fs.writeFileSync(file, audio)
      try {
        const r = await whisper.transcribe(file)
        return send(res, 200, { ok: true, text: r.text, ms: r.ms, model: r.model }), true
      } catch (e) {
        return send(res, e.missing ? 503 : 500, { ok: false, error: e.message }), true
      } finally {
        fs.rm(file, { force: true }, () => {})
      }
    }

    // The TV's voice: a sentence or two at a time, as a WAV, spoken by Kokoro on this computer.
    if (p === '/api/tv/speak' && req.method === 'POST') {
      let raw = ''
      req.setEncoding('utf8')
      for await (const chunk of req) { raw += chunk; if (raw.length > 16_000) return send(res, 413, { error: 'too long' }), true }
      let body
      try { body = JSON.parse(raw || '{}') } catch { return send(res, 400, { error: 'body is not JSON' }), true }
      const text = String(body.text || '').trim()
      if (!text) return send(res, 400, { error: 'nothing to say' }), true
      try {
        const wav = await tts.say(text, String(body.voice || ''), Number(body.speed) || 1)
        res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length, 'cache-control': 'no-store' })
        res.end(wav)
      } catch (e) { send(res, 503, { error: e.message, voice: tts.state() }) }
      return true
    }
    if (p === '/api/tv/voices' && req.method === 'GET') { tts.warm(); return send(res, 200, { state: tts.state(), voices: tts.voices() }), true } // asking warms it up

    if (p === '/api/tv/weather' && req.method === 'GET') {
      try { return send(res, 200, await weather()), true } catch (e) { return send(res, 502, { error: `Weather isn't available: ${e.message}` }), true }
    }

    // "Hey LocalHub": this computer's microphone, listening for the TV.
    if (p === '/api/tv/listen' && req.method === 'GET') return send(res, 200, listener.status()), true
    if (p === '/api/tv/listen/now' && req.method === 'POST') return send(res, 200, { ok: listener.now(), ...listener.status() }), true
    if (p === '/api/tv/listen' && req.method === 'POST') {
      let body
      try { body = JSON.parse((await readRaw(req, 4096)).toString('utf8') || '{}') } catch { return send(res, 400, { error: 'body is not valid JSON' }), true }
      if (typeof body.on !== 'boolean') return send(res, 400, { error: 'on must be true or false' }), true
      listener.set(body.on)
      return send(res, 200, listener.status()), true
    }

    // Settings › Alexa: the skill's id (it isn't a secret: Amazon's signature is what's checked). This computer only.
    if (p === '/api/tv/alexa' && req.method === 'GET') return send(res, 200, { skillId: tvConfig().alexa?.skillId || '', port: Number(tvConfig().alexa?.port) || 3109, on: !!alexa.listening(), heard: alexa.heard() }), true
    if (p === '/api/tv/alexa/model.json' && req.method === 'GET') return send(res, 200, fs.readFileSync(path.join(here, 'tv', 'alexa', 'interaction-model.json'), 'utf8'), 'application/json; charset=utf-8'), true
    if (p === '/api/tv/alexa' && req.method === 'POST') {
      if (!isLocal(req)) return send(res, 403, { error: 'Alexa is set up on the computer the hub runs on.' }), true
      let b
      try { b = JSON.parse((await readRaw(req, 4096)).toString('utf8') || '{}') } catch { return send(res, 400, { error: 'body is not valid JSON' }), true }
      const id = String(b.skillId ?? '').trim()
      if (id && !/^amzn1\.ask\.skill\.[0-9a-f-]{36}$/i.test(id)) return send(res, 400, { error: 'A Skill ID starts with amzn1.ask.skill.' }), true
      const tv = { ...hubConfig().tv, alexa: { ...hubConfig().tv?.alexa, skillId: id } }
      saveHubConfig({ tv })
      alexa.stop()
      if (id) { alexa.start(); await new Promise(r => setTimeout(r, 250)) }
      return send(res, 200, { ok: true, on: !!alexa.listening() }), true
    }
    if (p === '/api/tv/status' && req.method === 'GET') {
      const a = tvConfig().alexa || {}
      return send(res, 200, {
        whisper: whisper.state(),
        alexa: { on: !!alexa.listening(), port: a.port || 3109, configured: !!a.skillId },
        tvs: tvsOnline(),
        tv: { on: tvOn(), setUp: tvOn() || !!known.get(), apps: known.get()?.apps || [], names: known.get()?.names || {}, state: tvOn() ? tvState : null },
        listen: listener.status(),
        version: hubVersion(here),
      }), true
    }
    send(res, 404, { error: 'not found' })
    return true
  }

  // The TV uses the hub's own icon and wallpapers, not copies: /tv/hub.svg is icons/hub.svg and
  // /tv/wallpapers/ is wallpapers/. The APK build bundles the same files for when it's offline.
  function serveUi(p, res, send) {
    let rel
    try { rel = decodeURIComponent(p.slice('/tv/'.length)) || 'index.html' } catch { return send(res, 404, { error: 'not found' }) }
    let base = uiDir
    if (rel === 'hub.svg') { base = path.join(here, 'icons'); rel = 'hub.svg' }
    else if (rel.startsWith('wallpapers/')) { base = path.join(here, 'wallpapers'); rel = rel.slice('wallpapers/'.length) }
    const file = path.normalize(path.join(base, rel))
    if (!file.startsWith(base + path.sep) || !MIME[path.extname(file)]) return send(res, 404, { error: 'not found' })
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, { error: 'not found' })
      // The 4K background photos never change under the same name, so the TV keeps them; the code stays no-store.
      const cache = rel.startsWith('photos/') ? 'public, max-age=604800' : 'no-store'
      res.writeHead(200, { 'content-type': MIME[path.extname(file)], 'cache-control': cache, 'content-length': data.length })
      res.end(data)
    })
  }

  // ── Alexa ─────────────────────────────────────────────────────────────────────────────────
  const alexa = createAlexa({ queue, tvsOnline })
  alexa.start()

  // ── "Hey LocalHub" ────────────────────────────────────────────────────────────────────────
  const listener = createListener(here, queue)
  listener.start()

  route.queue = queue
  route.alexa = alexa
  route.whisper = whisper
  route.listener = listener
  route.close = () => { alexa.stop(); listener.stop(); whisper.stop(); stream.close(); for (const w of waiters) w.deliver({ seq, command: null }) }
  return route
}

function noContent(res) {
  if (res.writableEnded) return
  res.writeHead(204, { 'cache-control': 'no-store' })
  res.end()
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = []
    let n = 0
    req.on('data', c => {
      n += c.length
      if (n > limit) { reject(Object.assign(new Error('too big'), { tooBig: true })); req.destroy(); return }
      parts.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(parts)))
    req.on('error', reject)
  })
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export function cleanState(raw) {
  const pct = v => (Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null)
  const sec = v => (Number.isFinite(v) && v >= 0 && v < 1e6 ? Math.round(v * 10) / 10 : null)
  const m = raw?.media && typeof raw.media === 'object' ? raw.media : {}
  const art = typeof m.art === 'string' && m.art.length < 200_000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(m.art) ? m.art : ''
  const inputs = (Array.isArray(raw?.inputs) ? raw.inputs : []).slice(0, 8).map(i => ({ id: str(i?.id, 120), name: str(i?.name, 60), sub: str(i?.sub, 40) })).filter(i => i.name)
  return { inputs, brightness: pct(raw?.brightness), volume: pct(raw?.volume), media: { title: str(m.title, 200), artist: str(m.artist, 200), app: str(m.app, 80), playing: m.playing === true, art, pos: sec(m.pos), dur: sec(m.dur), seek: m.seek === true } }
}

// Names only, as they go into a menu: printable, short, each once, in order.
export function cleanApps(list) {
  const names = list.map(n => str(n, 60).replace(/[\u0000-\u001f\u007f]/g, '').trim()).filter(Boolean)
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).slice(0, 60)
}

// The TV this hub has met and the apps it has, kept so they're known while the TV is off.
// What each app is called, by its package, so a computer watching the TV can say what is open.
export const cleanNames = raw => Object.fromEntries(Object.entries(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}).filter(([k, v]) => /^[A-Za-z][\w.]{1,120}$/.test(k) && typeof v === 'string' && v).slice(0, 300).map(([k, v]) => [k, str(v, 80)]))
function knownTv(here) {
  const file = path.join(here, 'data', 'tv-apps.json')
  let tv
  const get = () => {
    if (tv === undefined) {
      try { const t = JSON.parse(fs.readFileSync(file, 'utf8')); tv = Array.isArray(t?.apps) ? t : null } catch { tv = null }
    }
    return tv
  }
  return {
    get,
    save(apps, names = {}) {
      const next = { apps, names }
      if (get() && JSON.stringify(get()) === JSON.stringify(next)) return
      tv = next
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(tv)) } catch {}
    },
  }
}

// A link the TV may open: an ordinary web page, nothing else (no file:, javascript: or sign-in details).
function webUrl(raw) {
  try {
    const u = new URL(str(raw, 2000))
    return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : null
  } catch { return null }
}

export function cleanCommand(raw) {
  if (!raw || typeof raw !== 'object' || !TYPES.has(raw.type)) return null
  switch (raw.type) {
    case 'launch': { const app = str(raw.app, 80); return app ? { type: 'launch', app } : null }
    case 'input': { const name = str(raw.name || raw.id, 80); return name ? { type: 'input', name } : null }
    case 'mirror': return { type: 'mirror', on: raw.on === true }
    case 'audio': return { type: 'audio', on: raw.on === true }
    case 'key': return KEYS.has(raw.name) ? { type: 'key', name: raw.name } : null
    case 'tap': return [raw.x, raw.y].every(v => Number.isFinite(v) && v >= 0 && v <= 1920) ? { type: 'tap', x: Math.round(raw.x), y: Math.round(raw.y) } : null
    case 'type': return typeof raw.text === 'string' && raw.text.length <= 200 && raw.text ? { type: 'type', text: raw.text.replace(/[\u0000-\u0007\u0009\u000b-\u001f\u007f]/g, '') } : null
    case 'media': if (raw.action === 'seek') return Number.isFinite(raw.value) && raw.value >= 0 && raw.value < 1e6 ? { type: 'media', action: 'seek', value: raw.value } : null
      return ['toggle', 'next', 'prev'].includes(raw.action) ? { type: 'media', action: raw.action } : null
    case 'brightness': case 'volume': { const v = raw.value; return Number.isFinite(v) && v >= 0 && v <= 100 ? { type: raw.type, value: Math.round(v) } : null }
    case 'open': { const url = webUrl(raw.url); return url ? { type: 'open', url } : null }
    case 'say': { const text = str(raw.text, 2000); return text ? { type: 'say', text } : null }
    case 'listen': return LISTEN_STAGES.has(raw.stage) ? { type: 'listen', stage: raw.stage, text: str(raw.text, 1000) } : null
    case 'answer': {
      const text = str(raw.text, 8000)
      return text ? { type: 'answer', text, heard: str(raw.heard, 500), from: str(raw.from, 20) || 'hub', speak: raw.speak !== false } : null
    }
    default: return { type: raw.type }
  }
}

/** "open netflix", "put on the playstation" → a TV command, with no model involved. */
export function quickCommand(text) {
  const t = String(text || '').toLowerCase().replace(/[.,!?]+/g, ' ').replace(/\b(please|thanks|thank you|for me|now)\b/g, ' ').replace(/\s+/g, ' ').trim()
  const open = t.match(/^(?:can you\s+|could you\s+)?(?:open|launch|start|play|put on|go to)\s+(?:the\s+|my\s+)?(.+?)(?:\s+app)?(?:\s+on (?:the )?tv)?$/)
  if (open) return { type: 'launch', app: open[1] }
  const input = t.match(/^(?:switch|change) (?:the tv )?to (?:the\s+)?(.+?)(?:\s+input)?$/)
  if (input) return { type: 'input', name: input[1] }
  if (/^(?:go\s+)?home$/.test(t)) return { type: 'home' }
  if (/screen ?saver/.test(t)) return { type: 'saver' }
  return null
}

// ── Whisper: one warm Python process, started on first use, stopped after 10 idle minutes ──

// Kokoro, kept warm after the first sentence and stopped after 10 minutes of quiet. The last few phrases are kept,
// so "Sorry, that didn't go through" and the like come back at once.
function createTts(here) {
  const script = path.join(here, 'tv', 'tts.py')
  const model = path.join(here, 'data', 'tts', 'kokoro-v1.0.int8.onnx'), voicesFile = path.join(here, 'data', 'tts', 'voices-v1.0.bin')
  const dir = path.join(os.tmpdir(), 'localhub-tts')
  let child = null, state = 'off', fatal = '', buf = '', n = 0, idle = null, voiceList = []
  const jobs = new Map(), waiting = [], cache = new Map()
  function start() {
    if (!fs.existsSync(model) || !fs.existsSync(voicesFile)) { state = 'missing'; fatal = "The voice model isn't in data/tts (see tv/tts.py)"; return }
    const py = (tvConfig().whisper || {}).python || (process.platform === 'win32' ? 'python' : 'python3')
    fs.mkdirSync(dir, { recursive: true })
    state = 'loading'; fatal = ''
    try { child = spawn(py, [script, model, voicesFile], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }) } catch (e) { state = 'missing'; fatal = e.message; return }
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-2000) })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', d => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        let msg; try { msg = JSON.parse(line) } catch { continue }
        if (msg.ready) { state = 'ready'; voiceList = msg.voices || []; waiting.splice(0).forEach(w => w.resolve()) }
        else if (msg.fatal) { fatal = msg.fatal }
        else if (msg.id && jobs.has(msg.id)) {
          const job = jobs.get(msg.id); jobs.delete(msg.id); clearTimeout(job.timer)
          if (msg.error) job.reject(new Error(`Voice: ${msg.error}`))
          else fs.readFile(job.path, (e, b) => { fs.rm(job.path, () => {}); e ? job.reject(e) : job.resolve(b) })
        }
      }
    })
    child.on('error', e => stop(e.code === 'ENOENT' ? "Python isn't installed here" : e.message))
    child.on('exit', () => stop(fatal || stderr.trim().split('\n').pop() || 'The voice stopped'))
  }
  function stop(why) {
    state = fatal || why ? 'missing' : 'off'; fatal = fatal || why || ''
    child = null
    waiting.splice(0).forEach(w => w.reject(new Error(fatal || 'The voice stopped')))
    for (const job of jobs.values()) { clearTimeout(job.timer); job.reject(new Error(fatal || 'The voice stopped')) }
    jobs.clear()
    if (why) setTimeout(() => { if (state === 'missing') state = 'off' }, 60_000) // try again later
  }
  const ready = () => state === 'ready' ? Promise.resolve() : new Promise((resolve, reject) => {
    if (!child && state !== 'loading') start()
    if (state === 'missing') return reject(new Error(fatal || 'No voice here'))
    waiting.push({ resolve, reject })
    setTimeout(() => reject(new Error('The voice is still loading')), 20_000)
  })
  async function say(text, voice, speed) {
    const key = `${voice}|${speed}|${text}`
    if (cache.has(key)) return cache.get(key)
    await ready()
    clearTimeout(idle)
    idle = setTimeout(() => { try { child?.kill() } catch {} }, 10 * 60_000)
    const id = `s${++n}`, file = path.join(dir, `${id}.wav`)
    const wav = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { jobs.delete(id); reject(new Error('The voice took too long')) }, 30_000)
      jobs.set(id, { resolve, reject, timer, path: file })
      child.stdin.write(JSON.stringify({ id, text, voice, speed, path: file }) + '\n')
    })
    cache.set(key, wav)
    if (cache.size > 24) cache.delete(cache.keys().next().value)
    return wav
  }
  return { say, warm: () => { ready().catch(() => {}) }, state: () => (fatal && state !== 'ready' ? `missing: ${fatal}` : state), voices: () => voiceList }
}

// "Hey LocalHub": tv/listen.py hears the phrase on this computer's mic, then the request, and each step goes to the
// TV as a 'listen' command. Off until it's turned on (the TV's Settings); a crash is retried after a while.
function createListener(here, queue) {
  const script = path.join(here, 'tv', 'listen.py')
  const model = path.join(here, 'data', 'listen', 'vosk-model-small-en-us-0.15')
  const file = path.join(here, 'data', 'tv-listen.json')
  let child = null, state = 'off', fatal = '', mic = '', buf = '', retry = null, tries = 0
  let saved = {}
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* never turned on */ }
  const on = () => saved.on === true
  function start() {
    if (!on() || child) return
    if (!fs.existsSync(model)) { state = 'missing'; fatal = "The phrase model isn't in data/listen (see tv/listen.py)"; return }
    const cfg = tvConfig().whisper || {}
    const py = cfg.python || (process.platform === 'win32' ? 'python' : 'python3')
    state = 'loading'; fatal = ''
    try {
      child = spawn(py, [script, model, cfg.model || 'base.en', String(saved.mic || '')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    } catch (e) { state = 'missing'; fatal = e.message; return }
    const me = child
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-2000) })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', d => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        let m; try { m = JSON.parse(line) } catch { continue }
        if (m.ready) { state = 'listening'; mic = m.mic || ''; tries = 0 }
        else if (m.fatal) fatal = m.fatal
        else if (m.wake) queue({ type: 'listen', stage: m.again ? 'again' : 'wake' })
        else if (m.working) queue({ type: 'listen', stage: 'working' })
        else if ('heard' in m) queue({ type: 'listen', stage: m.false ? 'off' : 'heard', text: m.false ? '' : m.heard })
      }
    })
    child.on('error', e => { fatal = e.code === 'ENOENT' ? "Python isn't installed here" : e.message })
    child.on('exit', () => {
      if (child !== me) return
      child = null; buf = ''
      if (!on()) { state = 'off'; return }
      fatal = fatal || stderr.trim().split('\n').pop() || 'Listening stopped'
      state = 'missing'
      console.error('listen:', fatal)
      // Try again: soon after a hiccup, then less often (the mic unplugged, a sleep).
      tries += 1
      clearTimeout(retry)
      retry = setTimeout(() => { fatal = ''; start() }, Math.min(10 * 60_000, 15_000 * tries))
    })
  }
  function stop() {
    clearTimeout(retry)
    const c = child; child = null; buf = ''
    if (c) try { c.kill() } catch { /* gone */ }
    state = 'off'; fatal = ''
  }
  function set(value) {
    saved = { ...saved, on: value }
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(saved, null, 2)) } catch (e) { console.error('listen:', e.message) }
    if (value) { tries = 0; start() } else stop()
  }
  const status = () => ({ on: on(), state, mic, ...(fatal ? { error: fatal } : {}) })
  // The remote's mic button: listen for a request now, without the phrase. False when it isn't listening.
  function now() {
    if (state !== 'listening' || !child?.stdin?.writable) return false
    try { child.stdin.write('now\n'); return true } catch { return false }
  }
  return { start, stop, set, status, now }
}

function createWhisper(here) {
  const script = path.join(here, 'tv', 'whisper.py')
  let child = null
  let state = 'off' // off | loading | ready | missing
  let fatal = ''
  let buf = ''
  let idle = null
  let n = 0
  const jobs = new Map()
  const waitingReady = []

  function start() {
    const cfg = tvConfig().whisper || {}
    const py = cfg.python || (process.platform === 'win32' ? 'python' : 'python3')
    fatal = ''
    state = 'loading'
    try {
      child = spawn(py, [script, cfg.model || 'base.en', cfg.device || 'cpu', cfg.fast === undefined ? 'tiny.en' : cfg.fast || '-'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    } catch (e) {
      return die(`Could not start Python (${py}): ${e.message}`)
    }
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-2000) })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', d => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.ready) { state = 'ready'; waitingReady.splice(0).forEach(w => w.resolve()) }
        else if (msg.fatal) fatal = msg.fatal
        else if (msg.id && jobs.has(msg.id)) {
          const job = jobs.get(msg.id)
          jobs.delete(msg.id)
          clearTimeout(job.timer)
          if (msg.error) job.reject(new Error(`Whisper: ${msg.error}`))
          else job.resolve({ text: String(msg.text || ''), ms: msg.ms, model: msg.model })
        }
      }
    })
    child.on('error', e => die(e.code === 'ENOENT' ? `Python isn't installed or isn't "${py}". Set tv.whisper.python in config/hub.json.` : e.message))
    child.on('exit', () => die(fatal || stderr.trim().split('\n').pop() || 'Whisper stopped'))
  }

  function die(message) {
    const wasLoading = state === 'loading'
    child = null
    state = wasLoading ? 'missing' : 'off'
    const err = Object.assign(new Error(message), { missing: wasLoading })
    waitingReady.splice(0).forEach(w => w.reject(err))
    for (const job of jobs.values()) { clearTimeout(job.timer); job.reject(err) }
    jobs.clear()
  }

  async function ready() {
    if (state === 'ready' && child) return
    if (state !== 'loading') start()
    if (state === 'missing' || !child) throw Object.assign(new Error(fatal || 'Whisper is not available'), { missing: true })
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(Object.assign(new Error('Whisper took too long to load. The first run downloads the model, so try again in a minute.'), { missing: true })), 180e3)
      waitingReady.push({ resolve: () => { clearTimeout(t); resolve() }, reject: e => { clearTimeout(t); reject(e) } })
    })
  }

  async function transcribe(file) {
    await ready()
    clearTimeout(idle)
    idle = setTimeout(stop, 30 * 60e3)
    idle.unref?.()
    const id = `j${++n}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { jobs.delete(id); reject(new Error('Whisper took too long.')) }, 60e3)
      jobs.set(id, { resolve, reject, timer })
      child.stdin.write(JSON.stringify({ id, path: file }) + '\n')
    })
  }

  function stop() {
    clearTimeout(idle)
    if (child) { try { child.kill() } catch {} }
    child = null
    if (state !== 'missing') state = 'off'
  }

  // Starts loading without waiting, and keeps it from going idle for a while: the mic button calls
  // this the moment you press it, so the models load while you're still talking.
  function warm() {
    clearTimeout(idle)
    idle = setTimeout(stop, 30 * 60e3)
    idle.unref?.()
    if (state === 'ready' || state === 'loading') return
    ready().catch(() => {})
  }

  return { transcribe, warm, stop, state: () => (state === 'missing' ? `missing: ${fatal}` : state) }
}

// ── Alexa: signed requests only, on their own loopback port ─────────────────────────────────

const CHAIN_HOST = 's3.amazonaws.com'
const CHAIN_PATH = '/echo.api/'
const chainCache = new Map()
const roots = () => (roots.list ||= tls.rootCertificates.map(p => { try { return new crypto.X509Certificate(p) } catch { return null } }).filter(Boolean))

/** Checks a request the way Amazon requires for a self-hosted skill. Throws on anything off. */
export async function verifyAlexa(headers, raw, skillId, { now = Date.now(), fetchChain = fetchCertChain } = {}) {
  const chainUrl = headers['signaturecertchainurl']
  const signature = headers['signature-256']
  if (!chainUrl || !signature) throw new Error('unsigned request')
  const leaf = await fetchChain(chainUrl, now)
  if (!crypto.verify('sha256', raw, leaf.publicKey, Buffer.from(String(signature), 'base64'))) throw new Error('bad signature')
  const body = JSON.parse(raw.toString('utf8'))
  const at = Date.parse(body?.request?.timestamp)
  if (!Number.isFinite(at) || Math.abs(now - at) > 150e3) throw new Error('stale request')
  const app = body?.context?.System?.application?.applicationId || body?.session?.application?.applicationId
  if (!skillId || app !== skillId) throw new Error('wrong skill')
  return body
}

export function chainUrlOk(urlStr) {
  let u
  try { u = new URL(urlStr) } catch { return false }
  const p = path.posix.normalize(decodeURIComponent(u.pathname))
  return u.protocol === 'https:' && u.hostname.toLowerCase() === CHAIN_HOST && (!u.port || u.port === '443') && p.startsWith(CHAIN_PATH)
}

async function fetchCertChain(urlStr, now) {
  if (!chainUrlOk(urlStr)) throw new Error('bad certificate URL')
  const hit = chainCache.get(urlStr)
  if (hit && hit.until > now) return hit.leaf
  const r = await fetch(urlStr, { signal: AbortSignal.timeout(4000) })
  if (!r.ok) throw new Error('certificate download failed')
  const pems = (await r.text()).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []
  const certs = pems.map(p => new crypto.X509Certificate(p))
  if (!certs.length) throw new Error('no certificate')
  const leaf = certs[0]
  for (const c of certs) {
    if (now < Date.parse(c.validFrom) || now > Date.parse(c.validTo)) throw new Error('certificate out of date')
  }
  if (!leaf.checkHost('echo-api.amazon.com')) throw new Error('certificate is not for echo-api.amazon.com')
  for (let i = 0; i < certs.length - 1; i++) {
    if (!certs[i].checkIssued(certs[i + 1]) || !certs[i].verify(certs[i + 1].publicKey)) throw new Error('broken certificate chain')
  }
  const top = certs[certs.length - 1]
  const trusted = roots().some(root => root.fingerprint256 === top.fingerprint256 || (top.checkIssued(root) && top.verify(root.publicKey)))
  if (!trusted) throw new Error('certificate chain is not trusted')
  chainCache.set(urlStr, { leaf, until: Math.min(Date.parse(leaf.validTo), now + 3600e3) })
  return leaf
}

const speech = (text, end = true, reprompt) => ({
  version: '1.0',
  response: {
    outputSpeech: { type: 'PlainText', text: String(text).slice(0, 7900) },
    ...(reprompt ? { reprompt: { outputSpeech: { type: 'PlainText', text: reprompt } } } : {}),
    shouldEndSession: end,
  },
})

const forSpeech = t => String(t)
  .replace(/```[\s\S]*?```/g, '')
  .replace(/`([^`]*)`/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/https?:\/\/\S+/g, '')
  .replace(/[*_#>|]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

function createAlexa({ queue, tvsOnline, ask = askAgent }) {
  let server = null
  let chat = { id: null, at: 0 }, heardAt = 0

  function start() {
    const cfg = tvConfig().alexa || {}
    if (!cfg.skillId || server) return
    const port = Number(cfg.port) || 3109
    server = http.createServer(async (req, res) => {
      const done = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
        res.end(body ? JSON.stringify(body) : '')
      }
      let p = ''
      try { p = new URL(req.url, 'http://x').pathname } catch {}
      if (req.method !== 'POST' || p !== '/alexa') return done(404)
      let raw
      try { raw = await readRaw(req, 128 * 1024) } catch { return done(413) }
      let body
      try {
        body = await verifyAlexa(req.headers, raw, tvConfig().alexa?.skillId)
      } catch (e) {
        console.error('alexa: refused,', e.message)
        return done(400)
      }
      try {
        heardAt = Date.now()
        done(200, await handle(body))
      } catch (e) {
        console.error('alexa:', e.message)
        done(200, speech('LocalHub hit a problem. Try again in a moment.'))
      }
    })
    server.on('error', e => { console.error(`alexa listener on 127.0.0.1:${port}:`, e.message); server = null })
    server.listen(port, '127.0.0.1')
  }

  function stop() {
    if (server) server.close()
    server = null
  }

  async function handle(body) {
    const r = body?.request || {}
    if (r.type === 'LaunchRequest') return speech('LocalHub is listening. Ask me anything, or tell me what to open.', false, 'What would you like?')
    if (r.type === 'SessionEndedRequest') return { version: '1.0', response: {} }
    if (r.type !== 'IntentRequest') return speech('Okay.')
    const intent = r.intent?.name || ''
    const slot = name => String(r.intent?.slots?.[name]?.value || '').trim()

    if (intent === 'AMAZON.StopIntent' || intent === 'AMAZON.CancelIntent' || intent === 'AMAZON.NavigateHomeIntent') return speech('Okay.')
    if (intent === 'AMAZON.HelpIntent') return speech('You can say: open Netflix, switch to the PlayStation, or ask me anything, like what is on my calendar today.', false, 'What would you like?')
    if (intent === 'AMAZON.FallbackIntent') return speech("I didn't catch that. Try: ask local hub to open YouTube.", false, 'What would you like?')

    if (intent === 'OpenAppIntent') return toTv({ type: 'launch', app: slot('app') }, `Opening ${slot('app')}.`)
    if (intent === 'SwitchInputIntent') return toTv({ type: 'input', name: slot('input') }, `Switching to ${slot('input')}.`)
    if (intent === 'GoHomeIntent') return toTv({ type: 'home' }, 'Done.')

    if (intent === 'AskIntent') {
      const text = slot('query')
      if (!text) return speech('What would you like to know?', false, 'Ask me anything.')
      const quick = quickCommand(text)
      if (quick) return toTv(quick, quick.type === 'launch' ? `Opening ${quick.app}.` : 'Done.')
      return answer(text)
    }
    return speech("I can't do that one yet.")
  }

  function toTv(command, said) {
    if (!queue(command)) return speech("I didn't catch what to open.")
    if (!tvsOnline()) return speech("Your TV isn't showing LocalHub right now. Open LocalHub on the TV and try again.")
    return speech(said)
  }

  // Alexa waits about 8 seconds. Short answers are spoken; a long one goes to the TV instead.
  async function answer(text) {
    if (Date.now() - chat.at > 10 * 60e3) chat = { id: null, at: 0 }
    const run = ask(text, chat.id).then(r => {
      if (r.sessionId) chat = { id: r.sessionId, at: Date.now() }
      return r
    })
    const quick = await Promise.race([run, new Promise(resolve => setTimeout(() => resolve(null), 6500))])
    if (quick && quick.text) {
      const spoken = forSpeech(quick.text)
      if (spoken.length <= 900) return speech(spoken)
      queue({ type: 'answer', text: quick.text, heard: text, from: 'alexa', speak: false })
      return speech(`${spoken.slice(0, 600).replace(/\s\S*$/, '')}… The rest is on your TV.`)
    }
    if (quick && quick.error) return speech(`LocalHub couldn't answer: ${forSpeech(quick.error).slice(0, 200)}`)
    run.then(r => {
      if (r.text) queue({ type: 'answer', text: r.text, heard: text, from: 'alexa' })
    }).catch(() => {})
    return speech(tvsOnline() ? "I'm on it. The answer will be on your TV in a moment." : "I'm on it. The answer will be in LocalHub's chat on your laptop.")
  }

  return { start, stop, handle, listening: () => !!server, heard: () => heardAt }
}

/** Runs one message through LocalHub's own agent, the same one the dashboard's chat uses. */
function askAgent(text, sessionId) {
  return new Promise(resolve => {
    const body = JSON.stringify({ text, tab: 'tv', tabTitle: 'TV (Alexa)', ...(sessionId ? { sessionId } : {}) })
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/api/chat/send', method: 'POST',
      headers: { 'x-hub': '1', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, res => {
      let buf = ''
      let out = ''
      let sid = sessionId
      let error = ''
      res.setEncoding('utf8')
      res.on('data', d => {
        buf += d
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i)
          buf = buf.slice(i + 1)
          let ev
          try { ev = JSON.parse(line) } catch { continue }
          if (ev.type === 'session') sid = ev.sessionId
          else if (ev.type === 'delta' && ev.text) out += ev.text
          else if (ev.type === 'error') error = ev.message
          else if (!ev.type && ev.error) error = ev.error
        }
      })
      res.on('end', () => resolve({ text: out.trim(), sessionId: sid, error }))
    })
    req.on('error', e => resolve({ text: '', error: e.message }))
    req.end(body)
  })
}

export { createAlexa as _createAlexa }
