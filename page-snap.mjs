// Link-to-link moves for a TV remote, shared by the TV browser (stream.mjs) and the assistant's browser (browser.mjs).
// SNAP_JS(x, y, dir) is a page expression: run it in the page (CSS pixels) and it gives the nearest visible thing
// you can press from (x, y) in that direction, as { x, y, w, h, cx, cy }, or null when there is none on screen.

export const SNAP_JS = (x, y, dir) => `((x, y, dir) => {
  const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],[onclick],[tabindex]:not([tabindex="-1"]),[contenteditable=""],[contenteditable=true]'
  const MODAL = 'dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]'
  const W = innerWidth, H = innerHeight
  const seen = new Set()
  // What can be pressed, in the page, inside web components (open shadow roots) and same-site frames: sites build
  // their dialogs and buttons both ways (Google's "Allow microphone" is one).
  const found = []
  const inside = (el, root) => { for (let n = el; n; n = n.parentNode || n.host) if (n === root) return true; return false }
  function collect(root, ox, oy, depth) {
    if (depth > 6) return
    for (const el of root.querySelectorAll(SEL)) found.push({ el, root, ox, oy })
    for (const host of root.querySelectorAll('*')) {
      if (host.shadowRoot) collect(host.shadowRoot, ox, oy, depth + 1)
      if (host.tagName === 'IFRAME') {
        try { const d = host.contentDocument; if (d) { const r = host.getBoundingClientRect(); collect(d, ox + r.left, oy + r.top, depth + 1) } } catch {}
      }
    }
  }
  collect(document, 0, 0, 0)
  function candidates(only) {
    const out = []
    for (const { el, root, ox, oy } of found) {
      if (only && !inside(el, only)) continue
      if (el.disabled || el.closest('[aria-hidden=true],[inert]')) continue
      // An outer link wins over the button or image inside it.
      const outer = el.parentElement && el.parentElement.closest(SEL)
      if (outer && outer.getBoundingClientRect().width < W * .9) continue
      // A link that wraps onto two lines: its widest piece, so the ring and OK land on the link, not the text between.
      const parts = el.getClientRects()
      let b = el.getBoundingClientRect()
      if (parts.length > 1) { let w = 0; for (const p of parts) if (p.height > 0 && p.width > w) { w = p.width; b = p } }
      const r = { left: b.left + ox, top: b.top + oy, right: b.right + ox, bottom: b.bottom + oy, width: b.width, height: b.height }
      if (r.width < 6 || r.height < 6 || r.bottom <= 0 || r.right <= 0 || r.top >= H || r.left >= W) continue
      // Mostly on screen, and not a whole-page wrapper or a banner: those aren't what you mean to press.
      const vis = (Math.min(r.right, W) - Math.max(r.left, 0)) * (Math.min(r.bottom, H) - Math.max(r.top, 0))
      if (vis < r.width * r.height * .5 || r.width * r.height > W * H * .45) continue
      const cx = Math.min(Math.max(r.left + r.width / 2, 1), W - 1), cy = Math.min(Math.max(r.top + r.height / 2, 1), H - 1)
      // On top where it is: asked of its own document or shadow root, which see inside themselves.
      const hit = root.elementFromPoint ? root.elementFromPoint(cx - ox, cy - oy) : null
      if (!hit || !(hit === el || el.contains(hit) || hit.contains(el) || inside(hit, el))) continue
      const key = Math.round(r.left) + ',' + Math.round(r.top)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ x: r.left, y: r.top, w: r.width, h: r.height, cx, cy })
    }
    return out
  }
  // The nearest thing ahead that way: ahead in the direction, then near in line with it (the usual TV weighting).
  function pick(list) {
    let best = null, score = Infinity
    for (const c of list) {
      const dx = c.cx - x, dy = c.cy - y
      const main = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy
      // Sideways: how far the pointer is from the thing's own span (0 when it lines up with any part of it), so a
      // wide search box straight above wins over a small icon off to the side.
      const side = dir === 'left' || dir === 'right' ? Math.max(0, c.y - y, y - (c.y + c.h)) : Math.max(0, c.x - x, x - (c.x + c.w))
      if (main <= 4) continue
      const s = main + side * 2.5
      if (s < score) { score = s; best = c }
    }
    return best
  }
  // A dialog that's up (a cookie notice, "Allow microphone"): what's in it first, as on a TV's own browser. Only a
  // real modal or a big one, not a hover card (Wikipedia's link previews are role=dialog too), and with nothing
  // left in it that way, the arrows go on to the page.
  const isModal = m => { const b = m.getBoundingClientRect(); if (b.width <= 40) return false
    try { if (m.matches(':modal')) return true } catch {}
    return m.getAttribute('aria-modal') === 'true' || m.getAttribute('role') === 'alertdialog' || b.width * b.height > W * H * .2 }
  for (const { el } of found) {
    const m = el.closest(MODAL)
    if (m && isModal(m)) { const inModal = candidates(m); if (inModal.length) { const b = pick(inModal); if (b) return b; break } }
  }
  const best = pick(candidates(null))
  return best
})(${Number(x)}, ${Number(y)}, ${JSON.stringify(String(dir))})`
