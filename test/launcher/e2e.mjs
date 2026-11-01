// Runs the search bar in headless Chromium against a scratch copy of the hub with an invented config
// and an invented home folder. It never touches a running hub or your own files, and it never starts a
// real chat or opens a real folder. Every value here is invented.
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> LAUNCHER_TEST_CHROMIUM=<path to chrome> node test/launcher/e2e.mjs
//
// Optional: HUB_TEST_PORT (default 3197), LAUNCHER_TEST_SHOTS (folder for screenshots).
// Exit codes: 0 passed, 1 a check failed, 3 the browser couldn't start, so nothing was proven.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = Number(process.env.HUB_TEST_PORT || 3197)
const BASE = `http://127.0.0.1:${PORT}`
const INSECURE = `http://hub-test.invalid:${PORT}`
const SENTINEL = 'SNIPPET-SENTINEL-7f3a'
const FAKE_KEY = 'invented-test-key-000111'
const PASSCODE = 'invented-passcode-000111'
const XSS = '<img src=x onerror="window.__xss=1">'
const XSS2 = '<script>window.__xss=2</script>'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64')
const SHOTS = process.env.LAUNCHER_TEST_SHOTS || ''
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-launcher-e2e-'))

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`)
}
const section = name => console.log(`\n== ${name}`)
const sleep = ms => new Promise(r => setTimeout(r, ms))

/* ---------- a scratch hub ---------- */

function freshCopy(name, { config = true } = {}) {
  const dir = path.join(scratch, name)
  const skip = new Set(['.git', 'data', 'config', 'test', 'node_modules'])
  fs.mkdirSync(dir, { recursive: true })
  for (const entry of fs.readdirSync(REPO)) {
    if (!skip.has(entry)) fs.cpSync(path.join(REPO, entry), path.join(dir, entry), { recursive: true })
  }
  if (config) {
    fs.mkdirSync(path.join(dir, 'config'))
    fs.writeFileSync(path.join(dir, 'config', 'hub.json'), JSON.stringify({ name: 'Test Hub', owner: 'Test Owner', access: 'localhost', addons: {} }))
    const salt = crypto.randomBytes(16)
    const hubPasscode = `scrypt$${salt.toString('hex')}$${crypto.scryptSync(PASSCODE, salt, 32).toString('hex')}`
    fs.writeFileSync(path.join(dir, 'config', 'secrets.json'), JSON.stringify({ anthropic: FAKE_KEY, hubPasscode }))
  }
  return dir
}

function fixtureHome() {
  const home = path.join(scratch, 'home')
  if (fs.existsSync(home)) return home
  fs.mkdirSync(path.join(home, 'alpha-folder'), { recursive: true })
  fs.mkdirSync(path.join(home, '.ssh'))
  fs.writeFileSync(path.join(home, 'alpha-notes.txt'), 'invented notes')
  fs.writeFileSync(path.join(home, 'alpha-pic.png'), PNG)
  fs.writeFileSync(path.join(home, "alpha'&file.txt"), 'odd name')
  fs.writeFileSync(path.join(home, '.ssh', 'id_test'), 'invented key')
  fs.writeFileSync(path.join(home, 'secrets.json'), JSON.stringify({ key: FAKE_KEY }))
  return home
}

async function startHub(dir) {
  const logs = []
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: dir,
    env: { ...process.env, HUB_PORT: String(PORT), USERPROFILE: fixtureHome(), HOME: fixtureHome() },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', d => logs.push(String(d)))
  child.stderr.on('data', d => logs.push(String(d)))
  const exited = new Promise(r => child.on('exit', r))
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/`)).ok) return { dir, logs, stop: async () => { child.kill(); await exited }, text: () => logs.join('') } } catch {}
    await sleep(100)
  }
  child.kill()
  await exited
  throw new Error(`the scratch hub didn't start: ${logs.join('').slice(-400)}`)
}

const api = async (method, url, body, headers = { 'x-hub': '1' }) => {
  const res = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}

/* ---------- page helpers ---------- */

function watch(page, label, sink) {
  page.on('console', m => { if (m.type() === 'error') sink.push({ label, text: m.text(), url: m.location().url }) })
  page.on('pageerror', e => sink.push({ label, text: `pageerror: ${e.message}`, url: '' }))
}
const rowTitles = page => page.evaluate(() => [...document.querySelectorAll('.lch-row .lch-title')].map(t => t.textContent))
const barOpen = page => page.evaluate(() => !!document.querySelector('#hub-launcher.on'))
const activeClass = page => page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName)
const stubOpen = page => page.evaluate(() => { window.__opened = []; window.open = (...a) => { window.__opened.push(a); return null } })
async function goHome(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.HUB && window.HubChat)
}
async function openBar(page) {
  const lib = page.waitForResponse(/\/api\/launcher\/library/)
  await page.keyboard.press('Control+k')
  await lib
  await page.waitForSelector('#hub-launcher.on .lch-row')
}
async function closeBar(page) {
  for (let i = 0; i < 4 && await barOpen(page); i++) await page.keyboard.press('Escape')
}
async function search(page, q) {
  await page.fill('.lch-input', q)
}
async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

// Finds the row, waiting for a slow one such as a file result.
async function rowIndex(page, title, timeout = 3000) {
  const handle = await page.waitForFunction(t => {
    const i = [...document.querySelectorAll('.lch-row .lch-title')].findIndex(x => x.textContent === t)
    return i >= 0 ? i + 1 : 0
  }, title, { timeout }).catch(() => null)
  return handle ? (await handle.jsonValue()) - 1 : -1
}

/* ---------- the main scenario ---------- */

