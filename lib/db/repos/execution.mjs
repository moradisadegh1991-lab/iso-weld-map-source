/**
 * Welders, their qualifications, and what they actually welded.
 *
 * Every record here keys on `weld_uid`, so it survives the revisions that
 * rewrite the weld rows themselves. Call inside `withProject`.
 */
import { checkAssignment } from "../../qualification/check.mjs";

// ── welders and their tickets ────────────────────────────────────────────

export async function upsertWelder(db, { projectId, stampNo, name, employer = null }) {
  const { rows } = await db.query(
    `INSERT INTO welder (project_id, stamp_no, name, employer)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (project_id, stamp_no) DO UPDATE
       SET name = EXCLUDED.name, employer = COALESCE(EXCLUDED.employer, welder.employer)
     RETURNING *`,
    [projectId, stampNo, name, employer]);
  return rows[0];
}

export async function addQualification(db, { projectId, welderId, process, positions = [],
  couponOdMm = null, couponThicknessMm = null, depositedThicknessMm = null,
  backing = null, fNumber = null, pNumber = null, certificateNo = null,
  qualifiedOn = null, expiresOn = null }) {
  const { rows } = await db.query(
    `INSERT INTO welder_qualification (
       project_id, welder_id, process, qw_position, coupon_od_mm, coupon_thickness_mm,
       deposited_thickness_mm, backing, f_number, p_number, certificate_no,
       qualified_on, expires_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [projectId, welderId, process, positions, couponOdMm, couponThicknessMm,
     depositedThicknessMm, backing, fNumber, pNumber, certificateNo, qualifiedOn, expiresOn]);
  return rows[0];
}

export async function revokeQualification(db, { projectId, qualificationId, reason }) {
  const { rows } = await db.query(
    `UPDATE welder_qualification SET revoked_at = now(), revoked_reason = $1
      WHERE id = $2 AND project_id = $3 RETURNING *`,
    [reason, qualificationId, projectId]);
  return rows[0] || null;
}

export async function qualificationsOf(db, { projectId, welderId }) {
  const { rows } = await db.query(
    "SELECT * FROM welder_qualification WHERE project_id = $1 AND welder_id = $2 ORDER BY qualified_on",
    [projectId, welderId]);
  return rows;
}

/**
 * When this welder last used each process, for the QW-322.1 continuity rule.
 * A qualification does not expire on a date — it lapses after six months of
 * not being used, and this is the only place that fact can be recovered from.
 */
export async function lastUsedByProcess(db, { projectId, welderId }) {
  const { rows } = await db.query(
    `SELECT process, MAX(welded_at) AS last_used
       FROM weld_execution
      WHERE project_id = $1 AND welder_id = $2 AND process IS NOT NULL
      GROUP BY process`,
    [projectId, welderId]);
  return new Map(rows.map((r) => [r.process, r.last_used]));
}

// ── assignment ───────────────────────────────────────────────────────────

/**
 * Assign a weld to a welder, or refuse.
 *
 * The verdict is computed first and stored with the execution, verbatim. An
 * auditor six months later asks what was known at the time the weld was made,
 * not what today's records would say — and today's records will have moved on.
 */
export async function assignWeld(db, {
  projectId, weldUid, welderId, wpsId = null, weldedAt,
  process = null, position = null, wallThicknessMm = null, nps = null,
  lineId = null, userId = null, allowWithWarnings = true,
}) {
  // Thickness is the piping class's to state. Until EPIC-4 gave the class a
  // size table, this check could only ever report itself as unverifiable —
  // a schedule label on its own never told anyone a number.
  if (wallThicknessMm == null) {
    const found = await thicknessFromClass(db, { projectId, weldUid, lineId, nps });
    if (found) {
      wallThicknessMm = found.wallThicknessMm;
      if (nps == null) nps = found.nps;
    }
  }
  const { rows: [welder] } = await db.query(
    "SELECT * FROM welder WHERE id = $1 AND project_id = $2", [welderId, projectId]);
  if (!welder) throw notFound("welder");

  const wps = wpsId
    ? (await db.query("SELECT * FROM wps WHERE id = $1 AND project_id = $2", [wpsId, projectId])).rows[0]
    : null;
  if (wpsId && !wps) throw notFound("WPS");

  const qualifications = await qualificationsOf(db, { projectId, welderId });
  const lastUsed = await lastUsedByProcess(db, { projectId, welderId });

  const verdict = checkAssignment({
    weld: { nps, wallThicknessMm, position, process: process || wps?.process },
    welder, qualifications, wps, weldDate: weldedAt, lastUsedByProcess: lastUsed,
  });

  if (!verdict.ok) {
    const err = new Error(
      `جوش ${weldUid} به ${welder.stamp_no} تخصیص نیافت: ` +
      verdict.blocking.map((b) => b.message).join(" · "));
    err.status = 422;
    err.code = "NOT_QUALIFIED";
    err.verdict = verdict;
    throw err;
  }
  if (!allowWithWarnings && verdict.warnings.length) {
    const err = new Error(`هشدار صلاحیت: ${verdict.warnings.map((w) => w.message).join(" · ")}`);
    err.status = 409;
    err.code = "QUALIFICATION_WARNING";
    err.verdict = verdict;
    throw err;
  }

  const { rows } = await db.query(
    `INSERT INTO weld_execution (
       project_id, weld_uid, line_id, welder_id, wps_id, process, position,
       welded_at, qualification_verdict, pwht_required, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (project_id, weld_uid) DO UPDATE SET
       welder_id = EXCLUDED.welder_id, wps_id = EXCLUDED.wps_id,
       process = EXCLUDED.process, position = EXCLUDED.position,
       welded_at = EXCLUDED.welded_at, qualification_verdict = EXCLUDED.qualification_verdict
     RETURNING *`,
    [projectId, weldUid, lineId, welderId, wpsId,
     process || wps?.process || null, position, weldedAt,
     JSON.stringify(verdict), wps?.pwht_required ?? false, userId]);
  return { execution: rows[0], verdict };
}

export async function recordPwht(db, { projectId, weldUid, reportNo, pwhtAt }) {
  const { rows } = await db.query(
    `UPDATE weld_execution SET pwht_report_no = $1, pwht_at = $2
      WHERE project_id = $3 AND weld_uid = $4 RETURNING *`,
    [reportNo, pwhtAt, projectId, weldUid]);
  if (!rows[0]) throw notFound("weld execution");
  return rows[0];
}

// ── NDT ──────────────────────────────────────────────────────────────────

export async function recordNdt(db, {
  projectId, weldUid, method, result, reportNo = null, defectType = null,
  inspectedAt = null, inspector = null, userId = null,
}) {
  // The cycle is derived, not supplied: a caller that miscounts its own
  // re-shots would corrupt the repair rate, which is the number that decides
  // whether a welder is retested.
  const { rows: [prev] } = await db.query(
    `SELECT COALESCE(MAX(repair_cycle), -1) AS last
       FROM ndt_record WHERE project_id = $1 AND weld_uid = $2 AND method = $3`,
    [projectId, weldUid, method]);
  const cycle = Number(prev.last) + 1;

  const { rows } = await db.query(
    `INSERT INTO ndt_record (
       project_id, weld_uid, method, report_no, result, repair_cycle,
       defect_type, inspected_at, inspector, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [projectId, weldUid, method, reportNo, result, cycle,
     defectType, inspectedAt, inspector, userId]);
  return rows[0];
}

export async function ndtHistory(db, { projectId, weldUid }) {
  const { rows } = await db.query(
    `SELECT * FROM ndt_record WHERE project_id = $1 AND weld_uid = $2
      ORDER BY method, repair_cycle`,
    [projectId, weldUid]);
  return rows;
}

/**
 * Repair rate per welder.
 *
 * Counted on FIRST shots only. Counting every re-shot would punish a welder
 * twice for one defect and reward one whose rejects were never re-tested, and
 * the number is used to decide who gets retested — so it has to mean one
 * thing.
 */
export async function repairRates(db, { projectId, since = null }) {
  const { rows } = await db.query(
    `SELECT w.id AS welder_id, w.stamp_no, w.name,
            COUNT(*) FILTER (WHERE n.repair_cycle = 0) AS shot,
            COUNT(*) FILTER (WHERE n.repair_cycle = 0 AND n.result = 'reject') AS rejected
       FROM weld_execution e
       JOIN welder w ON w.id = e.welder_id
       JOIN ndt_record n ON n.weld_uid = e.weld_uid AND n.project_id = e.project_id
      WHERE e.project_id = $1 AND ($2::date IS NULL OR e.welded_at >= $2::date)
      GROUP BY w.id, w.stamp_no, w.name
      ORDER BY w.stamp_no`,
    [projectId, since]);
  return rows.map((r) => ({
    welderId: r.welder_id,
    stampNo: r.stamp_no,
    name: r.name,
    shot: Number(r.shot),
    rejected: Number(r.rejected),
    repairRate: Number(r.shot) ? Math.round((Number(r.rejected) / Number(r.shot)) * 1000) / 10 : null,
  }));
}

/** Welds with an execution but no NDT record yet — the handover gap, early. */
export async function weldsAwaitingNdt(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT e.weld_uid, e.welded_at, w.stamp_no
       FROM weld_execution e
       JOIN welder w ON w.id = e.welder_id
      WHERE e.project_id = $1
        AND NOT EXISTS (SELECT 1 FROM ndt_record n
                         WHERE n.project_id = e.project_id AND n.weld_uid = e.weld_uid)
      ORDER BY e.welded_at`,
    [projectId]);
  return rows;
}

/**
 * The wall thickness for this weld, from the piping class of its line.
 *
 * Resolved from the line when one is given, otherwise from whichever line the
 * weld's own register row belongs to. Returns null when the class has no row
 * for that size: a thickness nobody wrote down is not a thickness, and the
 * checker is built to say so rather than pick a plausible number.
 */
async function thicknessFromClass(db, { projectId, weldUid, lineId, nps }) {
  const { rows } = await db.query(
    `SELECT COALESCE($3::uuid, w.line_id) AS line_id, COALESCE($4::numeric, w.nps) AS nps
       FROM weld w
      WHERE w.project_id = $1 AND w.weld_uid = $2
      ORDER BY w.created_at DESC LIMIT 1`,
    [projectId, weldUid, lineId, nps]);
  const ctx = rows[0] || (lineId && nps != null ? { line_id: lineId, nps } : null);
  if (!ctx?.line_id || ctx.nps == null) return null;

  const { rows: [hit] } = await db.query(
    `SELECT s.wall_thickness_mm, s.nps
       FROM line l
       JOIN piping_class_size s ON s.piping_class_id = l.piping_class_id
      WHERE l.id = $1 AND l.project_id = $2 AND s.nps = $3`,
    [ctx.line_id, projectId, ctx.nps]);
  return hit ? { wallThicknessMm: Number(hit.wall_thickness_mm), nps: Number(hit.nps) } : null;
}

const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
