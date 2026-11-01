// Back-end tests for the search bar: what may be saved, which addresses the icon fetch will touch,
// import and export, and the routes. Every value here is invented. Run: node --test test/launcher/
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { Readable } from 'node:stream'
import { cleanLink, cleanSnippet, readImport, blockedAddress, safeGet, sniffImage, iconLinks, create, FORMAT } from '../../launcher.mjs'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)])
const SENTINEL = 'SNIPPET-SENTINEL-7f3a'
const dirs = []
const servers = []

function tempDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-launcher-unit-'))
  dirs.push(d)
  return d
}
after(() => {
  for (const s of servers) s.closeAllConnections?.(), s.close()
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
})

// A real local site that counts what reaches it.
function site(handler, host = '127.0.0.1') {
  return new Promise(resolve => {
    const hits = []
    const server = http.createServer((req, res) => { hits.push(req.url); handler(req, res) })
    servers.push(server)
    server.listen(0, host, () => resolve({ hits, port: server.address().port, base: `http://${host}:${server.address().port}` }))
  })
}

// Runs a route with no sockets, so a test can also choose the caller's address.
function client(options = {}) {
  const here = options.here || tempDir()
  const route = create({ here, ...options })
  const call = async (method, url, body, remote = '127.0.0.1', headers = { host: 'localhost' }) => {
    const req = Readable.from(body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)])
    req.method = method
    req.socket = { remoteAddress: remote }
    req.headers = headers
    let out = {}
    const send = (_res, code, value) => { out = { code, body: value } }
    const res = {
      writeHead(code, headers) { out = { code, headers, chunks: [] } },
      end(chunk) { if (chunk) out.chunks.push(Buffer.from(chunk)) },
    }
    const handled = await route(new URL(url, 'http://hub.invalid'), req, res, { send })
    return { ...out, handled, raw: out.chunks ? Buffer.concat(out.chunks) : undefined }
  }
  return { call, here }
}

/* ---------- what may be saved ---------- */

test('links: script and other schemes are refused however they are written', () => {
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', '  javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///c:/x', 'blob:http://a.example/b', 'ftp://a.example/b', 'about:blank', 'http://user:pw@a.example/', 'not a url', '']) {
    assert.throws(() => cleanLink({ name: 'x', kind: 'web', url }), { code: 400 }, url)
  }
  for (const url of ['javascript:alert(1)', 'https://a.example', 'obsidian://evil/x', 'obsidian:']) {
    assert.throws(() => cleanLink({ name: 'x', kind: 'obsidian', url }), { code: 400 }, url)
  }
  assert.throws(() => cleanLink({ name: 'x', kind: 'script', url: 'https://a.example' }), { code: 400 })
  assert.throws(() => cleanLink('https://a.example'), { code: 400 })
})

test('links: web, bare name, Obsidian and folder links are kept', () => {
  assert.equal(cleanLink({ name: 'A', url: 'https://a.example/x?y=1' }).url, 'https://a.example/x?y=1')
  assert.equal(cleanLink({ name: 'A', url: 'a.example' }).url, 'https://a.example/')
  assert.equal(cleanLink({ url: 'https://a.example/' }).name, 'a.example')
  assert.equal(cleanLink({ name: 'V', kind: 'obsidian', url: 'obsidian://open?vault=Notes' }).kind, 'obsidian')
  const dir = tempDir()
  assert.equal(cleanLink({ name: 'D', kind: 'folder', path: dir }).path, path.normalize(dir))
})

test('links: folders must be local, absolute and free of keys', () => {
  for (const p of ['\\\\server\\share', '//server/share', 'relative/folder', '', 'file://server/share/x']) {
    assert.throws(() => cleanLink({ name: 'x', kind: 'folder', path: p }), { code: 400 }, p)
  }
  for (const seg of ['.ssh', '.aws', '.gnupg']) {
    assert.throws(() => cleanLink({ name: 'x', kind: 'folder', path: path.join(os.homedir(), seg) }), /holds keys/, seg)
  }
})