async function mainScenario(browser, hub, errors, noise) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true })
  const page = await context.newPage()
  watch(page, 'desktop', errors)
  await goHome(page)
  check('The hub page loads with the launcher present', await page.evaluate(() => typeof window.LAUNCHER?.open === 'function'))

  section('Search bar: opening and keys')
  await openBar(page)
  check('Ctrl+K opens the bar with the box focused', await activeClass(page) === 'lch-input')
  check('The page loads the file exactly once', await page.evaluate(() => document.querySelectorAll('script[src="/tabs/launcher.js"]').length) === 1)
  check('Only one copy of the bar runs', await page.evaluate(() => document.querySelectorAll('.lch-input').length) === 1)
  check('It adds no tab of its own', await page.evaluate(() => !(window.HUB_CONF?.pluginTabs || []).includes('launcher') && !window.HUB.allApps().includes('launcher') && !window.HUB.visibleTabs().includes('launcher') && !window.TABS?.launcher))
  const catalog = await api('GET', '/api/hub/settings/catalog')
  check("The settings catalog doesn't list it as a tab", !catalog.json.pluginTabs.includes('launcher') && !catalog.json.tabs.includes('launcher') && !catalog.json.apps.includes('launcher'))
  await page.evaluate(() => { window.firstLauncher = window.LAUNCHER })
  await page.addScriptTag({ url: '/tabs/launcher.js' })
  check('Loading the file a second time changes nothing', await page.evaluate(() => window.LAUNCHER === window.firstLauncher && document.querySelectorAll('.lch-input').length === 1) && await barOpen(page))
  check('It sits above the chat bar', await page.evaluate(() => { const r = document.elementFromPoint(innerWidth / 2, innerHeight - 40); return r?.id === 'hub-launcher' }))
  const envBefore = await page.evaluate('env')
  await page.keyboard.type('1/fr2')
  check('Typed keys stay in the box and don\'t reach page shortcuts', await page.inputValue('.lch-input') === '1/fr2' && await page.evaluate('env') === envBefore && await page.evaluate(() => document.querySelector('#q') !== document.activeElement))
  await page.keyboard.press('Backspace')
  check('Backspace edits the box', await page.inputValue('.lch-input') === '1/fr')
  await page.keyboard.press('Escape')
  check('Esc clears first', await page.inputValue('.lch-input') === '' && await barOpen(page))
  await page.keyboard.press('Escape')
  check('Esc then closes', !(await barOpen(page)))
  await page.evaluate(() => window.LAUNCHER.open())
  check('window.LAUNCHER.open() opens it', await barOpen(page) && await page.evaluate(() => window.LAUNCHER.isOpen === true))
  await page.evaluate(() => window.LAUNCHER.toggle())
  check('window.LAUNCHER.toggle() closes it', !(await barOpen(page)))
  await openBar(page)
  await page.mouse.click(5, 5)
  check('A click outside closes it', !(await barOpen(page)))
  await openBar(page)
  await page.click('.lch-foot', { force: true })
  await page.keyboard.press('Escape')
  check('Esc still works after a click left focus outside the box', !(await barOpen(page)))
  await openBar(page)
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab')
  check('Tab stays inside the bar', await page.evaluate(() => document.getElementById('hub-launcher').contains(document.activeElement)))
  await closeBar(page)

  section('Links: add, edit, delete, open')
  await openBar(page)
  await search(page, 'add a link')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.lch-form')
  await page.keyboard.type('Alpha One')
  await page.keyboard.press('Tab')
  await page.keyboard.type('alpha-one.example')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.lch-input')
  let lib = (await api('GET', '/api/launcher/library')).json
  check('A link added from the form is saved', lib.links.length === 1 && lib.links[0].url === 'https://alpha-one.example/', lib.links[0]?.url)
  check('Saving returns to the box', await activeClass(page) === 'lch-input')
  await search(page, 'add a link')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.lch-form')
  await page.fill('[data-f=name]', 'Refused')
  await page.fill('[data-f=target]', 'javascript:window.__xss=9')
  noise.on = true
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.lch-err')?.textContent)
  noise.on = false
  check('A javascript: link is refused in the form', /http/.test(await page.textContent('.lch-err')) && (await api('GET', '/api/launcher/library')).json.links.length === 1, await page.textContent('.lch-err'))
  await page.fill('[data-f=name]', 'Alpha Two')
  await page.fill('[data-f=target]', 'https://alpha-two.example/page')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.lch-input')
  await search(page, 'add a link')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.lch-form')
  await page.selectOption('[data-f=kind]', 'folder')
  check('Changing the type redraws the field and keeps the form', await page.getAttribute('[data-f=target]', 'placeholder') === 'Full path of the folder')
  await page.fill('[data-f=name]', 'Fixture folder')
  await page.fill('[data-f=target]', path.join(fixtureHome(), 'alpha-folder'))
  await page.click('.lch-btn.go')
  await page.waitForSelector('.lch-input')
  await search(page, 'add a link')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.lch-form')
  await page.selectOption('[data-f=kind]', 'folder')
  await page.fill('[data-f=name]', 'Keys')
  await page.fill('[data-f=target]', path.join(fixtureHome(), '.ssh'))
  noise.on = true
  await page.click('.lch-btn.go')
  await page.waitForFunction(() => document.querySelector('.lch-err')?.textContent)
  noise.on = false
  check('A folder that holds keys is refused', /keys/.test(await page.textContent('.lch-err')))
  await page.keyboard.press('Escape')
  await page.waitForSelector('.lch-input')
  await closeBar(page)

  await stubOpen(page)
  await openBar(page)
  await search(page, 'alpha')
  let titles = await rowTitles(page)
  check('Search finds links', titles.includes('Alpha One') && titles.includes('Alpha Two'), titles.slice(0, 3).join(', '))
  check('With no use yet, order is alphabetical', titles.indexOf('Alpha One') < titles.indexOf('Alpha Two'))
  for (let i = 0; i < 3; i++) {
    await search(page, 'alpha two')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => !document.querySelector('#hub-launcher.on'))
    if (i < 2) await openBar(page)
  }
  const opened = await page.evaluate(() => window.__opened)
  check('Enter opens the web link with no opener and no referrer', opened.length === 3 && opened[0][0] === 'https://alpha-two.example/page' && /noopener/.test(opened[0][2]) && /noreferrer/.test(opened[0][2]), opened[0]?.join(' '))
  await openBar(page)
  await search(page, 'alpha')
  titles = await rowTitles(page)
  check('Recent use moves it up the search', titles.indexOf('Alpha Two') < titles.indexOf('Alpha One'), titles.slice(0, 2).join(', '))
  await search(page, '')
  titles = await rowTitles(page)
  check('Recent use comes first with nothing typed', titles[0] === 'Alpha Two', titles[0])
  await sleep(1700)
  lib = (await api('GET', '/api/launcher/library')).json
  const twoId = lib.links.find(l => l.name === 'Alpha Two').id
  check('Use is counted on the hub', lib.usage[`link:${twoId}`]?.n === 3, JSON.stringify(lib.usage[`link:${twoId}`]))
  check('Use is saved to disk', JSON.parse(fs.readFileSync(path.join(hub.dir, 'data', 'launcher.json'), 'utf8')).usage[`link:${twoId}`]?.n === 3)
  await search(page, 'alpha one')
  await page.keyboard.press('Control+e')
  await page.waitForSelector('.lch-form')
  check('Ctrl+E edits the selected link', await page.inputValue('[data-f=name]') === 'Alpha One' && await page.inputValue('[data-f=target]') === 'https://alpha-one.example/')
  await page.fill('[data-f=name]', 'Alpha Uno')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.lch-input')
  check('The edit is saved', (await api('GET', '/api/launcher/library')).json.links.some(l => l.name === 'Alpha Uno'))
  await search(page, 'alpha uno')
  await page.hover('.lch-row')
  await page.click('.lch-edit')
  await page.waitForSelector('[data-delete]')
  check('The pencil opens the form', await page.inputValue('[data-f=name]') === 'Alpha Uno')
  await page.click('[data-delete]')
  check('Delete asks once more', await page.textContent('[data-delete]') === 'Confirm delete' && (await api('GET', '/api/launcher/library')).json.links.some(l => l.name === 'Alpha Uno'))
  await page.click('[data-delete]')
  await page.waitForSelector('.lch-input')
  check('Delete removes it', !(await api('GET', '/api/launcher/library')).json.links.some(l => l.name === 'Alpha Uno'))
  await closeBar(page)

  section('Snippets: add, copy')
  await openBar(page)
  await search(page, 'add a snippet')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.lch-form')
  await page.keyboard.type('Sentinel note')
  await page.keyboard.press('Tab')
  await page.keyboard.type('sentkw')
  await page.keyboard.press('Tab')
  const snippetText = `first line ${SENTINEL}\nsecond & <line>`
  await page.fill('[data-f=text]', snippetText)
  await page.keyboard.press('Control+Enter')
  await page.waitForSelector('.lch-input')
  lib = (await api('GET', '/api/launcher/library')).json
  check('Ctrl+Enter saves a snippet', lib.snippets[0]?.text === snippetText)
  check('GET /api/launcher/snippets gives the desktop app its list', (await api('GET', '/api/launcher/snippets')).json.snippets[0].keyword === 'sentkw')
  await search(page, 'sentkw')
  check('An exact keyword finds the snippet first', (await rowTitles(page))[0] === 'Sentinel note')
  await shot(page, 'desktop-snippet')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('#hub-launcher.on'))
  const pasted = await page.evaluate(() => navigator.clipboard.readText())
  check('Enter copies it to the clipboard', pasted.replace(/\r\n/g, '\n') === snippetText, JSON.stringify(pasted).slice(0, 60))
  check('A message stays after the bar closes', await page.evaluate(() => { const t = document.querySelector('.lch-toast.on'); return t?.textContent === 'Copied Sentinel note' && getComputedStyle(t).display !== 'none' }))
  await openBar(page)
  await search(page, 'second')
  check('Search reads snippet text', (await rowTitles(page)).includes('Sentinel note'))
  await closeBar(page)

  section('Tabs, actions and Ask chat')
  await openBar(page)
  const target = await page.evaluate(() => window.HUB.allApps().find(a => a !== 'chat' && a !== env && typeof window.HUB.appMeta(a)?.label === 'string'))
  const label = await page.evaluate(id => window.HUB.appMeta(id).label, target)
  await search(page, label)
  const tabAt = await rowIndex(page, label)
  check('Search finds a hub tab', tabAt >= 0, label)
  await page.click(`.lch-row[data-i="${tabAt}"]`)
  check('Choosing it moves to that tab', await page.evaluate('env') === target && !(await barOpen(page)), target)
  await openBar(page)
  await search(page, 'export')
  check('Search finds actions', (await rowTitles(page)).includes('Export links and snippets'))
  await search(page, 'style')
  check('Hub actions are listed', (await rowTitles(page)).includes('Edit Style'))
  await closeBar(page)
  await page.evaluate(() => { window.__asked = []; window.HubChat.ask = t => window.__asked.push(t); window.HubChat.open = () => {} })
  await openBar(page)
  await search(page, 'what is on today')
  const askAt = await rowIndex(page, 'Ask chat: what is on today')
  check('Ask chat row appears for any query', askAt >= 0)
  await page.keyboard.press('Enter')
  check('Enter hands it to the chat', (await page.evaluate(() => window.__asked))[0] === 'what is on today')
  check('Ask chat closes the bar', !(await barOpen(page)))

  section('File search through the hub\'s own route')
  await page.evaluate(() => { window.__edit = null; window.__env = null; window.__dir = null; window.editFile = (...a) => { window.__edit = a }; window.setEnv = id => { window.__env = id }; window.loadDir = (...a) => { window.__dir = a } })
  await openBar(page)
  await search(page, 'alpha-notes')
  const noteAt = await rowIndex(page, 'alpha-notes.txt')
  check('A file result appears', noteAt >= 0)
  check('Files sit below Ask chat, so the list doesn\'t jump', noteAt > await rowIndex(page, 'Ask chat: alpha-notes'))
  await page.click(`.lch-row[data-i="${noteAt}"]`)
  check('A text file opens in the hub\'s editor', (await page.evaluate(() => window.__edit))?.join() === 'laptop,alpha-notes.txt')
  await openBar(page)
  await search(page, 'alpha-folder')
  const dirAt = await rowIndex(page, 'alpha-folder')
  await page.click(`.lch-row[data-i="${dirAt}"]`)
  const dirArgs = await page.evaluate(() => [window.__env, window.__dir])
  check('A folder opens in the file browser', dirArgs[0] === 'drives' && dirArgs[1]?.[0] === 'drives' && dirArgs[1][1].endsWith('/alpha-folder'), dirArgs[1]?.[1]?.split('/').pop())
  await openBar(page)
  await search(page, "alpha'&")
  check('A file name with odd characters shows as written', await rowIndex(page, "alpha'&file.txt") >= 0)
  for (const q of ['id_test', 'secrets']) {
    await search(page, q)
    await sleep(900)
    const rows = (await rowTitles(page)).filter(t => !t.startsWith('Ask chat'))
    check(`The key-file block holds: searching "${q}" shows no file`, !rows.some(t => /id_test|secrets\.json/.test(t)), rows.join(' | '))
  }
  const direct = await api('GET', '/api/files/laptop/search?path=&q=id_test')
  check('The route itself hides key files', direct.json.results.length === 0)
  await closeBar(page)
  await goHome(page)

  section('Hostile input: script in every title')
  const hostile = [
    await api('POST', '/api/launcher/links', { name: XSS, url: `https://hostile.example/"><img src=x onerror=window.__xss=3>` }),
    await api('POST', '/api/launcher/links', { name: XSS2, url: 'https://hostile2.example/' }),
    await api('POST', '/api/launcher/snippets', { name: XSS, text: `${XSS}${XSS2}`, keyword: '<b>k</b>' }),
    await api('POST', '/api/launcher/snippets', { name: `"><svg onload=window.__xss=4>`, text: `</textarea>${XSS}` }),
  ]
  check('They save as plain text', hostile.every(h => h.status === 200))
  await openBar(page)
  await search(page, 'hostile')
  await search(page, 'img')
  await page.waitForTimeout(200)
  check('Listing them runs nothing', await page.evaluate(() => window.__xss === undefined))
  check('Nothing from them became an element', await page.evaluate(() => !document.querySelector('#hub-launcher img[src="x"], #hub-launcher script, #hub-launcher svg[onload], #hub-launcher b')))
  check('The title reads as written', (await rowTitles(page)).includes(XSS))
  await page.evaluate(() => { window.__a = [...document.querySelectorAll('.lch-row')].findIndex(r => r.querySelector('.lch-word')?.textContent === 'Snippet') })
  await page.click(`.lch-row:has(.lch-word:text-is("Snippet")) .lch-edit`, { force: true })
  await page.waitForSelector('.lch-form')
  check('The edit form holds it as a value and runs nothing', await page.inputValue('[data-f=name]') === XSS && await page.evaluate(() => window.__xss === undefined && !document.querySelector('.lch-form img[src="x"]')))
  await page.keyboard.press('Escape')
  await page.waitForSelector('.lch-input')
  await search(page, 'textarea')
  await page.waitForTimeout(100)
  await page.keyboard.press('Control+e')
  await page.waitForSelector('[data-f=text]')
  check('Text can\'t break out of the editor', (await page.inputValue('[data-f=text]')).startsWith('</textarea>') && await page.evaluate(() => window.__xss === undefined))
  await page.keyboard.press('Escape')
  await page.waitForSelector('.lch-input')
  await search(page, 'textarea')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('#hub-launcher.on'))
  check('The message after copying it runs nothing', await page.evaluate(() => window.__xss === undefined && !document.querySelector('.lch-toast svg')))
  await shot(page, 'desktop-hostile')

  section('Import and export from the page')
  const importFile = path.join(scratch, 'fixture-import.json')
  fs.writeFileSync(importFile, JSON.stringify({ quicklinks: [{ name: 'Tracker', link: 'https://tracker.example/board' }, { name: 'Bad script', link: 'javascript:alert(1)' }, { name: XSS, link: 'data:text/html,x' }, { name: 'Vault', link: 'obsidian://open?vault=Invented' }], snippets: [{ name: 'Greeting', text: 'Hello there', keyword: 'hi' }] }))
  await openBar(page)
  await search(page, 'import')
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-file]')
  await page.setInputFiles('[data-file]', importFile)
  await page.click('.lch-btn.go')
  await page.waitForSelector('.lch-report')
  let report = await page.textContent('.lch-report')
  check('Import adds what it can and reports the rest', /Added 1 link and 1 snippet/.test(report) && /Bad script/.test(report) && /Vault/.test(report), report.slice(0, 80))
  check('A hostile name in the report runs nothing', await page.evaluate(() => window.__xss === undefined && !document.querySelector('.lch-report img')))
  await shot(page, 'desktop-import')
  await page.setInputFiles('[data-file]', importFile)
  await page.check('[data-local]')
  await page.click('.lch-btn.go')
  await page.waitForFunction(() => /Added 1 link and 0 snippets/.test(document.querySelector('.lch-report')?.textContent))
  report = await page.textContent('.lch-report')
  check('Bringing it in again adds only the local link it was told to', /2 already here/.test(report), report.slice(0, 80))
  await page.fill('[data-paste]', JSON.stringify([{ name: 'Pasted', text: 'pasted text', keyword: 'pst' }]))
  await page.click('.lch-btn.go')
  await page.waitForFunction(() => /Added 0 links and 1 snippet/.test(document.querySelector('.lch-report')?.textContent))
  check('Pasted JSON imports too', (await api('GET', '/api/launcher/library')).json.snippets.some(s => s.keyword === 'pst'))
  await page.fill('[data-paste]', '{ not json')
  await page.click('.lch-btn.go')
  await page.waitForFunction(() => document.querySelector('.lch-err')?.textContent)
  check('Bad JSON gets a plain message', /valid JSON/.test(await page.textContent('.lch-err')))
  await page.keyboard.press('Escape')
  await page.waitForSelector('.lch-input')
  await search(page, 'export')
  const dl = page.waitForEvent('download')
  await page.keyboard.press('Enter')
  const download = await dl
  const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'))
  check('Export downloads the documented file', download.suggestedFilename() === 'local-hub-links-and-snippets.json' && exported.format === 'local-hub-launcher' && exported.version === 1 && exported.snippets.some(s => s.keyword === 'hi'), `${exported.links.length} links, ${exported.snippets.length} snippets`)
  check('Export has no ids or usage', !JSON.stringify(exported).includes('"id"') && exported.usage === undefined)
  await page.waitForTimeout(100)

  section('Icons in the page')
  lib = (await api('GET', '/api/launcher/library')).json
  const iconHash = crypto.createHash('sha256').update('https://cached-icon.example').digest('hex').slice(0, 32)
  fs.mkdirSync(path.join(hub.dir, 'data', 'launcher-icons'), { recursive: true })
  fs.writeFileSync(path.join(hub.dir, 'data', 'launcher-icons', `${iconHash}.png`), PNG)
  await api('POST', '/api/launcher/links', { name: 'Cached icon', url: 'https://cached-icon.example/' })
  await openBar(page)
  await search(page, 'cached icon')
  await page.waitForFunction(() => document.querySelector('.lch-row .lch-ic img')?.naturalWidth > 0)
  check('A cached icon shows in its row', true)
  await search(page, 'tracker')
  await page.waitForFunction(() => document.querySelector('.lch-row .lch-ic')?.textContent === 'T', null, { timeout: 12000 })
  check('A site with no icon falls back to its letter, with no console error', !errors.some(e => /launcher\/icon/.test(`${e.url}${e.text}`)))
  await closeBar(page)

  section('Hostile requests to the hub')
  const anyLink = lib.links[0].id
  const anySnippet = lib.snippets[0].id
  const countBefore = JSON.stringify((await api('GET', '/api/launcher/library')).json)
  const noHub = [
    ['POST', '/api/launcher/links', { name: 'x', url: 'https://x.example' }],
    ['PUT', `/api/launcher/links/${anyLink}`, { name: 'x', url: 'https://x.example' }],
    ['DELETE', `/api/launcher/links/${anyLink}`],
    ['POST', '/api/launcher/snippets', { name: 'x', text: 'x' }],
    ['PUT', `/api/launcher/snippets/${anySnippet}`, { name: 'x', text: 'x' }],
    ['DELETE', `/api/launcher/snippets/${anySnippet}`],
    ['POST', '/api/launcher/use', { key: 'tab:home' }],
    ['POST', '/api/launcher/open', { id: anyLink }],
    ['POST', '/api/launcher/import', { data: [] }],
  ]
  const statuses = []
  for (const [method, url, body] of noHub) statuses.push((await api(method, url, body, {})).status)
  check('Every change without x-hub gets 403', statuses.every(s => s === 403), statuses.join(','))
  await sleep(50)
  check('And nothing changed', JSON.stringify((await api('GET', '/api/launcher/library')).json) === countBefore)
  check('javascript: is refused by the API too', (await api('POST', '/api/launcher/links', { name: 'x', url: 'JaVa\tScRiPt:alert(1)' })).status === 400)

  const local = await new Promise(resolve => {
    const hits = []
    const server = http.createServer((req, res) => { hits.push(req.url); res.end(PNG) })
    server.listen(0, '127.0.0.1', () => resolve({ hits, server, port: server.address().port }))
  })
  const privateTargets = [`http://127.0.0.1:${local.port}/`, `http://localhost:${local.port}/`, `http://2130706433:${local.port}/`, `http://[::ffff:127.0.0.1]:${local.port}/`, 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://192.168.0.1/', 'http://100.100.100.100/']
  const iconStatus = []
  const began = Date.now()
  for (const url of privateTargets) {
    const saved = await api('POST', '/api/launcher/links', { name: `private ${iconStatus.length}`, url })
    iconStatus.push(saved.status === 200 ? (await api('GET', `/api/launcher/icon?id=${saved.json.id}`)).status : `save ${saved.status}`)
  }
  check('Private-address icon targets give no icon', iconStatus.every(s => s === 204), iconStatus.join(','))
  check('Nothing reached the local listener', local.hits.length === 0, `${local.hits.length} hits`)
  check('They were refused without waiting on a connection', Date.now() - began < 2000, `${Date.now() - began} ms`)
  local.server.close()
  const pathTry = await api('GET', `/api/launcher/icon?url=${encodeURIComponent(`http://127.0.0.1:${local.port}/`)}`)
  check('The icon route takes no address from the request', pathTry.status === 204)
  for (const url of ['/api/launcher/library', '/api/launcher/snippets', '/api/launcher/export', '/launcher', '/hub-config.js', '/tabs/launcher.js']) {
    const res = await api('GET', url)
    check(`No key reaches ${url}`, !res.text.includes(FAKE_KEY))
  }
  check('Snippet text is not in the hub\'s logs', !hub.text().includes(SENTINEL), `${hub.text().length} bytes of log`)
  const strays = fs.readdirSync(hub.dir).concat(fs.readdirSync(path.join(hub.dir, 'data'))).filter(f => /launcher/.test(f) && !['launcher.mjs', 'launcher.html', 'LAUNCHER.md', 'launcher.json', 'launcher-icons'].includes(f))
  check('Saved data stays in data/', fs.existsSync(path.join(hub.dir, 'data', 'launcher.json')) && strays.length === 0, strays.join(','))
  await context.close()
}

/* ---------- clipboard fallbacks ---------- */

async function clipboardScenario(browser, errors) {
  section('Copy where the clipboard API isn\'t available (plain http, another name)')
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  // Reached by another name, the hub is someone else's visit: nothing of the launcher shows without the passcode.
  const signedOut = (method, url) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: url, headers: { host: 'hub-test.invalid', 'x-hub': '1', 'content-type': 'application/json' } }, res => {
      let text = ''
      res.on('data', d => { text += d })
      res.on('end', () => resolve({ status: res.statusCode, text }))
    })
    req.on('error', reject)
    req.end(method === 'GET' ? undefined : '{}')
  })
  for (const [method, url] of [['GET', '/launcher'], ['GET', '/api/launcher/library'], ['GET', '/api/launcher/snippets'], ['GET', '/api/launcher/export'], ['POST', '/api/launcher/open']]) {
    const res = await signedOut(method, url)
    check(`Without the passcode, ${method} ${url} is refused from another name`, res.status === 401 && !res.text.includes('Hello there'), String(res.status))
  }
  const page = await context.newPage()
  watch(page, 'insecure', errors)
  await page.goto(`${INSECURE}/`, { waitUntil: 'load' })
  await page.fill('#p', PASSCODE)
  await page.click('main button')
  await page.waitForFunction(() => window.LAUNCHER)
  check('This page is not a secure context', await page.evaluate(() => window.isSecureContext === false && !navigator.clipboard))
  await openBar(page)
  await search(page, 'greeting')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('#hub-launcher.on'))
  check('The fallback reports a copy', await page.evaluate(() => document.querySelector('.lch-toast.on')?.textContent) === 'Copied Greeting')
  await openBar(page)
  await page.keyboard.press('Control+v')
  check('Pasting gets the text back', await page.inputValue('.lch-input') === 'Hello there', await page.inputValue('.lch-input'))
  await search(page, 'greeting')
  await page.evaluate(() => { document.execCommand = () => false })
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-copy]')
  check('If that fails too, the text is shown selected', await page.evaluate(() => { const t = document.querySelector('[data-copy]'); return t.value === 'Hello there' && t.selectionEnd - t.selectionStart === t.value.length }))
  await shot(page, 'desktop-copy-fallback')
  await page.keyboard.press('Escape')
  await page.waitForSelector('.lch-input')
  await context.close()
}

