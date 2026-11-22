// Geometry only, no Electron, so it can be tested against any monitor layout.
export const DEFAULT_SIZE = Object.freeze({ width: 1280, height: 820 })
export const MIN_SIZE = Object.freeze({ width: 640, height: 420 })
const TITLE_BAR = 40
const MIN_GRAB = { width: 120, height: 20 }

const finite = n => typeof n === 'number' && Number.isFinite(n)

function overlap(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return { width: Math.max(0, width), height: Math.max(0, height) }
}

// Keeps saved bounds when the title bar is still reachable on some monitor. Otherwise (a monitor was
// unplugged, say) the window comes back on the primary monitor at the same size, fitted and centred.
export function fitToDisplays(saved, displays) {
  const primary = (displays.find(d => d.primary) ?? displays[0]).workArea
  if (!saved || ![saved.width, saved.height].every(n => finite(n) && n > 0)) return { ...DEFAULT_SIZE }

  const size = { width: Math.max(saved.width, MIN_SIZE.width), height: Math.max(saved.height, MIN_SIZE.height) }
  if (finite(saved.x) && finite(saved.y)) {
    const titleBar = { x: saved.x, y: saved.y, width: size.width, height: TITLE_BAR }
    const reachable = displays.some(d => {
      const seen = overlap(titleBar, d.workArea)
      return seen.width >= MIN_GRAB.width && seen.height >= MIN_GRAB.height
    })
    if (reachable) return { x: saved.x, y: saved.y, ...size }
  }

  const width = Math.min(size.width, primary.width)
  const height = Math.min(size.height, primary.height)
  return {
    x: primary.x + Math.round((primary.width - width) / 2),
    y: primary.y + Math.round((primary.height - height) / 2),
    width,
    height,
  }
}

export const LAUNCHER_SIZE = Object.freeze({ width: 640, height: 400 })

// Centred across the monitor, a fifth of the way down, always inside its work area.
export function launcherBounds(workArea, size = LAUNCHER_SIZE) {
  const width = Math.min(size.width, workArea.width)
  const height = Math.min(size.height, workArea.height)
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.min(Math.round(workArea.height / 5), workArea.height - height),
    width,
    height,
  }
}
