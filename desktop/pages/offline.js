const query = new URLSearchParams(location.search)
const port = query.get('port')

// [title, detail, working]: while it's working the line runs and nothing asks anything of you;
// when it's stuck the line goes and the buttons come.
const MESSAGES = {
  starting: ['Starting your Hub', '', true],
  restarting: ['Starting your Hub again', 'It stopped unexpectedly.', true],
  'hub-stopped': ['Waiting for your Hub', `Nothing is answering on port ${port} yet. This connects by itself when it's back.`, true],
  'not-answering': ['Your Hub is not answering', `It started but isn't responding on port ${port}. The log is in the app's data folder.`, false],
  'start-failed': ['Your Hub did not start', `It didn't open port ${port} after three tries, so the app has stopped trying. The log is in the app's data folder.`, false],
  'no-server': ['No Hub found', `Nothing is answering on port ${port}, and there is no Hub to start. If you chose a Hub folder in Settings, check it is still there.`, false],
  'port-conflict': ['Port in use', `Another program is using port ${port}, and it isn't a Hub. Close it, or choose another port in Settings.`, false],
  'port-silent': ['Port in use', `Something is holding port ${port} without answering. If it's a busy Hub, this clears when it answers. If not, close it, or choose another port in Settings.`, false],
}

const reason = query.get('reason')
const [title, detail, working] = MESSAGES[reason] ?? MESSAGES.starting
document.getElementById('title').textContent = title
document.getElementById('detail').textContent = detail
document.getElementById('stack').classList.toggle('stuck', !working)

const bundled = document.getElementById('bundled')
bundled.hidden = reason !== 'hub-stopped'
document.getElementById('actions').hidden = working && bundled.hidden

document.getElementById('retry').addEventListener('click', () => window.hubDesktop.retry())
bundled.addEventListener('click', () => window.hubDesktop.startBundled())
