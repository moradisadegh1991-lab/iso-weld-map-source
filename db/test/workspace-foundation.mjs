#!/usr/bin/env node
/**
 * Phase 3 — the workspace's pure foundations: selection by persistent identity, duplicate / move, the BOM table's
 * search · filter · sort · row checks, the Validation list and the delete-protection preview.
 * (The server-side protections they mirror — BOM_LOCKED, BOM_IN_USE, installed lines, MARK_IDENTITY_AMBIGUOUS — are tested
 * where they live: register-persistence.mjs, bom-allocation-*.mjs, mark-identity*.mjs.)
 */
import { test, run, assert, equal } from "./harness.mjs";
import { addMark, placeAt, updateMark, removeMark, duplicateMark, markRef, isMark, findMark, withIds, normalize } from "../../lib/sheet/markup.mjs";
import { decorate, view, ledgerByPt, rowIssues, deleteCheck } from "../../lib/register/bom-table.mjs";
import { collectFindings, refFromMessage } from "../../lib/register/workspace-validation.mjs";
import { protectionFor, protector } from "../../lib/register/mark-protection.mjs";

const UID_A = "3f2a6c1e-8b0d-4d57-9a4e-0c1f2a3b4c5d", UID_B = "9a1b2c3d-4e5f-4a6b-8c7d-1e2f3a4b5c6d";
const sheet = () => [
  { id: "m1", uid: UID_A, kind: "weld-shop", no: "1", x: 0.2, y: 0.3, attrs: { size: '4"', c1: "1", c2: "2" } },
  { id: "m2", uid: UID_B, kind: "weld-field", no: "2", x: 0.5, y: 0.4, attrs: {} },
  { id: "m3", kind: "spool", no: "SP-1", x: 0.7, y: 0.6, attrs: {} },          // saved before identities existed: legacy handle only
];

test("markRef is the uid; the legacy handle only when there is none; never the printed number", () => {
  const [a, , c] = sheet();
  equal(markRef(a), UID_A);
  equal(markRef(c), "m3");
  assert(markRef(a) !== a.no, "the number is not an identity");
});

test("isMark / findMark accept the uid and the legacy handle, and nothing else", () => {
  const items = sheet();
  equal(findMark(items, UID_A).no, "1");
  equal(findMark(items, "m1").no, "1");            // an old caller still holding the handle
  equal(findMark(items, "m3").no, "SP-1");
  equal(findMark(items, "1"), null);                // the printed number selects nothing
  equal(findMark(items, ""), null);
  equal(findMark(items, null), null);
  assert(!isMark(items[0], undefined));
});

test("two marks with the same printed number are still told apart by uid", () => {
  const items = [...sheet(), { id: "m4", uid: "5d6e7f80-1a2b-4c3d-8e4f-5a6b7c8d9e0f", kind: "weld-shop", no: "1", x: 0.9, y: 0.9, attrs: {} }];
  equal(items.filter((m) => isMark(m, UID_A)).length, 1);
  equal(findMark(items, "5d6e7f80-1a2b-4c3d-8e4f-5a6b7c8d9e0f").x, 0.9);
});

test("move keeps the uid (and the legacy id); only the position changes", () => {
  const before = sheet();
  const moved = placeAt(before, UID_A, { x: 0.6, y: 0.1 }, 1.4);
  const m = findMark(moved, UID_A);
  equal(m.uid, UID_A); equal(m.id, "m1");
  assert(m.x !== 0.2 || m.y !== 0.3, "moved");
  assert(m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1, "positions stay 0..1 fractions of the sheet, never screen pixels");
  equal(findMark(before, UID_A).x, 0.2);           // the input is not mutated
});

test("edit through a uid or a legacy handle reaches the same mark; the uid survives", () => {
  const a = updateMark(sheet(), UID_B, { no: "22" });
  equal(findMark(a, UID_B).no, "22"); equal(findMark(a, UID_B).uid, UID_B);
  const b = updateMark(sheet(), "m3", { no: "SP-9" });
  equal(findMark(b, "m3").no, "SP-9");
});

test("duplicate: a new uid, the attributes copied, a new number, the original untouched", () => {
  const items = sheet();
  const r = duplicateMark(items, UID_A, 1.4);
  assert(r.key && r.key !== UID_A, "new identity");
  const copy = findMark(r.items, r.key), orig = findMark(r.items, UID_A);
  assert(copy.uid && copy.uid !== UID_A, "the copy has its own uid");
  equal(copy.attrs.size, '4"'); equal(copy.attrs.c1, "1");
  assert(copy.no !== orig.no, "a copy takes a new number");
  assert(copy.attrs !== orig.attrs, "attributes are copied, not shared");
  equal(orig.no, "1"); equal(orig.uid, UID_A); equal(r.items.length, items.length + 1);
  equal(duplicateMark(items, "nope").key, null);
});

test("delete removes by uid or legacy handle and nothing else", () => {
  equal(removeMark(sheet(), UID_A).length, 2);
  equal(removeMark(sheet(), "m3").length, 2);
  equal(removeMark(sheet(), "1").length, 3);
});

