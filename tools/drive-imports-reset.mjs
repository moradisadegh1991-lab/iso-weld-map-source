/**
 * Drive the last part of the owner's requirements of 2026-10-18 (items 8, 11,
 * 12, 13, 16) on the DM-pump scenario played to the end, in English:
 *   - every import page offers its Excel template; the EPS template, filled as
 *     it comes, imports back as a new version (round trip through the page);
 *   - a link of an activity to the platform's items is removed on the scope
 *     page, and an activity removed from there with its link;
 *   - the daily report's resources are filtered by name, and to what the
 *     report books, the rows below following the filter;
 *   - "forgot password" mails a one-time link to the account's own address:
 *     a tiny SMTP sink here catches the mail, the link sets a new password,
 *     and the person signs in with it.
 * The app must run with mail on, pointing at the sink this drive opens:
 *   SMTP_HOST=127.0.0.1 SMTP_PORT=2525 SMTP_FROM=epc@drive.test APP_URL=http://localhost:3000 (next start)
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-imports-reset.mjs
 */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import net from "node:net";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }

// the SMTP sink: enough of RFC 5321 for one client to hand over a message
const mails = [];
const sink = net.createServer((c) => {
  let data = false, body = "";
  c.write("220 sink ESMTP\r\n");
  c.on("data", (buf) => {
    for (const line of buf.toString("utf8").split(/\r\n/)) {
      if (data) {
        if (line === ".") { data = false; mails.push(body); body = ""; c.write("250 queued\r\n"); } else body += line + "\n";
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (!line) continue;
      if (cmd === "EHLO" || cmd === "HELO") c.write("250 sink\r\n");
      else if (cmd === "DATA") { data = true; c.write("354 go\r\n"); }
      else if (cmd === "QUIT") { c.write("221 bye\r\n"); c.end(); }
      else c.write("250 ok\r\n");
    }
  });
});
await new Promise((r) => sink.listen(2525, "127.0.0.1", r));

const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());
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
await api("/api/auth/prefs", { lang: "en" });
await page.evaluate(() => localStorage.setItem("epc.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("epc.prefs") || "{}"), lang: "en" })));
const me = await api("/api/auth/me");
const projectId = me.projects.find((p) => p.code === "DMW").id;
const contractId = (await api(`/api/contract-reports?projectId=${projectId}`)).contracts[0].id;
await page.locator(".topbar select").selectOption(`c:${contractId}`); await page.waitForTimeout(500);
const XLSX = await import("xlsx");
const grab = async (loc) => { const [dl] = await Promise.all([page.waitForEvent("download"), loc.click()]); return { name: dl.suggestedFilename(), path: await dl.path() }; };

// ── items 8, 16: templates on every import page; the EPS one round-trips ──
const run = Date.now().toString(36).slice(-4).toUpperCase();   // the drive can run again on the same database
const pms = (await api("/api/eps", { projectId, kind: "pms", contractId, code: `PMS-T${run}`, title: "Template plan" })).row;
await page.goto(`${BASE}/eps`, { waitUntil: "networkidle" });
await page.locator("[data-import-open]").click();
await page.selectOption("#im-pms", pms.id);
await page.selectOption("#im-kind", "sheet");
const eps = await grab(page.locator("[data-template=eps]"));
const wb = XLSX.read(await readFile(eps.path));
check(eps.name === "eps-wbs-template.xlsx" && wb.SheetNames.join() === "WBS,Guide", `the EPS template downloads with its guide (${eps.name}: ${wb.SheetNames.join(", ")})`);
await page.fill("#im-code", `T${run}`);
await page.setInputFiles("#im-file", eps.path);
await page.locator("[data-import-plan] button[type=submit]").click();
await page.locator(".okmsg, .err").first().waitFor();
const said = await page.locator(".okmsg, .err").first().innerText();
check(/3 گره، 3 فعالیت|3 nodes?, 3 activit|۳ گره، ۳ فعالیت/.test(said), `the template, as downloaded, imports as a version (${said})`);
await page.locator("[data-import-open]").click();      // the form closes on a successful import
await page.selectOption("#im-kind", "pms");
const pmsT = await grab(page.locator("[data-template=pms]"));
check(pmsT.name === "pms-template.xlsx", "the PMS workbook template offered for a PMS import");
// each import sits where it always has: on a tab of its page, sometimes in a folded form
for (const [path, kind, openers] of [["/contracts/design", "design", []], ["/equipment", "equipment", ["ورود لیست"]], ["/warehouse", "mesc", ["MESC", "کاتالوگ"]]]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const btn = page.locator(`[data-template=${kind}]`);
  for (const o of openers) {
    if (await btn.isVisible().catch(() => false)) break;
    const el = page.locator("button, summary", { hasText: o }).first();
    if (await el.count()) { await el.click(); await page.waitForTimeout(500); }
  }
  if (!(await btn.isVisible().catch(() => false))) { check(false, `${path}: no template button in view`); continue; }
  const f = await grab(btn.first());
  const s = XLSX.read(await readFile(f.path));
  check(s.SheetNames.length === 2, `${path}: «${f.name}» with its data sheet and guide`);
}

// ── item 12: a link removed, an activity removed, from the scope page ──
const ver = (await api("/api/eps", { projectId, kind: "version", pmsId: pms.id, code: `S${run}`, title: "Scope" })).row;
const node = (await api("/api/eps", { projectId, kind: "node", versionId: ver.id, name: "Mechanical", wf: 100 })).row;
const a1 = (await api("/api/eps", { projectId, kind: "activity", nodeId: node.id, name: "Pump erection", wf: 50 })).row;
const a2 = (await api("/api/eps", { projectId, kind: "activity", nodeId: node.id, name: "Tank erection", wf: 50 })).row;
for (const a of [a1, a2]) await api("/api/eps/activities", { projectId, kind: "scope-rule", activityId: a.id, discipline: "equipment", measure: "count" });
await page.goto(`${BASE}/eps/scope?version=${ver.id}`, { waitUntil: "networkidle" });
await page.locator("tr[data-key]").first().waitFor();
const rows = () => page.locator("tr[data-key]");
check(await rows().count() === 2, `the two links shown (${await rows().count()})`);
await rows().filter({ hasText: "Pump erection" }).locator("[data-unlink]").click();
await page.waitForTimeout(1000);
const left = async () => (await api(`/api/eps/activities?projectId=${projectId}&versionId=${ver.id}`));
let st = await left();
check(st.scope.length === 1 && st.roots[0].activities.some((a) => a.name === "Pump erection"), "«remove link»: the link gone, the activity kept");
await rows().filter({ hasText: "Tank erection" }).locator("[data-remove-activity]").click();
await page.waitForTimeout(1000);
st = await left();
check(st.scope.length === 0 && !st.roots[0].activities.some((a) => a.name === "Tank erection"), "«remove activity»: the activity and its link gone");
await page.screenshot({ path: `${SHOT}/380-scope-remove-en.png` });

// ── item 11: the daily report's resources filtered ──
for (const [name, kind, unit] of [["Welder", "person", null], ["Fitter", "person", null], ["Crane 50t", "machine", "No."]])
  await api("/api/resources", { projectId, kind: "resource", contractId, resourceKind: kind, name, unit }).catch(() => {});
// a report to look at, through the contract report's workflow, which the drive's account plays
await page.goto(`${BASE}/contract-reports`, { waitUntil: "networkidle" });
const build = page.locator("button", { hasText: "Build the workflow" });
if (await build.count()) { await build.click(); await page.locator(".okmsg").waitFor(); }
const setup = await api(`/api/report-setup?projectId=${projectId}`);
for (const g of setup.types.find((t) => t.code === "CR").stages.flatMap((s) => s.groups))
  await api("/api/report-setup", { projectId, kind: "member", groupId: g.id, userId: me.user.id, permissions: Object.keys(setup.permissions) });
const rep = (await api("/api/contract-reports", { projectId, kind: "create", contractId, title: `Resources ${run}`, reportDate: new Date().toISOString().slice(0, 10) })).row;
await page.goto(`${BASE}/contract-reports`, { waitUntil: "networkidle" });
await page.locator("tr", { hasText: `Resources ${run}` }).locator("button", { hasText: "Open" }).click();
await page.locator(".ptabs").waitFor();
await page.locator(".ptabs button", { hasText: "Resources" }).click();
await page.locator("[data-res-filter]").waitFor();
const board = () => page.locator("[data-board-resource]");
void rep;
const all = await board().count();
await page.fill("[data-res-filter] input[type=search]", "weld");
await page.waitForTimeout(300);
const names = await board().allInnerTexts();
check(all >= 3 && names.length >= 1 && names.every((x) => /weld/i.test(x)), `searching «weld» leaves only welders (${names.length} of ${all})`);
check(/of/.test(await page.locator("[data-res-count]").innerText()), "the count of shown resources");
await page.fill("[data-res-filter] input[type=search]", "machine");
await page.waitForTimeout(300);
check((await board().allInnerTexts()).some((x) => x.includes("Crane")), "searching a kind finds the crane");
await page.fill("[data-res-filter] input[type=search]", "");
await page.locator("[data-res-filter] input[type=checkbox]").check();
await page.waitForTimeout(300);
const used = await board().count();
check(used < all, `«only booked in this report» narrows the board (${used} of ${all})`);
await page.screenshot({ path: `${SHOT}/381-resources-filter-en.png`, fullPage: true });

// ── item 13: forgot password, by mail ──
const who = `reset.${Date.now()}@drive.test`;
const inv = await api("/api/users", { projectId, kind: "invite", email: who, displayName: "Reset Drive", role: "viewer" });
await page.evaluate(async ([t]) => fetch("/api/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: t, password: "First-password-for-drive-1" }) }), [inv.link.token]);
const anon = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
anon.on("pageerror", (e) => problems.push("pageerror (anon): " + e.message));
await anon.goto(BASE, { waitUntil: "networkidle" });
await anon.locator("button", { hasText: /Forgot|فراموش/ }).click();
await anon.waitForFunction(() => /email address on the account|ایمیلی که روی حساب/.test(document.querySelector(".signin")?.innerText || ""), null, { timeout: 5000 }).catch(() => {});
check(/email address on the account|ایمیلی که روی حساب/.test(await anon.locator(".signin").innerText()), "the form says the link goes to the account's email");
await anon.fill("#forgot-login", who);
await anon.locator("button[type=submit]").click();
await anon.locator(".okmsg").waitFor();
for (let i = 0; i < 30 && !mails.length; i++) await anon.waitForTimeout(200);
const mail = mails.at(-1) || "";
const flat = mail.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
const link = (flat.match(/http:\/\/localhost:3000\/setup\?token=[A-Za-z0-9_-]+/) || [])[0];
check(mails.length === 1 && new RegExp(`To: .*${who.replace(/\./g, "\\.")}`, "i").test(mail) && !!link, `one mail to the account's own address with the link (${mails.length} mail${link ? "" : ", no link"})`);
await anon.goto(link, { waitUntil: "networkidle" });
await anon.fill("#pw1", "Second-password-by-mail-2"); await anon.fill("#pw2", "Second-password-by-mail-2");
await anon.locator("button[type=submit]").click();
await anon.locator("a", { hasText: /ورود|Sign in/ }).first().waitFor();
await anon.goto(BASE, { waitUntil: "networkidle" });
await anon.fill("#email", who); await anon.fill("#password", "Second-password-by-mail-2");
await anon.click("button[type=submit]");
check(await anon.waitForSelector(".shell", { timeout: 8000 }).then(() => true).catch(() => false), "signed in with the password set from the mailed link");
await anon.goto(link, { waitUntil: "networkidle" });
check(await anon.locator(".err, [role=alert]").count() > 0, "the mailed link works once");

await api("/api/auth/prefs", { lang: "fa" });
console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close(); sink.close();
if (failed || problems.length) process.exit(1);