/* ---------- phone ---------- */

async function phoneScenario(browser, errors) {
  section('Phone width, by touch')
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  watch(page, 'phone', errors)
  await goHome(page)
  await page.evaluate(() => window.LAUNCHER.open())
  await page.waitForSelector('#hub-launcher.on .lch-row')
  await search(page, 'alpha')
  // Tabs paint at once; saved links arrive with the library a moment later.
  await page.waitForSelector('.lch-edit', { state: 'attached' })
  const box = await page.evaluate(() => {
    const p = document.querySelector('.lch-panel').getBoundingClientRect()
    const row = document.querySelector('.lch-row').getBoundingClientRect()
    const edit = document.querySelector('.lch-edit').getBoundingClientRect()
    const x = document.querySelector('.lch-x').getBoundingClientRect()
    return { left: p.left, right: p.right, bottom: p.bottom, row: row.height, edit: [edit.width, edit.height], x: [x.width, x.height], scroll: document.documentElement.scrollWidth, width: innerWidth, font: parseFloat(getComputedStyle(document.querySelector('.lch-input')).fontSize), hidden: getComputedStyle(document.querySelector('.lch-foot')).display, editShown: getComputedStyle(document.querySelector('.lch-edit')).visibility }
  })
  check('The panel fits with no sideways scroll', box.left >= 0 && box.right <= box.width && box.bottom <= 844 && box.scroll <= box.width, JSON.stringify([box.left, box.right, box.scroll]))
  check('Rows and buttons are big enough to tap', box.row >= 48 && box.edit[0] >= 44 && box.edit[1] >= 44 && box.x[0] >= 44, JSON.stringify([box.row, box.edit, box.x]))
  check('Pencil shows without hover, key hints don\'t', box.editShown === 'visible' && box.hidden === 'none')
  check('The box won\'t zoom the page on focus', box.font >= 16, `${box.font}px`)
  await shot(page, 'phone-search')
  await page.tap('.lch-edit')
  await page.waitForSelector('.lch-form')
  const field = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.lch-field')).fontSize))
  check('Tapping the pencil opens the form, with 16px fields', field >= 16, `${field}px`)
  await shot(page, 'phone-form')
  await page.tap('[data-back]')
  await page.waitForSelector('.lch-input')
  await search(page, 'greeting')
  await page.tap('.lch-row')
  await page.waitForFunction(() => !document.querySelector('#hub-launcher.on') || document.querySelector('[data-copy]'))
  check('Tapping a snippet copies it', await page.evaluate(() => /Copied Greeting/.test(document.querySelector('.lch-toast')?.textContent) || !!document.querySelector('[data-copy]')))
  await page.evaluate(() => window.LAUNCHER.open())
  await page.waitForSelector('#hub-launcher.on .lch-x')
  await page.tap('.lch-x')
  check('The × closes it', !(await barOpen(page)))
  await page.goto(`${BASE}/launcher`, { waitUntil: 'load' })
  await page.waitForSelector('.lch-row')
  const alone = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }))
  check('The small page works at phone width too', alone.scroll <= alone.width)
  await shot(page, 'phone-standalone')
  await context.close()
}