// ── BOM table ────────────────────────────────────────────────────────────────────────────────────────
const BOM = [
  { pt: 1, group: "pipe", description: "PIPE SMLS", diam: '4"', stockCode: "P-100", qty: 12, qtyUnit: "m" },
  { pt: 2, group: "fitting", description: "ELBOW 90 LR", diam: '4"', stockCode: "E-200", qty: 3, qtyUnit: "pcs" },
  { pt: 3, group: "flange", description: "", diam: '2"', stockCode: "F-300", qty: "", qtyUnit: "pcs" },
];

test("BOM view: search matches any column, case-insensitively", () => {
  const all = decorate(BOM);
  equal(view(all, { query: "elbow" }).length, 1);
  equal(view(all, { query: "P-100" })[0].row.pt, 1);
  equal(view(all, { query: "zzz" }).length, 0);
  equal(view(all, { query: "" }).length, 3);
});

test("BOM view: sort by PT and qty both ways, blanks last, stable", () => {
  const all = decorate(BOM);
  equal(view(all, { sort: { key: "pt", dir: "desc" } }).map((d) => d.row.pt).join(), "3,2,1");
  equal(view(all, { sort: { key: "qty", dir: "asc" } }).map((d) => d.row.pt).join(), "2,1,3");
  equal(view(all, { sort: { key: "qty", dir: "desc" } }).map((d) => d.row.pt).join(), "1,2,3");
  equal(view(all, {}).map((d) => d.row.pt).join(), "1,2,3");
});

test("BOM row checks: missing PT / description / quantity, duplicate PT, negative quantity", () => {
  assert(rowIssues({ pt: "", description: "x", qty: 1 }, []).some((x) => /PT/.test(x)));
  assert(rowIssues({ pt: 1, description: "", qty: 1 }, []).some((x) => /شرح/.test(x)));
  assert(rowIssues({ pt: 1, description: "x", qty: "" }, []).some((x) => /تعداد/.test(x)));
  assert(rowIssues({ pt: 1, description: "x", qty: -2 }, []).some((x) => /تعداد/.test(x)));
  const dup = [{ pt: 1, description: "a", qty: 1 }, { pt: "1", description: "b", qty: 1 }];
  assert(rowIssues(dup[0], dup).some((x) => /تکراری/.test(x)));
  equal(rowIssues({ pt: 1, description: "x", qty: 2 }, [{ pt: 1 }]).length, 0);
  equal(view(decorate(BOM), { filter: "issues" }).map((d) => d.row.pt).join(), "3");
});

test("BOM view: the saved ledger drives the reserved / installed / unused filters", () => {
  const ledger = ledgerByPt({ rows: [{ pt: 1, reserved: 0, installed: 4, left: 8 }, { pt: 2, reserved: 2, installed: 0, left: 1 }, { pt: 3, reserved: 0, installed: 0, left: null }] });
  const all = decorate(BOM, { ledger });
  equal(view(all, { filter: "installed" }).map((d) => d.row.pt).join(), "1");
  equal(view(all, { filter: "reserved" }).map((d) => d.row.pt).join(), "2");
  equal(view(all, { filter: "unused" }).map((d) => d.row.pt).join(), "3");
});

test("BOM delete check: approved revision locks; installed refuses; reserved warns; free is allowed", () => {
  const ledger = ledgerByPt({ rows: [{ pt: 1, reserved: 0, installed: 4 }, { pt: 2, reserved: 2, installed: 0 }] });
  const all = decorate(BOM, { ledger });
  equal(deleteCheck(all[0], { locked: true }).code, "BOM_LOCKED");
  equal(deleteCheck(all[0]).code, "BOM_INSTALLED"); equal(deleteCheck(all[0]).ok, false);
  const warn = deleteCheck(all[1]); equal(warn.ok, true); equal(warn.warn, true);
  equal(deleteCheck(all[2]).ok, true); assert(!deleteCheck(all[2]).warn);
});

test("empty BOM: an empty list is a valid, viewable state", () => {
  equal(decorate([]).length, 0); equal(view(decorate([]), { query: "x", filter: "issues" }).length, 0);
  equal(ledgerByPt(null).size, 0);
});

// ── Validation list ──────────────────────────────────────────────────────────────────────────────────
test("Validation: duplicate / unnumbered / unplaced marks point at the mark by uid", () => {
  const items = [
    { id: "m1", uid: UID_A, kind: "weld-shop", no: "1", x: 0.1, y: 0.1, attrs: {} },
    { id: "m2", uid: UID_B, kind: "weld-shop", no: "1", x: 0.2, y: 0.2, attrs: {} },
    { id: "m3", kind: "spool", no: "", x: 0.3, y: 0.3, attrs: {} },
    { id: "m4", kind: "support", no: "S-1", attrs: {} },
  ];
  const { findings } = collectFindings({ items });
  const dup = findings.find((f) => /دو بار/.test(f.message)); equal(dup.ref, UID_B);
  equal(findings.find((f) => /شماره ندارد/.test(f.message)).ref, "m3");
  equal(findings.find((f) => /جا ندارد/.test(f.message)).ref, "m4");
});

