// One small Windows helper (pc-helper.ps1), started when something first asks and ended after two idle minutes.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { IS_WIN } from './platform.mjs'

const IDLE_MS = 120_000
const LIMIT = 4 * 2 ** 20
let shared = null
export function pcHelper(here) {
  return (shared ??= make(path.join(here, 'pc-helper.ps1')))
}
function make(script) {
  let proc = null, n = 0, buf = '', idle = null
  const waiting = new Map()
  function drop(why) {
    const p = proc
    proc = null
    buf = ''
    clearTimeout(idle)
    for (const w of waiting.values()) { clearTimeout(w.t); w.no(new Error(why)) }
    waiting.clear()
    p?.kill()
  }
  function start() {
    const p = (proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }))
    p.stdout.setEncoding('utf8')
    p.stdout.on('data', d => {
      buf += d
      if (buf.length > LIMIT) return drop('too much output')
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        let m
        try { m = JSON.parse(line) } catch { continue }
        const w = waiting.get(m.n)
        if (!w) continue
        waiting.delete(m.n)
        clearTimeout(w.t)
        if (m.error) w.no(new Error(m.error)); else w.ok(m)
      }
    })
    const gone = () => { if (proc === p) drop('the helper stopped') }
    p.on('error', gone)
    p.on('exit', gone)
    p.stdin.on('error', () => {})
  }
  return {
    ask(cmd, arg) {
      if (!IS_WIN) return Promise.reject(new Error('only on Windows'))
      if (!proc) start()
      clearTimeout(idle)
      idle = setTimeout(() => drop('idle'), IDLE_MS)
      idle.unref?.()
      return new Promise((ok, no) => {
        const id = ++n
        const t = setTimeout(() => { waiting.delete(id); no(new Error('the helper took too long')); if (waiting.size > 4) drop('stuck') }, 9000)
        waiting.set(id, { ok, no, t })
        proc.stdin.write(`${JSON.stringify({ n: id, cmd, arg })}\n`)
      })
    },
  }
}
