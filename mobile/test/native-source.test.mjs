// Reads the native sources, because nothing on this machine can run them. These catch a change that
// quietly breaks a promise. They don't show the code works: only a device can show that.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const JAVA = 'android/app/src/main/java/com/example/localhub'
const code = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const WIDGET_SOURCES = [
  `${JAVA}/HubWidgetProvider.java`,
  'android/app/src/main/res/layout/hub_widget.xml',
  'android/app/src/main/res/xml/hub_widget_info.xml',
  'ios/App/HubWidget/HubWidget.swift',
  'ios/App/HubWidget/Info.plist',
]

test('the widget reads, stores and fetches nothing', () => {
  for (const rel of WIDGET_SOURCES) {
    const text = code(read(rel))
    for (const banned of [/SharedPreferences/, /UserDefaults/, /Keychain/, /SecItem/, /appGroup|group\.com\.|containerURL/, /URLSession|HttpURLConnection|OkHttp|https?:\/\/(?!schemas\.android|www\.apple)/, /FileManager|openFileInput|getFilesDir/, /token|hubName|address/i]) {
      assert.ok(!banned.test(text), `${rel} matches ${banned}`)
    }
  }
})

test('the widget does not update itself, and its only links are the three quick actions', () => {
  assert.match(read('android/app/src/main/res/xml/hub_widget_info.xml'), /updatePeriodMillis="0"/)
  assert.match(read('ios/App/HubWidget/HubWidget.swift'), /policy: \.never/)
  const swift = code(read('ios/App/HubWidget/HubWidget.swift'))
  const links = [...swift.matchAll(/localhub:\/\/action\/([^")]+)/g)].map(m => m[1])
  assert.deepEqual(links, ['open', '\\(action']) // the small widget's link, and the medium one's
  assert.deepEqual([...swift.matchAll(/action: "(\w+)"/g)].map(m => m[1]), ['open', 'compose', 'status'])
  const java = code(read(`${JAVA}/HubWidgetProvider.java`))
  assert.deepEqual([...java.matchAll(/action\(context, "(\w+)"/g)].map(m => m[1]), ['open', 'compose', 'status'])
  assert.match(java, /FLAG_IMMUTABLE/)
  assert.match(java, /MainActivity\.class/, 'an explicit intent, to this app only')
})

test('the widget has no entitlements and no shared storage with the app', () => {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj')
  const widgetConfigs = pbx.split('isa = XCBuildConfiguration').filter(s => s.includes('INFOPLIST_FILE = HubWidget/Info.plist'))
  assert.equal(widgetConfigs.length, 2)
  for (const config of widgetConfigs) assert.ok(!config.includes('CODE_SIGN_ENTITLEMENTS'))
  assert.ok(!fs.existsSync(path.join(ROOT, 'ios/App/HubWidget/HubWidget.entitlements')))
  const manifest = read('android/app/src/main/AndroidManifest.xml')
  assert.match(manifest, /android:name="\.HubWidgetProvider"\s+android:label="@string\/app_name"\s+android:exported="false"/)
})

test('widget files declare no tracking or collected data', () => {
  const privacy = read('ios/App/HubWidget/PrivacyInfo.xcprivacy').replace(/\s+/g, '')
  assert.ok(privacy.includes('<key>NSPrivacyTracking</key><false/>'))
  assert.ok(privacy.includes('<key>NSPrivacyCollectedDataTypes</key><array/>'))
  assert.ok(privacy.includes('<key>NSPrivacyAccessedAPITypes</key><array/>'))
})

test('Android lock: strong biometrics only, tied to a key that new enrolment destroys', () => {
  const java = code(read(`${JAVA}/HubLock.java`))
  assert.ok(!/DEVICE_CREDENTIAL|setDeviceCredentialAllowed/.test(java), 'the passcode must not open it')
  assert.ok(!/BIOMETRIC_WEAK/.test(java), 'weak biometrics can\'t release a key')
  assert.match(java, /setUserAuthenticationRequired\(true\)/)
  assert.match(java, /setInvalidatedByBiometricEnrollment\(true\)/)
  assert.match(java, /setUserAuthenticationParameters\(0, KeyProperties\.AUTH_BIOMETRIC_STRONG\)/)
  assert.match(java, /new BiometricPrompt\.CryptoObject\(cipher\)/, 'the prompt must unlock this key, not just answer yes')
  assert.match(java, /FLAG_SECURE/)
  assert.ok(!/Log\.[a-z]\(/.test(java), 'nothing logged')
})

test('iOS lock: biometrics only, on the set enrolled today, on this device only', () => {
  const swift = code(read('ios/App/App/HubLock.swift'))
  assert.ok(!/\.deviceOwnerAuthentication\b|\.userPresence|\.devicePasscode|\.biometryAny/.test(swift), 'the passcode must not open it')
  assert.match(swift, /\.biometryCurrentSet/)
  assert.match(swift, /kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly/)
  assert.ok(!/print\(|NSLog|os_log|Logger\(/.test(swift), 'nothing logged')
  assert.ok(!/kSecUseAuthenticationUIFail|kSecUseAuthenticationUISkip/.test(swift))
  assert.match(read('ios/App/App/Info.plist'), /NSFaceIDUsageDescription/)
})

test('what the Android lock stores is only ciphertext, and neither lock puts the token in plain settings', () => {
  for (const rel of [`${JAVA}/HubLock.java`, 'ios/App/App/HubLock.swift']) {
    const text = code(read(rel))
    assert.ok(!/token.*(UserDefaults|putString\("(?!token))/.test(text), rel)
  }
  const java = code(read(`${JAVA}/HubLock.java`))
  // What's stored under the "token" name is only ever the ciphertext.
  assert.match(java, /putString\(BLOB, Base64\.encodeToString\(blob/)
  assert.equal([...java.matchAll(/putString\(/g)].length, 1)
})

test('the release build shrinks, and the keep rules cover what reads fields by name', () => {
  const gradle = read('android/app/build.gradle')
  const release = gradle.slice(gradle.indexOf('release {'), gradle.indexOf('minified {'))
  assert.match(release, /minifyEnabled true/)
  assert.match(release, /shrinkResources true/)
  assert.match(release, /proguard-android-optimize\.txt/)
  const rules = read('android/app/proguard-rules.pro')
  assert.match(rules, /-keep class com\.capacitorjs\.osinappbrowser\.\*\*/)
  assert.match(rules, /-keep class com\.outsystems\.plugins\.inappbrowser\.osinappbrowserlib\.\*\*/)
})

test('plain HTTP is only for debug and the emulator test\'s build, never release', () => {
  const main = read('android/app/src/main/res/xml/network_security_config.xml')
  assert.match(main, /cleartextTrafficPermitted="false"/)
  assert.ok(!main.includes('cleartextTrafficPermitted="true"'))
  assert.ok(!fs.existsSync(path.join(ROOT, 'android/app/src/release')))
  for (const rel of ['android/app/src/debug', 'android/app/src/minified']) {
    const xml = read(`${rel}/res/xml/network_security_config.xml`)
    assert.ok(xml.includes('10.0.2.2'), rel)
    assert.match(xml, /<base-config cleartextTrafficPermitted="false"/)
  }
})

test('the version and build number have one source, and every target reads it', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.ok(Number.isInteger(pkg.buildNumber) && pkg.buildNumber >= 1)
  const lock = JSON.parse(read('package-lock.json'))
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].version, pkg.version)
  const gradle = read('android/app/build.gradle')
  assert.ok(gradle.includes(`versionCode ${pkg.buildNumber}\n`) || gradle.includes(`versionCode ${pkg.buildNumber}\r\n`))
  assert.ok(gradle.includes(`versionName "${pkg.version}"`))
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj')
  const marketing = [...pbx.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(m => m[1])
  const builds = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map(m => m[1])
  assert.equal(marketing.length, 6, 'debug and release of the app and both extensions')
  assert.deepEqual([...new Set(marketing)], [pkg.version])
  assert.equal(builds.length, 6)
  assert.deepEqual([...new Set(builds)], [String(pkg.buildNumber)])
  for (const rel of ['ios/App/App/Info.plist', 'ios/App/ShareExtension/Info.plist', 'ios/App/HubWidget/Info.plist']) {
    const plist = read(rel).replace(/\s+/g, '')
    assert.ok(plist.includes('<key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string>'), rel)
    assert.ok(plist.includes('<key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string>'), rel)
  }
})

test('the share extension takes only what goes to chat: text and one web link', () => {
  const plist = read('ios/App/ShareExtension/Info.plist').replace(/\s+/g, '')
  const rule = plist.match(/<key>NSExtensionActivationRule<\/key><dict>(.*?)<\/dict>/)?.[1]
  assert.equal(rule, '<key>NSExtensionActivationSupportsText</key><true/><key>NSExtensionActivationSupportsWebURLWithMaxCount</key><integer>1</integer>')
})

test('iOS says why it needs Face ID, the camera and the local network', () => {
  const plist = read('ios/App/App/Info.plist')
  for (const key of ['NSFaceIDUsageDescription', 'NSCameraUsageDescription', 'NSLocalNetworkUsageDescription']) {
    assert.match(plist, new RegExp(`<key>${key}</key>\\s*<string>[^<]{20,}</string>`), key)
  }
  assert.ok(!plist.includes('NSBonjourServices'), 'the app looks nothing up on the network')
})
