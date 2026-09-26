/**
 * Drive incoming transmittals: register one with a PDF, open the stored
 * file, finish a review, a refused reply code, then the reply.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-incoming.mjs
 */
import { chromium } from "playwright";
import { showAllTabs } from "./drive-tabs.mjs";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const pdfPath = path.join(await mkdtemp(path.join(tmpdir(), "drive-pdf-")), "60-PID-001_Rev1.pdf");
await writeFile(pdfPath, `%PDF-1.4\n% drive test ${Date.now()}\n%%EOF\n`);
const b = await chromium.launch({ executablePath: CHROME });
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await showAllTabs(page);
const problems = [], expected = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => {
  if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) (r.status() === 400 ? expected : problems).push(`HTTP ${r.status()} ${r.url()}`);
});
const flat = (s) => s.replace(/\s+/g, " ").trim();
const wait = (ms = 1200) => page.waitForTimeout(ms);
const err = async () => flat(await page.locator("p.err").first().innerText());
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
await page.goto(BASE + "/documents", { waitUntil: "networkidle" });
await page.getByRole("tab", { name: "ترانسمیتال‌های ورودی از طراح" }).click(); await wait();
console.log("header:", flat(await page.locator(".pagehead .sub").innerText()));
for (const r of await page.locator("table.dtable").first().locator("tbody > tr").allInnerTexts()) console.log("  item", flat(r).slice(0, 170));

// Register a designer transmittal with a file.
await page.locator("button.fold-head", { hasText: "ثبت ترانسمیتال ورودی" }).click();
await page.fill("#in-no", "DES-TR-0113"); await page.fill("#in-from", "Design contractor (demo)"); await page.fill("#in-purpose", "For construction");
await page.fill("input[aria-label='مدرک 1']", "60-PID-001"); await page.fill("input[aria-label='رویژن 1']", "1");
await page.selectOption("select[aria-label='هدف 1']", "IFC");
await page.setInputFiles("input[aria-label='فایل 1']", pdfPath);
await page.getByRole("button", { name: "ثبت ترانسمیتال", exact: true }).click(); await wait(2000);
const newRow = page.locator("tbody > tr", { hasText: "60-PID-001" }).first();
console.log("registered:", flat(await newRow.innerText()).slice(0, 170));
const href = await newRow.locator("a").first().getAttribute("href");
const file = await page.evaluate(async (u) => { const r = await fetch(u); return `${r.status} ${r.headers.get("content-type")} ${(await r.text()).slice(0, 8)}`; }, href);
console.log("file:", file);

// 21-PID-001 Rev B: finish Process, a code that contradicts the record, then code 2.
const pidRow = page.locator("tbody > tr", { hasText: "21-PID-001" }).first();
await pidRow.getByRole("button", { name: "بررسی" }).click(); await wait(500);
await page.getByRole("button", { name: "پایان بررسی" }).first().click(); await wait();
await page.locator("button.fold-head", { hasText: "پاسخ به DES-TR-0112" }).click();
await page.selectOption("select[aria-label='کد 21-PID-001']", "1");
await page.fill("input[id^=rp-no-]", "PRJ-TR-0201");
await page.getByRole("button", { name: "ثبت پاسخ", exact: true }).click(); await wait();
console.log("code 1 refused:", await err());
await page.selectOption("select[aria-label='کد 21-PID-001']", "2");
await page.selectOption("select[aria-label='کد 21-DS-K2101-01']", "4");
await page.getByRole("button", { name: "ثبت پاسخ", exact: true }).click(); await wait(1500);
for (const k of ["21-PID-001", "21-DS-K2101-01"]) console.log("  after", flat(await page.locator("tbody > tr", { hasText: k }).first().innerText()).slice(0, 190));
await page.screenshot({ path: `${SHOT}/140-incoming.png`, fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow, "· expected 400s:", expected.length);
console.log("problems:", problems.length ? problems : "none");
await b.close();
