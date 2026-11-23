// TV screensaver photos: what LocalHub TV's screensaver shows (tv/ui/app.js), from the source picked
// in the hub setting tv.saver (hub-settings.mjs, "Settings API" in HUB-GUIDE.md).
//
//   GET /api/tv/saver              -> { settings, photos: [{ id, url }], source: { id, label, ok, error?, count, fallback, heic } }
//   GET /api/tv/saver?refresh=1    the same, after scanning again (at most every 10 s)
//   GET /api/tv/saver/sources      -> { sources: [{ id, label, available, detail, path? }] }; paths only for this computer
//   GET /api/tv/saver/photo/<id>   one image
//
// Sources:
//   wallpapers  the hub's uploaded wallpapers, then its built-in ones
//   pictures    this computer's Pictures folder
//   icloud      iCloud Photos as iCloud for Windows syncs it (Pictures\iCloud Photos). A Mac's Photos
//               library is a package, not a folder of pictures: export an album to a folder instead.
//   folder      any folder on this computer, set from this computer only (hub-settings.mjs)
// Cloud-only libraries (Google Photos, OneDrive's web albums, Amazon Photos) need their own sign-in
// (OAuth) and aren't here; a folder they sync to works through `folder`.
//
// Folders are scanned for jpg, jpeg, png, webp, gif and avif, recursively, up to MAX_PHOTOS files, and
// rescanned when the setting changes or every few minutes. HEIC is counted and skipped: browsers can't
// show it. An id is a hash of a file the last scan found; a path never comes from the request, and a
// file is served only while it is still inside the folder it was found in. When a source has nothing
// to show, or fails, the wallpapers stand in (source.fallback), so the screensaver always has pictures.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { store, BUILTIN_WALLPAPERS, saverDefault } from './hub-settings.mjs'
import { isLocal } from './access.mjs'

export const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' }
const HEIC = new Set(['.heic', '.heif'])
export const MAX_PHOTOS = 2000
const MAX_ENTRIES = 60_000 // folder entries looked at in one scan, so choosing a whole drive stays quick
const MAX_DEPTH = 12
const SCAN_BUDGET_MS = 12_000
const MAX_BYTES = 60 * 2 ** 20 // bigger than this is a scan or a panorama no TV should decode
const FRESH_MS = 5 * 60_000
const MIN_RESCAN_MS = 10_000
const SKIP_DIRS = new Set(['node_modules', '$recycle.bin', 'system volume information', '@eadir', '.thumbnails'])
export const ID_RE = /^[a-f0-9]{20}$/
const LABELS = { wallpapers: 'Wallpapers', pictures: 'Pictures', icloud: 'iCloud Photos', folder: 'Folder' }
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'"

export const photoId = (root, file) => crypto.createHash('sha256').update(`${root}\0${file}`).digest('hex').slice(0, 20)
const isDir = async p => { try { return (await fs.promises.stat(p)).isDirectory() } catch { return false } }
const firstDir = async list => { for (const p of list) if (p && await isDir(p)) return p; return '' }
const uniq = list => [...new Set(list.filter(Boolean))]

