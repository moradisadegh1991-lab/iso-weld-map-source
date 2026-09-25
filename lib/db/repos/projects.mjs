/**
 * Projects, units and membership — the directory a user consults before a
 * project scope exists. These tables sit outside project-scoped RLS for that
 * reason, so access is filtered by USER here instead. Every function that
 * reads them takes a user id and joins membership; none of them accepts a
 * bare project id and trusts it.
 */
import { ERECTION_STANDARDS } from "../../structural/steel.mjs";

export async function ensureUser(db, { subject, email = null, displayName = null }) {
  const { rows } = await db.query(
    `INSERT INTO app_user (subject, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (subject) DO UPDATE
       SET email = COALESCE(EXCLUDED.email, app_user.email),
           display_name = COALESCE(EXCLUDED.display_name, app_user.display_name)
     RETURNING id, subject, email, display_name`,
    [subject, email, displayName]);
  return rows[0];
}

export async function createProject(db, { code, name, ownerUserId }) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query(
      "INSERT INTO project (code, name) VALUES ($1, $2) RETURNING id, code, name",
      [code, name]);
    const project = rows[0];
    if (ownerUserId) {
      await tx.query(
        "INSERT INTO project_member (project_id, user_id, role) VALUES ($1, $2, 'admin')",
        [project.id, ownerUserId]);
    }
    return project;
  });
}

export async function addMember(db, { projectId, userId, role }) {
  const { rows } = await db.query(
    `INSERT INTO project_member (project_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING project_id, user_id, role`,
    [projectId, userId, role]);
  return rows[0];
}

/** What this user may see. Never call it with a project id from a request. */
export async function listProjectsForUser(db, userId) {
  const { rows } = await db.query(
    `SELECT p.id, p.code, p.name, m.role
       FROM project p
       JOIN project_member m ON m.project_id = p.id
      WHERE m.user_id = $1
      ORDER BY p.code`,
    [userId]);
  return rows;
}

/**
 * The membership check every request must pass before a project scope is
 * opened. Returns null when the user has no standing in the project, which
 * callers must treat as "this project does not exist" rather than "forbidden"
 * — the difference leaks whether a project code is in use.
 */
export async function membershipOf(db, { projectId, userId }) {
  const { rows } = await db.query(
    "SELECT project_id, user_id, role FROM project_member WHERE project_id = $1 AND user_id = $2",
    [projectId, userId]);
  return rows[0] || null;
}

export async function createUnit(db, { projectId, code, name = null, gradeElevationMm }) {
  // `gradeElevationMm` undefined leaves an existing override alone; null or
  // "" clears it back to the project grade. The two are different requests.
  const setGrade = gradeElevationMm !== undefined;
  const grade = gradeElevationMm === "" ? null : gradeElevationMm ?? null;
  const { rows } = await db.query(
    `INSERT INTO unit (project_id, code, name, grade_elevation_mm) VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, code) DO UPDATE
        SET name = COALESCE(EXCLUDED.name, unit.name),
            grade_elevation_mm = CASE WHEN $5 THEN EXCLUDED.grade_elevation_mm
                                      ELSE unit.grade_elevation_mm END
     RETURNING id, project_id, code, name, grade_elevation_mm`,
    [projectId, code, name, grade, setGrade]);
  return rows[0];
}

export async function listUnits(db, { projectId }) {
  const { rows } = await db.query(
    "SELECT id, code, name, grade_elevation_mm FROM unit WHERE project_id = $1 ORDER BY code",
    [projectId]);
  return rows;
}

/**
 * A unit by the code printed on a drawing, or null.
 *
 * Lookup only — never creates. The code comes from the model reading the
 * title block; creating a unit from it would let one misread digit invent a
 * unit, with its own grade, that nobody declared.
 */
export async function unitByCode(db, { projectId, code }) {
  if (!code) return null;
  const { rows } = await db.query(
    "SELECT id, code, name, grade_elevation_mm FROM unit WHERE project_id = $1 AND code = $2",
    [projectId, String(code).trim()]);
  return rows[0] || null;
}

