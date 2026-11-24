// The Fire TV remote's buttons in every app (KeyDaemon in the TV app): started on the TV over the debugging connection this computer
// was allowed when LocalHub was put on it. Fire OS doesn't let an app on the TV do this for itself. Once started it runs
// on the TV by itself; after the TV restarts, the hub starts it again when the TV next talks to it.
//   GET  /api/tv/keys                -> { on, state: off | starting | on | error, why }
//   POST /api/tv/keys { on?, map? }     on/off; map is what each button does, by key name (the TV page sends it)
// adb is config tv.adb, or the adb on this computer's PATH. Nothing is sent to the TV but the one fixed command.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { hubConfig } from './config.mjs'

// A home network's own address, and not this computer.
export const isPrivate = h => /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(String(h || ''))
const KEY_RE = /^[A-Z][A-Z0-9_]{1,30}$/
const JOB_RE = /^(mic|assistant|overlay|home|menu|files|ai|rew|ff|saver|sleep|settings|none|app:[^\u0000-\u001f|]{1,60}(\|[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+)?)$/
export function cleanMap(raw) {
  const out = {}
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}).slice(0, 24)) if (KEY_RE.test(k) && typeof v === 'string' && JOB_RE.test(v)) out[k] = v
  return out
}
const STOP = '{ for p in /proc/[0-9]*; do if [ "$(tr \'\\0\' \' \' < $p/cmdline 2>/dev/null | cut -d\' \' -f1)" = localhub.keys ]; then kill ${p#/proc/}; fi; done; } 2>/dev/null; true'
const RUNNING = '{ for p in /proc/[0-9]*; do if [ "$(tr \'\\0\' \' \' < $p/cmdline 2>/dev/null | cut -d\' \' -f1)" = localhub.keys ]; then echo running; fi; done; } 2>/dev/null; true'
// base64 holds nothing a shell could read as anything else.
export const startCommand = map => `${STOP}; CLASSPATH=$(pm path local.hub.tv | cut -d: -f2) setsid app_process /system/bin --nice-name=localhub.keys local.hub.tv.KeyDaemon ${Buffer.from(JSON.stringify(map)).toString('base64')} >/data/local/tmp/localhub-keys.log 2>&1 </dev/null &`

export function create({ here }) {
  const FILE = path.join(here, 'data', 'tv-keys.json')
  let saved = { on: false, map: {}, host: '' }
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); saved = { on: j.on === true, map: cleanMap(j.map), host: isPrivate(j.host) ? j.host : '' } } catch {}
  let state = saved.on ? 'starting' : 'off', why = '', busy = false, checkedAt = 0
  const save = () => { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(saved)) } catch {} }
  const adb = (args, timeout = 12_000) => new Promise((ok, no) => execFile(hubConfig().tv?.adb || 'adb', args, { windowsHide: true, timeout }, (e, out, err) => (e ? no(Object.assign(new Error(e.code === 'ENOENT' ? 'adb isn’t on this computer. Set tv.adb in config/hub.json to where it is.' : String(err || out || e.message).trim().split('\n').pop()), { e })) : ok(String(out)))))
  const shell = (cmd, t) => adb(['-s', `${saved.host}:5555`, 'shell', cmd], t)
  async function apply() {
    if (busy) { apply.again = true; return }
    busy = true
    try {
      if (!saved.host) throw new Error('The TV hasn’t talked to this hub yet. Open LocalHub on it.')
      await adb(['connect', `${saved.host}:5555`])
      if (saved.on && Object.keys(saved.map).length) {
        state = 'starting'
        await shell(startCommand(saved.map))
        await new Promise(r => setTimeout(r, 2500))
        if (!(await shell(RUNNING)).includes('running')) throw new Error((await shell('tail -n 2 /data/local/tmp/localhub-keys.log')).trim() || 'It didn’t start on the TV.')
        state = 'on'
        why = ''
      } else {
        await shell(STOP)
        state = saved.on ? 'on' : 'off'
        why = saved.on ? 'No button has a job yet.' : ''
      }
      checkedAt = Date.now()
    } catch (e) { state = 'error'; why = e.message.slice(0, 200) }
    busy = false
    if (apply.again) { apply.again = false; apply() }
  }
  // Its address is where it talks from; a restart ended what was running.
  function seen(address) {
    const host = String(address || '').replace(/^::ffff:/, '')
    if (!isPrivate(host)) return
    if (host !== saved.host) { saved.host = host; save() }
    if (!saved.on || busy || Date.now() - checkedAt < (state === 'error' ? 300_000 : 60_000)) return
    checkedAt = Date.now()
    shell(RUNNING).then(out => { if (out.includes('running')) { state = 'on'; why = '' } else apply() }, () => apply())
  }
  async function route(url, req, res, { send, readBody }) {
    // The Fire TV app asking for its next command: that's the TV, and where it is.
    if (url.pathname === '/api/tv/next' && url.searchParams.get('tv') === '1' && !req.headers['x-forwarded-for']) seen(req.socket?.remoteAddress)
    if (url.pathname !== '/api/tv/keys') return false
    if (req.method === 'GET') return send(res, 200, { on: saved.on, state, why }), true
    if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST' }), true
    const b = await readBody(req).catch(() => ({})) || {}
    const was = JSON.stringify([saved.on, saved.map])
    if (typeof b.on === 'boolean') saved.on = b.on
    if (b.map !== undefined) saved.map = cleanMap(b.map)
    if (was !== JSON.stringify([saved.on, saved.map])) { save(); if (saved.on || b.on === false) { state = saved.on ? 'starting' : 'off'; apply() } }
    return send(res, 200, { on: saved.on, state, why }), true
  }
  return route
}