test('links and snippets: size limits and clean lines', () => {
  assert.throws(() => cleanLink({ name: 'x'.repeat(201), url: 'https://a.example' }), { code: 400 })
  assert.throws(() => cleanLink({ name: 'x', url: `https://a.example/${'x'.repeat(2048)}` }), { code: 400 })
  assert.equal(cleanLink({ name: 'a\u0000b\nc', url: 'https://a.example' }).name, 'a b c')
  assert.throws(() => cleanSnippet({ name: 'x', text: 'y'.repeat(100 * 1024 + 1) }), { code: 400 })
  assert.throws(() => cleanSnippet({ name: 'x', text: '   ' }), { code: 400 })
  assert.throws(() => cleanSnippet({ name: 'x', text: 'y', keyword: 'two words' }), { code: 400 })
  assert.equal(cleanSnippet({ text: 'line one\n  line two', keyword: 'kw' }).text, 'line one\n  line two')
  assert.equal(cleanSnippet({ text: 't', keyword: 'kw' }).name, 'kw')
})

/* ---------- which addresses the icon fetch will touch ---------- */

test('blockedAddress: private, loopback and special ranges', () => {
  for (const ip of ['127.0.0.1', '127.9.9.9', '0.0.0.0', '10.1.2.3', '100.64.0.1', '100.127.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '192.0.2.1', '198.18.0.1', '203.0.113.5', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', '2001:db8::1', '2001::1', '2002:7f00:1::', 'ff02::1', 'not-an-ip']) {
    assert.equal(blockedAddress(ip), true, ip)
  }
  for (const ip of ['93.184.216.34', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111']) {
    assert.equal(blockedAddress(ip), false, ip)
  }
})

test('safeGet: refuses private targets in every spelling, before connecting', async () => {
  const s = await site((_q, r) => r.end('secret'))
  const p = s.port
  const targets = [`http://127.0.0.1:${p}/`, `http://2130706433:${p}/`, `http://0x7f.0.0.1:${p}/`, `http://0177.0.0.1:${p}/`, `http://127.1:${p}/`, `http://[::1]:${p}/`, `http://[::ffff:127.0.0.1]:${p}/`,
    `http://localhost:${p}/`, `http://LOCALHOST.:${p}/`, `http://a.localhost:${p}/`, `http://printer:${p}/`, `http://nas.local:${p}/`, `http://box.internal:${p}/`, `http://box.lan:${p}/`, `http://box.example.ts.net:${p}/`,
    'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://100.100.100.100/', 'http://192.168.1.1/', 'http://[fd00::1]/']
  for (const t of targets) await assert.rejects(safeGet(t), /private address/, t)
  await assert.rejects(safeGet('ftp://a.example/'), /not a web address/)
  await assert.rejects(safeGet(`http://u:p@a.example:${p}/`), /sign-in/)
  assert.equal(s.hits.length, 0, 'nothing reached the local site')
})

test('safeGet: a public-looking name that resolves private is refused at connect time', async () => {
  const s = await site((_q, r) => r.end('secret'))
  const at = address => async () => [{ address, family: 4 }]
  await assert.rejects(safeGet(`http://rebind.example:${s.port}/`, { resolver: at('127.0.0.1') }), /private address/)
  await assert.rejects(safeGet(`http://rebind.example:${s.port}/`, { resolver: async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }] }), /private address/)
  await assert.rejects(safeGet(`http://rebind.example:${s.port}/`, { resolver: async () => [] }), /private address/)
  assert.equal(s.hits.length, 0)
})

// From here the fetch may reach 127.0.0.1, standing in for the public internet, and 127.0.0.2 stands in for private.
const lab = { blocked: ip => ip === '127.0.0.2', resolver: async name => [{ address: /private/.test(name) ? '127.0.0.2' : '127.0.0.1', family: 4 }] }

test('safeGet: every redirect hop is checked again', async () => {
  const inside = await site((_q, r) => r.end('secret'), '127.0.0.2')
  const byAddress = await site((_q, r) => { r.writeHead(302, { location: `${inside.base}/secret` }); r.end() })
  await assert.rejects(safeGet(`${byAddress.base}/`, lab), /private address/)
  const byName = await site((_q, r) => { r.writeHead(301, { location: `http://private.example:${inside.port}/secret` }); r.end() })
  await assert.rejects(safeGet(`http://public.example:${byName.port}/`, lab), /private address/)
  const toFile = await site((_q, r) => { r.writeHead(302, { location: 'file:///c:/x' }); r.end() })
  await assert.rejects(safeGet(`${toFile.base}/`, lab), /not a web address/)
  assert.equal(inside.hits.length, 0, 'the private site was never reached')
  const loop = await site((_q, r) => { r.writeHead(302, { location: '/again' }); r.end() })
  await assert.rejects(safeGet(`${loop.base}/`, lab), /too many redirects/)
  assert.equal(loop.hits.length, 4)
})

