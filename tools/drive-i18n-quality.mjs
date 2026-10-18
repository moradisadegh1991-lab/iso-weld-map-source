/**
 * Drive the «کیفیت و بازرسی» section in three languages (production build, seeded DEMO):
 * Punch و NCR, inspection (its three tabs), NDT of structural/support/equipment
 * welds and the section log. In English and Arabic the page's own words —
 * headings, column heads, labels, buttons, KPIs, options, notes — carry no
 * Persian (the project's data may: a description typed in Persian stays so);
 * in Persian the pages read as they did before.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-i18n-quality.mjs
 */
import { chromium } from "playwright";
import { showAllTabs } from "./drive-tabs.mjs";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const flat = (s) => s.replace(/\s+/g, " ").trim();
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
await showAllTabs(page);
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

const setLang = async (lang) => {
  await page.evaluate((l) => fetch("/api/auth/prefs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang: l }) }), lang);
  await page.evaluate((l) => localStorage.setItem("epc.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("epc.prefs") || "{}"), lang: l })), lang);
};
// The page's own words: what the page writes, not the project's data in the table cells.
const chrome = () => page.evaluate(() => {
  const sel = ".page h1, .page h2:not(.mono), .page th, .page label, .page button, .page .kpi .l, .page .kpi .b, .page .empty-note, .page .pagehead .sub, .page option, .page .muted.sm:not(td *), .page .tk-n";
  return [...document.querySelectorAll(sel)].filter((n) => n.offsetParent !== null || n.tagName === "OPTION")
    .map((n) => n.innerText || n.textContent).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
});
const PERSIAN = /[\u0600-\u06FF]/;
// Persian's own letters (پ چ ژ گ and the Persian ی and ک): Arabic writes ي and ك, and has none of the four
const PERSIAN_ONLY = /[\u067E\u0686\u0698\u06AF\u06CC\u06A9]/;
const visit = async (path, open) => {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".page h1");
  if (open) await open();
  return chrome();
};
const PAGES = [
  ["/quality", async () => {
    const act = page.locator(".page tbody tr button.btn.ghost").first();
    if (await act.count()) { await act.click(); await page.waitForTimeout(300); }
    for (const f of await page.locator(".fold-btn").all()) { await f.click(); await page.waitForTimeout(150); }
  }],
  ["/inspection", null],
  ["/inspection#itp", async () => { await page.locator(".ptabs button").nth(1).click(); await page.waitForTimeout(300); }],
  ["/inspection#item", async () => { await page.locator(".ptabs button").nth(2).click(); await page.waitForTimeout(300); }],
  ["/ndt-joints", async () => { for (const f of await page.locator(".fold-btn").all()) { await f.click(); await page.waitForTimeout(150); } }],
  ["/log/quality", null],
];

for (const lang of ["en", "ar"]) {
  await setLang(lang);
  for (const [path, open] of PAGES) {
    const words = await visit(path.replace(/#.*/, ""), open);
    // Persian left among the page's words: in English any of that script, in Arabic the letters only Persian has
    const left = words.filter((w) => (lang === "en" ? PERSIAN : PERSIAN_ONLY).test(w));
    check(left.length === 0, `${lang} ${path}: ${words.length} words of the page, Persian left: ${left.slice(0, 6).join(" | ") || "none"}`);
    if (path === "/quality" || path === "/inspection#itp") await page.screenshot({ path: `${SHOT}/32${lang === "en" ? 0 : 1}-${path.replace(/\W+/g, "-")}.png`, fullPage: true });
  }
}
await setLang("en");
await page.goto(`${BASE}/quality`, { waitUntil: "networkidle" });
check(flat(await page.locator(".page h1").innerText()) === "Punch & NCR", "English heading on Punch & NCR");
check(/open punch items/.test(await page.locator(".pagehead .sub").innerText()), "the sentence under it in English");
check(await page.locator("th", { hasText: "Category" }).count() > 0, "column heads in English");
const due = flat(await page.locator(".page tbody tr").first().locator("td").nth(5).innerText());
check(!PERSIAN.test(due), `dates in the Gregorian calendar (${due})`);
await setLang("ar");
await page.goto(`${BASE}/inspection`, { waitUntil: "networkidle" });
check(flat(await page.locator(".page h1").innerText()) === "التفتيش", "Arabic heading on inspection");
await setLang("fa");
await page.goto(`${BASE}/quality`, { waitUntil: "networkidle" });
check(flat(await page.locator(".page h1").innerText()) === "Punch و NCR", "Persian reads as before");
check(await page.locator("th", { hasText: "دسته" }).count() > 0, "…column heads in Persian");
check(PERSIAN.test(flat(await page.locator(".page tbody tr").first().locator("td").nth(5).innerText())), "…dates in the Persian calendar");

console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
