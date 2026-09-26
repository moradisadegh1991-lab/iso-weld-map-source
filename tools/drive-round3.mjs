/**
 * Drive the derived spool stage, the units card and the fired kind.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-round3.mjs
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

// 1. execution board: derived stage column and per-line grade
await page.goto(BASE + "/piping/execution", { waitUntil: "networkidle" });
await page.waitForSelector("h1"); await page.waitForTimeout(600);
const stages = await page.evaluate(() => [...document.querySelectorAll(".dtable")][1]
  .querySelectorAll("tbody tr").length);
const buriedRow = await page.locator(".dtable").first().locator("tbody tr").first().innerText();
console.log("buried row             :", buriedRow.replace(/\s+/g, " "));
const stageCells = await page.evaluate(() => [...[...document.querySelectorAll(".dtable")][1]
  .querySelectorAll("tbody tr")].map((tr) => tr.children[2]?.innerText).filter(Boolean));
console.log("stage column           :", stageCells.join(" | "), `(${stages} rows)`);
await page.screenshot({ path: `${SHOT}/20-execution-stage.png`, fullPage: true });

// 2. project page: units card with the utilities override
await page.goto(BASE + "/project", { waitUntil: "networkidle" });
await page.waitForSelector("h2:has-text('واحدها')");
const unitRows = await page.locator("h2:has-text('واحدها')").locator("xpath=..")
  .locator("tbody tr").allInnerTexts();
console.log("units                  :", unitRows.map((r) => r.replace(/\s+/g, " ").trim()).join(" || "));
await page.locator("h2:has-text('واحدها')").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/21-units.png`, fullPage: true });

// 3. equipment: furnaces labelled as fired, and the classify buttons offer all kinds
await page.goto(BASE + "/equipment", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const furnace = await page.locator("tr", { hasText: "F-1101A" }).last().innerText();
console.log("furnace row            :", furnace.replace(/\s+/g, " "));
const buttons = await page.locator("tr", { hasText: "PK-3101" }).first().locator("button").allInnerTexts();
console.log("classify buttons       :", buttons.join(" | "));

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("horizontal overflow    :", overflow + "px");
console.log("problems:", problems.length ? problems : "none");
await b.close();
