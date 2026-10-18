/**
 * Drive the planning section (EPS / PMS) in English and Arabic (owner's
 * requirements of 2026-10-18, item 17) on the DM-pump scenario played to the
 * end: a PMS, a version, a node with two activities, a template and a code
 * are made through the API (Latin names, so the project's data is not taken
 * for the page's words), then every planning page — and every sub-form of
 * the activity page — is read in English and in Arabic. A word of Persian of
 * the page's own fails it; so does a page error. Numbers and dates are
 * checked to be written the reader's way.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-i18n-eps.mjs
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
const page = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const api = (path, body) => page.evaluate(async ([p, x]) => {
  const r = await fetch(p, x ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(x) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}: ${j.error}`);
  return j;
}, [path, body]);
const setLang = async (lang) => {
  await api("/api/auth/prefs", { lang });
  await page.evaluate((l) => localStorage.setItem("epc.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("epc.prefs") || "{}"), lang: l })), lang);
};
const projectId = (await api("/api/auth/me")).projects.find((p) => p.code === "DMW").id;
const contractId = (await api(`/api/contract-reports?projectId=${projectId}`)).contracts[0].id;
await page.locator(".topbar select").selectOption(`c:${contractId}`); await page.waitForTimeout(500);
const run = Date.now().toString(36).slice(-4).toUpperCase();

// a plan in Latin names: a PMS, its version, a node, two activities, a template and a code
const pms = (await api("/api/eps", { projectId, kind: "pms", contractId, code: `PMS-I${run}`, title: "I18N plan" })).row;
const ver = (await api("/api/eps", { projectId, kind: "version", pmsId: pms.id, code: `V${run}`, title: "Baseline" })).row;
const node = (await api("/api/eps", { projectId, kind: "node", versionId: ver.id, name: "Piping", wf: 100, unit: "m" })).row;
const today = new Date().toISOString().slice(0, 10);
const a1 = (await api("/api/eps", { projectId, kind: "activity", nodeId: node.id, name: "Spool erection", wf: 60, planStart: today, planEnd: today, volumePlan: 1234.5, volumeActual: 1234.5 })).row;
await api("/api/eps", { projectId, kind: "activity", nodeId: node.id, name: "Support install", wf: 40, volumePlan: 50, volumeActual: 50 });
await api("/api/eps", { projectId, kind: "template", code: `T${run}`, name: "Piping template" });
await api("/api/eps/activities", { projectId, contractId, kind: "code", code: `C-${run}`, name: "Erection", categories: ["Piping"], unit: "m", valid: true });

// the page's own words: headings, labels, buttons, notes — not the cells of the plan's data
const chrome = () => page.evaluate(() => {
  const s = ".page h1, .page h2, .page h3, .page legend, .page th, .page label, .page button, .page summary, .page .empty-note, .page .pagehead .sub, .page p.muted, .page .sm.muted:not(td *):not(option), .page .kv > span, .page [role=tab]";
  return [...document.querySelectorAll(s)].filter((n) => n.offsetParent !== null)
    // the project's own names (a node, an activity, a contract title the scenario wrote in Persian) are data
    .filter((n) => !n.closest("[data-wbs], [data-activity], tr[data-kind], [data-template], .chip"))
    .map((n) => (n.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean);
});
const PERSIAN = /[؀-ۿ]/;
const PERSIAN_ONLY = /[پچژگیک]/;
// the scenario's contract is named in Persian; its name in a heading is the project's data
const contract = (await api(`/api/contract-reports?projectId=${projectId}`)).contracts[0];
const dataWords = [contract.title, contract.contract_no, contract.name].filter(Boolean);
const unData = (w) => dataWords.reduce((x, d) => x.split(d).join(""), w);

const PAGES = [`/eps`, `/eps/wbs?version=${ver.id}`, `/eps/templates`, `/eps/codes`, `/eps/activities?version=${ver.id}`,
  `/eps/progress?version=${ver.id}`, `/eps/progress/days?version=${ver.id}`, `/eps/scope?version=${ver.id}`];
const TABS = ["detail", "workfront", "groups", "relations", "progress", "roles", "reports", "codes", "overall", "scope"];
for (const [lang, rx] of [["en", PERSIAN], ["ar", PERSIAN_ONLY]]) {
  await setLang(lang);
  for (const path of PAGES) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    if (path.startsWith("/eps/wbs")) await page.locator("summary").first().click().catch(() => {});        // the settings fold
    if (path === "/eps") await page.locator("[data-import-open]").click().catch(() => {});                  // the import form
    const words = await chrome();
    const left = words.filter((w) => rx.test(unData(w)));
    check(left.length === 0, `${lang} ${path.replace(/\?.*/, "")}: ${words.length} words of the page, Persian left: ${left.slice(0, 5).join(" | ") || "none"}`);
  }
  // the activity page with an activity picked: each sub-form
  await page.goto(`${BASE}/eps/activities?version=${ver.id}`, { waitUntil: "networkidle" });
  await page.locator("tr[data-kind=act]", { hasText: "Spool erection" }).first().click();
  await page.waitForTimeout(800);
  const leftTabs = [];
  for (const k of TABS) {
    const tab = page.locator(".p6-tabs [role=tab]").nth(TABS.indexOf(k));
    if (!(await tab.count())) continue;
    await tab.click(); await page.waitForTimeout(500);
    leftTabs.push(...(await chrome()).filter((w) => rx.test(unData(w))).map((w) => `${k}: ${w}`));
  }
  check(leftTabs.length === 0, `${lang} the activity's sub-forms: Persian left: ${leftTabs.slice(0, 5).join(" | ") || "none"}`);
  await page.screenshot({ path: `${SHOT}/40${lang === "en" ? 0 : 1}-eps-activities-${lang}.png` });
}

// numbers and dates written the reader's way: Latin in English, Persian digits and calendar in Persian
await setLang("en");
await page.goto(`${BASE}/eps/activities?version=${ver.id}`, { waitUntil: "networkidle" });
const row = (await page.locator("tr[data-kind=act]", { hasText: "Spool erection" }).first().innerText()).replace(/\s+/g, " ");
check(/1,234\.5/.test(row) && !PERSIAN.test(row.replace("Spool erection", "")), `English writes the volume 1,234.5 and Latin dates (${row.slice(0, 90)})`);
check(await page.locator("th", { hasText: "Task name" }).count() > 0 && await page.locator("th", { hasText: "Progress from" }).count() > 0, "the grid's column heads in English");
await setLang("fa");
await page.goto(`${BASE}/eps/activities?version=${ver.id}`, { waitUntil: "networkidle" });
const rowFa = await page.locator("tr[data-kind=act]", { hasText: "Spool erection" }).first().innerText();
check(/۱٬۲۳۴٫۵/.test(rowFa) && /۱۴۰۵/.test(rowFa), "Persian writes it ۱٬۲۳۴٫۵, the date in the Persian calendar");
check(await page.locator("th", { hasText: "منبع پیشرفت" }).count() > 0, "…and the column heads in Persian as before");
void a1;

console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
