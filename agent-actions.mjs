// What the assistant can change besides writing files: move, copy, rename and trash files, and a short list of hub actions.
//   POST /api/agent/file      { op: move|copy|rename|trash, from, to }
//   POST /api/agent/action    { name, args }
//   GET  /api/agent/log?n=    the last of these, newest first, so it can undo a move and you can see what happened
//   GET  /api/agent/confirm/<id>   what a card is asking
//   POST /api/agent/confirm/<id>   { allow } the card's answer. The hub then does the step itself.
// Trash and the actions that delete or add outside the hub wait for a card. The agent has no way to answer one: it can't
// POST here, and there's no flag it can pass. Nothing it does can change writeFolders, approvals, deny lists or keys.
import { randomBytes } from 'node:crypto'
import { appendFile, copyFile, cp, lstat, mkdir, readdir, readFile, rename } from 'node:fs/promises'
import { constants as FS, realpath as realpathSync } from 'node:fs'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { deniedToAgent } from './chat.mjs'
import { HERE, PORT, hubConfig, scrubSecrets } from './config.mjs'
import { runsCode } from './files.mjs'
import { IS_WIN, TRASH_NAME, moveToTrash } from './platform.mjs'

const KEY_REFUSAL = 'This holds keys, so the hub won’t touch it'
const RUN_REFUSAL = 'Files here can run as code or change how tools behave, so the assistant can’t change them'
const WALK_LIMIT = { entries: 20_000, ms: 10_000, bytes: 10 * 2 ** 30 }
const ASK_MS = 5 * 60_000
const ASK_LIMIT = 20
const LOG_FILE = path.join(HERE, 'data', 'agent-actions.log')
const LOG_LIMIT = 5 * 2 ** 20

const fail = (message, code = 400) => Object.assign(new Error(message), { code })
const realOf = promisify(realpathSync.native) // the native one, because it also expands 8.3 short names
const inside = (p, root) => {
  const r = path.relative(root, p)
  return !r || (!r.startsWith('..') && !path.isAbsolute(r))
}
const exists = p => lstat(p).then(() => true, () => false)

