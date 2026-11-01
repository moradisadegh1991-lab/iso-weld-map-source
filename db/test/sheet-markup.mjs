#!/usr/bin/env node
/**
 * Marks on the isometric sheet (lib/sheet/markup.mjs): what the model read
 * becomes suggested marks, Shop/Field only by the project's declared
 * symbols, and a person can add, move, renumber, retype and delete.
 */
import { test, run, assert, equal } from "./harness.mjs";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";
import { KINDS, SHEET_SIZE, plainNo, isPlaced, notOnSheet, engineRow, frameSpot, placeAt, unplace, materialAt, scheduleOf, rules, fromReaderTags, fromEngine, seedFromPass, addMark, updateMark, removeMark, nextNo, problems, normalize } from "../../lib/sheet/markup.mjs";

import { suggestFromDots, orderAlongPipe } from "../../lib/sheet/weld-dots.mjs";
import { itemsFromWeldRows, weldRowsFromItems, withRowIds, registerRow, rowTyped } from "../../lib/sheet/weld-list-marks.mjs";

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

test("a weld's leader end is kept when the model saw it, never guessed when it did not", () => {
  const r = seedFromPass(pass([
    { kind: "weld", no: "1", shape: "circle", x: 0.2, y: 0.2, tx: 0.25, ty: 0.3 },
    { kind: "weld", no: "2", shape: "square", x: 0.4, y: 0.4, tx: null, ty: null },
    { kind: "weld", no: "3", shape: "square", x: 0.5, y: 0.5 },
    { kind: "weld", no: "4", shape: "square", x: 0.5, y: 0.5, tx: "q", ty: 0.2 },
    { kind: "spool", no: "SP-1", shape: "oval", x: 0.6, y: 0.6, tx: 0.1, ty: 0.1 },
  ]), SYM);
  const by = Object.fromEntries(r.items.map((m) => [m.no, m]));
  assert(by["1"].ax === 0.25 && by["1"].ay === 0.3, "the end of the leader the model saw");
  assert(!("ax" in by["2"]) && !("ax" in by["3"]) && !("ax" in by["4"]), "no end seen, or a malformed one: no leader");
  assert(!("ax" in by["SP-1"]), "a spool has no weld point");
});

