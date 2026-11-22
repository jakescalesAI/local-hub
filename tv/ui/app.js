// ============================================================================
// LocalHub TV — the Apple TV home screen, with LocalHub inside.
//
// Served by LocalHub at /tv/. On a Fire TV the LocalHub TV app shows this same page from the hub,
// signed in with its device key; on a laptop it's a browser window (npm run tv). Either way it's
// the hub's own: its wallpaper and style, the widgets chosen for the TV in the hub's Home editor
// (the TV view, next to Desktop, iPad and Mobile), and its assistant — the real tabs/chat.js, with
// the browser and every tool the hub's agent has, sharing conversations with the laptop.
//
// Layout and motion are tvOS: a Top Shelf for whatever the top row has in focus, a five-column
// grid of 16:10 icons that lift, tilt and catch the light, and a drop-down from the top right.
//
// What only a TV can do (its installed apps and their art, launching, HDMI inputs, its mic and
// voice) comes from Java through window.LocalHubNative. On a laptop, apps open their websites.
// ============================================================================

const NATIVE = typeof window.LocalHubNative === "object" && window.LocalHubNative ? window.LocalHubNative : null;
const IN_HUB = location.pathname.startsWith("/tv");
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const safeJson = (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } };
const native = (name, ...args) => {
  try { return NATIVE && typeof NATIVE[name] === "function" ? NATIVE[name](...args) : undefined; } catch (err) { console.warn(name, err); return undefined; }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── line icons, SF Symbols style ─────────────────────────────────────────── */
const sym = (d, w = 2) => `<svg class="sym" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const SYM = {
  gear: sym('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  input: sym('<path d="M4 7h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 7V4h8v3"/><path d="M12 17v4"/>'),
  power: sym('<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>'),
  wifi: sym('<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.8 12.4a9.2 9.2 0 0 1 12.4 0"/><path d="M9 15.7a4.6 4.6 0 0 1 6 0"/><circle cx="12" cy="19" r=".9" fill="currentColor"/>'),
  timer: sym('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9.5 2.5h5"/>'),
  moon: sym('<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>'),
  bt: sym('<path d="M7 7l10 10-5 4V3l5 4L7 17"/>'),
  mic: sym('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  sliders: sym('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  laptop: sym('<rect x="4" y="5" width="16" height="11" rx="1.6"/><path d="M2 19h20"/>'),
  chev: '<svg class="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5 6.5 7l-5 5.5"/></svg>',
};

/* ── apps ──────────────────────────────────────────────────────────────────
   On a laptop there are no installed TV apps, so these stand in, drawn as tvOS icons with Simple
   Icons (CC0) marks in ./brands, and opening one opens its website. On a TV the list and the art
   are the apps' own. */
const WEB_APPS = [
  { id: "netflix", name: "Netflix", bg: "#000000", fg: "#e50914", icon: "netflix", url: "https://www.netflix.com/browse", recent: 2 },
  { id: "youtube", name: "YouTube", bg: "#ffffff", fg: "#ff0000", icon: "youtube", url: "https://www.youtube.com/", recent: 26 },
  { id: "primevideo", name: "Prime Video", bg: "#00050d", fg: "#1aa8f0", icon: "primevideo", wide: true, url: "https://www.primevideo.com/", recent: 50 },
  { id: "disney", name: "Disney+", bg: "linear-gradient(160deg,#1f3fa3,#06123b)", fg: "#ffffff", letter: "Disney+", url: "https://www.disneyplus.com/" },
  { id: "max", name: "Max", bg: "linear-gradient(160deg,#002be7,#000d6b)", fg: "#ffffff", icon: "max", url: "https://play.max.com/" },
  { id: "appletv", name: "Apple TV", bg: "#000000", fg: "#ffffff", icon: "appletv", url: "https://tv.apple.com/" },
  { id: "plex", name: "Plex", bg: "#1f1f1f", fg: "#ebaf00", icon: "plex", url: "https://app.plex.tv/", recent: 72 },
  { id: "spotify", name: "Spotify", bg: "#121212", fg: "#1ed760", icon: "spotify", url: "https://open.spotify.com/", recent: 96 },
  { id: "hulu", name: "Hulu", bg: "#1ce783", fg: "#0b0c0f", letter: "hulu", url: "https://www.hulu.com/" },
  { id: "crunchyroll", name: "Crunchyroll", bg: "#f47521", fg: "#ffffff", icon: "crunchyroll", url: "https://www.crunchyroll.com/" },
  { id: "paramountplus", name: "Paramount+", bg: "linear-gradient(160deg,#0064ff,#002a8f)", fg: "#ffffff", icon: "paramountplus", url: "https://www.paramountplus.com/" },
  { id: "twitch", name: "Twitch", bg: "#9146ff", fg: "#ffffff", icon: "twitch", url: "https://www.twitch.tv/" },
  { id: "tubi", name: "Tubi", bg: "#7408ff", fg: "#ffff13", icon: "tubi", url: "https://tubitv.com/" },
  { id: "kodi", name: "Kodi", bg: "linear-gradient(160deg,#30c4f2,#0d6f9e)", fg: "#ffffff", icon: "kodi", url: "https://kodi.tv/" },
  { id: "steam", name: "Steam", bg: "linear-gradient(160deg,#2a475e,#171a21)", fg: "#ffffff", icon: "steam", url: "https://store.steampowered.com/" },
  { id: "vlc", name: "VLC", bg: "#ff8800", fg: "#ffffff", icon: "vlcmediaplayer", url: "https://www.videolan.org/vlc/" },
];
const DEMO_INPUTS = [
  { id: "hdmi1", name: "Apple TV 4K", sub: "HDMI 1" },
  { id: "hdmi2", name: "PlayStation 5", sub: "HDMI 2" },
];

/* ── prefs (this screen only; the look and widgets come from the hub) ──── */
const PREFS_KEY = "localhub.tv";
const DEFAULTS = { clock: "12-hour", inputs: true, saver: "5 min", effects: "Full", speak: "After voice", help: true };
let prefs = { ...DEFAULTS, ...(safeJson((() => { try { return localStorage.getItem(PREFS_KEY); } catch { return null; } })(), {}) || {}) };
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage off */ } };

/* ── state ─────────────────────────────────────────────────────────────── */
const COLS = 5;
const S = {
  zone: "grid",        // grid | status | bar
  i: 0,                // focused item
  overlay: null,       // null | cc | settings | modal | launch | saver
  cc: 0,
  set: 0,
  shelfId: null,
  flip: false,
  launched: null,
};
let ITEMS = [];
let APPS = [];
let INPUTS = [];
let SETTINGS = null;
const HUB = { on: false, name: "LocalHub", owner: "", paired: false, url: "", searching: false };

/* ── the hub's look, applied the way tabs/custom.js applies it ──────────── */
const STYLE_DEFAULT = { theme: "auto", accent: "system", widgetLook: "glass", blur: 20, transparency: 30, radius: 20, shadow: "soft", tabBar: "glass", effect: "none", font: "system", density: "regular" };
const BUILTIN_WALLS = { aurora: "dark", dusk: "dark", graphite: "dark", ocean: "dark", sand: "light", "mono-light": "light", "mono-dark": "dark", noise: "light" };
const hexRgb = (h) => { h = h.replace("#", ""); if (h.length === 3) h = h.replace(/./g, (c) => c + c); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); };
const lum = (h) => { const [r, g, b] = hexRgb(h).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const gradCss = (g) => {
  const [a, b, c = g.colors[0]] = g.colors;
  return g.mesh
    ? `radial-gradient(at 14% 18%, ${a} 0, transparent 58%), radial-gradient(at 86% 24%, ${b} 0, transparent 56%), radial-gradient(at 52% 100%, ${c} 0, transparent 62%), linear-gradient(${g.angle}deg, ${a}, ${b})`
    : `linear-gradient(${g.angle}deg, ${g.colors.join(", ")})`;
};
function wallFor(s) {
  const id = s?.wallpaper?.current ?? "aurora";
  if (!id || id === "none") return null;
  if (BUILTIN_WALLS[id]) return { image: `url("./wallpapers/${id}.svg")`, tone: BUILTIN_WALLS[id] };
  const g = (s.wallpaper.custom || []).find((w) => w.id === id);
  if (g) return { image: gradCss(g), tone: g.colors.reduce((t, c) => t + lum(c), 0) / g.colors.length < 0.4 ? "dark" : "light" };
  const u = (s.wallpaper.uploads || []).find((w) => w.id === id);
  if (u && IN_HUB) return { image: `url("/api/hub/wallpapers/${u.file}")`, tone: "" };
  return { image: 'url("./wallpapers/aurora.svg")', tone: "dark" };
}
function applyLook() {
  const st = { ...STYLE_DEFAULT, ...(SETTINGS?.style || {}) };
  const r = document.documentElement;
  // A TV is a dark room, and tvOS is dark: "auto" means dark here.
  const theme = st.theme === "auto" ? "dark" : st.theme;
  r.setAttribute("data-theme", theme);
  r.style.colorScheme = theme;
  if (st.accent === "system") r.style.removeProperty("--blue"); else r.style.setProperty("--blue", st.accent);
  r.dataset.look = st.widgetLook;
  r.dataset.shadow = st.shadow;
  r.dataset.effect = st.effect;
  r.dataset.font = st.font;
  r.style.setProperty("--hub-blur", `${st.blur}px`);
  r.style.setProperty("--hub-alpha", `${100 - st.transparency}%`);
  r.style.setProperty("--hub-radius", `${st.radius}px`);
  r.classList.toggle("lite", prefs.effects === "Light");
  const w = wallFor(SETTINGS);
  const wall = $("#hub-wall");
  if (!w) { delete r.dataset.wall; wall.style.backgroundImage = ""; $("#saverWall").style.backgroundImage = ""; return; }
  r.dataset.wall = "1";
  wall.style.backgroundImage = w.image;
  $("#saverWall").style.backgroundImage = w.image;
  r.style.setProperty("--hub-scrim", w.tone ? (w.tone === theme ? ".18" : ".55") : ".4");
  if (S.shelfId === "hub") paintShelf(true);
}

async function syncHub() {
  if (!IN_HUB) { applyLook(); return; }
  try {
    const r = await fetch("/api/hub/settings", { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const next = await r.json();
    const sig = (s) => JSON.stringify([s?.style, s?.wallpaper, s?.widgets?.tv]);
    const changed = sig(next) !== sig(SETTINGS);
    SETTINGS = next;
    HUB.on = true;
    if (changed) applyLook();
  } catch {
    HUB.on = false;
  }
  HUB.name = window.HUB_CONF?.name || HUB.name;
  HUB.owner = window.HUB_CONF?.owner || "";
  paintChip();
}
function paintChip() {
  $("#splashName").textContent = HUB.name;
  const g = $("#gearBtn");
  g.classList.toggle("on", HUB.on);
  g.title = `${HUB.name}: ${HUB.on ? "connected" : "not connected"}`;
}

/* ── the items: LocalHub first, then the apps, the inputs, Settings ────── */

function loadItems() {
  if (NATIVE) {
    APPS = safeJson(native("apps") || "[]", []).map((a) => ({
      id: a.id, pkg: a.id, name: a.name, banner: a.banner || null, img: a.icon || null,
      bg: a.color || "#2c2c2e", fg: "#ffffff", recentAt: a.recent || 0,
    }));
    INPUTS = safeJson(native("inputs") || "[]", []);
  } else {
    const now = Date.now();
    const opened = safeJson((() => { try { return localStorage.getItem("localhub.tv.opened"); } catch { return null; } })(), {}) || {};
    APPS = WEB_APPS.map((a) => ({ ...a, recentAt: opened[a.id] || (a.recent ? now - a.recent * 3600e3 : 0) }));
    INPUTS = DEMO_INPUTS;
  }
  if (!prefs.inputs) INPUTS = [];
  const byRecent = [...APPS].sort((a, b) => (b.recentAt || 0) - (a.recentAt || 0) || a.name.localeCompare(b.name));
  const top = byRecent.slice(0, COLS - 1);
  const rest = APPS.filter((a) => !top.includes(a)).sort((a, b) => a.name.localeCompare(b.name));
  ITEMS = [
    { id: "hub", kind: "hub", name: HUB.name },
    ...top,
    ...rest,
    ...INPUTS.map((i) => ({ ...i, kind: "input" })),
    { id: "settings", kind: "settings", name: "Settings" },
  ];
  S.i = clamp(S.i, 0, ITEMS.length - 1);
}

function iconHTML(it) {
  if (it.kind === "hub") return `<div class="icon hub"><img src="./hub.svg" alt=""></div>`;
  if (it.kind === "settings") return `<div class="icon" style="--a-bg:linear-gradient(160deg,#8e8e93,#3a3a3c);--a-fg:#fff">${SYM.gear}</div>`;
  if (it.kind === "input") return `<div class="icon" style="--a-bg:linear-gradient(160deg,#2c2c2e,#0b0b0d);--a-fg:#fff">${SYM.input}<span class="sub">${esc(it.sub || "HDMI")}</span></div>`;
  const colors = `--a-bg:${it.bg};--a-fg:${it.fg}`;
  const fill = '<i class="fill"></i>';
  if (it.banner) return `<div class="icon" style="${colors}"><img src="${esc(it.banner)}" alt="" decoding="async"></div>`;
  if (it.img) return `<div class="icon" style="${colors}">${fill}<img class="square" src="${esc(it.img)}" alt="" decoding="async"></div>`;
  if (it.icon) return `<div class="icon" style="${colors}">${fill}<i class="glyph${it.wide ? " wide" : ""}" style="--glyph:url('./brands/${it.icon}.svg')"></i></div>`;
  return `<div class="icon" style="${colors}">${fill}<b class="letter"${it.letter && it.letter.length > 4 ? ' style="font-size:58px"' : ""}>${esc(it.letter || it.name.slice(0, 1))}</b></div>`;
}

function renderGrid() {
  $("#grid").innerHTML = ITEMS.map((it, i) => `<div class="app" data-i="${i}">${iconHTML(it)}<span class="name">${esc(it.name)}</span></div>`).join("");
  applyFocus(true);
}

/* ── focus: the tvOS lift, tilt and glare ──────────────────────────────── */

function applyFocus(instant) {
  document.querySelectorAll(".app.is-focused").forEach((n) => n.classList.remove("is-focused"));
  $("#gearBtn").classList.toggle("focus", S.zone === "status" && !S.overlay);
  $("#pairbar").classList.toggle("focus", S.zone === "bar" && !S.overlay);
  if (S.zone === "grid" && !S.overlay) $(`.app[data-i="${S.i}"]`)?.classList.add("is-focused");

  const row = Math.floor(S.i / COLS);
  const inGrid = S.zone === "grid" && row > 0;
  document.body.classList.toggle("in-grid", inGrid || (S.zone === "bar" && !atTop()));
  // Row 0 sits on the Top Shelf. Further down, the focused row rides about a third of the way up.
  const y = inGrid ? -(648 + row * 252 - 400) : 0;
  const page = $("#page");
  if (instant) page.style.transition = "none";
  page.style.transform = `translateY(${y}px)`;
  if (instant) requestAnimationFrame(() => { page.style.transition = ""; });
  if (S.zone === "grid" && row === 0) paintShelf();
}
const atTop = () => Math.floor(S.i / COLS) === 0;

function tilt(dx, dy) {
  const icon = $(`.app[data-i="${S.i}"] .icon`);
  if (!icon) return;
  icon.style.setProperty("--ry", `${dx * 7}deg`);
  icon.style.setProperty("--rx", `${-dy * 7}deg`);
  icon.style.setProperty("--gx", `${dx * 25}%`);
  icon.style.setProperty("--gy", `${-30 + dy * 25}%`);
  clearTimeout(tilt.t);
  tilt.t = setTimeout(() => {
    icon.style.setProperty("--ry", "0deg");
    icon.style.setProperty("--rx", "0deg");
    icon.style.setProperty("--gx", "0%");
    icon.style.setProperty("--gy", "-30%");
  }, 260);
}

function move(dx, dy) {
  if (S.zone === "status") {
    if (dy > 0) { S.zone = "grid"; return applyFocus(); }
    return;
  }
  if (S.zone === "bar") {
    if (dy < 0) { leaveBar(); S.zone = "grid"; return applyFocus(); }
    return;
  }
  const n = ITEMS.length;
  const row = Math.floor(S.i / COLS);
  const lastRow = Math.floor((n - 1) / COLS);
  if (dx) {
    const next = S.i + dx;
    if (next >= 0 && next < n && Math.floor(next / COLS) === row) S.i = next;
    else return tilt(dx * 1.6, 0); // the edge: lean into it, like tvOS
  }
  if (dy < 0) {
    if (row === 0) { S.zone = "status"; return applyFocus(); }
    S.i -= COLS;
  }
  if (dy > 0) {
    if (row === lastRow) return focusBar();
    S.i = Math.min(S.i + COLS, n - 1);
  }
  applyFocus();
  tilt(dx, dy);
}

/* ── the Top Shelf ─────────────────────────────────────────────────────── */

function paintShelf(force) {
  const it = ITEMS[S.i];
  if (!it || (!force && it.id === S.shelfId)) return;
  S.shelfId = it.id;
  document.body.classList.toggle("shelf-hub", it.kind === "hub");
  const on = $(S.flip ? "#shelfA" : "#shelfB");
  const off = $(S.flip ? "#shelfB" : "#shelfA");
  S.flip = !S.flip;

  if (it.kind === "hub") {
    on.innerHTML = ""; // the hub's own wallpaper shows through
  } else if (it.banner) {
    on.innerHTML = `<div class="bg blur" style="background-image:url('${esc(it.banner)}')"></div><div class="poster" style="background-image:url('${esc(it.banner)}')"></div>`;
  } else if (it.kind === "app") {
    on.innerHTML = "";
  } else {
    const tone = it.bg && !String(it.bg).includes("gradient") ? it.bg : null;
    const fg = it.fg || "#fff";
    const glow = tone && tone !== "#000000" && tone !== "#ffffff" ? tone : fg;
    on.innerHTML = `<div class="bg" style="background:radial-gradient(70% 90% at 78% 30%, ${hexA(glow, 0.6)}, transparent 62%), radial-gradient(60% 70% at 10% 100%, ${hexA(glow, 0.22)}, transparent 70%), rgba(5,6,10,.5)"></div>${
      it.icon ? `<i class="glyph${it.wide ? " wide" : ""}" style="--glyph:url('./brands/${it.icon}.svg');color:${fg === "#ffffff" ? "#fff" : fg}"></i>` : ""}`;
  }
  on.classList.add("on");
  off.classList.remove("on");

  const body = $("#shelfBody");
  body.innerHTML = it.kind === "hub" ? hubShelfHTML() : appShelfHTML(it);
  body.classList.remove("swap");
  void body.offsetWidth;
  body.classList.add("swap");
}

function hexA(c, a) {
  if (!/^#[0-9a-f]{3,8}$/i.test(c)) return `rgba(10,132,255,${a})`;
  const [r, g, b] = hexRgb(c).map((v) => Math.round(v * 255));
  return `rgba(${r},${g},${b},${a})`;
}

/* The header is the app's banner in white, like tvOS: Prime Video's long wordmark where the app
   has one, and otherwise its name set large as the wordmark. No icon, no caption. */
function appShelfHTML(it) {
  const mark = it.icon && it.wide && !it.banner
    ? `<i class="banner-mark" style="--glyph:url('./brands/${it.icon}.svg')"></i>`
    : `<h1 class="banner-text">${esc(it.name)}</h1>`;
  return `<div class="shelf-title" aria-label="${esc(it.name)}">${mark}</div>`;
}

/* The LocalHub tile: a greeting and the widgets picked for the TV in the hub's Home editor. */
const ZONES = () => (window.HUB_CONF?.worldClock?.length ? window.HUB_CONF.worldClock : [["New York", "America/New_York"], ["London", "Europe/London"]]);
const zoneTime = (tz) => { try { return new Date().toLocaleTimeString(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit" }); } catch { return "–"; } };
const WIDGETS = {
  clock: { label: "Clock & date", tint: "var(--blue)", render() {
    const t = clockParts(new Date());
    return `<div class="w-clock"><div class="v">${t.hm}${t.ap ? `<small>${t.ap}</small>` : ""}</div><div class="d">${esc(new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))}</div></div>`;
  } },
  date: { label: "Date", tint: "var(--red)", render() {
    const n = new Date();
    return `<div class="w-date"><div class="wd">${esc(n.toLocaleDateString(undefined, { weekday: "long" }))}</div><div class="n">${n.getDate()}</div><div class="m">${esc(n.toLocaleDateString(undefined, { month: "long", year: "numeric" }))}</div></div>`;
  } },
  "world-clock": { label: "World clock", tint: "var(--orange)", render() {
    return `<div class="w-list">${ZONES().slice(0, 3).map(([n, tz]) => `<div class="w-row"><span class="t">${esc(n)}</span><span class="v">${esc(zoneTime(tz))}</span></div>`).join("")}</div>`;
  } },
  recent: { label: "Recently opened", tint: "var(--green)", wide: true, render() {
    const list = [...APPS].filter((a) => a.recentAt).sort((a, b) => b.recentAt - a.recentAt).slice(0, 3);
    if (!list.length) return `<div class="w-empty">Apps you open here show up in this card.</div>`;
    return `<div class="w-list">${list.map((a) => `<div class="w-row"><span class="mini" style="--a-bg:${a.bg};--a-fg:${a.fg}">${miniArt(a)}</span><span class="t">${esc(a.name)}</span><span class="s">${esc(ago(a.recentAt))}</span></div>`).join("")}</div>`;
  } },
};
const LABELS = { "next-event": "Next event", "claude-usage": "Claude usage", tokens: "Tokens", today: "Today", coolify: "Coolify", services: "Services", "server-health": "Server", drives: "Drives", "stripe-balance": "Stripe", icloud: "iCloud" };

function tvWidgets() {
  const layout = SETTINGS?.widgets?.tv?.length ? SETTINGS.widgets.tv : [{ id: "clock" }, { id: "date" }, { id: "world-clock" }];
  return layout.filter((w) => w.id !== "app").map((w) => w.id);
}
function widgetCard(id) {
  const def = WIDGETS[id];
  if (!def) return `<div class="w card"><div class="w-label"><i class="dot"></i>${esc(LABELS[id] || id)}</div><div class="w-body"><div class="w-empty">Shown on LocalHub. TV support is coming.</div></div></div>`;
  return `<div class="w card${def.wide ? " wide" : ""}"><div class="w-label"><i class="dot" style="--c:${def.tint}"></i>${esc(def.label)}</div><div class="w-body">${def.render()}</div></div>`;
}
function hubShelfHTML() {
  const h = new Date().getHours();
  const part = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const first = (HUB.owner || "").split(/\s+/)[0];
  // The time and date are always top left, so their cards aren't repeated here.
  const ids = tvWidgets().filter((id) => id !== "clock" && id !== "date" && (WIDGETS[id] || LABELS[id])).slice(0, 3);
  return `<div class="hub-shelf"><div class="greet"><h1>${esc(part)}${first ? `, ${esc(first)}` : ""}</h1></div><div class="widgets">${[...ids.map(widgetCard), widgetCard("recent")].join("")}</div></div>`;
}

function miniArt(a) {
  if (a.img) return `<img src="${esc(a.img)}" alt="">`;
  if (a.icon) return `<i class="glyph" style="--glyph:url('./brands/${a.icon}.svg')"></i>`;
  return `<b style="font:800 18px var(--display);color:${a.fg}">${esc((a.letter || a.name).slice(0, 1))}</b>`;
}
function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/* ── the assistant bar: the hub's own tabs/chat.js ─────────────────────── */
const chatHost = () => document.getElementById("hub-chat");
const chatInput = () => chatHost()?.shadowRoot?.querySelector(".bta");
function focusBar() {
  S.zone = "bar";
  applyFocus();
  const ta = chatInput();
  if (ta) { ta.focus(); native("setTyping", true); }
}
function leaveBar() {
  chatInput()?.blur();
  native("setTyping", false);
}

/* ── opening things ────────────────────────────────────────────────────── */

function activate() {
  if (S.zone === "status") return openCC();
  if (S.zone === "bar") return HUB.on ? focusBar() : openPairing();
  const it = ITEMS[S.i];
  if (!it) return;
  if (it.kind === "hub") return openHubApp();
  if (it.kind === "settings") return openSettings();
  if (it.kind === "input") return launch(it, () => (NATIVE ? native("switchInput", it.id) : true), `Switching to ${it.name}`);
  return launch(it, () => openApp(it));
}

/* On a TV, Java starts the app. On a laptop, the website opens in a new window; when you come
   back to this one, the icon settles back into the grid. */
function openApp(app) {
  if (NATIVE) return native("launch", app.pkg) !== false;
  if (!app.url) return false;
  const w = window.open(app.url, "_blank", "noopener");
  remember(app);
  if (!w && !document.hidden) {
    // A window opened from a laptop's own keypress always works; one asked for by Alexa or the
    // agent may be blocked by the browser. Then one press of Enter does it.
    S.pendingOpen = app;
    toast(`Press Enter to open ${app.name}`);
    return "pending";
  }
  return true;
}
function remember(app) {
  app.recentAt = Date.now();
  if (NATIVE) return;
  const opened = safeJson((() => { try { return localStorage.getItem("localhub.tv.opened"); } catch { return null; } })(), {}) || {};
  opened[app.id] = app.recentAt;
  try { localStorage.setItem("localhub.tv.opened", JSON.stringify(opened)); } catch { /* storage off */ }
}

function launch(it, go, note) {
  const node = $(`.app[data-i="${ITEMS.indexOf(it)}"] .icon`) || $(".app.is-focused .icon");
  const stage = $("#stage").getBoundingClientRect();
  const k = stage.width / 1920;
  const r = node ? node.getBoundingClientRect() : { left: stage.left + 810 * k, top: stage.top + 450 * k, width: 300 * k, height: 180 * k };
  const layer = $("#launch");
  layer.querySelector(".icon")?.remove();
  const holder = document.createElement("div");
  holder.innerHTML = iconHTML(it);
  const icon = holder.firstElementChild;
  Object.assign(icon.style, { left: `${(r.left - stage.left) / k}px`, top: `${(r.top - stage.top) / k}px`, width: `${r.width / k}px`, height: `${r.height / k}px`, transition: "none" });
  layer.prepend(icon);
  $("#launchNote").textContent = NATIVE ? "" : note ? `${note} — on a TV this switches the input` : it.url ? `Opening ${it.name} in a new window…` : `${it.name} isn't on this laptop`;
  setOverlay("launch");
  layer.classList.add("on");
  requestAnimationFrame(() => requestAnimationFrame(() => { icon.style.transition = ""; layer.classList.add("full"); }));
  setTimeout(() => {
    const ok = go();
    if (NATIVE && ok !== false) return; // haven.resumed() tidies up when we're back
    if (ok === false && it.url === undefined && it.kind !== "input" && !NATIVE) { setTimeout(endLaunch, 1100); return; }
    if (ok === false) toast(`${it.name} didn't start`);
    setTimeout(endLaunch, ok === "pending" ? 300 : document.hidden ? 0 : 1300);
  }, 520);
}
function endLaunch() {
  const layer = $("#launch");
  if (!layer.classList.contains("on")) return;
  layer.classList.remove("full", "on");
  if (S.overlay === "launch") setOverlay(null);
  const keep = ITEMS[S.i]?.id;
  loadItems();
  S.i = Math.max(0, ITEMS.findIndex((x) => x.id === keep));
  S.shelfId = null;
  renderGrid();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) endLaunch(); });

