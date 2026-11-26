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

test('the player: no position in what is drawn, so it is not drawn again every second', async () => {
  const P = await import('../../tv/ui/panel.js')
  const m = { title: 'A <b>', artist: 'B', playing: true, art: '/api/music/art/0123456789abcdef.jpg', from: 'pc', app: 'Apple Music', pos: 10, dur: 100, seek: false }
  assert.equal(P.player(m, true), P.player({ ...m, pos: 55 }, true))
  assert.ok(!P.player(m).includes('<b>A') && P.player(m).includes('A &lt;b&gt;'))
  assert.ok(P.player({ ...m, seek: true }).includes('mp-bar seek') && !P.player(m).includes('mp-bar seek'))
  const { cleanState, cleanCommand } = await import('../../tv.mjs')
  assert.deepEqual([cleanState({ media: { pos: 12.34, dur: 200, seek: true } }).media.pos, cleanState({ media: { pos: -1, dur: 'x' } }).media.dur], [12.3, null])
  assert.deepEqual(cleanCommand({ type: 'media', action: 'seek', value: 30 }), { type: 'media', action: 'seek', value: 30 })
  assert.equal(cleanCommand({ type: 'media', action: 'seek', value: -1 }), null)
})

test('the TV screen: only known keys, taps on the screen and plain text, and video cut into its pieces', async () => {
  const { eventLine, nalCutter, nalType } = await import('../../tv-screen.mjs')
  assert.deepEqual([{ key: 'left' }, { key: 'home' }, { key: 'toString' }, { key: 'k 26' }, { tap: [0.5, 1] }, { tap: [2, 0] }, { tap: ['0', 0] }, { text: 'a b\n' }, { text: '\n' }, null].map(eventLine), ['k 21', 'h', '', '', 't 0.5000 1.0000', '', '', `x ${Buffer.from('a b').toString('base64')}`, '', ''])
  const got = [], c = nalCutter(n => got.push([nalType(n), n.length]))
  const all = Buffer.from([0, 0, 0, 1, 0x67, 9, 9, 0, 0, 0, 1, 0x68, 7, 0, 0, 1, 0x65, 1, 2, 3, 0, 0, 0, 1, 0x61, 5])
  for (const b of all) c.push(Buffer.from([b]))
  assert.deepEqual(got, [[7, 7], [8, 6], [5, 7]])
  c.flush()
  assert.deepEqual(got.at(-1), [1, 6])
})

test('the hub’s icon is one of its drawings, and an upload is a picture', async () => {
  const { cleanIcon, iconSvg, imageType, GLYPHS, COLORS } = await import('../../identity.mjs')
  assert.deepEqual([cleanIcon({ glyph: 'star', color: 'blue' }), cleanIcon({ glyph: '<svg', color: 'blue' }), cleanIcon({ glyph: 'toString', color: 'blue' }), cleanIcon('upload'), cleanIcon('x'), cleanIcon(null)], [{ glyph: 'star', color: 'blue' }, null, null, 'upload', null, null])
  for (const glyph of Object.keys(GLYPHS)) for (const color of Object.keys(COLORS)) assert.ok(iconSvg({ glyph, color }, 'Hub').startsWith('<svg'))
  assert.ok(!iconSvg({ glyph: 'letter', color: 'blue' }, '<script>').includes('<<') && iconSvg({ glyph: 'letter', color: 'blue' }, '<b').includes('&lt;'))
  assert.deepEqual([imageType(Buffer.from('<svg onload=alert(1)>xxxx')), imageType(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20)]))], ['', 'png'])
})

test('a paused song keeps its place, and timed words are read', async () => {
  const { pickNow, readLyrics } = await import('../../music.mjs')
  const pc = { from: 'pc', title: 'A', playing: false }, tv = { from: 'tv', title: '', playing: true }
  assert.deepEqual([pickNow('auto', [pc, tv]).from, pickNow('auto', [{ ...pc, title: '' }, tv]).from, pickNow('auto', [pc, { ...tv, title: 'B' }]).from], ['pc', 'tv', 'tv'])
  assert.deepEqual(readLyrics({ syncedLyrics: '[00:01.50] one\n[01:02.00]\nnot timed' }), { lines: [{ t: 1.5, x: 'one' }, { t: 62, x: '' }], plain: [] })
  assert.deepEqual(readLyrics(null).lines, [])
})

test('Files: your folders, the newest first, and part of a file', async () => {
  const { createFiles } = await import('../../files.mjs')
  const route = createFiles({ run: async () => ({ stdout: '' }), sshHost: '', here: process.cwd() })
  let got
  const send = (res, code, body) => { got = [code, body] }
  assert.equal(await route(new URL('http://x/api/files/drives/places'), { method: 'GET', headers: {} }, {}, { send }), true)
  assert.ok(got[0] === 200 && got[1].places.every(p => p.path && !('full' in JSON.parse(JSON.stringify(p)))))
  assert.ok(got[1].recent.every((x, i, l) => !i || l[i - 1].mtime >= x.mtime))
  assert.equal(await route(new URL('http://x/api/files/laptop/kind?q=image'), { method: 'GET', headers: {} }, {}, { send }), false)
})

