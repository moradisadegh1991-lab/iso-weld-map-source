/**
 * Instruments: the instrumentation module's deterministic engine.
 *
 *   READ A TAG BY ISA 5.1. "PT-1203A" is a pressure transmitter in loop
 *   P-1203A; "PSV-2101" a pressure safety valve; "LSHH-3102" a level
 *   switch, high-high. The letters are decoded by the standard's table, not
 *   guessed: a letter the table does not have makes the tag unreadable, and
 *   an unreadable tag is left for a person rather than filed as something.
 *
 *   JUDGE A BENCH CALIBRATION. Points across the span (0/25/50/75/100% is
 *   the usual practice, after IEC 61298-2), each point's error as a
 *   percentage of span, the worst against the tolerance the PROJECT states
 *   (or the instrument's own, from its datasheet). There is no default
 *   tolerance: ±0.1% and ±1% are both right, for different instruments.
 *
 * WHERE THIS REFUSES TO ANSWER (F-10)
 *
 *   - a calibration with fewer than five points, or points that do not reach
 *     both ends of the range — an error found only mid-span says nothing of
 *     zero and span;
 *   - an instrument with no range or no tolerance;
 *   - valves, switches and elements: a stroke test, a trip point and a
 *     sensor check are different tests, recorded and signed by the
 *     technician rather than judged here.
 *
 * Letter meanings are from ANSI/ISA-5.1-2009 Table 4.1. Check against the
 * edition your contract names, and against the project's own tagging
 * procedure, which may assign the "user's choice" letters.
 */

/** First letter: the measured or initiating variable. */
export const VARIABLES = {
  A: "آنالیز", B: "مشعل / احتراق", C: "انتخاب کاربر", D: "انتخاب کاربر", E: "ولتاژ",
  F: "دبی", G: "انتخاب کاربر", H: "دستی", I: "جریان", J: "توان", K: "زمان",
  L: "سطح", M: "انتخاب کاربر", N: "انتخاب کاربر", O: "انتخاب کاربر", P: "فشار",
  Q: "مقدار", R: "تشعشع", S: "سرعت / فرکانس", T: "دما", U: "چندمتغیره",
  V: "ارتعاش", W: "وزن / نیرو", X: "طبقه‌بندی‌نشده", Y: "رویداد / وضعیت", Z: "موقعیت",
};

/** Letters that may follow the first as its modifier. */
const MODIFIERS = { D: "اختلافی", F: "نسبت", J: "اسکن", K: "نرخ تغییر", Q: "تجمعی" };

/** Succeeding letters: readout, output or passive function. */
export const FUNCTIONS = {
  A: "آلارم", B: "انتخاب کاربر", C: "کنترل", E: "المان اولیه", G: "گیج / شیشه",
  H: "بالا", I: "نمایشگر", K: "ایستگاه کنترل", L: "پایین / چراغ", N: "انتخاب کاربر",
  O: "اریفیس", P: "نقطهٔ تست", R: "ثبات", S: "سوئیچ", T: "ترانسمیتر", U: "چندکاره",
  V: "شیر / دمپر", W: "ترموول", X: "طبقه‌بندی‌نشده", Y: "رله / محاسبه", Z: "محرک",
};

export const CATEGORIES = {
  transmitter: "ترانسمیتر", gauge: "گیج / نمایشگر محلی", switch: "سوئیچ",
  valve: "شیر کنترلی / قطع و وصل", safety_valve: "شیر اطمینان", element: "المان / ترموول",
  controller: "کنترلر", other: "سایر",
};

/**
 * Decode an instrument tag.
 *
 * @returns {{letters, number, suffix, variable, modifier, functions, category, loop}|null}
 */
