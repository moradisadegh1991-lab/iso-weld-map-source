#!/usr/bin/env node
/**
 * Keys and numbers: every table has a primary key the database makes, and
 * every record the platform issues takes its number from its form's code
 * and the form's next number — left empty, never typed twice, never issued
 * twice (lib/numbering.mjs, lib/db/repos/numbering.mjs).
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";

process.env.PGLITE_DIR = await scratchDir("num-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const civil = await import("../../lib/db/repos/civil.mjs");
const hse = await import("../../lib/db/repos/hse.mjs");
const quality = await import("../../lib/db/repos/quality.mjs");
const num = await import("../../lib/db/repos/numbering.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "NUM", name: "N", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "OTH", name: "O", ownerUserId: alice.id });
const P = proj.id;
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

// Tables whose one-column key is deliberately NOT generated, and why.
const KEYED_BY_PARENT = {
  asset_master: "one row per tag: the tag's own id",
  calibration_plan: "one row per instrument: the instrument's id",
  foundation_spec: "one row per foundation tag",
  structure_spec: "one row per structure tag",
  user_credential: "one row per user",
  field_op: "the device's own operation id — the idempotency key of offline sync",
  schema_migrations: "the migration's file name",
};

test("every table has a primary key, and a one-column key is made by the database", async () => {
  const { rows } = await db.query(`
    SELECT c.relname AS t,
      (SELECT array_agg(a.attname::text) FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = c.oid AND i.indisprimary) AS pk,
      (SELECT bool_or(d.adbin IS NOT NULL) FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE i.indrelid = c.oid AND i.indisprimary) AS generated
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`);
  assert(rows.length > 100, `tables: ${rows.length}`);
  const noKey = rows.filter((r) => !r.pk).map((r) => r.t);
  equal(noKey, [], "tables without a primary key");
  const typed = rows.filter((r) => r.pk.length === 1 && !r.generated && !KEYED_BY_PARENT[r.t]).map((r) => r.t);
  equal(typed, [], "one-column keys nobody generates");
});

test("a form's numbers: its code and the next number, one after another", async () => {
  await withProject(db, P, async () => {
    equal(await num.peekNumber(db, { projectId: P, form: "permit" }), "PTW-0001");
    equal(await num.peekNumber(db, { projectId: P, form: "permit" }), "PTW-0001", "looking does not use a number up");
    equal(await num.nextNumber(db, { projectId: P, form: "permit" }), "PTW-0001");
    equal(await num.nextNumber(db, { projectId: P, form: "permit" }), "PTW-0002");
    equal(await num.nextNumber(db, { projectId: P, form: "ir" }), "IR-00001", "each form has its own sequence and width");
    const many = await Promise.all([1, 2, 3, 4].map(() => num.nextNumber(db, { projectId: P, form: "po" })));
    equal(new Set(many).size, 4, `saves at the same moment get different numbers: ${many}`);
  });
  await withProject(db, other.id, async () => {
    equal(await num.nextNumber(db, { projectId: other.id, form: "permit" }), "PTW-0001", "another project counts from its own start");
  });
});

test("left empty, a record takes the form's number; typed, it keeps its own — which is then never issued again", async () => {
  await withProject(db, P, async () => {
    const sub = await spine.upsertSubsystem(db, { projectId: P, code: "70-01", systemCode: "70", name: "S" });
    const f1 = await civil.upsertFoundation(db, { projectId: P, tagNo: "FDN-1", subsystemId: sub.id, concreteClass: "C30", fcMpa: 30 });
    const f2 = await civil.upsertFoundation(db, { projectId: P, tagNo: "FDN-2", subsystemId: sub.id, concreteClass: "C30", fcMpa: 30 });
    const f3 = await civil.upsertFoundation(db, { projectId: P, tagNo: "FDN-3", subsystemId: sub.id, concreteClass: "C30", fcMpa: 30 });
    const pour = (tagId, pourNo) => civil.recordPour(db, { projectId: P, tagId, pourNo, pouredOn: daysAgo(5), volumeM3: 3, concreteClass: "C30", fcMpa: 30 });
    equal((await pour(f1.id, "")).pour_no, "PC-0001");
    equal((await pour(f2.id, "PC-0002")).pour_no, "PC-0002", "a typed number is kept");
    equal((await pour(f3.id, null)).pour_no, "PC-0003", "…and skipped by the sequence, not issued twice");

    const p = await hse.requestPermit(db, { projectId: P, type: "cold", area: "Unit 70", description: "Scaffold",
      validFrom: new Date().toISOString(), validTo: new Date(Date.now() + 4 * 3600_000).toISOString(), userId: alice.id });
    equal(p.permit_no, "PTW-0003", "the permit continues the permit sequence");

    const n1 = await quality.raiseNcr(db, { projectId: P, title: "Weld profile", description: "Undercut", severity: "minor", raisedOn: daysAgo(1), userId: alice.id });
    equal(n1.ncr_no, "NCR-0001");
    const pa = await quality.raisePunch(db, { projectId: P, subsystemId: sub.id, category: "A", description: "Guard", raisedOn: daysAgo(1), userId: alice.id });
    const pb = await quality.raisePunch(db, { projectId: P, subsystemId: sub.id, category: "B", description: "Label", raisedOn: daysAgo(1), userId: alice.id });
    equal([pa.punch_no, pb.punch_no], ["70-01-P001", "70-01-P002"], "a punch list is numbered per subsystem");
  });
});

test("a project names its forms its own way; a bad code is refused; an empty one returns to the default", async () => {
  await withProject(db, P, async () => {
    await num.setFormCode(db, { projectId: P, form: "pour", code: "NUM-PC", userId: alice.id });
    equal(await num.peekNumber(db, { projectId: P, form: "pour" }), "NUM-PC-0004", "the sequence carries on under the new code");
    await throws(() => num.setFormCode(db, { projectId: P, form: "pour", code: "کد فارسی" }), "INVALID_INPUT");
    await throws(() => num.setFormCode(db, { projectId: P, form: "nope", code: "X" }), "INVALID_INPUT");
    const list = await num.setFormCode(db, { projectId: P, form: "pour", code: "" });
    const pour = list.find((f) => f.form === "pour");
    equal([pour.code, pour.own, pour.issued], ["PC", false, 3]);
  });
});

await run();
