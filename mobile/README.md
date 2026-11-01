# Local Hub mobile app

An iPhone, iPad and Android client for your own Hub. The computer does the work: the app pairs with
it, stores one key, and shows the Hub's own mobile page. MIT. No telemetry, no hosted backend and no
account with us.

**Status: first build, not released.** See [What is not proven](#what-is-not-proven). The app and
bundle IDs are `com.example.localhub` placeholders, so it can't be uploaded to a store as it is.

## What's here

| Path | What it is |
| --- | --- |
| `PLAN.md` | Stack, store rules, security, builds, what the owner has to do, with sources |
| `src/` | The shell: pairing, stored connection, status screens, share composer |
| `android/`, `ios/` | Native projects, including the `HubNative` plugin and the iOS share extension |
| `hub-changes/` | The pairing routes and exact lines the Hub needs. Not applied to the Hub |
| `dev/mock-hub.mjs` | A local Hub stand-in that runs the real pairing module |
| `scripts/native-setup.py` | Every change made to the Capacitor templates, written out |
| `scripts/make-icons.mjs` | Draws the icons and launch screens from the Hub's own icon |

## Run the tests

Needs Node 22 or newer. The UI test drives headless Edge, so it needs Edge installed.

```bash
npm ci
npm test
npm run build:dev && npm run test:ui
npm run licenses
```

`hub-changes/test/real-hub.mjs` boots a real Hub from a git ref with the changes applied:

```bash
node hub-changes/test/real-hub.mjs <path-to-hub-checkout>
```

## Build

Always rebuild the release bundle before a native build. A dev bundle carries test hooks.

```bash
npm run build && npx cap sync
```

**Android** needs a JDK 21 and the Android SDK:

```bash
cd android && ./gradlew assembleDebug
```

**iOS** needs macOS and Xcode. A simulator build needs no signing and no account:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -destination "generic/platform=iOS Simulator" CODE_SIGNING_ALLOWED=NO build
```

## What is not proven

Both platforms compile in `.github/workflows/mobile.yml`, and the iOS build opened to its welcome
screen once in a simulator. A build that compiles doesn't show the app works. Nothing has been
tapped, and the Android build has never been opened.

Everything here needs a real device or a real Hub, and has not been run:

- The native code: the QR scanner, the share sheet and share extension, Keychain and Keystore storage.
- Android's content security policy with Capacitor's bridge.
- The Hub page inside the in-app web view, including file picking and how the shell behaves behind it.
- The Hub chat's voice input, which uses `SpeechRecognition`, inside that web view.
- Pairing and requests through `tailscale serve`, including its error pages for a sleeping computer.

The shell's logic and copy are tested in headless Edge against the mock Hub. That says nothing about
the items above.
