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
  words: sym('<path d="M6 4h12a3.5 3.5 0 0 1 3.5 3.5v6A3.5 3.5 0 0 1 18 17h-6.2L8 20.6V17H6a3.5 3.5 0 0 1-3.5-3.5v-6A3.5 3.5 0 0 1 6 4z"/><path fill="currentColor" stroke="none" d="M7.2 9.2a1.85 1.85 0 1 1 3.7.1c0 2.3-1 3.8-2.8 4.5l-.5-1.1c.9-.5 1.4-1 1.6-1.7a1.85 1.85 0 0 1-2-1.8zM13.1 9.2a1.85 1.85 0 1 1 3.7.1c0 2.3-1 3.8-2.8 4.5l-.5-1.1c.9-.5 1.4-1 1.6-1.7a1.85 1.85 0 0 1-2-1.8z"/>', 2.1),
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
// The song, full screen: its cover and buttons in the middle, or beside its words. Drawn once, then changed in place, so nothing
// blinks and moving between the two is a slide. opts: { show: words wanted, ask: whether to ask to turn them on, on: turned on }
export function wordsMode(m, words, o = {}) {
  if (!m?.title || !o.show) return "none";
  if (words?.off || o.on === false) return o.ask ? "off" : "none";
  return !words ? "load" : words.lines?.length ? "lines" : words.plain?.length ? "plain" : "none";
}
export function paintFull(box, m = {}, words, o = {}) {
  let p = box.querySelector(":scope > .mpf");
  const b = (id, ic, label) => `<button class="mp-b" data-w="${id}" aria-label="${label}" tabindex="-1">${ic}</button>`, set = (n, k, v) => { if (n["_" + k] !== v) { n["_" + k] = v; n.innerHTML = v; } };
  const first = !p;
  if (first) {
    box.innerHTML = `<div class="mp mpf still"><div class="mpf-l"><div class="mpf-art"></div><div class="mp-t"><span></span></div><div class="mp-s"><span></span></div><div class="mp-bar" hidden><em class="mp-at">0:00</em><div class="mp-line"><i></i></div><em class="mp-end">0:00</em></div><div class="mp-row"><button class="mp-b mpf-app" data-w="open" tabindex="-1" hidden></button>${b("prev", IC.prev, "Previous")}<button class="mp-b" data-w="play" tabindex="-1"></button>${b("next", IC.next, "Next")}<button class="mp-b mpf-w" data-w="words" tabindex="-1">${IC.words}</button></div></div><div class="mpf-r"></div>${o.nudge ? '<div class="mpf-n"><button type="button" data-w="later" aria-label="Lyrics later">Later</button><em></em><button type="button" data-w="earlier" aria-label="Lyrics earlier">Earlier</button></div>' : ""}</div>`;
    p = box.firstElementChild;
  }
  const q = (s) => p.querySelector(s), mode = wordsMode(m, words, o);
  p.classList.toggle("on", !!m.playing);
  set(q(".mpf-art"), "h", m.art ? `<img src="${esc(m.art)}" alt="">` : IC.note);
  set(q(".mp-t span"), "h", esc(m.title || "Not playing"));
  set(q(".mp-s span"), "h", esc(m.artist || m.app || ""));
  q(".mp-bar").classList.toggle("seek", !!m.seek);
  set(q('[data-w="play"]'), "h", m.playing ? IC.pause : IC.play);
  q('[data-w="play"]').setAttribute("aria-label", m.playing ? "Pause" : "Play");
  const app = q(".mpf-app");
  app.hidden = !m.icon || !m.title;
  if (m.icon) { set(app, "h", `<img src="${esc(m.icon)}" alt="" onerror="this.parentNode.hidden=true">`); app.title = `Open ${m.app || "the player"}`; app.setAttribute("aria-label", app.title); }
  const w = q(".mpf-w"), none = !!words && !words.off && mode === "none" && !!o.show;
  w.classList.toggle("lit", mode !== "none");
  w.classList.toggle("dim", none);
  w.title = none ? "No lyrics for this song" : mode === "none" ? "Lyrics" : "Hide lyrics";
  w.setAttribute("aria-label", w.title);
  // What is on its way out stays drawn while it fades.
  const r = q(".mpf-r");
  if (mode !== "none") set(r, "h", mode === "load" ? '<div class="mpf-ly wait"><p>Loading lyrics…</p></div>' : mode === "off" ? '<div class="mpf-ly off"><p>Lyrics come from lrclib.net, which is sent the song’s name, artist, album and length.</p><button type="button" class="mpf-on" data-w="lyrics">Show lyrics</button></div>' : `<div class="mpf-ly${mode === "plain" ? " plain" : ""}">${(mode === "plain" ? words.plain : words.lines.map((l) => l.x)).map((x, i) => `<p data-l="${i}">${esc(x) || "♪"}</p>`).join("")}</div>`);
  p.classList.toggle("words", mode !== "none");
  p.classList.toggle("synced", mode === "lines");
  const nm = q(".mpf-n em"), sh = Number(o.shift) || 0;
  if (nm) set(nm, "h", sh ? `${Math.abs(sh).toFixed(2).replace(/0$/, "")} s ${sh > 0 ? "earlier" : "later"}` : "Timing");
  if (first) requestAnimationFrame(() => requestAnimationFrame(() => p.classList.remove("still")));
  return mode;
}
// The line being sung, kept in the middle.
export function syncWords(root, m, words, shift = 0) {
  const box = root?.querySelector?.(".mpf-ly");
  if (!box || !words?.lines?.length || !Number.isFinite(m?.pos)) return;
  const at = m.pos + (m.playing ? (performance.now() - (m.got || performance.now())) / 1000 : 0) + 0.18 + (Number(shift) || 0);
  let i = -1;
  while (i + 1 < words.lines.length && words.lines[i + 1].t <= at) i++;
  if (box._i === i) return;
  const was = box._i;
  box._i = i;
  box.querySelectorAll("p").forEach((p, k) => { p.classList.toggle("now", k === i); p.classList.toggle("past", k < i); });
  const p = box.querySelector(`p[data-l="${Math.max(0, i)}"]`);
  if (p) box.scrollTo({ top: p.offsetTop - box.clientHeight / 2 + p.clientHeight / 2, behavior: was === undefined || Math.abs(was - i) > 6 ? "auto" : "smooth" });
}
// A card grows out of where it was, to the middle, and goes back to it.
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export function grow(box, from, back) {
  const a = from?.getBoundingClientRect?.(), z = box.getBoundingClientRect(), k = box.offsetWidth ? z.width / box.offsetWidth : 1;
  if (!a?.width || !z.width || !box.animate || still()) return Promise.resolve();
  const s = Math.max(0.12, Math.min(a.width / z.width, 1)), small = { transform: `translate(${(a.left + a.width / 2 - z.left - z.width / 2) / k}px, ${(a.top + a.height / 2 - z.top - z.height / 2) / k}px) scale(${s})`, opacity: 0 }, full = { transform: "none", opacity: 1 };
  const mid = { opacity: 1, offset: back ? 0.6 : 0.3 };
  box.style.willChange = "transform, opacity";
  if (!back) from.style.visibility = "hidden"; // it is the card that grows
  return box.animate(back ? [full, mid, small] : [small, mid, full], { duration: back ? 340 : 460, easing: "cubic-bezier(.32, .72, 0, 1)", fill: back ? "forwards" : "none" }).finished.catch(() => {}).then(() => { box.style.willChange = ""; if (back) from.style.visibility = ""; });
}
// The song opens: its cover flies from where it was to where it goes, and the rest comes up around it. And back.
export function growSong(box, from, back) {
  const art = box.querySelector(".mpf-art"), img = art?.querySelector("img"), a = from?.getBoundingClientRect?.(), z = art?.getBoundingClientRect();
  if (!box.animate || still() || !z?.width) return Promise.resolve();
  const ease = "cubic-bezier(.32, .72, 0, 1)", dur = back ? 380 : 520;
  const card = box.animate(back ? [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.97)" }] : [{ opacity: 0, transform: "scale(.97)" }, { opacity: 1, transform: "none" }], { duration: back ? 260 : 380, easing: back ? "ease-in" : "ease-out", fill: back ? "forwards" : "none" }).finished.catch(() => {});
  if (!img || !a?.width) return card;
  const fly = document.createElement("div"), s = a.width / z.width, r0 = parseFloat(getComputedStyle(from).borderTopLeftRadius) || 12, r1 = (parseFloat(getComputedStyle(art).borderTopLeftRadius) || 30) * (z.width / (art.offsetWidth || z.width));
  fly.className = "mpf-fly";
  fly.style.cssText = `position:fixed;z-index:2147483646;left:${z.left}px;top:${z.top}px;width:${z.width}px;height:${z.height}px;border-radius:${r1}px;overflow:hidden;pointer-events:none;transform-origin:0 0;will-change:transform`;
  fly.append(Object.assign(new Image(), { src: img.src, style: "width:100%;height:100%;object-fit:cover;display:block" }));
  document.body.append(fly);
  art.style.visibility = from.style.visibility = "hidden";
  const small = { transform: `translate(${a.left - z.left}px, ${a.top - z.top}px) scale(${s}, ${a.height / z.height})`, borderRadius: `${r0 / s}px` }, full = { transform: "none", borderRadius: `${r1}px` };
  return Promise.all([card, fly.animate(back ? [full, small] : [small, full], { duration: dur, easing: ease, fill: "both" }).finished.catch(() => {})]).then(() => { art.style.visibility = from.style.visibility = ""; fly.remove(); });
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
export const noted = (m, got = performance.now()) => (m && Number.isFinite(m.pos) ? Object.assign(m, { got }) : m);
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
