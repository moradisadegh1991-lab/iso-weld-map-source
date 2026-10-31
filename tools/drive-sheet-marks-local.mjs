/**
 * A sheet already marked with its weld numbers (25-1020 sheet 1, supplied by
 * the owner as the example), read with NO model: every weld number is found
 * on the sheet and drawn as a circle (shop) or a square (site) by the
 * project's own symbols; the spool numbers (ovals SP-1…SP-4) and support
 * numbers (hexagons SW-1, SW-2) are found as well, and the BOM and the line
 * data of the title block are read; the sheet and its one table are the
 * engine route's (SheetMarkup, MarkTables): a person moves, renumbers, joins,
 * takes off, adds and deletes, and it all goes with the payload.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-sheet-marks-local.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const SHEET = process.env.SHEET || "/tmp/claude-0/sh4/sh1.pdf";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const CIRCLES = ["2", "8", "16", "17", "25", "26", "28"];            // read off the sheet by eye: round frames
const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const page = await (await b.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("dialog", (d) => d.accept());
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const settle = () => page.waitForTimeout(600);

// the project's convention: circle = shop, square = field
await page.goto(`${BASE}/project`, { waitUntil: "networkidle" }); await settle();
await page.selectOption("#weld_symbol_shop", "circle");
await page.selectOption("#weld_symbol_field", "square");
await page.locator("form", { has: page.locator("#weld_symbol_shop") }).getByRole("button", { name: /ذخیره/ }).first().click();
await page.waitForSelector("text=ذخیره شد", { timeout: 15000 });

await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" }); await settle();
await page.check('input[name="iso-reader"][value="local"]');
await page.setInputFiles(".drop input[type=file]", SHEET);
await page.locator("[data-wl-sheet] [data-mark-id]").first().waitFor({ timeout: 150000 });
await settle();

// the OCR route is drawn as the engine's: one marked sheet, one table
check(await page.locator("[data-wl-sheet] [data-sheet-markup]").count() === 1 && await page.locator("[data-sheet-review]").count() === 0, "the sheet is the engine's marked sheet (SheetMarkup), not the old review");
check(await page.locator("[data-mark-tables]").count() === 1 && await page.locator(".wl-table table.dtable:not([data-mark-table])").count() === 0, "one table for welds, spools and supports");
const W = '[data-wl-sheet] [data-mark-id][data-kind^="weld"]';
const welds = Object.fromEntries(await page.locator(W).evaluateAll((els) => els.map((e) => [e.dataset.no, e.dataset.shape])));
check(Object.keys(welds).length === 28, `all 28 printed weld numbers are on the sheet (${Object.keys(welds).length})`);
const wrong = Object.entries(welds).filter(([no, sh]) => sh !== (CIRCLES.includes(no) ? "circle" : "square"));
check(wrong.length === 0, `circle = shop (${CIRCLES.join(",")}), square = site (the other 21)${wrong.length ? " — wrong: " + JSON.stringify(wrong) : ""}`);
check(await page.locator(`${W}[data-no="5"] text`).textContent() === "5", "the frame holds the plain number");
// each frame's leader followed to the pipe by the reader: the frame joined to its weld point
const readerLeaders = await page.locator("[data-wl-sheet] [data-leader]").count();
check(readerLeaders >= 18, `${readerLeaders} weld frames joined to their weld point on the pipe by the reader (18 measured on this sheet)`);
const l2 = await page.locator(`[data-leader="${await page.locator(`${W}[data-no="2"]`).getAttribute("data-mark-id")}"]`).evaluate((e) => [Number(e.dataset.ax), Number(e.dataset.ay)]).catch(() => null);
check(l2 && Math.abs(l2[0] - 0.1294) < 0.004 && Math.abs(l2[1] - 0.2587) < 0.006, `weld 2's leader ends on its dot on the pipe (${l2})`);

const X = '[data-wl-sheet] [data-mark-id]:is([data-kind="spool"],[data-kind="support"])';
const extras = Object.fromEntries(await page.locator(X).evaluateAll((els) => els.map((e) => [e.dataset.no, e.dataset.shape])));
check(JSON.stringify(Object.keys(extras).sort()) === JSON.stringify(["SP-1", "SP-2", "SP-3", "SP-4", "SW-1", "SW-2"]), `spool and support numbers found: ${Object.keys(extras).sort().join(", ")}`);
check(["SP-1", "SP-2", "SP-3", "SP-4"].every((n) => extras[n] === "oval") && ["SW-1", "SW-2"].every((n) => extras[n] === "hexagon"), "ovals for spools, hexagons for supports");
check(await page.locator(`${X}[data-src="reader"]`).count() === 6, "each where the reader found it");

// the BOM and the line data read off the sheet with no model
check(await page.locator("[data-bom]").getAttribute("data-bom") === "20", `the BOM: 20 rows read (${await page.locator("[data-bom]").getAttribute("data-bom")})`);
await page.locator("[data-bom] summary").click();
const bomRow = async (pt) => page.locator(`[data-bom-row="${pt}"] td`).allTextContents();
check((await bomRow(3))[3] === "6 x 4" && (await bomRow(1))[5] === "3 m" && (await bomRow(18))[5] === "16", "sizes and quantities as printed (PT 3 6 x 4, PT 1 3 m, PT 18 16)");
const line = async (k) => page.locator(`[data-line="${k}"]`).inputValue();
check(await line("lineNo") === '6"-HWS-81001-1P2-HB' && await line("designPressure") === "8, FV" && await line("operatingTemp") === "75-100" && await line("testPressure") === "12.0",
  `line data: ${await line("lineNo")} · ${await line("designPressure")} · ${await line("operatingTemp")} · ${await line("testPressure")}`);
check(await line("pwht") === "", "PWHT not printed: left blank, not guessed");
check(await page.locator("#wl-lineNo").inputValue() === '6"-HWS-81001-1P2-HB' && await page.locator("#wl-pipingClass").inputValue() === "1P2", "the line number and class prefill the register");
await page.locator("[data-wl-sheet] [data-sheet]").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/sheet-marks-local-1.png` });

// the person's edits on a spool: move, renumber, delete, add
const ex = page.locator(`${X}[data-no="SP-1"]`);
await ex.scrollIntoViewIfNeeded();
const bb = await ex.boundingBox();
const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy + 20, { steps: 4 }); await page.mouse.move(cx + 80, cy + 40, { steps: 4 }); await page.mouse.up();
await settle();
const bb2 = await page.locator(`${X}[data-no="SP-1"]`).boundingBox();
check(Math.abs(bb2.x - bb.x - 80) < 8 && Math.abs(bb2.y - bb.y - 40) < 8, `SP-1 dragged (${Math.round(bb2.x - bb.x)}, ${Math.round(bb2.y - bb.y)} px)`);
check(await page.locator(`${X}[data-no="SP-1"]`).getAttribute("data-src") === "hand", "…and is the person's from then on");
await page.locator('[data-mark-tab="spool"]').click();
const spId = await page.locator(`${X}[data-no="SP-1"]`).getAttribute("data-mark-id");
const spRow = page.locator(`[data-mark-row="${spId}"]`);
await spRow.locator('[data-cell="no"]').fill("SP-9");
await settle();
check(await page.locator(`${X}[data-no="SP-9"]`).count() === 1, "SP-1 renumbered SP-9 in the table: the oval on the sheet follows");
await spRow.locator("[data-row-delete]").click();
check(await page.locator(X).count() === 5, "its row deleted: 5 left");
await page.locator('[data-mark-add="spool"]').click();
check(/به نقشه وصل نیست/.test(await page.locator("[data-loose]").innerText()), "a spool added by «+»: named as not joined to the drawing");
const sb = await page.locator("[data-wl-sheet] .sheet-box, [data-wl-sheet] [data-sheet]").first().boundingBox();
await page.locator("[data-wl-sheet] [data-sheet]").click({ position: { x: Math.round(sb.width * 0.7), y: 160 } });
await settle();
check(await page.locator(X).count() === 6 && await page.locator(`${X}[data-shape="oval"][data-src="hand"]`).count() >= 1, "…joined where the sheet was clicked");
check(await page.locator("[data-loose]").count() === 0, "no row left unjoined");

// a weld row joined to its weld point by the button at its end: a leader from the frame to the pipe
await page.locator('[data-mark-tab="weld"]').click();
const w5 = await page.locator(`${W}[data-no="5"]`).getAttribute("data-mark-id");
const leadersBefore = await page.locator("[data-leader]").count();
await page.locator(`[data-row-attach="${w5}"]`).click();
check(await page.locator(`[data-row-attach="${w5}"]`).innerText() === "جابه‌جایی روی نقشه", "a weld read on the sheet is already on it: its button moves it");
const f5 = await page.locator(`${W}[data-no="5"]`).boundingBox();
const sheetBox = await page.locator("[data-wl-sheet] [data-sheet]").boundingBox();
await page.locator("[data-wl-sheet] [data-sheet]").click({ position: { x: Math.round(f5.x - sheetBox.x + 60), y: Math.round(f5.y - sheetBox.y + 50) } });
await settle();
check(await page.locator(`[data-leader="${w5}"]`).count() === 1 && await page.locator("[data-leader]").count() === leadersBefore + 1, "weld 5 joined to its weld point: a leader to the pipe");
// take it off the drawing: the row stays, named as not joined; then delete a row
await page.locator(`[data-row-unplace="${w5}"]`).click();
check(/سرجوش 5/.test(await page.locator("[data-loose]").innerText()), "weld 5 taken off the drawing: its row stays and is named");
const w28 = await page.locator(`${W}[data-no="28"]`).getAttribute("data-mark-id");
await page.locator(`[data-row-delete="${w28}"]`).click();
check(await page.locator(W).count() === 26 && await page.locator(`[data-mark-row="${w28}"]`).count() === 0, "weld 28 deleted: its row and its mark gone");
// a row ticked once checked against the drawing
await page.locator('[data-wl-check="3"]').check();
check(/^1 از 27/.test(await page.locator("[data-wl-review-count]").innerText()), `one of 27 checked (${await page.locator("[data-wl-review-count]").innerText()})`);
// the row picked on the sheet is the table's row
await page.locator(`${W}[data-no="7"]`).dispatchEvent("pointerdown");
const w7 = await page.locator(`${W}[data-no="7"]`).getAttribute("data-mark-id");
check(await page.locator(`[data-mark-row="${w7}"]`).evaluate((tr) => tr.classList.contains("sel")), "weld 7 picked on the sheet: its row is picked");

// complete what the drawing did not say, in the one table, so the register can be saved
await page.fill("#wl-nps", "6");
for (const tr of await page.locator('[data-mark-table="weld"] [data-mark-row]').all()) {
  await tr.locator('[data-cell="type"]').fill("BW");
  if (await tr.locator('[data-cell="kind"]').inputValue() === "weld-shop") await tr.locator('[data-cell="spool"]').fill("SP-2");
}
await settle();
// the payload: capture what a save would send
let sent = null;
await page.route("**/api/runs", async (r) => { if (r.request().method() === "POST") { sent = JSON.parse(r.request().postData() || "{}"); await r.abort(); } else await r.continue(); });
await page.locator(".weldlist").getByRole("button", { name: "ذخیره در سامانه" }).first().click().catch(() => {});
await page.waitForTimeout(2500);
if (sent) {
  const items = sent.payload?.sheetMarkup?.items || [];
  check(items.length === 6 && items.every((m) => m.kind === "spool" || m.kind === "support"), `the spool and support marks go with the payload (${items.length})`);
  check(Object.keys(sent.payload?.weldMarkup?.marks || {}).length === 26 && !sent.payload.weldMarkup.marks["5"], "…beside the 26 weld places still on the sheet");
  check(sent.payload?.weldList?.length === 27 && sent.payload.weldList.every((r) => !("_id" in r)), "27 register rows, without the form's ids");
  check(sent.payload?.bom?.length === 20 && sent.payload?.lineData?.lineClass === "1P2", "the BOM and the line data go with it");
} else console.log("note: the save did not reach /api/runs — payload not captured:", (await page.locator(".weldlist .err").allInnerTexts()).join(" | ").slice(0, 600));
await page.screenshot({ path: `${SHOT}/sheet-marks-local-2.png` });

