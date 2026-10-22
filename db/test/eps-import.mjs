#!/usr/bin/env node
/**
 * A plan file is a version of the contract's EPS, not a second schedule
 * beside it (consolidation, 2026-10-17): the F-110 MS Project schedule and
 * the PMS workbook, each into a version — WBS, activities, relations, W.F
 * shares and stated progress as the files carry them — and an import made
 * before (062) carried over without the file.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { readFile } from "node:fs/promises";
import { parseMspdi } from "../../lib/controls/mspdi.mjs";
import { parsePmsRows } from "../../lib/controls/pms.mjs";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("epsimp-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const ctr = await import("../../lib/db/repos/contracts.mjs");
const eps = await import("../../lib/db/repos/eps.mjs");
const act = await import("../../lib/db/repos/eps-activities.mjs");
const imp = await import("../../lib/db/repos/eps-import.mjs");
const pms = await import("../../lib/db/repos/pms.mjs");
const { readPmsWorkbook } = pms;

const xml = await readFile("data/f10/F10.xml");
const xls = await readFile("data/f10/pms.xlsx");
// what the files themselves say, read with the parsers the platform already trusted for them
const S = parseMspdi(xml.toString("utf8"));
const root = S.tasks.find((t) => t.level === 0);
const summaries = S.tasks.filter((t) => t.summary && t !== root);
const leaves = S.tasks.filter((t) => !t.summary && t !== root);
const isLeaf = new Set(leaves.map((t) => t.uid));
const leafLinks = S.links.filter((l) => isLeaf.has(l.predUid) && isLeaf.has(l.succUid));
const P_ = parsePmsRows(readPmsWorkbook(xls).rows);
const steps = P_.nodes.filter((n) => n.kind === "step");
const groups = P_.nodes.filter((n) => n.kind === "group" && n.parent != null);

const db = await getDb();
const u = await projects.ensureUser(db, { subject: "kc|imp" });
const P = (await projects.createProject(db, { code: "F10X", name: "F10", ownerUserId: u.id })).id;
const inP = (fn) => withProject(db, P, fn);
let C, PM, PB, PL;
await inP(async () => {
  C = await ctr.upsertContract(db, { projectId: P, contractNo: "F10-C", title: "F-110", kind: "main", counterparty: "KPC", currency: "IRR", userId: u.id });
  // the WBS is the PMS's (083): each file below builds its own PMS's tree
  PM = await eps.savePms(db, { projectId: P, contractId: C.id, code: "F10", title: "F-110", userId: u.id });
  PB = await eps.savePms(db, { projectId: P, contractId: C.id, code: "F10B", title: "F-110 PMS", userId: u.id });
  PL = await eps.savePms(db, { projectId: P, contractId: C.id, code: "F10L", title: "F-110 legacy", userId: u.id });
});

test("MS Project: summary tasks are WBS nodes, the tasks under them activities, their links relations — W.F as each one's WF over its parent's", async () => {
  await inP(async () => {
    const r = await imp.importPlan(db, { projectId: P, pmsId: PM.id, versionCode: "F10-MSP", kind: "mspdi", sourceName: "F10.xml", content: xml, userId: u.id });
    // the tasks directly under the project (START, Mobilization …) sit in one node of their own
    equal([r.nodes, r.activities, r.relations], [summaries.length + 1, leaves.length, leafLinks.length]);
    const { rows: [f110] } = await db.query("SELECT * FROM wbs_node WHERE pms_id = $1 AND code = '3.1'", [PM.id]);
    const t31 = S.tasks.find((t) => t.wbs === "3.1"), t3 = S.tasks.find((t) => t.wbs === "3");
    equal([f110.name, Number(f110.wf)], [t31.name, Math.round((Number(t31.custom.WF) / Number(t3.custom.WF)) * 1e12) / 1e10]);
    const v = await act.activityView(db, { projectId: P, versionId: r.version.id });
    assert(v.roots.length >= 2 && v.relations.length === leafLinks.length, `${v.roots.length} roots, ${v.relations.length} relations`);
    assert(r.problems.some((p) => p.includes("Summary")), "the links to summary tasks are said, not dropped silently");
    equal([r.newNodes, r.newActivities, r.planned], [r.nodes, r.activities, r.activities], "an empty tree takes the whole file; the version plans every activity");
  });
});

test("the same schedule again, as a second version of the PMS: the tree is not doubled — the version plans the activities it already has", async () => {
  await inP(async () => {
    const { rows: [{ n: before }] } = await db.query("SELECT count(*)::int AS n FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id WHERE n.pms_id = $1", [PM.id]);
    const one = leaves.find((t) => t.start && t.finish);
    const { rows: [a] } = await db.query("SELECT a.* FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id WHERE n.pms_id = $1 AND a.name = $2 LIMIT 1", [PM.id, one.name]);
    // the tree's own figure, changed by hand after the first import, stays the tree's
    await db.query("UPDATE wbs_activity SET plan_start = '2020-01-01' WHERE id = $1", [a.id]);
    const r = await imp.importPlan(db, { projectId: P, pmsId: PM.id, versionCode: "F10-MSP2", kind: "mspdi", sourceName: "F10.xml", content: xml, userId: u.id });
    const { rows: [{ n: after }] } = await db.query("SELECT count(*)::int AS n FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id WHERE n.pms_id = $1", [PM.id]);
    equal([r.newNodes, r.newActivities, r.planned, after], [0, 0, leaves.length, before]);
    const { rows: [mine] } = await db.query("SELECT plan_start FROM wbs_activity WHERE id = $1", [a.id]);
    equal(String(mine.plan_start instanceof Date ? mine.plan_start.toISOString() : mine.plan_start).slice(0, 4), "2020", "the tree keeps its own");
    const v = await act.activityView(db, { projectId: P, versionId: r.version.id });
    const found = []; const walk = (n) => { n.activities.forEach((x) => x.id === a.id && found.push(x)); n.children.forEach(walk); }; v.roots.forEach(walk);
    equal(found[0].plan_start, one.start.slice(0, 10), "under the new version the file's date stands over it");
  });
});

test("PMS workbook: groups are nodes, steps activities with the step weight as W.F, the quantity as volume and the progress the file states", async () => {
  await inP(async () => {
    const r = await imp.importPlan(db, { projectId: P, pmsId: PB.id, versionCode: "F10-PMS", kind: "pms", sourceName: "pms.xlsx", content: xls, userId: u.id });
    equal([r.nodes, r.activities], [groups.length, steps.length]);
    const s = steps.find((x) => x.progress > 0 && x.progress < 1 && x.stepWeight);
    const { rows: [a] } = await db.query(
      "SELECT a.* FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id WHERE n.pms_id = $1 AND a.code = $2 AND a.name = $3", [PB.id, s.code, s.name]);
    equal([Number(a.wf), Number(a.progress)], [Math.round(s.stepWeight * 1e6) / 1e4, Math.round(s.progress * 1e4) / 100]);
    // the stated progress is what the activity view shows until a daily report records work on it
    const v = await act.activityView(db, { projectId: P, versionId: r.version.id });
    const found = []; const walk = (n) => { n.activities.forEach((x) => x.id === a.id && found.push(x)); n.children.forEach(walk); }; v.roots.forEach(walk);
    equal([found[0].pct, found[0].pctStated], [Number(a.progress), true]);
  });
});

test("a schedule and a PMS imported before (062) are carried into versions from what was stored, without the file", async () => {
  await inP(async () => {
    const s = await pms.importSchedule(db, { projectId: P, userId: u.id, sourceName: "F10.xml", content: xml });
    const p = await pms.importPms(db, { projectId: P, userId: u.id, sourceName: "pms.xlsx", content: xls });
    const PS = await eps.savePms(db, { projectId: P, contractId: C.id, code: "F10S", title: "F-110 legacy schedule", userId: u.id });
    const a = await imp.convertLegacy(db, { projectId: P, pmsId: PS.id, versionCode: "F10-OLD-S", source: "schedule", importId: s.import.id, userId: u.id });
    const b = await imp.convertLegacy(db, { projectId: P, pmsId: PL.id, versionCode: "F10-OLD-P", source: "pms", importId: p.import.id, userId: u.id });
    equal([a.nodes, a.activities, a.relations, b.nodes, b.activities], [summaries.length + 1, leaves.length, leafLinks.length, groups.length, steps.length]);
    const L = await imp.legacyImports(db, { projectId: P });
    equal([L.schedules.length, L.pms.length], [1, 1]);
    await throws(() => imp.importPlan(db, { projectId: P, pmsId: PM.id, versionCode: "BAD", kind: "mspdi", sourceName: "x.xml", content: "<x/>", userId: u.id }), "MS Project");
  });
});

await run();
