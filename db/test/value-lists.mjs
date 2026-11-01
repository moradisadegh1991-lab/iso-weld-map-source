#!/usr/bin/env node
/**
 * A project's picking lists (owner's request of 2026-11-01; migration 096,
 * lib/register/value-lists.mjs, lib/db/repos/value-lists.mjs): every column
 * of the isometric page's tables that is not a number, a measure or free
 * text is picked from a list — the built-in values until the project saves
 * its own; the engine's own set (Shop / Field) is fixed; a value read off a
 * sheet that the list lacks is kept, never changed.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { LISTS, COLUMN_LIST, cleanItems, resolveLists, optionsFor } from "../../lib/register/value-lists.mjs";

test("a list as saved: trimmed, spaces folded, no empties, a repeat (case aside) kept once, in the order given", () => {
  equal(cleanItems("material", ["  A106-B ", "a106-b", "", "A312  TP304", null, "A333-6"]), ["A106-B", "A312 TP304", "A333-6"]);
  equal(cleanItems("wps", []), [], "an empty list is a list");
});

test("refused: an unknown list, the engine's fixed list, a value too long, too many values", async () => {
  await throws(() => cleanItems("colour", ["red"]), "ناشناخته");
  await throws(() => cleanItems("loc", ["Shop", "Field", "Yard"]), "ثابت");
  await throws(() => cleanItems("wps", ["x".repeat(81)]), "بلندتر");
  await throws(() => cleanItems("wps", Array.from({ length: 301 }, (_, i) => `W${i}`)), "حداکثر");
  await throws(() => cleanItems("wps", "WPS-01"), "فهرست");
});

test("every list: the project's own where saved, else the built-in values; the fixed list never the project's", () => {
  const r = resolveLists({ wps: ["WPS-01"], loc: ["Yard"], jointType: [] });
  equal([r.wps.items, r.wps.own], [["WPS-01"], true]);
  equal([r.loc.items, r.loc.own], [["Shop", "Field"], false]);
  equal([r.jointType.items, r.jointType.own], [[], true], "a list the project emptied stays empty: its column is typed");
  equal(r.schedule.items, LISTS.schedule.items);
});

test("a value the list lacks is offered first and kept; one it has, in another case, is not added again", () => {
  equal(optionsFor(["BW", "SW"], "Socolet"), { options: ["BW", "SW"], extra: "Socolet" });
  equal(optionsFor(["BW", "SW"], "bw").extra, null);
  equal(optionsFor(["BW"], "").extra, null);
});

test("what is picked and what is typed: lists for kinds of thing, none for numbers, measures and free text", () => {
  for (const c of ["loc", "kind", "nps", "schedule", "material", "wps", "group", "diam", "testFluid", "ndt", "pwht"]) assert(COLUMN_LIST[c], `${c} picks`);
  for (const c of ["no", "spool", "ref", "note", "description", "stockCode", "pt", "qty", "lengthMm", "designPressure", "testPressure", "designTemp", "insulationThk", "drawingNo", "rev", "sheet", "lineNo"])
    equal(COLUMN_LIST[c], undefined, `${c} is typed`);
  for (const l of Object.values(COLUMN_LIST)) assert(LISTS[l], `${l} is a list`);
});

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("value-lists-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const vl = await import("../../lib/db/repos/value-lists.mjs");
const db = await getDb();
const U = await projects.ensureUser(db, { subject: "kc|vl-a", displayName: "a" });
const U2 = await projects.ensureUser(db, { subject: "kc|vl-b", displayName: "b" });
const P = (await projects.createProject(db, { code: "VL1", name: "A", ownerUserId: U.id })).id;
const P2 = (await projects.createProject(db, { code: "VL2", name: "B", ownerUserId: U2.id })).id;

test("saved whole and read back; saved again it replaces; reset gives the built-in values back", async () => {
  await withProject(db, P, async () => {
    equal((await vl.valueLists(db, { projectId: P })).wps.items, [], "no WPS until the project names its own");
    equal(await vl.saveValueList(db, { projectId: P, key: "wps", items: ["WPS-01", "WPS-02", "wps-01"], userId: U.id }), ["WPS-01", "WPS-02"]);
    await vl.saveValueList(db, { projectId: P, key: "material", items: ["A106-B", "A333-6"], userId: U.id });
    let l = await vl.valueLists(db, { projectId: P });
    equal([l.wps.items, l.material.items, l.material.own], [["WPS-01", "WPS-02"], ["A106-B", "A333-6"], true]);
    await vl.saveValueList(db, { projectId: P, key: "wps", items: ["WPS-03"], userId: U.id });
    equal((await vl.valueLists(db, { projectId: P })).wps.items, ["WPS-03"]);
    equal(await vl.resetValueList(db, { projectId: P, key: "material" }), true);
    l = await vl.valueLists(db, { projectId: P });
    equal([l.material.items, l.material.own], [LISTS.material.items, false]);
    await throws(() => vl.saveValueList(db, { projectId: P, key: "loc", items: ["Yard"] }), "ثابت");
  });
});

test("another project sees none of it, and cannot write into this one's", async () => {
  await withProject(db, P2, async () => {
    equal((await vl.valueLists(db, { projectId: P2 })).wps.items, []);
    equal((await db.query("SELECT count(*)::int AS n FROM value_list")).rows[0].n, 0);
    await throws(() => vl.saveValueList(db, { projectId: P, key: "wps", items: ["X"] }), "");
  });
  await withProject(db, P, async () => equal((await vl.valueLists(db, { projectId: P })).wps.items, ["WPS-03"]));
});

await run();
