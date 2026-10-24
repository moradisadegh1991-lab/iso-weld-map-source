/**
 * Drive the activity templates built as the activities page's tree table
 * (owner's request 2026-10-24): a template made from the toolbar; its
 * activities typed into new rows under it from the right-click menu,
 * numbered and coded after the template; a row edited where it stands
 * (asked first); a template copied with its activities under another, an
 * activity cut onto another template; a template moved above its sibling;
 * an activity and a template deleted.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-templates.mjs
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
await page.locator(".topbar select").selectOption(`p:${projectId}`); await page.waitForTimeout(500);
const tpls = async () => (await api(`/api/eps?projectId=${projectId}&templates=1`)).templates;
const tag = Date.now().toString(36).slice(-3).toUpperCase();
const T1 = `TA${tag}`, T2 = `TB${tag}`;
const tree = "[data-templates-tree]";
const row = (code) => page.locator(`${tree} tr[data-row="${code}"]`);
const settle = () => page.waitForTimeout(1000);

// a second template through the API, so there is somewhere to paste
await api("/api/eps", { projectId, kind: "template", code: T2, name: "Electrical" });
await page.goto(`${BASE}/eps/templates`, { waitUntil: "networkidle" });
await page.locator(`${tree}`).waitFor();

// a template from the toolbar
await page.locator(`${tree} [data-tpl-new]`).click();
await page.fill("#tp-code", T1);
await page.fill("#tp-name", "Piping");
asked.length = 0;
await page.locator("[data-tpl-form] button[type=submit]").click();
await row(T1).waitFor();
check(asked.length === 1 && await row(T1).getAttribute("data-kind") === "node", "a template made from the toolbar, asked first; it is a node of the tree");

// two activities typed into new rows under it
for (const [name, wf] of [["Spool erection", "0.6"], ["Support install", "0.3"]]) {
  await row(T1).click({ button: "right" });
  await page.locator("[data-row-menu] button", { hasText: "Add a child" }).click();
  await page.locator('tr[data-kind=draft] input[aria-label="Name"]').fill(name);
  await page.locator('tr[data-kind=draft] input[aria-label="W.F"]').fill(wf);
  await page.locator("tr[data-kind=draft] [data-row-save]").click();
  await settle();
}
let t1 = (await tpls()).find((x) => x.code === T1);
check(t1.activities.map((a) => [a.code, a.name, Number(a.wf)]).join("|") === `${T1}01,Spool erection,60|${T1}02,Support install,30`,
  `activities typed under it, numbered and coded after the template (${t1.activities.map((a) => a.code).join(", ")})`);
check(await row(`${T1}01`).getAttribute("data-kind") === "act" && (await row(`${T1}01`).innerText()).includes("Spool erection"), "they show under the template in the tree");

// an activity edited where it stands
await row(`${T1}02`).locator("td").nth(3).click();
await page.locator('tr.p6-editing input[aria-label="W.F"]').fill("0.4");
asked.length = 0;
await page.locator("tr.p6-editing [data-row-save]").click();
await settle();
t1 = (await tpls()).find((x) => x.code === T1);
check(asked[0] === "Save this row's changes?" && Number(t1.activities[1].wf) === 40 && t1.activities[1].name === "Support install",
  `an activity's W.F edited in its row, asked first (${t1.activities[1].name}: ${t1.activities[1].wf})`);
await page.screenshot({ path: `${SHOT}/470-templates-tree-en.png` });

// copied with its activities under the other template
await page.keyboard.press("Escape");
await row(T1).click({ button: "right" });
await page.locator("[data-row-menu] button", { hasText: "Copy" }).click();
await row(T2).click({ button: "right" });
await page.locator("[data-row-menu] button", { hasText: "Paste" }).click();
await settle();
const t2 = (await tpls()).find((x) => x.code === T2);
const copy = (await tpls()).find((x) => x.parent_id === t2.id);
check(Boolean(copy) && copy.activities.length === 2, `a template copied with its activities under ${T2} (${copy?.code})`);

// an activity cut onto the other template
await row(`${T1}01`).click({ button: "right" });
await page.locator("[data-row-menu] button", { hasText: "Cut" }).click();
await row(T2).click({ button: "right" });
await page.locator("[data-row-menu] button", { hasText: "Paste" }).click();
await settle();
const now = await tpls();
check(now.find((x) => x.code === T1).activities.length === 1 && now.find((x) => x.code === T2).activities.some((a) => a.name === "Spool erection"),
  "an activity cut from one template onto another");

// moved above its sibling
const before = (await tpls()).filter((x) => !x.parent_id).sort((a, c) => a.seq - c.seq).map((x) => x.code);
await row(T1).click({ button: "right" });
await page.locator("[data-row-menu] [data-move-up]").click();
await settle();
const after = (await tpls()).filter((x) => !x.parent_id).sort((a, c) => a.seq - c.seq).map((x) => x.code);
check(after.indexOf(T1) === before.indexOf(T1) - 1, `a template moved above its sibling (${after.slice(-3).join(", ")})`);

// deleted: an activity, then a template with what is under it
await row(`${T1}02`).click({ button: "right" });
await page.locator("[data-row-menu] button", { hasText: "Delete" }).click();
await settle();
check((await tpls()).find((x) => x.code === T1).activities.length === 0, "an activity deleted");
await row(T1).click({ button: "right" });
await page.locator("[data-row-menu] button", { hasText: "Delete" }).click();
await settle();
check(!(await tpls()).some((x) => x.code === T1), "a template deleted");

console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
process.exit(failed || problems.length ? 1 : 0);
