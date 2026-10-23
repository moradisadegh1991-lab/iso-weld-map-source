#!/usr/bin/env node
/**
 * Columns a project adds to the platform's tables (owner's requirements of
 * 2026-10-22, item 7; migration 085): a heading and a type per table, the
 * project's for every member; values kept by the row's key in the column's
 * type — a value the type does not hold is refused, never guessed; the admin
 * defines, a member who is not a viewer fills in; another project sees none.
 * And the Excel templates a person builds (migration 086): the columns
 * kept under a name, the template's own rule checked; removed by its maker
 * or the admin.
 */
import { test, run, equal, throws, scratchDir } from "./harness.mjs";
import { valueOf } from "../../lib/db/repos/custom-fields.mjs";

test("a value as its column keeps it: numbers to ten decimals, dates, yes/no, a choice of the list; blank is no value", () => {
  equal(valueOf({ data_type: "number" }, "1,234.12345678901"), { value: "1234.123456789" });
  equal(valueOf({ data_type: "date" }, "2026-10-22"), { value: "2026-10-22" });
  equal(valueOf({ data_type: "bool" }, "true"), { value: "true" });
  equal(valueOf({ data_type: "list", options: ["A", "B"] }, "B"), { value: "B" });
  equal(valueOf({ data_type: "text" }, "  "), { value: null });
  for (const [f, v] of [[{ data_type: "number" }, "abc"], [{ data_type: "date" }, "1405/08/01"], [{ data_type: "bool" }, "maybe"], [{ data_type: "list", options: ["A"] }, "Z"]]) {
    equal(!!valueOf(f, v).problem, true, `${f.data_type}: «${v}» refused`);
  }
});

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("custom-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const cf = await import("../../lib/db/repos/custom-fields.mjs");
const db = await getDb();
const U = {};
for (const k of ["admin", "eng", "viewer"]) U[k] = await projects.ensureUser(db, { subject: `kc|cf-${k}`, displayName: k });
const P = (await projects.createProject(db, { code: "CF1", name: "CF", ownerUserId: U.admin.id })).id;
const P2 = (await projects.createProject(db, { code: "CF2", name: "CF2", ownerUserId: U.admin.id })).id;
await projects.addMember(db, { projectId: P, userId: U.eng.id, role: "engineer" });
await projects.addMember(db, { projectId: P, userId: U.viewer.id, role: "viewer" });
let F, L;

test("columns of a table: added in order, a heading once per table, a list with its choices; values by row key, blank removes", async () => {
  await withProject(db, P, async () => {
    F = await cf.saveField(db, { projectId: P, formKey: "eps-planning-rows", label: "Crew", dataType: "number", userId: U.admin.id });
    L = await cf.saveField(db, { projectId: P, formKey: "eps-planning-rows", label: "Shift", dataType: "list", options: "Day, Night", userId: U.admin.id });
    await throws(() => cf.saveField(db, { projectId: P, formKey: "eps-planning-rows", label: "Crew", userId: U.admin.id }), "هست");
    await throws(() => cf.saveField(db, { projectId: P, formKey: "eps-planning-rows", label: "Empty list", dataType: "list", options: "", userId: U.admin.id }), "گزینه");
    await cf.saveField(db, { projectId: P, formKey: "other-table", label: "Crew", userId: U.admin.id });
    await cf.saveValue(db, { projectId: P, fieldId: F.id, rowKey: "row-1", value: "12.5", userId: U.eng.id });
    await cf.saveValue(db, { projectId: P, fieldId: L.id, rowKey: "row-1", value: "Night", userId: U.eng.id });
    await throws(() => cf.saveValue(db, { projectId: P, fieldId: L.id, rowKey: "row-2", value: "Evening", userId: U.eng.id }), "گزینه");
    let t = await cf.tableColumns(db, { projectId: P, formKey: "eps-planning-rows" });
    equal([t.fields.map((f) => [f.label, f.data_type, f.options]), t.values.map((v) => v.value).sort()], [[["Crew", "number", []], ["Shift", "list", ["Day", "Night"]]], ["12.5", "Night"]]);
    await cf.saveValue(db, { projectId: P, fieldId: F.id, rowKey: "row-1", value: "", userId: U.eng.id });
    t = await cf.tableColumns(db, { projectId: P, formKey: "eps-planning-rows" });
    equal(t.values.map((v) => v.value), ["Night"], "blank removes the value");
    await throws(() => cf.saveField(db, { projectId: P, id: L.id, formKey: "eps-planning-rows", label: "Shift", dataType: "number", userId: U.admin.id }), "جور نیست",
      "a type its values would not hold is refused");
  });
});

test("another project sees none of it", async () => {
  await withProject(db, P2, async () => {
    equal((await cf.tableColumns(db, { projectId: P2, formKey: "eps-planning-rows" })).fields, []);
    await throws(() => cf.saveValue(db, { projectId: P2, fieldId: F.id, rowKey: "x", value: "1", userId: U.admin.id }), "not found");
  });
});

test("through the route: the admin defines, an engineer fills in, a viewer reads only", async () => {
  const route = await import("../../app/api/custom-fields/route.js");
  const req = (as, body) => new Request(body ? "http://x/api/custom-fields" : `http://x/api/custom-fields?projectId=${P}&form=eps-planning-rows`,
    { method: body ? "POST" : "GET", headers: { authorization: `Bearer kc|cf-${as}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const g = await route.GET(req("viewer"));
  const j = await g.json();
  equal([g.status, j.fields.length, j.may.define, j.may.fill], [200, 2, false, false]);
  equal((await route.POST(req("eng", { projectId: P, kind: "field", formKey: "eps-planning-rows", label: "X" }))).status, 403, "an engineer does not define");
  equal((await route.POST(req("eng", { projectId: P, kind: "value", fieldId: F.id, rowKey: "row-9", value: "3" }))).status, 200);
  equal((await route.POST(req("viewer", { projectId: P, kind: "value", fieldId: F.id, rowKey: "row-9", value: "4" }))).status, 403, "a viewer does not fill in");
  equal((await route.POST(req("admin", { projectId: P, kind: "field-remove", id: F.id }))).status, 200);
  equal((await (await route.GET(req("admin"))).json()).fields.map((f) => f.label), ["Shift"], "removed with its values");
});

test("templates a person builds: saved under a name, the same name replaces, the rule checked; removed by its maker or the admin; through the route", async () => {
  const it = await import("../../lib/db/repos/import-templates.mjs");
  await withProject(db, P, async () => {
    const a = await it.saveTemplate(db, { projectId: P, kind: "daily", name: " Site  crew ", columns: ["Qty", "Report No", "Activity code"], userId: U.eng.id });
    equal([a.name, a.columns], ["Site crew", ["Report No", "Activity code", "Qty"]]);
    await it.saveTemplate(db, { projectId: P, kind: "daily", name: "Site crew", columns: ["Report No", "Activity code", "Qty", "Notes"], userId: U.eng.id });
    equal((await it.listTemplates(db, { projectId: P, kind: "daily" })).map((x) => [x.name, x.columns.length]), [["Site crew", 4]], "the same name replaces its columns");
    await throws(() => it.saveTemplate(db, { projectId: P, kind: "daily", name: "No qty", columns: ["Report No", "Activity code"], userId: U.eng.id }), "لازم");
    await throws(() => it.saveTemplate(db, { projectId: P, kind: "pms", name: "Positional", columns: ["Coding"], userId: U.eng.id }), "ستون‌انتخابی");
    await throws(() => it.removeTemplate(db, { projectId: P, id: a.id, userId: U.viewer.id }), "سازنده");
  });
  await withProject(db, P2, async () => equal(await it.listTemplates(db, { projectId: P2, kind: "daily" }), [], "another project sees none"));
  const route = await import("../../app/api/import-templates/route.js");
  const req = (as, body) => new Request(body ? "http://x/api/import-templates" : `http://x/api/import-templates?projectId=${P}&kind=daily`,
    { method: body ? "POST" : "GET", headers: { authorization: `Bearer kc|cf-${as}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const g = await (await route.GET(req("viewer"))).json();
  equal([g.templates.length, g.may.save], [1, false]);
  equal((await route.POST(req("viewer", { projectId: P, kind: "save", template: "daily", name: "V", columns: ["Report No", "Activity code", "Qty"] }))).status, 403, "a viewer does not save");
  equal((await route.POST(req("admin", { projectId: P, kind: "remove", id: g.templates[0].id }))).status, 200, "the admin removes another's");
});

await run();
