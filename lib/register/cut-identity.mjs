/**
 * Identity and relationships of cut pieces and spools (pure; docs/audit/phase-9-spool-cutlist.md).
 *
 * Contract (no second registry: the identity helpers are lib/sheet/mark-identity.mjs's `isUid` / `newUid`):
 *
 *   cut piece   uid         the piece's persistent identity, born with the row, kept by save/reload/edit/renumbering
 *               fromUid     the weld (uid of a weld mark / typed weld row of THIS revision) the piece starts at
 *               toUid       the weld it ends at
 *               spoolUid    the spool mark (uid) it goes to
 *               from/to/spool   the PRINTED numbers — labels for people. They are refreshed from the referenced entity
 *                           (so a renumbering shows) and are never what a relationship rests on once a uid is set.
 *   weld        attrs.spoolUid (sheet mark) / row.spoolUid (typed row) + the printed `spool` label. A spool's welds are a VIEW
 *               of the welds that name its uid: membership cannot disagree with the welds, and a weld names one spool only.
 *
 * A legacy reference (printed number, no uid) is turned into a uid ONLY when exactly one entity of this revision has that number.
 * Zero → `unresolved`; several → `ambiguous` (nothing is set, nothing is guessed). Geometry and position are never used.
 * A uid that names nothing in this revision is `dangling`: it is kept and reported, never cleaned up automatically.
 */
import { KINDS } from "../sheet/markup.mjs";
import { effectiveItems } from "../sheet/weld-projection.mjs";
import { isUid, newUid } from "../sheet/mark-identity.mjs";

const text = (v) => String(v ?? "").trim();
const lc = (u) => String(u).toLowerCase();
const cls = (m) => KINDS[m?.kind]?.cls;

/** Keys of a cut row that are NOT engineering description: never copied to a duplicate. */
export const CUT_OPERATIONAL = ["uid", "status", "orig", "src"];

/** The welds and spools of a payload by uid and by printed number (each weld once: lib/sheet/weld-projection.mjs). */
export function indexOf(payload) { return indexItems(effectiveItems(payload).items); }
export function indexItems(items = []) {
  const welds = items.filter((m) => cls(m) === "weld"), spools = items.filter((m) => m.kind === "spool");
  const idx = (list) => {
    const byUid = new Map(), byNo = new Map();
    for (const m of list) {
      if (isUid(m.uid)) byUid.set(lc(m.uid), m);
      const n = text(m.no); if (n) byNo.set(n, [...(byNo.get(n) || []), m]);
    }
    return { byUid, byNo, list };
  };
  return { welds: idx(welds), spools: idx(spools), items };
}

/** How one reference stands: ok | legacy (unique printed number) | ambiguous | unresolved | dangling | none. */
export function resolveRef(index, { uid, label }) {
  if (isUid(uid)) { const m = index.byUid.get(lc(uid)); return m ? { state: "ok", mark: m } : { state: "dangling", uid }; }
  const l = text(label);
  if (!l) return { state: "none" };
  const hits = index.byNo.get(l) || [];
  if (hits.length === 1) return { state: "legacy", mark: hits[0] };
  if (hits.length > 1) return { state: "ambiguous", candidates: hits.map((m) => ({ uid: m.uid || null, no: text(m.no) })) };
  return { state: "unresolved", label: l };
}

const ENDS = [["from", "fromUid", "welds"], ["to", "toUid", "welds"], ["spool", "spoolUid", "spools"]];

/**
 * Settle the cut table of a payload: every piece has exactly one uid (a copy that repeats one gets a new one), every legacy printed
 * reference that is provable becomes a uid, every uid reference refreshes its printed label. Nothing else is touched (unknown
 * attributes survive). @returns {{ payload, report }}
 */
export function settleCuts(payload) {
  const cuts = payload?.cutLengths;
  if (!Array.isArray(cuts) || !cuts.length) return { payload, report: emptyReport() };
  const ix = indexOf(payload), report = emptyReport(), seen = new Set();
  const out = cuts.map((c0) => {
    const c = { ...c0 }, piece = text(c.piece);
    if (isUid(c.uid) && !seen.has(lc(c.uid))) seen.add(lc(c.uid));
    else { let u = newUid(); while (seen.has(lc(u))) u = newUid(); seen.add(lc(u)); report.assigned.push({ piece, uid: u, copied: isUid(c.uid) }); c.uid = u; }
    for (const [lab, key, set] of ENDS) {
      const r = resolveRef(ix[set], { uid: c[key], label: c[lab] });
      if (r.state === "ok" || r.state === "legacy") {
        if (r.state === "legacy" && isUid(r.mark.uid)) { c[key] = r.mark.uid; report.resolved.push({ piece, field: lab, uid: r.mark.uid, no: text(r.mark.no) }); }
        const no = text(r.mark.no);
        if (no && text(c[lab]) !== no) { report.relabelled.push({ piece, field: lab, from: text(c[lab]), to: no }); c[lab] = no; }
      } else if (r.state === "ambiguous") report.ambiguous.push({ piece, uid: c.uid, field: lab, label: text(c[lab]), candidates: r.candidates });
      else if (r.state === "dangling") report.dangling.push({ piece, uid: c.uid, field: lab, ref: r.uid });
    }
    return c;
  });
  return { payload: { ...payload, cutLengths: out }, report };
}

const emptyReport = () => ({ assigned: [], resolved: [], relabelled: [], ambiguous: [], dangling: [] });