test("a leader can be taken away: a weld point that is not known is not drawn", () => {
  let items = normalize([{ kind: "weld-shop", no: "1", x: 0.3, y: 0.3, ax: 0.2, ay: 0.2 }]);
  items = updateMark(items, items[0].id, { ax: null, ay: null });
  assert(!("ax" in items[0]) && !("ay" in items[0]));
  items = updateMark(items, items[0].id, { ax: 0.5, ay: 0.6 });
  assert(items[0].ax === 0.5 && items[0].ay === 0.6, "and put back");
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

test("a weld's number is shown as the number alone, so its frame takes little room", () => {
  equal(["W-01", "W-12", "SW-3", "7", "4-1", "W-004", " 13 "].map(plainNo), ["1", "12", "3", "7", "4-1", "4", "13"]);
  equal(plainNo("A7B"), "A7B", "something that is not a prefix and a number is kept as typed");
});

test("a row of the table with no place is not on the sheet; it is not lost, and it has no leader", () => {
  const n = normalize([{ kind: "weld-field", no: "1", ax: 0.2, ay: 0.2, attrs: { type: "SW" } }, { kind: "spool", no: "SP-1", x: 0.3, y: 0.3 }]);
  equal(n.length, 2);
  assert(!isPlaced(n[0]) && !("ax" in n[0]), "no place: no leader either");
  equal(n[0].attrs, { type: "SW" });
  equal(notOnSheet(n).map((m) => m.no), ["1"]);
});

test("a row is joined to the drawing at a weld point: the leader ends there, the frame stands beside it", () => {
  let items = addMark([], { kind: "weld-field", no: "1" });
  assert(!isPlaced(items[0]));
  items = placeAt(items, items[0].id, { x: 0.4, y: 0.5 }, 1.414);
  const m = items[0];
  assert(m.ax === 0.4 && m.ay === 0.5 && isPlaced(m), "joined at the point clicked");
  assert(Math.hypot((m.x - m.ax) * 1.414, m.y - m.ay) > 0.04, "the frame stands off the weld point");
  assert(m.src === "hand");
  // moved: the frame keeps the offset a person gave it from the point
  const dragged = updateMark(items, m.id, { x: m.x + 0.08, y: m.y + 0.03 })[0];
  const moved = placeAt([dragged], m.id, { x: 0.6, y: 0.5 }, 1.414)[0];
  assert(Math.abs((moved.x - moved.ax) - (dragged.x - dragged.ax)) < 1e-3 && Math.abs((moved.y - moved.ay) - (dragged.y - dragged.ay)) < 1e-3, "keeps its offset");
  // taken off the drawing: still a row
  const off = unplace(items, m.id)[0];
  assert(!isPlaced(off) && !("ax" in off) && off.no === "1");
});

test("the same for a spool and a support: each is joined by a leader, and frames keep clear of each other", () => {
  let items = [];
  for (const kind of ["weld-shop", "spool", "support", "weld-field"]) items = addMark(items, { kind });
  for (const m of [...items]) items = placeAt(items, m.id, { x: 0.5, y: 0.5 }, 1.414);
  assert(items.every((m) => m.ax === 0.5 && m.ay === 0.5), "every kind has its leader to the one point");
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    assert(Math.hypot((items[i].x - items[j].x) * 1.414, items[i].y - items[j].y) >= 0.05, `${items[i].kind} and ${items[j].kind} frames overlap`);
  }
  const f = frameSpot({ x: 0.99, y: 0.01 }, [], 1.414);
  assert(f.x <= 1 && f.y >= 0, "a frame stays on the sheet");
});

test("the engine's row for a mark is found by its plain number", () => {
  const m = buildModel(DEMO);
  const r = engineRow(m, plainNo(m.register[1].no));
  equal(r.no, m.register[1].no);
  equal(engineRow(m, "999"), null);
  equal(engineRow({ error: "x" }, "1"), null);
});

test("the same number twice in a class, and a mark with no number, are named", () => {
  equal(problems([{ kind: "weld-shop", no: "1" }, { kind: "weld-field", no: "2" }]), []);
  assert(problems([{ kind: "weld-shop", no: "1" }, { kind: "weld-field", no: "1" }]).length === 1, "shop and field welds share one series");
  assert(problems([{ kind: "spool", no: "1" }, { kind: "weld-shop", no: "1" }]).length === 0, "a spool 1 and a weld 1 are different things");
  assert(problems([{ kind: "support", no: "" }]).length === 1);
});

test("a saved payload is cleaned: a bad kind is dropped, a bad place makes a row not joined to the drawing, ids filled", () => {
  const n = normalize([{ kind: "weld-shop", no: "1", x: 0.2, y: 0.3 }, { kind: "zzz", no: "2", x: 0, y: 0 }, { kind: "spool", no: "3", x: "q", y: 0 }, null]);
  equal(n.length, 2);
  assert(n.every((m) => m.id));
  assert(isPlaced(n[0]) && !isPlaced(n[1]) && n[1].no === "3", "the row is kept, not on the sheet");
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

// DEMO's four nodes, drawn on the sheet where a model said it saw them
const PX = { N1: [0.2, 0.8], N2: [0.4, 0.6], N3: [0.6, 0.6], N4: [0.8, 0.3] };
const drawn = (skip = []) => ({ ...DEMO, nodes: DEMO.nodes.map((n) => (skip.includes(n.id) ? { ...n } : { ...n, px: PX[n.id]?.[0], py: PX[n.id]?.[1] })) });
const onSegment = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p.ax - a[0]) * dx + (p.ay - a[1]) * dy) / L)) : 0;
  return Math.hypot(p.ax - (a[0] + t * dx), p.ay - (a[1] + t * dy)) < 0.002;
};

