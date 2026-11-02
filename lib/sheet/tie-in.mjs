/**
 * A weld's Tie-in reference (attrs.ref): where the weld it ties to is.
 *
 *   "W5"                  a weld of this same sheet
 *   "ISO-12 | 2/3 | W5"   weld W5 of sheet 2/3 of isometric ISO-12 (another drawing of the project)
 *   anything else         a free note, kept as typed (an external reference)
 *
 * The two chosen forms are what the form's pickers write (isometric number, sheet, weld);
 * `parseRef` reads either back so the form shows the same choice again.
 */
const SEP = " | ";
const text = (v) => String(v ?? "").trim();

export function formatRef({ doc = "", sheet = "", weld = "" } = {}) {
  const d = text(doc), s = text(sheet), w = text(weld);
  if (!d) return w;
  return [d, s, w].join(SEP);
}

/** @returns {{ doc: string, sheet: string, weld: string }} doc "" = this sheet (or a free note in `weld`). */
export function parseRef(ref) {
  const p = String(ref ?? "").split(/\s*\|\s*/).map((x) => x.trim());   // not trimmed first: "ISO-1 |  | " is an isometric chosen with no sheet yet
  if (p.length === 3 && p[0]) return { doc: p[0], sheet: p[1], weld: p[2] };
  return { doc: "", sheet: "", weld: text(ref) };
}

/** Rows { doc_no, sheet_no, revision, weld_no } of the project's current welds → [{ doc, sheets: [{ sheet, revision, welds }] }], in order. */
export function groupTargets(rows = []) {
  const docs = new Map();
  for (const r of rows) {
    const doc = text(r.doc_no), sheet = text(r.sheet_no) || "1/1", weld = text(r.weld_no);
    if (!doc || !weld) continue;
    if (!docs.has(doc)) docs.set(doc, new Map());
    const sh = docs.get(doc);
    if (!sh.has(sheet)) sh.set(sheet, { sheet, revision: text(r.revision), welds: [] });
    const g = sh.get(sheet);
    if (!g.welds.includes(weld)) g.welds.push(weld);
  }
  const out = [];
  for (const [doc, sh] of docs) out.push({ doc, sheets: [...sh.values()].sort((a, b) => a.sheet.localeCompare(b.sheet, undefined, { numeric: true })) });
  return out.sort((a, b) => a.doc.localeCompare(b.doc, undefined, { numeric: true }));
}
