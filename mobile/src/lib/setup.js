// What someone needs before they can connect, all in one place.

// Where the code comes from. It finishes the sentence "To get a code, ...". When the Hub has its own screen
// for this, this line is the only change.
export const GET_CODE = 'open /pair/new in your Hub on your computer'

// The setup guide on the web. That page isn't live, so no link shows anywhere until this is set to
// https://docs.trylocalhub.com/setup
export const SETUP_URL = ''

export const WHAT_YOU_NEED = [
  'The LocalHub desktop app on your computer.',
  'A private network between your computer and this device. We recommend Tailscale: install it on both and sign in to the same account.',
  `A one-time pairing code. To get one, ${GET_CODE}.`,
]
