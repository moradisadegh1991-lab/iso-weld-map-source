/**
 * Browser evidence for Phase 11 (docs/audit/phase-11-pid-intelligence.md): the P&ID workspace in the real app.
 *   DRIVE_URL=… DRIVE_EMAIL=… DRIVE_PASSWORD=… DRIVE_SHOTS=… node tools/drive-pid.mjs
 * A SYNTHETIC sheet (a PDF drawn here, labelled as such — no real K110 P&ID is available in this environment) is uploaded as a P&ID document, read from
 * OCR-style strings and a vision-style proposal, then IN THE UI: items shown on the drawing, row ↔ drawing selection sync, a correction, a rejection
 * with reason, an approval, sign-off refused while records are undecided, the Validation tab, light / dark / phone.
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const { chromium } = createRequire(import.meta.url)("playwright");
const url = process.env.DRIVE_URL || "http://localhost:3100", shots = process.env.DRIVE_SHOTS || tmpdir();
const { DRIVE_EMAIL: email, DRIVE_PASSWORD: password } = process.env;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [], out = { checks: {} };
page.on("pageerror", (e) => errs.push(e.message)); page.on("dialog", (d) => d.accept());
const ok = (k, v) => { out.checks[k] = Boolean(v); };
const shot = (n) => page.screenshot({ path: `${shots}/${n}.png` });
const api = (path, body) => page.evaluate(async ([path, body]) => {
  const r = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
await page.goto(url, { waitUntil: "networkidle" });
await page.fill("#email", email); await page.fill("#password", password); await page.click("button[type=submit]"); await page.waitForSelector(".shell");

// the synthetic sheet (1000×800 CSS px), every label where the readers will say it is
const B = (x, y, w = 80, h = 20) => [x, y, x + w, y + h];
const LABELS = [["30-P-1201A", B(100, 100)], ["30-V-1101", B(420, 100)], ["30-E-1129", B(700, 100)], ["MP140001A-EA01-H", B(100, 300, 120)], ["MP140002A-EA01-H", B(420, 400, 120)], ["PIC 1101", B(300, 180, 60)], ["PIC 1101", B(300, 240, 60)], ["K110-30-PID-0021-10-15/1", B(780, 300, 150)]];
const html = `<html><body style="margin:0;width:1000px;height:800px;position:relative;font:14px monospace;background:#fff">
<div style="position:absolute;left:10px;top:770px;font-size:11px">SYNTHETIC SAMPLE SHEET — drawn for the Phase 11 drive, not a K110 drawing</div>
${LABELS.map(([t, bb]) => `<div style="position:absolute;left:${bb[0]}px;top:${bb[1]}px;border:1px solid #000;padding:1px 3px">${t}</div>`).join("")}
<div style="position:absolute;left:180px;top:112px;width:240px;height:2px;background:#000"></div>
<div style="position:absolute;left:500px;top:112px;width:200px;height:2px;background:#000"></div></body></html>`;
const pg2 = await ctx.newPage(); await pg2.setViewportSize({ width: 1000, height: 800 }); await pg2.setContent(html);
const pdf = await pg2.pdf({ width: "1000px", height: "800px", printBackground: true }); await pg2.close();
writeFileSync(`${shots}/synthetic-pid.pdf`, pdf);

let projects = (await api("/api/projects")).body.projects;
const projectId = projects[0].id;
const up = await api("/api/documents", { projectId, docNo: `DRIVE-PID-${Date.now() % 100000}`, revision: "A", sheetNo: "1/1", docType: "pid", contentType: "application/pdf", fileBase64: pdf.toString("base64") });
ok("upload as pid document", up.status === 201 || up.status === 200);
const documentId = up.body.document?.id || up.body.id || up.body.documentId;
// Phase 11.1: a second P&ID drawing exists in the project but has NO draft read — the off-page connector toward it must be UNCONFIRMED, never resolved
const other = await api("/api/documents", { projectId, docNo: "K110-30-PID-0021-10-15", revision: "A", sheetNo: "1/1", docType: "pid", contentType: "application/pdf", fileBase64: pdf.toString("base64") });
ok("target drawing filed (no draft)", other.status === 201 || other.status === 200);
const ocr = { page: 1, w: 1000, h: 800, items: LABELS.map(([t, bb]) => ({ t, b: bb, c: 0.93 })) };
const r1 = await api("/api/pid", { projectId, documentId, ocr, reader: "drive-ocr" });
ok("ocr ingest", r1.status === 201);
const g0 = (await api(`/api/pid?projectId=${projectId}&documentId=${documentId}`)).body;
const pump = g0.draft.items.find((i) => i.tag === "30-P-1201A"), vessel = g0.draft.items.find((i) => i.tag === "30-V-1101");
ok("pump + vessel read", pump && vessel);

await page.goto(`${url}/pid`, { waitUntil: "networkidle" }); await page.waitForSelector("[data-pid-doc]");
await page.click(`[data-pid-doc="${documentId}"]`);
await page.waitForSelector("[data-pid-box]"); await page.waitForSelector("[data-pid-sheet] img", { timeout: 20000 }).catch(() => {});
ok("drawing image rendered", await page.locator("[data-pid-sheet] img").count() === 1);
ok("boxes drawn", await page.locator("[data-pid-box]").count() >= 5);
await shot("pid-01-overview-dark");

// selection sync: row → drawing and drawing → row
await page.click('button:has-text("تجهیزات")').catch(() => {}); await page.waitForTimeout(300);
await page.click(`[data-pid-row="${pump.uid}"]`);
ok("row selects box", await page.locator(`[data-pid-box="${pump.uid}"][aria-pressed="true"]`).count() === 1);
await page.click(`[data-pid-box="${vessel.uid}"]`);
ok("box selects row", await page.locator(`[data-pid-row="${vessel.uid}"][aria-selected="true"]`).count() === 1);
await page.click(`[data-pid-go="${vessel.uid}"]`); await page.waitForTimeout(300);
ok("go zooms", (await page.locator("[data-pid-zoom-level]").innerText()) !== "100%");
await shot("pid-02-equipment-selected");

// correction keeps the extracted value
await page.click(`[data-pid-edit="${pump.uid}"]`); await page.waitForSelector("[data-form-save]");
await page.fill('[data-input="tag"]', "30-P-1201B"); await page.click("[data-form-save]"); await page.waitForTimeout(500);
const g1 = (await api(`/api/pid?projectId=${projectId}&documentId=${documentId}`)).body;
const pumpNow = g1.draft.items.find((i) => i.uid === pump.uid);
ok("correction: status corrected + original kept", pumpNow.review.status === "corrected" && pumpNow.review.original?.tag === "30-P-1201A" && pumpNow.tag === "30-P-1201B");
await shot("pid-03-corrected");
// off-page: unconfirmed in the register, not counted as a connection
await page.click('button:has-text("اتصال‌ها")'); await page.waitForTimeout(400);
const offRow = page.locator('[data-offpage-status]');
ok("off-page row listed as unconfirmed (target drawing exists, no draft)", await offRow.count() === 1 && (await offRow.first().getAttribute("data-offpage-status")) === "unconfirmed");
const gOff = (await api(`/api/pid?projectId=${projectId}&documentId=${documentId}`)).body;
ok("register off-page status = unconfirmed and it is not in the stated connectivity", gOff.registers.offpage[0]?.status === "unconfirmed" && gOff.registers.connectivity.length === 0);
ok("validation raises the off-page finding", gOff.validation.findings.some((f) => f.code === "P_OFFPAGE_UNRESOLVED"));
await shot("pid-09-offpage-unconfirmed");

// sign-off refused while undecided
await page.click('button:has-text("نمای کلی")'); await page.waitForTimeout(300);
const signBtn = page.locator("[data-pid-sign]");
ok("sign disabled while undecided", await signBtn.count() === 1 && await signBtn.isDisabled());
const early = await api("/api/pid/review", { projectId, runId: g1.run.id, action: "approve_draft" });
ok("server refuses sign-off while undecided", early.status >= 400);

// approve everything undecided through the API's per-item action (a person's decision per record), reject one with a reason
const items = g1.draft.items;
let baseHash = g1.run.payloadHash;
for (const it of items) {
  const st = it.review.status; if (st === "approved" || st === "rejected") continue;
  const isNoise = it.tag === "MP140002A";
  const r = await api("/api/pid/review", { projectId, runId: g1.run.id, uid: it.uid, action: isNoise ? "reject" : "approve", reason: isNoise ? "line label belongs to a neighbouring drawing" : undefined, baseHash });
  if (r.status >= 400) { out.last = r.body; }
  baseHash = (await api(`/api/pid?projectId=${projectId}&documentId=${documentId}`)).body.run.payloadHash;
}
await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("[data-pid-doc]"); await page.click(`[data-pid-doc="${documentId}"]`); await page.waitForSelector("[data-pid-box]");
await page.click('button:has-text("نمای کلی")').catch(() => {}); await page.waitForTimeout(300);
ok("sign enabled once all decided", await page.locator("[data-pid-sign]").count() === 1 && await page.locator("[data-pid-sign]").isEnabled());
const g2 = (await api(`/api/pid?projectId=${projectId}&documentId=${documentId}`)).body;
ok("rejected item recorded with reason", g2.draft.items.some((i) => i.review.status === "rejected" && i.review.reason));
await page.click('button:has-text("اعتبارسنجی")').catch(() => {}); await page.waitForTimeout(400);
await shot("pid-04-validation");
await page.click('button:has-text("نمای کلی")').catch(() => {});
await page.click("[data-pid-sign]"); await page.waitForTimeout(800);
const g3 = (await api(`/api/pid?projectId=${projectId}&documentId=${documentId}`)).body;
ok("signed off: approved with who/when", g3.run.status === "approved" && g3.run.approvedAt);
ok("locked after sign-off: edit button gone", await page.locator("[data-pid-edit]").count() === 0);
const late = await api("/api/pid/review", { projectId, runId: g3.run.id, uid: pump.uid, action: "reopen", baseHash: g3.run.payloadHash });
ok("server refuses edits after sign-off", late.status >= 400);
await shot("pid-05-approved-dark");
const theme = async (want) => { for (let i = 0; i < 2; i++) { if ((await page.evaluate(() => document.documentElement.getAttribute("data-theme") || "dark")) === want) return; await page.locator("button[aria-label*='theme' i], .topbar button:has-text('☀'), .topbar button:has-text('☾')").first().click(); await page.waitForTimeout(500); } };
await theme("light"); await shot("pid-06-light");
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600); await shot("pid-07-phone-light");
ok("phone: no horizontal page scroll", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
await theme("dark"); await shot("pid-08-phone-dark");
await b.close();
console.log(JSON.stringify({ ...out, pageErrors: errs, last: out.last }, null, 1));
