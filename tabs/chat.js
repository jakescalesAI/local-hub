// Hub Assistant: an ask bar at the bottom centre of every tab. Type, press Enter, and the answer
// streams into a compact card that rises above the bar (markdown, collapsed tool rows, Stop,
// close). Follow-ups continue the same conversation. The + button left of the input opens a menu:
// Attach files (chips above the input, sent as base64), Model (Opus/Sonnet/Haiku 5.5, kept in
// localStorage), Dictate (Web Speech API; says why when the page can't use it) and Full screen
// (also Ctrl+/): whole conversation, history, new chat. Under each reply a hover (tap on touch)
// row shows sent time, duration and tokens, then Reply (quotes it above the input as context) and
// Copy. Talks to /api/chat/*
// (chat.mjs), which runs the local Claude Code CLI: a general agent that knows this hub best.
//
// Self-contained: it injects its own bar, card and overlay inside a Shadow DOM (so the hub's
// generic CSS, click handlers and shortcuts cannot touch it), plus two small global rules that
// keep the page and the hub's toast clear of the bar. Colours come from the hub's :root tokens,
// so light and dark match. The bar is a chat composer (54px glass
// pill, round send button).
//
//   * Bar: fixed, bottom centre, max 640px (full width minus 16px on a phone), safe-area padding.
//   * Card: latest exchange only. Close (x) hides it; the conversation goes on.
//   * Full chat: overlay on desktop, full-height sheet at max-width 720px. Esc / the collapse
//     button returns to the bar.
//   * Keys: Enter sends, Shift+Enter adds a line. Ctrl+/ (Cmd+/) toggles the full chat, Ctrl+K
//     (Cmd+K) focuses the bar, Esc closes the card or the full chat.
//   * Each message carries the tab the user is looking at ({ tab, tabTitle, narrow }).
//   * The reply streams as NDJSON: session, text_start, delta, text_end, tool, tool_result, error,
//     ping, done. Every string is escaped before it reaches the DOM.
// Uses the main script's globals only at call time: env, TABS.
;(() => {
  if (window.__hubChat) return
  window.__hubChat = true

  /* ---------- helpers ---------- */

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const AGENT = window.HUB_CONF?.assistant?.name || 'Hub Assistant'
  const store = {
    get(k, d = '') { try { const v = localStorage.getItem(k); return v == null ? d : v } catch { return d } },
    set(k, v) { try { localStorage.setItem(k, v) } catch {} },
  }
  const mq = q => (window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} })
  const PHONE = mq('(max-width: 720px)')
  const REDUCED = mq('(prefers-reduced-motion: reduce)')
  const TITLES = { home: 'Home', laptop: 'Laptop', server: 'Server', drives: 'Drives', ai: 'AI', cloud: 'Cloud', calendar: 'Calendar', stripe: 'Stripe' }
  const SUGGEST = {
    home: ['Is anything down right now?', 'What can I put on the Home screen?'],
    laptop: ['What is running on the laptop?', 'Are my syncs up to date?'],
    server: ['What is running on the server?', 'How loaded is the server?'],
    drives: ['How full are my drives?', 'How much iCloud storage is left?'],
    ai: ['What is my Claude usage right now?', 'How many tokens did I use today?'],
    cloud: ['Is anything down in Coolify?', 'Which servers are up?'],
    calendar: ['What is on my calendar this week?', 'How do I add an event?'],
    stripe: ['What is my Stripe balance?', 'How do I connect Stripe?'],
  }
  const curEnv = () => { try { return typeof env === 'string' ? env : '' } catch { return '' } }
  const curTitle = () => { const e = curEnv(); try { return (window.TABS && window.TABS[e] && window.TABS[e].title) || TITLES[e] || e } catch { return TITLES[e] || e } }
  const ago = ms => {
    const s = Math.max(0, (Date.now() - ms) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)} min ago`
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`
    if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  /* ---------- markdown (headings, lists, code, tables, quotes, links); everything is escaped ---------- */

  function inline(src) {
    const codes = []
    let s = String(src).replace(/\u0000/g, '').replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000` })
    s = esc(s)
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`)
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (_, a, u) => `${a}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`)
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    s = s.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>')
    s = s.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?![*\w])/g, '$1<em>$2</em>')
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i] ?? '')}</code>`)
  }

  const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
  const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
  const cells = ln => ln.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
  const untab = ln => ln.replace(/^\s+/, w => w.replace(/\t/g, '    '))

  const md = src => mdBlocks(src).join('')

  // One HTML string per top-level block, each a single element.
  function mdBlocks(src) {
    const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
    const out = []
    let i = 0
    // A table needs its header row followed by a |---| line; it may follow a paragraph with no blank line.
    const isTable = k => k + 1 < lines.length && lines[k].includes('|') && TABLE_SEP.test(lines[k + 1]) && lines[k + 1].includes('-')
    const blockStart = k => { const ln = lines[k]; return /^\s*```/.test(ln) || /^#{1,6}\s/.test(ln) || /^\s*>/.test(ln) || LIST_RE.test(ln) || /^\s*([-*_])\1{2,}\s*$/.test(ln) || isTable(k) }
    while (i < lines.length) {
      const ln = lines[i]
      let m
      if ((m = /^\s*```\s*([\w+#.-]*)/.exec(ln))) {
        const body = []
        i++
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++])
        i++ // closing fence (or end of text while streaming)
        out.push(`<div class="code"><div class="code-head"><span>${esc(m[1] || 'code')}</span><button type="button" class="cp" aria-label="Copy code">${IC.copy}<span>Copy</span></button></div><pre><code>${esc(body.join('\n'))}</code></pre></div>`)
      } else if (!ln.trim()) {
        i++
      } else if ((m = /^(#{1,6})\s+(.*)$/.exec(ln))) {
        const lvl = Math.min(5, m[1].length + 1) // # -> h2 ... #### and deeper -> h5
        out.push(`<h${lvl}>${inline(m[2].replace(/\s+#+\s*$/, ''))}</h${lvl}>`)
        i++
      } else if (/^\s*([-*_])\1{2,}\s*$/.test(ln)) {
        out.push('<hr>')
        i++
      } else if (/^\s*>/.test(ln)) {
        const q = []
        while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''))
        out.push(`<blockquote>${md(q.join('\n'))}</blockquote>`)
      } else if (isTable(i)) {
        const head = cells(ln)
        const align = cells(lines[i + 1]).map(c => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''))
        i += 2
        const rows = []
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]))
        const td = (t, c, k) => `<${t}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c ?? '')}</${t}>`
        out.push(`<div class="tbl"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => td('td', r[k], k)).join('')}</tr>`).join('')}</tbody></table></div>`)
      } else if ((m = LIST_RE.exec(untab(ln)))) {
        const ordered = /\d/.test(m[2])
        const base = m[1].length
        const first = parseInt(m[2], 10)
        const items = []
        while (i < lines.length) {
          // Blank lines don't end a list when more of it follows: another item, or text indented under this one.
          let next = i
          while (next < lines.length && !lines[next].trim()) next++
          if (next === lines.length) break
          const cur = untab(lines[next])
          const indent = cur.search(/\S/)
          const lm = LIST_RE.exec(cur)
          if (lm && lm[1].length <= base + 1 && /\d/.test(lm[2]) === ordered) { items.push({ text: lm[3], sub: [] }); i = next + 1; continue }
          if (indent < base + 2) break
          const it = items.at(-1)
          if (next > i && it.sub.length) it.sub.push('')
          it.cut ??= indent
          it.sub.push(cur.slice(Math.min(it.cut, indent)))
          i = next + 1
        }
        const tag = ordered ? 'ol' : 'ul'
        // Text between items splits a list in two, so the second part starts at its own number.
        const start = ordered && first !== 1 ? ` start="${first}"` : ''
        out.push(`<${tag}${start}>${items.map(it => `<li>${inline(it.text)}${it.sub.length ? md(it.sub.join('\n')) : ''}</li>`).join('')}</${tag}>`)
      } else {
        const p = []
        while (i < lines.length && lines[i].trim() && !(p.length && blockStart(i))) p.push(lines[i++])
        out.push(`<p>${p.map(inline).join('<br>')}</p>`)
      }
    }
    return out
  }

  // Streaming text ends mid-line. Holds back a line start that could still become a list, heading, fence or table, and
  // closes open bold, code and links, so markup is never typed out and then snapped into place.
  function settled(s) {
    const nl = s.lastIndexOf('\n')
    let head = s.slice(0, nl + 1), tail = s.slice(nl + 1)
    if ((head.match(/^\s*```/gm) || []).length % 2) return /^\s*`{1,3}$/.test(tail) ? head : s // inside a code block
    if (/^\s*(\d{1,3}[.)]?|[-*+_]{1,3}|#{1,6}|>|`{1,2}|```.*|\|.*|~{1,2})?\s*$/.test(tail)) tail = ''
    if (!tail) {
      const rows = head.split('\n')
      const a = rows[rows.length - 2] ?? '', b = rows[rows.length - 3] ?? ''
      // A table's header row reads as plain text until its |---| line is complete.
      if (/^\s*\|/.test(a) && !TABLE_SEP.test(a) && !/^\s*\|/.test(b)) head = rows.slice(0, -2).join('\n') + '\n'
      return head
    }
    const link = /\[([^\]\n]*)(?:\]\([^)\n]*|\]?)$/.exec(tail)
    if (link && !/\]$/.test(tail)) tail = tail.slice(0, link.index) + link[1]
    if ((tail.match(/`/g) || []).length % 2) tail = tail.endsWith('`') ? tail.slice(0, -1) : tail + '`'
    const plain = tail.replace(/`[^`]*`/g, '')
    if ((plain.match(/\*\*/g) || []).length % 2) {
      if (/\*\*\s*$/.test(tail)) tail = tail.replace(/\*\*\s*$/, '')
      else tail = tail.replace(/\*$/, '') + '**'
    } else if (/(^|[^*\w])\*[^*\s][^*]*$/.test(plain.replace(/\*\*/g, ''))) tail += '*'
    if ((plain.match(/~~/g) || []).length % 2) tail = /~~\s*$/.test(tail) ? tail.replace(/~~\s*$/, '') : tail + '~~'
    return head + tail
  }

  // Makes `a` match `b` in place, so selection, hover and a code block's scroll survive.
  function morph(a, b) {
    for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name)
    for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value)
    const A = [...a.childNodes], B = [...b.childNodes]
    B.forEach((y, i) => {
      const x = A[i]
      if (!x) a.append(y)
      else if (x.nodeType === 3 && y.nodeType === 3) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue }
      else if (x.nodeType === 1 && y.nodeType === 1 && x.tagName === y.tagName) morph(x, y)
      else x.replaceWith(y)
    })
    A.slice(B.length).forEach(x => x.remove())
  }

  // Updates only the blocks whose HTML changed: finished blocks are never touched.
  function patchBlocks(el, blocks, prev) {
    const tpl = document.createElement('template')
    for (let i = 0; i < blocks.length; i++) {
      if (prev?.[i] === blocks[i]) continue
      tpl.innerHTML = blocks[i]
      const nu = tpl.content.firstElementChild, old = el.children[i]
      if (tpl.content.childElementCount !== 1) { el.innerHTML = blocks.join(''); return null } // not one element after all
      if (!old) el.append(nu)
      else if (old.tagName === nu.tagName) morph(old, nu)
      else old.replaceWith(nu)
    }
    while (el.children.length > blocks.length) el.lastElementChild.remove()
    return blocks
  }


  /* ---------- icons ---------- */

  const svg = (d, w = 20) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
  const IC = {
    chat: svg('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.7 8.7 0 0 1-3.6-.8L3 21l1.9-5.1A8.3 8.3 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z"/>', 24),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
    close: svg('<path d="M18 6 6 18M6 6l12 12"/>', 18),
    up: svg('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>', 20),
    stop: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>',
    chev: svg('<path d="m9 6 6 6-6 6"/>', 14),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 14),
    warn: svg('<path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/>', 14),
    pencil: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', 16),
    trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 14h10l1-14"/>', 16),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>', 14),
    expand: svg('<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>', 18),
    collapse: svg('<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/>', 18),
    plus22: svg('<path d="M12 5v14M5 12h14"/>', 22),
    clip: svg('<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6a4 4 0 1 1 5.7 5.7l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5"/>', 19),
    gauge: svg('<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>', 19),
    compass: svg('<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z"/>', 19),
    brain: svg('<path d="M12 18V5"/><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"/><path d="M17.6 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.6 1.5"/><path d="M18 5.1a4 4 0 0 1 2.5 5.8"/><path d="M18 18a4 4 0 0 0 2-7.5"/><path d="M19.97 17.5A4 4 0 1 1 12 18a4 4 0 1 1-7.97-.5"/><path d="M6 18a4 4 0 0 1-2-7.5"/><path d="M6 5.1a4 4 0 0 0-2.5 5.8"/>', 19),
    mic: svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>', 19),
    mic22: svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>', 20),
    expand19: svg('<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>', 19),
    collapse19: svg('<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/>', 19),
    file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>', 15),
    x14: svg('<path d="M18 6 6 18M6 6l12 12"/>', 14),
    save: svg('<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>', 14),
    save18: svg('<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>', 18),
    copy18: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>', 18),
    reply: svg('<path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>', 14),
  }

  /* ---------- styles ---------- */

  const CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
[hidden] { display: none !important; }
.root { position: fixed; inset: 0; z-index: 50; pointer-events: none; font: 15px/1.4 var(--font, system-ui, sans-serif); letter-spacing: -0.016em; color: var(--label, #000); -webkit-font-smoothing: antialiased; --kb: 0px; --barh: 54px; --code-font: ui-monospace, "SF Mono", SFMono-Regular, Menlo, "Cascadia Mono", "Cascadia Code", Consolas, monospace; }
button, input, textarea, select { font: inherit; letter-spacing: inherit; color: inherit; }
button { border: 0; background: none; padding: 0; cursor: pointer; }
button:focus-visible, .row:focus-visible { outline: 2px solid var(--blue, #007aff); outline-offset: 2px; }
textarea, textarea:focus, textarea:focus-visible { outline: none; box-shadow: none; }
.glass { background: var(--material, rgba(249, 249, 249, .78)); -webkit-backdrop-filter: saturate(180%) blur(24px); backdrop-filter: saturate(180%) blur(24px); }

/* ----- the bar ----- */
.bar { position: fixed; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom) + var(--kb)); width: min(640px, calc(100vw - 32px)); transform: translateX(-50%); pointer-events: auto; transition: opacity .2s, transform .38s var(--ease, ease); }
.bar.away { opacity: 0; transform: translateX(-50%) translateY(20px); pointer-events: none; }
.pill { display: flex; align-items: flex-end; gap: 2px; min-height: 54px; padding: 5px; border-radius: 27px; box-shadow: 0 0 0 .5px var(--sep, rgba(60, 60, 67, .18)), 0 10px 32px rgba(0, 0, 0, .16), 0 2px 6px rgba(0, 0, 0, .06); transition: border-radius .2s, box-shadow .2s; }
.pill:focus-within { box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--blue, #007aff) 55%, transparent), 0 10px 32px rgba(0, 0, 0, .16); }
.pill.multi { border-radius: 24px; }
.ib { flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: var(--label-2, rgba(60, 60, 67, .6)); }
.ib:hover { background: var(--fill, rgba(118, 118, 128, .12)); color: var(--label, #000); }
.ib:active { background: var(--fill-2, rgba(118, 118, 128, .2)); }
textarea { flex: 1; min-width: 0; resize: none; border: 0; outline: 0; background: none; padding: 11px 6px; max-height: 154px; min-height: 44px; line-height: 22px; font-size: 16px; display: block; }
textarea::placeholder { color: var(--label-2, rgba(60, 60, 67, .6)); }
.send { flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--blue, #007aff); transition: opacity .15s, transform .2s var(--ease, ease), background .15s; }
.send:disabled { opacity: .28; cursor: default; }
.send:not(:disabled):active { transform: scale(.9); }
.send.stop { background: var(--label, #000); color: var(--surface, #fff); }

/* ----- the answer card ----- */
.card { position: fixed; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom) + var(--kb) + var(--barh) + 10px); width: min(640px, calc(100vw - 32px)); max-height: clamp(254px, calc(33vh + 54px), 434px); display: flex; flex-direction: column; border-radius: 22px; overflow: hidden; transform: translate(-50%, 16px) scale(.98); transform-origin: 50% 100%; opacity: 0; visibility: hidden; pointer-events: none; background: color-mix(in srgb, var(--surface, #fff) 86%, transparent); -webkit-backdrop-filter: saturate(180%) blur(24px); backdrop-filter: saturate(180%) blur(24px); box-shadow: 0 0 0 .5px var(--sep, rgba(60, 60, 67, .18)), 0 18px 50px rgba(0, 0, 0, .22), 0 3px 10px rgba(0, 0, 0, .08); transition: opacity .2s, transform .38s var(--ease, ease), visibility 0s .38s; }
.card.on { transform: translate(-50%, 0); opacity: 1; visibility: visible; pointer-events: auto; transition: opacity .2s, transform .38s var(--ease, ease), visibility 0s; }
/* The header of both chats: a flat bar flush to its panel, on the Hub's glass. Only this bar has a hover effect: a soft sheen that follows the pointer. */
.ghead { position: relative; isolation: isolate; flex: none; z-index: 2; display: flex; align-items: center; height: 54px; padding: 0 8px 0 18px; overflow: hidden; background: var(--material, rgba(249, 249, 249, .78)); -webkit-backdrop-filter: saturate(180%) blur(24px); backdrop-filter: saturate(180%) blur(24px); border-bottom: .5px solid var(--sep, rgba(60, 60, 67, .18)); }
.ghead::after { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none; opacity: 0; background: radial-gradient(300px 130px at var(--gx, 50%) 0, var(--sheen, rgba(255, 255, 255, .95)), transparent 72%), radial-gradient(420px 90px at var(--gx, 50%) 100%, color-mix(in srgb, var(--blue, #007aff) 15%, transparent), transparent 75%), linear-gradient(180deg, var(--sheen, rgba(255, 255, 255, .95)), transparent 55%); transition: opacity .28s var(--ease, ease); }
@media (hover: hover) { .ghead:hover::after { opacity: .5; } }
.ghead:active::after { opacity: .75; }
.ghead .ib { width: 36px; height: 36px; border-radius: 10px; color: var(--blue, #007aff); transition: opacity .16s, transform .16s var(--ease, ease); }
.ghead .ib:hover { background: none; color: var(--blue, #007aff); opacity: .7; }
.ghead .ib:active { background: none; opacity: .5; transform: scale(.92); }
.ghead .ib[aria-pressed="true"] { background: color-mix(in srgb, var(--blue, #007aff) 14%, transparent); opacity: 1; }
.ghead .sb { flex: none; display: inline-flex; align-items: center; gap: 5px; height: 36px; padding: 0 8px; font-size: 14px; font-weight: 600; color: var(--blue, #007aff); transition: opacity .16s; }
.ghead .sb[hidden] { display: none; }
.ghead .sb:hover { opacity: .7; }
@media (max-width: 480px) { .ghead { padding-left: 16px; } .ghead .sb span { display: none; } }
.clog { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior-y: contain; padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 8px; }

/* ----- full chat ----- */
.full { position: fixed; inset: 0; pointer-events: none; visibility: hidden; transition: visibility 0s .4s; }
.full.on { pointer-events: auto; visibility: visible; transition: visibility 0s; }
.scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, .3); opacity: 0; transition: opacity .3s; }
.full.on .scrim { opacity: 1; }
.fp { position: absolute; left: 50%; top: 24px; bottom: 24px; width: min(920px, calc(100vw - 48px)); display: flex; flex-direction: column; overflow: hidden; border-radius: 20px; background: var(--bg, #f2f2f7); box-shadow: 0 0 0 .5px var(--sep, rgba(60, 60, 67, .18)), 0 28px 80px rgba(0, 0, 0, .32); transform: translateX(-50%) translateY(16px) scale(.985); opacity: 0; transition: opacity .25s, transform .4s var(--ease, ease); }
.full.on .fp { transform: translateX(-50%); opacity: 1; }
.ttl { flex: 1; min-width: 0; }
.ttl b { display: block; font: 600 17px/1.2 var(--display, inherit); letter-spacing: -0.022em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ttl span { display: block; font-size: 12px; color: var(--label-2, rgba(60, 60, 67, .6)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fbody { flex: 1; min-height: 0; position: relative; display: flex; flex-direction: column; }
.flog { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior-y: contain; padding: 16px 18px 10px; display: flex; flex-direction: column; gap: 10px; }
.ffoot { flex: none; padding: 8px 14px calc(10px + env(safe-area-inset-bottom)); }
.ffoot .pill { background: var(--surface, #fff); -webkit-backdrop-filter: none; backdrop-filter: none; box-shadow: 0 0 0 .5px var(--sep, rgba(60, 60, 67, .18)); }
.ffoot .pill:focus-within { box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--blue, #007aff) 55%, transparent); }

/* ----- the + button, its menu, attachments and notes ----- */
.plus[aria-expanded="true"] { background: var(--fill-2, rgba(118, 118, 128, .2)); color: var(--label, #000); }
.plus svg { transition: transform .2s var(--ease, ease); }
.plus[aria-expanded="true"] svg { transform: rotate(45deg); }
.plus.rec { color: #fff; background: var(--red, #ff3b30); animation: rec 1.4s ease-in-out infinite; }
.plus.rec:hover { background: var(--red, #ff3b30); color: #fff; }
@keyframes rec { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--red, #ff3b30) 45%, transparent); } 50% { box-shadow: 0 0 0 6px transparent; } }
.menu { position: fixed; z-index: 3; min-width: 240px; max-width: calc(100vw - 24px); padding: 6px; border-radius: 16px; pointer-events: auto; background: color-mix(in srgb, var(--surface, #fff) 92%, transparent); -webkit-backdrop-filter: saturate(180%) blur(24px); backdrop-filter: saturate(180%) blur(24px); box-shadow: 0 0 0 .5px var(--sep, rgba(60, 60, 67, .18)), 0 14px 40px rgba(0, 0, 0, .22), 0 2px 8px rgba(0, 0, 0, .08); transform-origin: 0 100%; animation: pop .16s var(--ease, ease); }
@keyframes pop { from { opacity: 0; transform: scale(.96) translateY(4px); } }
.mi { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 0 12px; border-radius: 10px; font-size: 15px; text-align: left; color: var(--label, #000); }
.mi:hover, .mi:focus-visible { background: var(--fill, rgba(118, 118, 128, .12)); outline: none; }
.mi .mic { flex: none; display: grid; place-items: center; width: 22px; color: var(--blue, #007aff); }
.mi .ml { flex: 1; min-width: 0; }
.mi .mv { flex: none; font-size: 13.5px; color: var(--label-2, rgba(60, 60, 67, .6)); display: inline-flex; align-items: center; gap: 4px; }
.mi .mv svg { transition: transform .2s var(--ease, ease); }
.mi[aria-expanded="true"] { background: var(--fill, rgba(118, 118, 128, .12)); }
.mi[hidden] { display: none; }
.menu.under { visibility: hidden; }
.fly { min-width: 200px; max-width: min(300px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow-y: auto; }
.fly .mi { min-height: 40px; font-size: 14.5px; }
.fly .mi.two { padding-top: 8px; padding-bottom: 8px; align-items: flex-start; }
.fly .ck { flex: none; width: 18px; color: var(--blue, #007aff); display: grid; place-items: center; }
.fly .mi.two .ck { height: 20px; }
.fly .hint { display: block; margin-top: 2px; font-size: 13.5px; line-height: 1.3; color: var(--label-2, rgba(60, 60, 67, .6)); }
.fly .back .mic svg { transform: rotate(180deg); }
.msep { height: .5px; margin: 4px 10px; background: var(--sep, rgba(60, 60, 67, .18)); }
.atts { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
.atts:empty, .note:empty { display: none; }
.att { display: inline-flex; align-items: center; gap: 6px; max-width: 220px; height: 34px; padding: 0 4px 0 6px; border-radius: 10px; font-size: 13px; background: var(--surface, #fff); box-shadow: 0 0 0 .5px var(--sep, rgba(60, 60, 67, .18)), 0 2px 8px rgba(0, 0, 0, .08); }
.att img, .att .fi { flex: none; width: 24px; height: 24px; border-radius: 6px; object-fit: cover; display: grid; place-items: center; background: var(--fill, rgba(118, 118, 128, .12)); color: var(--label-2, rgba(60, 60, 67, .6)); }
.att .an { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.att .as { flex: none; color: var(--label-2, rgba(60, 60, 67, .6)); font-size: 12px; }
.att button { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; color: var(--label-2, rgba(60, 60, 67, .6)); }
.att button:hover { background: var(--fill, rgba(118, 118, 128, .12)); color: var(--label, #000); }
.note { margin: 0 0 8px; padding: 8px 12px; border-radius: 12px; font-size: 13.5px; line-height: 1.35; color: var(--label, #000); background: var(--surface, #fff); box-shadow: 0 0 0 .5px var(--sep, rgba(60, 60, 67, .18)), 0 4px 14px rgba(0, 0, 0, .1); }
.bub .files { display: block; margin-top: 4px; font-size: 12.5px; opacity: .85; }
.att .ao { flex: 0 1 auto; display: inline-flex; align-items: center; gap: 6px; min-width: 0; width: auto; height: 100%; border-radius: 8px; color: inherit; background: none; text-align: left; text-decoration: none; }
.att button.ao:hover { background: none; color: inherit; }
.att button.ao:hover .an { text-decoration: underline; }
.att .asv { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; color: var(--label-2, rgba(60, 60, 67, .6)); }
.att .asv:hover { background: var(--fill, rgba(118, 118, 128, .12)); color: var(--label, #000); }
.afiles { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.afiles .att { color: var(--label, #000); }
.apic { display: block; max-width: min(100%, 360px); border-radius: 12px; overflow: hidden; }
.apic img { display: block; max-width: 100%; max-height: 260px; object-fit: contain; }
.msg.afile { align-items: flex-start; gap: 6px; }
.dropping { outline: 2px dashed var(--blue, #007aff); outline-offset: 2px; }
.fv { position: fixed; inset: 0; z-index: 5; pointer-events: auto; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, .5); }
.fvp { display: flex; flex-direction: column; width: min(860px, 100%); max-height: 100%; min-height: 0; border-radius: 16px; overflow: hidden; color: var(--label, #000); background: var(--bg, #f2f2f7); box-shadow: 0 12px 40px rgba(0, 0, 0, .35); }
.fvh { flex: none; display: flex; align-items: center; gap: 4px; padding: 6px 8px 6px 16px; border-bottom: .5px solid var(--sep, rgba(60, 60, 67, .18)); }
.fvn { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.fvs { flex: none; margin-right: 6px; color: var(--label-2, rgba(60, 60, 67, .6)); font-size: 13px; }
.fvh .ib { width: 36px; height: 36px; border-radius: 10px; color: var(--blue, #007aff); text-decoration: none; }
.fvb { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.fvb pre { margin: 0; padding: 14px 16px; font: 13px/1.5 var(--mono, ui-monospace, Consolas, monospace); white-space: pre-wrap; overflow-wrap: anywhere; }
.fvb img { display: block; max-width: 100%; margin: 0 auto; }
.fvcut { padding: 10px 16px; font-size: 14px; color: var(--label-2, rgba(60, 60, 67, .6)); }
@media (max-width: 640px) { .fv { padding: 0; } .fvp { width: 100%; height: 100%; border-radius: 0; padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); } }

/* ----- messages (card and full chat) ----- */
.msg { max-width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.msg.u { align-items: flex-end; }
.msg.a:has(> .bub:empty) { display: none; }
.bub { max-width: min(92%, 600px); padding: 8px 12px; border-radius: 18px; overflow-wrap: anywhere; word-break: break-word; }
.u .bub { background: var(--blue, #007aff); color: #fff; border-bottom-right-radius: 6px; white-space: pre-wrap; }
.a .bub { background: var(--surface, #fff); border-bottom-left-radius: 6px; max-width: 100%; width: fit-content; box-shadow: 0 0 0 .5px var(--sep, rgba(60, 60, 67, .18)); }
.clog .msg.u { align-items: flex-start; }
.clog .u .bub { background: none; color: var(--label-2, rgba(60, 60, 67, .6)); padding: 0 0 2px; font-size: 13px; border-radius: 0; max-width: 100%; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: normal; }
.clog .a .bub { background: none; box-shadow: none; padding: 0; border-radius: 0; width: auto; }
/* Reply content: type scale, lists, code, tables, links. Same look in the card and the full chat. */
.bub { line-height: 1.5; }
.bub > :first-child { margin-top: 0; }
.bub > :last-child { margin-bottom: 0; }
.bub p { margin: 0 0 10px; }
.bub strong { font-weight: 650; }
.bub del { color: var(--label-2, rgba(60, 60, 67, .6)); }
.bub h2, .bub h3, .bub h4, .bub h5 { margin: 18px 0 6px; font-family: var(--display, inherit); line-height: 1.25; color: var(--label, #000); }
.bub h2 { font-size: 19px; font-weight: 700; letter-spacing: -0.026em; }
.bub h3 { font-size: 16.5px; font-weight: 650; letter-spacing: -0.02em; }
.bub h4 { font-size: 15px; font-weight: 650; letter-spacing: -0.014em; }
.bub h5 { margin-top: 14px; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--label-2, rgba(60, 60, 67, .6)); }
.bub h2 + h3, .bub h3 + h4, .bub h2 + h4 { margin-top: 8px; }
.bub ul, .bub ol { margin: 0 0 10px; padding-left: 1.4em; }
.bub li { margin: 4px 0; padding-left: 3px; }
.bub ul > li::marker { color: var(--label-3, rgba(60, 60, 67, .3)); }
.bub ol > li::marker { color: var(--label-2, rgba(60, 60, 67, .6)); font-weight: 500; font-variant-numeric: tabular-nums; }
.bub li > ul, .bub li > ol { margin: 4px 0 0; }
.bub li > p { margin: 0; }
.bub a { color: var(--blue, #007aff); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2.5px; text-decoration-color: color-mix(in srgb, var(--blue, #007aff) 35%, transparent); transition: text-decoration-color .15s; }
.bub a:hover { text-decoration-color: currentColor; }
.bub :not(pre) > code { font-family: var(--code-font); font-size: .86em; letter-spacing: 0; padding: .14em .45em; border-radius: 6px; color: var(--label, #000); background: color-mix(in srgb, var(--label, #000) 6.5%, transparent); box-shadow: inset 0 0 0 .5px color-mix(in srgb, var(--label, #000) 9%, transparent); overflow-wrap: anywhere; }
.bub hr { border: 0; border-top: .5px solid var(--sep, rgba(60, 60, 67, .18)); margin: 14px 0; }
.bub blockquote { margin: 0 0 10px; padding: 2px 0 2px 12px; border-left: 3px solid color-mix(in srgb, var(--blue, #007aff) 40%, transparent); color: var(--label-2, rgba(60, 60, 67, .6)); }
.bub blockquote p { margin: 0 0 4px; }
.code { margin: 2px 0 10px; border-radius: 12px; overflow: hidden; background: color-mix(in srgb, var(--label, #000) 4%, var(--surface, #fff)); box-shadow: inset 0 0 0 .5px var(--sep, rgba(60, 60, 67, .18)); }
.code-head { display: flex; align-items: center; justify-content: space-between; height: 32px; padding: 0 4px 0 12px; font-size: 11.5px; font-weight: 500; color: var(--label-2, rgba(60, 60, 67, .6)); border-bottom: .5px solid var(--sep, rgba(60, 60, 67, .18)); }
.cp { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 8px; border-radius: 8px; font-size: 12px; color: var(--label-2, rgba(60, 60, 67, .6)); }
.cp:hover { background: var(--fill, rgba(118, 118, 128, .12)); color: var(--label, #000); }
.code pre { margin: 0; padding: 10px 12px 12px; overflow-x: auto; }
.code pre code { font: 12.5px/1.6 var(--code-font); letter-spacing: 0; white-space: pre; tab-size: 2; color: var(--label, #000); }
.tbl { margin: 2px 0 10px; max-width: 100%; overflow-x: auto; border: .5px solid var(--sep, rgba(60, 60, 67, .18)); border-radius: 12px; background: var(--surface, #fff); }
.tbl table { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; font-size: 13.5px; line-height: 1.4; }
.tbl th, .tbl td { padding: 7px 12px; text-align: left; vertical-align: top; border-bottom: .5px solid var(--sep, rgba(60, 60, 67, .18)); }
.tbl th + th, .tbl td + td { border-left: .5px solid var(--sep, rgba(60, 60, 67, .18)); }
.tbl thead th { font-size: 12.5px; font-weight: 600; white-space: nowrap; background: color-mix(in srgb, var(--label, #000) 5%, var(--surface, #fff)); }
.tbl tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--label, #000) 2.5%, var(--surface, #fff)); }
.tbl tbody tr:last-child td { border-bottom: 0; }
.tbl td { font-variant-numeric: tabular-nums; }
.tbl td code { white-space: nowrap; }

/* Thin overlay-style scrollbars: no track, a slim rounded thumb that shows while the pointer is over the area. */
.clog, .flog, .hist, .tbl, .code pre, .tool .det pre { --thumb: transparent; }
.clog:hover, .flog:hover, .hist:hover, .tbl:hover, .code pre:hover, .tool .det pre:hover { --thumb: color-mix(in srgb, var(--label, #000) 26%, transparent); }
@supports selector(::-webkit-scrollbar) {
  ::-webkit-scrollbar { width: 10px; height: 10px; background: transparent; }
  ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-thumb { border: 3px solid transparent; border-radius: 10px; background: var(--thumb, transparent) padding-box; }
  ::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--label, #000) 42%, transparent); }
  ::-webkit-scrollbar-button { display: none; }
}
@supports not selector(::-webkit-scrollbar) {
  .clog, .flog, .hist, .tbl, .code pre, .tool .det pre { scrollbar-width: thin; scrollbar-color: var(--thumb) transparent; }
}
.tool { align-self: stretch; max-width: 100%; border-radius: 12px; background: var(--fill, rgba(118, 118, 128, .12)); overflow: hidden; flex: none; }
.tool > button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; font-size: 13px; color: var(--label-2, rgba(60, 60, 67, .6)); text-align: left; min-width: 0; }
.tool > button:focus-visible { outline: 2px solid var(--blue, #007aff); outline-offset: -2px; border-radius: 12px; }
.tool .lbl { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tool .chev { flex: none; transition: transform .25s var(--ease, ease); display: grid; }
.tool.open .chev { transform: rotate(90deg); }
.tool .st { flex: none; display: grid; place-items: center; width: 16px; height: 16px; }
.tool .st.ok { color: var(--green, #34c759); }
.tool .st.bad { color: var(--red, #ff3b30); }
.tool .det { display: none; padding: 0 10px 9px; font: 12px/1.45 var(--code-font); letter-spacing: 0; color: var(--label-2, rgba(60, 60, 67, .6)); }
.tool.open .det { display: block; }
.tool .det pre { margin: 0 0 6px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; max-height: 170px; overflow-y: auto; }
.tool .det pre:last-child { margin-bottom: 0; }
.spin { width: 13px; height: 13px; border-radius: 50%; border: 2px solid var(--fill-2, rgba(118, 118, 128, .2)); border-top-color: var(--label-2, rgba(60, 60, 67, .6)); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.confirm { align-self: stretch; display: grid; gap: 6px; padding: 12px; border-radius: 14px; font-size: 14px; background: var(--fill, rgba(120,120,128,.12)); }
.confirm-what { font-weight: 600; }
.confirm-on { color: var(--label-2, #6b6b72); overflow-wrap: anywhere; max-height: 40vh; overflow-y: auto; overscroll-behavior-y: contain; }
.confirm-row { display: flex; gap: 8px; margin-top: 4px; }
.confirm-row button { flex: 1; min-height: 36px; border: 0; border-radius: 10px; font: inherit; font-weight: 600; cursor: pointer; color: var(--label, #111); background: var(--fill, rgba(120,120,128,.16)); }
.confirm-row button.yes { color: #fff; background: var(--blue, #007aff); }
.confirm-row button:disabled { opacity: .5; cursor: default; }
.err { align-self: stretch; padding: 8px 12px; border-radius: 12px; font-size: 13.5px; color: var(--red, #ff3b30); background: color-mix(in srgb, var(--red, #ff3b30) 12%, transparent); overflow-wrap: anywhere; flex: none; }
.dots { display: inline-flex; gap: 4px; padding: 6px 2px; }
.dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--label-3, rgba(60, 60, 67, .3)); animation: dot 1.1s ease-in-out infinite; }
.dots i:nth-child(2) { animation-delay: .15s; }
.dots i:nth-child(3) { animation-delay: .3s; }
@keyframes dot { 0%, 70%, 100% { opacity: .35; transform: none; } 35% { opacity: 1; transform: translateY(-2px); } }
/* Under each reply in the full chat: sent time, duration, tokens, Reply, Copy. Hover (or tap on touch) shows it. The card never does. */
.clog .acts { display: none; }
.acts { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; min-height: 26px; margin-left: -6px; font-size: 12px; color: var(--label-2, rgba(60, 60, 67, .6)); opacity: 0; transition: opacity .15s; }
.msg:hover .acts, .msg:focus-within .acts, .msg.show .acts { opacity: 1; }
.acts .meta { display: inline-flex; align-items: center; gap: 0; margin-right: 2px; }
.acts .mt { display: inline-flex; align-items: center; height: 24px; padding: 0 6px; white-space: nowrap; font-variant-numeric: tabular-nums; cursor: default; }
.acts .sd { width: 3px; height: 3px; border-radius: 50%; background: var(--label-3, rgba(60, 60, 67, .3)); }
.acts button { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 8px; border-radius: 8px; font-size: 12px; color: var(--label-2, rgba(60, 60, 67, .6)); }
.acts button:hover { background: var(--fill, rgba(118, 118, 128, .12)); color: var(--label, #000); }
.rq { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; padding: 6px 4px 6px 12px; border-radius: 12px; font-size: 13px; color: var(--label-2, rgba(60, 60, 67, .6)); background: var(--surface, #fff); box-shadow: 0 0 0 .5px var(--sep, rgba(60, 60, 67, .18)), 0 2px 8px rgba(0, 0, 0, .08); }
.rq:empty { display: none; }
.rq .rqb { flex: 1; min-width: 0; padding-left: 8px; border-left: 2px solid var(--blue, #007aff); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.rq .rqb b { font-weight: 600; color: var(--label, #000); }
.rq button { flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: var(--label-2, rgba(60, 60, 67, .6)); }
.rq button:hover { background: var(--fill, rgba(118, 118, 128, .12)); color: var(--label, #000); }
.bub .rqt { display: block; margin: 0 0 6px; padding-left: 8px; border-left: 2px solid rgba(255, 255, 255, .55); font-size: 13px; line-height: 1.35; opacity: .85; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: normal; }
.clog .bub .rqt { border-left-color: var(--sep, rgba(60, 60, 67, .18)); }
.msg.site { align-items: stretch; max-width: 100%; }
.msg.site > .hc-sitecard { width: 100%; }
.sitelink { color: var(--blue, #007aff); font-weight: 500; }
/* Hub browser card: one per turn, live while the assistant works, its last step's screenshot after. */
.msg.bro { align-items: stretch; max-width: 100%; }
.brc { border-radius: 14px; overflow: hidden; background: var(--surface, #fff); box-shadow: 0 0 0 .5px var(--sep, rgba(60, 60, 67, .18)), 0 2px 8px rgba(0, 0, 0, .08); }
.brb { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 5px 5px 5px 12px; font-size: 13px; }
.brb .live { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--label-3, rgba(60, 60, 67, .3)); }
.msg.bro.on .live { background: #34c759; animation: brpulse 1.4s ease-in-out infinite; }
@keyframes brpulse { 50% { opacity: .35; } }
.brt { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; color: var(--label, #000); }
.brt small { margin-left: 6px; font-weight: 400; color: var(--label-2, rgba(60, 60, 67, .6)); }
.brc button { flex: none; height: 30px; padding: 0 12px; border-radius: 15px; font-size: 13px; font-weight: 600; color: var(--blue, #007aff); background: var(--fill, rgba(118, 118, 128, .12)); }
.brc button:hover { background: var(--fill-2, rgba(118, 118, 128, .2)); }
.brm { display: grid; place-items: center; background: var(--fill, rgba(118, 118, 128, .12)); line-height: 0; cursor: pointer; }
.brm:empty { display: none; }
.brm img, .brm canvas { display: block; width: auto !important; max-width: 100%; height: 300px !important; object-fit: contain; border-radius: 0 !important; box-shadow: none !important; }
.clog .brm img, .clog .brm canvas { height: 150px !important; }
@media (max-width: 720px) { .flog .brm img, .flog .brm canvas { height: 220px !important; } }
.brh { display: flex; align-items: center; gap: 8px; padding: 6px 5px 6px 12px; font-size: 13px; color: var(--label, #000); background: color-mix(in srgb, var(--orange, #ff9500) 16%, transparent); }
.brh[hidden] { display: none; }
.brh span { flex: 1; min-width: 0; }
/* Messages sent while a reply is still coming wait here; edit or remove them before they run. */
.qu { display: flex; flex-direction: column; gap: 4px; margin: 0 0 8px; }
.qu:empty { display: none; }
.qi { display: flex; align-items: center; gap: 2px; min-height: 36px; padding: 3px 3px 3px 12px; border-radius: 12px; font-size: 13.5px; background: var(--surface, #fff); box-shadow: 0 0 0 .5px var(--sep, rgba(60, 60, 67, .18)), 0 2px 8px rgba(0, 0, 0, .08); }
.qi .qn { flex: none; margin-right: 6px; font-size: 11px; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; color: var(--label-2, rgba(60, 60, 67, .6)); }
.qi .qt { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qi button { flex: none; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: var(--label-2, rgba(60, 60, 67, .6)); }
.qi button:hover { background: var(--fill, rgba(118, 118, 128, .12)); color: var(--label, #000); }
.qi button.go { color: var(--blue, #007aff); }
.empty { margin: auto; text-align: center; padding: 24px 16px; max-width: 340px; }
.empty .logo { width: 56px; height: 56px; margin: 0 auto 12px; border-radius: 16px; display: grid; place-items: center; color: #fff; background: linear-gradient(160deg, var(--blue, #007aff), var(--indigo, #5856d6)); }
.empty h3 { margin: 0 0 4px; font: 600 20px/1.2 var(--display, inherit); letter-spacing: -0.022em; }
.empty p { margin: 0 0 16px; color: var(--label-2, rgba(60, 60, 67, .6)); font-size: 14px; }
.chips { display: flex; flex-direction: column; gap: 8px; }
.chip { padding: 9px 14px; border-radius: 14px; background: var(--surface, #fff); box-shadow: 0 0 0 .5px var(--sep, rgba(60, 60, 67, .18)); font-size: 14px; text-align: left; color: var(--blue, #007aff); }
.chip:hover { background: var(--press, #e5e5ea); }

/* ----- history ----- */
.hist { position: absolute; inset: 0; z-index: 1; background: var(--bg, #f2f2f7); overflow-y: auto; overscroll-behavior-y: contain; padding: 10px 16px 16px; display: none; }
.hist.on { display: block; }
.hist h4 { margin: 4px 4px 8px; font-size: 13px; font-weight: 400; color: var(--label-2, rgba(60, 60, 67, .6)); text-transform: uppercase; letter-spacing: .02em; }
.list { background: var(--surface, #fff); border-radius: 14px; overflow: hidden; }
.row { display: flex; align-items: center; gap: 6px; padding: 8px 6px 8px 14px; min-height: 52px; border-bottom: .5px solid var(--sep, rgba(60, 60, 67, .18)); cursor: pointer; }
.row:last-child { border-bottom: 0; }
.row:hover { background: color-mix(in srgb, var(--press, #e5e5ea) 45%, transparent); }
.row .t { flex: 1; min-width: 0; }
.row .t b { display: block; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .t span { display: block; font-size: 12.5px; color: var(--label-2, rgba(60, 60, 67, .6)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row.cur .t b { color: var(--blue, #007aff); }
.row .rb { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: var(--label-2, rgba(60, 60, 67, .6)); flex: none; }
.row .rb:hover { background: var(--fill, rgba(118, 118, 128, .12)); }
.row .rb.del { width: auto; padding: 0 10px; border-radius: 99px; color: #fff; background: var(--red, #ff3b30); font-size: 13px; font-weight: 600; }
.row input { flex: 1; min-width: 0; border: 0; outline: 2px solid var(--blue, #007aff); border-radius: 8px; background: var(--surface-2, #f2f2f7); padding: 5px 8px; font-size: 16px; }
.none { padding: 28px 16px; text-align: center; color: var(--label-2, rgba(60, 60, 67, .6)); font-size: 14px; }

@media (max-width: 720px) {
  .bar { bottom: calc(12px + env(safe-area-inset-bottom) + var(--kb)); }
  .card { bottom: calc(12px + env(safe-area-inset-bottom) + var(--kb) + var(--barh) + 8px); max-height: clamp(180px, 36vh, 340px); }
  .fp { left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; transform: translateY(100%); opacity: 1; transition: transform .42s var(--ease, ease); }
  .full.on .fp { transform: none; }
  .flog { padding: 14px 14px 8px; }
  .bub { max-width: 94%; }
  .acts button { padding: 0 7px; }
  .acts button span { display: none; } /* icons only on a phone so the row stays on one line */
}
@media (prefers-reduced-motion: reduce) { .bar, .card, .card.on, .fp, .full.on .fp, .scrim, .ghead::after, .ghead .ib, .ghead .sb { transition: none; } .spin, .dots i, .menu, .plus.rec { animation: none; } }
`

  /* ---------- DOM ---------- */

  const host = document.createElement('div')
  host.id = 'hub-chat'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<style>${CSS}</style>
