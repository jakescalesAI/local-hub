const query = new URLSearchParams(location.search)
const port = query.get('port')

const MESSAGES = {
  starting: ['Starting your Hub', 'This usually takes a few seconds.'],
  restarting: ['Restarting your Hub', 'It stopped unexpectedly. Starting it again now.'],
  'hub-stopped': ['Waiting for your Hub', `Nothing is answering on port ${port}. This page reconnects by itself when it's back.`],
  'not-answering': ['Your Hub is not answering', `It started but isn't responding on port ${port}. The log is in the app's data folder.`],
  'no-server': ['No Hub found', `Nothing is answering on port ${port}, and this copy of the app has no built-in Hub to start.`],
  'port-conflict': ['Port in use', `Another program is using port ${port}, and it isn't a Hub. Close it, or choose another port in Settings.`],
}

const [title, detail] = MESSAGES[query.get('reason')] ?? MESSAGES.starting
document.getElementById('title').textContent = title
document.getElementById('detail').textContent = detail

document.getElementById('retry').addEventListener('click', () => window.hubDesktop.retry())

const bundled = document.getElementById('bundled')
bundled.hidden = query.get('reason') !== 'hub-stopped'
bundled.addEventListener('click', () => window.hubDesktop.startBundled())