test("the engine's welds go on the drawn pipe, each with its frame to one side and a leader to it", () => {
  const data = drawn();
  const m = buildModel(data);
  const { items, missing } = fromEngine(m, data.nodes, 1.414);
  equal(missing, []);
  const welds = items.filter((i) => KINDS[i.kind].cls === "weld");
  equal(welds.map((i) => i.no).sort(), m.register.map((r) => plainNo(r.no)).sort(), "one mark per weld of the register, by its plain number");
  const segs = m.edges.map((e) => [PX[m.nodes[e.a].id], PX[m.nodes[e.b].id]]);
  for (const it of welds) {
    assert(segs.some(([a, b]) => onSegment(it, a, b)), `${it.no}: the weld point (${it.ax}, ${it.ay}) lies on a drawn leg`);
    assert(Math.hypot(it.x - it.ax, it.y - it.ay) > 0.015, `${it.no}: its frame stands off the pipe`);
    const r = m.register.find((w) => plainNo(w.no) === it.no);
    equal(it.kind, r.loc === "Field" ? "weld-field" : r.loc === "Shop" ? "weld-shop" : "weld-unknown", `${it.no}: Shop/Field as the engine says`);
    assert(it.src === "engine");
  }
});

test("two welds at one fitting do not put their frames on top of each other", () => {
  // the route drawn small, so its welds crowd together
  const data = { ...DEMO, nodes: DEMO.nodes.map((n) => ({ ...n, px: 0.5 + (PX[n.id][0] - 0.5) * 0.08, py: 0.5 + (PX[n.id][1] - 0.5) * 0.08 })) };
  const items = fromEngine(buildModel(data), data.nodes, 1.414).items.filter(isPlaced);
  assert(items.length > 3);
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const d = Math.hypot((items[i].x - items[j].x) * 1.414, items[i].y - items[j].y);
    assert(d >= 0.03, `${items[i].no} and ${items[j].no} frames ${d.toFixed(3)} apart`);
  }
});

test("a weld whose node was not seen on the sheet is not put anywhere: it is a row not joined to the drawing", () => {
  const data = drawn(["N1"]);
  const m = buildModel(data);
  const { items, missing } = fromEngine(m, data.nodes);
  const atN1 = m.welds.filter((w) => w.tag === "weld" && w.node === 0).map((w) => plainNo(w.no));
  assert(atN1.length > 0);
  equal(missing.sort(), atN1.sort());
  const rows = items.filter((i) => atN1.includes(i.no) && KINDS[i.kind].cls === "weld");
  equal(rows.length, atN1.length, "the row is there, with the engine's details");
  assert(rows.every((r) => !isPlaced(r) && r.attrs?.type), "but not on the sheet, and not given a place");
  const all = fromEngine(buildModel(DEMO), DEMO.nodes).items;
  assert(all.length > 0 && !all.some(isPlaced), "no node seen at all: rows only, none on the sheet");
  equal(fromEngine({ error: "x" }, []).items, []);
});

test("a spool is on the sheet only when its oval is joined to the drawing: a row alone does not meet the rule", () => {
  const mk = (kind, no, attrs, placed = true) => ({ kind, no, ...(placed ? { x: 0.5, y: 0.5 } : {}), ...(attrs ? { attrs } : {}) });
  const welds = [mk("weld-shop", "1", { spool: "SP-1" })];
  assert(rules([...welds, mk("spool", "SP-1", null, false)]).some((x) => /SP-1.*بیضی‌اش روی نقشه نیست/.test(x)), "a row not joined: the oval is not on the sheet");
  assert(!rules([...welds, mk("spool", "SP-1")]).some((x) => /SP-1/.test(x)), "joined: the rule is met");
});

test("the engine's spools are rows to be joined to their ovals", () => {
  const data = drawn();
  const m = buildModel(data);
  const sp = fromEngine(m, data.nodes).items.filter((i) => i.kind === "spool");
  equal(sp.map((i) => i.no), m.spoolIds);
  assert(sp.every((i) => !isPlaced(i)));
});

test("a weld the register leaves without Shop/Field is drawn as unknown, not as a shop weld", () => {
  const data = drawn();
  const m = buildModel(data);
  const reg = m.register.map((r, i) => (i === 0 ? { ...r, loc: null } : r));
  const it = fromEngine({ ...m, register: reg }, data.nodes).items.find((i) => i.no === plainNo(m.register[0].no));
  equal(it.kind, "weld-unknown");
});

