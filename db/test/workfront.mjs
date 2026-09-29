#!/usr/bin/env node
/**
 * The work front (lib/workfront.mjs, lib/db/repos/workfront.mjs): what can
 * start, on which front, and when — from the chains and the material.
 *
 * Played on the DM-water scenario stopped mid-job: foundations poured but
 * not handed over, the isometric approved, pipe in the warehouse. The spool
 * shop and the civil crew then have work at the same time; the pump waits
 * for its foundation; a spool with no pipe waits for the PO that brings it.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("workfront-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const { STEPS, PEOPLE, SCENARIO } = await import("../../lib/scenario/dm-pump.mjs");
const { context, play, startFor } = await import("../../lib/scenario/runner.mjs");
const wf = await import("../../lib/db/repos/workfront.mjs");
const eng = await import("../../lib/workfront.mjs");

const db = await getDb();
const users = {};
for (const p of Object.values(PEOPLE)) users[p.key] = (await projects.ensureUser(db, { subject: `kc|${p.key}` })).id;
const proj = await projects.createProject(db, { code: SCENARIO.code, name: SCENARIO.name, ownerUserId: users.pm });
for (const p of Object.values(PEOPLE)) await projects.addMember(db, { projectId: proj.id, userId: users[p.key], role: p.role });
const P = proj.id;
const x = context({ db, projectId: P, users, start: startFor(150) });
const upTo = STEPS.findIndex((s) => s.id === "3.4");
await play(x, [...STEPS.slice(0, upTo + 1), ...STEPS.filter((s) => ["5.1", "5.2"].includes(s.id))]);

const front = () => withProject(db, P, () => wf.workFront(db, { projectId: P }));

test("the engine: a horizon from the material, nested horizons, never «ready» when unknown", async () => {
  const today = "2026-01-10";
  equal(eng.horizonOf({ open: true, material: { state: "ready" } }, today), "day");
  equal(eng.horizonOf({ open: true, material: { state: "short", eta: "2026-01-15" } }, today), "week");
  equal(eng.horizonOf({ open: true, material: { state: "short", eta: "2026-02-01" } }, today), "month");
  equal(eng.horizonOf({ open: true, material: { state: "short", eta: null } }, today), "later");
  equal(eng.horizonOf({ open: true, material: { state: "unknown" } }, today), "unknown");
  equal(eng.horizonOf({ open: false, material: null }, today), "blocked");
  const it = { horizon: "week" };
  equal([eng.inHorizon(it, "day"), eng.inHorizon(it, "week"), eng.inHorizon(it, "month"), eng.inHorizon(it, "all")], [false, true, true, true]);
});

test("mid-job, the spool shop and the civil crew are two fronts open at the same time", async () => {
  const f = await front();
  const spools = f.items.filter((i) => i.kind === "spool");
  assert(spools.length === 2 && spools.every((s) => s.front === "shop" && s.stepCode === "released"), JSON.stringify(spools.map((s) => [s.item, s.front, s.stepCode])));
  const [sp1, sp2] = ["SP-01", "SP-02"].map((n) => spools.find((s) => s.item.startsWith(n)));
  equal(sp2.horizon, "day", `SP-02 is pipe only, and the pipe is in the warehouse: ${sp2.material?.text}`);
  // SP-01 also needs an elbow nobody put in the warehouse catalogue: unknown, not «ready».
  equal(sp1.horizon, "unknown");
  assert(/ELL90-3-S40/.test(sp1.material.text), sp1.material.text);
  const fdn = f.items.filter((i) => i.front === "civil" && i.open);
  assert(fdn.length >= 2 && fdn.every((i) => i.horizon === "day"), `foundations have open civil steps: ${JSON.stringify(fdn.map((i) => [i.item, i.step]))}`);
  assert(f.parallel.day.includes("shop") && f.parallel.day.includes("civil"), `parallel today: ${f.parallel.day}`);
});

test("the pump waits on its chain, not on a guess", async () => {
  const f = await front();
  const pump = f.items.find((i) => i.item === "P-7001");
  equal([pump.open, pump.horizon], [false, "blocked"]);
  assert(pump.waitingOn.some((w) => /فونداسیون/.test(w)), `it waits for its foundation: ${pump.waitingOn}`);
});

test("pipe issued elsewhere: the spool moves to the week of the PO that brings more", async () => {
  await withProject(db, P, async () => {
    // Empty the warehouse: the pipe goes to another job, and a PO for more pipe is due in five days.
    const { rows: [lot] } = await db.query("SELECT id, item_id FROM material_lot WHERE project_id = $1 LIMIT 1", [P]);
    await db.query(`INSERT INTO material_movement (project_id, lot_id, kind, qty, moved_on, ref_no, purpose, recorded_by)
                    VALUES ($1,$2,'issue',36,$3,'MIV-X','other job',$4)`, [P, lot.id, x.d(61), users.pm]);
    const { rows: [po] } = await db.query("SELECT id, vendor_id FROM purchase_order WHERE project_id = $1 AND po_no = 'PO-7002'", [P]);
    const eta = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await db.query(`INSERT INTO po_line (project_id, po_id, line_no, item_id, description, qty, uom, forecast_on)
                    VALUES ($1,$2,99,$3,'more pipe',40,'m',$4)`, [P, po.id, lot.item_id, eta]);
  });
  const f = await front();
  const spools = f.items.filter((i) => i.kind === "spool");
  const sp2 = spools.find((s) => s.item.startsWith("SP-02"));
  equal([sp2.horizon, sp2.inDays], ["week", 5], sp2.material?.text);
  assert(!f.parallel.day.includes("shop") && f.parallel.week.includes("shop"), `today ${f.parallel.day} · week ${f.parallel.week}`);
});

await run();
