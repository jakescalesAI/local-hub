// Finds and starts the Hub server shipped with the app.
//
// The Hub keeps config/ and data/ next to its own files, and an update replaces everything under
// resources/. So the installed app runs a copy in the user data folder, which updates overwrite file
// by file and never touch config/ or data/.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BUNDLE_MARKER } from './as-node.js'

const RUNNER = fileURLToPath(new URL('./hub-runner.mjs', import.meta.url))
const QUIT_GUARD = fileURLToPath(new URL('./quit-guard.mjs', import.meta.url))
const KEPT = new Set(['config', 'data', 'workspace'])

export function syncBundle(source, target, stamp) {
  const marker = path.join(target, BUNDLE_MARKER)
  let current = null
  try { current = fs.readFileSync(marker, 'utf8') } catch {}
  if (current === stamp) return
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter: from => !KEPT.has(path.relative(source, from).split(path.sep)[0]),
  })
  fs.writeFileSync(marker, stamp)
}

// A folder that holds a Hub: its server, and a package.json that says it is one.
export function isHubFolder(folder) {
  try {
    return path.isAbsolute(folder) && fs.statSync(path.join(folder, 'server.mjs')).isFile()
      && JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')).name === 'local-hub'
  } catch { return false }
}

// Node on this computer. The Hub in a chosen folder runs on it, as it does when started by hand: the Hub starts
// helpers with its own program, and only the copy the app ships can do that on the app's (as-node.js).
export function findNode(env = process.env, platform = process.platform) {
  const name = platform === 'win32' ? 'node.exe' : 'node'
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue
    const file = path.join(dir, name)
    try { if (fs.statSync(file).isFile()) return file } catch {}
  }
  return null
}

// With a folder chosen, only its Hub is ever started. If it has gone, starting the built-in one instead would
// quietly show an empty Hub, so there's none.
export function resolveServerEntry({ isPackaged, resourcesPath, appPath, userData, version, hubFolder = '', env = process.env }) {
  if (env.LOCAL_HUB_SERVER) return fs.existsSync(env.LOCAL_HUB_SERVER) ? env.LOCAL_HUB_SERVER : null
  if (hubFolder) return isHubFolder(hubFolder) ? path.join(hubFolder, 'server.mjs') : null
  if (!isPackaged) {
    const fromSource = path.resolve(appPath, '..', 'server.mjs')
    return fs.existsSync(fromSource) ? fromSource : null
  }
  const source = path.join(resourcesPath, 'hub')
  const shipped = path.join(source, 'server.mjs')
  if (!fs.existsSync(shipped)) return null
  const target = path.join(userData, 'hub')
  syncBundle(source, target, `${version} ${fs.statSync(shipped).mtimeMs}`)
  return path.join(target, 'server.mjs')
}

// Outlives the app on purpose. It's a safety net, so failing to start it doesn't stop the app quitting.
export function spawnQuitGuard(afterMs) {
  try {
    const guard = spawn(process.execPath, [QUIT_GUARD, process.pid, afterMs].map(String), {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    guard.once('error', error => console.error('quit guard:', error.message))
    guard.unref()
  } catch (error) {
    console.error('quit guard:', error.message)
  }
}

// node, when given, runs the Hub directly: the runner sits inside the app's archive, which only Electron can read.
export function spawnBundledHub({ entry, port, logFile, spawnOptions = {}, cleanEnv = false, node = null }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  const log = fs.openSync(logFile, 'a')
  try {
    return spawn(node ?? process.execPath, node ? [entry] : [RUNNER, entry], {
      cwd: path.dirname(entry),
      windowsHide: true,
      stdio: node ? ['ignore', log, log] : ['ignore', log, log, 'ipc'],
      env: {
        ...process.env,
        ...(node ? {} : { ELECTRON_RUN_AS_NODE: '1' }),
        HUB_PORT: String(port),
        ...(cleanEnv ? { LOCAL_HUB_RUNNER_CLEAN_ENV: '1' } : {}),
      },
      ...spawnOptions,
    })
  } finally {
    fs.closeSync(log)
  }
}