/* ---------- the small window ---------- */

async function standaloneScenario(browser, errors) {
  section('/launcher, as the desktop app loads it (640 x 400)')
  const context = await browser.newContext({ viewport: { width: 640, height: 400 }, permissions: ['clipboard-read', 'clipboard-write'] })
  // The desktop app hides the window on close. Chat is stubbed so nothing real starts.
  await context.addInitScript(() => {
    window.__closed = 0
    window.close = () => { window.__closed++ }
    let chat
    Object.defineProperty(window, 'HubChat', { configurable: true, get: () => chat, set: v => { chat = { ...v, open: () => {}, ask: t => { window.__asked = t } } } })
  })
  const page = await context.newPage()
  watch(page, 'standalone', errors)
  await page.goto(`${BASE}/launcher`, { waitUntil: 'load' })
  await page.waitForSelector('.lch-row')
  const layout = await page.evaluate(() => {
    const p = document.querySelector('.lch-panel').getBoundingClientRect()
    return { w: p.width, h: p.height, foot: getComputedStyle(document.querySelector('.lch-foot')).display, active: document.activeElement.className, xss: window.__xss, scrim: getComputedStyle(document.getElementById('hub-launcher')).backgroundColor }
  })
  check('The panel fills the window with its key hints', layout.w === 640 && layout.h === 400 && layout.foot !== 'none', JSON.stringify(layout))
  check('The box has focus on load', layout.active === 'lch-input')
  check('No script from saved titles runs here either', layout.xss === undefined)
  check('Under the page\'s CSP it draws with no violation', !errors.some(e => e.label === 'standalone' && /Content Security Policy/.test(e.text)))
  await shot(page, 'standalone-640x400')
  await search(page, 'greeting')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__closed === 1)
  check('A snippet copies, then the page signals close', await page.evaluate(() => navigator.clipboard.readText()) === 'Hello there')
  check('And the box is ready for next time', await page.inputValue('.lch-input') === '')
  await context.route('https://tracker.example/**', r => r.fulfill({ contentType: 'text/plain', body: 'invented site' }))
  await search(page, 'tracker')
  const popup = context.waitForEvent('page')
  await page.keyboard.press('Enter')
  const web = await popup
  await web.waitForURL('https://tracker.example/**')
  check('A web link opens outside the small window', web.url() === 'https://tracker.example/board', web.url())
  check('It has no opener or referrer', await web.evaluate(() => window.opener === null && document.referrer === ''))
  await web.close().catch(() => {})
  check('Close was signalled', await page.evaluate(() => window.__closed === 2))
  await search(page, 'esc test')
  await page.keyboard.press('Escape')
  check('Esc clears first, with no close', await page.inputValue('.lch-input') === '' && await page.evaluate(() => window.__closed === 2))
  await page.keyboard.press('Escape')
  check('Esc on an empty box signals close', await page.evaluate(() => window.__closed === 3))

  section('Handing off to the main page')
  await search(page, 'what is on today')
  let next = context.waitForEvent('page')
  await page.keyboard.press('Enter')
  let main = await next
  check('The address carries no text', !/what|today/.test(main.url()), main.url().replace(BASE, ''))
  watch(main, 'handoff', errors)
  await main.waitForFunction(() => window.__asked)
  check('The main page asks the chat', await main.evaluate(() => window.__asked) === 'what is on today')
  check('It clears the address and the note', await main.evaluate(() => location.hash === '' && localStorage.getItem('hub-launcher-pending') === null))
  const target = await main.evaluate(() => window.HUB.allApps().find(a => a !== 'chat' && a !== env && typeof window.HUB.appMeta(a)?.label === 'string'))
  const label = await main.evaluate(id => window.HUB.appMeta(id).label, target)
  await main.close()
  const tabs = await page.evaluate(() => (window.HUB_CONF?.tabs || []))
  const tabLabel = tabs.includes(target) ? label : null
  if (tabLabel) {
    await search(page, tabLabel)
    const at = await rowIndex(page, tabLabel)
    next = context.waitForEvent('page')
    // Under the test driver window.open can hold up the click's reply, on a bare page too. What
    // counts is the main page opening, which the wait for it still requires.
    await page.click(`.lch-row[data-i="${at}"]`, { timeout: 5000 }).catch(() => {})
    main = await next
    watch(main, 'handoff', errors)
    await main.waitForFunction(id => { try { return env === id } catch { return false } }, target)
    check('A tab opens on the main page', true, target)
    await main.close()
  } else check('A tab opens on the main page', false, `no shared tab to try: ${target}`)
  await search(page, 'import')
  next = context.waitForEvent('page')
  await page.keyboard.press('Enter')
  main = await next
  watch(main, 'handoff', errors)
  await main.waitForSelector('[data-file]')
  check('Import opens on the main page, where a file picker can\'t hide the window', true)
  await main.close()
  const outside = await context.newPage()
  watch(outside, 'handoff', errors)
  await outside.goto(`${BASE}/#launcher-run`, { waitUntil: 'load' })
  await outside.waitForFunction(() => window.HubChat)
  await outside.waitForTimeout(200)
  check('A link from elsewhere does nothing', await outside.evaluate(() => window.__asked === undefined && location.hash === '' && !document.querySelector('#hub-launcher.on')))
  await outside.evaluate(() => { localStorage.setItem('hub-launcher-pending', JSON.stringify({ do: 'ask', text: 'stale', at: Date.now() - 60_000 })); location.hash = 'launcher-run' })
  await outside.waitForFunction(() => location.hash === '')
  check('A stale note does nothing and is removed', await outside.evaluate(() => window.__asked === undefined && localStorage.getItem('hub-launcher-pending') === null))
  await outside.close()
  await context.close()

  const dark = await browser.newContext({ viewport: { width: 640, height: 400 }, colorScheme: 'dark' })
  const darkPage = await dark.newPage()
  watch(darkPage, 'standalone', errors)
  await darkPage.goto(`${BASE}/launcher`, { waitUntil: 'load' })
  await darkPage.waitForSelector('.lch-row')
  check('Dark mode applies on its own', await darkPage.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(28, 28, 30)')
  await shot(darkPage, 'standalone-dark')
  await dark.close()
}

