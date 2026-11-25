// The TV's screen, sent to a computer that is driving it (the TV button in LocalHub). Nothing runs until one asks, and it
// stops by itself 12 s after the last ask. What's sent is the page's own HTML; the computer draws it with the same styles.
let H = null, until = 0, timer = 0, stopTimer = 0, obs = null, busy = false, again = false, last = "";
const ART = /http:\/\/localhub\.tv\/art\/([\w.]+)\/(banner|icon)\.png/g;
const sent = new Set();
export function init(hooks) { H = hooks; document.addEventListener("visibilitychange", () => soon()); }
const on = () => Date.now() < until;
export function watch(yes) {
  if (!H?.NATIVE) return; // only a real TV is mirrored
  if (!yes) return stop();
  const fresh = !on();
  until = Date.now() + 12_000;
  clearTimeout(stopTimer);
  stopTimer = setTimeout(stop, 12_500);
  if (!obs) {
    obs = new MutationObserver(() => soon());
    for (const id of ["stage", "toast", "saver"]) { const n = document.getElementById(id); if (n) obs.observe(n, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "src", "hidden"] }); }
  }
  if (fresh) { last = ""; soon(); }
}
function stop() { until = 0; clearTimeout(timer); timer = 0; obs?.disconnect(); obs = null; }
// Typing changes nothing the observer sees.
document.addEventListener("input", () => soon());
export function soon() { if (!on() || timer) return; timer = setTimeout(() => { timer = 0; send(); }, 160); }
async function send() {
  if (!on()) return;
  if (busy) { again = true; return; }
  busy = true;
  try {
    // What is typed in a box is not in its HTML.
    for (const n of document.querySelectorAll("#stage input:not([type=password])")) if (n.getAttribute("value") !== n.value) n.setAttribute("value", n.value);
    const bits = ["stage", "toast", "saver"].map((id) => document.getElementById(id)?.outerHTML || "").join("");
    const apps = new Map();
    const html = bits.replace(ART, (m, pkg, what) => { apps.set(`${pkg}/${what}`, m); return `/api/tv/art/${pkg}/${what}.png`; });
    const wall = /url\(["']?([^"')]+)/.exec(document.getElementById("hub-wall")?.style.backgroundImage || "")?.[1] || "";
    const d = document.documentElement, body = { html, cls: `${d.className}|${document.body.className}`, style: "", wall: wall.startsWith("data:") ? "" : wall, away: document.hidden, stream: H.streamOpen(), k: innerWidth / 1920 };
    const key = JSON.stringify(body);
    // Pictures the computer hasn't had yet, a few at a time; they show as they arrive.
    let more = 0;
    for (const id of apps.keys()) {
      if (sent.has(id)) continue;
      if (more++ >= 6) { again = true; break; }
      const b64 = H.native("artData", id);
      sent.add(id);
      if (b64) await fetch(`/api/tv/art/${id}.png`, { method: "POST", headers: { "content-type": "image/png", "x-hub": "1" }, body: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).catch(() => sent.delete(id));
    }
    if (key !== last || more) {
      last = key;
      const r = await fetch("/api/tv/mirror", { method: "POST", headers: { "content-type": "application/json", "x-hub": "1" }, body: key });
      if (r.ok && (await r.json()).n === 1) sent.clear(); // the hub restarted: it has no pictures
    }
  } catch { last = ""; } finally { busy = false; if (again) { again = false; soon(); } }
}
export function tap(x, y) {
  const s = document.getElementById("stage")?.getBoundingClientRect();
  if (!s) return;
  const k = s.width / 1920, n = document.elementsFromPoint(s.left + x * k, s.top + y * k).find((e) => x < 140 || !e.closest(".rail") || document.querySelector(".rail.open"));
  if (!n) return;
  const o = { bubbles: true, cancelable: true, clientX: s.left + x * k, clientY: s.top + y * k };
  n.dispatchEvent(new MouseEvent("click", o));
}
export function type(text) {
  let a = document.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  if (!a || !/^(INPUT|TEXTAREA)$/.test(a.tagName)) return false;
  for (const c of text) {
    if (c === "\b") a.value = a.value.slice(0, -1);
    else a.value += c;
  }
  a.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
