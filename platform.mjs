// What differs between Windows, Mac and Linux, in one place. Everything else in the hub is plain Node.
import { existsSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const IS_WIN = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'
export const OS_NAME = IS_WIN ? 'Windows' : IS_MAC ? 'Mac' : 'Linux'
const HOME = os.homedir()

// The word for this computer's own tools, for messages.
export const FILE_MANAGER = IS_WIN ? 'File Explorer' : IS_MAC ? 'Finder' : 'your file manager'
export const TRASH_NAME = IS_WIN ? 'the Recycle Bin' : 'the Trash'
export const PC_NAME = IS_WIN ? 'This PC' : 'This Computer'
export const ROOT_DISK = IS_WIN ? 'C:/' : '/'
export const ICLOUD = IS_MAC ? path.join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs') : path.join(HOME, 'iCloudDrive')
export const PYTHON = IS_WIN ? 'python' : 'python3'

export function onPath(name) {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of IS_WIN ? ['.exe', '.cmd', ''] : ['']) {
      const p = path.join(dir, name + ext)
      if (existsSync(p)) return p
    }
  }
  return ''
}
const firstOf = (...list) => list.find(p => p && existsSync(p)) || ''

export const tailscalePath = () => firstOf(
  ...(IS_WIN ? ['C:/Program Files/Tailscale/tailscale.exe'] : IS_MAC ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale'] : []),
  onPath('tailscale'),
)
export const mutagenPath = () => firstOf(
  ...(IS_WIN ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'mutagen', 'mutagen.exe')] : []),
  onPath('mutagen'),
)

/* ---------- what is listening on this computer ---------- */

