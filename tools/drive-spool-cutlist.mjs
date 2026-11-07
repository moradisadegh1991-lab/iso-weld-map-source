/**
 * Browser evidence for Phase 9 (docs/audit/phase-9-spool-cutlist.md): spool & cut list traceability in the real workspace.
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
if (!projects?.length) { await api("/api/projects", { code: "P9D", name: "Phase 9 drive" }); projects = (await api("/api/projects")).body.projects; }
const projectId = projects[0].id;
const mk = () => page.evaluate(() => crypto.randomUUID());
const [w1, w2, w3, s1, s2] = await Promise.all(Array.from({ length: 5 }, mk));
const stamp = Date.now(), docNo = `P9-${stamp}`;
const b64 = readFileSync(pdf).toString("base64");
const BOM = [{ pt: 1, group: "PIPE", description: "PIPE SMLS A106-B SCH 40 BE", diam: "4", qty: 5, qtyUnit: "m" }, { pt: 2, group: "FLANGES", description: "FLANGE WN RF 300# A105 BW", diam: "4", qty: 4, qtyUnit: "pcs" }];
const row = (no, uid, extra = {}) => ({ no, spool: "SP-1", loc: "Shop", kind: "BW", nps: "4", uid, ...extra });
const meta = (rev, d = docNo) => ({ drawingNo: d, rev, sheet: "1/1", lineNo: `${d}-L1`, nps: 4 });
const spoolMark = (uid, no, x, y) => ({ id: `s${no}`, uid, kind: "spool", no, x, y, src: "hand", attrs: {} });
const docA = (await api("/api/documents", { projectId, docNo, revision: "0", fileBase64: b64, contentType: "application/pdf" })).body.document;
const payA = { meta: meta("0"), bom: BOM, weldList: [row("W-1", w1, { spoolUid: s1 }), row("W-2", w2, { spoolUid: s1 }), row("W-3", w3, { loc: "Field", spool: "" })],
  weldMarkup: { page: 1, marks: {}, byUid: { [w1]: { x: 0.2, y: 0.55, src: "hand" }, [w2]: { x: 0.35, y: 0.55, src: "hand" }, [w3]: { x: 0.5, y: 0.6, src: "hand" } } },
  sheetMarkup: { page: 1, items: [spoolMark(s1, "SP-1", 0.28, 0.4), spoolMark(s2, "SP-2", 0.6, 0.4)] } };
const rA = await api("/api/runs", { projectId, documentId: docA.id, lineNo: `${docNo}-L1`, payload: payA });
ok("A_saved", rA.status === 201);
const setPick = async (name, v) => {
  const el = page.locator(`[data-form-field="${name}"] select, [data-form-field="${name}"] input`).first();
  if ((await el.evaluate((e) => e.tagName)) === "SELECT") { await el.selectOption({ label: v }).catch(() => el.selectOption(v)); } else await el.fill(v);
};
const shotAt = async (name, sel) => { await page.locator(sel).first().scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(300); await shot(name); };
const latest = async (doc) => { const l = await api(`/api/runs?projectId=${projectId}&documentId=${doc}`); return (await api(`/api/runs/${l.body.run.id}?projectId=${projectId}`)).body; };
const open = async (runId) => {
  await page.goto(`${url}/piping`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
  await page.locator(`tr[data-key="${runId}"] button:has-text("باز کردن")`).first().click();
  await page.waitForSelector("[data-sheet-markup]", { timeout: 60000 }); await page.waitForTimeout(1200);
};
let saveAns = null;
page.on("response", async (r) => { if (r.url().endsWith("/api/runs") && r.request().method() === "POST") saveAns = { status: r.status() }; });
const saveUi = async () => { saveAns = null; await tab(page, "save"); await page.click("button:has-text('ذخیره در سامانه')"); await page.waitForTimeout(4500); return saveAns?.status; };

await open(rA.body.run.id);
await setTheme("dark");

// 1-2. the spool and its welds (seeded by identity): the detail
await tab(page, "spools"); await page.waitForSelector("[data-spool-detail]");
ok("spool_detail_two_shop_welds_by_uid", (await page.locator('[data-count="shop"]').innerText()) === "2" && (await page.locator('[data-count="field"]').innerText()) === "0");
ok("spool_detail_shows_uid", (await page.locator("[data-spool-uid]").innerText()).includes(s1));
await shotAt("p9-01-spool-detail-dark", "[data-spool-detail] [data-spool-findings]");

// 3-5. create the cut piece in the UI: start/end welds and spool picked BY IDENTITY
await tab(page, "cut");
await page.click("[data-cut-add]"); await page.waitForSelector("[data-cut-form]");
await page.fill('[data-input=lengthMm]', "900");
await setPick("ns", "4");
await page.selectOption('[data-input=from]', w1);
await page.selectOption('[data-input=to]', w2);
ok("spool_prefilled_from_end_welds_by_uid", (await page.locator('[data-input=spool]').getAttribute("data-ref-uid")) === s1);
await page.fill('[data-input=angle]', "45");
await shot("p9-02-cut-form");
await page.click("[data-form-save]"); await page.waitForTimeout(500);
const row1 = page.locator('[data-cut-row="1"]');
ok("cut_row_has_uid", /^[0-9a-f-]{36}$/.test(await row1.getAttribute("data-cut-uid")));
const uid1 = await row1.getAttribute("data-cut-uid");
ok("cut_row_shows_printed_labels", (await row1.locator('[data-cut-cell="from"]').innerText()) === "W-1" && (await row1.locator('[data-cut-cell="spool"]').innerText()) === "SP-1");

// 6. save, reopen
ok("saved_via_ui", (await saveUi()) === 201);
let p = (await latest(docA.id)).payload;
ok("persisted_uid_and_three_refs", p.cutLengths[0].uid === uid1 && p.cutLengths[0].fromUid === w1 && p.cutLengths[0].toUid === w2 && p.cutLengths[0].spoolUid === s1);
await open((await latest(docA.id)).run.id);
await tab(page, "cut");
ok("reopened_same_uid", (await page.locator('[data-cut-row="1"]').getAttribute("data-cut-uid")) === uid1);

// 7-8. renumber a weld in its form: the piece still points at the same weld (label follows)
await tab(page, "welds");
await page.locator(`[data-row-edit="${w1}"]`).first().click(); await page.waitForSelector("[data-input=no]");
await page.fill("[data-input=no]", "W-10"); await page.click("[data-form-save]"); await page.waitForTimeout(600);
await tab(page, "cut");
ok("cut_label_follows_weld_renumber_immediately", (await page.locator('[data-cut-row="1"] [data-cut-cell="from"]').innerText()) === "W-10");
ok("saved_after_weld_renumber", (await saveUi()) === 201);
p = (await latest(docA.id)).payload;
ok("same_weld_uid_after_renumber", p.cutLengths[0].fromUid === w1 && p.cutLengths[0].from === "W-10" && p.cutLengths[0].uid === uid1);

// 9-10. renumber the spool: membership intact
await open((await latest(docA.id)).run.id);
await tab(page, "spools");
await page.locator(`[data-row-edit="${s1}"]`).first().click(); await page.waitForSelector("[data-input=no]");
await page.fill("[data-input=no]", "SP-A"); await page.click("[data-form-save]"); await page.waitForTimeout(600);
await tab(page, "spools");
ok("spool_detail_keeps_both_welds_and_the_piece", (await page.locator('[data-count="shop"]').innerText()) === "2" && (await page.locator('[data-count="cuts"]').innerText()) === "1");
ok("saved_after_spool_renumber", (await saveUi()) === 201);
p = (await latest(docA.id)).payload;
ok("spool_uid_stable_labels_follow", p.cutLengths[0].spoolUid === s1 && p.cutLengths[0].spool === "SP-A" && p.weldList.filter((r) => r.spoolUid === s1).every((r) => r.spool === "SP-A") && p.weldList.filter((r) => r.spoolUid === s1).length === 2);
await tab(page, "spools");
out.spoolRect = await page.evaluate(() => { const e = document.querySelector("[data-spool-detail]"); const r = e.getBoundingClientRect(); let p = e.parentElement, clip = null; while (p) { const cs = getComputedStyle(p); if (cs.overflowY !== "visible" || cs.overflow === "hidden") { const pr = p.getBoundingClientRect(); clip = [p.className.slice(0, 24), cs.overflowY, Math.round(pr.top), Math.round(pr.bottom)]; break; } p = p.parentElement; } return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, clip }; });
await shotAt("p9-03-spool-renumbered", "[data-spool-detail] [data-spool-findings]");

// 11-12. duplicate the piece: a new identity, no inherited history
await open((await latest(docA.id)).run.id);
await tab(page, "cut");
await page.click('[data-cut-dup="1"]'); await page.waitForTimeout(400);
ok("duplicate_is_a_new_row", await page.locator("[data-cut-row]").count() === 2);
const uid2 = await page.locator('[data-cut-row="2"]').getAttribute("data-cut-uid");
ok("duplicate_has_a_new_uid", /^[0-9a-f-]{36}$/.test(uid2) && uid2 !== uid1);
ok("saved_duplicate", (await saveUi()) === 201);
p = (await latest(docA.id)).payload;
ok("duplicate_persisted_without_operational_state", p.cutLengths.length === 2 && p.cutLengths[1].uid === uid2 && !("status" in p.cutLengths[1]) && !("orig" in p.cutLengths[1]));

// 13. BOM consumption: 1.8 m of 5 m; then a material that the BOM pipe does not have
await open((await latest(docA.id)).run.id);
await tab(page, "cut");
ok("bom_consumption_preview_ok", (await page.locator('[data-cut-bom] [data-cut-status]').first().getAttribute("data-cut-status")) === "ok");
ok("bom_labelled_preview", /پیش‌نمایش/.test(await page.locator("[data-cut-bom-preview]").innerText()));
await shotAt("p9-04-cut-table-bom", "[data-cut-lengths]");

// 14. ambiguous legacy references never guess
const docL = (await api("/api/documents", { projectId, docNo: `${docNo}-L`, revision: "0", fileBase64: b64, contentType: "application/pdf" })).body.document;
const [l1, l2, ls1, ls2] = await Promise.all(Array.from({ length: 4 }, mk));
const payL = { meta: meta("0", `${docNo}-L`), bom: BOM, weldList: [row("W-1", l1), row("W-2", l2)], weldMarkup: { page: 1, marks: {}, byUid: { [l1]: { x: 0.2, y: 0.5, src: "hand" }, [l2]: { x: 0.4, y: 0.5, src: "hand" } } },
  sheetMarkup: { page: 1, items: [spoolMark(ls1, "SP-1", 0.2, 0.3), spoolMark(ls2, "SP-1", 0.5, 0.3)] },
  cutLengths: [{ piece: 1, lengthMm: 800, ns: "4", from: "W-1", to: "W-2", spool: "SP-1" }, { piece: 2, lengthMm: 600, ns: "4", material: "A312-TP304" }] };
const rL = await api("/api/runs", { projectId, documentId: docL.id, lineNo: `${docNo}-L-L1`, payload: payL });
ok("legacy_saved", rL.status === 201);
const pl = (await latest(docL.id)).payload.cutLengths[0];
ok("legacy_unique_welds_resolved_ambiguous_spool_not_guessed", Boolean(pl.fromUid) && Boolean(pl.toUid) && !pl.spoolUid);
await open((await latest(docL.id)).run.id);
await tab(page, "validation"); await page.waitForSelector("[data-vc-table]");
ok("ambiguous_finding_shown", (await page.locator('[data-finding="CUT_REF_AMBIGUOUS"]').count()) >= 1);
await shot("p9-05-ambiguous-legacy");
await tab(page, "cut");
ok("bom_material_mismatch_shown", (await page.locator('[data-cut-bom] [data-cut-status="mismatch"]').count()) >= 1 && (await page.locator('[data-finding]').count()) >= 0);
await shotAt("p9-05b-bom-mismatch", "[data-cut-bom]");
out.flag = await page.locator('[data-cut-row="1"]').first().getAttribute("data-cut-flag");
ok("cut_row_flagged", ["warning", "error"].includes(await page.locator('[data-cut-row="1"]').getAttribute("data-cut-flag")));

// 15. compare two revisions (the second made from A in the API, its own piece with another length)
const rev = await api("/api/revisions", { projectId, action: "create", sourceDocumentId: docA.id, revision: "1", noFile: true });
ok("revision_created", rev.status === 201);
const docB = rev.body.document;
const [bw1, bw2, bs1] = await Promise.all(Array.from({ length: 3 }, mk));
const payB = { meta: meta("1"), bom: BOM, weldList: [row("W-10", bw1, { spoolUid: bs1, spool: "SP-A" }), row("W-2", bw2, { spoolUid: bs1, spool: "SP-A" })], weldMarkup: { page: 1, marks: {}, byUid: { [bw1]: { x: 0.2, y: 0.55, src: "hand" }, [bw2]: { x: 0.35, y: 0.55, src: "hand" } } },
  sheetMarkup: { page: 1, items: [spoolMark(bs1, "SP-A", 0.28, 0.4)] }, cutLengths: [{ piece: 1, lengthMm: 905, ns: "4" }] };
const rB = await api("/api/runs", { projectId, documentId: docB.id, lineNo: `${docNo}-L1`, payload: payB });
ok("revision_B_saved", rB.status === 201);
await api("/api/documents", { projectId, docNo, revision: "1", fileBase64: b64, contentType: "application/pdf" });
await open((await latest(docA.id)).run.id);
await tab(page, "revisions"); await page.waitForSelector("[data-rv-timeline]");
await page.locator('[data-rv-compare], button:has-text("مقایسه")').first().click().catch(() => {});
await page.waitForTimeout(1500);
const cmp = await api(`/api/revisions?projectId=${projectId}&documentId=${docA.id}&compareTo=${docB.id}`);
out.cmp = { status: cmp.status, err: cmp.status === 200 ? null : cmp.body, kinds: (cmp.body.changes || []).filter((c) => c.cls === "cut").map((c) => c.kind) };
const cutCh = (cmp.body.changes || []).filter((c) => c.cls === "cut");
ok("compare_lists_cut_candidate_not_a_match", cutCh.some((c) => c.kind === "candidate") && !cutCh.some((c) => c.kind === "mapped"));
ok("compare_lists_removed_duplicate", cutCh.some((c) => c.kind === "removed"));
await shot("p9-06-revision-compare");

// 16. light / dark / phone
await open((await latest(docA.id)).run.id);
await tab(page, "cut"); await setTheme("light"); await page.waitForTimeout(500);
await shotAt("p9-07-cut-light", "[data-cut-lengths]");
await tab(page, "spools"); await shotAt("p9-08-spool-light", "[data-spool-detail] [data-spool-findings]");
await setTheme("dark");
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
await tab(page, "cut").catch(() => {});
ok("mobile_no_horizontal_page_scroll", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
await shot("p9-09-cut-mobile");

out.pageErrors = errs.filter((e) => !/ResizeObserver/.test(e));
ok("no_page_errors", out.pageErrors.length === 0);
console.log(JSON.stringify(out, null, 1));
await b.close();
process.exit(Object.values(out.checks).every(Boolean) ? 0 : 1);
