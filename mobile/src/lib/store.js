// Where a connection is kept. The token goes to `secure` and nowhere else. Everything in `prefs` is
// ordinary app data, which a device backup can include.
const CONN_KEY = 'connection'

export function createConnectionStore({ secure, prefs }) {
  const saveInfo = conn => prefs.set({ key: CONN_KEY, value: JSON.stringify(conn) })

  return {
    saveInfo,
    async save(conn, token) {
      await secure.set(token)
      await saveInfo(conn)
    },
    // Nothing saved means pair again. Storage that fails throws, so it's never mistaken for that.
    async load() {
      const { value } = await prefs.get({ key: CONN_KEY })
      if (!value) return null
      const token = await secure.get()
      if (typeof token !== 'string' || !token) return null // restored onto a new device: pair again
      try {
        return { conn: JSON.parse(value), token }
      } catch {
        return null
      }
    },
    // The connection without its token, which is all that's readable while the lock is on.
    async loadInfo() {
      const { value } = await prefs.get({ key: CONN_KEY })
      if (!value) return null
      try {
        return JSON.parse(value)
      } catch {
        return null
      }
    },
    removeToken: () => secure.remove(),
    async clear() {
      await secure.remove()
      await prefs.remove({ key: CONN_KEY })
    },
  }
}
