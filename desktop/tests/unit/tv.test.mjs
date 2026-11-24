import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import { test } from 'node:test'

import { TvStatus, linkFrom, readStatus } from '../../src/tv.js'

test('only one ordinary web link goes to the TV', () => {
  assert.equal(linkFrom(' https://example.com/x '), 'https://example.com/x')
  for (const bad of ['', null, 'hello', 'file:///c:/x', 'javascript:alert(1)', 'https://me:pw@example.com/', 'https://a.com https://b.com', 'https://a.com/' + 'x'.repeat(3000)]) assert.equal(linkFrom(bad), null, String(bad))
})

test('an older Hub has no TV part', () => {
  assert.equal(readStatus({ tvs: true }), null)
  assert.deepEqual(readStatus({ tv: { on: true, setUp: true, apps: ['Netflix', 3] }, listen: { on: true } }), { on: true, setUp: true, apps: ['Netflix'], listening: true })
})

test('it follows the Hub and sends commands', async () => {
  const got = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c }).on('end', () => {
      got.push([req.method, req.url, req.headers['x-hub'], body])
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true, tv: { on: true, setUp: true, apps: [] }, listen: { on: false } }))
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const connection = Object.assign(new EventEmitter(), { origin: `http://127.0.0.1:${server.address().port}`, state: { status: 'offline' } })
  const tv = new TvStatus({ connection })
  try {
    tv.start()
    assert.equal(got.length, 0, 'a Hub that is down is not asked')
    connection.state.status = 'online'
    const up = new Promise(r => tv.once('state', r))
    connection.emit('state', connection.state)
    assert.equal((await up).on, true)
    assert.equal(await tv.command({ type: 'home' }), true)
    assert.deepEqual(got.at(-1), ['POST', '/api/tv/command', '1', '{"type":"home"}'])
    connection.state.status = 'offline'
    const down = new Promise(r => tv.once('state', r))
    connection.emit('state', connection.state)
    assert.equal(await down, null)
  } finally {
    tv.stop()
    server.close()
  }
})
