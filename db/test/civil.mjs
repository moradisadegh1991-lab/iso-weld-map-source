#!/usr/bin/env node
/**
 * The civil module: concrete acceptance, the foundation chain, and the
 * foundation handing over to the equipment it carries.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  individualLimit, strengthTest, evaluateClass, samplesRequired, curingComplete,
} from "../../lib/civil/concrete.mjs";

// ── the individual limit, both sides of 35 MPa ───────────────────────────

test("an individual test may fall 3.5 MPa below f′c up to 35 MPa, and 10% above it", async () => {
  equal(individualLimit(30), 26.5);
  // At exactly 35 both rules give 31.5 (35 − 3.5 = 0.9 × 35): the limit is
  // continuous, so which side of the band 35 belongs to cannot change it.
  equal(individualLimit(35), 31.5);
  equal(individualLimit(34), 30.5, "just below, the 3.5 MPa band");
  equal(individualLimit(36), 32.4, "just above, 90%");
  equal(individualLimit(40), 36, "above 35 the limit is 0.90·f′c");
  equal(individualLimit(0), null);
  equal(individualLimit("x"), null);
});

// ── what counts as a strength test ───────────────────────────────────────

const cyl = (mpa, ageDays = 28, type = "cyl150") => ({ type, ageDays, mpa });

test("a strength test is the average of enough cylinders of one size and age", async () => {
  equal(strengthTest([cyl(31), cyl(33)]), { valid: true, mpa: 32, n: 2 });
  equal(strengthTest([cyl(30, 28, "cyl100"), cyl(31, 28, "cyl100"), cyl(32, 28, "cyl100")]).mpa, 31);
});

test("one 150 mm cylinder is a specimen, not a test", async () => {
  const t = strengthTest([cyl(34)]);
  equal(t.valid, false);
  assert(/دست‌کم 2/.test(t.reason));
  equal(strengthTest([cyl(30, 28, "cyl100"), cyl(31, 28, "cyl100")]).valid, false,
    "and 100 mm cylinders need three");
});

test("cube results are not judged against a cylinder f′c", async () => {
  // Cube strength runs higher than cylinder strength for the same concrete.
  // Judging one by the other's rule would pass weak concrete.
  const t = strengthTest([cyl(38, 28, "cube150"), cyl(39, 28, "cube150"), cyl(40, 28, "cube150")]);
  equal(t.valid, false);
  assert(/مکعب/.test(t.reason));
});

test("specimens of different sizes or ages are not averaged together", async () => {
  equal(strengthTest([cyl(30), cyl(31, 28, "cyl100")]).valid, false);
  equal(strengthTest([cyl(30), cyl(31, 7)]).valid, false);
});

test("a 7-day break is early information, not an acceptance test", async () => {
  const t = strengthTest([cyl(22, 7), cyl(23, 7)]);
  equal(t.valid, false);
  equal(t.early, true, "and it is marked as early rather than as bad data");
  equal(strengthTest([cyl(40, 56), cyl(41, 56)], { ageDays: 56 }).valid, true,
    "a class specified at 56 days is judged at 56 days");
});

// ── the class ────────────────────────────────────────────────────────────

const t = (id, mpa, at) => ({ id, mpa, at });

test("a class with every test and every three-test average above f′c is satisfactory", async () => {
  const r = evaluateClass([t("A", 32, "2026-05-01"), t("B", 31, "2026-05-02"), t("C", 33, "2026-05-03")], 30);
  equal(r.satisfactory, true);
  equal(r.tests.map((x) => x.verdict), ["accepted", "accepted", "accepted"]);
  equal(r.tests[2].window, 32);
});

test("one test below the individual limit is low, whatever the average", async () => {
  // 26 is 4 MPa under f′c = 30: outside the 3.5 MPa band even though the
  // running average stays above 30.
  const r = evaluateClass([t("A", 36, "1"), t("B", 26, "2"), t("C", 36, "3")], 30);
  equal(r.tests[1].verdict, "low");
  equal(r.tests[2].window, 32.7, "the average alone would have passed it");
  equal(r.satisfactory, false);
});

test("a low three-test average puts all three under investigation", async () => {
  // Each test is inside the individual band, but together they are below
  // f′c — the class strength level is not satisfactory (§26.12.4).
  const r = evaluateClass([t("A", 29, "1"), t("B", 28, "2"), t("C", 29.5, "3"), t("D", 34, "4")], 30);
  equal(r.tests.map((x) => x.verdict), ["investigate", "investigate", "investigate", "accepted"]);
  equal(r.tests[2].windowOk, false);
  equal(r.tests.map((x) => x.failedWindow), [28.8, 28.8, 28.8, undefined],
    "every test in the failed window says which average held it, not only the newest");
});

test("with fewer than three tests the class average cannot be judged yet", async () => {
  const r = evaluateClass([t("A", 31, "1"), t("B", 32, "2")], 30);
  equal(r.tests.map((x) => x.verdict), ["provisional", "provisional"]);
  equal(r.satisfactory, null, "no verdict on the class, not a pass");
});

test("tests are judged in the order they were made, not the order they were entered", async () => {
  const r = evaluateClass([t("C", 29.5, "2026-05-03"), t("A", 29, "2026-05-01"), t("B", 28, "2026-05-02")], 30);
  equal(r.tests.map((x) => x.id), ["A", "B", "C"]);
});

// ── sampling and curing ──────────────────────────────────────────────────

test("a pour needs one sample a day and one per 150 yd³", async () => {
  equal(samplesRequired(40), 1);
  equal(samplesRequired(114.7), 1);
  equal(samplesRequired(120), 2);
  equal(samplesRequired(0), null);
});

test("curing is complete only against a stated period", async () => {
  equal(curingComplete("2026-09-01", 7, "2026-09-08"), true);
  equal(curingComplete("2026-09-01", 7, "2026-09-05"), false);
  equal(curingComplete("2026-09-01", null, "2026-12-01"), null,
    "no period in the spec, no verdict — a default here would decide when forms come off");
  equal(curingComplete(null, 7, "2026-09-08"), false, "nothing poured, nothing cured");
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "civil-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const acts = await import("../../lib/db/repos/activities.mjs");
const civil = await import("../../lib/db/repos/civil.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "K110", name: "K110", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "OTHER", name: "O", ownerUserId: alice.id });
const DAY = 864e5;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
let pump, fdn, sub;

const status = (tagId) => acts.tagStatus(db, { projectId: proj.id, tagId });
const step = (s, code) => s.steps.find((x) => x.code === code);
const tick = (tagId, code, when = daysAgo(60)) =>
  acts.recordActivity(db, { projectId: proj.id, tagId, code, doneAt: when, userId: alice.id });
const specimens = (pourId, sampleNo, ageDays, results, type = "cyl150") =>
  civil.recordSpecimens(db, { projectId: proj.id, pourId, sampleNo, specimenType: type, ageDays, results });

test("a foundation carries its machine and files under the machine's subsystem", async () => {
  await withProject(db, proj.id, async () => {
    sub = await spine.upsertSubsystem(db, { projectId: proj.id, code: "21-01" });
    pump = await spine.upsertTag(db, { projectId: proj.id, tagNo: "K-101", discipline: "equipment",
      kind: "rotating", subsystemId: sub.id });
    fdn = await civil.upsertFoundation(db, { projectId: proj.id, tagNo: "FDN-K-101",
      carriesTagId: pump.id, concreteClass: "C30", fcMpa: 30, volumeM3: 48,
      anchorBoltRef: "VND-K101-AB-02" });
    const { rows: [t] } = await db.query("SELECT subsystem_id, discipline, kind FROM tag WHERE id = $1", [fdn.id]);
    equal(t.subsystem_id, sub.id, "built for that machine, handed over with it");
    equal([t.discipline, t.kind], ["civil", "foundation"]);
  });
});

test("a foundation with no specified concrete is refused", async () => {
  await withProject(db, proj.id, async () => {
    await throws(() => civil.upsertFoundation(db, { projectId: proj.id, tagNo: "FDN-X" }), "INVALID_INPUT");
  });
});

test("once a foundation carries it, the machine's foundation step is civil's to answer", async () => {
  await withProject(db, proj.id, async () => {
    const s = await status(pump.id);
    equal(step(s, "foundation").derived, true);
    equal(step(s, "foundation").status, "not_started");
    const e = await throws(() => tick(pump.id, "foundation"), "INVALID_INPUT");
    assert(/از داده خوانده می‌شود/.test(e.message), "no hand-ticked foundation beside civil's record");
  });
});

test("a machine with no foundation in civil still records its foundation by hand", async () => {
  // A project not tracking civil yet must not be stuck.
  await withProject(db, proj.id, async () => {
    const v = await spine.upsertTag(db, { projectId: proj.id, tagNo: "V-102", discipline: "equipment",
      kind: "static", subsystemId: sub.id });
    await tick(v.id, "foundation");
    const s = await status(v.id);
    equal(step(s, "foundation").status, "done");
    equal(step(s, "foundation").derived, false, "and it is shown as a manual record");
  });
});

test("the foundation chain starts at excavation, and a pour cannot be ticked", async () => {
  await withProject(db, proj.id, async () => {
    const s = await status(fdn.id);
    equal(s.next.map((n) => n.code), ["excavation"]);
    for (const code of ["pour", "curing", "strength"]) {
      await throws(() => tick(fdn.id, code), "INVALID_INPUT", `${code} comes from the pour card and the lab`);
    }
  });
});

test("anchor bolts come before the pre-pour hold point, and the pour after it", async () => {
  const { CHAINS } = await import("../../lib/platform/precedence.mjs");
  const f = CHAINS.foundation;
  assert(f.find((x) => x.code === "pre_pour").after.includes("embedments"));
  assert(f.find((x) => x.code === "pour").after.includes("pre_pour"));
  equal(f.find((x) => x.code === "ready").after.sort(), ["backfill", "strength"],
    "handover waits for strength acceptance, not the calendar");
});

let pour1;
test("a pour recorded before the hold point is kept, and flagged", async () => {
  // The concrete is in the ground either way; refusing the record would
  // lose the evidence without undoing the pour.
  await withProject(db, proj.id, async () => {
    for (const c of ["excavation", "blinding", "rebar", "embedments"]) await tick(fdn.id, c);
    pour1 = await civil.recordPour(db, { projectId: proj.id, tagId: fdn.id, pourNo: "PC-0101",
      pouredOn: daysAgo(40), volumeM3: 48, concreteClass: "C30", fcMpa: 30, userId: alice.id });
    const s = await status(fdn.id);
    equal(step(s, "pour").status, "done");
    equal(step(s, "pour").outOfOrder, true, "pre-pour was never signed");
    await tick(fdn.id, "pre_pour", daysAgo(41));
    equal(step(await status(fdn.id), "pour").outOfOrder, false);
  });
});

test("curing gets no verdict until the project states its period", async () => {
  await withProject(db, proj.id, async () => {
    let s = await status(fdn.id);
    equal(step(s, "curing").status, "not_started");
    assert(/مدت عمل‌آوری/.test(step(s, "curing").note.text), "and it says why");
    await projects.updateProjectProfile(db, { projectId: proj.id, patch: { concrete_curing_days: 7 } });
    s = await status(fdn.id);
    equal(step(s, "curing").status, "done", "40 days after the pour, 7 days of curing are over");
  });
});

test("a 7-day break leaves strength waiting, and says what it showed", async () => {
  await withProject(db, proj.id, async () => {
    await specimens(pour1.id, "S1", 7, [21.5, 22.5]);
    const s = await status(fdn.id);
    equal(step(s, "strength").status, "in_progress");
    assert(/7 روزه 22 MPa/.test(step(s, "strength").note.text));
  });
});

test("one 28-day cylinder is not a test, and the foundation is not accepted on it", async () => {
  await withProject(db, proj.id, async () => {
    await specimens(pour1.id, "S1", 28, [33]);
    const s = await status(fdn.id);
    equal(step(s, "strength").status, "not_started");
    equal(step(s, "strength").note.level, "bad");
  });
});

test("two cylinders make a test; the first of a class is accepted provisionally", async () => {
  await withProject(db, proj.id, async () => {
    await specimens(pour1.id, "S1", 28, [34]);                      // now two at 28 days
    const s = await status(fdn.id);
    equal(step(s, "strength").status, "done");
    assert(/موقت/.test(step(s, "strength").note.text), "fewer than three tests in the class");
  });
});

test("the machine can be set once its foundation is handed over", async () => {
  await withProject(db, proj.id, async () => {
    await tick(fdn.id, "backfill");
    await tick(fdn.id, "ready");
    const s = await status(pump.id);
    equal(step(s, "foundation").status, "done", "civil answered it");
    equal(s.next.map((n) => n.code), ["set"]);
  });
});

test("a C25 truck on a C30 foundation stops acceptance, whatever its breaks say", async () => {
  await withProject(db, proj.id, async () => {
    const f2 = await civil.upsertFoundation(db, { projectId: proj.id, tagNo: "FDN-P-102",
      concreteClass: "C30", fcMpa: 30, volumeM3: 12 });
    const p = await civil.recordPour(db, { projectId: proj.id, tagId: f2.id, pourNo: "PC-0102",
      pouredOn: daysAgo(35), volumeM3: 12, concreteClass: "C25", fcMpa: 25 });
    await specimens(p.id, "S1", 28, [29, 30]);                       // fine for C25
    const s = await status(f2.id);
    equal(step(s, "strength").status, "not_started");
    assert(/C25/.test(step(s, "strength").note.text) && /C30/.test(step(s, "strength").note.text));
  });
});

test("a large pour with one sample is undersampled", async () => {
  await withProject(db, proj.id, async () => {
    const f3 = await civil.upsertFoundation(db, { projectId: proj.id, tagNo: "FDN-T-103",
      concreteClass: "C35", fcMpa: 35, volumeM3: 230 });
    const p = await civil.recordPour(db, { projectId: proj.id, tagId: f3.id, pourNo: "PC-0103",
      pouredOn: daysAgo(33), volumeM3: 230, concreteClass: "C35", fcMpa: 35 });
    await specimens(p.id, "S1", 28, [40, 41]);
    const s = await status(f3.id);
    equal(step(s, "strength").status, "not_started");
    assert(/دست‌کم 3 آزمون/.test(step(s, "strength").note.text), "230 m³ needs three samples");
  });
});

test("a low three-test average of a class holds every foundation in the window", async () => {
  // Each test passes on its own; together they are under f′c. The class
  // strength level is not satisfactory and all three are investigated —
  // including the foundation already handed over, which is no longer ready.
  await withProject(db, proj.id, async () => {
    const ids = [];
    for (const [no, mpa, ago] of [["FDN-A", [28.5, 29.5], 30], ["FDN-B", [28, 29], 29]]) {
      const f = await civil.upsertFoundation(db, { projectId: proj.id, tagNo: no,
        concreteClass: "C30", fcMpa: 30, volumeM3: 20 });
      const p = await civil.recordPour(db, { projectId: proj.id, tagId: f.id, pourNo: `PC-${no}`,
        pouredOn: daysAgo(ago), volumeM3: 20, concreteClass: "C30", fcMpa: 30 });
      await specimens(p.id, "S1", 28, mpa);
      ids.push(f.id);
    }
    // Class C30 now: FDN-K-101 33.5, FDN-A 29, FDN-B 28.5 → average 30.3 ≥ 30, fine.
    let s = await status(ids[1]);
    equal(step(s, "strength").status, "done");

    const f = await civil.upsertFoundation(db, { projectId: proj.id, tagNo: "FDN-C",
      concreteClass: "C30", fcMpa: 30, volumeM3: 20 });
    const p = await civil.recordPour(db, { projectId: proj.id, tagId: f.id, pourNo: "PC-FDN-C",
      pouredOn: daysAgo(28), volumeM3: 20, concreteClass: "C30", fcMpa: 30 });
    await specimens(p.id, "S1", 28, [29, 29.5]);
    // Last three: 29, 28.5, 29.3 → 28.9 < 30.
    for (const id of [...ids, f.id]) {
      s = await status(id);
      equal(step(s, "strength").status, "not_started", "under investigation, not accepted");
      assert(/بررسی مقاومت پایین/.test(step(s, "strength").note.text));
    }
    s = await status(fdn.id);
    equal(step(s, "strength").status, "done", "the first test is outside the failing window");
  });
});

test("a later-age break is information, not a failure", async () => {
  await withProject(db, proj.id, async () => {
    await specimens(pour1.id, "S9", 56, [36]);                        // one extra 56-day cylinder
    equal(step(await status(fdn.id), "strength").status, "done");
  });
});

test("foundations belong to one project", async () => {
  await withProject(db, other.id, async () => {
    equal((await civil.listFoundations(db, { projectId: other.id })).length, 0);
  });
});

await run();
