/*
 * LocalHub TV's opening: the house tile, then "Local ▢ Hub" fades in, then the home screen.
 * A plain CSS fade: no WebGL, nothing for a Fire TV Stick's GPU to set up while the page loads.
 *
 * window.LocalHubSplash.done resolves once the splash has gone.
 */
(function () {
  "use strict";

  var splash = document.getElementById("splash");
  var tile = splash && splash.querySelector(".splash-tile");
  var HOLD = 1100; // the finished wordmark stays this long before the home screen

  var resolveDone;
  window.LocalHubSplash = { done: new Promise(function (r) { resolveDone = r; }) };
  if (!splash || !tile) { resolveDone(); return; }
  var ended = false;

  function leave() {
    if (ended) return;
    ended = true;
    splash.classList.add("words", "leaving");
    setTimeout(function () { splash.classList.add("is-gone"); resolveDone(); }, 700);
  }

  // Any key skips it; it never holds the TV for more than 4 seconds.
  addEventListener("keydown", function skip(e) { if (!ended) { e.stopImmediatePropagation(); e.preventDefault(); leave(); } removeEventListener("keydown", skip, true); }, true);
  setTimeout(leave, 4000);
  splash.classList.add("moving");
  setTimeout(function () { splash.classList.add("words"); setTimeout(leave, HOLD); }, 250);
})();
