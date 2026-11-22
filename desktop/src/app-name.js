// The app's name, read from package.json so it's only written down once.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))

export const APP_NAME = pkg.productName
// The packaged package.json loses its build section, so a unit test keeps this equal to build.appId.
export const APP_ID = 'local-hub.desktop'
