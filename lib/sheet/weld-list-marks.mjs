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
 *   row.uid       mark.uid       the PERSISTENT identity (lib/sheet/mark-identity.mjs); the row's `_id` is only the form's key
 *   weldMarkup.byUid[uid]   the mark's place: frame x, y and, once a person joins it, the weld point ax, ay
 *   weldMarkup.marks[no]    the same place keyed by the printed number — the LEGACY form, still written (for unique numbers
 *                           only) and read as a fallback; a number two rows share is never resolved from it
 *
 * Nothing is filled in here: a row says only what was typed or read, and a
 * mark of unknown location stays unknown until a person says Shop or Field.
 */
import { KINDS, isPlaced } from "./markup.mjs";
import { normalizeLoc } from "../truth/parse.mjs";
import { isUid, newUid } from "./mark-identity.mjs";

const text = (v) => String(v ?? "").trim();
const ROW_KEYS = ["no", "spool", "loc", "kind", "nps", "schedule", "material", "wps", "ref"];
const ATTR_OF = { kind: "type", nps: "size", schedule: "schedule", material: "material", spool: "spool", wps: "wps", ref: "ref" };
// What a weld's mark records that the typed weld list has no column for (its note, its two BOM components and
// what they were when picked): it rides along on the row so it is not lost.
const EXTRA = ["note", "c1", "c1s", "c2", "c2s", "spoolUid"];   // (spoolUid: the weld's spool by identity, Phase 9)

/** A row with anything typed in it. */
export const rowTyped = (r) => ROW_KEYS.some((k) => text(r?.[k]));

let seq = 0;
/**
 * Every row with a UI key of its own (`_id`, which its mark keeps as its legacy handle) AND a persistent identity (`uid`).
 * A row that has them keeps them; a uid that is not a valid UUID, or that an earlier row already has, is replaced — two rows
 * never share an identity. `_id` is never persisted and never a reference; `uid` is.
 */
export function withRowIds(rows) {
  const seen = new Set();
  return (rows || []).map((r) => {
    let uid = r?.uid;
    if (!isUid(uid) || seen.has(uid)) { uid = newUid(); while (seen.has(uid)) uid = newUid(); }
    seen.add(uid);
    const id = r._id || `r${Date.now().toString(36)}${(seq++).toString(36)}`;
    return r._id === id && r.uid === uid ? r : { ...r, _id: id, uid };
  });
}

/** The row as the register holds it: without the form's own key (`_id`), with its persistent identity (`uid`). */
export function registerRow(r) {
  const { _id, ...rest } = r;
  return rest;
}

const placeOk = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** How many typed rows carry each printed number (a number two rows share names no single place). */
function numberCounts(rows) {
  const n = new Map();
  for (const r of rows || []) { const k = text(r?.no); if (k) n.set(k, (n.get(k) || 0) + 1); }
  return n;
}

/**
 * Where a row's mark is: its identity's place first; the legacy number-keyed place only when the number is the row's alone
 * (never guessed between rows that share it).
 */
function placeOf(r, byUid, marks, counts) {
  const own = r.uid ? byUid?.[r.uid] : null;
  if (placeOk(own)) return own;
  const no = text(r.no);
  return no && counts.get(no) === 1 && placeOk(marks?.[no]) ? marks[no] : null;
}

/**
 * Legacy placements (by number) adopted under the row's identity: for every row without a place of its own whose number is
 * unique, its legacy place. Nothing is removed from `marks`; the result is the identity-keyed map to carry from now on.
 */
export function adoptLegacyPlacement(rows, marks = {}, byUid = {}) {
  const counts = numberCounts((rows || []).filter(rowTyped));
  const out = { ...(byUid || {}) };
  for (const r of rows || []) {
    if (!r?.uid || placeOk(out[r.uid])) continue;
    const no = text(r.no);
    if (no && counts.get(no) === 1 && placeOk(marks?.[no])) out[r.uid] = { ...marks[no] };
  }
  return out;
}

/**
 * The marks of a weld list: a weld mark for each typed row (carrying the row's uid, placed where its identity's place — or,
 * failing that, its unique number's legacy place — says), then the spool, support and equipment marks.
 */
export function itemsFromWeldRows(rows, marks = {}, extras = [], byUid = {}) {
  const counts = numberCounts((rows || []).filter(rowTyped));
  const welds = (rows || []).filter(rowTyped).map((r) => {
    const no = text(r.no);
    const loc = normalizeLoc(r.loc);
    const pos = placeOf(r, byUid, marks, counts);
    const placed = Boolean(pos);
    const attrs = {};
    for (const [k, a] of Object.entries(ATTR_OF)) if (text(r[k])) attrs[a] = text(r[k]);
    for (const k of EXTRA) if (text(r[k])) attrs[k] = text(r[k]);
    return {
      id: r._id, ...(isUid(r.uid) ? { uid: r.uid } : {}),
      kind: loc === "Shop" ? "weld-shop" : loc === "Field" ? "weld-field" : "weld-unknown", no,
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
  const rows = [], extras = [];
  for (const m of items || []) {
    if (KINDS[m.kind]?.cls !== "weld") { extras.push(m); continue; }
    const p = prev.get(m.id) || {};
    const a = m.attrs || {};
    const loc = m.kind === "weld-shop" ? "Shop" : m.kind === "weld-field" ? "Field" : normalizeLoc(p.loc) ? "" : text(p.loc);
    // the row's identity is the mark's; a mark that somehow has none keeps the row's it came from
    const uid = isUid(m.uid) ? m.uid : p.uid;
    const row = { _id: m.id, ...(uid ? { uid } : {}), no: text(m.no), loc };
    for (const [k, key] of Object.entries(ATTR_OF)) row[k] = text(a[key]);
    for (const k of EXTRA) if (text(a[k])) row[k] = text(a[k]);
    rows.push(row);
  }
  const byUid = {};
  for (const m of items || []) {
    if (KINDS[m.kind]?.cls !== "weld" || !isPlaced(m)) continue;
    const row = rows.find((r) => r._id === m.id);
    if (!row?.uid) continue;
    byUid[row.uid] = { x: m.x, y: m.y, ...(m.ax != null && m.ay != null ? { ax: m.ax, ay: m.ay } : {}), src: m.src || "hand" };
  }
  return { rows, byUid, marks: legacyMarks(rows, byUid), extras };
}

/**
 * The marks a saved sheet brings back beside its weld rows: its spools, supports AND installation equipment (an equipment mark with its
 * persistent identity is what the equipment register and the BOM pieces rest on — dropping it on reopen makes the next save remove or refuse it).
 */
export const extraMarks = (items) => (items || []).filter((m) => m.kind === "spool" || m.kind === "support" || m.kind === "equipment");

/** The legacy number-keyed placement of an identity-keyed one: only for numbers that are unique among the rows. */
export function legacyMarks(rows, byUid) {
  const counts = numberCounts((rows || []).filter(rowTyped));
  const marks = {};
  for (const r of rows || []) {
    const no = text(r.no), p = r.uid ? byUid?.[r.uid] : null;
    if (no && counts.get(no) === 1 && placeOk(p)) marks[no] = { ...p };
  }
  return marks;
}
