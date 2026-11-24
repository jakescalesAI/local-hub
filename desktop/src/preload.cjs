// Bridge for this app's own pages only. Hub pages load with it attached (a window can show either)
// but get nothing: it exposes itself on file: pages, and the main process checks every sender too.
const { contextBridge, ipcRenderer } = require('electron')

if (location.protocol === 'file:') {
  const call = channel => (...args) => ipcRenderer.invoke(`desktop:${channel}`, ...args)
  contextBridge.exposeInMainWorld('hubDesktop', {
    openHub: call('open-hub'),
    openUrl: call('open-url'),
    closeLauncher: call('close-launcher'),
    retry: call('retry'),
    startBundled: call('start-bundled'),
    chooseHubFolder: call('choose-hub-folder'),
    getSettings: call('get-settings'),
    saveSettings: call('save-settings'),
  })
}
