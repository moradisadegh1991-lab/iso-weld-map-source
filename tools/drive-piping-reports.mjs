/**
 * Drive /piping/reports on the DM-pump scenario: every report downloads as a
 * workbook that agrees with the platform's own counts, a load is made, takes
 * a spool and a ship-loose item, ships and is delivered — through the page's
 * forms — and its packing list, the weld log's load column and the progress
 * report's delivery all say so. The labels of that load print as 4×2 in
 * pages (a PDF is printed and its page size read). Then the page is read in
 * English: no Persian of its own.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-piping-reports.mjs
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
mkdirSync(SHOT, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const page = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const api = (path, body) => page.evaluate(async ([p, x]) => {
  const r = await fetch(p, x ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(x) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}: ${j.error}`);
  return j;
}, [path, body]);
const setLang = async (lang) => {
  await api("/api/auth/prefs", { lang });
  await page.evaluate((l) => localStorage.setItem("epc.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("epc.prefs") || "{}"), lang: l })), lang);
};
const projectId = (await api("/api/auth/me")).projects.find((p) => p.code === "DMW").id;
await page.locator(".topbar select").selectOption(`p:${projectId}`); await page.waitForTimeout(500);
await setLang("fa");

/** A workbook the page's own link downloads, read back. */
async function workbook(selector) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(selector).first().click()]);
  const path = `${SHOT}/${dl.suggestedFilename()}`;
  await dl.saveAs(path);
  return { wb: XLSX.read(readFileSync(path), { type: "buffer" }), name: dl.suggestedFilename() };
}
const aoa = (wb, sheet) => XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" });
const tab = async (n) => { await page.locator(".page [role=tab]").nth(n).click(); await page.waitForTimeout(300); };

await page.goto(`${BASE}/piping/reports`, { waitUntil: "networkidle" });
const hub = await api(`/api/piping/hub?projectId=${projectId}`);
check(await page.locator(".page [role=tab]").count() === 3, "three tabs: reports, loads, labels");
check(await page.locator("[data-report]").count() === 5, "four reports and the template");

let { wb, name } = await workbook('[data-report="weld-log"]');
const wl = aoa(wb, "Weld Log Detailed");
check(wl[3][0] === "Drawing No" && wl[3].length === 30, `weld log: the 30 columns (${name})`);
check(wl.length - 5 === hub.totals.welds, `weld log: one row per weld of the governing registers (${wl.length - 5} = ${hub.totals.welds})`);
({ wb } = await workbook('[data-report="bom"]'));
check(wb.SheetNames.join() === "Summary,Bill of Materials Detailed,BOM Summary", "BOM: summary, detailed and the summed list");
({ wb } = await workbook('[data-report="ndt"]'));
const ndt = Object.fromEntries(aoa(wb, "Summary").slice(1));
check(ndt["Total Welds"] === hub.totals.welds, `NDT metrics: total welds agree with the hub (${ndt["Total Welds"]})`);
({ wb } = await workbook('[data-report="progress"]'));
check(wb.SheetNames.includes("Capacity") && wb.SheetNames.includes("Weekly Trend"), "progress: capacity and weekly trend");
({ wb } = await workbook('[data-report="template"]'));
check(aoa(wb, "Weld Log")[0].length === 20, "the blank weld-log template");

