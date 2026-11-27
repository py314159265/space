/* Nightglass. A phone planetarium. Sensors, place, and time stay on the device. */
(function () {
  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;
  const STORE_LOC = "nightglass-loc";
  const STORE_CAL = "nightglass-cal";
  const DEFAULT_LOC = { lat: 34.08, lon: -118.07 };
  const PLANETS = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];
  const CON_NAME = {
    And: "Andromeda", Ant: "Antlia", Aps: "Apus", Aql: "Aquila", Aqr: "Aquarius", Ara: "Ara",
    Ari: "Aries", Aur: "Auriga", Boo: "Boötes", Cae: "Caelum", Cam: "Camelopardalis", Cap: "Capricornus",
    Car: "Carina", Cas: "Cassiopeia", Cen: "Centaurus", Cep: "Cepheus", Cet: "Cetus", Cha: "Chamaeleon",
    Cir: "Circinus", CMa: "Canis Major", CMi: "Canis Minor", Cnc: "Cancer", Col: "Columba", Com: "Coma Berenices",
    CrA: "Corona Australis", CrB: "Corona Borealis", Crt: "Crater", Cru: "Crux", Crv: "Corvus", CVn: "Canes Venatici",
    Cyg: "Cygnus", Del: "Delphinus", Dor: "Dorado", Dra: "Draco", Equ: "Equuleus", Eri: "Eridanus", For: "Fornax",
    Gem: "Gemini", Gru: "Grus", Her: "Hercules", Hor: "Horologium", Hya: "Hydra", Hyi: "Hydrus", Ind: "Indus",
    Lac: "Lacerta", Leo: "Leo", Lep: "Lepus", Lib: "Libra", LMi: "Leo Minor", Lup: "Lupus", Lyn: "Lynx",
    Lyr: "Lyra", Men: "Mensa", Mic: "Microscopium", Mon: "Monoceros", Mus: "Musca", Nor: "Norma", Oct: "Octans",
    Oph: "Ophiuchus", Ori: "Orion", Pav: "Pavo", Peg: "Pegasus", Per: "Perseus", Phe: "Phoenix", Pic: "Pictor",
    PsA: "Piscis Austrinus", Psc: "Pisces", Pup: "Puppis", Pyx: "Pyxis", Ret: "Reticulum", Scl: "Sculptor",
    Sco: "Scorpius", Sct: "Scutum", Ser: "Serpens", Sex: "Sextans", Sge: "Sagitta", Sgr: "Sagittarius",
    Tau: "Taurus", Tel: "Telescopium", TrA: "Triangulum Australe", Tri: "Triangulum", Tuc: "Tucana",
    UMa: "Ursa Major", UMi: "Ursa Minor", Vel: "Vela", Vir: "Virgo", Vol: "Volans", Vul: "Vulpecula",
  };

  const $ = (id) => document.getElementById(id);
  const canvas = $("sky");
  const ctx = canvas.getContext("2d", { alpha: false });
  const params = new URLSearchParams(location.search);

  let stars = [];
  let starByHip = new Map();
  let figures = [];
  let constMeta = {};
  let cons = [];
  let names = {};
  let live = false;
  let night = false;
  let showLines = true;
  let showLabels = true;
  let showGrid = false;
  let calibrating = false;
  let lat = DEFAULT_LOC.lat;
  let lon = DEFAULT_LOC.lon;
  let headingOffset = 0;
  let shiftHours = 0;
  let fov = 68;
  let manualAz = 140 * DEG;
  let manualAlt = 36 * DEG;
  let sensor = null;
  let smoothFwd = null;
  let smoothUp = null;
  let bodies = [];
  let moonPhase = 0;
  let picks = [];
  let selected = null;
  let baseNow = params.get("time") ? new Date(params.get("time")) : null;
  if (baseNow && Number.isNaN(baseNow.getTime())) baseNow = null;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function normAng(rad) {
    const x = rad % (Math.PI * 2);
    return x < 0 ? x + Math.PI * 2 : x;
  }
  function nowDate() {
    const base = baseNow ? baseNow.getTime() : Date.now();
    return new Date(base + shiftHours * 3600000);
  }
  function loadStore() {
    try {
      const loc = JSON.parse(localStorage.getItem(STORE_LOC) || "null");
      if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
        lat = loc.lat; lon = loc.lon;
      }
      const cal = JSON.parse(localStorage.getItem(STORE_CAL) || "null");
      if (cal && Number.isFinite(cal.offset)) headingOffset = cal.offset;
    } catch (err) { /* keep defaults */ }
    $("lat").value = lat.toFixed(2);
    $("lon").value = lon.toFixed(2);
  }
  function saveLoc() {
    localStorage.setItem(STORE_LOC, JSON.stringify({ lat, lon }));
  }
  function saveCal() {
    localStorage.setItem(STORE_CAL, JSON.stringify({ offset: headingOffset }));
  }

  function gmstHours(date) {
    const jd = date.getTime() / 86400000 + 2440587.5;
    let deg = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
    deg = ((deg % 360) + 360) % 360;
    return deg / 15;
  }
  function lstHours(date) {
    return gmstHours(date) + lon / 15;
  }
  function eqToHor(raHours, decDeg, date) {
    const ha = (lstHours(date) - raHours) * 15 * DEG;
    const dec = decDeg * DEG;
    const phi = lat * DEG;
    const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha);
    const alt = Math.asin(clamp(sinAlt, -1, 1));
    const y = -Math.sin(ha);
    const x = Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha);
    let az = Math.atan2(y, x);
    if (az < 0) az += Math.PI * 2;
    return { alt, az };
  }
  function compassName(az) {
    const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return names[Math.round(az / (Math.PI * 2) * 16) % 16];
  }
  function phaseName(deg) {
    const x = ((deg % 360) + 360) % 360;
    if (x < 22.5 || x >= 337.5) return "New";
    if (x < 67.5) return "Waxing crescent";
    if (x < 112.5) return "First quarter";
    if (x < 157.5) return "Waxing gibbous";
    if (x < 202.5) return "Full";
    if (x < 247.5) return "Waning gibbous";
    if (x < 292.5) return "Third quarter";
    return "Waning crescent";
  }

  function screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === "number") return screen.orientation.angle;
    return typeof window.orientation === "number" ? window.orientation : 0;
  }
  function mul(R, v) {
    return [
      R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
      R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
      R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
    ];
  }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function vlen(a) { return Math.hypot(a[0], a[1], a[2]); }
  function vnorm(a) {
    const l = vlen(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }
  function deviceMatrix(alphaDeg, betaDeg, gammaDeg) {
    const z = alphaDeg * DEG, x = betaDeg * DEG, y = gammaDeg * DEG;
    const cX = Math.cos(x), sX = Math.sin(x);
    const cY = Math.cos(y), sY = Math.sin(y);
    const cZ = Math.cos(z), sZ = Math.sin(z);
    return [
      cZ * cY - sZ * sX * sY, -cX * sZ, cY * sZ * sX + cZ * sY,
      cY * sZ + cZ * sX * sY, cZ * cX, sZ * sY - cZ * sX * cY,
      -cX * sY, sX, cX * cY,
    ];
  }
  function screenUpDevice(angle) {
    const a = ((angle % 360) + 360) % 360;
    if (a === 90) return [-1, 0, 0];
    if (a === 180) return [0, -1, 0];
    if (a === 270) return [1, 0, 0];
    return [0, 1, 0];
  }
  function viewFromOrientation(alpha, beta, gamma, angle) {
    const R = deviceMatrix(alpha, beta, gamma);
    const forward = vnorm(mul(R, [0, 0, -1]));
    const upEarth = vnorm(mul(R, screenUpDevice(angle)));
    const az = Math.atan2(forward[0], forward[1]);
    const alt = Math.asin(clamp(forward[2], -1, 1));
    const worldUp = [0, 0, 1];
    let right = cross(forward, worldUp);
    if (vlen(right) < 0.15) right = [Math.cos(az), -Math.sin(az), 0];
    right = vnorm(right);
    const camUp = vnorm(cross(right, forward));
    const su = vnorm([
      upEarth[0] - forward[0] * dot(upEarth, forward),
      upEarth[1] - forward[1] * dot(upEarth, forward),
      upEarth[2] - forward[2] * dot(upEarth, forward),
    ]);
    const roll = Math.atan2(dot(su, right), dot(su, camUp));
    return { az: normAng(az), alt, roll, forward, up: upEarth };
  }

  function onOrient(event) {
    if (!live) return;
    let alpha = event.alpha;
    if (typeof event.webkitCompassHeading === "number" && !Number.isNaN(event.webkitCompassHeading)) {
      alpha = 360 - event.webkitCompassHeading;
    }
    if (alpha == null || event.beta == null || event.gamma == null) return;
    sensor = viewFromOrientation(alpha, event.beta, event.gamma, screenAngle());
  }

  async function startLive() {
    try {
      if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        const state = await DeviceOrientationEvent.requestPermission();
        if (state !== "granted") { startManual(); return; }
      }
    } catch (err) { /* desktop browsers have no permission gate */ }
    await askPlace();
    live = true;
    openStage();
  }
  function startManual() {
    live = false;
    askPlace();
    openStage();
  }
  function askPlace() {
    if (!navigator.geolocation) { $("place").hidden = false; return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      lat = pos.coords.latitude;
      lon = pos.coords.longitude;
      saveLoc();
      refreshBodies();
    }, () => { $("place").hidden = false; }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
  }
  function openStage() {
    $("gate").hidden = true;
    $("stage").hidden = false;
    resize();
    refreshBodies();
  }

  function refreshBodies() {
    if (!window.Astronomy) return;
    const when = nowDate();
    const time = Astronomy.MakeTime(when);
    const obs = new Astronomy.Observer(lat, lon, 0);
    const next = [];
    const add = (name, type, ra, dec, extra) => {
      next.push(Object.assign({ name, type, ra, dec }, extra));
    };
    try {
      const sun = Astronomy.Equator("Sun", time, obs, true, true);
      add("Sun", "Star", sun.ra, sun.dec, { mag: -26.7, kind: "sun" });
      const moon = Astronomy.Equator("Moon", time, obs, true, true);
      moonPhase = Astronomy.MoonPhase(time);
      const mill = Astronomy.Illumination("Moon", time);
      const mvec = Astronomy.GeoMoon(time);
      add("Moon", "Moon", moon.ra, moon.dec, {
        mag: mill.mag, kind: "moon", phase: moonPhase,
        distAu: mvec.Length(),
      });
      for (const name of PLANETS) {
        const eq = Astronomy.Equator(name, time, obs, true, true);
        const ill = Astronomy.Illumination(name, time);
        const vec = Astronomy.GeoVector(name, time, true);
        add(name, "Planet", eq.ra, eq.dec, { mag: ill.mag, kind: "planet", distAu: vec.Length() });
      }
    } catch (err) {
      console.warn(err);
    }
    bodies = next;
  }

  function horOf(ra, dec) {
    return eqToHor(ra, dec, nowDate());
  }

  let w = 1, h = 1, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function cameraPose() {
    if (live && sensor) {
      let fwd = sensor.forward;
      let up = sensor.up;
      if (!smoothFwd) { smoothFwd = fwd.slice(); smoothUp = up.slice(); }
      else {
        const k = 0.18;
        smoothFwd = vnorm(smoothFwd.map((v, i) => v * (1 - k) + fwd[i] * k));
        smoothUp = vnorm(smoothUp.map((v, i) => v * (1 - k) + up[i] * k));
      }
      const az = normAng(Math.atan2(smoothFwd[0], smoothFwd[1]) + headingOffset);
      const alt = Math.asin(clamp(smoothFwd[2], -1, 1));
      const worldUp = [0, 0, 1];
      let right = cross(smoothFwd, worldUp);
      if (vlen(right) < 0.15) right = [Math.cos(az), -Math.sin(az), 0];
      right = vnorm(right);
      const camUp = vnorm(cross(right, smoothFwd));
      const su = vnorm([
        smoothUp[0] - smoothFwd[0] * dot(smoothUp, smoothFwd),
        smoothUp[1] - smoothFwd[1] * dot(smoothUp, smoothFwd),
        smoothUp[2] - smoothFwd[2] * dot(smoothUp, smoothFwd),
      ]);
      const roll = Math.atan2(dot(su, right), dot(su, camUp));
      return { az, alt, roll };
    }
    return { az: manualAz, alt: manualAlt, roll: 0 };
  }

  function project(az, alt, pose) {
    const east = Math.cos(alt) * Math.sin(az);
    const north = Math.cos(alt) * Math.cos(az);
    const up = Math.sin(alt);
    const faz = pose.az, falt = pose.alt;
    const fe = Math.cos(falt) * Math.sin(faz);
    const fn = Math.cos(falt) * Math.cos(faz);
    const fu = Math.sin(falt);
    let right = cross([fe, fn, fu], [0, 0, 1]);
    if (vlen(right) < 0.12) right = [Math.cos(faz), -Math.sin(faz), 0];
    right = vnorm(right);
    const camUp = vnorm(cross(right, [fe, fn, fu]));
    const v = [east, north, up];
    let x = dot(v, right);
    let y = dot(v, camUp);
    const z = dot(v, [fe, fn, fu]);
    if (pose.roll) {
      const c = Math.cos(pose.roll), s = Math.sin(pose.roll);
      const xr = x * c - y * s;
      const yr = x * s + y * c;
      x = xr; y = yr;
    }
    if (z < 0.05) return null;
    const f = (h / 2) / Math.tan((fov * DEG) / 2);
    return { x: w / 2 + (x / z) * f, y: h / 2 - (y / z) * f, z };
  }

  function starColor(bv) {
    if (night) return "#ff2a2a";
    if (bv < 0) return "#b9ccff";
    if (bv < 0.3) return "#e7eeff";
    if (bv < 0.6) return "#fff6e8";
    if (bv < 1.0) return "#ffd7a8";
    return "#ffb07a";
  }
  function ink() { return night ? "#ff3b3b" : "#f4efe4"; }
  function gold() { return night ? "#ff2a2a" : "#d7b56a"; }
  function lineColor() { return night ? "rgba(255,50,50,0.55)" : "rgba(201,168,106,0.45)"; }

  function drawHorizon(pose) {
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= 72; i++) {
      const az = i / 72 * Math.PI * 2;
      const p = project(az, 0, pose);
      if (!p) { started = false; continue; }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = night ? "rgba(255,40,40,0.45)" : "rgba(215,181,106,0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();
    const glow = ctx.createLinearGradient(0, h * 0.45, 0, h);
    glow.addColorStop(0, "rgba(0,0,0,0)");
    glow.addColorStop(1, night ? "rgba(80,0,0,0.35)" : "rgba(40,32,18,0.45)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);
    ctx.font = "600 13px Source Sans 3, sans-serif";
    ctx.fillStyle = gold();
    ctx.textAlign = "center";
    for (const [az, label] of [[0, "N"], [90, "E"], [180, "S"], [270, "W"]]) {
      const p = project(az * DEG, 2 * DEG, pose);
      if (!p || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) continue;
      ctx.fillText(label, p.x, p.y);
    }
  }

  function drawGrid(pose) {
    ctx.strokeStyle = night ? "rgba(255,60,60,0.28)" : "rgba(180,196,220,0.22)";
    ctx.lineWidth = 1;
    for (let alt = -60; alt <= 75; alt += 15) {
      ctx.beginPath();
      let on = false;
      for (let i = 0; i <= 72; i++) {
        const p = project(i / 72 * Math.PI * 2, alt * DEG, pose);
        if (!p) { on = false; continue; }
        if (!on) { ctx.moveTo(p.x, p.y); on = true; }
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    for (let az = 0; az < 360; az += 30) {
      ctx.beginPath();
      let on = false;
      for (let alt = -10; alt <= 88; alt += 4) {
        const p = project(az * DEG, alt * DEG, pose);
        if (!p) { on = false; continue; }
        if (!on) { ctx.moveTo(p.x, p.y); on = true; }
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }

  const labelBoxes = [];
  function placeLabel(text, x, y, style) {
    if (!showLabels) return;
    ctx.font = style.font;
    const tw = ctx.measureText(text).width;
    const box = { x: x - tw / 2, y: y - 10, w: tw + 6, h: 14 };
    if (labelBoxes.some((b) => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y)) return;
    labelBoxes.push(box);
    ctx.fillStyle = style.color;
    ctx.textAlign = "center";
    ctx.fillText(text, x, y);
  }

  function drawMoon(x, y, r, phase) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = night ? "#ff4a4a" : "#f3efe4";
    ctx.fill();
    ctx.clip();
    const ang = ((phase % 360) + 360) % 360;
    const waxing = ang < 180;
    const local = ang <= 180 ? ang : 360 - ang;
    const k = Math.cos(local * DEG);
    ctx.beginPath();
    ctx.ellipse(x, y, Math.abs(k) * r, r, 0, 0, Math.PI * 2);
    ctx.fillStyle = night ? "#3a0000" : "#1b2433";
    if (waxing) ctx.fill();
    else {
      ctx.fillRect(x - r - 2, y - r - 2, r * 2 + 4, r * 2 + 4);
      ctx.fillStyle = night ? "#ff4a4a" : "#f3efe4";
      ctx.beginPath();
      ctx.ellipse(x, y, Math.abs(k) * r, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function frame() {
    const pose = cameraPose();
    const when = nowDate();
    picks = [];
    labelBoxes.length = 0;
    ctx.fillStyle = night ? "#120000" : "#070b12";
    ctx.fillRect(0, 0, w, h);
    const sky = ctx.createRadialGradient(w * 0.5, h * 0.42, 20, w * 0.5, h * 0.45, Math.max(w, h) * 0.7);
    sky.addColorStop(0, night ? "#2a0000" : "#121a2c");
    sky.addColorStop(1, night ? "#120000" : "#070b12");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    drawHorizon(pose);
    if (showGrid) drawGrid(pose);

    const hipPos = new Map();
    for (const s of stars) {
      const hor = eqToHor(s.ra, s.dec, when);
      if (hor.alt < -2 * DEG) continue;
      const p = project(hor.az, hor.alt, pose);
      if (!p) continue;
      hipPos.set(s.hip, p);
      const radius = Math.max(0.6, (4.6 - s.mag) * 0.55);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = starColor(s.bv);
      ctx.globalAlpha = s.mag > 4.2 ? 0.75 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (s.mag <= 2.1) picks.push({ x: p.x, y: p.y, kind: "star", star: s, hor });
    }

    for (const fig of figures) {
      const spot = figureSpot(fig, hipPos);
      if (spot) picks.push({ x: spot.x, y: spot.y, kind: "fig", fig, hor: spot.hor });
    }

    if (showLines) {
      ctx.strokeStyle = lineColor();
      ctx.lineWidth = 1;
      for (const fig of figures) {
        ctx.beginPath();
        for (const [a, b] of fig.lines) {
          const pa = hipPos.get(a), pb = hipPos.get(b);
          if (!pa || !pb) continue;
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
        }
        ctx.stroke();
      }
    }

    if (showLabels) {
      ctx.letterSpacing = "0.14em";
      ctx.font = "600 11px Source Sans 3, sans-serif";
      for (const fig of figures) {
        let sx = 0, sy = 0, n = 0;
        if (fig.hip) {
          const p = hipPos.get(fig.hip);
          if (p) { sx = p.x; sy = p.y; n = 1; }
        }
        const seen = new Set();
        for (const pair of fig.lines) {
          for (const hip of pair) {
            if (seen.has(hip)) continue;
            seen.add(hip);
            const p = hipPos.get(hip);
            if (!p) continue;
            sx += p.x; sy += p.y; n++;
          }
        }
        if (!n) continue;
        placeLabel(fig.name.toUpperCase(), sx / n, sy / n - 14, {
          font: "600 11px Source Sans 3, sans-serif",
          color: night ? "rgba(255,80,80,0.85)" : "rgba(215,181,106,0.8)",
        });
      }
      ctx.letterSpacing = "0px";
      ctx.font = "500 13px Source Sans 3, sans-serif";
      for (const s of stars) {
        if (s.mag > 1.6 || !names[s.hip]) continue;
        const p = hipPos.get(s.hip);
        if (!p) continue;
        placeLabel(names[s.hip], p.x, p.y - 12, { font: "500 13px Source Sans 3, sans-serif", color: ink() });
      }
    }

    for (const body of bodies) {
      const hor = eqToHor(body.ra, body.dec, when);
      body.hor = hor;
      if (hor.alt < -3 * DEG) continue;
      const p = project(hor.az, hor.alt, pose);
      if (!p) continue;
      body.screen = p;
      if (body.kind === "moon") {
        drawMoon(p.x, p.y, Math.max(6, 9 * (68 / fov)), moonPhase);
      } else if (body.kind === "sun") {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 11 * (68 / fov), 0, Math.PI * 2);
        ctx.fillStyle = night ? "#ff2020" : "#ffe3a4";
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.1, 0, Math.PI * 2);
        ctx.fillStyle = night ? "#ff4040" : (body.name === "Saturn" ? "#e6d2a2" : "#f7f1e6");
        ctx.fill();
      }
      picks.push({ x: p.x, y: p.y, kind: "body", body, hor });
      if (showLabels) {
        ctx.letterSpacing = "0px";
        placeLabel(body.name, p.x, p.y - 14, { font: "600 13px Source Sans 3, sans-serif", color: ink() });
      }
    }

    ctx.strokeStyle = night ? "rgba(255,60,60,0.7)" : "rgba(244,239,228,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 14, 0, Math.PI * 2);
    ctx.moveTo(w / 2 - 22, h / 2); ctx.lineTo(w / 2 - 8, h / 2);
    ctx.moveTo(w / 2 + 8, h / 2); ctx.lineTo(w / 2 + 22, h / 2);
    ctx.moveTo(w / 2, h / 2 - 22); ctx.lineTo(w / 2, h / 2 - 8);
    ctx.moveTo(w / 2, h / 2 + 8); ctx.lineTo(w / 2, h / 2 + 22);
    ctx.stroke();

    const azDeg = pose.az * RAD;
    $("hud").textContent = `● ${compassName(pose.az)} ${Math.round(azDeg)}° · Alt ${Math.round(pose.alt * RAD)}°`;
    $("when").textContent = when.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

    window.__sky = {
      ready: stars.length > 0,
      when: when.toISOString(),
      lat, lon, live, night,
      view: { az: azDeg, alt: pose.alt * RAD, fov },
      moonPhase,
      phase: phaseName(moonPhase),
      bodies: Object.fromEntries(bodies.filter((b) => b.hor).map((b) => [b.name, {
        alt: b.hor.alt * RAD,
        az: b.hor.az * RAD,
        ra: b.ra,
        dec: b.dec,
      }])),
      picks: picks.filter((p) => p.kind === "body" || p.kind === "star" || p.kind === "fig").map((p) => ({
        kind: p.kind,
        name: p.kind === "body" ? p.body.name : p.kind === "star" ? (names[p.star.hip] || `HIP ${p.star.hip}`) : p.fig.name,
        x: p.x,
        y: p.y,
      })),
      visible: figures.filter((fig) => {
        if (fig.hip && hipPos.has(fig.hip)) return true;
        return fig.lines.some(([a, b]) => hipPos.has(a) && hipPos.has(b));
      }).map((fig) => fig.name),
    };
    requestAnimationFrame(frame);
  }

  function nearestPick(x, y, limit) {
    let best = null, bestD = limit;
    for (const p of picks) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { best = p; bestD = d; }
    }
    return best;
  }

  function fmtHours(date) {
    if (!date) return "—";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  function auText(au) {
    if (au == null) return "—";
    if (au < 0.01) return `${Math.round(au * 149597870.7).toLocaleString("en-US")} km`;
    return `${au.toFixed(2)} AU`;
  }
  function whenLst(hours, date) {
    const target = ((hours % 24) + 24) % 24;
    const lst = lstHours(date);
    let wait = ((target - lst) % 24 + 24) % 24;
    return new Date(date.getTime() + wait * 0.99726958 * 3600000);
  }
  function dayEvents(raHours, decDeg, date) {
    const cosH = -Math.tan(lat * DEG) * Math.tan(decDeg * DEG);
    const transit = whenLst(raHours, date);
    if (cosH <= -1) return { rise: null, set: null, transit };
    if (cosH >= 1) return { rise: null, set: null, transit: null };
    const H = Math.acos(clamp(cosH, -1, 1)) * RAD / 15;
    return { rise: whenLst(raHours - H, date), set: whenLst(raHours + H, date), transit };
  }
  function wikiHref(query) {
    return `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(query)}`;
  }
  function setWiki(query) {
    const link = $("sheet-wiki");
    link.href = wikiHref(query);
    $("sheet-more").hidden = false;
  }
  function setNote(text) {
    const note = $("sheet-note");
    note.hidden = !text;
    note.textContent = text || "";
  }
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function eveningSpan(raHours) {
    const sun = (raHours - 9 + 24) % 24;
    const idx = (2 + Math.round(sun / 2)) % 12;
    const prev = (idx + 11) % 12;
    return `${MONTHS[prev]} and ${MONTHS[idx]}`;
  }
  function figureMembers(id) {
    return stars.filter((s) => s.con >= 0 && cons[s.con] === id);
  }
  function figureCenter(id) {
    const members = figureMembers(id);
    if (!members.length) {
      const meta = constMeta[id];
      return meta && meta.ra != null ? { ra: meta.ra, dec: meta.dec } : null;
    }
    let x = 0, y = 0, z = 0;
    for (const s of members) {
      const ra = s.ra * 15 * DEG;
      const dec = s.dec * DEG;
      x += Math.cos(dec) * Math.cos(ra);
      y += Math.cos(dec) * Math.sin(ra);
      z += Math.sin(dec);
    }
    const dec = Math.asin(clamp(z / members.length, -1, 1)) * RAD;
    let ra = Math.atan2(y, x) * RAD / 15;
    if (ra < 0) ra += 24;
    return { ra, dec };
  }
  function figureSpot(fig, hipPos) {
    let sx = 0, sy = 0, n = 0;
    if (fig.hip && hipPos.has(fig.hip)) {
      const p = hipPos.get(fig.hip);
      sx = p.x; sy = p.y; n = 1;
    }
    const seen = new Set();
    for (const pair of fig.lines) {
      for (const hip of pair) {
        if (seen.has(hip)) continue;
        seen.add(hip);
        const p = hipPos.get(hip);
        if (!p) continue;
        sx += p.x; sy += p.y; n++;
      }
    }
    if (!n) return null;
    const center = figureCenter(fig.id);
    const when = nowDate();
    const hor = center ? eqToHor(center.ra, center.dec, when) : null;
    return { x: sx / n, y: sy / n, hor };
  }
  function viewingLine(dec, ra) {
    const band = dec > 30 ? "Northern" : dec < -30 ? "Southern" : "Equatorial";
    const months = eveningSpan(ra);
    let reach = "";
    if (Number.isFinite(lat)) {
      const culmination = 90 - Math.abs(lat - dec);
      if (culmination < 12) reach = " From your latitude it stays low or hidden.";
      else if ((lat >= 0 && dec > 0) || (lat < 0 && dec < 0)) reach = " It stands high in your sky then.";
      else reach = " It stays toward the far horizon from your latitude.";
    }
    return `${band} figure. Best in the evening in ${months}.${reach}`;
  }
  function fillConstellation(fig) {
    const meta = constMeta[fig.id];
    const pleiades = fig.id === "Ple";
    const center = figureCenter(pleiades ? "Tau" : fig.id) || { ra: 3.8, dec: 24 };
    const when = nowDate();
    const hor = eqToHor(center.ra, center.dec, when);
    const events = dayEvents(center.ra, center.dec, when);
    const bright = figureMembers(pleiades ? "Tau" : fig.id).sort((a, b) => a.mag - b.mag).slice(0, 5);
    const brightText = bright.length
      ? bright.map((s) => `${names[s.hip] || "HIP " + s.hip} ${s.mag.toFixed(2)}`).join(", ")
      : "None in this bright-star list";
    $("sheet-type").textContent = pleiades ? "Star cluster" : `${fig.id} · constellation`;
    $("sheet-name").textContent = pleiades ? "Pleiades" : meta.name;
    const rows = pleiades
      ? [
          ["In", "Taurus"],
          ["Meaning", "A tight cluster of young stars"],
          ["Where", viewingLine(center.dec, center.ra)],
          ["Transits", fmtHours(events.transit)],
        ]
      : [
          ["Genitive", meta.genitive],
          ["Meaning", meta.meaning],
          ["Area rank", `${meta.rank} of 88`],
          ["Where", viewingLine(center.dec, center.ra)],
          ["Brightest", brightText],
          ["Deep sky", meta.deep.length ? meta.deep.join("; ") : "—"],
          ["Altitude", `${(hor.alt * RAD).toFixed(0)}°`],
          ["Transits", fmtHours(events.transit)],
        ];
    const dl = $("sheet-facts");
    dl.replaceChildren();
    for (const [k, v] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      dl.append(dt, dd);
    }
    setNote(pleiades
      ? "A handful of hot stars still wrapped in the haze of the cloud they formed in, sitting on the bull's shoulder."
      : meta.note);
    setWiki(pleiades ? "Pleiades" : `${meta.name} constellation`);
    $("sheet").hidden = false;
  }
  async function openSheet(item) {
    if (item.kind === "fig") {
      selected = item;
      fillConstellation(item.fig);
      return;
    }
    selected = item;
    const when = nowDate();
    let name, type, con, mag, hor, dist, phase, ra, dec;
    if (item.kind === "star") {
      const s = item.star;
      name = names[s.hip] || `HIP ${s.hip}`;
      type = "Star";
      con = s.con >= 0 ? (CON_NAME[cons[s.con]] || cons[s.con]) : "—";
      mag = s.mag.toFixed(2);
      hor = item.hor;
      ra = s.ra;
      dec = s.dec;
      dist = s.ly ? `${Math.round(s.ly).toLocaleString("en-US")} ly` : "—";
    } else {
      const b = item.body;
      name = b.name;
      type = b.type;
      con = "—";
      mag = b.mag != null && b.kind !== "sun" ? b.mag.toFixed(1) : "—";
      hor = b.hor;
      ra = b.ra;
      dec = b.dec;
      dist = auText(b.distAu);
      if (b.kind === "moon") phase = phaseName(moonPhase);
    }
    const events = dayEvents(ra, dec, when);
    $("sheet-type").textContent = type;
    $("sheet-name").textContent = name;
    const rows = [
      ["Type", type],
      ["Constellation", con || "—"],
      ["Magnitude", mag],
      ["Altitude", `${(hor.alt * RAD).toFixed(0)}°`],
      ["Azimuth", `${compassName(hor.az)} ${(hor.az * RAD).toFixed(0)}°`],
      ["Rises", fmtHours(events.rise)],
      ["Transits", fmtHours(events.transit)],
      ["Sets", fmtHours(events.set)],
      ["Distance", dist || "—"],
    ];
    if (phase) rows.push(["Phase", phase]);
    setNote("");
    if (item.kind === "star") setWiki(name);
    else $("sheet-more").hidden = true;
    const dl = $("sheet-facts");
    dl.replaceChildren();
    for (const [k, v] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      dl.append(dt, dd);
    }
    $("sheet").hidden = false;
  }

  function pointerXY(event) {
    const r = canvas.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  }
  const pointers = new Map();
  let drag = null;
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, pointerXY(event));
    drag = { x: event.clientX, y: event.clientY, az: manualAz, alt: manualAlt, moved: false };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, pointerXY(event));
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (drag.pinch) fov = clamp(fov * (drag.pinch / dist), 28, 100);
      drag.pinch = dist;
      drag.moved = true;
      return;
    }
    if (!drag || live) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (dx * dx + dy * dy > 16) drag.moved = true;
    const fovH = fov * (w / Math.max(h, 1));
    manualAz = normAng(drag.az - dx / w * fovH * DEG);
    manualAlt = clamp(drag.alt + dy / h * fov * DEG, -5 * DEG, 89 * DEG);
  });
  function endPointer(event) {
    pointers.delete(event.pointerId);
    if (pointers.size === 0 && drag && !drag.moved) {
      const pt = pointerXY(event);
      const hit = nearestPick(pt.x, pt.y, 48);
      if (hit && calibrating && hit.hor) {
        const pose = cameraPose();
        const sensorAz = live && sensor ? normAng(Math.atan2(sensor.forward[0], sensor.forward[1])) : pose.az - headingOffset;
        headingOffset = normAng(hit.hor.az - sensorAz);
        if (headingOffset > Math.PI) headingOffset -= Math.PI * 2;
        saveCal();
        calibrating = false;
        $("banner").hidden = true;
        document.querySelector('[data-key="cal"]').setAttribute("aria-pressed", "false");
      } else if (hit) openSheet(hit);
      else $("sheet").hidden = true;
    }
    if (pointers.size === 0) drag = null;
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    fov = clamp(fov * (event.deltaY > 0 ? 1.06 : 0.94), 28, 100);
  }, { passive: false });

  function bind() {
    $("go-live").addEventListener("click", startLive);
    $("go-manual").addEventListener("click", startManual);
    $("place").addEventListener("submit", (event) => {
      event.preventDefault();
      lat = clamp(Number($("lat").value), -90, 90);
      lon = clamp(Number($("lon").value), -180, 180);
      saveLoc();
      $("place").hidden = true;
      refreshBodies();
    });
    $("now").addEventListener("click", () => {
      shiftHours = 0;
      $("scrub").value = "0";
      refreshBodies();
    });
    $("scrub").addEventListener("input", () => {
      shiftHours = Number($("scrub").value);
      refreshBodies();
    });
    $("sheet-close").addEventListener("click", () => { $("sheet").hidden = true; });
    const findQ = $("find-q");
    const findList = $("find-list");
    findQ.addEventListener("input", () => renderSearch(findQ.value));
    findList.addEventListener("click", (event) => {
      const btn = event.target.closest("button");
      if (!btn) return;
      const kind = btn.dataset.kind;
      if (kind === "fig") {
        const fig = figures.find((f) => f.id === btn.dataset.id);
        if (fig) openSheet({ kind: "fig", fig });
      } else if (kind === "star") {
        const star = starByHip.get(Number(btn.dataset.hip));
        if (star) {
          const hor = eqToHor(star.ra, star.dec, nowDate());
          openSheet({ kind: "star", star, hor });
        }
      }
      findList.hidden = true;
      findQ.value = "";
    });
    document.querySelectorAll(".toggles button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.key;
        const on = btn.getAttribute("aria-pressed") !== "true";
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        if (key === "lines") showLines = on;
        if (key === "labels") showLabels = on;
        if (key === "grid") showGrid = on;
        if (key === "night") { night = on; document.body.classList.toggle("night", on); }
        if (key === "cal") {
          calibrating = on;
          $("banner").hidden = !on;
        }
      });
    });
    window.addEventListener("resize", resize);
    window.addEventListener("deviceorientationabsolute", onOrient);
    window.addEventListener("deviceorientation", (event) => {
      if (typeof event.webkitCompassHeading === "number" || !sensor) onOrient(event);
    });
  }

  function renderSearch(raw) {
    const list = $("find-list");
    const q = raw.trim().toLowerCase();
    list.replaceChildren();
    if (q.length < 1) { list.hidden = true; return; }
    const hits = [];
    for (const [id, meta] of Object.entries(constMeta)) {
      const hay = `${meta.name} ${id} ${meta.genitive} ${meta.meaning}`.toLowerCase();
      if (hay.includes(q)) hits.push({ kind: "fig", id, label: meta.name, note: meta.meaning });
    }
    if (q.length >= 3 && ("pleiades".startsWith(q) || "seven sisters".includes(q))) {
      hits.push({ kind: "fig", id: "Ple", label: "Pleiades", note: "Cluster in Taurus" });
    }
    for (const s of stars) {
      const name = names[s.hip];
      if (!name || s.mag > 3) continue;
      if (name.toLowerCase().includes(q)) hits.push({ kind: "star", hip: s.hip, label: name, note: `Magnitude ${s.mag.toFixed(2)}` });
    }
    for (const hit of hits.slice(0, 8)) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.kind = hit.kind;
      if (hit.id) btn.dataset.id = hit.id;
      if (hit.hip) btn.dataset.hip = String(hit.hip);
      btn.textContent = `${hit.label} — ${hit.note}`;
      li.append(btn);
      list.append(li);
    }
    list.hidden = list.childElementCount === 0;
  }
  async function boot() {
    loadStore();
    resize();
    bind();
    const [starFile, figFile, conFile] = await Promise.all([
      fetch("data/stars.json").then((r) => r.json()),
      fetch("data/figures.json").then((r) => r.json()),
      fetch("data/constellations.json").then((r) => r.json()),
    ]);
    constMeta = conFile;
    cons = starFile.con;
    names = starFile.names || {};
    stars = starFile.s.map((row) => ({ ra: row[0], dec: row[1], mag: row[2], bv: row[3], hip: row[4], con: row[5], ly: row[6] || 0 }));
    starByHip = new Map(stars.map((s) => [s.hip, s]));
    figures = figFile;
    refreshBodies();
    requestAnimationFrame(frame);
  }
  boot();
})();
