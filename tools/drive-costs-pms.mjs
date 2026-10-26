/**
 * Drive the owner's requirements of 2026-10-26 in the real app:
 *   1  the EPS Excel template offers the activity table's fields and the
 *      project's own column of it, and the sheet downloaded is headed with them
 *   2  the activity's code edited in ACTIVITY DETAIL, the change asked first;
 *      a sub-form's change (a relation) asked first too
 *   3  the activity table's cost and float typed in ACTIVITY DETAIL
 *   4  the same in the planning preview's ACTIVITY DETAIL, the two
 *      percentages worked out while typing and by the database
 *   5  a PMS unticked active leaves the pickers; a version and a PMS deleted
 *      from the box with «delete everything under it»
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-costs-pms.mjs
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { readFile } from "node:fs/promises";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const page = await (await b.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })).newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
const asked = [];
let answer = true;
page.on("dialog", (d) => { asked.push(d.message()); if (answer) d.accept(); else d.dismiss(); });
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
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("p6-")) localStorage.removeItem(k);
  localStorage.setItem("epc.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("epc.prefs") || "{}"), lang: "en" })); });
const me = await api("/api/auth/me");
const projectId = me.projects.find((p) => p.code === "DMW").id;
await page.locator(".topbar select").selectOption(`p:${projectId}`); await page.waitForTimeout(500);
const contractId = (await api(`/api/contract-reports?projectId=${projectId}`)).contracts[0].id;
await page.locator(".topbar select").selectOption(`c:${contractId}`); await page.waitForTimeout(500);
const tag = Date.now().toString(36).slice(-4).toUpperCase();
const settle = () => page.waitForTimeout(1200);

// a PMS of its own, with a version, a node and two activities, the version planning the first
const P = (await api("/api/eps", { projectId, contractId, kind: "pms", code: `DC${tag}`, title: "Drive costs" })).row;
const V = (await api("/api/eps", { projectId, contractId, kind: "version", pmsId: P.id, code: `DC${tag}-R0`, title: "Base" })).row;
const N = (await api("/api/eps", { projectId, kind: "node", pmsId: P.id, name: "Piping", wf: 100 })).row;
const A = (await api("/api/eps", { projectId, kind: "activity", nodeId: N.id, name: "Erect", wf: 60, planStart: "2026-11-01", planEnd: "2026-11-10" })).row;
const B = (await api("/api/eps", { projectId, kind: "activity", nodeId: N.id, name: "Test", wf: 40, planStart: "2026-11-11", planEnd: "2026-11-20" })).row;
await api("/api/eps/planning", { projectId, kind: "plan-add", versionId: V.id, activityIds: [A.id] });
const pickPms = async () => { await page.locator('[data-pick="pms"]').selectOption(P.id); await settle(); };

// ── 2, 3: ACTIVITY DETAIL on the activities page ─────────────────────────
await page.goto(`${BASE}/eps/activities?version=${V.id}`, { waitUntil: "networkidle" });
await page.locator(`tr[data-row="${A.code}"]`).click();
await page.locator(`[data-detail="${A.code}"]`).waitFor();
await page.locator("[data-detail-edit]").click();
const newCode = `${A.code}X`;
await page.fill('input[aria-label="code"]', newCode);
await page.fill('input[aria-label="activityNo"]', "A1000");
for (const [k, v] of [["targetCost", "1000"], ["actCost", "250"], ["remainCost", "750"], ["totalCost", "1000"], ["freeFloatH", "-4"], ["totalFloatH", "12"], ["costCompletePct", "25"], ["actPctSpent", "25"]])
  await page.fill(`[data-detail="${A.code}"] input[aria-label="${k}"]`, v);
await page.screenshot({ path: `${SHOT}/480-detail-costs-edit-en.png` });
asked.length = 0; answer = false;
await page.locator(`[data-detail="${A.code}"] button[type=submit]`).click();
await settle();
let a = (await api(`/api/eps/activities?projectId=${projectId}&activityId=${A.id}`)).activity;
check(asked[0] === "Save the changes?" && a.code === A.code, `the detail form asks first; answered no, nothing saved (${asked[0]})`);
asked.length = 0; answer = true;
await page.locator(`[data-detail="${A.code}"] button[type=submit]`).click();
await settle();
a = (await api(`/api/eps/activities?projectId=${projectId}&activityId=${A.id}`)).activity;
check(asked[0] === "Save the changes?" && a.code === newCode && a.activity_no === "A1000", `the activity's code edited in ACTIVITY DETAIL (${a.code}, ${a.activity_no})`);
check([a.target_cost, a.act_cost, a.remain_cost, a.total_cost, a.free_float_hr_cnt, a.total_float_hr_cnt, a.cost_complete_pct, a.act_pct_spent].map(Number).join(",") === "1000,250,750,1000,-4,12,25,25",
  "the activity table's eight cost and float fields typed and kept");
check((await page.locator(`[data-detail="${newCode}"] [data-costs=activity]`).innerText()).includes("Budgeted Total Cost($)"), "shown under P6's names");
await page.screenshot({ path: `${SHOT}/481-detail-costs-en.png` });
// the grid's columns
const heads = await page.locator("thead th").evaluateAll((ths) => ths.map((th) => th.textContent.trim()));
check(["Budgeted Total Cost($)", "Total Float(h)", "(*)Cost % of Budget(%)"].every((h) => heads.some((x) => x.startsWith(h))), "the activity table shows the new fields as columns");
// a sub-form's change asked first: a relation, answered no, then yes
await page.locator("[role=tab]", { hasText: "Relationship" }).first().click();
await page.locator("#rl-other").selectOption(B.id);
asked.length = 0; answer = false;
await page.locator("form", { has: page.locator("#rl-other") }).locator("button[type=submit]").click();
await settle();
let d = await api(`/api/eps/activities?projectId=${projectId}&activityId=${A.id}`);
check(asked[0] === "Save the changes?" && d.predecessors.length === 0, `a sub-form's change asked first; nothing sent on no (${asked[0]})`);
asked.length = 0; answer = true;
await page.locator("form", { has: page.locator("#rl-other") }).locator("button[type=submit]").click();
await settle();
d = await api(`/api/eps/activities?projectId=${projectId}&activityId=${A.id}`);
check(d.predecessors.length === 1, "sent on yes");
asked.length = 0; answer = false;
await page.locator(`[data-rel="pred:${B.code}"] button`).click();
await settle();
check(asked[0] === "Delete this row?" && (await api(`/api/eps/activities?projectId=${projectId}&activityId=${A.id}`)).predecessors.length === 1, `a removal is asked as one (${asked[0]})`);
answer = true;

// ── 4: the planning preview's ACTIVITY DETAIL ───────────────────────────
await page.goto(`${BASE}/eps/planning/preview?version=${V.id}`, { waitUntil: "networkidle" });
await page.locator(`tr[data-row="${newCode}"]`).click();
await page.locator(`[data-detail="${newCode}"] [data-costs=plan]`).waitFor();
await page.locator("[data-detail-edit]").click();
for (const [k, v] of [["targetCost", "800"], ["actCost", "300"], ["totalCost", "1000"]]) await page.fill(`[data-costs=plan] input[aria-label="${k}"]`, v);
const live = await page.locator("[data-costs=plan] [data-cost-auto]").allInnerTexts();
check(live.join(" ") === "30% 37.5%", `the two percentages worked out while typing, not typed (${live.join(" ")})`);
check(await page.locator('[data-costs=plan] input[aria-label="costCompletePct"]').count() === 0, "no field to type them in the plan");
await page.screenshot({ path: `${SHOT}/482-preview-plan-costs-en.png` });
asked.length = 0;
await page.locator(`[data-detail="${newCode}"] button[type=submit]`).click();
await settle();
const row = (await api(`/api/eps/planning?projectId=${projectId}&versionId=${V.id}`)).rows.find((r) => r.activity_id === A.id);
check(asked[0] === "Save the changes?" && [row.target_cost, row.act_cost, row.total_cost, row.cost_complete_pct, row.act_pct_spent].join(",") === "800,300,1000,30,37.5",
  `the version's plan row takes them; the database works out 30% and 37.5% (${[row.cost_complete_pct, row.act_pct_spent]})`);
a = (await api(`/api/eps/activities?projectId=${projectId}&activityId=${A.id}`)).activity;
check(Number(a.target_cost) === 1000, "the activity table keeps its own budget");
// the planning page shows them on the version's rows
await page.goto(`${BASE}/eps/planning?version=${V.id}`, { waitUntil: "networkidle" });
await page.locator(`[data-plan-row="${newCode}"]`).waitFor();
check(await page.locator(`[data-plan-row="${newCode}"] [data-cost=costCompletePct]`).innerText() === "30", "the planning page's rows show the percentage");

// ── 1: the EPS Excel template with the project's own column ─────────────
const crew = `Crew ${tag}`;
await api("/api/custom-fields", { projectId, kind: "field", formKey: "eps-activities", label: crew, dataType: "text" });
await page.goto(`${BASE}/eps`, { waitUntil: "networkidle" });
await page.locator("[data-import-open]").first().click();
await page.locator("#im-kind").selectOption("sheet");
await page.locator("[data-template=eps]").click();
await page.locator("[data-templates=eps] [data-template-new]").click();
check(await page.locator(`[data-template-col="${crew}"]`).count() === 1 && await page.locator(`[data-own-col="${crew}"]`).count() === 1, "the project's own column of the activities table offered");
check(await page.locator('[data-template-col="Budgeted Total Cost($)"]').count() === 1 && await page.locator('[data-template-col="Activity ID"]').count() === 1, "and the activity table's fields");
await page.screenshot({ path: `${SHOT}/483-eps-template-cols-en.png` });
for (const c of ["Type", "W.F", "Unit", "Volume", "Plan start", "Plan end", "Actual start", "Actual end", "Activity type", "WF rate", "Volume actual", "Description",
  "Actual Total Cost($)", "Remaining Total Cost($)", "At Completion Total Cost($)", "Free Float(h)", "Total Float(h)", "Cost % Complete(%)", "(*)Cost % of Budget(%)"])
  await page.locator(`[data-template-col="${c}"]`).uncheck();
// the project's other columns (an earlier run's) left out
for (const own of await page.locator("[data-own-col]").evaluateAll((ls) => ls.map((l) => l.dataset.ownCol))) if (own !== crew) await page.locator(`[data-template-col="${own}"]`).uncheck();
await page.locator("[data-template-name-input]").fill(`With crew ${tag}`);
const dlP = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
await page.locator("[data-template-save]").click();
const dl = await dlP;
if (!dl) { await page.screenshot({ path: `${SHOT}/483x-template-fail.png` }); throw new Error(`no download; the box says: ${(await page.locator("[data-templates=eps] .err").allInnerTexts()).join(" ")}`); }
const wb = XLSX.read(await readFile(await dl.path()), { type: "buffer" });
const head = XLSX.utils.sheet_to_json(wb.Sheets.WBS, { header: 1 })[0];
check(head.join("|") === `Parent code|Code|Name|Activity ID|Budgeted Total Cost($)|${crew}`, `the sheet is headed with the fields chosen and the project's column (${head.join(", ")})`);
await page.keyboard.press("Escape");

// ── 5: active PMS, and deleting with everything under it ────────────────
await page.goto(`${BASE}/eps`, { waitUntil: "networkidle" });
const box = page.locator(`[data-pms-active="${P.code}"]`);
await box.waitFor();
await box.click();
await settle();
check((await api(`/api/eps?projectId=${projectId}&contractId=${contractId}`)).pms.find((x) => x.id === P.id).active === false, "a PMS unticked active");
await page.goto(`${BASE}/eps/activities`, { waitUntil: "networkidle" });
const offered = await page.locator('[data-pick="pms"] option').evaluateAll((os) => os.map((o) => o.value));
check(!offered.includes(P.id) && offered.length > 0, "the activities page no longer offers it");
await page.goto(`${BASE}/eps`, { waitUntil: "networkidle" });
await page.locator(`[data-pms-active="${P.code}"]`).click();
await settle();
await page.goto(`${BASE}/eps/planning`, { waitUntil: "networkidle" });
check((await page.locator('[data-pick="pms"] option').evaluateAll((os) => os.map((o) => o.value))).includes(P.id), "ticked again, it is offered again");

// a version with a planning row: the box, refused without the tick, deleted with it
await page.goto(`${BASE}/eps`, { waitUntil: "networkidle" });
await page.locator(`tr[data-row="${V.code}"]`).click({ button: "right" });
asked.length = 0;
await page.locator("[data-row-menu] button", { hasText: "Delete" }).click();
await page.locator("[data-remove-ask]").waitFor();
check(asked.length === 0 && (await page.locator("[data-remove-ask]").innerText()).includes("1 planning rows"), "the box says what the version holds; the grid's own question is not put");
await page.screenshot({ path: `${SHOT}/484-remove-ask-version-en.png` });
await page.locator("[data-remove-ok]").click();
await settle();
check((await page.locator("p.err[role=alert]").first().innerText()).includes("حذف تمام زیرمجموعه") && (await api(`/api/eps?projectId=${projectId}&contractId=${contractId}`)).pms.find((x) => x.id === P.id).versions.length === 1,
  "without the tick a version with planning rows is not deleted");
await page.locator(`tr[data-row="${V.code}"]`).click({ button: "right" });
await page.locator("[data-row-menu] button", { hasText: "Delete" }).click();
await page.locator("[data-remove-all] input").check();
await page.locator("[data-remove-ok]").click();
await settle();
check((await api(`/api/eps?projectId=${projectId}&contractId=${contractId}`)).pms.find((x) => x.id === P.id).versions.length === 0, "with it the version goes with its planning rows");
// the PMS itself, from its form: everything under it
await page.locator(`tr[data-row="${P.code}"]`).click();
await page.locator("[data-pms-remove]").click();
await page.locator("[data-remove-ask]").waitFor();
check((await page.locator("[data-remove-item]").innerText()).includes("2 activities"), "the box says what the PMS holds");
await page.locator("[data-remove-all] input").check();
await page.screenshot({ path: `${SHOT}/485-remove-ask-pms-en.png` });
await page.locator("[data-remove-ok]").click();
await settle();
check(!(await api(`/api/eps?projectId=${projectId}&contractId=${contractId}`)).pms.some((x) => x.id === P.id), "the PMS deleted with everything under it");
void B;

console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
process.exit(failed || problems.length ? 1 : 0);
