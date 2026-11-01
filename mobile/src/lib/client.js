// Talks to the Hub. `http` is CapacitorHttp in the app, which goes through the OS and so isn't subject
// to CORS: the Hub never allows other origins and shouldn't have to. The token only ever travels in a
// header, and nothing here logs a request.
const CHECK_TIMEOUT_MS = 6000
const CLAIM_TIMEOUT_MS = 15000
const SEND_TIMEOUT_MS = 20000
export const MAX_SHARE_CHARS = 8000 // the Hub's chat takes no more than this

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
        if (res.status === 200 && !body?.hub) return { status: 500 }
        return { status: res.status, hub: body?.hub }
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
      if (res.status === 200 && typeof body?.token === 'string' && body.hub) {
        return { ok: true, token: body.token, deviceId: body.deviceId, hub: body.hub }
      }
      if (res.status === 400 || res.status === 403 || res.status === 409) return { ok: false, error: body?.error || 'That code didn\'t work. Make a new one on your computer.' }
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
      return { result: 'rejected', error: parse(res.text)?.error || 'Your Hub didn\'t accept that.' }
    },
  }
}
