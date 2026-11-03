// Checks every copy of the store ids against app-ids.json. A mismatch only shows up at signing or upload,
// or as an extension that can't read what the app wrote, so it's caught here instead.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const IOS_FILES = [
  'capacitor.config.json',
  'ios/App/App.xcodeproj/project.pbxproj',
  'ios/App/App/App.entitlements',
  'ios/App/ShareExtension/ShareExtension.entitlements',
  'ios/App/App/HubNativePlugin.swift',
  'ios/App/ShareExtension/ShareViewController.swift',
]
export const ANDROID_FILES = ['android/app/build.gradle', 'android/app/src/main/res/values/strings.xml']

export function checkAppIds(root) {
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')
  const { ios, android } = JSON.parse(read('app-ids.json'))
  const group = `group.${ios}`
  const problems = []
  const same = (where, found, want) => {
    if (JSON.stringify(found) !== JSON.stringify(want)) problems.push(`${where}: found ${JSON.stringify(found)}, app-ids.json says ${JSON.stringify(want)}`)
  }

  // Capacitor's one appId is only read for iOS once the projects exist: by `cap build ios`.
  same('capacitor.config.json', JSON.parse(read('capacitor.config.json')).appId, ios)

  const pbx = read(IOS_FILES[1])
  const count = id => [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].filter(m => m[1] === id).length
  same('Xcode, the app', count(ios), 2)
  same('Xcode, the share extension', count(`${ios}.share`), 2)
  same('Xcode, the widget', count(`${ios}.widget`), 2)
  same('Xcode, all ids', [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = /g)].length, 6)

  const groups = rel => [...read(rel).matchAll(/<string>(group\.[^<]+)<\/string>/g)].map(m => m[1])
  same('the app\'s entitlements', groups(IOS_FILES[2]), [group])
  same('the share extension\'s entitlements', groups(IOS_FILES[3]), [group])
  for (const rel of [IOS_FILES[4], IOS_FILES[5]]) same(rel, read(rel).match(/appGroup = "([^"]+)"/)?.[1], group)

  same('Gradle applicationId', read(ANDROID_FILES[0]).match(/applicationId "([^"]+)"/)?.[1], android)
  const strings = read(ANDROID_FILES[1])
  for (const name of ['package_name', 'custom_url_scheme']) same(`strings.xml ${name}`, strings.match(new RegExp(`name="${name}">([^<]+)<`))?.[1], android)
  return problems
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkAppIds(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exit(1)
  }
  console.log('Every copy of the ids matches app-ids.json.')
}
