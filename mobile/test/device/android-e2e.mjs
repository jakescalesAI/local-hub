// Runs the minified build on an Android emulator against the real Hub, with real biometric prompts: the
// emulator's fingerprint sensor, its Keystore and its system prompt. CI only, since it needs a booted
// emulator with the app installed, and it changes that emulator's PIN and fingerprints. A fake assistant
// stands in for chat. This shows Android behaviour on an emulator: not hardware, and nothing about iOS.
//
//   adb install app-minified.apk && node test/device/android-e2e.mjs <hub-checkout> <debug-apk> <out-dir>
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const [repo, debugApk, out] = process.argv.slice(2)
if (!repo || !debugApk || !out) {
  console.error('Usage: node test/device/android-e2e.mjs <hub-checkout> <debug-apk> <out-dir>')
  process.exit(2)
}
fs.mkdirSync(out, { recursive: true })

const APP = 'com.example.localhub'
const PIN = '1111'
const PORT = 3171
const ENROLLED = 1
const STRANGER = 2
const HUB_NAME = 'My Hub'
// Made up, and it shows in the screenshots this run keeps.
const FAKE_REPLY = 'You have two things on today: the dentist at 3, and the garden notes you wanted to finish.'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const runAdb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] })

// adb's link to the emulator drops now and then on these runners. That's the link, not the app, so it's
// logged and tried again once. If the emulator itself is gone, this fails.
function adb(...args) {
  try {
    return runAdb(...args)
  } catch (e) {
    if (!/device offline|error: closed|no devices|not found/.test(`${e.stderr}${e.message}`)) throw e
    console.log(`    adb dropped during "${args.join(' ').slice(0, 60)}": reconnecting`)
    execFileSync('adb', ['reconnect', 'offline'], { stdio: 'ignore', timeout: 30000 })
    execFileSync('adb', ['wait-for-device'], { stdio: 'ignore', timeout: 120000 })
    return runAdb(...args)
  }
}
const sh = command => adb('shell', command)
const finger = id => adb('emu', 'finger', 'touch', String(id))
const key = code => sh(`input keyevent ${code}`)

function shot(name) {
  const png = execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024, timeout: 30000 })
  fs.writeFileSync(path.join(out, `${name}.png`), png)
  return png
}

// --- Reading the screen

// CI's emulator is slow enough for Android to call its own parts stuck. That's waited out and logged. If it
// names this app, it stays on screen and fails the run.
const OTHER_STUCK = /^\s*(?!Local Hub\b).*isn't responding/

function dump() {
  for (let i = 0; i < 6; i++) {
    try {
      const said = sh('uiautomator dump /sdcard/ui.xml')
      if (said.includes('dumped')) {
        const nodes = parse(sh('cat /sdcard/ui.xml'))
        const stuck = nodes.find(n => OTHER_STUCK.test(label(n)))
        const wait = stuck && nodes.find(n => /^\s*Wait\s*$/.test(label(n)))
        if (!wait) return nodes
        console.log(`    waited out: ${label(stuck).trim()}`)
        tap(wait)
      }
    } catch {
      // It refuses while the screen is still moving.
    }
    execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 700)'])
  }
  return []
}

const unescape = s => s.replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

function parse(xml) {
  return [...xml.matchAll(/<node [^>]*>/g)].map(([tag]) => {
    const attr = name => unescape(tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1] ?? '')
    const [x1, y1, x2, y2] = attr('bounds').match(/\d+/g).map(Number)
    return { text: attr('text'), desc: attr('content-desc'), cls: attr('class'), pkg: attr('package'), x: (x1 + x2) >> 1, y: (y1 + y2) >> 1 }
  })
}

const label = n => `${n.text} ${n.desc}`
const screenText = nodes => nodes.map(label).join('\n')

async function waitFor(pattern, ms = 30000) {
  const end = Date.now() + ms
  let nodes = []
  while (Date.now() < end) {
    nodes = dump()
    const hit = nodes.find(n => pattern.test(label(n)))
    if (hit) return hit
    await sleep(800)
  }
  shot(`missing-${String(pattern).replace(/\W+/g, '-').slice(0, 40)}`)
  throw new Error(`Never saw ${pattern}. On screen:\n${screenText(nodes).replace(/^\s+$/gm, '').replace(/\n+/g, '\n')}`)
}

