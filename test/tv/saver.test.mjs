// The TV screensaver: its setting (tv.saver in hub-settings.mjs) and its photos (tv-saver.mjs).
// Runs offline in temporary folders with invented images. Nothing here reads your own pictures.
//
//   node --test test/tv/
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyPatch, store, saverDefault, create as createSettings } from '../../hub-settings.mjs'
import { create, scanFolder, photoId, icloudCandidates, icloudMissing, ID_RE, MAX_PHOTOS } from '../../tv-saver.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a0f5a9b90000000049454e44ae426082', 'hex')
const JPG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex')

const tmp = name => fs.mkdtempSync(path.join(os.tmpdir(), `lh-saver-${name}-`))
function put(file, body = PNG) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body) }
// A hub folder of its own: the built-in wallpapers and nothing else.
function hubDir() {
  const here = tmp('hub')
  fs.mkdirSync(path.join(here, 'wallpapers'))
  for (const f of fs.readdirSync(path.join(REPO, 'wallpapers'))) fs.copyFileSync(path.join(REPO, 'wallpapers', f), path.join(here, 'wallpapers', f))
  return here
}
// A folder of pictures: four the TV can show, one HEIC, and things that aren't pictures.
function photoDir() {
  const dir = tmp('photos')
  put(path.join(dir, 'a.jpg'), JPG)
  put(path.join(dir, 'b.PNG'))
  put(path.join(dir, 'Trip', 'c.webp'))
  put(path.join(dir, 'Trip', 'Day 2', 'd.gif'))
  put(path.join(dir, 'e.heic'))
  put(path.join(dir, 'notes.txt'), Buffer.from('not a picture'))
  put(path.join(dir, 'page.svg'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))
  put(path.join(dir, '.hidden', 'x.jpg'))
  put(path.join(dir, 'empty.jpg'), Buffer.alloc(0))
  return dir
}
const blank = () => ({ version: 1, tabs: { order: [], hidden: [], names: {} }, apps: [], sites: [], groups: [], widgets: { desktop: [], ipad: [], mobile: [], tv: [] }, pages: [], files: [], style: {}, wallpaper: { current: 'none', custom: [], uploads: [] } })
const errorsOf = fn => { try { fn() } catch (e) { return (e.errors || [{ path: '', message: e.message }]).map(x => x.path) } return [] }

function send(res, status, body, type) {
  const isText = typeof body === 'string' || Buffer.isBuffer(body)
  res.writeHead(status, { 'content-type': type || (isText ? 'text/plain; charset=utf-8' : 'application/json') })
  res.end(isText ? body : JSON.stringify(body))
}
async function withServer(routes, fn) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    try {
      for (const r of routes) if (await r(url, req, res, { send })) return
      send(res, 404, { error: 'not found' })
    } catch (e) { send(res, 500, { error: e.message }) }
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try { await fn(base) } finally { server.closeAllConnections?.(); await new Promise(r => server.close(r)) }
}
const remote = { 'x-forwarded-for': '100.64.0.9' } // isLocal() is false for anything passed on by a proxy

/* ── the setting ─────────────────────────────────────────────────────────── */

test('tv.saver starts from the default and takes partial patches', () => {
  const a = applyPatch(blank(), { tv: { saver: { interval: 30 } } }, REPO)
  assert.deepEqual(a.tv.saver, { ...saverDefault(), interval: 30 })
  assert.deepEqual(saverDefault(), { source: 'wallpapers', folder: '', interval: 12, shuffle: true, motion: 'kenburns', widgets: ['clock', 'date'] })
  const b = applyPatch(a, { tv: { saver: { source: 'icloud', shuffle: false, motion: 'fade', widgets: ['clock', 'world-clock', 'recent', 'date'] } } }, REPO)
  assert.deepEqual(b.tv.saver, { source: 'icloud', folder: '', interval: 30, shuffle: false, motion: 'fade', widgets: ['clock', 'world-clock', 'recent', 'date'] })
  assert.deepEqual(applyPatch(b, { tv: { saver: { widgets: [] } } }, REPO).tv.saver.widgets, [])
})

