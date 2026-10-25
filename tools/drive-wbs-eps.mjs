/**
 * Drive the EPS and WBS pages as the activities page's tree (owner's
 * requirements of 2026-10-22, items 6 and 7), and the Excel templates a
 * person builds, on the DM-pump scenario played to the end. A PMS with two
 * versions, a node and two activities are made through the API; then:
 *   - EPS: the PMS a node of the tree, its versions under it; a version picked
 *     opens its form below (master plan, planning and activities links); a
 *     PMS's title edited in its row (asked first); a version added under the
 *     PMS from the right-click menu, numbered after the last; moved up;
 *   - WBS: the tree with W.F as a fraction; a child node added from the menu;
 *     the node's row edited; moved down; WBS DETAIL shows the node picked with
 *     what is worked out; PMS DETAIL saves the root budget; a project column
 *     added to the tree, filled in the row, there after a reload; the node's
 *     activities sub-form; a node deleted from WBS DETAIL asks;
 *   - templates: on the planning page a template of chosen columns saved under
 *     a name, listed, its file holding only those columns; the required ones
 *     cannot be unticked.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-wbs-eps.mjs
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { readFile, writeFile } from "node:fs/promises";
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
page.on("dialog", (d) => { asked.push(d.message()); d.accept(); });
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
const me = await api("/api/auth/me");
const projectId = me.projects.find((p) => p.code === "DMW").id;
const contractId = (await api(`/api/contract-reports?projectId=${projectId}`)).contracts[0].id;
await page.locator(".topbar select").selectOption(`c:${contractId}`); await page.waitForTimeout(500);

const tag = Date.now().toString(36).slice(-4).toUpperCase();
const pms = (await api("/api/eps", { projectId, kind: "pms", contractId, code: `WE-${tag}`, title: "Tree drive", budgetPlan: 1000 })).row;
const v1 = (await api("/api/eps", { projectId, kind: "version", pmsId: pms.id, code: `WE-${tag}-R1`, title: "June" })).row;
const v2 = (await api("/api/eps", { projectId, kind: "version", pmsId: pms.id, code: `WE-${tag}-R2`, title: "July" })).row;
const node = (await api("/api/eps", { projectId, kind: "node", pmsId: pms.id, name: "Piping", wf: 100, unit: "m" })).row;
await api("/api/eps", { projectId, kind: "activity", nodeId: node.id, name: "Spool erection", wf: 60 });
await api("/api/eps", { projectId, kind: "activity", nodeId: node.id, name: "Support install", wf: 40 });
const row = (scope, code) => page.locator(`${scope} tr[data-row="${code}"]`);

// ── EPS ──────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/eps`, { waitUntil: "networkidle" });
await row("[data-eps-tree]", pms.code).waitFor();
check(await row("[data-eps-tree]", pms.code).getAttribute("data-kind") === "node" && await row("[data-eps-tree]", v1.code).getAttribute("data-kind") === "act",
  "the PMS is a node of the tree, its versions under it");
const headH = await page.locator(".pagehead").evaluate((el) => el.getBoundingClientRect().height);
check(headH < 90, `the box above the tree is low (${Math.round(headH)}px)`);
await row("[data-eps-tree]", v1.code).click();
await page.locator(`[data-version-form="${v1.code}"]`).waitFor();
check(await page.locator(`[data-version-form="${v1.code}"] a`, { hasText: "Planning" }).count() === 1, "a version picked: its form below, its planning a click away");
await page.locator(`[data-version-form="${v1.code}"] [data-master-toggle] input`).click();
await page.waitForTimeout(800);
check(/★/.test(await row("[data-eps-tree]", v1.code).innerText()), "made the master plan, the tree marks it");
// the PMS's title edited in its row
await page.keyboard.press("Escape");
await row("[data-eps-tree]", pms.code).click();
await page.locator('tr.p6-editing input.p6-in[aria-label="Title"]').fill("Tree drive (edited)");
asked.length = 0;
await page.locator("tr.p6-editing [data-row-save]").click();
await page.waitForTimeout(900);
check(asked[0] === "Save this row's changes?" && (await api(`/api/eps?projectId=${projectId}&contractId=${contractId}`)).pms.find((p) => p.id === pms.id).title === "Tree drive (edited)",
  "the PMS's title edited in its row, asked first");
// a version added under the PMS from the right-click menu
await row("[data-eps-tree]", pms.code).click({ button: "right" });
await page.locator("[data-row-menu] button", { hasText: "Add a child" }).click();
await page.locator('tr[data-kind=draft] input[aria-label="Title"]').fill("August");
await page.locator("tr[data-kind=draft] [data-row-save]").click();
await row("[data-eps-tree]", `${pms.code}-R3`).waitFor();
check(true, `a version added under the PMS from the menu, numbered ${pms.code}-R3`);
// moved up above R2
await row("[data-eps-tree]", `${pms.code}-R3`).click({ button: "right" });
await page.locator("[data-row-menu] [data-move-up]").click();
await page.waitForTimeout(900);
const order = await page.locator("[data-eps-tree] tr[data-kind=act]").evaluateAll((trs) => trs.map((t) => t.dataset.row).filter((c) => c.includes("-R")));
check(order.indexOf(`${pms.code}-R3`) < order.indexOf(v2.code), `moved above its sibling (${order.slice(-3).join(", ")})`);
await page.screenshot({ path: `${SHOT}/410-eps-tree-en.png` });

// ── WBS ──────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/eps/wbs?pms=${pms.id}`, { waitUntil: "networkidle" });
const tree = "[data-wbs-tree]";
await row(tree, node.code).waitFor();
check(await page.locator(`${tree} tr[data-kind=act]`).count() === 0 && (await row(tree, node.code).innerText()).includes("1"),
  "the WBS tree shows its nodes only (W.F as a fraction), not their activities");
// a child node from the menu
await row(tree, node.code).click({ button: "right" });
await page.locator("[data-row-menu] button", { hasText: "Add a child" }).click();
await page.locator('tr[data-kind=draft] input[aria-label="Task name"]').fill("Supports");
await page.locator("tr[data-kind=draft] [data-row-save]").click();
await page.waitForTimeout(1200);
const kids = (await api(`/api/eps?projectId=${projectId}&pmsId=${pms.id}`)).roots[0].children;
check(kids.length === 1 && kids[0].name === "Supports", `a child node added from the menu (${kids.map((k) => k.code)})`);
// a second top node, then the first moved below it
await api("/api/eps", { projectId, kind: "node", pmsId: pms.id, name: "Civil" });
await page.reload({ waitUntil: "networkidle" });
await row(tree, node.code).click({ button: "right" });
await page.locator("[data-row-menu] [data-move-down]").click();
await page.waitForTimeout(1200);
const tops = (await api(`/api/eps?projectId=${projectId}&pmsId=${pms.id}`)).roots.map((r) => r.name);
check(tops[0] === "Civil" && tops[1] === "Piping", `a node moved below its sibling (${tops.join(", ")})`);
// WBS DETAIL of the node picked
const piping = (await api(`/api/eps?projectId=${projectId}&pmsId=${pms.id}`)).roots.find((r) => r.name === "Piping");
await page.keyboard.press("Escape");
await row(tree, piping.code).locator("td").nth(3).click();
await page.locator("[data-wbs-tab=wbs]").click();
await page.locator(`[data-wbs-detail="${piping.code}"]`).waitFor();
check(await page.locator(`[data-wbs-detail="${piping.code}"] [data-worked-out]`).innerText().then((x) => x.includes("1 / 1")), "WBS DETAIL: the node picked, with W.F / W.V worked out");
await page.screenshot({ path: `${SHOT}/411-wbs-tree-detail-en.png` });
// PMS DETAIL: the root budget
await page.locator("[data-wbs-tab=pms]").click();
await page.locator("#pd-budgetPlan").fill("2000");
asked.length = 0;
await page.locator("[data-pms-save]").click();
await page.waitForTimeout(1000);
check(asked[0] === "Save this row's changes?" && Number((await api(`/api/eps?projectId=${projectId}&pmsId=${pms.id}`)).pms.budget_plan) === 2000, "PMS DETAIL saves the root budget, asked first");
// a project column in the tree
await page.locator(`${tree} [data-tk-addcol]`).click();
const label = `Crew ${tag}`;
await page.locator("[data-tk-collabel]").fill(label);
await page.locator("[data-tk-coltype]").selectOption("number");
await page.locator("[data-tk-colsave]").click();
await page.locator(`${tree} .p6-table thead th`, { hasText: label }).waitFor();
await page.locator("[data-tk-coldlg] button", { hasText: "Close" }).click();
await row(tree, piping.code).locator("td").nth(3).click();
await page.locator(`tr.p6-editing input[aria-label="${label}"]`).fill("12.5");
await page.locator("tr.p6-editing [data-row-save]").click();
await page.waitForTimeout(1200);
await page.reload({ waitUntil: "networkidle" });
await row(tree, piping.code).waitFor();
const heads = await page.locator(`${tree} .p6-table thead th`).evaluateAll((ths) => ths.map((th) => th.textContent.trim()));
const at = heads.indexOf(label);
check(at > 0 && (await row(tree, piping.code).locator("td").nth(at).innerText()).trim() === "12.5", "a project column added to the tree, filled in the row, there after a reload");
// the node's activities
await row(tree, piping.code).locator("td").nth(3).click();
await page.keyboard.press("Escape");
await page.locator("[data-wbs-tab=acts]").click();
check(await page.locator(`[data-activities="${piping.code}"] tr[data-activity]`).count() === 2, "the node's activities sub-form");
// deleting a node from WBS DETAIL asks
const civil = (await api(`/api/eps?projectId=${projectId}&pmsId=${pms.id}`)).roots.find((r) => r.name === "Civil");
await row(tree, civil.code).locator("td").nth(3).click();
await page.keyboard.press("Escape");
await page.locator("[data-wbs-tab=wbs]").click();
asked.length = 0;
await page.locator(`[data-wbs-detail="${civil.code}"] [data-node-remove]`).click();
await page.waitForTimeout(1000);
check(asked[0] === `Delete node ${civil.code}?` && !(await api(`/api/eps?projectId=${projectId}&pmsId=${pms.id}`)).roots.some((r) => r.name === "Civil"), "a node deleted from WBS DETAIL, asked first");

// ── dragged and dropped, and the display order ───────────────────────────
await api("/api/eps", { projectId, kind: "node", pmsId: pms.id, name: "Electrical" });
await api("/api/eps", { projectId, kind: "node", pmsId: pms.id, name: "Paint" });
await page.goto(`${BASE}/eps/wbs?pms=${pms.id}`, { waitUntil: "networkidle" });
let top = (await api(`/api/eps?projectId=${projectId}&pmsId=${pms.id}`)).roots;
const byName = (n) => top.find((r) => r.name === n);
await row(tree, byName("Paint").code).waitFor();
check(await page.locator("[data-drag-hint]").count() === 1 && await row(tree, byName("Paint").code).getAttribute("draggable") === "true", "a node's row can be dragged");
// Paint dropped onto the middle of Piping: under it
const target = await row(tree, byName("Piping").code).boundingBox();
await row(tree, byName("Paint").code).dragTo(row(tree, byName("Piping").code), { targetPosition: { x: 40, y: target.height / 2 } });
await page.waitForTimeout(1500);
top = (await api(`/api/eps?projectId=${projectId}&pmsId=${pms.id}`)).roots;
const pip = top.find((r) => r.name === "Piping");
check(pip.children.some((c) => c.name === "Paint") && !top.some((r) => r.name === "Paint"), `dropped onto the middle of Piping: under it (${pip.children.map((c) => c.name).join(", ")})`);
// Electrical dropped onto the top edge of the first node: before it
const first = top[0];
await row(tree, byName("Electrical").code).dragTo(row(tree, first.code), { targetPosition: { x: 40, y: 3 } });
await page.waitForTimeout(1500);
top = (await api(`/api/eps?projectId=${projectId}&pmsId=${pms.id}`)).roots;
check(top[0].name === "Electrical", `dropped onto a row's top edge: before it (${top.map((r) => r.name).join(", ")})`);
// the display order column: Piping typed to place 1
const orderAt = (await page.locator(`${tree} .p6-table thead th`).evaluateAll((ths) => ths.map((th) => th.textContent.trim()))).indexOf("Display order");
check(orderAt > 0 && (await row(tree, top[0].code).locator("td").nth(orderAt).innerText()).trim() === "1", "the display order column shows each node's place");
await row(tree, top.find((r) => r.name === "Piping").code).locator("td").nth(orderAt + 2).click();
await page.locator('tr.p6-editing input[aria-label="Display order"]').fill("1");
await page.locator("tr.p6-editing [data-row-save]").click();
await page.waitForTimeout(1500);
top = (await api(`/api/eps?projectId=${projectId}&pmsId=${pms.id}`)).roots;
check(top[0].name === "Piping", `«display order» 1 typed: first (${top.map((r) => r.name).join(", ")})`);
await page.screenshot({ path: `${SHOT}/414-wbs-drag-order-en.png` });

// ── a plan file: a new PMS, then replacing it ────────────────────────────
// an EPS sheet whose W.F pass 100% (as a file can): the PMS's top nodes 60 + 90, node A's children 90 + 30
const sheet = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(sheet, XLSX.utils.aoa_to_sheet([
  ["Type", "Parent code", "Code", "Name", "W.F"],
  ["WBS", "", "A", "Mechanical", 60], ["WBS", "", "B", "Electrical", 90], ["WBS", "A", "A1", "Pumps", 90],
  ["Activity", "A", "A.01", "Pump set", 30], ["Activity", "A1", "A1.01", "Alignment", 100], ["Activity", "B", "B.01", "Cabling", 100],
]), "EPS");
const sheetFile = `${SHOT}/eps-over-${tag}.xlsx`;
await writeFile(sheetFile, XLSX.write(sheet, { type: "buffer", bookType: "xlsx" }));
await page.goto(`${BASE}/eps`, { waitUntil: "networkidle" });
await page.locator("[data-import-open]").first().click();
await page.locator('[data-im-mode="new"]').check();
const newCode = `IM-${tag}`;
await page.fill("#im-newcode", newCode);
await page.fill("#im-newtitle", "Imported plan");
await page.selectOption("#im-kind", "sheet");
await page.setInputFiles("#im-file", sheetFile);
await page.locator("[data-im-go]").click();
await page.locator(".okmsg").waitFor();
const imported = (await api(`/api/eps?projectId=${projectId}&contractId=${contractId}`)).pms.find((p) => p.code === newCode);
check(Boolean(imported) && imported.versions.length === 0 && imported.nodes === 3, `the file as a new PMS ${newCode}: ${imported?.nodes} nodes, no version`);

// ── W.F over 100% on its WBS ─────────────────────────────────────────────
await page.goto(`${BASE}/eps/wbs?pms=${imported.id}`, { waitUntil: "networkidle" });
await row(tree, "A").waitFor();
const overBtn = page.locator("[data-over-open]");
check(/\(2\)/.test(await overBtn.innerText()), `the over-100% button counts two places (${await overBtn.innerText()})`);
await overBtn.click();
const over = page.locator("[data-overflows]");
await over.waitFor();
check(await over.locator("tr[data-over=PMS]").count() === 1 && await over.locator("tr[data-over=A]").count() === 1, "listed: the PMS (its top nodes) and node A (a child node and an activity together)");
check((await over.locator("tr[data-over=A] [data-over-sum]").innerText()).includes("1.2"), "A's children add up to 1.2 (120%)");
await page.screenshot({ path: `${SHOT}/413-wf-over-en.png` });
asked.length = 0;
await over.locator("[data-fit=A]").click();
await page.waitForTimeout(1200);
check(/A's children/.test(asked[0] || ""), `asked before fitting A (${asked[0]})`);
let wbs = await api(`/api/eps?projectId=${projectId}&pmsId=${imported.id}`);
const nA = wbs.roots.find((r) => r.code === "A");
check(Math.abs(nA.children[0].wf - 75) < 1e-6 && Math.abs(nA.activities[0].wf - 25) < 1e-6, `A's children in proportion: ${nA.children[0].wf} + ${nA.activities[0].wf}`);
await over.locator("[data-fit-all]").click();
await page.waitForTimeout(1500);
wbs = await api(`/api/eps?projectId=${projectId}&pmsId=${imported.id}`);
check(wbs.overflows.length === 0 && Math.abs(wbs.rootWf - 100) < 1e-6, `all fitted: the PMS's top nodes now ${wbs.roots.map((r) => r.wf).join(" + ")}`);
await page.locator("[data-overflows] [data-over-none]").waitFor();
check(true, "the list says nothing is over 100% now");

// ── replacing that PMS from the file, then deleting it with everything under it ──
await page.goto(`${BASE}/eps`, { waitUntil: "networkidle" });
await page.locator("[data-import-open]").first().click();
await page.locator('[data-im-mode="replace"]').check();
await page.selectOption("#im-pms", imported.id);
await page.selectOption("#im-kind", "sheet");
await page.setInputFiles("#im-file", sheetFile);
asked.length = 0;
await page.locator("[data-im-go]").click();
await page.locator(".okmsg").waitFor();
check(/Clear what PMS .* holds.*3 WBS nodes, 3 activities/.test(asked[0] || ""), `replacing asks first, naming what goes (${(asked[0] || "").slice(0, 120)})`);
wbs = await api(`/api/eps?projectId=${projectId}&pmsId=${imported.id}`);
check(wbs.overflows.length === 2, "replaced from the file: its figures as the file has them again (the fit undone)");
await row("[data-eps-tree]", newCode).click();
await page.locator(`[data-pms-form="${newCode}"] [data-pms-remove]`).waitFor();
asked.length = 0;
await page.locator(`[data-pms-form="${newCode}"] [data-pms-remove]`).click();
await page.waitForTimeout(1500);
check(/with everything under it\? 0 versions .*3 WBS nodes, 3 activities/.test(asked[0] || ""), `deleting the PMS names what goes with it (${(asked[0] || "").slice(0, 120)})`);
check(!(await api(`/api/eps?projectId=${projectId}&contractId=${contractId}`)).pms.some((p) => p.code === newCode), "the PMS is gone with everything under it");
// the drive's own PMS, with two versions and a node, goes too
await row("[data-eps-tree]", pms.code).click();
asked.length = 0;
await page.locator(`[data-pms-form="${pms.code}"] [data-pms-remove]`).click();
await page.waitForTimeout(1500);
check(/3 versions/.test(asked[0] || "") && !(await api(`/api/eps?projectId=${projectId}&contractId=${contractId}`)).pms.some((p) => p.id === pms.id),
  `a PMS with versions and WBS is deleted whole (${(asked[0] || "").slice(0, 80)})`);

// ── a template of chosen columns ─────────────────────────────────────────
await page.goto(`${BASE}/eps/planning?version=${v1.id}`, { waitUntil: "networkidle" });
await page.locator("[data-template=planning]").click();
await page.locator("[data-templates=planning] [data-template-new]").click();
check(await page.locator('[data-template-col="Activity code"]').isDisabled(), "the column the importer needs cannot be unticked");
for (const c of ["WBS code", "Start", "Finish", "Done before", "Description"]) await page.locator(`[data-template-col="${c}"]`).uncheck();
const name = `Quick plan ${tag}`;
await page.locator("[data-template-name-input]").fill(name);
const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("[data-template-save]").click()]);
const wb = XLSX.read(await readFile(await dl.path()));
const head = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0];
check(dl.suggestedFilename() === `${name}.xlsx` && JSON.stringify(head) === JSON.stringify(["Activity code", "Days", "Planned"]), `saved under its name, only its columns (${dl.suggestedFilename()}: ${head.join(", ")})`);
await page.locator(`[data-templates=planning] [data-template-name="${name}"]`).waitFor();
check(true, "listed for the project");
await page.screenshot({ path: `${SHOT}/412-named-template-en.png` });

console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
process.exit(failed || problems.length ? 1 : 0);
