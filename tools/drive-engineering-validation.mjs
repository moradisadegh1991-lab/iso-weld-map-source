/**
 * Browser evidence for Phase 7 (docs/audit/phase-7-engineering-validation.md): the Reconciliation Center in the real workspace.
 *   DRIVE_URL=… DRIVE_EMAIL=… DRIVE_PASSWORD=… DRIVE_SHOTS=… node tools/drive-engineering-validation.mjs [sheet.pdf]
 * Two saved typed runs (through the page's own authenticated session): A — a weld naming a BOM PT that does not exist, an unlinked sheet weld
 * mark, an equipment; B — an equipment that still names a weld the legacy way (a number that is on no weld), which left a stored warning.
 * Drives filters, search, sort, grouping, selection sync with the drawing, navigation to the weld form, correcting the PT, saving, refresh,
 * the warning's resolution only after the equipment is linked by uid, its history, the unlinked mark, light/dark and a phone viewport.
 */
import { openWorkspace, tab } from "./drive-lib.mjs";
import { readFileSync } from "node:fs";

const pdf = process.argv[2] || "/root/.claude/uploads/9965cb1b-55f5-5165-aadc-93103c66b847/250abb3f-25-1029-SH1-0.pdf";
const { page, b, errs, shot, url } = await openWorkspace({});
const out = { checks: {} };
process.on("uncaughtException", (e) => { console.log(JSON.stringify(out, null, 1)); console.log("ERROR", e.message.slice(0, 400)); process.exit(1); });
const ok = (k, v) => { out.checks[k] = Boolean(v); };
const api = (path, body) => page.evaluate(async ([path, body]) => {
  const r = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
const setTheme = async (want) => {
  for (let i = 0; i < 2; i++) {
    if ((await page.evaluate(() => document.documentElement.getAttribute("data-theme") || "dark")) === want) return;
    await page.locator("button[aria-label*='theme' i], .topbar button:has-text('☀'), .topbar button:has-text('☾')").first().click();
    await page.waitForTimeout(500);
  }
};
const b64 = readFileSync(pdf).toString("base64");
let projects = (await api("/api/projects")).body.projects;
if (!projects?.length) { await api("/api/projects", { code: "P7", name: "Phase 7 drive" }); projects = (await api("/api/projects")).body.projects; }
const projectId = projects[0].id;
const mkUid = () => page.evaluate(() => crypto.randomUUID());
const BOM = [{ pt: 2, group: "FLANGES", description: "FLANGE WELD NECK RF 300# A105 BW", diam: "4", qty: 4, qtyUnit: "pcs" }, { pt: 7, group: "MISC", description: "VALVE GATE 300# BW", diam: "4", qty: 1, qtyUnit: "pcs" }];
const row = (no, uid, extra = {}) => ({ no, spool: "SP-1", loc: "Shop", kind: "BW", nps: "4", uid, ...extra });
const seed = async (docNo, rows, items, byUid) => {
  const doc = (await api("/api/documents", { projectId, docNo, revision: "0", fileBase64: b64, contentType: "application/pdf" })).body.document;
  const r = await api("/api/runs", { projectId, documentId: doc.id, lineNo: `${docNo}-L1`, payload: { meta: { drawingNo: docNo, rev: "0", sheet: "1/1", lineNo: `${docNo}-L1`, nps: 4 }, bom: BOM, weldList: rows,
    weldMarkup: { page: 1, marks: {}, byUid }, sheetMarkup: { page: 1, items } } });
  return { doc, run: r };
};
const [a1, a2, orphan, eqA, b1, b2, eqB] = await Promise.all(Array.from({ length: 7 }, mkUid));
const A = await seed(`P7A-${Date.now()}`, [row("1", a1, { c1: "2", c2: "99" }), row("2", a2, { c1: "2" })],
  [{ id: "mo", uid: orphan, kind: "weld-shop", no: "77", x: 0.5, y: 0.35, src: "hand", attrs: { c1: "2" } },
   { id: "me", uid: eqA, kind: "equipment", no: "V-1", x: 0.62, y: 0.5, src: "hand", attrs: { type: "valve", c1: "7", status: "planned" } }],
  { [a1]: { x: 0.2, y: 0.55, src: "hand" }, [a2]: { x: 0.35, y: 0.55, src: "hand" } });
ok("A_saved", A.run.status === 201);
const B = await seed(`P7B-${Date.now()}`, [row("1", b1), row("2", b2)],
  [{ id: "me", uid: eqB, kind: "equipment", no: "V-9", x: 0.62, y: 0.5, src: "hand", attrs: { tag: "XV-9", type: "valve", c1: "7", status: "planned", welds: "9" } }],
  { [b1]: { x: 0.2, y: 0.55, src: "hand" }, [b2]: { x: 0.35, y: 0.55, src: "hand" } });
ok("B_saved", B.run.status === 201);
out.setup = { A: A.doc.id, B: B.doc.id };

const open = async (runId) => {
  await page.goto(`${url}/piping`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.locator(`tr[data-key="${runId}"] button:has-text("باز کردن")`).first().click();
  await page.waitForSelector("[data-sheet-markup]", { timeout: 60000 });
  await page.waitForTimeout(1500);
};
const latest = async (doc) => { const l = await api(`/api/runs?projectId=${projectId}&documentId=${doc.id}`); return (await api(`/api/runs/${l.body.run.id}?projectId=${projectId}`)).body; };
const finds = () => page.locator("[data-finding]").evaluateAll((e) => e.map((x) => [x.dataset.finding, x.dataset.severity, x.dataset.resolved]));
const codes = async () => (await finds()).map((f) => f[0]);
const card = (k) => page.locator(`[data-vc-card="${k}"] b`).innerText();

// ── A ───────────────────────────────────────────────────────────────────
await open(A.run.body.run.id);
await setTheme("dark");
await tab(page, "validation");
await page.waitForSelector("[data-vc-table]");
await page.waitForTimeout(800);
const c0 = await codes();
out.codesA0 = c0;
ok("summary_cards", (await card("total")) !== "" && Number(await card("errors")) >= 1);
ok("missing_pt_listed", c0.includes("W_PT_MISSING"));
ok("unlinked_mark_listed", c0.includes("W_UNLINKED"));
const un = page.locator('[data-finding="W_UNLINKED"]').first();
await un.click();
ok("detail_shows_uid", (await page.locator("[data-vc-uid]").innerText()).trim() === orphan);
await shot("p7-01-center-dark");
// filters / search / sort / group
await page.selectOption("[data-vc-category]", "weld"); await page.waitForTimeout(200);
ok("filter_category", (await finds()).every(([c]) => /^W_/.test(c)) && (await finds()).length >= 1);
await page.selectOption("[data-vc-category]", "all");
await page.selectOption("[data-vc-severity]", "error"); await page.waitForTimeout(200);
ok("filter_severity", (await finds()).every(([, s]) => s === "error"));
await page.selectOption("[data-vc-severity]", "all");
await page.fill("[data-vc-search]", "99"); await page.waitForTimeout(200);
ok("search_finds_pt", (await codes()).includes("W_PT_MISSING") && (await finds()).length < c0.length);
await page.fill("[data-vc-search]", "");
await page.selectOption("[data-vc-sort]", "category");
await page.selectOption("[data-vc-group]", "category"); await page.waitForTimeout(200);
ok("group_by_category", (await page.locator(".vc-group").count()) >= 2);
await page.selectOption("[data-vc-group]", "none");
// selection sync: finding → drawing, drawing → finding
const missing = page.locator('[data-finding="W_PT_MISSING"]').first();
await missing.click();
await page.waitForTimeout(400);
ok("finding_selects_weld_on_drawing", await page.locator(`[data-mark-id][aria-pressed="true"], [data-mark-id][aria-selected="true"], [data-mark-id].on, [data-mark-id].sel`).count() >= 1);
await shot("p7-02-selected-weld");
await page.locator('[data-vc-drawing]').click(); await page.waitForTimeout(300);
await page.locator(`[data-mark-id="${orphan}"]`).first().click(); await page.waitForTimeout(500);
await tab(page, "validation");
ok("unlinked_sheet_mark_not_a_row", (await page.locator('[data-mark-id]').evaluateAll((e) => e.map((x) => x.textContent.trim()))).includes("77"));
const rowsBefore = (await latest(A.doc)).payload.weldList.length;
// navigate to the weld form from the finding, correct the PT
await page.locator('[data-finding="W_PT_MISSING"]').first().click();
await page.locator('[data-vc-open="weld-form"]').click();
await page.waitForSelector("[data-input=c2]");
await page.selectOption("[data-input=c2]", "2");
await page.click("[data-form-save]"); await page.waitForTimeout(500);
await tab(page, "validation");
await page.waitForTimeout(500);
ok("draft_updates_before_save", !(await codes()).includes("W_PT_MISSING"));
await page.click('[data-vc-source="saved"]'); await page.waitForTimeout(300);
ok("saved_still_shows_it_until_saved", (await codes()).includes("W_PT_MISSING"));
await shot("p7-03-saved-view-before-save");
await page.click('[data-vc-source="draft"]');
// save, reopen, refresh
let saveAns = null;
page.on("response", async (r) => { if (r.url().endsWith("/api/runs") && r.request().method() === "POST") saveAns = { status: r.status() }; });
await tab(page, "save");
await page.click("button:has-text('ذخیره در سامانه')");
await page.waitForTimeout(4500);
out.saveStatus = saveAns?.status;
const runA2 = (await latest(A.doc)).run.id;
await open(runA2);
await tab(page, "validation");
await page.waitForSelector("[data-vc-table]");
await page.click("[data-vc-refresh]"); await page.waitForTimeout(1200);
await page.click('[data-vc-source="saved"]'); await page.waitForTimeout(400);
ok("after_save_refresh_missing_pt_gone", !(await codes()).includes("W_PT_MISSING"));
ok("after_save_unlinked_mark_kept", (await codes()).includes("W_UNLINKED"));
const stored = (await latest(A.doc)).payload;
ok("orphan_mark_persisted_unchanged", (stored.sheetMarkup.items || []).some((m) => m.uid === orphan && m.kind === "weld-shop"));
ok("no_row_created_from_orphan", stored.weldList.length === rowsBefore);
await shot("p7-04-after-save-saved-view");

// ── light theme and a phone ──────────────────────────────────────────────
await setTheme("light"); await tab(page, "validation"); await page.waitForTimeout(500);
await shot("p7-05-center-light");
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
await page.locator("[data-validation]").scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
ok("mobile_no_horizontal_page_scroll", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
await shot("p7-06-center-mobile");
await page.setViewportSize({ width: 1920, height: 1000 }); await setTheme("dark");

// ── B: the stored warning ────────────────────────────────────────────────
await open(B.run.body.run.id);
await tab(page, "validation");
await page.waitForSelector("[data-vc-table]");
await page.click('[data-vc-source="saved"]'); await page.waitForTimeout(500);
const warnRow = page.locator('[data-finding="E_LEGACY_WARNING"]').first();
ok("stored_warning_listed", await warnRow.count() === 1);
await warnRow.click();
await page.fill("[data-vc-note]", "پیوند در فرم تجهیز بررسی شد");
await page.click("[data-vc-resolve-btn]"); await page.waitForTimeout(800);
ok("resolve_refused_before_relationship", /سرجوش|پیوند|هنوز/.test(await page.locator("[data-vc-msg]").innerText()));
await shot("p7-07-resolve-refused");
// link the equipment to weld 1 by uid in its form (the legacy number is cleared there), then save
await page.locator('[data-finding="E_WELD_UNKNOWN_NO"]').first().click().catch(() => {});
await page.click('[data-vc-source="draft"]'); await page.waitForTimeout(300);
const eqF = page.locator('[data-finding^="E_WELD"], [data-finding="E_NO_ACC"]').first();
await eqF.click();
await page.locator("[data-vc-open='equipment-form']").click();
await page.waitForSelector("[data-weld-pick]");
await page.locator(`[data-weld-pick="${b1}"]`).check();
await page.click("[data-form-save]"); await page.waitForTimeout(500);
await tab(page, "save");
await page.click("button:has-text('ذخیره در سامانه')");
await page.waitForTimeout(4500);
const runB2 = (await latest(B.doc)).run.id;
await open(runB2);
await tab(page, "validation");
await page.waitForSelector("[data-vc-table]");
await page.click('[data-vc-source="saved"]'); await page.waitForTimeout(600);
const w2 = page.locator('[data-finding="E_LEGACY_WARNING"][data-resolved="0"]').first();
ok("warning_still_open_after_link_save", await w2.count() === 1);
await w2.click();
await page.fill("[data-vc-note]", "پیوند در فرم تجهیز بررسی شد");
await page.click("[data-vc-resolve-btn]"); await page.waitForTimeout(1200);
out.resolveMsg = await page.locator("[data-vc-msg]").innerText().catch(() => null);
await page.selectOption("[data-vc-status]", "resolved"); await page.waitForTimeout(400);
ok("warning_resolved_and_history_remains", (await page.locator('[data-finding="E_LEGACY_WARNING"][data-resolved="1"]').count()) === 1);
await page.locator('[data-finding="E_LEGACY_WARNING"][data-resolved="1"]').click();
ok("resolution_note_shown", /بررسی شد/.test(await page.locator("[data-vc-resolution]").innerText()));
await shot("p7-08-warning-resolved-history");
const links = (await api(`/api/iso-equipment?projectId=${projectId}&documentId=${B.doc.id}`)).body.equipment[0].welds.map((w) => w.ref);
ok("link_is_the_uid_chosen_by_the_person", links.length === 1 && links[0] === b1);
ok("no_page_errors", errs.length === 0);
out.pageErrors = errs;
console.log(JSON.stringify(out, null, 1));
await b.close();
