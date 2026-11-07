#!/usr/bin/env node
/**
 * The allocation history stands on its own (migration 104): each event carries what it was about, the allocation row may go
 * (removed or replaced) without the history going or going mute, nobody can change or delete an event, and an event cannot be
 * written for an allocation of another project or drawing revision. Also migration 104 over data.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { readdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../../lib/db/client.mjs";
import { migrate } from "../../lib/db/migrate.mjs";

const ALL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const upTo103 = await scratchDir("mig104-files-");
for (const f of (await readdir(ALL)).filter((f) => f.endsWith(".sql")).sort()) if (f < "104") await copyFile(path.join(ALL, f), path.join(upTo103, f));
const fresh = async () => {
  const db = process.env.DATABASE_URL ? await createClient({ url: process.env.DATABASE_URL }) : await createClient({ dataDir: await scratchDir("mig104-db-") });
  if (process.env.DATABASE_URL) await db.exec("DROP SCHEMA IF EXISTS reporting CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  return db;
};
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0];

/** Two projects, each with a drawing revision, a BOM row and an allocation with two events. */
async function world(db) {
  const user = await one(db, "INSERT INTO app_user (subject) VALUES ('kc|h104') RETURNING id");
  const w = { user: user.id };
  for (const k of ["A", "B"]) {
    const proj = await one(db, "INSERT INTO project (code, name) VALUES ($1,$1) RETURNING id", [k]);
    const doc = await one(db, `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'D','0',$2,'local://x') RETURNING id`, [proj.id, k.repeat(64)]);
    await db.query("INSERT INTO iso_bom_row (project_id, document_id, pt, description, qty, qty_unit, alloc_cap) VALUES ($1,$2,2,'FLANGE',2,'pcs',2)", [proj.id, doc.id]);
    const al = await one(db, `INSERT INTO bom_allocation (project_id, document_id, pt, owner_kind, owner_ref, owner_no, qty, unit, status) VALUES ($1,$2,2,'weld','m-1','W-01',1,'pcs','installed') RETURNING id`, [proj.id, doc.id]);
    for (const [ev, sb, sa] of [["reserve", null, "reserved"], ["install", "reserved", "installed"]])
      await db.query("INSERT INTO bom_allocation_event (project_id, document_id, allocation_id, event, qty_after, status_before, status_after, by_user) VALUES ($1,$2,$3,$4,1,$5,$6,$7)", [proj.id, doc.id, al.id, ev, sb, sa, user.id]);
    w[k] = { project: proj.id, document: doc.id, allocation: al.id };
  }
  return w;
}

test("104 over data: existing events are filled in from their allocation, nothing else about them changes", async () => {
  const db = await fresh();
  await migrate(db, { dir: upTo103 });
  const w = await world(db);
  const before = (await db.query("SELECT * FROM bom_allocation_event ORDER BY project_id, at, id")).rows;
  const ran = await migrate(db);
  assert(ran.includes("104_bom_allocation_event_snapshot"), JSON.stringify(ran));   // later migrations may follow it
  const after = (await db.query("SELECT * FROM bom_allocation_event ORDER BY project_id, at, id")).rows;
  equal(after.length, before.length);
  for (let i = 0; i < after.length; i++) {
    const { owner_kind, owner_ref, owner_no, pt, unit, ...rest } = after[i];
    const { owner_kind: _a, owner_ref: _b, owner_no: _c, pt: _d, unit: _e, ...was } = before[i];
    equal(rest, was, "every column the event had is as it was");
    equal([owner_kind, owner_ref, owner_no, pt, unit], ["weld", "m-1", "W-01", 2, "pcs"]);
  }
  void w;
  await db.close();
});

test("104 stops and changes nothing if an event's allocation cannot be read", async () => {
  const db = await fresh();
  await migrate(db, { dir: upTo103 });
  const w = await world(db);
  // an event of project A naming an allocation of project B (the old key allowed it)
  await db.query("INSERT INTO bom_allocation_event (project_id, document_id, allocation_id, event, status_after) VALUES ($1,$2,$3,'reserve','reserved')", [w.A.project, w.A.document, w.B.allocation]);
  const e = await throws(() => migrate(db), "could not be read");
  assert(e.message.length > 0);
  equal((await one(db, "SELECT count(*)::int AS n FROM bom_allocation_event")).n, 5, "no event removed");
  equal((await db.query("SELECT 1 FROM schema_migrations WHERE version LIKE '104%'")).rows.length, 0);
  await db.close();
});