test('tv.saver sits in the tv block next to the TV app order', () => {
  const a = applyPatch(blank(), { tv: { apps: ['netflix', 'plex'], hidden: ['tubi'] } }, REPO)
  const b = applyPatch(a, { tv: { saver: { source: 'pictures' } } }, REPO)
  assert.deepEqual(b.tv.apps, ['netflix', 'plex'])
  assert.deepEqual(b.tv.hidden, ['tubi'])
  assert.equal(b.tv.saver.source, 'pictures')
  const c = applyPatch(b, { tv: { apps: null } }, REPO)
  assert.equal(c.tv.saver.source, 'pictures')
})

test('tv.saver refuses what it does not know, and says where', () => {
  const s = blank()
  assert.deepEqual(errorsOf(() => applyPatch(s, { tv: { saver: { source: 'gphotos' } } }, REPO)), ['tv.saver.source'])
  assert.deepEqual(errorsOf(() => applyPatch(s, { tv: { saver: { interval: 4 } } }, REPO)), ['tv.saver.interval'])
  assert.deepEqual(errorsOf(() => applyPatch(s, { tv: { saver: { interval: 301 } } }, REPO)), ['tv.saver.interval'])
  assert.deepEqual(errorsOf(() => applyPatch(s, { tv: { saver: { interval: 7.5 } } }, REPO)), ['tv.saver.interval'])
  assert.deepEqual(errorsOf(() => applyPatch(s, { tv: { saver: { shuffle: 'yes' } } }, REPO)), ['tv.saver.shuffle'])
  assert.deepEqual(errorsOf(() => applyPatch(s, { tv: { saver: { motion: 'spin' } } }, REPO)), ['tv.saver.motion'])
  assert.deepEqual(errorsOf(() => applyPatch(s, { tv: { saver: { widgets: ['clock', 'claude-usage'] } } }, REPO)), ['tv.saver.widgets[1]'])
  assert.deepEqual(errorsOf(() => applyPatch(s, { tv: { saver: { widgets: ['clock', 'clock'] } } }, REPO)), ['tv.saver.widgets[1]'])
  assert.deepEqual(errorsOf(() => applyPatch(s, { tv: { saver: { widgets: ['clock', 'date', 'world-clock', 'recent', 'clock'] } } }, REPO)), ['tv.saver.widgets'])
  assert.deepEqual(errorsOf(() => applyPatch(s, { tv: { saver: { extra: 1 } } }, REPO)), ['tv.saver.extra'])
  assert.deepEqual(errorsOf(() => applyPatch(s, { tv: { saver: 'icloud' } }, REPO)), ['tv.saver'])
  assert.deepEqual(errorsOf(() => applyPatch(s, { tv: { saver: { folder: 'relative/photos' } } }, REPO)), ['tv.saver.folder'])
  assert.deepEqual(errorsOf(() => applyPatch(s, { tv: { saver: { folder: `${path.resolve('/x')}\u0000` } } }, REPO)), ['tv.saver.folder'])
  assert.deepEqual(errorsOf(() => applyPatch(s, { tv: { saver: { folder: 42 } } }, REPO)), ['tv.saver.folder'])
  // Every problem in one answer, and nothing changes.
  assert.equal(errorsOf(() => applyPatch(s, { tv: { saver: { source: 'x', interval: 1, motion: 'y' } } }, REPO)).length, 3)
})

test('a folder is an absolute path, tidied', () => {
  const dir = path.resolve(os.tmpdir(), 'Some Photos')
  assert.equal(applyPatch(blank(), { tv: { saver: { folder: dir + path.sep } } }, REPO).tv.saver.folder, dir)
  assert.equal(applyPatch(blank(), { tv: { saver: { folder: `  ${dir}  ` } } }, REPO).tv.saver.folder, dir)
  const root = path.parse(dir).root
  assert.equal(applyPatch(blank(), { tv: { saver: { folder: root } } }, REPO).tv.saver.folder, root)
  assert.equal(applyPatch(blank(), { tv: { saver: { folder: '' } } }, REPO).tv.saver.folder, '')
})

