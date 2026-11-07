#!/usr/bin/env node
/**
 * Phase 8 — revision lineage, comparison and controlled carry-forward (docs/audit/phase-8-revision-lifecycle.md).
 * The source revision is never written to; identity is explicit (uid mapping), never a printed number or a position; nothing installed,
 * tested, reserved or historical moves; a carry-forward is one transaction, idempotent, and refused against stale state.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
import { newUid } from "../../lib/sheet/mark-identity.mjs";
import { diffRevisions, applyCarry, CARRY_FIELDS } from "../../lib/revision/revision-diff.mjs";
import { validate } from "../../lib/engineering/validation.mjs";

const R = (no, extra = {}) => ({ no, spool: "SP-1", loc: "Shop", kind: "BW", nps: "4", ...extra });
const BOM_A = [{ pt: 2, description: "FLANGE WN RF 300# A105 BW", diam: "4", qty: 4, qtyUnit: "pcs" }, { pt: 7, description: "VALVE GATE 300# BW", diam: "4", qty: 1, qtyUnit: "pcs" }, { pt: 9, description: "GASKET", diam: "4", qty: 2, qtyUnit: "pcs" }];
const eqMark = (uid, attrs, no = "V-1") => ({ id: `e-${no}`, uid, kind: "equipment", no, x: 0.5, y: 0.5, src: "hand", attrs });
const codes = (r) => r.changes.map((c) => `${c.kind}:${c.id.split(":")[0]}`);
const find = (r, pred) => r.changes.find(pred);

// ── pure: the comparison ─────────────────────────────────────────────────

const [a1, a2, a3, b1, b2, b4, ea, eb] = Array.from({ length: 8 }, newUid);
const SRC = () => ({ payload: { meta: { drawingNo: "D", rev: "0", lineNo: "L1" }, bom: BOM_A,
  weldList: [R("1", { uid: a1, c1: "2", c2: "7", wps: "W-1" }), R("2", { uid: a2 }), R("3", { uid: a3 })],
  sheetMarkup: { items: [eqMark(ea, { tag: "XV-1", type: "valve", c1: "7", acc: "9×2", weldRefs: a1, status: "installed" })] } },
  ledger: { rows: [{ pt: 2, weldReserved: 1, weldInstalled: 1, qty: 4 }, { pt: 7, reserved: 0, installed: 1, qty: 1 }], lines: [] } });
const TGT = () => ({ payload: { meta: { drawingNo: "D", rev: "1", lineNo: "L1" }, bom: [{ pt: 2, description: "FLANGE WN RF 300# A105 BW", diam: "4", qty: 3, qtyUnit: "pcs" }, { pt: 7, description: "VALVE GATE 600# BW", diam: "4", qty: 1, qtyUnit: "pcs" }],
  weldList: [R("1", { uid: b1, nps: "6" }), R("4", { uid: b4, loc: "Field" })],
  sheetMarkup: { items: [eqMark(eb, {})] } } });

test("1. nothing is matched without an explicit mapping: a unique printed number is only a CANDIDATE, never a match", () => {
  const r = diffRevisions({ from: SRC(), to: TGT(), mappings: [] });
  const w1 = find(r, (c) => c.fromUid === a1);
  equal(w1.kind, "candidate"); assert(w1.requiresReview && w1.action === "confirm");
  equal(find(r, (c) => c.cls === "weld" && c.fromUid === a2).kind, "removed", "«2» exists nowhere in the target");
  assert(find(r, (c) => c.kind === "added" && c.toUid === b4), "«4» is new");
});

test("2. a stored mapping pairs by uid even when the printed number changed; the number change is its own identity finding", () => {
  const r = diffRevisions({ from: SRC(), to: TGT(), mappings: [{ cls: "weld", fromUid: a3, toUid: b4 }] });
  const c = find(r, (x) => x.fromUid === a3 && x.category === "weld");
  assert(c.kind === "modified" && c.toUid === b4);
  assert(r.changes.some((x) => x.category === "identity" && x.fromNo === "3" && x.toNo === "4"));
  assert(!find(r, (x) => x.kind === "added" && x.toUid === b4), "no longer 'added'");
});

test("3. duplicate printed numbers are AMBIGUOUS and nothing is matched or offered as ready", () => {
  const f = SRC(), t = TGT();
  f.payload = { ...f.payload, weldList: undefined, sheetMarkup: { items: [{ id: "x1", uid: newUid(), kind: "weld-shop", no: "5", attrs: { c1: "2" } }, { id: "x2", uid: newUid(), kind: "weld-field", no: "5", attrs: {} }] } };
  t.payload = { ...t.payload, weldList: undefined, sheetMarkup: { items: [{ id: "y1", uid: newUid(), kind: "weld-shop", no: "5", attrs: {} }] } };
  const r = diffRevisions({ from: f, to: t, mappings: [] });
  const amb = r.changes.filter((c) => c.kind === "ambiguous");
  equal(amb.length, 1); assert(amb[0].requiresReview && amb[0].candidates.from.length === 2 && amb[0].candidates.to.length === 1);
  assert(!r.changes.some((c) => c.kind === "candidate" || (c.kind === "modified" && c.cls === "weld")));
});

test("4. geometry is never identity: same place, different number → added + removed; moved mark is a geometry change of a MAPPED pair only", () => {
  const f = { payload: { sheetMarkup: { items: [{ id: "a", uid: a1, kind: "weld-shop", no: "1", x: 0.2, y: 0.2 }] } } }, t = { payload: { sheetMarkup: { items: [{ id: "b", uid: b1, kind: "weld-shop", no: "9", x: 0.2, y: 0.2 }] } } };
  const r = diffRevisions({ from: f, to: t });
  equal(codes(r).sort(), ["added:weld", "removed:weld"]);
  const moved = diffRevisions({ from: { payload: { sheetMarkup: { items: [{ id: "a", uid: a1, kind: "weld-shop", no: "1", x: 0.2, y: 0.2 }] } } }, to: { payload: { sheetMarkup: { items: [{ id: "b", uid: b1, kind: "weld-shop", no: "1", x: 0.6, y: 0.7 }] } } }, mappings: [{ cls: "weld", fromUid: a1, toUid: b1 }] });
  assert(moved.changes.some((c) => c.category === "geometry"));
  assert(!moved.changes.some((c) => c.category === "geometry" && c.carry), "a position is never carried");
});

test("5. BOM: added / removed / description / quantity / unit / size / material / group; allocation impact of a removed or smaller PT", () => {
  const r = diffRevisions({ from: SRC(), to: TGT(), mappings: [] });
  const by = (pt) => r.changes.find((c) => c.id === `bom:${pt}`);
  equal(by(2).kind, "modified"); equal(by(2).fields.map((f) => f.field), ["qty"]);
  assert(by(2).deps.some((d) => /کمتر/.test(d)) === false, "3 ≥ the 2 held: no shortfall note");
  equal(by(7).fields.map((f) => f.field), ["description"]); assert(by(7).requiresReview);
  const gone = by(9); equal(gone.kind, "removed"); assert(gone.deps.some((d) => /تجهیز V-1/.test(d)) === false, "the target equipment does not use PT 9");
  const tiny = diffRevisions({ from: SRC(), to: { payload: { ...TGT().payload, bom: [{ pt: 2, description: "FLANGE WN RF 300# A105 BW", diam: "4", qty: 1, qtyUnit: "pcs" }] } } });
  assert(tiny.changes.find((c) => c.id === "bom:2").deps.some((d) => /کمتر/.test(d)), "smaller than the 2 held before: said, history untouched");
  const alloc = tiny.changes.filter((c) => c.category === "allocation");
  assert(alloc.length >= 1 && alloc.every((c) => /نه|فقط|منتقل|آزاد/.test(c.reason)), "allocation impact lists history as staying with the source");
  const m = diffRevisions({ from: { payload: { bom: [{ pt: 1, description: "A", qty: 1, qtyUnit: "m", diam: "2", material: "X", group: "G" }] } }, to: { payload: { bom: [{ pt: 1, description: "A", qty: 2, qtyUnit: "pcs", diam: "3", material: "Y", group: "H" }] } } });
  equal(m.changes.find((c) => c.id === "bom:1").fields.map((f) => f.field), ["qty", "qtyUnit", "diam", "material", "group"]);
  const nw = diffRevisions({ from: { payload: { bom: [{ pt: 3, description: "OLD" }] } }, to: { payload: { bom: [{ pt: 3, description: "NEW" }] } } });
  equal(nw.changes.find((c) => c.id === "bom:3").kind, "modified", "same PT number is NOT assumed to be the same part: the change is shown");
});

test("6. equipment: tag / type / PT / accessories / weld references compared; status is shown, never carried", () => {
  const t = TGT(); t.payload.sheetMarkup.items[0].attrs = { tag: "XV-2", type: "check", c1: "2", acc: "9×3", status: "planned" };
  const r = diffRevisions({ from: SRC(), to: t, mappings: [{ cls: "equipment", fromUid: ea, toUid: eb }] });
  const e = find(r, (c) => c.cls === "equipment" && c.category === "equipment");
  assert(["tag", "type", "c1", "acc", "status", "weldRefs"].every((f) => e.fields.some((x) => x.field === f)), JSON.stringify(e.fields.map((x) => x.field)));
  assert(!CARRY_FIELDS.equipment.includes("status") && !CARRY_FIELDS.weld.includes("no") && !CARRY_FIELDS.weld.includes("loc"));
});

test("7. carry plan: only fields the target lacks; PT only if in the target BOM; changed PT row needs a decision; links only through mappings", () => {
  const maps = [{ cls: "weld", fromUid: a1, toUid: b1 }, { cls: "equipment", fromUid: ea, toUid: eb }];
  const r = diffRevisions({ from: SRC(), to: TGT(), mappings: maps });
  const w = find(r, (c) => c.fromUid === a1 && c.category === "weld");
  equal(w.carry.ready.map((x) => `${x.field}:${x.state}`).sort(), ["c1:ready", "c2:needs_decision", "wps:ready"].sort());
  const e = find(r, (c) => c.fromUid === ea && c.category === "equipment");
  const rf = e.carry.ready.find((x) => x.field === "weldRefs");
  equal(rf.value, b1, "the weld link moves as the MAPPED target uid");
  equal(e.carry.ready.find((x) => x.field === "acc")?.value, undefined, "PT 9 is not in the target: accessories blocked");
  assert(e.carry.blocked.some((x) => x.field === "acc" && x.reason === "PT_NOT_IN_TARGET"));
  const noMap = find(diffRevisions({ from: SRC(), to: TGT(), mappings: [{ cls: "equipment", fromUid: ea, toUid: eb }] }), (c) => c.fromUid === ea && c.category === "equipment");
  assert(noMap.carry.blocked.some((x) => x.field === "weldRefs" && x.reason === "NO_MAPPED_WELD"), "no mapped weld → no link moved");
  const full = TGT(); full.payload.weldList[0].c1 = "7";
  const keep = find(diffRevisions({ from: SRC(), to: full, mappings: maps }), (c) => c.fromUid === a1 && c.category === "weld");
  assert(keep.carry.blocked.some((x) => x.field === "c1" && x.reason === "TARGET_HAS_VALUE") && !keep.carry.ready.some((x) => x.field === "c1"), "a value the target has is never overwritten");
});

test("8. applyCarry writes only into the copy, keeps the target's uids, and snapshots the PT row", () => {
  const t = TGT(), before = JSON.stringify(t.payload);
  const out = applyCarry(t.payload, [{ klass: "weld", toUid: b1, values: { c1: "2", wps: "W-1" } }]);
  equal(JSON.stringify(t.payload), before);
  const row = out.weldList.find((r) => r.uid === b1);
  equal([row.c1, row.wps, row.c1s], ["2", "W-1", "FLANGE WN RF 300# A105 BW | 4"]);
});

test("9. validation: lineage findings in the Phase 7 engine (no source, unconfirmed/ambiguous mapping, bad PT, history as demand, stale source, incomplete carry)", () => {
  const L = { hasParentColumn: false, parent: null, siblings: [{ revision: "0", older: true }], children: [], ops: [{ id: "o1", fromHash: "x" }], mappings: [{ cls: "weld", fromUid: a1, toUid: b1 }], parentHash: "y",
    pending: { candidates: [{ cls: "weld", fromUid: a2, toUid: b4, no: "4" }], ambiguous: [{ cls: "weld", no: "5" }], carryable: 2 }, histAsDemand: [{ pt: 2, ownerRef: a1, status: "reserved" }] };
  const payload = { bom: [{ pt: 2, description: "x", qty: 1 }], weldList: [R("1", { uid: b1, c1: "55" })] };
  const r = validate({ payload, revision: { documentId: "d", docNo: "D", rev: "1" }, saved: { equipment: [], ledger: { rows: [], lines: [] }, warnings: [], lineage: L }, source: "saved" });
  const cs = r.findings.map((f) => f.code);
  for (const c of ["REV_NO_SOURCE", "REV_UNRESOLVED_MAP", "REV_AMBIGUOUS_MAP", "REV_BAD_PT_MAP", "REV_HIST_DEMAND", "REV_STALE_SOURCE", "REV_INCOMPLETE_CARRY"]) assert(cs.includes(c), `${c} in ${cs}`);
  const bad = validate({ payload, revision: {}, saved: { equipment: [], ledger: { rows: [], lines: [] }, warnings: [], lineage: { ...L, hasParentColumn: true, children: [{ revision: "2" }, { revision: "3" }] } }, source: "saved" }).findings.map((f) => f.code);
  assert(bad.includes("REV_BAD_LINEAGE") && bad.includes("REV_DUP_RELATION"));
});

// ── the server ───────────────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("rev-db-");
process.env.STORAGE_ROOT = await scratchDir("rev-store-");
const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const runsRoute = await import("../../app/api/runs/route.js");
const runRoute = await import("../../app/api/runs/[id]/route.js");
const approveRoute = await import("../../app/api/runs/[id]/approve/route.js");
const allocRoute = await import("../../app/api/bom-allocations/route.js");
const revRoute = await import("../../app/api/revisions/route.js");
const carryRoute = await import("../../app/api/revisions/carry/route.js");
const validationRoute = await import("../../app/api/validation/route.js");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const { addMember, ensureUser } = await import("../../lib/db/repos/projects.mjs");
const { DEMO } = await import("../../lib/demo.js");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) => new Request(url, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const db = await getDb();
const mkProject = async (code, as = "kc|alice") => (await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", as, body: { code, name: code } })))).body.project.id;
const projectId = await mkProject("REV");
const q = (sql, p = []) => withProject(db, projectId, async () => (await db.query(sql, p)).rows);
let seq = 0;
const newDoc = async (docNo, revision = "0") => (await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST", body: { projectId, docNo, revision, fileBase64: Buffer.from(`scan ${docNo} ${revision} ${++seq}`).toString("base64") } })))).body.document.id;
const typed = (rows, items = [], bom = BOM_A, extra = {}) => ({ meta: { drawingNo: "REV-1", sheet: "1/1", lineNo: "REV-L1", nps: 4 }, weldList: rows, bom, sheetMarkup: { page: 1, items }, ...extra });
const post = async (documentId, payload) => json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId, documentId, lineNo: "REV-L1", payload } })));
const getRun = async (id) => json(await runRoute.GET(req(`http://x/api/runs/${id}?projectId=${projectId}`), ctx(id)));
const latestPayload = async (doc) => (await q("SELECT payload, id FROM extraction_run WHERE document_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1", [doc]))[0];
const lineage = async (doc, as, pid = projectId) => json(await revRoute.GET(req(`http://x/api/revisions?projectId=${pid}&documentId=${doc}`, { as })));
const compare = async (from, to, as) => json(await revRoute.GET(req(`http://x/api/revisions?projectId=${projectId}&documentId=${from}&compareTo=${to}`, { as })));
const mkRev = async (source, revision, extra = {}, as) => json(await revRoute.POST(req("http://x/api/revisions", { method: "POST", as, body: { projectId, action: "create", sourceDocumentId: source, revision, noFile: true, ...extra } })));
const carry = async (body, as) => json(await carryRoute.POST(req("http://x/api/revisions/carry", { method: "POST", as, body: { projectId, ...body } })));
const counts = async (doc) => ({ events: (await q("SELECT count(*)::int AS n FROM bom_allocation_event WHERE document_id = $1", [doc]))[0].n, lines: (await q("SELECT id, status, qty, owner_ref FROM bom_allocation WHERE document_id = $1 ORDER BY id", [doc])), equip: await q("SELECT mark_id, status FROM iso_equipment WHERE document_id = $1 ORDER BY mark_id", [doc]), ops: (await q("SELECT count(*)::int AS n FROM revision_carry_op WHERE to_document_id = $1", [doc]))[0].n, maps: (await q("SELECT count(*)::int AS n FROM revision_carry_map WHERE to_document_id = $1", [doc]))[0].n });
const snap = async (doc) => ({ payload: JSON.stringify((await latestPayload(doc)).payload), ...(await counts(doc)), welds: await q("SELECT weld_uid, weld_no FROM weld WHERE document_id = $1 ORDER BY weld_no", [doc]) });

// Revision A: three welds (1 reserves PT 2 and PT 7), an installed equipment with a weld link and an accessory; an install on the ledger
const A = { doc: null, run: null, w1: newUid(), w2: newUid(), w3: newUid(), eq: newUid() };
let B;

test("S1. revision A is saved with welds, BOM, an equipment and an INSTALLED allocation (the history B must never touch)", async () => {
  A.doc = await newDoc("REV-X");
  const r = await post(A.doc, typed([R("1", { uid: A.w1, c1: "2", c2: "7", wps: "W-1" }), R("2", { uid: A.w2 }), R("3", { uid: A.w3 })], [eqMark(A.eq, { tag: "XV-1", type: "valve", c1: "7", acc: "9×2", weldRefs: A.w1, status: "planned" })]));
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300)); A.run = r.body.run.id;
  const line = (await q("SELECT id FROM bom_allocation WHERE document_id = $1 AND pt = 2 AND status = 'reserved'", [A.doc]))[0];
  equal((await json(await allocRoute.POST(req("http://x/api/bom-allocations", { method: "POST", body: { projectId, documentId: A.doc, allocationId: line.id, action: "install", reason: "site" } })))).status, 200);
});

test("S2. create revision B from A: its own document, linked to A, A's data untouched; the same request again changes nothing", async () => {
  const before = await snap(A.doc);
  const r = await mkRev(A.doc, "1", { changeNote: "ISO re-issued: flange class changed" });
  equal(r.status, 201, JSON.stringify(r.body)); B = { doc: r.body.document.id };
  equal([r.body.document.parent_document_id, r.body.document.change_note], [A.doc, "ISO re-issued: flange class changed"]);
  equal(await snap(A.doc), before, "A exactly as it was");
  const again = await mkRev(A.doc, "1");
  equal(again.status, 200, JSON.stringify(again.body)); equal(again.body.document.id, B.doc);
  const l = await lineage(B.doc);
  equal(l.body.chain.map((c) => [c.revision, c.parentDocumentId === null ? null : "p", c.status]), [["0", null, "extracted"], ["1", "p", "no-run"]]);
  assert(l.body.chain[1].changeNote && l.body.chain[1].createdBy !== undefined);
});

test("S3. lineage rules: one successor per source, no self/foreign/cross-project source, parent is write-once (also in the database)", async () => {
  const dup = await mkRev(A.doc, "2"); equal(dup.status, 409); equal(dup.body.code, "SOURCE_HAS_SUCCESSOR");
  const other = await newDoc("REV-OTHER");
  const link = (documentId, parentDocumentId, as, pid = projectId) => json(revRoute.POST(req("http://x/api/revisions", { method: "POST", as, body: { projectId: pid, action: "link", documentId, parentDocumentId } })).then((x) => x));
  const foreign = await json(await revRoute.POST(req("http://x/api/revisions", { method: "POST", body: { projectId, action: "link", documentId: B.doc, parentDocumentId: other } })));
  equal(foreign.status, 409); equal(foreign.body.code, "INVALID_LINEAGE");
  const self = await json(await revRoute.POST(req("http://x/api/revisions", { method: "POST", body: { projectId, action: "link", documentId: B.doc, parentDocumentId: B.doc } })));
  equal(self.status, 400);
  const c = await newDoc("REV-X", "2");
  const cyc = await json(await revRoute.POST(req("http://x/api/revisions", { method: "POST", body: { projectId, action: "link", documentId: A.doc, parentDocumentId: B.doc } })));
  assert(cyc.status === 409, JSON.stringify(cyc.body));
  const ok = await json(await revRoute.POST(req("http://x/api/revisions", { method: "POST", body: { projectId, action: "link", documentId: c, parentDocumentId: B.doc, changeNote: "r2" } })));
  equal(ok.status, 200, JSON.stringify(ok.body));
  const reLink = await json(await revRoute.POST(req("http://x/api/revisions", { method: "POST", body: { projectId, action: "link", documentId: c, parentDocumentId: A.doc } })));
  equal(reLink.status, 409);
  let refused = false;
  try { await q("UPDATE document SET parent_document_id = NULL WHERE id = $1", [c]); } catch { refused = true; }
  assert(refused, "the database refuses to change a parent once set");
  const stranger = await mkProject("ZZZ", "kc|zed");
  equal((await lineage(B.doc, "kc|zed")).status, 404, "a non-member");
  equal((await lineage(B.doc, "kc|alice", stranger)).status, 404, "another project does not see this revision");
  const v = await ensureUser(db, { subject: "kc|viewer-rev" }); await addMember(db, { projectId, userId: v.id, role: "viewer" });
  equal((await lineage(B.doc, "kc|viewer-rev")).status, 200);
  equal((await mkRev(A.doc, "9", {}, "kc|viewer-rev")).status, 403, "a viewer may not create a revision");
});

test("S4. B's own register (new uids, one weld renumbered, a PT changed/removed); the comparison finds identity ONLY by candidate until confirmed", async () => {
  B.w1 = newUid(); B.w4 = newUid(); B.eq = newUid();
  const bomB = [{ pt: 2, description: "FLANGE WN RF 300# A105 BW", diam: "4", qty: 3, qtyUnit: "pcs" }, { pt: 7, description: "VALVE GATE 600# BW", diam: "4", qty: 1, qtyUnit: "pcs" }];
  const r = await post(B.doc, typed([R("1", { uid: B.w1, nps: "6" }), R("4", { uid: B.w4, loc: "Field" })], [eqMark(B.eq, {})], bomB));
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300)); B.run = r.body.run.id;
  const c = await compare(A.doc, B.doc);
  equal(c.status, 200, JSON.stringify(c.body).slice(0, 300));
  equal(c.body.linked, true); equal(c.body.mappings, []);
  const kinds = c.body.changes.filter((x) => x.category === "weld").map((x) => x.kind).sort();
  equal(kinds, ["added", "candidate", "removed", "removed"].sort());
  assert(c.body.changes.find((x) => x.id === "bom:9").kind === "removed" && c.body.changes.some((x) => x.category === "allocation"));
  A.hash = c.body.from.hash; B.hash = c.body.to.hash;
  equal((await carry({ fromDocumentId: A.doc, toDocumentId: B.doc, fromHash: A.hash, toHash: B.hash, requestKey: "no-mapping-yet", decisions: [{ key: `weld:${A.w1}`, fields: ["c1"] }] })).status, 409, "no mapping → nothing moves");
});

test("S5. a decision that is not allowed fails the WHOLE request and leaves nothing half done (rollback)", async () => {
  const beforeA = await snap(A.doc), beforeB = await snap(B.doc);
  const bad = await carry({ fromDocumentId: A.doc, toDocumentId: B.doc, fromHash: A.hash, toHash: B.hash, requestKey: "rollback-1234",
    decisions: [{ key: `weld:${A.w1}`, pair: { fromUid: A.w1, toUid: B.w1 }, fields: ["c1", "wps"] }, { key: `equipment:${A.eq}`, fields: ["status"] }] });
  equal(bad.status, 409, JSON.stringify(bad.body)); assert(["FIELD_NOT_CARRYABLE", "NOT_CARRYABLE"].includes(bad.body.code), bad.body.code);
  equal(await snap(B.doc), beforeB, "B unchanged: no mapping, no op, no payload change");
  equal(await snap(A.doc), beforeA);
  const wrongPair = await carry({ fromDocumentId: A.doc, toDocumentId: B.doc, fromHash: A.hash, toHash: B.hash, requestKey: "wrongpair-123", decisions: [{ key: `weld:${A.w1}`, pair: { fromUid: A.w1, toUid: B.w4 } }] });
  equal(wrongPair.status, 409); equal(wrongPair.body.code, "INVALID_MAPPING");
});

test("S6. controlled carry: confirmed weld pair + chosen fields move into B's EMPTY fields only; installed/tested state, allocations and history do not", async () => {
  const beforeA = await snap(A.doc), beforeEvents = (await counts(B.doc)).events;
  const r = await carry({ fromDocumentId: A.doc, toDocumentId: B.doc, fromHash: A.hash, toHash: B.hash, requestKey: "carry-ok-0001",
    decisions: [{ key: `weld:${A.w1}`, pair: { fromUid: A.w1, toUid: B.w1 }, fields: ["c1", "wps"] }] });
  equal(r.status, 200, JSON.stringify(r.body).slice(0, 400));
  equal(r.body.op.summary.fields, 2); equal(r.body.repeated, false);
  const p = (await latestPayload(B.doc)).payload, row = p.weldList.find((x) => x.uid === B.w1);
  equal([row.c1, row.wps, row.c2 ?? "", row.nps], ["2", "W-1", "", "6"], "c1 and wps carried; c2 (not chosen) and B's own nps untouched");
  equal(row.uid, B.w1, "B's identity is its own");
  equal((await q("SELECT from_uid, to_uid FROM revision_carry_map WHERE to_document_id = $1", [B.doc])).map((m) => [m.from_uid, m.to_uid]), [[A.w1, B.w1]]);
  equal(await snap(A.doc), beforeA, "A (payload, ledger lines, events, equipment status, register) exactly as before");
  const lines = await q("SELECT owner_ref, status FROM bom_allocation WHERE document_id = $1", [B.doc]);
  assert(lines.every((l) => l.owner_ref !== A.w1 && l.owner_ref !== A.w2), "no A uid is a demand of B");
  assert(lines.some((l) => l.owner_ref === B.w1 && l.status === "reserved"), "B has its OWN reservation (made from B's own weld)");
  assert((await counts(B.doc)).events > beforeEvents, "B's own reserve events");
  equal((await q("SELECT count(*)::int AS n FROM bom_allocation WHERE document_id = $1 AND status = 'installed'", [A.doc]))[0].n, 1, "A's installed line stays installed");
  B.hash = r.body.payloadHash;
});

test("S7. the same request again is idempotent: the recorded result, no second op, no duplicate events or lines", async () => {
  const before = await snap(B.doc);
  const r = await carry({ fromDocumentId: A.doc, toDocumentId: B.doc, fromHash: A.hash, toHash: "irrelevant-now", requestKey: "carry-ok-0001", decisions: [{ key: `weld:${A.w1}`, pair: { fromUid: A.w1, toUid: B.w1 }, fields: ["c1", "wps"] }] });
  equal(r.status, 200); equal(r.body.repeated, true);
  equal(await snap(B.doc), before);
});

test("S8. stale: a changed target or source since the comparison is refused (STALE_RUN / STALE_SOURCE) and nothing is written", async () => {
  const before = await snap(B.doc);
  const stale = await carry({ fromDocumentId: A.doc, toDocumentId: B.doc, fromHash: A.hash, toHash: "0".repeat(32), requestKey: "stale-target-1", decisions: [{ key: `weld:${A.w1}`, fields: ["spool"] }] });
  equal(stale.status, 409); equal(stale.body.code, "STALE_RUN");
  const staleSrc = await carry({ fromDocumentId: A.doc, toDocumentId: B.doc, fromHash: "0".repeat(32), toHash: B.hash, requestKey: "stale-source-1", decisions: [{ key: `weld:${A.w1}`, fields: ["spool"] }] });
  equal(staleSrc.status, 409); equal(staleSrc.body.code, "STALE_SOURCE");
  equal(await snap(B.doc), before);
});

test("S9. equipment: its weld link moves only as the MAPPED weld; accessories whose PT is not in B and a status do not move; installed state of A stays", async () => {
  const c = await compare(A.doc, B.doc); B.hash = c.body.to.hash; A.hash = c.body.from.hash;
  const e = c.body.changes.find((x) => x.cls === "equipment" && x.category === "equipment");
  equal(e.kind, "candidate");
  const eqBlocked = e.carry.blocked.map((x) => `${x.field}:${x.reason}`);
  assert(eqBlocked.includes("acc:PT_NOT_IN_TARGET"), eqBlocked.join());
  const r = await carry({ fromDocumentId: A.doc, toDocumentId: B.doc, fromHash: A.hash, toHash: B.hash, requestKey: "carry-equip-01",
    decisions: [{ key: e.id, pair: { fromUid: A.eq, toUid: B.eq }, fields: ["tag", "type", "c1", "weldRefs"] }] });
  equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const item = (await latestPayload(B.doc)).payload.sheetMarkup.items.find((m) => m.uid === B.eq);
  equal([item.attrs.tag, item.attrs.type, item.attrs.c1, item.attrs.weldRefs, item.attrs.acc ?? "", item.attrs.status ?? ""], ["XV-1", "valve", "7", B.w1, "", ""]);
  equal((await q("SELECT status FROM iso_equipment WHERE document_id = $1", [B.doc])).map((x) => x.status), ["planned"], "B's equipment starts planned: A's state is not inherited");
  const links = await q("SELECT w.weld_ref FROM iso_equipment_weld w JOIN iso_equipment e ON e.id = w.equipment_id WHERE e.document_id = $1", [B.doc]);
  equal(links.map((l) => l.weld_ref), [B.w1], "the saved link is B's weld, by uid");
  const asked = await carry({ fromDocumentId: A.doc, toDocumentId: B.doc, fromHash: A.hash, toHash: r.body.payloadHash, requestKey: "carry-status-01", decisions: [{ key: e.id, fields: ["status"] }] });
  equal(asked.status, 409); equal(asked.body.code, "FIELD_NOT_CARRYABLE");
});

test("S10. an invalid PT: a field whose PT is not in B's BOM is refused with the reason; a changed row needs the person's explicit choice", async () => {
  const c = await compare(A.doc, B.doc);
  const w = c.body.changes.find((x) => x.fromUid === A.w1 && x.category === "weld");
  assert(w.carry.ready.some((x) => x.field === "c2" && x.state === "needs_decision"), JSON.stringify(w.carry));
  const noPt = c.body.changes.find((x) => x.cls === "equipment" && x.category === "equipment");
  const refused = await carry({ fromDocumentId: A.doc, toDocumentId: B.doc, fromHash: c.body.from.hash, toHash: c.body.to.hash, requestKey: "carry-badpt-01", decisions: [{ key: noPt.id, fields: ["acc"] }] });
  equal(refused.status, 409); equal(refused.body.code, "FIELD_NOT_READY");
});

test("S11. an ambiguous item is never matched by itself; settling it is the person's explicit, validated choice", async () => {
  const docA = await newDoc("REV-AMB"), docB = (await mkRev(docA, "1")).body.document.id;
  const marks = (ids) => ids.map(([uid, kind, no, c1]) => ({ id: `${no}${kind}`, uid, kind, no, x: 0.3, y: 0.3, src: "hand", attrs: c1 ? { c1 } : {} }));
  const [x1, x2, y1, y2] = Array.from({ length: 4 }, newUid);
  const base = () => { const p = JSON.parse(JSON.stringify(DEMO)); delete p.bom; return p; };
  equal((await post(docA, { ...base(), bom: BOM_A, sheetMarkup: { page: 1, items: marks([[x1, "weld-shop", "5", "2"], [x2, "weld-field", "5"]]) } })).status, 201);
  equal((await post(docB, { ...base(), bom: BOM_A, sheetMarkup: { page: 1, items: marks([[y1, "weld-shop", "5"], [y2, "weld-field", "5"]]) } })).status, 201);
  const c = await compare(docA, docB);
  const amb = c.body.changes.filter((x) => x.kind === "ambiguous");
  equal(amb.length, 1, JSON.stringify(c.body.changes.map((x) => x.kind + x.id)));
  assert(!c.body.changes.some((x) => x.kind === "candidate"));
  const refused = await carry({ fromDocumentId: docA, toDocumentId: docB, fromHash: c.body.from.hash, toHash: c.body.to.hash, requestKey: "amb-unsettled-1", decisions: [{ key: amb[0].id }] });
  equal(refused.status, 409, "left unsettled: nothing to do");
  const outside = await carry({ fromDocumentId: docA, toDocumentId: docB, fromHash: c.body.from.hash, toHash: c.body.to.hash, requestKey: "amb-outside-01", decisions: [{ key: amb[0].id, pair: { fromUid: x1, toUid: newUid() } }] });
  equal(outside.status, 409); equal(outside.body.code, "INVALID_MAPPING");
  const ok = await carry({ fromDocumentId: docA, toDocumentId: docB, fromHash: c.body.from.hash, toHash: c.body.to.hash, requestKey: "amb-settled-01", decisions: [{ key: amb[0].id, pair: { fromUid: x1, toUid: y1 }, fields: [] }] });
  equal(ok.status, 200, JSON.stringify(ok.body)); equal(ok.body.mapped.length, 1);
  const c2 = await compare(docA, docB);
  assert(c2.body.mappings.length === 1 && c2.body.mappings[0].toUid === y1);
  const again = await carry({ fromDocumentId: docA, toDocumentId: docB, fromHash: c2.body.from.hash, toHash: c2.body.to.hash, requestKey: "amb-twice-0001", decisions: [{ key: c2.body.changes.find((x) => x.kind === "ambiguous")?.id || "x", pair: { fromUid: x1, toUid: y2 } }] });
  assert(again.status === 409, "x1 is already mapped: it cannot map twice");
});

test("S12. validation (saved, server) knows the lineage: unconfirmed mappings and incomplete carry are findings, not silence", async () => {
  const v = await json(await validationRoute.GET(req(`http://x/api/validation?projectId=${projectId}&documentId=${B.doc}`)));
  equal(v.status, 200, JSON.stringify(v.body).slice(0, 300));
  const cs = v.body.findings.map((f) => f.code);
  assert(cs.includes("REV_INCOMPLETE_CARRY") && !cs.includes("REV_NO_SOURCE") && !cs.includes("REV_BAD_LINEAGE"), cs.join());
  const stale = await json(await validationRoute.GET(req(`http://x/api/validation?projectId=${projectId}&documentId=${A.doc}`)));
  assert(!stale.body.findings.some((f) => f.code === "REV_HIST_DEMAND"), "no historical allocation is treated as demand");
});

test("S13. an approved target is locked: carry-forward is refused (RUN_LOCKED); an approved SOURCE stays locked and a revision can still be made from it", async () => {
  const docC = await newDoc("REV-LOCK"), docD = (await mkRev(docC, "1")).body.document.id;
  const u1 = newUid(), u2 = newUid();
  const rc = await post(docC, typed([R("1", { uid: u1, c1: "2" })], [], BOM_A));
  equal(rc.status, 201);
  equal((await post(docD, typed([R("1", { uid: u2 })], [], BOM_A))).status, 201);
  const c = await compare(docC, docD);
  const ap = await json(await approveRoute.POST(req(`http://x/api/runs/${(await latestPayload(docD)).id}/approve`, { method: "POST", body: { projectId } }), ctx((await latestPayload(docD)).id)));
  equal(ap.status, 200);
  const locked = await carry({ fromDocumentId: docC, toDocumentId: docD, fromHash: c.body.from.hash, toHash: c.body.to.hash, requestKey: "locked-target-1", decisions: [{ key: `weld:${u1}`, pair: { fromUid: u1, toUid: u2 }, fields: ["c1"] }] });
  equal(locked.status, 409); equal(locked.body.code, "RUN_LOCKED");
  assert((await compare(docC, docD)).body.to.locked === true);
  const apC = await json(await approveRoute.POST(req(`http://x/api/runs/${(await latestPayload(docC)).id}/approve`, { method: "POST", body: { projectId } }), ctx((await latestPayload(docC)).id)));
  equal(apC.status, 200);
  const edit = await post(docC, typed([R("1", { uid: u1 })], [], BOM_A));
  equal(edit.status, 409); equal(edit.body.code, "REVISION_ALREADY_APPROVED");
  const chain = (await lineage(docD)).body.chain;
  equal(chain.map((x) => x.status), ["approved", "approved"]);
});

test("S14. the comparison is read-only: asking changes nothing; permission and ownership are checked", async () => {
  const before = [await snap(A.doc), await snap(B.doc)];
  await compare(A.doc, B.doc); await compare(B.doc, A.doc);
  equal([await snap(A.doc), await snap(B.doc)], before);
  equal((await compare(A.doc, B.doc, "kc|zed")).status, 404);
  const viewer = await carry({ fromDocumentId: A.doc, toDocumentId: B.doc, fromHash: "x", toHash: "y", requestKey: "viewer-denied-1", decisions: [] }, "kc|viewer-rev");
  equal(viewer.status, 403);
  const other = await newDoc("REV-NOT-RELATED");
  assert((await compare(A.doc, other)).status === 409, "two different drawings cannot be compared");
  const notLinked = await carry({ fromDocumentId: other, toDocumentId: B.doc, fromHash: "x", toHash: "y", requestKey: "not-linked-0001", decisions: [] });
  assert(notLinked.status === 409);
  const c2 = (await q("SELECT id FROM document WHERE doc_no = 'REV-X' AND revision = '2'"))[0].id;
  const skip = await carry({ fromDocumentId: A.doc, toDocumentId: c2, fromHash: "x", toHash: "y", requestKey: "skip-a-level-01", decisions: [] });
  equal(skip.status, 409); equal(skip.body.code, "INVALID_LINEAGE", "carry goes from a revision to the one made from it, not across the chain");
});

await run();
