// The updater's own logic, with stand-ins for Electron's app and electron-updater.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createUpdater } from '../../src/updater.js'

const fake = () => {
  const au = new EventEmitter()
  au.checks = 0
  au.installs = []
  au.checkForUpdates = async () => { au.checks++; return null }
  au.quitAndInstall = (silent, runAfter) => au.installs.push([silent, runAfter])
  return au
}
const fakeApp = (packaged = true) => ({ isPackaged: packaged, quits: 0, quit() { this.quits++ } })

test('a run from source never updates itself', async () => {
  const u = createUpdater({ app: fakeApp(false), updater: null, tell: () => assert.fail('no notice') })
  assert.equal(u.enabled, false)
  assert.equal(await u.check(), null)
  assert.equal(u.finishOnExit(), false)
  assert.equal(u.installNow(), false)
})

test('a downloaded update says so once, waits for the exit, and installs quietly then', () => {
  const au = fake(), app = fakeApp(), told = [], changes = []
  const u = createUpdater({ app, updater: au, tell: m => told.push(m), onChange: s => changes.push(s.status), log: { error() {} } })
  try {
    assert.equal(au.autoDownload, true)
    assert.equal(au.autoInstallOnAppQuit, false)
    assert.equal(u.finishOnExit(), false) // nothing ready yet: a plain exit
    au.emit('update-available', { version: '1.0.18' })
    au.emit('update-downloaded', { version: '1.0.18' })
    au.emit('update-downloaded', { version: '1.0.18' })
    assert.equal(told.length, 1)
    assert.match(told[0], /1\.0\.18 is ready/)
    assert.deepEqual(changes, ['downloading', 'ready', 'ready'])
    au.emit('update-not-available') // a later check doesn't undo a ready update
    assert.equal(u.state.status, 'ready')
    assert.equal(u.finishOnExit(), true)
    assert.deepEqual(au.installs, [[true, false]]) // quitting: install, don't reopen
  } finally { u.stop() }
})

test('Restart to update quits the usual way and opens LocalHub again after installing', () => {
  const au = fake(), app = fakeApp()
  const u = createUpdater({ app, updater: au, tell: () => {}, log: { error() {} } })
  try {
    assert.equal(u.installNow(), false) // nothing to install
    au.emit('update-downloaded', { version: '1.0.18' })
    assert.equal(u.installNow(), true)
    assert.equal(app.quits, 1)
    u.finishOnExit()
    assert.deepEqual(au.installs, [[true, true]])
  } finally { u.stop() }
})

test('a failed check is logged and changes nothing that was ready', async () => {
  const au = fake(), errors = []
  au.checkForUpdates = async () => { throw new Error('offline') }
  const u = createUpdater({ app: fakeApp(), updater: au, tell: () => {}, log: { error: (...a) => errors.push(a.join(' ')) } })
  try {
    assert.equal(await u.check(), null)
    assert.match(errors[0], /offline/)
    au.emit('update-downloaded', { version: '1.0.18' })
    au.emit('error', new Error('network'))
    assert.equal(u.state.status, 'ready')
  } finally { u.stop() }
})
