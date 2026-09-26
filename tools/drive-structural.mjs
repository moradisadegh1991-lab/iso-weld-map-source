/**
 * Drive the structural page: the board, a structure waiting on civil, a
 * platform held by one column and one bolt lot, and a re-shoot clearing it.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-structural.mjs
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

await page.goto(BASE + "/structural", { waitUntil: "networkidle" });
await page.waitForSelector("h1"); await page.waitForTimeout(800);
console.log("header :", (await page.locator(".pagehead .sub").innerText()).replace(/\s+/g, " "));
const rows = await page.locator(".dtable").first().locator("tbody > tr").allInnerTexts();
for (const r of rows) console.log("  ", r.replace(/\s+/g, " ").slice(0, 160));
await page.screenshot({ path: `${SHOT}/40-structural.png` });

const row = (no) => page.locator(".dtable").first().locator("tbody > tr", { hasText: no }).first();
await row("PL-2101").getByRole("button").click();
await page.waitForSelector("text=نقشه‌برداری شاقولی");
await page.waitForTimeout(500);
for (const code of ["شاقولی و تراز", "سفت‌کاری نهایی", "ضدحریق"]) {
  const card = page.locator("td .card").filter({ hasText: code }).first();
  console.log(`step ${code}:`, (await card.innerText()).replace(/\s+/g, " ").slice(0, 200),
    "| buttons:", await card.locator("button").count());
}
await page.screenshot({ path: `${SHOT}/41-structural-detail.png`, fullPage: true });

// Re-shoot C3 after correction: the survey should now accept the platform.
await page.fill("#pl-mark", "C3"); await page.fill("#pl-h", "6000");
await page.fill("#pl-dx", "6"); await page.fill("#pl-dy", "3");
await page.click("text=ثبت قرائت"); await page.waitForTimeout(1500);
const plumb = page.locator("td .card").filter({ hasText: "شاقولی و تراز" }).first();
console.log("after re-shoot:", (await plumb.innerText()).replace(/\s+/g, " ").slice(0, 120));

// Grade switch must not keep a method of the other family.
await page.selectOption("#bt-grade", "A325M");
console.log("method after switching to ASTM:", await page.inputValue("#bt-method"));
await page.selectOption("#bt-grade", "10.9");
console.log("method after switching to EN  :", await page.inputValue("#bt-method"));

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const stray = await page.evaluate(() => [...document.querySelectorAll(".field .hint")]
  .filter((h) => { const f = h.closest(".field").getBoundingClientRect(), r = h.getBoundingClientRect();
    return r.top < f.top - 1 || r.bottom > f.bottom + 1; }).length);
console.log("horizontal overflow px:", overflow, "· hints outside their field:", stray);

await page.goto(BASE + "/civil", { waitUntil: "networkidle" }); await page.waitForTimeout(600);
const pr = await page.locator(".dtable").first().locator("tbody > tr", { hasText: "FDN-PR-01" }).innerText();
console.log("civil FDN-PR-01:", pr.replace(/\s+/g, " ").slice(0, 120));
await page.goto(BASE + "/project", { waitUntil: "networkidle" }); await page.waitForTimeout(600);
console.log("project steel standard:", await page.inputValue("#steel_erection_standard"));

console.log("problems:", problems.length ? problems : "none");
await b.close();
