// Read-only looks at this computer for the assistant, which has no shell: running programs, folder sizes and git.
//   GET /api/system/info                 memory, platform, the programs using the most memory
//   GET /api/system/size?path=           a folder's size and its largest items
//   GET /api/git/<status|log|diff>?repo= &ref= &path= &staged=1 &n=
// Same key-file refusal as the file routes, and only inside the folders the assistant may read.
import { lstat, readdir, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { HERE, hubConfig, scrubSecrets } from './config.mjs'
import { holdsKeys } from './files.mjs'

const IS_WIN = process.platform === 'win32'
const KEY_REFUSAL = 'This folder holds keys, so the hub won’t open it'
const OUTPUT_LIMIT = 200_000
const SIZE_LIMIT = { entries: 200_000, ms: 20_000 }

const fail = (message, code = 400) => Object.assign(new Error(message), { code })
const home = p => String(p || '').replace(/^~(?=$|[\\/])/, os.homedir())
const inside = (p, root) => {
  const r = path.relative(root, p)
  return !r || (!r.startsWith('..') && !path.isAbsolute(r))
}

// The same two checks on the path as asked for and on where it really leads, so a junction can't step around them.
async function allowed(asked) {
  if (!asked) throw fail('Pass a folder.')
  const abs = path.resolve(home(asked))
  if (holdsKeys(abs)) throw fail(KEY_REFUSAL, 403)
  const real = await realpath(abs).catch(() => { throw fail('That folder doesn’t exist.', 404) })
  if (holdsKeys(real)) throw fail(KEY_REFUSAL, 403)
  const roots = await Promise.all([HERE, ...hubConfig().assistant.readFolders.filter(f => typeof f === 'string' && f)].map(f => realpath(path.resolve(home(f))).catch(() => null)))
  if (!roots.some(r => r && inside(real, r))) throw fail('That folder is outside the ones set in assistant.readFolders.', 403)
  return real
}

function clean(text) {
  const t = scrubSecrets(text)
  return t.length > OUTPUT_LIMIT ? `${t.slice(0, OUTPUT_LIMIT)}\n[cut at ${OUTPUT_LIMIT} characters]` : t
}

async function processes(run) {
  const rows = []
  if (IS_WIN) {
    const r = await run('tasklist', ['/fo', 'csv', '/nh'])
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = /^"([^"]*)","(\d+)","[^"]*","[^"]*","([^"]*)"/.exec(line)
      if (m) rows.push({ name: m[1].replace(/\.exe$/i, ''), pid: Number(m[2]), mb: Math.round(Number(m[3].replace(/\D/g, '')) / 1024) })
    }
  } else {
    const r = await run('ps', ['-axo', 'pid=,rss=,comm='])
    for (const line of r.stdout.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)
      if (m) rows.push({ name: path.basename(m[3].trim()), pid: Number(m[1]), mb: Math.round(Number(m[2]) / 1024) })
    }
  }
  return rows.sort((a, b) => b.mb - a.mb)
}

async function info(run) {
  const rows = await processes(run)
  return {
    platform: process.platform, release: os.release(), arch: os.arch(), cores: os.cpus().length, uptimeSeconds: Math.round(os.uptime()),
    memTotalMb: Math.round(os.totalmem() / 2 ** 20), memFreeMb: Math.round(os.freemem() / 2 ** 20),
    processCount: rows.length, topByMemory: rows.slice(0, 40),
  }
}

async function folderSize(asked) {
  const root = await allowed(asked)
  const end = Date.now() + SIZE_LIMIT.ms
  const sum = { bytes: 0, files: 0, folders: 0, refused: 0, capped: false }
  const seen = { n: 0 }
  async function walk(dir) {
    let bytes = 0
    let list
    try { list = await readdir(dir, { withFileTypes: true }) } catch { return 0 }
    for (const d of list) {
      if (++seen.n > SIZE_LIMIT.entries || Date.now() > end) { sum.capped = true; return bytes }
      const p = path.join(dir, d.name)
      if (holdsKeys(p)) { sum.refused++; continue }
      if (d.isSymbolicLink()) continue
      if (d.isDirectory()) { sum.folders++; bytes += await walk(p) }
      else if (d.isFile()) { sum.files++; bytes += (await lstat(p).catch(() => ({ size: 0 }))).size }
    }
    return bytes
  }
  const top = []
  for (const d of await readdir(root, { withFileTypes: true })) {
    const p = path.join(root, d.name)
    if (holdsKeys(p)) { sum.refused++; continue }
    if (d.isSymbolicLink() || sum.capped) continue
    let bytes = 0
    if (d.isDirectory()) { sum.folders++; bytes = await walk(p) }
    else if (d.isFile()) { sum.files++; bytes = (await lstat(p).catch(() => ({ size: 0 }))).size }
    sum.bytes += bytes
    top.push({ name: d.name, folder: d.isDirectory(), bytes })
  }
  return { path: root, ...sum, largest: top.sort((a, b) => b.bytes - a.bytes).slice(0, 20) }
}

