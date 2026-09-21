#!/usr/bin/env node
/**
 * Revision control tests (EPIC-2).
 *
 * The matcher is exercised against the three things that actually happen to a
 * drawing between revisions — a dimension correction, a datum change, and a
 * fitting inserted mid-route — because a formula that survives one of those
 * and not the others is what made a derived weld id unworkable in the first
 * place.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { matchRegisters, alignmentShift, MIN_SCORE } from "../../lib/register/match.mjs";
import { diffRegisters, spoolImpact } from "../../lib/register/diff.mjs";
import { fromEngine, fromDb } from "../../lib/register/normalize.mjs";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const reg = (data, opts = {}) => fromEngine(buildModel(data, opts));
const clone = (x) => JSON.parse(JSON.stringify(x));

/** rev 0 of the reference drawing. */
const rev0 = reg(DEMO);

// ── the matcher, against real revision scenarios ─────────────────────────

test("an unchanged re-extraction matches every weld to itself", async () => {
  const { pairs, onlyFrom, onlyTo } = matchRegisters(rev0, reg(DEMO));
  equal(pairs.length, 10);
  equal(onlyFrom.length, 0);
  equal(onlyTo.length, 0);
  assert(pairs.every((p) => p.from.no === p.to.no), "and to the same weld number");
});

test("a re-datumed drawing is a no-op, not a full rewrite", async () => {
  // Every coordinate moves by the same amount. A position-derived identity
  // would call all ten welds new; the tie-in references pin the frame.
  const moved = clone(DEMO);
  moved.nodes.forEach((n) => { n.E += 50_000; n.N -= 12_000; n.EL += 3_000; });

  const shift = alignmentShift(rev0, reg(moved));
  equal(shift.e, -50_000, "the offset is read off a matched tie-in");
  equal(shift.from, "2B01U-SW265004A");

  const d = diffRegisters(rev0, reg(moved));
  equal(d.summary, { from: 10, to: 10, added: 0, removed: 0, changed: 0,
                     unchanged: 10, renumbered: 0, rebased: d.summary.rebased });
  assert(d.summary.rebased, "and the rebase is reported rather than hidden");
});

test("a corrected running dimension changes only the welds it moved", async () => {
  const fixed = clone(DEMO);
  fixed.nodes[2].N += 400;              // the 90° elbow moves 400 mm along the run
  fixed.nodes[3].N += 400;              // and the tie-in past it follows
  const d = diffRegisters(rev0, reg(fixed));
  equal(d.summary.added, 0);
  equal(d.summary.removed, 0);
  assert(d.changed.length > 0, "the welds that moved are reported as changed");
  assert(d.unchanged.length > 0, "the ones upstream of the correction are not");
  assert(d.changed.every((c) => c.fields.some((f) => f.field === "position")),
    "and the reason given is that they moved");
});

test("a fitting inserted mid-route adds welds instead of invalidating the line", async () => {
  // This is the case a sequence-derived identity cannot survive: every weld
  // downstream renumbers.
  const extra = clone(DEMO);
  extra.nodes.splice(2, 0, { id: "N2b", type: "elbow90", ref: "", E: 118948, N: 392000, EL: 97928 });
  extra.nodes[3].EL = 97928;
  extra.edges = [
    { from: "N1", to: "N2", nps: 36 }, { from: "N2", to: "N2b", nps: 36 },
    { from: "N2b", to: "N3", nps: 36 }, { from: "N3", to: "N4", nps: 36 },
  ];
  extra.bom = extra.bom.map((b) => (/Elbow 90/.test(b.description) ? { ...b, qty: 2 } : b));

  const d = diffRegisters(rev0, reg(extra));
  assert(d.added.length >= 2, "the new elbow brings its own welds");
  equal(d.removed.length, 0, "nothing was taken away");
  assert(d.renumbered.length > 0, "welds downstream renumbered, which is reported separately");
  const tieIns = d.unchanged.concat(d.changed).filter((c) => c.from.kind === "Tie-in");
  equal(tieIns.length, 2, "both tie-ins survived the renumbering");
});

