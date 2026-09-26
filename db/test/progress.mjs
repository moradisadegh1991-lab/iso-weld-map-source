#!/usr/bin/env node
/**
 * Earned value from what the platform knows: F-16 (a rejected weld is not
 * "tested"), civil / structural / coating counted by the same engine their
 * pages use, and the monthly snapshot that keeps EV and progress history.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";
import { milestones, countItems, ENGINE_DISCIPLINES } from "../../lib/controls/progress.mjs";
import { minReadings } from "../../lib/coating/coating.mjs";

// ── the rules ────────────────────────────────────────────────────────────

test("an item handed over counts as installed; not-applicable counts as done", async () => {
  const spec = ENGINE_DISCIPLINES.civil;
  equal(milestones([{ code: "pour", status: "done" }, { code: "ready", status: null }], spec), { installed: true, tested: false });
  equal(milestones([{ code: "pour", status: "in_progress" }], spec), { installed: false, tested: false });
  equal(milestones([{ code: "pour", status: null }, { code: "ready", status: "done" }], spec), { installed: true, tested: true });
  equal(milestones([{ code: "erection", status: null, na: true }], ENGINE_DISCIPLINES.structural), { installed: true, tested: false });
  equal(countItems([{ installed: true, tested: true }, { installed: true, tested: false }, { installed: false, tested: false }]),
    { items: 3, installed: 2, tested: 1 });
});

// ── against the database ─────────────────────────────────────────────────

process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "prog-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const exec = await import("../../lib/db/repos/execution.mjs");
const ctl = await import("../../lib/db/repos/controls.mjs");
const prog = await import("../../lib/db/repos/progress.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const civil = await import("../../lib/db/repos/civil.mjs");
const steel = await import("../../lib/db/repos/structural.mjs");
const coat = await import("../../lib/db/repos/coating.mjs");
const acts = await import("../../lib/db/repos/activities.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "PRG", name: "P", ownerUserId: alice.id });
const P = proj.id;
const inP = (fn) => withProject(db, P, fn);
const TODAY = new Date().toISOString().slice(0, 10);
const shift = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const tick = (tagId, code) => acts.recordActivity(db, { projectId: P, tagId, code, doneAt: shift(-30), userId: alice.id });
let welds;

await inP(async () => {
  const { rows: [line] } = await db.query("INSERT INTO line (project_id, line_no) VALUES ($1,'10-P-1') RETURNING id", [P]);
  const { rows: [doc] } = await db.query(
    `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'ISO-1','0',$2,'local://x') RETURNING id`,
    [P, "c".repeat(64)]);
  const r = await runs.createRun(db, { projectId: P, documentId: doc.id, lineId: line.id, payload: DEMO });
  await runs.saveRegister(db, { projectId: P, runId: r.id, documentId: doc.id, lineId: line.id, model: buildModel(DEMO, {}) });
  welds = (await db.query("SELECT weld_uid FROM weld WHERE project_id = $1 ORDER BY weld_no", [P])).rows.map((w) => w.weld_uid);
});

test("F-16: a weld whose latest shot was rejected is not tested — progress and EV say so", async () => {
  await inP(async () => {
    for (const uid of welds.slice(0, 3)) {
      await db.query("INSERT INTO weld_execution (project_id, weld_uid, welded_at) VALUES ($1,$2,$3)", [P, uid, TODAY]);
    }
    await exec.recordNdt(db, { projectId: P, weldUid: welds[0], method: "RT", result: "accept", inspectedAt: TODAY });
    await exec.recordNdt(db, { projectId: P, weldUid: welds[1], method: "RT", result: "reject", inspectedAt: TODAY });
    await exec.recordNdt(db, { projectId: P, weldUid: welds[2], method: "RT", result: "pending", inspectedAt: TODAY });
    const c = await ctl.platformCounts(db, { projectId: P, discipline: "piping" });
    equal([c.installed, c.tested], [3, 1], "one accepted; the rejected and the pending film are not tested");
    await exec.recordNdt(db, { projectId: P, weldUid: welds[1], method: "RT", result: "accept", inspectedAt: TODAY });
    equal((await ctl.platformCounts(db, { projectId: P, discipline: "piping" })).tested, 2, "the repair's re-shot passed");
  });
});

let sub, fdn1, fdn2, deck, rack, item;
test("civil: a foundation is installed when its pour is recorded — counted by the civil engine", async () => {
  await inP(async () => {
    sub = await spine.upsertSubsystem(db, { projectId: P, code: "21-01" });
    fdn1 = await civil.upsertFoundation(db, { projectId: P, tagNo: "FDN-1", subsystemId: sub.id, concreteClass: "C30", fcMpa: 30 });
    fdn2 = await civil.upsertFoundation(db, { projectId: P, tagNo: "FDN-2", concreteClass: "C30", fcMpa: 30 });
    equal(await prog.progressCounts(db, { projectId: P, discipline: "civil" }), { items: 2, installed: 0, tested: 0 });
    await civil.recordPour(db, { projectId: P, tagId: fdn1.id, pourNo: "PC-1", pouredOn: shift(-20), concreteClass: "C30", fcMpa: 30 });
    equal(await prog.progressCounts(db, { projectId: P, discipline: "civil" }), { items: 2, installed: 1, tested: 0 },
      "poured, not handed over: strength and backfill are still open");
    equal(await prog.progressCounts(db, { projectId: P, discipline: "civil", subsystemId: sub.id }), { items: 1, installed: 1, tested: 0 });
    await throws(() => prog.progressCounts(db, { projectId: P, discipline: "equipment" }), "INVALID_INPUT");
  });
});

test("structural: a structure is installed when it is erected", async () => {
  await inP(async () => {
    deck = await steel.upsertStructure(db, { projectId: P, tagNo: "PL-1", structureType: "platform", columns: 2, boltedJoints: 4, fireproofingRequired: false });
    rack = await steel.upsertStructure(db, { projectId: P, tagNo: "PR-1", structureType: "platform", columns: 2, boltedJoints: 4, fireproofingRequired: false });
    await tick(deck.id, "foundation");
    equal((await prog.progressCounts(db, { projectId: P, discipline: "structural" })).installed, 0, "a foundation under it is not erection");
    await tick(deck.id, "erection");
    equal(await prog.progressCounts(db, { projectId: P, discipline: "structural" }), { items: 2, installed: 1, tested: 0 });
  });
});

test("coating: an item is installed when every coat's DFT is accepted — not when a coat is merely recorded", async () => {
  await inP(async () => {
    const sys = await coat.upsertSystem(db, { projectId: P, code: "PS-1", title: "Epoxy", prepGrade: "Sa 2½",
      profileMinUm: 50, profileMaxUm: 85, maxDftUm: 500, coats: [{ name: "Epoxy", ndftUm: 100 }] });
    await coat.assignCoating(db, { projectId: P, systemId: sys.id, tagIds: [rack.id], areaM2: 1 });
    item = (await db.query("SELECT id FROM coating_item WHERE project_id = $1 AND tag_id = $2", [P, rack.id])).rows[0].id;
    const n = minReadings(1);
    const readings = (v) => Array.from({ length: n }, () => v).join(" ");
    await coat.recordCoating(db, { projectId: P, itemId: item, kind: "prep", recordedOn: shift(-10), grade: "Sa 2½", profile: "60 65 70" });
    await coat.recordCoating(db, { projectId: P, itemId: item, kind: "coat", coatNo: 1, recordedOn: shift(-9),
      airC: 30, rh: 60, steelC: 32, readings: readings(40) });
    equal(await prog.progressCounts(db, { projectId: P, discipline: "coating" }), { items: 1, installed: 0, tested: 0 },
      "a coat under its DFT is recorded, not accepted");
    await coat.recordCoating(db, { projectId: P, itemId: item, kind: "coat", coatNo: 1, recordedOn: shift(-8),
      airC: 30, rh: 60, steelC: 32, readings: readings(110) });
    equal(await prog.progressCounts(db, { projectId: P, discipline: "coating" }), { items: 1, installed: 1, tested: 0 });
    equal((await prog.progressCounts(db, { projectId: P, discipline: "coating", subsystemId: sub.id })).items, 0,
      "the coated rack is in no subsystem; 21-01 has no coating items");
  });
});

let civ;
test("a civil control account earns value from the foundation count", async () => {
  await inP(async () => {
    civ = await ctl.upsertAccount(db, { projectId: P, code: "CW-CIV", title: "Foundations",
      evMethod: "platform", evDiscipline: "civil", creditInstalledPct: 60 });
    await ctl.setBaseline(db, { projectId: P, accountId: civ.id, revision: "A", reason: "IFC",
      points: [{ date: shift(-100), pct: 0 }, { date: shift(100), pct: 100 }] });
    const a = (await ctl.controlsBoard(db, { projectId: P })).accounts.find((x) => x.code === "CW-CIV");
    equal(a.ev.detail, { items: 2, installed: 1, tested: 0 });
    equal(a.ev.pct, 30, "one of two foundations poured × 60% credit for installed");
  });
});

test("the snapshot records today's figures once, and never changes them", async () => {
  await inP(async () => {
    const r = await ctl.takeSnapshot(db, { projectId: P, userId: alice.id });
    equal(r.asOf, TODAY);
    const { rows: [e] } = await db.query("SELECT ev_pct, pv_pct, ev_method, ev_detail FROM ev_snapshot WHERE account_id = $1", [civ.id]);
    equal([Number(e.ev_pct), e.ev_method, e.ev_detail.discipline, e.ev_detail.installed], [30, "platform", "civil", 1]);
    const { rows: pr } = await db.query(
      "SELECT discipline, subsystem_id, items, installed, tested FROM progress_snapshot WHERE project_id = $1 ORDER BY discipline, subsystem_id NULLS LAST", [P]);
    const civRows = pr.filter((x) => x.discipline === "civil");
    equal(civRows.map((x) => [x.subsystem_id, x.items, x.installed]), [[sub.id, 1, 1], [null, 1, 0]], "civil by subsystem");
    for (const d of ["piping", "structural", "coating"]) assert(pr.some((x) => x.discipline === d), `${d} is in the snapshot`);
    await throws(() => ctl.takeSnapshot(db, { projectId: P }), "SNAPSHOT_EXISTS");
    await throws(() => db.query("UPDATE ev_snapshot SET ev_pct = 99"), "permission denied");
    await throws(() => db.query("DELETE FROM progress_snapshot"), "permission denied");
  });
});

test("a past data date reads the snapshot on or before it, never today's count", async () => {
  await inP(async () => {
    // Last month's snapshot, as the monthly run would have left it.
    await db.query(`INSERT INTO ev_snapshot (project_id, account_id, as_of, pv_pct, ev_pct, ev_method, ev_detail)
      VALUES ($1,$2,$3,40,12.5,'platform','{"items":2,"installed":0,"tested":0}')`, [P, civ.id, shift(-30)]);
    let a = (await ctl.controlsBoard(db, { projectId: P, asOf: shift(-10) })).accounts.find((x) => x.code === "CW-CIV");
    equal([a.ev.pct, a.ev.source, a.ev.detail.snapshotOn], [12.5, "snapshot", shift(-30)]);
    a = (await ctl.controlsBoard(db, { projectId: P, asOf: shift(-60) })).accounts.find((x) => x.code === "CW-CIV");
    equal(a.ev.pct, null);
    assert(/اسنپ‌شات/.test(a.ev.reason), "no snapshot yet: says so rather than guessing");
    a = (await ctl.controlsBoard(db, { projectId: P })).accounts.find((x) => x.code === "CW-CIV");
    equal([a.ev.pct, a.ev.source], [30, "platform"], "today stays the live count");
    const h = await ctl.snapshotHistory(db, { projectId: P });
    equal(h.dates, [TODAY, shift(-30)]);
    equal(h.ev.filter((x) => x.code === "CW-CIV").map((x) => [x.asOf, x.evPct]), [[shift(-30), 12.5], [TODAY, 30]]);
    assert(h.progress.some((x) => x.discipline === "civil" && x.asOf === TODAY && x.installed === 1));
  });
});

test("snapshots belong to one project", async () => {
  const other = await projects.createProject(db, { code: "OTH", name: "O", ownerUserId: alice.id });
  await withProject(db, other.id, async () => {
    equal((await db.query("SELECT count(*)::int AS n FROM ev_snapshot")).rows[0].n, 0);
    await throws(() => db.query(`INSERT INTO progress_snapshot (project_id, as_of, discipline, items, installed, tested)
      VALUES ($1,$2,'civil',1,1,1)`, [P, TODAY]), "row-level security");
  });
});

await run();