/* ---------- when the launcher is missing or broken ---------- */

async function hubStillWorks(browser, label, sink) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  watch(page, label, sink)
  await page.goto(`${BASE}/`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.HUB && window.HubChat)
  const before = await page.evaluate('env')
  const target = await page.evaluate(() => window.HUB.visibleTabs().find(t => t !== env))
  await page.evaluate(id => window.HUB.openApp(id), target)
  const moved = await page.evaluate('env')
  const health = await api('GET', '/api/hub/settings')
  check(`${label}: the page loads and tabs still switch`, before !== moved && moved === target, `${before} -> ${moved}`)
  check(`${label}: other back ends still answer`, health.status === 200)
  await page.keyboard.press('Control+/')
  check(`${label}: chat shortcut still works`, await page.evaluate(() => !!window.HubChat))
  return { page, context }
}

async function variants(browser, baselineErrors) {
  section('Launcher files deleted')
  {
    const dir = freshCopy('gone')
    for (const f of ['launcher.mjs', 'launcher.html', 'tabs/launcher.js', 'LAUNCHER.md']) fs.rmSync(path.join(dir, f))
    const hub = await startHub(dir)
    const { page, context } = await hubStillWorks(browser, 'Deleted', baselineErrors)
    check('Deleted: no launcher in the page', await page.evaluate(() => window.LAUNCHER === undefined))
    check('Deleted: the failed script tag removes itself', await page.evaluate(() => !document.querySelector('script[src="/tabs/launcher.js"]')))
    check('Deleted: /launcher is simply not found', (await api('GET', '/launcher')).status === 404)
    check('Deleted: no script error in the page', !baselineErrors.some(e => /pageerror/.test(e.text)))
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+k')
    check('Deleted: Ctrl+K still jumps to the chat bar', await page.evaluate(() => document.activeElement?.tagName !== 'BODY'))
    await context.close()
    await hub.stop()
  }

  section('launcher.mjs broken')
  {
    const dir = freshCopy('broken-back')
    fs.writeFileSync(path.join(dir, 'launcher.mjs'), 'export function create( {{{ this is a syntax error')
    const hub = await startHub(dir)
    const sink = []
    const { page, context } = await hubStillWorks(browser, 'Broken back end', sink)
    check('Broken back end: the server said so in its log', /launcher/.test(hub.text()), hub.text().split('\n').find(l => /launcher/.test(l))?.slice(0, 90))
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+k')
    await page.waitForFunction(() => document.querySelector('.lch-warn:not([hidden])'))
    check('Broken back end: the bar opens and says it couldn\'t load', /couldn.t load/.test(await page.textContent('.lch-warn')), await page.textContent('.lch-warn'))
    await context.close()
    await hub.stop()
  }

  section('tabs/launcher.js throws')
  {
    const dir = freshCopy('broken-front')
    fs.writeFileSync(path.join(dir, 'tabs', 'launcher.js'), "throw new Error('invented failure')")
    const hub = await startHub(dir)
    const sink = []
    const { context } = await hubStillWorks(browser, 'Broken front end', sink)
    check('Broken front end: only its own error appears', sink.filter(e => /pageerror/.test(e.text)).every(e => /invented failure/.test(e.text)), `${sink.filter(e => /pageerror/.test(e.text)).length} page errors`)
    await context.close()
    await hub.stop()
  }

  section('Damaged saved file')
  {
    const dir = freshCopy('damaged')
    fs.mkdirSync(path.join(dir, 'data'))
    fs.writeFileSync(path.join(dir, 'data', 'launcher.json'), '{ damaged ')
    const hub = await startHub(dir)
    const sink = []
    const { page, context } = await hubStillWorks(browser, 'Damaged file', sink)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+k')
    await page.waitForFunction(() => document.querySelector('.lch-warn:not([hidden])'))
    check('Damaged file: the bar warns', /damaged/.test(await page.textContent('.lch-warn')))
    check('Damaged file: a copy is kept', fs.readdirSync(path.join(dir, 'data')).some(f => /^launcher\.damaged-/.test(f)))
    await context.close()
    await hub.stop()
  }

  section('First-run wizard')
  {
    const hub = await startHub(freshCopy('wizard', { config: false }))
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    await page.goto(`${BASE}/`, { waitUntil: 'load' })
    await page.waitForSelector('#hub-setup')
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(150)
    check('Ctrl+K leaves the wizard alone', !(await barOpen(page)))
    await context.close()
    await hub.stop()
  }

  section('The one-line chat.js change proposed for the owner')
  {
    const dir = freshCopy('chat-line')
    const file = path.join(dir, 'tabs', 'chat.js')
    const before = fs.readFileSync(file, 'utf8')
    const after = before.replace("else if (e.key === 'k' || e.key === 'K') {", "else if ((e.key === 'k' || e.key === 'K') && !window.LAUNCHER) {")
    check('The proposed change applies to one line', after !== before)
    fs.writeFileSync(file, after)
    const hub = await startHub(dir)
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    await goHome(page)
    await page.keyboard.press('Control+k')
    await page.waitForSelector('#hub-launcher.on')
    await page.keyboard.press('Escape')
    check('With it, closing the bar doesn\'t leave focus in the chat bar', await page.evaluate(() => document.activeElement?.tagName === 'BODY'), await page.evaluate(() => document.activeElement?.tagName))
    await context.close()
    await hub.stop()
    const fallback = freshCopy('chat-line-gone')
    fs.writeFileSync(path.join(fallback, 'tabs', 'chat.js'), after)
    fs.rmSync(path.join(fallback, 'tabs', 'launcher.js'))
    const hub2 = await startHub(fallback)
    const context2 = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page2 = await context2.newPage()
    await goHome(page2)
    await page2.keyboard.press('Control+k')
    check('With it and no launcher, Ctrl+K still jumps to the chat bar', await page2.evaluate(() => document.activeElement?.tagName !== 'BODY'), await page2.evaluate(() => document.activeElement?.tagName))
    await context2.close()
    await hub2.stop()
  }
}

