#!/usr/bin/env node
/**
 * One asset, every discipline: the thread of a tag, joined by id, and a
 * readiness that scores only what every asset must have.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "asset-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const civil = await import("../../lib/db/repos/civil.mjs");
const elec = await import("../../lib/db/repos/electrical.mjs");
const inst = await import("../../lib/db/repos/instrumentation.mjs");
const coat = await import("../../lib/db/repos/coating.mjs");
const { assetThread } = await import("../../lib/db/repos/asset.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "T110", name: "T110", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "OTHER", name: "O", ownerUserId: alice.id });
const P = proj.id;
let pump;

await withProject(db, P, async () => {
  const sub = await spine.upsertSubsystem(db, { projectId: P, code: "12-01" });
  pump = await spine.upsertTag(db, { projectId: P, tagNo: "P-1203A", discipline: "equipment", kind: "rotating",
    subsystemId: sub.id, description: "Quench oil pump" });
  await spine.upsertTag(db, { projectId: P, tagNo: "V-9", discipline: "equipment" });
  await civil.upsertFoundation(db, { projectId: P, tagNo: "FDN-P-1203A", carriesTagId: pump.id,
    concreteClass: "C30", fcMpa: 30 });
  await db.query("INSERT INTO line (project_id, line_no, tag_id) VALUES ($1, '6-QO-1203', $2)", [P, pump.id]);
  await elec.importCableSchedule(db, { projectId: P, text: "Cable No,From,To,Cable Type,Voltage\nEC-1,MCC,P-1203A,3Cx35,0.6/1kV" });
  await inst.importInstrumentIndex(db, { projectId: P, text: "Tag No,Range,Equipment\nPT-1203A,0-25 bar,P-1203A" });
  const sys = await coat.upsertSystem(db, { projectId: P, code: "PS-1", prepGrade: "Sa 2½", coats: [{ name: "p", ndftUm: 75 }] });
  await coat.assignCoating(db, { projectId: P, systemId: sys.id, tagIds: [pump.id], areaM2: 6 });
});

test("a tag's thread carries every discipline, joined by id", async () => {
  await withProject(db, P, async () => {
    const t = await assetThread(db, { projectId: P, tagNo: "p-1203a" });
    equal(t.tag.tag_no, "P-1203A", "found whatever case it was typed in");
    equal([t.foundations.length, t.lines.length, t.cables.length, t.instruments.length], [1, 1, 1, 1]);
    equal(t.coating.system, "PS-1");
    equal(t.foundations[0].tag_no, "FDN-P-1203A");
    equal(t.instruments[0].loopNo, "P-1203A");
    equal(t.readiness.linked, 5);
  });
});

test("the machine's own chain answers from the same links", async () => {
  await withProject(db, P, async () => {
    const t = await assetThread(db, { projectId: P, tagId: pump.id });
    const step = (c) => t.status.steps.find((x) => x.code === c);
    assert(step("foundation").derived && step("electrical").derived && step("instrument").derived,
      "foundation, electrical and instrument all read from the linked items");
  });
});

test("readiness scores identity; an absent link is 'none recorded', not a failure", async () => {
  await withProject(db, P, async () => {
    const v = await assetThread(db, { projectId: P, tagNo: "V-9" });
    equal(v.readiness.identity.map((c) => c.ok), [false, false, false], "not filed, not classified, not described");
    equal(v.readiness.identityPct, 0);
    equal(v.readiness.linked, 0);
    assert(v.readiness.links.every((l) => l.count === 0));
    const p = await assetThread(db, { projectId: P, tagNo: "P-1203A" });
    equal(p.readiness.identityPct, 100);
  });
});

test("what the platform does not hold yet is named, not shown as complete", async () => {
  await withProject(db, P, async () => {
    const t = await assetThread(db, { projectId: P, tagNo: "P-1203A" });
    equal(t.notHeld.map((n) => n.key), ["vendor", "cmms", "inst_asset"], "procurement and DCS/Historian tags are held now (046)");
    equal(t.purchase, [], "and a tag nobody has ordered shows no purchase, not a missing module");
    equal(t.master, null, "no asset master set yet");
    equal(t.dcsPoints, []);
  });
});

test("design conditions and DCS/Historian points ride along the thread once set", async () => {
  await withProject(db, P, async () => {
    const hov = await import("../../lib/db/repos/handover.mjs");
    const doc = await import("../../lib/db/repos/doc-control.mjs");
    const d = await doc.upsertMdr(db, { projectId: P, docNo: "DS-P-1203A", title: "Pump datasheet", tagId: pump.id });
    const r = await doc.issueRevision(db, { projectId: P, mdrId: d.id, revision: "0", purpose: "IFC", issuedOn: "2026-01-01" });
    await hov.setAssetMaster(db, { projectId: P, tagId: pump.id, designPressureBarg: 12.5, designTempMinC: -20, designTempMaxC: 150,
      datasheetRevisionId: r.id, userId: alice.id });
    await hov.addDcsPoint(db, { projectId: P, tagId: pump.id, label: "Discharge pressure", dcsTag: "P-1203A_PI.PV", uom: "barg", userId: alice.id });
    const t = await assetThread(db, { projectId: P, tagNo: "P-1203A" });
    equal([t.master.design_pressure_barg, t.master.datasheet_doc_no, t.master.datasheet_revision], ["12.5", "DS-P-1203A", "0"]);
    equal(t.dcsPoints.map((p) => p.label), ["Discharge pressure"]);
  });
});

test("another project's tag is not found", async () => {
  await withProject(db, other.id, async () => {
    await throws(() => assetThread(db, { projectId: other.id, tagNo: "P-1203A" }), "tag not found");
  });
});

await run();