test('a reset of tv keeps the chosen folder', () => {
  const dir = path.resolve(os.tmpdir(), 'Kept')
  const a = applyPatch(blank(), { tv: { apps: ['plex'], saver: { source: 'folder', folder: dir, interval: 60 } } }, REPO)
  const b = applyPatch(a, { reset: ['tv'] }, REPO)
  assert.deepEqual(b.tv.saver, { ...saverDefault(), folder: dir })
  assert.deepEqual(b.tv.apps, [])
})

test('a damaged saved setting is repaired field by field', () => {
  // A good settings file from one hub, damaged, then read by a second hub that has never seen it.
  const first = store(hubDir())
  const saved = JSON.parse(JSON.stringify(first.get()))
  assert.deepEqual(saved.tv.saver, saverDefault())
  saved.tv = { apps: ['plex'], hidden: [], saver: { source: 'nope', interval: 45, shuffle: 'x', motion: 'fade', widgets: ['clock', 'bogus'], folder: 'not/absolute' } }
  const other = hubDir()
  fs.mkdirSync(path.join(other, 'data'), { recursive: true })
  fs.writeFileSync(path.join(other, 'data', 'hub-settings.json'), JSON.stringify(saved))
  const r = store(other).get()
  assert.deepEqual(r.tv.saver, { ...saverDefault(), interval: 45, motion: 'fade' })
  assert.deepEqual(r.tv.apps, ['plex'])
  // A file from before the screensaver gets the default.
  delete saved.tv.saver
  const older = hubDir()
  fs.mkdirSync(path.join(older, 'data'), { recursive: true })
  fs.writeFileSync(path.join(older, 'data', 'hub-settings.json'), JSON.stringify(saved))
  assert.deepEqual(store(older).get().tv.saver, saverDefault())
})

