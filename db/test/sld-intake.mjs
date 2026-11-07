#!/usr/bin/env node
/**
 * Phase 12.2 — SLD document intake and isolated draft persistence (docs/audit/phase-12-sld-intelligence.md §16.3, §16.6, §16.7).
 * What is proved: the closed document-type set (400 INVALID_DOC_TYPE, 409 DOC_TYPE_CONFLICT, the isometric default unchanged); SLD documents through the
 * existing document workflow; an SLD draft is an `extraction_run` (pass 'sld') carrying an opaque, size-limited envelope; idempotent ingest, concurrent
 * ingest, `baseHash` stale-edit protection, approval that records who/when/hash and LOCKS (application and database), authorization and project isolation;
 * approval promotes nothing; a new revision starts clean. Nothing about the electrical CONTENT of `items`/`edges` is interpreted (Phases 12.3/12.4).
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
import { DOC_TYPES, normalizeDocType } from "../../lib/documents/types.mjs";
import { validateEnvelope, LIMITS, sizeOf } from "../../lib/sld/envelope.mjs";

const SRC = (hash = "h-1", extra = {}) => ({ kind: "synthetic-test", reader: "unit-test", hash, generatedAt: "2026-11-07T10:00:00Z", ...extra });
const ENV = (hash = "h-1", over = {}) => ({ kind: "sld", schema: 1, meta: { title: "synthetic" }, page: { number: 1, width: 1000, height: 800 }, items: [{ any: "thing", n: 1 }], edges: [], source: SRC(hash), ...over });
const throwsCode = (fn, status, code) => { try { fn(); } catch (e) { equal([e.status, e.code], [status, code], e.message); return; } throw new Error(`expected ${status} ${code}`); };

// ── pure: the document-type contract and the envelope ──────────────────────

test("T1. the closed document-type set: absent → isometric; the three types (any case, trimmed) are accepted; anything else is INVALID_DOC_TYPE", () => {
  equal(DOC_TYPES, ["isometric", "pid", "sld"]);
  equal([undefined, null, "", "  "].map(normalizeDocType), ["isometric", "isometric", "isometric", "isometric"]);
  equal(["isometric", "PID", " sld ", "SLD"].map(normalizeDocType), ["isometric", "pid", "sld", "sld"]);
  for (const bad of ["iso", "unknown", "p&id", "datasheet", 5, {}, ["sld"], true]) throwsCode(() => normalizeDocType(bad), 400, "INVALID_DOC_TYPE");
});

test("E1. envelope: the minimal draft is accepted and normalised (meta/page {} · items/edges []); content of items and edges is NOT interpreted", () => {
  const e = validateEnvelope({ kind: "sld", schema: 1, source: SRC() });
  equal([e.meta, e.page, e.items, e.edges], [{}, {}, [], []]);
  const items = [{ cls: "transformer", rating: "garbage", x: null }, { anything: [1, 2, { deep: true }] }];
  equal(validateEnvelope(ENV("h", { items })).items, items, "carried verbatim: no class, no Fact, no opinion");
});

test("E2. envelope refusals: wrong kind/schema, unknown top-level key, wrong shapes, missing or malformed source", () => {
  const E = (over) => () => validateEnvelope({ ...ENV(), ...over });
  throwsCode(() => validateEnvelope(null), 400, "INVALID_ENVELOPE");
  throwsCode(() => validateEnvelope([]), 400, "INVALID_ENVELOPE");
  throwsCode(E({ kind: "pid" }), 400, "INVALID_ENVELOPE");
  throwsCode(E({ schema: 2 }), 400, "INVALID_ENVELOPE");
  throwsCode(E({ mappings: [] }), 400, "INVALID_ENVELOPE");
  throwsCode(E({ items: {} }), 400, "INVALID_ENVELOPE");
  throwsCode(E({ edges: "x" }), 400, "INVALID_ENVELOPE");
  throwsCode(E({ meta: [] }), 400, "INVALID_ENVELOPE");
  throwsCode(E({ page: 3 }), 400, "INVALID_ENVELOPE");
  throwsCode(E({ items: [1] }), 400, "INVALID_ENVELOPE");
  throwsCode(E({ edges: [null] }), 400, "INVALID_ENVELOPE");
  throwsCode(E({ source: null }), 400, "INVALID_ENVELOPE");
  for (const k of ["kind", "reader", "hash", "generatedAt"]) throwsCode(E({ source: { ...SRC(), [k]: "" } }), 400, "INVALID_ENVELOPE");
  throwsCode(E({ source: SRC("has space") }), 400, "INVALID_ENVELOPE");
  throwsCode(E({ source: SRC("x".repeat(129)) }), 400, "INVALID_ENVELOPE");
  throwsCode(E({ source: SRC("h", { generatedAt: "not a date" }) }), 400, "INVALID_ENVELOPE");
});

test("E3. envelope size limits: too many items / edges / meta keys / bytes → 413 PAYLOAD_TOO_LARGE; the limits themselves are accepted", () => {
  throwsCode(() => validateEnvelope(ENV("h", { items: Array.from({ length: LIMITS.items + 1 }, () => ({})) })), 413, "PAYLOAD_TOO_LARGE");
  throwsCode(() => validateEnvelope(ENV("h", { edges: Array.from({ length: LIMITS.edges + 1 }, () => ({})) })), 413, "PAYLOAD_TOO_LARGE");
  throwsCode(() => validateEnvelope(ENV("h", { meta: Object.fromEntries(Array.from({ length: LIMITS.metaKeys + 1 }, (_, i) => [`k${i}`, 1])) })), 413, "PAYLOAD_TOO_LARGE");
  throwsCode(() => validateEnvelope(ENV("h", { items: [{ blob: "x".repeat(LIMITS.bytes) }] })), 413, "PAYLOAD_TOO_LARGE");
  equal(validateEnvelope(ENV("h", { items: Array.from({ length: LIMITS.items }, () => ({})) })).items.length, LIMITS.items);
  assert(sizeOf(ENV()) < 1000);
});

// ── the server ─────────────────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("sld-db-");
process.env.STORAGE_ROOT = await scratchDir("sld-store-");
const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const sldRoute = await import("../../app/api/sld/route.js");
const reviewRoute = await import("../../app/api/sld/review/route.js");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const { addMember, ensureUser } = await import("../../lib/db/repos/projects.mjs");
const { createRevision, lineageOf } = await import("../../lib/db/repos/revision-lifecycle.mjs");

const req = (url, { method = "GET", as = "kc|alice", body, raw } = {}) => new Request(url, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const db = await getDb();
const mkProject = async (code, as = "kc|alice") => (await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", as, body: { code, name: code } })))).body.project.id;
const projectId = await mkProject("SLD1"), otherProject = await mkProject("SLD2", "kc|mallory");
const q = (sql, p = [], pid = projectId) => withProject(db, pid, async () => (await db.query(sql, p)).rows);
let seq = 0;
const upload = async (docNo, docType, { revision = "0", pid = projectId, as = "kc|alice", sheetNo = "1/1" } = {}) => json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST", as,
  body: { projectId: pid, docNo, revision, sheetNo, ...(docType === undefined ? {} : { docType }), fileBase64: Buffer.from(`sheet ${docNo} ${revision} ${++seq}`).toString("base64"), contentType: "application/pdf" } })));
const newDoc = async (docNo, docType = "sld", o = {}) => { const r = await upload(docNo, docType, o); assert(r.status === 201, JSON.stringify(r.body)); return r.body.document; };
const post = async (documentId, draft, as = "kc|alice", pid = projectId) => json(await sldRoute.POST(req("http://x/api/sld", { method: "POST", as, body: { projectId: pid, documentId, draft } })));
const list = async (documentId, as = "kc|alice", pid = projectId) => json(await sldRoute.GET(req(`http://x/api/sld?projectId=${pid}&documentId=${documentId}`, { as })));
const read = async (documentId, extra = "", as = "kc|alice", pid = projectId) => json(await sldRoute.GET(req(`http://x/api/sld?projectId=${pid}&documentId=${documentId}&draft=1${extra}`, { as })));
const decide = async (b, as = "kc|alice", pid = projectId) => json(await reviewRoute.POST(req("http://x/api/sld/review", { method: "POST", as, body: { projectId: pid, ...b } })));
const count = async (t) => (await q(`SELECT count(*)::int AS n FROM ${t} WHERE project_id = $1`, [projectId]))[0].n;
const D = {};
/** equality that ignores object key order (a jsonb column returns keys in its own order) */
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
const same = (a, b, m) => equal(JSON.parse(canon(a)), JSON.parse(canon(b)), m);

