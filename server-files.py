# File operations on your server for the hub's Server > Files view. files.mjs runs this
# over ssh (the code travels base64 in argv, the request as JSON on stdin), so nothing is
# installed on the server. Prints one JSON object, or the raw bytes for "raw".
import json, os, re, shutil, sys, time

ROOT = '/root'
# Folders that can be browsed but never changed from the hub: these plus hub.json server.readOnly.
READONLY = ['/root/.ssh']
TRASH = '/root/.hub-trash'
SKIP = {'node_modules', '.git', '.next', '.turbo', '.venv', '__pycache__', '.cache'}
TEXT_LIMIT = 1 << 20


class Fail(Exception):
    def __init__(self, msg, code=400):
        super().__init__(msg)
        self.code = code


# Files that hold keys or sign-ins (same list as files.mjs holdsKeys). They're hidden from lists
# and search and refused for every op, checked on the path and on where it really points.
KEY_NAMES = re.compile(r'^(secrets\.json|\.credentials\.json|\.claude\.json(\.backup.*)?|auth\.json|\.git-credentials|\.npmrc|\.yarnrc(\.yml)?|_?\.?netrc|\.pypirc|\.pgpass|\.env(\.(?!example$|sample$|template$).+)?|\.envrc|\.dev\.vars|(?!.*[._-](example|sample|template)\.env$).+\.env|(.+[._-])?private\.key|.+\.(pem|p12|pfx|ppk|jks|keystore|kdbx)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.infisical.*|login data( for account)?|cookies|web data|local state|access_tokens\.db|credentials\.db|credentials\.tfrc\.json)$', re.I)
KEY_DIRS = {'.ssh', '.aws', '.azure', '.gnupg', '.kube', '.infisical', 'gcloud', '.wrangler', '.vercel'}
# A folder and what's inside it. The hub sends its own config's keyDirs and keyPairs on top of these.
KEY_PAIRS = [('local-hub', 'data'), ('local-hub', 'config'), ('quartzi-hub', 'data'), ('quartzi-hub', 'config'), ('.docker', 'config.json'), ('gh', 'hosts.yml')]


def holds_keys(p):
    segs = [s.lower() for s in p.split('/') if s]
    if segs and KEY_NAMES.match(segs[-1]):
        return True
    if any(s in KEY_DIRS for s in segs):
        return True
    return any(segs[i] == a and segs[i + 1] == b for i in range(len(segs) - 1) for a, b in KEY_PAIRS)


def hidden_key(p):
    return holds_keys(p) or holds_keys(os.path.realpath(p))


def full(rel):
    p = os.path.normpath(os.path.join(ROOT, rel or '.'))
    if p != ROOT and not p.startswith(ROOT + '/'):
        raise Fail('outside the server folder')
    if hidden_key(p):
        raise Fail('This file holds keys, so the hub won’t open it', 403)
    return p


def rel(p):
    r = os.path.relpath(p, ROOT)
    return '' if r == '.' else r


def writable(p):
    if hidden_key(p):
        raise Fail('This file holds keys, so the hub won’t open it', 403)
    real = os.path.realpath(p)
    for ro in READONLY:
        for x in (p, real):
            if x == ro or x.startswith(ro + '/'):
                raise Fail(f'{ro} is read-only from the hub')
    return p


def item(r):
    p = full(r)
    if p == ROOT:
        raise Fail('the server folder itself can’t be changed')
    return writable(p)


def name_ok(n):
    n = str(n or '').strip()
    if not n or n in ('.', '..') or '/' in n or '\0' in n or len(n) > 255:
        raise Fail('That name isn’t allowed')
    return n


def absent(p):
    if os.path.lexists(p):
        raise Fail(f'“{os.path.basename(p)}” already exists there', 409)


def entry(p, name, with_path=False):
    if hidden_key(p):
        return None
    try:
        s = os.stat(p)
    except OSError:
        return None
    is_dir = os.path.isdir(p)
    e = {'name': name, 'dir': is_dir, 'size': s.st_size, 'mtime': s.st_mtime * 1000, 'link': os.path.islink(p)}
    if is_dir:
        try:
            e['count'] = len([n for n in os.listdir(p) if not n.startswith('.')])
        except OSError:
            e['count'] = None
    if with_path:
        e['path'] = rel(p)
    return e


def op_list(a):
    d = full(a.get('path'))
    names = sorted((n for n in os.listdir(d) if not n.startswith('.')))
    entries = [e for e in (entry(os.path.join(d, n), n) for n in names) if e]
    entries.sort(key=lambda e: (not e['dir'], e['name'].lower()))
    return {'root': ROOT, 'path': rel(d), 'entries': entries}


