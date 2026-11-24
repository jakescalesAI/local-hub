// AI tab back end: it must never read Claude Code's sign-in tokens or call Anthropic with them
// (Anthropic's Claude Code terms: third parties may not collect or intermediate Claude.ai
// credentials). What it shows per account comes from Claude Code's own session logs.
// Run: node --test test/ai
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const H = 36e5

test('no hub source reads Claude sign-in tokens or calls Anthropic with them', () => {
  const files = ['ai.mjs', 'server.mjs', 'connections.mjs', 'chat.mjs', 'tabs/ai.js', 'tabs/home.js']
  for (const f of files) {
    const src = fs.readFileSync(path.join(REPO, f), 'utf8')
    // connections.mjs has its own OAuth for other services (accessToken there is theirs), so the
    // generic words are checked only where Claude's sign-in used to be read.
    const words = ['claudeAiOauth', 'api/oauth/usage', 'oauth-2025', 'claude-code/2', ...(/ai.(mjs|js)$/.test(f) ? ['accessToken', 'refreshToken'] : [])]
    for (const bad of words) assert.ok(!src.includes(bad), `${f} mentions ${bad}`)
  }
  const ai = fs.readFileSync(path.join(REPO, 'ai.mjs'), 'utf8')
  assert.ok(!/api\.anthropic\.com/.test(ai), 'ai.mjs calls api.anthropic.com')
  assert.ok(!/['"]auth['"],\s*['"]status['"]/.test(ai), 'ai.mjs runs `claude auth status` to renew tokens')
  // .credentials.json may only be checked for existence, never opened.
  for (const line of ai.split('\n').filter(l => l.includes('.credentials.json') && !l.trim().startsWith('//')))
    assert.match(line, /fs\.existsSync\(/, `ai.mjs touches .credentials.json other than existsSync: ${line.trim()}`)
})

test('localWindows sums the last 5 hours and 7 days of one account', async () => {
  const { localWindows } = await import('../../ai.mjs')
  const now = Date.parse('2026-11-23T15:20:00Z')
  const hour = ms => new Date(ms).toISOString().slice(0, 13)
  const files = {
    a: { src: 'me', last: '2026-11-23T15:10:00Z', b: {
      [`${hour(now)}|claude-x`]: [10, 5, 100, 1000, 2], // this hour
      [`${hour(now - 4 * H)}|claude-x`]: [1, 1, 0, 0, 1], // oldest hour inside 5 hours
      [`${hour(now - 5 * H)}|claude-x`]: [7, 0, 0, 0, 1], // just outside 5 hours
      [`${hour(now - 6 * 86400e3)}|claude-y`]: [3, 3, 3, 3, 1], // inside 7 days
      [`${hour(now - 8 * 86400e3)}|claude-y`]: [999, 999, 0, 0, 9], // outside 7 days
    } },
    b: { src: 'someone-else', last: '2026-11-23T15:15:00Z', b: { [`${hour(now)}|claude-x`]: [500, 500, 0, 0, 5] } },
    c: { src: 'me', size: 1, offset: 1 }, // an old file with no buckets
  }
  const w = localWindows(files, 'me', now)
  assert.deepEqual(w.fiveHour, { io: 17, cache: 1100, calls: 3 })
  assert.deepEqual(w.sevenDay, { io: 30, cache: 1106, calls: 5 })
  assert.equal(w.lastAt, Date.parse('2026-11-23T15:10:00Z'))
  assert.deepEqual(localWindows({}, 'me', now).sevenDay, { io: 0, cache: 0, calls: 0 })
})

test('the AI routes never open .credentials.json, never call Anthropic, and count tokens from logs', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-ai-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const claude = path.join(home, '.claude')
  fs.mkdirSync(path.join(claude, 'projects', 'p'), { recursive: true })
  fs.writeFileSync(path.join(claude, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'SENTINEL-TOKEN', subscriptionType: 'max' } }))
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'me@example.com', accountUuid: 'u1' } }))
  const ts = new Date(Date.now() - 10 * 60e3).toISOString()
  const line = (id, i, o) => JSON.stringify({ type: 'assistant', timestamp: ts, requestId: `r${id}`, cwd: home, message: { id: `m${id}`, model: 'claude-test-1', usage: { input_tokens: i, output_tokens: o, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } })
  fs.writeFileSync(path.join(claude, 'projects', 'p', 's1.jsonl'), [line(1, 100, 20), line(2, 30, 5)].join('\n') + '\n')

  const opened = []
  const spy = (obj, name) => { const orig = obj[name]; obj[name] = function (p, ...rest) { opened.push(String(p)); return orig.call(this, p, ...rest) }; t.after(() => (obj[name] = orig)) }
  spy(fs, 'readFileSync'); spy(fs, 'openSync'); spy(fs, 'createReadStream'); spy(fsp, 'readFile'); spy(fsp, 'open')
  const calls = []
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), headers: JSON.stringify(opts?.headers || {}) }); return new Response('{}', { status: 401 }) }
  t.after(() => (globalThis.fetch = origFetch))
  const env = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
  process.env.HOME = process.env.USERPROFILE = home
  t.after(() => { for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v) })

  const { create } = await import(`../../ai.mjs?fresh=${Date.now()}`)
  const ran = []
  const route = create({ run: async (cmd, args) => (ran.push([cmd, ...args].join(' ')), { ok: false, stdout: '', stderr: 'offline' }), sshHost: 'nowhere', here: home })
  const get = async p => {
    let out
    await route(new URL(`http://hub${p}`), { method: p.endsWith('refresh') ? 'POST' : 'GET' }, {}, { send: (_res, code, body) => (out = { code, body }) })
    return out
  }
  await get('/api/ai/refresh')
  let acc
  for (let i = 0; i < 60; i++) {
    const r = await get('/api/ai/usage')
    assert.equal(r.code, 200)
    acc = r.body.accounts[0]
    if (acc?.local?.sevenDay?.io) break
    await new Promise(r => setTimeout(r, 250))
  }
  assert.equal(acc.status, 'ok')
  assert.equal(acc.email, 'me@example.com')
  assert.equal(acc.usageUrl, 'https://claude.ai/settings/usage')
  assert.deepEqual(acc.local.fiveHour, { io: 155, cache: 0, calls: 2 })
  assert.deepEqual(acc.local.sevenDay, { io: 155, cache: 0, calls: 2 })
  for (const k of ['usage', 'plan', 'history']) assert.ok(!(k in acc), `account still carries ${k}`)

  const state = await get('/api/ai/state')
  assert.ok(!JSON.stringify(state.body).includes('SENTINEL'), 'a token reached a page response')
  assert.deepEqual(opened.filter(p => /credentials/i.test(p)), [], 'something opened .credentials.json')
  assert.deepEqual(calls.filter(c => /anthropic|claude\.ai/i.test(c.url) || /SENTINEL|Bearer/.test(c.headers)), [], 'something called Anthropic')
  assert.deepEqual(ran.filter(r => /claude/.test(r)), [], 'something ran the claude binary')
})

test('an account with no sign-in shows connect and the login command', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-ai-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const env = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
  process.env.HOME = process.env.USERPROFILE = home
  t.after(() => { for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v) })
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{}', { status: 401 })
  t.after(() => (globalThis.fetch = origFetch))
  const { create } = await import(`../../ai.mjs?fresh=${Date.now()}-2`)
  const route = create({ run: async () => ({ ok: false, stdout: '', stderr: '' }), sshHost: 'nowhere', here: home })
  let out
  await route(new URL('http://hub/api/ai/usage'), { method: 'GET' }, {}, { send: (_r, code, body) => (out = { code, body }) })
  const a = out.body.accounts[0]
  assert.equal(a.status, 'connect')
  assert.equal(a.fix, 'claude auth login')
})
