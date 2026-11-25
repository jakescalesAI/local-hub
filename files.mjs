// File browsing and editing for the hub's file roots: iCloud Drive, the home folder,
// every drive (Windows) or your home and whole disk (Mac, Linux), and /root on your server (over ssh, via server-files.py).
// Deletes never erase: local items go to the Recycle Bin or Trash, server items to /root/.hub-trash.
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat, lstat, mkdir, rename, writeFile, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HERE, hubConfig, addonOn, tabOn } from './config.mjs'
import { FILE_MANAGER, ICLOUD, IS_WIN, PC_NAME, POSIX_ROOTS, TRASH_NAME, listDrives, moveToTrash } from './platform.mjs'

const SKIP = new Set(['node_modules', '.git', '.next', '.turbo', '.venv', '__pycache__', '.cache'])
// Drive roots, the operating system's own folders and each account's home folder never go to the bin.
const SYSTEM_FOLDER = /^([a-z]:(\/(windows|program files( \(x86\))?|programdata|perflogs|recovery|\$recycle\.bin|system volume information|users(\/[^/]+)?))?|\/(applications|bin|boot|dev|etc|home(\/[^/]+)?|lib|library|proc|root|sbin|sys|system|usr|users(\/[^/]+)?|var|volumes)?)\/?$/i

// Windows profile clutter: hidden system folders and legacy junctions.
// Drive roots add the system files and folders Windows also hides.
const HIDDEN = /^(appdata|application data|cookies|local settings|my documents|nethood|printhood|recent|sendto|start menu|templates|ntuser.*|desktop\.ini|thumbs\.db|\$recycle\.bin|\$windows\.~(bt|ws)|system volume information|documents and settings|config\.msi|pagefile\.sys|hiberfil\.sys|swapfile\.sys|dumpstack\.log(\.tmp)?)$/i
const TEXT_LIMIT = 1 << 20
const RESULT_LIMIT = 200

export const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', json: 'application/json', html: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8' }

function fail(message, code = 400) {
  return Object.assign(new Error(message), { code })
}

function checkName(name) {
  name = String(name ?? '').trim()
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|]/.test(name) || name.length > 255) throw fail('That name isn’t allowed')
  return name
}

const shown = name => !name.startsWith('.') && !HIDDEN.test(name)

// Files that hold keys or sign-ins. On every root the hub hides them from lists and search and
// refuses to open, download, rename, move, delete or write them; the real path is checked too,
// so a link or junction can't reach one. server-files.py keeps the same list for /root.
const KEY_NAMES = /^((.+[._-])?secrets?\.(json|ya?ml|toml)|\.credentials\.json|\.claude\.json(\.backup.*)?|auth\.json|\.git-credentials|\.npmrc|\.yarnrc(\.yml)?|_?\.?netrc|\.pypirc|\.pgpass|\.env(\.(?!example$|sample$|template$).+)?|\.envrc|\.dev\.vars|(?!.*[._-](example|sample|template)\.env$).+\.env|(.+[._-])?private\.key|.+\.(pem|p12|pfx|ppk|jks|keystore|kdbx)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.infisical.*|login data( for account)?|cookies|web data|local state|access_tokens\.db|credentials\.db|credentials\.tfrc\.json|credentials(\.toml)?|\.s3cfg|\.boto)$/i
// appdata, .config and Library/Application Support are where programs keep sign-ins, and no list of names
// can cover every program, so those folders are refused whole.
const KEY_DIRS = new Set(['.ssh', '.aws', '.azure', '.gnupg', '.kube', '.infisical', 'gcloud', '.wrangler', '.vercel',
  'appdata', '.config', '.claude-accounts', 'tailscale', '.password-store', 'keyrings', '.oci', '.terraform.d', '.doppler', '.fly', '.netlify', '.supabase'])
// <hub folder>/data covers data/browser/<profile> (the hub browser's Chrome profiles, with your cookies);
// <hub folder>/config holds your keys and settings. hub.json keyDirs and keyPairs add your own.
const HUB_DIR = path.basename(HERE).toLowerCase()
const KEY_PAIRS = [[HUB_DIR, 'data'], [HUB_DIR, 'config'], ['local-hub', 'data'], ['local-hub', 'config'], ['.docker', 'config.json'], ['gh', 'hosts.yml'],
  ['.git', 'config'], ['.claude', 'projects'], ['.claude', 'history.jsonl'], ['library', 'keychains'], ['library', 'application support'], ['library', 'cookies']]
