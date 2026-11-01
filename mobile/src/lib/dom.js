// Builds elements. Text always goes in as text nodes, so nothing from a Hub, a share or a link can
// become markup. There is deliberately no way to pass raw HTML.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value)
    else if (key === 'value') el.value = value
    else if (key === 'disabled') el.disabled = true
    else el.setAttribute(key, value === true ? '' : value)
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    el.append(child)
  }
  return el
}
