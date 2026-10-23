/**
 * Drive the WBS on the PMS and a version's planning (owner's requirements of
 * 2026-10-22, «PLANING») on the DM-pump scenario played to the end. A PMS
 * with two versions is made for its subcontract through the API, its WBS
 * built with no version at all — one node, three activities. Then, in the
 * pages:
 *   - the WBS page picks a PMS only; the activities and planning pages pick
 *     the PMS first, then its version (the master plan by default);
 *   - on the planning page an activity is added with the days typed (finish =
 *     start + days − 1), another by a double click with everything taken
 *     from the activity, a row edited where it stands, the plan copied into
 *     the other version, and a sheet imported;
 *   - the activities page reads an activity's dates from the version picked
 *     and from the activity itself with no version;
 *   - deleting a node there takes its activities only, never the node.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-planning.mjs
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
// a day as the page may write it in English: 2026-03-01, 01/03/2026, 3/1/2026 or Mar 1
const shows = (text, iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return [iso, `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`, `${m}/${d}/${y}`, `${mon} ${d},`].some((f) => text.includes(f));
};
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
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
const me = await api("/api/auth/me");
const projectId = me.projects.find((p) => p.code === "DMW").id;
const contractId = (await api(`/api/contract-reports?projectId=${projectId}`)).contracts[0].id;
await page.locator(".topbar select").selectOption(`c:${contractId}`); await page.waitForTimeout(500);

// a PMS with two versions; its WBS built with no version named
const tag = Date.now().toString(36).slice(-4).toUpperCase();
const pms = (await api("/api/eps", { projectId, kind: "pms", contractId, code: `PL-${tag}`, title: "Planning drive", budgetPlan: 1000 })).row;
const v1 = (await api("/api/eps", { projectId, kind: "version", pmsId: pms.id, code: `PL-${tag}-R1`, title: "June" })).row;
const v2 = (await api("/api/eps", { projectId, kind: "version", pmsId: pms.id, code: `PL-${tag}-R2`, title: "July" })).row;
await api("/api/eps", { projectId, kind: "version-master", id: v1.id, master: true });
const node = (await api("/api/eps", { projectId, kind: "node", pmsId: pms.id, name: "Piping", wf: 100, unit: "m" })).row;
const mk = (name, wf, s, e, vol) => api("/api/eps", { projectId, kind: "activity", nodeId: node.id, name, wf, planStart: s, planEnd: e, volumePlan: vol, volumeActual: vol });
const A = (await mk("Spool erection", 50, "2026-01-01", "2026-01-20", 100)).row;
const B = (await mk("Support install", 30, "2026-01-05", "2026-01-15", 40)).row;
const C = (await mk("Hydrotest", 20, "2026-02-01", "2026-02-03", 3)).row;

// the WBS page: a PMS only; its tree with no version
await page.goto(`${BASE}/eps/wbs?pms=${pms.id}`, { waitUntil: "networkidle" });
await page.locator("[data-wbs-tree] .p6-table").waitFor();
check(await page.locator("[data-plan-picker] select[data-pick=pms]").count() === 1 && await page.locator("[data-plan-picker] select[data-pick=version]").count() === 0,
  "the WBS page picks the PMS, not a version");
check(await page.locator(`[data-wbs-tree] tr[data-kind=node][data-row="${node.code}"]`).count() === 1, `the PMS's tree: ${node.code}`);
await page.screenshot({ path: `${SHOT}/370-wbs-on-pms-en.png` });

// the planning page, version 1 (the master): pickers in order, PMS first
await page.goto(`${BASE}/eps/planning?version=${v1.id}`, { waitUntil: "networkidle" });
await page.locator("[data-plan-bar]").waitFor();
const order = await page.evaluate(() => [...document.querySelectorAll("[data-plan-picker] select")].map((s) => s.dataset.pick));
check(JSON.stringify(order) === '["pms","version"]', `the PMS list first, then its versions (${order})`);
check(await page.locator("[data-pick=version]").inputValue() === v1.id, "the version asked for is the one open");
// A with the days typed
await page.locator(`tr[data-row="${A.code}"]`).first().click();
await page.fill("#pl-startOn", "2026-03-01");
await page.fill("#pl-days", "5");
await page.locator("button[data-add=single]").click();
await page.locator(`[data-plan-rows] tr[data-plan-row="${A.code}"]`).waitFor();
const rowA = await page.locator(`[data-plan-rows] tr[data-plan-row="${A.code}"]`).innerText();
check(shows(rowA, "2026-03-01") && shows(rowA, "2026-03-05"), `A from 1 to 5 March: start + 5 days − 1 (${rowA.replace(/\s+/g, " ").slice(0, 120)})`);
// B by a double click, with the boxes cleared: everything from the activity
await page.locator("button", { hasText: "Clear" }).click();
await page.locator(`tr[data-row="${B.code}"]`).first().dblclick();
await page.locator(`[data-plan-rows] tr[data-plan-row="${B.code}"]`).waitFor();
let rows = (await api(`/api/eps/planning?projectId=${projectId}&versionId=${v1.id}`)).rows;
const rb = rows.find((r) => r.activity_id === B.id);
check(rb && rb.start_on === "2026-01-05" && rb.end_on === "2026-01-15" && rb.done_before === 0 && rb.volume_plan === 40,
  `a double click adds B with the activity's own dates, nothing done before, the whole 40 planned (${JSON.stringify(rb && [rb.start_on, rb.end_on, rb.done_before, rb.volume_plan])})`);
const inPlan = await page.locator(`tr[data-row="${B.code}"]`).first().innerText();
check(inPlan.includes("✓"), "the tree marks it as in the version");
await page.screenshot({ path: `${SHOT}/371-planning-en.png` });

// A edited where it stands: 3 days
await page.locator(`[data-plan-rows] tr[data-plan-row="${A.code}"] td`).nth(3).click();
await page.locator('[data-plan-rows] input[aria-label="Days"]').fill("3");
await page.locator("[data-plan-rows] [data-tk-save]").click();
await page.waitForTimeout(1500);
rows = (await api(`/api/eps/planning?projectId=${projectId}&versionId=${v1.id}`)).rows;
check(rows.find((r) => r.activity_id === A.id)?.end_on === "2026-03-03", "edited in its row: 3 days from the 1st finish on the 3rd");

// the plan copied into version 2, then C read from a sheet into version 2
await page.selectOption("#pl-copy", "");
await page.locator("[data-pick=version]").selectOption(v2.id);
await page.waitForTimeout(800);
await page.selectOption("#pl-copy", v1.id);
await page.locator("button[data-plan-copy]").click();
await page.locator(".okmsg").waitFor();
check((await api(`/api/eps/planning?projectId=${projectId}&versionId=${v2.id}`)).rows.length === 2, "version 2 has version 1's two rows");
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["WBS code", "Activity code", "Start", "Days", "Finish", "Done before", "Planned", "Description"],
  [node.code, C.code, "2026-04-10", 2, "", 1, 1.2345678901, "from the sheet"]]), "Planning");
const file = `${SHOT}/planning-import.xlsx`;
await writeFile(file, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
await page.locator("input[data-plan-import]").setInputFiles(file);
await page.locator(".okmsg").waitFor();
rows = (await api(`/api/eps/planning?projectId=${projectId}&versionId=${v2.id}`)).rows;
const rc = rows.find((r) => r.activity_id === C.id);
check(rc && rc.start_on === "2026-04-10" && rc.end_on === "2026-04-11" && rc.volume_plan === 1.2345678901, `C from the sheet, ten decimals kept (${JSON.stringify(rc && [rc.start_on, rc.end_on, rc.volume_plan])})`);
const dl = page.waitForEvent("download");
await page.locator("button[data-plan-export]").click();
check((await dl).suggestedFilename() === `planning-${v2.code}.xlsx`, "the version as a sheet to fill");

// the activities page reads the dates of the version picked
const startOf = async (code) => page.evaluate((c) => document.querySelector(`tr[data-row="${c}"]`)?.innerText || "", code);
await page.goto(`${BASE}/eps/activities?version=${v2.id}`, { waitUntil: "networkidle" });
await page.locator(`tr[data-row="${C.code}"]`).first().waitFor();
check(shows(await startOf(C.code), "2026-04-10"), "under version 2, C starts on 10 April (the version's plan)");
await page.locator("[data-pick=version]").selectOption("");
await page.waitForTimeout(1200);
check(shows(await startOf(C.code), "2026-02-01"), "with no version, C starts on 1 February (its own)");
await page.locator("[data-pick=version]").selectOption(v1.id);
await page.waitForTimeout(1200);
check(shows(await startOf(C.code), "2026-02-01") && shows(await startOf(A.code), "2026-03-01"), "version 1 does not plan C: its own date; A: version 1's");
await page.screenshot({ path: `${SHOT}/372-activities-by-version-en.png` });

// deleting the node picked on the activities page takes its activities, not the node
await page.locator("[data-pick=version]").selectOption("");
await page.waitForTimeout(1200);
await page.locator(`tr[data-row="${node.code}"] input[type=checkbox]`).first().check();
const asked = [];
page.removeAllListeners("dialog");
page.on("dialog", (d) => { asked.push(d.message()); d.accept(); });
await page.locator("[data-bulk-delete]").click();
await page.waitForTimeout(1500);
const tree = await api(`/api/eps/activities?projectId=${projectId}&pmsId=${pms.id}`);
// the planning rows went with the activities; the node stays
check(tree.roots.length === 1 && tree.roots[0].activities.length === 0, `the node stays, its activities are gone (${tree.roots.length} node, ${tree.roots[0]?.activities.length} activities)`);
check(asked.some((m) => /Delete 3 rows/.test(m)), `the question names the three activities only (${asked.join(" | ")})`);

await api("/api/auth/prefs", { lang: "fa" });
console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