// Spellings Windows treats as another name for a file, and anything that isn't a plain path, never get as far as a check.
function plainPath(asked) {
  const s = String(asked ?? '')
  if (!s.trim()) throw fail('Pass a path.')
  if (/[\0-\x1f]/.test(s)) throw fail('That isn’t a path.')
  if (IS_WIN && /^[\\/]{2}/.test(s)) throw fail('Network paths aren’t allowed.', 403)
  const abs = path.resolve(HERE, s.replace(/^~(?=$|[\\/])/, os.homedir()))
  if (IS_WIN) {
    const parts = abs.slice(path.parse(abs).root.length).split(path.sep).filter(Boolean)
    if (parts.some(x => /[<>:"|?*]/.test(x) || /[. ]$/.test(x))) throw fail('That name isn’t allowed.')
  }
  return abs
}
function refuse(p) {
  if (deniedToAgent(p)) throw fail(KEY_REFUSAL, 403)
  if (runsCode(p)) throw fail(RUN_REFUSAL, 403)
}

const readRoots = async () => realRoots([HERE, ...hubConfig().assistant.readFolders])
async function realRoots(list) {
  const real = await Promise.all(list.filter(f => typeof f === 'string' && f).map(f => realOf(path.resolve(String(f).replace(/^~(?=$|[\\/])/, os.homedir()))).catch(() => null)))
  return real.filter(Boolean)
}
// workspace/ and writeFolders, the same places Write may go. A folder that holds the hub, or sits in it, doesn't count.
async function writeRoots() {
  const ws = path.join(HERE, 'workspace')
  await mkdir(ws, { recursive: true })
  const hub = await realOf(HERE)
  const more = (await realRoots(hubConfig().assistant.writeFolders)).filter(f => !inside(f, hub) && !inside(hub, f))
  return [await realOf(ws), ...more]
}

// A folder counts as what's in it, at any depth. A link inside could lead anywhere, so one refuses the folder too.
async function checkFolder(dir) {
  const end = Date.now() + WALK_LIMIT.ms
  const sum = { files: 0, bytes: 0 }
  let seen = 0
  const walk = async d => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (++seen > WALK_LIMIT.entries || Date.now() > end) throw fail('That folder is too big to check, so the hub won’t touch it.', 409)
      const p = path.join(d, e.name)
      refuse(p)
      if (e.isSymbolicLink()) throw fail(`“${path.relative(dir, p)}” is a link, so the hub won’t touch this folder.`, 403)
      if (e.isDirectory()) await walk(p)
      else { sum.files++; sum.bytes += (await lstat(p)).size }
    }
  }
  await walk(dir)
  return sum
}

async function source(asked, roots, { removes = false } = {}) {
  const abs = plainPath(asked)
  refuse(abs)
  const st = await lstat(abs).catch(() => { throw fail('That doesn’t exist.', 404) })
  if (st.isSymbolicLink()) throw fail('That’s a link, so the hub won’t touch it.', 403)
  const real = await realOf(abs)
  refuse(real)
  if (!roots.some(r => inside(real, r))) throw fail('That’s outside the folders the assistant can change.', 403)
  if (removes && roots.includes(real)) throw fail('That’s one of the assistant’s own folders, so it stays where it is.', 403)
  const sum = st.isDirectory() ? await checkFolder(real) : { files: 1, bytes: st.size }
  return { abs, real, folder: st.isDirectory(), ...sum }
}
// The real place it would land: the deepest folder that exists, followed through any link, plus the rest of the path.
async function destination(asked, roots) {
  const abs = plainPath(asked)
  refuse(abs)
  if (await exists(abs)) throw fail('Something already has that name. Nothing was changed.', 409)
  let base = path.dirname(abs)
  while (!await exists(base)) {
    if (base === path.dirname(base)) throw fail('That doesn’t exist.', 404)
    base = path.dirname(base)
  }
  const real = path.join(await realOf(base), path.relative(base, abs))
  refuse(real)
  if (!roots.some(r => inside(real, r))) throw fail('The assistant can only put things in workspace/ and the folders in assistant.writeFolders.', 403)
  return real
}

async function log(line) {
  try {
    await mkdir(path.dirname(LOG_FILE), { recursive: true })
    const size = await lstat(LOG_FILE).then(s => s.size, () => 0)
    if (size > LOG_LIMIT) await rename(LOG_FILE, `${LOG_FILE}.1`)
    await appendFile(LOG_FILE, `${scrubSecrets(JSON.stringify({ at: new Date().toISOString(), ...line }))}\n`)
  } catch {}
}

async function move(from, to) {
  const roots = await writeRoots()
  const src = await source(from, roots, { removes: true })
  const dst = await destination(to, roots)
  if (src.folder && inside(dst, src.real)) throw fail('A folder can’t go inside itself.', 409)
  await mkdir(path.dirname(dst), { recursive: true })
  await rename(src.real, dst).catch(e => {
    if (e.code === 'EXDEV') throw fail('Those are on different drives, so it can’t be moved. Copy it instead.', 409)
    throw e
  })
  return { from: src.real, to: dst }
}
async function copy(from, to) {
  const src = await source(from, await readRoots())
  const dst = await destination(to, await writeRoots())
  if (src.folder && inside(dst, src.real)) throw fail('A folder can’t go inside itself.', 409)
  if (src.bytes > WALK_LIMIT.bytes) throw fail('That’s over 10 GB, so the assistant won’t copy it.', 409)
  await mkdir(path.dirname(dst), { recursive: true })
  if (src.folder) await cp(src.real, dst, { recursive: true, errorOnExist: true, force: false })
  else await copyFile(src.real, dst, FS.COPYFILE_EXCL)
  return { from: src.real, to: dst }
}
function sameFolder(from, name) {
  const n = String(name ?? '')
  if (!n || /[\\/]/.test(n) || n === '.' || n === '..') throw fail('A new name can’t be a path.')
  return path.join(path.dirname(plainPath(from)), n)
}
// Only the hub's own drive has a bin it can count on, and removable drives have none.
async function trashable(from) {
  const src = await source(from, await writeRoots(), { removes: true })
  const here = await realOf(HERE)
  if (path.parse(src.real).root.toLowerCase() !== path.parse(here).root.toLowerCase() || /^\/(media|mnt|Volumes|run\/media)\//.test(src.real)) throw fail(`That drive has no ${TRASH_NAME}, so the assistant won’t delete there.`, 403)
  return src
}

/* ---------- cards ---------- */

const asks = new Map()
function ask(what, label, step) {
  const now = Date.now()
  for (const [id, a] of asks) if (a.expires < now) asks.delete(id)
  if (asks.size >= ASK_LIMIT) throw fail('Too many cards are waiting. Answer those first.', 409)
  const id = randomBytes(16).toString('hex')
  asks.set(id, { what, label, step, expires: now + ASK_MS })
  return { id, what, error: `This needs a yes: a card is on screen asking “${what}”. Stop and wait. If they allow it, the hub does it itself, so don't try again. A typed yes doesn't count.` }
}

/* ---------- hub actions ---------- */

async function hub(pathname, body) {
  const r = await fetch(`http://127.0.0.1:${PORT}${pathname}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(90e3),
  })
  const out = await r.json().catch(() => ({}))
  if (!r.ok) throw fail(out.error || `The hub answered ${r.status}`, [400, 403, 404, 409].includes(r.status) ? r.status : 502)
  return out
}
const refreshed = (pathname, says) => ({ run: async () => { await hub(pathname); return { ok: true, message: says } } })
const EVENT_ID = /^l[0-9a-f]{12}$/
const eventFields = a => Object.fromEntries(['title', 'allDay', 'start', 'end', 'location', 'notes'].filter(k => k in a).map(k => [k, a[k]]))
const eventId = a => {
  if (!EVENT_ID.test(String(a.id ?? ''))) throw fail('id must be a hub calendar event. Feed and Cal.com events are read-only.', 403)
  return a.id
}
// The whole list. Refreshing Cloud and Stripe only reads them again, and nothing here writes to them.
const ACTIONS = {
  refresh: refreshed('/api/refresh', 'Laptop and Server are up to date.'),
  refresh_ai: refreshed('/api/ai/refresh', 'AI usage is up to date.'),
  refresh_cloud: refreshed('/api/cloud/refresh', 'Cloud is up to date.'),
  refresh_stripe: refreshed('/api/stripe/refresh', 'Stripe is up to date.'),
  refresh_calendar: refreshed('/api/calendar/refresh', 'Calendar is up to date.'),
  calendar_add: { run: async a => ({ ok: true, event: (await hub('/api/calendar/events', eventFields(a))).event }) },
  calendar_update: { run: async a => ({ ok: true, event: (await hub(`/api/calendar/events/${eventId(a)}`, eventFields(a))).event }) },
  calendar_delete: {
    card: async a => {
      const id = eventId(a)
      const r = await fetch(`http://127.0.0.1:${PORT}/api/calendar/state`, { signal: AbortSignal.timeout(30e3) })
      const found = ((await r.json().catch(() => ({}))).events || []).find(e => e.id === id)
      return { what: 'Delete this calendar event?', label: found?.title || id }
    },
    run: async a => { await hub(`/api/calendar/events/${eventId(a)}/delete`); return { ok: true, message: 'The event is deleted.' } },
  },
  // This one adds to a calendar outside the hub, so it's shown first with what it will add.
  calendar_quick: {
    card: async a => {
      const text = String(a.text ?? '').trim()
      if (!text) throw fail('Pass text.')
      const checked = await hub('/api/calendar/quick', { text, check: true })
      return { what: 'Add this to your calendar?', label: String(checked.message || text).slice(0, 300) }
    },
    run: async a => ({ ok: true, message: (await hub('/api/calendar/quick', { text: String(a.text ?? '').trim() })).message || 'It’s added.' }),
  },
}

export function create({ run }) {
  async function fileOp({ op, from, to } = {}) {
    if (op === 'move') return move(from, to)
    if (op === 'rename') return move(from, sameFolder(from, to))
    if (op === 'copy') return copy(from, to)
    if (op !== 'trash') throw fail('op must be move, copy, rename or trash.')
    const src = await trashable(from)
    const sized = src.folder ? `Folder, ${src.files} file${src.files === 1 ? '' : 's'}` : ''
    return ({
      ask: ask(`Move this to ${TRASH_NAME}?`, [src.real, sized].filter(Boolean).join(' · '), async () => {
        const now = await trashable(from)
        const error = await moveToTrash(run, [now.real])
        if (error) throw fail(error, 500)
        await log({ op: 'trash', from: now.real, ok: true })
        return { ok: true, message: `It’s in ${TRASH_NAME}, where you can restore it.` }
      }),
    })
  }
  async function hubAction({ name, args } = {}) {
    const a = typeof name === 'string' && Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : null
    if (!a) throw fail(`There's no action called ${String(name).slice(0, 40)}. These exist: ${Object.keys(ACTIONS).join(', ')}.`, 403)
    const given = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
    if (!a.card) return a.run(given)
    const c = await a.card(given)
    return ({
      ask: ask(c.what, c.label, async () => {
        const out = await a.run(given)
        await log({ op: `action ${name}`, ok: true, id: given.id })
        return out
      }),
    })
  }
  const asked = (res, send, out) => send(res, 428, { error: out.ask.error, needsConfirmation: true, id: out.ask.id, what: out.ask.what })

  return async function route(url, req, res, { send, readBody }) {
    const p = url.pathname
    if (!p.startsWith('/api/agent/')) return false
    if (p === '/api/agent/log' && req.method === 'GET') {
      const n = Math.max(1, Math.min(500, Number(url.searchParams.get('n')) || 50))
      const lines = (await readFile(LOG_FILE, 'utf8').catch(() => '')).split('\n').filter(Boolean).slice(-n).reverse()
      return send(res, 200, { entries: lines.flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } }) }), true
    }
    if ((p === '/api/agent/file' || p === '/api/agent/action') && req.method === 'POST') {
      const body = await readBody(req)
      const isFile = p === '/api/agent/file'
      const line = isFile ? { op: String(body?.op), from: String(body?.from ?? ''), to: String(body?.to ?? '') } : { op: `action ${String(body?.name)}` }
      try {
        const out = isFile ? await fileOp(body || {}) : await hubAction(body || {})
        if (out?.ask) {
          await log({ ...line, ok: false, note: 'waiting for a card' })
          return asked(res, send, out), true
        }
        await log({ ...line, ...(isFile ? out : {}), ok: true })
        return send(res, 200, isFile ? { ok: true, ...out } : out), true
      } catch (e) {
        await log({ ...line, ok: false, note: e.message })
        throw e
      }
    }
    const m = /^\/api\/agent\/confirm\/([0-9a-f]{32})$/.exec(p)
    if (m) {
      const a = asks.get(m[1])
      if (!a || a.expires < Date.now()) return send(res, 404, { error: 'That ask has run out.' }), true
      if (req.method === 'GET') return send(res, 200, { what: a.what, label: a.label }), true
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true
      const { allow } = await readBody(req)
      asks.delete(m[1]) // one answer, so a yes can't be used twice
      if (allow !== true) {
        await log({ op: 'card', what: a.what, label: a.label, ok: false, note: 'not allowed' })
        return send(res, 200, { ok: true, allowed: false }), true
      }
      try {
        return send(res, 200, { allowed: true, ...await a.step() }), true
      } catch (e) {
        await log({ op: 'card', what: a.what, label: a.label, ok: false, note: e.message })
        return send(res, 200, { ok: false, allowed: true, message: scrubSecrets(e.message) }), true
      }
    }
    return false
  }
}
