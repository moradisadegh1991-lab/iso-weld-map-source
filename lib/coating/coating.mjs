/**
 * Painting and insulation: the coating module's deterministic engine.
 *
 * Four checks an inspector otherwise does with a gauge and a calculator:
 *
 *   SURFACE PREPARATION. The ISO 8501-1 grade achieved against the grade the
 *   painting system requires (Sa 1 < Sa 2 < Sa 2½ < Sa 3; St 2 < St 3), and
 *   the blast profile against the system's range.
 *
 *   APPLICATION CONDITIONS. Dew point from air temperature and relative
 *   humidity (Magnus formula, Sonntag constants), and the steel at least
 *   3 °C above it — the margin ISO 8502-4 is used to verify, and the one
 *   coating specifications write (a project may state its own). RH is
 *   checked only against a limit the project or the product data sheet
 *   states; there is no default.
 *
 *   DRY FILM THICKNESS, ISO 19840. For each coat, on the readings taken
 *   after it (cumulative, as a gauge reads them):
 *     (a) the arithmetic mean ≥ the nominal DFT;
 *     (b) no reading below 80% of nominal;
 *     (c) readings between 80% and 100% of nominal no more than 20% of all;
 *     (d) no reading above the maximum DFT, where one is specified.
 *   And the number of readings sufficient for the area inspected.
 *
 *   INSULATION THICKNESS. Every reading at least the specified thickness.
 *
 * WHERE THIS REFUSES TO ANSWER (F-10): conditions with a value missing, a
 * DFT set too small for its area or with no area at all, a grade it cannot
 * read. Check paragraph and table numbers against the editions your
 * contract names (ISO 8501-1:2007, ISO 8502-4:2017, ISO 19840:2012).
 */

// ── surface preparation ──────────────────────────────────────────────────

const GRADES = {
  "Sa 1": { family: "Sa", rank: 1 }, "Sa 2": { family: "Sa", rank: 2 },
  "Sa 2½": { family: "Sa", rank: 2.5 }, "Sa 3": { family: "Sa", rank: 3 },
  "St 2": { family: "St", rank: 2 }, "St 3": { family: "St", rank: 3 },
};
export const PREP_GRADES = Object.keys(GRADES);

/** "SA2.5", "sa 2 1/2", "Sa 2½" → "Sa 2½"; unreadable → null. */
export function normalizeGrade(text) {
  const s = String(text || "").toLowerCase().replace(/\s+/g, "");
  const m = s.match(/^(sa|st)(1|2|2\.5|2½|21\/2|3)$/);
  if (!m) return null;
  const rank = { "2.5": "2½", "21/2": "2½" }[m[2]] || m[2];
  const key = `${m[1] === "sa" ? "Sa" : "St"} ${rank}`;
  return GRADES[key] ? key : null;
}

/**
 * Does the achieved grade meet the required one?
 * Blast cleaning to Sa 2 or better exceeds any hand/power-tool grade; a
 * tool-cleaned surface never meets a blast grade.
 */
export function prepSatisfies(achieved, required) {
  const a = GRADES[normalizeGrade(achieved)], r = GRADES[normalizeGrade(required)];
  if (!a || !r) return null;
  if (a.family === r.family) return a.rank >= r.rank;
  return r.family === "St" && a.family === "Sa" && a.rank >= 2;
}

export function judgePrep({ grade, profile = [] }, system) {
  const g = normalizeGrade(grade);
  if (!g) return { valid: false, reason: `درجهٔ آماده‌سازی «${grade}» خوانده نشد (مثلاً Sa 2½)` };
  const meets = prepSatisfies(g, system.prepGrade);
  if (meets === null) return { valid: false, reason: `درجهٔ الزامی سیستم «${system.prepGrade}» خوانده نشد` };
  const reasons = [];
  if (!meets) reasons.push(`${g} کمتر از ${normalizeGrade(system.prepGrade)} الزامی است`);
  const lo = num(system.profileMin), hi = num(system.profileMax);
  const readings = (profile || []).map(num).filter((v) => v !== null);
  if (lo !== null || hi !== null) {
    if (!readings.length) return { valid: false, reason: "زبری سطح (پروفیل) اندازه‌گیری نشده، سیستم آن را الزام کرده" };
    const out = readings.filter((v) => (lo !== null && v < lo) || (hi !== null && v > hi));
    if (out.length) reasons.push(`پروفیل ${out.join("، ")} µm بیرون از ${lo ?? "—"}–${hi ?? "—"} µm`);
  }
  return { valid: true, ok: !reasons.length, grade: g, reason: reasons.join(" · ") || null };
}

// ── application conditions ───────────────────────────────────────────────

/** Dew point, °C (Magnus–Sonntag, over water). */
export function dewPoint(airC, rh) {
  const b = 17.62, c = 243.12;
  const g = Math.log(rh / 100) + (b * airC) / (c + airC);
  return (c * g) / (b - g);
}

