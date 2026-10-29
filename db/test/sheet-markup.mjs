#!/usr/bin/env node
/**
 * Marks on the isometric sheet (lib/sheet/markup.mjs): what the model read
 * becomes suggested marks, Shop/Field only by the project's declared
 * symbols, and a person can add, move, renumber, retype and delete.
 */
import { test, run, assert, equal } from "./harness.mjs";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";
import { KINDS, fromReaderTags, seedFromPass, addMark, updateMark, removeMark, nextNo, unplaced, problems, normalize } from "../../lib/sheet/markup.mjs";

const SYM = { shop: "circle", field: "square" };
const pass = (items) => ({ items });

test("the four shapes: circle shop, square site, oval spool, hexagon support", () => {
  equal(KINDS["weld-shop"].shape, "circle");
  equal(KINDS["weld-field"].shape, "square");
  equal(KINDS.spool.shape, "oval");
  equal(KINDS.support.shape, "hexagon");
});

test("a weld is shop or field only by the project's declared symbols", () => {
  const r = seedFromPass(pass([
    { kind: "weld", no: "1", shape: "circle", x: 0.1, y: 0.2 },
    { kind: "weld", no: "2", shape: "square", x: 0.3, y: 0.4 },
    { kind: "weld", no: "3", shape: "diamond", x: 0.5, y: 0.6 },
  ]), SYM);
  equal(r.items.map((m) => m.kind), ["weld-shop", "weld-field", "weld-unknown"]);
  equal(seedFromPass(pass([{ kind: "weld", no: "1", shape: "circle", x: 0, y: 0 }]), {}).items[0].kind, "weld-unknown",
    "a project that declared no symbols: nothing is assumed");
});

test("spools and supports keep their kind; every suggestion is marked as the model's", () => {
  const r = seedFromPass(pass([
    { kind: "spool", no: "SP-1", shape: "oval", x: 0.2, y: 0.2 },
    { kind: "support", no: "S-2", shape: "hexagon", x: 0.4, y: 0.4 },
  ]), SYM);
  equal(r.items.map((m) => m.kind), ["spool", "support"]);
  assert(r.items.every((m) => m.src === "model" && m.id));
});

test("no number or no place is dropped and named, never invented", () => {
  const r = seedFromPass(pass([
    { kind: "weld", no: "", shape: "circle", x: 0.1, y: 0.1 },
    { kind: "weld", no: "4", shape: "circle" },
    { kind: "weld", no: "5", shape: "circle", x: "abc", y: 0.1 },
    { kind: "banana", no: "6", x: 0.1, y: 0.1 },
    { kind: "weld", no: "7", shape: "circle", x: 0.1, y: 0.1 },
  ]), SYM);
  equal(r.items.map((m) => m.no), ["7"]);
  equal(r.dropped.length, 4);
});

test("a place outside the sheet is pulled onto it; a number given twice is kept once", () => {
  const r = seedFromPass(pass([
    { kind: "weld", no: "1", shape: "circle", x: 1.4, y: -0.2 },
    { kind: "weld", no: "1", shape: "square", x: 0.5, y: 0.5 },
  ]), SYM);
  equal(r.items.length, 1);
  assert(r.items[0].x === 1 && r.items[0].y === 0);
});

test("a person adds, moves, renumbers, retypes and deletes; an edit makes the mark theirs", () => {
  let items = seedFromPass(pass([{ kind: "weld", no: "1", shape: "circle", x: 0.1, y: 0.1 }]), SYM).items;
  const id = items[0].id;
  items = updateMark(items, id, { x: 0.7, y: 0.8 });
  assert(items[0].x === 0.7 && items[0].y === 0.8 && items[0].src === "hand");
  items = updateMark(items, id, { no: " 12 ", kind: "weld-field" });
  assert(items[0].no === "12" && items[0].kind === "weld-field");
  items = updateMark(items, id, { kind: "not-a-kind" });
  assert(items[0].kind === "weld-field", "an unknown kind changes nothing");
  items = addMark(items, { kind: "support", x: 0.5, y: 0.5 });
  equal(items.length, 2);
  assert(new Set(items.map((m) => m.id)).size === 2, "ids stay unique");
  items = removeMark(items, id);
  equal(items.length, 1);
  assert(items[0].kind === "support" && items[0].src === "hand");
  let threw = false; try { addMark(items, { kind: "bogus", x: 0, y: 0 }); } catch { threw = true; }
  assert(threw, "a mark of no known kind is refused");
});

