// The last step of quitting, in a process of its own on Electron's built-in Node.
//
// On a busy computer Electron can take many seconds to end once it's asked to, and nothing inside it
// can run by then. So this waits outside and ends the app if it's still here after afterMs.
const [pid, afterMs] = process.argv.slice(2).map(Number)

const startedAt = Date.now()
const timer = setInterval(() => {
  try {
    process.kill(pid, 0)
    if (Date.now() - startedAt >= afterMs) process.kill(pid, 'SIGKILL')
  } catch {
    clearInterval(timer)
  }
}, 250)