const LISTENERS_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$procs = @{}
Get-CimInstance Win32_Process | ForEach-Object { $procs[[int]$_.ProcessId] = $_ }
Get-NetTCPConnection -State Listen | Sort-Object LocalPort -Unique | ForEach-Object {
    $p = $procs[[int]$_.OwningProcess]
    [pscustomobject]@{ port = $_.LocalPort; bind = $_.LocalAddress; pid = $_.OwningProcess;
      process = if ($p) { $p.Name -replace '\\.exe$','' } else { '' };
      cmd = if ($p) { $p.CommandLine } else { '' } }
  } | ConvertTo-Json -Compress`

const splitAddr = a => { const i = a.lastIndexOf(':'); return [a.slice(0, i).replace(/^\[|\]$/g, ''), Number(a.slice(i + 1))] }

// lsof -F prints one field per line: p<pid>, c<command>, n<address>.
export function parseLsof(text) {
  const rows = new Map()
  let pid = 0, name = ''
  for (const line of String(text).split('\n')) {
    const v = line.slice(1).trim()
    if (line[0] === 'p') pid = Number(v)
    else if (line[0] === 'c') name = v
    else if (line[0] === 'n') {
      const [bind, port] = splitAddr(v)
      if (port && !rows.has(port)) rows.set(port, { port, bind, pid, process: name, cmd: '' })
    }
  }
  return [...rows.values()]
}
// ss -ltnp, for a Linux without lsof: LISTEN 0 511 127.0.0.1:3100 0.0.0.0:* users:(("node",pid=12,fd=18))
export function parseSs(text) {
  const rows = new Map()
  for (const line of String(text).split('\n')) {
    const f = line.trim().split(/\s+/)
    if (f[0] !== 'LISTEN' || !f[3]) continue
    const [bind, port] = splitAddr(f[3])
    const who = /users:\(\("([^"]+)",pid=(\d+)/.exec(line)
    if (port && !rows.has(port)) rows.set(port, { port, bind, pid: who ? Number(who[2]) : 0, process: who ? who[1] : '', cmd: '' })
  }
  return [...rows.values()]
}

// [{ port, bind, pid, process, cmd }], or { error } when this computer can't say.
export async function listeners(run) {
  if (IS_WIN) {
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', LISTENERS_PS])
    if (!r.ok && !r.stdout) return { error: r.stderr.slice(0, 300) }
    let rows = []
    try { rows = JSON.parse(r.stdout || '[]') } catch {}
    return Array.isArray(rows) ? rows : [rows]
  }
  let rows = null
  const l = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'])
  if (l.stdout) rows = parseLsof(l.stdout)
  if (!rows) {
    const s = await run('ss', ['-ltnp'])
    if (!s.ok) return { error: 'Listing services here needs lsof or ss' }
    rows = parseSs(s.stdout)
  }
  const pids = [...new Set(rows.map(x => x.pid).filter(Boolean))]
  if (pids.length) {
    const ps = await run('ps', ['-o', 'pid=,args=', '-p', pids.join(',')])
    const cmds = new Map(String(ps.stdout || '').split('\n').map(line => /^\s*(\d+)\s+(.*)$/.exec(line)).filter(Boolean).map(m => [Number(m[1]), m[2]]))
    for (const x of rows) x.cmd = cmds.get(x.pid) || ''
  }
  return rows
}

/* ---------- drives ---------- */

const DRIVES_PS = `Get-Volume | ? DriveLetter | Sort DriveLetter | % { [pscustomobject]@{ letter = [string]$_.DriveLetter; label = $_.FileSystemLabel; type = [string]$_.DriveType; size = $_.Size; free = $_.SizeRemaining } } | ConvertTo-Json -Compress`

const roomOn = dir => statfs(dir).then(s => ({ size: s.blocks * s.bsize, free: s.bavail * s.bsize }), () => ({ size: 0, free: 0 }))

// The top of the Files tab: drive letters on Windows; your home folder and the whole disk elsewhere.
// POSIX_ROOTS maps those ids to folders. Mounted disks are under /Volumes, /mnt or /media in "Computer".
export const POSIX_ROOTS = { Home: HOME, Computer: '/' }
export async function listDrives(run) {
  if (IS_WIN) {
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DRIVES_PS], { timeout: 20_000 })
    if (!r.ok) throw new Error(r.stderr.trim().split('\n')[0] || 'Couldn’t list drives')
    return [].concat(JSON.parse(r.stdout || '[]')).filter(d => d.size).map(d => ({ ...d, id: `${d.letter}:` }))
  }
  return [
    { id: 'Home', label: 'Home', type: 'Fixed', ...(await roomOn(HOME)) },
    { id: 'Computer', label: 'Computer', type: 'Fixed', ...(await roomOn('/')) },
  ]
}

/* ---------- the bin: nothing is ever deleted for good ---------- */

// Paths travel on stdin, never inside the command.
const RECYCLE_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
$paths = [Console]::In.ReadToEnd() | ConvertFrom-Json
foreach ($p in $paths) {
  if (Test-Path -LiteralPath $p -PathType Container) {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
  } else {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
  }
}`

// Returns an error message, or '' when every item went to the bin. No bin on this computer means no delete.
export async function moveToTrash(run, items) {
  if (IS_WIN) {
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', RECYCLE_PS], { input: JSON.stringify(items) })
    return r.ok ? '' : r.stderr.trim().split('\n')[0] || 'Delete failed'
  }
  const tool = IS_MAC ? firstOf('/usr/bin/trash', onPath('trash')) : ''
  const cmd = tool ? [tool, []] : onPath('gio') ? ['gio', ['trash', '--']] : onPath('trash-put') ? ['trash-put', ['--']] : null
  if (!cmd) return `This computer has no trash command (${IS_MAC ? 'macOS 14 or newer has one' : 'install gio or trash-cli'}), so the hub won’t delete. Use ${FILE_MANAGER}.`
  const r = await run(cmd[0], [...cmd[1], ...items])
  return r.ok ? '' : r.stderr.trim().split('\n')[0] || 'Delete failed'
}
