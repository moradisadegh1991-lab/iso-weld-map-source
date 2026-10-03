/**
 * Reading a contractor's weld register.
 *
 * This is the file that decides whether any accuracy claim in this project
 * means anything. Everything else here can be checked against the drawing;
 * extraction accuracy can only be checked against what the people who welded
 * the line actually recorded.
 *
 * So the parser is deliberately forgiving about SHAPE and strict about
 * MEANING: it will take a CSV, a TSV, or a block pasted straight out of
 * Excel, and it will recognise a column called "Weld No" or "شماره جوش" or
 * "WELD_NO" — but it never invents a value, and a cell it cannot classify is
 * reported as unmapped rather than guessed into the nearest field.
 */

/** The sentinel for a register laid out as aligned columns. */
const SPACES = "spaces";

/**
 * Split one delimited line, honouring quotes.
 *
 * `delim` is a single character, or the sentinel "spaces" for a register
 * that arrived as aligned columns — which is what a paste out of a PDF, a
 * terminal or a chat message looks like. Runs of TWO OR MORE spaces separate
 * columns there; a single space must not, or "Butt Weld", "Weld No" and
 * "TIE IN" each break in half.
 */
function splitLine(line, delim) {
  if (delim === SPACES) return line.trim().split(/ {2,}|\t+/).map((s) => s.trim());
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Tab, semicolon or comma — whichever wins on the header line.
 *
 * When none of them appears, the register was almost certainly pasted from
 * somewhere that aligns columns with spaces. Defaulting to a comma there
 * puts the WHOLE LINE in the first cell, and everything downstream then
 * behaves: the weld number becomes "W-01   FIELD   TIE IN   28", every other
 * field reads as absent, and the golden file it writes is nonsense that
 * still looks structurally valid. Recognise the layout instead.
 */
function sniffDelimiter(line) {
  const counts = [["\t", 0], [";", 0], [",", 0]].map(([d]) => [d, line.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  if (counts[0][1] > 0) return counts[0][0];
  return / {2,}/.test(line) ? SPACES : ",";
}

/**
 * @returns {{headers: string[], rows: string[][], delimiter: string}}
 */
export function parseDelimited(text) {
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim() !== "");
  if (!lines.length) return { headers: [], rows: [], delimiter: "," };

  const delimiter = sniffDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter);

  // The safety net for a layout not recognised above. One column, but the
  // header cell mentions several of the fields we know by name, means the
  // separator was missed — and proceeding produces a register whose weld
  // number is an entire row. Better to say so than to hand back something
  // that is structurally valid and semantically rubbish.
  const suspectDelimiter = headers.length === 1 && rowsLookWide(headers[0]);
  const rows = lines.slice(1)
    .map((l) => splitLine(l, delimiter))
    // A row with fewer cells than headers is padded rather than dropped: a
    // register with an empty NDT column is the normal case, not a broken file.
    .map((r) => (r.length < headers.length
      ? r.concat(Array(headers.length - r.length).fill(""))
      : r));
  return { headers, rows, delimiter, suspectDelimiter };
}

/** Does this single cell look like it is really several columns? */
function rowsLookWide(cell) {
  const hits = Object.values(HEADER_PATTERNS)
    .filter((patterns) => patterns.some((p) => p.test(cell))).length;
  return hits >= 2;
}

/**
 * Header spellings seen on real registers, in both languages.
 *
 * `S` is the separator that turns up between words in a header: a space, an
 * underscore, a dot or a hyphen, or nothing at all. Spelling it out once is
 * what makes "Weld No", "WELD_NO" and "weld-no" the same column — a test
 * caught the underscore case, which the obvious \s* would have missed.
 */
const S = "[\\s_.\\-]*";
export const HEADER_PATTERNS = {
  no:   [new RegExp(`weld${S}(no|number|id)`, "i"), /^w\.?-?no/i, /شماره\s*جوش/, /^جوش$/],
  loc:  [new RegExp(`\\b(loc|location|shop${S}\\/?${S}field|field${S}\\/?${S}shop)\\b`, "i"),
         /^s\s*\/\s*f$/i, /^f\s*\/\s*s$/i, /محل\s*جوش/, /^محل$/],
  kind: [/^(weld|joint)?[\s_.-]*type$/i, new RegExp(`\\b(type|kind|weld${S}type|joint)\\b`, "i"), /نوع\s*جوش/, /^نوع$/],
  nps:  [/^(nps|size|dia)$/i, /\b(nps|size|dia|diam(eter)?)\b/i, /قطر/, /سایز/],
  spool:[/^spool[\s_.-]*(no|number)?$/i, /\bspool\b/i, /اسپول/],
  ndt:  [/\b(ndt|nde|rt|examination)\b/i, /آزمون|بازرسی/],
};

/**
 * Map each of our fields to a column index, by header text.
 *
 * Returns only what it is sure of. An unmapped field is left absent so the
 * caller can show it as unmapped and let the engineer pick the column — a
 * wrong automatic guess here would corrupt the very measurement this exists
 * to produce.
 *
 * Patterns are tried in order, each across every header, so an exact
 * "Type" wins over a "Hold Type" that happens to sit further left.
 *
 * "Joint" means two different things on real registers: the joint NUMBER
 * (a contractor's joint history: 001, 002, …) or the joint TYPE (TIE IN,
 * Butt Weld). The header cannot say which, so with `rows` given the column's
 * own cells decide; without them it keeps its old meaning, the type.
 *
 * @returns {{mapping: Record<string, number>, unmapped: string[]}}
 */
export function guessMapping(headers, patterns_ = HEADER_PATTERNS, rows = null) {
  const mapping = {};
  const taken = new Set();
  if (rows?.length && "no" in patterns_) {
    const j = headers.findIndex((h) => JOINT_NO.test(String(h).trim()));
    if (j >= 0 && (/no|number|#/i.test(String(headers[j])) || looksNumbered(rows, j))) {
      mapping.no = j; taken.add(j);
    }
  }
  for (const [field, patterns] of Object.entries(patterns_)) {
    if (field in mapping) continue;
    for (const p of patterns) {
      const i = headers.findIndex((h, idx) => !taken.has(idx) && p.test(String(h).trim()));
      if (i >= 0) { mapping[field] = i; taken.add(i); break; }
    }
  }
  const unmapped = Object.keys(patterns_).filter((f) => !(f in mapping));
  return { mapping, unmapped };
}

const JOINT_NO = /^joint\s*(no\.?|number|#)?$/i;

/** Whether a column holds weld numbers (001, W-12, 3A) rather than joint types. */
function looksNumbered(rows, col) {
  const cells = rows.map((r) => String(r[col] ?? "").trim()).filter(Boolean).slice(0, 200);
  if (!cells.length) return false;
  const numbered = cells.filter((c) => /^[A-Z]{0,3}[-\s.]?\d{1,4}[A-Z]?$/i.test(c));
  return numbered.length / cells.length >= 0.8;
}

/**
 * The columns that say which drawing a row belongs to, on a register that
 * covers a whole project (a contractor's joint history) rather than one sheet.
 */
export const SCOPE_PATTERNS = {
  iso:   [/^(iso|isometric)[\s_.-]*(no|number|dwg)?\.?$/i, /^(drawing|dwg)[\s_.-]*(no|number)\.?$/i, /شماره\s*(نقشه|ایزو)/],
  sheet: [/^(sheet|sht)[\s_.-]*(no|number)?\.?$/i, /^شیت$|^برگ$/],
  rev:   [/^rev(ision)?\.?$/i, /^ویرایش$|^رویژن$/],
};

/**
 * The rows of a project-wide register that belong to one drawing sheet.
 *
 * The drawing number on the sheet and the one in the register are often
 * written differently ("ISO-25-1002" against "25-1002"), so a row matches
 * when its value appears in the drawing number as a whole token — never by
 * similarity. A register without a drawing column is returned as it is,
 * with `scoped: false`, so the caller can say it compared the whole file.
 *
 * @returns {{rows, scoped: boolean, revisions: string[], note: string|null}}
 */
export function scopeRows(headers, rows, { drawingNo, sheet, rev } = {}) {
  const { mapping } = guessMapping(headers, SCOPE_PATTERNS);
  if (mapping.iso == null) return { rows, scoped: false, revisions: [], note: null };
  const norm = (v) => String(v ?? "").toUpperCase().replace(/\s+/g, "");
  const dwg = norm(drawingNo);
  if (!dwg) return { rows: [], scoped: true, revisions: [], note: "شمارهٔ نقشه خوانده نشده؛ ردیف‌های این نقشه در رجیستر پیدا نمی‌شوند." };
  const sheetNo = (v) => (String(v ?? "").match(/\d+/) || [null])[0];
  const want = sheetNo(sheet);
  const inDrawing = (v) => {
    const k = norm(v);
    if (!k) return false;
    const i = dwg.indexOf(k);
    if (i < 0) return false;
    const before = dwg[i - 1], after = dwg[i + k.length];
    return !(before && /[A-Z0-9]/.test(before)) && !(after && /[A-Z0-9]/.test(after));
  };
  let mine = rows.filter((r) => inDrawing(r[mapping.iso]));
  if (want && mapping.sheet != null) mine = mine.filter((r) => sheetNo(r[mapping.sheet]) === want);
  const revisions = mapping.rev == null ? [] : [...new Set(mine.map((r) => String(r[mapping.rev] ?? "").trim()))];
  let note = null;
  if (revisions.length > 1) {
    const r0 = String(rev ?? "").trim();
    if (r0 && revisions.includes(r0)) mine = mine.filter((r) => String(r[mapping.rev] ?? "").trim() === r0);
    else note = `رجیستر برای این برگ چند رویژن دارد (${revisions.join("، ")}) و رویژن نقشه با هیچ‌کدام یکی نیست؛ همه مقایسه شدند.`;
  }
  return { rows: mine, scoped: true, revisions, note };
}

/** Field vs Shop, however the register spells it. */
export function normalizeLoc(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  if (/^(f|fw|field)\b|field|site|میدان|سایت|کارگاه\s*نصب/.test(s)) return "Field";
  if (/^(s|sw|shop)\b|shop|fab|کارگاه|پیش\s*ساخت/.test(s)) return "Shop";
  return null;
}

/** The joint types this project's register distinguishes. */
export function normalizeKind(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  if (/tie[\s-]?in|تای|اتصال\s*به/.test(s)) return "Tie-in";
  if (/\bbw\b|butt|جوش\s*لب|سربه\s*سر/.test(s)) return "BW";
  if (/\bsw\b|socket|بوشن/.test(s)) return "SW";
  return String(v).trim();
}

/**
 * Turn parsed rows into register rows, using a column mapping.
 * Rows without a weld number are skipped — they are blank lines and totals.
 * So is a row numbered 0 (000): a contractor's joint history writes one for
 * a sheet that has no joints, and it is not a weld.
 */
export function toRegister(rows, mapping) {
  const at = (r, f) => (mapping[f] == null ? null : (r[mapping[f]] ?? "").trim());
  return rows
    .map((r) => ({
      no: at(r, "no"),
      loc: normalizeLoc(at(r, "loc")),
      kind: normalizeKind(at(r, "kind")),
      nps: Number(String(at(r, "nps") || "").replace(/[^\d.]/g, "")) || null,
      spool: at(r, "spool") || null,
      ndt: at(r, "ndt") || null,
    }))
    .filter((w) => w.no && !/^0+$/.test(w.no));
}
