// npm run pair: a pairing code for a phone, from the terminal of the machine LocalHub runs on (a laptop, a VM, a container).
import qrcode from './vendor/qrcode.mjs'
import os from 'node:os'
import { hubConfig, PORT } from './config.mjs'

const origin = u => { try { return new URL(u).origin } catch { return '' } }
const { url, listen } = hubConfig()
const lan = Object.values(os.networkInterfaces()).flat().filter(n => n.family === 'IPv4' && !n.internal && (listen || []).includes(n.address)).map(n => `http://${n.address}:${PORT}`)
const urls = [...new Set([origin(process.argv[2] || ''), origin(url || ''), ...lan].filter(Boolean))].slice(0, 4)
let r
try { r = await (await fetch(`http://127.0.0.1:${PORT}/api/pair/start`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ urls }) })).json() } catch { console.error(`LocalHub isn't answering on port ${PORT}. Start it first: npm start`); process.exit(1) }
if (!r.code) { console.error(r.error || 'That did not work.'); process.exit(1) }
// Two rows of squares in each line of text.
function draw(text) {
  const q = qrcode(0, 'L')
  q.addData(text)
  q.make()
  const n = q.getModuleCount(), on = (y, x) => x >= 0 && y >= 0 && x < n && y < n && q.isDark(y, x)
  let out = ''
  for (let y = -2; y < n + 2; y += 2) { let l = ''; for (let x = -2; x < n + 2; x++) { const a = on(y, x), b = on(y + 1, x); l += a ? (b ? ' ' : '\u2584') : b ? '\u2580' : '\u2588' } out += `${l}\n` }
  return out
}
const code = r.code.replace(/(.{4})(?=.)/, '$1 ')
if (urls[0]) console.log(`\n${draw(`${urls[0]}/pair#${r.code}`)}\nScan this with the phone's camera, or open:\n${urls.map(u => `  ${u}/pair`).join('\n')}`)
else console.log(`\nOpen this hub's address on the phone, then /pair. (Say which: npm run pair -- https://your-address)`)
console.log(`\nCode: ${code}   works once, for five minutes\n`)
