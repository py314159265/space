import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {};
vm.runInNewContext(readFileSync(new URL("./artmesh.js", import.meta.url), "utf8"), ctx);
const { ArtMesh } = ctx;
const stars = JSON.parse(readFileSync(new URL("./data/stars.json", import.meta.url), "utf8"));
const index = JSON.parse(readFileSync(new URL("./data/art/index.json", import.meta.url), "utf8"));
const byHip = new Map(stars.s.map((row) => [row[4], { ra: row[0], dec: row[1] }]));

let failed = 0;
function check(name, cond, extra) {
  console.log(`${cond ? "ok" : "FAIL"} ${name}${extra ? " " + extra : ""}`);
  if (!cond) failed += 1;
}

function fit(id) {
  return ArtMesh.prepare(index[id], (hip) => byHip.get(hip));
}
function star(hip) {
  return byHip.get(hip);
}
function anchor(id, hip) {
  return index[id].anchors.find((a) => a.hip === hip);
}
function sep(a, b) {
  const ra = (a.ra - b.ra) * 15 * Math.cos(((a.dec + b.dec) / 2) * Math.PI / 180);
  return Math.hypot(ra, a.dec - b.dec);
}
function worst(meta) {
  const prepared = ArtMesh.prepare(meta, (hip) => byHip.get(hip));
  let max = 0;
  for (const a of prepared.anchors) {
    max = Math.max(max, sep(ArtMesh.imageToSky(prepared, a.u, a.v), star(a.hip)));
  }
  return max;
}

for (const id of Object.keys(index)) {
  const prepared = fit(id);
  const [a, b] = prepared.sim;
  const det = a * a + b * b;
  check(`${id} similarity is proper (det > 0)`, det > 0, det.toExponential(2));
  check(`${id} anchors land on their stars`, worst(index[id]) < 1.5, worst(index[id]).toFixed(2) + "°");
}

// A reflected copy of the anchor pixels is not an acceptable fit. Orion and
// Leo are large enough that a mirror cannot hide inside the engraving error.
for (const id of ["Ori", "Leo", "Cyg"]) {
  const meta = index[id];
  const mirrored = {
    ...meta,
    anchors: meta.anchors.map((a) => ({ ...a, x: meta.w - a.x })),
  };
  const bad = worst(mirrored);
  check(`${id} rejects an east-west mirror`, bad > 4 && bad > worst(meta) * 4, bad.toFixed(2) + "°");
}

const ori = fit("Ori");
const betel = star(27989);
const bell = star(25336);
const rigel = star(24436);
const meissa = star(26207);
const head = ArtMesh.imageToSky(ori, 210, 210);
check(
  "Orion head is Meissa, above the shoulders",
  head.dec > betel.dec + 3 && head.dec > bell.dec + 3 && sep(head, meissa) < sep(head, rigel),
  `dec ${head.dec.toFixed(1)}`,
);
const club = ArtMesh.imageToSky(ori, 100, 90);
check(
  "Orion club is raised on the Gemini side of Betelgeuse",
  club.ra > betel.ra && club.dec > betel.dec + 5,
  `ra ${club.ra.toFixed(2)} dec ${club.dec.toFixed(1)}`,
);
const shield = ArtMesh.imageToSky(ori, 390, 370);
check("Orion shield is west of Bellatrix", shield.ra < bell.ra, `ra ${shield.ra.toFixed(2)}`);
const betelPx = anchor("Ori", 27989);
const bellPx = anchor("Ori", 25336);
const [oa, ob] = ori.sim;
const east = oa * (betelPx.x - bellPx.x) - ob * (betelPx.y - bellPx.y);
check("Betelgeuse anchor is east of Bellatrix", east > 0 && betel.ra > bell.ra);

const aldebaran = star(21421);
const elnath = star(25428);
const zeta = ArtMesh.imageToSky(fit("Tau"), 111, 138);
check("Taurus horns reach Elnath and Zeta Tau", elnath.dec > aldebaran.dec && zeta.dec > aldebaran.dec && sep(zeta, star(26451)) < 1);

const castor = star(36850);
const pollux = star(37826);
check("Gemini heads are Castor and Pollux", castor.dec > pollux.dec && pollux.ra > castor.ra);
check("Castor anchor maps to Castor", sep(ArtMesh.imageToSky(fit("Gem"), anchor("Gem", 36850).x, anchor("Gem", 36850).y), castor) < 1);
check("Pollux anchor maps to Pollux", sep(ArtMesh.imageToSky(fit("Gem"), anchor("Gem", 37826).x, anchor("Gem", 37826).y), pollux) < 1);

const deneb = star(102098);
const albireo = star(95947);
const cyg = fit("Cyg");
const cygTail = ArtMesh.imageToSky(cyg, 140, 200);
const cygHead = ArtMesh.imageToSky(cyg, 450, 500);
check("Cygnus tail is the Deneb end", cygTail.dec > deneb.dec && cygTail.ra > deneb.ra && deneb.dec > albireo.dec);
check("Cygnus head is Albireo, not the tail", sep(cygHead, albireo) < sep(cygHead, deneb) && cygHead.dec < deneb.dec);

const altair = star(97649);
const aqlHead = ArtMesh.imageToSky(fit("Aql"), 520, 300);
check("Aquila head is west of Altair", aqlHead.ra < altair.ra, `ra ${aqlHead.ra.toFixed(2)}`);

const antares = star(80763);
const shaula = star(85927);
const sting = ArtMesh.imageToSky(fit("Sco"), 70, 520);
check("Scorpius tail curls past Shaula", shaula.dec < antares.dec && sting.dec < shaula.dec && sep(sting, shaula) < sep(sting, antares));

const regulus = star(49669);
const denebola = star(57632);
const leoHead = ArtMesh.imageToSky(fit("Leo"), 340, 290);
const leoTail = ArtMesh.imageToSky(fit("Leo"), 60, 400);
check("Leo head is the sickle, west of the tail", leoHead.ra < denebola.ra && leoHead.dec > regulus.dec && sep(leoHead, star(48455)) < 3);
check("Leo tail is Denebola", sep(leoTail, denebola) < 2 && denebola.ra > regulus.ra);

const dubhe = star(54061);
const mizar = star(65378);
const umaTail = ArtMesh.imageToSky(fit("UMa"), 155, 280);
const umaNose = ArtMesh.imageToSky(fit("UMa"), 610, 90);
check("Ursa Major tail is the handle, past Mizar", umaTail.ra > mizar.ra && mizar.ra > dubhe.ra && sep(umaTail, star(67301)) < 2);
check("Ursa Major nose is west of the bowl", umaNose.ra < dubhe.ra);

if (failed) process.exit(1);
console.log("facing orientation ok");
