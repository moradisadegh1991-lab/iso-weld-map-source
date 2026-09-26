/**
 * Drive MESC codes on the warehouse page: before a catalogue (not verified),
 * a test catalogue import, a catalogue search and pick, a refused duplicate.
 * The catalogue here is made up for the drive — not taken from any MESC book.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-mesc.mjs
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
await page.goto(BASE + "/warehouse", { waitUntil: "networkidle" }); await wait();
const card = page.locator(".card", { has: page.locator("h2", { hasText: "کد MESC کالاها" }) });
const rows = card.locator("table").first().locator("tbody > tr");
console.log("intro:", flat(await card.locator("p.muted").first().innerText()).slice(-90));
const first = flat(await rows.first().innerText());
const itemCode = first.split(" ")[0];
const uom = await rows.first().locator("td").nth(2).innerText();
console.log("first item:", itemCode, uom);

// A code before any catalogue: recorded, not verified.
await rows.first().getByRole("button", { name: "تعیین کد" }).click(); await wait(400);
await card.locator("input[id^=mc-]").fill("99.10.12.052.1");
await card.getByRole("button", { name: "ثبت کد" }).click(); await wait();
console.log("unverified:", flat(await rows.first().innerText()).slice(0, 160));

// Import a (test) catalogue: 99 group, two items in the first item's unit.
await card.locator("button.fold-head", { hasText: "بارگذاری کاتالوگ MESC" }).click();
await page.fill("#mesc-ed", "DRIVE TEST — not a real MESC book");
await page.fill("#mesc-text", `99,"TEST GROUP"\n9910,"TEST SUBGROUP"\n991012,"TEST SUB-SUB"\n9910120521,"TEST PIPE 10 IN",${uom}\n9910120531,"TEST PIPE 12 IN",${uom}\n12345,broken`);
await card.getByRole("button", { name: "بارگذاری", exact: true }).click(); await wait();
console.log("bad file:", flat(await card.locator("p.err").first().innerText()).slice(0, 120));
await page.fill("#mesc-text", `99,"TEST GROUP"\n9910,"TEST SUBGROUP"\n991012,"TEST SUB-SUB"\n9910120521,"TEST PIPE 10 IN",${uom}\n9910120531,"TEST PIPE 12 IN",${uom}`);
await card.getByRole("button", { name: "بارگذاری", exact: true }).click(); await wait(1500);
console.log("after import:", flat(await rows.first().innerText()).slice(0, 200));

// Search and pick for the second item; then try the first item's code on it.
await rows.nth(1).getByRole("button", { name: "تعیین کد" }).click(); await wait(400);
await card.locator("input[id^=mq-]").fill("test pipe 12");
await card.getByRole("button", { name: "جست‌وجو" }).click(); await wait();
for (const r of await card.locator(".card table tbody > tr").allInnerTexts()) console.log("  match", flat(r));
await card.locator(".card table tbody > tr", { hasText: "12 IN" }).getByRole("button", { name: "انتخاب" }).click();
await card.getByRole("button", { name: "ثبت کد" }).click(); await wait();
console.log("second item (EA vs catalogue m — refused):", flat(await rows.nth(1).innerText()).slice(0, 160));
await card.locator("input[id^=mc-]").fill("9910120521");
await card.getByRole("button", { name: "ثبت کد" }).click(); await wait();
console.log("refused (unit or duplicate):", flat(await card.locator("p.err").first().innerText()));
await card.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/120-mesc.png` });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow, "· expected 400s:", expected.length);
console.log("problems:", problems.length ? problems : "none");
await b.close();
