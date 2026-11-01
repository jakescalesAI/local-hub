// npm run passcode: sets the passcode other devices need to open this hub. Run it on the hub's own computer.
import readline from 'node:readline/promises'
import { MIN_PASSCODE, setPasscode } from './access.mjs'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const passcode = (await rl.question(`New passcode (at least ${MIN_PASSCODE} characters): `)).trim()
rl.close()
try {
  setPasscode(passcode)
  console.log('Passcode saved. Every browser signs in again.')
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
