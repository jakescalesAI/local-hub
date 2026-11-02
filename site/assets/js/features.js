/*
 * The live parts of the features section: packets along the flow lines, the results sheet that keeps changing,
 * the assistant's tools taking turns, and the small search bar. The diagrams' looks come from ink-orbit-features
 * by Kedhareswer Naidu (see CREDITS.txt). Everything pauses off screen. Without script or under reduced motion
 * the diagrams stand still; the search bar still filters under reduced motion, it just doesn't type by itself.
 */
(function () {
  "use strict"

  var section = document.querySelector(".features")
  if (!section) return
  var moving = document.documentElement.classList.contains("motion")
  var NS = "http://www.w3.org/2000/svg"
  var timers = []
  var onScreen = false

  // Runs fn every `ms`, only while the section is on screen.
  function every(ms, fn) { timers.push({ ms: ms, fn: fn, id: 0 }) }
  function setRunning(on) {
    onScreen = on
    section.classList.toggle("ink-on", on)
    section.querySelectorAll("svg.live").forEach(function (svg) { on ? svg.unpauseAnimations() : svg.pauseAnimations() })
    timers.forEach(function (t) {
      clearInterval(t.id)
      if (on) t.id = setInterval(t.fn, t.ms)
    })
  }

  function packet(svg, path, dur, begin) {
    var c = document.createElementNS(NS, "circle")
    var m = document.createElementNS(NS, "animateMotion")
    c.setAttribute("r", svg.dataset.r || "2.4")
    c.setAttribute("class", "pkt")
    m.setAttribute("dur", dur + "s")
    m.setAttribute("begin", begin + "s")
    m.setAttribute("repeatCount", "indefinite")
    m.setAttribute("path", path)
    c.append(m)
    svg.append(c)
    return c
  }

  /* The flow lines */
  if (moving) section.querySelectorAll(".flow-link svg").forEach(function (svg, n) {
    svg.classList.add("live")
    svg.querySelectorAll("path").forEach(function (p, i) { packet(svg, p.getAttribute("d"), 2.2 + i * 0.6, n * 0.5 + i * 0.35) })
  })

  /* The results sheet: a new search lands on top of the stack */
  var RESULTS = [
    ["lis", [["Trip to Lisbon", "Link"], ["itinerary.md", "File"], ["Ask chat: lis", "Chat"]]],
    ["out", [["Out of office", "Snippet"], ["Ask chat: out", "Chat"]]],
    ["cal", [["Calendar", "Tab"], ["Ask chat: cal", "Chat"]]],
    ["exp", [["Export links and snippets", "Action"], ["Ask chat: exp", "Chat"]]],
    ["pic", [["Pictures", "Folder"], ["Ask chat: pic", "Chat"]]]
  ]
  var stack = section.querySelector(".stack")
  var front = stack && stack.querySelector(".sheet-front")
  function row(title, word) {
    var li = document.createElement("li")
    var a = document.createElement("span")
    var b = document.createElement("em")
    a.textContent = title
    b.textContent = word
    li.append(a, b)
    return li
  }
  if (moving && front) {
    var shown = 0
    every(3000, function () {
      shown = (shown + 1) % RESULTS.length
      var next = front.cloneNode(false)
      var q = document.createElement("p")
      var ul = document.createElement("ul")
      q.textContent = RESULTS[shown][0]
      RESULTS[shown][1].forEach(function (r) { ul.append(row(r[0], r[1])) })
      next.append(q, ul)
      next.classList.add("sheet-new")
      front.replaceWith(next)
      front = next
    })
  }

  /* The assistant's tools take turns */
  var tools = section.querySelector(".tools")
  if (tools) {
    var items = Array.prototype.slice.call(tools.querySelectorAll(".tool"))
    var status = tools.querySelector(".tools-status")
    var resting = status.textContent
    var turn = -1, held = false, pkt = null
    function highlight(i) {
      items.forEach(function (el, k) { el.classList.toggle("on", k === i) })
      tools.querySelectorAll(".tool-line").forEach(function (el, k) { el.classList.toggle("on", k === i) })
      status.textContent = i < 0 ? resting : items[i].dataset.says
      if (pkt) pkt.remove()
      pkt = null
      if (i >= 0 && moving) {
        pkt = packet(tools, tools.querySelectorAll(".tool-line")[i].getAttribute("d"), 1.1, 0)
        pkt.querySelector("animateMotion").beginElement()
      }
    }
    items.forEach(function (el, i) {
      el.addEventListener("mouseenter", function () { held = true; highlight(i) })
      el.addEventListener("mouseleave", function () { held = false; highlight(moving ? turn : -1) })
    })
    if (moving) {
      tools.classList.add("live")
      every(1800, function () {
        if (held) return
        turn = (turn + 1) % items.length
        highlight(turn)
      })
    }
  }

  /* The small search bar: the same seven kinds of result, over a sample list */
  var SAMPLE = [
    ["Trip to Lisbon", "Link"], ["Team wiki", "Link"], ["Tracker", "Link"],
    ["Out of office", "Snippet", "ooo"], ["Home address", "Snippet", "addr"],
    ["itinerary.md", "File"], ["packing-list.txt", "File"], ["Pictures", "Folder"], ["Taxes 2026", "Folder"],
    ["Calendar", "Tab"], ["Files", "Tab"],
    ["Add a link", "Action"], ["Export links and snippets", "Action"]
  ]
  var input = section.querySelector(".mini input")
  var list = section.querySelector(".mini ul")
  if (input && list) {
    input.disabled = false
    function filter(q) {
      q = q.trim().toLowerCase()
      var rows = !q ? SAMPLE.slice(0, 4) : SAMPLE.filter(function (s) {
        return s[0].toLowerCase().indexOf(q) >= 0 || (s[2] && s[2].indexOf(q) >= 0)
      }).sort(function (a, b) {
        return b[0].toLowerCase().startsWith(q) - a[0].toLowerCase().startsWith(q)
      }).slice(0, 3)
      list.textContent = ""
      rows.forEach(function (s) { list.append(row(s[0], s[1])) })
      if (q) list.append(row("Ask chat: " + input.value.trim(), "Chat"))
    }
    input.addEventListener("input", function () { filter(input.value) })

    // It types by itself until someone touches it.
    if (moving) {
      var words = ["lis", "out", "pic", "exp"], word = 0, step = 0, touched = false
      var stop = function () { touched = true }
      input.addEventListener("pointerdown", stop)
      input.addEventListener("focus", stop)
      input.addEventListener("keydown", stop)
      every(420, function () {
        if (touched) return
        var w = words[word]
        step++
        if (step <= w.length) input.value = w.slice(0, step)
        else if (step === w.length + 6) { input.value = ""; word = (word + 1) % words.length; step = -1 }
        else return
        filter(input.value)
      })
    }
  }

  new IntersectionObserver(function (entries) {
    var on = entries[entries.length - 1].isIntersecting
    if (on !== onScreen) setRunning(on)
  }).observe(section)
  setRunning(false)
})()
