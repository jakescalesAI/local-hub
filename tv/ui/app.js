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
  widgets: sym('<rect x="3.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2.2"/>', 2),
  sort: sym('<path d="M4 6h16M7 12h10M10 18h4"/>', 2.2),
  search: sym('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>', 2.2),
  star: sym('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  unstar: sym('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/><path d="M3 3l18 18"/>'),
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
  open: sym('<path d="M8 5v14l11-7z"/>'),
  move: sym('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'),
  hide: sym('<path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2M6.6 6.6C4.3 8.2 3 12 3 12s4 6 9 6a9 9 0 0 0 4.4-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  trash: sym('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
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
const DEFAULTS = { clock: "12-hour", homeClock: "Time and date", ttsVoice: "Heart", inputs: true, saver: "5 min", speak: "After voice", help: true };
const DEVICE = NATIVE ? (safeJson(native("status"), {}) || {}) : {};
// On a TV the page is laid out at the WebView's small CSS size (960×540 on a 4K Fire TV); the chat bar, which
// lives outside the 1920×1080 canvas, is scaled the same way as the canvas so it keeps its proportions.
if (NATIVE) document.documentElement.classList.add("native");
let prefs = { ...DEFAULTS, ...(safeJson((() => { try { return localStorage.getItem(PREFS_KEY); } catch { return null; } })(), {}) || {}) };
if (!prefs.voice) prefs.voice = voicePref(); // the Voice row starts from the old read-aloud and voice mode choices
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
let FAVS = []; // the Favorites row: apps you picked (tv.favorites), or one tile saying how
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
// On a TV the photos are the 1920x1080 copies (photos/saver): its screen is 1920x1080, and a 4K photo held ~33 MB of
// graphics memory on a Fire TV Stick, whose driver crashes when that runs short. A laptop gets the 4K ones.
const wallUrl = (id) => (TV_PHOTOS[id] ? (NATIVE ? `./photos/saver/${id}.jpg` : `./photos/${id}.jpg`) : `./wallpapers/${id}.svg`);
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
  sendCover();
  // A photo gets a middle scrim: enough for white names over a bright sky or sand, not so much it goes grey.
  r.style.setProperty("--hub-scrim", w.tone === "photo" ? ".3" : w.tone ? (w.tone === theme ? ".18" : ".55") : ".4");
  if (S.shelfId === "hub") paintShelf(true);
}

async function syncHub() {
  if (!IN_HUB) { applyLook(); return; }
  try {
    // The first time, the request index.html started while the page loaded.
    const early = window.__hubSettings;
    window.__hubSettings = null;
    let r = early ? await early : null;
    if (!r?.ok) r = await fetch("/api/hub/settings", { cache: "no-store" });
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
  const grid = (s) => JSON.stringify([s?.tv?.apps, s?.tv?.hidden, s?.tv?.favorites, s?.scroll?.tv, s?.sites]);
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
  paintHomeWidgets();
  paintWpanel(); // the Layout panel stays drawn, ready to open
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
// Apps whose own banner doesn't do them justice: our picture of their logo for the tile, and its white version.
const TILE_ART = {
  "com.amazon.firetv.youtube.tv": { banner: "./brands/youtubetv-tile.png", edge: "#000000", fit: null, mark: "./brands/youtubetv-mark.png", bg: "#000000" },
};
// A tile zooms to its banner's logo (the TV app measures where it is): a logo with wide empty margins fills its
// tile like the others. The tile is 276x172; a banner is 16:9.
function fitStyle(fit, ar) {
  if (!Array.isArray(fit) || fit.length !== 4) return "";
  const [x0, y0, x1, y1] = fit, bw = Math.max(0.05, x1 - x0), bh = Math.max(0.05, y1 - y0);
  const TA = 276 / 172, BA = ar > 0 ? ar : 9 / 16; // the banner's own shape (height over width): never squished
  const wf = Math.max(1, Math.min(2.6, Math.min(0.8 / bw, (0.62 / TA) / (BA * bh)))); // the picture's width, in tile widths
  const hf = wf * BA * TA; // its height, in tile heights
  const left = 50 - (x0 + bw / 2) * wf * 100, top = 50 - (y0 + bh / 2) * hf * 100;
  return `inset:auto;left:${left.toFixed(2)}%;top:${top.toFixed(2)}%;width:${(wf * 100).toFixed(2)}%;height:${(hf * 100).toFixed(2)}%;object-fit:fill`;
}
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
      id: a.id, pkg: a.id, name: a.name, banner: a.banner || null, img: a.icon || null, edge: a.edge || null, mark: a.mark || null, fit: a.fit || null, ar: a.ar || null,
      ...(TILE_ART[a.id] || {}),
      bg: a.color || "#2c2c2e", fg: "#ffffff", recentAt: a.recent || 0, wordmark: wordmarkFor(a.name),
    }));
    if (IN_HUB) APPS.push(...Stream.STREAM_APPS.map((a) => ({ ...a, note: Stream.noteFor(a) })), ...siteApps());
    // More apps: the streaming services this TV doesn't have installed, opened in the laptop's Chrome on the TV.
    if (IN_HUB && !PREVIEW) {
      const have = new Set(APPS.map((a) => nameKey(a.name)));
      APPS.push(...WEB_APPS.filter((w) => !["kodi", "vlc", "steam"].includes(w.id) && !have.has(nameKey(w.name)))
        .map((w) => ({ ...w, stream: Stream.engineFor(w) || "chrome", note: Stream.noteFor(w), recentAt: 0 })));
    }
    INPUTS = safeJson(native("inputs") || "[]", []);
    S.inputCount = INPUTS.length;
  } else {
    const now = Date.now();
    const opened = safeJson((() => { try { return localStorage.getItem("localhub.tv.opened"); } catch { return null; } })(), {}) || {};
    APPS = [...WEB_APPS, ...(IN_HUB ? [...Stream.STREAM_APPS, ...siteApps()] : [])].map((a) => ({ ...a, note: Stream.noteFor(a), recentAt: opened[a.id] || (a.recent ? now - a.recent * 3600e3 : 0) }));
    INPUTS = DEMO_INPUTS;
  }
  if (!prefs.inputs) INPUTS = [];
  const q = (S.search || "").toLowerCase();
  ITEMS = q
    ? [...tvApps(), ...INPUTS.filter((i) => i.name.toLowerCase().includes(q)).map((i) => ({ ...i, kind: "input" }))] // a search shows only what matches
    : [
      ...tvApps(),
      ...INPUTS.map((i) => ({ ...i, kind: "input" })),
      ...(IN_HUB && !PREVIEW ? [{ id: "add-site", kind: "addsite", name: "Add website" }] : []),
      { id: "settings", kind: "settings", name: "Settings" },
    ];
  S.i = clamp(S.i, 0, ITEMS.length - 1);
  const favIds = Array.isArray(SETTINGS?.tv?.favorites) ? SETTINGS.tv.favorites : [];
  const picked = favIds.map((id) => APPS.find((a) => a.id === id)).filter(Boolean);
  // The row: widgets, sort and search first, then your favorites, then the + card (always last).
  FAVS = IN_HUB && !PREVIEW
    ? [{ id: "ctl:widgets", kind: "ctl", name: "Layout" }, { id: "ctl:sort", kind: "ctl", name: "Sort apps" }, { id: "ctl:search", kind: "ctl", name: "Search" }, ...picked, { id: "favadd", kind: "favadd", name: "Add a favorite" }]
    : picked;
  S.f = clamp(S.f || 0, 0, Math.max(0, FAVS.length - 1));
  if (!FAVS.length && S.zone === "favs") S.zone = "grid";
}
const hasFavs = () => FAVS.length > 0;
const isPicked = (it) => Boolean(it && it.kind !== "ctl" && it.kind !== "favadd");
// Where Home lands in the row: your first favorite, or the + card when there are none.
const favStart = () => Math.max(0, FAVS.findIndex((x) => isPicked(x) || x.kind === "favadd"));
const isFav = (it) => Boolean(it && (SETTINGS?.tv?.favorites || []).includes(it.id));
// What the remote is on: a Favorites tile or an app tile.
const focused = () => (S.zone === "favs" ? FAVS[S.f] : ITEMS[S.i]);

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
  const listed = sortMode() === "custom" ? order.map((id) => APPS.find((a) => a.id === id)).filter(Boolean) : [];
  let list = sortMode() === "az" ? [...APPS].sort((a, b) => a.name.localeCompare(b.name)) : [...listed, ...base.filter((a) => !listed.includes(a))];
  list = list.filter((a) => !hidden.has(a.id));
  // Search (the row's search button): only the apps whose name has what was typed.
  const q = (S.search || "").toLowerCase();
  return q ? list.filter((a) => a.name.toLowerCase().includes(q)) : list;
}

