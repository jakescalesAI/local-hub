// ============================================================================
// LocalHub TV — the TV face of LocalHub.
//
// Served by LocalHub at /tv/. The Fire TV app opens that same page from the hub, signed in with
// its device key, so everything here is the hub's own: its wallpaper and style
// (/api/hub/settings, applied the way tabs/custom.js does), its Home widgets, and its assistant —
// the real tabs/chat.js bar and card, sharing conversations with the laptop.
//
// What only a TV can do comes from Java through window.LocalHubNative: the installed apps and
// their icons, launching them, HDMI inputs, the microphone and speech. When the hub can't be
// reached, the app shows a bundled copy of this page that can pair and launch apps, nothing more.
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

/* ── line icons, SF Symbols style (the hub's own set is drawn the same way) ── */
const sym = (d, w = 2) => `<svg class="sym" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const SYM = {
  gear: sym('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  tv: sym('<rect x="2.5" y="4" width="19" height="13" rx="2.2"/><path d="M8 21h8"/>'),
  input: sym('<path d="M4 7h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 7V4h8v3"/><path d="M12 17v4"/>'),
  power: sym('<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>'),
  wifi: sym('<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.8 12.4a9.2 9.2 0 0 1 12.4 0"/><path d="M9 15.7a4.6 4.6 0 0 1 6 0"/><circle cx="12" cy="19" r=".9" fill="currentColor"/>'),
  timer: sym('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9.5 2.5h5"/>'),
  moon: sym('<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>'),
  bt: sym('<path d="M7 7l10 10-5 4V3l5 4L7 17"/>'),
  mic: sym('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  grid: sym('<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>'),
  sliders: sym('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  clock: sym('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  chev: '<svg class="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5 6.5 7l-5 5.5"/></svg>',
};

/* ── the TV's apps ─────────────────────────────────────────────────────────
   In a browser there are no installed apps, so a demo catalogue stands in, drawn with Simple
   Icons (CC0) in ./brands. On the TV the list and the art come from the apps themselves. */
const DEMO_APPS = [
  { id: "netflix", name: "Netflix", a1: "#e50914", a2: "#831010", icon: "netflix", recent: 2 },
  { id: "youtube", name: "YouTube", a1: "#ff2d2d", a2: "#b80000", icon: "youtube", recent: 26 },
  { id: "primevideo", name: "Prime Video", a1: "#1aa8f0", a2: "#0f5f9e", icon: "primevideo", wide: true, recent: 50 },
  { id: "disney", name: "Disney+", a1: "#3d67e8", a2: "#0b1d5c", letter: "D+" },
  { id: "max", name: "Max", a1: "#2f5bff", a2: "#0a1fb0", icon: "max" },
  { id: "appletv", name: "Apple TV", a1: "#6e6e73", a2: "#1c1c1e", icon: "appletv" },
  { id: "plex", name: "Plex", a1: "#f5b400", a2: "#a66f00", icon: "plex", recent: 72 },
  { id: "spotify", name: "Spotify", a1: "#1ed760", a2: "#0e7a35", icon: "spotify", recent: 96 },
  { id: "hulu", name: "Hulu", a1: "#1ce783", a2: "#0a8f4f", letter: "h" },
  { id: "crunchyroll", name: "Crunchyroll", a1: "#ff8a3d", a2: "#c4510f", icon: "crunchyroll" },
  { id: "paramountplus", name: "Paramount+", a1: "#2b7bff", a2: "#0038a8", icon: "paramountplus" },
  { id: "twitch", name: "Twitch", a1: "#a970ff", a2: "#6227d6", icon: "twitch" },
  { id: "tubi", name: "Tubi", a1: "#8f3dff", a2: "#4b0fb3", icon: "tubi" },
  { id: "kodi", name: "Kodi", a1: "#30c4f2", a2: "#0d7fb0", icon: "kodi" },
  { id: "steam", name: "Steam Link", a1: "#4c6b8a", a2: "#171a21", icon: "steam" },
  { id: "vlc", name: "VLC", a1: "#ff9d2e", a2: "#d35f00", icon: "vlcmediaplayer" },
];
const DEMO_INPUTS = [
  { id: "hdmi1", name: "Apple TV 4K", sub: "HDMI 1" },
  { id: "hdmi2", name: "PlayStation 5", sub: "HDMI 2" },
];

/* ── prefs (this screen only; the look comes from the hub) ───────────────── */
const PREFS_KEY = "localhub.tv";
const DEFAULTS = { clock: "12-hour", inputs: true, saver: "5 min", effects: "Full", speak: "After voice" };
let prefs = { ...DEFAULTS, ...safeJson((() => { try { return localStorage.getItem(PREFS_KEY); } catch { return null; } })(), {}) };
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage off */ } };

/* ── state ─────────────────────────────────────────────────────────────── */
const S = {
  view: "home",          // home | apps | inputs
  zone: "apps",          // seg | apps | grid | bar
  seg: 0,
  app: 0,
  grid: 0,
  overlay: null,         // null | cc | settings | modal | launch | saver
  cc: 0,
  set: 0,
  modal: 1,
};
let APPS = [];
let INPUTS = [];
let HOME = [];
let SETTINGS = null;      // the hub's /api/hub/settings
const HUB = { on: false, name: "LocalHub", paired: false, url: "", searching: false };

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
  // A TV is a dark room: "auto" means dark here, whatever the WebView reports.
  const theme = st.theme === "auto" && NATIVE ? "dark" : st.theme;
  if (theme === "auto") { r.removeAttribute("data-theme"); r.style.colorScheme = ""; } else { r.setAttribute("data-theme", theme); r.style.colorScheme = theme; }
  if (st.accent === "system") r.style.removeProperty("--blue"); else r.style.setProperty("--blue", st.accent);
  r.dataset.look = st.widgetLook;
  r.dataset.shadow = st.shadow;
  r.dataset.tabbar = st.tabBar;
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
  const dark = theme === "dark" || (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  r.style.setProperty("--hub-scrim", w.tone ? (w.tone === (dark ? "dark" : "light") ? ".22" : ".62") : ".45");
}

async function syncHub() {
  if (!IN_HUB) { applyLook(); return; }
  try {
    const r = await fetch("/api/hub/settings", { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const next = await r.json();
    const changed = JSON.stringify(next.style) + JSON.stringify(next.wallpaper) + JSON.stringify(next.widgets?.desktop) !==
      JSON.stringify(SETTINGS?.style) + JSON.stringify(SETTINGS?.wallpaper) + JSON.stringify(SETTINGS?.widgets?.desktop);
    SETTINGS = next;
    HUB.on = true;
    if (changed) { applyLook(); renderWidgets(); }
  } catch {
    HUB.on = false;
  }
  HUB.name = window.HUB_CONF?.name || HUB.name;
  paintChip();
}

function paintChip() {
  $("#hubName").textContent = HUB.name;
  $("#splashName").textContent = HUB.name;
  $("#hubChip").classList.toggle("on", HUB.on);
}

/* ── catalogue ─────────────────────────────────────────────────────────── */

function loadCatalogue() {
  if (NATIVE) {
    APPS = safeJson(native("apps") || "[]", []).map((a) => ({
      id: a.id, pkg: a.id, name: a.name, img: a.icon || a.banner || null,
      a1: a.color || "#8e8e93", a2: a.color || "#48484a", recentAt: a.recent || 0,
    }));
    INPUTS = safeJson(native("inputs") || "[]", []);
  } else {
    const now = Date.now();
    APPS = DEMO_APPS.map((a) => ({ ...a, recentAt: a.recentAt || (a.recent ? now - a.recent * 3600e3 : 0) }));
    INPUTS = DEMO_INPUTS;
  }
  if (!prefs.inputs) INPUTS = [];
  const recent = [...APPS].sort((a, b) => (b.recentAt || 0) - (a.recentAt || 0));
  HOME = [...recent.slice(0, 7), { id: "all-apps", name: "All Apps", kind: "all" }];
}

function tileArt(app) {
  if (app.kind === "all") return `<span class="hc-app" style="--a1:#8e8e93;--a2:#48484a;--fg:var(--label)">${SYM.grid}</span>`;
  if (app.kind === "input") return `<span class="hc-app" style="--a1:#64d2ff;--a2:#0a84ff">${SYM.input}</span>`;
  if (app.kind === "settings") return `<span class="hc-app" style="--a1:#8e8e93;--a2:#48484a;--fg:var(--label)">${SYM.gear}</span>`;
  if (app.img) return `<span class="hc-app img"><img src="${esc(app.img)}" alt="" decoding="async"></span>`;
  const colors = `--a1:${app.a1};--a2:${app.a2}`;
  if (app.icon && !NATIVE) return `<span class="hc-app" style="${colors};--glyph:url('./brands/${app.icon}.svg')"><i class="glyph${app.wide ? " wide" : ""}"></i></span>`;
  return `<span class="hc-app" style="${colors}"><b class="letter">${esc(app.letter || app.name.slice(0, 1))}</b></span>`;
}

function tileHTML(app, i, zone, sub) {
  return `<div class="app" data-zone="${zone}" data-i="${i}">${tileArt(app)}<span class="app-l">${esc(app.name)}</span>${sub ? `<span class="app-s">${esc(sub)}</span>` : ""}</div>`;
}

/* ── the views ─────────────────────────────────────────────────────────── */

const VIEWS = () => [
  ["home", "Home"],
  ["apps", "Apps"],
  ...(INPUTS.length ? [["inputs", "Inputs"]] : []),
];

function renderSeg() {
  const views = VIEWS();
  const seg = $("#seg");
  seg.style.setProperty("--n", String(views.length));
  seg.innerHTML = `<span class="seg-thumb"></span>` + views.map(([id, label]) => `<button type="button" data-view="${id}" aria-pressed="${S.view === id}">${label}</button>`).join("");
  const i = Math.max(0, views.findIndex(([id]) => id === S.view));
  seg.style.setProperty("--i", String(i));
  $("#segHint").textContent = S.zone === "seg" ? "" : "";
}

function gridItems() {
  if (S.view === "apps") return [...[...APPS].sort((a, b) => a.name.localeCompare(b.name)), { id: "tv-settings", name: "Settings", kind: "settings" }];
  if (S.view === "inputs") return INPUTS.map((i) => ({ ...i, kind: "input" }));
  return [];
}

function renderViews() {
  $("#homeApps").innerHTML = HOME.map((a, i) => tileHTML(a, i, "apps")).join("");
  $("#allApps").innerHTML = S.view === "apps" ? gridItems().map((a, i) => tileHTML(a, i, "grid")).join("") : "";
  $("#inputGrid").innerHTML = S.view === "inputs" ? gridItems().map((a, i) => tileHTML(a, i, "grid", a.sub)).join("") : "";
  for (const [id] of [["home"], ["apps"], ["inputs"]]) $(`#view-${id}`).classList.toggle("on", S.view === id);
  $("#title").textContent = S.view === "home" ? "Home" : S.view === "apps" ? "Apps" : "Inputs";
  renderSeg();
  renderWidgets();
  applyFocus();
}

