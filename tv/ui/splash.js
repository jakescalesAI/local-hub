/*
 * LocalHub TV's opening, the same one trylocalhub.com plays (site/assets/js/hero.js): the glass
 * reveal draws the house tile in the middle of the screen, then the tile glides into "Local ▢ Hub"
 * and the words arrive. Then the splash fades and the home screen is there.
 *
 * glass.js is the site's renderer, unchanged. Without WebGL2 (some Fire TV sticks), with reduced
 * motion, or with Liquid glass set to Light, the wordmark simply fades in.
 *
 * window.LocalHubSplash.done resolves once the splash has gone.
 */
(function () {
  "use strict";

  var splash = document.getElementById("splash");
  var tile = splash && splash.querySelector(".splash-tile");
  var HOUSE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><mask id="m"><path d="M256 124 398 244H358V382H154V244H114Z" fill="#fff" stroke="#fff" stroke-width="26" stroke-linejoin="round"/><path d="M220 396V322a36 36 0 0 1 72 0V396Z" fill="#000"/></mask></defs><rect width="512" height="512" fill="#fff" mask="url(#m)"/></svg>';
  // The site's settings (hero.js REVEAL), so the two openings match.
  var REVEAL = { present: 1.7, glide: 1.6, background: "#000000", plateColor: "#1c1c1e", logoColor: "#ffffff", dispersion: 0, colorBleed: 0, bevelWidth: 0.13, edgeSmear: 0.5, startZoom: 1.12, fitLogo: true };
  var TILE_RATIO = 1.01875;
  var HANDOFF = REVEAL.present + 0.8;
  var MOVE = 850;
  var HOLD = 1100; // the finished wordmark stays this long before the home screen
  var EASE = "cubic-bezier(.32, .72, 0, 1)";

  var resolveDone;
  window.LocalHubSplash = { done: new Promise(function (r) { resolveDone = r; }) };
  if (!splash || !tile) { resolveDone(); return; }

  var canvas = null, glass = null, raf = 0, pump = 0, ended = false;

  function lite() {
    var glass = "Auto";
    try { glass = JSON.parse(localStorage.getItem("localhub.tv") || "{}").glass || "Auto"; } catch (e) { /* storage off */ }
    if (glass === "Light") return true;
    if (glass === "Full" || !window.LocalHubNative) return false;
    // Auto on a TV: the same rule as app.js's WEAK_TV. The WebGL reveal is the heaviest thing a weak TV would draw.
    var d = {};
    try { d = JSON.parse(window.LocalHubNative.status() || "{}"); } catch (e) { /* not trusted yet */ }
    return !d.ramMB || d.ramMB < 2600 || d.lowRam === true || (d.sdk || 0) < 26;
  }
  function canPlay() {
    return window.WebGL2RenderingContext && window.GlassReveal && !lite() &&
      matchMedia("(prefers-reduced-motion: no-preference)").matches && !document.hidden;
  }

  function dropCanvas() {
    cancelAnimationFrame(raf);
    clearInterval(pump);
    if (glass) glass.dispose();
    if (canvas) canvas.remove();
    glass = canvas = null;
  }

  function leave() {
    if (ended) return;
    ended = true;
    dropCanvas();
    splash.classList.add("words", "leaving");
    setTimeout(function () { splash.classList.add("is-gone"); resolveDone(); }, 700);
  }

  function words() {
    splash.classList.add("words");
    setTimeout(leave, HOLD);
  }

  function handoff() {
    var r = tile.getBoundingClientRect();
    var dx = canvas.clientWidth / 2 - (r.left + r.width / 2);
    var dy = canvas.clientHeight / 2 - (r.top + r.height / 2);
    var scale = (glass.tilePx() * TILE_RATIO) / r.width;
    dropCanvas();
    splash.classList.add("moving");
    if (tile.animate) {
      tile.animate([{ transform: "translate(" + dx + "px," + dy + "px) scale(" + scale + ")" }, { transform: "none" }], { duration: MOVE, easing: EASE, fill: "both" });
    }
    setTimeout(words, 120);
  }

  function run() {
    var t0 = performance.now(), last = t0;
    function step(now) {
      if (!glass) return;
      cancelAnimationFrame(raf);
      last = now;
      var T = (now - t0) / 1000;
      if (T >= HANDOFF) return handoff();
      glass.draw(T);
      raf = requestAnimationFrame(step);
    }
    // Some WebViews pause animation frames while loading; a slow timer keeps the clock going.
    pump = setInterval(function () { var now = performance.now(); if (now - last > 120) step(now); }, 40);
    glass.draw(0);
    raf = requestAnimationFrame(step);
  }

  function play() {
    if (!canPlay()) { splash.classList.add("moving"); setTimeout(words, 250); return; }
    canvas = document.createElement("canvas");
    canvas.className = "splash-reveal";
    splash.appendChild(canvas);
    glass = window.GlassReveal.create(canvas, REVEAL);
    if (!glass) { dropCanvas(); splash.classList.add("moving"); setTimeout(words, 250); return; }
    glass.load(HOUSE).then(run, function () { dropCanvas(); splash.classList.add("moving"); words(); });
  }

  // Any key skips it; it never holds the TV for more than 7 seconds.
  addEventListener("keydown", function skip(e) { if (!ended) { e.stopImmediatePropagation(); e.preventDefault(); leave(); } removeEventListener("keydown", skip, true); }, true);
  setTimeout(leave, 7000);
  play();
})();
