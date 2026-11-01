// One rule for every window: only the Hub's own origin and this app's pages load inside the app.
// Everything else goes to the default browser, and the Hub's pages never get a preload bridge.
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PAGES_DIR = fileURLToPath(new URL('../pages/', import.meta.url))
export const PRELOAD = fileURLToPath(new URL('./preload.cjs', import.meta.url))

const pagesPrefix = pathToFileURL(PAGES_DIR).href
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])
const HUB_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen'])

const parse = url => { try { return new URL(url) } catch { return null } }

export const isLocalPage = url => {
  const parsed = parse(url)
  if (parsed?.protocol !== 'file:') return false
  return `${parsed.origin === 'null' ? 'file://' : parsed.origin}${parsed.pathname}`.toLowerCase().startsWith(pagesPrefix.toLowerCase())
}

export const isHubUrl = (url, origin) => parse(url)?.origin === origin

export const canOpenExternally = url => EXTERNAL_SCHEMES.has(parse(url)?.protocol)

export const securePrefs = ({ preload = false } = {}) => ({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  webviewTag: false,
  partition: 'persist:hub',
  ...(preload ? { preload: PRELOAD } : {}),
})

export const pagePath = name => path.join(PAGES_DIR, name)

// Hard stop at the network layer, which also catches redirects and iframes in every window.
export function hardenSession(session, getOrigin) {
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'], types: ['mainFrame', 'subFrame'] }, (details, callback) => {
    const allowed = isHubUrl(details.url, getOrigin()) || isLocalPage(details.url)
    callback({ cancel: !allowed })
  })
  const allowedPermission = (permission, url) => HUB_PERMISSIONS.has(permission) && isHubUrl(url, getOrigin())
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowedPermission(permission, details?.requestingUrl ?? contents.getURL()))
  })
  session.setPermissionCheckHandler((contents, permission, origin) => allowedPermission(permission, origin))
}

// `openHubPopup(url, contents)` decides what a same-origin popup does; it returns a window-open action.
export function guardContents(contents, { getOrigin, openExternal, openHubPopup }) {
  const leaving = url => !isHubUrl(url, getOrigin()) && !isLocalPage(url)
  contents.on('will-attach-webview', event => event.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    if (isHubUrl(url, getOrigin())) return openHubPopup(url, contents)
    openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (!leaving(url)) return
    event.preventDefault()
    openExternal(url)
  })
  contents.on('will-redirect', (event, url, _inPage, isMainFrame) => {
    if (!leaving(url)) return
    event.preventDefault()
    if (isMainFrame) openExternal(url)
  })
  // An embedded page from elsewhere stays blocked and does not pop a browser tab on every render.
  contents.on('will-frame-navigate', details => {
    if (!details.isMainFrame && leaving(details.url)) details.preventDefault()
  })
}
