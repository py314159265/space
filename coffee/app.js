/* Brewnian Motion. The cup is always full. Motion stays on the device. */
(function () {
  const CONFIG = {
    easy: { tilt: 12, jolt: 2.4, spill: 0.85, label: "Easy · 12° tilt tolerance" },
    medium: { tilt: 8, jolt: 1.6, spill: 1.15, label: "Medium · 8° tilt tolerance" },
    hard: { tilt: 5, jolt: 1.0, spill: 1.45, label: "Hard · 5° tilt tolerance" },
  };
  const LINES = [
    "# definitely_secure.py",
    "import os, sqlite3",
    "",
    "def login(user, pw):",
    "    if pw == PASSWORD:",
    "        return True",
    "",
    "def query(name):",
    "    sql = \"SELECT * FROM users WHERE name='\" + name + \"'\"",
    "    return sql",
    "",
    "PASSWORD = \"hunter2\"",
    "API_KEY = \"sk-live-please-rotate\"",
    "db_pass = \"admin123\"",
    "",
    "def run():",
    "    cmd = input(\"py> \")",
    "    print(eval(cmd))",
    "",
    "try:",
    "    run()",
    "except:",
    "    pass",
    "",
    "os.system(\"curl http://example.com | sh\")",
    "",
    "# TODO: fix security later",
  ];
  const PASSWORD_LINE = LINES.findIndex((line) => line.startsWith("PASSWORD"));

  const $ = (id) => document.getElementById(id);
  const canvas = $("c");
  const ctx = canvas.getContext("2d");
  let mode = "endurance";
  let diff = "medium";
  let sprintSecs = 10;
  let playing = false;
  let calibrating = false;
  let calLeft = 0;
  let steps = 0;
  let over = false;
  let left = 10;
  let level = { x: 0, y: 0, z: 9.8 };
  let grav = { x: 0, y: 0, z: 9.8 };
  let useMouse = true;
  let gotMotion = false;
  let mouse = { x: 0, y: 0, on: false };
  const surf = { x: 0, y: 0, vx: 0, vy: 0 };
  const ripples = [];
  const drops = [];
  const stains = [];
  let lastStep = 0;
  const G = 9.80665;
  const gLp = { x: 0, y: 0, z: G };
  const tiltLp = { x: 0, y: 0, z: G };
  let signs = { x: -1, y: 1, z: 1 };
  const rawMean = { x: 0, y: 0, z: G, n: 0 };
  const horiz = { x: 0, y: 0 };
  const tiltTarget = { x: 0, y: 0 };
  let lastMotionT = 0;
  const motionTimes = [];
  const sensor = { field: "none", channel: "vertical", vert: 0, threshold: 0.02 * G, hz: 0 };
  let detector = StepDetect.createDetector();
  let sensorSteps = 0;
  let lastSense = null;
  const debugOn = new URLSearchParams(location.search).get("debug") === "1";
  let w = 1, h = 1, dpr = 1;
  let paper = { x: 0, y: 0, w: 0, h: 0, lineH: 0, top: 0 };
  let cup = { x: 0, y: 0, r: 0 };
  let last = performance.now();
  let startedAt = 0;
  let redacted = false;
  let wakeLock = null;

  function cfg() { return CONFIG[diff]; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rand(seed) {
    let s = seed;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pw = Math.min(w - 28, 460);
    const ph = Math.min(h * 0.7, 620);
    const py = h * 0.18;
    paper = {
      x: (w - pw) / 2, y: py, w: pw, h: ph,
      lineH: (ph - 40) / LINES.length,
      top: py + 32,
      rot: -0.04,
    };
    const passY = paper.top + PASSWORD_LINE * paper.lineH + paper.lineH * 0.35;
    cup = { x: paper.x + pw / 2, y: passY, r: Math.min(pw * 0.22, 84) };
  }

  function bestKey() { return `brewnian-best-${mode}-${diff}-${mode === "sprint" ? sprintSecs : "run"}`; }
  function readBest() {
    return Number(localStorage.getItem(bestKey()) || 0);
  }
  function writeBest() {
    const prev = readBest();
    if (steps > prev) localStorage.setItem(bestKey(), String(steps));
    return Math.max(prev, steps);
  }

  function nudge(ang, energy) {
    const kick = energy * 0.16;
    surf.vx += Math.cos(ang) * kick;
    surf.vy += Math.sin(ang) * kick;
    ripples.push({ t: 0, amp: Math.min(0.2, 0.07 + energy * 0.03) });
    if (ripples.length > 3) ripples.shift();
  }

  function angleBetween(a, b) {
    const am = Math.hypot(a.x, a.y, a.z) || 1;
    const bm = Math.hypot(b.x, b.y, b.z) || 1;
    const dot = (a.x * b.x + a.y * b.y + a.z * b.z) / (am * bm);
    return Math.acos(clamp(dot, -1, 1));
  }

  function spillNow(ang) {
    if (over || !playing || calibrating) return;
    over = true;
    playing = false;
    detector.disarm();
    const lineY = paper.top + PASSWORD_LINE * paper.lineH + paper.lineH * 0.4;
    const saucerR = cup.r * 1.36;
    const sx = cup.x + Math.cos(ang) * (saucerR + 20);
    const sy = lineY;
    const seed = (Math.random() * 1e9) | 0;
    const rng = rand(seed || 1);
    const lobes = Array.from({ length: 9 }, () => 0.82 + rng() * 0.28);
    const tears = Array.from({ length: 8 }, () => ({
      ang: ang + (rng() - 0.5) * 1.1,
      dist: 26 + rng() * 22,
      len: 9 + rng() * 8,
      wid: 1.3 + rng() * 1.1,
    }));
    const specks = Array.from({ length: 9 }, () => ({
      ang: ang + (rng() - 0.5) * 1.8,
      dist: 30 + rng() * 28,
      s: 0.45 + rng() * 0.7,
    }));
    const mottles = Array.from({ length: 5 }, () => ({
      x: (rng() - 0.5) * 18,
      y: (rng() - 0.5) * 14,
      rx: 6 + rng() * 10,
      ry: 4 + rng() * 7,
    }));
    const radius = 38 + rng() * 14;
    stains.push({ x: sx, y: sy, r: radius, lobes, tears, specks, mottles });
    const top = lineY - 2;
    const bot = lineY + paper.lineH;
    if (sy + radius > top && sy - radius < bot && sx > paper.x && sx < paper.x + paper.w) redacted = true;
    const rimX = cup.x + Math.cos(ang) * cup.r;
    const rimY = cup.y + Math.sin(ang) * cup.r;
    for (let i = 0; i < 6; i++) {
      const a = ang + (Math.random() - 0.5) * 0.6;
      drops.push({
        x: rimX, y: rimY,
        vx: Math.cos(a) * (50 + Math.random() * 90),
        vy: Math.sin(a) * (40 + Math.random() * 70) + 30,
        r: 1.6 + Math.random() * 1.8,
        life: 0.45 + Math.random() * 0.3,
      });
    }
    finish(true);
  }

  function showStep(now) {
    if (over || !playing || calibrating) return;
    if (now - lastStep < 250) return;
    lastStep = now;
    steps += 1;
    const el = $("steps");
    el.textContent = String(steps);
    el.classList.add("bump");
    setTimeout(() => el.classList.remove("bump"), 160);
    nudge(Math.random() * Math.PI * 2, 1);
  }

  function asMeters(v) {
    const mag = Math.hypot(v.x, v.y, v.z);
    if (mag > 0.4 && mag < 3.2) return { x: v.x * G, y: v.y * G, z: v.z * G };
    return v;
  }

  function orientationAngle() {
    if (screen.orientation && Number.isFinite(screen.orientation.angle)) return screen.orientation.angle;
    if (Number.isFinite(window.orientation)) return window.orientation;
    return 0;
  }

  function noteFlat(sample) {
    if (!calibrating) return;
    rawMean.n += 1;
    rawMean.x += (sample.x - rawMean.x) / rawMean.n;
    rawMean.y += (sample.y - rawMean.y) / rawMean.n;
    rawMean.z += (sample.z - rawMean.z) / rawMean.n;
    if (Math.abs(rawMean.z) > 5) signs = Tilt.signsFromFlat(rawMean);
  }

  function onMotion(event) {
    const now = performance.now();
    const dt = lastMotionT ? clamp((now - lastMotionT) / 1000, 0.008, 0.05) : 0.016;
    lastMotionT = now;
    motionTimes.push(now);
    while (motionTimes.length && now - motionTimes[0] > 1000) motionTimes.shift();
    sensor.hz = motionTimes.length;

    const incl = event.accelerationIncludingGravity;
    const raw = event.acceleration;
    let sample = null;
    if (incl && incl.x != null && incl.y != null && incl.z != null) {
      sample = asMeters(incl);
      sensor.field = "accelerationIncludingGravity";
    } else if (raw && raw.x != null && raw.y != null && raw.z != null) {
      sample = asMeters(raw);
      sensor.field = "acceleration";
    }
    if (!sample) return;

    if (over) return;

    noteFlat(sample);
    const axes = Tilt.screenAxes(sample, signs, orientationAngle());
    const norm = Tilt.normalize(sample, signs);
    const aG = 1 - Math.exp(-dt * 2 * Math.PI * 0.2);
    const aT = 1 - Math.exp(-dt * 2 * Math.PI * 4);
    gLp.x += (norm.x - gLp.x) * aG;
    gLp.y += (norm.y - gLp.y) * aG;
    gLp.z += (norm.z - gLp.z) * aG;
    tiltLp.x += (axes.x - tiltLp.x) * aT;
    tiltLp.y += (axes.y - tiltLp.y) * aT;
    tiltLp.z += (axes.z - tiltLp.z) * aT;
    grav = { x: tiltLp.x, y: tiltLp.y, z: tiltLp.z };
    gotMotion = true;
    if (!(useMouse && mouse.on)) useMouse = false;

    const lin = {
      x: norm.x - gLp.x,
      y: norm.y - gLp.y,
      z: norm.z - gLp.z,
    };
    const gm = Math.hypot(gLp.x, gLp.y, gLp.z) || G;
    const vert = (lin.x * gLp.x + lin.y * gLp.y + lin.z * gLp.z) / gm;
    const ux = gLp.x / gm;
    const uy = gLp.y / gm;
    const hx = lin.x - vert * ux;
    const hy = lin.y - vert * uy;
    const absTilt = Math.acos(clamp(Math.abs(axes.z) / (Math.hypot(axes.x, axes.y, axes.z) || 1), 0, 1));
    const relTilt = angleBetween(tiltLp, level);
    const limit = cfg().tilt * Math.PI / 180;
    const linMag = Math.hypot(lin.x, lin.y, lin.z);
    if (playing && !calibrating && (absTilt > 45 * Math.PI / 180 || relTilt > limit || linMag > cfg().jolt * G)) {
      sensor.why = absTilt > 45 * Math.PI / 180 ? "gross" : relTilt > limit ? "tilt" : "jolt";
      detector.disarm();
      spillNow(Math.atan2(axes.y, axes.x));
      return;
    }
    const counting = playing && !calibrating && !over;
    const sensed = detector.push(norm, dt, now, counting);
    lastSense = sensed;
    sensor.channel = sensed.channel;
    sensor.vert = sensed.vertical;
    sensor.threshold = sensed.threshold;
    if (counting && sensed.steps > sensorSteps) {
      const add = sensed.steps - sensorSteps;
      sensorSteps = sensed.steps;
      for (let i = 0; i < add; i++) showStep(now);
    } else {
      sensorSteps = sensed.steps;
    }
    if (over) return;
    const driveA = 1 - Math.exp(-dt * 2 * Math.PI * 6);
    const spun = Tilt.rotate(hx, hy, orientationAngle());
    horiz.x += (spun.x / G - horiz.x) * driveA;
    horiz.y += (spun.y / G - horiz.y) * driveA;
    const gz = Math.abs(tiltLp.z) + 0.4;
    tiltTarget.x = Math.atan2(tiltLp.x - level.x, gz);
    tiltTarget.y = Math.atan2(tiltLp.y - level.y, gz);
    if (calibrating) {
      level.x += (tiltLp.x - level.x) * 0.2;
      level.y += (tiltLp.y - level.y) * 0.2;
      level.z += (tiltLp.z - level.z) * 0.2;
    }
  }

  function onOrient(event) {
    if (gotMotion || event.beta == null) return;
    sensor.field = "orientation";
    const beta = event.beta * Math.PI / 180;
    const gamma = (event.gamma || 0) * Math.PI / 180;
    const raw = {
      x: -Math.sin(gamma) * G,
      y: -Math.sin(beta) * Math.cos(gamma) * G,
      z: Math.cos(beta) * Math.cos(gamma) * G,
    };
    const axes = Tilt.screenAxes(raw, signs, orientationAngle());
    tiltLp.x = axes.x;
    tiltLp.y = axes.y;
    tiltLp.z = axes.z;
    grav = { x: axes.x, y: axes.y, z: axes.z };
    const gz = Math.abs(axes.z) + 0.4;
    tiltTarget.x = Math.atan2(axes.x - level.x, gz);
    tiltTarget.y = Math.atan2(axes.y - level.y, gz);
    if (over || !playing || calibrating) return;
    const absTilt = Math.acos(clamp(Math.abs(axes.z) / (Math.hypot(axes.x, axes.y, axes.z) || 1), 0, 1));
    const relTilt = angleBetween(axes, level);
    if (absTilt > 45 * Math.PI / 180 || relTilt > cfg().tilt * Math.PI / 180) {
      detector.disarm();
      spillNow(Math.atan2(axes.y, axes.x));
    }
  }

  function tick(dt) {
    if (useMouse && mouse.on) {
      const nx = clamp((mouse.x - w / 2) / (w * 0.45), -1, 1);
      const ny = clamp((mouse.y - h / 2) / (h * 0.45), -1, 1);
      const max = cfg().tilt * Math.PI / 180;
      tiltTarget.x = nx * max;
      tiltTarget.y = ny * max;
      horiz.x = 0;
      horiz.y = 0;
    }
    const freq = 2.5;
    const omega = 2 * Math.PI * freq;
    const zeta = 0.12;
    const drive = 0.45;
    surf.vx += (-2 * zeta * omega * surf.vx - omega * omega * (surf.x - tiltTarget.x) + horiz.x * drive * omega) * dt;
    surf.vy += (-2 * zeta * omega * surf.vy - omega * omega * (surf.y - tiltTarget.y) + horiz.y * drive * omega) * dt;
    surf.x = clamp(surf.x + surf.vx * dt, -0.7, 0.7);
    surf.y = clamp(surf.y + surf.vy * dt, -0.7, 0.7);
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].t += dt;
      if (ripples[i].t > 0.6) ripples.splice(i, 1);
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.life -= dt;
      d.vy += 280 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.life <= 0) drops.splice(i, 1);
    }
    if (playing && mode === "sprint" && !calibrating) {
      left = Math.max(0, sprintSecs - (performance.now() - startedAt) / 1000);
      const secs = Math.ceil(left);
      $("timer").textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      if (left <= 0) finish(false);
    }
  }

  function stainPath(s) {
    const steps = 56;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const f = (a / (Math.PI * 2)) * s.lobes.length;
      const i0 = Math.floor(f) % s.lobes.length;
      const i1 = (i0 + 1) % s.lobes.length;
      const t = f - Math.floor(f);
      const lobe = s.lobes[i0] * (1 - t) + s.lobes[i1] * t;
      const rr = s.r * lobe;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function drawStain(s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.globalCompositeOperation = "multiply";
    stainPath(s);
    const g = ctx.createRadialGradient(0, 0, s.r * 0.12, 0, 0, s.r);
    g.addColorStop(0, "rgba(252, 236, 206, 0.28)");
    g.addColorStop(0.7, "rgba(230, 186, 112, 0.45)");
    g.addColorStop(1, "rgba(206, 154, 78, 0.62)");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.15;
    ctx.strokeStyle = "rgba(168, 112, 52, 0.72)";
    ctx.stroke();
    ctx.fillStyle = "rgba(250, 232, 196, 0.5)";
    for (const m of s.mottles) {
      ctx.beginPath();
      ctx.ellipse(m.x, m.y, m.rx, m.ry, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(176, 114, 52, 0.62)";
    for (const d of s.tears) {
      ctx.save();
      ctx.translate(Math.cos(d.ang) * d.dist, Math.sin(d.ang) * d.dist);
      ctx.rotate(d.ang);
      ctx.beginPath();
      ctx.moveTo(d.len * 0.55, 0);
      ctx.quadraticCurveTo(0, d.wid, -d.len * 0.4, 0);
      ctx.quadraticCurveTo(0, -d.wid, d.len * 0.55, 0);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = "rgba(160, 102, 46, 0.55)";
    for (const p of s.specks) {
      ctx.beginPath();
      ctx.arc(Math.cos(p.ang) * p.dist, Math.sin(p.ang) * p.dist, p.s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw() {
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#fbf6ee");
    bg.addColorStop(1, "#f0dcc4");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const pcx = paper.x + paper.w / 2;
    const pcy = paper.y + paper.h / 2;
    ctx.save();
    ctx.translate(pcx, pcy);
    ctx.rotate(paper.rot);
    ctx.translate(-pcx, -pcy);
    ctx.save();
    ctx.shadowColor = "rgba(90, 55, 30, 0.22)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 12;
    roundRect(paper.x, paper.y, paper.w, paper.h, 6);
    ctx.fillStyle = "#fbf8f3";
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    roundRect(paper.x, paper.y, paper.w, paper.h, 6);
    ctx.clip();
    ctx.fillStyle = "#8a7360";
    ctx.font = "11px Source Sans 3, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText("definitely_secure.py  ·  localhost  ·  1/1", paper.x + 12, paper.y + 8);
    ctx.strokeStyle = "rgba(90, 55, 30, 0.12)";
    ctx.beginPath();
    ctx.moveTo(paper.x + 10, paper.y + 24);
    ctx.lineTo(paper.x + paper.w - 10, paper.y + 24);
    ctx.stroke();
    const sample = LINES.reduce((a, b) => (a.length > b.length ? a : b));
    ctx.font = "12px ui-monospace, monospace";
    const fit = (paper.w - 46) / Math.max(1, ctx.measureText(sample).width);
    const fontPx = Math.max(8, Math.min(paper.lineH * 0.72, 12 * fit));
    ctx.font = `${fontPx}px ui-monospace, monospace`;
    LINES.forEach((line, i) => {
      const y = paper.top + i * paper.lineH;
      ctx.fillStyle = "#b3a394";
      ctx.fillText(String(i + 1).padStart(2, " "), paper.x + 8, y);
      ctx.fillStyle = line.startsWith("#") ? "#6d8a55" : "#3d2b22";
      ctx.fillText(line, paper.x + 30, y);
    });
    for (const s of stains) drawStain(s);
    ctx.restore();

    const slope = Math.hypot(surf.x, surf.y);
    const aim = slope > 0.0001 ? Math.atan2(surf.y, surf.x) : 0;
    const inner = cup.r * 0.74;
    const saucer = cup.r * 1.36;
    const hx = Math.cos(aim);
    const hy = Math.sin(aim);

    ctx.save();
    ctx.shadowColor = "rgba(58, 36, 24, 0.22)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 10;
    ctx.beginPath();
    ctx.arc(cup.x, cup.y, saucer, 0, Math.PI * 2);
    ctx.fillStyle = "#f6efe6";
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cup.x, cup.y, saucer, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#e0d0be";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cup.x, cup.y, cup.r, 0, Math.PI * 2);
    ctx.fillStyle = "#fbf7f2";
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cup.x, cup.y, inner, 0, Math.PI * 2);
    ctx.clip();
    const coffee = ctx.createRadialGradient(cup.x, cup.y, inner * 0.12, cup.x, cup.y, inner);
    coffee.addColorStop(0, "#3f2416");
    coffee.addColorStop(0.62, "#6a3a20");
    coffee.addColorStop(1, "#c4894e");
    ctx.fillStyle = coffee;
    ctx.fillRect(cup.x - inner, cup.y - inner, inner * 2, inner * 2);
    const shade = ctx.createLinearGradient(cup.x - hx * inner, cup.y - hy * inner, cup.x + hx * inner, cup.y + hy * inner);
    shade.addColorStop(0, "rgba(24, 10, 4, 0.42)");
    shade.addColorStop(0.38, "rgba(24, 10, 4, 0.04)");
    shade.addColorStop(0.72, "rgba(255, 210, 150, 0)");
    shade.addColorStop(1, "rgba(255, 214, 160, 0.22)");
    ctx.fillStyle = shade;
    ctx.fillRect(cup.x - inner, cup.y - inner, inner * 2, inner * 2);
    const slide = Math.min(inner * 0.34, slope * inner * 2.4);
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = "#fff1d2";
    ctx.beginPath();
    ctx.ellipse(cup.x - hx * slide, cup.y - hy * slide - inner * 0.06, inner * 0.2, inner * 0.09, -0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    for (const r of ripples) {
      const u = r.t / 0.6;
      ctx.beginPath();
      ctx.arc(cup.x, cup.y, inner * (0.18 + u * 0.78), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 220, 176, ${0.16 * r.amp * (1 - u)})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    const thin = clamp(slope / (cfg().tilt * Math.PI / 180), 0, 1);
    const expose = inner * 0.32 * thin;
    if (expose > 0.6) {
      ctx.beginPath();
      ctx.arc(cup.x, cup.y, inner + 1, 0, Math.PI * 2);
      ctx.moveTo(cup.x + hx * expose + inner, cup.y + hy * expose);
      ctx.arc(cup.x + hx * expose, cup.y + hy * expose, inner, 0, Math.PI * 2);
      ctx.fillStyle = "#f4eadc";
      ctx.fill("evenodd");
      ctx.beginPath();
      ctx.arc(cup.x + hx * expose * 0.5, cup.y + hy * expose * 0.5, inner - expose * 0.45, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 226, 180, 0.7)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cup.x, cup.y, inner - 1.4, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 214, 160, 0.4)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cup.x, cup.y, (cup.r + inner) / 2, 0, Math.PI * 2);
    ctx.lineWidth = cup.r - inner;
    ctx.strokeStyle = "#f7f1e8";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cup.x, cup.y, cup.r, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(90, 60, 40, 0.16)";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cup.x, cup.y, inner, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(58, 28, 14, 0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "#fbf7f2";
    ctx.lineWidth = cup.r * 0.13;
    ctx.beginPath();
    ctx.arc(cup.x + cup.r * 0.98, cup.y, cup.r * 0.3, -1.15, 1.15);
    ctx.stroke();
    ctx.strokeStyle = "rgba(90, 60, 40, 0.35)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    const bx = cup.x + hx * slope * cup.r * 0.35;
    const by = cup.y - cup.r * 1.22 + hy * slope * cup.r * 0.35;
    ctx.beginPath();
    ctx.arc(bx, by, 9, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(90, 60, 40, 0.35)";
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(bx + hx * slope * 4, by + hy * slope * 4, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(90, 60, 40, 0.55)";
    ctx.fill();

    ctx.fillStyle = "rgba(176, 112, 48, 0.75)";
    for (const d of drops) {
      ctx.globalAlpha = clamp(d.life * 2.2, 0, 0.8);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function roundRect(x, y, rw, rh, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + rw, y, x + rw, y + rh, r);
    ctx.arcTo(x + rw, y + rh, x, y + rh, r);
    ctx.arcTo(x, y + rh, x, y, r);
    ctx.arcTo(x, y, x + rw, y, r);
    ctx.closePath();
  }

  function paintLevel() {
    const limit = cfg().tilt * Math.PI / 180 || 0.01;
    let ax = tiltTarget.x;
    let ay = tiltTarget.y;
    if (!(useMouse && mouse.on)) {
      const gz = Math.abs(tiltLp.z) + 0.4;
      ax = Math.atan2(tiltLp.x - level.x, gz);
      ay = Math.atan2(tiltLp.y - level.y, gz);
    }
    const fx = clamp(ax / limit, -1.05, 1.05);
    const fy = clamp(ay / limit, -1.05, 1.05);
    const dot = $("bubble-dot");
    dot.style.left = (50 - fx * 38) + "%";
    dot.style.top = (50 - fy * 38) + "%";
    $("bubble").classList.toggle("hot", Math.hypot(fx, fy) > 0.82);
  }

  function drawWave() {
    const board = $("debug-wave");
    if (!board || !lastSense) return;
    const g = board.getContext("2d");
    const bw = board.width;
    const bh = board.height;
    g.clearRect(0, 0, bw, bh);
    g.fillStyle = "#fffaf3";
    g.fillRect(0, 0, bw, bh);
    const wave = lastSense.wave || [];
    if (wave.length < 2) return;
    const th = lastSense.threshold || 0.02 * G;
    let peak = th;
    for (const p of wave) peak = Math.max(peak, Math.abs(p.v));
    const scale = Math.max(peak * 1.25, th * 2);
    const t0 = wave[0].t;
    const t1 = wave[wave.length - 1].t;
    const xOf = (time) => 4 + ((time - t0) / (t1 - t0 || 1)) * (bw - 8);
    const yOf = (v) => bh / 2 - (v / scale) * (bh * 0.42);
    g.strokeStyle = "rgba(196, 122, 58, 0.85)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(4, yOf(th));
    g.lineTo(bw - 4, yOf(th));
    g.moveTo(4, yOf(-th));
    g.lineTo(bw - 4, yOf(-th));
    g.stroke();
    g.strokeStyle = "#3a2418";
    g.lineWidth = 1.4;
    g.beginPath();
    wave.forEach((p, i) => {
      const x = xOf(p.t);
      const y = yOf(p.v);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
    g.fillStyle = "#c47a3a";
    for (const mark of lastSense.marks || []) {
      if (mark < t0 || mark > t1) continue;
      const x = xOf(mark);
      g.fillRect(x - 1, 3, 2, bh - 6);
    }
  }

  function loop(t) {
    const dt = Math.min(0.033, (t - last) / 1000 || 0.016);
    last = t;
    if (playing) tick(dt);
    draw();
    paintLevel();
    window.__brew = {
      steps, over, redacted, playing, mode, diff,
      stains: stains.length,
      field: sensor.field,
      channel: sensor.channel,
      vert: sensor.vert,
      threshold: sensor.threshold,
      slope: Math.hypot(surf.x, surf.y),
      why: sensor.why || "",
      cup: { x: cup.x, y: cup.y, r: cup.r },
      surf: { x: surf.x, y: surf.y },
    };
    if (debugOn) {
      $("debug").hidden = false;
      $("debug-text").textContent = [
        `field ${sensor.field}`,
        `channel ${sensor.channel}`,
        `gx ${(tiltLp.x / G).toFixed(3)} g`,
        `gy ${(tiltLp.y / G).toFixed(3)} g`,
        `sign ${signs.x},${signs.y},${signs.z}`,
        `vert ${(sensor.vert / G).toFixed(3)} g`,
        `threshold ${(sensor.threshold / G).toFixed(3)} g`,
        `steps ${steps}`,
        `rate ${sensor.hz} Hz`,
      ].join("\n");
      drawWave();
    }
    requestAnimationFrame(loop);
  }

  function finish(spilled) {
    if (!playing && !over) return;
    playing = false;
    const best = writeBest();
    $("hold").hidden = true;
    $("over").hidden = false;
    $("over-mode").textContent = `${mode === "sprint" ? "Sprint " + sprintSecs + "s" : "Endurance"} · ${diff[0].toUpperCase() + diff.slice(1)}`;
    $("over-steps").textContent = String(steps);
    $("over-note").textContent = redacted ? "Password successfully redacted by coffee" : "The cup is lighter. The code is not.";
    $("best").textContent = `Best ${best}`;
  }

  async function begin() {
    try {
      const Dev = window.DeviceMotionEvent;
      if (Dev && typeof Dev.requestPermission === "function") {
        await Dev.requestPermission();
      }
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
        await DeviceOrientationEvent.requestPermission();
      }
    } catch (err) { /* desktop has no permission sheet */ }
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch (err) { /* optional */ }
    try { await screen.orientation?.lock?.("portrait"); } catch (err) { /* optional */ }
    steps = 0;
    over = false;
    signs = { x: -1, y: 1, z: 1 };
    rawMean.x = 0;
    rawMean.y = 0;
    rawMean.z = G;
    rawMean.n = 0;
    sensorSteps = 0;
    detector = StepDetect.createDetector();
    lastSense = null;
    redacted = false;
    stains.length = 0;
    drops.length = 0;
    ripples.length = 0;
    surf.x = surf.y = surf.vx = surf.vy = 0;
    $("steps").textContent = "0";
    paintLevel();
    $("badge").textContent = diff[0].toUpperCase() + diff.slice(1);
    $("clock").hidden = mode !== "sprint";
    $("timer").textContent = `0:${String(sprintSecs).padStart(2, "0")}`;
    $("hud").hidden = false;
    $("hold").hidden = false;
    $("gate").hidden = true;
    $("over").hidden = true;
    $("play").hidden = false;
    $("count").hidden = false;
    calibrating = true;
    playing = true;
    startedAt = performance.now() + 3000;
    for (const n of [3, 2, 1]) {
      $("count").textContent = String(n);
      await new Promise((r) => setTimeout(r, 700));
    }
    $("count").hidden = true;
    calibrating = false;
    startedAt = performance.now();
    left = sprintSecs;
  }

  function resetToGate() {
    playing = false;
    over = false;
    $("over").hidden = true;
    $("play").hidden = true;
    $("hud").hidden = false;
    $("gate").hidden = false;
  }

  function bind() {
    document.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        mode = btn.dataset.mode;
        document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b === btn));
        $("sprint-times").hidden = mode !== "sprint";
      });
    });
    document.querySelectorAll("[data-secs]").forEach((btn) => {
      btn.addEventListener("click", () => {
        sprintSecs = Number(btn.dataset.secs);
        document.querySelectorAll("[data-secs]").forEach((b) => b.classList.toggle("on", b === btn));
      });
    });
    document.querySelectorAll("[data-diff]").forEach((btn) => {
      btn.addEventListener("click", () => {
        diff = btn.dataset.diff;
        document.querySelectorAll("[data-diff]").forEach((b) => b.classList.toggle("on", b === btn));
        $("hint").textContent = cfg().label;
      });
    });
    $("start").addEventListener("click", begin);
    $("again").addEventListener("click", resetToGate);
    $("share").addEventListener("click", async () => {
      const text = `Brewnian Motion · ${mode} · ${diff} · ${steps} steps`;
      try {
        if (navigator.share) await navigator.share({ title: "Brewnian Motion", text });
        else await navigator.clipboard.writeText(text);
      } catch (err) { /* user dismissed the sheet */ }
    });
    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("deviceorientation", onOrient);
    window.addEventListener("keydown", (event) => {
      if (event.code === "Space" && playing && !calibrating) {
        event.preventDefault();
        showStep(performance.now());
      }
    });
    canvas.addEventListener("pointerdown", (event) => {
      mouse.on = true;
      mouse.x = event.clientX;
      mouse.y = event.clientY;
      useMouse = true;
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!mouse.on) return;
      mouse.x = event.clientX;
      mouse.y = event.clientY;
    });
    window.addEventListener("pointerup", () => { mouse.on = false; });
    window.addEventListener("resize", resize);
  }

  resize();
  bind();
  requestAnimationFrame(loop);
})();
