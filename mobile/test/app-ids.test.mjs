// The store ids: every copy agrees, the maintainers' id is only where it's needed, and a fork can replace it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkAppIds, IOS_FILES, ANDROID_FILES } from '../scripts/check-app-ids.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ids = JSON.parse(fs.readFileSync(path.join(ROOT, 'app-ids.json'), 'utf8'))
// Whether this is the maintainers' copy. It's a hash so this file doesn't name them, and a fork's own id
// can be any word, so the name checks below only mean something here.
const MAINTAINERS_ID = '38fe4bb18e69daf7be9370c556efc46fbf5ba27016d1b42c195860300cf6e0ba'
const isMaintainers = createHash('sha256').update(ids.ios).digest('hex') === MAINTAINERS_ID
// The shorter stem also catches the name written out in words.
const stem = new RegExp(ids.ios.split('.')[1].slice(0, 7), 'i')
const tracked = () => execFileSync('git', ['ls-files', 'mobile', '.github'], { cwd: path.join(ROOT, '..'), encoding: 'utf8' }).split('\n').filter(Boolean)

test('every copy of the ids matches app-ids.json', () => {
  assert.deepEqual(checkAppIds(ROOT), [])
})

test('the extensions sit under the app\'s id, as Apple requires', () => {
  const pbx = fs.readFileSync(path.join(ROOT, IOS_FILES[1]), 'utf8')
  const found = new Set([...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map(m => m[1]))
  assert.deepEqual([...found].sort(), [ids.ios, `${ids.ios}.share`, `${ids.ios}.widget`].sort())
})

test('the widget is in no App Group, so only the app and the share extension need one', () => {
  const pbx = fs.readFileSync(path.join(ROOT, IOS_FILES[1]), 'utf8')
  assert.equal([...pbx.matchAll(/CODE_SIGN_ENTITLEMENTS = ([^;]+);/g)].filter(m => /HubWidget/.test(m[1])).length, 0)
})

test('the maintainers\' id appears only as that exact id, and only where it is needed', { skip: !isMaintainers }, () => {
  const allowed = new Set([...IOS_FILES, ...ANDROID_FILES, 'app-ids.json', 'PLAN.md', 'README.md'].map(rel => `mobile/${rel}`))
  const exact = new RegExp(`(group\\.)?${ids.ios.replace(/\./g, '\\.')}(\\.share|\\.widget)?`, 'g')
  for (const rel of tracked()) {
    const full = path.join(ROOT, '..', rel)
    if (!fs.existsSync(full)) continue
    const text = fs.readFileSync(full, 'utf8')
    if (!stem.test(text)) continue
    assert.ok(allowed.has(rel), `${rel} shouldn't name it`)
    assert.ok(!stem.test(text.replace(exact, '')), `${rel} names it some other way`)
  }
})

test('no team ID, certificate, profile or key is in the repo', () => {
  for (const rel of tracked()) assert.ok(!/\.(p8|p12|pfx|cer|mobileprovision|provisionprofile|keystore|jks)$/i.test(rel), rel)
  const pbx = fs.readFileSync(path.join(ROOT, IOS_FILES[1]), 'utf8')
  assert.ok(!/DEVELOPMENT_TEAM = "?[A-Z0-9]+/.test(pbx), 'team ID')
  assert.ok(!/PROVISIONING_PROFILE(_SPECIFIER)? = "?[A-Za-z0-9]/.test(pbx), 'profile')
  const gradle = fs.readFileSync(path.join(ROOT, ANDROID_FILES[0]), 'utf8')
  // The signed build reads these from the build machine. None of them is ever written here.
  assert.ok(!/(storePassword|keyPassword|keyAlias)\s*=?\s*['"]/.test(gradle), 'signing password')
})

// A copy of just the files the script reads and writes.
function forkCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-'))
  for (const rel of [...IOS_FILES, ...ANDROID_FILES, 'app-ids.json', 'scripts/set-app-id.mjs', 'scripts/check-app-ids.mjs']) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel))
  }
  return dir
}
const setIds = (dir, ...args) => spawnSync(process.execPath, [path.join(dir, 'scripts/set-app-id.mjs'), ...args], { encoding: 'utf8' })

test('a fork sets its own ids with one command, and nothing of the old ids is left', () => {
  const dir = forkCopy()
  try {
    const r = setIds(dir, '--ios', 'org.myfork.app', '--android', 'org.myfork.app')
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(checkAppIds(dir), [])
    for (const rel of IOS_FILES) {
      const text = fs.readFileSync(path.join(dir, rel), 'utf8')
      assert.ok(!text.includes(ids.ios), rel)
      if (isMaintainers) assert.ok(!stem.test(text), rel)
    }
    assert.match(fs.readFileSync(path.join(dir, ANDROID_FILES[0]), 'utf8'), /applicationId "org\.myfork\.app"/)
    assert.match(fs.readFileSync(path.join(dir, 'ios/App/App/App.entitlements'), 'utf8'), /group\.org\.myfork\.app/)
    assert.match(fs.readFileSync(path.join(dir, IOS_FILES[1]), 'utf8'), /org\.myfork\.app\.widget;/)
    // The Java package doesn't move, so the source still builds.
    assert.match(fs.readFileSync(path.join(dir, ANDROID_FILES[0]), 'utf8'), /namespace = "com\.example\.localhub"/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('either platform can be set alone, and a bad id or broken copy changes nothing', () => {
  const dir = forkCopy()
  try {
    assert.equal(setIds(dir, '--android', 'org.myfork.app').status, 0)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'app-ids.json'), 'utf8')), { ios: ids.ios, android: 'org.myfork.app' })
    const before = fs.readFileSync(path.join(dir, 'app-ids.json'), 'utf8')
    for (const bad of [['--ios', 'nodots'], ['--ios', 'Org.Upper.case'], ['--ios', 'org.my-hub.app'], ['--ios', 'org..x'], ['--ios', 'a.b;rm'], ['--other', 'org.a.b'], []]) {
      assert.notEqual(setIds(dir, ...bad).status, 0, bad.join(' '))
    }
    assert.equal(fs.readFileSync(path.join(dir, 'app-ids.json'), 'utf8'), before)

    const plist = path.join(dir, IOS_FILES[3])
    fs.writeFileSync(plist, fs.readFileSync(plist, 'utf8').replace(`group.${ids.ios}`, 'group.other'))
    const pbx = fs.readFileSync(path.join(dir, IOS_FILES[1]), 'utf8')
    assert.notEqual(setIds(dir, '--ios', 'org.myfork.app').status, 0)
    assert.equal(fs.readFileSync(path.join(dir, IOS_FILES[1]), 'utf8'), pbx)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
