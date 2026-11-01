// Stripe tab back end (read only). Keys come from secrets.json, which only this process reads:
//   "stripe": { "apiKey": "rk_live_..." }
//   "stripe": { "accounts": [{ "label": "My company", "apiKey": "rk_live_..." }, ...] }
// Page responses carry numbers, names and timestamps only. Every Stripe call is a GET with a
// Bearer key; nothing here ever writes to Stripe. Amounts stay in Stripe minor units, times in
// unix seconds. Nothing throws at import and there are no timers.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { configPath } from './config.mjs'

const API = 'https://api.stripe.com/v1/'
const TTL = 60e3 // per-account cache
const FORCE_GAP = 5e3 // a forced refresh inside this window just returns the cache
const TXN_PAGE_CAP = 15 // balance_transactions pages of 100 (1,500 rows) per account
const SUB_PAGE_CAP = 5
const CUSTOMER_PAGE_CAP = 10
const DAYS = 30
const FIELD_HELP = 'stripe.apiKey'

const readJsonSync = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const pad = n => String(n).padStart(2, '0')
const localDay = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const lower = s => (typeof s === 'string' ? s.toLowerCase() : '')

// Strip anything that looks like a Stripe key (full or masked) plus any literal key we hold.
export function scrub(s, keys = []) {
  let t = String(s ?? '')
  for (const k of keys) if (k && k.length > 8) t = t.split(k).join('[hidden]')
  return t.replace(/\b[rsp]k_(?:live|test)_[\w*.]+/g, '[hidden]').replace(/Bearer\s+\S+/g, '[hidden]').replace(/\s+/g, ' ').trim().slice(0, 240)
}

export function modeOf(key) {
  const m = /^[rs]k_(live|test)_/.exec(key || '')
  return m ? m[1] : null
}

// The 30 local days ending today, oldest first, and the unix second the first one starts.
export function dayWindow(nowMs = Date.now()) {
  const days = []
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(nowMs)
    d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() - i)
    days.push(localDay(d.getTime()))
  }
  const [y, m, d] = days[0].split('-').map(Number)
  return { days, since: Math.floor(new Date(y, m - 1, d, 0, 0, 0).getTime() / 1000) }
}

/* ---------- aggregation (pure; exported for tests) ---------- */

const GROSS_TYPES = new Set(['charge', 'payment'])
const REFUND_TYPES = new Set(['refund', 'payment_refund'])
const SKIP_TYPE = /^(payout|transfer|topup|reserve|issuing|obligation)/ // money moving, not revenue

// Fold balance transactions into per-currency totals: gross (charges), fees, refunds, net and a
// per-day gross series. `net` is Stripe's own net summed over everything that isn't a payout or
// transfer, so disputes and adjustments are reflected there.
export function foldTransactions(txns, days) {
  const byCur = new Map()
  const idx = new Map(days.map((d, i) => [d, i]))
  for (const t of txns) {
    const type = String(t.type || '')
    if (SKIP_TYPE.test(type)) continue
    const cur = lower(t.currency)
    if (!cur) continue
    let c = byCur.get(cur)
    if (!c) byCur.set(cur, (c = { gross: 0, net: 0, fees: 0, refunds: 0, count: 0, daily: days.map(() => 0), dailyCount: days.map(() => 0) }))
    const amount = num(t.amount) ?? 0
    const fee = num(t.fee) ?? 0
    c.net += num(t.net) ?? amount - fee
    if (GROSS_TYPES.has(type)) {
      c.gross += amount
      c.fees += fee
      c.count++
      const i = idx.get(localDay((t.created || 0) * 1000))
      if (i != null) { c.daily[i] += amount; c.dailyCount[i]++ }
    } else if (REFUND_TYPES.has(type)) {
      c.refunds += -amount
      c.fees += fee
    } else if (/fee|cost/.test(type)) {
      c.fees += -amount // Stripe fees billed as their own line (stripe_fee, network_cost, ...)
    }
  }
  return byCur
}

