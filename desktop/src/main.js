// Entry point. The Hub spawns process.execPath to run its helper scripts, and in the installed app
// that path is this app, so those launches are handed straight to Node before anything else starts.
import { runBundledScript } from './as-node.js'

if (!runBundledScript(process.argv)) await import('./app.js')
