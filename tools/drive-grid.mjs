/**
 * Drive the table and tree behaviours of the owner's requirements of
 * 2026-10-18 (items 4, 7, 9, 10, 15) on the DM-pump scenario played to the
 * end, in English:
 *   the activities tree — tools at the left (measured), a search that keeps a
 *   matched branch whole, a row edited in place (framed in blue), leaving it
 *   changed asks to save, a child added from the right-click menu, a node's
 *   box taking its whole branch, a picked row deleted, and the Excel export
 *   with each row's parent code before its own;
 *   a list table (the duties of workflow setup) — a row edited where it
 *   stands, a new one from «+», picking by the box, the right-click menu;
 *   a tree of the contract setup searched by name.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-grid.mjs
 */
import { chromium } from "playwright";
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
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
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

// a small plan: node «Piping» with two activities
const pms = (await api("/api/eps", { projectId, kind: "pms", contractId, code: "PMS-G", title: "Grid plan" })).row;
const ver = (await api("/api/eps", { projectId, kind: "version", pmsId: pms.id, code: "V1", title: "Baseline" })).row;
const node = (await api("/api/eps", { projectId, kind: "node", versionId: ver.id, name: "Piping", wf: 100, unit: "m" })).row;
await api("/api/eps", { projectId, kind: "activity", nodeId: node.id, name: "Spool erection", wf: 60, volumePlan: 100, volumeActual: 100 });
await api("/api/eps", { projectId, kind: "activity", nodeId: node.id, name: "Support install", wf: 40, volumePlan: 50, volumeActual: 50 });
const acts = async () => (await api(`/api/eps/activities?projectId=${projectId}&versionId=${ver.id}`)).roots[0].activities.map((a) => a.name).sort();

await page.goto(`${BASE}/eps/activities`, { waitUntil: "networkidle" });
await page.locator("[data-p6-bar]").waitFor();
const bar = await page.evaluate(() => {
  const el = document.querySelector("[data-p6-bar]"), f = el.querySelector(".p6-filter"), lv = el.querySelector(".p6-levels");
  return { gap: f.getBoundingClientRect().left - el.getBoundingClientRect().left, next: lv.getBoundingClientRect().left - f.getBoundingClientRect().right };
});
check(bar.gap < 24 && bar.next >= 0 && bar.next < 24, `the search at the left edge, the level buttons beside it (${Math.round(bar.gap)}px, ${Math.round(bar.next)}px)`);
const rowsShown = () => page.locator("tr[data-kind=act]").allInnerTexts();
await page.fill(".p6-filter", "Piping");
await page.waitForTimeout(300);
check((await rowsShown()).length === 2, "searching a node's name keeps its whole branch");
await page.fill(".p6-filter", "Spool");
await page.waitForTimeout(300);
check((await rowsShown()).length === 1 && await page.locator("mark", { hasText: "Spool" }).count() > 0, "searching an activity keeps it, marked in yellow");
await page.fill(".p6-filter", "");

// a row edited in place; leaving it changed asks
await page.locator("tr[data-kind=act]", { hasText: "Spool erection" }).click();
check(await page.locator("tr.p6-editing").count() === 1, "a click opens the row for editing where it stands");
const color = await page.locator("tr.p6-editing td").nth(2).evaluate((td) => getComputedStyle(td).color);
check(color === "rgb(29, 111, 216)", `the row being edited is written in blue (${color})`);
await page.locator("tr.p6-editing input.p6-in").first().fill("Spool erection & bolt-up");
await page.locator("tr[data-kind=act]", { hasText: "Support install" }).click();
check(await page.locator("[data-leave-ask]").count() === 1, "leaving a changed row asks to save or discard");
await page.locator("[data-leave-ask] button", { hasText: "Save the changes" }).click();
await page.waitForTimeout(1200);
check((await acts()).includes("Spool erection & bolt-up"), "saved from the prompt");

// a child added from the right-click menu
await page.locator("tr[data-kind=node]").first().click({ button: "right" });
await page.locator("[data-row-menu] button", { hasText: "Add a child" }).click();
await page.locator("tr[data-kind=draft] input").first().fill("Hydrotest");
await page.locator("tr[data-kind=draft] [data-row-save]").click();
await page.waitForTimeout(1200);
check((await acts()).includes("Hydrotest"), "a new activity typed in a draft row under its node");