/* ── LocalHub, opened as an app ──────────────────────────────────────────
   The LocalHub tile opens the whole hub, full screen, growing out of its tile like any app. It
   lands on Home's TV view, so what the TV shows is right there to edit (Edit → add, move, remove).
   Back (or the TV button, or the hub's own TV app) comes back here, and the TV picks up the change. */
function openHubApp(where = "/?view=tv#home") {
  if (!IN_HUB) return toast(NATIVE ? "Pair this TV with LocalHub first" : "Open this from LocalHub to open the hub");
  const app = $("#hubApp");
  const frame = $("#hubFrame");
  const tile = $(`.app[data-i="${S.i}"] .icon`)?.getBoundingClientRect();
  if (tile) {
    app.style.setProperty("--ox", `${tile.left + tile.width / 2}px`);
    app.style.setProperty("--oy", `${tile.top + tile.height / 2}px`);
  }
  if (frame.getAttribute("src") !== where) frame.src = where;
  else { try { frame.contentWindow.HUB?.refresh?.(); } catch { /* not loaded yet */ } }
  leaveBar();
  window.HubVoice?.hush?.();
  document.body.classList.add("hub-open");
  setOverlay("hub");
  requestAnimationFrame(() => app.classList.add("on"));
  native("setTyping", true); // the remote's arrows and OK belong to the hub page now; Back still comes here
  setTimeout(() => { try { frame.focus(); } catch { /* fine */ } }, 400);
}

