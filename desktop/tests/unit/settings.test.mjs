import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { DEFAULTS, Settings, validPort } from '../../src/settings.js'

const tempFile = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-settings-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return path.join(dir, 'settings.json')
}

test('defaults are port 3100 and Ctrl+Alt+Space', t => {
  const settings = new Settings(tempFile(t))
  assert.equal(settings.values.port, 3100)
  assert.equal(settings.values.hotkey, 'Ctrl+Alt+Space')
  assert.equal(DEFAULTS.window, null)
})

test('values survive a reload and leave no temp file behind', t => {
  const file = tempFile(t)
  new Settings(file).update({ port: 4100, hotkey: 'Ctrl+Alt+K', window: { x: 1, y: 2, width: 800, height: 600 } })
  const again = new Settings(file)
  assert.equal(again.values.port, 4100)
  assert.equal(again.values.hotkey, 'Ctrl+Alt+K')
  assert.deepEqual(again.values.window, { x: 1, y: 2, width: 800, height: 600 })
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json'])
})

test('a damaged file falls back to defaults and is kept for inspection', t => {
  const file = tempFile(t)
  fs.writeFileSync(file, '{not json')
  assert.equal(new Settings(file).values.port, 3100)
  assert.equal(fs.readFileSync(`${file}.damaged`, 'utf8'), '{not json')
})

test('bad values are dropped one by one', t => {
  const file = tempFile(t)
  fs.writeFileSync(file, JSON.stringify({ port: 70000, hotkey: '   ', window: 'left' }))
  const { port, hotkey, window } = new Settings(file).values
  assert.deepEqual({ port, hotkey, window }, { port: 3100, hotkey: 'Ctrl+Alt+Space', window: null })
})

test('port boundaries', () => {
  for (const good of [1, 3100, 65535]) assert.equal(validPort(good), true, String(good))
  for (const bad of [0, 65536, -1, 3.5, '3100', null, undefined]) assert.equal(validPort(bad), false, String(bad))
})