export function holdsKeys(p) {
  // An NTFS stream name (secrets.json::$DATA) opens the same file, so it counts as the name before the colon.
  const segs = String(p || '').split(/[\\/]+/).filter(Boolean).map(s => s.toLowerCase().replace(/:.*$/, ''))
  if (segs.length && KEY_NAMES.test(segs.at(-1))) return true
  const conf = hubConfig()
  if (segs.some(s => KEY_DIRS.has(s) || conf.keyDirs.includes(s))) return true
  return segs.some((s, i) => [...KEY_PAIRS, ...conf.keyPairs].some(([a, b]) => s === a && segs[i + 1] === b))
}
// Places where a file can run as code or change how a tool behaves. Only the assistant is kept out of these.
export const RUN_DIRS = ['.git', '.claude', '.github', '.gitlab', '.husky', '.vscode', '.idea', '.cursor', '.devcontainer', 'startup', 'start menu', 'launchagents', 'launchdaemons', 'autostart', 'systemd', 'cron.d', 'init.d']
export const RUN_EXTS = ['.lnk', '.url', '.scf', '.library-ms']
export const RUN_FILES = ['claude.local.md', 'gemini.md', '.cursorrules', '.windsurfrules', '.clinerules', '.bash_aliases', '.bash_logout', '.inputrc', '.curlrc', '.wgetrc', '.hgrc', 'autoexec.bat', '.gitconfig', '.gitattributes', '.gitmodules', '.bashrc', '.bash_profile', '.bash_login', '.profile', '.zshrc', '.zprofile', '.zshenv', '.zlogin', 'config.fish', '.vimrc', '.tmux.conf', 'profile.ps1', 'microsoft.powershell_profile.ps1', 'microsoft.vscode_powershell_profile.ps1', '.mcp.json', '.pre-commit-config.yaml', 'claude.md', 'agents.md', 'autorun.inf', 'desktop.ini']
export function runsCode(p) {
  const segs = String(p || '').split(/[\\/]+/).filter(Boolean).map(s => s.toLowerCase())
  return RUN_FILES.includes(segs.at(-1)) || RUN_EXTS.some(e => segs.at(-1)?.endsWith(e)) || segs.some(s => RUN_DIRS.includes(s))
}
const KEY_REFUSAL = 'This file holds keys, so the hub won’t open it'
const refuseKeys = p => { if (holdsKeys(p)) throw fail(KEY_REFUSAL, 403) }
// The path as typed and as it really lands (after links and junctions).
async function guard(p) {
  refuseKeys(p)
  refuseKeys(await realpath(p).catch(() => p))
  return p
}

