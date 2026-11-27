import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = { globalThis: {} };
vm.runInNewContext(readFileSync(new URL("./stepdetect.js", import.meta.url), "utf8"), ctx);
const { createDetector, G } = ctx.globalThis.StepDetect;

function run(make, dt, seconds, counting = true) {
  const det = createDetector();
  let now = 0;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    now += dt * 1000;
    det.push(make(i * dt), dt, now, counting);
  }
  return det.steps;
}

function noise(amp) {
  return (Math.random() - 0.5) * 2 * amp;
}

function accuracy(got, expect) {
  return got / expect;
}

let failed = 0;
function check(name, got, lo, hi) {
  const ok = got >= lo && got <= hi;
  console.log(`${ok ? "ok" : "FAIL"} ${name}: ${got} (want ${lo}..${hi})`);
  if (!ok) failed += 1;
}

const cycles = 20;
const dur = cycles / 1.8;
for (const dt of [1 / 30, 1 / 60]) {
  const vert = run((t) => ({
    x: noise(0.004 * G),
    y: noise(0.004 * G),
    z: G + Math.sin(2 * Math.PI * 1.8 * t) * 0.03 * G + noise(0.004 * G),
  }), dt, dur);
  check(`vertical 0.03 g @ ${Math.round(1 / dt)} Hz`, vert, Math.ceil(cycles * 0.95), Math.floor(cycles * 1.1));

  const lat = run((t) => ({
    x: Math.sin(2 * Math.PI * 1.8 * t) * 0.03 * G + noise(0.004 * G),
    y: noise(0.004 * G),
    z: G + noise(0.004 * G),
  }), dt, dur);
  check(`lateral 0.03 g @ ${Math.round(1 / dt)} Hz`, lat, Math.ceil(cycles * 0.95), Math.floor(cycles * 1.1));
}

const still = run((t) => ({
  x: noise(0.01 * G),
  y: noise(0.01 * G),
  z: G + noise(0.01 * G),
}), 1 / 30, 8);
check("still 0.01 g tremor", still, 0, 0);

const fastCycles = 16;
const fast = run((t) => ({
  x: 0,
  y: 0,
  z: G + Math.sin(2 * Math.PI * 3.5 * t) * 0.05 * G,
}), 1 / 60, fastCycles / 3.5);
check("3.5 Hz cadence", fast, Math.ceil(fastCycles * 0.95), Math.floor(fastCycles * 1.1));

if (failed) process.exit(1);
console.log("step detector passed");