test('an icon of your own is a few characters, and only the sound’s places are places', async () => {
  const { cleanIcon, iconSvg, shortText } = await import('../../identity.mjs')
  assert.deepEqual([shortText('👨‍👩‍👧x'), shortText('ABCDE'), shortText('  ')], ['👨‍👩‍👧x', 'ABC', ''])
  assert.ok(!iconSvg(cleanIcon({ glyph: 'text', text: '<a>', color: 'blue' })).includes('<a>'))
  const { cleanCommand } = await import('../../tv.mjs')
  assert.deepEqual(cleanCommand({ type: 'audio', on: 'yes' }), { type: 'audio', on: false })
})

test('Home’s widgets: every one in the list is drawn at every size, and a board keeps only what it knows', async () => {
  const { cleanItems, cleanData, cleanOpts, IDS, SIZES } = await import('../../board.mjs')
  const { W, drawItem, can, nextSize, timerLeft, mmss } = await import('../../tv/ui/widgets.js')
  assert.deepEqual(Object.keys(W).sort(), [...IDS].sort())
  const D = { music: { title: 'A <b>', playing: true }, music_: { volume: 40, brightness: 50 }, wx: { place: 'X', now: { temp: 1, feels: 1, code: 3, text: 'Cloudy', day: true }, high: 2, low: 0, hours: [], days: [] }, sys: { cpu: 5, mem: 95, disk: 40, diskFree: 1e12 }, board: { data: { notes: { n: '<img>' }, todos: [{ text: '<i>', done: false }], timer: null } }, places: { recent: [{ name: '<x>', path: 'C:/a', size: 3 }] }, drives: { entries: [{ name: 'C:', size: 10, free: 4 }] }, photos: { photos: [{ url: '/a' }] }, apps: { favorites: ['q'], apps: [{ id: 'q', name: '<q>', url: 'https://a.b/' }] } }
  for (const [id, w] of Object.entries(W)) {
    assert.ok(w.sizes.includes(w.def) && w.sizes.every(z => SIZES.includes(z)), id)
    for (const size of w.sizes) { const h = drawItem({ k: 'n', id, size }, D); assert.ok(h.includes('wg-i') && !h.includes('A <b>') && !/<(x|q|img)>/.test(h), `${id} ${size}`); assert.ok(drawItem({ k: 'n', id, size }, {}).includes('wg-i'), `${id} empty`) }
  }
  assert.ok(can('music', 'tv') && !can('remote', 'tv') && nextSize('music', 'xl') === 's')
  assert.deepEqual(cleanItems([{ k: 'a', id: 'music', size: 'w' }, { k: 'a', id: 'pc' }, { k: '<', id: 'pc' }, { k: 'b', id: 'nope' }, { k: 'c', id: 'pc', size: 'huge', opts: { zones: ['Europe/London', '../x'], evil: 1 } }]), [{ k: 'a', id: 'music', size: 'w' }, { k: 'c', id: 'pc', size: 'm', opts: { zones: ['Europe/London'] } }])
  assert.deepEqual(cleanOpts({ date: '2026-12-25', title: ' X ' }), { title: 'X', date: '2026-12-25' })
  assert.deepEqual(cleanData({ todos: [{ text: ' a ', done: 1 }, { text: '' }, 3], timer: { total: 5, left: 1e99, end: -1 } }).todos, [{ text: 'a', done: false }])
  assert.deepEqual([timerLeft({ end: 0, left: 5 }), timerLeft({ end: 100, left: 5 }, 40), mmss(61_000), mmss(3_661_000)], [5, 60, '1:01', '1:01:01'])
})

