// Cloud tab back end: Coolify deploys, live servers (manual list + Coolify + AWS + Azure),
// Cloudflare and active clients. Read-only everywhere. Keys come from secrets.json (or the
// Coolify MCP entry / wrangler login as fallbacks) and never leave this process: every response
// is whitelisted to names, statuses, URLs, IPs and times, then scrubbed of known secret values.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import tls from 'node:tls'
import crypto from 'node:crypto'
import { configPath } from './config.mjs'

const TTL = 60_000 // provider results are reused for this long
const MIN_FORCE = 10_000 // a forced refresh sooner than this returns the current state
const T = 10_000 // per-request timeout
const PROVIDER_T = 30_000 // whole-provider ceiling (Coolify makes one deploy call per app)
const HOME = os.homedir()
const CLAUDE_JSON = path.join(HOME, '.claude.json')
const WRANGLER = path.join(HOME, '.wrangler', 'config', 'default.toml')
const SSH_CONFIG = path.join(HOME, '.ssh', 'config')

/* ---------- small helpers ---------- */

const readJsonFile = (file, fallback) => readFile(file, 'utf8').then(JSON.parse).catch(() => fallback)
const str = v => (v == null ? '' : String(v))
const lower = v => str(v).toLowerCase()

// Coolify mixes "2026-10-30 18:12:27" (UTC, no zone) and ISO strings.
function toMs(v) {
  if (!v) return 0
  const s = String(v)
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z')
  return Number.isFinite(t) ? t : 0
}

function shortError(e) {
  if (!e) return 'failed'
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'timed out after 10 s'
  const code = e.cause?.code
  const words = { ENOTFOUND: 'DNS name not found', ECONNREFUSED: 'connection refused', ECONNRESET: 'connection reset', ETIMEDOUT: 'connection timed out', EHOSTUNREACH: 'host unreachable', CERT_HAS_EXPIRED: 'certificate expired' }
  if (code && e.message === 'fetch failed') return words[code] || (/SSL|TLS/i.test(code) ? 'TLS handshake failed' : code)
  return (code ? `${e.message} (${code})` : e.message || String(e)).slice(0, 200)
}

async function getJson(url, opts = {}) {
  let res
  try {
    res = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout || T) })
  } catch (e) {
    throw new Error(shortError(e))
  }
  const text = await res.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {}
  if (!res.ok) {
    // Only short, known error fields; never the raw body.
    const msg = body?.errors?.[0]?.message || body?.message || body?.error?.message || (typeof body?.error === 'string' ? body.error : '')
    const err = new Error(`HTTP ${res.status}${msg ? ` · ${String(msg).slice(0, 120)}` : ''}`)
    err.status = res.status
    throw err
  }
  return body ?? text
}

function withTimeout(promise, ms, label) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} took longer than ${ms / 1000} s`)), ms)
      timer.unref?.()
    }),
  ]).finally(() => clearTimeout(timer))
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++
        out[k] = await fn(items[k], k)
      }
    }),
  )
  return out
}

function tcpCheck(host, port, timeout = 4000) {
  return new Promise(resolve => {
    const t0 = Date.now()
    const sock = net.connect({ host, port })
    const done = ok => {
      sock.destroy()
      resolve({ port, ok, ms: ok ? Date.now() - t0 : 0 })
    }
    sock.setTimeout(timeout, () => done(false))
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
  })
}

function tlsCheck(host, timeout = 8000) {
  return new Promise(resolve => {
    let settled = false
    const finish = v => {
      if (settled) return
      settled = true
      sock.destroy()
      resolve(v)
    }
    const sock = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false })
    sock.setTimeout(timeout, () => finish({ tlsError: 'TLS timed out' }))
    sock.once('secureConnect', () => {
      const cert = sock.getPeerCertificate()
      const exp = cert?.valid_to ? Date.parse(cert.valid_to) : 0
      finish({
        tlsDays: exp ? Math.floor((exp - Date.now()) / 86_400_000) : null,
        tlsExpires: exp || 0,
        tlsValid: sock.authorized,
        tlsError: sock.authorized ? '' : str(sock.authorizationError),
      })
    })
    sock.once('error', e => finish({ tlsError: e.code || 'TLS failed' }))
  })
}

async function httpsCheck(host) {
  const t0 = Date.now()
  const out = { domain: host, code: 0, ms: 0, error: '' }
  try {
    const res = await fetch(`https://${host}/`, { redirect: 'manual', signal: AbortSignal.timeout(T) })
    out.code = res.status
    out.ms = Date.now() - t0
    res.body?.cancel?.().catch(() => {})
  } catch (e) {
    out.error = shortError(e)
  }
  return { ...out, ...(await tlsCheck(host)) }
}

