/* Map phone gravity into screen axes. Positive x: right side down. Positive y: bottom side down. */
(function (root) {
  function signsFromFlat(flat) {
    const sz = flat.z >= 0 ? 1 : -1;
    return { x: -sz, y: sz, z: sz };
  }

  function normalize(sample, signs) {
    return {
      x: sample.x * signs.x,
      y: sample.y * signs.y,
      z: sample.z * signs.z,
    };
  }

  function rotate(x, y, angleDeg) {
    const a = ((angleDeg || 0) % 360 + 360) % 360;
    if (a === 90) return { x: -y, y: x };
    if (a === 180) return { x: -x, y: -y };
    if (a === 270) return { x: y, y: -x };
    return { x, y };
  }

  function screenAxes(sample, signs, angleDeg) {
    const n = normalize(sample, signs || { x: -1, y: 1, z: 1 });
    const spun = rotate(n.x, n.y, angleDeg);
    return { x: spun.x, y: spun.y, z: n.z, signs: signs || { x: -1, y: 1, z: 1 } };
  }

  function slopes(axes) {
    const gz = Math.abs(axes.z) + 0.4;
    return { x: Math.atan2(axes.x, gz), y: Math.atan2(axes.y, gz) };
  }

  function bubble(slope) {
    return { x: -slope.x, y: -slope.y };
  }

  root.Tilt = { signsFromFlat, normalize, rotate, screenAxes, slopes, bubble };
})(typeof globalThis !== "undefined" ? globalThis : this);
