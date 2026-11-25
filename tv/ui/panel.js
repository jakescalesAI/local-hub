// The Controls panel's pieces, as HTML: the TV (app.js) and the hub page on a computer (tabs/tvlook.js) build theirs from
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
  plus: sym('<path d="M12 5v14M5 12h14"/>'),
  mic: sym('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  gauge: sym('<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/>'),
  side: sym('<rect x="3" y="4" width="18" height="16" rx="4"/><path d="M15 4v16"/><path d="m10.5 9-3 3 3 3"/>'),
  widgets: sym('<rect x="3.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2.2"/>', 2),
  sliders: sym('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  input: sym('<rect x="3" y="5" width="18" height="11" rx="2"/><path d="M8 20h8M12 16v4M10 8.5l3.5 2-3.5 2z"/>', 2),
  home: sym('<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h4.5v-5.5h4V20h4.5V9.5"/>'),
};
const clockOf = (n) => { n = Math.max(0, Math.floor(n)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`; };
// The song, full screen: its cover and buttons, and its words beside them when there are some.
export function fullPlayer(m = {}, words) {
  const b = (id, ic, label) => `<button class="mp-b" data-w="${id}" aria-label="${label}" tabindex="-1">${ic}</button>`;
  const has = words?.lines?.length || words?.plain?.length;
  const ly = words?.off ? '<div class="mpf-ly off"><p>Lyrics come from lrclib.net, which is sent the song’s name, artist and length.</p><button type="button" class="mpf-on" data-w="lyrics">Show lyrics</button></div>'
    : has ? `<div class="mpf-ly${words.lines?.length ? "" : " plain"}">${(words.lines?.length ? words.lines.map((l) => l.x) : words.plain).map((x, i) => `<p data-l="${i}">${esc(x) || "♪"}</p>`).join("")}</div>` : "";
  return `<div class="mp mpf${m.playing ? " on" : ""}${ly ? " words" : ""}"><div class="mpf-l"><div class="mpf-art">${m.art ? `<img src="${esc(m.art)}" alt="">` : IC.note}</div><div class="mp-t"><span>${esc(m.title || "Not playing")}</span></div><div class="mp-s"><span>${esc(m.artist || m.app || "")}</span></div><div class="mp-bar${m.seek ? " seek" : ""}" hidden><em class="mp-at">0:00</em><div class="mp-line"><i></i></div><em class="mp-end">0:00</em></div><div class="mp-row">${b("prev", IC.prev, "Previous")}${b("play", m.playing ? IC.pause : IC.play, m.playing ? "Pause" : "Play")}${b("next", IC.next, "Next")}</div></div>${ly}</div>`;
}
// The line being sung, kept in the middle.
export function syncWords(root, m, words) {
  const box = root?.querySelector?.(".mpf-ly");
  if (!box || !words?.lines?.length || !Number.isFinite(m?.pos)) return;
  const at = m.pos + (m.playing ? (performance.now() - (m.got || performance.now())) / 1000 : 0) + 0.25;
  let i = -1;
  while (i + 1 < words.lines.length && words.lines[i + 1].t <= at) i++;
  if (box._i === i) return;
  box._i = i;
  box.querySelectorAll("p").forEach((p, k) => { p.classList.toggle("now", k === i); p.classList.toggle("past", k < i); });
  const p = box.querySelector(`p[data-l="${Math.max(0, i)}"]`);
  if (p) box.scrollTo({ top: p.offsetTop - box.clientHeight / 2 + p.clientHeight / 2, behavior: "smooth" });
}
// A card grows out of where it was, to the middle, and goes back to it.
export function grow(box, from, back) {
  const a = from?.getBoundingClientRect?.(), z = box.getBoundingClientRect(), k = box.offsetWidth ? z.width / box.offsetWidth : 1;
  if (!a?.width || !z.width || !box.animate || matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  const small = { transform: `translate(${(a.left + a.width / 2 - z.left - z.width / 2) / k}px, ${(a.top + a.height / 2 - z.top - z.height / 2) / k}px) scale(${Math.max(0.1, a.width / z.width)})`, opacity: back ? 0 : 0.2 }, full = { transform: "none", opacity: 1 };
  return box.animate(back ? [full, small] : [small, full], { duration: back ? 260 : 420, easing: "cubic-bezier(.2, .85, .25, 1)", fill: back ? "forwards" : "none" }).finished.catch(() => {});
}
// Where it is in the song isn't in here: that changes every second, and syncPlayer() moves it without drawing this again.
export function player(m = {}, wide = false) {
  const t = m.title || (m.playing ? "Playing" : "Not playing");
  const sub = m.title ? m.artist || m.app || "" : "";
  const art = m.art ? `<img src="${esc(m.art)}" alt="" draggable="false">` : IC.note;
  const b = (id, ic, label) => `<button class="mp-b" data-w="${id}" aria-label="${label}" tabindex="-1">${ic}</button>`;
  const bar = `<div class="mp-bar${m.seek ? " seek" : ""}" hidden><em class="mp-at">0:00</em><div class="mp-line"><i></i></div><em class="mp-end">0:00</em></div>`;
  return `<div class="mp${wide ? " wide" : ""}${m.art ? " art" : ""}${m.playing ? " on" : ""}${m.title ? " has" : ""}"${m.art ? ` style="--art:url(&quot;${esc(m.art)}&quot;)"` : ""}><div class="mp-art"${m.from === "pc" && m.title ? ` data-open="1" title="Open ${esc(m.app || "the player")}"` : ""}>${art}</div><div class="mp-t"><span>${esc(t)}</span></div><div class="mp-s"><span>${esc(sub)}</span></div>${bar}<div class="mp-row">${b("prev", IC.prev, "Previous")}${b("play", m.playing ? IC.pause : IC.play, m.playing ? "Pause" : "Play")}${b("next", IC.next, "Next")}</div></div>`;
}
// How far into the song every player on the page is. m.pos is where it was when m.got (this page's clock) was noted.
export const noted = (m) => (m && Number.isFinite(m.pos) ? Object.assign(m, { got: performance.now() }) : m);
export function syncPlayer(root, m) {
  for (const p of root?.querySelectorAll?.(".mp") || []) {
    const bar = p.querySelector(".mp-bar");
    if (!bar) continue;
    const ok = !!(m && m.dur > 0 && Number.isFinite(m.pos));
    if (bar.hidden === ok) bar.hidden = !ok;
    p.classList.toggle("timed", ok);
    if (!ok || bar._drag) continue;
    const at = Math.min(m.dur, m.pos + (m.playing ? (performance.now() - (m.got || performance.now())) / 1000 : 0));
    bar._dur = m.dur;
    bar.querySelector("i").style.transform = `scaleX(${(at / m.dur).toFixed(4)})`;
    bar.style.setProperty("--at", `${((at / m.dur) * 100).toFixed(2)}%`);
    const a = clockOf(at), z = `-${clockOf(m.dur - at)}`, ea = bar.querySelector(".mp-at"), ez = bar.querySelector(".mp-end");
    if (ea.textContent !== a) ea.textContent = a;
    if (ez.textContent !== z) ez.textContent = z;
  }
  // A name too long for its space slides along under the pointer.
  for (const n of root?.querySelectorAll?.(".mp-t, .mp-s") || []) {
    const over = n.firstElementChild ? n.firstElementChild.scrollWidth - n.clientWidth : 0;
    n.classList.toggle("long", over > 4);
    if (over > 4) n.style.setProperty("--over", `-${over + 8}px`);
  }
}
export const slider = (id, val, ic, label, off) => `<div class="wps${off ? " off" : ""}" data-w="${id}" aria-label="${label}"><i style="height:${off ? 0 : val}%"></i><span>${ic}</span></div>`;
export const round = (id, ic, label, on) => `<div class="wpr${on ? " on" : ""}" data-w="${id}"><b>${ic}</b><em>${esc(label)}</em></div>`;
export const pill = (id, ic, t1, t2, on) => `<div class="wpp${on ? " on" : ""}" data-w="${id}"><b>${ic}</b><div class="grow"><div class="t1">${esc(t1)}</div><div class="t2">${esc(t2)}</div></div></div>`;
// This PC, opened: its rings, how long it has been on, and what is using the memory (programs of one name together).
export function pcDetail(y, info) {
  const by = new Map();
  for (const p of info?.topByMemory || []) by.set(p.name, (by.get(p.name) || 0) + (Number(p.mb) || 0));
  const top = [...by].sort((a, b) => b[1] - a[1]).slice(0, 6), most = top[0]?.[1] || 1, gb = (mb) => (mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
  const up = Number(info?.uptimeSeconds) || 0, on = up >= 172800 ? `${Math.floor(up / 86400)} days` : up >= 3600 ? `${Math.floor(up / 3600)} h ${Math.floor((up % 3600) / 60)} min` : `${Math.floor(up / 60)} min`;
  return gauges(y) + (info ? `<div class="pcd"><div class="pcd-h">Using the most memory</div>${top.map(([n, mb]) => `<div class="pcd-r"><span>${esc(n)}</span><i><b style="width:${Math.round((mb / most) * 100)}%"></b></i><em>${gb(mb)}</em></div>`).join("")}<div class="pcd-f">On for ${on} · ${gb((info.memTotalMb || 0) - (info.memFreeMb || 0))} of ${gb(info.memTotalMb || 0)} in use · ${Number(info.processCount) || 0} processes</div></div>` : '<div class="pcd"><div class="pcd-h">Looking…</div></div>');
}
// This PC: how busy, how full.
export function gauges(y) {
  const g = (label, v, sub = "") => {
    const p = Math.max(0, Math.min(100, Number(v) || 0)), c = p > 90 ? "#ff453a" : p > 75 ? "#ff9f0a" : "#30d158";
    return `<div><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="7"/><circle cx="32" cy="32" r="26" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(p * 1.634).toFixed(1)} 164" transform="rotate(-90 32 32)"/></svg><b>${Math.round(p)}<i>%</i></b><span>${label}</span><em>${esc(sub)}</em></div>`;
  };
  return `<div class="gz"><div class="gz-h">This PC</div><div class="gz-g">${g("CPU", y.cpu)}${g("Memory", y.mem)}${g("Disk", y.disk, y.diskFree ? `${Math.round(y.diskFree / 2 ** 30)} GB free` : "")}</div></div>`;
}
