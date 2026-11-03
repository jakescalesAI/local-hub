// The CI checks on what ships. A check that can't fail proves nothing, so these make each one fail when it should.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOW = path.join(ROOT, '..', '.github', 'workflows', 'mobile.yml')
const CHECK = path.join(ROOT, 'scripts', 'check-apk-network.sh')

test('every "must not contain" check in CI stops the step, since bash -e ignores a command negated with !', () => {
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split('\n')
  const loose = lines.map((line, i) => [i + 1, line]).filter(([, line]) => /^\s*! /.test(line) && !/\|\| exit 1\s*$/.test(line))
  assert.deepEqual(loose, [])
})

// aapt2 as the check sees it: the resource table, then the compiled XML. A shrunk release renames the file.
function fakeAapt(dir, { file, tree }) {
  const table = file ? `resource 0x7f140003 xml/network_security_config\n      () (file) ${file} type=XML\n` : 'resource 0x7f140001 xml/file_paths\n      () (file) res/xml/file_paths.xml type=XML\n'
  fs.writeFileSync(path.join(dir, 'table.txt'), table)
  fs.writeFileSync(path.join(dir, 'tree.txt'), tree)
  const bin = path.join(dir, 'aapt2')
  fs.writeFileSync(bin, `#!/bin/sh\nif [ "$2" = resources ]; then cat "${dir}/table.txt"; else cat "${dir}/tree.txt"; fi\n`)
  fs.chmodSync(bin, 0o755)
  return bin
}
const runCheck = setup => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aapt-'))
  try {
    return spawnSync('sh', [CHECK, fakeAapt(dir, setup), 'app.apk'], { encoding: 'utf8' })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
const HTTPS_ONLY = 'N: android=http://schemas.android.com/apk/res/android\n  E: network-security-config (line=3)\n    E: base-config (line=4)\n      A: cleartextTrafficPermitted=false\n'
const DEBUG = `${HTTPS_ONLY}    E: domain-config (line=5)\n      A: cleartextTrafficPermitted=true\n        E: domain (line=6)\n          T: '10.0.2.2'\n`

test('the network check passes the HTTPS-only config, under a renamed file too', () => {
  for (const file of ['res/xml/network_security_config.xml', 'res/Hf.xml']) {
    const r = runCheck({ file, tree: HTTPS_ONLY })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /HTTPS only/)
  }
})

test('the network check fails when the config allows plain HTTP, is missing, or is empty', () => {
  const debug = runCheck({ file: 'res/Hf.xml', tree: DEBUG })
  assert.equal(debug.status, 1)
  assert.match(debug.stdout, /allows plain HTTP/)
  assert.equal(runCheck({ file: 'res/Hf.xml', tree: HTTPS_ONLY.replace('true', 'x').replace('cleartextTrafficPermitted=false', 'cleartextTrafficPermitted=0xffffffff') }).status, 1)
  const missing = runCheck({ file: null, tree: '' })
  assert.equal(missing.status, 1)
  assert.match(missing.stdout, /No network_security_config/)
  assert.equal(runCheck({ file: 'res/Hf.xml', tree: '' }).status, 1)
})
