import fs from "node:fs";

const stars = JSON.parse(fs.readFileSync(new URL("./data/stars.json", import.meta.url)));
const figures = JSON.parse(fs.readFileSync(new URL("./data/figure-lines.json", import.meta.url)));
const hips = new Set(stars.s.map((row) => row[4]));

function components(lines) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
    return parent.get(x);
  };
  for (const [a, b] of lines) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  return new Set([...parent.keys()].map(find)).size;
}

const ids = new Set();
for (const fig of figures) {
  if (ids.has(fig.id)) throw new Error(`duplicate ${fig.id}`);
  ids.add(fig.id);
  if (!fig.lines || fig.lines.length < 6) throw new Error(`${fig.id} is too short`);
  const seen = new Set();
  for (const pair of fig.lines) {
    if (pair.length !== 2 || pair[0] === pair[1]) throw new Error(`${fig.id} bad pair ${pair}`);
    if (!hips.has(pair[0]) || !hips.has(pair[1])) throw new Error(`${fig.id} unknown star ${pair}`);
    const key = pair[0] < pair[1] ? `${pair[0]}-${pair[1]}` : `${pair[1]}-${pair[0]}`;
    if (seen.has(key)) throw new Error(`${fig.id} repeats ${key}`);
    seen.add(key);
  }
}
for (const id of ["Ori", "Gem", "Leo", "UMa", "Cas"]) {
  if (!ids.has(id)) throw new Error(`missing ${id}`);
}
const gem = figures.find((fig) => fig.id === "Gem");
if (components(gem.lines) !== 2) throw new Error("Gemini should be two separate figures");
const ori = figures.find((fig) => fig.id === "Ori");
if (components(ori.lines) !== 1) throw new Error("Orion should be one connected hunter");
console.log("ok figure lines", [...ids].join(" "));