test("after 104: the history is read from the events; deleting or replacing the allocation leaves it whole and readable", async () => {
  const db = await fresh();
  await migrate(db);
  const w = await world(db);
  const { withProject } = await import("../../lib/db/scope.mjs");
  const al = await import("../../lib/db/repos/bom-allocation.mjs");
  const inA = (fn) => withProject(db, w.A.project, fn);
  const hist = () => inA(() => al.history(db, { projectId: w.A.project, documentId: w.A.document }));
  const live = await hist();
  equal(live.map((e) => [e.event, e.pt, e.ownerKind, e.ownerNo]), [["install", 2, "weld", "W-01"], ["reserve", 2, "weld", "W-01"]]);
  // the operational row is removed …
  await db.query("DELETE FROM bom_allocation WHERE id = $1", [w.A.allocation]);
  equal((await db.query("SELECT count(*)::int AS n FROM bom_allocation_event WHERE allocation_id = $1", [w.A.allocation])).rows[0].n, 2, "the events stay");
  equal(await hist(), live, "and the history reads the same without it");
  // … and replaced by another line for the same owner: the old events still say what they were about
  await db.query(`INSERT INTO bom_allocation (project_id, document_id, pt, owner_kind, owner_ref, owner_no, qty, unit, status) VALUES ($1,$2,2,'weld','m-1','W-01-renumbered',1,'pcs','reserved')`, [w.A.project, w.A.document]);
  equal((await hist()).map((e) => e.ownerNo), live.map((e) => e.ownerNo), "an event keeps the owner number it was made under");
  await db.close();
});

test("after 104: an event is written for an allocation of its own project and revision only, and the snapshot is the database's", async () => {
  const db = await fresh();
  await migrate(db);
  const w = await world(db);
  const { withProject } = await import("../../lib/db/scope.mjs");
  const ins = (scope, project, document, allocation, extra = "") => withProject(db, scope, () => db.query(
    `INSERT INTO bom_allocation_event (project_id, document_id, allocation_id, event, status_after${extra ? ", owner_kind, owner_ref, pt, unit" : ""}) VALUES ($1,$2,$3,'adjust','reserved'${extra ? ",'spool','FORGED',99,'m'" : ""}) RETURNING owner_kind, owner_ref, pt, unit`, [project, document, allocation]));
  await throws(() => ins(w.B.project, w.B.project, w.B.document, w.A.allocation), "is not an allocation of this project");
  await throws(() => ins(w.A.project, w.A.project, w.B.document, w.A.allocation), "is not an allocation of this project");
  await throws(() => ins(w.A.project, w.B.project, w.B.document, w.B.allocation), "is not an allocation of this project");   // project A's scope cannot even see B's line
  const ok = (await ins(w.A.project, w.A.project, w.A.document, w.A.allocation, "forged")).rows[0];
  equal([ok.owner_kind, ok.owner_ref, ok.pt, ok.unit], ["weld", "m-1", 2, "pcs"], "the forged snapshot was overwritten");
  await db.close();
});

test("after 104: events are append-only — no UPDATE (owner included), no DELETE or TRUNCATE for the application role", async () => {
  const db = await fresh();
  await migrate(db);
  const w = await world(db);
  const { withProject } = await import("../../lib/db/scope.mjs");
  const inA = (fn) => withProject(db, w.A.project, fn);
  const e1 = await throws(() => db.query("UPDATE bom_allocation_event SET reason = 'x' WHERE project_id = $1", [w.A.project]), "");
  assert(/append-only/.test(e1.message), `owner: ${e1.message}`);
  for (const sql of ["UPDATE bom_allocation_event SET reason = 'x'", "UPDATE bom_allocation_event SET pt = 3", "DELETE FROM bom_allocation_event", "TRUNCATE bom_allocation_event"])
    await throws(() => inA(() => db.query(sql)), "permission denied");
  equal((await one(db, "SELECT count(*)::int AS n FROM bom_allocation_event")).n, 4);
  await db.close();
});

await run();
