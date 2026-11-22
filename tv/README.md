# LocalHub TV

LocalHub's Home, on your TV. Not a separate app with its own look: the TV shows a page served by
your hub, so it has the hub's wallpaper and style, the hub's widgets, and the hub's own assistant —
the same "Ask anything" bar and Hub Assistant card, with the same conversations as the laptop.
What only a TV can do (your installed apps, launching them, HDMI inputs, the microphone, speech)
comes from the Fire TV app underneath.

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
| `ui/` | The TV page: LocalHub's Home at TV scale — large title, segmented control (Home · Apps · Inputs), the hub's glass app tiles, its Clock, Date and World clock widgets plus Recently opened, a Control Center menu, Settings as a grouped list, screensaver. It loads `/tabs/chat.js` and `/hub-config.js` from the hub. |
| `android/` | The Fire TV / Android TV app, Java 17, no third-party libraries. Opens the hub's `/tv/`; when the hub can't be reached, a bundled copy of `ui/` (with the hub's icon and wallpapers) that can pair and launch apps. |
| `whisper.py` | Speech to text on the laptop (faster-whisper), kept warm by `tv.mjs`. |
| `alexa/` | The Alexa skill: interaction model and setup steps. |
| `../tv.mjs` | The hub side: serves `/tv/` (and the hub's own `icons/hub.svg` and `wallpapers/` under it), the TV command queue, transcription, the Alexa listener. |

### What stays in sync, and how

- **Look:** every 30 seconds the TV reads `/api/hub/settings` and applies the wallpaper, accent,
  widget look (glass / solid / outline), blur, transparency, corner radius, shadow and font the way
  `tabs/custom.js` does on the laptop. Change them in the hub's Style panel; the TV follows. On a TV
  "auto" means dark.
- **Widgets:** the hub's Desktop Home layout decides which of Clock & date, Date and World clock show,
  in that order, with the world clocks from `config/hub.json`.
- **Assistant:** it *is* `tabs/chat.js`. History, new chat, full chat, model picker and approvals are
  the hub's; a conversation started on the TV is in the laptop's history and the other way round.
  Each message says it came from the TV tab, so the agent keeps answers short enough to read aloud.
- **Name and icon:** `HUB_CONF.name` and `icons/hub.svg`.

## See it now

With LocalHub running, open **http://localhost:3100/tv/**. Arrows move, Enter opens, Down from the
apps reaches the hub's "Ask anything" bar (Up on an empty bar comes back), `M` opens Control Center,
`I` talks (the browser's mic), `S` starts the screensaver. In a browser the apps are a demo catalogue
drawn with Simple Icons (CC0) in the hub's tile style; the assistant, wallpaper and widgets are your
hub's.

## Put it on the TV

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
3. **Make Home open LocalHub.** Fire OS hides third-party accessibility services from its menu, so
   turn the Home-button service on over adb. It only watches for Amazon's home screen coming to the
   front; it can't read the screen or key presses:

   ```sh
   adb shell settings put secure enabled_accessibility_services local.hub.tv/local.hub.tv.HomeRedirectService
   adb shell settings put secure accessibility_enabled 1
   ```

   Undo: `adb shell settings put secure enabled_accessibility_services ""`. On Android TV / Google TV,
   pick LocalHub as the home app instead.

## Connect it to LocalHub

The TV reaches LocalHub over your home network, so LocalHub has to listen there — by default it only
answers on the laptop itself.

1. On the laptop, set a passcode (`npm run passcode`) and add the laptop's LAN address to `"listen"`
   in `config/hub.json`, e.g. `"listen": ["192.168.1.20"]`. Restart the hub. (Tailscale works too:
   `"access": "tailnet"`, if the TV runs Tailscale.)
2. On the TV: *Settings → LocalHub → Laptop* searches the network for it (port 3100). If it can't
   find it, *Laptop address* takes `192.168.1.20:3100`.
3. On the laptop open **http://localhost:3100/pair/new**. On the TV: *Pair this TV* → type the code.
   The TV keeps one device key, in Java, never in the web page. *Forget this laptop* removes it.

## Talk to it

- **Type:** Down from the apps lands in the hub's "Ask anything" bar; the Fire TV keyboard opens.
  The answer appears in the Hub Assistant card above it, exactly as on the laptop.
- **Speak: the ⏯ (play/pause) button**, or *Ask LocalHub* in Control Center. A small "Listening" line
  appears above the bar; the TV stops by itself a second after you stop talking, sends the clip to
  Whisper on the laptop, and puts your words into the hub's bar as if typed. The answer is read aloud
  with the TV's own voice, sentence by sentence as it streams (Settings → *Read answers aloud*:
  After voice, Always or Off).
- **“Open Netflix”, “switch to the PlayStation”, “go home”** never wait for a model: they're done on
  the TV in a fraction of a second.
- **Anything else** goes to LocalHub's agent — the same one as the dashboard chat, so it can look
  things up, use your files and connections, and drive the hub browser. Approval cards show in the
  card on the TV and on the laptop.
- **The agent can drive the TV**: from any LocalHub chat, “put YouTube on the TV” uses its
  `tv_control` tool.
- **Alexa**: “Alexa, ask local hub to open Netflix.” See [alexa/README.md](alexa/README.md).

Fire TV keeps the remote's own mic button for Alexa, and Fire TV Sticks have no other microphone, so on
a Stick ⏯ will say there's no mic: use Alexa, or type in the bar.
Fire TV Omni and Cube have far-field mics, which may work — that's untested.

Whisper setup, once, on the laptop: `pip install faster-whisper`. The first transcription downloads
the `base.en` model (~145 MB). Options under `"tv": { "whisper": { … } }` in `config/hub.json`:
`model` (`base.en`, `small.en`, …), `python`, `device` (`cpu` or `cuda`).

## What's tested, and what isn't

| Tested here | How |
| --- | --- |
| The page: Home, apps, widgets, Control Center, Settings, focus moving between the apps and the bar | In a browser at `/tv/`, with the remote's keys, by hand, with screenshots |
| The hub's own assistant on the TV | `/tv/` against a real LocalHub: Down to the bar, typed question, the Hub Assistant card answered "Looking at the TV tab", and the chat was in the hub's history |
| The look following the hub | Changed the hub's wallpaper to Dusk and accent to orange through `/api/hub/settings`; the TV switched within 30 s, then back |
| The TV app's sign-in | Paired through `/api/pair/start` + `/api/pair/claim`, opened `/tv/` with the key: the hub set its `hub_device` cookie (test device removed) |
| The offline screen | The APK's bundled files served on their own: same Home, bundled Aurora, the pairing pill instead of the bar |
| Laptop → TV commands | `POST /api/tv/command` → the UI opened the app |
| Whisper | A Windows-TTS clip: “Open Netflix, please.” in 0.8 s warm (WAV), 1.3 s (webm) |
| The TV back end and Alexa checks | `node --test test/tv/` (9 tests, offline) |
| The APK | Compiles (Gradle, JDK 17, SDK 34); classes and UI assets checked inside it |

**Not run yet:** the APK on a real Fire TV (banners, launching, HDMI inputs, the mic, TTS, the Home
button), a real Alexa request, and pairing a TV against a hub listening on the LAN. Say what you tested
when you change something here.
