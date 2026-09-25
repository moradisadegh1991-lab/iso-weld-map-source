#!/usr/bin/env node
/**
 * Handover to maintenance: no class guessed, no criticality outside the
 * project's levels, no functional location without the project's template,
 * and a tag ready only when every item is known and true.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  flocFor, flocParent, criticalityLevels, masterProblems, handoverChecklist, toCsv,
} from "../../lib/cmms/handover.mjs";

// ── the engine ───────────────────────────────────────────────────────────

const CTX = { plant: "OLF", unit: "12", system: "12", subsystem: "12-01", tag: "P-1203A" };

test("the functional location is built from the project's template, and not without it", async () => {
  equal(flocFor("{plant}-{unit}-{subsystem}-{tag}", CTX).code, "OLF-12-12-01-P-1203A");
  equal(flocFor("", CTX).code, null);
  assert(/نشانهٔ ناشناخته/.test(flocFor("{plant}-{area}-{tag}", CTX).reason));
  assert(/\{tag\}/.test(flocFor("{plant}-{unit}", CTX).reason), "a template without the tag gives every tag one place");
  const miss = flocFor("{plant}-{unit}-{tag}", { ...CTX, plant: null });
  equal(miss.code, null);
  assert(/plant/.test(miss.reason));
  equal(flocParent("{plant}-{unit}-{subsystem}-{tag}", CTX), "OLF-12-12-01");
  equal(flocParent("{plant}-{unit}-{tag}", { ...CTX, unit: "" }), null, "no location, no parent");
});

test("criticality only from the project's own levels, with its basis", async () => {
  equal(criticalityLevels("A, B،C  C"), ["A", "B", "C"]);
  equal(criticalityLevels(null), []);
  equal(masterProblems({ criticality: "A", criticalityBasis: "RBI-12" }, ["A", "B", "C"]), []);
  const none = masterProblems({ criticality: "A", criticalityBasis: "RBI-12" }, []);
  equal(none.length, 1, "no levels stated, no ranking");
  assert(/تعیین نشده/.test(none[0]), "and it says the policy is missing, not that A is wrong");
  equal(masterProblems({ criticality: "D", criticalityBasis: "x" }, ["A", "B", "C"]).length, 1);
  equal(masterProblems({ criticality: "A" }, ["A"]).length, 1, "a rank needs its basis");
  equal(masterProblems({ isoClass: "Pump" }, []).length, 1);
  equal(masterProblems({ yearBuilt: 1850 }, []).length, 1);
});

test("ready only when every item is known and true — unknown holds as firmly as missing", async () => {
  const full = { isoClass: "PU", criticality: "A", manufacturer: "X", model: "Y", serialNo: "Z" };
  const floc = { code: "OLF-P-1" };
  equal(handoverChecklist({ master: full, floc, mcAccepted: true, iom: "accepted" }).ready, true);
  const unknownMc = handoverChecklist({ master: full, floc, mcAccepted: null, iom: "accepted" });
  equal([unknownMc.open, unknownMc.ready], [["mc"], false], "unknown is not ready");
  equal(handoverChecklist({ master: full, floc, mcAccepted: true, iom: null }).open, ["iom"], "no PO in the platform: no manual to check");
  equal(handoverChecklist({ master: { ...full, serialNo: " " }, floc, mcAccepted: true, iom: "resubmit" }).open, ["serial", "iom"]);
  equal(handoverChecklist({ master: full, floc: { code: null, reason: "x" }, mcAccepted: true, iom: "accepted" }).open, ["floc"]);
});

test("CSV: quoted, BOM for Excel, and a quote inside a field survives", async () => {
  const csv = toCsv([["a", "A"], ["b", "B"]], [{ a: 'PIPE 10" SCH40', b: "x,y" }]);
  assert(csv.startsWith("﻿"));
  equal(csv.slice(1).split("\r\n")[1], '"PIPE 10"" SCH40","x,y"');
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "hov-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const prc = await import("../../lib/db/repos/procurement.mjs");
const hov = await import("../../lib/db/repos/handover.mjs");
const { missingInformation } = await import("../../lib/db/repos/assumptions.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const bob = await projects.ensureUser(db, { subject: "kc|bob" });
const proj = await projects.createProject(db, { code: "HOV", name: "H", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "HOV2", name: "O", ownerUserId: alice.id });
const P = proj.id;
const TODAY = new Date().toISOString().slice(0, 10);
let sub, pump, fdn, iom;

await withProject(db, P, async () => {
  const { rows: [unit] } = await db.query("INSERT INTO unit (project_id, code, name) VALUES ($1,'12','Quench') RETURNING id", [P]);
  sub = await spine.upsertSubsystem(db, { projectId: P, code: "12-01", systemCode: "12", unitId: unit.id });
  pump = await spine.upsertTag(db, { projectId: P, tagNo: "P-1203A", discipline: "equipment", kind: "rotating", subsystemId: sub.id,
    description: "Quench oil pump" });
  fdn = await spine.upsertTag(db, { projectId: P, tagNo: "FDN-P-1203A", discipline: "civil", kind: "foundation", subsystemId: sub.id });
  const v = await prc.upsertVendor(db, { projectId: P, code: "V1", name: "Pump Works" });
  const po = await prc.createPo(db, { projectId: P, poNo: "PO-1", vendorId: v.id, title: "Pumps", placedOn: TODAY });
  await prc.addPoLine(db, { projectId: P, poId: po.id, tagId: pump.id, qty: 1 });
  iom = await prc.addVendorDoc(db, { projectId: P, poId: po.id, docCode: "IOM", title: "O&M manual" });
});

test("nothing is guessed: no class, no criticality, no location until they are given", async () => {
  await withProject(db, P, async () => {
    const b = await hov.handoverBoard(db, { projectId: P });
    equal(b.tags.map((t) => t.tagNo), ["P-1203A"], "only equipment is handed over as an asset");
    const t = b.tags[0];
    equal([t.master.isoClass, t.floc.code, t.mcAccepted, t.iom, t.vendorHint], [null, null, false, "pending", "Pump Works"]);
    equal(t.open, ["class", "criticality", "floc", "manufacturer", "model", "serial", "mc", "iom"]);
    const miss = (await missingInformation(db, { projectId: P })).map((m) => m.key);
    assert(miss.includes("cmms-floc") && miss.includes("cmms-criticality"), miss.join(","));
  });
});

test("the asset master refuses a rank outside the policy, and keeps every change", async () => {
  await withProject(db, P, async () => {
    await throws(() => hov.setAssetMaster(db, { projectId: P, tagId: pump.id, isoClass: "PU", criticality: "A", criticalityBasis: "RBI" }),
      "INVALID_INPUT", "no levels stated yet");
    await projects.updateProjectProfile(db, { projectId: P, patch: { criticality_levels: "A, B, C", cmms_plant_code: "OLF",
      floc_template: "{plant}-{unit}-{subsystem}-{tag}" } });
    await throws(() => hov.setAssetMaster(db, { projectId: P, tagId: pump.id, criticality: "1", criticalityBasis: "x" }), "INVALID_INPUT");
    await throws(() => hov.setAssetMaster(db, { projectId: P, tagId: fdn.id, isoClass: "PU" }), "INVALID_INPUT", "a foundation is not a CMMS asset here");
    await hov.setAssetMaster(db, { projectId: P, tagId: pump.id, isoClass: "pu", criticality: "A", criticalityBasis: "RBI-2026-014",
      manufacturer: "Pump Works", model: "OH2 6x4-13", serialNo: "SN-1182", userId: alice.id });
    await hov.setAssetMaster(db, { projectId: P, tagId: pump.id, isoClass: "PU", criticality: "A", criticalityBasis: "RBI-2026-014",
      manufacturer: "Pump Works", model: "OH2 6x4-13", serialNo: "SN-1183", userId: bob.id });
    const h = await hov.assetMasterHistory(db, { projectId: P, tagId: pump.id });
    equal(h.map((r) => r.snapshot.serialNo), ["SN-1182", "SN-1183"], "the corrected serial and the one before it");
    await throws(() => db.query("UPDATE asset_master_revision SET snapshot = '{}'"), "permission denied");
    const t = (await hov.handoverBoard(db, { projectId: P })).tags[0];
    equal([t.floc.code, t.master.isoClass, t.classLabel, t.open], ["OLF-12-12-01-P-1203A", "PU", "Pumps", ["mc", "iom"]]);
  });
});

test("ready when MC is accepted and the manual is approved; the export says so and is logged", async () => {
  await withProject(db, P, async () => {
    await db.query("INSERT INTO mc_certificate (project_id, subsystem_id, snapshot, signed_by, accepted_by, accepted_at) VALUES ($1,$2,'{}',$3,$4, now())",
      [P, sub.id, alice.id, bob.id]);
    await prc.submitDoc(db, { projectId: P, docId: iom.id, revision: "0", submittedOn: TODAY });
    let t = (await hov.handoverBoard(db, { projectId: P })).tags[0];
    equal([t.iom, t.ready], ["under_review", false]);
    await prc.returnDoc(db, { projectId: P, docId: iom.id, returnedOn: TODAY, code: 1 });
    t = (await hov.handoverBoard(db, { projectId: P })).tags[0];
    equal([t.iom, t.ready], ["accepted", true]);
    const e = await hov.exportHandover(db, { projectId: P, userId: alice.id });
    const [head, row] = e.csv.slice(1).split("\r\n");
    assert(head.startsWith('"Functional Location","Parent (system)","Tag"'));
    assert(row.startsWith('"OLF-12-12-01-P-1203A","OLF-12-12-01","P-1203A"'), row);
    assert(row.includes('"yes"'));
    equal([e.rows, e.ready, e.sha256.length], [1, 1, 64]);
    equal((await hov.exportLog(db, { projectId: P }))[0].sha256, e.sha256);
  });
});

test("handover belongs to one project", async () => {
  await withProject(db, other.id, async () => {
    equal((await hov.handoverBoard(db, { projectId: other.id })).tags.length, 0);
  });
});

await run();