const tap = n => sh(`input tap ${n.x} ${n.y}`)

async function textField(ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const field = dump().find(n => n.cls.includes('EditText'))
    if (field) return field
    await sleep(800)
  }
  shot('missing-text-field')
  throw new Error(`Never saw a text field. On screen:\n${screenText(dump())}`)
}
const tapOn = async (pattern, ms) => tap(await waitFor(pattern, ms))

async function gone(pattern, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (!dump().some(n => pattern.test(label(n)))) return
    await sleep(800)
  }
  throw new Error(`Still on screen: ${pattern}`)
}

async function neverShows(pattern, ms = 4000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const nodes = dump()
    const hit = nodes.find(n => pattern.test(label(n)))
    assert.ok(!hit, `Should not show ${pattern}: ${hit && label(hit)}`)
    await sleep(600)
  }
}

const inApp = () => /mCurrentFocus=.*com\.example\.localhub/.test(sh('dumpsys window | grep mCurrentFocus || true'))
const focus = () => sh('dumpsys window | grep mCurrentFocus || true').trim()

// The app's windows, as the window manager has them.
const secureFlagged = () => {
  const text = sh('dumpsys window windows')
  const mine = text.split(/\n(?=\s*Window #)/).filter(w => /Window\{[^}]*com\.example\.localhub/.test(w.split('\n')[0]))
  assert.ok(mine.length, 'the app has a window')
  return mine.every(w => /\bSECURE\b/.test(w))
}

const LOCKED = /Local Hub is locked/
// The system prompt comes up on top of the lock screen as soon as the app comes back, and hides it from the dump.
const PROMPT = /Unlock Local Hub/
const LOCKING = /Local Hub is locked|Unlock Local Hub/
const resumed = () => sh('dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity" || true').trim()
const CONNECTED = /^\s*Connected\b/
const open = () => sh(`am start -n ${APP}/.MainActivity`)
const viaLink = link => sh(`am start -a android.intent.action.VIEW -n ${APP}/.MainActivity -d '${link}'`)
const home = () => key('KEYCODE_HOME')
const leaveAndComeBack = async () => {
  home()
  await sleep(1500)
  assert.ok(!inApp(), `still in the app: ${focus()}`)
  open()
}

// --- The real Hub

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-'))
const copy = path.join(tmp, 'hub')
const hubHome = path.join(tmp, 'home')
const marker = path.join(copy, 'fake-claude-finished.txt')
let child
let hubLog = ''

function call(route, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined
    const req = http.request({ host: '127.0.0.1', port: PORT, path: route, method, headers: { host: `localhost:${PORT}`, 'x-hub': '1', ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, res => {
      let text = ''
      res.on('data', d => (text += d))
      res.on('end', () => resolve({ status: res.statusCode, text }))
    })
    req.on('error', reject)
    req.end(data)
  })
}

async function startHub() {
  fs.mkdirSync(copy, { recursive: true })
  const tar = path.join(tmp, 'hub.tar')
  execFileSync('git', ['-C', repo, 'archive', '-o', tar, 'HEAD'])
  execFileSync('tar', ['-xf', tar, '-C', copy])
  fs.mkdirSync(path.join(copy, 'config'), { recursive: true })
  fs.writeFileSync(path.join(copy, 'config', 'hub.json'), JSON.stringify({ name: HUB_NAME, access: 'localhost', url: 'https://hub.example.com', hosts: ['10.0.2.2'] }))
  const bin = path.join(hubHome, '.local', 'bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh
cat > /dev/null
echo done > '${marker}'
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"${FAKE_REPLY}"}]}}'
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"${FAKE_REPLY}"}'
`, { mode: 0o755 })
  child = spawn(process.execPath, ['server.mjs'], { cwd: copy, env: { ...process.env, HUB_PORT: String(PORT), HOME: hubHome, USERPROFILE: hubHome } })
  child.stdout.on('data', d => (hubLog += d))
  child.stderr.on('data', d => (hubLog += d))
  for (let i = 0; ; i++) {
    if (await call('/api/ping').then(r => r.status === 200, () => false)) return
    if (i > 100) throw new Error(`Hub did not start:\n${hubLog}`)
    await sleep(200)
  }
}

const pairingCode = async () => JSON.parse((await call('/api/pair/start', { method: 'POST' })).text).code
const pairingLink = c => `localhub://pair?u=${encodeURIComponent(`http://10.0.2.2:${PORT}`)}&c=${c}`

