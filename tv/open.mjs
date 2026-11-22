// npm run tv — LocalHub TV on this computer, in its own window.
//
// Opens http://localhost:<port>/tv/ as an app window (no tabs or address bar) in Edge or Chrome,
// so a laptop shows exactly what a TV would. The keyboard is the remote: arrows, Enter, Esc,
// M for Control Center, Space to talk. It opens maximised with a normal title bar, so nothing on the
// page sits under the window's controls; F11 (or --fullscreen) goes full screen like a real TV.
//
//   npm run tv                  maximised, with a title bar
//   npm run tv -- --fullscreen  full screen
//   npm run tv -- --window      in a window, 1600×900
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { PORT } from '../config.mjs'

const url = `http://localhost:${PORT}/tv/`
const windowed = process.argv.includes('--window')
const fullscreen = process.argv.includes('--fullscreen')

async function hubUp() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/ping`, { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch {
    return false
  }
}

function browsers() {
  if (process.platform === 'win32') {
    const roots = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA].filter(Boolean)
    return roots.flatMap(r => [path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')])
  }
  if (process.platform === 'darwin') {
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
  }
  return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']
}

if (!(await hubUp())) {
  console.error(`LocalHub isn't running on port ${PORT}. Start it first (npm start), then run npm run tv again.`)
  process.exit(1)
}

const bin = browsers().find(p => { try { return fs.statSync(p).isFile() } catch { return false } })
if (!bin) {
  console.log(`No Edge or Chrome found. Open ${url} in your browser and press F11.`)
  process.exit(0)
}

// Its own profile, so the TV window keeps its settings and never mixes with your browsing.
const profile = path.join(os.homedir(), '.localhub-tv-window')
const args = [`--app=${url}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required']
args.push(windowed ? '--window-size=1600,900' : fullscreen ? '--start-fullscreen' : '--start-maximized')
spawn(bin, args, { detached: true, stdio: 'ignore' }).unref()
console.log(`LocalHub TV is open${windowed ? ' in a window' : fullscreen ? ' full screen' : ''}: ${url}${fullscreen ? '' : ' (F11 for full screen)'}`)
console.log('Keys: arrows move, Enter opens, Esc goes back, M opens the drop-down, Space talks, ? shows the keys.')
