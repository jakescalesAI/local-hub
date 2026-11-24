# LocalHub TV

The Apple TV home screen, with LocalHub inside. A Top Shelf across the top, a five-column grid of
16:10 icons that lift, tilt and catch the light, a drop-down from the top right — and all of it the
hub's own: its wallpaper and style, the widgets you pick for the TV in the hub's Home editor, and
its assistant, the same "Ask anything" bar and Hub Assistant (browser, files, tools) with the same
conversations as the laptop. The TV shows a page served by your hub; what only a TV can do (your
installed apps, launching them, HDMI inputs, the microphone, speech) comes from the Fire TV app.

```
 Fire TV                                    your laptop
┌───────────────────────────────┐          ┌─────────────────────────────────────────────┐
│ LocalHub TV app (tv/android)  │  LAN     │ LocalHub :3100                               │
│  WebView ── GET /tv/ ─────────┼─────────▶│  /tv/          this page (tv/ui)             │
│   with the device key; the    │  cookie  │  /tabs/chat.js the assistant bar + card      │
│   hub swaps it for a cookie   │          │  /api/hub/settings  wallpaper, style, widgets│
│  Java: apps + icons, launch,  │          │  chat.mjs      the agent (browser, files…)   │
│   HDMI, mic, speech           │          │  tv.mjs        commands · Whisper · Alexa    │
└───────────────────────────────┘          └─────────────────────────────────────────────┘
```

