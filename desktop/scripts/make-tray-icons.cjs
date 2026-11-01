// Regenerates assets/tray*.png from assets/icon.png. Run with: npx electron scripts/make-tray-icons.cjs
const { app, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const assets = path.join(__dirname, '..', 'assets')
app.whenReady().then(() => {
  const icon = nativeImage.createFromPath(path.join(assets, 'icon.png'))
  for (const [name, size] of [['tray.png', 16], ['tray@1.5x.png', 24], ['tray@2x.png', 32]]) {
    fs.writeFileSync(path.join(assets, name), icon.resize({ width: size, height: size, quality: 'best' }).toPNG())
  }
  app.quit()
})
