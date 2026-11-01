// Reads the licence of everything that ships in the app and of the dev tools, and fails on anything that
// isn't plainly compatible with MIT.  node scripts/check-licenses.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ALLOWED = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'BlueOak-1.0.0', 'Python-2.0', 'CC0-1.0', 'Unlicense'])
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const shipped = new Set(Object.keys(pkg.dependencies))

const seen = new Map()
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (name.startsWith('@')) {
      walk(full)
      continue
    }
    const file = path.join(full, 'package.json')
    if (!fs.existsSync(file)) continue
    const info = JSON.parse(fs.readFileSync(file, 'utf8'))
    seen.set(`${info.name}@${info.version}`, { name: info.name, license: info.license?.type ?? info.license ?? 'UNKNOWN' })
    const nested = path.join(full, 'node_modules')
    if (fs.existsSync(nested)) walk(nested)
  }
}
walk(path.join(ROOT, 'node_modules'))

// One licence each, or "A OR B" where any allowed choice is enough.
const fine = license => String(license).replace(/[()]/g, '').split(/\s+OR\s+/).some(one => ALLOWED.has(one.trim()))
const bad = [...seen].filter(([, p]) => !fine(p.license))
const counts = {}
for (const [, p] of seen) counts[p.license] = (counts[p.license] ?? 0) + 1

console.log(`${seen.size} packages:`, counts)
console.log('ships in the app:')
for (const [id, p] of seen) if (shipped.has(p.name)) console.log(`  ${id}  ${p.license}`)
for (const [id, p] of bad) console.log(`NOT ALLOWED: ${id}  ${p.license}`)
if (bad.length) process.exit(1)
