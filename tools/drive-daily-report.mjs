/**
 * Drive the daily work entry and the daily report preview (owner's
 * requirements of 2026-10-22, items 29–36) on the DM-pump scenario played to
 * the end. A PMS whose master version plans two of three activities is made
 * through the API, and two daily reports of today. Then, in the pages:
 *   - the entry page opens on the master version; a double click on an
 *     activity adds it to the report, as «add item single»;
 *   - a daily work sheet is imported into the second report;
 *   - in the daily report sub-form a line is moved to another activity (list
 *     box of activities) and to the other report (list box of reports);
 *   - the preview shows only the activities the report has work on; a
 *     quantity is edited in the activity's own row; the PMS sub-form lists
 *     the node's activities with totals; the status sub-form reads the
 *     version; the narrative sub-form shows the report's narrative rows.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-daily-report.mjs
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { writeFile } from "node:fs/promises";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
page.on("dialog", (d) => d.accept());
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const api = (path, body) => page.evaluate(async ([p, x]) => {
  const r = await fetch(p, x ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(x) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}: ${j.error}`);
  return j;
}, [path, body]);
await api("/api/auth/prefs", { lang: "en" });
await page.evaluate(() => localStorage.setItem("epc.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("epc.prefs") || "{}"), lang: "en" })));
const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = local(new Date()), back = (n) => local(new Date(Date.now() - n * 86_400_000));
const me = await api("/api/auth/me");
const projectId = me.projects.find((p) => p.code === "DMW").id;
const contractId = (await api(`/api/contract-reports?projectId=${projectId}`)).contracts[0].id;
await page.locator(".topbar select").selectOption(`c:${contractId}`); await page.waitForTimeout(500);

const tag = Date.now().toString(36).slice(-4).toUpperCase();
const pms = (await api("/api/eps", { projectId, kind: "pms", contractId, code: `DR-${tag}`, title: "Daily report drive" })).row;
const v0 = (await api("/api/eps", { projectId, kind: "version", pmsId: pms.id, code: `DR-${tag}-R0`, title: "Baseline" })).row;
const ver = (await api("/api/eps", { projectId, kind: "version", pmsId: pms.id, code: `DR-${tag}-R1`, title: "Master" })).row;
await api("/api/eps", { projectId, kind: "version-master", id: ver.id, master: true });
const node = (await api("/api/eps", { projectId, kind: "node", pmsId: pms.id, name: "Piping", wf: 100, unit: "m" })).row;
const mk = (name, wf, s, e, vol) => api("/api/eps", { projectId, kind: "activity", nodeId: node.id, name, wf, planStart: s, planEnd: e, volumePlan: vol, volumeActual: vol });
const A = (await mk("Spool erection", 60, back(9), today, 100)).row;
const B = (await mk("Support install", 30, back(4), today, 50)).row;
const C = (await mk("Hydrotest", 10, back(2), today, 10)).row;
await api("/api/eps/planning", { projectId, kind: "plan-add", versionId: ver.id, activityIds: [A.id, B.id] });
// the contract's daily reports of today, through its workflow, which the drive's account plays
await page.goto(`${BASE}/contract-reports`, { waitUntil: "networkidle" });
const build = page.locator("button", { hasText: "Build the workflow" });
if (await build.count()) { await build.click(); await page.locator(".okmsg").waitFor(); }
const setup = await api(`/api/report-setup?projectId=${projectId}`);
for (const g of setup.types.find((t) => t.code === "CR").stages.flatMap((s) => s.groups))
  await api("/api/report-setup", { projectId, kind: "member", groupId: g.id, userId: me.user.id, permissions: Object.keys(setup.permissions) });
const R1 = (await api("/api/contract-reports", { projectId, kind: "create", contractId, title: `First ${tag}`, reportDate: today })).row;
const R2 = (await api("/api/contract-reports", { projectId, kind: "create", contractId, title: `Second ${tag}`, reportDate: today })).row;
// a narrative row in the first report
const v1 = await api(`/api/contract-reports?projectId=${projectId}&id=${R1.id}`);
await api("/api/contract-reports", { projectId, kind: "edit", reportId: R1.id,
  content: { ...v1.content, narrative: [...(v1.content.narrative || []), { id: "n1", base: { title: "Spool erection", description: "Area 1 spools", unit: "m", qty: 6 }, stages: {} }] } });
const linesOf = async (reportId) => (await api(`/api/eps/activities?projectId=${projectId}&pmsId=${pms.id}&lines=1`)).lines.filter((l) => l.reportId === reportId);

// the entry page: the master version picked by default; a double click adds the activity with the quantity typed
await page.goto(`${BASE}/eps/progress?pms=${pms.id}`, { waitUntil: "networkidle" });
await page.locator("[data-entry-bar]").waitFor();
check(await page.locator("[data-pick=version]").inputValue() === ver.id, "the entry page opens on the PMS's master version");
await page.selectOption("#pg-rep", R1.id);
await page.locator("fieldset input[dir=ltr]").fill("8");
await page.locator(`tr[data-row="${A.code}"]`).first().dblclick();
await page.locator(".okmsg, .err").first().waitFor();
check((await linesOf(R1.id)).some((l) => l.activityId === A.id && l.qty === 8), "a double click added 8 m of A to the first report");

// a daily work sheet into the second report
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Date", "Report No", "WBS code", "Activity code", "Qty", "Area / Contractor", "Mark", "Notes"],
  [today, R2.report_no, "", B.code, 4.25, "", "S1", "from the sheet"], [today, R2.report_no, "", C.code, 1, "", "", ""]]), "Daily work");
const file = `${SHOT}/daily-import.xlsx`;
await writeFile(file, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
await page.locator("input[data-progress-import]").setInputFiles(file);
await page.locator(".okmsg, .err").first().waitFor();
const l2 = await linesOf(R2.id);
check(l2.length === 2 && l2.some((l) => l.activityId === B.id && l.qty === 4.25 && l.mark === "S1"), `the sheet entered two lines into the second report (${l2.map((l) => l.qty)})`);

// the daily report sub-form: B's line moved onto C, then into the first report
await page.locator(`tr[data-row="${B.code}"]`).first().click();
await page.locator(".p6-tabs button", { hasText: /Daily report/i }).first().click().catch(() => {});
await page.locator("[data-line-edit]").first().click();
await page.locator('select[aria-label="Activity code"]').selectOption(C.id);
await page.locator("[data-line-save]").click();
await page.locator(".okmsg, .err").first().waitFor();
await page.waitForTimeout(800);
check((await linesOf(R2.id)).filter((l) => l.activityId === C.id).length === 2, "the line now names C (the activity list box)");
await page.locator(`tr[data-row="${C.code}"]`).first().click();
await page.waitForTimeout(800);
await page.locator("[data-line-edit]").first().click();
await page.locator('select[aria-label="Report no."]').selectOption(R1.id);
await page.locator("[data-line-save]").click();
await page.waitForTimeout(1500);
check((await linesOf(R1.id)).some((l) => l.activityId === C.id) && (await linesOf(R2.id)).length === 1, "and moved to the first report (the report list box)");
await page.screenshot({ path: `${SHOT}/390-progress-entry-en.png` });

// the preview of the first report
await page.selectOption("#pg-rep", R1.id);
// opened from the entry page's link: the report and the version picked there
await page.locator("[data-report-preview]").click();
await page.waitForURL(/\/eps\/progress\/preview/);
await page.locator("[data-report-bar]").waitFor();
await page.locator(`tr[data-row="${A.code}"]`).first().waitFor();
check(await page.locator(`tr[data-row="${B.code}"]`).count() === 0 && await page.locator(`tr[data-row="${C.code}"]`).count() > 0, "only the activities the report has work on");
await page.locator(`tr[data-row="${A.code}"] td`).nth(2).click();
await page.locator(`tr[data-row="${A.code}"] input[type=number]`).first().fill("9");
await page.locator("[data-row-save]").first().click();
await page.waitForTimeout(1500);
check((await linesOf(R1.id)).some((l) => l.activityId === A.id && l.qty === 9), "the quantity edited in the activity's own row");
await page.locator("[data-tab=pms]").click();
await page.locator("[data-sub=pms]").waitFor();
check(await page.locator("[data-sub=pms] tr[data-pms-row]").count() === 3 && await page.locator("[data-pms-total]").count() === 1, "the PMS sub-form: the node's three activities and their totals");
await page.screenshot({ path: `${SHOT}/391-report-preview-pms-en.png` });
await page.locator("[data-tab=status]").click();
await page.locator("[data-sub=status]").waitFor();
check((await page.locator('[data-sub=status] td[data-col="Scheduling NO."]').innerText()) === ver.code, "the status sub-form reads the master version");
await page.locator("[data-tab=narrative]").click();
await page.locator("[data-sub=narrative]").waitFor();
check((await page.locator("[data-sub=narrative] tr[data-narrative]").count()) === 1 && (await page.locator("[data-sub=narrative]").innerText()).includes("Area 1 spools"), "the narrative sub-form: the report's narrative row");
await page.screenshot({ path: `${SHOT}/392-report-preview-narrative-en.png` });

await api("/api/auth/prefs", { lang: "fa" });
console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
