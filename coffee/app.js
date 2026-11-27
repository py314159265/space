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
  let spill = 0;
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
  let foam = [];
  let lastStep = 0;
  let stepArmed = true;
  let env = 0;
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
    const pw = Math.min(w - 28, 420);
    const ph = Math.min(h * 0.62, 560);
    paper = { x: (w - pw) / 2, y: h * 0.22, w: pw, h: ph, lineH: ph / (LINES.length + 1.2), top: h * 0.22 + 18 };
    const passY = paper.top + PASSWORD_LINE * paper.lineH + paper.lineH * 0.35;
    cup = { x: w / 2, y: passY, r: Math.min(pw, ph) * 0.2 };
    if (!foam.length) {
      foam = Array.from({ length: 7 }, (_, i) => ({ a: i, r: 0.15 + (i % 3) * 0.05, o: i * 0.7 }));
    }
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

  function inject(energy, ang) {
    surf.vx += Math.cos(ang) * energy;
    surf.vy += Math.sin(ang) * energy;
    ripples.push({ amp: energy * 0.35, freq: 7 + Math.random() * 4, decay: 1.6, t: 0, ang });
    if (ripples.length > 6) ripples.shift();
  }

  function spillAt(ang, amount) {
    spill = clamp(spill + amount * cfg().spill, 0, 100);
    $("meter").style.width = spill + "%";
    const lineY = paper.top + PASSWORD_LINE * paper.lineH + paper.lineH * 0.45;
    const cx = cup.x + Math.cos(ang) * (cup.r + 28);
    const cy = lineY + Math.sin(ang) * 8;
    for (let i = 0; i < 8; i++) {
      const a = ang + (Math.random() - 0.5) * 0.8;
      drops.push({
        x: cx, y: cy,
        vx: Math.cos(a) * (80 + Math.random() * 160),
        vy: Math.sin(a) * (80 + Math.random() * 140) + 40,
        r: 1.5 + Math.random() * 2.4,
        life: 0.45 + Math.random() * 0.35,
      });
    }
    const seed = (Math.random() * 1e9) | 0;
    const rng = rand(seed || 1);
    const lobes = Array.from({ length: 8 }, () => 0.55 + rng() * 0.7);
    const tears = Array.from({ length: 14 }, () => {
      const a = ang + (rng() - 0.5) * 1.4;
      const dist = cup.r * (0.15 + rng() * 0.9);
      return { x: Math.cos(a) * dist, y: Math.sin(a) * dist, rx: 2 + rng() * 5, ry: 1 + rng() * 2, a };
    });
    stains.push({ x: cx, y: cy, r: 16 + Math.random() * 22, lobes, tears, seed });
    if (Math.abs(cy - lineY) < paper.lineH) redacted = true;
    if (spill >= 100) finish(true);
  }

  function countStep(now) {
    if (now - lastStep < 250) return;
    lastStep = now;
    steps += 1;
    $("steps").textContent = String(steps);
    inject(1.4, Math.random() * Math.PI * 2);
  }

  function onMotion(event) {
    const g = event.accelerationIncludingGravity;
    const a = event.acceleration;
    if (g && g.x != null) {
      grav = { x: g.x, y: g.y, z: g.z };
      gotMotion = true;
      useMouse = false;
      if (calibrating) {
        level.x += (g.x - level.x) * 0.2;
        level.y += (g.y - level.y) * 0.2;
        level.z += (g.z - level.z) * 0.2;
      }
    }
    if (!playing || calibrating || !a || a.x == null) return;
    const mag = Math.hypot(a.x, a.y, a.z);
    env += (mag - env) * 0.08;
    const pulse = mag - env;
    if (pulse > 2.4 && stepArmed) {
      countStep(performance.now());
      stepArmed = false;
    } else if (pulse < 0.8) stepArmed = true;
    if (mag > cfg().jolt * 9.81) {
      const ang = Math.atan2(a.y, a.x);
      inject(mag / 9.81, ang);
      if (mag > cfg().jolt * 9.81 * 1.15) spillAt(ang, 8);
    }
  }

  function onOrient(event) {
    if (gotMotion || event.beta == null) return;
    grav = {
      x: Math.sin(event.gamma * Math.PI / 180) * 9.8,
      y: Math.sin(event.beta * Math.PI / 180) * 9.8,
      z: 9.8,
    };
  }

  function targets() {
    if (useMouse && mouse.on) {
      const nx = clamp((mouse.x - w / 2) / (w * 0.45), -1, 1);
      const ny = clamp((mouse.y - h / 2) / (h * 0.45), -1, 1);
      const max = cfg().tilt * Math.PI / 180;
      return { x: nx * max * 1.35, y: ny * max * 1.35 };
    }
    const gx = grav.x - level.x;
    const gy = grav.y - level.y;
    const gz = grav.z - level.z || 9.8;
    return { x: Math.atan2(gx, Math.abs(gz) + 0.01), y: Math.atan2(gy, Math.abs(gz) + 0.01) };
  }

  function tick(dt) {
    const aim = targets();
    const stiff = 34;
    const damp = 5.2;
    surf.vx += (-stiff * (surf.x - aim.x) - damp * surf.vx) * dt;
    surf.vy += (-stiff * (surf.y - aim.y) - damp * surf.vy) * dt;
    surf.x += surf.vx * dt;
    surf.y += surf.vy * dt;
    for (const r of ripples) r.t += dt;
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].amp *= Math.exp(-ripples[i].decay * dt);
      if (ripples[i].amp < 0.01) ripples.splice(i, 1);
    }
    let wave = 0;
    for (const r of ripples) wave += r.amp * Math.sin(r.freq * r.t);
    const amp = Math.hypot(surf.x, surf.y) + Math.abs(wave) * 0.25;
    const limit = cfg().tilt * Math.PI / 180;
    if (playing && !calibrating && amp > limit) {
      spillAt(Math.atan2(surf.y, surf.x), (amp - limit) * 40 * dt);
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.life -= dt;
      d.vy += 280 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.life <= 0) drops.splice(i, 1);
    }
    for (const f of foam) f.o += dt * 0.6;
    if (playing && mode === "sprint" && !calibrating) {
      left = Math.max(0, sprintSecs - (performance.now() - startedAt) / 1000);
      $("timer").textContent = left.toFixed(1);
      if (left <= 0) finish(false);
    }
  }

  function drawStain(s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.globalCompositeOperation = "multiply";
    ctx.beginPath();
    for (let i = 0; i <= s.lobes.length; i++) {
      const t = i % s.lobes.length;
      const a = t / s.lobes.length * Math.PI * 2;
      const rr = s.r * s.lobes[t];
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr * 0.86;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(214, 164, 92, 0.72)";
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = "rgba(150, 92, 40, 0.9)";
    ctx.stroke();
    ctx.fillStyle = "rgba(186, 122, 58, 0.95)";
    for (const d of s.tears) {
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, d.rx, d.ry, d.a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#2a1c14";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#f4e6cf";
    roundRect(paper.x, paper.y, paper.w, paper.h, 10);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    roundRect(paper.x, paper.y, paper.w, paper.h, 10);
    ctx.clip();
    ctx.font = `${Math.max(10, paper.lineH * 0.62)}px ui-monospace, monospace`;
    ctx.textBaseline = "top";
    LINES.forEach((line, i) => {
      const y = paper.top + i * paper.lineH;
      ctx.fillStyle = "#b9a48a";
      ctx.fillText(String(i + 1).padStart(2, " "), paper.x + 8, y);
      ctx.fillStyle = line.startsWith("#") ? "#8d9a72" : "#3d2a1e";
      ctx.fillText(line, paper.x + 32, y);
    });
    for (const s of stains) drawStain(s);
    ctx.restore();

    const aim = Math.atan2(surf.y, surf.x);
    const shift = Math.min(cup.r * 0.45, Math.hypot(surf.x, surf.y) * cup.r * 1.6);
    const ox = Math.cos(aim) * shift;
    const oy = Math.sin(aim) * shift;

    ctx.beginPath();
    ctx.ellipse(cup.x, cup.y + cup.r * 0.72, cup.r * 1.35, cup.r * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#efe2cf";
    ctx.fill();
    ctx.strokeStyle = "#c9b59a";
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(cup.x, cup.y, cup.r, cup.r * 0.96, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#f7f1e8";
    ctx.fill();
    ctx.lineWidth = cup.r * 0.08;
    ctx.strokeStyle = "#d9cbb8";
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cup.x, cup.y, cup.r * 0.86, cup.r * 0.82, 0, 0, Math.PI * 2);
    ctx.clip();
    const thin = 1 - Math.min(0.45, Math.hypot(surf.x, surf.y) * 0.8);
    ctx.beginPath();
    ctx.ellipse(cup.x + ox, cup.y + oy, cup.r * 0.78, cup.r * 0.72 * thin, 0, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(cup.x + ox * 0.3, cup.y + oy * 0.3, 4, cup.x + ox, cup.y + oy, cup.r);
    g.addColorStop(0, "#8a4b28");
    g.addColorStop(0.55, "#5c3018");
    g.addColorStop(1, "#3a1e10");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#e7c48a";
    for (const f of foam) {
      const fx = cup.x + ox * 0.8 + Math.cos(f.o + f.a) * cup.r * f.r;
      const fy = cup.y + oy * 0.8 + Math.sin(f.o * 0.8 + f.a) * cup.r * f.r * 0.7;
      ctx.beginPath();
      ctx.ellipse(fx, fy, cup.r * 0.16, cup.r * 0.09, f.a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = "#fff4df";
    ctx.beginPath();
    ctx.ellipse(cup.x - ox * 0.35, cup.y - oy * 0.35 - cup.r * 0.18, cup.r * 0.22, cup.r * 0.1, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const bubble = { x: cup.x + ox * 0.5, y: cup.y + oy * 0.5 };
    ctx.beginPath();
    ctx.arc(bubble.x, bubble.y, cup.r * 0.16, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,248,238,0.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#6b3a1e";
    for (const d of drops) {
      ctx.globalAlpha = clamp(d.life * 2, 0, 1);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
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

  function loop(t) {
    const dt = Math.min(0.033, (t - last) / 1000 || 0.016);
    last = t;
    if (playing) tick(dt);
    draw();
    window.__brew = { steps, spill, redacted, playing, mode, diff, surf: { x: surf.x, y: surf.y } };
    requestAnimationFrame(loop);
  }

  function finish(spilled) {
    if (!playing) return;
    playing = false;
    const best = writeBest();
    $("play").hidden = true;
    $("over").hidden = false;
    $("over-title").textContent = spilled ? "Spilled" : "Time";
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
    spill = 0;
    redacted = false;
    stains.length = 0;
    drops.length = 0;
    ripples.length = 0;
    surf.x = surf.y = surf.vx = surf.vy = 0;
    $("steps").textContent = "0";
    $("meter").style.width = "0%";
    $("badge").textContent = diff[0].toUpperCase() + diff.slice(1);
    $("timer").hidden = mode !== "sprint";
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
    $("over").hidden = true;
    $("play").hidden = true;
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
        countStep(performance.now());
        inject(1.1, -Math.PI / 2);
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
