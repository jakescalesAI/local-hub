// Keeps the installed app up to date from the project's GitHub releases (latest.yml beside LocalHub-Setup.exe).
// A new version downloads quietly, says once that it's ready, and installs the next time the app quits, or now from
// the tray. A run from source (npm start) never updates itself: git is how that copy moves on.
// Electron's app and electron-updater's autoUpdater come in from app.js, so this runs under plain node in tests.

const FIRST_CHECK_MS = 30_000
const EVERY_MS = 6 * 60 * 60_000

export function createUpdater({ app, updater, tell, onChange = () => {}, log = console, packaged = app.isPackaged } = {}) {
  const state = { status: 'idle', version: '' } // idle | checking | downloading | ready | error
  let runAfter = false
  if (!packaged) return { enabled: false, state, check: async () => null, installNow: () => false, finishOnExit: () => false, stop: () => {} }
  const au = updater
  au.autoDownload = true
  au.autoInstallOnAppQuit = false // the app's own quit (hub stopped first) hands over in finishOnExit
  au.logger = null
  const set = (status, version = state.version) => { state.status = status; state.version = version || ''; onChange(state) }
  au.on('checking-for-update', () => { if (state.status !== 'ready') set('checking') })
  au.on('update-available', info => set('downloading', info?.version))
  au.on('update-not-available', () => { if (state.status !== 'ready') set('idle', '') })
  au.on('download-progress', () => {})
  au.on('update-downloaded', info => {
    const fresh = state.status !== 'ready'
    set('ready', info?.version)
    if (fresh) tell(`LocalHub ${state.version} is ready. It installs the next time LocalHub restarts, or choose Restart to update in the tray.`)
  })
  au.on('error', e => {
    log.error('update check:', e?.message || e)
    if (state.status !== 'ready') set('error')
  })
  const check = async () => {
    if (state.status === 'ready' || state.status === 'downloading') return null
    try { return await au.checkForUpdates() } catch (e) { log.error('update check:', e?.message || e); return null }
  }
  const first = setTimeout(check, FIRST_CHECK_MS)
  const every = setInterval(check, EVERY_MS)
  first.unref?.(); every.unref?.()
  return {
    enabled: true,
    state,
    check,
    // Restart to update: the app quits the usual way (its Hub stops first), and finishOnExit opens it again after.
    installNow: () => { if (state.status !== 'ready') return false; runAfter = true; app.quit(); return true },
    // Called last on the way out: a ready update installs quietly. True when the installer has taken over the exit.
    finishOnExit: () => { if (state.status !== 'ready') return false; try { au.quitAndInstall(true, runAfter); return true } catch (e) { log.error('update install:', e?.message || e); return false } },
    stop: () => { clearTimeout(first); clearInterval(every) },
  }
}
