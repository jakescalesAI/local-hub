// The connection logic against a scripted port and a fake child process, including the rule that
// matters most: nothing but our own child is ever stopped.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { HubConnection, probeHub } from '../../src/hub-connection.js'
import http from 'node:http'
import net from 'node:net'
import { freePort, sleep, waitFor } from '../helpers.mjs'

class FakeChild extends EventEmitter {
  exitCode = null
  signalCode = null
  constructor(pid) { super(); this.pid = pid }
  die() { this.exitCode = 1; this.emit('exit', 1) }
}

function setup({ answers = () => 'none', spawnable = true, startTimeoutMs } = {}) {
  const spawned = []
  const stopped = []
  const states = []
  const connection = new HubConnection({
    port: 4242,
    probe: async () => answers(),
    pollMs: 10,
    offlinePollMs: 10,
    startTimeoutMs,
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

test('something silent on the port starts no child, and a child starts once it leaves', async () => {
  let port = 'silent'
  const { connection, spawned } = setup({ answers: () => port })
  await connection.start()
  assert.deepEqual(connection.state, { status: 'conflict', mode: null, reason: 'port-silent' })
  await sleep(50)
  assert.equal(spawned.length, 0)
  port = 'none'
  await waitFor(() => spawned.length === 1, 'a child', 2000)
  await connection.stop()
})

test('a silent attached Hub is waited for, never replaced', async () => {
  let port = 'hub'
  const { connection, spawned, stopped } = setup({ answers: () => port, startTimeoutMs: 20 })
  await connection.start()
  port = 'silent'
  await waitFor(() => connection.state.status === 'offline', 'offline', 2000)
  assert.equal(connection.state.reason, 'hub-stopped')
  await sleep(80)
  assert.equal(spawned.length, 0)
  assert.equal(stopped.length, 0)
  await connection.stop()
})

test('a child that never answers is stopped after the timeout and a new one starts', async () => {
  const { connection, spawned, stopped } = setup({ startTimeoutMs: 60 })
  await connection.start()
  assert.equal(spawned.length, 1)
  await sleep(20)
  assert.deepEqual(stopped, [], 'not before the timeout')
  await waitFor(() => stopped.includes(1000), 'the quiet child to be stopped', 2000)
  await waitFor(() => spawned.length === 2, 'a new child after the backoff', 3000)
  await connection.stop()
})

test('a child that answered gets the full timeout from its first missed check', async () => {
  let port = 'none'
  const { connection, spawned, stopped } = setup({ answers: () => port, startTimeoutMs: 150 })
  await connection.start()
  port = 'hub'
  await waitFor(() => connection.state.status === 'online', 'online', 2000)
  await sleep(200)
  port = 'none'
  await sleep(50)
  assert.deepEqual(stopped, [], 'older than the timeout, but only just went quiet')
  port = 'hub'
  await waitFor(() => connection.state.status === 'online', 'online again', 2000)
  await sleep(200)
  assert.deepEqual(stopped, [], 'it answered again, so nothing was stopped')
  port = 'none'
  await waitFor(() => stopped.includes(1000), 'stopped once it stays quiet', 2000)
  await waitFor(() => spawned.length === 2, 'and replaced', 3000)
  await connection.stop()
})

test('a child stuck behind another program is stopped, and only replaced once the port is free', async () => {
  let port = 'none'
  const { connection, spawned, stopped } = setup({ answers: () => port, startTimeoutMs: 40 })
  await connection.start()
  assert.equal(spawned.length, 1)
  port = 'other'
  await waitFor(() => stopped.includes(1000), 'the stuck child to be stopped', 2000)
  await sleep(1200)
  assert.equal(spawned.length, 1, 'no new child while the port is taken')
  assert.equal(connection.state.status, 'conflict')
  port = 'none'
  await waitFor(() => spawned.length === 2, 'a new child', 3000)
  await connection.stop()
})

test('a stop that takes a while is only asked for once per timeout', async () => {
  const stopped = []
  const child = Object.assign(new EventEmitter(), { pid: 7, exitCode: null, signalCode: null })
  const connection = new HubConnection({
    port: 4242, pollMs: 10, offlinePollMs: 10, startTimeoutMs: 100,
    probe: async () => 'none',
    stopTree: async pid => { stopped.push(pid) },
    spawnHub: () => child,
  })
  await connection.start()
  await sleep(160)
  assert.deepEqual(stopped, [7])
  child.exitCode = 1
  child.emit('exit', 1)
  await connection.stop()
})

test('changing to a port that is held starts nothing until it frees up', async () => {
  let port = 'none'
  const { connection, spawned } = setup({ answers: () => port })
  await connection.start()
  assert.equal(spawned.length, 1)
  port = 'silent'
  await connection.setPort(4343)
  assert.equal(spawned.length, 1)
  assert.equal(connection.state.reason, 'port-silent')
  port = 'none'
  await waitFor(() => spawned.length === 2, 'a child on the new port', 2000)
  await connection.stop()
})

test('probeHub tells an empty port from one that takes the connection and says nothing', async t => {
  const port = await freePort()
  assert.equal(await probeHub(port), 'none')
  const held = []
  const silent = net.createServer(socket => { held.push(socket); socket.on('error', () => {}) })
  await new Promise(resolve => silent.listen(port, '127.0.0.1', resolve))
  t.after(() => { held.forEach(socket => socket.destroy()); silent.close() })
  assert.equal(await probeHub(port, 200), 'silent')
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
