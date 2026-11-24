// LocalHub TV: Files. The computer's drives and folders, as rows; OK opens a folder, a picture, a video, music or a text
// file. Read only: nothing is moved or deleted from the couch. Each folder keeps its place for when you come back to it.
const sym = (d) => `<svg class="sym" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC = {
  dir: sym('<path d="M4 7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>'),
  drive: sym('<path d="M4 13l3-8h10l3 8v5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><path d="M4 13h16M8 16.5h.01"/>'),
  img: sym('<rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M4 16l4.5-4.5 4 4 2.5-2.5 5 5"/>'),
  vid: sym('<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M10.5 9.5v5l4-2.5z"/>'),
  aud: sym('<path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
  doc: sym('<path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M14 3.5V8h4"/>'),
};
const KIND = { img: /\.(png|jpe?g|gif|webp)$/i, vid: /\.(mp4|m4v|webm|mov)$/i, aud: /\.(mp3|m4a|wav|ogg|aac|flac)$/i, txt: /\.(txt|md|log|csv|json|srt)$/i };
const ROW = 108, MAX = 400;
let H = null, path = "", list = [], at = 0, shown = false, loading = 0, viewing = null, loaded = false, gone = "";
const kept = new Map(); // folder -> the row you were on
const kind = (e) => (e.drive ? "drive" : e.dir ? "dir" : KIND.img.test(e.name) ? "img" : KIND.vid.test(e.name) ? "vid" : KIND.aud.test(e.name) ? "aud" : "doc");
const size = (n) => (n > 1e12 ? `${(n / 1e12).toFixed(1)} TB` : n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${Math.round(n / 1e3)} KB` : `${n || 0} B`);
const join = (name) => (path ? `${path.replace(/\/$/, "")}/${name}` : name);
const raw = (p) => `/files/drives/raw?path=${encodeURIComponent(p)}`;

export function init(hooks) {
  H = hooks;
  H.el.innerHTML = '<div class="fl-head"><div class="fl-title"></div><div class="fl-path"></div></div><div class="fl-list"><div class="fl-track"></div></div><div class="fl-view" hidden></div>';
  H.el.addEventListener("click", (e) => {
    const r = e.target.closest(".fl-row");
    if (r) { at = Number(r.dataset.n); paint(); open(); }
  });
}
export function show() { shown = true; if (!H.inHub()) { gone = "Pair this TV with LocalHub to see your files"; return draw(); } if (!loaded) go(""); }
export function hide() { if (shown && viewing) closeView(); shown = false; }
export function focus() { paint(); }

async function go(to, back) {
  const n = ++loading;
  if (loaded) kept.set(path, at);
  gone = "Opening…";
  if (!loaded) draw();
  try {
    const r = await fetch(`/api/files/drives?path=${encodeURIComponent(to)}`, { cache: "no-store" });
    const b = await r.json();
    if (n !== loading) return;
    if (!r.ok) throw new Error(b.error || "That folder didn't open");
    path = to;
    list = (b.entries || []).slice(0, MAX);
    loaded = true;
    gone = list.length ? "" : "This folder is empty";
    at = Math.min(kept.get(path) || 0, Math.max(0, list.length - 1));
    draw();
  } catch (e) {
    if (n !== loading) return;
    gone = loaded ? "" : "LocalHub didn't answer";
    if (!loaded) draw(); else H.toast(e.message);
  }
}
function draw() {
  const e = H.esc;
  H.el.querySelector(".fl-title").textContent = path ? path.split("/").filter(Boolean).pop() : "Files";
  H.el.querySelector(".fl-path").textContent = path || "This computer";
  const t = H.el.querySelector(".fl-track");
  t.innerHTML = gone ? `<div class="fl-note">${e(gone)}</div>` : list.map((x, i) => {
    const m = x.drive ? (x.free ? `${size(x.free)} free` : "") : x.dir ? (x.count != null ? `${x.count} item${x.count === 1 ? "" : "s"}` : "") : size(x.size);
    return `<div class="fl-row" data-n="${i}">${IC[kind(x)]}<span class="n">${e(x.drive && x.label ? `${x.label} (${x.name})` : x.name)}</span><span class="m">${e(m)}</span></div>`;
  }).join("");
  paint();
}
function paint() {
  const t = H.el.querySelector(".fl-track");
  t.querySelector(".sel")?.classList.remove("sel");
  t.querySelector(`[data-n="${at}"]`)?.classList.add("sel");
  t.style.transform = `translateY(${-Math.max(0, at - 3) * ROW}px)`;
}
function open() {
  const x = list[at];
  if (!x) return;
  const p = join(x.name);
  if (x.dir || x.drive) return go(p);
  const k = kind(x), v = H.el.querySelector(".fl-view"), cap = `<div class="fl-cap">${H.esc(x.name)}</div>`;
  if (k === "img") { viewing = "img"; v.innerHTML = `<img src="${H.esc(raw(p))}" alt="">${cap}`; v.hidden = false; return; }
  if (k === "vid" || k === "aud") {
    viewing = "vid";
    v.innerHTML = `<video src="${H.esc(raw(p))}" autoplay></video>${cap}`;
    v.hidden = false;
    v.querySelector("video").addEventListener("error", () => { if (viewing) { closeView(); H.toast("This TV can't play that file"); } });
    v.querySelector("video").addEventListener("playing", () => v.querySelector(".fl-cap")?.remove(), { once: true });
    return;
  }
  if (KIND.txt.test(x.name)) {
    fetch(`/api/files/drives/text?path=${encodeURIComponent(p)}`, { cache: "no-store" }).then((r) => r.json().then((b) => (r.ok ? b : Promise.reject(new Error(b.error)))))
      .then((b) => { if (!shown) return; viewing = "txt"; v.innerHTML = "<pre></pre>"; v.firstChild.textContent = b.text ?? b.content ?? ""; v.hidden = false; })
      .catch((e) => H.toast(e.message || "That file didn't open"));
    return;
  }
  H.toast("Open this one on the computer");
}
function closeView() {
  viewing = null;
  const v = H.el.querySelector(".fl-view");
  v.querySelector("video")?.pause();
  v.hidden = true;
  v.innerHTML = "";
}
// The next picture that way, for Left and Right while looking at one.
function step(d) { for (let i = at + d; i >= 0 && i < list.length; i += d) if (kind(list[i]) === "img") { at = i; paint(); return open(); } }

export function key(name) {
  if (viewing) {
    const v = H.el.querySelector(".fl-view"), m = v.querySelector("video"), pre = v.querySelector("pre");
    if (name === "back") closeView();
    else if (viewing === "img" && (name === "left" || name === "right")) step(name === "left" ? -1 : 1);
    else if (m && (name === "enter" || name === "ai")) m.paused ? m.play() : m.pause();
    else if (m && ["left", "rew", "right", "ff"].includes(name)) m.currentTime += name === "left" || name === "rew" ? -10 : 10;
    else if (pre && (name === "up" || name === "down")) pre.scrollTop += name === "up" ? -400 : 400;
    return true;
  }
  if (name === "up") { if (at > 0) { at--; paint(); } return true; }
  if (name === "down") { if (at < list.length - 1) { at++; paint(); } return true; }
  if (name === "rew" || name === "ff") { at = Math.max(0, Math.min(list.length - 1, at + (name === "ff" ? 6 : -6))); paint(); return true; }
  if (name === "enter" || name === "right") { open(); return true; }
  if (name === "back" && path) { go(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""); return true; }
  return false;
}
