/**
 * Drive NDT of structural, support and equipment welds: the matrix (a UT
 * rule on a fillet refused), the UT sample draw, a rejected sample → the
 * whole lot, the structure's weld-NDT step, and a support held by its weld.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-ndt-joints.mjs
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
page.on("response", (r) => { if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) (r.status() === 400 ? expected : problems).push(`HTTP ${r.status()} ${r.url()}`); });
const flat = (s) => s.replace(/\s+/g, " ").trim();
const wait = (ms = 1200) => page.waitForTimeout(ms);
const msg = async () => flat(await page.locator(".page > p.err, .page > p.muted").first().innerText());
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
await page.goto(BASE + "/ndt-joints", { waitUntil: "networkidle" }); await wait();
console.log("header:", flat(await page.locator(".pagehead .sub").innerText()));
const card = (h) => page.locator(".card", { has: page.locator("h2", { hasText: h }) }).first();
for (const r of await card("ماتریس NDT").locator("tbody > tr").allInnerTexts()) console.log("  rule", flat(r).slice(0, 150));

await card("ماتریس NDT").locator(":is(.fold-btn, .fold-head)", { hasText: "قاعدهٔ جدید" }).click();
await page.selectOption("#r-j", "fillet"); await page.selectOption("#r-m", "UT"); await page.fill("#r-p", "10"); await page.fill("#r-b", "drive");
await page.getByRole("button", { name: "ثبت قاعده" }).click(); await wait();
console.log("UT on fillet:", await msg());

const reg = card("رجیستر جوش‌ها");
for (const r of await reg.locator("tbody > tr").allInnerTexts()) console.log("  joint", flat(r).slice(0, 170));
const samp = card("نمونه‌گیری");
console.log("sampling:", flat(await samp.innerText()).slice(0, 200));
await samp.getByRole("button", { name: "قرعه", exact: true }).first().click(); await wait(1500);
console.log("drawn:", await msg());

// Reject the sampled weld's UT: the rule says every weld of the lot.
const drawnNo = (await msg()).match(/قرعه: ([^—]+)/)[1].split("،")[0].trim();
const row = reg.locator("tbody > tr", { hasText: drawnNo });
await row.getByRole("button", { name: "ثبت" }).click(); await wait(500);
await page.selectOption("select[id^=nm-]", "UT"); await page.selectOption("select[id^=nr-]", "reject");
await page.fill("input[id^=nd-]", "lack of fusion");
await page.getByRole("button", { name: "ثبت NDT" }).click(); await wait(1500);
for (const r of await reg.locator("tbody > tr").allInnerTexts()) console.log("  joint'", flat(r).slice(0, 170));
await page.screenshot({ path: `${SHOT}/160-ndt-joints.png`, fullPage: true });

await page.goto(BASE + "/structural", { waitUntil: "networkidle" }); await wait(1500);
const t = await page.locator("body").innerText();
console.log("structural page mentions weld NDT step:", /NDT جوش‌های میدانی/.test(t));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow, "· expected 400s:", expected.length);
console.log("problems:", problems.length ? problems : "none");
await b.close();
