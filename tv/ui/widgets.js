// Home's widgets, drawn the same on a computer, on the web (a phone or iPad) and on the TV: tabs/tvlook.js and app.js both use
// these. board.mjs keeps which ones, their sizes and what's in them. A widget is HTML from data; every length in widgets.css is in
// em, so one drawing fits every screen. Sizes, on a grid four across (two on a phone): SPAN. What doesn’t fit the room a screen has
// (ROOM) isn’t drawn there, and can’t be added to it.
import { IC, player } from "./panel.js?v=16";
import * as Clock from "./clock.js?v=2";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sym = (d, w = 1.9) => `<svg class="sym" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const G = {
  sun: sym('<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3 7 7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7"/>'),
  moon: sym('<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>'),
  part: sym('<path d="M8 8.5a4 4 0 0 1 7.6-1.4M5 5.2 6.2 6.4M11 2.5V4M17 5.2l-1.2 1.2"/><path d="M8 19.5h9a3.6 3.6 0 0 0 .5-7.2A5.5 5.5 0 0 0 7 13.4 3.1 3.1 0 0 0 8 19.5z"/>'),
  cloud: sym('<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 11.6 3.5 3.5 0 0 0 7 18.5z"/>'),
  rain: sym('<path d="M7 15h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 8.1 3.5 3.5 0 0 0 7 15zM8.5 18l-.8 2.5M12.5 18l-.8 2.5M16.5 18l-.8 2.5"/>'),
  snow: sym('<path d="M7 15h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 8.1 3.5 3.5 0 0 0 7 15zM8 18.5h.01M12 20.5h.01M16 18.5h.01"/>', 2.2),
  storm: sym('<path d="M7 14h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 7.1 3.5 3.5 0 0 0 7 14zM12.5 15.5 10 19h3.5L11 22"/>'),
  fog: sym('<path d="M4 9h13M7 13h13M4 17h11"/>'),
  play: sym('<path fill="currentColor" d="M7 4.5v15l13-7.5z"/>'), pause: sym('<path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>'), reset: sym('<path d="M4 4v6h6"/><path d="M4.5 10A8 8 0 1 1 4 14"/>'),
  minus: sym('<path d="M6 12h12"/>'), plus: sym('<path d="M12 6v12M6 12h12"/>'), check: sym('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 2.4),
  dots: sym('<path d="M6 12h.01M12 12h.01M18 12h.01"/>', 3), up: sym('<path d="m6 15 6-6 6 6"/>'), down: sym('<path d="m6 9 6 6 6-6"/>'), left: sym('<path d="m15 6-6 6 6 6"/>'), right: sym('<path d="m9 6 6 6-6 6"/>'), back: sym('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  dir: sym('<path d="M4 7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>'), file: sym('<path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M14 3.5V8h4"/>'), disk: sym('<path d="M4 13l3-8h10l3 8v5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><path d="M4 13h16M8 16.5h.01"/>'),
  cal: sym('<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>'), note: sym('<path d="M12.5 4H7.2A3.2 3.2 0 0 0 4 7.2v9.6A3.2 3.2 0 0 0 7.2 20h9.6a3.2 3.2 0 0 0 3.2-3.2v-5.3"/><path d="M18.3 3.7a1.9 1.9 0 0 1 2.7 2.7l-8.3 8.3-3.5.8.8-3.5z"/>'), todo: sym('<path d="m4 6.5 1.5 1.5L8.5 5M4 13.5 5.5 15l3-3M12 7h8M12 14h8M4 20h16"/>'), globe: sym('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'), img: sym('<rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M4 16l4.5-4.5 4 4 2.5-2.5 5 5"/>'), flag: sym('<path d="M6 21V4M6 5h11l-2.5 4L17 13H6"/>'), grid: sym('<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>'),
};
const wxIcon = (code, day = true) => (code <= 1 ? (day ? G.sun : G.moon) : code === 2 ? (day ? G.part : G.cloud) : code === 3 ? G.cloud : code === 45 || code === 48 ? G.fog : (code >= 71 && code <= 77) || code === 85 || code === 86 ? G.snow : code >= 95 ? G.storm : G.rain);
const ring = (label, v, size = "") => { const p = Math.max(0, Math.min(100, Number(v) || 0)), c = p > 90 ? "#ff453a" : p > 75 ? "#ff9f0a" : "#30d158"; return `<div class="wr ${size}"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="7"/><circle cx="32" cy="32" r="26" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(p * 1.634).toFixed(1)} 164" transform="rotate(-90 32 32)"/></svg><b>${Math.round(p)}<i>%</i></b><span>${label}</span></div>`; };
const bytes = (n) => (n > 1e12 ? `${(n / 2 ** 40).toFixed(1)} TB` : n > 1e9 ? `${Math.round(n / 2 ** 30)} GB` : n > 1e6 ? `${Math.round(n / 2 ** 20)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);
const hour = (iso) => { const h = Number(iso.slice(11, 13)); return `${h % 12 || 12}${h < 12 ? "am" : "pm"}`; };
const dayName = (iso, i) => (i === 0 ? "Today" : new Date(`${iso}T12:00`).toLocaleDateString([], { weekday: "short" }));
const head = (t, ic = "") => `<div class="wh">${ic}<span>${esc(t)}</span></div>`;
const none = (t) => `<div class="wn">${esc(t)}</div>`;
const btn = (act, ic, label, cls = "") => `<button type="button" class="wb ${cls}" data-wa="${act}" aria-label="${label}">${ic}</button>`;
const pad = (n) => String(n).padStart(2, "0");
const clockParts = (d, tz) => { const o = { hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) }; try { return d.toLocaleTimeString([], o); } catch { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } };
export const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600); return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`; };
export const timerLeft = (t, now = Date.now()) => (!t ? 0 : t.end ? Math.max(0, t.end - now) : t.left);
function face(d, cls = "") {
  const a = (v, n) => `transform="rotate(${((v / n) * 360).toFixed(1)} 50 50)"`, m = d.getMinutes() + d.getSeconds() / 60, h = (d.getHours() % 12) + m / 60;
  return `<svg class="wface ${cls}" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48" fill="rgba(255,255,255,.06)"/>${Array.from({ length: 12 }, (_, i) => `<path d="M50 ${i % 3 ? 7 : 6}v${i % 3 ? 4 : 8}" stroke="rgba(255,255,255,${i % 3 ? 0.35 : 0.8})" stroke-width="${i % 3 ? 1.6 : 2.4}" stroke-linecap="round" ${a(i, 12)}/>`).join("")}<path d="M50 54V27" stroke="#fff" stroke-width="4.4" stroke-linecap="round" ${a(h, 12)}/><path d="M50 56V15" stroke="#fff" stroke-width="3" stroke-linecap="round" ${a(m, 60)}/><circle cx="50" cy="50" r="3.4" fill="#ff9f0a"/></svg>`;
}
// The calendar: the month and day being looked at full screen, and what's being typed.
const CAL = { ym: 0, sel: "", del: "", title: "", time: "", err: "" };
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// "2026-11-25" is that day here; new Date() alone would read it as UTC, a day early west of it.
const dayOf = (k) => { const [y, m, d] = String(k).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const calMonth = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth() + CAL.ym, 1); };
const calRange = () => { const n = new Date(), m = calMonth(), from = Math.min(+m, +new Date(n.getFullYear(), n.getMonth(), 1)), to = Math.max(+new Date(m.getFullYear(), m.getMonth() + 1, 1), +n + 45 * 864e5); return `/api/calendar/state?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`; };
export const calText = (k, v) => { CAL[k] = v; };
function month(d, marks = new Set(), pick = "") {
  const first = new Date(d.getFullYear(), d.getMonth(), 1), n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(), today = keyOf(new Date());
  const cells = [...Array(first.getDay()).fill(0), ...Array.from({ length: n }, (_, i) => i + 1)];
  return `<div class="wcal">${["S", "M", "T", "W", "T", "F", "S"].map((x) => `<em>${x}</em>`).join("")}${cells.map((x) => { const k = x ? keyOf(new Date(d.getFullYear(), d.getMonth(), x)) : "", c = `${k && k === today ? "on" : ""}${marks.has(k) ? " ev" : ""}${pick && k === pick ? " pick" : ""}`; return pick && x ? `<button type="button" class="${c}" data-wa="cal:d:${k}" aria-label="${dayOf(k).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}${marks.has(k) ? ", has events" : ""}"${k === pick ? ' aria-pressed="true"' : ""}>${x}</button>` : `<span class="${c}">${x || ""}</span>`; }).join("")}</div>`;
}
export const events = (D) => (Array.isArray(D.cal?.events) ? D.cal.events : []).map((e) => {
  const all = !!e.allDay, at = all ? dayOf(e.start) : new Date(e.start || NaN), end = all ? dayOf(e.end || e.start) : new Date(e.end || e.start || NaN), cal = (D.cal.calendars || []).find((c) => c.id === e.calId);
  return { id: String(e.id || ""), title: String(e.title || ""), at, end: +end > +at ? end : all ? new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1) : at, all, place: String(e.location || ""), color: /^#[0-9a-f]{3,8}$/i.test(cal?.color) ? cal.color : "#0a84ff", mine: e.readonly === false };
}).filter((e) => e.title && !Number.isNaN(+e.at)).sort((a, b) => a.at - b.at || b.all - a.all);
const onDay = (e, k) => { const s = dayOf(k), t = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1); return e.at < t && (e.end > s || +e.at >= +s); };
const marksOf = (ev, d) => { const out = new Set(), n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); for (let i = 1; i <= n; i++) { const k = keyOf(new Date(d.getFullYear(), d.getMonth(), i)); if (ev.some((e) => onDay(e, k))) out.add(k); } return out; };
const coming = (ev) => ev.filter((e) => +e.end > Date.now());
const dayWord = (d) => { const n = new Date(), k = keyOf(d); return k === keyOf(n) ? "Today" : k === keyOf(new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1)) ? "Tomorrow" : d - n < 6 * 864e5 ? d.toLocaleDateString([], { weekday: "long" }) : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }); };
const eventRow = (e) => { const began = +e.at < Date.now() && keyOf(e.at) !== keyOf(new Date()); return `<div class="wev" style="border-color:${e.color}"><b>${esc(e.title)}</b><span>${began ? "Now" : dayWord(e.at)}${e.all ? " · All day" : began ? "" : ` · ${clockParts(e.at)}`}</span></div>`; };
const dayRow = (e, del) => `<div class="wev" style="border-color:${e.color}"><b>${esc(e.title)}</b><span>${e.all ? "All day" : `${clockParts(e.at)}${+e.end > +e.at ? ` – ${clockParts(e.end)}` : ""}`}${e.place ? ` · ${esc(e.place)}` : ""}</span>${del && e.mine ? `<button type="button" class="wcdel${CAL.del === e.id ? " sure" : ""}" data-wa="cal:x:${esc(e.id)}">${CAL.del === e.id ? "Delete it?" : "Delete"}</button>` : ""}</div>`;
function monthBig(d, ev) {
  const first = new Date(d.getFullYear(), d.getMonth(), 1), n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(), today = keyOf(new Date()), lead = first.getDay(), weeks = Math.ceil((lead + n) / 7);
  return `<div class="wcbig" style="grid-template-rows:auto repeat(${weeks}, minmax(0, 1fr))">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => `<em>${x}</em>`).join("")}${Array.from({ length: weeks * 7 }, (_, i) => { const x = i - lead + 1; if (x < 1 || x > n) return "<div></div>"; const k = keyOf(new Date(d.getFullYear(), d.getMonth(), x)), l = ev.filter((e) => onDay(e, k)); return `<div class="${k === today ? "on" : ""}"><b>${x}</b>${l.length ? `<span style="--c:${l[0].color}">${esc(l[0].title)}</span>` : ""}${l.length > 1 ? `<small>+${l.length - 1}</small>` : ""}</div>`; }).join("")}</div>`;
}
const calNone = (D) => `<div class="wev"><span>${D.cal ? "Nothing planned" : D.cal === null ? "The calendar isn’t answering" : "Looking…"}</span></div>`;
function calFull(D, screen) {
  const m = calMonth(), ev = events(D), sel = CAL.sel || keyOf(new Date()), day = ev.filter((e) => onDay(e, sel)), bad = (D.cal?.calendars || []).filter((c) => c.error), others = (D.cal?.calendars || []).some((c) => c.id !== "local");
  return `<div class="wcnav">${head(m.toLocaleDateString([], { month: "long", year: "numeric" }))}${btn("cal:today", "Today", "Today", "txt")}${btn("cal:prev", G.left, "Earlier month")}${btn("cal:next", G.right, "Later month")}</div><div class="wcfull"><div>${month(m, marksOf(ev, m), sel)}</div><div class="wevs">${head(dayOf(sel).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }))}${day.map((e) => dayRow(e, screen !== "tv")).join("") || calNone(D)}${screen === "tv" ? "" : `<form class="wcadd" data-caladd><input class="wadd" name="title" data-cal="title" maxlength="200" autocomplete="off" placeholder="Add to this day" aria-label="What" value="${esc(CAL.title)}"><input class="wadd" name="time" data-cal="time" type="time" aria-label="Time, or leave empty for all day" value="${esc(CAL.time)}"><button type="submit" class="wb"><span>Add</span></button></form><span class="wchint">${esc(CAL.err || "No time means all day")}</span>`}${bad.length ? `<span class="wchint">Couldn’t refresh ${esc(bad.map((c) => c.label).join(", "))}</span>` : ""}${others || screen === "tv" ? "" : '<span class="wchint">To see Google, Outlook or iCloud here, add its calendar link in Settings › Services.</span>'}</div></div>`;
}
const wdays = (w, n) => { const l = (w.days || []).slice(0, n), lo = Math.min(...l.map((x) => x.low)), hi = Math.max(...l.map((x) => x.high)), sp = Math.max(1, hi - lo); return `<div class="wdays">${l.map((x, i) => `<div><span>${dayName(x.date, i)}</span>${wxIcon(x.code)}<em>${x.low}°</em><i><b style="left:${((x.low - lo) / sp) * 100}%;right:${100 - ((x.high - lo) / sp) * 100}%"></b></i><strong>${x.high}°</strong></div>`).join("")}</div>`; };
const whours = (w, n) => `<div class="whours">${(w.hours || []).slice(0, n).map((h, i) => `<div><span>${i ? hour(h.time) : "Now"}</span>${wxIcon(h.code, h.day)}<b>${h.temp}°</b></div>`).join("")}</div>`;
const wnow = (w) => `<div class="wnow">${wxIcon(w.now.code, w.now.day)}<b>${w.now.temp}°</b><div><strong>${esc(w.now.text)}</strong><span>H ${w.high}°  L ${w.low}°</span><span>${esc(w.place)} · Feels ${w.now.feels}°</span></div></div>`;
export const HOURS = { desk: "", phone: "", tv: "" };

