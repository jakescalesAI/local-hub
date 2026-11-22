import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_SIZE, fitToDisplays, launcherBounds } from '../../src/window-state.js'

const primary = { primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
const left = { workArea: { x: -2560, y: -200, width: 2560, height: 1400 } }
const right = { workArea: { x: 1920, y: 0, width: 1280, height: 680 } }

test('no saved position uses the default size and lets the system place it', () => {
  assert.deepEqual(fitToDisplays(null, [primary]), { ...DEFAULT_SIZE })
  assert.deepEqual(fitToDisplays({ width: 'wide' }, [primary]), { ...DEFAULT_SIZE })
})

test('bounds on a second monitor at negative coordinates are kept', () => {
  const saved = { x: -2000, y: -100, width: 1500, height: 900 }
  assert.deepEqual(fitToDisplays(saved, [primary, left]), saved)
})

test('a window spanning two monitors is kept', () => {
  const saved = { x: 1500, y: 100, width: 1000, height: 500 }
  assert.deepEqual(fitToDisplays(saved, [primary, right]), saved)
})

test('bounds on an unplugged monitor come back centred on the primary monitor', () => {
  const saved = { x: -2000, y: -100, width: 1500, height: 900 }
  const fitted = fitToDisplays(saved, [primary])
  assert.deepEqual(fitted, { x: 210, y: 70, width: 1500, height: 900 })
})

test('a window larger than the remaining monitor is fitted to it', () => {
  const fitted = fitToDisplays({ x: 5000, y: 0, width: 3000, height: 2000 }, [primary])
  assert.deepEqual(fitted, { x: 0, y: 0, width: 1920, height: 1040 })
})

test('boundary: the title bar must stay reachable, not just any corner of the window', () => {
  // Only the bottom edge shows on screen, and the title bar is above the monitor.
  assert.notEqual(fitToDisplays({ x: 100, y: -880, width: 1000, height: 900 }, [primary]).y, -880)
  // 120 px of title bar visible at the right edge is enough to grab.
  assert.equal(fitToDisplays({ x: 1800, y: 100, width: 1000, height: 700 }, [primary]).x, 1800)
  // 119 px is not.
  assert.notEqual(fitToDisplays({ x: 1801, y: 100, width: 1000, height: 700 }, [primary]).x, 1801)
})

test('the launcher is centred on the given monitor and stays inside it', () => {
  assert.deepEqual(launcherBounds(primary.workArea), { x: 640, y: 208, width: 640, height: 400 })
  assert.deepEqual(launcherBounds(left.workArea), { x: -1600, y: 80, width: 640, height: 400 })
  assert.deepEqual(launcherBounds({ x: 10, y: 20, width: 500, height: 300 }), { x: 10, y: 20, width: 500, height: 300 })
})
