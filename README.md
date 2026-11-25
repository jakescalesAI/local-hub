# LocalHub

Your own private dashboard and AI agent, running on your own computer. One page for your files, your
services and a chat that can look things up, write, and work in a real browser while you watch.

Nothing leaves your computer unless you connect something. There is no LocalHub account and no LocalHub
server. The chat needs your own Claude account (see below).

## Start

Needs [Node.js](https://nodejs.org) 20 or newer. No other dependencies.

```bash
git clone <this repo> local-hub
cd local-hub
npm start
```

Open http://localhost:3100. The first run asks for a hub name, who can reach it, the assistant's
connection and any optional keys. Your settings and keys stay in `config/` and `data/`, which git
ignores. To use another port, run `HUB_PORT=3200 npm start`, or set `port` in `config/hub.json`.

| | Start in the background | Restart |
|---|---|---|
| Windows | `start-hidden.vbs` | `powershell -NoProfile -ExecutionPolicy Bypass -File restart.ps1` |
| Mac and Linux | `./start.sh` | `./restart.sh` |

Windows and Linux are tested. Mac is written for but has not been run yet, so please report what breaks.

### Start it at login

- **Windows:** put a shortcut to `start-hidden.vbs` in your Startup folder (Win+R, `shell:startup`).
- **Linux:** a user service, `~/.config/systemd/user/local-hub.service`, then
  `systemctl --user enable --now local-hub`:

  ```ini
  [Unit]
  Description=LocalHub

  [Service]
  WorkingDirectory=%h/local-hub
  ExecStart=/usr/bin/env node server.mjs
  Restart=on-failure

  [Install]
  WantedBy=default.target
  ```

- **Mac:** a LaunchAgent, `~/Library/LaunchAgents/local.hub.plist`, then
  `launchctl load ~/Library/LaunchAgents/local.hub.plist`. Use your own paths, and the full path to `node`:

  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <plist version="1.0"><dict>
    <key>Label</key><string>local.hub</string>
    <key>ProgramArguments</key><array><string>/usr/local/bin/node</string><string>server.mjs</string></array>
    <key>WorkingDirectory</key><string>/Users/you/local-hub</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
  </dict></plist>
  ```

## What you get

A new hub starts with **Home**, **Files** and **Chat**. The browser opens as a pop-up when you or the
agent need it, with the chat still at the bottom centre.

These stay off until you set them up, and a tab that's off fetches nothing:

- **This Computer:** running services, health and files
- **Server:** a server you reach over ssh
- **AI:** the tokens Claude Code used per account (plan limits link to claude.ai), other AI providers
- **Cloud:** deploys, servers and clients, read-only
- **Calendar:** a local calendar plus your feeds and bookings
- **Stripe:** balance, revenue and payouts, read-only

**Home** has your apps and favorites: websites, and the programs on this PC (+ on Home adds them). The **Controls** (Ctrl+.)
has the music player, this PC's volume and brightness, the TV's when it's on, and what shows on Home. The music widget
plays whatever is open on the PC; *Settings → Music platforms* adds your own Spotify.

**The entry code** (*Settings → Entry code*) is 4 or 6 digits to get into LocalHub on the TV, on computers and phones, or into
places and TV apps you choose. It keeps people out of those screens. It isn't encryption, and an app opened from Amazon's
own screens doesn't ask. Forgotten: delete `data/lock.json`.

## LocalHub TV

This hub's Home on a Fire TV or Android TV: your wallpaper and style, your widgets, your TV's apps as
hub tiles, and the same assistant bar and conversations as here — typed, spoken with the remote's ⏯
button, or through Alexa ("Alexa, ask local hub to open Netflix"). The TV pairs like a phone does,
speech-to-text runs on this computer with Whisper, and the agent can open apps on the TV from any
chat. Try it at http://localhost:3100/tv/; the app and setup are in [tv/](tv/README.md).

## The agent

The chat is a general agent that knows your hub best. It answers anything, reads your files, searches
the web, writes files to its own `workspace/` folder, moves, copies, renames and trashes files there,
refreshes the hub's numbers, keeps your calendar, changes the hub's look when you ask, and drives a real
Chrome you can watch and take over at any time.

It runs on [Claude Code](https://claude.com/claude-code) by default, using your own login. You can also
give it an API key or any Anthropic-compatible provider, and choose its name, instructions, models and
tools. All of that is `assistant` in `config/hub.json`.

You need your own Claude account (or your own API key) and Claude Code installed. You sign in to Claude
Code yourself, with Anthropic. LocalHub runs the unmodified `claude` command on your computer and never
reads, stores or passes on your Claude sign-in. LocalHub is an independent project. It is not made by,
endorsed by or affiliated with Anthropic. Claude and Claude Code are Anthropic's trademarks.

## Your choices, and what stays fixed

Every choice has a default in `config/hub.json`, so you can change it without touching code. `config.example/`
shows the shape, and [HUB-GUIDE.md](HUB-GUIDE.md) explains each one.

Out of the box the agent asks before it sends, posts, buys, deletes or accepts terms, and it doesn't type
passwords, card numbers or 2FA codes. It leaves the final Post or Share click on social sites to you. Those
rules are yours to change under `assistant.approvals`, and the hub logs a warning when they differ from what ships.

These are in the code and stay as they are:

- Keys never reach the page, the agent, the logs or an export.
- Key files are refused to the file browser and to the agent: `config/`, `data/`, browser cookies, `.env`, `.ssh` and the like.
- Every request that changes something needs the `x-hub: 1` header.
- The agent has no shell, because a shell could read a key file whatever the rules say.
- Cloud and Stripe views only read.
- Nothing is permanently deleted. Deletes go to the trash, and when the agent is the one deleting, a card asks you first. Only the card counts, not a typed yes.
- The agent can only move and delete inside `workspace/` and the folders in `assistant.writeFolders`. It can't overwrite anything, touch a key file or a folder holding one, or put files where they would run as code. Each step is logged in `data/agent-actions.log`.
- It can't change its own limits: `writeFolders`, approvals, deny lists, keys and `laptop.probe` are yours to set.

Two limits to know about:

- Key-file rules go by name and folder, so a hard link or copy of a key file under an ordinary name can be read. The agent can't make one, but a person or another program can.
- The agent reads your files and uses the web. Only the model's own judgement stops a page from steering it into sending file text somewhere, not a tool rule. `"web": false` under `assistant.tools` takes the web away.

## Who can reach it

Only this computer, until you change that.

- `"access": "tailnet"` in `config/hub.json` adds your Tailscale address, for your own devices. Tailscale is optional.
- `"listen": ["192.168.1.20"]` adds other addresses.
- Anything beyond this computer needs a passcode: run `npm run passcode`. Without one, the hub doesn't listen on those addresses.
- A phone pairs instead of typing the passcode. On this computer, open `/pair/new` for a code that works once, for 5 minutes. Put the hub's https address in `"url"` to get a QR code as well. Pairing opens no new address: a phone still has to reach the hub by one you already turned on. The app in `mobile/` has only run in tests so far.

Don't put the hub on the open internet. It can see your files and act in your browser.

## Make it your own

Each of these is a plain file or a config entry. [HUB-GUIDE.md](HUB-GUIDE.md) has the details under "Extending the hub".

- **A tab:** add `tabs/<id>.js`
- **A widget:** call `registerHomeWidget` from a tab file
- **A theme:** add `themes/<id>.json`, or import one in the Style panel
- **An assistant tool:** add any MCP server under `assistant.mcpServers`

## Backups

Git covers the code only. Your settings, keys, chats and calendar are in `config/` and `data/`, so back those up
yourself. Leave out `data/browser`: it holds the browser's signed-in cookies.

## License

MIT