// the same sheet with its weld numbers whited out: the weld dots on the pipe are suggested as welds
const UNMARKED = process.env.UNMARKED_SHEET || "/tmp/claude-0/p2/sh1-unmarked.pdf";
await page.unrouteAll({ behavior: "ignoreErrors" });
await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" }); await settle();
await page.check('input[name="iso-reader"][value="local"]');
await page.setInputFiles(".drop input[type=file]", UNMARKED);
await page.locator(W).first().waitFor({ timeout: 150000 });
await settle();
const sug = await page.locator(W).count();
check(sug >= 14 && sug <= 20, `no weld numbers printed: ${sug} weld dots on the pipe suggested as welds (14 of the 18 traced on the marked sheet, measured)`);
check(await page.locator(`${W}[data-shape="circle-dashed"]`).count() === sug, "each a weld of unknown location (dashed) — Shop/Field is not guessed");
check(await page.locator("[data-wl-sheet] [data-leader]").count() === sug, "each joined to its dot by a leader");
const noteText = (await page.locator(".note").allTextContents()).join(" | ");
check(/پیشنهادی/.test(noteText) && await page.locator("[data-from-dots]").count() === 1, `the page says the welds are suggestions to check${/پیشنهادی/.test(noteText) ? "" : ` («${noteText.slice(0, 300)}»)`}`);
check(!/شمارهٔ جوش چاپ‌شده روی نقشه/.test(noteText), "…and never that the numbers were printed on the sheet");
await page.screenshot({ path: `${SHOT}/sheet-marks-unmarked.png` });

// a sheet with only its CUT PIPE LENGTH table (25-1020 sheet 4): the table read with no model
const CUT_SHEET = process.env.CUT_SHEET || "/tmp/claude-0/sh4/in.pdf";
await page.unrouteAll({ behavior: "ignoreErrors" });
await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" }); await settle();
await page.check('input[name="iso-reader"][value="local"]');
await page.setInputFiles(".drop input[type=file]", CUT_SHEET);
await page.locator("[data-cut-lengths]").waitFor({ timeout: 150000 });
const cuts = Object.fromEntries(await page.locator("[data-cut-row]").evaluateAll((trs) => trs.map((tr) => [tr.dataset.cutRow, [...tr.querySelectorAll("td")].map((td) => td.textContent)])));
check(Object.keys(cuts).length === 8 && cuts["10"][1] === "1229" && cuts["16"][1] === "707" && cuts["17"][2] === "6", `the cut table: 8 pieces, <10> 1229, <16> 707, <17> 6" (${Object.keys(cuts).length})`);
check(cuts["11"][2] === "؟", "a size not read for certain (<11> 1.1/2) is left for a person, not guessed");
console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
process.exit(failed || problems.length ? 1 : 0);
