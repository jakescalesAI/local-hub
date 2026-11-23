// TV browsers: a browser running on this computer, shown on the TV and driven by its remote (tv/README.md).
//
// Two engines, each its own browser process with its own profile under data/tv-stream/<engine>:
//   chromium  Chromium, headless. A real Chromium build when one is installed (Playwright's, Puppeteer's,
//             Chromium.app, the chromium package), otherwise Chrome's or Edge's program run headless.
//   chrome    Google Chrome: its Widevine plays Netflix, Prime Video, Disney+ and the rest. Headless by
//             default, which streams about twice as many frames as a window; "window": true shows it on the laptop.
// Neither is the agent's browser (browser.mjs, data/browser/*): the agent's tabs, viewport and control stay its own,
// and a Chrome profile can only be open in one process anyway. Sign-ins made on the TV persist in these profiles.
//
// Frames are Chrome's own screencast (CDP Page.startScreencast): JPEG, 1920×1080 on the wire. One HTTP response
// per viewer carries them as binary packets, so no WebSocket and no base64:
//   [u8 kind][u32 length][payload]   kind 1 = JPEG frame, kind 2 = JSON state { url, title, canBack, … }
//
//   GET  /api/tv/stream/status                     -> { engines: { chromium: { available, name, running, … }, chrome: {…} } }
//   POST /api/tv/stream/open   { engine, url?, key?, fresh? } -> { ok, engine, tab, state } start it and show that
//                              app's tab (a tab per app, so it comes back where you left it; fresh starts it over)
//   GET  /api/tv/stream/frames?engine=             -> application/octet-stream, the packets above, until closed
//   POST /api/tv/stream/input  { engine, events }  -> { ok, focus?, target? } move, click, scroll, key, text, snap {x,y,dir}
//   POST /api/tv/stream/nav    { engine, act, url? } -> { ok, left? } back | forward | reload | go | home
//   POST /api/tv/stream/close  { engine }          -> { ok } the TV left: pause media, stop the frames
//
// Settings in config/hub.json, all optional:
//   "tv": { "stream": { "zoom": 1.5, "quality": 40 | 55 | 70 | 80, "home": "https://www.google.com/",
//                       "chrome": { "path": "…", "window": false }, "chromium": { "path": "…" } } }
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hubConfig } from './config.mjs'

export const ENGINES = ['chromium', 'chrome']
const OUT = { w: 1920, h: 1080 } // what the TV gets, in pixels
const QUALITY = [40, 55, 70, 80]
const MIN_FRAME_MS = 15 // at most ~60 fps
const IDLE_MS = 15 * 60e3
const MAX_TABS = 8
const KIND_FRAME = 1
const KIND_STATE = 2

const conf = () => hubConfig().tv?.stream || {}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const err = (code, message) => Object.assign(new Error(message), { code })

/* ---------- finding the browsers: Windows, Mac and Linux ---------- */

const pathDirs = env => [...new Set(['/usr/bin', '/usr/local/bin', '/snap/bin', '/opt/google/chrome', ...String(env.PATH || '').split(path.delimiter).filter(Boolean)])]

