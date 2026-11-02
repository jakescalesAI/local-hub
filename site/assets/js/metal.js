/*
 * Liquid metal on the download buttons. Each button stays a plain link with a CSS metal background;
 * this only lays a moving canvas behind its label, and only while the button is on screen.
 * After the liquid-metal component's chrome. Its noise surface read as clouds at button size, so this draws
 * one smooth chrome horizon from sine waves instead, and LIFT raises the dark end, so the dark label keeps
 * at least 4.5:1 over every part of the metal.
 */
(function () {
  "use strict"

  var MAX_DPR = 2
  var MAX_FRAME_DELTA = 1 / 20
  var POINTER_EASE = 0.08
  var POINTER_RANGE = 2
  var START = 4 // seconds into the flow, so the first frame already looks like metal

  var VERTEX_SHADER = `#version 300 es
in vec2 a;
void main(){ gl_Position = vec4(a, 0.0, 1.0); }`

  var FRAGMENT_SHADER = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPointer;

const float LIFT = 0.48;

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float x = (uv.x - 0.5) * uRes.x / uRes.y * 2.2 + uPointer.x * 0.5;
  float t = uTime;

  // Noise reads as clouds at button size, so the surface is built from slow sine waves: smooth by construction.
  float bend = 0.17 * sin(x * 1.1 + t * 0.31 + 1.0)
             + 0.08 * sin(x * 2.3 - t * 0.23 + uv.y * 2.0)
             + 0.04 * sin(x * 4.1 + t * 0.19 + uv.y * 3.0);
  float s = fract(uv.y * 0.85 + bend + uPointer.y * 0.06 + t * 0.025);

  // One chrome horizon: sky fading to steel, a sharp dark line, then ground rising back to bright.
  vec3 sky = vec3(0.97, 0.98, 1.0);
  vec3 steel = vec3(0.50, 0.57, 0.68);
  vec3 line = vec3(0.04, 0.05, 0.07);
  vec3 col = mix(sky, steel, smoothstep(0.0, 0.46, s));
  col = mix(col, line, smoothstep(0.455, 0.49, s));
  col = mix(col, sky, pow(smoothstep(0.49, 1.0, s), 1.4));
  col += 0.5 * smoothstep(0.025, 0.0, abs(s - 0.53));

  col = clamp(col, 0.0, 1.0);
  fragColor = vec4(LIFT + (1.0 - LIFT) * col, 1.0);
}`

  function compile(gl, type, source) {
    var shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null
  }

  function createMetal(canvas) {
    var gl = canvas.getContext("webgl2", { alpha: false, antialias: false, powerPreference: "low-power" })
    if (!gl) return null
    var vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    var fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    if (!vertex || !fragment) return null
    var program = gl.createProgram()
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
    gl.useProgram(program)

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    var position = gl.getAttribLocation(program, "a")
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    var uRes = gl.getUniformLocation(program, "uRes")
    var uTime = gl.getUniformLocation(program, "uTime")
    var uPointer = gl.getUniformLocation(program, "uPointer")

    var elapsed = START
    var last = 0
    var raf = 0
    var pointerX = 0, pointerY = 0, targetX = 0, targetY = 0

    function draw(time, px, py) {
      var rect = canvas.getBoundingClientRect()
      var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      var w = Math.max(1, Math.round(rect.width * dpr))
      var h = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      gl.viewport(0, 0, w, h)
      gl.uniform2f(uRes, w, h)
      gl.uniform1f(uTime, time)
      gl.uniform2f(uPointer, px, py)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    function tick(now) {
      elapsed += Math.min((now - last) / 1000, MAX_FRAME_DELTA)
      last = now
      pointerX += (targetX - pointerX) * POINTER_EASE
      pointerY += (targetY - pointerY) * POINTER_EASE
      draw(elapsed, pointerX, pointerY)
      raf = requestAnimationFrame(tick)
    }

    draw(elapsed, 0, 0)

    return {
      draw: draw,
      run: function (on) {
        cancelAnimationFrame(raf)
        raf = 0
        if (!on) return
        last = performance.now()
        raf = requestAnimationFrame(tick)
      },
      point: function (x, y) { targetX = x; targetY = y },
    }
  }

  function attach(button) {
    var canvas = document.createElement("canvas")
    canvas.className = "metal"
    canvas.setAttribute("aria-hidden", "true")
    button.prepend(canvas)
    var metal = createMetal(canvas)
    if (!metal) {
      canvas.remove()
      return null
    }
    var onScreen = false
    var held = false
    function update() { metal.run(onScreen && !held && !document.hidden) }
    new IntersectionObserver(function (entries) {
      onScreen = entries[entries.length - 1].isIntersecting
      update()
    }).observe(button)
    document.addEventListener("visibilitychange", update)
    document.addEventListener("hero:play", function () { held = true; update() })
    document.addEventListener("hero:done", function () { held = false; update() })

    if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
      button.addEventListener("pointermove", function (e) {
        var r = button.getBoundingClientRect()
        metal.point(((e.clientX - r.left) / r.width - 0.5) * POINTER_RANGE, (0.5 - (e.clientY - r.top) / r.height) * POINTER_RANGE)
      })
      button.addEventListener("pointerleave", function () { metal.point(0, 0) })
    }
    requestAnimationFrame(function () { canvas.classList.add("on") }) // fades in over the CSS metal
    return metal
  }

  function start() {
    if (start.done) return
    start.done = true
    document.removeEventListener("hero:done", start)
    window.LiquidMetal = Array.prototype.map.call(document.querySelectorAll(".download"), attach)
  }

  if (!window.WebGL2RenderingContext || !matchMedia("(prefers-reduced-motion: no-preference)").matches) return
  // The glass context goes first: the metal only starts once the opening is over.
  if (document.documentElement.classList.contains("intro")) document.addEventListener("hero:done", start)
  else start()
})()
