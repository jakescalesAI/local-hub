// The Layout panel's pieces, as HTML: the TV (app.js) and the hub page on a computer (tabs/tvlook.js) build theirs from
// these, so they look the same. Styles in panel.css. Each thing you can press has data-w="<id>".
const sym = (d, w = 2) => `<svg class="sym" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const IC = {
  vol: sym('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>', 2),
  sun: sym('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3 7 7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/>', 2),
  pic: sym('<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8 20h8M12 16.5V20"/>', 2),
  note: sym('<path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>', 2),
  prev: sym('<path fill="currentColor" d="M20 6v12l-8-6zM11 6v12l-8-6z"/>', 1.5),
  next: sym('<path fill="currentColor" d="M4 6v12l8-6zM13 6v12l8-6z"/>', 1.5),
  play: sym('<path fill="currentColor" d="M7 4.5v15l13-7.5z"/>', 1.5),
  pause: sym('<path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>', 1.5),
  clock: sym('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 2),
  cloud: sym('<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 11.6 3.5 3.5 0 0 0 7 18.5z"/>', 2),
  timer: sym('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9.5 2.5h5"/>'),
  moon: sym('<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>'),
  gear: sym('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  power: sym('<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>'),
  widgets: sym('<rect x="3.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2.2"/>', 2),
  home: sym('<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h4.5v-5.5h4V20h4.5V9.5"/>'),
};
export function player(m = {}) {
  const t = m.title || (m.playing ? "Playing" : "Not playing");
  const sub = m.title ? m.artist || m.app || "" : "";
  const art = m.art ? `<img src="${esc(m.art)}" alt="">` : IC.note;
  const b = (id, ic, label) => `<button class="mp-b" data-w="${id}" aria-label="${label}" tabindex="-1">${ic}</button>`;
  return `<div class="mp"><div class="mp-art">${art}</div><div class="mp-t">${esc(t)}</div><div class="mp-s">${esc(sub)}</div><div class="mp-row">${b("prev", IC.prev, "Previous")}${b("play", m.playing ? IC.pause : IC.play, m.playing ? "Pause" : "Play")}${b("next", IC.next, "Next")}</div></div>`;
}
export const slider = (id, val, ic, label, off) => `<div class="wps${off ? " off" : ""}" data-w="${id}" aria-label="${label}"><i style="height:${off ? 0 : val}%"></i><span>${ic}</span></div>`;
export const round = (id, ic, label, on) => `<div class="wpr${on ? " on" : ""}" data-w="${id}"><b>${ic}</b><em>${esc(label)}</em></div>`;
export const pill = (id, ic, t1, t2, on) => `<div class="wpp${on ? " on" : ""}" data-w="${id}"><b>${ic}</b><div class="grow"><div class="t1">${esc(t1)}</div><div class="t2">${esc(t2)}</div></div></div>`;