def op_search(a):
    d, q = full(a.get('path')), str(a.get('q', '')).lower()
    # Hidden names match only when the query itself starts with a dot.
    hidden_ok = q.startswith('.')
    out, deadline = [], time.time() + 4
    for top, dirs, files in os.walk(d):
        names = sorted(dirs) + sorted(files)
        dirs[:] = sorted(x for x in dirs if not x.startswith('.') and x not in SKIP and not os.path.islink(os.path.join(top, x)) and not holds_keys(os.path.join(top, x)))
        for n in names:
            if (hidden_ok or not n.startswith('.')) and q in n.lower():
                e = entry(os.path.join(top, n), n, True)
                if e:
                    out.append(e)
        if len(out) >= 200 or time.time() > deadline:
            return {'results': out[:200], 'partial': True}
    return {'results': out, 'partial': False}


def op_mkdir(a):
    p = writable(os.path.join(full(a.get('path')), name_ok(a.get('name'))))
    absent(p)
    os.mkdir(p)
    return {'path': rel(p)}


def op_rename(a):
    src = item(a.get('path'))
    dst = writable(os.path.join(os.path.dirname(src), name_ok(a.get('name'))))
    if dst != src:
        absent(dst)
        os.rename(src, dst)
    return {'path': rel(dst)}


def op_move(a):
    dest = writable(full(a.get('to')))
    if not os.path.isdir(dest):
        raise Fail('Move target isn’t a folder')
    moved = []
    for r in a.get('paths') or []:
        src = item(r)
        if dest == src or dest.startswith(src + '/'):
            raise Fail(f'Can’t move “{os.path.basename(src)}” into itself')
        dst = os.path.join(dest, os.path.basename(src))
        if dst == src:
            continue
        absent(dst)
        shutil.move(src, dst)
        moved.append(rel(dst))
    return {'moved': moved}


def op_delete(a):
    # Nothing is erased: items move to /root/.hub-trash/<time>/ and can be moved back.
    bin_ = os.path.join(TRASH, time.strftime('%Y%m%d-%H%M%S'))
    srcs = [item(r) for r in a.get('paths') or []]
    if not srcs:
        raise Fail('Nothing to delete')
    os.makedirs(bin_, exist_ok=True)
    for src in srcs:
        shutil.move(src, os.path.join(bin_, os.path.basename(src)))
    return {'deleted': [rel(s) for s in srcs], 'trash': bin_}


def op_text(a):
    p = full(a.get('path'))
    s = os.stat(p)
    if s.st_size > TEXT_LIMIT:
        raise Fail('Too big to edit here (over 1 MB)')
    data = open(p, 'rb').read()
    if b'\0' in data:
        raise Fail('Not a text file')
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        raise Fail('Not a UTF-8 text file')
    return {'text': text, 'mtime': s.st_mtime * 1000, 'size': s.st_size}


def op_write(a):
    p = writable(full(a.get('path')))
    if a.get('mtime') and os.path.exists(p) and abs(os.stat(p).st_mtime * 1000 - a['mtime']) > 2:
        raise Fail('The file changed since you opened it', 409)
    tmp = p + '.hub-tmp'
    with open(tmp, 'w', encoding='utf-8', newline='') as f:
        f.write(a.get('text', ''))
    if os.path.exists(p):
        shutil.copymode(p, tmp)
    os.replace(tmp, p)
    return {'mtime': os.stat(p).st_mtime * 1000}


def op_stat(a):
    p = full(a.get('path'))
    e = entry(p, os.path.basename(p))
    if not e:
        raise Fail('Not found', 404)
    return e


a = json.load(sys.stdin)
# Your own read-only folders and key folders (hub.json) come with the request.
conf = a.pop('conf', None) or {}
READONLY += [str(x) for x in conf.get('readOnly', []) if str(x) not in READONLY]
KEY_DIRS |= {str(x).lower() for x in conf.get('keyDirs', [])}
KEY_PAIRS += [(str(x[0]).lower(), str(x[1]).lower()) for x in conf.get('keyPairs', [])]
if a.get('op') == 'raw':
    with open(full(a.get('path')), 'rb') as f:
        shutil.copyfileobj(f, sys.stdout.buffer, 1 << 20)
    raise SystemExit
try:
    out = globals()['op_' + a['op']](a)
except Fail as e:
    out = {'error': str(e), 'code': e.code}
except FileNotFoundError as e:
    out = {'error': f'Not found: {os.path.basename(e.filename or "")}', 'code': 404}
except OSError as e:
    out = {'error': e.strerror or str(e), 'code': 409}
print(json.dumps(out))