test('safeGet: size and time limits hold', async () => {
  const big = await site((req, r) => {
    if (req.url === '/declared') { r.writeHead(200, { 'content-length': 1000 }); return r.end(Buffer.alloc(1000)) }
    r.writeHead(200)
    for (let i = 0; i < 10; i++) r.write(Buffer.alloc(1000))
    r.end()
  })
  await assert.rejects(safeGet(`${big.base}/declared`, { ...lab, maxBytes: 100 }), /too large/)
  await assert.rejects(safeGet(`${big.base}/stream`, { ...lab, maxBytes: 100 }), /too large/)
  const cut = await safeGet(`${big.base}/stream`, { ...lab, maxBytes: 1500, truncate: true })
  assert.ok(cut.body.length <= 1500)
  const slow = await site(() => {})
  const began = Date.now()
  await assert.rejects(safeGet(`${slow.base}/`, { ...lab, timeoutMs: 150 }), /timed out/)
  assert.ok(Date.now() - began < 2000)
})

test('sniffImage and iconLinks', () => {
  assert.equal(sniffImage(PNG).ext, 'png')
  assert.equal(sniffImage(Buffer.from([0, 0, 1, 0, 1, 0])).ext, 'ico')
  assert.equal(sniffImage(Buffer.from('GIF89a')).ext, 'gif')
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])).ext, 'jpg')
  assert.equal(sniffImage(Buffer.from('RIFF0000WEBP')).ext, 'webp')
  for (const bad of ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', '<html><script>alert(1)</script>', '']) assert.equal(sniffImage(Buffer.from(bad)), null, bad)
  const html = `<link rel="stylesheet" href="/a.css"><link rel="shortcut icon" href="/f.png"><link href='g.png' rel='icon'><link rel=icon href=https://cdn.example/h.png><link rel="icon" href="/i.png">`
  assert.deepEqual(iconLinks(html, 'https://a.example/x/'), ['https://a.example/f.png', 'https://a.example/x/g.png', 'https://cdn.example/h.png'])
})

/* ---------- icons, end to end through the route ---------- */

test('icon: fetched once, cached in data/, served with safe headers', async () => {
  const s = await site((req, r) => { if (req.url === '/favicon.ico') { r.writeHead(200, { 'content-type': 'text/html' }); r.end(PNG) } else { r.writeHead(404); r.end() } })
  const { call, here } = client({ fetchOptions: lab })
  const link = (await call('POST', '/api/launcher/links', { name: 'Site', url: `http://public.example:${s.port}/page` })).body
  const first = await Promise.all([1, 2, 3].map(() => call('GET', `/api/launcher/icon?id=${link.id}`)))
  for (const got of first) {
    assert.equal(got.code, 200)
    assert.equal(got.headers['content-type'], 'image/png', 'the bytes decide the type, not the header')
    assert.equal(got.headers['x-content-type-options'], 'nosniff')
    assert.match(got.headers['content-security-policy'], /sandbox/)
    assert.ok(got.raw.equals(PNG))
  }
  assert.equal(s.hits.length, 1, 'three requests, one fetch')
  await call('GET', `/api/launcher/icon?id=${link.id}`)
  assert.equal(s.hits.length, 1, 'served from the cache')
  assert.equal(fs.readdirSync(path.join(here, 'data', 'launcher-icons')).length, 1)
})

