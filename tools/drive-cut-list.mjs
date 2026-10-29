/**
 * Drive the cut list on the piping page (owner's request 2026-10-24, from the
 * features piping.tools describes publicly):
 *   - the demo sheet (no server): the «لیست برش» tab lists every pipe and pup
 *     by spool, with its length and the welds at its two ends;
 *   - the workbook carries a «Cut List» sheet with the same rows;
 *   - «print / save PDF» opens a printable page of the same table;
 *   - a sheet whose printed CUT PIPE LENGTH matches (eval R22) pairs it with
 *     its piece; one that does not (R23) is flagged on the tab and in the list.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-cut-list.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /نقشه دوبعدی/ }).first().click({ timeout: 1500 }).catch(() => {}); // the 2D/3D choice is hidden while SHEET_MARKUP is on (app/piping/page.jsx)
await page.getByRole("button", { name: /نمونه بدون سرور/ }).click();
const tab = page.locator(".tabnav button", { hasText: "لیست برش" });
await tab.waitFor();
check(/7/.test(await tab.innerText()), `the tab counts the pieces (${(await tab.innerText()).replace(/\s+/g, " ")})`);
await tab.click();
const list = page.locator("[data-cut-list]");
await list.waitFor();
const rows = list.locator("tbody tr");
check(await rows.count() === 7, `7 pieces listed (${await rows.count()})`);
check(/13\.110 m/.test(await list.locator(".tot").innerText()), `total 13.110 m (${await list.locator(".tot").innerText()})`);
const first = (await rows.first().innerText()).replace(/\s+/g, " ");
check(/SP-01/.test(first) && /815/.test(first) && /W-01 ↔ W-02/.test(first), `first piece: spool, length, its two welds (${first})`);
check(await list.locator("[data-cut-unmatched]").count() === 0, "no printed table on this sheet: nothing flagged");
await page.screenshot({ path: `${SHOT}/460-cut-list.png` });

// the printable page
const [pop] = await Promise.all([ctx.waitForEvent("page"), list.locator("[data-cut-print]").click()]);
await pop.waitForLoadState();
const printed = await pop.locator("table tbody tr").count();
check(/CUT LIST/.test(await pop.locator("h1").innerText()) && printed === 8, `print page: the same 7 pieces and a total (${printed} rows)`);
await pop.screenshot({ path: `${SHOT}/461-cut-list-print.png` });
await pop.close();

// the workbook's sheet
await page.locator(".tabnav button", { hasText: "سرجوش" }).click();
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /دانلود Excel/ }).click()]);
const wb = XLSX.read(readFileSync(await dl.path()));
const sheet = wb.Sheets["Cut List"];
const aoa = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1 }) : [];
const head = aoa.findIndex((r) => r[0] === "No");
const body = head >= 0 ? aoa.slice(head + 1).filter((r) => Number.isInteger(r[0])) : [];
check(Boolean(sheet) && body.length === 7 && body[0][5] === 815, `workbook «Cut List»: ${body.length} pieces, first ${body[0]?.[5]} mm`);

// a sheet with its own CUT PIPE LENGTH table: matched (R22), then not (R23)
for (const [file, matched] of [["R22-cut-length-check", true], ["R23-cut-length-mismatch", false]]) {
  const k = JSON.parse(readFileSync(`eval/cases/rules/${file}.json`, "utf8"));
  await page.locator(".tabnav button", { hasText: "JSON" }).click();
  await page.locator(".pane textarea").fill(JSON.stringify(k.input));
  await page.getByRole("button", { name: "اعمال محلی" }).click();
  await page.locator(".tabnav button", { hasText: "لیست برش" }).click();
  await list.waitFor();
  const flagged = await list.locator("[data-cut-unmatched]").count();
  const paired = await list.locator('td[data-printed]:not([data-printed=""])').count();
  const badge = (await page.locator(".tabnav button", { hasText: "لیست برش" }).innerText()).replace(/\s+/g, " ");
  if (matched) check(paired === k.input.cutLengths.length && !flagged && !/!/.test(badge), `${file}: the printed piece paired with its computed one (${paired}) · tab ${badge}`);
  else check(flagged === 1 && paired === 0 && /!/.test(badge), `${file}: the printed length no piece matches is flagged, on the tab too (${badge})`);
}
await page.screenshot({ path: `${SHOT}/462-cut-list-mismatch.png` });

console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
process.exit(failed || problems.length ? 1 : 0);
