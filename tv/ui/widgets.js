// Home's widgets, drawn the same on a computer, on the web (a phone or iPad) and on the TV: tabs/tvlook.js and app.js both use
// these. board.mjs keeps which ones, their sizes and what's in them. A widget is HTML from data; every length in widgets.css is in
// em, so one drawing fits every screen. Sizes, on a grid four across (two on a phone): s 1x1, m 2x1, l 2x2, w 4x1, x 4x2.
import { IC, player, pcDetail } from "./panel.js?v=10";

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
  up: sym('<path d="m6 15 6-6 6 6"/>'), down: sym('<path d="m6 9 6 6 6-6"/>'), left: sym('<path d="m15 6-6 6 6 6"/>'), right: sym('<path d="m9 6 6 6-6 6"/>'), back: sym('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  dir: sym('<path d="M4 7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>'), file: sym('<path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M14 3.5V8h4"/>'), disk: sym('<path d="M4 13l3-8h10l3 8v5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><path d="M4 13h16M8 16.5h.01"/>'),
  cal: sym('<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>'), note: sym('<path d="M5 4.5h14v10l-5 5H5z"/><path d="M14 19.5v-5h5M8.5 9h7M8.5 13h3"/>'), todo: sym('<path d="m4 6.5 1.5 1.5L8.5 5M4 13.5 5.5 15l3-3M12 7h8M12 14h8M4 20h16"/>'), globe: sym('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'), img: sym('<rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M4 16l4.5-4.5 4 4 2.5-2.5 5 5"/>'), flag: sym('<path d="M6 21V4M6 5h11l-2.5 4L17 13H6"/>'), grid: sym('<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>'),
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
function month(d, marks = new Set()) {
  const first = new Date(d.getFullYear(), d.getMonth(), 1), n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const cells = [...Array(first.getDay()).fill(""), ...Array.from({ length: n }, (_, i) => i + 1)];
  return `<div class="wcal">${["S", "M", "T", "W", "T", "F", "S"].map((x) => `<em>${x}</em>`).join("")}${cells.map((x) => `<span class="${x === d.getDate() ? "on" : ""}${marks.has(x) ? " ev" : ""}">${x}</span>`).join("")}</div>`;
}
const events = (D) => (Array.isArray(D.cal?.events) ? D.cal.events : []).map((e) => ({ title: String(e.title || e.summary || ""), at: new Date(e.start || e.at || 0), all: !!(e.allDay || e.all) })).filter((e) => e.title && !Number.isNaN(+e.at));
const eventRow = (e) => `<div class="wev"><b>${esc(e.title)}</b><span>${e.at.toLocaleDateString([], { weekday: "short" })}${e.all ? "" : ` ${clockParts(e.at)}`}</span></div>`;
const wdays = (w, n) => { const l = (w.days || []).slice(0, n), lo = Math.min(...l.map((x) => x.low)), hi = Math.max(...l.map((x) => x.high)), sp = Math.max(1, hi - lo); return `<div class="wdays">${l.map((x, i) => `<div><span>${dayName(x.date, i)}</span>${wxIcon(x.code)}<em>${x.low}°</em><i><b style="left:${((x.low - lo) / sp) * 100}%;right:${100 - ((x.high - lo) / sp) * 100}%"></b></i><strong>${x.high}°</strong></div>`).join("")}</div>`; };
const whours = (w, n) => `<div class="whours">${(w.hours || []).slice(0, n).map((h, i) => `<div><span>${i ? hour(h.time) : "Now"}</span>${wxIcon(h.code, h.day)}<b>${h.temp}°</b></div>`).join("")}</div>`;
const wnow = (w) => `<div class="wnow">${wxIcon(w.now.code, w.now.day)}<b>${w.now.temp}°</b><div><strong>${esc(w.now.text)}</strong><span>H ${w.high}°  L ${w.low}°</span><span>${esc(w.place)} · Feels ${w.now.feels}°</span></div></div>`;
export const HOURS = { desk: "", phone: "", tv: "" };

// What each one needs: where it comes from and how often it's asked.
export const SOURCES = {
  music: ["/api/music", 4000], wx: ["/api/tv/weather", 900_000], sys: ["/api/desk/system", 8000], info: ["/api/system/info", 30_000], cal: ["/api/calendar/upcoming", 300_000], photos: ["/api/tv/saver", 600_000],
  places: ["/api/files/drives/places", 120_000], drives: ["/api/files/drives?path=", 60_000], status: ["/api/tv/status", 15_000], apps: ["/api/desk", 60_000], board: ["/api/board", 10_000],
};
// id -> { label, what, ic, sizes, def, needs(size), draw(size, D, it), full?(D, it), tick?, only?, form? }
export const W = {
  music: { label: "Music", what: "What’s playing, with its cover and buttons", ic: IC.note, sizes: ["s", "m", "l", "w", "x"], def: "w", needs: () => [], draw: (z, D) => player(D.music || {}, z === "w" || z === "x" || z === "m"), bare: true },
  weather: { label: "Weather", what: "Now, the hours ahead and the coming days", ic: G.sun, sizes: ["s", "m", "l", "w", "x"], def: "l", needs: () => ["wx"], draw: (z, D) => { const w = D.wx; if (!w?.now) return none("Finding the weather…"); return z === "s" ? `<div class="wc">${wxIcon(w.now.code, w.now.day)}<b class="big">${w.now.temp}°</b><span>${w.high}° / ${w.low}°</span></div>` : z === "m" ? wnow(w) : z === "l" ? wnow(w) + whours(w, 5) + wdays(w, 3) : z === "w" ? `<div class="wrow">${wnow(w)}${whours(w, 7)}</div>` : `<div class="wtwo"><div>${wnow(w)}${whours(w, 6)}</div>${wdays(w, 6)}</div>`; }, full: (D) => (D.wx?.now ? wnow(D.wx) + whours(D.wx, 12) + wdays(D.wx, 7) : none("Finding the weather…")) },
  pc: { label: "This PC", what: "Processor, memory, disk and what’s using them", ic: IC.gauge, sizes: ["s", "m", "l", "w", "x"], def: "l", needs: (z) => (z === "x" ? ["sys", "info"] : ["sys"]), draw: (z, D) => { const y = D.sys; if (!y) return none("Looking…"); const three = ring("CPU", y.cpu) + ring("Memory", y.mem) + ring("Disk", y.disk); return z === "s" ? `<div class="wc">${ring("CPU", y.cpu)}</div>` : z === "m" ? `<div class="wrings">${three}</div>` : z === "l" ? `${head("This PC")}<div class="wrings">${three}</div><div class="wfoot">${y.diskFree ? `${bytes(y.diskFree)} free` : ""}</div>` : z === "w" ? `<div class="wrow">${head("This PC")}<div class="wrings">${three}</div><div class="wfoot">${y.diskFree ? `${bytes(y.diskFree)} free` : ""}</div></div>` : `<div class="wtwo"><div>${head("This PC")}<div class="wrings">${three}</div></div>${tops(D.info)}</div>`; }, fullNeeds: ["info"], full: (D) => pcDetail(D.sys || {}, D.info) },
  clock: { label: "Clock", what: "A clock face, or the time and date", ic: IC.clock, sizes: ["s", "m", "l"], def: "m", needs: () => [], tick: 1, draw: (z) => { const d = new Date(); return z === "s" ? `<div class="wc">${face(d)}</div>` : z === "m" ? `<div class="wtime"><b>${clockParts(d)}</b><span>${d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span></div>` : `<div class="wc">${face(d, "lg")}<span>${d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</span></div>`; } },
  world: { label: "World clock", what: "The time in other places", ic: G.globe, sizes: ["m", "l", "w"], def: "m", needs: () => [], tick: 1, form: "zones", draw: (z, D, it) => { const d = new Date(), l = (it.opts?.zones?.length ? it.opts.zones : ["America/New_York", "Europe/London", "Asia/Tokyo", "Australia/Sydney"]).slice(0, z === "m" ? 2 : 4); return `<div class="wworld ${z}">${l.map((t) => `<div><span>${esc(t.split("/").pop().replace(/_/g, " "))}</span><b>${clockParts(d, t)}</b></div>`).join("")}</div>`; } },
  calendar: { label: "Calendar", what: "Today, the month, and what’s coming up", ic: G.cal, sizes: ["s", "m", "l", "x"], def: "l", needs: () => ["cal"], tick: 60, draw: (z, D) => { const d = new Date(), ev = events(D), marks = new Set(ev.filter((e) => e.at.getMonth() === d.getMonth() && e.at.getFullYear() === d.getFullYear()).map((e) => e.at.getDate())), day = `<div class="wday"><em>${d.toLocaleDateString([], { weekday: "long" })}</em><b>${d.getDate()}</b></div>`, next = ev.length ? ev.slice(0, z === "m" ? 2 : 4).map(eventRow).join("") : '<div class="wev"><span>Nothing planned</span></div>'; return z === "s" ? `<div class="wc">${day}</div>` : z === "m" ? `<div class="wrow">${day}<div class="wevs">${next}</div></div>` : z === "l" ? head(d.toLocaleDateString([], { month: "long", year: "numeric" })) + month(d, marks) : `<div class="wtwo"><div>${head(d.toLocaleDateString([], { month: "long", year: "numeric" }))}${month(d, marks)}</div><div class="wevs">${head("Coming up")}${next}</div></div>`; }, full: (D) => { const d = new Date(), ev = events(D); return head(d.toLocaleDateString([], { month: "long", year: "numeric" })) + month(d, new Set(ev.filter((e) => e.at.getMonth() === d.getMonth()).map((e) => e.at.getDate()))) + `<div class="wevs">${ev.slice(0, 8).map(eventRow).join("") || '<div class="wev"><span>Nothing planned. Connect a calendar in Settings › Services.</span></div>'}</div>`; } },
  photos: { label: "Photos", what: "Your screensaver’s pictures, changing", ic: G.img, sizes: ["s", "m", "l", "w", "x"], def: "l", needs: () => ["photos"], tick: 1, bare: true, draw: (z, D, it) => { const l = D.photos?.photos || []; if (!l.length) return none("No photos chosen"); const n = Math.floor(Date.now() / 20_000) + [...it.k].reduce((a, c) => a + c.charCodeAt(0), 0); return `<img class="wphoto" src="${esc(l[n % l.length].url)}" alt="" decoding="async" draggable="false">`; } },
  countdown: { label: "Countdown", what: "Days until a date you choose", ic: G.flag, sizes: ["s", "m"], def: "s", needs: () => [], tick: 60, form: "date", draw: (z, D, it) => { const now = new Date(), def = `${now.getFullYear() + 1}-01-01`, to = new Date(`${it.opts?.date || def}T00:00`), n = Math.ceil((to - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5), t = it.opts?.title || (it.opts?.date ? to.toLocaleDateString([], { month: "short", day: "numeric" }) : "New Year"); return z === "s" ? `<div class="wc"><b class="big">${Math.abs(n)}</b><span>${n === 0 ? "today" : n < 0 ? "days since" : n === 1 ? "day" : "days"}</span><em>${esc(t)}</em></div>` : `<div class="wrow"><b class="huge">${Math.abs(n)}</b><div><strong>${esc(t)}</strong><span>${n === 0 ? "Today" : `${n < 0 ? "days since" : n === 1 ? "day to go" : "days to go"} · ${to.toLocaleDateString([], { month: "long", day: "numeric" })}`}</span></div></div>`; } },
  timer: { label: "Timer", what: "A timer shared by every screen", ic: IC.timer, sizes: ["m", "l"], def: "m", needs: () => ["board"], tick: 1, draw: (z, D) => { const t = D.board?.data?.timer || { total: 300_000, left: 300_000, end: 0 }, left = timerLeft(t), run = t.end && left > 0, done = t.end && !left, p = Math.round((left / Math.max(1, t.total)) * 100); const ctl = `<div class="wbs">${btn("timer:-", G.minus, "One minute less")}${btn("timer:go", run ? G.pause : G.play, run ? "Pause" : "Start", "big")}${btn("timer:+", G.plus, "One minute more")}${z === "l" ? btn("timer:0", G.reset, "Start over") : ""}</div>`; return z === "m" ? `<div class="wrow"><b class="huge${done ? " ring" : ""}">${done ? "Done" : mmss(left)}</b>${ctl}</div>` : `${head("Timer")}<div class="wc"><b class="huge${done ? " ring" : ""}">${done ? "Done" : mmss(left)}</b><i class="wbar"><b style="width:${p}%"></b></i></div>${ctl}`; } },
  notes: { label: "Note", what: "Something to remember, on every screen", ic: G.note, sizes: ["m", "l", "x"], def: "l", needs: () => ["board"], draw: (z, D, it) => { const t = D.board?.data?.notes?.[it.k]; return head(it.opts?.title || "Note", G.note) + (t ? `<div class="wnote">${esc(t)}</div>` : none("Nothing written yet")); }, full: (D, it) => `${head(it.opts?.title || "Note", G.note)}<textarea class="wedit" data-note="${esc(it.k)}" placeholder="Write something">${esc(D.board?.data?.notes?.[it.k] || "")}</textarea>` },
  todo: { label: "To-do", what: "A list to tick off, on every screen", ic: G.todo, sizes: ["m", "l", "x"], def: "l", needs: () => ["board"], draw: (z, D) => { const l = D.board?.data?.todos || [], left = l.filter((t) => !t.done).length, rows = l.map((t, i) => ({ ...t, i })).sort((a, b) => a.done - b.done).slice(0, z === "m" ? 2 : z === "l" ? 5 : 10).map(todoRow).join(""); return z === "m" ? `<div class="wtodo">${rows || none("All done")}</div>` : head(left ? `To-do · ${left} left` : "To-do", G.todo) + `<div class="wtodo ${z}">${rows || none("Nothing to do")}</div>`; }, full: (D) => `${head("To-do", G.todo)}<div class="wtodo full">${(D.board?.data?.todos || []).map((t, i) => todoRow({ ...t, i }, true)).join("")}</div><input class="wadd" type="text" data-todo maxlength="200" placeholder="Add something, then Enter" aria-label="Add something">` },
  storage: { label: "Storage", what: "Room on your drives", ic: G.disk, sizes: ["s", "m", "l"], def: "m", needs: () => ["drives"], draw: (z, D) => { const l = (D.drives?.entries || []).filter((x) => x.size); if (!l.length) return none("Looking…"); const pc = (x) => 100 * (1 - x.free / x.size); return z === "s" ? `<div class="wc">${ring(esc(l[0].name), pc(l[0]))}</div>` : `${z === "l" ? head("Storage", G.disk) : ""}<div class="wdrv">${l.slice(0, z === "m" ? 2 : 4).map((x) => `<div><b>${esc(x.label || x.name)}</b><span>${bytes(x.free)} free</span><i class="wbar"><b style="width:${pc(x).toFixed(0)}%"></b></i></div>`).join("")}</div>`; } },
  files: { label: "Recent files", what: "The newest in your folders", ic: G.file, sizes: ["m", "l", "x"], def: "l", needs: () => ["places"], draw: (z, D) => { const l = D.places?.recent || []; return (z === "m" ? "" : head("Recent files", G.file)) + (l.length ? `<div class="wfiles ${z}">${l.slice(0, z === "m" ? 2 : z === "l" ? 5 : 10).map((f) => `<div data-wa="file:${esc(f.path)}">${G.file}<b>${esc(f.name)}</b><span>${bytes(f.size)}</span></div>`).join("")}</div>` : none(D.places ? "No recent files" : "Looking…")); } },
  apps: { label: "Favorite apps", what: "Your favorites, one tap away", ic: G.grid, sizes: ["m", "l", "w"], def: "m", only: ["desk", "phone"], needs: () => ["apps"], draw: (z, D) => { const all = [...(D.apps?.apps || []), ...(D.apps?.more || [])], l = (D.apps?.favorites || []).map((id) => all.find((a) => a.id === id)).filter((a) => a?.url || a?.pc).slice(0, z === "m" ? 4 : 8); return l.length ? `<div class="wapps ${z}">${l.map((a) => `<button type="button" data-wa="app:${esc(a.id)}" aria-label="${esc(a.name)}"><img src="${a.url ? `/api/hub/site-icon?url=${encodeURIComponent(a.url)}` : `/api/desk/icon?id=${encodeURIComponent(a.pc || a.id)}`}" alt="" onerror="this.remove()"><span>${esc(a.name)}</span></button>`).join("")}</div>` : none("Add favorites on Home"); } },
  sound: { label: "Volume and brightness", what: "This computer’s, from any screen", ic: IC.vol, sizes: ["m", "l"], def: "m", needs: () => ["music"], draw: (z, D) => { const m = D.music_ || {}, row = (id, ic, v) => `<div class="wlev">${ic}<i class="wbar"><b style="width:${v ?? 0}%"></b></i>${btn(`${id}:-`, G.minus, "Less")}${btn(`${id}:+`, G.plus, "More")}</div>`; return (z === "l" ? head("This computer", IC.vol) : "") + `<div class="wlevs">${row("volume", IC.vol, m.volume)}${m.brightness == null ? "" : row("brightness", IC.sun, m.brightness)}</div>`; } },
  remote: { label: "TV remote", what: "Arrows, OK, Back and Home for your TV", ic: IC.pic, sizes: ["l"], def: "l", only: ["desk", "phone"], needs: () => ["status"], draw: (z, D) => `<div class="wrem${D.status?.tv?.on ? "" : " off"}">${[["tv:back", G.back, "Back"], ["tv:up", G.up, "Up"], ["tv:home", IC.home, "Home"], ["tv:left", G.left, "Left"], ["tv:enter", "<b>OK</b>", "OK"], ["tv:right", G.right, "Right"], ["tv:menu", G.todo, "Menu"], ["tv:down", G.down, "Down"], ["tv:power", IC.power, "Power"]].map(([a, ic, t]) => btn(a, ic, t)).join("")}</div>` },
  devices: { label: "Devices", what: "What’s connected to LocalHub", ic: IC.pic, sizes: ["m", "l"], def: "m", needs: () => ["status", "sys"], draw: (z, D) => { const t = D.status?.tv, r = (n, on, s) => `<div class="wdev"><i class="${on ? "on" : ""}"></i><b>${esc(n)}</b><span>${esc(s)}</span></div>`; return (z === "l" ? head("Devices") : "") + `<div class="wdevs">${r("This computer", !!D.sys, D.sys ? "On" : "Off")}${r("TV", !!t?.on, t?.on ? "On LocalHub" : "Not on LocalHub")}${z === "l" ? r("Hey LocalHub", !!D.status?.listen?.on, D.status?.listen?.on ? "Listening" : "Off") + r("Alexa", !!D.status?.alexa?.on, D.status?.alexa?.on ? "On" : "Not set up") : ""}</div>`; } },
};
const todoRow = (t, del) => `<div class="wt${t.done ? " done" : ""}"><button type="button" data-wa="todo:${t.i}" aria-label="${t.done ? "Not done" : "Done"}">${t.done ? G.check : ""}</button><span>${esc(t.text)}</span>${del === true ? btn(`todox:${t.i}`, G.minus, "Remove") : ""}</div>`;
function tops(info) {
  const by = new Map();
  for (const p of info?.topByMemory || []) by.set(p.name, (by.get(p.name) || 0) + (Number(p.mb) || 0));
  const l = [...by].sort((a, b) => b[1] - a[1]).slice(0, 5), most = l[0]?.[1] || 1;
  return `<div class="wtops">${head("Using the most memory")}${l.map(([n, mb]) => `<div><span>${esc(n)}</span><i class="wbar"><b style="width:${Math.round((mb / most) * 100)}%"></b></i><em>${mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`}</em></div>`).join("") || none("Looking…")}</div>`;
}
export const SIZE_NAMES = { s: "Small", m: "Medium", l: "Large", w: "Wide", x: "Extra large" };
export const can = (id, screen) => !!W[id] && (!W[id].only || W[id].only.includes(screen));
export const nextSize = (id, size) => { const l = W[id]?.sizes || [size]; return l[(l.indexOf(size) + 1) % l.length]; };
// A phone is two across: the widest ones are drawn as the large ones are.
const onPhone = (it) => (it.size === "x" ? (W[it.id]?.sizes.includes("l") ? "l" : it.size) : it.size === "w" && it.id !== "music" ? (W[it.id]?.sizes.includes("m") ? "m" : it.size) : it.size);
export function drawItem(it, D, edit, phone) {
  const w = W[it.id];
  if (!w) return "";
  const own = w.sizes.includes(it.size) ? it.size : w.def, z = phone ? onPhone({ ...it, size: own }) : own;
  let body;
  try { body = w.draw(z, D, it); } catch { body = none("Not available right now"); }
  const tools = edit ? `<button type="button" class="we-x" data-we="x:${it.k}" aria-label="Remove ${w.label}">${G.minus}</button><div class="we-t">${w.sizes.length > 1 ? `<button type="button" data-we="z:${it.k}" aria-label="Change size">${SIZE_NAMES[own]}</button>` : ""}${w.form ? `<button type="button" data-we="f:${it.k}" aria-label="Options">Options</button>` : ""}</div>` : "";
  return `<div class="wg-i z-${z} w-${it.id}${w.bare ? " bare" : ""}" data-k="${it.k}" data-wid="${it.id}"${edit ? ' draggable="true"' : ` role="group" tabindex="0" aria-label="${esc(w.label)}"`}>${body}${tools}</div>`;
}
/** A screen's board: keeps the list and its data fresh, and says when there is something new to draw. */
export function createBoard({ screen, changed, music }) {
  const D = {}, at = {}, busy = {};
  let items = null, stamp = 0, posting = 0;
  const post = (body) => fetch("/api/board", { method: "POST", headers: { "content-type": "application/json", "x-hub": "1" }, body: JSON.stringify(body) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const list = () => (items || []).filter((x) => can(x.id, screen));
  async function ask(id) {
    if (busy[id]) return;
    busy[id] = 1;
    at[id] = Date.now();
    try {
      const r = await fetch(SOURCES[id][0], { cache: "no-store" });
      const v = r.ok ? await r.json() : null;
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
    refresh(more = []) {
      if (music) D.music = music();
      const need = new Set(["board", ...more]);
      for (const it of list()) for (const n of W[it.id]?.needs?.(it.size) || []) need.add(n);
      for (const n of need) if (SOURCES[n] && Date.now() - (at[n] || 0) > SOURCES[n][1]) ask(n);
    },
    ask,
    async set(next) { items = next; posting++; changed?.(); const r = await post({ screen, items: next }); posting--; if (r) D.board = r; changed?.(); return !!r; },
    async data(d) { const r = await post({ data: d }); if (r) { D.board = r; changed?.(); } return !!r; },
    html(edit) { if (music) D.music = music(); return list().map((it) => drawItem(it, D, edit, screen === "phone")).join(""); },
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
      if (k === "volume" || k === "brightness") { const was = D.music_?.[k] ?? 50, to = Math.max(0, Math.min(100, was + (v === "+" ? 10 : -10))); if (D.music_) D.music_[k] = to; changed?.(); send("/api/music/level", { what: k, value: to }); return true; }
      if (k === "tv") { v === "power" ? send("/api/tv/power", { on: "toggle" }) : send("/api/tv/command", { type: "key", name: v }); return true; }
      return false;
    },
  };
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
      if (old._src !== n.outerHTML) { old._src = n.outerHTML; if (old.className.replace(/ ?sel/, "") !== n.className) old.className = n.className; for (const a of ["draggable", "role", "tabindex", "aria-label"]) n.hasAttribute(a) ? old.setAttribute(a, n.getAttribute(a)) : old.removeAttribute(a); const img = old.querySelector(".wphoto"), img2 = n.querySelector(".wphoto"); if (!(img && img2 && img.src === img2.src && old.children.length === n.children.length)) old.innerHTML = n.innerHTML; }
      use = old;
    } else n._src = n.outerHTML;
    if (at === use) at = at.nextElementSibling;
    else grid.insertBefore(use, at);
  }
  for (const n of have.values()) n.remove();
}
