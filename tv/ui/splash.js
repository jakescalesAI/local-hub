/*
 * LocalHub TV's opening: the house tile, then "Local ▢ Hub" fades in, then the home screen.
 * A plain CSS fade: no WebGL, nothing for a Fire TV Stick's GPU to set up while the page loads.
 *
 * window.LocalHubSplash.done resolves once the splash has gone; the page calls .release() once its home screen is whole.
 */
(function () {
  "use strict";

  var splash = document.getElementById("splash");
  var tile = splash && splash.querySelector(".splash-tile");
  var HOLD = 1100; // the finished wordmark stays this long before the home screen

  var resolveDone;
  // The page says when the home screen is whole (release()); 7 seconds at most, so it never holds the TV.
  var release;
  var gate = new Promise(function (r) { release = r; });
  setTimeout(release, 7000);
  window.LocalHubSplash = { done: new Promise(function (r) { resolveDone = r; }), release: function () { release(); } };
  if (!splash || !tile) { resolveDone(); return; }
  var ended = false;
  // Coming back to LocalHub (Android closed it behind another app, or Home) isn't a fresh start: no logo, the home
  // screen just fades in once it's ready.
  var quick = false;
  try { quick = !!(window.LocalHubNative && window.LocalHubNative.quickStart && window.LocalHubNative.quickStart()); } catch (e) { quick = false; }
  if (quick) splash.classList.add("quick");

  function leave() {
    if (ended) return;
    ended = true;
    splash.classList.add("words");
    gate.then(function () {
      splash.classList.add("leaving");
      setTimeout(function () { splash.classList.add("is-gone"); resolveDone(); }, quick ? 320 : 700);
    });
  }

  // Any key skips it; the page releases it once the home screen is ready.
  addEventListener("keydown", function skip(e) { if (!ended) { e.stopImmediatePropagation(); e.preventDefault(); leave(); } removeEventListener("keydown", skip, true); }, true);
  if (quick) { leave(); return; }
  setTimeout(leave, 4000);
  splash.classList.add("moving");
  setTimeout(function () { splash.classList.add("words"); setTimeout(leave, HOLD); }, 250);
})();