/**
 * The same for weld → spool. A typed row and a sheet weld mark each hold `spoolUid` next to the printed `spool`. A label whose spool was
 * renumbered is refreshed from the uid; a legacy label becomes a uid only when exactly one spool has that number.
 */
export function settleWeldSpools(payload) {
  const ix = indexOf(payload), report = { resolved: [], relabelled: [], ambiguous: [], dangling: [] };
  if (!ix.spools.list.length) return { payload, report };
  const fix = (get, set, no, tag) => {
    const r = resolveRef(ix.spools, { uid: get("spoolUid"), label: get("spool") });
    if (r.state === "legacy" && isUid(r.mark.uid)) { set("spoolUid", r.mark.uid); report.resolved.push({ weld: no, uid: r.mark.uid, no: text(r.mark.no) }); }
    if (r.state === "ok" || r.state === "legacy") { const n = text(r.mark.no); if (n && text(get("spool")) !== n) { report.relabelled.push({ weld: no, from: text(get("spool")), to: n }); set("spool", n); } }
    else if (r.state === "ambiguous") report.ambiguous.push({ weld: no, label: text(get("spool")), candidates: r.candidates });
    else if (r.state === "dangling") report.dangling.push({ weld: no, ref: r.uid });
    return tag;
  };
  let out = payload;
  if (Array.isArray(payload?.sheetMarkup?.items)) {
    const items = payload.sheetMarkup.items.map((m) => {
      if (cls(m) !== "weld") return m;
      const a = { ...(m.attrs || {}) };
      fix((k) => a[k], (k, v) => { a[k] = v; }, text(m.no));
      return { ...m, attrs: a };
    });
    out = { ...out, sheetMarkup: { ...payload.sheetMarkup, items } };
  }
  if (Array.isArray(payload?.weldList)) {
    const rows = payload.weldList.map((r) => { const x = { ...r }; fix((k) => x[k], (k, v) => { x[k] = v; }, text(r.no)); return x; });
    out = { ...out, weldList: rows };
  }
  return { payload: out, report };
}

/** Everything that rests on one spool or one weld, for the delete preview and the guards. */
export function spoolDependents(payload, spoolUid) {
  const ix = indexOf(payload), sp = ix.spools.byUid.get(lc(spoolUid));
  const welds = ix.welds.list.filter((w) => isUid(w.attrs?.spoolUid) && lc(w.attrs.spoolUid) === lc(spoolUid));
  const cuts = (payload?.cutLengths || []).filter((c) => isUid(c.spoolUid) && lc(c.spoolUid) === lc(spoolUid));
  return { spool: sp || null, welds, cuts, count: welds.length + cuts.length };
}
export function weldDependents(payload, weldUid) {
  const cuts = (payload?.cutLengths || []).filter((c) => [c.fromUid, c.toUid].some((u) => isUid(u) && isUid(weldUid) && lc(u) === lc(weldUid)));
  return { cuts, count: cuts.length };
}

/** The spool's welds, shop/field counts, cut pieces and their total length — derived, never stored. */
export function spoolView(payload, spoolUid) {
  const d = spoolDependents(payload, spoolUid);
  const lens = d.cuts.map((c) => Number(c.lengthMm)).filter((n) => Number.isFinite(n) && n > 0);
  const by = new Map();
  for (const c of d.cuts) { const k = [text(c.ns), text(c.material), text(c.schedule)].join("|"); const g = by.get(k) || { ns: text(c.ns), material: text(c.material), schedule: text(c.schedule), pieces: 0, lengthMm: 0 }; g.pieces += 1; g.lengthMm += Number(c.lengthMm) || 0; by.set(k, g); }
  return { ...d, shop: d.welds.filter((w) => w.kind === "weld-shop").length, field: d.welds.filter((w) => w.kind === "weld-field").length,
    totalMm: lens.reduce((t, n) => t + n, 0), breakdown: [...by.values()] };
}

/** Move a weld to another spool (or to none): its uid is untouched, label and uid change together. `to` = the spool mark or null. */
export function assignWeldSpool(attrs, to) {
  const a = { ...(attrs || {}) };
  if (to && isUid(to.uid)) { a.spoolUid = to.uid; a.spool = text(to.no); } else { delete a.spoolUid; delete a.spool; }
  return a;
}

/** A new piece from an existing one: new identity, no operational state, the next free piece number; the engineering description is copied. */
export function duplicateCut(cuts, uid, nextPiece) {
  const src = cuts.find((c) => isUid(c.uid) && lc(c.uid) === lc(uid));
  if (!src) return null;
  const copy = Object.fromEntries(Object.entries(src).filter(([k]) => !CUT_OPERATIONAL.includes(k)));
  return { ...copy, uid: newUid(), piece: nextPiece, src: "hand" };
}

/**
 * An edit to a piece: the result keeps every attribute of the piece it came from (unknown ones too). For a piece READ from the sheet
 * (`src: "extract"`), the first value of a source field a person changes is kept in `orig` and never overwritten, so the extracted value
 * stays distinguishable from the correction.
 */
const SOURCE_FIELDS = ["piece", "lengthMm", "ns"];
export function editCut(prev, next) {
  const out = { ...prev, ...next, uid: prev?.uid || next?.uid };
  if (prev && prev.src !== "hand") {
    const orig = { ...(prev.orig || {}) };
    for (const k of SOURCE_FIELDS) if (!(k in orig) && prev[k] !== undefined && text(prev[k]) !== text(out[k])) orig[k] = prev[k];
    if (Object.keys(orig).length) out.orig = orig;
  }
  return out;
}
