// Sets the app's store ids. Anyone building their own copy runs this first, because this repo's ids aren't
// theirs to sign with. app-ids.json is the source, and every other copy is written from it here:
//
//   node scripts/set-app-id.mjs --ios org.example.myhub --android org.example.myhub
//
// Either one can be given alone. The iOS id also sets the share extension (.share), the widget (.widget) and
// the App Group (group.<id>). The Android id changes the package stores see. The Java package in the
// source stays where it is, since nothing outside the app reads it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkAppIds, IOS_FILES, ANDROID_FILES } from './check-app-ids.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const stop = message => {
  console.error(message)
  process.exit(1)
}

const args = process.argv.slice(2)
const wanted = {}
for (let i = 0; i < args.length; i += 2) {
  if (!['--ios', '--android'].includes(args[i]) || !args[i + 1]) stop('Usage: node scripts/set-app-id.mjs --ios org.example.myhub --android org.example.myhub')
  wanted[args[i].slice(2)] = args[i + 1]
}
if (!wanted.ios && !wanted.android) stop('Usage: node scripts/set-app-id.mjs --ios org.example.myhub --android org.example.myhub')
// What both stores accept, and what a Java package can be.
for (const id of Object.values(wanted)) {
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(id)) stop(`"${id}" isn't an id. Use lower-case words and numbers with dots, like org.example.myhub.`)
}

const ids = JSON.parse(read('app-ids.json'))
// Every copy has to agree first, or a swap could stop halfway.
const broken = checkAppIds(ROOT)
if (broken.length) stop(broken.join('\n'))

const swap = (rel, from, to) => {
  const text = read(rel)
  if (!text.includes(from)) stop(`${rel}: not found: ${from}. Run node scripts/check-app-ids.mjs to see what differs.`)
  fs.writeFileSync(path.join(ROOT, rel), text.split(from).join(to))
}

if (wanted.ios) for (const rel of IOS_FILES) swap(rel, ids.ios, wanted.ios)
if (wanted.android) {
  for (const rel of ANDROID_FILES) {
    if (rel.endsWith('build.gradle')) swap(rel, `applicationId "${ids.android}"`, `applicationId "${wanted.android}"`)
    else swap(rel, `>${ids.android}<`, `>${wanted.android}<`)
  }
}
fs.writeFileSync(path.join(ROOT, 'app-ids.json'), `${JSON.stringify({ ...ids, ...wanted }, null, 2)}\n`)

const problems = checkAppIds(ROOT)
if (problems.length) stop(problems.join('\n'))
console.log(`iOS ${wanted.ios ?? ids.ios}, Android ${wanted.android ?? ids.android}. Now register them under your own accounts.`)
