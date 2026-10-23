/**
 * Drive the desk and notifications (owner's requirements of 2026-10-22,
 * items 13–15) on the DM-pump scenario played to the end:
 *   - the desk lists the person's requests, active and archived, what waits
 *     on them first; the forms they may start; «open» lands on the request's
 *     own page with it open;
 *   - a notification with a file and a day to reply by, sent to a person
 *     made for the drive (a viewer), after a question; the sent list shows
 *     them as not yet read;
 *   - that person signs in: it is in their inbox, unread; opened, it is read,
 *     its file downloads, they reply once; the desk counts what waits on them;
 *   - the sender sees the reply.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-desk-notifications.mjs
 */
import { chromium } from "playwright";
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
const asked = [];
async function session(email, password) {
  const page = await (await b.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })).newPage();
  page.on("pageerror", (e) => problems.push(`pageerror (${email}): ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
  page.on("dialog", (d) => { asked.push(d.message()); d.accept(); });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.fill("#email", email); await page.fill("#password", password);
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
  return { page, api, me, projectId };
}

// ── the desk ─────────────────────────────────────────────────────────────
const A = await session(EMAIL, PASSWORD);
const contractId = (await A.api(`/api/contract-reports?projectId=${A.projectId}`)).contracts[0].id;
await A.page.locator(".topbar select").selectOption(`c:${contractId}`); await A.page.waitForTimeout(500);
// the contract daily report's workflow, built if it is not yet, with the drive's account in its groups; two requests written
await A.page.goto(`${BASE}/contract-reports`, { waitUntil: "networkidle" });
const build = A.page.locator("button", { hasText: "Build the workflow" });
if (await build.count()) { await build.click(); await A.page.locator(".okmsg").waitFor(); }
const setup = await A.api(`/api/report-setup?projectId=${A.projectId}`);
for (const g of setup.types.find((t) => t.code === "CR").stages.flatMap((s) => s.groups))
  await A.api("/api/report-setup", { projectId: A.projectId, kind: "member", groupId: g.id, userId: A.me.user.id, permissions: Object.keys(setup.permissions) });
const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const r1 = (await A.api("/api/contract-reports", { projectId: A.projectId, kind: "create", contractId, title: "Desk drive one", reportDate: day(2) })).row;
const r2 = (await A.api("/api/contract-reports", { projectId: A.projectId, kind: "create", contractId, title: "Desk drive two", reportDate: day(1) })).row;
// the first one cancelled: into the archive
await A.api("/api/contract-reports", { projectId: A.projectId, reportId: r1.id, kind: "cancel", comment: "written twice" });
await A.page.goto(`${BASE}/desk`, { waitUntil: "networkidle" });
const d = await A.api(`/api/desk?projectId=${A.projectId}`);
check(d.active.some((x) => x.id === r2.id && x.waits.includes("sign")) && d.archive.some((x) => x.id === r1.id && x.status === "cancelled"),
  "the written request waits on its maker's signature; the cancelled one is archived");
check(d.start.some((x) => x.code === "CR"), "the contract daily report is offered to start");
const list = A.page.locator("[data-desk-list=active]");
await list.waitFor();
check(await list.locator("tr[data-request]").count() === d.active.length && d.active.length > 0, `the active requests listed (${d.active.length})`);
const firstWaits = d.active.findIndex((r) => r.waits.length);
check(firstWaits <= 0, "what waits on the person comes first");
check(await A.page.locator("[data-desk-start] [data-start]").count() === d.start.length, `the forms they may start (${d.start.map((x) => x.code).join(", ") || "none"})`);
await A.page.locator("[data-desk-tab=archive]").click();
check(await A.page.locator("[data-desk-list=archive], .empty-note").count() > 0, `the archive tab (${d.archive.length})`);
await A.page.screenshot({ path: `${SHOT}/430-desk-en.png` });
await A.page.locator("[data-desk-tab=active]").click();
const target = d.active.find((r) => r.href?.startsWith("/contract-reports"));
if (target) {
  await A.page.locator(`[data-open="${target.reportNo}"]`).click();
  await A.page.waitForURL(/\/contract-reports\?report=/);
  await A.page.locator("[data-current-stage]").first().waitFor({ timeout: 15000 }).catch(() => {});
  check(await A.page.locator("[data-current-stage]").count() > 0, `«open» lands on ${target.reportNo}, open on its own page`);
} else check(false, "a contract daily report on the desk to open");

// ── a notification ───────────────────────────────────────────────────────
const who = `reader.${Date.now()}@drive.test`;
const inv = await A.api("/api/users", { projectId: A.projectId, kind: "invite", email: who, displayName: "Desk Reader", role: "viewer" });
await A.page.evaluate(async ([t]) => fetch("/api/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: t, password: "Reader-password-for-drive-1" }) }), [inv.link.token]);
const file = `${SHOT}/notice-${Date.now()}.txt`;
await writeFile(file, "Pipe list: 6in x 40 m");
const due = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
const title = `Pipe on site? ${Date.now().toString(36)}`;
await A.page.goto(`${BASE}/notifications`, { waitUntil: "networkidle" });
await A.page.locator("[data-compose-card] .fold-btn").click();
await A.page.fill("#nt-title", title);
await A.page.fill("#nt-body", "Please confirm the pipe delivered today.");
await A.page.locator('[data-to="Desk Reader"]').check();
await A.page.fill("#nt-due", due);
await A.page.setInputFiles("#nt-files", file);
asked.length = 0;
await A.page.locator("[data-send]").click();
await A.page.locator(`[data-outbox] tr[data-note="${title}"]`).waitFor();
check(asked[0] === "Send the notification to 1 people? It cannot be changed once sent.", `asked before sending (${asked[0]})`);
check((await A.page.locator(`[data-outbox] tr[data-note="${title}"]`).innerText()).includes("Desk Reader: Unread"), "sent: the recipient not yet read");

// ── the recipient ────────────────────────────────────────────────────────
const B = await session(who, "Reader-password-for-drive-1");
const dk = await B.api(`/api/desk?projectId=${B.projectId}`);
check(dk.notifications.unread === 1 && dk.notifications.awaitingReply === 1, `the recipient's desk counts it (${JSON.stringify(dk.notifications)})`);
await B.page.goto(`${BASE}/notifications`, { waitUntil: "networkidle" });
const row = B.page.locator(`[data-inbox] tr[data-note="${title}"]`);
await row.waitFor();
check(await row.evaluate((tr) => getComputedStyle(tr).fontWeight) === "700", "unread: in bold");
await row.click();
await B.page.locator(`[data-opened="${title}"] [data-body]`).waitFor();
const [dl] = await Promise.all([B.page.waitForEvent("download"), B.page.locator(`[data-opened="${title}"] [data-file]`).first().click()]);
check(dl.suggestedFilename().endsWith(".txt"), `its file downloads (${dl.suggestedFilename()})`);
await B.page.fill("#nt-reply", "Delivered: 40 m, unloaded at bay 3.");
asked.length = 0;
await B.page.locator("[data-reply]").click();
await B.page.locator("[data-my-reply]").waitFor();
check(asked[0] === "Send the reply? It cannot be changed afterwards.", "asked before replying");
check((await row.innerText()).includes("Replied") && await row.evaluate((tr) => getComputedStyle(tr).fontWeight) !== "700", "read and replied");
await B.page.screenshot({ path: `${SHOT}/431-notification-reply-en.png` });

// ── back to the sender ───────────────────────────────────────────────────
await A.page.reload({ waitUntil: "networkidle" });
await A.page.locator("[data-nt-tab=outbox]").click();
await A.page.locator(`[data-outbox] tr[data-note="${title}"]`).click();
const rec = await A.page.locator("[data-recipients]").innerText();
check(rec.includes("Replied") && rec.includes("Delivered: 40 m"), "the sender sees the reply");
await A.page.screenshot({ path: `${SHOT}/432-notification-sent-en.png` });

console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
process.exit(failed || problems.length ? 1 : 0);