test("the leader's weld point is kept, moved and cleaned like the frame", () => {
  let items = normalize([{ kind: "weld-field", no: "W-01", x: 0.3, y: 0.3, ax: 0.25, ay: 0.35 }, { kind: "weld-shop", no: "W-02", x: 0.5, y: 0.5, ax: "q", ay: 0.1 }]);
  assert(items[0].ax === 0.25 && items[0].ay === 0.35);
  assert(!("ax" in items[1]), "a malformed weld point is dropped, the mark kept without a leader");
  items = updateMark(items, items[0].id, { ax: 0.4, ay: 1.3 });
  assert(items[0].ax === 0.4 && items[0].ay === 1, "moved, and kept on the sheet");
});

test("marks are drawn at the example sheet's own size (25-1020 sheet 1: frames 79 px on a 3307 px sheet)", () => {
  const px = (f) => Math.round(f * 3307);
  assert(Math.abs(px(SHEET_SIZE.weld.w) - 79) <= 2, `weld frame ${px(SHEET_SIZE.weld.w)} px`);
  assert(Math.abs(px(SHEET_SIZE.spool.w) - 142) <= 2 && Math.abs(px(SHEET_SIZE.spool.h) - 63) <= 2, "spool oval 142 x 63");
  assert(Math.abs(px(SHEET_SIZE.support.w) - 106) <= 2 && Math.abs(px(SHEET_SIZE.support.h) - 82) <= 2, "support hexagon 106 x 82");
  assert(px(SHEET_SIZE.leader) <= 2, "a leader as thin as the drawing's");
});

test("what a mark records is kept, edited and cleaned, by its kind", () => {
  let items = normalize([
    { kind: "weld-field", no: "1", x: 0.1, y: 0.1, attrs: { type: "SW", size: '1"', material: " A312-TP304 ", bogus: "x", spool: "" } },
    { kind: "spool", no: "SP-1", x: 0.2, y: 0.2, attrs: { lengthMm: "1200", type: "SW" } },
  ]);
  equal(items[0].attrs, { type: "SW", size: '1"', material: "A312-TP304" }, "trimmed; empty and unknown fields dropped");
  equal(items[1].attrs, { lengthMm: "1200" }, "a spool has no joint type");
  items = updateMark(items, items[0].id, { attrs: { spool: "SP-1", type: "" } });
  equal(items[0].attrs, { size: '1"', material: "A312-TP304", spool: "SP-1" }, "one field edited, one cleared, the rest kept");
});

test("the material at a size is read off the sheet's own pipe rows, never guessed", () => {
  const bom = [{ group: "PIPE", description: "PIPE 40S PE SMLS A312-TP304 ASME B36.19", diam: 1 },
    { group: "PIPE", description: "PIPE S40 BE ERW API 5L-B PSL1", diam: 6 },
    { group: "FITTINGS", description: "ELBOW 90 A234-WPB", diam: 6 },
    { group: "PIPE", description: "PIPE SMLS A106-B", diam: 2 }, { group: "PIPE", description: "PIPE SMLS A333-6", diam: 2 },
    { group: "PIPE", description: "PIPE PE SMLS", diam: 3 }];
  equal(materialAt(bom, 1), "A312-TP304");
  equal(materialAt(bom, 6), "API 5L-B", "a fitting's grade is not the pipe's");
  equal(materialAt(bom, 2), "", "two grades at one size: unknown");
  equal(materialAt(bom, 3), "", "a pipe row with no grade: unknown");
  equal(materialAt(bom, 4), "", "no pipe at that size");
  equal(scheduleOf('36" SCH 10', 36), "SCH 10");
  equal(scheduleOf('1"', 1), "");
});

