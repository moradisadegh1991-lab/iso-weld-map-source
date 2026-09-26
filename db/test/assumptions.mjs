#!/usr/bin/env node
/**
 * The assumption register (stored, revised, decided) and the
 * missing-information register (computed from what the engines refuse on).
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "assume-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const reg = await import("../../lib/db/repos/assumptions.mjs");
const elec = await import("../../lib/db/repos/electrical.mjs");
const steel = await import("../../lib/db/repos/structural.mjs");
const inst = await import("../../lib/db/repos/instrumentation.mjs");
const docsRepo = await import("../../lib/db/repos/documents.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice", displayName: "Alice" });
const proj = await projects.createProject(db, { code: "R110", name: "R110", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "OTHER", name: "O", ownerUserId: alice.id });
const P = proj.id;
const byCode = async (code) => (await reg.listAssumptions(db, { projectId: P })).find((a) => a.code === code);

// ── the assumption register ──────────────────────────────────────────────

test("the master plan's baseline enters as proposed, once", async () => {
  await withProject(db, P, async () => {
    equal((await reg.addBaseline(db, { projectId: P, userId: alice.id })).added, 5);
    equal((await reg.addBaseline(db, { projectId: P, userId: alice.id })).added, 0, "safe to run twice");
    const list = await reg.listAssumptions(db, { projectId: P });
    equal(list.map((a) => a.code), ["A-001", "A-002", "A-003", "A-004", "A-005"]);
    assert(list.every((a) => a.status === "proposed"), "a plan's baseline is not a verified fact");
    assert(/استنتاج/.test(list[1].description), "the capacity says what must not be inferred from it");
  });
});

test("a new assumption takes the next code", async () => {
  await withProject(db, P, async () => {
    const a = await reg.proposeAssumption(db, { projectId: P, category: "ذخیره",
      description: "Ethylene storage is refrigerated at atmospheric pressure.", impact: "high", userId: alice.id });
    equal([a.code, a.status, a.revision], ["A-006", "proposed", 0]);
    await throws(() => reg.proposeAssumption(db, { projectId: P, category: "x" }), "INVALID_INPUT");
  });
});

test("a decision is signed, and rejecting needs a reason", async () => {
  await withProject(db, P, async () => {
    const a = await byCode("A-006");
    await throws(() => reg.decideAssumption(db, { projectId: P, assumptionId: a.id, status: "approved" }),
      "INVALID_INPUT", "no decider, no decision");
    await throws(() => reg.decideAssumption(db, { projectId: P, assumptionId: a.id, status: "rejected",
      userId: alice.id }), "INVALID_INPUT");
    const ok = await reg.decideAssumption(db, { projectId: P, assumptionId: a.id, status: "approved", userId: alice.id });
    equal([ok.status, ok.decided_by, ok.revision], ["approved", alice.id, 1]);
    await throws(() => db.query("UPDATE project_assumption SET decided_by = NULL WHERE id = $1", [a.id]),
      "assumption_decision_signed");
  });
});

test("changing an approved assumption sends it back for review, and keeps the old one", async () => {
  await withProject(db, P, async () => {
    const a = await byCode("A-006");
    await throws(() => reg.reviseAssumption(db, { projectId: P, assumptionId: a.id,
      patch: { value: "semi-refrigerated" } }), "INVALID_INPUT", "never silently");
    const r = await reg.reviseAssumption(db, { projectId: P, assumptionId: a.id,
      patch: { description: "Ethylene storage is semi-refrigerated.", value: "semi-ref" },
      reason: "Process datasheet Rev.1", userId: alice.id });
    equal([r.status, r.decided_by, r.revision], ["under_review", null, 2]);
    const h = await reg.assumptionHistory(db, { projectId: P, assumptionId: a.id });
    equal(h.map((x) => [x.revision, x.snapshot.status]), [[0, "proposed"], [1, "approved"]]);
    assert(/atmospheric/.test(h[1].snapshot.description), "the approved text is kept as it was");
    equal(h[1].reason, "Process datasheet Rev.1");
  });
});

test("an unchanged revision is not a revision", async () => {
  await withProject(db, P, async () => {
    const a = await byCode("A-006");
    const r = await reg.reviseAssumption(db, { projectId: P, assumptionId: a.id,
      patch: { value: a.value }, reason: "none", userId: alice.id });
    equal(r.revision, a.revision);
  });
});

test("history is append-only for the application", async () => {
  await withProject(db, P, async () => {
    await throws(() => db.query("UPDATE project_assumption_revision SET reason = 'x'"), "permission denied");
    await throws(() => db.query("DELETE FROM project_assumption_revision"), "permission denied");
  });
});

// ── missing information ──────────────────────────────────────────────────

const keys = async () => (await reg.missingInformation(db, { projectId: P })).map((m) => `${m.key}:${m.count}`);

test("nothing recorded, nothing missing", async () => {
  await withProject(db, P, async () => {
    equal(await keys(), []);
  });
});

test("an unknown circuit voltage is listed with what it blocks, and leaves when stated", async () => {
  await withProject(db, P, async () => {
    await spine.upsertTag(db, { projectId: P, tagNo: "P-101", discipline: "equipment", kind: "rotating" });
    await elec.importCableSchedule(db, { projectId: P, text:
      "Cable No,From,To,Cable Type,Voltage\nC-1,MCC,P-101,3Cx35,0.6/1kV\nC-2,MCC,JB-9,3Cx35,0.6/1kV\nC-3,SWGR,P-101,3x1x240,6/10kV" });
    const m = await reg.missingInformation(db, { projectId: P });
    const lv = m.find((x) => x.key === "lv");
    equal([lv.count, lv.impact, lv.discipline], [2, "high", "برق"]);
    assert(m.find((x) => x.key === "mv").count === 1);
    equal(m.find((x) => x.key === "cable-tag").count, 1, "JB-9 is not a tag");
    await projects.updateProjectProfile(db, { projectId: P, patch: { lv_system_voltage_v: 400 } });
    assert(!(await keys()).some((k) => k.startsWith("lv:")));
  });
});

test("a cable whose schedule states its own circuit voltage is not waiting on the project's", async () => {
  await withProject(db, P, async () => {
    await projects.updateProjectProfile(db, { projectId: P, patch: { lv_system_voltage_v: null } });
    const c = (await db.query("SELECT id FROM cable WHERE cable_no = 'C-2'")).rows[0].id;
    await elec.correctCable(db, { projectId: P, cableId: c, systemVoltageV: 690 });
    equal((await reg.missingInformation(db, { projectId: P })).find((x) => x.key === "lv").count, 1);
  });
});

test("structures, instruments and equipment report their own gaps", async () => {
  await withProject(db, P, async () => {
    await steel.upsertStructure(db, { projectId: P, tagNo: "PR-1", structureType: "pipe_rack" });
    await inst.importInstrumentIndex(db, { projectId: P, text: "Tag No,Range\nPT-101,\nPT-A1,0-10 bar" });
    await spine.upsertTag(db, { projectId: P, tagNo: "PK-9", discipline: "equipment" });
    const k = await keys();
    for (const want of ["erection:1", "steel-counts:1", "inst-tag:1", "inst-range:1", "tolerance:1", "eq-kind:1"]) {
      assert(k.includes(want), `${want} in ${k.join(", ")}`);
    }
    const m = await reg.missingInformation(db, { projectId: P });
    const rank = { high: 0, medium: 1, low: 2 };
    assert(m.every((x, i) => i === 0 || rank[m[i - 1].impact] <= rank[x.impact]),
      `what withholds a verdict comes first: ${m.map((x) => x.impact).join(", ")}`);
  });
});

test("R3: a current revision whose every extraction attempt failed has no register, and is reported so", async () => {
  await withProject(db, P, async () => {
    // Not yet extracted at all: an expected state, not R3.
    await docsRepo.registerDocument(db, { projectId: P, docNo: "ISO-R3-A", revision: "0", revisionDate: "2026-01-01",
      fileSha256: "1".repeat(64), storageUri: "local://r3a" });
    equal((await keys()).some((k) => k.startsWith("register-missing:")), false);

    // The only revision's only extraction failed.
    const { document: b } = await docsRepo.registerDocument(db, { projectId: P, docNo: "ISO-R3-B", revision: "0", revisionDate: "2026-01-01",
      fileSha256: "2".repeat(64), storageUri: "local://r3b" });
    await runs.createRun(db, { projectId: P, documentId: b.id, payload: {}, engineError: "geometry does not close" });
    let m = await reg.missingInformation(db, { projectId: P });
    let r3 = m.find((x) => x.key === "register-missing");
    equal([r3.count, r3.impact, r3.discipline], [1, "medium", "پایپینگ"]);

    // A drawing WITH a valid register is not counted, even with a later failed run on it.
    const { document: c0 } = await docsRepo.registerDocument(db, { projectId: P, docNo: "ISO-R3-C", revision: "0", revisionDate: "2026-01-01",
      fileSha256: "3".repeat(64), storageUri: "local://r3c0" });
    await runs.createRun(db, { projectId: P, documentId: c0.id, payload: {} });
    await runs.createRun(db, { projectId: P, documentId: c0.id, payload: {}, engineError: "transient" });
    equal((await reg.missingInformation(db, { projectId: P })).find((x) => x.key === "register-missing").count, 1, "still just ISO-R3-B");

    // A NEW revision supersedes it, and only that new revision's extraction fails: R3 now fires on the current one.
    const { document: c1 } = await docsRepo.registerDocument(db, { projectId: P, docNo: "ISO-R3-C", revision: "1", revisionDate: "2026-02-01",
      fileSha256: "4".repeat(64), storageUri: "local://r3c1" });
    await docsRepo.supersedePrevious(db, { projectId: P, documentId: c1.id });
    await runs.createRun(db, { projectId: P, documentId: c1.id, payload: {}, engineError: "geometry does not close" });
    m = await reg.missingInformation(db, { projectId: P });
    r3 = m.find((x) => x.key === "register-missing");
    equal(r3.count, 2, "ISO-R3-B, and now ISO-R3-C's current revision");
  });
});

test("registers belong to one project", async () => {
  await withProject(db, other.id, async () => {
    equal((await reg.listAssumptions(db, { projectId: other.id })).length, 0);
    equal((await reg.missingInformation(db, { projectId: other.id })).length, 0);
  });
});

await run();
