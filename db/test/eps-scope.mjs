#!/usr/bin/env node
/**
 * PMS ↔ the platform's records (owner's request 2026-10-16): a WBS activity
 * takes its volume and its done from the equipment, welds, cables,
 * instruments, foundations and structures the platform holds; a WBS node
 * makes one activity per item; a new drawing or register adds to the PMS, a
 * withdrawn one takes away; what is in the platform but in no activity is
 * listed.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import * as sc from "../../lib/eps/scope.mjs";

// ── the rules ────────────────────────────────────────────────────────────

const item = (key, label, extra = {}) => ({ key, discipline: "electrical", label, subsystemId: "s1", unitId: "u1", measures: { count: 1, length_m: 10 }, done: {}, ...extra });

test("filters: number patterns with * and ?, several at once; subsystem, unit and kind; all that are given must hold", async () => {
  const g = sc.glob("20-P-*, 20-E-1?1");
  equal([g("20-P-101A"), g("20-e-131"), g("20-E-1311"), g("30-P-1")], [true, true, false, false]);
  equal(sc.glob("  "), null);
  const i = item("a", "CB-20-001", { kind: "LV" });
  equal([sc.matches(i, { pattern: "CB-20-*" }), sc.matches(i, { pattern: "CB-30-*" }), sc.matches(i, { subsystemIds: ["s2"] }),
    sc.matches(i, { unitIds: ["u1"], kinds: ["LV"] }), sc.matches(i, { kinds: ["MV"] })], [true, false, false, true, false]);
  const { problems } = sc.checkRule({ discipline: "equipment", measure: "length_m", milestone: "nope" });
  assert(problems.some((p) => p.includes("سنجه")) && problems.some((p) => p.includes("milestone")), problems.join(" | "));
});

test("sums in the rule's measure; an item without the measure is counted apart, never as zero", async () => {
  const rule = { discipline: "piping", measure: "dia_inch", milestone: "welded" };
  const w = (k, line, nps, welded) => ({ key: k, discipline: "piping", label: k, group: line, measures: { count: 1, dia_inch: nps }, done: { welded } });
  const items = [w("a", "L1", 2, true), w("b", "L1", 4, false), w("c", "L2", null, true), w("d", "L2", 6, true)];
  equal(sc.summarize(items, rule), { items: 4, doneCount: 3, qty: 12, done: 8, unknown: 1, pct: 66.67 });
  const gs = sc.groups(items, rule);
  equal(gs.map((g) => [g.key, g.qty, g.unknown]), [["line:L1", 6, 0], ["line:L2", 6, 1]], "piping welds by their line");
  equal(sc.weights(gs), [50, 50], "a group with an unknown quantity: equal shares");
  equal(sc.weights([{ qty: 1, unknown: 0 }, { qty: 2, unknown: 0 }, { qty: 3, unknown: 0 }]), [16.6667, 33.3333, 50]);
  const ws = sc.weights([{ qty: 1, unknown: 0 }, { qty: 1, unknown: 0 }, { qty: 1, unknown: 0 }]);
  equal([ws, Math.round(ws.reduce((s, x) => s + x, 0) * 10000) / 10000], [[33.3333, 33.3333, 33.3334], 100], "the last takes the rounding");
  const d = sc.diff([{ key: "a", label: "A", qty: 1 }, { key: "b", label: "B", qty: 2 }], [{ key: "b", label: "B", qty: 3 }, { key: "c", label: "C", qty: 1 }]);
  equal([d.added.map((x) => x.key), d.removed.map((x) => x.key), d.changed.map((x) => [x.key, x.from, x.to]), d.any], [["c"], ["a"], [["b", 2, 3]], true]);
});

// ── in the database ──────────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("eps-scope-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const ctr = await import("../../lib/db/repos/contracts.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const eps = await import("../../lib/db/repos/eps.mjs");
const act = await import("../../lib/db/repos/eps-activities.mjs");
const scope = await import("../../lib/db/repos/eps-scope.mjs");
const cr = await import("../../lib/db/repos/contract-reports.mjs");
const rp = await import("../../lib/db/repos/reports.mjs");
const users = await import("../../lib/db/repos/users.mjs");
const { buildModel } = await import("../../lib/engine.js");
const { DEMO } = await import("../../lib/demo.js");
const db = await getDb();
const U = await projects.ensureUser(db, { subject: "kc|sc-planner", displayName: "planner" });
const V_ = await projects.ensureUser(db, { subject: "kc|sc-viewer", displayName: "viewer" });
const P = (await projects.createProject(db, { code: "SC1", name: "S", ownerUserId: U.id })).id;
await projects.addMember(db, { projectId: P, userId: V_.id, role: "engineer" });
const inP = (fn) => withProject(db, P, fn);
const today = new Date().toISOString().slice(0, 10);
let C, V, NE, NC, NP, CABLE, S20, S30;
const flat = (v) => { const out = []; const walk = (n) => { out.push(...n.activities); n.children.forEach(walk); }; v.roots.forEach(walk); return out; };
const view = () => inP(() => act.activityView(db, { projectId: P, versionId: V.id }));
const cable = (no, len, sub, pulled = false) => inP(async () => {
  const { rows: [c] } = await db.query("INSERT INTO cable (project_id, cable_no, length_m, subsystem_id, voltage_class) VALUES ($1,$2,$3,$4,'LV') RETURNING *", [P, no, len, sub]);
  if (pulled) await db.query("INSERT INTO cable_activity (project_id, cable_id, code, status, done_at) VALUES ($1,$2,'pulled','done',$3)", [P, c.id, today]);
  return c;
});

await inP(async () => {
  const { rows: [k] } = await db.query("INSERT INTO contractor (project_id, code, name) VALUES ($1, 'K', 'K') RETURNING id", [P]);
  C = await ctr.upsertContract(db, { projectId: P, contractNo: "SC-1", title: "x", kind: "subcontract", contractorId: k.id, currency: "USD", userId: U.id });
  const pm = await eps.savePms(db, { projectId: P, contractId: C.id, code: "PM01", title: "x", userId: U.id });
  V = await eps.saveVersion(db, { projectId: P, pmsId: pm.id, code: "PM01-R0", title: "x", userId: U.id });
  NE = await eps.saveNode(db, { projectId: P, versionId: V.id, name: "Equipment area 20", wf: 40 });
  NC = await eps.saveNode(db, { projectId: P, versionId: V.id, name: "Cables area 20", wf: 30 });
  NP = await eps.saveNode(db, { projectId: P, versionId: V.id, name: "Piping", wf: 30 });
  CABLE = await eps.saveActivity(db, { projectId: P, nodeId: NC.id, name: "Cable pulling", wf: 100 });
  S20 = await spine.upsertSubsystem(db, { projectId: P, code: "20-01", systemCode: "20" });
  S30 = await spine.upsertSubsystem(db, { projectId: P, code: "30-01", systemCode: "30" });
  for (const t of ["20-P-101A", "20-P-101B", "20-E-201"]) await spine.upsertTag(db, { projectId: P, tagNo: t, discipline: "equipment", subsystemId: S20.id, kind: t.includes("-P-") ? "pump" : "exchanger" });
  await spine.upsertTag(db, { projectId: P, tagNo: "30-P-301", discipline: "equipment", subsystemId: S30.id, kind: "pump" });
  const { rows: [line] } = await db.query("INSERT INTO line (project_id, line_no, subsystem_id) VALUES ($1,'10-P-101',$2) RETURNING id", [P, S20.id]);
  const { rows: [doc] } = await db.query(`INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'ISO-1','0',$2,'local://x') RETURNING id`, [P, "f".repeat(64)]);
  const model = buildModel(DEMO, {});
  const r = await runs.createRun(db, { projectId: P, documentId: doc.id, lineId: line.id, payload: DEMO, validationChecks: model.checks });
  await runs.saveRegister(db, { projectId: P, runId: r.id, documentId: doc.id, lineId: line.id, model });
  await db.query("INSERT INTO weld_execution (project_id, weld_uid, welded_at) SELECT project_id, weld_uid, $2 FROM weld WHERE project_id = $1 ORDER BY weld_no LIMIT 2", [P, today]);
});
await cable("CB-20-001", 120, null, true);
await cable("CB-20-002", 80, null);
await cable("CB-30-001", 500, null, true);

test("an activity takes its volume and its done from the cables its rule takes in — read, never typed", async () => {
  const r = await inP(() => scope.saveRule(db, { projectId: P, activityId: CABLE.id, discipline: "electrical", measure: "length_m", milestone: "pulled",
    filter: { pattern: "CB-20-*" }, autoApply: false, userId: U.id }));
  equal([r.mode, r.activity_id], ["aggregate", CABLE.id]);
  let a = flat(await view()).find((x) => x.id === CABLE.id);
  equal([a.volumeActual, a.done, a.pct, a.scope.items], [200, 120, 60, 2]);
  await inP(() => scope.applyRule(db, { projectId: P, ruleId: r.id, userId: U.id }));
  // a new cable schedule brings a cable; another is withdrawn
  await cable("CB-20-003", 50, null, true);
  await inP(() => db.query("DELETE FROM cable WHERE cable_no = 'CB-20-002'"));
  a = flat(await view()).find((x) => x.id === CABLE.id);
  equal([a.volumeActual, a.done], [170, 170], "the PMS follows the register at once");
  const st = (await view()).scope.find((x) => x.rule.id === r.id);
  equal([st.pending.added.map((x) => x.label), st.pending.removed.map((x) => x.label)], [["CB-20-003"], ["CB-20-002"]], "and says what changed since it was applied");
  await inP(() => scope.applyRule(db, { projectId: P, ruleId: r.id, userId: U.id }));
  equal((await view()).scope.find((x) => x.rule.id === r.id).pending.any, false);
  const h = await inP(() => scope.ruleHistory(db, { projectId: P, ruleId: r.id }));
  equal([h.length, h[0].added.map((x) => x.label), h[0].removed.map((x) => x.label)], [2, ["CB-20-003"], ["CB-20-002"]]);
});

test("a node makes one activity per item — weighted by share, coded under the node — and follows new and withdrawn tags", async () => {
  const r = await inP(() => scope.saveRule(db, { projectId: P, nodeId: NE.id, discipline: "equipment", measure: "count", milestone: "set",
    filter: { subsystemIds: [S20.id] }, userId: U.id }));
  await inP(() => scope.autoApply(db, { projectId: P, versionId: V.id, userId: U.id }));
  let acts = flat(await view()).filter((a) => a.node_id === NE.id);
  equal(acts.map((a) => [a.code, a.name.split(" ")[0], a.wf]), [["PM01.C.01.01", "20-E-201", 33.3333], ["PM01.C.01.02", "20-P-101A", 33.3333], ["PM01.C.01.03", "20-P-101B", 33.3334]]);
  equal(acts.map((a) => a.volumeActual), [1, 1, 1]);
  // a new P&ID adds a pump; one exchanger is withdrawn while a relation hangs on it, a pump is withdrawn bare
  await inP(async () => {
    await spine.upsertTag(db, { projectId: P, tagNo: "20-P-102", discipline: "equipment", subsystemId: S20.id, kind: "pump" });
    await act.saveRelation(db, { projectId: P, predId: acts[0].id, succId: acts[1].id, userId: U.id });
    await db.query("DELETE FROM tag WHERE tag_no IN ('20-E-201', '20-P-101B')");
  });
  const res = await inP(() => scope.autoApply(db, { projectId: P, versionId: V.id, userId: U.id }));
  equal(res.find((x) => x.ruleId === r.id), { ruleId: r.id, added: 1, removed: 2, changed: 0, made: 1, dropped: 1, kept: 1 });
  acts = flat(await view()).filter((a) => a.node_id === NE.id);
  equal(acts.map((a) => [a.name.split(" ")[0], a.wf, a.scope_removed]), [["20-E-201", 0, true], ["20-P-101A", 50, false], ["20-P-102", 50, false]],
    "the one with a relation is kept at W.F 0 and marked; the bare one is gone; the new pump has its share");
  equal(await inP(() => scope.autoApply(db, { projectId: P, versionId: V.id, userId: U.id })), [], "nothing left to apply");
});

test("a per-item apply that would weigh the node past 100% is refused whole", async () => {
  await inP(async () => {
    const r = await scope.saveRule(db, { projectId: P, nodeId: NP.id, discipline: "piping", measure: "dia_inch", milestone: "welded", autoApply: false, userId: U.id });
    await eps.saveActivity(db, { projectId: P, nodeId: NP.id, name: "Supports by hand", wf: 40 });
    await throws(() => scope.applyRule(db, { projectId: P, ruleId: r.id, userId: U.id }), "بیش از ۱۰۰٪");
    equal((await db.query("SELECT count(*)::int AS n FROM wbs_activity WHERE node_id = $1", [NP.id])).rows[0].n, 1, "nothing made");
    await db.query("UPDATE wbs_activity SET wf = 0 WHERE node_id = $1", [NP.id]);
    await scope.applyRule(db, { projectId: P, ruleId: r.id, userId: U.id });
    const line = flat(await view()).find((a) => a.scope_rule_id === r.id);
    assert(line.name.startsWith("10-P-101") && line.wf === 100, `one activity for the line: ${line.name} ${line.wf}`);
    assert(line.scope.items > 2 && line.scope.doneCount === 2, "the line's welds, two of them welded");
  });
});

test("an activity read from the platform takes no daily-report lines: its progress is not entered twice", async () => {
  await inP(async () => {
    const type = await cr.ensureType(db, { projectId: P });
    const wfl = await rp.workflowOf(db, { projectId: P, reportTypeId: type.id });
    await rp.setGroupMember(db, { projectId: P, groupId: wfl[0].groups[0].id, userId: U.id, permissions: ["view", "create", "add_content", "edit", "delete_content", "sign"] });
    const R = await cr.createContractReport(db, { projectId: P, contractId: C.id, reportDate: today, title: "r", userId: U.id });
    await throws(() => act.addProgress(db, { projectId: P, reportId: R.id, activityIds: [CABLE.id], mode: "number", value: 5, userId: U.id }), "داده‌های پلتفرم");
  });
});

test("scope in no activity: what the platform holds that no rule of the version takes in", async () => {
  const u = await inP(() => scope.unplanned(db, { projectId: P, versionId: V.id }));
  equal([u.equipment.total, u.equipment.items.map((i) => i.label)], [3, ["30-P-301"]], "area 30's pump is in no activity");
  equal(u.electrical.items.map((i) => i.label), ["CB-30-001"]);
  equal(u.piping.items.length, 0);
});

test("through the routes: reading a version with edit access applies what applies itself; read-only access writes nothing", async () => {
  const route = await import("../../app/api/eps/activities/route.js");
  const req = (url, as, body) => new Request(`http://x${url}`, { method: body ? "POST" : "GET",
    headers: { authorization: `Bearer kc|sc-${as}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  await inP(async () => {
    await spine.upsertTag(db, { projectId: P, tagNo: "20-P-103", discipline: "equipment", subsystemId: S20.id, kind: "pump" });
    const { rows: [k] } = await db.query("INSERT INTO company (code, name) VALUES ('VWR', 'v') RETURNING id");
    await db.query("INSERT INTO contract_stakeholder (project_id, contract_id, company_id, role) VALUES ($1,$2,$3,'consultant')", [P, C.id, k.id]);
    await users.updateProfile(db, { userId: V_.id, companyId: k.id });
    await users.setContractMember(db, { projectId: P, contractId: C.id, userId: V_.id, position: "x", access: "view" });
  });
  const count = async () => (await inP(() => db.query("SELECT count(*)::int AS n FROM wbs_activity WHERE node_id = $1 AND NOT scope_removed", [NE.id]))).rows[0].n;
  const before = await count();
  const rv = await route.GET(req(`/api/eps/activities?projectId=${P}&versionId=${V.id}`, "viewer"));
  equal([rv.status, await count()], [200, before], "a viewer's read applies nothing");
  const re = await route.GET(req(`/api/eps/activities?projectId=${P}&versionId=${V.id}`, "planner"));
  const body = await re.json();
  equal([re.status, await count(), body.autoApplied.length], [200, before + 1, 1], "the planner's read brings the new pump into the PMS");
  equal((await route.POST(req("/api/eps/activities", "viewer", { projectId: P, kind: "scope-apply", ruleId: body.scope[0].rule.id }))).status, 403);
  const un = await (await route.GET(req(`/api/eps/activities?projectId=${P}&versionId=${V.id}&unplanned=1`, "planner"))).json();
  equal(un.unplanned.equipment.items.map((i) => i.label), ["30-P-301"]);
});

await run();
