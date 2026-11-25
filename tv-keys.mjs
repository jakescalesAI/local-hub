// The Fire TV remote's buttons in every app (KeyDaemon in the TV app): started on the TV over the debugging connection this computer
// was allowed when LocalHub was put on it. Fire OS doesn't let an app on the TV do this for itself. Once started it runs
// on the TV by itself; after the TV restarts, the hub starts it again when the TV next talks to it.
//   GET  /api/tv/keys                -> { on, state: off | starting | on | error, why }
//   GET  /api/tv/power               -> { known, on, hub } is the TV awake, and is LocalHub what's on it (asked of the TV itself)
//   POST /api/tv/power { on }          true wakes it on LocalHub, false puts it to sleep, 'firetv' leaves LocalHub for Fire TV's Home,
//                                      'toggle' is LocalHub on or off
//   POST /api/tv/keys { on?, map? }     on/off; map is what each button does, by key name (the TV page sends it)
// adb is config tv.adb, or the adb on this computer's PATH. Nothing is sent to the TV but the one fixed command.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { hubConfig } from './config.mjs'

// A home network's own address, and not this computer.
export const isPrivate = h => /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(String(h || ''))
const KEY_RE = /^[A-Z][A-Z0-9_]{1,30}$/
const JOB_RE = /^(mic|assistant|overlay|home|menu|files|browser|ai|rew|ff|saver|sleep|settings|volup|voldown|mute|back|none|app:[^\u0000-\u001f|]{1,60}(\|[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+)?)$/
export function cleanMap(raw) {
  const out = {}
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}).slice(0, 60)) if (KEY_RE.test(k) && typeof v === 'string' && JOB_RE.test(v)) out[k] = v
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
  // A TV that slept leaves a connection that looks open and isn't: that one is dropped and made again.
  async function link() {
    for (let i = 0; i < 3; i++) {
      await adb(['connect', `${saved.host}:5555`], 6000).catch(e => { if (/adb isn/.test(e.message)) throw e })
      try { if ((await shell('echo ready', 4000)).includes('ready')) return } catch {}
      await adb(['disconnect', `${saved.host}:5555`], 4000).catch(() => {})
      await new Promise(r => setTimeout(r, 700))
    }
    throw new Error('not answering')
  }
  const awake = async () => /mWakefulness=(Awake|Dreaming)/.test(await shell('dumpsys power | grep mWakefulness='))
  const until = async (want, tries) => { for (let i = 0; i < tries; i++) { if ((await awake().catch(() => null)) === want) return true; await new Promise(r => setTimeout(r, 450)) } return false }
  // What's in front, and Fire TV's own Home.
  const front = async () => (/ResumedActivity[^\n]*? ([\w.]+)\//.exec(await shell('dumpsys activity activities | grep -E "ResumedActivity" | head -1').catch(() => '')) || [])[1] || ''
  const HUB = 'local.hub.tv'
  async function toFireTv() {
    await shell('input keyevent 3; am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null 2>&1; true').catch(() => {})
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 350))
      if ((await front()) !== HUB) return true
      if (i === 2) await shell('am start -n com.amazon.tv.launcher/.ui.HomeActivity_vNext >/dev/null 2>&1; true').catch(() => {})
    }
    return false
  }
  // One at a time, in the order they were asked; a change is done when the TV itself says so.
  let line = Promise.resolve(), known = { at: 0, on: null }
  const power = want => (line = line.catch(() => {}).then(async () => {
    if (want === undefined && Date.now() - known.at < 2500) return { known: true, on: known.on, hub: known.hub }
    await link()
    let on = await awake()
    if (want !== undefined) {
      // LocalHub off leaves the TV on, at Fire TV's Home. The other way is LocalHub on it, awake.
      if (want === 'firetv' || (want === 'toggle' && on && (await front()) === HUB)) {
        const done = !on || await toFireTv()
        known = { at: Date.now(), on, hub: !done }
        return { known: true, on, hub: !done, ...(done ? {} : { error: 'LocalHub didn’t close on the TV.' }) }
      }
      const to = want === 'toggle' ? true : want
      // Wake and Sleep say which; Power, the other way, is for when one of them didn't take.
      for (const key of to ? [224, 26, 224] : [223, 26, 223]) {
        if (on === to) break
        await shell(`input keyevent ${key}`).catch(() => {})
        if (await until(to, key === 26 ? 6 : 9)) on = to
        else { await link(); on = await awake() }
      }
      if (on && to) await shell('am start -n local.hub.tv/.MainActivity >/dev/null 2>&1; true').catch(() => {})
      known = { at: Date.now(), on, hub: on && to }
      if (on !== to) return { known: true, on, hub: false, error: to ? 'The TV didn’t turn on.' : 'The TV didn’t turn off.' }
    }
    if (want === undefined) known = { at: Date.now(), on, hub: on && (await front()) === HUB }
    return { known: true, on, hub: known.hub }
  }))
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
    if (url.pathname === '/api/tv/power') {
      try {
        if (!saved.host) throw new Error('The TV hasn’t talked to this hub yet. Open LocalHub on it.')
        if (req.method === 'GET') return send(res, 200, await power()), true
        const b = await readBody(req).catch(() => ({})) || {}
        if (b.on !== 'toggle' && b.on !== 'firetv' && typeof b.on !== 'boolean') return send(res, 400, { error: 'on is true, false, "toggle" or "firetv"' }), true
        return send(res, 200, await power(b.on)), true
      } catch (e) {
        return send(res, 200, { known: false, on: null, error: /adb isn/.test(e.message) || /hasn/.test(e.message) ? e.message : 'The TV isn’t answering on the network. It may be unplugged, or its ADB debugging is off.' }), true
      }
    }
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
