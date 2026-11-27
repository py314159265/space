/* Phone orientation to a sky azimuth and altitude. */
(function (root) {
  const DEG = Math.PI / 180;

  function normDeg(d) {
    d %= 360;
    return d < 0 ? d + 360 : d;
  }
  function circDiff(a, b) {
    return ((a - b + 540) % 360) - 180;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function deviceMatrix(alphaDeg, betaDeg, gammaDeg) {
    const z = alphaDeg * DEG, x = betaDeg * DEG, y = gammaDeg * DEG;
    const cX = Math.cos(x), sX = Math.sin(x);
    const cY = Math.cos(y), sY = Math.sin(y);
    const cZ = Math.cos(z), sZ = Math.sin(z);
    return [
      cZ * cY - sZ * sX * sY, -cX * sZ, cZ * sY + sZ * sX * cY,
      cY * sZ + cZ * sX * sY, cZ * cX, sZ * sY - cZ * sX * cY,
      -cX * sY, sX, cX * cY,
    ];
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
  function screenUpDevice(angle) {
    const a = ((angle % 360) + 360) % 360;
    if (a === 90) return [-1, 0, 0];
    if (a === 180) return [0, -1, 0];
    if (a === 270) return [1, 0, 0];
    return [0, 1, 0];
  }
  function headingOf(v) {
    return normDeg(Math.atan2(v[0], v[1]) / DEG);
  }
  function circDiffRad(a, b) {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
  }
  function stabilize(forward, up) {
    const alt = Math.asin(clamp(forward[2], -1, 1));
    const h = Math.hypot(forward[0], forward[1]);
    let az = Math.atan2(forward[0], forward[1]);
    if (h < 0.08) {
      const uh = Math.hypot(up[0], up[1]);
      if (uh > 0.05) {
        let upAz = Math.atan2(up[0], up[1]);
        if (Math.abs(circDiffRad(upAz + Math.PI, az)) < Math.abs(circDiffRad(upAz, az))) upAz += Math.PI;
        az = upAz;
      }
    }
    const c = Math.cos(alt);
    return [Math.sin(az) * Math.abs(c), Math.cos(az) * Math.abs(c), Math.sin(alt)];
  }
  function rotateAroundUp(v, offsetDeg) {
    const az = Math.atan2(v[0], v[1]) + offsetDeg * DEG;
    const h = Math.hypot(v[0], v[1]);
    return [Math.sin(az) * h, Math.cos(az) * h, v[2]];
  }

  function lookFromEuler(alpha, beta, gamma, screenAngle) {
    const R = deviceMatrix(alpha || 0, beta || 0, gamma || 0);
    const forward = stabilize(vnorm(mul(R, [0, 0, -1])), vnorm(mul(R, screenUpDevice(screenAngle || 0))));
    const up = vnorm(mul(R, screenUpDevice(screenAngle || 0)));
    const top = vnorm(mul(R, [0, 1, 0]));
    const alt = Math.asin(clamp(forward[2], -1, 1));
    const az = Math.atan2(forward[0], forward[1]);
    const worldUp = [0, 0, 1];
    let right = cross(forward, worldUp);
    if (vlen(right) < 0.15) right = [Math.cos(az), -Math.sin(az), 0];
    right = vnorm(right);
    const camUp = vnorm(cross(right, forward));
    const su = vnorm([
      up[0] - forward[0] * dot(up, forward),
      up[1] - forward[1] * dot(up, forward),
      up[2] - forward[2] * dot(up, forward),
    ]);
    const roll = Math.atan2(dot(su, right), dot(su, camUp));
    return {
      az: az < 0 ? az + Math.PI * 2 : az,
      alt,
      roll,
      forward,
      up,
      topHeading: headingOf(top),
      azimuthDeg: normDeg(az / DEG),
      altitudeDeg: alt / DEG,
    };
  }

  function createTracker() {
    let offset = 0;
    let haveOffset = false;
    return {
      get offset() { return offset; },
      update(sample) {
        const alpha = sample.alpha;
        const beta = sample.beta;
        const gamma = sample.gamma;
        if (alpha == null || beta == null || gamma == null) return null;
        const view = lookFromEuler(alpha, beta, gamma, sample.screenAngle || 0);
        const webkit = sample.webkitCompassHeading;
        const hasWebkit = typeof webkit === "number" && !Number.isNaN(webkit);
        let rejected = false;
        let reliable = false;
        if (hasWebkit && sample.absolute !== true) {
          const acc = sample.webkitCompassAccuracy;
          const flatEnough = Math.abs(beta) < 40;
          const accOk = typeof acc !== "number" || (acc >= 0 && acc <= 25);
          reliable = flatEnough && accOk;
          const predicted = normDeg(view.topHeading + offset);
          const jump = haveOffset && Math.abs(circDiff(webkit, predicted)) > 120;
          if (jump) rejected = true;
          if (reliable && !rejected) {
            const raw = normDeg(circDiff(webkit, view.topHeading));
            offset = haveOffset ? normDeg(offset + circDiff(raw, offset) * 0.2) : raw;
            haveOffset = true;
          }
        }
        const forward = rotateAroundUp(view.forward, offset);
        const up = rotateAroundUp(view.up, offset);
        const az = Math.atan2(forward[0], forward[1]);
        const alt = Math.asin(clamp(forward[2], -1, 1));
        return {
          az: az < 0 ? az + Math.PI * 2 : az,
          alt,
          roll: view.roll,
          forward,
          up,
          offset,
          rejected,
          reliable,
          azimuthDeg: normDeg(az / DEG),
          altitudeDeg: alt / DEG,
          alpha, beta, gamma,
          webkit: hasWebkit ? webkit : null,
          mode: sample.absolute ? "absolute" : hasWebkit ? "webkit" : "relative",
        };
      },
    };
  }

  root.Orient = {
    deviceMatrix, lookFromEuler, createTracker, circDiff, normDeg, headingOf,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
