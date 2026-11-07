/**
 * Browser evidence for Phase 8 (docs/audit/phase-8-revision-lifecycle.md): revision lineage, comparison and controlled carry-forward in the real workspace.
 *   DRIVE_URL=… DRIVE_EMAIL=… DRIVE_PASSWORD=… DRIVE_SHOTS=… node tools/drive-revision-lifecycle.mjs [sheet.pdf]
 * Revision A (welds, BOM, an equipment, an INSTALLED allocation) is saved through the page's own session; revision B is created IN THE UI from A,
 * its register is saved (a new weld, a changed weld, a removed/reduced PT, a changed equipment, two supports where A had one = ambiguous); then the
 * comparison, filters, details, the ambiguous item, a controlled carry-forward in two steps, validation, reload, and proof that A did not change.
 */
import { openWorkspace } from "./drive-lib.mjs";
import { readFileSync } from "node:fs";

const pdf = process.argv[2] || "/root/.claude/uploads/9965cb1b-55f5-5165-aadc-93103c66b847/250abb3f-25-1029-SH1-0.pdf";
const { page, b, errs, shot, url } = await openWorkspace({});
const out = { checks: {} };
process.on("uncaughtException", (e) => { console.log(JSON.stringify(out, null, 1)); console.log("ERROR", e.message.slice(0, 500)); process.exit(1); });
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
const tabRv = () => page.click('[data-ws-tab="revisions"]');
let projects = (await api("/api/projects")).body.projects;
if (!projects?.length) { await api("/api/projects", { code: "P8", name: "Phase 8 drive" }); projects = (await api("/api/projects")).body.projects; }
const projectId = projects[0].id;
const mk = () => page.evaluate(() => crypto.randomUUID());
const [a1, a2, a3, eqA, sA, b1, b4, eqB, sB1, sB2] = await Promise.all(Array.from({ length: 10 }, mk));
const stamp = Date.now(), docNo = `P8-${stamp}`;
const b64 = readFileSync(pdf).toString("base64");
const BOM_A = [{ pt: 2, group: "FLANGES", description: "FLANGE WELD NECK RF 300# A105 BW", diam: "4", qty: 4, qtyUnit: "pcs" }, { pt: 7, group: "MISC", description: "VALVE GATE 300# BW", diam: "4", qty: 1, qtyUnit: "pcs" }, { pt: 9, group: "MISC", description: "GASKET 300# RF", diam: "4", qty: 2, qtyUnit: "pcs" }];
const BOM_B = [{ pt: 2, group: "FLANGES", description: "FLANGE WELD NECK RF 300# A105 BW", diam: "4", qty: 3, qtyUnit: "pcs" }, { pt: 7, group: "MISC", description: "VALVE GATE 600# BW", diam: "4", qty: 1, qtyUnit: "pcs" }];
const row = (no, uid, extra = {}) => ({ no, spool: "SP-1", loc: "Shop", kind: "BW", nps: "4", uid, ...extra });
const meta = (rev) => ({ drawingNo: docNo, rev, sheet: "1/1", lineNo: `${docNo}-L1`, nps: 4 });
const docA = (await api("/api/documents", { projectId, docNo, revision: "0", fileBase64: b64, contentType: "application/pdf" })).body.document;
const sup = (uid, no, id) => ({ id, uid, kind: "support", no, x: 0.7, y: 0.7, src: "hand", attrs: { type: "FS133" } });
const payA = { meta: meta("0"), bom: BOM_A, weldList: [row("1", a1, { c1: "2", c2: "7", wps: "WPS-1" }), row("2", a2), row("3", a3)],
  weldMarkup: { page: 1, marks: {}, byUid: { [a1]: { x: 0.2, y: 0.55, src: "hand" }, [a2]: { x: 0.35, y: 0.55, src: "hand" }, [a3]: { x: 0.45, y: 0.6, src: "hand" } } },
  sheetMarkup: { page: 1, items: [{ id: "me", uid: eqA, kind: "equipment", no: "V-1", x: 0.62, y: 0.5, src: "hand", attrs: { tag: "XV-100", type: "valve", c1: "7", acc: "9×2", weldRefs: a1, status: "installed" } }, sup(sA, "S-1", "ms")] } };