/* ---------- speed ---------- */

async function speedScenario(browser) {
  section('Speed with a full library')
  const dir = freshCopy('speed')
  const hub = await startHub(dir)
  const links = Array.from({ length: 5000 }, (_, i) => ({ name: `Link number ${i} about topic ${i % 97}`, url: `https://site-${i}.example/path/${i}` }))
  const text = 'lorem ipsum dolor sit amet '.repeat(40)
  const snippets = Array.from({ length: 5000 }, (_, i) => ({ name: `Snippet ${i}`, text: `${text} ${i}`, keyword: `k${i}` }))
  const a = await api('POST', '/api/launcher/import', { data: { links } })
  const b = await api('POST', '/api/launcher/import', { data: { snippets } })
  check('5,000 links and 5,000 snippets import', a.json.added.links === 5000 && b.json.added.snippets === 5000, `${a.json.added.links} + ${b.json.added.snippets}`)
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  await goHome(page)
  const openStart = Date.now()
  await page.keyboard.press('Control+k')
  await page.waitForFunction(() => document.querySelectorAll('.lch-row').length === 50)
  const openMs = Date.now() - openStart
  const onePass = () => page.evaluate(() => {
    const box = document.querySelector('.lch-input')
    const out = []
    for (const q of ['l', 'li', 'lin', 'link', 'link n', 'topic 42', 'dolor', 'k4999', 'zzzz', 'snip', 'number 1']) {
      const t = performance.now()
      box.value = q
      box.dispatchEvent(new InputEvent('input', { bubbles: true }))
      document.body.offsetHeight
      out.push(Math.round((performance.now() - t) * 10) / 10)
    }
    return out
  })
  // One sample is mostly a measure of what else the computer is doing, so the limit is on the middle of
  // five passes. The first pass runs cold, so it has its own, looser limit.
  const passes = []
  for (let i = 0; i < 5; i++) passes.push(Math.max(...await onePass()))
  const middle = [...passes].sort((x, y) => x - y)[2]
  check('Each keystroke redraws in under 50 ms', middle < 50, `worst keystroke per pass: ${passes.join(', ')} ms`)
  check('Even the first, cold pass stays under 200 ms', passes[0] < 200, `${passes[0]} ms`)
  check('Opening with everything loaded takes under 500 ms', openMs < 500, `${openMs} ms`)
  await search(page, 'k4999')
  check('An exact keyword still wins', (await rowTitles(page))[0] === 'Snippet 4999')
  await context.close()
  await hub.stop()
}

