/**
 * Drive HSE: rates with their base, a hot-work permit that is issued, a
 * confined-space entry that is not (and its SIMOPS flag), an incident whose
 * class moved with its facts, and an overdue observation.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-hse.mjs
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
const problems = [];
const expected400 = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => {
  if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) (r.status() === 400 ? expected400 : problems).push(`HTTP ${r.status()} ${r.url()}`);
});
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

await page.goto(BASE + "/hse", { waitUntil: "networkidle" });
await page.waitForSelector("h1"); await page.waitForTimeout(800);
const flat = (s) => s.replace(/\s+/g, " ").trim();
console.log("header:", flat(await page.locator(".pagehead .sub").innerText()));
for (const k of await page.locator(".kpi").allInnerTexts()) console.log("  kpi ", flat(k));
const warn = page.locator(".page > p.err");
if (await warn.count()) console.log("warning:", flat(await warn.first().innerText()));
const card = (h) => page.locator(".card", { has: page.locator("h2", { hasText: h }) }).first();
for (const r of await card("به تفکیک پیمانکار").locator("tbody tr").allInnerTexts()) console.log("  contractor", flat(r));
for (const r of await card("مجوز کار").locator("tbody > tr").allInnerTexts()) console.log("  permit", flat(r).slice(0, 190));
await page.screenshot({ path: `${SHOT}/92-hse.png`, fullPage: false });

// CS-0102: no standby named → the issue is refused, with the reasons.
const cs = card("مجوز کار").locator("tbody > tr", { hasText: "CS-0102" });
await cs.getByRole("button", { name: "صدور" }).click(); await page.waitForTimeout(1000);
console.log("CS-0102 issue:", flat(await page.locator(".page > p.err").first().innerText()));

// INC-0001: the class and the reason it changed.
const inc = card("رویدادها").locator("tbody > tr", { hasText: "INC-0001" });
console.log("INC-0001:", flat(await inc.innerText()));
await inc.getByRole("button", { name: "جزئیات" }).click(); await page.waitForTimeout(800);
console.log("  history:", flat(await card("رویدادها").locator("ul").first().innerText()));
console.log("INC-0004:", flat(await card("رویدادها").locator("tbody > tr", { hasText: "INC-0004" }).innerText()));

for (const r of await card("مشاهدات ایمنی").locator("tbody > tr").allInnerTexts()) console.log("  obs", flat(r).slice(0, 160));
await card("مشاهدات ایمنی").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/93-hse-obs.png` });

// A new observation through the form: kind travels apart from the request kind.
await page.locator(":is(.fold-btn, .fold-head)", { hasText: "ثبت مشاهدهٔ ایمنی" }).click();   // the form is folded until asked for
const form = page.locator("form", { has: page.locator("h2", { hasText: "ثبت مشاهده" }) });
const label = `Scaffold tag expired at PR-1201 (drive ${Date.now() % 100000})`;
await form.locator("#ob-desc").fill(label);
await form.locator("#ob-act").fill("Re-inspect and re-tag scaffold");
await form.locator("#ob-due").fill(new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10));
await form.getByRole("button", { name: "ثبت مشاهده" }).click(); await page.waitForTimeout(1200);
console.log("new obs:", flat(await card("مشاهدات ایمنی").locator("tbody > tr", { hasText: label }).innerText()));

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow);
console.log("expected 400s:", expected400.length);
console.log("problems:", problems.length ? problems : "none");
await b.close();
