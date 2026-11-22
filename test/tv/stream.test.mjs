// The TV's browsers (stream.mjs): finding Chrome and Chromium on each system, the frame packets, and the
// /api/tv/stream/* routes. The last test drives a real browser when this computer has one, and skips otherwise.
//
//   node --test test/tv/
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { create, chromeCandidates, chromiumCandidates, edgeCandidates, locate, normUrl, packet } from '../../stream.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function send(res, status, body, type) {
  const isText = typeof body === 'string' || Buffer.isBuffer(body)
  res.writeHead(status, { 'content-type': type || (isText ? 'text/plain; charset=utf-8' : 'application/json') })
  res.end(isText ? body : JSON.stringify(body))
}

async function withServer(opts, fn, page = '') {
  const route = create({ here: REPO, ...opts })
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/page') return send(res, 200, page, 'text/html; charset=utf-8')
    if (!(await route(url, req, res, { send }))) send(res, 404, { error: 'not found' })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(base, route)
  } finally {
    route.close()
    server.closeAllConnections?.()
    await new Promise(r => server.close(r))
  }
}
const post = (base, p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, ...(await r.json()) }))

test('Chrome is looked for where each system installs it', () => {
  const win = chromeCandidates({ platform: 'win32', env: { PROGRAMFILES: 'C:\\PF', 'PROGRAMFILES(X86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\U\\AppData\\Local' }, home: 'C:\\U' })
  assert.deepEqual(win, ['C:\\PF\\Google\\Chrome\\Application\\chrome.exe', 'C:\\PF86\\Google\\Chrome\\Application\\chrome.exe', 'C:\\U\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'])
  const mac = chromeCandidates({ platform: 'darwin', env: {}, home: '/Users/u' })
  assert.deepEqual(mac, ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Users/u/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'])
  const linux = chromeCandidates({ platform: 'linux', env: { PATH: '/opt/bin' }, home: '/home/u' })
  assert.ok(linux.includes('/usr/bin/google-chrome-stable'))
  assert.ok(linux.includes('/opt/bin/google-chrome'))
  assert.ok(edgeCandidates({ platform: 'win32', env: {} })[0].endsWith('msedge.exe'))
})

test('Chromium: installed builds first, then the newest Playwright download', () => {
  const list = dir => (dir.endsWith('ms-playwright') ? ['chromium-1105', 'chromium-1200', 'firefox-1400', 'chromium_headless_shell-1200'] : [])
  const linux = chromiumCandidates({ platform: 'linux', env: { PATH: '' }, home: '/home/u', list })
  assert.equal(linux[0], '/usr/bin/chromium')
  const pw = linux.filter(p => p.includes('ms-playwright'))
  assert.equal(pw[0], '/home/u/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome')
  assert.ok(!pw.some(p => p.includes('firefox') || p.includes('headless_shell')))
  const mac = chromiumCandidates({ platform: 'darwin', env: {}, home: '/Users/u', list: () => [] })
  assert.equal(mac[0], '/Applications/Chromium.app/Contents/MacOS/Chromium')
  const win = chromiumCandidates({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\L' }, home: 'C:\\U', list })
  assert.ok(win.includes('C:\\L\\ms-playwright\\chromium-1200\\chrome-win64\\chrome.exe'))
})

test('locate: a setting wins, Chromium borrows Chrome or Edge, and nothing is null', () => {
  const only = (...paths) => p => paths.includes(p)
  const env = { PROGRAMFILES: 'C:\\PF', 'PROGRAMFILES(X86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\L' }
  const chrome = 'C:\\PF\\Google\\Chrome\\Application\\chrome.exe'
  const base = { platform: 'win32', env, home: 'C:\\U', list: () => [], settings: {} }
  assert.deepEqual(locate('chrome', { ...base, exists: only(chrome) }), { exe: chrome, name: 'Google Chrome', real: true })
  assert.deepEqual(locate('chromium', { ...base, exists: only(chrome) }), { exe: chrome, name: 'Chromium', real: false, via: 'Google Chrome' })
  const edge = 'C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe'
  assert.equal(locate('chromium', { ...base, exists: only(edge) }).via, 'Microsoft Edge')
  assert.equal(locate('chrome', { ...base, exists: only(edge) }), null, 'Edge is not Google Chrome')
  assert.equal(locate('chrome', { ...base, exists: () => false }), null)
  assert.equal(locate('chromium', { ...base, exists: only('D:\\c.exe', chrome), settings: { chromium: { path: 'D:\\c.exe' } } }).exe, 'D:\\c.exe')
  assert.equal(locate('firefox', { ...base, exists: () => true }), null)
})

test('an address is a page, and anything else is a search', () => {
  assert.equal(normUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(normUrl('example.com'), 'https://example.com')
  assert.equal(normUrl('localhost:3100/tv/'), 'http://localhost:3100/tv/')
  assert.equal(normUrl('192.168.1.20:8096'), 'http://192.168.1.20:8096')
  assert.equal(normUrl('cat videos'), 'https://www.google.com/search?q=cat%20videos')
  assert.equal(normUrl('', 'https://home.example/'), 'https://home.example/')
  assert.throws(() => normUrl('file:///etc/passwd'), /Only http/)
  assert.throws(() => normUrl('javascript:alert(1)'), /Only http/)
})

test('frame packets: a kind byte, a length, the payload', () => {
  const jpg = Buffer.from([0xff, 0xd8, 1, 2, 3])
  const p = packet(1, jpg)
  assert.equal(p[0], 1)
  assert.equal(p.readUInt32BE(1), 5)
  assert.deepEqual(p.subarray(5), jpg)
  const s = packet(2, { url: 'https://a.example/' })
  assert.equal(s[0], 2)
  assert.deepEqual(JSON.parse(s.subarray(5)), { url: 'https://a.example/' })
})

test('without a browser the routes say so, and refuse what needs one', async () => {
  await withServer({ find: () => null, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-')) }, async base => {
    const st = await (await fetch(`${base}/api/tv/stream/status`)).json()
    assert.equal(st.engines.chrome.available, false)
    assert.match(st.engines.chrome.message, /Google Chrome isn’t installed/)
    assert.equal(st.engines.chromium.available, false)
    const open = await post(base, '/api/tv/stream/open', { engine: 'chrome' })
    assert.equal(open.status, 503)
    assert.match(open.error, /isn’t installed/)
    assert.equal((await post(base, '/api/tv/stream/open', { engine: 'firefox' })).status, 400)
    assert.equal((await post(base, '/api/tv/stream/input', { engine: 'chromium', events: [{ type: 'click', x: 1, y: 1 }] })).status, 409)
    assert.equal((await post(base, '/api/tv/stream/nav', { engine: 'chromium', act: 'back' })).status, 409)
    assert.equal((await post(base, '/api/tv/stream/close', { engine: 'chromium' })).ok, true)
    assert.equal((await fetch(`${base}/api/tv/stream/frames?engine=chromium`)).status, 409)
    assert.equal((await fetch(`${base}/api/tv/stream/nope`)).status, 404)
    const bad = await fetch(`${base}/api/tv/stream/open`, { method: 'POST', body: '{not json' })
    assert.equal(bad.status, 400)
    // Not ours: tv.mjs (or the next route) gets it.
    assert.equal((await fetch(`${base}/api/tv/status`)).status, 404)
  })
})

/** Reads packets from the frames stream until `until` says enough, or the time runs out. */
async function readPackets(base, engine, until, ms = 15000) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  const got = { frames: [], states: [] }
  try {
    const r = await fetch(`${base}/api/tv/stream/frames?engine=${engine}`, { signal: ctl.signal })
    assert.equal(r.status, 200)
    let buf = Buffer.alloc(0)
    for await (const chunk of r.body) {
      buf = Buffer.concat([buf, chunk])
      while (buf.length >= 5 && buf.length >= 5 + buf.readUInt32BE(1)) {
        const len = buf.readUInt32BE(1)
        const body = buf.subarray(5, 5 + len)
        if (buf[0] === 1) got.frames.push(Buffer.from(body))
        else got.states.push(JSON.parse(body))
        buf = buf.subarray(5 + len)
      }
      if (until(got)) break
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e
  } finally {
    clearTimeout(timer)
    ctl.abort()
  }
  return got
}
function jpegSize(j) {
  for (let i = 2; i < j.length;) {
    const mk = j[i + 1], len = j.readUInt16BE(i + 2)
    if (mk >= 0xc0 && mk <= 0xc2) return [j.readUInt16BE(i + 7), j.readUInt16BE(i + 5)]
    i += 2 + len
  }
  return [0, 0]
}

const found = locate('chromium')
// Runs on a real computer. GitHub's Linux runners start the browser but deliver no frames from it (headless there
// has no display to draw), so CI skips it unless LOCALHUB_STREAM_E2E=1 asks for it.
const ciSkip = process.env.CI && process.env.LOCALHUB_STREAM_E2E !== '1' && 'needs a real computer: CI runners deliver no browser frames'
test('a real browser: open, 1920×1080 frames, click a field, type, go back and leave', { skip: (!found && 'no Chromium, Chrome or Edge on this computer') || ciSkip, timeout: 90e3 }, async () => {
  const page = '<title>start</title><body style="margin:0"><input id=q style="position:absolute;left:100px;top:100px;width:400px;height:60px" aria-label="Search">'
    + '<script>q.oninput = () => document.title = "typed " + q.value</script>'
  await withServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-')) }, async base => {
    const open = await post(base, '/api/tv/stream/open', { engine: 'chromium', url: `${base}/page`, key: 'test' })
    assert.equal(open.status, 200, open.error)
    const got = await readPackets(base, 'chromium', g => g.frames.length >= 2 && g.states.length >= 1)
    assert.ok(got.frames.length >= 1, 'a frame arrived')
    assert.deepEqual(jpegSize(got.frames.at(-1)), [1920, 1080])
    assert.equal(got.states[0].width, 1920)

    // The field is at CSS 100..500 × 100..160; at the TV's zoom of 1.5 that's 150..750 × 150..240 on the 1920×1080 screen.
    const click = await post(base, '/api/tv/stream/input', { engine: 'chromium', events: [{ type: 'click', x: 300, y: 195 }] })
    assert.equal(click.focus?.tag, 'input')
    assert.equal(click.focus?.label, 'Search')
    await post(base, '/api/tv/stream/input', { engine: 'chromium', events: [{ type: 'text', text: 'hello tv', replace: true }] })
    const after = await post(base, '/api/tv/stream/input', { engine: 'chromium', events: [{ type: 'focus' }] })
    assert.equal(after.focus?.value, 'hello tv')

    assert.equal((await post(base, '/api/tv/stream/input', { engine: 'chromium', events: [{ type: 'warp' }] })).status, 400)
    assert.equal((await post(base, '/api/tv/stream/nav', { engine: 'chromium', act: 'go', url: 'about:blank' })).ok, true)
    await new Promise(r => setTimeout(r, 500))
    assert.equal((await post(base, '/api/tv/stream/nav', { engine: 'chromium', act: 'back' })).left, undefined, 'back to the page')
    await new Promise(r => setTimeout(r, 500))
    assert.equal((await post(base, '/api/tv/stream/nav', { engine: 'chromium', act: 'back' })).left, true, 'the first page leaves')
    assert.equal((await post(base, '/api/tv/stream/close', { engine: 'chromium' })).ok, true)
  }, page)
})
