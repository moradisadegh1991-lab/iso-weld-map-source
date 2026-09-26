/**
 * Drive the material ITP split: two scopes on the inspection page, and the
 * warehouse page showing each lot held by its own scope's ITP only.
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

await page.goto(BASE + "/inspection", { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
const card = (h) => page.locator(".card", { has: page.locator("h2", { hasText: h }) }).first();
// The ITP list should show two distinct material scopes.
const itpTable = page.locator("table").first();
for (const r of await itpTable.locator("tbody > tr").allInnerTexts()) if (/MAT/.test(r)) console.log("  itp row:", flat(r).slice(0, 160));
await page.screenshot({ path: `${SHOT}/180-inspection-itps.png`, fullPage: true });

await page.goto(BASE + "/warehouse", { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
const stockTable = page.locator("table").first();
for (const key of ["MRR-0019", "MRR-0020"]) {
  const row = page.locator("tbody > tr", { hasText: key }).first();
  console.log(`  ${key}:`, flat(await row.innerText()).slice(0, 220));
}
await page.screenshot({ path: `${SHOT}/181-warehouse-lots.png`, fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow);
console.log("problems:", problems.length ? problems : "none");
await b.close();
