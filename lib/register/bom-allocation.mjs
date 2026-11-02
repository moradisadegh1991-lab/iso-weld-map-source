/**
 * Who uses what of a sheet's BOM (owner's request of 2026-11-02: «a flange
 * reserved by W-001 must not be offered to another weld once none is left»).
 *
 * A weld names the two BOM rows it joins (its components, lib/sheet/markup.mjs).
 * Each side is one welded end of that row. A row can give only so many ends:
 *
 *   a counted fitting   its quantity × the ends its description says it welds
 *                       (lib/register/bom-welds.mjs piecesEnds): a flange 1, an
 *                       elbow 2, a tee 3 — so two flanges serve two welds, a
 *                       third is refused, while one elbow serves two;
 *   pipe (a length)     not counted per weld: its metres are allocated to a
 *                       spool or a cut, by length;
 *   a row whose ends the description does not say, or whose quantity was not
 *                       read        no ceiling — named, never guessed;
 *   a row with no joint (gasket, bolt, instrument…)    none: a weld cannot name it.
 *
 * This is the rule; it runs live on the sheet (picker and warnings), and the
 * same numbers bound the ledger saved with the register
 * (lib/db/repos/bom-allocation.mjs, migration 097).
 */
import { piecesEnds } from "./bom-welds.mjs";

const text = (v) => String(v ?? "").trim();
const LENGTH_ITEMS = new Set(["pipe", "nipple"]);

/**
 * What a BOM row can give a weld.
 * @returns {{ mode: "ends"|"length"|"unknown"|"none", qty: number|null, unit: "pcs"|"m", perUnit: number|null, capacity: number|null, item: string|null }}
 *   capacity is the number of welded ends it can serve (null: no ceiling known).
 */
export function rowCapacity(row) {
  const { item, ends } = piecesEnds(row);
  const q = row?.qty == null || row.qty === "" ? null : Number(row.qty);
  const qty = Number.isFinite(q) && q >= 0 ? q : null;
  const unit = row?.qtyUnit === "m" || LENGTH_ITEMS.has(item) ? "m" : "pcs";
  if (unit === "m") return { mode: "length", qty, unit, perUnit: null, capacity: null, item };
  if (ends === null) return { mode: "unknown", qty, unit, perUnit: null, capacity: null, item };
  if (!ends.length) return { mode: "none", qty, unit, perUnit: 0, capacity: 0, item };
  const perUnit = ends.reduce((t, e) => t + e.n, 0);
  const whole = qty != null && Number.isInteger(qty) && qty > 0;
  return { mode: "ends", qty, unit, perUnit, capacity: whole ? qty * perUnit : null, item };
}

/** Every weld side that names a BOM row: [{ owner (the mark's id), no, slot "c1"|"c2", pt }]. */
export function weldDemands(items) {
  const out = [];
  for (const m of items || []) {
    if (!String(m?.kind || "").startsWith("weld")) continue;
    for (const slot of ["c1", "c2"]) {
      const pt = text(m.attrs?.[slot]);
      if (pt) out.push({ owner: m.id, no: text(m.no), slot, pt });
    }
  }
  return out;
}

/**
 * Per BOM row: its capacity, the ends the welds name, what is left.
 * @returns {Map<string, { pt, row, cap, used, left: number|null, owners: string[] }>}
 */
export function usage(items, bom) {
  const byPt = new Map((bom || []).filter((b) => b && b.pt != null && text(b.pt)).map((b) => [text(b.pt), b]));
  const out = new Map();
  const get = (pt) => {
    if (!out.has(pt)) {
      const row = byPt.get(pt) || null;
      out.set(pt, { pt, row, cap: row ? rowCapacity(row) : null, used: 0, left: null, owners: [] });
    }
    return out.get(pt);
  };
  for (const [pt] of byPt) get(pt);
  for (const d of weldDemands(items)) {
    const u = get(d.pt);
    // a length item (pipe) is not counted per weld; a row not in the BOM is reported elsewhere
    if (u.row && u.cap.mode === "length") continue;
    u.used += 1;
    u.owners.push(d.no || "؟");
  }
  for (const u of out.values()) u.left = u.cap && u.cap.capacity != null ? u.cap.capacity - u.used : null;
  return out;
}

/**
 * Whether a weld may take a BOM row on one side, and why not: the row's
 * ends already named by the other welds (and this weld's other side) leave
 * none. `current` is what that side holds now (it is always allowed to keep it).
 * @returns {{ ok: boolean, why: string|null, left: number|null }}
 */
export function canTake(items, bom, weldId, slot, pt) {
  const p = text(pt);
  const u = usage(items, bom).get(p);
  if (!u || !u.row) return { ok: true, why: null, left: null };
  const w = (items || []).find((m) => m.id === weldId);
  const here = text(w?.attrs?.[slot]) === p ? 1 : 0;        // this side already counted
  const cap = u.cap;
  if (cap.mode === "none") return { ok: false, why: "این قطعه سر جوشی‌شدنی ندارد (واشر، پیچ، ابزار دقیق…)", left: 0 };
  if (cap.capacity == null) return { ok: true, why: null, left: null };
  const left = cap.capacity - (u.used - here);
  return left > 0 ? { ok: true, why: null, left } : { ok: false, why: `هیچ سری از این قطعه نمانده (${cap.capacity} سر جوشی‌شدنی، همه به سرجوش‌های دیگر داده شده)`, left: 0 };
}

/** Warnings a person should see: a row named by more welds than it has ends, a row no weld can use. */
export function allocationChecks(items, bom) {
  const out = [];
  for (const u of usage(items, bom).values()) {
    if (!u.row || !u.used) continue;
    const name = `PT ${u.pt} (${text(u.row.description).slice(0, 36)})`;
    if (u.cap.mode === "none") out.push(`${name}: سر جوشی‌شدنی ندارد ولی ${u.used} سرجوش آن را نام برده‌اند — ${[...new Set(u.owners)].join("، ")}`);
    else if (u.cap.capacity != null && u.used > u.cap.capacity)
      out.push(`${name}: ${u.used} سر جوش به آن داده شده ولی فقط ${u.cap.capacity} سر دارد (${u.cap.qty} عدد × ${u.cap.perUnit} سر) — ${[...new Set(u.owners)].join("، ")}`);
  }
  return out;
}

/**
 * What the ledger holds for the sheet's welds: one line per weld and BOM row,
 * its quantity the ends that weld takes of that row. Pipe (length) rows and
 * rows not in the BOM are not here.
 * @returns {Array<{ ownerKind: "weld", ownerRef: string, ownerNo: string, pt: number, qty: number, unit: "pcs" }>}
 */
export function ledgerDemands(items, bom) {
  const u = usage(items, bom);
  const per = new Map();
  for (const d of weldDemands(items)) {
    const r = u.get(d.pt);
    if (!r?.row || r.cap.mode === "length" || !Number.isInteger(Number(d.pt))) continue;
    const k = `${d.owner}|${d.pt}`;
    const g = per.get(k) || { ownerKind: "weld", ownerRef: String(d.owner), ownerNo: d.no, pt: Number(d.pt), qty: 0, unit: "pcs" };
    g.qty += 1; per.set(k, g);
  }
  return [...per.values()];
}
