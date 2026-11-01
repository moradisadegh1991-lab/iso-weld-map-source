#!/usr/bin/env node
/**
 * A drawing style's template (migration 095, lib/db/repos/drawing-styles.mjs):
 * where a style prints each value, marked once by a person — known values
 * only, each a box inside the page and big enough for a value, saved with
 * the words of the sheet it was marked on, and the project's own.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { cleanFields, forReader } from "../../lib/db/repos/drawing-styles.mjs";

test("a template's cells: known values only, four fractions of the page each, corners in either order, not a dot", async () => {
  equal(cleanFields({ testPressure: { box: [0.35, 0.88, 0.32, 0.87] } }), { testPressure: { box: [0.32, 0.87, 0.35, 0.88] } });
  await throws(() => cleanFields({ weldCount: { box: [0.1, 0.1, 0.2, 0.2] } }), "ناشناخته");
  await throws(() => cleanFields({ rev: { box: [0.1, 0.1, 1.2, 0.2] } }), "بین ۰ و ۱");
  await throws(() => cleanFields({ rev: { box: [0.1, 0.1, 0.2] } }), "چهار عدد");
  await throws(() => cleanFields({ rev: { box: [0.5, 0.5, 0.501, 0.501] } }), "کوچک");
  await throws(() => cleanFields({}), "هیچ خانه‌ای");
});

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("styles-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const ds = await import("../../lib/db/repos/drawing-styles.mjs");
const db = await getDb();
const U = await projects.ensureUser(db, { subject: "kc|ds-a", displayName: "a" });
const U2 = await projects.ensureUser(db, { subject: "kc|ds-b", displayName: "b" });
const P = (await projects.createProject(db, { code: "DS1", name: "A", ownerUserId: U.id })).id;
const P2 = (await projects.createProject(db, { code: "DS2", name: "B", ownerUserId: U2.id })).id;
const FP = ["CONDITION", "DESIGN", "OPERATING", "PRESS", "TEMP", "FLUID", "INSULATION", "PAINT", "CLASS"];
const BOX = { testPressure: { box: [0.3354, 0.8778, 0.3641, 0.8911] }, lineNo: { box: [0.7746, 0.9068, 0.9875, 0.9334] } };

test("saved by name: its fingerprint the sheet's words (letters only, each once), saving the name again replaces its cells", async () => {
  await withProject(db, P, async () => {
    const a = await ds.saveStyle(db, { projectId: P, name: "CWR Andimeshk", fingerprint: [...FP, "press", "11.1", "A0"], fields: BOX, userId: U.id });
    equal(a.fingerprint, FP, "upper case, letters only, three or more, no repeats");
    equal(Object.keys(a.fields).sort(), ["lineNo", "testPressure"]);
    await ds.saveStyle(db, { projectId: P, name: "CWR Andimeshk", fingerprint: FP, fields: { rev: { box: [0.47, 0.88, 0.49, 0.89] } }, userId: U.id });
    const all = await ds.listStyles(db, { projectId: P });
    equal([all.length, Object.keys(all[0].fields)], [1, ["rev"]]);
    equal(Object.keys(ds.forReader(all)[0]).sort(), ["fields", "fingerprint", "id", "name"]);
  });
});

test("no name, or no words of the sheet it was marked on (no later sheet could be matched to it): refused", async () => {
  await withProject(db, P, async () => {
    await throws(() => ds.saveStyle(db, { projectId: P, name: " ", fingerprint: FP, fields: BOX }), "نام");
    await throws(() => ds.saveStyle(db, { projectId: P, name: "X", fingerprint: ["AB", "12"], fields: BOX }), "واژه‌های جدول عنوان");
  });
});

test("a project's templates are its own; one deleted is gone", async () => {
  equal((await withProject(db, P2, () => ds.listStyles(db, { projectId: P2 }))).length, 0);
  await withProject(db, P, async () => {
    const [s] = await ds.listStyles(db, { projectId: P });
    equal(await withProject(db, P2, () => ds.deleteStyle(db, { projectId: P2, id: s.id })), false, "not from another project");
    equal(await ds.deleteStyle(db, { projectId: P, id: s.id }), true);
    equal((await ds.listStyles(db, { projectId: P })).length, 0);
  });
});

await run();