test('Widgets: what doesn’t fit a screen isn’t placed, the rest stay where they were put, and the clock and the days are right', async () => {
  const { pack, place, fitting, ROOM, events, W } = await import('../../tv/ui/widgets.js')
  const { clockHTML, words, STYLES, FONTS } = await import('../../tv/ui/clock.js')
  const { cleanClock, cleanItems, cleanData } = await import('../../board.mjs')
  const l = [{ k: 'a', id: 'music', size: 'w' }, { k: 'b', id: 'weather', size: 'l' }, { k: 'c', id: 'pc', size: 'l' }]
  assert.deepEqual([...pack(l, 'tv').at.values()], [[1, 1, 4, 1], [1, 2, 2, 2], [3, 2, 2, 2]])
  // A computer's Home: six by four squares; wide is 4 by 1, large 2 by 2, small 1, XL and XXL 3 by 2.
  assert.deepEqual([...pack([l[0], l[1], { k: 'c', id: 'pc', size: 's' }], 'desk').at.values()], [[1, 1, 4, 1], [5, 1, 2, 2], [1, 2, 1, 1]])
  assert.deepEqual([...pack([...l, { k: 'd', id: 'calendar', size: 'xl' }], 'tv').out], ['d'])
  assert.deepEqual([...pack([...l, { k: 'd', id: 'calendar', size: 'xl' }], 'desk').at.get('d')], [3, 3, 3, 2])
  assert.deepEqual([...pack([...l, { k: 'd', id: 'calendar', size: 'xl' }, { k: 'e', id: 'calendar', size: 'xxl' }], 'desk').out], ['e'])
  assert.equal(pack([...l, { k: 'd', id: 'calendar', size: 'xl' }], 'saver').out.size, 0)
  assert.deepEqual(fitting(l, { k: 'n', id: 'clock', size: 's' }, 'tv'), [])
  assert.deepEqual(fitting(l, l[1], 'tv'), ['s', 'm', 'l'])
  assert.deepEqual(place(l, 'tv', 'b', { at: [3, 2], swap: true }).map(x => [x.k, x.at]), [['b', [3, 2]], ['c', [1, 2]], ['a', [1, 1]]])
  assert.equal(place(l, 'tv', 'b', { size: 'xxl' }), null)
  for (const s of Object.keys(ROOM)) for (const [id, w] of Object.entries(W)) for (const size of w.sizes) { const [x] = pack([{ k: 'k', id, size }], s).at.values(); assert.ok(x && x[0] + x[2] - 1 <= ROOM[s][0] && x[1] + x[3] - 1 <= ROOM[s][1], `${id} ${size} ${s}`) }
  assert.deepEqual(cleanItems([{ k: 'a', id: 'pc', size: 'x', at: [1, 2] }, { k: 'b', id: 'pc', size: 's', at: [0, 'x'] }]), [{ k: 'a', id: 'pc', size: 'xl', at: [1, 2] }, { k: 'b', id: 'pc', size: 's' }])
  const [e] = events({ cal: { calendars: [], events: [{ id: 'l1', title: 'Off', start: '2026-11-25', end: '2026-11-26', allDay: true }] } })
  assert.deepEqual([e.at.getDate(), e.at.getHours()], [25, 0])
  assert.deepEqual(cleanClock({ font: 'serif', color: '#12345g', size: 9999, evil: 1, style: 'x"><img>' }), { font: 'serif', size: 250 })
  assert.deepEqual(cleanData({ clock: { style: 'flip' } }).clock, { style: 'flip' })
  assert.equal(cleanData({ todos: [] }, cleanData({ clock: { style: 'flip' } })).clock.style, 'flip')
  for (const style of Object.keys(STYLES)) for (const font of Object.keys(FONTS)) assert.ok(clockHTML({ style, font, color: '"><img>', secs: true }).startsWith('<div class="hc') && !clockHTML({ style, font, color: '"><img>' }).includes('<img'))
  assert.deepEqual([words(new Date(2026, 0, 1, 21, 5)), words(new Date(2026, 0, 1, 11, 45)), words(new Date(2026, 0, 1, 0, 0))], ['five past nine', 'quarter to twelve', 'twelve o’clock'])
})

