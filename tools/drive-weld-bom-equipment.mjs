/**
 * Browser evidence for Phase 6 (docs/audit/phase-6-weld-bom-equipment-integration.md): one weld, one identity — typed list, BOM ledger, equipment.
 *   DRIVE_URL=… DRIVE_EMAIL=… DRIVE_PASSWORD=… DRIVE_SHOTS=… node tools/drive-weld-bom-equipment.mjs [sheet.pdf]
 * Starts from a SAVED typed run (made through the page's own authenticated session) and drives the real workspace: assigns two BOM components to
 * a weld, saves, reopens, links an equipment to the weld, renumbers, moves, duplicates, tries a duplicated number, a protected installed
 * allocation, an ambiguous legacy relationship and a revision boundary. Server state is read back through the application's own routes.
 */
import { openWorkspace, tab } from "./drive-lib.mjs";
import { readFileSync } from "node:fs";
import { DEMO } from "../lib/demo.js";

const pdf = process.argv[2] || "/root/.claude/uploads/9965cb1b-55f5-5165-aadc-93103c66b847/250abb3f-25-1029-SH1-0.pdf";
const { page, b, errs, shot, url } = await openWorkspace({});
const out = { checks: {} };
process.on("uncaughtException", (e) => { console.log(JSON.stringify(out, null, 1)); console.log("ERROR", e.message.slice(0, 300)); process.exit(1); });
const ok = (k, v) => { out.checks[k] = Boolean(v); };
const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
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

// ── a saved typed run: two welds without components, an equipment, a BOM of two PTs ────────────────────────
const b64 = readFileSync(pdf).toString("base64");
const projectId = (await api("/api/projects")).body.projects[0].id;
const docNo = `P6-${Date.now()}`;
const doc = (await api("/api/documents", { projectId, docNo, revision: "0", fileBase64: b64, contentType: "application/pdf" })).body.document;
const mkUid = () => page.evaluate(() => crypto.randomUUID());
const [w1, w2, eqUid] = [await mkUid(), await mkUid(), await mkUid()];
const BOM = [{ pt: 2, group: "FLANGES", description: "FLANGE WELD NECK RF 300# A105 BW", diam: "4", qty: 4, qtyUnit: "pcs" }, { pt: 7, group: "MISC", description: "STUD BOLT SET", diam: "4", qty: 4, qtyUnit: "pcs" }];
const row = (no, uid, loc = "Shop") => ({ no, spool: "SP-1", loc, kind: "BW", nps: "4", uid });
const base = { meta: { drawingNo: docNo, rev: "0", sheet: "1/1", lineNo: "P6-L1", nps: 4 }, bom: BOM };
const rows0 = [row("1", w1), row("2", w2, "Field")];
const eq0 = { id: "m9", uid: eqUid, kind: "equipment", no: "V-1", x: 0.62, y: 0.5, src: "hand", attrs: { tag: "XV-100", type: "valve", c1: "7", status: "planned" } };
const first = await api("/api/runs", { projectId, documentId: doc.id, lineNo: "P6-L1", payload: { ...base, weldList: rows0,
  weldMarkup: { page: 1, marks: {}, byUid: { [w1]: { x: 0.2, y: 0.55, src: "hand" }, [w2]: { x: 0.35, y: 0.55, src: "hand" } } }, sheetMarkup: { page: 1, items: [eq0] } } });
ok("setup_saved", first.status === 201);
out.setup = { projectId, documentId: doc.id, status: first.status };

