/**
 * A weld log that covers many drawings — a Piping.Tools "Weld Log" export,
 * this platform's own Weld Log report, or a contractor's register — split
 * into one weld list per drawing sheet, for the weld-list form
 * (components/WeldListEntry.jsx) to load the one a person picks.
 *
 * Read, never decided: the header row is found by its column names (the
 * exports open with title rows), columns are mapped by name as every weld
 * list is (lib/truth/parse.mjs), and rows are grouped on the drawing and
 * sheet the file itself prints. A row with no weld number (a "Filtered
 * total" line) is not a weld. Duplicates are kept: modelFromWeldList refuses
 * them row by row, which is the point — a log that numbers weld 1 eleven
 * times on one sheet is not a register.
 */
import { guessMapping } from "../truth/parse.mjs";
import { LIST_PATTERNS } from "./weld-list.mjs";

const DRAWING = [/^drawing[\s_.-]*(no|number|#)?$/i, /^(iso(metric)?|dwg)[\s_.-]*(no|number)?$/i, /شماره\s*نقشه/];
const SHEET = [/^sheet[\s_.-]*(#|no|number)?$/i, /^sh(t)?\.?$/i, /شیت|برگ/];
const SYSTEM = [/^(system|line[\s_.-]*(no|number)?)$/i, /شماره\s*خط/];
const REVISION = [/^rev(ision)?\.?$/i, /رویژن/];

const s = (v) => String(v ?? "").trim();
const find = (headers, pats) => {
  for (const p of pats) { const i = headers.findIndex((h) => p.test(s(h))); if (i >= 0) return i; }
  return -1;
};

/** The first of the opening rows whose cells name a weld number: the header. */
export function headerRow(aoa, scan = 15) {
  for (let i = 0; i < Math.min(scan, aoa.length); i++) {
    const { mapping } = guessMapping((aoa[i] || []).map(s), { no: LIST_PATTERNS.no });
    if (mapping.no != null) return i;
  }
  return -1;
}

/**
 * @param {Array<Array>} aoa  the sheet as rows of cells
 * @param {{byLine?: boolean}} o  split each sheet by its line (System) column too —
 *   for a log that put several lines' welds under one drawing number
 * @returns {{ error } | { groups: Array<{ key, drawingNo, sheet, rev, lineNo, rows }>, found, unmapped }}
 */
export function splitWeldLog(aoa, { byLine = false } = {}) {
  const h = headerRow(aoa);
  if (h < 0) return { error: "ستون «شمارهٔ جوش» (Weld No) در سطرهای اول فایل پیدا نشد." };
  const headers = aoa[h].map(s);
  const body = aoa.slice(h + 1);
  const { mapping, unmapped } = guessMapping(headers, LIST_PATTERNS, body);
  const at = { drawing: find(headers, DRAWING), sheet: find(headers, SHEET), system: find(headers, SYSTEM), rev: find(headers, REVISION) };
  const groups = new Map();
  for (const r of body) {
    const no = s(r[mapping.no]);
    if (!no) continue;
    const drawingNo = at.drawing >= 0 ? s(r[at.drawing]) : "";
    const sheet = at.sheet >= 0 ? s(r[at.sheet]) : "";
    const line = at.system >= 0 ? s(r[at.system]) : "";
    const key = byLine ? `${drawingNo}|${sheet}|${line}` : `${drawingNo}|${sheet}`;
    const g = groups.get(key) || { key, drawingNo, sheet, rev: at.rev >= 0 ? s(r[at.rev]) : "", lines: new Set(), rows: [] };
    if (line) g.lines.add(line);
    g.rows.push(Object.fromEntries(["no", "spool", "loc", "kind", "nps", "ref"].map((k) => [k, mapping[k] == null ? "" : s(r[mapping[k]])])));
    groups.set(key, g);
  }
  return {
    groups: [...groups.values()].map((g) => ({ key: g.key, drawingNo: g.drawingNo, sheet: g.sheet, rev: g.rev,
      // a sheet whose welds name one line has that line; several lines stay for the person to choose
      lineNo: g.lines.size === 1 ? [...g.lines][0] : "", lines: [...g.lines], rows: g.rows })),
    found: Object.fromEntries(Object.entries(mapping).map(([k, i]) => [k, headers[i]])),
    unmapped, headerRow: h, hasLine: at.system >= 0,
  };
}

/** The sheet of a workbook a weld log is on: a named weld-log sheet before the first. */
export function weldLogSheetName(names) {
  return names.find((n) => /weld\s*log\s*detailed/i.test(n)) || names.find((n) => /weld\s*log|joints?|register|رجیستر/i.test(n)) || names[0];
}
