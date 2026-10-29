#!/usr/bin/env node
/**
 * The second read (lib/extraction/second-read.mjs): two independent readings
 * of one sheet are compared and every disagreement is named, never resolved.
 */
import { test, run, assert, equal } from "./harness.mjs";
import { compareReads } from "../../lib/extraction/second-read.mjs";

const node = (id, type, E, N, EL, ref = "") => ({ id, type, ref, E, N, EL });
const route = () => [
  node("N1", "tie-in", 0, 0, 10000, "A"),
  node("N2", "elbow90", 3000, 0, 10000),
  node("N3", "tie-in", 3000, 2000, 10000, "B"),
];

test("two identical readings agree, even when they number the nodes differently", () => {
  const b = route().map((n, i) => ({ ...n, id: `X${i + 9}` }));
  const r = compareReads({ nodes: route() }, { nodes: b });
  assert(r.agree, r.issues.join("|"));
  equal(r.issues, []);
});

test("a node a few mm apart is the same node; 200 mm apart is a different one", () => {
  const near = route(); near[1].E = 3001;
  assert(compareReads({ nodes: route() }, { nodes: near }).agree, "1 mm is a rounding, not a disagreement");
  const far = route(); far[1].E = 3200;
  const r = compareReads({ nodes: route() }, { nodes: far });
  assert(!r.agree);
  assert(r.issues.some((s) => /فقط در خوانش اول/.test(s)) && r.issues.some((s) => /فقط در خوانش دوم/.test(s)), r.issues.join("|"));
});

test("the same position with another fitting type names both types", () => {
  const b = route(); b[1].type = "elbow45";
  const r = compareReads({ nodes: route() }, { nodes: b });
  assert(r.issues.length === 1 && /elbow90/.test(r.issues[0]) && /elbow45/.test(r.issues[0]), r.issues.join("|"));
});

test("readings that share no frame say so once instead of listing every node", () => {
  const shifted = route().map((n) => ({ ...n, E: n.E + 50000 }));
  const r = compareReads({ nodes: route() }, { nodes: shifted });
  equal(r.issues.length, 1);
  assert(/هم‌چارچوب/.test(r.issues[0]));
});

test("BOM: quantity, size and a row only one reading found", () => {
  const a = [{ pt: 1, diam: 12, qty: 10 }, { pt: 2, diam: 12, qty: 2 }, { pt: 3, diam: 12, qty: 1 }];
  const b = [{ pt: 1, diam: 12, qty: 10 }, { pt: 2, diam: 10, qty: 3 }, { pt: 4, diam: 12, qty: 1 }];
  const r = compareReads({ bom: a }, { bom: b });
  assert(r.issues.some((s) => /ردیف 2: مقدار 2 .* 3/.test(s)), r.issues.join("|"));
  assert(r.issues.some((s) => /ردیف 2: سایز 12/.test(s)));
  assert(r.issues.some((s) => /ردیف 3 فقط در خوانش اول/.test(s)));
  assert(r.issues.some((s) => /ردیف 4 فقط در خوانش دوم/.test(s)));
  assert(!r.issues.some((s) => /ردیف 1/.test(s)), "an agreeing row is not mentioned");
});

test("printed cut lengths: more than 1 mm apart is a disagreement", () => {
  const r = compareReads(
    { cutLengths: [{ piece: 1, lengthMm: 2995 }, { piece: 2, lengthMm: 1200 }] },
    { cutLengths: [{ piece: 1, lengthMm: 2995.5 }, { piece: 2, lengthMm: 1250 }] });
  equal(r.issues.length, 1);
  assert(/طول برش 2/.test(r.issues[0]));
});

test("an empty or missing reading is no verdict: nothing to compare, nothing claimed", () => {
  equal(compareReads({ nodes: route() }, { nodes: [] }).issues, []);
  equal(compareReads(null, undefined).issues, []);
  assert(compareReads({}, {}).agree);
});

test("a long list is cut short and says how many were left out", () => {
  const many = Array.from({ length: 30 }, (_, i) => node(`A${i}`, "tie-in", i * 1000, 0, 0));
  const other = Array.from({ length: 30 }, (_, i) => node(`B${i}`, "tie-in", i * 1000, 0, 0));
  other.forEach((n, i) => { if (i % 2) n.type = "cap"; });
  const r = compareReads({ nodes: many }, { nodes: other });
  assert(r.issues.length === 13 && /و 3 مورد دیگر/.test(r.issues[12]), `${r.issues.length}: ${r.issues[12]}`);
});

await run();