// Monthly recurring revenue of active subscriptions, per currency. Tiered, metered and
// zero-price items can't be priced from the item alone, so they are skipped and `approx` is set.
export function mrrOf(subs) {
  const byCur = new Map()
  let approx = false
  for (const sub of subs) {
    const off = sub.discount?.coupon?.percent_off
    const keep = typeof off === 'number' && off > 0 && off <= 100 ? 1 - off / 100 : 1
    for (const item of sub.items?.data || []) {
      const price = item.price || item.plan
      if (!price) continue
      const interval = price.recurring?.interval || price.interval
      const every = price.recurring?.interval_count || price.interval_count || 1
      const metered = (price.recurring?.usage_type || price.usage_type) === 'metered'
      const unit = num(price.unit_amount) ?? (price.unit_amount_decimal != null && price.unit_amount_decimal !== '' ? Number(price.unit_amount_decimal) : num(price.amount))
      if (!interval || metered || unit == null || !Number.isFinite(unit)) { approx = true; continue }
      const perMonth = { month: 1 / every, year: 1 / (12 * every), week: 52 / 12 / every, day: 365 / 12 / every }[interval]
      if (!perMonth) { approx = true; continue }
      const cur = lower(price.currency || sub.currency)
      if (!cur) continue
      byCur.set(cur, (byCur.get(cur) || 0) + unit * (num(item.quantity) ?? 1) * perMonth * keep)
    }
  }
  return { byCur, approx }
}

const customerLabel = c => c.billing_details?.name || c.billing_details?.email || c.receipt_email || (typeof c.customer === 'string' ? c.customer : c.customer?.id) || ''

export const normCharge = c => ({
  amount: num(c.amount) ?? 0,
  currency: lower(c.currency),
  status: c.refunded ? 'refunded' : c.status || '',
  description: c.description || c.calculated_statement_descriptor || '',
  customer: customerLabel(c),
  created: num(c.created) ?? 0,
})

export const normPayout = p => ({ amount: num(p.amount) ?? 0, currency: lower(p.currency), status: p.status || '', arrival: num(p.arrival_date) ?? 0 })

export const normInvoice = i => ({
  amount_due: num(i.amount_due) ?? 0,
  currency: lower(i.currency),
  customer: i.customer_name || i.customer_email || (typeof i.customer === 'string' ? i.customer : i.customer?.id) || '',
  due: num(i.due_date),
  number: i.number || '',
  url: typeof i.hosted_invoice_url === 'string' && i.hosted_invoice_url.startsWith('https://') ? i.hosted_invoice_url : '',
})

const normBalance = list => (Array.isArray(list) ? list : []).map(b => ({ amount: num(b.amount) ?? 0, currency: lower(b.currency) })).filter(b => b.currency)

/* ---------- Stripe client ---------- */

async function sget(key, endpoint, params = []) {
  const u = new URL(API + endpoint)
  for (const [k, v] of params) u.searchParams.append(k, v)
  let last
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(u, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
      const j = await r.json().catch(() => null)
      if (r.ok) return j
      last = Object.assign(new Error(j?.error?.message || `HTTP ${r.status}`), { status: r.status })
      if (r.status !== 429 && r.status < 500) break
    } catch (e) {
      last = Object.assign(new Error(e.cause?.code || e.name || 'request failed'), { status: 0 })
    }
    await new Promise(r => setTimeout(r, 800))
  }
  throw last
}

// List endpoint, following has_more up to `max` pages; `each` sees every object.
async function paged(key, endpoint, params, max, each) {
  let after = ''
  for (let page = 0; page < max; page++) {
    const j = await sget(key, endpoint, [...params, ['limit', '100'], ...(after ? [['starting_after', after]] : [])])
    const data = Array.isArray(j?.data) ? j.data : []
    each(data)
    if (!j?.has_more || !data.length) return false
    after = data.at(-1).id
  }
  return true // more pages were left
}

async function countCustomers(key) {
  try {
    const j = await sget(key, 'customers/search', [['query', 'created>0'], ['limit', '1'], ['expand[]', 'total_count']])
    if (num(j?.total_count) != null) return { n: j.total_count, approx: false }
  } catch (e) { if (e.status === 401) throw e }
  let n = 0
  const more = await paged(key, 'customers', [], CUSTOMER_PAGE_CAP, d => (n += d.length))
  return { n, approx: more }
}

const SECTION_NAME = { account: 'Account', balance: 'Balance', txns: 'Payments history', charges: 'Recent payments', payouts: 'Payouts', subs: 'Subscriptions', customers: 'Customers', invoices: 'Invoices' }

