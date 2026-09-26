#!/usr/bin/env node
/**
 * Each spool's material from the register, and reserving it in one act,
 * all or nothing.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";
import { spoolBom, materialLine } from "../../lib/piping/spool-bom.mjs";

const PIPE = "PC06TSS00AB", E90 = "AC03C95J0AB", E45 = "AC03C45J0AB";

test("a spool's material is its net pipe length and its fittings, in the drawing's stock codes", async () => {
  const m = buildModel(DEMO, {});
  const bom = spoolBom(m.elements, DEMO.bom);
  const sp1 = bom.get("SP-01");
  const pipe = sp1.find((l) => l.kind === "pipe");
  equal([pipe.stockCode, pipe.uom, pipe.nps], [PIPE, "m", 36]);
  const netMm = m.elements.filter((e) => e.spool === "SP-01" && (e.kind === "pipe" || e.kind === "pup")).reduce((a, e) => a + e.length, 0);
  equal(pipe.qty, Math.round(netMm) / 1000, "net: no cutting allowance added");
  assert(sp1.some((l) => l.stockCode === E45 && l.qty >= 1));
  const all = [...bom.values()].flat();
  const drawn = m.elements.filter((e) => e.kind === "fitting" && !e.ghost).length;
  equal(all.filter((l) => l.kind === "fitting").reduce((a, l) => a + l.qty, 0), drawn, "every fitting the drawing buys, once");
});

test("a size the BOM buys in two codes, or not at all, is left unmatched with the reason", async () => {
  const els = [{ kind: "pipe", length: 1000, nps: 8, spool: "S" }, { kind: "fitting", type: "tee", nps: 8, spool: "S" },
    { kind: "fitting", type: "elbow90", nps: 8, spool: "S", ghost: true }];
  const bom = [{ group: "PIPE", description: "Pipe SCH 40", diam: 8, stockCode: "P40" }, { group: "PIPE", description: "Pipe SCH 80", diam: 8, stockCode: "P80" }];
  const [pipe, tee] = spoolBom(els, bom).get("S");
  equal([pipe.stockCode, /2 ردیف/.test(pipe.reason)], [null, true]);
  equal([tee.stockCode, /در MTO نیست/.test(tee.reason)], [null, true]);
  equal(spoolBom(els, bom).get("S").length, 2, "a ghosted fitting is not bought");
});

test("a line's state: matched, in stock, reserved, issued — or why not", async () => {
  const l = { stockCode: "X", qty: 10, uom: "m" };
  equal(materialLine(l, {}).state, "no_item");
  equal(materialLine(l, { item: { uom: "EA" } }).state, "uom");
  equal(materialLine(l, { item: { uom: "M" }, free: 4 }).state, "short");
  equal(materialLine(l, { item: { uom: "m" }, reserved: 3, free: 7 }).need, 7);
  equal(materialLine(l, { item: { uom: "m" }, reserved: 4, issued: 6 }).state, "reserved");
  equal(materialLine(l, { item: { uom: "m" }, issued: 10 }).state, "issued");
});

// ── against the database ─────────────────────────────────────────────────

process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "spm-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");
const spm = await import("../../lib/db/repos/spool-material.mjs");
const rsv = await import("../../lib/db/repos/reserve.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "SPM", name: "S", ownerUserId: alice.id });
const P = proj.id;
const inP = (fn) => withProject(db, P, fn);
let sp1, sp2;

await inP(async () => {
  const { rows: [line] } = await db.query("INSERT INTO line (project_id, line_no) VALUES ($1,'36-CW-1') RETURNING id", [P]);
  const { rows: [doc] } = await db.query(
    `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'ISO-1','0',$2,'local://x') RETURNING id`, [P, "e".repeat(64)]);
  const r = await runs.createRun(db, { projectId: P, documentId: doc.id, lineId: line.id, payload: DEMO });
  await runs.saveRegister(db, { projectId: P, runId: r.id, documentId: doc.id, lineId: line.id, model: buildModel(DEMO, {}) });
  const { rows } = await db.query("SELECT id, spool_no FROM spool WHERE project_id = $1 ORDER BY spool_no", [P]);
  [sp1, sp2] = rows;
});

let pipeItem;
test("the register writes each spool's material; without the items in the catalogue it cannot be reserved", async () => {
  await inP(async () => {
    const { rows } = await db.query("SELECT count(*)::int AS n FROM spool_material WHERE spool_id = $1", [sp1.id]);
    assert(rows[0].n >= 2, "pipe and fittings of SP-01");
    const m = await spm.spoolMaterial(db, { projectId: P, spoolId: sp1.id });
    assert(m.lines.every((l) => l.state === "no_item") && !m.ready);
    await throws(() => spm.reserveSpoolMaterial(db, { projectId: P, spoolId: sp1.id, userId: alice.id }), "کاتالوگ انبار");
  });
});

test("stock that is not issuable is not reserved; all or nothing", async () => {
  await inP(async () => {
    pipeItem = await wh.upsertItem(db, { projectId: P, code: PIPE, description: "Pipe 36in SCH10", category: "pipe", uom: "m" });
    await wh.upsertItem(db, { projectId: P, code: E90, description: "Elbow 90 36in", category: "fitting", uom: "EA" });
    await wh.upsertItem(db, { projectId: P, code: E45, description: "Elbow 45 36in", category: "fitting", uom: "EA" });
    for (const [code, qty] of [[PIPE, 30], [E90, 4], [E45, 4]]) {
      const { rows: [it] } = await db.query("SELECT id FROM material_item WHERE code = $1", [code]);
      const lot = await wh.receiveLot(db, { projectId: P, itemId: it.id, receiptNo: `MRR-${code}`, receivedOn: "2026-09-01",
        qtyReceived: qty, heatNo: `H-${code}`, mtcRef: `MTC-${code}` });
      await wh.inspectLot(db, { projectId: P, lotId: lot.id, qtyAccepted: qty, inspectedOn: "2026-09-02" });
      if (code !== PIPE) await wh.reviewMtc(db, { projectId: P, lotId: lot.id, mtcStatus: "accepted" });
    }
    const m = await spm.spoolMaterial(db, { projectId: P, spoolId: sp1.id });
    equal(m.lines.find((l) => l.stockCode === PIPE).state, "short", "the pipe's MTC is not accepted: not free");
    await throws(() => spm.reserveSpoolMaterial(db, { projectId: P, spoolId: sp1.id, userId: alice.id }), "کسری");
    equal((await db.query("SELECT count(*)::int AS n FROM material_reservation")).rows[0].n, 0, "nothing reserved by halves");
  });
});

test("reserved once, it holds the spool's material against every other destination", async () => {
  await inP(async () => {
    const { rows: [lot] } = await db.query("SELECT id FROM material_lot WHERE item_id = $1", [pipeItem.id]);
    await wh.reviewMtc(db, { projectId: P, lotId: lot.id, mtcStatus: "accepted" });
    const r = await spm.reserveSpoolMaterial(db, { projectId: P, spoolId: sp1.id, needBy: "2026-10-01", userId: alice.id });
    assert(r.reserved >= 2);
    const m = await spm.spoolMaterial(db, { projectId: P, spoolId: sp1.id });
    assert(m.lines.every((l) => l.state === "reserved"), JSON.stringify(m.lines.map((l) => l.state)));
    await throws(() => spm.reserveSpoolMaterial(db, { projectId: P, spoolId: sp1.id, userId: alice.id }), "پیش‌تر رزرو");
    const need = m.lines.find((l) => l.stockCode === PIPE).qty;
    await throws(() => wh.recordMovement(db, { projectId: P, lotId: lot.id, kind: "issue", qty: 30 - need + 0.5, movedOn: "2026-09-10", spoolId: sp2.id }),
      "رزرو", "SP-02 cannot take SP-01's pipe");
    const iss = await wh.recordMovement(db, { projectId: P, lotId: lot.id, kind: "issue", qty: need, movedOn: "2026-09-10", spoolId: sp1.id });
    assert(iss.reservation_id, "the issue fills SP-01's reservation");
    const after = await spm.spoolMaterial(db, { projectId: P, spoolId: sp1.id });
    equal(after.lines.find((l) => l.stockCode === PIPE).state, "issued");
    // SP-02 already holds half its pipe; what is left free is less than the other half: short.
    const n2 = (await spm.spoolMaterial(db, { projectId: P, spoolId: sp2.id })).lines.find((l) => l.stockCode === PIPE).qty;
    const onHand = Math.round((30 - need) * 1000) / 1000;
    const keep = Math.round((n2 / 2 + 0.1) * 1000) / 1000;
    await wh.recordMovement(db, { projectId: P, lotId: lot.id, kind: "issue", qty: Math.round((onHand - keep) * 1000) / 1000, movedOn: "2026-09-11", purpose: "test" });
    const half = Math.round((n2 / 2) * 1000) / 1000;
    await rsv.reserve(db, { projectId: P, itemId: pipeItem.id, qty: half, spoolId: sp2.id, userId: alice.id });
    const two = (await spm.spoolMaterial(db, { projectId: P, spoolId: sp2.id })).lines.find((l) => l.stockCode === PIPE);
    equal([two.state, two.need], ["short", Math.round((n2 - half) * 1000) / 1000], "its own reservation is not free stock twice");
  });
});

test("spool material belongs to one project", async () => {
  const other = await projects.createProject(db, { code: "OTH", name: "O", ownerUserId: alice.id });
  await withProject(db, other.id, async () => {
    equal((await db.query("SELECT count(*)::int AS n FROM spool_material")).rows[0].n, 0);
  });
});

await run();
