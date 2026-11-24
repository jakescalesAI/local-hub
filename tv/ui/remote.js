// Remotes and controllers, drawn, and what each of their buttons does in LocalHub: the TV's Settings › Fire TV remote (app.js) and
// the hub page's Settings › Remotes and controllers (tabs/tvlook.js) both use this, so they show the same thing.
// Styles in panel.css. What was chosen is the hub's tv.buttons, so both agree. remote.webp is the Fire TV remote's picture.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const DEFAULTS = { menu: "mic" };
export const FIXED = new Set(["left", "right", "up", "down", "enter", "back", "hold"]);
export const KINDS = [["remote", "Fire TV remote"], ["pad", "Game controller"], ["other", "Anything else"]];
export const ACTIONS = [
  ["mic", "Microphone"], ["assistant", "Assistant"], ["overlay", "Overlay"], ["home", "Home"], ["menu", "Sidebar and menus"], ["browser", "Browser"], ["files", "Files"], ["ai", "Play / pause"],
  ["rew", "Page up, rewind"], ["ff", "Page down, fast forward"], ["volup", "Volume up"], ["voldown", "Volume down"], ["saver", "Screensaver"], ["sleep", "Sleep"], ["settings", "Settings"], ["none", "Nothing"],
];
// The Fire TV remote, at its picture's own size (524 × 1920). map: can be given a job. sys: Fire TV takes it for itself, so it needs
// In every app. key: Android's name for it.
const c = (id, label, x, y, r, o) => ({ id, label, x, y, r, ...o });
export const BUTTONS = [
  c("power", "Power", 96, 112, 41, { map: true, sys: true, key: "POWER", note: "The TV set itself still goes on and off: the remote sends that by infrared" }),
  c("alexa", "Alexa", 262, 229, 56, { map: true, sys: true, key: "SEARCH", note: "Given another job, it no longer talks to Alexa" }),
  c("dpad", "Arrows and OK", 262, 533, 206, { why: "Arrows and OK always move and open, so you can’t lock yourself out" }),
  c("back", "Back", 110, 834, 56, { why: "Back always goes back. Held for ten seconds, it lets go of the remote" }),
  c("homebtn", "Home", 262, 834, 56, { map: true, sys: true, key: "HOME", note: "Standard brings LocalHub to the front" }),
  c("menu", "Menu", 414, 834, 56, { map: true, key: "MENU" }),
  c("rew", "Rewind", 110, 986, 56, { map: true, key: "MEDIA_REWIND" }),
  c("ai", "Play / pause", 262, 986, 56, { map: true, key: "MEDIA_PLAY_PAUSE" }),
  c("ff", "Fast forward", 414, 986, 56, { map: true, key: "MEDIA_FAST_FORWARD" }),
  c("mute", "Mute", 110, 1138, 56, { map: true, sys: true, key: "VOLUME_MUTE", note: "If it’s set to your TV or soundbar by infrared, that still happens too" }),
  { id: "volup", label: "Volume up", x: 262, y: 1148, w: 112, h: 130, map: true, sys: true, key: "VOLUME_UP", note: "If it’s set to your TV or soundbar by infrared, that still happens too" },
  { id: "voldown", label: "Volume down", x: 262, y: 1280, w: 112, h: 130, map: true, sys: true, key: "VOLUME_DOWN", note: "If it’s set to your TV or soundbar by infrared, that still happens too" },
  c("guide", "TV / Guide", 414, 1138, 56, { map: true, sys: true, key: "LIVE_TV" }),
  { id: "app2", label: "Prime Video", x: 151, y: 1427, w: 192, h: 82, map: true, sys: true, key: "APP_2" },
  { id: "app1", label: "Netflix", x: 373, y: 1427, w: 192, h: 82, map: true, sys: true, key: "APP_1" },
  { id: "app3", label: "App button, bottom left", x: 151, y: 1548, w: 192, h: 82, map: true, sys: true, key: "APP_3" },
  { id: "app4", label: "App button, bottom right", x: 373, y: 1548, w: 192, h: 82, map: true, sys: true, key: "APP_4" },
];
// A game controller, by Android's key codes: an Xbox, PlayStation, Luna or 8BitDo pad all report these.
export const PAD = [
  c("pad-a", "A (✕)", 452, 196, 22, { why: "A always opens", t: "A" }), c("pad-b", "B (○)", 496, 152, 22, { why: "B always goes back", t: "B" }),
  c("key:99", "X (□)", 408, 152, 22, { t: "X" }), c("key:100", "Y (△)", 452, 108, 22, { t: "Y" }),
  { id: "key:102", label: "Left bumper", x: 130, y: 44, w: 110, h: 26, t: "LB" }, { id: "key:103", label: "Right bumper", x: 450, y: 44, w: 110, h: 26, t: "RB" },
  { id: "key:104", label: "Left trigger", x: 130, y: 12, w: 84, h: 26, t: "LT" }, { id: "key:105", label: "Right trigger", x: 450, y: 12, w: 84, h: 26, t: "RT" },
  c("key:109", "View / Share", 236, 132, 16, { t: "⧉" }), c("key:108", "Menu / Options", 344, 132, 16, { t: "≡" }), c("key:110", "Guide / PS", 290, 84, 24, { t: "◉" }),
  c("pad-dpad", "D-pad", 210, 222, 42, { why: "The D-pad always moves", t: "✛" }),
  c("key:106", "Left stick press", 128, 152, 38, { t: "L" }), c("key:107", "Right stick press", 370, 222, 38, { t: "R" }),
].map((b) => ({ ...b, map: !b.why }));
const ALL = [...BUTTONS, ...PAD];
const OTHER_NAMES = { 183: "Red", 184: "Green", 185: "Yellow", 186: "Blue", 166: "Channel up", 167: "Channel down", 165: "Info", 175: "Captions", 172: "Guide", 174: "Bookmark" };
const listFor = (kind) => (kind === "pad" ? PAD : kind === "remote" ? BUTTONS : []);
export const kindOf = (id) => (BUTTONS.some((b) => b.id === id) ? "remote" : PAD.some((b) => b.id === id) ? "pad" : "other");
export const mappable = (kind = "remote") => listFor(kind).filter((b) => b.map);
export const merged = (buttons) => ({ ...DEFAULTS, ...(buttons || {}) });
export function actionOf(id, buttons) {
  if (FIXED.has(id)) return id;
  return merged(buttons)[id] || (String(id).startsWith("key:") ? "none" : id);
}
export const actionName = (a) => (String(a).startsWith("app:") ? `Open ${String(a).slice(4)}` : (ACTIONS.find(([id]) => id === a) || [, "Nothing"])[1]);
export function labelOf(id) {
  const b = ALL.find((x) => x.id === id);
  if (b) return b.label;
  const code = Number(String(id).replace(/^key:/, ""));
  if (OTHER_NAMES[code]) return `${OTHER_NAMES[code]} button`;
  if (code >= 7 && code <= 16) return `${code - 7} key`;
  if (code >= 29 && code <= 54) return `${String.fromCharCode(36 + code)} key`;
  if (code >= 131 && code <= 142) return `F${code - 130} key`;
  return `Button ${code || id}`;
}
export const noteOf = (id) => { const b = ALL.find((x) => x.id === id); return b ? b.note || (b.sys ? "Needs In every app" : "") : ""; };
const unset = (b, buttons) => b.sys && !(buttons || {})[b.id];
const isSet = (b, buttons) => b.map && !unset(b, buttons) && ![b.id, "none"].includes(actionOf(b.id, buttons));
export function pictureHTML(kind, sel, buttons) {
  const cls = (b) => `rm-b${b.map ? " map" : ""}${sel === b.id ? " sel" : ""}${isSet(b, buttons) ? " set" : ""}`;
  const shape = (b, c2) => (b.w ? `<rect class="${c2}" x="${b.x - b.w / 2}" y="${b.y - b.h / 2}" width="${b.w}" height="${b.h}" rx="${Math.min(b.w, b.h) / 2}"/>` : `<circle class="${c2}" cx="${b.x}" cy="${b.y}" r="${b.r}"/>`);
  const g = (b, inner) => `<g class="${cls(b)}" data-rm="${b.id}"${b.map ? ' tabindex="0" role="button"' : ""} aria-label="${esc(b.label)}"><title>${esc(b.label)}${b.why ? `: ${esc(b.why)}` : ""}</title>${inner}</g>`;
  if (kind === "pad") {
    return `<svg class="rm pad" viewBox="0 -8 580 360" aria-label="Game controller"><defs><linearGradient id="padbody" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#34363d"/><stop offset="1" stop-color="#17181c"/></linearGradient></defs><path d="M150 62C78 58 48 120 30 214c-14 74 0 128 44 128 40 0 60-44 88-74 12-13 24-18 44-18h168c20 0 32 5 44 18 28 30 48 74 88 74 44 0 58-54 44-128C532 120 502 58 430 62c-30 2-40 14-60 14H210c-20 0-30-12-60-14z" fill="url(#padbody)" stroke="rgba(255,255,255,.18)" stroke-width="2"/>${PAD.map((b) => g(b, `${shape(b, "rm-s")}<text class="rm-t" x="${b.x}" y="${b.y}">${b.t}</text>${shape(b, "rm-h")}`)).join("")}</svg>`;
  }
  if (kind === "other") return `<svg class="rm pad" viewBox="0 0 580 360" aria-label="Any controller"><rect x="60" y="90" width="460" height="190" rx="30" fill="#1c1d22" stroke="rgba(255,255,255,.18)" stroke-width="2"/><text x="290" y="172" text-anchor="middle" fill="#fff" style="font:700 30px var(--display)">Press any button</text><text x="290" y="212" text-anchor="middle" fill="rgba(255,255,255,.6)" style="font:500 18px var(--font)">TV remotes, keyboards, number pads</text></svg>`;
  return `<svg class="rm" viewBox="0 0 524 1920" aria-label="Fire TV remote"><image href="${new URL("./remote.webp", import.meta.url).href}" width="524" height="1920"/>${BUTTONS.map((b) => g(b, shape(b, "rm-h"))).join("")}</svg>`;
}
export const remoteHTML = (sel, buttons) => pictureHTML("remote", sel, buttons);
const others = (buttons) => Object.keys(merged(buttons)).filter((k) => kindOf(k) === "other");
const idsFor = (buttons, kind) => (kind === "other" ? others(buttons) : mappable(kind).map((b) => b.id));
export const rowIds = (buttons, kind = "remote") => [...idsFor(buttons, kind), "reset"];
export function rowsHTML(sel, buttons, kind = "remote") {
  const ids = idsFor(buttons, kind);
  if (kindOf(sel) === kind && !ids.includes(sel) && sel && kind === "other" && /^key:/.test(sel)) ids.push(sel);
  const row = (id) => { const a = actionOf(id, buttons), b = ALL.find((x) => x.id === id); return `<button type="button" class="rm-row${sel === id ? " sel" : ""}" data-rm="${esc(id)}" tabindex="-1"><span>${esc(labelOf(id))}${b?.sys ? "<small>Fire TV</small>" : ""}</span><em>${esc(a === id || (b && unset(b, buttons)) ? "Standard" : actionName(a))}</em></button>`; };
  return ids.map(row).join("") + `<button type="button" class="rm-row${sel === "reset" ? " sel" : ""}" data-rm="reset" tabindex="-1"><span>Back to standard</span><em></em></button>`;
}
// What the helper on the TV needs (tv-keys.mjs): { MENU: "mic", APP_1: "app:Plex|com.plexapp.android", K99: "overlay" }, by key name or
// code. A button doing its own standard job is left to the TV.
export function nativeMap(buttons, pkgOf = () => "") {
  const m = {}, all = merged(buttons);
  const add = (key, a) => { const pkg = a.startsWith("app:") ? pkgOf(a.slice(4)) : ""; m[key] = pkg ? `${a}|${pkg}` : a; };
  for (const b of mappable()) {
    const a = actionOf(b.id, buttons);
    if (a !== b.id && !unset(b, buttons)) add(b.key, a);
  }
  for (const [id, a] of Object.entries(all)) { const k = /^key:(\d{1,4})$/.exec(id); if (k && a !== "none") add(`K${k[1]}`, a); }
  return m;
}
