import fs from "node:fs";

const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const marked = html.match(/window\.NG_VERSION\s*=\s*"([^"]+)"/);
if (!marked) throw new Error("sky/index.html does not set window.NG_VERSION");
const version = marked[1];
if (!/^[A-Za-z0-9._-]+$/.test(version)) throw new Error(`bad asset version ${version}`);

const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
const local = refs.filter((ref) => !ref.startsWith("data:") && !ref.startsWith("http"));
if (!local.length) throw new Error("no local assets in sky/index.html");
for (const ref of local) {
  const query = new URL(ref, "https://example.com/sky/").searchParams.get("v");
  if (query !== version) throw new Error(`${ref} is not tagged v=${version}`);
}
console.log("ok asset version", version, local.length, "files");
