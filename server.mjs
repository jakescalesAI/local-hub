// Quartzi Hub: one page for your computer, your files, your chat and browser, and any services you add.
// Laptop listeners come from Get-NetTCPConnection; server listeners from server-probe.py
// over ssh. Server dev and session ports are kept tunnelled to this computer (loopback and
// the Tailscale address), so every URL also works from your tailnet devices.
import { createServer, connect } from 'node:net'
import http from 'node:http'
import os from 'node:os'
import { spawn, execFile } from 'node:child_process'
import { readFile, statfs } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFiles } from './files.mjs'
import { HERE, PORT, configPath, hubConfig, tabOn, addonOn } from './config.mjs'
import { IS_WIN, PYTHON, ROOT_DISK, listeners as listPorts, mutagenPath, tailscalePath } from './platform.mjs'
import { gate, hasPasscode, passcodeNeeded } from './access.mjs'

const SSH_HOST = hubConfig().server.sshAlias
const SERVER_EVERY_MS = 20_000
const LAPTOP_EVERY_MS = 8_000
// Server kinds that stay tunnelled; production opens on demand only.
const AUTO_KINDS = new Set(['dev', 'session'])

const state = {
  laptop: { services: [], health: null, at: 0, error: '' },
  server: { services: [], health: null, at: 0, error: '' },
  syncs: { list: [], at: 0, error: '' },
  tailnet: { ip: '', dns: '', peers: [] },
}
const tunnels = new Map() // remote port -> { local, child, at, auto }
const listeners = new Map() // bind address -> http.Server

function run(file, args, opts = {}) {
  return new Promise(resolve => {
    const child = execFile(file, args, { timeout: 60_000, maxBuffer: 16 << 20, windowsHide: true, ...opts }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr || err?.message || '') }),
    )
    if (opts.input) child.stdin.end(opts.input)
  })
}

function readJson(file) {
  return readFile(configPath(file), 'utf8').then(JSON.parse).catch(() => ({}))
}

