#!/usr/bin/env node
/**
 * The daily report's catalogue (lib/reports/catalog.mjs, lib/db/repos/catalog.mjs)
 * and its import from the old Access daily report: people without the
 * man-hour unit they never were, units written one way, duplicates once,
 * crews kept but not offered, what cannot be decided named — and an import
 * that never overwrites what the project corrected.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { readFile } from "node:fs/promises";

process.env.PGLITE_DIR = await scratchDir("catalog-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const cat = await import("../../lib/db/repos/catalog.mjs");
const { fromAccess, normUnit } = await import("../../lib/reports/catalog.mjs");

const db = await getDb();
const me = await projects.ensureUser(db, { subject: "kc|cat" });
const proj = await projects.createProject(db, { code: "CAT", name: "C", ownerUserId: me.id });
const P = proj.id;
const G = [{ id_grp: "103", grop_nm_pa: "لوله کشی" }, { id_grp: "210", grop_nm_pa: "ماشین آلات" }, { id_grp: "411", grop_nm_pa: "مصالح مصرفی" }];
const row = (id, semat, type, unit, id_group = "103", semat_en = "") => ({ id_shogl: id, semat, type, unit, id_group, semat_en });

test("from the Access list: people lose the man-hour unit, units are written one way, duplicates are kept once", async () => {
  const r = fromAccess([
    row(1, "جوشکار آرگون", "نیروی انسانی", "نفرساعت", "103", "TIG Welder"), row(2, "فیتر", "نیروی انسانی", "نفر ساعت"),
    row(3, " جوشکار  آرگون ", "نیروی انسانی", "نفرساعت"),
    row(4, "جرثقیل 50 تن", "ماشین آلات", "دستگاه / روز", "210"), row(5, "الکترود E7018", "مصالح", "کیلوگرم", "411"),
  ], G);
  equal(r.items.map((i) => [i.kind, i.name, i.unit, i.discipline]), [
    ["person", "جوشکار آرگون", null, "لوله کشی"], ["person", "فیتر", null, "لوله کشی"],
    ["machine", "جرثقیل 50 تن", "دستگاه/روز", "ماشین آلات"], ["material", "الکترود E7018", "کیلوگرم", "مصالح مصرفی"]]);
  equal([r.duplicates, r.problems.length], [1, 0], "«نفر ساعت» is the same man-hour unit, not a problem");
  equal(normUnit("متر  مربع / روز"), "متر مربع/روز");
});

test("what cannot be decided is named, not fixed: a crew is not offered, a machine in m² is flagged, an unknown kind is left out", async () => {
  const r = fromAccess([
    row(1, "گروه منصوری (فنس)", "نیروی انسانی", "نفرساعت"), row(2, "مسئول سیویل", "نیروی انسانی", "دستگاه/روز"),
    row(3, "قالب چوبی", "ماشین آلات", "متر مربع", "210"), row(4, "چیز", "نامعلوم", "عدد"), row(5, "سیمان", "مصالح", "", "411"),
  ], G);
  const crew = r.items.find((i) => i.name.startsWith("گروه"));
  equal([crew.kind, crew.active], ["person", false]);
  for (const re of [/گروه منصوری.*غیرفعال/, /مسئول سیویل.*دستگاه\/روز/, /قالب چوبی.*بررسی شود/, /نوع «نامعلوم» شناخته نشد/, /سیمان.*واحد ندارد/]) {
    assert(r.problems.some((p) => re.test(p)), `expected a problem matching ${re}`);
  }
  equal(r.items.find((i) => i.name === "قالب چوبی").unit, "متر مربع", "kept as it was — a person decides");
  equal(r.skipped, 1);
});

test("the real list from daily report.accdb: every item has a kind, no person has a unit, every material has one", async () => {
  const c = JSON.parse(await readFile(new URL("../../data/daily-access/catalog.json", import.meta.url), "utf8"));
  equal(c.items.length, 460);
  equal(c.items.filter((i) => i.kind === "person" && i.unit).length, 0);
  equal(c.items.filter((i) => ["consumable", "material", "project_material"].includes(i.kind) && !i.unit).length, 0);
  equal(new Set(c.items.map((i) => `${i.kind}|${i.name}`)).size, c.items.length, "each item once");
});

test("an import adds what is new and never overwrites the project's correction; a typed material needs its unit", async () => {
  await withProject(db, P, async () => {
    const items = [{ kind: "person", name: "فیتر", discipline: "لوله کشی" }, { kind: "material", name: "الکترود E7018", unit: "کیلوگرم" }];
    equal(await cat.importCatalog(db, { projectId: P, items, source: "test" }), { added: 2, kept: 0 });
    const [fitter] = (await cat.listCatalog(db, { projectId: P })).filter((i) => i.name === "فیتر");
    await cat.setCatalogActive(db, { projectId: P, id: fitter.id, active: false });
    equal(await cat.importCatalog(db, { projectId: P, items: [...items, { kind: "machine", name: "بیل مکانیکی" }], source: "test" }), { added: 1, kept: 2 });
    equal((await cat.listCatalog(db, { projectId: P })).find((i) => i.name === "فیتر").active, false, "the project's choice stands");
    equal((await cat.listCatalog(db, { projectId: P, activeOnly: true })).map((i) => i.name).sort(), ["الکترود E7018", "بیل مکانیکی"]);
    await throws(() => cat.addCatalogItem(db, { projectId: P, kind: "material", name: "سیمان", userId: me.id }), "واحد لازم دارد");
    await throws(() => cat.addCatalogItem(db, { projectId: P, kind: "person", name: "فیتر" }), "در فهرست هست");
    const s = await cat.addCatalogItem(db, { projectId: P, kind: "person", name: "ریگر", unit: "نفرساعت" });
    equal([s.source, s.unit], ["manual", null], "a person is counted in heads, whatever was typed as a unit");
  });
});

await run();
