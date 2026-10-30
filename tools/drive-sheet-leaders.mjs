/**
 * The engine's welds marked on an UNMARKED-style reading of a sheet, as a
 * designer marks one: a hollow square (site) or circle (shop) with the weld
 * number, joined by a leader to the weld point on the drawn pipe. The model
 * is stubbed in the browser: its nodes carry where each was seen drawn
 * (px/py, read off 25-1022 sheet 1 by eye for this drive) and it reports no
 * printed weld numbers, so every mark comes from the engine's register.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... [SHEET=...] node tools/drive-sheet-leaders.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const SHEET = process.env.SHEET || "/tmp/claude-0/sh4/s22.pdf";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const problems = [];
const page = await (await b.newContext({ viewport: { width: 1700, height: 1150 }, acceptDownloads: true })).newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));

// the main 1" run of 25-1022 sheet 1: from CONT. ON 2 down to the low elbow, up, across and down to the nozzle
const nodes = [
  { id: "N1", type: "tie-in", ref: "CONT. ON 2", E: 0, N: 0, EL: 22539, px: 0.124, py: 0.257 },
  { id: "N2", type: "elbow90", ref: "", E: 5000, N: 0, EL: 22539, px: 0.487, py: 0.547 },
  { id: "N3", type: "elbow90", ref: "", E: 5000, N: 0, EL: 25000, px: 0.487, py: 0.249 },
  { id: "N4", type: "elbow90", ref: "", E: 5000, N: 3000, EL: 25000, px: 0.589, py: 0.168 },
  { id: "N5", type: "tie-in", ref: "10-P-4107B/N02", E: 5000, N: 3000, EL: 22810, px: 0.592, py: 0.356 },
];
const edges = [["N1", "N2"], ["N2", "N3"], ["N3", "N4"], ["N4", "N5"]].map(([from, to]) => ({ from, to, nps: 1 }));
const catalogue = { provider: "openai", configured: true, defaultModel: "m1", repairModel: "m1",
  providers: [{ id: "openai", label: "stub", configured: true }], models: [{ id: "m1", label: "one", provider: "openai" }] };
await page.route("**/api/models**", (r) => r.fulfill({ json: catalogue }));
await page.route("**/api/extract", async (r) => {
  const body = JSON.parse(r.request().postData() || "{}");
  const data = body.pass === "nodes" ? { nps: 1, nodes, edges, unreadable: [] }
    : body.pass === "meta" ? { meta: { nps: 1, schedule: "40S", pupLength: 0, drawingNo: "ISO-25-1022", sheet: "1/4" },
        bom: [{ pt: 1, group: "PIPE", description: "PIPE 40S BE SMLS A312-TP304", diam: 1, stockCode: "P74C0A", qty: 1.8 },
          { pt: 4, group: "FITTINGS", description: "ELBOW 90 LR 40S BW A403-WP304", diam: 1, stockCode: "EL90", qty: 3 }], cutLengths: [], notes: [], unreadable: [] }
    : body.pass === "sheetmarks" ? { items: [], unreadable: [] }
    : body.pass === "welds" ? { marks: [] } : {};
  await r.fulfill({ json: { data, model: "m1", ms: 5, pass: body.pass, usage: null } });
});
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
await page.getByRole("button", { name: "خواندن مدل‌ها" }).click();
await page.check('input[name="iso-reader"][value="model"]');
await page.setInputFiles(".drop input[type=file]", SHEET);
await page.waitForSelector("[data-sheet-markup] [data-mark-id]", { timeout: 90000 });
await page.waitForTimeout(800);

