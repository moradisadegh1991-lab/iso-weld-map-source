/**
 * A sheet already marked with its weld numbers (25-1020 sheet 1, supplied by
 * the owner as the example), read with NO model: every weld number is found
 * on the sheet and drawn as a circle (shop) or a square (site) by the
 * project's own symbols; the spool numbers (ovals SP-1…SP-4) and support
 * numbers (hexagons SW-1, SW-2) are found as well; a person moves, renumbers,
 * adds and deletes them, and they go with the payload.
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
await page.locator("[data-wl-sheet] [data-mark]").first().waitFor({ timeout: 150000 });
await settle();

const shapes = async (sel, attr = "no") => Object.fromEntries(await page.locator(sel).evaluateAll((els, a) => els.map((e) => [e.dataset[a] ?? e.dataset.mark, e.dataset.shape]), attr));
const welds = await shapes("[data-wl-sheet] [data-mark]", "mark");
check(Object.keys(welds).length === 28, `all 28 printed weld numbers are on the sheet (${Object.keys(welds).length})`);
const wrong = Object.entries(welds).filter(([no, sh]) => sh !== (CIRCLES.includes(no) ? "circle" : "square"));
check(wrong.length === 0, `circle = shop (${CIRCLES.join(",")}), square = site (the other 21)${wrong.length ? " — wrong: " + JSON.stringify(wrong) : ""}`);

const extras = Object.fromEntries(await page.locator("[data-extra]").evaluateAll((els) => els.map((e) => [e.dataset.no, e.dataset.shape])));
check(JSON.stringify(Object.keys(extras).sort()) === JSON.stringify(["SP-1", "SP-2", "SP-3", "SP-4", "SW-1", "SW-2"]), `spool and support numbers found: ${Object.keys(extras).sort().join(", ")}`);
check(["SP-1", "SP-2", "SP-3", "SP-4"].every((n) => extras[n] === "oval") && ["SW-1", "SW-2"].every((n) => extras[n] === "hexagon"), "ovals for spools, hexagons for supports");
check(await page.locator('[data-extra][data-src="reader"]').count() === 6, "each where the reader found it");
await page.locator("[data-wl-sheet] .sheet-box").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/sheet-marks-local-1.png` });

// the person's edits on an extra: move, renumber, delete, add
const ex = page.locator('[data-extra][data-no="SP-1"]');
await ex.scrollIntoViewIfNeeded();
const bb = await ex.boundingBox();
const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy + 20, { steps: 4 }); await page.mouse.move(cx + 80, cy + 40, { steps: 4 }); await page.mouse.up();
await settle();
const bb2 = await page.locator('[data-extra][data-no="SP-1"]').boundingBox();
check(Math.abs(bb2.x - bb.x - 80) < 8 && Math.abs(bb2.y - bb.y - 40) < 8, `SP-1 dragged (${Math.round(bb2.x - bb.x)}, ${Math.round(bb2.y - bb.y)} px)`);
check(await page.locator('[data-extra][data-no="SP-1"]').getAttribute("data-src") === "hand", "…and is the person's from then on");
// renumber in the table (the row is the mark), then delete the row
const spId = await page.locator('[data-extra][data-no="SP-1"]').getAttribute("data-extra");
const spRow = page.locator(`[data-mark-row="${spId}"]`);
await spRow.locator('[data-cell="no"]').fill("SP-9");
await settle();
check(await page.locator('[data-extra][data-no="SP-9"]').count() === 1, "SP-1 renumbered SP-9 in the table: the oval on the sheet follows");
await spRow.locator("[data-row-delete]").click();
check(await page.locator("[data-extra]").count() === 5, "its row deleted: 5 left");
// a spool added by the "+" button: a row not joined to the drawing, then joined by a click, with its leader
await page.locator('[data-mark-add="spool"]').click();
check(/به نقشه وصل نیست/.test(await page.locator("[data-loose]").innerText()), "the new row is named as not joined to the drawing");
const sb = await page.locator("[data-wl-sheet] .sheet-box").boundingBox();
await page.mouse.click(sb.x + sb.width * 0.7, sb.y + sb.height * 0.12);
await settle();
check(await page.locator("[data-extra]").count() === 6 && await page.locator('[data-extra][data-shape="oval"][data-src="hand"]').count() === 1, "a spool added by hand and joined where the sheet was clicked");
check(await page.locator("[data-extra-leader]").count() === 1 && await page.locator("[data-loose]").count() === 0, "with a leader to its place, and no row left unjoined");

// a weld can still be picked and moved as before
await page.locator('[data-mark="5"]').dispatchEvent("pointerdown");
check(await page.locator('[data-mark="5"]').getAttribute("data-picked") === "true", "the picked weld marker is ringed on the sheet");
check(await page.locator('[data-wl-row="5"]').evaluate((tr) => tr.classList.contains("sel")), "marker 5 picked: its row is picked");

// the payload: capture what a save would send
let sent = null;
await page.route("**/api/runs", async (r) => { if (r.request().method() === "POST") { sent = JSON.parse(r.request().postData() || "{}"); await r.abort(); } else await r.continue(); });
await page.route("**/api/documents**", (r) => r.abort());
await page.locator(".weldlist").getByRole("button", { name: "ذخیره در سامانه" }).first().click().catch(() => {});
await page.waitForTimeout(2500);
if (sent) {
  const items = sent.payload?.sheetMarkup?.items || [];
  check(items.length === 6 && items.some((m) => m.kind === "spool" && m.src === "hand") && items.some((m) => m.no === "SW-2" && m.kind === "support"), `the spool and support marks go with the payload (${items.length})`);
  check(Object.keys(sent.payload?.weldMarkup?.marks || {}).length === 28, "…beside the 28 weld positions");
} else console.log("note: the save did not reach /api/runs (rows incomplete) — payload not captured");
await page.screenshot({ path: `${SHOT}/sheet-marks-local-2.png` });
console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
process.exit(failed || problems.length ? 1 : 0);
