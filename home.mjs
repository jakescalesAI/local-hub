// Home tab back end: the saved homescreen layouts (desktop + mobile), shared by every device
// that opens the hub (any device that can reach it). The widgets themselves are drawn
// in the page (tabs/home.js) from the other tabs' endpoints; this file only stores which
// widgets sit on each layout, in which order, at which size and with which options.
//   GET  /api/home/layout          -> { desktop: [{ key, id, size, opts? }], ipad, mobile, tv: [...], at }
//   POST /api/home/layout          body { desktop?: [...], mobile?: [...] }  -> same shape
//   POST /api/home/layout          body { reset: 'desktop' | 'mobile' | 'both' } -> back to the default
//   POST /api/home/layout          body { page: 'page-x', desktop?: [...], reset?: ... } -> the same for an extra Home page
// Since 10-31 the layouts live in data/hub-settings.json (`widgets`), next to the rest of the hub
// settings; this route is a thin alias over that store (hub-settings.mjs) so both stay in step.
import { store } from './hub-settings.mjs'

export function create({ here }) {
  const st = store(here)
  const view = s => ({ desktop: s.widgets.desktop, ipad: s.widgets.ipad, mobile: s.widgets.mobile, tv: s.widgets.tv, pages: s.pages, at: s.at })

  return async function route(url, req, res, { send }) {
    if (url.pathname !== '/api/home/layout') return false
    try {
      if (req.method === 'GET') return send(res, 200, view(st.get())), true
      if (req.method === 'POST') {
        let raw = ''
        req.setEncoding('utf8')
        for await (const chunk of req) { raw += chunk; if (raw.length > 256 * 1024) return send(res, 413, { error: 'body is too large' }), true }
        let body
        try { body = raw ? JSON.parse(raw) : {} } catch { return send(res, 400, { error: 'body is not valid JSON' }), true }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'body must be an object' }), true
        const extra = Object.keys(body).filter(k => !['page', 'desktop', 'ipad', 'mobile', 'tv', 'reset'].includes(k))
        if (extra.length) return send(res, 400, { error: `unknown key ${extra[0]}: send desktop, ipad, mobile, tv or reset` }), true
        // An extra Home page keeps its own layouts; resetting one clears it.
        if (body.page !== undefined) {
          const layout = { id: body.page }
          for (const vk of ['desktop', 'ipad', 'mobile', 'tv']) {
            if (body.reset === vk || body.reset === 'both') layout[vk] = []
            else if (body[vk] !== undefined) layout[vk] = body[vk]
          }
          if (Object.keys(layout).length < 2) return send(res, 400, { error: 'send desktop, ipad, mobile, tv or reset' }), true
          return send(res, 200, view(st.patch({ pages: { layout } }))), true
        }
        const widgets = {}
        if (body.reset !== undefined) widgets.reset = body.reset
        else {
          for (const vk of ['desktop', 'ipad', 'mobile', 'tv']) if (body[vk] !== undefined) widgets[vk] = body[vk]
          if (!Object.keys(widgets).length) return send(res, 400, { error: 'send desktop, ipad, mobile, tv or reset' }), true
        }
        return send(res, 200, view(st.patch({ widgets }))), true
      }
      send(res, 405, { error: 'method not allowed' })
    } catch (e) {
      send(res, e.errors ? 400 : 500, { error: e.message, ...(e.errors ? { errors: e.errors } : {}) })
    }
    return true
  }
}