export function judgeConditions({ airC, rh, steelC }, { marginC = 3, maxRh = null } = {}) {
  const a = num(airC), h = num(rh), s = num(steelC);
  if (a === null || h === null || s === null) {
    return { valid: false, reason: "دمای هوا، رطوبت نسبی و دمای سطح فولاد هر سه لازم است" };
  }
  if (!(h > 0 && h <= 100)) return { valid: false, reason: `رطوبت نسبی ${h}% ممکن نیست` };
  const td = round1(dewPoint(a, h));
  const margin = round1(s - td);
  const reasons = [];
  if (margin < marginC) reasons.push(`فولاد ${margin} °C بالای نقطهٔ شبنم (${td} °C)؛ دست‌کم ${marginC} °C لازم است`);
  if (maxRh !== null && h > maxRh) reasons.push(`رطوبت ${h}% بیش از ${maxRh}%`);
  return { valid: true, ok: !reasons.length, dewPointC: td, marginC: margin, reason: reasons.join(" · ") || null };
}

// ── dry film thickness, ISO 19840 ────────────────────────────────────────

/** Minimum readings for an inspection area (ISO 19840 sampling plan). */
export function minReadings(areaM2) {
  const a = num(areaM2);
  if (a === null || !(a > 0)) return null;
  if (a <= 1) return 5;
  if (a <= 3) return 10;
  if (a <= 10) return 15;
  if (a <= 30) return 20;
  if (a <= 100) return 30;
  return 30 + 10 * Math.ceil((a - 100) / 100);
}

/**
 * @param {number[]} readings  µm
 * @param {{ndft: number, maxDft?: number|null, areaM2: number}} spec
 */
export function judgeDft(readings, { ndft, maxDft = null, areaM2 }) {
  const r = (readings || []).map(num);
  if (!r.length || r.some((v) => v === null)) return { valid: false, reason: "قرائت DFT بدون عدد" };
  const need = minReadings(areaM2);
  if (need === null) return { valid: false, reason: "مساحت سطح بازرسی معلوم نیست — کفایت تعداد قرائت سنجیده نمی‌شود" };
  if (r.length < need) return { valid: false, reason: `${r.length} قرائت برای ${areaM2} m² — دست‌کم ${need} لازم است` };
  const n = Number(ndft);
  const mean = round1(r.reduce((a, b) => a + b, 0) / r.length);
  const reasons = [];
  if (mean < n) reasons.push(`میانگین ${mean} µm کمتر از ${n} µm اسمی`);
  const under80 = r.filter((v) => v < 0.8 * n);
  if (under80.length) reasons.push(`${under80.length} قرائت زیر ۸۰٪ اسمی (${round1(0.8 * n)} µm)`);
  const between = r.filter((v) => v >= 0.8 * n && v < n).length;
  if (between > 0.2 * r.length) reasons.push(`${between} از ${r.length} قرائت بین ۸۰ و ۱۰۰٪ اسمی — بیش از ۲۰٪`);
  if (maxDft !== null && maxDft !== undefined) {
    const over = r.filter((v) => v > Number(maxDft));
    if (over.length) reasons.push(`${over.length} قرائت بالای حداکثر ${maxDft} µm`);
  }
  return { valid: true, ok: !reasons.length, mean, min: Math.min(...r), max: Math.max(...r), n: r.length,
    required: need, reason: reasons.join(" · ") || null };
}

// ── insulation ───────────────────────────────────────────────────────────

export const INSULATION = { none: "بدون عایق", hot: "عایق گرم", cold: "عایق سرد", personnel: "حفاظت پرسنل" };

export function judgeInsulation(readings, specMm) {
  const r = (readings || []).map(num);
  if (!r.length || r.some((v) => v === null)) return { valid: false, reason: "ضخامت عایق اندازه‌گیری نشده" };
  const spec = num(specMm);
  if (spec === null) return { valid: false, reason: "ضخامت عایق مشخصات ثبت نشده" };
  const thin = r.filter((v) => v < spec);
  return { valid: true, ok: !thin.length,
    reason: thin.length ? `${thin.length} قرائت کمتر از ${spec} mm (${thin.join("، ")})` : null };
}

// ── area ─────────────────────────────────────────────────────────────────

/**
 * External surface of a spool, m² = π · OD · L.
 *
 * `od` is the exact ASME B36.10M table (lib/standards.js OD) — never an
 * estimate: a guessed area would set a guessed number of DFT readings. The
 * spool's LARGEST size is used, which over-states the area of a reducing
 * spool and so asks for more readings, not fewer.
 */
export function spoolAreaM2(odMm, lengthMm) {
  const d = num(odMm), l = num(lengthMm);
  if (!(d > 0) || !(l > 0)) return null;
  return Math.round(Math.PI * d * l / 1e4) / 100;
}

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const round1 = (n) => Math.round(n * 10) / 10;
