#!/usr/bin/env node
/**
 * Schedule (MS Project XML) and PMS (weighted progress) — lib/controls/mspdi.mjs,
 * lib/controls/pms.mjs, lib/db/repos/pms.mjs — on the furnace F-110 files
 * themselves (data/f10): the schedule read the same as MPXJ reads the .mpp,
 * the PMS re-derived to the workbook's own total, its one inconsistency
 * named, links made only where certain, and imports that stay as handed over.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { readFile } from "node:fs/promises";

process.env.PGLITE_DIR = await scratchDir("pms-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const repo = await import("../../lib/db/repos/pms.mjs");
const { parseMspdi, durationDays } = await import("../../lib/controls/mspdi.mjs");
const P = await import("../../lib/controls/pms.mjs");

const XML = await readFile("data/f10/F10.xml", "utf8");
const XLS = await readFile("data/f10/pms.xlsx");

// ── the schedule ─────────────────────────────────────────────────────────

test("the schedule reads as MS Project states it: 375 tasks, 386 links, status date, baseline beside current", async () => {
  const s = parseMspdi(XML);
  equal([s.tasks.length, s.links.length, s.statusDate, s.startDate, s.finishDate], [375, 386, "2021-10-22", "2021-10-22", "2022-07-19"]);
  // Values below are MPXJ's reading of the original .mpp, not this parser's output.
  const mob = s.tasks.find((t) => t.name === "Mobilization");
  equal([mob.start, mob.finish, mob.blStart, mob.blFinish, mob.pct, mob.durationDays], ["2021-10-23", "2021-11-06", "2021-05-22", "2021-06-05", 100, 15]);
  const fin = s.tasks.find((t) => t.name === "FINISH");
  equal([fin.milestone, fin.finish, fin.blFinish], [true, "2022-06-07", "2022-02-15"], "the finish slipped 112 days against the baseline");
  const panels = s.tasks.find((t) => t.name === "1A Radiant Floor Panels");
  equal([panels.summary, panels.outline, s.tasks.find((t) => t.uid === panels.parentUid).name], [true, "3.1.1.1.1", "Radiant Plate Sections"]);
  equal(s.tasks[0].custom["Project Price (RLS)"], "35147399920", "the planner's own fields come by their alias");
});

test("a duration is working days at the file's own minutes per day; a file that is not MSPDI is refused", async () => {
  equal([durationDays("PT40H0M0S"), durationDays("PT22H48M0S"), durationDays("PT0H0M0S"), durationDays("PT40H0M0S", 600)], [5, 2.85, 0, 4]);
  await throws(() => parseMspdi("<html><body>not a plan</body></html>"), "XML");
});

// ── the PMS ──────────────────────────────────────────────────────────────

const pmsNodes = () => {
  const { rows } = repo.readPmsWorkbook(XLS);
  return P.parsePmsRows(rows);
};

test("the PMS re-derived from its 875 steps gives the workbook's own total", async () => {
  const { nodes, stated, title } = pmsNodes();
  equal(nodes.filter((n) => n.kind === "step").length, 875);
  assert(/Ethylene Plant Expansion/.test(title), title);
  const r = P.rollup(nodes).get(0);
  assert(Math.abs(r.progress - stated) < 1e-6, `computed ${r.progress} vs stated ${stated}`);
  assert(Math.abs(r.weight - 1) < 1e-6, `weights add to ${r.weight}`);
});

test("its one inconsistency is named, not smoothed: 13 steps whose total is not last + this", async () => {
  const problems = P.checkPms(pmsNodes().nodes);
  equal([...new Set(problems.map((p) => p.kind))], ["total-not-last-plus-this"]);
  equal(problems.length, 13);
  const r602 = problems.find((p) => p.row === 602);
  equal([r602.name, r602.detail], ["Material Handling", { last: 0.9, this: 0, total: 0.95 }]);
});

test("the checks catch weights that do not add, steps that are not 100 %, and a roll-up the steps do not give", async () => {
  const rows = [
    { __rowNum__: 2, B: "P", L: 1, AA: 0.9 },
    { __rowNum__: 3, C: "1A Panels", L: 0.6, AA: 0.5 },
    { __rowNum__: 4, H: "x.1", I: "Installation", K: 0.5, L: 0.3, AA: 1 },
    { __rowNum__: 5, H: "x.2", I: "Certificate", K: 0.4, L: 0.2, AA: 0 },  // 0.6 × 0.4 is 0.24
    { __rowNum__: 6, C: "1B Roof", L: 0.3, AA: 0 },
    { __rowNum__: 7, H: "y.1", I: "Installation", K: 1, L: 0.3, AA: 0 },
  ];
  const { nodes } = P.parsePmsRows(rows);
  const kinds = P.checkPms(nodes).map((p) => `${p.kind}@${p.row}`).sort();
  equal(kinds, ["rollup@3", "rollup@4", "step-weights@4", "step-wf@6", "weight-sum@3", "weight-sum@4"]);
});

// ── the link between them ────────────────────────────────────────────────

test("an element links to a schedule task only by the same name or the same section code, and only when one task has it", async () => {
  const tasks = [
    { uid: 1, name: "1A Radiant Floor Panels", summary: true },
    { uid: 2, name: "2A1 Columns and Structural Steel", summary: true },
    { uid: 3, name: "Primary TLE (E-110A)", summary: true },
    { uid: 4, name: "3B Convection", summary: true }, { uid: 5, name: "3B Convection (old)", summary: true },
  ];
  const rows = [
    { __rowNum__: 0, B: "P", L: 1 },
    { __rowNum__: 1, C: "1A Radiant Floor Panels", L: 0.25 }, { __rowNum__: 2, H: "a", I: "s", K: 1, L: 0.25 },
    { __rowNum__: 3, C: "2A1 Columns Steel Structure", L: 0.25 }, { __rowNum__: 4, H: "b", I: "s", K: 1, L: 0.25 },
    { __rowNum__: 5, C: "Primery TLE (E-110 A)", L: 0.25 }, { __rowNum__: 6, H: "c", I: "s", K: 1, L: 0.25 },
    { __rowNum__: 7, C: "3B Convection Side", L: 0.25 }, { __rowNum__: 8, H: "d", I: "s", K: 1, L: 0.25 },
  ];
  const { nodes } = P.parsePmsRows(rows);
  const l = P.suggestLinks(nodes, tasks);
  equal(l.map((x) => [x.uid, x.by, x.ambiguous]), [[1, "name", false], [2, "code", false], [null, null, false], [null, null, true]],
    "a misspelt name is a person's link to make; two tasks with one code are a person's choice");
});

test("the plan spreads an element's weight evenly over its days; the curve says how much weight it covers", async () => {
  equal([P.plannedFraction("2022-01-01", "2022-01-10", "2021-12-31"), P.plannedFraction("2022-01-01", "2022-01-10", "2022-01-05"),
    P.plannedFraction("2022-01-01", "2022-01-10", "2022-01-10")], [0, 0.5, 1]);
  const els = [{ wf: 0.3, task: { blStart: "2022-01-01", blFinish: "2022-01-10" } }, { wf: 0.1, task: null }];
  const c = P.planCurve(els, { dates: ["2022-01-05", "2022-02-01"] });
  equal([c.covered, c.points.map((p) => p.pct)], [0.3, [50, 100]]);
});

// ── into a project ───────────────────────────────────────────────────────

const db = await getDb();
const me = await projects.ensureUser(db, { subject: "kc|pms" });
const proj = await projects.createProject(db, { code: "F10T", name: "F", ownerUserId: me.id });
const PID = proj.id;
const inP = (fn) => withProject(db, PID, fn);

test("imported together, OLF1's elements link where certain and the rest wait for a person", async () => {
  const s = await inP((tx) => repo.importSchedule(tx, { projectId: PID, userId: me.id, sourceName: "F10.xml", content: XML }));
  equal([s.tasks, s.links], [375, 386]);
  const p = await inP((tx) => repo.importPms(tx, { projectId: PID, userId: me.id, sourceName: "pms.xlsx", content: XLS, linkWithin: "OLF1" }));
  equal([p.steps, p.problems, p.elements, p.linked], [875, 13, 87, 42]);
  assert(Math.abs(p.computed - p.stated) < 1e-6);
  const v = await inP((tx) => repo.pmsView(tx, { projectId: PID }));
  equal([v.tasks.length, v.pms.import.data_date, v.pms.elements.filter((e) => e.uid != null).length], [375, null, 42]);
  equal(v.pms.curve.actual, [], "no data date: the workbook's progress is not plotted against a date it does not state");
  assert(v.pms.curve.undated > 0 && v.pms.curve.baseline.at(-1).pct === 100, "but it is shown, and the plan reaches 100 %");
});

test("the data date is stated once; progress after it is a dated report with a source, and moves the roll-up", async () => {
  const v0 = await inP((tx) => repo.pmsView(tx, { projectId: PID }));
  const imp = v0.pms.import.id;
  await inP((tx) => repo.setDataDate(tx, { projectId: PID, pmsImportId: imp, dataDate: "2023-04-08" }));
  await throws(() => inP((tx) => repo.setDataDate(tx, { projectId: PID, pmsImportId: imp, dataDate: "2023-04-09" })), "قبلاً");
  const step = v0.pms.nodes.find((n) => n.kind === "step" && n.progress === 0 && n.wf > 0.001);
  const group = v0.pms.nodes.find((n) => n.kind === "group");
  await throws(() => inP((tx) => repo.recordProgress(tx, { projectId: PID, seq: group.seq, asOf: "2023-05-01", pct: 10, source: "DR-1" })), "گام");
  await throws(() => inP((tx) => repo.recordProgress(tx, { projectId: PID, seq: step.seq, asOf: "2099-01-01", pct: 10, source: "DR-1" })), "آینده");
  await throws(() => inP((tx) => repo.recordProgress(tx, { projectId: PID, seq: step.seq, asOf: "2023-05-01", pct: 10, source: " " })), "منبع");
  await throws(() => inP((tx) => repo.recordProgress(tx, { projectId: PID, seq: step.seq, asOf: "2023-01-01", pct: 10, source: "DR-1" })), "پیش از");
  await inP((tx) => repo.recordProgress(tx, { projectId: PID, seq: step.seq, asOf: "2023-05-01", pct: 100, source: "DR-0412" }));
  const v1 = await inP((tx) => repo.pmsView(tx, { projectId: PID }));
  const top0 = v0.pms.nodes[0].now, top1 = v1.pms.nodes[0].now;
  assert(Math.abs(top1 - top0 - step.wf) < 1e-9, `the total rose by exactly the step's weight: ${top0} → ${top1}, wf ${step.wf}`);
  equal(v1.pms.nodes[step.seq].report.source, "DR-0412");
  const before = await inP((tx) => repo.pmsView(tx, { projectId: PID, asOf: "2023-04-30" }));
  equal(before.pms.nodes[0].now, top0, "on a date before the report, the report does not count");
});

test("a person links what the engine would not, and can unlink; the newest link wins", async () => {
  const v = await inP((tx) => repo.pmsView(tx, { projectId: PID }));
  const open = v.pms.elements.find((e) => e.uid == null);
  const task = v.tasks.find((t) => t.is_summary && t.name.startsWith("Primary TLE (E-110A)"));
  await inP((tx) => repo.linkElement(tx, { projectId: PID, seq: open.seq, taskUid: task.uid, userId: me.id }));
  let e = (await inP((tx) => repo.pmsView(tx, { projectId: PID }))).pms.elements.find((x) => x.seq === open.seq);
  equal([e.uid, e.by], [task.uid, "person"]);
  await inP((tx) => repo.linkElement(tx, { projectId: PID, seq: open.seq, taskUid: null, userId: me.id }));
  e = (await inP((tx) => repo.pmsView(tx, { projectId: PID }))).pms.elements.find((x) => x.seq === open.seq);
  equal(e.uid, null);
  const step = v.pms.nodes.find((n) => n.kind === "step");
  await throws(() => inP((tx) => repo.linkElement(tx, { projectId: PID, seq: step.seq, taskUid: task.uid })), "گام");
});

test("a new issue of the plan keeps the links: they follow the task's UID, and a UID the plan dropped reads as unlinked", async () => {
  const before = (await inP((tx) => repo.pmsView(tx, { projectId: PID }))).pms.elements.filter((e) => e.uid != null).length;
  await inP((tx) => repo.importSchedule(tx, { projectId: PID, userId: me.id, sourceName: "F10 rev B.xml", content: XML }));
  const after = (await inP((tx) => repo.pmsView(tx, { projectId: PID }))).pms.elements.filter((e) => e.uid != null).length;
  equal(after, before);
  const uid = parseMspdi(XML).tasks.find((t) => t.name === "1A Radiant Floor Panels").uid;
  const at = XML.indexOf(`<UID>${uid}</UID>`, XML.indexOf("<Tasks>"));
  const from = XML.lastIndexOf("<Task>", at), to = XML.indexOf("</Task>", at) + "</Task>".length;
  const dropped = XML.slice(0, from) + XML.slice(to);
  equal(parseMspdi(dropped).tasks.length, 374, "the test removed exactly that task");
  await inP((tx) => repo.importSchedule(tx, { projectId: PID, userId: me.id, sourceName: "F10 rev C.xml", content: dropped }));
  const v = await inP((tx) => repo.pmsView(tx, { projectId: PID }));
  equal(v.pms.elements.filter((e) => e.uid != null).length, before - 1, "the element of the dropped task is unlinked, the rest stay");
});

test("an import stays as it was handed over: its rows cannot be edited or deleted", async () => {
  await throws(() => inP((tx) => tx.query("UPDATE pms_node SET wf = 0 WHERE project_id = $1", [PID])), "permission");
  await throws(() => inP((tx) => tx.query("DELETE FROM schedule_task WHERE project_id = $1", [PID])), "permission");
  await throws(() => inP((tx) => tx.query("UPDATE pms_progress SET pct = 0 WHERE project_id = $1", [PID])), "permission");
});

await run();
