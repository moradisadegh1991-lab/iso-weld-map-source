#!/usr/bin/env node
/**
 * NDT compliance — the examination each weld REQUIRES, B31.3 §341 — and what
 * piping progress counts as tested (F-17).
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";
import { parseRequirement, ownResult, compliance, inchDia } from "../../lib/ndt/compliance.mjs";

// ── the rules ────────────────────────────────────────────────────────────

const W = (uid, o = {}) => ({ uid, lineId: "L", welded: true, welderId: "A", requirement: "RT 10% random", ...o });
const R = (uid, result, at, o = {}) => ({ uid, method: "RT", result, repairCycle: 0, at, ...o });
const sel = (uids) => [{ lineId: "L", method: "RT", selectedUids: uids, createdAt: "2026-09-01" }];
const st = (res, uid) => res.get(uid).status;

test("the stored requirement is read, or it is unknown", async () => {
  equal(parseRequirement("RT 10% random"), { method: "RT", percent: 10, random: true });
  equal(parseRequirement("PT 100%"), { method: "PT", percent: 100, random: false });
  equal(parseRequirement("تعیین‌نشده"), null);
  equal(parseRequirement(null), null);
});

test("a weld's own result is its latest cycle", async () => {
  const recs = [R("w", "reject", "1"), R("w", "accept", "2", { repairCycle: 1 })];
  equal(ownResult(recs, "w", "RT"), "accept");
  equal(ownResult([R("w", "pending", "1")], "w", "RT"), "pending");
  equal(ownResult([], "w", "RT"), "none");
});

test("100%: every weld its own; not welded and unknown requirement are said so", async () => {
  const welds = [W("a", { requirement: "RT 100%" }), W("b", { requirement: "RT 100%" }), W("c", { welded: false, requirement: "RT 100%" }),
    W("d", { requirement: "تعیین‌نشده" })];
  const res = compliance({ welds, selections: [], records: [R("a", "accept", "1"), R("b", "reject", "1")] });
  equal(["a", "b", "c", "d"].map((u) => st(res, u)), ["accepted", "rejected", "not_welded", "unknown"]);
});

test("random: no sample drawn is not complete; an unsampled weld waits for its welder's sample, then is accepted by it", async () => {
  const welds = ["s1", "u1", "u2"].map((u) => W(u));
  equal(st(compliance({ welds, selections: [], records: [] }), "u1"), "sample_not_drawn");
  equal(st(compliance({ welds, selections: [], records: [R("u1", "accept", "1")] }), "u1"), "accepted",
    "a weld examined anyway answers for itself, sample or not");
  let res = compliance({ welds, selections: sel(["s1"]), records: [] });
  equal([st(res, "s1"), st(res, "u1")], ["awaiting", "awaiting_sample"]);
  res = compliance({ welds, selections: sel(["s1"]), records: [R("s1", "accept", "1")] });
  equal([st(res, "s1"), st(res, "u1"), st(res, "u2")], ["accepted", "accepted_by_sample", "accepted_by_sample"]);
});

test("random: a welder with no weld in the sample, or a weld with no welder, is not accepted by anyone's sample", async () => {
  const welds = [W("s1"), W("b1", { welderId: "B" }), W("x", { welderId: null })];
  const res = compliance({ welds, selections: sel(["s1"]), records: [R("s1", "accept", "1")] });
  equal([st(res, "b1"), st(res, "x")], ["welder_unsampled", "no_welder"]);
});

const draw = (tier, uids) => ({ lineId: "L", method: "RT", welderId: "A", tier, selectedUids: uids });

test("§341.3.4: a rejected sample waits on a draw of two more per defect; if they pass, the lot is accepted", async () => {
  const welds = ["s1", "u1", "u2", "u3", "u4"].map((u) => W(u));
  let res = compliance({ welds, selections: sel(["s1"]), records: [R("s1", "reject", "1")] });
  equal([st(res, "s1"), st(res, "u1"), res.get("u1").lot.drawNeeded.count], ["rejected", "progressive", 2]);
  equal(res.get("u1").lot.drawNeeded.pool, ["u1", "u2", "u3", "u4"], "drawn from the welder's unsampled welds");
  res = compliance({ welds, selections: sel(["s1"]), records: [R("s1", "reject", "1"), R("u3", "accept", "2"), R("u4", "accept", "3")] });
  equal([st(res, "u1"), st(res, "u3")], ["progressive", "accepted"],
    "welds shot outside a draw answer for themselves but do not release the lot");
  const draws = [draw("a", ["u1", "u2"])];
  res = compliance({ welds, selections: sel(["s1"]), draws, records: [R("s1", "reject", "1"), R("u1", "accept", "2")] });
  equal([st(res, "u1"), st(res, "u4"), res.get("u4").lot.waiting], ["accepted", "progressive", ["u2"]]);
  res = compliance({ welds, selections: sel(["s1"]), draws, records: [R("s1", "reject", "1"), R("u1", "accept", "2"), R("u2", "accept", "3")] });
  equal([st(res, "u3"), st(res, "u4"), st(res, "s1")], ["accepted_by_sample", "accepted_by_sample", "rejected"],
    "the lot is accepted; the defective weld still needs its repair");
});

test("§341.3.4(b)–(d): a defect among the drawn needs two further, drawn from what is left; a defect there means the whole lot", async () => {
  const welds = ["s1", "u1", "u2", "u3", "u4", "u5", "u6"].map((u) => W(u));
  const base = [R("s1", "reject", "1"), R("u1", "reject", "2"), R("u2", "accept", "3")];
  let res = compliance({ welds, selections: sel(["s1"]), draws: [draw("a", ["u1", "u2"])], records: base });
  equal([st(res, "u5"), res.get("u5").lot.tier, res.get("u5").lot.drawNeeded.pool], ["progressive", "b", ["u3", "u4", "u5", "u6"]]);
  const draws = [draw("a", ["u1", "u2"]), draw("b", ["u3", "u4"])];
  res = compliance({ welds, selections: sel(["s1"]), draws, records: [...base, R("u3", "accept", "4"), R("u4", "accept", "5")] });
  equal(st(res, "u5"), "accepted_by_sample", "tier (b) passed");
  res = compliance({ welds, selections: sel(["s1"]), draws, records: [...base, R("u3", "accept", "4"), R("u4", "reject", "5")] });
  equal([st(res, "u5"), st(res, "u6"), st(res, "u3")], ["full_examination", "full_examination", "accepted"],
    "tier (b) failed: every weld of the lot on its own examination");
});

test("a lot too small for two per defect draws what is left", async () => {
  const welds = ["s1", "u1"].map((u) => W(u));
  const res = compliance({ welds, selections: sel(["s1"]), records: [R("s1", "reject", "1")] });
  equal(res.get("u1").lot.drawNeeded.count, 1);
});

test("a new draw for the line replaces the earlier one", async () => {
  const welds = ["s1", "u1", "u2"].map((u) => W(u));
  const selections = [{ lineId: "L", method: "RT", selectedUids: ["u1"], createdAt: "2026-08-01" },
    { lineId: "L", method: "RT", selectedUids: ["s1"], createdAt: "2026-09-01" }];
  equal(st(compliance({ welds, selections, records: [R("s1", "accept", "1")] }), "u2"), "accepted_by_sample");
});

test("the lot is the welder's: another welder's reject does not hold this one", async () => {
  const welds = [W("a1"), W("a2"), W("b1", { welderId: "B" }), W("b2", { welderId: "B" })];
  const res = compliance({ welds, selections: sel(["a1", "b1"]), records: [R("a1", "reject", "1"), R("b1", "accept", "2")] });
  equal([st(res, "a2"), st(res, "b2")], ["progressive", "accepted_by_sample"]);
  const lotA = ["a1", "a2", "a3", "a4"].map((u) => W(u));
  const bDraw = [{ lineId: "L", method: "RT", welderId: "B", tier: "a", selectedUids: ["a2", "a3"] }];
  const r2 = compliance({ welds: lotA, selections: sel(["a1"]), draws: bDraw,
    records: [R("a1", "reject", "1"), R("a2", "accept", "2"), R("a3", "accept", "3")] });
  equal(st(r2, "a4"), "progressive", "another welder's draw does not release this lot");
});

test("inch-dia sums weld sizes, and counts welds without a size apart", async () => {
  equal(inchDia([{ nps: 10 }, { nps: 2.5 }, { nps: null }, { nps: 0 }]), { di: 12.5, sized: 2, unsized: 2 });
});

// ── against the database: F-17 ───────────────────────────────────────────

process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "ndtc-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const exec = await import("../../lib/db/repos/execution.mjs");
const ctl = await import("../../lib/db/repos/controls.mjs");
const hub = await import("../../lib/db/repos/piping-hub.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "NDC", name: "N", ownerUserId: alice.id });
const P = proj.id;
const inP = (fn) => withProject(db, P, fn);
const TODAY = new Date().toISOString().slice(0, 10);
let welds, lineId;

await inP(async () => {
  const { rows: [line] } = await db.query("INSERT INTO line (project_id, line_no) VALUES ($1,'10-P-1') RETURNING id", [P]);
  lineId = line.id;
  const { rows: [doc] } = await db.query(
    `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'ISO-1','0',$2,'local://x') RETURNING id`,
    [P, "d".repeat(64)]);
  const r = await runs.createRun(db, { projectId: P, documentId: doc.id, lineId, payload: DEMO });
  await runs.saveRegister(db, { projectId: P, runId: r.id, documentId: doc.id, lineId, model: buildModel(DEMO, {}) });
  welds = (await db.query("SELECT weld_uid FROM weld WHERE project_id = $1 ORDER BY weld_no", [P])).rows.map((w) => w.weld_uid);
  const wl = await exec.upsertWelder(db, { projectId: P, stampNo: "W-01", name: "Welder one" });
  await db.query("UPDATE weld SET ndt_requirement = 'RT 10% random' WHERE project_id = $1", [P]);
  for (const uid of welds) {
    await db.query("INSERT INTO weld_execution (project_id, weld_uid, welder_id, welded_at) VALUES ($1,$2,$3,$4)", [P, uid, wl.id, TODAY]);
  }
  await db.query(`INSERT INTO ndt_selection (project_id, line_id, method, percent, seed, selected_uids) VALUES ($1,$2,'RT',10,'s',$3)`,
    [P, lineId, [welds[0]]]);
});

test("F-17: a weld outside the random sample is tested once its welder's sample passes — progress and EV say so", async () => {
  await inP(async () => {
    await exec.recordNdt(db, { projectId: P, weldUid: welds[0], method: "RT", result: "accept", inspectedAt: TODAY });
    const c = await ctl.platformCounts(db, { projectId: P, discipline: "piping" });
    equal([c.installed, c.tested], [welds.length, welds.length], "every weld of the lot is accepted by the sample");
  });
});

test("F-17: a rejected sample holds the lot until the drawn progressive examination passes", async () => {
  await inP(async () => {
    await db.query("DELETE FROM ndt_record WHERE project_id = $1", [P]);
    await exec.recordNdt(db, { projectId: P, weldUid: welds[0], method: "RT", result: "reject", inspectedAt: TODAY });
    equal((await ctl.platformCounts(db, { projectId: P, discipline: "piping" })).tested, 0);
    let h = await hub.pipingHub(db, { projectId: P });
    equal([h.lots.length, h.lots[0].drawNeeded, h.lots[0].tier], [1, 2, "a"]);
    const { rows: [wl] } = await db.query("SELECT id FROM welder WHERE project_id = $1", [P]);
    const args = { projectId: P, lineId, method: "RT", welderId: wl.id };
    await throws(() => hub.drawProgressive(db, args), "INVALID_INPUT", "a person draws");
    const d = await hub.drawProgressive(db, { ...args, userId: alice.id });
    equal([d.tier, d.selected_uids.length, d.selected_uids.includes(welds[0])], ["a", 2, false]);
    assert(d.seed.includes("10-P-1|RT|W-01|a|"), d.seed);
    await throws(() => hub.drawProgressive(db, { ...args, userId: alice.id }), "INVALID_INPUT", "drawn once");
    await throws(() => db.query("UPDATE ndt_progressive_draw SET selected_uids = '{}'"), "permission denied");
    // Shooting two other welds does not release the lot; the drawn ones do.
    const other = welds.slice(1).filter((u) => !d.selected_uids.includes(u)).slice(0, 2);
    for (const u of other) await exec.recordNdt(db, { projectId: P, weldUid: u, method: "RT", result: "accept", inspectedAt: TODAY });
    equal((await ctl.platformCounts(db, { projectId: P, discipline: "piping" })).tested, 2, "only the two shot welds, for themselves");
    for (const u of d.selected_uids) await exec.recordNdt(db, { projectId: P, weldUid: u, method: "RT", result: "accept", inspectedAt: TODAY });
    equal((await ctl.platformCounts(db, { projectId: P, discipline: "piping" })).tested, welds.length - 1, "all but the defective weld");
    h = await hub.pipingHub(db, { projectId: P });
    equal([h.totals.welds, h.totals.ndtDone, h.byStatus.rejected, h.lots.length], [welds.length, welds.length - 1, 1, 0]);
    assert(h.totals.di > 0 && h.lines[0].diDone < h.lines[0].di.di, "inch-dia done is less than total while one weld is rejected");
    const csv = await hub.weldLogCsv(db, { projectId: P });
    assert(csv.split("\r\n").length === welds.length + 1 && csv.includes("رد — تعمیر"), "weld log: one row per weld with its NDT status");
  });
});

await run();