test('only this computer changes the folder; any device may pick the source', async () => {
  const here = hubDir()
  const dir = photoDir()
  await withServer([createSettings({ here })], async base => {
    const post = (body, headers = {}) => fetch(`${base}/api/hub/settings`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1', ...headers }, body: JSON.stringify(body) })
    let r = await post({ tv: { saver: { source: 'folder', folder: dir } } }, remote)
    assert.equal(r.status, 403)
    assert.equal((await r.json()).errors[0].path, 'tv.saver.folder')
    r = await post({ tv: { saver: { source: 'folder', folder: dir } } })
    assert.equal(r.status, 200)
    assert.equal((await r.json()).tv.saver.folder, dir)
    // The hub's editor saves the whole setting back: the same folder from a TV or phone is fine.
    r = await post({ tv: { saver: { ...saverDefault(), source: 'pictures', folder: dir, interval: 20 } } }, remote)
    assert.equal(r.status, 200)
    const s = await r.json()
    assert.equal(s.tv.saver.source, 'pictures')
    assert.equal(s.tv.saver.folder, dir)
    // Undo from another device puts back the source but leaves the folder alone.
    await post({ tv: { saver: { folder: '' } } })
    r = await post({ undo: true }, remote)
    assert.equal((await r.json()).tv.saver.folder, '')
    // The setting shows in GET, and an export leaves the folder out.
    await post({ tv: { saver: { folder: dir } } })
    assert.equal((await (await fetch(`${base}/api/hub/settings`)).json()).tv.saver.folder, dir)
    const exp = await (await fetch(`${base}/api/hub/settings/export`)).json()
    assert.equal(exp.tv.saver.source, 'pictures')
    assert.equal('folder' in exp.tv.saver, false)
    const cat = await (await fetch(`${base}/api/hub/settings/catalog`)).json()
    assert.deepEqual(cat.tv.saver.sources, ['wallpapers', 'folder', 'icloud', 'pictures'])
  })
})

/* ── scanning ────────────────────────────────────────────────────────────── */

test('a scan finds the pictures a TV can show, newest first', async () => {
  const dir = photoDir()
  const old = new Date('2020-01-01'), mid = new Date('2022-01-01')
  fs.utimesSync(path.join(dir, 'a.jpg'), old, old)
  fs.utimesSync(path.join(dir, 'b.PNG'), mid, mid)
  const r = await scanFolder(dir)
  const rel = r.files.map(f => path.relative(dir, f.file).split(path.sep).join('/'))
  assert.deepEqual([...rel].sort(), ['Trip/Day 2/d.gif', 'Trip/c.webp', 'a.jpg', 'b.PNG'])
  assert.deepEqual(rel.slice(-2), ['b.PNG', 'a.jpg'])
  assert.equal(r.heic, 1)
  assert.equal(r.truncated, false)
})

test('a scan stops at its cap and skips links', async () => {
  const dir = photoDir()
  const r = await scanFolder(dir, { max: 2 })
  assert.equal(r.files.length, 2)
  assert.equal(r.truncated, true)
  assert.equal(MAX_PHOTOS, 2000)
  const outside = photoDir()
  let linked = true
  try { fs.symlinkSync(outside, path.join(dir, 'link'), 'junction') } catch { linked = false }
  if (linked) {
    const s = await scanFolder(dir)
    assert.ok(s.files.every(f => !f.file.startsWith(path.join(dir, 'link'))))
  }
  await assert.rejects(scanFolder(path.join(dir, 'missing')))
})

test('ids are hashes of what a scan found, never paths', () => {
  const id = photoId('/a', '/a/b.jpg')
  assert.match(id, ID_RE)
  assert.equal(id, photoId('/a', '/a/b.jpg'))
  assert.notEqual(id, photoId('/a', '/a/c.jpg'))
  assert.notEqual(id, photoId('/b', '/a/b.jpg'))
})

test('iCloud Photos is looked for where iCloud for Windows puts it, and a Mac is told why not', () => {
  const home = path.resolve('/home/someone')
  const c = icloudCandidates({ home, pictures: path.join(home, 'OneDrive', 'Pictures'), platform: 'win32' })
  assert.equal(c[0], path.join(home, 'OneDrive', 'Pictures', 'iCloud Photos'))
  assert.ok(c.includes(path.join(home, 'Pictures', 'iCloud Photos')))
  assert.deepEqual(icloudCandidates({ home, platform: 'darwin' }), [])
  assert.match(icloudMissing('darwin'), /export/i)
  assert.match(icloudMissing('win32'), /iCloud for Windows/)
})

/* ── the endpoints ───────────────────────────────────────────────────────── */

test('a folder source lists its photos and serves them by id', async () => {
  const here = hubDir(), dir = photoDir()
  store(here).patch({ tv: { saver: { source: 'folder', folder: dir } } })
  await withServer([create({ here, home: tmp('home'), platform: 'linux' })], async base => {
    const j = await (await fetch(`${base}/api/tv/saver`)).json()
    assert.equal(j.source.ok, true)
    assert.equal(j.source.fallback, false)
    assert.equal(j.source.count, 4)
    assert.equal(j.source.heic, 1)
    assert.equal(j.source.label, path.basename(dir))
    assert.equal(j.settings.source, 'folder')
    assert.equal(j.photos.length, 4)
    for (const p of j.photos) { assert.match(p.id, ID_RE); assert.equal(p.url, `/api/tv/saver/photo/${p.id}`) }
    assert.ok(!JSON.stringify(j.photos).includes(dir.replace(/\\/g, '\\\\')), 'no paths in the list')
    const jpg = j.photos.find(p => p.id === photoId(dir, path.join(dir, 'a.jpg')))
    const r = await fetch(`${base}${jpg.url}`)
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('content-type'), 'image/jpeg')
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), JPG)
    assert.equal((await fetch(`${base}${jpg.url}`, { headers: { 'if-none-match': r.headers.get('etag') } })).status, 304)
  })
})

