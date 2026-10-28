/**
 * Drive an EPS sheet whose actual finish comes before its start (owner's
 * report of 2026-10-28: a 13,000-row PMS refused whole by a database error):
 * the file goes in as a new PMS, the rows named in a list of their own under
 * the message, their actual dates left empty. IMPORT_FILE drives a file of
 * your own instead of the one built here.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... [IMPORT_FILE=...] node tools/drive-import-notes.mjs
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { writeFile } from "node:fs/promises";
import { SHEET_HEAD } from "../lib/eps/import.mjs";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD, IMPORT_FILE } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const page = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
page.on("dialog", (d) => d.accept());
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const api = (path) => page.evaluate(async (p) => { const r = await fetch(p); const j = await r.json(); if (!r.ok) throw new Error(`${p}: ${j.error}`); return j; }, path);
await page.evaluate(() => fetch("/api/auth/prefs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang: "en" }) }));
const me = await api("/api/auth/me");
const projectId = me.projects.find((p) => p.code === "DMW").id;
await page.locator(".topbar select").selectOption(`p:${projectId}`); await page.waitForTimeout(500);
const contractId = (await api(`/api/contract-reports?projectId=${projectId}`)).contracts[0].id;
await page.locator(".topbar select").selectOption(`c:${contractId}`); await page.waitForTimeout(500);
const tag = Date.now().toString(36).slice(-4).toUpperCase();

let file = IMPORT_FILE;
if (!file) {
  const row = (vals) => { const r = new Array(SHEET_HEAD.length).fill(""); for (const [h, v] of Object.entries(vals)) r[SHEET_HEAD.indexOf(h)] = v; return r; };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([SHEET_HEAD,
    row({ Code: "01", Name: "Civil" }),
    row({ "Parent code": "01", Code: "A-1", Name: "Anchor bolt", "Actual start": "2024-11-27", "Actual end": "2024-07-27" }),
    row({ "Parent code": "01", Code: "A-2", Name: "Rebar", "Actual start": "2025-06-01", "Actual end": "2025-06-18" }),
  ]), "WBS");
  file = `${SHOT}/eps-spans-${tag}.xlsx`;
  await writeFile(file, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
await page.goto(`${BASE}/eps`, { waitUntil: "networkidle" });
await page.locator("[data-import-open]").first().click();
await page.locator('[data-im-mode="new"]').check();
const code = `SP${tag}`;
await page.fill("#im-newcode", code);
await page.selectOption("#im-kind", "sheet");
await page.setInputFiles("#im-file", file);
await page.locator("[data-im-go]").click();
await Promise.race([page.locator(".okmsg").waitFor({ timeout: 300000 }), page.locator("p.err[role=alert]").waitFor({ timeout: 300000 })]);
const err = await page.locator("p.err[role=alert]").count() ? await page.locator("p.err[role=alert]").first().innerText() : "";
check(!err, `the file goes in, no error (${err.slice(0, 160)})`);
const made = (await api(`/api/eps?projectId=${projectId}&contractId=${contractId}`)).pms.find((p) => p.code === code);
check(Boolean(made) && made.nodes > 0, `a new PMS ${code} with ${made?.nodes} nodes`);
const notes = await page.locator("[data-import-notes] li").allInnerTexts();
check(notes.some((n) => /پایان واقعی .* پیش از شروع واقعی/.test(n)), `the rows whose actual finish is before their start are listed in full (${notes.length} notes)`);
await page.screenshot({ path: `${SHOT}/490-import-notes-en.png` });
console.log(notes.slice(0, 10).join("\n"));

console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
process.exit(failed || problems.length ? 1 : 0);
