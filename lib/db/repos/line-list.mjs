/**
 * What a drawing sheet says about its line and its material, kept with the
 * project (db/migrations/094_line_list_iso_bom.sql):
 *
 *   registryCheck  before a sheet is saved: is this drawing, sheet and
 *                  revision already on file, which revision of the sheet is
 *                  in force, is its line registered, and where the line list
 *                  read on the sheet differs from the line's. Facts only:
 *                  which of two revisions is the later is the project's
 *                  numbering, not read here.
 *   fillLineList   on save: the line's empty line-list values filled from
 *                  the sheet; a value already on file is never written over —
 *                  a difference comes back as a conflict for a person.
 *   saveIsoBom     on save: the sheet revision's BOM rows as a person checked
 *                  them, replacing the ones saved before for that revision.
 *
 * Call these inside `withProject`.
 */

/** The line-list keys of a reading (tools/iso-read.py lineData) and the line's columns they fill. */
export const LINE_LIST = [
  ["lineClass", "piping_class"], ["designPressure", "design_pressure"], ["operatingPressure", "operating_pressure"],
  ["designTemp", "design_temp"], ["operatingTemp", "operating_temp"], ["testPressure", "test_pressure"],
  ["testFluid", "test_fluid"], ["ndt", "ndt"], ["pwht", "pwht"], ["paint", "paint"],
  ["insulationType", "insulation"], ["insulationThk", "insulation_thk"],
];

const clean = (v) => {
  const s = v == null ? "" : String(v).trim();
  return s ? s.slice(0, 120) : null;
};
// two printings of one value: case and spacing aside ("FRESH WATER" and "Fresh  water")
const same = (a, b) => String(a).replace(/\s+/g, " ").trim().toUpperCase() === String(b).replace(/\s+/g, " ").trim().toUpperCase();

/** The read values against the line's: what each would fill, and where they differ. */
export function compareLineList(line, lineData = {}) {
  const fills = [], conflicts = [];
  for (const [key, col] of LINE_LIST) {
    const read = clean(lineData?.[key]);
    if (read == null) continue;
    const onFile = line ? clean(line[col]) : null;
    if (onFile == null) fills.push({ key, col, read });
    else if (!same(onFile, read)) conflicts.push({ key, onFile, read });
  }
  return { fills, conflicts };
}

/**
 * The sheet against what is on file. `lineNo` may be null (not read for
 * certain); then the line is not looked up.
 */
export async function registryCheck(db, { projectId, docNo, sheet = "1/1", rev = null, lineNo = null, lineData = {} }) {
  const out = { document: null, line: null };
  const no = clean(docNo);
  if (no) {
    const { rows: revs } = await db.query(
      `SELECT d.id, d.revision, d.superseded_by IS NULL AS in_force, d.created_at,
              r.id AS run_id, r.status AS run_status, l.line_no AS run_line_no
         FROM document d
         LEFT JOIN LATERAL (SELECT id, status, line_id FROM extraction_run
                             WHERE document_id = d.id AND engine_error IS NULL
                             ORDER BY created_at DESC LIMIT 1) r ON true
         LEFT JOIN line l ON l.id = r.line_id
        WHERE d.project_id = $1 AND d.doc_no = $2 AND d.sheet_no = $3
        ORDER BY d.created_at`,
      [projectId, no, clean(sheet) || "1/1"]);
    const here = rev ? revs.find((d) => d.revision === String(rev).trim()) : null;
    const inForce = revs.find((d) => d.in_force) || null;
    // the drawing's number may be a package's, printed alike on many lines' sheets: the line its
    // saved register is on says whether the sheet on file is this one
    const otherLine = lineNo && revs.find((d) => d.run_line_no && !same(d.run_line_no, lineNo)) || null;
    out.document = {
      status: !revs.length ? "new" : here ? "registered" : rev ? "new-revision" : "sheet-on-file",
      revisions: revs.map((d) => ({ revision: d.revision, inForce: d.in_force, saved: Boolean(d.run_id), approved: d.run_status === "approved", lineNo: d.run_line_no || null })),
      inForce: inForce ? inForce.revision : null,
      ...(here ? { approved: here.run_status === "approved", saved: Boolean(here.run_id) } : {}),
      ...(otherLine ? { otherLine: otherLine.run_line_no } : {}),
    };
  }
  const ln = clean(lineNo);
  if (ln) {
    const { rows: [line] } = await db.query("SELECT * FROM line WHERE project_id = $1 AND line_no = $2", [projectId, ln]);
    const { fills, conflicts } = compareLineList(line || null, lineData);
    out.line = { exists: Boolean(line), lineNo: ln, fills: fills.map((f) => f.key), conflicts,
      ...(line ? { values: Object.fromEntries(LINE_LIST.map(([k, c]) => [k, line[c] ?? null])) } : {}) };
  }
  return out;
}