test("D1. document types through the real upload route: absent → isometric; isometric / pid / sld accepted; case and spaces tolerated; the type is stored", async () => {
  const none = await upload("SLD-D1-NONE", undefined); equal([none.status, none.body.document.doc_type], [201, "isometric"]);
  for (const [t, want] of [["isometric", "isometric"], ["pid", "pid"], ["sld", "sld"], [" SLD ", "sld"], ["PID", "pid"]]) {
    const r = await upload(`SLD-D1-${want}-${t.trim()}`, t); equal([r.status, r.body.document.doc_type], [201, want], `${t}: ${JSON.stringify(r.body).slice(0, 150)}`);
  }
});

test("D2. an unknown document type is refused with 400 INVALID_DOC_TYPE and NOTHING is registered or stored (it used to become an isometric silently)", async () => {
  const before = await count("document");
  for (const bad of ["iso", "unknown", "datasheet", 5, {}, ["pid"]]) {
    const r = await upload(`SLD-D2-${seq}`, bad); equal([r.status, r.body.code], [400, "INVALID_DOC_TYPE"], JSON.stringify(r.body).slice(0, 150));
    assert(Array.isArray(r.body.details?.allowed) && r.body.details.allowed.includes("sld"));
  }
  equal(await count("document"), before, "no document row");
});

