// Home's apps (desk.mjs), the music player (music.mjs) and the remote's buttons. Offline.   node --test test/desk/
import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanDesk, realApp, START, MORE } from '../../desk.mjs'
import { appName, pickNow, validClientId } from '../../music.mjs'
import { actionOf, actionName, rowIds, remoteHTML, BUTTONS } from '../../tv/ui/remote.js'

test('what Home can hold: web pages and Start menu programs, each once', () => {
  const d = cleanDesk({ apps: [{ id: 'a', name: 'A', url: 'https://a.com/' }, { id: 'a', name: 'again', url: 'https://b.com/' }, { id: 'js', name: 'J', url: 'javascript:alert(1)' }, { id: 'f', name: 'F', url: 'file:///c:/x' }, { id: 'pc:Chrome', name: 'Chrome' }, { id: 'pc:a"b', name: 'quote' }, { id: 'x', name: '', url: 'https://x.com' }], favorites: ['a', 'gone', 'pc:Chrome', 'a'] })
  assert.deepEqual(d.apps.map(a => a.id), ['a', 'pc:Chrome'])
  assert.deepEqual(d.favorites, ['a', 'pc:Chrome'])
  assert.deepEqual(cleanDesk(null), { apps: [], favorites: [] })
  assert.equal(cleanDesk({ apps: [...START, ...MORE] }).apps.length, START.length + MORE.length)
})
test('uninstallers, manuals and links are not programs', () => {
  assert.equal(realApp({ id: 'Chrome', name: 'Google Chrome' }), true)
  for (const a of [{ id: 'x', name: 'Uninstall Zoom' }, { id: 'microsoft-edge:https://x', name: 'Booking' }, { id: 'C:\a.chm', name: 'Help' }, { id: 'y', name: 'User Guide' }, { id: 'a"b', name: 'q' }]) assert.equal(realApp(a), false)
})
test('the player shows what is playing, or the source that was picked', () => {
  const pc = { from: 'pc', title: 'a', playing: false }, sp = { from: 'spotify', title: 'b', playing: true }
  assert.equal(pickNow('auto', [pc, sp]), sp)
  assert.equal(pickNow('pc', [pc, sp]), pc)
  assert.equal(pickNow('tv', [pc, sp]), null)
  assert.equal(appName('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify'), 'Spotify')
  assert.ok(validClientId('a'.repeat(32)) && !validClientId('x'.repeat(32)) && !validClientId(''))
})
test('the remote: arrows, OK and Back never change; a button can open an app', () => {
  for (const k of ['left', 'enter', 'back', 'hold']) assert.equal(actionOf(k, { [k]: 'none' }), k)
  assert.equal(actionOf('menu', {}), 'mic')
  assert.equal(actionOf('rew', { rew: 'app:Netflix' }), 'app:Netflix')
  assert.equal(actionName('app:Netflix'), 'Open Netflix')
  assert.equal(actionOf('key:99', {}), 'none')
  assert.ok(rowIds({ 'key:99': 'home' }, 'pad').includes('key:99'))
  for (const b of BUTTONS) assert.ok(remoteHTML('menu', {}).includes(`data-rm="${b.id}"`))
  assert.ok(rowIds({}, 'pad').includes('key:99') && !rowIds({}, 'pad').includes('pad-a'))
  assert.deepEqual(rowIds({ 'key:183': 'home' }, 'other'), ['key:183', 'reset'])
})

test('the remote in every app: only known jobs, and a command nothing can be slipped into', async () => {
  const { cleanMap, startCommand, isPrivate } = await import('../../tv-keys.mjs')
  const { nativeMap } = await import('../../tv/ui/remote.js')
  assert.deepEqual(cleanMap({ MENU: 'mic', APP_1: 'app:Plex|com.plexapp.android', BAD: 'rm -rf', 'x;y': 'mic', APP_2: 'app:X|a;b', APP_3: 'app:$(x)' }), { MENU: 'mic', APP_1: 'app:Plex|com.plexapp.android', APP_3: 'app:$(x)' })
  assert.match(startCommand({ APP_3: 'app:$(reboot)' }), /KeyDaemon [A-Za-z0-9+/=]+ >\/data\/local\/tmp\/localhub-keys\.log/)
  assert.ok(isPrivate('192.168.1.50') && !isPrivate('8.8.8.8') && !isPrivate('127.0.0.1') && !isPrivate('192.168.1.1; x'))
  // A button doing its standard job is left to the TV; the Fire TV ones only once given a job.
  assert.deepEqual(nativeMap({}), { MENU: 'mic' })
  assert.deepEqual(nativeMap({ 'key:99': 'overlay', homebtn: 'none', power: 'power' }), { MENU: 'mic', HOME: 'none', K99: 'overlay' })
  assert.deepEqual(nativeMap({ menu: 'menu', rew: 'app:Plex', app1: 'home' }, n => (n === 'Plex' ? 'com.plexapp.android' : '')), { MEDIA_REWIND: 'app:Plex|com.plexapp.android', APP_1: 'home' })
})

