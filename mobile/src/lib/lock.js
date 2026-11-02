// The words for the lock. The lock itself is in native code, where the OS holds the key.
export function lockName(kind) {
  return { face: 'Face ID', touch: 'Touch ID' }[kind] ?? 'your fingerprint or face'
}

const upper = text => text[0].toUpperCase() + text.slice(1)

// Why it can't be turned on right now.
export function lockUnavailable(reason, name) {
  if (reason === 'notEnrolled') return `Set up ${name} in your device's settings first, then come back here.`
  if (reason === 'noPasscode') return `Set a passcode and ${name} in your device's settings first, then come back here.`
  if (reason === 'denied') return `${upper(name)} is turned off for Local Hub. Turn it on in your device's settings.`
  if (reason === 'noHardware') return 'This device has no Face ID, Touch ID or fingerprint sensor the lock can use.'
  return 'The lock isn\'t available on this device right now.'
}

// What the lock screen says after a try. A cancel says nothing: the person knows they cancelled.
export function unlockMessage(result, name) {
  if (result.lockedOut) return 'Too many tries. Lock this device, unlock it with your passcode, then try again.'
  if (result.unavailable) return `${upper(name)} isn't available right now. Local Hub stays locked. Check your device's settings, then try again.`
  if (result.failed) return 'That didn\'t match. Try again.'
  return ''
}