// What each one needs: where it comes from and how often it's asked.
export const SOURCES = {
  music: ["/api/music", 4000], wx: ["/api/tv/weather", 900_000], sys: ["/api/desk/system", 8000], info: ["/api/system/info", 30_000], cal: [() => calRange(), 60_000], photos: ["/api/tv/saver", 600_000],
  places: ["/api/files/drives/places", 120_000], drives: ["/api/files/drives?path=", 60_000], status: ["/api/tv/status", 15_000], apps: ["/api/desk", 60_000], board: ["/api/board", 10_000],
};
// id -> { label, what, ic, sizes, def, needs(size), draw(size, D, it), full?(D, it), tick?, only?, form? }
export const W = {
  music: { label: "Music", what: "What’s playing, with its cover and buttons", ic: IC.note, sizes: ["s", "m", "l", "w", "xl"], def: "w", needs: () => [], draw: (z, D) => player(D.music || {}, z === "w" || z === "xl"), bare: true },
  weather: { label: "Weather", what: "Now, the hours ahead and the coming days", ic: G.sun, sizes: ["s", "m", "l", "w", "xl", "xxl"], def: "l", needs: () => ["wx"], draw: (z, D) => { const w = D.wx; if (!w?.now) return none("Finding the weather…"); return z === "s" ? `<div class="wxs"><div>${wxIcon(w.now.code, w.now.day)}<b>${w.now.temp}°</b></div><strong>${esc(w.now.text)}</strong><span>H ${w.high}°  L ${w.low}°</span></div>` : z === "m" ? wnow(w) + whours(w, 6) : z === "l" ? wnow(w) + whours(w, 5) + wdays(w, 4) : z === "w" ? `<div class="wrow">${wnow(w)}${whours(w, 8)}</div>` : z === "xl" ? `<div class="wtwo"><div>${wnow(w)}${whours(w, 6)}<div class="wfoot l">${esc(w.place)} · Feels like ${w.now.feels}°</div></div>${wdays(w, 7)}</div>` : wnow(w) + whours(w, 12) + `<div class="wrule"></div>` + wdays(w, 7); }, full: (D) => (D.wx?.now ? wnow(D.wx) + whours(D.wx, 12) + wdays(D.wx, 7) : none("Finding the weather…")) },
  pc: { label: "This PC", what: "Processor, memory, disk and what’s using them", ic: IC.gauge, sizes: ["s", "m", "l", "w", "xl"], def: "l", needs: (z) => (z === "xl" || z === "l" ? ["sys", "info"] : ["sys"]), draw: (z, D) => { const y = D.sys; if (!y) return none("Looking…"); const three = ring("CPU", y.cpu) + ring("Memory", y.mem) + ring("Disk", y.disk); return z === "s" ? `<div class="wpcs">${[["CPU", y.cpu], ["Memory", y.mem], ["Disk", y.disk]].map(([n, v]) => `<div><span>${n}</span><b>${Math.round(v)}%</b><i class="wbar"><b style="width:${v}%;background:${v > 90 ? "#ff453a" : v > 75 ? "#ff9f0a" : "#30d158"}"></b></i></div>`).join("")}</div>` : z === "m" ? `<div class="wrings">${three}</div>` : z === "l" ? `${head("This PC")}<div class="wrings">${three}</div>${tops(D.info, true)}<div class="wfoot">${y.diskFree ? `${bytes(y.diskFree)} free` : ""}${upText(D.info)}</div>` : z === "w" ? `<div class="wrow">${head("This PC", IC.gauge)}<div class="wrings">${three}</div><div class="wfoot">${y.diskFree ? `${bytes(y.diskFree)} free` : ""}</div></div>` : `<div class="wtwo"><div>${head("This PC")}<div class="wrings">${three}</div></div>${tops(D.info)}</div>`; }, fullNeeds: ["info"], full: (D) => { const y = D.sys || {}, i = D.info, up = Number(i?.uptimeSeconds) || 0; return `${head("This PC")}<div class="wrings">${ring("CPU", y.cpu) + ring("Memory", y.mem) + ring("Disk", y.disk)}</div><div class="wrule"></div>${tops(i)}<div class="wfoot">${y.diskFree ? `${bytes(y.diskFree)} free` : ""}${up ? ` · On for ${up >= 172800 ? `${Math.floor(up / 86400)} days` : `${Math.floor(up / 3600)} h ${Math.floor((up % 3600) / 60)} min`}` : ""}</div>`; } },
  clock: { label: "Clock", what: "Any style, font and color you like", ic: IC.clock, sizes: ["s", "m", "l", "xl", "xxl"], def: "m", needs: () => ["board"], tick: 1, form: "clock", draw: (z, D, it) => { const c = Clock.of({ ...(D.board?.data?.clock || {}), align: "center", ...(it.opts?.clock || {}) }); if (z === "s") c.date = it.opts?.clock?.date && it.opts.clock.date !== "full" ? it.opts.clock.date : c.style === "digital" ? "day" : "off"; const [bw, bh] = BOX[z], [w, h] = Clock.extent(c, Clock.parts(new Date(), c, false)); return `<div class="wclock">${Clock.clockHTML(c, { scale: (Math.min(bw / w, bh / h) * Math.min(1, (it.opts?.clock?.size || 100) / 100)).toFixed(2) })}</div>`; } },
  world: { label: "World clock", what: "The time in other places", ic: G.globe, sizes: ["s", "m", "l", "w"], def: "m", needs: () => [], tick: 1, form: "zones", draw: (z, D, it) => { const d = new Date(), l = (it.opts?.zones?.length ? it.opts.zones : ["America/New_York", "Europe/London", "Asia/Tokyo", "Australia/Sydney", "Europe/Paris", "America/Los_Angeles"]).slice(0, z === "s" ? 1 : z === "m" ? 3 : z === "l" ? 6 : 4); if (z === "s") return `<div class="wc">${G.globe}<b class="mid">${clockParts(d, l[0])}</b><span>${esc(l[0].split("/").pop().replace(/_/g, " "))}</span></div>`; return `${z === "l" ? head("World clock", G.globe) : ""}<div class="wworld ${z}">${l.map((t) => `<div><span>${esc(t.split("/").pop().replace(/_/g, " "))}</span><b>${clockParts(d, t)}</b></div>`).join("")}</div>`; } },
  calendar: { label: "Calendar", what: "Today, the month, and what’s coming up", ic: G.cal, sizes: ["s", "m", "l", "xl", "xxl"], def: "l", needs: () => ["cal"], tick: 60, open: () => { Object.assign(CAL, { ym: 0, sel: "", del: "", err: "" }); }, draw: (z, D) => { const d = new Date(), ev = events(D), next = coming(ev), today = next.filter((e) => onDay(e, keyOf(d))), title = d.toLocaleDateString([], { month: "long", year: "numeric" }), day = (more = "") => `<div class="wday"><em>${d.toLocaleDateString([], { weekday: "long" })}</em><b>${d.getDate()}</b>${more}</div>`, rows = (n) => next.slice(0, n).map(eventRow).join("") || calNone(D); return z === "s" ? `<div class="wc">${day(today.length ? `<span>${esc(today[0].title)}${today.length > 1 ? ` +${today.length - 1}` : ""}</span>` : `<span>${next.length ? esc(dayWord(next[0].at)) : "Nothing today"}</span>`)}</div>` : z === "m" ? `<div class="wrow">${day()}<div class="wevs">${rows(3)}</div></div>` : z === "l" ? head(title) + month(d, marksOf(ev, d)) : z === "xxl" ? head(title) + monthBig(d, ev) : `<div class="wtwo"><div>${head(title)}${month(d, marksOf(ev, d))}</div><div class="wevs">${head("Coming up")}${rows(5)}</div></div>`; }, full: (D, it, screen) => calFull(D, screen) },
  photos: { label: "Photos", what: "Your screensaver’s pictures, changing", ic: G.img, sizes: ["s", "m", "l", "w", "xl", "xxl"], def: "l", needs: () => ["photos"], tick: 1, bare: true, draw: (z, D, it) => { const l = D.photos?.photos || []; if (!l.length) return none("No photos chosen"); const n = Math.floor(Date.now() / 20_000) + [...it.k].reduce((a, c) => a + c.charCodeAt(0), 0); return `<img class="wphoto" src="${esc(l[n % l.length].url)}" alt="" decoding="async" draggable="false">`; } },
  countdown: { label: "Countdown", what: "Days until a date you choose", ic: G.flag, sizes: ["s", "m", "l"], def: "s", needs: () => [], tick: 60, form: "date", draw: (z, D, it) => { const now = new Date(), def = `${now.getFullYear() + 1}-01-01`, to = new Date(`${it.opts?.date || def}T00:00`), n = Math.ceil((to - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5), t = it.opts?.title || (it.opts?.date ? to.toLocaleDateString([], { month: "short", day: "numeric" }) : "New Year"); return z === "s" ? `<div class="wc"><b class="huge">${Math.abs(n)}</b><span>${n === 0 ? "today" : n < 0 ? "days since" : n === 1 ? "day" : "days"}</span><em>${esc(t)}</em></div>` : z === "l" ? `${head(t, G.flag)}<div class="wc"><b class="vast">${Math.abs(n)}</b><span>${n === 0 ? "Today" : n < 0 ? "days since" : n === 1 ? "day to go" : "days to go"}</span><em>${to.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</em></div>` : `<div class="wrow"><b class="vast m">${Math.abs(n)}</b><div><strong>${esc(t)}</strong><span>${n === 0 ? "Today" : `${n < 0 ? "days since" : n === 1 ? "day to go" : "days to go"} · ${to.toLocaleDateString([], { month: "long", day: "numeric" })}`}</span></div></div>`; } },
  timer: { label: "Timer", what: "A timer shared by every screen", ic: IC.timer, sizes: ["s", "m", "l"], def: "m", needs: () => ["board"], tick: 1, draw: (z, D) => { const t = D.board?.data?.timer || { total: 300_000, left: 300_000, end: 0 }, left = timerLeft(t), run = t.end && left > 0, done = t.end && !left, p = Math.round((left / Math.max(1, t.total)) * 100); const ctl = `<div class="wbs">${btn("timer:-", G.minus, "One minute less")}${btn("timer:go", run ? G.pause : G.play, run ? "Pause" : "Start", "big")}${btn("timer:+", G.plus, "One minute more")}${z === "l" ? btn("timer:0", G.reset, "Start over") : ""}</div>`; return z === "s" ? `<div class="wc"><b class="mid${done ? " ring" : ""}">${done ? "Done" : mmss(left)}</b>${btn("timer:go", run ? G.pause : G.play, run ? "Pause" : "Start", "big")}</div>` : z === "m" ? `<div class="wtm"><b class="huge${done ? " ring" : ""}${left >= 36e5 ? " long" : ""}">${done ? "Done" : mmss(left)}</b><i class="wbar"><b style="width:${p}%"></b></i>${ctl}</div>` : `${head("Timer", IC.timer)}<div class="wc"><b class="huge${done ? " ring" : ""}${left >= 36e5 ? " long" : ""}">${done ? "Done" : mmss(left)}</b><i class="wbar"><b style="width:${p}%"></b></i></div>${ctl}`; } },
  notes: { label: "Note", what: "Something to remember, on every screen", ic: G.note, sizes: ["m", "l", "xl", "xxl"], def: "l", needs: () => ["board"], draw: (z, D, it) => { const t = D.board?.data?.notes?.[it.k]; return head(it.opts?.title || "Note", G.note) + (t ? `<div class="wnote">${esc(t)}</div>` : none("Press to write something")); }, full: (D, it) => `${head(it.opts?.title || "Note", G.note)}<textarea class="wedit" data-note="${esc(it.k)}" placeholder="Write something">${esc(D.board?.data?.notes?.[it.k] || "")}</textarea>` },
  todo: { label: "To-do", what: "A list to tick off, on every screen", ic: G.todo, sizes: ["m", "l", "xl", "xxl"], def: "l", needs: () => ["board"], draw: (z, D) => { const l = D.board?.data?.todos || [], left = l.filter((t) => !t.done).length, rows = l.map((t, i) => ({ ...t, i })).sort((a, b) => a.done - b.done).slice(0, z === "m" ? 3 : z === "l" ? 7 : z === "xl" ? 14 : 20).map(todoRow).join(""); return z === "m" ? `<div class="wtodo">${rows || none("All done")}</div>` : head(left ? `To-do · ${left} left` : "To-do", G.todo) + `<div class="wtodo ${z[0]}">${rows || none("Nothing to do")}</div>`; }, full: (D) => `${head("To-do", G.todo)}<div class="wtodo full">${(D.board?.data?.todos || []).map((t, i) => todoRow({ ...t, i }, true)).join("")}</div><input class="wadd" type="text" data-todo maxlength="200" placeholder="Add something, then Enter" aria-label="Add something">` },
  storage: { label: "Storage", what: "Room on your drives", ic: G.disk, sizes: ["s", "m", "l"], def: "m", needs: () => ["drives"], draw: (z, D) => { const l = (D.drives?.entries || []).filter((x) => x.size); if (!l.length) return none("Looking…"); if (z === "m" && l.length === 1) { const x = l[0], v = 100 * (1 - x.free / x.size); return `<div class="wrow">${ring("", v)}<div><strong>${esc(x.label || x.name)}</strong><span>${bytes(x.size - x.free)} used</span><span>${bytes(x.free)} free of ${bytes(x.size)}</span></div></div>`; } const pc = (x) => 100 * (1 - x.free / x.size); return z === "s" ? `<div class="wc">${ring(esc(l[0].name), pc(l[0]))}</div>` : z === "l" && l.length < 3 ? `${head("Storage", G.disk)}<div class="wdrvs">${l.map((x) => `<div>${ring(esc(x.label || x.name), pc(x))}<em>${bytes(x.size - x.free)} used<br>${bytes(x.free)} free of ${bytes(x.size)}</em></div>`).join("")}</div>` : `${z === "l" ? head("Storage", G.disk) : ""}<div class="wdrv">${l.slice(0, z === "m" ? 2 : 4).map((x) => `<div><b>${esc(x.label || x.name)}</b><span>${bytes(x.free)} free</span><i class="wbar"><b style="width:${pc(x).toFixed(0)}%"></b></i></div>`).join("")}</div>`; } },
  files: { label: "Recent files", what: "The newest in your folders", ic: G.file, sizes: ["m", "l", "xl", "xxl"], def: "l", needs: () => ["places"], draw: (z, D) => { const l = D.places?.recent || []; return (z === "m" ? "" : head("Recent files", G.file)) + (l.length ? `<div class="wfiles ${z[0]}">${l.slice(0, z === "m" ? 3 : z === "l" ? 7 : z === "xl" ? 14 : 24).map((f) => `<div data-wa="file:${esc(f.path)}">${G.file}<b>${esc(f.name)}</b><span>${bytes(f.size)}</span></div>`).join("")}</div>` : none(D.places ? "No recent files" : "Looking…")); } },
  apps: { label: "Favorite apps", what: "Your favorites, one tap away", ic: G.grid, sizes: ["m", "l", "w"], def: "m", only: ["desk", "phone"], needs: () => ["apps"], draw: (z, D) => { const all = [...(D.apps?.apps || []), ...(D.apps?.more || [])], l = (D.apps?.favorites || []).map((id) => all.find((a) => a.id === id)).filter((a) => a?.url || a?.pc).slice(0, z === "m" ? 4 : z === "l" ? 12 : 8); return l.length ? `<div class="wapps ${z}">${l.map((a) => `<button type="button" data-wa="app:${esc(a.id)}" aria-label="${esc(a.name)}">${globalThis.HubDesk?.art?.(a.id) ? `<span class="wapp-i">${HubDesk.art(a.id)}</span>` : `<img src="${a.url ? `/api/hub/site-icon?url=${encodeURIComponent(a.url)}` : `/api/desk/icon?id=${encodeURIComponent(a.pc || a.id)}`}" alt="" onerror="this.remove()">`}<span>${esc(a.name)}</span></button>`).join("")}</div>` : none("Add favorites on Home"); } },
  sound: { label: "Volume and brightness", what: "This computer’s, from any screen", ic: IC.vol, sizes: ["m", "l"], def: "m", only: ["desk", "tv", "phone"], needs: () => ["music"], draw: (z, D) => { const m = D.music_ || {}, row = (id, ic, v) => `<div class="wlev">${ic}<i class="wbar"><b style="width:${v ?? 0}%"></b></i>${btn(`${id}:-`, G.minus, "Less")}${btn(`${id}:+`, G.plus, "More")}</div>`; return (z === "l" ? head("This computer", IC.vol) : "") + `<div class="wlevs">${row("volume", IC.vol, m.volume)}${m.brightness == null ? "" : row("brightness", IC.sun, m.brightness)}</div>`; } },
  remote: { label: "TV remote", what: "Arrows, OK, Back and Home for your TV", ic: IC.pic, sizes: ["l"], def: "l", only: ["desk", "phone"], needs: () => ["status"], draw: (z, D) => `<div class="wrem${D.status?.tv?.on ? "" : " off"}">${[["tv:back", G.back, "Back"], ["tv:up", G.up, "Up"], ["tv:home", IC.home, "Home"], ["tv:left", G.left, "Left"], ["tv:enter", "<b>OK</b>", "OK"], ["tv:right", G.right, "Right"], ["tv:menu", sym('<path d="M4 7h16M4 12h16M4 17h16"/>'), "Menu"], ["tv:down", G.down, "Down"], ["tv:power", IC.power, "Power"]].map(([a, ic, t]) => btn(a, ic, t)).join("")}</div>` },
  devices: { label: "Devices", what: "What’s connected to LocalHub", ic: IC.pic, sizes: ["m", "l"], def: "m", needs: () => ["status", "sys"], draw: (z, D) => { const t = D.status?.tv, r = (n, on, s) => `<div class="wdev"><i class="${on ? "on" : ""}"></i><b>${esc(n)}</b><span>${esc(s)}</span></div>`; return (z === "l" ? head("Devices", IC.pic) : "") + `<div class="wdevs">${r("This computer", !!D.sys, D.sys ? "On" : "Off")}${r("TV", !!t?.on, t?.on ? "On LocalHub" : "Not on LocalHub")}${z === "m" ? r("Hey LocalHub", !!D.status?.listen?.on, D.status?.listen?.on ? "Listening" : "Off") : ""}${z === "l" ? r("Hey LocalHub", !!D.status?.listen?.on, D.status?.listen?.on ? "Listening" : "Off") + r("Alexa", !!D.status?.alexa?.on, D.status?.alexa?.on ? "On" : "Not set up") : ""}</div>`; } },
};
/** How many cells each size takes, and how many a screen has: Home's is its top right corner, the screensaver's its right half. */
export const SPAN = { s: [1, 1], m: [2, 1], l: [2, 2], w: [4, 1], xl: [4, 2], xxl: [4, 3] };
/** A computer's Home is six by six smaller squares: a small card takes two by two of them. Everywhere else a square is a small card. */
export const FINE = { desk: 2 };
export const ROOM = { desk: [6, 6], tv: [4, 3], saver: [4, 5], side: [4, 40], phone: [2, 200] };
// What is inside a card's edges, in em: the clock is drawn to fill it.
const BOX = { s: [10.6, 10.4], m: [23.6, 10.2], l: [23.6, 23.6], w: [52.4, 10.2], xl: [52.4, 23.6], xxl: [52.4, 38] };
/** A cell is square: 13em, with 1.4em between. How many rows there is height for is the screen's to say (3 to 5 on a computer). */
export const CELL = 13, GAP = 1.4, across = (n) => n * CELL + (n - 1) * GAP;
export const cellOf = (screen) => (FINE[screen] ? (CELL - GAP) / 2 : CELL), acrossOn = (screen, n) => n * cellOf(screen) + (n - 1) * GAP;
export const spanOn = (screen, size) => (SPAN[size] || SPAN.m).map((n, i) => Math.min((ROOM[screen] || ROOM.desk)[i], n * (FINE[screen] || 1)));
export const fitGrid = (width, height) => Math.max(4, Math.min(width / acrossOn("desk", ROOM.desk[0]), height / acrossOn("desk", ROOM.desk[1])));
const sized = (it, phone) => { const w = W[it.id], own = !w || w.sizes.includes(it.size) ? it.size : w.def; return phone ? onPhone({ ...it, size: own }) : own; };
/** Places a list on a screen's grid: the ones that were put somewhere first, then the rest in order, each in the first gap that takes
 * it. A phone's is only an order. -> { at: Map(k -> [col, row, w, h]), out: Set(k) } */
export function pack(list, screen) {
  const [cols, rows] = ROOM[screen] || ROOM.desk, used = [], at = new Map(), out = new Set();
  const span = (it) => { const [w, h] = SPAN[sized(it, screen === "phone")] || SPAN.m, n = FINE[screen] || 1; return [Math.min(cols, w * n), n > 1 ? Math.min(rows, h * n) : h]; };
  const free = (c, r, w, h) => { for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (used[y]?.[x]) return false; return true; };
  const take = (it, c, r, w, h) => { for (let y = r; y < r + h; y++) { used[y] ??= []; for (let x = c; x < c + w; x++) used[y][x] = 1; } at.set(it.k, [c + 1, r + 1, w, h]); };
  if (screen !== "phone") for (const it of list) if (it.at) {
    const [w, h] = span(it), c = Math.min(it.at[0] - 1, cols - w), r = Math.min(it.at[1] - 1, rows - h);
    if (c >= 0 && r >= 0 && free(c, r, w, h)) take(it, c, r, w, h);
  }
  for (const it of list) if (!at.has(it.k)) {
    const [w, h] = span(it);
    let done = false;
    for (let r = 0; r + h <= rows && r <= used.length && !done; r++) for (let c = 0; c + w <= cols && !done; c++) if (free(c, r, w, h)) { take(it, c, r, w, h); done = true; }
    if (!done) out.add(it.k);
  }
  return { at, out };
}
/** The list with one changed, everything else staying where it is if it can; null when something would no longer fit. */
export function place(list, screen, k, change) {
  if (screen === "phone") return list.map((x) => (x.k === k ? { ...x, ...change } : x));
  const l = list.filter((x) => can(x.id, screen)), was = pack(l, screen), other = list.filter((x) => !can(x.id, screen));
  const fixed = l.map((x) => { const p = was.at.get(x.k); return p ? { ...x, at: [p[0], p[1]] } : x; }), it = fixed.find((x) => x.k === k);
  // The one it lands on goes where it was.
  const to = change.at && l.find((x) => { const p = was.at.get(x.k); return x.k !== k && p && change.at[0] >= p[0] && change.at[0] < p[0] + p[2] && change.at[1] >= p[1] && change.at[1] < p[1] + p[3]; });
  const next = [{ ...it, ...change, ...(to && change.swap ? { at: was.at.get(to.k).slice(0, 2) } : {}) }, ...(to && it.at ? [{ ...fixed.find((x) => x.k === to.k), at: it.at }] : []), ...fixed.filter((x) => x.k !== k && !(to && it.at && x.k === to.k))];
  delete next[0].swap;
  const o = pack(next, screen);
  if ([...o.out].some((x) => !was.out.has(x))) return null;
  return [...next.map((x) => { const p = o.at.get(x.k); return p ? { ...x, at: [p[0], p[1]] } : x; }), ...other];
}
/** The sizes of a widget that fit where it is, or at the end of the list when it isn't there yet. */
export const fitting = (list, it, screen) => {
  const l = list.filter((x) => can(x.id, screen)), here = l.some((x) => x.k === it.k), was = pack(l, screen).out;
  return (W[it.id]?.sizes || []).filter((size) => { if (here) return !!place(l, screen, it.k, { size }) && !pack(place(l, screen, it.k, { size }), screen).out.has(it.k); const o = pack([...l, { ...it, size }], screen).out; return !o.has(it.k) && [...o].every((k) => was.has(k)); });
};
const todoRow = (t, del) => `<div class="wt${t.done ? " done" : ""}"><button type="button" data-wa="todo:${t.i}" aria-label="${t.done ? "Not done" : "Done"}">${t.done ? G.check : ""}</button><span>${esc(t.text)}</span>${del === true ? btn(`todox:${t.i}`, G.minus, "Remove") : ""}</div>`;
const upText = (i) => { const up = Number(i?.uptimeSeconds) || 0; return up ? ` · On for ${up >= 172800 ? `${Math.floor(up / 86400)} days` : `${Math.floor(up / 3600)} h ${Math.floor((up % 3600) / 60)} min`}` : ""; };
function tops(info, plain) {
  const by = new Map();
  for (const p of info?.topByMemory || []) by.set(p.name, (by.get(p.name) || 0) + (Number(p.mb) || 0));
  const l = [...by].sort((a, b) => b[1] - a[1]).slice(0, 5), most = l[0]?.[1] || 1;
  return `<div class="wtops">${plain ? "" : head("Using the most memory")}${l.map(([n, mb]) => `<div><span>${esc(n)}</span><i class="wbar"><b style="width:${Math.round((mb / most) * 100)}%"></b></i><em>${mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`}</em></div>`).join("") || none("Looking…")}</div>`;
}
export const SIZE_NAMES = { s: "Small", m: "Medium", l: "Large", w: "Wide", xl: "Extra large", xxl: "XXL" };
export const SIZE_SHORT = { s: "S", m: "M", l: "L", w: "Wide", xl: "XL", xxl: "XXL" };
export const can = (id, screen) => !!W[id] && (!W[id].only || W[id].only.includes(screen === "side" ? "desk" : screen));
export const nextSize = (id, size) => { const l = W[id]?.sizes || [size]; return l[(l.indexOf(size) + 1) % l.length]; };
// A phone is two across: the widest ones are drawn as the large ones are.
const onPhone = (it) => (it.size === "xl" || it.size === "xxl" ? (W[it.id]?.sizes.includes("l") ? "l" : "m") : it.size === "w" ? "m" : it.size);
export function drawItem(it, D, edit, phone, place, sizes) {
  const w = W[it.id];
  if (!w) return "";
  const own = w.sizes.includes(it.size) ? it.size : w.def, z = sized(it, phone);
  let body;
  try { body = w.draw(z, D, it); } catch { body = none("Not available right now"); }
  const tools = edit ? `<button type="button" class="we-x" data-we="x:${it.k}" aria-label="Remove ${w.label}">${G.minus}</button><div class="we-t">${(sizes || w.sizes).length > 1 ? `<button type="button" data-we="z:${it.k}" aria-label="Change size">${SIZE_SHORT[own]}</button>` : ""}${w.form ? `<button type="button" data-we="f:${it.k}" aria-label="Options">${G.dots}</button>` : ""}</div>` : "";
  return `<div class="wg-i z-${z} w-${it.id}${w.bare ? " bare" : ""}${place === null ? " nofit" : ""}"${place ? ` style="grid-area:${place[1]}/${place[0]}/span ${place[3]}/span ${place[2]}"` : ""} data-k="${it.k}" data-wid="${it.id}"${edit ? ' draggable="true"' : ` role="group" tabindex="0" aria-label="${esc(w.label)}"`}>${body}${tools}</div>`;
}
/** A screen's board: keeps the list and its data fresh, and says when there is something new to draw. */
export function createBoard({ screen, changed, music }) {
  const D = {}, at = {}, busy = {};
  let items = null, stamp = 0, posting = 0;
  const fits = () => { const l = list(), p = pack(l, screen); return l.filter((x) => p.at.has(x.k)); };
  const post = (body) => fetch("/api/board", { method: "POST", headers: { "content-type": "application/json", "x-hub": "1" }, body: JSON.stringify(body) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const list = () => (items || []).filter((x) => can(x.id, screen));
  async function ask(id) {
    if (busy[id]) return;
    busy[id] = 1;
    at[id] = Date.now();
    try {
      const src = SOURCES[id][0], path = typeof src === "function" ? src() : src, early = window.__early?.[path];
      if (early) delete window.__early[path];
      const r = await (early || fetch(path, { cache: "no-store" }));
      const v = r.ok ? await r.json() : null;
      // Another month was turned to while this one was on its way.
      if (typeof src === "function" && src().replace(/T[^&]*/g, "") !== path.replace(/T[^&]*/g, "")) { busy[id] = 0; return void ask(id); }
      if (id === "music") D.music_ = v; else if (v || D[id] === undefined) D[id] = v;
      if (id === "board" && v && !posting) items = v.screens?.[screen] || [];
      changed?.();
    } catch { /* as it was */ }
    busy[id] = 0;
  }
  return {
    D, list, post,
    items: () => items || [],
    ready: () => !!items,
    pack: () => pack(list(), screen),
    /** The ones there is room for, in order. */
    fits,
    refresh(more = []) {
      if (music) D.music = music();
      const need = new Set(["board", ...more]);
      for (const it of fits()) for (const n of W[it.id]?.needs?.(it.size) || []) need.add(n);
      for (const n of need) if (SOURCES[n] && Date.now() - (at[n] || 0) > SOURCES[n][1]) ask(n);
    },
    ask,
    /** Everything its widgets show, once: the opening waits for it. */
    async warm() { await ask("board"); await Promise.all([...new Set(fits().flatMap((it) => W[it.id]?.needs?.(it.size) || []))].filter((n) => SOURCES[n] && n !== "board").map((n) => ask(n))); },
    async set(next) { items = next; posting++; changed?.(); const r = await post({ screen, items: next }); posting--; if (r) D.board = r; changed?.(); return !!r; },
    async data(d) { const r = await post({ data: d }); if (r) { D.board = r; changed?.(); } return !!r; },
    async calPost(p, body) { const r = await fetch(`/api/calendar/${p}`, { method: "POST", headers: { "content-type": "application/json", "x-hub": "1" }, body: JSON.stringify(body) }).catch(() => null); CAL.err = r?.ok ? "" : (await r?.json?.().catch(() => null))?.error || "LocalHub didn’t answer"; await ask("cal"); changed?.(); return !!r?.ok; },
    /** Adds what was typed full screen to the day picked there. */
    async calAdd() {
      const title = CAL.title.trim(), sel = CAL.sel || keyOf(new Date());
      if (!title) return false;
      const ok = await this.calPost("events", CAL.time ? { title, allDay: false, start: new Date(`${sel}T${CAL.time}`).toISOString() } : { title, allDay: true, start: sel });
      if (ok) CAL.title = CAL.time = "";
      changed?.();
      return ok;
    },
    /** @param more cards that aren't from here, { k, size }, placed after these: the second thing returned is where they go */
    html(edit, more = []) {
      if (music) D.music = music();
      const l = list(), p = pack([...l, ...more], screen);
      this.at = p.at;
      const room = ROOM[screen] || ROOM.desk, ghosts = [];
      if (edit && screen !== "phone") for (let r = 1; r <= (screen === "side" ? Math.max(0, ...[...p.at.values()].map((x) => x[1] + x[3] - 1)) + 1 : room[1]); r++) for (let c = 1; c <= room[0]; c++) if (![...p.at.values()].some(([x, y, w, h]) => c >= x && c < x + w && r >= y && r < y + h)) ghosts.push(`<button type="button" class="wg-ghost" data-k="g-${c}-${r}" data-we="add:${c},${r}" style="grid-area:${r}/${c}" aria-label="Add a widget here">${G.plus}</button>`);
      return l.filter((it) => p.at.has(it.k)).map((it) => drawItem(it, D, edit, screen === "phone", p.at.get(it.k) || null, edit ? fitting(l, it, screen) : undefined)).join("") + ghosts.join("");
    },
    newKey: () => `w${(Date.now() + ++stamp).toString(36)}`,
    /** A button in a widget. Returns true when it was one. */
    act(a) {
      const [k, ...r] = a.split(":"), v = r.join(":");
      const send = (p, b) => fetch(p, { method: "POST", headers: { "content-type": "application/json", "x-hub": "1" }, body: JSON.stringify(b) }).catch(() => {});
      if (k === "timer") {
        const t = { total: 300_000, left: 300_000, end: 0, ...D.board?.data?.timer }, left = timerLeft(t);
        const to = v === "go" ? (t.end && left ? { ...t, left, end: 0 } : { ...t, left: left || t.total, end: Date.now() + (left || t.total) }) : v === "0" ? { ...t, left: t.total, end: 0 } : (() => { const n = Math.max(60_000, (left || 0) + (v === "+" ? 60_000 : -60_000)); return t.end && left ? { total: Math.max(t.total, n), left: n, end: Date.now() + n } : { total: n, left: n, end: 0 }; })();
        if (D.board) D.board.data.timer = to;
        changed?.();
        return this.data({ timer: to }), true;
      }
      if (k === "todo" || k === "todox") { const l = (D.board?.data?.todos || []).map((t) => ({ ...t })), i = Number(v); if (l[i]) { if (k === "todo") l[i].done = !l[i].done; else l.splice(i, 1); D.board.data.todos = l; changed?.(); this.data({ todos: l }); } return true; }
      if (k === "cal") {
        const was = CAL.ym, [what, ...x] = v.split(":"), id = x.join(":");
        if (what === "x" && CAL.del === id) { CAL.del = ""; return this.calPost(`events/${encodeURIComponent(id)}/delete`, {}), true; }
        CAL.del = what === "x" ? id : "";
        CAL.err = "";
        if (what === "d") CAL.sel = id;
        else if (what === "today") Object.assign(CAL, { ym: 0, sel: "" });
        else if (what !== "x") { CAL.ym = Math.max(-11, Math.min(11, CAL.ym + (what === "next" ? 1 : -1))); CAL.sel = CAL.ym ? keyOf(calMonth()) : ""; }
        if (CAL.ym !== was) ask("cal");
        changed?.();
        return true;
      }
      if (k === "volume" || k === "brightness") { const was = D.music_?.[k] ?? 50, to = Math.max(0, Math.min(100, was + (v === "+" ? 10 : -10))); if (D.music_) D.music_[k] = to; changed?.(); send("/api/music/level", { what: k, value: to }); return true; }
      if (k === "tv") { v === "power" ? send("/api/tv/power", { on: "toggle" }) : send("/api/tv/screen/input", { remote: true, events: [{ key: v }] }); return true; }
      return false;
    },
  };
}

/** A widget, opened: the same shape as its card, so it grows straight out of it, and what it says fills that. */
const shape = (from) => Math.min(2.45, Math.max(0.95, from?.offsetWidth ? from.offsetWidth / from.offsetHeight : 1.2));
export function fullHTML(it, D, screen, from) {
  const w = W[it.id];
  try { return `<div class="wfull">${shape(from) > 1.9 && w.sizes.includes("xl") && !["calendar", "notes", "todo"].includes(it.id) ? w.draw("xl", D, it) : w.full ? w.full(D, it, screen) : w.draw(w.sizes.includes("xl") && shape(from) > 1.5 ? "xl" : w.sizes.includes("l") ? "l" : w.sizes.at(-1), D, it)}</div>`; } catch { return `<div class="wfull">${none("Not available right now")}</div>`; }
}
export function fitFull(box, from, maxW, maxH, bare) {
  const r = shape(from), w = Math.round(Math.min(maxW, maxH * r)), el = box.firstElementChild;
  box.style.width = `${w}px`;
  box.style.height = `${Math.round(w / r)}px`;
  if (!el || bare) return;
  let lo = 6, hi = 34;
  const ok = (px) => { el.style.fontSize = `${px}px`; return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1 && [...el.querySelectorAll(".wcfull, .wtwo, .wrings, .whours, .wcnav, .wevs, .wclock")].every((n) => n.scrollWidth <= n.clientWidth + 2); };
  for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  ok(lo);
}

/** Puts a board's widgets in place, touching only the ones that changed, so a cover doesn't blink and a picture isn't loaded again. */
export function put(grid, html) {
  if (!grid || grid._html === html) return;
  grid._html = html;
  const t = document.createElement("template");
  t.innerHTML = html;
  const have = new Map([...grid.children].map((n) => [n.dataset.k || n.className, n]));
  let at = grid.firstElementChild;
  for (const n of [...t.content.children]) {
    const key = n.dataset.k || n.className, old = have.get(key);
    have.delete(key);
    let use = n;
    if (old) {
      if (old._src !== n.outerHTML) { old._src = n.outerHTML; const hid = old.style.visibility; if (old.className.replace(/ ?sel/, "") !== n.className) old.className = n.className; for (const a of ["draggable", "role", "tabindex", "aria-label", "style"]) n.hasAttribute(a) ? old.setAttribute(a, n.getAttribute(a)) : old.removeAttribute(a); if (hid) old.style.visibility = hid; const img = old.querySelector(".wphoto"), img2 = n.querySelector(".wphoto"); if (!(img && img2 && img.src === img2.src && old.children.length === n.children.length)) old.innerHTML = n.innerHTML; }
      use = old;
    } else n._src = n.outerHTML;
    if (at === use) at = at.nextElementSibling;
    else grid.insertBefore(use, at);
  }
  for (const n of have.values()) n.remove();
}
