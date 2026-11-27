import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {};
vm.runInNewContext(readFileSync(new URL("./artmesh.js", import.meta.url), "utf8"), ctx);
const { ArtMesh } = ctx;

const stars = JSON.parse(readFileSync(new URL("./data/stars.json", import.meta.url), "utf8"));
const index = JSON.parse(readFileSync(new URL("./data/art/index.json", import.meta.url), "utf8"));
const byHip = new Map(stars.s.map((row) => [row[4], { ra: row[0], dec: row[1], con: row[5] }]));
const conName = stars.con;

let failed = 0;
function check(name, cond, extra) {
  console.log(`${cond ? "ok" : "FAIL"} ${name}${extra ? " " + extra : ""}`);
  if (!cond) failed += 1;
}

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const round = ArtMesh.invGnomonic(0.2, -0.15, 5.5, 20);
const back = ArtMesh.gnomonic(round.ra, round.dec, 5.5, 20);
check("gnomonic round trip", back && Math.hypot(back.x - 0.2, back.y + 0.15) < 1e-9, JSON.stringify(back));

check("below the horizon the figure is gone", ArtMesh.figureAlpha(0, 60, false) === 0 && ArtMesh.figureAlpha(-4, 60, false) === 0);
check("daytime figure is faint, not a scale ghost", Math.abs(ArtMesh.figureAlpha(40, 60, false) - 0.2) < 1e-9);
check("night stays in the same band", Math.abs(ArtMesh.figureAlpha(40, 60, true) - 0.18) < 1e-9);
check("a wide field only dims a little", ArtMesh.figureAlpha(40, 100, false) > 0.1 && ArtMesh.figureAlpha(40, 100, false) < 0.2);

const fits = {};
for (const [id, meta] of Object.entries(index)) {
  const fit = ArtMesh.prepare(meta, (hip) => byHip.get(hip) || null);
  check(`${id} prepares`, !!fit);
  if (!fit) continue;
  fits[id] = fit;
  const bad = fit.anchors.filter((a) => conName[byHip.get(a.hip).con] !== id);
  check(`${id} anchors belong to that constellation`, bad.length === 0, bad.map((a) => a.hip).join(","));
}

const view = { w: 390, h: 844 };
const when = new Date("2026-11-27T23:05:00Z");
const lat = 34.08, lon = -118.07;

function place(ra, dec, pose) {
  const hor = ArtMesh.eqToHor(ra, dec, lat, lon, when);
  return ArtMesh.project(hor.az, hor.alt, pose, Object.assign({ fov: pose.fov }, view));
}

function angSep(a, b) {
  const ra1 = a.ra * 15 * Math.PI / 180, d1 = a.dec * Math.PI / 180;
  const ra2 = b.ra * 15 * Math.PI / 180, d2 = b.dec * Math.PI / 180;
  const c = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(ra1 - ra2);
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

let centeredWorst = 0;
let centeredWhere = "";
for (const [id, fit] of Object.entries(fits)) {
  const mid = fit.anchors[0];
  const hor = ArtMesh.eqToHor(mid.ra, mid.dec, lat, lon, when);
  const pose = { az: hor.az, alt: hor.alt, roll: 0.4, fov: 60 };
  for (const a of fit.anchors) {
    const sky = ArtMesh.anchorSky(fit, a);
    const mesh = place(sky.ra, sky.dec, pose);
    const star = place(a.ra, a.dec, pose);
    if (!mesh || !star) continue;
    const err = Math.hypot(mesh.x - star.x, mesh.y - star.y);
    if (err > centeredWorst) {
      centeredWorst = err;
      centeredWhere = `${id} hip ${a.hip}`;
    }
  }
}
check("centered view keeps anchors within 18px", centeredWorst <= 18, `worst ${centeredWorst.toFixed(2)}px ${centeredWhere}`);

const rng = rand(3753);
let samples = 0;
let blown = 0;
for (const [id, fit] of Object.entries(fits)) {
  for (let n = 0; n < 36; n++) {
    const pose = {
      az: rng() * Math.PI * 2,
      alt: (-15 + rng() * 100) * Math.PI / 180,
      roll: (rng() * 2 - 1) * Math.PI,
      fov: 28 + rng() * 72,
    };
    const focal = (view.h / 2) / Math.tan((pose.fov * Math.PI / 180) / 2);
    for (const a of fit.anchors) {
      const sky = ArtMesh.anchorSky(fit, a);
      const mesh = place(sky.ra, sky.dec, pose);
      const star = place(a.ra, a.dec, pose);
      if (!mesh || !star || mesh.z < 0.4 || star.z < 0.4) continue;
      const err = Math.hypot(mesh.x - star.x, mesh.y - star.y);
      const bound = angSep(sky, a) * focal / (mesh.z * mesh.z) + 3;
      samples += 1;
      if (err > bound) blown += 1;
    }
  }
}
check(`mesh matches the star projection in ${samples} edge-on views`, blown === 0, `${blown} blew past the plate residual`);

const sco = fits.Sco;
const ant = sco.anchors.find((a) => a.hip === 80763);
const look = ArtMesh.eqToHor(ant.ra, ant.dec, lat, lon, when);
const behind = place(ArtMesh.anchorSky(sco, ant).ra, ArtMesh.anchorSky(sco, ant).dec, {
  az: (look.az + Math.PI) % (Math.PI * 2),
  alt: 0.4,
  roll: 0.8,
  fov: 50,
});
check("an anchor behind the camera is not projected", behind == null);

if (failed) process.exit(1);
