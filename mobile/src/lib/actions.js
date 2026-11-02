// What a Home Screen widget can ask for. These only choose a screen: nothing here sends, publishes, edits,
// deletes or renders anything, and every one goes through the lock first. Anything else is refused,
// including extra path, a query or a fragment, so a link can't smuggle text or a command in.
const ACTIONS = new Set(['open', 'compose', 'status'])

export function parseQuickAction(text) {
  const raw = String(text ?? '').trim()
  if (/[?#]/.test(raw)) return null
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'localhub:' || url.hostname !== 'action' || url.username || url.password || url.port) return null
  const name = url.pathname.replace(/^\//, '')
  return ACTIONS.has(name) ? name : null
}
