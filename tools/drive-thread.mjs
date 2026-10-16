/**
 * Drive the missing-information / assumption register and the asset page.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-thread.mjs
 */
import { chromium } from "playwright";
import { showAllTabs } from "./drive-tabs.mjs";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }

const b = await chromium.launch({ executablePath: CHROME });
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await showAllTabs(page);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => { if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`); });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

await page.goto(BASE + "/assumptions", { waitUntil: "networkidle" });
await page.waitForSelector("h1"); await page.waitForTimeout(800);
console.log("header :", (await page.locator(".pagehead .sub").innerText()).replace(/\s+/g, " "));
for (const r of await page.locator(".card").nth(0).locator("tbody tr").allInnerTexts())
  console.log("  missing", r.replace(/\s+/g, " ").slice(0, 150));
for (const r of await page.locator(".card").nth(1).locator("tbody > tr").allInnerTexts())
  console.log("  assume ", r.replace(/\s+/g, " ").slice(0, 110));
await page.screenshot({ path: `${SHOT}/80-assumptions.png`, fullPage: false });

// Revise an approved assumption: it must go back under review, with history.
const row = page.locator(".card").nth(1).locator("tbody > tr", { hasText: "A-003" }).first();
await row.getByRole("button").click(); await page.waitForTimeout(600);
await page.fill("#rv-val", "Ethane (C2 ≥ 95 mol%)");
await page.fill("#rv-why", "Feed spec Rev.B");
await page.click("text=ثبت رویژن جدید"); await page.waitForTimeout(1200);
console.log("A-003 after revise:", (await page.locator(".card").nth(1).locator("tbody > tr", { hasText: "A-003" }).first().innerText()).replace(/\s+/g, " "));
console.log("history rows:", await page.locator("td[colspan] table tbody tr").count());

await page.goto(BASE + "/asset?tag=P-1203A", { waitUntil: "networkidle" });
await page.waitForSelector("text=آمادگی دیجیتال"); await page.waitForTimeout(800);
for (const c of await page.locator(".grid2 > .card").allInnerTexts()) console.log("  sect ", c.replace(/\s+/g, " ").slice(0, 160));
console.log("readiness:", (await page.locator(".card").first().innerText()).replace(/\s+/g, " ").slice(0, 400));
await page.screenshot({ path: `${SHOT}/81-asset.png`, fullPage: false });
// Follow the foundation link: the thread moves to the foundation, which carries the pump.
await page.locator("a.mono", { hasText: "FDN-P-1203A" }).click(); await page.waitForTimeout(1200);
console.log("url after link:", page.url(), "|", (await page.locator(".card").first().innerText()).replace(/\s+/g, " ").slice(0, 120));
await page.fill("input[aria-label=تگ]", "ZZ-000"); await page.getByRole("button", { name: "نمایش", exact: true }).click(); await page.waitForTimeout(800);
console.log("unknown tag:", await page.locator("p.err").innerText());

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow);
console.log("problems:", problems.filter((p) => !/api\/asset.*ZZ-000/.test(p)).length ? problems : "none (404 for the unknown tag is expected)");
await b.close();
