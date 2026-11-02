/*
 * The curved row of app screens. From tilted-grid-hero by Ruixen (see CREDITS.txt): one row of screens streams
 * around the inside of a cylinder. A CSS box can't bend, so each tile is cut into vertical strips, each a flat facet
 * of the cylinder, and one rotation on the tile carries the whole thing along the arc.
 * Built only when the row is close, shown only while on screen. Under reduced motion or with no script,
 * .wall-band shows assets/shots/wall/still.webp instead.
 */
(function () {
  "use strict"

  var SCREENS = ["home-sand", "cal-month", "chat-hotel", "add-widget", "cal-agenda", "edit-home", "style-light", "search-out", "cal-week", "chat-trip", "home-graphite"]
  var SLICES = 16
  var CAMERA = 1.6 // camera distance, as a multiple of the cylinder's radius
  var MAX_WIDTH = 55 // a tile is never wider than this share of the row, so a phone still shows its neighbours
  var ASPECT = 1.6
  var TILE = 56 // tile height, % of the row's height
  var GAP = 6 // % of a tile's height
  var BEND = (64 * Math.PI) / 180 // how far round the arc the row's edge sits
  var SPEED = 6 // seconds to advance by one tile

  var root = document.documentElement
  var band = document.querySelector(".wall-band")

  function deg(rad) { return (rad * 180) / Math.PI }
  function round(n) { return +n.toFixed(4) }
  function arc() { return (CAMERA - 1 + Math.cos(BEND)) / (2 * CAMERA * Math.sin(BEND)) }

  // Lays the loop on the cylinder: `unit` is the arc one tile-height spans, `limit` how far round a tile goes before
  // it is wholly off-screen, `sweep` where the loop's ends sit. A tile only ever wraps out of sight.
  function measure(width, height) {
    var h = Math.min((TILE / 100) * height, ((MAX_WIDTH / 100) * width) / ASPECT)
    var unit = deg(h / (width * arc()))
    var pitch = (ASPECT + GAP / 100) * unit
    var limit = deg(BEND) + (ASPECT * unit) / 2
    var columns = Math.min(40, Math.max(2, Math.ceil((2 * limit) / pitch)))
    var sweep = round((columns * pitch) / 2)
    return { columns: columns, sweep: sweep, unit: round(unit), limit: round(Math.min(sweep, limit)) }
  }

  function address(i) { return "assets/shots/wall/" + SCREENS[i % SCREENS.length] + ".webp" }

  function run() {
    var stage = document.createElement("div")
    var sheet = document.createElement("style")
    var radius = round(100 * arc()) + "cqw"
    var current = ""
    stage.className = "wall-stage"
    stage.setAttribute("aria-hidden", "true")
    stage.style.setProperty("--h", "min(" + TILE + "cqh, " + round(MAX_WIDTH / ASPECT) + "cqw)")
    stage.style.setProperty("--a", ASPECT)
    stage.style.setProperty("--share", ASPECT / SLICES)
    stage.style.perspective = round(100 * arc() * CAMERA) + "cqw"

    function turn(d) { return "translateZ(" + radius + ") rotateY(" + round(d) + "deg) translateZ(-" + radius + ")" }

    function show(tile, n) {
      tile.dataset.shows = n
      tile.style.setProperty("--img", 'url("' + new URL(address(n), document.baseURI).href + '")')
    }

    function build() {
      var box = band.getBoundingClientRect()
      if (!box.width || !box.height) return
      var m = measure(box.width, box.height)
      var key = m.columns + "/" + m.sweep + "/" + m.unit
      if (key === current) return
      current = key
      var hide = round(((m.sweep - m.limit) / (2 * m.sweep || 1)) * 100)
      sheet.textContent = "@keyframes wall-orbit{from{transform:" + turn(-m.sweep) + "}to{transform:" + turn(m.sweep) + "}" +
        "0%," + hide + "%," + (100 - hide) + "%,100%{visibility:hidden}" +
        (hide + 0.001) + "%," + (100 - hide - 0.001) + "%{visibility:visible}}"
      var share = ASPECT / SLICES
      stage.textContent = ""
      for (var t = 0; t < m.columns; t++) {
        var tile = document.createElement("div")
        tile.className = "wall-tile"
        tile.style.animationDuration = m.columns * SPEED + "s"
        tile.style.animationDelay = -t * SPEED + "s"
        // Tile `columns - 1` starts nearest the exit, so this numbers tiles in the order they come on.
        show(tile, m.columns - 1 - t)
        tile.addEventListener("animationiteration", function (ev) {
          // It has just wrapped out of sight: time for its next screen.
          show(ev.currentTarget, +ev.currentTarget.dataset.shows + m.columns)
        })
        for (var k = 0; k < SLICES; k++) {
          var strip = document.createElement("i")
          strip.style.setProperty("--k", k)
          strip.style.transform = turn((ASPECT / 2 - (k + 0.5) * share) * m.unit)
          tile.append(strip)
        }
        stage.append(tile)
      }
    }

    // Every screen up front: a tile picks up its next one just before it comes back into view.
    var loads = SCREENS.map(function (_, i) {
      var im = new Image()
      im.src = address(i)
      return im.decode().catch(function () {})
    })
    function reveal() { stage.classList.add("on") }
    Promise.all(loads).then(reveal)
    setTimeout(reveal, 2500)

    band.append(sheet, stage)
    build()
    new ResizeObserver(build).observe(band)
    new IntersectionObserver(function (entries) {
      band.classList.toggle("wall-on", entries[entries.length - 1].isIntersecting)
    }).observe(band)
  }

  function whenClose() {
    document.removeEventListener("hero:done", whenClose)
    var io = new IntersectionObserver(function (entries) {
      if (!entries[entries.length - 1].isIntersecting) return
      io.disconnect()
      run()
    }, { rootMargin: "400px" })
    io.observe(band)
  }

  if (!band || !root.classList.contains("motion")) return
  if (!CSS.supports("width", "1cqw")) {
    root.classList.remove("motion")
    return
  }
  if (root.classList.contains("intro")) document.addEventListener("hero:done", whenClose)
  else whenClose()
})()
