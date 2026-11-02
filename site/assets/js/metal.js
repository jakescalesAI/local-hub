/*
 * Liquid metal on the download buttons. Each button stays a plain link with a CSS metal background;
 * this only lays a moving canvas behind its label, and only while the button is on screen.
 * After the liquid-metal component's chrome, polished: its noise surface read as dirt at button size, so this
 * draws the same bands as the CSS background (site.css), with a slow bend through the horizon and a slow sheen.
 * Nothing here is darker than the CSS bands' darkest stop, so the label's contrast holds in every frame.
 */
(function () {
  "use strict"

  var MAX_DPR = 2
  var MAX_FRAME_DELTA = 1 / 20
  var POINTER_EASE = 0.08
  var POINTER_RANGE = 2
  
  var VERTEX_SHADER = `#version 300 es
in vec2 a;
void main(){ gl_Position = vec4(a, 0.0, 1.0); }`

  var FRAGMENT_SHADER = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uTime;
uniform float uPointer;
uniform float uHover;

// Bottom to top, the same stops as .download's background in site.css.
vec3 chrome(float y){
  vec3 c = mix(vec3(0.894, 0.906, 0.925), vec3(0.706, 0.729, 0.761), smoothstep(0.0, 0.28, y));
  c = mix(c, vec3(0.553, 0.580, 0.620), smoothstep(0.28, 0.40, y));
  c = mix(c, vec3(0.827, 0.843, 0.867), smoothstep(0.40, 0.52, y));
  c = mix(c, vec3(0.945, 0.953, 0.965), smoothstep(0.52, 0.82, y));
  return mix(c, vec3(1.0), smoothstep(0.82, 1.0, y));
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float x = (uv.x - 0.5) * uRes.x / uRes.y;
  float t = uTime;

  float bend = 0.030 * sin(x * 0.9 + t * 0.20) + 0.014 * sin(x * 1.9 - t * 0.14);
  vec3 col = chrome(clamp(uv.y + bend, 0.0, 1.0));

  // A wide band of light crosses every 12 seconds or so, leaning like the light on a pill.
  float span = uRes.x / uRes.y * 0.5 + 1.2;
  float at = mod(t * 0.5, span * 2.0 + 2.0) - span + uPointer * 0.5;
  float d = (x + (uv.y - 0.5) * 0.7 - at) / 0.75;
  col += exp(-d * d) * (0.12 + 0.12 * uHover);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
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
    var uHover = gl.getUniformLocation(program, "uHover")

    var elapsed = 0
    var last = 0
    var raf = 0
    var pointer = 0, hover = 0, targetPointer = 0, targetHover = 0

    function draw(time, x, lit) {
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
      gl.uniform1f(uPointer, x)
      gl.uniform1f(uHover, Math.max(lit, 0))
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    function tick(now) {
      elapsed += Math.min((now - last) / 1000, MAX_FRAME_DELTA)
      last = now
      pointer += (targetPointer - pointer) * POINTER_EASE
      hover += (targetHover - hover) * POINTER_EASE
      draw(elapsed, pointer, hover)
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
      point: function (x, lit) { targetPointer = x; targetHover = lit },
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
        metal.point(((e.clientX - r.left) / r.width - 0.5) * POINTER_RANGE, 1)
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
    window.LiquidMetal = Array.prototype.filter.call(document.querySelectorAll(".download"), function (b) { return b.offsetWidth }).map(attach)
  }

  if (!window.WebGL2RenderingContext || !matchMedia("(prefers-reduced-motion: no-preference)").matches) return
  // The glass context goes first: the metal only starts once the opening is over.
  if (document.documentElement.classList.contains("intro")) document.addEventListener("hero:done", start)
  else start()
})()
