// Everything that touches the device. The token lives in secure storage and is only ever handed to
// the HTTP call or the Hub web view's first request. The rest of the connection is not secret.
import { App } from '@capacitor/app'
import { Capacitor, CapacitorHttp, WebPlugin, registerPlugin } from '@capacitor/core'
import { DefaultAndroidWebViewOptions, DefaultWebViewOptions, DefaultiOSWebViewOptions, InAppBrowser, iOSViewStyle } from '@capacitor/inappbrowser'
import { Network } from '@capacitor/network'
import { Preferences } from '@capacitor/preferences'
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage'

const TOKEN_KEY = 'device-token'
const CONN_KEY = 'connection'
const isNative = Capacitor.isNativePlatform()

class HubNativeWeb extends WebPlugin {
  async scanQr() {
    if (__DEV__ && window.__testScan !== undefined) return window.__testScan === null ? { cancelled: true } : { text: window.__testScan }
    return { error: 'The camera isn\'t available here. Enter the address and code by hand.' }
  }
  async takeShare() {
    return {}
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

export async function prepareStorage() {
  await SecureStorage.setKeyPrefix('localhub_')
  await SecureStorage.setSynchronize(false) // never to iCloud Keychain
  if (Capacitor.getPlatform() === 'ios') await SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly)
}

export async function saveConnection(conn, token) {
  await SecureStorage.set(TOKEN_KEY, token, false, false)
  await saveConnectionInfo(conn)
}

export const saveConnectionInfo = conn => Preferences.set({ key: CONN_KEY, value: JSON.stringify(conn) })

export async function loadConnection() {
  const { value } = await Preferences.get({ key: CONN_KEY })
  if (!value) return null
  const token = await SecureStorage.get(TOKEN_KEY, false, false)
  if (typeof token !== 'string' || !token) return null // restored onto a new device: pair again
  return { conn: JSON.parse(value), token }
}

export async function clearConnection() {
  await SecureStorage.remove(TOKEN_KEY, false)
  await Preferences.remove({ key: CONN_KEY })
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

export const scanQr = () => HubNative.scanQr().catch(() => ({ error: 'The camera couldn\'t start. Enter the address and code by hand.' }))
export const takeShare = async () => (await HubNative.takeShare().catch(() => ({}))).text ?? ''
export const onShare = fn => HubNative.addListener('share', e => fn(e.text))

export const onResume = fn => App.addListener('appStateChange', s => s.isActive && fn())
export const onLink = fn => App.addListener('appUrlOpen', e => fn(e.url))
export const onBack = fn => { if (isNative) App.addListener('backButton', fn) }
export const minimize = () => App.minimizeApp()
export const launchLink = async () => (isNative ? (await App.getLaunchUrl())?.url ?? '' : '')
