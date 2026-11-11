#!/usr/bin/env node
/**
 * Phase 10 — equipment ↔ spool identity and referential integrity (docs/audit/phase-10-equipment-spool.md).
 * An equipment names its spool by uid (attrs.spoolUid); the printed number is a label. A legacy number resolves only when exactly one spool has
 * it; a dangling uid is never re-pointed by its old number; a spool that is still named is never deleted (server, 409 SPOOL_IN_USE) and
 * nothing is ever detached automatically; revisions carry the relationship only through explicit mappings, as the TARGET's own uid.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
import { newUid, isUid } from "../../lib/sheet/mark-identity.mjs";
import { settleWeldSpools, assignWeldSpool, spoolDependents, spoolView } from "../../lib/register/cut-identity.mjs";
import { endSpoolMarks, endSpools } from "../../lib/register/cut-model.mjs";
import { spoolDependencies, removedSpools, assertSpoolsRemovable } from "../../lib/register/spool-guard.mjs";
import { validate } from "../../lib/engineering/validation.mjs";
import { diffRevisions, applyCarry } from "../../lib/revision/revision-diff.mjs";
import { dependents, normalize, updateMark } from "../../lib/sheet/markup.mjs";

const [w1, w2, s1, s2, e1] = Array.from({ length: 5 }, newUid);
const weld = (uid, no, spool, spoolUid) => ({ id: `w${no}`, uid, kind: "weld-shop", no, x: 0.2, y: 0.2, src: "hand", attrs: { ...(spool ? { spool } : {}), ...(spoolUid ? { spoolUid } : {}) } });
const spool = (uid, no) => ({ id: `s${no}`, uid, kind: "spool", no, x: 0.5, y: 0.5, src: "hand", attrs: {} });
const equip = (uid, no, attrs = {}) => ({ id: `e${no}`, uid, kind: "equipment", no, x: 0.4, y: 0.4, src: "hand", attrs: { tag: `XV-${no}`, type: "valve", weldRefs: w1, ...attrs } });
const P = (items, extra = {}) => ({ sheetMarkup: { items }, ...extra });
const eqOf = (p, uid) => p.sheetMarkup.items.find((m) => m.uid === uid);
const codes = (r) => r.findings.map((f) => f.code);

// ── identity (pure) ─────────────────────────────────────────────────────

test("E1. legacy printed spool on an equipment becomes a uid ONLY when exactly one spool has it; renumbering refreshes the label, never the relationship", () => {
  const { payload, report } = settleWeldSpools(P([weld(w1, "W-1", "SP-1", s1), spool(s1, "SP-1"), spool(s2, "SP-2"), equip(e1, "V-1", { spool: "SP-2" })]));
  equal([eqOf(payload, e1).attrs.spoolUid, eqOf(payload, e1).attrs.spool], [s2, "SP-2"]);
  assert(report.resolved.some((r) => r.kind === "equipment"));
  const renum = { ...payload, sheetMarkup: { items: payload.sheetMarkup.items.map((m) => (m.uid === s2 ? { ...m, no: "SP-B" } : m)) } };
  const after = settleWeldSpools(renum).payload;
  equal([eqOf(after, e1).attrs.spoolUid, eqOf(after, e1).attrs.spool], [s2, "SP-B"]);
});

test("E2. duplicate printed spool numbers: nothing is selected, the ambiguity is reported; no match: unresolved; a dangling uid is NEVER re-pointed by its old number", () => {
  const dup = P([spool(s1, "SP-1"), spool(s2, "SP-1"), equip(e1, "V-1", { spool: "SP-1" })]);
  const r1 = settleWeldSpools(dup);
  assert(!eqOf(r1.payload, e1).attrs.spoolUid && r1.report.ambiguous.some((a) => a.kind === "equipment" && a.candidates.length === 2));
  const none = settleWeldSpools(P([spool(s1, "SP-1"), equip(e1, "V-1", { spool: "SP-9" })]));
  assert(!eqOf(none.payload, e1).attrs.spoolUid);
  const gone = newUid();
  const dang = settleWeldSpools(P([spool(s1, "SP-1"), equip(e1, "V-1", { spoolUid: gone, spool: "SP-1" })]));
  equal(eqOf(dang.payload, e1).attrs.spoolUid, gone, "SP-1 exists, but the uid is the relationship: it stays dangling");
  assert(dang.report.dangling.some((d) => d.kind === "equipment"));
});

test("E3. moving an equipment to another spool changes uid and label together and keeps its other attributes", () => {
  const e = equip(e1, "V-1", { spoolUid: s1, spool: "SP-1", note: "keep", legacy: "x" });
  const a = assignWeldSpool(e.attrs, spool(s2, "SP-2"));
  equal([a.spoolUid, a.spool, a.note, a.legacy, a.tag], [s2, "SP-2", "keep", "x", "XV-V-1"]);
  const p = P([spool(s1, "SP-1"), spool(s2, "SP-2"), { ...e, attrs: a }]);
  equal([spoolDependents(p, s1).count, spoolDependents(p, s2).count], [0, 1]);
  equal(spoolView(p, s2).equipment.map((x) => x.uid), [e1]);
});

test("E4. endSpoolMarks: the two end welds' spool by IDENTITY — same spool preselected, different spools not guessed, duplicate numbers not collapsed, ambiguous label not picked", () => {
  const items = [weld(w1, "W-1", "SP-1", s1), weld(w2, "W-2", "SP-1", s1), spool(s1, "SP-1"), spool(s2, "SP-1")];
  equal(endSpoolMarks({ fromUid: w1, toUid: w2 }, items).map((m) => m.uid), [s1]);
  const diff = [weld(w1, "W-1", "SP-1", s1), weld(w2, "W-2", "SP-1", s2), spool(s1, "SP-1"), spool(s2, "SP-1")];
  equal(endSpoolMarks({ fromUid: w1, toUid: w2 }, diff).length, 2, "two spools that share a number are two spools");
  const amb = [weld(w1, "W-1", "SP-1", null), weld(w2, "W-2", "SP-1", null), spool(s1, "SP-1"), spool(s2, "SP-1")];
  equal(endSpoolMarks({ fromUid: w1, toUid: w2 }, amb), [], "a printed number on two spools selects neither");
  equal(endSpools({ fromUid: w1, toUid: w2 }, [weld(w1, "W-1", "SP-1", s1), weld(w2, "W-2", "SP-2", s2), spool(s1, "SP-1"), spool(s2, "SP-2")]), ["SP-1", "SP-2"], "the old export keeps its shape");
});

test("E3b. the sheet-mark normalizer KEEPS attrs.spoolUid (an equipment and a sheet weld) through load, edit and save — it used to be dropped", () => {
  const items = normalize([spool(s1, "SP-1"), equip(e1, "V-1", { spoolUid: s1, spool: "SP-1" }), weld(w1, "W-1", "SP-1", s1)]);
  equal(items.find((m) => m.uid === e1).attrs.spoolUid, s1); equal(items.find((m) => m.uid === w1).attrs.spoolUid, s1);
  const id = items.find((m) => m.uid === e1).id;
  const moved = updateMark(items, id, { attrs: { ...items.find((m) => m.uid === e1).attrs, spoolUid: s2, spool: "SP-2" } });
  equal(moved.find((m) => m.uid === e1).attrs.spoolUid, s2);
});

// ── dependencies, guard, validation (pure) ──────────────────────────────

const full = () => P([spool(s1, "SP-1"), weld(w1, "W-1", "SP-1", s1), equip(e1, "V-1", { spoolUid: s1, spool: "SP-1", status: "planned" })], { weldList: [{ uid: w2, no: "W-2", spoolUid: s1, spool: "SP-1", loc: "Shop" }], cutLengths: [{ uid: newUid(), piece: 1, lengthMm: 100, spoolUid: s1 }] });

test("E5. the dependency model: sheet weld, typed row, cut piece, equipment — each by uid; installed/tested is said (the register's status wins)", () => {
  const d = spoolDependencies(full(), s1);
  equal(d.dependents.map((x) => `${x.type}:${x.via}`).sort(), ["cut:cutLengths", "equipment:sheetMarkup", "weld:sheetMarkup", "weld:weldList"]);
  equal(d.locked, false);
  const locked = spoolDependencies(full(), s1, { statusOf: new Map([[e1.toLowerCase(), "installed"]]) });
  assert(locked.locked && locked.dependents.find((x) => x.type === "equipment").locked);
});

test("E6. removing a spool that is still named is refused with the dependents listed; once nothing names it, it can go; nothing is detached for the caller", () => {
  const prev = full().sheetMarkup.items, now = full(); now.sheetMarkup.items = now.sheetMarkup.items.filter((m) => m.kind !== "spool");
  equal(removedSpools(prev, now.sheetMarkup.items).map((x) => x.uid), [s1]);
  let err = null; try { assertSpoolsRemovable({ previousItems: prev, payload: now }); } catch (e) { err = e; }
  assert(err && err.status === 409 && err.code === "SPOOL_IN_USE" && err.details.spools[0].dependents.length === 4);
  assert(eqOf(now, e1).attrs.spoolUid === s1, "the equipment still names it — the check did not touch it");
  const cleared = { ...now, weldList: [{ ...now.weldList[0], spoolUid: "", spool: "" }], cutLengths: [{ ...now.cutLengths[0], spoolUid: "" }],
    sheetMarkup: { items: now.sheetMarkup.items.map((m) => ({ ...m, attrs: m.attrs && { ...m.attrs, spoolUid: undefined, spool: undefined } })) } };
  assertSpoolsRemovable({ previousItems: prev, payload: cleared });
});

test("E7. Validation Center: E_SPOOL_DANGLING / E_SPOOL_AMBIGUOUS / SP_EQUIPMENT_UNKNOWN / SP_EQUIPMENT_REFERENCE / WELD_SPOOL_REFERENCE / SP_DELETE_DEPENDENCY with uid, entity type, revision, severity, action", () => {
  const items = [spool(s1, "SP-1"), spool(s2, "SP-2"), weld(w1, "W-1", "SP-1", s1),
    equip("11111111-1111-4111-8111-111111111111", "A", { spoolUid: newUid(), spool: "SP-1" }),
    equip("22222222-2222-4222-8222-222222222222", "B", { spool: "SP-9" }),
    equip("33333333-3333-4333-8333-333333333333", "C", { spoolUid: s2, spool: "SP-OLD" }),
    { ...spool(newUid(), "SP-1") }];
  const r = validate({ payload: P(items), revision: { documentId: "d", rev: "1" }, source: "draft" });
  for (const c of ["E_SPOOL_DANGLING", "SP_EQUIPMENT_UNKNOWN", "SP_EQUIPMENT_REFERENCE", "WELD_SPOOL_REFERENCE"]) assert(codes(r).includes(c), `${c} in ${codes(r)}`);
  const amb = validate({ payload: P([spool(s1, "SP-1"), spool(s2, "SP-1"), equip(e1, "V", { spool: "SP-1" })]), source: "draft" });
  assert(codes(amb).includes("E_SPOOL_AMBIGUOUS"));
  const d = r.findings.find((f) => f.code === "E_SPOOL_DANGLING");
  assert(isUid(d.entityUid) && d.entityType === "equipment" && d.severity === "error" && d.suggestedAction === "equipment-form" && d.revision.documentId === "d" && d.blocking === false);
  const del = validate({ payload: { ...full(), sheetMarkup: { items: full().sheetMarkup.items.filter((m) => m.kind !== "spool") } }, previous: full(), source: "draft" });
  const f = del.findings.find((x) => x.code === "SP_DELETE_DEPENDENCY");
  assert(f && f.blocking === true && f.entityUid === s1 && f.entityType === "spool" && f.detail.dependents.length >= 3);
  assert(!codes(validate({ payload: full(), previous: full(), source: "draft" })).includes("SP_DELETE_DEPENDENCY"), "nothing removed, nothing said");
});

test("E8. deletion preview (markup.dependents) lists welds, equipment (installed said) and cut pieces by uid", () => {
  const items = [spool(s1, "SP-1"), weld(w1, "W-1", "SP-1", s1), equip(e1, "V-1", { spoolUid: s1, status: "installed" })];
  const lines = dependents(items, "sSP-1", [{ piece: 3, spoolUid: s1 }]);
  assert(lines.some((l) => /تجهیز V-1.*نصب/.test(l)) && lines.some((l) => /سرجوش W-1/.test(l)) && lines.some((l) => /قطعهٔ برش <3>/.test(l)));
});

// ── revisions (pure) ────────────────────────────────────────────────────

const [fa, fs, ta, ts, fe, te, fw, tw] = Array.from({ length: 8 }, newUid);
const revFrom = () => ({ payload: P([spool(fs, "SP-1"), weld(fw, "W-1", "SP-1", fs), equip(fe, "V-1", { spoolUid: fs, spool: "SP-1", status: "installed", weldRefs: fw })]) });
const revTo = (eAttrs = {}, spoolNo = "SP-7") => ({ payload: P([spool(ts, spoolNo), weld(tw, "W-1", "", null), equip(te, "V-1", { weldRefs: tw, ...eAttrs })]) });
const MAPS = [{ cls: "spool", fromUid: fs, toUid: ts }, { cls: "weld", fromUid: fw, toUid: tw }, { cls: "equipment", fromUid: fe, toUid: te }];
const ch = (r, pred) => r.changes.find((c) => c.cls === "equipment" && c.category === "equipment" && pred(c));

test("R1. carry: the equipment's spool goes as the TARGET's own uid through an explicit spool mapping; a source uid is never copied; status/history stay", () => {
  const r = diffRevisions({ from: revFrom(), to: revTo(), mappings: MAPS });
  const c = ch(r, (x) => x.fromUid === fe);
  const ready = c.carry.ready.find((x) => x.field === "spool");
  equal([ready.value, c.carry.ready.some((x) => x.field === "status")], [ts, false]);
  const out = applyCarry(revTo().payload, [{ klass: "equipment", toUid: te, values: { spool: ready.value } }]);
  const e = eqOf(out, te);
  equal([e.attrs.spoolUid, e.attrs.spool, e.attrs.status], [ts, "SP-7", undefined]);
  assert(!JSON.stringify(out).includes(fs), "the source spool's uid is nowhere in the target");
});

test("R2. no spool mapping, a spool not in the target, or a target that already has one: nothing is carried (explicit reasons)", () => {
  const no = diffRevisions({ from: revFrom(), to: revTo(), mappings: MAPS.filter((m) => m.cls !== "spool") });
  assert(ch(no, (x) => x.fromUid === fe).carry.blocked.some((b) => b.field === "spool" && b.reason === "NO_MAPPED_SPOOL"));
  const has = diffRevisions({ from: revFrom(), to: revTo({ spoolUid: ts, spool: "SP-7" }), mappings: MAPS });
  const c = ch(has, (x) => x.fromUid === fe);
  assert(c.carry.blocked.some((b) => b.field === "spool" && b.reason === "TARGET_HAS_VALUE") && !c.carry.ready.some((x) => x.field === "spool"), "the target's own relationship is preserved");
  const gone = revTo(); gone.payload.sheetMarkup.items = gone.payload.sheetMarkup.items.filter((m) => m.kind !== "spool");
  assert(ch(diffRevisions({ from: revFrom(), to: gone, mappings: MAPS }), (x) => x.fromUid === fe).carry.blocked.some((b) => b.reason === "SPOOL_NOT_IN_TARGET"));
});

test("R3. comparison: a renumbered spool with the same relationship is NOT a relationship change; a different mapped spool IS", () => {
  const same = diffRevisions({ from: revFrom(), to: revTo({ spoolUid: ts, spool: "SP-7" }), mappings: MAPS });
  assert(!ch(same, (x) => x.fromUid === fe).fields.some((f) => f.field === "spool"), "SP-1 → SP-7 by mapping: a renumbering");
  assert(!same.changes.some((c) => c.id === `rel:spool:${fe}`));
  const other = newUid();
  const moved = revTo({ spoolUid: other, spool: "SP-8" }); moved.payload.sheetMarkup.items.push(spool(other, "SP-8"));
  const r = diffRevisions({ from: revFrom(), to: moved, mappings: MAPS });
  assert(r.changes.some((c) => c.id === `rel:spool:${fe}` && c.cls === "equipment" && c.category === "spool"));
});

// ── the server ──────────────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("p10-db-");
process.env.STORAGE_ROOT = await scratchDir("p10-store-");
const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const runsRoute = await import("../../app/api/runs/route.js");
const editsRoute = await import("../../app/api/runs/[id]/edits/route.js");
const validationRoute = await import("../../app/api/validation/route.js");
const revRoute = await import("../../app/api/revisions/route.js");
const carryRoute = await import("../../app/api/revisions/carry/route.js");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const { payloadHash } = await import("../../lib/review/payload-hash.mjs");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) => new Request(url, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const db = await getDb();
const projectId = (await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", body: { code: "P10", name: "P10" } })))).body.project.id;
const q = (sql, p = []) => withProject(db, projectId, async () => (await db.query(sql, p)).rows);
let seq = 0;
const newDoc = async (docNo, revision = "0") => (await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST", body: { projectId, docNo, revision, fileBase64: Buffer.from(`scan ${docNo} ${revision} ${++seq}`).toString("base64") } })))).body.document.id;
const R = (no, o = {}) => ({ no, spool: "", loc: "Field", kind: "BW", nps: "4", ...o });
const mk = (rows, items, extra = {}) => ({ meta: { drawingNo: "P10-1", sheet: "1/1", lineNo: "P10-L1", nps: 4 }, weldList: rows, bom: [], sheetMarkup: { page: 1, items }, ...extra });
const post = async (documentId, payload) => json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId, documentId, lineNo: "P10-L1", payload } })));
const latest = async (doc) => (await q("SELECT payload, id FROM extraction_run WHERE document_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1", [doc]))[0];
const runCount = async (doc) => (await q("SELECT count(*)::int AS n FROM extraction_run WHERE document_id = $1", [doc]))[0].n;
const correct = async (runId, payload, baseHash) => json(await editsRoute.POST(req(`http://x/api/runs/${runId}/edits`, { method: "POST", body: { projectId, payload, baseHash } }), { params: Promise.resolve({ id: runId }) }));
const validationOf = async (doc) => json(await validationRoute.GET(req(`http://x/api/validation?projectId=${projectId}&documentId=${doc}`)));
const D = { a: null, s1: newUid(), s2: newUid(), w: newUid(), e: newUid() };

test("S1. save: an equipment's legacy printed spool is settled to its uid on the server; unrelated attributes survive; reload keeps it", async () => {
  D.a = await newDoc("P10-X");
  const r = await post(D.a, mk([R("W-1", { uid: D.w })], [spool(D.s1, "SP-1"), spool(D.s2, "SP-2"), equip(D.e, "V-1", { weldRefs: D.w, spool: "SP-1", note: "keep" })], { cutLengths: [{ piece: 1, lengthMm: 500, ns: "4", spool: "SP-1" }] }));
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  const p = (await latest(D.a)).payload, e = eqOf(p, D.e);
  equal([e.attrs.spoolUid, e.attrs.spool, e.attrs.note, e.attrs.tag], [D.s1, "SP-1", "keep", "XV-V-1"]);
  equal(p.cutLengths[0].spoolUid, D.s1);
  equal((await post(D.a, p)).status, 201);
  equal(eqOf((await latest(D.a)).payload, D.e).attrs.spoolUid, D.s1);
});

test("S2. renumbering the spool through a correction keeps the equipment's relationship (same uid); the label follows", async () => {
  const cur = await latest(D.a);
  const next = { ...cur.payload, sheetMarkup: { ...cur.payload.sheetMarkup, items: cur.payload.sheetMarkup.items.map((m) => (m.uid === D.s1 ? { ...m, no: "SP-A" } : m)) } };
  const r = await correct(cur.id, next, payloadHash(cur.payload));
  equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const e = eqOf((await latest(D.a)).payload, D.e);
  equal([e.attrs.spoolUid, e.attrs.spool], [D.s1, "SP-A"]);
});

test("S3. deleting a spool that equipment, a weld and a cut piece still name is REFUSED (409 SPOOL_IN_USE, dependents listed), on both save paths; nothing is stored or detached", async () => {
  const cur = await latest(D.a), before = JSON.stringify(cur.payload), n0 = await runCount(D.a);
  const p = { ...cur.payload, sheetMarkup: { ...cur.payload.sheetMarkup, items: cur.payload.sheetMarkup.items.filter((m) => m.uid !== D.s1) } };
  const viaRuns = await post(D.a, p);
  equal([viaRuns.status, viaRuns.body.code], [409, "SPOOL_IN_USE"]);
  const deps = viaRuns.body.details.spools[0].dependents;
  assert(deps.some((d) => d.type === "equipment" && d.uid === D.e) && deps.some((d) => d.type === "cut") , JSON.stringify(deps));
  const viaCorrection = await correct(cur.id, p, payloadHash(cur.payload));
  equal([viaCorrection.status, viaCorrection.body.code], [409, "SPOOL_IN_USE"]);
  equal(JSON.stringify((await latest(D.a)).payload), before, "stored payload untouched");
  equal(await runCount(D.a), n0, "no new run");
  assert(eqOf((await latest(D.a)).payload, D.e).attrs.spoolUid === D.s1);
});

test("S4. installed equipment on the spool: refusal says so; its installed status is untouched", async () => {
  // the equipment is installed on site: the register's status (the mark's attribute, synced to iso_equipment)
  const base = (await latest(D.a)).payload;
  equal((await post(D.a, { ...base, sheetMarkup: { ...base.sheetMarkup, items: base.sheetMarkup.items.map((m) => (m.uid === D.e ? { ...m, attrs: { ...m.attrs, status: "installed" } } : m)) } })).status, 201);
  equal((await q("SELECT status FROM iso_equipment WHERE document_id = $1", [D.a]))[0].status, "installed");
  const cur = await latest(D.a);
  const p = { ...cur.payload, sheetMarkup: { ...cur.payload.sheetMarkup, items: cur.payload.sheetMarkup.items.filter((m) => m.uid !== D.s1) } };
  const r = await post(D.a, p);
  equal(r.status, 409);
  assert(r.body.details.spools[0].locked === true && r.body.details.spools[0].dependents.find((d) => d.type === "equipment").locked === true && /نصب/.test(r.body.error));
  equal((await q("SELECT status FROM iso_equipment WHERE document_id = $1", [D.a]))[0].status, "installed");
});

test("S5. the authoritative read recomputes from the PERSISTED state", async () => {
  const r = await json(await validationRoute.GET(req(`http://x/api/validation?projectId=${projectId}&documentId=${D.a}&spoolUid=${D.s1}`)));
  equal(r.status, 200);
  equal([r.body.count, r.body.locked, r.body.spool.no], [2, true, "SP-A"]);   // the equipment (installed) and the cut piece
  const none = await json(await validationRoute.GET(req(`http://x/api/validation?projectId=${projectId}&documentId=${D.a}&spoolUid=${D.s2}`)));
  equal(none.body.count, 0);
});

test("S6. after an explicit reassignment (equipment and cut piece to SP-2, weld has none) the spool CAN be deleted; the equipment stays installed and linked to SP-2", async () => {
  const cur = await latest(D.a);
  const re = cur.payload.sheetMarkup.items.filter((m) => m.uid !== D.s1).map((m) => (m.uid === D.e ? { ...m, attrs: { ...m.attrs, ...assignWeldSpool(m.attrs, spool(D.s2, "SP-2")) } } : m));
  const next = { ...cur.payload, sheetMarkup: { ...cur.payload.sheetMarkup, items: re }, cutLengths: cur.payload.cutLengths.map((c) => ({ ...c, spoolUid: D.s2, spool: "SP-2" })) };
  const r = await post(D.a, next);
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 400));
  const p = (await latest(D.a)).payload;
  equal([p.sheetMarkup.items.some((m) => m.uid === D.s1), eqOf(p, D.e).attrs.spoolUid, p.cutLengths[0].spoolUid], [false, D.s2, D.s2]);
  equal((await q("SELECT status FROM iso_equipment WHERE document_id = $1", [D.a]))[0].status, "installed");
});

test("S7. a stale edit is refused (STALE_RUN) before anything is decided; a dangling uid then stays visible, never silently replaced", async () => {
  const cur = await latest(D.a);
  const stale = await correct(cur.id, { ...cur.payload, meta: { ...cur.payload.meta, lineNo: "P10-STALE" } }, "0".repeat(64));
  equal([stale.status, stale.body.code], [409, "STALE_RUN"]);
  equal((await latest(D.a)).payload.meta.lineNo, cur.payload.meta.lineNo, "the stale edit changed nothing");
  const dang = { ...cur.payload, sheetMarkup: { ...cur.payload.sheetMarkup, items: cur.payload.sheetMarkup.items.map((m) => (m.uid === D.e ? { ...m, attrs: { ...m.attrs, spoolUid: newUid(), spool: "SP-2" } } : m)) } };
  equal((await post(D.a, dang)).status, 201, "a dangling uid is a finding, not a refusal");
  const v = await validationOf(D.a);
  assert(v.body.findings.some((f) => f.code === "E_SPOOL_DANGLING" && f.entityUid === D.e));
  assert(eqOf((await latest(D.a)).payload, D.e).attrs.spoolUid !== D.s2, "SP-2 exists, but the old number did not re-point it");
});

test("S8. concurrent saves are serialized: one removes an unreferenced spool, one starts referencing it — both complete, the stored state has no dangling reference", async () => {
  const doc = await newDoc("P10-C");
  const c1 = newUid(), c2 = newUid(), cw = newUid(), ce = newUid();
  equal((await post(doc, mk([R("W-1", { uid: cw })], [spool(c1, "SP-1"), spool(c2, "SP-2"), equip(ce, "V-1", { weldRefs: cw })]))).status, 201);
  const cur = (await latest(doc)).payload;
  const remove = { ...cur, sheetMarkup: { ...cur.sheetMarkup, items: cur.sheetMarkup.items.filter((m) => m.uid !== c2) } };
  const refer = { ...cur, sheetMarkup: { ...cur.sheetMarkup, items: cur.sheetMarkup.items.map((m) => (m.uid === ce ? { ...m, attrs: { ...m.attrs, spoolUid: c2, spool: "SP-2" } } : m)) } };
  const rs = await Promise.all([post(doc, remove), post(doc, refer)]);
  assert(rs.every((r) => r.status === 201 || r.status === 409), JSON.stringify(rs.map((r) => r.status)));
  const v = await validationOf(doc);
  assert(!v.body.findings.some((f) => f.code === "E_SPOOL_DANGLING" || f.code === "SP_DELETE_DEPENDENCY"), JSON.stringify(v.body.findings.map((f) => f.code)));
});

const pairs = async (a, b) => json(await revRoute.GET(req(`http://x/api/revisions?projectId=${projectId}&documentId=${a}&compareTo=${b}`)));
const carry = async (body) => json(await carryRoute.POST(req("http://x/api/revisions/carry", { method: "POST", body: { projectId, ...body } })));
const X = { sa: newUid(), sb: newUid(), ea: newUid(), eb: newUid(), wa: newUid(), wb: newUid() };

test("S9. revisions: with the spool pair confirmed, the equipment's spool is carried as the TARGET's uid; without it nothing is; the source revision never changes", async () => {
  X.a = await newDoc("P10-R");
  equal((await post(X.a, mk([R("W-1", { uid: X.wa })], [spool(X.sa, "SP-1"), equip(X.ea, "V-1", { weldRefs: X.wa, spoolUid: X.sa, spool: "SP-1" })]))).status, 201);
  const mkRev = await json(await revRoute.POST(req("http://x/api/revisions", { method: "POST", body: { projectId, action: "create", sourceDocumentId: X.a, revision: "1", noFile: true } })));
  equal(mkRev.status, 201); X.b = mkRev.body.document.id;
  equal((await post(X.b, mk([R("W-1", { uid: X.wb })], [spool(X.sb, "SP-1"), equip(X.eb, "V-1", { weldRefs: X.wb })]))).status, 201);
  const beforeA = JSON.stringify((await latest(X.a)).payload);
  let cmp = await pairs(X.a, X.b);
  equal(cmp.status, 200, JSON.stringify(cmp.body).slice(0, 200));
  const hashes = { fromHash: cmp.body.from.hash, toHash: cmp.body.to.hash };
  // without the spool mapping: refused, target unchanged
  const bad = await carry({ fromDocumentId: X.a, toDocumentId: X.b, ...hashes, requestKey: "p10-carry-0001", decisions: [
    { key: `equipment:${X.ea}`, pair: { fromUid: X.ea, toUid: X.eb }, fields: ["spool"] }] });
  equal(bad.status, 409, JSON.stringify(bad.body).slice(0, 200));
  equal(eqOf((await latest(X.b)).payload, X.eb).attrs.spoolUid, undefined);
  // with it
  const ok = await carry({ fromDocumentId: X.a, toDocumentId: X.b, ...hashes, requestKey: "p10-carry-0002", decisions: [
    { key: `spool:${X.sa}`, pair: { fromUid: X.sa, toUid: X.sb } }, { key: `equipment:${X.ea}`, pair: { fromUid: X.ea, toUid: X.eb }, fields: ["spool"] }] });
  equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 300));
  const e = eqOf((await latest(X.b)).payload, X.eb);
  equal([e.attrs.spoolUid, e.attrs.spool], [X.sb, "SP-1"]);
  assert(!JSON.stringify((await latest(X.b)).payload).includes(X.sa), "the source spool uid never reaches the target");
  equal(JSON.stringify((await latest(X.a)).payload), beforeA, "the source revision is untouched");
  assert((await q("SELECT count(*)::int AS n FROM iso_equipment WHERE document_id = $1 AND status <> 'planned'", [X.b]))[0].n === 0, "no installation history copied");
});

await run();
