/**
 * May this welder make this weld?
 *
 * This is the most safety-critical check in the programme. A weld made by a
 * welder outside their qualified range is a code violation, and it is found
 * either here, or by an inspector months later when the spool is painted and
 * in the rack. So the answer is deterministic, it cites the clause it came
 * from, and a genuine failure BLOCKS rather than warns.
 *
 * Three verdicts, and the difference between the last two matters:
 *
 *   blocking  — the code says no. The assignment is refused.
 *   warning   — allowed, but someone should look: an expiry approaching,
 *               continuity running out, a WPS range that does not cover this.
 *   unverified — the check could not run because data is missing. NOT a pass.
 *               Silence about an unchecked rule is how unqualified welds get
 *               made, so every one of these names exactly what it needs.
 */
import { resolveQualification, continuityDeadline, CONTINUITY_MONTHS } from "./asme-ix.mjs";
import { od as odOf } from "../standards.js";

const day = 24 * 60 * 60 * 1000;

/**
 * @param {object} weld              { nps, wallThicknessMm?, position?, process? }
 * @param {object} welder           { stamp_no, name }
 * @param {Array}  qualifications   welder_qualification rows
 * @param {object} opts             { weldDate, lastUsedByProcess: Map, wps }
 */
export function checkAssignment({ weld, welder, qualifications = [], wps = null, weldDate = new Date(),
                                  lastUsedByProcess = new Map() }) {
  const blocking = [], warnings = [], unverified = [], notes = [];
  const when = new Date(weldDate);
  const process = String(weld.process || wps?.process || "").toUpperCase();

  if (!process) {
    unverified.push({ code: "NO_PROCESS", message:
      "فرایند جوشکاری مشخص نیست — از WPS یا از خود جوش باید بیاید." });
  }

  const live = qualifications
    .map(resolveQualification)
    .filter((q) => !q.revokedAt);

  if (!live.length) {
    blocking.push({ code: "NO_QUALIFICATION", message:
      `جوشکار ${welder?.stamp_no || "?"} هیچ صلاحیت معتبری ثبت‌شده ندارد.` });
    return verdict({ blocking, warnings, unverified, notes, welder, process });
  }

  const forProcess = process ? live.filter((q) => q.process === process) : live;
  if (process && !forProcess.length) {
    blocking.push({ code: "PROCESS_NOT_QUALIFIED", message:
      `برای فرایند ${process} صلاحیتی ندارد. صلاحیت‌های موجود: ` +
      `${[...new Set(live.map((q) => q.process))].join("، ") || "—"}.`, clause: "QW-301" });
    return verdict({ blocking, warnings, unverified, notes, welder, process });
  }

  // Any ONE qualification that covers the weld is enough, so the checks run
  // per qualification and the best outcome wins.
  const attempts = forProcess.map((q) => evaluateOne(q, { weld, when, lastUsedByProcess }));
  const passing = attempts.filter((a) => !a.blocking.length);

  if (!passing.length) {
    // Report the closest attempt rather than all of them: an engineer needs
    // the one reason to act on, not a wall of near-misses.
    const best = attempts.sort((a, b) => a.blocking.length - b.blocking.length)[0];
    blocking.push(...best.blocking);
    warnings.push(...best.warnings);
    unverified.push(...best.unverified);
  } else {
    const best = passing.sort((a, b) => a.warnings.length - b.warnings.length)[0];
    warnings.push(...best.warnings);
    unverified.push(...best.unverified);
    notes.push(`منطبق با گواهی ${best.certificateNo || "بدون شماره"}`);
  }

  // The WPS is a separate authority: the welder may be qualified and the
  // procedure still not cover this joint.
  if (wps) {
    const t = Number(weld.wallThicknessMm);
    const lo = Number(wps.thickness_min_mm ?? wps.thicknessMinMm);
    const hi = Number(wps.thickness_max_mm ?? wps.thicknessMaxMm);
    if (Number.isFinite(t) && Number.isFinite(lo) && Number.isFinite(hi) && (t < lo || t > hi)) {
      warnings.push({ code: "WPS_THICKNESS", message:
        `ضخامت ${t} mm خارج از بازهٔ WPS ${wps.wps_no || wps.wpsNo} است (${lo}–${hi} mm).` });
    }
    if (process && wps.process && String(wps.process).toUpperCase() !== process) {
      blocking.push({ code: "WPS_PROCESS_MISMATCH", message:
        `فرایند جوش ${process} با فرایند WPS ${String(wps.process).toUpperCase()} نمی‌خواند.` });
    }
  } else {
    unverified.push({ code: "NO_WPS", message: "WPS به این جوش تخصیص داده نشده است." });
  }

  // Stated once, loudly, rather than silently assumed either way.
  unverified.push({ code: "F_NUMBER_NOT_CHECKED", message:
    "تطابق F-Number و P-Number بررسی نشده — به ماتریس صلاحیت و PQR های پروژه نیاز دارد." });

  return verdict({ blocking, warnings, unverified, notes, welder, process });
}