/** Fill the line's empty line-list values from the sheet; a differing value on file stays and is reported. */
export async function fillLineList(db, { projectId, lineId, lineData = {} }) {
  const { rows: [line] } = await db.query("SELECT * FROM line WHERE id = $1 AND project_id = $2", [lineId, projectId]);
  if (!line) return { filled: [], conflicts: [] };
  const { fills, conflicts } = compareLineList(line, lineData);
  if (fills.length) {
    // only where the line has none: COALESCE keeps a value another save set meanwhile
    const sets = fills.map((f, i) => `${f.col} = COALESCE(${f.col}, $${i + 3})`).join(", ");
    await db.query(`UPDATE line SET ${sets} WHERE id = $1 AND project_id = $2`, [lineId, projectId, ...fills.map((f) => f.read)]);
  }
  return { filled: fills.map((f) => f.key), conflicts };
}

const UNIT = new Set(["m", "pcs"]);

/** The sheet revision's BOM, one row per PT number, replacing what was saved for it before. */
export async function saveIsoBom(db, { projectId, documentId, runId = null, lineId = null, bom = [], createdBy = null }) {
  const rows = [], seen = new Set();
  for (const b of Array.isArray(bom) ? bom : []) {
    const pt = Number(b?.pt);
    if (!Number.isInteger(pt) || pt < 1 || pt > 999 || seen.has(pt)) continue;
    seen.add(pt);
    const qty = b?.qty === "" || b?.qty == null ? null : Number(b.qty);
    rows.push([pt, clean(b.group), String(b.description ?? "").trim().slice(0, 400), clean(b.diam), clean(b.stockCode),
      // a quantity the column (numeric 14,3) can hold; a larger number is a misread, not a quantity
      Number.isFinite(qty) && qty >= 0 && qty < 1e10 ? qty : null, UNIT.has(b?.qtyUnit) ? b.qtyUnit : null]);
  }
  await db.query("DELETE FROM iso_bom_row WHERE project_id = $1 AND document_id = $2", [projectId, documentId]);
  for (const r of rows) {
    await db.query(
      `INSERT INTO iso_bom_row (project_id, document_id, run_id, line_id, pt, grp, description, size, item_code, qty, qty_unit, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [projectId, documentId, runId, lineId, ...r, createdBy]);
  }
  return rows.length;
}

/** The BOM saved for a sheet revision, in PT order. */
export async function isoBom(db, { projectId, documentId }) {
  const { rows } = await db.query(
    "SELECT pt, grp, description, size, item_code, qty, qty_unit FROM iso_bom_row WHERE project_id = $1 AND document_id = $2 ORDER BY pt",
    [projectId, documentId]);
  return rows.map((r) => ({ pt: r.pt, group: r.grp, description: r.description, diam: r.size, stockCode: r.item_code,
    qty: r.qty == null ? null : Number(r.qty), qtyUnit: r.qty_unit }));
}
