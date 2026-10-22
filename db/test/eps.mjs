#!/usr/bin/env node
/**
 * EPS → PMS → versions → WBS → activities (owner's request 2026-10-16):
 * codes suggested per level, the three budget modes, W.F within 100% and
 * W.V down the tree, moves and copies that carry their codes, activity
 * templates and attaching them.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import * as w from "../../lib/eps/wbs.mjs";

// ── the rules ────────────────────────────────────────────────────────────

const S = w.checkSettings(w.DEFAULT_SETTINGS).settings;

test("codes: PMS code, then per level a prefix and a padded number, the separator between — PM01 → PM01.C.01 → PM01.C.01.02", async () => {
  equal(w.suggestCode("PM01", 1, 1, S), "PM01.C.01");
  equal(w.suggestCode("PM01.C.01", 2, 2, S), "PM01.C.01.02");
  equal(w.suggestCode("PM01.C.01.02", 5, 3, S), "PM01.C.01.02.03", "deeper than the settings: the last level's rule, no prefix");
  const dash = w.checkSettings({ separator: "-", levels: [{ prefix: "", digits: 3 }] }).settings;
  equal(w.suggestCode("PM01", 1, 7, dash), "PM01-007");
  equal(w.nextNumber("PM01", ["PM01.C.01", "PM01.C.04", "PM01.X"], 1, S), 5, "one past the highest number used");
  assert(w.checkSettings({ separator: "*", levels: [{ prefix: "C D", digits: 9 }] }).problems.length === 3);
  equal(w.activityCode("PM01.C.01", 3), "PM01.C.01.03");
});

const tree = (nodes, mode, budget = 1000) => w.computeTree({ version: { budget_plan: budget }, nodes, settings: { ...S, budgetMode: mode } });
const N = (id, parent, extra) => ({ id, parent_id: parent, code: id, seq: 1, ...extra });

test("the three budget modes; W.V = W.F × the parent's W.V, the root 100%", async () => {
  const nodes = [N("A", null, { wf: 60, budget_plan: 500 }), N("A1", "A", { wf: 50, budget_plan: 100 }), N("B", null, { wf: 40, budget_plan: 300 })];
  const man = tree(nodes, "manual");
  equal([man.byId.get("A").budgetPlan, man.byId.get("A1").wf, man.byId.get("A1").wv], [500, 50, 30], "typed as they are; W.V 50% × 60%");
  const wfb = tree(nodes, "wf_to_budget");
  equal([wfb.byId.get("A").budgetPlan, wfb.byId.get("A1").budgetPlan, wfb.byId.get("B").budgetPlan], [600, 300, 400], "budget = W.F × parent budget, down the tree");
  const bwf = tree(nodes, "budget_to_wf");
  equal([bwf.byId.get("A").wf, bwf.byId.get("A1").wf, bwf.byId.get("B").wf, bwf.byId.get("A1").wv], [50, 20, 30, 10], "W.F = budget ÷ parent budget");
  equal(man.problems, []);
  const over = tree([...nodes, N("C", null, { wf: 10 })], "manual");
  assert(over.problems.some((p) => p.includes("ریشه") && p.includes("110")), over.problems.join(" | "));
});

test("activities read their node: W.V, budgets from W.F, volumes and dates; within 100% of the node", async () => {
  const t = w.computeTree({ version: { budget_plan: 1000 }, settings: S,
    nodes: [N("A", null, { wf: 50, budget_plan: 400, budget_actual: 200, volume_plan: 120, volume_actual: 30, unit: "m", plan_start: "2026-01-01", plan_end: "2026-01-10" })],
    activities: [{ id: "x", node_id: "A", code: "A.01", wf: 25, progress: 40, seq: 1 }, { id: "y", node_id: "A", code: "A.02", wf: 80, seq: 2 }] });
  const [x] = t.byId.get("A").activities;
  equal([x.wv, x.budgetPlan, x.budgetActual, x.volumePlan, x.unit, x.planDays, x.progress], [12.5, 100, 50, 120, "m", 10, 40]);
  assert(t.problems.some((p) => p.includes("فعالیت‌ها") && p.includes("105")));
});

test("order and codes: reorder before / after; a code follows its moved prefix, a hand-typed one keeps its own", async () => {
  equal(w.reorder(["a", "b", "c", "d"], "d", { beforeId: "b" }), ["a", "d", "b", "c"]);
  equal(w.reorder(["a", "b", "c"], "a", { afterId: "c" }), ["b", "c", "a"]);
  equal(w.reorder(["a", "b"], "c"), ["a", "b", "c"]);
  equal([w.rebase("PM01.C.01.02", "PM01.C.01.", "PM01.C.03."), w.rebase("X-HAND", "PM01.C.01.", "PM01.C.03.")], ["PM01.C.03.02", "X-HAND"]);
});

// ── in the database ──────────────────────────────────────────────────────

process.env.PGLITE_DIR = await scratchDir("eps-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const ctr = await import("../../lib/db/repos/contracts.mjs");
const eps = await import("../../lib/db/repos/eps.mjs");
const db = await getDb();
const U = await projects.ensureUser(db, { subject: "kc|eps" });
const P = (await projects.createProject(db, { code: "EPS", name: "E", ownerUserId: U.id })).id;
const inP = (fn) => withProject(db, P, fn);
let C, C2, PM, V, A, A1, B, T;

test("the EPS: PMSs of a contract and their versions, with durations; a version moves to another PMS of the same contract only", async () => {
  await inP(async () => {
    const { rows: [k] } = await db.query("INSERT INTO contractor (project_id, code, name) VALUES ($1, 'K', 'K') RETURNING id", [P]);
    C = await ctr.upsertContract(db, { projectId: P, contractNo: "SC-1", title: "x", kind: "subcontract", contractorId: k.id, currency: "USD", userId: U.id });
    C2 = await ctr.upsertContract(db, { projectId: P, contractNo: "SC-2", title: "y", kind: "subcontract", contractorId: k.id, currency: "USD", userId: U.id });
    PM = await eps.savePms(db, { projectId: P, contractId: C.id, code: "pm01", title: "برنامهٔ اصلی", planStart: "2026-01-01", planEnd: "2026-12-31", budgetPlan: 1000, userId: U.id });
    const pm2 = await eps.savePms(db, { projectId: P, contractId: C.id, code: "PM02", title: "دوم", userId: U.id });
    const other = await eps.savePms(db, { projectId: P, contractId: C2.id, code: "PM09", title: "قرارداد دیگر", userId: U.id });
    await throws(() => eps.savePms(db, { projectId: P, contractId: C.id, code: "PM01", title: "x" }), "ثبت شده");
    await throws(() => eps.savePms(db, { projectId: P, contractId: C.id, code: "PM03", title: "x", planStart: "2026-02-01", planEnd: "2026-01-01" }), "پیش از شروع");
    V = await eps.saveVersion(db, { projectId: P, pmsId: PM.id, code: "PM01-R0", title: "خط مبنا", budgetPlan: 1000, startOn: "2026-01-01", endOn: "2026-06-30", userId: U.id });
    const v1 = await eps.saveVersion(db, { projectId: P, pmsId: PM.id, code: "PM01-R1", title: "بازنگری ۱", userId: U.id });
    await eps.moveEps(db, { projectId: P, kind: "version", id: v1.id, pmsId: pm2.id });
    await throws(() => eps.moveEps(db, { projectId: P, kind: "version", id: v1.id, pmsId: other.id }), "همین قرارداد");
    await eps.moveEps(db, { projectId: P, kind: "pms", id: pm2.id, beforeId: PM.id });
    const b = await eps.epsBoard(db, { projectId: P, contractId: C.id });
    equal(b.map((p) => [p.code, p.versions.map((v) => v.code)]), [["PM02", ["PM01-R1"]], ["PM01", ["PM01-R0"]]]);
    equal([b[1].planDays, b[1].versions[0].days], [365, 181]);
  });
});

test("WBS nodes: the suggested code under the PMS code; the children's W.F within 100%; a moved node takes a new code and its children follow", async () => {
  await inP(async () => {
    equal(await eps.suggestNodeCode(db, { projectId: P, versionId: V.id }), "PM01.C.01");
    A = await eps.saveNode(db, { projectId: P, versionId: V.id, name: "سیویل", wf: 60, budgetPlan: 600 });
    B = await eps.saveNode(db, { projectId: P, versionId: V.id, name: "مکانیک", wf: 40, budgetPlan: 400 });
    equal([A.code, B.code], ["PM01.C.01", "PM01.C.02"]);
    await throws(() => eps.saveNode(db, { projectId: P, versionId: V.id, name: "زیادی", wf: 5 }), "بیش از ۱۰۰٪");
    A1 = await eps.saveNode(db, { projectId: P, versionId: V.id, parentId: A.id, name: "فونداسیون", wf: 70, volumePlan: 50, unit: "m3",
      planStart: "2026-02-01", planEnd: "2026-02-28" });
    const a2 = await eps.saveNode(db, { projectId: P, versionId: V.id, parentId: A.id, code: "PM01.C.01.09", name: "کد دستی", wf: 30 });
    equal([A1.code, a2.code], ["PM01.C.01.01", "PM01.C.01.09"], "suggested, or typed by the person");
    await throws(() => eps.saveNode(db, { projectId: P, versionId: V.id, parentId: A.id, code: "PM01.C.01.01", name: "تکراری" }), "در این WBS هست");
    let view = await eps.wbsView(db, { projectId: P, versionId: V.id });
    const a1 = view.roots[0].children[0];
    equal([a1.wv, a1.level, view.roots[0].childWf], [42, 2, 100]);
    const grand = await eps.saveNode(db, { projectId: P, versionId: V.id, parentId: A1.id, name: "قالب", wf: 100 });
    equal(grand.code, "PM01.C.01.01.01");
    // moved under B: a new code under B, and its child's code follows; B's children's W.F would be 70 → fine
    await throws(() => eps.moveNode(db, { projectId: P, versionId: V.id, id: A.id, parentId: A1.id }), "زیر خودش");
    await eps.moveNode(db, { projectId: P, versionId: V.id, id: A1.id, parentId: B.id });
    view = await eps.wbsView(db, { projectId: P, versionId: V.id });
    equal(view.roots[1].children.map((n) => [n.code, n.children.map((c) => c.code)]), [["PM01.C.02.01", ["PM01.C.02.01.01"]]]);
    // reorder among siblings
    await eps.moveNode(db, { projectId: P, versionId: V.id, id: B.id, parentId: null, beforeId: A.id });
    view = await eps.wbsView(db, { projectId: P, versionId: V.id });
    equal(view.roots.map((n) => n.code), ["PM01.C.02", "PM01.C.01"]);
  });
});

test("budget modes in the database: a mode that would break the 100% rule is refused, not applied", async () => {
  await inP(async () => {
    await eps.saveSettings(db, { projectId: P, versionId: V.id, settings: { ...w.DEFAULT_SETTINGS, budgetMode: "wf_to_budget" }, userId: U.id });
    let view = await eps.wbsView(db, { projectId: P, versionId: V.id });
    equal(view.roots.find((n) => n.code === "PM01.C.02").budgetPlan, 400, "40% of the PMS's 1000 (the root budget is the PMS's, 083)");
    await eps.saveNode(db, { projectId: P, versionId: V.id, name: "بی‌بودجه", wf: 0 });
    await db.query("UPDATE wbs_node SET budget_plan = 900 WHERE code = 'PM01.C.03'");
    await throws(() => eps.saveSettings(db, { projectId: P, versionId: V.id, settings: { ...w.DEFAULT_SETTINGS, budgetMode: "budget_to_wf" } }), "بیش از ۱۰۰٪");
    view = await eps.wbsView(db, { projectId: P, versionId: V.id });
    equal(view.settings.budgetMode, "wf_to_budget", "the refused mode was not stored");
  });
});

test("activity templates: activities coded template + two digits, within 100%; a template copied with its activities under another", async () => {
  await inP(async () => {
    T = await eps.saveTemplate(db, { projectId: P, code: "t-con", name: "بتن" });
    const parent = await eps.saveTemplate(db, { projectId: P, code: "T-CIV", name: "سیویل" });
    await eps.saveTemplateActivity(db, { projectId: P, templateId: T.id, name: "قالب‌بندی", wf: 30 });
    await eps.saveTemplateActivity(db, { projectId: P, templateId: T.id, name: "آرماتوربندی", wf: 30 });
    await eps.saveTemplateActivity(db, { projectId: P, templateId: T.id, number: 5, name: "بتن‌ریزی", wf: 40 });
    await throws(() => eps.saveTemplateActivity(db, { projectId: P, templateId: T.id, name: "اضافه", wf: 1 }), "بیش از ۱۰۰٪");
    const copy = await eps.copyTemplate(db, { projectId: P, id: T.id, parentId: parent.id });
    const ts = await eps.templatesWithActivities(db, { projectId: P });
    const orig = ts.find((t) => t.code === "T-CON"), dup = ts.find((t) => t.id === copy.id);
    equal(orig.activities.map((a) => a.code), ["T-CON01", "T-CON02", "T-CON05"]);
    equal([dup.code, dup.parent_id, dup.activities.map((a) => a.code), dup.wfTotal], ["T-CON-2", parent.id, ["T-CON-201", "T-CON-202", "T-CON-205"], 100]);
    await throws(() => eps.moveTemplate(db, { projectId: P, id: parent.id, parentId: copy.id }), "زیر خودش");
  });
});

test("attaching: a template's activities onto a node — codes from the WBS code and the activity's two digits; budgets, volumes and dates from the node", async () => {
  await inP(async () => {
    const r = await eps.attachTemplate(db, { projectId: P, nodeId: A1.id, templateId: T.id });
    equal([r.added, r.skipped], [3, 0]);
    equal((await eps.attachTemplate(db, { projectId: P, nodeId: A1.id, templateId: T.id })).added, 0, "attaching again adds nothing twice");
    await throws(() => eps.saveActivity(db, { projectId: P, nodeId: A1.id, name: "دستی", wf: 5 }), "بیش از ۱۰۰٪");
    const view = await eps.wbsView(db, { projectId: P, versionId: V.id });
    const n = view.roots.find((x) => x.code === "PM01.C.02").children[0];
    equal(n.activities.map((a) => [a.code, a.template_code, a.wf]), [["PM01.C.02.01.01", "T-CON01", 30], ["PM01.C.02.01.02", "T-CON02", 30], ["PM01.C.02.01.05", "T-CON05", 40]]);
    const [first] = n.activities;
    equal([first.wv, first.budgetPlan, first.volumePlan, first.unit, first.plan_start, first.planDays], [Math.round(0.3 * n.wv * 10000) / 10000, Math.round(0.3 * n.budgetPlan * 100) / 100, 50, "m3", "2026-02-01", 28]);
    // a manual activity on another node: code next free — past its child node PM01.C.02.01 too — progress typed
    const m = await eps.saveActivity(db, { projectId: P, nodeId: B.id, name: "نصب", wf: 20, progress: 35 });
    equal([m.code, Number(m.progress)], ["PM01.C.02.02", 35], "PM01.C.02.01 is the child node's code");
  });
});

test("copy a node with its children and activities under another; the copy's codes are its own", async () => {
  await inP(async () => {
    await eps.saveSettings(db, { projectId: P, versionId: V.id, settings: w.DEFAULT_SETTINGS, userId: U.id });
    await db.query("UPDATE wbs_node SET wf = 10 WHERE code = 'PM01.C.03'");
    const before = await eps.wbsView(db, { projectId: P, versionId: V.id });
    const b = before.roots.find((x) => x.code === "PM01.C.02");
    await throws(() => eps.copyNode(db, { projectId: P, versionId: V.id, id: b.id, parentId: null }), "بیش از ۱۰۰٪", "a copy that would push the root over 100% is refused");
    const target = before.roots.find((x) => x.code === "PM01.C.03");
    const c = await eps.copyNode(db, { projectId: P, versionId: V.id, id: b.id, parentId: target.id });
    const after = await eps.wbsView(db, { projectId: P, versionId: V.id });
    const t = after.roots.find((x) => x.code === "PM01.C.03");
    equal([c.code, t.children[0].children.map((x) => x.code), t.children[0].children[0].activities.map((a) => a.code)],
      ["PM01.C.03.01", ["PM01.C.03.01.01"], ["PM01.C.03.01.01.01", "PM01.C.03.01.01.02", "PM01.C.03.01.01.05"]]);
    equal(after.roots.find((x) => x.code === "PM01.C.02").children.length, 1, "the original stays");
  });
});

await run();