function closeHub() {
  if (S.overlay !== "hub") return;
  $("#hubApp").classList.remove("on");
  document.body.classList.remove("hub-open");
  native("setTyping", false);
  S.zone = "grid";
  setOverlay(null);
  window.focus();
  syncHub(); // the TV layout or the look may have just changed
}
$("#hubDone").addEventListener("click", closeHub);
$("#hubFrame").addEventListener("load", () => {
  // Esc with nothing open in the hub comes back to the TV.
  try {
    const doc = $("#hubFrame").contentDocument;
    doc.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const busy = doc.activeElement && doc.activeElement !== doc.body;
      if (!busy && !doc.querySelector("dialog[open], .sheet.on, .menu.on")) closeHub();
    });
  } catch { /* cross-origin can't happen: it's the same hub */ }
});

/* ── overlays ──────────────────────────────────────────────────────────── */

function setOverlay(name) {
  S.overlay = name;
  document.body.classList.toggle("overlay", name === "settings");
  applyFocus();
}

/* Control Center, from the gear at the top right. Everything in it is real: the hub's live state,
   your actual recent chats, and things that do something. TV hardware (sleep, inputs, Wi-Fi,
   Bluetooth) only shows on a TV, where it works. */
const LIVE = { status: null, info: null, chats: null };
async function refreshLive() {
  if (!IN_HUB) return;
  const get = (u) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [status, info, chats] = await Promise.all([get("/api/tv/status"), get("/api/chat/info"), get("/api/chat/sessions")]);
  LIVE.status = status;
  LIVE.info = info;
  LIVE.chats = chats?.sessions || [];
}