/* ---------- AWS SigV4 + a tiny XML reader ---------- */

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex')
const hmac = (key, s, enc) => crypto.createHmac('sha256', key).update(s).digest(enc)
const awsEnc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())

export function sigv4({ method = 'GET', host, pathname = '/', query = {}, headers = {}, body = '', region, service, accessKeyId, secretAccessKey, sessionToken, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const qs = Object.keys(query).sort().map(k => `${awsEnc(k)}=${awsEnc(query[k])}`).join('&')
  const h = {}
  for (const [k, v] of Object.entries({ ...headers, host, 'x-amz-date': amzDate, ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}) }))
    h[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ')
  const names = Object.keys(h).sort()
  const signedHeaders = names.join(';')
  const canonical = [method, pathname, qs, names.map(n => `${n}:${h[n]}\n`).join(''), signedHeaders, sha256(body)].join('\n')
  const scope = `${day}/${region}/${service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')
  const kSign = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, day), region), service), 'aws4_request')
  const signature = hmac(kSign, toSign, 'hex')
  const outHeaders = { ...h }
  delete outHeaders.host // fetch sets it
  outHeaders.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return { url: `https://${host}${pathname}${qs ? '?' + qs : ''}`, headers: outHeaders, signature }
}

function parseXml(s) {
  const root = { name: '#root', kids: [], text: '' }
  const stack = [root]
  const re = /<(\/?)([A-Za-z_][\w:.-]*)[^>]*?(\/?)>|([^<]+)/g
  const decode = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  let m
  while ((m = re.exec(s))) {
    const top = stack[stack.length - 1]
    if (m[4] !== undefined) top.text += decode(m[4])
    else if (m[1]) stack.length > 1 && stack.pop()
    else {
      const node = { name: m[2], kids: [], text: '' }
      top.kids.push(node)
      if (!m[3]) stack.push(node)
    }
  }
  return root
}
const kid = (n, name) => n?.kids.find(k => k.name === name)
const kids = (n, name) => (n ? n.kids.filter(k => k.name === name) : [])
const ktext = (n, name) => kid(n, name)?.text.trim() || ''

/* ---------- the tab ---------- */

