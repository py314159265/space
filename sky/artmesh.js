/* Pin a figure to the sky, then project it with the same camera as the stars.
   A screen-space fit blows up when an anchor leaves the view. */
(function (root) {
  const DEG = Math.PI / 180;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function solveSimilarity(src, dst) {
    if (src.length < 3) return null;
    let mx = 0, my = 0, mu = 0, mv = 0;
    for (let i = 0; i < src.length; i++) {
      mx += src[i].x; my += src[i].y; mu += dst[i].x; mv += dst[i].y;
    }
    const n = src.length;
    mx /= n; my /= n; mu /= n; mv /= n;
    let varxy = 0, aNum = 0, bNum = 0;
    for (let i = 0; i < src.length; i++) {
      const x = src[i].x - mx, y = src[i].y - my;
      const u = dst[i].x - mu, v = dst[i].y - mv;
      varxy += x * x + y * y;
      aNum += x * u + y * v;
      bNum += x * v - y * u;
    }
    if (varxy < 1e-8) return null;
    const a = aNum / varxy;
    const b = bNum / varxy;
    return [a, b, mu - (a * mx - b * my), mv - (b * mx + a * my)];
  }

  function solveAffine(src, dst) {
    const x1 = src[0].x, y1 = src[0].y, x2 = src[1].x, y2 = src[1].y, x3 = src[2].x, y3 = src[2].y;
    const den = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2);
    if (Math.abs(den) < 1e-6) return null;
    function row(u1, u2, u3) {
      return [
        (u1 * (y2 - y3) + u2 * (y3 - y1) + u3 * (y1 - y2)) / den,
        (u1 * (x3 - x2) + u2 * (x1 - x3) + u3 * (x2 - x1)) / den,
        (u1 * (x2 * y3 - x3 * y2) + u2 * (x3 * y1 - x1 * y3) + u3 * (x1 * y2 - x2 * y1)) / den,
      ];
    }
    const sx = row(dst[0].x, dst[1].x, dst[2].x);
    const sy = row(dst[0].y, dst[1].y, dst[2].y);
    return { a: sx[0], c: sx[1], e: sx[2], b: sy[0], d: sy[1], f: sy[2] };
  }

  function meanRaDec(pts) {
    let x = 0, y = 0, z = 0;
    for (const p of pts) {
      const ra = p.ra * 15 * DEG;
      const dec = p.dec * DEG;
      const c = Math.cos(dec);
      x += c * Math.cos(ra);
      y += c * Math.sin(ra);
      z += Math.sin(dec);
    }
    const dec0 = Math.atan2(z, Math.hypot(x, y)) / DEG;
    let ra0 = Math.atan2(y, x) / DEG / 15;
    if (ra0 < 0) ra0 += 24;
    return { ra0, dec0 };
  }

  function gnomonic(raHours, decDeg, ra0, dec0) {
    let dra = (raHours - ra0) * 15 * DEG;
    dra = Math.atan2(Math.sin(dra), Math.cos(dra));
    const dec = decDeg * DEG;
    const d0 = dec0 * DEG;
    const cosc = Math.sin(d0) * Math.sin(dec) + Math.cos(d0) * Math.cos(dec) * Math.cos(dra);
    if (cosc <= 1e-4) return null;
    return {
      x: Math.cos(dec) * Math.sin(dra) / cosc,
      y: (Math.cos(d0) * Math.sin(dec) - Math.sin(d0) * Math.cos(dec) * Math.cos(dra)) / cosc,
    };
  }

  function invGnomonic(x, y, ra0, dec0) {
    const d0 = dec0 * DEG;
    const rho = Math.hypot(x, y);
    if (rho < 1e-12) return { ra: ra0, dec: dec0 };
    const c = Math.atan(rho);
    const sinC = Math.sin(c);
    const cosC = Math.cos(c);
    const dec = Math.asin(clamp(cosC * Math.sin(d0) + (y * sinC * Math.cos(d0)) / rho, -1, 1));
    const dra = Math.atan2(
      x * sinC,
      rho * Math.cos(d0) * cosC - y * Math.sin(d0) * sinC,
    );
    let ra = ra0 + (dra / DEG) / 15;
    ra = ((ra % 24) + 24) % 24;
    return { ra, dec: dec / DEG };
  }

  function applySim(sim, u, v) {
    const [a, b, tx, ty] = sim;
    return { x: a * u - b * v + tx, y: b * u + a * v + ty };
  }

  function imageToSky(fit, u, v) {
    const p = applySim(fit.sim, u, v);
    return invGnomonic(p.x, p.y, fit.ra0, fit.dec0);
  }

  function prepare(meta, lookup) {
    const anchors = [];
    for (const a of meta.anchors) {
      const s = lookup(a.hip);
      if (!s) continue;
      anchors.push({ hip: a.hip, u: a.x, v: a.y, ra: s.ra, dec: s.dec });
    }
    if (anchors.length < 3) return null;
    const { ra0, dec0 } = meanRaDec(anchors);
    const src = [];
    const dst = [];
    for (const a of anchors) {
      const g = gnomonic(a.ra, a.dec, ra0, dec0);
      if (!g) return null;
      src.push({ x: a.u, y: a.v });
      dst.push(g);
    }
    const sim = solveSimilarity(src, dst);
    if (!sim) return null;
    const n = 8;
    const cols = n + 1;
    const verts = [];
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const u = (i / n) * meta.w;
        const v = (j / n) * meta.h;
        const sky = imageToSky({ sim, ra0, dec0 }, u, v);
        verts.push({ u, v, ra: sky.ra, dec: sky.dec });
      }
    }
    return { sim, ra0, dec0, w: meta.w, h: meta.h, anchors, verts, cols, n };
  }

  function gmstHours(date) {
    const jd = date.getTime() / 86400000 + 2440587.5;
    let deg = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
    deg = ((deg % 360) + 360) % 360;
    return deg / 15;
  }

  function eqToHor(raHours, decDeg, lat, lon, date) {
    const lst = gmstHours(date) + lon / 15;
    const ha = (lst - raHours) * 15 * DEG;
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

  function project(az, alt, pose, view) {
    const east = Math.cos(alt) * Math.sin(az);
    const north = Math.cos(alt) * Math.cos(az);
    const up = Math.sin(alt);
    const faz = pose.az, falt = pose.alt;
    const fe = Math.cos(falt) * Math.sin(faz);
    const fn = Math.cos(falt) * Math.cos(faz);
    const fu = Math.sin(falt);
    let right = [fn, -fe, 0];
    const rlen = Math.hypot(right[0], right[1], right[2]);
    if (rlen < 0.12) right = [Math.cos(faz), -Math.sin(faz), 0];
    else right = [right[0] / rlen, right[1] / rlen, 0];
    let camUp = [
      right[1] * fu - right[2] * fn,
      right[2] * fe - right[0] * fu,
      right[0] * fn - right[1] * fe,
    ];
    const ulen = Math.hypot(camUp[0], camUp[1], camUp[2]) || 1;
    camUp = camUp.map((v) => v / ulen);
    const vec = [east, north, up];
    let x = vec[0] * right[0] + vec[1] * right[1] + vec[2] * right[2];
    let y = vec[0] * camUp[0] + vec[1] * camUp[1] + vec[2] * camUp[2];
    const z = vec[0] * fe + vec[1] * fn + vec[2] * fu;
    if (pose.roll) {
      const c = Math.cos(pose.roll), s = Math.sin(pose.roll);
      const xr = x * c - y * s;
      const yr = x * s + y * c;
      x = xr; y = yr;
    }
    if (z < 0.05) return null;
    const f = (view.h / 2) / Math.tan((view.fov * DEG) / 2);
    return { x: view.w / 2 + (x / z) * f, y: view.h / 2 - (y / z) * f, z };
  }

  function figureAlpha(meanAltDeg, fovDeg, night) {
    if (!(meanAltDeg > 0)) return 0;
    const horizon = Math.min(1, meanAltDeg / 8);
    const wide = clamp((108 - fovDeg) / 40, 0.55, 1);
    return (night ? 0.18 : 0.20) * horizon * wide;
  }

  function anchorSky(fit, anchor) {
    return imageToSky(fit, anchor.u, anchor.v);
  }

  root.ArtMesh = {
    solveSimilarity, solveAffine, gnomonic, invGnomonic, prepare, imageToSky,
    applySim, eqToHor, project, figureAlpha, anchorSky, gmstHours,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
