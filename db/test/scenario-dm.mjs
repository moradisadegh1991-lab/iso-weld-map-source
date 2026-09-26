#!/usr/bin/env node
/**
 * The DM-water pump scenario, played end to end on an empty database:
 * every step a person is told to do must be doable, and every refusal the
 * guide promises must happen, for the reason it gives
 * (lib/scenario/dm-pump.mjs).
 */
import { test, run, assert, equal } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "scenario-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const { STEPS, PHASES, PEOPLE, SCENARIO } = await import("../../lib/scenario/dm-pump.mjs");
const { context, play, startFor } = await import("../../lib/scenario/runner.mjs");

const db = await getDb();
const users = {};
for (const p of Object.values(PEOPLE)) users[p.key] = (await projects.ensureUser(db, { subject: `kc|${p.key}` })).id;
const proj = await projects.createProject(db, { code: SCENARIO.code, name: SCENARIO.name, ownerUserId: users.pm });
for (const p of Object.values(PEOPLE)) await projects.addMember(db, { projectId: proj.id, userId: users[p.key], role: p.role });

test("every step is written for a person: who, where, what, and what to expect", async () => {
  const ids = new Set();
  for (const s of STEPS) {
    assert(!ids.has(s.id), `step ${s.id} appears once`); ids.add(s.id);
    assert(PHASES.some(([k]) => k === s.phase), `${s.id}: phase ${s.phase} is listed`);
    assert(PEOPLE[s.who], `${s.id}: «${s.who}» is one of the people`);
    assert(s.title && s.where && s.do?.length && s.expect?.length, `${s.id}: title, where, do and expect`);
    assert(typeof s.run === "function", `${s.id}: run`);
  }
});

test("the whole job plays through, refusals included", async () => {
  const x = context({ db, projectId: proj.id, users, start: startFor(150) });
  await play(x, STEPS);
  for (const s of STEPS.filter((y) => y.negative)) assert(x.refusals[s.id]?.length, `${s.id}: the refusal it promises happened`);
  console.log(`       ${STEPS.length} steps, ${Object.values(x.refusals).flat().length} refusals`);
});

await run();
