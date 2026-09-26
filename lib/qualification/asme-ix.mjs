/**
 * ASME Section IX welder performance qualification ranges.
 *
 * WHAT IS ENCODED HERE, AND WHAT IS DELIBERATELY NOT
 *
 * Encoded: the process match, the pipe diameter range (QW-452.3), the base
 * metal and deposited weld metal thickness ranges (QW-452.1), the position
 * ranges (QW-461.9), and the six-month continuity rule (QW-322.1).
 *
 * Not encoded, on purpose:
 *   - F-number and P-number substitution. The permitted substitutions depend
 *     on the filler metal group and on what the project's PQRs actually
 *     support, and getting them wrong means passing a weld that the code
 *     rejects. The checker reports them as unverified rather than guessing.
 *   - wall thickness from a schedule designation. B36.10M is a large table
 *     and this file will not carry a half-remembered copy of it; thickness
 *     comes from the piping class, which is the authority anyway.
 *
 * THE PROJECT ALWAYS GOVERNS. Where a project's qualification matrix, WPS or
 * client specification is stricter than the code, the stricter one wins. This
 * module computes the CODE range; narrowing it is the project's business and
 * is expressed by recording a narrower qualification.
 */

/** QW-452.3 — pipe diameter. Coupon OD in mm, result is the qualified OD band. */
export function diameterRange(couponOdMm) {
  const od = Number(couponOdMm);
  if (!Number.isFinite(od) || od <= 0) return null;
  if (od < 25.4) return { min: od, max: Infinity, basis: "QW-452.3 — زیر ۱ اینچ: همان سایز و بالاتر" };
  if (od < 73) return { min: 25.4, max: Infinity, basis: "QW-452.3 — ۱ تا زیر ۲⅞ اینچ: از ۱ اینچ به بالا" };
  return { min: 73, max: Infinity, basis: "QW-452.3 — ۲⅞ اینچ و بالاتر: از ۲⅞ اینچ به بالا" };
}

/**
 * QW-452.1(b) — base metal thickness qualified by a groove weld coupon.
 * Under 3/8 in the welder is qualified to twice the coupon; at or above it,
 * to any thickness.
 */
export function baseThicknessRange(couponThicknessMm) {
  const T = Number(couponThicknessMm);
  if (!Number.isFinite(T) || T <= 0) return null;
  const min = 1.6;                                 // 1/16 in
  if (T < 9.5) return { min, max: 2 * T, basis: `QW-452.1(b) — کوپن ${T} mm زیر ⅜ اینچ: تا ۲T` };
  return { min, max: Infinity, basis: `QW-452.1(b) — کوپن ${T} mm از ⅜ اینچ بالاتر: بدون محدودیت` };
}

/** QW-452.1(b) — deposited weld metal thickness, the same shape keyed on 1/2 in. */
export function depositedThicknessRange(depositedMm) {
  const t = Number(depositedMm);
  if (!Number.isFinite(t) || t <= 0) return null;
  if (t < 12.7) return { min: 0, max: 2 * t, basis: `QW-452.1(b) — رسوب ${t} mm زیر ½ اینچ: تا ۲t` };
  return { min: 0, max: Infinity, basis: `QW-452.1(b) — رسوب ${t} mm از ½ اینچ بالاتر: بدون محدودیت` };
}

/**
 * QW-461.9 — which welding positions a test position qualifies.
 *
 * F flat · H horizontal · V vertical · OH overhead. Pipe positions carry the
 * plate positions they cover; 6G is the one that covers everything, which is
 * why it is what site welders are normally tested to.
 */
export const POSITION_RANGE = {
  "1G": ["F"],
  "2G": ["F", "H"],
  "3G": ["F", "V"],
  "4G": ["F", "OH"],
  "5G": ["F", "V", "OH"],
  "6G": ["F", "H", "V", "OH"],
  "1F": ["F"],
  "2F": ["F", "H"],
  "4F": ["F", "OH"],
  "5F": ["F", "V", "OH"],
  "6GR": ["F", "H", "V", "OH"],
};

export function positionRange(testPositions = []) {
  const covered = new Set();
  for (const p of [].concat(testPositions)) {
    for (const x of POSITION_RANGE[String(p).toUpperCase()] || []) covered.add(x);
  }
  return [...covered];
}

/**
 * QW-322.1 — continuity.
 *
 * A qualification is not a certificate with a date on it: it lapses when the
 * welder has not used that process for six months. Projects usually also
 * record an administrative expiry, and both are checked, but this is the one
 * the code actually cares about and the one a paper register loses track of.
 */
export const CONTINUITY_MONTHS = 6;

export function continuityDeadline(lastUsedAt) {
  if (!lastUsedAt) return null;
  const d = new Date(lastUsedAt);
  if (Number.isNaN(d.getTime())) return null;
  const out = new Date(d);
  out.setMonth(out.getMonth() + CONTINUITY_MONTHS);
  return out;
}

export const PROCESSES = ["SMAW", "GTAW", "GMAW", "FCAW", "SAW"];

/** Everything one qualification record permits, resolved into plain numbers. */
export function resolveQualification(q) {
  return {
    process: String(q.process || "").toUpperCase(),
    diameter: diameterRange(q.coupon_od_mm ?? q.couponOdMm),
    baseThickness: baseThicknessRange(q.coupon_thickness_mm ?? q.couponThicknessMm),
    deposited: depositedThicknessRange(q.deposited_thickness_mm ?? q.depositedThicknessMm),
    positions: positionRange(q.qw_position ?? q.position ?? []),
    expiresOn: q.expires_on ?? q.expiresOn ?? null,
    revokedAt: q.revoked_at ?? q.revokedAt ?? null,
    certificateNo: q.certificate_no ?? q.certificateNo ?? null,
  };
}
