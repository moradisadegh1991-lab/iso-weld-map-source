/**
 * Piping execution: a spool's progress through its chain, and its supports.
 *
 * The chain itself is `piping_spool` in lib/platform/precedence.mjs; this
 * reads and writes what happened and hands both to the same engine the
 * equipment chains use. Nothing here decides what precedes what.
 *
 * Call inside `withProject`.
 */
import {
  CHAINS, walk, nextActions, whyNotReady, progress, derivedSteps, DONE, IN_PROGRESS,
} from "../../platform/precedence.mjs";
import { assertStepReleased } from "./inspection.mjs";
import { deriveCoatingFor } from "./coating.mjs";

const CHAIN = CHAINS.piping_spool;
const CODES = new Set(CHAIN.map((s) => s.code));
const DERIVED = new Set(derivedSteps(CHAIN));

/**
 * Record a manual step.
 *
 * Derived steps are refused: shop welding, shop NDT and field welding are
 * answered by the weld register, and a hand-entered "done" beside it would
 * be a second source that can disagree with the first.
 */
export async function recordSpoolActivity(db, {
  projectId, spoolId, code, status = DONE, doneAt = null, refNo = null,
  note = null, contractorId = null, userId = null,
}) {
  if (!CODES.has(code)) throw bad(`مرحلهٔ «${code}» در زنجیرهٔ پایپینگ نیست.`);
  if (DERIVED.has(code)) {
    throw bad(`مرحلهٔ «${code}» از رجیستر جوش خوانده می‌شود و دستی ثبت نمی‌شود.`);
  }
  if (status === DONE && !doneAt) throw bad("یک مرحلهٔ تمام‌شده باید تاریخ داشته باشد.");
  // Paint and insulation are the coating module's once the spool has a
  // coating item: its sign-off answers this step, here and in reporting.
  if (code === "painted" && (await deriveCoatingFor(db, { projectId, spoolId })) !== undefined) {
    throw bad("رنگ و عایق این اسپول در بخش «رنگ و عایق» ثبت و تحویل می‌شود.");
  }

  // The pressure test is the completions module's once the spool's line is
  // in a test package: the package's accepted pass answers this step.
  if (code === "test" && (await deriveTestFor(db, { projectId, spoolId })) !== undefined) {
    throw bad("تست فشار این اسپول از پکیج تست خطش خوانده می‌شود (بخش «تکمیل و MC»).");
  }
  if (status === DONE) await assertStepReleased(db, { projectId, scope: "piping_spool", stepCode: code, itemKind: "spool", itemId: spoolId });

  const { rows } = await db.query(
    `INSERT INTO spool_activity (project_id, spool_id, code, status, done_at, ref_no,
                                 note, contractor_id, recorded_by)
     VALUES ($1,$2,$3,$4::activity_status,$5,$6,$7,$8,$9)
     ON CONFLICT (project_id, spool_id, code) DO UPDATE
        SET status = EXCLUDED.status, done_at = EXCLUDED.done_at,
            ref_no = COALESCE(EXCLUDED.ref_no, spool_activity.ref_no),
            note = COALESCE(EXCLUDED.note, spool_activity.note),
            contractor_id = COALESCE(EXCLUDED.contractor_id, spool_activity.contractor_id),
            recorded_by = EXCLUDED.recorded_by, recorded_at = now()
     RETURNING *`,
    [projectId, spoolId, code, status, doneAt, refNo, note, contractorId, userId]);
  return rows[0];
}

/**
 * The three derived steps, from the weld register.
 *
 * The rule for each, over the welds of the relevant kind on this spool:
 *
 *   all of them done       → done
 *   some of them done      → in progress
 *   none of them done      → not started
 *   none EXIST, but the spool has welds of the other kind → done (nothing to do)
 *   the spool has no welds at all → unknown, no verdict
 *
 * The fourth line is the one that needs defending. A single straight
 * length is a spool with no shop welds; it has genuinely nothing to weld in
 * the shop, and blocking it forever on a step that cannot happen would be a
 * false hold. That is different from the fifth line, where the register
 * itself is missing and nothing may be concluded.
 */
