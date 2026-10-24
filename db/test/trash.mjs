#!/usr/bin/env node
/**
 * The project's trash (migration 089, lib/db/repos/trash.mjs): what is
 * deleted is kept for 30 days with the rows it owned, comes back whole
 * under its own ids, is refused back when it no longer fits, and is
 * never seen from another project.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("trash-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const contractors = await import("../../lib/db/repos/contractors.mjs");
const sw = await import("../../lib/db/repos/hse-safework.mjs");
const { removeRecord } = await import("../../lib/db/repos/removal.mjs");
const trash = await import("../../lib/db/repos/trash.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "TR", name: "T", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "TR2", name: "O", ownerUserId: alice.id });
const P = proj.id;
const inP = (fn) => withProject(db, P, fn);
const count = async (table, where, p) => (await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, p)).rows[0].n;

test("a deleted draft JSA is in the trash with its steps, and comes back whole under its own ids", async () => {
  await inP(async () => {
    const jsa = await sw.createJsa(db, { projectId: P, jsaNo: "JSA-1", title: "Lift the pump", userId: alice.id });
    for (const seq of [1, 2]) await sw.saveJsaStep(db, { projectId: P, jsaId: jsa.id, seq, step: `Step ${seq}`, hazard: "Drop", controls: "Tag line", likelihood: 2, severity: 3 });
    const steps = (await db.query("SELECT id, step FROM hse_jsa_step WHERE jsa_id = $1 ORDER BY seq", [jsa.id])).rows;
    const { trashId } = await removeRecord(db, { projectId: P, entity: "hse-jsa", id: jsa.id, userId: alice.id });
    equal(await count("hse_jsa", "id = $1", [jsa.id]) + await count("hse_jsa_step", "jsa_id = $1", [jsa.id]), 0, "gone from the register");

    const [item] = await trash.listTrash(db);
    equal([item.id, item.entity, item.record_id, item.owned_rows], [trashId, "hse-jsa", jsa.id, 2]);
    assert(/Lift the pump/.test(item.label) || /JSA-1/.test(item.label), `recognisable: ${item.label}`);
    const days = (new Date(item.expires_at) - new Date(item.deleted_at)) / 86_400_000;
    equal(Math.round(days), trash.TRASH_DAYS, "it goes for good after 30 days");

    await trash.restoreItem(db, { id: trashId });
    const back = (await db.query("SELECT id, step FROM hse_jsa_step WHERE jsa_id = $1 ORDER BY seq", [jsa.id])).rows;
    equal(back, steps, "the same steps, the same ids");
    equal((await db.query("SELECT title, status FROM hse_jsa WHERE id = $1", [jsa.id])).rows[0], { title: "Lift the pump", status: "draft" });
    equal((await trash.listTrash(db)).length, 0, "restored, it leaves the trash");
  });
});

test("a restore that no longer fits is refused with the reason, and the item stays", async () => {
  await inP(async () => {
    const c = await contractors.upsertContractor(db, { projectId: P, code: "TYPO", name: "Entered by mistake" });
    const { trashId } = await removeRecord(db, { projectId: P, entity: "contractor", id: c.id, userId: alice.id });
    await contractors.upsertContractor(db, { projectId: P, code: "TYPO", name: "Entered again" });
    await throws(() => trash.restoreItem(db, { id: trashId }), "CONFLICT");
    equal((await trash.listTrash(db)).map((t) => t.id), [trashId]);
    equal(await count("contractor", "code = 'TYPO'", []), 1, "nothing half-restored");
    await trash.purgeItem(db, { id: trashId });
    equal((await trash.listTrash(db)).length, 0, "let go of now");
    await throws(() => trash.restoreItem(db, { id: trashId }), "NOT_FOUND");
  });
});

test("after 30 days an item leaves the trash for good", async () => {
  await inP(async () => {
    const c = await contractors.upsertContractor(db, { projectId: P, code: "OLD", name: "Old" });
    await removeRecord(db, { projectId: P, entity: "contractor", id: c.id, userId: alice.id });
    const in29 = new Date(Date.now() + 29 * 86_400_000).toISOString();
    equal((await trash.listTrash(db, { now: in29 })).length, 1, "still there on day 29");
    const in31 = new Date(Date.now() + 31 * 86_400_000).toISOString();
    equal((await trash.listTrash(db, { now: in31 })).length, 0, "gone on day 31");
    equal(await count("trash_item", "true", []), 0);
  });
});

test("another project's trash is not seen, restored or let go", async () => {
  let id;
  await inP(async () => {
    const c = await contractors.upsertContractor(db, { projectId: P, code: "MINE", name: "Mine" });
    ({ trashId: id } = await removeRecord(db, { projectId: P, entity: "contractor", id: c.id, userId: alice.id }));
  });
  await withProject(db, other.id, async () => {
    equal((await trash.listTrash(db)).length, 0);
    await throws(() => trash.restoreItem(db, { id }), "NOT_FOUND");
    await throws(() => trash.purgeItem(db, { id }), "NOT_FOUND");
  });
  await inP(async () => equal((await trash.listTrash(db)).length, 1));
});

test("every kind a register lets go has a name in each language of the trash page", async () => {
  const { ENTITIES } = await import("../../lib/db/repos/removal.mjs");
  const desk = (await import("../../lib/i18n/sections/desk.mjs")).default;
  for (const k of Object.keys(ENTITIES)) for (const lang of ["fa", "en", "ar"]) assert(desk[lang][`tr.e.${k}`], `${lang}: tr.e.${k}`);
});

// ── the routes ───────────────────────────────────────────────────────────
const records = await import("../../app/api/records/route.js");
const route = await import("../../app/api/trash/route.js");
const viewer = await projects.ensureUser(db, { subject: "kc|victor" });
await projects.addMember(db, { projectId: P, userId: viewer.id, role: "viewer" });
const req = (url, method, as, body) => new Request(url, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" },
  body: body ? JSON.stringify(body) : undefined });

test("the routes: a delete lands in the trash with who did it; a viewer sees it but may not bring it back", async () => {
  const c = await inP(() => contractors.upsertContractor(db, { projectId: P, code: "VIA-API", name: "Via the route" }));
  let r = await records.DELETE(req("http://x/api/records", "DELETE", "kc|alice", { projectId: P, entity: "contractor", id: c.id }));
  equal(r.status, 200);
  const { trashId } = (await r.json()).removed;
  r = await route.GET(req(`http://x/api/trash?projectId=${P}`, "GET", "kc|victor"));
  const seen = (await r.json()).items.find((t) => t.id === trashId);
  equal([seen.entity, seen.mayRestore, seen.deleted_by_name !== undefined], ["contractor", false, true]);
  r = await route.POST(req("http://x/api/trash", "POST", "kc|victor", { projectId: P, kind: "restore", id: trashId }));
  equal(r.status, 403, "a viewer may not restore");
  r = await route.POST(req("http://x/api/trash", "POST", "kc|alice", { projectId: P, kind: "restore", id: trashId }));
  equal(r.status, 200);
  await inP(async () => equal(await count("contractor", "id = $1", [c.id]), 1, "back"));
  r = await route.POST(req("http://x/api/trash", "POST", "kc|alice", { projectId: P, kind: "nuke", id: trashId }));
  equal(r.status, 400);
});

await run();
