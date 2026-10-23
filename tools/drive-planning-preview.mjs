/**
 * Drive the planning preview and its sub-forms (owner's requirements of
 * 2026-10-22, items 13–28) on the DM-pump scenario played to the end. A PMS
 * with one version is made through the API — one node, three activities,
 * two of them planned in the version. Then, in the page:
 *   - the tree shows only the planned activities;
 *   - a planning figure is edited in the activity's own row (days → finish);
 *   - requirements: two added with «+», the second made active, which makes
 *     the first inactive; a requirement kind added to the contract's list;
 *   - comments: one added, numbered 1; copied and pasted as a new row, numbered 2;
 *   - status: the holds of the unreleased requirements by column, and the
 *     front weight = remain − holds;
 *   - planning detail lists the version; the activity detail (image 1)
 *     shows its panels and saves a field edited in place;
 *   - the daily report history is read only here.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-planning-preview.mjs
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
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
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
const pms = (await api("/api/eps", { projectId, kind: "pms", contractId, code: `PV-${tag}`, title: "Preview drive", budgetPlan: 1000 })).row;
const ver = (await api("/api/eps", { projectId, kind: "version", pmsId: pms.id, code: `PV-${tag}-R1`, title: "June" })).row;
const node = (await api("/api/eps", { projectId, kind: "node", pmsId: pms.id, name: "Piping", wf: 100, unit: "m", budgetPlan: 1000 })).row;
const mk = (name, wf, s, e, vol) => api("/api/eps", { projectId, kind: "activity", nodeId: node.id, name, wf, planStart: s, planEnd: e, volumePlan: vol, volumeActual: vol });
const A = (await mk("Spool erection", 50, "2026-01-01", "2026-01-10", 100)).row;
const B = (await mk("Support install", 30, "2026-01-05", "2026-01-15", 40)).row;
const C = (await mk("Hydrotest", 20, "2026-02-01", "2026-02-03", 3)).row;
await api("/api/eps/planning", { projectId, kind: "plan-add", versionId: ver.id, activityIds: [A.id, B.id] });

await page.goto(`${BASE}/eps/planning/preview?version=${ver.id}`, { waitUntil: "networkidle" });
await page.locator(`tr[data-row="${A.code}"]`).first().waitFor();
check(await page.locator(`tr[data-row="${C.code}"]`).count() === 0 && await page.locator(`tr[data-row="${B.code}"]`).count() > 0, "only the planned activities in the tree");

// a planning figure in the activity's own row: 4 days from its start
await page.locator(`tr[data-row="${A.code}"] td`).nth(2).click();
await page.locator(`tr[data-row="${A.code}"] input[type=number]`).first().fill("4");
await page.locator("[data-row-save]").first().click();
await page.waitForTimeout(1500);
let rows = (await api(`/api/eps/planning?projectId=${projectId}&versionId=${ver.id}`)).rows;
check(rows.find((r) => r.activity_id === A.id)?.end_on === "2026-01-04", `edited in its row: 4 days from 1 Jan finish on the 4th (${rows.find((r) => r.activity_id === A.id)?.end_on})`);

// requirements
await page.locator(`tr[data-row="${A.code}"] td`).nth(1).click();
await page.keyboard.press("Escape");
await page.locator("[data-tab=requirements]").click();
await page.locator("[data-sub=requirements]").waitFor();
const addReq = async (name, type, hold) => {
  await page.locator("[data-sub=requirements] [data-tk-add]").first().click();
  await page.locator('[data-sub=requirements] input[aria-label="REQ Name"]').fill(name);
  await page.locator('[data-sub=requirements] select[aria-label="REQ Type"]').selectOption({ label: type });
  await page.locator('[data-sub=requirements] input[aria-label="Hold Weight"]').fill(String(hold));
  await page.locator('[data-sub=requirements] select[aria-label="Active REQ."]').selectOption("true");
  await page.locator("[data-sub=requirements] [data-tk-save]").click();
  await page.locator(`[data-sub=requirements] tr[data-req="${name}"]`).waitFor();
};
await addReq("IFC drawings", "Engineering", 20);
await addReq("Pipe on site", "Material", 10);
const actives = await page.locator("[data-sub=requirements] tr[data-req]").evaluateAll((trs) => trs.map((r) => r.innerText.includes("◉")));
check(JSON.stringify(actives) === "[false,true]", `the second made active makes the first inactive (${actives})`);
await page.screenshot({ path: `${SHOT}/380-preview-requirements-en.png` });

// comments
await page.locator("[data-tab=comments]").click();
await page.locator("[data-sub=comments] [data-tk-add]").first().click();
await page.locator('[data-sub=comments] input[aria-label="Item Discussed"]').fill("Late pipe delivery");
await page.locator("[data-sub=comments] [data-tk-save]").click();
await page.locator("[data-sub=comments] tr[data-comment='1']").waitFor({ timeout: 8000 }).catch(() => {});
check(await page.locator("[data-sub=comments] tr[data-comment='1']").count() === 1, "a comment added, numbered 1");
// copied and pasted: a table that adds rows takes the copy as a new row, its values as they were (owner's requirements 2026-10-22, item 4)
{
  const box = await page.locator("[data-sub=comments] tr[data-comment='1'] td").first().boundingBox();
  await page.mouse.click(box.x + 10, box.y + box.height / 2);
  await page.locator("[data-sub=comments] [data-tk-bulk] button", { hasText: "Copy" }).click();
  asked.length = 0;
  await page.locator("[data-sub=comments] [data-tk-paste]").click();
  await page.locator("[data-sub=comments] tr[data-comment='2']").waitFor({ timeout: 8000 }).catch(() => {});
  check(asked.includes("Paste 1 rows as new rows?") && (await page.locator("[data-sub=comments] tr[data-comment='2']").innerText()).includes("Late pipe delivery"),
    `pasted as a new row, numbered 2, the same item (${asked.join(" / ")})`);
}

// status: holds 20 engineering + 10 material, front = 100 − 0 done − 30
await page.locator("[data-tab=status]").click();
await page.locator("[data-sub=status]").waitFor();
const cell = (h) => page.locator(`[data-sub=status] td[data-col="${h}"]`).innerText();
const st = { eng: await cell("Engineering Hold"), mat: await cell("Material Hold"), total: await cell("Total Hold"), front: await cell("Front Weight") };
check(st.eng === "20" && st.mat === "10" && st.total === "30" && st.front === "70", `status holds by column and the front weight (${JSON.stringify(st)})`);
await page.screenshot({ path: `${SHOT}/381-preview-status-en.png` });

// planning detail and the activity detail of image 1
await page.locator("[data-tab=groups]").click();
check(await page.locator(`tr[data-group="${ver.code}"]`).count() === 1, "planning detail lists the version");
await page.locator("[data-tab=detail]").click();
await page.locator(`[data-detail="${A.code}"]`).waitFor();
const legends = await page.locator(`[data-detail="${A.code}"] legend`).allInnerTexts();
check(["Original Status", "Actual Status", "Constrain Status", "Budget", "Float", "Weight"].every((l) => legends.includes(l)), `the panels of image 1 (${legends.join(", ")})`);
await page.locator("[data-detail-edit]").click();
await page.locator('input[aria-label="statusText"]').fill("On hold");
await page.locator('input[aria-label="suspended"]').check();
await page.locator(`[data-detail="${A.code}"] button[type=submit]`).click();
await page.waitForTimeout(1500);
const d = await api(`/api/eps/activities?projectId=${projectId}&activityId=${A.id}&versionId=${ver.id}`);
check(d.activity.status_text === "On hold" && d.activity.suspended === true, "a field of image 1 saved where it was edited");
await page.screenshot({ path: `${SHOT}/382-preview-detail-en.png` });

// the daily report history is read only here
await page.locator("[data-tab=reports]").click();
await page.waitForTimeout(500);
check(await page.locator(".p6-detail button", { hasText: /^Edit$/ }).count() === 0, "the daily report history has no edit button");

await api("/api/auth/prefs", { lang: "fa" });
console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
