/**
 * The isometric shown as the SHEET with its welds, spools and supports marked
 * on it: no 2D/3D to build; a circle on a shop weld, a square on a site weld,
 * an oval on a spool number, a hexagon on a support number; the model's
 * marks are suggestions the person moves, renumbers, retypes, deletes and
 * adds to; welds the register has and the sheet lacks are placed from a
 * list; the marked sheet downloads as a PNG. The model and the project's
 * symbols (circle = shop, square = field) are stubbed in the browser.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-sheet-markup.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const problems = [];
const page = await (await b.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true })).newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));

const catalogue = { provider: "openai", configured: true, defaultModel: "m1", repairModel: "m1",
  providers: [{ id: "openai", label: "stub", configured: true }], models: [{ id: "m1", label: "one", provider: "openai" }] };
const nodes = [
  { id: "N1", type: "tie-in", ref: "A", E: 0, N: 0, EL: 10000 },
  { id: "N2", type: "elbow90", ref: "", E: 3000, N: 0, EL: 10000 },
  { id: "N3", type: "tie-in", ref: "B", E: 3000, N: 2000, EL: 10000 },
];
const edges = [{ from: "N1", to: "N2", nps: 12 }, { from: "N2", to: "N3", nps: 12 }];
const items = [
  { kind: "weld", no: "1", shape: "circle", x: 0.2, y: 0.3, tx: 0.24, ty: 0.36 },
  { kind: "weld", no: "2", shape: "square", x: 0.5, y: 0.3, tx: 0.46, ty: 0.38 },
  { kind: "weld", no: "3", shape: "diamond", x: 0.3, y: 0.6 },
  { kind: "spool", no: "SP-1", shape: "oval", x: 0.6, y: 0.5 },
  { kind: "support", no: "S-2", shape: "hexagon", x: 0.4, y: 0.7 },
  { kind: "weld", no: "9", shape: "circle" },
];
await page.route("**/api/models**", (r) => r.fulfill({ json: catalogue }));
await page.route("**/api/project?**", async (r) => {
  const res = await r.fetch(); const j = await res.json();
  j.project = { ...(j.project || {}), weld_symbol_shop: "circle", weld_symbol_field: "square" };
  await r.fulfill({ response: res, json: j });
});
await page.route("**/api/extract", async (r) => {
  const body = JSON.parse(r.request().postData() || "{}");
  const data = body.pass === "nodes" ? { nps: 12, nodes, edges, unreadable: [] }
    : body.pass === "meta" ? { meta: { nps: 12, schedule: "SCH 40", pupLength: 0, drawingNo: "25-1020", sheet: "4/4" },
        bom: [{ pt: 1, group: "PIPE", description: "PIPE 12 SCH 40", diam: 12, stockCode: "P1", qty: 10 }], cutLengths: [], notes: [], unreadable: [] }
    : body.pass === "sheetmarks" ? { items, unreadable: [] }
    : body.pass === "welds" ? { marks: [] } : {};
  await r.fulfill({ json: { data, model: "m1", ms: 5, pass: body.pass, usage: null } });
});

await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
check(await page.getByText("با کدام نما شروع کنیم؟").count() === 0 && await page.getByRole("button", { name: /مدل سه‌بعدی/ }).count() === 0,
  "intake: the 2D / 3D question is gone");
await page.getByRole("button", { name: "خواندن مدل‌ها" }).click();
await page.check('input[name="iso-reader"][value="model"]');
await page.setInputFiles(".drop input[type=file]", "/tmp/claude-0/sh4/in.pdf");
await page.waitForSelector("[data-sheet-markup]", { timeout: 90000 });
await page.waitForSelector("[data-sheet] img");
await page.waitForTimeout(800);

check(await page.locator(".canvas canvas").count() === 0 && await page.getByRole("button", { name: "سه‌بعدی" }).count() === 0
  && await page.getByRole("button", { name: "نقشه ۲بعدی" }).count() === 0, "result: no 3D canvas, no 2D/3D switch");
const img = await page.locator("[data-sheet] img").evaluate((i) => ({ w: i.naturalWidth, h: i.naturalHeight }));
check(img.w > 1000 && img.h > 1000, `the sheet itself is shown (${img.w}×${img.h})`);

const marks = () => page.locator("[data-mark-id]");
const shapes = async () => Object.fromEntries(await marks().evaluateAll((els) => els.map((e) => [e.dataset.no, e.dataset.shape])));
let s = await shapes();
check(Object.keys(s).length === 5 && !("9" in s), `the model's marks are drawn; one with no place is left out: ${JSON.stringify(s)}`);
check(s["1"] === "circle" && s["2"] === "square" && s["3"] === "circle-dashed" && s["SP-1"] === "oval" && s["S-2"] === "hexagon",
  "circle = shop weld, square = site weld, dashed circle = weld of unknown location, oval = spool, hexagon = support");
