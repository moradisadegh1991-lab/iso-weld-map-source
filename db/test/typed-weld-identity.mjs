#!/usr/bin/env node
/**
 * Phase 4 — persistent identity for typed weld lists (docs/audit/phase-4-typed-weld-identity.md).
 *
 * A typed weld row has a persistent uid (the identity of its mark, in the Phase 2 registry); the printed number is a display attribute
 * and the form's `_id` never leaves the page. The uid survives save, reload, edit, renumber, move and correction; a copy is a new
 * identity; a deleted row's identity goes to nobody; legacy payloads (no uid, number-keyed places) still read; the server never lends an
 * identity on a guess and never carries one across a drawing revision.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
import { isUid, newUid } from "../../lib/sheet/mark-identity.mjs";
import { addMark, updateMark, placeAt, removeMark, duplicateMark, normalize, findMark, markRef } from "../../lib/sheet/markup.mjs";
import { itemsFromWeldRows, weldRowsFromItems, withRowIds, registerRow, rowTyped, adoptLegacyPlacement, legacyMarks, extraMarks } from "../../lib/sheet/weld-list-marks.mjs";
import { weldRowMarks, applyWeldIdentity } from "../../lib/sheet/weld-list-identity.mjs";

const R = (no, extra = {}) => ({ no, spool: "SP-1", loc: "Shop", kind: "BW", nps: "4", ...extra });
const rowsOf = (...nos) => withRowIds(nos.map((n) => R(n)));
const asItems = (rows, marks = {}, extras = [], byUid = {}) => normalize(itemsFromWeldRows(rows, marks, extras, byUid));

// ── the list functions ───────────────────────────────────────────────────

test("1. a new typed row has a persistent uid; the form's _id is not it", () => {
  const rows = rowsOf("1", "2");
  for (const r of rows) { assert(isUid(r.uid), "uid"); assert(r._id && r._id !== r.uid, "the UI key is a different thing"); }
  assert(rows[0].uid !== rows[1].uid);
  equal(withRowIds(rows).map((r) => r.uid), rows.map((r) => r.uid), "a row that has one keeps it");
});

test("2. the uid survives registerRow and serialization; _id does not", () => {
  const rows = rowsOf("1");
  const sent = JSON.parse(JSON.stringify(registerRow(rows[0])));
  equal(sent.uid, rows[0].uid);
  assert(!("_id" in sent), "the temporary key is never persisted");
  equal(withRowIds([sent])[0].uid, rows[0].uid, "reading it back keeps the identity");
  equal(withRowIds([{ ...sent, uid: "nope" }])[0].uid !== "nope", true, "a malformed uid is replaced, never kept");
  const dup = withRowIds([sent, { ...sent }]);
  assert(dup[0].uid !== dup[1].uid, "two rows never share an identity");
});

test("4,6. renumbering and editing keep the uid and the place on the drawing", () => {
  const rows = rowsOf("1", "2");
  const byUid = { [rows[0].uid]: { x: 0.2, y: 0.3, ax: 0.25, ay: 0.35, src: "hand" } };
  let items = asItems(rows, {}, [], byUid);
  equal(findMark(items, rows[0].uid).x, 0.2);
  items = updateMark(items, rows[0].uid, { no: "77", attrs: { size: "6", type: "SW", spool: "SP-1" } });
  const back = weldRowsFromItems(items, rows);
  equal(back.rows[0].uid, rows[0].uid); equal(back.rows[0].no, "77"); equal(back.rows[0].nps, "6");
  equal(back.byUid[rows[0].uid], { x: 0.2, y: 0.3, ax: 0.25, ay: 0.35, src: "hand" }, "the place stayed with the identity");
  // …and reading it again puts the renumbered weld where it was
  equal(findMark(asItems(back.rows, back.marks, [], back.byUid), rows[0].uid).x, 0.2);
});

test("5. moving keeps the uid; only the place changes", () => {
  const rows = rowsOf("1");
  let items = asItems(rows, {}, [], { [rows[0].uid]: { x: 0.2, y: 0.2, src: "hand" } });
  items = placeAt(items, rows[0].uid, { x: 0.7, y: 0.6 });
  const back = weldRowsFromItems(items, rows);
  equal(back.rows[0].uid, rows[0].uid);
  assert(back.byUid[rows[0].uid].x !== 0.2 && back.byUid[rows[0].uid].x <= 1, "moved, still a 0..1 fraction of the sheet");
});

test("7. a duplicate is a different identity with independent attributes; the original is untouched", () => {
  const rows = rowsOf("1");
  const items = asItems(rows, {}, [], { [rows[0].uid]: { x: 0.2, y: 0.2, src: "hand" } });
  const { items: next, key } = duplicateMark(items, rows[0].uid);
  const back = weldRowsFromItems(next, rows);
  equal(back.rows.length, 2);
  assert(isUid(back.rows[1].uid) && back.rows[1].uid !== rows[0].uid, "new identity");
  equal(back.rows[0].uid, rows[0].uid);
  assert(back.rows[1].no !== back.rows[0].no, "a copy takes its own number");
  equal(back.rows[1].nps, "4"); equal(back.rows[1].spool, "SP-1");
  equal(key, back.rows[1].uid);
});

test("8. deleting a weld transfers its identity to nobody", () => {
  const rows = rowsOf("1", "2");
  let items = asItems(rows);
  items = removeMark(items, rows[0].uid);
  const added = weldRowsFromItems(addMark(items, { kind: "weld-shop", no: "1" }), rows);
  assert(!added.rows.some((r) => r.uid === rows[0].uid), "the deleted row's uid is gone — the weld that reuses its number is another weld");
  equal(added.rows.filter((r) => r.no === "1").length, 1);
  assert(added.rows.find((r) => r.no === "1").uid !== rows[0].uid);
});

test("9. two welds with the same printed number stay distinct; a shared number is never resolved from the legacy map", () => {
  const rows = rowsOf("5", "5");
  const byUid = { [rows[0].uid]: { x: 0.1, y: 0.1, src: "hand" }, [rows[1].uid]: { x: 0.8, y: 0.8, src: "hand" } };
  const items = asItems(rows, { 5: { x: 0.5, y: 0.5 } }, [], byUid);
  equal(items.map((m) => m.uid), rows.map((r) => r.uid));
  equal(items.map((m) => m.x), [0.1, 0.8], "each at its own place");
  // without identity-keyed places, a number two rows share places neither (not guessed)
  const bare = asItems(rows, { 5: { x: 0.5, y: 0.5 } }, [], {});
  equal(bare.map((m) => m.x), [undefined, undefined]);
  equal(legacyMarks(rows, byUid), {}, "the legacy number-keyed form is written only for unique numbers");
  equal(Object.keys(legacyMarks(rowsOf("5", "6"), {})).length, 0);
});

test("10,11. a legacy payload (no uid, places by number) reads; its places are adopted under the rows' identities", () => {
  const legacyRows = [R("1"), R("2")];                       // as saved before this phase: no uid, no _id
  const rows = withRowIds(legacyRows);
  const marks = { 1: { x: 0.3, y: 0.4, src: "model" }, 2: { x: 0.6, y: 0.2, ax: 0.62, ay: 0.22 } };
  const items = asItems(rows, marks);
  equal(items.map((m) => m.x), [0.3, 0.6], "read through the fallback with no byUid");
  const by = adoptLegacyPlacement(rows, marks, {});
  equal(by[rows[0].uid], { x: 0.3, y: 0.4, src: "model" }); equal(by[rows[1].uid].ax, 0.62);
  equal(adoptLegacyPlacement(rows, marks, { [rows[0].uid]: { x: 0.9, y: 0.9 } })[rows[0].uid].x, 0.9, "a place of its own wins over the legacy one");
  const dupRows = withRowIds([R("1"), R("1")]);
  equal(Object.keys(adoptLegacyPlacement(dupRows, { 1: { x: 0.3, y: 0.4 } }, {})).length, 0, "a duplicated number is not adopted");
  equal(rowTyped({}), false);
});

test("equipment (and its identity) is brought back beside the rows, not dropped", () => {
  const eq = { id: "m9", uid: newUid(), kind: "equipment", no: "V-1", x: 0.5, y: 0.5, attrs: { tag: "T" } };
  const kept = extraMarks(normalize([eq, { id: "m1", kind: "weld-shop", no: "1" }, { id: "m2", kind: "spool", no: "SP-1" }]));
  equal(kept.map((m) => m.kind).sort(), ["equipment", "spool"]);
  equal(kept.find((m) => m.kind === "equipment").uid, eq.uid);
});

test("the server's view of rows: a row without a valid uid is a mark without one; the settled uids come back by position", () => {
  const rows = [{ ...R("1"), uid: newUid() }, R("2"), { ...R("3"), uid: "bad" }];
  const marks = weldRowMarks(rows);
  equal(marks.map((m) => "uid" in m), [true, false, false]);
  equal(marks.map((m) => m.kind), ["weld-shop", "weld-shop", "weld-shop"]);
  const settled = marks.map((m, i) => ({ ...m, uid: m.uid || `new-${i}` }));
  const out = applyWeldIdentity({ weldList: rows }, settled);
  equal(out.weldList.map((r) => r.uid), [rows[0].uid, "new-1", "new-2"]);
});

test("a place follows a uid the server had to replace — once, and never onto another row's", () => {
  const u = newUid();
  const rows = [{ ...R("1"), uid: u }, { ...R("2"), uid: u }];                    // a pasted copy carrying a used uid
  const byUid = { [u]: { x: 0.1, y: 0.1 } };
  const out = applyWeldIdentity({ weldList: rows, weldMarkup: { marks: {}, byUid } }, [{ uid: u }, { uid: "fresh" }]);
  equal(Object.keys(out.weldMarkup.byUid), [u], "the first holder keeps it; the copy is not given the original's place");
  const moved = applyWeldIdentity({ weldList: [{ ...R("1"), uid: "old" }], weldMarkup: { byUid: { old: { x: 0.4, y: 0.4 } } } }, [{ uid: "new" }]);
  equal(moved.weldMarkup.byUid, { new: { x: 0.4, y: 0.4 } }, "a replaced uid's place moves with it");
});

// ── the server ───────────────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("twid-db-");
process.env.STORAGE_ROOT = await scratchDir("twid-store-");
const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const runsRoute = await import("../../app/api/runs/route.js");
const editsRoute = await import("../../app/api/runs/[id]/edits/route.js");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) =>
  new Request(url, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const db = await getDb();
const pr = await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", body: { code: "TWI", name: "T" } })));
if (!pr.body.project) console.log(JSON.stringify(pr));
const projectId = pr.body.project.id;
const q = (sql, p = []) => withProject(db, projectId, async () => (await db.query(sql, p)).rows);
let seq = 0;
const newDoc = async (docNo, revision = "0") => (await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST",
  body: { projectId, docNo, revision, fileBase64: Buffer.from(`scan ${docNo} ${revision} ${++seq}`).toString("base64") } })))).body.document.id;
const payload = (rows, extra = {}) => ({ meta: { drawingNo: "TWI-1", sheet: "1/1", lineNo: "TWI-L1", nps: 4 }, weldList: rows, ...extra });
const post = async (documentId, rows, extra) => json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId, documentId, lineNo: "TWI-L1", payload: payload(rows, extra) } })));
const stored = async (runId) => (await q("SELECT payload FROM extraction_run WHERE id = $1", [runId]))[0].payload;
const registry = (d) => q("SELECT uid, cls, first_no FROM sheet_mark_identity WHERE document_id = $1 ORDER BY first_no", [d]);
const { payloadHash } = await import("../../lib/review/payload-hash.mjs");
const correct = async (runId, edited) => json(await editsRoute.POST(req(`http://x/api/runs/${runId}/edits`, { method: "POST", body: { projectId, payload: edited, reason: "t", baseHash: payloadHash(await stored(runId)) } }), ctx(runId)));
const U = { a: newUid(), b: newUid() };
let docA, run1;

test("3. save and reload: a row typed with its uid keeps it; the identities are registered to the drawing revision", async () => {
  docA = await newDoc("TWI-A");
  const r = await post(docA, [{ ...R("1"), uid: U.a }, { ...R("2"), uid: U.b }], { weldMarkup: { page: 1, marks: { 1: { x: 0.2, y: 0.2 } }, byUid: { [U.a]: { x: 0.2, y: 0.2, src: "hand" } } } });
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  run1 = r.body.run.id;
  const p = await stored(run1);
  equal(p.weldList.map((w) => w.uid), [U.a, U.b], "stored with its identities, in order");
  equal(p.weldMarkup.byUid[U.a].x, 0.2, "and the identity-keyed place");
  equal((await registry(docA)).map((x) => [x.uid, x.cls]).sort(), [[U.a, "weld"], [U.b, "weld"]].sort(), "registered as weld marks of this revision");
});

test("a legacy row (no uid) saved now is given one, and a second save of the same sheet keeps it", async () => {
  const docL = await newDoc("TWI-LEG");
  const first = await post(docL, [R("1"), R("2")]);
  equal(first.status, 201, JSON.stringify(first.body).slice(0, 300));
  const p1 = await stored(first.body.run.id);
  assert(p1.weldList.every((w) => isUid(w.uid)), "every row has an identity once saved");
  const second = await post(docL, p1.weldList);
  const p2 = await stored(second.body.run.id);
  equal(p2.weldList.map((w) => w.uid), p1.weldList.map((w) => w.uid), "save → reload → save keeps them");
  // an old client that sends rows without uid again is matched to the saved rows it reliably is (same number, compatible attributes)
  const third = await post(docL, [R("1"), R("2")]);
  equal((await stored(third.body.run.id)).weldList.map((w) => w.uid), p1.weldList.map((w) => w.uid), "uid-less rows take their own saved identity, unambiguously");
});

test("renumber, edit and move by correction keep the uid; a row gaining its identity is not logged as a correction", async () => {
  const p = await stored(run1);
  const edited = JSON.parse(JSON.stringify(p));
  edited.weldList[0].no = "10"; edited.weldList[0].nps = "6";
  edited.weldMarkup.byUid[U.a] = { x: 0.6, y: 0.6, src: "hand" };
  const r = await correct(run1, edited);
  equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const after = await stored(run1);
  equal(after.weldList.map((w) => [w.no, w.uid]), [["10", U.a], ["2", U.b]], "renumbered, same identity");
  equal(after.weldMarkup.byUid[U.a].x, 0.6, "moved, same identity");
  assert(!r.body.edits.some((e) => /\.uid$/.test(e.path) || /byUid/.test(e.path)), "identity bookkeeping is not an edit of what was read");
  const welds = await q("SELECT weld_no FROM weld WHERE extraction_run_id = $1 ORDER BY weld_no", [run1]);
  equal(welds.map((w) => w.weld_no), ["10", "2"], "the register was re-derived from the corrected list");
});

test("12. an incoming row that is not unambiguously a saved row does not borrow its identity", async () => {
  const docG = await newDoc("TWI-G");
  const a = await post(docG, [{ ...R("1"), uid: newUid() }]);
  const saved = (await stored(a.body.run.id)).weldList[0];
  // same number but a conflicting size: not the same weld on any evidence the engine accepts → a new identity, the old one retired
  const b = await post(docG, [R("1", { nps: "12" })]);
  const got = (await stored(b.body.run.id)).weldList[0];
  assert(isUid(got.uid) && got.uid !== saved.uid, "a new identity, never the saved row's");
});

test("13. revision boundary: another revision's identity is refused; its rows are new rows, not lineage", async () => {
  const docB = await newDoc("TWI-A", "1");
  const refused = await post(docB, [{ ...R("10"), uid: U.a }]);
  equal(refused.status, 409, JSON.stringify(refused.body).slice(0, 300));
  equal(refused.body.code, "MARK_UID_CONFLICT");
  equal((await q("SELECT count(*)::int AS n FROM extraction_run WHERE document_id = $1", [docB]))[0].n, 0, "nothing was saved");
  const ok = await post(docB, [R("10"), R("2")]);
  equal(ok.status, 201, JSON.stringify(ok.body).slice(0, 300));
  const rows = (await stored(ok.body.run.id)).weldList;
  assert(!rows.some((w) => w.uid === U.a || w.uid === U.b), "same numbers on a new revision are new identities — no lineage invented");
  equal((await registry(docA)).length, 2, "the first revision's registry is untouched");
});

test("14. equipment and allocation references stay with their own marks when welds are renumbered, deleted or added", async () => {
  const docE = await newDoc("TWI-E");
  const eq = { id: "m9", uid: newUid(), kind: "equipment", no: "V-1", x: 0.5, y: 0.5, src: "hand", attrs: { tag: "T-1", type: "valve", status: "planned" } };
  const wa = newUid(), wb = newUid();
  const r = await post(docE, [{ ...R("1"), uid: wa }, { ...R("2"), uid: wb }], { sheetMarkup: { page: 1, items: [eq] } });
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  const have = await q("SELECT mark_id, equipment_no FROM iso_equipment WHERE document_id = $1", [docE]);
  equal(have.map((e) => e.mark_id), [eq.uid]);
  // delete weld 1, add a new weld that takes its number, renumber weld 2
  // (the page gives a row it created its own identity; only a client that sends no identity at all is matched by number — test 12 and
  // "a legacy row" above)
  const fresh = newUid();
  const next = await post(docE, [{ ...R("1"), uid: fresh }, { ...R("20"), uid: wb }], { sheetMarkup: { page: 1, items: [eq] } });
  equal(next.status, 201, JSON.stringify(next.body).slice(0, 300));
  const rows = (await stored(next.body.run.id)).weldList;
  equal(rows[0].uid, fresh, "the new weld has its own identity"); assert(rows[0].uid !== wa, "the deleted weld's identity did not pass to the new weld with its number");
  equal(rows[1].uid, wb, "the renumbered weld is itself");
  equal((await q("SELECT mark_id, equipment_no FROM iso_equipment WHERE document_id = $1", [docE])).map((e) => e.mark_id), [eq.uid], "the equipment is the same row");
  equal((await q("SELECT count(*)::int AS n FROM bom_allocation WHERE document_id = $1 AND owner_ref = ANY($2)", [docE, [wa, wb, rows[0].uid]]))[0].n, 0, "no allocation refers to a typed weld, so none could move");
});

await run();
