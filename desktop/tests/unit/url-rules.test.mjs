// The URL rules and the bundle copy, without Electron. security.js imports nothing from Electron.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { BUNDLE_MARKER, bundledScript } from '../../src/as-node.js'
import { resolveServerEntry, syncBundle } from '../../src/hub-bundle.js'
import { canOpenExternally, isHubUrl, isLocalPage, PAGES_DIR } from '../../src/security.js'

const HUB = 'http://localhost:3100'

test('only the exact origin counts as the Hub', () => {
  assert.equal(isHubUrl('http://localhost:3100/launcher?x=1#y', HUB), true)
  for (const url of [
    'http://localhost:3101/',
    'https://localhost:3100/',
    'http://127.0.0.1:3100/',
    'http://localhost:3100.example.com/',
    'http://localhost:3100@example.com/',
    'file:///C:/x.html',
    'not a url',
    '',
  ]) assert.equal(isHubUrl(url, HUB), false, url)
})

test('only files in the pages folder count as local pages', () => {
  const page = pathToFileURL(path.join(PAGES_DIR, 'offline.html')).href
  assert.equal(isLocalPage(`${page}?reason=starting`), true)
  assert.equal(isLocalPage(pathToFileURL(path.join(PAGES_DIR, '..', 'package.json')).href), false)
  assert.equal(isLocalPage(pathToFileURL(path.join(PAGES_DIR, '..', 'pages-evil', 'x.html')).href), false)
  assert.equal(isLocalPage(`${pathToFileURL(PAGES_DIR).href}..%2F..%2Fsecret.html`.replace('%2F', '/').replace('%2F', '/')), false)
  assert.equal(isLocalPage('http://localhost:3100/offline.html'), false)
})

test('a local page has no host and no encoded way out of the pages folder', () => {
  const pages = pathToFileURL(PAGES_DIR)
  assert.equal(isLocalPage(`file://attacker.example${pages.pathname}x.html`), false)
  assert.equal(isLocalPage(`file://localhost.example${pages.pathname}x.html`), false)
  for (const way of ['..%2fsrc/app.js', '..%2Fsrc/app.js', '..%5csrc/app.js', '%2e%2e/src/app.js', '.%2e/src/app.js', 'a%2f..%2f..%2fsrc/app.js']) {
    assert.equal(isLocalPage(`${pages.href}${way}`), false, way)
  }
  assert.equal(isLocalPage(`${pages.href}settings.html?a=%2f#%2e`), true, 'a query or fragment is not part of the path')
})

test('only web and mail links may open in the default browser', () => {
  for (const url of ['https://example.com/', 'http://example.com/', 'mailto:someone@example.com']) assert.equal(canOpenExternally(url), true, url)
  for (const url of ['file:///C:/Windows/notepad.exe', 'javascript:alert(1)', 'ms-settings:', 'smb://host/share', 'calculator:', '']) assert.equal(canOpenExternally(url), false, url)
})

test('helper scripts run as Node only from a folder holding the bundle marker', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-as-node-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const script = path.join(dir, 'tool.mjs')
  fs.writeFileSync(script, '')
  assert.equal(bundledScript(['exe', script]), null, 'no marker yet')
  fs.writeFileSync(path.join(dir, BUNDLE_MARKER), 'x')
  assert.equal(bundledScript(['exe', script]), script)
  assert.equal(bundledScript(['exe', 'tool.mjs']), null, 'relative path')
  assert.equal(bundledScript(['exe', path.join(dir, 'missing.mjs')]), null, 'missing script')
  assert.equal(bundledScript(['exe', path.join(dir, BUNDLE_MARKER)]), null, 'not a script')
  assert.equal(bundledScript(['exe', '--hidden']), null)
  assert.equal(bundledScript(['exe']), null)
})

test('the bundle copy updates code and never touches config or data', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-bundle-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'resources', 'hub')
  const userData = path.join(root, 'user')
  const target = path.join(userData, 'hub')
  fs.mkdirSync(path.join(source, 'config'), { recursive: true })
  fs.writeFileSync(path.join(source, 'config', 'hub.json'), 'shipped')
  fs.writeFileSync(path.join(source, 'server.mjs'), 'v1')
  const entry = () => resolveServerEntry({ isPackaged: true, resourcesPath: path.join(root, 'resources'), appPath: '', userData, version: '1.0.0', env: {} })

  assert.equal(entry(), path.join(target, 'server.mjs'))
  assert.equal(fs.readFileSync(path.join(target, 'server.mjs'), 'utf8'), 'v1')
  assert.equal(fs.existsSync(path.join(target, 'config')), false, 'shipped config is not copied')
  assert.ok(fs.existsSync(path.join(target, BUNDLE_MARKER)))

  fs.mkdirSync(path.join(target, 'config'))
  fs.mkdirSync(path.join(target, 'data'))
  fs.writeFileSync(path.join(target, 'config', 'hub.json'), 'mine')
  fs.writeFileSync(path.join(target, 'data', 'notes.json'), 'mine')
  syncBundle(source, target, 'next version')
  assert.equal(fs.readFileSync(path.join(target, 'config', 'hub.json'), 'utf8'), 'mine')
  assert.equal(fs.readFileSync(path.join(target, 'data', 'notes.json'), 'utf8'), 'mine')
  assert.equal(fs.readFileSync(path.join(target, BUNDLE_MARKER), 'utf8'), 'next version')
})

test('no shipped server means no entry, and a bad override is not silently replaced', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-bundle-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const base = { isPackaged: true, resourcesPath: root, appPath: root, userData: root, version: '1' }
  assert.equal(resolveServerEntry({ ...base, env: {} }), null)
  assert.equal(resolveServerEntry({ ...base, env: { LOCAL_HUB_SERVER: path.join(root, 'missing.mjs') } }), null)
})
