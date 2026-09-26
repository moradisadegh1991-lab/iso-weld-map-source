/**
 * Instrumentation: the instrument index, each instrument's chain, bench
 * calibrations and loop checks.
 *
 * An instrument hangs off the equipment it serves, and the equipment's own
 * `instrument` step is answered by its instruments. Tag reading and the
 * calibration verdict are lib/instrumentation/isa.mjs.
 *
 * Call inside `withProject`.
 */
import {
  parseInstrumentIndex, parseRange, calibrationRequirement, judgeCalibration, CALIBRATED_HERE,
} from "../../instrumentation/isa.mjs";
import { assertStepReleased } from "./inspection.mjs";
import { matchTag } from "../../electrical/cable.mjs";
import {
  CHAINS, walk, nextActions, whyNotReady, progress, DONE, IN_PROGRESS,
} from "../../platform/precedence.mjs";

const CHAIN = CHAINS.instrument;
/** Every step a loop check needs behind it, on every instrument of the loop. */
const BEFORE_LOOP = ["calibrated", "installed", "hookup", "wired"];

/**
 * Import an instrument index.
 *
 * What a person set survives a re-import: the equipment served, a loop
 * number typed by hand (a derived loop never overwrites a stated one), a
 * range or tolerance the index leaves blank.
 */
export async function importInstrumentIndex(db, { projectId, text }) {
  const parsed = parseInstrumentIndex(text);
  const { rows: tags } = await db.query(
    "SELECT id, tag_no, subsystem_id FROM tag WHERE project_id = $1 AND discipline = 'equipment'", [projectId]);
  const tagNos = tags.map((t) => t.tag_no);
  const byNo = new Map(tags.map((t) => [t.tag_no, t]));
  const unmatched = [];
  for (const r of parsed.rows) {
    const no = matchTag(r.equipment, tagNos);
    const tag = no ? byNo.get(no) : null;
    if (!tag) unmatched.push(r.tagNo);
    await db.query(
      `INSERT INTO instrument (project_id, tag_no, service, type_text, category, variable, loop_no,
                               loop_derived, eq_tag_id, subsystem_id, range_lo, range_hi, range_unit, tolerance_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (project_id, tag_no) DO UPDATE
          SET service = COALESCE(EXCLUDED.service, instrument.service),
              type_text = COALESCE(EXCLUDED.type_text, instrument.type_text),
              category = COALESCE(EXCLUDED.category, instrument.category),
              variable = COALESCE(EXCLUDED.variable, instrument.variable),
              loop_no = CASE WHEN EXCLUDED.loop_derived AND NOT instrument.loop_derived
                             THEN instrument.loop_no ELSE COALESCE(EXCLUDED.loop_no, instrument.loop_no) END,
              loop_derived = CASE WHEN EXCLUDED.loop_derived AND NOT instrument.loop_derived
                             THEN false ELSE EXCLUDED.loop_derived END,
              eq_tag_id = COALESCE(EXCLUDED.eq_tag_id, instrument.eq_tag_id),
              subsystem_id = COALESCE(EXCLUDED.subsystem_id, instrument.subsystem_id),
              range_lo = COALESCE(EXCLUDED.range_lo, instrument.range_lo),
              range_hi = COALESCE(EXCLUDED.range_hi, instrument.range_hi),
              range_unit = COALESCE(EXCLUDED.range_unit, instrument.range_unit),
              tolerance_pct = COALESCE(EXCLUDED.tolerance_pct, instrument.tolerance_pct)`,
      [projectId, r.tagNo, r.service, r.type, r.category, r.variable, r.loopNo, r.loopDerived,
       tag?.id || null, tag?.subsystem_id || null, r.rangeLo, r.rangeHi, r.rangeUnit, r.tolerancePct]);
  }
  return { imported: parsed.rows.length, problems: parsed.problems, unmatched, columns: parsed.columns };
}

