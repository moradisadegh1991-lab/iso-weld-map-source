/**
 * Drive reservations and a stock count on the warehouse page: a reservation
 * refused past what is free, one made; a count with a difference; the
 * decision refused to the person who counted.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-stores.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
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
await page.goto(BASE + "/warehouse", { waitUntil: "networkidle" }); await wait();
const card = (h) => page.locator(".card", { has: page.locator("h2", { hasText: h }) }).first();
const err = async () => flat(await page.locator("p.err").first().innerText());

const rc = card("رزرو کالا");
for (const r of await rc.locator("tbody > tr").allInnerTexts()) console.log("  res", flat(r));
await rc.locator("button.fold-head", { hasText: "رزرو جدید" }).click();
const cableId = await page.locator("#rs-i option", { hasText: "CBL-3C35-XLPE" }).getAttribute("value");
await page.selectOption("#rs-i", cableId);
await page.fill("#rs-q", "100000");
await page.fill("#rs-p", "Substation lighting");
await rc.getByRole("button", { name: "رزرو", exact: true }).click(); await wait();
console.log("too much:", await err());
await page.fill("#rs-q", "25");
await rc.getByRole("button", { name: "رزرو", exact: true }).click(); await wait();
for (const r of await rc.locator("tbody > tr").allInnerTexts()) console.log("  res'", flat(r));

const cc = card("انبارگردانی");
await cc.locator("button.fold-head", { hasText: "انبارگردانی جدید" }).click();
await page.fill("#sc-no", "SC-DRIVE-01"); await page.fill("#sc-sc", "Cable yard");
await cc.getByRole("button", { name: "شروع انبارگردانی" }).click(); await wait();
const lotOpt = await cc.locator("select[id^=cl-l-] option", { hasText: "CBL-3C35-XLPE" }).first().getAttribute("value");
await cc.locator("select[id^=cl-l-]").selectOption(lotOpt);
await cc.locator("input[id^=cl-q-]").fill("7");
await cc.locator("input[id^=cl-b-]").fill("Storekeeper A");
await cc.getByRole("button", { name: "ثبت شمارش" }).click(); await wait();
for (const r of await cc.locator(".card tbody > tr").allInnerTexts()) console.log("  line", flat(r));
await cc.locator("input[aria-label='دلیل تصمیم']").fill("recount confirms");
await cc.getByRole("button", { name: "اصلاح دفتر" }).click(); await wait();
console.log("own count:", await err());
await cc.getByRole("button", { name: "بستن انبارگردانی" }).click(); await wait();
console.log("close:", await err());
await cc.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/130-stores.png`, fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow, "· expected 400s:", expected.length);
console.log("problems:", problems.length ? problems : "none");
await b.close();
