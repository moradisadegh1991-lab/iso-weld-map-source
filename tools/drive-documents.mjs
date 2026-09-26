/**
 * Drive document control: the register today and on a past date, the
 * uploaded isometric flagged as superseded, and an IFC refused before the
 * client's approval.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-documents.mjs
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
const problems = [], expected400 = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => {
  if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) (r.status() === 400 ? expected400 : problems).push(`HTTP ${r.status()} ${r.url()}`);
});
const flat = (s) => s.replace(/\s+/g, " ").trim();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

await page.goto(BASE + "/documents", { waitUntil: "networkidle" });
await page.waitForSelector(".kpi");
for (const k of await page.locator(".kpi").allInnerTexts()) console.log("  kpi ", flat(k));
const card = (h) => page.locator(".card", { has: page.locator("h2", { hasText: h }) }).first();
console.log("flag:", flat(await card("در برابر رجیستر").innerText()).slice(0, 220));
for (const r of await card("رجیستر مدارک (MDR)").locator("tbody > tr").allInnerTexts()) console.log("  mdr ", flat(r).slice(0, 160));
await page.screenshot({ path: `${SHOT}/107-documents.png` });

const past = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
await page.fill("#ondate", past); await page.waitForTimeout(1500);
const iso = card("رجیستر مدارک (MDR)").locator("tbody > tr", { hasText: "SW 265022A" });
console.log("10 days ago:", flat(await iso.innerText()).slice(0, 140));
await page.getByRole("button", { name: "امروز" }).click(); await page.waitForTimeout(1000);

const pid = card("رجیستر مدارک (MDR)").locator("tbody > tr", { hasText: "21-PID-001" });
await pid.getByRole("button", { name: "رویژن‌ها" }).click(); await page.waitForTimeout(500);
const panel = card("رجیستر مدارک (MDR)").locator("td[colspan='7']");
await panel.locator("input[id^=rv-]").fill("0");
await panel.locator("select[id^=rp-]").selectOption("IFC");
await panel.getByRole("button", { name: "صدور رویژن" }).click(); await page.waitForTimeout(1000);
console.log("IFC refused:", flat(await page.locator(".page > p.err").innerText()));
for (const r of await card("ترانسمیتال‌ها").locator("tbody tr").allInnerTexts()) console.log("  tr  ", flat(r).slice(0, 150));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow, "· expected 400s:", expected400.length);
console.log("problems:", problems.length ? problems : "none");
await b.close();
