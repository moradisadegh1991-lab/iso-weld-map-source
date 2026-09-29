#!/usr/bin/env node
/**
 * Work the contractor hands over and the employer accepts (migration 055,
 * lib/db/repos/claims.mjs): with the project's approval on, a contractor's
 * "done" is a claim that counts nowhere until someone signing for the
 * employer approves it; a rejection needs a reason and leaves the step open;
 * nobody approves their own claim.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";

process.env.PGLITE_DIR = await scratchDir("claims-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const acts = await import("../../lib/db/repos/activities.mjs");
const elec = await import("../../lib/db/repos/electrical.mjs");
const claims = await import("../../lib/db/repos/claims.mjs");
const { METRICS } = await import("../../lib/contracts/metrics.mjs");

const db = await getDb();
const con = await projects.ensureUser(db, { subject: "kc|con" });   // contractor's site engineer
const emp = await projects.ensureUser(db, { subject: "kc|emp" });   // employer's representative
const proj = await projects.createProject(db, { code: "CLM", name: "C", ownerUserId: con.id });
const P = proj.id;
await projects.addMember(db, { projectId: P, userId: emp.id, role: "engineer" });
await projects.setInspectionParty(db, { projectId: P, userId: con.id, party: "contractor" });
await projects.setInspectionParty(db, { projectId: P, userId: emp.id, party: "company" });
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

let sub, pump, drum, cable;
await withProject(db, P, async () => {
  sub = await spine.upsertSubsystem(db, { projectId: P, code: "70-01", systemCode: "70", name: "S" });
  pump = await spine.upsertTag(db, { projectId: P, tagNo: "P-7001", discipline: "equipment", kind: "rotating", subsystemId: sub.id });
  drum = await spine.upsertTag(db, { projectId: P, tagNo: "D-7002", discipline: "equipment", kind: "static", subsystemId: sub.id });
  await elec.importCableSchedule(db, { projectId: P, text: "Cable No,From,To,Cable Type,Voltage,Length (m)\nCBL-1,MCC-70,P-7001,3Cx16 XLPE/SWA/PVC,0.6/1kV,60" });
  cable = (await db.query("SELECT id FROM cable WHERE cable_no = 'CBL-1'")).rows[0];
});
const setCount = () => db.query(METRICS.equipment_set.sql, [P, daysAgo(0), sub.id]).then((r) => Number(r.rows[0].qty));

test("with the approval off, the contractor's record is the record", async () => {
  await withProject(db, P, async () => {
    const r = await acts.recordActivity(db, { projectId: P, tagId: drum.id, code: "set", doneAt: daysAgo(9), userId: con.id });
    equal([r.status, r.claimed_on ?? null], ["done", null]);
    equal(await setCount(), 1);
  });
});

test("with it on, the contractor's «done» is a claim: open, dated, counted nowhere", async () => {
  await withProject(db, P, async () => {
    await projects.updateProjectProfile(db, { projectId: P, patch: { site_work_approval: true } });
    const r = await acts.recordActivity(db, { projectId: P, tagId: pump.id, code: "set", doneAt: daysAgo(5), refNo: "SET-1", userId: con.id });
    equal([r.status, r.claimed, iso(r.claimed_on)], ["in_progress", true, daysAgo(5)]);
    equal(await setCount(), 1, "the payment metric does not count a claim");
    const st = await acts.tagStatus(db, { projectId: P, tagId: pump.id });
    const set = st.steps.find((s) => s.code === "set");
    assert(set.status !== "done" && set.claimedOn, `the step reads open, with its claim (${set.status}, ${set.claimedOn})`);
    const b = await claims.claimsBoard(db, { projectId: P });
    equal(b.pending.map((x) => [x.item, x.step, x.claimedOn]), [["P-7001", "استقرار و تراز بیس‌پلیت", daysAgo(5)]]);
  });
});

test("only the employer's side decides — never on its own claim", async () => {
  await withProject(db, P, async () => {
    const [c] = (await claims.claimsBoard(db, { projectId: P })).pending;
    const e = await throws(() => claims.decideClaims(db, { projectId: P, items: [c], decision: "approve", userId: con.id }), "INVALID_INPUT");
    assert(/کارفرما/.test(e.message), e.message);
    // Someone who claimed and later came to sign for the employer still does not approve their own claim.
    await projects.setInspectionParty(db, { projectId: P, userId: con.id, party: "company" });
    const e2 = await throws(() => claims.decideClaims(db, { projectId: P, items: [c], decision: "approve", userId: con.id }), "INVALID_INPUT");
    assert(/اعلام‌کننده/.test(e2.message), e2.message);
    await projects.setInspectionParty(db, { projectId: P, userId: con.id, party: "contractor" });
  });
});

test("approved, the step is done on the day claimed and counts; the contractor cannot re-open it", async () => {
  await withProject(db, P, async () => {
    const [c] = (await claims.claimsBoard(db, { projectId: P })).pending;
    const b = await claims.decideClaims(db, { projectId: P, items: [c], decision: "approve", userId: emp.id });
    equal(b.pending.length, 0);
    const { rows: [r] } = await db.query("SELECT status, done_at, approved_by FROM tag_activity WHERE id = $1", [c.id]);
    equal([r.status, iso(r.done_at), r.approved_by], ["done", daysAgo(5), emp.id]);
    equal(await setCount(), 2);
    await throws(() => acts.recordActivity(db, { projectId: P, tagId: pump.id, code: "set", doneAt: daysAgo(1), userId: con.id }), "INVALID_INPUT");
  });
});

test("rejected, it needs a reason and stays open; claimed again, it waits again", async () => {
  await withProject(db, P, async () => {
    const r = await elec.recordCableActivity(db, { projectId: P, cableId: cable.id, code: "pulled", doneAt: daysAgo(3), userId: con.id });
    equal(r.status, "in_progress");
    const item = { table: "cable_activity", id: r.id };
    await throws(() => claims.decideClaims(db, { projectId: P, items: [item], decision: "reject", userId: emp.id }), "INVALID_INPUT");
    const b = await claims.decideClaims(db, { projectId: P, items: [item], decision: "reject", reason: "Cable not dressed on tray", userId: emp.id });
    equal(b.pending.length, 0);
    const st = await elec.cableStatus(db, { projectId: P, cableId: cable.id });
    const pulled = st.steps.find((s) => s.code === "pulled");
    equal([pulled.status !== "done", pulled.rejected], [true, "Cable not dressed on tray"]);
    await elec.recordCableActivity(db, { projectId: P, cableId: cable.id, code: "pulled", doneAt: daysAgo(2), userId: con.id });
    const again = (await claims.claimsBoard(db, { projectId: P })).pending;
    equal(again.map((x) => [x.item, x.claimedOn, x.reason]), [["CBL-1", daysAgo(2), null]]);
  });
});

test("the employer's own record needs no approval", async () => {
  await withProject(db, P, async () => {
    const r = await acts.recordActivity(db, { projectId: P, tagId: drum.id, code: "grout", doneAt: daysAgo(4), userId: emp.id });
    equal([r.status, r.claimed_on ?? null], ["done", null]);
  });
});

test("a step waiting only on declared steps may be declared too; a sign-off may not", async () => {
  await withProject(db, P, async () => {
    await elec.importCableSchedule(db, { projectId: P, text: "Cable No,From,To,Cable Type,Voltage,Length (m)\nCBL-2,LDB-70,LP-70-01,3Cx2.5 XLPE/SWA/PVC,0.6/1kV,40" });
    const c2 = (await db.query("SELECT id FROM cable WHERE cable_no = 'CBL-2'")).rows[0];
    const route = await elec.recordCableActivity(db, { projectId: P, cableId: c2.id, code: "route", doneAt: daysAgo(4), userId: con.id });
    let st = await elec.cableStatus(db, { projectId: P, cableId: c2.id });
    const pulled = st.steps.find((s) => s.code === "pulled");
    equal([pulled.blocked, pulled.claimable], [true, true], "the crew moves on while the approval catches up — still blocked for a sign-off");
    equal(st.steps.find((s) => s.code === "ready").claimable, false, "the sign-off is never declared on a claim");
    await claims.decideClaims(db, { projectId: P, items: [{ table: "cable_activity", id: route.id }], decision: "approve", userId: emp.id });
    st = await elec.cableStatus(db, { projectId: P, cableId: c2.id });
    equal(st.steps.find((s) => s.code === "pulled").blocked, false);
  });
});

await run();