async function fetchAccount(cfg) {
  const key = cfg.key
  const keys = [key]
  const warnings = []
  const failures = []
  const guard = async (name, fn) => {
    try { return await fn() } catch (e) {
      failures.push(e)
      if (e.status === 401) throw e
      warnings.push(e.status === 403 ? `${SECTION_NAME[name]}: this key has no read access` : `${SECTION_NAME[name]}: ${scrub(e.message, keys)}`)
      return null
    }
  }
  const { days, since } = dayWindow()
  const txns = []
  const subs = []
  let txnsMore = false
  let subsMore = false
  const [acct, balance, txnOk, charges, payouts, subOk, cust, invoices] = await Promise.all([
    guard('account', () => sget(key, 'account')),
    guard('balance', () => sget(key, 'balance')),
    guard('txns', async () => { txnsMore = await paged(key, 'balance_transactions', [['created[gte]', String(since)]], TXN_PAGE_CAP, d => txns.push(...d)); return true }),
    guard('charges', () => sget(key, 'charges', [['limit', '10']])),
    guard('payouts', () => sget(key, 'payouts', [['limit', '5']])),
    guard('subs', async () => { subsMore = await paged(key, 'subscriptions', [['status', 'active']], SUB_PAGE_CAP, d => subs.push(...d)); return true }),
    guard('customers', () => countCustomers(key)),
    guard('invoices', () => sget(key, 'invoices', [['status', 'open'], ['limit', '25']])),
  ])
  // Nothing came back at all: report the failure instead of an empty dashboard.
  if (failures.length === 8) throw failures[0]

  const name = acct?.business_profile?.name || acct?.settings?.dashboard?.display_name || acct?.email || ''
  const accCurrency = lower(acct?.default_currency)
  const avail = normBalance(balance?.available)
  const pend = normBalance(balance?.pending)
  const byCur = foldTransactions(txns, days)
  const mrr = mrrOf(subs)
  // One currency drives the headline numbers: the account's own, else the one with the most volume.
  const volume = new Map()
  for (const [c, v] of byCur) volume.set(c, (volume.get(c) || 0) + v.gross)
  for (const b of avail) volume.set(b.currency, volume.get(b.currency) || 0)
  const primary = accCurrency || [...volume].sort((a, b) => b[1] - a[1])[0]?.[0] || 'usd'
  const t = byCur.get(primary)
  const mode = modeOf(key) || (balance?.livemode === false ? 'test' : 'live')

  return {
    label: cfg.label || name || 'Stripe',
    connected: true,
    mode,
    error: '',
    warnings,
    account: acct ? { name, country: acct.country || '', currency: accCurrency || primary } : { name: '', country: '', currency: primary },
    balance: balance ? { available: avail, pending: pend } : null,
    last30: txnOk
      ? { gross: t?.gross ?? 0, net: t?.net ?? 0, fees: t?.fees ?? 0, refunds: t?.refunds ?? 0, count: t?.count ?? 0, currency: primary, truncated: txnsMore, otherCurrencies: [...byCur].filter(([c, v]) => c !== primary && (v.gross || v.net)).map(([c, v]) => ({ currency: c, gross: v.gross })) }
      : null,
    daily: txnOk ? days.map((day, i) => ({ day, gross: t?.daily[i] ?? 0, count: t?.dailyCount[i] ?? 0 })) : null,
    mrr: subOk ? Math.round(mrr.byCur.get(primary) ?? 0) : null,
    mrrCurrency: primary,
    mrrApprox: subOk ? mrr.approx || subsMore : false,
    activeSubs: subOk ? subs.length : null,
    customers: cust ? cust.n : null,
    customersApprox: cust ? cust.approx : false,
    recentCharges: charges ? (charges.data || []).slice(0, 10).map(normCharge) : null,
    payouts: payouts ? (payouts.data || []).slice(0, 5).map(normPayout) : null,
    openInvoices: invoices ? (invoices.data || []).map(normInvoice).sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity)).slice(0, 10) : null,
  }
}

/* ---------- accounts, cache, routes ---------- */

