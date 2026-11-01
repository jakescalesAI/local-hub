// The Hub starts its MCP helpers with `process.execPath script.mjs`. Under Electron that path is the
// app itself, so without this the helper would open a second copy of the app instead of running.
// Only a script sitting directly in a folder holding the bundle marker is run; anything else starts
// the app as normal.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const BUNDLE_MARKER = '.local-hub-bundle'

export function bundledScript(argv) {
  const script = argv[1]
  if (!script || !path.isAbsolute(script) || !/\.m?js$/i.test(script)) return null
  return fs.existsSync(script) && fs.existsSync(path.join(path.dirname(script), BUNDLE_MARKER)) ? script : null
}

export function runBundledScript(argv) {
  if (!bundledScript(argv)) return false
  const result = spawnSync(process.execPath, argv.slice(1), {
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  process.exit(result.status ?? 1)
}
