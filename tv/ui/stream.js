// ============================================================================
// LocalHub TV: the TV's browsers. Chromium and Google Chrome run on the laptop (stream.mjs) and show
// here, full screen, as JPEG frames on one HTTP response, drawn to a 1920×1080 canvas. The web apps
// (Netflix, YouTube…) open in them too, inside LocalHub, instead of in another window.
//
// The remote: arrows move a pointer (it speeds up while held, and scrolls at the edges), Enter
// clicks, Back goes back and leaves from the app's first page, Menu types an address or a search,
// ⏯ is the page's Space. Clicking a text field brings up a glass sheet with a real input, so a Fire
// TV shows its own keyboard; on a laptop, just type. Up at the top of a page reaches the bar.
// ============================================================================

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const W = 1920, H = 1080;
const sym = (d, w = 2.2) => `<svg class="sym" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC = {
  back: sym('<path d="m15 18-6-6 6-6"/>', 2.6),
  reload: sym('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  home: sym('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>'),
  lock: sym('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  globe: sym('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>'),
  search: sym('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
};

/* The two browsers, as tiles on the home screen. */
export const STREAM_APPS = [
  { id: "browser", name: "Browser", stream: "chrome", bg: "linear-gradient(160deg,#5aa7ff,#1556c9)", fg: "#ffffff", icon: "browser" },
  { id: "chromium", name: "Chromium", stream: "chromium", bg: "linear-gradient(160deg,#6d8cff,#2a3f9e)", fg: "#ffffff", icon: "chromium" },
];
// Widevine: these need Google Chrome (or Edge); a plain Chromium build can't play them.
const DRM = new Set(["netflix", "primevideo", "disney", "max", "appletv", "hulu", "paramountplus", "crunchyroll", "spotify", "tubi"]);

const hub = (p, body) => fetch(p, { method: "POST", headers: { "content-type": "application/json", "x-hub": "1" }, body: JSON.stringify(body) })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status }); return j; });

let H_ = null; // app.js's hooks: { toast, native, setOverlay, closed, NATIVE }
const ENG = { chromium: null, chrome: null };
const P = {
  open: false, engine: "", app: null, mode: "links", ring: null, cx: W / 2, cy: H / 2, speed: 0, lastDir: "", lastAt: 0,
  bar: 0, barTimer: 0, state: {}, focus: null, typing: null, abort: null, latest: null, decoding: false,
  drawn: 0, fps: 0, size: "", scrollY: 0, live: false, moveTimer: 0, busy: false,
};

/* ── status: which browsers this laptop has ─────────────────────────────── */
export async function refresh() {
  try {
    const r = await fetch("/api/tv/stream/status", { cache: "no-store" });
    if (!r.ok) return;
    const { engines } = await r.json();
    Object.assign(ENG, engines);
  } catch { /* the hub is restarting */ }
}
const known = () => ENG.chromium || ENG.chrome;
const has = (id) => !known() || !!ENG[id]?.available;

/** The engine an app opens in, or "" when none can. */
export function engineFor(app) {
  if (app.stream) return app.stream;
  if (!app.url) return "";
  if (has("chrome")) return "chrome"; // one profile for every sign-in, and Widevine
  if (has("chromium")) return "chromium";
  return "";
}
/** A note for a tile whose browser isn't on this laptop. */
export function noteFor(app) {
  if (!app.stream || has(app.stream)) return "";
  return "Not installed";
}

/* ── the player ────────────────────────────────────────────────────────── */
let el = null;
function build() {
  if (el) return el;
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "./stream.css?v=2";
  document.head.append(css);
  el = document.createElement("section");
  el.className = "player";
  el.id = "player";
  el.setAttribute("aria-label", "Browser");
  el.innerHTML = `
    <canvas class="player-screen" width="${W}" height="${H}"></canvas>
    <div class="player-wait"><i class="glyph"></i><div class="spin"></div><p></p></div>
    <div class="player-cursor"></div>
    <div class="player-ring"></div>
    <nav class="player-bar lg">
      <button type="button" data-act="back" aria-label="Back">${IC.back}</button>
      <div class="player-addr" data-act="address" role="button"><span class="ic">${IC.globe}</span><span class="host"></span><span class="title"></span><i class="load"></i></div>
      <button type="button" data-act="reload" aria-label="Reload">${IC.reload}</button>
      <button type="button" data-act="home" aria-label="Home">${IC.home}</button>
      <span class="player-stats"></span>
    </nav>
    <div class="player-type"><div class="sheet lg"><label></label><input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"><div class="hint"></div></div></div>`;
  ($("#stage") || document.body).append(el);
  const input = $(".player-type input", el);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); finishTyping(true, e.shiftKey ? false : e.ctrlKey || e.metaKey ? true : undefined); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finishTyping(false); }
    else e.stopPropagation();
  });
  // A laptop's mouse works too: it points, clicks and scrolls the page.
  const canvas = $(".player-screen", el);
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; };
  canvas.addEventListener("mousemove", (e) => { el.classList.add("mouse"); [P.cx, P.cy] = at(e); showBarIfTop(); hover(); });
  canvas.addEventListener("click", (e) => { [P.cx, P.cy] = at(e); P.mode = "cursor"; dropRing(); paintBar(); click(); });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); const [x, y] = at(e); send([{ type: "scroll", x, y, dx: e.deltaX, dy: e.deltaY }]); }, { passive: false });
  $(".player-bar", el).addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) barAct(b.dataset.act); });
  return el;
}