function evaluateOne(q, { weld, when, lastUsedByProcess }) {
  const blocking = [], warnings = [], unverified = [];

  if (q.expiresOn) {
    const exp = new Date(q.expiresOn);
    if (exp < when) {
      blocking.push({ code: "QUALIFICATION_EXPIRED", message:
        `گواهی ${q.certificateNo || ""} در ${iso(exp)} منقضی شده است.` });
    } else if (exp - when < 30 * day) {
      warnings.push({ code: "QUALIFICATION_EXPIRING", message:
        `گواهی ${q.certificateNo || ""} در ${iso(exp)} منقضی می‌شود — کمتر از ۳۰ روز.` });
    }
  }

  // QW-322.1: the rule a paper register loses track of.
  const lastUsed = lastUsedByProcess.get(q.process);
  const deadline = continuityDeadline(lastUsed);
  if (deadline) {
    if (deadline < when) {
      blocking.push({ code: "CONTINUITY_LAPSED", clause: "QW-322.1", message:
        `آخرین جوش با فرایند ${q.process} در ${iso(lastUsed)} بوده — بیش از ${CONTINUITY_MONTHS} ماه. ` +
        `صلاحیت طبق QW-322.1 ساقط است و باید تجدید شود.` });
    } else if (deadline - when < 30 * day) {
      warnings.push({ code: "CONTINUITY_EXPIRING", clause: "QW-322.1", message:
        `پیوستگی ${q.process} در ${iso(deadline)} تمام می‌شود — کمتر از ۳۰ روز.` });
    }
  } else {
    unverified.push({ code: "NO_WELD_HISTORY", message:
      `سابقهٔ جوش با فرایند ${q.process} ثبت نشده، پس پیوستگی QW-322.1 قابل بررسی نیست.` });
  }

  // Diameter
  const odMm = weld.odMm != null ? Number(weld.odMm) : (weld.nps != null ? odOf(Number(weld.nps)) : null);
  if (q.diameter && Number.isFinite(odMm)) {
    if (odMm < q.diameter.min) {
      blocking.push({ code: "DIAMETER_OUT_OF_RANGE", clause: "QW-452.3", message:
        `قطر خارجی ${round(odMm)} mm کمتر از حد مجاز ${round(q.diameter.min)} mm است. ${q.diameter.basis}` });
    }
  } else if (!q.diameter) {
    unverified.push({ code: "NO_COUPON_OD", message: "قطر کوپن آزمون ثبت نشده — بازهٔ قطر قابل محاسبه نیست." });
  } else {
    unverified.push({ code: "NO_WELD_DIAMETER", message: "قطر جوش مشخص نیست." });
  }

  // Thickness — from the piping class, never guessed from a schedule label.
  const t = Number(weld.wallThicknessMm);
  if (Number.isFinite(t) && t > 0) {
    if (q.baseThickness && (t < q.baseThickness.min || t > q.baseThickness.max)) {
      blocking.push({ code: "THICKNESS_OUT_OF_RANGE", clause: "QW-452.1", message:
        `ضخامت ${t} mm خارج از بازهٔ ${round(q.baseThickness.min)}–${fmt(q.baseThickness.max)} mm است. ` +
        q.baseThickness.basis });
    }
    if (q.deposited && t > q.deposited.max) {
      blocking.push({ code: "DEPOSITED_OUT_OF_RANGE", clause: "QW-452.1", message:
        `ضخامت ${t} mm از حد رسوب جوش ${fmt(q.deposited.max)} mm بیشتر است. ${q.deposited.basis}` });
    }
  } else {
    unverified.push({ code: "NO_WALL_THICKNESS", message:
      "ضخامت دیواره مشخص نیست — از Piping Class پروژه باید بیاید؛ از روی برچسب SCH حدس زده نمی‌شود." });
  }

  // Position
  if (weld.position) {
    const want = String(weld.position).toUpperCase();
    if (!q.positions.length) {
      unverified.push({ code: "NO_TEST_POSITION", message: "وضعیت آزمون ثبت نشده." });
    } else if (!q.positions.includes(want)) {
      blocking.push({ code: "POSITION_NOT_QUALIFIED", clause: "QW-461.9", message:
        `وضعیت ${want} پوشش داده نشده. وضعیت‌های مجاز: ${q.positions.join("، ")}.` });
    }
  } else {
    unverified.push({ code: "NO_WELD_POSITION", message: "وضعیت جوشکاری این جوش مشخص نیست." });
  }

  return { blocking, warnings, unverified, certificateNo: q.certificateNo };
}

function verdict({ blocking, warnings, unverified, notes, welder, process }) {
  return {
    ok: blocking.length === 0,
    welder: welder?.stamp_no || null,
    process: process || null,
    blocking,
    warnings,
    unverified,
    notes,
  };
}

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const round = (n) => Math.round(n * 10) / 10;
const fmt = (n) => (n === Infinity ? "∞" : round(n));
