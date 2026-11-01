# Local Hub mobile app: plan

An iPhone, iPad and Android client for a person's own Hub. The computer does the work. There is
no hosted backend, no telemetry and no account with us. MIT, like the Hub.

Sources were read on 2026-11-01. Each one is linked where it is used. Where a claim rests on my
own reasoning or has not been tested, it says so.

## 1. Stack: Capacitor 8

| | Capacitor 8.6 | Expo (React Native) | Native (SwiftUI + Kotlin) |
| --- | --- | --- | --- |
| Reuse of the Hub page | Same WebKit and Android WebView, plain JS | Needs a webview module anyway, plus a React shell | Needs a webview anyway |
| Codebases | One shell, plus small native plugins | One, in React | Two |
| Fit with this repo | No framework, like the Hub | Adds React and Metro | Adds two toolchains |
| Share extension, widgets, keyboard | Native targets in `ios/` and `android/`, which we own | Same native code, wrapped in config plugins | First class |
| iOS builds from Windows | Needs a cloud Mac | [EAS](https://expo.dev/pricing): 15 iOS builds a month free | Needs a cloud Mac |
| Testing without a phone | The shell runs in any browser against a mock Hub | Partly | No |

**Pick: Capacitor.** The Hub already has a phone layout, and people customize that page, so the app
should show their page and not a copy of it. React would add a framework to a project that has
none. Expo's real advantage is the iOS cloud build, and any Mac CI gives us that. Native is the
better choice only if the page stops being the main screen.

Requirements checked: [Xcode 26 and Node 22 or newer](https://capacitorjs.com/docs/getting-started/environment-setup);
[iOS 15, minSdk 24, target SDK 36](https://capacitorjs.com/docs/updating/8-0) (the in-app browser raises minSdk to 26).

### Three plugin decisions

- **Hub page: `@capacitor/inappbrowser` `openInWebView`.** It is a second native web view with no
  Capacitor bridge, so the Hub page and anything it embeds can never call native code or read the
  token. [Storage is isolated from the app](https://capacitorjs.com/docs/apis/inappbrowser), and it
  sends `customHeaders` on the first load. The Hub swaps that header for a cookie. An iframe was
  ruled out: it would be third-party inside the shell, and I expect those cookies to be blocked.
- **Token: `@aparajita/capacitor-secure-storage` (MIT).** It uses the
  [iOS Keychain and an Android Keystore AES-GCM key](https://github.com/aparajita/capacitor-secure-storage/blob/main/README.md),
  with no third-party crypto. iCloud sync stays off.
- **QR scanning: our own small plugin, not `@capacitor/barcode-scanner`.** That plugin's Android
  build pulls in `com.google.mlkit:barcode-scanning` (read from its `build.gradle`, v3.1.3), and
  [ML Kit sends usage metrics to Google](https://developers.google.com/ml-kit/terms). That breaks
  the no-telemetry rule. Ours uses ZXing (Apache-2.0) on Android and AVFoundation on iOS.

## 2. Store rules

### What makes this more than a wrapper

[Apple 4.2](https://developer.apple.com/app-store/review/guidelines/) (updated 2026-10-16) asks for
features that "elevate it beyond a repackaged website". Our answer:

| Feature | When | Note |
| --- | --- | --- |
| Pairing by camera QR, token in Keychain or Keystore | First build | A browser cannot do this |
| Native status screen: offline, computer asleep, Hub stopped, phone removed | First build | Works when the Hub cannot be reached |
| Share sheet into Hub chat, with a queue while the computer sleeps | First build | Android complete. iOS extension in `ios/`, see section 5 |
| Built-in demo mode | First build | Also how reviewers test it |
| Face ID or fingerprint lock | Before submitting | Small |
| Home Screen widget with Hub status, and quick actions | Before submitting | Native targets. The widget shows the last check |
| iPad layout pass | Before submitting | |
| Snippets keyboard | Later | [4.4.1](https://developer.apple.com/app-store/review/guidelines/) has extra rules, and it needs network access to reach the Hub |
| Notifications | Later, and limited | See below |

**Push is the honest gap.** APNs and FCM need a sender holding a provider key. With no hosted backend,
that key would have to ship inside an open-source Hub, which we won't do. Options are UnifiedPush on Android,
and on iOS only background refresh plus local notifications, which the OS runs when it chooses. The
first version has no notifications and should not advertise any.

### How a reviewer tests an app that needs your own computer

[Apple 2.1](https://developer.apple.com/app-store/review/guidelines/) asks for "an active demo
account or fully-featured demo mode" and names "a sample QR code" as something to provide. Google
requires [access instructions](https://support.google.com/googleplay/android-developer/answer/9859455?hl=en)
for login-restricted apps. So:

- **Try the demo** on the first screen runs on bundled sample data, with no network.
- The demo includes the pairing flow. App Review notes include a sample code that pairs with the
  built-in demo Hub, so the reviewer can see the whole flow.
- We host nothing for review, so no server has to stay up.

[Home Assistant's app](https://companion.home-assistant.io/docs/getting_started/) is the closest
precedent: a store app that connects to a server the user runs. That shows the model exists, not
that we will pass.

### Privacy labels

- **Apple: "Data Not Collected"** is the expected answer. Apple defines
  [collect](https://developer.apple.com/app-store/app-privacy-details/) as sending data off the
  device so that "you and/or your third-party partners" can access it beyond the request. Data here
  goes only to the user's own computer, and we never see it. A privacy policy URL is required anyway.
- **Google needs more care.** Its [definition](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
  is "transmitting data from your app off a user's device", and it covers libraries and web views
  whose content the app controls. The form is required even with nothing collected, and so is a
  privacy policy. Expect to answer the form honestly about shared text and URLs going to the user's
  own server. My reading is that this data is not collected by the developer. The Tailscale tunnel's
  end-to-end encryption may also fit Google's exclusion, but not plain HTTPS through a proxy we
  don't control. **The person submitting must make this call. I have not confirmed it with Google.**
- **iOS:** the app includes `PrivacyInfo.xcprivacy` (no tracking, no data types), a camera purpose
  string, and `ITSAppUsesNonExemptEncryption=false`, since it only uses the OS's HTTPS.
- **AI:** [Apple 5.1.2(i)](https://developer.apple.com/app-store/review/guidelines/) requires disclosure
  and permission when personal data goes to third-party AI. The app itself sends nothing to an AI
  service, but Hub chat runs on the user's own Claude login. The share screen says the text goes
  to the Hub's assistant, and the store listing and policy should say so too.

### Google Play for a new personal account

- [Closed test: at least 12 testers opted in for 14 continuous days](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en),
  then apply for production access. Organization accounts are not covered by this rule.
- [Target API 36](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en) for new
  apps since 2026-08-31.
- [US$25 once, government ID, and access to a physical Android device](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en).
- [Developer verification](https://developer.android.com/developer-verification) is enforced outside
  Play from 2026-09-30 in Brazil, Indonesia, Singapore and Thailand, and globally from 2027. It
  matters if we also ship an APK from GitHub, and there is an open-source registration path.
- [Spam policy](https://support.google.com/googleplay/android-developer/answer/9899034?hl=en) bars web
  views of a site without the owner's permission. Here the user owns the site, and the app ships
  with no site at all.

### What could still get it rejected

1. **4.2 "repackaged website".** The biggest risk. If a reviewer sees mostly a web view, we can lose
   this despite the list above. That is why widgets and the lock should land before submission.
2. **4.2.3(i), "without requiring installation of another app".** Tailscale is another app. The app
   accepts any HTTPS address, and the demo runs alone, so the listing must not say Tailscale is
   required. A reviewer may still object.
3. **2.5.2 and 4.7, code that changes features.** The Hub's JavaScript loads at run time and can
   change. It comes from the user's own computer, not from us, and renders in WebKit as
   [2.5.6](https://developer.apple.com/app-store/review/guidelines/) requires. 4.7 also mentions
   chatbots and carries filtering and reporting duties, which we say don't apply because nothing is
   offered by us. That is my reading, not Apple's.
4. **Age rating and AI.** Apple's updated [questionnaire](https://developer.apple.com/news/upcoming-requirements/)
   must be answered with the assistant in mind.
5. **Upload blocks.** [Xcode 26 and the iOS 26 SDK](https://developer.apple.com/news/upcoming-requirements/)
   have been required since 2026-04-28. These fail at upload, not review.

## 3. Connection and security

### Finding and pairing

1. On the computer, the person opens **Pair a phone** in the Hub. It shows a QR code, the address,
   and a one-time 8-character code that lasts 5 minutes.
2. The app scans the QR, or the person types the address and code. There is no network discovery in
   the first version: it wouldn't work over a tunnel, and a code on a screen proves physical access.
3. A QR or `localhub://` link always opens a confirm screen with the address. A link alone never
   pairs, or a hostile link could point the phone at someone else's server.
4. The Hub returns a device token. It keeps only the SHA-256 hash, and the phone keeps the token.

Five wrong guesses burn the code. Removing a phone in the Hub ends its access, and the app shows
"This phone was removed" with a way to pair again.

### Reaching it away from home, without exposing it

**HTTPS only, through the person's own private network.** The recommended setup is
[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), one command on the computer:

```bash
tailscale serve --bg http://127.0.0.1:3100
```

The phone reaches the computer's Tailscale HTTPS name over WireGuard with a valid certificate, and
nothing is public. Serve is not Funnel: **Funnel is public, and the docs must say never to use it for
the Hub.** Any private route with a trusted HTTPS certificate also works.

Why not today's `http://<tailscale-ip>:3100`? Cleartext would need an App Transport Security exception on iOS
and a cleartext allowance on Android, both of which get scrutiny and neither of which is needed. Release builds refuse
`http://`. Debug builds allow only `localhost` and the Android emulator host.

One trade-off to tell people: [machine names go into the public certificate ledger](https://tailscale.com/kb/1153/enabling-https).
Tailscale access is still restricted, but a machine named after a person is visible. Rename it first.

### Token storage

Keychain (device-only, after first unlock, no iCloud sync) on iOS. An AES-GCM key in Android
Keystore on Android, with `allowBackup=false` so nothing leaves in backups. The token never goes in a
URL, is never logged, and is never exposed to the Hub page, which only gets an HttpOnly cookie.

### States the app must tell apart

| What the app sees | What it says |
| --- | --- |
| OS reports no network | You're offline |
| `GET /api/pair/me` returns 200 | Connected |
| Network error or timeout | Can't reach your computer: it may be asleep, or the private network is off on this phone |
| 502, 503 or 504 | Your computer is on, but the Hub isn't running |
| 401 | This phone was removed |
| 404 | This Hub needs updating |

Asleep and off look the same from a phone, so the app never claims to know which. The 502 row rests
on how I expect `tailscale serve` to behave with no backend, and is **not yet measured**.

### What the Hub needs

The Hub has no login today: Tailscale access is the only gate. The app needs one. It is written and
tested in [`hub-changes/`](hub-changes/README.md), with the exact lines for `server.mjs` and
`chat.mjs`, for the Hub's owner to apply. Nothing in the Hub itself has been changed.

| Route | Who | What |
| --- | --- | --- |
| `GET /pair/new` | This computer only | Page with the QR code and pairing code |
| `POST /api/pair/start` | This computer or a paired device | Makes a code |
| `POST /api/pair/claim` | Anyone holding a code | Returns a device token |
| `GET /api/pair/me` | Paired device | Who am I. Also the health check |
| `GET /api/pair/devices`, `POST /api/pair/devices/<id>/remove` | This computer or a paired device | List and remove phones |
| `GET /pair` | Anyone | Code page so a browser on the private network can sign in |

The trap: **behind `tailscale serve`, every request arrives from `127.0.0.1`.** A gate that trusts
loopback would let the whole Tailscale network in. The gate treats a request as local only when the source is
loopback, the `Host` is `localhost` or `127.0.0.1`, and no forwarding or `Tailscale-User-*` header is present.

The gate is off until `hub.json` sets `"deviceAuth": true`, so applying the change breaks nothing
for browsers already on the Tailscale network.

Share into chat needs one more change. `chat.mjs` kills the reply when the connection closes, and a
phone goes away straight after sharing. A `detached` flag lets that one send finish on its own.

## 4. Builds from Windows

**Android** builds here with no Android Studio: a JDK and the Android SDK command-line tools, then
`gradlew assembleDebug`. About 3 GB (my estimate). Free.

**iOS needs macOS** and [Xcode 26](https://capacitorjs.com/docs/getting-started/environment-setup),
so it builds in the cloud:

| Route | Cost | Good for |
| --- | --- | --- |
| GitHub Actions macOS runner | [US$0.062 a minute](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions) against included compute on a private repo. Free once the repo is public | Simulator builds, no Apple account needed |
| Codemagic | [500 macOS minutes a month free](https://codemagic.io/pricing/) | TestFlight, with signing kept in Codemagic |
| Own or rented Mac | Varies | Device debugging |

Simulator builds need no signing and no account. Anything on a real iPhone needs the paid program.
[Apple asks that apps be tested on a device before submitting](https://developer.apple.com/app-store/review/guidelines/),
so at least one TestFlight round on a real phone is needed.

### First results (2026-11-01, GitHub Actions)

| Build | Result | Run time | What it shows |
| --- | --- | --- | --- |
| Android debug, Ubuntu, JDK 21 | Success, 12.6 MB APK | 3 min 36 s | It compiles and the manifest merges. Never opened |
| iOS simulator, unsigned, Xcode 26.6 | Success, no errors | 3 min 43 s | It compiles, the share extension is inside the app, and the app opened to its welcome screen once |

A build that compiles doesn't show the app works. Nothing was tapped in either build, and neither ran
on a real device. The first APK also showed that a plugin adds microphone and location permissions.
The app uses neither, so the manifest removes them and the workflow fails if they return. That fix has
not been through a build yet.

These runs used `.github/workflows/mobile.yml`, the one file outside `mobile/`, and need no signing or
secrets. Whether it goes into `main` is the Hub owner's call at merge time.

## 5. What the owner has to do

Nothing here is done or started.

| Step | Cost | Notes |
| --- | --- | --- |
| Apple Developer Program | [US$99 a year](https://developer.apple.com/programs/whats-included/) | Decide personal or organization |
| Google Play developer account | US$25 once | ID and a physical Android device. Organization accounts skip the 12-tester rule |
| Choose the app ID, bundle ID, URL scheme and store name | | The repo uses `com.example.localhub` on purpose: it cannot be uploaded until replaced |
| iOS signing and an App Store Connect API key, kept in the CI's secret store | | Never in the repo |
| Android upload key, kept outside the repo | | Losing it is a real problem, so use Play App Signing |
| Privacy policy page | | A plain page in the public repo works |
| Store listings, screenshots, age rating, Data safety and App Privacy answers | | |
| 12 testers for 14 days on Google Play | | Only for a personal account |
| Apply the Hub changes | | The Hub's owner, not this branch |
| turn on HTTPS for the Tailscale network and run `tailscale serve` | | Each person who uses the app does this for their own Hub |
