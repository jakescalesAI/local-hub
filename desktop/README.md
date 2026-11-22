# LocalHub desktop app

An Electron app around the Hub in the parent folder: a window, a tray icon and a global hotkey launcher. Windows first;
platform-specific code is kept in `src/platform/` so Mac and Linux can follow.

## Run from source

```bash
npm install
npm start
```

Node 20 or newer. From source, the app starts `../server.mjs` when no Hub is already answering, so that
Hub's `config/` and `data/` land in your checkout, as they do when you run the Hub by hand.

## Install it

Run `LocalHub-Setup.exe` from the [latest release](https://github.com/jakescalesAI/local-hub/releases/latest) or [trylocalhub.com](https://trylocalhub.com). It installs for the current user, with no admin prompt. The
installer is unsigned for now, so Windows SmartScreen warns about it: choose **More info**, then **Run
anyway**.

On first start, with no Hub already running, the app starts the Hub it ships with and the Hub's own
first-run wizard opens in the window. The Hub's data stays in `%APPDATA%\LocalHub\hub`. If you already
run a Hub on the port, the app attaches to it and changes nothing about how that Hub starts or stops.
Uninstalling leaves that data folder in place.

## Build the Windows installer

```bash
npm run dist
```

This writes `dist/LocalHub-Setup.exe` and an unpacked copy in `dist/win-unpacked`.

The Hub in the parent folder is copied into the installer, leaving out everything its `.gitignore`
treats as yours (`config/`, `data/`, `workspace/`, keys, logs and so on) and its start and restart
scripts, since the app starts and stops the Hub itself. Build from a clean checkout anyway. If that
folder has no `server.mjs`, the installer still builds, but it can only attach to a Hub that's already
running.

The app's name is `productName` in `package.json`, and nowhere else.

## How it behaves

**Finding the Hub.** The app checks `/api/ping` on the configured port (3100 by default).

| What it finds | What it does |
| --- | --- |
| A Hub answering | Attaches, and never stops that Hub, including on quit |
| Nothing answering | Starts its built-in Hub on that port, restarts it if it crashes, and stops it and its child processes on quit |
| Another program on the port | Shows a page saying so, starts nothing, and starts its Hub once the port is free |

**A slow Hub is left alone.** A Hub that takes too long to answer stays up, and so does its page. The app
only stops its built-in Hub early when it can see from the port that the Hub isn't listening:

- If another program holds the port, the app stops its Hub at once and starts a new one when the port is free.
- If nothing holds the port, the Hub gets 45 seconds to open it, then 90, then 180. After that the app stops
  trying and says so, and **Try again** starts over.
- If a Hub is listening but has hung for good, the app can't tell it from a busy one and leaves it running.
  Quit the app from the tray to stop it.

Only Windows can check the port for now. On other systems the app never stops its Hub early.

**Quitting has a limit.** Windows and the tray icon go at once. An idle computer takes 2 to 3 seconds to
finish with a built-in Hub and under a second with an attached one. On a computer with every core busy,
`taskkill` alone can take 10 seconds and Electron another 20 to end, so:

- What a page just saved to local storage is written to disk first. That covers local storage only:
  cookies and IndexedDB are left to Chromium's own saving, so the newest of those can be lost if Electron
  has to be ended.
- The app waits up to 15 seconds for its Hub to go, and goes on as soon as it has. It has to stay for
  this, because Windows ends the Hub the moment the app ends, and `taskkill` can't find what the Hub
  started after that.
- A small process outside the app then gives Electron 5 seconds and ends it if it's still there.
- The Hub never outlasts the app. If `taskkill` needs more than the 15 seconds, anything the Hub started
  (a browser, a tunnel) stays behind.

With the app on two cores shared with four busy programs, the app was gone 9 to 15 seconds after Quit in
all 19 quits measured, and most often 9 to 12. The Hub went after 3 to 7 seconds, and Electron used up
its 5 seconds and was ended. These times move with how busy the computer is. The longest case is a Hub
that really needs the whole 15 seconds. Then it's 15 and 5 seconds plus the time the outside process
needs to act, which came to 21 to 23 seconds under the same load.

When the app starts at login it waits 10 seconds before starting its own Hub, in case one started some
other way is about to answer.

**Main window.** It remembers its size and position, and returns to a visible monitor if the saved one
has gone. If the Hub restarts quickly, the page stays as it is. After 10 seconds down, it shows a
"Waiting for your Hub" page, then returns to the same place when the Hub is back. Closing the window
keeps the app in the tray.

**Tray icon.** Open, launcher, settings, start at login (off by default) and quit.

**Launcher.** `Ctrl+Alt+Space` by default, changeable in Settings. It opens a small frameless always-on-top window
on the monitor holding the cursor, and closes on Esc, on losing focus, or on a second press. It loads
`<hub>/launcher`. If that route returns an error or the Hub is down, it shows a simple built-in page
instead. The Hub's page handles Esc itself, so it can clear what you typed before it closes.

**Built-in Hub's data.** An installed app runs its Hub from a copy in the app's data folder, so updates
never touch `config/` or `data/`.

## Security

- `contextIsolation` on, `nodeIntegration` off and the sandbox on in every window, with no `<webview>`.
- Pages from the Hub get no bridge. The main and launcher windows can show either kind of page, so
  `src/preload.cjs` loads in them, but it exposes nothing except on the app's own `file:` pages, and its
  handlers check the sender. A Hub popup window gets no preload at all.
- Only the Hub's own origin loads inside the app, as a page or a frame. Other `http`, `https` and
  `mailto` links open in the default browser, and other schemes are dropped.
- Images, fonts and scripts a Hub page requests from elsewhere aren't blocked: the rule covers
  navigation and frames. Sites embedded in a Hub custom tab are frames, so they don't load in the app.
- The app adds no header and opens no port. The Hub's `x-hub` check and its other protections apply
  exactly as they do in a browser. Only the Hub it started listens on anything, on the Hub's own port.
- Permissions are refused except clipboard writes and fullscreen for the Hub's origin.
- No telemetry and no auto-update.

**If the app crashes.** The built-in Hub stops with it. A browser the Hub started keeps running for about
30 seconds, because it's started so that it can survive a Hub restart. If the app comes back in that time,
the Hub reuses it. If not, a small watcher the Hub starts closes it. A browser reused this way also closes
about 30 seconds after a later quit, not with it.

## For whoever builds the `/launcher` page

- The app handles lost focus, and reloads the route each time the launcher closes.
- Your page gets Esc, so it can clear a box or leave a form first. Handle it, or Esc does nothing there.
- To close the launcher, call `window.close()`. It hides the window and reloads the route.
- Hub pages have no bridge to the app. A link with `target="_blank"` on the Hub's origin, or
  `window.open`, closes the launcher and opens that URL in the main window. Other origins open in the
  default browser.
- If the main window is already on that page and the URL only differs by its hash, the page isn't
  reloaded. The hash is set and `hashchange` fires, even when the same URL comes twice in a row. Anywhere
  else the URL loads normally, so read a hand-over request on load as well as on `hashchange`.
- The launcher and the main window share `localStorage`. Anything written before `window.open` is
  readable when the main page gets the hash. A later restart reloads the same URL with its hash, so clear
  a request once you've read it.
- The window is 640 × 400.

## Tests

```bash
npm test
```

```bash
npm run dist
```

```bash
npm run test:e2e
```

`npm test` runs without Electron. The end-to-end suite drives the real app through Playwright's
Electron driver, mostly against a stub Hub in `tests/fixtures`. `real-server.test.mjs` runs the real Hub
from this repo with no config, in a temp folder, through the first-run wizard. The tests of a Hub started
apart from the app use a copy of the real Hub in a temp folder, on a free port, so the suite never
touches a Hub you have running. To try them on a running Hub, set `LOCAL_HUB_TEST_HUB_PORT` to its port;
they reach it through a proxy that refuses anything but reads. A shim loaded ahead of the app keeps windows
off-screen, stops them taking focus, records external links and login-item calls instead of making
them, and the hotkey is pressed for real on an unusual binding. Tests that need something missing,
such as a build or a second monitor, report as skipped rather than passing.

`quit.test.mjs` quits with four CPU burners sharing two cores with the app, so the rest of the computer stays free, for up to a minute. It presses Quit through the real tray menu item's click handler, not the native menu popup.

To check whether a run touched a Hub you have running, run it under the connection audit, then read the result:

```bash
powershell -ExecutionPolicy Bypass -File tests/tools/net-audit.ps1 -WatchPort 3100 -OutDir audit-output -Command "npm run test:e2e"
```

```bash
node tests/tools/net-audit-report.mjs audit-output
```

It runs the command in a Windows job, so every process the command starts is listed. Each Node connection is logged where it starts, each of Chromium's in its net log, and the system's connection table is read every 10 ms for everything else, with the owner of each row. A built app has no shim, so its main process and the Hub it starts aren't logged: only the table sees them, and a connection shorter than 10 ms could be missed. The report exits 0 when no record shows the port touched, 1 when one does and 2 when a record it depends on is empty.

Not covered by the suite, because it would take over the desktop: the native tray menu popup, real focus changes, how windows look
on real monitors, the real login-item write, the default `Ctrl+Alt+Space` binding, a real Save As dialog
and running the installer.

To press the test hotkey from your own script, import `pressKeys` and `TEST_HOTKEY_KEYS` from
`tests/helpers.mjs`. It's for tests only and the app never uses it. It sends the script to PowerShell on
stdin, which gets around the script policy because that policy only covers script files. The policy
setting itself isn't changed. Node and Electron can't send a system-wide key press by themselves.

`LOCAL_HUB_START_TIMEOUT_MS` shortens the 45-second start wait, so tests don't take minutes.

## Dependencies

The app has no runtime npm dependencies. It's built and tested with these, all compatible with MIT:

| Package | Licence | Used for |
| --- | --- | --- |
| electron | MIT | The app runtime. Chromium and Node ship inside it, with their licences in the installed folder |
| electron-builder | MIT | Building the installer |
| playwright-core | Apache-2.0 | End-to-end tests |

Across the whole lockfile, transitive development packages are under MIT, ISC, BSD-2-Clause,
BSD-3-Clause, Apache-2.0, BlueOak-1.0.0, 0BSD, Python-2.0, WTFPL and CC0-1.0. None of them ship in the
app.

## Licence

MIT, as for the rest of the repository.
