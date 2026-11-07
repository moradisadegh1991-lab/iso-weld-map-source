/**
 * The persistent identity of a typed weld list's rows, as the server settles it (pure; the contract is in
 * docs/audit/phase-4-typed-weld-identity.md).
 *
 * A typed weld row is a weld mark. Its identity is `weldList[i].uid` — the same kind of uid, in the same registry
 * (`sheet_mark_identity`), reconciled by the same function (`reconcileMarks`) as every other mark of a sheet; there is no
 * second identity system. The printed number (`no`) is a display attribute; the form's `_id` is never persisted.
 *
 *   weldRowMarks      the rows seen as weld marks, for reconcileMarks / registerMarks
 *   applyWeldIdentity the payload with the settled uids written back to its rows, and the identity-keyed places
 *                     (`weldMarkup.byUid`) following a uid the server had to replace
 */
import { normalizeLoc } from "../truth/parse.mjs";
import { isUid } from "./mark-identity.mjs";

const text = (v) => String(v ?? "").trim();

/** A row as a weld mark. A row without a valid uid is a mark without one (and so is matched, never assumed). */
export function weldRowMarks(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const loc = normalizeLoc(r?.loc);
    return {
      ...(isUid(r?.uid) ? { uid: r.uid } : {}),
      kind: loc === "Shop" ? "weld-shop" : loc === "Field" ? "weld-field" : "weld-unknown",
      no: text(r?.no),
      attrs: { size: text(r?.nps), type: text(r?.kind), spool: text(r?.spool) },
      src: "hand",
    };
  });
}

/**
 * @param {object} payload   the run's payload (with `weldList`)
 * @param {object[]} settled the weld marks returned by reconciliation, in the rows' order, each with a uid
 */
export function applyWeldIdentity(payload, settled) {
  const rows = payload.weldList.map((r, i) => (settled[i]?.uid && r.uid !== settled[i].uid ? { ...r, uid: settled[i].uid } : r));
  const out = { ...payload, weldList: rows };
  const by = payload.weldMarkup?.byUid;
  if (by && typeof by === "object") {
    const now = new Set(rows.map((r) => r.uid));
    const next = {};
    payload.weldList.forEach((r, i) => {
      const was = r.uid, is = rows[i].uid;
      if (!was || !by[was]) return;
      // a place stays with its identity; one whose uid the server replaced moves to the new one — but only if the old uid is
      // not another row's now (the first holder keeps it), and never onto a uid that already has a place
      if (was === is) next[is] = by[was];
      else if (!now.has(was) && !next[is]) next[is] = by[was];
    });
    out.weldMarkup = { ...payload.weldMarkup, byUid: next };
  }
  return out;
}