// Paths come from the page; resolve them and refuse anything outside the root.
function localProvider(root, { run, label }) {
  const inside = root.endsWith(path.sep) ? root : root + path.sep
  const full = r => {
    const p = path.resolve(root, r || '.')
    if (p !== root && !p.startsWith(inside)) throw fail(`outside ${label}`)
    return p
  }
  const item = r => {
    const p = full(r)
    if (p === root) throw fail(`${label} itself can’t be changed`)
    return p
  }
  const rel = p => path.relative(root, p).split(path.sep).join('/')
  const absent = async p => {
    if (await lstat(p).then(() => true, () => false)) throw fail(`“${path.basename(p)}” already exists there`, 409)
  }

  // Only stats entries, so iCloud placeholders stay in the cloud until a file is opened.
  async function entry(p, name, withPath) {
    if (holdsKeys(p)) return null
    const [st, l] = await Promise.all([stat(p).catch(() => null), lstat(p).catch(() => null)])
    if (!st) return null
    if (l?.isSymbolicLink() && holdsKeys(await realpath(p).catch(() => p))) return null
    const e = { name, dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs, link: !!l?.isSymbolicLink() }
    if (e.dir) e.count = await readdir(p).then(c => c.filter(shown).length, () => null)
    if (withPath) e.path = rel(p)
    return e
  }

  return {
    async list({ path: r }) {
      const dir = await guard(full(r))
      const names = (await readdir(dir)).filter(shown)
      const entries = (await Promise.all(names.map(n => entry(path.join(dir, n), n)))).filter(Boolean)
      entries.sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name, undefined, { numeric: true }))
      return { root, path: rel(dir), entries }
    },
    // Breadth-first by name; never follows links (Temp junctions point into whole projects).
    async search({ path: r, q }) {
      q = String(q || '').toLowerCase()
      const queue = [await guard(full(r))]
      const hits = []
      const deadline = Date.now() + 4000
      while (queue.length && hits.length < RESULT_LIMIT && Date.now() < deadline) {
        const dir = queue.shift()
        const dirents = await readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const d of dirents) {
          if (holdsKeys(path.join(dir, d.name))) continue
          // Hidden names are never walked into, and match only when the query starts with a dot.
          if (!shown(d.name)) {
            if (q.startsWith('.') && d.name.toLowerCase().includes(q)) hits.push(path.join(dir, d.name))
            continue
          }
          if (d.isDirectory() && !d.isSymbolicLink() && !SKIP.has(d.name)) queue.push(path.join(dir, d.name))
          if (d.name.toLowerCase().includes(q)) hits.push(path.join(dir, d.name))
        }
      }
      const results = (await Promise.all(hits.slice(0, RESULT_LIMIT).map(p => entry(p, path.basename(p), true)))).filter(Boolean)
      return { results, partial: queue.length > 0 }
    },
    async mkdir({ path: r, name }) {
      const p = path.join(await guard(full(r)), checkName(name))
      refuseKeys(p)
      await absent(p)
      await mkdir(p)
      return { path: rel(p) }
    },
    async rename({ path: r, name }) {
      const from = await guard(item(r))
      const to = path.join(path.dirname(from), checkName(name))
      refuseKeys(to)
      if (to === from) return { path: rel(to) }
      // A case-only rename on Windows sees the target as existing; let it through.
      if (to.toLowerCase() !== from.toLowerCase()) await absent(to)
      await rename(from, to)
      return { path: rel(to) }
    },
    async move({ paths, to }) {
      const dest = await guard(full(to))
      if (!(await stat(dest)).isDirectory()) throw fail('Move target isn’t a folder')
      const moved = []
      for (const r of paths || []) {
        const from = await guard(item(r))
        if (dest === from || dest.startsWith(from + path.sep)) throw fail(`Can’t move “${path.basename(from)}” into itself`)
        const target = path.join(dest, path.basename(from))
        if (target === from) continue
        await absent(target)
        await rename(from, target)
        moved.push(rel(target))
      }
      return { moved }
    },
    async delete({ paths }) {
      const items = await Promise.all((paths || []).map(r => guard(item(r))))
      if (!items.length) throw fail('Nothing to delete')
      for (const p of items) if (SYSTEM_FOLDER.test(p.replaceAll(path.sep, '/'))) throw fail(`“${path.basename(p) || p}” is a system folder, so it stays put.`)
      for (const p of items) if ((await lstat(p)).isSymbolicLink()) throw fail(`“${path.basename(p)}” is a link; remove it in ${FILE_MANAGER}`)
      const error = await moveToTrash(run, items)
      if (error) throw fail(error, 500)
      return { deleted: items.map(rel), trash: TRASH_NAME }
    },
    async text({ path: r }) {
      const p = await guard(full(r))
      const st = await stat(p)
      if (st.size > TEXT_LIMIT) throw fail('Too big to edit here (over 1 MB)')
      const buf = await readFile(p)
      if (buf.includes(0)) throw fail('Not a text file')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
      return { text, mtime: st.mtimeMs, size: st.size, bom: buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF }
    },
    async write({ path: r, text, mtime }) {
      const p = await guard(item(r))
      const st = await stat(p).catch(() => null)
      if (mtime && st && Math.abs(st.mtimeMs - mtime) > 2) throw fail('The file changed since you opened it', 409)
      await writeFile(p, String(text ?? ''), 'utf8')
      return { mtime: (await stat(p)).mtimeMs }
    },
    async raw(r, res, download, range) {
      const p = await guard(full(r))
      const st = await stat(p)
      if (!st.isFile()) throw fail('not a file')
      // Part of a file, so a video can be skipped through.
      const m = !download && /^bytes=(\d*)-(\d*)$/.exec(range || '')
      if (m && (m[1] || m[2]) && st.size) {
        const from = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2])), to = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1
        if (from > to) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end() }
        sendHead(res, path.basename(p), download, to - from + 1, { 'content-range': `bytes ${from}-${to}/${st.size}` })
        const s = createReadStream(p, { start: from, end: to })
        s.on('error', () => res.destroy())
        res.on('close', () => s.destroy())
        return void s.pipe(res)
      }
      sendHead(res, path.basename(p), download, st.size, { 'accept-ranges': 'bytes' })
      const s = createReadStream(p)
      s.on('error', () => res.destroy())
      res.on('close', () => s.destroy())
      s.pipe(res)
    },
  }
}

