/**
 * A tag's progress through its precedence chain.
 *
 * The chain itself is in lib/platform/precedence.mjs; this only reads and
 * writes what was recorded, then hands both to the engine. Nothing here
 * decides what precedes what.
 *
 * Call inside `withProject`.
 */
import {
  chainFor, walk, nextActions, whyNotReady, progress, DONE, IN_PROGRESS,
} from "../../platform/precedence.mjs";

/**
 * Record that a step happened.
 *
 * `done` requires a date — the database enforces it too, because a progress
 * curve cannot be drawn from undated completions and this is the write path
 * a future script would bypass.
 */
export async function recordActivity(db, {
  projectId, tagId, code, status = DONE, doneAt = null, note = null,
  refNo = null, userId = null,
}) {
  if (status === DONE && !doneAt) throw bad("یک فعالیت تمام‌شده باید تاریخ داشته باشد.");
  const { rows } = await db.query(
    `INSERT INTO tag_activity (project_id, tag_id, code, status, done_at, note, ref_no, recorded_by)
     VALUES ($1,$2,$3,$4::activity_status,$5,$6,$7,$8)
     ON CONFLICT (project_id, tag_id, code) DO UPDATE
        SET status = EXCLUDED.status, done_at = EXCLUDED.done_at,
            note = COALESCE(EXCLUDED.note, tag_activity.note),
            ref_no = COALESCE(EXCLUDED.ref_no, tag_activity.ref_no),
            recorded_by = EXCLUDED.recorded_by, recorded_at = now()
     RETURNING *`,
    [projectId, tagId, code, status, doneAt, note, refNo, userId]);
  return rows[0];
}

/**
 * Everything known about one tag's progress.
 *
 * The piping step is NOT read from `tag_activity`. It is derived from the
 * weld register on the lines tagged to this equipment, because that data
 * already exists and asking someone to tick a box the system can answer is
 * exactly the manual entry this platform is meant to remove. A step whose
 * `derive` the engine declares is computed here; everything else is recorded.
 */
export async function tagStatus(db, { projectId, tagId }) {
  const { rows: [tag] } = await db.query(
    "SELECT id, tag_no, kind, discipline, subsystem_id FROM tag WHERE id = $1 AND project_id = $2",
    [tagId, projectId]);
  if (!tag) throw notFound("tag");

  const chain = chainFor(tag.kind);
  // A kind with no chain gets no verdict. Guessing at one would report hold
  // points that do not apply, or omit ones that do.
  if (!chain) {
    return { tag, chain: null,
      reason: `برای نوع «${tag.kind || "نامشخص"}» زنجیرهٔ پیش‌نیاز تعریف نشده است.` };
  }

  const { rows } = await db.query(
    "SELECT code, status, done_at, ref_no FROM tag_activity WHERE tag_id = $1 AND project_id = $2",
    [tagId, projectId]);
  const recorded = Object.fromEntries(rows.map((r) => [r.code, r.status]));

  const derived = await derivePiping(db, { projectId, tagId });
  if (derived) recorded.piping = derived;

  const steps = walk(chain, recorded).map((s) => {
    const rec = rows.find((r) => r.code === s.code);
    return { ...s, doneAt: rec?.done_at || null, refNo: rec?.ref_no || null };
  });

  return {
    tag,
    steps,
    next: nextActions(chain, recorded),
    why: whyNotReady(chain, recorded),
    progress: progress(chain, recorded),
    derivedPiping: derived,
  };
}

/**
 * The piping step, answered from the weld register instead of a checkbox.
 *
 * Returns null when this tag has no lines yet — an unknown is not a "not
 * started", and reporting it as one would make a tag nobody has routed
 * piping to look like a tag whose piping is merely pending.
 */
async function derivePiping(db, { projectId, tagId }) {
  const { rows: [n] } = await db.query(
    `SELECT COUNT(*)::int AS items,
            COUNT(*) FILTER (WHERE p.is_tested)::int   AS tested,
            COUNT(*) FILTER (WHERE p.is_installed)::int AS installed
       FROM reporting.fact_progress p
      WHERE p.project_key = $2 AND p.tag_key = $1`,
    [tagId, projectId]);
  if (!n || n.items === 0) return null;
  if (n.tested === n.items) return DONE;
  if (n.installed > 0) return IN_PROGRESS;
  return null;
}

/**
 * Every tag that is not ready, with the work that can actually start today.
 *
 * Ordered by how close it is to done, worst first: a tag at 10% needs a
 * different conversation from one at 90%.
 */
export async function blockedTags(db, { projectId, subsystemId = null }) {
  const { rows: tags } = await db.query(
    `SELECT id FROM tag
      WHERE project_id = $1 AND ($2::uuid IS NULL OR subsystem_id = $2::uuid)`,
    [projectId, subsystemId]);

  const out = [];
  for (const { id } of tags) {
    const s = await tagStatus(db, { projectId, tagId: id });
    if (!s.chain && !s.steps) continue;              // no chain, no verdict
    if (s.why?.ready) continue;
    out.push({
      tagId: s.tag.id, tagNo: s.tag.tag_no, kind: s.tag.kind,
      pct: s.progress.pct,
      rootCauses: s.why.rootCauses,
      outOfOrder: s.steps.filter((x) => x.outOfOrder).map((x) => x.code),
    });
  }
  return out.sort((a, b) => a.pct - b.pct);
}

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
