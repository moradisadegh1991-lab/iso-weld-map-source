/**
 * Drive the handover page: the checklist per tag, a criticality outside the
 * policy refused, a nameplate saved with its history, and the CSV export.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-handover.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const problems = [], expected400 = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => {
  if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) (r.status() === 400 ? expected400 : problems).push(`HTTP ${r.status()} ${r.url()}`);
});
const flat = (s) => s.replace(/\s+/g, " ").trim();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

await page.goto(BASE + "/handover", { waitUntil: "networkidle" });
await page.waitForSelector(".kpi");
console.log("header:", flat(await page.locator(".pagehead .sub").innerText()));
for (const k of await page.locator(".kpi").allInnerTexts()) console.log("  kpi ", flat(k));
const table = page.locator(".card", { has: page.locator("h2", { hasText: "شناسنامهٔ نگهداری" }) });
for (const no of ["K-2101", "P-1203A", "P-6101A", "T-3102"]) {
  console.log("  row ", flat(await table.locator("tbody > tr", { hasText: no }).first().innerText()).slice(0, 200));
}
await page.screenshot({ path: `${SHOT}/108-handover.png` });

const row = table.locator("tbody > tr", { hasText: "P-1203A" }).first();
await row.getByRole("button", { name: "ویرایش" }).click(); await page.waitForTimeout(800);
const form = table.locator("form").first();
await form.locator("input[id^=sn-]").fill("P-1203A-SN-0091");
await form.getByRole("button", { name: "ذخیره" }).click(); await page.waitForTimeout(1200);
console.log("after save:", flat(await table.locator("tbody > tr", { hasText: "P-1203A" }).first().innerText()).slice(0, 200));
console.log("history:", flat(await table.locator("form ol").first().innerText()).slice(0, 200));

const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "خروجی CSV (همه)" }).click()]);
const path = await dl.path();
const { readFileSync } = await import("node:fs");
const csv = readFileSync(path, "utf8");
console.log("csv file:", dl.suggestedFilename(), "bom:", csv.charCodeAt(0) === 0xfeff, "lines:", csv.trim().split("\r\n").length);
console.log("csv K-2101:", csv.split("\r\n").find((l) => l.includes('"K-2101"')).slice(0, 180));
await page.reload({ waitUntil: "networkidle" });
console.log("export log:", flat(await page.locator(".card", { has: page.locator("h2", { hasText: "خروجی‌های" }) }).innerText()).slice(0, 160));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow, "· expected 400s:", expected400.length);
console.log("problems:", problems.length ? problems : "none");
await b.close();