async function probe(port, paths = ['/']) {
  for (const p of paths) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${p}`, { signal: AbortSignal.timeout(1500), redirect: 'manual' })
      const body = res.headers.get('content-type')?.includes('html') ? await res.text() : ''
      const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim() ?? ''
      if (res.status !== 404 || p === paths.at(-1)) return { code: res.status, path: p, title }
    } catch {
      return { code: 0, path: paths[0], title: '' }
    }
  }
  return { code: 0, path: paths[0], title: '' }
}

let lastCpu = null
function cpuPercent() {
  const now = os.cpus().reduce(
    (a, c) => ({ idle: a.idle + c.times.idle, total: a.total + Object.values(c.times).reduce((x, y) => x + y, 0) }),
    { idle: 0, total: 0 },
  )
  const prev = lastCpu
  lastCpu = now
  if (!prev || now.total === prev.total) return null
  return 100 * (1 - (now.idle - prev.idle) / (now.total - prev.total))
}

async function laptopHealth() {
  const disk = await statfs(ROOT_DISK).catch(() => null)
  return {
    cores: os.cpus().length,
    cpu: cpuPercent(),
    memTotal: os.totalmem(),
    memAvailable: os.freemem(),
    uptime: os.uptime(),
    diskTotal: disk ? disk.blocks * disk.bsize : 0,
    diskFree: disk ? disk.bavail * disk.bsize : 0,
  }
}

async function refreshLaptop() {
  state.laptop.health = await laptopHealth()
  const found = await listPorts(run)
  if (found.error) return void (state.laptop.error = found.error)
  let rows = found.filter(
    s => s.port >= 1024 && s.port < 30000 && s.port !== PORT,
  )
  const tunneled = new Set([...tunnels.values()].map(t => t.local))
  const probed = await Promise.all(
    rows
      .filter(s => !tunneled.has(s.port))
      .map(async s => {
        const cmd = s.cmd || ''
        const paths = /apps[\\/]workspace|vite/i.test(cmd) ? ['/workspace/_app/', '/'] : ['/']
        return { ...s, cmd: cmd.slice(0, 300), ...(await probe(s.port, paths)) }
      }),
  )
  // Listeners that answer HTTP are web services; the rest are listed as other services.
  // HTTP.sys answers 503 for Windows' own reserved URLs (device discovery); not a web page.
  const isWeb = s => s.code && !(s.process === 'System' && s.code === 503)
  state.laptop.services = probed.map(s => ({ ...s, kind: isWeb(s) ? 'web' : 'other' }))
  state.laptop.at = Date.now()
  state.laptop.error = ''
}

async function refreshServer() {
  if (!SSH_HOST || !tabOn('server')) return
  // The probe learns which units and folders count as production from your config.
  const script = `PRODUCTION = ${JSON.stringify(hubConfig().server.production || {})}\n` + await readFile(path.join(HERE, 'server-probe.py'), 'utf8')
  const r = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', SSH_HOST, 'python3', '-'], { input: script })
  if (!r.ok) return void (state.server.error = (r.stderr || 'ssh failed').trim().slice(0, 300))
  try {
    const data = JSON.parse(r.stdout)
    state.server.services = data.services
    state.server.health = data.health
    state.server.at = Date.now()
    state.server.error = ''
  } catch (e) {
    return void (state.server.error = `bad probe output: ${e.message}`)
  }
  await syncAutoTunnels()
}

async function refreshSyncs() {
  const mutagen = mutagenPath()
  if (!mutagen) return void (state.syncs.error = 'mutagen not found')
  const r = await run(mutagen, ['sync', 'list'])
  if (!r.ok) return void (state.syncs.error = r.stderr.trim().slice(0, 300))
  const list = []
  let cur = null
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^(Name|Status|URL):\s*(.*)$/.exec(line.trim())
    if (!m) continue
    if (m[1] === 'Name') list.push((cur = { name: m[2], status: '', alpha: '', beta: '' }))
    else if (cur && m[1] === 'Status') cur.status = m[2]
    else if (cur && m[1] === 'URL') cur[cur.alpha ? 'beta' : 'alpha'] = m[2]
  }
  state.syncs = { list, at: Date.now(), error: '' }
}

async function refreshTailnet() {
  const tailscale = tailscalePath()
  if (hubConfig().access !== 'tailnet' || !tailscale) return
  const r = await run(tailscale, ['status', '--json'])
  if (!r.ok) return void (state.tailnet = { ip: '', dns: '', peers: [] })
  const j = JSON.parse(r.stdout)
  const self = j.Self || {}
  state.tailnet = {
    ip: (self.TailscaleIPs || []).find(ip => ip.includes('.')) || '',
    dns: (self.DNSName || '').replace(/\.$/, ''),
    peers: Object.values(j.Peer || {}).map(p => ({ name: (p.DNSName || '').split('.')[0], os: p.OS, online: p.Online })),
  }
  await bindListeners()
}

function loop(fn, every) {
  const tick = async () => {
    try {
      await fn()
    } catch (e) {
      console.error(fn.name, e)
    }
    setTimeout(tick, every)
  }
  tick()
}

function portFree(port, host) {
  return new Promise(resolve => {
    const s = createServer()
    s.once('error', () => resolve(false))
    s.listen(port, host, () => s.close(() => resolve(true)))
  })
}

function portOpen(port) {
  return new Promise(resolve => {
    const sock = connect(port, '127.0.0.1')
    sock.once('connect', () => (sock.destroy(), resolve(true)))
    sock.once('error', () => resolve(false))
  })
}

async function openTunnel(remote, auto = false, exact = false) {
  const live = tunnels.get(remote)
  if (live && live.child.exitCode === null && (await portOpen(live.local))) return live
  const ts = state.tailnet.ip
  let local = 0
  for (const candidate of exact ? [remote] : [remote, remote + 10000, remote + 20000]) {
    if (candidate < 65536 && (await portFree(candidate, '127.0.0.1')) && (!ts || (await portFree(candidate, ts)))) {
      local = candidate
      break
    }
  }
  if (!local) {
    // A pinned port held by another forward (say an ssh -L in a terminal) is left alone; the hub
    // takes it over on a later scan once that forward goes away.
    if (exact) return null
    throw new Error(`no free laptop port for ${remote}`)
  }
  // Loopback for this laptop, the Tailscale address for the tailnet; never 0.0.0.0 (public Wi-Fi).
  const forwards = [`127.0.0.1:${local}:127.0.0.1:${remote}`, ...(ts ? [`${ts}:${local}:127.0.0.1:${remote}`] : [])]
  const child = spawn(
    'ssh',
    // A dead link makes ssh exit within ~45 s; the next server scan (every 20 s) opens it again.
    ['-N', '-C', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=10', ...forwards.flatMap(f => ['-L', f]), SSH_HOST],
    { windowsHide: true, stdio: 'ignore' },
  )
  const tunnel = { remote, local, child, at: Date.now(), auto, tailnet: !!ts }
  tunnels.set(remote, tunnel)
  child.on('exit', () => tunnels.get(remote) === tunnel && tunnels.delete(remote))
  for (let i = 0; i < 40; i++) {
    if (await portOpen(local)) return tunnel
    if (child.exitCode !== null) break
    await new Promise(r => setTimeout(r, 250))
  }
  child.kill()
  throw new Error(`tunnel to ${SSH_HOST}:${remote} did not come up`)
}

function closeTunnel(remote) {
  tunnels.get(remote)?.child.kill()
  tunnels.delete(remote)
}

// Keep a tunnel up for every dev and session port, plus the ports pinned in pinned.json
// ({ "ports": [3365] }), which always keep the same laptop port; drop auto tunnels whose port
// went away. Opened one at a time so sshd's MaxStartups never sees a burst.
async function syncAutoTunnels() {
  const pinned = new Set(((await readJson('pinned.json'))?.ports || []).map(Number).filter(p => p > 0 && p < 65536))
  const want = new Set([...state.server.services.filter(s => AUTO_KINDS.has(s.kind)).map(s => s.port), ...pinned])
  for (const [remote, t] of tunnels) if (t.auto && !want.has(remote)) closeTunnel(remote)
  for (const remote of want) {
    const t = tunnels.get(remote)
    // A tunnel made before Tailscale came up is remade so tailnet devices can reach it.
    if (t && state.tailnet.ip && !t.tailnet) closeTunnel(remote)
    await openTunnel(remote, true, pinned.has(remote)).catch(e => console.error(e.message))
  }
}

async function snapshot() {
  const names = await readJson('names.json')
  return {
    hubPort: PORT,
    sshHost: SSH_HOST,
    names,
    laptop: state.laptop,
    server: state.server,
    syncs: state.syncs,
    tailnet: state.tailnet,
    tunnels: [...tunnels.values()].map(t => ({ remote: t.remote, local: t.local, at: t.at, auto: t.auto })),
  }
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(type === 'application/json' ? JSON.stringify(body) : body)
}

async function readBody(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

// The address a redirect should point at: loopback stays loopback; anything else is a
// tailnet device, which gets the Tailscale IP (Vite rejects unknown host names but always
// accepts IP addresses).
function hostFor(req) {
  const host = (req.headers.host || '').replace(/:\d+$/, '')
  return host === 'localhost' || host === '127.0.0.1' ? 'localhost' : state.tailnet.ip || host
}

// Storage numbers come from iCloud for Windows' own cache, so they are as fresh as its last check.
let storageCache = { at: 0, body: null }
async function icloudStorage() {
  if (Date.now() - storageCache.at < 60_000 && storageCache.body) return storageCache.body
  if (!IS_WIN) return { error: 'iCloud storage figures come from iCloud for Windows' }
  const r = await run(PYTHON, [path.join(HERE, 'icloud-storage.py')], { timeout: 15_000 })
  const body = r.ok ? JSON.parse(r.stdout) : { error: r.stderr.trim().split('\n').pop() }
  storageCache = { at: Date.now(), body }
  return body
}

const filesRoute = createFiles({ run, sshHost: SSH_HOST, here: HERE })

// Tab back-ends (ai.mjs, cloud.mjs): each exports create({ run, sshHost, here }) returning
// route(url, req, res, { send, readBody }) -> true when handled. A missing or broken one only
// disables its tab. Keys live in config/secrets.json, which only the hub reads; never send them to
// the page. A service add-on loads when it is turned on; until then its routes don't exist.
const BACKENDS = ['ai', 'cloud', 'calendar', 'stripe', 'hub-settings', 'hub-setup', 'hub-sites', 'home', 'chat', 'browser', 'launcher']
const SERVICES = new Set(['ai', 'cloud', 'calendar', 'stripe'])
const loaded = new Map()
async function tabRoutes() {
  const routes = []
  for (const name of BACKENDS) {
    if (SERVICES.has(name) && !tabOn(name)) continue
    if (!loaded.has(name)) {
      loaded.set(name, null)
      if (existsSync(path.join(HERE, `${name}.mjs`))) {
        try {
          loaded.set(name, (await import(`./${name}.mjs`)).create({ run, sshHost: SSH_HOST, here: HERE, onAccessChange: () => refreshTailnet() }))
        } catch (e) {
          console.error(`${name}.mjs`, e.message)
        }
      }
    }
    if (loaded.get(name)) routes.push(loaded.get(name))
  }
  return routes
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (await gate(req, res, url, send)) return
  // Changes need the page's x-hub header. A request from another site can't add it without a
  // CORS preflight, which the hub never approves, so other tabs can't move or delete files.
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-hub'] !== '1') return send(res, 403, { error: 'missing x-hub header' })
  try {
    if (url.pathname === '/' || url.pathname === '/index.html')
      return send(res, 200, await readFile(path.join(HERE, 'index.html')), 'text/html; charset=utf-8')
    if (url.pathname === '/api/ping') return send(res, 200, { ok: true })
    if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, await snapshot())
    if (url.pathname === '/api/icloud/storage' && req.method === 'GET') return send(res, 200, addonOn('icloud') ? await icloudStorage() : { error: 'iCloud is not turned on' })
    if (await filesRoute(url, req, res, { send, readBody })) return
    for (const route of await tabRoutes()) if (await route(url, req, res, { send, readBody })) return
    const icon = /^\/icons\/(hub\.svg|favicon-32\.png|apple-touch-icon\.png|icon-192\.png|icon-512\.png|manifest\.webmanifest)$/.exec(url.pathname)
    if (icon && req.method === 'GET') return send(res, 200, await readFile(existsSync(configPath(`icons/${icon[1]}`)) ? configPath(`icons/${icon[1]}`) : path.join(HERE, 'icons', icon[1])), icon[1].endsWith('.svg') ? 'image/svg+xml' : icon[1].endsWith('.png') ? 'image/png' : 'application/manifest+json')
    const tab = /^\/tabs\/([a-z]+)\.js$/.exec(url.pathname)
    if (tab && req.method === 'GET') return send(res, 200, await readFile(path.join(HERE, 'tabs', `${tab[1]}.js`)), 'text/javascript; charset=utf-8')
    if (url.pathname === '/api/refresh' && req.method === 'POST') {
      await Promise.all([refreshLaptop(), refreshServer(), refreshSyncs()])
      return send(res, 200, await snapshot())
    }
    // /go/<port>?where=server|laptop&p=<path>: open (tunnelling first if needed) as a plain link.
    const go = /^\/go\/(\d+)$/.exec(url.pathname)
    if (go && req.method === 'GET') {
      const port = Number(go[1])
      const p = url.searchParams.get('p') || '/'
      let local = port
      if (url.searchParams.get('where') !== 'laptop') {
        if (!state.server.services.some(s => s.port === port)) return send(res, 404, `No server service on ${port}`, 'text/plain; charset=utf-8')
        local = (await openTunnel(port)).local
      }
      res.writeHead(302, { location: `http://${hostFor(req)}:${local}${p}`, 'cache-control': 'no-store' })
      return res.end()
    }
    if (url.pathname === '/api/tunnel' && req.method === 'POST') {
      const { port } = await readBody(req)
      if (!state.server.services.some(s => s.port === port)) return send(res, 400, { error: `no server service on ${port}` })
      const t = await openTunnel(port)
      return send(res, 200, { remote: t.remote, local: t.local })
    }
    if (url.pathname === '/api/tunnel' && req.method === 'DELETE') {
      closeTunnel(Number(url.searchParams.get('port')))
      return send(res, 200, { ok: true })
    }
    send(res, 404, { error: 'not found' })
  } catch (e) {
    if (res.headersSent) return res.destroy()
    send(res, [400, 403, 404, 409, 500, 502].includes(e.code) ? e.code : e.code === 'ENOENT' ? 404 : ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(e.code) ? 409 : 500, { error: e.message })
  }
}