test('a photo request can only reach a file the scan found, still inside its folder', async () => {
  const here = hubDir(), dir = photoDir()
  store(here).patch({ tv: { saver: { source: 'folder', folder: dir } } })
  await withServer([create({ here, home: tmp('home'), platform: 'linux' })], async base => {
    const j = await (await fetch(`${base}/api/tv/saver`)).json()
    for (const bad of ['0'.repeat(20), 'a.jpg', '..%2F..%2Fpackage.json', '..%5C..%5Cpackage.json', encodeURIComponent(path.join(dir, 'a.jpg')), 'ABCDEF0123456789ABCD']) {
      assert.equal((await fetch(`${base}/api/tv/saver/photo/${bad}`)).status, 404, bad)
    }
    // The secret beside the folder isn't reachable, whatever the id.
    put(path.join(path.dirname(dir), 'secret.png'))
    assert.equal((await fetch(`${base}/api/tv/saver/photo/${photoId(dir, path.join(path.dirname(dir), 'secret.png'))}`)).status, 404)
    // A file gone since the scan is gone.
    const b = photoId(dir, path.join(dir, 'b.PNG'))
    fs.rmSync(path.join(dir, 'b.PNG'))
    assert.equal((await fetch(`${base}/api/tv/saver/photo/${b}`)).status, 404)
    // A photo from the old folder is not served once the folder changes.
    const first = j.photos.find(p => p.id === photoId(dir, path.join(dir, 'a.jpg')))
    const other = photoDir()
    store(here).patch({ tv: { saver: { folder: other } } })
    const k = await (await fetch(`${base}/api/tv/saver`)).json()
    assert.equal(k.photos.length, 4)
    assert.equal((await fetch(`${base}${first.url}`)).status, 404)
    assert.equal((await fetch(`${base}/api/tv/saver`, { method: 'POST', headers: { 'x-hub': '1' } })).status, 405)
  })
})

test('an empty, missing or unusable source falls back to the wallpapers', async () => {
  const here = hubDir(), empty = tmp('empty')
  put(path.join(empty, 'only.heic'))
  const st = store(here)
  await withServer([create({ here, home: tmp('home'), platform: 'darwin' })], async base => {
    const get = async () => (await fetch(`${base}/api/tv/saver`)).json()
    st.patch({ tv: { saver: { source: 'folder', folder: empty } } })
    let j = await get()
    assert.equal(j.source.ok, false)
    assert.equal(j.source.fallback, true)
    assert.match(j.source.error, /HEIC/)
    assert.equal(j.photos.length, 8)
    st.patch({ tv: { saver: { folder: path.join(empty, 'gone') } } })
    j = await get()
    assert.equal(j.source.fallback, true)
    assert.match(j.source.error, /isn’t there/)
    st.patch({ tv: { saver: { source: 'icloud' } } })
    j = await get()
    assert.equal(j.source.fallback, true)
    assert.match(j.source.error, /Mac/)
    st.patch({ tv: { saver: { source: 'folder', folder: '' } } })
    assert.match((await get()).source.error, /No folder chosen/)
  })
})

test('the wallpapers source serves the built-in wallpapers and uploads', async () => {
  const here = hubDir()
  await withServer([create({ here, home: tmp('home'), platform: 'linux' })], async base => {
    const j = await (await fetch(`${base}/api/tv/saver`)).json()
    assert.equal(j.source.id, 'wallpapers')
    assert.equal(j.source.ok, true)
    assert.equal(j.photos.length, fs.readdirSync(path.join(here, 'wallpapers')).length)
    const r = await fetch(`${base}${j.photos[0].url}`)
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('content-type'), 'image/svg+xml')
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/)
  })
})

test('Pictures is found, and sources tell only this computer where things are', async () => {
  const here = hubDir(), home = tmp('home')
  put(path.join(home, 'Pictures', 'Summer', 'p.jpg'), JPG)
  store(here).patch({ tv: { saver: { source: 'pictures' } } })
  await withServer([create({ here, home, platform: 'linux' })], async base => {
    const j = await (await fetch(`${base}/api/tv/saver`)).json()
    assert.equal(j.source.ok, true)
    assert.equal(j.photos.length, 1)
    const mine = (await (await fetch(`${base}/api/tv/saver/sources`)).json()).sources
    assert.deepEqual(mine.map(x => x.id), ['wallpapers', 'pictures', 'icloud', 'folder'])
    assert.equal(mine.find(x => x.id === 'pictures').path, path.join(home, 'Pictures'))
    assert.equal(mine.find(x => x.id === 'icloud').available, false)
    const theirs = (await (await fetch(`${base}/api/tv/saver/sources`, { headers: remote })).json()).sources
    assert.equal(theirs.find(x => x.id === 'pictures').available, true)
    assert.ok(theirs.every(x => !('path' in x)))
  })
})
