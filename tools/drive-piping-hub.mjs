/**
 * Drive the piping hub: KPIs, NDT compliance, a progressive-examination draw,
 * lines, welders, the weld log,
 * and the shared piping bar on every piping page.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-piping-hub.mjs
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
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => { if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`); });
const flat = (s) => s.replace(/\s+/g, " ").trim();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
await page.goto(BASE + "/piping/overview", { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
console.log("header:", flat(await page.locator(".pagehead .sub").innerText()));
for (const k of await page.locator(".kpi").allInnerTexts()) console.log("  kpi", flat(k));
const card = (h) => page.locator(".card", { has: page.locator("h2", { hasText: h }) }).first();
console.log("ndt open:", flat(await card("NDT: آنچه").innerText()).slice(0, 300));
for (const r of (await card("خطوط").locator("tbody > tr").allInnerTexts()).slice(0, 6)) console.log("  line", flat(r).slice(0, 220));
for (const r of (await card("جوشکاران").locator("tbody > tr").allInnerTexts()).slice(0, 4)) console.log("  welder", flat(r));
if (await card("اطلاعات ناقص").count()) console.log("missing:", flat(await card("اطلاعات ناقص").innerText()).slice(0, 300));
const lots = card("بازرسی تدریجی");
if (await lots.count()) {
  for (const r of await lots.locator("tbody > tr").allInnerTexts()) console.log("  lot", flat(r));
  const btn = lots.getByRole("button", { name: /قرعهٔ/ });
  if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(1500); console.log("drawn:", flat(await page.locator(".page p").filter({ hasText: "قرعه کشیده شد" }).first().innerText())); }
  for (const r of await lots.locator("tbody > tr").allInnerTexts()) console.log("  lot'", flat(r));
}
await page.screenshot({ path: `${SHOT}/150-piping-hub.png`, fullPage: true });
const log = await page.evaluate(async () => { const a = [...document.querySelectorAll("a")].find((x) => /Weld Log/.test(x.textContent));
  const r = await fetch(a.href); const t = await r.text(); return `${r.status} rows=${t.split("\r\n").length - 1} head=${t.split("\r\n")[0].slice(1, 90)}`; });
console.log("weld log:", log);
for (const p of ["/piping", "/piping/execution", "/piping/joint", "/qc"]) {
  await page.goto(BASE + p, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
  const cur = await page.locator(".section-tabs [aria-current=page]").innerText().catch(() => "MISSING");
  console.log(`bar on ${p}:`, cur);
}
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow);
console.log("problems:", problems.length ? problems : "none");
await b.close();
