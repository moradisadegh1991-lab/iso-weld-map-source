/**
 * Drive the «قراردادها و پیمان‌ها» section in three languages (production build,
 * the DM-pump scenario played to 10.11: a signed subcontract, its BOQ, a paid
 * statement): contracts and a contract's detail, contract setup, contract
 * resources and the library, payment statements and one opened, design
 * quantities, and the section log. In English and Arabic the page's own words —
 * headings, column heads, labels, buttons, KPIs, options, notes — carry no
 * Persian (the project's data may: a description typed in Persian stays so);
 * in Persian the pages read as they did before.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-i18n-contracts.mjs
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
// The scenario's project and its subcontract, picked in the top bar (the account has the empty DEMO project too).
const pickContract = async () => {
  const sel = page.locator(".topbar select");
  const value = await sel.evaluate((s) => [...s.options].find((o) => o.value.startsWith("c:") && o.parentElement.label.startsWith("DMW"))?.value);
  if (value) { await sel.selectOption(value); await page.waitForTimeout(500); }
  return value;
};

check(!!(await pickContract()), "the scenario's subcontract picked in the top bar");
const setLang = async (lang) => {
  await page.evaluate((l) => fetch("/api/auth/prefs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang: l }) }), lang);
  await page.evaluate((l) => localStorage.setItem("epc.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("epc.prefs") || "{}"), lang: l })), lang);
};
// The page's own words: what the page writes, not the project's data in the table cells.
const chrome = () => page.evaluate(() => {
  const sel = ".page h1, .page h2:not(.mono), .page .hint, .page th, .page label, .page button, .page .kpi .l, .page .kpi .b, .page .empty-note, .page .pagehead .sub, .page option, .page .muted.sm:not(td *), .page .tk-n";
  return [...document.querySelectorAll(sel)].filter((n) => n.offsetParent !== null || n.tagName === "OPTION")
    .map((n) => n.innerText || n.textContent).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean)
    // a record named by its code ("C-MEC — the contractor's name", "Contract SC-70-MEC — its title") is the project's data, not the page's words
    .filter((s) => !/(^|\s)[A-Z0-9][\w.-]* — /.test(s));
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
const openAll = async () => { for (const f of await page.locator(".fold-btn").all()) { await f.click(); await page.waitForTimeout(150); } };
const PAGES = [
  ["/contracts", async () => {
    const d = page.locator(".page tbody tr button.btn.ghost").first();
    if (await d.count()) { await d.click(); await page.waitForTimeout(400); }
    await openAll();
  }],
  ["/contracts/setup", null],
  ["/contracts/resources", null],
  ["/contracts/statements", async () => {
    const o = page.locator(".page tbody tr button.btn.ghost").first();
    if (await o.count()) { await o.click(); await page.waitForSelector("[data-net]"); }
  }],
  ["/contracts/design", null],
  ["/log/contracts", null],
];

for (const lang of ["en", "ar"]) {
  await setLang(lang);
  for (const [path, open] of PAGES) {
    const words = await visit(path.replace(/#.*/, ""), open);
    // Persian left among the page's words: in English any of that script, in Arabic the letters only Persian has
    const left = words.filter((w) => (lang === "en" ? PERSIAN : PERSIAN_ONLY).test(w));
    check(left.length === 0, `${lang} ${path}: ${words.length} words of the page, Persian left: ${left.slice(0, 6).join(" | ") || "none"}`);
    if (path === "/contracts") await page.screenshot({ path: `${SHOT}/33${lang === "en" ? 2 : 3}-contracts.png`, fullPage: true });
  }
}
await setLang("en");
await page.goto(`${BASE}/contracts`, { waitUntil: "networkidle" });
check(flat(await page.locator(".page h1").innerText()) === "Contracts & subcontracts", "English heading on contracts");
check(await page.locator(".pill", { hasText: "Signed (in force)" }).count() > 0, "the contract's state in English");
await page.goto(`${BASE}/contracts/statements`, { waitUntil: "networkidle" });
await page.locator(".page tbody tr button.btn.ghost").first().click(); await page.waitForSelector("[data-net]");
check(await page.locator(".moneyrow span", { hasText: "Net payable" }).count() > 0, "the statement's figures in English");
check(await page.locator(".sigs b", { hasText: "Technical verification" }).count() > 0, "its signatures in English");
const to = flat(await page.locator(".page tbody tr").first().locator("td").nth(1).innerText());
check(!PERSIAN.test(to), `statement dates in the Gregorian calendar (${to})`);
await page.screenshot({ path: `${SHOT}/330-statement-en.png`, fullPage: true });
await setLang("ar");
await page.goto(`${BASE}/contracts/setup`, { waitUntil: "networkidle" });
check(flat(await page.locator(".page h1").innerText()) === "إعداد العقد", "Arabic heading on contract setup");
await page.screenshot({ path: `${SHOT}/331-setup-ar.png`, fullPage: true });
await setLang("fa");
await page.goto(`${BASE}/contracts`, { waitUntil: "networkidle" });
check(flat(await page.locator(".page h1").innerText()) === "قراردادها و پیمان‌ها", "Persian reads as before");
check(await page.locator(".pill", { hasText: "امضاشده (جاری)" }).count() > 0, "…the contract's state in Persian");

console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