export function create({ here }) {
  const dataDir = path.join(here, 'data')
  const cacheFile = path.join(dataDir, 'stripe-cache.json')
  const secretsFile = configPath('secrets.json')
  try { fs.mkdirSync(dataDir, { recursive: true }) } catch {}

  const secrets = () => readJsonSync(secretsFile) || {}
  const mem = new Map() // id -> { at, keyId, data }
  const inflight = new Map() // id -> Promise
  for (const [id, e] of Object.entries(readJsonSync(cacheFile)?.accounts || {})) if (e?.data && e.keyId) mem.set(id, e)

  // The configured accounts, in order. A blank key is a placeholder, shown as "connect".
  function configured() {
    const s = secrets().stripe
    const raw = []
    if (s && typeof s === 'object') {
      const hasList = Array.isArray(s.accounts) && s.accounts.length
      const top = typeof s.apiKey === 'string' ? s.apiKey.trim() : ''
      if (top || !hasList) raw.push({ label: String(s.label || '').trim(), key: top, field: 'stripe.apiKey' })
      if (hasList) s.accounts.forEach((a, i) => { if (a && typeof a === 'object') raw.push({ label: String(a.label || '').trim(), key: String(a.apiKey || '').trim(), field: `stripe.accounts[${i}].apiKey` }) })
    }
    if (!raw.length) raw.push({ label: '', key: '', field: FIELD_HELP })
    const seen = new Set()
    return raw.map((a, i) => {
      let id = (a.label || 'stripe').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stripe'
      while (seen.has(id)) id += `-${i + 1}`
      seen.add(id)
      return { ...a, id, keyId: a.key ? crypto.createHash('sha256').update(a.key).digest('hex').slice(0, 10) : '' }
    })
  }

  let saving = Promise.resolve()
  function saveCache(ids) {
    const out = {}
    for (const id of ids) if (mem.has(id)) out[id] = mem.get(id)
    const body = JSON.stringify({ v: 1, accounts: out })
    saving = saving.then(async () => { await fsp.writeFile(cacheFile + '.tmp', body); await fsp.rename(cacheFile + '.tmp', cacheFile) }).catch(() => {})
  }

  const blank = cfg => ({ id: cfg.id, label: cfg.label || 'Stripe', connected: false, mode: null, error: '', field: cfg.field, account: null, balance: null, last30: null, daily: null, mrr: null, activeSubs: null, customers: null, recentCharges: null, payouts: null, openInvoices: null })

  function refresh(cfg, force) {
    const hit = mem.get(cfg.id)
    const same = hit && hit.keyId === cfg.keyId
    const age = same ? Date.now() - hit.at : Infinity
    if (same && age < (force ? FORCE_GAP : TTL)) return Promise.resolve()
    if (inflight.has(cfg.id)) return inflight.get(cfg.id)
    const p = (async () => {
      try {
        const data = await fetchAccount(cfg)
        mem.set(cfg.id, { at: Date.now(), keyId: cfg.keyId, data })
      } catch (e) {
        const msg = e.status === 401 ? 'Stripe rejected this key. Check it was copied in full and has not been rolled or deleted.' : e.status === 0 ? `Couldn’t reach Stripe (${scrub(e.message, [cfg.key])})` : scrub(e.message, [cfg.key]) || 'Stripe request failed'
        // Keep the last good numbers (same key only) and show the error beside them.
        const prev = same ? hit.data : null
        mem.set(cfg.id, { at: Date.now(), keyId: cfg.keyId, failed: true, data: prev ? { ...prev, error: msg, stale: true } : { ...blank(cfg), connected: true, mode: modeOf(cfg.key) || 'live', error: msg } })
      } finally {
        inflight.delete(cfg.id)
      }
    })()
    inflight.set(cfg.id, p)
    return p
  }

  async function stateBody(force) {
    const cfgs = configured()
    await Promise.all(cfgs.filter(c => c.key).map(c => refresh(c, force)))
    const ids = cfgs.map(c => c.id)
    for (const id of [...mem.keys()]) if (!ids.includes(id)) mem.delete(id)
    saveCache(ids.filter(id => mem.has(id) && !mem.get(id).failed))
    const accounts = cfgs.map(c => {
      if (!c.key) return blank(c)
      const e = mem.get(c.id)
      return e && e.keyId === c.keyId ? { id: c.id, field: c.field, cachedAt: e.at, ...e.data } : { ...blank(c), connected: true, error: 'Not loaded yet' }
    })
    return { at: Date.now(), secretsPath: secretsFile, accounts }
  }

  return async function route(url, req, res, { send }) {
    if (!url.pathname.startsWith('/api/stripe/')) return false
    const p = url.pathname.slice('/api/stripe/'.length)
    try {
      if (req.method === 'GET' && p === 'state') return send(res, 200, await stateBody(false)), true
      if (req.method === 'POST' && p === 'refresh') return send(res, 200, await stateBody(true)), true
      send(res, 404, { error: 'not found' })
    } catch (e) {
      send(res, 500, { error: scrub(e.message) })
    }
    return true
  }
}