// --- Fingerprints, through the real Settings screens

async function enroll(id) {
  console.log(`    sensor: ${sh('pm list features | grep -i fingerprint || echo none').trim()}`)
  // The newer entry point confirms the PIN first and hands the result to the enrolment screens.
  sh('am start -a android.settings.BIOMETRIC_ENROLL --ei android.provider.extra.BIOMETRIC_AUTHENTICATORS_ALLOWED 15')
  const end = Date.now() + 150000
  let touches = 0
  let seen = ''
  let screens = 0
  while (Date.now() < end) {
    await sleep(1200)
    const nodes = dump()
    const text = screenText(nodes)
    const now = `${focus().replace(/.*\//, '').replace(/\}.*/, '')}: ${nodes.map(n => n.text).filter(Boolean).slice(0, 4).join(' | ').slice(0, 160)}`
    if (now !== seen) {
      console.log(`    enrol: ${(seen = now)}`)
      shot(`enrol-${id}-${String(++screens).padStart(2, '0')}`)
    }
    if (/com\.example\.localhub/.test(focus())) throw new Error('Enrolment closed and left the app on top.')
    const button = pattern => nodes.find(n => pattern.test(n.text) && !/\bfinger/i.test(n.text))
    if (/Fingerprint added/i.test(text) || /Done/.test(button(/^done$/i)?.text ?? '')) {
      tap(button(/^done$/i))
      await sleep(1000)
      return touches
    }
    const pinField = nodes.find(n => n.cls.includes('EditText') && n.pkg.includes('settings'))
    if (pinField && /PIN/i.test(text)) {
      sh(`input text ${PIN}`)
      key('KEYCODE_ENTER')
      continue
    }
    const next = button(/^(i agree|agree|more|next|start|continue)$/i)
    if (next) {
      tap(next)
      continue
    }
    finger(id)
    touches++
  }
  shot('enroll-timed-out')
  throw new Error(`Enrolling a fingerprint timed out after ${touches} touches. On screen:\n${screenText(dump())}`)
}

// --- Pictures of the main screens, with made-up data. Only when asked: PICTURES=1 stops after these.

async function pictures(mode, name) {
  const dir = path.join(out, 'screens')
  fs.mkdirSync(dir, { recursive: true })
  const picture = n => fs.writeFileSync(path.join(dir, `${n}-${name}.png`), shot('latest-picture'))
  sh(`cmd uimode night ${mode}`)
  sh(`am force-stop ${APP}`)
  await sleep(1000)
  open()
  await waitFor(CONNECTED, 40000)
  await waitFor(new RegExp(HUB_NAME))
  await sleep(1500)
  picture('app-home')
  await tapOn(/^\s*Open Hub\s*$/)
  await waitFor(/Clock & date/, 60000)
  await sleep(2000)
  picture('hub-home')
  // A web page's placeholder text isn't in the dump, so they go by position: search on top, chat at the bottom.
  const fields = () => dump().filter(n => n.cls.includes('EditText')).sort((a, b) => a.y - b.y)
  const search = fields()[0]
  tap(search)
  await sleep(800)
  sh('input text "clock"')
  await sleep(2500)
  picture('hub-search')
  tap(search)
  await sleep(800)
  for (let i = 0; i < 5; i++) key('KEYCODE_DEL')
  await sleep(1500)
  tap(fields().at(-1))
  await sleep(800)
  sh('input text "What%sis%son%stoday?"')
  await sleep(1000)
  await tapOn(/^\s*Send\s*$/)
  await waitFor(/dentist/, 40000)
  await sleep(1500)
  picture('hub-chat')
  await tapOn(/Open the full chat/)
  await sleep(2500)
  picture('hub-chat-full')
  sh(`am force-stop ${APP}`)
}

let passed = 0
let stopping = false
async function step(name, fn) {
  if (stopping) return
  await fn()
  passed++
  console.log(`ok  ${name}`)
}

