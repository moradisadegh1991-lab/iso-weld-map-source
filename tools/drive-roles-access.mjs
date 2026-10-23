/**
 * Drive roles, a holder's own access, temporary access, the approver named by
 * a duty and a stage's deadline on the workflow setup page (owner's
 * requirements of 2026-10-22, items 1 and 2-a), on the DM-pump scenario
 * played to the end:
 *   - a role added under the contract in its row; a duty put in it shows it;
 *   - a holder added to the duty with their own access level and temporary
 *     dates; without the dates it is not saved;
 *   - in the contract daily report's workflow, the first stage's approver
 *     named by a duty that signs there, and its deadline with the text
 *     shown in place of the signature — the text required once days are set.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-roles-access.mjs
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
const page = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
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
const setup = () => api(`/api/report-setup?projectId=${projectId}`);
const tag = Date.now().toString(36).slice(-4).toUpperCase();

// ── a role under the contract ────────────────────────────────────────────
await page.goto(`${BASE}/report-setup`, { waitUntil: "networkidle" });
const roles = page.locator("[data-roles]");
await roles.waitFor();
const roleName = `Site supervision ${tag}`;
await roles.locator("[data-tk-add]").click();
await roles.locator(`tr.tk-edit input[aria-label="Role"]`).fill(roleName);
await roles.locator("[data-tk-save]").click();
await roles.locator(`tr[data-role="${roleName}"]`).waitFor();
let s = await setup();
const role = s.roles.find((r) => r.name === roleName);
check(!!role && role.contract_no === s.contracts[0].contract_no, `a role added under the contract (${role?.contract_no} › ${role?.name})`);

// a duty in the role
const duty = (await api("/api/report-setup", { projectId, kind: "duty", code: `RA${tag}`, name: `Resident engineer ${tag}`, permissions: ["view", "edit", "sign", "approve"], roleId: role.id })).row;
await page.reload({ waitUntil: "networkidle" });
const drow = page.locator(`[data-duties] tr[data-duty="RA${tag}"]`);
check((await drow.innerText()).includes(`› ${roleName}`), "the duty shows its role");
check((await roles.locator(`tr[data-role="${roleName}"]`).innerText()).includes(`Resident engineer ${tag}`), "the role lists its duty");

// ── a holder with their own level and temporary dates ────────────────────
const user = s.users.find((u) => u.active && u.id !== me.user.id) || s.users[0];
await drow.locator("[data-holder-add]").click();
await drow.locator("[data-holder-user]").selectOption(user.id);
await drow.locator("[data-holder-own]").check();
await drow.locator('[data-holder-perm="approve"]').uncheck();
await drow.locator('[data-holder-perm="edit"]').uncheck();
await drow.locator("[data-holder-temp]").check();
await drow.locator("[data-holder-save]").click();
await page.waitForTimeout(500);
check(await drow.locator("[data-holder-from]").count() === 1, "temporary access is not saved without its days");
const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
await drow.locator("[data-holder-from]").fill(from);
await drow.locator("[data-holder-to]").fill(to);
await drow.locator("[data-holder-save]").click();
await drow.locator(`[data-holder="${user.name}"]`).waitFor();
s = await setup();
const held = s.duties.find((d) => d.id === duty.id).members[0];
check(JSON.stringify(held.permissions) === JSON.stringify(["view", "sign"]) && held.temporary && held.startsOn === from && held.endsOn === to,
  `held with their own level and temporary days (${held.permissions} · ${held.startsOn} → ${held.endsOn})`);
check((await drow.locator("[data-temporary]").innerText()).includes(from), "the row shows the temporary span");
await page.screenshot({ path: `${SHOT}/420-roles-holders-en.png` });

// ── the contract daily report's workflow: approver by duty, stage deadline ──
const cr = s.types.find((x) => x.code === "CR");
const wf = s.workflows.find((w) => w.id === cr.workflow_id);
const st1 = wf.stageList[0];
await api("/api/report-setup", { projectId, kind: "group-duty", groupId: st1.groups[0].id, dutyId: duty.id, permissions: ["view", "edit", "sign", "approve"] });
await page.goto(`${BASE}/report-setup?type=${cr.id}`, { waitUntil: "networkidle" });
const stage = page.locator(`[data-stage-setup="${st1.seq}"]`).first();
await stage.waitFor();
await stage.locator("[data-approver-by]").selectOption("duty");
await stage.locator("[data-approver]").selectOption(duty.id);
await stage.locator("[data-approver-save]").click();
await page.waitForTimeout(800);
s = await setup();
let st = s.workflows.find((w) => w.id === wf.id).stageList[0];
check(st.approverDutyId === duty.id && st.approverName === duty.name, `the first stage's approver named by the duty (${st.approverName})`);
check(JSON.stringify(st.approverIds) === JSON.stringify([user.id]), "whoever holds it today acts as approver");
// the deadline: the text field opens once days are typed, and is required
check(await stage.locator("[data-deadline-text]").isDisabled(), "no days: the text is closed");
await stage.locator("[data-deadline-days]").fill("3");
check(!(await stage.locator("[data-deadline-text]").isDisabled()), "days typed: the text opens");
await stage.locator("[data-deadline-text]").fill("Not reviewed in time — approved by the deadline");
await stage.locator("[data-deadline-save]").click();
await page.waitForTimeout(800);
st = (await setup()).workflows.find((w) => w.id === wf.id).stageList[0];
check(st.deadlineDays === 3 && st.deadlineText === "Not reviewed in time — approved by the deadline", `the stage's deadline saved (${st.deadlineDays} days)`);
await page.screenshot({ path: `${SHOT}/421-stage-deadline-en.png` });
// put back as it was, so the scenario's daily reports are not moved on by a later run
await api("/api/report-setup", { projectId, kind: "stage-deadline", stageId: st1.id, days: null, text: null });
await api("/api/report-setup", { projectId, kind: "approver", stageId: st1.id, approverId: null, deputyId: null });

console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
process.exit(failed || problems.length ? 1 : 0);
