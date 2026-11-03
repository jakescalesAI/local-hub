// Everything that touches the device. The token lives in secure storage and is only ever handed to
// the HTTP call or the Hub web view's first request. The rest of the connection is not secret.
import { App } from '@capacitor/app'
import { Capacitor, CapacitorHttp, WebPlugin, registerPlugin } from '@capacitor/core'
import { DefaultAndroidWebViewOptions, DefaultWebViewOptions, DefaultiOSWebViewOptions, InAppBrowser, iOSViewStyle } from '@capacitor/inappbrowser'
import { Network } from '@capacitor/network'
import { Preferences } from '@capacitor/preferences'
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage'
import { createConnectionStore } from './store.js'

const TOKEN_KEY = 'device-token'
const isNative = Capacitor.isNativePlatform()

class HubNativeWeb extends WebPlugin {
  async scanQr() {
    if (__DEV__ && window.__testScan !== undefined) return window.__testScan === null ? { cancelled: true } : { text: window.__testScan }
    return { error: 'The camera isn\'t available here. Enter the address and code by hand.' }
  }
  async takeShare() {
    return {}
  }
  async clearCookies() {
    if (__DEV__) {
      if (window.__testCookiesFail) throw new Error('test')
      window.__hubCookiesCleared = (window.__hubCookiesCleared ?? 0) + 1
    }
  }
  // A browser has no lock, so a browser build can't turn it on. The dev build stands in for the OS,
  // for the UI test only. It proves the app's side of the lock, not the OS's.
  async lockStatus() {
    if (__DEV__) {
      const t = window.__testLock ?? {}
      if (t.statusFails) throw new Error('test')
      return { enabled: !!localStorage.getItem('__testLockOn'), available: !t.reason, reason: t.reason ?? '', kind: t.kind ?? 'face' }
    }
    return { enabled: false, available: false, reason: 'noHardware', kind: '' }
  }
  async lockEnable({ token }) {
    if (__DEV__) {
      const t = window.__testLock ?? {}
      if (t.result) return { [t.result]: true }
      localStorage.setItem('__testLockToken', token)
      localStorage.setItem('__testLockOn', '1')
      return { enabled: true }
    }
    return { unavailable: true }
  }
  async lockUnlock() {
    if (__DEV__) {
      const t = window.__testLock ?? {}
      window.__testLockPrompts = (window.__testLockPrompts ?? 0) + 1
      if (t.hold) await new Promise(resolve => { window.__testLockRelease = resolve })
      if (t.result) return { [t.result]: true }
      return { token: localStorage.getItem('__testLockToken') }
    }
    return { unavailable: true }
  }
  async lockClear() {
    if (__DEV__) {
      if (window.__testLock?.clearFails) throw new Error('test')
      localStorage.removeItem('__testLockToken')
      localStorage.removeItem('__testLockOn')
    }
  }
  async lockShown() {
    if (__DEV__) window.__testLockShown = (window.__testLockShown ?? 0) + 1
    return { active: true }
  }
}
const HubNative = registerPlugin('HubNative', { web: () => new HubNativeWeb() })

// --- HTTP, with a hard limit on top of the OS's own timeouts

export const http = {
  request(options) {
    const limit = (options.readTimeout ?? 10_000) + 2000
    return Promise.race([
      CapacitorHttp.request(options),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), limit)),
    ])
  },
}

// --- Stored connection

const store = createConnectionStore({
  secure: {
    set: token => SecureStorage.set(TOKEN_KEY, token, false, false),
    get: () => SecureStorage.get(TOKEN_KEY, false, false),
    remove: () => SecureStorage.remove(TOKEN_KEY, false),
  },
  prefs: Preferences,
})

export async function prepareStorage() {
  if (__DEV__ && window.__testStorageFails) throw new Error('test')
  await SecureStorage.setKeyPrefix('localhub_')
  await SecureStorage.setSynchronize(false) // never to iCloud Keychain
  if (Capacitor.getPlatform() === 'ios') await SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly)
}

export const saveConnection = store.save
export const saveConnectionInfo = store.saveInfo
export const loadConnectionInfo = store.loadInfo
export const removePlainToken = store.removeToken
export const clearConnection = async () => {
  if (__DEV__ && window.__testClearFails) throw new Error('test')
  await store.clear()
}
export const loadConnection = async () => {
  if (__DEV__ && window.__testTokenReadFails) throw new Error('test')
  return store.load()
}

export const queueStorage = {
  get: async key => (await Preferences.get({ key })).value,
  set: (key, value) => Preferences.set({ key, value }),
}

// --- Hub web view

export async function openHub(address, token) {
  const url = `${address}/`
  if (!isNative) {
    if (__DEV__) window.__hubOpened = { url, hasAuth: !!token }
    return
  }
  await InAppBrowser.openInWebView({
    url,
    customHeaders: { Authorization: `Bearer ${token}` },
    options: {
      ...DefaultWebViewOptions,
      showURL: false,
      showToolbar: true,
      closeButtonText: 'Done',
      showNavigationButtons: false,
      clearCache: false,
      clearSessionCache: false,
      android: { ...DefaultAndroidWebViewOptions, hardwareBack: true, allowZoom: false },
      iOS: { ...DefaultiOSWebViewOptions, viewStyle: iOSViewStyle.FULL_SCREEN, allowsBackForwardNavigationGestures: true },
    },
  })
}

// Waits briefly: the lock mustn't hang on a browser that won't answer, and native code closes what's left.
export function closeHub() {
  if (!isNative) {
    if (__DEV__) window.__hubClosed = (window.__hubClosed ?? 0) + 1
    return Promise.resolve()
  }
  return Promise.race([InAppBrowser.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))])
}

// The Hub page's sign-in lives in the web view's cookies. This app has no other cookies, so all of
// them go. True when they're gone.
export const clearHubCookies = () => HubNative.clearCookies().then(() => true, () => false)

export function onHubClosed(fn) {
  if (isNative) InAppBrowser.addListener('browserClosed', fn)
}

// --- Device

export function deviceInfo() {
  const platform = Capacitor.getPlatform()
  const ipad = /iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
  return { platform, name: platform === 'android' ? 'Android device' : ipad ? 'iPad' : platform === 'ios' ? 'iPhone' : 'Browser' }
}

export const isOnline = async () => (await Network.getStatus()).connected
export const onOnlineChange = fn => Network.addListener('networkStatusChange', s => fn(s.connected))

// --- Lock. The token moves into storage only the OS can open after a biometric check, in native code.

export const lockStatus = () => HubNative.lockStatus()
export const lockEnable = token => HubNative.lockEnable({ token }).catch(() => ({ unavailable: true }))
export const lockUnlock = () => HubNative.lockUnlock().catch(() => ({ unavailable: true }))
export const lockClear = () => HubNative.lockClear()
export const lockShown = () => HubNative.lockShown().catch(() => ({ active: false }))
export const onLocked = fn => HubNative.addListener('locked', fn)

export const scanQr = () => HubNative.scanQr().catch(() => ({ error: 'The camera couldn\'t start. Enter the address and code by hand.' }))
export const takeShare = async () => (await HubNative.takeShare().catch(() => ({}))).text ?? ''
export const onShare = fn => HubNative.addListener('share', e => fn(e.text))

export const onResume = fn => App.addListener('appStateChange', s => s.isActive && fn())
export const onLink = fn => App.addListener('appUrlOpen', e => fn(e.url))
export const onBack = fn => { if (isNative) App.addListener('backButton', fn) }
export const minimize = () => App.minimizeApp()
export const launchLink = async () => (isNative ? (await App.getLaunchUrl())?.url ?? '' : '')