/** Where Google Chrome lives on each system, most likely first. Pure, so the tests can check every OS. */
export function chromeCandidates({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const j = platform === 'win32' ? path.win32.join : path.posix.join
  if (platform === 'win32') {
    return [env.PROGRAMFILES || 'C:\\Program Files', env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', env.LOCALAPPDATA || j(home, 'AppData', 'Local')]
      .map(base => j(base, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  }
  if (platform === 'darwin') {
    return ['/Applications', j(home, 'Applications')].map(base => j(base, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'))
  }
  return pathDirs(env).flatMap(d => ['google-chrome-stable', 'google-chrome', 'chrome'].map(n => path.posix.join(d, n)))
}

/** Where a Chromium build lives: installed ones, then the copies Playwright and Puppeteer download. */
export function chromiumCandidates({ platform = process.platform, env = process.env, home = os.homedir(), list = listDir } = {}) {
  const j = platform === 'win32' ? path.win32.join : path.posix.join
  const local = env.LOCALAPPDATA || j(home, 'AppData', 'Local')
  const playwright = platform === 'win32' ? j(local, 'ms-playwright') : platform === 'darwin' ? j(home, 'Library', 'Caches', 'ms-playwright') : j(home, '.cache', 'ms-playwright')
  const pw = list(playwright).filter(d => /^chromium-\d+$/.test(d)).sort(byNumberDesc).flatMap(d => platform === 'win32'
    ? [j(playwright, d, 'chrome-win64', 'chrome.exe'), j(playwright, d, 'chrome-win', 'chrome.exe')]
    : platform === 'darwin'
      ? [j(playwright, d, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'), j(playwright, d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')]
      : [j(playwright, d, 'chrome-linux64', 'chrome'), j(playwright, d, 'chrome-linux', 'chrome')])
  const pup = j(home, '.cache', 'puppeteer', 'chrome')
  const pp = list(pup).sort(byNumberDesc).flatMap(d => platform === 'win32'
    ? [j(pup, d, 'chrome-win64', 'chrome.exe')]
    : platform === 'darwin'
      ? ['chrome-mac-arm64', 'chrome-mac-x64'].map(m => j(pup, d, m, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'))
      : [j(pup, d, 'chrome-linux64', 'chrome')])
  const installed = platform === 'win32'
    ? [j(local, 'Chromium', 'Application', 'chrome.exe'), j(env.PROGRAMFILES || 'C:\\Program Files', 'Chromium', 'Application', 'chrome.exe')]
    : platform === 'darwin'
      ? ['/Applications', j(home, 'Applications')].map(base => j(base, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'))
      : pathDirs(env).flatMap(d => ['chromium', 'chromium-browser'].map(n => path.posix.join(d, n)))
  return [...installed, ...pw, ...pp]
}

/** Microsoft Edge: Chromium too, and on most Windows laptops even without Chrome. */
export function edgeCandidates({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') return [env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', env.PROGRAMFILES || 'C:\\Program Files'].map(b => path.win32.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  if (platform === 'darwin') return ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
  return pathDirs(env).flatMap(d => ['microsoft-edge-stable', 'microsoft-edge'].map(n => path.posix.join(d, n)))
}

function listDir(dir) { try { return fs.readdirSync(dir) } catch { return [] } }
function byNumberDesc(a, b) { return (parseInt(b.replace(/\D+/g, ''), 10) || 0) - (parseInt(a.replace(/\D+/g, ''), 10) || 0) }
const isFile = p => { try { return fs.statSync(p).isFile() } catch { return false } }

/**
 * The program for an engine: { exe, name, real } or null. `real` is false when the Chromium engine borrows
 * Chrome's or Edge's program because no Chromium build is installed: the same engine, run headless.
 */
export function locate(engine, { exists = isFile, env = process.env, platform = process.platform, home = os.homedir(), list = listDir, settings = conf() } = {}) {
  const first = l => l.filter(Boolean).find(exists)
  const opts = { env, platform, home, list }
  if (engine === 'chrome') {
    const exe = first([settings.chrome?.path, env.HUB_TV_CHROME, ...chromeCandidates(opts)])
    return exe ? { exe, name: 'Google Chrome', real: true } : null
  }
  if (engine === 'chromium') {
    const exe = first([settings.chromium?.path, env.HUB_CHROMIUM, ...chromiumCandidates(opts)])
    if (exe) return { exe, name: 'Chromium', real: true }
    const chrome = first(chromeCandidates(opts))
    if (chrome) return { exe: chrome, name: 'Chromium', real: false, via: 'Google Chrome' }
    const edge = first(edgeCandidates(opts))
    return edge ? { exe: edge, name: 'Chromium', real: false, via: 'Microsoft Edge' } : null
  }
  return null
}

/** What a typed address means: a page, or a web search. */
export function normUrl(raw, home = 'https://www.google.com/') {
  const s = String(raw || '').trim()
  if (!s) return home
  if (/^about:blank$/i.test(s)) return s
  if (/^https?:\/\//i.test(s)) return s
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[\w.-]+:\d+/.test(s)) throw err(400, 'Only http and https pages open here.')
  if (!/\s/.test(s) && /^([\w-]+(\.[\w-]+)+|localhost)(:\d+)?([/?#].*)?$/i.test(s)) return (/^(localhost|127\.|10\.|192\.168\.|100\.)/.test(s) ? 'http://' : 'https://') + s
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`
}

/** One packet on the frames stream. */
export function packet(kind, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload))
  const head = Buffer.alloc(5)
  head.writeUInt8(kind, 0)
  head.writeUInt32BE(body.length, 1)
  return Buffer.concat([head, body])
}

/* ---------- a tiny CDP client (Node's built-in WebSocket) ---------- */

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.handlers = new Set(); this.closed = false }
  open() {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(this.url))
      ws.onopen = () => resolve(this)
      ws.onerror = e => reject(new Error(`cdp: ${e.message || 'connect failed'}`))
      ws.onclose = () => {
        this.closed = true
        for (const p of this.pending.values()) p.reject(new Error('the browser closed'))
        this.pending.clear()
        for (const h of this.handlers) h('closed', {}, null)
      }
      ws.onmessage = ev => {
        let m
        try { m = JSON.parse(ev.data) } catch { return }
        if (m.id) {
          const p = this.pending.get(m.id)
          if (!p) return
          this.pending.delete(m.id)
          clearTimeout(p.timer)
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
        } else for (const h of this.handlers) h(m.method, m.params || {}, m.sessionId || null)
      }
    })
  }
  send(method, params = {}, sessionId, ms = 20e3) {
    if (this.closed) return Promise.reject(err(503, 'the browser is not running'))
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => (this.pending.delete(id), reject(new Error(`${method} timed out`))), ms)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
  on(fn) { this.handlers.add(fn) }
  close() { try { this.ws.close() } catch {} }
}

/* ---------- keys the remote and the laptop send ---------- */

const KEYS = {
  Enter: [13, 'Enter', '\r'], Tab: [9, 'Tab'], Escape: [27, 'Escape'], Backspace: [8, 'Backspace'], Delete: [46, 'Delete'],
  ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'], ArrowRight: [39, 'ArrowRight'], ArrowDown: [40, 'ArrowDown'],
  Home: [36, 'Home'], End: [35, 'End'], PageUp: [33, 'PageUp'], PageDown: [34, 'PageDown'], ' ': [32, ' ', ' ', 'Space'],
  MediaPlayPause: [179, 'MediaPlayPause'],
}

// What has the keyboard after a click: so the TV knows to bring up its own.
const FOCUS_JS = `(() => {
  let el = document.activeElement
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement
  while (el && el.tagName === 'IFRAME') { try { el = el.contentDocument.activeElement } catch { break } }
  if (!el || el === document.body) return null
  const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || 'text').toLowerCase()
  const editable = tag === 'textarea' || el.isContentEditable || (tag === 'input' && !['button','submit','checkbox','radio','file','image','reset','range','color'].includes(type))
  if (!editable) return null
  return { tag, type, multiline: tag === 'textarea' || el.isContentEditable, secret: type === 'password',
    value: el.isContentEditable ? '' : String(el.value || '').slice(0, 500),
    label: String(el.getAttribute('aria-label') || el.placeholder || el.title || el.name || '').slice(0, 80) }
})()`
const SELECT_ALL_JS = `(() => { let el = document.activeElement; while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement
  if (el && typeof el.select === 'function') el.select(); else document.execCommand('selectAll') })()`
const PAUSE_JS = `document.querySelectorAll('video,audio').forEach(m => { try { m.pause() } catch {} })`
const SCROLL_JS = `({ y: Math.round(scrollY), max: Math.max(0, document.documentElement.scrollHeight - innerHeight) })`
// Link-to-link moves for the remote: the nearest visible thing you can press (link, button, field, tab, menu item)
// from (x, y) in a direction, as a CSS-pixel rect, or null when there's none on screen that way.
const SNAP_JS = (x, y, dir) => `((x, y, dir) => {
  const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],[onclick],[tabindex]:not([tabindex="-1"]),[contenteditable=""],[contenteditable=true]'
  const W = innerWidth, H = innerHeight, out = []
  const seen = new Set()
  for (const el of document.querySelectorAll(SEL)) {
    if (el.disabled || el.closest('[aria-hidden=true],[inert]')) continue
    // An outer link wins over the button or image inside it.
    const outer = el.parentElement && el.parentElement.closest(SEL)
    if (outer && outer.getBoundingClientRect().width < W * .9) continue
    const r = el.getBoundingClientRect()
    if (r.width < 6 || r.height < 6 || r.bottom <= 0 || r.right <= 0 || r.top >= H || r.left >= W) continue
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), W - 1), cy = Math.min(Math.max(r.top + r.height / 2, 1), H - 1)
    const hit = document.elementFromPoint(cx, cy)
    if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) continue
    const key = Math.round(r.left) + ',' + Math.round(r.top)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ x: r.left, y: r.top, w: r.width, h: r.height, cx, cy })
  }
  let best = null, score = Infinity
  for (const c of out) {
    const dx = c.cx - x, dy = c.cy - y
    // Ahead in the direction, then near in line with it: the usual TV spatial-navigation weighting.
    const main = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy
    const side = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (main <= 4) continue
    const s = main + side * 2.5
    if (s < score) { score = s; best = c }
  }
  return best
})(${Number(x)}, ${Number(y)}, ${JSON.stringify(String(dir))})`

/* ---------- the module ---------- */

export function create({ here, dataDir = path.join(here, 'data', 'tv-stream'), find: locateFn = locate } = {}) {
  const engines = new Map() // id -> instance
  // A browser build Windows refuses to start (Smart App Control blocks unsigned downloads such as Playwright's
  // Chromium, which then fails with "spawn UNKNOWN") is set aside, and Chromium borrows Chrome's program instead.
  const blocked = new Set()
  const find = id => {
    const f = locateFn(id)
    if (!f || !blocked.has(f.exe)) return f
    const chrome = locateFn('chrome')
    return id === 'chromium' && chrome && !blocked.has(chrome.exe) ? { exe: chrome.exe, name: 'Chromium', real: false, via: 'Google Chrome' } : null
  }

  const zoom = () => Math.min(3, Math.max(1, Number(conf().zoom) || 1.5))
  const homeUrl = () => conf().home || 'https://www.google.com/'
  const windowed = id => id === 'chrome' && conf().chrome?.window === true
  // The best JPEG quality the stream climbs back to: the setting, or the top step.
  const topQuality = () => { const i = QUALITY.indexOf(Number(conf().quality)); return i >= 0 ? i : QUALITY.length - 1 }

  function info(id) {
    const found = find(id)
    const inst = engines.get(id)
    return {
      available: !!found,
      name: id === 'chrome' ? 'Google Chrome' : 'Chromium',
      via: found?.via || '',
      drm: id === 'chrome' || (found && !found.real), // Chrome and Edge bring Widevine; a plain Chromium build doesn't
      running: !!inst && !inst.cdp.closed,
      viewers: inst?.viewers.size || 0,
      window: windowed(id),
      message: found ? '' : id === 'chrome'
        ? 'Google Chrome isn’t installed on this computer. Install it from google.com/chrome, or set tv.stream.chrome.path.'
        : 'No Chromium, Chrome or Edge on this computer. Install one, or set tv.stream.chromium.path.',
    }
  }

  /* ----- lifecycle ----- */

  async function devtools(dir) {
    try {
      const [port] = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })
      if (r.ok) return { port: +port, version: await r.json() }
    } catch {}
    return null
  }

  function ensure(id) {
    if (!ENGINES.includes(id)) throw err(400, `engine must be ${ENGINES.join(' or ')}`)
    const live = engines.get(id)
    if (live && !live.cdp.closed) return Promise.resolve(live)
    if (live?.starting) return live.starting
    const starting = start(id).finally(() => { const i = engines.get(id); if (i) delete i.starting })
    engines.set(id, { id, starting, viewers: new Set(), tabs: new Map(), cdp: { closed: true } })
    return starting.catch(e => { engines.delete(id); throw e })
  }

  async function start(id) {
    const found = find(id)
    if (!found) throw err(503, info(id).message)
    const dir = path.join(dataDir, id)
    fs.mkdirSync(dir, { recursive: true })
    let dt = await devtools(dir) // one left running by the last hub is adopted as is
    let proc = null
    if (!dt) {
      try { fs.unlinkSync(path.join(dir, 'DevToolsActivePort')) } catch {}
      const headed = windowed(id)
      const args = [
        `--user-data-dir=${dir}`,
        '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
        '--no-first-run', '--no-default-browser-check', '--hide-crash-restore-bubble',
        // Root can't use the sandbox, and neither can CI runners whose kernel blocks it (LOCALHUB_NO_SANDBOX=1 there).
        ...(process.getuid?.() === 0 || process.env.LOCALHUB_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
        '--disable-blink-features=AutomationControlled',
        '--disable-features=CalculateNativeWinOcclusion,Translate,MediaRouter',
        '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
        '--autoplay-policy=no-user-gesture-required', // a TV shows video; the remote's Enter is the gesture anyway
        // The page is laid out at 1920/zoom CSS pixels, so text reads from the sofa, and drawn at 1920×1080. The
        // screencast sends the screen's pixels: emulating the scale alone would send 1280×720 and the TV would stretch it.
        `--force-device-scale-factor=${zoom()}`,
        `--window-size=${Math.round(OUT.w / zoom())},${Math.round(OUT.h / zoom())}`,
        ...(headed ? [] : ['--headless=new']),
        'about:blank',
      ]
      try {
        proc = spawn(found.exe, args, { stdio: 'ignore', windowsHide: !headed })
      } catch (e) {
        blocked.add(found.exe)
        const next = find(id)
        if (!next || next.exe === found.exe) throw err(500, `${found.name} can't start on this computer (${e.code || e.message})`)
        console.log(`tv stream: ${found.exe} won't start (${e.code || e.message}); ${id} uses ${next.exe}`)
        proc = spawn(next.exe, args, { stdio: 'ignore', windowsHide: !headed })
      }
      proc.on('error', () => {})
      for (let i = 0; i < 80 && !dt; i++) {
        await sleep(150)
        dt = await devtools(dir)
        if (proc.exitCode !== null && !dt) throw err(500, `${found.name} closed as it started. Is this profile open in another window?`)
      }
      if (!dt) { proc.kill(); throw err(500, `${found.name} didn't open its debugging port`) }
    }
    const cdp = await new Cdp(dt.version.webSocketDebuggerUrl).open()
    const browser = String(dt.version.Browser || '')
    const major = /\/(\d+)\./.exec(browser)?.[1] || '140'
    const osPart = process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64'
    const inst = Object.assign(engines.get(id), {
      id, cdp, proc, name: found.name, via: found.via || '', browser,
      ua: `Mozilla/5.0 (${osPart}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
      tabs: new Map(), active: '', session: '', casting: false, q: Math.min(2, topQuality()),
      lastUse: Date.now(), frame: null, lastAck: 0, sent: 0, fps: 0, skips: 0, calm: 0, loading: false, canBack: false, canForward: false,
    })
    cdp.on((method, p, sid) => onEvent(inst, method, p, sid))
    await cdp.send('Target.setDiscoverTargets', { discover: true })
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {})
    inst.meter = setInterval(() => meter(inst), 1000)
    inst.meter.unref?.()
    return inst
  }

  function stop(inst) {
    if (!inst) return
    clearInterval(inst.meter)
    for (const v of inst.viewers) v.res.end()
    inst.viewers.clear()
    if (!inst.cdp.closed) inst.cdp.send('Browser.close', {}, null, 3000).catch(() => {}).finally(() => inst.cdp.close())
    setTimeout(() => { if (inst.proc && inst.proc.exitCode === null) try { inst.proc.kill() } catch {} }, 4000).unref?.()
    engines.delete(inst.id)
  }

  const idle = setInterval(() => {
    for (const inst of engines.values()) {
      if (inst.starting || inst.cdp.closed) continue
      if (inst.viewers.size) inst.lastUse = Date.now()
      else if (Date.now() - inst.lastUse > IDLE_MS) stop(inst)
    }
  }, 30e3)
  idle.unref?.()
  const onExit = () => { for (const inst of engines.values()) if (inst.proc && inst.proc.exitCode === null) try { inst.proc.kill() } catch {} }
  process.once('exit', onExit)

  /* ----- tabs: one per app, so Netflix comes back where you left it ----- */

  async function attach(inst, targetId) {
    const tab = [...inst.tabs.values()].find(t => t.targetId === targetId)
    if (tab?.session) return tab.session
    const { sessionId } = await inst.cdp.send('Target.attachToTarget', { targetId, flatten: true })
    if (tab) tab.session = sessionId
    const z = zoom()
    await Promise.all([
      inst.cdp.send('Page.enable', {}, sessionId),
      inst.cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.round(OUT.w / z), height: Math.round(OUT.h / z), deviceScaleFactor: z, mobile: false }, sessionId),
      inst.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => {}),
      inst.cdp.send('Emulation.setUserAgentOverride', { userAgent: inst.ua }, sessionId).catch(() => {}),
    ])
    return sessionId
  }

  function tabFor(inst, targetId) { for (const [key, t] of inst.tabs) if (t.targetId === targetId) return [key, t]; return [null, null] }

  async function openTab(inst, key, url) {
    let tab = inst.tabs.get(key)
    if (tab) return show(inst, key) // where you left it
    // The blank tab a fresh browser starts with is used first.
    const blank = (await inst.cdp.send('Target.getTargets')).targetInfos.find(t => t.type === 'page' && t.url === 'about:blank' && !tabFor(inst, t.targetId)[0])
    const targetId = blank ? blank.targetId : (await inst.cdp.send('Target.createTarget', { url: 'about:blank' })).targetId
    tab = { key, targetId, session: '', url: '', title: '', opener: '' }
    inst.tabs.set(key, tab)
    await show(inst, key)
    await inst.cdp.send('Page.navigate', { url: url || homeUrl() }, tab.session)
    while (inst.tabs.size > MAX_TABS) {
      const oldest = [...inst.tabs.values()].filter(t => t.key !== inst.active).sort((a, b) => (a.used || 0) - (b.used || 0))[0]
      if (!oldest) break
      inst.tabs.delete(oldest.key)
      inst.cdp.send('Target.closeTarget', { targetId: oldest.targetId }).catch(() => {})
    }
  }

  async function show(inst, key) {
    const tab = inst.tabs.get(key)
    if (!tab) throw err(404, 'no such tab')
    if (inst.casting && inst.session) await inst.cdp.send('Page.stopScreencast', {}, inst.session).catch(() => {})
    inst.casting = false
    inst.active = key
    tab.used = Date.now()
    inst.session = await attach(inst, tab.targetId)
    await inst.cdp.send('Target.activateTarget', { targetId: tab.targetId }).catch(() => {})
    await refreshHistory(inst)
    if (inst.viewers.size) await startCast(inst)
    pushState(inst)
  }

  async function refreshHistory(inst) {
    try {
      const h = await inst.cdp.send('Page.getNavigationHistory', {}, inst.session)
      const tab = inst.tabs.get(inst.active)
      // The tab's first page is about:blank, before the app's own: that one doesn't count as somewhere to go back to.
      const first = h.entries.findIndex(e => e.url !== 'about:blank')
      inst.canBack = h.currentIndex > Math.max(0, first) || !!tab?.opener
      inst.canForward = h.currentIndex < h.entries.length - 1
      inst.history = h
    } catch {}
  }

  function onEvent(inst, method, p, sid) {
    if (method === 'closed') { for (const v of inst.viewers) v.res.end(); inst.viewers.clear(); engines.delete(inst.id); clearInterval(inst.meter); return }
    if (method === 'Page.screencastFrame') return onFrame(inst, p, sid)
    if (method === 'Target.targetCreated' && p.targetInfo.type === 'page' && p.targetInfo.openerId) {
      // A link that opens a new tab opens it here, in front; Back at its first page comes back to the one it came from.
      const [openerKey] = tabFor(inst, p.targetInfo.openerId)
      if (!openerKey) return
      const key = `${openerKey}~${p.targetInfo.targetId.slice(0, 8)}`
      inst.tabs.set(key, { key, targetId: p.targetInfo.targetId, session: '', url: p.targetInfo.url, title: '', opener: openerKey })
      if (openerKey === inst.active) show(inst, key).catch(() => {})
      return
    }
    if (method === 'Target.targetInfoChanged') {
      const [key, tab] = tabFor(inst, p.targetInfo.targetId)
      if (!tab) return
      tab.url = p.targetInfo.url
      tab.title = p.targetInfo.title
      if (key === inst.active) refreshHistory(inst).then(() => pushState(inst))
      return
    }
    if (method === 'Target.targetDestroyed') {
      const [key, tab] = tabFor(inst, p.targetId)
      if (!tab) return
      inst.tabs.delete(key)
      if (key === inst.active) {
        inst.session = ''
        const back = tab.opener && inst.tabs.has(tab.opener) ? tab.opener : [...inst.tabs.keys()].pop()
        if (back) show(inst, back).catch(() => {})
      }
      return
    }
    if (sid && sid === inst.session) {
      if (method === 'Page.frameStartedLoading') { inst.loading = true; return pushState(inst) }
      if (method === 'Page.frameStoppedLoading' || method === 'Page.loadEventFired') { inst.loading = false; return refreshHistory(inst).then(() => pushState(inst)) }
      // A dialog would freeze the page with nobody able to see it. It follows the click that opened it: OK.
      if (method === 'Page.javascriptDialogOpening') return inst.cdp.send('Page.handleJavaScriptDialog', { accept: true, promptText: p.defaultPrompt || '' }, sid).catch(() => {})
    }
  }

  /* ----- frames ----- */

  function state(inst) {
    const tab = inst.tabs.get(inst.active)
    return {
      engine: inst.id, name: inst.name, via: inst.via, tab: inst.active, url: tab?.url || '', title: tab?.title || '',
      canBack: !!inst.canBack, canForward: !!inst.canForward, loading: !!inst.loading,
      width: OUT.w, height: OUT.h, zoom: zoom(), quality: QUALITY[inst.q], fps: inst.fps,
    }
  }
  function pushState(inst) {
    clearTimeout(inst.stateTimer)
    inst.stateTimer = setTimeout(() => { const pk = packet(KIND_STATE, state(inst)); for (const v of inst.viewers) write(v, pk, true) }, 40)
  }

  async function startCast(inst) {
    if (inst.casting || !inst.session) return
    inst.casting = true
    await inst.cdp.send('Page.startScreencast', { format: 'jpeg', quality: QUALITY[inst.q], maxWidth: OUT.w, maxHeight: OUT.h, everyNthFrame: 1 }, inst.session).catch(() => { inst.casting = false })
  }
  async function stopCast(inst) {
    if (!inst.casting) return
    inst.casting = false
    await inst.cdp.send('Page.stopScreencast', {}, inst.session).catch(() => {})
  }

  // Chrome sends the next frame after an ack. It's acked straight away (at most ~60 a second), so the browser
  // draws as fast as it can; a viewer whose connection is still busy with the last frame skips this one.
  function onFrame(inst, p, sid) {
    const ack = () => inst.cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }, sid).catch(() => {})
    if (sid !== inst.session) return ack()
    const wait = Math.max(0, MIN_FRAME_MS - (Date.now() - inst.lastAck))
    inst.lastAck = Date.now() + wait
    wait ? setTimeout(ack, wait) : ack()
    const jpg = Buffer.from(p.data, 'base64')
    inst.frame = jpg
    const pk = packet(KIND_FRAME, jpg)
    for (const v of inst.viewers) {
      if (v.busy) { inst.skips++; continue }
      write(v, pk)
      inst.sent++
    }
  }

  function write(v, pk, always) {
    if (v.res.destroyed || v.res.writableEnded) return
    if (v.busy && !always) return
    if (!v.res.write(pk)) {
      v.busy = true
      v.res.once('drain', () => { v.busy = false })
    }
  }

  // Once a second: the frame rate actually sent, and the JPEG quality nudged to what the network takes.
  function meter(inst) {
    const sent = inst.sent, skips = inst.skips
    inst.sent = 0
    inst.skips = 0
    const n = Math.max(1, inst.viewers.size)
    inst.fps = Math.round(sent / n)
    if (!inst.viewers.size || !inst.casting) return
    let next = inst.q
    if (skips > sent * 0.25 && inst.q > 0) { next--; inst.calm = 0 }
    else if (!skips && ++inst.calm >= 4 && inst.q < topQuality()) { next++; inst.calm = 0 }
    if (next !== inst.q) {
      inst.q = next
      inst.casting = false
      inst.cdp.send('Page.stopScreencast', {}, inst.session).catch(() => {}).then(() => startCast(inst))
    }
    pushState(inst)
  }

  async function frames(id, req, res) {
    const inst = engines.get(id)
    if (!inst || inst.cdp.closed) throw err(409, 'Open the browser first')
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
    res.socket?.setNoDelay(true)
    const v = { res, busy: false }
    inst.viewers.add(v)
    write(v, packet(KIND_STATE, state(inst)), true)
    // A still page sends nothing until it changes, so a new viewer gets a picture now.
    if (inst.session) {
      inst.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }, inst.session)
        .then(r => write(v, packet(KIND_FRAME, Buffer.from(r.data, 'base64')), true)).catch(() => {})
    }
    await startCast(inst)
    req.on('close', () => {
      inst.viewers.delete(v)
      inst.lastUse = Date.now()
      if (!inst.viewers.size) stopCast(inst)
    })
  }

  /* ----- input ----- */

  const css = v => Math.round(Number(v) / zoom())
  const finite = v => Number.isFinite(Number(v))

  async function key(inst, name, modifiers = 0) {
    const k = KEYS[name] || (typeof name === 'string' && [...name].length === 1 ? [name.toUpperCase().charCodeAt(0), name, name] : null)
    if (!k) throw err(400, `unknown key ${name}`)
    const [code, keyName, text, codeName] = k
    const base = { key: keyName, code: codeName || (/^[a-z]$/i.test(name) ? `Key${name.toUpperCase()}` : keyName), windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers }
    await inst.cdp.send('Input.dispatchKeyEvent', { type: text && !modifiers ? 'keyDown' : 'rawKeyDown', ...base, ...(text && !modifiers ? { text, unmodifiedText: text } : {}) }, inst.session)
    await inst.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, inst.session)
  }

  const evalPage = async (inst, expression) => {
    const r = await inst.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, inst.session)
    return r.exceptionDetails ? null : r.result?.value
  }

  async function input(id, events) {
    const inst = engines.get(id)
    if (!inst || inst.cdp.closed || !inst.session) throw err(409, 'Open the browser first')
    if (!Array.isArray(events) || !events.length || events.length > 50) throw err(400, 'events must be a list of 1 to 50')
    inst.lastUse = Date.now()
    const s = inst.session
    const out = { ok: true }
    for (const e of events) {
      if (!e || typeof e !== 'object') throw err(400, 'bad event')
      if (['move', 'click', 'scroll', 'snap'].includes(e.type) && !(finite(e.x) && finite(e.y))) throw err(400, `${e.type} needs x and y`)
      if (e.type === 'move') {
        await inst.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: css(e.x), y: css(e.y) }, s)
      } else if (e.type === 'click') {
        const x = css(e.x), y = css(e.y), clickCount = e.double ? 2 : 1
        await inst.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, s)
        await inst.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount }, s)
        await inst.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount }, s)
        await sleep(90)
        out.focus = await evalPage(inst, FOCUS_JS)
      } else if (e.type === 'scroll') {
        await inst.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: css(e.x), y: css(e.y), deltaX: Number(e.dx) || 0, deltaY: Number(e.dy) || 0 }, s)
        await sleep(60)
        out.scroll = await evalPage(inst, SCROLL_JS)
        out.zoom = zoom()
      } else if (e.type === 'key') {
        await key(inst, String(e.key || ''), Number(e.modifiers) || 0)
      } else if (e.type === 'text') {
        const text = typeof e.text === 'string' ? e.text.slice(0, 4000) : ''
        if (e.replace) await evalPage(inst, SELECT_ALL_JS)
        if (text) await inst.cdp.send('Input.insertText', { text }, s)
        else if (e.replace) await key(inst, 'Delete')
        if (e.submit) await key(inst, 'Enter')
      } else if (e.type === 'snap') {
        if (!['up', 'down', 'left', 'right'].includes(e.dir)) throw err(400, 'snap needs dir: up, down, left or right')
        const z = zoom()
        const r = await evalPage(inst, SNAP_JS(css(e.x), css(e.y), e.dir))
        out.target = r ? { x: Math.round(r.x * z), y: Math.round(r.y * z), w: Math.round(r.w * z), h: Math.round(r.h * z), cx: Math.round(r.cx * z), cy: Math.round(r.cy * z) } : null
        // Hover it too, so menus that open on hover open.
        if (r) await inst.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(r.cx), y: Math.round(r.cy) }, s)
      } else if (e.type === 'focus') {
        out.focus = await evalPage(inst, FOCUS_JS)
      } else if (e.type === 'where') {
        out.scroll = await evalPage(inst, SCROLL_JS)
      } else throw err(400, `unknown event ${e.type}`)
    }
    return out
  }

  async function nav(id, body) {
    const inst = engines.get(id)
    if (!inst || inst.cdp.closed || !inst.session) throw err(409, 'Open the browser first')
    inst.lastUse = Date.now()
    const s = inst.session
    const act = String(body.act || '')
    await refreshHistory(inst)
    if (act === 'back') {
      const h = inst.history
      const tab = inst.tabs.get(inst.active)
      const first = h ? h.entries.findIndex(e => e.url !== 'about:blank') : 0
      if (h && h.currentIndex > Math.max(0, first)) {
        await inst.cdp.send('Page.navigateToHistoryEntry', { entryId: h.entries[h.currentIndex - 1].id }, s)
        return { ok: true }
      }
      // A tab a link opened: closing it goes back to the one it came from.
      if (tab?.opener && inst.tabs.has(tab.opener)) {
        const opener = tab.opener
        inst.tabs.delete(tab.key)
        inst.cdp.send('Target.closeTarget', { targetId: tab.targetId }).catch(() => {})
        await show(inst, opener)
        return { ok: true }
      }
      return { ok: true, left: true } // the app's first page: the TV goes home
    }
    if (act === 'forward') {
      const h = inst.history
      if (h && h.currentIndex < h.entries.length - 1) await inst.cdp.send('Page.navigateToHistoryEntry', { entryId: h.entries[h.currentIndex + 1].id }, s)
      return { ok: true }
    }
    if (act === 'reload') { await inst.cdp.send('Page.reload', {}, s); return { ok: true } }
    if (act === 'go' || act === 'home') {
      const url = act === 'home' ? homeUrl() : normUrl(body.url, homeUrl())
      await inst.cdp.send('Page.navigate', { url }, s)
      return { ok: true, url }
    }
    throw err(400, 'act must be back, forward, reload, go or home')
  }

  async function open(body) {
    const id = String(body.engine || '')
    if (!ENGINES.includes(id)) throw err(400, `engine must be ${ENGINES.join(' or ')}`)
    const keyName = String(body.key || 'home').replace(/[^\w.-]/g, '').slice(0, 40) || 'home'
    const url = body.url ? normUrl(body.url, homeUrl()) : ''
    const inst = await ensure(id)
    inst.lastUse = Date.now()
    if (body.fresh && inst.tabs.has(keyName)) {
      const old = inst.tabs.get(keyName)
      inst.tabs.delete(keyName)
      inst.cdp.send('Target.closeTarget', { targetId: old.targetId }).catch(() => {})
    }
    await openTab(inst, keyName, url || homeUrl())
    return { ok: true, engine: id, tab: keyName, state: state(inst) }
  }

  async function leave(id) {
    const inst = engines.get(id)
    if (!inst || inst.cdp.closed) return { ok: true }
    inst.lastUse = Date.now()
    if (inst.session) await evalPage(inst, PAUSE_JS).catch(() => {})
    return { ok: true }
  }

  /* ----- routes ----- */

  async function body(req) {
    const parts = []
    let n = 0
    for await (const c of req) {
      n += c.length
      if (n > 64 * 1024) throw err(413, 'too big')
      parts.push(c)
    }
    try { return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') } catch { throw err(400, 'body is not valid JSON') }
  }

  async function route(url, req, res, { send }) {
    const p = url.pathname
    if (!p.startsWith('/api/tv/stream/')) return false
    try {
      if (p === '/api/tv/stream/status' && req.method === 'GET') {
        return send(res, 200, { engines: Object.fromEntries(ENGINES.map(id => [id, info(id)])) }), true
      }
      if (p === '/api/tv/stream/frames' && req.method === 'GET') {
        await frames(String(url.searchParams.get('engine') || ''), req, res)
        return true
      }
      if (req.method === 'POST') {
        const b = await body(req)
        if (p === '/api/tv/stream/open') return send(res, 200, await open(b)), true
        if (p === '/api/tv/stream/input') return send(res, 200, await input(String(b.engine || ''), b.events)), true
        if (p === '/api/tv/stream/nav') return send(res, 200, await nav(String(b.engine || ''), b)), true
        if (p === '/api/tv/stream/close') return send(res, 200, await leave(String(b.engine || ''))), true
      }
      send(res, 404, { error: 'not found' })
    } catch (e) {
      if (res.headersSent) { res.destroy(); return true }
      send(res, [400, 404, 409, 413, 503].includes(e.code) ? e.code : 500, { error: e.message })
    }
    return true
  }

  route.close = () => {
    clearInterval(idle)
    process.off('exit', onExit)
    for (const inst of [...engines.values()]) stop(inst)
  }
  route.engines = engines
  return route
}