export async function open(app, from) {
  const engine = engineFor(app);
  if (!engine) return false;
  if (ENG[engine] && !ENG[engine].available) { H_?.toast(ENG[engine].message || `${app.name} isn't on this computer`); return "missing"; }
  build();
  P.open = true; P.engine = engine; P.app = app; P.mode = "links"; P.ring = null; P.cx = W / 2; P.cy = H / 2; P.focus = null; P.state = {}; P.live = false;
  el.classList.remove("live", "typing", "mode-bar", "mouse", "loading", "mode-cursor", "ringed");
  el.style.setProperty("--a-bg", app.bg || "#111");
  el.style.setProperty("--a-fg", app.fg || "#fff");
  const k = document.getElementById("stage")?.getBoundingClientRect();
  if (from && k) {
    const s = k.width / W;
    el.style.setProperty("--ox", `${(from.left + from.width / 2 - k.left) / s}px`);
    el.style.setProperty("--oy", `${(from.top + from.height / 2 - k.top) / s}px`);
  }
  const wait = $(".player-wait", el);
  wait.classList.remove("err");
  const g = $(".glyph", wait);
  g.style.cssText = app.icon ? `--glyph:url('./brands/${app.icon}.svg')` : "display:none";
  const name = engine === "chrome" ? "Chrome" : "Chromium";
  $("p", wait).textContent = app.stream ? `Opening ${name}…` : `Opening ${app.name} in ${name}…`;
  if (!app.stream && DRM.has(app.id) && engine === "chromium" && ENG.chromium && !ENG.chromium.drm) H_?.toast("Without Google Chrome, protected video may not play");
  paintCursor();
  showBar(4000);
  document.body.classList.add("stream-open");
  H_?.setOverlay("stream");
  requestAnimationFrame(() => el.classList.add("on"));
  try {
    const r = await hub("/api/tv/stream/open", { engine, url: app.url || "", key: app.id });
    if (!P.open || P.app !== app) return true;
    onState(r.state || {});
    pump(engine);
  } catch (e) {
    wait.classList.add("err");
    $("p", wait).textContent = e.message || "The browser didn't start";
  }
  return true;
}

export function close() {
  if (!P.open) return;
  P.open = false;
  P.abort?.abort();
  P.abort = null;
  if (P.typing) finishTyping(false, false, true);
  hub("/api/tv/stream/close", { engine: P.engine }).catch(() => {});
  el.classList.remove("on");
  document.body.classList.remove("stream-open");
  H_?.native?.("setTyping", false);
  H_?.closed?.();
}
export const isOpen = () => P.open;

/* ── frames: [u8 kind][u32 length][payload], kind 1 JPEG, kind 2 state ── */
async function pump(engine) {
  P.abort?.abort();
  const ctl = new AbortController();
  P.abort = ctl;
  let tries = 0;
  while (P.open && P.engine === engine && !ctl.signal.aborted) {
    try {
      const r = await fetch(`/api/tv/stream/frames?engine=${encodeURIComponent(engine)}`, { cache: "no-store", signal: ctl.signal });
      if (r.status === 409) { await hub("/api/tv/stream/open", { engine, key: P.app.id }); continue; } // the hub restarted
      if (!r.ok || !r.body) throw new Error(String(r.status));
      tries = 0;
      const reader = r.body.getReader();
      let buf = new Uint8Array(0);
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const next = new Uint8Array(buf.length + value.length);
        next.set(buf);
        next.set(value, buf.length);
        buf = next;
        let at = 0;
        while (buf.length - at >= 5) {
          const len = ((buf[at + 1] << 24) >>> 0) + (buf[at + 2] << 16) + (buf[at + 3] << 8) + buf[at + 4];
          if (buf.length - at - 5 < len) break;
          const kind = buf[at];
          const body = buf.subarray(at + 5, at + 5 + len);
          at += 5 + len;
          if (kind === 1) { P.latest = body.slice(); if (!P.decoding) draw(); }
          else if (kind === 2) { try { onState(JSON.parse(new TextDecoder().decode(body))); } catch { /* skip */ } }
        }
        buf = buf.subarray(at);
      }
    } catch (e) {
      if (ctl.signal.aborted) return;
    }
    if (!P.open) return;
    await new Promise((r) => setTimeout(r, Math.min(4000, 400 * ++tries)));
  }
}

