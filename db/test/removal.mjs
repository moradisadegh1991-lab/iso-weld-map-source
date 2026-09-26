#!/usr/bin/env node
/**
 * Deleting a register row: only one nothing points at, never a signed or
 * approved record, never across projects, and never by following a
 * cascade that would take evidence with it.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "removal-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const contractors = await import("../../lib/db/repos/contractors.mjs");
const hse = await import("../../lib/db/repos/hse.mjs");
const sw = await import("../../lib/db/repos/hse-safework.mjs");
const pf = await import("../../lib/db/repos/performance.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const { ENTITIES, USED_IN, dependents, removalBlocker, removeRecord } = await import("../../lib/db/repos/removal.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const bob = await projects.ensureUser(db, { subject: "kc|bob" });
const proj = await projects.createProject(db, { code: "DEL", name: "D", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "DEL2", name: "O", ownerUserId: alice.id });
const P = proj.id;
const inP = (fn) => withProject(db, P, fn);
let ids;
const count = async (table, id) => (await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE id = $1`, [id])).rows[0].n;

test("every deletable kind names a real table and the action it needs", async () => {
  for (const [k, e] of Object.entries(ENTITIES)) {
    const { rows } = await db.query("SELECT to_regclass($1) AS t", [e.table]);
    assert(rows[0].t, `${k}: table ${e.table} exists`);
    assert(e.need && e.title, `${k}: action and title`);
    for (const o of e.owned || []) assert((await db.query("SELECT to_regclass($1) AS t", [o])).rows[0].t, `${k}: owned ${o} exists`);
  }
});

test("every table that can hold a deletable record is named in words", async () => {
  for (const [k, e] of Object.entries(ENTITIES)) {
    const { rows } = await db.query(
      "SELECT DISTINCT conrelid::regclass::text AS t FROM pg_constraint WHERE contype = 'f' AND confrelid = $1::regclass", [e.table]);
    for (const { t } of rows) assert(USED_IN[t] || (e.owned || []).includes(t), `${k}: «${t}» has no words in USED_IN`);
  }
});

test("an unused contractor goes; one holding a package, or hours, stays and says where it is used", async () => {
  await inP(async () => {
    const spare = await contractors.upsertContractor(db, { projectId: P, code: "TYPO", name: "Entered by mistake" });
    equal(await removalBlocker(db, { entity: "contractor", id: spare.id }), null);
    await removeRecord(db, { entity: "contractor", id: spare.id });
    equal(await count("contractor", spare.id), 0);

    const busy = await contractors.upsertContractor(db, { projectId: P, code: "C-01", name: "Busy", disciplines: ["piping"] });
    await contractors.upsertPackage(db, { projectId: P, contractorId: busy.id, code: "PK-1", discipline: "piping" });
    await hse.recordManhours(db, { projectId: P, contractorId: busy.id, workDate: "2026-09-01", hours: 800 });
    const why = await removalBlocker(db, { entity: "contractor", id: busy.id });
    assert(/پکیج کاری/.test(why) && /نفرساعت/.test(why), why);
    assert(!/contract_package|hse_manhours/.test(why), "the reason is in words, not table names");
    await throws(() => removeRecord(db, { entity: "contractor", id: busy.id }), "IN_USE");
    equal(await count("contractor", busy.id), 1, "the cascade to its package and SET NULL on its hours never ran");
    equal((await db.query("SELECT count(*)::int AS n FROM hse_manhours WHERE contractor_id = $1", [busy.id])).rows[0].n, 1);
  });
});

test("a person with a card stays; an unused one goes", async () => {
  await inP(async () => {
    const carded = await sw.upsertPerson(db, { projectId: P, idNo: "P-1", fullName: "Rigger One" });
    await sw.addCompetence(db, { projectId: P, personId: carded.id, kind: "induction", issuedOn: "2026-01-01", noExpiry: true });
    assert(/کارت صلاحیت/.test(await removalBlocker(db, { entity: "hse-person", id: carded.id })));
    const typo = await sw.upsertPerson(db, { projectId: P, idNo: "P-2", fullName: "Typo" });
    await removeRecord(db, { entity: "hse-person", id: typo.id });
    equal(await count("hse_person", typo.id), 0);
  });
});

test("a draft JSA goes with its steps; an approved one is never deleted", async () => {
  await inP(async () => {
    const draft = await sw.createJsa(db, { projectId: P, jsaNo: "JSA-9", title: "Draft", userId: alice.id });
    await sw.saveJsaStep(db, { projectId: P, jsaId: draft.id, seq: 1, step: "Lift", hazard: "Drop", controls: "Tag line", likelihood: 2, severity: 3 });
    equal(await removalBlocker(db, { entity: "hse-jsa", id: draft.id }), null, "its own steps do not hold it");
    await removeRecord(db, { entity: "hse-jsa", id: draft.id });
    equal((await db.query("SELECT count(*)::int AS n FROM hse_jsa_step WHERE jsa_id = $1", [draft.id])).rows[0].n, 0);

    const done = await sw.createJsa(db, { projectId: P, jsaNo: "JSA-10", title: "Approved", userId: alice.id });
    await sw.saveJsaStep(db, { projectId: P, jsaId: done.id, seq: 1, step: "Lift", hazard: "Drop", controls: "Tag line", likelihood: 1, severity: 2 });
    // Approval itself is hse-safework's to test; here only its outcome matters.
    await db.query("UPDATE hse_jsa SET status = 'approved', approved_by = $2, approved_on = current_date WHERE id = $1", [done.id, bob.id]);
    const why = await removalBlocker(db, { entity: "hse-jsa", id: done.id });
    assert(/رویژن جدید/.test(why), why);
    await throws(() => removeRecord(db, { entity: "hse-jsa", id: done.id }), "IN_USE");
    equal(await count("hse_jsa", done.id), 1);
  });
});

test("a guarantee with a result stays; an unsigned test goes, a signed one never", async () => {
  await inP(async () => {
    const { rows: [u] } = await db.query("INSERT INTO unit (project_id, code, name) VALUES ($1,'21','C') RETURNING *", [P]);
    const sub = await spine.upsertSubsystem(db, { projectId: P, code: "21-01", systemCode: "21", unitId: u.id });
    await db.query("INSERT INTO rfsu_certificate (project_id, subsystem_id, snapshot, signed_by, accepted_by, accepted_at) VALUES ($1,$2,'{}',$3,$4,now())",
      [P, sub.id, alice.id, bob.id]);
    const g = await pf.upsertGuarantee(db, { projectId: P, code: "PG-1", parameter: "Capacity", unitId: u.id, uom: "t/h",
      direction: "min", guaranteedValue: 10, basis: "Annex G" });
    const idle = await pf.upsertGuarantee(db, { projectId: P, code: "PG-2", parameter: "Typo", uom: "x", direction: "min",
      guaranteedValue: 1, basis: "none" });
    const t = await pf.recordTest(db, { projectId: P, testNo: "PT-1", unitId: u.id, startedAt: "2026-09-01T00:00:00Z",
      endedAt: "2026-09-02T00:00:00Z", userId: alice.id });
    await pf.recordResult(db, { projectId: P, testId: t.id, guaranteeId: g.id, measured: 11 });
    assert(/نتیجهٔ آزمون عملکرد/.test(await removalBlocker(db, { entity: "guarantee", id: g.id })));
    await removeRecord(db, { entity: "guarantee", id: idle.id });

    const wrong = await pf.recordTest(db, { projectId: P, testNo: "PT-2", unitId: u.id, startedAt: "2026-09-03T00:00:00Z",
      endedAt: "2026-09-04T00:00:00Z", userId: alice.id });
    await pf.recordResult(db, { projectId: P, testId: wrong.id, guaranteeId: g.id, measured: 1 });
    equal(await removalBlocker(db, { entity: "perf-test", id: wrong.id }), null, "an unsigned test's own results do not hold it");
    await removeRecord(db, { entity: "perf-test", id: wrong.id });
    equal(await count("performance_test", wrong.id), 0);
    equal((await db.query("SELECT count(*)::int AS n FROM performance_result WHERE test_id = $1", [wrong.id])).rows[0].n, 0);

    await pf.signTest(db, { projectId: P, testId: t.id, userId: alice.id });
    const why = await removalBlocker(db, { entity: "perf-test", id: t.id });
    assert(/امضاشده ثابت است/.test(why), `signed comes before «used by»: ${why}`);
    await throws(() => removeRecord(db, { entity: "perf-test", id: t.id }), "IN_USE");
    ids = { t: t.id, g: g.id };
  });
  // …and the database says the same to anything that skips the check.
  await throws(() => inP(() => db.query("DELETE FROM performance_test WHERE id = $1", [ids.t])), "signed; it is never deleted");
  await throws(() => inP(() => db.query("DELETE FROM performance_guarantee WHERE id = $1", [ids.g])), "violates");
  await inP(async () => equal(await count("performance_test", ids.t) + await count("performance_guarantee", ids.g), 2));
});

test("nothing outside the list, no malformed id, and not another project's row", async () => {
  await inP(async () => {
    await throws(() => removalBlocker(db, { entity: "project", id: P }), "INVALID_INPUT");
    await throws(() => removeRecord(db, { entity: "weld", id: P }), "INVALID_INPUT");
    await throws(() => removalBlocker(db, { entity: "contractor", id: "1; DROP TABLE contractor" }), "INVALID_INPUT");
    for (const entity of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      await throws(() => removalBlocker(db, { entity, id: P }), "INVALID_INPUT", `«${entity}» is not a kind of record`);
    }
  });
  let theirs;
  await withProject(db, other.id, async () => {
    theirs = await contractors.upsertContractor(db, { projectId: other.id, code: "THEIRS", name: "Other project" });
  });
  await inP(async () => {
    await throws(() => removeRecord(db, { entity: "contractor", id: theirs.id }), "NOT_FOUND");
  });
  await withProject(db, other.id, async () => equal(await count("contractor", theirs.id), 1));
});

test("references are read from the catalogue, so a table added later is counted too", async () => {
  const c = await inP(() => contractors.upsertContractor(db, { projectId: P, code: "NEWREF", name: "N" }));
  await db.query("CREATE TABLE later_table (id serial PRIMARY KEY, contractor_id uuid REFERENCES contractor(id) ON DELETE CASCADE)");
  await db.query("GRANT SELECT ON later_table TO app_rw");
  await db.query("INSERT INTO later_table (contractor_id) VALUES ($1)", [c.id]);
  await inP(async () => {
    const d = await dependents(db, "contractor", c.id);
    equal(d.map((x) => x.table), ["later_table"]);
    assert(/رکورد دیگر/.test(await removalBlocker(db, { entity: "contractor", id: c.id })));
  });
  await db.query("DROP TABLE later_table");
});

// ── the route: who may ask, and what a refusal looks like ───────────────

const route = await import("../../app/api/records/route.js");
const viewer = await projects.ensureUser(db, { subject: "kc|victor" });
await projects.addMember(db, { projectId: P, userId: viewer.id, role: "viewer" });
const req = (method, as, body) => new Request(
  method === "GET" ? `http://x/api/records?${new URLSearchParams(body)}` : "http://x/api/records",
  { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body) });

test("the route: a viewer is refused before anything is read; the reason reaches the page; a delete deletes", async () => {
  const c = await inP(() => contractors.upsertContractor(db, { projectId: P, code: "VIA-API", name: "Via the route" }));
  const busy = await inP(async () => (await db.query("SELECT id FROM contractor WHERE code = 'C-01'")).rows[0]);

  let r = await route.DELETE(req("DELETE", "kc|victor", { projectId: P, entity: "contractor", id: c.id }));
  equal(r.status, 403, "a viewer may not delete");
  r = await route.GET(req("GET", "kc|victor", { projectId: P, entity: "contractor", id: c.id }));
  equal(r.status, 403, "…nor ask what uses a record");
  await projects.ensureUser(db, { subject: "kc|mallory" });
  r = await route.DELETE(req("DELETE", "kc|mallory", { projectId: P, entity: "contractor", id: c.id }));
  equal(r.status, 404, "to someone outside the project, the project is not there");

  r = await route.GET(req("GET", "kc|alice", { projectId: P, entity: "contractor", id: busy.id }));
  const b = await r.json();
  equal(r.status, 200);
  assert(/پکیج کاری/.test(b.blocker), b.blocker);
  r = await route.DELETE(req("DELETE", "kc|alice", { projectId: P, entity: "contractor", id: busy.id }));
  equal(r.status, 409, "in use is a conflict, with its reason");
  assert(/پکیج کاری/.test((await r.json()).error));

  r = await route.DELETE(req("DELETE", "kc|alice", { projectId: P, entity: "project", id: P }));
  equal(r.status, 400, "a kind not on the list");
  r = await route.DELETE(req("DELETE", "kc|alice", { projectId: P, entity: "constructor", id: P }));
  equal(r.status, 400, "…nor a name from the object's prototype");

  equal((await (await route.GET(req("GET", "kc|alice", { projectId: P, entity: "contractor", id: c.id }))).json()).blocker, null);
  r = await route.DELETE(req("DELETE", "kc|alice", { projectId: P, entity: "contractor", id: c.id }));
  equal(r.status, 200);
  await inP(async () => equal(await count("contractor", c.id), 0));
});

await run();
