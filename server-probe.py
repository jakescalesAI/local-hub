# Runs on your server (piped over ssh by server.mjs). Prints one JSON object:
# every TCP listener with its unit, folder, branch and an HTTP probe, plus machine health.
import json, os, re, subprocess, urllib.request

SKIP_ABOVE = 30000  # Claude Code / Chrome internal ports


def unit_of(pid):
    try:
        cg = open(f'/proc/{pid}/cgroup').read().strip().split('::')[-1]
    except OSError:
        return ''
    return cg.rstrip('/').split('/')[-1]


def cwd_of(pid):
    try:
        return os.readlink(f'/proc/{pid}/cwd')
    except OSError:
        return ''


def branch_of(path):
    if not path or path == '/':
        return ''
    r = subprocess.run(['git', '-C', path, 'rev-parse', '--abbrev-ref', 'HEAD'], capture_output=True, text=True, timeout=3)
    return r.stdout.strip() if r.returncode == 0 else ''


def probe(port, paths):
    for path in paths:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}', timeout=1.5) as res:
                body = res.read(65536).decode('utf-8', 'replace')
                m = re.search(r'<title[^>]*>([^<]*)</title>', body, re.I)
                return {'code': res.status, 'path': path, 'title': (m.group(1).strip() if m else '')}
        except urllib.error.HTTPError as e:
            if path == paths[-1]:
                return {'code': e.code, 'path': paths[0], 'title': ''}
        except Exception:
            return {'code': 0, 'path': paths[0], 'title': ''}
    return {'code': 0, 'path': paths[0], 'title': ''}


def kind_of(unit, cwd):
    if unit.startswith('dev@'):
        return 'dev'
    if unit.startswith('session-') and unit.endswith('.scope'):
        return 'session'
    # PRODUCTION comes from hub.json server.production, written above this script by server.mjs.
    conf = globals().get('PRODUCTION') or {}
    if any(unit.startswith(u) for u in conf.get('units', [])) or any(cwd.startswith(p) for p in conf.get('paths', [])):
        return 'production'
    return 'other'


services = {}
ss = subprocess.run(['ss', '-ltnpH'], capture_output=True, text=True).stdout
for line in ss.splitlines():
    parts = line.split()
    if len(parts) < 4:
        continue
    host, _, port = parts[3].rpartition(':')
    port = int(port)
    if port < 1024 or port >= SKIP_ABOVE or port in services:
        continue
    m = re.search(r'\("([^"]+)",pid=(\d+)', line)
    if not m:
        continue
    proc, pid = m.group(1), int(m.group(2))
    unit = unit_of(pid)
    cwd = cwd_of(pid)
    kind = kind_of(unit, cwd)
    paths = ['/']
    if cwd.endswith('apps/workspace'):
        paths = ['/workspace/_app/', '/']
    info = probe(port, paths)
    services[port] = {
        'port': port, 'bind': host.strip('[]'), 'process': proc, 'pid': pid, 'unit': unit,
        'cwd': cwd, 'branch': branch_of(cwd) if kind in ('dev', 'session') else '', 'kind': kind, **info,
    }

mem = {}
for line in open('/proc/meminfo'):
    k, v = line.split(':')
    mem[k] = int(v.split()[0]) * 1024
load = open('/proc/loadavg').read().split()[:3]
uptime = float(open('/proc/uptime').read().split()[0])
disk = os.statvfs('/')
print(json.dumps({
    'services': sorted(services.values(), key=lambda s: s['port']),
    'health': {
        'cores': os.cpu_count(), 'load': [float(x) for x in load], 'uptime': uptime,
        'memTotal': mem['MemTotal'], 'memAvailable': mem['MemAvailable'],
        'swapTotal': mem.get('SwapTotal', 0), 'swapFree': mem.get('SwapFree', 0),
        'diskTotal': disk.f_blocks * disk.f_frsize, 'diskFree': disk.f_bavail * disk.f_frsize,
    },
}))
