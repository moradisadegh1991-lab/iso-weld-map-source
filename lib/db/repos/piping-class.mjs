/**
 * Piping classes: the project's own specification.
 *
 * Two jobs, and the second is easy to miss: it decides how much examination a
 * weld needs, AND it is the authority on wall thickness. The qualification
 * check in EPIC-3 has been reporting thickness as unverifiable because a
 * schedule label on its own never told anyone a number — this is where the
 * number comes from.
 *
 * Call inside `withProject`.
 */
import { ndtRequirement } from "../../ndt/requirement.mjs";
import { selectSample, coverage } from "../../ndt/sampling.mjs";
import { isRadiographable } from "../../ndt/b31-3.mjs";

export async function upsertPipingClass(db, {
  projectId, code, description = null, serviceCategory,
  materialSpec = null, corrosionAllowMm = null, designTempC = null,
  designPressBarg = null, pwhtAboveMm = null, ndtRules = [], notes = null,
}) {
  const { rows } = await db.query(
    `INSERT INTO piping_class (
       project_id, code, description, service_category, material_spec,
       corrosion_allow_mm, design_temp_c, design_press_barg, pwht_above_mm, ndt_rules, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (project_id, code) DO UPDATE SET
       description = EXCLUDED.description, service_category = EXCLUDED.service_category,
       material_spec = EXCLUDED.material_spec, corrosion_allow_mm = EXCLUDED.corrosion_allow_mm,
       design_temp_c = EXCLUDED.design_temp_c, design_press_barg = EXCLUDED.design_press_barg,
       pwht_above_mm = EXCLUDED.pwht_above_mm, ndt_rules = EXCLUDED.ndt_rules,
       notes = EXCLUDED.notes
     RETURNING *`,
    [projectId, code, description, serviceCategory, materialSpec, corrosionAllowMm,
     designTempC, designPressBarg, pwhtAboveMm, JSON.stringify(ndtRules), notes]);
  return rows[0];
}

