import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { cleanCode, isCode, normalizeAddress, parsePairLink, showCode } from '../src/lib/address.js'
import { classify, STATES } from '../src/lib/status.js'
import { MAX_HUB_NAME, createClient } from '../src/lib/client.js'
import { createConnectionStore } from '../src/lib/store.js'
import { createQueue, MAX_QUEUE } from '../src/lib/queue.js'

test('addresses: release builds take HTTPS only', () => {
  assert.deepEqual(normalizeAddress('hub.example.test'), { ok: true, url: 'https://hub.example.test' })
  assert.deepEqual(normalizeAddress('  https://hub.example.test/some/path?x=1 '), { ok: true, url: 'https://hub.example.test' })
  assert.deepEqual(normalizeAddress('https://hub.example.test:8443'), { ok: true, url: 'https://hub.example.test:8443' })
  for (const bad of ['http://hub.example.test', 'http://192.0.2.1:3100', 'http://localhost:3100', 'http://10.0.2.2:3100', 'ftp://x.test', 'javascript://x', 'file:///etc/passwd', '', '   ', null, 'https://user:pw@hub.example.test', 'https://']) {
    assert.equal(normalizeAddress(bad).ok, false, String(bad))
  }
})

test('addresses: debug builds add only this machine and the emulator host', () => {
  assert.equal(normalizeAddress('http://localhost:3100', { dev: true }).url, 'http://localhost:3100')
  assert.equal(normalizeAddress('http://10.0.2.2:3100', { dev: true }).url, 'http://10.0.2.2:3100')
  assert.equal(normalizeAddress('http://192.0.2.1:3100', { dev: true }).ok, false)
  assert.equal(normalizeAddress('http://hub.example.test', { dev: true }).ok, false)
})

test('codes', () => {
  assert.equal(cleanCode(' ab12-cd 34 '), 'AB12CD34')
  assert.equal(isCode('AB12CD34'), true)
  assert.equal(isCode('AB12'), false)
  assert.equal(showCode('AB12CD34'), 'AB12 CD34')
})

test('pairing links', () => {
  const link = 'localhub://pair?u=https%3A%2F%2Fhub.example.test&c=AB12CD34'
  assert.deepEqual(parsePairLink(link), { address: 'https://hub.example.test', code: 'AB12CD34' })
  for (const bad of [
    'https://hub.example.test',
    'localhub://other?u=https%3A%2F%2Fhub.example.test&c=AB12CD34',
    'localhub://pair?u=http%3A%2F%2Fhub.example.test&c=AB12CD34',
    'localhub://pair?u=https%3A%2F%2Fhub.example.test',
    'localhub://pair?u=https%3A%2F%2Fhub.example.test&c=short',
    'localhub://pair?c=AB12CD34',
    'not a link',
    '',
    null,
  ]) {
    assert.equal(parsePairLink(bad), null, String(bad))
  }
})

test('states: each answer maps to the state the plan promises', () => {
  assert.equal(classify({ online: true, status: 200 }), 'ok')
  assert.equal(classify({ online: true, status: 401 }), 'removed')
  assert.equal(classify({ online: true, status: 404 }), 'outdated')
  for (const s of [502, 503, 504]) assert.equal(classify({ online: true, status: s }), 'stopped')
  assert.equal(classify({ online: true, status: 500 }), 'unexpected')
  assert.equal(classify({ online: true, status: null }), 'asleep')
  assert.equal(classify({ online: false, status: null }), 'offline')
  assert.ok(!/is asleep|is off/i.test(STATES.asleep.body), 'never claims to know which')
})

const fakeHttp = reply => {
  const calls = []
  return { calls, request: async opts => (calls.push(opts), reply(opts)) }
}

test('client: the token goes only in the header, and every call carries x-hub', async () => {
  const http = fakeHttp(() => ({ status: 200, data: '{"hub":{"id":"1","name":"H"}}' }))
  const c = createClient({ http })
  assert.equal((await c.check('https://h.test', 'SECRET')).status, 200)
  const call = http.calls[0]
  assert.equal(call.url, 'https://h.test/api/pair/me')
  assert.equal(call.headers.Authorization, 'Bearer SECRET')
  assert.equal(call.headers['x-hub'], '1')
  assert.ok(!call.url.includes('SECRET'))
})

test('client: check says nothing answered when the network fails, and rejects a non-Hub 200', async () => {
  assert.deepEqual(await createClient({ http: fakeHttp(() => { throw new Error('timeout') }) }).check('https://h.test', 't'), { status: null })
  assert.equal((await createClient({ http: fakeHttp(() => ({ status: 200, data: '<html>a router page</html>' })) }).check('https://h.test', 't')).status, 500)
})