<div class="root">
  <section class="card" role="region" aria-label="${esc(AGENT)} answer" inert>
    <header class="ghead chead">
      <div class="ttl"><b>${esc(AGENT)}</b><span class="ctx"></span></div>
      <button type="button" class="sb" aria-label="Stop" hidden>${IC.stop}<span>Stop</span></button>
      <button type="button" class="ib cnew" aria-label="New chat" title="New chat">${IC.plus}</button>
      <button type="button" class="ib chist" aria-label="Chat history" title="Chat history">${IC.history}</button>
      <button type="button" class="ib cx" aria-label="Open the full chat" title="Full chat (Ctrl+/)">${IC.expand}</button>
      <button type="button" class="ib cc" aria-label="Close answer" title="Close">${IC.close}</button>
    </header>
    <div class="clog" role="log" aria-live="off"></div>
  </section>
  <div class="bar">
    <div class="note" role="status"></div>
    <div class="qu" aria-label="Queued messages"></div>
    <div class="rq" aria-label="Replying to"></div>
    <div class="atts" aria-label="Attached files"></div>
    <div class="pill glass">
      <button type="button" class="ib plus bplus" aria-label="Attach, model, effort, mode, dictate, full screen" aria-haspopup="menu" aria-expanded="false" title="Attach, model, effort, mode, dictate, full screen">${IC.plus22}</button>
      <textarea class="bta" rows="1" placeholder="Ask anything" aria-label="Message" enterkeyhint="send" autocomplete="off" autocapitalize="sentences"></textarea>
      <button type="button" class="send bsend" aria-label="Send" disabled>${IC.up}</button>
    </div>
  </div>
  <div class="full" inert>
    <div class="scrim"></div>
    <section class="fp" role="dialog" aria-label="${esc(AGENT)} chat">
      <header class="ghead fhead">
        <div class="ttl"><b>${esc(AGENT)}</b><span class="ctx"></span></div>
        <button type="button" class="ib fnew" aria-label="New chat" title="New chat">${IC.plus}</button>
        <button type="button" class="ib fhist" aria-label="Chat history" aria-pressed="false" title="Chat history">${IC.history}</button>
        <button type="button" class="ib fx" aria-label="Back to the bar" title="Back to the bar (Esc)">${IC.collapse}</button>
      </header>
      <div class="fbody">
        <div class="flog" role="log" aria-label="Conversation"></div>
        <div class="hist" aria-label="Chat history"></div>
      </div>
      <footer class="ffoot">
        <div class="note" role="status"></div>
        <div class="qu" aria-label="Queued messages"></div>
        <div class="rq" aria-label="Replying to"></div>
        <div class="atts" aria-label="Attached files"></div>
        <div class="pill">
          <button type="button" class="ib plus fplus" aria-label="Attach, model, effort, mode, dictate, full screen" aria-haspopup="menu" aria-expanded="false" title="Attach, model, effort, mode, dictate, full screen">${IC.plus22}</button>
          <textarea class="fta" rows="1" placeholder="Ask anything" aria-label="Message" enterkeyhint="send" autocomplete="off" autocapitalize="sentences"></textarea>
          <button type="button" class="send fsend" aria-label="Send" disabled>${IC.up}</button>
        </div>
      </footer>
    </section>
  </div>
  <div class="menu" role="menu" aria-label="Composer options" hidden></div>
  <div class="menu fly" role="menu" hidden></div>
  <input class="pick" type="file" multiple hidden>
  <div class="fv" role="dialog" aria-modal="true" aria-label="File" hidden>
    <div class="fvp">
      <header class="fvh">
        <span class="fvn"></span><span class="fvs"></span>
        <button type="button" class="ib fvc" aria-label="Copy" title="Copy" hidden>${IC.copy18}</button>
        <a class="ib fvd" aria-label="Save" title="Save">${IC.save18}</a>
        <button type="button" class="ib fvx" aria-label="Close" title="Close (Esc)">${IC.close}</button>
      </header>
      <div class="fvb"></div>
    </div>
  </div>