// Every picture under `root`: breadth first, so the top folders come first when there are too many.
// Hidden folders, links (a link could lead out of the folder) and system folders are skipped.
export async function scanFolder(root, { max = MAX_PHOTOS, budgetMs = SCAN_BUDGET_MS } = {}) {
  const started = Date.now()
  const found = []
  let heic = 0, entries = 0, truncated = false
  const queue = [{ dir: root, depth: 0 }]
  while (queue.length) {
    const { dir, depth } = queue.shift()
    let list
    try { list = await fs.promises.readdir(dir, { withFileTypes: true }) } catch (e) {
      if (dir === root) throw e
      continue
    }
    list.sort((a, b) => a.name.localeCompare(b.name))
    for (const d of list) {
      if (++entries > MAX_ENTRIES || found.length >= max || Date.now() - started > budgetMs) { truncated = true; break }
      if (d.name.startsWith('.') || d.isSymbolicLink()) continue
      const full = path.join(dir, d.name)
      if (d.isDirectory()) { if (depth < MAX_DEPTH && !SKIP_DIRS.has(d.name.toLowerCase())) queue.push({ dir: full, depth: depth + 1 }) }
      else if (d.isFile()) {
        const ext = path.extname(d.name).toLowerCase()
        if (IMAGE_TYPES[ext]) found.push(full)
        else if (HEIC.has(ext)) heic++
      }
    }
    if (truncated) break
  }
  // Newest first. Reading a file's date never downloads it, even from a cloud folder.
  const files = []
  for (let i = 0; i < found.length; i += 64) {
    const batch = await Promise.all(found.slice(i, i + 64).map(async file => {
      try { const st = await fs.promises.stat(file); return st.isFile() && st.size > 0 && st.size <= MAX_BYTES ? { file, mtime: st.mtimeMs, size: st.size } : null } catch { return null }
    }))
    files.push(...batch.filter(Boolean))
  }
  files.sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file))
  return { files, heic, truncated }
}

/* ── where each source lives on this computer ───────────────────────────────── */

// Windows keeps the real Pictures folder in the registry (it moves to OneDrive when that backs it up).
function windowsPictures() {
  return new Promise(resolve => {
    execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'My Pictures'], { timeout: 4000, windowsHide: true }, (err, out) => {
      const m = !err && /My Pictures\s+REG_(?:EXPAND_)?SZ\s+(.+)/i.exec(String(out))
      resolve(m ? m[1].trim().replace(/%([^%]+)%/g, (all, k) => process.env[k] ?? all) : '')
    })
  })
}
function linuxPictures(home) {
  try {
    const m = /^XDG_PICTURES_DIR="?([^"\n]+)"?/m.exec(fs.readFileSync(path.join(home, '.config', 'user-dirs.dirs'), 'utf8'))
    return m ? m[1].replace(/^\$HOME/, home) : ''
  } catch { return '' }
}
export async function picturesCandidates({ home = os.homedir(), platform = process.platform } = {}) {
  if (platform === 'win32') return uniq([await windowsPictures(), path.join(home, 'Pictures'), path.join(home, 'OneDrive', 'Pictures')])
  if (platform === 'linux') return uniq([linuxPictures(home), path.join(home, 'Pictures')])
  return [path.join(home, 'Pictures')]
}
// iCloud for Windows syncs iCloud Photos to "iCloud Photos" (with Photos and Shared inside) under
// Pictures; older versions and some setups put it in the user folder.
export function icloudCandidates({ home = os.homedir(), pictures = '', platform = process.platform } = {}) {
  if (platform !== 'win32') return []
  return uniq([
    pictures && path.join(pictures, 'iCloud Photos'),
    path.join(home, 'Pictures', 'iCloud Photos'),
    path.join(home, 'OneDrive', 'Pictures', 'iCloud Photos'),
    path.join(home, 'iCloud Photos'),
    path.join(home, 'iCloudPhotos'),
  ])
}
export function icloudMissing(platform = process.platform) {
  if (platform === 'darwin') return 'On a Mac, Photos keeps its library in a package, not a folder of pictures. In Photos, export an album (File › Export) to a folder, then choose Folder.'
  if (platform === 'win32') return 'iCloud Photos isn’t on this computer. Install iCloud for Windows and turn on Photos: it syncs to Pictures › iCloud Photos.'
  return 'iCloud Photos doesn’t sync to Linux. Download an album from icloud.com to a folder, then choose Folder.'
}

/* ── the module ─────────────────────────────────────────────────────────────── */

