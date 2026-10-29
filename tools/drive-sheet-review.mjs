/**
 * Drive the review beside the drawing (owner's request 2026-10-24, from the
 * features piping.tools describes publicly): a golden sheet read with no
 * model, and the weld-list form opens with the sheet beside it —
 *   - a marker on the sheet for every number read, where it was read;
 *   - a row picked picks its marker, a marker picked picks its row;
 *   - a marker dragged moves (and is the person's from then on); a weld with
 *     no marker is put on the sheet by clicking there;
 *   - saving with rows not ticked against the drawing asks first; refused,
 *     nothing is saved;
 *   - saved, the sheet is stored with the register: reopened from the review
 *     queue it comes back with the markers where they were left, coloured by
 *     where each joint stands on site — welded with its NDT accepted, welded
 *     and waiting, or open.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-sheet-review.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const SHEET = "eval/cases/golden/drawings/25-1014-SH1-0.pdf";
const GOLD = JSON.parse(readFileSync("eval/cases/golden/HDPE-25-1014-SH1.json", "utf8")).expect.register;
const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
const asked = [];
let answer = true;
page.on("dialog", (d) => { asked.push(d.message()); answer ? d.accept() : d.dismiss(); });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const api = (path, body) => page.evaluate(async ([p, x]) => {
  const r = await fetch(p, x ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(x) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}: ${j.error}`);
  return j;
}, [path, body]);
const me = await api("/api/auth/me");
const projectId = me.projects.find((p) => p.code === "DMW").id;
await page.locator(".topbar select").selectOption(`p:${projectId}`); await page.waitForTimeout(500);
const settle = () => page.waitForTimeout(800);

// the project's convention (circle shop, square field): the rules decide shop/field from it
await page.goto(`${BASE}/project`, { waitUntil: "networkidle" }); await settle();
await page.selectOption("#weld_symbol_shop", "circle");
await page.selectOption("#weld_symbol_field", "square");
await page.locator("form", { has: page.locator("#weld_symbol_shop") }).getByRole("button", { name: /ذخیره/ }).first().click();
await page.waitForSelector("text=ذخیره شد", { timeout: 15000 });

await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" }); await settle();
await page.getByRole("button", { name: /نقشه دوبعدی/ }).first().click({ timeout: 1500 }).catch(() => {}); // the 2D/3D choice is hidden while SHEET_MARKUP is on (app/piping/page.jsx)
await page.check('input[name="iso-reader"][value="local"]');
await page.setInputFiles(".drop input[type=file]", SHEET);
await page.locator("[data-wl-sheet] [data-mark]").first().waitFor({ timeout: 120000 });

// ── the sheet beside the rows ────────────────────────────────────────────
const marks = page.locator("[data-wl-sheet] [data-mark]");
check(await marks.count() === GOLD.length, `a marker for every number read (${await marks.count()} of ${GOLD.length} printed)`);
check(await page.locator('[data-wl-sheet] [data-mark][data-src="reader"]').count() === GOLD.length, "each where the reader read it");
const sheetBox = await page.locator("[data-wl-sheet] .sheet-box").boundingBox();
const tableBox = await page.locator(".wl-table").boundingBox();
check(sheetBox && tableBox && Math.abs(sheetBox.y - tableBox.y) < 160 && sheetBox.x !== tableBox.x, "the drawing and the rows side by side");
check(await page.locator('[data-mark][data-state="unchecked"]').count() === GOLD.length, "none checked against the drawing yet");
await page.screenshot({ path: `${SHOT}/450-sheet-review.png` });

// a row picks its marker
await page.locator('[data-wl-row="5"] td').first().click();
check(await page.locator('[data-mark="5"]').getAttribute("data-picked") === "true", "row 5 picked: its marker is ringed on the sheet");
// a marker picks its row
await page.locator('[data-mark="7"]').dispatchEvent("pointerdown");
await settle();
check(await page.locator('[data-wl-row="7"]').evaluate((tr) => tr.classList.contains("sel")), "marker 7 picked: its row is picked");

// a marker dragged moves, and is the person's from then on
const m3 = page.locator('[data-mark="3"]');
await m3.scrollIntoViewIfNeeded();
const before = await m3.evaluate((e) => [e.style.left, e.style.top]);
const bb = await m3.boundingBox();
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.mouse.down();
await page.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2 + 30, { steps: 8 });
await page.mouse.up();
await settle();
const after = await m3.evaluate((e) => [e.style.left, e.style.top, e.dataset.src]);
check(after[0] !== before[0] && after[1] !== before[1] && after[2] === "hand", `marker 3 dragged: ${before.join(",")} → ${after.slice(0, 2).join(",")}, now placed by hand`);

// a weld with no marker is put on the sheet where it is clicked
await page.getByRole("button", { name: "+ ردیف" }).click();
const last = page.locator(".wl-table tbody tr").last();
await last.locator("input").nth(1).fill("99");     // after the tick box: the weld number
await last.locator("td").first().click();
check(/جا ندارد/.test(await page.locator("[data-place-hint]").innerText()), "a weld with no marker: the sheet says to click where it is");
const sb = await page.locator("[data-wl-sheet] .sheet-box").boundingBox();
await page.mouse.click(sb.x + sb.width * 0.62, sb.y + sb.height * 0.12);    // a clear part of the sheet
await settle();
check(await page.locator('[data-mark="99"][data-src="hand"]').count() === 1, "weld 99 put on the sheet by hand");
await last.getByRole("button", { name: /حذف ردیف/ }).click();
await settle();
check(await page.locator('[data-mark="99"]').count() === 0, "its row deleted: its marker goes with it");

// complete what the drawing did not say, from the golden register
const rows = page.locator(".wl-table tbody tr");
for (let i = 0; i < await rows.count(); i++) {
  const r = rows.nth(i);
  const no = await r.getAttribute("data-wl-row");
  const g = GOLD.find((x) => x.no === no);
  if (!g) continue;
  const inputs = r.locator('input:not([type="checkbox"])');
  if (!(await inputs.nth(3).inputValue())) await inputs.nth(3).fill(g.kind);
  // weld 20's size is disputed in the golden case (register 3/4", the leader ends on the 1 1/2" header): the drive enters what the drawing shows
  if (!(await inputs.nth(4).inputValue())) await inputs.nth(4).fill(String(g.nps ?? 1.5));
}
// a drawing number of this run's own: the joints of an earlier run would carry their site records over
await page.fill("#wl-drawingNo", `25-1014-DRV-${Date.now().toString(36)}`);
if (!(await page.locator("#wl-rev").inputValue())) await page.fill("#wl-rev", "0");

// tick all but two, and try to save
for (const g of GOLD.slice(0, -2)) await page.locator(`[data-wl-check="${g.no}"]`).check();
check((await page.locator("[data-wl-review-count]").innerText()).startsWith(`${GOLD.length - 2} از ${GOLD.length}`), "the count of rows checked against the drawing");
check(await page.locator('[data-mark][data-state="checked"]').count() === GOLD.length - 2, "checked rows' markers turn to «checked»");
const saveBtn = page.locator(".weldlist").getByRole("button", { name: "ذخیره در سامانه" }).first();
const stuck = (await page.locator(".weldlist .err[role=alert]").allInnerTexts()).map((x) => x.replace(/\s+/g, " "));
check(stuck.length === 0, `the list is a register row by row${stuck.length ? `: ${stuck.join(" ").slice(0, 300)}` : ""}`);
answer = false; asked.length = 0;
await saveBtn.click();
await settle();
check(/2 جوش هنوز با نقشه بررسی نشده/.test(asked[0] || ""), `saving with two unchecked asks first (${(asked[0] || "").slice(0, 60)})`);
check(await page.locator("[data-run-status]").count() === 0, "refused: nothing saved");
await page.getByRole("button", { name: "همه بررسی شد" }).click();
answer = true; asked.length = 0;
await saveBtn.click();
await page.locator("[data-run-status]").waitFor({ timeout: 60000 });
check(asked.length === 0, "all checked: saved without asking");

// ── reopened: the sheet comes back from the server, coloured by site progress ──
await page.locator('[data-wl-sheet] [data-mark]').first().waitFor({ timeout: 60000 });
check(await page.locator('[data-mark][data-state="open"]').count() === GOLD.length, "the saved sheet comes back; every joint open on site");
const kept = await page.locator('[data-mark="3"]').evaluate((e) => [e.style.left, e.style.top, e.dataset.src]);
check(kept[0] === after[0] && kept[1] === after[1] && kept[2] === "hand", "marker 3 where it was left");
const docNo = await page.locator("#wl-drawingNo").inputValue();
const runs = await api(`/api/review-queue?projectId=${projectId}`);
const run = runs.queue.find((r) => r.docNo === docNo);
const runDetail = run ? await api(`/api/runs/${run.runId}?projectId=${projectId}`) : null;
check(runDetail?.run?.hasFile === true, "the sheet's file was stored with the register");
if (runDetail) {
  const uid = (no) => runDetail.register.find((w) => String(w.weld_no) === no)?.weld_uid;
  const welder = (await api(`/api/welders?projectId=${projectId}`)).welders?.find((w) => Number(w.live_qualifications) > 0)
    || await (async () => {
      const w = (await api("/api/welders", { projectId, stampNo: "DRV-1", name: "Drive welder" })).welder;
      const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
      await api(`/api/welders/${w.id}/qualifications`, { projectId, process: "GTAW", positions: ["6G"], certificateNo: "DRV-Q1", qualifiedOn: day(-30), expiresOn: day(300) });
      return w;
    })();
  const today = new Date().toISOString().slice(0, 10);
  let siteOk = true;
  try {
    for (const no of ["1", "2"]) await api(`/api/welds/${encodeURIComponent(uid(no))}/assign`, { projectId, welderId: welder.id, weldedAt: today });
    await api(`/api/welds/${encodeURIComponent(uid("1"))}/ndt`, { projectId, method: "RT", result: "accept", reportNo: "RT-DRIVE-1", inspectedAt: today });
  } catch (e) { siteOk = false; check(false, `recording site progress: ${e.message}`); }
  if (siteOk) {
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /نقشه دوبعدی/ }).first().click({ timeout: 1500 }).catch(() => {}); // the 2D/3D choice is hidden while SHEET_MARKUP is on (app/piping/page.jsx)
    await page.locator(".queuebox tr", { hasText: docNo }).first().getByRole("button", { name: "باز کردن" }).click();
    await page.locator('[data-wl-sheet] [data-mark="1"]').waitFor({ timeout: 60000 });
    const st = async (no) => page.locator(`[data-mark="${no}"]`).getAttribute("data-state");
    check(await st("1") === "done" && await st("2") === "inspection" && await st("3") === "open",
      `site progress on the sheet: 1 ${await st("1")}, 2 ${await st("2")}, 3 ${await st("3")}`);
    await page.screenshot({ path: `${SHOT}/451-sheet-progress.png` });
  }
} else check(false, `the saved run ${docNo} in the review queue`);

console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
process.exit(failed || problems.length ? 1 : 0);