// Every drive, plus iCloud Drive, under one root. Page paths look like "D:/Some/Folder" or
// "iCloud/Photos" (Windows) and "Home/Some/Folder" or "Computer/etc" (Mac, Linux); each is its
// own localProvider. Only Fixed drives and iCloud have a bin, so the hub refuses to delete
// anywhere else (a removable drive would erase for good).

// The drive list can be slow (Get-Volume ~1.3 s, longer while a USB disk spins up), so the last
// answer is kept in data/drives-meta.json and served at once; a rescan runs behind it when it's
// over 15 s old. Deletes always wait for a fresh scan, since the Recycle Bin check depends on it.
const DRIVES_META = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'drives-meta.json')

const KIND_EXT = { image: /\.(png|jpe?g|gif|webp|avif|bmp|heic)$/i, video: /\.(mp4|m4v|webm|mov|mkv|avi)$/i, music: /\.(mp3|m4a|wav|ogg|aac|flac)$/i, doc: /\.(pdf|docx?|xlsx?|pptx?|rtf|odt|ods|odp|pages|numbers|key|txt|md|csv)$/i }
const HOME = os.homedir()
// A path as the page has it: "C:/Users/…" on Windows, "Home/…" elsewhere.
const asPage = p => (IS_WIN ? p.split(path.sep).join('/') : `Home/${path.relative(HOME, p).split(path.sep).join('/')}`)
async function userFolders() {
  const out = []
  for (const id of ['Desktop', 'Downloads', 'Documents', 'Pictures', 'Music', IS_WIN || process.platform !== 'darwin' ? 'Videos' : 'Movies']) {
    // The one with something in it, when there are two.
    const there = []
    for (const base of [HOME, path.join(HOME, 'OneDrive')]) {
      const full = path.join(base, id), names = holdsKeys(full) ? null : await readdir(full).catch(() => null)
      if (names) there.push({ full, n: names.filter(shown).length })
    }
    const it = there.find(x => x.n) || there[0]
    if (it) out.push({ id: id === 'Movies' ? 'Videos' : id, path: asPage(it.full), full: it.full })
  }
  return out
}
// The newest files under those folders that match, breadth first, never through links, for a few seconds at most.
async function walk(folders, want, depth, ms) {
  const end = Date.now() + ms, found = [], queue = folders.map(f => ({ p: f.full, d: 0 })), seen = new Set()
  let looked = 0
  while (queue.length && Date.now() < end && looked < 40_000) {
    const { p, d } = queue.shift()
    if (seen.has(p) || holdsKeys(p)) continue
    seen.add(p)
    const list = await readdir(p, { withFileTypes: true }).catch(() => [])
    looked += list.length
    const files = []
    for (const e of list) {
      if (!shown(e.name) || e.isSymbolicLink()) continue
      const full = path.join(p, e.name)
      if (e.isDirectory()) { if (d < depth && !SKIP.has(e.name)) queue.push({ p: full, d: d + 1 }) }
      else if (e.isFile() && want(e.name) && !/\.(lnk|url|tmp|crdownload|part)$/i.test(e.name) && !holdsKeys(full)) files.push(full)
    }
    await Promise.all(files.slice(0, 3000).map(async full => { const st = await stat(full).catch(() => null); if (st) found.push({ name: path.basename(full), path: asPage(full), dir: false, size: st.size, mtime: st.mtimeMs }) }))
  }
  return found.sort((a, b) => b.mtime - a.mtime)
}