export function create({ run, sshHost, here }) {
  const FILES = {
    secrets: configPath('secrets.json'),
    servers: configPath('servers.json'),
    clients: configPath('clients.json'),
  }
  const CACHE = path.join(here, 'data', 'cloud-cache.json')
  let state = { at: 0 }
  let inflight = null
  let secretValues = []

  // Last good snapshot (already scrubbed) so the tab has something to show right after a restart.
  readFile(CACHE, 'utf8')
    .then(t => {
      if (!state.at) state = { ...JSON.parse(t), cached: true }
    })
    .catch(() => {})

  function scrub(text) {
    let out = text
    for (const v of secretValues) if (v && v.length >= 6) out = out.split(v).join('[redacted]')
    return out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
  }
  const snapshot = () => JSON.parse(scrub(JSON.stringify({ ...state, refreshing: !!inflight })))

  /* ----- credentials ----- */

  async function coolifyCreds(sec) {
    const c = sec.coolify || {}
    if (c.url && c.token) return { url: c.url, token: c.token, from: 'secrets.json' }
    const cj = await readJsonFile(CLAUDE_JSON, {})
    const pools = [cj.mcpServers, ...Object.values(cj.projects || {}).map(p => p?.mcpServers)]
    for (const pool of pools)
      for (const [name, s] of Object.entries(pool || {}))
        if (/coolify/i.test(name) && s?.env?.COOLIFY_URL && s?.env?.COOLIFY_TOKEN)
          return { url: s.env.COOLIFY_URL, token: s.env.COOLIFY_TOKEN, from: 'Coolify MCP entry in ~/.claude.json' }
    return null
  }

  async function cloudflareCreds(sec) {
    const c = sec.cloudflare || {}
    if (c.apiToken) return { token: c.apiToken, accountId: c.accountId || '', from: 'secrets.json' }
    const toml = await readFile(WRANGLER, 'utf8').catch(() => '')
    const token = /^\s*oauth_token\s*=\s*"([^"]+)"/m.exec(toml)?.[1] || ''
    const exp = toMs(/^\s*expiration_time\s*=\s*"([^"]+)"/m.exec(toml)?.[1])
    if (token && exp > Date.now() + 60_000) return { token, accountId: c.accountId || '', from: 'wrangler login', expires: exp }
    return { missing: true, wrangler: token ? { expired: exp } : null }
  }

  /* ----- Coolify ----- */

  async function coolify(sec) {
    const creds = await coolifyCreds(sec)
    if (!creds)
      return {
        status: 'connect',
        connect: {
          name: 'Coolify',
          fields: ['coolify.url', 'coolify.token'],
          where: 'Coolify → Keys & Tokens → API tokens (read-only), or add the Coolify MCP server',
          url: '',
        },
      }
    secretValues.push(creds.token)
    const base = creds.url.replace(/\/+$/, '').replace(/\/api(\/v1)?$/, '')
    const headers = { authorization: `Bearer ${creds.token}`, accept: 'application/json' }
    const get = p => getJson(base + p, { headers })
    const soft = p => get(p).then(v => ({ v }), e => ({ e: shortError(e) }))

    const [version, servers, apps, services, databases, running, projects] = await Promise.all([
      soft('/api/v1/version'),
      soft('/api/v1/servers'),
      get('/api/v1/applications'), // required: the section errors without it
      soft('/api/v1/services'),
      soft('/api/v1/databases'),
      soft('/api/v1/deployments'),
      soft('/api/v1/projects'),
    ])

    // environment id -> project + environment, for grouping and Coolify UI links.
    const envs = {}
    const projectList = Array.isArray(projects.v) ? projects.v : []
    await mapLimit(projectList, 5, async p => {
      try {
        const d = await get(`/api/v1/projects/${p.uuid}`)
        for (const e of d.environments || []) envs[e.id] = { project: str(p.name), projectUuid: p.uuid, env: str(e.name), envUuid: e.uuid }
      } catch {}
    })
    const consoleUrl = (envId, kind, uuid) => {
      const e = envs[envId]
      return e?.envUuid ? `${base}/project/${e.projectUuid}/environment/${e.envUuid}/${kind}/${uuid}` : `${base}/projects`
    }

    const appList = (Array.isArray(apps) ? apps : []).map(a => {
      const fqdns = str(a.fqdn)
        .split(',')
        .map(u => u.trim())
        .filter(Boolean)
        .map(u => {
          try {
            const x = new URL(u)
            if ((x.protocol === 'https:' && (x.port === '80' || x.port === '443')) || (x.protocol === 'http:' && x.port === '80')) x.port = ''
            return x.origin
          } catch {
            return ''
          }
        })
        .filter(Boolean)
      const [st, health] = str(a.status).split(':')
      return {
        uuid: str(a.uuid),
        name: str(a.name),
        project: envs[a.environment_id]?.project || '',
        env: envs[a.environment_id]?.env || '',
        status: str(a.status),
        state: st || 'unknown',
        health: health || '',
        fqdns,
        url: fqdns[0] || '',
        server: str(a.destination?.server?.name),
        branch: str(a.git_branch),
        buildPack: str(a.build_pack),
        lastOnline: toMs(a.last_online_at),
        updated: toMs(a.updated_at),
        console: consoleUrl(a.environment_id, 'application', a.uuid),
        deploy: null,
      }
    })

    // Latest deployment per app (Coolify 4.x: /deployments/applications/{uuid}?take=1).
    let deploysEndpoint = true
    await mapLimit(appList, 6, async a => {
      if (!deploysEndpoint) return
      try {
        const r = await getJson(`${base}/api/v1/deployments/applications/${a.uuid}?take=1`, { headers, timeout: 8000 })
        const d = (Array.isArray(r) ? r : r?.deployments || [])[0]
        if (d)
          a.deploy = {
            status: str(d.status),
            at: toMs(d.created_at),
            finished: toMs(d.finished_at),
            commit: str(d.commit).slice(0, 7),
            restartOnly: !!d.restart_only,
          }
      } catch (e) {
        if (e.status === 404) deploysEndpoint = false
      }
    })

    const coolifyHost = (() => {
      try {
        return new URL(base).hostname
      } catch {
        return ''
      }
    })()
    const serverList = (Array.isArray(servers.v) ? servers.v : []).map(s => ({
      uuid: str(s.uuid),
      name: str(s.name),
      ip: s.ip === 'host.docker.internal' ? coolifyHost : str(s.ip),
      port: Number(s.port) || 22,
      reachable: !!s.is_reachable,
      usable: !!s.is_usable,
      coolifyHost: !!s.is_coolify_host,
      console: `${base}/server/${s.uuid}`,
    }))

    const resource = kind => x => {
      const [st, health] = str(x.status).split(':')
      return {
        uuid: str(x.uuid),
        name: str(x.name),
        kind,
        type: str(x.database_type || x.type || x.service_type || '').replace(/^standalone-/, ''),
        project: envs[x.environment_id]?.project || '',
        status: str(x.status),
        state: st || 'unknown',
        health: health || '',
        console: consoleUrl(x.environment_id, kind, x.uuid),
      }
    }

    return {
      status: 'ok',
      url: base,
      from: creds.from,
      version: typeof version.v === 'string' ? version.v : str(version.v?.version),
      projects: projectList.map(p => str(p.name)),
      apps: appList,
      services: (Array.isArray(services.v) ? services.v : []).map(resource('service')),
      databases: (Array.isArray(databases.v) ? databases.v : []).map(resource('database')),
      servers: serverList,
      running: (Array.isArray(running.v) ? running.v : []).map(d => ({
        app: str(d.application_name),
        server: str(d.server_name),
        status: str(d.status),
        at: toMs(d.created_at),
      })),
      deploysEndpoint,
      partErrors: Object.fromEntries(
        Object.entries({ version, servers, services, databases, deployments: running, projects }).filter(([, r]) => r.e).map(([k, r]) => [k, r.e]),
      ),
    }
  }

  /* ----- AWS EC2 ----- */

  async function aws(sec) {
    const a = sec.aws || {}
    if (!a.accessKeyId || !a.secretAccessKey)
      return {
        status: 'connect',
        connect: {
          name: 'AWS',
          fields: ['aws.accessKeyId', 'aws.secretAccessKey', 'aws.regions'],
          where: 'AWS console → IAM → Users → (user) → Security credentials → Create access key; attach AmazonEC2ReadOnlyAccess',
          url: 'https://console.aws.amazon.com/iam/home#/users',
        },
      }
    secretValues.push(a.secretAccessKey, a.sessionToken)
    const regions = Array.isArray(a.regions) && a.regions.length ? a.regions : ['us-east-1']
    const perRegion = await Promise.all(
      regions.map(async region => {
        const instances = []
        try {
          let next = ''
          for (let page = 0; page < 5; page++) {
            const query = { Action: 'DescribeInstances', Version: '2016-11-15', ...(next ? { NextToken: next } : {}) }
            const signed = sigv4({ host: `ec2.${region}.amazonaws.com`, query, region, service: 'ec2', accessKeyId: a.accessKeyId, secretAccessKey: a.secretAccessKey, sessionToken: a.sessionToken })
            let res
            try {
              res = await fetch(signed.url, { headers: signed.headers, signal: AbortSignal.timeout(T) })
            } catch (e) {
              throw new Error(shortError(e))
            }
            const doc = parseXml(await res.text())
            if (!res.ok) {
              const err = kid(kid(kid(doc, 'Response'), 'Errors'), 'Error')
              throw new Error(`HTTP ${res.status}${ktext(err, 'Code') ? ' · ' + ktext(err, 'Code') : ''}`)
            }
            const top = kid(doc, 'DescribeInstancesResponse')
            for (const r of kids(kid(top, 'reservationSet'), 'item'))
              for (const i of kids(kid(r, 'instancesSet'), 'item')) {
                const tags = Object.fromEntries(kids(kid(i, 'tagSet'), 'item').map(t => [ktext(t, 'key'), ktext(t, 'value')]))
                const id = ktext(i, 'instanceId')
                instances.push({
                  id,
                  name: tags.Name || id,
                  state: ktext(kid(i, 'instanceState'), 'name'),
                  type: ktext(i, 'instanceType'),
                  publicIp: ktext(i, 'ipAddress'),
                  privateIp: ktext(i, 'privateIpAddress'),
                  region,
                  zone: ktext(kid(i, 'placement'), 'availabilityZone'),
                  launched: toMs(ktext(i, 'launchTime')),
                  console: `https://${region}.console.aws.amazon.com/ec2/home?region=${region}#InstanceDetails:instanceId=${id}`,
                })
              }
            next = ktext(top, 'nextToken')
            if (!next) break
          }
          return { region, instances }
        } catch (e) {
          return { region, instances, error: shortError(e) }
        }
      }),
    )
    const errors = perRegion.filter(r => r.error).map(r => `${r.region}: ${r.error}`)
    return {
      status: errors.length === perRegion.length ? 'error' : 'ok',
      error: errors.join('; '),
      regions,
      instances: perRegion.flatMap(r => r.instances),
      regionErrors: errors,
    }
  }

  /* ----- Azure VMs ----- */

  async function azure(sec) {
    const z = sec.azure || {}
    if (!z.tenantId || !z.clientId || !z.clientSecret || !z.subscriptionId)
      return {
        status: 'connect',
        connect: {
          name: 'Azure',
          fields: ['azure.tenantId', 'azure.clientId', 'azure.clientSecret', 'azure.subscriptionId'],
          where: 'Azure portal → Microsoft Entra ID → App registrations → New registration → Certificates & secrets; then Subscription → Access control → add Reader for the app',
          url: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
        },
      }
    secretValues.push(z.clientSecret)
    let token
    try {
      const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(z.tenantId)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: z.clientId, client_secret: z.clientSecret, scope: 'https://management.azure.com/.default' }),
        signal: AbortSignal.timeout(T),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.access_token) {
        const code = /AADSTS\d+/.exec(str(j.error_description))?.[0]
        throw new Error(`sign-in failed: HTTP ${res.status}${j.error ? ' · ' + j.error : ''}${code ? ' ' + code : ''}`)
      }
      token = j.access_token
    } catch (e) {
      throw new Error(shortError(e))
    }
    secretValues.push(token)
    const headers = { authorization: `Bearer ${token}` }
    const sub = encodeURIComponent(z.subscriptionId)
    const all = async url => {
      const out = []
      for (let page = 0; url && page < 10; page++) {
        const j = await getJson(url, { headers })
        out.push(...(j.value || []))
        url = j.nextLink
      }
      return out
    }
    const vmUrl = `https://management.azure.com/subscriptions/${sub}/providers/Microsoft.Compute/virtualMachines?api-version=2024-07-01`
    const [vms, statuses, ips] = await Promise.all([
      all(vmUrl),
      all(vmUrl + '&statusOnly=true').catch(() => []),
      all(`https://management.azure.com/subscriptions/${sub}/providers/Microsoft.Network/publicIPAddresses?api-version=2024-05-01`).catch(() => []),
    ])
    const power = {}
    for (const s of statuses) {
      const st = (s.properties?.instanceView?.statuses || []).find(x => /^PowerState\//.test(x.code))
      if (st) power[lower(s.id)] = st.code.replace('PowerState/', '')
    }
    const vmList = vms.map(v => {
      const nics = (v.properties?.networkProfile?.networkInterfaces || []).map(n => lower(n.id))
      const ip = ips.find(p => nics.some(n => lower(p.properties?.ipConfiguration?.id).startsWith(n + '/')))
      return {
        id: str(v.id),
        name: str(v.name),
        location: str(v.location),
        size: str(v.properties?.hardwareProfile?.vmSize),
        state: power[lower(v.id)] || 'unknown',
        publicIp: str(ip?.properties?.ipAddress),
        console: `https://portal.azure.com/#@/resource${v.id}/overview`,
      }
    })
    return { status: 'ok', vms: vmList }
  }

  /* ----- Cloudflare ----- */

  async function cloudflare(sec) {
    const creds = await cloudflareCreds(sec)
    if (creds.missing) {
      const expired = creds.wrangler?.expired
      return {
        status: 'connect',
        connect: {
          name: 'Cloudflare',
          fields: ['cloudflare.apiToken', 'cloudflare.accountId'],
          where: 'Cloudflare → My Profile → API Tokens → Create Token → "Read all resources" template',
          url: 'https://dash.cloudflare.com/profile/api-tokens',
          note: expired
            ? `The wrangler login expired ${new Date(expired).toISOString().slice(0, 10)}. Run npx wrangler login, or add an API token.`
            : 'No wrangler login found. Run npx wrangler login, or add an API token.',
        },
      }
    }
    secretValues.push(creds.token)
    const headers = { authorization: `Bearer ${creds.token}` }
    const cf = async p => {
      const j = await getJson(`https://api.cloudflare.com/client/v4${p}`, { headers })
      if (j && j.success === false) throw new Error(str(j.errors?.[0]?.message || 'request failed').slice(0, 120))
      return j
    }
    let accountId = creds.accountId
    let accountName = ''
    let accounts = 0
    if (!accountId) {
      const j = await cf('/accounts?per_page=50')
      accounts = (j.result || []).length
      accountId = j.result?.[0]?.id || ''
      accountName = str(j.result?.[0]?.name)
      if (!accountId) throw new Error('this token sees no accounts')
    }
    const dash = `https://dash.cloudflare.com/${accountId}`
    const acct = `/accounts/${accountId}`
    const part = p => cf(p).then(j => ({ j }), e => ({ e: shortError(e) }))
    const [zones, workers, pages, r2, d1, kv] = await Promise.all([
      part(`/zones?per_page=50${creds.accountId ? `&account.id=${accountId}` : ''}`),
      part(`${acct}/workers/scripts`),
      part(`${acct}/pages/projects`),
      part(`${acct}/r2/buckets`),
      part(`${acct}/d1/database?per_page=100`),
      part(`${acct}/storage/kv/namespaces?per_page=100`),
    ])
    const list = (r, f) => (r.e ? { error: r.e, items: [] } : { items: f(r.j) })
    return {
      status: 'ok',
      from: creds.from,
      tokenExpires: creds.expires || 0,
      accountName,
      accounts,
      dash,
      zones: list(zones, j =>
        (j.result || []).map(z => ({ name: str(z.name), status: str(z.status), plan: str(z.plan?.name), paused: !!z.paused, console: `${dash}/${z.name}` })),
      ),
      workers: list(workers, j =>
        (j.result || []).map(w => ({ name: str(w.id), modified: toMs(w.modified_on), console: `${dash}/workers/services/view/${w.id}/production` })),
      ),
      pages: list(pages, j =>
        (j.result || []).map(p => ({
          name: str(p.name),
          url: p.subdomain ? `https://${p.subdomain}` : '',
          domains: (p.domains || []).map(str),
          status: str(p.latest_deployment?.latest_stage?.status),
          stage: str(p.latest_deployment?.latest_stage?.name),
          deployUrl: str(p.latest_deployment?.url),
          at: toMs(p.latest_deployment?.created_on),
          branch: str(p.latest_deployment?.deployment_trigger?.metadata?.branch),
          console: `${dash}/pages/view/${p.name}`,
        })),
      ),
      r2: list(r2, j =>
        (j.result?.buckets || []).map(b => ({ name: str(b.name), created: toMs(b.creation_date), location: str(b.location), console: `${dash}/r2/default/buckets/${b.name}` })),
      ),
      d1: list(d1, j => (j.result || []).map(d => ({ name: str(d.name), uuid: str(d.uuid), created: toMs(d.created_at), console: `${dash}/workers/d1/databases/${d.uuid}` }))),
      kv: list(kv, j => (j.result || []).map(n => ({ name: str(n.title), id: str(n.id), console: `${dash}/workers/kv/namespaces/${n.id}` }))),
    }
  }

  /* ----- live servers ----- */

  async function sshHosts() {
    const text = await readFile(SSH_CONFIG, 'utf8').catch(() => '')
    const map = {}
    let current = []
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(\w+)\s+(.+?)\s*$/.exec(line)
      if (!m) continue
      const key = m[1].toLowerCase()
      if (key === 'host') current = m[2].split(/\s+/).filter(a => !/[*?]/.test(a))
      else if (key === 'hostname') for (const a of current) map[a] ??= m[2]
    }
    return map
  }

  async function sshCheck(alias) {
    const t0 = Date.now()
    const r = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', alias, 'true'], { timeout: 12_000 })
    return { port: 'ssh', ok: r.ok, ms: r.ok ? Date.now() - t0 : 0 }
  }

  async function liveServers(cool, awsR, azR) {
    const manual = await readJsonFile(FILES.servers, [])
    const hosts = await sshHosts()
    const list = []
    const byHost = h => list.find(x => h && x.host && lower(x.host) === lower(h))
    for (const m of Array.isArray(manual) ? manual : []) {
      if (!m?.name) continue
      list.push({
        name: str(m.name),
        provider: str(m.provider),
        host: str((m.sshAlias && hosts[m.sshAlias]) || m.host),
        sshAlias: str(m.sshAlias),
        url: str(m.url),
        notes: str(m.notes),
        sources: ['servers.json'],
      })
    }
    for (const s of cool?.servers || []) {
      const hit = byHost(s.ip)
      const c = { name: s.name, console: s.console, reachable: s.reachable, usable: s.usable }
      if (hit) (hit.coolify = c), hit.sources.push('Coolify')
      else
        list.push({
          name: s.coolifyHost ? `${s.name} (Coolify host)` : s.name,
          provider: s.coolifyHost ? 'Coolify host' : '',
          host: s.ip,
          url: s.coolifyHost ? cool.url : '',
          checkPort: s.coolifyHost ? 443 : s.port,
          coolify: c,
          sources: ['Coolify'],
        })
    }
    for (const i of awsR?.instances || []) {
      const hit = byHost(i.publicIp) || byHost(i.privateIp)
      const a = { id: i.id, state: i.state, type: i.type, region: i.region, console: i.console }
      if (hit) (hit.aws = a), hit.sources.push('AWS'), (hit.provider ||= 'AWS')
      else list.push({ name: i.name, provider: 'AWS', host: i.publicIp, aws: a, sources: ['AWS'] })
    }
    for (const v of azR?.vms || []) {
      const hit = byHost(v.publicIp)
      const z = { id: v.id, state: v.state, size: v.size, location: v.location, console: v.console }
      if (hit) (hit.azure = z), hit.sources.push('Azure'), (hit.provider ||= 'Azure')
      else list.push({ name: v.name, provider: 'Azure', host: v.publicIp, azure: z, sources: ['Azure'] })
    }
    await Promise.all(
      list.map(async s => {
        const cloudState = s.aws?.state || s.azure?.state || ''
        if (!s.host || (cloudState && cloudState !== 'running')) {
          s.checks = []
          s.up = cloudState ? cloudState === 'running' : null
          return
        }
        const ports = s.checkPort ? [s.checkPort] : [22]
        let webHost = ''
        try {
          webHost = s.url ? new URL(s.url).hostname : ''
        } catch {}
        const jobs = ports.map(p => tcpCheck(s.host, p))
        if (webHost && !ports.includes(443)) jobs.push(tcpCheck(webHost, 443))
        s.checks = await Promise.all(jobs)
        // A blocked direct port 22 may still answer through the ssh config (ProxyJump, etc.).
        if (s.sshAlias && !s.checks.find(c => c.port === 22)?.ok) s.checks.push(await sshCheck(s.sshAlias))
        s.up = s.checks.some(c => c.ok)
      }),
    )
    return list
  }

  /* ----- clients ----- */

  async function clients(cool) {
    const raw = await readJsonFile(FILES.clients, [])
    const list = Array.isArray(raw) ? raw.filter(c => c?.name) : []
    const apps = cool?.apps || []
    return mapLimit(list, 4, async c => {
      const n = lower(c.name)
      const named = new Set((Array.isArray(c.coolify) ? c.coolify : []).map(lower))
      const linked = apps.filter(a => named.has(lower(a.name)) || [a.name, a.project, a.fqdns.join(' ')].some(x => lower(x).includes(n)))
      const own = (Array.isArray(c.domains) ? c.domains : []).map(d => lower(d).replace(/^https?:\/\//, '').replace(/[/:].*$/, '')).filter(Boolean)
      const fromApps = linked.flatMap(a => a.fqdns.map(u => new URL(u).hostname))
      const domains = [...new Set([...own, ...fromApps])].slice(0, 12)
      const checks = await mapLimit(domains, 4, async d => ({ ...(await httpsCheck(d)), fromCoolify: !own.includes(d) }))
      const appsOk = linked.every(a => a.state === 'running')
      const siteOk = d => d.code > 0 && d.code < 500 && (d.tlsDays == null || d.tlsDays >= 7)
      // Down: an app is stopped or no domain answers. Warn: some domain fails or its cert is close to expiry.
      const health = !linked.length && !checks.length ? 'unlinked'
        : !appsOk || (checks.length && checks.every(d => !d.code)) ? 'down'
        : checks.every(siteOk) ? 'ok' : 'warn'
      return {
        name: str(c.name),
        status: str(c.status),
        notes: str(c.notes),
        domains: own,
        health,
        apps: linked.map(a => ({ name: a.name, project: a.project, status: a.status, state: a.state, health: a.health, url: a.url, console: a.console, deploy: a.deploy })),
        checks,
      }
    })
  }

  /* ----- refresh ----- */

  const guard = (fn, label) =>
    withTimeout(Promise.resolve().then(fn), PROVIDER_T, label).then(
      r => ({ ...r, at: Date.now() }),
      e => ({ status: 'error', error: shortError(e), at: Date.now() }),
    )

  async function gather() {
    const sec = await readJsonFile(FILES.secrets, {})
    secretValues = []
    for (const v of [sec.coolify?.token, sec.cloudflare?.apiToken, sec.aws?.secretAccessKey, sec.aws?.accessKeyId, sec.azure?.clientSecret, sec.euronodes?.apiKey, sec.openrouter?.apiKey, sec.deepseek?.apiKey])
      if (v) secretValues.push(String(v))

    const [cool, awsR, azR, cf] = await Promise.all([
      guard(() => coolify(sec), 'Coolify'),
      guard(() => aws(sec), 'AWS'),
      guard(() => azure(sec), 'Azure'),
      guard(() => cloudflare(sec), 'Cloudflare'),
    ])
    const [servers, clientList] = await Promise.all([
      guard(async () => ({ status: 'ok', list: await liveServers(cool, awsR, azR) }), 'Server checks'),
      guard(async () => ({ status: cool.status === 'ok' ? 'ok' : 'partial', list: await clients(cool) }), 'Client checks'),
    ])
    return {
      at: Date.now(),
      files: FILES,
      coolify: cool,
      servers: {
        ...servers,
        euronodes: {
          apiKeySet: !!sec.euronodes?.apiKey,
          note: 'Euronodes API docs are pending.',
        },
      },
      aws: awsR,
      azure: azR,
      cloudflare: cf,
      clients: clientList,
    }
  }

  function refresh(force) {
    if (inflight) return inflight
    if (state.at && !state.cached && Date.now() - state.at < (force ? MIN_FORCE : TTL)) return Promise.resolve()
    inflight = gather()
      .then(async next => {
        state = next
        try {
          await mkdir(path.dirname(CACHE), { recursive: true })
          await writeFile(CACHE, scrub(JSON.stringify(state)))
        } catch {}
      })
      .catch(e => {
        state = { ...state, at: state.at || Date.now(), error: shortError(e) }
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  return async function route(url, req, res, { send }) {
    if (!url.pathname.startsWith('/api/cloud/')) return false
    if (url.pathname === '/api/cloud/state' && req.method === 'GET') {
      if (!state.at) await refresh(false)
      else if (state.cached || Date.now() - state.at > TTL) refresh(false)
      send(res, 200, snapshot())
      return true
    }
    if (url.pathname === '/api/cloud/refresh' && req.method === 'POST') {
      await refresh(true)
      send(res, 200, snapshot())
      return true
    }
    send(res, 404, { error: 'not found' })
    return true
  }
}
