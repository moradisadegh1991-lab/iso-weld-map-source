#!/usr/bin/env node
/**
 * MTO revisions (audit 2026-11-03, Phase 2 finding C1): a requirement is "MTO rev 2", then "MTO rev 3". The shortage
 * used to add every source of an item, so rev 3 counted on top of rev 2. Now the latest revision of each MTO series
 * is the requirement; the older ones stay on record, marked superseded.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";

import { mtoSeries, compareRev, activeRequirements } from "../../lib/warehouse/mto.mjs";

test("a source's series and revision are read off its end; one without a revision is its own series", () => {
  equal(mtoSeries("MTO rev 2"), { series: "mto", rev: "2" });
  equal(mtoSeries("Piping MTO Rev.B"), { series: "piping mto", rev: "B" });
  equal(mtoSeries("civil-mto-r10"), { series: "civil-mto", rev: "10" });
  equal(mtoSeries("Site request 17"), { series: "site request 17", rev: null });
  equal(mtoSeries(""), { series: "", rev: null });
});

test("revisions order as documents do: letters before numbers, 10 after 9, Z before AA", () => {
  const sorted = ["2", "A", "10", "B", "9", "0", "AA", "Z"].sort(compareRev);
  equal(sorted, ["A", "B", "Z", "AA", "0", "2", "9", "10"]);
  equal(compareRev("3", "3"), 0);
});

test("the active rows are the latest of each series plus every row without a revision", () => {
  const rows = [{ source: "MTO rev 1", qty: 1 }, { source: "MTO rev 3", qty: 3 }, { source: "MTO rev 2", qty: 2 }, { source: "Other rev A", qty: 7 }, { source: "Adhoc", qty: 5 }];
  const { active, superseded } = activeRequirements(rows);
  equal(active.map((r) => r.source).sort(), ["Adhoc", "MTO rev 3", "Other rev A"]);
  equal(superseded.map((r) => r.source).sort(), ["MTO rev 1", "MTO rev 2"]);
});

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("mto-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const P = (await projects.createProject(db, { code: "MTO", name: "M", ownerUserId: alice.id })).id;
const inP = (fn) => withProject(db, P, fn);
const required = async (id) => inP(async () => (await wh.shortages(db, { projectId: P })).find((x) => x.itemId === id));

test("a later MTO revision replaces the earlier one in the shortage; it does not add to it", async () => {
  const item = await inP(() => wh.upsertItem(db, { projectId: P, code: "PIPE-M1", description: "pipe", category: "pipe", uom: "m" }));
  await inP(() => wh.setRequirement(db, { projectId: P, itemId: item.id, qty: 100, source: "MTO rev 2" }));
  await inP(() => wh.setRequirement(db, { projectId: P, itemId: item.id, qty: 120, source: "MTO rev 3" }));
  const s = await required(item.id);
  equal(s.required, 120, "rev 3 is the requirement, rev 2 is not on top of it");
  assert(/rev 3/.test(s.sources) && !/rev 2/.test(s.sources), `sources: ${s.sources}`);
  assert(/rev 2/.test(s.supersededSources.join(" ")), "the older revision is shown as superseded, not lost");
});

test("different MTOs of one item add; each is its own series", async () => {
  const item = await inP(() => wh.upsertItem(db, { projectId: P, code: "PIPE-M2", description: "pipe", category: "pipe", uom: "m" }));
  await inP(() => wh.setRequirement(db, { projectId: P, itemId: item.id, qty: 100, source: "Piping MTO rev 1" }));
  await inP(() => wh.setRequirement(db, { projectId: P, itemId: item.id, qty: 40, source: "Civil MTO rev 1" }));
  await inP(() => wh.setRequirement(db, { projectId: P, itemId: item.id, qty: 110, source: "Piping MTO rev 2" }));
  equal((await required(item.id)).required, 150, "the piping MTO at rev 2 (110) plus the civil MTO at rev 1 (40)");
});

test("a source that is not a revision is its own series and always counts", async () => {
  const item = await inP(() => wh.upsertItem(db, { projectId: P, code: "PIPE-M3", description: "pipe", category: "pipe", uom: "m" }));
  await inP(() => wh.setRequirement(db, { projectId: P, itemId: item.id, qty: 10, source: "Site request 17" }));
  await inP(() => wh.setRequirement(db, { projectId: P, itemId: item.id, qty: 5, source: "Site request 18" }));
  equal((await required(item.id)).required, 15);
});

await run();