/* Home widgets: the ones on the hub's own Home (Desktop layout) that make sense on a TV,
   drawn the way tabs/home.js draws them, then the TV's own "Recently opened". */
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
};

function renderWidgets() {
  const layout = SETTINGS?.widgets?.desktop?.length ? SETTINGS.widgets.desktop : [{ id: "clock" }, { id: "date" }, { id: "world-clock" }];
  const cards = layout.filter((w) => WIDGETS[w.id]).slice(0, 3).map((w) => {
    const def = WIDGETS[w.id];
    return `<div class="w card"><div class="w-label"><i class="dot" style="--c:${def.tint}"></i>${esc(def.label)}</div><div class="w-body">${def.render()}</div></div>`;
  });
  const recent = [...APPS].filter((a) => a.recentAt).sort((a, b) => b.recentAt - a.recentAt).slice(0, 4);
  cards.push(`<div class="w wide card"><div class="w-label"><i class="dot" style="--c:var(--green)"></i>Recently opened</div><div class="w-body">${
    recent.length
      ? `<div class="w-list">${recent.map((a) => `<div class="w-row"><span class="mini">${miniArt(a)}</span><span class="t">${esc(a.name)}</span><span class="s">${esc(ago(a.recentAt))}</span></div>`).join("")}</div>`
      : `<div class="w-empty">Apps you open on this TV show up here.</div>`
  }</div></div>`);
  $("#widgets").innerHTML = cards.join("");
}

