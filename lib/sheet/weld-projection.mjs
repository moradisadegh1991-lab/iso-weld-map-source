/**
 * The welds of a payload, as ONE list the downstream services read (pure; docs/audit/phase-6-weld-bom-equipment-integration.md).
 *
 * A payload can hold welds in two places that are different things: the typed weld list (`weldList` — the register's rows) and the sheet's
 * annotations (`sheetMarkup.items`, which carries weld marks on the geometry route). The BOM ledger and the equipment links need "the welds
 * of this sheet" with an identity each. This is a VIEW computed from the payload on every save — never stored, never edited — so there is
 * no second source of truth:
 *
 *   `weldList` is an array   the typed rows ARE the welds (as `modelFor` already treats them as the register). A row is exposed as a weld
 *                            mark `{ uid, kind, no, attrs }`; its identity is the row's uid. A row with no valid uid owns nothing (reported).
 *                            A sheet weld mark with the SAME uid as a row is that weld and adds nothing; a sheet weld mark whose uid is no
 *                            row's holds nothing and is reported — it is never matched by number or position, so it cannot reserve twice.
 *   otherwise                the sheet's weld marks are the welds (the geometry route, unchanged).
 *
 * The printed number is carried only as `no`, for display.
 */
import { KINDS } from "./markup.mjs";
import { normalizeLoc } from "../truth/parse.mjs";
import { isUid } from "./mark-identity.mjs";

const text = (v) => String(v ?? "").trim();
const ROW_ATTR = { kind: "type", nps: "size", schedule: "schedule", material: "material", spool: "spool", wps: "wps", ref: "ref", note: "note", c1: "c1", c1s: "c1s", c2: "c2", c2s: "c2s" };
const isWeld = (m) => KINDS[m?.kind]?.cls === "weld";

/** A typed row as a weld mark (every attribute the downstream rules read). */
export function rowAsWeld(r) {
  const loc = normalizeLoc(r?.loc);
  const attrs = {};
  for (const [k, a] of Object.entries(ROW_ATTR)) if (text(r?.[k])) attrs[a] = text(r[k]);
  return { uid: r.uid, kind: loc === "Shop" ? "weld-shop" : loc === "Field" ? "weld-field" : "weld-unknown", no: text(r?.no), attrs, src: "hand" };
}

/**
 * @returns {{ source: "weldList"|"sheetMarkup", welds: object[], unlinked: object[], noIdentity: object[] }}
 *   unlinked   sheet weld marks that are not any typed row (they hold nothing)
 *   noIdentity typed rows without a valid uid (they own nothing until the save settles one)
 */
export function projectWelds(payload) {
  const marks = (payload?.sheetMarkup?.items || []).filter(isWeld);
  if (!Array.isArray(payload?.weldList)) return { source: "sheetMarkup", welds: marks, unlinked: [], noIdentity: [] };
  const rows = payload.weldList;
  const welds = rows.filter((r) => isUid(r?.uid)).map(rowAsWeld);
  const have = new Set(welds.map((w) => w.uid));
  return {
    source: "weldList",
    welds,
    unlinked: marks.filter((m) => !(isUid(m.uid) && have.has(m.uid))).map((m) => ({ uid: m.uid || null, no: text(m.no) })),
    noIdentity: rows.filter((r) => !isUid(r?.uid)).map((r) => ({ no: text(r?.no) })),
  };
}

/** What the allocation ledger and the equipment links read: the sheet's non-weld marks and the projected welds, each weld once. */
export function effectiveItems(payload) {
  const p = projectWelds(payload);
  const others = (payload?.sheetMarkup?.items || []).filter((m) => !isWeld(m));
  return { items: [...others, ...p.welds], projection: p };
}