export function deriveFromWelds(welds) {
  if (!welds.length) return { shop_weld: null, shop_ndt: null, field_weld: null };
  const shop = welds.filter((w) => !w.is_field_weld);
  const field = welds.filter((w) => w.is_field_weld);
  // `done` and `started` are separate predicates. For field welding they
  // differ: a weld that is made but not yet examined is work in progress,
  // not work not started — collapsing the two reported a crew mid-way
  // through a spool as idle, which a test caught.
  const state = (list, done, started = done) => {
    if (!list.length) return DONE;
    if (list.every(done)) return DONE;
    return list.some(started) ? IN_PROGRESS : null;
  };
  return {
    shop_weld: state(shop, (w) => w.is_welded),
    shop_ndt: state(shop, (w) => w.is_examined),
    // Field welding counts as DONE only when the weld is made AND examined:
    // the next step is the pressure test, and a joint nobody has examined
    // is not ready to be tested. It has STARTED as soon as one is made.
    field_weld: state(field, (w) => w.is_welded && w.is_examined, (w) => w.is_welded),
  };
}

/**
 * Steps that cannot happen on this spool, so must not be waited for or offered.
 *
 * `fit_up` in this chain is the SHOP fit-up hold point before shop welding.
 * A spool with no shop welds — a single straight length — has nothing to fit
 * up in the shop, so offering it as "next" was noise and waiting on it would
 * be a false hold. Reported as not applicable rather than as done: "done"
 * would claim an inspection that never took place.
 */
export function notApplicable(welds) {
  const out = new Set();
  if (!welds.length) return out;
  if (!welds.some((w) => !w.is_field_weld)) ["fit_up", "shop_weld", "shop_ndt"].forEach((c) => out.add(c));
  if (!welds.some((w) => w.is_field_weld)) out.add("field_weld");
  return out;
}

/**
 * The furthest step actually done, in chain order — the headline a report
 * shows. Not-applicable steps are not progress. reporting.spool_stage makes
 * the same judgement in SQL for reports and the revision diff; a test checks
 * the two agree.
 */
export function headlineStage(steps) {
  const done = steps.filter((s) => s.status === DONE && !s.na);
  return done.length ? done[done.length - 1].code : "planned";
}

export async function spoolStatus(db, { projectId, spoolId }) {
  const { rows: [spool] } = await db.query(
    `SELECT s.id, s.spool_no, s.length_mm, s.nps_max, l.line_no, st.stage, st.built
       FROM spool s LEFT JOIN line l ON l.id = s.line_id
       LEFT JOIN reporting.spool_stage st ON st.spool_key = s.id
      WHERE s.id = $1 AND s.project_id = $2`, [spoolId, projectId]);
  if (!spool) throw notFound("spool");

  const { rows: acts } = await db.query(
    `SELECT code, status, done_at, ref_no FROM spool_activity
      WHERE spool_id = $1 AND project_id = $2`, [spoolId, projectId]);
  const { rows: welds } = await db.query(
    `SELECT is_field_weld, is_welded, is_examined, is_buried
       FROM reporting.fact_weld WHERE spool_key = $1 AND project_key = $2`,
    [spoolId, projectId]);

  const recorded = Object.fromEntries(acts.map((a) => [a.code, a.status]));
  const derived = deriveFromWelds(welds);
  for (const [code, v] of Object.entries(derived)) {
    if (v) recorded[code] = v; else delete recorded[code];
  }
  const na = notApplicable(welds);
  for (const code of na) recorded[code] = DONE;

  // Paint from the coating module, when the spool has a coating item. An
  // uninsulated spool may be painted before its leak test (B31.3
  // §345.3.1), so that is not flagged as out of order; insulation cannot
  // be signed off before the test at all (lib/db/repos/coating.mjs).
  const coat = await deriveCoatingFor(db, { projectId, spoolId });
  const early = new Set();
  if (coat !== undefined) {
    if (coat.value) recorded.painted = coat.value; else delete recorded.painted;
    if (!coat.insulated) early.add("painted");
  }

  // The pressure test from the line's test package, when it has one.
  const pack = await deriveTestFor(db, { projectId, spoolId });
  if (pack !== undefined) {
    if (pack) recorded.test = pack; else delete recorded.test;
  }

  const steps = walk(CHAIN, recorded, { na, early }).map((s) => {
    const a = acts.find((x) => x.code === s.code);
    return { ...s, na: na.has(s.code),
      derived: s.derived || (s.code === "painted" && coat !== undefined) || (s.code === "test" && pack !== undefined),
      doneAt: a?.done_at || null, refNo: a?.ref_no || null };
  });

  const buriedKnown = welds.filter((w) => w.is_buried !== null);
  return {
    spool,
    steps,
    headline: headlineStage(steps),
    next: nextActions(CHAIN, recorded),
    why: whyNotReady(CHAIN, recorded),
    progress: progress(CHAIN, recorded, { na }),
    welds: welds.length,
    // Buried is reported for the spool as a whole only when every weld on it
    // could be classified; a half-known spool is reported as unknown.
    buried: buriedKnown.length !== welds.length || !welds.length
      ? null
      : welds.some((w) => w.is_buried),
  };
}