test("the next number is one past the largest in that class", () => {
  const items = [{ kind: "weld-shop", no: "7" }, { kind: "weld-field", no: "3" }, { kind: "spool", no: "SP-9" }];
  equal(nextNo(items, "weld-shop"), "8", "shop and field welds share one series");
  equal(nextNo(items, "spool"), "1", "a spool number that is not a plain number does not count");
  equal(nextNo([], "support"), "1");
});

test("what still needs placing: the register's welds, shop or field as the ENGINE says, and the spools", () => {
  const m = buildModel(DEMO);
  const todo = unplaced(m.register, m.spoolIds, []);
  equal(todo.filter((t) => t.kind !== "spool").length, m.register.length);
  for (const w of m.register) {
    const t = todo.find((x) => x.no === w.no && x.kind !== "spool");
    equal(t.kind, w.loc === "Field" ? "weld-field" : "weld-shop", `${w.no}`);
  }
  equal(todo.filter((t) => t.kind === "spool").map((t) => t.no), m.spoolIds);
  const placed = [{ kind: "weld-unknown", no: m.register[0].no, x: 0, y: 0 }, { kind: "spool", no: m.spoolIds[0], x: 0, y: 0 }];
  const left = unplaced(m.register, m.spoolIds, placed);
  assert(!left.some((t) => t.no === m.register[0].no) && !left.some((t) => t.no === m.spoolIds[0]),
    "a weld the model already placed by its number is not offered again");
});

test("a weld with no declared location is offered as unknown, not as shop", () => {
  equal(unplaced([{ no: "W-9" }], [], [])[0].kind, "weld-unknown");
});

test("the same number twice in a class, and a mark with no number, are named", () => {
  equal(problems([{ kind: "weld-shop", no: "1" }, { kind: "weld-field", no: "2" }]), []);
  assert(problems([{ kind: "weld-shop", no: "1" }, { kind: "weld-field", no: "1" }]).length === 1, "shop and field welds share one series");
  assert(problems([{ kind: "spool", no: "1" }, { kind: "weld-shop", no: "1" }]).length === 0, "a spool 1 and a weld 1 are different things");
  assert(problems([{ kind: "support", no: "" }]).length === 1);
});

test("a saved payload is cleaned: bad kinds and places are dropped, ids filled", () => {
  const n = normalize([{ kind: "weld-shop", no: "1", x: 0.2, y: 0.3 }, { kind: "zzz", no: "2", x: 0, y: 0 }, { kind: "spool", no: "3", x: "q", y: 0 }, null]);
  equal(n.length, 1);
  assert(n[0].id);
  equal(normalize(undefined), []);
});

test("the reader's ovals and hexagons become spool and support marks, placed where it saw them", () => {
  const items = fromReaderTags([
    { kind: "spool", no: "SP-1", at: [0.0953, 0.3266] },
    { kind: "support", no: "SW-1", at: [0.3174, 0.3443] },
    { kind: "spool", no: "SP-1", at: [0.5, 0.5] },
    { kind: "weld", no: "9", at: [0.1, 0.1] },
    { kind: "spool", no: "", at: [0.1, 0.1] },
    { kind: "support", no: "S-9" },
  ]);
  equal(items.map((m) => `${m.kind}:${m.no}`), ["spool:SP-1", "support:SW-1"]);
  assert(items.every((m) => m.src === "reader" && m.id));
  assert(items[0].x === 0.0953 && items[0].y === 0.3266);
  equal(fromReaderTags(undefined), []);
});

await run();
