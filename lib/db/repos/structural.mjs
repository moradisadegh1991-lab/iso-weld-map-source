/**
 * Structural steel: structures, their column survey and their bolting, and
 * the three structure steps those answer.
 *
 * A structure is a tag (discipline 'structural', kind 'structure'), so its
 * chain, subsystem and contractor package come from the spine, and the
 * foundations that carry it answer its first step. Plumbness and bolting are
 * judged in lib/structural/steel.mjs.
 *
 * Call inside `withProject`.
 */
import { upsertTag } from "./spine.mjs";
import {
  surveyVerdict, boltingVerdict, JOINT_TYPES, BOLT_GRADES, STRESS_AREA, METHODS,
} from "../../structural/steel.mjs";
import { STRUCTURE_TYPES, DONE, IN_PROGRESS } from "../../platform/precedence.mjs";

/** Not applicable: the step cannot happen here, so it is neither waited for nor offered. */
export const NA = "na";

/**
 * Register a structure, or update it.
 *
 * `fireproofingRequired` is tri-state on purpose: undefined leaves it as it
 * is, null means "not stated", false means "not required". Collapsing "not
 * stated" into "not required" would drop a fire-protection step from every
 * rack whose spec nobody filled in.
 */
export async function upsertStructure(db, {
  projectId, tagNo, structureType, subsystemId = null, description = null,
  columns = null, boltedJoints = null, fireproofingRequired, tonnageT = null, drawingRef = null,
}) {
  if (!tagNo) throw bad("شمارهٔ سازه لازم است.");
  if (!STRUCTURE_TYPES[structureType]) throw bad(`نوع سازهٔ «${structureType}» شناخته نشد.`);

  const tag = await upsertTag(db, {
    projectId, tagNo, discipline: "structural", kind: "structure", subsystemId, description,
  });
  const fp = fireproofingRequired === undefined ? undefined
    : fireproofingRequired === "" ? null : fireproofingRequired;
  await db.query(
    `INSERT INTO structure_spec (tag_id, project_id, structure_type, columns, bolted_joints,
                                 fireproofing_required, tonnage_t, drawing_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tag_id) DO UPDATE
        SET structure_type = EXCLUDED.structure_type, columns = EXCLUDED.columns,
            bolted_joints = EXCLUDED.bolted_joints,
            fireproofing_required = CASE WHEN $9::boolean THEN structure_spec.fireproofing_required
                                         ELSE EXCLUDED.fireproofing_required END,
            tonnage_t = EXCLUDED.tonnage_t,
            drawing_ref = COALESCE(EXCLUDED.drawing_ref, structure_spec.drawing_ref)`,
    [tag.id, projectId, structureType, positive(columns), positive(boltedJoints),
     fp ?? null, tonnageT === "" ? null : tonnageT, drawingRef, fp === undefined]);
  return tag;
}

async function structureTag(db, projectId, tagId) {
  const { rows: [t] } = await db.query(
    "SELECT id FROM tag WHERE id = $1 AND project_id = $2 AND kind = 'structure'", [tagId, projectId]);
  if (!t) throw notFound("structure");
}

/** One column's survey reading. A re-shoot is a new row, not an edit. */
export async function recordPlumbReading(db, {
  projectId, tagId, columnMark, heightMm, dxMm, dyMm, surveyedOn, surveyor = null, userId = null,
}) {
  if (!columnMark || !surveyedOn) throw bad("علامت ستون و تاریخ نقشه‌برداری لازم است.");
  if (!(Number(heightMm) > 0)) throw bad("ارتفاع ستون بین نقاط کار لازم است.");
  // Both directions, always: a blank would be stored as 0 — perfectly plumb.
  for (const v of [dxMm, dyMm]) {
    if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) {
      throw bad("انحراف در هر دو جهت (شرق و شمال) لازم است.");
    }
  }
  await structureTag(db, projectId, tagId);
  const { rows } = await db.query(
    `INSERT INTO plumb_reading (project_id, tag_id, column_mark, height_mm, dx_mm, dy_mm,
                                surveyed_on, surveyor, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [projectId, tagId, String(columnMark).trim().toUpperCase(), heightMm, dxMm, dyMm,
     surveyedOn, surveyor, userId]);
  return rows[0];
}

/**
 * A batch of joints tightened the same way.
 *
 * Stored even when it fails verification — the joints are in the frame
 * either way, and the failure is the evidence that they must be redone.
 * What the store refuses is a record it cannot even classify.
 */
export async function recordBolting(db, {
  projectId, tagId, jointType, boltGrade, boltSize, method = null, joints,
  verifiedKn = null, lotRef = null, inspectedOn, inspector = null, userId = null,
}) {
  if (!JOINT_TYPES[jointType]) throw bad(`نوع اتصال «${jointType}» شناخته نشد.`);
  if (!BOLT_GRADES[boltGrade]) throw bad(`گرید پیچ «${boltGrade}» شناخته نشد.`);
  if (!STRESS_AREA[boltSize]) throw bad(`سایز پیچ «${boltSize}» شناخته نشد.`);
  if (method && !METHODS[method]) throw bad(`روش «${method}» شناخته نشد.`);
  if (!(Number(joints) > 0)) throw bad("تعداد اتصال لازم است.");
  if (!inspectedOn) throw bad("تاریخ بازرسی لازم است.");
  await structureTag(db, projectId, tagId);
  const { rows } = await db.query(
    `INSERT INTO bolting_record (project_id, tag_id, joint_type, bolt_grade, bolt_size, method,
                                 joints, verified_kn, lot_ref, inspected_on, inspector, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [projectId, tagId, jointType, boltGrade, boltSize, method || null, joints,
     verifiedKn === "" ? null : verifiedKn, lotRef || null, inspectedOn, inspector, userId]);
  return rows[0];
}

