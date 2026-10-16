/**
 * What a received file says, as text or as table rows — no model, no guess.
 *
 *   PDF   the text layer every CAD/PDF export carries, page by page, in
 *         reading lines. A page with (almost) no text is a scan: reported
 *         as needing OCR, never read as empty.
 *   XLSX  every sheet's rows; a register (equipment list, line list,
 *         instrument index) is found by its header row.
 */
import * as XLSX from "xlsx";

const SCAN_CHARS = 40; // fewer characters than this on a page: it is a picture, not a drawing with text

export async function readPdf(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    // Reading lines: items on (about) the same baseline, left to right.
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 2);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], s: it.str });
    }
    const lines = [...rows].sort((a, b) => b[0] - a[0]).map(([, r]) => r.sort((a, b) => a.x - b.x).map((i) => i.s).join(" "));
    const text = lines.join("\n");
    pages.push({ n, text, chars: text.replace(/\s/g, "").length });
    page.cleanup();
  }
  await task.destroy();
  return { pages, scanned: pages.filter((p) => p.chars < SCAN_CHARS).map((p) => p.n) };
}

/** Column roles a register's header row names. */
export const HEADERS = [
  ["line", /\bLINE\s*(NO|NUMBER|NUM)\b|شماره\s*(لاین|خط)/i],
  ["subsystem", /\bSUB[\s-]?SYSTEM\b|ساب\s*سیستم|زیرسیستم/i],
  ["system", /^\s*SYSTEM\b|^\s*سیستم/i],
  ["tag", /\b(TAG|ITEM|EQUIPMENT|EQUIP\.?|EQ\.?|INSTRUMENT)\s*(NO\.?|NUMBER|TAG|NUM)\s*$|^\s*TAG\s*$|شماره\s*(تگ|تجهیز)|^\s*تگ\s*$/i],
  ["service", /\bSERVICE\b|\bDESCRIPTION\b|سرویس|شرح/i],
  ["class", /\b(PIPING\s*)?CLASS\b|\bPIPE\s*SPEC\b/i],
  ["size", /\bSIZE\b|\bNPS\b|\bDN\b|سایز/i],
  ["fluid", /\bFLUID\b|سیال/i],
];

function roleOf(cell) {
  const s = String(cell ?? "").trim();
  if (!s || s.length > 40) return null;
  for (const [role, re] of HEADERS) if (re.test(s)) return role;
  return null;
}

/**
 * Registers in a workbook: for each sheet, the first row (of the first 15)
 * naming a tag or line column is the header; the rows under it are records.
 */
export function readXlsx(bytes) {
  const wb = XLSX.read(bytes, { type: "buffer" });
  const tables = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "", blankrows: false });
    for (let h = 0; h < Math.min(15, rows.length); h++) {
      const roles = rows[h].map(roleOf);
      // A header names a tag or line column AND at least one other: a title row ("EQUIPMENT LIST") is not one.
      if ((!roles.includes("tag") && !roles.includes("line")) || roles.filter(Boolean).length < 2) continue;
      const cols = {};
      roles.forEach((r, i) => { if (r && cols[r] == null) cols[r] = i; });
      const records = [];
      for (let r = h + 1; r < rows.length; r++) {
        const row = rows[r];
        const get = (role) => (cols[role] == null ? "" : String(row[cols[role]] ?? "").trim());
        const rec = { row: r + 1, tag: get("tag"), line: get("line"), service: get("service"), class: get("class"),
          size: get("size"), fluid: get("fluid"), system: get("system"), subsystem: get("subsystem") };
        if (rec.tag || rec.line) records.push(rec);
      }
      tables.push({ sheet: name, headerRow: h + 1, columns: Object.keys(cols), records });
      break;
    }
  }
  // Text of every cell too, for numbers that sit outside a register table.
  const text = wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: " ", RS: "\n" })).join("\n");
  // Each sheet as tab-separated rows, for schedules read by their own parser (cables).
  const sheets = wb.SheetNames.map((n) => ({ name: n, tsv: XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: "\t", RS: "\n", blankrows: false }) }));
  return { tables, text, sheets };
}

export function kindOfFile(name = "", type = "") {
  const n = String(name).toLowerCase();
  if (type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (/\.(xlsx|xlsm|xls)$/.test(n) || /spreadsheetml|ms-excel/.test(type)) return "xlsx";
  return null;
}