| Path | What it is |
| --- | --- |
| `ui/` | The TV page, tvOS-style. The top row starts with the **LocalHub** tile, whose Top Shelf is a greeting and the hub's TV widgets; every other app's Top Shelf is its own art. Below: all apps, the HDMI inputs and Settings. Top right: the status pill and its drop-down (the TV widgets, Ask LocalHub, Wi-Fi, sleep timer, screensaver, sleep, Bluetooth, inputs, Settings). It loads `/hub-config.js`, `/tabs/browser.js` and `/tabs/chat.js` from the hub. |
| `open.mjs` | `npm run tv`: opens the TV page full screen in its own Edge or Chrome window, so a laptop shows what a TV would. |
| `android/` | The Fire TV / Android TV app, Java 17, no third-party libraries. Opens the hub's `/tv/`; when the hub can't be reached, a bundled copy of `ui/` (with the hub's icon and wallpapers) that can pair and launch apps. |
| `whisper.py` | Speech to text on the laptop (faster-whisper), kept warm by `tv.mjs`. |
| `alexa/` | The Alexa skill: interaction model and setup steps. |
| `../tv.mjs` | The hub side: serves `/tv/` (and the hub's own `icons/hub.svg` and `wallpapers/` under it), the TV command queue, transcription, the Alexa listener. |

### What stays in sync, and how

- **Look:** every 30 seconds the TV reads `/api/hub/settings` and applies the wallpaper, accent,
  widget look (glass / solid / outline), blur, transparency, corner radius, shadow and font the way
  `tabs/custom.js` does on the laptop. Change them in the hub's Style panel; the TV follows. On a TV
  "auto" means dark.
- **Widgets:** the hub's Home editor has a fourth view, **TV**, next to Desktop, iPad and Mobile: a
  16:9 screen on a stand. The widgets you put there are the ones the TV shows on the LocalHub tile's
  Top Shelf and in the drop-down (Clock & date, Date and World clock today; others show a card saying
  so), in that order. Stored as `widgets.tv` in the hub settings; a hub that had none starts with
  Clock & date, Date and World clock.
- **Assistant:** it *is* `tabs/chat.js`, with `tabs/browser.js` for the live browser. History, new
  chat, full chat, model picker, approvals and the browser are the hub's; a conversation started on
  the TV is in the laptop's history and the other way round. Each message says it came from the TV
  tab, so the agent keeps answers short enough to read aloud.
- **Name, icon, owner:** `HUB_CONF.name`, `icons/hub.svg`, and the greeting uses `owner`.

## See it now, on this laptop

```sh
npm start        # LocalHub, if it isn't running
npm run tv       # LocalHub TV, full screen in its own window (npm run tv -- --window for 1600×900)
```

or open **http://localhost:3100/tv/** in any browser. The keyboard is the remote:

| Key | Does |
| --- | --- |
| Arrows | Move. Up from the top row reaches the status pill; Down from the last row reaches the bar |
| Enter | Open. On the LocalHub tile it opens LocalHub itself, on Home's TV view |
| Esc | Back |
| M | The top-right drop-down |
| Space | Talk (the laptop's mic → Whisper → the hub's bar) |
| ? | Shows or hides this list |

The mouse works too: hovering focuses and tilts an icon, a click opens it, the wheel scrolls.
On a laptop the apps open their **real websites** (Netflix, YouTube, Prime Video, Disney+, Max,
Apple TV, Plex, Spotify, …) inside LocalHub TV, in one of its browsers below; only a laptop with no
Chrome, Chromium or Edge at all opens them in a new window. Typing or saying **"open Netflix"** in the
bar does the same at once, without the agent.

## The browsers: Browser and Chromium

Two tiles are browsers running on the laptop and shown full screen on the TV (`stream.mjs`, `ui/stream.js`):
**Browser** is Google Chrome, whose Widevine plays Netflix, Prime Video, Disney+ and the rest, and
**Chromium** is a Chromium build (Playwright's or Puppeteer's download, Chromium.app, the chromium
package), or Chrome's or Edge's program run as Chromium when there's none. Both run headless with
their own profiles in `data/tv-stream/`, apart from the agent's browser, so sign-ins (a Netflix login)
last and the agent is never disturbed. The web app tiles open in Chrome when it's there.

The picture is Chrome's own screencast: 1920×1080 JPEG frames over one HTTP response, the page laid
out at 1280×720 so it reads from the sofa. The remote: arrows move a pointer (faster while held; at an
edge the page scrolls, and Up at the top reaches the bar), OK clicks, Back goes back and leaves from the
app's first page, Menu types an address or a search, ⏯ is the page's Space. A click on a text field
brings up a sheet with a real input, so a Fire TV shows its keyboard; on a laptop just type.
`"tv": { "stream": { "zoom": 1.5, "quality": 80, "chrome": { "window": true } } }` in hub.json changes
the zoom, the JPEG quality, or shows Chrome as a window on the laptop (about half the frame rate).

**The assistant's browser** (the agent's own Chrome, `browser.mjs`) opens full screen from a browser card
in the Assistant (`ui/agentview.js`). Its arrows jump link to link with a ring round what OK presses: the hub finds
the nearest link, button or field that way (`page-snap.mjs`, shared with the Browser's links mode), and with nothing
more that way Up and Down scroll and carry on. Menu swaps to a free pointer, and Back gives the browser back to the agent.

## Put it on the TV

The easy way: in LocalHub on the laptop, open **Home → TV → Set up a TV** (or the TV tile, or
`http://localhost:3100/#tv-setup`). It walks through all three steps on one sheet:

1. **Put the app on the TV.** On a Fire TV, *Settings → My Fire TV → Developer options → Install
   unknown apps* → turn it on for **Downloader** (free, from the Appstore). In Downloader, type the
   link the sheet shows (the newest release's `LocalHub-TV.apk`); a QR code has the same link. On
   Google TV / Android TV, the same with Downloader from Google Play.
2. **Let the TV find LocalHub.** *Turn on* adds this computer's home-network address to `"listen"`
   in `config/hub.json`, and the hub starts answering there at once (and stops when you turn it off).
   It needs the passcode first and offers to set one: anything on the network other than a paired TV
   is asked for it. It stays off the internet. If Windows asks whether Node.js may use the network,
   allow it on private networks.
3. **Pair the TV.** *Show a pairing code*, then on the TV choose **Pair** and type it (it lasts five
   minutes). The TV keeps its own device key; the sheet lists paired TVs, each with *Remove*.

The rest of this section is the same by hand, for building it yourself or using adb.

1. **Build** (or take the `localhub-tv-apk` artifact from the *TV* workflow):

   ```sh
   cd tv/android
   gradle :app:assembleDebug        # → app/build/outputs/apk/debug/app-debug.apk
   ```

   Needs JDK 17, Gradle 8.7 and the Android SDK (platform 34). No other dependencies.
2. **Install.** On the TV: *Settings → My Fire TV → Developer options → ADB debugging: On* (tap
   *About → Fire TV Stick* seven times if Developer options is hidden). Then from the laptop:

   ```sh
   adb connect <tv-ip>:5555
   adb install -r app-debug.apk
   ```

   Or put the APK on a web page you control and fetch it with the Downloader app.
3. **Make LocalHub the TV's home** (Fire TV). Fire OS won't let another app be the home screen, and it
   blocks a sideloaded app's accessibility service, so LocalHub watches for Amazon's home instead. Two
   one-time grants over adb; neither can read the screen or your key presses:

   ```sh
   adb shell pm grant local.hub.tv android.permission.READ_LOGS          # Home brings LocalHub back
   adb shell appops set local.hub.tv SYSTEM_ALERT_WINDOW allow           # the cover while Android lets it back in
   ```

   Undo: `adb shell pm revoke local.hub.tv android.permission.READ_LOGS` and
   `adb shell appops set local.hub.tv SYSTEM_ALERT_WINDOW deny`. On Android TV / Google TV, pick LocalHub
   as the home app instead.

## Day to day

**Where it is on the Fire TV.** *Your Apps* (the ⋯ row on Amazon's home, or *Settings → Applications →
Manage Installed Applications*). To keep it first in Amazon's own app row: highlight it, ☰, *Move to front*.
"Alexa, open LocalHub" works too.

**The remote's buttons.** Arrows, OK and Back always work the same. ☰ is the microphone: the laptop listens
for what you ask straight away (with *Hey LocalHub* on), or the remote's own dictation when it's off; ⏯ talks
too. Settings → Remote → *Remote buttons* gives any other button a job, on any remote or game controller:
OK, press the button, pick what it does (microphone, sidebar, Assistant, Home, screensaver, Settings, a page
up or down, or nothing). *Back to the standard buttons* undoes it all.

**It opens by itself.** You rarely see Amazon's home:

| When | What happens |
| --- | --- |
| The Fire TV starts (power on) | LocalHub opens (`BootReceiver`) and starts watching for Home |
| The TV is turned off and on (sleep, wake) | Amazon's home comes up while it sleeps; LocalHub is back in front before the screen is (measured: in front within 1.5 s of waking) |
| Home on the remote | A picture of LocalHub's home screen covers Amazon's at once (~1.2 s); the live one takes over underneath when Android allows it (~6 s: its "app switch" wait, which only Amazon's own apps skip) |
| Fire OS closes LocalHub behind a big app, or the graphics driver crashes | It comes back quietly (no logo); the logo is only for a fresh start |

**Where to change things.**

| What | Where |
| --- | --- |
| Wallpaper, clock, screensaver, voice, the LocalHub connection | On the TV: the sidebar's gear (Settings) |
| Favorites, app order, hidden apps, sort, search | On the TV: hold OK on a tile; the Favorites row's buttons |
| Volume, picture, sleep timer, weather | On the TV: the Favorites row's Overlay button |
| The widgets on the home screen and screensaver (weather, …) | LocalHub on the laptop: *Home → TV*, then *Edit* |
| Installing, connecting and pairing TVs | LocalHub on the laptop: *Home → TV → Set up a TV* (or `http://localhost:3100/#tv-setup`) |

**See it on the laptop.** `http://localhost:3100/tv/` in any browser (or `npm run tv` for a full-screen
window); the keyboard is the remote (arrows, Enter, Esc, M). From an iPad or another computer on the same
network: `http://<laptop-address>:3100/tv/`, once that device is signed in to LocalHub; a long press there
is the remote's held OK.

## Connect it to LocalHub

*Set up a TV* (above) does this for you. By hand: the TV reaches LocalHub over your home network, so
LocalHub has to listen there — by default it only answers on the laptop itself.

1. On the laptop, set a passcode (`npm run passcode`) and add the laptop's LAN address to `"listen"`
   in `config/hub.json`, e.g. `"listen": ["192.168.1.20"]`. Restart the hub. (Tailscale works too:
   `"access": "tailnet"`, if the TV runs Tailscale.)
2. On the TV: *Settings → LocalHub* (OK on it) → *Search the network again* looks for it (port 3100). If
   it can't find it, *Type its address* takes `192.168.1.20:3100`.
3. On the laptop open **http://localhost:3100/pair/new**. On the TV: *Settings → LocalHub → Pair this TV* →
   type the code. The TV keeps one device key, in Java, never in the web page. *Forget LocalHub* removes it.

## Talk to it

**Its voice** is Kokoro, an open voice model (the one Quartzi speaks with), run on the laptop by `tv/tts.py`
and served to the TV a sentence at a time (`POST /api/tv/speak`; it warms up a few seconds after the TV
starts). Settings → Assistant voice picks one of seven. Set it up once on the laptop:

```sh
pip install kokoro-onnx soundfile
# into data/tts/: kokoro-v1.0.int8.onnx and voices-v1.0.bin from
# https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0)
```

Without them, the TV's own voice reads answers instead.

- **Type:** Down from the apps lands in the hub's "Ask anything" bar; the Fire TV keyboard opens.
  The answer appears in the Hub Assistant card above it, exactly as on the laptop.
- **Speak: the mic.** With nothing typed, the bar's send button is a mic — in the hub's own chat, so
  the dashboard has it too. Tap it (or press ⏯ on the remote, Space on a laptop, or *Ask LocalHub* in
  the drop-down): it turns red and pulses with your voice, stops by itself 0.7 s after you do,
  Whisper on the laptop writes it down, and it sends. The answer is read aloud as it streams, starting
  with the first phrase rather than waiting for a whole sentence — on a TV with the TV's own voice, on a
  laptop with a local system voice, which starts at once. Settings → *Read answers aloud*: After
  voice, Always or Off.
- **“Open Netflix”, “switch to the PlayStation”, “go home”** never wait for a model: they're done on
  the TV in a fraction of a second.
- **Anything else** goes to LocalHub's agent — the same one as the dashboard chat, so it can look
  things up, use your files and connections, and drive the hub browser. Approval cards show in the
  card on the TV and on the laptop.
- **The agent can drive the TV**: from any LocalHub chat, “put YouTube on the TV” uses its
  `tv_control` tool.
- **Alexa**: “Alexa, ask local hub to open Netflix.” See [alexa/README.md](alexa/README.md).

Fire TV keeps the remote's own mic button for Alexa, and Fire TV Sticks have no other microphone, so on
a Stick ⏯ will say there's no mic: say "Hey LocalHub" to the laptop (below), use Alexa, or type in the bar.

**"Hey LocalHub"**: the laptop's microphone listens for the phrase, so you can talk to the TV with your
hands free: "Hey LocalHub, open Netflix", or "Hey LocalHub", a chime, then the request. Turn it on in the
TV's Settings → Assistant → *Hey LocalHub*. LocalHub comes to the front if another app is on, and the
Assistant shows *Listening…* until you stop talking.

- `tv/listen.py` runs on the laptop while it's on. A small model (Vosk) listens only for the phrase; it's
  cheap enough to run all the time, and nothing is recorded or sent anywhere until it hears it. Then
  Whisper (`base.en`) writes down the request, checks the phrase was really said, and it goes to the TV.
- The laptop has to be in the room, within a few metres. Across a living room or over a loud TV, a USB
  speakerphone plugged into the **laptop** hears far better. To pick a mic other than Windows' default,
  set `"mic"` (its name or number) in `data/tv-listen.json`.
- Set it up once on the laptop:

```sh
pip install sounddevice vosk faster-whisper
# into data/listen/: vosk-model-small-en-us-0.15 (unzipped) from https://alphacephei.com/vosk/models
```

`GET /api/tv/listen` says whether it's on and which mic it's using; `POST /api/tv/listen {"on": true}` turns it on.
Fire TV Omni and Cube have far-field mics, which may work — that's untested.

Whisper setup, once, on the laptop: `pip install faster-whisper`. The models download on first use
(`tiny.en` ~75 MB, `base.en` ~145 MB). How it stays quick:

- Whisper starts loading the moment the mic is pressed (`POST /api/voice/warm`), so it's ready by the
  time you stop talking, and stays loaded for 30 minutes after the last use.
- Clips under 4 seconds — most of what's said to a TV — go to `tiny.en`; longer ones to `base.en`.
- The browser records straight to 16 kHz WAV, so the hub doesn't decode anything; silence is trimmed
  by the recorder, so Whisper skips its own voice detection and timestamps.

Options under `"tv": { "whisper": { … } }` in `config/hub.json`: `model` (default `base.en`),
`fast` (default `tiny.en`, `""` to use one model for everything), `python`, `device` (`cpu` or
`cuda`). Timing depends on how busy the computer is: a 2-second clip took 0.7 s warm on `base.en` on a
quiet laptop, and several seconds when other heavy programs were using every core.

## LocalHub, as an app

The LocalHub tile opens the whole hub on the TV, growing out of its tile like any app, landing on
Home with the **TV** view selected — so Edit there changes what the TV shows, and Back (or the
**‹ TV** button) comes straight back with the change already on the Top Shelf. On a TV the hub page is
built for a pointer, so this is easiest from a laptop window (`npm run tv`).

The other way round: the hub's Home has a **TV** app (next to Chat). On the dashboard it opens
LocalHub TV in its own window; inside LocalHub TV it goes back to the TV. `/?view=tv` opens the
dashboard's Home straight on the TV view.

## What's tested, and what isn't

| Tested here | How |
| --- | --- |
| The page: Top Shelf (LocalHub and app art), the grid scrolling over a blurred wallpaper, the top-right drop-down, Settings, focus moving between the grid, the status pill and the bar | In a browser at `/tv/`, with the keyboard remote, by hand, with screenshots (`tv/screenshots/`) |
| The TV view in the hub's Home editor | Desktop · iPad · Mobile · **TV** toggle on a scratch hub; a TV layout set through `/api/home/layout` showed up on that hub's `/tv/` |
| The hub's own assistant on the TV | `/tv/` against a real LocalHub: typed question, the Hub Assistant card answered "Looking at the TV tab", and the chat was in the hub's history. Asked it to use the browser: it opened example.com in the hub browser, the live card showed it, and it answered "Example Domain" |
| Voice, end to end | On a scratch hub: a spoken clip fed in as the browser's mic → the mic button went red, stopped by itself, Whisper wrote "Open Netflix, please.", and LocalHub TV opened Netflix without the agent |
| LocalHub as an app | The LocalHub tile opened the hub on Home's TV view; removed a widget in Edit, Done, ‹ TV: the Top Shelf already showed the change |
| "open youtube" in the bar | Ran on the TV without the agent: focus moved to YouTube, the icon zoomed, the website was asked for (the test browser blocks pop-ups from automated keys, so the "Press Enter to open YouTube" fallback showed) |
| The look following the hub | Changed the hub's wallpaper to Dusk and accent to orange through `/api/hub/settings`; the TV switched within 30 s, then back |
| The TV app's sign-in | Paired through `/api/pair/start` + `/api/pair/claim`, opened `/tv/` with the key: the hub set its `hub_device` cookie (test device removed) |
| The offline screen | The APK's bundled files served on their own: same Home, bundled Aurora, the pairing pill instead of the bar |
| Laptop → TV commands | `POST /api/tv/command` → the UI opened the app |
| Whisper | A Windows-TTS clip: “Open Netflix, please.” in 0.8 s warm (WAV), 1.3 s (webm) |
| The TV back end and Alexa checks | `node --test test/tv/` (9 tests, offline) |
| The APK | Compiles (Gradle, JDK 17, SDK 34); classes and UI assets checked inside it |
| The APK on Android TV | CI's `emulator` job: an Android TV emulator (API 30, 1080p) installs and starts it, the page is read over WebView DevTools (home screen drawn, grid, sidebar), screenshots aren't blank, no crash or ANR |
| Set up a TV, over a real home network | A scratch hub: passcode, *Turn on* → the TV app's `/pair` probe found it on the LAN address, a code was claimed from the LAN, `/tv/` opened with the TV's key, *Turn off* closed the address |
| One assistant on the laptop and the TV | A question asked in the hub appeared on `/tv/` and the answer streamed into both; the TV asking for a site opened it in the hub's browser |
| Browser and Chromium | Opened from their tiles, typed, clicked, back and leave; YouTube played; 1920×1080 frames at about 25–50 fps (`test/tv/stream.test.mjs` drives a real browser on a real computer; CI runners skip it) |
| The screensaver | A folder of test photos, crossfades and widgets; settings from the hub's TV editor reached the running TV on its next sync |

**Not run yet:** the APK on a real Fire TV (banners, launching, HDMI inputs, the mic, TTS, the Home
button, the streamed apps' speed and large screensaver photos), a real Alexa request, iCloud Photos
detection, and Netflix past its sign-in page. Say what you tested
when you change something here.