function voiceState() {
  const w = String(LIVE.status?.whisper || "");
  if (NATIVE) return w === "ready" ? ["TV mic → Whisper", "var(--green)"] : w.startsWith("missing") ? ["Needs Whisper on the laptop", "var(--orange)"] : ["TV mic → Whisper", "var(--green)"];
  if (w === "ready") return ["Whisper, on this computer", "var(--green)"];
  if (w === "loading") return ["Whisper is loading", "var(--orange)"];
  if (w.startsWith("missing")) return ["Browser dictation", "var(--orange)"];
  return ["Whisper, starts when you talk", "var(--green)"];
}

function ccTiles() {
  const tiles = [];
  const [voice, voiceTint] = voiceState();
  const ready = LIVE.info ? LIVE.info.ready !== false : HUB.on;
  tiles.push({
    id: "hub", cls: "status-tile",
    html: `<img src="./hub.svg" alt=""><div><div class="t1">${esc(HUB.name)}</div><div class="lines">
      <span class="k">Hub</span><span class="v"><i style="--c:${HUB.on ? "var(--green)" : "var(--red)"}"></i>${HUB.on ? "Connected" : "Not connected"}</span>
      <span class="k">Assistant</span><span class="v"><i style="--c:${ready ? "var(--green)" : "var(--red)"}"></i>${ready ? "Ready" : "Needs Claude Code"}</span>
      <span class="k">Voice</span><span class="v"><i style="--c:${voiceTint}"></i>${esc(voice)}</span>
    </div></div>`,
  });
  tiles.push({ id: "ask", cls: "w2", ic: SYM.mic, t1: "Ask LocalHub", t2: NATIVE ? "⏯ on the remote" : "Space on the keyboard" });
  tiles.push({ id: "tvlayout", cls: "w2", ic: SYM.sliders, t1: "TV layout", t2: "Pick what shows here" });
  const chats = (LIVE.chats || []).slice(0, 3);
  if (chats.length) {
    tiles.push({ sect: "Recent chats" });
    for (const c of chats) tiles.push({ id: `chat:${c.id}`, cls: "w4 chat", ic: CHAT_IC, t1: c.title || "Chat", t2: c.running ? "Answering now" : ago(c.updated) });
  }
  tiles.push({ sect: NATIVE ? "This TV" : "This screen" });
  tiles.push({ id: "saver", cls: "w2", ic: SYM.moon, t1: "Screensaver", t2: "Start now" });
  tiles.push({ id: "settings", cls: "w2", ic: SYM.gear, t1: "Settings", t2: "LocalHub TV" });
  if (NATIVE) {
    const net = safeJson(native("network"), {}) || {};
    tiles.push({ id: "sleep", cls: "w2", ic: SYM.power, t1: "Sleep", t2: "Turn the TV off" });
    tiles.push({ id: "timer", cls: "w2" + (S.sleepAt ? " on" : ""), ic: SYM.timer, t1: "Sleep Timer", t2: S.sleepAt ? `At ${clockText(new Date(S.sleepAt))}` : "Off" });
    if (INPUTS.length) tiles.push({ id: "inputs", cls: "w2", ic: SYM.input, t1: "Inputs", t2: `${INPUTS.length} on this TV` });
    tiles.push({ id: "net", cls: "w2" + (net.connected ? " on" : ""), ic: SYM.wifi, t1: net.kind || "Network", t2: net.connected ? "Connected" : "Offline" });
    tiles.push({ id: "bt", cls: "w2", ic: SYM.bt, t1: "Bluetooth", t2: "Headphones, remotes" });
    tiles.push({ id: "system", cls: "w2", ic: SYM.sliders, t1: "TV Settings", t2: "Fire TV" });
  } else {
    tiles.push({ id: "dashboard", cls: "w2", ic: SYM.laptop, t1: "LocalHub", t2: "The full dashboard" });
    tiles.push({ id: "tvsetup", cls: "w2", ic: SYM.input, t1: "Set up a TV", t2: "Install, connect, pair" });
    tiles.push({ id: "help", cls: "w2", ic: KEY_IC, t1: "Keyboard", t2: prefs.help ? "Hide the keys" : "Show the keys" });
  }
  return tiles;
}
const CHAT_IC = sym('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>');
const KEY_IC = sym('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>');