test('Tailscale status, cut to what Settings shows', async () => {
  const { readTailscale, qrFor } = await import('../../reach.mjs')
  const t = readTailscale({ BackendState: 'Running', Self: { DNSName: 'pc.tail1.ts.net.', TailscaleIPs: ['fd7a::1', '100.1.2.3'] }, Peer: { a: { DNSName: 'phone.tail1.ts.net.', OS: 'iOS', Online: false }, b: { HostName: 'box', OS: 'linux', Online: true }, c: {} } })
  assert.deepEqual([t.running, t.ip, t.name, t.peers.map(p => p.name)], [true, '100.1.2.3', 'pc', ['box', 'phone']])
  assert.deepEqual(readTailscale(null).peers, [])
  assert.equal(readTailscale({ BackendState: 'Stopped' }).running, false)
  assert.match(qrFor('http://192.168.1.50:3100/pair'), /^<svg/)
})

test('the entry code: digits only, waits that grow, and the same offline sum on both sides', async () => {
  const L = await import('../../lock.mjs'), U = await import('../../tv/ui/lock.js')
  for (const p of ['1234', '123456']) assert.equal(L.validPin(p), true)
  for (const p of ['123', '12345', '12a4', '', 1234, '1234567']) assert.equal(L.validPin(p), false)
  assert.deepEqual([0, 4, 5, 6, 20].map(L.waitFor), [0, 0, 30_000, 60_000, 3600_000])
  for (const [pin, salt] of [['1234', 'ab'], ['908172', 'f00d']]) assert.equal(U.offlineHash(pin, salt, 50), L.offlineHash(pin, salt, 50))
  assert.deepEqual(L.cleanPlaces(['tv', 'nope', 'desk']), ['tv', 'desk'])
})
test('the entry code over its routes: set, wrong, right, locked out, changed only with the code', async () => {
  const { create } = await import('../../lock.mjs')
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path')
  const here = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'))
  const route = create({ here })
  const call = async (method, p, body, local = true) => { let out; await route(new URL('http://localhost' + p), { method, headers: { host: local ? 'localhost' : '192.168.1.50' }, socket: { remoteAddress: local ? '127.0.0.1' : '192.168.1.9' } }, {}, { send: (r, c, b) => { out = { c, b } }, readBody: async () => body }); return out }
  assert.equal((await call('GET', '/api/lock')).b.on, false)
  assert.equal((await call('POST', '/api/lock', { next: '2580' }, false)).c, 403)
  assert.equal((await call('POST', '/api/lock', { next: '25' })).c, 400)
  assert.equal((await call('POST', '/api/lock', { next: '2580', places: ['tv', 'desk'], after: 15 })).b.on, true)
  assert.ok(!fs.readFileSync(path.join(here, 'data', 'lock.json'), 'utf8').includes('2580'))
  assert.equal((await call('POST', '/api/lock', { pin: '0000', next: '' })).c, 403)
  const ok = (await call('POST', '/api/lock/check', { pin: '2580' }, false)).b
  assert.ok(ok.ok && ok.offline.hash)
  for (let i = 0; i < 5; i++) await call('POST', '/api/lock/check', { pin: '1111' }, false)
  const shut = (await call('POST', '/api/lock/check', { pin: '2580' })).b
  assert.ok(!shut.ok && shut.wait > 0)
  // Restarting the hub doesn't give more tries.
  const again = create({ here })
  let w; await again(new URL('http://localhost/api/lock'), { method: 'GET', headers: {} }, {}, { send: (r, c, b) => { w = b.wait } })
  assert.ok(w > 0)
})