// Only the newest frame is decoded: when the TV can't keep up, it skips rather than falls behind.
async function draw() {
  P.decoding = true;
  const ctx = $(".player-screen", el).getContext("2d", { alpha: false });
  while (P.latest) {
    const jpg = P.latest;
    P.latest = null;
    try {
      const bmp = await createImageBitmap(new Blob([jpg], { type: "image/jpeg" }));
      ctx.drawImage(bmp, 0, 0, W, H);
      P.size = `${bmp.width}×${bmp.height}`;
      bmp.close?.();
      P.drawn++;
      if (!P.live) { P.live = true; el.classList.add("live"); }
    } catch { /* a cut-off frame */ }
  }
  P.decoding = false;
}
setInterval(() => {
  P.fps = P.drawn;
  P.drawn = 0;
  window.__tvStream = { open: P.open, engine: P.engine, fps: P.fps, size: P.size, serverFps: P.state.fps || 0, quality: P.state.quality || 0, url: P.state.url || "", title: P.state.title || "" };
  if (P.open && el) $(".player-stats", el).textContent = P.size ? `${P.size} · ${P.fps} fps` : "";
}, 1000);

function onState(s) {
  P.state = { ...P.state, ...s };
  if (!el) return;
  let host = "", secure = false;
  try { const u = new URL(P.state.url); host = u.protocol === "about:" ? "" : u.host.replace(/^www\./, ""); secure = u.protocol === "https:"; } catch { /* about:blank */ }
  $(".player-addr .host", el).textContent = host || "Search or type an address";
  $(".player-addr .title", el).textContent = P.state.title && P.state.title !== P.state.url && !P.state.url.includes(P.state.title) ? P.state.title : "";
  $(".player-addr .ic", el).innerHTML = host ? (secure ? IC.lock : IC.globe) : IC.search;
  if (s.url && s.url !== P.ringUrl) dropRing();
  el.classList.toggle("loading", !!P.state.loading);
  if (P.state.loading) showBar(2500);
}

/* ── input ─────────────────────────────────────────────────────────────── */
function send(events) {
  return hub("/api/tv/stream/input", { engine: P.engine, events }).catch((e) => { if (e.status !== 409) H_?.toast(e.message); return {}; });
}
function hover() {
  clearTimeout(P.moveTimer);
  P.moveTimer = setTimeout(() => send([{ type: "move", x: P.cx, y: P.cy }]), 45);
}
async function click() {
  const c = $(".player-cursor", el);
  c.classList.add("press");
  setTimeout(() => c.classList.remove("press"), 160);
  const r = await send([{ type: "click", x: P.cx, y: P.cy }]);
  P.focus = r.focus || null;
  if (P.focus && !el.classList.contains("mouse")) startTyping("page");
}
function paintCursor() {
  const c = el && $(".player-cursor", el);
  if (!c) return;
  c.style.left = `${P.cx}px`;
  c.style.top = `${P.cy}px`;
}

// Held arrows speed up: each press inside 200 ms of the last one in the same direction is 30% faster.
async function moveCursor(dx, dy) {
  el.classList.remove("mouse");
  const now = performance.now();
  const dir = `${dx},${dy}`;
  P.speed = dir === P.lastDir && now - P.lastAt < 200 ? Math.min(110, P.speed * 1.3) : 26;
  P.lastDir = dir;
  P.lastAt = now;
  const nx = P.cx + dx * P.speed, ny = P.cy + dy * P.speed;
  const edge = 14;
  // At an edge the page scrolls instead; at the very top, Up goes on to the bar.
  if (ny > H - edge || ny < edge) {
    P.cy = Math.max(edge, Math.min(H - edge, ny));
    paintCursor();
    if (P.busy) return;
    P.busy = true;
    const before = P.scrollY;
    const r = await send([{ type: "scroll", x: P.cx, y: P.cy, dx: 0, dy: dy * 420 }]);
    P.busy = false;
    if (r.scroll) P.scrollY = r.scroll.y;
    if (dy < 0 && (!r.scroll || (r.scroll.y === 0 && before === 0))) focusBar();
    return;
  }
  if (nx > W - edge || nx < edge) {
    P.cx = Math.max(edge, Math.min(W - edge, nx));
    paintCursor();
    send([{ type: "scroll", x: P.cx, y: P.cy, dx: dx * 420, dy: 0 }]);
    return;
  }
  P.cx = nx;
  P.cy = ny;
  paintCursor();
  showBarIfTop();
  hover();
}

