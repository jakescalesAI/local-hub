// What the app can honestly say about a Hub it can't see. Asleep and off look the same from a phone,
// so the copy never claims to know which.
export const STATES = {
  checking: { tone: 'quiet', pill: 'Checking', title: 'Checking your Hub', body: '', canOpen: false, canRetry: false },
  ok: { tone: 'good', pill: 'Connected', title: 'Connected', body: '', canOpen: true, canRetry: false },
  offline: {
    tone: 'warn',
    pill: 'Offline',
    title: 'You\'re offline',
    body: 'This phone has no internet connection. Anything you share will wait here.',
    canOpen: false,
    canRetry: true,
  },
  asleep: {
    tone: 'warn',
    pill: 'Can\'t reach it',
    title: 'Can\'t reach your computer',
    body: 'It may be asleep, or the private network may be off on this phone. Anything you share will wait here.',
    canOpen: false,
    canRetry: true,
  },
  stopped: {
    tone: 'warn',
    pill: 'Hub stopped',
    title: 'The Hub isn\'t running',
    body: 'Your computer answered, but the Hub isn\'t running on it. Start the Hub, then try again.',
    canOpen: false,
    canRetry: true,
  },
  removed: {
    tone: 'bad',
    pill: 'Removed',
    title: 'This device was removed',
    body: 'Your Hub no longer accepts this device. Pair again to reconnect.',
    canOpen: false,
    canRetry: false,
  },
  outdated: {
    tone: 'bad',
    pill: 'Needs update',
    title: 'This Hub needs updating',
    body: 'It answered, but it doesn\'t know about phones yet. Update the Hub, then try again.',
    canOpen: false,
    canRetry: true,
  },
  unexpected: {
    tone: 'bad',
    pill: 'Problem',
    title: 'Your Hub sent an odd answer',
    body: 'Something answered at this address, but not the way a Hub should. Check the address, then try again.',
    canOpen: false,
    canRetry: true,
  },
}

export function classify({ online = true, status = null } = {}) {
  if (status === 200) return 'ok'
  if (status === 401) return 'removed'
  if (status === 404) return 'outdated'
  if (status === 502 || status === 503 || status === 504) return 'stopped'
  if (status !== null) return 'unexpected'
  return online ? 'asleep' : 'offline'
}