function miniArt(a) {
  if (a.img) return `<img src="${esc(a.img)}" alt="">`;
  if (a.icon && !NATIVE) return `<i class="glyph" style="--glyph:url('./brands/${a.icon}.svg');color:${a.a1}"></i>`;
  return `<b style="font:700 26px var(--rounded);color:${a.a1}">${esc((a.letter || a.name).slice(0, 1))}</b>`;
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

/* ── focus ─────────────────────────────────────────────────────────────── */

function applyFocus() {
  document.querySelectorAll(".app.is-focused").forEach((n) => n.classList.remove("is-focused"));
  $("#seg").classList.toggle("focus", S.zone === "seg" && !S.overlay);
  $("#pairbar").classList.toggle("focus", S.zone === "bar" && !S.overlay);
  if (S.overlay) return;
  if (S.zone === "apps") $(`.app[data-zone="apps"][data-i="${S.app}"]`)?.classList.add("is-focused");
  if (S.zone === "grid") {
    const node = $(`.app[data-zone="grid"][data-i="${S.grid}"]`);
    node?.classList.add("is-focused");
    const grid = S.view === "apps" ? $("#allApps") : $("#inputGrid");
    const row = Math.floor(S.grid / 8);
    grid.style.transform = `translateY(${-Math.max(0, row - 1) * 236}px)`;
  }
}

function focusedItem() {
  if (S.zone === "apps") return HOME[S.app];
  if (S.zone === "grid") return gridItems()[S.grid];
  return null;
}

function setView(id) {
  if (S.view === id) return;
  S.view = id;
  S.grid = 0;
  renderViews();
}

function move(dx, dy) {
  const views = VIEWS();
  if (S.zone === "seg") {
    if (dx) {
      S.seg = clamp(views.findIndex(([id]) => id === S.view) + dx, 0, views.length - 1);
      setView(views[S.seg][0]);
    }
    if (dy > 0) S.zone = S.view === "home" ? "apps" : gridItems().length ? "grid" : "bar";
  } else if (S.zone === "apps") {
    if (dx) S.app = clamp(S.app + dx, 0, HOME.length - 1);
    if (dy < 0) S.zone = "seg";
    if (dy > 0) return focusBar();
  } else if (S.zone === "grid") {
    const n = gridItems().length;
    const col = S.grid % 8;
    if (dx) { const next = S.grid + dx; if (next >= 0 && next < n && Math.floor(next / 8) === Math.floor(S.grid / 8)) S.grid = next; }
    if (dy < 0) { if (S.grid < 8) S.zone = "seg"; else S.grid -= 8; }
    if (dy > 0) { if (S.grid + 8 < n) S.grid += 8; else if (Math.floor(S.grid / 8) === Math.floor((n - 1) / 8)) return focusBar(); else S.grid = n - 1; }
    void col;
  } else if (S.zone === "bar") {
    if (dy < 0) { leaveBar(); S.zone = S.view === "home" ? "apps" : gridItems().length ? "grid" : "seg"; }
  }
  applyFocus();
}

/* the assistant bar: the hub's own tabs/chat.js, or the pairing pill when there's no hub */
const chatHost = () => document.getElementById("hub-chat");
const chatInput = () => chatHost()?.shadowRoot?.querySelector(".bta");

function focusBar() {
  S.zone = "bar";
  applyFocus();
  const ta = chatInput();
  if (ta) { ta.focus(); native("setTyping", true); }
}

function leaveBar() {
  const ta = chatInput();
  if (ta) ta.blur();
  native("setTyping", false);
}

/* ── activation ────────────────────────────────────────────────────────── */

function activate() {
  if (S.zone === "seg") { S.zone = S.view === "home" ? "apps" : "grid"; return applyFocus(); }
  if (S.zone === "bar") return HUB.on ? focusBar() : openPairing();
  const item = focusedItem();
  if (!item) return;
  if (item.kind === "all") { setView("apps"); S.zone = "grid"; return applyFocus(); }
  if (item.kind === "settings") return openSettings();
  if (item.kind === "input") return launch(item, () => (NATIVE ? native("switchInput", item.id) : true), `Switching to ${item.name}`);
  return launch(item, () => openApp(item));
}

function openApp(app) {
  if (NATIVE) return native("launch", app.pkg) !== false;
  app.recentAt = Date.now();
  return true;
}

/* the tile grows to fill the screen, then the app takes over */
function launch(app, go, note) {
  const node = document.querySelector(".app.is-focused .hc-app");
  const stage = $("#stage").getBoundingClientRect();
  const k = stage.width / 1920;
  const r = node ? node.getBoundingClientRect() : { left: stage.left + 892 * k, top: stage.top + 472 * k, width: 136 * k, height: 136 * k };
  const layer = $("#launch");
  layer.querySelector(".hc-app")?.remove();
  const art = document.createElement("div");
  art.innerHTML = tileArt(app);
  const tile = art.firstElementChild;
  tile.style.left = `${(r.left - stage.left) / k}px`;
  tile.style.top = `${(r.top - stage.top) / k}px`;
  tile.style.width = `${r.width / k}px`;
  tile.style.height = `${r.height / k}px`;
  tile.style.transition = "none";
  layer.prepend(tile);
  $("#launchNote").textContent = NATIVE ? "" : note ? `${note} on the TV` : `${app.name} opens here on the TV`;
  setOverlay("launch");
  layer.classList.add("on");
  requestAnimationFrame(() => requestAnimationFrame(() => { tile.style.transition = ""; layer.classList.add("full"); }));
  setTimeout(() => {
    const ok = go();
    if (NATIVE && ok !== false) return; // the app is on screen; haven.resumed() tidies up when we're back
    if (ok === false) toast(`${app.name} didn't start`);
    setTimeout(endLaunch, NATIVE ? 0 : 1300);
  }, 480);
}

function endLaunch() {
  const layer = $("#launch");
  if (!layer.classList.contains("on")) return;
  layer.classList.remove("full", "on");
  if (S.overlay === "launch") setOverlay(null);
  loadCatalogue();
  renderViews();
}

/* ── overlays ──────────────────────────────────────────────────────────── */

function setOverlay(name) {
  S.overlay = name;
  document.body.classList.toggle("overlay", name === "settings");
  applyFocus();
}

/* Control Center, as a hub menu */
function ccItems() {
  const net = NATIVE ? safeJson(native("network"), {}) : { connected: navigator.onLine, kind: "Wi-Fi" };
  return [
    { id: "ask", ic: SYM.mic, t: "Ask LocalHub", v: "⏯" },
    ...(INPUTS.length ? [{ id: "inputs", ic: SYM.input, t: "Inputs", v: `${INPUTS.length}` }] : []),
    { sep: true },
    { id: "saver", ic: SYM.moon, t: "Screensaver", v: "" },
    { id: "timer", ic: SYM.timer, t: "Sleep timer", v: S.sleepAt ? clockText(new Date(S.sleepAt)) : "Off", on: !!S.sleepAt },
    { id: "sleep", ic: SYM.power, t: "Sleep", v: "" },
    { sep: true },
    { id: "net", ic: SYM.wifi, t: net.kind || "Network", v: net.connected ? "Connected" : "Offline", on: !!net.connected },
    { id: "bt", ic: SYM.bt, t: "Bluetooth", v: "" },
    { id: "system", ic: SYM.sliders, t: "TV settings", v: "" },
    { id: "settings", ic: SYM.gear, t: "LocalHub TV settings", v: "" },
  ];
}
let CC = [];
function openCC() {
  CC = ccItems();
  const n = new Date();
  $("#ccClock").textContent = clockText(n);
  $("#ccDate").textContent = n.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  $("#ccList").innerHTML = CC.map((it, i) => (it.sep ? `<div class="menu-sep"></div>` : `<div class="mi${it.on ? " on" : ""}" data-i="${i}"><span class="ic">${it.ic}</span><span class="t">${esc(it.t)}</span><span class="v">${esc(it.v)}</span></div>`)).join("");
  if (CC[S.cc]?.sep || !CC[S.cc]) S.cc = 0;
  $("#cc").classList.add("on");
  $("#scrim").classList.add("on");
  setOverlay("cc");
  paintCC();
}
function closeCC() { $("#cc").classList.remove("on"); $("#scrim").classList.remove("on"); setOverlay(null); }
function paintCC() { document.querySelectorAll(".mi").forEach((n) => n.classList.toggle("is-sel", Number(n.dataset.i) === S.cc)); }
function ccMove(d) {
  let i = S.cc;
  do { i += d; } while (CC[i]?.sep);
  if (CC[i]) S.cc = i;
  paintCC();
}
function ccActivate() {
  const id = CC[S.cc]?.id;
  if (id === "timer") return cycleSleepTimer();
  closeCC();
  if (id === "ask") return startVoice();
  if (id === "inputs") { setView("inputs"); S.zone = "grid"; return applyFocus(); }
  if (id === "saver") return startSaver();
  if (id === "sleep") return sleepNow();
  if (id === "net") return NATIVE ? native("openNetworkSettings") : toast("Opens network settings on the TV");
  if (id === "bt") return NATIVE ? native("openBluetoothSettings") : toast("Opens Bluetooth settings on the TV");
  if (id === "system") return NATIVE ? native("openSystemSettings") : toast("Opens Fire TV settings on the TV");
  if (id === "settings") return openSettings();
}

function sleepNow() {
  if (!NATIVE) return toast("The TV would go to sleep");
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
  openCC();
}

/* Settings: an inset grouped list */
function settingsModel() {
  const st = NATIVE ? safeJson(native("status"), {}) : {};
  const hubRows = NATIVE
    ? [
      { id: "find", t1: "LocalHub", t2: HUB.url ? HUB.url.replace(/^https?:\/\//, "") : "Look for it on this network", v: HUB.searching ? "Searching…" : HUB.on ? "Connected" : HUB.url ? "Not answering" : "Search" },
      { id: "address", t1: "Address", t2: "If searching can't find it, e.g. 192.168.1.20:3100", v: "" },
      { id: "pair", t1: "Pair this TV", t2: "On the laptop open localhost:3100/pair/new", v: HUB.paired ? "Paired" : "Not paired", on: HUB.paired },
      { id: "forget", t1: "Forget LocalHub", t2: "Removes this TV's device key", v: "" },
    ]
    : [{ info: true, t1: "LocalHub", t2: IN_HUB ? "This screen is served by LocalHub" : "Open it from LocalHub at /tv/", v: HUB.on ? "Connected" : "Not connected", on: HUB.on }];
  return [
    { group: "Home Screen" },
    { key: "clock", t1: "Clock", t2: "Top right, and on the screensaver", values: ["12-hour", "24-hour"] },
    { key: "inputs", t1: "HDMI inputs", t2: INPUTS.length || !prefs.inputs ? "Shown as their own tab" : "This TV reports none", toggle: true },
    { key: "saver", t1: "Screensaver", t2: "After the remote has been still", values: ["Off", "2 min", "5 min", "10 min", "15 min"] },
    { key: "effects", t1: "Glass", t2: "Light is quicker on older Fire TV sticks", values: ["Full", "Light"] },
    { info: true, t1: "Wallpaper and style", t2: "Follow LocalHub. Change them in the hub's Style panel", v: SETTINGS?.wallpaper?.current ? cap(SETTINGS.wallpaper.current) : "Aurora" },
    { group: "Assistant" },
    ...hubRows,
    { key: "speak", t1: "Read answers aloud", t2: "Uses the TV's voice", values: ["After voice", "Always", "Off"] },
    { info: true, t1: "Alexa", t2: "“Alexa, ask local hub to open Netflix”", v: "tv/alexa" },
    { group: "About" },
    ...(NATIVE ? [{ info: true, t1: "Home button", t2: "Brings LocalHub back when Home is pressed", v: st.homeService ? "On" : "Off", on: st.homeService }] : []),
    { info: true, t1: "Version", t2: NATIVE ? "LocalHub TV for Fire TV" : "In a browser", v: NATIVE ? st.version || "?" : "0.3.0" },
  ];
}
const cap = (s) => String(s).replace(/(^|-)(\w)/g, (_, a, b) => (a ? " " : "") + b.toUpperCase());
const selectable = (it) => it && !it.group && !it.info;

function valueOf(it) {
  if (it.toggle) return prefs[it.key] ? "On" : "Off";
  if (it.values) return prefs[it.key];
  return it.v ?? "";
}

function renderSettings() {
  const model = (S.setModel = settingsModel());
  let html = `<div class="set-title"><img src="./hub.svg" alt=""><h1>Settings</h1></div>`;
  let open = false;
  model.forEach((it, i) => {
    if (it.group) { if (open) html += "</div>"; html += `<div class="set-group">${esc(it.group)}</div><div class="list card">`; open = true; return; }
    const v = valueOf(it);
    const on = it.on || v === "On";
    html += `<div class="row${it.info ? " info" : ""}" data-i="${i}"><div class="txt"><div class="t1">${esc(it.t1)}</div>${it.t2 ? `<div class="t2">${esc(it.t2)}</div>` : ""}</div><div class="v${on ? " on" : ""}">${esc(v)}${SYM.chev}</div></div>`;
  });
  if (open) html += "</div>";
  $("#setTrack").innerHTML = html;
  if (!selectable(model[S.set])) S.set = model.findIndex(selectable);
  paintSettings();
}
function paintSettings() {
  document.querySelectorAll("#setTrack .row").forEach((n) => n.classList.toggle("is-sel", Number(n.dataset.i) === S.set));
  const row = $(`#setTrack .row[data-i="${S.set}"]`);
  if (!row) return;
  // Measured against the list itself (a blurred card is its own offset parent), in canvas pixels.
  const track = $("#setTrack");
  const k = $("#stage").getBoundingClientRect().width / 1920 || 1;
  const y = (row.getBoundingClientRect().top - track.getBoundingClientRect().top) / k;
  track.style.transform = `translateY(${-Math.max(0, y - 360)}px)`;
}
function openSettings() { renderSettings(); $("#settings").classList.add("on"); setOverlay("settings"); }
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
  else if (it.id === "forget") { native("forgetHub"); HUB.paired = false; toast("This TV forgot LocalHub"); }
  savePrefs();
  applyLook();
  loadCatalogue();
  renderViews();
  armSaver();
  renderSettings();
}

/* the hub's alert: title, message, field, Cancel | Done */
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

/* toast */
let toastTimer = 0;
function toast(msg) {
  const n = $("#toast");
  n.textContent = msg;
  n.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => n.classList.remove("on"), 2200);
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
  const p = clockParts(d);
  $("#clock").innerHTML = `${p.hm}${p.ap ? `<small>${p.ap}</small>` : ""}`;
  $("#navSub").textContent = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  $("#saverTime").textContent = p.hm;
  $("#saverDate").textContent = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  if (S.view === "home" && !S.overlay) renderWidgets();
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

/* ── voice: the TV's mic (or the browser's) → Whisper on the laptop → the hub's chat ── */

const VOICE = { rec: null, state: "idle", speaking: false, follow: null };

function listenUi(state, text) {
  VOICE.state = state;
  const n = $("#listen");
  n.classList.toggle("on", state !== "idle");
  n.classList.toggle("busy", state === "working");
  $("#listenText").textContent = text || "";
}

function startVoice() {
  if (VOICE.state === "listening") return stopListening(false);
  stopSpeaking();
  if (!HUB.on) { toast(NATIVE ? "Pair this TV with LocalHub first" : "Open this page from LocalHub to talk to it"); return; }
  listenUi("listening", "Listening");
  if (NATIVE) return native("startListening");
  browserRecord().then((r) => { VOICE.rec = r; }).catch((err) => { listenUi("idle"); toast(`Microphone: ${err.message || err}`); });
}

function stopListening(discard) {
  if (NATIVE) native(discard ? "cancelListening" : "stopListening");
  else VOICE.rec?.stop(discard);
  if (discard) listenUi("idle");
}

async function browserRecord() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(an);
  const rec = new MediaRecorder(stream);
  const chunks = [];
  let discarded = false, heard = false, quietSince = performance.now();
  const started = performance.now();
  const buf = new Uint8Array(an.fftSize);
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
    VOICE.rec = null;
    if (discarded) return;
    if (!heard) { listenUi("idle"); return toast("Didn't catch that"); }
    transcribe(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
  };
  rec.start();
  const loop = () => {
    if (rec.state !== "recording") return;
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += (v - 128) * (v - 128);
    const rms = Math.sqrt(sum / buf.length) / 128;
    level(rms * 6);
    const now = performance.now();
    if (rms > 0.035) { heard = true; quietSince = now; }
    if ((heard && now - quietSince > 1100) || now - started > 15000) rec.stop(); else requestAnimationFrame(loop);
  };
  loop();
  return { stop: (d) => { discarded = Boolean(d); if (rec.state === "recording") rec.stop(); } };
}

function level(v) {
  const l = clamp(v, 0, 1);
  document.querySelectorAll("#listen .bars b").forEach((b, i) => b.style.setProperty("--h", String(clamp(l * (0.55 + ((i * 37) % 5) / 6), 0, 1))));
}

let reqSeq = 0;
const pending = new Map();
async function transcribe(blob) {
  listenUi("working", "Understanding");
  let res;
  if (NATIVE) {
    res = await new Promise((resolve) => {
      const id = `t${++reqSeq}`;
      let body = "";
      pending.set(id, { line: (l) => { body += l; }, end: (e) => resolve({ status: e.status, json: safeJson(body, {}), error: e.error }) });
      native("transcribe", id);
    });
  } else {
    try {
      const r = await fetch("/api/tv/transcribe", { method: "POST", headers: { "x-hub": "1", "content-type": blob.type || "audio/webm" }, body: blob });
      res = { status: r.status, json: await r.json().catch(() => ({})) };
    } catch (err) { res = { status: 0, json: {}, error: err.message }; }
  }
  listenUi("idle");
  if (res.status !== 200 || !res.json.ok) return toast(res.json.error || res.error || "Couldn't understand that");
  const text = String(res.json.text || "").trim();
  if (!text) return toast("Didn't catch that");
  heard(text);
}

/* "Open Netflix" and friends happen right here; everything else goes to the hub's chat. */
function quickIntent(text) {
  const t = text.toLowerCase().replace(/[.,!?]+/g, " ").replace(/\b(please|thanks|thank you|for me|now)\b/g, " ").replace(/\s+/g, " ").trim();
  const open = t.match(/^(?:can you\s+|could you\s+)?(?:open|launch|start|play|put on|go to|switch to)\s+(?:the\s+|my\s+)?(.+?)(?:\s+app)?(?:\s+on (?:the )?tv)?$/);
  if (open) {
    const what = open[1];
    const input = INPUTS.find((i) => i.name.toLowerCase().includes(what) || (i.sub || "").toLowerCase().replace(/\s/g, "") === what.replace(/\s/g, ""));
    if (input) return { type: "input", input };
    const app = findApp(what);
    if (app) return { type: "launch", app };
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
    const i = HOME.indexOf(intent.app);
    if (i >= 0) { setView("home"); S.zone = "apps"; S.app = i; } else { setView("apps"); S.zone = "grid"; S.grid = Math.max(0, gridItems().indexOf(intent.app)); }
    applyFocus();
    return launch(intent.app, () => openApp(intent.app));
  }
  if (intent.type === "input") {
    say(`Switching to ${intent.input.name}.`);
    return launch({ ...intent.input, kind: "input" }, () => (NATIVE ? native("switchInput", intent.input.id) : true), `Switching to ${intent.input.name}`);
  }
  if (intent.type === "home") { setView("home"); S.zone = "apps"; return applyFocus(); }
  if (intent.type === "saver") return startSaver();
  if (intent.type === "sleep") return sleepNow();
}

function heard(text) {
  const intent = quickIntent(text);
  if (intent) return runIntent(intent);
  askHubChat(text, prefs.speak !== "Off");
}

/* Puts the words in the hub's own bar and sends them, as if typed: the conversation, the card,
   tool rows and history are tabs/chat.js's own, and the laptop sees the same chat. */
function askHubChat(text, speakIt) {
  const ta = chatInput();
  if (!ta) return toast("LocalHub's assistant isn't loaded");
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
  if (speakIt) followReply();
}

/* Reads the answer aloud as it streams: whole sentences as soon as they're complete. */
function followReply() {
  const root = chatHost()?.shadowRoot;
  if (!root) return;
  VOICE.follow?.disconnect();
  const log = root.querySelector(".clog");
  const before = root.querySelectorAll(".clog .msg.a").length;
  let spoken = 0;
  let started = false;
  const stop = root.querySelector(".sb");
  const flush = (final) => {
    const msgs = root.querySelectorAll(".clog .msg.a");
    if (msgs.length <= before) return;
    const text = plain(msgs[msgs.length - 1].querySelector(".bub")?.innerText || "");
    const rest = text.slice(spoken);
    const re = /[^.!?\n]+[.!?\n]+(\s|$)/g;
    let m, chunk = "";
    while ((m = re.exec(rest))) { chunk += m[0]; spoken += m[0].length; }
    if (final && spoken < text.length) { chunk += text.slice(spoken); spoken = text.length; }
    if (chunk.trim()) say(chunk.trim());
  };
  const obs = new MutationObserver(() => {
    if (stop && !stop.hidden) started = true;
    flush(false);
    if (started && stop && stop.hidden) { flush(true); obs.disconnect(); VOICE.follow = null; }
  });
  obs.observe(log, { childList: true, subtree: true, characterData: true });
  if (stop) obs.observe(stop, { attributes: true, attributeFilter: ["hidden"] });
  VOICE.follow = obs;
  setTimeout(() => { if (VOICE.follow === obs) { flush(true); obs.disconnect(); VOICE.follow = null; } }, 6 * 60e3);
}
const plain = (t) => t.replace(/`[^`]*`/g, "").replace(/https?:\/\/\S+/g, "").replace(/[*_#>|]/g, "").replace(/\s+\n/g, "\n");

function say(text) {
  if (!text) return;
  if (NATIVE) return native("speak", text);
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  speechSynthesis.speak(u);
}
function stopSpeaking() {
  if (NATIVE) native("stopSpeaking");
  else if ("speechSynthesis" in window) speechSynthesis.cancel();
}

/* Speak every answer, not just spoken questions, when Settings says Always. */
function watchTypedReplies() {
  const root = chatHost()?.shadowRoot;
  if (!root) return;
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && e.isTrusted && prefs.speak === "Always") setTimeout(followReply, 0);
  }, true);
}

/* ── laptop → TV commands: Alexa, the agent's tv_control tool, the dashboard ── */

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
  if (cmd.type === "launch") { const app = findApp(cmd.app); return app ? runIntent({ type: "launch", app }) : toast(`No app called “${cmd.app}” on this TV`); }
  if (cmd.type === "input") {
    const want = String(cmd.name || "").toLowerCase();
    const input = INPUTS.find((i) => i.id === cmd.id || i.name.toLowerCase().includes(want) || (i.sub || "").toLowerCase().includes(want));
    return input ? runIntent({ type: "input", input }) : toast("That input isn't on this TV");
  }
  if (cmd.type === "home") return runIntent({ type: "home" });
  if (cmd.type === "saver") return startSaver();
  if (cmd.type === "sleep") return sleepNow();
  if (cmd.type === "say") return say(String(cmd.text || ""));
  if (cmd.type === "answer") {
    // An answer that came in through Alexa: show it in the hub's own card and say it.
    toast(cmd.heard ? `“${cmd.heard}”` : "From LocalHub");
    if (cmd.speak !== false && prefs.speak !== "Off") say(plain(String(cmd.text || "")));
  }
}

/* ── pairing (the TV app, before it can reach the hub) ─────────────────── */

function openPairing() {
  if (!NATIVE) return toast("Open http://localhost:3100/tv/ on the laptop running LocalHub");
  if (!HUB.url) { native("findHub"); HUB.searching = true; toast("Looking for LocalHub on this network…"); return; }
  openModal("Pair this TV", "On the laptop, open localhost:3100/pair/new and type the code it shows.", "", (code) => native("pair", code.trim()));
}

async function probeNative() {
  if (!NATIVE) return;
  const st = safeJson(native("status"), {});
  HUB.url = st.hub || "";
  HUB.paired = Boolean(st.paired);
  HUB.name = st.hubName || HUB.name;
  if (!IN_HUB && HUB.paired && HUB.url) native("openHub"); // the hub is the real home: go there when we can
  if (!HUB.url && !HUB.searching) { HUB.searching = true; native("findHub"); }
  paintChip();
  paintPairbar();
}

function paintPairbar() {
  const bar = $("#pairbar");
  const show = !IN_HUB;
  bar.hidden = !show;
  if (!show) return;
  $("#pairText").textContent = !NATIVE
    ? "Open this page from LocalHub to ask anything."
    : HUB.searching ? "Looking for LocalHub on your network…"
      : !HUB.url ? "LocalHub isn't on this network yet."
        : HUB.paired ? `Can't reach ${HUB.name} right now.` : `Found ${HUB.name}. Pair this TV to ask anything.`;
  $("#pairBtn").textContent = HUB.paired ? "Retry" : HUB.url ? "Pair" : "Search";
}
$("#pairBtn").addEventListener("click", () => (HUB.paired ? native("openHub") : openPairing()));

