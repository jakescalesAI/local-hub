// Draws store screenshots at the exact sizes the stores take. Most show the Hub itself, the page this app opens,
// from a throwaway sample Hub with made-up data (scripts/sample-hub.mjs). The last one is this app's own first
// screen, from the release build. Headless: nothing opens on screen, and the sample Hub is gone afterwards.
//
//   npm run build && node scripts/store-pictures.mjs [--hub-source <Hub checkout>]    pictures land in store-pictures/
//
// --hub-source picks the Hub the pictures show (default: this repo's). UI_BROWSER=<path to a Chromium build> uses
// that instead of Edge. These show pages as a web view draws them, without the system's status bar around them.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { makeSampleHub } from './sample-hub.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const WWW = path.join(ROOT, 'www')
const OUT = path.join(ROOT, 'store-pictures')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }
const arg = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)

// Viewport in points times the scale gives the store's pixel size.
const SIZES = [
  { name: 'iphone-6.3', width: 402, height: 874, scale: 3 }, // App Store 1206x2622
  { name: 'iphone-6.1', width: 393, height: 852, scale: 3 }, // App Store 1179x2556
  { name: 'ipad-13', width: 1032, height: 1376, scale: 2 }, // App Store 2064x2752
  { name: 'play-phone', width: 360, height: 640, scale: 3 }, // Google Play 1080x1920
  { name: 'play-tablet-7', width: 600, height: 960, scale: 2 }, // Google Play 1200x1920
  { name: 'play-tablet-10', width: 800, height: 1280, scale: 2 }, // Google Play 1600x2560
]

if (!fs.existsSync(path.join(WWW, 'app.js'))) {
  console.error('No build in www/. Run npm run build first.')
  process.exit(1)
}
if (/__hubTest/.test(fs.readFileSync(path.join(WWW, 'app.js'), 'utf8'))) {
  console.error('www/ holds the dev build. Store pictures come from the release build: run npm run build.')
  process.exit(1)
}

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const shell = http.createServer((req, res) => {
  const file = path.join(WWW, new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html'))
  if (!file.startsWith(WWW) || !fs.existsSync(file)) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' }).end(fs.readFileSync(file))
})
const APP = `http://127.0.0.1:${await listen(shell)}/`

// The sample Hub, on a free port, in a time zone where it's morning (so today's sample events are still ahead).
const sample = makeSampleHub({ source: arg('--hub-source') ? path.resolve(arg('--hub-source')) : undefined })
const probe = net.createServer()
const port = await listen(probe)
probe.close()
const hubLog = []
const hubProcess = spawn(process.execPath, ['server.mjs'], {
  cwd: sample.hub,
  env: { PATH: process.env.PATH, HOME: sample.home, USERPROFILE: sample.home, HUB_PORT: String(port), TZ: sample.zone },
  stdio: ['ignore', 'pipe', 'pipe'],
})
hubProcess.stdout.on('data', d => hubLog.push(String(d)))
hubProcess.stderr.on('data', d => hubLog.push(String(d)))
const HUB = `http://127.0.0.1:${port}/`
for (let i = 0; ; i++) {
  if (await fetch(HUB).then(r => r.ok, () => false)) break
  if (i > 60) throw new Error(`The sample Hub didn't start:\n${hubLog.join('')}`)
  await new Promise(r => setTimeout(r, 250))
}

const browser = await chromium.launch(process.env.UI_BROWSER ? { executablePath: process.env.UI_BROWSER, headless: true } : { channel: 'msedge', headless: true })
const errors = []
const made = []
try {
  for (const size of SIZES) {
    for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, colorScheme: scheme, hasTouch: true, isMobile: size.width < 600, timezoneId: sample.zone })
      const page = await context.newPage()
      await page.clock.install({ time: sample.clock })
      page.on('pageerror', e => errors.push(`${size.name} ${scheme}: ${e.message}`))
      const dir = path.join(OUT, size.name)
      fs.mkdirSync(dir, { recursive: true })
      const shot = async n => {
        const file = path.join(dir, `${n}-${scheme}.png`)
        await page.waitForTimeout(600)
        await page.screenshot({ path: file })
        made.push(file)
      }
      const hubHome = async () => {
        await page.goto(HUB)
        await page.locator('.hw-grid, [data-hw-page]').first().waitFor({ timeout: 15000 }).catch(() => {})
        await page.waitForTimeout(1200)
      }

      await hubHome()
      await shot('1-home')

      // The search bar across links, snippets and files.
      await page.evaluate(() => window.LAUNCHER.open())
      await page.locator('.lch-input').waitFor()
      await page.keyboard.type('inv')
      await page.getByText('invoice-0143.pdf').first().waitFor()
      await shot('2-search')

      // The assistant, in a chat that read a file and wrote one.
      await hubHome()
      await page.evaluate(() => window.HubChat.open())
      await page.locator('button.fhist:visible, button.chist:visible').first().click()
      await page.getByText('Unpaid invoices').first().click()
      await page.getByText('reminder-0142.md').first().waitFor()
      await shot('3-assistant')

      // Files: the home folder, opened down to the invoices.
      await hubHome()
      await page.locator('button[data-env=drives]').click()
      await page.getByRole('link', { name: /^Home/ }).first().click()
      await page.getByText('Documents', { exact: true }).first().click()
      await page.getByText('Invoices', { exact: true }).first().click()
      await page.getByText('tracker.csv').first().waitFor()
      await shot('4-files')

      await hubHome()
      await page.locator('button[data-env=calendar]').click()
      await page.getByText('Call Harbor Yoga about invoice').first().waitFor({ state: 'attached' })
      await shot('5-calendar')

      // This app's own first screen: what someone sees before they connect.
      await page.goto(APP)
      await page.getByRole('button', { name: 'Try the demo', exact: true }).waitFor({ timeout: 15000 })
      await shot('6-connect')
      await context.close()
    }
  }
} finally {
  await browser.close()
  shell.close()
  hubProcess.kill()
  await new Promise(r => hubProcess.once('exit', r))
  sample.remove()
}

// Every picture has to be exactly the size its store slot takes.
const pngSize = file => {
  const b = fs.readFileSync(file)
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}
const wrong = made.filter(file => {
  const size = SIZES.find(s => file.includes(`${path.sep}${s.name}${path.sep}`))
  const [w, h] = pngSize(file)
  return w !== size.width * size.scale || h !== size.height * size.scale
})
if (errors.length || wrong.length) {
  console.error([...errors, ...wrong.map(f => `wrong size: ${path.relative(ROOT, f)} ${pngSize(f).join('x')}`)].join('\n'))
  process.exit(1)
}
console.log(`${made.length} pictures in ${path.relative(process.cwd(), OUT) || '.'}: ${SIZES.map(s => `${s.name} ${s.width * s.scale}x${s.height * s.scale}`).join(', ')}`)
