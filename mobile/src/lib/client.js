// Talks to the Hub. `http` is CapacitorHttp in the app, which goes through the OS and so isn't subject
// to CORS: the Hub never allows other origins and shouldn't have to. The token only ever travels in a
// header, and nothing here logs a request.
const CHECK_TIMEOUT_MS = 6000
const CLAIM_TIMEOUT_MS = 15000
const SEND_TIMEOUT_MS = 20000
export const MAX_SHARE_CHARS = 8000 // the Hub's chat takes no more than this
export const MAX_HUB_NAME = 60
const MAX_ERROR_CHARS = 300

// Control and direction characters, and the ones that draw nothing. Emoji joined with a zero-width
// joiner come apart, which is a fair price for text from the other end.
const UNSEEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Default_Ignorable_Code_Point}\u2800]/gu
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u

const clip = (text, limit) => [...text.replace(/\s/g, ' ').replace(UNSEEN, '').replace(/ +/g, ' ').trim()].slice(0, limit).join('')

// A reply only counts as a Hub if it names itself with something a person can read. The name comes
// from the other end, so it's cut to a length the screens can hold.
function readHub(hub) {
  const name = typeof hub?.name === 'string' ? clip(hub.name, MAX_HUB_NAME) : ''
  return VISIBLE.test(name) ? { id: typeof hub.id === 'string' ? hub.id : undefined, name } : null
}

const readError = (body, fallback) => (typeof body?.error === 'string' && clip(body.error, MAX_ERROR_CHARS)) || fallback

export function createClient({ http }) {
  async function request({ url, method = 'GET', token, data, timeoutMs }) {
    const headers = { 'x-hub': '1' }
    if (token) headers.Authorization = `Bearer ${token}`
    if (data !== undefined) headers['Content-Type'] = 'application/json'
    const res = await http.request({
      url,
      method,
      headers,
      data,
      responseType: 'text',
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    })
    return { status: res.status, text: typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '') }
  }

  const parse = text => {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  return {
    // { status } when something answered, { status: null } when nothing did.
    async check(address, token) {
      try {
        const res = await request({ url: `${address}/api/pair/me`, token, timeoutMs: CHECK_TIMEOUT_MS })
        const body = res.status === 200 ? parse(res.text) : null
        const hub = readHub(body?.hub)
        if (res.status === 200 && !hub) return { status: 500 }
        return { status: res.status, hub }
      } catch {
        return { status: null }
      }
    },

    async claim(address, code, { name, platform }) {
      let res
      try {
        res = await request({ url: `${address}/api/pair/claim`, method: 'POST', data: { code, name, platform }, timeoutMs: CLAIM_TIMEOUT_MS })
      } catch {
        return { ok: false, error: 'Couldn\'t reach that address. Check it, and make sure the computer is awake and this phone is on your private network.' }
      }
      const body = parse(res.text)
      const hub = readHub(body?.hub)
      if (res.status === 200 && body?.token && typeof body.token === 'string' && body.deviceId && typeof body.deviceId === 'string' && hub) {
        return { ok: true, token: body.token, deviceId: body.deviceId, hub }
      }
      // The Hub answers only to its own names, and says so in plain text before anything else runs.
      if (res.status === 403 && !body) return { ok: false, error: 'That address answered, but refused the name. If it\'s your Hub, put this address in "url" or "hosts" in config/hub.json on your computer, then try again.' }
      if (res.status === 400 || res.status === 403 || res.status === 409) return { ok: false, error: readError(body, 'That code didn\'t work. Make a new one on your computer.') }
      // A Hub without the pairing routes answers 404, or 401 from its passcode gate.
      if (res.status === 401 || res.status === 404) return { ok: false, error: 'That address answered, but it isn\'t a Hub that knows about phones. It may need updating.' }
      if (res.status === 502 || res.status === 503 || res.status === 504) return { ok: false, error: 'Your computer answered, but the Hub isn\'t running.' }
      return { ok: false, error: 'That address answered, but not the way a Hub should.' }
    },

    // Best effort: true when the Hub no longer lists this device.
    async removeSelf(address, token, deviceId) {
      try {
        const res = await request({ url: `${address}/api/pair/devices/${encodeURIComponent(deviceId)}/remove`, method: 'POST', token, timeoutMs: CHECK_TIMEOUT_MS })
        return res.status === 200 || res.status === 401 || res.status === 404
      } catch {
        return false
      }
    },

    // sent: the Hub has it. retry: nothing got through, safe to send later. unsure: the connection
    // dropped mid-send, so it may have arrived; only the person can decide whether to send it again.
    async send(address, token, text) {
      let res
      try {
        res = await request({ url: `${address}/api/chat/send`, method: 'POST', token, data: { text, detached: true }, timeoutMs: SEND_TIMEOUT_MS })
      } catch {
        return { result: 'unsure' }
      }
      if (res.status === 200) return { result: 'sent' }
      if (res.status === 401) return { result: 'retry', reason: 'removed' }
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) return { result: 'retry', reason: 'busy' }
      return { result: 'rejected', error: readError(parse(res.text), 'Your Hub didn\'t accept that.') }
    },
  }
}