test('The clocks can show another time zone than the screen is set to, and show their own when told nothing', async () => {
  const { setZone, now } = await import('../../tv/ui/clock.js')
  const fmt = (tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
  const local = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  for (const tz of ['America/New_York', 'America/Chicago', 'Asia/Kolkata', 'Pacific/Chatham']) { setZone(tz); assert.equal(local(now()), fmt(tz).replace(/^24/, '0').replace(/^0(?=[0-9])/, ''), tz) }
  setZone(''); assert.ok(Math.abs(now() - Date.now()) < 1000)
  setZone('Not/AZone'); assert.ok(Math.abs(now() - Date.now()) < 1000)
})

test('A song’s place is found from whole seconds, and its words are the ones for that recording', async () => {
  const { songClock, readLyrics, pickLyrics } = await import('../../music.mjs')
  // Began at 1000.4; the player says floor(position), a little over a second apart.
  const k = songClock(); let worst = 0
  for (let i = 0, t = 1003; i < 60; i++, t += 1.023) { k.see('a', Math.floor(t - 1000.4), t * 1000, true); if (i > 45) worst = Math.max(worst, Math.abs(k.at('a', t * 1000) - (t - 1000.4))) }
  assert.ok(worst < 0.1, String(worst))
  k.see('a', 200, 1100_000, true) // moved along by hand
  assert.ok(Math.abs(k.at('a', 1100_000) - 200.5) < 0.01)
  assert.equal(k.at('b', 1), null)
  k.see('a', 20, 1100_000, false); assert.equal(k.at('a', 1100_000), null)
  k.see('c', 12.345, 2000_000, true); assert.ok(Math.abs(k.at('c', 2001_000) - 13.345) < 0.001)
  assert.deepEqual(readLyrics({ syncedLyrics: ['[offset:+500]', '[00:20.00][00:10.50] b', '[00:05:25] a', 'nope'].join(String.fromCharCode(10)) }).lines, [{ t: 4.75, x: 'a' }, { t: 10, x: 'b' }, { t: 19.5, x: 'b' }])
  const timed = [1, 2, 3, 4, 5].map(x => `[00:0${x}.00] l${x}`).join(String.fromCharCode(10)), L = [{ trackName: 'Song (Live)', duration: 200, syncedLyrics: timed }, { trackName: 'Song', duration: 260, syncedLyrics: timed }, { id: 'near', trackName: 'Song (feat. X)', albumName: 'Other', duration: 201, syncedLyrics: timed }, { trackName: 'Song', albumName: 'Alb', duration: 200, plainLyrics: 'p' }]
  assert.equal(pickLyrics(L, { title: 'Song (feat. X)', album: 'Alb', dur: 200 }).id, 'near')
  assert.equal(pickLyrics(L, { title: 'Other', dur: 200 }), null)
})

test('Lyrics: another artist’s song isn’t this one, and the version the others agree with is taken and put right', async () => {
  const { pickLyrics, readLyrics } = await import('../../music.mjs')
  const song = (id, off, o = {}) => ({ id, trackName: 'Song', artistName: 'Band', duration: 200, syncedLyrics: [10, 20, 30, 40, 50, 60].map((t, i) => `[00:${(t + off).toFixed(2)}] line number ${i}`).join(String.fromCharCode(10)), ...o })
  assert.equal(pickLyrics([song(1, 0, { artistName: 'Cover Act' })], { title: 'Song', artist: 'Band', dur: 200 }), null)
  const b = pickLyrics([song(1, 0.9, { albumName: 'Alb' }), song(2, 0), song(3, 0.1), song(4, -0.1), song(5, 12, { duration: 230 })], { title: 'Song', artist: 'Band', album: 'Alb', dur: 200 })
  assert.ok(Math.abs(readLyrics(b).lines[0].t - 10) < 0.11, String(readLyrics(b).lines[0].t))
  assert.equal(readLyrics({ ...song(1, 0.5), fix: -0.5 }).lines[0].t, 10)
})

test('The Sidebar: only known things are done to the computer, its tools add up, and its names can’t draw anything', async () => {
  const { command, OPEN } = await import('../../pc.mjs')
  assert.deepEqual([command({ what: 'mic', value: false }), command({ what: 'mic', value: 'x' }), command({ what: 'lock' }), command({ what: 'open', value: 'snip' }), command({ what: 'open', value: 'toString' }), command({ what: 'open', value: 'calc.exe' }), command({ what: 'shutdown' }), command(null)], [['mic', false], null, ['lock'], ['open', 'snip'], null, null, null, null])
  assert.deepEqual([command({ what: 'mix', id: 'chrome', level: 250 }), command({ what: 'mix', id: 'a"b', level: 5 }), command({ what: 'mix', id: 'chrome' })], [['mix', { id: 'chrome', level: 100, mute: -1 }], null, null])
  assert.ok(Object.values(OPEN).every(x => /^(ms-[a-z]+:|taskmgr.exe)/.test(x)))
  const S = await import('../../tv/ui/side.js')
  const run = keys => { const x = S.newCalc(); for (const k of keys.split(' ')) S.calcKey(x, k); return x.show }
  assert.deepEqual(['7 × 8 =', '1 . 1 + 2 . 2 =', '5 ÷ 0 =', '2 0 0 + 1 0 % =', '9 − 4 × 2 =', '1 2 ⌫ 3 ='].map(run), ['56', '3.3', 'Error', '220', '10', '13'])
  assert.deepEqual([S.convert('Temperature', 212, '°F', '°C'), Math.round(S.convert('Length', 1, 'mi', 'km') * 1000), S.convert('Data', 1, 'GiB', 'MiB')], [100, 1609, 1024])
  assert.deepEqual([S.powerText({ on: true }), S.powerText({ on: false }), S.powerText({ on: null }), S.powerText({ busy: true, want: false })], ['Turn Off', 'Turn On', 'Turn On', 'Turning off…'])
  assert.ok(!S.mixRow({ id: 'x', name: '<img src=x>', level: 5 }).includes('<img src=x>') && !S.powerHTML({ on: true }, {}).includes('undefined'))
  const { SCREENS } = await import('../../board.mjs'), { ROOM } = await import('../../tv/ui/widgets.js')
  assert.deepEqual([...SCREENS].sort(), Object.keys(ROOM).sort())
})