function iconHTML(it) {
  if (it.kind === "hub") return `<div class="icon hub"><img src="./hub.svg" alt=""></div>`;
  if (it.kind === "favadd") return `<div class="icon favadd"><i class="fill"></i>${SYM.plus}</div>`;
  if (it.kind === "ctl") {
    const k = it.id.slice(4);
    // A real search box: it holds what you type (its value is set after drawing, so typing never redraws it).
    if (k === "search") return `<div class="icon ctl search"><i class="fill"></i>${SYM.search}<input class="sb" type="text" placeholder="Search apps" autocomplete="off" spellcheck="false" tabindex="-1" aria-label="Search apps"></div>`;
    return `<div class="icon ctl"><i class="fill"></i>${k === "widgets" ? SYM.widgets : SYM.sliders}</div>`;
  }
  if (it.kind === "settings") return `<div class="icon" style="--a-bg:linear-gradient(160deg,#8e8e93,#3a3a3c);--a-fg:#fff">${SYM.gear}</div>`;
  if (it.kind === "addsite") return `<div class="icon add" style="--a-bg:#1f2129;--a-fg:#fff"><i class="fill"></i>${SYM.plus}</div>`;
  if (it.kind === "site") return `<div class="icon" style="--a-bg:${it.bg};--a-fg:${it.fg}"><i class="fill"></i><b class="letter">${esc(it.letter)}</b><img class="square site" src="${esc(it.siteIcon)}" alt="" decoding="async" onerror="this.remove()"></div>`;
  if (it.kind === "input") return `<div class="icon" style="--a-bg:linear-gradient(160deg,#2c2c2e,#0b0b0d);--a-fg:#fff">${SYM.input}<span class="sub">${esc(it.sub || "HDMI")}</span></div>`;
  const colors = `--a-bg:${it.bg};--a-fg:${it.fg}`;
  const fill = '<i class="fill"></i>';
  // A banner that won't load (an app can hand Android an empty one) falls back to its icon, or its colour.
  const fallback = it.img ? `this.onerror=null;this.className='square';this.src='${esc(it.img)}'` : "this.remove()";
  // The whole banner, never cropped: a 16:9 banner on a slightly taller tile, the strips above and below in its own edge colour.
  if (it.banner) return `<div class="icon" style="--a-bg:${it.edge || it.bg};--a-fg:${it.fg}"><i class="fill flat"></i><img class="banner" src="${esc(it.banner)}" alt="" decoding="async"${it.fit ? ` style="${fitStyle(it.fit, it.ar)}"` : ""} onerror="${fallback}"></div>`;
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
  renderFavs();
  applyFocus(true);
  warmTiles();
}
// While the opening still covers the screen, step the page through every row once, so the TV draws each row's
// tiles now rather than on the first scroll down (that first pass stalled up to 400 ms on a Fire TV Stick).
const FAVS_H = 176; // the Favorites row's height (--favs-h)
function renderFavs() {
  const box = $("#favs"), track = $("#favTrack");
  const head = $("#favsHead");
  if (!head.firstElementChild) head.innerHTML = `${SYM.star}<span>Favorites</span>`;
  const html = FAVS.map((it, f) => `<div class="app fav${it.kind === "ctl" ? ` ctl ${it.id.slice(4)}` : ""}" data-f="${f}">${iconHTML(it)}<span class="name">${esc(it.name)}</span></div>`).join("");
  if (track._html !== html) { track.innerHTML = html; track._html = html; track._boxes = null; }
  const sb = track.querySelector(".sb");
  if (sb && document.activeElement !== sb && sb.value !== (S.search || "")) sb.value = S.search || "";
  if (box.hidden === hasFavs()) { box.hidden = !hasFavs(); $("#page").classList.toggle("has-favs", hasFavs()); }
}
// The row slides so the focused favorite is always on screen, five at a time like the grid.
// Where a tile of the row is, in screen pixels (1920 wide): its left edge in the strip and its width.
// Measured once per row (renderFavs clears it): measuring on every move forced a layout pass, ~100 ms when the
// sidebar closed into Settings.
function favBox(f) {
  const track = $("#favTrack");
  if (!track._boxes) {
    const k = $("#stage").getBoundingClientRect().width / 1920 || 1;
    const t = track.getBoundingClientRect();
    track._boxes = [...track.querySelectorAll(".fav")].map((n) => { const r = n.getBoundingClientRect(); return { l: (r.left - t.left) / k, w: r.width / k }; });
  }
  return track._boxes[f] || null;
}
const FAV_VIEW = 1920 - 212 - 90; // the strip's visible width
function slideFavs() {
  const b = favBox(S.f);
  if (!b) return;
  let x = S.favX || 0;
  if (b.l - x < 0) x = b.l;
  else if (b.l + b.w - x > FAV_VIEW) x = b.l + b.w - FAV_VIEW;
  S.favX = Math.max(0, x);
  $("#favTrack").style.transform = S.favX ? `translateX(${-S.favX}px)` : "";
}
// Down from the row: the app under the tile you're on. Up from the apps: the row's tile over that column.
function gridColUnderFav(f) {
  const b = favBox(f);
  return b ? clamp(Math.floor((b.l + b.w / 2 - (S.favX || 0)) / 320), 0, COLS - 1) : 0;
}
function favOverCol(col) {
  const x = col * 320 + 138 + (S.favX || 0);
  let best = 0, d = Infinity;
  FAVS.forEach((_, f) => { const b = favBox(f); if (b && Math.abs(b.l + b.w / 2 - x) < d) { d = Math.abs(b.l + b.w / 2 - x); best = f; } });
  return best;
}

async function walkRows() {
  const page = $("#page");
  // The first few rows only: with 40-odd apps, drawing every row took ~3 s of every start. Further down, rows draw as you go.
  const rows = Math.min(5, Math.ceil(ITEMS.length / COLS) + (hasFavs() ? 1 : 0));
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  page.style.transition = "none";
  // Two rows a step: the screen shows about two and a half, and the TV also draws a margin around what it shows.
  for (let row = 1; row < rows; row += 2) {
    if (document.body.classList.contains("booted")) break;
    page.style.transform = `translateY(${-(648 + row * 236 - 400)}px)`;
    await frame();
  }
  window.__boot.rows = Math.round(performance.now());
  // Settings and the assistant too: their first opening otherwise drew a whole screen at 4K (100-480 ms frames).
  if (!document.body.classList.contains("booted")) {
    // The header's wordmarks are baked after the home screen is up (in the background), not before it.
    setTimeout(() => [...new Set(ITEMS.map((x) => x.wordmark).filter(Boolean))].reduce((p, w) => p.then(() => bakeMark(w)), Promise.resolve()), 3000);
    // And your favorites' white logos decoded ahead, so the first move along the row doesn't stop to decode one (~150 ms).
    setTimeout(() => FAVS.filter((x) => x.mark).reduce((p, x) => p.then(() => { const i = new Image(); i.src = x.mark; return i.decode().catch(() => {}); }), Promise.resolve()), 2500);
    renderSettings(); // Settings stays drawn, a hair above invisible (styles.css), from here on
    window.__boot.settings = Math.round(performance.now());
    setView("assistant");
    await frame();
    setView(S.view);
    window.__boot.assistant = Math.round(performance.now());
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
  if (S.zone === "favs" && !S.overlay) { $(`.fav[data-f="${S.f}"]`)?.classList.add("is-focused"); slideFavs(); }

  // With Favorites at the top, every app row is in the grid part of the screen, under the Favorites section.
  const fav = hasFavs();
  const gRow = Math.floor(S.i / COLS);
  const row = S.zone === "favs" ? 0 : gRow + (fav ? 1 : 0);
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
    const hw = $("#homeW");
    if (hw && (hw.style.opacity === "0") !== grid) hw.style.opacity = grid ? "0" : "";
  } else document.body.classList.toggle("in-grid", grid);
  // Row 0 sits on the Top Shelf. Further down, in one long scroll (the default, like tvOS) the
  // focused row rides about a third of the way up; in pages the rows move three at a time.
  const paged = SETTINGS?.scroll?.tv === "pages";
  const gridTop = 648 + (fav ? FAVS_H : 0);
  const first = fav ? Math.floor(gRow / 3) * 3 : 1 + Math.floor((gRow - 1) / 3) * 3;
  const y = !inGrid ? 0 : paged ? -(gridTop + first * 236 - 190) : -(gridTop + gRow * 236 - 400);
  // A page shows its own rows: the ones before it leave with it instead of hanging under the clock.
  document.querySelectorAll(".app").forEach((n) => {
    const gone = paged && inGrid && (n.dataset.f !== undefined || Math.floor(Number(n.dataset.i) / COLS) < first);
    if ((n.style.opacity === "0") !== gone) { n.style.transition = "opacity .45s"; n.style.opacity = gone ? "0" : ""; }
  });
  const page = $("#page");
  if (instant) page.style.transition = "none";
  page.style.transform = `translateY(${y}px)`;
  if (instant) requestAnimationFrame(() => { page.style.transition = ""; });
  if ((S.zone === "grid" || S.zone === "favs") && row === 0) paintShelf();
  snapshotSoon();
}
// Home's cover is a picture of this home screen (the TV app takes it): resting on the Favorites row for a few seconds,
// at most every 45 s, it's taken again, so pressing Home shows the home screen at once instead of a wallpaper.
function snapshotSoon() {
  if (!NATIVE) return;
  clearTimeout(snapshotSoon.t);
  if (S.zone !== "favs" || S.overlay || S.view !== "home" || document.hidden) return;
  snapshotSoon.t = setTimeout(() => {
    if (S.zone !== "favs" || S.overlay || S.view !== "home" || document.hidden || Date.now() - (snapshotSoon.at || 0) < 45_000) return;
    snapshotSoon.at = Date.now();
    native("snapshotHome");
  }, 3500);
}
const atTop = () => S.zone === "favs" || (!hasFavs() && Math.floor(S.i / COLS) === 0);

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
  if (S.zone === "favs") {
    if (dx) {
      const next = S.f + dx;
      if (next >= 0 && next < FAVS.length) S.f = next;
      else if (dx < 0) return openRail();
      else return tilt(dx * 1.6, 0);
    }
    if (dy < 0) return tilt(0, -1.6);
    if (dy > 0) { S.zone = "grid"; S.i = Math.min(gridColUnderFav(S.f), ITEMS.length - 1); }
    applyFocus();
    return tilt(dx, dy);
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
    if (row === 0 && hasFavs()) { S.zone = "favs"; S.f = favOverCol(S.i % COLS); applyFocus(); return tilt(0, -1); }
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
  const it = S.zone === "favs" ? FAVS[S.f] : ITEMS[S.i];
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

/* Wordmarks drawn once, in white, into a picture: as a CSS mask the stick redrew the logo through a mask layer
   each time the header changed (~100 ms of GPU work for YouTube's); a picture it draws in a few. */
const MARKS = new Map(); // name -> data: URL once baked, null while baking or if it failed
async function bakeMark(name) {
  if (MARKS.has(name)) return MARKS.get(name);
  MARKS.set(name, null);
  try {
    const svg = await (await fetch(`./brands/${name}.svg`)).text();
    const vb = /viewBox="([^"]+)"/.exec(svg)?.[1].trim().split(/[\s,]+/).map(Number);
    if (!vb || !(vb[2] > 0) || !(vb[3] > 0)) return null;
    const W = 680, H = 200; // .banner-mark's box: contained, at its bottom left
    const k = Math.min(W / vb[2], H / vb[3]);
    const w = Math.round(vb[2] * k), h = Math.round(vb[3] * k);
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace("<svg ", `<svg width="${w}" height="${h}" preserveAspectRatio="none" `));
    await img.decode();
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, w, h);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    const url = c.toDataURL("image/png");
    MARKS.set(name, url);
    return url;
  } catch { return null; }
}

