/**
 * Drive procurement: the expediting list by float, a FAT refused while the
 * ITP stands at code 3, forecast history, and the warehouse shortage now
 * showing what is on order.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-procurement.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const problems = [], expected400 = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => {
  if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) (r.status() === 400 ? expected400 : problems).push(`HTTP ${r.status()} ${r.url()}`);
});
const flat = (s) => s.replace(/\s+/g, " ").trim();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

await page.goto(BASE + "/procurement", { waitUntil: "networkidle" });
await page.waitForSelector(".kpi");
console.log("header:", flat(await page.locator(".pagehead .sub").innerText()));
for (const k of await page.locator(".kpi").allInnerTexts()) console.log("  kpi ", flat(k));
const card = (h) => page.locator(".card", { has: page.locator("h2", { hasText: h }) }).first();
for (const r of await card("فهرست پیگیری").locator("tbody tr").allInnerTexts()) console.log("  exp ", flat(r).slice(0, 170));
await page.screenshot({ path: `${SHOT}/105-procurement.png` });

const po = page.locator(".card", { has: page.locator("h2", { hasText: "PO-M-0101" }) });
await po.getByRole("button", { name: "جزئیات" }).click(); await page.waitForTimeout(800);
for (const r of await po.locator("table").nth(1).locator("tbody tr").allInnerTexts()) console.log("  vdrl", flat(r).slice(0, 150));
await po.locator("tbody tr").first().getByRole("button", { name: "FAT" }).click(); await page.waitForTimeout(400);
await po.locator("input[id^=fi-]").fill("IRN-DRIVE");
await po.getByRole("button", { name: "ثبت FAT" }).click(); await page.waitForTimeout(1000);
console.log("FAT refused:", flat(await page.locator(".page > p.err").innerText()));
await po.locator("tbody tr").first().getByRole("button", { name: "پیش‌بینی" }).click(); await page.waitForTimeout(1000);
console.log("forecast history:", flat(await po.locator("ol").first().innerText()));
await po.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/106-procurement-po.png` });

await page.goto(BASE + "/warehouse", { waitUntil: "networkidle" }); await page.waitForTimeout(600);
for (const r of await card("نیاز MTO").locator("tbody tr").allInnerTexts()) console.log("  short", flat(r).slice(0, 170));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow, "· expected 400s:", expected400.length);
console.log("problems:", problems.length ? problems : "none");
await b.close();
