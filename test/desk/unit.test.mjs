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
  assert.ok(rowIds({ 'key:99': 'home' }).includes('key:99'))
  for (const b of BUTTONS) assert.ok(remoteHTML('menu', {}).includes(`data-rm="${b.id}"`))
})
