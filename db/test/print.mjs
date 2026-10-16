#!/usr/bin/env node
/**
 * The print layout of a report type (lib/reports/print.mjs,
 * lib/db/repos/print-layout.mjs): paper and sections that leave room for the
 * body, header cells that fit the header, logos only from this project,
 * signature boxes in one row on landscape and sharing the width on portrait,
 * and layouts and logos kept, never rewritten.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";

process.env.PGLITE_DIR = await scratchDir("print-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const rp = await import("../../lib/db/repos/reports.mjs");
const pl = await import("../../lib/db/repos/print-layout.mjs");
const pr = await import("../../lib/reports/print.mjs");
const { createLocalStore } = await import("../../lib/storage/content-store.mjs");

const db = await getDb();
const me = await projects.ensureUser(db, { subject: "kc|print" });
const proj = await projects.createProject(db, { code: "PRN", name: "P", ownerUserId: me.id });
const other = await projects.createProject(db, { code: "OTH", name: "O", ownerUserId: me.id });
const P = proj.id;
const store = createLocalStore({ root: await scratchDir("print-store-") });
const PNG = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, n)]);
const D = pr.DEFAULT_LAYOUT;

test("the page leaves room for the body; header cells fit the header; at least one footer element is shown", async () => {
  equal(pr.checkLayout(D).problems, [], "the default layout is valid");
  const tall = pr.checkLayout({ ...D, heights: { header: 150, footer: 120 } });
  assert(tall.problems.some((p) => /جایی نمی‌گذارند/.test(p)), "297 mm A4 minus 270 mm leaves no body");
  const land = pr.checkLayout({ ...D, page: { size: "A4", orientation: "landscape" }, heights: { header: 95, footer: 80 } });
  assert(land.problems.some((p) => /جایی نمی‌گذارند/.test(p)), "landscape A4 is 210 mm high, not 297");
  equal(pr.pageSize(land.layout), { width: 297, height: 210 });
  const cells = pr.checkLayout({ ...D, header: { ...D.header, center: { cells: [{ text: "a", height: 20 }, { text: "b", height: 20 }] } } });
  assert(cells.problems.some((p) => /جمع ارتفاع خانه‌های سربرگ/.test(p)), "40 mm of cells in a 32 mm header");
  const none = pr.checkLayout({ ...D, footer: { ...D.footer, elements: Object.fromEntries(Object.keys(D.footer.elements).map((k) => [k, { show: false }])) } });
  assert(none.problems.some((p) => /دست‌کم یک جزء/.test(p)));
  assert(pr.checkLayout({ ...D, page: { size: "B5" } }).problems.some((p) => /B5/.test(p)));
  equal(pr.checkLayout({ ...D, header: { ...D.header, center: { cells: [{ text: "x", size: 300, height: 8 }] } } }).layout.header.center.cells[0].size, 28,
    "a font size out of range is brought into it");
});

test("signature boxes: one row in landscape; rows sharing the width in portrait; elements in the order chosen", async () => {
  const land = pr.checkLayout({ ...D, page: { size: "A4", orientation: "landscape" } }).layout;
  equal(pr.footerRows(land, 6), [[0, 1, 2, 3, 4, 5]]);
  const port = pr.checkLayout({ ...D, footer: { ...D.footer, perRow: 4 } }).layout;
  equal(pr.footerRows(port, 6), [[0, 1, 2, 3], [4, 5]]);
  equal(pr.footerRows(port, 0), []);
  const reordered = pr.checkLayout({ ...D, footer: { ...D.footer, elements: { ...D.footer.elements, date: { ...D.footer.elements.date, order: 0 },
    stage: { ...D.footer.elements.stage, show: false } } } }).layout;
  equal(pr.footerOrder(reordered).map((e) => e.key), ["date", "group", "signature", "user"]);
});

test("header text fills in the report's values; a name it does not know stays as typed", async () => {
  equal(pr.fill("{project} — {report_no} ({version}) {unknown}", { project: "K110", report_no: "DR-R0001", version: 2 }),
    "K110 — DR-R0001 (2) {unknown}");
});

test("logos: images only, one per image, and a layout may use only this project's", async () => {
  await withProject(db, P, async () => {
    await throws(() => pl.saveLogo(db, { projectId: P, name: "x", bytes: Buffer.from("<svg onload=alert(1)>"), store }), "PNG، JPEG");
    const a = await pl.saveLogo(db, { projectId: P, name: "کاویان", bytes: PNG(1), store, userId: me.id });
    equal((await pl.saveLogo(db, { projectId: P, name: "دوباره", bytes: PNG(1), store })).id, a.id);
    const type = await rp.upsertReportType(db, { projectId: P, code: "DR", name: "گزارش روزانه" });
    equal((await pl.currentLayout(db, { projectId: P, reportTypeId: type.id })).version, 0, "the default until one is saved");
    const s1 = await pl.saveLayout(db, { projectId: P, reportTypeId: type.id, userId: me.id,
      layout: { ...D, header: { ...D.header, right: { logos: [a.id] } } } });
    equal([s1.version, s1.layout.header.right.logos], [1, [a.id]]);
    await throws(() => pl.saveLayout(db, { projectId: P, reportTypeId: type.id, layout: { ...D, heights: { header: 200, footer: 90 } } }), "جایی نمی‌گذارند");
    const s2 = await pl.saveLayout(db, { projectId: P, reportTypeId: type.id, layout: { ...D, page: { size: "A3", orientation: "landscape" } } });
    equal((await pl.currentLayout(db, { projectId: P, reportTypeId: type.id })).layout.page, { size: "A3", orientation: "landscape" });
    equal(s2.version, 2, "a new layout is a new version; the one before is kept");
  });
  const foreign = await withProject(db, other.id, () => pl.saveLogo(db, { projectId: other.id, name: "دیگر", bytes: PNG(2), store }));
  await withProject(db, P, async () => {
    const [type] = await rp.reportTypes(db, { projectId: P });
    await throws(() => pl.saveLayout(db, { projectId: P, reportTypeId: type.id, layout: { ...D, header: { ...D.header, left: { logos: [foreign.id] } } } }),
      "در این پروژه نیست");
    await throws(() => pl.readLogo(db, { projectId: P, logoId: foreign.id, store }), "not found");
    for (const sql of ["UPDATE report_print_layout SET version = 9", "DELETE FROM project_logo"]) {
      await throws(() => db.query(sql), "permission denied", sql);
    }
  });
});

await run();
