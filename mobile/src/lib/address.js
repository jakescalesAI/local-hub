// Addresses and pairing links. Release builds accept HTTPS only. Debug builds also allow plain HTTP
// to this machine and to the Android emulator's address for the host.
const DEV_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '10.0.2.2'])
const CODE_CHARS = /^[0-9A-Z]{8}$/

export const DEMO_ADDRESS = 'https://demo.invalid'
export const DEMO_CODE = 'DEMO2026'

export function normalizeAddress(input, { dev = false } = {}) {
  const raw = String(input ?? '').trim()
  if (!raw) return { ok: false, error: 'Enter your Hub\'s address.' }
  let url
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return { ok: false, error: 'That doesn\'t look like an address.' }
  }
  if (url.username || url.password) return { ok: false, error: 'The address can\'t include a name or password.' }
  if (url.protocol === 'http:' && !(dev && DEV_HTTP_HOSTS.has(url.hostname))) {
    return { ok: false, error: 'The address must start with https://. See your Hub\'s pairing page.' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'The address must start with https://.' }
  if (!url.hostname) return { ok: false, error: 'That doesn\'t look like an address.' }
  return { ok: true, url: url.origin }
}

export const cleanCode = input => String(input ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '')
export const isCode = code => CODE_CHARS.test(code)
export const showCode = code => (code.length > 4 ? `${code.slice(0, 4)} ${code.slice(4)}` : code)

// Reads localhub://pair?u=<address>&c=<code>. It only fills in the confirm screen, it never pairs,
// so a hostile link can't point the phone at someone else's server without the person seeing it.
export function parsePairLink(text, { dev = false } = {}) {
  let url
  try {
    url = new URL(String(text ?? '').trim())
  } catch {
    return null
  }
  if (url.protocol !== 'localhub:') return null
  if (url.hostname !== 'pair' && url.pathname.replace(/^\/+/, '') !== 'pair') return null
  const address = normalizeAddress(url.searchParams.get('u'), { dev })
  if (!address.ok) return null
  const code = cleanCode(url.searchParams.get('c'))
  if (!isCode(code)) return null
  return { address: address.url, code }
}