const marks = await page.locator("[data-mark-id]").evaluateAll((els) => els.map((e) => ({ id: e.dataset.markId, no: e.dataset.no, shape: e.dataset.shape, src: e.dataset.src })));
const register = await page.locator(".dtable tbody tr td:last-child, table tbody tr").count();
check(marks.length >= 4 && marks.every((m) => m.src === "engine"), `the engine's welds are on the sheet (${marks.length}: ${marks.map((m) => m.no).join(", ")})`);
check(marks.every((m) => m.shape === "square" || m.shape === "circle" || m.shape === "circle-dashed"), `each a square or a circle: ${[...new Set(marks.map((m) => m.shape))].join(", ")}`);
const leaders = await page.locator("[data-leader]").count();
check(leaders === marks.length, `a leader for every mark (${leaders})`);
// every leader's weld end lies on a drawn leg of the route
const segs = edges.map((e) => [nodes.find((n) => n.id === e.from), nodes.find((n) => n.id === e.to)]);
const ends = await page.locator("[data-leader]").evaluateAll((els) => els.map((l) => ({ x: +l.getAttribute("x1"), y: +l.getAttribute("y1"), fx: +l.getAttribute("x2"), fy: +l.getAttribute("y2") })));
const onLeg = (p) => segs.some(([a, b]) => {
  const dx = b.px - a.px, dy = b.py - a.py, L = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((p.x - a.px) * dx + (p.y - a.py) * dy) / L));
  return Math.hypot(p.x - (a.px + t * dx), p.y - (a.py + t * dy)) < 0.003;
});
check(ends.every(onLeg), "each leader starts on the drawn pipe");
check(ends.every((e) => Math.hypot(e.fx - e.x, e.fy - e.y) > 0.015), "and ends at a frame set off the pipe");
const ink = await page.locator("[data-mark-id] svg :is(rect,circle)").first().getAttribute("stroke");
check(ink === "#111" || ink === "#6b7280", `hollow frames in black ink (${ink})`);
await page.locator("[data-sheet] img").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/sheet-leaders-1.png` });

// move a weld point along: pick the first mark, drag its yellow weld point
const first = marks[0];
await page.locator(`[data-mark-id="${first.id}"]`).click();
const dot = page.locator(`[data-anchor-id="${first.id}"]`);
const bb = await dot.boundingBox();
const before = await page.locator(`[data-leader="${first.id}"]`).getAttribute("x1");
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down();
await page.mouse.move(bb.x + 30, bb.y + 20, { steps: 4 }); await page.mouse.move(bb.x + 60, bb.y + 30, { steps: 4 }); await page.mouse.up();
await page.waitForTimeout(300);
const after = await page.locator(`[data-leader="${first.id}"]`).getAttribute("x1");
check(Number(after) > Number(before), `the weld point is dragged and its leader follows (${before} → ${after})`);

// the frame dragged: the leader's other end follows
const fb = await page.locator(`[data-mark-id="${first.id}"]`).boundingBox();
const fx0 = await page.locator(`[data-leader="${first.id}"]`).getAttribute("x2");
await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2); await page.mouse.down();
await page.mouse.move(fb.x + fb.width / 2 - 40, fb.y + fb.height / 2 + 10, { steps: 4 }); await page.mouse.move(fb.x + fb.width / 2 - 80, fb.y + fb.height / 2 + 20, { steps: 4 }); await page.mouse.up();
await page.waitForTimeout(300);
check(Number(await page.locator(`[data-leader="${first.id}"]`).getAttribute("x2")) < Number(fx0), "the frame dragged, the leader still joins it");

// put the engine's marks back where they were suggested; a hand-placed one is kept
await page.locator("[data-seed-engine]").click();
await page.waitForTimeout(300);
check(await page.locator("[data-mark-id]").count() === marks.length, "re-placing the engine's welds keeps one mark per weld");

const dl = page.waitForEvent("download");
await page.locator("[data-download]").click();
const d = await dl;
const fs = await import("node:fs");
fs.copyFileSync(await d.path(), `${SHOT}/sheet-leaders.png`);
check(fs.statSync(`${SHOT}/sheet-leaders.png`).size > 50000, "the marked sheet downloads with its leaders");
console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
process.exit(failed || problems.length ? 1 : 0);
