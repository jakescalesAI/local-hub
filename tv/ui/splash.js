/*
 * LocalHub's opening, on the TV and on the hub page: trylocalhub.com's glass house, then the tile glides into
 * "Local ⌂ Hub", then the home screen. The glass is a short video of the site's own (intro.mp4, rendered once from
 * site/assets/js/glass.js), so a Fire TV Stick plays it instead of drawing it. Without the video it's a plain fade.
 *
 * window.LocalHubSplash.done resolves once it has gone; the page calls .release() once its home screen is whole.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var splash = document.getElementById("splash");
  var tile = splash && splash.querySelector(".splash-tile");
  var HOLD = 650; // the plain wordmark stays this long before the home screen

  var resolveDone;
  // The page says when the home screen is whole (release()); 7 seconds at most, so it never holds the TV.
  var release;
  var gate = new Promise(function (r) { release = r; });
  setTimeout(release, 7000);
  window.LocalHubSplash = { done: new Promise(function (r) { resolveDone = r; }), release: function () { release(); } };
  if (!splash || !tile) { resolveDone(); return; }
  var ended = false, quick = false, video = null;
  // Coming back to LocalHub (Android closed it behind another app, or Home) isn't a fresh start: no logo, the home
  // screen just fades in once it's ready. On the hub page, the same for a reload.
  try { quick = !!(window.LocalHubNative && window.LocalHubNative.quickStart && window.LocalHubNative.quickStart()); } catch (e) { quick = false; }
  if (quick) splash.classList.add("quick");

  function leave() {
    if (ended) return;
    ended = true;
    if (!splash.classList.contains("glass")) splash.classList.add("moving", "words");
    gate.then(function () {
      splash.classList.add("leaving");
      document.documentElement.classList.add("home-in"); // Home comes up as this goes
      setTimeout(function () { splash.classList.add("is-gone"); if (video) { video.remove(); video = null; } resolveDone(); }, quick ? 320 : 820);
    });
  }

  function skip(e) {
    removeEventListener("keydown", skip, true);
    removeEventListener("pointerdown", skip, true);
    if (ended) return;
    e.stopImmediatePropagation();
    e.preventDefault();
        leave();
  }
  addEventListener("keydown", skip, true);
  addEventListener("pointerdown", skip, true);
  if (quick) { leave(); return; }
  setTimeout(leave, 6500);

  function words() {
    splash.classList.add("words");
    setTimeout(leave, HOLD);
  }
  var began = false;
  function plain() {
    if (began || ended) return;
    began = true;
    splash.classList.add("moving");
    setTimeout(words, 250);
  }
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still || !window.fetch || !script) return plain();
  // Late (a slow network, no decoder): the plain one, rather than a black screen.
  var late = setTimeout(plain, 2500);
  // All of it is one video, the glide and the wordmark too, so nothing the page is busy with can make it stutter.
  function show(v) {
    video = v;
    v.addEventListener("ended", leave);
    v.addEventListener("error", plain);
    var started = function () {
      if (began || ended) { if (video === v && began && !splash.classList.contains("glass")) { v.remove(); video = null; } return; }
      began = true;
      clearTimeout(late);
      splash.classList.add("glass");
      setTimeout(leave, 4600); // whatever happens to it, it ends
    };
    if (!v.paused && v.currentTime > 0) started(); else v.addEventListener("playing", started, { once: true });
    var p = v.play();
    if (p && p.catch) p.catch(plain);
  }
  // The hub page has it in its markup, so it starts with the page.
  var own = splash.querySelector("video");
  if (own) {
    // All of it is here before it starts, and the page has stopped loading: nothing left to make it wait.
    var settled = new Promise(function (r) { if (document.readyState === "complete") r(); else addEventListener("load", r); setTimeout(r, 1100); });
    fetch(own.dataset.src).then(function (r) { if (!r.ok) throw new Error("intro"); return r.blob(); }).then(function (b) {
      return new Promise(function (r, no) { own.oncanplaythrough = r; own.onerror = no; own.src = URL.createObjectURL(b); own.load(); });
    }).then(function () { return settled; }).then(function () { requestAnimationFrame(function () { requestAnimationFrame(function () { if (!began && !ended) show(own); }); }); }).catch(plain);
    return;
  }
  // On the TV, as a blob: an Android page's video otherwise asks for itself without the page's own sign-in.
  fetch(new URL("intro.mp4?v=2", script.src).href).then(function (r) { if (!r.ok) throw new Error("intro"); return r.blob(); }).then(function (b) {
    if (began || ended) return;
    var v = document.createElement("video");
    v.className = "splash-video";
    v.muted = true;
    v.setAttribute("playsinline", "");
    v.disablePictureInPicture = true;
    v.src = URL.createObjectURL(new Blob([b], { type: "video/mp4" }));
    splash.prepend(v);
    show(v);
  }).catch(plain);
})();
