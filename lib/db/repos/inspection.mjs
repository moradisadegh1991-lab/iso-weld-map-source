/**
 * Inspection: ITP revisions, inspection requests and their results, and the
 * gate every chain's step-recording path asks before recording a step.
 *
 * Every rule is lib/inspection/itp.mjs; this reads and writes.
 * Call inside `withProject`.
 */
import {
  SCOPES, PARTIES, OUTCOMES, gates, itpProblems, activityProblems, irState, resultProblems, resultParty, stepGate,
  materialScopeOf,
} from "../../inspection/itp.mjs";
import { INSPECTABLE } from "../../platform/precedence.mjs";

// ── ITP ──────────────────────────────────────────────────────────────────

const activityOut = (a) => ({
  id: a.id, itpId: a.itp_id, seq: a.seq, title: a.title, stepCode: a.step_code, reference: a.reference,
  criteria: a.criteria, record: a.record, points: { contractor: a.contractor, company: a.company, tpi: a.tpi },
  itpNo: a.itp_no, revision: a.revision, scope: a.scope,
});

/** A new ITP, or a new revision of one — as a draft, with the last revision's activities to edit. */
export async function createItp(db, { projectId, itpNo, revision, title, scope, userId = null }) {
  if (!String(itpNo || "").trim() || !String(revision || "").trim()) throw bad("شمارهٔ ITP و رویژن لازم است.");
  if (!SCOPES[scope]) throw bad(`نوع کار «${scope}» شناخته نشد.`);
  const { rows: [prev] } = await db.query(
    `SELECT * FROM itp WHERE project_id = $1 AND itp_no = $2 ORDER BY created_at DESC LIMIT 1`, [projectId, itpNo.trim()]);
  if (prev && prev.scope !== scope) throw bad(`ITP ${itpNo} برای «${SCOPES[prev.scope].title}» است؛ نوع کار در رویژن جدید عوض نمی‌شود.`);
  if (prev?.status === "draft") throw bad(`رویژن ${prev.revision} این ITP هنوز پیش‌نویس است؛ همان را کامل کنید.`);
  const { rows: [itp] } = await db.query(
    `INSERT INTO itp (project_id, itp_no, revision, title, scope, prepared_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [projectId, itpNo.trim(), revision.trim(), String(title || prev?.title || "").trim() || itpNo.trim(), scope, userId]);
  if (prev) {
    await db.query(
      `INSERT INTO itp_activity (project_id, itp_id, seq, title, step_code, reference, criteria, record, contractor, company, tpi)
       SELECT project_id, $2, seq, title, step_code, reference, criteria, record, contractor, company, tpi
         FROM itp_activity WHERE itp_id = $1`, [prev.id, itp.id]);
  }
  return itp;
}

/** Add or change one activity of a draft. */
export async function saveActivity(db, { projectId, itpId, id = null, seq, title, stepCode = null, reference = null,
  criteria = null, record = null, points = {} }) {
  const itp = await itpRow(db, projectId, itpId);
  if (itp.status !== "draft") throw bad("این رویژن تأیید شده و ثابت است؛ برای تغییر رویژن جدید بسازید.");
  const a = { seq: Number(seq), title, stepCode: stepCode || null, points: clean(points) };
  const problems = activityProblems(a, INSPECTABLE[itp.scope]);
  if (problems.length) throw bad(problems.join(" · "));
  const vals = [a.seq, String(title).trim(), a.stepCode, reference || null, criteria || null, record || null,
    a.points.contractor || null, a.points.company || null, a.points.tpi || null];
  const { rows: [row] } = id
    ? await db.query(
      `UPDATE itp_activity SET seq=$1, title=$2, step_code=$3, reference=$4, criteria=$5, record=$6, contractor=$7, company=$8, tpi=$9
        WHERE id = $10 AND itp_id = $11 RETURNING *`, [...vals, id, itpId])
    : await db.query(
      `INSERT INTO itp_activity (seq, title, step_code, reference, criteria, record, contractor, company, tpi, project_id, itp_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [...vals, projectId, itpId]);
  if (!row) throw notFound("activity");
  return row;
}

export async function removeActivity(db, { projectId, itpId, id }) {
  const itp = await itpRow(db, projectId, itpId);
  if (itp.status !== "draft") throw bad("این رویژن تأیید شده و ثابت است.");
  await db.query("DELETE FROM itp_activity WHERE id = $1 AND itp_id = $2", [id, itpId]);
}

/**
 * Approve a draft. The revision in force before it is superseded in the
 * same transaction — two revisions are never in force at once. Requests
 * already raised against the old revision keep it: they were made against
 * what was in force when they were made.
 */
export async function approveItp(db, { projectId, itpId, userId, onDate = today() }) {
  const itp = await itpRow(db, projectId, itpId);
  if (itp.status !== "draft") throw bad("فقط پیش‌نویس تأیید می‌شود.");
  const { rows } = await db.query("SELECT * FROM itp_activity WHERE itp_id = $1 ORDER BY seq", [itpId]);
  const problems = itpProblems({ activities: rows.map(activityOut), preparedBy: itp.prepared_by },
    { approverId: userId, chain: INSPECTABLE[itp.scope] });
  if (problems.length) throw bad(problems.join(" · "));
  await db.query(`UPDATE itp SET status = 'superseded', superseded_on = $3
                   WHERE project_id = $1 AND itp_no = $2 AND status = 'approved'`, [projectId, itp.itp_no, onDate]);
  const { rows: [row] } = await db.query(
    "UPDATE itp SET status = 'approved', approved_by = $2, approved_on = $3 WHERE id = $1 RETURNING *", [itpId, userId, onDate]);
  return row;
}

/** Every ITP revision, newest first within each number, with its activities. */
export async function listItps(db, { projectId }) {
  const { rows: itps } = await db.query(
    `SELECT i.*, pu.display_name AS prepared_by_name, au.display_name AS approved_by_name
       FROM itp i LEFT JOIN app_user pu ON pu.id = i.prepared_by LEFT JOIN app_user au ON au.id = i.approved_by
      WHERE i.project_id = $1 ORDER BY i.itp_no, i.created_at DESC`, [projectId]);
  const { rows: acts } = await db.query(
    "SELECT * FROM itp_activity WHERE project_id = $1 ORDER BY seq", [projectId]);
  return itps.map((i) => ({ ...i, scopeTitle: SCOPES[i.scope].title,
    activities: acts.filter((a) => a.itp_id === i.id).map(activityOut) }));
}

/** The approved activities for a kind of work (optionally one chain step). */
export async function approvedActivities(db, { projectId, scope, stepCode = undefined }) {
  const { rows } = await db.query(
    `SELECT a.*, i.itp_no, i.revision, i.scope FROM itp_activity a JOIN itp i ON i.id = a.itp_id
      WHERE a.project_id = $1 AND i.status = 'approved' AND i.scope = $2
        AND ($3::text IS NULL OR a.step_code = $3) ORDER BY i.itp_no, a.seq`,
    [projectId, scope, stepCode === undefined ? null : stepCode]);
  return rows.map(activityOut);
}

// ── the item inspected ───────────────────────────────────────────────────

/**
 * An item, checked against the kind of work: its label, its subsystem, and
 * the ITP scope it falls under. A pump is not inspected against a
 * foundation's ITP.
 */
export async function resolveItem(db, { projectId, itemKind, itemId }) {
  const q = {
    tag: `SELECT t.id, t.tag_no AS label, t.subsystem_id, t.kind AS scope FROM tag t WHERE t.id = $1 AND t.project_id = $2`,
    spool: `SELECT sp.id, sp.spool_no AS label, l.subsystem_id, 'piping_spool' AS scope FROM spool sp
              LEFT JOIN line l ON l.id = sp.line_id WHERE sp.id = $1 AND sp.project_id = $2`,
    cable: `SELECT c.id, c.cable_no AS label, c.subsystem_id, 'cable' AS scope FROM cable c WHERE c.id = $1 AND c.project_id = $2`,
    instrument: `SELECT i.id, i.tag_no AS label, i.subsystem_id, 'instrument' AS scope FROM instrument i WHERE i.id = $1 AND i.project_id = $2`,
    coating_item: `SELECT ci.id, COALESCE(sp.spool_no, t.tag_no) || ' (رنگ)' AS label, COALESCE(l.subsystem_id, t.subsystem_id) AS subsystem_id,
                     'coating' AS scope FROM coating_item ci LEFT JOIN spool sp ON sp.id = ci.spool_id LEFT JOIN line l ON l.id = sp.line_id
                     LEFT JOIN tag t ON t.id = ci.tag_id WHERE ci.id = $1 AND ci.project_id = $2`,
    lot: `SELECT l.id, ${LOT_LABEL} AS label, NULL::uuid AS subsystem_id, mi.category
            FROM material_lot l JOIN material_item mi ON mi.id = l.item_id WHERE l.id = $1 AND l.project_id = $2`,
  }[itemKind];
  if (!q) throw bad(`نوع آیتم «${itemKind}» شناخته نشد.`);
  if (!UUID.test(String(itemId || ""))) throw notFound("item");
  const { rows: [row] } = await db.query(q, [itemId, projectId]);
  if (!row) throw notFound("item");
  // A lot's kind of work is its item's category, not one flat "material" — a
  // PMI hold written for pipe must not stop a cable delivery (lib/inspection/itp.mjs).
  if (itemKind === "lot") row.scope = materialScopeOf(row.category);
  return row;
}

/** Items a kind of work applies to, for choosing one on a form. */
export async function itemsForScope(db, { projectId, scope }) {
  const item = SCOPES[scope]?.item;
  if (!item) throw bad(`نوع کار «${scope}» شناخته نشد.`);
  const q = {
    tag: ["SELECT id, tag_no AS label FROM tag WHERE project_id = $1 AND kind = $2 ORDER BY tag_no", [projectId, scope]],
    spool: ["SELECT id, spool_no AS label FROM spool WHERE project_id = $1 ORDER BY spool_no", [projectId]],
    cable: ["SELECT id, cable_no AS label FROM cable WHERE project_id = $1 ORDER BY cable_no", [projectId]],
    instrument: ["SELECT id, tag_no AS label FROM instrument WHERE project_id = $1 ORDER BY tag_no", [projectId]],
    coating_item: [`SELECT ci.id, COALESCE(sp.spool_no, t.tag_no) AS label FROM coating_item ci
                     LEFT JOIN spool sp ON sp.id = ci.spool_id LEFT JOIN tag t ON t.id = ci.tag_id
                    WHERE ci.project_id = $1 ORDER BY 2`, [projectId]],
    lot: [`SELECT l.id, ${LOT_LABEL} AS label, mi.category FROM material_lot l JOIN material_item mi ON mi.id = l.item_id
            WHERE l.project_id = $1 ORDER BY l.received_on DESC, l.receipt_no`, [projectId]],
  }[item];
  const { rows } = await db.query(q[0], q[1]);
  // Three ITP scopes share item "lot"; a lot is offered under the one its own category falls under.
  const mine = item === "lot" ? rows.filter((r) => materialScopeOf(r.category) === scope) : rows;
  return mine.map((r) => ({ ...r, kind: item }));
}

// ── requests ─────────────────────────────────────────────────────────────

/**
 * Raise a request: item X is ready for activity Y, at time T.
 *
 * Raised by the contractor's side, against an approved activity, for an
 * item of the activity's kind of work. Refused when the item already has
 * one awaiting for that activity (two appointments for one inspection) or
 * one released (there is nothing left to request). A re-inspection names
 * the rejected request it follows.
 */
export async function raiseIr(db, { projectId, activityId, itemKind, itemId, plannedAt, location = null, note = null,
  reinspectionOf = null, membership = null, userId = null, now = new Date() }) {
  if (membership?.inspection_party !== "contractor") {
    throw bad("درخواست بازرسی را طرف پیمانکار ثبت می‌کند (طرف بازرسی شما در عضویت پروژه تعیین نشده یا پیمانکار نیست).");
  }
  const { rows: [a] } = await db.query(
    `SELECT a.*, i.itp_no, i.revision, i.scope, i.status AS itp_status FROM itp_activity a JOIN itp i ON i.id = a.itp_id
      WHERE a.id = $1 AND a.project_id = $2`, [activityId, projectId]);
  if (!a) throw notFound("activity");
  if (a.itp_status !== "approved") throw bad(`ITP ${a.itp_no} رویژن ${a.revision} در حال اجرا نیست (${a.itp_status === "draft" ? "پیش‌نویس" : "منسوخ"}).`);
  const item = await resolveItem(db, { projectId, itemKind, itemId });
  if (item.scope !== a.scope) throw bad(`«${item.label}» از نوع «${SCOPES[item.scope]?.title || item.scope}» است، نه «${SCOPES[a.scope].title}».`);
  const planned = new Date(plannedAt);
  if (!Number.isFinite(planned.getTime())) throw bad("زمان بازرسی معتبر نیست.");
  if (planned < now) throw bad("زمان بازرسی در گذشته است؛ درخواست برای بازرسی آینده ثبت می‌شود.");

  const prior = (await requestsFor(db, { projectId, itemKind, itemId })).filter((r) => sameActivity(r, a));
  const live = prior.find((r) => r.state.state === "awaiting");
  if (live) throw bad(`برای این آیتم و این فعالیت درخواست ${live.ir_no} هنوز منتظر نتیجه است.`);
  const done = prior.find((r) => r.state.state === "released");
  if (done) throw bad(`این فعالیت برای «${item.label}» با ${done.ir_no} آزاد شده است.`);
  if (reinspectionOf) {
    const r = prior.find((x) => x.id === reinspectionOf);
    if (!r || r.state.state !== "rejected") throw bad("بازرسی دوباره فقط پس از درخواست ردشدهٔ همین آیتم و همین فعالیت ثبت می‌شود.");
  } else if (prior.some((x) => x.state.state === "rejected")) {
    throw bad("آخرین بازرسی این آیتم رد شده؛ درخواست جدید را به‌عنوان بازرسی دوباره ثبت کنید.");
  }
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM inspection_request WHERE project_id = $1", [projectId]);
  const { rows: [ir] } = await db.query(
    `INSERT INTO inspection_request (project_id, ir_no, activity_id, item_kind, item_id, subsystem_id, location, note,
                                     planned_at, raised_at, raised_by, reinspection_of)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [projectId, `IR-${String(n + 1).padStart(5, "0")}`, activityId, itemKind, itemId, item.subsystem_id, location || null,
     note || null, planned.toISOString(), now.toISOString(), userId, reinspectionOf || null]);
  return ir;
}

/**
 * Record a party's result. The party is the signer's own (their project
 * membership says which), except for absence: the contractor records that
 * another party did not come.
 */
export async function recordResult(db, { projectId, irId, outcome, aboutParty = null, inspectorName = null, comments = null,
  membership = null, userId = null, now = new Date() }) {
  const ir = await irFull(db, projectId, irId);
  const who = resultParty({ signerParty: membership?.inspection_party || null, outcome, aboutParty });
  if (who.error) throw bad(who.error);
  if (outcome === "rejected" && !String(comments || "").trim()) throw bad("رد بدون دلیل ثبت نمی‌شود؛ ملاحظات را بنویسید.");
  const problems = resultProblems({ ...ir.ctx, party: who.party, outcome, at: now.toISOString(), signerId: userId, raisedBy: ir.raised_by });
  if (problems.length) throw bad(problems.join(" · "));
  const { rows: [row] } = await db.query(
    `INSERT INTO inspection_result (project_id, ir_id, party, outcome, inspector_name, comments, by_user, recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [projectId, irId, who.party, outcome, inspectorName || null, comments || null, userId, now.toISOString()]);
  return { result: row, ...(await irFull(db, projectId, irId)).view };
}

/** Withdraw a request that has not been decided. */
export async function cancelIr(db, { projectId, irId, reason, userId = null, now = new Date() }) {
  if (!String(reason || "").trim()) throw bad("دلیل لغو لازم است.");
  const ir = await irFull(db, projectId, irId);
  if (ir.view.state.state !== "awaiting") throw bad("فقط درخواستی که هنوز تصمیمی نگرفته لغو می‌شود.");
  await db.query("UPDATE inspection_request SET cancelled_at = $2, cancelled_by = $3, cancel_reason = $4 WHERE id = $1",
    [irId, now.toISOString(), userId, reason.trim()]);
  return (await irFull(db, projectId, irId)).view;
}

/**
 * Raise an NCR for a rejected request, linked to it. The NCR is the
 * quality module's own record, with its own rules; this fills in what the
 * request already knows.
 */
export async function ncrFromIr(db, { projectId, irId, severity, title = null, userId = null, raiseNcr }) {
  const ir = await irFull(db, projectId, irId);
  if (ir.view.state.state !== "rejected") throw bad("NCR از درخواستی ثبت می‌شود که رد شده است.");
  if (ir.ncr_id) throw bad("برای این درخواست قبلاً NCR ثبت شده است.");
  const rej = ir.results.find((r) => r.outcome === "rejected");
  const ncr = await raiseNcr(db, {
    projectId, severity, source: "inspection",
    title: title || `${ir.view.itemLabel}: ${ir.view.activity.title}`,
    description: `${ir.ir_no} — ${PARTIES[rej.party]}: ${rej.comments}`,
    requirement: [ir.view.activity.reference, ir.view.activity.criteria].filter(Boolean).join(" · ") || null,
    subsystemId: ir.subsystem_id, tagId: ir.item_kind === "tag" ? ir.item_id : null,
    raisedOn: today(), userId,
  });
  await db.query("UPDATE inspection_request SET ncr_id = $2 WHERE id = $1", [irId, ncr.id]);
  return ncr;
}

/** The requests for an item, newest first, each with its state. */
export async function requestsFor(db, { projectId, itemKind, itemId }) {
  return irQuery(db, projectId, `r.item_kind = $2 AND r.item_id = $3`, [itemKind, itemId]);
}

/**
 * Whether a request answers an activity: the same ITP number and row. A
 * request released under revision A still answers row 20 once revision B
 * is in force — an inspection done against the plan then in force stays
 * done; a revision that changes what row 20 asks for gives it a new row.
 */
const sameActivity = (r, a) => r.itp_no === (a.itpNo ?? a.itp_no) && r.seq === a.seq;

/**
 * The inspection board: requests in a window of planned dates (or all that
 * are awaiting), each with its state and what it waits on.
 */
export async function irBoard(db, { projectId, from = null, to = null, state = null }) {
  const rows = await irQuery(db, projectId,
    `($2::timestamptz IS NULL OR r.planned_at >= $2) AND ($3::timestamptz IS NULL OR r.planned_at < $3)`, [from, to]);
  return state ? rows.filter((r) => r.state.state === state) : rows;
}

/**
 * Every approved activity of an item's kind of work, with where the item
 * stands on it: the latest request, and its state. The dossier's list of
 * inspections, and what is still owed.
 */
export async function itemInspections(db, { projectId, itemKind, itemId }) {
  const item = await resolveItem(db, { projectId, itemKind, itemId });
  if (!SCOPES[item.scope]) return { item, activities: [] };
  const acts = await approvedActivities(db, { projectId, scope: item.scope });
  const reqs = await requestsFor(db, { projectId, itemKind, itemId });
  const doneCodes = await stepsDone(db, { projectId, itemKind, itemId });
  return {
    item,
    activities: acts.map((a) => {
      const mine = reqs.filter((r) => sameActivity(r, a));
      const latest = mine.find((r) => r.state.state !== "cancelled") || null;
      // A linked step already recorded (before the ITP was in force, or
      // released): the gate no longer holds it, whatever the file shows.
      return { ...a, gates: gates(a), stepDone: !!a.stepCode && doneCodes.has(a.stepCode), latest, history: mine };
    }),
  };
}

/**
 * The gate: throws when the step may not be recorded yet on this item.
 * A kind of work with no approved ITP, or a step no activity names, passes.
 */
export async function assertStepReleased(db, { projectId, scope, stepCode, itemKind, itemId }) {
  if (!SCOPES[scope]) return;
  const acts = await approvedActivities(db, { projectId, scope, stepCode });
  if (!acts.some(gates)) return;
  // A step already recorded as done is not completed again by recording it
  // once more (a corrected date, a reference added): the gate is on
  // completing it. A step done before the ITP came into force stays done.
  if ((await stepsDone(db, { projectId, itemKind, itemId })).has(stepCode)) return;
  const reqs = await requestsFor(db, { projectId, itemKind, itemId });
  const latest = {};
  for (const a of acts) {
    const r = reqs.find((x) => sameActivity(x, a) && x.state.state !== "cancelled");
    if (r) latest[a.id] = r.state.state;
  }
  const problems = stepGate(acts, latest);
  if (problems.length) throw Object.assign(new Error(problems.join(" · ")), { status: 409, code: "INSPECTION_HOLD" });
}

/**
 * For many items at once (the field pack): a function telling, for a step
 * of an item, what inspection holds it — or null. Two queries for the whole
 * project, not two per item. The server's gate is still the answer; this
 * lets a phone show "waiting on IR-00012" instead of a button that will be
 * refused.
 */
export async function holdsFor(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT a.*, i.itp_no, i.revision, i.scope FROM itp_activity a JOIN itp i ON i.id = a.itp_id
      WHERE a.project_id = $1 AND i.status = 'approved' AND a.step_code IS NOT NULL`, [projectId]);
  const acts = rows.map(activityOut).filter(gates);
  if (!acts.length) return () => null;
  const reqs = await irQuery(db, projectId, "r.cancelled_at IS NULL", []);
  return (scope, itemKind, itemId, stepCode) => {
    const mine = acts.filter((a) => a.scope === scope && a.stepCode === stepCode);
    for (const a of mine) {
      const r = reqs.find((x) => x.item_kind === itemKind && x.item_id === itemId && sameActivity(x, a));
      if (r?.state.state === "released") continue;
      return { itpNo: a.itpNo, seq: a.seq, title: a.title, irNo: r?.ir_no || null, state: r?.state.state || null };
    }
    return null;
  };
}

// ── internals ────────────────────────────────────────────────────────────

const ACTIVITY_TABLE = {
  tag: ["tag_activity", "tag_id"], spool: ["spool_activity", "spool_id"], cable: ["cable_activity", "cable_id"],
  instrument: ["instrument_activity", "instrument_id"], coating_item: ["coating_activity", "item_id"],
};

// A lot as people name it: the item code, the receipt, and the heat.
const LOT_LABEL = "mi.code || ' · ' || l.receipt_no || COALESCE(' · ذوب ' || l.heat_no, '')";

/**
 * The steps of an item already done. A chain's are its activity rows. A
 * lot's two are read off the warehouse's own record, and "done" is what the
 * gate protects — ACCEPTING: some quantity accepted on the MIR, the MTC
 * accepted. A lot rejected outright has not passed the MIR, so accepting it
 * later is still held.
 */
async function stepsDone(db, { projectId, itemKind, itemId }) {
  if (itemKind === "lot") {
    const { rows: [l] } = await db.query(
      "SELECT qty_accepted, mtc_status FROM material_lot WHERE id = $1 AND project_id = $2", [itemId, projectId]);
    const out = new Set();
    if (Number(l?.qty_accepted) > 0) out.add("mir");
    if (l?.mtc_status === "accepted") out.add("mtc_review");
    return out;
  }
  const [table, col] = ACTIVITY_TABLE[itemKind];
  const { rows } = await db.query(
    `SELECT code FROM ${table} WHERE project_id = $1 AND ${col} = $2 AND status = 'done'`, [projectId, itemId]);
  return new Set(rows.map((r) => r.code));
}

async function irQuery(db, projectId, where, params) {
  const { rows } = await db.query(
    `SELECT r.*, a.seq, a.title AS activity_title, a.step_code, a.reference, a.criteria, a.record,
            a.contractor, a.company, a.tpi, i.itp_no, i.revision, i.scope,
            p.inspection_notice_hours, u.display_name AS raised_by_name, s.code AS subsystem_code, n.ncr_no
       FROM inspection_request r
       JOIN itp_activity a ON a.id = r.activity_id JOIN itp i ON i.id = a.itp_id
       JOIN project p ON p.id = r.project_id
       LEFT JOIN app_user u ON u.id = r.raised_by LEFT JOIN subsystem s ON s.id = r.subsystem_id
       LEFT JOIN ncr n ON n.id = r.ncr_id
      WHERE r.project_id = $1 AND ${where} ORDER BY r.planned_at DESC, r.ir_no DESC`, [projectId, ...params]);
  if (!rows.length) return [];
  const { rows: results } = await db.query(
    `SELECT x.*, u.display_name AS by_name FROM inspection_result x LEFT JOIN app_user u ON u.id = x.by_user
      WHERE x.ir_id = ANY($1::uuid[]) ORDER BY x.recorded_at`, [rows.map((r) => r.id)]);
  const labels = await itemLabels(db, projectId, rows);
  return rows.map((r) => {
    const mine = results.filter((x) => x.ir_id === r.id);
    const activity = { id: r.activity_id, seq: r.seq, title: r.activity_title, stepCode: r.step_code, reference: r.reference,
      criteria: r.criteria, record: r.record, points: { contractor: r.contractor, company: r.company, tpi: r.tpi } };
    const state = irState({ activity, results: mine, raisedAt: r.raised_at, plannedAt: r.planned_at,
      noticeHours: r.inspection_notice_hours, cancelled: !!r.cancelled_at });
    return { ...r, activity, results: mine, state, itemLabel: labels[`${r.item_kind}:${r.item_id}`] || "?" };
  });
}

async function itemLabels(db, projectId, rows) {
  const out = {};
  const by = (k) => [...new Set(rows.filter((r) => r.item_kind === k).map((r) => r.item_id))];
  const pull = async (kind, sql) => {
    const ids = by(kind);
    if (!ids.length) return;
    const { rows: got } = await db.query(sql, [ids, projectId]);
    for (const g of got) out[`${kind}:${g.id}`] = g.label;
  };
  await pull("tag", "SELECT id, tag_no AS label FROM tag WHERE id = ANY($1::uuid[]) AND project_id = $2");
  await pull("spool", "SELECT id, spool_no AS label FROM spool WHERE id = ANY($1::uuid[]) AND project_id = $2");
  await pull("cable", "SELECT id, cable_no AS label FROM cable WHERE id = ANY($1::uuid[]) AND project_id = $2");
  await pull("instrument", "SELECT id, tag_no AS label FROM instrument WHERE id = ANY($1::uuid[]) AND project_id = $2");
  await pull("coating_item", `SELECT ci.id, COALESCE(sp.spool_no, t.tag_no) || ' (رنگ)' AS label FROM coating_item ci
    LEFT JOIN spool sp ON sp.id = ci.spool_id LEFT JOIN tag t ON t.id = ci.tag_id WHERE ci.id = ANY($1::uuid[]) AND ci.project_id = $2`);
  await pull("lot", `SELECT l.id, ${LOT_LABEL} AS label FROM material_lot l JOIN material_item mi ON mi.id = l.item_id
    WHERE l.id = ANY($1::uuid[]) AND l.project_id = $2`);
  return out;
}

async function irFull(db, projectId, irId) {
  if (!UUID.test(String(irId || ""))) throw notFound("inspection request");
  const [r] = await irQuery(db, projectId, "r.id = $2", [irId]);
  if (!r) throw notFound("inspection request");
  return {
    ...r,
    ctx: { activity: r.activity, results: r.results, raisedAt: new Date(r.raised_at).toISOString(),
      plannedAt: new Date(r.planned_at).toISOString(), noticeHours: r.inspection_notice_hours, cancelled: !!r.cancelled_at },
    view: r,
  };
}

async function itpRow(db, projectId, itpId) {
  if (!UUID.test(String(itpId || ""))) throw notFound("itp");
  const { rows: [row] } = await db.query("SELECT * FROM itp WHERE id = $1 AND project_id = $2", [itpId, projectId]);
  if (!row) throw notFound("itp");
  return row;
}

function clean(points = {}) {
  const out = {};
  for (const [k, v] of Object.entries(points || {})) out[k] = v ? String(v).trim().toUpperCase() : null;
  return out;
}

export { OUTCOMES, PARTIES, SCOPES };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const today = () => new Date().toISOString().slice(0, 10);
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