let CC = [];
function paintTiles() {
  CC = ccTiles();
  let n = 0;
  $("#ccGrid").innerHTML = CC.map((t) => {
    if (t.sect) return `<div class="cc-sect">${esc(t.sect)}</div>`;
    const i = n++;
    t.i = i;
    if (t.html) return `<div class="cc-tile ${t.cls}" data-i="${i}">${t.html}</div>`;
    return `<div class="cc-tile ${t.cls}" data-i="${i}"><span class="ic">${t.ic}</span><span style="min-width:0"><div class="t1">${esc(t.t1)}</div><div class="t2">${esc(t.t2)}</div></span></div>`;
  }).join("");
  CC = CC.filter((t) => !t.sect);
  S.cc = clamp(S.cc, 0, CC.length - 1);
  paintCC();
}
function openCC() {
  S.cc = 0;
  paintTiles();
  $("#cc").classList.add("on");
  $("#scrim").classList.add("on");
  document.body.classList.add("cc-open");
  setOverlay("cc");
  // The hub's live state and your chats, fresh each time it opens.
  refreshLive().then(() => { if (S.overlay === "cc") { const keep = CC[S.cc]?.id; paintTiles(); const k = CC.findIndex((t) => t.id === keep); if (k >= 0) { S.cc = k; paintCC(); } } });
}
function closeCC() {
  $("#cc").classList.remove("on");
  $("#scrim").classList.remove("on");
  document.body.classList.remove("cc-open");
  if (S.zone === "status") S.zone = "grid";
  setOverlay(null);
}
function paintCC() {
  document.querySelectorAll(".cc-tile[data-i]").forEach((n) => n.classList.toggle("is-sel", Number(n.dataset.i) === S.cc));
  // The sheet scrolls when it holds more than fits; keep the selection in view.
  document.querySelector(".cc-tile.is-sel")?.scrollIntoView({ block: "nearest" });
}
function ccMove(dx, dy) {
  const tiles = [...document.querySelectorAll(".cc-tile[data-i]")];
  const a = tiles[S.cc]?.getBoundingClientRect();
  if (!a) return;
  let best = S.cc, score = Infinity;
  tiles.forEach((n, i) => {
    if (i === S.cc) return;
    const b = n.getBoundingClientRect();
    const ddx = b.left + b.width / 2 - (a.left + a.width / 2);
    const ddy = b.top + b.height / 2 - (a.top + a.height / 2);
    if ((dx && Math.sign(ddx) !== dx) || (dy && Math.sign(ddy) !== dy) || (dx && Math.abs(ddx) < 4) || (dy && Math.abs(ddy) < 4)) return;
    const s = (dx ? Math.abs(ddx) : Math.abs(ddy)) + (dx ? Math.abs(ddy) : Math.abs(ddx)) * 2.2;
    if (s < score) { score = s; best = i; }
  });
  if (dy < 0 && best === S.cc) return closeCC();
  S.cc = best;
  paintCC();
}
function ccActivate() {
  const id = CC[S.cc]?.id || "";
  if (id === "timer") return cycleSleepTimer();
  if (id === "help") { prefs.help = !prefs.help; savePrefs(); showKeys(prefs.help); return paintTiles(); }
  closeCC();
  if (id === "hub" || id === "tvlayout" || id === "dashboard") return openHubApp();
  if (id === "tvsetup") return openHubApp("/#tv-setup");
  if (id === "ask") return startVoice();
  if (id.startsWith("chat:")) { if (window.HubChat?.openChat) { S.zone = "bar"; return window.HubChat.openChat(id.slice(5)); } return toast("The chat isn't loaded"); }
  if (id === "inputs") { const i = ITEMS.findIndex((x) => x.kind === "input"); if (i < 0) return toast("This TV reports no HDMI inputs"); S.zone = "grid"; S.i = i; return applyFocus(); }
  if (id === "saver") return startSaver();
  if (id === "sleep") return sleepNow();
  if (id === "net") return native("openNetworkSettings");
  if (id === "bt") return native("openBluetoothSettings");
  if (id === "system") return native("openSystemSettings");
  if (id === "settings") return openSettings();
}
function sleepNow() {
  if (!NATIVE) return toast("A TV would go to sleep now");
  if (native("sleep") === false) toast("Sleep needs the LocalHub home-button service");
}
const TIMER_STEPS = [0, 30, 60, 90, 120];
function cycleSleepTimer() {
  const left = S.sleepAt ? Math.round((S.sleepAt - Date.now()) / 60000) : 0;
  const next = TIMER_STEPS.find((m) => m > left + 1) || 0;
  clearTimeout(S.sleepTimer);
  S.sleepAt = next ? Date.now() + next * 60000 : 0;
  if (next) S.sleepTimer = setTimeout(sleepNow, next * 60000);
  toast(next ? `Sleeping in ${next} minutes` : "Sleep timer off");
  paintTiles();
}

