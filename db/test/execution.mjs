#!/usr/bin/env node
/**
 * Plant siting, piping execution and supports.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";
import { CHAINS, validateChain, nextActions, derivedSteps, DONE, IN_PROGRESS }
  from "../../lib/platform/precedence.mjs";
import { deriveFromWelds, notApplicable } from "../../lib/db/repos/piping-execution.mjs";

const CHAIN = CHAINS.piping_spool;
const step = (code) => CHAIN.find((s) => s.code === code);

// ── buried or above ground, in the engine ────────────────────────────────

test("with no grade elevation there is no verdict, not zero buried", async () => {
  // "0 buried" and "nobody said where the ground is" are opposite facts.
  for (const g of [undefined, null, ""]) {
    const m = buildModel(DEMO, { gradeElevationMm: g });
    equal(m.totals.buried, null, `grade ${JSON.stringify(g)} must give null, not 0`);
    equal(m.register[0].buried, null);
  }
});

test("a weld below grade is buried and one above it is not", async () => {
  const m = buildModel(DEMO, { gradeElevationMm: 100000 });
  const deep = m.register.find((w) => w.el === 96846);
  const high = m.register.find((w) => w.el === 100300);
  equal(deep.buried, true, "3.15 m below a grade of EL 100 000");
  equal(high.buried, false);
  equal(m.totals.buried + m.totals.aboveGround, m.register.length,
    "and every weld is classified once the grade is known");
});

test("the grade is taken from the project, never assumed", async () => {
  // Grade 0.00 on the same drawing puts everything above ground. Guessing
  // 100 000 for a project that uses 0.00 would bury every pipe rack.
  equal(buildModel(DEMO, { gradeElevationMm: 0 }).totals.buried, 0,
    "zero is a real grade, not an absent one");
});

// ── the chain ────────────────────────────────────────────────────────────

test("the piping chain is well formed", async () => {
  equal(validateChain(CHAIN), []);
  equal(derivedSteps(CHAIN), ["shop_weld", "shop_ndt", "field_weld"]);
});

test("fit-up is inspected before the root pass, not after", async () => {
  assert(step("shop_weld").after.includes("fit_up"));
});

test("shop NDT comes before erection", async () => {
  // A reject found in the shop is a cut in the shop; in the rack it is
  // scaffolding, a permit and a day.
  assert(step("erected").after.includes("shop_ndt"));
});

test("the pressure test waits for field welds AND permanent supports", async () => {
  equal(step("test").after.sort(), ["field_weld", "supports"]);
  const next = nextActions(CHAIN, {
    released: DONE, fit_up: DONE, shop_weld: DONE, shop_ndt: DONE, erected: DONE,
  }).map((s) => s.code);
  assert(next.includes("supports") && next.includes("field_weld"),
    "supports and field welding run in parallel once the spool is up");
  assert(!next.includes("test"));
});

test("paint and insulation come after the test", async () => {
  // Joints are left exposed for the leak test so a weep can be seen.
  assert(step("painted").after.includes("test"));
});

// ── deriving from the register ───────────────────────────────────────────

test("derived steps follow the welds on the spool", async () => {
  const w = (field, welded, examined) =>
    ({ is_field_weld: field, is_welded: welded, is_examined: examined });
  equal(deriveFromWelds([w(false, true, true), w(false, true, false)]),
    { shop_weld: DONE, shop_ndt: IN_PROGRESS, field_weld: DONE },
    "no field welds on this spool: nothing to do on site");
  equal(deriveFromWelds([w(false, false, false)]).shop_weld, null, "none welded is not started");
  equal(deriveFromWelds([w(true, true, false)]).field_weld, IN_PROGRESS,
    "a field weld made but not examined is not ready for the test");
});

test("a spool with no shop welds is not offered a shop fit-up", async () => {
  // A single straight length has nothing to fit up in the shop. Offering it
  // was noise; waiting on it would be a false hold. Not applicable is not
  // "done" — done would claim an inspection that never happened.
  const fieldOnly = [{ is_field_weld: true }];
  equal([...notApplicable(fieldOnly)].sort(), ["fit_up", "shop_ndt", "shop_weld"]);
  equal([...notApplicable([{ is_field_weld: false }])], ["field_weld"]);
  equal(notApplicable([]).size, 0, "no register, no claims either way");
});

test("a spool with no welds at all gets no verdict", async () => {
  // Different from "no shop welds": here the register itself is missing.
  equal(deriveFromWelds([]), { shop_weld: null, shop_ndt: null, field_weld: null });
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "exec-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const exec = await import("../../lib/db/repos/execution.mjs");
const pe = await import("../../lib/db/repos/piping-execution.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "K110", name: "K110", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "OTHER", name: "O", ownerUserId: alice.id });
let lineId, spools, welds;

await withProject(db, proj.id, async () => {
  const { rows: [line] } = await db.query(
    "INSERT INTO line (project_id, line_no) VALUES ($1,'28-CWR-10') RETURNING id", [proj.id]);
  lineId = line.id;
  const { rows: [doc] } = await db.query(
    `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri)
     VALUES ($1,'SW 265022A','0',$2,'local://x') RETURNING id`, [proj.id, "b".repeat(64)]);
  const model = buildModel(DEMO, {});
  const r = await runs.createRun(db, { projectId: proj.id, documentId: doc.id, lineId,
    payload: DEMO, validationChecks: model.checks });
  await runs.saveRegister(db, { projectId: proj.id, runId: r.id, documentId: doc.id, lineId, model });
  spools = (await db.query("SELECT id, spool_no FROM spool WHERE project_id = $1 ORDER BY spool_no",
    [proj.id])).rows;
  welds = (await db.query(
    "SELECT weld_uid, weld_no, spool_id, shop_field FROM weld WHERE project_id = $1 ORDER BY weld_no",
    [proj.id])).rows;
});

test("half a coordinate pair and an impossible latitude are refused", async () => {
  await throws(() => projects.updateProjectProfile(db, { projectId: proj.id,
    patch: { origin_latitude: 27.49 } }), "origin_is_a_pair");
  await throws(() => projects.updateProjectProfile(db, { projectId: proj.id,
    patch: { origin_latitude: 127, origin_longitude: 52.6 } }), "origin_latitude_range");
  const p = await projects.updateProjectProfile(db, { projectId: proj.id,
    patch: { origin_latitude: 27.49, origin_longitude: 52.61 } });
  equal(Number(p.origin_latitude), 27.49);
});

test("the stored register gets no buried verdict until the grade is recorded", async () => {
  await withProject(db, proj.id, async () => {
    const [row] = await pe.buriedExposure(db, { projectId: proj.id });
    equal(row.unknown, row.welds, "all unknown, none claimed above ground");
    equal(row.buried, 0);
    equal(row.aboveGround, 0, "unknown is not folded into above ground");
  });
});

test("the database and the engine agree on every weld", async () => {
  // The same formula lives in lib/engine.js and in reporting.fact_weld.
  // Two implementations are unavoidable across browser and database; this
  // is what stops them drifting.
  await projects.updateProjectProfile(db, { projectId: proj.id,
    patch: { grade_elevation_mm: 100000, elevation_datum: "Plant grade ±0.00 = EL 100000" } });
  const engine = buildModel(DEMO, { gradeElevationMm: 100000 }).register;
  await withProject(db, proj.id, async () => {
    const { rows } = await db.query(
      "SELECT weld_no, is_buried FROM reporting.fact_weld WHERE project_key = $1", [proj.id]);
    for (const e of engine) {
      const d = rows.find((r) => r.weld_no === e.no);
      equal(d.is_buried, e.buried, `weld ${e.no}: engine and database disagree`);
    }
    const [row] = await pe.buriedExposure(db, { projectId: proj.id });
    equal(row.unknown, 0);
    equal(row.buried, 9);
    assert(row.deepestMm < 0, "and the deepest point is reported below grade");
  });
});

test("a derived step cannot be ticked by hand", async () => {
  await withProject(db, proj.id, async () => {
    for (const code of ["shop_weld", "shop_ndt", "field_weld"]) {
      const e = await throws(() => pe.recordSpoolActivity(db, { projectId: proj.id,
        spoolId: spools[0].id, code, doneAt: "2026-09-01" }), "INVALID_INPUT");
      assert(/رجیستر جوش/.test(e.message), `${code} must say where its answer comes from`);
    }
    await throws(() => pe.recordSpoolActivity(db, { projectId: proj.id,
      spoolId: spools[0].id, code: "polished", doneAt: "2026-09-01" }), "INVALID_INPUT");
  });
});

test("a completed step with no date is refused, in the repository and in the table", async () => {
  await withProject(db, proj.id, async () => {
    await throws(() => pe.recordSpoolActivity(db, { projectId: proj.id,
      spoolId: spools[0].id, code: "released" }), "تاریخ");
    await throws(() => db.query(
      `INSERT INTO spool_activity (project_id, spool_id, code, status)
       VALUES ($1,$2,'released','done')`, [proj.id, spools[0].id]), "spool_done_is_dated");
  });
});

test("a spool walks its chain, and welding answers itself", async () => {
  await withProject(db, proj.id, async () => {
    const sp = spools[0].id;
    let s = await pe.spoolStatus(db, { projectId: proj.id, spoolId: sp });
    equal(s.next.map((n) => n.code), ["released"]);
    equal(s.buried, true, "this spool is underground at grade EL 100 000");

    await pe.recordSpoolActivity(db, { projectId: proj.id, spoolId: sp, code: "released",
      doneAt: "2026-08-01", userId: alice.id });
    await pe.recordSpoolActivity(db, { projectId: proj.id, spoolId: sp, code: "fit_up",
      doneAt: "2026-08-03", refNo: "FU-0012", userId: alice.id });

    const shopWeld = welds.find((w) => w.spool_id === sp && w.shop_field === "Shop");
    assert(shopWeld, "the demo spool has a shop weld");
    const welder = await exec.upsertWelder(db, { projectId: proj.id, stampNo: "W-12", name: "رضایی" });
    await exec.addQualification(db, { projectId: proj.id, welderId: welder.id, process: "GTAW",
      positions: ["6G"], couponOdMm: 219.1, couponThicknessMm: 8.18 });
    await exec.assignWeld(db, { projectId: proj.id, weldUid: shopWeld.weld_uid,
      welderId: welder.id, weldedAt: "2026-08-05", process: "GTAW", position: "V", lineId });

    s = await pe.spoolStatus(db, { projectId: proj.id, spoolId: sp });
    const sw = s.steps.find((x) => x.code === "shop_weld");
    assert([DONE, IN_PROGRESS].includes(sw.status), "nobody told the system; the register did");
    equal(sw.derived, true);
    equal(s.steps.find((x) => x.code === "fit_up").refNo, "FU-0012", "with the report number");
  });
});

test("the board lists every spool short of ready, worst first", async () => {
  await withProject(db, proj.id, async () => {
    const board = await pe.spoolBoard(db, { projectId: proj.id });
    equal(board.length, spools.length);
    assert(board[0].pct <= board[board.length - 1].pct);
    assert(board.every((b) => b.waitingOn.length || b.ready));
  });
});

// ── supports ─────────────────────────────────────────────────────────────

test("a spring hanger with no load is refused", async () => {
  // A spring nobody knows the load of is a spring nobody can set.
  await withProject(db, proj.id, async () => {
    await throws(() => pe.upsertSupport(db, { projectId: proj.id, supportNo: "SH-01",
      kind: "spring_hanger", lineId }), "INVALID_INPUT");
    await throws(() => db.query(
      `INSERT INTO pipe_support (project_id, support_no, kind) VALUES ($1,'SH-02','spring_hanger')`,
      [proj.id]), "spring_has_load");
    const ok = await pe.upsertSupport(db, { projectId: proj.id, supportNo: "SH-01",
      kind: "spring_hanger", lineId, loadKn: 12.5 });
    equal(Number(ok.load_kn), 12.5);
  });
});

test("a support cannot be inspected before it is installed", async () => {
  await withProject(db, proj.id, async () => {
    const s = await pe.upsertSupport(db, { projectId: proj.id, supportNo: "G-101",
      kind: "guide", lineId, spoolId: spools[0].id });
    await throws(() => pe.markSupport(db, { projectId: proj.id, supportId: s.id,
      step: "inspected", on: "2026-09-02" }), "INVALID_INPUT");
    await throws(() => db.query(
      "UPDATE pipe_support SET inspected_at = '2026-09-02' WHERE id = $1", [s.id]),
      "inspected_after_installed");

    await pe.markSupport(db, { projectId: proj.id, supportId: s.id, step: "installed",
      on: "2026-09-01", userId: alice.id });
    const done = await pe.markSupport(db, { projectId: proj.id, supportId: s.id,
      step: "inspected", on: "2026-09-02", userId: alice.id });
    assert(done.inspected_at);

    await throws(() => db.query(
      "UPDATE pipe_support SET inspected_at = '2026-08-01' WHERE id = $1", [s.id]),
      "inspected_after_installed", "and not dated before its own installation either");
  });
});

test("supports belong to one project", async () => {
  await withProject(db, other.id, async () => {
    equal((await pe.listSupports(db, { projectId: other.id })).length, 0);
  });
});

await run();
