/**
 * Drive procurement phase 2: an MR with two revisions, bid evaluation and
 * ranking, an award that is not the lowest (refused, then justified), and a
 * vendor's data sheet from incomplete to accepted into the asset master.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-tender.mjs
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
const problems = [], expected = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => {
  if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) (r.status() === 400 ? expected : problems).push(`HTTP ${r.status()} ${r.url()}`);
});
const flat = (s) => s.replace(/\s+/g, " ").trim();
const wait = (ms = 1200) => page.waitForTimeout(ms);
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

await page.goto(BASE + "/procurement", { waitUntil: "networkidle" });
await page.getByRole("tab", { name: "درخواست خرید و مناقصه" }).click(); await wait();
console.log("header:", flat(await page.locator(".pagehead .sub").innerText()));
const mrRow = page.locator("tbody > tr", { hasText: "MR-M-0201" });
console.log("mr:", flat(await mrRow.innerText()));
await mrRow.getByRole("button", { name: "جزئیات" }).click(); await wait();
const bids = () => page.locator("table", { has: page.locator("th", { hasText: "چرا ارزیابی نمی‌شود" }) }).locator("tbody > tr");
for (const r of await bids().allInnerTexts()) console.log("  bid", flat(r).slice(0, 190));
await page.screenshot({ path: `${SHOT}/110-tender.png`, fullPage: true });

// Vendor C is cheapest but not evaluated yet: evaluate it, it becomes lowest.
await bids().filter({ hasText: "V-PUMP3" }).getByRole("button", { name: "قابل‌قبول" }).click(); await wait();
for (const r of await bids().allInnerTexts()) console.log("  bid'", flat(r).slice(0, 190));

// Award to vendor B (not the lowest): refused without a reason.
await page.locator(":is(.fold-btn, .fold-head)", { hasText: "واگذاری و صدور PO" }).click();
const opt = await page.locator("select[id^=a-b-] option", { hasText: "V-PUMP2" }).getAttribute("value");
await page.selectOption("select[id^=a-b-]", opt);
await page.fill("input[id^=a-p-]", "PO-M-0201");
await page.getByRole("button", { name: "واگذاری و صدور PO", exact: true }).click(); await wait();
console.log("award without reason:", flat(await page.locator(".page > p.err").first().innerText()));
await page.fill("input[id^=a-j-]", "Shortest delivery; vendor C 34 weeks misses the RFSU window");
await page.getByRole("button", { name: "واگذاری و صدور PO", exact: true }).click(); await wait(1800);
console.log("after award:", flat(await mrRow.innerText()));

// Vendor data: P-1203A incomplete, then complete, then accepted.
await page.getByRole("tab", { name: "دادهٔ فنی وندور (VDT)" }).click(); await wait();
const tagRow = page.locator("tbody > tr", { hasText: "P-1203A" });
console.log("vdt before:", flat(await tagRow.innerText()).slice(0, 220));
await tagRow.getByRole("button", { name: "ثبت / بررسی" }).click(); await wait(600);
const vals = { manufacturer: "Pump vendor (demo)", model: "API 610 OH2", serial_no: "PV-1203A-8812", year_built: "2026", rated_flow: "340", rated_head: "92", driver_power: "160" };
for (const [k, v] of Object.entries(vals)) await page.fill(`input[id$="-${k}"]`, v);
await page.fill('input[id$="-ref"]', "TR-PV-0040");
await page.getByRole("button", { name: "ثبت ارسال وندور" }).click(); await wait();
console.log("vdt submitted:", flat(await tagRow.innerText()).slice(0, 200));
await page.getByRole("button", { name: "پذیرش" }).click(); await wait(1500);
console.log("vdt accepted:", flat(await tagRow.innerText()).slice(0, 200));
await page.screenshot({ path: `${SHOT}/111-vdt.png`, fullPage: true });

await page.goto(BASE + "/handover", { waitUntil: "networkidle" }); await wait();
console.log("asset master:", flat(await page.locator("tbody > tr", { hasText: "P-1203A" }).first().innerText()).slice(0, 220));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow, "· expected 400s:", expected.length);
console.log("problems:", problems.length ? problems : "none");
await b.close();
