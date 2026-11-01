const input = document.getElementById('query')

// "example.com" and "https://example.com" count as addresses. Anything else opens the Hub.
function asAddress(text) {
  const value = text.trim()
  if (!value || /\s/.test(value)) return null
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`
  try {
    const url = new URL(withScheme)
    return url.hostname.includes('.') ? url.href : null
  } catch {
    return null
  }
}

document.getElementById('form').addEventListener('submit', event => {
  event.preventDefault()
  const address = asAddress(input.value)
  if (address) window.hubDesktop.openUrl(address)
  else window.hubDesktop.openHub()
})

document.getElementById('open-hub').addEventListener('click', () => window.hubDesktop.openHub())

window.addEventListener('focus', () => input.focus())
