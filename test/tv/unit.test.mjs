// LocalHub TV back end (tv.mjs): the command queue, the TV interface files, and the Alexa checks.
// Runs offline with invented values: no real Alexa, no Whisper, no chat.
//
//   node --test test/tv/
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { create, cleanCommand, quickCommand, verifyAlexa, chainUrlOk, _createAlexa } from '../../tv.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKILL = 'amzn1.ask.skill.invented-0000'

function send(res, status, body, type) {
  const isText = typeof body === 'string' || Buffer.isBuffer(body)
  res.writeHead(status, { 'content-type': type || (isText ? 'text/plain; charset=utf-8' : 'application/json') })
  res.end(isText ? body : JSON.stringify(body))
}

async function withServer(fn) {
  const route = create({ here: REPO })
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (!(await route(url, req, res, { send }))) send(res, 404, { error: 'not found' })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(base, route)
  } finally {
    route.close()
    server.closeAllConnections?.()
    await new Promise(r => server.close(r))
  }
}

test('commands are cleaned and limited to known types', () => {
  assert.deepEqual(cleanCommand({ type: 'launch', app: ' Netflix ' }), { type: 'launch', app: 'Netflix' })
  assert.equal(cleanCommand({ type: 'launch' }), null)
  assert.equal(cleanCommand({ type: 'shell', cmd: 'rm -rf /' }), null)
  assert.deepEqual(cleanCommand({ type: 'home', extra: 1 }), { type: 'home' })
  assert.equal(cleanCommand({ type: 'say', text: 'x'.repeat(5000) }).text.length, 2000)
})

test('quick commands skip the model', () => {
  assert.deepEqual(quickCommand('Open Netflix.'), { type: 'launch', app: 'netflix' })
  assert.deepEqual(quickCommand('Open Netflix, please.'), { type: 'launch', app: 'netflix' })
  assert.deepEqual(quickCommand('Can you put on Plex for me'), { type: 'launch', app: 'plex' })
  assert.deepEqual(quickCommand('put on the YouTube app'), { type: 'launch', app: 'youtube' })
  assert.deepEqual(quickCommand('switch to the playstation'), { type: 'input', name: 'playstation' })
  assert.deepEqual(quickCommand('go home'), { type: 'home' })
  assert.equal(quickCommand('what is the weather like'), null)
})

test('a waiting TV gets a queued command at once', async () => {
  await withServer(async (base) => {
    const start = await (await fetch(`${base}/api/tv/next`)).json()
    assert.equal(typeof start.seq, 'number')
    const waiting = fetch(`${base}/api/tv/next?after=${start.seq}&wait=10`).then(r => r.json())
    await new Promise(r => setTimeout(r, 50))
    const queued = await (await fetch(`${base}/api/tv/command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'launch', app: 'YouTube' }) })).json()
    assert.equal(queued.ok, true)
    assert.equal(queued.tvs, true)
    const got = await waiting
    assert.deepEqual(got.command, { type: 'launch', app: 'YouTube' })
    assert.equal(got.seq, queued.seq)
  })
})

test('an idle poll ends with 204, and bad commands are refused', async () => {
  await withServer(async (base) => {
    const r = await fetch(`${base}/api/tv/next?after=0&wait=1`)
    assert.equal(r.status, 204)
    const bad = await fetch(`${base}/api/tv/command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'nope' }) })
    assert.equal(bad.status, 400)
    const notAudio = await fetch(`${base}/api/tv/transcribe`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' })
    assert.equal(notAudio.status, 415)
  })
})

test('the chat mic has its own voice routes', async () => {
  await withServer(async (base, route) => {
    // Too short to be speech: refused before Whisper is involved.
    const tiny = await fetch(`${base}/api/voice/transcribe`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: new Uint8Array(200) })
    assert.equal(tiny.status, 400)
    const notAudio = await fetch(`${base}/api/voice/transcribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(notAudio.status, 415)
    assert.equal(typeof route.whisper.warm, 'function')
    assert.equal((await fetch(`${base}/api/voice/nope`)).status, 404)
    // The TV's Settings shows the hub's real version.
    const st = await (await fetch(`${base}/api/tv/status`)).json()
    assert.match(st.version, /^\d+\.\d+\.\d+/)
  })
})

test('the TV interface is served from tv/ui and nowhere else', async () => {
  await withServer(async (base) => {
    const page = await fetch(`${base}/tv/`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /<title>LocalHub TV<\/title>/)
    assert.equal((await fetch(`${base}/tv/app.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8')
    assert.equal((await fetch(`${base}/tv/..%2F..%2Fserver.mjs`)).status, 404)
    assert.equal((await fetch(`${base}/tv/whisper.py`)).status, 404)
    // The hub's own icon and wallpapers, not copies.
    const icon = await fetch(`${base}/tv/hub.svg`)
    assert.equal(icon.headers.get('content-type'), 'image/svg+xml')
    assert.match(await icon.text(), /M256 124 398 244/)
    assert.equal((await fetch(`${base}/tv/wallpapers/aurora.svg`)).status, 200)
    assert.equal((await fetch(`${base}/tv/wallpapers/..%2F..%2Fserver.mjs`)).status, 404)
    assert.equal((await fetch(`${base}/tv/wallpapers/..%2Ficons%2Fhub.svg`)).status, 404)
  })
})

