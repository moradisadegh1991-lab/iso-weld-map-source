#!/usr/bin/env node
/**
 * Allocation transitions under real concurrency (Phase 1, persistence unification).
 *
 *   PG_TEST_URL=postgres://user:pass@host:5432/emptydb  node … db/test/bom-allocation-concurrency.mjs   (part of `npm run db:test:pg`)
 *
 * A line is locked (SELECT … FOR UPDATE) before its status is read, so two requests for it are taken in turn and the second is
 * judged on what the first left. Proved by what is LEFT in the tables: one winner, one event, a status that matches the
 * history. PGlite is one connection and cannot show this; without PG_TEST_URL the file says SKIPPED and exits 0 — that is NOT a pass.
 */
import { test, run, assert, equal } from "./harness.mjs";

const URL = process.env.PG_TEST_URL;
if (!URL) { console.log("bom-allocation-concurrency: SKIPPED — PG_TEST_URL is not set; nothing here ran against PostgreSQL."); process.exit(0); }
process.env.DATABASE_URL = URL;
const { createClient } = await import("../../lib/db/client.mjs");
const { migrate } = await import("../../lib/db/migrate.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const docs = await import("../../lib/db/repos/documents.mjs");
const ll = await import("../../lib/db/repos/line-list.mjs");
const al = await import("../../lib/db/repos/bom-allocation.mjs");
const { ledgerDemands } = await import("../../lib/register/bom-allocation.mjs");

const db = await createClient({ url: URL });
await migrate(db);
const U = await projects.ensureUser(db, { subject: "kc|bac" });
const P = (await projects.createProject(db, { code: "BAC1", name: "A", ownerUserId: U.id })).id;
const inP = (fn) => withProject(db, P, fn);
const verdict = (p) => p.then(() => "ok", (e) => (e?.status === 409 || e?.status === 404 ? "refused" : `ERROR:${e?.message}`));

const BOM = [{ pt: 2, group: "FLANGES", description: "FLANGE WELD NECK RF 300# A105 BW", diam: "4", qty: 40, qtyUnit: "pcs" }];
const W = (id, no, c1) => ({ id, kind: "weld-shop", no, attrs: { c1 } });
let docSeq = 0;
/** A fresh revision with `n` reserved weld lines. */
async function reserved(n) {
  const { document: D } = await docs.registerDocument(db, { projectId: P, docNo: `ISO-C-${++docSeq}`, revision: "0", sheetNo: "1/1", fileSha256: String(docSeq).padStart(64, "c"), storageUri: `local://c${docSeq}` });
  await inP(() => ll.saveIsoBom(db, { projectId: P, documentId: D.id, bom: BOM, createdBy: U.id }));
  const items = Array.from({ length: n }, (_, i) => W(`w${i}`, String(i + 1), "2"));
  await inP(() => db.transaction((tx) => al.syncAllocations(tx, { projectId: P, documentId: D.id, demands: ledgerDemands(items, BOM), userId: U.id })));
  const lines = (await inP(() => al.availability(db, { projectId: P, documentId: D.id }))).lines;
  return { D, lines, items };
}
const go = (D, id, action, reason = null) => inP(() => al.transition(db, { projectId: P, documentId: D.id, allocationId: id, action, reason: reason || (action === "install" ? null : "because"), userId: U.id }));
const events = (D, id) => inP(async () => (await db.query("SELECT event FROM bom_allocation_event WHERE document_id = $1 AND allocation_id = $2 ORDER BY at, id", [D.id, id])).rows.map((r) => r.event));
const status = (id) => inP(async () => (await db.query("SELECT status FROM bom_allocation WHERE id = $1", [id])).rows[0].status);

test("C1. an install and a release of the same reserved line at once: exactly one wins, one event, status matching the history", async () => {
  const { D, lines } = await reserved(12);
  const results = await Promise.all(lines.map(async (l) => {
    const v = await Promise.all([verdict(go(D, l.id, "install")), verdict(go(D, l.id, "release"))]);
    return { l, v };
  }));
  for (const { l, v } of results) {
    assert(!v.some((x) => x.startsWith("ERROR")), JSON.stringify(v));
    equal(v.filter((x) => x === "ok").length, 1, `line ${l.id}: ${JSON.stringify(v)}`);
    const ev = await events(D, l.id), st = await status(l.id);
    equal(ev.length, 2, `reserve + one transition: ${ev}`);
    assert((st === "installed" && ev[1] === "install") || (st === "released" && ev[1] === "release"), `status ${st} does not match its history ${ev}`);
  }
});

test("C2. two installs of one line at once: one installs, the other is told the line is no longer reserved", async () => {
  const { D, lines } = await reserved(10);
  for (const l of lines) {
    const v = await Promise.all([verdict(go(D, l.id, "install")), verdict(go(D, l.id, "install"))]);
    equal(v.slice().sort(), ["ok", "refused"], JSON.stringify(v));
    equal(await events(D, l.id), ["reserve", "install"]);
  }
});

test("C3. two returns of one installed line at once: one returns it", async () => {
  const { D, lines } = await reserved(8);
  for (const l of lines) await go(D, l.id, "install");
  for (const l of lines) {
    const v = await Promise.all([verdict(go(D, l.id, "return")), verdict(go(D, l.id, "return"))]);
    equal(v.slice().sort(), ["ok", "refused"], JSON.stringify(v));
    equal(await events(D, l.id), ["reserve", "install", "return"]);
    equal(await status(l.id), "returned");
  }
});

test("C4. a transition and a save of the same sheet at once: never both 'released by the save' and 'installed'", async () => {
  const { D, lines, items } = await reserved(10);
  const saveWithout = (id) => inP(() => db.transaction((tx) => al.syncAllocations(tx, { projectId: P, documentId: D.id,
    demands: ledgerDemands(items.filter((m) => m.id !== id), BOM), userId: U.id })));
  for (const l of lines) {
    const v = await Promise.all([verdict(go(D, l.id, "install")), verdict(saveWithout(l.ownerRef))]);
    assert(!v.some((x) => x.startsWith("ERROR")), JSON.stringify(v));
    const ev = await events(D, l.id), st = await status(l.id);
    assert(ev.filter((e) => e === "install").length + ev.filter((e) => e === "release").length <= 1, `contradictory history: ${ev}`);
    assert((st === "installed" && ev.includes("install")) || (st === "released" && ev.includes("release")) || st === "reserved", `status ${st} vs ${ev}`);
    // put the sheet back for the next line: the released lines come back as reserved ones
    await inP(() => db.transaction((tx) => al.syncAllocations(tx, { projectId: P, documentId: D.id, demands: ledgerDemands(items, BOM), userId: U.id }))).catch(() => {});
  }
});

test("C5. the BOM-row ceiling stays the database's: 40 flanges, 8 lines taking 5 each, installs at once, never more than 40", async () => {
  const { D, lines } = await reserved(8);
  await Promise.all(lines.map((l) => verdict(go(D, l.id, "install"))));
  const used = await inP(async () => Number((await db.query("SELECT coalesce(sum(qty),0) AS n FROM bom_allocation WHERE document_id = $1 AND status IN ('reserved','installed')", [D.id])).rows[0].n));
  assert(used <= 40, `used ${used}`);
});

await run();
await db.close();