// a node's box takes its branch; one picked row deleted
await page.locator("tr[data-kind=node] .p6-pick input").first().check();
check((await page.locator("[data-bulk]").innerText()).includes("4 rows selected"), "the node's box picks the node and its three activities");
await page.locator("[data-bulk] button", { hasText: "Clear selection" }).click();
await page.locator("tr[data-kind=act]", { hasText: "Hydrotest" }).locator(".p6-pick input").check();
await page.locator("[data-bulk-delete]").click();
await page.waitForTimeout(1200);
check(!(await acts()).includes("Hydrotest"), "a picked row deleted");

// the tree to Excel: each row with its parent's code before its own
const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("[data-excel]").click()]);
const XLSX = await import("xlsx");
const wb = XLSX.read(await readFile(await dl.path()));
const sheet = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
const h = sheet[0], pi = h.indexOf("Parent code"), ci = h.indexOf("Code");
const child = sheet.find((r) => String(r).includes("Support install"));
check(pi >= 0 && ci === pi + 1 && child && child[pi] === sheet[1][ci], `the export's parent code sits before the code (${h.slice(0, 4).join(" | ")}; ${child?.slice(0, 3).join(" | ")})`);
await page.screenshot({ path: `${SHOT}/370-tree-grid-en.png` });

// a list table: the duties of workflow setup
await api("/api/report-setup", { projectId, kind: "duty", code: "PL", name: "Planner", permissions: ["view"] });
await page.goto(`${BASE}/report-setup`, { waitUntil: "networkidle" });
const duties = page.locator("[data-duties]");
await duties.locator("[data-tk-add]").click();
await duties.locator("tr.tk-edit input").nth(0).fill("QC");
await duties.locator("tr.tk-edit input").nth(1).fill("Quality inspector");
await duties.locator("[data-tk-save]").click();
await page.waitForTimeout(900);
check(await duties.locator("tr[data-duty=QC]").count() === 1, "a new row from «+», typed where it stands");
await duties.locator("tr[data-duty=QC] td").nth(1).click();
check(await duties.locator("tr.tk-edit").count() === 1 && await duties.locator("tr[data-duty=QC]").isHidden(), "a click opens the row for editing in place");
await duties.locator("tr.tk-edit input").nth(1).fill("Senior quality inspector");
await duties.locator("[data-tk-save]").click();
await page.waitForTimeout(900);
check((await duties.locator("tr[data-duty=QC]").innerText()).includes("Senior quality inspector"), "saved without a dialog");
await duties.locator("tr[data-duty=QC]").click({ button: "right" });
check(await page.locator("[data-tk-rowmenu] button").allInnerTexts().then((x) => ["View", "Edit", "Copy", "Cut", "Delete"].every((w) => x.some((y) => y.includes(w)))),
  "the right-click menu: view, edit, copy, cut, delete");
await page.keyboard.press("Escape"); await page.mouse.click(5, 5);
const box = await duties.locator("tr[data-duty=QC] td").first().boundingBox();
await page.mouse.click(box.x + 10, box.y + box.height / 2);    // the box at the start of the cell (English: its left)
await page.waitForTimeout(200);
const picked = await duties.locator("[data-tk-bulk]").count() ? await duties.locator("[data-tk-bulk]").innerText() : "";
check(/1 rows picked/.test(picked), `the box picks the row (${picked.replace(/\s+/g, " ")})`);
await duties.locator("[data-tk-bulk-delete]").click();
await page.waitForTimeout(900);
check(await duties.locator("tr[data-duty=QC]").count() === 0, "the picked row deleted");
await page.screenshot({ path: `${SHOT}/371-list-edit-en.png` });

// a tree of the contract setup, searched
await page.goto(`${BASE}/contracts/setup`, { waitUntil: "networkidle" });
const q = page.locator(".tree-q").first();
if (await q.count()) {
  const names = await page.locator("[data-node]").allInnerTexts();
  const word = (names.find((n) => n.trim().length > 3) || "").trim().replace(/^[^\p{L}\d]+/u, "").split(/\s+/)[0];
  await q.fill(word);
  await page.waitForTimeout(300);
  check(await page.locator("[data-node] mark").count() > 0, `a contract tree searched for «${word}», the match marked`);
} else check(true, "the contract's trees are too small to need a search");

await api("/api/auth/prefs", { lang: "fa" });
console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
