import { payloadHash as correctionPayloadHash } from "../../lib/review/payload-hash.mjs";
#!/usr/bin/env node
/**
 * Stable mark identity (Phase 2, migration 105; lib/sheet/mark-identity.mjs).
 *
 * A mark's persistent identity (`uid`) survives moving, editing, renumbering, normalising, serialising, re-extraction and
 * correction; a copy is a new mark; equipment, accessories and allocations follow the identity, not the list handle ("m3") that a
 * re-extraction hands out again; an ambiguity never lends an identity and never puts an installed record at risk; a revision's marks
 * are its own; the migration turns what is already there into identities without inventing a relationship.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { readdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO } from "../../lib/demo.js";
import { normalize, withIds, addMark, updateMark, placeAt, duplicateMark, removeMark } from "../../lib/sheet/markup.mjs";
import { reconcileMarks, isUid, ownerKey, newUid } from "../../lib/sheet/mark-identity.mjs";
import { ledgerDemands } from "../../lib/register/bom-allocation.mjs";
import { legacyMarkUid } from "../../lib/db/repos/mark-identity.mjs";

const W = (id, no, extra = {}) => ({ id, kind: "weld-shop", no, x: 0.3, y: 0.3, ...extra });
const legacy = (id) => `L-${id}`;

// ── the identity in the list functions ───────────────────────────────────

test("1,2,3. a new mark is born with a persistent identity, and normalising or serialising keeps it", () => {
  const items = addMark([], { kind: "weld-shop", no: "1", x: 0.2, y: 0.2 });
  assert(isUid(items[0].uid), "born with a uid");
  const again = normalize(JSON.parse(JSON.stringify(normalize(items))));
  equal(again[0].uid, items[0].uid, "normalise ∘ JSON ∘ normalise keeps it");
  equal(withIds(again)[0].uid, items[0].uid, "and so does a list pass that fills missing ids");
  assert(isUid(normalize([{ kind: "weld-shop", no: "2", x: 0.1, y: 0.1, uid: "not-a-uid" }])[0].uid), "a malformed uid is replaced, never kept");
});

test("4,5,6. moving, editing attributes and changing the number keep the identity", () => {
  const items = normalize([W("m1", "1", { ax: 0.3, ay: 0.3, attrs: { size: "4" } })]);
  const uid = items[0].uid;
  const moved = placeAt(items, "m1", { x: 0.6, y: 0.6 });
  const edited = updateMark(moved, "m1", { attrs: { size: "6", c1: "2" }, kind: "weld-field" });
  const renumbered = updateMark(edited, "m1", { no: "42" });
  for (const v of [moved, edited, renumbered]) equal(v[0].uid, uid);
  equal(renumbered[0].no, "42");
  equal(normalize(renumbered)[0].uid, uid);
});

test("7,8. a duplicate is a new mark with a new identity and the engineering attributes of the original", () => {
  const items = normalize([W("m1", "1", { attrs: { size: "4", c1: "2", c1s: "FLANGE | 4", spool: "SP-1", wps: "WPS-1" } })]);
  const { items: next, id } = duplicateMark(items, "m1");
  const copy = next.find((m) => m.id === id), orig = next.find((m) => m.id === "m1");
  assert(isUid(copy.uid) && copy.uid !== orig.uid, "a new identity");
  equal(orig.uid, items[0].uid, "the original keeps its own");
  equal(copy.attrs, orig.attrs, "attributes copied");
  assert(copy.attrs !== orig.attrs, "…as its own copy");
  equal(copy.no, "2");
  // a list with the same uid twice (a hand-pasted copy) cannot hold it twice
  const twice = withIds([{ ...orig }, { ...orig, id: "m9" }]);
  assert(twice[0].uid !== twice[1].uid);
  // deleting a mark does not hand its identity to anything
  const gone = removeMark(next, "m1");
  assert(!gone.some((m) => m.uid === orig.uid));
});

test("allocation owners are the persistent identity, the legacy handle only for a mark that has none", () => {
  const BOM = [{ pt: 2, description: "FLANGE WELD NECK RF 300# A105 BW", diam: "4", qty: 2, qtyUnit: "pcs" }];
  const u = newUid();
  const d = ledgerDemands([{ id: "m5", uid: u, kind: "weld-shop", no: "1", attrs: { c1: "2" } }, { id: "m6", kind: "weld-shop", no: "2", attrs: { c1: "2" } }], BOM);
  equal(d.map((x) => x.ownerRef), [u, "m6"]);
  equal([ownerKey({ id: "m1", uid: u }), ownerKey({ id: "m1" })], [u, "m1"]);
});

// ── reconciliation (pure) ────────────────────────────────────────────────

const PREV = () => normalize([
  { id: "m1", kind: "weld-shop", no: "1", x: 0.1, y: 0.1, attrs: { size: "4" } },
  { id: "m2", kind: "weld-field", no: "2", x: 0.2, y: 0.2, attrs: { size: "4" } },
  { id: "m3", kind: "spool", no: "SP-1" },
  { id: "m4", kind: "equipment", no: "V-1", x: 0.5, y: 0.5, attrs: { tag: "T-1" } },
]);
const eng = (no, kind = "weld-shop", extra = {}) => ({ kind, no, src: "engine", ...extra });

test("9. re-extraction keeps the identity of reliably matched marks, whatever order or handles they now have", () => {
  const prev = PREV();
  const incoming = withIds([eng("0"), eng("2", "weld-field", { attrs: { size: "4" } }), eng("1", "weld-shop", { attrs: { size: "4" } }), eng("SP-1", "spool"), eng("V-1", "equipment")]
    .map((m) => ({ ...m, uid: undefined })));
  const { items, report } = reconcileMarks({ previous: prev, incoming, legacyUid: legacy });
  const uidOf = (no) => items.find((m) => m.no === no).uid;
  equal([uidOf("1"), uidOf("2"), uidOf("SP-1"), uidOf("V-1")], [prev[0].uid, prev[1].uid, prev[2].uid, prev[3].uid]);
  equal(report.matched.length, 4);
  equal(report.removed, []);
});

test("10. a genuinely new mark gets a new identity, and a removed mark's identity goes to no one", () => {
  const prev = PREV();
  const incoming = [eng("1", "weld-shop", { attrs: { size: "4" } }), eng("9", "weld-shop")];
  const { items, report } = reconcileMarks({ previous: prev, incoming, legacyUid: legacy });
  const nine = items.find((m) => m.no === "9");
  assert(isUid(nine.uid) && !prev.some((p) => p.uid === nine.uid));
  equal(report.created.map((c) => c.no), ["9"]);
  equal(report.removed.map((r) => r.no).sort(), ["2", "SP-1", "V-1"], "named, not reassigned");
  assert(!items.some((m) => [prev[1].uid, prev[2].uid, prev[3].uid].includes(m.uid)));
});

test("11. an ambiguous match lends no identity: two candidates for one saved number get new identities and the ambiguity is reported", () => {
  const prev = normalize([{ id: "m1", kind: "weld-shop", no: "7", x: 0.1, y: 0.1, attrs: { size: "4" } }, { id: "m2", kind: "weld-shop", no: "7", x: 0.2, y: 0.2, attrs: { size: "4" } }]);
  const { items, report } = reconcileMarks({ previous: prev, incoming: [eng("7", "weld-shop", { attrs: { size: "4" } }), eng("7", "weld-shop", { attrs: { size: "4" } })], legacyUid: legacy });
  assert(items.every((m) => isUid(m.uid) && !prev.some((p) => p.uid === m.uid)), "neither took an old identity");
  equal(report.ambiguous.length, 1);
  equal(report.ambiguous[0].previous.length, 2);
  // a size that conflicts with the saved mark of that number is not a confident match either
  const c = reconcileMarks({ previous: PREV(), incoming: [eng("1", "weld-shop", { attrs: { size: "12" } })], legacyUid: legacy });
  assert(!PREV().some((p) => p.uid === c.items[0].uid));
  // told apart by attributes, one to one: matched
  const prev2 = normalize([{ id: "m1", kind: "weld-shop", no: "7", attrs: { size: "4" } }, { id: "m2", kind: "weld-shop", no: "7", attrs: { size: "6" } }]);
  const ok = reconcileMarks({ previous: prev2, incoming: [eng("7", "weld-shop", { attrs: { size: "6" } }), eng("7", "weld-shop", { attrs: { size: "4" } })], legacyUid: legacy });
  equal([ok.items[0].uid, ok.items[1].uid], [prev2[1].uid, prev2[0].uid]);
});

test("a saved mark with no identity is matched through the deterministic legacy one; a mark carrying its identity is trusted and not rematched", () => {
  const prev = [{ id: "m1", kind: "weld-shop", no: "1" }];
  const { items } = reconcileMarks({ previous: prev, incoming: [eng("1")], legacyUid: legacy });
  equal(items[0].uid, legacy("m1"));
  const prev2 = PREV();
  const kept = reconcileMarks({ previous: prev2, incoming: [{ ...prev2[0], no: "99", x: 0.9, src: "hand" }], legacyUid: legacy });
  equal(kept.items[0].uid, prev2[0].uid, "renumbered and moved: still itself");
  equal(kept.report.kept, 1);
});

// ── through the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("markid-db-");
process.env.STORAGE_ROOT = await scratchDir("markid-store-");
const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const runsRoute = await import("../../app/api/runs/route.js");
const editsRoute = await import("../../app/api/runs/[id]/edits/route.js");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const al = await import("../../lib/db/repos/bom-allocation.mjs");
const mi = await import("../../lib/db/repos/mark-identity.mjs");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) =>
  new Request(url, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const db = await getDb();
const projectId = (await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", body: { code: "MID", name: "M" } })))).body.project.id;
const inP = (fn) => withProject(db, projectId, fn);
const q = (sql, p = []) => inP(async () => (await db.query(sql, p)).rows);
let seq = 0;
const newDoc = async (docNo, revision = "0") => (await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST",
  body: { projectId, docNo, revision, fileBase64: Buffer.from(`scan ${docNo} ${revision} ${++seq}`).toString("base64") } })))).body.document.id;
const BOM = [
  { pt: 2, group: "FLANGES", description: "FLANGE WELD NECK RF 300# A105 BW", diam: "4", qty: 6, qtyUnit: "pcs" },
  { pt: 7, group: "MISC", description: "STUD BOLT SET", diam: "4", qty: 4, qtyUnit: "pcs" },
];
const payload = (items, extra = {}) => { const p = JSON.parse(JSON.stringify(DEMO)); delete p.bom; return { ...p, bom: BOM, sheetMarkup: { items }, ...extra }; };
const save = (documentId, items, extra) => json(runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId, documentId, lineNo: "MID-L1", payload: payload(items, extra) } })).then ? undefined : undefined);
const post = async (documentId, items, extra) => json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId, documentId, lineNo: "MID-L1", payload: payload(items, extra) } })));
const storedItems = async (runId) => (await q("SELECT payload FROM extraction_run WHERE id = $1", [runId]))[0].payload.sheetMarkup?.items || [];
const equipment = (d) => q("SELECT id, mark_id, legacy_mark_id, equipment_no, status FROM iso_equipment WHERE document_id = $1 ORDER BY equipment_no", [d]);
const allocs = (d) => q("SELECT id, pt, owner_kind, owner_ref, owner_no, qty, status FROM bom_allocation WHERE document_id = $1 ORDER BY pt, owner_no", [d]);

const E1 = () => [
  { id: "m1", kind: "weld-shop", no: "1", src: "engine", x: 0.1, y: 0.1, attrs: { c1: "2", size: "4" } },
  { id: "m2", kind: "weld-shop", no: "2", src: "engine", x: 0.2, y: 0.2, attrs: { c1: "2", size: "4" } },
  { id: "m3", kind: "equipment", no: "V-1", src: "engine", x: 0.5, y: 0.5, attrs: { tag: "T-1", type: "valve", c1: "7", status: "planned" } },
];
let docA, run1, uids;

test("a first save settles an identity for every mark; equipment and allocations follow it", async () => {
  docA = await newDoc("MID-A");
  const r = await post(docA, E1());
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  run1 = r.body.run.id;
  const items = await storedItems(run1);
  assert(items.every((m) => isUid(m.uid)), "the stored payload carries the identities");
  uids = Object.fromEntries(items.map((m) => [m.no, m.uid]));
  equal((await equipment(docA)).map((e) => [e.mark_id, e.legacy_mark_id]), [[uids["V-1"], "m3"]]);
  equal((await allocs(docA)).map((a) => [a.owner_ref, a.owner_no]).sort(), [[uids["1"], "1"], [uids["2"], "2"], [uids["V-1"], "V-1"]].sort());
  equal((await q("SELECT count(*)::int AS n FROM sheet_mark_identity WHERE document_id = $1", [docA]))[0].n, 3, "registered to this revision");
});

test("12,13. a re-extraction that renumbers the list handles keeps the equipment row and the allocations on the right marks", async () => {
  const eqBefore = await equipment(docA), alBefore = await allocs(docA);
  const again = [   // a new weld in front: every handle is one later, the list is in another order, nothing carries a uid
    { id: "m1", kind: "weld-shop", no: "0", src: "engine", x: 0.05, y: 0.05, attrs: { size: "4" } },
    { id: "m2", kind: "weld-shop", no: "1", src: "engine", x: 0.1, y: 0.1, attrs: { c1: "2", size: "4" } },
    { id: "m3", kind: "weld-shop", no: "2", src: "engine", x: 0.2, y: 0.2, attrs: { c1: "2", size: "4" } },
    { id: "m4", kind: "equipment", no: "V-1", src: "engine", x: 0.5, y: 0.5, attrs: { tag: "T-1", type: "valve", c1: "7", status: "planned" } },
  ];
  const r = await post(docA, again);
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  const items = await storedItems(r.body.run.id);
  const by = Object.fromEntries(items.map((m) => [m.no, m.uid]));
  equal([by["1"], by["2"], by["V-1"]], [uids["1"], uids["2"], uids["V-1"]], "the marks found again keep their identity");
  assert(isUid(by["0"]) && !Object.values(uids).includes(by["0"]), "the new weld has a new one");
  equal(r.body.markIdentity.matched, 3);
  const eqNow = await equipment(docA);
  equal(eqNow.map(({ legacy_mark_id, ...r }) => r), eqBefore.map(({ legacy_mark_id, ...r }) => r), "the equipment row is the same row, unchanged");
  equal([eqBefore[0].legacy_mark_id, eqNow[0].legacy_mark_id], ["m3", "m4"], "only its list handle moved (m3 → m4), which is the point");
  equal(await allocs(docA), alBefore, "and so is every allocation line: none released and re-reserved");
  const hist = await inP(() => al.history(db, { projectId, documentId: docA }));
  assert(hist.every((h) => h.event === "reserve"), "no churn in the history");
});

test("a failed extraction does not stand for the identities of the valid ones", async () => {
  const failed = await json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId, documentId: docA, payload: { nodes: [{ id: "N1", type: "tie-in", E: 0, N: 0, EL: 0 }], sheetMarkup: { items: [{ id: "m1", kind: "weld-shop", no: "1", src: "engine" }] } } } })));
  equal(failed.status, 201);
  assert(failed.body.engineError, "it failed");
  const r = await post(docA, [{ id: "m1", kind: "weld-shop", no: "1", src: "engine", x: 0.1, y: 0.1, attrs: { c1: "2", size: "4" } }, { id: "m2", kind: "weld-shop", no: "2", src: "engine", attrs: { c1: "2", size: "4" } }, { id: "m3", kind: "equipment", no: "V-1", src: "engine", attrs: { tag: "T-1", type: "valve", c1: "7", status: "planned" } }]);
  equal(r.status, 201);
  const by = Object.fromEntries((await storedItems(r.body.run.id)).map((m) => [m.no, m.uid]));
  equal([by["1"], by["2"], by["V-1"]], [uids["1"], uids["2"], uids["V-1"]]);
});

test("a correction keeps identities, and a row typed in without one is settled against what the run had", async () => {
  const runId = (await q("SELECT id FROM extraction_run WHERE document_id = $1 AND engine_error IS NULL ORDER BY created_at DESC, id DESC LIMIT 1", [docA]))[0].id;
  const stored = (await q("SELECT payload FROM extraction_run WHERE id = $1", [runId]))[0].payload;
  const edited = JSON.parse(JSON.stringify(stored));
  edited.sheetMarkup.items.find((m) => m.no === "1").attrs.size = "6";                                      // an attribute edit
  edited.sheetMarkup.items.find((m) => m.no === "2").no = "20";                                              // a number edit (identity carried)
  const hand = edited.sheetMarkup.items.find((m) => m.no === "V-1"); delete hand.uid;                        // a typed-over row with no uid
  const r = await json(await editsRoute.POST(req(`http://x/api/runs/${runId}/edits`, { method: "POST", body: { projectId, payload: edited, reason: "t", baseHash: correctionPayloadHash((await q("SELECT payload FROM extraction_run WHERE id = $1", [runId]))[0].payload) } }), ctx(runId)));
  equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const by = Object.fromEntries((await storedItems(runId)).map((m) => [m.no, m.uid]));
  equal([by["1"], by["20"], by["V-1"]], [uids["1"], uids["2"], uids["V-1"]], "edited, renumbered and un-identified marks are themselves");
  assert((await equipment(docA)).length === 1 && (await equipment(docA))[0].mark_id === uids["V-1"]);
  equal((await allocs(docA)).find((a) => a.owner_ref === uids["2"]).owner_no, "20", "the allocation line follows the mark and shows its new number");
  uids["2"] = uids["2"];
});

test("12. deleting a mark that something installed stands on is refused, and so is guessing it away", async () => {
  const eq = (await equipment(docA))[0];
  await inP(async () => { await db.query("UPDATE iso_equipment SET status = 'installed' WHERE id = $1", [eq.id]); });
  const withoutValve = E1().filter((m) => m.kind !== "equipment");
  const r = await post(docA, withoutValve);
  equal(r.status, 409, JSON.stringify(r.body).slice(0, 200));
  equal((await equipment(docA)).map((e) => e.status), ["installed"], "nothing was dropped");
  // an ambiguity at the valve's number: two candidates for the one saved mark → refused, not guessed
  const twoValves = [...withoutValve, { id: "m3", kind: "equipment", no: "V-1", src: "engine", attrs: { tag: "A", type: "valve" } }, { id: "m4", kind: "equipment", no: "V-1", src: "engine", attrs: { tag: "B", type: "valve" } }];
  const a = await post(docA, twoValves);
  equal(a.status, 409);
  equal(a.body.code, "MARK_IDENTITY_AMBIGUOUS");
  assert(/installed/.test(a.body.error), a.body.error);
  equal((await equipment(docA)).map((e) => [e.mark_id, e.status]), [[uids["V-1"], "installed"]]);
  await inP(async () => { await db.query("UPDATE iso_equipment SET status = 'planned' WHERE id = $1", [eq.id]); });
});

test("an ambiguity with nothing installed proceeds with new identities and a recorded, resolvable warning", async () => {
  const doc = await newDoc("MID-AMB");
  const first = await post(doc, [{ id: "m1", kind: "weld-shop", no: "7", src: "engine", attrs: { size: "4", c1: "2" } }, { id: "m2", kind: "weld-shop", no: "7", src: "engine", attrs: { size: "4" } }]);
  equal(first.status, 201, JSON.stringify(first.body).slice(0, 200));
  const old = (await storedItems(first.body.run.id)).map((m) => m.uid);
  const r = await post(doc, [{ id: "m1", kind: "weld-shop", no: "7", src: "engine", attrs: { size: "4" } }, { id: "m2", kind: "weld-shop", no: "7", src: "engine", attrs: { size: "4" } }]);
  equal(r.status, 201);
  equal(r.body.markIdentity.ambiguous.length, 1);
  const now = (await storedItems(r.body.run.id)).map((m) => m.uid);
  assert(now.every((u) => !old.includes(u)), "neither took an old identity");
  const open = await inP(() => mi.markWarnings(db, { projectId, documentId: doc }));
  equal(open.length, 1);
  await inP(() => mi.resolveMarkWarning(db, { projectId, warningId: open[0].id, userId: null, resolution: "checked against the sheet" }));
  equal((await inP(() => mi.markWarnings(db, { projectId, documentId: doc }))).length, 0);
  await throws(() => inP(() => mi.resolveMarkWarning(db, { projectId, warningId: open[0].id, resolution: "again" })), "already resolved");
});

test("15. a new revision's marks are its own: no identity is shared, and one registered to another revision is refused", async () => {
  const docB = await newDoc("MID-A", "B");
  const r = await post(docB, E1());
  equal(r.status, 201);
  const itemsB = await storedItems(r.body.run.id);
  assert(itemsB.every((m) => !Object.values(uids).includes(m.uid)), "revision B did not inherit revision 0's identities");
  assert((await equipment(docB))[0].mark_id !== uids["V-1"]);
  // carrying revision 0's identity into revision B on purpose is refused
  const docC = await newDoc("MID-A", "C");
  const stolen = await post(docC, [{ id: "m1", kind: "weld-shop", no: "1", uid: uids["1"], src: "hand", attrs: { c1: "2" } }]);
  equal(stolen.status, 409);
  equal(stolen.body.code, "MARK_UID_CONFLICT");
  equal(await equipment(docC), []);
});

test("14,19. the allocation history reads the same after the identities moved", async () => {
  const h = await inP(() => al.history(db, { projectId, documentId: docA }));
  assert(h.length >= 3 && h.every((e) => e.pt && e.ownerKind && e.ownerNo !== undefined));
});

test("17. a legacy payload (no uids anywhere, as saved before this phase) stays readable and editable", async () => {
  const doc = await newDoc("MID-LEG");
  // the way it was saved before: a run whose stored markup has handles only
  const r = await post(doc, [{ id: "m1", kind: "weld-shop", no: "1", src: "engine", attrs: { c1: "2" } }]);
  const runId = r.body.run.id;
  await inP(async () => {
    const p = (await db.query("SELECT payload FROM extraction_run WHERE id = $1", [runId])).rows[0].payload;
    for (const m of p.sheetMarkup.items) delete m.uid;
    await db.query("UPDATE extraction_run SET payload = $1 WHERE id = $2", [JSON.stringify(p), runId]);
  });
  const stored = (await q("SELECT payload FROM extraction_run WHERE id = $1", [runId]))[0].payload;
  assert(stored.sheetMarkup.items.every((m) => !m.uid), "legacy: no uids");
  const edited = JSON.parse(JSON.stringify(stored)); edited.sheetMarkup.items[0].attrs.size = "6";
  const e = await json(await editsRoute.POST(req(`http://x/api/runs/${runId}/edits`, { method: "POST", body: { projectId, payload: edited, baseHash: correctionPayloadHash((await q("SELECT payload FROM extraction_run WHERE id = $1", [runId]))[0].payload) } }), ctx(runId)));
  equal(e.status, 200, JSON.stringify(e.body).slice(0, 200));
  const after = await storedItems(runId);
  equal(after[0].uid, legacyMarkUid(doc, "m1"), "the deterministic legacy identity — the one migration 105 gives the same handle");
});

// ── migration 105 over data ──────────────────────────────────────────────

const { createClient } = await import("../../lib/db/client.mjs");
const { migrate } = await import("../../lib/db/migrate.mjs");
const ALL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const upTo104 = await scratchDir("mig105-files-");
for (const f of (await readdir(ALL)).filter((f) => f.endsWith(".sql")).sort()) if (f < "105") await copyFile(path.join(ALL, f), path.join(upTo104, f));
const one = async (d, sql, p) => (await d.query(sql, p)).rows[0];

async function legacyWorld() {
  const d = process.env.DATABASE_URL ? await createClient({ url: process.env.DATABASE_URL }) : await createClient({ dataDir: await scratchDir("mig105-db-") });
  if (process.env.DATABASE_URL) await d.exec("DROP SCHEMA IF EXISTS reporting CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(d, { dir: upTo104 });
  const user = await one(d, "INSERT INTO app_user (subject) VALUES ('kc|m105') RETURNING id");
  const proj = await one(d, "INSERT INTO project (code, name) VALUES ('M5','M5') RETURNING id");
  const doc = await one(d, `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'D5','0',$2,'local://x') RETURNING id`, [proj.id, "5".repeat(64)]);
  await d.query("INSERT INTO iso_bom_row (project_id, document_id, pt, description, qty, qty_unit, alloc_cap) VALUES ($1,$2,2,'FLANGE',4,'pcs',4), ($1,$2,7,'STUD',4,'pcs',null)", [proj.id, doc.id]);
  const eq = await one(d, `INSERT INTO iso_equipment (project_id, document_id, mark_id, equipment_no, status) VALUES ($1,$2,'m3','V-1','installed') RETURNING id`, [proj.id, doc.id]);
  await d.query("INSERT INTO iso_equipment_weld (project_id, equipment_id, weld_ref, weld_no) VALUES ($1,$2,'m1','1')", [proj.id, eq.id]);
  await d.query("INSERT INTO iso_equipment_accessory (project_id, equipment_id, pt, qty, status) VALUES ($1,$2,7,2,'installed')", [proj.id, eq.id]);
  const a1 = await one(d, `INSERT INTO bom_allocation (project_id, document_id, pt, owner_kind, owner_ref, owner_no, qty, unit, status) VALUES ($1,$2,2,'weld','m1','1',1,'pcs','installed') RETURNING id`, [proj.id, doc.id]);
  await d.query(`INSERT INTO bom_allocation (project_id, document_id, pt, owner_kind, owner_ref, owner_no, qty, unit, status) VALUES ($1,$2,7,'accessory','m3','V-1',2,'pcs','installed')`, [proj.id, doc.id]);
  await d.query("INSERT INTO bom_allocation_event (project_id, document_id, allocation_id, event, status_after, by_user) VALUES ($1,$2,$3,'reserve','installed',$4)", [proj.id, doc.id, a1.id, user.id]);
  return { d, proj: proj.id, doc: doc.id, eq: eq.id };
}

test("18. migration 105 over a populated database: handles become the deterministic identities, nothing is invented or lost", async () => {
  const w = await legacyWorld();
  const evBefore = (await w.d.query("SELECT * FROM bom_allocation_event")).rows;
  const ran = await migrate(w.d);
  assert(ran.includes("105_stable_mark_identity"), JSON.stringify(ran));   // later migrations may follow it
  const sqlUid = (await one(w.d, "SELECT legacy_mark_uid($1::uuid, 'm3')::text AS u", [w.doc])).u;
  equal(sqlUid, legacyMarkUid(w.doc, "m3"), "the SQL and the JS agree on the identity of a legacy handle");
  const eq = await one(w.d, "SELECT mark_id, legacy_mark_id, status FROM iso_equipment WHERE id = $1", [w.eq]);
  equal([eq.mark_id, eq.legacy_mark_id, eq.status], [legacyMarkUid(w.doc, "m3"), "m3", "installed"]);
  equal((await one(w.d, "SELECT weld_ref FROM iso_equipment_weld WHERE equipment_id = $1", [w.eq])).weld_ref, legacyMarkUid(w.doc, "m1"));
  equal((await w.d.query("SELECT owner_kind, owner_ref FROM bom_allocation ORDER BY pt")).rows.map((r) => [r.owner_kind, r.owner_ref]),
    [["weld", legacyMarkUid(w.doc, "m1")], ["accessory", legacyMarkUid(w.doc, "m3")]]);
  equal((await w.d.query("SELECT * FROM bom_allocation_event")).rows, evBefore, "the immutable history is untouched");
  const reg = (await w.d.query("SELECT uid::text AS uid, cls FROM sheet_mark_identity WHERE document_id = $1 ORDER BY cls", [w.doc])).rows;
  equal(reg.map((r) => r.uid).sort(), [legacyMarkUid(w.doc, "m1"), legacyMarkUid(w.doc, "m3")].sort(), "every identity in use is registered, once");
  await w.d.close();
});

test("18b. a second run changes nothing", async () => {
  const w = await legacyWorld();
  await migrate(w.d);
  const snap = async () => JSON.stringify([(await w.d.query("SELECT * FROM iso_equipment")).rows, (await w.d.query("SELECT * FROM iso_equipment_weld")).rows, (await w.d.query("SELECT * FROM bom_allocation ORDER BY pt")).rows, (await w.d.query("SELECT uid, cls FROM sheet_mark_identity ORDER BY uid")).rows]);
  const before = await snap();
  equal(await migrate(w.d), [], "the runner has nothing to apply");
  // and the statements themselves find nothing left to rewrite
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert((await w.d.query("SELECT mark_id FROM iso_equipment")).rows.every((r) => re.test(r.mark_id)));
  assert((await w.d.query("SELECT weld_ref FROM iso_equipment_weld")).rows.every((r) => re.test(r.weld_ref)));
  assert((await w.d.query("SELECT owner_ref FROM bom_allocation")).rows.every((r) => re.test(r.owner_ref)));
  equal(await snap(), before);
  await w.d.close();
});

test("16. after the migration the legacy records are readable and a save of the same sheet keeps them on the same marks", async () => {
  const w = await legacyWorld();
  await migrate(w.d);
  const items = [{ id: "m1", kind: "weld-shop", no: "1", src: "engine", attrs: { c1: "2" } }, { id: "m3", kind: "equipment", no: "V-1", src: "engine", attrs: { c1: "7", acc: "7×2", status: "installed", welds: "1" } }];
  const prev = [{ id: "m1", kind: "weld-shop", no: "1" }, { id: "m3", kind: "equipment", no: "V-1" }];   // the saved payload: handles only
  const { items: settled } = mi.reconcileSheetMarks ? await mi.reconcileSheetMarks(w.d, { projectId: w.proj, documentId: w.doc, previousItems: prev, items }) : { items };
  equal(settled.map((m) => m.uid), [legacyMarkUid(w.doc, "m1"), legacyMarkUid(w.doc, "m3")], "the same marks, the same identities the migration wrote");
  const { listEquipment } = await import("../../lib/db/repos/iso-equipment.mjs");
  const list = await withProject(w.d, w.proj, () => listEquipment(w.d, { projectId: w.proj, documentId: w.doc }));
  equal([list[0].markId, list[0].legacyId, list[0].status, list[0].welds[0].ref, list[0].accessories[0].status],
    [legacyMarkUid(w.doc, "m3"), "m3", "installed", legacyMarkUid(w.doc, "m1"), "installed"]);
  await w.d.close();
});

await run();
