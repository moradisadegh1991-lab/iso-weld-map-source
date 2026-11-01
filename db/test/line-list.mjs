#!/usr/bin/env node
/**
 * A sheet against what is on file, and what saving it keeps (owner's request
 * of 2026-11-01; migration 094, lib/db/repos/line-list.mjs): is the drawing,
 * sheet and revision registered, is its line, where the line list read on
 * the sheet differs from the line's — and on save the line's empty values
 * filled, a differing one kept and reported, the sheet's BOM saved per
 * revision.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
import { compareLineList } from "../../lib/db/repos/line-list.mjs";

test("the read line list against the line's: an empty value is a fill, a different one a conflict, the same in other case or spacing neither", () => {
  const line = { piping_class: "1B", design_pressure: "7.4", test_fluid: "Fresh  water", ndt: null };
  const r = compareLineList(line, { lineClass: "1B", designPressure: "7.5", testFluid: "FRESH WATER", ndt: "10%RT+10%MT", paint: "", pwht: null });
  equal(r.fills.map((f) => f.key), ["ndt"]);
  equal(r.conflicts, [{ key: "designPressure", onFile: "7.4", read: "7.5" }]);
  equal(compareLineList(null, { designTemp: "65" }).fills.map((f) => [f.key, f.col, f.read]), [["designTemp", "design_temp", "65"]], "no line yet: every value read is a fill");
});

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("line-list-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const docs = await import("../../lib/db/repos/documents.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const ll = await import("../../lib/db/repos/line-list.mjs");
const db = await getDb();
const U = await projects.ensureUser(db, { subject: "kc|ll-admin", displayName: "admin" });
const U2 = await projects.ensureUser(db, { subject: "kc|ll-other", displayName: "other" });
const P = (await projects.createProject(db, { code: "LL1", name: "A", ownerUserId: U.id })).id;
const P2 = (await projects.createProject(db, { code: "LL2", name: "B", ownerUserId: U2.id })).id;
const inP = (fn) => withProject(db, P, fn);
const PKG = "AISPC-10-DE-930-PI-ISO-0001";
const L60 = '60"-CWR-10-930001A-DA01-UCW';
const READ = { lineClass: "1B", designPressure: "7.4", operatingPressure: "2.3", designTemp: "65", operatingTemp: "43",
  testPressure: null, testFluid: "FRESH WATER", ndt: null, pwht: "-", paint: "-", insulationType: null, insulationThk: "-" };

test("a sheet not on file is new; its line, not registered, is new and every value read would be registered", async () => {
  await inP(async () => {
    const r = await ll.registryCheck(db, { projectId: P, docNo: PKG, sheet: "3/4", rev: "A0", lineNo: L60, lineData: READ });
    equal([r.document.status, r.document.revisions, r.document.inForce], ["new", [], null]);
    equal([r.line.exists, r.line.lineNo, r.line.conflicts], [false, L60, []]);
    equal(r.line.fills, ["lineClass", "designPressure", "operatingPressure", "designTemp", "operatingTemp", "testFluid", "pwht", "paint", "insulationThk"]);
    equal((await ll.registryCheck(db, { projectId: P, docNo: PKG, sheet: "3/4", rev: "A0" })).line, null, "no line number read: the line is not looked up");
  });
});

test("saved: the same sheet and revision is registered; another revision is a new one, with the one in force named; the line exists", async () => {
  await inP(async () => {
    const { document: d } = await docs.registerDocument(db, { projectId: P, docNo: PKG, revision: "A0", sheetNo: "3/4", fileSha256: "a".repeat(64), storageUri: "local://p9" });
    const line = await spine.lineForRegister(db, { projectId: P, lineNo: L60, docNo: PKG, pipingClass: "1B" });
    const run_ = await runs.createRun(db, { projectId: P, documentId: d.id, lineId: line.id, payload: {} });
    const filled = await ll.fillLineList(db, { projectId: P, lineId: line.id, lineData: READ });
    equal(filled.conflicts, []);
    equal(filled.filled.includes("designPressure") && !filled.filled.includes("lineClass"), true, "the class the register set is on file already");
    equal(await ll.saveIsoBom(db, { projectId: P, documentId: d.id, runId: run_.id, lineId: line.id, createdBy: U.id,
      bom: [{ pt: 1, group: "PIPE", description: "Pipe, API 5L", diam: "60", stockCode: "X1", qty: 1.2, qtyUnit: "m" },
        { pt: 3, description: "Flange", diam: "60 x 1.1/2", qty: 3, qtyUnit: "pcs" }, { pt: 3, description: "twice" }, { pt: "x" }] }), 2,
    "one row per PT number; a row with no number is not kept");

    const same = await ll.registryCheck(db, { projectId: P, docNo: PKG, sheet: "3/4", rev: "A0", lineNo: L60, lineData: READ });
    equal([same.document.status, same.document.saved, same.document.approved, same.document.inForce], ["registered", true, false, "A0"]);
    equal([same.line.exists, same.line.fills, same.line.conflicts], [true, [], []], "everything read is on file now");
    const next = await ll.registryCheck(db, { projectId: P, docNo: PKG, sheet: "3/4", rev: "A1", lineNo: L60 });
    equal([next.document.status, next.document.inForce, next.document.revisions.map((r) => r.revision)], ["new-revision", "A0", ["A0"]]);
  });
});

test("a later sheet that prints another value: reported as a conflict, never written over; an empty one is still filled", async () => {
  await inP(async () => {
    const { rows: [line] } = await db.query("SELECT id FROM line WHERE line_no = $1", [L60]);
    const r = await ll.fillLineList(db, { projectId: P, lineId: line.id, lineData: { ...READ, designPressure: "7.5", ndt: "10%RT+10%MT" } });
    equal([r.filled, r.conflicts], [["ndt"], [{ key: "designPressure", onFile: "7.4", read: "7.5" }]]);
    const { rows: [after] } = await db.query("SELECT design_pressure, ndt FROM line WHERE id = $1", [line.id]);
    equal([after.design_pressure, after.ndt], ["7.4", "10%RT+10%MT"]);
    const c = await ll.registryCheck(db, { projectId: P, docNo: PKG, sheet: "3/4", rev: "A0", lineNo: L60, lineData: { designPressure: "7.5" } });
    equal(c.line.conflicts, [{ key: "designPressure", onFile: "7.4", read: "7.5" }]);
  });
});

test("the package's number on another line's sheet: the sheet on file is named as another line's", async () => {
  await inP(async () => {
    const r = await ll.registryCheck(db, { projectId: P, docNo: PKG, sheet: "3/4", rev: "A0", lineNo: '28"-CWR-10-930065A-DA01-UCW' });
    equal([r.document.status, r.document.otherLine], ["registered", L60]);
    equal((await ll.registryCheck(db, { projectId: P, docNo: PKG, sheet: "3/4", rev: "A0", lineNo: L60 })).document.otherLine, undefined);
  });
});

test("a sheet revision's BOM saved again replaces the rows saved before; it reads back in PT order", async () => {
  await inP(async () => {
    const { rows: [d] } = await db.query("SELECT id FROM document WHERE doc_no = $1 AND revision = 'A0'", [PKG]);
    equal((await ll.isoBom(db, { projectId: P, documentId: d.id })).map((b) => [b.pt, b.diam, b.qty, b.qtyUnit]), [[1, "60", 1.2, "m"], [3, "60 x 1.1/2", 3, "pcs"]]);
    await ll.saveIsoBom(db, { projectId: P, documentId: d.id, bom: [{ pt: 2, description: "Pipe 3/4", diam: "3/4", qty: 0.3, qtyUnit: "m" }, { pt: 1, description: "Pipe 60", qty: -1, qtyUnit: "kg" }] });
    equal((await ll.isoBom(db, { projectId: P, documentId: d.id })).map((b) => [b.pt, b.qty, b.qtyUnit]), [[1, null, null], [2, 0.3, "m"]], "a negative quantity or an unknown unit is not kept");
  });
});

test("another project sees none of it", async () => {
  await withProject(db, P2, async () => {
    const r = await ll.registryCheck(db, { projectId: P2, docNo: PKG, sheet: "3/4", rev: "A0", lineNo: L60 });
    equal([r.document.status, r.line.exists], ["new", false]);
    equal((await db.query("SELECT count(*)::int AS n FROM iso_bom_row")).rows[0].n, 0);
  });
});

await run();