/* ---------- run ---------- */

async function loadBrowser() {
  let chromium
  try {
    const mod = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : 'playwright-core')
    chromium = mod.chromium || mod.default?.chromium
    return await chromium.launch({ headless: true, executablePath: process.env.LAUNCHER_TEST_CHROMIUM || undefined, args: ['--host-resolver-rules=MAP hub-test.invalid 127.0.0.1'] })
  } catch (e) {
    console.error(`The browser couldn't start, so nothing was proven: ${e.message.split('\n')[0]}`)
    return null
  }
}

let browser = null
let hub = null
let crashed = null
const watchdog = setTimeout(() => { console.error('Took over 5 minutes, stopping'); process.exit(1) }, 300_000)

const portBusy = await fetch(`${BASE}/`).then(() => true, () => false)
if (portBusy) {
  console.error(`Port ${PORT} is already in use, so this run won't touch it`)
  process.exit(3)
}
browser = await loadBrowser()
if (!browser) process.exit(3)
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const baseline = []
const errors = []
try {
  hub = await startHub(freshCopy('main'))
  const noise = { on: false }
  await mainScenario(browser, hub, errors, noise)
  await clipboardScenario(browser, errors)
  await phoneScenario(browser, errors)
  await standaloneScenario(browser, errors)
  check('Snippet text is still not in the logs after all of that', !hub.text().includes(SENTINEL))
  await hub.stop()
  hub = null
  await variants(browser, baseline)
  await speedScenario(browser)

  section('Console errors')
  // Refused saves are real 4xx answers, and the browser notes each one itself. Those are expected here.
  const refused = e => /status of 4\d\d/.test(e.text) && /\/api\/launcher\/(links|snippets)/.test(e.url)
  // The hub's passcode page has no icon of its own, so the browser's automatic request for one is refused.
  const beforeLogin = e => /status of 401/.test(e.text) && /\/favicon\.ico$/.test(e.url)
  const known = new Set(baseline.filter(e => !/launcher\.js/.test(e.url)).map(e => `${e.url.replace(/^https?:\/\/[^/]+/, '')} ${e.text}`))
  const own = errors.filter(e => !refused(e) && !beforeLogin(e) && !known.has(`${e.url.replace(/^https?:\/\/[^/]+/, '')} ${e.text}`))
  check('Launcher adds no console errors or page errors', own.length === 0, own.slice(0, 5).map(e => `${e.label}: ${e.text.slice(0, 120)} ${e.url}`).join(' || '))
  console.log(`  hub without the launcher: ${baseline.length} errors (${[...new Set(baseline.map(e => e.url.replace(/^https?:\/\/[^/]+/, '') || e.text))].join(', ').slice(0, 300)})`)
  console.log(`  with it: ${errors.length} in total, ${errors.filter(refused).length} from deliberately refused saves`)
} catch (e) {
  crashed = e
  check('The run reached its end', false, e.message.split('\n')[0])
  console.error(e.stack)
} finally {
  await browser.close().catch(() => {})
  await hub?.stop().catch(() => {})
  clearTimeout(watchdog)
  try { fs.rmSync(scratch, { recursive: true, force: true }) } catch {}
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
for (const f of failed) console.log(`FAILED: ${f.name}  [${f.detail}]`)
process.exit(failed.length ? 1 : 0)
