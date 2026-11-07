#!/usr/bin/env node
/**
 * Phase 12.2 — extraction-run isolation (docs/audit/phase-12-sld-intelligence.md §15.1, §16.6, §16.7).
 * `extraction_run` and `reporting.current_run` are shared by every drawing discipline. This proves that a P&ID or SLD run, document or edit can neither enter
 * an isometric (weld-register) workflow nor change any figure of it, and that nothing an isometric project shows changed by adding the guards:
 *
 *   A. an ISOMETRIC-ONLY project (runs, a correction, a signed register); every guarded output is captured canonically (S0);
 *      each guarded figure equals the figure of the REFERENCE query — the original, unguarded SQL kept verbatim below — byte for byte.
 *   B. a P&ID and an SLD are added, each with runs, an extraction edit and a signed draft; every guarded output is captured again (S1): S1 === S0.
 *      The reference (unguarded) queries DO move — which is how the test shows the leak existed and that it is what the guards stop.
 *   C. every isometric run-id route and every isometric document-id route refuses the P&ID / SLD run or document (409), writes nothing, and keeps
 *      authorization and project scope (403 / 404 as before); the isometric routes keep working.
 *   D. a source-scan: every source file that reads reporting.current_run / extraction_run / extraction_edit is in a reviewed list; a new, unreviewed reader fails.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("iso-db-");
process.env.STORAGE_ROOT = await scratchDir("iso-store-");
const R = (p) => import(`../../${p}`);
const projectsRoute = await R("app/api/projects/route.js"), documentsRoute = await R("app/api/documents/route.js"), runsRoute = await R("app/api/runs/route.js");
const runRoute = await R("app/api/runs/[id]/route.js"), editsRoute = await R("app/api/runs/[id]/edits/route.js"), approveRoute = await R("app/api/runs/[id]/approve/route.js");
const diffRoute = await R("app/api/runs/[id]/diff/route.js"), ndtRoute = await R("app/api/runs/[id]/ndt-sample/route.js");
const validationRoute = await R("app/api/validation/route.js"), overviewRoute = await R("app/api/overview/route.js"), queueRoute = await R("app/api/review-queue/route.js");
const pidRoute = await R("app/api/pid/route.js"), pidReview = await R("app/api/pid/review/route.js"), sldRoute = await R("app/api/sld/route.js"), sldReview = await R("app/api/sld/review/route.js");
const { getDb } = await R("lib/server/db.mjs"), { withProject } = await R("lib/db/scope.mjs");
const { addMember, ensureUser } = await R("lib/db/repos/projects.mjs");
const reviewRepo = await R("lib/db/repos/review.mjs"), hub = await R("lib/db/repos/piping-hub.mjs"), reports = await R("lib/db/repos/piping-reports.mjs"), logRepo = await R("lib/db/repos/log.mjs");
const joint = await R("lib/db/repos/joint.mjs"), validationRepo = await R("lib/db/repos/validation.mjs"), revisions = await R("lib/db/repos/revisions.mjs"), lifecycle = await R("lib/db/repos/revision-lifecycle.mjs");
const runsRepo = await R("lib/db/repos/runs.mjs");
const { DEMO } = await R("lib/demo.js");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) => new Request(url, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const db = await getDb();
const mkProject = async (code, as = "kc|alice") => (await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", as, body: { code, name: code } })))).body.project.id;
const P = await mkProject("ISO1"), OTHER = await mkProject("ISO2", "kc|mallory");
const inP = (fn, pid = P) => withProject(db, pid, fn);
const q = (sql, p = [], pid = P) => inP(async () => (await db.query(sql, p)).rows, pid);
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
let seq = 0;
const newDoc = async (docNo, docType, revision = "0") => { const r = await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST", body: { projectId: P, docNo, revision, ...(docType ? { docType } : {}), fileBase64: Buffer.from(`f ${docNo} ${revision} ${++seq}`).toString("base64"), contentType: "application/pdf" } }))); assert(r.status === 201, JSON.stringify(r.body)); return r.body.document; };
const isoPayload = (docNo) => ({ ...JSON.parse(JSON.stringify(DEMO)), meta: { ...DEMO.meta, drawingNo: docNo, sheet: "1/1" } });
const saveIso = async (doc) => json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId: P, documentId: doc.id, lineNo: `L-${doc.doc_no}`, payload: isoPayload(doc.doc_no) } })));
const call = async (route, method, url, body, as = "kc|alice") => json(await route[method](req(url, { method, as, body }), { params: Promise.resolve({ id: url.split("/api/runs/")[1]?.split(/[/?]/)[0] }) }));
const approvedBy = async () => (await ensureUser(db, { subject: "kc|alice" })).id;
const approveSql = async (runId) => q("UPDATE extraction_run SET status = 'approved', approved_by = $2, approved_at = now(), approved_sha256 = repeat('a', 64) WHERE id = $1", [runId, await approvedBy()]);
const D = {};

// ── the REFERENCE figures: the original SQL of each guarded consumer, unguarded, kept verbatim ──────────────────────────
const reference = () => inP(async () => {
  const one = async (sql, p = [P]) => (await db.query(sql, p)).rows[0];
  return {
    hotspotsEdits: (await one("SELECT count(*)::int AS n FROM extraction_edit WHERE project_id = $1")).n,
    hub: await one(`SELECT count(*) FILTER (WHERE r.status = 'approved')::int AS approved, count(*)::int AS current
                      FROM reporting.current_run c JOIN extraction_run r ON r.id = c.run_id WHERE r.project_id = $1`),
    logApproved: (await one("SELECT count(*)::int AS n FROM extraction_run r JOIN document d ON d.id = r.document_id WHERE r.project_id = $1 AND r.approved_by IS NOT NULL")).n,
    overview: await one(`SELECT COUNT(DISTINCT d.id)::int AS total, COUNT(DISTINCT r.document_id) FILTER (WHERE r.status = 'approved')::int AS approved
                           FROM document d LEFT JOIN extraction_run r ON r.document_id = d.id WHERE d.project_id = $1`),
    drawings: (await one("SELECT count(*)::int AS n FROM reporting.current_run c JOIN extraction_run r ON r.id = c.run_id JOIN document d ON d.id = r.document_id WHERE r.project_id = $1")).n,
    queue: (await db.query("SELECT d.doc_no FROM extraction_run r JOIN document d ON d.id = r.document_id WHERE r.project_id = $1 AND r.status = 'extracted' AND COALESCE(r.pass_name, '') <> 'pid' ORDER BY d.doc_no", [P])).rows.map((x) => x.doc_no),
  };
});

// ── the GUARDED outputs: every function and route of the Phase 12.1 inventory marked L, captured canonically ──────────────
const REPORT_DATE = new Date("2026-01-01T00:00:00Z");
const snapshot = async () => inP(async () => {
  const out = {};
  out.hotspots = await reviewRepo.hotspots(db, { projectId: P });
  out.queue = (await reviewRepo.reviewQueue(db, { projectId: P })).map((r) => [r.docNo, r.status, r.welds, r.edits]);
  const h = await hub.pipingHub(db, { projectId: P }); out.hubTotals = h.totals;
  out.reports = {}; for (const k of reports.REPORT_KINDS) out.reports[k] = JSON.parse(JSON.stringify(await reports.pipingReport(db, { projectId: P, kind: k, now: REPORT_DATE })));
  out.log = (await logRepo.sectionLog(db, { projectId: P, section: "piping" })).map((l) => [l.action, l.label]);
  out.tieIn = await joint.tieInReferrers(db, { projectId: P, doc: "NO-SUCH", sheet: "1/1", weld: "1" });
  out.validation = {}; for (const d of D.iso) { const v = await validationRepo.validationFor(db, { projectId: P, documentId: d.id }); out.validation[d.doc_no] = { revision: v.revision, summary: v.summary, n: v.findings.length }; }
  return out;
});
const routeSnapshot = async () => {
  const out = { overview: (await json(await overviewRoute.GET(req(`http://x/api/overview?projectId=${P}`)))).body, queueRoute: (await json(await queueRoute.GET(req(`http://x/api/review-queue?projectId=${P}`)))).body };
  for (const d of D.iso) {
    out[`runs:${d.doc_no}`] = (await json(await runsRoute.GET(req(`http://x/api/runs?projectId=${P}&documentId=${d.id}`)))).body;
    const run = D.runOf[d.doc_no];
    out[`run:${d.doc_no}`] = (await call(runRoute, "GET", `http://x/api/runs/${run}?projectId=${P}`)).body;
    out[`edits:${d.doc_no}`] = (await call(editsRoute, "GET", `http://x/api/runs/${run}/edits?projectId=${P}`)).body;
    out[`diff:${d.doc_no}`] = (await call(diffRoute, "GET", `http://x/api/runs/${run}/diff?projectId=${P}`)).body;
    out[`validation:${d.doc_no}`] = (await json(await validationRoute.GET(req(`http://x/api/validation?projectId=${P}&documentId=${d.id}`)))).body;
  }
  return out;
};
// volatile fields (generatedAt-style) are removed so two captures of unchanged data compare byte for byte
const stable = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === "generatedAt" || k === "now" ? undefined : x)));

// ── A. isometric-only ────────────────────────────────────────────────────────────────────────────────────────────────────
test("A1. an isometric-only project: runs, a correction and a signed register exist; the guarded figures equal the reference (original, unguarded) figures", async () => {
  D.iso = [await newDoc("ISO-A", undefined), await newDoc("ISO-B", "isometric")];
  D.runOf = {};
  for (const d of D.iso) { const r = await saveIso(d); assert(r.status === 201, JSON.stringify(r.body).slice(0, 200)); D.runOf[d.doc_no] = r.body.run.id; }
  const g = await call(runRoute, "GET", `http://x/api/runs/${D.runOf["ISO-A"]}?projectId=${P}`); assert(g.status === 200);
  const edited = JSON.parse(JSON.stringify(g.body.payload)); edited.meta = { ...edited.meta, note: "corrected" };
  const c = await call(editsRoute, "POST", `http://x/api/runs/${D.runOf["ISO-A"]}/edits`, { projectId: P, payload: edited, reason: "test correction", baseHash: g.body.run.payloadHash });
  assert(c.status === 200, JSON.stringify(c.body).slice(0, 300));
  const ap = await call(approveRoute, "POST", `http://x/api/runs/${D.runOf["ISO-A"]}/approve`, { projectId: P }); assert(ap.status === 200, JSON.stringify(ap.body).slice(0, 200));
  const s = await snapshot(), ref = await reference();
  equal(s.hotspots.totalEdits, ref.hotspotsEdits, "hotspots = every edit (all of them isometric)");
  equal([s.hubTotals.drawings, s.hubTotals.drawingsApproved], [ref.hub.current, ref.hub.approved]);
  equal(s.log.filter(([, l]) => /رجیستر جوش/.test(l || "")).length, ref.logApproved);
  const ov = (await json(await overviewRoute.GET(req(`http://x/api/overview?projectId=${P}`)))).body.documents; equal([ov.total, ov.approved], [ref.overview.total, ref.overview.approved]);
  equal(s.queue.map((x) => x[0]).sort(), ref.queue, "the review queue = the original queue");
  equal(ref.drawings, 2); equal(s.hubTotals.drawings, 2);
  D.S0 = canon(stable(s)); D.R0 = canon((await routeSnapshot()) && stable(await routeSnapshot()));
  assert(s.hotspots.totalEdits >= 1 && ref.hotspotsEdits >= 1, "the fixture has an edit to count");
});

// ── B. add the other disciplines ─────────────────────────────────────────────────────────────────────────────────────────
const PIDOCR = { page: 1, w: 1000, h: 800, items: [{ t: "30-P-1201A", b: [100, 100, 170, 118], c: 0.9 }, { t: "30-E-1129", b: [300, 100, 370, 118], c: 0.9 }] };
test("B1. a P&ID and an SLD are added — documents, runs, an extraction edit each, a signed draft each; no guarded output moves, byte for byte", async () => {
  D.pid = await newDoc("PID-X", "pid"); D.sld = await newDoc("SLD-X", "sld");
  const pi = await json(await pidRoute.POST(req("http://x/api/pid", { method: "POST", body: { projectId: P, documentId: D.pid.id, ocr: PIDOCR } }))); assert(pi.status === 201, JSON.stringify(pi.body).slice(0, 200));
  D.pidRun = pi.body.run.id;
  const g = (await json(await pidRoute.GET(req(`http://x/api/pid?projectId=${P}&documentId=${D.pid.id}`)))).body;
  const pe = await json(await pidReview.POST(req("http://x/api/pid/review", { method: "POST", body: { projectId: P, runId: D.pidRun, uid: g.draft.items[0].uid, action: "correct", value: { tag: "30-P-1201B" }, reason: "t", baseHash: g.run.payloadHash } }))); assert(pe.status === 200, JSON.stringify(pe.body).slice(0, 200));
  const env = (items) => ({ kind: "sld", schema: 1, meta: {}, page: {}, items, edges: [], source: { kind: "t", reader: "t", hash: `h-${items.length}`, generatedAt: "2026-11-07T10:00:00Z" } });
  const si = await json(await sldRoute.POST(req("http://x/api/sld", { method: "POST", body: { projectId: P, documentId: D.sld.id, draft: env([{ a: 1 }]) } }))); assert(si.status === 201, JSON.stringify(si.body).slice(0, 200));
  D.sldRun = si.body.run.id;
  const se = await json(await sldReview.POST(req("http://x/api/sld/review", { method: "POST", body: { projectId: P, runId: D.sldRun, action: "edit", draft: env([{ a: 1 }, { b: 2 }]), baseHash: si.body.run.payloadHash, reason: "t" } }))); assert(se.status === 200, JSON.stringify(se.body).slice(0, 200));
  assert((await json(await sldReview.POST(req("http://x/api/sld/review", { method: "POST", body: { projectId: P, runId: D.sldRun, action: "approve" } })))).status === 200);
  await approveSql(D.pidRun);
  // a SECOND document per discipline with a plain extracted run, so the queue / hub are exercised with non-approved runs too
  const pid2 = await newDoc("PID-Y", "pid"); await json(await pidRoute.POST(req("http://x/api/pid", { method: "POST", body: { projectId: P, documentId: pid2.id, ocr: PIDOCR } })));
  const sld2 = await newDoc("SLD-Y", "sld"); await json(await sldRoute.POST(req("http://x/api/sld", { method: "POST", body: { projectId: P, documentId: sld2.id, draft: env([]) } })));

  const ref = await reference();
  const s = await snapshot();
  equal(canon(stable(s)), D.S0, "every guarded function returns exactly what it returned for the isometric-only project");
  equal(canon(stable(await routeSnapshot())), D.R0, "every guarded route returns exactly what it returned for the isometric-only project");
  // the reference (unguarded) figures DID move: the leak is real, and these are the figures the guards protect
  assert(ref.hotspotsEdits > s.hotspots.totalEdits, `unguarded hotspots would count ${ref.hotspotsEdits} edits, guarded ${s.hotspots.totalEdits}`);
  assert(ref.hub.current > s.hubTotals.drawings && ref.hub.approved > s.hubTotals.drawingsApproved, "unguarded piping hub would count the P&ID / SLD drawings");
  assert(ref.logApproved > s.log.filter(([, l]) => /رجیستر جوش/.test(l || "")).length, "unguarded activity log would show them as weld registers");
  assert(ref.overview.total > 2 && ref.overview.approved > 1, "unguarded overview would count them");
  assert(ref.drawings > 2, "unguarded current_run readers would list them");
});

// ── C. the isometric routes refuse another discipline's run and document ────────────────────────────────────────────────
test("C1. every run-id route of the isometric workflow refuses a P&ID / SLD run with 409 NOT_AN_ISOMETRIC_RUN and changes nothing", async () => {
  const before = await q("SELECT id, status, payload, approved_sha256 FROM extraction_run WHERE id = ANY($1) ORDER BY id", [[D.pidRun, D.sldRun]]);
  const editsBefore = (await q("SELECT count(*)::int AS n FROM extraction_edit"))[0].n;
  for (const [name, run] of [["pid", D.pidRun], ["sld", D.sldRun]]) {
    const calls = [
      ["GET run", () => call(runRoute, "GET", `http://x/api/runs/${run}?projectId=${P}`)],
      ["GET edits", () => call(editsRoute, "GET", `http://x/api/runs/${run}/edits?projectId=${P}`)],
      ["POST edits", () => call(editsRoute, "POST", `http://x/api/runs/${run}/edits`, { projectId: P, payload: { meta: {} }, reason: "x" })],
      ["POST approve", () => call(approveRoute, "POST", `http://x/api/runs/${run}/approve`, { projectId: P })],
      ["GET diff", () => call(diffRoute, "GET", `http://x/api/runs/${run}/diff?projectId=${P}`)],
      ["GET diff against", () => call(diffRoute, "GET", `http://x/api/runs/${run}/diff?projectId=${P}&against=${D.runOf["ISO-A"]}`)],
      ["GET diff from iso", () => call(diffRoute, "GET", `http://x/api/runs/${D.runOf["ISO-A"]}/diff?projectId=${P}&against=${run}`)],
      ["POST ndt", () => call(ndtRoute, "POST", `http://x/api/runs/${run}/ndt-sample`, { projectId: P, pipingClassCode: "A1" })],
    ];
    for (const [label, fn] of calls) { const r = await fn(); equal([r.status, r.body.code], [409, "NOT_AN_ISOMETRIC_RUN"], `${name} ${label}: ${JSON.stringify(r.body).slice(0, 160)}`); }
    for (const [label, fn] of [["applyCorrection", () => reviewRepo.applyCorrection(db, { projectId: P, runId: run, payload: { meta: {} } })],
                               ["compareRuns", () => revisions.compareRuns(db, { projectId: P, fromRunId: run, toRunId: D.runOf["ISO-A"] })],
                               ["compareWithPrevious", () => revisions.compareWithPrevious(db, { projectId: P, runId: run })]]) {
      let e; try { await inP(fn); } catch (x) { e = x; } equal([e?.status, e?.code], [409, "NOT_AN_ISOMETRIC_RUN"], `${name} ${label}`);
    }
  }
  const after = await q("SELECT id, status, payload, approved_sha256 FROM extraction_run WHERE id = ANY($1) ORDER BY id", [[D.pidRun, D.sldRun]]);
  equal(canon(after), canon(before), "the P&ID / SLD runs are untouched");
  equal((await q("SELECT count(*)::int AS n FROM extraction_edit"))[0].n, editsBefore, "no edit was written");
});

test("C2. every document-id route of the isometric workflow refuses a P&ID / SLD document (409 NOT_AN_ISOMETRIC_DOCUMENT), and /api/runs refuses the reserved pass names", async () => {
  for (const d of [D.pid, D.sld]) {
    const save = await json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId: P, documentId: d.id, lineNo: "L-X", payload: isoPayload(d.doc_no) } })));
    equal([save.status, save.body.code], [409, "NOT_AN_ISOMETRIC_DOCUMENT"], JSON.stringify(save.body).slice(0, 150));
    const get = await json(await runsRoute.GET(req(`http://x/api/runs?projectId=${P}&documentId=${d.id}`))); equal([get.status, get.body.code], [409, "NOT_AN_ISOMETRIC_DOCUMENT"]);
    const val = await json(await validationRoute.GET(req(`http://x/api/validation?projectId=${P}&documentId=${d.id}`))); equal([val.status, val.body.code], [409, "NOT_AN_ISOMETRIC_DOCUMENT"]);
    const spool = await json(await validationRoute.GET(req(`http://x/api/validation?projectId=${P}&documentId=${d.id}&spoolUid=00000000-0000-4000-8000-000000000000`))); equal([spool.status, spool.body.code], [409, "NOT_AN_ISOMETRIC_DOCUMENT"]);
    let e; try { await inP(() => validationRepo.validationFor(db, { projectId: P, documentId: d.id })); } catch (x) { e = x; } equal(e?.code, "NOT_AN_ISOMETRIC_DOCUMENT");
    for (const [label, fn] of [["compareRevisions", () => lifecycle.compareRevisions(db, { projectId: P, fromDocumentId: d.id, toDocumentId: D.iso[0].id })],
                               ["carryForward", () => lifecycle.carryForward(db, { projectId: P, fromDocumentId: d.id, toDocumentId: D.iso[0].id, fromHash: "x", toHash: "y", requestKey: "iso-request-1", decisions: [] })]]) {
      let x; try { await inP(fn); } catch (err) { x = err; }
      assert(x && x.status === 409 || x?.status === 404, `${label}: ${x?.code}`);          // not the same drawing → INVALID_LINEAGE / NOT_AN_ISOMETRIC_DOCUMENT: refused either way
    }
  }
  const sameNo = await newDoc("PID-LINEAGE", "pid");
  const rev = await inP(() => lifecycle.createRevision(db, { projectId: P, sourceDocumentId: sameNo.id, revision: "1", changeNote: "x", userId: null }));
  for (const [label, fn] of [["compareRevisions", () => lifecycle.compareRevisions(db, { projectId: P, fromDocumentId: sameNo.id, toDocumentId: rev.document.id })],
                             ["carryForward", () => lifecycle.carryForward(db, { projectId: P, fromDocumentId: sameNo.id, toDocumentId: rev.document.id, fromHash: "x", toHash: "y", requestKey: "iso-request-2", decisions: [] })]]) {
    let x; try { await inP(fn); } catch (err) { x = err; } equal([x?.status, x?.code], [409, "NOT_AN_ISOMETRIC_DOCUMENT"], `${label} on two revisions of one P&ID`);
  }
  equal((await inP(() => lifecycle.lineageOf(db, { projectId: P, documentId: rev.document.id }))).chain.map((c) => c.revision), ["0", "1"], "lineage itself stays type-agnostic");
  for (const passName of ["pid", "SLD", " sld "]) {
    const r = await json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId: P, documentId: D.iso[1].id, lineNo: "L-B", passName, payload: isoPayload("ISO-B") } })));
    equal([r.status, r.body.code], [400, "INVALID_PASS_NAME"], passName);
  }
  let e2; try { await inP(() => runsRepo.createRun(db, { projectId: P, documentId: D.iso[1].id, passName: "sld", payload: {} })); } catch (x) { e2 = x; } equal(e2?.code, "INVALID_PASS_NAME");
  const ok = await json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId: P, documentId: D.iso[1].id, lineNo: "L-B", passName: "second-read", payload: isoPayload("ISO-B") } }))); assert(ok.status === 201 || ok.status === 200, "an ordinary pass name is still accepted");
});

test("C3. authorization and project scope are not weakened: a viewer is 403 before any run is looked at; another project's user and another project's run id are 404", async () => {
  const v = await ensureUser(db, { subject: "kc|viewer-iso" }); await addMember(db, { projectId: P, userId: v.id, role: "viewer" });
  equal((await call(approveRoute, "POST", `http://x/api/runs/${D.pidRun}/approve`, { projectId: P }, "kc|viewer-iso")).status, 403);
  equal((await call(editsRoute, "POST", `http://x/api/runs/${D.runOf["ISO-B"]}/edits`, { projectId: P, payload: { meta: {} } }, "kc|viewer-iso")).status, 403);
  equal((await call(runRoute, "GET", `http://x/api/runs/${D.pidRun}?projectId=${P}`, undefined, "kc|mallory")).status, 404, "not a member of that project");
  equal((await call(runRoute, "GET", `http://x/api/runs/${D.runOf["ISO-A"]}?projectId=${OTHER}`, undefined, "kc|mallory")).status, 404, "a run of another project is not found in this one");
  equal((await call(runRoute, "GET", `http://x/api/runs/00000000-0000-4000-8000-000000000000?projectId=${P}`)).status, 404);
});

test("C4. the isometric workflow itself is unaffected: its runs read, diff, correct and lock exactly as before", async () => {
  const run = D.runOf["ISO-A"];
  assert((await call(runRoute, "GET", `http://x/api/runs/${run}?projectId=${P}`)).status === 200);
  const g = (await call(runRoute, "GET", `http://x/api/runs/${run}?projectId=${P}`)).body;
  const locked = await call(editsRoute, "POST", `http://x/api/runs/${run}/edits`, { projectId: P, payload: g.payload, reason: "x", baseHash: g.run.payloadHash });
  equal([locked.status, locked.body.code], [409, "RUN_LOCKED"], "a signed isometric register is still locked");
  const iso = (await json(await runsRoute.GET(req(`http://x/api/runs?projectId=${P}&documentId=${D.iso[0].id}`)))).body; assert(iso.run && iso.register.length > 0);
  const d = await call(diffRoute, "GET", `http://x/api/runs/${D.runOf["ISO-B"]}/diff?projectId=${P}`); equal(d.status, 200);
  const v = await json(await validationRoute.GET(req(`http://x/api/validation?projectId=${P}&documentId=${D.iso[0].id}`))); equal(v.status, 200);
});

// ── D. the source scan ───────────────────────────────────────────────────────────────────────────────────────────────────
const READ = /reporting\.current_run|(FROM|JOIN|UPDATE|INTO)\s+extraction_run\b|extraction_edit\b/;
/** Every source file that reads or writes the shared run tables, with why it is safe. A file not listed here fails the test: review it, then add it. */
const REVIEWED = {
  // guarded: restricted to isometric DOCUMENTS through lib/db/run-scope.mjs (the file must import it)
  guarded: ["app/api/overview/route.js", "app/api/runs/[id]/route.js", "app/api/runs/route.js", "lib/db/repos/joint.mjs", "lib/db/repos/log.mjs", "lib/db/repos/piping-hub.mjs",
    "lib/db/repos/piping-reports.mjs", "lib/db/repos/review.mjs", "lib/db/repos/revision-lifecycle.mjs", "lib/db/repos/revisions.mjs", "lib/db/repos/runs.mjs"],
  // safe by construction: they reach runs only through spool / weld / document-scoped rows that exist for isometric runs alone, or by an unambiguous drawing number
  viaRegisterRows: ["app/api/warehouse/route.js", "lib/contracts/metrics.mjs", "lib/db/repos/assumptions.mjs", "lib/db/repos/coating.mjs", "lib/db/repos/field.mjs", "lib/db/repos/line-list.mjs",
    "lib/db/repos/piping-execution.mjs", "lib/db/repos/register-persistence.mjs", "lib/db/repos/workfront.mjs"],
  // the other disciplines' own repositories (every query filters its own pass_name) and the shared definitions
  ownPass: ["lib/db/repos/pid.mjs", "lib/db/repos/sld.mjs", "lib/db/run-scope.mjs"],
};
const walk = (dir, out = []) => { for (const f of readdirSync(dir)) { if (f === "node_modules" || f === ".next") continue; const p = join(dir, f); const s = statSync(p); if (s.isDirectory()) walk(p, out); else if (/\.(mjs|js|jsx)$/.test(f)) out.push(p); } return out; };
test("D1. source scan: every reader of reporting.current_run / extraction_run / extraction_edit is a reviewed one — a new, unreviewed reader fails here", () => {
  const files = [...walk("app"), ...walk("lib")].map((p) => relative(".", p).split("\\").join("/")).filter((p) => READ.test(readFileSync(p, "utf8")));
  const known = new Set(Object.values(REVIEWED).flat());
  const unreviewed = files.filter((f) => !known.has(f));
  assert(unreviewed.length === 0, `unreviewed reader(s) of the shared run tables: ${unreviewed.join(", ")} — decide whether each needs lib/db/run-scope.mjs, then list it in REVIEWED`);
  const gone = [...known].filter((f) => !files.includes(f));
  assert(gone.length === 0, `reviewed file(s) no longer read the run tables (remove from REVIEWED): ${gone.join(", ")}`);
});
test("D2. source scan: every file listed as guarded actually uses the shared run-scope predicate", () => {
  for (const f of REVIEWED.guarded) assert(/run-scope\.mjs/.test(readFileSync(f, "utf8")), `${f} reads the run tables and must import lib/db/run-scope.mjs`);
});

await run();