const rA = await api("/api/runs", { projectId, documentId: docA.id, lineNo: `${docNo}-L1`, payload: payA });
ok("A_saved", rA.status === 201);
const line = (await api(`/api/bom-allocations?projectId=${projectId}&documentId=${docA.id}`)).body.lines.find((l) => l.pt === 2 && l.status === "reserved");
ok("A_install", (await api("/api/bom-allocations", { projectId, documentId: docA.id, allocationId: line.id, action: "install", reason: "site" })).status === 200);
const snapA = async () => {
  const run = (await api(`/api/runs/${rA.body.run.id}?projectId=${projectId}`)).body;
  const al = (await api(`/api/bom-allocations?projectId=${projectId}&documentId=${docA.id}&history=1`)).body, eq = (await api(`/api/iso-equipment?projectId=${projectId}&documentId=${docA.id}`)).body.equipment;
  return JSON.stringify({ hash: run.run.payloadHash, payload: run.payload, lines: al.lines, rows: al.rows, history: al.history, eq: eq.map((e) => [e.markId, e.status, e.welds, e.accessories]), register: run.register.map((w) => [w.weld_no, w.weld_uid]) });
};
const beforeA = await snapA();
out.setup = { docNo, docA: docA.id };

// ── open A, create revision B in the UI ─────────────────────────────────
const open = async (runId) => {
  await page.goto(`${url}/piping`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
  await page.locator(`tr[data-key="${runId}"] button:has-text("باز کردن")`).first().click();
  await page.waitForSelector("[data-sheet-markup]", { timeout: 60000 }); await page.waitForTimeout(1200);
};
await open(rA.body.run.id);
await setTheme("dark");
await tabRv(); await page.waitForSelector("[data-rv-timeline]");
ok("timeline_shows_A", await page.locator('[data-rv-rev="0"]').count() === 1);
await page.fill("[data-rv-new-rev]", "1"); await page.fill("[data-rv-new-note]", "ISO re-issued: valve class and flange count changed");
await page.click("[data-rv-create]"); await page.waitForSelector('[data-rv-rev="1"]', { timeout: 15000 });
ok("B_created_and_linked_in_ui", /مبدأ: REV 0/.test(await page.locator('[data-rv-rev="1"]').innerText()));
await shot("p8-01-timeline-dark");
const lin = (await api(`/api/revisions?projectId=${projectId}&documentId=${docA.id}`)).body.chain;
const docB = lin.find((c) => c.revision === "1");
ok("B_parent_is_A", docB.parentDocumentId === docA.id);
ok("A_unchanged_after_create", (await snapA()) === beforeA);

// the new revision's drawing file arrives (the upload attaches to the revision created above — same drawing number and revision)
const attach = await api("/api/documents", { projectId, docNo, revision: "1", fileBase64: b64, contentType: "application/pdf" });
ok("B_file_attached_to_the_linked_revision", attach.status === 200 && attach.body.document.id === docB.documentId && attach.body.document.parent_document_id === docA.id);
// ── B's register (the engineer's data for the new issue) ────────────────
const payB = { meta: meta("1"), bom: BOM_B, weldList: [row("1", b1, { nps: "6" }), row("4", b4, { loc: "Field" })],
  weldMarkup: { page: 1, marks: {}, byUid: { [b1]: { x: 0.21, y: 0.56, src: "hand" }, [b4]: { x: 0.5, y: 0.5, src: "hand" } } },
  sheetMarkup: { page: 1, items: [{ id: "me", uid: eqB, kind: "equipment", no: "V-1", x: 0.62, y: 0.5, src: "hand", attrs: { type: "valve" } }, sup(sB1, "S-1", "ms1"), sup(sB2, "S-1", "ms2")] } };
const rB = await api("/api/runs", { projectId, documentId: docB.documentId, lineNo: `${docNo}-L1`, payload: payB });
ok("B_saved", rB.status === 201);
await open(rB.body.run.id);
await tabRv(); await page.waitForSelector("[data-rv-table]");
await page.waitForTimeout(800);
const kinds = () => page.locator("[data-change]").evaluateAll((e) => e.map((x) => [x.dataset.change.split(":")[0] + ":" + x.dataset.kind, x.dataset.category]));
const all = await kinds();
out.changes = all.map((x) => x[0]);
ok("compare_defaults_to_source_A", /REV 0/.test(await page.locator("[data-rv-compare-head]").innerText()));
ok("weld_added_removed_candidate", all.some((x) => x[0] === "weld:added") && all.some((x) => x[0] === "weld:removed") && all.some((x) => x[0] === "weld:candidate"));
ok("bom_changes_listed", all.filter((x) => x[1] === "bom").length >= 3);
ok("allocation_impact_listed", all.some((x) => x[1] === "allocation"));
ok("ambiguous_item_not_auto_matched", all.some((x) => x[0] === "support:ambiguous") && !all.some((x) => x[0] === "support:modified" || x[0] === "support:unchanged"));
await shot("p8-02-compare-dark");
await page.selectOption("[data-rv-kind]", "ambiguous"); await page.waitForTimeout(200);
ok("filter_ambiguous", (await kinds()).every((x) => x[0].endsWith(":ambiguous")) && (await kinds()).length === 1);
await page.selectOption("[data-rv-kind]", "removed"); await page.waitForTimeout(200);
ok("filter_removed", (await kinds()).length >= 3 && (await kinds()).every((x) => x[0].endsWith(":removed")));
await page.selectOption("[data-rv-kind]", "all"); await page.selectOption("[data-rv-category]", "bom"); await page.waitForTimeout(200);
ok("filter_category_bom", (await kinds()).every((x) => x[1] === "bom"));
// inspect a changed BOM PT
await page.click('[data-change="bom:7"]'); await page.waitForSelector("[data-rv-detail]");
ok("bom_pt_detail_values", /300#/.test(await page.locator("[data-rv-detail]").innerText()) && /600#/.test(await page.locator("[data-rv-detail]").innerText()));
await page.selectOption("[data-rv-category]", "all");
// inspect the weld candidate: selection syncs to the drawing
await page.locator(`[data-change="weld:${a1}"]`).click();
ok("detail_uids_old_and_new", (await page.locator("[data-rv-uid-from]").innerText()).trim() === a1 && (await page.locator("[data-rv-uid-to]").innerText()).trim() === b1);
ok("selection_syncs_to_drawing", await page.locator(`[data-mark-id="${b1}"]`).count() === 1 && await page.locator(`[data-mark-id="${b1}"][aria-pressed="true"], [data-mark-id="${b1}"].on, [data-mark-id="${b1}"].sel, [data-mark-id="${b1}"][aria-selected="true"]`).count() >= 1);
await shot("p8-03-candidate-detail");
// switching tab and back keeps the selection and filters
await page.click('[data-ws-tab="welds"]'); await tabRv();
ok("selection_kept_across_tabs", await page.locator("[data-rv-detail]").count() === 1);
// before confirming: carry is blocked for a candidate
ok("candidate_fields_disabled_until_confirmed", await page.locator('[data-rv-field="c1"] input').isDisabled());
// the ambiguous item: leaving it unsettled carries nothing; nothing is auto-chosen
await page.locator('[data-change^="support:ambiguous"]').click();
ok("ambiguous_has_no_preselection", (await page.locator("[data-rv-amb-from]").inputValue()) === "" && (await page.locator("[data-rv-amb-to]").inputValue()) === "");
await page.selectOption("[data-rv-amb-from]", sA); await page.selectOption("[data-rv-amb-to]", sB2);
await shot("p8-04-ambiguous-resolve");

// ── carry-forward step 1: confirm the weld pair + the supports pair + chosen fields ──
await page.locator(`[data-change="weld:${a1}"]`).click();
await page.check("[data-rv-confirm]");
await page.check('[data-rv-field="c1"] input'); await page.check('[data-rv-field="wps"] input');
ok("blocked_field_has_reason", /BOM|PT|مقدار/.test(await page.locator("[data-rv-carry]").innerText()));
await page.click("[data-rv-review]"); await page.waitForSelector("[data-rv-confirm-box]");
const sumText = await page.locator("[data-rv-confirm-box]").innerText();
ok("final_summary_shown", /خلاصهٔ نهایی/.test(sumText) && /تراکنش/.test(sumText) && /c1/.test(sumText));
await shot("p8-05-final-summary");
await page.click("[data-rv-apply-btn]"); await page.waitForTimeout(4000);   // the saved target is opened again after the carry
await page.waitForSelector("[data-sheet-markup]", { timeout: 60000 }); await tabRv(); await page.waitForSelector("[data-rv-msg]", { timeout: 20000 });
out.step1 = await page.locator("[data-rv-msg]").innerText();
ok("carry_1_done", /انتقال انجام شد/.test(out.step1));
const storedB1 = (await api(`/api/runs/${rB.body.run.id}?projectId=${projectId}`)).body.payload.weldList.find((w) => w.uid === b1);
ok("B_has_carried_fields_only_empty_ones", storedB1.c1 === "2" && storedB1.wps === "WPS-1" && !storedB1.c2 && storedB1.nps === "6");

// step 2: the equipment (its weld link now has a MAPPED weld) + the explicit supports pair
await page.waitForSelector("[data-rv-table]"); await page.waitForTimeout(800);
await page.locator(`[data-change="equipment:${eqA}"]`).click();
ok("equipment_weld_link_ready_via_mapping", await page.locator('[data-rv-field="weldRefs"]').count() === 1);
ok("equipment_status_not_offered", await page.locator('[data-rv-field="status"]').count() === 0);
await page.check("[data-rv-confirm]");
for (const f of ["tag", "c1", "weldRefs"]) await page.check(`[data-rv-field="${f}"] input`);
ok("equipment_acc_blocked_pt_missing", /PT/.test(await page.locator('[data-rv-blocked="acc"]').innerText()));
await page.click("[data-rv-review]"); await page.click("[data-rv-apply-btn]"); await page.waitForTimeout(4000);
await page.waitForSelector("[data-sheet-markup]", { timeout: 60000 }); await tabRv(); await page.waitForSelector("[data-rv-msg]", { timeout: 20000 });
out.step2 = await page.locator("[data-rv-msg]").innerText();
ok("carry_2_done", /انتقال انجام شد/.test(out.step2));
const stB = (await api(`/api/runs/${rB.body.run.id}?projectId=${projectId}`)).body.payload;
const eqStored = stB.sheetMarkup.items.find((m) => m.uid === eqB);
ok("equipment_carried_descriptions_and_mapped_link", eqStored.attrs.tag === "XV-100" && eqStored.attrs.c1 === "7" && eqStored.attrs.weldRefs === b1 && !eqStored.attrs.acc && !eqStored.attrs.status);
const eqSrv = (await api(`/api/iso-equipment?projectId=${projectId}&documentId=${docB.documentId}`)).body.equipment[0];
ok("B_equipment_starts_planned_not_installed", eqSrv.status === "planned" && eqSrv.welds.length === 1 && eqSrv.welds[0].ref === b1);
const mapped = (await api(`/api/revisions?projectId=${projectId}&documentId=${docA.id}&compareTo=${docB.documentId}`)).body;
ok("mappings_recorded", mapped.mappings.length === 3 && mapped.mappings.some((m) => m.fromUid === sA && m.toUid === sB2) && !mapped.mappings.some((m) => m.toUid === sB1));
await tabRv(); await page.waitForSelector("[data-rv-table]"); await page.waitForTimeout(600);
await shot("p8-06-after-carry");

// ── validation of the new revision ──────────────────────────────────────
await page.click("[data-rv-validate]"); await page.waitForSelector("[data-vc-table]");
await page.click('[data-vc-source="saved"]'); await page.waitForTimeout(800);
const vcodes = await page.locator("[data-finding]").evaluateAll((e) => e.map((x) => x.dataset.finding));
out.validationCodes = vcodes;
ok("validation_runs_with_lineage_rules", vcodes.length > 0 && !vcodes.includes("REV_NO_SOURCE") && !vcodes.includes("REV_HIST_DEMAND"));
await shot("p8-07-validation-saved");

// ── reload B, then open A and prove it did not change ───────────────────
await open(rB.body.run.id); await tabRv(); await page.waitForSelector("[data-rv-table]"); await page.waitForTimeout(600);
const persisted = (await api(`/api/runs/${rB.body.run.id}?projectId=${projectId}`)).body.payload.weldList.find((w) => w.uid === b1);
ok("B_reload_keeps_carried_data", persisted.c1 === "2" && persisted.wps === "WPS-1");
await page.click('[data-rv-open="0"]'); await page.waitForSelector("[data-sheet-markup]", { timeout: 60000 }); await page.waitForTimeout(1200);
ok("A_opened_again_from_timeline", /P8-/.test(await page.locator("[data-ws-chip='drawing']").innerText()) && /REV 0/.test(await page.locator("[data-ws-chip='drawing']").innerText()));
ok("A_completely_unchanged", (await snapA()) === beforeA);
const histA = (await api(`/api/bom-allocations?projectId=${projectId}&documentId=${docA.id}&history=1`)).body;
ok("A_installed_line_and_events_intact", histA.lines.some((l) => l.status === "installed" && l.pt === 2) && histA.history.length >= 2);
const linesB = (await api(`/api/bom-allocations?projectId=${projectId}&documentId=${docB.documentId}`)).body.lines;
ok("B_has_no_A_allocation_as_demand", linesB.every((l) => ![a1, a2, a3].includes(l.ownerRef)) && linesB.some((l) => l.ownerRef === b1));

// ── theme and phone ─────────────────────────────────────────────────────
await open(rB.body.run.id); await tabRv(); await page.waitForSelector("[data-rv-table]");
await setTheme("light"); await tabRv(); await page.waitForTimeout(500);
await shot("p8-08-compare-light");
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
await page.locator("[data-revisions]").scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
ok("mobile_no_horizontal_page_scroll", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
await shot("p8-09-compare-mobile");
ok("no_page_errors", errs.length === 0); out.pageErrors = errs;
console.log(JSON.stringify(out, null, 1));
await b.close();
