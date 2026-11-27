import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.env.SHOTS || "/tmp/nightglass-shots";
mkdirSync(OUT, { recursive: true });
const phone = devices["iPhone 13"];
const base = process.env.BASE || "http://127.0.0.1:8000";
const when = "2026-11-27T05:00:00.000Z";

function orient(alpha, beta, gamma) {
  return `(() => {
    const e = new Event("deviceorientationabsolute");
    Object.defineProperty(e, "alpha", { value: ${alpha} });
    Object.defineProperty(e, "beta", { value: ${beta} });
    Object.defineProperty(e, "gamma", { value: ${gamma} });
    Object.defineProperty(e, "absolute", { value: true });
    window.dispatchEvent(e);
  })()`;
}

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: phone.userAgent,
  timezoneId: "America/Los_Angeles",
  geolocation: { latitude: 34.08, longitude: -118.07 },
  permissions: ["geolocation"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
await page.goto(`${base}/sky/?time=${encodeURIComponent(when)}`, { waitUntil: "networkidle" });
await page.waitForSelector("#go-live");
await page.screenshot({ path: `${OUT}/start.png` });

await page.click("#go-live");
await page.waitForSelector("#stage:not([hidden])");
await page.waitForFunction(() => window.__sky && window.__sky.ready && window.__sky.bodies.Saturn);

const sky = await page.evaluate(() => window.__sky);
const sat = sky.bodies.Saturn;
const moon = sky.bodies.Moon;
if (Math.abs(sat.alt - 54) > 6) throw new Error(`Saturn alt ${sat.alt}`);
if (sat.az < 190 || sat.az > 225) throw new Error(`Saturn az ${sat.az}`);
if (Math.abs(moon.alt - 22) > 6) throw new Error(`Moon alt ${moon.alt}`);
if (moon.az < 55 || moon.az > 90) throw new Error(`Moon az ${moon.az}`);
if (!/gibbous/i.test(sky.phase)) throw new Error(`phase ${sky.phase}`);

// Look toward the southeast, altitude about 35 degrees.
// alpha 210, beta 125, gamma 0 maps the back camera near azimuth 120-140.
for (let i = 0; i < 40; i++) {
  await page.evaluate(orient(250, 125, 0));
  await page.waitForTimeout(16);
}
await page.waitForTimeout(200);
const view = await page.evaluate(() => window.__sky);
const names = view.visible.join(" ");
if (!/Orion/.test(names) || !/Taurus/.test(names) || !/Pleiades/.test(names)) {
  throw new Error(`missing winter sky in ${names}; view ${JSON.stringify(view.view)}`);
}
await page.screenshot({ path: `${OUT}/live-se.png` });

// Point at Saturn and open its sheet.
const alpha = (360 - sat.az + 360) % 360;
const beta = 90 + sat.alt;
for (let i = 0; i < 40; i++) {
  await page.evaluate(orient(alpha, beta, 0));
  await page.waitForTimeout(16);
}
await page.waitForTimeout(250);
const satPick = await page.evaluate(() => window.__sky.picks.find((p) => p.name === "Saturn"));
if (!satPick) throw new Error("Saturn is not on screen");
await page.locator("#sky").click({ position: { x: satPick.x, y: satPick.y }, force: true });
await page.waitForSelector("#sheet:not([hidden])");
const sheet = await page.locator("#sheet-name").innerText();
if (sheet !== "Saturn") throw new Error(`sheet ${sheet}`);
await page.screenshot({ path: `${OUT}/saturn.png` });

await page.click("#sheet-close");
await page.click('[data-key="night"]');
await page.screenshot({ path: `${OUT}/night.png` });
await context.close();

const desk = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  timezoneId: "America/Los_Angeles",
  geolocation: { latitude: 34.08, longitude: -118.07 },
  permissions: ["geolocation"],
});
const dpage = await desk.newPage();
dpage.on("pageerror", (err) => errors.push(String(err)));
await dpage.goto(`${base}/sky/?time=${encodeURIComponent(when)}`, { waitUntil: "networkidle" });
await dpage.click("#go-manual");
await dpage.waitForSelector("#stage:not([hidden])");
await dpage.waitForTimeout(400);
await dpage.screenshot({ path: `${OUT}/desktop.png` });

const hub = await desk.newPage();
await hub.goto(`${base}/`, { waitUntil: "networkidle" });
await hub.setViewportSize({ width: 1280, height: 800 });
await hub.screenshot({ path: `${OUT}/hub-1280.png`, fullPage: true });
await hub.setViewportSize({ width: 390, height: 844 });
await hub.screenshot({ path: `${OUT}/hub-390.png`, fullPage: true });

if (errors.length) throw new Error(errors.join("\n"));
await browser.close();
console.log("PASS", JSON.stringify({ sat, moon, phase: sky.phase, visible: names }));