export function parseTag(tagNo) {
  const s = String(tagNo || "").toUpperCase().trim().replace(/\s+/g, "");
  const m = s.match(/^([A-Z]{1,6})[-_]?(\d{2,6})([A-Z]{0,2})$/);
  if (!m) return null;
  const [, letters, number, suffix] = m;
  const first = letters[0];
  if (!VARIABLES[first]) return null;
  let i = 1;
  let modifier = null;
  // S after the first letter is "safety" only in a safety valve or safety
  // element (PSV, TSE); everywhere else it is a switch (PSH, LSLL).
  if (/^.S[VE]$/.test(letters)) { modifier = "S"; i = 2; }
  else if (MODIFIERS[letters[1]] && letters.length > 2) { modifier = letters[1]; i = 2; }
  const rest = letters.slice(i).split("");
  // At least one succeeding letter: "P-1203A" is a pump, not an instrument.
  if (!rest.length || rest.some((c) => !FUNCTIONS[c])) return null;
  const has = (c) => rest.includes(c);

  const category = modifier === "S" && has("V") ? "safety_valve"
    : has("V") ? "valve"
    : has("T") ? "transmitter"
    : has("S") ? "switch"
    : has("C") ? "controller"
    : has("G") || has("I") ? "gauge"
    : has("E") || has("W") ? "element"
    : "other";

  return {
    letters, number, suffix,
    variable: first, modifier, functions: rest, category,
    // ISA 5.1 loop identification: the first letter (and its modifier),
    // then the number. A/B suffixes are kept: PT-1203A and PT-1203B are
    // usually two loops on two pumps, not one.
    loop: `${first}${modifier && modifier !== "S" ? modifier : ""}-${number}${suffix}`,
  };
}

/** "0-25 bar", "-1 to 5 barg", "0 ~ 150 °C", "0–100 %". */
export function parseRange(text) {
  const s = String(text || "").replace(/–|—|~/g, "-").trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:-|to)\s*(-?\d+(?:\.\d+)?)\s*(.*)$/i);
  if (!m) return null;
  const lo = Number(m[1]), hi = Number(m[2]);
  if (!(hi > lo)) return null;
  return { lo, hi, unit: m[3].trim() || null };
}

/** Categories judged here by their calibration points. */
export const CALIBRATED_HERE = new Set(["transmitter", "gauge"]);

/**
 * What an instrument's calibration must meet.
 *
 * @returns {{tolerancePct, lo, hi, output: "mA"|"eu"}|{reason}}
 */
export function calibrationRequirement(inst, spec = {}) {
  if (!CALIBRATED_HERE.has(inst.category)) {
    return { reason: "برای این نوع (شیر، سوئیچ، المان) آزمون دیگری لازم است و تکنسین آن را امضا می‌کند" };
  }
  const lo = num(inst.rangeLo), hi = num(inst.rangeHi);
  if (lo === null || hi === null || !(hi > lo)) return { reason: "رنج ابزار در لیست ابزار نیامده — دقت را بدون رنج نمی‌شود سنجید" };
  const tol = num(inst.tolerancePct) ?? num(spec.tolerancePct);
  if (tol === null || !(tol > 0)) {
    return { reason: "تلورانس کالیبراسیون نه برای ابزار ثبت شده نه در مشخصات پروژه" };
  }
  return { tolerancePct: tol, lo, hi, output: inst.category === "transmitter" ? "mA" : "eu" };
}

/**
 * One calibration, point by point.
 *
 * @param {Array<{applied: number, output: number}>} points  applied in
 *   engineering units; output in mA (transmitters, 4–20) or in engineering
 *   units (gauges and indicators)
 * @returns {{valid, ok?, worstPct?, points?, reason?}}
 */
