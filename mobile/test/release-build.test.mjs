// The release bundle is what ships: no test hooks, no plain-HTTP allowance, and a locked-down page.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const www = name => fs.readFileSync(path.join(ROOT, 'www', name), 'utf8')

before(() => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: ROOT, stdio: 'pipe' })
})

test('the release bundle carries no test hooks or debug addresses', () => {
  const js = www('app.js')
  for (const hook of ['__hubTest', '__testScan', '__hubOpened', '__hubCookiesCleared', '__testCookiesFail', '__testStorageFails', '__DEV__']) assert.ok(!js.includes(hook), hook)
  assert.ok(!js.includes('console.log('), 'no logging in app code paths')
})

test('the release page allows only its own files', () => {
  const html = www('index.html')
  assert.match(html, /script-src 'self'/)
  assert.match(html, /connect-src 'self';/)
  assert.ok(!html.includes('localhost'))
  assert.ok(!html.includes('unsafe'))
})

test('the shell is one bundle with no remote code', () => {
  assert.ok(!/<script[^>]+src="https?:/.test(www('index.html')))
  assert.ok(!/https?:\/\/(?!www\.w3\.org)[a-z0-9.-]+\.(com|net|io|org)\/[^"' ]*\.js/.test(www('app.js')))
})