/* The header is the app's banner in white, like tvOS: its own wordmark where we have one
   (./brands/<id>-wordmark.svg), and otherwise its name set large in its place. No icon, no caption. */
function appShelfHTML(it) {
  const baked = it.wordmark && MARKS.get(it.wordmark);
  if (it.wordmark && !MARKS.has(it.wordmark)) bakeMark(it.wordmark).then((url) => { if (url && S.shelfId === it.id) paintShelf(true); });
  // The app's logo in white: our own wordmark, or the one the TV app cut out of its banner; its name if neither.
  const mark = baked
    ? `<span class="banner-mark"><img src="${baked}" alt=""></span>`
    : it.mark && !it.wordmark
      ? `<span class="banner-mark"><img class="cut" src="${esc(it.mark)}" alt=""></span>`
    : it.wordmark
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
  weather: { label: "Weather", tint: "var(--blue)", render(size = "m") {
    if (!WX.body) { loadWeather(); return `<div class="w-empty">${WX.err ? "Weather isn’t available right now" : "Finding the weather…"}</div>`; }
    return wxCard(WX.body, size);
  } },
  recent: { label: "Recently opened", tint: "var(--green)", wide: true, render() {
    const list = [...APPS].filter((a) => a.recentAt).sort((a, b) => b.recentAt - a.recentAt).slice(0, 3);
    if (!list.length) return `<div class="w-empty">Apps you open here show up in this card.</div>`;
    return `<div class="w-list">${list.map((a) => `<div class="w-row"><span class="mini" style="--a-bg:${a.bg};--a-fg:${a.fg}">${miniArt(a)}</span><span class="t">${esc(a.name)}</span><span class="s">${esc(ago(a.recentAt))}</span></div>`).join("")}</div>`;
  } },
};
// ── Weather card: one design for LocalHub's Home and the TV (same code in tabs/home.js and tv/ui/app.js). ──
// Sizes: s = now; m = now and the hours ahead; l = now, the hours ahead and the coming days. Sized in em, so each
// place sets one font-size on .wxw and the whole card scales with it.
const WXI = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 11.6 3.5 3.5 0 0 0 7 18.5z"/>',
  part: '<path d="M8.5 3.5v1.2M3.6 8.6h1.2M5 5.1l.9.9M12.2 5.1l-.9.9"/><path d="M5.6 11.2a3.6 3.6 0 0 1 6.5-2.6"/><path d="M9 20h8.5a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 8.6 13.9 3 3 0 0 0 9 20z"/>',
  partNight: '<path d="M11.5 8.2A4 4 0 0 1 6 3.3a4.5 4.5 0 1 0 5.5 4.9z"/><path d="M9 20h8.5a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 8.6 13.9 3 3 0 0 0 9 20z"/>',
  hi: '<path d="M7 14.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 7.6 3.5 3.5 0 0 0 7 14.5z"/>',
  fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
}
function wxSvg(code, day = true) {
  const c = Number(code)
  const d = c === 0 || c === 1 ? (day ? WXI.sun : WXI.moon)
    : c === 2 ? (day ? WXI.part : WXI.partNight)
      : c === 45 || c === 48 ? WXI.fog
        : c >= 95 ? WXI.hi + '<path d="M12.5 15.5 10.5 19h3l-2 3"/>'
          : (c >= 71 && c <= 77) || c === 85 || c === 86 ? WXI.hi + '<path d="M8 18.5h.01M12 20.5h.01M16 18.5h.01"/>'
            : c >= 51 ? WXI.hi + '<path d="M8.5 17.5 7.5 20M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/>'
              : WXI.cloud
  return `<svg class="wxw-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
}
function wxCard(w, size) {
  const e = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
  const deg = n => `${e(n)}°`
  const rain = p => (p >= 20 ? `<span class="wxw-rain">${e(p)}%</span>` : '')
  const head = `<div class="wxw-head"><div class="wxw-now">${wxSvg(w.now.code, w.now.day)}<span class="wxw-temp">${deg(w.now.temp)}</span></div>`
    + `<div class="wxw-meta"><span class="wxw-cond">${e(w.now.text)}</span><span class="wxw-hl">H ${deg(w.high)}  L ${deg(w.low)}</span>`
    + (size === 's' ? '' : `<span class="wxw-place">${e(w.place)}${Number.isFinite(w.now.feels) ? ` · Feels ${deg(w.now.feels)}` : ''}</span>`) + '</div></div>'
  if (size === 's') return `<div class="wxw wxw-s">${head}</div>`
  const hourName = (t, k) => (k === 0 ? 'Now' : new Date(t).toLocaleTimeString([], { hour: 'numeric' }).replace(/\s/g, '').toLowerCase())
  const hours = `<div class="wxw-hours">${(w.hours || []).slice(0, 6).map((h, k) => `<div class="wxw-h"><span class="wxw-ht">${e(hourName(h.time, k))}</span>${wxSvg(h.code, h.day)}<span class="wxw-hv">${deg(h.temp)}</span>${rain(h.rain)}</div>`).join('')}</div>`
  if (size !== 'l') return `<div class="wxw wxw-m">${head}${hours}</div>`
  const days = (w.days || []).slice(0, 5)
  const lo = Math.min(...days.map(d => d.low)), hi = Math.max(...days.map(d => d.high)), span = Math.max(1, hi - lo)
  const dayName = (d, i) => (i === 0 ? 'Today' : new Date(d.date + 'T12:00').toLocaleDateString([], { weekday: 'short' }))
  const rows = days.map((d, i) => `<div class="wxw-d"><span class="wxw-dn">${e(dayName(d, i))}</span>${wxSvg(d.code, true)}<span class="wxw-dr">${rain(d.rain)}</span><span class="wxw-dl">${deg(d.low)}</span><span class="wxw-bar"><i style="left:${((d.low - lo) / span) * 100}%;right:${100 - ((d.high - lo) / span) * 100}%"></i></span><span class="wxw-dh">${deg(d.high)}</span></div>`).join('')
  return `<div class="wxw wxw-l">${head}${hours}<div class="wxw-days">${rows}</div></div>`
}
// Weather where the laptop is (the hub's /api/tv/weather), kept 15 minutes.
const WX = { body: null, at: 0, busy: false, err: null };
function loadWeather() {
  if (!IN_HUB || WX.busy || Date.now() - WX.at < 15 * 60_000) return;
  WX.busy = true;
  fetch("/api/tv/weather", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((b) => { WX.body = b; WX.err = null; }).catch((e) => { WX.err = e; })
    .finally(() => { WX.at = Date.now(); WX.busy = false; if (S.overlay === "saver") paintSaverHud(); if (S.overlay === "wpanel") paintWpanel(); paintHomeWidgets(); });
}
const LABELS = { "next-event": "Next event", "claude-usage": "Claude usage", tokens: "Tokens", today: "Today", coolify: "Coolify", services: "Services", "server-health": "Server", drives: "Drives", "stripe-balance": "Stripe", icloud: "iCloud" };

function tvWidgets() {
  const layout = SETTINGS?.widgets?.tv?.length ? SETTINGS.widgets.tv : [{ id: "clock" }, { id: "date" }, { id: "world-clock" }];
  return layout.filter((w) => w.id !== "app").map((w) => w.id);
}
function widgetCard(id, size) {
  const def = WIDGETS[id];
  if (!def) return `<div class="w card"><div class="w-label"><i class="dot"></i>${esc(LABELS[id] || id)}</div><div class="w-body"><div class="w-empty">Shown on LocalHub. TV support is coming.</div></div></div>`;
  const mark = id === "weather" ? sym('<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 11.6 3.5 3.5 0 0 0 7 18.5z"/>', 2) : id === "recent" ? sym('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 2) : "";
  return `<div class="w card${def.wide ? " wide" : ""}${size ? ` sz-${size}` : ""}"><div class="w-label">${mark || `<i class="dot" style="--c:${def.tint}"></i>`}${esc(def.label)}</div><div class="w-body">${def.render(size)}</div></div>`;
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
  const it = focused();
  if (!it) return;
  if (it.id === "ctl:widgets") return openWidgets();
  if (it.id === "ctl:sort") return openSortMenu();
  if (it.id === "ctl:search") return openSearch();
  if (it.kind === "favadd") return startFavSelect();
  // Picking a favorite (the + card): this app joins the row (or stays, if it's there), and apps open as usual again.
  if (S.favSelect && S.zone === "grid") return pickFavorite(it);
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
  // Drawn once at its final size (1.6x the tile, in the middle), starting scaled down over the tile itself.
  const w = r.width / k, h = r.height / k;
  const W = Math.round(w * 1.6), H = Math.round(h * 1.6);
  Object.assign(icon.style, { width: `${W}px`, height: `${H}px`, transform: `translate(${(r.left - stage.left) / k}px, ${(r.top - stage.top) / k}px) scale(${w / W})`, transition: "none" });
  layer.classList.remove("back");
  layer._ending = false;
  layer.prepend(icon);
  $("#launchNote").textContent = NATIVE ? "" : note ? `${note} — on a TV this switches the input` : it.url ? (IN_HUB && Stream.engineFor(it) ? `Opening ${it.name}…` : `Opening ${it.name} in a new window…`) : `${it.name} isn't on this laptop`;
  setOverlay("launch");
  layer.classList.add("on");
  requestAnimationFrame(() => requestAnimationFrame(() => { icon.style.transition = ""; icon.style.transform = `translate(${(1920 - W) / 2}px, ${(1080 - H) / 2}px)`; layer.classList.add("full"); }));
  setTimeout(() => {
    const ok = go();
    if (NATIVE && ok !== false) return; // haven.resumed() tidies up when we're back
    if (ok === false && it.url === undefined && it.kind !== "input" && !NATIVE) { setTimeout(endLaunch, 1100); return; }
    if (ok === false) toast(`${it.name} didn't start`);
    setTimeout(endLaunch, ok === "pending" ? 300 : document.hidden ? 0 : 1300);
  }, 200); // the app starts as the screen goes black: Android takes its own time to show it, so start early
}
// Back from the app: the tiles are put in their new order while the black still covers them, then the black and
// the app's tile fade away together over the home screen.
function endLaunch() {
  const layer = $("#launch");
  if (!layer.classList.contains("on") || layer._ending) return;
  layer._ending = true;
  if (S.overlay === "launch") setOverlay(null);
  const keep = ITEMS[S.i]?.id;
  loadItems();
  S.i = Math.max(0, ITEMS.findIndex((x) => x.id === keep));
  S.shelfId = null;
  renderGrid();
  // The fade waits for the home screen to be drawn again (the TV drops its drawing while an app is up: 700-800 ms
  // frames on a Fire TV Stick), so it plays at full speed instead of stalling halfway.
  steadyFrames(1600).then(() => {
    if (!layer._ending) return;
    layer.classList.add("back");
    layer.classList.remove("full");
    setTimeout(() => {
      if (!layer._ending) return;
      layer.classList.remove("on", "back");
      layer.querySelector(".icon")?.remove();
      layer._ending = false;
    }, 380);
  });
}
// Resolves once four frames in a row come quickly (the screen is drawn), or after max ms whatever happens.
function steadyFrames(max) {
  return new Promise((done) => {
    const end = performance.now() + max;
    let last = 0, good = 0;
    const tick = (t) => {
      good = last && t - last < 30 ? good + 1 : 0;
      last = t;
      if (good >= 4 || t > end) return done();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
// Another app in front: the screensaver's timer stops (it used to start the screensaver behind the app, loading
// photos while you watched, and Home then landed on it). Back in front, it starts counting again.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { clearTimeout(saverTimer); if (S.overlay === "saver") stopSaver(); return; }
  endLaunch();
  armSaver();
});

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
/* ── the home screen's widgets (top right) and the widget panel (the row's widgets button) ── */
function paintHomeWidgets() {
  const box = $("#homeW");
  if (!box) return;
  const sizes = {};
  for (const x of SETTINGS?.widgets?.tv || []) { const id = x?.id || x?.[0]; if (id && id !== "clock" && id !== "date" && WIDGETS[id]) sizes[id] = x?.size || x?.[1] || "s"; }
  const html = Object.keys(sizes).slice(0, 2).map((id) => widgetCard(id, sizes[id])).join("");
  if (box._html !== html) { box.innerHTML = html; box._html = html; }
}
const WP_IC = {
  vol: sym('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>', 2),
  pic: sym('<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8 20h8M12 16.5V20"/>', 2),
};
function volState() { return NATIVE ? safeJson(native("volume", 0), {}) || {} : {}; }
function wpItems() {
  const v = volState();
  const pct = v.max ? Math.round((v.level / v.max) * 100) : 0;
  return [
    { id: "weather", html: WX.body ? wxCard(WX.body, "m") : `<div class="t2">${WX.err ? "Weather isn’t available right now" : "Finding the weather…"}</div>`, cls: "wx" },
    { id: "volume", html: `${WP_IC.vol}<div class="grow"><div class="t1">Volume</div>${NATIVE && !v.fixed ? `<div class="bar"><i style="width:${pct}%"></i></div>` : `<div class="t2">With your TV's remote</div>`}</div><div class="t2">${NATIVE && !v.fixed ? "◀ ▶" : ""}</div>` },
    { id: "picture", html: `${WP_IC.pic}<div class="grow"><div class="t1">Picture & brightness</div><div class="t2">Your TV's own settings</div></div>` },
    { id: "timer", html: `${SYM.timer}<div class="grow"><div class="t1">Sleep timer</div><div class="t2">${S.sleepAt ? `At ${clockText(new Date(S.sleepAt))}` : "Off"}</div></div>` },
    { id: "saver", html: `${SYM.moon}<div class="grow"><div class="t1">Screensaver</div><div class="t2">Start it now</div></div>` },
    { id: "settings", html: `${SYM.gear}<div class="grow"><div class="t1">Settings</div><div class="t2">LocalHub TV</div></div>` },
  ];
}
function paintWpanel() {
  S.wp = wpItems();
  S.wpAt = clamp(S.wpAt ?? 1, 0, S.wp.length - 1);
  // Only what changed: the rows are rebuilt when their content changes, the selection just moves.
  const list = $("#wpList"), html = S.wp.map((x, i) => `<div class="wpi ${x.cls || ""}" data-w="${i}">${x.html}</div>`).join("");
  if (list._html !== html) { list.innerHTML = html; list._html = html; }
  list.querySelectorAll(".wpi").forEach((n) => n.classList.toggle("sel", Number(n.dataset.w) === S.wpAt));
}
function openWidgets() {
  loadWeather();
  S.wpAt = 1;
  paintWpanel();
  $("#wpanel").classList.add("on");
  setOverlay("wpanel");
}
function closeWidgets() {
  $("#wpanel").classList.remove("on");
  setOverlay(null);
}
function wpKey(name) {
  const it = S.wp[S.wpAt];
  if (name === "up") { S.wpAt = Math.max(0, S.wpAt - 1); return paintWpanel(); }
  if (name === "down") { S.wpAt = Math.min(S.wp.length - 1, S.wpAt + 1); return paintWpanel(); }
  if (it?.id === "volume" && (name === "left" || name === "right")) { native("volume", name === "right" ? 1 : -1); return paintWpanel(); }
  if (name === "back" || name === "menu" || name === "left") return closeWidgets();
  if (name !== "enter") return;
  if (it?.id === "picture") { closeWidgets(); return native("openDisplaySettings"); }
  if (it?.id === "timer") { cycleSleepTimer(); return paintWpanel(); }
  if (it?.id === "saver") { closeWidgets(); return startSaver(); }
  if (it?.id === "settings") { closeWidgets(); return openSettings(); }
  if (it?.id === "volume") { native("volume", 1); return paintWpanel(); }
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
// The TV app's status, asked at most every 15 s: asking took ~9 ms of each Settings opening.
let NATIVE_STATUS = { at: 0, v: {} };
function nativeStatus() {
  if (!NATIVE) return {};
  if (Date.now() - NATIVE_STATUS.at > 15_000) NATIVE_STATUS = { at: Date.now(), v: safeJson(native("status"), {}) };
  return NATIVE_STATUS.v;
}
// Voice: Off, Read answers, or Conversation (talk back and forth). From the old rows if it was never set.
function voicePref() {
  if (["Off", "Read answers", "Conversation"].includes(prefs.voice)) return prefs.voice;
  return prefs.voicemode === "On" ? "Conversation" : prefs.speak === "Off" ? "Off" : "Read answers";
}
const speakMode = () => ({ Off: "Off", "Read answers": "Always", Conversation: "Always" })[voicePref()];

function settingsModel() {
  const st = nativeStatus();
  // The connection to LocalHub is one row; OK on it offers search again, the address, pairing and forgetting.
  const hubRows = NATIVE
    ? [{ id: "conn", t1: "LocalHub", t2: HUB.url ? `${HUB.url.replace(/^https?:\/\//, "")}${HUB.paired ? " · paired" : " · not paired"}` : "Look for it on this network", v: HUB.searching ? "Searching…" : HUB.on ? "Connected" : HUB.url ? "Not answering" : "Search", on: HUB.on && HUB.paired }]
    : [{ info: true, t1: "LocalHub", t2: IN_HUB ? "This screen is served by LocalHub" : "Open it from LocalHub at /tv/", v: HUB.on ? "Connected" : "Not connected", on: HUB.on },
       ...(IN_HUB ? [{ id: "tvsetup", t1: "Set up a TV", t2: "Put LocalHub TV on a television and pair it", v: "" }] : [])];
  return [
    { title: "Settings" },
    { group: "Home Screen" },
    { key: "clock", t1: "Clock", t2: "Top left, and on the screensaver", values: ["12-hour", "24-hour"] },
    { key: "homeClock", t1: "Home clock", t2: "What the top left of the home screen shows", values: ["Time and date", "Time", "Off"] },
    ...(S.inputCount ? [{ key: "inputs", t1: "HDMI inputs", t2: "Shown as icons after the apps", toggle: true }] : []), // only on a TV that has some
    { key: "saver", t1: "Screensaver", t2: "After the remote has been still", values: ["Off", "2 min", "5 min", "10 min", "15 min"] },
    IN_HUB && !PREVIEW
      ? { id: "saverSource", t1: "Screensaver photos", t2: saverSourceNote(), v: saverSourceName() }
      : { info: true, t1: "Screensaver photos", t2: "Chosen in LocalHub", v: "Wallpapers" },

    ...((SETTINGS?.tv?.hidden || []).length ? [{ id: "unhide", t1: "Hidden apps", t2: "Hold OK on a tile to hide it. This shows them all again", v: `${SETTINGS.tv.hidden.length} hidden` }] : []),
    ...(IN_HUB && !PREVIEW ? [{ id: "wall", t1: "Wallpaper", t2: "Pick one here: it changes straight away", v: wallName(SETTINGS?.wallpaper?.current ?? "aurora") }] : []),
    { id: "look", t1: "Home widgets", t2: "Opens LocalHub, where the TV's widgets are chosen", v: "" },
    { group: "Assistant" },
    ...hubRows,
    { key: "ttsVoice", t1: "Assistant voice", t2: "Kokoro, on the laptop: a natural voice", values: ["Heart", "Bella", "Nicole", "Michael", "Fenrir", "Emma", "George"] },
    { key: "voice", t1: "Voice", t2: { Off: "The assistant only writes", "Read answers": "Answers are read aloud", Conversation: "Talk back and forth: it answers aloud, then it's your turn" }[voicePref()], values: ["Off", "Read answers", "Conversation"] },
    ...(!NATIVE ? [{ key: "help", t1: "Keyboard help", t2: "The remote's keys, along the top", toggle: true }] : []),
    { group: "About" },
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
  if (track._html !== html) { track.innerHTML = html; track._html = html; track._tops = null; }
  if (!selectable(model[S.set])) S.set = model.findIndex(selectable);
  paintSettings();
}
function paintSettings() {
  document.querySelectorAll("#setTrack .row").forEach((n) => n.classList.toggle("is-sel", Number(n.dataset.i) === S.set));
  const row = $(`#setTrack .row[data-i="${S.set}"]`);
  if (!row) return;
  const track = $("#setTrack");
  // Each row's place in the list, measured once per list (measuring on every opening forced a whole layout pass
  // while Settings faded in).
  if (!track._tops) {
    track._tops = {};
    document.querySelectorAll("#setTrack .row").forEach((n) => { track._tops[n.dataset.i] = n.offsetParent === track ? n.offsetTop : n.offsetTop - track.offsetTop; });
  }
  const y = track._tops[S.set] ?? 0;
  track.style.transform = `translateY(${-Math.max(0, y - 380)}px)`;
}
function openSettings() {
  renderSettings();
  $("#settings").classList.add("on");
  setOverlay("settings");
  // The hub's live state is asked for once Settings has faded in: starting three requests took ~9 ms of the key press.
  setTimeout(() => refreshLive().then(() => { if (S.overlay === "settings") renderSettings(); }), 400);
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
  else if (it.id === "wall") return openWallPicker();
  else if (it.id === "conn") return openConnMenu();

  else if (it.id === "unhide") return saveTv({ hidden: null }, "Every app is back").then(renderSettings);
  else if (it.id === "reorder") return saveTv({ apps: null }, "Apps are back in recent order").then(renderSettings);
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
  const when = $(".when"), hc = prefs.homeClock || "Time and date";
  when.classList.toggle("time-only", hc === "Time");
  when.classList.toggle("off", hc === "Off");
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
  if (document.hidden) return; // another app is on screen: no screensaver behind it
  saverTimer = setTimeout(() => { if (!S.overlay && S.zone !== "bar" && !document.hidden) startSaver(); }, mins * 60000);
  // 15 s before it starts, its first photo is fetched and decoded, so starting doesn't stop to decode it (~170 ms).
  clearTimeout(armSaver.warm);
  armSaver.warm = setTimeout(async () => {
    if (S.overlay || document.hidden) return;
    if (!SAVER.photos.length || Date.now() - SAVER.at > SAVER_STALE) await loadSaverPhotos();
    preloadNext();
    SAVER.preload?.decode?.().catch(() => {});
  }, Math.max(0, mins * 60000 - 15000));
}

/* The screensaver: photos from the library chosen in LocalHub (tv.saver: the hub's wallpapers, this
   computer's Pictures or iCloud Photos, or a folder; tv-saver.mjs serves them), one after another with a
   slow crossfade and, unless it's set to Fade or the glass is Light, a slow Ken Burns move. The next
   photo is loaded before its turn. Over them, bottom left like tvOS: the time, the date and the widgets
   picked for it, as glass cards. With no hub, or a library that is empty or fails, the wallpapers show. */
const SAVER_DEFAULT = { source: "wallpapers", folder: "", interval: 12, shuffle: true, motion: "kenburns", widgets: ["clock", "date"] };
const SAVER_SOURCES = { wallpapers: "Wallpapers", pictures: "Pictures", icloud: "iCloud Photos", folder: "Folder" };
// Without LocalHub: the TV's own photos, at its 1920x1080.
const SAVER_WALLS = Object.keys(TV_PHOTOS).map((id) => ({ id: `wall-${id}`, url: `./photos/saver/${id}.jpg` }));
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
  // The widgets you put on the TV in LocalHub (Home, TV view) that this screen can draw, down the right.
  // Each at the size you gave it in LocalHub (s, m or l): the same card, the same sizes, as on LocalHub's Home.
  const sizes = {};
  for (const x of SETTINGS?.widgets?.tv || []) { const id = x?.id || x?.[0]; if (id) sizes[id] = x?.size || x?.[1] || "m"; }
  const ids = [...new Set([...Object.keys(sizes), ...w])].filter((id) => id !== "clock" && id !== "date" && WIDGETS[id]).slice(0, 3);
  const cards = ids.map((id) => widgetCard(id, sizes[id] || "m")).join("");
  $("#saverHud").innerHTML = `${cards ? `<div class="saver-cards">${cards}</div>` : ""}${time || date ? `<div class="saver-when">${time}${date}</div>` : ""}`;
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

/* The assistant's voice: Kokoro (an open voice model, the one Quartzi speaks with), on the laptop (tv/tts.py via
   /api/tv/speak). Each sentence is fetched and played in turn while the next is being made, so the first words come
   fast. If the laptop can't (no model, no hub), the TV's own voice says it instead. */
const VOICE = {
  queue: [], playing: false, gen: 0, audio: null, ahead: null,
  name: () => ({ Heart: "af_heart", Bella: "af_bella", Nicole: "af_nicole", Michael: "am_michael", Fenrir: "am_fenrir", Emma: "bf_emma", George: "bm_george" })[prefs.ttsVoice] || "af_heart",
  fetch(text) {
    return fetch("/api/tv/speak", { method: "POST", headers: { "content-type": "application/json", "x-hub": "1" }, body: JSON.stringify({ text, voice: this.name() }) })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))));
  },
  say(text) {
    const parts = (String(text || "").replace(/\s+/g, " ").match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || []).map((p) => p.trim()).filter(Boolean);
    // Starting from silence, a long first sentence is split at its first clause: the first sound comes sooner.
    if (!this.playing && !this.queue.length && parts[0] && parts[0].length > 70) {
      const m = /^(.{24,}?[,;:—–])\s+(.+)$/.exec(parts[0]);
      if (m) parts.splice(0, 1, m[1], m[2]);
    }
    for (const p of parts) this.queue.push(p);
    if (!this.playing) this.next(this.gen);
  },
  async next(gen) {
    if (gen !== this.gen) return;
    const text = this.queue.shift();
    if (!text) { this.playing = false; return; }
    this.playing = true;
    const blob = this.ahead?.text === text ? this.ahead.p : this.fetch(text);
    this.ahead = null;
    // The next sentence is made while this one plays.
    if (this.queue[0]) this.ahead = { text: this.queue[0], p: this.fetch(this.queue[0]) };
    let b;
    try { b = await blob; } catch { if (gen === this.gen) { native("speak", text); this.next(gen); } return; }
    if (gen !== this.gen) return;
    const url = URL.createObjectURL(b);
    const a = (this.audio = new Audio(url));
    const done = () => { URL.revokeObjectURL(url); if (this.audio === a) this.audio = null; this.next(gen); };
    a.onended = done;
    a.onerror = done;
    a.play().catch(done);
  },
  hush() {
    this.gen++;
    this.queue = [];
    this.ahead = null;
    this.playing = false;
    try { this.audio?.pause(); } catch { /* fine */ }
    this.audio = null;
    native("stopSpeaking");
  },
};

/* "Read answers aloud" (Settings), for tabs/chat.js: "After voice" speaks a reply when the question was
   spoken, "Always" speaks every reply, "Off" never speaks. */
window.HubSpeech = { mode: () => speakMode() };

if (NATIVE) {
  window.HubVoice = {
    // Resolves with what was said ("" when nothing was), rejects when the TV has no mic it can use.
    listen({ onLevel, onWorking } = {}) {
      // A Fire TV Stick opens a recorder that never delivers a frame (the remote's mic belongs to Alexa), and the
      // read blocks. No level within 2.5 s means no mic: say so once, and don't try again this session.
      const NO_MIC = "This TV has no microphone LocalHub can use. Press OK on the box, then hold the remote's mic button to dictate";
      // Known to have none (this TV said so before): straight to the remote's dictation, no 2.5 s wait.
      const dictate = (msg) => Object.assign(new Error(msg), { dictate: true });
      if (MIC.none || prefs.noMic) return Promise.reject(dictate(`${NO_MIC}.`));
      return new Promise((resolve, reject) => {
        const dog = setTimeout(() => {
          if (MIC.wait?.dog !== dog) return;
          MIC.none = true;
          prefs.noMic = true;
          savePrefs();
          MIC.wait = null;
          native("cancelListening");
          reject(dictate(`${NO_MIC}, or say “Alexa, ask local hub …”.`));
        }, 2500);
        const heard = (v) => { clearTimeout(dog); onLevel?.(v); };
        MIC.wait = { resolve, reject, onLevel: heard, onWorking, dog };
        native("startListening");
      });
    },
    stop() { native("stopListening"); },
    cancel() { native("cancelListening"); MIC.wait?.resolve(""); MIC.wait = null; },
    speak(text) { if (speakMode() !== "Off") VOICE.say(text); },
    hush() { VOICE.hush(); },
  };
} else if (IN_HUB) {
  // A laptop or iPad: the same voice (speech only; listening stays the browser's).
  window.HubVoice = { speak: (text) => VOICE.say(text), hush: () => VOICE.hush() };
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
    // An app it opened goes into the chat as a card (OK on it opens it again).
    return intent.type === "launch" ? { app: { id: intent.app.id, name: intent.app.name } } : true;
  },
};

