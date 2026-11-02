// Loaded into each Node and Electron-as-Node process of a test run while net-audit.ps1 is watching. Notes
// where each one starts an outgoing connection, and changes nothing about the connection. Electron drops
// NODE_OPTIONS' --require and a Hub may start helpers with a bare environment, so this passes itself on to
// every child that runs JavaScript.
const childProcess = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')

const file = process.env.LH_NET_AUDIT_NODE_LOG
const note = entry => {
  try { fs.appendFileSync(file, `${JSON.stringify({ pid: process.pid, ...entry })}\n`) } catch {}
}

// The forms Socket.connect takes: (options), (port, host), (path), and Node's own ([options, callback]).
function target(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  if (first && typeof first === 'object') return first.path ? null : { host: first.host ?? 'localhost', port: Number(first.port) }
  const port = Number(first)
  return Number.isNaN(port) ? null : { host: typeof args[1] === 'string' ? args[1] : 'localhost', port }
}

if (file) {
  note({ event: 'start', ppid: process.ppid, exec: process.execPath, type: process.type ?? 'node', argv: process.argv.slice(1, 4) })
  const connect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function logged(...args) {
    const to = target(args)
    if (to) note({ event: 'connect', ...to })
    return connect.apply(this, args)
  }
  // spawn, fork, exec and execFile all end up here.
  const spawn = childProcess.ChildProcess.prototype.spawn
  childProcess.ChildProcess.prototype.spawn = function passedOn(options) {
    if (options.file === process.execPath || /(^|[\\/])node(\.exe)?$/i.test(options.file)) {
      options.args = [options.args[0], '--require', __filename, ...options.args.slice(1)]
      options.envPairs = [...(options.envPairs ?? []), `LH_NET_AUDIT_NODE_LOG=${file}`]
    }
    return spawn.call(this, options)
  }
}
