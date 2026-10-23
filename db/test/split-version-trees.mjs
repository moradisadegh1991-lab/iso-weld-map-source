#!/usr/bin/env node
/**
 * 082z, tested against the data it is for: a database at 082 where two
 * versions of one PMS each built a WBS of their own (the rule until 083),
 * then everything after applied on top. 083 refused such a database; with
 * 082z before it, each tree reaches 083 on a PMS of its own and nothing is
 * dropped.
 */
import { test, run, equal, assert, scratchDir } from "./harness.mjs";
import { readdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../../lib/db/client.mjs";
import { migrate } from "../../lib/db/migrate.mjs";

const ALL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const before = await scratchDir("split-files-");
for (const f of (await readdir(ALL)).filter((f) => f.endsWith(".sql")).sort())
  if (f < "082z") await copyFile(path.join(ALL, f), path.join(before, f));

const db = await createClient({ dataDir: await scratchDir("split-db-") });
await migrate(db, { dir: before });

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const proj = await one("INSERT INTO project (code, name) VALUES ('SPL','split') RETURNING id");
const c = await one(`INSERT INTO contract (project_id, contract_no, title, kind, currency, counterparty) VALUES ($1,'C-1','c','main','IRR','Client') RETURNING id`, [proj.id]);
const pms = (code, title) => one(`INSERT INTO eps_pms (project_id, contract_id, code, title, pms_type, description, plan_start)
  VALUES ($1,$2,$3,$4,'Construction','d','2026-01-01') RETURNING id`, [proj.id, c.id, code, title]);
const version = (pmsId, code, title, seq, master = false) => one(`INSERT INTO eps_version (project_id, pms_id, code, title, seq, master, settings, budget_plan)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [proj.id, pmsId, code, title, seq, master, JSON.stringify({ sep: code }), seq * 100]);
const tree = async (versionId, codes) => {
  const ids = [];
  for (const code of codes) {
    const n = await one("INSERT INTO wbs_node (project_id, version_id, code, name) VALUES ($1,$2,$3,$3) RETURNING id", [proj.id, versionId, code]);
    await db.query("INSERT INTO wbs_activity (project_id, node_id, code, name, progress) VALUES ($1,$2,$3,$3,40)", [proj.id, n.id, `${code}.A1`]);
    ids.push(n.id);
  }
  return ids;
};
const P1 = await pms("PM01", "Pump house");
const V1 = await version(P1.id, "PM01-V1", "First", 1);
const V2 = await version(P1.id, "PM01.V2", "Second", 2, true);   // the master, second by order
const V3 = await version(P1.id, "PM01-V3", "Third", 3);
const V4 = await version(P1.id, "PM01-V4", "No tree", 4);
await tree(V1.id, ["A", "B"]); await tree(V2.id, ["A"]); await tree(V3.id, ["A", "B", "C"]);
// a PMS code the split would pick is taken already
await pms("PM01-PM01-V1", "Taken");
const P2 = await pms("PM02", "One tree");
const W1 = await version(P2.id, "PM02-V1", "Only", 1);
await version(P2.id, "PM02-V2", "Bare", 2);
await tree(W1.id, ["X"]);
const counts = async () => (await one(`SELECT (SELECT count(*) FROM wbs_node)::int AS nodes, (SELECT count(*) FROM wbs_activity)::int AS acts,
  (SELECT count(*) FROM eps_version)::int AS versions`));
const was = await counts();

await migrate(db);   // 082z, 083 and on

const pmsOf = async (versionId) => one(`SELECT p.* FROM eps_version v JOIN eps_pms p ON p.id = v.pms_id WHERE v.id = $1`, [versionId]);
const treeOf = async (pmsId) => (await db.query("SELECT code FROM wbs_node WHERE pms_id = $1 ORDER BY code", [pmsId])).rows.map((r) => r.code);

test("the master's tree stays on the PMS, with the versions that had none", async () => {
  equal((await pmsOf(V2.id)).id, P1.id);
  equal((await pmsOf(V4.id)).id, P1.id, "a version without a tree is not moved");
  equal(await treeOf(P1.id), ["A"]);
  equal((await one("SELECT settings FROM eps_pms WHERE id = $1", [P1.id])).settings, { sep: "PM01.V2" }, "083 carries the master's settings to the PMS");
});

test("each other version with a tree of its own moves, with it, to a PMS of its own", async () => {
  const a = await pmsOf(V1.id), b = await pmsOf(V3.id);
  equal(a.code, "PM01-PM01-V1-2", "the code taken already: the next free one");
  equal(b.code, "PM01-PM01-V3");
  equal(a.title, "Pump house (First)");
  equal([a.contract_id, a.pms_type, a.description], [c.id, "Construction", "d"], "the old PMS's fields");
  equal(await treeOf(a.id), ["A", "B"]);
  equal(await treeOf(b.id), ["A", "B", "C"]);
  equal((await one("SELECT budget_plan FROM eps_pms WHERE id = $1", [b.id])).budget_plan, "300.00", "its version's root budget goes with it");
});

test("a PMS with one tree is left as it was; nothing is dropped", async () => {
  equal((await pmsOf(W1.id)).id, P2.id);
  equal(await treeOf(P2.id), ["X"]);
  equal(await counts(), was);
  equal((await one("SELECT count(*)::int AS n FROM wbs_activity WHERE progress = 40")).n, was.acts, "the activities keep their progress");
});

test("on a database already past 083 it does nothing", async () => {
  const pmsBefore = (await one("SELECT count(*)::int AS n FROM eps_pms")).n;
  await db.query("DELETE FROM schema_migrations WHERE version = '082z_split_version_trees'");
  await migrate(db);
  equal((await one("SELECT count(*)::int AS n FROM eps_pms")).n, pmsBefore);
  assert((await one("SELECT count(*)::int AS n FROM schema_migrations WHERE version = '082z_split_version_trees'")).n === 1, "recorded again");
});

await run();
await db.close();