/** A person's correction: equipment served, loop, range, tolerance. Only given fields change. */
export async function correctInstrument(db, { projectId, instrumentId, eqTagId, loopNo, range, tolerancePct }) {
  await instrumentRow(db, projectId, instrumentId);
  const sets = [], vals = [];
  const put = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (eqTagId !== undefined) {
    if (eqTagId) {
      const { rows: [t] } = await db.query(
        "SELECT id, subsystem_id FROM tag WHERE id = $1 AND project_id = $2", [eqTagId, projectId]);
      if (!t) throw notFound("tag");
      put("eq_tag_id", t.id); put("subsystem_id", t.subsystem_id);
    } else {
      // The subsystem came from the equipment (as for cables).
      put("eq_tag_id", null); put("subsystem_id", null);
    }
  }
  if (loopNo !== undefined) {
    const v = String(loopNo || "").trim().toUpperCase() || null;
    put("loop_no", v); put("loop_derived", false);
  }
  if (range !== undefined) {
    const r = parseRange(range);
    if (!r) throw bad(`رنج «${range}» خوانده نشد (مثلاً 0-25 bar).`);
    put("range_lo", r.lo); put("range_hi", r.hi); put("range_unit", r.unit);
  }
  if (tolerancePct !== undefined) {
    const v = tolerancePct === "" || tolerancePct === null ? null : Number(tolerancePct);
    if (v !== null && !(v > 0)) throw bad("تلورانس باید عدد مثبت باشد.");
    put("tolerance_pct", v);
  }
  if (!sets.length) return instrumentRow(db, projectId, instrumentId);
  vals.push(instrumentId, projectId);
  const { rows } = await db.query(
    `UPDATE instrument SET ${sets.join(", ")} WHERE id = $${vals.length - 1} AND project_id = $${vals.length}
     RETURNING *`, vals);
  return rows[0];
}

/**
 * One bench calibration. Points as {applied, output} pairs, or text
 * "0:4.01 6.25:8 12.5:12.02 ..." as a technician would type them.
 */
export async function recordCalibration(db, {
  projectId, instrumentId, points, calibratedOn, calibratorRef = null, certificateRef = null, userId = null,
}) {
  const list = Array.isArray(points) ? points
    : String(points || "").trim().split(/[\s,،]+/).filter(Boolean).map((p) => {
      const [applied, output] = p.split(":");
      return { applied: Number(applied), output: Number(output) };
    });
  if (!list.length || list.some((p) => !Number.isFinite(Number(p.applied)) || !Number.isFinite(Number(p.output)))) {
    throw bad("نقاط را به شکل «مقدار اعمالی:خروجی» وارد کنید، مثلاً 0:4.01 6.25:8.00");
  }
  if (!calibratedOn) throw bad("تاریخ کالیبراسیون لازم است.");
  await instrumentRow(db, projectId, instrumentId);
  const { rows } = await db.query(
    `INSERT INTO calibration (project_id, instrument_id, points, calibrated_on, calibrator_ref, certificate_ref, recorded_by)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7) RETURNING *`,
    [projectId, instrumentId, JSON.stringify(list.map((p) => ({ applied: Number(p.applied), output: Number(p.output) }))),
     calibratedOn, calibratorRef, certificateRef, userId]);
  return rows[0];
}

async function instrumentRow(db, projectId, instrumentId) {
  const { rows: [i] } = await db.query(
    `SELECT i.*, t.tag_no AS eq_tag_no, s.code AS subsystem
       FROM instrument i LEFT JOIN tag t ON t.id = i.eq_tag_id LEFT JOIN subsystem s ON s.id = i.subsystem_id
      WHERE i.id = $1 AND i.project_id = $2`, [instrumentId, projectId]);
  if (!i) throw notFound("instrument");
  return i;
}

async function projectTolerance(db, projectId) {
  const { rows: [p] } = await db.query("SELECT calibration_tolerance_pct FROM project WHERE id = $1", [projectId]);
  return p?.calibration_tolerance_pct == null ? null : Number(p.calibration_tolerance_pct);
}

