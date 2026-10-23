/**
 * Drive the tables of the platform (owner's requirements of 2026-10-22,
 * items 7–9) on the DM-pump scenario played to the end. A PMS with a version,
 * one node and two activities is made through the API; then, in the pages:
 *   - the activities grid shows W.F as a fraction (60% → 0.6) and, on the
 *     node, the sum of its activities beside it; the column chooser floats
 *     inside the window, moves by its grip and reorders by dragging; a node's
 *     box half-ticks when part of its branch is picked; a row edited is saved
 *     only after a confirmation; deleting asks first;
 *   - the WBS page: the admin adds a project column to its tree, fills it in
 *     a row, and it is there after a reload; deleting a node asks, counting its
 *     activities; a row's lower edge dragged sets its height;
 *     «update weights/budgets» writes the budget worked out from W.F, its
 *     message at the foot of the window, gone after five seconds.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-tables.mjs
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
// every question the page asks is written down; the answer is yes unless `answer` says otherwise
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
await page.evaluate(() => localStorage.setItem("epc.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("epc.prefs") || "{}"), lang: "en" })));
const me = await api("/api/auth/me");
const projectId = me.projects.find((p) => p.code === "DMW").id;
const contractId = (await api(`/api/contract-reports?projectId=${projectId}`)).contracts[0].id;
await page.locator(".topbar select").selectOption(`c:${contractId}`); await page.waitForTimeout(500);

const tag = Date.now().toString(36).slice(-4).toUpperCase();
const pms = (await api("/api/eps", { projectId, kind: "pms", contractId, code: `TB-${tag}`, title: "Tables drive", budgetPlan: 1000 })).row;
const ver = (await api("/api/eps", { projectId, kind: "version", pmsId: pms.id, code: `TB-${tag}-V1`, title: "Baseline" })).row;
const node = (await api("/api/eps", { projectId, kind: "node", pmsId: pms.id, name: "Piping", wf: 100, unit: "m" })).row;
await api("/api/eps", { projectId, kind: "activity", nodeId: node.id, name: "Spool erection", wf: 60, volumePlan: 100, volumeActual: 100 });
await api("/api/eps", { projectId, kind: "activity", nodeId: node.id, name: "Support install", wf: 40, volumePlan: 50, volumeActual: 50 });

// ── the activities grid ──────────────────────────────────────────────────
await page.goto(`${BASE}/eps/activities?pms=${pms.id}&version=${ver.id}`, { waitUntil: "networkidle" });
const act = (name) => page.locator("tr[data-kind=act]", { hasText: name });
await act("Spool erection").waitFor();
const cellOf = async (row, title) => {
  const i = await page.locator(".p6-table thead th").evaluateAll((ths, t) => ths.findIndex((th) => th.textContent.trim().startsWith(t)), title);
  return (await row.locator("td").nth(i).innerText()).trim();
};
check(await cellOf(act("Spool erection"), "W.F") === "0.6", `W.F as a fraction, no percent (${await cellOf(act("Spool erection"), "W.F")})`);
const nodeWf = await cellOf(page.locator("tr[data-kind=node]").first(), "W.F");
check(nodeWf === "1 Σ1", `the node's W.F with its activities' sum beside it (${nodeWf})`);

// the column chooser: inside the window, moved by its grip, a column dragged before another
await page.locator("button", { hasText: "Columns" }).first().click();
const chooser = page.locator(".p6-chooser");
await chooser.waitFor();
await page.waitForTimeout(200);
const inside = await chooser.evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
check(inside, `the column chooser opens inside the window (${JSON.stringify(await chooser.boundingBox())})`);
// the panel's own shift (its anchor in the toolbar may move as the page settles)
const shift = async () => (await chooser.evaluate((el) => el.style.transform)).match(/-?[\d.]+/g).map(Number);
const at0 = await shift();
const grip = await chooser.locator("[data-float-grip]").boundingBox();
await page.mouse.move(grip.x + 4, grip.y + 4); await page.mouse.down();
await page.mouse.move(grip.x - 116, grip.y + 64, { steps: 5 }); await page.mouse.up();
const at1 = await shift();
check(at1[0] - at0[0] === -120 && at1[1] - at0[1] === 60, `dragged by its grip, it moves (${at1[0] - at0[0]}, ${at1[1] - at0[1]})`);
const heads = () => page.locator(".p6-table thead th").evaluateAll((ths) => ths.map((th) => th.textContent.trim()).filter(Boolean));
await chooser.locator("[data-chooser-col=wf] [data-col-grip]").dragTo(chooser.locator("[data-chooser-col=name]"));
const h = await heads();
check(h.indexOf("W.F") >= 0 && h.indexOf("W.F") < h.findIndex((x) => x.startsWith("Task name")), `W.F dragged before the task name (${h.slice(0, 6).join(" | ")})`);
await page.screenshot({ path: `${SHOT}/400-tables-chooser-en.png` });
await page.keyboard.press("Escape");
check(await chooser.count() === 0, "Escape closes the chooser");

// half-ticked node; a confirmed save; deleting a branch says how much goes with it
await act("Spool erection").locator(".p6-pick input").check();
check(await page.locator("tr[data-kind=node] .p6-pick input").first().evaluate((el) => el.indeterminate && !el.checked), "part of a node's branch picked: its box is half-ticked");
await page.locator("[data-bulk] button", { hasText: "Clear selection" }).click();
await act("Support install").click();
await page.locator('tr.p6-editing input.p6-in[aria-label="Task name"]').fill("Support install & paint");
answer = false; asked.length = 0;
await page.locator("tr.p6-editing [data-row-save]").click();
await page.waitForTimeout(500);
check(asked[0] === "Save this row's changes?" && await page.locator("tr.p6-editing").count() === 1, `saving asks first; «no» keeps the row open (${asked[0]})`);
answer = true;
await page.locator("tr.p6-editing [data-row-save]").click();
await act("Support install & paint").waitFor();
check(await page.locator("tr.p6-editing").count() === 0, "«yes» saves it");
const toast = page.locator(".okmsg.toast");
if (await toast.count()) {
  const box = await toast.boundingBox();
  check(box.y + box.height > 950 - 60, `what was done shows at the foot of the window (${Math.round(box.y)})`);
}
answer = false; asked.length = 0;
await page.locator("tr[data-kind=node] .p6-pick input").first().check();
await page.locator("[data-bulk-delete]").click();
check(asked[0] === "Delete 2 rows?", `a node's box on the activities page deletes its activities only, and the question says so (${asked[0]})`);
answer = true;
await page.locator("[data-bulk] button", { hasText: "Clear selection" }).click();

// ── the WBS page (the activities page's tree, 2026-10-22 round two) ──────
await page.goto(`${BASE}/eps/wbs?pms=${pms.id}`, { waitUntil: "networkidle" });
const row = page.locator(`[data-wbs-tree] tr[data-kind=node][data-row="${node.code}"]`);
await row.waitFor();
await page.locator("[data-wbs-tree] [data-tk-addcol]").click();
const label = `Area ${tag}`;
await page.locator("[data-tk-collabel]").fill(label);
await page.locator("[data-tk-coltype]").selectOption("list");
await page.locator("[data-tk-coldlg] input[placeholder]").fill("North, South");
await page.locator("[data-tk-colsave]").click();
await page.locator("[data-wbs-tree] .p6-table thead th", { hasText: label }).waitFor();
check(true, "the admin adds a project column of choices to the tree");
await page.locator("[data-tk-coldlg] button", { hasText: "Close" }).click();
// the project's columns stay the project's: an earlier run's are there too, so this one is found by its heading
const colAt = async () => (await page.locator("[data-wbs-tree] .p6-table thead th").evaluateAll((ths) => ths.map((th) => th.textContent.trim()))).indexOf(label);
await row.locator("td").nth(3).click();
await page.locator(`tr.p6-editing select[aria-label="${label}"]`).selectOption("South");
await page.locator("tr.p6-editing [data-row-save]").click();
await page.waitForTimeout(1200);
await page.reload({ waitUntil: "networkidle" });
await row.waitFor();
check((await row.locator("td").nth(await colAt()).innerText()).trim() === "South", "a value picked in the row is there after a reload");

// deleting a node asks, and says its activities go with it
await row.locator("td").nth(3).click();
await page.keyboard.press("Escape");
await page.locator("[data-wbs-tab=wbs]").click();
answer = false; asked.length = 0;
await page.locator(`[data-wbs-detail="${node.code}"] [data-node-remove]`).click();
check(asked[0] === `Delete node ${node.code}? Its 2 activities go too.`, `deleting a node asks, counting its activities (${asked[0]})`);
answer = true;

// a row's lower edge dragged sets its height (a list table: the node's activities)
await page.locator("[data-wbs-tab=acts]").click();
const arow = page.locator(`[data-activities="${node.code}"] tr[data-activity]`).first();
await arow.scrollIntoViewIfNeeded();
const seen = await arow.locator("td").evaluateAll((tds) => tds.findIndex((td) => { const r = td.getBoundingClientRect(); return td.contains(document.elementFromPoint(r.left + 20, r.bottom - 2)); }));
const cell = arow.locator("td").nth(seen);
const cb = await cell.boundingBox();
await page.mouse.move(cb.x + 20, cb.y + cb.height - 2);
await page.mouse.down(); await page.mouse.move(cb.x + 20, cb.y + cb.height + 40, { steps: 4 }); await page.mouse.up();
const h2 = (await arow.boundingBox()).height;
check(Math.abs(h2 - (cb.height + 40)) <= 3, `the row's lower edge dragged: ${Math.round(cb.height)}px → ${Math.round(h2)}px`);

// update weights/budgets, under «budget from W.F»
await api("/api/eps", { projectId, kind: "settings", pmsId: pms.id, settings: { budgetMode: "wf_to_budget", separator: ".", levels: [{ prefix: "C", digits: 2 }] } });
await page.reload({ waitUntil: "networkidle" });
asked.length = 0;
await page.locator("[data-refresh-weights]").click();
await toast.waitFor();
check(asked[0] === "Write the worked-out figures over the nodes' stored ones?", `asked before writing (${asked[0]})`);
check((await toast.innerText()).includes("1 nodes updated"), `the message: ${await toast.innerText()}`);
const tb = await toast.boundingBox();
check(tb.y > 950 - 80, `at the foot of the window (${Math.round(tb.y)})`);
await page.screenshot({ path: `${SHOT}/401-tables-wbs-en.png` });
await page.waitForTimeout(5800);
check(!(await toast.isVisible()), "gone after five seconds");
const stored = (await api(`/api/eps?projectId=${projectId}&pmsId=${pms.id}`)).roots[0];
check(Number(stored.budget_plan) === 1000, `the node's budget stored from its W.F (${stored.budget_plan})`);

console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
process.exit(failed || problems.length ? 1 : 0);