// Config inside a repo can make git run a program or look in another folder, and a folder someone unzipped, or one the
// assistant wrote to, could carry it. So only settings known to do neither are accepted, and any other refuses the repo.
const REPO_INERT = /^(core\.(repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks|autocrlf|eol|safecrlf|longpaths|abbrev|quotepath|preloadindex|fscache|checkstat|trustctime|commitgraph|multipackindex|untrackedcache|sparsecheckout|sparsecheckoutcone)|extensions\.(worktreeconfig|objectformat)|remote\.[^\n]*\.(url|pushurl|fetch|tagopt|prune|gh-resolved)|branch\.[^\n]*\.\S+|(user|author|committer|init|pull|push|fetch|gc|pack|rerere|maintenance|color|advice|commit|tag|rebase|lfs)\.\S+)$/i
const GIT = ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=', '-c', 'diff.external=', '-c', 'core.quotePath=false', '-c', 'log.showSignature=false']
const REF = /^(?!-)[\w./~^!@{}+-]{1,120}$/

async function gitRead(run, op, q) {
  const git = (cwd, ...args) => run('git', [...GIT, ...args], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' } })
  const cwd = await allowed(q.get('repo'))
  const found = await git(cwd, 'rev-parse', '--show-toplevel', '--absolute-git-dir')
  if (!found.ok) throw fail('That folder isn’t a git repository.', 404)
  const [root, gitDir] = found.stdout.split(/\r?\n/).map(l => l.trim())
  if (holdsKeys(root) || holdsKeys(path.dirname(gitDir))) throw fail(KEY_REFUSAL, 403)
  const keyFile = f => holdsKeys(path.join(root, f))
  const scoped = await git(cwd, 'config', '--list', '--show-scope', '--name-only', '--includes')
  if (!scoped.ok) throw fail('Couldn’t read this repo’s config.', 403)
  const risky = scoped.stdout.split(/\r?\n/).map(l => l.split('\t')).filter(([scope, key]) => (scope === 'local' || scope === 'worktree') && !REPO_INERT.test(key || ''))
  if (risky.length) throw fail(`This repo's own config has settings the hub doesn't run git with (${risky.map(r => r[1]).slice(0, 5).join(', ')}).`, 403)

  const ref = q.get('ref') || ''
  if (ref && !REF.test(ref)) throw fail('That isn’t a git ref.')
  const only = q.get('path') || ''
  if (only && (/^-/.test(only) || keyFile(only))) throw fail(KEY_REFUSAL, 403)
  const tail = only ? ['--', only] : []
  const must = r => { if (!r.ok) throw fail(clean(r.stderr).slice(0, 400) || 'git failed.'); return r.stdout }

  if (op === 'status') {
    const out = must(await git(cwd, 'status', '--short', '--branch', '--ignore-submodules=all', ...tail))
    return { repo: root, status: clean(out.split(/\r?\n/).filter(l => l.startsWith('##') || !l.slice(3).split(' -> ').some(f => keyFile(f.replace(/^"|"$/g, '')))).join('\n')) }
  }
  if (op === 'log') {
    const n = Math.max(1, Math.min(200, Number(q.get('n')) || 20))
    return { repo: root, log: clean(must(await git(cwd, 'log', `-n${n}`, '--date=short', '--format=%h %ad %an: %s', ...(ref ? [ref] : []), ...tail))) }
  }
  // A diff is built from a list of files with key files taken out, so one is never in it even if it's tracked.
  const base = ['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', ...(q.get('staged') ? ['--cached'] : []), ...(ref ? [ref] : [])]
  const names = must(await git(cwd, ...base, '--name-only', ...tail)).split(/\r?\n/).filter(Boolean)
  const shown = names.filter(f => !keyFile(f)).slice(0, 300)
  const left = names.length - shown.length
  const diff = shown.length ? must(await git(cwd, ...base, '--', ...shown)) : ''
  return { repo: root, files: shown, filesLeftOut: left, diff: clean(diff) }
}

export function create({ run }) {
  return async function route(url, req, res, { send }) {
    if (req.method !== 'GET') return false
    if (url.pathname === '/api/system/info') return send(res, 200, await info(run)), true
    if (url.pathname === '/api/system/size') return send(res, 200, await folderSize(url.searchParams.get('path'))), true
    const m = /^\/api\/git\/(status|log|diff)$/.exec(url.pathname)
    if (m) return send(res, 200, await gitRead(run, m[1], url.searchParams)), true
    return false
  }
}
