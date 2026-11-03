# LocalHub mobile app

An iPhone, iPad and Android client for your own Hub. The computer does the work: the app pairs with
it, stores one key, and shows the Hub's own mobile page. MIT. No telemetry, no hosted backend and no
account with us.

**Status: first build, not released.** See [What is not proven](#what-is-not-proven).

## What's here

| Path | What it is |
| --- | --- |
| `PLAN.md` | Stack, store rules, security, builds, what the owner has to do, with sources |
| `src/` | The shell: pairing, stored connection, status screens, share composer |
| `android/`, `ios/` | Native projects, including the `HubNative` plugin and the iOS share extension |
| `hub-changes/` | How pairing works on the Hub, and its tests |
| `dev/mock-hub.mjs` | A stand-in for your Hub that runs the real pairing module |
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

`hub-changes/test/real-hub.mjs` boots a real Hub from a git ref:

```bash
node hub-changes/test/real-hub.mjs <path-to-hub-checkout>
```

## Build

### Building your own copy: set your own ids first

The iOS id in this repo, `com.forgeitsolutions.localhub`, belongs to this project's maintainers, and only
their Apple team can sign with it. Android still has a placeholder, and stores refuse that. Set yours
before anything else:

```bash
node scripts/set-app-id.mjs --ios org.example.myhub --android org.example.myhub
```

That changes every copy, including the share extension (`.share`), the widget (`.widget`) and the App
Group (`group.<id>`). `node scripts/check-app-ids.mjs` checks that they all match. The two ids may
differ. `app-ids.json` holds them. Running `cap add` again rewrites the ids, so set them again after it.
Register the ids under your own accounts, with your own signing. None of that is in this repo.

### Build the app

Always rebuild the release bundle before a native build. A dev bundle carries test hooks.

```bash
npm run build && npx cap sync
```

**Android** needs a JDK 21 and the Android SDK:

```bash
cd android && ./gradlew assembleDebug
```

To change the version, `npm run version:set -- 1.2.3 4` sets it everywhere. Stores refuse a build number
they have seen.

A release build needs your own signing, and it shrinks the app's code:

```bash
cd android && ./gradlew assembleRelease
```

**iOS** needs macOS and Xcode. A simulator build needs no signing and no account:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -destination "generic/platform=iOS Simulator" CODE_SIGNING_ALLOWED=NO build
```

## Try it against a real Hub

None of these three routes has been run yet. Installing on a real phone or iPad needs its own signing.

**Android emulator.** The emulator reaches the computer at `10.0.2.2`. The Hub only answers to its own
names, and that isn't one of them, so add it to `config/hub.json` on the Hub's computer:

```json
"hosts": ["10.0.2.2"]
```

Build with the dev bundle, because the release bundle refuses `http://`. That includes the APK from CI.

```bash
npm run build:dev && npx cap sync android
```

```bash
cd android && ./gradlew assembleDebug
```

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Open `http://localhost:3100/pair/new` on the computer. In the emulator, type `http://10.0.2.2:3100` and
the code. There is no QR without a `url`. When you finish, take `10.0.2.2` back out of `hosts` and
rebuild with the release bundle.

**iOS simulator.** Use the dev bundle and `http://localhost:3100`, with nothing to add to `hosts`. The
Hub treats that name as its own computer, so this says nothing about the passcode gate.

**A phone.** Set up [Tailscale Serve](PLAN.md#reaching-it-away-from-home-without-exposing-it), put its
HTTPS address in `url`, and scan the QR at `/pair/new`. This is the only route that tests the gate as
people will use it.

## What is not proven

Both platforms compile in `.github/workflows/mobile.yml`, and the iOS build opened to its welcome
screen once in a simulator. A build that compiles doesn't show the app works. Nothing has been
tapped, and the Android build has never been opened.

Everything here needs a real device or a real Hub, and has not been run:

- The native code: the QR scanner, the share sheet and share extension, Keychain and Keystore storage,
  and clearing the Hub page's cookies when a device is forgotten.
- Android's content security policy with Capacitor's bridge.
- The Hub page inside the in-app web view, including file picking and how the shell behaves behind it.
- The Hub chat's voice input, which uses `SpeechRecognition`, inside that web view.
- Pairing and requests through `tailscale serve`, including its error pages for a sleeping computer.

The shell's logic and copy are tested in headless Edge against the mock Hub. That says nothing about
the items above.