/** Everything the engine needs about one structure, oldest first. */
async function load(db, projectId, tagId) {
  const { rows: [spec] } = await db.query(
    "SELECT * FROM structure_spec WHERE tag_id = $1 AND project_id = $2", [tagId, projectId]);
  const { rows: [proj] } = await db.query(
    "SELECT steel_erection_standard FROM project WHERE id = $1", [projectId]);
  const { rows: readings } = await db.query(
    `SELECT column_mark, height_mm, dx_mm, dy_mm, surveyed_on, surveyor FROM plumb_reading
      WHERE tag_id = $1 AND project_id = $2 ORDER BY surveyed_on, created_at`, [tagId, projectId]);
  const { rows: bolts } = await db.query(
    `SELECT id, joint_type, bolt_grade, bolt_size, method, joints, verified_kn, lot_ref,
            inspected_on, inspector FROM bolting_record
      WHERE tag_id = $1 AND project_id = $2 ORDER BY inspected_on, created_at`, [tagId, projectId]);
  return {
    spec,
    standard: proj?.steel_erection_standard || null,
    survey: surveyVerdict(readings.map((r) => ({
      columnMark: r.column_mark, heightMm: Number(r.height_mm), dxMm: Number(r.dx_mm),
      dyMm: Number(r.dy_mm), surveyedOn: iso(r.surveyed_on), surveyor: r.surveyor,
    })), { standard: proj?.steel_erection_standard, columns: spec?.columns }),
    bolting: boltingVerdict(bolts.map((b) => ({
      id: b.id, jointType: b.joint_type, boltGrade: b.bolt_grade, boltSize: b.bolt_size,
      method: b.method, joints: b.joints, verifiedKn: b.verified_kn === null ? null : Number(b.verified_kn),
      lotRef: b.lot_ref, inspectedOn: iso(b.inspected_on), inspector: b.inspector,
    })), { boltedJoints: spec?.bolted_joints }),
    readings: readings.length,
  };
}

/**
 * The three derived steps of one structure.
 *
 * @returns {{steps: {plumb, bolting, fireproofing}, notes, survey, bolting, spec, standard}}
 *   plumb and bolting: DONE, IN_PROGRESS or null. fireproofing: NA when the
 *   spec says it is not required, undefined (a manual step) otherwise.
 */
export async function deriveStructureSteps(db, { projectId, tagId }) {
  const d = await load(db, projectId, tagId);
  const notes = {};
  const note = (code, level, text) => { notes[code] = { level, text }; };

  // ── plumb ──
  let plumb = null;
  const s = d.survey;
  if (!s.judged) {
    if (d.readings) note("plumb", "warn", s.reason);
  } else if (s.surveyed) {
    if (s.out.length || s.invalid.length) {
      note("plumb", "bad", [
        ...s.out.map((c) => `ستون ${c.mark}: ${c.worstMm} mm، مجاز ${c.limitMm} mm`),
        ...s.invalid.map((c) => `ستون ${c.mark}: ${c.reason}`),
      ].join(" · ") + " — اصلاح و نقشه‌برداری مجدد لازم است.");
    } else if (s.complete === null) {
      plumb = IN_PROGRESS;
      note("plumb", "warn", `${s.surveyed} ستون در رواداری — تعداد کل ستون‌ها در مشخصات سازه ثبت نشده.`);
    } else if (!s.complete) {
      plumb = IN_PROGRESS;
      note("plumb", "info", `${s.surveyed} از ${s.expected} ستون نقشه‌برداری و در رواداری.`);
    } else {
      plumb = DONE;
    }
  }

  // ── bolting ──
  let bolting = null;
  const b = d.bolting;
  if (b.failed.length) {
    note("bolting", "bad", b.failed.map((r) => `${r.joints} اتصال ${r.boltGrade} ${r.boltSize}: ${r.reason}`)
      .join(" · "));
  } else if (b.joints > 0) {
    if (b.complete === null) {
      bolting = IN_PROGRESS;
      note("bolting", "warn", `${b.joints} اتصال تأیید شده — تعداد کل اتصالات در مشخصات سازه ثبت نشده.`);
    } else if (!b.complete) {
      bolting = IN_PROGRESS;
      note("bolting", "info", `${b.joints} از ${b.expected} اتصال.`);
    } else {
      bolting = DONE;
    }
  }

  const fireproofing = d.spec?.fireproofing_required === false ? NA : undefined;
  return { steps: { plumb, bolting, fireproofing }, notes, survey: s, bolting: b,
    spec: d.spec || null, standard: d.standard };
}

/** Every structure of a project, with what it carries on and its spec. */
export async function listStructures(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT t.id, t.tag_no, t.description, s.code AS subsystem, ss.structure_type, ss.columns,
            ss.bolted_joints, ss.fireproofing_required, ss.tonnage_t, ss.drawing_ref,
            (SELECT string_agg(f.tag_no, '، ' ORDER BY f.tag_no) FROM tag f
              WHERE f.carries_tag_id = t.id) AS foundations
       FROM tag t
       LEFT JOIN subsystem s ON s.id = t.subsystem_id
       LEFT JOIN structure_spec ss ON ss.tag_id = t.id
      WHERE t.project_id = $1 AND t.kind = 'structure'
      ORDER BY t.tag_no`, [projectId]);
  return rows;
}

const positive = (v) => (v === null || v === undefined || v === "" || !(Number(v) > 0) ? null : Number(v));
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