test('client: claim outcomes', async () => {
  const opts = { name: 'n', platform: 'ios' }
  const ok = await createClient({ http: fakeHttp(() => ({ status: 200, data: '{"token":"T","deviceId":"D","hub":{"id":"1","name":"H"}}' })) }).claim('https://h.test', 'AB12CD34', opts)
  assert.equal(ok.ok, true)
  assert.equal(ok.token, 'T')
  const wrong = await createClient({ http: fakeHttp(() => ({ status: 403, data: '{"error":"That code is not right."}' })) }).claim('https://h.test', 'X', opts)
  assert.deepEqual(wrong, { ok: false, error: 'That code is not right.' })
  assert.match((await createClient({ http: fakeHttp(() => ({ status: 404, data: 'nope' })) }).claim('https://h.test', 'X', opts)).error, /updating/)
  assert.match((await createClient({ http: fakeHttp(() => ({ status: 401, data: '{"error":"This hub needs its passcode"}' })) }).claim('https://h.test', 'X', opts)).error, /updating/)
  assert.match((await createClient({ http: fakeHttp(() => { throw new Error('x') }) }).claim('https://h.test', 'X', opts)).error, /Couldn't reach/)
  assert.equal((await createClient({ http: fakeHttp(() => ({ status: 200, data: '<html>' })) }).claim('https://h.test', 'X', opts)).ok, false)
})

test('client: send asks the Hub to carry on after the phone goes away', async () => {
  const http = fakeHttp(() => ({ status: 200, data: '{"type":"session"}\n' }))
  assert.equal((await createClient({ http }).send('https://h.test', 't', 'hello')).result, 'sent')
  assert.deepEqual(http.calls[0].data, { text: 'hello', detached: true })
  assert.equal((await createClient({ http: fakeHttp(() => { throw new Error('dropped') }) }).send('https://h.test', 't', 'x')).result, 'unsure')
  assert.equal((await createClient({ http: fakeHttp(() => ({ status: 503, data: '' })) }).send('https://h.test', 't', 'x')).result, 'retry')
  assert.equal((await createClient({ http: fakeHttp(() => ({ status: 401, data: '' })) }).send('https://h.test', 't', 'x')).result, 'retry')
  assert.equal((await createClient({ http: fakeHttp(() => ({ status: 400, data: '{"error":"Too long"}' })) }).send('https://h.test', 't', 'x')).error, 'Too long')
})

test('client: a reply only counts as a Hub if it names itself', async () => {
  const opts = { name: 'n', platform: 'ios' }
  const reply = data => createClient({ http: fakeHttp(() => ({ status: 200, data: JSON.stringify(data) })) })
  for (const hub of [undefined, null, 'x', 7, [], {}, { name: '' }, { name: '   ' }, { name: 7 }, { name: { a: 1 } }]) {
    assert.equal((await reply({ token: 'T', deviceId: 'D', hub }).claim('https://h.test', 'X', opts)).ok, false, JSON.stringify(hub))
    assert.deepEqual(await reply({ hub }).check('https://h.test', 't'), { status: 500 }, JSON.stringify(hub))
  }
  for (const bad of [{ token: '', deviceId: 'D' }, { token: 7, deviceId: 'D' }, { deviceId: 'D' }, { token: 'T', deviceId: 7 }, { token: 'T' }]) {
    assert.equal((await reply({ ...bad, hub: { name: 'H' } }).claim('https://h.test', 'X', opts)).ok, false, JSON.stringify(bad))
  }
  assert.equal((await reply({ token: 'T', deviceId: 'D', hub: { id: 7, name: 'H' } }).claim('https://h.test', 'X', opts)).hub.id, undefined)
})

test('client: a long or untidy Hub name is cut to what the screens can hold', async () => {
  const reply = name => createClient({ http: fakeHttp(() => ({ status: 200, data: JSON.stringify({ token: 'T', deviceId: 'D', hub: { id: '1', name } }) })) })
  const nameOf = async name => [(await reply(name).check('https://h.test', 't')).hub.name, (await reply(name).claim('https://h.test', 'X', { name: 'n', platform: 'ios' })).hub.name]
  assert.deepEqual(await nameOf('  My \n\t Hub  '), ['My Hub', 'My Hub'])
  for (const name of await nameOf('x'.repeat(5000))) assert.equal(name.length, MAX_HUB_NAME)
  for (const name of await nameOf('\u{1F48E}'.repeat(5000))) assert.deepEqual([...name], Array(MAX_HUB_NAME).fill('\u{1F48E}'))
})

test('client: a Hub refusing the name says what to change, and a wrong code still says wrong code', async () => {
  const opts = { name: 'n', platform: 'ios' }
  const refused = createClient({ http: fakeHttp(() => ({ status: 403, data: 'This hub doesn\u2019t answer to that name.' })) })
  assert.match((await refused.claim('https://h.test', 'X', opts)).error, /"hosts" in config\/hub\.json/)
  assert.equal((await refused.check('https://h.test', 't')).status, 403)
  assert.equal(classify({ status: 403 }), 'unknownName')
  assert.match(STATES.unknownName.body, /"url"/)
  const wrong = createClient({ http: fakeHttp(() => ({ status: 403, data: '{"error":"That code is not right."}' })) })
  assert.equal((await wrong.claim('https://h.test', 'X', opts)).error, 'That code is not right.')
})

test('client: a server error that isn\'t text never reaches the screen as text', async () => {
  const opts = { name: 'n', platform: 'ios' }
  const answer = (status, error) => createClient({ http: fakeHttp(() => ({ status, data: JSON.stringify({ error }) })) })
  for (const error of [{ a: 1 }, ['x'], 7, true, null, '', '   ']) {
    assert.match((await answer(403, error).claim('https://h.test', 'X', opts)).error, /^That code didn't work/, JSON.stringify(error))
    assert.match((await answer(400, error).send('https://h.test', 't', 'x')).error, /^Your Hub didn't accept/, JSON.stringify(error))
  }
  assert.ok((await answer(403, 'e'.repeat(5000)).claim('https://h.test', 'X', opts)).error.length <= 300)
})

test('client: a Hub name loses what can\'t be seen, and needs something that can', async () => {
  const opts = { name: 'n', platform: 'ios' }
  const reply = name => createClient({ http: fakeHttp(() => ({ status: 200, data: JSON.stringify({ token: 'T', deviceId: 'D', hub: { id: '1', name } }) })) })
  for (const name of ['\u200b\u200b\u200b', '\u2066\u202e', '\u0000\u0007', '\u0301', '\ufe0f', '\u3164', '\u2800', '\u00ad', ' \u200b ']) {
    assert.deepEqual(await reply(name).check('https://h.test', 't'), { status: 500 }, JSON.stringify(name))
    assert.equal((await reply(name).claim('https://h.test', 'X', opts)).ok, false, JSON.stringify(name))
  }
  const cases = {
    'Safe\u202eBank': 'SafeBank',
    'a\u0000b\u001bc\u007f': 'abc',
    'Ha\u200bllo': 'Hallo',
    'My\nHub': 'My Hub',
    'Caf\u00e9 Cafe\u0301': 'Caf\u00e9 Cafe\u0301',
    '\u{1F48E} Hub': '\u{1F48E} Hub',
    'hub.example.test': 'hub.example.test',
  }
  for (const [name, shown] of Object.entries(cases)) assert.equal((await reply(name).check('https://h.test', 't')).hub.name, shown)
})

test('client: a server error loses the same characters', async () => {
  const http = fakeHttp(() => ({ status: 400, data: '{"error":"Too\\u202e long\\u0007"}' }))
  assert.equal((await createClient({ http }).send('https://h.test', 't', 'x')).error, 'Too long')
})

const fakeStores = () => {
  const secure = { value: null, set: async v => { secure.value = v }, get: async () => secure.value, remove: async () => { secure.value = null } }
  const entries = new Map()
  const prefs = {
    entries,
    set: async ({ key, value }) => { entries.set(key, value) },
    get: async ({ key }) => ({ value: entries.has(key) ? entries.get(key) : null }),
    remove: async ({ key }) => { entries.delete(key) },
  }
  return { secure, prefs }
}

test('the token goes to secure storage and nowhere else', async () => {
  const { secure, prefs } = fakeStores()
  const store = createConnectionStore({ secure, prefs })
  const conn = { address: 'https://h.test', hubName: 'H' }
  await store.save(conn, 'THE-TOKEN')
  assert.equal(secure.value, 'THE-TOKEN')
  assert.ok(prefs.entries.size > 0, 'the connection details are saved')
  for (const [key, value] of prefs.entries) assert.ok(!key.includes('THE-TOKEN') && !value.includes('THE-TOKEN'), key)
  await store.saveInfo({ ...conn, lastSeen: 1 })
  for (const value of prefs.entries.values()) assert.ok(!value.includes('THE-TOKEN'))
  assert.deepEqual(await store.load(), { conn: { ...conn, lastSeen: 1 }, token: 'THE-TOKEN' })
  await store.clear()
  assert.equal(secure.value, null)
  assert.equal(prefs.entries.size, 0)
})

test('load reads the token only from secure storage: restored details alone mean pair again', async () => {
  const { secure, prefs } = fakeStores()
  const store = createConnectionStore({ secure, prefs })
  await store.save({ address: 'https://h.test' }, 'THE-TOKEN')
  secure.value = null
  assert.equal(await store.load(), null)
})

test('load lets a storage failure through, so it isn\'t mistaken for not being paired', async () => {
  const { secure, prefs } = fakeStores()
  const store = createConnectionStore({ secure, prefs })
  await store.save({ address: 'https://h.test' }, 'THE-TOKEN')
  const realGet = secure.get
  secure.get = async () => { throw new Error('keystore') }
  await assert.rejects(store.load(), /keystore/)
  secure.get = realGet
  const realPrefs = prefs.get
  prefs.get = async () => { throw new Error('prefs') }
  await assert.rejects(store.load(), /prefs/)
  prefs.get = realPrefs
  prefs.entries.set('connection', '{not json')
  assert.equal(await store.load(), null, 'damaged details mean pair again')
})

test('the app wires the store to the real secure storage plugin', () => {
  const source = fs.readFileSync(new URL('../src/lib/native.js', import.meta.url), 'utf8')
  const wiring = source.slice(source.indexOf('createConnectionStore({'), source.indexOf('prefs: Preferences'))
  assert.match(wiring, /set: token => SecureStorage\.set\(TOKEN_KEY, token, false, false\)/)
  assert.match(wiring, /get: \(\) => SecureStorage\.get\(TOKEN_KEY, false, false\)/)
  assert.match(wiring, /remove: \(\) => SecureStorage\.remove\(TOKEN_KEY, false\)/)
  assert.ok(!wiring.includes('Preferences'), 'secure storage must not fall back to Preferences')
  for (const line of source.split('\n').filter(l => l.includes('Preferences.'))) assert.ok(!/token/i.test(line), line)
})

const memoryStorage = (start = {}) => {
  const data = new Map(Object.entries(start))
  return { data, get: async k => data.get(k) ?? null, set: async (k, v) => void data.set(k, v) }
}
let nextId = 0
const queueWith = (send, storage = memoryStorage()) => createQueue({ storage, send, id: () => `i${nextId++}`, now: () => 1 })

test('queue: sends in order, and keeps everything from the first failure on', async () => {
  const out = []
  let up = true
  const q = queueWith(async t => (up ? (out.push(t), { result: 'sent' }) : { result: 'retry' }))
  await q.add('one')
  await q.add('two')
  up = false
  assert.equal((await q.flush()).stopped, true)
  assert.equal((await q.list()).length, 2)
  up = true
  assert.equal((await q.flush()).sent, 2)
  assert.deepEqual(out, ['one', 'two'])
  assert.equal((await q.list()).length, 0)
})

test('queue: an unsure send is never repeated until the person says so', async () => {
  let sends = 0
  let result = 'unsure'
  const q = queueWith(async () => (sends++, { result }))
  const { item } = await q.add('maybe delivered')
  assert.equal((await q.flush()).unsure, 1)
  await q.flush()
  await q.flush()
  assert.equal(sends, 1)
  assert.equal((await q.list())[0].unsure, true)
  await q.retry(item.id)
  result = 'sent'
  assert.equal((await q.flush()).sent, 1)
  assert.equal(sends, 2)
})

test('queue: a rejected item stays visible with the reason and does not block the rest', async () => {
  const q = queueWith(async t => (t === 'bad' ? { result: 'rejected', error: 'No' } : { result: 'sent' }))
  await q.add('bad')
  await q.add('good')
  const r = await q.flush()
  assert.deepEqual(r.rejected, ['No'])
  assert.equal(r.sent, 1)
  const left = await q.list()
  assert.equal(left.length, 1)
  assert.equal(left[0].error, 'No')
})

test('queue: resume and network change firing together send once', async () => {
  let sends = 0
  const q = queueWith(async () => (sends++, await new Promise(r => setTimeout(r, 10)), { result: 'sent' }))
  await q.add('once')
  await Promise.all([q.flush(), q.flush(), q.flush()])
  assert.equal(sends, 1)
})

test('queue: survives a restart, a corrupt file, and a full queue', async () => {
  const storage = memoryStorage()
  const first = queueWith(async () => ({ result: 'retry' }), storage)
  await first.add('kept')
  assert.equal((await queueWith(async () => ({ result: 'retry' }), storage).list())[0].text, 'kept')
  assert.deepEqual(await queueWith(async () => ({}), memoryStorage({ 'share-queue': '{not json' })).list(), [])
  assert.deepEqual(await queueWith(async () => ({}), memoryStorage({ 'share-queue': '{"a":1}' })).list(), [])
  const full = queueWith(async () => ({ result: 'retry' }))
  for (let i = 0; i < MAX_QUEUE; i++) assert.equal((await full.add(`m${i}`)).ok, true)
  assert.equal((await full.add('one too many')).ok, false)
  assert.equal((await full.list()).length, MAX_QUEUE)
})
