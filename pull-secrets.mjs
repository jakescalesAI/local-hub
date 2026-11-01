// Fill config/secrets.json from Infisical without ever printing a value.
//   node pull-secrets.mjs --project <projectId> [--env prod] [--path /] [--overwrite]
// Needs the Infisical CLI signed in (`infisical login`). Fields already set stay as they are
// unless --overwrite is passed. Prints only which fields were filled and from which secret name.
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { providerOf, PROVIDERS } from './calendar.mjs'
import { configPath } from './config.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FILE = configPath('secrets.json')
const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d }
const project = arg('project'), env = arg('env', 'prod'), dir = arg('path', '/')
const overwrite = process.argv.includes('--overwrite')
if (!project || !/^[\w-]+$/.test(project) || !/^[\w-]+$/.test(env) || !/^\/[\w/-]*$/.test(dir)) {
  console.error('usage: node pull-secrets.mjs --project <projectId> [--env prod] [--path /] [--overwrite]')
  process.exit(1)
}

let list
try {
  const out = execSync(`infisical export --format=json --projectId=${project} --env=${env} --path=${dir} --silent`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 32 << 20 })
  list = JSON.parse(out)
} catch (e) {
  const msg = String(e.stderr || e.message || '').replace(/[A-Za-z0-9_\-.]{32,}/g, '[hidden]').trim().split('\n').slice(-3).join(' ')
  console.error(`infisical export failed: ${msg || 'no output'}`)
  console.error('Check: infisical login, the project id (Project Settings), and the environment slug.')
  process.exit(1)
}
const secrets = Object.fromEntries(list.map(s => [s.key, s.value]).filter(([, v]) => typeof v === 'string' && v.trim()))
const names = Object.keys(secrets)

// The first secret name matching each pattern (and test) fills the field.
const pick = (re, test = () => true) => names.find(n => re.test(n) && test(secrets[n]))
const RULES = [
  ['openrouter.apiKey', () => pick(/OPENROUTER.*(KEY|TOKEN)/i)],
  ['deepseek.apiKey', () => pick(/DEEPSEEK.*(KEY|TOKEN)/i)],
  // A restricted read key first; the hub only ever makes GET calls to Stripe.
  ['stripe.apiKey', () => pick(/STRIPE/i, v => /^rk_live_/.test(v)) || pick(/STRIPE/i, v => /^sk_live_/.test(v)) || pick(/STRIPE/i, v => /^(rk|sk)_test_/.test(v))],
  ['cloudflare.apiToken', () => pick(/^(CF|CLOUDFLARE).*(API_?TOKEN|TOKEN)$/i)],
  ['cloudflare.accountId', () => pick(/^(CF|CLOUDFLARE).*ACCOUNT_?ID$/i)],
  ['coolify.url', () => pick(/COOLIFY.*(URL|HOST|BASE)/i)],
  ['coolify.token', () => pick(/COOLIFY.*(TOKEN|KEY)/i)],
  ['aws.accessKeyId', () => pick(/^AWS_ACCESS_KEY_ID$/i)],
  ['aws.secretAccessKey', () => pick(/^AWS_SECRET_ACCESS_KEY$/i)],
  ['azure.tenantId', () => pick(/^(AZURE|ARM)_TENANT_ID$/i)],
  ['azure.clientId', () => pick(/^(AZURE|ARM)_CLIENT_ID$/i)],
  ['azure.clientSecret', () => pick(/^(AZURE|ARM)_CLIENT_SECRET$/i)],
  ['azure.subscriptionId', () => pick(/^(AZURE|ARM)_SUBSCRIPTION_ID$/i)],
  ['euronodes.apiKey', () => pick(/EURONODES.*(KEY|TOKEN)/i)],
  ['calcom.apiKey', () => pick(/^(CALCOM|CAL_COM|CAL)_API_KEY$/i)],
]

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const get = p => p.split('.').reduce((o, k) => o?.[k], data)
const set = (p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((o, k) => (o[k] ||= {}), data)[last] = v }
const filled = [], kept = [], missing = []
for (const [field, find] of RULES) {
  const name = find()
  if (!name) { missing.push(field); continue }
  if (get(field) && !overwrite) { kept.push(field); continue }
  set(field, secrets[name].trim())
  filled.push(`${name} -> ${field}`)
}
// Calendar feeds: secrets named like GOOGLE_ICS / OUTLOOK_ICS / *ICAL*, or any secret whose value is
// an .ics or webcal address. The provider comes from the address (or the name), the label from the name.
data.calendars ||= []
const feedName = /GOOGLE.*ICS|OUTLOOK.*ICS|ICLOUD.*(ICS|URL|LINK)|ICAL/i
const feedValue = v => /^(https|webcals?):\/\/\S+$/i.test(v)
const icsValue = v => /^https:\/\/\S+\.ics(\?|$)|\/ical\/\S+\/basic\.ics|^webcals?:\/\/\S+$/i.test(v)
for (const n of names.filter(n => { const v = secrets[n].trim(); return (feedName.test(n) && feedValue(v)) || icsValue(v) })) {
  const url = secrets[n].trim()
  if (data.calendars.some(c => c.icsUrl === url)) continue
  const hint = /GOOGLE/i.test(n) ? 'google' : /OUTLOOK/i.test(n) ? 'outlook' : /ICLOUD/i.test(n) ? 'icloud' : ''
  const guessed = providerOf(url)
  const provider = guessed !== 'ics' ? guessed : hint || 'ics'
  const words = n.replace(/GOOGLE|OUTLOOK|ICLOUD|SECRET|ADDRESS|LINK|ICS|ICAL|URL|CALENDAR|FEED/gi, ' ').replace(/[_\-\s]+/g, ' ').trim()
  const label = (words ? words.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : PROVIDERS[provider].label).slice(0, 80)
  data.calendars.push({ label, provider, icsUrl: url })
  filled.push(`${n} -> calendars[] (${PROVIDERS[provider].label}, "${label}")`)
}

fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n')
console.log(`Read ${names.length} secrets from Infisical (${env}${dir}).`)
console.log(filled.length ? `Filled:\n  ${filled.join('\n  ')}` : 'Filled: nothing new')
if (kept.length) console.log(`Already set (use --overwrite to replace): ${kept.join(', ')}`)
if (missing.length) console.log(`No matching secret for: ${missing.join(', ')}`)
console.log(`Restart the hub to use them: ${process.platform === 'win32' ? 'powershell -NoProfile -ExecutionPolicy Bypass -File restart.ps1' : './restart.sh'}`)
