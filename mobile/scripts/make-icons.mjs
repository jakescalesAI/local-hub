// Draws the app icons and launch screens from the Hub's own icon, replacing the template art. Headless:
// nothing opens on screen.  node scripts/make-icons.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
const SQUARE = fs.readFileSync(path.join(ROOT, '..', 'icons', 'hub-square.svg'), 'utf8')
const HOUSE_ONLY = SQUARE.replace(/<rect [^>]*\/>/, '')
const SPLASH_BG = '#0b0f16'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()

async function draw(file, width, height, html, { transparent = false } = {}) {
  await page.setViewportSize({ width, height })
  await page.setContent(`<!doctype html><style>html,body{margin:0;height:100%;background:transparent}svg{display:block}</style>${html}`)
  await page.screenshot({ path: file, omitBackground: transparent })
}
const fill = svg => svg.replace('<svg ', '<svg width="100%" height="100%" style="position:fixed;inset:0" ')
const pngSize = file => {
  const b = fs.readFileSync(file)
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

try {
  await draw(path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png'), 1024, 1024, fill(SQUARE))
  await draw(path.join(ROOT, 'src', 'icon.png'), 192, 192, fill(SQUARE))

  for (const [density, base, fore] of [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]]) {
    const dir = path.join(RES, `mipmap-${density}`)
    const clip = radius => `<div style="width:100%;height:100%;overflow:hidden;border-radius:${radius}">${SQUARE.replace('<svg ', '<svg width="100%" height="100%" ')}</div>`
    await draw(path.join(dir, 'ic_launcher.png'), base, base, clip('18%'), { transparent: true })
    await draw(path.join(dir, 'ic_launcher_round.png'), base, base, clip('50%'), { transparent: true })
    await draw(path.join(dir, 'ic_launcher_foreground.png'), fore, fore, fill(HOUSE_ONLY).replace('style="position:fixed;inset:0"', 'style="position:fixed;inset:17%;width:66%;height:66%"'), { transparent: true })
  }

  const splash = (file, width, height) => {
    const size = Math.round(Math.min(width, height) * 0.28)
    return draw(file, width, height, `<div style="width:100%;height:100%;display:grid;place-items:center;background:${SPLASH_BG}">${HOUSE_ONLY.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div>`)
  }
  for (const dir of fs.readdirSync(RES).filter(d => d.startsWith('drawable'))) {
    const file = path.join(RES, dir, 'splash.png')
    if (fs.existsSync(file)) await splash(file, ...pngSize(file))
  }
  const iosSplash = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset')
  for (const name of fs.readdirSync(iosSplash).filter(f => f.endsWith('.png'))) await splash(path.join(iosSplash, name), ...pngSize(path.join(iosSplash, name)))
} finally {
  await browser.close()
}
console.log('icons and launch screens drawn')
