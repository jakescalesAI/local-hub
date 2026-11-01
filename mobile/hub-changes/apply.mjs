// Applies the lines in README.md to a Hub checkout: node apply.mjs <path-to-hub>
// Refuses and changes nothing if any anchor line is missing, so a moved line can't be patched blindly.
// Safe to run twice.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const EDITS = {
  'server.mjs': [
    {
      after: `import { HERE, PORT, configPath, hubConfig, tabOn, addonOn } from './config.mjs'`,
      add: [`import { createDeviceAuth } from './device-auth.mjs'`],
    },
    {
      after: `const filesRoute = createFiles({ run, sshHost: SSH_HOST, here: HERE })`,
      add: [`const deviceAuth = createDeviceAuth({ here: HERE, enabled: () => hubConfig().deviceAuth === true, hubName: () => hubConfig().name, hubUrl: () => hubConfig().url })`],
    },
    {
      before: `    if (url.pathname === '/' || url.pathname === '/index.html')`,
      add: [
        `    if (deviceAuth.gate(url, req, res, { send })) return`,
        `    if (await deviceAuth.route(url, req, res, { send, readBody })) return`,
      ],
    },
  ],
  'chat.mjs': [
    {
      after: `    emit({ type: 'session', sessionId: conv.id, title: conv.title })`,
      add: [`    if (body.detached) res.end() // the phone goes away after sharing: keep working, the reply lands in the conversation`],
    },
    {
      replace: `    res.on('close', () => { if (running.get(conv.id) === entry && !entry.finished) {`,
      with: `    res.on('close', () => { if (!body.detached && running.get(conv.id) === entry && !entry.finished) {`,
    },
  ],
}

function patched(source, edits, file) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(eol)
  for (const e of edits) {
    if (e.replace) {
      if (lines.some(l => l.startsWith(e.with))) continue
      const i = lines.findIndex(l => l.startsWith(e.replace))
      if (i < 0) throw new Error(`${file}: line not found: ${e.replace}`)
      lines[i] = e.with + lines[i].slice(e.replace.length)
      continue
    }
    if (lines.includes(e.add[0])) continue
    const anchor = e.after ?? e.before
    const i = lines.indexOf(anchor)
    if (i < 0) throw new Error(`${file}: line not found: ${anchor}`)
    lines.splice(e.after ? i + 1 : i, 0, ...e.add)
  }
  return lines.join(eol)
}

export function apply(hub) {
  // Work out every change first: nothing is written unless all of them fit.
  const out = Object.entries(EDITS).map(([file, edits]) => {
    const target = path.join(hub, file)
    return [target, patched(fs.readFileSync(target, 'utf8'), edits, file)]
  })
  for (const [target, text] of out) fs.writeFileSync(target, text)
  fs.copyFileSync(path.join(HERE, 'device-auth.mjs'), path.join(hub, 'device-auth.mjs'))
  fs.mkdirSync(path.join(hub, 'vendor'), { recursive: true })
  fs.copyFileSync(path.join(HERE, 'vendor', 'qrcode.mjs'), path.join(hub, 'vendor', 'qrcode.mjs'))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hub = process.argv[2]
  if (!hub) {
    console.error('Usage: node apply.mjs <path-to-hub>')
    process.exit(2)
  }
  try {
    apply(path.resolve(hub))
    console.log('Done. Set "deviceAuth": true in config/hub.json when you are ready to require pairing.')
  } catch (e) {
    console.error(`Nothing was changed. ${e.message}`)
    process.exit(1)
  }
}
