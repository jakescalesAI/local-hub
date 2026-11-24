import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { findNode, isHubFolder, resolveServerEntry } from '../../src/hub-bundle.js'
import { Settings } from '../../src/settings.js'

const temp = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-folder-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
const makeHub = dir => {
  fs.writeFileSync(path.join(dir, 'server.mjs'), '')
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"local-hub"}')
}

test('only a folder with a Hub in it counts', t => {
  const dir = temp(t)
  assert.equal(isHubFolder(dir), false)
  fs.writeFileSync(path.join(dir, 'server.mjs'), '')
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"something-else"}')
  assert.equal(isHubFolder(dir), false)
  makeHub(dir)
  assert.equal(isHubFolder(dir), true)
  assert.equal(isHubFolder('relative'), false)
})

test('a chosen folder is used, and one that has gone never falls back to an empty built-in Hub', t => {
  const dir = temp(t)
  makeHub(dir)
  const base = { isPackaged: true, resourcesPath: path.join(dir, 'none'), userData: dir, version: '1', env: {} }
  assert.equal(resolveServerEntry({ ...base, hubFolder: dir }), path.join(dir, 'server.mjs'))
  fs.rmSync(path.join(dir, 'server.mjs'))
  assert.equal(resolveServerEntry({ ...base, hubFolder: dir }), null)
})

test('the folder survives a reload, and a relative one is dropped', t => {
  const dir = temp(t)
  const file = path.join(dir, 'settings.json')
  new Settings(file).update({ hubFolder: dir })
  assert.equal(new Settings(file).values.hubFolder, dir)
  fs.writeFileSync(file, '{"hubFolder":"hub"}')
  assert.equal(new Settings(file).values.hubFolder, '')
})

test('node is found on the path', t => {
  const dir = temp(t)
  assert.equal(findNode({ PATH: dir }, 'win32'), null)
  fs.writeFileSync(path.join(dir, 'node.exe'), '')
  assert.equal(findNode({ PATH: ['relative', dir].join(path.delimiter) }, 'win32'), path.join(dir, 'node.exe'))
})
