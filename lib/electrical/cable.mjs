/**
 * Cables: the electrical module's deterministic engine.
 *
 * Two jobs, both of which a person otherwise does by eye:
 *
 *   READ A CABLE SCHEDULE. Cable number, from, to, "3Cx95 0.6/1kV" — the
 *   cores, the size and the voltage class are read by rule, not guessed. A
 *   row the rules cannot read is imported with the unknown left empty and
 *   flagged, so a person corrects it; it is never filled with a default.
 *
 *   JUDGE AN INSULATION-RESISTANCE TEST. Low voltage by IEC 60364-6
 *   Table 6.1:
 *
 *       circuit nominal voltage     test voltage (DC)   minimum
 *       SELV / PELV (≤ 50 V)         250 V               0.5 MΩ
 *       ≤ 500 V                      500 V               1.0 MΩ
 *       > 500 V (to 1000 V)         1000 V               1.0 MΩ
 *
 *   The circuit's nominal voltage decides, not the cable's rating: a
 *   0.6/1 kV cable on a 400 V system is tested at 500 V.
 *
 *   Medium voltage is NOT in that table. Its IR test voltage and minimum are
 *   the project's commissioning spec to state (NETA, the manufacturer, the
 *   client); until they are, an MV cable's IR gets no verdict.
 *
 * WHERE THIS REFUSES TO ANSWER (F-10)
 *
 *   - a LV cable whose circuit voltage is known neither from the schedule
 *     nor from the project;
 *   - an MV cable with no project IR criterion;
 *   - a test at a lower voltage than required — it proves less;
 *   - fewer readings than the cable has cores: each core is measured.
 *
 * Paragraph numbers are from IEC 60364-6:2016. Check them against the
 * edition your contract names.
 */

// ── reading a schedule ───────────────────────────────────────────────────

/**
 * "3Cx95", "4 x 2.5 mm²", "3x1x240" (three singles), "2x2x1.5" (pairs).
 * Cores are the product of every factor before the size.
 *
 * @returns {{cores: number, sizeMm2: number}|null}
 */
export function parseCableSize(text) {
  const s = String(text || "").toLowerCase().replace(/×/g, "x").replace(/\s+/g, "");
  const m = s.match(/((?:\d+c?x)+)(\d+(?:\.\d+)?)(?:mm2|mm²|sqmm|mm)?/);
  if (!m) return null;
  const factors = m[1].split("x").filter(Boolean).map((f) => Number(f.replace("c", "")));
  if (!factors.length || factors.some((f) => !(f > 0))) return null;
  const sizeMm2 = Number(m[2]);
  if (!(sizeMm2 > 0)) return null;
  return { cores: factors.reduce((a, b) => a * b, 1), sizeMm2 };
}

/**
 * "0.6/1kV", "600/1000V", "6/10 kV", "8.7/15kV", "450/750V".
 *
 * @returns {{u0Kv: number, uKv: number, voltageClass: "LV"|"MV"}|null}
 */
export function parseRating(text) {
  const s = String(text || "").toLowerCase().replace(/\s+/g, "");
  const m = s.match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)(kv|v)/);
  if (!m) return null;
  const k = m[3] === "kv" ? 1 : 0.001;
  const u0Kv = round3(Number(m[1]) * k), uKv = round3(Number(m[2]) * k);
  if (!(uKv > 0) || u0Kv > uKv) return null;
  // IEC: low voltage is up to 1000 V a.c. between phases.
  return { u0Kv, uKv, voltageClass: uKv <= 1 ? "LV" : "MV" };
}

const HEADER_RULES = [
  ["cableNo", /^(cable\s*(no|number|tag|id)?|cable|tag\s*no)\.?$/i],
  ["from", /^from/i],
  ["to", /^to\b|^to$/i],
  ["spec", /(type|spec|size|cores|construction|description)/i],
  ["rating", /(rating|voltage\s*grade|u0\/u|kv|^voltage$)/i],
  ["systemV", /(system|circuit|nominal)\s*(voltage|v)/i],
  ["length", /length/i],
];

/**
 * A cable schedule, pasted or exported as CSV/TSV.
 *
 * @returns {{rows: Array, problems: Array<{line, cableNo, text}>, columns: object}}
 */
export function parseCableSchedule(text) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], problems: [], columns: {} };
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const head = splitRow(lines[0], sep);
  const columns = {};
  head.forEach((h, i) => {
    const hit = HEADER_RULES.find(([key, re]) => !(key in columns) && re.test(h.trim()));
    if (hit) columns[hit[0]] = i;
  });
  if (!("cableNo" in columns)) {
    return { rows: [], problems: [{ line: 1, cableNo: null, text: "ستون شمارهٔ کابل پیدا نشد" }], columns };
  }

  const rows = [], problems = [], seen = new Set();
  lines.slice(1).forEach((l, idx) => {
    const c = splitRow(l, sep);
    const get = (k) => (k in columns ? (c[columns[k]] || "").trim() : "");
    const cableNo = get("cableNo").toUpperCase();
    const line = idx + 2;
    if (!cableNo) return;
    if (seen.has(cableNo)) { problems.push({ line, cableNo, text: "شمارهٔ کابل تکراری — ردیف دوم کنار گذاشته شد" }); return; }
    seen.add(cableNo);

    const spec = get("spec");
    const size = parseCableSize(spec);
    // The rating may sit in its own column or inside the type text.
    const rating = parseRating(get("rating")) || parseRating(spec);
    const sysV = num(get("systemV").replace(/v$/i, ""));
    const lengthM = num(get("length").replace(/m$/i, ""));
    if (!size) problems.push({ line, cableNo, text: `تعداد رشته و سطح مقطع از «${spec}» خوانده نشد` });
    if (!rating) problems.push({ line, cableNo, text: "ردهٔ ولتاژ (مثلاً 0.6/1kV) خوانده نشد — کلاس LV/MV تعیین نشد" });
    rows.push({
      cableNo, from: get("from") || null, to: get("to") || null, spec: spec || null,
      cores: size?.cores ?? null, sizeMm2: size?.sizeMm2 ?? null,
      rating: rating ? `${rating.u0Kv}/${rating.uKv} kV` : null,
      uKv: rating?.uKv ?? null, voltageClass: rating?.voltageClass ?? null,
      systemVoltageV: sysV, lengthM,
    });
  });
  return { rows, problems, columns };
}

