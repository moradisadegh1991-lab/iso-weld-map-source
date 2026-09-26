/**
 * Drive the warehouse: stock by lot, shortage against the MTO, an issue the
 * MTC blocks, and the heat trace that is the recall list.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-warehouse.mjs
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

await page.goto(BASE + "/warehouse", { waitUntil: "networkidle" });
await page.waitForSelector("h1"); await page.waitForTimeout(800);
console.log("header :", (await page.locator(".pagehead .sub").innerText()).replace(/\s+/g, " "));
const card = (h) => page.locator(".card", { has: page.locator("h2", { hasText: h }) }).first();
for (const r of await card("نیاز MTO").locator("tbody tr").allInnerTexts()) console.log("  need ", r.replace(/\s+/g, " "));
for (const r of await card("موجودی به تفکیک لات").locator("tbody > tr").allInnerTexts()) console.log("  lot  ", r.replace(/\s+/g, " ").slice(0, 150));
await page.screenshot({ path: `${SHOT}/90-warehouse.png` });

// The elbows: accepted on MIR, MTC not reviewed — an issue must be refused.
const elbow = card("موجودی به تفکیک لات").locator("tbody > tr", { hasText: "ELL90" }).first();
await elbow.getByRole("button").click(); await page.waitForTimeout(500);
const detail = page.locator("td[colspan]").first();
console.log("elbow hold:", (await detail.locator("p.err").innerText()).replace(/\s+/g, " "));
await detail.locator("input[id^=mq-]").fill("2");
await detail.locator("select[id^=ms-]").selectOption({ index: 1 });
await detail.getByRole("button", { name: "ثبت", exact: true }).click(); await page.waitForTimeout(1000);
console.log("issue refused:", (await page.locator(".page > p.err").innerText()).replace(/\s+/g, " "));

await page.fill("input[aria-label='شمارهٔ ذوب']", "h-77120");
await page.getByRole("button", { name: "جستجو" }).click(); await page.waitForTimeout(1000);
console.log("trace:", (await card("ردیابی شمارهٔ ذوب").innerText()).replace(/\s+/g, " ").slice(0, 300));
await card("ردیابی شمارهٔ ذوب").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/91-warehouse-trace.png` });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow);
console.log("problems:", problems.length ? problems : "none");
await b.close();
