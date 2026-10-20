/**
 * Drive the piping page's no-model reading (owner's request 2026-10-20): the
 * project's weld symbols declared (circle shop, square field), "بدون مدل"
 * chosen, a golden sheet's PDF dropped in — and the weld-list form opens
 * with the printed joint numbers, shop/field from the frames and THD from
 * the label, the title block's isometric number, sheet and revision in the
 * form's fields — while the model endpoint (/api/extract) is never called.
 * An image is refused for this method, by name.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-iso-read-local.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const SHEET = "eval/cases/golden/drawings/25-1004-SH1-0.pdf";
const CASE = JSON.parse(readFileSync("eval/cases/golden/HDPE-25-1004-SH1.json", "utf8"));
const GOLD = CASE.expect.register;
const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const page = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
const calls = [];
page.on("request", (r) => calls.push(new URL(r.url()).pathname));
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const me = await page.evaluate(() => fetch("/api/auth/me").then((r) => r.json()));
const projectId = me.projects.find((p) => p.code === "DMW").id;
await page.locator(".topbar select").selectOption(`p:${projectId}`); await page.waitForTimeout(500);
const settle = () => page.waitForTimeout(800);

// the project's convention: the rules decide shop/field from it, never the reader
await page.goto(`${BASE}/project`, { waitUntil: "networkidle" }); await settle();
await page.selectOption("#weld_symbol_shop", "circle");
await page.selectOption("#weld_symbol_field", "square");
await page.locator("form", { has: page.locator("#weld_symbol_shop") }).getByRole("button", { name: /ذخیره/ }).first().click();
await page.waitForSelector("text=ذخیره شد", { timeout: 15000 });

await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" }); await settle();
await page.getByRole("button", { name: /نقشه دوبعدی/ }).first().click();
await page.check('input[name="iso-reader"][value="local"]');
// an image is not read this way
await page.setInputFiles(".drop input[type=file]", { name: "sheet.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) });
await settle();
check(/فقط برای فایل PDF/.test(await page.locator(".err").first().innerText().catch(() => "")), "an image is refused for the no-model method, by name");

calls.length = 0;
const t0 = Date.now();
await page.setInputFiles(".drop input[type=file]", SHEET);
await page.waitForFunction(() => document.querySelector("[data-weld-marks] [data-reader=local]") && document.querySelectorAll(".wl-table tbody tr").length > 1,
  null, { timeout: 120000 }).catch(async (e) => {
  console.log("calls:", calls.join(" "), "\nerr:", await page.locator(".err").allInnerTexts(), "\nrows:", await page.locator(".wl-table tbody tr").count());
  await page.screenshot({ path: `${SHOT}/iso-read-local-fail.png` });
  throw e;
});
const secs = ((Date.now() - t0) / 1000).toFixed(1);
check(/بدون مدل و بدون توکن/.test(await page.locator("[data-weld-marks] [data-reader=local]").innerText()), "the review says the sheet was read with no model and no token");
check(calls.includes("/api/read-local") && !calls.some((c) => c.startsWith("/api/extract")), `read on the server with no model: /api/read-local, never /api/extract (${secs}s)`);
await settle();
const rows = await page.locator(".wl-table tbody tr").evaluateAll((trs) => trs.map((tr) =>
  [...tr.querySelectorAll("input")].map((i) => i.value)));
const got = new Map(rows.map((r) => [r[0], r]));
check(rows.length === GOLD.length && GOLD.every((g) => got.has(g.no)), `every printed joint number, nothing more (${rows.length} of ${GOLD.length})`);
const locOk = GOLD.filter((g) => got.get(g.no)?.[2] === g.loc).length;
check(locOk === GOLD.length, `shop/field from the frames under the project's convention: ${locOk}/${GOLD.length} as the contractor's register`);
check(got.get("10")?.[3] === "THD", `joint 10: THD from the label printed beside it (${got.get("10")?.[3]})`);
const field = (k) => page.locator(`#wl-${k}`).inputValue();
const title = { drawingNo: await field("drawingNo"), sheet: await field("sheet"), rev: await field("rev") };
check(title.drawingNo === CASE.input.meta.drawingNo && title.sheet === CASE.input.meta.sheet && title.rev === CASE.input.meta.rev,
  `title block read into the form: ${title.drawingNo} sheet ${title.sheet} rev ${title.rev} (printed ${CASE.input.meta.drawingNo} ${CASE.input.meta.sheet} ${CASE.input.meta.rev})`);
check(/جدول عنوان \(OCR/.test(await page.locator("[data-title-read]").innerText()), "the review labels the title block as an OCR reading to check");
check(await page.locator(".weldlist .savebar button", { hasText: "ذخیره در سامانه" }).isDisabled(),
  "not saved as it stands: what the drawing did not say (size, joint type, spool) is for a person");
await page.screenshot({ path: `${SHOT}/iso-read-local.png`, fullPage: false });
console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