</div>`
  const $ = s => shadow.querySelector(s)
  const rootEl = $('.root'), bar = $('.bar'), barPill = $('.bar .pill'), bta = $('.bta'), bsend = $('.bsend'), bPlus = $('.bplus')
  const card = $('.card'), clogEl = $('.clog'), cStop = $('.chead .sb'), cExpand = $('.cx'), cClose = $('.cc')
  const full = $('.full'), fp = $('.fp'), flogEl = $('.flog'), hist = $('.hist'), ctxEls = shadow.querySelectorAll('.ctx'), fta = $('.fta'), fsend = $('.fsend')
  const fPill = $('.ffoot .pill'), fNew = $('.fnew'), fHist = $('.fhist'), fX = $('.fx'), scrim = $('.scrim'), fPlus = $('.fplus')
  const menu = $('.menu'), fly = $('.fly'), pick = $('.pick')
  const attsEls = [...shadow.querySelectorAll('.atts')], noteEls = [...shadow.querySelectorAll('.note')], rqEls = [...shadow.querySelectorAll('.rq')], quEls = [...shadow.querySelectorAll('.qu')]

  /* ---------- state ---------- */

  const S = { busy: false, conv: '', info: null, ctrl: null, cardOn: false, full: false, hist: false, poll: 0, ctxTimer: 0, gen: 0, model: '', files: [], rec: null, noteTimer: 0, reply: '', queue: [], qid: 0, stopped: false }

  const copyText = async t => {
    try { await navigator.clipboard.writeText(t) } catch {
      const x = document.createElement('textarea'); x.value = t; x.style.position = 'fixed'; x.style.opacity = '0'; shadow.append(x); x.select()
      try { document.execCommand('copy') } catch {}
      x.remove()
    }
  }

  /* ---------- the row under each reply: time, duration, tokens, Reply, Copy ---------- */

  const fmtK = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n))
  const fmtCost = c => `$${c < 0.01 ? c.toFixed(4) : c.toFixed(2)}`
  function metaHtml(m) {
    const parts = []
    if (m.at) {
      const d = new Date(m.at)
      const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      const today = d.toDateString() === new Date().toDateString()
      parts.push([today ? t : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${t}`, d.toLocaleString([], { dateStyle: 'full', timeStyle: 'medium' })])
    }
    if (m.ms) parts.push([m.ms < 60e3 ? `${(m.ms / 1000).toFixed(1)}s` : `${Math.floor(m.ms / 60e3)}m ${Math.round((m.ms % 60e3) / 1000)}s`, `Took ${(m.ms / 1000).toFixed(1)} seconds${m.model ? ` on ${modelName(m.model)}` : ''}${m.effort ? `, ${(S.info?.efforts || []).find(([v]) => v === m.effort)?.[1] || m.effort} effort` : ''}${m.mode === 'plan' ? ', Plan mode' : ''}`])
    const tok = (m.in || 0) + (m.out || 0)
    if (tok) parts.push([`${fmtK(tok)} tokens${m.cost ? ` · ${fmtCost(m.cost)}` : ''}`, `${(m.in || 0).toLocaleString()} in (${(m.cached || 0).toLocaleString()} from cache) + ${(m.out || 0).toLocaleString()} out${m.cost ? ` · ${fmtCost(m.cost)} at API prices` : ''}`])
    return parts.map(([t, tip]) => `<span class="mt" title="${esc(tip)}">${esc(t)}</span>`).join('<i class="sd" aria-hidden="true"></i>')
  }
  const actsHtml = meta => `${meta ? `<span class="meta">${metaHtml(meta)}</span>` : ''}<button type="button" data-act="reply" aria-label="Reply to this message">${IC.reply}<span>Reply</span></button><button type="button" data-act="copy" aria-label="Copy reply">${IC.copy}<span>Copy</span></button>`

  // Reply: a quote of one answer above the composer, sent along as context for the next message.
  function setReply(text) {
    S.reply = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1500)
    renderReply()
    activeTa().focus({ preventScroll: true })
  }
  function renderReply() {
    for (const box of rqEls) {
      box.replaceChildren()
      if (!S.reply) continue
      const q = document.createElement('div'); q.className = 'rqb'
      const b = document.createElement('b'); b.textContent = 'Replying to: '
      q.append(b, document.createTextNode(S.reply))
      const x = document.createElement('button'); x.type = 'button'; x.innerHTML = IC.x14; x.setAttribute('aria-label', 'Remove the reply quote')
      x.addEventListener('click', () => { S.reply = ''; renderReply(); activeTa().focus({ preventScroll: true }) })
      box.append(q, x)
    }
  }

  // The queue: what the user sends while a reply is still coming. Each one runs in turn when the reply
  // before it finishes. Edit puts it back in the composer, x drops it. After Stop the queue waits.
  function enqueue(text) {
    text = String(text || '').trim()
    if (!text && !S.files.length) return
    S.queue.push({ id: ++S.qid, text, files: S.files, reply: S.reply })
    S.files = []; renderAtts()
    S.reply = ''; renderReply()
    for (const [t, p] of [[bta, barPill], [fta, fPill]]) { t.value = ''; grow(t, p) }
    renderQueue()
    syncSend()
  }
  function dropQueued(item, keep) {
    S.queue = S.queue.filter(x => x !== item)
    if (!keep) for (const f of item.files) if (f.url) URL.revokeObjectURL(f.url)
    renderQueue()
  }
  function clearQueue() { for (const it of [...S.queue]) dropQueued(it) }
  function renderQueue() {
    for (const box of quEls) {
      box.replaceChildren(...S.queue.map((it, i) => {
        const row = document.createElement('div'); row.className = 'qi'
        const n = document.createElement('span'); n.className = 'qn'; n.textContent = S.busy ? 'Queued' : 'Paused'
        const t = document.createElement('span'); t.className = 'qt'
        t.textContent = it.text || `${it.files.length} file${it.files.length === 1 ? '' : 's'}`
        t.title = it.text
        const btn = (cls, html, label, fn) => { const b = document.createElement('button'); b.type = 'button'; if (cls) b.className = cls; b.innerHTML = html; b.setAttribute('aria-label', label); b.title = label; b.addEventListener('click', fn); return b }
        const edit = btn('', IC.pencil, 'Edit this queued message', () => {
          dropQueued(it, true)
          const ta = activeTa()
          ta.value = ta.value.trim() ? `${it.text}\n${ta.value}` : it.text
          grow(ta, ta === fta ? fPill : barPill)
          if (it.files.length) { S.files = it.files.concat(S.files).slice(0, MAX_FILES()); renderAtts() }
          if (it.reply && !S.reply) { S.reply = it.reply; renderReply() }
          syncSend()
          ta.focus({ preventScroll: true })
        })
        const del = btn('', IC.x14, 'Remove this queued message', () => dropQueued(it))
        row.append(n, t, edit, del)
        if (!S.busy && i === 0) row.insertBefore(btn('go', IC.up, 'Send this now', () => { dropQueued(it, true); send(it.text, it) }), edit)
        return row
      }))
    }
  }

  // Site cards come from tabs/custom.js and are styled by its #hc-style sheet, which can't reach
  // into this shadow root, so a copy of it goes in once. Its favicon load/error listeners sit on
  // document and image events don't leave a shadow root, so the same two go here.
  function siteStyles() {
    if (shadow.getElementById('hc-style-copy')) return
    const src = document.getElementById('hc-style')
    if (!src) return
    const s = document.createElement('style'); s.id = 'hc-style-copy'; s.textContent = src.textContent
    shadow.append(s)
    shadow.addEventListener('error', e => { if (e.target?.classList?.contains('hc-fav')) e.target.remove() }, true)
    shadow.addEventListener('load', e => { const i = e.target; if (i?.classList?.contains('hc-fav') && i.naturalWidth >= 120) i.classList.add('full') }, true)
  }

  /* ---------- views: the card and the full chat render the same events ---------- */

  function makeView(log) {
    const v = { log, cur: null, pending: null, stick: true, live: [], raf: 0, last: 0, top: 0, gliding: false, held: false }
    log.addEventListener('scroll', () => {
      const top = log.scrollTop, gap = log.scrollHeight - top - log.clientHeight
      // Following only ever scrolls down, so an upward move is the reader's: stay put until they come back to the end.
      if (top < v.top - 1 && gap > 2) v.stick = false
      else if (gap < 24) v.stick = true
      v.top = top
    }, { passive: true })
    log.addEventListener('wheel', e => { if (e.deltaY < 0) v.stick = false }, { passive: true })
    // A finger on the log, or a mouse drag selecting text or holding the scrollbar, pauses following.
    log.addEventListener('touchstart', () => { v.held = true }, { passive: true })
    log.addEventListener('touchend', () => { v.held = false; v.follow() }, { passive: true })
    log.addEventListener('touchcancel', () => { v.held = false }, { passive: true })
    log.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') v.held = true })
    window.addEventListener('pointerup', () => { if (v.held) { v.held = false; v.follow() } })
    v.follow = () => {
      if (!v.stick || v.gliding) return
      if (REDUCED.matches || document.hidden) { log.scrollTop = log.scrollHeight; return }
      v.gliding = true
      const step = () => {
        const gap = log.scrollHeight - log.scrollTop - log.clientHeight
        if (!v.stick || gap <= .5 || !log.isConnected) { v.gliding = false; return }
        if (!v.held) log.scrollTop += Math.ceil(gap * .16)
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }
    v.scrollEnd = force => {
      if (!force) return v.follow()
      v.stick = true
      requestAnimationFrame(() => { log.scrollTop = log.scrollHeight })
    }
    v.clearEmpty = () => log.querySelector('.empty')?.remove()
    v.clear = () => { cancelAnimationFrame(v.raf); v.raf = 0; v.live.length = 0; v.browser?.mini?.close(); v.browser = null; log.replaceChildren(); v.cur = null; v.pending = null; v.stick = true; v.top = 0 }
    /* Text reaches the reader at an even rate, whatever the shape of the stream. New text goes into a small buffer and each
       animation frame shows as much as the rate allows. The rate tracks how fast text is arriving, and steers the buffer
       towards enough text to ride out the longest recent gap between chunks. */
    v.draw = (c, whole) => {
      const blocks = mdBlocks(whole ? c.raw : settled(c.raw.slice(0, c.shown)))
      c.blocks = patchBlocks(c.bub, blocks, c.blocks)
      if (c.bub.firstChild) v.hidePending() // the waiting dots stay until there is text to replace them
    }
    v.settle = c => {
      v.live.splice(v.live.indexOf(c), 1)
      c.shown = c.raw.length
      v.draw(c, true)
      c.el.__live = false
      c.acts.hidden = !c.raw
      if (!c.raw.trim()) c.el.remove()
      v.follow()
    }
    v.flush = () => {
      for (const c of [...v.live]) {
        c.shown = c.raw.length
        if (c.ending) v.settle(c)
        else { v.draw(c, false); v.follow() }
      }
    }
    v.kick = () => {
      if (v.raf) return
      if (document.hidden || REDUCED.matches) return v.flush()
      v.last = 0
      v.raf = requestAnimationFrame(v.frame)
    }
    v.frame = now => {
      v.raf = 0
      const dt = v.last ? Math.min(.1, (now - v.last) / 1000) : .016
      v.last = now
      const seen = !log.checkVisibility || log.checkVisibility({ visibilityProperty: true })
      for (const c of [...v.live]) {
        const backlog = c.raw.length - c.shown
        c.inRate *= Math.exp(-dt / .8)
        if (!seen) { // nobody is looking at this view: catch up when it shows
          c.shown = c.raw.length; c.stale = true
          if (c.ending) v.settle(c)
          continue
        }
        if (backlog <= 0) {
          if (c.stale) { c.stale = false; v.draw(c, false); v.follow() }
          if (c.ending) v.settle(c)
          continue
        }
        // Models often send one token and then pause: wait a moment for more, so the reply doesn't show a few letters and stop.
        if (!c.shown && !c.ending && backlog < 24 && now - c.firstIn < 300) continue
        const want = Math.max(30, c.inRate + (backlog - c.inRate * c.lag) / .5)
        c.rate += (want - c.rate) * Math.min(1, dt * 5)
        c.acc += Math.max(c.rate, c.endRate) * dt
        let n = Math.floor(c.acc)
        if (n <= 0) continue
        c.acc -= n
        c.shown = Math.min(c.raw.length, c.shown + n)
        const code = c.raw.charCodeAt(c.shown - 1)
        if (code >= 0xd800 && code <= 0xdbff) c.shown++ // never split an emoji
        c.stale = false
        v.draw(c, false)
        v.follow()
      }
      if (v.live.length) v.raf = requestAnimationFrame(v.frame)
    }
    v.feed = text => {
      const c = v.cur
      if (!c || !text) return
      c.raw += text
      c.el.__raw = c.raw
      const now = performance.now()
      c.firstIn ||= now
      if (c.lastIn) c.lag = Math.min(.6, Math.max(.4, (now - c.lastIn) / 1000 * 1.1, c.lag * .985)) // live replies pause for up to 400 ms, late on too
      c.lastIn = now
      c.inRate += text.length / .8
      v.kick()
    }
    v.addUser = (text, files, reply) => {
      v.clearEmpty()
      v.lastA = null
      v.endBrowser()
      const m = document.createElement('div'); m.className = 'msg u'
      const b = document.createElement('div'); b.className = 'bub'; b.textContent = text
      if (reply) { const q = document.createElement('span'); q.className = 'rqt'; q.textContent = reply; b.prepend(q) }
      if (files && files.length) { v.lastFiles = filesEl(files, () => v.scrollEnd()); b.append(v.lastFiles) }
      m.append(b); log.append(m); v.scrollEnd(true)
    }
    // The hub has saved them, so the chips can open from there instead of from this page's memory.
    v.setFiles = list => { const el = filesEl(list, () => v.scrollEnd()); v.lastFiles?.replaceWith(el); v.lastFiles = el }
    v.addAttachment = f => {
      v.clearEmpty()
      const g = { ...f, conv: S.conv }
      const m = document.createElement('div'); m.className = 'msg a afile'
      if (isPic(g)) m.append(picEl(g, () => v.scrollEnd()))
      m.append(attEl(g))
      log.append(m); v.scrollEnd(true)
    }
    v.addAssistant = (raw, final = true, meta = null) => {
      v.clearEmpty()
      const m = document.createElement('div'); m.className = 'msg a'
      const b = document.createElement('div'); b.className = 'bub'
      const acts = document.createElement('div'); acts.className = 'acts'
      acts.innerHTML = actsHtml(meta)
      if (final && raw) v.lastA = m
      m.append(b, acts)
      m.__raw = raw || ''
      b.innerHTML = md(raw || '')
      acts.hidden = !final
      log.append(m); v.scrollEnd()
      const c = { el: m, bub: b, acts, raw: raw || '', shown: 0, acc: 0, rate: 90, inRate: 0, lag: .4, firstIn: 0, lastIn: 0, endRate: 0, ending: false, stale: false, blocks: null }
      if (!final) { m.__live = true; v.live.push(c) }
      return c
    }
    v.setText = text => {
      const c = v.cur
      if (!text.startsWith(c.raw.slice(0, c.shown))) c.shown = text.length // the final text differs from what was shown
      c.raw = text
    }
    // The reply's text is complete: show the rest within .18 s, so the last chunk neither pops in nor makes the reader wait.
    v.finishCur = () => {
      const c = v.cur
      if (!c) return
      v.cur = null
      c.el.__raw = c.raw
      if (c.raw.trim()) v.lastA = c.el
      c.ending = true
      c.endRate = (c.raw.length - c.shown) / .18
      if (c.shown >= c.raw.length || document.hidden || REDUCED.matches) v.settle(c)
      else v.kick()
    }
    // The turn finished: put its time, duration and tokens on its last answer.
    v.setMeta = meta => {
      const m = v.lastA
      if (!m || !meta || !m.isConnected) return
      const acts = m.querySelector('.acts')
      acts.innerHTML = actsHtml(meta)
      acts.hidden = !!m.__live
      v.scrollEnd()
    }
    v.addTool = t => {
      v.clearEmpty()
      const el = document.createElement('div'); el.className = 'tool'
      el.innerHTML = `<button type="button" aria-expanded="false"><span class="st"><i class="spin"></i></span><span class="lbl"></span><span class="chev">${IC.chev}</span></button><div class="det"><pre class="d1"></pre><pre class="d2" hidden></pre></div>`
      el.querySelector('.lbl').textContent = t.label || t.name || 'Working'
      el.querySelector('.d1').textContent = t.detail || ''
      if (!t.detail) el.querySelector('.d1').hidden = true
      el.dataset.tid = t.id || ''
      log.append(el)
      if (t.result != null || t.ok != null) v.setToolResult(el, t.ok !== false, t.result)
      v.scrollEnd()
      return el
    }
    v.setToolResult = (elOrId, ok, text) => {
      const el = typeof elOrId === 'string' ? [...log.querySelectorAll('.tool')].find(t => t.dataset.tid === elOrId) : elOrId
      if (!el) return
      const st = el.querySelector('.st')
      st.className = `st ${ok ? 'ok' : 'bad'}`
      st.innerHTML = ok ? IC.check : IC.warn
      const d2 = el.querySelector('.d2')
      if (text) { d2.textContent = String(text); d2.hidden = false }
    }
    // show_site: the hub's own site card (tabs/custom.js), a live preview or an Open in New Tab row.
    v.addSite = s => {
      v.clearEmpty()
      const m = document.createElement('div'); m.className = 'msg site'
      if (window.hub?.siteCard) {
        siteStyles()
        m.append(window.hub.siteCard(s.url, { name: s.name, icon: s.icon, height: log === clogEl ? 170 : 300 }))
      } else {
        const a = document.createElement('a'); a.className = 'sitelink'; a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer'
        a.textContent = `Open ${s.name || s.url} in a new tab`
        m.append(a)
      }
      log.append(m); v.scrollEnd(true)
    }
    // Hub browser: one card per turn. While the turn runs it streams live (HubBrowser.mini, only in the
    // view on screen, so one stream); after, it keeps the last step's screenshot. History shows that too.
    v.browser = null
    const watch = () => { if (S.full) setFull(false); window.HubBrowser?.open() }
    v.addBrowser = (b, live) => {
      v.clearEmpty()
      const m = document.createElement('div'); m.className = 'msg bro'
      m.innerHTML = '<div class="brc"><div class="brb"><i class="live" aria-hidden="true"></i><span class="brt"></span><button type="button" class="brw">Watch</button></div><div class="brm" title="Open the Browser tab"></div><div class="brh" role="status" hidden><span></span><button type="button">Take control</button></div></div>'
      m.querySelector('.brw').addEventListener('click', watch)
      m.querySelector('.brh button').addEventListener('click', watch)
      m.querySelector('.brm').addEventListener('click', e => { if (e.target.tagName === 'IMG') watch() })
      log.append(m)
      const c = { el: m, mini: null, b: {} }
      v.setBrowser(c, b, live)
      v.scrollEnd(true)
      return c
    }
    v.setBrowser = (c, b, live) => {
      for (const k of ['shot', 'url', 'title', 'handoff']) if (b[k] != null) c.b[k] = b[k]
      const { el } = c, d = c.b
      let host = ''
      try { host = new URL(d.url).host } catch {}
      const t = el.querySelector('.brt')
      t.textContent = d.title || host || 'Hub browser'
      if (d.title && host) { const s = document.createElement('small'); s.textContent = host; t.append(s) }
      const media = el.querySelector('.brm')
      const onScreen = log === flogEl ? S.full : !S.full
      if (live && onScreen && window.HubBrowser?.mini) {
        if (!c.mini) { media.replaceChildren(); c.mini = window.HubBrowser.mini(media, {}) }
      } else {
        c.mini?.close(); c.mini = null
        if (typeof d.shot === 'string' && d.shot.startsWith('/api/browser/shots/')) {
          let img = media.querySelector('img')
          if (!img) { img = document.createElement('img'); img.alt = 'What the hub browser showed'; img.decoding = 'async'; media.replaceChildren(img) }
          if (img.getAttribute('src') !== d.shot) img.src = d.shot
        }
      }
      el.classList.toggle('on', !!live)
      const h = el.querySelector('.brh')
      h.hidden = !d.handoff
      if (d.handoff) h.querySelector('span').textContent = `Your turn: ${d.handoff}`
    }
    v.endBrowser = () => { if (v.browser) v.setBrowser(v.browser, {}, false); v.browser = null }
    // A send, buy or delete in the browser waits for this. Allow is the only yes the hub accepts.
    v.addConfirm = (c, answered) => {
      v.clearEmpty()
      const el = document.createElement('div'); el.className = 'confirm'; el.dataset.confirm = c.id
      let site = ''
      try { site = new URL(c.url).hostname } catch {}
      const h = document.createElement('div'); h.className = 'confirm-what'; h.textContent = c.what || 'Allow this step in the browser?'
      const d = document.createElement('div'); d.className = 'confirm-on'; d.textContent = [c.label && `“${c.label}”`, site && `on ${site}`].filter(Boolean).join(' ')
      const row = document.createElement('div'); row.className = 'confirm-row'
      const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'yes'; yes.textContent = 'Allow'
      const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Don’t'
      yes.addEventListener('click', () => answerConfirm(c, true))
      no.addEventListener('click', () => answerConfirm(c, false))
      row.append(yes, no)
      el.append(h, ...(d.textContent ? [d] : []), row)
      log.append(el)
      // Anything can sit below the fold of a long card, so Allow waits until its end has been on screen. A hidden tab measures 0, so it waits for that too.
      if (d.textContent && !answered) {
        let read = false
        const check = () => {
          if (read || !d.clientHeight || !yes.isConnected || no.disabled) return // Don't is on its way, so Allow stays off
          read = d.scrollHeight - d.scrollTop - d.clientHeight <= 4
          yes.disabled = !read
          yes.textContent = read ? 'Allow' : 'Scroll to read all'
          d.tabIndex = read ? -1 : 0
          if (read) { d.removeEventListener('scroll', check); seen.disconnect() }
        }
        const seen = new ResizeObserver(check)
        yes.disabled = true
        d.addEventListener('scroll', check, { passive: true })
        seen.observe(d)
        check()
      }
      if (answered) settleConfirm(c.id, 'Answered')
      v.scrollEnd(true)
    }
    // Connecting happens in the hub's own sheet, so the key never passes through the chat. tabs/connections.js handles data-connect.
    v.addConnect = c => {
      v.clearEmpty()
      const el = document.createElement('div'); el.className = 'confirm'
      const h = document.createElement('div'); h.className = 'confirm-what'; h.textContent = `Connect ${c.name || 'this service'}?`
      const d = document.createElement('div'); d.className = 'confirm-on'; d.textContent = 'You enter the key in the hub. It stays on this computer.'
      const row = document.createElement('div'); row.className = 'confirm-row'
      const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'yes'; yes.textContent = 'Connect'; yes.dataset.connect = c.id
      row.append(yes)
      el.append(h, d, row)
      log.append(el)
      v.scrollEnd(true)
    }
    v.addError = text => {
      v.clearEmpty()
      const el = document.createElement('div'); el.className = 'err'; el.setAttribute('role', 'alert'); el.textContent = text
      log.append(el); v.scrollEnd(true)
    }
    v.showPending = () => {
      if (v.pending) return
      v.clearEmpty()
      const m = document.createElement('div'); m.className = 'msg a'
      m.innerHTML = '<div class="bub"><span class="dots" aria-label="Thinking"><i></i><i></i><i></i></span></div>'
      log.append(m); v.pending = m; v.scrollEnd(true)
    }
    v.hidePending = () => { v.pending?.remove(); v.pending = null }
    v.empty = () => {
      v.clear()
      const list = SUGGEST[curEnv()] || SUGGEST.home
      const box = document.createElement('div'); box.className = 'empty'
      box.dataset.tabk = curEnv()
      box.innerHTML = `<div class="logo">${IC.chat}</div><h3>${esc(AGENT)}</h3><p>Ask me anything. I can research the web, write, use the browser, and I know this hub best: usage, servers, storage, the calendar, and its look and layout.</p><div class="chips">${list.map(t => `<button type="button" class="chip">${esc(t)}</button>`).join('')}</div>`
      log.append(box)
    }
    log.addEventListener('click', e => {
      const chip = e.target.closest('.chip')
      if (chip) { send(chip.textContent); return }
      const cp = e.target.closest('.cp')
      if (cp) {
        copyText(cp.closest('.code')?.querySelector('code')?.textContent || '').then(() => { cp.lastChild.textContent = 'Copied'; setTimeout(() => (cp.lastChild.textContent = 'Copy'), 1200) })
        return
      }
      const rp = e.target.closest('[data-act="reply"]')
      if (rp) { setReply(v.selQuote || rp.closest('.msg')?.querySelector('.bub')?.innerText || ''); v.selQuote = ''; return }
      const ac = e.target.closest('[data-act="copy"]')
      if (ac) {
        copyText(ac.closest('.msg')?.__raw || '').then(() => { ac.lastChild.textContent = 'Copied'; setTimeout(() => (ac.lastChild.textContent = 'Copy'), 1200) })
        return
      }
      const tl = e.target.closest('.tool > button')
      if (tl) { const t = tl.parentElement; t.classList.toggle('open'); tl.setAttribute('aria-expanded', String(t.classList.contains('open'))) }
    })
    // Reply quotes the selected part of that answer when there is one (read before the press clears it).
    log.addEventListener('pointerdown', e => {
      const rp = e.target.closest('[data-act="reply"]')
      if (!rp) return
      const sel = shadow.getSelection ? shadow.getSelection() : window.getSelection()
      const bub = rp.closest('.msg')?.querySelector('.bub')
      v.selQuote = sel && !sel.isCollapsed && bub && bub.contains(sel.anchorNode) ? String(sel).trim() : ''
    })
    // Touch has no hover: a tap on a reply shows (or hides) its row.
    log.addEventListener('pointerup', e => {
      if (e.pointerType !== 'touch') return
      const m = e.target.closest('.msg.a')
      if (!m || e.target.closest('a, button, .tbl, .code')) return
      for (const o of log.querySelectorAll('.msg.show')) if (o !== m) o.classList.remove('show')
      m.classList.toggle('show')
    })
    return v
  }
  const cardView = makeView(clogEl)
  const fullView = makeView(flogEl)
  const views = [cardView, fullView]
  // A hidden tab gets no animation frames, so its replies skip the pacing and are whole when the reader comes back.
  document.addEventListener('visibilitychange', () => views.forEach(v => v.flush()))

  /* ---------- the card and the full chat: show, hide ---------- */

  function syncCard() {
    const on = S.cardOn && !S.full
    card.classList.toggle('on', on)
    if (on) { card.removeAttribute('inert'); updateSub() } else card.setAttribute('inert', '')
    cStop.hidden = !S.busy
  }
  function measureBar() { rootEl.style.setProperty('--barh', `${Math.round(bar.getBoundingClientRect().height) || 54}px`) }
  if (window.ResizeObserver) new ResizeObserver(measureBar).observe(bar)

  // The phone keyboard: lift the bar and the sheet with the visual viewport.
  const vv = window.visualViewport
  function fitViewport() {
    if (!PHONE.matches || !vv) { rootEl.style.setProperty('--kb', '0px'); fp.style.top = fp.style.height = ''; return }
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
    rootEl.style.setProperty('--kb', `${kb > 60 ? Math.round(kb) : 0}px`)
    if (S.full) { fp.style.top = `${vv.offsetTop + 10}px`; fp.style.height = `${vv.height - 10}px`; fp.style.bottom = 'auto' }
  }
  if (vv) { vv.addEventListener('resize', fitViewport); vv.addEventListener('scroll', fitViewport) }
  PHONE.addEventListener?.('change', fitViewport)

  function updateSub() {
    const t = curTitle()
    const text = window.HubBrowser?.isOpen?.() ? 'Looking at the browser' : t ? `Looking at the ${t} tab` : (window.HUB_CONF?.name || 'LocalHub')
    ctxEls.forEach(el => { if (el.textContent !== text) el.textContent = text })
  }
  setInterval(() => { if (S.cardOn && !S.full) updateSub() }, 1500)
  document.addEventListener('hub-browser-state', updateSub)
  function updateCtx() {
    updateSub()
    const em = flogEl.querySelector('.empty')
    const has = flogEl.querySelector('.msg, .tool, .err')
    if (!S.conv && !S.busy && !has && (!em || em.dataset.tabk !== curEnv())) fullView.empty()
  }
  function setFull(on) {
    on = !!on
    if (on === S.full) return
    S.full = on
    closeMenu()
    if (on) {
      fitViewport()
      full.removeAttribute('inert')
      full.classList.add('on')
      bar.classList.add('away'); bar.setAttribute('inert', '')
      if (bta.value) { fta.value = bta.value; bta.value = '' ; grow(bta, barPill); grow(fta, fPill) }
      updateCtx()
      clearInterval(S.ctxTimer)
      S.ctxTimer = setInterval(updateCtx, 1500)
      if (!flogEl.children.length) fullView.empty()
      syncSend()
      fullView.scrollEnd(true)
      setTimeout(() => fta.focus({ preventScroll: true }), 80)
    } else {
      if (S.hist) toggleHist(false)
      full.classList.remove('on')
      full.setAttribute('inert', '')
      bar.classList.remove('away'); bar.removeAttribute('inert')
      clearInterval(S.ctxTimer)
      if (fta.value) { bta.value = fta.value; fta.value = ''; grow(bta, barPill); grow(fta, fPill) }
      fp.style.top = fp.style.height = fp.style.bottom = ''
      syncSend()
      setTimeout(() => bta.focus({ preventScroll: true }), 80)
    }
    syncCard()
  }
  cExpand.addEventListener('click', () => setFull(true))
  fX.addEventListener('click', () => setFull(false))
  scrim.addEventListener('click', () => setFull(false))
  cClose.addEventListener('click', () => { S.cardOn = false; syncCard(); bta.focus({ preventScroll: true }) })
  cStop.addEventListener('click', () => stop())
  $('.cnew').addEventListener('click', () => { newChat(); S.cardOn = false; syncCard(); bta.focus({ preventScroll: true }) })
  $('.chist').addEventListener('click', () => { setFull(true); toggleHist(true) })
  // The sheen follows the pointer; its colour depends on whether the theme is dark, which only the rendered text can tell.
  shadow.querySelectorAll('.ghead').forEach(h => {
    h.addEventListener('pointerenter', () => {
      const dark = parseInt(/\d+/.exec(getComputedStyle(h.querySelector('b')).color)?.[0] ?? '0', 10) > 128
      h.style.setProperty('--sheen', dark ? 'rgba(255, 255, 255, .13)' : 'rgba(255, 255, 255, .95)')
    })
    h.addEventListener('pointermove', e => h.style.setProperty('--gx', `${Math.round(e.clientX - h.getBoundingClientRect().left)}px`), { passive: true })
  })

  // Ctrl+/ (Cmd+/) toggles the full chat, Ctrl+K (Cmd+K) jumps to the bar; plain "/" stays the hub's search key.
  window.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
    if (e.key === '/' || e.code === 'Slash') { e.preventDefault(); e.stopPropagation(); setFull(!S.full) }
    else if ((e.key === 'k' || e.key === 'K') && !window.LAUNCHER) { e.preventDefault(); e.stopPropagation(); if (S.full) fta.focus(); else bta.focus() }
  }, true)

  // Nothing typed in the chat may reach the hub's own shortcuts (1-8, /, f, r, Backspace ...).
  for (const t of ['keydown', 'keyup', 'keypress']) rootEl.addEventListener(t, e => e.stopPropagation())
  rootEl.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    if (S.rec) { e.preventDefault(); stopDictate(); return }
    if (S.full) { e.preventDefault(); if (S.hist) toggleHist(false); else setFull(false) }
    else if (S.cardOn) { e.preventDefault(); S.cardOn = false; syncCard() }
    else if (e.target === bta) bta.blur()
  })

  /* ---------- info (the models the server allows) ---------- */

  const MODEL_KEY = 'hub-chat-model', EFFORT_KEY = 'hub-chat-effort', MODE_KEY = 'hub-chat-mode'
  S.effort = store.get(EFFORT_KEY, '')
  S.mode = store.get(MODE_KEY, '') === 'plan' ? 'plan' : 'auto'
  async function loadInfo() {
    try {
      const info = await (await hubFetch('/api/chat/info')).json()
      S.info = info
      const ids = (info.models || []).map(([v]) => v)
      const saved = store.get(MODEL_KEY, '')
      S.model = ids.includes(saved) ? saved : ids.includes(info.defaultModel) ? info.defaultModel : ids[0] || ''
      if (!(info.efforts || []).some(([v]) => v === S.effort)) S.effort = ''
      if (!(info.modes || []).some(([v]) => v === S.mode)) S.mode = 'auto'
      syncRec()
    } catch { S.info = null }
  }
  const modelName = id => ((S.info?.models || []).find(([v]) => v === id) || [])[1] || 'Default'

  /* ---------- the + menu: Attach files, Model, Effort, Mode, Dictate, Full screen ---------- */

  let menuFrom = null // the + button that opened it
  function menuRow(act, icon, label, value = '', extra = '') {
    return `<button type="button" class="mi" role="menuitem" data-act="${act}"${extra}><span class="mic">${icon}</span><span class="ml">${esc(label)}</span>${value ? `<span class="mv">${value}</span>` : ''}</button>`
  }
  // The rows with a pop-out: their choices, what's chosen now, and where a choice goes.
  const flyRows = () => ({
    model: { label: 'Model', icon: IC.brain, list: S.info?.models || [], now: S.model, set: v => { S.model = v; store.set(MODEL_KEY, v) } },
    effort: { label: 'Effort', icon: IC.gauge, list: S.info?.efforts || [], now: S.effort, set: v => { S.effort = v; store.set(EFFORT_KEY, v) } },
    mode: { label: 'Mode', icon: IC.compass, list: S.info?.modes || [], now: S.mode, set: v => { S.mode = v; store.set(MODE_KEY, v); syncRec() } },
  })
  function flyRow(key) {
    const f = flyRows()[key]
    const name = (f.list.find(([v]) => v === f.now) || [])[1] || (f.list.length ? 'Default' : 'Loading…')
    return menuRow(key, f.icon, f.label, `${esc(name)}${IC.chev}`, ` data-fly="${key}" aria-haspopup="menu" aria-expanded="false"`)
  }
  function renderMenu() {
    menu.innerHTML =
      menuRow('attach', IC.clip, 'Attach files') +
      flyRow('model') + flyRow('effort') + flyRow('mode') +
      menuRow('dictate', IC.mic, S.rec ? 'Stop dictation' : 'Dictate') +
      '<div class="msep" role="separator"></div>' +
      menuRow('full', S.full ? IC.collapse19 : IC.expand19, S.full ? 'Exit full screen' : 'Full screen')
  }
  let flyFor = '', flyTimer = 0, lastPointer = 'mouse'
  const flyRowEl = () => menu.querySelector(`[data-fly="${flyFor}"]`)
  function openFly(key, focus = false) {
    clearTimeout(flyTimer)
    const f = flyRows()[key]
    if (!f.list.length) return
    flyRowEl()?.setAttribute('aria-expanded', 'false')
    flyFor = key
    flyRowEl().setAttribute('aria-expanded', 'true')
    fly.setAttribute('aria-label', f.label)
    fly.innerHTML = `<button type="button" class="mi back" hidden><span class="mic">${IC.chev}</span><span class="ml">${esc(f.label)}</span></button>` +
      f.list.map(([v, l, hint]) => `<button type="button" class="mi${hint ? ' two' : ''}" role="menuitemradio" aria-checked="${v === f.now}" data-v="${esc(v)}"><span class="ck">${v === f.now ? IC.check : ''}</span><span class="ml">${esc(l)}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</span></button>`).join('')
    fly.hidden = false
    placeFly()
    if (focus) (fly.querySelector('[aria-checked="true"]') || fly.querySelector('[data-v]'))?.focus({ preventScroll: true })
  }
  function closeFly(refocus = false) {
    clearTimeout(flyTimer)
    if (fly.hidden) return
    fly.hidden = true
    menu.classList.remove('under')
    const row = flyRowEl()
    row?.setAttribute('aria-expanded', 'false')
    flyFor = ''
    if (refocus) row?.focus({ preventScroll: true })
  }
  // Beside its row, on the right if it fits and otherwise the left. With no room on either side, as on a phone, it takes the menu's place.
  function placeFly() {
    if (fly.hidden) return
    const row = flyRowEl()
    if (!row) return
    const GAP = 6, EDGE = 12, vw = document.documentElement.clientWidth, vh = window.innerHeight
    menu.classList.remove('under')
    fly.querySelector('.back').hidden = true
    fly.style.width = ''
    fly.style.left = '0px'; fly.style.top = '0px'; fly.style.bottom = 'auto'
    const m = menu.getBoundingClientRect(), r = row.getBoundingClientRect(), w = fly.offsetWidth
    const side = m.right + GAP + w <= vw - EDGE ? m.right + GAP : m.left - GAP - w >= EDGE ? m.left - GAP - w : null
    if (side == null) {
      fly.querySelector('.back').hidden = false
      menu.classList.add('under')
      fly.style.width = `${m.width}px`
      fly.style.left = `${m.left}px`
      fly.style.top = `${Math.max(EDGE, Math.min(m.bottom - fly.offsetHeight, vh - fly.offsetHeight - EDGE))}px`
      return
    }
    fly.style.left = `${side}px`
    fly.style.top = `${Math.max(EDGE, Math.min(r.top - 6, vh - fly.offsetHeight - EDGE))}px`
  }
  function placeMenu() {
    if (!menuFrom || menu.hidden) return
    const r = menuFrom.getBoundingClientRect()
    const w = menu.offsetWidth, vw = document.documentElement.clientWidth
    menu.style.left = `${Math.max(12, Math.min(r.left - 4, vw - w - 12))}px`
    menu.style.bottom = `${Math.max(12, window.innerHeight - r.top + 8)}px`
    menu.style.top = 'auto'
  }
  function openMenu(btn) {
    if (S.rec) { stopDictate(); return } // while listening, the + is the stop button
    if (!menu.hidden && menuFrom === btn) { closeMenu(); return }
    closeFly()
    menuFrom = btn
    renderMenu()
    menu.hidden = false
    for (const b of [bPlus, fPlus]) b.setAttribute('aria-expanded', String(b === btn))
    placeMenu()
    // Filling the rows replaces them, so focus goes back on the first one (Esc and the arrows need it).
    if (!S.info) loadInfo().then(() => { if (!menu.hidden) { renderMenu(); placeMenu(); menu.querySelector('.mi')?.focus({ preventScroll: true }) } })
    requestAnimationFrame(() => menu.querySelector('.mi')?.focus({ preventScroll: true }))
  }
  function closeMenu(refocus = false) {
    if (menu.hidden) return
    closeFly()
    menu.hidden = true
    for (const b of [bPlus, fPlus]) b.setAttribute('aria-expanded', 'false')
    if (refocus) menuFrom?.focus({ preventScroll: true })
  }
  bPlus.addEventListener('click', () => openMenu(bPlus))
  fPlus.addEventListener('click', () => openMenu(fPlus))
  menu.addEventListener('click', e => {
    const b = e.target.closest('.mi')
    if (!b) return
    const act = b.dataset.act
    // A mouse has already opened it by hovering, so a click keeps it. A tap toggles, and a key press goes into the list.
    if (b.dataset.fly) {
      const typed = e.detail === 0
      if (flyFor === b.dataset.fly && !typed && lastPointer !== 'mouse') closeFly(); else openFly(b.dataset.fly, typed)
      return
    }
    closeMenu()
    if (act === 'attach') { pick.value = ''; pick.click() }
    else if (act === 'dictate') S.rec ? stopDictate() : startDictate()
    else if (act === 'full') setFull(!S.full)
  })
  menu.addEventListener('pointerdown', e => { lastPointer = e.pointerType }, true)
  fly.addEventListener('pointerdown', e => { lastPointer = e.pointerType }, true)
  // Hovering opens a row's pop-out, or closes it on a row without one. The wait lets the pointer cross another row on its way to the panel.
  menu.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return
    const b = e.target.closest('.mi')
    if (!b) return
    clearTimeout(flyTimer)
    const key = b.dataset.fly || ''
    if (key === flyFor) return
    flyTimer = setTimeout(() => { if (key) openFly(key); else closeFly() }, flyFor ? 180 : 60)
  })
  fly.addEventListener('pointerover', () => clearTimeout(flyTimer))
  fly.addEventListener('click', e => {
    const b = e.target.closest('.mi')
    if (!b) return
    if (b.classList.contains('back')) { closeFly(true); return }
    const f = flyRows()[flyFor]
    f.set(b.dataset.v)
    const name = (f.list.find(([v]) => v === b.dataset.v) || [])[1]
    closeMenu()
    flash(`${f.label}: ${name}`, 1800)
    activeTa().focus({ preventScroll: true })
  })
  // Arrow keys move through the rows, right goes into a pop-out and left comes back out.
  const arrowRows = (box, e) => {
    e.preventDefault()
    const rows = [...box.querySelectorAll('.mi:not([hidden])')]
    const i = rows.indexOf(shadow.activeElement)
    rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus()
  }
  menu.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { closeFly(); arrowRows(menu, e); return }
    const key = shadow.activeElement?.dataset?.fly
    if (e.key === 'ArrowRight' && key) { e.preventDefault(); openFly(key, true) }
  })
  fly.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') arrowRows(fly, e)
    else if (e.key === 'ArrowLeft') { e.preventDefault(); closeFly(true) }
  })
  // Esc closes it wherever the focus is, before anything else on the page sees the key.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || menu.hidden) return
    e.preventDefault(); e.stopPropagation()
    if (!fly.hidden) closeFly(true); else closeMenu(true)
  }, true)
  // A press anywhere outside the menu and its + button closes it.
  document.addEventListener('pointerdown', e => {
    if (menu.hidden) return
    const p = e.composedPath()
    if (!p.includes(menu) && !p.includes(fly) && !p.includes(menuFrom)) closeMenu()
  }, true)
  window.addEventListener('resize', () => { placeMenu(); placeFly() })

  const activeTa = () => (S.full ? fta : bta)
  // Test runs set sessionStorage hub-chat-test to "1": their chats stay out of the real history.
  const isTest = () => { try { return sessionStorage.getItem('hub-chat-test') === '1' } catch { return false } }

  // A short message above the composer (dictation unavailable, a file too big, ...).
  function flash(text, ms = 6000) {
    clearTimeout(S.noteTimer)
    for (const n of noteEls) n.textContent = text
    S.noteTimer = setTimeout(() => { for (const n of noteEls) n.textContent = '' }, ms)
  }

  /* ---------- attachments ---------- */

  const MAX_FILES = () => S.info?.maxFiles || 5
  const MAX_MB = () => S.info?.maxFileMB || 10
  const size = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`)
  function renderAtts() {
    for (const box of attsEls) {
      box.replaceChildren(...S.files.map((f, i) => attEl(f, () => {
        const [gone] = S.files.splice(i, 1)
        if (gone?.url) URL.revokeObjectURL(gone.url)
        // The whole draft went into this one, so taking it off gives the draft back.
        const t = activeTa()
        if (gone?.restore && !t.value) { t.value = gone.restore; t.dispatchEvent(new Event('input')) }
        renderAtts(); syncSend(); t.focus({ preventScroll: true })
      })))
    }
  }
  const fileHref = (f, q = '') => `/api/chat/file/${encodeURIComponent(f.conv || S.conv)}/${f.id}${q}`
  const fileLabel = f => (f.paste || /^pasted-text-\d/.test(f.name || '') ? 'Pasted text' : f.name)
  const isPic = f => f.view === 'image' || !!f.url
  const isReadable = f => f.view === 'text' || !!f.paste || (!!f.file && (/^text\//.test(f.file.type) || /\.(txt|md|csv|tsv|json|log|ya?ml|xml|html?|js|mjs|ts|py|ps1|sh|ini|toml)$/i.test(f.name)))
  // One attachment as a chip: in the composer with a remove button, in a message with a save button.
  function attEl(f, onRemove) {
    const el = document.createElement('span'); el.className = 'att'
    const label = fileLabel(f)
    const open = document.createElement(isPic(f) || isReadable(f) ? 'button' : 'span'); open.className = 'ao'
    if (open.tagName === 'BUTTON') { open.type = 'button'; open.setAttribute('aria-label', `Open ${label}`); open.addEventListener('click', () => openFile(f, open)) }
    let thumb
    if (isPic(f)) { thumb = document.createElement('img'); thumb.src = f.url || fileHref(f); thumb.alt = '' } else { thumb = document.createElement('span'); thumb.className = 'fi'; thumb.innerHTML = IC.file }
    const n = document.createElement('span'); n.className = 'an'; n.textContent = label; n.title = f.preview || f.name
    const s = document.createElement('span'); s.className = 'as'; s.textContent = f.gone ? 'No longer here' : f.lines ? `${f.lines} line${f.lines === 1 ? '' : 's'}` : size(f.size)
    open.append(thumb, n, s)
    el.append(open)
    if (f.id) {
      const a = document.createElement('a'); a.className = 'asv'; a.href = fileHref(f, '?download=1'); a.download = f.name; a.innerHTML = IC.save; a.title = 'Save'; a.setAttribute('aria-label', `Save ${label}`)
      el.append(a)
    }
    if (onRemove) {
      const x = document.createElement('button'); x.type = 'button'; x.innerHTML = IC.x14; x.setAttribute('aria-label', `Remove ${label}`)
      x.addEventListener('click', onRemove)
      el.append(x)
    }
    return el
  }
  function picEl(f, onLoad) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'apic'; b.setAttribute('aria-label', `Open ${f.name}`)
    const img = document.createElement('img'); img.alt = f.name; img.src = f.url || fileHref(f)
    if (onLoad) img.addEventListener('load', onLoad)
    img.addEventListener('error', () => b.replaceWith(attEl({ name: f.name, size: f.size, gone: true })))
    b.append(img)
    b.addEventListener('click', () => openFile(f, b))
    return b
  }
  // What a message shows. Chats from before attachments were kept only have the names.
  function filesEl(list, onLoad) {
    if (list.every(f => typeof f === 'string')) { const s = document.createElement('span'); s.className = 'files'; s.textContent = `Attached: ${list.join(', ')}`; return s }
    const w = document.createElement('div'); w.className = 'afiles'
    for (const f of list) {
      const g = f.id ? { ...f, conv: S.conv } : f
      w.append(isPic(g) ? picEl(g, onLoad) : attEl(g))
    }
    return w
  }

  /* ---------- reading an attachment ---------- */

  const SHOW_CHARS = 3e6
  const fv = $('.fv'), fvName = $('.fvn'), fvSize = $('.fvs'), fvCopy = $('.fvc'), fvSave = $('.fvd'), fvBody = $('.fvb'), fvClose = $('.fvx')
  let fvOpen = 0, fvFrom = null, fvBlob = '', fvText = ''
  function closeFile() {
    if (fv.hidden) return
    fvOpen++
    fv.hidden = true
    fvBody.replaceChildren()
    fvText = ''
    if (fvBlob) { URL.revokeObjectURL(fvBlob); fvBlob = '' }
    if (fvFrom?.isConnected) fvFrom.focus({ preventScroll: true })
    fvFrom = null
  }
  async function openFile(f, from) {
    const turn = ++fvOpen
    fvFrom = from
    fvName.textContent = fileLabel(f); fvName.title = f.name
    fvSize.textContent = f.size != null ? size(f.size) : ''
    if (fvBlob) { URL.revokeObjectURL(fvBlob); fvBlob = '' }
    if (f.id) fvSave.href = fileHref(f, '?download=1')
    else { fvBlob = URL.createObjectURL(f.file); fvSave.href = fvBlob }
    fvSave.download = f.name
    fvCopy.hidden = true
    fvBody.replaceChildren()
    fv.hidden = false
    fvClose.focus({ preventScroll: true })
    if (isPic(f)) {
      const img = document.createElement('img'); img.alt = f.name; img.src = f.url || fileHref(f)
      fvBody.append(img)
      return
    }
    const pre = document.createElement('pre'); pre.textContent = 'Loading…'
    fvBody.append(pre)
    try {
      const text = f.id
        ? await fetch(fileHref(f, '?text=1')).then(r => { if (!r.ok) throw new Error(); return r.text() })
        : await f.file.text()
      if (turn !== fvOpen) return
      pre.textContent = text.length > SHOW_CHARS ? text.slice(0, SHOW_CHARS) : text
      if (text.length > SHOW_CHARS) { const cut = document.createElement('div'); cut.className = 'fvcut'; cut.textContent = 'This is the first part. Save the file to read the rest.'; fvBody.append(cut) }
      fvText = text
      fvCopy.hidden = false
      fvBody.scrollTop = 0
    } catch {
      if (turn === fvOpen) pre.textContent = 'That file couldn’t be opened. It may no longer be here.'
    }
  }
  fvClose.addEventListener('click', closeFile)
  fvCopy.addEventListener('click', async () => {
    await copyText(fvText)
    fvCopy.innerHTML = IC.check
    setTimeout(() => { fvCopy.innerHTML = IC.copy18 }, 1200)
  })
  fv.addEventListener('click', e => { if (e.target === fv) closeFile() })
  fv.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFile(); return }
    if (e.key !== 'Tab') return
    // Keeps Tab inside while it's open.
    const stops = [fvCopy, fvSave, fvClose].filter(x => !x.hidden)
    const at = stops.indexOf(shadow.activeElement)
    e.preventDefault()
    stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus()
  })

  /* ---------- adding files: the + button, paste and drop all come here ---------- */

  const LONG_TEXT = () => S.info?.longText || 16000
  const keyName = name => {
    try { return !!S.info?.keyNames && (new RegExp(S.info.keyNames, 'i').test(name) || /::|:\$|~\d/.test(name)) } catch { return false }
  }
  function addFiles(list, folders = []) {
    const skipped = folders.map(n => `${n} is a folder`)
    for (const file of list) {
      if (S.files.length >= MAX_FILES()) { skipped.push(`only ${MAX_FILES()} files fit in one message`); break }
      if (file.size > MAX_MB() * 1048576) { skipped.push(`${file.name} is over ${MAX_MB()} MB`); continue }
      if (!file.size) { skipped.push(`${file.name} is empty or a folder`); continue }
      if (keyName(file.name)) { skipped.push(`files named like ${file.name} usually hold keys, so the assistant can’t open them`); continue }
      S.files.push({ file, name: file.name, size: file.size, url: /^image\//.test(file.type) ? URL.createObjectURL(file) : '' })
    }
    if (skipped.length) flash(`Not attached: ${skipped.join('; ')}.`)
    renderAtts(); syncSend()
  }
  const clock = () => new Date().toTimeString().slice(0, 8).replace(/:/g, '')
  function textFile(text) {
    const file = new File([text], `pasted-text-${clock()}.txt`, { type: 'text/plain' })
    return { file, name: file.name, size: file.size, url: '', paste: true, lines: text.split('\n').length, preview: text.slice(0, 120) }
  }
  // Long text goes in as a file the assistant can read, with whatever draft it replaced kept for if it's removed.
  function attachText(text, restore = '') {
    if (S.files.length >= MAX_FILES()) { flash(`Not attached: only ${MAX_FILES()} files fit in one message.`); return false }
    const f = textFile(text)
    if (f.size > MAX_MB() * 1048576) { flash(`Not attached: that text is over ${MAX_MB()} MB.`); return false }
    S.files.push(restore ? { ...f, restore } : f)
    renderAtts(); syncSend()
    return true
  }
  function onPaste(e, t) {
    const cd = e.clipboardData
    if (!cd) return
    const text = cd.getData('text/plain')
    const items = [...(cd.items || [])].filter(i => i.kind === 'file')
    const folders = items.map(i => i.webkitGetAsEntry?.()).filter(x => x?.isDirectory).map(x => x.name)
    let files = [...cd.files]
    // Word and Excel copy a picture of the selection along with its words, and the words are what's meant.
    if (files.length && text.trim() && files.every(f => /^image\//.test(f.type))) files = []
    if (files.length || folders.length) {
      e.preventDefault()
      // A copied screenshot is always called image.png, so each gets its own name.
      addFiles(files.filter(f => !folders.includes(f.name)).map((f, i) => (!f.name || /^image\.\w+$/i.test(f.name) ? new File([f], `pasted-image-${clock()}${i ? `-${i + 1}` : ''}.${(f.type.split('/')[1] || 'png').replace(/\W.*/, '')}`, { type: f.type }) : f)), folders)
      return
    }
    if (!text) return
    const draft = t.value.slice(0, t.selectionStart) + text + t.value.slice(t.selectionEnd)
    if (draft.length <= LONG_TEXT()) return
    e.preventDefault()
    // A long block is the file and the typed words stay as the message. If it only tips the draft over, the whole draft is the file.
    if (text.length > LONG_TEXT()) attachText(text)
    else if (attachText(draft, t.value)) { t.value = ''; t.dispatchEvent(new Event('input')) }
  }
  for (const zone of [bar, card, fp]) {
    const pill = zone === fp ? fPill : barPill
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files')
    zone.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; pill.classList.add('dropping') })
    zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) pill.classList.remove('dropping') })
    zone.addEventListener('drop', e => {
      pill.classList.remove('dropping')
      if (!hasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      const folders = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry?.()).filter(x => x?.isDirectory).map(x => x.name)
      addFiles([...e.dataTransfer.files].filter(f => !folders.includes(f.name)), folders)
      activeTa().focus({ preventScroll: true })
    })
  }
  function clearFiles() { for (const f of S.files) if (f.url) URL.revokeObjectURL(f.url); S.files = []; renderAtts() }
  pick.addEventListener('change', () => {
    addFiles([...(pick.files || [])])
    activeTa().focus({ preventScroll: true })
  })
  const b64 = file => new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    r.readAsDataURL(file)
  })

  /* ---------- dictation (Web Speech API) ---------- */

  function startDictate() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!window.isSecureContext) {
      flash(`Dictation needs a secure page, and this one is plain http. ${window.HUB_CONF?.url ? `Open the hub at ${window.HUB_CONF.url}, or use` : 'Use'} the mic key on your keyboard.`)
      return
    }
    if (!SR) { flash('This browser has no speech recognition. Use the mic key on your keyboard instead.'); return }
    const ta = activeTa()
    const base = ta.value.replace(/\s+$/, '')
    let rec
    try { rec = new SR() } catch { flash('Dictation could not start in this browser.'); return }
    rec.lang = navigator.language || 'en-US'
    rec.continuous = true
    rec.interimResults = true
    let finalText = ''
    rec.onresult = e => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) finalText += t; else interim += t
      }
      const said = (finalText + interim).trim()
      ta.value = base && said ? `${base} ${said}` : base || said
      grow(ta, ta === fta ? fPill : barPill); syncSend()
    }
    rec.onerror = e => {
      const why = { 'not-allowed': 'The microphone is blocked for this page. Allow it in the browser’s site settings.', 'service-not-allowed': 'The browser refused speech recognition on this page.', 'no-speech': 'No speech heard. Try again.', 'audio-capture': 'No microphone was found.', network: 'Speech recognition needs the internet and could not reach it.' }[e.error]
      if (e.error !== 'aborted') flash(why || `Dictation stopped (${e.error}).`)
    }
    rec.onend = () => { if (S.rec === rec) { S.rec = null; syncRec() } }
    try { rec.start() } catch { flash('Dictation could not start.'); return }
    S.rec = rec
    syncRec()
    ta.focus({ preventScroll: true })
  }
  function stopDictate() {
    const r = S.rec
    S.rec = null
    try { r?.stop() } catch {}
    syncRec()
  }
  function syncRec() {
    for (const [b, t, ph] of [[bPlus, bta, 'Ask anything'], [fPlus, fta, 'Ask anything']]) {
      b.classList.toggle('rec', !!S.rec)
      b.innerHTML = S.rec ? IC.mic22 : IC.plus22
      b.setAttribute('aria-label', S.rec ? 'Stop dictation' : 'Attach, model, effort, mode, dictate, full screen')
      b.title = S.rec ? 'Listening… tap to stop' : 'Attach, model, effort, mode, dictate, full screen'
      t.placeholder = S.rec ? 'Listening…' : S.mode === 'plan' ? `${ph} (Plan mode)` : ph
    }
  }

  /* ---------- composers ---------- */

  function grow(t, pill) {
    t.style.height = 'auto'
    t.style.height = `${Math.min(t.scrollHeight, 154)}px`
    pill.classList.toggle('multi', t.scrollHeight > 48)
  }
  function syncSend() {
    for (const [b, t] of [[bsend, bta], [fsend, fta]]) {
      // While a reply runs, an empty composer shows Stop; typed text turns it back into send (queue).
      const halt = S.busy && !t.value.trim() && !S.files.length
      b.classList.toggle('stop', halt)
      b.innerHTML = halt ? IC.stop : IC.up
      b.setAttribute('aria-label', halt ? 'Stop' : S.busy ? 'Queue this message' : 'Send')
      b.title = halt ? 'Stop' : S.busy ? 'Queue: sends when this reply finishes' : ''
      b.disabled = !S.busy && !t.value.trim() && !S.files.length
    }
    syncCard()
  }
  const submit = text => (S.busy ? enqueue(text) : send(text))

  const confirmCards = id => [...flogEl.querySelectorAll('.confirm'), ...clogEl.querySelectorAll('.confirm')].filter(el => el.dataset.confirm === id)
  function settleConfirm(id, note) {
    for (const el of confirmCards(id)) {
      const row = el.querySelector('.confirm-row')
      if (row) { const done = document.createElement('div'); done.className = 'confirm-on'; done.textContent = note; row.replaceWith(done) }
    }
  }
  async function answerConfirm(c, allow) {
    const id = c.id
    for (const el of confirmCards(id)) el.querySelectorAll('button').forEach(b => { b.disabled = true })
    let out = {}
    try {
      const r = await hubFetch(`/api/${['agent', 'connections'].includes(c.via) ? c.via : 'browser'}/confirm/${id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ allow }) })
      if (!r.ok) return settleConfirm(id, 'This ask has run out. Ask again if you still want it.')
      out = await r.json().catch(() => ({}))
    } catch { return settleConfirm(id, 'Couldn’t reach the hub, so nothing happened. Ask again.') }
    if (!allow) { settleConfirm(id, 'Not allowed'); return submit('Not allowed. Don’t do that.') }
    settleConfirm(id, out.message || 'Allowed')
    // The hub already did a file or hub step, so the assistant is told what happened rather than told to go ahead.
    submit(out.ok === false ? `Allowed, but it didn’t work: ${out.message}` : out.message ? `Allowed. ${out.message}` : 'Allowed. Go ahead.')
  }
  for (const [t, pill, b] of [[bta, barPill, bsend], [fta, fPill, fsend]]) {
    t.addEventListener('input', () => { grow(t, pill); syncSend() })
    t.addEventListener('paste', e => onPaste(e, t))
    // A block that arrives without a paste event, such as text dragged in.
    let was = 0
    t.addEventListener('input', () => {
      const grew = t.value.length - was
      was = t.value.length
      if (grew > 1000 && t.value.length > LONG_TEXT() && attachText(t.value)) { t.value = ''; was = 0; t.dispatchEvent(new Event('input')) }
    })
    t.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(t.value) }
    })
    b.addEventListener('click', () => { if (S.busy && !t.value.trim() && !S.files.length) stop(); else submit(t.value) })
  }

  /* ---------- sending and the NDJSON stream ---------- */

  const eachView = fn => { for (const v of views) fn(v) }

  // q: a queued item, which brings its own files and reply quote and leaves the composer alone.
  async function send(text, q) {
    text = String(text || '').trim()
    let attached = q ? q.files : S.files
    if ((!text && !attached.length) || S.busy) return
    // Typed up to here without a paste: it still goes in full.
    if (text.length > LONG_TEXT()) {
      if (attached.length >= MAX_FILES()) return flash(`That message is too long to send, and only ${MAX_FILES()} files fit in one message.`)
      attached = [...attached, textFile(text)]
      text = ''
    }
    if (S.rec) stopDictate()
    closeMenu()
    if (S.hist) toggleHist(false)
    clearInterval(S.poll)
    S.busy = true
    S.stopped = false
    const gen = ++S.gen
    let reply = q ? q.reply || '' : S.reply
    if (!q) {
      S.files = []
      renderAtts()
      for (const [t, p] of [[bta, barPill], [fta, fPill]]) { t.value = ''; grow(t, p) }
      S.reply = ''
      renderReply()
    }
    renderQueue()
    const names = attached.map(f => f.name)
    S.sending = attached
    const shown = reply.length > 300 ? reply.slice(0, 299) + '…' : reply
    S.cardOn = true
    cardView.clear()
    cardView.addUser(text || (names.length === 1 ? 'Have a look at the attached file.' : 'Have a look at the attached files.'), attached, shown)
    fullView.addUser(text || (names.length === 1 ? 'Have a look at the attached file.' : 'Have a look at the attached files.'), attached, shown)
    eachView(v => v.showPending())
    syncSend()
    const ctrl = (S.ctrl = new AbortController())
    let finished = false
    try {
      const files = await Promise.all(attached.map(async f => ({ name: f.name, data: await b64(f.file) })))
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub': '1' },
        body: JSON.stringify({ text, test: isTest() || undefined, files: files.length ? files : undefined, sessionId: S.conv || undefined, tab: curEnv(), tabTitle: curTitle(), narrow: PHONE.matches, model: S.model || undefined, effort: S.effort || undefined, mode: S.mode === 'auto' ? undefined : S.mode, reply: reply || undefined }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `The hub answered ${res.status}`)
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          let ev
          try { ev = JSON.parse(line) } catch { continue }
          if (gen === S.gen && handle(ev)) finished = true
        }
      }
      if (!finished && gen === S.gen) eachView(v => v.addError('The connection closed before the reply finished.'))
    } catch (e) {
      if (e && e.name !== 'AbortError' && gen === S.gen) eachView(v => v.addError(e.message || 'Could not reach the hub.'))
    } finally {
      if (gen === S.gen) {
        eachView(v => { v.hidePending(); v.finishCur(); v.endBrowser() })
        S.busy = false
        S.ctrl = null
        syncSend()
        if (!PHONE.matches) (S.full ? fta : bta).focus({ preventScroll: true })
        // Next in the queue, unless the user pressed Stop (then the queue waits with a send-now button).
        if (S.queue.length && !S.stopped) { const n = S.queue.shift(); setTimeout(() => send(n.text, n), 60) }
        else if (S.queue.length) flash('Queue paused. Tap the arrow on a queued message to send it.')
        renderQueue()
      }
    }
  }

  // Returns true on the final "done" event.
  function handle(ev) {
    switch (ev.type) {
      case 'session':
        S.conv = ev.sessionId || S.conv
        if (ev.atts?.length) {
          eachView(v => v.setFiles(ev.atts))
          for (const f of S.sending || []) if (f.url) URL.revokeObjectURL(f.url)
          S.sending = []
        }
        break
      case 'attachment':
        eachView(v => { v.hidePending(); v.finishCur(); v.addAttachment(ev.file); v.showPending() })
        break
      case 'text_start':
        eachView(v => { v.finishCur(); v.cur = v.addAssistant('', false) })
        break
      case 'delta':
        eachView(v => { if (!v.cur) v.cur = v.addAssistant('', false); v.feed(String(ev.text || '')) })
        break
      case 'text_end':
        eachView(v => { if (!v.cur) { v.hidePending(); v.cur = v.addAssistant('', false) } if (typeof ev.text === 'string') v.setText(ev.text); v.finishCur() })
        break
      case 'tool':
        eachView(v => { v.hidePending(); v.finishCur(); v.addTool(ev); v.showPending() })
        break
      case 'tool_result':
        eachView(v => v.setToolResult(ev.id || '', !!ev.ok, ev.text))
        break
      case 'error':
        eachView(v => { v.hidePending(); v.finishCur(); v.addError(ev.message || 'Something went wrong.') })
        break
      case 'site':
        if (ev.url) {
          eachView(v => { v.hidePending(); v.finishCur(); v.addSite(ev); v.showPending() })
          window.HubBrowser?.open(ev.url, { name: ev.name, icon: ev.icon })
        }
        break
      case 'confirm':
        eachView(v => { v.hidePending(); v.finishCur(); v.addConfirm(ev); v.showPending() })
        break
      case 'connect':
        eachView(v => { v.hidePending(); v.finishCur(); v.addConnect(ev); v.showPending() })
        break
      case 'settings':
        window.HUB?.refresh?.() // show the change now instead of at the next 15 s poll
        break
      case 'browser':
        eachView(v => {
          v.hidePending(); v.finishCur()
          if (v.browser) v.setBrowser(v.browser, ev, true)
          else v.browser = v.addBrowser(ev, true)
          v.showPending()
        })
        break
      case 'done':
        eachView(v => { v.hidePending(); v.finishCur(); v.endBrowser(); v.setMeta(ev.meta) })
        return true
    }
    return false
  }

  async function stop() {
    if (!S.busy) return
    S.stopped = true
    try { await fetch('/api/chat/stop', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ sessionId: S.conv || undefined }) }) } catch {}
    const c = S.ctrl
    setTimeout(() => { if (c && S.ctrl === c) c.abort() }, 1500)
  }

  /* ---------- conversations: new, load, history ---------- */

  function newChat() {
    if (S.busy) {
      S.gen++
      S.ctrl?.abort()
      fetch('/api/chat/stop', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ sessionId: S.conv || undefined }) }).catch(() => {})
      S.busy = false; S.ctrl = null
    }
    clearInterval(S.poll)
    S.conv = ''
    S.cardOn = false
    clearFiles()
    clearQueue()
    S.reply = ''
    renderReply()
    cardView.clear()
    fullView.empty()
    if (S.hist) toggleHist(false)
    syncSend()
    if (S.full) fta.focus({ preventScroll: true })
  }
  fNew.addEventListener('click', newChat)

  async function openConv(id) {
    if (S.busy) { fullView.addError('Stop the current reply first.'); if (S.hist) toggleHist(false); return }
    try {
      const r = await hubFetch(`/api/chat/sessions/${encodeURIComponent(id)}`)
      if (!r.ok) throw new Error('gone')
      const c = await r.json()
      S.conv = c.id
      S.cardOn = false
      cardView.clear()
      fullView.clear()
      for (const [n, it] of (c.items || []).entries()) {
        if (it.kind === 'confirm') fullView.addConfirm(it, c.items.slice(n + 1).some(x => x.kind === 'user'))
        else if (it.kind === 'connect') fullView.addConnect(it)
        else if (it.kind === 'user') fullView.addUser(it.text || '', it.atts || it.files, it.reply)
        else if (it.kind === 'attachment') fullView.addAttachment(it)
        else if (it.kind === 'assistant') fullView.addAssistant(it.text || '', true, it.meta || (it.at ? { at: it.at } : null))
        else if (it.kind === 'tool') fullView.addTool(it)
        else if (it.kind === 'site') fullView.addSite(it)
        else if (it.kind === 'browser') fullView.addBrowser(it, false)
        else if (it.kind === 'error') fullView.addError(it.text || '')
      }
      if (!flogEl.children.length) fullView.empty()
      if (c.running) {
        fullView.showPending()
        clearInterval(S.poll)
        S.poll = setInterval(async () => {
          if (S.busy || S.conv !== c.id) return clearInterval(S.poll)
          try { const rr = await (await hubFetch(`/api/chat/sessions/${encodeURIComponent(id)}`)).json(); if (!rr.running) { clearInterval(S.poll); openConv(id) } } catch {}
        }, 2000)
      }
      if (S.hist) toggleHist(false)
      fullView.scrollEnd(true)
      syncSend()
    } catch {
      fullView.addError('That chat could not be opened.')
    }
  }

  function toggleHist(on) {
    S.hist = on == null ? !S.hist : on
    hist.classList.toggle('on', S.hist)
    fHist.setAttribute('aria-pressed', String(S.hist))
    if (S.hist) loadHist()
  }
  fHist.addEventListener('click', () => toggleHist())

  async function loadHist() {
    hist.innerHTML = '<div class="none">Loading…</div>'
    let list = []
    try { list = (await (await hubFetch(`/api/chat/sessions${isTest() ? '?test=1' : ''}`)).json()).sessions || [] } catch { hist.innerHTML = '<div class="none">Could not load your chats.</div>'; return }
    if (!S.hist) return
    if (!list.length) { hist.innerHTML = '<div class="none">No chats yet. Ask something and it will show up here.</div>'; return }
    list.sort((a, b) => (b.updated || 0) - (a.updated || 0))
    hist.replaceChildren()
    const h = document.createElement('h4'); h.textContent = 'Recent chats'
    const box = document.createElement('div'); box.className = 'list'
    for (const s of list) box.append(histRow(s, box))
    hist.append(h, box)
  }
  function histRow(s, box) {
    const row = document.createElement('div')
    row.className = `row${s.id === S.conv ? ' cur' : ''}`
    row.tabIndex = 0
    row.setAttribute('role', 'button')
    const t = document.createElement('div'); t.className = 't'
    const b = document.createElement('b'); b.textContent = s.title || 'New chat'
    const sub = document.createElement('span')
    sub.textContent = `${s.updated ? ago(s.updated) : ''}${s.count ? ` · ${s.count} message${s.count === 1 ? '' : 's'}` : ''}${s.running ? ' · working' : ''}`
    t.append(b, sub)
    const ren = document.createElement('button'); ren.type = 'button'; ren.className = 'rb'; ren.setAttribute('aria-label', 'Rename chat'); ren.innerHTML = IC.pencil
    const del = document.createElement('button'); del.type = 'button'; del.className = 'rb'; del.setAttribute('aria-label', 'Delete chat'); del.innerHTML = IC.trash
    row.append(t, ren, del)
    row.addEventListener('click', e => { if (!e.target.closest('.rb') && !e.target.closest('input')) openConv(s.id) })
    row.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); openConv(s.id) } })
    ren.addEventListener('click', e => {
      e.stopPropagation()
      const inp = document.createElement('input')
      inp.value = s.title || ''; inp.maxLength = 80; inp.setAttribute('aria-label', 'Chat name')
      row.replaceChild(inp, t)
      ren.hidden = del.hidden = true
      inp.focus(); inp.select()
      let done = false
      const finish = async save => {
        if (done) return
        done = true
        const v = inp.value.trim()
        if (save && v && v !== s.title) {
          try { await fetch(`/api/chat/sessions/${encodeURIComponent(s.id)}/rename`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: JSON.stringify({ title: v }) }); s.title = v } catch {}
        }
        b.textContent = s.title || 'New chat'
        row.replaceChild(t, inp)
        ren.hidden = del.hidden = false
      }
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); finish(true) } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false) } })
      inp.addEventListener('blur', () => finish(true))
    })
    let armed = 0
    del.addEventListener('click', async e => {
      e.stopPropagation()
      if (!armed) {
        armed = setTimeout(() => { armed = 0; del.className = 'rb'; del.innerHTML = IC.trash }, 3000)
        del.className = 'rb del'; del.textContent = 'Delete'
        return
      }
      clearTimeout(armed)
      try { await fetch(`/api/chat/sessions/${encodeURIComponent(s.id)}/delete`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub': '1' }, body: '{}' }) } catch {}
      const wasCurrent = s.id === S.conv
      row.remove()
      if (wasCurrent) { const keep = S.hist; newChat(); if (keep) toggleHist(true) }
      else if (!box.children.length) loadHist()
    })
    return row
  }

  /* ---------- mount ---------- */

  // Keep the page and the hub's toast clear of the bar.
  const page = document.createElement('style')
  page.id = 'hub-chat-page'
  page.textContent = '.page { padding-bottom: calc(140px + env(safe-area-inset-bottom)) !important; } .hud { bottom: calc(96px + env(safe-area-inset-bottom)) !important; }'
  document.head.append(page)
  document.body.append(host)
  fullView.empty()
  syncSend()
  measureBar()
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadInfo, { once: true }); else loadInfo()

  // A tiny handle for other tabs or tests: HubChat.open(), HubChat.ask('...').
  window.HubChat = { open: () => setFull(true), close: () => setFull(false), toggle: () => setFull(!S.full), ask: t => submit(t) }
})()
