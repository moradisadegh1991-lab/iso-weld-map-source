#!/usr/bin/env node
/**
 * Tiles and handover forms (owner's request 2026-10-16).
 *
 *  - A member narrowed to tiles sees and reaches only their tiles: the menu
 *    and the server's API check read the same list, and the page→API map is
 *    read from the pages' source and must be current.
 *  - A section's employer supervision designs its handover forms; a form's
 *    reports take the work the employer accepted that day, go through the
 *    form's own workflow, and keep the definition they were made with.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import fs from "node:fs";
import * as fm from "../../lib/reports/forms.mjs";
import { navigationFor, tileAllowed, narrowed } from "../../lib/platform/navigation.mjs";
import { apiAllowed, assertTiles, cleanTiles } from "../../lib/platform/tiles.mjs";
import { can } from "../../lib/authz.mjs";

// ── tiles ────────────────────────────────────────────────────────────────

test("the page→API map is current: every page's API calls, read from its source", async () => {
  const { render } = await import("../../tools/tile-apis.mjs");
  const now = fs.readFileSync(new URL("../../lib/platform/tile-apis.mjs", import.meta.url), "utf8");
  assert(now === await render(), "lib/platform/tile-apis.mjs is out of date — run `npm run tiles:map`");
});

test("a member narrowed to tiles: the menu shows those tiles only, the server answers only their pages' routes", async () => {
  const qc = { role: "qc", areas: [], tiles: ["/piping/welding", "/forms/HO-PIP"] };
  const forms = [{ code: "HO-PIP", name: "تحویل پایپینگ", section: "piping" }, { code: "HO-CIV", name: "تحویل سیویل", section: "civil" }];
  const hrefs = navigationFor(qc, can, { forms }).flatMap((g) => g.items.flatMap((s) => s.tabs.map((t) => t.href)));
  equal(hrefs.filter((h) => !h.startsWith("/log/")).sort(), ["/", "/desk", "/forms/HO-PIP", "/notifications", "/piping/welding", "/signature"].sort(),
    "their tiles, and the pages everyone keeps (their desk and notifications among them, 2026-10-22)");
  assert(apiAllowed(qc, "/api/desk") && apiAllowed(qc, "/api/notifications"), "and what those pages call");
  assert(hrefs.includes("/log/piping") && hrefs.includes("/log/handover") === false, "a section's log comes with a tile of it");
  assert(apiAllowed(qc, "/api/welds/abc") && apiAllowed(qc, "/api/forms") && apiAllowed(qc, "/api/auth/me"), "their pages' routes and the common ones");
  for (const p of ["/api/civil", "/api/hse", "/api/overview", "/api/contracts", "/api/users"]) assert(!apiAllowed(qc, p), `${p} is outside the tiles`);
  const e = await throws(async () => assertTiles(new Request("http://x/api/hse?projectId=p"), qc), "تایل‌های دسترسی");
  equal([e.status, e.code], [403, "OUT_OF_TILES"]);
  assert(!tileAllowed(qc, "/forms/HO-CIV") && tileAllowed(qc, "/forms/HO-PIP"), "one form's tile is not another's");
  // unnarrowed: the role decides, as before; an admin is never narrowed
  const free = { role: "qc", areas: [], tiles: [] };
  assert(!narrowed(free) && apiAllowed(free, "/api/hse"));
  assert(!narrowed({ role: "admin", tiles: ["/piping"] }) && apiAllowed({ role: "admin", tiles: ["/piping"] }, "/api/hse"));
  equal(cleanTiles(["/piping", "/nowhere", "/forms/HO-PIP", "/forms/GONE"], forms), { tiles: ["/piping", "/forms/HO-PIP"], unknown: ["/nowhere", "/forms/GONE"] });
});

test("the form designer's page: the employer's supervision and the admin; the workflow and print setup open to them too", async () => {
  const tabs = (m) => navigationFor({ areas: [], tiles: [], ...m }, can).flatMap((g) => g.items.flatMap((s) => s.tabs.map((t) => t.href)));
  for (const [m, want] of [[{ role: "engineer", party: "company" }, true], [{ role: "engineer", party: "contractor" }, false], [{ role: "admin" }, true], [{ role: "viewer", party: "company" }, false]]) {
    equal(tabs(m).includes("/forms"), want, `${m.role}/${m.party}`);
    equal(tabs(m).includes("/report-setup"), want, `${m.role}/${m.party}: workflow setup`);
  }
});

// ── forms: the rules ─────────────────────────────────────────────────────

const DEF = {
  source: "claims",
  header: [{ label: "شمارهٔ صورتجلسه", key: "minute_no", required: true }, { label: "محدوده", type: "select", options: "واحد ۱۰۰، واحد ۲۰۰" }],
  columns: [{ label: "آیتم", bind: "item" }, { label: "مرحله", bind: "step" }, { label: "طول (m)", key: "len", type: "number" },
    { label: "پیمانکار", bind: "contractor" }, { label: "قبول", key: "ok", type: "check" }],
};

test("a definition: keys made or checked, select options split, binding only with accepted work as the source", async () => {
  const { def, problems } = fm.checkDefinition(DEF);
  equal(problems, []);
  equal(def.columns.map((c) => [c.key, c.type, c.bind || null]), [["c1", "text", "item"], ["c2", "text", "step"], ["len", "number", null], ["c4", "text", "contractor"], ["ok", "check", null]]);
  equal(def.header[1].options, ["واحد ۱۰۰", "واحد ۲۰۰"]);
  const bad = fm.checkDefinition({ header: [{ label: "x", key: "X Y" }, { label: "y", type: "select" }], columns: [{ label: "a", bind: "item" }, { label: "b", key: "c1" }, { label: "c", key: "c1" }] });
  for (const want of ["کلید «x y»", "دست‌کم یک گزینه", "پر شدن خودکار فقط", "تکراری"]) assert(bad.problems.some((p) => p.includes(want)), `${want}: ${bad.problems.join(" | ")}`);
  assert(fm.checkDefinition({ columns: [] }).problems.some((p) => p.includes("دست‌کم یک ستون")));
});

test("content against its definition: types, required fields, options; a piece of accepted work only once", async () => {
  const { def } = fm.checkDefinition(DEF);
  const { content, problems } = fm.checkFormContent(def, { header: { minute_no: "M-12", h2: "واحد ۱۰۰" },
    rows: [{ id: "a", c1: "SP-1", len: "12.5", ok: true }, { id: "b", c1: "SP-2", len: "3", ok: "1" }] });
  equal(problems, []);
  equal([content.rows[0].len, content.rows[1].ok, content.def.columns.length, content.schema], [12.5, true, 5, "form1"]);
  const wrong = fm.checkFormContent(def, { header: { h2: "واحد ۹۹۹" }, rows: [{ len: "دوازده" }, { c1: "x", source: { table: "spool_activity", id: "1" } }, { source: { table: "spool_activity", id: "1" } }] });
  for (const want of ["«شمارهٔ صورتجلسه» لازم", "از گزینه‌های", "عدد نیست", "دو بار"]) assert(wrong.problems.some((p) => p.includes(want)), `${want}: ${wrong.problems.join(" | ")}`);
  equal(fm.columnTotals(def, content.rows), { len: 15.5 });
  equal(fm.rowChanges(content, { ...content, rows: [content.rows[0], { id: "c", c1: "SP-3" }] }), { added: 1, changed: 0, removed: 1 });
  const reordered = JSON.parse(JSON.stringify(content, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)));
  equal(fm.rowChanges(content, reordered), { added: 0, changed: 0, removed: 0 }, "key order read back from jsonb is no change");
});

test("the day's accepted work as rows: bound columns filled, the rest left for a person", async () => {
  const { def } = fm.checkDefinition(DEF);
  const rows = fm.rowsFromWork(def, [{ table: "spool_activity", id: "x1", item: "SP-7 · L-100", step: "فیت‌آپ", contractor: "PIP" }]);
  equal([rows[0].c1, rows[0].c2, rows[0].c4, rows[0].len, rows[0].source], ["SP-7 · L-100", "فیت‌آپ", "PIP", null, { table: "spool_activity", id: "x1" }]);
});

// ── forms in the database ────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("forms-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const rp = await import("../../lib/db/repos/reports.mjs");
const forms = await import("../../lib/db/repos/forms.mjs");
const users = await import("../../lib/db/repos/users.mjs");
const db = await getDb();
const U = {};
for (const k of ["admin", "sup", "csup", "contractor", "other"]) U[k] = await projects.ensureUser(db, { subject: `kc|f-${k}`, displayName: k });
const P = (await projects.createProject(db, { code: "FRM", name: "F", ownerUserId: U.admin.id })).id;
for (const [k, role, party, areas] of [["sup", "engineer", "company", ["electrical"]], ["csup", "engineer", "company", ["civil"]], ["contractor", "qc", "contractor", []], ["other", "qc", null, []]]) {
  await projects.addMember(db, { projectId: P, userId: U[k].id, role });
  await db.query("UPDATE project_member SET inspection_party = $3, areas = $4 WHERE project_id = $1 AND user_id = $2", [P, U[k].id, party, areas]);
}
const inP = (fn) => withProject(db, P, fn);
const M = async (k) => projects.membershipOf(db, { projectId: P, userId: U[k].id });
const today = new Date().toISOString().slice(0, 10);
let T;

test("a section's employer supervision designs its forms; another section's, a contractor or a built-in code may not", async () => {
  await inP(async () => {
    await throws(async () => forms.saveFormType(db, { projectId: P, code: "HO-ELE", name: "x", section: "electrical", definition: DEF, membership: await M("csup"), userId: U.csup.id }), "نظارت کارفرمای همین بخش");
    await throws(async () => forms.saveFormType(db, { projectId: P, code: "HO-ELE", name: "x", section: "electrical", definition: DEF, membership: await M("contractor"), userId: U.contractor.id }), "نظارت کارفرمای همین بخش");
    await throws(async () => forms.saveFormType(db, { projectId: P, code: "DR", name: "x", section: "electrical", definition: DEF, membership: await M("sup"), userId: U.sup.id }), "ساخته‌شدهٔ سامانه");
    T = await forms.saveFormType(db, { projectId: P, code: "ho-ele", name: "تحویل روزانهٔ کابل‌کشی", section: "electrical", definition: DEF, membership: await M("sup"), userId: U.sup.id });
    equal(T.code, "HO-ELE");
    const w = await rp.workflowOf(db, { projectId: P, reportTypeId: T.id });
    equal(w.map((s) => s.name), ["پیمانکار", "نظارت کارفرما"], "a new form starts with the hand-over → take-over workflow");
    equal((await forms.typesOf(db, { projectId: P, groupId: w[1].groups[0].id })).map((t) => t.code), ["HO-ELE"], "a group leads to the forms of its workflow, for the designer's workflow rights");
    const pl = await import("../../lib/db/repos/print-layout.mjs");
    const lay = (await pl.currentLayout(db, { projectId: P, reportTypeId: T.id })).layout;
    assert(JSON.stringify(lay).includes("تحویل روزانهٔ کابل‌کشی") && !JSON.stringify(lay).includes("گزارش روزانهٔ کارگاه"), "the default print header names the form");
    assert(forms.mayDesign(await M("sup"), "electrical") && !forms.mayDesign(await M("sup"), "civil") && !forms.mayDesign(await M("other"), "electrical"));
  });
});

test("a day's report from the work accepted that day; its workflow decides who makes and signs it; it keeps its definition", async () => {
  await inP(async () => {
    // the contractor hands over two cables; the employer accepts one of them today
    const cb = [];
    for (const no of ["CB-101", "CB-102"]) cb.push((await db.query("INSERT INTO cable (project_id, cable_no) VALUES ($1,$2) RETURNING id", [P, no])).rows[0]);
    await db.query(`INSERT INTO cable_activity (project_id, cable_id, code, status, done_at, recorded_by, approved_by, approved_at)
                    VALUES ($1,$2,'pulled','done',$4,$3,$5, now())`, [P, cb[0].id, U.contractor.id, today, U.sup.id]);
    await db.query(`INSERT INTO cable_activity (project_id, cable_id, code, status, recorded_by, claimed_on)
                    VALUES ($1,$2,'pulled','in_progress',$3,$4)`, [P, cb[1].id, U.contractor.id, today]);
    const work = await forms.acceptedWork(db, { projectId: P, section: "electrical", date: today });
    equal(work.map((x) => x.item), ["CB-101"], "only the work the employer accepted, not the claim still waiting");
    equal((await forms.acceptedWork(db, { projectId: P, section: "civil", date: today })).length, 0, "another section's form sees none of it");

    const w = await rp.workflowOf(db, { projectId: P, reportTypeId: T.id });
    await throws(() => forms.createFormReport(db, { projectId: P, code: "HO-ELE", reportDate: today, header: { minute_no: "M-1" }, fromWork: true, userId: U.contractor.id }), "حق ایجاد");
    await rp.setGroupMember(db, { projectId: P, groupId: w[0].groups[0].id, userId: U.contractor.id, permissions: ["view", "create", "add_content", "edit", "delete_content", "sign"] });
    await rp.setGroupMember(db, { projectId: P, groupId: w[1].groups[0].id, userId: U.sup.id, permissions: ["view", "sign", "approve", "return"] });
    await throws(() => forms.createFormReport(db, { projectId: P, code: "HO-ELE", reportDate: today, header: {}, fromWork: true, userId: U.contractor.id }), "لازم است");
    const r = await forms.createFormReport(db, { projectId: P, code: "HO-ELE", reportDate: today, header: { minute_no: "M-1" }, fromWork: true, userId: U.contractor.id });
    let v = await forms.formReportView(db, { projectId: P, reportId: r.id, userId: U.contractor.id });
    equal([v.content.rows.length, v.content.rows[0].c1, !!v.content.rows[0].c2, v.content.rows[0].source.table], [1, "CB-101", true, "cable_activity"],
      "the accepted spool, its step, and where the row came from");
    // the contractor fills the length and signs; the supervision signs and approves
    await forms.editFormReport(db, { projectId: P, reportId: r.id, header: v.content.header, rows: [{ ...v.content.rows[0], len: 12 }], userId: U.contractor.id });
    await throws(() => forms.editFormReport(db, { projectId: P, reportId: r.id, header: v.content.header, rows: [{ ...v.content.rows[0], len: 12 }], userId: U.contractor.id }), "تغییری نکرده");
    // the form is redesigned: the report keeps the columns it was made with
    await forms.saveFormType(db, { projectId: P, id: T.id, code: "HO-ELE", name: "تحویل روزانهٔ کابل‌کشی", section: "electrical",
      definition: { ...DEF, columns: [{ label: "فقط یک ستون" }] }, membership: await M("sup"), userId: U.sup.id });
    v = await forms.formReportView(db, { projectId: P, reportId: r.id, userId: U.contractor.id });
    equal([v.def.columns.length, v.totals.len], [5, 12], "the redesign does not reach a report already made");
    await rp.signReport(db, { projectId: P, reportId: r.id, userId: U.contractor.id });
    await throws(() => forms.editFormReport(db, { projectId: P, reportId: r.id, header: v.content.header, rows: [], userId: U.contractor.id }), "امضای خود را لغو کنید");
    await rp.setStageApprover(db, { projectId: P, stageId: w[0].id, approverId: U.contractor.id });
    await rp.approveStage(db, { projectId: P, reportId: r.id, userId: U.contractor.id });
    await rp.signReport(db, { projectId: P, reportId: r.id, userId: U.sup.id });
    await rp.approveStage(db, { projectId: P, reportId: r.id, userId: U.sup.id });
    v = await forms.formReportView(db, { projectId: P, reportId: r.id, userId: U.sup.id });
    equal([v.report.status, v.stages.map((s) => s.approved)], ["approved", [true, true]]);
    await throws(() => forms.formReportView(db, { projectId: P, reportId: r.id, userId: U.other.id }), "", "someone outside the form's workflow does not read it");
  });
});

test("tiles are stored for a member: known pages and existing forms only", async () => {
  await inP(async () => {
    const { cleanTiles: clean } = await import("../../lib/platform/tiles.mjs");
    const fl = await forms.formTypes(db, { projectId: P });
    await throws(() => users.setMemberTiles(db, { projectId: P, userId: U.other.id, tiles: ["/piping", "/admin2"], cleanTiles: clean, forms: fl }), "تایل ناشناخته");
    const m = await users.setMemberTiles(db, { projectId: P, userId: U.other.id, tiles: ["/forms/HO-ELE", "/piping"], cleanTiles: clean, forms: fl });
    equal(m.tiles, ["/forms/HO-ELE", "/piping"]);
    equal((await M("other")).tiles, ["/forms/HO-ELE", "/piping"], "the membership every request is checked against carries them");
  });
});

test("through the routes: a designer sets their form's workflow only; a narrowed member reaches their tiles only", async () => {
  const setup = await import("../../app/api/report-setup/route.js");
  const formsRoute = await import("../../app/api/forms/route.js");
  const hse = await import("../../app/api/hse/route.js");
  const req = (url, as, body) => new Request(`http://x${url}`, { method: body ? "POST" : "GET",
    headers: { authorization: `Bearer kc|f-${as}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const out = async (res) => ({ status: res.status, body: await res.json() });
  const dr = await inP(async () => (await rp.applyDailyTemplate(db, { projectId: P })).type);
  const types = (await out(await setup.GET(req(`/api/report-setup?projectId=${P}`, "sup")))).body.types;
  equal(types.map((t) => t.code), ["HO-ELE"], "the designer sees the workflow of their own forms, not the daily report's");
  const ho = types[0];
  equal((await setup.POST(req("/api/report-setup", "sup", { projectId: P, kind: "type", code: "XX", name: "x" }))).status, 403);
  equal((await setup.POST(req("/api/report-setup", "sup", { projectId: P, kind: "stage", reportTypeId: dr.id, seq: 9, name: "x" }))).status, 403,
    "another report type's workflow is the admin's");
  equal((await setup.POST(req("/api/report-setup", "sup", { projectId: P, kind: "stage-color", stageId: ho.stages[1].id, color: "#2e86c1" }))).status, 200);
  equal((await setup.GET(req(`/api/report-setup?projectId=${P}`, "contractor"))).status, 403, "a contractor sets no workflow");

  const e = await out(await hse.GET(req(`/api/hse?projectId=${P}`, "other")));
  equal([e.status, e.body.code], [403, "OUT_OF_TILES"], "outside the narrowed member's tiles, reading too");
  equal((await formsRoute.GET(req(`/api/forms?projectId=${P}&code=HO-ELE`, "other"))).status, 200, "their form's tile");
  await inP(() => forms.saveFormType(db, { projectId: P, code: "HO-EL2", name: "دوم", section: "electrical", definition: DEF, membership: { role: "admin" }, userId: U.admin.id }));
  equal((await formsRoute.GET(req(`/api/forms?projectId=${P}&code=HO-EL2`, "other"))).status, 404, "a form whose tile they were not given");
  equal((await out(await formsRoute.GET(req(`/api/forms?projectId=${P}`, "other")))).body.types.map((t) => t.code), ["HO-ELE"]);
});

await run();