test("the engine's welds carry what the register and the BOM say", () => {
  const data = { ...drawn(), bom: [{ group: "PIPE", description: "PIPE 36 SCH 10 API 5L-B", diam: 36 }] };
  const m = buildModel(data);
  const { items } = fromEngine(m, data.nodes, 1.414, data.bom);
  for (const it of items.filter((i) => KINDS[i.kind].cls === "weld")) {
    const r = m.register.find((w) => plainNo(w.no) === it.no);
    equal(it.attrs.type, r.kind, `${it.no}: joint type`);
    equal(it.attrs.size, `${r.nps}"`, `${it.no}: size`);
    equal(it.attrs.spool, r.spool, `${it.no}: spool`);
    equal(it.attrs.material, "API 5L-B", `${it.no}: material from the BOM`);
  }
});

test("the spool and support rules, on marks and on a weld list", () => {
  const mk = (kind, no, attrs) => ({ kind, no, x: 0, y: 0, ...(attrs ? { attrs } : {}) });
  const r = rules([
    mk("weld-shop", "1", { spool: "SP-1" }), mk("weld-shop", "2"), mk("weld-field", "3"),
    mk("weld-shop", "4", { spool: "SP-9" }), mk("spool", "SP-1"), mk("spool", "SP-2"),
    mk("support", "SW-1", { type: "FS133" }), mk("support", "SW-2"),
  ]);
  assert(r.some((x) => /کارگاهی 2 اسپول ندارد/.test(x)), "a shop weld with no spool");
  assert(!r.some((x) => /\b3\b.*اسپول ندارد/.test(x)), "a site weld needs no spool");
  assert(r.some((x) => /SP-9.*بیضی‌اش روی نقشه نیست/.test(x)), "a spool named but not marked");
  assert(r.some((x) => /SP-2.*هیچ سرجوشی/.test(x)), "a spool marked with no weld in it");
  assert(!r.some((x) => /SP-1/.test(x)), "a spool marked and used is fine");
  assert(r.some((x) => /ساپورت SW-2 نوعش/.test(x)) && !r.some((x) => /SW-1/.test(x)), "a support needs its type");
  // the same rules where the welds are kept as a list beside the sheet
  const l = rules([mk("spool", "SP-1"), mk("spool", "SP-3")],
    [{ no: "1", loc: "Shop", spool: "SP-1" }, { no: "2", loc: "Shop", spool: "" }, { no: "3", loc: "Field", spool: "" }]);
  assert(l.some((x) => /کارگاهی 2/.test(x)) && l.some((x) => /SP-3.*هیچ سرجوشی/.test(x)) && !l.some((x) => /SP-1/.test(x)), l.join(" | "));
});

