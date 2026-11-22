// Set up a TV (tv-setup.mjs): which addresses count as the home network, and who may use the routes.
//
//   node --test "test/tv/*.test.mjs"
import test from 'node:test'
import assert from 'node:assert/strict'
import { lanAddresses, create, APK_URL } from '../../tv-setup.mjs'

const v4 = (address, internal = false) => ({ family: 'IPv4', address, internal })

test('only private addresses on real adapters count, Wi-Fi and Ethernet first', () => {
  const found = lanAddresses({
    'vEthernet (WSL)': [v4('172.20.16.1')],
    Tailscale: [v4('100.101.102.103')],
    'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
    'Some Adapter': [v4('10.0.0.8')],
    'Wi-Fi': [v4('192.168.1.20'), { family: 'IPv6', address: 'fe80::1', internal: false }],
    Public: [v4('8.8.8.8')],
  })
  assert.deepEqual(found.map(f => f.address), ['192.168.1.20', '10.0.0.8'])
  assert.equal(found[0].adapter, 'Wi-Fi')
  assert.deepEqual(lanAddresses({}), [])
})

test('the app link is the newest release\'s TV app', () => {
  assert.match(APK_URL, /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/latest\/download\/LocalHub-TV\.apk$/)
})

test('the routes answer only this computer, and only their own paths', async () => {
  const route = create({})
  const sent = []
  const send = (res, status, body) => sent.push({ status, body })
  const req = (remote, host) => ({ socket: { remoteAddress: remote }, headers: { host }, method: 'GET' })
  const url = p => new URL(p, 'http://localhost')

  assert.equal(await route(url('/api/tv/next'), req('127.0.0.1', 'localhost:3100'), {}, { send }), false)

  assert.equal(await route(url('/api/tv/setup'), req('192.168.1.40', '192.168.1.20:3100'), {}, { send }), true)
  assert.equal(sent.at(-1).status, 403)

  const r = req('127.0.0.1', 'localhost:3100')
  r.method = 'POST'
  assert.equal(await route(url('/api/tv/setup/lan'), r, {}, { send, readBody: async () => ({ on: 'yes' }) }), true)
  assert.equal(sent.at(-1).status, 400)
})
