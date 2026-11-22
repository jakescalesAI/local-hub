# Alexa → LocalHub

“Alexa, ask local hub to open Netflix.” “Alexa, ask local hub what's on my calendar today.”

Fire TV keeps the remote's microphone button for Alexa, so this is how your voice reaches LocalHub
from the remote. Alexa does the listening; LocalHub does the work:

```
Fire TV remote mic ─▶ Alexa (Amazon's cloud) ─▶ your tunnel ─▶ 127.0.0.1:3109/alexa (tv.mjs)
                                                                   │
                         "open Netflix" ──────── TV command ───────┼─▶ LocalHub TV opens Netflix
                         anything else ── LocalHub's agent ────────┘   (files, browser, tools)
```

- **Open / switch / go home** never touch a model: they go straight to the TV, in well under a second.
- **Questions** run through LocalHub's own agent, the same one as the dashboard chat. Alexa waits about
  eight seconds, so a quick answer is spoken by Alexa; a longer one is put on the TV and read aloud there.
- The `/alexa` listener is **separate from the hub**: it binds to `127.0.0.1:3109`, answers `POST /alexa`
  and nothing else, and refuses any request without Amazon's signature, for another skill, or older than
  150 seconds. Point your tunnel at port 3109, **never at 3100** — the hub itself stays off the internet.

## Set it up (about 15 minutes, once)

You need a free Amazon developer account (the same Amazon account your Fire TV uses) and a way to give
port 3109 an `https` address — Cloudflare Tunnel is one free way.

1. **Create the skill.** [developer.amazon.com/alexa/console/ask](https://developer.amazon.com/alexa/console/ask)
   → *Create Skill* → name it **LocalHub** → *Custom* model → *Provision your own* backend →
   *Start from Scratch*.
2. **Paste the model.** *Build* → *Interaction Model* → *JSON Editor* → paste
   [`interaction-model.json`](interaction-model.json) → *Save* → *Build skill*.
3. **Give port 3109 an https address.** Either a quick test tunnel:

   ```sh
   cloudflared tunnel --url http://127.0.0.1:3109
   ```

   (it prints an `https://….trycloudflare.com` address that changes every run), or a named tunnel on your
   own domain, e.g. `alexa.example.com → http://127.0.0.1:3109`, which keeps the same address.
4. **Endpoint.** *Build* → *Endpoint* → *HTTPS* → Default Region: `https://<your address>/alexa`.
   Certificate: *My development endpoint is a sub-domain of a domain that has a wildcard certificate
   from a certificate authority* → *Save*.
5. **Tell LocalHub the skill id.** Copy the Skill ID (starts with `amzn1.ask.skill.`) into
   `config/hub.json`, then restart the hub:

   ```json
   "tv": { "alexa": { "skillId": "amzn1.ask.skill.…", "port": 3109 } }
   ```

   `GET /api/tv/status` shows `"alexa": { "on": true }` when the listener is up.
6. **Turn on testing.** *Test* tab → *Skill testing is enabled in: Development*. Type
   `ask local hub to open netflix` there to try it without a device. Development skills work on every
   Alexa device on your account, including the Fire TV remote — no publishing needed.

## Things to say

| Say | What happens |
| --- | --- |
| “Alexa, ask local hub to open YouTube” | The TV opens YouTube |
| “Alexa, ask local hub to switch to the PlayStation” | The TV switches HDMI input (TVs with inputs only) |
| “Alexa, ask local hub to go home” | Back to the LocalHub home screen |
| “Alexa, ask local hub what's on my calendar today” | LocalHub's agent answers; Alexa says it |
| “Alexa, ask local hub to find a good space documentary” | The agent searches; a long answer appears on the TV |
| “Alexa, open local hub” | Starts a conversation: keep talking without “ask local hub” |

## What's tested

The signature, certificate-URL, skill-id and timestamp checks, and every intent, are covered offline by
`test/tv/unit.test.mjs`. A real Amazon request has **not** been run through it yet — that needs your
developer account. If Alexa says “There was a problem with the requested skill's response”, the hub's
log line starting with `alexa:` says why.
