# Hub changes the app needs

The Hub has no login today. These changes add one, for the Hub's owner to apply. **Nothing in the
Hub has been changed by this branch.** They were written against commit `6403274`.

Everything is off until you set `"deviceAuth": true` in `config/hub.json`, so applying them breaks
nothing for browsers already on the Tailscale network.

## Apply

```bash
node mobile/hub-changes/apply.mjs <path-to-hub>
```

It copies two files and adds the lines below. If a line has moved, it refuses and changes nothing.
Restart the Hub afterwards.

## Exactly what changes

**New files in the Hub's root:** `device-auth.mjs` and `vendor/qrcode.mjs`
([qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4, MIT, licence notice at
the top of the file). The Hub stays free of `node_modules`.

**`server.mjs`**, after `import { HERE, PORT, configPath, hubConfig, tabOn, addonOn } from './config.mjs'`:

```js
import { createDeviceAuth } from './device-auth.mjs'
```

after `const filesRoute = createFiles({ run, sshHost: SSH_HOST, here: HERE })`:

```js
const deviceAuth = createDeviceAuth({ here: HERE, enabled: () => hubConfig().deviceAuth === true, hubName: () => hubConfig().name, hubUrl: () => hubConfig().url })
```

in `handle`, before `if (url.pathname === '/' || url.pathname === '/index.html')`:

```js
    if (deviceAuth.gate(url, req, res, { send })) return
    if (await deviceAuth.route(url, req, res, { send, readBody })) return
```

**`chat.mjs`**, after `emit({ type: 'session', sessionId: conv.id, title: conv.title })`:

```js
    if (body.detached) res.end() // the phone goes away after sharing: keep working, the reply lands in the conversation
```

and on the `res.on('close', ...)` line, add the `!body.detached &&` check:

```js
    res.on('close', () => { if (!body.detached && running.get(conv.id) === entry && !entry.finished) { entry.killed = entry.killed || 'disconnect'; killTree(entry.proc) } })
```

**`config/hub.json`**, two settings:

- `"url"`: the HTTPS address phones use, such as `https://hub.example.com`. Without it the
  pairing page still gives a code, but no QR.
- `"deviceAuth": true`: turn this on once your phone is paired.

`data/devices.json` is created on first use. `data/` is already git-ignored.

## Routes

| Route | Who | What |
| --- | --- | --- |
| `GET /pair/new` | This computer only | Page with the QR code and pairing code |
| `POST /api/pair/start` | This computer or a paired device | `{ code, expires, address, link, qrSvg }` |
| `POST /api/pair/claim` | Anyone holding a code | `{ code, name?, platform? }` returns `{ token, deviceId, hub: { id, name } }` |
| `GET /api/pair/me` | Paired device | `{ deviceId, name, hub }`, or 401. Also the app's health check |
| `GET /api/pair/devices` | This computer or a paired device | The list, without hashes |
| `POST /api/pair/devices/<id>/remove` | This computer or a paired device | Ends that device's access at once |
| `GET /pair` | Anyone | Code page, so a browser on the private network can sign in |

While the gate is on, only `/pair`, `/api/pair/claim`, `/api/pair/me`, `/api/ping` and `/icons/*` are
open without a token. Other page loads go to `/pair`, and other API calls get 401. POSTs still need
the Hub's existing `x-hub: 1` header.

## Behaviour worth checking in review

- **"This computer" is not just the source address.** Behind `tailscale serve`, everything arrives from
  `127.0.0.1`. A request is local only when the source is loopback, the `Host` is `localhost`,
  `127.0.0.1` or `[::1]`, and no forwarding or `Tailscale-*` header is present. The `Host` check also
  stops a website that rebinds its own name to `127.0.0.1`.
- **Codes:** 8 characters, 5 minutes, one use, one live at a time. Five wrong guesses burn the code, so
  guessing from many addresses does not help. Codes are held in memory and never logged.
- **Tokens:** 32 random bytes. Only the SHA-256 hash is stored, written by temp file and rename, and
  compared in constant time. `lastSeen` is written at most once a minute.
- **The page never sees the token.** The first load carries `Authorization: Bearer`. The Hub answers with
  an `HttpOnly; SameSite=Strict` cookie, marked `Secure` when the request came over HTTPS.
- **A phone can make codes and remove devices,** including itself. Say if you would rather keep those to
  this computer: it is one check in `route`.

## Not covered

- **`/go/<port>` and tunnels.** These redirect to `http://<tailscale-ip>:<port>`: plain HTTP on other ports,
  outside this gate. The release app refuses plain HTTP, so those links won't load in it. They stay as
  reachable from the Tailscale network as they are today.
- **`X-Forwarded-Proto` from `tailscale serve`** has not been measured. If Serve doesn't send it, the cookie
  isn't marked `Secure`. It still travels only over the tunnel and still isn't readable by scripts.
- **No "Pair a phone" button yet.** The page is at `/pair/new`. A link in Hub Settings belongs to whoever
  owns that tab.

## Tests

```bash
cd mobile/hub-changes
node --test test/device-auth.test.mjs
node test/real-hub.mjs <path-to-hub-checkout> 6403274
```

The first runs the module behind a test server and a stand-in for `tailscale serve`. The second copies the
Hub to a temp folder, applies the changes, boots the real `server.mjs` on port 3199 and checks it from
outside. A small fake `claude.exe` stands in for the assistant, so no real chat runs and the running Hub
isn't touched. It needs Windows, like the Hub.