/**
 * The spool's test step from its line's test package: DONE once the
 * package has an accepted pass, null before that, and `undefined` when the
 * line is in no package — then the step stays a manual record.
 * reporting.spool_stage makes the same judgement in SQL.
 */
export async function deriveTestFor(db, { projectId, spoolId }) {
  const { rows: [r] } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM test_record t WHERE t.package_id = tl.package_id
                      AND t.verdict = 'pass' AND t.accepted_by IS NOT NULL) AS passed
       FROM spool s JOIN test_package_line tl ON tl.line_id = s.line_id AND tl.project_id = s.project_id
      WHERE s.id = $1 AND s.project_id = $2`, [spoolId, projectId]);
  if (!r) return undefined;
  return r.passed ? DONE : null;
}

/**
 * Every spool short of ready, with the step that can start today.
 *
 * One query per spool is acceptable at register sizes — a line carries tens
 * of spools, not thousands. If a project ever lists every spool in the plant
 * on one screen, this becomes a single set-based query first.
 */
export async function spoolBoard(db, { projectId, lineId = null }) {
  const { rows } = await db.query(
    `SELECT s.id FROM spool s
       JOIN reporting.current_run cr ON cr.run_id = s.extraction_run_id
      WHERE s.project_id = $1 AND ($2::uuid IS NULL OR s.line_id = $2::uuid)
      ORDER BY s.spool_no`, [projectId, lineId]);
  const out = [];
  for (const { id } of rows) {
    const s = await spoolStatus(db, { projectId, spoolId: id });
    out.push({
      spoolId: id, spoolNo: s.spool.spool_no, lineNo: s.spool.line_no,
      pct: s.progress.pct, ready: s.why.ready, buried: s.buried, stage: s.headline,
      next: s.next.map(({ code, title }) => ({ code, title })),
      waitingOn: s.why.rootCauses.map(({ code, title }) => ({ code, title })),
      outOfOrder: s.steps.filter((x) => x.outOfOrder).map((x) => x.code),
    });
  }
  return out.sort((a, b) => a.pct - b.pct);
}

// ── supports ─────────────────────────────────────────────────────────────

const KINDS = ["shoe", "guide", "anchor", "line_stop", "spring_hanger",
  "rigid_hanger", "trunnion", "resting", "other"];

export async function upsertSupport(db, {
  projectId, supportNo, kind, lineId = null, spoolId = null, loadKn = null,
  elevationMm = null, drawingRef = null, contractorId = null, note = null,
}) {
  if (!supportNo) throw bad("شمارهٔ ساپورت لازم است.");
  if (!KINDS.includes(kind)) throw bad(`نوع ساپورت «${kind}» شناخته نشد.`);
  // The database says this too; here it says it in Persian.
  if (kind === "spring_hanger" && (loadKn === null || loadKn === "")) {
    throw bad("اسپرینگ هنگر بدون بار قابل تنظیم نیست — بار را وارد کنید.");
  }
  const { rows } = await db.query(
    `INSERT INTO pipe_support (project_id, support_no, kind, line_id, spool_id,
                               load_kn, elevation_mm, drawing_ref, contractor_id, note)
     VALUES ($1,$2,$3::support_kind,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (project_id, support_no) DO UPDATE
        SET kind = EXCLUDED.kind, line_id = EXCLUDED.line_id, spool_id = EXCLUDED.spool_id,
            load_kn = EXCLUDED.load_kn, elevation_mm = EXCLUDED.elevation_mm,
            drawing_ref = COALESCE(EXCLUDED.drawing_ref, pipe_support.drawing_ref),
            contractor_id = COALESCE(EXCLUDED.contractor_id, pipe_support.contractor_id),
            note = COALESCE(EXCLUDED.note, pipe_support.note)
     RETURNING *`,
    [projectId, supportNo, kind, lineId, spoolId, emptyToNull(loadKn),
     emptyToNull(elevationMm), drawingRef, contractorId, note]);
  return rows[0];
}

/**
 * Mark a support installed or inspected.
 *
 * Inspecting a support that was never installed is refused here and by the
 * table. The date is the evidence, so each transition stamps who and when.
 */
export async function markSupport(db, { projectId, supportId, step, on, userId = null }) {
  if (!on) throw bad("تاریخ لازم است.");
  if (step === "installed") {
    const { rows } = await db.query(
      `UPDATE pipe_support SET installed_at = $1, installed_by = $2
        WHERE id = $3 AND project_id = $4 RETURNING *`, [on, userId, supportId, projectId]);
    if (!rows[0]) throw notFound("support");
    return rows[0];
  }
  if (step === "inspected") {
    const { rows: [cur] } = await db.query(
      "SELECT installed_at FROM pipe_support WHERE id = $1 AND project_id = $2",
      [supportId, projectId]);
    if (!cur) throw notFound("support");
    if (!cur.installed_at) throw bad("ساپورتی که نصب نشده بازرسی نمی‌شود.");
    const { rows } = await db.query(
      `UPDATE pipe_support SET inspected_at = $1, inspected_by = $2
        WHERE id = $3 AND project_id = $4 RETURNING *`, [on, userId, supportId, projectId]);
    return rows[0];
  }
  throw bad(`مرحلهٔ «${step}» برای ساپورت شناخته نشد.`);
}

export async function listSupports(db, { projectId, lineId = null }) {
  const { rows } = await db.query(
    `SELECT p.*, l.line_no, s.spool_no FROM pipe_support p
       LEFT JOIN line l ON l.id = p.line_id
       LEFT JOIN spool s ON s.id = p.spool_id
      WHERE p.project_id = $1 AND ($2::uuid IS NULL OR p.line_id = $2::uuid)
      ORDER BY p.support_no`, [projectId, lineId]);
  return rows;
}

export async function buriedExposure(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT * FROM reporting.kpi_buried_exposure WHERE project_key = $1 ORDER BY line_no`,
    [projectId]);
  return rows.map((r) => ({
    lineId: r.line_key, lineNo: r.line_no, welds: Number(r.welds),
    buried: Number(r.buried), aboveGround: Number(r.above_ground), unknown: Number(r.unknown),
    deepestMm: r.deepest_mm === null ? null : Number(r.deepest_mm),
    // The grade that produced the verdict, so a buried count can always be
    // traced to a number. Two values on one line means its welds sit in
    // units with different grades.
    gradeMinMm: r.grade_min_mm === null ? null : Number(r.grade_min_mm),
    gradeMaxMm: r.grade_max_mm === null ? null : Number(r.grade_max_mm),
  }));
}

const emptyToNull = (v) => (v === "" || v === undefined ? null : v);
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