test("the weld list's rows are the one table's weld marks, and back", () => {
  const rows = withRowIds([
    { no: "1", loc: "Shop", kind: "BW", nps: "6", spool: "SP-1", schedule: "S40", material: "A106-B", wps: "W1", ref: "" },
    { no: "2", loc: "field", kind: "SW", nps: "3/4", spool: "", schedule: "", material: "", wps: "", ref: "" },
    { no: "3", loc: "X?", kind: "", nps: "", spool: "", schedule: "", material: "", wps: "", ref: "TP-1" },
    { no: "", loc: "", kind: "", nps: "", spool: "", schedule: "", material: "", wps: "", ref: "" },
  ]);
  const marks = { 1: { x: 0.2, y: 0.3, src: "reader" }, 2: { x: 0.5, y: 0.5, ax: 0.48, ay: 0.55, src: "hand" } };
  const extras = [{ id: "s1", kind: "spool", no: "SP-1", x: 0.1, y: 0.1, src: "hand" }];
  const items = itemsFromWeldRows(rows, marks, extras);
  equal(items.length, 4, "a blank row is no mark");
  equal(items[0].kind, "weld-shop"); equal(items[1].kind, "weld-field"); equal(items[2].kind, "weld-unknown");
  equal(items[0].attrs.type, "BW"); equal(items[0].attrs.size, "6"); equal(items[0].attrs.spool, "SP-1"); equal(items[2].attrs.ref, "TP-1");
  assert(isPlaced(items[0]) && items[0].ax == null, "a number read on the sheet is placed, with no weld point yet");
  equal(items[1].ax, 0.48, "the weld point a person joined it to");
  assert(!isPlaced(items[2]), "a weld with no place on the sheet is a row not joined");
  equal(items[0].id, rows[0]._id, "the mark is the row");

  // edits in the one table come back as rows the register checks
  let next = updateMark(items, items[2].id, { no: "3A", attrs: { size: "2" } });
  next = placeAt(next, items[2].id, { x: 0.7, y: 0.7 });
  const back = weldRowsFromItems(next, rows);
  equal(back.rows.length, 3); equal(back.rows[2].no, "3A"); equal(back.rows[2].nps, "2");
  equal(back.rows[2].loc, "X?", "a location typed that is neither Shop nor Field is kept, for the check to name");
  equal(back.rows[1].loc, "Field"); equal(back.rows[0].kind, "BW"); equal(back.rows[0].schedule, "S40");
  equal(back.rows[2]._id, rows[2]._id, "a row keeps its id");
  assert(back.marks["3A"] && back.marks["3A"].ax === 0.7, "its place on the sheet, with its weld point");
  assert(!back.marks["3"], "under its new number only");
  equal(back.extras.length, 1); equal(back.extras[0].no, "SP-1");
  // a row deleted in the table is gone from the register and the sheet
  const gone = weldRowsFromItems(removeMark(next, items[0].id), rows);
  equal(gone.rows.length, 2); assert(!gone.marks["1"], "its mark gone too");
  // a weld added by the sheet's tool is a register row of its kind
  const added = weldRowsFromItems(addMark(next, { kind: "weld-shop", x: 0.4, y: 0.4 }), rows);
  equal(added.rows[3].loc, "Shop"); equal(added.rows[3].no, "3", "the next plain number");
  // the register row is saved without the form's id
  assert(!("_id" in registerRow(rows[0])) && rowTyped(rows[2]) && !rowTyped(rows[3]), "register rows");
});

test("a sheet with no weld numbers: the weld dots become suggested welds, joined to their dots", () => {
  // three dots along a pipe running down-right, given out of order
  const dots = [[0.5, 0.5], [0.2, 0.2], [0.35, 0.35]];
  equal(JSON.stringify(orderAlongPipe(dots)), JSON.stringify([[0.2, 0.2], [0.35, 0.35], [0.5, 0.5]]), "in order along the pipe");
  const { rows, marks } = suggestFromDots(dots, Math.SQRT2);
  equal(rows.length, 3);
  equal(rows.map((r) => r.no).join(","), "1,2,3");
  assert(rows.every((r) => r.loc === "" && r.kind === "" && r.spool === ""), "nothing the drawing does not say: no Shop/Field, no type");
  equal(marks["1"].ax, 0.2); equal(marks["3"].ay, 0.5);
  assert(Object.values(marks).every((m) => m.src === "reader-dot" && isPlaced(m) && (m.x !== m.ax || m.y !== m.ay)), "each frame beside its dot, with a leader");
  const items = itemsFromWeldRows(withRowIds(rows), marks);
  assert(items.every((m) => m.kind === "weld-unknown" && m.ax != null), "drawn as welds of unknown location, each joined to its dot");
  // frames do not land on each other
  const f = Object.values(marks);
  for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++)
    assert(Math.hypot((f[i].x - f[j].x) * Math.SQRT2, f[i].y - f[j].y) >= 0.05, `frames ${i + 1} and ${j + 1} apart`);
  // what is not a point of the page is left out
  equal(suggestFromDots([[0.1, 0.1], [NaN, 0.2], [1.5, 0.3], "x"]).rows.length, 1);
  // a socket end is a weld whose symbol says how it is made: SW; a dot says nothing of it
  const both = suggestFromDots([[0.2, 0.2]], Math.SQRT2, [[0.3, 0.3], [2, 0]]);
  equal(both.rows.length, 2, "dots and socket ends together, what is not a point left out");
  equal(both.rows.map((r) => r.kind).join(","), ",SW");
  equal(both.marks["2"].src, "reader-socket"); equal(both.marks["1"].src, "reader-dot");
  assert(both.rows.every((r) => r.loc === ""), "Shop/Field still not guessed");
});

await run();
