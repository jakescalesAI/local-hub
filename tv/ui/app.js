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

import * as Stream from "./stream.js?v=3";
// The TV's own assistant screen (assistant.js): the hub's agent and conversation, without the hub's chat UI.
let Assistant = null;

const NATIVE = typeof window.LocalHubNative === "object" && window.LocalHubNative ? window.LocalHubNative : null;
const IN_HUB = location.pathname.startsWith("/tv");
// ?preview: the hub's Home editor shows this page, scaled, as its TV view. It looks and moves the same,
// but opens nothing, listens to nothing and takes no TV commands; the editor pushes its edits in.
const PREVIEW = new URLSearchParams(location.search).has("preview");
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
  plus: sym('<path d="M12 5v14M5 12h14"/>', 2.4),
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
   Icons (CC0) marks in ./brands, and opening one opens its website. `wordmark` is the app's long
   logo in ./brands, shown white as the header when the app is focused (see brands/NOTICE.md).
   On a TV the list and the art are the apps' own. */
const WEB_APPS = [
  { id: "netflix", name: "Netflix", bg: "#000000", fg: "#e50914", icon: "netflix", wordmark: "netflix-wordmark", url: "https://www.netflix.com/browse", recent: 2 },
  { id: "youtube", name: "YouTube", bg: "#ffffff", fg: "#ff0000", icon: "youtube", wordmark: "youtube-wordmark", url: "https://www.youtube.com/", recent: 26 },
  { id: "primevideo", name: "Prime Video", bg: "#00050d", fg: "#1aa8f0", icon: "primevideo", wide: true, wordmark: "primevideo-wordmark", url: "https://www.primevideo.com/", recent: 50 },
  { id: "disney", name: "Disney+", bg: "linear-gradient(160deg,#1f3fa3,#06123b)", fg: "#ffffff", letter: "Disney+", wordmark: "disney-wordmark", url: "https://www.disneyplus.com/" },
  { id: "max", name: "Max", bg: "linear-gradient(160deg,#002be7,#000d6b)", fg: "#ffffff", icon: "max", wordmark: "max-wordmark", url: "https://play.max.com/" },
  { id: "appletv", name: "Apple TV", bg: "#000000", fg: "#ffffff", icon: "appletv", wordmark: "appletv-wordmark", url: "https://tv.apple.com/" },
  { id: "plex", name: "Plex", bg: "#1f1f1f", fg: "#ebaf00", icon: "plex", wordmark: "plex-wordmark", url: "https://app.plex.tv/", recent: 72 },
  { id: "spotify", name: "Spotify", bg: "#121212", fg: "#1ed760", icon: "spotify", wordmark: "spotify-wordmark", url: "https://open.spotify.com/", recent: 96 },
  { id: "hulu", name: "Hulu", bg: "#1ce783", fg: "#0b0c0f", letter: "hulu", wordmark: "hulu-wordmark", url: "https://www.hulu.com/" },
  { id: "crunchyroll", name: "Crunchyroll", bg: "#f47521", fg: "#ffffff", icon: "crunchyroll", wordmark: "crunchyroll-wordmark", url: "https://www.crunchyroll.com/" },
  { id: "paramountplus", name: "Paramount+", bg: "linear-gradient(160deg,#0064ff,#002a8f)", fg: "#ffffff", icon: "paramountplus", wordmark: "paramountplus-wordmark", url: "https://www.paramountplus.com/" },
  { id: "twitch", name: "Twitch", bg: "#9146ff", fg: "#ffffff", icon: "twitch", wordmark: "twitch-wordmark", url: "https://www.twitch.tv/" },
  { id: "tubi", name: "Tubi", bg: "#7408ff", fg: "#ffff13", icon: "tubi", wordmark: "tubi-wordmark", url: "https://tubitv.com/" },
  { id: "kodi", name: "Kodi", bg: "linear-gradient(160deg,#30c4f2,#0d6f9e)", fg: "#ffffff", icon: "kodi", wordmark: "kodi-wordmark", url: "https://kodi.tv/" },
  { id: "steam", name: "Steam", bg: "linear-gradient(160deg,#2a475e,#171a21)", fg: "#ffffff", icon: "steam", url: "https://store.steampowered.com/" },
  { id: "vlc", name: "VLC", bg: "#ff8800", fg: "#ffffff", icon: "vlcmediaplayer", url: "https://www.videolan.org/vlc/" },
];
const DEMO_INPUTS = [
  { id: "hdmi1", name: "Apple TV 4K", sub: "HDMI 1" },
  { id: "hdmi2", name: "PlayStation 5", sub: "HDMI 2" },
];

/* ── prefs (this screen only; the look and widgets come from the hub) ──── */
const PREFS_KEY = "localhub.tv";
const DEFAULTS = { clock: "12-hour", inputs: true, saver: "5 min", speak: "After voice", help: true };
const DEVICE = NATIVE ? (safeJson(native("status"), {}) || {}) : {};
// On a TV the page is laid out at the WebView's small CSS size (960×540 on a 4K Fire TV); the chat bar, which
// lives outside the 1920×1080 canvas, is scaled the same way as the canvas so it keeps its proportions.
if (NATIVE) document.documentElement.classList.add("native");
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
/* On the TV the hub's gradient wallpapers become photos of the same name: 4K stock photos from Unsplash
   (credits in photos/NOTICE.txt). The plain ones (mono, noise) stay as they are. */
const TV_PHOTOS = { aurora: 1, dusk: 1, graphite: 1, ocean: 1, sand: 1 };
const wallUrl = (id) => (TV_PHOTOS[id] ? `./photos/${id}.jpg` : `./wallpapers/${id}.svg`);
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
  if (BUILTIN_WALLS[id]) return { image: `url("${wallUrl(id)}")`, tone: TV_PHOTOS[id] ? "photo" : BUILTIN_WALLS[id] };
  const g = (s.wallpaper.custom || []).find((w) => w.id === id);
  if (g) return { image: gradCss(g), tone: g.colors.reduce((t, c) => t + lum(c), 0) / g.colors.length < 0.4 ? "dark" : "light" };
  const u = (s.wallpaper.uploads || []).find((w) => w.id === id);
  if (u && IN_HUB) return { image: `url("/api/hub/wallpapers/${u.file}")`, tone: "" };
  return { image: 'url("./photos/aurora.jpg")', tone: "photo" };
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
  // No live glass anywhere: every blur, mask and blend mode was an extra GPU surface on a Fire TV Stick. The
  // look is flat tinted surfaces over the frozen wallpaper ("lite" in the CSS), on every screen.
  r.classList.add("lite");
  const w = wallFor(SETTINGS);
  const wall = $("#hub-wall");
  if (!w) { delete r.dataset.wall; wall.style.backgroundImage = ""; return; }
  r.dataset.wall = "1";
  wall.style.backgroundImage = w.image;
  bakeGlass();
  // A photo gets a middle scrim: enough for white names over a bright sky or sand, not so much it goes grey.
  r.style.setProperty("--hub-scrim", w.tone === "photo" ? ".3" : w.tone ? (w.tone === theme ? ".18" : ".55") : ".4");
  if (S.shelfId === "hub") paintShelf(true);
}

