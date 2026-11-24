// AI tab back end: your Claude accounts and the tokens Claude Code logged in its session logs
// (this computer and your server), and optional OpenRouter / DeepSeek balances.
// The hub never reads Claude Code's sign-in tokens and never calls Anthropic itself: plan limits
// are on claude.ai (USAGE_PAGE). The chat runs your own `claude` with your own sign-in.
// Tokens and keys stay in this process: page responses carry only numbers, labels, emails
// and timestamps. Nothing here throws at import; timers are unref'd.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { configPath } from './config.mjs'
import { IS_WIN } from './platform.mjs'

const MIN = 60e3
const DAY = 864e5
const SAMPLE_EVERY = 5 * MIN
const KEEP_DAYS = 35 // token buckets kept; the page shows 30
const FILE_CUTOFF = 31 * DAY // session files untouched for longer hold nothing we show
const SCAN_BUDGET = 12e3
const CHUNK = 4 << 20
const NEEDLE = Buffer.from('"usage":{')
const HOME = os.homedir()
const DEFAULT_DIR = path.resolve(HOME, '.claude')
export const USAGE_PAGE = 'https://claude.ai/settings/usage'

// Runs on the server over `ssh <host> python3 -`. Same incremental scan as the laptop one, with
// its own cache in /root/.hub-cache; prints compact JSON. Read-only outside that folder.
const SERVER_PY = String.raw`
import os, json, time, zlib
CACHE_DIR = '/root/.hub-cache'
CACHE = CACHE_DIR + '/ai-tokens.json'
HOMES = ['/root', '/home/claude']
BUDGET, KEEP, FILE_CUTOFF, CHUNK = 12.0, 35 * 86400, 31 * 86400, 4 << 20
NEEDLE = b'"usage":{'
t0 = now = time.time()
keep_from = time.strftime('%Y-%m-%dT%H', time.gmtime(now - KEEP))
try:
    cache = json.load(open(CACHE))
except Exception:
    cache = {}
files = cache.get('files', {})
seen = {d: set(s.split(',')) if s else set() for d, s in cache.get('seen', {}).items()}
homes, todo, present = [], [], set()
for home in HOMES:
    root = home + '/.claude/projects'
    if not os.path.isdir(root):
        continue
    email = ''
    try:
        email = (json.load(open(home + '/.claude.json')).get('oauthAccount') or {}).get('emailAddress') or ''
    except Exception:
        pass
    homes.append({'home': home, 'email': email})
    for dp, dn, fn in os.walk(root):
        for f in fn:
            if not f.endswith('.jsonl'):
                continue
            p = os.path.join(dp, f)
            try:
                s = os.stat(p)
            except OSError:
                continue
            present.add(p)
            e = files.get(p)
            if e is None:
                if s.st_mtime < now - FILE_CUTOFF:
                    files[p] = {'size': s.st_size, 'mtime': s.st_mtime, 'offset': s.st_size, 'home': home}
                    continue
                e = files[p] = {'size': 0, 'mtime': 0, 'offset': 0, 'home': home, 'b': {}}
            if s.st_size < e['offset']:
                e.update(offset=0, b={})
            e['size'], e['mtime'] = s.st_size, s.st_mtime
            if s.st_size > e['offset']:
                e.setdefault('b', {})
                todo.append(p)
todo.sort(key=lambda p: -files[p]['mtime'])

def lines(buf, e):
    i = 0
    while True:
        hit = buf.find(NEEDLE, i)
        if hit < 0:
            return
        ls = buf.rfind(b'\n', 0, hit) + 1
        le = buf.find(b'\n', hit)
        if le < 0:
            le = len(buf)
        i = le + 1
        try:
            j = json.loads(buf[ls:le])
        except Exception:
            continue
        if not isinstance(j, dict) or j.get('type') != 'assistant':
            continue
        m = j.get('message') or {}
        u = m.get('usage')
        model, ts = m.get('model'), j.get('timestamp')
        if not u or not model or model == '<synthetic>' or not isinstance(ts, str) or ts[:13] < keep_from:
            continue
        mid = m.get('id')
        if mid:
            h = format(zlib.crc32((mid + ':' + str(j.get('requestId') or '')).encode()), 'x')
            day = seen.setdefault(ts[:10], set())
            if h in day:
                continue
            day.add(h)
        v = e['b'].setdefault(ts[:13] + '|' + model, [0, 0, 0, 0, 0])
        v[0] += u.get('input_tokens') or 0
        v[1] += u.get('output_tokens') or 0
        v[2] += u.get('cache_creation_input_tokens') or 0
        v[3] += u.get('cache_read_input_tokens') or 0
        v[4] += 1
        if not e.get('cwd') and j.get('cwd'):
            e['cwd'] = j['cwd']
        e['last'] = max(e.get('last') or '', ts)

pending = 0
for p in todo:
    e = files[p]
    if time.time() - t0 > BUDGET:
        pending += e['size'] - e['offset']
        continue
    try:
        with open(p, 'rb') as fh:
            fh.seek(e['offset'])
            carry = b''
            while time.time() - t0 < BUDGET:
                chunk = fh.read(CHUNK)
                if not chunk:
                    break
                data = carry + chunk
                nl = data.rfind(b'\n')
                if nl < 0:
                    carry = data
                    continue
                lines(data[:nl + 1], e)
                e['offset'] += nl + 1  # carry starts at offset; offset covers complete lines only
                carry = data[nl + 1:]
    except OSError:
        pass
    if e['offset'] < e['size']:
        pending += e['size'] - e['offset']

for p in list(files):
    e = files[p]
    if 'b' in e:
        e['b'] = {k: v for k, v in e['b'].items() if k[:13] >= keep_from}
    if p not in present and not e.get('b'):
        del files[p]
cut_day = keep_from[:10]
seen = {d: s for d, s in seen.items() if d >= cut_day}
os.makedirs(CACHE_DIR, mode=0o700, exist_ok=True)
tmp = CACHE + '.tmp'
with open(tmp, 'w') as fh:
    json.dump({'files': files, 'seen': {d: ','.join(s) for d, s in seen.items()}}, fh, separators=(',', ':'))
os.replace(tmp, CACHE)

agg, sessions = {}, []
for p, e in files.items():
    b = e.get('b')
    if not b:
        continue
    for k, v in b.items():
        hour, model = k.split('|', 1)
        a = agg.setdefault((hour, model, e['home']), [0, 0, 0, 0, 0])
        for i in range(5):
            a[i] += v[i]
    parts = p.split('/')
    sid = parts[-3] if len(parts) > 3 and parts[-2] == 'subagents' else parts[-1][:-6]
    sessions.append({'home': e['home'], 'sid': sid, 'cwd': e.get('cwd') or '', 'last': e.get('last') or '', 'b': b})
print(json.dumps({'at': int(time.time() * 1000), 'homes': homes, 'pending': pending, 'buckets': [[h, m, home] + v for (h, m, home), v in agg.items()], 'files': sessions}, separators=(',', ':')))
`

