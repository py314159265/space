import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.env.SHOTS || "/tmp/brew-shots";
mkdirSync(OUT, { recursive: true });
const base = process.env.BASE || "http://127.0.0.1:8000";

function motion(x, y, z, ax = 0, ay = 0, az = 0) {
  return `(() => {
    const e = new Event("devicemotion");
    Object.defineProperty(e, "accelerationIncludingGravity", { value: { x: ${x}, y: ${y}, z: ${z} } });
    Object.defineProperty(e, "acceleration", { value: { x: ${ax}, y: ${ay}, z: ${az} } });
    window.dispatchEvent(e);
  })()`;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
await page.goto(`${base}/coffee/`, { waitUntil: "domcontentloaded" });
await page.screenshot({ path: `${OUT}/start.png` });

await page.click('[data-mode="sprint"]');
await page.click('[data-secs="10"]');
await page.click("#start");
for (let i = 0; i < 20; i++) {
  await page.evaluate(motion(0, 0, 9.8));
  await page.waitForTimeout(40);
}
await page.waitForFunction(() => window.__brew && window.__brew.playing && document.getElementById("count").hidden);
const clock = await page.locator("#timer").innerText();
if (!/^\d:\d\d$/.test(clock)) throw new Error(`timer ${clock}`);
await page.screenshot({ path: `${OUT}/sprint.png` });

for (let i = 0; i < 80; i++) {
  await page.evaluate(motion(4.2, 1.1, 8.2));
  await page.waitForTimeout(30);
  const state = await page.evaluate(() => window.__brew);
  if (state.stains >= 2 && state.spill < 100) break;
}
await page.screenshot({ path: `${OUT}/tilt.png` });

for (let i = 0; i < 40; i++) {
  await page.evaluate(motion(7.5, 2, 4, 0, 18, 0));
  await page.waitForTimeout(40);
}
await page.waitForSelector("#over:not([hidden])", { timeout: 8000 });
const note = await page.locator("#over-note").innerText();
if (!/redacted/i.test(note)) throw new Error(`note: ${note}`);
await page.screenshot({ path: `${OUT}/score.png` });
const hub = await context.newPage();
await hub.setViewportSize({ width: 390, height: 844 });
await hub.goto(`${base}/`, { waitUntil: "domcontentloaded" });
if (!(await hub.locator("text=Brewnian Motion").count())) throw new Error("hub card missing");
await hub.screenshot({ path: `${OUT}/hub.png`, fullPage: true });
if (errors.length) throw new Error(errors.join("\n"));
await browser.close();
console.log("PASS", note);