test("D3. DOC_TYPE_CONFLICT: the same document number and sheet under another type is 409; another revision of the same type is fine; another sheet is another drawing", async () => {
  await newDoc("SLD-D3", "pid");
  for (const t of ["sld", "isometric", undefined]) { const r = await upload("SLD-D3", t, { revision: "1" }); equal([r.status, r.body.code], [409, "DOC_TYPE_CONFLICT"], `${t}`); equal(r.body.details.existing, "pid"); }
  equal((await upload("SLD-D3", "pid", { revision: "1" })).status, 201, "revision B of the same type");
  equal((await upload("SLD-D3", "sld", { sheetNo: "2/2" })).status, 201, "another sheet of the number is another drawing");
  await newDoc("SLD-D3-SLD", "sld");
  const r = await upload("SLD-D3-SLD", "isometric", { revision: "9" }); equal([r.status, r.body.code], [409, "DOC_TYPE_CONFLICT"]);
  assert((await q("SELECT count(*)::int AS n FROM document WHERE doc_no = 'SLD-D3' AND doc_type <> 'pid' AND sheet_no = '1/1'"))[0].n === 0, "the conflicting registrations left nothing behind");
});

test("D4. an SLD document is a normal document: re-registering the same bytes is the same row; different bytes under one revision still conflict; the P&ID type is untouched", async () => {
  const a = await upload("SLD-D4", "sld"); equal(a.status, 201);
  const b = await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST", body: { projectId, docNo: "SLD-D4", revision: "0", docType: "sld", fileBase64: Buffer.from(`sheet SLD-D4 0 ${seq}`).toString("base64"), contentType: "application/pdf" } })));
  equal([b.status, b.body.created, b.body.document.id], [200, false, a.body.document.id]);
  const c = await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST", body: { projectId, docNo: "SLD-D4", revision: "0", docType: "sld", fileBase64: Buffer.from("other bytes").toString("base64"), contentType: "application/pdf" } })));
  equal([c.status, c.body.code], [409, "REVISION_CONTENT_CONFLICT"]);
  equal((await newDoc("SLD-D4-PID", "pid")).doc_type, "pid");
});

