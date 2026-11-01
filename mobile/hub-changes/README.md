# How phones pair with the Hub

The Hub's passcode gate (`access.mjs`) closes it to every other device. Pairing adds a second way past
that gate, a paired device. It has been part of the Hub since commit `5b731df`, so there is nothing to
apply. This folder holds this description and the tests.

The code is `device-auth.mjs` in the Hub's root, with `vendor/qrcode.mjs`
([qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4, MIT, licence notice at
the top of the file). The Hub stays free of `node_modules`.

Browsers that sign in with the passcode work as they did.

## Set it up

**`config/hub.json`**, one setting: `"url"`, the HTTPS address phones use, such as
`https://hub.example.com`. The Hub answers only to its own names, and this is how it learns that one.
Without it, a phone using that address gets a 403 and can't pair, and the pairing page gives a code but
no QR. To allow another name, add it to `"hosts"`.

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

`GET /pair` and `POST /api/pair/claim` are the only routes pairing opens without a key or the
passcode, and only under a name the Hub knows. Everything else answers as the passcode gate decides, so from outside it's a 401, or the
login page at `/`. POSTs still need the Hub's existing `x-hub: 1` header.

## Behaviour worth checking in review

- **The name comes first.** A `Host` the Hub doesn't know gets a 403 before pairing or the passcode gate
  run, even with a valid key. The app tells the person which setting to change.
- **"This computer" is not just the source address.** Behind `tailscale serve`, everything arrives from
  `127.0.0.1`. A request is local only when the source is loopback, the `Host` is `localhost`,
  `127.0.0.1` or `[::1]`, and no forwarding or `Tailscale-*` header is present. The `Host` check also
  stops a website that rebinds its own name to `127.0.0.1`. The Android emulator also arrives from
  loopback, as `10.0.2.2`, and doesn't count as this computer even with that name in `hosts`.
- **A paired phone skips the passcode, and works on a Hub with no passcode set.** A code can only come
  from this computer or an already paired device, so holding one proves as much as the passcode does.
  Changing the passcode signs browsers out but leaves phones paired. Remove a phone to end its access.
- **A browser signed in with the passcode can't make codes,** so `/pair/new` stays on this computer.
- **With `"passcodeRequired": false`,** the Hub is open as the owner chose, and pairing routes stay
  limited to this computer and paired devices.
- **The claim route reads at most 4 KB,** because it's open to anyone who can reach the Hub.
- **Codes:** 8 characters, 5 minutes, one use, one live at a time. Five wrong guesses burn the code, so
  guessing from many addresses does not help. Codes are held in memory and never logged.
- **The guess limit is per code, not per caller, on purpose.** Behind `tailscale serve` every request
  arrives from this computer, and forwarding headers can't be trusted, so the Hub can't tell callers apart.
  Anyone who can reach the claim route can burn a live code, and the cost is making a new one.
- **Tokens:** 32 random bytes. Only the SHA-256 hash is stored, written by temp file and rename, and
  compared in constant time. `lastSeen` is written at most once a minute.
- **The page never sees the token.** The first load carries `Authorization: Bearer`. The Hub answers with
  an `HttpOnly; SameSite=Strict` cookie, marked `Secure` when the request came over HTTPS.
- **A phone can make codes and remove devices,** including itself. Say if you would rather keep those to
  this computer: it is one check in `route`.

## Not covered

- **`/go/<port>` and tunnels.** These redirect to `http://<tailscale-ip>:<port>`: plain HTTP on other ports,
  outside the gate. The release app refuses plain HTTP, so those links won't load in it. They stay as
  reachable from the Tailscale network as they are today.
- **Real `tailscale serve` has not been run.** The tests stand in for it by sending the headers it should
  send, so what it passes as `Host` is not measured. If that isn't the address in `url`, the Hub refuses
  it. If Serve doesn't send `X-Forwarded-Proto`, the cookie isn't marked `Secure`. It still travels only
  over the tunnel and still isn't readable by scripts.
- **No "Pair a phone" button yet.** The page is at `/pair/new`. A link in Hub Settings belongs to whoever
  owns that tab.

## Tests

```bash
cd mobile/hub-changes
node --test test/device-auth.test.mjs
node test/real-hub.mjs <path-to-hub-checkout> 8f73f9c
```

The first runs the module behind a test server and a stand-in for `tailscale serve`. The second copies the
Hub at that commit to a temp folder, boots its real `server.mjs` on a free port and checks it from
outside, including with the app's own client. A small fake `claude.exe` stands in for the assistant, so no
real chat runs and the running Hub isn't touched. It needs Windows, like the Hub.
