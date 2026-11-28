/* Draw the figure plates as one textured mesh.
   Clipping each triangle in the 2D canvas was the frame cost on a phone. */
(function (root) {
  const VERT = [
    "attribute vec2 aPos;",
    "attribute vec2 aUv;",
    "uniform vec2 uRes;",
    "varying vec2 vUv;",
    "void main() {",
    "  vec2 clip = (aPos / uRes) * 2.0 - 1.0;",
    "  clip.y = -clip.y;",
    "  gl_Position = vec4(clip, 0.0, 1.0);",
    "  vUv = aUv;",
    "}",
  ].join("\n");
  const FRAG = [
    "precision mediump float;",
    "varying vec2 vUv;",
    "uniform sampler2D uTex;",
    "uniform float uAlpha;",
    "uniform float uNight;",
    "void main() {",
    "  vec4 c = texture2D(uTex, vUv);",
    "  vec3 rgb = uNight > 0.5 ? vec3(1.0, 0.231, 0.231) : c.rgb;",
    "  float a = c.a * uAlpha;",
    "  gl_FragColor = vec4(rgb * a, a);",
    "}",
  ].join("\n");

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function downscale(img, maxSide) {
    const long = Math.max(img.width, img.height);
    if (long <= maxSide) return img;
    const scale = maxSide / long;
    const board = document.createElement("canvas");
    board.width = Math.max(1, Math.round(img.width * scale));
    board.height = Math.max(1, Math.round(img.height * scale));
    const g = board.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.drawImage(img, 0, 0, board.width, board.height);
    return board;
  }

  function obtainContext() {
    // Firefox for Android rejects some attribute mixes and only answers to
    // experimental-webgl on older releases. A failed getContext sticks to
    // that canvas, so each attempt gets a fresh one.
    const attempts = [
      ["webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: false }],
      ["webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false }],
      ["experimental-webgl", { alpha: true, premultipliedAlpha: true, antialias: false, failIfMajorPerformanceCaveat: false }],
      ["webgl", { alpha: true, failIfMajorPerformanceCaveat: false }],
    ];
    const notes = [];
    if (typeof WebGLRenderingContext === "undefined") {
      return { canvas: null, gl: null, note: "no WebGLRenderingContext" };
    }
    for (const [name, attrs] of attempts) {
      const canvas = document.createElement("canvas");
      try {
        const gl = canvas.getContext(name, attrs);
        if (gl) return { canvas, gl, note: name };
        notes.push(name + " null");
      } catch (err) {
        notes.push(name + " " + (err && err.message ? err.message : "threw"));
      }
    }
    return { canvas: null, gl: null, note: notes.join("; ") || "no WebGL context" };
  }

  function create() {
    const got = obtainContext();
    const canvas = got.canvas;
    const gl = got.gl;
    if (!gl) {
      root.ArtGL.lastError = got.note;
      return null;
    }
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      root.ArtGL.lastError = "shader compile failed";
      return null;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.bindAttribLocation(prog, 1, "aUv");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      root.ArtGL.lastError = "shader link failed";
      return null;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    const uRes = gl.getUniformLocation(prog, "uRes");
    const uAlpha = gl.getUniformLocation(prog, "uAlpha");
    const uNight = gl.getUniformLocation(prog, "uNight");
    gl.uniform1i(gl.getUniformLocation(prog, "uTex"), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    const textures = new Map();
    let lost = false;
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      lost = true;
    });

    function texture(img) {
      let tex = textures.get(img);
      if (tex) return tex;
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, downscale(img, 512));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      textures.set(img, tex);
      return tex;
    }

    function begin(cssW, cssH, artDpr, night) {
      const pw = Math.max(1, Math.round(cssW * artDpr));
      const ph = Math.max(1, Math.round(cssH * artDpr));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uNight, night ? 1 : 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    function mesh(img, alpha, data, count) {
      if (count < 3 || !(alpha > 0)) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture(img));
      gl.uniform1f(uAlpha, alpha);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 4), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, count);
    }

    let renderer = got.note;
    try {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const name = ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      if (name) renderer = String(name);
    } catch (err) { /* the context name is enough */ }
    root.ArtGL.lastError = "";
    return {
      canvas,
      begin,
      mesh,
      renderer,
      get lost() { return lost || gl.isContextLost(); },
    };
  }

  root.ArtGL = { create, lastError: "" };
})(typeof globalThis !== "undefined" ? globalThis : this);
