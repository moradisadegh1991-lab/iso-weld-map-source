#!/usr/bin/env node
/**
 * The warehouse: stock as a ledger, issue only what inspection and the MTC
 * allow, and a late-rejected certificate turning into a recall list.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectionState, lotIssuable, lotBalance, checkMovement, shortage } from "../../lib/warehouse/stock.mjs";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";

// ── the engine ───────────────────────────────────────────────────────────

const pipe = { category: "pipe", uom: "m" };
const cable = { category: "cable", uom: "m" };
const lot = (o = {}) => ({ qtyAccepted: 100, qtyRejected: 0, heatNo: "H-1", mtcRef: "MTC-1", mtcStatus: "accepted", ...o });

test("inspection state comes from what the MIR recorded", async () => {
  equal(inspectionState({}), "pending");
  equal(inspectionState({ qtyAccepted: 0, qtyRejected: 10 }), "rejected");
  equal(inspectionState({ qtyAccepted: 8, qtyRejected: 2 }), "partial");
  equal(inspectionState({ qtyAccepted: 10, qtyRejected: 0 }), "accepted");
});

test("traceable material needs a heat and an accepted MTC; cable does not", async () => {
  equal(lotIssuable(lot(), pipe).ok, true);
  equal(lotIssuable(lot({ mtcStatus: "pending" }), pipe).ok, false, "a certificate nobody reviewed is quarantine");
  equal(lotIssuable(lot({ heatNo: null }), pipe).ok, false);
  equal(lotIssuable(lot({ mtcStatus: "rejected" }), pipe).ok, false);
  equal(lotIssuable(lot({ heatNo: null, mtcRef: null, mtcStatus: "pending" }), cable).ok, true);
  equal(lotIssuable(lot({ qtyAccepted: null, qtyRejected: null }), cable).ok, false, "but everything waits for the MIR");
});

test("stock is accepted, less issued, plus returned", async () => {
  const b = lotBalance(lot(), [{ kind: "issue", qty: 30 }, { kind: "issue", qty: 20 }, { kind: "return", qty: 5 }]);
  equal([b.issued, b.returned, b.netIssued, b.onHand], [50, 5, 45, 55]);
});

test("no issue beyond the lot, no return beyond what went out", async () => {
  const moves = [{ kind: "issue", qty: 90 }];
  equal(checkMovement({ kind: "issue", qty: 10 }, lot(), pipe, moves).ok, true, "exactly what is left");
  equal(checkMovement({ kind: "issue", qty: 10.5 }, lot(), pipe, moves).ok, false);
  equal(checkMovement({ kind: "return", qty: 90 }, lot(), pipe, moves).ok, true);
  equal(checkMovement({ kind: "return", qty: 91 }, lot(), pipe, moves).ok, false);
  equal(checkMovement({ kind: "issue", qty: 0 }, lot(), pipe, []).ok, false);
});

test("held stock does not reduce the shortfall", async () => {
  const s = shortage(100, 30, 20, 40);
  equal([s.shortfall, s.availabilityPct], [50, 50], "40 in quarantine cannot be welded");
  equal(shortage(0, 0, 0, 0).availabilityPct, null, "nothing required, no percentage");
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "wh-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "W110", name: "W110", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "OTHER", name: "O", ownerUserId: alice.id });
const P = proj.id;
let spools, item, lotA, lotB, cab;

await withProject(db, P, async () => {
  const { rows: [line] } = await db.query("INSERT INTO line (project_id, line_no) VALUES ($1,'10-P-101') RETURNING id", [P]);
  const { rows: [doc] } = await db.query(
    `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri)
     VALUES ($1,'ISO-1','0',$2,'local://x') RETURNING id`, [P, "e".repeat(64)]);
  const model = buildModel(DEMO, {});
  const r = await runs.createRun(db, { projectId: P, documentId: doc.id, lineId: line.id, payload: DEMO, validationChecks: model.checks });
  await runs.saveRegister(db, { projectId: P, runId: r.id, documentId: doc.id, lineId: line.id, model });
  spools = (await db.query("SELECT id, spool_no FROM spool WHERE project_id = $1 ORDER BY spool_no", [P])).rows;
});

const issue = (lotId, qty, extra = {}) => wh.recordMovement(db, { projectId: P, lotId, kind: "issue", qty,
  movedOn: "2026-09-10", refNo: "MIV-1", spoolId: spools[0].id, ...extra });

test("a received lot is quarantine until the MIR", async () => {
  await withProject(db, P, async () => {
    item = await wh.upsertItem(db, { projectId: P, code: "pipe-10-s40", description: 'PIPE 10" SCH40',
      category: "pipe", uom: "m", spec: "ASTM A106 Gr.B" });
    equal(item.code, "PIPE-10-S40");
    lotA = await wh.receiveLot(db, { projectId: P, itemId: item.id, receiptNo: "MRR-001", receivedOn: "2026-09-01",
      heatNo: "H-771", mtcRef: "MTC-771", qtyReceived: 120 });
    const e = await throws(() => issue(lotA.id, 10), "INVALID_INPUT");
    assert(/MIR/.test(e.message));
  });
});

test("inspection cannot account for more than was received", async () => {
  await withProject(db, P, async () => {
    await throws(() => wh.inspectLot(db, { projectId: P, lotId: lotA.id, qtyAccepted: 110, qtyRejected: 20,
      inspectedOn: "2026-09-02" }), "INVALID_INPUT");
    await wh.inspectLot(db, { projectId: P, lotId: lotA.id, qtyAccepted: 114, qtyRejected: 6, mirRef: "MIR-001",
      inspectedOn: "2026-09-02" });
  });
});

test("accepted pipe with an unreviewed MTC is still not issuable", async () => {
  await withProject(db, P, async () => {
    const e = await throws(() => issue(lotA.id, 10), "INVALID_INPUT");
    assert(/MTC/.test(e.message));
    await wh.reviewMtc(db, { projectId: P, lotId: lotA.id, mtcStatus: "accepted" });
    await issue(lotA.id, 60);
    await issue(lotA.id, 30, { spoolId: spools[1].id });
    await throws(() => issue(lotA.id, 25), "INVALID_INPUT", "24 left");
  });
});

test("an issue says where the material went", async () => {
  await withProject(db, P, async () => {
    await throws(() => issue(lotA.id, 1, { spoolId: null }), "INVALID_INPUT");
  });
});

test("the ledger is corrected by a return, never edited", async () => {
  await withProject(db, P, async () => {
    await wh.recordMovement(db, { projectId: P, lotId: lotA.id, kind: "return", qty: 5, movedOn: "2026-09-12",
      spoolId: spools[1].id });
    const [l] = (await wh.stock(db, { projectId: P })).filter((x) => x.id === lotA.id);
    equal([l.netIssued, l.onHand], [85, 29]);
    await throws(() => db.query("UPDATE material_movement SET qty = 1"), "permission denied");
    await throws(() => db.query("DELETE FROM material_movement"), "permission denied");
  });
});

test("the MIR cannot be revised below what has already gone out", async () => {
  await withProject(db, P, async () => {
    await throws(() => wh.inspectLot(db, { projectId: P, lotId: lotA.id, qtyAccepted: 80, qtyRejected: 40,
      inspectedOn: "2026-09-13" }), "INVALID_INPUT");
  });
});

test("a certificate rejected after issue returns the recall list", async () => {
  await withProject(db, P, async () => {
    // Spool 3 took 5 m and gave all 5 back: it carries none of this heat.
    await issue(lotA.id, 5, { spoolId: spools[2].id });
    await wh.recordMovement(db, { projectId: P, lotId: lotA.id, kind: "return", qty: 5, movedOn: "2026-09-12",
      spoolId: spools[2].id });
    const r = await wh.reviewMtc(db, { projectId: P, lotId: lotA.id, mtcStatus: "rejected" });
    equal(r.recall.map((d) => [d.spool_no, d.qty]).sort(), [[spools[0].spool_no, 60], [spools[1].spool_no, 25]].sort());
    await throws(() => issue(lotA.id, 1), "INVALID_INPUT", "and the rest is quarantine");
    const t = await wh.heatTrace(db, { projectId: P, heatNo: "h-771" });
    equal(t.destinations.length, 2, "the same answer from the heat number");
  });
});

test("the shortfall counts only what can be welded", async () => {
  await withProject(db, P, async () => {
    lotB = await wh.receiveLot(db, { projectId: P, itemId: item.id, receiptNo: "MRR-002", receivedOn: "2026-09-14",
      heatNo: "H-880", mtcRef: "MTC-880", qtyReceived: 50 });
    await wh.setRequirement(db, { projectId: P, itemId: item.id, qty: 200, source: "MTO-10-P Rev.0" });
    const [s] = await wh.shortages(db, { projectId: P });
    // 85 issued (suspect, but on site), 0 issuable, 29 rejected-MTC + 50 pending held.
    equal([s.required, s.issued, s.issuable, s.held, s.shortfall], [200, 85, 0, 79, 115]);
  });
});

test("cable is issued on inspection alone", async () => {
  await withProject(db, P, async () => {
    const c = await wh.upsertItem(db, { projectId: P, code: "CBL-3C35", description: "Cable 3Cx35", category: "cable", uom: "m" });
    cab = await wh.receiveLot(db, { projectId: P, itemId: c.id, receiptNo: "MRR-003", receivedOn: "2026-09-14", qtyReceived: 500 });
    await wh.inspectLot(db, { projectId: P, lotId: cab.id, qtyAccepted: 500, inspectedOn: "2026-09-15" });
    await wh.recordMovement(db, { projectId: P, lotId: cab.id, kind: "issue", qty: 120, movedOn: "2026-09-16",
      purpose: "EC-1203A-P" });
  });
});

test("materials belong to one project", async () => {
  await withProject(db, other.id, async () => {
    equal((await wh.stock(db, { projectId: other.id })).length, 0);
  });
});

await run();
