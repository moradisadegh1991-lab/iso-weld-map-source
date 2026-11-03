/**
 * A weld's Tie-in reference (attrs.ref): where the weld it ties to is.
 *
 *   "W5"                  a weld of this same sheet
 *   "ISO-12 | 2/3 | W5"   weld W5 of sheet 2/3 of isometric ISO-12 (another drawing of the project)
 *   "ISO-12 | 2/3 | W5 | uid"   the same, with the weld's own identity (weld_uid) when the picker knew it:
 *                         it is how the reference follows the weld if its number changes
 *   anything else         a free note, kept as typed (an external reference)
 *
 * The two chosen forms are what the form's pickers write (isometric number, sheet, weld);
 * `parseRef` reads either back so the form shows the same choice again.
 */
const SEP = " | ";
const text = (v) => String(v ?? "").trim();

export function formatRef({ doc = "", sheet = "", weld = "", uid = "" } = {}) {
  const d = text(doc), s = text(sheet), w = text(weld), u = text(uid);
  if (!d) return w;
  return (u ? [d, s, w, u] : [d, s, w]).join(SEP);
}

/** @returns {{ doc: string, sheet: string, weld: string, uid: string }} doc "" = this sheet (or a free note in `weld`). */
export function parseRef(ref) {
  const p = String(ref ?? "").split(/\s*\|\s*/).map((x) => x.trim());   // not trimmed first: "ISO-1 |  | " is an isometric chosen with no sheet yet
  if ((p.length === 3 || p.length === 4) && p[0]) return { doc: p[0], sheet: p[1], weld: p[2], uid: p[3] || "" };
  return { doc: "", sheet: "", weld: text(ref), uid: "" };
}

/** Rows { doc_no, sheet_no, revision, weld_no } of the project's current welds → [{ doc, sheets: [{ sheet, revision, welds }] }], in order. */
export function groupTargets(rows = []) {
  const docs = new Map();
  for (const r of rows) {
    const doc = text(r.doc_no), sheet = text(r.sheet_no) || "1/1", weld = text(r.weld_no);
    if (!doc || !weld) continue;
    if (!docs.has(doc)) docs.set(doc, new Map());
    const sh = docs.get(doc);
    if (!sh.has(sheet)) sh.set(sheet, { sheet, revision: text(r.revision), welds: [], uids: {} });
    const g = sh.get(sheet);
    if (!g.welds.includes(weld)) g.welds.push(weld);
    if (r.weld_uid && !g.uids[weld]) g.uids[weld] = text(r.weld_uid);
  }
  const out = [];
  for (const [doc, sh] of docs) out.push({ doc, sheets: [...sh.values()].sort((a, b) => a.sheet.localeCompare(b.sheet, undefined, { numeric: true })) });
  return out.sort((a, b) => a.doc.localeCompare(b.doc, undefined, { numeric: true }));
}

/**
 * Where a picked reference stands now. `found` is the weld the reference names, as the
 * records last held it under that drawing, sheet and number (null: never held); `current`
 * is the same weld (same identity, weld_uid) in the project's current registers (null: not in any).
 *
 *   ok        the weld is where the reference says
 *   renamed   the same weld is now numbered, or sheeted, differently — `current` says how
 *   gone      the weld existed but no current register has it (removed, or its drawing superseded without it)
 *   missing   no register of the project has ever held a weld by that drawing, sheet and number
 *             (an isometric not yet saved, or a typo)
 */
export function classifyTarget(found, current) {
  if (!found) return { status: "missing" };
  if (!current) return { status: "gone" };
  const same = text(current.doc_no) === text(found.doc_no) && text(current.sheet_no) === text(found.sheet_no) && text(current.weld_no) === text(found.weld_no);
  return same ? { status: "ok" }
    : { status: "renamed", current: { doc: text(current.doc_no), sheet: text(current.sheet_no), weld: text(current.weld_no) } };
}

/**
 * The Tie-in references a saved payload holds: the weld list's `ref` column and the sheet marks' `attrs.ref`.
 * @returns {Array<{ from: string, ref: string }>} `from` is the weld that refers (its number on its own sheet)
 */
export function refsOfPayload(payload) {
  const out = [];
  for (const r of Array.isArray(payload?.weldList) ? payload.weldList : []) if (text(r?.ref)) out.push({ from: text(r.no), ref: text(r.ref) });
  for (const m of Array.isArray(payload?.sheetMarkup?.items) ? payload.sheetMarkup.items : [])
    if (/^weld/.test(m?.kind || "") && text(m?.attrs?.ref)) out.push({ from: text(m.no), ref: text(m.attrs.ref) });
  // a weld in both places is one reference
  return out.filter((x, i) => out.findIndex((y) => y.from === x.from && y.ref === x.ref) === i);
}

/** Does this reference name that weld? By identity when the reference carries one, else by drawing, sheet and number. */
export function refersTo(ref, target) {
  const p = parseRef(ref);
  if (!p.doc) return false;
  if (p.uid) return Boolean(target.uid) && p.uid === text(target.uid);
  return p.doc === text(target.doc) && (!p.sheet || p.sheet === text(target.sheet)) && p.weld === text(target.weld);
}
