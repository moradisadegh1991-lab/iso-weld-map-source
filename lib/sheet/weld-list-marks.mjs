/**
 * The weld-list form (components/WeldListEntry.jsx) drawn as the engine's
 * sheet is: one list of marks (lib/sheet/markup.mjs) for its welds, spools
 * and supports, so the same table and the same marked sheet serve both.
 *
 * The register stays the weld list's rows — what is saved, checked and
 * approved (lib/register/weld-list.mjs). A weld row is one weld mark:
 *
 *   row.no        mark.no
 *   row.loc       mark.kind      Shop → circle, Field → square, anything else → unknown (dashed)
 *   row.kind      attrs.type     BW, SW, Tie-in, …
 *   row.nps       attrs.size
 *   row.schedule, row.material, row.spool, row.wps, row.ref   the same attrs
 *   weldMarkup.marks[no]   the mark's place: frame x, y and, once a person joins it, the weld point ax, ay
 *
 * Nothing is filled in here: a row says only what was typed or read, and a
 * mark of unknown location stays unknown until a person says Shop or Field.
 */
import { KINDS, isPlaced } from "./markup.mjs";
import { normalizeLoc } from "../truth/parse.mjs";

const text = (v) => String(v ?? "").trim();
const ROW_KEYS = ["no", "spool", "loc", "kind", "nps", "schedule", "material", "wps", "ref"];
const ATTR_OF = { kind: "type", nps: "size", schedule: "schedule", material: "material", spool: "spool", wps: "wps", ref: "ref" };
// A weld's note is typed on the mark's table and has no column in the typed weld list; it rides along on the row so it is not lost.
const NOTE = "note";

/** A row with anything typed in it. */
export const rowTyped = (r) => ROW_KEYS.some((k) => text(r?.[k]));

let seq = 0;
/** Every row with an id of its own, which its mark keeps; a row that has one keeps it. */
export function withRowIds(rows) {
  return (rows || []).map((r) => (r._id ? r : { ...r, _id: `r${Date.now().toString(36)}${(seq++).toString(36)}` }));
}

/** The row as the register holds it, without the form's own id. */
export function registerRow(r) {
  const { _id, ...rest } = r;
  return rest;
}

/**
 * The marks of a weld list: a weld mark for each typed row (placed where
 * `marks` says its number is on the sheet), then the spool and support marks.
 */
export function itemsFromWeldRows(rows, marks = {}, extras = []) {
  const welds = (rows || []).filter(rowTyped).map((r) => {
    const no = text(r.no);
    const loc = normalizeLoc(r.loc);
    const pos = no ? marks?.[no] : null;
    const placed = pos && Number.isFinite(pos.x) && Number.isFinite(pos.y);
    const attrs = {};
    for (const [k, a] of Object.entries(ATTR_OF)) if (text(r[k])) attrs[a] = text(r[k]);
    if (text(r[NOTE])) attrs[NOTE] = text(r[NOTE]);
    return {
      id: r._id, kind: loc === "Shop" ? "weld-shop" : loc === "Field" ? "weld-field" : "weld-unknown", no,
      ...(placed ? { x: pos.x, y: pos.y, ...(Number.isFinite(pos.ax) && Number.isFinite(pos.ay) ? { ax: pos.ax, ay: pos.ay } : {}) } : {}),
      ...(Object.keys(attrs).length ? { attrs } : {}),
      src: placed ? pos.src || "hand" : "hand",
    };
  });
  return [...welds, ...(extras || []).filter((m) => KINDS[m.kind]?.cls !== "weld")];
}

/**
 * Back from the marks to the weld list: the rows (in the marks' order, each
 * keeping its id), where each weld is on the sheet, and the spool and support
 * marks. A location typed that is neither Shop nor Field is kept as typed
 * while the mark stays unknown, so the register's check still names it.
 */
export function weldRowsFromItems(items, prevRows = []) {
  const prev = new Map((prevRows || []).map((r) => [r._id, r]));
  const rows = [], marks = {}, extras = [];
  for (const m of items || []) {
    if (KINDS[m.kind]?.cls !== "weld") { extras.push(m); continue; }
    const p = prev.get(m.id) || {};
    const a = m.attrs || {};
    const loc = m.kind === "weld-shop" ? "Shop" : m.kind === "weld-field" ? "Field" : normalizeLoc(p.loc) ? "" : text(p.loc);
    const row = { _id: m.id, no: text(m.no), loc };
    for (const [k, key] of Object.entries(ATTR_OF)) row[k] = text(a[key]);
    if (text(a[NOTE])) row[NOTE] = text(a[NOTE]);
    rows.push(row);
    if (isPlaced(m) && row.no) {
      marks[row.no] = { x: m.x, y: m.y, ...(m.ax != null && m.ay != null ? { ax: m.ax, ay: m.ay } : {}), src: m.src || "hand" };
    }
  }
  return { rows, marks, extras };
}
