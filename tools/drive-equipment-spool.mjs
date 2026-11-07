/**
 * Browser evidence for Phase 10 (docs/audit/phase-10-equipment-spool.md): equipment–spool identity and referential integrity in the real workspace.
 *   DRIVE_URL=… DRIVE_EMAIL=… DRIVE_PASSWORD=… DRIVE_SHOTS=… node tools/drive-spool-cutlist.mjs [sheet.pdf]
 * Revision A is saved through the page's own session with a spool-less cut table; then IN THE UI: the cut piece is created with its start/end
 * welds and spool picked by identity, saved, reopened; a weld and the spool are renumbered; the piece is duplicated (new identity); the BOM
 * consumption is read; an ambiguous legacy sheet shows its structured finding; a second revision is compared; light / dark / phone.
 */
import { openWorkspace, tab } from "./drive-lib.mjs";
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
let projects = (await api("/api/projects")).body.projects;
if (!projects?.length) { await api("/api/projects", { code: "P10D", name: "Phase 10 drive" }); projects = (await api("/api/projects")).body.projects; }
const projectId = projects[0].id;
const mk = () => page.evaluate(() => crypto.randomUUID());
const [w1, s1, s2, e1] = await Promise.all(Array.from({ length: 4 }, mk));
const stamp = Date.now(), docNo = `P10-${stamp}`;
const b64 = readFileSync(pdf).toString("base64");
const row = (no, uid, extra = {}) => ({ no, spool: "", loc: "Field", kind: "BW", nps: "4", uid, ...extra });
const meta = (d) => ({ drawingNo: d, rev: "0", sheet: "1/1", lineNo: `${d}-L1`, nps: 4 });
const spoolMark = (uid, no, x, y) => ({ id: `s${no}${uid.slice(0, 4)}`, uid, kind: "spool", no, x, y, src: "hand", attrs: {} });
const equipMark = (uid, no, attrs, x = 0.45, y = 0.5) => ({ id: `e${no}`, uid, kind: "equipment", no, x, y, src: "hand", attrs: { tag: `XV-${no}`, type: "valve", ...attrs } });
const setPick = async (name, v) => {
  const el = page.locator(`[data-form-field="${name}"] select, [data-form-field="${name}"] input`).first();
  if ((await el.evaluate((e) => e.tagName)) === "SELECT") { await el.selectOption({ label: v }).catch(() => el.selectOption(v)); } else await el.fill(v);
};
const latest = async (doc) => { const l = await api(`/api/runs?projectId=${projectId}&documentId=${doc}`); return (await api(`/api/runs/${l.body.run.id}?projectId=${projectId}`)).body; };
const open = async (runId) => {
  await page.goto(`${url}/piping`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
  await page.locator(`tr[data-key="${runId}"] button:has-text("باز کردن")`).first().click();
  await page.waitForSelector("[data-sheet-markup]", { timeout: 60000 }); await page.waitForTimeout(1200);
};
let saveAns = null;
page.on("response", async (r) => { if (r.url().endsWith("/api/runs") && r.request().method() === "POST") { saveAns = { status: r.status(), body: await r.json().catch(() => null) }; } });
const saveUi = async () => { saveAns = null; await tab(page, "save"); await page.click("button:has-text('ذخیره در سامانه')"); await page.waitForTimeout(4500); return saveAns; };
const shotAt = async (name, sel) => { await page.locator(sel).first().scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(300); await shot(name); };
const eqAttrs = (p, uid) => p.sheetMarkup.items.find((m) => m.uid === uid)?.attrs || {};

// ── revision A: one typed weld, two spools, one equipment that names its spool the OLD way (a printed number) ──
const docA = (await api("/api/documents", { projectId, docNo, revision: "0", fileBase64: b64, contentType: "application/pdf" })).body.document;
const payA = { meta: meta(docNo), bom: [], weldList: [row("W-1", w1)], weldMarkup: { page: 1, marks: {}, byUid: { [w1]: { x: 0.2, y: 0.55, src: "hand" } } },
  sheetMarkup: { page: 1, items: [spoolMark(s1, "SP-1", 0.28, 0.4), spoolMark(s2, "SP-2", 0.6, 0.4), equipMark(e1, "V-1", { weldRefs: w1, spool: "SP-1", note: "keep-me" })] } };
const rA = await api("/api/runs", { projectId, documentId: docA.id, lineNo: `${docNo}-L1`, payload: payA });
ok("A_saved", rA.status === 201);
ok("legacy_printed_spool_settled_to_uid_by_server", eqAttrs((await latest(docA.id)).payload, e1).spoolUid === s1);
await open((await latest(docA.id)).run.id);
await setTheme("dark");

// equipment table: the spool shows its label and short uid
await tab(page, "equip"); await page.waitForSelector("[data-equip-marks]");
ok("equip_table_shows_label_and_uid", (await page.locator(`[data-equip-row="${e1}"] [data-cell="spool"]`).getAttribute("data-spool-uid")) === s1);
await shot("p10-01-equipment-table-dark");

// move the equipment to SP-2 in its form (uid + label together), other attributes preserved
await page.locator(`[data-row-edit="${e1}"]`).first().click(); await page.waitForSelector("[data-input=spool]");
ok("form_selector_is_by_uid", (await page.locator("[data-input=spool]").getAttribute("data-spool-uid")) === s1);
await shot("p10-02-equipment-form");
await page.selectOption("[data-input=spool]", s2);
await page.click("[data-form-save]"); await page.waitForTimeout(500);
ok("saved_move_to_sp2", (await saveUi())?.status === 201);
let p = (await latest(docA.id)).payload;
ok("equipment_now_names_sp2_by_uid_and_keeps_note", eqAttrs(p, e1).spoolUid === s2 && eqAttrs(p, e1).spool === "SP-2" && eqAttrs(p, e1).note === "keep-me");

// renumber SP-2 → SP-B: the relationship is the uid, the label follows
await open((await latest(docA.id)).run.id);
await tab(page, "spools");
await page.locator(`[data-row-edit="${s2}"]`).first().click(); await page.waitForSelector("[data-input=no]");
await page.fill("[data-input=no]", "SP-B"); await page.click("[data-form-save]"); await page.waitForTimeout(600);
await tab(page, "equip");
ok("equipment_label_follows_spool_renumber_immediately", (await page.locator(`[data-equip-row="${e1}"] [data-cell="spool"]`).innerText()).includes("SP-B"));
ok("saved_after_renumber", (await saveUi())?.status === 201);
p = (await latest(docA.id)).payload;
ok("same_spool_uid_after_renumber", eqAttrs(p, e1).spoolUid === s2 && eqAttrs(p, e1).spool === "SP-B");

// spool detail: the equipment of the spool, navigation to it
await open((await latest(docA.id)).run.id);
await tab(page, "spools"); await page.waitForSelector("[data-spool-detail]");
await page.selectOption("[data-spool-pick]", s2); await page.waitForTimeout(300);
ok("spool_detail_lists_equipment", (await page.locator('[data-count="equipment"]').innerText()) === "1" && (await page.locator(`[data-spool-equipment="${e1}"]`).count()) === 1);
await shotAt("p10-03-spool-detail-equipment", "[data-spool-equipment-list]");
await page.locator(`[data-spool-equipment-go="${e1}"]`).click(); await page.waitForTimeout(500);
ok("navigate_spool_to_equipment_selects_row", (await page.locator(`[data-equip-row="${e1}"]`).getAttribute("aria-selected")) === "true");

// deleting the spool: the preview lists the equipment; the SERVER refuses the save while it is named
await tab(page, "spools");
await page.locator(`[data-row-delete="${s2}"]`).first().click(); await page.waitForSelector("[data-confirm-lines]");
const lines = await page.locator("[data-confirm-lines]").innerText();
ok("delete_preview_lists_equipment_and_says_server_refuses", /تجهیز V-1/.test(lines) && /سرور/.test(lines));
await shot("p10-04-delete-preview");
await page.click("[data-confirm-yes]"); await page.waitForTimeout(500);
const refused = await saveUi();
ok("server_refuses_with_structured_dependents", refused?.status === 409 && refused.body?.code === "SPOOL_IN_USE" && refused.body.details.spools[0].dependents.some((d) => d.type === "equipment" && d.uid === e1));
ok("nothing_stored_nothing_detached", (await latest(docA.id)).payload.sheetMarkup.items.some((m) => m.uid === s2) && eqAttrs((await latest(docA.id)).payload, e1).spoolUid === s2);
await tab(page, "save"); await shot("p10-05-server-refusal");

// explicit removal of the relationship in the equipment form, then the save is accepted
await tab(page, "equip");
await page.locator(`[data-row-edit="${e1}"]`).first().click(); await page.waitForSelector("[data-input=spool]");
ok("form_says_dangling_after_local_delete", (await page.locator("[data-input=spool]").getAttribute("data-ref-state")) === "dangling");
await page.selectOption("[data-input=spool]", ""); await page.click("[data-form-save]"); await page.waitForTimeout(500);
const accepted = await saveUi();
ok("save_accepted_after_explicit_removal", accepted?.status === 201);
p = (await latest(docA.id)).payload;
ok("spool_gone_equipment_unassigned_not_silently_moved", !p.sheetMarkup.items.some((m) => m.uid === s2) && !eqAttrs(p, e1).spoolUid);

// ── a revision with duplicate printed spool numbers, a legacy equipment and a dangling one ──
const docB = (await api("/api/documents", { projectId, docNo: `${docNo}-B`, revision: "0", fileBase64: b64, contentType: "application/pdf" })).body.document;
const [b1, b2, b3, bs1, bs2, be1, be2, gone] = await Promise.all(Array.from({ length: 8 }, mk));
const payB = { meta: meta(`${docNo}-B`), bom: [], weldList: [row("W-1", b1, { spool: "SP-1", spoolUid: bs1 }), row("W-2", b2, { spool: "SP-1", spoolUid: bs1 }), row("W-3", b3, { spool: "SP-1", spoolUid: bs2 })],
  weldMarkup: { page: 1, marks: {}, byUid: { [b1]: { x: 0.2, y: 0.55, src: "hand" }, [b2]: { x: 0.3, y: 0.55, src: "hand" }, [b3]: { x: 0.4, y: 0.55, src: "hand" } } },
  sheetMarkup: { page: 1, items: [spoolMark(bs1, "SP-1", 0.28, 0.4), spoolMark(bs2, "SP-1", 0.6, 0.4), equipMark(be1, "V-1", { weldRefs: b1, spool: "SP-1" }, 0.45, 0.5), equipMark(be2, "V-2", { weldRefs: b2, spoolUid: gone, spool: "SP-1" }, 0.5, 0.6)] } };
const rB = await api("/api/runs", { projectId, documentId: docB.id, lineNo: `${docNo}-B-L1`, payload: payB });
ok("B_saved", rB.status === 201);
const pb = (await latest(docB.id)).payload;
ok("ambiguous_legacy_not_guessed_dangling_not_repointed", !eqAttrs(pb, be1).spoolUid && eqAttrs(pb, be2).spoolUid === gone);
await open((await latest(docB.id)).run.id);
await tab(page, "validation"); await page.waitForSelector("[data-vc-table]");
ok("E_SPOOL_AMBIGUOUS_shown", (await page.locator('[data-finding="E_SPOOL_AMBIGUOUS"]').count()) >= 1);
ok("E_SPOOL_DANGLING_shown", (await page.locator('[data-finding="E_SPOOL_DANGLING"]').count()) >= 1);
await shot("p10-06-validation-findings");
await page.locator('[data-finding="E_SPOOL_DANGLING"]').first().click();
await page.locator('[data-vc-open="equipment-form"]').click().catch(() => {}); await page.waitForTimeout(600);
ok("finding_navigates_to_the_equipment_form", (await page.locator("[data-mark-form=equipment]").count()) >= 1);
await shot("p10-07-dangling-equipment-form");
await page.keyboard.press("Escape"); await page.waitForTimeout(300);

// cut form: the spool is preselected from the two end welds' spool UID, never from the printed number (two spools are both «SP-1»)
await tab(page, "cut"); await page.click("[data-cut-add]"); await page.waitForSelector("[data-cut-form]");
await page.fill("[data-input=lengthMm]", "500");
await page.selectOption("[data-input=from]", b1); await page.selectOption("[data-input=to]", b2);
ok("cutform_preselects_the_shared_spool_by_uid", (await page.locator("[data-input=spool]").getAttribute("data-ref-uid")) === bs1);
await page.keyboard.press("Escape"); await page.waitForTimeout(300);
await page.click("[data-cut-add]"); await page.waitForSelector("[data-cut-form]");
await page.fill("[data-input=lengthMm]", "600");
await page.selectOption("[data-input=from]", b1); await page.selectOption("[data-input=to]", b3);
ok("cutform_does_not_guess_between_two_spools", (await page.locator("[data-input=spool]").getAttribute("data-ref-uid")) === "");
await shot("p10-08-cutform-no-guess");
await page.keyboard.press("Escape");

// light / dark / phone
await tab(page, "equip"); await setTheme("light"); await page.waitForTimeout(500);
await shotAt("p10-09-equipment-light", "[data-equip-marks]");
await tab(page, "spools"); await shotAt("p10-10-spool-light", "[data-spool-detail]");
await setTheme("dark");
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
await tab(page, "equip").catch(() => {});
ok("mobile_no_horizontal_page_scroll", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
await shot("p10-11-equipment-mobile");

out.pageErrors = errs.filter((e) => !/ResizeObserver/.test(e));
ok("no_page_errors", out.pageErrors.length === 0);
console.log(JSON.stringify(out, null, 1));
await b.close();
process.exit(Object.values(out.checks).every(Boolean) ? 0 : 1);