test("S1. ingest: a draft is filed as an `extraction_run` (pass 'sld') on an SLD document; the server stamps the document and revision; nothing is approved", async () => {
  D.a = await newDoc("SLD-S1");
  const r = await post(D.a.id, ENV("s1-a"));
  equal([r.status, r.body.created, r.body.run.status], [201, true, "extracted"], JSON.stringify(r.body).slice(0, 200));
  D.run = r.body.run.id;
  const [row] = await q("SELECT pass_name, status, approved_by, approved_at, created_by, payload FROM extraction_run WHERE id = $1", [D.run]);
  equal([row.pass_name, row.status, row.approved_by, row.approved_at], ["sld", "extracted", null, null]);
  assert(row.created_by, "who filed it");
  same(row.payload.meta.document, { documentId: D.a.id, docNo: "SLD-S1", revision: "0", sheetNo: "1/1" });
  same(row.payload.items, [{ any: "thing", n: 1 }], "items stored verbatim");
});

test("S2. ingest is idempotent by `source.hash`: the same reading again returns the existing draft (200, created false), one row; a different reading is another draft", async () => {
  const again = await post(D.a.id, ENV("s1-a")); equal([again.status, again.body.created, again.body.run.id], [200, false, D.run]);
  equal((await q("SELECT count(*)::int AS n FROM extraction_run WHERE document_id = $1 AND pass_name = 'sld'", [D.a.id]))[0].n, 1);
  const other = await post(D.a.id, ENV("s1-b", { items: [{ n: 2 }] })); equal([other.status, other.body.created], [201, true]);
  D.run2 = other.body.run.id;
  const l = await list(D.a.id); equal(l.status, 200);
  equal(l.body.drafts.map((d) => d.id), [D.run2, D.run], "newest first");
  equal([l.body.document.docNo, l.body.drafts[0].items, l.body.drafts[0].reader], ["SLD-S1", 1, "unit-test"]);
  assert(!JSON.stringify(l.body).includes("\"any\""), "a list carries no payload");
  const latest = await read(D.a.id); equal([latest.status, latest.body.run.id, latest.body.draft.items], [200, D.run2, [{ n: 2 }]]);
  const one = await read(D.a.id, `&runId=${D.run}`); same([one.body.run.id, one.body.draft.items], [D.run, [{ any: "thing", n: 1 }]]);
  equal((await read(D.a.id, `&runId=${"00000000-0000-4000-8000-000000000000"}`)).status, 404);
  const docs = await json(await sldRoute.GET(req(`http://x/api/sld?projectId=${projectId}`)));
  const mine = docs.body.documents.find((x) => x.documentId === D.a.id); equal([mine.runId, mine.runStatus], [D.run2, "extracted"]);
  assert(docs.body.documents.every((x) => x.docNo.startsWith("SLD-")), "only SLD documents are listed");
});

test("S3. a draft is filed only against an SLD document of this project: P&ID / isometric → 409 NOT_AN_SLD_DOCUMENT, unknown → 404; a bad envelope → 400 and nothing is stored", async () => {
  const pid = await newDoc("SLD-S3-PID", "pid"), iso = await newDoc("SLD-S3-ISO", "isometric");
  for (const d of [pid, iso]) { const r = await post(d.id, ENV("s3")); equal([r.status, r.body.code], [409, "NOT_AN_SLD_DOCUMENT"]); }
  equal((await post("00000000-0000-4000-8000-000000000000", ENV("s3"))).status, 404);
  const bad = await post(D.a.id, { ...ENV("s3-bad"), kind: "pid" }); equal([bad.status, bad.body.code], [400, "INVALID_ENVELOPE"]);
  const big = await post(D.a.id, ENV("s3-big", { items: [{ blob: "x".repeat(LIMITS.bytes) }] })); equal([big.status, big.body.code], [413, "PAYLOAD_TOO_LARGE"]);
  const huge = await json(await sldRoute.POST(req("http://x/api/sld", { method: "POST", raw: JSON.stringify({ projectId, documentId: D.a.id, draft: { pad: "y".repeat(LIMITS.bytes * 2) } }) })));
  equal([huge.status, huge.body.code], [413, "PAYLOAD_TOO_LARGE"], "an oversized body is refused before it is parsed");
  equal((await json(await sldRoute.POST(req("http://x/api/sld", { method: "POST", raw: "{not json" })))).status, 400);
  equal((await q("SELECT count(*)::int AS n FROM extraction_run WHERE document_id = ANY($1)", [[pid.id, iso.id, D.a.id]]))[0].n, 2, "only S1/S2's two drafts exist");
});