check(/سرجوش‌ها 3 · اسپول‌ها 1 · ساپورت‌ها 1/.test(await page.locator("[data-counts]").innerText()), "the counts line: 3 welds, 1 spool, 1 support");
await page.screenshot({ path: `${SHOT}/sheet-markup-1.png` });

// the model saw where the leaders of 1 and 2 end: each is joined to its weld point; 3 has none and gets none
check(await page.locator("[data-leader]").count() === 2, "a leader for each mark whose weld point the model saw (1 and 2), none for 3");
await page.locator('[data-mark-id][data-no="3"]').click();
await page.locator("[data-set-point]").click();
const box0 = await page.locator("[data-sheet]").boundingBox();
await page.mouse.click(box0.x + box0.width * 0.34, box0.y + box0.height * 0.55);
await page.waitForTimeout(200);
check(await page.locator("[data-leader]").count() === 3, "mark 3 joined to a weld point put by a click on the sheet");
await page.locator('[data-mark-id][data-no="3"]').click();
await page.locator("[data-clear-point]").click();
check(await page.locator("[data-leader]").count() === 2, "its line taken away again");

// move: drag mark 1 by 120 px right, 60 px down from its centre
const m1 = page.locator('[data-no="1"]');
const before = await m1.boundingBox();
await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
const cx = before.x + before.width / 2, cy = before.y + before.height / 2;
await page.mouse.down(); await page.mouse.move(cx + 60, cy + 30, { steps: 4 }); await page.mouse.move(cx + 120, cy + 60, { steps: 4 }); await page.mouse.up();
await page.waitForTimeout(300);
const after = await m1.boundingBox();
check(Math.abs(after.x - before.x - 120) < 6 && Math.abs(after.y - before.y - 60) < 6, `drag moves the mark (${Math.round(after.x - before.x)}, ${Math.round(after.y - before.y)} px)`);

// edit number and kind
await m1.click();
await page.locator("[data-edit-no]").fill("99");
await page.locator("[data-edit-kind]").selectOption("weld-field");
await page.waitForTimeout(200);
s = await shapes();
check(s["99"] === "square" && !("1" in s), "renumbered to 99 and retyped to a site weld: now a square");

// delete
await page.locator("[data-delete]").click();
check((await marks().count()) === 4, "deleted: 4 left");

// add a support by the tool
await page.locator('[data-tool="support"]').click();
const box = await page.locator("[data-sheet]").boundingBox();
await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.25);
await page.waitForTimeout(200);
s = await shapes();
check((await marks().count()) === 5 && (await marks().evaluateAll((els) => els.filter((e) => e.dataset.kind === "support" && e.dataset.src === "hand").length)) === 1,
  "a support added where the sheet was clicked (by hand), 5 marks");

// duplicate number is named
await page.locator("[data-edit-no]").fill("S-2");
check(await page.locator("[data-problem]").count() === 1, "the same support number twice is named");
await page.locator("[data-edit-no]").fill("S-3");
check(await page.locator("[data-problem]").count() === 0, "…and the warning goes when fixed");

// the register's welds the sheet lacks
const todo = await page.locator("[data-unplaced-item]").evaluateAll((els) => els.map((e) => e.dataset.unplacedItem));
await page.locator("[data-unplaced] summary").click();
check(todo.length >= 2, `welds the register has and the sheet lacks are offered: ${todo.join(", ")}`);
const first = todo[0];
await page.locator(`[data-unplaced-item="${first}"]`).click();
await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.85);
await page.waitForTimeout(200);
const placed = await page.locator(`[data-mark-id][data-no="${first}"]`).evaluate((e) => e.dataset.kind);
check(placed === "weld-shop" || placed === "weld-field", `placed from the list with the engine's location (${placed})`);
check(!(await page.locator(`[data-unplaced-item="${first}"]`).count()), "…and no longer offered");

// download the marked sheet
const dl = page.waitForEvent("download");
await page.locator("[data-download]").click();
const d = await dl;
check(/\.png$/.test(d.suggestedFilename()), `download: ${d.suggestedFilename()}`);
const path = await d.path();
const fs = await import("node:fs");
check(fs.statSync(path).size > 50000, `the PNG is a full sheet (${fs.statSync(path).size} bytes)`);
fs.copyFileSync(path, `${SHOT}/sheet-marked.png`);

// kept with the payload
await page.locator("nav.tabnav button", { hasText: "JSON" }).click();
const json = await page.locator(".pane textarea").inputValue();
check(/"sheetMarkup"/.test(json) && /"weld-field"/.test(json) && /"S-3"/.test(json), "the marks are in the payload the register is saved with");
await page.screenshot({ path: `${SHOT}/sheet-markup-2.png` });

console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
process.exit(failed || problems.length ? 1 : 0);