/* Settings: tvOS — the icon on the left, the list on the right */
function settingsModel() {
  const st = NATIVE ? safeJson(native("status"), {}) : {};
  const hubRows = NATIVE
    ? [
      { id: "find", t1: "LocalHub", t2: HUB.url ? HUB.url.replace(/^https?:\/\//, "") : "Look for it on this network", v: HUB.searching ? "Searching…" : HUB.on ? "Connected" : HUB.url ? "Not answering" : "Search" },
      { id: "address", t1: "Address", t2: "If searching can't find it, e.g. 192.168.1.20:3100", v: "" },
      { id: "pair", t1: "Pair this TV", t2: "On the laptop open localhost:3100/pair/new", v: HUB.paired ? "Paired" : "Not paired", on: HUB.paired },
      { id: "forget", t1: "Forget LocalHub", t2: "Removes this TV's device key", v: "" },
    ]
    : [{ info: true, t1: "LocalHub", t2: IN_HUB ? "This screen is served by LocalHub" : "Open it from LocalHub at /tv/", v: HUB.on ? "Connected" : "Not connected", on: HUB.on },
       ...(IN_HUB ? [{ id: "tvsetup", t1: "Set up a TV", t2: "Put LocalHub TV on a television and pair it", v: "" }] : [])];
  return [
    { title: "Settings" },
    { group: "Home Screen" },
    { key: "clock", t1: "Clock", t2: "Top left, and on the screensaver", values: ["12-hour", "24-hour"] },
    { key: "inputs", t1: "HDMI inputs", t2: "Shown as icons after the apps", toggle: true },
    { key: "saver", t1: "Screensaver", t2: "After the remote has been still", values: ["Off", "2 min", "5 min", "10 min", "15 min"] },
    { key: "effects", t1: "Liquid glass", t2: "Light drops the blur, for older Fire TV sticks", values: ["Full", "Light"] },
    { id: "look", t1: "Wallpaper, style and widgets", t2: "Opens LocalHub, where you change the TV", v: SETTINGS?.wallpaper?.current ? cap(SETTINGS.wallpaper.current) : "Aurora" },
    { group: "Assistant" },
    ...hubRows,
    { key: "speak", t1: "Read answers aloud", t2: NATIVE ? "With the TV's voice" : "With this computer's voice", values: ["After voice", "Always", "Off"] },
    { info: true, t1: "Alexa", t2: "“Alexa, ask local hub to open Netflix”", v: "tv/alexa" },
    ...(!NATIVE ? [{ key: "help", t1: "Keyboard help", t2: "The remote's keys, along the top", toggle: true }] : []),
    { group: "About" },
    ...(NATIVE ? [{ info: true, t1: "Home button", t2: "Brings LocalHub back when Home is pressed", v: st.homeService ? "On" : "Off", on: st.homeService }] : []),
    { info: true, t1: "Version", t2: NATIVE ? "LocalHub TV for Fire TV" : "LocalHub TV on this laptop", v: NATIVE ? st.version || "?" : LIVE.status?.version ? `LocalHub ${LIVE.status.version}` : "LocalHub" },
  ];
}
const cap = (s) => String(s).replace(/(^|-)(\w)/g, (_, a, b) => (a ? " " : "") + b.toUpperCase());
const selectable = (it) => it && !it.group && !it.info && !it.title;
const valueOf = (it) => (it.toggle ? (prefs[it.key] ? "On" : "Off") : it.values ? prefs[it.key] : it.v ?? "");
function renderSettings() {
  const model = (S.setModel = settingsModel());
  $("#setTrack").innerHTML = model.map((it, i) => {
    if (it.title) return `<h1 class="set-title">${esc(it.title)}</h1>`;
    if (it.group) return `<div class="set-group">${esc(it.group)}</div>`;
    const v = valueOf(it);
    return `<div class="row${it.info ? " info" : ""}" data-i="${i}"><div class="txt"><div class="t1">${esc(it.t1)}</div>${it.t2 ? `<div class="t2">${esc(it.t2)}</div>` : ""}</div><div class="v${it.on || v === "On" ? " on" : ""}">${esc(v)}${SYM.chev}</div></div>`;
  }).join("");
  if (!selectable(model[S.set])) S.set = model.findIndex(selectable);
  paintSettings();
}
function paintSettings() {
  document.querySelectorAll("#setTrack .row").forEach((n) => n.classList.toggle("is-sel", Number(n.dataset.i) === S.set));
  const row = $(`#setTrack .row[data-i="${S.set}"]`);
  if (!row) return;
  const track = $("#setTrack");
  const k = $("#stage").getBoundingClientRect().width / 1920 || 1;
  const y = (row.getBoundingClientRect().top - track.getBoundingClientRect().top) / k;
  track.style.transform = `translateY(${-Math.max(0, y - 380)}px)`;
}
function openSettings() {
  renderSettings();
  $("#settings").classList.add("on");
  setOverlay("settings");
  refreshLive().then(() => { if (S.overlay === "settings") renderSettings(); });
}
function closeSettings() { $("#settings").classList.remove("on"); setOverlay(null); }
function settingsMove(d) {
  const m = S.setModel;
  for (let i = S.set + d; i >= 0 && i < m.length; i += d) if (selectable(m[i])) { S.set = i; break; }
  paintSettings();
}
function settingsActivate() {
  const it = S.setModel[S.set];
  if (!it) return;
  if (it.toggle) prefs[it.key] = !prefs[it.key];
  else if (it.values) prefs[it.key] = it.values[(it.values.indexOf(prefs[it.key]) + 1) % it.values.length];
  else if (it.id === "find") { HUB.searching = true; native("findHub"); toast("Looking for LocalHub…"); }
  else if (it.id === "address") return openModal("LocalHub address", "The laptop's address on your network, and the hub's port.", HUB.url.replace(/^https?:\/\//, ""), (v) => { native("setHub", v.trim()); HUB.paired = false; probeNative(); });
  else if (it.id === "pair") return openPairing();
  else if (it.id === "look") { closeSettings(); return openHubApp(); }
  else if (it.id === "tvsetup") { closeSettings(); return openHubApp("/#tv-setup"); }
  else if (it.id === "forget") { native("forgetHub"); HUB.paired = false; toast("This TV forgot LocalHub"); }
  savePrefs();
  applyLook();
  $("#keys").hidden = NATIVE || !prefs.help;
  const keep = ITEMS[S.i]?.id;
  loadItems();
  S.i = Math.max(0, ITEMS.findIndex((x) => x.id === keep));
  renderGrid();
  armSaver();
  renderSettings();
}

/* the hub's alert */
let modalDone = null;
function openModal(title, hint, value, onDone) {
  $("#modalTitle").textContent = title;
  $("#modalHint").textContent = hint || "";
  $("#modalInput").value = value || "";
  $("#modal").classList.add("on");
  S.modalFrom = S.overlay;
  S.overlay = "modal";
  modalDone = onDone;
  setTimeout(() => { $("#modalInput").focus(); native("setTyping", true); }, 60);
}
function closeModal(done) {
  const fn = modalDone;
  const v = $("#modalInput").value;
  $("#modal").classList.remove("on");
  $("#modalInput").blur();
  native("setTyping", false);
  modalDone = null;
  S.overlay = S.modalFrom || null;
  if (S.overlay === "settings") renderSettings();
  if (done && fn) fn(v);
}
$("#modalCancel").addEventListener("click", () => closeModal(false));
$("#modalSave").addEventListener("click", () => closeModal(true));
$("#modalInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); closeModal(true); }
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeModal(false); }
});

let toastTimer = 0;
function toast(msg) {
  const n = $("#toast");
  n.textContent = msg;
  n.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => n.classList.remove("on"), 2400);
}

/* ── clock + screensaver ───────────────────────────────────────────────── */
function clockParts(d) {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  if (prefs.clock === "24-hour") return { hm: `${String(h).padStart(2, "0")}:${m}`, ap: "" };
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return { hm: `${h}:${m}`, ap };
}
const clockText = (d) => { const p = clockParts(d); return p.ap ? `${p.hm} ${p.ap}` : p.hm; };
function tick() {
  const d = new Date();
  $("#clock").textContent = clockText(d);
  $("#today").textContent = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  $("#saverTime").textContent = clockParts(d).hm;
  $("#saverDate").textContent = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  if (S.shelfId === "hub" && !S.overlay) $("#shelfBody").innerHTML = hubShelfHTML();
}
let saverTimer = 0;
function armSaver() {
  clearTimeout(saverTimer);
  const mins = parseInt(prefs.saver, 10);
  if (!mins || S.overlay === "saver") return;
  saverTimer = setTimeout(() => { if (!S.overlay && S.zone !== "bar") startSaver(); }, mins * 60000);
}
function startSaver() { tick(); $("#saver").classList.add("on"); setOverlay("saver"); }
function stopSaver() { $("#saver").classList.remove("on"); setOverlay(null); armSaver(); }

/* ── voice ─────────────────────────────────────────────────────────────────
   The mic is the hub chat's own (tabs/chat.js): with nothing typed, its send button is a mic, on
   the laptop and on the TV alike. On a laptop it uses the browser's mic and voice. On a TV this
   page lends it the TV's microphone and voice through window.HubVoice, and Whisper on the laptop
   writes it down either way. ⏯, Space and "Ask LocalHub" all press that same button. */

let reqSeq = 0;
const pending = new Map();
const MIC = { wait: null };

/* "Read answers aloud" (Settings), for tabs/chat.js: "After voice" speaks a reply when the question was
   spoken, "Always" speaks every reply, "Off" never speaks. */
window.HubSpeech = { mode: () => prefs.speak || "After voice" };

if (NATIVE) {
  window.HubVoice = {
    // Resolves with what was said ("" when nothing was), rejects when the TV has no mic it can use.
    listen({ onLevel, onWorking } = {}) {
      return new Promise((resolve, reject) => {
        MIC.wait = { resolve, reject, onLevel, onWorking };
        native("startListening");
      });
    },
    stop() { native("stopListening"); },
    cancel() { native("cancelListening"); MIC.wait?.resolve(""); MIC.wait = null; },
    speak(text) { if (prefs.speak !== "Off") native("speak", text); },
    hush() { native("stopSpeaking"); },
  };
}

// The TV's mic finished a clip: Java holds it and sends it to the hub's Whisper itself.
async function nativeClipReady() {
  const w = MIC.wait;
  if (!w) return;
  w.onWorking?.();
  const res = await new Promise((resolve) => {
    const id = `t${++reqSeq}`;
    let body = "";
    pending.set(id, { line: (l) => { body += l; }, end: (e) => resolve({ status: e.status, json: safeJson(body, {}) || {}, error: e.error }) });
    native("transcribe", id);
  });
  MIC.wait = null;
  if (res.status !== 200 || !res.json.ok) return w.reject(new Error(res.json.error || res.error || "Couldn't write that down."));
  w.resolve(String(res.json.text || ""));
}

function startVoice() {
  if (!window.HubChat?.voice) { toast(NATIVE ? "Pair this TV with LocalHub first" : "Open this from LocalHub to talk to it"); return; }
  if (S.overlay === "cc") closeCC();
  if (S.overlay === "settings") closeSettings();
  window.HubChat.voice();
}


/* "Open Netflix" and friends happen right here, typed or said; everything else goes to the hub. */
function quickIntent(text) {
  const t = text.toLowerCase().replace(/[.,!?]+/g, " ").replace(/\b(please|thanks|thank you|for me|now)\b/g, " ").replace(/\s+/g, " ").trim();
  const open = t.match(/^(?:hey\s+|ok\s+)?(?:can you\s+|could you\s+)?(?:open|launch|start|play|put on|go to|switch to|show me)\s+(?:the\s+|my\s+)?(.+?)(?:\s+app)?(?:\s+on (?:the )?tv)?$/);
  if (open) {
    const what = open[1];
    const input = INPUTS.find((i) => i.name.toLowerCase().includes(what) || (i.sub || "").toLowerCase().replace(/\s/g, "") === what.replace(/\s/g, ""));
    if (input) return { type: "input", input };
    const app = findApp(what);
    if (app) return { type: "launch", app };
    if (/^(settings|tv settings)$/.test(what)) return { type: "settings" };
  }
  if (/^(?:go )?home$/.test(t)) return { type: "home" };
  if (/screen ?saver/.test(t)) return { type: "saver" };
  if (/^(?:go to )?sleep$|turn (?:the )?tv off/.test(t)) return { type: "sleep" };
  return null;
}
function findApp(name) {
  const n = String(name).toLowerCase().replace(/[^a-z0-9+]/g, "");
  if (!n) return null;
  const key = (a) => a.name.toLowerCase().replace(/[^a-z0-9+]/g, "");
  return APPS.find((a) => key(a) === n) || APPS.find((a) => key(a).startsWith(n)) || APPS.find((a) => key(a).includes(n)) || APPS.find((a) => (a.pkg || "").toLowerCase().includes(n));
}
function runIntent(intent) {
  if (intent.type === "launch") {
    say(`Opening ${intent.app.name}.`);
    S.zone = "grid";
    S.i = ITEMS.indexOf(intent.app);
    applyFocus();
    return launch(intent.app, () => openApp(intent.app));
  }
  if (intent.type === "input") {
    say(`Switching to ${intent.input.name}.`);
    S.zone = "grid";
    S.i = ITEMS.findIndex((x) => x.id === intent.input.id);
    applyFocus();
    return launch(ITEMS[S.i] || { ...intent.input, kind: "input" }, () => (NATIVE ? native("switchInput", intent.input.id) : true), `Switching to ${intent.input.name}`);
  }
  if (intent.type === "home") { S.zone = "grid"; S.i = 0; return applyFocus(); }
  if (intent.type === "settings") return openSettings();
  if (intent.type === "saver") return startSaver();
  if (intent.type === "sleep") return sleepNow();
}
// Every message the hub chat is about to send comes here first: TV commands run on the spot.
window.HubChatHooks = {
  intercept(text) {
    const intent = quickIntent(text);
    if (!intent) return false;
    leaveBar();
    runIntent(intent);
    return true;
  },
};

const plain = (t) => t.replace(/`[^`]*`/g, "").replace(/https?:\/\/\S+/g, "").replace(/[*_#>|]/g, "").replace(/\s+\n/g, "\n");
function say(text) {
  if (!text || prefs.speak === "Off") return;
  if (window.HubChat?.say) return window.HubChat.say(text);
  if (NATIVE) return native("speak", text);
  if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}


/* ── laptop → TV commands: Alexa, the agent's tv_control tool ──────────── */
let commandLoop = false;
async function startCommandLoop() {
  if (commandLoop || !IN_HUB) return;
  commandLoop = true;
  let after = null;
  while (commandLoop) {
    try {
      const r = await fetch(after == null ? "/api/tv/next" : `/api/tv/next?after=${after}&wait=25`, { cache: "no-store" });
      if (r.status === 200) {
        const got = await r.json();
        if (typeof got.seq === "number") after = got.seq;
        if (got.command) runCommand(got.command);
      } else if (r.status !== 204) await wait(r.status === 401 || r.status === 403 ? 15000 : 3000);
    } catch { await wait(5000); }
  }
}
function runCommand(cmd) {
  if (!cmd || typeof cmd !== "object") return;
  if (S.overlay === "saver") stopSaver();
  if (S.overlay === "cc") closeCC();
  if (S.overlay === "settings") closeSettings();
  if (cmd.type === "launch") { const app = findApp(cmd.app); return app ? runIntent({ type: "launch", app }) : toast(`No app called “${cmd.app}” here`); }
  if (cmd.type === "input") {
    const want = String(cmd.name || "").toLowerCase();
    const input = INPUTS.find((i) => i.id === cmd.id || i.name.toLowerCase().includes(want) || (i.sub || "").toLowerCase().includes(want));
    return input ? runIntent({ type: "input", input }) : toast("That input isn't here");
  }
  if (cmd.type === "home") return runIntent({ type: "home" });
  if (cmd.type === "saver") return startSaver();
  if (cmd.type === "sleep") return sleepNow();
  if (cmd.type === "say") return say(String(cmd.text || ""));
  if (cmd.type === "answer") {
    toast(cmd.heard ? `“${cmd.heard}”` : "From LocalHub");
    if (cmd.speak !== false) say(plain(String(cmd.text || "")));
  }
}

/* ── pairing (the TV app, before it can reach the hub) ─────────────────── */
function openPairing() {
  if (!NATIVE) return toast("Open http://localhost:3100/tv/ on the computer running LocalHub");
  if (!HUB.url) { native("findHub"); HUB.searching = true; toast("Looking for LocalHub on this network…"); return; }
  openModal("Pair this TV", "On the laptop, open localhost:3100/pair/new and type the code it shows.", "", (code) => native("pair", code.trim()));
}
async function probeNative() {
  if (!NATIVE) return;
  const st = safeJson(native("status"), {});
  HUB.url = st.hub || "";
  HUB.paired = Boolean(st.paired);
  HUB.name = st.hubName || HUB.name;
  if (!IN_HUB && HUB.paired && HUB.url) native("openHub");
  if (!HUB.url && !HUB.searching) { HUB.searching = true; native("findHub"); }
  paintChip();
  paintPairbar();
}
function paintPairbar() {
  const bar = $("#pairbar");
  bar.hidden = IN_HUB;
  if (IN_HUB) return;
  $("#pairText").textContent = !NATIVE
    ? "Open this from LocalHub (localhost:3100/tv/) to ask anything."
    : HUB.searching ? "Looking for LocalHub on your network…"
      : !HUB.url ? "LocalHub isn't on this network yet."
        : HUB.paired ? `Can't reach ${HUB.name} right now.` : `Found ${HUB.name}. Pair this TV to ask anything.`;
  $("#pairBtn").textContent = HUB.paired ? "Retry" : HUB.url ? "Pair" : "Search";
}
$("#pairBtn").addEventListener("click", () => (HUB.paired ? native("openHub") : openPairing()));

