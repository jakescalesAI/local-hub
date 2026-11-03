// Draws store screenshots at the exact sizes the stores take, from the release build's own screens in demo
// mode, which needs no Hub and shows only made-up data. Headless: nothing opens on screen.
// Settings isn't one of them: a browser has no biometrics, so its lock card would say the device has none.
//
//   npm run build && node scripts/store-pictures.mjs        pictures land in store-pictures/ (ignored by git)
//
// UI_BROWSER=<path to a Chromium build> uses that instead of Edge. These show the app's screens as its web
// view draws them. Simulator or device pictures, where there are some, show the system around them too.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const WWW = path.join(ROOT, 'www')
const OUT = path.join(ROOT, 'store-pictures')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }

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

const server = http.createServer((req, res) => {
  const file = path.join(WWW, new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html'))
  if (!file.startsWith(WWW) || !fs.existsSync(file)) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' }).end(fs.readFileSync(file))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}/`

const browser = await chromium.launch(process.env.UI_BROWSER ? { executablePath: process.env.UI_BROWSER, headless: true } : { channel: 'msedge', headless: true })
const errors = []
const made = []
try {
  for (const size of SIZES) {
    for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, colorScheme: scheme, hasTouch: true, isMobile: size.width < 600 })
      const page = await context.newPage()
      page.on('pageerror', e => errors.push(`${size.name} ${scheme}: ${e.message}`))
      const dir = path.join(OUT, size.name)
      fs.mkdirSync(dir, { recursive: true })
      const shot = async n => {
        const file = path.join(dir, `${n}-${scheme}.png`)
        await page.waitForTimeout(400)
        await page.screenshot({ path: file })
        made.push(file)
      }
      const tap = async text => page.getByRole('button', { name: text, exact: true }).click()
      await page.goto(BASE)
      await page.getByRole('button', { name: 'Try the demo', exact: true }).waitFor({ timeout: 15000 })
      await shot('1-welcome')
      await tap('Try the demo')
      await page.getByText('Demo Hub').first().waitFor()
      await shot('2-connected')
      await tap('Open Hub')
      await page.frameLocator('iframe').locator('body').waitFor()
      await page.waitForTimeout(800)
      await shot('3-hub')
      await context.close()
    }
  }
} finally {
  await browser.close()
  server.close()
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
