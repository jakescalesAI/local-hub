// Runs in the child process, on Electron's built-in Node, and loads the Hub server unchanged.
import { pathToFileURL } from 'node:url'

// If the app dies without stopping us (a crash, say), this channel closes and the Hub stops with it.
process.on('disconnect', () => process.exit(0))

// Programs the Hub starts must not inherit this, or another Electron app (an editor) would run as
// plain Node. The Hub's own helpers come back through as-node.js instead, which only the installed
// app can do, so a from-source run keeps the variable.
if (process.env.LOCAL_HUB_RUNNER_CLEAN_ENV === '1') delete process.env.ELECTRON_RUN_AS_NODE
delete process.env.LOCAL_HUB_RUNNER_CLEAN_ENV

await import(pathToFileURL(process.argv[2]).href)