test("S4. concurrent ingest: eight requests with one hash → exactly one draft (one 201, seven 200); eight with different hashes → eight drafts", async () => {
  const d = await newDoc("SLD-S4");
  const same = await Promise.all(Array.from({ length: 8 }, () => post(d.id, ENV("race"))));
  equal(same.map((r) => r.status).sort(), [200, 200, 200, 200, 200, 200, 200, 201]);
  equal(new Set(same.map((r) => r.body.run.id)).size, 1);
  equal((await q("SELECT count(*)::int AS n FROM extraction_run WHERE document_id = $1", [d.id]))[0].n, 1);
  const d2 = await newDoc("SLD-S4B");
  const diff = await Promise.all(Array.from({ length: 8 }, (_, i) => post(d2.id, ENV(`race-${i}`))));
  assert(diff.every((r) => r.status === 201), JSON.stringify(diff.map((r) => r.status)));
  equal((await q("SELECT count(*)::int AS n FROM extraction_run WHERE document_id = $1", [d2.id]))[0].n, 8);
});

test("S5. edit: `baseHash` is required (400); a stale one is 409 STALE_RUN; a good edit is audited (extraction_edit); an identical envelope changes nothing; a bad one leaves the draft as it was", async () => {
  const g = await read(D.a.id, `&runId=${D.run}`), h0 = g.body.run.payloadHash;
  equal((await decide({ runId: D.run, action: "edit", draft: ENV("s1-a") })).status, 400, "no baseHash → no last-write-wins");
  const same = await decide({ runId: D.run, action: "edit", draft: g.body.draft, baseHash: h0 }); equal([same.status, same.body.changed], [200, false], "the same content (keys reordered by jsonb) is not an edit");
  const ok = await decide({ runId: D.run, action: "edit", draft: ENV("s1-a", { items: [{ any: "thing", n: 1 }, { added: true }] }), baseHash: h0, reason: "added an item" });
  equal([ok.status, ok.body.changed, ok.body.run.items], [200, true, 2], JSON.stringify(ok.body).slice(0, 200));
  assert(ok.body.run.payloadHash !== h0);
  const stale = await decide({ runId: D.run, action: "edit", draft: ENV("s1-a", { items: [] }), baseHash: h0 }); equal([stale.status, stale.body.code], [409, "STALE_RUN"]);
  const e = await q("SELECT path, field, kind, reason, edited_by, before_value, after_value FROM extraction_edit WHERE extraction_run_id = $1", [D.run]);
  equal(e.length, 1); equal([e[0].path, e[0].field, e[0].kind, e[0].reason], ["/", "draft", "changed", "added an item"]);
  equal([e[0].before_value.hash, e[0].before_value.items, e[0].after_value.items], [h0, 1, 2]); assert(e[0].edited_by);
  const h1 = ok.body.run.payloadHash;
  const badEdit = await decide({ runId: D.run, action: "edit", draft: { ...ENV("s1-a"), edges: "no" }, baseHash: h1 }); equal([badEdit.status, badEdit.body.code], [400, "INVALID_ENVELOPE"]);
  equal((await read(D.a.id, `&runId=${D.run}`)).body.run.payloadHash, h1, "unchanged");
  equal((await decide({ runId: D.run, action: "edit", draft: ENV("s1-a"), baseHash: h1 })).body.run.items, 1, "the document stamp is the server's, whatever the client sent");
  const meta = (await q("SELECT payload->'meta'->'document'->>'docNo' AS d FROM extraction_run WHERE id = $1", [D.run]))[0].d; equal(meta, "SLD-S1");
});

