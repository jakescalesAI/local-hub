// The Fire TV remote, drawn, and what each of its buttons does in LocalHub: the TV's Settings › Remote (app.js) and the hub
// page's Settings › Fire TV remote (tabs/tvlook.js) both use this, so they show the same remote and the same choices.
// Styles in panel.css. What was chosen is the hub's tv.buttons, so both agree.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const DEFAULTS = { menu: "mic" };
export const FIXED = new Set(["left", "right", "up", "down", "enter", "back", "hold"]);
export const ACTIONS = [
  ["mic", "Microphone"], ["assistant", "Assistant"], ["overlay", "Overlay"], ["home", "Home"], ["menu", "Sidebar and menus"], ["files", "Files"], ["ai", "Play / pause"],
  ["rew", "Page up, rewind"], ["ff", "Page down, fast forward"], ["saver", "Screensaver"], ["sleep", "Sleep"], ["settings", "Settings"], ["none", "Nothing"],
];
// Every button on the remote. map: LocalHub can give it a job; the rest say why not.
export const BUTTONS = [
  { id: "power", label: "Power", x: 130, y: 44, r: 19, glyph: "power", why: "Fire TV keeps Power" },
  { id: "alexa", label: "Alexa", x: 130, y: 106, r: 25, glyph: "alexa", why: "Fire TV keeps the Alexa button" },
  { id: "dpad", label: "Arrows and OK", x: 130, y: 208, r: 66, glyph: "dpad", why: "Arrows and OK always move and open, so you can’t lock yourself out" },
  { id: "back", label: "Back", x: 66, y: 312, r: 23, glyph: "back", why: "Back always goes back" },
  { id: "homebtn", label: "Home", x: 130, y: 312, r: 23, glyph: "home", why: "Home brings LocalHub to the front" },
  { id: "menu", label: "Menu", x: 194, y: 312, r: 23, glyph: "menu", map: true },
  { id: "rew", label: "Rewind", x: 66, y: 372, r: 23, glyph: "rew", map: true },
  { id: "ai", label: "Play / pause", x: 130, y: 372, r: 23, glyph: "play", map: true },
  { id: "ff", label: "Fast forward", x: 194, y: 372, r: 23, glyph: "ff", map: true },
  { id: "vol", label: "Volume", x: 130, y: 452, w: 46, h: 92, glyph: "vol", why: "Volume goes to your TV or soundbar" },
  { id: "mute", label: "Mute", x: 66, y: 452, r: 23, glyph: "mute", why: "Mute goes to your TV or soundbar" },
  { id: "key:172", label: "Guide", x: 194, y: 452, r: 23, glyph: "guide", map: true },
  { id: "apps", label: "App buttons", x: 130, y: 562, w: 176, h: 84, glyph: "apps", why: "Fire TV keeps the four app buttons for their own apps" },
];
const G = {
  power: '<path d="M0-8v8M-6-4.5a8.5 8.5 0 1 0 12 0"/>', alexa: '<circle r="11"/><path d="M-4 5.5a7 7 0 1 1 8 0" stroke-width="2.4"/>',
  back: '<path d="M-8-3h11a5.5 5.5 0 0 1 0 11H-3M-8-3l5-5M-8-3l5 5"/>', home: '<path d="M-9-1 0-9l9 8M-6-3V8H6V-3"/>', menu: '<path d="M-8-5H8M-8 0H8M-8 5H8"/>',
  rew: '<path fill="currentColor" d="M9-6v12L1 0zM0-6v12l-8-6z"/>', ff: '<path fill="currentColor" d="M-9-6v12l8-6zM0-6v12l8-6z"/>', play: '<path fill="currentColor" d="M-9-6v12l8-6z"/><path d="M3-6V6M8-6V6" stroke-width="3"/>',
  mute: '<path d="M-9-3h4l5-4V7l-5-4h-4zM4-3l6 6M10-3 4 3"/>', vol: '<path d="M-7-24H7M0-31v14M-7 24H7"/>', guide: '<rect x="-9" y="-7" width="18" height="14" rx="2.5"/><path d="M-9-2H9M-3-2V7"/>',
  dpad: '<circle r="28"/><path d="M0-52l-5 6H5zM0 52l-5-6H5zM-52 0l6-5V5zM52 0l-6-5V5z" fill="currentColor" stroke="none"/>',
  apps: '<rect x="-80" y="-34" width="74" height="30" rx="15"/><rect x="6" y="-34" width="74" height="30" rx="15"/><rect x="-80" y="6" width="74" height="30" rx="15"/><rect x="6" y="6" width="74" height="30" rx="15"/>',
};
export const mappable = () => BUTTONS.filter((b) => b.map);
export const merged = (buttons) => ({ ...DEFAULTS, ...(buttons || {}) });
export function actionOf(id, buttons) {
  if (FIXED.has(id)) return id;
  return merged(buttons)[id] || (String(id).startsWith("key:") ? "none" : id);
}
export const actionName = (a) => (String(a).startsWith("app:") ? `Open ${String(a).slice(4)}` : (ACTIONS.find(([id]) => id === a) || [, "Nothing"])[1]);
export const labelOf = (id) => BUTTONS.find((b) => b.id === id)?.label || `Button ${String(id).replace(/^key:/, "")}`;
export function remoteHTML(sel, buttons) {
  const draw = (b) => {
    const shape = b.w ? `<rect class="rm-s" x="${-b.w / 2}" y="${-b.h / 2}" width="${b.w}" height="${b.h}" rx="${Math.min(b.w, b.h) / 2}"${b.id === "apps" ? ' style="fill:none;stroke:none"' : ""}/>` : `<circle class="rm-s" r="${b.r}"/>`;
    return `<g class="rm-b${b.map ? " map" : ""}${sel === b.id ? " sel" : ""}${b.map && ![b.id, "none"].includes(actionOf(b.id, buttons)) ? " set" : ""}" data-rm="${b.id}" transform="translate(${b.x} ${b.y})"${b.map ? ' tabindex="0" role="button"' : ""} aria-label="${esc(b.label)}">${shape}<g class="rm-g">${G[b.glyph]}</g></g>`;
  };
  return `<svg class="rm" viewBox="0 0 260 660" aria-label="Fire TV remote"><defs><linearGradient id="rmbody" x1="0" x2="1"><stop offset="0" stop-color="#26272c"/><stop offset=".5" stop-color="#17181c"/><stop offset="1" stop-color="#0f1013"/></linearGradient></defs><rect x="8" y="4" width="244" height="652" rx="58" fill="url(#rmbody)" stroke="rgba(255,255,255,.16)" stroke-width="1.5"/>${BUTTONS.map(draw).join("")}</svg>`;
}
export function rowsHTML(sel, buttons) {
  const m = merged(buttons), extra = Object.keys(m).filter((k) => !BUTTONS.some((b) => b.id === k));
  const row = (id) => { const a = actionOf(id, buttons); return `<button type="button" class="rm-row${sel === id ? " sel" : ""}" data-rm="${esc(id)}" tabindex="-1"><span>${esc(labelOf(id))}</span><em>${esc(a === id ? "Standard" : actionName(a))}</em></button>`; };
  return [...mappable().map((b) => b.id), ...extra].map(row).join("") + `<button type="button" class="rm-row${sel === "reset" ? " sel" : ""}" data-rm="reset" tabindex="-1"><span>Back to standard</span><em></em></button>`;
}
export const rowIds = (buttons) => [...mappable().map((b) => b.id), ...Object.keys(merged(buttons)).filter((k) => !BUTTONS.some((b) => b.id === k)), "reset"];