/* ── Java → page ───────────────────────────────────────────────────────── */

window.haven = {
  key: (name) => handleKey(name),
  resumed: () => { endLaunch(); },
  appsChanged: () => { loadCatalogue(); renderViews(); },
  onNative(evt) {
    if (!evt) return;
    if (evt.type === "hubLine") return pending.get(evt.id)?.line(evt.line);
    if (evt.type === "hubEnd") { const p = pending.get(evt.id); pending.delete(evt.id); return p?.end(evt); }
    if (evt.type === "level") return level(evt.value);
    if (evt.type === "audio") return transcribe(null);
    if (evt.type === "noSpeech") { listenUi("idle"); return toast("Didn't catch that"); }
    if (evt.type === "micError") { listenUi("idle"); return toast(evt.message || "No microphone — try “Alexa, ask local hub …”"); }
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

/* ── keys: the remote (through Java) and a keyboard ────────────────────── */

const KEYMAP = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Enter: "enter", Escape: "back", m: "menu", M: "menu", c: "menu", C: "menu", i: "ai", I: "ai", MediaPlayPause: "ai", s: "saver", S: "saver" };

// Capture phase: tabs/chat.js stops its own keys inside its shadow root, so this has to look first.
document.addEventListener("keydown", (e) => {
  armSaver();
  if (S.overlay === "saver") { e.preventDefault(); e.stopPropagation(); return stopSaver(); }
  const inChat = document.activeElement === chatHost();
  if (inChat) {
    // The hub's chat handles its own keys. Up on an empty box, or Esc with nothing open, comes
    // back to the screen; the media key still talks.
    const root = chatHost().shadowRoot;
    const typingIn = root.activeElement;
    const emptyBox = typingIn?.matches?.(".bta") && !typingIn.value;
    const open = root.querySelector(".card.on, .full.on, .menu:not([hidden])");
    if ((e.key === "ArrowUp" && emptyBox && !root.querySelector(".full.on")) || (e.key === "Escape" && !open)) {
      e.preventDefault();
      e.stopPropagation();
      leaveBar();
      S.zone = S.view === "home" ? "apps" : "grid";
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
  if (S.overlay === "modal") {
    if (name === "back") return closeModal(false);
    return;
  }
  if (name === "ai") { if (S.overlay) closeAll(); return startVoice(); }
  if (VOICE.state === "listening" && (name === "back" || name === "enter")) return stopListening(name === "back");
  if (S.zone === "bar" && document.activeElement === chatHost()) {
    // Java forwards Back and Menu even while the keyboard is up.
    if (name === "back") {
      const root = chatHost().shadowRoot;
      const open = root.querySelector(".full.on") || root.querySelector(".card.on");
      // tabs/chat.js closes its card or full chat on Esc, so Back does exactly that.
      if (open) { (root.activeElement || chatInput())?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true })); return; }
      leaveBar(); S.zone = S.view === "home" ? "apps" : "grid"; return applyFocus();
    }
    if (name === "menu") { leaveBar(); return openCC(); }
    return;
  }
  if (S.overlay === "cc") {
    if (name === "back" || name === "menu") return closeCC();
    if (name === "up") return ccMove(-1);
    if (name === "down") return ccMove(1);
    if (name === "enter") return ccActivate();
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
      if (S.zone === "bar") { leaveBar(); S.zone = "apps"; return applyFocus(); }
      if (S.view !== "home") { setView("home"); S.zone = "apps"; return applyFocus(); }
      if (S.zone !== "apps") { S.zone = "apps"; return applyFocus(); }
      return;
    default:
  }
}

function closeAll() {
  if (S.overlay === "cc") closeCC();
  if (S.overlay === "settings") closeSettings();
}

function press(fn) {
  const node = $(".app.is-focused");
  if (!node) return fn();
  node.classList.add("pressed");
  setTimeout(() => { node.classList.remove("pressed"); fn(); }, 110);
}

/* pointer, for the browser: click focuses, a second click opens */
document.addEventListener("click", (e) => {
  if (S.overlay === "saver") return stopSaver();
  const tile = e.target.closest(".app");
  if (tile && !S.overlay) {
    const zone = tile.dataset.zone;
    const i = Number(tile.dataset.i);
    const same = S.zone === zone && (zone === "apps" ? S.app : S.grid) === i;
    S.zone = zone;
    if (zone === "apps") S.app = i; else S.grid = i;
    applyFocus();
    if (same) activate();
    return;
  }
  const segBtn = e.target.closest("#seg button");
  if (segBtn) { setView(segBtn.dataset.view); S.zone = "seg"; return applyFocus(); }
  const mi = e.target.closest(".mi");
  if (mi) { S.cc = Number(mi.dataset.i); paintCC(); return ccActivate(); }
  const row = e.target.closest("#setTrack .row");
  if (row) { S.set = Number(row.dataset.i); paintSettings(); return settingsActivate(); }
  if (e.target.id === "scrim") return closeCC();
  if (e.target.closest("#hubChip")) return openSettings();
});

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
  tick();
  loadCatalogue();
  renderViews();
  setInterval(tick, 10_000);
  setTimeout(() => { document.body.classList.add("booted"); $("#splash").classList.add("is-gone"); }, 2500);

  if (IN_HUB) {
    // The hub's own config and assistant: same name, same agent, same conversations.
    await loadScript("/hub-config.js");
    HUB.name = window.HUB_CONF?.name || HUB.name;
    await syncHub();
    if (await loadScript("/tabs/chat.js")) watchTypedReplies();
    setInterval(syncHub, 30_000); // the look follows the hub's Style panel
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
