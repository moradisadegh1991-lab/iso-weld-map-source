/**
 * Drive the siting card and the piping execution page in a real browser.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-execution.mjs
 */
import { chromium } from "playwright";
import { showAllTabs } from "./drive-tabs.mjs";

const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await showAllTabs(page);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => {
  if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`);
});

await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await page.click("button[type=submit]");
await page.waitForSelector(".shell");

// ── siting ───────────────────────────────────────────────────────────────
await page.goto(BASE + "/project", { waitUntil: "networkidle" });
await page.waitForSelector("#grade_elevation_mm");
console.log("grade field value      :", await page.inputValue("#grade_elevation_mm"));
console.log("latitude field value   :", await page.inputValue("#origin_latitude"));
const note = await page.locator("p.sm", { hasText: "زیرزمینی حساب می‌شود" }).innerText().catch(() => "(none)");
console.log("grade consequence note :", note.replace(/\s+/g, " ").slice(0, 90));
await page.screenshot({ path: `${SHOT}/10-project-siting.png`, fullPage: true });

// ── execution ────────────────────────────────────────────────────────────
await page.goto(BASE + "/piping/execution", { waitUntil: "networkidle" });
await page.waitForSelector("h1");
await page.waitForTimeout(600);
const rows = await page.locator(".dtable").nth(1).locator("tbody tr").count();
console.log("spool rows             :", rows);
console.log("buried table present   :", await page.locator("h2", { hasText: "زیرزمینی و روزمینی" }).count() === 1);
const buriedText = await page.locator(".card").first().innerText();
console.log("buried card            :", buriedText.replace(/\s+/g, " ").slice(0, 140));

// open the first spool's chain and record the next manual step
await page.locator("button", { hasText: "مراحل" }).first().click();
await page.waitForSelector("button:has-text('ثبت انجام')", { timeout: 8000 });
const derivedMarks = await page.locator("b", { hasText: "⚙" }).count();
console.log("derived steps marked ⚙ :", derivedMarks);
// Step cards only — the ones inside the expanded row. The outer card that
// holds the whole table also contains "⚙" (in its legend) and buttons, and
// counting it made a correct page look wrong.
const derivedButtons = await page.evaluate(() =>
  [...document.querySelectorAll("td .card")].filter((c) =>
    c.querySelector("b")?.innerText.includes("⚙") && c.querySelector("button")).length);
console.log("buttons on derived     :", derivedButtons, "(must be 0)");
await page.screenshot({ path: `${SHOT}/11-execution.png`, fullPage: true });

// add a spring hanger with no load: must be refused with the Persian reason
await page.fill("#s-no", "SH-TEST-1");
await page.selectOption("#s-kind", "spring_hanger");
await page.click("button:has-text('افزودن ساپورت')");
await page.waitForTimeout(700);
const err = await page.locator("p.err").first().innerText().catch(() => "(no error shown)");
console.log("spring w/o load        :", err);

const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("horizontal overflow    :", overflow + "px");
console.log("problems:", problems.filter((p) => !/HTTP 400 .*piping\/execution/.test(p)).length
  ? problems : "none (the one 400 is the refused spring hanger)");
await browser.close();