test("a diameter change is reported as a change, not a replacement", async () => {
  const resized = clone(DEMO);
  resized.edges = resized.edges.map((e) => ({ ...e, nps: 30 }));
  resized.meta = { ...resized.meta, nps: 30 };
  resized.bom = resized.bom.map((b) => ({ ...b, diam: 30 }));
  const d = diffRegisters(rev0, reg(resized));
  equal(d.summary.removed, 0);
  equal(d.summary.added, 0);
  assert(d.changed.some((c) => c.fields.some((f) => f.field === "nps")), "the diameter change is named");
});

test("two unrelated registers match nothing", async () => {
  const other = reg({
    meta: { nps: 12, pupLength: 0 },
    nodes: [{ id: "A", type: "tie-in", ref: "OTHER-LINE", E: 900_000, N: 900_000, EL: 900_000 },
            { id: "B", type: "tie-in", ref: "OTHER-LINE-2", E: 900_000, N: 904_000, EL: 900_000 }],
    edges: [{ from: "A", to: "B", nps: 12 }],
  });
  const { pairs } = matchRegisters(rev0, other);
  equal(pairs.length, 0, `nothing should clear the ${MIN_SCORE} point floor`);
});

// ── spool impact ─────────────────────────────────────────────────────────

test("impact separates spools already built from spools still on paper", async () => {
  const fixed = clone(DEMO);
  fixed.nodes[2].N += 400;
  fixed.nodes[3].N += 400;
  const d = diffRegisters(rev0, reg(fixed));

  const status = new Map([["SP-01", "fabricated"], ["SP-02", "planned"], ["SP-03", "planned"]]);
  const impact = spoolImpact(d, status);
  assert(impact.spools.length > 0, "the change lands somewhere");
  if (impact.rework.length) {
    assert(impact.rework.every((s) => s.fabStatus === "fabricated"),
      "only built spools are called rework");
    assert(impact.rework.every((s) => s.welds.length > 0), "and each names the welds concerned");
  }
  assert(impact.safe.every((s) => s.fabStatus !== "fabricated"));
});

test("a weld moving between spools damages both", async () => {
  const d = {
    removed: [], added: [],
    changed: [{ from: { spool: "SP-01", no: "W-05" }, to: { spool: "SP-02", no: "W-05" },
                fields: [{ field: "spool" }] }],
  };
  const impact = spoolImpact(d, new Map([["SP-01", "fabricated"], ["SP-02", "planned"]]));
  equal(impact.spools.map((s) => s.spool).sort(), ["SP-01", "SP-02"],
    "the spool it left is short a joint, the one it arrived in has an extra");
});

// ── end to end, through the database and the API ─────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "rev-db-"));
process.env.STORAGE_ROOT = await mkdtemp(path.join(tmpdir(), "rev-store-"));

const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const runsRoute = await import("../../app/api/runs/route.js");
const diffRoute = await import("../../app/api/runs/[id]/diff/route.js");
const spoolStatusRoute = await import("../../app/api/spools/[id]/status/route.js");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) =>
  new Request(url, { method,
    headers: { authorization: `Bearer ${as}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });

const project = (await json(await projectsRoute.POST(req("http://x/api/projects", {
  method: "POST", body: { code: "K110", name: "Ethane Cracking" } })))).body.project;

async function upload(revision, content) {
  const { body } = await json(await documentsRoute.POST(req("http://x/api/documents", {
    method: "POST",
    body: { projectId: project.id, docNo: "SW 265022A", revision,
            fileBase64: Buffer.from(content).toString("base64") },
  })));
  return body.document;
}
const postRun = async (documentId, payload) => (await json(await runsRoute.POST(
  req("http://x/api/runs", { method: "POST", body: { projectId: project.id, documentId, payload } })))).body;

let run0, runB, uidsRev0;

test("the first run of a drawing mints fresh identities", async () => {
  const doc0 = await upload("0", "rev 0 scan");
  run0 = await postRun(doc0.id, DEMO);
  equal(run0.register.length, 10);
  equal(run0.carriedIdentities, 0, "there was nothing to carry from");
  uidsRev0 = Object.fromEntries(run0.register.map((w) => [w.weld_no, w.weld_uid]));
});

test("a new revision carries weld identity across the document boundary", async () => {
  const moved = clone(DEMO);
  moved.nodes.forEach((n) => { n.E += 50_000; });   // re-datumed, nothing really changed
  moved.meta = { ...moved.meta, rev: "B" };
  const docB = await upload("B", "rev B scan");
  runB = await postRun(docB.id, moved);

  equal(runB.carriedIdentities, 10, "all ten welds kept their identity");
  const uidsRevB = Object.fromEntries(runB.register.map((w) => [w.weld_no, w.weld_uid]));
  equal(uidsRevB, uidsRev0,
    "so anything hung off a weld_uid — NDT, ITRs, welder records — survives the revision");
});

test("the diff endpoint compares a run with the one before it", async () => {
  const { status, body } = await json(await diffRoute.GET(
    req(`http://x/api/runs/${runB.run.id}/diff?projectId=${project.id}`),
    { params: { id: runB.run.id } }));
  equal(status, 200);
  equal(body.from.revision, "0");
  equal(body.to.revision, "B");
  equal(body.diff.summary.added, 0);
  equal(body.diff.summary.removed, 0);
  equal(body.diff.summary.unchanged, 10);
  assert(body.diff.summary.rebased, "the datum shift is surfaced");
});