function drivesProvider({ run }) {
  const byId = {}
  let cache = null
  let scanning = null
  async function scan() {
    const list = await listDrives(run).catch(e => { throw fail(e.message, 500) })
    if (addonOn('icloud') && await stat(ICLOUD).then(s => s.isDirectory(), () => false)) list.push({ id: 'iCloud', label: 'iCloud Drive', type: 'iCloud' })
    cache = { at: Date.now(), list }
    writeFile(DRIVES_META, JSON.stringify(cache)).catch(() => {})
    return list
  }
  const rescan = () => (scanning ||= scan().finally(() => { scanning = null }))
  async function drives({ fresh } = {}) {
    if (fresh) return rescan()
    cache ||= await readFile(DRIVES_META, 'utf8').then(JSON.parse, () => null)
    if (!cache?.list?.length) return rescan()
    if (Date.now() - cache.at > 15_000) rescan().catch(() => {})
    return cache.list
  }
  const split = r => {
    const m = /^([A-Za-z]:|iCloud|Home|Computer)(?:\/(.*))?$/.exec(String(r || ''))
    if (!m || (IS_WIN ? /^(Home|Computer)$/ : /:$/).test(m[1])) throw fail('Open a drive first')
    const id = m[1].endsWith(':') ? m[1].toUpperCase() : m[1]
    byId[id] ||= localProvider(id === 'iCloud' ? ICLOUD : POSIX_ROOTS[id] || `${id}\\`, { run, label: id === 'iCloud' ? 'iCloud Drive' : id })
    return { id, p: byId[id], rest: m[2] || '' }
  }
  const pre = (id, r) => (r ? `${id}/${r}` : id)
  const sameDrive = paths => {
    const parts = (paths || []).map(split)
    if (new Set(parts.map(x => x.id)).size > 1) throw fail('Pick items from one drive at a time')
    return parts
  }
  return {
    async list({ path: r }) {
      if (!r) {
        const entries = (await drives()).map(d => ({ name: d.id, label: d.label, dir: true, drive: true, type: d.type, size: d.size, free: d.free }))
        return { root: PC_NAME, path: '', entries }
      }
      const { id, p, rest } = split(r)
      const out = await p.list({ path: rest })
      return { ...out, root: PC_NAME, path: pre(id, out.path) }
    },
    async search({ path: r, q }) {
      const targets = r ? [split(r)] : (await drives()).map(d => split(d.id))
      const outs = await Promise.all(targets.map(t => t.p.search({ path: t.rest, q }).then(o => ({ ...o, id: t.id }))))
      const results = outs.flatMap(o => o.results.map(e => ({ ...e, path: pre(o.id, e.path) }))).slice(0, RESULT_LIMIT)
      return { results, partial: outs.some(o => o.partial) }
    },
    async mkdir({ path: r, name }) { const { id, p, rest } = split(r); return { path: pre(id, (await p.mkdir({ path: rest, name })).path) } },
    async rename({ path: r, name }) { const { id, p, rest } = split(r); return { path: pre(id, (await p.rename({ path: rest, name })).path) } },
    async move({ paths, to }) {
      const dest = split(to)
      const parts = sameDrive(paths)
      if (parts.some(x => x.id !== dest.id)) throw fail(`The hub moves within one drive only; copy between drives in ${FILE_MANAGER}`)
      const out = await dest.p.move({ paths: parts.map(x => x.rest), to: dest.rest })
      return { moved: out.moved.map(m => pre(dest.id, m)) }
    },
    async delete({ paths }) {
      const parts = sameDrive(paths)
      if (!parts.length) throw fail('Nothing to delete')
      const d = (await drives({ fresh: true })).find(x => x.id === parts[0].id)
      if (d?.type !== 'Fixed' && d?.type !== 'iCloud') throw fail(`${parts[0].id} has no bin, so the hub won’t delete there; use ${FILE_MANAGER}`)
      const out = await parts[0].p.delete({ paths: parts.map(x => x.rest) })
      return { ...out, deleted: out.deleted.map(m => pre(parts[0].id, m)) }
    },
    async text({ path: r }) { const { p, rest } = split(r); return p.text({ path: rest }) },
    async write({ path: r, text, mtime }) { const { p, rest } = split(r); return p.write({ path: rest, text, mtime }) },
    async raw(r, res, download, range) { const { p, rest } = split(r); return p.raw(rest, res, download, range) },
    // Your own folders, wherever Windows keeps them (OneDrive takes some over), and the newest files in them.
    async places() {
      const list = await userFolders()
      const places = await Promise.all(list.map(async x => ({ ...x, full: undefined, count: await readdir(x.full).then(c => c.filter(shown).length, () => null) })))
      return { places, recent: (await walk(list, () => true, 3, 1500)).slice(0, 60) }
    },
    // Every picture, video, song or document in them, newest first.
    async kind({ q }) {
      const re = KIND_EXT[q]
      if (!re) throw fail('q is image, video, music or doc')
      return { entries: (await walk(await userFolders(), n => re.test(n), 6, 4000)).slice(0, 400) }
    },
  }
}