/** Everything known about one instrument's progress. */
export async function instrumentStatus(db, { projectId, instrumentId }) {
  const inst = await instrumentRow(db, projectId, instrumentId);
  const { rows: acts } = await db.query(
    "SELECT code, status, done_at, ref_no FROM instrument_activity WHERE instrument_id = $1 AND project_id = $2",
    [instrumentId, projectId]);
  const { rows: cals } = await db.query(
    `SELECT points, calibrated_on, calibrator_ref, certificate_ref FROM calibration
      WHERE instrument_id = $1 AND project_id = $2 ORDER BY calibrated_on, created_at`, [instrumentId, projectId]);
  const { rows: [loop] } = inst.loop_no ? await db.query(
    "SELECT checked_on, ref_no, witnessed_by FROM loop_check WHERE project_id = $1 AND loop_no = $2",
    [projectId, inst.loop_no]) : { rows: [] };

  const recorded = Object.fromEntries(acts.map((a) => [a.code, a.status]));
  const notes = {};
  const derived = new Set();

  // ── calibration: the points answer it for transmitters and gauges ──
  const req = calibrationRequirement({ category: inst.category, rangeLo: inst.range_lo, rangeHi: inst.range_hi,
    tolerancePct: inst.tolerance_pct }, { tolerancePct: await projectTolerance(db, projectId) });
  let verdict = null;
  if (CALIBRATED_HERE.has(inst.category)) {
    derived.add("calibrated");
    delete recorded.calibrated;
    const latest = cals[cals.length - 1];
    if (latest) {
      verdict = judgeCalibration(latest.points, req);
      if (!verdict.valid) notes.calibrated = { level: req.reason ? "warn" : "bad", text: verdict.reason };
      else if (!verdict.ok) notes.calibrated = { level: "bad", text: `${verdict.reason} — تنظیم و کالیبراسیون مجدد لازم است.` };
      else recorded.calibrated = DONE;
    } else if (req.reason) {
      notes.calibrated = { level: "warn", text: req.reason };
    }
  } else if (!inst.category) {
    notes.calibrated = { level: "warn", text: "تگ با ISA 5.1 خوانده نشد — نوع ابزار معلوم نیست." };
  }

  // ── loop check: one signature per loop ──
  if (inst.loop_no) {
    derived.add("loop_check");
    if (loop) recorded.loop_check = DONE; else delete recorded.loop_check;
  } else {
    notes.loop_check = { level: "warn", text: "شمارهٔ لوپ ندارد — لوپ چک دستی ثبت می‌شود." };
  }

  const steps = walk(CHAIN, recorded).map((s) => {
    const a = acts.find((x) => x.code === s.code);
    return { ...s, derived: derived.has(s.code), note: notes[s.code] || null,
      doneAt: s.code === "loop_check" && loop ? loop.checked_on : a?.done_at || null,
      refNo: s.code === "loop_check" && loop ? loop.ref_no : a?.ref_no || null };
  });
  return {
    instrument: inst, steps,
    next: nextActions(CHAIN, recorded),
    why: whyNotReady(CHAIN, recorded),
    progress: progress(CHAIN, recorded),
    calibration: { requirement: req, verdict,
      history: cals.map((c) => ({ ...c, calibrated_on: iso(c.calibrated_on) })) },
  };
}

/**
 * Record a step on an instrument. Refused: a step the data answers
 * (calibration of a transmitter or gauge, the loop check of an instrument
 * in a loop), and `ready` while anything before it is open.
 */
export async function recordInstrumentActivity(db, {
  projectId, instrumentId, code, doneAt, refNo = null, note = null, contractorId = null, userId = null,
}) {
  const step = CHAIN.find((s) => s.code === code);
  if (!step) throw bad(`مرحلهٔ «${code}» در زنجیرهٔ ابزار نیست.`);
  if (!doneAt) throw bad("تاریخ انجام لازم است.");
  const s = await instrumentStatus(db, { projectId, instrumentId });
  const st = s.steps.find((x) => x.code === code);
  if (st.derived) {
    throw bad(code === "loop_check"
      ? `لوپ چک یک‌بار برای لوپ ${s.instrument.loop_no} امضا می‌شود، نه برای هر ابزار.`
      : `«${step.title}» از نقاط کالیبراسیون خوانده می‌شود و دستی ثبت نمی‌شود.`);
  }
  if (code === "ready" && st.blocked) {
    throw bad(`آماده برای راه‌اندازی ثبت نمی‌شود — باز: ${st.waitingOn.map((w) => w.title).join("، ")}`);
  }
  await assertStepReleased(db, { projectId, scope: "instrument", stepCode: code, itemKind: "instrument", itemId: instrumentId });
  const { rows } = await db.query(
    `INSERT INTO instrument_activity (project_id, instrument_id, code, status, done_at, ref_no, note, contractor_id, recorded_by)
     VALUES ($1,$2,$3,'done',$4,$5,$6,$7,$8)
     ON CONFLICT (project_id, instrument_id, code) DO UPDATE
        SET status = 'done', done_at = EXCLUDED.done_at,
            ref_no = COALESCE(EXCLUDED.ref_no, instrument_activity.ref_no),
            note = COALESCE(EXCLUDED.note, instrument_activity.note),
            recorded_by = EXCLUDED.recorded_by, recorded_at = now()
     RETURNING *`,
    [projectId, instrumentId, code, doneAt, refNo, note, contractorId, userId]);
  return rows[0];
}

/**
 * Sign a loop check.
 *
 * Refused while any instrument in the loop is not calibrated, installed,
 * hooked up and wired: a loop check with a piece missing proves only the
 * pieces that exist, and every instrument of the loop takes its step from
 * this one signature.
 */