const dbg0 = null;
const openLatest = async () => {
  const id = (await latestRun())?.run?.id;            // the review queue lists every run: open the newest one, by its id
  await page.goto(`${url}/piping`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.locator(`tr[data-key="${id}"] button:has-text("باز کردن")`).first().click();
  await page.waitForSelector("[data-sheet-markup]", { timeout: 60000 });
  await page.waitForTimeout(1500);
};
const marks = () => page.locator("[data-mark-id]").evaluateAll((e) => e.map((x) => [x.dataset.markId, x.textContent.trim().slice(0, 10), x.dataset.kind]));
const refOf = async (txt) => (await marks()).find(([, t]) => t === txt || t.startsWith(txt))?.[0];
const rightClick = async (ref) => { await page.locator(`[data-mark-id="${ref}"]`).first().click({ button: "right" }); await page.waitForSelector("[role=menu]"); };
const menuDo = async (word) => { await page.locator("[role=menuitem]", { hasText: word }).click(); };
const saveRun = async () => {
  let ans = null;
  const h = async (r) => { if (r.url().endsWith("/api/runs") && r.request().method() === "POST") ans = { status: r.status(), body: await r.json().catch(() => null) }; };
  page.on("response", h);
  await tab(page, "save");
  await page.click("button:has-text('ذخیره در سامانه')");
  await page.waitForTimeout(4000);
  page.off("response", h);
  (out.saves ||= []).push({ status: ans?.status, error: ans?.body?.error?.slice?.(0, 160) || null, code: ans?.body?.code || null });
  return ans;
};
const serverLines = async () => (await api(`/api/bom-allocations?projectId=${projectId}&documentId=${doc.id}`)).body;
const serverEquip = async () => (await api(`/api/iso-equipment?projectId=${projectId}&documentId=${doc.id}`)).body.equipment;
const latestRun = async () => { const l = await api(`/api/runs?projectId=${projectId}&documentId=${doc.id}`); const id = l.body?.run?.id; return id ? (await api(`/api/runs/${id}?projectId=${projectId}`)).body : null; };

const dbg = async (label) => { const r = await latestRun(); const p = r?.payload || {}; (out.dbg ||= {})[label] = { runId: r?.run?.id?.slice(0, 8), weldList: (p.weldList || []).map((w) => [w.no, (w.uid || "").slice(0, 8), w.c1 || "", w.c2 || ""]), equip: (p.sheetMarkup?.items || []).filter((m) => m.kind === "equipment").map((m) => [m.no, m.attrs]) }; };
await openLatest();
await setTheme("dark");
const weld1 = await refOf("1");
ok("weld_ref_is_the_typed_uid", weld1 === w1);

// 1. assign two BOM components to the weld in its form
await rightClick(weld1); await menuDo("ویرایش");
await page.waitForSelector("[data-mark-form]");
ok("form_shows_uid", (await page.locator("[data-mark-identity]").textContent()).includes(w1));
const opt = await page.locator("[data-input=c1] option").evaluateAll((o) => o.map((x) => x.textContent));
ok("pick_shows_description_size_and_capacity", opt.some((t) => /PT 2/.test(t) && /FLANGE/.test(t) && /\(4\)/.test(t) && /مانده 4\/4/.test(t)));
await page.selectOption("[data-input=c1]", "2");
await page.selectOption("[data-input=c2]", "2");
await shot("weld-form-components-dark");
await page.click("[data-form-save]");
await page.waitForTimeout(500);
// 2. save, and read the server back
const s1 = await saveRun(); await dbg("afterComponents");
ok("save_accepted", s1?.status === 201);
let L = await serverLines();
const mine = (L.lines || []).filter((l) => l.ownerRef === w1);
ok("allocation_exists_once_under_the_uid", mine.length === 1 && mine[0].pt === 2 && mine[0].qty === 2 && mine[0].ownerNo === "1");
const firstLineId = mine[0]?.id;

// 3. reopen: same uid, allocation not duplicated
await openLatest();
ok("reopen_uid_unchanged", (await refOf("1")) === w1);
await tab(page, "bom"); await page.waitForTimeout(800);
const ledgerCell = await page.locator('[data-bom-ledger="2"]').textContent();
out.ledgerCell = ledgerCell;
ok("bom_tab_server_numbers", /سر:\s*2\/0\/2/.test(ledgerCell));
await page.locator('[data-bom-detail="2"]').click();
await page.waitForSelector("[data-bom-consumers]");
const consumers = await page.locator("[data-bom-consumers] ul:not([data-bom-history]) li").allTextContents();
out.consumers = consumers;
ok("bom_consumers_list_the_weld_once", consumers.filter((t) => /سرجوش 1/.test(t)).length === 1);
await shot("bom-consumers-history-dark");

// (what the reopened form holds for the weld's components)
await rightClick(await refOf("1")); await menuDo("مشاهدهٔ");
await page.waitForSelector("[data-mark-form]");
out.reopenedComponents = [await page.locator("[data-input=c1]").inputValue(), await page.locator("[data-input=c2]").inputValue()];
await page.click("[data-form-close]"); await page.waitForTimeout(300);
// 4. link the equipment to the weld, by uid
await tab(page, "equip");
const eqRef = await refOf("V-1");
await rightClick(eqRef); await menuDo("ویرایش");
await page.waitForSelector("[data-mark-form]");
await page.locator(`[data-weld-pick="${w1}"]`).check();
await shot("equipment-form-weld-by-uid-dark");
await page.click("[data-form-save]"); await page.waitForTimeout(500);
await saveRun(); await dbg("afterLink");
let E = await serverEquip();
ok("equipment_link_stored_by_uid", E[0]?.welds?.length === 1 && E[0].welds[0].ref === w1 && E[0].welds[0].no === "1");

// 5. renumber the weld; the link and the allocation stay
await openLatest();
await rightClick(await refOf("1")); await menuDo("ویرایش");
await page.waitForSelector("[data-mark-form]");
await page.fill("[data-input=no]", "88");
await page.click("[data-form-save]"); await page.waitForTimeout(500);
await tab(page, "equip");
ok("equipment_table_shows_the_new_number_by_uid", (await page.locator('[data-cell="welds"]').first().textContent()).includes("88"));
await saveRun(); await dbg("afterRenumber");
E = await serverEquip(); L = await serverLines();
out.afterRenumber = { equipment: E, saves: out.saves };
ok("renumber_keeps_link", E[0]?.welds?.[0]?.ref === w1 && E[0]?.welds?.[0]?.no === "88");
ok("renumber_keeps_allocation_line", (L.lines || []).filter((l) => l.ownerRef === w1).length === 1 && L.lines.find((l) => l.ownerRef === w1).id === firstLineId && L.lines.find((l) => l.ownerRef === w1).ownerNo === "88");

// 6. move the weld
await openLatest();
const w88 = await refOf("88");
const pre = await page.locator(`[data-mark-id="${w88}"]`).first().boundingBox();
await rightClick(w88); await menuDo("جابه‌جایی");
const sb = await page.locator("[data-sheet]").boundingBox();
await page.mouse.click(sb.x + sb.width * 0.7, sb.y + sb.height * 0.85);
await page.waitForTimeout(500);
const post = await page.locator(`[data-mark-id="${w88}"]`).first().boundingBox();
ok("moved_on_the_sheet", Math.abs(post.x - pre.x) > 20 || Math.abs(post.y - pre.y) > 20);
await saveRun();
E = await serverEquip(); L = await serverLines();
ok("move_keeps_link_and_allocation", E[0].welds[0].ref === w1 && (L.lines || []).filter((l) => l.ownerRef === w1).length === 1);

// 7. duplicate: a new uid, nothing inherited
await openLatest();
const before = await marks();
await rightClick(await refOf("88")); await menuDo("کپی");
await page.waitForTimeout(500);
const after = await marks();
const dupRef = after.map(([r]) => r).find((r) => !before.some(([x]) => x === r));
ok("duplicate_new_uid", Boolean(dupRef) && UID.test(dupRef) && dupRef !== w1);
await rightClick(dupRef); await menuDo("مشاهده");
await page.waitForSelector("[data-mark-form]");
ok("duplicate_has_no_saved_allocation", await page.locator('[data-weld-alloc="none"]').count() === 1);
ok("duplicate_joined_to_no_equipment", await page.locator('[data-weld-equipment="none"]').count() === 1);
await shot("duplicate-form-no-inheritance-dark");
await page.click("[data-form-close]"); await page.waitForTimeout(300);

// 8. a duplicated printed number: the form refuses it (identity is the uid, but two welds with one number cannot be told apart by a person)
await rightClick(dupRef); await menuDo("ویرایش");
await page.waitForSelector("[data-mark-form]");
await page.fill("[data-input=no]", "88");
await page.click("[data-form-save]"); await page.waitForTimeout(400);
ok("duplicate_number_refused_by_the_form", /روی این برگ هست/.test(await page.locator("[data-form-error]").textContent()));
await shot("duplicate-number-refused-dark");
await page.click("[data-form-cancel]"); await page.waitForTimeout(400);
// the copy is removed again: nothing of it was ever saved
await rightClick(dupRef); await menuDo("حذف"); await page.waitForSelector('[data-confirm="confirm"]'); await page.click("[data-confirm-yes]"); await page.waitForTimeout(400);
ok("copy_removed_before_saving", !(await marks()).some(([r]) => r === dupRef));

// 9. an ambiguous LEGACY relationship: a sheet-marks run (the geometry route) with two welds printing «5» and an equipment that names its welds by
//    number only. Saved through the same route; the server links nothing on a guess and records it; the page says so in the equipment's form.
const docL = (await api("/api/documents", { projectId, docNo: `${docNo}-LEG`, revision: "0", fileBase64: b64, contentType: "application/pdf" })).body.document;
const dA = await mkUid(), dB = await mkUid(), eL = await mkUid();
const demo = JSON.parse(JSON.stringify(DEMO)); delete demo.bom;
const legacyItems = [{ id: "m1", uid: dA, kind: "weld-shop", no: "5", x: 0.2, y: 0.3, src: "hand", attrs: {} }, { id: "m2", uid: dB, kind: "weld-field", no: "5", x: 0.4, y: 0.3, src: "hand", attrs: {} },
  { id: "m3", uid: eL, kind: "equipment", no: "V-4", x: 0.6, y: 0.4, src: "hand", attrs: { type: "valve", welds: "5", status: "planned" } }];
const legacyRun = await api("/api/runs", { projectId, documentId: docL.id, lineNo: "P6-L2", payload: { ...demo, bom: BOM, sheetMarkup: { page: 1, items: legacyItems } } });
ok("legacy_run_saved", legacyRun.status === 201);
const legacyLinks = (await api(`/api/iso-equipment?projectId=${projectId}&documentId=${docL.id}`)).body.equipment;
ok("ambiguous_legacy_links_nothing", legacyLinks[0]?.welds?.length === 0);
await page.goto(`${url}/piping`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
await page.locator(`tr[data-key="${legacyRun.body.run.id}"] button:has-text("باز کردن")`).first().click();
await page.waitForSelector("[data-sheet-markup]", { timeout: 60000 }); await page.waitForTimeout(1500);
await rightClick(await refOf("V-4")); await menuDo("ویرایش");
await page.waitForSelector("[data-mark-form]");
const unresolvedText = await page.locator("[data-weld-unresolved]").textContent();
ok("form_names_the_ambiguous_legacy_number", /5/.test(unresolvedText) && /نام چند سرجوش/.test(unresolvedText));
await shot("equipment-ambiguous-legacy-dark");
await page.click("[data-form-cancel]"); await page.waitForTimeout(300);

// 10. a protected installed allocation: install the weld's line through the API, reopen, try to delete
await openLatest();
L = await serverLines();
const line = (L.lines || []).find((l) => l.ownerRef === w1);
const inst = await api("/api/bom-allocations", { projectId, documentId: doc.id, allocationId: line.id, action: "install", reason: "site" });
ok("installed_through_the_ledger", inst.status === 200);
await openLatest();
await rightClick(await refOf("88")); await menuDo("حذف");
await page.waitForSelector('[data-confirm="blocked"]');
const blockedText = await page.locator("[data-confirm-lines]").textContent();
ok("protected_delete_names_the_installed_line_and_the_way_out", /نصب‌شده/.test(blockedText) && /برگرداندن|return/.test(blockedText));
await shot("delete-blocked-installed-allocation-dark");
await page.click("[data-confirm-close]");
// the equipment still names the weld: deleting the weld is blocked by that too
const e2 = await api(`/api/runs/${(await latestRun()).run.id}/edits`, null);

// 11. revision boundary: the weld's uid is refused on another revision of the same drawing
const rev1 = (await api("/api/documents", { projectId, docNo, revision: "1", fileBase64: Buffer.from("rev1 " + docNo).toString("base64") })).body.document;
const refused = await api("/api/runs", { projectId, documentId: rev1.id, lineNo: "P6-L1", payload: { ...base, weldList: [row("88", w1)] } });
ok("other_revision_refuses_the_uid", refused.status === 409 && refused.body?.code === "MARK_UID_CONFLICT");
const fresh = await api("/api/runs", { projectId, documentId: rev1.id, lineNo: "P6-L1", payload: { ...base, weldList: [row("88", null)].map(({ uid, ...r }) => r) } });
ok("other_revision_makes_new_identities", fresh.status === 201);

// 12. light theme and narrow width
await openLatest();
await setTheme("light");
await tab(page, "bom"); await page.waitForTimeout(600);
await page.locator('[data-bom-detail="2"]').click().catch(() => {});
await shot("bom-consumers-light");
await tab(page, "equip");
await shot("equipment-table-light");
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(500);
await shot("workspace-narrow-light");
ok("narrow_no_hscroll", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)));
out.errs = errs;
console.log(JSON.stringify(out, null, 1));
await b.close();