function sendHead(res, name, download, size, more) {
  const ext = path.extname(name).slice(1).toLowerCase()
  res.writeHead(more?.['content-range'] ? 206 : 200, {
    ...more,
    'content-type': MIME[ext] || 'application/octet-stream',
    ...(size != null && { 'content-length': size }),
    'content-disposition': `${MIME[ext] && !download ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
  })
}

// server-files.py runs as `python3 -c <loader> <base64 code>`; base64 is shell-safe, and the
// request goes on stdin, so no path or text ever lands in the remote command line.
function serverProvider({ run, host, here }) {
  const code = readFile(path.join(here, 'server-files.py')).then(b => b.toString('base64'))
  const LOADER = '"import base64,sys;exec(base64.b64decode(sys.argv[1]))"'
  const args = async () => ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, 'python3', '-c', LOADER, await code]
  // Your read-only folders and key folders travel with each request; nothing is installed on the server.
  const remoteConf = () => { const c = hubConfig(); return { readOnly: c.server.readOnly, keyDirs: c.keyDirs, keyPairs: c.keyPairs } }
  // Key files are refused here by name and again on the server by real path.
  async function call(op, a) {
    for (const r of [a.path, a.to, ...(a.paths || [])]) if (r) refuseKeys(`/root/${r}`)
    if (a.name) refuseKeys(a.name)
    const r = await run('ssh', await args(), { input: JSON.stringify({ ...a, op, conf: remoteConf() }), timeout: 30_000 })
    if (!r.ok && !r.stdout) throw fail(`Server unreachable: ${r.stderr.trim().split('\n').pop()}`, 502)
    const out = JSON.parse(r.stdout)
    if (out.error) throw fail(out.error, out.code || 400)
    if (out.entries) out.entries = out.entries.filter(e => !holdsKeys(`/root/${out.path}/${e.name}`))
    if (out.results) out.results = out.results.filter(e => !holdsKeys(`/root/${e.path}`))
    return out
  }
  const ops = Object.fromEntries(['list', 'search', 'mkdir', 'rename', 'move', 'delete', 'text', 'write'].map(op => [op, a => call(op, a)]))
  ops.raw = async (r, res, download) => {
    const st = await call('stat', { path: r })
    if (st.dir) throw fail('not a file')
    sendHead(res, st.name, download, st.size)
    const child = spawn('ssh', await args(), { windowsHide: true })
    child.stdin.end(JSON.stringify({ op: 'raw', path: r, conf: remoteConf() }))
    child.stdout.pipe(res)
    res.on('close', () => child.kill())
  }
  return ops
}

export function createFiles({ run, sshHost, here }) {
  const roots = {
    icloud: localProvider(ICLOUD, { run, label: 'iCloud Drive' }),
    laptop: localProvider(os.homedir(), { run, label: 'the home folder' }),
    drives: drivesProvider({ run }),
    server: serverProvider({ run, host: sshHost, here }),
  }
  // Add-on roots answer only when their add-on is on.
  const rootOn = id => id === 'server' ? !!sshHost && tabOn('server') : id === 'icloud' ? addonOn('icloud') : true
  const READS = new Set(['list', 'search', 'text', 'places', 'kind'])
  const WRITES = new Set(['mkdir', 'rename', 'move', 'delete', 'write'])

  // GET /api/files/<root>[/search|/text]?path=&q=, POST /api/files/<root>/<op>,
  // GET /files/<root>/raw?path=[&download]. Returns false when the URL isn't a files route.
  return async function route(url, req, res, { send, readBody }) {
    let m = /^\/api\/files\/(\w+)(?:\/(\w+))?$/.exec(url.pathname)
    if (m && roots[m[1]] && rootOn(m[1])) {
      const p = roots[m[1]]
      const op = m[2] || 'list'
      if (READS.has(op) && typeof p[op] !== 'function') return false
      if (req.method === 'GET' && READS.has(op)) return send(res, 200, await p[op]({ path: url.searchParams.get('path') || '', q: url.searchParams.get('q') || '' })), true
      if (req.method === 'POST' && WRITES.has(op)) return send(res, 200, await p[op](await readBody(req))), true
      return false
    }
    m = /^\/files\/(\w+)\/raw$/.exec(url.pathname)
    if (m && roots[m[1]] && rootOn(m[1]) && req.method === 'GET') return await roots[m[1]].raw(url.searchParams.get('path') || '', res, url.searchParams.has('download'), req.headers.range), true
    return false
  }
}
