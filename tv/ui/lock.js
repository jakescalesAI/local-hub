// The entry code's screen (lock.mjs keeps the code), on the TV (app.js) and the hub page (tabs/tvlook.js): the same pad, worked by a
// remote, a keyboard, a mouse or a finger. Styles in panel.css.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "del"];
const IC = {
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 5.5H20v13H8.5L3 12z"/><path d="m11.5 9.5 5 5M16.5 9.5l-5 5"/></svg>',
};
// SHA-256, small: a page on http has no crypto.subtle, and this is only for asking while the hub is off.
function sha256(text) {
  const K = [], H = [], r = (v, n) => (v >>> n) | (v << (32 - n));
  for (let n = 2; K.length < 64; n++) { let p = true; for (let i = 2; i * i <= n; i++) if (n % i === 0) { p = false; break; } if (!p) continue; if (H.length < 8) H.push((Math.sqrt(n) * 4294967296) | 0); K.push((Math.cbrt(n) * 4294967296) | 0); }
  const b = [...new TextEncoder().encode(text)], len = b.length * 8;
  b.push(128);
  while (b.length % 64 !== 56) b.push(0);
  for (let i = 7; i >= 0; i--) b.push(Math.floor(len / 2 ** (i * 8)) & 255);
  for (let o = 0; o < b.length; o += 64) {
    const w = [];
    for (let i = 0; i < 64; i++) {
      if (i < 16) w[i] = (b[o + i * 4] << 24) | (b[o + i * 4 + 1] << 16) | (b[o + i * 4 + 2] << 8) | b[o + i * 4 + 3];
      else { const x = w[i - 15], y = w[i - 2]; w[i] = (w[i - 16] + (r(x, 7) ^ r(x, 18) ^ (x >>> 3)) + w[i - 7] + (r(y, 17) ^ r(y, 19) ^ (y >>> 10))) | 0; }
    }
    let [A, B, C, D, E, F, G, Z] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (Z + (r(E, 6) ^ r(E, 11) ^ r(E, 25)) + ((E & F) ^ (~E & G)) + K[i] + w[i]) | 0, t2 = ((r(A, 2) ^ r(A, 13) ^ r(A, 22)) + ((A & B) ^ (A & C) ^ (B & C))) | 0;
      Z = G; G = F; F = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0;
    }
    [A, B, C, D, E, F, G, Z].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
  }
  return H.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}
export function offlineHash(pin, salt, rounds = 2000) { let h = `${salt}:${pin}`; for (let i = 0; i < rounds; i++) h = sha256(h); return h; }

