/**
 * Structural steel: the structural module's deterministic engine.
 *
 * What lib/civil/concrete.mjs is to a foundation, this is to a pipe rack or
 * a platform. It answers two questions a site otherwise answers by eye:
 *
 *   Is it plumb?    Column out-of-plumbness against the erection standard
 *                   the PROJECT names — this file does not pick one.
 *   Is it bolted?   A pretensioned or slip-critical joint is only as good as
 *                   the pretension the tightening method was shown to reach
 *                   before installation. A tick that says "bolted" does not
 *                   say that; a verification result does.
 *
 * THE RULES, AS THE STANDARDS STATE THEM
 *
 *   Plumbness
 *     AISC 303 §7.13.1.1 — an individual column is plumb to within 1:500 of
 *       the distance between working points.
 *     EN 1090-2 Annex B — essential tolerance on the inclination of a column
 *       in a single-storey frame: h/300.
 *   Each is applied to each of two orthogonal directions separately, which is
 *   how a survey reads a column. The additional absolute limits AISC 303 sets
 *   for exterior and elevator columns of multi-storey buildings are not
 *   applied: a pipe rack is not a building façade.
 *
 *   Minimum pretension (pretensioned and slip-critical joints)
 *     ASTM F3125 A325M / A490M — AISC 360 Table J3.1M, stated values.
 *     ISO 898 8.8 / 10.9       — EN 1090-2 §8.5.1: Fp,C = 0.7 · fub · As.
 *   The AISC table is itself 0.70 · Fu · As, rounded; a test holds the two
 *   together so a mistyped table row cannot survive.
 *
 *   Pre-installation verification
 *     RCSC Specification §7: the method, bolts and crew are shown on a
 *       tension calibrator to reach at least 1.05 × the minimum pretension.
 *     EN 1090-2: the verification must reach Fp,C. That is a floor, not the
 *       standard's whole procedure (Annex H); a project that demands more
 *       states it in its own spec.
 *
 * WHERE THIS REFUSES TO ANSWER (F-10)
 *
 *   - plumbness with no erection standard on the project;
 *   - a column read in one direction only — it says nothing of the other;
 *   - a pretensioned joint with no verification, no method, a method from
 *     the other standard family, or a size the table does not list.
 *
 * Paragraph numbers are from AISC 303-16, AISC 360-16, RCSC 2014 and
 * EN 1090-2:2018. Check them against the editions your contract names.
 */

// ── erection tolerance ───────────────────────────────────────────────────

export const ERECTION_STANDARDS = {
  AISC303: { title: "AISC 303 — ۱:۵۰۰", ratio: 500, cite: "AISC 303 §7.13.1.1" },
  "EN1090-2": { title: "EN 1090-2 — h/300", ratio: 300, cite: "EN 1090-2 Annex B" },
};

/**
 * One column's reading.
 *
 * @param {{heightMm, dxMm, dyMm}} r  dx, dy: top relative to base, mm
 * @param {string} standard           a key of ERECTION_STANDARDS
 * @returns {{valid: boolean, limitMm?, worstMm?, ok?, reason?}}
 */
export function plumbCheck(r, standard) {
  const std = ERECTION_STANDARDS[standard];
  if (!std) return { valid: false, reason: "استاندارد نصب اسکلت در مشخصات پروژه ثبت نشده" };
  const h = Number(r?.heightMm);
  if (!(h > 0)) return { valid: false, reason: "ارتفاع ستون بین نقاط کار لازم است" };
  // Number(null) is 0, which would read a missing direction as perfectly
  // plumb. Missing is missing.
  const dx = num(r?.dxMm), dy = num(r?.dyMm);
  if (dx === null || dy === null) {
    return { valid: false, reason: "هر دو جهت لازم است — قرائت یک جهت از جهت دیگر چیزی نمی‌گوید" };
  }
  const limitMm = round1(h / std.ratio);
  const worstMm = Math.max(Math.abs(dx), Math.abs(dy));
  return { valid: true, limitMm, worstMm, ok: worstMm <= limitMm };
}

/**
 * A structure's survey, judged.
 *
 * The LATEST reading of each column stands: a column that was out, then
 * corrected and re-shot, is judged by the re-shoot. Readings are ordered by
 * the caller (survey date, then entry).
 *
 * @param {Array<{columnMark, heightMm, dxMm, dyMm}>} readings  oldest first
 * @param {{standard: string, columns: number|null}} spec
 * @returns {{judged: boolean, reason?, columns: Array, out: Array, invalid: Array,
 *            surveyed: number, expected: number|null, complete: boolean|null}}
 */
export function surveyVerdict(readings, { standard, columns = null } = {}) {
  if (!ERECTION_STANDARDS[standard]) {
    return { judged: false, reason: "استاندارد نصب اسکلت در مشخصات پروژه ثبت نشده — شاقولی حکم نمی‌گیرد.",
      columns: [], out: [], invalid: [], surveyed: 0, expected: columns, complete: null };
  }
  const latest = new Map();
  for (const r of readings || []) latest.set(String(r.columnMark).trim().toUpperCase(), r);
  const judged = [...latest.entries()].map(([mark, r]) => ({ mark, ...r, ...plumbCheck(r, standard) }));
  const expected = Number(columns) > 0 ? Number(columns) : null;
  return {
    judged: true,
    columns: judged,
    out: judged.filter((c) => c.valid && !c.ok),
    invalid: judged.filter((c) => !c.valid),
    surveyed: judged.length,
    expected,
    // Without a column count, "every column surveyed" cannot be said.
    complete: expected === null ? null : judged.length >= expected,
  };
}

// ── bolting ──────────────────────────────────────────────────────────────

