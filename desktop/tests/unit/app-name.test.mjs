import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'

import { APP_ID, APP_NAME } from '../../src/app-name.js'

const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

test('the name comes from package.json and the installer uses the same one', () => {
  assert.equal(APP_NAME, pkg.productName)
  assert.equal(pkg.build.productName, undefined, 'electron-builder falls back to the one productName')
  assert.equal(APP_ID, pkg.build.appId)
})

test('the pages and windows never spell the name out', () => {
  for (const file of ['src/main-window.js', 'src/launcher.js', 'src/tray.js', 'src/app.js', 'pages/launcher.html', 'pages/offline.html', 'pages/settings.html']) {
    assert.equal(fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').includes(pkg.productName), false, file)
  }
})
