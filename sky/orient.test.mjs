import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {};
vm.runInNewContext(readFileSync(new URL("./orient.js", import.meta.url), "utf8"), ctx);
const { createTracker, circDiff } = ctx.Orient;

let failed = 0;
function check(name, cond, extra) {
  console.log(`${cond ? "ok" : "FAIL"} ${name}${extra ? " " + extra : ""}`);
  if (!cond) failed += 1;
}

function sweep(label, makeSample) {
  const tracker = createTracker();
  const betas = [];
  for (let b = 0; b <= 120; b += 15) betas.push(b);
  const rows = betas.map((beta) => tracker.update(makeSample(beta)));
  const alts = rows.map((r) => r.altitudeDeg);
  const azs = rows.map((r) => r.azimuthDeg);
  let mono = true;
  for (let i = 1; i < alts.length; i++) if (!(alts[i] > alts[i - 1] + 8)) mono = false;
  let span = 0;
  for (let i = 1; i < azs.length; i++) span = Math.max(span, Math.abs(circDiff(azs[i], azs[0])));
  const flipped = rows.some((r, i) => i > 0 && Math.abs(circDiff(r.azimuthDeg, rows[0].azimuthDeg)) > 90);
  check(`${label} altitude rises`, mono, alts.map((a) => a.toFixed(0)).join(","));
  check(`${label} azimuth holds`, span < 8 && !flipped, `span ${span.toFixed(1)} az ${azs.map((a) => a.toFixed(0)).join(",")}`);
  return rows;
}

const TRUE_HEADING = 80;
const ALPHA = 25;
function webkit(beta) {
  return beta >= 45 ? (TRUE_HEADING + 180) % 360 : TRUE_HEADING;
}

sweep("Safari iOS", (beta) => ({
  alpha: ALPHA,
  beta,
  gamma: 0,
  webkitCompassHeading: webkit(beta),
  webkitCompassAccuracy: beta < 40 ? 8 : 12,
  absolute: false,
  screenAngle: 0,
}));

sweep("Chrome iOS", (beta) => ({
  alpha: ALPHA,
  beta,
  gamma: 0,
  webkitCompassHeading: webkit(beta),
  webkitCompassAccuracy: beta < 40 ? 10 : -1,
  absolute: false,
  screenAngle: 0,
}));

sweep("Chrome Android absolute", (beta) => ({
  alpha: 280,
  beta,
  gamma: 0,
  absolute: true,
  screenAngle: 0,
}));

sweep("Chrome Android relative", (beta) => ({
  alpha: ALPHA,
  beta,
  gamma: 0,
  absolute: false,
  screenAngle: 0,
}));

const ios = createTracker();
const before = ios.update({
  alpha: ALPHA, beta: 20, gamma: 0,
  webkitCompassHeading: TRUE_HEADING, webkitCompassAccuracy: 8, absolute: false,
});
const after = ios.update({
  alpha: ALPHA, beta: 70, gamma: 0,
  webkitCompassHeading: (TRUE_HEADING + 180) % 360, webkitCompassAccuracy: 8, absolute: false,
});
check("webkit jump ignored", after.rejected && Math.abs(circDiff(after.offset, before.offset)) < 5, `off ${before.offset.toFixed(1)} -> ${after.offset.toFixed(1)}`);
check("azimuth across the jump", Math.abs(circDiff(after.azimuthDeg, before.azimuthDeg)) < 8, `${before.azimuthDeg.toFixed(1)} -> ${after.azimuthDeg.toFixed(1)}`);

if (failed) process.exit(1);
console.log("orientation sweeps passed");
