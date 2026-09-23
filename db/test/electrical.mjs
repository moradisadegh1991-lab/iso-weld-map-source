#!/usr/bin/env node
/**
 * The electrical module: reading a cable schedule, judging insulation tests,
 * and a motor's electrical step answered by its cables.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseCableSize, parseRating, parseCableSchedule, matchTag, irRequirement, judgeIr, parseReading,
} from "../../lib/electrical/cable.mjs";

// ── reading a schedule ───────────────────────────────────────────────────

test("cores and size are read from the way schedules write them", async () => {
  equal(parseCableSize("3Cx95"), { cores: 3, sizeMm2: 95 });
  equal(parseCableSize("4 x 2.5 mm²"), { cores: 4, sizeMm2: 2.5 });
  equal(parseCableSize("3x1x240 XLPE"), { cores: 3, sizeMm2: 240 }, "three single cores");
  equal(parseCableSize("2x2x1.5"), { cores: 4, sizeMm2: 1.5 }, "two pairs");
  equal(parseCableSize("armoured"), null);
});

test("1 kV is the edge of low voltage", async () => {
  equal(parseRating("0.6/1kV").voltageClass, "LV");
  equal(parseRating("600/1000V").voltageClass, "LV");
  equal(parseRating("1.8/3 kV").voltageClass, "MV");
  equal(parseRating("6/10kV").voltageClass, "MV");
  equal(parseRating("10/6kV"), null, "U0 above U is a typo, not a cable");
});

test("a schedule row the rules cannot read is imported and flagged, never defaulted", async () => {
  const r = parseCableSchedule([
    "Cable No,From,To,Cable Type,Voltage,Length (m)",
    "EC-001,MCC-12,P-1203A,3Cx35 XLPE/SWA,0.6/1kV,85",
    "EC-002,MCC-12,P-1203B,armoured,,90",
    "EC-001,x,y,3x4,0.6/1kV,1",
  ].join("\n"));
  equal(r.rows.length, 2);
  equal(r.rows[1].cores, null);
  equal(r.rows[1].voltageClass, null);
  equal(r.problems.filter((p) => p.cableNo === "EC-002").length, 2, "size and rating both flagged");
  assert(r.problems.some((p) => /تکراری/.test(p.text)), "the duplicate is reported, not merged");
});

test("a cable is tied to the one tag its To field names — exactly", async () => {
  const tags = ["K-2101", "KT-2101", "P-1203A", "P-1203B"];
  equal(matchTag("K-2101 MOTOR", tags), "K-2101");
  equal(matchTag("KT-2101 aux", tags), "KT-2101", "not K-2101 by substring");
  equal(matchTag("P-1203A, P-1203B", tags), null, "two tags is for a person to settle");
  equal(matchTag("JB-44", tags), null);
});

// ── insulation resistance ────────────────────────────────────────────────

test("IEC 60364-6 Table 6.1 is keyed on the circuit voltage, not the cable rating", async () => {
  const lv = (v) => irRequirement({ voltageClass: "LV", systemVoltageV: v });
  equal([lv(400).testV, lv(400).minMohm], [500, 1.0]);
  equal([lv(500).testV, lv(690).testV], [500, 1000], "500 V is still the lower band");
  equal([lv(24).testV, lv(24).minMohm], [250, 0.5], "SELV/PELV");
});

test("no circuit voltage anywhere, no IR verdict", async () => {
  assert(irRequirement({ voltageClass: "LV", systemVoltageV: null }).reason);
  equal(irRequirement({ voltageClass: "LV" }, { lvSystemVoltageV: 400 }).testV, 500,
    "the project's LV voltage stands in when the schedule is silent");
});

test("medium voltage is judged only against the project's own criterion", async () => {
  assert(irRequirement({ voltageClass: "MV" }).reason, "IEC 60364-6 does not cover it");
  equal(irRequirement({ voltageClass: "MV" }, { mvTestVoltageV: 5000, mvMinMohm: 1000 }).minMohm, 1000);
  assert(irRequirement({ voltageClass: null }, { lvSystemVoltageV: 400 }).reason, "an unknown class is not LV");
});

const req400 = irRequirement({ voltageClass: "LV", systemVoltageV: 400 });

test("every core is measured", async () => {
  const r = judgeIr({ testVoltageV: 500, readings: ["200", "200", "200"] }, { cores: 4 }, req400);
  equal(r.valid, false);
  assert(/4 رشته/.test(r.reason));
});

test("a test at a lower voltage proves less and is not accepted", async () => {
  equal(judgeIr({ testVoltageV: 250, readings: ["500", "500", "500"] }, { cores: 3 }, req400).valid, false);
});

test("the lowest reading decides", async () => {
  const r = judgeIr({ testVoltageV: 500, readings: [">2000", "∞", "0.8"] }, { cores: 3 }, req400);
  equal([r.valid, r.ok, r.minMohm], [true, false, 0.8]);
  equal(judgeIr({ testVoltageV: 1000, readings: ["1.0", "5", "9"] }, { cores: 3 }, req400).ok, true,
    "on the limit, and a higher test voltage is no reason to refuse");
  equal(parseReading(">2000"), 2000);
  equal(parseReading("abc"), null);
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "elec-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const acts = await import("../../lib/db/repos/activities.mjs");
const elec = await import("../../lib/db/repos/electrical.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "E110", name: "E110", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "OTHER", name: "O", ownerUserId: alice.id });
const P = proj.id;

const cid = async (no) => (await db.query(
  "SELECT id FROM cable WHERE project_id = $1 AND cable_no = $2", [P, no])).rows[0].id;
const cstep = async (no, code) =>
  (await elec.cableStatus(db, { projectId: P, cableId: await cid(no) })).steps.find((x) => x.code === code);
const mark = async (no, code, doneAt = "2026-09-01") =>
  elec.recordCableActivity(db, { projectId: P, cableId: await cid(no), code, doneAt, userId: alice.id });
const tagStep = async (tagId, code) =>
  (await acts.tagStatus(db, { projectId: P, tagId })).steps.find((x) => x.code === code);

let pump, spare, sub;
const SCHEDULE = [
  "Cable No,From,To,Cable Type,Voltage,Length (m)",
  "EC-1203A-P,MCC-12,P-1203A,3Cx35 XLPE/SWA,0.6/1kV,85",
  "EC-1203A-C,LCS-1203A,P-1203A,4x2.5,0.6/1kV,30",
  "EC-2101-P,SWGR-21,K-2101,3x1x240,6/10kV,210",
  "EC-9999,DB-9,JB-44,2x2x1.5,0.6/1kV,40",
].join("\n");

test("a schedule imports, and each cable files under the tag it feeds", async () => {
  await withProject(db, P, async () => {
    sub = await spine.upsertSubsystem(db, { projectId: P, code: "12-01" });
    pump = await spine.upsertTag(db, { projectId: P, tagNo: "P-1203A", discipline: "equipment",
      kind: "rotating", subsystemId: sub.id });
    spare = await spine.upsertTag(db, { projectId: P, tagNo: "P-1203B", discipline: "equipment",
      kind: "rotating", subsystemId: sub.id });
    await spine.upsertTag(db, { projectId: P, tagNo: "K-2101", discipline: "equipment", kind: "rotating" });
    const r = await elec.importCableSchedule(db, { projectId: P, text: SCHEDULE });
    equal(r.imported, 4);
    equal(r.unmatched, ["EC-9999"], "a junction box is not a tag yet — reported, not guessed");
    const { rows: [c] } = await db.query(
      "SELECT to_tag_id, subsystem_id, cores, voltage_class FROM cable WHERE cable_no = 'EC-1203A-P'");
    equal([c.to_tag_id, c.subsystem_id, c.cores, c.voltage_class], [pump.id, sub.id, 3, "LV"]);
  });
});

test("a person's correction survives a re-import that cannot name the tag", async () => {
  await withProject(db, P, async () => {
    await elec.correctCable(db, { projectId: P, cableId: await cid("EC-9999"), toTagId: spare.id });
    await elec.importCableSchedule(db, { projectId: P, text: SCHEDULE });
    const { rows: [c] } = await db.query("SELECT to_tag_id FROM cable WHERE cable_no = 'EC-9999'");
    equal(c.to_tag_id, spare.id);
    await elec.correctCable(db, { projectId: P, cableId: await cid("EC-9999"), toTagId: null });
  });
});

test("once cables feed it, a motor's electrical step is theirs to answer", async () => {
  await withProject(db, P, async () => {
    equal((await tagStep(pump.id, "electrical")).derived, true);
    await throws(() => acts.recordActivity(db, { projectId: P, tagId: pump.id, code: "electrical",
      doneAt: "2026-09-01" }), "INVALID_INPUT");
    // P-1203B has no cable: still a manual record.
    await acts.recordActivity(db, { projectId: P, tagId: spare.id, code: "electrical", doneAt: "2026-09-01" });
    equal((await tagStep(spare.id, "electrical")).status, "done");
  });
});

test("IR is never ticked, and HV does not apply to a LV cable", async () => {
  await withProject(db, P, async () => {
    await throws(() => mark("EC-1203A-P", "ir"), "INVALID_INPUT");
    const hv = await cstep("EC-1203A-P", "hv_test");
    equal([hv.na, hv.status, hv.outOfOrder], [true, "done", false]);
    await throws(() => mark("EC-1203A-P", "hv_test"), "INVALID_INPUT");
    equal((await cstep("EC-2101-P", "hv_test")).na, false, "an MV cable has one, signed by its tester");
  });
});

test("an IR test gets no verdict until the circuit voltage is known", async () => {
  await withProject(db, P, async () => {
    for (const c of ["route", "pulled", "terminated"]) await mark("EC-1203A-P", c);
    const cable = await cid("EC-1203A-P");
    await elec.recordIrTest(db, { projectId: P, cableId: cable, testVoltageV: 500,
      readings: ">2000 >2000 >2000", testedOn: "2026-09-02" });
    let ir = await cstep("EC-1203A-P", "ir");
    equal([ir.status, ir.note.level], ["not_started", "warn"]);
    await projects.updateProjectProfile(db, { projectId: P, patch: { lv_system_voltage_v: 400 } });
    ir = await cstep("EC-1203A-P", "ir");
    equal(ir.status, "done");
  });
});

test("the latest test decides: a failed re-test takes the acceptance back", async () => {
  await withProject(db, P, async () => {
    const cable = await cid("EC-1203A-P");
    await elec.recordIrTest(db, { projectId: P, cableId: cable, testVoltageV: 500,
      readings: "1500 0.4 1800", testedOn: "2026-09-05" });
    let ir = await cstep("EC-1203A-P", "ir");
    equal([ir.status, ir.note.level], ["not_started", "bad"]);
    assert(/0.4 MΩ/.test(ir.note.text));
    await elec.recordIrTest(db, { projectId: P, cableId: cable, testVoltageV: 500,
      readings: "1500 1200 1800", testedOn: "2026-09-07" });
    equal((await cstep("EC-1203A-P", "ir")).status, "done");
  });
});

test("ready is a sign-off: refused while continuity is open", async () => {
  await withProject(db, P, async () => {
    const e = await throws(() => mark("EC-1203A-P", "ready"), "INVALID_INPUT");
    assert(/پیوستگی/.test(e.message));
    await mark("EC-1203A-P", "continuity");
    await mark("EC-1203A-P", "ready");
    const s = await elec.cableStatus(db, { projectId: P, cableId: await cid("EC-1203A-P") });
    equal([s.why.ready, s.progress.pct], [true, 100]);
  });
});

test("the motor is energisable only when every cable feeding it is", async () => {
  await withProject(db, P, async () => {
    equal((await tagStep(pump.id, "electrical")).status, "in_progress", "the control cable is not done");
    const c = "EC-1203A-C";
    for (const x of ["route", "pulled", "terminated", "continuity"]) await mark(c, x);
    await elec.recordIrTest(db, { projectId: P, cableId: await cid(c), testVoltageV: 500,
      readings: "900 900 900 900", testedOn: "2026-09-08" });
    await mark(c, "ready");
    equal((await tagStep(pump.id, "electrical")).status, "done");
  });
});

test("a motor's cables are not its piping", async () => {
  // fact_progress now carries cables beside welds. The piping step read it
  // by tag alone, so a ready cable would have counted as tested piping.
  await withProject(db, P, async () => {
    await db.query("INSERT INTO line (project_id, line_no, tag_id) VALUES ($1, 'L-1', $2)", [P, pump.id]);
    equal((await tagStep(pump.id, "piping")).status, "not_started", "one line, no welds, nothing tested");
  });
});

test("cables count in subsystem readiness beside welds", async () => {
  await withProject(db, P, async () => {
    const { rows } = await db.query(
      `SELECT items::int, tested::int FROM reporting.kpi_subsystem_readiness
        WHERE project_key = $1 AND discipline = 'electrical' AND subsystem_key = $2`, [P, sub.id]);
    equal(rows[0], { items: 2, tested: 2 });
  });
});

test("cables belong to one project", async () => {
  await withProject(db, other.id, async () => {
    equal((await elec.cableBoard(db, { projectId: other.id })).length, 0);
  });
});

await run();