export const JOINT_TYPES = {
  snug: { title: "Snug-tight", pretensioned: false },
  pretensioned: { title: "Pretensioned", pretensioned: true },
  slip_critical: { title: "Slip-critical", pretensioned: true },
};

export const BOLT_GRADES = {
  A325M: { title: "ASTM F3125 A325M", family: "ASTM", fu: 830 },
  A490M: { title: "ASTM F3125 A490M", family: "ASTM", fu: 1040 },
  "8.8": { title: "ISO 8.8 (EN 14399)", family: "EN", fu: 800 },
  "10.9": { title: "ISO 10.9 (EN 14399)", family: "EN", fu: 1000 },
};

/** Tensile stress area, mm² (ISO 898-1). */
export const STRESS_AREA = { M12: 84.3, M16: 157, M20: 245, M22: 303, M24: 353, M27: 459, M30: 561, M36: 817 };

/** AISC 360-16 Table J3.1M, kN. M12 is not in the table and is not guessed. */
const AISC_J3_1M = {
  A325M: { M16: 91, M20: 142, M22: 176, M24: 205, M27: 267, M30: 326, M36: 475 },
  A490M: { M16: 114, M20: 179, M22: 221, M24: 257, M27: 334, M30: 408, M36: 595 },
};

export const METHODS = {
  turn_of_nut: { title: "Turn-of-nut", families: ["ASTM"] },
  calibrated_wrench: { title: "Calibrated wrench", families: ["ASTM"] },
  twist_off: { title: "Twist-off (TC / HRC)", families: ["ASTM", "EN"] },
  dti: { title: "DTI", families: ["ASTM", "EN"] },
  torque: { title: "Torque method", families: ["EN"] },
  combined: { title: "Combined method", families: ["EN"] },
};

/** Verification margin over the minimum pretension, by standard family. */
const VERIFY_FACTOR = { ASTM: 1.05, EN: 1.0 };

/** Minimum pretension, kN — or null for a grade/size the standard does not list. */
export function minPretension(grade, size) {
  const g = BOLT_GRADES[grade];
  if (!g) return null;
  if (g.family === "ASTM") return AISC_J3_1M[grade]?.[size] ?? null;
  const as = STRESS_AREA[size];
  return as ? round1((0.7 * g.fu * as) / 1000) : null;
}

/**
 * One bolting record: a number of joints of one type, grade and size,
 * tightened by one method, with the verification that method was shown to
 * reach.
 *
 * @returns {{valid: boolean, required?: number, target?: number, reason?: string}}
 */
export function judgeBolting(rec) {
  const jt = JOINT_TYPES[rec?.jointType];
  if (!jt) return { valid: false, reason: `نوع اتصال «${rec?.jointType}» شناخته نشد` };
  if (!(Number(rec.joints) > 0)) return { valid: false, reason: "تعداد اتصال لازم است" };
  const g = BOLT_GRADES[rec.boltGrade];
  if (!g) return { valid: false, reason: `گرید پیچ «${rec.boltGrade}» شناخته نشد` };
  if (!STRESS_AREA[rec.boltSize]) return { valid: false, reason: `سایز «${rec.boltSize}» شناخته نشد` };

  // Snug-tight: the full effort of an ironworker on an ordinary spud wrench.
  // No pretension is specified, so none is verified.
  if (!jt.pretensioned) return { valid: true };

  const required = minPretension(rec.boltGrade, rec.boltSize);
  if (required === null) {
    return { valid: false, reason: `${g.title} ${rec.boltSize} در جدول پیش‌تنیدگی نیست — حداقل آن فرض نمی‌شود` };
  }
  const m = METHODS[rec.method];
  if (!m) return { valid: false, required, reason: "روش سفت‌کردن برای اتصال پیش‌تنیده لازم است" };
  if (!m.families.includes(g.family)) {
    return { valid: false, required,
      reason: `روش ${m.title} از خانوادهٔ استاندارد دیگری است و برای ${g.title} پذیرفته نیست` };
  }
  const target = round1(required * VERIFY_FACTOR[g.family]);
  const v = num(rec.verifiedKn);
  if (v === null) {
    return { valid: false, required, target,
      reason: `آزمون پیش از نصب (کالیبراتور کشش) ثبت نشده — دست‌کم ${target} kN لازم است` };
  }
  if (v < target) {
    return { valid: false, required, target,
      reason: `آزمون پیش از نصب ${v} kN به ${target} kN نرسید`
        + (g.family === "ASTM" ? ` (۱٫۰۵ × ${required})` : "") };
  }
  return { valid: true, required, target };
}

/**
 * A structure's bolting, judged from its records.
 *
 * A failed record is cleared by a LATER valid record of the same joint type,
 * grade and size (and lot, when the failed one named a lot): the joints were
 * re-tightened with a method that was then shown to work. Its own joints do
 * not count — they were never validly tightened.
 *
 * @param {Array} records  oldest first
 * @param {{boltedJoints: number|null}} spec
 */
export function boltingVerdict(records, { boltedJoints = null } = {}) {
  const judged = (records || []).map((r) => ({ ...r, ...judgeBolting(r) }));
  const failed = judged.filter((r, i) => !r.valid && !judged.slice(i + 1).some((l) =>
    l.valid && l.jointType === r.jointType && l.boltGrade === r.boltGrade && l.boltSize === r.boltSize
    && (!r.lotRef || l.lotRef === r.lotRef)));
  const joints = judged.filter((r) => r.valid).reduce((a, r) => a + Number(r.joints), 0);
  const expected = Number(boltedJoints) > 0 ? Number(boltedJoints) : null;
  return {
    records: judged,
    failed,
    joints,
    expected,
    complete: expected === null ? null : joints >= expected,
  };
}

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const round1 = (n) => Math.round(n * 10) / 10;
