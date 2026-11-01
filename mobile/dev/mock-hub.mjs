// A stand-in Hub for trying the shell in a browser, using the real pairing module. It allows any origin
// because a browser needs that; the real Hub never does, and the app doesn't need it to.
//
//   node dev/mock-hub.mjs [port]
//
// Test controls, local to this mock:
//   POST /__mock { answer: 503 }        every other route answers with that status
//   POST /__mock { down: true }         connections are dropped
//   POST /__mock { dropSends: true }    chat sends are dropped mid-request
//   POST /__mock { answer: null, down: false, dropSends: false }
//   GET  /__mock                        { sends, devices }
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDeviceAuth, isLocal } from '../../device-auth.mjs'

export async function startMockHub(port = 3155, { name = 'Mock Hub', url = '' } = {}) {
  const here = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-hub-'))
  const auth = createDeviceAuth({ here, hubName: () => name, hubUrl: () => url })
  const mock = { answer: null, down: false, dropSends: false }
  const sends = []

  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(type === 'application/json' ? JSON.stringify(body) : body)
  }
  const readBody = async req => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    return raw ? JSON.parse(raw) : {}
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', req.headers.origin || '*')
    res.setHeader('access-control-allow-headers', 'authorization, x-hub, content-type')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    const url = new URL(req.url, `http://${req.headers.host}`)
    try {
      if (url.pathname === '/__mock') {
        if (req.method === 'POST') Object.assign(mock, await readBody(req))
        return send(res, 200, { sends })
      }
      if (mock.down) return req.socket.destroy()
      if (mock.answer) return send(res, mock.answer, { error: 'mock' })
      if (req.method !== 'GET' && req.headers['x-hub'] !== '1') return send(res, 403, { error: 'missing x-hub header' })
      // Closed like the Hub's own gate with no passcode set.
      if (!auth.admit(url, req, res) && !isLocal(req)) return url.pathname === '/' ? send(res, 403, '<!doctype html><title>Closed</title>', 'text/html; charset=utf-8') : send(res, 401, { error: 'This hub needs its passcode' })
      if (await auth.route(url, req, res, { send })) return
      if (url.pathname === '/api/chat/send' && req.method === 'POST') {
        const body = await readBody(req)
        if (mock.dropSends) return req.socket.destroy()
        sends.push(body)
        return send(res, 200, '{"type":"session","sessionId":"mock"}\n', 'application/x-ndjson')
      }
      if (url.pathname === '/') return send(res, 200, '<!doctype html><title>Mock Hub</title><h1>Mock Hub</h1>', 'text/html; charset=utf-8')
      send(res, 404, { error: 'not found' })
    } catch (e) {
      send(res, 500, { error: e.message })
    }
  })
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  return {
    port,
    base: `http://localhost:${port}`,
    stop: () => {
      server.closeAllConnections()
      server.close()
      fs.rmSync(here, { recursive: true, force: true })
    },
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 3155)
  await startMockHub(port)
  console.log(`Mock Hub on http://localhost:${port}. Make a code at http://localhost:${port}/pair/new`)
}
