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
await page.screenshot({ path: `${OUT}/hud-level.png` });
if (await page.locator("#spill-pct").count()) throw new Error("spill percentage is still in the HUD");

const box = await page.locator("#c").boundingBox();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
  const f = 0.78 * (i / 10);
  await page.mouse.move(box.x + box.width * (0.5 + f * 0.45), box.y + box.height * 0.58);
  await page.waitForTimeout(45);
}
await page.waitForTimeout(350);
if (await page.evaluate(() => window.__brew.over)) throw new Error("near-limit tilt ended the round");
await page.screenshot({ path: `${OUT}/hud-near.png` });
await page.mouse.up();

const stepsBefore = await page.evaluate(() => window.__brew.steps);
for (let i = 0; i < 8; i++) {
  const t = i * 0.05;
  const bob = Math.sin(2 * Math.PI * 1.8 * t) * 0.2 * 9.8;
  await page.evaluate(motion(9.8, 0.2, 0.3 + bob));
  await page.waitForTimeout(30);
}
await page.waitForSelector("#over:not([hidden])", { timeout: 2000 });
const stepsAfter = await page.evaluate(() => window.__brew.steps);
if (stepsAfter !== stepsBefore) throw new Error(`steps moved after spill ${stepsBefore} -> ${stepsAfter}`);
const note = await page.locator("#over-note").innerText();
await page.screenshot({ path: `${OUT}/hud-spilled.png` });

const walk = await context.newPage();
walk.on("pageerror", (err) => errors.push(String(err)));
await walk.goto(`${base}/coffee/?debug=1`, { waitUntil: "domcontentloaded" });
await walk.click("#start");
await walk.waitForFunction(() => window.__brew && window.__brew.playing && document.getElementById("count").hidden);
await walk.evaluate(() => { window.__walkStart = performance.now(); });
for (let i = 0; i < 140; i++) {
  await walk.evaluate(() => {
    const t = (performance.now() - window.__walkStart) / 1000;
    const z = 9.8 + Math.sin(2 * Math.PI * 1.8 * t) * 0.2 * 9.8;
    const e = new Event("devicemotion");
    Object.defineProperty(e, "accelerationIncludingGravity", { value: { x: 0, y: 0, z } });
    Object.defineProperty(e, "acceleration", { value: { x: null, y: null, z: null } });
    window.dispatchEvent(e);
  });
  await walk.waitForTimeout(30);
}
const walked = await walk.evaluate(() => window.__brew.steps);
const expectSteps = 1.8 * ((140 * 30) / 1000);
if (walked < expectSteps * 0.7) throw new Error(`debug walk undercounted ${walked}`);
await walk.screenshot({ path: `${OUT}/debug.png` });

const look = await context.newPage();
await look.goto(`${base}/coffee/`, { waitUntil: "domcontentloaded" });
await look.click("#start");
await look.waitForFunction(() => document.getElementById("count").hidden);
await look.waitForTimeout(250);
await look.screenshot({ path: `${OUT}/level.png` });
const lookBox = await look.locator("#c").boundingBox();
await look.mouse.move(lookBox.x + lookBox.width * 0.5, lookBox.y + lookBox.height * 0.5);
await look.mouse.down();
await look.mouse.move(lookBox.x + lookBox.width * 0.9, lookBox.y + lookBox.height * 0.62, { steps: 24 });
await look.waitForTimeout(450);
await look.screenshot({ path: `${OUT}/tilt.png` });
await look.mouse.move(lookBox.x + 12, lookBox.y + lookBox.height * 0.42, { steps: 3 });
await look.keyboard.down("Space");
await look.keyboard.up("Space");
await look.waitForTimeout(120);
await look.screenshot({ path: `${OUT}/slosh.png` });
const hub = await context.newPage();
await hub.setViewportSize({ width: 390, height: 844 });
await hub.goto(`${base}/`, { waitUntil: "domcontentloaded" });
if (!(await hub.locator("text=Brewnian Motion").count())) throw new Error("hub card missing");
await hub.screenshot({ path: `${OUT}/hub.png`, fullPage: true });
if (errors.length) throw new Error(errors.join("\n"));
await browser.close();
console.log("PASS", note, "steps", walked);