test("a fabricated spool turns the diff into a rework warning", async () => {
  const db = await getDb();
  const spoolId = await withProject(db, project.id, async () => {
    const { rows } = await db.query(
      "SELECT id FROM spool WHERE extraction_run_id = $1 AND spool_no = 'SP-01'", [run0.run.id]);
    return rows[0].id;
  });
  const marked = await json(await spoolStatusRoute.POST(
    req(`http://x/api/spools/${spoolId}/status`, {
      method: "POST", body: { projectId: project.id, status: "fabricated", note: "welded 1405-06-20" } }),
    { params: { id: spoolId } }));
  equal(marked.body.spool.fab_status, "fabricated");

  // now a revision that actually moves geometry
  const changed = clone(DEMO);
  changed.nodes[1].N += 600;
  const docC = await upload("C", "rev C scan");
  const runC = await postRun(docC.id, changed);

  const { body } = await json(await diffRoute.GET(
    req(`http://x/api/runs/${runC.run.id}/diff?projectId=${project.id}&against=${run0.run.id}`),
    { params: { id: runC.run.id } }));
  assert(body.diff.summary.changed > 0, "the revision moved welds");
  const sp01 = body.impact.spools.find((s) => s.spool === "SP-01");
  assert(sp01, "SP-01 is affected");
  equal(sp01.fabStatus, "fabricated");
  assert(body.impact.rework.some((s) => s.spool === "SP-01"),
    "and it is on the rework list, because that steel already exists");
});

test("comparing two different drawings is refused", async () => {
  const { body } = await json(await documentsRoute.POST(req("http://x/api/documents", {
    method: "POST",
    body: { projectId: project.id, docNo: "SW 999999", revision: "0",
            fileBase64: Buffer.from("different drawing").toString("base64") } })));
  const otherRun = await postRun(body.document.id, DEMO);
  const res = await json(await diffRoute.GET(
    req(`http://x/api/runs/${otherRun.run.id}/diff?projectId=${project.id}&against=${run0.run.id}`),
    { params: { id: otherRun.run.id } }));
  equal(res.status, 400);
  equal(res.body.code, "DIFFERENT_DRAWINGS");
});

test("a drawing with no earlier run says so rather than inventing a comparison", async () => {
  const { body } = await json(await documentsRoute.POST(req("http://x/api/documents", {
    method: "POST",
    body: { projectId: project.id, docNo: "SW 111111", revision: "0",
            fileBase64: Buffer.from("lonely").toString("base64") } })));
  const only = await postRun(body.document.id, DEMO);
  const res = await json(await diffRoute.GET(
    req(`http://x/api/runs/${only.run.id}/diff?projectId=${project.id}`),
    { params: { id: only.run.id } }));
  equal(res.body.reason, "NO_PREVIOUS_RUN");
  equal(res.body.diff, null);
});

await run();
