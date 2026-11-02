// The connection logic against a scripted port and a fake child process, including the rule that
// matters most: nothing but our own child is ever stopped.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test, { afterEach } from 'node:test'

import { HubConnection, probeHub } from '../../src/hub-connection.js'
import { listenersIn } from '../../src/platform/windows.js'
import http from 'node:http'
import net from 'node:net'
import { freePort, sleep, waitFor } from '../helpers.mjs'

class FakeChild extends EventEmitter {
  exitCode = null
  signalCode = null
  constructor(pid) { super(); this.pid = pid }
  die() { this.exitCode = 1; this.emit('exit', 1) }
  kill() { this.killed = true; this.die() }
}

// A test that fails before its own stop would otherwise leave the loop running and the run would never end.
const running = new Set()
afterEach(async () => {
  await Promise.all([...running].map(connection => connection.stop()))
  running.clear()
})

function setup({ answers = () => 'none', holders = () => [], spawnable = true, startTimeoutMs } = {}) {
  const spawned = []
  const stopped = []
  const states = []
  const connection = new HubConnection({
    port: 4242,
    probe: async () => answers(),
    portHolders: async () => holders(),
    isAlive: () => true,
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
  running.add(connection)
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

test('a silent attached Hub stays up as busy, is never replaced, and only goes offline once it has gone', async () => {
  let port = 'hub'
  const { connection, spawned, stopped, states } = setup({ answers: () => port, startTimeoutMs: 20 })
  await connection.start()
  port = 'silent'
  await waitFor(() => connection.state.reason === 'slow', 'busy', 2000)
  await sleep(80)
  assert.deepEqual(connection.state, { status: 'online', mode: 'attached', reason: 'slow' })
  assert.equal(states.some(state => state.status !== 'online'), false, 'its page was never at risk')
  assert.equal(spawned.length, 0)
  assert.equal(stopped.length, 0)
  port = 'hub'
  await waitFor(() => connection.state.reason === null, 'answering again', 2000)
  port = 'none'
  await waitFor(() => connection.state.status === 'offline', 'offline', 2000)
  assert.equal(connection.state.reason, 'hub-stopped')
  port = 'silent'
  await sleep(50)
  assert.equal(connection.state.status, 'offline', 'gone first, so something silent now is not that Hub being busy')
  await connection.stop()
})

test('a child listening but too slow to answer is never stopped, and its page can load', async () => {
  let port = 'none'
  let listening = []
  const { connection, spawned, stopped } = setup({ answers: () => port, holders: () => listening, startTimeoutMs: 30 })
  await connection.start()
  listening = [1000]
  port = 'silent'
  await waitFor(() => connection.state.status === 'online', 'online', 2000)
  assert.deepEqual(connection.state, { status: 'online', mode: 'bundled', reason: 'slow' })
  await sleep(200)
  assert.deepEqual(stopped, [], 'many times the timeout, and it holds the port')
  assert.equal(spawned.length, 1)
  await connection.stop()
  assert.deepEqual(stopped, [1000], 'quit still stops it')
})

test('a child listening that answers wrongly is kept, and the page says it is not answering', async () => {
  const { connection, stopped } = setup({
    answers: () => (connection.ownsHub ? 'other' : 'none'),
    holders: () => (connection.ownsHub ? [1000] : []),
    startTimeoutMs: 20,
  })
  await connection.start()
  await waitFor(() => connection.state.reason === 'not-answering', 'not answering', 2000)
  await sleep(80)
  assert.deepEqual(stopped, [])
  await connection.stop()
})

test('when it cannot tell who holds the port, nothing is stopped', async () => {
  const { connection, stopped, spawned } = setup({ holders: () => null, startTimeoutMs: 20 })
  await connection.start()
  assert.equal(spawned.length, 1)
  await sleep(150)
  assert.deepEqual(stopped, [])
  assert.equal(connection.state.reason, 'not-answering')
  await connection.stop()
})

test('each try at starting gets twice as long, then it stops trying and says so until asked', async () => {
  const startedAt = []
  const stoppedAfter = []
  const { connection, spawned, stopped } = setup({ startTimeoutMs: 100 })
  const spawnHub = connection.spawnHub
  connection.spawnHub = port => { startedAt.push(Date.now()); return spawnHub(port) }
  const stopTree = connection.stopTree
  connection.stopTree = pid => { stoppedAfter.push(Date.now() - startedAt.at(-1)); return stopTree(pid) }
  await connection.start()
  await waitFor(() => connection.state.reason === 'start-failed', 'giving up', 12_000)
  assert.equal(spawned.length, 3)
  assert.deepEqual(stopped, [1000, 1001, 1002])
  assert.ok(stoppedAfter[0] >= 100 && stoppedAfter[1] >= 200 && stoppedAfter[2] >= 400, JSON.stringify(stoppedAfter))
  assert.deepEqual(connection.state, { status: 'offline', mode: 'bundled', reason: 'start-failed' })
  await sleep(1500)
  assert.equal(spawned.length, 3, 'no more tries by itself')
  connection.retry()
  await waitFor(() => spawned.length === 4, 'try again to start one', 2000)
  await connection.stop()
})

test('a slow start that answers on a later try is kept, and later trouble gets all three tries again', async () => {
  let port = 'none'
  const { connection, spawned, stopped } = setup({ answers: () => port, startTimeoutMs: 60 })
  await connection.start()
  await waitFor(() => spawned.length === 2, 'a second try', 3000)
  port = 'hub'
  await waitFor(() => connection.state.status === 'online', 'online', 2000)
  assert.deepEqual(stopped, [1000])
  port = 'none'
  await waitFor(() => spawned.length === 3, 'a third child', 3000)
  await waitFor(() => spawned.length === 4, 'a fourth, because the count started over', 6000)
  await connection.stop()
})

test('a program holding the port that drops every connection still counts: no child until it leaves', async () => {
  let holding = [4444]
  const { connection, spawned } = setup({ answers: () => 'none', holders: () => holding })
  await connection.start()
  assert.deepEqual(connection.state, { status: 'conflict', mode: null, reason: 'port-silent' })
  await sleep(50)
  assert.equal(spawned.length, 0)
  holding = []
  await waitFor(() => spawned.length === 1, 'a child', 2000)
  await connection.stop()
})

test('listenersIn reads netstat, by the foreign port so any language works, on local addresses only', () => {
  const text = [
    'Active Connections',
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    127.0.0.1:3100         0.0.0.0:0              LISTENING       11',
    '  TCP    0.0.0.0:3100           0.0.0.0:0              ABHÖREN         12',
    '  TCP    [::1]:3100             [::]:0                 LISTENING       13',
    '  TCP    [::]:3100              [::]:0                 LISTENING       14',
    '  TCP    192.0.2.9:3100         0.0.0.0:0              LISTENING       15',
    '  TCP    127.0.0.1:31000        0.0.0.0:0              LISTENING       16',
    '  TCP    127.0.0.1:13100        0.0.0.0:0              LISTENING       19',
    '  TCP    127.0.0.1:3100         127.0.0.1:50000        ESTABLISHED     17',
    '  TCP    127.0.0.1:50000        127.0.0.1:3100         TIME_WAIT       0',
    '  UDP    127.0.0.1:3100         *:*                                    18',
    '  TCP    127.0.0.1:3100         0.0.0.0:0              LISTENING       11',
  ].join('\r\n')
  assert.deepEqual(listenersIn(text, 3100), [11, 12, 13, 14])
  assert.deepEqual(listenersIn(text, 3101), [])
})

test('a child that never answers is stopped after the timeout and a new one starts', async () => {
  const { connection, spawned, stopped } = setup({ startTimeoutMs: 400 })
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

test('a child stuck behind another program is stopped at once, and only replaced once the port is free', async () => {
  let port = 'none'
  let holding = []
  const { connection, spawned, stopped } = setup({ answers: () => port, holders: () => holding })
  await connection.start()
  assert.equal(spawned.length, 1)
  port = 'other'
  holding = [4444]
  await waitFor(() => stopped.includes(1000), 'the stuck child to be stopped', 2000)
  await sleep(1200)
  assert.equal(spawned.length, 1, 'no new child while the port is taken')
  assert.equal(connection.state.status, 'conflict')
  port = 'none'
  holding = []
  await waitFor(() => spawned.length === 2, 'a new child', 3000)
  await connection.stop()
})

test('a child stuck behind another program is only asked to stop once, however long that takes', async () => {
  const stopped = []
  const child = Object.assign(new EventEmitter(), { pid: 7, exitCode: null, signalCode: null })
  const connection = new HubConnection({
    port: 4242, pollMs: 10, offlinePollMs: 10,
    probe: async () => (connection.ownsHub ? 'other' : 'none'),
    portHolders: async () => (connection.ownsHub ? [4444] : []),
    stopTree: async pid => { stopped.push(pid) },
    spawnHub: () => child,
  })
  running.add(connection)
  await connection.start()
  await sleep(120)
  assert.deepEqual(stopped, [7])
  child.exitCode = 1
  child.emit('exit', 1)
})

test('a stop that takes a while is only asked for once per timeout', async () => {
  const stopped = []
  const child = Object.assign(new EventEmitter(), { pid: 7, exitCode: null, signalCode: null })
  const connection = new HubConnection({
    port: 4242, pollMs: 10, offlinePollMs: 10, startTimeoutMs: 100,
    probe: async () => 'none',
    portHolders: async () => [],
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

test('stop has a limit: a tree stop that never ends and a Hub that never goes can\'t hold it', async () => {
  const { connection, spawned } = setup({ answers: () => 'none' })
  await connection.start()
  await waitFor(() => spawned.length === 1, 'the child')
  connection.stopTree = () => new Promise(() => {})
  const startedAt = Date.now()
  await connection.stop({ limitMs: 100 })
  const took = Date.now() - startedAt
  assert.ok(took >= 90 && took < 2000, `took ${took} ms`)
  assert.equal(spawned[0].killed, undefined, 'the tree stop is still running, so the Hub is left for it')
})

test('stop goes on once the system says the Hub has gone, though no exit event has come', async () => {
  const { connection, spawned } = setup({ answers: () => 'none' })
  await connection.start()
  await waitFor(() => spawned.length === 1, 'the child')
  let alive = true
  connection.isAlive = () => alive
  connection.stopTree = () => { alive = false; return new Promise(() => {}) }
  const startedAt = Date.now()
  await connection.stop({ limitMs: 5000 })
  assert.ok(Date.now() - startedAt < 2000, `it waited ${Date.now() - startedAt} ms`)
})

test('a tree stop that finishes with the Hub still here has failed, so the Hub is ended directly', async () => {
  const { connection, spawned } = setup({ answers: () => 'none' })
  await connection.start()
  await waitFor(() => spawned.length === 1, 'the child')
  connection.stopTree = async () => {}
  const startedAt = Date.now()
  await connection.stop({ limitMs: 5000 })
  assert.equal(spawned[0].killed, true)
  assert.ok(Date.now() - startedAt < 2000, 'and stop doesn\'t wait out its limit')
})