async function syncHub() {
  if (!IN_HUB) { applyLook(); return; }
  try {
    const r = await fetch("/api/hub/settings", { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    takeSettings(await r.json());
    HUB.on = true;
  } catch {
    HUB.on = false;
  }
  HUB.name = window.HUB_CONF?.name || HUB.name;
  HUB.owner = window.HUB_CONF?.owner || "";
  paintChip();
}
/* What the TV uses from the hub's settings: the look, the wallpaper, its app tiles (tv.apps,
   tv.hidden) and how it scrolls (scroll.tv). */
function takeSettings(next) {
  const look = (s) => JSON.stringify([s?.style, s?.wallpaper, s?.widgets?.tv]);
  const grid = (s) => JSON.stringify([s?.tv?.apps, s?.tv?.hidden, s?.scroll?.tv, s?.sites]);
  const saver = (s) => JSON.stringify(s?.tv?.saver || null);
  const lookChanged = look(next) !== look(SETTINGS);
  const gridChanged = grid(next) !== grid(SETTINGS);
  const saverChanged = SETTINGS && saver(next) !== saver(SETTINGS);
  SETTINGS = next;
  if (saverChanged) saverSettingsChanged();
  if (gridChanged) {
    const keep = S.touched ? ITEMS[S.i]?.id : null;
    loadItems();
    S.i = Math.max(0, ITEMS.findIndex((x) => x.id === keep));
    S.shelfId = null;
    renderGrid();
  }
  if (lookChanged) applyLook(); // repaints the shelf too
}
function paintChip() {
  $("#splashName").textContent = HUB.name;
  const g = $("#gearBtn");
  g.classList.toggle("on", HUB.on);
  g.title = `${HUB.name}: ${HUB.on ? "connected" : "not connected"}`;
}

/* ── the items: LocalHub first, then the apps, the inputs, Settings ────── */

// An installed app gets the same wordmark as its stand-in when the names match ("Disney+", "Apple TV").
const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const wordmarkFor = (name) => WEB_APPS.find((w) => nameKey(w.name) === nameKey(name))?.wordmark || null;

/* Your own websites: the hub's website apps (Home editor, or "Add website" here), opened in the laptop's
   browser on the TV like the built-in ones. Their icons come from the hub; with none, the first letter shows. */
function siteApps() {
  return (Array.isArray(SETTINGS?.sites) ? SETTINGS.sites : []).filter((s) => s && s.url).map((s) => ({
    // A colour of its own from the name, so a site without an icon still reads as its own tile.
    id: s.id, name: s.name || s.url, url: s.url, kind: "site", fg: "#ffffff",
    bg: `linear-gradient(160deg, hsl(${[...String(s.name || s.url)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 55% 42%), hsl(${[...String(s.name || s.url)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 60% 22%))`,
    letter: String(s.name || "").trim().slice(0, 1).toUpperCase() || "•", siteIcon: `/api/hub/app-icon/${encodeURIComponent(s.id)}`,
  }));
}
function removeSitePress(it) {
  if (S.removeAsk?.id === it.id && Date.now() - S.removeAsk.at < 4000) {
    S.removeAsk = null;
    fetch("/api/hub/settings", { method: "POST", headers: { "content-type": "application/json", "x-hub": "1" }, body: JSON.stringify({ sites: { remove: [it.id] } }) })
      .then((r) => (r.ok ? syncHub().then(() => toast(`Removed ${it.name}`)) : toast("LocalHub couldn't remove it")), () => toast("LocalHub didn't answer"));
    return;
  }
  S.removeAsk = { id: it.id, at: Date.now() };
  toast(`Press ☰ again to remove ${it.name}`);
}
async function addSite(text) {
  let raw = String(text || "").trim();
  if (!raw) return;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let u;
  try { u = new URL(raw); } catch { return toast("That doesn't look like a web address"); }
  if (!u.hostname.includes(".")) return toast("Type the whole address, like espn.com");
  const base = u.hostname.replace(/^www\./, "").split(".")[0];
  const name = base.charAt(0).toUpperCase() + base.slice(1);
  try {
    const r = await fetch("/api/hub/settings", { method: "POST", headers: { "content-type": "application/json", "x-hub": "1" }, body: JSON.stringify({ sites: { add: [{ name, url: u.href }] } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast(j.error || "LocalHub couldn't add it");
    await syncHub();
    const at = ITEMS.findIndex((x) => x.kind === "site" && x.url === u.href);
    if (at >= 0) { S.zone = "grid"; S.i = at; applyFocus(); }
    toast(`Added ${name}`);
  } catch { toast("LocalHub didn't answer"); }
}

function loadItems() {
  if (NATIVE) {
    APPS = safeJson(native("apps") || "[]", []).map((a) => ({
      id: a.id, pkg: a.id, name: a.name, banner: a.banner || null, img: a.icon || null,
      bg: a.color || "#2c2c2e", fg: "#ffffff", recentAt: a.recent || 0, wordmark: wordmarkFor(a.name),
    }));
    if (IN_HUB) APPS.push(...Stream.STREAM_APPS.map((a) => ({ ...a, note: Stream.noteFor(a) })), ...siteApps());
    INPUTS = safeJson(native("inputs") || "[]", []);
  } else {
    const now = Date.now();
    const opened = safeJson((() => { try { return localStorage.getItem("localhub.tv.opened"); } catch { return null; } })(), {}) || {};
    APPS = [...WEB_APPS, ...(IN_HUB ? [...Stream.STREAM_APPS, ...siteApps()] : [])].map((a) => ({ ...a, note: Stream.noteFor(a), recentAt: opened[a.id] || (a.recent ? now - a.recent * 3600e3 : 0) }));
    INPUTS = DEMO_INPUTS;
  }
  if (!prefs.inputs) INPUTS = [];
  ITEMS = [
    ...tvApps(),
    ...INPUTS.map((i) => ({ ...i, kind: "input" })),
    ...(IN_HUB && !PREVIEW ? [{ id: "add-site", kind: "addsite", name: "Add website" }] : []),
    { id: "settings", kind: "settings", name: "Settings" },
  ];
  S.i = clamp(S.i, 0, ITEMS.length - 1);
}

/* The app tiles. With no order saved in the hub (tv.apps) it's tvOS's: the four you opened last on
   the top row, then the rest A to Z. A saved order puts those first; an app it doesn't name yet (just
   installed, say) follows in the default order. tv.hidden leaves apps out. */
function defaultOrder() {
  const byRecent = [...APPS].sort((a, b) => (b.recentAt || 0) - (a.recentAt || 0) || a.name.localeCompare(b.name));
  const top = byRecent.slice(0, COLS);
  return [...top, ...APPS.filter((a) => !top.includes(a)).sort((a, b) => a.name.localeCompare(b.name))];
}
function tvApps() {
  const order = Array.isArray(SETTINGS?.tv?.apps) ? SETTINGS.tv.apps : [];
  const hidden = new Set(Array.isArray(SETTINGS?.tv?.hidden) ? SETTINGS.tv.hidden : []);
  const base = defaultOrder();
  const listed = order.map((id) => APPS.find((a) => a.id === id)).filter(Boolean);
  return [...listed, ...base.filter((a) => !listed.includes(a))].filter((a) => !hidden.has(a.id));
}

function iconHTML(it) {
  if (it.kind === "hub") return `<div class="icon hub"><img src="./hub.svg" alt=""></div>`;
  if (it.kind === "settings") return `<div class="icon" style="--a-bg:linear-gradient(160deg,#8e8e93,#3a3a3c);--a-fg:#fff">${SYM.gear}</div>`;
  if (it.kind === "addsite") return `<div class="icon add" style="--a-bg:#1f2129;--a-fg:#fff"><i class="fill"></i>${SYM.plus}</div>`;
  if (it.kind === "site") return `<div class="icon" style="--a-bg:${it.bg};--a-fg:${it.fg}"><i class="fill"></i><b class="letter">${esc(it.letter)}</b><img class="square site" src="${esc(it.siteIcon)}" alt="" decoding="async" onerror="this.remove()"></div>`;
  if (it.kind === "input") return `<div class="icon" style="--a-bg:linear-gradient(160deg,#2c2c2e,#0b0b0d);--a-fg:#fff">${SYM.input}<span class="sub">${esc(it.sub || "HDMI")}</span></div>`;
  const colors = `--a-bg:${it.bg};--a-fg:${it.fg}`;
  const fill = '<i class="fill"></i>';
  if (it.banner) return `<div class="icon" style="${colors}"><img src="${esc(it.banner)}" alt="" decoding="async"></div>`;
  if (it.img) return `<div class="icon" style="${colors}">${fill}<img class="square" src="${esc(it.img)}" alt="" decoding="async"></div>`;
  if (it.icon) return `<div class="icon" style="${colors}">${fill}<i class="glyph${it.wide ? " wide" : ""}" style="--glyph:url('./brands/${it.icon}.svg')"></i>${it.note ? `<span class="sub">${esc(it.note)}</span>` : ""}</div>`;
  return `<div class="icon" style="${colors}">${fill}<b class="letter"${it.letter && it.letter.length > 4 ? ' style="font-size:58px"' : ""}>${esc(it.letter || it.name.slice(0, 1))}</b></div>`;
}

// Tiles are kept and only reordered when the list changes (coming back from an app moves it to the front):
// rebuilding them all reloaded every picture, and the row popped in tile by tile.
function renderGrid() {
  const grid = $("#grid");
  const old = new Map();
  grid.querySelectorAll(".app").forEach((n) => old.set(n.dataset.k, n));
  const nodes = ITEMS.map((it, i) => {
    const k = `${it.kind || "app"}:${it.id}`;
    const html = `${iconHTML(it)}<span class="name">${esc(it.name)}</span>`;
    let n = old.get(k);
    if (!n || n._html !== html) {
      n = document.createElement("div");
      n.className = "app";
      n.dataset.k = k;
      n.innerHTML = html;
      n._html = html;
    }
    old.delete(k);
    n.dataset.i = String(i);
    return n;
  });
  const same = nodes.length === grid.children.length && nodes.every((n, i) => grid.children[i] === n);
  if (!same) grid.replaceChildren(...nodes);
  applyFocus(true);
  warmTiles();
}
// While the opening still covers the screen, step the page through every row once, so the TV draws each row's
// tiles now rather than on the first scroll down (that first pass stalled up to 400 ms on a Fire TV Stick).
async function walkRows() {
  const page = $("#page");
  const rows = Math.ceil(ITEMS.length / COLS);
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  page.style.transition = "none";
  // Two rows a step: the screen shows about two and a half, and the TV also draws a margin around what it shows.
  for (let row = 1; row < rows; row += 2) {
    if (document.body.classList.contains("booted")) break;
    page.style.transform = `translateY(${-(648 + row * 236 - 400)}px)`;
    await frame();
  }
  // Settings and the assistant too: their first opening otherwise drew a whole screen at 4K (100-480 ms frames).
  if (!document.body.classList.contains("booted")) {
    const set = $("#settings");
    renderSettings();
    set.style.transition = "none";
    set.classList.add("on");
    await frame();
    set.classList.remove("on");
    setView("assistant");
    await frame();
    setView(S.view);
    set.style.transition = "";
  }
  applyFocus(true);
}
// Decode every tile's image once, a moment after the grid is drawn, so the first scroll down doesn't decode
// them while the rows come into view (~140 ms of decoding on a Fire TV Stick, measured). One at a time, idle.
async function warmTiles() {
  const imgs = [...document.querySelectorAll("#grid img")];
  await wait(1200);
  for (const img of imgs) {
    if (!img.isConnected) return;
    try { await img.decode(); } catch { /* broken image: skipped as before */ }
  }
}

/* ── focus: the tvOS lift, tilt and glare ──────────────────────────────── */

function applyFocus(instant) {
  document.querySelectorAll(".app.is-focused").forEach((n) => n.classList.remove("is-focused"));
  $("#gearBtn").classList.toggle("focus", S.zone === "status" && !S.overlay);
  if (S.zone === "grid" && !S.overlay) $(`.app[data-i="${S.i}"]`)?.classList.add("is-focused");

  const row = Math.floor(S.i / COLS);
  const inGrid = S.zone === "grid" && row > 0;
  const grid = inGrid || (S.zone === "bar" && !atTop());
  // Light glass: the body class would make a Fire TV Stick recompute style for every tile (30-50 ms, measured),
  // so only the shelf fades, set on that one element (~1 ms), and the other tiles aren't dimmed.
  if (document.documentElement.classList.contains("lite")) {
    document.body.classList.remove("in-grid");
    const shelf = $(".shelf");
    if (shelf && (shelf.style.opacity === "0") !== grid) shelf.style.opacity = grid ? "0" : "";
    // The clock rides over the Top Shelf; in the rows it would sit on the top tiles, so it steps aside.
    const when = $(".when");
    if (when && (when.style.opacity === "0") !== grid) when.style.opacity = grid ? "0" : "";
  } else document.body.classList.toggle("in-grid", grid);
  // Row 0 sits on the Top Shelf. Further down, in one long scroll (the default, like tvOS) the
  // focused row rides about a third of the way up; in pages the rows move three at a time.
  const paged = SETTINGS?.scroll?.tv === "pages";
  const first = 1 + Math.floor((row - 1) / 3) * 3;
  const y = !inGrid ? 0 : paged ? -(648 + first * 236 - 190) : -(648 + row * 236 - 400);
  // A page shows its own rows: the ones before it leave with it instead of hanging under the clock.
  document.querySelectorAll(".app").forEach((n) => {
    const off = paged && inGrid && Math.floor(Number(n.dataset.i) / COLS) < first;
    if ((n.style.opacity === "0") !== off) { n.style.transition = "opacity .45s"; n.style.opacity = off ? "0" : ""; }
  });
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
    else if (dx < 0) return openRail();
    else return tilt(dx * 1.6, 0); // the edge: lean into it, like tvOS
  }
  if (dy < 0) {
    if (row === 0) return tilt(0, -1.6);
    S.i -= COLS;
  }
  if (dy > 0) {
    if (row === lastRow) return tilt(0, 1.6);
    S.i = Math.min(S.i + COLS, n - 1);
  }
  applyFocus();
  tilt(dx, dy);
}

/* ── the Top Shelf ─────────────────────────────────────────────────────── */

function paintShelf(force) {
  // In Light glass the header waits until focus rests, so holding an arrow doesn't redraw it for every tile passed.
  if (!force && document.documentElement.classList.contains("lite")) {
    clearTimeout(paintShelf.t);
    paintShelf.t = setTimeout(() => paintShelf(true), 140);
    return;
  }
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

/* The header is the app's banner in white, like tvOS: its own wordmark where we have one
   (./brands/<id>-wordmark.svg), and otherwise its name set large in its place. No icon, no caption. */
function appShelfHTML(it) {
  const mark = it.wordmark
    ? `<span class="banner-mark"><i style="--glyph:url('./brands/${esc(it.wordmark)}.svg')"></i></span>`
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
  // Like every other app: its name as the white banner, with no widgets under it.
  return `<div class="shelf-title" aria-label="${esc(HUB.name)}"><h1 class="banner-text">${esc(HUB.name)}</h1></div>`;
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
  if (PREVIEW) return;
  if (S.zone === "status") return openCC();
  if (S.zone === "bar") return HUB.on ? focusBar() : openPairing();
  const it = ITEMS[S.i];
  if (!it) return;
  if (it.kind === "hub") return openHubApp();
  if (it.kind === "settings") return openSettings();
  if (it.kind === "addsite") return openModal("Add a website", "Its address, like espn.com or max.com. It opens in the laptop's browser.", "", addSite);
  if (it.kind === "site") return Stream.engineFor(it) ? openInStream(it) : toast("The browser runs on the laptop: install Chrome or Chromium there");
  if (it.kind === "input") return launch(it, () => (NATIVE ? native("switchInput", it.id) : true), `Switching to ${it.name}`);
  if (it.stream || (!NATIVE && IN_HUB && Stream.engineFor(it))) return openInStream(it);
  return launch(it, () => openApp(it));
}

/* The TV's browsers (stream.js): Chromium and Chrome on the laptop, shown full screen here. On a laptop the web
   apps open in them too, inside LocalHub; a new window is only for when this laptop has no browser to use. */
function openInStream(it) {
  remember(it);
  const tile = $(`.app[data-i="${ITEMS.indexOf(it)}"] .icon`)?.getBoundingClientRect();
  Stream.open(it, tile).then((ok) => {
    if (ok || !it.url) return;
    toast("No Chrome or Chromium here to open it in, so it opens in a new window");
    launch(it, () => openApp(it, true));
  });
}

/* On a TV, Java starts the app. On a laptop, the website opens inside LocalHub in one of its browsers,
   or, with none on this laptop, in a new window; coming back to this one settles the icon into the grid. */
function openApp(app, windowOnly) {
  if (NATIVE) return native("launch", app.pkg) !== false;
  if (!windowOnly && IN_HUB && Stream.engineFor(app)) { openInStream(app); return true; }
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
  const w = r.width / k, h = r.height / k;
  const s = Math.max(1920 / w, 1080 / h);
  Object.assign(icon.style, { width: `${w}px`, height: `${h}px`, transform: `translate(${(r.left - stage.left) / k}px, ${(r.top - stage.top) / k}px)`, transition: "none" });
  layer.prepend(icon);
  $("#launchNote").textContent = NATIVE ? "" : note ? `${note} — on a TV this switches the input` : it.url ? (IN_HUB && Stream.engineFor(it) ? `Opening ${it.name}…` : `Opening ${it.name} in a new window…`) : `${it.name} isn't on this laptop`;
  setOverlay("launch");
  layer.classList.add("on");
  requestAnimationFrame(() => requestAnimationFrame(() => { icon.style.transition = ""; icon.style.transform = `translate(${(1920 - w * s) / 2}px, ${(1080 - h * s) / 2}px) scale(${s})`; layer.classList.add("full"); }));
  setTimeout(() => {
    const ok = go();
    if (NATIVE && ok !== false) return; // haven.resumed() tidies up when we're back
    if (ok === false && it.url === undefined && it.kind !== "input" && !NATIVE) { setTimeout(endLaunch, 1100); return; }
    if (ok === false) toast(`${it.name} didn't start`);
    setTimeout(endLaunch, ok === "pending" ? 300 : document.hidden ? 0 : 1300);
  }, 380); // the app starts while the tile is still finishing its grow
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
  // LocalHub isn't an app on the grid any more: it opens from here.
  tiles.push({ id: "dashboard", cls: "w2", ic: HOUSE_IC, t1: "LocalHub", t2: IN_HUB ? "Open the hub" : "Pair this TV first" });
  tiles.push({ id: "ask", cls: "w2", ic: SYM.mic, t1: "Ask LocalHub", t2: NATIVE ? "⏯ on the remote" : "Space on the keyboard" });
  const chats = (LIVE.chats || []).slice(0, 3);
  if (chats.length) {
    tiles.push({ sect: "Recent chats" });
    for (const c of chats) tiles.push({ id: `chat:${c.id}`, cls: "w4 chat", ic: CHAT_IC, t1: c.title || "Chat", t2: c.running ? "Answering now" : ago(c.updated) });
  }
  tiles.push({ sect: NATIVE ? "This TV" : "This screen" });
  tiles.push({ id: "tvlayout", cls: "w2", ic: SYM.sliders, t1: "TV layout", t2: "Pick what shows here" });
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
    tiles.push({ id: "tvsetup", cls: "w2", ic: SYM.input, t1: "Set up a TV", t2: "Install, connect, pair" });
  }
  return tiles;
}
const HOUSE_IC = sym('<path d="M3 11 12 3l9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>');
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
    IN_HUB && !PREVIEW
      ? { id: "saverSource", t1: "Screensaver photos", t2: saverSourceNote(), v: saverSourceName() }
      : { info: true, t1: "Screensaver photos", t2: "Chosen in LocalHub", v: "Wallpapers" },
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
  const track = $("#setTrack");
  const html = model.map((it, i) => {
    if (it.title) return `<h1 class="set-title">${esc(it.title)}</h1>`;
    if (it.group) return `<div class="set-group">${esc(it.group)}</div>`;
    const v = valueOf(it);
    return `<div class="row${it.info ? " info" : ""}" data-i="${i}"><div class="txt"><div class="t1">${esc(it.t1)}</div>${it.t2 ? `<div class="t2">${esc(it.t2)}</div>` : ""}</div><div class="v${it.on || v === "On" ? " on" : ""}">${esc(v)}${SYM.chev}</div></div>`;
  }).join("");
  // Settings is drawn again once the hub's live state arrives: only rebuild the list if something in it changed.
  if (track._html !== html) { track.innerHTML = html; track._html = html; }
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
  else if (it.id === "saverSource") return cycleSaverSource();
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
function toast(msg, ms = msg.length > 70 ? 5200 : 2400) {
  const n = $("#toast");
  n.textContent = msg;
  n.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => n.classList.remove("on"), ms);
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
  if (S.overlay === "saver") paintSaverHud();
  if (S.shelfId === "hub" && !S.overlay) $("#shelfBody").innerHTML = hubShelfHTML();
}
let saverTimer = 0;
function armSaver() {
  clearTimeout(saverTimer);
  if (PREVIEW) return;
  const mins = parseInt(prefs.saver, 10);
  if (!mins || S.overlay === "saver") return;
  saverTimer = setTimeout(() => { if (!S.overlay && S.zone !== "bar") startSaver(); }, mins * 60000);
}

/* The screensaver: photos from the library chosen in LocalHub (tv.saver: the hub's wallpapers, this
   computer's Pictures or iCloud Photos, or a folder; tv-saver.mjs serves them), one after another with a
   slow crossfade and, unless it's set to Fade or the glass is Light, a slow Ken Burns move. The next
   photo is loaded before its turn. Over them, bottom left like tvOS: the time, the date and the widgets
   picked for it, as glass cards. With no hub, or a library that is empty or fails, the wallpapers show. */
const SAVER_DEFAULT = { source: "wallpapers", folder: "", interval: 12, shuffle: true, motion: "kenburns", widgets: ["clock", "date"] };
const SAVER_SOURCES = { wallpapers: "Wallpapers", pictures: "Pictures", icloud: "iCloud Photos", folder: "Folder" };
const SAVER_WALLS = Object.keys(BUILTIN_WALLS).map((id) => ({ id: `wall-${id}`, url: wallUrl(id) }));
const SAVER_FADE = 1800;
const SAVER_STALE = 5 * 60e3;
// Ken Burns: where a photo starts and ends. Slow, and never far enough to show an edge.
const KB = [
  ["scale(1.03) translate3d(0,0,0)", "scale(1.16) translate3d(-2.5%,-1.5%,0)"],
  ["scale(1.16) translate3d(2.5%,1.5%,0)", "scale(1.04) translate3d(0,0,0)"],
  ["scale(1.05) translate3d(2%,-1.5%,0)", "scale(1.17) translate3d(-2%,1.5%,0)"],
  ["scale(1.15) translate3d(-2.5%,1%,0)", "scale(1.04) translate3d(1.5%,-1%,0)"],
];
const SAVER = { photos: [], source: null, at: 0, loading: null, order: [], last: -1, gen: 0, timer: 0, front: null, fails: 0, preload: null };
const saverSettings = () => ({ ...SAVER_DEFAULT, ...(SETTINGS?.tv?.saver || {}) });
const saverLayers = () => [$("#saverA"), $("#saverB")];

function loadSaverPhotos(force) {
  if (SAVER.loading && !force) return SAVER.loading;
  SAVER.loading = (async () => {
    let photos = [], source = null;
    if (IN_HUB) {
      try {
        const r = await fetch(`/api/tv/saver${force ? "?refresh=1" : ""}`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        photos = (Array.isArray(j.photos) ? j.photos : []).filter((p) => p && typeof p.url === "string");
        source = j.source || null;
      } catch {
        source = { id: saverSettings().source, label: SAVER_SOURCES[saverSettings().source], ok: false, error: "LocalHub didn’t answer, so the wallpapers show.", fallback: true };
      }
    }
    SAVER.photos = photos.length ? photos : SAVER_WALLS;
    SAVER.source = source || { id: "wallpapers", label: "Wallpapers", ok: true, count: SAVER_WALLS.length };
    SAVER.at = Date.now();
    SAVER.order = [];
    SAVER.fails = 0;
  })().finally(() => { SAVER.loading = null; });
  return SAVER.loading;
}

// Shuffled, a whole round before any photo comes back, and never the same one twice in a row.
function dealSaver() {
  const ids = SAVER.photos.map((_, i) => i);
  if (saverSettings().shuffle) {
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    if (ids.length > 1 && ids[0] === SAVER.last) ids.push(ids.shift());
  }
  SAVER.order = ids;
}
function takePhoto() {
  if (!SAVER.order.length) dealSaver();
  SAVER.last = SAVER.order.shift() ?? -1;
  return SAVER.photos[SAVER.last];
}
function preloadNext() {
  if (!SAVER.order.length) dealSaver();
  const next = SAVER.photos[SAVER.order[0]];
  if (!next) return;
  SAVER.preload = new Image();
  SAVER.preload.decoding = "async";
  SAVER.preload.src = next.url;
}

async function showNextPhoto(gen) {
  if (gen !== SAVER.gen) return;
  clearTimeout(SAVER.timer);
  const set = saverSettings();
  const photo = takePhoto();
  if (!photo) return;
  const [a, b] = saverLayers();
  const layer = SAVER.front === a ? b : a;
  const img = layer.querySelector("img");
  img.style.animation = "none";
  img.src = photo.url;
  try {
    await img.decode();
  } catch {
    // A photo that won't load (gone, or a format this TV can't draw) is skipped. If many fail, the wallpapers take over.
    if (gen !== SAVER.gen) return;
    if (++SAVER.fails >= 6 && SAVER.photos !== SAVER_WALLS) { SAVER.photos = SAVER_WALLS; SAVER.order = []; SAVER.fails = 0; }
    SAVER.timer = setTimeout(() => showNextPhoto(gen), 400);
    return;
  }
  if (gen !== SAVER.gen) return;
  SAVER.fails = 0;
  const lite = document.documentElement.classList.contains("lite");
  // A tall photo (a phone's) shows whole, over a soft, dim copy of itself, instead of losing its top and bottom.
  const tall = img.naturalWidth > 0 && img.naturalWidth / img.naturalHeight < 1.2;
  layer.classList.toggle("tall", tall);
  layer.querySelector(".bd").style.backgroundImage = tall && !lite ? `url("${photo.url.replace(/["\\]/g, "")}")` : "";
  void img.offsetWidth; // restart the move
  if (set.motion === "kenburns" && !lite) {
    const [from, to] = KB[Math.floor(Math.random() * KB.length)];
    img.style.setProperty("--kb-from", from);
    img.style.setProperty("--kb-to", to);
    img.style.animation = `saverKB ${set.interval * 1000 + SAVER_FADE * 2}ms linear both`;
  } else {
    img.style.animation = "";
  }
  const old = SAVER.front;
  saverLayers().forEach((l) => l.classList.remove("was"));
  if (old) { old.classList.remove("on"); old.classList.add("was"); }
  layer.classList.add("on");
  SAVER.front = layer;
  // The old photo stays under the new one until the fade is done, then lets go of its image.
  setTimeout(() => { if (old && !old.classList.contains("on")) { old.classList.remove("was"); old.querySelector("img").style.animation = "none"; } }, SAVER_FADE + 100);
  if (SAVER.photos.length > 1) {
    preloadNext();
    SAVER.timer = setTimeout(() => showNextPhoto(gen), set.interval * 1000);
  }
}

function paintSaverHud() {
  const w = saverSettings().widgets;
  const d = new Date(), t = clockParts(d);
  const time = w.includes("clock") ? `<div class="saver-time">${esc(t.hm)}${t.ap ? `<small>${t.ap}</small>` : ""}</div>` : "";
  const date = w.includes("date") ? `<div class="saver-date">${esc(d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }))}</div>` : "";
  const cards = w.filter((id) => id !== "clock" && id !== "date" && WIDGETS[id]).map(widgetCard).join("");
  $("#saverHud").innerHTML = `${time || date ? `<div class="saver-when">${time}${date}</div>` : ""}${cards ? `<div class="saver-cards">${cards}</div>` : ""}`;
}
// A library that couldn't be used says so for a few seconds, then the wallpapers carry on alone.
function paintSaverNote() {
  const n = $("#saverNote"), src = SAVER.source;
  clearTimeout(paintSaverNote.t);
  n.textContent = src?.fallback && src.error ? src.error : "";
  n.classList.toggle("on", !!n.textContent);
  if (n.textContent) paintSaverNote.t = setTimeout(() => n.classList.remove("on"), 9000);
}

async function startSaver() {
  tick();
  const gen = ++SAVER.gen;
  $("#saver").classList.add("on");
  setOverlay("saver");
  paintSaverHud();
  if (!SAVER.photos.length || Date.now() - SAVER.at > SAVER_STALE) await loadSaverPhotos();
  if (gen !== SAVER.gen) return;
  paintSaverNote();
  showNextPhoto(gen);
}
function stopSaver() {
  SAVER.gen++;
  clearTimeout(SAVER.timer);
  $("#saver").classList.remove("on");
  $("#saverNote").classList.remove("on");
  setOverlay(null);
  armSaver();
  // Once it has faded away, nothing keeps moving or holds a photo.
  const gen = SAVER.gen;
  setTimeout(() => {
    if (gen !== SAVER.gen) return;
    saverLayers().forEach((l) => { l.classList.remove("on", "was", "tall"); const img = l.querySelector("img"); img.style.animation = "none"; img.removeAttribute("src"); l.querySelector(".bd").style.backgroundImage = ""; });
    SAVER.front = null;
  }, 1500);
}
// The hub's tv.saver changed (here, in the hub's editor, or on another TV): new photos, motion and widgets.
function saverSettingsChanged() {
  SAVER.at = 0;
  if (PREVIEW) return;
  loadSaverPhotos(true).then(() => {
    if (S.overlay === "saver") { const gen = ++SAVER.gen; paintSaverHud(); paintSaverNote(); showNextPhoto(gen); }
    if (S.overlay === "settings") renderSettings();
  });
}

// Settings › Screensaver photos: which library, and how it's doing.
function saverSourceName() {
  const set = saverSettings();
  return set.source === "folder" && set.folder ? set.folder.split(/[\\/]/).filter(Boolean).pop() || "Folder" : SAVER_SOURCES[set.source] || "Wallpapers";
}
function saverSourceNote() {
  const src = SAVER.source;
  if (!src || src.id !== saverSettings().source) return "Wallpapers, Pictures, iCloud Photos, or a folder chosen in LocalHub";
  if (src.fallback) return "Not available here, so the wallpapers show";
  const n = Number(src.count) || SAVER.photos.length;
  return `${n.toLocaleString()} photo${n === 1 ? "" : "s"}${src.truncated ? " (the first ones)" : ""}`;
}
async function cycleSaverSource() {
  const set = saverSettings();
  const order = ["wallpapers", "pictures", "icloud", ...(set.folder ? ["folder"] : [])];
  const source = order[(order.indexOf(set.source) + 1) % order.length];
  // Shown at once; the hub's answer settles it.
  SETTINGS = { ...(SETTINGS || {}), tv: { ...(SETTINGS?.tv || {}), saver: { ...set, source } } };
  SAVER.source = null;
  renderSettings();
  try {
    const r = await fetch("/api/hub/settings", { method: "POST", headers: { "content-type": "application/json", "x-hub": "1" }, body: JSON.stringify({ tv: { saver: { source } } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `LocalHub answered ${r.status}`);
    SETTINGS = j;
    await loadSaverPhotos(true);
    const src = SAVER.source;
    toast(src?.fallback ? src.error || `${saverSourceName()} isn’t available here` : `Screensaver: ${saverSourceName()}, ${saverSourceNote()}`);
  } catch (err) {
    SETTINGS = { ...(SETTINGS || {}), tv: { ...(SETTINGS?.tv || {}), saver: set } };
    toast(`Couldn’t change the screensaver: ${err.message}`);
  }
  if (S.overlay === "settings") renderSettings();
}

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
      // A Fire TV Stick opens a recorder that never delivers a frame (the remote's mic belongs to Alexa), and the
      // read blocks. No level within 2.5 s means no mic: say so once, and don't try again this session.
      const NO_MIC = "This TV has no microphone LocalHub can use. Press OK on the box, then hold the remote's mic button to dictate";
      if (MIC.none) return Promise.reject(new Error(`${NO_MIC}.`));
      return new Promise((resolve, reject) => {
        const dog = setTimeout(() => {
          if (MIC.wait?.dog !== dog) return;
          MIC.none = true;
          MIC.wait = null;
          native("cancelListening");
          reject(new Error(`${NO_MIC}, or say “Alexa, ask local hub …”.`));
        }, 2500);
        const heard = (v) => { clearTimeout(dog); onLevel?.(v); };
        MIC.wait = { resolve, reject, onLevel: heard, onWorking, dog };
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
  if (S.overlay === "stream" && cmd.type !== "say" && cmd.type !== "answer") Stream.close();
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
}
/* ── Java → page ───────────────────────────────────────────────────────── */
// Back from an app, the TV redraws the whole home screen (about a second of slow frames on a Fire TV Stick). The
// Home cover stays up until eight frames in a row come quickly (2.3 s at most), then goes: the screen appears finished.
function whenDrawn() {
  if (!NATIVE) return;
  const t0 = performance.now();
  let last = t0, quick = 0;
  const step = (now) => {
    quick = now - last < 25 ? quick + 1 : 0;
    last = now;
    if (quick >= 8 || now - t0 > 2300) return native("drawn");
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

window.haven = {
  key: (name) => handleKey(name),
  // The remote's Home: back to the first row of the home screen, with nothing open over it.
  home: () => {
    if (S.overlay === "saver") stopSaver();
    if (S.overlay === "launch") endLaunch();
    if (S.overlay === "stream") Stream.close?.();
    if (S.overlay === "hub") closeHub();
    if (S.overlay === "modal") closeModal(false);
    if (S.overlay === "settings") closeSettings();
    if (S.overlay === "cc") closeCC();
    closeRail();
    if (S.view !== "home") showView("home");
    S.zone = "grid";
    S.i = 0;
    applyFocus();
  },
  closeHub: () => closeHub(),
  resumed: () => { endLaunch(); whenDrawn(); },
  // Until the first key press, the list filling in (the TV's apps arrive a moment after the page) keeps focus on
  // the first app; after it, focus stays on the app you were on.
  appsChanged: () => { const keep = S.touched ? ITEMS[S.i]?.id : null; loadItems(); S.i = Math.max(0, ITEMS.findIndex((x) => x.id === keep)); S.shelfId = null; renderGrid(); APPS_READY.resolve?.(); },
  onNative(evt) {
    if (!evt) return;
    if (evt.type === "hubLine") return pending.get(evt.id)?.line(evt.line);
    if (evt.type === "hubEnd") { const p = pending.get(evt.id); pending.delete(evt.id); return p?.end(evt); }
    if (evt.type === "level") return MIC.wait?.onLevel?.(evt.value);
    if (evt.type === "audio") return nativeClipReady();
    if (evt.type === "noSpeech") { MIC.wait?.resolve(""); MIC.wait = null; return; }
    if (evt.type === "launchFailed") { const app = APPS.find((a) => a.pkg === evt.pkg); toast(`${app?.name || "That app"} didn't start`); return endLaunch(); }
    if (evt.type === "micError") { const w = MIC.wait; MIC.wait = null; return w ? w.reject(new Error(`${evt.message || "No microphone here."} Or say “Alexa, ask local hub …”.`)) : toast(evt.message || "No microphone"); }
    if (evt.type === "hub") {
      HUB.searching = false;
      HUB.url = evt.url || "";
      HUB.paired = Boolean(evt.paired);
      HUB.name = evt.name || HUB.name;
      if (!HUB.url) toast("LocalHub isn't reachable on this network yet");
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
  if (PREVIEW && !/^Arrow/.test(e.key)) return; // a preview moves, and nothing more
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
  // The assistant's field has the keyboard: letters, Space and Backspace are typing, but the remote's arrows,
  // OK, Back and ⏯ still drive the screen (it moves the caret itself), and Left at the field's edge opens the sidebar.
  if (S.view === "assistant" && e.target?.closest?.("#assistantView") && e.target.tagName === "INPUT") {
    const as = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Enter: "enter", Escape: "back", MediaPlayPause: "ai" }[e.key];
    if (!as || e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    return handleKey(as);
  }
  if (document.activeElement?.tagName === "INPUT") return;
  const name = KEYMAP[e.key];
  if (!name) return;
  e.preventDefault();
  handleKey(name);
}, true);

/* ── the sidebar (Netflix-style): Home, Assistant, Browser, Screensaver, Settings ─────────────────
   Collapsed it is a column of icons; with focus on it, a panel slides out with the labels. Both are
   transforms and opacity only, over the frozen glass, so opening it costs the GPU nothing to draw. */
const RAIL = [
  { id: "home", label: "Home", ic: sym('<path d="M3 11 12 3l9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>') },
  { id: "assistant", label: "Assistant", ic: sym('<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>') },
  { id: "browser", label: "Browser", ic: sym('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>') },
  { id: "saver", label: "Screensaver", ic: sym('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>') },
  { id: "settings", label: "Settings", ic: SYM.gear, foot: true },
];
S.view = "home";
S.rail = 0;
function renderRail() {
  // Settings sits on its own at the foot of the rail, like Netflix; up and down still walk the whole list.
  const item = (r, i) => `<div class="rail-item" data-r="${i}" data-id="${r.id}"><span class="ic">${r.ic}</span><span class="lb">${esc(r.label)}</span></div>`;
  $("#railItems").innerHTML = RAIL.map((r, i) => (r.foot ? "" : item(r, i))).join("");
  $("#railFoot").innerHTML = RAIL.map((r, i) => (r.foot ? item(r, i) : "")).join("");
  paintRail();
}
function paintRail() {
  document.querySelectorAll(".rail-item").forEach((n) => {
    n.classList.toggle("sel", S.zone === "rail" && Number(n.dataset.r) === S.rail);
    n.classList.toggle("here", n.dataset.id === S.view);
  });
}
function railOpen(on) {
  $("#rail").classList.toggle("open", on);
}
function openRail() {
  if (S.overlay && S.overlay !== "settings") return;
  if (S.overlay === "settings") closeSettings();
  S.railFrom = S.zone;
  S.zone = "rail";
  S.rail = Math.max(0, RAIL.findIndex((r) => r.id === S.view));
  railOpen(true);
  // The tile stays lifted behind the sidebar: dropping it and lifting it again on close cost 50-80 ms frames.
  paintRail();
}
function closeRail() {
  if (S.zone !== "rail") return;
  railOpen(false);
  S.zone = "grid";
  paintRail();
  if (S.view === "home") applyFocus();
  else if (S.view === "assistant") Assistant?.focus();
}
function setView(id) {
  const a = id === "assistant";
  $("#assistantView").classList.toggle("shown", a);
  $("#page").classList.toggle("away", a);
  $(".when").classList.toggle("away", a);
}
function showView(id) {
  S.view = id;
  setView(id);
  if (id === "assistant") { Assistant ? Assistant.show() : toast("The assistant needs LocalHub on the laptop"); }
  else Assistant?.hide();
  if (id === "home") { S.zone = "grid"; applyFocus(); }
  paintRail();
}
function railKey(name) {
  if (name === "up") { S.rail = Math.max(0, S.rail - 1); return paintRail(); }
  if (name === "down") { S.rail = Math.min(RAIL.length - 1, S.rail + 1); return paintRail(); }
  if (name === "right" || name === "back" || name === "menu") return closeRail();
  if (name !== "enter") return;
  const id = RAIL[S.rail].id;
  railOpen(false);
  S.zone = "grid";
  if (id === "home" || id === "assistant") return showView(id);
  paintRail();
  if (S.view === "home") applyFocus();
  if (id === "browser") { const app = APPS.find((a) => a.id === "browser") || Stream.STREAM_APPS.find((a) => a.id === "browser"); return app ? openApp(app) : toast("The browser runs on the laptop: open LocalHub TV from the hub"); }
  if (id === "saver") return startSaver();
  if (id === "settings") return openSettings();
}

/* ── frozen glass (after APL Launcher's): the wallpaper blurred once, by shrinking it to 48×27 and back
   up to 480×270, then shown behind each glass surface at the stage position it sits over. Nothing
   filters live, so focus moves and panels slide without the GPU redrawing a blur. */
async function bakeGlass() {
  const m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle($("#hub-wall")).backgroundImage || "");
  if (m?.[1] === bakeGlass.url) return;
  bakeGlass.url = m?.[1];
  if (!m) return document.documentElement.style.removeProperty("--frozen");
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = m[1];
    await img.decode();
    const tiny = document.createElement("canvas");
    tiny.width = 48; tiny.height = 27;
    tiny.getContext("2d").drawImage(img, 0, 0, 48, 27);
    const big = document.createElement("canvas");
    big.width = 480; big.height = 270;
    const g = big.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(tiny, 0, 0, 480, 270);
    document.documentElement.style.setProperty("--frozen", `url(${big.toDataURL("image/jpeg", 0.85)})`);
  } catch (e) { console.warn("glass", e); }
}

function handleKey(name) {
  S.touched = true;
  armSaver();
  if (S.overlay === "saver") return stopSaver();
  // Opening an app: Back always comes home, even if the app never came up.
  if (S.overlay === "launch") { if (name === "back") endLaunch(); return; }
  if (S.overlay === "stream") return void Stream.key(name);
  if (S.overlay === "hub") { if (name === "back") closeHub(); return; }
  if (name === "help") { prefs.help = !prefs.help; savePrefs(); return showKeys(prefs.help); }
  if (S.overlay === "modal") { if (name === "back") closeModal(false); return; }
  if (S.pendingOpen && name === "enter") { const app = S.pendingOpen; S.pendingOpen = null; return launch(app, () => openApp(app)); }
  S.pendingOpen = null;
  if (name === "ai") { if (S.overlay === "settings") closeSettings(); closeRail(); showView("assistant"); return Assistant?.voice(); }
  if (name === "settings") { if (S.overlay === "settings") return closeSettings(); closeRail(); if (S.view !== "home") showView("home"); return openSettings(); }
  if (S.zone === "rail") return railKey(name);
  if (S.view === "assistant" && !S.overlay) {
    if (Assistant?.key(name)) return;
    if (name === "left" || name === "menu") return openRail();
    if (name === "back") return showView("home");
    return;
  }
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
    if (name === "rew" || name === "ff") { for (let i = 0; i < 5; i++) settingsMove(name === "ff" ? 1 : -1); return; }
    if (name === "enter") return settingsActivate();
    return;
  }
  switch (name) {
    case "left": return move(-1, 0);
    case "right": return move(1, 0);
    case "up": return move(0, -1);
    case "down": return move(0, 1);
    case "enter": return press(activate);
    case "menu": {
      // On one of your websites, ☰ twice removes it (from the hub, so everywhere); anywhere else ☰ opens the sidebar.
      const it = ITEMS[S.i];
      if (S.zone === "grid" && it?.kind === "site") return removeSitePress(it);
      return openRail();
    }
    case "saver": return startSaver();
    case "rew":
    case "ff": {
      // A page at a time: three rows, landing in the same column.
      if (S.zone !== "grid") { S.zone = "grid"; return applyFocus(); }
      const n = ITEMS.length, col = S.i % COLS, lastRow = Math.floor((n - 1) / COLS);
      const row = Math.max(0, Math.min(lastRow, Math.floor(S.i / COLS) + (name === "ff" ? 3 : -3)));
      S.i = Math.min(row * COLS + col, n - 1);
      return applyFocus();
    }
    case "back":
      if (S.zone !== "grid") { S.zone = "grid"; return applyFocus(); }
      if (S.i === 0) return openRail();
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
// A Fire TV has no pointer: hide it from the start, so the first key press doesn't restyle the whole page
// (body.pointer-hidden * is a rule on every element: 80 ms on a Fire TV Stick, measured).
if (NATIVE) hidePointer();
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
  if (PREVIEW) { const a = e.target.closest(".app"); if (a) { S.zone = "grid"; S.i = Number(a.dataset.i); applyFocus(); } return; }
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

/* ── for the hub's Home editor (TV view): what this screen has, and its edits pushed in ── */
window.LocalHubTV = {
  preview: PREVIEW,
  // Every app this screen could show, in the default order.
  apps: () => defaultOrder().map((a) => ({ id: a.id, name: a.name, bg: a.bg, fg: a.fg, icon: a.icon || "", wide: !!a.wide, letter: a.letter || "", img: a.img || a.banner || "" })),
  // The widgets it can draw, for its screensaver (tv.saver.widgets): { id: label }.
  widgets: () => Object.fromEntries(Object.entries(WIDGETS).map(([id, w]) => [id, w.label])),
  apply: (next) => { if (next && typeof next === "object") takeSettings(next); },
  sync: () => syncHub(),
};

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

const APPS_READY = {}, HUB_READY = {};
let splashReady = null;
async function boot() {
  applyLook();
  loadItems();
  renderGrid();
  renderRail();
  setView("home");
  bakeGlass();
  tick();
  setInterval(tick, 10_000);
  // The opening (splash.js, the same one trylocalhub.com plays) decides when the home screen shows.
  // On a TV the opening also waits (up to 6 s) for the TV's own apps, so the home screen appears whole.
  const appsReady = NATIVE && !APPS.some((a) => a.pkg) ? Promise.race([new Promise((r) => { APPS_READY.resolve = r; }), wait(6000)]) : null;
  (PREVIEW ? Promise.resolve() : Promise.all([window.LocalHubSplash?.done || new Promise((r) => setTimeout(r, 2300)), appsReady])).then(() => { document.body.classList.add("booted"); $("#splash").classList.add("is-gone"); });
  // The opening stays up until the home screen is whole: the settings from the hub and, on a TV, its own apps.
  splashReady = Promise.all([appsReady, IN_HUB ? new Promise((r) => { HUB_READY.resolve = r; setTimeout(r, 4000); }) : null]);
  // Boot timings, for the harness (window.__boot): when the apps, the hub and the home screen were ready.
  window.__boot = { start: Math.round(performance.now()) };
  appsReady?.then(() => { window.__boot.apps = Math.round(performance.now()); });
  // Once the grid is final (the TV's apps and the hub's settings, which add the browser and your websites), every row
  // and Settings are drawn once behind the opening, then it leaves. Walking earlier drew a grid that then changed,
  // and slowed the settings down by competing with them.
  splashReady.then(async () => {
    if (NATIVE && !S.walked && !document.body.classList.contains("booted")) { S.walked = true; window.__boot.walk = Math.round(performance.now()); await walkRows(); }
    window.__boot.home = Math.round(performance.now());
    window.LocalHubSplash?.release?.();
  });
  if (PREVIEW) { $("#keys").style.transition = "none"; showKeys(false); }
  else if (!NATIVE) { showKeys(prefs.help); if (prefs.help) setTimeout(() => showKeys(false), 12000); }

  if (IN_HUB) {
    // The hub's own config, browser and assistant: the same agent, tools and conversations.
    await loadScript("/hub-config.js");
    window.__boot.config = Math.round(performance.now());
    HUB.name = window.HUB_CONF?.name || HUB.name;
    HUB.owner = window.HUB_CONF?.owner || "";
    await syncHub();
    window.__boot.hub = Math.round(performance.now());
    HUB_READY.resolve?.();
    Stream.init({ toast, native, NATIVE, setOverlay, closed: () => { S.zone = "grid"; setOverlay(null); window.focus(); }, changed: () => window.haven.appsChanged() });
    if (!PREVIEW) loadSaverPhotos();
    S.shelfId = null;
    renderGrid();
    if (PREVIEW) { setInterval(syncHub, 30_000); return paintChip(); }
    // The TV is its own light app: the hub's chat.js and browser.js stay on the laptop.
    Assistant = await import("./assistant.js?v=3").catch((e) => { console.warn("assistant", e); return null; });
    Assistant?.init({
      el: $("#assistantView"), toast, native, NATIVE,
      intercept: (t) => Boolean(window.HubChatHooks?.intercept?.(t)),
      speechMode: () => prefs.speak || "After voice",
      onActivity: (on) => $("#rail").classList.toggle("busy", Boolean(on)),
    });
    setInterval(syncHub, 30_000);
    startCommandLoop();
    if (NATIVE) { const st = safeJson(native("status"), {}); HUB.paired = Boolean(st.paired); HUB.url = st.hub || ""; }
  } else {
    probeNative();
  }
  paintChip();
  armSaver();
}

boot();
