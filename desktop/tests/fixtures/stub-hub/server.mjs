// A stand-in for the Hub server with the parts the desktop app depends on: /api/ping, the x-hub
// check, an optional /launcher route, helper launches through process.execPath, and a child process
// of its own so a tree stop can be seen to work.
import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.HUB_PORT || 3100)

const grandchild = process.env.STUB_GRANDCHILD === '1'
  // Detached like the real Hub's browser: Windows won't end it just because its parent exits, so only
  // a real tree stop can.
  // The variable matters in a packaged run, where the Hub's environment is clean: without it this
  // would be a second full copy of the app, with a window, on the default profile.
  ? spawn(process.execPath, [path.join(HERE, 'keep-alive.mjs')], { stdio: 'ignore', windowsHide: true, detached: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  : null

const page = `<!doctype html><html><head><title>Stub Hub</title></head><body>
<h1 id="marker">stub hub on ${PORT}</h1>
<a id="link" href="${process.env.STUB_FOREIGN ?? 'https://example.invalid'}/from-link">leave</a>
<a id="blank" target="_blank" href="${process.env.STUB_FOREIGN ?? 'https://example.invalid'}/from-blank">leave in a new tab</a>
<a id="redirect" href="/redirect">redirect away</a>
<a id="popup" target="_blank" href="/?popup=1">same-origin popup</a>
</body></html>`

const json = (res, code, value) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function runHelper(res) {
  // The way the real Hub starts its MCP helpers: its own execPath and a bare environment.
  const helper = spawn(process.execPath, [path.join(HERE, 'helper.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], env: { HUB_PORT: String(PORT) }, windowsHide: true })
  let out = ''
  let err = ''
  const timer = setTimeout(() => { helper.kill(); json(res, 200, { ok: false, out, err, error: 'timeout' }) }, 20_000)
  helper.stdout.on('data', chunk => { out += chunk })
  helper.stderr.on('data', chunk => { err += chunk })
  helper.on('error', error => { clearTimeout(timer); json(res, 200, { ok: false, error: error.message }) })
  helper.on('close', code => { clearTimeout(timer); json(res, 200, { ok: code === 0 && out.trim() === 'echo:ping', code, out: out.trim(), err: err.trim() }) })
  helper.stdin.end('ping')
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-hub'] !== '1') return json(res, 403, { error: 'missing x-hub header' })
  if (url.pathname === '/api/ping') return json(res, 200, { ok: true })
  if (url.pathname === '/api/pid') return json(res, 200, { pid: process.pid, grandchild: grandchild?.pid ?? null, port: PORT })
  if (url.pathname === '/api/env') return json(res, 200, { runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null })
  if (url.pathname === '/api/write') return json(res, 200, { wrote: true })
  if (url.pathname === '/api/helper') return runHelper(res)
  if (url.pathname === '/redirect') {
    res.writeHead(302, { location: `${process.env.STUB_FOREIGN ?? 'https://example.invalid'}/from-redirect` })
    return res.end()
  }
  if (url.pathname === '/launcher' && process.env.STUB_LAUNCHER !== '1') return json(res, 404, { error: 'not found' })
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(url.pathname === '/launcher' ? `<!doctype html><title>Stub launcher</title><h1 id="route">launcher route</h1><a id="open" target="_blank" href="/?from=launcher">open</a><input id="box"><script>addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (box.value) box.value = ''; else window.close() })</script>` : page)
}).listen(PORT, '127.0.0.1', () => console.log(`stub hub on ${PORT} pid ${process.pid}`))
