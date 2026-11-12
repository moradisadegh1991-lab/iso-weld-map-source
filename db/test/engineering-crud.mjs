#!/usr/bin/env node
/**
 * Phase 5 — the engineering interaction layer (docs/audit/phase-5-engineering-crud.md).
 *
 * The right-click menu offers the right actions and every one targets the mark's persistent reference; a duplicate takes the engineering
 * description but not the item's installation state or any ownership; deleting a protected item is refused (the preview names the
 * authorised way; the server refuses regardless); a correction made against an old copy of a run is refused, never merged over; an approved
 * revision cannot be corrected; typed weld rows keep their own semantics. Browser behaviour is checked by driving the real page
 * (tools/drive-engineering-crud.mjs) — there is no DOM test runner in this repository.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
import { isUid, newUid } from "../../lib/sheet/mark-identity.mjs";
import { normalize, findMark, markRef, isMark, placeAt, duplicateMark, removeMark, updateMark } from "../../lib/sheet/markup.mjs";
import { markMenu, emptyMenu } from "../../lib/sheet/mark-menu.mjs";
import { protectionFor, protector } from "../../lib/register/mark-protection.mjs";
import { ledgerDemands } from "../../lib/register/bom-allocation.mjs";
import { itemsFromWeldRows, weldRowsFromItems, withRowIds } from "../../lib/sheet/weld-list-marks.mjs";
import { payloadHash } from "../../lib/review/payload-hash.mjs";

const UA = newUid(), UB = newUid(), UE = newUid();
const sheet = () => normalize([
  { id: "m1", uid: UA, kind: "weld-shop", no: "5", x: 0.2, y: 0.2, attrs: { size: "4", c1: "2" } },
  { id: "m2", uid: UB, kind: "weld-field", no: "5", x: 0.6, y: 0.6, attrs: { size: "6" } },          // the SAME printed number as m1
  { id: "m3", uid: UE, kind: "equipment", no: "V-1", x: 0.5, y: 0.5, attrs: { tag: "T-1", type: "valve", status: "installed", acc: "7×2", welds: "5" } },
  { id: "m4", kind: "spool", no: "SP-1", x: 0.7, y: 0.7 },                                           // saved before identities: a legacy mark
  { id: "m5", kind: "support", no: "S-1", x: 0.8, y: 0.8 },
]);

// ── the menu ─────────────────────────────────────────────────────────────

test("1. right-click on a mark offers view, edit, duplicate, move, delete; look-only offers view alone", () => {
  equal(markMenu({ ref: UA }).map((i) => i.k), ["view", "edit", "duplicate", "move", "delete"]);
  equal(markMenu({ ref: UA, readOnly: true }).map((i) => i.k), ["view"]);
  assert(markMenu({ ref: UA }).find((i) => i.k === "delete").danger, "delete is marked dangerous");
});

test("2. every item targets the clicked mark's uid — also when two marks print the same number", () => {
  const items = sheet();
  for (const it of markMenu({ ref: markRef(items[1]) })) equal(findMark(items, it.target).uid, UB, "the second «5», not the first");
  equal(items.filter((m) => m.no === "5").length, 2);
  assert(markMenu({ ref: UA }).every((i) => i.target === UA && i.target !== "5"), "never the printed number");
});

test("13. a legacy mark (no uid) is targeted by its legacy id and still resolves", () => {
  const items = sheet();
  const legacy = items.find((m) => m.kind === "spool");
  const ref = markRef(legacy);
  assert(isUid(legacy.uid) || ref === "m4", "uid when it has one, else the handle");
  for (const it of markMenu({ ref })) equal(findMark(items, it.target).no, "SP-1");
});

test("1b. right-click on the empty sheet offers the four creatable object types, none on a look-only sheet", () => {
  const kinds = emptyMenu().map((i) => i.kind);
  equal(kinds, ["weld-shop", "weld-field", "spool", "support", "equipment"]);
  assert(!kinds.includes("weld-unknown"), "a new weld is Shop or Field");
  equal(emptyMenu({ readOnly: true }), []);
});

// ── move and duplicate ───────────────────────────────────────────────────

test("3. move keeps the uid and changes only the coordinates", () => {
  const items = sheet();
  const moved = placeAt(items, UB, { x: 0.9, y: 0.1 });
  const before = findMark(items, UB), after = findMark(moved, UB);
  equal(after.uid, UB); equal(after.id, before.id); equal(after.no, before.no); equal(after.attrs, before.attrs);
  assert(after.x !== before.x || after.y !== before.y);
  equal(findMark(moved, UA).x, findMark(items, UA).x, "no other mark moved");
});

test("4,5. a duplicate gets a new uid and the engineering attributes, but not the installation state or any ownership", () => {
  const items = sheet();
  const { items: next, key } = duplicateMark(items, UE);
  const copy = findMark(next, key), orig = findMark(next, UE);
  assert(isUid(copy.uid) && copy.uid !== UE, "new identity");
  equal(orig.attrs.status, "installed", "the original keeps its state");
  assert(!("status" in copy.attrs), "the copy starts planned: «installed» is the original's history, not a description");
  equal(copy.attrs.tag, "T-1"); equal(copy.attrs.type, "valve"); equal(copy.attrs.acc, "7×2");
  assert(copy.no !== orig.no, "a copy needs its own number");
  // allocation lines are keyed by identity: the copy would reserve for itself, never inherit the original's lines
  const BOM = [{ pt: 7, description: "STUD BOLT SET", diam: "4", qty: 10, qtyUnit: "pcs" }];
  const demands = ledgerDemands(next, BOM).filter((d) => d.pt === 7);
  equal(new Set(demands.map((d) => d.ownerRef)).size, demands.length, "one owner per item");
  assert(demands.some((d) => d.ownerRef === UE) && demands.some((d) => d.ownerRef === copy.uid));
  // a weld has no state attribute: everything it describes is copied
  const w = duplicateMark(items, UA);
  const wa = findMark(w.items, w.key).attrs; equal([wa.size, wa.c1, Object.keys(wa).length], ["4", "2", 2]);
});

test("14. typed weld rows: the same actions work on rows, by the row's uid, without becoming sheet marks", () => {
  const rows = withRowIds([{ no: "1", spool: "SP-1", loc: "Shop", kind: "BW", nps: "4" }, { no: "2", spool: "SP-1", loc: "Field", kind: "BW", nps: "4" }]);
  const items = normalize(itemsFromWeldRows(rows, {}, [], { [rows[0].uid]: { x: 0.3, y: 0.3, src: "hand" } }));
  equal(markMenu({ ref: markRef(items[0]) })[0].target, rows[0].uid, "the target is the row's uid");
  const dup = duplicateMark(items, rows[0].uid);
  const back = weldRowsFromItems(dup.items, rows);
  equal(back.rows.length, 3); assert(back.rows[2].uid !== rows[0].uid && isUid(back.rows[2].uid));
  const gone = weldRowsFromItems(removeMark(items, rows[1].uid), rows);
  equal(gone.rows.map((r) => r.uid), [rows[0].uid], "delete removes that row only");
  assert(items.every((m) => m.kind.startsWith("weld")), "the rows are not turned into spool/support/equipment marks");
});

// ── delete protection ────────────────────────────────────────────────────

test("6,7. the delete preview refuses installed / tested items and names the authorised way; reserved only warns", () => {
  const eq = sheet().find((m) => m.kind === "equipment");
  const held = protectionFor(eq, { equipment: [{ markId: UE, status: "installed", accessories: [] }] });
  equal(held.blocked, true);
  assert(/برنامه‌ریزی‌شده/.test(held.reasons.join(" ")), "says how: return the status to planned");
  const line = protectionFor(sheet()[0], { lines: [{ ownerRef: UA, pt: 2, qty: 1, unit: "pcs", status: "installed" }] });
  equal(line.blocked, true); assert(/برگرداندن|return/.test(line.reasons.join(" ")), "says how: return it in the allocation ledger");
  const warn = protectionFor(sheet()[0], { lines: [{ ownerRef: UA, pt: 2, qty: 1, unit: "pcs", status: "reserved" }] });
  equal(warn.blocked, false); equal(warn.warn, true);
});

test("12. an approved revision blocks the delete of anything with saved state and says a new revision is the way", () => {
  const p = protector(sheet(), { equipment: [{ markId: UE, status: "planned", accessories: [] }], lines: [], locked: true })(UE);
  equal(p.blocked, true); assert(/رویژن جدید/.test(p.reasons[0]));
  equal(protector(sheet(), { equipment: [], lines: [], locked: true })(UA).blocked, false, "a draft-only mark has nothing saved to protect");
});

test("8,9,10. table and drawing resolve the same mark from either side; an edit shows in both", () => {
  const items = sheet();
  const fromDrawing = markRef(items.find((m) => m.uid === UB));      // what a click on the drawing selects
  const fromTable = markRef(findMark(items, UB));                     // what a click on its row selects
  equal(fromDrawing, fromTable);
  assert(isMark(items[1], fromTable) && !isMark(items[0], fromTable), "only that mark, though another prints the same number");
  const saved = updateMark(items, fromTable, { no: "50", attrs: { size: "8" } });
  equal(findMark(saved, UB).no, "50"); equal(findMark(saved, UB).attrs.size, "8");
  equal(saved.filter((m) => m.no === "5").length, 1, "the other «5» is untouched");
});

// ── the server ───────────────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("ecrud-db-");
process.env.STORAGE_ROOT = await scratchDir("ecrud-store-");
const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const runsRoute = await import("../../app/api/runs/route.js");
const runRoute = await import("../../app/api/runs/[id]/route.js");
const editsRoute = await import("../../app/api/runs/[id]/edits/route.js");
const approveRoute = await import("../../app/api/runs/[id]/approve/route.js");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) =>
  new Request(url, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const db = await getDb();
const pr = await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", body: { code: "ECR", name: "E" } })));
const projectId = pr.body.project.id;
const q = (sql, p = []) => withProject(db, projectId, async () => (await db.query(sql, p)).rows);
let seq = 0;
const newDoc = async (docNo) => (await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST",
  body: { projectId, docNo, revision: "0", fileBase64: Buffer.from(`scan ${docNo} ${++seq}`).toString("base64") } })))).body.document.id;
const ROWS = () => [{ no: "1", spool: "SP-1", loc: "Shop", kind: "BW", nps: "4", uid: newUid() }, { no: "2", spool: "SP-1", loc: "Field", kind: "BW", nps: "4", uid: newUid() }];
const EQ = { id: "m9", uid: newUid(), kind: "equipment", no: "V-1", x: 0.5, y: 0.5, src: "hand", attrs: { tag: "T-1", type: "valve", status: "installed" } };
const payload = (rows, extra = {}) => ({ meta: { drawingNo: "ECR-1", sheet: "1/1", lineNo: "ECR-L1", nps: 4 }, weldList: rows, ...extra });
const post = async (documentId, rows, extra) => json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId, documentId, lineNo: "ECR-L1", payload: payload(rows, extra) } })));
const get = async (id) => json(await runRoute.GET(req(`http://x/api/runs/${id}?projectId=${projectId}`), ctx(id)));
const correct = async (id, edited, baseHash = undefined) => json(await editsRoute.POST(req(`http://x/api/runs/${id}/edits`, { method: "POST", body: { projectId, payload: edited, reason: "t", baseHash: baseHash === undefined ? payloadHash(await stored(id)) : baseHash } }), ctx(id)));
const stored = async (id) => (await q("SELECT payload FROM extraction_run WHERE id = $1", [id]))[0].payload;
let docA, runA;

test("the run's fingerprint is handed out with the run, and is the stored payload's", async () => {
  docA = await newDoc("ECR-A");
  const r = await post(docA, ROWS(), { sheetMarkup: { page: 1, items: [EQ] } });
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  runA = r.body.run.id;
  const g = await get(runA);
  equal(g.status, 200);
  equal(g.body.run.payloadHash, payloadHash(await stored(runA)));
});

test("11. a correction made against the current state is applied and returns the new fingerprint; the same base again is stale", async () => {
  const g = await get(runA), base = g.body.run.payloadHash;
  const edited = JSON.parse(JSON.stringify(g.body.payload));
  edited.weldList[0].nps = "6";
  const ok = await correct(runA, edited, base);
  equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 300));
  equal(ok.body.payloadHash, payloadHash(await stored(runA)), "the response carries the new state's fingerprint");
  assert(ok.body.payloadHash !== base);
  const again = JSON.parse(JSON.stringify(edited)); again.weldList[1].nps = "8";
  const stale = await correct(runA, again, base);                                    // the second engineer, still holding the old copy
  equal(stale.status, 409, JSON.stringify(stale.body).slice(0, 300));
  equal(stale.body.code, "STALE_RUN");
  const now = await stored(runA);
  equal(now.weldList.map((w) => w.nps), ["6", "4"], "nothing of the stale correction was written");
  const n = (await q("SELECT count(*)::int AS n FROM extraction_edit WHERE extraction_run_id = $1", [runA]))[0].n;
  assert(n >= 1 && !(await q("SELECT 1 FROM extraction_edit WHERE extraction_run_id = $1 AND path = 'weldList[1].nps'", [runA])).length, "and no edit was logged for it");
});

test("11b. two corrections racing on one base: exactly one is applied, the other is told it is stale", async () => {
  const g = await get(runA), base = g.body.run.payloadHash;
  const a = JSON.parse(JSON.stringify(g.body.payload)), b = JSON.parse(JSON.stringify(g.body.payload));
  a.weldList[0].spool = "SP-A"; b.weldList[0].spool = "SP-B";
  const [x, y] = await Promise.all([correct(runA, a, base), correct(runA, b, base)]);
  equal([x.status, y.status].sort(), [200, 409], JSON.stringify([x.body, y.body]).slice(0, 400));
  equal([x, y].find((r) => r.status === 409).body.code, "STALE_RUN");
  const spool = (await stored(runA)).weldList[0].spool;
  assert(spool === "SP-A" || spool === "SP-B", "one of them, whole");
});

test("the correction helper obtains a current version token for existing callers", async () => {
  const g = await get(runA);
  const edited = JSON.parse(JSON.stringify(g.body.payload)); edited.weldList[0].nps = "10";
  equal((await correct(runA, edited)).status, 200);
});

test("7b. the server refuses to remove an installed item whatever the page showed; nothing is changed", async () => {
  const g = await get(runA), before = g.body.run.payloadHash;
  const edited = JSON.parse(JSON.stringify(g.body.payload));
  edited.sheetMarkup.items = [];                                                       // the equipment mark deleted
  const r = await correct(runA, edited, before);
  equal(r.status, 409, JSON.stringify(r.body).slice(0, 300));
  assert(/نصب|installed/i.test(JSON.stringify(r.body)), "says why");
  equal((await get(runA)).body.run.payloadHash, before, "the run is exactly as it was — the correction rolled back whole");
  equal((await q("SELECT count(*)::int AS n FROM iso_equipment WHERE document_id = $1", [docA]))[0].n, 1);
});

test("12b. an approved revision cannot be corrected", async () => {
  const docB = await newDoc("ECR-B");
  const s = await post(docB, ROWS());
  equal(s.status, 201, JSON.stringify(s.body).slice(0, 300));
  const id = s.body.run.id;
  const ap = await json(await approveRoute.POST(req(`http://x/api/runs/${id}/approve`, { method: "POST", body: { projectId } }), ctx(id)));
  equal(ap.status, 200, JSON.stringify(ap.body).slice(0, 300));
  const g = await get(id);
  const edited = JSON.parse(JSON.stringify(g.body.payload)); edited.weldList[0].nps = "8";
  const r = await correct(id, edited, g.body.run.payloadHash);
  assert(r.status === 409 || r.status === 423 || r.status === 403, `refused (${r.status})`);
  equal(r.body.code, "RUN_LOCKED");
});

await run();
