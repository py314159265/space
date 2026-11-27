/* Step detector for a phone held flat. Gravity stays on the device. */
(function (root) {
  const G = 9.80665;
  const FLOOR = 0.02 * G;

  function channel() {
    return { prev: 0, hp: 0, bp: 0, peak: 0, hist: [] };
  }

  function createDetector() {
    const gLp = { x: 0, y: 0, z: G };
    const vert = channel();
    const latX = channel();
    const latY = channel();
    let steps = 0;
    let lastStep = -1e9;
    let armed = false;
    let channelName = "vertical";
    const wave = [];
    const marks = [];

    function filter(ch, value, dt, now) {
      const rc = 1 / (2 * Math.PI * 0.45);
      const hpA = rc / (rc + dt);
      ch.hp = hpA * (ch.hp + value - ch.prev);
      ch.prev = value;
      const lpA = 1 - Math.exp(-dt * 2 * Math.PI * 5);
      ch.bp += (ch.hp - ch.bp) * lpA;
      ch.hist.push({ t: now, v: ch.bp });
      while (ch.hist.length && now - ch.hist[0].t > 2000) ch.hist.shift();
      let peak = 0;
      for (let i = 0; i < ch.hist.length; i++) peak = Math.max(peak, Math.abs(ch.hist[i].v));
      ch.peak = peak;
    }

    function push(sample, dt, now, counting) {
      const aG = 1 - Math.exp(-dt * 2 * Math.PI * 0.18);
      gLp.x += (sample.x - gLp.x) * aG;
      gLp.y += (sample.y - gLp.y) * aG;
      gLp.z += (sample.z - gLp.z) * aG;
      const lin = {
        x: sample.x - gLp.x,
        y: sample.y - gLp.y,
        z: sample.z - gLp.z,
      };
      const gm = Math.hypot(gLp.x, gLp.y, gLp.z) || G;
      const vertical = (lin.x * gLp.x + lin.y * gLp.y + lin.z * gLp.z) / gm;
      const ux = gLp.x / gm;
      const uy = gLp.y / gm;
      const uz = gLp.z / gm;
      const hx = lin.x - vertical * ux;
      const hy = lin.y - vertical * uy;
      filter(vert, vertical, dt, now);
      filter(latX, hx, dt, now);
      filter(latY, hy, dt, now);
      const lat = latX.peak >= latY.peak ? latX : latY;
      const latName = latX.peak >= latY.peak ? "lateral-x" : "lateral-y";
      let next = channelName;
      if (lat.peak > vert.peak * 1.2) next = latName;
      else if (vert.peak > lat.peak * 1.2) next = "vertical";
      else if (channelName !== "vertical" && channelName !== latName) next = latName;
      if (next !== channelName) {
        channelName = next;
        armed = false;
      }
      const ch = channelName === "vertical" ? vert : lat;
      const threshold = Math.max(FLOOR, 0.4 * ch.peak);
      wave.push({ t: now, v: ch.bp, th: threshold });
      while (wave.length && now - wave[0].t > 2000) wave.shift();
      while (marks.length && now - marks[0] > 2000) marks.shift();
      if (!counting) {
        armed = false;
      } else if (!armed && ch.bp > threshold) {
        armed = true;
      } else if (armed && ch.bp < -0.35 * threshold) {
        armed = false;
        if (now - lastStep >= 250) {
          lastStep = now;
          steps += 1;
          marks.push(now);
        }
      }
      return {
        steps,
        channel: channelName,
        threshold,
        value: ch.bp,
        vertical,
        lin,
        wave,
        marks,
      };
    }

    function disarm() {
      armed = false;
    }

    return {
      push,
      disarm,
      get steps() { return steps; },
    };
  }

  root.StepDetect = { createDetector, G };
})(typeof globalThis !== "undefined" ? globalThis : this);