// ── a load, through the forms ──
await tab(1);
const run = Date.now().toString(36).slice(-4).toUpperCase();
const loadNo = `LD-${run}`;
await page.locator(".card-actions button", { hasText: /بار تازه/ }).click();
await page.fill("#ln", loadNo); await page.fill("#ld", "DMW site gate");
await page.locator(".card-formslot button[type=submit]").click();
await page.waitForSelector(`[data-load-detail="${loadNo}"]`);
check(true, `load ${loadNo} made and opened`);
await page.locator(".card-actions button", { hasText: /افزودن اسپول/ }).click();
const box = page.locator(".rp-pick input[type=checkbox]").first();
const spoolText = (await page.locator(".rp-pick label").first().innerText()).trim();
await box.check();
await page.locator(".card-formslot button", { hasText: /افزودن/ }).click();
await page.waitForTimeout(600);
check(await page.locator(`[data-load-detail="${loadNo}"] table`).first().locator("tbody tr").count() === 1, `a spool on the load (${spoolText})`);
await page.locator(".card-actions button", { hasText: /افزودن قلم/ }).click();
await page.fill("#ii-d", "GASKET 2\" 150# RF"); await page.fill("#ii-q", "4"); await page.fill("#ii-r", spoolText.split(" ")[0]);
await page.locator(".card-formslot button[type=submit]").click();
await page.waitForTimeout(600);
await page.fill("#lon", "2026-10-21"); await page.locator("[data-ship]").click(); await page.waitForTimeout(600);
const err1 = await page.locator(".page > .err").count();
check(err1 === 0 && await page.locator("[data-deliver]").count() === 1, "shipped with its date");
await page.fill("#lon", "2026-10-20"); await page.locator("[data-deliver]").click(); await page.waitForTimeout(600);
check(/پیش از تاریخ ارسال/.test(await page.locator(".page > .err").innerText().catch(() => "")), "delivery before it left is refused, with the reason");
await page.fill("#lon", "2026-10-23"); await page.locator("[data-deliver]").click(); await page.waitForTimeout(800);
check(/تحویل‌شده/.test(await page.locator(`[data-load="${loadNo}"]`).innerText()), "delivered");
await page.screenshot({ path: `${SHOT}/piping-reports-load.png`, fullPage: true });

({ wb } = await workbook("[data-packing]"));
const pk = Object.fromEntries(aoa(wb, "Summary").slice(1));
check(pk.Status === "Delivered" && pk["Spool Count"] === 1 && pk["Shiploose Totals By Unit"] === "4 EA", `packing list: ${pk.Status}, ${pk["Spool Count"]} spool, ${pk["Shiploose Totals By Unit"]}`);
await tab(0);
({ wb } = await workbook('[data-report="weld-log"]'));
const onLoad = aoa(wb, "Weld Log Detailed").slice(4, -1).filter((r) => r[29] === loadNo);
check(onLoad.length > 0, `the weld log names the load on that spool's welds (${onLoad.length})`);
({ wb } = await workbook('[data-report="progress"]'));
const cap = Object.fromEntries(aoa(wb, "Capacity").slice(1).map((r) => [r[0], r]));
check(cap["Delivered to site"][1] > 0 || /without a length/.test(JSON.stringify(aoa(wb, "Summary"))), `progress: delivered ${cap["Delivered to site"][1]} m`);

// ── labels: 4×2 in pages ──
await tab(1);
await page.locator(".rp-detail button", { hasText: /برچسب/ }).click();
await tab(2);
await page.waitForTimeout(600);
check(await page.locator(".no-print .dlabel").count() === 1, "the load's labels: one drawing sheet");
const lab = await page.locator(".no-print .dlabel").first().boundingBox();
check(Math.abs(lab.width - 384) < 2 && Math.abs(lab.height - 192) < 2, `a label is 4×2 in on screen (${lab.width}×${lab.height} px)`);
await page.evaluate(() => document.body.classList.add("print-labels"));
const pdf = `${SHOT}/labels.pdf`;
writeFileSync(pdf, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
await page.evaluate(() => document.body.classList.remove("print-labels"));
const info = execFileSync("pdfinfo", [pdf]).toString();
const size = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info);
check(/Pages:\s+1\b/.test(info) && size && Math.round(size[1]) === 288 && Math.round(size[2]) === 144, `printed: one 288×144 pt page (${size?.[1]}×${size?.[2]})`);
const text = execFileSync("pdftotext", [pdf, "-"]).toString();
check(text.includes(loadNo) && /Drawing:/.test(text), "the label prints the load and the drawing, nothing of the page");

// ── English ──
await setLang("en");
await page.goto(`${BASE}/piping/reports`, { waitUntil: "networkidle" }); await page.waitForTimeout(500);
for (let i = 0; i < 3; i++) {
  await tab(i);
  const txt = await page.locator(".page").innerText();
  const own = txt.replace(/LD-\w+|DMW site gate|GASKET[^\n]*/g, "");
  const fa = own.match(/[^\n]*[؀-ۿ][^\n]*/g) || [];
  check(fa.length === 0, `en tab ${i + 1}: no Persian${fa.length ? " — " + fa.slice(0, 3).join(" | ") : ""}`);
}
await page.screenshot({ path: `${SHOT}/piping-reports-en.png`, fullPage: true });
await setLang("fa");
console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