test("S6. two edits made on one base: one wins, one is refused (STALE_RUN) — the draft keeps exactly one of them", async () => {
  const d = await newDoc("SLD-S6"); const r = await post(d.id, ENV("s6")); const base = r.body.run.payloadHash;
  const out = await Promise.all([decide({ runId: r.body.run.id, action: "edit", draft: ENV("s6", { items: [{ who: "A" }] }), baseHash: base }), decide({ runId: r.body.run.id, action: "edit", draft: ENV("s6", { items: [{ who: "B" }] }), baseHash: base })]);
  equal(out.map((x) => x.status).sort(), [200, 409]); equal(out.find((x) => x.status === 409).body.code, "STALE_RUN");
  const items = (await read(d.id)).body.draft.items; assert(items.length === 1 && ["A", "B"].includes(items[0].who));
});

test("S7. approval: records approver, time and the signed hash; locks the draft; a second approval is a no-op; every later change is RUN_LOCKED", async () => {
  const a = await decide({ runId: D.run, action: "approve" });
  equal([a.status, a.body.repeated, a.body.run.status], [200, false, "approved"], JSON.stringify(a.body).slice(0, 200));
  assert(a.body.run.approvedBy && a.body.run.approvedAt && /^[0-9a-f]{64}$/.test(a.body.run.approvedSha256) && a.body.run.lockedAt);
  const [row] = await q("SELECT status, approved_by, approved_at, approved_sha256, locked_at FROM extraction_run WHERE id = $1", [D.run]);
  equal([row.status, !!row.approved_by, !!row.approved_at, row.approved_sha256.trim().length, !!row.locked_at], ["approved", true, true, 64, true]);
  equal((await decide({ runId: D.run, action: "approve" })).body.repeated, true);
  const edit = await decide({ runId: D.run, action: "edit", draft: ENV("s1-a", { items: [] }), baseHash: a.body.run.payloadHash }); equal([edit.status, edit.body.code], [409, "RUN_LOCKED"]);
  const other = await post(D.a.id, ENV("s1-new-reading")); equal([other.status, other.body.code], [409, "RUN_LOCKED"], "a different reading of a signed-off revision is refused");
  const same = await post(D.a.id, ENV("s1-a")); equal([same.status, same.body.created], [200, false], "retrying the signed reading is harmless");
});

test("S8. the database locks an approved run independently of the application: a direct UPDATE of its payload is refused", async () => {
  let err; try { await withProject(db, projectId, () => db.query("UPDATE extraction_run SET payload = jsonb_set(payload, '{items}', '[]'::jsonb) WHERE id = $1", [D.run])); } catch (e) { err = e; }
  assert(err && /approved and locked/.test(err.message), err ? err.message : "the UPDATE was accepted");
  assert((await q("SELECT payload->'items' AS i FROM extraction_run WHERE id = $1", [D.run]))[0].i.length >= 1, "unchanged");
});

test("S9. approval promotes NOTHING: no tag, asset, cable, cable activity, IR test, subsystem, document or run of another pass is created or changed by ingest, edit or approval", async () => {
  const tables = ["tag", "asset_master", "cable", "cable_activity", "ir_test", "subsystem", "mdr_document", "line", "weld", "spool", "iso_equipment", "bom_allocation"];
  const snap = async () => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(t)])));
  const before = await snap(), docs = await count("document");
  const d = await newDoc("SLD-S9"); const r = await post(d.id, ENV("s9", { items: [{ cls: "transformer", tag: "TR-1", rating: "1000 kVA" }, { cls: "feeder", cable: "EC-1" }] }));
  await decide({ runId: r.body.run.id, action: "edit", draft: ENV("s9", { items: [{ cls: "transformer", tag: "TR-1" }] }), baseHash: r.body.run.payloadHash });
  equal((await decide({ runId: r.body.run.id, action: "approve" })).status, 200);
  equal(await snap(), before, "no register changed");
  equal(await count("document"), docs + 1, "only the SLD document itself");
});

