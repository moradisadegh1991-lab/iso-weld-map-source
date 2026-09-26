/**
 * Drive a spool's material on the piping execution page: the list from the
 * register, reserved in one act, then shown as reserved.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-spool-material.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => { if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`); });
const flat = (s) => s.replace(/\s+/g, " ").trim();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
await page.goto(BASE + "/piping/execution", { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
const row = page.locator("tbody > tr", { hasText: "SP-02" }).first();
await row.getByRole("button", { name: "مراحل" }).click(); await page.waitForTimeout(1500);
const mat = page.locator("table", { has: page.locator("th", { hasText: "رزرو / حواله" }) }).last();
for (const r of await mat.locator("tbody > tr").allInnerTexts()) console.log("  before", flat(r));
const btn = page.getByRole("button", { name: "رزرو مواد این اسپول" });
console.log("button:", await btn.count());
if (await btn.count()) { await btn.click(); await page.waitForTimeout(1500); }
for (const r of await mat.locator("tbody > tr").allInnerTexts()) console.log("  after ", flat(r));
await mat.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/170-spool-material.png` });
await page.goto(BASE + "/warehouse", { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
const res = page.locator(".card", { has: page.locator("h2", { hasText: "رزرو کالا" }) }).locator("tbody > tr", { hasText: "SP-02" });
for (const r of await res.allInnerTexts()) console.log("  warehouse", flat(r));
console.log("problems:", problems.length ? problems : "none");
await b.close();
