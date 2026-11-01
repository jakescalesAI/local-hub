// Drives the real shell in a headless browser against the mock Hub, which runs the real pairing module.
// Nothing opens on screen. It proves the shell's logic and copy, not the native parts: QR camera, share
// sheet, Keychain and the Hub web view only exist on a device. Screenshots land in test/ui/out/.
//
//   npm run build:dev && npm run test:ui
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { startMockHub } from '../../dev/mock-hub.mjs'
import { HUB_NAME_REFUSAL } from '../../src/lib/client.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WWW = path.join(HERE, '..', '..', 'www')
const OUT = path.join(HERE, 'out')
const SHELL_PORT = 3156
const HUB_PORT = 3157
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }

fs.mkdirSync(OUT, { recursive: true })
const shell = http.createServer((req, res) => {
  const file = path.join(WWW, new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html'))
  if (!file.startsWith(WWW) || !fs.existsSync(file)) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' }).end(fs.readFileSync(file))
})
await new Promise(r => shell.listen(SHELL_PORT, '127.0.0.1', r))
const SHELL = `http://localhost:${SHELL_PORT}/`
const hub = await startMockHub(HUB_PORT, { name: 'Test <b>Hub</b>' })

const mock = (body) => fetch(`${hub.base}/__mock`, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json())
const code = async () => (await (await fetch(`${hub.base}/api/pair/start`, { method: 'POST', headers: { 'x-hub': '1' } })).json()).code

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' })
const page = await context.newPage()
const consoleText = []
const pageErrors = []
page.on('console', m => consoleText.push(m.text()))
page.on('pageerror', e => pageErrors.push(e.message))

const T = name => page.locator(`[data-test="${name}"]`)
const shot = name => page.screenshot({ path: path.join(OUT, `${name}.png`) })
const stateIs = async state => {
  await page.locator(`[data-test="status"][data-state="${state}"]`).waitFor({ timeout: 10000 })
}
const noSideScroll = async label => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert.equal(over, 0, `${label}: page scrolls sideways by ${over}px`)
}
const recheck = () => page.evaluate(() => window.__hubTest.refresh())
const HUB_REFUSAL = `${HUB_NAME_REFUSAL} If it\u2019s yours, add it to "hosts" in config/hub.json.`
const NOT_THE_HUB = ['Forbidden', '<html>Forbidden by gateway</html>', '']
const cookiesCleared = () => page.evaluate(() => window.__hubCookiesCleared ?? 0)
const pairByLink = async () => {
  const c = await code()
  await page.evaluate(l => window.__hubTest.link(l), `localhub://pair?u=${encodeURIComponent(`http://localhost:${HUB_PORT}`)}&c=${c}`)
  await T('pair-confirm').click()
  await stateIs('ok')
}
const openForget = async () => {
  await T('settings').click()
  await T('forget').click()
  await T('forget-confirm').click()
  await T('scan').waitFor()
}

let passed = 0
async function step(name, fn) {
  await fn()
  passed++
  console.log(`ok  ${name}`)
}

// Writes to localStorage, sessionStorage, cookies and IndexedDB, so a token that is saved and later
// overwritten still shows. The Cache API isn't watched, and nothing here can see native storage.
const storageWrites = []
await page.exposeFunction('__recordStorageWrite', (key, value) => { storageWrites.push([key, value]) })
await page.addInitScript(() => {
  const record = window.__recordStorageWrite
  // A sandboxed frame, like the demo's, has no storage to watch and throws on reading it.
  try {
    void window.localStorage
  } catch {
    return
  }
  const setItem = Storage.prototype.setItem
  Storage.prototype.setItem = function (key, value) {
    record(key, String(value))
    return setItem.call(this, key, value)
  }
  for (const name of ['localStorage', 'sessionStorage']) {
    const real = window[name]
    const watched = new Proxy(real, {
      get: (target, key) => (typeof target[key] === 'function' ? target[key].bind(target) : target[key]),
      set: (target, key, value) => {
        record(String(key), String(value))
        target[key] = value
        return true
      },
    })
    Object.defineProperty(window, name, { get: () => watched })
  }
  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
  Object.defineProperty(document, 'cookie', {
    get: () => cookie.get.call(document),
    set: value => {
      record('document.cookie', String(value))
      cookie.set.call(document, value)
    },
  })
  for (const method of ['add', 'put']) {
    const real = IDBObjectStore.prototype[method]
    IDBObjectStore.prototype[method] = function (value, key) {
      record(`indexedDB.${this.name}`, JSON.stringify(value) ?? '')
      return real.call(this, value, key)
    }
  }
})

let failure = null
try {
  await page.goto(SHELL)

  await step('first run shows the three ways in', async () => {
    await T('scan').waitFor()
    await T('by-hand').waitFor()
    await T('demo').waitFor()
    await noSideScroll('welcome')
    await shot('01-welcome')
  })

  await step('demo mode runs with no network, and shows every state', async () => {
    let requests = 0
    const count = r => { if (!r.url().startsWith(SHELL)) requests++ }
    page.on('request', count)
    await T('demo').click()
    await stateIs('ok')
    await shot('02-demo-home')
    for (const [key, state] of [['asleep', 'asleep'], ['stopped', 'stopped'], ['offline', 'offline'], ['removed', 'removed'], ['ok', 'ok']]) {
      await T(`demo-${key}`).click()
      await stateIs(state)
      if (key !== 'ok') await shot(`03-demo-${key}`)
    }
    await T('open').click()
    await page.frameLocator('iframe').locator('h1').waitFor()
    await shot('04-demo-hub')
    await T('demo-done').click()
    await page.fill('#draft', 'hello demo')
    await T('send').click()
    await page.getByText('Sent. The reply').waitFor()
    await T('settings').click()
    await T('forget').click()
    await T('scan').waitFor()
    page.off('request', count)
    assert.equal(requests, 0, 'the demo must not touch the network')
  })

  await step('the sample code from the review notes opens the demo', async () => {
    await T('by-hand').click()
    await page.fill('#address', 'https://demo.invalid')
    await page.fill('#code', 'demo 2026')
    await T('pair-next').click()
    await T('pair-confirm').click()
    await stateIs('ok')
    await page.getByText('Demo: sample data').waitFor()
    await T('settings').click()
    await T('forget').click()
  })

  await step('pairing refuses a bad code or a non-HTTPS address before sending anything', async () => {
    await T('by-hand').click()
    await page.fill('#address', 'http://hub.example.test')
    await page.fill('#code', 'ABCD1234')
    await T('pair-next').click()
    await page.getByText('must start with https://').waitFor()
    await page.fill('#address', `http://localhost:${HUB_PORT}`)
    await page.fill('#code', 'short')
    await T('pair-next').click()
    await page.getByText('8 letters and numbers').waitFor()
    await shot('05-pair-error')
  })

  await step('a wrong code shows the Hub\'s answer and nothing is stored', async () => {
    await code()
    await page.fill('#code', 'WRONG000')
    await T('pair-next').click()
    await page.getByText('Connect to this computer?').waitFor()
    await shot('06-confirm')
    await T('pair-confirm').click()
    await page.getByText('That code is not right.').waitFor()
    const stored = await page.evaluate(() => Object.keys(localStorage))
    assert.ok(!stored.some(k => k.includes('device-token')), 'nothing stored after a failed claim')
  })

  await step('a 403 while pairing: only the Hub\'s own sentence says the name was refused', async () => {
    const claim = () => T('pair-confirm').click() // a failed claim stays on the confirm screen
    await mock({ answer: 403, answerText: HUB_REFUSAL })
    await claim()
    await page.getByText('refused the name').waitFor()
    await shot('06b-pair-name-refused')
    for (const answerText of NOT_THE_HUB) {
      await mock({ answerText })
      await claim()
      await page.getByText('may have blocked it').waitFor()
      assert.equal(await page.getByText('refused the name').count(), 0, answerText)
      assert.equal(await page.getByText('Forbidden').count(), 0, answerText)
    }
    await shot('06c-pair-refused-unknown-cause')
    await mock({ answer: null, answerText: null })
  })

  await step('a link only fills in the confirm screen: it never pairs by itself', async () => {
    const c = await code()
    const before = (await (await fetch(`${hub.base}/api/pair/devices`)).json()).devices.length
    await page.evaluate(l => window.__hubTest.link(l), `localhub://pair?u=${encodeURIComponent(`http://localhost:${HUB_PORT}`)}&c=${c}`)
    await T('confirm-address').waitFor()
    assert.equal(await T('confirm-address').textContent(), `http://localhost:${HUB_PORT}`)
    await page.waitForTimeout(500)
    assert.equal((await (await fetch(`${hub.base}/api/pair/devices`)).json()).devices.length, before)
    assert.equal(await page.evaluate(() => window.__hubTest.link('https://evil.example.test')), false)
  })

  let token = ''
  await step('a scanned code pairs after the person says yes, and the token stays out of the page', async () => {
    await page.getByRole('button', { name: 'Cancel' }).click()
    const c = await code()
    await page.evaluate(l => { window.__testScan = l }, `localhub://pair?u=${encodeURIComponent(`http://localhost:${HUB_PORT}`)}&c=${c}`)
    await T('scan').click()
    await T('pair-confirm').click()
    await stateIs('ok')
    await shot('07-home-connected')
    token = await page.evaluate(() => Object.entries(localStorage).find(([k]) => k.includes('device-token'))?.[1] ?? '')
    assert.ok(token.length > 20, 'token stored')
    const holders = await page.evaluate(t => Object.entries(localStorage).filter(([, v]) => v.includes(t)).map(([k]) => k), token.replace(/"/g, ''))
    assert.deepEqual(holders, ['localhub_device-token'], 'the token sits under the secure storage key and nowhere else')
    assert.ok(!(await page.content()).includes(token.replace(/"/g, '')), 'token not in the DOM')
    assert.ok(!page.url().includes(token), 'token not in the URL')
  })

  await step('a Hub name with markup shows as plain text', async () => {
    assert.equal(await page.locator('h1').textContent(), 'Test <b>Hub</b>')
    assert.equal(await page.locator('h1 b').count(), 0)
  })

  await step('the connection survives closing the app', async () => {
    await page.reload()
    await stateIs('ok')
  })

  await step('Open Hub opens the paired address with the token', async () => {
    await T('open').click()
    assert.deepEqual(await page.evaluate(() => window.__hubOpened), { url: `http://localhost:${HUB_PORT}/`, hasAuth: true })
  })

  await step('Hub stopped: 502, 503 and 504 say so, and Open is off', async () => {
    for (const answer of [502, 503, 504]) {
      await mock({ answer })
      await recheck()
      await stateIs('stopped')
    }
    assert.equal(await T('open').isDisabled(), true)
    await shot('08-hub-stopped')
  })

  await step('computer asleep: nothing answering says "can\'t reach", and doesn\'t claim why', async () => {
    await mock({ answer: null, down: true })
    await recheck()
    await stateIs('asleep')
    await page.getByText('It may be asleep').waitFor()
    await shot('09-asleep')
  })

  await step('Try again recovers when the computer wakes', async () => {
    await mock({ down: false })
    await T('retry').click()
    await stateIs('ok')
  })

  await step('offline: the OS saying no network wins, and coming back recovers by itself', async () => {
    await context.setOffline(true)
    await stateIs('offline')
    await shot('10-offline')
    await context.setOffline(false)
    await stateIs('ok')
  })

  await step('old Hub: a 404 says it needs updating', async () => {
    await mock({ answer: 404 })
    await recheck()
    await stateIs('outdated')
    await mock({ answer: null })
    await recheck()
    await stateIs('ok')
  })

  await step('a 403 on the status check: only the Hub\'s own sentence blames the name, and Open is off', async () => {
    await mock({ answer: 403, answerText: HUB_REFUSAL })
    await recheck()
    await stateIs('unknownName')
    assert.equal(await T('open').isDisabled(), true)
    await page.getByText('in config/hub.json').waitFor()
    await shot('08b-name-refused')
    for (const answerText of [...NOT_THE_HUB, '{"error":"missing x-hub header"}']) {
      await mock({ answerText })
      await recheck()
      await stateIs('unexpected')
      assert.equal(await T('open').isDisabled(), true)
      assert.equal(await page.getByText('config/hub.json').count(), 0, answerText)
    }
    await shot('08c-refused-unknown-cause')
    await mock({ answer: null, answerText: null })
    await recheck()
    await stateIs('ok')
  })

  await step('share: text arrives in a composer and needs an explicit Send', async () => {
    const before = (await mock({})).sends.length
    await page.evaluate(() => window.__hubTest.share('<img src=x onerror="window.__xss=1"> Look at this page'))
    await T('share-text').waitFor()
    await page.getByText('can contain instructions').waitFor()
    await shot('11-share')
    assert.equal((await mock({})).sends.length, before, 'nothing sent before the person says so')
    assert.equal(await page.evaluate(() => window.__xss), undefined)
    await T('share-send').click()
    await page.getByText('Sent. The reply').waitFor()
    const { sends } = await mock({})
    assert.equal(sends.at(-1).text, '<img src=x onerror="window.__xss=1"> Look at this page')
    assert.equal(sends.at(-1).detached, true, 'the share must ask the Hub to carry on without the phone')
    assert.equal(await page.evaluate(() => window.__xss), undefined)
  })

  await step('share while the computer sleeps: it waits, survives a restart, and sends once on waking', async () => {
    await mock({ down: true })
    await recheck()
    await stateIs('asleep')
    const before = (await mock({})).sends.length
    await page.evaluate(() => window.__hubTest.share('wait for me'))
    await T('share-send').click()
    await T('waiting').waitFor()
    await page.getByText('Saved. It will send').waitFor()
    await shot('12-waiting')
    await page.reload()
    await T('waiting').waitFor()
    await stateIs('asleep')
    assert.equal((await mock({})).sends.length, before)
    await mock({ down: false })
    await T('retry').click()
    await stateIs('ok')
    await page.getByText('waiting message was sent').waitFor()
    await recheck()
    const { sends } = await mock({})
    assert.equal(sends.length, before + 1, 'sent exactly once')
    assert.equal(sends.at(-1).text, 'wait for me')
    assert.equal(await T('waiting').count(), 0)
  })

  await step('a send that drops midway is never repeated without asking', async () => {
    await mock({ dropSends: true })
    const before = (await mock({})).sends.length
    await page.fill('#draft', 'maybe arrived')
    await T('send').click()
    await page.getByText('It may have arrived').waitFor()
    await page.getByText('May have been sent').waitFor()
    await shot('13-unsure')
    await mock({ dropSends: false })
    await recheck()
    await recheck()
    assert.equal((await mock({})).sends.length, before)
    await T('resend').click()
    await page.getByText('waiting message was sent').waitFor()
    assert.equal((await mock({})).sends.length, before + 1)
  })

  await step('a waiting message can be discarded', async () => {
    await mock({ down: true })
    await recheck()
    await stateIs('asleep')
    await page.fill('#draft', 'never mind')
    await T('send').click()
    await T('discard').click()
    assert.equal(await T('waiting').count(), 0)
    await mock({ down: false })
    await recheck()
    await stateIs('ok')
  })

  await step('removed on the Hub: the app says so and offers to pair again', async () => {
    const { devices } = await (await fetch(`${hub.base}/api/pair/devices`)).json()
    assert.equal((await fetch(`${hub.base}/api/pair/devices/${devices.at(-1).id}/remove`, { method: 'POST', headers: { 'x-hub': '1' } })).status, 200)
    await recheck()
    await stateIs('removed')
    await shot('14-removed')
    const cleared = await cookiesCleared()
    await T('pair-again').click()
    await T('scan').waitFor()
    assert.equal(await cookiesCleared(), cleared + 1, 'web sign-in cleared')
    const stored = await page.evaluate(() => Object.keys(localStorage))
    assert.ok(!stored.some(k => k.includes('device-token')), 'token gone')
  })

  await step('Forget this Hub removes this device on the Hub too, and clears the token', async () => {
    const c = await code()
    await page.evaluate(l => window.__hubTest.link(l), `localhub://pair?u=${encodeURIComponent(`http://localhost:${HUB_PORT}`)}&c=${c}`)
    await T('pair-confirm').click()
    await stateIs('ok')
    await T('settings').click()
    await shot('15-settings')
    await T('forget').click()
    await shot('16-forget')
    const cleared = await cookiesCleared()
    await T('forget-confirm').click()
    await T('scan').waitFor()
    assert.equal((await (await fetch(`${hub.base}/api/pair/devices`)).json()).devices.length, 0)
    assert.equal(await cookiesCleared(), cleared + 1, 'web sign-in cleared')
    assert.equal(await T('notice').count(), 0)
    const stored = await page.evaluate(() => Object.keys(localStorage))
    assert.ok(!stored.some(k => k.includes('device-token')), 'token gone')
  })

  await step('Forget with the Hub unreachable still clears this device, and says the Hub keeps it listed', async () => {
    await pairByLink()
    const cleared = await cookiesCleared()
    await mock({ down: true })
    await openForget()
    await mock({ down: false })
    assert.match(await T('notice').textContent(), /couldn't be reached\. It stays on the Hub's list until you remove it there/)
    assert.equal(await cookiesCleared(), cleared + 1, 'web sign-in cleared')
    const { devices } = await (await fetch(`${hub.base}/api/pair/devices`)).json()
    assert.equal(devices.length, 1, 'still listed on the Hub')
    assert.equal((await fetch(`${hub.base}/api/pair/devices/${devices[0].id}/remove`, { method: 'POST', headers: { 'x-hub': '1' } })).status, 200)
  })

  await step('Forget says so when the web sign-in couldn\'t be cleared', async () => {
    await pairByLink()
    await page.evaluate(() => { window.__testCookiesFail = true })
    await openForget()
    await page.evaluate(() => { window.__testCookiesFail = false })
    assert.match(await T('notice').textContent(), /sign-in to the Hub page couldn't be cleared\. Remove it on your Hub/)
  })

  await step('a share that arrives before pairing is kept for after', async () => {
    await page.evaluate(() => window.__hubTest.share('shared first'))
    await page.getByText('Pair with your Hub first').waitFor()
    const c = await code()
    await page.evaluate(l => window.__hubTest.link(l), `localhub://pair?u=${encodeURIComponent(`http://localhost:${HUB_PORT}`)}&c=${c}`)
    await T('pair-confirm').click()
    await T('share-text').waitFor()
    assert.equal(await T('share-text').inputValue(), 'shared first')
    await T('share-cancel').click()
    await T('settings').click()
    await T('forget').click()
    await T('forget-confirm').click()
  })

  await step('secure storage failing at start shows a way out, not a blank page', async () => {
    const failing = await context.newPage()
    const errors = []
    failing.on('pageerror', e => errors.push(e.message))
    await failing.addInitScript(() => { if (!sessionStorage.getItem('storage-back')) window.__testStorageFails = true })
    await failing.goto(SHELL)
    await failing.getByRole('heading', { name: 'Local Hub couldn\'t start' }).waitFor()
    await failing.screenshot({ path: path.join(OUT, '20-start-failed.png') })
    await failing.evaluate(() => sessionStorage.setItem('storage-back', '1'))
    await failing.locator('[data-test="start-retry"]').click()
    await failing.locator('[data-test="scan"]').waitFor()
    assert.deepEqual(errors, [])
    await failing.close()
  })

  await step('a token that can\'t be read shows the same screen, not the welcome screen, and nothing is lost', async () => {
    await pairByLink()
    const failing = await context.newPage()
    await failing.addInitScript(() => { if (!sessionStorage.getItem('storage-back')) window.__testTokenReadFails = true })
    await failing.goto(SHELL)
    await failing.getByRole('heading', { name: 'Local Hub couldn\'t start' }).waitFor()
    assert.equal(await failing.locator('[data-test="scan"]').count(), 0)
    await failing.evaluate(() => sessionStorage.setItem('storage-back', '1'))
    await failing.locator('[data-test="start-retry"]').click()
    await failing.locator('[data-test="status"][data-state="ok"]').waitFor({ timeout: 10000 })
    await failing.close()
  })

  await step('if it keeps failing, the person can forget the Hub here and pair again', async () => {
    const failing = await context.newPage()
    await failing.addInitScript(() => { if (!sessionStorage.getItem('storage-back')) window.__testTokenReadFails = true })
    await failing.goto(SHELL)
    await failing.evaluate(() => { window.__testClearFails = true })
    await failing.locator('[data-test="start-forget"]').click()
    await failing.getByText('That didn\'t work either').waitFor()
    await failing.evaluate(() => {
      window.__testClearFails = false
      sessionStorage.setItem('storage-back', '1')
    })
    await failing.locator('[data-test="start-forget"]').click()
    await failing.locator('[data-test="scan"]').waitFor()
    await failing.close()
    const { devices } = await (await fetch(`${hub.base}/api/pair/devices`)).json()
    assert.equal(devices.length, 1, 'still listed on the Hub, as the screen says')
    assert.equal((await fetch(`${hub.base}/api/pair/devices/${devices[0].id}/remove`, { method: 'POST', headers: { 'x-hub': '1' } })).status, 200)
    await page.reload()
    await T('scan').waitFor()
  })

  await step('no token was ever written anywhere but secure storage', async () => {
    const isToken = ([key]) => key === 'localhub_device-token'
    const tokens = storageWrites.filter(isToken).map(([, value]) => value.replace(/"/g, ''))
    assert.ok(tokens.length >= 3, 'several pairings were watched')
    for (const [key, value] of storageWrites.filter(w => !isToken(w))) {
      assert.ok(!tokens.some(t => value.includes(t)), `token written under ${key}`)
    }
  })

  await step('the token and codes never reach the console, and the page raises no errors', async () => {
    const all = consoleText.join('\n')
    assert.ok(!all.includes(token.replace(/"/g, '')), 'token in console')
    assert.ok(!/Bearer/i.test(all), 'auth header in console')
    assert.deepEqual(pageErrors, [])
    assert.ok(!/Content Security Policy|Refused to/i.test(all), `CSP problem:\n${all}`)
  })

  await step('narrow phones and dark mode hold together', async () => {
    await page.setViewportSize({ width: 320, height: 640 })
    await noSideScroll('welcome at 320')
    await T('demo').click()
    await stateIs('ok')
    await noSideScroll('home at 320')
    await shot('17-narrow')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 390, height: 844 })
    await shot('18-dark')
    await page.setViewportSize({ width: 820, height: 1180 })
    await noSideScroll('tablet')
    await shot('19-tablet')
  })

  console.log(`\n${passed} of ${passed} UI checks passed in headless Edge, against the ${path.relative(path.join(HERE, '..', '..'), WWW)} dev build`)
} catch (e) {
  failure = e
  await shot('failed').catch(() => {})
  console.error(`FAILED after ${passed} checks: ${e.message}`)
  console.error('console:', consoleText.slice(-10).join('\n'))
} finally {
  await browser.close().catch(() => {})
  hub.stop()
  shell.close()
  shell.closeAllConnections()
}
process.exit(failure ? 1 : 0)