/** The size table off the class spec sheet, replaced wholesale. */
export async function setClassSizes(db, { projectId, pipingClassId, sizes }) {
  return db.transaction(async (tx) => {
    await tx.query("DELETE FROM piping_class_size WHERE piping_class_id = $1 AND project_id = $2",
      [pipingClassId, projectId]);
    for (const s of sizes) {
      await tx.query(
        `INSERT INTO piping_class_size (project_id, piping_class_id, nps, schedule, wall_thickness_mm, od_mm)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [projectId, pipingClassId, s.nps, s.schedule ?? null, s.wallThicknessMm, s.odMm ?? null]);
    }
    return sizes.length;
  });
}

export async function getPipingClass(db, { projectId, code }) {
  const { rows } = await db.query(
    "SELECT * FROM piping_class WHERE project_id = $1 AND code = $2", [projectId, code]);
  return rows[0] || null;
}

/**
 * Wall thickness for a size in a class.
 *
 * Returns null rather than interpolating. A thickness nobody wrote down is
 * not a thickness, and the qualification check is built to say so.
 */
export async function wallThickness(db, { projectId, pipingClassId, nps }) {
  const { rows } = await db.query(
    `SELECT wall_thickness_mm, schedule, od_mm FROM piping_class_size
      WHERE project_id = $1 AND piping_class_id = $2 AND nps = $3`,
    [projectId, pipingClassId, nps]);
  return rows[0] ? {
    wallThicknessMm: Number(rows[0].wall_thickness_mm),
    schedule: rows[0].schedule,
    odMm: rows[0].od_mm == null ? null : Number(rows[0].od_mm),
  } : null;
}

/** Every size in the class, as one lookup the caller can reuse per weld. */
export async function sizeTable(db, { projectId, pipingClassId }) {
  const { rows } = await db.query(
    `SELECT nps, schedule, wall_thickness_mm, od_mm FROM piping_class_size
      WHERE project_id = $1 AND piping_class_id = $2 ORDER BY nps`,
    [projectId, pipingClassId]);
  return new Map(rows.map((r) => [Number(r.nps), {
    wallThicknessMm: Number(r.wall_thickness_mm),
    schedule: r.schedule,
    odMm: r.od_mm == null ? null : Number(r.od_mm),
  }]));
}

/**
 * Resolve the governing examination requirement for every weld of a run, and
 * write it back onto the weld rows.
 *
 * The engine stamps a provisional value when it builds the register; this is
 * the authoritative pass, and it runs once a class is known.
 */
export async function applyNdtRequirements(db, { projectId, runId, pipingClass }) {
  const { rows } = await db.query(
    `SELECT w.id, w.weld_uid, w.weld_no, w.weld_kind, w.shop_field, w.nps
       FROM weld w WHERE w.extraction_run_id = $1 AND w.project_id = $2`,
    [runId, projectId]);

  const deviations = [], applied = [];
  await db.transaction(async (tx) => {
    for (const r of rows) {
      const req = ndtRequirement(
        { kind: r.weld_kind, loc: r.shop_field, nps: r.nps }, pipingClass);
      const text = req.method
        ? `${req.method} ${req.percent}%${req.randomSample ? " random" : ""}`
        : "تعیین‌نشده";
      await tx.query("UPDATE weld SET ndt_requirement = $1 WHERE id = $2 AND project_id = $3",
        [text, r.id, projectId]);
      applied.push({ weldNo: r.weld_no, weldUid: r.weld_uid, requirement: text,
                     source: req.source, clause: req.clause });
      for (const d of req.deviations) deviations.push({ weldNo: r.weld_no, ...d });
    }
  });
  return { applied, deviations };
}

/**
 * Draw the radiographic sample for a line and record it with its seed.
 *
 * The population is the welds the requirement actually applies to, with the
 * welder who made each one — the coverage clause cannot be satisfied without
 * knowing that.
 */
export async function drawNdtSample(db, {
  projectId, runId, lineId = null, pipingClass, seed, userId = null,
}) {
  const { rows } = await db.query(
    `SELECT w.weld_uid, w.weld_no, w.weld_kind, w.shop_field, w.nps,
            e.welder_id, wl.stamp_no
       FROM weld w
       LEFT JOIN weld_execution e
              ON e.weld_uid = w.weld_uid AND e.project_id = w.project_id
       LEFT JOIN welder wl ON wl.id = e.welder_id
      WHERE w.extraction_run_id = $1 AND w.project_id = $2
      ORDER BY w.weld_no`,
    [runId, projectId]);

  // One requirement governs the sample, so take it from the first weld the
  // percentage actually applies to; mixed rules within a line are reported.
  const eligible = [], requirements = new Set();
  for (const r of rows) {
    const weld = { kind: r.weld_kind, loc: r.shop_field, nps: r.nps };
    const req = ndtRequirement(weld, pipingClass);
    if (!req.randomSample || !isRadiographable(weld)) continue;
    requirements.add(`${req.method}|${req.percent}`);
    eligible.push({ weldUid: r.weld_uid, weldNo: r.weld_no,
                    welderId: r.welder_id, stampNo: r.stamp_no });
  }

  if (!eligible.length) {
    return { selection: null, reason: "NO_RANDOM_SAMPLE_REQUIRED", eligible: 0 };
  }
  const [method, percentText] = [...requirements][0].split("|");
  const percent = Number(percentText);

  const result = selectSample(eligible, percent, { seed: seed || `${lineId || runId}` });

  const { rows: [saved] } = await db.query(
    `INSERT INTO ndt_selection (
       project_id, line_id, extraction_run_id, method, percent, seed, selected_uids, rationale, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [projectId, lineId, runId, method, percent, result.seed,
     result.selected.map((w) => w.weldUid),
     JSON.stringify({
       required: result.required, total: result.total, rate: result.rate,
       coverageAdded: result.coverageAdded.map((w) => w.weldNo),
       unassigned: result.unassigned.map((w) => w.weldNo),
       mixedRequirements: requirements.size > 1 ? [...requirements] : undefined,
     }), userId]);

  return { selection: saved, result, method, percent };
}

/** How much of a drawn sample has actually been shot. */
export async function ndtCoverage(db, { projectId, selectionId }) {
  const { rows: [sel] } = await db.query(
    "SELECT * FROM ndt_selection WHERE id = $1 AND project_id = $2", [selectionId, projectId]);
  if (!sel) throw Object.assign(new Error("ndt selection not found"), { status: 404 });

  const { rows: required } = await db.query(
    `SELECT w.weld_uid, w.weld_no, wl.stamp_no, e.welder_id
       FROM weld w
       LEFT JOIN weld_execution e ON e.weld_uid = w.weld_uid AND e.project_id = w.project_id
       LEFT JOIN welder wl ON wl.id = e.welder_id
      WHERE w.project_id = $1 AND w.weld_uid = ANY($2)`,
    [projectId, sel.selected_uids]);

  const { rows: records } = await db.query(
    `SELECT weld_uid, result, repair_cycle FROM ndt_record
      WHERE project_id = $1 AND weld_uid = ANY($2) AND method = $3`,
    [projectId, sel.selected_uids, sel.method]);

  return {
    selection: sel,
    ...coverage({
      required: required.map((r) => ({ weldUid: r.weld_uid, weldNo: r.weld_no,
                                       stampNo: r.stamp_no, welderId: r.welder_id })),
      records,
    }),
  };
}
