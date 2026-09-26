#!/usr/bin/env node
/**
 * The instrumentation module: ISA 5.1 tags, bench calibration, loop checks
 * signed per loop, and a machine's instrument step answered by its devices.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseTag, parseRange, calibrationRequirement, judgeCalibration, parseInstrumentIndex,
} from "../../lib/instrumentation/isa.mjs";

// ── ISA 5.1 ──────────────────────────────────────────────────────────────

test("tags are read by the ISA 5.1 letter table", async () => {
  equal([parseTag("PT-1203A").category, parseTag("PT-1203A").loop], ["transmitter", "P-1203A"]);
  equal(parseTag("PDT-2101").loop, "PD-2101", "a modifier stays with the variable");
  equal(parseTag("FV-2101").category, "valve");
  equal(parseTag("PI-1203A").category, "gauge");
  equal(parseTag("TW-1101").category, "element");
});

test("S is safety only in a safety valve; elsewhere it is a switch", async () => {
  equal(parseTag("PSV-2101").category, "safety_valve");
  equal(parseTag("PSHH-3102").category, "switch");
  equal(parseTag("LSLL-1103").functions, ["S", "L", "L"]);
});

test("an unreadable tag is not filed as something", async () => {
  equal(parseTag("P-1203A"), null, "a pump, not an instrument");
  equal(parseTag("QQ-1203"), null, "Q is not a function letter");
  equal(parseTag("PT 1"), null);
});

test("ranges are read as schedules write them", async () => {
  equal(parseRange("0-25 bar"), { lo: 0, hi: 25, unit: "bar" });
  equal(parseRange("-1 to 5 barg"), { lo: -1, hi: 5, unit: "barg" });
  equal(parseRange("25-0 bar"), null, "a reversed range is a typo, not a range");
});

// ── calibration ──────────────────────────────────────────────────────────

const pt = { category: "transmitter", rangeLo: 0, rangeHi: 25 };
const req = calibrationRequirement(pt, { tolerancePct: 0.25 });
const five = (outs) => [0, 6.25, 12.5, 18.75, 25].map((applied, i) => ({ applied, output: outs[i] }));

test("a transmitter's error is a percentage of its 16 mA span", async () => {
  const r = judgeCalibration(five([4.01, 8.0, 12.03, 16.0, 19.98]), req);
  equal([r.valid, r.ok], [true, true]);
  assert(Math.abs(r.worstPct - 0.1875) < 0.001, "0.03 mA of 16 is 0.1875%");
  equal(judgeCalibration(five([4.01, 8.0, 12.05, 16.0, 19.98]), req).ok, false, "0.05 mA is 0.3125%");
});

test("a gauge's error is a percentage of its range", async () => {
  const g = calibrationRequirement({ category: "gauge", rangeLo: 0, rangeHi: 160 }, { tolerancePct: 1 });
  const pts = [0, 40, 80, 120, 160].map((a) => ({ applied: a, output: a + (a === 80 ? 1.6 : 0) }));
  equal(judgeCalibration(pts, g).ok, true, "1.6 of 160 is exactly 1%");
  pts[2].output = 81.7;
  equal(judgeCalibration(pts, g).ok, false);
});

test("fewer than five points, or points short of zero and span, get no verdict", async () => {
  const four = [0, 8, 17, 25].map((a) => ({ applied: a, output: 4 + (16 * a) / 25 }));
  const r4 = judgeCalibration(four, req);
  equal(r4.valid, false, "both ends reached, but four points");
  assert(/۵ نقطه/.test(r4.reason));
  const mid = [5, 8, 12, 15, 20].map((a) => ({ applied: a, output: 4 + (16 * a) / 25 }));
  const r = judgeCalibration(mid, req);
  equal(r.valid, false);
  assert(/دو سر رنج/.test(r.reason));
});

test("no range or no tolerance, no verdict; valves are not judged by points", async () => {
  assert(calibrationRequirement({ category: "transmitter" }, { tolerancePct: 0.25 }).reason);
  assert(calibrationRequirement(pt, {}).reason, "no tolerance is assumed");
  equal(calibrationRequirement({ ...pt, tolerancePct: 0.1 }, { tolerancePct: 0.5 }).tolerancePct, 0.1,
    "the datasheet's own tolerance wins over the project's");
  assert(calibrationRequirement({ category: "valve" }, { tolerancePct: 1 }).reason);
});

test("an index without a Loop column takes the ISA loop, marked as derived", async () => {
  const r = parseInstrumentIndex("Tag No,Service,Range,Equipment\nPT-1203A,Discharge,0-25 bar,P-1203A\nZZ9,x,,");
  equal([r.rows[0].loopNo, r.rows[0].loopDerived], ["P-1203A", true]);
  assert(r.problems.some((p) => p.tagNo === "ZZ9"), "an unreadable tag is flagged");
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "inst-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const acts = await import("../../lib/db/repos/activities.mjs");
const inst = await import("../../lib/db/repos/instrumentation.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "I110", name: "I110", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "OTHER", name: "O", ownerUserId: alice.id });
const P = proj.id;

const iid = async (no) => (await db.query(
  "SELECT id FROM instrument WHERE project_id = $1 AND tag_no = $2", [P, no])).rows[0].id;
const istep = async (no, code) =>
  (await inst.instrumentStatus(db, { projectId: P, instrumentId: await iid(no) })).steps.find((x) => x.code === code);
const mark = async (no, code) =>
  inst.recordInstrumentActivity(db, { projectId: P, instrumentId: await iid(no), code, doneAt: "2026-09-01" });
const cal = async (no, pts) =>
  inst.recordCalibration(db, { projectId: P, instrumentId: await iid(no), points: pts, calibratedOn: "2026-08-20" });
const tagStep = async (tagId, code) =>
  (await acts.tagStatus(db, { projectId: P, tagId })).steps.find((x) => x.code === code);

let pump;
const INDEX = [
  "Tag No,Service,Type,Range,Equipment",
  "PT-1203A,P-1203A discharge pressure,Smart transmitter,0-25 bar,P-1203A",
  "PI-1203A,P-1203A discharge local,Bourdon gauge,0-25 bar,P-1203A",
  "PSV-1203A,P-1203A casing relief,Safety valve,,P-1203A",
].join("\n");

test("an index imports; each instrument files under its equipment and its ISA loop", async () => {
  await withProject(db, P, async () => {
    const sub = await spine.upsertSubsystem(db, { projectId: P, code: "12-01" });
    pump = await spine.upsertTag(db, { projectId: P, tagNo: "P-1203A", discipline: "equipment",
      kind: "rotating", subsystemId: sub.id });
    const r = await inst.importInstrumentIndex(db, { projectId: P, text: INDEX });
    equal([r.imported, r.unmatched], [3, []]);
    const { rows } = await db.query(
      "SELECT tag_no, category, loop_no, eq_tag_id, subsystem_id FROM instrument ORDER BY tag_no");
    equal(rows.map((x) => [x.tag_no, x.category, x.loop_no]),
      [["PI-1203A", "gauge", "P-1203A"], ["PSV-1203A", "safety_valve", "P-1203A"], ["PT-1203A", "transmitter", "P-1203A"]]);
    assert(rows.every((x) => x.eq_tag_id === pump.id && x.subsystem_id === sub.id));
  });
});

test("a loop typed by a person is not overwritten by the derived one on re-import", async () => {
  await withProject(db, P, async () => {
    await inst.correctInstrument(db, { projectId: P, instrumentId: await iid("PSV-1203A"), loopNo: "" });
    await inst.importInstrumentIndex(db, { projectId: P, text: INDEX });
    const { rows: [r] } = await db.query("SELECT loop_no, loop_derived FROM instrument WHERE tag_no = 'PSV-1203A'");
    equal([r.loop_no, r.loop_derived], [null, false], "a PSV is not loop-checked; the person said so");
  });
});

test("a transmitter's calibration comes from its points, never a tick", async () => {
  await withProject(db, P, async () => {
    await throws(() => mark("PT-1203A", "calibrated"), "INVALID_INPUT");
    await cal("PT-1203A", "0:4.01 6.25:8 12.5:12.03 18.75:16 25:19.98");
    let c = await istep("PT-1203A", "calibrated");
    equal([c.status, c.note.level], ["not_started", "warn"], "no tolerance anywhere yet");
    await projects.updateProjectProfile(db, { projectId: P, patch: { calibration_tolerance_pct: 0.25 } });
    equal((await istep("PT-1203A", "calibrated")).status, "done");
  });
});

test("the latest calibration decides", async () => {
  await withProject(db, P, async () => {
    await cal("PT-1203A", "0:4.01 6.25:8 12.5:12.09 18.75:16 25:19.98");
    const c = await istep("PT-1203A", "calibrated");
    equal([c.status, c.note.level], ["not_started", "bad"]);
    assert(/0\.56\d% اسپن/.test(c.note.text), "0.09 mA of 16 is 0.5625%");
    await cal("PT-1203A", "0:4 6.25:8 12.5:12.01 18.75:16 25:20");
    equal((await istep("PT-1203A", "calibrated")).status, "done");
  });
});

test("two records in one request are ordered by when they were entered, not tied", async () => {
  // now() is fixed for a transaction; "latest decides" would be arbitrary
  // between two records entered in one request. Checked directly, because
  // a tie usually resolves in insertion order by luck.
  await withProject(db, P, async () => {
    for (const table of ["calibration", "ir_test", "plumb_reading", "bolting_record"]) {
      const { rows: [r] } = await db.query(
        `SELECT pg_get_expr(adbin, adrelid) AS d FROM pg_attrdef
          WHERE adrelid = $1::regclass AND adnum = (SELECT attnum FROM pg_attribute
                WHERE attrelid = $1::regclass AND attname = 'created_at')`, [table]);
      assert(/clock_timestamp/.test(r.d), `${table}.created_at defaults to ${r.d}`);
    }
  });
});

test("a safety valve's set-pressure test is the technician's to sign", async () => {
  await withProject(db, P, async () => {
    const c = await istep("PSV-1203A", "calibrated");
    equal(c.derived, false);
    await mark("PSV-1203A", "calibrated");
    equal((await istep("PSV-1203A", "calibrated")).status, "done");
  });
});

test("a loop check is refused while any instrument of the loop is not connected", async () => {
  await withProject(db, P, async () => {
    for (const c of ["installed", "hookup", "wired"]) await mark("PT-1203A", c);
    const e = await throws(() => inst.recordLoopCheck(db, { projectId: P, loopNo: "P-1203A",
      checkedOn: "2026-09-05" }), "INVALID_INPUT");
    assert(/PI-1203A/.test(e.message), "and names the instrument holding it");
    await throws(() => mark("PT-1203A", "loop_check"), "INVALID_INPUT", "never per instrument");
  });
});

test("one signature answers the loop check of every instrument in the loop", async () => {
  await withProject(db, P, async () => {
    await cal("PI-1203A", "0:0 6.25:6.3 12.5:12.5 18.75:18.7 25:25");
    for (const c of ["installed", "hookup", "wired"]) await mark("PI-1203A", c);
    await inst.recordLoopCheck(db, { projectId: P, loopNo: "P-1203A", checkedOn: "2026-09-05", refNo: "LC-0012" });
    for (const no of ["PT-1203A", "PI-1203A"]) {
      const s = await istep(no, "loop_check");
      equal([s.status, s.refNo], ["done", "LC-0012"]);
    }
  });
});

test("ready is a sign-off, and the pump's instrument step follows its instruments", async () => {
  await withProject(db, P, async () => {
    equal((await tagStep(pump.id, "instrument")).derived, true);
    await throws(() => acts.recordActivity(db, { projectId: P, tagId: pump.id, code: "instrument",
      doneAt: "2026-09-01" }), "INVALID_INPUT");
    await throws(() => mark("PSV-1203A", "ready"), "INVALID_INPUT", "the PSV is not installed");
    for (const c of ["installed", "hookup", "wired", "loop_check"]) await mark("PSV-1203A", c);
    for (const no of ["PT-1203A", "PI-1203A", "PSV-1203A"]) await mark(no, "ready");
    equal((await tagStep(pump.id, "instrument")).status, "done");
  });
});

test("instruments count in subsystem readiness beside welds and cables", async () => {
  await withProject(db, P, async () => {
    const { rows: [r] } = await db.query(
      `SELECT items::int, tested::int FROM reporting.kpi_subsystem_readiness
        WHERE project_key = $1 AND discipline = 'instrumentation'`, [P]);
    equal(r, { items: 3, tested: 3 });
  });
});

test("instruments belong to one project", async () => {
  await withProject(db, other.id, async () => {
    equal((await inst.instrumentBoard(db, { projectId: other.id })).instruments.length, 0);
  });
});

await run();