test("S10. authorization: a viewer reads but cannot file, edit or sign; another project's member sees nothing; a run of another project is not found", async () => {
  const v = await ensureUser(db, { subject: "kc|viewer-sld" }); await addMember(db, { projectId, userId: v.id, role: "viewer" });
  const d = await newDoc("SLD-S10"); const r = await post(d.id, ENV("s10"));
  equal((await post(d.id, ENV("s10-v"), "kc|viewer-sld")).status, 403);
  equal((await decide({ runId: r.body.run.id, action: "edit", draft: ENV("s10"), baseHash: r.body.run.payloadHash }, "kc|viewer-sld")).status, 403);
  equal((await decide({ runId: r.body.run.id, action: "approve" }, "kc|viewer-sld")).status, 403);
  equal((await list(d.id, "kc|viewer-sld")).status, 200, "reading is allowed");
  equal((await list(d.id, "kc|mallory")).status, 404, "another project's user");
  equal((await post(d.id, ENV("s10-m"), "kc|mallory", otherProject)).status, 404, "the document is not that project's");
  equal((await decide({ runId: r.body.run.id, action: "approve" }, "kc|mallory", otherProject)).status, 404, "the run is not that project's");
  equal((await json(await sldRoute.GET(req(`http://x/api/sld?projectId=${projectId}`, { as: "kc|nobody" })))).status, 404);
  equal((await decide({ runId: r.body.run.id, action: "reject" })).status, 400, "unknown action");
  equal((await decide({ runId: r.body.run.id, action: "approve" })).status, 200, "the engineer signs");
});

test("S11. an SLD run id is not an SLD draft of anything else: a P&ID / isometric run is NOT_AN_SLD_RUN to the SLD review route", async () => {
  const pid = await newDoc("SLD-S11-PID", "pid");
  const [pr] = await withProject(db, projectId, async () => (await db.query(
    "INSERT INTO extraction_run (project_id, document_id, pass_name, payload, status) VALUES ($1,$2,'pid','{\"kind\":\"pid\",\"items\":[],\"edges\":[]}'::jsonb,'extracted') RETURNING id", [projectId, pid.id])).rows);
  const r = await decide({ runId: pr.id, action: "approve" }); equal([r.status, r.body.code], [409, "NOT_AN_SLD_RUN"]);
  equal((await q("SELECT status FROM extraction_run WHERE id = $1", [pr.id]))[0].status, "extracted", "untouched");
});

test("R1. revisions: a new revision of an SLD sheet is its own document (type kept, source linked), starts with NO draft and NO approval; the older revision is superseded; the source is untouched", async () => {
  const a = await newDoc("SLD-R1"); const ra = await post(a.id, ENV("r1-a")); equal((await decide({ runId: ra.body.run.id, action: "approve" })).status, 200);
  const rev = await withProject(db, projectId, () => createRevision(db, { projectId, sourceDocumentId: a.id, revision: "1", changeNote: "rev B", userId: (null) }));
  const b = rev.document;
  equal([b.doc_type, b.revision, b.parent_document_id, rev.created], ["sld", "1", a.id, true]);
  equal(rev.superseded.map((x) => x.id), [a.id], "the earlier revision is superseded by the supersedePrevious it reuses");
  const lb = await list(b.id); equal([lb.status, lb.body.drafts], [200, []], "no draft, no approval copied");
  const nb = await post(b.id, ENV("r1-a")); equal([nb.status, nb.body.created, nb.body.run.status], [201, true, "extracted"], "even the SAME reading is a new, unsigned draft of the new revision");
  equal((await read(a.id)).body.run.status, "approved", "the source revision's signed draft is untouched");
  const chain = await withProject(db, projectId, () => lineageOf(db, { projectId, documentId: b.id }));
  equal(chain.chain.map((x) => x.revision), ["0", "1"]);
  const [lock] = await q("SELECT count(*)::int AS n FROM extraction_run WHERE document_id = $1 AND status = 'approved'", [b.id]); equal(lock.n, 0);
});

await run();