/* ── Java → page ───────────────────────────────────────────────────────── */
window.haven = {
  key: (name) => handleKey(name),
  closeHub: () => closeHub(),
  resumed: () => endLaunch(),
  appsChanged: () => { const keep = ITEMS[S.i]?.id; loadItems(); S.i = Math.max(0, ITEMS.findIndex((x) => x.id === keep)); S.shelfId = null; renderGrid(); },
  onNative(evt) {
    if (!evt) return;
    if (evt.type === "hubLine") return pending.get(evt.id)?.line(evt.line);
    if (evt.type === "hubEnd") { const p = pending.get(evt.id); pending.delete(evt.id); return p?.end(evt); }
    if (evt.type === "level") return MIC.wait?.onLevel?.(evt.value);
    if (evt.type === "audio") return nativeClipReady();
    if (evt.type === "noSpeech") { MIC.wait?.resolve(""); MIC.wait = null; return; }
    if (evt.type === "micError") { const w = MIC.wait; MIC.wait = null; return w ? w.reject(new Error(`${evt.message || "No microphone here."} Or say “Alexa, ask local hub …”.`)) : toast(evt.message || "No microphone"); }
    if (evt.type === "hub") {
      HUB.searching = false;
      HUB.url = evt.url || "";
      HUB.paired = Boolean(evt.paired);
      HUB.name = evt.name || HUB.name;
      if (!HUB.url) toast("LocalHub isn't reachable on this network yet");
      paintPairbar();
      if (S.overlay === "settings") renderSettings();
      return;
    }
    if (evt.type === "paired") {
      if (!evt.ok) { toast(evt.error || "That code didn't work"); return; }
      HUB.paired = true;
      HUB.name = evt.name || HUB.name;
      toast(`✓ Paired with ${HUB.name}`);
      return native("openHub");
    }
  },
};

/* ── keys: the remote (through Java), or a laptop's keyboard ───────────── */
const KEYMAP = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Enter: "enter", Escape: "back", Backspace: "back", m: "menu", M: "menu", " ": "ai", MediaPlayPause: "ai", s: "saver", S: "saver", "?": "help" };

