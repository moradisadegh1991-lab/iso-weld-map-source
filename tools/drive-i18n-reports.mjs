/**
 * Drive the «گزارش روزانه» section in three languages (production build, the
 * DM-pump scenario played to the end, which has a contract but no daily
 * report yet). In English the drive builds the contract daily report's
 * workflow from its own button, joins its stages, writes a report and a row
 * on the page, and a project daily report the same way; then the contract
 * daily report with each of its tabs, workflow setup, the print layout, my
 * signature and the earlier project daily report are read in English and in
 * Arabic. The page's own words — headings, column heads, labels, buttons,
 * options, notes — carry no Persian (the project's data may: a stage or a
 * person named in Persian stays so); in Persian the pages read as before.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-i18n-reports.mjs
 */
import { chromium } from "playwright";
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
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const api = (path, body) => page.evaluate(async ([p, x]) => {
  const r = await fetch(p, x ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(x) } : {});
  return r.json();
}, [path, body]);
const me = await api("/api/auth/me");
const projectId = me.projects.find((p) => p.code === "DMW").id;
const demoId = me.projects.find((p) => p.code === "DEMO").id;
// The scenario's subcontract, or the DEMO project (no contract: where a project daily report is still written), picked in the top bar.
const sel = page.locator(".topbar select");
const pick = async (where) => {
  const value = await sel.evaluate((s, w) => [...s.options].find((o) => (w === "demo" ? o.value.startsWith("p:") && o.parentElement.label.startsWith("DEMO")
    : o.value.startsWith("c:") && o.parentElement.label.startsWith("DMW")))?.value, where);
  if (value) { await sel.selectOption(value); await page.waitForTimeout(500); }
  return value;
};
check(!!(await pick("dmw")), "the scenario's subcontract picked in the top bar");
const setLang = async (lang) => {
  await api("/api/auth/prefs", { lang });
  await page.evaluate((l) => localStorage.setItem("epc.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("epc.prefs") || "{}"), lang: l })), lang);
};
// The page's own words: what the page writes, not the project's data. A list of people, stages,
// resources or earlier reports offers the project's data as its options; those are left out.
const chrome = () => page.evaluate(() => {
  const DATA = /^(ac-to|gm-u-|ap-|dp-|rf-.*-(resourceId|workGroupId|categoryId)$|sf-c$|nr-cp$|pt-type$)/;
  const s = ".page h1, .page h2:not(.mono), .page h3, .page .hint, .page th, .page label, .page button, .page summary, .page .empty-note, .page .pagehead .sub, .page option, .page .muted.sm:not(td *), .page .moneyrow span, .page .tk-n";
  return [...document.querySelectorAll(s)].filter((n) => n.offsetParent !== null || n.tagName === "OPTION")
    .filter((n) => !(n.tagName === "OPTION" && DATA.test(n.parentElement.id || "")))
    // a stage named by the project ("Stage 1: پیمانکار"), a group's members, a record by its code: the project's data;
    // and the print preview, which is the Persian printed sheet itself
    .filter((n) => !n.closest(".groupbox > b, .groupbox > .muted, [data-board-resource], .rp-sheet"))
    .map((n) => n.innerText || n.textContent).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean)
    .filter((x) => !/(^|\s)[A-Z0-9][\w.-]* — /.test(x));
});
const PERSIAN = /[\u0600-\u06FF]/;
// Persian's own letters (پ چ ژ گ and the Persian ی and ک): Arabic writes ي and ك, and has none of the four
const PERSIAN_ONLY = /[\u067E\u0686\u0698\u06AF\u06CC\u06A9]/;
// stage, group and person names the project typed (the workflow template's are Persian), and the scenario's names
const projectNames = async () => (await api(`/api/report-setup?projectId=${projectId}`)).types
  .flatMap((t) => [t.name, ...t.stages.flatMap((s) => [s.name, ...s.groups.flatMap((g) => [g.name, g.title])])]).filter(Boolean)
  .sort((x, y) => y.length - x.length);

// ── setting up, in English, on the pages themselves
await setLang("en");
await page.goto(`${BASE}/contract-reports`, { waitUntil: "networkidle" });
const build = page.locator("button", { hasText: "Build the workflow" });
check(await build.count() === 1, "the contract daily report offers to build its workflow, in English");
await build.click(); await page.locator(".okmsg", { hasText: "Workflow built" }).waitFor();
await page.goto(`${BASE}/report-setup`, { waitUntil: "networkidle" });
await page.locator("button", { hasText: "Build the daily report template" }).click();
await page.waitForTimeout(800);
// join every group of the report types with every right (the drive's account plays every stage)
const join = async (pid) => {
  const setup = await api(`/api/report-setup?projectId=${pid}`);
  for (const g of setup.types.flatMap((t) => t.stages.flatMap((s) => s.groups)))
    await api("/api/report-setup", { projectId: pid, kind: "member", groupId: g.id, userId: me.user.id, permissions: Object.keys(setup.permissions) });
  return setup.types.map((t) => t.code);
};
const codes = await join(projectId);
check(codes.includes("CR") && codes.includes("DR"), `the report types set up (${codes.join(", ")})`);
await page.goto(`${BASE}/contract-reports`, { waitUntil: "networkidle" });
await page.fill("#nr-t", "Drive report");
await page.locator("button", { hasText: "Create report" }).click();
await page.locator(".ptabs").waitFor();
check(await page.locator(".card h2", { hasText: "Drive report" }).count() === 1, "a contract daily report created from the English form");
await page.fill("#rf-narrative-title", "Fit-up"); await page.fill("#rf-narrative-unit", "in-dia"); await page.fill("#rf-narrative-qty", "6");
await page.locator("form button", { hasText: "Add" }).first().click();
await page.locator(".okmsg, .err").first().waitFor();
check(await page.locator(".okmsg", { hasText: "Row added." }).count() === 1, `a narrative row added (${await page.locator(".err").allInnerTexts()})`);
await api("/api/report-setup", { projectId: demoId, kind: "template" });
await join(demoId);
await pick("demo");
await page.goto(`${BASE}/daily-reports`, { waitUntil: "networkidle" });
await page.locator("button", { hasText: "New daily report" }).click();
await page.locator("button", { hasText: "Save report" }).click();
await page.locator("#report").waitFor();
check(true, "a project daily report written from the English form");

const TABS = ["narrative", "problems", "resources", "activities", "photos", "files", "actions", "history"];
const openReport = async () => {
  await page.locator(".page tbody tr button", { hasText: /Open|فتح|باز کردن/ }).first().click();
  await page.locator(".ptabs").waitFor();
};
// [path, project, open]
const PAGES = [
  ["/contract-reports", "dmw", null],
  ...TABS.map((k, i) => [`/contract-reports#${k}`, "dmw", async () => { await openReport(); await page.locator(".ptabs button").nth(i).click(); await page.waitForTimeout(250); }]),
  ["/report-setup", "dmw", async () => { for (const d of await page.locator("details").all()) await d.evaluate((x) => { x.open = true; }); }],
  ["/report-print-setup", "dmw", null],
  ["/signature", "dmw", null],
  ["/daily-reports#with-contracts", "dmw", null],
  ["/daily-reports", "demo", async () => { await page.locator(".page tbody tr button").first().click(); await page.locator("#report").waitFor(); }],
];
const names = await projectNames();
const unnamed = (w) => names.reduce((x, n) => x.split(n).join(""), w);
for (const lang of ["en", "ar"]) {
  await setLang(lang);
  for (const [path, where, open] of PAGES) {
    await pick(where);
    await page.goto(`${BASE}${path.replace(/#.*/, "")}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".page h1");
    if (open) await open();
    const words = await chrome();
    const left = words.filter((w) => (lang === "en" ? PERSIAN : PERSIAN_ONLY).test(unnamed(w)));
    check(left.length === 0, `${lang} ${path}: ${words.length} words of the page, Persian left: ${left.slice(0, 6).join(" | ") || "none"}`);
    if (path === "/contract-reports#resources") await page.screenshot({ path: `${SHOT}/34${lang === "en" ? 2 : 3}-contract-report.png`, fullPage: true });
  }
}
await setLang("en");
await pick("dmw");
await page.goto(`${BASE}/contract-reports`, { waitUntil: "networkidle" });
check(flat(await page.locator(".page h1").innerText()) === "Contract daily report", "English heading on the contract daily report");
check(await page.locator(".pill", { hasText: "In workflow" }).count() > 0, "the report's state in English");
await openReport();
check(await page.locator(".page", { hasText: "Day's activity: Working" }).count() === 1, "the header's day status in English");
const created = flat(await page.locator(".card p.sm").first().innerText());
const at = created.match(/created ([^·]+)·/)?.[1] || "";
check(/\d/.test(at) && !PERSIAN.test(at), `the report's created time in the Gregorian calendar (${at})`);
await page.locator(".ptabs button").nth(7).click();
check(await page.locator("th", { hasText: "Edited by" }).count() === 1, "its history in English");
await page.screenshot({ path: `${SHOT}/340-contract-report-en.png`, fullPage: true });
await setLang("ar");
await page.goto(`${BASE}/report-setup`, { waitUntil: "networkidle" });
check(flat(await page.locator(".page h1").innerText()) === "إعداد سير عمل التقرير", "Arabic heading on workflow setup");
check(await page.locator(".permgrid label", { hasText: "اعتماد نهائي" }).count() + await page.locator("td", { hasText: "عرض" }).count() > 0, "the rights named in Arabic");
await page.screenshot({ path: `${SHOT}/341-report-setup-ar.png`, fullPage: true });
await setLang("fa");
await page.goto(`${BASE}/contract-reports`, { waitUntil: "networkidle" });
check(flat(await page.locator(".page h1").innerText()) === "گزارش روزانهٔ قرارداد", "Persian reads as before");
check(await page.locator(".pill", { hasText: "در گردش" }).count() > 0, "…the report's state in Persian");

// the current stage's mark sits beside the stage's name, not over it, whichever way the page reads
const overlap = () => page.evaluate(() => {
  const mark = document.querySelector("[data-current-stage]");
  const name = [...mark.parentElement.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
  const r = document.createRange(); r.selectNodeContents(name);
  const a = r.getBoundingClientRect(), m = mark.getBoundingClientRect();
  return Math.max(0, Math.min(a.right, m.right) - Math.max(a.left, m.left)) * Math.max(0, Math.min(a.bottom, m.bottom) - Math.max(a.top, m.top));
});
for (const lang of ["fa", "ar", "en"]) {
  await setLang(lang);
  await page.goto(`${BASE}/contract-reports`, { waitUntil: "networkidle" });
  await openReport();
  check(await overlap() === 0, `${lang}: the current stage's mark clear of the stage's name`);
}
await setLang("fa");

console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