test("Validation: a check about «سرجوش N:» links only when N is on the sheet exactly once", () => {
  const items = sheet();
  equal(refFromMessage(items, "سرجوش 1: قطعهٔ ۱ (PT 9) در BOM این برگ نیست"), UID_A);
  equal(refFromMessage([...items, { id: "m9", kind: "weld-shop", no: "1", attrs: {} }], "سرجوش 1: x"), null);
  equal(refFromMessage(items, "PT 4 (…): ایراد"), null);
  const { findings } = collectFindings({ items, bom: [{ pt: 5, description: "x", qty: 1 }] });
  assert(findings.some((f) => f.source === "weld parts" && f.ref === UID_A), "the BOM check is listed and linked");
});

test("Validation: a clean sheet lists nothing; register problems are errors without a link", () => {
  equal(collectFindings({ items: [] }).total, 0);
  const r = collectFindings({ registerProblems: ["شمارهٔ جوش تکراری"] });
  equal(r.findings[0].level, "error"); equal(r.findings[0].ref, null);
});

test("Validation: BOM rows and the cut table feed the same list", () => {
  const { findings } = collectFindings({ items: [], bom: [], bomRows: [{ pt: 1, description: "", qty: 1 }], cutRows: [], cutLengths: [] });
  assert(findings.some((f) => f.source === "bom" && /شرح/.test(f.message)));
});

// ── delete-protection preview ───────────────────────────────────────────────────────────────────────
const eqMark = { id: "m7", uid: UID_A, kind: "equipment", no: "E-1", attrs: {} };

test("protection: installed or tested equipment is refused, planned is not", () => {
  equal(protectionFor(eqMark, { equipment: [{ markId: UID_A, status: "installed", accessories: [] }] }).blocked, true);
  equal(protectionFor(eqMark, { equipment: [{ markId: UID_A, status: "tested", accessories: [] }] }).blocked, true);
  const ok = protectionFor(eqMark, { equipment: [{ markId: UID_A, status: "planned", accessories: [] }] });
  equal(ok.blocked, false); equal(ok.reasons.length, 0);
});

test("protection: an installed accessory blocks its equipment; a delivered one does not", () => {
  const acc = (status) => ({ equipment: [{ markId: UID_A, status: "planned", accessories: [{ pt: 4, status }] }] });
  equal(protectionFor(eqMark, acc("installed")).blocked, true);
  equal(protectionFor(eqMark, acc("delivered")).blocked, false);
});

test("protection: allocation lines — installed refuses, reserved warns, another owner's are ignored", () => {
  const weld = { id: "m1", uid: UID_A, kind: "weld-shop", no: "1", attrs: {} };
  const line = (ownerRef, status) => ({ lines: [{ ownerRef, pt: 2, qty: 1, unit: "pcs", status }] });
  equal(protectionFor(weld, line(UID_A, "installed")).blocked, true);
  const w = protectionFor(weld, line(UID_A, "reserved")); equal(w.blocked, false); equal(w.warn, true);
  const o = protectionFor(weld, line(UID_B, "installed")); equal(o.blocked, false); equal(o.warn, false);
});

test("protection: matches saved rows by uid, and by legacy handle only for rows saved before identities", () => {
  const legacy = { id: "m7", kind: "equipment", no: "E-1", attrs: {} };   // no uid yet
  equal(protectionFor(legacy, { equipment: [{ markId: "x", legacyId: "m7", status: "installed", accessories: [] }] }).blocked, true);
  equal(protectionFor(eqMark, { equipment: [{ markId: "other", legacyId: "m9", status: "installed", accessories: [] }] }).blocked, false);
  equal(protectionFor({ ...eqMark, no: "other" }, { equipment: [{ markId: UID_A, status: "installed", accessories: [] }] }).blocked, true);   // by identity, not number
});

test("protection: an approved revision refuses the delete of a mark that has saved state; a draft-only mark is free", () => {
  const eq = { equipment: [{ markId: UID_A, status: "planned", accessories: [] }], locked: true };
  const p = protectionFor(eqMark, eq); equal(p.blocked, true); assert(/تأیید/.test(p.reasons[0]));
  equal(protectionFor({ id: "m8", uid: UID_B, kind: "weld-shop", no: "9", attrs: {} }, { equipment: [], lines: [], locked: true }).blocked, false);
});

test("protector(): looks the mark up by uid or handle; an unknown ref is not blocked", () => {
  const items = [eqMark];
  const saved = { equipment: [{ markId: UID_A, status: "installed", accessories: [] }] };
  equal(protector(items, saved)(UID_A).blocked, true);
  equal(protector(items, saved)("m7").blocked, true);
  equal(protector(items, saved)("zzz").blocked, false);
});

run();
