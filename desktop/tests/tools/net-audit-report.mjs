// Reads what net-audit.ps1 recorded and says whether the test run touched the watched port.
// Exit code 0: no record shows it. 1: at least one does. 2: the records can't be trusted.
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
const read = name => fs.readFileSync(path.join(dir, name), 'utf8')
const lines = name => read(name).split(/\r?\n/).filter(Boolean)
const watch = Number(read('watch-port.txt'))
const base = image => path.win32.basename(image).toLowerCase()

// Each process in the job, with its image and command line.
const processes = new Map()
for (const line of lines('processes.log')) {
  const [, kind, pid, value] = line.split('\t')
  const entry = processes.get(pid) ?? {}
  entry[kind === 'new' ? 'image' : 'command'] = value
  processes.set(pid, entry)
}

const nodeLog = lines('node.log').map(line => JSON.parse(line))
const hooked = new Set(nodeLog.filter(entry => entry.event === 'start').map(entry => String(entry.pid)))
const connects = nodeLog.filter(entry => entry.event === 'connect')
const nodeHits = connects.filter(entry => entry.port === watch)

// Every other image in the job has to be one of these or it gets named below as not covered.
const NODE_LIKE = /^(node|electron|localhub|local hub)\.exe$/
const NO_NETWORK = new Set(['cmd.exe', 'conhost.exe', 'powershell.exe', 'taskkill.exe', 'netstat.exe', 'reg.exe', 'wmiprvse.exe', 'crashpad_handler.exe'])

const covered = { hook: 0, chromiumHelper: 0, noNetwork: 0 }
const unhooked = []
const notCovered = []
for (const [pid, { image = '(not read)', command = '(not read)' }] of processes) {
  const name = base(image)
  if (hooked.has(pid)) covered.hook += 1
  else if (/--type=/.test(command)) covered.chromiumHelper += 1
  else if (NODE_LIKE.test(name)) unhooked.push({ pid, name, command: command.slice(0, 160) })
  else if (NO_NETWORK.has(name)) covered.noNetwork += 1
  else notCovered.push({ pid, name, command: command.slice(0, 160) })
}

// Chromium writes one log per app run. The pattern is an address, so a stray number can't match.
const address = new RegExp(`(?:localhost|127\\.0\\.0\\.1|\\[::1\\]):${watch}(?!\\d)`, 'g')
const netLogs = fs.readdirSync(dir).filter(name => /^net-.*\.json$/.test(name))
const netHits = []
const unreadable = []
let appRuns = 0
for (const name of netLogs) {
  const text = read(name)
  if (!text.includes('"constants"')) unreadable.push(name)
  else appRuns += 1
  const found = text.match(address)
  if (found) netHits.push({ name, count: found.length })
}

const tcp = lines('tcp.log').map(line => {
  const [time, pid, localPort, state, where, image] = line.split('\t')
  return { time, pid, localPort, state, where, image: base(image) }
})
// Asked of the system at the moment the row was seen. A pid alone can't say: Windows reuses them, so another
// program can hold a pid that a process in the job had earlier.
const inJob = tcp.filter(row => row.where === 'in-job')
const outside = tcp.filter(row => row.where === 'outside')
const cantTell = tcp.filter(row => row.where === 'unknown')
const [reads, longestGapMs] = read('tcp-reads.txt').trim().split(' ').map(Number)

const count = (list, key) => Object.entries(Object.groupBy(list, key)).map(([name, rows]) => `${name} ${rows.length}`).join(', ')
const ports = new Set(connects.map(entry => entry.port))

console.log(`watched port ${watch}, command exit code ${read('exit-code.txt').trim()}`)
console.log(`processes in the job: ${processes.size}: ${count([...processes.values()], entry => base(entry.image ?? '(not read)'))}`)
console.log(`  connect-log loaded in ${covered.hook}, Chromium helpers ${covered.chromiumHelper}, programs with no network use ${covered.noNetwork}`)
console.log(`  Electron or Node with no connect-log and no helper flag: ${unhooked.length}`)
for (const entry of unhooked) console.log(`    ${entry.pid} ${entry.name} ${entry.command}`)
console.log(`  other programs, seen only by the table: ${notCovered.length}`)
for (const entry of notCovered) console.log(`    ${entry.pid} ${entry.name} ${entry.command}`)
console.log(`Node connections: ${connects.length} to ${ports.size} ports; to ${watch}: ${nodeHits.length}`)
for (const entry of nodeHits.slice(0, 20)) console.log(`    pid ${entry.pid} ${entry.host}:${entry.port}`)
console.log(`Chromium net logs: ${appRuns} read, ${unreadable.length} not finished; with ${watch} in them: ${netHits.length}`)
for (const entry of netHits.slice(0, 20)) console.log(`    ${entry.name}: ${entry.count} mentions`)
console.log(`Connection table: read ${reads} times, longest gap ${longestGapMs} ms`)
console.log(`Connection table, in the job, to ${watch}: ${inJob.length}`)
for (const row of inJob.slice(0, 20)) console.log(`    ${row.time} pid ${row.pid} ${row.image} state ${row.state}`)
console.log(`Connection table, outside the job, to ${watch}: ${outside.length}${outside.length ? `: ${count(outside, row => row.image)}` : ''}`)
console.log(`Connection table, owner gone before it could be asked, to ${watch}: ${cantTell.length}`)
for (const row of cantTell.slice(0, 20)) console.log(`    ${row.time} pid ${row.pid} ${row.image}`)

const touched = nodeHits.length + netHits.length + inJob.length
if (touched) {
  console.log(`RESULT: the run touched ${watch}`)
  process.exit(1)
}
if (!processes.size || !hooked.size || !appRuns || !reads || cantTell.length) {
  console.log(`RESULT: nothing found, but it can't be trusted: ${cantTell.length} rows with no owner to ask, or an empty record`)
  process.exit(2)
}
console.log(`RESULT: no record shows the run touching ${watch}`)