// The hub listens on loopback and, once Tailscale reports an address, on that address too.
// A `local-only` file next to this one keeps it on loopback. A new hub stays on loopback until
// you choose "tailnet" (hub.json access).
const LOCAL_ONLY = path.join(HERE, 'local-only')
async function bindListeners() {
  const localOnly = existsSync(LOCAL_ONLY)
  const tailnet = localOnly || hubConfig().access !== 'tailnet' ? '' : state.tailnet.ip
  // More addresses only with a passcode in front of them.
  const more = localOnly || (passcodeNeeded() && !hasPasscode()) ? [] : hubConfig().listen
  for (const host of ['127.0.0.1', tailnet, ...more].filter(Boolean)) {
    if (listeners.has(host)) continue
    const server = http.createServer(handle)
    listeners.set(host, server)
    await new Promise(resolve => {
      server.once('error', e => (console.error(`listen ${host}:${PORT}`, e.message), listeners.delete(host), resolve()))
      server.listen(PORT, host, () => (console.log(`${hubConfig().name} on http://${host}:${PORT}`), resolve()))
    })
  }
}

for (const sig of ['SIGINT', 'SIGTERM', 'exit']) process.on(sig, () => (tunnels.forEach(t => t.child.kill()), sig !== 'exit' && process.exit(0)))

const shipped = { secrets: 'never', actions: 'ask', socialPosts: 'never' }
for (const [rule, value] of Object.entries(hubConfig().assistant.approvals)) {
  if (shipped[rule] !== value) console.warn(`WARNING: assistant.approvals.${rule} is "${value}" (shipped default "${shipped[rule]}"). The assistant follows your setting.`)
}

await bindListeners()
await refreshTailnet().catch(e => console.error('tailnet', e.message))
loop(refreshTailnet, 60_000)
loop(() => tabOn('laptop') ? refreshLaptop() : undefined, LAPTOP_EVERY_MS)
loop(refreshServer, SERVER_EVERY_MS)
loop(() => tabOn('laptop') ? refreshSyncs() : undefined, 15_000)