/**
 * Which tag a cable feeds, read from its To (then From) text.
 *
 * Exact whole-token match against the project's tag numbers. Two tags in
 * one field is ambiguous and returns null — "P-1203A/B" feeds two motors
 * and a person decides which cable is which.
 */
export function matchTag(text, tagNos) {
  const t = ` ${String(text || "").toUpperCase().replace(/[,;()]/g, " ")} `;
  const hits = tagNos.filter((no) => t.includes(` ${no.toUpperCase()} `));
  return hits.length === 1 ? hits[0] : null;
}

// ── insulation resistance ────────────────────────────────────────────────

/**
 * What the IR test of this cable must meet.
 *
 * @param {{voltageClass, systemVoltageV}} cable
 * @param {{lvSystemVoltageV?, mvTestVoltageV?, mvMinMohm?}} spec  the project's
 * @returns {{testV: number, minMohm: number, cite: string}|{reason: string}}
 */
export function irRequirement(cable, spec = {}) {
  if (cable.voltageClass === "LV") {
    const v = num(cable.systemVoltageV) ?? num(spec.lvSystemVoltageV);
    if (v === null) {
      return { reason: "ولتاژ نامی مدار نه در لیست کابل آمده نه در مشخصات پروژه — حکم IR ممکن نیست" };
    }
    if (v > 1000) return { reason: `ولتاژ مدار ${v} V بالاتر از محدودهٔ IEC 60364-6 است` };
    if (v <= 50) return { testV: 250, minMohm: 0.5, cite: "IEC 60364-6 Table 6.1 (SELV/PELV)" };
    if (v <= 500) return { testV: 500, minMohm: 1.0, cite: "IEC 60364-6 Table 6.1" };
    return { testV: 1000, minMohm: 1.0, cite: "IEC 60364-6 Table 6.1" };
  }
  if (cable.voltageClass === "MV") {
    const testV = num(spec.mvTestVoltageV), minMohm = num(spec.mvMinMohm);
    if (testV === null || minMohm === null) {
      return { reason: "معیار IR کابل فشار متوسط (ولتاژ تست و حداقل MΩ) در مشخصات پروژه ثبت نشده" };
    }
    return { testV, minMohm, cite: "مشخصات راه‌اندازی پروژه" };
  }
  return { reason: "کلاس ولتاژ کابل (LV/MV) معلوم نیست — ردهٔ ولتاژ را در لیست کابل اصلاح کنید" };
}

/** ">2000", "2000", "∞", "OL" → a number of MΩ (a lower bound for ">" and "∞"). */
export function parseReading(r) {
  const s = String(r ?? "").trim().toLowerCase().replace(/mω|mohm|m$/g, "");
  if (["∞", "inf", "ol", "oor"].includes(s)) return Infinity;
  const v = Number(s.replace(/^[>≥]/, ""));
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * One IR test of one cable.
 *
 * @param {{testVoltageV, readings: Array}} test
 * @param {{cores}} cable
 * @param {object} req  from irRequirement
 * @returns {{valid: boolean, ok?: boolean, minMohm?: number, reason?: string}}
 */
export function judgeIr(test, cable, req) {
  if (req.reason) return { valid: false, reason: req.reason };
  const readings = (test.readings || []).map(parseReading);
  if (readings.some((r) => r === null)) return { valid: false, reason: "قرائتی که عدد نیست" };
  const cores = Number(cable.cores);
  if (!(cores > 0)) return { valid: false, reason: "تعداد رشته‌های کابل معلوم نیست — کامل بودن قرائت‌ها قابل قضاوت نیست" };
  if (readings.length < cores) {
    return { valid: false, reason: `${readings.length} قرائت برای ${cores} رشته — هر رشته اندازه‌گیری می‌شود` };
  }
  if (!(Number(test.testVoltageV) >= req.testV)) {
    return { valid: false, reason: `ولتاژ تست ${test.testVoltageV} V کمتر از ${req.testV} V لازم است` };
  }
  const min = Math.min(...readings);
  return { valid: true, ok: min >= req.minMohm, minMohm: min,
    reason: min >= req.minMohm ? null : `کمترین قرائت ${min} MΩ زیر ${req.minMohm} MΩ` };
}

function splitRow(line, sep) {
  if (sep === "\t") return line.split("\t");
  const out = []; let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === sep && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const round3 = (n) => Math.round(n * 1000) / 1000;