const readJsonSync = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const expand = p => path.resolve(String(p || '~/.claude').replace(/^~(?=$|[\\/])/, HOME))
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '')
const scrub = s => String(s ?? '').replace(/sk-[\w-]{6,}|eyJ[\w.-]{10,}|Bearer\s+\S+/g, '[hidden]').slice(0, 300)
const pad = n => String(n).padStart(2, '0')
const localDay = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

// FNV-1a, 32-bit, base 36: cheap per-day dedupe of message ids.
function hash(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

export function modelName(id) {
  const old = /^claude-(\d)(?:-(\d))?-([a-z]+)/.exec(id || '') // claude-3-5-sonnet-20241022
  if (old) return `${cap(old[3])} ${old[1]}${old[2] ? '.' + old[2] : ''}`
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/.exec(id || '')
  if (m) return `${cap(m[1])} ${m[2]}${m[3] ? '.' + m[3] : ''}`
  return id || 'Unknown'
}

// The terminal command that signs a config dir in. The default dir needs no env var.
function loginCommand(configDir, isDefault) {
  if (isDefault) return 'claude auth login'
  const dir = String(configDir).replace(/^~(?=$|[\\/])/, '$HOME')
  return IS_WIN ? `$env:CLAUDE_CONFIG_DIR="${dir.replace(/\//g, '\\')}"; claude auth login` : `CLAUDE_CONFIG_DIR="${dir}" claude auth login`
}

// Tokens one account's Claude Code logged on this computer in the last 5 hours and 7 days, from
// the hourly buckets the log scan keeps (so a window starts on the hour). io = input + output,
// cache = cache writes + reads. These are counts, not plan percentages: Anthropic doesn't publish
// how tokens map to plan limits.
export function localWindows(files, src, now = Date.now()) {
  const H = 36e5
  const from5 = Math.floor(now / H) * H - 4 * H, from7 = Math.floor(now / H) * H - (7 * 24 - 1) * H
  const w = () => ({ io: 0, cache: 0, calls: 0 })
  const out = { fiveHour: w(), sevenDay: w(), lastAt: 0 }
  const add = (o, v) => { o.io += (v[0] || 0) + (v[1] || 0); o.cache += (v[2] || 0) + (v[3] || 0); o.calls += v[4] || 0 }
  for (const e of Object.values(files || {})) {
    if (!e || e.src !== src || !e.b) continue
    let hit = false
    for (const [k, v] of Object.entries(e.b)) {
      const t = Date.parse(k.slice(0, 13) + ':00:00Z')
      if (!(t >= from7) || !Array.isArray(v)) continue
      hit = true
      add(out.sevenDay, v)
      if (t >= from5) add(out.fiveHour, v)
    }
    const last = Date.parse(e.last) || 0
    if (hit && last > out.lastAt) out.lastAt = last
  }
  return out
}

export function create({ run, sshHost, here }) {
  const dataDir = path.join(here, 'data')
  const laptopCacheFile = path.join(dataDir, 'ai-tokens-laptop.json')
  const serverCacheFile = path.join(dataDir, 'ai-tokens-server.json')
  try { fs.mkdirSync(dataDir, { recursive: true }) } catch {}

  const secrets = () => readJsonSync(configPath('secrets.json')) || {}
  const providers = { at: 0, list: [] }
  const laptop = { cache: null, scanning: false, at: 0, pending: 0, files: 0, error: '', pass: 0 }
  const server = { data: readJsonSync(serverCacheFile), scanning: false, at: 0, error: '' }
  if (server.data) server.at = server.data.at || 0
  let aggMemo = { key: '', body: null }

  /* ---------- Claude accounts ---------- */

  // Who each config dir is signed in as, from Claude Code's own .claude.json. The sign-in tokens
  // in .credentials.json belong to Claude Code: the hub checks that the file is there and never
  // opens it, renews it or sends it anywhere. Plan limits (the 5-hour and 7-day percentages) are on
  // claude.ai; what the hub shows per account is the tokens Claude Code logged on this computer.
  function accountList() {
    const list = Array.isArray(secrets().claudeAccounts) && secrets().claudeAccounts.length ? secrets().claudeAccounts : [{ label: '', configDir: '~/.claude' }]
    return list.map(a => {
      const dir = expand(a.configDir)
      const isDefault = dir.toLowerCase() === DEFAULT_DIR.toLowerCase()
      // With CLAUDE_CONFIG_DIR set, Claude Code keeps .claude.json inside that folder.
      const cfg = readJsonSync(isDefault ? path.join(HOME, '.claude.json') : path.join(dir, '.claude.json'))
      const email = cfg?.oauthAccount?.emailAddress || ''
      const uuid = cfg?.oauthAccount?.accountUuid || ''
      const signedIn = !!(email || uuid) || fs.existsSync(path.join(dir, '.credentials.json'))
      const label = a.label || email || a.configDir
      return { id: label, label, email, uuid, configDir: a.configDir || '~/.claude', dir, isDefault, signedIn }
    }).map((a, i, all) => {
      // Two config dirs signed in to one account would show the same person twice.
      const same = all.slice(0, i).find(b => (a.uuid && a.uuid === b.uuid) || (!a.uuid && a.email && a.email === b.email))
      const wrong = /@/.test(a.label) && a.email && a.email.toLowerCase() !== a.label.toLowerCase()
      return { ...a, dupOf: same?.label || '', mismatch: same || wrong ? `Signed in as ${a.email}${same ? `, the same account as ${same.label}` : ''}: sign in again${/@/.test(a.label) ? ` with ${a.label}` : ''}` : '' }
    })
  }

  function accountsBody() {
    const files = loadLaptopCache().files
    return accountList().map(a => {
      const status = !a.signedIn ? 'connect' : a.mismatch ? 'mismatch' : 'ok'
      return {
        id: a.id, label: a.label, email: a.email, configDir: a.configDir, isDefault: a.isDefault, status,
        message: status === 'connect' ? 'Not signed in' : status === 'mismatch' ? a.mismatch : '',
        fix: status === 'ok' ? '' : loginCommand(a.configDir, a.isDefault),
        usageUrl: USAGE_PAGE,
        local: localWindows(files, a.id),
        localAt: laptop.at,
      }
    })
  }

  /* ---------- token use: laptop ---------- */

  function loadLaptopCache() {
    if (laptop.cache) return laptop.cache
    const c = readJsonSync(laptopCacheFile)
    laptop.cache = { files: c?.files || {}, seen: new Map(Object.entries(c?.seen || {}).map(([d, s]) => [d, new Set(s ? s.split(',') : [])])) }
    return laptop.cache
  }

  async function saveLaptopCache() {
    const c = laptop.cache
    const body = JSON.stringify({ v: 1, files: c.files, seen: Object.fromEntries([...c.seen].map(([d, s]) => [d, [...s].join(',')])) })
    await fsp.writeFile(laptopCacheFile + '.tmp', body)
    await fsp.rename(laptopCacheFile + '.tmp', laptopCacheFile)
  }

  async function walk(dir, out) {
    let entries
    try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return out }
    for (const e of entries) {
      const f = path.join(dir, e.name)
      if (e.isDirectory()) await walk(f, out)
      else if (e.name.endsWith('.jsonl')) out.push(f)
    }
    return out
  }

  function scanLines(buf, e, seen, keepFrom) {
    let from = 0
    for (;;) {
      const hit = buf.indexOf(NEEDLE, from)
      if (hit < 0) return
      const ls = buf.lastIndexOf(10, hit) + 1
      let le = buf.indexOf(10, hit)
      if (le < 0) le = buf.length
      from = le + 1
      let j
      try { j = JSON.parse(buf.toString('utf8', ls, le)) } catch { continue }
      if (j?.type !== 'assistant') continue
      const m = j.message, u = m?.usage, ts = j.timestamp
      if (!u || !m.model || m.model === '<synthetic>' || typeof ts !== 'string' || ts.slice(0, 13) < keepFrom) continue
      // One API response is logged once per content block, and resumed sessions copy history:
      // count each message id once per day.
      if (m.id) {
        const day = ts.slice(0, 10)
        let s = seen.get(day)
        if (!s) seen.set(day, (s = new Set()))
        const h = hash(`${m.id}:${j.requestId || ''}`)
        if (s.has(h)) continue
        s.add(h)
      }
      const v = (e.b[`${ts.slice(0, 13)}|${m.model}`] ||= [0, 0, 0, 0, 0])
      v[0] += u.input_tokens || 0
      v[1] += u.output_tokens || 0
      v[2] += u.cache_creation_input_tokens || 0
      v[3] += u.cache_read_input_tokens || 0
      v[4]++
      if (!e.cwd && j.cwd) e.cwd = j.cwd
      if (!e.last || ts > e.last) e.last = ts
    }
  }

  async function scanFile(f, e, seen, keepFrom, end) {
    const fh = await fsp.open(f, 'r')
    try {
      const buf = Buffer.allocUnsafe(CHUNK)
      let pos = e.offset
      let carry = null
      while (pos < e.size && Date.now() < end) {
        const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, e.size - pos), pos)
        if (!bytesRead) break
        const start = pos - (carry ? carry.length : 0)
        const data = carry ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead)
        pos += bytesRead
        const nl = data.lastIndexOf(10)
        if (nl < 0) {
          carry = Buffer.from(data)
          if (carry.length > 256 << 20) { e.offset = pos; carry = null } // one absurd line: skip it
          continue
        }
        scanLines(data.subarray(0, nl + 1), e, seen, keepFrom)
        e.offset = start + nl + 1
        carry = nl + 1 < data.length ? Buffer.from(data.subarray(nl + 1)) : null
      }
    } finally {
      await fh.close()
    }
  }

  async function scanLaptop() {
    if (laptop.scanning) return
    laptop.scanning = true
    const end = Date.now() + SCAN_BUDGET
    let more = false
    try {
      const c = loadLaptopCache()
      const now = Date.now()
      const keepFrom = new Date(now - KEEP_DAYS * DAY).toISOString().slice(0, 13)
      const present = new Set()
      const todo = []
      for (const acc of accountList()) {
        const files = await walk(path.join(acc.dir, 'projects'), [])
        for (let i = 0; i < files.length; i += 64) {
          const stats = await Promise.all(files.slice(i, i + 64).map(f => fsp.stat(f).then(s => [f, s], () => null)))
          for (const r of stats) {
            if (!r) continue
            const [f, s] = r
            present.add(f)
            let e = c.files[f]
            if (!e) {
              if (s.mtimeMs < now - FILE_CUTOFF) { c.files[f] = { size: s.size, mtime: s.mtimeMs, offset: s.size, src: acc.id }; continue }
              e = c.files[f] = { size: 0, mtime: 0, offset: 0, src: acc.id, b: {} }
            }
            e.src = acc.id
            // A file that shrank was rewritten: read it again (its ids are already marked seen, so
            // this can undercount that one file; it doesn't happen to append-only session logs).
            if (s.size < e.offset) Object.assign(e, { offset: 0, b: {} })
            e.size = s.size
            e.mtime = s.mtimeMs
            if (s.size > e.offset) { e.b ||= {}; todo.push(f) }
          }
        }
      }
      todo.sort((a, b) => c.files[b].mtime - c.files[a].mtime)
      for (const f of todo) {
        if (Date.now() >= end) break
        try { await scanFile(f, c.files[f], c.seen, keepFrom, end) } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'EBUSY') console.error('ai scan', f, e.message) }
      }
      let pending = 0
      for (const f of todo) pending += Math.max(0, c.files[f].size - c.files[f].offset)
      for (const [f, e] of Object.entries(c.files)) {
        if (e.b) for (const k of Object.keys(e.b)) if (k.slice(0, 13) < keepFrom) delete e.b[k]
        if (!present.has(f) && !(e.b && Object.keys(e.b).length)) delete c.files[f]
      }
      for (const d of c.seen.keys()) if (d < keepFrom.slice(0, 10)) c.seen.delete(d)
      await saveLaptopCache()
      Object.assign(laptop, { at: Date.now(), pending, files: present.size, error: '', pass: laptop.pass + 1 })
      more = pending > 0
    } catch (e) {
      laptop.error = scrub(e.message)
      console.error('ai scan', e)
    } finally {
      laptop.scanning = false
    }
    if (more) setTimeout(scanLaptop, 1500).unref()
  }

  /* ---------- token use: server ---------- */

  async function scanServer() {
    if (server.scanning) return
    server.scanning = true
    try {
      const r = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', sshHost, 'python3', '-'], { input: SERVER_PY, timeout: 45_000 })
      if (!r.ok) throw new Error((r.stderr || 'ssh failed').trim().split('\n').pop())
      const d = JSON.parse(r.stdout)
      server.data = d
      server.at = d.at
      server.error = ''
      fsp.writeFile(serverCacheFile, JSON.stringify(d)).catch(() => {})
      if (d.pending > 0) setTimeout(scanServer, 2000).unref()
    } catch (e) {
      server.error = scrub(e.message)
    } finally {
      server.scanning = false
    }
  }

  /* ---------- token aggregation ---------- */

  function tokensBody() {
    const key = `${laptop.pass}:${server.at}:${localDay(Date.now())}`
    if (aggMemo.key === key) return { ...aggMemo.body, scan: scanStatus() }
    const now = Date.now()
    const days = []
    for (let i = 29; i >= 0; i--) days.push(localDay(now - i * DAY))
    const first = days[0]
    const week = days[23]
    const accs = accountList()
    const sources = new Map() // key -> { key, machine, account, home, sessions, last }
    const rows = new Map() // day|model|src -> [i,o,cw,cr,n]
    const sessions = []
    const addSource = (key, machine, account, home) => sources.get(key) || (sources.set(key, { key, machine, account, home, sessions: 0, last: 0 }), sources.get(key))
    const addFile = (srcKey, sid, cwd, last, b) => {
      const src = sources.get(srcKey)
      let io7 = 0, cache7 = 0, io30 = 0, cache30 = 0
      const models = {}
      for (const [k, v] of Object.entries(b)) {
        const [hour, model] = k.split('|')
        const day = localDay(Date.parse(hour + ':00:00Z'))
        if (day < first) continue
        const r = rows.get(`${day}|${model}|${srcKey}`) || (rows.set(`${day}|${model}|${srcKey}`, [0, 0, 0, 0, 0]), rows.get(`${day}|${model}|${srcKey}`))
        for (let i = 0; i < 5; i++) r[i] += v[i]
        io30 += v[0] + v[1]
        cache30 += v[2] + v[3]
        if (day >= week) { io7 += v[0] + v[1]; cache7 += v[2] + v[3] }
        models[model] = (models[model] || 0) + v[0] + v[1]
      }
      if (!io30 && !cache30) return
      const lastMs = Date.parse(last) || 0
      src.last = Math.max(src.last, lastMs)
      sessions.push({ src: srcKey, sid, cwd, last: lastMs, io7, cache7, io30, cache30, model: Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0] || '' })
    }
    const c = loadLaptopCache()
    for (const a of accs) addSource(`laptop:${a.id}`, 'Laptop', a.email || a.label, a.configDir)
    for (const [f, e] of Object.entries(c.files)) {
      if (!e.b || !sources.has(`laptop:${e.src}`)) continue
      const parts = f.split(/[\\/]/)
      const sid = parts.at(-2) === 'subagents' ? parts.at(-3) : parts.at(-1).replace(/\.jsonl$/, '')
      addFile(`laptop:${e.src}`, sid, e.cwd || '', e.last || '', e.b)
    }
    const sd = server.data
    if (sd) {
      for (const h of sd.homes || []) addSource(`server:${h.home}`, 'Server', h.email || '', h.home)
      for (const f of sd.files || []) if (sources.has(`server:${f.home}`)) addFile(`server:${f.home}`, f.sid, f.cwd, f.last, f.b)
    }
    // A session is its main log plus its subagent logs.
    const bySession = new Map()
    for (const s of sessions) {
      const k = `${s.src}|${s.sid}`
      const t = bySession.get(k)
      if (!t) { bySession.set(k, { ...s }); continue }
      for (const f of ['io7', 'cache7', 'io30', 'cache30']) t[f] += s[f]
      t.last = Math.max(t.last, s.last)
      t.cwd ||= s.cwd
    }
    const merged = [...bySession.values()]
    for (const s of merged) sources.get(s.src).sessions++
    const outRows = [...rows].map(([k, v]) => { const [d, model, src] = k.split('|'); return { d, model, src, i: v[0], o: v[1], cw: v[2], cr: v[3], n: v[4] } })
    const modelTotals = {}
    for (const r of outRows) modelTotals[r.model] = (modelTotals[r.model] || 0) + r.i + r.o + r.cw + r.cr
    const models = Object.keys(modelTotals).sort((a, b) => modelTotals[b] - modelTotals[a]).map(id => ({ id, name: modelName(id) }))
    const body = {
      days,
      models,
      sources: [...sources.values()],
      rows: outRows,
      sessions: merged.sort((a, b) => b.last - a.last).slice(0, 15).map(s => ({ ...s, sid: s.sid.slice(0, 8) })),
    }
    aggMemo = { key, body }
    return { ...body, scan: scanStatus() }
  }

  function scanStatus() {
    return {
      laptop: { at: laptop.at, scanning: laptop.scanning || laptop.pending > 0, pendingBytes: laptop.pending, files: laptop.files, error: laptop.error },
      server: { at: server.at, scanning: server.scanning || (server.data?.pending ?? 0) > 0, pendingBytes: server.data?.pending ?? 0, error: server.error },
    }
  }

  /* ---------- other providers ---------- */

  async function getJson(url, key) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
      if (!r.ok) return { error: `HTTP ${r.status}` }
      return { json: await r.json() }
    } catch (e) {
      return { error: scrub(e.cause?.code || e.name || 'request failed') }
    }
  }

  // The hub may have started before a user variable was set, so read the registry copy too.
  function userEnv(name) {
    if (!IS_WIN) return ''
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      return out.match(/REG_\w+\s+(\S+)\s*$/m)?.[1] || ''
    } catch { return '' }
  }

  async function refreshProviders(force) {
    if (!force && Date.now() - providers.at < 5 * MIN) return
    const s = secrets()
    const list = []
    // secrets.json wins; otherwise a key already set up for opencode or the DeepSeek skill.
    const orKey = s.openrouter?.apiKey || readJsonSync(path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json'))?.openrouter?.key
    if (!orKey) list.push({ id: 'openrouter', name: 'OpenRouter', connected: false, field: 'openrouter.apiKey' })
    else {
      const [c, k] = await Promise.all([getJson('https://openrouter.ai/api/v1/credits', orKey), getJson('https://openrouter.ai/api/v1/key', orKey)])
      const cd = c.json?.data, kd = k.json?.data
      const num = v => (typeof v === 'number' ? v : null)
      list.push({
        id: 'openrouter', name: 'OpenRouter', connected: true, error: c.error && k.error ? c.error : '',
        credits: num(cd?.total_credits), used: num(cd?.total_usage), balance: cd ? num(cd.total_credits) - num(cd.total_usage) : null,
        keyUsage: num(kd?.usage), keyLimit: num(kd?.limit), keyRemaining: num(kd?.limit_remaining), daily: num(kd?.usage_daily), weekly: num(kd?.usage_weekly), monthly: num(kd?.usage_monthly), freeTier: !!kd?.is_free_tier,
      })
    }
    const dsKey = s.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY || userEnv('DEEPSEEK_API_KEY')
    if (!dsKey) list.push({ id: 'deepseek', name: 'DeepSeek', connected: false, field: 'deepseek.apiKey' })
    else {
      const b = await getJson('https://api.deepseek.com/user/balance', dsKey)
      const n = v => (v == null || v === '' ? null : Number(v))
      list.push({
        id: 'deepseek', name: 'DeepSeek', connected: true, error: b.error || '', available: b.json?.is_available ?? null,
        balances: (b.json?.balance_infos || []).map(x => ({ currency: String(x.currency || ''), total: n(x.total_balance), granted: n(x.granted_balance), toppedUp: n(x.topped_up_balance) })),
      })
    }
    providers.list = list
    providers.at = Date.now()
  }

  /* ---------- schedule ---------- */

  const tick = () => { refreshProviders(false).catch(() => {}) }
  const scanTick = () => { scanLaptop(); scanServer() }
  let ready = Promise.race([refreshProviders(false).catch(() => {}), new Promise(r => setTimeout(r, 12_000).unref())])
  setInterval(tick, SAMPLE_EVERY).unref()
  setTimeout(scanTick, 3000).unref()
  setInterval(scanTick, SAMPLE_EVERY).unref()

  const stateBody = () => ({ at: Date.now(), accounts: accountsBody(), tokens: tokensBody(), providers: { at: providers.at, list: providers.list } })

  return async function route(url, req, res, { send }) {
    if (!url.pathname.startsWith('/api/ai/')) return false
    const p = url.pathname.slice('/api/ai/'.length)
    try {
      if (req.method === 'GET' && p === 'state') { await ready; return send(res, 200, stateBody()), true }
      if (req.method === 'GET' && p === 'usage') { await ready; return send(res, 200, { accounts: accountsBody() }), true }
      if (req.method === 'GET' && p === 'tokens') return send(res, 200, tokensBody()), true
      if (req.method === 'GET' && p === 'providers') { await ready; return send(res, 200, { at: providers.at, list: providers.list }), true }
      if (req.method === 'POST' && p === 'refresh') {
        scanTick() // runs in the background; the page sees progress in scan
        await refreshProviders(true)
        return send(res, 200, stateBody()), true
      }
      send(res, 404, { error: 'not found' })
    } catch (e) {
      send(res, 500, { error: scrub(e.message) })
    }
    return true
  }
}
