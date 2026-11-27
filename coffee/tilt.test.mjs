import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {};
vm.runInNewContext(readFileSync(new URL("./tilt.js", import.meta.url), "utf8"), ctx);
const { signsFromFlat, screenAxes, slopes, bubble } = ctx.Tilt;

let failed = 0;
function check(name, cond) {
  console.log(`${cond ? "ok" : "FAIL"} ${name}`);
  if (!cond) failed += 1;
}

function pose(sample, flat) {
  const signs = signsFromFlat(flat);
  const axes = screenAxes(sample, signs, 0);
  const slope = slopes(axes);
  return { signs, axes, slope, bubble: bubble(slope) };
}

const androidFlat = { x: 0, y: 0, z: 9.8 };
const iosFlat = { x: 0, y: 0, z: -9.8 };

const cases = [
  ["roll right", { x: -3, y: 0, z: 9.2 }, { x: 3, y: 0, z: -9.2 }, (p) => p.slope.x > 0 && p.bubble.x < 0 && p.axes.x > 0],
  ["roll left", { x: 3, y: 0, z: 9.2 }, { x: -3, y: 0, z: -9.2 }, (p) => p.slope.x < 0 && p.bubble.x > 0 && p.axes.x < 0],
  ["pitch forward", { x: 0, y: -3, z: 9.2 }, { x: 0, y: 3, z: -9.2 }, (p) => p.slope.y < 0 && p.bubble.y > 0 && p.axes.y < 0],
  ["pitch back", { x: 0, y: 3, z: 9.2 }, { x: 0, y: -3, z: -9.2 }, (p) => p.slope.y > 0 && p.bubble.y < 0 && p.axes.y > 0],
];

for (const [name, android, ios, ok] of cases) {
  const a = pose(android, androidFlat);
  const i = pose(ios, iosFlat);
  check(`android ${name}`, ok(a));
  check(`ios ${name}`, ok(i));
  check(`${name} platforms agree`, Math.sign(a.slope.x) === Math.sign(i.slope.x) && Math.sign(a.slope.y) === Math.sign(i.slope.y));
}

const turned = screenAxes({ x: -3, y: 0, z: 9.2 }, signsFromFlat(androidFlat), 90);
check("orientation 90 sends device-right-down to screen bottom", turned.y > 0 && Math.abs(turned.x) < 0.2);

if (failed) process.exit(1);
console.log("tilt signs passed");
