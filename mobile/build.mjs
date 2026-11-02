// Builds the shell into www/. A release build carries no test hooks and refuses plain HTTP.
// --dev allows HTTP to this machine and the Android emulator host, and adds the test hooks.
// --local-http allows that same HTTP with no test hooks, for the minified test APK on an emulator.
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const dev = process.argv.includes('--dev')
const localHttp = process.argv.includes('--local-http')
const out = path.join(HERE, 'www')
const version = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).version

// connect-src only matters in a browser: in the app, requests go through the OS, not the page.
const connect = dev ? "'self' http://localhost:* http://127.0.0.1:* http://10.0.2.2:*" : "'self'"
const csp = `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src ${connect}; frame-src 'self'; base-uri 'none'; form-action 'none'`

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
await build({
  entryPoints: [path.join(HERE, 'src', 'main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2021', 'safari15'],
  minify: !dev,
  sourcemap: false,
  legalComments: 'eof',
  outfile: path.join(out, 'app.js'),
  define: { __DEV__: String(dev), __LOCAL_HTTP__: String(localHttp), __VERSION__: JSON.stringify(version) },
  logLevel: 'warning',
})
fs.writeFileSync(path.join(out, 'index.html'), fs.readFileSync(path.join(HERE, 'src', 'index.html'), 'utf8').replace('__CSP__', csp))
for (const file of ['app.css', 'demo-hub.html', 'icon.png']) fs.copyFileSync(path.join(HERE, 'src', file), path.join(out, file))
console.log(`www/ built (${dev ? 'dev' : localHttp ? 'release code, local HTTP' : 'release'}): ${fs.statSync(path.join(out, 'app.js')).size} bytes of JS`)