const plain = (t) => t.replace(/`[^`]*`/g, "").replace(/https?:\/\/\S+/g, "").replace(/[*_#>|]/g, "").replace(/\s+\n/g, "\n");
function say(text) {
  if (!text || speakMode() === "Off") return;
  if (window.HubChat?.say) return window.HubChat.say(text);
  if (IN_HUB) return VOICE.say(text);
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
    if (S.overlay === "stream" || Stream.isOpen?.()) Stream.close?.(); // whatever LocalHub thought was on top
    if (S.overlay === "hub") closeHub();
    if (S.overlay === "modal") closeModal(false);
    if (S.overlay === "settings") closeSettings();
    if (S.overlay === "cc") closeCC();
    closeRail();
    if (S.view !== "home") showView("home");
    if (S.favSelect) stopFavSelect();
    S.zone = hasFavs() ? "favs" : "grid";
    S.i = 0;
    S.f = favStart();
    S.favX = 0;
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
  S.zone = S.railFrom === "favs" && hasFavs() && S.view === "home" ? "favs" : "grid";
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
  // Settings and the assistant open first, and the sidebar folds away a moment later under them: doing both in
  // one frame cost a 100+ ms frame on a Fire TV Stick.
  if (id === "settings" || id === "assistant") {
    S.zone = S.railFrom === "favs" && id === "settings" ? "favs" : "grid";
    if (id === "settings") openSettings(); else showView(id);
    setTimeout(() => { railOpen(false); paintRail(); }, 320);
    return;
  }
  railOpen(false);
  S.zone = "grid";
  if (id === "home") return showView(id);
  paintRail();
  if (S.view === "home") applyFocus();
  if (id === "browser") { const app = APPS.find((a) => a.id === "browser") || Stream.STREAM_APPS.find((a) => a.id === "browser"); return app ? openApp(app) : toast("The browser runs on the laptop: open LocalHub TV from the hub"); }
  if (id === "saver") return startSaver();
  if (id === "settings") return openSettings();
}

/* ── frozen glass (after APL Launcher's): the wallpaper blurred once, by shrinking it to 48×27 and back
   up to 480×270, then shown behind each glass surface at the stage position it sits over. Nothing
   filters live, so focus moves and panels slide without the GPU redrawing a blur. */
// Home's cover (the TV app's, while Android brings LocalHub back) shows this wallpaper, fetched once by the TV app.
function sendCover() {
  if (!NATIVE || !IN_HUB) return;
  const m = /url\(["']?([^"')]+)["']?\)/.exec($("#hub-wall").style.backgroundImage || "");
  if (!m || m[1].startsWith("data:")) return;
  try { const u = new URL(m[1], location.href); if (u.origin === location.origin) setTimeout(() => native("setCover", u.pathname), 4000); } catch { /* not a URL */ }
}

async function bakeGlass() {
  const m = /url\(["']?([^"')]+)["']?\)/.exec($("#hub-wall").style.backgroundImage || ""); // set by applyLook; the computed style forced a whole-page style pass
  if (m?.[1] === bakeGlass.url) return;
  bakeGlass.url = m?.[1];
  if (!m) return document.documentElement.style.removeProperty("--frozen");
  // Kept from last time: blurring the 4K photo took the stick ~440 ms of every start.
  const key = "localhub.tv.frozen:" + m[1];
  const kept = (() => { try { return localStorage.getItem(key); } catch { return null; } })();
  if (kept) return document.documentElement.style.setProperty("--frozen", `url(${kept})`);
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
    const url = big.toDataURL("image/jpeg", 0.85);
    document.documentElement.style.setProperty("--frozen", `url(${url})`);
    try {
      Object.keys(localStorage).filter((k) => k.startsWith("localhub.tv.frozen:")).forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(key, url);
    } catch { /* storage off: baked again next time */ }
  } catch (e) { console.warn("glass", e); }
}

function handleKey(name) {
  S.touched = true;
  // Typing in the search bar: Back closes it (keeping what's typed) and stays on it.
  const sb = document.activeElement?.classList?.contains("sb") ? document.activeElement : null;
  if (sb && name === "back") return endSearch(sb, true);
  armSaver();
  if (S.overlay === "saver") return stopSaver();
  // Opening an app: Back always comes home, even if the app never came up.
  if (S.overlay === "launch") { if (name === "back") endLaunch(); return; }
  if (S.overlay === "stream") return void Stream.key(name);
  if (S.overlay === "hub") { if (name === "back") closeHub(); return; }
  if (name === "help") { prefs.help = !prefs.help; savePrefs(); return showKeys(prefs.help); }
  if (S.overlay === "modal") { if (name === "back") closeModal(false); return; }
  if (S.overlay === "tilemenu") return tileMenuKey(name);
  if (S.overlay === "wallpick") return wallKey(name);
  if (S.overlay === "wpanel") return wpKey(name);
  if (S.moving) return moveKey(name);
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
    case "hold": return openTileMenu();
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
      if (S.favSelect) { stopFavSelect(); return toast("Stopped picking a favorite"); }
      if (S.search && S.zone === "grid") { S.search = ""; const sb = $("#favTrack .sb"); if (sb) sb.value = ""; loadItems(); S.i = 0; renderGrid(); return toast("Showing every app"); }
      if (S.zone === "favs") { if (S.f !== favStart()) { S.f = favStart(); return applyFocus(); } return openRail(); }
      if (S.zone !== "grid") { S.zone = "grid"; return applyFocus(); }
      if (hasFavs() && S.i < COLS) { S.zone = "favs"; S.f = favStart(); return applyFocus(); }
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
  setTimeout(() => { node.classList.remove("pressed"); fn(); }, 80); // OK already waits for the key to come up
}

/* ── Settings › LocalHub: search again, the address, pairing, forgetting ── */
function openConnMenu() {
  S.menu = [
    { id: "conn:find", label: "Search the network again", ic: SYM.search },
    { id: "conn:address", label: "Type its address", ic: SYM.input },
    ...(!HUB.paired ? [{ id: "conn:pair", label: "Pair this TV", ic: SYM.plus }] : []),
    { id: "conn:forget", label: "Forget LocalHub", ic: SYM.trash },
  ];
  S.menuAt = 0;
  S.menuFor = null;
  S.menuFrom = S.overlay;
  $("#tileMenuName").textContent = "LocalHub";
  $("#tileMenuList").innerHTML = S.menu.map((m, i) => `<div class="tilemenu-item" data-m="${i}">${m.ic}<span>${esc(m.label)}</span></div>`).join("");
  paintTileMenu();
  $("#tileMenu").classList.add("on");
  setOverlay("tilemenu");
}
function connAction(id) {
  if (id === "find") { HUB.searching = true; native("findHub"); toast("Looking for LocalHub…"); }
  else if (id === "address") return openModal("LocalHub address", "The laptop's address on your network, and the hub's port.", HUB.url.replace(/^https?:\/\//, ""), (v) => { native("setHub", v.trim()); HUB.paired = false; probeNative(); });
  else if (id === "pair") return openPairing();
  else if (id === "forget") { native("forgetHub"); HUB.paired = false; toast("This TV forgot LocalHub"); }
  renderSettings();
}

/* ── Settings › Wallpaper: pick one on the TV ──────────────────────────── */
const WALL_NAMES = { aurora: "Aurora", dusk: "Dusk", graphite: "Graphite", ocean: "Ocean", sand: "Sand", "mono-light": "Light", "mono-dark": "Dark", noise: "Grain", none: "None" };
function wallName(id) {
  if (WALL_NAMES[id]) return WALL_NAMES[id];
  const g = (SETTINGS?.wallpaper?.custom || []).find((w) => w.id === id) || (SETTINGS?.wallpaper?.uploads || []).find((w) => w.id === id);
  return g?.name || cap(String(id || "").replace(/^custom-/, "")) || "Custom";
}
// Every wallpaper: the built-in ones (their small pictures, not the 4K photos), your gradients and your uploads.
function wallChoices() {
  const w = SETTINGS?.wallpaper || {};
  return [
    ...Object.keys(BUILTIN_WALLS).map((id) => ({ id, name: wallName(id), pic: TV_PHOTOS[id] ? `./photos/thumbs/${id}.jpg` : `./wallpapers/${id}.svg` })),
    ...(w.custom || []).map((g) => ({ id: g.id, name: wallName(g.id), css: gradCss(g) })),
    ...(w.uploads || []).map((u) => ({ id: u.id, name: wallName(u.id), pic: `/api/hub/wallpapers/${u.file}` })),
  ];
}
function openWallPicker() {
  S.walls = wallChoices();
  const cur = SETTINGS?.wallpaper?.current ?? "aurora";
  S.wallAt = Math.max(0, S.walls.findIndex((x) => x.id === cur));
  paintWallGrid();
  $("#wallPick").classList.add("on");
  S.wallFrom = S.overlay;
  S.overlay = "wallpick";
}
function paintWallGrid() {
  const cur = SETTINGS?.wallpaper?.current ?? "aurora";
  $("#wallGrid").innerHTML = S.walls.map((x, i) => `<div class="wp${i === S.wallAt ? " sel" : ""}" data-w="${i}"><div class="wp-pic"${x.css ? ` style="background:${esc(x.css)}"` : ""}>${x.pic ? `<img src="${esc(x.pic)}" alt="" decoding="async">` : ""}${x.id === cur ? `<span class="wp-check">${sym('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 3)}</span>` : ""}</div><div class="wp-name">${esc(x.name)}</div></div>`).join("");
  // More than two rows: the grid slides so the chosen row stays in view.
  const row = Math.floor(S.wallAt / 4);
  $("#wallGrid").style.transform = row > 1 ? `translateY(${-(row - 1) * 260}px)` : "";
}
function closeWallPicker() {
  $("#wallPick").classList.remove("on");
  S.overlay = S.wallFrom || null;
  if (S.overlay === "settings") renderSettings();
}
async function wallKey(name) {
  const n = S.walls.length;
  const d = { left: -1, right: 1, up: -4, down: 4 }[name];
  if (d) { const to = S.wallAt + d; if (to >= 0 && to < n) { S.wallAt = to; paintWallGrid(); } return; }
  if (name === "back" || name === "menu") return closeWallPicker();
  if (name !== "enter") return;
  const pick = S.walls[S.wallAt];
  if (!pick || pick.id === (SETTINGS?.wallpaper?.current ?? "aurora")) return closeWallPicker();
  try {
    const r = await fetch("/api/hub/settings", { method: "POST", headers: { "content-type": "application/json", "x-hub": "1" }, body: JSON.stringify({ wallpaper: { current: pick.id } }) });
    if (!r.ok) return toast("LocalHub couldn't save that");
    await syncHub();
    paintWallGrid();
    toast(`Wallpaper: ${pick.name}`);
  } catch { toast("LocalHub didn't answer"); }
}

/* ── the Favorites row's buttons: + (pick a favorite), sort, search ─────── */
function startFavSelect() {
  if (!IN_HUB) return toast("Pair this TV with LocalHub to keep favorites");
  S.favSelect = true;
  $("#grid").classList.add("picking");
  S.zone = "grid";
  S.i = 0;
  applyFocus();
  toast("Pick an app for Favorites: OK adds it. Back to stop");
}
function stopFavSelect() {
  S.favSelect = false;
  $("#grid").classList.remove("picking");
}
async function pickFavorite(it) {
  stopFavSelect();
  if (!movable(it)) return toast("That one can't be a favorite");
  const favs = SETTINGS?.tv?.favorites || [];
  if (favs.includes(it.id)) return toast(`${it.name} is already in Favorites`);
  await saveTv({ favorites: [...favs, it.id] }, `Added ${it.name} to Favorites`);
}
// How the apps are sorted: recent first (tvOS), A to Z, or your own order (Move, on a tile).
const SORTS = { recent: "Recent first", az: "A to Z", custom: "Your order" };
const sortMode = () => prefs.sort || (Array.isArray(SETTINGS?.tv?.apps) && SETTINGS.tv.apps.length ? "custom" : "recent");
function openSortMenu() {
  S.menu = Object.entries(SORTS).map(([id, label]) => ({ id: `sort:${id}`, label: label + (sortMode() === id ? "  ✓" : ""), ic: SYM.sort }));
  S.menuAt = Math.max(0, Object.keys(SORTS).indexOf(sortMode()));
  S.menuFor = null;
  $("#tileMenuName").textContent = "Sort apps";
  $("#tileMenuList").innerHTML = S.menu.map((m, i) => `<div class="tilemenu-item" data-m="${i}">${m.ic}<span>${esc(m.label)}</span></div>`).join("");
  paintTileMenu();
  $("#tileMenu").classList.add("on");
  setOverlay("tilemenu");
}
function setSort(id) {
  prefs.sort = id;
  savePrefs();
  const keep = ITEMS[S.i]?.id;
  loadItems();
  S.i = Math.max(0, ITEMS.findIndex((x) => x.id === keep));
  renderGrid();
  toast(`Apps: ${SORTS[id]}`);
}
// Search: OK on the search bar opens the keyboard; the apps narrow as you type; OK (Enter) goes to the results.
function openSearch() {
  const sb = $("#favTrack .sb");
  if (!sb) return;
  sb.focus();
  try { sb.setSelectionRange(sb.value.length, sb.value.length); } catch { /* fine */ }
  native("setTyping", true);
  native("keyboard", true); // the TV's keyboard opens with the same OK
}
function applySearch(v) {
  const q = String(v || "").trim();
  if (q === (S.search || "")) return;
  S.search = q;
  loadItems();
  S.i = 0;
  renderGrid();
}
document.addEventListener("input", (e) => {
  if (!e.target.classList?.contains("sb")) return;
  clearTimeout(applySearch.t);
  applySearch.t = setTimeout(() => applySearch(e.target.value), 220);
});
// Done typing (Enter, or the keyboard closed): the search is applied and focus goes to the results.
function endSearch(sb, stay) {
  if (endSearch.busy) return;
  endSearch.busy = true;
  native("setTyping", false);
  native("keyboard", false);
  clearTimeout(applySearch.t);
  applySearch(sb.value);
  if (document.activeElement === sb) sb.blur();
  endSearch.busy = false;
  if (stay) return; // left with the arrows: focus moves on from the search bar like any button
  const n = ITEMS.filter(movable).length;
  if (S.search) { S.zone = "grid"; S.i = 0; applyFocus(); toast(n ? `${n} app${n === 1 ? "" : "s"} match “${S.search}”` : `Nothing matches “${S.search}”`); }
}
// The arrows (with the keyboard closed) leave the search bar like any other button in the row.
const SB_ARROWS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
document.addEventListener("keydown", (e) => {
  if (!e.target.classList?.contains("sb") || !SB_ARROWS[e.key]) return;
  e.preventDefault();
  e.stopPropagation();
  endSearch(e.target, true);
  handleKey(SB_ARROWS[e.key]);
}, true);
document.addEventListener("keydown", (e) => {
  if (!e.target.classList?.contains("sb") || (e.key !== "Enter" && e.key !== "Escape")) return;
  e.preventDefault();
  if (e.key === "Escape") e.target.value = S.search || "";
  endSearch(e.target);
}, true);
document.addEventListener("focusout", (e) => { if (e.target.classList?.contains("sb")) endSearch(e.target); });

/* ── hold OK on a tile: Open, Move, Hide ───────────────────────────────── */
const movable = (it) => it && APPS.includes(it);
async function saveTv(patch, done) {
  try {
    const r = await fetch("/api/hub/settings", { method: "POST", headers: { "content-type": "application/json", "x-hub": "1" }, body: JSON.stringify({ tv: patch }) });
    if (!r.ok) return toast("LocalHub couldn't save that");
    await syncHub();
    if (done) toast(done);
  } catch { toast("LocalHub didn't answer"); }
}
function openTileMenu() {
  const it = focused();
  if ((S.zone !== "grid" && S.zone !== "favs") || !movable(it)) return activate();
  if (!IN_HUB) return toast("Pair this TV with LocalHub to arrange apps");
  S.menu = S.zone === "favs"
    ? [
      { id: "open", label: "Open", ic: SYM.open },
      ...(FAVS.filter(isPicked).length > 1 ? [{ id: "move", label: "Move", ic: SYM.move }] : []),
      { id: "unfav", label: "Remove from Favorites", ic: SYM.unstar },
    ]
    : [
      { id: "open", label: "Open", ic: SYM.open },
      isFav(it) ? { id: "unfav", label: "Remove from Favorites", ic: SYM.unstar } : { id: "fav", label: "Add to Favorites", ic: SYM.star },
      { id: "move", label: "Move", ic: SYM.move },
      { id: "hide", label: "Hide", ic: SYM.hide },
      ...(it.kind === "site" ? [{ id: "remove", label: "Remove website", ic: SYM.trash }] : []),
    ];
  S.menuAt = 0;
  S.menuFor = it;
  $("#tileMenuName").textContent = it.name;
  $("#tileMenuList").innerHTML = S.menu.map((m, i) => `<div class="tilemenu-item" data-m="${i}">${m.ic}<span>${esc(m.label)}</span></div>`).join("");
  paintTileMenu();
  $("#tileMenu").classList.add("on");
  setOverlay("tilemenu");
}
function paintTileMenu() {
  document.querySelectorAll(".tilemenu-item").forEach((n) => n.classList.toggle("sel", Number(n.dataset.m) === S.menuAt));
}
function closeTileMenu() {
  $("#tileMenu").classList.remove("on");
  setOverlay(S.menuFrom || null); // back to Settings when it was opened from there
  S.menuFrom = null;
}
function tileMenuKey(name) {
  if (name === "up") { S.menuAt = Math.max(0, S.menuAt - 1); return paintTileMenu(); }
  if (name === "down") { S.menuAt = Math.min(S.menu.length - 1, S.menuAt + 1); return paintTileMenu(); }
  if (name === "back" || name === "menu" || name === "hold") return closeTileMenu();
  if (name !== "enter") return;
  const it = S.menuFor, act = S.menu[S.menuAt].id;
  closeTileMenu();
  if (act.startsWith("sort:")) return setSort(act.slice(5));
  if (act.startsWith("conn:")) return connAction(act.slice(5));
  if (act === "open") return press(activate);
  const favs = SETTINGS?.tv?.favorites || [];
  if (act === "fav") return saveTv({ favorites: [...favs.filter((x) => x !== it.id), it.id] }, `Added ${it.name} to Favorites`);
  if (act === "unfav") {
    if (S.zone === "favs" && S.f >= favs.length - 1) S.f = Math.max(0, S.f - 1);
    return saveTv({ favorites: favs.filter((x) => x !== it.id) }, `Removed ${it.name} from Favorites`);
  }
  const howToMove = S.touch ? "Tap where it should go" : "Move it with the arrows, then press OK";
  if (act === "move") { S.moving = it.id; paintMoving(); return toast(howToMove); }
  if (act === "hide") {
    const hidden = [...new Set([...(SETTINGS?.tv?.hidden || []), it.id])];
    return saveTv({ hidden }, `Hid ${it.name}. Settings, Hidden apps brings it back`);
  }
  if (act === "remove") { S.removeAsk = { id: it.id, at: Date.now() }; return removeSitePress(it); }
}
function paintMoving() {
  document.querySelectorAll(".app.moving").forEach((n) => n.classList.remove("moving"));
  if (S.moving) $(S.zone === "favs" ? `.fav[data-f="${S.f}"]` : `.app[data-i="${S.i}"]`)?.classList.add("moving");
}
// Moving: the arrows swap the tile with its neighbour among the apps; OK or Back keeps the new order.
function moveKey(name) {
  // Within Favorites: left and right only, saved as tv.favorites.
  if (S.zone === "favs") {
    const from = FAVS.findIndex((a) => a.id === S.moving);
    if (name === "enter" || name === "back" || name === "hold") {
      S.moving = null;
      paintMoving();
      return saveTv({ favorites: FAVS.filter(isPicked).map((a) => a.id) }, "Saved your Favorites");
    }
    const d = { left: -1, right: 1 }[name];
    const to = from + (d || 0);
    if (!d || from < 0 || !isPicked(FAVS[to])) return; // only among your favorites, not past the buttons or the +
    const [moved] = FAVS.splice(from, 1);
    FAVS.splice(to, 0, moved);
    S.f = to;
    renderFavs();
    applyFocus();
    return paintMoving();
  }
  const apps = ITEMS.filter(movable);
  const from = apps.findIndex((a) => a.id === S.moving);
  if (name === "enter" || name === "back" || name === "hold") {
    S.moving = null;
    paintMoving();
    return saveTv({ apps: apps.map((a) => a.id) }, "Saved the new order");
  }
  const d = { left: -1, right: 1, up: -COLS, down: COLS }[name];
  if (!d || from < 0) return;
  const to = Math.max(0, Math.min(apps.length - 1, from + d));
  if (to === from) return;
  const [moved] = apps.splice(from, 1);
  apps.splice(to, 0, moved);
  ITEMS = [...apps, ...ITEMS.filter((x) => !movable(x))];
  S.i = to;
  renderGrid();
  paintMoving();
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
  const fav = app.dataset.f !== undefined, i = Number(fav ? app.dataset.f : app.dataset.i);
  if (S.zone !== (fav ? "favs" : "grid") || (fav ? S.f : S.i) !== i) {
    if (S.zone === "bar") leaveBar();
    S.zone = fav ? "favs" : "grid";
    if (fav) S.f = i; else S.i = i;
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
function pickTile(a) {
  if (a.dataset.f !== undefined) { S.zone = "favs"; S.f = Number(a.dataset.f); } else { S.zone = "grid"; S.i = Number(a.dataset.i); }
  applyFocus();
}
// Touch (an iPad) and the mouse: holding a tile is the remote's held OK, the tile menu. A right-click too.
const HOLD = { t: null, x: 0, y: 0, fired: false };
document.addEventListener("pointerdown", (e) => {
  S.touch = e.pointerType === "touch";
  HOLD.fired = false;
  clearTimeout(HOLD.t);
  const app = e.target.closest?.(".app");
  if (!app || S.overlay || S.moving || PREVIEW) return;
  HOLD.x = e.clientX; HOLD.y = e.clientY;
  HOLD.t = setTimeout(() => { HOLD.fired = true; pickTile(app); openTileMenu(); }, 550);
}, { passive: true });
document.addEventListener("pointermove", (e) => { if (HOLD.t && Math.hypot(e.clientX - HOLD.x, e.clientY - HOLD.y) > 12) clearTimeout(HOLD.t); }, { passive: true });
document.addEventListener("pointerup", () => clearTimeout(HOLD.t), { passive: true });
document.addEventListener("pointercancel", () => clearTimeout(HOLD.t), { passive: true });
document.addEventListener("contextmenu", (e) => {
  const app = e.target.closest?.(".app");
  if (!app) return;
  e.preventDefault();
  if (S.overlay || S.moving || PREVIEW || HOLD.fired) return;
  pickTile(app);
  openTileMenu();
});
// Moving by touch: tap where the tile should go (in the same row of Favorites, or among the apps).
function moveTo(app) {
  if (S.zone === "favs") {
    if (app.dataset.f === undefined) return toast("Tap a spot in Favorites to put it there");
    const from = FAVS.findIndex((a) => a.id === S.moving), to = Number(app.dataset.f);
    if (from >= 0 && to !== from) { const [m] = FAVS.splice(from, 1); FAVS.splice(to, 0, m); S.f = to; renderFavs(); applyFocus(); }
    return moveKey("enter");
  }
  const target = ITEMS[Number(app.dataset.i)];
  if (app.dataset.f !== undefined || !movable(target)) return toast("Tap another app to put it there");
  const apps = ITEMS.filter(movable);
  const from = apps.findIndex((a) => a.id === S.moving), to = apps.indexOf(target);
  if (from >= 0 && to !== from) { const [m] = apps.splice(from, 1); apps.splice(to, 0, m); ITEMS = [...apps, ...ITEMS.filter((x) => !movable(x))]; S.i = to; renderGrid(); }
  return moveKey("enter");
}

document.addEventListener("click", (e) => {
  if (HOLD.fired) { HOLD.fired = false; return; } // the long press already opened the menu
  if (PREVIEW) { const a = e.target.closest(".app"); if (a) pickTile(a); return; }
  if (S.overlay === "saver") return stopSaver();
  if (S.overlay === "wpanel") {
    const row = e.target.closest(".wpi");
    if (row) { S.wpAt = Number(row.dataset.w); paintWpanel(); return wpKey("enter"); }
    if (!e.target.closest(".wpanel")) return closeWidgets();
    return;
  }
  if (S.overlay === "wallpick") {
    const wp = e.target.closest(".wp");
    if (wp) { S.wallAt = Number(wp.dataset.w); return wallKey("enter"); }
    if (!e.target.closest(".wallpick-card")) return closeWallPicker();
    return;
  }
  if (S.overlay === "tilemenu") {
    const item = e.target.closest(".tilemenu-item");
    if (item) { S.menuAt = Number(item.dataset.m); paintTileMenu(); return tileMenuKey("enter"); }
    if (!e.target.closest(".tilemenu-card")) return closeTileMenu();
    return;
  }
  const app = e.target.closest(".app");
  if (app && S.moving && !S.overlay) return moveTo(app);
  if (app && !S.overlay) { pickTile(app); return press(activate); }
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
  if (hasFavs()) { S.zone = "favs"; S.f = favStart(); } // like Home: the first thing is your Favorites
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
    // Home's cover (the TV app's) waits for this on a page that was still loading.
    window.LocalHubSplash?.done?.then(() => native("drawn"));
    // The voice model wakes up on the laptop a little after start, so the first answer read aloud doesn't wait for it.
    if (IN_HUB && !PREVIEW) setTimeout(() => fetch("/api/tv/voices", { cache: "no-store" }).catch(() => {}), 8000);
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
    Assistant = await import("./assistant.js?v=6").catch((e) => { console.warn("assistant", e); return null; });
    Assistant?.init({
      el: $("#assistantView"), toast, native, NATIVE,
      intercept: (t) => window.HubChatHooks?.intercept?.(t) || false,
      openApp: (id) => { const a = APPS.find((x) => x.id === id); if (a) runIntent({ type: "launch", app: a }); else toast("That app isn't on this TV"); },
      openUrl: (url, name) => { let host = ""; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* not a URL */ } openInStream({ id: `url:${url}`, name: name || host || "Website", url, kind: "site", bg: "#26272d", fg: "#ffffff", letter: (name || host || "W").slice(0, 1).toUpperCase() }); },
      appArt: (id) => { const a = APPS.find((x) => x.id === id); return a ? iconHTML(a) : ""; },
      speechMode: () => speakMode(),
      voiceMode: () => voicePref() === "Conversation",
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