/* ── links: the arrows jump between the things you can press ─────────────
   Like a TV's own browser: Up/Down/Left/Right go to the nearest link, button or field that way (the hub finds it
   on the page), OK presses it, and with nothing left that way the page scrolls. Menu swaps to the free cursor. */
function paintRing() {
  const r = el && $(".player-ring", el);
  if (!r) return;
  const t = P.ring;
  el.classList.toggle("ringed", !!t && P.mode === "links");
  if (!t) return;
  r.style.transform = `translate(${t.x - 6}px, ${t.y - 6}px)`;
  r.style.width = `${t.w + 12}px`;
  r.style.height = `${t.h + 12}px`;
}
function dropRing() { P.ring = null; P.ringUrl = P.state.url; paintRing(); }
async function snap(dir, again) {
  if (P.busy) return;
  P.busy = true;
  const r = await send([{ type: "snap", x: P.cx, y: P.cy, dir }]);
  P.busy = false;
  if (!P.open || P.mode !== "links") return;
  if (r.target) {
    P.ring = r.target;
    P.ringUrl = P.state.url;
    P.cx = r.target.cx;
    P.cy = r.target.cy;
    paintCursor();
    paintRing();
    if (P.cy < 150) showBar(1500);
    return;
  }
  if (again || dir === "left" || dir === "right") return;
  // Nothing more that way on screen: scroll, then take the first thing that came into view.
  const dy = dir === "down" ? 1 : -1;
  P.busy = true;
  const before = P.scrollY;
  const s = await send([{ type: "scroll", x: W / 2, y: H / 2, dx: 0, dy: dy * 640 }]);
  P.busy = false;
  if (s.scroll) P.scrollY = s.scroll.y;
  if (dy < 0 && (!s.scroll || (s.scroll.y === 0 && before === 0))) { dropRing(); return focusBar(); }
  if (s.scroll && s.scroll.y === before) return; // the end of the page
  // Start from where the last ring is now that the page moved (frame pixels = CSS pixels × the hub's zoom).
  const moved = s.scroll ? (s.scroll.y - before) * (s.zoom || 1) : 0;
  P.cy = Math.max(20, Math.min(H - 20, P.cy - moved));
  dropRing();
  snap(dir, true);
}
function setMode(mode) {
  P.mode = mode;
  el.classList.toggle("mode-cursor", mode === "cursor");
  paintRing();
  H_?.toast(mode === "cursor" ? "Free cursor: arrows move it · Menu for links" : "Links: arrows jump between links · Menu for the cursor");
}

/* ── the bar ───────────────────────────────────────────────────────────── */
const BAR = ["back", "address", "reload", "home"];
function showBar(ms) {
  el.classList.add("bar");
  clearTimeout(P.barTimer);
  if (ms) P.barTimer = setTimeout(() => { if (P.mode !== "bar" && !P.typing && !P.state.loading) el.classList.remove("bar"); }, ms);
}
function showBarIfTop() { if (P.cy < 150) showBar(1500); }
function focusBar() {
  if (P.mode !== "bar") P.lastMode = P.mode;
  P.mode = "bar";
  P.bar = 1;
  showBar();
  paintBar();
}
function paintBar() {
  el.classList.toggle("mode-bar", P.mode === "bar");
  el.querySelectorAll(".player-bar [data-act]").forEach((n) => n.classList.toggle("is-sel", P.mode === "bar" && n.dataset.act === BAR[P.bar]));
  $(".player-bar [data-act=back]", el).disabled = false;
  if (P.mode !== "bar") showBar(1500);
}
function barAct(act) {
  if (act === "back") return goBack();
  if (act === "address") return startTyping("address");
  if (act === "reload") return nav({ act: "reload" });
  if (act === "home") return close();
}
async function nav(body) {
  const r = await hub("/api/tv/stream/nav", { engine: P.engine, ...body }).catch((e) => { H_?.toast(e.message); return {}; });
  showBar(2500);
  return r;
}
async function goBack() {
  const r = await nav({ act: "back" });
  if (r.left) close();
}

