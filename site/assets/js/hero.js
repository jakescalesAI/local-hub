/*
 * The opening: the glass reveal plays centred on the page, then the finished tile glides into the title
 * and the rest of the page arrives. The page itself is already in its final layout underneath, and the
 * "intro" class only hides parts of it, so nothing shifts and every way out lands on the same page.
 * Any click, key or scroll skips to the end. Clicking the tile in the title replays it.
 */
(function () {
  "use strict"

  var root = document.documentElement
  var tile = document.querySelector(".tile")
  // The house from icons/hub.svg, door cut out, on its own: the reveal only reads the shape's outline.
  var HOUSE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><mask id="m"><path d="M256 124 398 244H358V382H154V244H114Z" fill="#fff" stroke="#fff" stroke-width="26" stroke-linejoin="round"/><path d="M220 396V322a36 36 0 0 1 72 0V396Z" fill="#000"/></mask></defs><rect width="512" height="512" fill="#fff" mask="url(#m)"/></svg>'
  var REVEAL = { present: 1.7, glide: 1.6, background: "#000000", plateColor: "#1c1c1e", logoColor: "#ffffff", dispersion: 0, colorBleed: 0, bevelWidth: 0.13, edgeSmear: 0.5, startZoom: 1.12, fitLogo: true } // background is --bg; no colour fringes, and the house stays inside the glass
  var TILE_RATIO = 1.01875 // the title's tile is the reveal's last frame drawn in vector, this many tile sizes across
  var HANDOFF = REVEAL.present + 0.8 // seconds; by now the glass has settled and the frame matches the image
  var MOVE = 850 // ms the tile takes to reach the title
  var WORDS_AT = 120
  var REST_AT = 460
  var DONE_AT = 1400
  var EASE = "cubic-bezier(.32, .72, 0, 1)"

  var canvas = null
  var glass = null
  var move = null
  var timers = []
  var raf = 0
  var pump = 0
  var playing = false

  function later(fn, ms) { timers.push(setTimeout(fn, ms)) }

  function dropCanvas() {
    if (glass) glass.dispose()
    if (canvas) canvas.remove()
    glass = canvas = null
  }

  function stopClock() {
    cancelAnimationFrame(raf)
    clearInterval(pump)
    raf = pump = 0
  }

  function listen(on) {
    var f = on ? "addEventListener" : "removeEventListener"
    ;["pointerdown", "keydown", "wheel", "touchmove"].forEach(function (e) { window[f](e, finish, { passive: true }) })
    document[f]("visibilitychange", finish)
  }

  // Every way out comes through here. Without the intro classes the page is simply its normal self.
  function finish() {
    playing = false
    listen(false)
    window.removeEventListener("scroll", finish)
    timers.forEach(clearTimeout)
    timers = []
    stopClock()
    dropCanvas()
    if (move) move.cancel()
    move = null
    root.classList.remove("intro", "intro-move", "intro-words", "intro-rest")
    document.dispatchEvent(new Event("hero:done"))
  }

  function handoff() {
    stopClock()
    var r = tile.getBoundingClientRect()
    var dx = canvas.clientWidth / 2 - (r.left + r.width / 2)
    var dy = canvas.clientHeight / 2 - (r.top + r.height / 2)
    var scale = (glass.tilePx() * TILE_RATIO) / r.width
    move = tile.animate(
      [{ transform: "translate(" + dx + "px," + dy + "px) scale(" + scale + ")" }, { transform: "none" }],
      { duration: MOVE, easing: EASE, fill: "both" }
    )
    root.classList.add("intro-move")
    dropCanvas() // the glass context goes before anything else starts
    later(function () { root.classList.add("intro-words") }, WORDS_AT)
    later(function () { root.classList.add("intro-rest") }, REST_AT)
    later(finish, DONE_AT)
  }

  function run() {
    if (!playing) return
    var t0 = performance.now()
    var last = t0
    function step(now) {
      if (!glass) return
      cancelAnimationFrame(raf)
      last = now
      var T = (now - t0) / 1000
      if (T >= HANDOFF) return handoff()
      glass.draw(T)
      raf = requestAnimationFrame(step)
    }
    // Some embedded views never fire animation frames, so a slow timer keeps the clock going there.
    pump = setInterval(function () {
      var now = performance.now()
      if (now - last > 120) step(now)
    }, 40)
    glass.draw(0)
    raf = requestAnimationFrame(step)
  }

  function play() {
    if (document.hidden) return finish()
    playing = true
    root.classList.add("intro")
    canvas = document.createElement("canvas")
    canvas.className = "reveal"
    canvas.setAttribute("aria-hidden", "true")
    document.body.appendChild(canvas)
    glass = window.GlassReveal && GlassReveal.create(canvas, REVEAL)
    if (!glass) return finish()
    listen(true)
    later(function () { window.addEventListener("scroll", finish, { passive: true }) }, 300)
    later(finish, 6500) // whatever happens, the page is never held behind the intro
    glass.load(HOUSE).then(run, finish)
  }

  function canPlay() {
    return window.WebGL2RenderingContext && matchMedia("(prefers-reduced-motion: no-preference)").matches
  }

  if (root.classList.contains("intro")) play()
  else document.dispatchEvent(new Event("hero:done"))

  if (canPlay()) {
    tile.style.cursor = "pointer"
    tile.addEventListener("click", function () {
      if (playing) return
      window.scrollTo(0, 0)
      document.dispatchEvent(new Event("hero:play"))
      play()
    })
  }
})()
