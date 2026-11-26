// The big clock: on Home, on the screensaver and in the clock widget, on every screen. board.mjs keeps how it looks
// (data.clock), tabs/tvlook.js edits it. Everything is in em of the place it sits in; widgets.css has its styles.
export const FONTS = {
  display: ["Modern", "var(--display)"],
  rounded: ["Rounded", 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", Nunito, var(--rounded, sans-serif)'],
  serif: ["Serif", 'Georgia, "Noto Serif", serif'],
  elegant: ["Elegant", 'Didot, "Bodoni MT", "Playfair Display", "Palatino Linotype", "Noto Serif", serif'],
  slab: ["Slab", 'Rockwell, "Roboto Slab", "Courier New", serif-monospace, serif'],
  mono: ["Mono", '"Cascadia Mono", Consolas, "SF Mono", Menlo, "Droid Sans Mono", monospace'],
  condensed: ["Condensed", '"Bahnschrift Condensed", Bahnschrift, "Avenir Next Condensed", "Roboto Condensed", sans-serif-condensed, sans-serif'],
  poster: ["Poster", 'Impact, "Haettenschweiler", "Arial Narrow Bold", sans-serif-black, sans-serif'],
  script: ["Script", '"Segoe Script", "Snell Roundhand", "Dancing Script", cursive'],
  casual: ["Casual", '"Ink Free", "Bradley Hand", "Coming Soon", casual, "Comic Sans MS", cursive'],
  tight: ["Tight", '"LH InterTight", sans-serif', "Modern", 0.58],
  outfit: ["Outfit", '"LH Outfit", sans-serif', "Modern", 0.62],
  sora: ["Sora", '"LH Sora", sans-serif', "Modern", 0.68],
  manrope: ["Manrope", '"LH Manrope", sans-serif', "Modern", 0.62],
  grotesk: ["Grotesk", '"LH SpaceGrotesk", sans-serif', "Modern", 0.64],
  bricolage: ["Bricolage", '"LH BricolageGrotesque", sans-serif', "Modern", 0.6],
  unbounded: ["Wide", '"LH Unbounded", sans-serif', "Modern", 0.84],
  nunito: ["Soft", '"LH Nunito", sans-serif', "Rounded", 0.62],
  quicksand: ["Quicksand", '"LH Quicksand", sans-serif', "Rounded", 0.62],
  oswald: ["Oswald", '"LH Oswald", sans-serif', "Tall", 0.52],
  bebas: ["Bebas", '"LH BebasNeue", sans-serif', "Tall", 0.42],
  anton: ["Anton", '"LH Anton", sans-serif', "Tall", 0.5],
  shoulders: ["Shoulders", '"LH BigShouldersDisplay", sans-serif', "Tall", 0.5],
  playfair: ["Playfair", '"LH PlayfairDisplay", serif', "Serif", 0.6],
  fraunces: ["Fraunces", '"LH Fraunces", serif', "Serif", 0.64],
  cormorant: ["Cormorant", '"LH Cormorant", serif', "Serif", 0.5],
  dmserif: ["Editorial", '"LH DMSerifDisplay", serif', "Serif", 0.58],
  robotoslab: ["Slab", '"LH RobotoSlab", serif', "Serif", 0.62],
  jetbrains: ["JetBrains", '"LH JetBrainsMono", monospace', "Mono", 0.64],
  spacemono: ["Space Mono", '"LH SpaceMono", monospace', "Mono", 0.66],
  majormono: ["Major", '"LH MajorMonoDisplay", monospace', "Mono", 0.72],
  vt: ["Terminal", '"LH VT323", monospace', "Mono", 0.46],
  orbitron: ["Orbitron", '"LH Orbitron", sans-serif', "Fun", 0.8],
  righteous: ["Retro", '"LH Righteous", sans-serif', "Fun", 0.62],
  monoton: ["Neon sign", '"LH Monoton", sans-serif', "Fun", 0.9],
  pixel: ["Pixel", '"LH PressStart2P", sans-serif', "Fun", 1.05],
  pacifico: ["Pacifico", '"LH Pacifico", sans-serif', "Script", 0.6],
  caveat: ["Handwritten", '"LH Caveat", sans-serif', "Script", 0.5],
};
// The ones a device already has: their group, and how wide a digit is.
Object.assign(FONTS.display, { 2: "Modern" }); for (const [k, g] of Object.entries({ rounded: "Rounded", serif: "Serif", elegant: "Serif", slab: "Serif", mono: "Mono", condensed: "Tall", poster: "Tall", script: "Script", casual: "Script" })) FONTS[k][2] = g;
export const GROUPS = ["Modern", "Rounded", "Tall", "Serif", "Mono", "Script", "Fun"];
/** How the letters themselves are drawn. */
export const TEXTS = { solid: "Solid", split: "Bold and light", outline: "Outline", glass: "Glass", neon: "Neon", metal: "Metal", deep: "3D", stripe: "Stripes", fade: "Fade out" };
export const STYLES = { digital: "Digital", stacked: "Stacked", flip: "Flip", analog: "Analog", both: "Face and time", words: "Words", pill: "In a pill", dots: "With a dot" };
export const COLORS = ["#ffffff", "#ffd60a", "#ff9f0a", "#ff453a", "#ff375f", "#bf5af2", "#5e5ce6", "#0a84ff", "#64d2ff", "#30d158", "#ac8e68", "#000000"];
export const SHADOWS = { none: "None", soft: "Soft", strong: "Strong", glow: "Glow" };
export const DATES = { full: "Full", short: "Short", day: "Weekday", off: "Off" };
export const DEF = { style: "digital", text: "solid", font: "display", weight: 700, color: "#ffffff", color2: "", dateColor: "", size: 100, saver: 100, date: "full", where: "under", secs: false, ampm: true, h24: "", spacing: 0, italic: false, shadow: "none", align: "left" };
export const of = (c) => ({ ...DEF, ...(c || {}) });

const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ONES = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];
const UP = ["", "five", "ten", "quarter", "twenty", "twenty-five", "half"];
export function words(d) {
  const r = Math.round(d.getMinutes() / 5), past = r <= 6, n = past ? r : 12 - r, h = ONES[(d.getHours() + (past ? 0 : 1)) % 12];
  return n === 0 ? `${h} o’clock` : `${UP[n]} ${past ? "past" : "to"} ${h}`;
}
export function parts(d, c, h24) {
  const on24 = c.h24 === "24" || (c.h24 !== "12" && h24), h = d.getHours();
  return { h: on24 ? pad(h) : String(h % 12 || 12), m: pad(d.getMinutes()), s: pad(d.getSeconds()), ap: !on24 && c.ampm ? (h < 12 ? "AM" : "PM") : "" };
}
export const dateText = (d, c) => (c.date === "off" ? "" : d.toLocaleDateString([], c.date === "day" ? { weekday: "long" } : c.date === "short" ? { weekday: "short", month: "short", day: "numeric" } : { weekday: "long", month: "long", day: "numeric" }));
function face(d, secs) {
  const a = (v, n) => `transform="rotate(${((v / n) * 360).toFixed(1)} 50 50)"`, m = d.getMinutes() + d.getSeconds() / 60, h = (d.getHours() % 12) + m / 60;
  return `<svg class="hc-face" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48" fill="currentColor" opacity=".1"/>${Array.from({ length: 12 }, (_, i) => `<path d="M50 ${i % 3 ? 7 : 6}v${i % 3 ? 4 : 8}" stroke="currentColor" opacity="${i % 3 ? 0.45 : 0.9}" stroke-width="${i % 3 ? 1.6 : 2.4}" stroke-linecap="round" ${a(i, 12)}/>`).join("")}<path d="M50 54V27" stroke="currentColor" stroke-width="4.4" stroke-linecap="round" ${a(h, 12)}/><path d="M50 56V15" stroke="currentColor" stroke-width="3" stroke-linecap="round" ${a(m, 60)}/>${secs ? `<path d="M50 58V13" stroke="#ff9f0a" stroke-width="1.4" stroke-linecap="round" ${a(d.getSeconds(), 60)}/>` : ""}<circle cx="50" cy="50" r="3.4" fill="#ff9f0a"/></svg>`;
}
/** Roughly how wide and tall it is, in em of itself: a widget sizes it to its box with this. */
export function extent(c, t) {
  const wide = { mono: 0.64, slab: 0.62, poster: 0.56, condensed: 0.5, script: 0.8, casual: 0.62 }[c.font] || FONTS[c.font]?.[3] || 0.62, date = c.date === "off" ? 0 : c.where === "over" || c.where === "under" ? 0.5 : 0;
  const n = t.h.length + t.m.length + 0.5 + (c.secs ? 2.5 : 0) + (t.ap ? 1.7 : 0), sp = Math.max(0, c.spacing) / 100;
  const w = c.style === "stacked" ? 2 * (wide + sp) + 0.1 : c.style === "flip" ? (t.h.length + 2 + (c.secs ? 2 : 0)) * 0.86 + 0.5 + (c.secs ? 0.4 : 0) : c.style === "analog" ? 2.5 : c.style === "both" ? Math.max(2.5, n * (wide + sp)) : c.style === "words" ? 4.5 * Math.max(1, wide / 0.64) + 6 * sp : n * (wide + sp) + (c.style === "pill" ? 0.9 : 0);
  const h = c.style === "pill" ? 1.6 : c.style === "stacked" ? 1.9 : c.style === "flip" ? 1.35 : c.style === "analog" ? 2.5 : c.style === "both" ? 3.7 : c.style === "words" ? 3.15 : 1.05;
  return [Math.max(w, date ? (c.date === "full" ? 3.9 : 2.4) : 0), h + date];
}
const safe = (v, or) => (/^#[0-9a-f]{6}$/i.test(v) ? v : or);
/** @param scale its own size, in em of the place it sits */
export function clockHTML(opts, { now = new Date(), h24 = false, scale = 1 } = {}) {
  const c = of(opts), t = parts(now, c, h24), col = safe(c.color, "#ffffff"), two = safe(c.color2, ""), date = dateText(now, c);
  const ap = t.ap ? `<small>${t.ap}</small>` : "", sec = c.secs ? `<i>:${t.s}</i>` : "";
  const digits = `<b${c.style === "pill" ? ' class="pl"' : ""}><s>${t.h}</s><u>${c.style === "dots" ? "·" : ":"}</u><s class="mm">${t.m}</s>${sec}${ap}</b>`, tile = (s) => [...s].map((x) => `<span>${x}</span>`).join("");
  const body = c.style === "stacked" ? `<b class="st"><span>${t.h}</span><span class="mm">${t.m}</span></b>` : c.style === "flip" ? `<b class="fl">${tile(t.h)}<u>:</u>${tile(t.m)}${c.secs ? `<u>:</u>${tile(t.s)}` : ""}</b>` : c.style === "analog" ? face(now, c.secs) : c.style === "both" ? `${face(now, c.secs)}${digits}` : c.style === "words" ? `<b class="wd">${esc(words(now))}</b>` : digits;
  const d = date ? `<em>${esc(date)}</em>` : "";
  return `<div class="hc hc-${STYLES[c.style] ? c.style : "digital"} sh-${SHADOWS[c.shadow] ? c.shadow : "none"}${two ? " two" : ""} tx-${TEXTS[c.text] ? c.text : "solid"} at-${["left", "center", "right"].includes(c.align) ? c.align : "left"}" style="--cf:${(FONTS[c.font] || FONTS.display)[1].replace(/"/g, "'")};--cw:${Number(c.weight) || 700};--cc:${col};--c2:${two || col};--cd:${safe(c.dateColor, col)};--cs:${(Number(c.spacing) || 0) / 100 - 0.035}em;--ci:${c.italic ? "italic" : "normal"};--cz:${scale}">${c.where === "over" ? d + body : body + d}</div>`;
}
/** Draws it in a place and shrinks it to fit there. Only measures when something that changes its size did. */
export function paint(box, opts, { now, h24, scale = 1, maxW = 0, maxH = 0 } = {}) {
  const html = clockHTML(opts, { now, h24, scale });
  // The room it has counts as much as what it shows: the page settling or the window changing size refits it.
  const room = `${maxW}|${maxH}`;
  if (box._hc === html && box._hr === room) return;
  box.innerHTML = html; // fresh, so it's measured at its full size
  box._hc = html;
  box._hr = room;
  const key = `${html.replace(/<svg[\s\S]*?<\/svg>/, "").replace(/>[^<]*</g, (s) => `>${s.length}<`)}|${maxW}|${maxH}`, el = box.firstElementChild;
  if (box._hk !== key) {
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w && h) { box._hk = key; box._fit = Math.min(1, maxW ? maxW / w : 1, maxH ? maxH / h : 1); }
  }
  if (box._fit < 1) el.style.setProperty("--fit", box._fit.toFixed(3));
}
