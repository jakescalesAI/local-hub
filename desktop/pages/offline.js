const query = new URLSearchParams(location.search)
const port = query.get('port')

const MESSAGES = {
  starting: ['Starting your Hub', 'This usually takes a few seconds.'],
  restarting: ['Restarting your Hub', 'It stopped unexpectedly. Starting it again now.'],
  'hub-stopped': ['Waiting for your Hub', `Nothing is answering on port ${port}. This page reconnects by itself when it's back.`],
  'not-answering': ['Your Hub is not answering', `It started but isn't responding on port ${port}. The log is in the app's data folder.`],
  'start-failed': ['Your Hub did not start', `It didn't open port ${port} after three tries, so the app has stopped trying. The log is in the app's data folder.`],
  'no-server': ['No Hub found', `Nothing is answering on port ${port}, and there is no Hub to start. If you chose a Hub folder in Settings, check it is still there.`],
  'port-conflict': ['Port in use', `Another program is using port ${port}, and it isn't a Hub. Close it, or choose another port in Settings.`],
  'port-silent': ['Port in use', `Something is holding port ${port} without answering. If it's a busy Hub, this page clears when it answers. If not, close it, or choose another port in Settings.`],
}

const [title, detail] = MESSAGES[query.get('reason')] ?? MESSAGES.starting
document.getElementById('title').textContent = title
document.getElementById('detail').textContent = detail

document.getElementById('retry').addEventListener('click', () => window.hubDesktop.retry())

const bundled = document.getElementById('bundled')
bundled.hidden = query.get('reason') !== 'hub-stopped'
bundled.addEventListener('click', () => window.hubDesktop.startBundled())
