/**
 * Drive completions: the MC board and its blockers, a refused MC signature,
 * a package's walkdown and test pressure, and a test refused while held.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-completions.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const problems = [], expected400 = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => {
  if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) (r.status() === 400 ? expected400 : problems).push(`HTTP ${r.status()} ${r.url()}`);
});
const flat = (s) => s.replace(/\s+/g, " ").trim();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

const t0 = Date.now();
await page.goto(BASE + "/completions", { waitUntil: "networkidle" });
await page.waitForSelector("h1"); await page.waitForSelector(".kpi");
console.log("load ms:", Date.now() - t0);
console.log("header:", flat(await page.locator(".pagehead .sub").innerText()));
for (const k of await page.locator(".kpi").allInnerTexts()) console.log("  kpi ", flat(k));
const card = (h) => page.locator(".card", { has: page.locator("h2", { hasText: h }) }).first();
for (const r of await card("ساب‌سیستم‌ها").locator("tbody tr").allInnerTexts()) console.log("  mc  ", flat(r).slice(0, 190));
const disabled = await card("ساب‌سیستم‌ها").getByRole("button", { name: "امضای MC" }).evaluateAll((bs) => bs.filter((x) => x.disabled).length);
console.log("MC buttons disabled:", disabled);
await page.screenshot({ path: `${SHOT}/103-completions.png` });

const packs = card("پکیج‌های تست");
for (const r of await packs.locator("tbody > tr").allInnerTexts()) console.log("  pack", flat(r).slice(0, 150));
await packs.locator("tbody > tr", { hasText: "TP-60-001" }).getByRole("button", { name: "جزئیات" }).click();
await page.waitForTimeout(800);
const det = packs.locator("td[colspan='7']").first();
console.log("  basis:", flat(await det.locator("p.mono").innerText()));
console.log("  blockers:", flat(await det.locator("ul").innerText()));
await det.locator("input[id^=ta-]").fill("15.5");
await det.locator("input[id^=th-]").fill("30");
await det.locator("input[id^=tg-]").fill("GC-2026-114");
await det.locator("select[id^=tl-]").selectOption("false");
await det.getByRole("button", { name: "ثبت تست" }).click(); await page.waitForTimeout(1000);
console.log("test refused:", flat(await page.locator(".page > p.err").innerText()).slice(0, 160));
await det.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/104-completions-pack.png` });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow, "· expected 400s:", expected400.length);
console.log("problems:", problems.length ? problems : "none");
await b.close();
