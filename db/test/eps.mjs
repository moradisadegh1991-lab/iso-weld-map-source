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

test("W.F over 100%: every node whose children (nodes and activities together) pass it, and the PMS itself; fitted in proportion to exactly 100", async () => {
  const t = w.computeTree({ version: { budget_plan: 1000 }, settings: S,
    nodes: [N("A", null, { wf: 70 }), N("B", null, { wf: 50 }), N("A1", "A", { wf: 60 }), N("B1", "B", { wf: 100 })],
    activities: [{ id: "x", node_id: "A", code: "A.01", wf: 60, seq: 1 }, { id: "y", node_id: "B1", code: "B1.01", wf: 100, seq: 1 }] });
  equal(w.wfOverflows(t).map((o) => [o.id, o.sum, o.children.length]), [[null, 120, 2], ["A", 120, 2]], "the PMS (70 + 50) and A (node 60 + activity 60); B and B1 are at 100");
  const fit = w.fitTo100(w.wfOverflows(t)[1].children);
  equal(fit.map((k) => [k.id, k.kind, k.wf]), [["A1", "node", 50], ["x", "activity", 50]]);
  const thirds = w.fitTo100([{ id: 1, kind: "node", wf: 50 }, { id: 2, kind: "node", wf: 50 }, { id: 3, kind: "node", wf: 50 }, { id: 4, kind: "activity", wf: null }]);
  equal(Math.round(thirds.reduce((s2, k) => s2 + k.wf, 0) * 1e10) / 1e10, 100, "thirds sum to exactly 100");
  equal(thirds.length, 3, "a child with no W.F is left without one");
  equal(w.fitTo100([{ id: 1, kind: "node", wf: 40 }, { id: 2, kind: "node", wf: 60 }]), [], "at 100 nothing changes");
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

test("update weights/budgets: the worked-out figure written into the stored one; manual has nothing to update; W.F keeps ten decimals", async () => {
  await inP(async () => {
    await db.query("UPDATE wbs_node SET wf = NULL WHERE code = 'PM01.C.03'");   // the copy test's 10% left the root over 100%
    await eps.saveSettings(db, { projectId: P, versionId: V.id, settings: w.DEFAULT_SETTINGS, userId: U.id });
    await throws(() => eps.refreshWeights(db, { projectId: P, versionId: V.id, userId: U.id }), "دستی", "manual: nothing to bring up to date");
    await db.query("UPDATE wbs_node SET wf = 39.8765432101 WHERE code = 'PM01.C.02'");
    await eps.saveSettings(db, { projectId: P, versionId: V.id, settings: { ...w.DEFAULT_SETTINGS, budgetMode: "wf_to_budget" }, userId: U.id });
    await db.query("UPDATE wbs_node SET budget_plan = NULL WHERE code IN ('PM01.C.02', 'PM01.C.03')");
    const r = await eps.refreshWeights(db, { projectId: P, versionId: V.id, userId: U.id });
    const stored = async (code) => (await db.query("SELECT wf::text, budget_plan::float8 AS b FROM wbs_node WHERE code = $1", [code])).rows[0];
    assert(r.updated >= 1, `nodes updated: ${r.updated}`);
    equal(await stored("PM01.C.02"), { wf: "39.8765432101", b: 398.77 }, "ten decimals of W.F kept; the budget from it, of the root's 1000, now stored");
    equal((await eps.refreshWeights(db, { projectId: P, versionId: V.id, userId: U.id })).updated, 0, "a second run has nothing left to change");
    await eps.saveSettings(db, { projectId: P, versionId: V.id, settings: w.DEFAULT_SETTINGS, userId: U.id });
  });
});

test("fit to 100% in the database: a tree over 100% (as a file can bring it) is listed, fitted where asked, and the 100% rule then holds; W.F from budgets is not overwritten", async () => {
  await inP(async () => {
    const Q = await eps.savePms(db, { projectId: P, contractId: C.id, code: "FIT", title: "fit", budgetPlan: 1000, userId: U.id });
    const n1 = await eps.saveNode(db, { projectId: P, pmsId: Q.id, name: "a", wf: 60 });
    const n2 = await eps.saveNode(db, { projectId: P, pmsId: Q.id, name: "b", wf: 40 });
    const a1 = await eps.saveActivity(db, { projectId: P, nodeId: n1.id, name: "x", wf: 70 });
    const a2 = await eps.saveActivity(db, { projectId: P, nodeId: n1.id, name: "y", wf: 30 });
    await db.query("UPDATE wbs_node SET wf = 90 WHERE id = $1", [n2.id]);          // the PMS: 60 + 90
    await db.query("UPDATE wbs_activity SET wf = 90 WHERE id = $1", [a1.id]);      // node a: 90 + 30
    let v = await eps.wbsView(db, { projectId: P, pmsId: Q.id });
    equal(v.overflows.map((o) => [o.code, o.sum]), [[null, 150], [n1.code, 120]]);
    equal(await eps.fitWf(db, { projectId: P, pmsId: Q.id, nodeId: n1.id, userId: U.id }), { updated: 2, from: 120 });
    const wf = async (t, id) => Number((await db.query(`SELECT wf FROM ${t} WHERE id = $1`, [id])).rows[0].wf);
    equal([await wf("wbs_activity", a1.id), await wf("wbs_activity", a2.id)], [75, 25], "in proportion: 90:30 → 75:25");
    await eps.fitWf(db, { projectId: P, pmsId: Q.id, nodeId: null, userId: U.id });
    equal([await wf("wbs_node", n1.id), await wf("wbs_node", n2.id)], [40, 60], "the PMS's top nodes: 60:90 → 40:60");
    v = await eps.wbsView(db, { projectId: P, pmsId: Q.id });
    equal([v.overflows, v.problems.filter((p) => p.includes("بیش از ۱۰۰"))], [[], []], "nothing over 100% now");
    equal(await eps.fitWf(db, { projectId: P, pmsId: Q.id, nodeId: n1.id, userId: U.id }), { updated: 0 }, "at 100: nothing to do");
    // under budget_to_wf a node's W.F is its budget's share: refused rather than written over
    await eps.saveSettings(db, { projectId: P, pmsId: Q.id, settings: { ...w.DEFAULT_SETTINGS, budgetMode: "budget_to_wf" }, userId: U.id });
    await db.query("UPDATE wbs_node SET budget_plan = 800 WHERE id = $1", [n1.id]);
    await db.query("UPDATE wbs_node SET budget_plan = 700 WHERE id = $1", [n2.id]);
    await throws(() => eps.fitWf(db, { projectId: P, pmsId: Q.id, nodeId: null, userId: U.id }), "بودجه");
  });
});

test("a template's activity carries the activity table's fields and the project's own columns, and hands them on: copy, paste, attach, apply", async () => {
  await inP(async () => {
    const { rows: [f] } = await db.query("INSERT INTO custom_field (project_id, form_key, label, data_type) VALUES ($1, $2, 'Crew', 'text') RETURNING id", [P, eps.ACTIVITY_FORM]);
    const col = async (row) => (await db.query("SELECT value FROM custom_value WHERE field_id = $1 AND row_key = $2", [f.id, String(row)])).rows[0]?.value ?? null;
    const setCol = (row, v) => db.query("INSERT INTO custom_value (project_id, field_id, row_key, value) VALUES ($1,$2,$3,$4) ON CONFLICT (field_id, row_key) DO UPDATE SET value = EXCLUDED.value", [P, f.id, String(row), v]);
    const TT = await eps.saveTemplate(db, { projectId: P, code: "TF", name: "fields" });
    const ta = await eps.saveTemplateActivity(db, { projectId: P, templateId: TT.id, name: "Erect", wf: 40, actType: "Task Dependent", activityNo: "A100", wfRate: 0.0000123456, volumePlan: 12.5 });
    equal([ta.act_type, ta.activity_no, Number(ta.wf_rate), Number(ta.volume_plan)], ["Task Dependent", "A100", 0.0000123456, 12.5], "typed as on an activity");
    await setCol(ta.id, "4 men");
    const kept = await eps.saveTemplateActivity(db, { projectId: P, templateId: TT.id, id: ta.id, name: "Erect", wf: 40 });
    equal([kept.act_type, kept.activity_no], ["Task Dependent", "A100"], "left out of a save: kept");

    // pasted onto another template: a copy with its fields and columns, or the row itself moved
    const T2x = await eps.saveTemplate(db, { projectId: P, code: "TG", name: "other" });
    const cp = await eps.placeTemplateActivity(db, { projectId: P, id: ta.id, templateId: T2x.id });
    equal([cp.code, cp.act_type, await col(cp.id)], ["TG01", "Task Dependent", "4 men"]);
    const mv = await eps.placeTemplateActivity(db, { projectId: P, id: cp.id, templateId: TT.id, move: true });
    equal([mv.id, mv.code, await col(mv.id)], [cp.id, "TF02", "4 men"], "moved: the same row, its column with it");
    await eps.removeTemplateActivity(db, { projectId: P, id: mv.id });
    equal(await col(mv.id), null, "deleted: its column values go with it");
    // a template copied: its activities' fields and columns too
    const c2 = await eps.copyTemplate(db, { projectId: P, id: TT.id, parentId: null });
    const { rows: [ca] } = await db.query("SELECT * FROM template_activity WHERE template_id = $1", [c2.id]);
    equal([ca.activity_no, Number(ca.volume_plan), await col(ca.id)], ["A100", 12.5, "4 men"]);

    // attached to a WBS node: the activity takes them all
    const Q = await eps.savePms(db, { projectId: P, contractId: C.id, code: "TFP", title: "fields", userId: U.id });
    const n = await eps.saveNode(db, { projectId: P, pmsId: Q.id, name: "n", wf: 100 });
    await eps.attachTemplate(db, { projectId: P, nodeId: n.id, templateId: TT.id });
    const act = async () => (await db.query("SELECT * FROM wbs_activity WHERE node_id = $1 AND template_activity_id = $2", [n.id, ta.id])).rows[0];
    let a = await act();
    equal([a.act_type, a.activity_no, Number(a.wf_rate), Number(a.volume_plan), await col(a.id)], ["Task Dependent", "A100", 0.0000123456, 12.5, "4 men"]);
    // the template changed and applied: the activity follows, its column too
    await eps.saveTemplateActivity(db, { projectId: P, templateId: TT.id, id: ta.id, name: "Erect", wf: 40, activityNo: "A200", volumePlan: 20 });
    await setCol(ta.id, "6 men");
    const dry = await eps.syncTemplate(db, { projectId: P, templateId: TT.id, dryRun: true, userId: U.id });
    equal(dry.updated, 1);
    await eps.syncTemplate(db, { projectId: P, templateId: TT.id, userId: U.id });
    a = await act();
    equal([a.activity_no, Number(a.volume_plan), await col(a.id)], ["A200", 20, "6 men"]);
    equal((await eps.syncTemplate(db, { projectId: P, templateId: TT.id, dryRun: true, userId: U.id })).updated, 0, "nothing left to apply");
    await setCol(ta.id, "7 men");
    equal((await eps.syncTemplate(db, { projectId: P, templateId: TT.id, dryRun: true, userId: U.id })).updated, 1, "a column changed alone is a change to apply");
  });
});

await run();