/* ── typing ────────────────────────────────────────────────────────────── */
function startTyping(target, first = "") {
  const input = $(".player-type input", el);
  const f = target === "page" ? P.focus : null;
  P.typing = { target, search: target === "address" || /search|find|query|\bq\b/i.test(`${f?.type} ${f?.label}`) };
  input.type = f?.secret ? "password" : f?.type === "email" ? "email" : f?.type === "url" ? "url" : "text";
  input.value = first || (target === "address" ? P.state.url && !P.state.url.startsWith("about:") ? P.state.url : "" : f?.value || "");
  $(".player-type label", el).textContent = target === "address" ? "Search or type an address" : f?.label || (f?.secret ? "Password" : "Type here");
  $(".player-type .hint", el).innerHTML = H_?.NATIVE ? "OK to finish · Back to cancel" : `<kbd>Enter</kbd> ${P.typing.search ? "go" : "done"} · <kbd>Esc</kbd> cancel${target === "page" && !P.typing.search ? " · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> send" : ""}`;
  el.classList.add("typing");
  showBar();
  H_?.native?.("setTyping", true);
  setTimeout(() => { input.focus(); if (!first) input.select(); else input.setSelectionRange(input.value.length, input.value.length); }, 30);
}
async function finishTyping(ok, submit, quiet) {
  const t = P.typing;
  if (!t) return;
  const input = $(".player-type input", el);
  const text = input.value;
  P.typing = null;
  el.classList.remove("typing");
  input.blur();
  input.value = "";
  H_?.native?.("setTyping", false);
  if (P.mode !== "bar") showBar(1500);
  if (!ok || quiet) return;
  if (t.target === "address") { P.mode = "cursor"; paintBar(); return nav({ act: "go", url: text }); }
  await send([{ type: "text", text, replace: true, submit: submit ?? t.search }]);
}

/* ── keys ──────────────────────────────────────────────────────────────── */
/** The remote's keys, by name: left right up down enter back menu ai. */
export function key(name) {
  if (!P.open) return false;
  if (P.typing) { if (name === "back") finishTyping(false); else if (name === "enter") finishTyping(true); return true; }
  if (P.mode === "bar") {
    if (name === "left") P.bar = Math.max(0, P.bar - 1);
    else if (name === "right") P.bar = Math.min(BAR.length - 1, P.bar + 1);
    else if (name === "down" || name === "back") { P.mode = P.lastMode || "links"; P.cy = Math.max(P.cy, 170); paintCursor(); paintRing(); }
    else if (name === "enter") { const act = BAR[P.bar]; if (act !== "back") { P.mode = P.lastMode || "links"; } barAct(act); }
    else if (name === "menu") startTyping("address");
    paintBar();
    return true;
  }
  if (P.mode === "links" && ["left", "right", "up", "down"].includes(name)) { snap(name); return true; }
  if (name === "left") moveCursor(-1, 0);
  else if (name === "right") moveCursor(1, 0);
  else if (name === "up") moveCursor(0, -1);
  else if (name === "down") moveCursor(0, 1);
  else if (name === "enter") click();
  else if (name === "back") goBack();
  else if (name === "menu") setMode(P.mode === "links" ? "cursor" : "links");
  else if (name === "ai") send([{ type: "key", key: " " }]);
  else if (name === "rew" || name === "ff") send([{ type: "key", key: name === "ff" ? "ArrowRight" : "ArrowLeft" }]); // seek a video
  return true;
}

// A laptop's keyboard. Registered before app.js's own listener, so the home screen never sees these keys.
const KEYNAME = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Enter: "enter", Escape: "back", BrowserBack: "back", ContextMenu: "menu", MediaPlayPause: "ai" };
document.addEventListener("keydown", (e) => {
  if (!P.open) return;
  if (P.typing && e.target === $(".player-type input", el)) return; // the sheet's own handler
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.altKey && e.key === "ArrowLeft") return goBack();
  if ((e.ctrlKey || e.metaKey) && /^[lL]$/.test(e.key)) return startTyping("address");
  if (e.key === "Backspace") return P.focus ? send([{ type: "key", key: "Backspace" }]) : goBack();
  if (KEYNAME[e.key]) return key(KEYNAME[e.key]);
  if (P.mode === "cursor" && ["Tab", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) return send([{ type: "key", key: e.key, modifiers: e.shiftKey ? 8 : 0 }]);
  // Any other letter starts typing: into the page's field after a click on one, otherwise a search.
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) startTyping(P.focus ? "page" : "address", e.key);
}, true);

export function init(hooks) { H_ = hooks; refresh().then(() => H_?.changed?.()); }
