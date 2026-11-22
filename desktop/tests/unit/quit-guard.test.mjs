// The process that ends the app if it's slow to go, against a real process standing in for the app.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test, { afterEach } from 'node:test'

import { processAlive, sleep, waitFor } from '../helpers.mjs'

const GUARD = fileURLToPath(new URL('../../src/quit-guard.mjs', import.meta.url))

const started = []
afterEach(() => {
  for (const child of started.splice(0)) child.kill()
})

function dummy() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
  started.push(child)
  return child
}

function guard(pid, afterMs) {
  const child = spawn(process.execPath, [GUARD, pid, afterMs].map(String), { stdio: 'ignore', windowsHide: true })
  started.push(child)
  return new Promise(resolve => child.once('exit', resolve))
}

const orStayed = exited => Promise.race([exited, sleep(5000).then(() => { throw new Error('the guard stayed') })])

test('gives the app its time, ends it after that and then leaves', async () => {
  const main = dummy()
  const exited = guard(main.pid, 1500)
  await sleep(700)
  assert.ok(processAlive(main.pid), 'the app gets its time')
  await waitFor(() => !processAlive(main.pid), 'the app to be ended', 5000)
  await orStayed(exited)
})

test('an app that left by itself ends nothing and the guard leaves at once', async () => {
  const main = dummy()
  const exited = guard(main.pid, 60_000)
  await sleep(500)
  main.kill()
  await orStayed(exited)
})
