// The connection logic against a scripted port and a fake child process, including the rule that
// matters most: nothing but our own child is ever stopped.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { HubConnection, probeHub } from '../../src/hub-connection.js'
import http from 'node:http'
import { freePort, sleep, waitFor } from '../helpers.mjs'

class FakeChild extends EventEmitter {
  exitCode = null
  signalCode = null
  constructor(pid) { super(); this.pid = pid }
  die() { this.exitCode = 1; this.emit('exit', 1) }
}

function setup({ answers = () => 'none', spawnable = true } = {}) {
  const spawned = []
  const stopped = []
  const states = []
  const connection = new HubConnection({
    port: 4242,
    probe: async () => answers(),
    pollMs: 10,
    offlinePollMs: 10,
    stopTree: async pid => {
      stopped.push(pid)
      spawned.find(child => child.pid === pid)?.die()
    },
    spawnHub: () => {
      if (!spawnable) return null
      const child = new FakeChild(1000 + spawned.length)
      spawned.push(child)
      return child
    },
  })
  connection.on('state', state => states.push({ ...state }))
  return { connection, spawned, stopped, states }
}

test('a Hub already answering is attached to, no child starts, and stop leaves it alone', async () => {
  const { connection, spawned, stopped } = setup({ answers: () => 'hub' })
  await connection.start()
  assert.deepEqual(connection.state, { status: 'online', mode: 'attached', reason: null })
  await connection.stop()
  assert.equal(spawned.length, 0)
  assert.equal(stopped.length, 0)
})

test('with nothing answering it starts one child, and stop stops exactly that child', async () => {
  let port = 'none'
  const { connection, spawned, stopped } = setup({ answers: () => port })
  await connection.start()
  assert.equal(spawned.length, 1)
  assert.equal(connection.state.mode, 'bundled')
  port = 'hub'
  await waitFor(() => connection.state.status === 'online', 'online')
  assert.equal(connection.state.mode, 'bundled')
  await connection.stop()
  assert.deepEqual(stopped, [1000])
})

test('another program on the port is never attached to and never triggers a spawn', async () => {
  const { connection, spawned } = setup({ answers: () => 'other' })
  await connection.start()
  assert.deepEqual(connection.state, { status: 'conflict', mode: null, reason: 'port-conflict' })
  await sleep(50)
  await connection.stop()
  assert.equal(spawned.length, 0)
})

test('no server to start says so', async () => {
  const { connection } = setup({ spawnable: false })
  await connection.start()
  assert.deepEqual(connection.state, { status: 'offline', mode: null, reason: 'no-server' })
  await connection.stop()
})

test('login grace waits before starting a child, then starts one', async () => {
  const { connection, spawned } = setup()
  await connection.start({ graceMs: 120 })
  assert.equal(spawned.length, 0)
  assert.equal(connection.state.status, 'connecting')
  await waitFor(() => spawned.length === 1, 'a child after the grace', 2000)
  await connection.stop()
})

test('a Hub that answers during the grace is attached to, with no child', async () => {
  let port = 'none'
  const { connection, spawned } = setup({ answers: () => port })
  await connection.start({ graceMs: 5000 })
  port = 'hub'
  await waitFor(() => connection.state.status === 'online', 'online', 2000)
  assert.equal(connection.state.mode, 'attached')
  assert.equal(spawned.length, 0)
  await connection.stop()
})

test('an attached Hub going away waits for it, and never starts a child by itself', async () => {
  let port = 'hub'
  const { connection, spawned } = setup({ answers: () => port })
  await connection.start()
  port = 'none'
  await waitFor(() => connection.state.status === 'offline', 'offline', 2000)
  assert.equal(connection.state.reason, 'hub-stopped')
  await sleep(50)
  assert.equal(spawned.length, 0)
  port = 'hub'
  await waitFor(() => connection.state.status === 'online', 'back online', 2000)
  assert.equal(connection.state.mode, 'attached')
  await connection.stop()
})

test('asking for the built-in Hub after an attached one went away starts a child', async () => {
  let port = 'hub'
  const { connection, spawned } = setup({ answers: () => port })
  await connection.start()
  assert.equal(connection.useBundled(), false, 'refused while a Hub is answering')
  port = 'none'
  await waitFor(() => connection.state.status === 'offline', 'offline', 2000)
  assert.equal(connection.useBundled(), true)
  await waitFor(() => spawned.length === 1, 'child', 2000)
  await connection.stop()
})

test('our child crashing restarts it after a backoff', async () => {
  const { connection, spawned } = setup()
  await connection.start()
  spawned[0].die()
  assert.equal(connection.ownsHub, false)
  await waitFor(() => connection.state.reason === 'restarting', 'restarting state', 500)
  await waitFor(() => spawned.length === 2, 'a second child', 3000)
  await connection.stop()
})

test('if another Hub took the port after our child died, it counts as attached and is left alone', async () => {
  let port = 'none'
  const { connection, spawned, stopped } = setup({ answers: () => port })
  await connection.start()
  port = 'hub'
  spawned[0].die()
  await waitFor(() => connection.state.mode === 'attached', 'attached', 2000)
  await connection.stop()
  assert.equal(stopped.length, 0)
  assert.equal(spawned.length, 1)
})

test('changing port stops our child and looks again on the new port', async () => {
  const { connection, spawned, stopped } = setup()
  await connection.start()
  await connection.setPort(4343)
  assert.deepEqual(stopped, [1000])
  assert.equal(connection.port, 4343)
  assert.equal(connection.origin, 'http://localhost:4343')
  assert.equal(spawned.length, 2)
  await connection.stop()
})

test('probeHub reads the body, not just the status code', async t => {
  const port = await freePort()
  let reply = { code: 200, body: '{"ok":true}' }
  const server = http.createServer((req, res) => { res.writeHead(reply.code); res.end(reply.body) })
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  t.after(() => server.close())
  assert.equal(await probeHub(port), 'hub')
  reply = { code: 200, body: '<html>some other app</html>' }
  assert.equal(await probeHub(port), 'other')
  reply = { code: 200, body: '{"ok":false}' }
  assert.equal(await probeHub(port), 'other')
  reply = { code: 404, body: '{"ok":true}' }
  assert.equal(await probeHub(port), 'other')
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  assert.equal(await probeHub(port), 'none')
})
