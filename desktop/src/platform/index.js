// Everything that differs per operating system lives behind this one import.
import * as posix from './posix.js'
import * as windows from './windows.js'

export default process.platform === 'win32' ? windows : posix
