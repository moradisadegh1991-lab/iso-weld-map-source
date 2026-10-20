/**
 * Drive the weld-list form's reading of a weld log of many drawings: a
 * Piping.Tools "Weld Log" export (PT_WELD_LOG, the owner's file of
 * 2026-10-20) and this platform's own Weld Log report. The form must offer
 * one register per drawing sheet, name what is wrong with a sheet instead of
 * saving it (duplicate weld numbers, shop welds in no spool), split a sheet
 * by line when asked, and read our own export back clean.
 *   PT_WELD_LOG=<file.xlsx> DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-weld-log-import.mjs
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD, PT_WELD_LOG } = process.env;
if (!EMAIL || !PASSWORD || !PT_WELD_LOG) { console.error("set DRIVE_EMAIL, DRIVE_PASSWORD and PT_WELD_LOG"); process.exit(1); }
mkdirSync(SHOT, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const page = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const me = await page.evaluate(() => fetch("/api/auth/me").then((r) => r.json()));
const projectId = me.projects.find((p) => p.code === "DMW").id;
await page.locator(".topbar select").selectOption(`p:${projectId}`); await page.waitForTimeout(500);
const flat = (t) => t.replace(/\s+/g, " ").trim();
const settle = () => page.waitForTimeout(700);
const options = () => page.locator("#wl-group option:not([disabled])").allInnerTexts();
const alert = async () => flat(await page.locator(".weldlist [role=alert]").innerText().catch(() => ""));
const pick = async (re) => {
  const v = await page.locator("#wl-group option").evaluateAll((os, src) => os.find((o) => new RegExp(src).test(o.textContent))?.value, re.source);
  await page.selectOption("#wl-group", v); await settle();
};

await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" }); await settle();
await page.locator("#weld-list-entry > summary").click();
await page.setInputFiles("#wl-file", PT_WELD_LOG); await settle();
let opts = await options();
check(opts.length === 3, `Piping.Tools log: one register per drawing sheet (${opts.length}: ${opts.join(" | ")})`);
await pick(/برگ 2 /);
check(await page.locator(".wl-table tbody tr").count() === 12 && (await page.inputValue("#wl-drawingNo")) === "2146-ISO-25-0010", "sheet 2: its 12 welds and its drawing number are loaded");
let a = await alert();
check(/بدون شمارهٔ اسپول/.test(a) && !/تکراری/.test(a), `sheet 2: shop welds in no spool are named, nothing saved (${a.slice(0, 90)})`);
check(await page.locator(".weldlist .savebar button", { hasText: "ذخیره در سامانه" }).isDisabled(), "save is disabled while the sheet is not a register");
await pick(/برگ 1 /);
a = await alert();
const dups = (a.match(/تکراری/g) || []).length;
check(dups > 100, `sheet 1: ${dups} duplicate weld numbers — several lines filed under one drawing — refused`);
check(await page.locator(".wl-log .muted", { hasText: /چند خط/ }).count() === 1, "the form says why, and offers the split by line");
await page.screenshot({ path: `${SHOT}/weld-log-import-dups.png` });
await page.check("#wl-byline"); await settle();
opts = await options();
check(opts.length === 10, `split by line: ${opts.length} registers`);
await pick(/LC-81019/);
a = await alert();
check(!/تکراری/.test(a) && (await page.inputValue("#wl-lineNo")).includes("LC-81019"), "one line of sheet 1: no duplicates, its line number filled");

// this platform's own Weld Log back in
const res = await page.request.get(`${BASE}/api/piping/reports?projectId=${projectId}&kind=weld-log`);
const own = `${SHOT}/own-weld-log.xlsx`;
writeFileSync(own, await res.body());
await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" }); await settle();
await page.locator("#weld-list-entry > summary").click();
await page.setInputFiles("#wl-file", own); await settle();
opts = await options();
check(opts.length === 1 && /DMW-ISO-7001/.test(opts[0]), `our own Weld Log reads back (${opts.join(" | ")})`);
await pick(/DMW-ISO-7001/);
check(!(await alert()) && /6 جوش/.test(flat(await page.locator(".weldlist p.note.mono").innerText())), "…as a clean register of its 6 welds");
console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
