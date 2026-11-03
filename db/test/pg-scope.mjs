#!/usr/bin/env node
/**
 * Project scope on a REAL node-postgres pool (lib/db/client.mjs, lib/db/scope.mjs) — audit 2026-11-03.
 *
 * PGlite is one connection and cannot show what a pool does, so none of this is proved by the PGlite suites; it runs
 * only against a PostgreSQL server:
 *
 *   PG_TEST_URL=postgres://user:pass@host:5432/emptydb  npm run db:test:pg
 *
 * (an empty database the user owns and may SET ROLE app_rw in; the migrations are applied here). Without PG_TEST_URL
 * it says so and exits 0 — it is NOT a pass of anything. In CI it runs against a postgres service container.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";

const URL = process.env.PG_TEST_URL;
if (!URL) {
  console.log("pg-scope: SKIPPED — PG_TEST_URL is not set; nothing here was run against node-postgres.");
  process.exit(0);
}
process.env.DATABASE_URL = URL;
const { createClient } = await import("../../lib/db/client.mjs");
const { migrate } = await import("../../lib/db/migrate.mjs");
const { withProject, withoutProject, outsideScope } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const fld = await import("../../lib/db/repos/field.mjs");

const db = await createClient({ url: URL });
assert(db.driver === "pg", "this test is for node-postgres");
await migrate(db);

const alice = await projects.ensureUser(db, { subject: "kc|pgscope-alice", displayName: "Alice" });
const A = (await projects.createProject(db, { code: "PGA", name: "A", ownerUserId: alice.id })).id;
const B = (await projects.createProject(db, { code: "PGB", name: "B", ownerUserId: alice.id })).id;
const who = () => db.query("SELECT current_user AS u, current_setting('app.project_id', true) AS p, pg_backend_pid() AS pid, txid_current_if_assigned() AS tx");

test("1-2. forty requests on two projects at once, on one pool: every query runs as app_rw under its own project", async () => {
  let wrong = 0, total = 0;
  await Promise.all(Array.from({ length: 40 }, async (_, i) => {
    const mine = i % 2 ? A : B;
    await withProject(db, mine, async () => {
      for (let k = 0; k < 8; k++) {
        await new Promise((r) => setTimeout(r, Math.random() * 12));
        const { rows: [r] } = await who(); total++;
        if (r.u !== "app_rw" || r.p !== mine) wrong++;
      }
    });
  }));
  equal([total, wrong], [320, 0]);
});

test("a block's parallel queries and its transactions all run on its one connection, under its scope", async () => {
  await withProject(db, A, async () => {
    const rs = (await Promise.all([who(), who(), who(), who()])).map((x) => x.rows[0]);
    equal(new Set(rs.map((r) => r.pid)).size, 1, "one connection");
    assert(rs.every((r) => r.u === "app_rw" && r.p === A));
    const outer = (await who()).rows[0].pid;
    await db.transaction(async () => {
      const r = (await who()).rows[0];
      equal([r.pid, r.u, r.p], [outer, "app_rw", A], "the restricted role and the project hold inside the transaction");
    });
  });
});

test("3. project A cannot read or write project B's rows, and the database says so, not the WHERE clause", async () => {
  await withProject(db, A, () => db.query("INSERT INTO line (project_id, line_no, piping_class) VALUES ($1,'A-1','A1')", [A]));
  await withProject(db, B, () => db.query("INSERT INTO line (project_id, line_no, piping_class) VALUES ($1,'B-1','A1')", [B]));
  await withProject(db, A, async () => {
    equal((await db.query("SELECT line_no FROM line")).rows.map((r) => r.line_no), ["A-1"], "only its own rows, with no filter");
    equal((await db.query("UPDATE line SET piping_class = 'X' WHERE line_no = 'B-1'")).rowCount, 0, "cannot modify B's");
    equal((await db.query("DELETE FROM line WHERE line_no = 'B-1'")).rowCount, 0, "cannot delete B's");
    await throws(() => db.query("INSERT INTO line (project_id, line_no, piping_class) VALUES ($1,'B-2','A1')", [B]), "row-level security", "cannot write into B");
  });
  await withProject(db, B, async () => equal((await db.query("SELECT line_no, piping_class FROM line")).rows, [{ line_no: "B-1", piping_class: "A1" }]));
  await withoutProject(db, async () => equal((await db.query("SELECT count(*)::int AS n FROM line")).rows[0].n, 0, "no project bound reads nothing"));
});

test("5-6. after a block — success, error, rollback — no connection of the pool keeps a scope or a role", async () => {
  const idle = async () => new Set((await Promise.all(Array.from({ length: 12 }, () =>
    db.query("SELECT pg_sleep(0.04), current_user AS u, current_setting('app.project_id', true) AS p")))).map((r) => `${r.rows[0].u}|${r.rows[0].p || ""}`));
  const login = (await db.query("SELECT session_user AS s")).rows[0].s;
  await withProject(db, A, async () => {});
  equal([...await idle()], [`${login}|`], "after success");
  await throws(() => withProject(db, A, async () => { throw new Error("boom"); }), "boom");
  equal([...await idle()], [`${login}|`], "after an error");
  await throws(() => withProject(db, A, () => db.transaction(async () => { await db.query("SELECT 1"); throw new Error("rolled back"); })), "rolled back");
  equal([...await idle()], [`${login}|`], "after a rollback");
});

test("7. a failed statement does not poison the request after it, nor the next request", async () => {
  await withProject(db, A, async () => {
    await throws(() => db.query("SELECT * FROM table_that_is_not_there"), "table_that_is_not_there");
    equal((await db.query("SELECT 1 AS ok")).rows[0].ok, 1, "the block goes on");
    await db.query("INSERT INTO line (project_id, line_no, piping_class) VALUES ($1,'A-keep','A1')", [A]);
    await throws(() => db.query("INSERT INTO line (project_id, line_no, piping_class) VALUES ($1,'A-keep','A1')", [A]), "duplicate");
    equal((await db.query("SELECT count(*)::int AS n FROM line WHERE line_no = 'A-keep'")).rows[0].n, 1, "what was written before the failure is kept");
  });
  await withProject(db, B, async () => equal((await who()).rows[0].p, B));
});

test("8. a transaction inside a transaction is a savepoint: the inner fails alone, the outer commits the rest", async () => {
  await withProject(db, A, async () => {
    await db.transaction(async () => {
      await db.query("INSERT INTO line (project_id, line_no, piping_class) VALUES ($1,'A-outer','A1')", [A]);
      const tx1 = (await who()).rows[0].tx;
      await throws(() => db.transaction(async () => {
        await db.query("INSERT INTO line (project_id, line_no, piping_class) VALUES ($1,'A-inner','A1')", [A]);
        equal((await who()).rows[0].tx, tx1, "the same transaction, not a second one");
        throw new Error("inner fails");
      }), "inner fails");
    });
    equal((await db.query("SELECT line_no FROM line WHERE line_no IN ('A-outer','A-inner') ORDER BY 1")).rows.map((r) => r.line_no), ["A-outer"]);
  });
});

test("work started inside a block and left running does not borrow its connection (outsideScope)", async () => {
  let seen;
  await withProject(db, A, async () => {
    const background = outsideScope(async () => { await new Promise((r) => setTimeout(r, 30)); seen = (await who()).rows[0]; });
    await new Promise((r) => setTimeout(r, 5));
    await background;
  });
  assert(seen.u !== "app_rw" || seen.p === "", `detached work ran as ${seen.u} under ${JSON.stringify(seen.p)} — not the block's connection or scope`);
});

test("12. the same field operation sent twice at once is applied once; both answers are the same record", async () => {
  const uid = globalThis.crypto.randomUUID();
  const tag = await withProject(db, A, async () => (await db.query(
    "INSERT INTO tag (project_id, tag_no, discipline, kind) VALUES ($1,'PGT-1','equipment','rotating') RETURNING id", [A])).rows[0]);
  const member = { role: "admin", areas: [] };
  const today = new Date().toISOString().slice(0, 10);
  const op = { opId: uid, kind: "tag_step", projectId: A, capturedAt: new Date().toISOString(), payload: { tagId: tag.id, code: "grout", doneOn: today } };
  const results = await Promise.all(Array.from({ length: 6 }, () => fld.applyOps(db, { projectId: A, userId: alice.id, membership: member, ops: [op] })));
  const rs = results.flat();
  equal(rs.length, 6);
  const applied = rs.filter((r) => r.status === "applied" && !r.duplicate).length;
  assert(applied <= 1, `applied ${applied} times`);
  assert(rs.every((r) => r.status === "applied" || r.status === "retry"), `unexpected: ${JSON.stringify(rs.map((r) => r.status))}`);
  const stored = await withProject(db, A, async () => (await db.query("SELECT count(*)::int AS n FROM field_op WHERE op_id = $1", [uid])).rows[0].n);
  equal(stored, 1, "one record of the operation");
  const steps = await withProject(db, A, async () => (await db.query("SELECT count(*)::int AS n FROM field_op WHERE op_id = $1 AND status = 'applied'", [uid])).rows[0].n);
  assert(steps <= 1);
  const again = await fld.applyOps(db, { projectId: A, userId: alice.id, membership: member, ops: [op] });
  equal([again[0].status, again[0].duplicate], ["applied", true], "a later copy gets the stored outcome");
});

await run();
await db.close();