export function judgeCalibration(points, req) {
  if (req.reason) return { valid: false, reason: req.reason };
  const list = (points || []).map((p) => ({ applied: num(p.applied), output: num(p.output) }));
  if (list.some((p) => p.applied === null || p.output === null)) return { valid: false, reason: "نقطه‌ای بدون عدد" };
  if (list.length < 5) return { valid: false, reason: `${list.length} نقطه — دست‌کم ۵ نقطه در طول رنج لازم است` };
  const span = req.hi - req.lo;
  const edge = span * 0.01;
  const applied = list.map((p) => p.applied);
  if (Math.min(...applied) > req.lo + edge || Math.max(...applied) < req.hi - edge) {
    return { valid: false, reason: `نقاط به دو سر رنج (${req.lo} و ${req.hi}) نمی‌رسند — خطای صفر و اسپن سنجیده نشده` };
  }
  const judged = list.map((p) => {
    const expected = req.output === "mA" ? 4 + (16 * (p.applied - req.lo)) / span : p.applied;
    const errPct = req.output === "mA"
      ? (Math.abs(p.output - expected) / 16) * 100
      : (Math.abs(p.output - expected) / span) * 100;
    return { ...p, expected: round3(expected), errPct: round3(errPct) };
  });
  const worstPct = Math.max(...judged.map((p) => p.errPct));
  return { valid: true, ok: worstPct <= req.tolerancePct, worstPct, points: judged,
    reason: worstPct <= req.tolerancePct ? null : `بیشترین خطا ${worstPct}% اسپن، مجاز ${req.tolerancePct}%` };
}

// ── reading an instrument index ──────────────────────────────────────────

const HEADER_RULES = [
  ["tagNo", /^(tag\s*(no|number)?|instrument\s*tag|instrument)\.?$/i],
  ["service", /(service|description)/i],
  ["type", /^type|instrument\s*type/i],
  ["range", /(range|calibrat)/i],
  ["loop", /^loop/i],
  ["equipment", /(equipment|eq\.?\s*tag|line\s*\/\s*equip)/i],
  ["tolerance", /(tolerance|accuracy)/i],
];

/**
 * An instrument index, pasted or exported as CSV/TSV.
 *
 * The loop is taken from the index when it has a Loop column, and derived by
 * the ISA 5.1 rule otherwise — marked as derived so it can be corrected.
 */
export function parseInstrumentIndex(text) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], problems: [], columns: {} };
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const head = splitRow(lines[0], sep);
  const columns = {};
  head.forEach((h, i) => {
    const hit = HEADER_RULES.find(([k, re]) => !(k in columns) && re.test(h.trim()));
    if (hit) columns[hit[0]] = i;
  });
  if (!("tagNo" in columns)) {
    return { rows: [], problems: [{ line: 1, tagNo: null, text: "ستون تگ ابزار پیدا نشد" }], columns };
  }
  const rows = [], problems = [], seen = new Set();
  lines.slice(1).forEach((l, idx) => {
    const c = splitRow(l, sep);
    const get = (k) => (k in columns ? (c[columns[k]] || "").trim() : "");
    const tagNo = get("tagNo").toUpperCase().replace(/\s+/g, "");
    const line = idx + 2;
    if (!tagNo) return;
    if (seen.has(tagNo)) { problems.push({ line, tagNo, text: "تگ تکراری — ردیف دوم کنار گذاشته شد" }); return; }
    seen.add(tagNo);
    const isa = parseTag(tagNo);
    if (!isa) problems.push({ line, tagNo, text: "حروف تگ با جدول ISA 5.1 خوانده نشد — نوع و لوپ تعیین نشد" });
    const rangeText = get("range");
    const range = parseRange(rangeText);
    if (rangeText && !range) problems.push({ line, tagNo, text: `رنج «${rangeText}» خوانده نشد` });
    const loopCol = get("loop").toUpperCase();
    rows.push({
      tagNo, service: get("service") || null, type: get("type") || null,
      category: isa?.category ?? null, variable: isa?.variable ?? null,
      loopNo: loopCol || isa?.loop || null, loopDerived: !loopCol && !!isa,
      equipment: get("equipment") || null,
      rangeLo: range?.lo ?? null, rangeHi: range?.hi ?? null, rangeUnit: range?.unit ?? null,
      tolerancePct: num(get("tolerance").replace(/[%±+]/g, "")),
    });
  });
  return { rows, problems, columns };
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