// Capture phase: tabs/chat.js keeps its own keys inside its shadow root, so this looks first.
document.addEventListener("keydown", (e) => {
  if (S.overlay === "hub") return;
  armSaver();
  hidePointer();
  if (S.overlay === "saver") { e.preventDefault(); e.stopPropagation(); return stopSaver(); }
  if (document.activeElement === chatHost()) {
    const root = chatHost().shadowRoot;
    const box = root.activeElement;
    // "open netflix" typed in the hub's bar opens it here and now.
    if (e.key === "Enter" && !e.shiftKey && !S.sending && box?.matches?.(".bta, .fta")) {
      const intent = quickIntent(box.value || "");
      if (intent) {
        e.preventDefault();
        e.stopPropagation();
        box.value = "";
        box.dispatchEvent(new Event("input", { bubbles: true }));
        leaveBar();
        return runIntent(intent);
      }
      return;
    }
    const open = root.querySelector(".card.on, .full.on, .menu:not([hidden])");
    if ((e.key === "ArrowUp" && box?.matches?.(".bta") && !box.value && !root.querySelector(".full.on")) || (e.key === "Escape" && !open)) {
      e.preventDefault();
      e.stopPropagation();
      leaveBar();
      S.zone = "grid";
      applyFocus();
    } else if (e.key === "MediaPlayPause") {
      e.preventDefault();
      e.stopPropagation();
      handleKey("ai");
    }
    return;
  }
  if (document.activeElement?.tagName === "INPUT") return;
  const name = KEYMAP[e.key];
  if (!name) return;
  e.preventDefault();
  handleKey(name);
}, true);

function handleKey(name) {
  armSaver();
  if (S.overlay === "saver") return stopSaver();
  if (S.overlay === "launch") return;
  if (S.overlay === "hub") { if (name === "back") closeHub(); return; }
  if (name === "help") { prefs.help = !prefs.help; savePrefs(); return showKeys(prefs.help); }
  if (S.overlay === "modal") { if (name === "back") closeModal(false); return; }
  if (S.pendingOpen && name === "enter") { const app = S.pendingOpen; S.pendingOpen = null; return launch(app, () => openApp(app)); }
  S.pendingOpen = null;
  if (name === "ai") { if (S.overlay === "cc") closeCC(); if (S.overlay === "settings") closeSettings(); return startVoice(); }
  if (window.HubChat?.listening?.() && name === "back") { if (window.HubChat.cancelVoice) window.HubChat.cancelVoice(); else window.HubVoice?.cancel?.(); return; }
  if (S.zone === "bar" && document.activeElement === chatHost()) {
    if (name === "back") {
      const root = chatHost().shadowRoot;
      if (root.querySelector(".full.on, .card.on")) { (root.activeElement || chatInput())?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true })); return; }
      leaveBar(); S.zone = "grid"; return applyFocus();
    }
    if (name === "menu") { leaveBar(); return openCC(); }
    return;
  }
  if (S.overlay === "cc") {
    if (name === "back" || name === "menu") return closeCC();
    if (name === "enter") return ccActivate();
    if (name === "left") return ccMove(-1, 0);
    if (name === "right") return ccMove(1, 0);
    if (name === "up") return ccMove(0, -1);
    if (name === "down") return ccMove(0, 1);
    return;
  }
  if (S.overlay === "settings") {
    if (name === "back" || name === "menu") return closeSettings();
    if (name === "up") return settingsMove(-1);
    if (name === "down") return settingsMove(1);
    if (name === "enter") return settingsActivate();
    return;
  }
  switch (name) {
    case "left": return move(-1, 0);
    case "right": return move(1, 0);
    case "up": return move(0, -1);
    case "down": return move(0, 1);
    case "enter": return press(activate);
    case "menu": return openCC();
    case "saver": return startSaver();
    case "back":
      if (S.zone !== "grid") { S.zone = "grid"; return applyFocus(); }
      if (S.i >= COLS) { S.i = S.i % COLS; return applyFocus(); }
      if (S.i !== 0) { S.i = 0; return applyFocus(); }
      return;
    default:
  }
}
function press(fn) {
  const node = $(".app.is-focused");
  if (!node) return fn();
  node.classList.add("pressed");
  setTimeout(() => { node.classList.remove("pressed"); fn(); }, 120);
}

/* ── the mouse, on a laptop: hover focuses, click opens, the icon follows ─ */
let pointerTimer = 0;
function hidePointer() { document.body.classList.add("pointer-hidden"); }
document.addEventListener("mousemove", (e) => {
  document.body.classList.remove("pointer-hidden");
  clearTimeout(pointerTimer);
  pointerTimer = setTimeout(hidePointer, 3000);
  if (S.overlay) return;
  const app = e.target.closest?.(".app");
  if (!app) return;
  const i = Number(app.dataset.i);
  if (S.zone !== "grid" || S.i !== i) {
    if (S.zone === "bar") leaveBar();
    S.zone = "grid";
    S.i = i;
    applyFocus();
  }
  const r = app.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width - 0.5) * 2;
  const y = ((e.clientY - r.top) / r.height - 0.5) * 2;
  const icon = app.querySelector(".icon");
  clearTimeout(tilt.t);
  icon.style.setProperty("--ry", `${x * 8}deg`);
  icon.style.setProperty("--rx", `${-y * 8}deg`);
  icon.style.setProperty("--gx", `${x * 30}%`);
  icon.style.setProperty("--gy", `${-30 + y * 30}%`);
}, { passive: true });
document.addEventListener("mouseout", (e) => {
  const app = e.target.closest?.(".app");
  if (app && !app.contains(e.relatedTarget)) tilt(0, 0);
});
document.addEventListener("wheel", (e) => {
  if (S.overlay || Math.abs(e.deltaY) < 20 || document.activeElement === chatHost()) return;
  clearTimeout(document.wheelT);
  document.wheelT = setTimeout(() => move(0, Math.sign(e.deltaY)), 30);
}, { passive: true });
document.addEventListener("click", (e) => {
  if (S.overlay === "saver") return stopSaver();
  const app = e.target.closest(".app");
  if (app && !S.overlay) { S.zone = "grid"; S.i = Number(app.dataset.i); applyFocus(); return press(activate); }
  const tile = e.target.closest(".cc-tile[data-i]");
  if (tile) { S.cc = Number(tile.dataset.i); paintCC(); return ccActivate(); }
  const row = e.target.closest("#setTrack .row");
  if (row) { S.set = Number(row.dataset.i); paintSettings(); return settingsActivate(); }
  if (e.target.id === "scrim") return closeCC();
  if (e.target.closest("#gearBtn")) return S.overlay === "cc" ? closeCC() : openCC();
  if (S.overlay === "settings" && !e.target.closest(".settings-side")) return closeSettings();
});

function showKeys(on) {
  const k = $("#keys");
  if (NATIVE) { k.hidden = true; return; }
  k.hidden = false;
  k.classList.toggle("gone", !on);
}

/* ── boot ──────────────────────────────────────────────────────────────── */
function showError(err) {
  const box = $("#fatal");
  box.hidden = false;
  box.textContent = "LocalHub TV: " + (err && err.message ? err.message : String(err));
  console.error(err);
}
window.addEventListener("error", (e) => showError(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => showError(e.reason));

function loadScript(src) {
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.append(s);
  });
}

async function boot() {
  applyLook();
  loadItems();
  renderGrid();
  tick();
  setInterval(tick, 10_000);
  // The opening (splash.js, the same one trylocalhub.com plays) decides when the home screen shows.
  (window.LocalHubSplash?.done || new Promise((r) => setTimeout(r, 2300))).then(() => { document.body.classList.add("booted"); $("#splash").classList.add("is-gone"); });
  if (!NATIVE) { showKeys(prefs.help); if (prefs.help) setTimeout(() => showKeys(false), 12000); }

  if (IN_HUB) {
    // The hub's own config, browser and assistant: the same agent, tools and conversations.
    await loadScript("/hub-config.js");
    HUB.name = window.HUB_CONF?.name || HUB.name;
    HUB.owner = window.HUB_CONF?.owner || "";
    await syncHub();
    ITEMS[0].name = HUB.name;
    S.shelfId = null;
    renderGrid();
    await loadScript("/tabs/browser.js");
    await loadScript("/tabs/chat.js");
    setInterval(syncHub, 30_000);
    startCommandLoop();
    if (NATIVE) { const st = safeJson(native("status"), {}); HUB.paired = Boolean(st.paired); HUB.url = st.hub || ""; }
  } else {
    probeNative();
  }
  paintChip();
  paintPairbar();
  armSaver();
}

boot();