export async function recordLoopCheck(db, {
  projectId, loopNo, checkedOn, refNo = null, witnessedBy = null, userId = null,
}) {
  const loop = String(loopNo || "").trim().toUpperCase();
  if (!loop || !checkedOn) throw bad("شمارهٔ لوپ و تاریخ لازم است.");
  const { rows: members } = await db.query(
    "SELECT id, tag_no FROM instrument WHERE project_id = $1 AND loop_no = $2 ORDER BY tag_no", [projectId, loop]);
  if (!members.length) throw notFound("loop");
  const open = [];
  for (const m of members) {
    const s = await instrumentStatus(db, { projectId, instrumentId: m.id });
    const missing = s.steps.filter((x) => BEFORE_LOOP.includes(x.code) && x.status !== DONE).map((x) => x.title);
    if (missing.length) open.push(`${m.tag_no}: ${missing.join("، ")}`);
  }
  if (open.length) throw bad(`لوپ ${loop} هنوز آمادهٔ لوپ چک نیست — ${open.join(" · ")}`);
  const { rows } = await db.query(
    `INSERT INTO loop_check (project_id, loop_no, checked_on, ref_no, witnessed_by, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (project_id, loop_no) DO UPDATE
        SET checked_on = EXCLUDED.checked_on, ref_no = COALESCE(EXCLUDED.ref_no, loop_check.ref_no),
            witnessed_by = COALESCE(EXCLUDED.witnessed_by, loop_check.witnessed_by),
            recorded_by = EXCLUDED.recorded_by
     RETURNING *`, [projectId, loop, checkedOn, refNo, witnessedBy, userId]);
  return rows[0];
}

/** Every instrument, with its stage and calibration verdict, and every loop. */
export async function instrumentBoard(db, { projectId }) {
  const { rows } = await db.query(
    "SELECT id FROM instrument WHERE project_id = $1 ORDER BY loop_no NULLS LAST, tag_no", [projectId]);
  const instruments = [];
  for (const { id } of rows) {
    const s = await instrumentStatus(db, { projectId, instrumentId: id });
    const cal = s.steps.find((x) => x.code === "calibrated");
    const i = s.instrument;
    instruments.push({
      id, tagNo: i.tag_no, service: i.service, category: i.category, loopNo: i.loop_no,
      loopDerived: i.loop_derived, eqTagId: i.eq_tag_id, eqTagNo: i.eq_tag_no, subsystem: i.subsystem,
      range: i.range_lo == null ? null : `${Number(i.range_lo)}–${Number(i.range_hi)} ${i.range_unit || ""}`.trim(),
      tolerancePct: i.tolerance_pct == null ? null : Number(i.tolerance_pct),
      pct: s.progress.pct, ready: s.why.ready,
      next: s.next.map(({ code, title }) => ({ code, title })),
      calibration: { status: cal.status, derived: cal.derived, note: cal.note },
      loopChecked: s.steps.find((x) => x.code === "loop_check").status === DONE,
      readyForLoop: s.steps.filter((x) => BEFORE_LOOP.includes(x.code)).every((x) => x.status === DONE),
      outOfOrder: s.steps.filter((x) => x.outOfOrder).map((x) => x.title),
    });
  }
  const loops = new Map();
  for (const i of instruments.filter((x) => x.loopNo)) {
    if (!loops.has(i.loopNo)) loops.set(i.loopNo, { loopNo: i.loopNo, members: [], checked: i.loopChecked });
    loops.get(i.loopNo).members.push(i.tagNo);
    loops.get(i.loopNo).ready = (loops.get(i.loopNo).ready ?? true) && i.readyForLoop;
  }
  return { instruments, loops: [...loops.values()] };
}

/**
 * A tag's `instrument` step, answered by the instruments serving it.
 * `undefined` when none does (manual); DONE when every one is ready.
 */
export async function deriveTagInstrument(db, { projectId, tagId, loader = null }) {
  const rows = loader ? await loader.instrumentIds(tagId) : (await db.query(
    "SELECT id FROM instrument WHERE eq_tag_id = $1 AND project_id = $2", [tagId, projectId])).rows;
  if (!rows.length) return undefined;
  const states = [];
  for (const { id } of rows) states.push(await instrumentStatus(db, { projectId, instrumentId: id }));
  if (states.every((s) => s.why.ready)) return DONE;
  if (states.some((s) => s.progress.done > 0)) return IN_PROGRESS;
  return null;
}

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