test('Alexa certificate URLs must be Amazon\'s', () => {
  assert.equal(chainUrlOk('https://s3.amazonaws.com/echo.api/echo-api-cert.pem'), true)
  assert.equal(chainUrlOk('https://s3.amazonaws.com:443/echo.api/../echo.api/cert.pem'), true)
  assert.equal(chainUrlOk('http://s3.amazonaws.com/echo.api/cert.pem'), false)
  assert.equal(chainUrlOk('https://s3.amazonaws.com/EcHo.aPi/cert.pem'), false)
  assert.equal(chainUrlOk('https://s3.amazonaws.com/invalid.path/cert.pem'), false)
  assert.equal(chainUrlOk('https://s3.amazonaws.com:563/echo.api/cert.pem'), false)
  assert.equal(chainUrlOk('https://evil.example/echo.api/cert.pem'), false)
})

test('Alexa requests need a good signature, the right skill and a fresh timestamp', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const fetchChain = async () => ({ publicKey })
  const now = Date.parse('2026-11-22T12:00:00Z')
  const make = (over = {}) => {
    const body = Buffer.from(JSON.stringify({
      context: { System: { application: { applicationId: over.skill || SKILL } } },
      request: { type: 'LaunchRequest', timestamp: over.ts || '2026-11-22T12:00:30Z' },
    }))
    const sig = crypto.sign('sha256', body, privateKey).toString('base64')
    return { body, headers: { signaturecertchainurl: 'https://s3.amazonaws.com/echo.api/c.pem', 'signature-256': sig } }
  }
  const ok = make()
  assert.equal((await verifyAlexa(ok.headers, ok.body, SKILL, { now, fetchChain })).request.type, 'LaunchRequest')
  await assert.rejects(verifyAlexa({}, ok.body, SKILL, { now, fetchChain }), /unsigned/)
  await assert.rejects(verifyAlexa(ok.headers, Buffer.from(ok.body.toString().replace('Launch', 'Lunch')), SKILL, { now, fetchChain }), /bad signature/)
  const other = make({ skill: 'amzn1.ask.skill.someone-else' })
  await assert.rejects(verifyAlexa(other.headers, other.body, SKILL, { now, fetchChain }), /wrong skill/)
  const old = make({ ts: '2026-11-22T11:50:00Z' })
  await assert.rejects(verifyAlexa(old.headers, old.body, SKILL, { now, fetchChain }), /stale/)
  await assert.rejects(verifyAlexa(ok.headers, ok.body, '', { now, fetchChain }), /wrong skill/)
})

test('Alexa intents reach the TV or the agent', async () => {
  const sent = []
  let tvOn = true
  const alexa = _createAlexa({
    queue: c => (sent.push(cleanCommand(c)), sent.length),
    tvsOnline: () => tvOn,
    ask: async text => ({ text: `You asked: ${text}. **Done.**`, sessionId: 's1' }),
  })
  const intent = (name, slots = {}) => ({ request: { type: 'IntentRequest', intent: { name, slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, { value: v }])) } } })
  const say = r => r.response.outputSpeech.text

  assert.equal(say(await alexa.handle(intent('OpenAppIntent', { app: 'Netflix' }))), 'Opening Netflix.')
  assert.deepEqual(sent.at(-1), { type: 'launch', app: 'Netflix' })

  assert.equal(say(await alexa.handle(intent('AskIntent', { query: 'open youtube' }))), 'Opening youtube.')
  assert.deepEqual(sent.at(-1), { type: 'launch', app: 'youtube' })

  assert.equal(say(await alexa.handle(intent('AskIntent', { query: 'what is on my calendar' }))), 'You asked: what is on my calendar. Done.')

  tvOn = false
  assert.match(say(await alexa.handle(intent('OpenAppIntent', { app: 'Plex' }))), /isn't showing LocalHub/)

  const launch = await alexa.handle({ request: { type: 'LaunchRequest' } })
  assert.equal(launch.response.shouldEndSession, false)
})

test('a slow answer is promised to the TV and delivered there', async () => {
  const sent = []
  let finish
  const alexa = _createAlexa({
    queue: c => (sent.push(cleanCommand(c)), sent.length),
    tvsOnline: () => true,
    ask: () => new Promise(r => { finish = r }),
  })
  const realTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn, ms, ...a) => realTimeout(fn, ms === 6500 ? 5 : ms, ...a)
  try {
    const r = await alexa.handle({ request: { type: 'IntentRequest', intent: { name: 'AskIntent', slots: { query: { value: 'plan my weekend' } } } } })
    assert.match(r.response.outputSpeech.text, /on your TV/)
    finish({ text: 'Saturday: hike. Sunday: rest.', sessionId: 's2' })
    await new Promise(res => realTimeout(res, 10))
    assert.deepEqual(sent.at(-1), { type: 'answer', text: 'Saturday: hike. Sunday: rest.', heard: 'plan my weekend', from: 'alexa', speak: true })
  } finally {
    globalThis.setTimeout = realTimeout
  }
})