// store: { read(), write(text) } where this device keeps what it needs while the hub is off.
export function createLock({ host, store, changed }) {
  let C = { on: false, digits: 4, places: [], apps: [], after: 5 }, saved = {}, box = null, cur = null, bad = { n: 0, until: 0 }, tick = 0;
  try { saved = JSON.parse(store.read() || "{}") || {}; } catch { saved = {}; }
  if (saved.conf) C = { ...C, ...saved.conf };
  if (saved.bad) bad = saved.bad;
  const keep = () => { try { store.write(JSON.stringify(saved)); } catch { /* storage off */ } };
  async function load() {
    try {
      const r = await fetch("/api/lock", { cache: "no-store" });
      if (!r.ok) return C;
      const was = JSON.stringify(C), j = await r.json();
      C = { on: !!j.on, digits: j.digits === 6 ? 6 : 4, places: j.places || [], apps: j.apps || [], after: j.after ?? 5 };
      saved.conf = C;
      if (!C.on) { delete saved.offline; delete saved.bad; }
      keep();
      // Turned off, or this place no longer asks (changed on the computer while this screen waits): the pad goes.
      if (cur && !cur.check && (!C.on || (cur.place && !cur.place()))) done(true);
      if (JSON.stringify(C) !== was) changed?.();
    } catch { /* the hub is away: as it last was */ }
    return C;
  }
  async function verify(pin) {
    try {
      const r = await fetch("/api/lock/check", { method: "POST", headers: { "content-type": "application/json", "x-hub": "1" }, body: JSON.stringify({ pin }) });
      if (!r.ok) throw new Error("hub");
      const j = await r.json();
      if (j.ok && j.offline) { saved.offline = j.offline; saved.bad = bad = { n: 0, until: 0 }; keep(); }
      return j;
    } catch {
      // The hub is off: this device asks by itself, with the same limits.
      const o = saved.offline;
      if (!o) return { ok: false, away: true };
      if (bad.until > Date.now()) return { ok: false, wait: Math.ceil((bad.until - Date.now()) / 1000) };
      if (offlineHash(pin, o.salt) === o.hash) { saved.bad = bad = { n: 0, until: 0 }; keep(); return { ok: true }; }
      bad.n++;
      if (bad.n >= 5) bad.until = Date.now() + Math.min(3600_000, 30_000 * 2 ** Math.min(7, bad.n - 5));
      saved.bad = bad;
      keep();
      return { ok: false, left: Math.max(0, 5 - bad.n), ...(bad.until > Date.now() ? { wait: Math.ceil((bad.until - Date.now()) / 1000) } : {}) };
    }
  }
  function paint() {
    if (!cur) return;
    const n = cur.digits, waiting = cur.until > Date.now();
    const msg = waiting ? `Too many tries. Wait ${Math.ceil((cur.until - Date.now()) / 1000)} s` : cur.msg;
    const html = `<div class="lk-card${cur.shake ? " shake" : ""}"><div class="lk-ic">${IC.lock}</div><h2>${esc(cur.title)}</h2><p class="${cur.err ? "err" : ""}">${esc(msg || cur.sub || `Enter your ${n}-digit code`)}</p><div class="lk-dots">${Array.from({ length: n }, (_, i) => `<i class="${i < cur.pin.length ? "on" : ""}"></i>`).join("")}</div><div class="lk-pad${waiting || cur.busy ? " off" : ""}">${KEYS.map((k) => k === "back" && !cur.cancel ? '<span></span>' : `<button type="button" data-lk="${k}" tabindex="-1" class="${cur.sel === k && cur.remote ? "sel" : ""}${k.length > 1 ? " fn" : ""}" aria-label="${k === "back" ? "Cancel" : k === "del" ? "Delete" : k}">${k === "back" ? "Cancel" : k === "del" ? IC.del : k}</button>`).join("")}</div></div>`;
    if (box._html !== html) { box._html = html; box.innerHTML = html; }
  }
  function done(ok) {
    const c = cur;
    cur = null;
    clearInterval(tick);
    box.classList.remove("on");
    setTimeout(() => { if (!cur) { box.innerHTML = ""; box._html = ""; } }, 260);
    c.resolve(ok);
  }
  async function press(k) {
    if (!cur || cur.busy) return;
    if (k === "back") { if (cur.cancel) done(false); return; }
    if (cur.until > Date.now()) return;
    if (k === "del") { cur.pin = cur.pin.slice(0, -1); cur.shake = false; return paint(); }
    if (cur.pin.length >= cur.digits) return;
    cur.pin += k;
    cur.msg = "";
    cur.err = cur.shake = false;
    paint();
    if (cur.pin.length < cur.digits) return;
    const pin = cur.pin, me = cur;
    cur.busy = true;
    if (me.check) { const r = await me.check(pin); if (cur !== me) return; me.busy = false; if (r === true) return done(pin); me.pin = ""; me.err = me.shake = true; me.msg = r || "Try again"; return paint(); }
    const r = await verify(pin);
    if (cur !== me) return;
    me.busy = false;
    if (r.ok) return done(true);
    me.pin = "";
    me.err = me.shake = true;
    me.msg = r.away ? "LocalHub isn’t answering, so it can’t check the code" : r.left ? `Wrong code. ${r.left} ${r.left === 1 ? "try" : "tries"} left` : "Wrong code";
    if (r.wait) me.until = Date.now() + r.wait * 1000;
    paint();
    setTimeout(() => { if (cur === me) { me.shake = false; paint(); } }, 500);
  }
  function ask({ title, sub = "", cancel = true, digits, check, place, remote = false }) {
    if (cur) { if (cur.title === title) return cur.promise; done(false); }
    if (!box) {
      box = document.createElement("div");
      box.className = "lk";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-label", "Enter code");
      box.addEventListener("click", (e) => { const k = e.target.closest?.("[data-lk]")?.dataset.lk; e.stopPropagation(); if (k) { if (cur) { cur.sel = k; } press(k); } });
      host.append(box);
    }
    cur = { title, sub, cancel, digits: digits || C.digits, check, place, remote, pin: "", sel: "5", msg: "", err: false, until: 0 };
    cur.promise = new Promise((r) => { cur.resolve = r; });
    box.classList.add("on");
    clearInterval(tick);
    tick = setInterval(paint, 1000);
    paint();
    return cur.promise;
  }
  // A remote's keys, or a number pad's (Android's key codes 7 to 16).
  function key(name) {
    if (!cur) return false;
    const num = /^key:(\d+)$/.exec(name);
    if (num && num[1] >= 7 && num[1] <= 16) { press(String(num[1] - 7)); return true; }
    const at = KEYS.indexOf(cur.sel), x = at % 3, y = Math.floor(at / 3);
    const to = { left: [x - 1, y], right: [x + 1, y], up: [x, y - 1], down: [x, y + 1] }[name];
    cur.remote = true;
    if (to) { if (to[0] >= 0 && to[0] < 3 && to[1] >= 0 && to[1] < 4) { const k = KEYS[to[1] * 3 + to[0]]; if (k !== "back" || cur.cancel) cur.sel = k; } paint(); }
    else if (name === "enter") press(cur.sel);
    else if (name === "back") { if (cur.pin) press("del"); else press("back"); paint(); }
    return true;
  }
  addEventListener("keydown", (e) => {
    if (!cur) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === "Backspace") press("del");
    else if (e.key === "Escape") press("back");
    else if (!cur.remote || !/^(Arrow|Enter)/.test(e.key)) { if (e.key === "Tab") e.preventDefault(); if (e.ctrlKey || e.metaKey || /^F\d/.test(e.key)) return; }
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  return { load, ask, key, conf: () => C, isOpen: () => !!cur, close: () => cur && done(false), locked: (place) => C.on && C.places.includes(place), lockedApp: (name) => C.on && C.apps.includes(name) };
}
