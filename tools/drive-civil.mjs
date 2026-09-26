/**
 * Drive the civil page: the board, a foundation's chain, recording a pour
 * and its breaks, and the class table.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-civil.mjs
 */
import { chromium } from "playwright";
import { showAllTabs } from "./drive-tabs.mjs";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }

const b = await chromium.launch({ executablePath: CHROME });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
await showAllTabs(page);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => { if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`); });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

await page.goto(BASE + "/civil", { waitUntil: "networkidle" });
await page.waitForSelector("h1"); await page.waitForTimeout(800);
console.log("header                 :", (await page.locator(".pagehead .sub").innerText()).replace(/\s+/g, " "));
const rows = await page.locator(".dtable").first().locator("tbody > tr").allInnerTexts();
for (const r of rows) console.log("  ", r.replace(/\s+/g, " ").slice(0, 150));

// The pipe-rack class: every test in the failed window must say its average.
const classText = await page.locator("h2", { hasText: "پذیرش بتن" }).locator("xpath=..").innerText();
console.log("C30 class verdict      :", /سطح مقاومت کلاس رضایت‌بخش نیست/.test(classText));
await page.screenshot({ path: `${SHOT}/30-civil.png`, fullPage: true });

// Open the demethanizer foundation and sign the next manual step.
await page.locator("tr", { hasText: "FDN-T-3102" }).locator("button", { hasText: "جزئیات" }).click();
await page.waitForSelector("button:has-text('ثبت انجام')", { timeout: 8000 });
const derivedButtons = await page.evaluate(() => [...document.querySelectorAll("td .card")]
  .filter((c) => c.querySelector("b")?.innerText.includes("⚙") && c.querySelector("button")).length);
console.log("buttons on ⚙ steps     :", derivedButtons, "(must be 0)");
await page.locator("td .card", { hasText: "انکر بولت" }).locator("button").click();
await page.waitForTimeout(900);
const emb = await page.locator("td .card", { hasText: "انکر بولت" }).innerText();
console.log("embedments after click :", emb.replace(/\s+/g, " ").slice(0, 80));

// Try to record a pour with the wrong class: it must be recorded and flagged.
await page.fill("#p-no", "PC-3102-T");
await page.fill("#p-vol", "210");
await page.fill("#p-cls", "C30");
await page.fill("#p-fc", "30");
await page.click("button:has-text('ثبت بتن‌ریزی')");
await page.waitForTimeout(1200);
const pourRow = await page.locator("tr", { hasText: "PC-3102-T" }).first().innerText().catch(() => "(missing)");
console.log("wrong-class pour row   :", pourRow.replace(/\s+/g, " "));
const outOfOrder = await page.locator("td .card", { hasText: "بتن‌ریزی" }).first().innerText();
console.log("pour step              :", outOfOrder.replace(/\s+/g, " ").slice(0, 100));
await page.screenshot({ path: `${SHOT}/31-civil-detail.png`, fullPage: true });

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("horizontal overflow    :", overflow + "px");
console.log("problems:", problems.length ? problems : "none");
await b.close();
