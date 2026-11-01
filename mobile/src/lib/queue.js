// Shared text waiting for the Hub, kept in the app's private storage, which an iOS device backup can
// include. An item marked `unsure` may already have arrived, so it is never sent again without the
// person saying so.
const KEY = 'share-queue'
export const MAX_QUEUE = 20

export function createQueue({ storage, send, now = () => Date.now(), id = () => Math.random().toString(36).slice(2) }) {
  let items = null
  let flushing = null

  async function load() {
    if (items) return items
    try {
      const parsed = JSON.parse((await storage.get(KEY)) ?? '[]')
      items = Array.isArray(parsed) ? parsed.filter(i => i && typeof i.text === 'string') : []
    } catch {
      items = []
    }
    return items
  }
  const save = () => storage.set(KEY, JSON.stringify(items))

  async function flushOnce() {
    await load()
    const summary = { sent: 0, unsure: 0, rejected: [], stopped: false }
    for (const item of [...items]) {
      if (item.unsure) continue
      const r = await send(item.text)
      if (r.result === 'sent') {
        items = items.filter(i => i.id !== item.id)
        summary.sent++
      } else if (r.result === 'unsure') {
        item.unsure = true
        summary.unsure++
      } else if (r.result === 'rejected') {
        item.unsure = true
        item.error = r.error
        summary.rejected.push(r.error)
      } else {
        summary.stopped = true
        await save()
        return summary
      }
      await save()
    }
    return summary
  }

  return {
    async list() {
      return [...(await load())]
    },
    async add(text) {
      await load()
      if (items.length >= MAX_QUEUE) return { ok: false, error: `${MAX_QUEUE} messages are already waiting. Send or discard some first.` }
      const item = { id: id(), text, at: now() }
      items.push(item)
      await save()
      return { ok: true, item }
    },
    async remove(itemId) {
      await load()
      items = items.filter(i => i.id !== itemId)
      await save()
    },
    // The person chose to send an unsure item again.
    async retry(itemId) {
      await load()
      const item = items.find(i => i.id === itemId)
      if (!item) return
      delete item.unsure
      delete item.error
      await save()
    },
    async clear() {
      items = []
      await save()
    },
    // Two callers (resume, network change) must not send the same item twice.
    flush() {
      flushing ??= flushOnce().finally(() => (flushing = null))
      return flushing
    },
  }
}
