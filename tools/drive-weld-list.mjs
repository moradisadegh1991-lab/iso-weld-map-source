/**
 * Drive the piping page's two ways to a register without geometry:
 *   A. a register typed as JSON with no drawing file — saved, the sheet on
 *      record as having no file (it used to be refused in English);
 *   B. a weld list read from an Excel file, one row refused by name until
 *      corrected, saved, approved, and stored as entered.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... SCENARIO_CREDS=creds.json node tools/drive-weld-list.mjs
 * against a scenario project (npm run scenario:dm -- <email> --upto 5.1 --creds creds.json).
 */
import { chromium } from "playwright";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as fs from "node:fs";
import * as XLSX from "xlsx";
// SheetJS 0.20 (ESM) writes files in Node only with the fs module handed to it.
XLSX.set_fs(fs);
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD, SCENARIO_CREDS } = process.env;
const creds = JSON.parse(await readFile(SCENARIO_CREDS, "utf8"));
const S = await mkdtemp(path.join(tmpdir(), "weldlist-"));
const problems = [], log = (m) => console.log(m);
const check = (ok, what) => { log(`  ${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push(what); };
const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
p.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
await p.goto(BASE, { waitUntil: "networkidle" });
await p.fill("#email", EMAIL); await p.fill("#password", PASSWORD);
await p.click("button[type=submit]"); await p.waitForSelector(".shell");
const sel = p.locator(".topbar select").first();
const v = await sel.locator("option").evaluateAll((os, code) => os.find((o) => o.textContent.includes(`${code} —`))?.value, creds.project);
await sel.selectOption(v); await p.waitForTimeout(800);
const settle = () => p.waitForTimeout(900);
const flat = (t) => t.replace(/\s+/g, " ").trim();

log("A  JSON register with no drawing file (the reported error)");
await p.goto(BASE + "/piping", { waitUntil: "networkidle" }); await settle();
await p.getByRole("button", { name: /نقشه دوبعدی/ }).first().click();
await p.getByRole("button", { name: /نمونه بدون سرور/ }).click(); await settle();
await p.getByRole("button", { name: "ذخیره در سامانه" }).click();
await p.waitForSelector(".savebar .note, .savebar .err", { timeout: 20000 }); await settle();
const a = flat(await p.locator(".savebar").first().innerText());
check(/جوش ثبت شد/.test(a) && /بدون فایل نقشه/.test(a) && !/fileBase64/.test(a), `saved without a file («${a.slice(0, 160)}»)`);

log("B  weld list from an Excel file");
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ["Weld No", "Spool No", "Shop/Field", "Weld Type", "Size", "Tie-in Ref"],
  ["W-01", "", "Field", "Tie-in", 3, "P-7001 suction N1"],
  ["W-02", "SP-11", "Shop", "BW", 3, ""],
  ["W-03", "SP-11", "somewhere", "BW", "", ""],
  ["W-04", "SP-11", "کارگاه", "Butt weld", 3, ""],
  ["W-05", "", "Site", "BW", "", ""],
]), "Weld list");
const xlsxPath = `${S}/weld-list.xlsx`; XLSX.writeFile(wb, xlsxPath);
await p.goto(BASE + "/piping", { waitUntil: "networkidle" }); await settle();
await p.locator("#weld-list-entry > summary").click();
for (const [k, val] of [["drawingNo", "DMW-ISO-7002"], ["rev", "0"], ["lineNo", "70-DMW-7002"], ["unit", "70"], ["pipingClass", "A1DM"], ["nps", "3"], ["schedule", "SCH 40"]])
  await p.fill(`#wl-${k}`, val);
await p.setInputFiles("#wl-file", xlsxPath); await settle();
const readNote = flat(await p.locator(".weldlist .note").first().innerText());
check(/5 جوش خوانده شد/.test(readNote) && /«Weld No»/.test(readNote) && /«Size»/.test(readNote), `columns found by name («${readNote.slice(0, 200)}»)`);
const err = flat(await p.locator(".weldlist [role=alert]").innerText());
check(/1 ایراد/.test(err) && /W-03/.test(err) && /somewhere/.test(err), `the unreadable location is named, not guessed («${err.slice(0, 140)}»)`);
check(await p.locator(".weldlist .savebar button", { hasText: "ذخیره در سامانه" }).isDisabled(), "save is disabled while a row is not a register row");
await p.screenshot({ path: `${SHOT}/weldlist-problem.png`, fullPage: false });
await p.getByLabel("محل (Shop / Field) ردیف 3").fill("Shop"); await settle();
const sum = flat(await p.locator(".weldlist p.note.mono").innerText());
check(/5 جوش · کارگاه 3 · سایت 2/.test(sum) && /SP-11/.test(sum), `summary («${sum}»)`);
await p.locator(".weldlist").screenshot({ path: `${SHOT}/weldlist-form.png` });
await p.locator(".weldlist .savebar button", { hasText: "ذخیره در سامانه" }).click();
// Saved, the list reopens as the saved run: what is on record, and who must sign it.
await p.waitForSelector(".weldlist [data-run-status]", { timeout: 20000 }); await settle();
const saved = flat(await p.locator(".weldlist [data-run-status]").innerText());
check(/DMW-ISO-7002 · Rev 0 · 5 جوش · منتظر تأیید مهندس/.test(saved), `saved («${saved}»)`);
const ap = p.locator(".weldlist button", { hasText: "تأیید رجیستر (مهندس)" }).first();
check(await ap.count() > 0, "the engineer's approval is offered");
await ap.click(); await settle(); await settle();
const after = flat(await p.locator(".weldlist [data-run-status]").innerText());
check(/5 جوش · تأییدشده/.test(after), `approved («${after}»)`);
// Where the welds went: the line's register as the rest of the platform reads it.
const reg = await p.evaluate(async (pid) => {
  const d = await (await fetch(`/api/documents?projectId=${pid}&docNo=DMW-ISO-7002`)).json();
  const r = await (await fetch(`/api/runs?projectId=${pid}&documentId=${d.document.id}`)).json();
  return { uri: d.document.storage_uri, status: r.run.status, welds: r.register.map((w) => `${w.weld_no}:${w.shop_field}:${w.spool_no || "-"}:${w.ndt_requirement}`) };
}, v.replace(/^p:/, ""));    // the picker's value is «p:<id>» since contracts joined it
check(reg.status === "approved" && reg.welds.length === 5 && reg.uri.startsWith("none://"), `stored: ${JSON.stringify(reg)}`);
log(`\nproblems: ${problems.length ? "\n  " + problems.join("\n  ") : "none"}`);
await b.close();
process.exit(problems.length ? 1 : 0);
