// The built app in dist/win-unpacked, which runs from an asar and differs from a source run in the
// parts that matter: the Hub starts with a clean environment, and helpers come back through main.js.
// Run `npm run dist` first. A packaged app ignores `-r`, so the test shim isn't loaded here: --hidden
// is what keeps it off the desktop, and --user-data-dir keeps it out of the real data folder.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'

import { BUNDLE_MARKER } from '../../src/as-node.js'
import {
  PACKAGED_EXE, STUB_DIR, cleanup, evalIn, freePort, getJson, launch, makeUserData, ping, processAlive, quit, removeUserData,
  startExternalStub, stopExternalStub, waitFor, waitForUrl,
} from '../helpers.mjs'

const skipIfNotBuilt = t => {
  if (fs.existsSync(PACKAGED_EXE)) return false
  t.skip('no build at dist/win-unpacked (could not check; not a pass)')
  return true
}

describe('the packaged app', () => {
  test('attaches to a running Hub, with the security flags on, and leaves it running', async t => {
    if (skipIfNotBuilt(t)) return
    const port = await freePort()
    const external = await startExternalStub(port)
    const userData = makeUserData({ port })
    cleanup(t, () => removeUserData(userData))
    cleanup(t, () => stopExternalStub(external))
    const handle = await launch({ userData, packaged: true, args: ['--hidden'] })
    cleanup(t, () => quit(handle).catch(() => {}))
    await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the Hub')

    const info = await handle.app.evaluate(({ app, BrowserWindow }) => {
      const { contextIsolation, nodeIntegration, sandbox } = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0].webContents.getLastWebPreferences()
      return { packaged: app.isPackaged, inAsar: app.getAppPath().endsWith('app.asar'), userData: app.getPath('userData'), contextIsolation, nodeIntegration, sandbox }
    })
    t.diagnostic(JSON.stringify(info))
    assert.deepEqual(info, { packaged: true, inAsar: true, userData, contextIsolation: true, nodeIntegration: false, sandbox: true })
    assert.equal(await evalIn(handle, 0, `typeof window.hubDesktop`), 'undefined')

    await quit(handle)
    assert.equal(await ping(port), true)
  })

  test('runs a bundled server as Node, with a clean environment, and helpers work', async t => {
    if (skipIfNotBuilt(t)) return
    const port = await freePort()
    const bundle = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-hub-e2e-bundle-'))
    cleanup(t, () => fs.rmSync(bundle, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))
    fs.cpSync(STUB_DIR, bundle, { recursive: true })
    fs.writeFileSync(path.join(bundle, BUNDLE_MARKER), 'test')
    const userData = makeUserData({ port })
    cleanup(t, () => removeUserData(userData))
    const handle = await launch({ userData, packaged: true, args: ['--hidden'], env: { LOCAL_HUB_SERVER: path.join(bundle, 'server.mjs'), STUB_GRANDCHILD: '1' } })
    cleanup(t, () => quit(handle).catch(() => {}))
    await waitForUrl(handle, 0, url => url.startsWith(`http://localhost:${port}/`), 'the bundled Hub', 40_000)

    const pids = await getJson(port, '/api/pid')
    t.diagnostic(`bundled hub pid ${pids.pid}, its child ${pids.grandchild}, app pid ${handle.pid}`)
    const env = await getJson(port, '/api/env')
    t.diagnostic(`/api/env ${JSON.stringify(env)}`)
    assert.equal(env.runAsNode, null, 'the flag is gone before the Hub runs, so its own children start clean')

    // The way the Hub starts its MCP helpers: process.execPath, a script, a bare environment, and pipes.
    const helper = await getJson(port, '/api/helper')
    t.diagnostic(`/api/helper ${JSON.stringify(helper)}`)
    assert.equal(helper.ok, true)

    await quit(handle)
    await waitFor(async () => !(await ping(port)), 'the port to go quiet', 5000)
    await waitFor(() => !processAlive(pids.pid) && !processAlive(pids.grandchild), 'the Hub and its child to be gone', 5000)
  })
})