/**
 * The project's own particulars.
 *
 * Every field is optional because a project exists before its contract is
 * signed, and a form that refuses to save until everything is known is a
 * form people keep in Excel instead. `updated_at` is stamped here rather
 * than by a trigger so the "never edited" case stays distinguishable from
 * "edited at creation".
 */
const PROFILE_FIELDS = [
  "name", "client_name", "consultant_name", "contractor_name", "contract_no",
  "contract_date", "contract_value", "contract_currency", "site_location",
  "start_date", "planned_end_date", "description",
  // Siting (migration 011). Grade elevation is what decides buried versus
  // above ground, so it is the one of these that changes engineering output.
  "origin_latitude", "origin_longitude", "grid_origin_e_mm", "grid_origin_n_mm",
  "plant_north_deg", "elevation_datum", "grade_elevation_mm", "min_cover_mm",
  // Concrete spec (migration 013). Curing days decides when the curing step
  // of every foundation completes, so it changes engineering output too.
  "concrete_curing_days", "concrete_sample_per_m3",
  // Steel erection standard (migration 014): decides the plumbness tolerance
  // every column survey is judged against.
  "steel_erection_standard",
  // Electrical spec (migration 015): the LV circuit voltage picks the
  // IEC 60364-6 test voltage and limit; MV acceptance is the project's own.
  "lv_system_voltage_v", "mv_ir_test_voltage_v", "mv_ir_min_mohm",
  // Instrument calibration tolerance, % of span (migration 016), when the
  // instrument's own datasheet does not give one.
  "calibration_tolerance_pct",
  // Coating application limits (migration 017): the dew-point margin when
  // the spec differs from 3 °C, and an RH limit, which has no default.
  "coating_dewpoint_margin_c", "coating_max_rh_pct",
  // HSE (migration 020): gas-test limits, gas-test validity and the longest
  // permit. None has a default; a hot-work permit is not issued without them.
  "hse_o2_min_pct", "hse_o2_max_pct", "hse_lel_max_pct", "hse_h2s_max_ppm", "hse_co_max_ppm",
  "hse_gas_test_validity_min", "hse_permit_max_hours",
  // Quality (migration 022): how long an NCR may be overdue before it goes
  // to the project manager. No default.
  "ncr_escalation_days",
  // Procurement (migration 025): the contract's resubmission period for a
  // vendor document returned code 3. No default.
  "vdrl_resubmit_days",
  // Handover to maintenance (migration 027): the CMMS plant code, the
  // functional-location template and the criticality levels. No defaults.
  "cmms_plant_code", "floc_template", "criticality_levels",
];

export async function getProjectProfile(db, { projectId }) {
  const { rows } = await db.query("SELECT * FROM project WHERE id = $1", [projectId]);
  if (!rows[0]) throw Object.assign(new Error("project not found"), { status: 404 });
  return rows[0];
}

export async function updateProjectProfile(db, { projectId, patch = {} }) {
  const std = patch.steel_erection_standard;
  if (std && !ERECTION_STANDARDS[std]) {
    throw Object.assign(new Error(`استاندارد نصب «${std}» شناخته نشد.`),
      { status: 400, code: "INVALID_INPUT" });
  }
  const sets = [];
  const vals = [];
  for (const f of PROFILE_FIELDS) {
    if (!(f in patch)) continue;
    // "" from an empty form field means "cleared", not the empty string: a
    // contract number of "" would print as a blank that looks recorded.
    const v = patch[f] === "" ? null : patch[f];
    vals.push(v);
    sets.push(`${f} = $${vals.length}`);
  }
  if (!sets.length) return getProjectProfile(db, { projectId });

  vals.push(projectId);
  const { rows } = await db.query(
    `UPDATE project SET ${sets.join(", ")}, updated_at = now()
      WHERE id = $${vals.length} RETURNING *`, vals);
  return rows[0];
}
