#!/usr/bin/env node
/**
 * MESC numbers on stock items: the ten-digit structure, the owner's
 * catalogue as the only authority, and one number per material.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeMesc, formatMesc, mescPrefixes, parseCatalogue, mescState, searchCatalogue } from "../../lib/warehouse/mesc.mjs";

// Codes below are made up for the test; they are not taken from any MESC book.
const CATALOGUE = `code,description,uom
90,"TEST GROUP A"
9010,"TEST SUBGROUP PIPE"
901012,"TEST SUB-SUB SEAMLESS"
9010120521,"PIPE, SEAMLESS, CS, 8 IN, SCH 40",M
9010120531,"PIPE, SEAMLESS, CS, 10 IN, SCH 40",M
9120330011,"GASKET, SPIRAL WOUND, 8 IN, 300#",EA
9120330019,"GASKET, SPIRAL WOUND, LOCAL",EA`;

test("a MESC number is ten digits, whatever the separators or digits it was typed with", async () => {
  equal(normalizeMesc("90.10.12.052.1"), "9010120521");
  equal(normalizeMesc("90 10 12 052 1"), "9010120521");
  equal(normalizeMesc("۹۰۱۰۱۲۰۵۲۱"), "9010120521", "Persian digits");
  equal(normalizeMesc("901012052"), null, "nine digits");
  equal(normalizeMesc("90101205211"), null, "eleven digits");
  equal(normalizeMesc("90.10.12.05A.1"), null);
  equal(formatMesc("9010120521"), "90.10.12.052.1");
  equal(mescPrefixes("9010120521"), { main: "90", sub: "9010", subsub: "901012" });
});

test("the catalogue file is read whole, or refused with every bad line named", async () => {
  const c = parseCatalogue(CATALOGUE);
  equal([c.groups.length, c.items.length, c.problems], [3, 4, []]);
  equal(c.items[0], { code: "9010120521", description: "PIPE, SEAMLESS, CS, 8 IN, SCH 40", uom: "M" });
  equal(parseCatalogue("9010120521;PIPE, SEAMLESS;M").items[0].description, "PIPE, SEAMLESS", "semicolons");
  const bad = parseCatalogue("12345,odd\n9010120599,PIPE, SEAMLESS, 8 IN,M\n9010120521,x,M\n9010120521,y,M");
  equal(bad.problems.length, 3, "a 5-digit code, an unquoted comma, a repeated code");
});

test("a code is valid only against the loaded catalogue, and in the stock item's unit", async () => {
  equal(mescState({ code: null, uom: "M" }, { catalogueLoaded: true }).code, "none");
  equal(mescState({ code: "9010120521", uom: "M" }, { catalogueLoaded: false }).code, "unverified", "no catalogue: not verified, not valid");
  equal(mescState({ code: "9010120521", uom: "M" }, { catalogueLoaded: true, entry: null }).code, "unknown");
  equal(mescState({ code: "9010120521", uom: "EA" }, { catalogueLoaded: true, entry: { uom: "M" } }).code, "uom");
  equal(mescState({ code: "9010120521", uom: "m" }, { catalogueLoaded: true, entry: { uom: "M" } }).code, "ok");
});

test("search offers candidates by code prefix or description words, best match first", async () => {
  const e = parseCatalogue(CATALOGUE).items;
  equal(searchCatalogue(e, "90.10").map((x) => x.code), ["9010120521", "9010120531"]);
  equal(searchCatalogue(e, "pipe seamless 10 in")[0].code, "9010120531", "four words match the 10 in pipe, three the 8 in");
  equal(searchCatalogue(e, "gasket").length, 2);
  equal(searchCatalogue(e, ""), []);
});

// ── against the database ─────────────────────────────────────────────────

process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "mesc-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");
const mesc = await import("../../lib/db/repos/mesc.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "MSC", name: "M", ownerUserId: alice.id });
const P = proj.id;
const inP = (fn) => withProject(db, P, fn);
let pipe, pipe2, gasket;

await inP(async () => {
  pipe = await wh.upsertItem(db, { projectId: P, code: "P-CS-8-40", description: "Pipe 8in SCH40", category: "pipe", uom: "M" });
  pipe2 = await wh.upsertItem(db, { projectId: P, code: "P-CS-8-40-B", description: "Pipe 8in SCH40 (dup)", category: "pipe", uom: "M" });
  gasket = await wh.upsertItem(db, { projectId: P, code: "G-SW-8-300", description: "Gasket SW 8in 300#", category: "flange", uom: "M" });
});

test("before a catalogue is loaded a code is recorded, and shown as not verified", async () => {
  await inP(async () => {
    await throws(() => mesc.setItemMesc(db, { projectId: P, itemId: pipe.id, mescCode: "90.10.12.052" }), "INVALID_INPUT");
    await mesc.setItemMesc(db, { projectId: P, itemId: pipe.id, mescCode: "90.10.12.052.1" });
    const b = await mesc.mescBoard(db, { projectId: P });
    const row = b.items.find((i) => i.id === pipe.id);
    equal([row.mesc_code, row.formatted, row.state.code], ["9010120521", "90.10.12.052.1", "unverified"]);
  });
});

test("one MESC number is one stock item", async () => {
  await inP(async () => {
    await throws(() => mesc.setItemMesc(db, { projectId: P, itemId: pipe2.id, mescCode: "9010120521" }), "MESC_DUPLICATE");
    await throws(() => db.query("UPDATE material_item SET mesc_code = '9010120521' WHERE id = $1", [pipe2.id]), "duplicate key");
  });
});

test("the catalogue import is all-or-nothing, and names its edition", async () => {
  await inP(async () => {
    await throws(() => mesc.importCatalogue(db, { projectId: P, text: CATALOGUE, edition: "" }), "INVALID_INPUT");
    await throws(() => mesc.importCatalogue(db, { projectId: P, text: CATALOGUE + "\n12345,odd", edition: "TEST-1" }), "INVALID_INPUT");
    equal((await db.query("SELECT count(*)::int AS n FROM mesc_entry")).rows[0].n, 0, "nothing half-loaded");
    equal(await mesc.importCatalogue(db, { projectId: P, text: CATALOGUE, edition: "TEST-1", userId: alice.id }), { groups: 3, entries: 4 });
    const b = await mesc.mescBoard(db, { projectId: P });
    equal([b.edition, b.entries], ["TEST-1", 4]);
    const row = b.items.find((i) => i.id === pipe.id);
    equal(row.state.code, "ok", "the earlier code is now verified");
    equal(row.path.map((x) => x.title), ["TEST GROUP A", "TEST SUBGROUP PIPE", "TEST SUB-SUB SEAMLESS"]);
    await throws(() => db.query("DELETE FROM mesc_import"), "permission denied");
  });
});

test("with a catalogue loaded, an unknown code or another unit is refused", async () => {
  await inP(async () => {
    await throws(() => mesc.setItemMesc(db, { projectId: P, itemId: pipe2.id, mescCode: "9010120541" }), "در کاتالوگ");
    await throws(() => mesc.setItemMesc(db, { projectId: P, itemId: gasket.id, mescCode: "9120330011" }), "واحد", "a gasket counted in metres");
    await db.query("UPDATE material_item SET uom = 'EA' WHERE id = $1", [gasket.id]);
    equal((await mesc.setItemMesc(db, { projectId: P, itemId: gasket.id, mescCode: "91.20.33.001.1" })).state.code, "ok");
    const found = await mesc.searchMesc(db, { projectId: P, q: "gasket spiral" });
    equal(found.map((f) => [f.formatted, f.usedBy]), [["91.20.33.001.1", "G-SW-8-300"], ["91.20.33.001.9", null]]);
    equal((await mesc.searchMesc(db, { projectId: P, q: "9010" })).length, 2);
    await mesc.setItemMesc(db, { projectId: P, itemId: gasket.id, mescCode: "" });
    equal((await mesc.mescBoard(db, { projectId: P })).items.find((i) => i.id === gasket.id).state.code, "none");
  });
});

test("the catalogue belongs to one project", async () => {
  const other = await projects.createProject(db, { code: "OTH", name: "O", ownerUserId: alice.id });
  await withProject(db, other.id, async () => {
    equal((await db.query("SELECT count(*)::int AS n FROM mesc_entry")).rows[0].n, 0);
    equal((await mesc.mescBoard(db, { projectId: other.id })).entries, 0);
  });
});

await run();
