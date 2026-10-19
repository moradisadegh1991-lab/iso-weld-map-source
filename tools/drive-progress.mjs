/**
 * Drive the daily progress entry and the multi-day view (owner's requirements
 * of 2026-10-18, items 5–6) on the DM-pump scenario played to the end. A
 * small PMS is made for its subcontract through the API — one WBS node, two
 * activities with planned dates and volumes — and the work is recorded on
 * the entry page itself, yesterday and today. Then:
 *   - the entry page's day, report number and buttons sit in one row at its
 *     left edge (measured);
 *   - the chosen day shows planned and actual progress worked out from the
 *     recorded volumes, by activity and in total;
 *   - the multi-day view has the fifteen period columns and P / AC per day,
 *     with the figures worked by hand below.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-progress.mjs
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
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
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
const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = local(new Date()), yday = local(new Date(Date.now() - 86_400_000));
const back = (n) => local(new Date(Date.now() - n * 86_400_000));
const me = await api("/api/auth/me");
const projectId = me.projects.find((p) => p.code === "DMW").id;
const contractId = (await api(`/api/contract-reports?projectId=${projectId}`)).contracts[0].id;
const sel = page.locator(".topbar select");
await sel.selectOption(`c:${contractId}`); await page.waitForTimeout(500);

// the plan: A 10 days to today, 100 m, W.F 60; B 5 days to today, 50 m, W.F 40
const pms = (await api("/api/eps", { projectId, kind: "pms", contractId, code: "PMS-D", title: "Drive plan" })).row;
const ver = (await api("/api/eps", { projectId, kind: "version", pmsId: pms.id, code: "V1", title: "Baseline" })).row;
const node = (await api("/api/eps", { projectId, kind: "node", versionId: ver.id, name: "Piping", wf: 100, unit: "m" })).row;
await api("/api/eps", { projectId, kind: "activity", nodeId: node.id, name: "Spool erection", wf: 60, planStart: back(9), planEnd: today, volumePlan: 100, volumeActual: 100 });
await api("/api/eps", { projectId, kind: "activity", nodeId: node.id, name: "Support install", wf: 40, planStart: back(4), planEnd: today, volumePlan: 50, volumeActual: 50 });
// the contract's daily reports for the two days, through its workflow, which the drive's account plays
await page.goto(`${BASE}/contract-reports`, { waitUntil: "networkidle" });
const build = page.locator("button", { hasText: "Build the workflow" });
if (await build.count()) { await build.click(); await page.locator(".okmsg").waitFor(); }
const setup = await api(`/api/report-setup?projectId=${projectId}`);
for (const g of setup.types.find((t) => t.code === "CR").stages.flatMap((s) => s.groups))
  await api("/api/report-setup", { projectId, kind: "member", groupId: g.id, userId: me.user.id, permissions: Object.keys(setup.permissions) });
for (const d of [yday, today]) await api("/api/contract-reports", { projectId, kind: "create", contractId, title: `Day ${d}`, reportDate: d });

// the entry page: 8 m of A yesterday, 6 m today, 10 m of B today
await page.goto(`${BASE}/eps/progress`, { waitUntil: "networkidle" });
await page.locator("[data-entry-bar]").waitFor();
const record = async (day, name, qty) => {
  await page.fill("#pg-day", day);
  await page.waitForTimeout(700);
  await page.locator(".p6-grid, [data-p6-grid], body").first().locator(`text=${name}`).first().click();
  await page.locator("fieldset input[dir=ltr]").fill(String(qty));
  await page.locator("button[data-add=single]").click();
  await page.locator(".okmsg, .err").first().waitFor();
  const err = await page.locator(".err").allInnerTexts();
  check(!err.length, `${qty} recorded for ${name} on ${day}${err.length ? ` (${err.join(" ")})` : ""}`);
};
await record(yday, "Spool erection", 8);
await record(today, "Spool erection", 6);
await record(today, "Support install", 10);

// the row: day, report number and buttons side by side, at the left edge
const bar = await page.evaluate(() => {
  const el = document.querySelector("[data-entry-bar]");
  const box = el.getBoundingClientRect();
  const kids = ["#pg-day", "#pg-rep", "button[data-add=single]", "button[data-add=multi]"].map((s) => el.querySelector(s).getBoundingClientRect());
  return { left: Math.min(...kids.map((k) => k.left)) - box.left, right: box.right - Math.max(...kids.map((k) => k.right)),
    rows: new Set(kids.map((k) => Math.round(k.bottom / 8))).size };
});
check(bar.rows === 1 && bar.left < 24 && bar.right > 100, `day, report no. and buttons in one row at the left (left gap ${Math.round(bar.left)}px, right gap ${Math.round(bar.right)}px)`);

// today: planned 100 % (both end today); done A 14/100 → 14 %, B 10/50 → 20 %; total 0.6×14 + 0.4×20 = 16.4 %
// the lines reload after each entry: wait for the strip to settle on the third
await page.waitForFunction(() => /actual 16\.4%/.test(document.querySelector("[data-day-progress]")?.innerText || ""), null, { timeout: 8000 }).catch(() => {});
const strip = await page.locator("[data-day-progress]").innerText();
check(/planned 100% · actual 16\.4%/.test(strip.replace(/\s+/g, " ")), `the day's planned and actual progress in total (${strip})`);
await page.screenshot({ path: `${SHOT}/360-progress-entry-en.png`, fullPage: false });

// the multi-day view: yesterday and today
await page.goto(`${BASE}/eps/progress/days`, { waitUntil: "networkidle" });
await page.locator("[data-days-filter]").click();
for (const d of [yday, today]) await page.locator(`[data-day="${d}"] input`).check();
await page.locator("button", { hasText: /تأیید|OK|Confirm/ }).first().click();
await page.waitForTimeout(1200);
const heads = await page.locator("th").allInnerTexts();
const want = ["L.W.P", "L.W.A", "T.W.P", "T.W.A", "L.P.P%", "L.P.A%", "T.P.P%", "T.P.A%", "T.SPI%", "VAR%", "C.P.P%", "C.P.A%", "C.W.P", "C.W.A", "C.SPI%"];
check(want.every((h) => heads.some((x) => x.trim().startsWith(h))), "the fifteen period columns");
check(heads.filter((x) => / (P|AC)$/.test(x.trim())).length === 4, "P and AC for each of the two days");
// A: plan 10 a day; to today 100, the two days 20, before 80; done 8 + 6 = 14, all in the two days; SPI 14/100 = 14 %, VAR 86
const rowA = await page.evaluate(() => {
  const ths = [...document.querySelectorAll("th")].map((t) => t.innerText.trim().split("\n")[0]);
  const tr = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes("Spool erection"));
  const cells = [...tr.querySelectorAll("td")].map((c) => c.innerText.trim());
  const at = (h) => cells[ths.findIndex((x) => x === h)];
  return Object.fromEntries(["L.W.P", "L.W.A", "T.W.P", "T.W.A", "T.P.P%", "T.P.A%", "T.SPI%", "VAR%", "C.W.P", "C.W.A", "C.SPI%"].map((h) => [h, at(h)]));
});
const digits = (s) => String(s ?? "").replace(/[۰-۹]/g, (c) => "۰۱۲۳۴۵۶۷۸۹".indexOf(c)).replace(/٫/g, ".").replace(/[^\d.-]/g, "");
const got = Object.fromEntries(Object.entries(rowA).map(([k, v]) => [k, digits(v)]));
check(JSON.stringify(got) === JSON.stringify({ "L.W.P": "80", "L.W.A": "0", "T.W.P": "100", "T.W.A": "14", "T.P.P%": "100", "T.P.A%": "14", "T.SPI%": "14", "VAR%": "86", "C.W.P": "20", "C.W.A": "14", "C.SPI%": "70" }),
  `Spool erection over the two days, as worked by hand (${JSON.stringify(got)})`);
await page.screenshot({ path: `${SHOT}/361-progress-days-en.png`, fullPage: false });

await api("/api/auth/prefs", { lang: "fa" });
console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
