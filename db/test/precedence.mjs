#!/usr/bin/env node
/**
 * The precedence chain: what must happen before what, around a tag.
 *
 * The chains themselves are engineering practice, so they are tested as
 * engineering practice: the two orderings people get wrong in the field are
 * asserted by name, and would fail loudly if someone "tidied" the list.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CHAINS, chainFor, validateChain, walk, nextActions, whyNotReady, progress,
  DONE, IN_PROGRESS, TERMINAL,
} from "../../lib/platform/precedence.mjs";

// ── the chains themselves ────────────────────────────────────────────────

test("every chain is well formed", async () => {
  for (const [name, chain] of Object.entries(CHAINS)) {
    equal(validateChain(chain), [], `chain ${name} is malformed`);
  }
});

test("the validator actually catches a broken chain", async () => {
  // A validator nobody has seen fail is a validator nobody should trust.
  assert(validateChain([{ code: "ready", after: ["ghost"] }])
    .some((p) => /unknown step ghost/.test(p)));
  assert(validateChain([
    { code: "a", after: ["ready"] }, { code: "ready", after: ["a"] },
  ]).some((p) => /cycle/.test(p)), "and a cycle, which would hang the trace");
  assert(validateChain([{ code: "a", after: [] }]).some((p) => /no "ready" step/.test(p)));
});

test("grout comes before alignment, not after", async () => {
  // Grout cures and the baseplate moves. Aligning first means doing it twice
  // — once for nothing. This is the ordering that gets "corrected" by
  // somebody reading the list as a tidy sequence of trades.
  const r = CHAINS.rotating;
  const align = r.find((s) => s.code === "align");
  assert(align.after.includes("grout"), "alignment must wait for grout");
});

test("alignment is re-checked after piping is connected", async () => {
  // Bolting up suction and discharge pulls the machine. Pipe strain is
  // invisible on a walkdown and shows up months later as a bearing failure
  // that reads like an equipment problem. It is a distinct hold point.
  const r = CHAINS.rotating;
  const strain = r.find((s) => s.code === "strain");
  assert(strain, "the post-connection check must exist as its own step");
  assert(strain.after.includes("piping"), "and it must come after piping");
  assert(r.find((s) => s.code === TERMINAL).after.includes("strain"),
    "and commissioning must wait for it — otherwise it is a step nobody blocks on");
});

test("electrical and instrumentation do not wait for piping", async () => {
  // A chain drawn as one line would invent a dependency and idle two crews.
  const r = CHAINS.rotating;
  for (const code of ["electrical", "instrument"]) {
    const s = r.find((x) => x.code === code);
    equal(s.after, ["set"], `${code} must hang off set, not off the piping chain`);
  }
  const next = nextActions(r, { foundation: DONE, set: DONE }).map((s) => s.code);
  assert(next.includes("electrical") && next.includes("instrument") && next.includes("grout"),
    "three crews can work at once once the machine is set");
});

test("static equipment is never aligned", async () => {
  assert(!CHAINS.static.some((s) => s.code === "align" || s.code === "strain"),
    "a vessel has no coupling, so an alignment hold point would be a false one");
});

test("a kind nobody declared gets no chain rather than a guessed one", async () => {
  equal(chainFor("rotating").length, CHAINS.rotating.length);
  equal(chainFor("ROTATING").length, CHAINS.rotating.length, "case is not the user's problem");
  equal(chainFor("skid"), null);
  equal(chainFor(null), null);
});

// ── the trace ────────────────────────────────────────────────────────────

test("the trace names the crew that can move today, not the step that is stuck", async () => {
  // "راه‌اندازی بسته است چون کنترل تنش انجام نشده" is useless: the people who
  // have to do something are pouring concrete.
  const why = whyNotReady(CHAINS.rotating, {});
  equal(why.ready, false);
  equal(why.rootCauses.map((c) => c.code), ["foundation"]);
  equal(why.rootCauses[0].discipline, "civil");
  assert(why.path.length > 1, "and the path back is kept, for someone who wants the chain");
});

test("the trace follows every branch, not just the first", async () => {
  const done = { foundation: DONE, set: DONE, grout: DONE, align: DONE };
  const why = whyNotReady(CHAINS.rotating, done);
  equal(why.rootCauses.map((c) => c.code).sort(), ["electrical", "instrument", "piping"],
    "three disciplines are holding it, and naming one of them would send one crew");
});

test("a finished chain reports ready", async () => {
  const all = Object.fromEntries(CHAINS.rotating.map((s) => [s.code, DONE]));
  equal(whyNotReady(CHAINS.rotating, all).ready, true);
  equal(progress(CHAINS.rotating, all).pct, 100);
});

test("blocked is computed, never carried", async () => {
  // The whole reason there is no `blocked` column: the moment a predecessor
  // completes, every downstream answer must change with no second write.
  const before = walk(CHAINS.rotating, {}).find((s) => s.code === "set");
  equal(before.blocked, true);
  const after = walk(CHAINS.rotating, { foundation: DONE }).find((s) => s.code === "set");
  equal(after.blocked, false, "no row was updated, and the answer still changed");
});

test("a step recorded done out of order is reported, not contradicted", async () => {
  // Somebody signed that sheet. The record stands; the anomaly is surfaced.
  const steps = walk(CHAINS.rotating, { align: DONE });
  const align = steps.find((s) => s.code === "align");
  equal(align.status, DONE, "a signed record is not overruled by this engine");
  equal(align.outOfOrder, true, "but it is flagged — alignment before grout is a real problem");
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "prec-db-"));

const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runsRepo = await import("../../lib/db/repos/runs.mjs");
const exec = await import("../../lib/db/repos/execution.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const acts = await import("../../lib/db/repos/activities.mjs");
const { buildModel } = await import("../../lib/engine.js");
const { DEMO } = await import("../../lib/demo.js");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "K110", name: "K110", ownerUserId: alice.id });
let pump, sub, lineId;

test("a tag walks its chain as the site records work", async () => {
  await withProject(db, proj.id, async () => {
    sub = await spine.upsertSubsystem(db, { projectId: proj.id, code: "21-01", name: "خوراک کوره" });
    pump = await spine.upsertTag(db, {
      projectId: proj.id, tagNo: "P-2101A", discipline: "equipment",
      kind: "rotating", subsystemId: sub.id });

    let s = await acts.tagStatus(db, { projectId: proj.id, tagId: pump.id });
    equal(s.progress.done, 0);
    equal(s.next.map((n) => n.code), ["foundation"]);

    await acts.recordActivity(db, { projectId: proj.id, tagId: pump.id,
      code: "foundation", doneAt: "2026-08-01", refNo: "POUR-114", userId: alice.id });
    s = await acts.tagStatus(db, { projectId: proj.id, tagId: pump.id });
    equal(s.next.map((n) => n.code), ["set"], "one pour opens exactly one next step");
    equal(s.steps.find((x) => x.code === "foundation").refNo, "POUR-114",
      "with the pour card, so the claim is evidenced");
  });
});

test("a completion with no date is refused, in the repository and in the table", async () => {
  await withProject(db, proj.id, async () => {
    await throws(() => acts.recordActivity(db, {
      projectId: proj.id, tagId: pump.id, code: "set" }), "تاریخ");

    // Not via the repository — straight at the table, the way a future
    // import script would arrive.
    await throws(() => db.query(
      `INSERT INTO tag_activity (project_id, tag_id, code, status)
       VALUES ($1,$2,'set','done')`, [proj.id, pump.id]), "done_is_dated");
  });
});

test("the piping step answers itself from the weld register", async () => {
  // Nobody ticks a box the system can already answer. This is the whole
  // "minimum human time" claim, expressed as one step.
  await withProject(db, proj.id, async () => {
    for (const [code, d] of [["set", "2026-08-10"], ["grout", "2026-08-15"], ["align", "2026-08-20"]]) {
      await acts.recordActivity(db, { projectId: proj.id, tagId: pump.id,
        code, doneAt: d, userId: alice.id });
    }

    const { rows: [line] } = await db.query(
      "INSERT INTO line (project_id, line_no, tag_id) VALUES ($1,'21-P-001',$2) RETURNING id",
      [proj.id, pump.id]);
    lineId = line.id;
    const { rows: [doc] } = await db.query(
      `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri)
       VALUES ($1,'SW 265022A','0',$2,'local://x') RETURNING id`, [proj.id, "a".repeat(64)]);

    const model = buildModel(DEMO, {});
    const runRow = await runsRepo.createRun(db, {
      projectId: proj.id, documentId: doc.id, lineId, payload: DEMO,
      validationChecks: model.checks });
    await runsRepo.saveRegister(db, {
      projectId: proj.id, runId: runRow.id, documentId: doc.id, lineId, model });

    // Welds exist but none is done: piping is not started, and the engine
    // must NOT call that "in progress".
    let s = await acts.tagStatus(db, { projectId: proj.id, tagId: pump.id });
    equal(s.steps.find((x) => x.code === "piping").status, "not_started");
    equal(s.steps.find((x) => x.code === "piping").derived, true);

    const { rows: welds } = await db.query(
      "SELECT weld_uid FROM weld WHERE extraction_run_id = $1 ORDER BY weld_no", [runRow.id]);
    const w = await exec.upsertWelder(db, { projectId: proj.id, stampNo: "W-12", name: "رضایی" });
    await exec.addQualification(db, { projectId: proj.id, welderId: w.id, process: "GTAW",
      positions: ["6G"], couponOdMm: 219.1, couponThicknessMm: 8.18 });
    await exec.assignWeld(db, { projectId: proj.id, weldUid: welds[0].weld_uid,
      welderId: w.id, weldedAt: "2026-09-10", process: "GTAW", position: "V", lineId });

    s = await acts.tagStatus(db, { projectId: proj.id, tagId: pump.id });
    equal(s.steps.find((x) => x.code === "piping").status, IN_PROGRESS,
      "one weld made, and nobody had to tell the system");
    equal(s.derivedPiping, IN_PROGRESS);
  });
});

test("a tag with no piping routed to it reports unknown, not 'not started'", async () => {
  // An unknown is not a zero. A vessel nobody has routed pipe to would
  // otherwise look like one whose piping is merely pending.
  await withProject(db, proj.id, async () => {
    const vessel = await spine.upsertTag(db, {
      projectId: proj.id, tagNo: "V-2101", discipline: "equipment",
      kind: "static", subsystemId: sub.id });
    const s = await acts.tagStatus(db, { projectId: proj.id, tagId: vessel.id });
    equal(s.derivedPiping, null, "nothing is derived, so nothing is claimed");
  });
});

test("the blocked list names the work that can start, worst first", async () => {
  await withProject(db, proj.id, async () => {
    const blocked = await acts.blockedTags(db, { projectId: proj.id, subsystemId: sub.id });
    equal(blocked.length, 2, "the pump and the vessel are both short of ready");
    equal(blocked[0].tagNo, "V-2101", "the one that has not started comes first");
    equal(blocked[0].rootCauses.map((c) => c.code), ["foundation"]);

    const pumpRow = blocked.find((b) => b.tagNo === "P-2101A");
    assert(pumpRow.rootCauses.some((c) => c.discipline === "electrical"),
      "and the pump is waiting on trades that can each move today");
  });
});

test("a kind with no chain gets no verdict", async () => {
  await withProject(db, proj.id, async () => {
    const skid = await spine.upsertTag(db, {
      projectId: proj.id, tagNo: "PK-3001", discipline: "equipment", kind: "skid" });
    const s = await acts.tagStatus(db, { projectId: proj.id, tagId: skid.id });
    equal(s.chain, null);
    assert(/زنجیرهٔ پیش‌نیاز تعریف نشده/.test(s.reason),
      "silence with a reason, not a fabricated hold point");
  });
});

test("every step code the chains use is one the database will accept", async () => {
  // The table stores `code` as text, so this is the guard that stops a
  // renamed step from silently becoming a row nothing ever reads.
  const codes = new Set(Object.values(CHAINS).flat().map((s) => s.code));
  await withProject(db, proj.id, async () => {
    const { rows } = await db.query(
      "SELECT DISTINCT code FROM tag_activity WHERE project_id = $1", [proj.id]);
    for (const r of rows) {
      assert(codes.has(r.code), `a row is recorded under "${r.code}", which no chain defines`);
    }
  });
});

await run();
