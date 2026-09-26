/**
 * Drive project controls: the project indices, each account's EV source,
 * an S-curve, a refused re-baseline, a moved data date, the monthly
 * snapshot and its history, and the risks.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-controls.mjs
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
  if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) ([400, 409].includes(r.status()) ? expected400 : problems).push(`HTTP ${r.status()} ${r.url()}`);
});
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

await page.goto(BASE + "/controls", { waitUntil: "networkidle" });
await page.waitForSelector("h1"); await page.waitForTimeout(800);
const flat = (s) => s.replace(/\s+/g, " ").trim();
console.log("header:", flat(await page.locator(".pagehead .sub").innerText()));
for (const k of await page.locator(".kpi").allInnerTexts()) console.log("  kpi ", flat(k));
const card = (h) => page.locator(".card", { has: page.locator("h2", { hasText: h }) }).first();
for (const r of await card("حساب‌های کنترلی").locator("tbody > tr").allInnerTexts()) console.log("  acct", flat(r).slice(0, 200));
await page.screenshot({ path: `${SHOT}/94-controls.png` });

const civ = card("حساب‌های کنترلی").locator("tbody > tr", { hasText: "CA-10-CIV" });
await civ.getByRole("button", { name: "جزئیات" }).click(); await page.waitForTimeout(1200);
const det = page.locator("td[colspan='11']").first();
console.log("  detail:", flat(await det.locator("p.mono").innerText()));
console.log("  baselines:", flat(await det.locator("ul").innerText()));
console.log("  s-curve circles:", await det.locator("svg circle").count());
await det.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/95-controls-account.png` });

// A falling curve is refused.
await det.locator("textarea").fill("2026-01-01, 30\n2026-02-01, 20");
await det.locator("input[id^=blr-]").fill("1");
await det.locator("input[id^=bls-]").fill("drive test");
await det.getByRole("button", { name: "صدور" }).click(); await page.waitForTimeout(1000);
console.log("rebaseline refused:", flat(await page.locator(".page > p.err").first().innerText()));

// Move the data date back 30 days: platform EV withdraws, reported EV stays.
const back = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
await page.fill("#asof", back); await page.waitForTimeout(1500);
for (const r of await card("حساب‌های کنترلی").locator("tbody > tr").allInnerTexts()) console.log("  @-30d", flat(r).slice(0, 160));
await page.getByRole("button", { name: "امروز" }).click(); await page.waitForTimeout(1000);

// The monthly snapshot: taken once for today, then the history shows it and
// a later data date reads it (labelled with its own date).
const snapBtn = page.getByRole("button", { name: "ثبت اسنپ‌شات امروز" });
console.log("snapshot button:", await snapBtn.count());
if (await snapBtn.count()) { await snapBtn.click(); await page.waitForTimeout(2500); }
console.log("after snapshot:", await page.locator(".pill", { hasText: "اسنپ‌شات امروز ثبت شده" }).count() ? "button replaced by 'recorded' pill" : "NO PILL");
const hist = card("تاریخچهٔ ماهانه");
for (const r of await hist.locator("tbody > tr").allInnerTexts()) console.log("  hist", flat(r).slice(0, 120));
await hist.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/97-controls-snapshots.png` });
const again = await page.evaluate(async () => {
  const pid = localStorage.getItem("epc.lastProject") || (await (await fetch("/api/projects")).json()).projects[0].id;
  const r = await fetch("/api/controls", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: pid, kind: "snapshot" }) });
  return `${r.status} ${(await r.json()).error || ""}`;
});
console.log("second snapshot today:", again);
const fwd = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
await page.fill("#asof", fwd); await page.waitForTimeout(1500);
for (const r of await card("حساب‌های کنترلی").locator("tbody > tr").allInnerTexts()) console.log("  @+1d", flat(r).slice(0, 170));
await page.getByRole("button", { name: "امروز" }).click(); await page.waitForTimeout(1000);

for (const r of await card("رجیستر ریسک").locator("tbody > tr").allInnerTexts()) console.log("  risk", flat(r).slice(0, 170));
await card("رجیستر ریسک").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/96-controls-risk.png` });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow);
console.log("expected 400/409s:", expected400.length);
console.log("problems:", problems.length ? problems : "none");
await b.close();