// `home` and `platform` are for tests; the hub passes neither.
export function create({ here, home = os.homedir(), platform = process.platform }) {
  const st = store(here)
  const settings = () => ({ ...saverDefault(), ...(st.get().tv?.saver || {}) })
  let cache = null // { key, at, source, list: [entries], byId: Map }
  let running = null // { key, promise }
  let lastForced = 0

  async function locate(s) {
    if (s.source === 'pictures') {
      const dir = await firstDir(await picturesCandidates({ home, platform }))
      return dir ? { root: dir } : { error: 'This computer has no Pictures folder.' }
    }
    if (s.source === 'icloud') {
      const pictures = await firstDir(await picturesCandidates({ home, platform }))
      const dir = await firstDir(icloudCandidates({ home, pictures, platform }))
      return dir ? { root: dir } : { error: icloudMissing(platform) }
    }
    if (s.source === 'folder') {
      if (!s.folder) return { error: 'No folder chosen yet. Choose one in LocalHub on the computer it runs on.' }
      if (!await isDir(s.folder)) return { error: 'That folder isn’t there now. Is its drive connected?' }
      return { root: s.folder }
    }
    return { wallpapers: true }
  }

  // The hub's uploads (your own photos) first, then the TV's photos (tv/ui/photos/saver, made at the TV's own
  // 1920x1080: sharp, and light on a Fire TV Stick's memory). The gradient wallpapers only if those are missing.
  function wallpaperEntries() {
    const s = st.get()
    const upDir = path.join(here, 'data', 'wallpapers'), wallDir = path.join(here, 'wallpapers'), photoDir = path.join(here, 'tv', 'ui', 'photos', 'saver')
    const ups = (s.wallpaper?.uploads || []).map(u => ({ root: upDir, file: path.join(upDir, u.file), type: IMAGE_TYPES[path.extname(u.file).toLowerCase()] }))
    let photos = []
    try { photos = fs.readdirSync(photoDir).filter(f => /\.jpe?g$/i.test(f)).sort().map(f => ({ root: photoDir, file: path.join(photoDir, f), type: 'image/jpeg' })) } catch { /* none */ }
    const builtin = photos.length ? photos : BUILTIN_WALLPAPERS.map(w => ({ root: wallDir, file: path.join(wallDir, `${w.id}.svg`), type: 'image/svg+xml' }))
    return [...ups, ...builtin].filter(e => e.type).map(e => ({ ...e, id: photoId(e.root, e.file) }))
  }

  async function scan(s) {
    const id = s.source, where = await locate(s)
    const label = id === 'folder' && where.root ? path.basename(where.root) || where.root : LABELS[id]
    let list = [], error = where.error || '', heic = 0, truncated = false
    if (where.wallpapers) list = wallpaperEntries()
    else if (where.root) {
      try {
        const r = await scanFolder(where.root)
        heic = r.heic
        truncated = r.truncated
        list = r.files.map(f => ({ root: where.root, file: f.file, type: IMAGE_TYPES[path.extname(f.file).toLowerCase()], mtime: f.mtime, size: f.size, id: photoId(where.root, f.file) }))
        if (!list.length) error = heic ? `${label} has only HEIC photos, which a TV can’t show. In iCloud for Windows, turn off “Keep high efficiency original”, or export as JPEG.` : `${label} has no photos yet.`
      } catch (e) {
        error = e.code === 'EACCES' || e.code === 'EPERM' ? `LocalHub isn’t allowed to read ${label}.` : `${label} couldn’t be read (${e.code || e.message}).`
      }
    }
    const fallback = !list.length
    if (fallback) list = wallpaperEntries()
    const source = { id, label, ok: !error, ...(error ? { error } : {}), count: fallback ? 0 : list.length, fallback, heic, truncated, at: Date.now() }
    return { source, list, byId: new Map(list.map(e => [e.id, e])) }
  }

  const keyOf = s => JSON.stringify([s.source, s.source === 'folder' ? s.folder : '', (st.get().wallpaper?.uploads || []).map(u => u.id)])
  function start(s, key) {
    if (running?.key === key) return running.promise
    const promise = scan(s).then(r => { cache = { key, at: Date.now(), ...r }; return cache }).finally(() => { if (running?.promise === promise) running = null })
    running = { key, promise }
    return promise
  }
  // The last scan while it is fresh; a stale one is answered at once and refreshed behind it.
  async function current({ force = false } = {}) {
    const s = settings(), key = keyOf(s)
    if (cache?.key === key && !force) {
      if (Date.now() - cache.at > FRESH_MS) start(s, key).catch(() => {})
      return cache
    }
    return start(s, key)
  }

  async function sources(local) {
    const s = settings()
    const pictures = await firstDir(await picturesCandidates({ home, platform }))
    const icloud = await firstDir(icloudCandidates({ home, pictures, platform }))
    const folderOk = !!s.folder && await isDir(s.folder)
    const ups = (st.get().wallpaper?.uploads || []).length
    const at = p => (local && p ? { path: p } : {})
    return [
      { id: 'wallpapers', label: LABELS.wallpapers, available: true, detail: `${BUILTIN_WALLPAPERS.length} built-in${ups ? `, ${ups} uploaded` : ''}` },
      { id: 'pictures', label: LABELS.pictures, available: !!pictures, detail: pictures ? 'This computer’s Pictures folder' : 'This computer has no Pictures folder.', ...at(pictures) },
      { id: 'icloud', label: LABELS.icloud, available: !!icloud, detail: icloud ? 'Synced by iCloud for Windows' : icloudMissing(platform), ...at(icloud) },
      { id: 'folder', label: s.folder ? path.basename(s.folder) || s.folder : LABELS.folder, available: folderOk, detail: !s.folder ? 'Choose a folder in LocalHub on this computer' : folderOk ? 'A folder on this computer' : 'That folder isn’t there now', ...at(s.folder) },
    ]
  }

  async function servePhoto(id, req, res, send) {
    const e = ID_RE.test(id) ? (await current()).byId.get(id) : null
    if (!e) return send(res, 404, { error: 'not found' })
    let real, info
    try {
      // Still a file, and still inside the folder it was found in (a link swapped in since doesn't count).
      const [file, root] = await Promise.all([fs.promises.realpath(e.file), fs.promises.realpath(e.root)])
      if (!file.startsWith(root + path.sep)) return send(res, 404, { error: 'not found' })
      info = await fs.promises.stat(file)
      if (!info.isFile() || info.size > MAX_BYTES) return send(res, 404, { error: 'not found' })
      real = file
    } catch { return send(res, 404, { error: 'not found' }) }
    const etag = `"${id}-${Math.round(info.mtimeMs).toString(36)}-${info.size.toString(36)}"`
    const head = { 'cache-control': 'private, max-age=86400', etag, 'x-content-type-options': 'nosniff', ...(e.type === 'image/svg+xml' ? { 'content-security-policy': SVG_CSP } : {}) }
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); return res.end() }
    res.writeHead(200, { ...head, 'content-type': e.type, 'content-length': info.size })
    const stream = fs.createReadStream(real)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  }

  async function route(url, req, res, { send }) {
    const p = url.pathname
    if (p !== '/api/tv/saver' && !p.startsWith('/api/tv/saver/')) return false
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' }), true
    if (p === '/api/tv/saver') {
      const force = url.searchParams.get('refresh') === '1' && Date.now() - lastForced > MIN_RESCAN_MS
      if (force) lastForced = Date.now()
      const r = await current({ force })
      return send(res, 200, { settings: settings(), photos: r.list.map(e => ({ id: e.id, url: `/api/tv/saver/photo/${e.id}` })), source: r.source }), true
    }
    if (p === '/api/tv/saver/sources') return send(res, 200, { sources: await sources(isLocal(req)) }), true
    const m = /^\/api\/tv\/saver\/photo\/([^/]+)$/.exec(p)
    if (m) return await servePhoto(m[1], req, res, send), true
    return send(res, 404, { error: 'not found' }), true
  }
  route.current = current // for tests
  return route
}
