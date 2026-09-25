#!/usr/bin/env node
/**
 * The readiness loader: a primed lookup answers exactly what a single
 * query would, tag by tag, and costs a fixed number of queries instead of
 * nine per tag.
 */
import { test, run, assert, equal } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// This file measures the loader itself; the cross-check mode computes every
// status twice on purpose and would defeat what is measured here.
delete process.env.TAGSTATUS_CROSSCHECK;
process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "ldr-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const civil = await import("../../lib/db/repos/civil.mjs");
const acts = await import("../../lib/db/repos/activities.mjs");
const { createLoader } = await import("../../lib/db/loader.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "LDR", name: "L", ownerUserId: alice.id });
const P = proj.id;
const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
const tagIds = [];

await withProject(db, P, async () => {
  await projects.updateProjectProfile(db, { projectId: P, patch: { concrete_curing_days: 7 } });
  const subs = [await spine.upsertSubsystem(db, { projectId: P, code: "21-01" }),
    await spine.upsertSubsystem(db, { projectId: P, code: "22-01" })];
  for (let i = 0; i < 24; i++) {
    const eq = await spine.upsertTag(db, { projectId: P, tagNo: `P-${100 + i}`, discipline: "equipment",
      kind: i % 3 ? "rotating" : "static", subsystemId: subs[i % 2].id });
    tagIds.push(eq.id);
    if (i % 4 === 0) {
      await acts.recordActivity(db, { projectId: P, tagId: eq.id, code: "set", doneAt: daysAgo(2), userId: alice.id }).catch(() => {});
    }
    if (i % 2 === 0) {
      const f = await civil.upsertFoundation(db, { projectId: P, tagNo: `FDN-P-${100 + i}`, carriesTagId: eq.id,
        concreteClass: "C30", fcMpa: 30, volumeM3: 20 });
      tagIds.push(f.id);
      for (const c of ["excavation", "blinding", "rebar", "embedments", "pre_pour"]) {
        await acts.recordActivity(db, { projectId: P, tagId: f.id, code: c, doneAt: daysAgo(30), userId: alice.id });
      }
      // Two pours whose number order is the reverse of their date order: the
      // later pour decides curing, whichever number it carries.
      await civil.recordPour(db, { projectId: P, tagId: f.id, pourNo: `PC-${i}-2`, pouredOn: daysAgo(20),
        volumeM3: 10, concreteClass: "C30", fcMpa: 30, userId: alice.id });
      await civil.recordPour(db, { projectId: P, tagId: f.id, pourNo: `PC-${i}-1`, pouredOn: daysAgo(3 + (i % 5)),
        volumeM3: 10, concreteClass: "C30", fcMpa: 30, userId: alice.id });
    }
  }
});

test("a primed loader answers every tag exactly as single queries do", async () => {
  await withProject(db, P, async () => {
    const L = createLoader(db, P);
    await L.prime(tagIds);
    for (const id of tagIds) {
      const plain = await acts.tagStatus(db, { projectId: P, tagId: id, loader: createLoader(db, P) });
      const fast = await acts.tagStatus(db, { projectId: P, tagId: id, loader: L });
      equal(JSON.stringify(fast), JSON.stringify(plain), `tag ${id}`);
    }
    equal(await acts.tagStatus(db, { projectId: P, tagId: tagIds[1], loader: L })
      === await acts.tagStatus(db, { projectId: P, tagId: tagIds[1], loader: L }), true, "worked out once per loader");
    const fdn = (await acts.tagStatus(db, { projectId: P, tagId: tagIds[1], loader: L })).steps.find((s) => s.code === "curing");
    equal(fdn.status, "in_progress", "the later pour (3 days ago) decides curing, not the higher number");
  });
});

test("the board costs a fixed number of queries, not nine a tag, and judges a foundation once", async () => {
  await withProject(db, P, async () => {
    const orig = db.query.bind(db);
    let n = 0; const seen = {};
    db.query = async (sql, params) => { n++; const k = sql.replace(/\s+/g, " ").slice(0, 60); seen[k] = (seen[k] || 0) + 1; return orig(sql, params); };
    try {
      for (const id of tagIds) await acts.tagStatus(db, { projectId: P, tagId: id });
      const single = n;
      const pourQ = () => Object.entries(seen).filter(([k]) => k.startsWith("SELECT * FROM concrete_pour WHERE tag_id"))
        .reduce((a, [, v]) => a + v, 0);
      equal(pourQ(), 24, "one tag at a time, each of the 12 foundations is judged twice: itself, and under its machine");
      n = 0; for (const k of Object.keys(seen)) delete seen[k];
      await acts.blockedTags(db, { projectId: P });
      const primed = n;
      assert(primed * 3 < single, `primed ${primed} queries vs ${single} one tag at a time`);
      equal(pourQ(), 0, "primed: pours come from one query, and each foundation is judged once");
    } finally { db.query = orig; }
  });
});

await run();
