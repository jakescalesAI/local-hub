// Writes the version and build number everywhere a store build reads them. package.json is the one place
// they are chosen: "version", and "buildNumber" for the number stores count by. App Store Connect refuses a
// repeated build number, and the app and its extensions have to agree, so a test fails if any copy differs.
//
//   node scripts/set-version.mjs 0.2.0 2    choose new numbers
//   node scripts/set-version.mjs            write what package.json already says
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const write = (rel, text) => fs.writeFileSync(path.join(ROOT, rel), text)

const stop = message => {
  console.error(message)
  process.exit(1)
}

const pkg = JSON.parse(read('package.json'))
const [version = pkg.version, buildText = String(pkg.buildNumber)] = process.argv.slice(2)
const build = Number(buildText)
if (!/^\d+\.\d+\.\d+$/.test(version)) stop(`The version has to look like 1.2.3, not "${version}".`)
if (!Number.isInteger(build) || build < 1) stop(`The build number has to be a whole number from 1, not "${buildText}".`)
if (process.argv.length > 2 && build <= pkg.buildNumber) stop(`Build ${build} isn't higher than ${pkg.buildNumber}. Stores refuse a build number they have seen.`)

const replace = (rel, ...pairs) => {
  let text = read(rel)
  for (const [pattern, value] of pairs) {
    if (!pattern.test(text)) stop(`${rel}: not found: ${pattern}`)
    text = text.replace(pattern, value)
  }
  write(rel, text)
}

replace('package.json', [/("version": ")[^"]+"/, `$1${version}"`], [/("buildNumber": )\d+/, `$1${build}`])
replace('package-lock.json', [/("name": "local-hub-mobile",\s+"version": ")[^"]+"/g, `$1${version}"`])
replace('android/app/build.gradle', [/versionCode \d+/, `versionCode ${build}`], [/versionName "[^"]+"/, `versionName "${version}"`])
replace('ios/App/App.xcodeproj/project.pbxproj', [/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`], [/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`])
console.log(`Version ${version}, build ${build}`)
