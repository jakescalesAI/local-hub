// Checks for the emulator job in .github/workflows/tv.yml (run by smoke.sh, not by node --test).
//
//   node check.mjs page <port> <seconds>   asks the WebView itself, over the DevTools socket the
//                                          debug build opens, whether the home screen rendered
//   node check.mjs png <file>              fails if a screenshot is blank or a single colour
//
// No dependencies: Node 22's own fetch, WebSocket and zlib.

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const [mode, ...args] = process.argv.slice(2);
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

// ── the page ────────────────────────────────────────────────────────────────────────────────

// Everything is read in one evaluate, so the answer is one consistent moment of the page.
const PROBE = `(() => {
  const $ = (s) => document.querySelector(s);
  const apps = [...document.querySelectorAll("#grid .app")];
  const first = apps[0] ? apps[0].getBoundingClientRect() : null;
  const bar = $("#pairbar"), fatal = $("#fatal");
  return {
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    bridge: typeof window.LocalHubNative,
    haven: typeof window.haven,
    booted: document.body.classList.contains("booted"),
    splashGone: !!$("#splash") && $("#splash").classList.contains("is-gone"),
    fatal: fatal && !fatal.hidden ? fatal.textContent : null,
    stylesheets: document.styleSheets.length,
    apps: apps.map((a) => a.querySelector(".name") ? a.querySelector(".name").textContent : ""),
    firstApp: first ? { w: Math.round(first.width), h: Math.round(first.height) } : null,
    pairbar: bar && !bar.hidden ? bar.innerText.trim() : null,
    viewport: [innerWidth, innerHeight],
  };
})()`;

// What "the UI really rendered" means: the bundled page, its module ran, the splash finished,
// the grid has the LocalHub tile, apps and Settings laid out at a real size, and no error box.
function problems(s) {
  const p = [];
  if (s.href !== "http://localhub.tv/index.html") p.push(`page is ${s.href}, not the bundled http://localhub.tv/index.html`);
  if (s.title !== "LocalHub TV") p.push(`title is "${s.title}"`);
  if (s.bridge !== "object") p.push("window.LocalHubNative (the Java bridge) is missing");
  if (s.haven !== "object") p.push("window.haven is missing: app.js didn't run to the end");
  if (!s.booted || !s.splashGone) p.push("the splash never handed over to the home screen");
  if (s.fatal) p.push(`the page shows its error box: ${s.fatal}`);
  if (s.stylesheets < 1) p.push("styles.css isn't loaded");
  if (s.apps.length < 2 || !s.apps.includes("Settings")) p.push(`the app grid has ${s.apps.length} tiles: ${JSON.stringify(s.apps)}`);
  if (!s.firstApp || s.firstApp.w < 50 || s.firstApp.h < 50) p.push(`the first tile is laid out at ${JSON.stringify(s.firstApp)}`);
  if (!s.pairbar) p.push("the pair bar isn't showing");
  return p;
}

async function evaluate(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === "page" && String(t.url).startsWith("http://localhub.tv/"))
    || targets.find((t) => t.type === "page");
  if (!page) throw new Error(`no page target: ${JSON.stringify(targets)}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("DevTools didn't answer in 10 s")), 10_000);
      ws.onerror = () => { clearTimeout(timer); reject(new Error("DevTools socket error")); };
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: PROBE, returnByValue: true } }));
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id !== 1) return;
        clearTimeout(timer);
        if (msg.error || msg.result.exceptionDetails) reject(new Error(JSON.stringify(msg.error || msg.result.exceptionDetails)));
        else resolve(msg.result.result.value);
      };
    });
  } finally {
    ws.close();
  }
}

async function page(port, seconds) {
  const until = Date.now() + Number(seconds) * 1000;
  let state = null, last = "";
  for (;;) {
    try {
      state = await evaluate(port);
      last = problems(state).join("; ");
      if (!last) break;
    } catch (err) {
      last = `can't read the page over DevTools: ${err.message}`;
    }
    if (Date.now() > until) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(JSON.stringify(state, null, 2));
  if (last) fail(`the home screen didn't render: ${last}`);
  console.log(`OK: the home screen rendered (${state.apps.length} tiles; pair bar: "${state.pairbar}")`);
}

// ── the screenshot ──────────────────────────────────────────────────────────────────────────

// Just enough PNG for adb screencap: 8-bit RGB or RGBA, not interlaced.
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let off = 8, w = 0, h = 0, type = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), kind = buf.toString("ascii", off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (kind === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || (type !== 2 && type !== 6) || data[12] !== 0) throw new Error(`unsupported PNG (depth ${data[8]}, type ${type})`);
    }
    if (kind === "IDAT") idat.push(data);
    if (kind === "IEND") break;
    off += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, up = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[up + x] : 0, c = x >= bpp && y ? px[up + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}

function png(file) {
  const { w, h, bpp, px } = decodePng(readFileSync(file));
  // Colours to 4 bits a channel, so a smooth gradient alone doesn't count as a lot of variety.
  const bins = new Map();
  for (let i = 0; i < px.length; i += bpp) {
    const k = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
    bins.set(k, (bins.get(k) || 0) + 1);
  }
  const top = Math.max(...bins.values()) / (w * h);
  console.log(`${file}: ${w}x${h}, ${bins.size} colours, the commonest covers ${(top * 100).toFixed(1)}%`);
  if (bins.size < 32 || top > 0.9) fail(`${file} is blank or nearly one colour`);
}

if (mode === "page") await page(args[0] || 9222, args[1] || 30);
else if (mode === "png") png(args[0]);
else fail("usage: check.mjs page <port> <seconds> | png <file>");