let failure
try {
  await startHub()
  let firstCode

  await step('the demo a reviewer would use runs from the first screen, with no Hub', async () => {
    open()
    await tapOn(/^\s*Try the demo\s*$/, 60000)
    await waitFor(/Demo: sample data/)
    shot('00-demo-home')
    await tapOn(/^\s*Open Hub\s*$/)
    await waitFor(/^\s*Done\s*$/)
    await sleep(2500)
    shot('00-demo-hub')
    await waitFor(/Sample web server/)
    await tapOn(/^\s*Done\s*$/)
    await waitFor(/Demo: sample data/)
    await tapOn(/^\s*Settings\s*$/)
    await tapOn(/Leave the demo/)
    await waitFor(/Try the demo/)
  })

  await step('so does the sample code in the review notes, typed in by hand', async () => {
    await tapOn(/^\s*Enter by hand\s*$/)
    await textField()
    const [address, code] = dump().filter(n => n.cls.includes('EditText')).sort((a, b) => a.y - b.y)
    tap(address)
    await sleep(700)
    sh('input text "https://demo.invalid"')
    tap(code)
    await sleep(700)
    sh('input text "DEMO2026"')
    await sleep(700)
    await tapOn(/^\s*Continue\s*$/)
    await tapOn(/^\s*Connect\s*$/)
    await waitFor(/Demo: sample data/)
    await tapOn(/^\s*Settings\s*$/)
    await tapOn(/Leave the demo/)
    await waitFor(/Try the demo/)
  })

  await step('the minified app pairs with the real Hub', async () => {
    firstCode = await pairingCode()
    viaLink(pairingLink(firstCode))
    await tapOn(/^\s*Connect\s*$/)
    await waitFor(CONNECTED)
    await waitFor(new RegExp(HUB_NAME))
    shot('01-connected')
  })

  await step('a message goes through to the real Hub\'s chat', async () => {
    tap(await textField())
    await sleep(700)
    sh('input text "hello%sfrom%sthe%semulator"')
    if (/mInputShown=true/.test(sh('dumpsys input_method'))) key('KEYCODE_BACK') // only the keyboard, never the screen
    await sleep(700)
    await tapOn(/^\s*Send\s*$/)
    const end = Date.now() + 20000
    while (!fs.existsSync(marker) && Date.now() < end) await sleep(500)
    assert.ok(fs.existsSync(marker), `chat never ran. Hub said:\n${hubLog}`)
  })

  await step('the Hub page opens through the minified in-app browser, and Done comes back', async () => {
    await tapOn(/^\s*Open Hub\s*$/)
    await waitFor(/^\s*Done\s*$/)
    await sleep(3000)
    assert.match(focus(), /com\.example\.localhub/)
    assert.ok(!/com\.example\.localhub\/\.MainActivity/.test(focus()), `the browser should be on top: ${focus()}`)
    shot('02-hub-page')
    await tapOn(/^\s*Done\s*$/)
    await waitFor(CONNECTED)
  })

  await step('a shared link fills the composer and sends nothing', async () => {
    const before = fs.statSync(marker).mtimeMs
    sh(`am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT 'Shared%20text' -n ${APP}/.MainActivity`)
    await waitFor(/Read it first/)
    await sleep(3000)
    assert.equal(fs.statSync(marker).mtimeMs, before)
    await tapOn(/^\s*Cancel\s*$/)
    await waitFor(CONNECTED)
  })

  if (process.env.PICTURES) {
    await pictures('yes', 'dark')
    await pictures('no', 'light')
    stopping = true
  }

  await step('with no fingerprint enrolled the lock can\'t be turned on, and says so', async () => {
    await tapOn(/^\s*Settings\s*$/)
    await waitFor(/Set up your fingerprint or face in your device's settings first/)
    shot('03-lock-not-enrolled')
    assert.ok(!secureFlagged(), 'the lock is off, so screenshots still work')
  })

  await step('a fingerprint is enrolled in the real Settings screens', async () => {
    sh(`locksettings set-pin ${PIN}`)
    const touches = await enroll(ENROLLED)
    console.log(`    enrolled in ${touches} touches`)
    open()
    await sleep(1500)
    const back = dump().find(n => /^\s*Back\s*$/.test(label(n)))
    if (back) tap(back)
    await waitFor(CONNECTED)
  })

  await step('cancelling the prompt leaves the lock off', async () => {
    await tapOn(/^\s*Settings\s*$/)
    await waitFor(/Require your fingerprint or face each time/)
    await tapOn(/^\s*Turn on\s*$/)
    await sleep(2500)
    key('KEYCODE_BACK')
    await sleep(1500)
    await waitFor(/Require your fingerprint or face each time/)
    assert.ok(!secureFlagged())
  })

  await step('a real fingerprint turns the lock on, and the window turns secure', async () => {
    await tapOn(/^\s*Turn on\s*$/)
    await sleep(2500)
    finger(ENROLLED)
    await waitFor(/^.*On\. Local Hub locks as soon as you leave it/)
    assert.ok(secureFlagged(), 'FLAG_SECURE on the main window')
    const png = shot('04-secure-window')
    console.log(`    screen capture of the secure window: ${png.length} bytes`)
  })

  await step('leaving locks it: the lock screen shows and says nothing about the Hub', async () => {
    await leaveAndComeBack()
    await waitFor(LOCKING)
    await sleep(1000)
    const text = screenText(dump())
    for (const word of [HUB_NAME, '10.0.2.2', 'Connected', 'Open Hub']) assert.ok(!text.includes(word), `${word} shows on the lock screen`)
    assert.ok(secureFlagged())
  })

  await step('Back on the prompt cancels and it stays locked, with no second prompt', async () => {
    key('KEYCODE_BACK')
    await sleep(2500)
    await waitFor(LOCKED)
    await neverShows(/Open Hub|Settings|10\.0\.2\.2|Connected|Unlock Local Hub/, 3000)
    finger(ENROLLED) // a finger with no prompt up opens nothing
    await neverShows(/Open Hub|Settings/, 3000)
    await waitFor(LOCKED)
  })

  await step('the wrong finger never opens it, and five misses lock the sensor out', async () => {
    await tapOn(/^\s*Unlock\s*$/)
    await sleep(2500)
    for (let i = 0; i < 5; i++) {
      finger(STRANGER)
      await sleep(1800)
    }
    await waitFor(/Too many tries/, 15000)
    await neverShows(/Open Hub|Settings/, 2000)
    shot('05-locked-out')
    await sleep(32000) // the sensor's own timeout
  })

  await step('the right finger opens it where it was left, and the home screen comes back connected', async () => {
    await tapOn(/^\s*Unlock\s*$/)
    await sleep(2500)
    finger(ENROLLED)
    await waitFor(/^\s*Turn off\s*$/)
    await tapOn(/^\s*Back\s*$/)
    await waitFor(CONNECTED)
    await waitFor(new RegExp(HUB_NAME))
  })

  await step('stopping the app and starting it again comes up locked', async () => {
    sh(`am force-stop ${APP}`)
    await sleep(800)
    open()
    await waitFor(LOCKING, 40000)
    key('KEYCODE_BACK')
    await sleep(1500)
    await waitFor(LOCKED)
    await tapOn(/^\s*Unlock\s*$/)
    await sleep(2500)
    finger(ENROLLED)
    await waitFor(CONNECTED)
  })

  await step('leaving from the Hub page closes it, and it only comes back after unlocking', async () => {
    await tapOn(/^\s*Open Hub\s*$/)
    await waitFor(/^\s*Done\s*$/)
    await sleep(2000)
    assert.ok(secureFlagged(), 'the Hub page\'s own window is secure too')
    shot('06-hub-page-locked-on')
    await leaveAndComeBack()
    await waitFor(PROMPT)
    assert.match(resumed(), /MainActivity/, 'the Hub page is gone from on top')
    await neverShows(/^\s*Done\s*$/, 2000)
    finger(ENROLLED)
    await waitFor(/^\s*Done\s*$/)
    await sleep(3000)
    assert.ok(!/MainActivity/.test(focus()), `the page should be open again: ${focus()}`)
    shot('07-hub-page-after-unlock')
    await tapOn(/^\s*Done\s*$/)
    await waitFor(CONNECTED)
  })

  await step('the app switcher\'s preview is blank while the lock is on', async () => {
    key('KEYCODE_APP_SWITCH')
    await sleep(3000)
    shot('08-app-switcher')
    const text = screenText(dump())
    for (const word of [HUB_NAME, '10.0.2.2', 'Open Hub']) assert.ok(!text.includes(word), `${word} shows in the switcher`)
    home()
    await sleep(1000)
  })

  await step('a quick action waits for the lock, and an unknown one does nothing', async () => {
    const before = fs.statSync(marker).mtimeMs
    viaLink('localhub://action/compose')
    await waitFor(PROMPT)
    await neverShows(/Send to Hub chat/, 2000)
    finger(ENROLLED)
    await waitFor(/Send to Hub chat/)
    await waitFor(CONNECTED)

    await leaveAndComeBack()
    await waitFor(PROMPT)
    finger(ENROLLED)
    await waitFor(CONNECTED)
    for (const bad of ['publish', 'delete', 'render', 'open?x=1']) {
      viaLink(`localhub://action/${bad}`)
      await sleep(1500)
    }
    await neverShows(/^\s*Done\s*$/, 2000)
    await waitFor(CONNECTED)
    assert.equal(fs.statSync(marker).mtimeMs, before, 'nothing reached chat')
  })

  await step('the widget is registered with the system, with no configuration or data of its own', async () => {
    const widgets = sh('dumpsys appwidget')
    assert.match(widgets, /com\.example\.localhub\/\.HubWidgetProvider/)
    assert.match(sh(`dumpsys package ${APP} | grep -A2 HubWidgetProvider || true`), /HubWidgetProvider/)
  })

  await step('a new fingerprint makes the key unreadable: only pairing again is left', async () => {
    home()
    await sleep(500)
    await enroll(STRANGER)
    open()
    await waitFor(/Local Hub is locked|Unlock Local Hub|Pair this device again/)
    await sleep(1000)
    const prompted = /Pair this device again/.test(screenText(dump()))
    if (!prompted) {
      const unlock = dump().find(n => /^\s*Unlock\s*$/.test(label(n)))
      if (unlock) tap(unlock)
      await sleep(1500)
      finger(STRANGER) // if the key somehow survived, this is the finger that would get in
    }
    await waitFor(/Pair this device again/)
    await neverShows(/Open Hub/, 3000)
    assert.ok(!/Unlock\b/.test(screenText(dump())), 'no way past it')
    shot('09-changed')
  })

  await step('what is stored: ciphertext for the token, and no plain copy', async () => {
    await step('    (installing the debuggable build over it, to read its files)', async () => {
      adb('install', '-r', '-d', debugApk)
    })
    const list = sh(`run-as ${APP} ls shared_prefs`)
    assert.match(list, /hub_lock\.xml/)
    const all = sh(`run-as ${APP} sh -c 'cat shared_prefs/*.xml'`)
    assert.ok(!/device-token/.test(all), 'the plain copy under the secure storage name is gone')
    const blob = sh(`run-as ${APP} cat shared_prefs/hub_lock.xml`).match(/name="token">([^<]+)</)?.[1]
    assert.ok(blob && blob.length > 40, 'ciphertext is there')
    assert.ok(/name="on" value="true"/.test(sh(`run-as ${APP} cat shared_prefs/hub_lock.xml`)))
    const raw = Buffer.from(blob, 'base64').toString('latin1')
    assert.ok(!/^[\x20-\x7e]+$/.test(raw), 'not readable text')
  })

  await step('no address-bearing log, token or pairing code reached the device log', async () => {
    const log = adb('logcat', '-d')
    assert.ok(!/Bearer|Authorization/i.test(log), 'auth header in logcat')
    assert.ok(!log.includes(firstCode), 'pairing code in logcat')
    assert.ok(!log.includes('hello from the emulator'), 'message text in logcat')
  })

  console.log(`\n${passed} of ${passed} emulator checks passed on the minified build against the real Hub`)
} catch (e) {
  failure = e
  try {
    shot('failed')
  } catch {
    console.error('The emulator would not give a screenshot.')
  }
  console.error(`FAILED after ${passed} checks: ${e.stack}`)
} finally {
  child?.kill()
  fs.writeFileSync(path.join(out, 'hub.log'), hubLog.replace(/[A-Za-z0-9_-]{32,}/g, '<long value>'))
}
process.exit(failure ? 1 : 0)