test('icon: oversized, SVG and HTML answers give no icon and cache nothing but a miss', async () => {
  for (const [label, body] of [['oversized', Buffer.alloc(256 * 1024 + 1, 1)], ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')], ['html', Buffer.from('<html><script>alert(1)</script>')]]) {
    const s = await site((req, r) => { if (req.url === '/favicon.ico') r.end(body); else { r.writeHead(404); r.end() } })
    const { call, here } = client({ fetchOptions: lab })
    const link = (await call('POST', '/api/launcher/links', { name: label, url: `http://public.example:${s.port}/` })).body
    assert.equal((await call('GET', `/api/launcher/icon?id=${link.id}`)).code, 204, label)
    const files = fs.readdirSync(path.join(here, 'data', 'launcher-icons'))
    assert.equal(files.length, 1, label)
    assert.match(files[0], /\.miss$/, label)
    const seen = s.hits.length
    await call('GET', `/api/launcher/icon?id=${link.id}`)
    assert.equal(s.hits.length, seen, `${label}: the miss is remembered`)
  }
})

test('icon: follows a page\'s <link rel=icon>, but not into a private address', async () => {
  const inside = await site((_q, r) => r.end(PNG), '127.0.0.2')
  const s = await site((req, r) => {
    if (req.url === '/favicon.ico') { r.writeHead(404); return r.end() }
    if (req.url === '/mine.png') return r.end(PNG)
    r.writeHead(200, { 'content-type': 'text/html' })
    r.end(req.url === '/bad' ? `<link rel="icon" href="${inside.base}/x.png">` : '<link rel="icon" href="/mine.png">')
  })
  const good = client({ fetchOptions: lab })
  const a = (await good.call('POST', '/api/launcher/links', { name: 'a', url: `http://public.example:${s.port}/good` })).body
  assert.equal((await good.call('GET', `/api/launcher/icon?id=${a.id}`)).code, 200)
  const bad = client({ fetchOptions: lab })
  const b = (await bad.call('POST', '/api/launcher/links', { name: 'b', url: `http://public.example:${s.port}/bad` })).body
  assert.equal((await bad.call('GET', `/api/launcher/icon?id=${b.id}`)).code, 204)
  assert.equal(inside.hits.length, 0)
})

test('icon: only saved web links can be asked for', async () => {
  const s = await site((_q, r) => r.end(PNG))
  const { call } = client()
  const saved = (await call('POST', '/api/launcher/links', { name: 'loop', url: `${s.base}/` })).body
  assert.equal((await call('GET', `/api/launcher/icon?id=${saved.id}`)).code, 204, 'a saved loopback link gets no icon')
  assert.equal((await call('GET', '/api/launcher/icon?id=nope')).code, 204)
  assert.equal((await call('GET', `/api/launcher/icon?url=${encodeURIComponent(s.base)}`)).code, 204)
  assert.equal(s.hits.length, 0)
})

/* ---------- import and export ---------- */

const QUICKLINKS = [{ name: 'Tracker', link: 'https://tracker.example/board' }, { name: 'Wiki', link: 'wiki.example' }, { name: 'Bad', link: 'javascript:alert(1)' }, { name: 'Notes', link: 'obsidian://open?vault=Notes' }]
const SNIPPETS = [{ name: 'Greeting', text: 'Hello there', keyword: 'hi' }, { name: 'Sign-off', text: 'Thanks', keyword: 'ty' }]

test('import: {name, link} quicklinks and {name, text, keyword} snippets', async () => {
  const { call } = client()
  const links = await call('POST', '/api/launcher/import', { data: QUICKLINKS })
  assert.deepEqual(links.body.added, { links: 2, snippets: 0 })
  assert.equal(links.body.skippedCount, 2)
  assert.match(links.body.skipped.find(s => s.name === 'Bad').reason, /http/)
  assert.match(links.body.skipped.find(s => s.name === 'Notes').reason, /Also bring in/)
  const snips = await call('POST', '/api/launcher/import', { data: SNIPPETS })
  assert.deepEqual(snips.body.added, { links: 0, snippets: 2 })
  const lib = (await call('GET', '/api/launcher/library')).body
  assert.deepEqual(lib.links.map(l => l.url), ['https://tracker.example/board', 'https://wiki.example/'])
  assert.equal(lib.snippets.find(s => s.keyword === 'hi').text, 'Hello there')
})

test('import: bringing it in twice adds nothing, and local links need the yes', async () => {
  const dir = tempDir()
  const { call } = client()
  const data = { quicklinks: [...QUICKLINKS, { name: 'Folder', link: dir }], snippets: SNIPPETS }
  const first = await call('POST', '/api/launcher/import', { data, allowLocal: true })
  assert.deepEqual(first.body.added, { links: 4, snippets: 2 })
  const again = await call('POST', '/api/launcher/import', { data, allowLocal: true })
  assert.deepEqual(again.body.added, { links: 0, snippets: 0 })
  assert.equal(again.body.unchanged, 6)
  const lib = (await call('GET', '/api/launcher/library')).body
  assert.equal(lib.links.find(l => l.name === 'Folder').kind, 'folder')
  assert.equal(lib.links.find(l => l.name === 'Notes').kind, 'obsidian')
})

test('import: bad shapes are refused or reported, never echoing snippet text', async () => {
  const { call } = client()
  assert.equal((await call('POST', '/api/launcher/import', { data: { format: 'something-else', links: [] } })).code, 400)
  assert.equal((await call('POST', '/api/launcher/import', { data: { format: FORMAT, version: 2, links: [] } })).code, 400)
  assert.equal((await call('POST', '/api/launcher/import', { data: 'text' })).code, 400)
  assert.equal((await call('POST', '/api/launcher/import', { data: { links: 'text' } })).code, 400)
  assert.equal((await call('POST', '/api/launcher/import', {})).code, 400)
  const out = await call('POST', '/api/launcher/import', { data: [5, null, { name: 'odd' }, { name: 'long', text: SENTINEL.repeat(20000), keyword: 'k' }, { name: 'one', text: `${SENTINEL} one`, keyword: 'dup' }, { name: 'two', text: `${SENTINEL} two`, keyword: 'dup' }] })
  assert.equal(out.body.added.snippets, 1)
  assert.equal(out.body.skippedCount, 5)
  assert.ok(!JSON.stringify(out.body).includes(SENTINEL))
  const broken = await call('POST', '/api/launcher/import', `{"data": "${SENTINEL}`)
  assert.equal(broken.code, 400)
  assert.ok(!JSON.stringify(broken.body).includes(SENTINEL))
})

test('export: a documented file that imports back unchanged, with no ids or usage', async () => {
  const dir = tempDir()
  const a = client()
  await a.call('POST', '/api/launcher/import', { data: { links: [{ name: 'W', url: 'https://a.example/' }, { name: 'F', kind: 'folder', path: dir }, { name: 'O', kind: 'obsidian', url: 'obsidian://open?vault=V' }], snippets: SNIPPETS } })
  await a.call('POST', '/api/launcher/import', { data: { links: [{ name: 'F', kind: 'folder', path: dir }, { name: 'O', kind: 'obsidian', url: 'obsidian://open?vault=V' }] }, allowLocal: true })
  await a.call('POST', '/api/launcher/use', { key: 'tab:home' })
  const out = await a.call('GET', '/api/launcher/export')
  assert.match(out.headers['content-disposition'], /attachment/)
  const file = JSON.parse(out.raw)
  assert.equal(file.format, FORMAT)
  assert.equal(file.version, 1)
  assert.equal(file.usage, undefined)
  for (const item of [...file.links, ...file.snippets]) assert.equal(item.id, undefined)
  const b = client()
  const back = await b.call('POST', '/api/launcher/import', { data: file, allowLocal: true })
  assert.deepEqual(back.body.added, { links: 3, snippets: 2 })
  assert.equal(back.body.skippedCount, 0)
  const strip = lib => ({ links: lib.links.map(({ id, ...x }) => x), snippets: lib.snippets.map(({ id, ...x }) => x) })
  assert.deepEqual(strip((await b.call('GET', '/api/launcher/library')).body), strip((await a.call('GET', '/api/launcher/library')).body))
})

/* ---------- the routes ---------- */

test('links and snippets: add, edit, delete, and they survive a restart', async () => {
  const c = client()
  const link = (await c.call('POST', '/api/launcher/links', { name: 'One', url: 'https://one.example/' })).body
  const snip = (await c.call('POST', '/api/launcher/snippets', { name: 'S', text: 'body', keyword: 'kw' })).body
  assert.equal((await c.call('PUT', `/api/launcher/links/${link.id}`, { name: 'Two', url: 'https://two.example/' })).body.name, 'Two')
  assert.equal((await c.call('PUT', `/api/launcher/links/${link.id}`, { name: 'Bad', url: 'javascript:alert(1)' })).code, 400)
  assert.equal((await c.call('PUT', `/api/launcher/snippets/${snip.id}`, { name: 'S', text: 'new', keyword: 'kw' })).body.text, 'new')
  assert.equal((await c.call('POST', '/api/launcher/snippets', { name: 'T', text: 'x', keyword: 'kw' })).code, 409)
  const again = client({ here: c.here })
  const lib = (await again.call('GET', '/api/launcher/library')).body
  assert.equal(lib.links[0].name, 'Two')
  assert.equal(lib.snippets[0].text, 'new')
  assert.equal((await again.call('GET', '/api/launcher/snippets')).body.snippets[0].keyword, 'kw')
  assert.equal((await again.call('DELETE', `/api/launcher/links/${link.id}`)).code, 200)
  assert.equal((await again.call('DELETE', `/api/launcher/links/${link.id}`)).code, 404)
  assert.equal((await again.call('DELETE', `/api/launcher/snippets/${snip.id}`)).code, 200)
  assert.deepEqual((await client({ here: c.here }).call('GET', '/api/launcher/library')).body.links, [])
})

test('library: a broken data file is kept aside and never stops the hub', async () => {
  const here = tempDir()
  fs.mkdirSync(path.join(here, 'data'))
  const file = path.join(here, 'data', 'launcher.json')
  fs.writeFileSync(file, '{ this is not json')
  const c = client({ here })
  const lib = (await c.call('GET', '/api/launcher/library')).body
  assert.deepEqual(lib.links, [])
  assert.match(lib.warning, /damaged/)
  assert.ok(fs.readdirSync(path.join(here, 'data')).some(f => /^launcher\.damaged-/.test(f)))
})

test('library: a data file edited by hand goes through the same gate', async () => {
  const here = tempDir()
  fs.mkdirSync(path.join(here, 'data'))
  fs.writeFileSync(path.join(here, 'data', 'launcher.json'), JSON.stringify({
    links: [{ id: 'evil', name: 'x', kind: 'web', url: 'javascript:alert(1)' }, { id: 'good', name: 'y', url: 'https://a.example/' }, { id: 'share', name: 'z', kind: 'folder', path: '\\\\server\\share' }, { id: 'keys', name: 'k', kind: 'folder', path: path.join(os.homedir(), '.ssh') }],
    snippets: [{ id: 'ok', name: 'n', text: 't' }, { id: 'none', name: 'n' }],
    usage: { 'link:good': { n: 2, at: 5 }, '<script>': { n: 1, at: 1 }, 'link:bad': 'x' },
  }))
  const lib = (await client({ here }).call('GET', '/api/launcher/library')).body
  assert.deepEqual(lib.links.map(l => l.id), ['good'])
  assert.deepEqual(lib.snippets.map(s => s.id), ['ok'])
  assert.deepEqual(Object.keys(lib.usage), ['link:good'])
  assert.match(lib.warning, /4 saved items/)
  assert.ok(fs.readdirSync(path.join(here, 'data')).some(f => /^launcher\.invalid-/.test(f)))
})

test('open: only saved folder and Obsidian links, on this computer, through the opener', async () => {
  const opened = []
  const openers = { folder: p => opened.push(['folder', p]), url: u => opened.push(['url', u]) }
  const here = tempDir()
  const dir = path.join(here, 'a folder')
  fs.mkdirSync(dir)
  const c = client({ here, openers })
  await c.call('POST', '/api/launcher/import', { data: { links: [{ name: 'F', kind: 'folder', path: dir }, { name: 'O', kind: 'obsidian', url: 'obsidian://open?vault=V' }, { name: 'W', url: 'https://a.example/' }, { name: 'G', kind: 'folder', path: path.join(here, 'gone') }] }, allowLocal: true })
  const { links } = (await c.call('GET', '/api/launcher/library')).body
  const id = name => links.find(l => l.name === name).id
  assert.equal((await c.call('POST', '/api/launcher/open', { id: id('F') })).code, 200)
  assert.equal((await c.call('POST', '/api/launcher/open', { id: id('O') })).code, 200)
  assert.deepEqual(opened, [['folder', path.normalize(dir)], ['url', 'obsidian://open?vault=V']])
  opened.length = 0
  assert.equal((await c.call('POST', '/api/launcher/open', { id: id('W') })).code, 400)
  assert.equal((await c.call('POST', '/api/launcher/open', { id: id('G') })).code, 404)
  assert.equal((await c.call('POST', '/api/launcher/open', { id: 'nope' })).code, 404)
  assert.equal((await c.call('POST', '/api/launcher/open', { path: dir })).code, 404, 'an address from the page opens nothing')
  assert.equal((await c.call('POST', '/api/launcher/open', { id: id('F') }, '192.168.1.5')).code, 409)
  // A loopback socket isn't enough: a page pointing its own name here, or a proxy, is someone else.
  assert.equal((await c.call('POST', '/api/launcher/open', { id: id('F') }, '127.0.0.1', { host: 'evil.example' })).code, 409)
  assert.equal((await c.call('POST', '/api/launcher/open', { id: id('F') }, '127.0.0.1', { host: 'localhost', 'x-forwarded-for': '203.0.113.9' })).code, 409)
  const remote = await c.call('POST', '/api/launcher/open', { id: id('O') }, '192.168.1.5')
  assert.equal(remote.body.open, 'obsidian://open?vault=V')
  assert.deepEqual(opened, [], 'nothing opened on this computer')
})

test('open: a folder that became a link to a key folder is refused by its real path', { skip: process.platform !== 'win32' && 'junctions are Windows only' }, async () => {
  const opened = []
  const here = tempDir()
  const keys = path.join(here, '.ssh')
  const door = path.join(here, 'door')
  fs.mkdirSync(keys)
  fs.symlinkSync(keys, door, 'junction')
  const c = client({ here, openers: { folder: p => opened.push(p), url: () => {} } })
  const link = (await c.call('POST', '/api/launcher/links', { name: 'door', kind: 'folder', path: door })).body
  assert.equal((await c.call('POST', '/api/launcher/open', { id: link.id })).code, 403)
  assert.deepEqual(opened, [])
})

test('use: only known kinds of key count', async () => {
  const c = client()
  assert.equal((await c.call('POST', '/api/launcher/use', { key: 'link:abc-1' })).code, 200)
  for (const key of ['<script>', 'link:', 'other:abc', 'link:a b', 5, '__proto__']) assert.equal((await c.call('POST', '/api/launcher/use', { key })).code, 400, String(key))
  assert.deepEqual(Object.keys((await c.call('GET', '/api/launcher/library')).body.usage), ['link:abc-1'])
})

test('routes: other paths are left alone and the standalone page carries its CSP', async () => {
  const here = tempDir()
  fs.writeFileSync(path.join(here, 'launcher.html'), '<!doctype html>')
  const c = client({ here })
  assert.equal((await c.call('GET', '/something-else')).handled, false)
  assert.equal((await c.call('POST', '/launcher')).handled, false)
  const page = await c.call('GET', '/launcher')
  assert.match(page.headers['content-security-policy'], /script-src 'self'/)
  assert.doesNotMatch(page.headers['content-security-policy'], /script-src[^;]*unsafe/)
  assert.equal((await c.call('GET', '/api/launcher/nope')).code, 404)
})

test('errors: a snippet in a bad request is never echoed back', async () => {
  const c = client()
  for (const body of [{ name: `${SENTINEL} name`.repeat(40), text: SENTINEL }, { name: 'n', text: SENTINEL, keyword: `${SENTINEL} two words` }, `{ "text": "${SENTINEL}`]) {
    const out = await c.call('POST', '/api/launcher/snippets', body)
    assert.equal(out.code, 400)
    assert.ok(!JSON.stringify(out.body).includes(SENTINEL))
  }
})

test('readImport sorts each accepted shape', () => {
  assert.equal(readImport([{ name: 'a', link: 'x' }]).links.length, 1)
  assert.equal(readImport({ name: 'a', text: 't' }).snippets.length, 1)
  assert.equal(readImport({ links: [{ url: 'x' }], snippets: [{ text: 't' }] }).snippets.length, 1)
  assert.equal(readImport({ quicklinks: [{ link: 'x' }] }).links.length, 1)
  assert.equal(readImport({ other: 1 }).skipped.length, 1)
})
