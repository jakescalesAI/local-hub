import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanCode, isCode, normalizeAddress, parsePairLink, showCode } from '../src/lib/address.js'
import { classify, STATES } from '../src/lib/status.js'
import { createClient } from '../src/lib/client.js'
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
