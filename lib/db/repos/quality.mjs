/**
 * Punch list and NCR: records and their event logs.
 *
 * Every rule is lib/quality/quality.mjs; this reads and writes.
 * Call inside `withProject`.
 */
import {
  PUNCH_CATEGORIES, DISPOSITIONS, NCR_SEVERITY, punchProblems, punchState, punchBlocks,
  ncrProblems, ncrAfter, ncrEscalation, ncrBlocks,
} from "../../quality/quality.mjs";

// ── punch ────────────────────────────────────────────────────────────────

/**
 * Raise a punch item. With a tag, the subsystem is the tag's — typed twice
 * is typed wrong once — and a tag filed nowhere cannot carry a punch item,
 * because it would block nothing.
 */
export async function raisePunch(db, {
  projectId, subsystemId = null, tagId = null, discipline = null, category, description, location = null,
  actionContractorId = null, raisedOn, dueOn = null, userId = null,
}) {
  if (!PUNCH_CATEGORIES[category]) throw bad("دستهٔ Punch باید A، B یا C باشد.");
  if (!String(description || "").trim()) throw bad("شرح آیتم Punch لازم است.");
  if (!raisedOn) throw bad("تاریخ ثبت لازم است.");
  if (dueOn && dueOn < raisedOn) throw bad("مهلت رفع پیش از تاریخ ثبت است.");
  const sub = await resolveSubsystem(db, { projectId, subsystemId, tagId, required: true });
  const { rows: [{ n }] } = await db.query(
    "SELECT count(*)::int AS n FROM punch_item WHERE project_id = $1 AND subsystem_id = $2", [projectId, sub.id]);
  const punchNo = `${sub.code}-P${String(n + 1).padStart(3, "0")}`;
  const { rows: [p] } = await db.query(
    `INSERT INTO punch_item (project_id, punch_no, subsystem_id, tag_id, discipline, category, description, location,
                             action_contractor_id, raised_by, raised_on, due_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [projectId, punchNo, sub.id, tagId || null, discipline || null, category, description.trim(), location || null,
     actionContractorId || null, userId, raisedOn, dueOn || null]);
  await punchEvent(db, { projectId, punchId: p.id, event: "raised", toValue: category, userId });
  return p;
}

/**
 * clear · verify · reject · recategorise
 */
export async function punchAction(db, { projectId, punchId, action, note = null, category = null, onDate, userId = null }) {
  const p = await punchRow(db, projectId, punchId);
  const problems = punchProblems(camelPunch(p), action, { actorId: userId, note });
  if (action === "recategorise") {
    if (!PUNCH_CATEGORIES[category]) problems.push("دستهٔ جدید باید A، B یا C باشد");
    else if (category === p.category) problems.push("دسته تغییری نکرده");
  }
  if (problems.length) throw bad(problems.join(" · "));
  const date = onDate || today();
  let row;
  if (action === "clear") {
    ({ rows: [row] } = await db.query(
      `UPDATE punch_item SET status = 'cleared', cleared_by = $2, cleared_on = $3, clear_note = $4
        WHERE id = $1 RETURNING *`, [p.id, userId, date, note.trim()]));
    await punchEvent(db, { projectId, punchId: p.id, event: "cleared", note, userId });
  } else if (action === "verify") {
    ({ rows: [row] } = await db.query(
      "UPDATE punch_item SET status = 'closed', closed_by = $2, closed_on = $3 WHERE id = $1 RETURNING *",
      [p.id, userId, date]));
    await punchEvent(db, { projectId, punchId: p.id, event: "closed", note, userId });
  } else if (action === "reject") {
    ({ rows: [row] } = await db.query(
      `UPDATE punch_item SET status = 'open', cleared_by = NULL, cleared_on = NULL, clear_note = NULL
        WHERE id = $1 RETURNING *`, [p.id]));
    await punchEvent(db, { projectId, punchId: p.id, event: "rejected", note, userId });
  } else {
    ({ rows: [row] } = await db.query("UPDATE punch_item SET category = $2 WHERE id = $1 RETURNING *", [p.id, category]));
    await punchEvent(db, { projectId, punchId: p.id, event: "recategorised", fromValue: p.category, toValue: category, note, userId });
  }
  return row;
}

export async function listPunch(db, { projectId, subsystemId = null, tagId = null, onDate = null }) {
  const d = onDate || today();
  const { rows } = await db.query(
    `SELECT p.*, s.code AS subsystem_code, t.tag_no, c.code AS contractor_code,
            ur.display_name AS raised_by_name, uc.display_name AS cleared_by_name, uv.display_name AS closed_by_name,
            (SELECT count(*)::int FROM punch_event e WHERE e.punch_id = p.id AND e.event = 'recategorised') AS recategorised
       FROM punch_item p
       JOIN subsystem s ON s.id = p.subsystem_id
       LEFT JOIN tag t ON t.id = p.tag_id
       LEFT JOIN contractor c ON c.id = p.action_contractor_id
       LEFT JOIN app_user ur ON ur.id = p.raised_by
       LEFT JOIN app_user uc ON uc.id = p.cleared_by
       LEFT JOIN app_user uv ON uv.id = p.closed_by
      WHERE p.project_id = $1 AND ($2::uuid IS NULL OR p.subsystem_id = $2) AND ($3::uuid IS NULL OR p.tag_id = $3)
      ORDER BY (p.status = 'closed'), p.category, p.punch_no`, [projectId, subsystemId, tagId]);
  return rows.map((r) => ({ ...r, state: punchState(camelPunch(r), d) }));
}

export async function punchHistory(db, { projectId, punchId }) {
  const { rows } = await db.query(
    `SELECT e.*, u.display_name AS by_name FROM punch_event e LEFT JOIN app_user u ON u.id = e.by_user
      WHERE e.project_id = $1 AND e.punch_id = $2 ORDER BY e.at`, [projectId, punchId]);
  return rows;
}

// ── NCR ──────────────────────────────────────────────────────────────────

export async function raiseNcr(db, {
  projectId, title, description, requirement = null, source = null, severity, discipline = null,
  subsystemId = null, tagId = null, contractorId = null, raisedOn, responseDue = null, userId = null,
}) {
  if (!String(title || "").trim() || !String(description || "").trim()) throw bad("عنوان و شرح NCR لازم است.");
  if (!NCR_SEVERITY[severity]) throw bad("شدت NCR باید «عمده» یا «جزئی» باشد.");
  if (!raisedOn) throw bad("تاریخ ثبت لازم است.");
  if (responseDue && responseDue < raisedOn) throw bad("مهلت پاسخ پیش از تاریخ ثبت است.");
  const sub = await resolveSubsystem(db, { projectId, subsystemId, tagId, required: false });
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM ncr WHERE project_id = $1", [projectId]);
  const ncrNo = `NCR-${String(n + 1).padStart(4, "0")}`;
  const { rows: [row] } = await db.query(
    `INSERT INTO ncr (project_id, ncr_no, title, description, requirement, source, severity, discipline, subsystem_id,
                      tag_id, contractor_id, raised_by, raised_on, response_due)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [projectId, ncrNo, title.trim(), description.trim(), requirement || null, source || null, severity, discipline || null,
     sub?.id || null, tagId || null, contractorId || null, userId, raisedOn, responseDue || null]);
  await ncrEvent(db, { projectId, ncrId: row.id, event: "raised", userId });
  return row;
}

/**
 * propose · approve · rejectDisposition · implement · close
 * `actorIsEngineer` comes from the caller's role: approving a concession
 * is an engineering signature.
 */
export async function ncrAction(db, {
  projectId, ncrId, action, disposition = null, dispositionNote = null, note = null, rootCause = null,
  correctiveAction = null, onDate, userId = null, actorIsEngineer = false,
}) {
  const n = await ncrRow(db, projectId, ncrId);
  const problems = ncrProblems(camelNcr(n), action,
    { actorId: userId, actorIsEngineer, disposition, dispositionNote, note, rootCause: blank(rootCause), correctiveAction: blank(correctiveAction) });
  if (problems.length) throw bad(problems.join(" · "));
  const date = onDate || today();
  const to = ncrAfter(action);
  let row;
  if (action === "propose") {
    ({ rows: [row] } = await db.query(
      `UPDATE ncr SET status = $2, disposition = $3, disposition_note = $4, proposed_by = $5,
                      root_cause = COALESCE($6, root_cause), corrective_action = COALESCE($7, corrective_action)
        WHERE id = $1 RETURNING *`,
      [n.id, to, disposition, dispositionNote.trim(), userId, blank(rootCause), blank(correctiveAction)]));
  } else if (action === "approve") {
    ({ rows: [row] } = await db.query(
      "UPDATE ncr SET status = $2, approved_by = $3, approved_on = $4 WHERE id = $1 RETURNING *", [n.id, to, userId, date]));
  } else if (action === "rejectDisposition") {
    ({ rows: [row] } = await db.query(
      `UPDATE ncr SET status = $2, disposition = NULL, disposition_note = NULL, proposed_by = NULL
        WHERE id = $1 RETURNING *`, [n.id, to]));
  } else if (action === "implement") {
    ({ rows: [row] } = await db.query(
      `UPDATE ncr SET status = $2, implemented_by = $3, implemented_on = $4, implement_note = $5,
                      root_cause = COALESCE($6, root_cause), corrective_action = COALESCE($7, corrective_action)
        WHERE id = $1 RETURNING *`, [n.id, to, userId, date, note.trim(), blank(rootCause), blank(correctiveAction)]));
  } else {
    ({ rows: [row] } = await db.query(
      `UPDATE ncr SET status = $2, closed_by = $3, closed_on = $4,
                      root_cause = COALESCE($5, root_cause), corrective_action = COALESCE($6, corrective_action)
        WHERE id = $1 RETURNING *`, [n.id, to, userId, date, blank(rootCause), blank(correctiveAction)]));
  }
  await ncrEvent(db, { projectId, ncrId: n.id, event: action,
    note: action === "propose" ? `${disposition}: ${dispositionNote}` : note, userId });
  return row;
}

export async function listNcr(db, { projectId, subsystemId = null, tagId = null, onDate = null }) {
  const d = onDate || today();
  const { rows: [p] } = await db.query("SELECT ncr_escalation_days FROM project WHERE id = $1", [projectId]);
  const { rows } = await db.query(
    `SELECT n.*, s.code AS subsystem_code, t.tag_no, c.code AS contractor_code,
            ur.display_name AS raised_by_name, up.display_name AS proposed_by_name, ua.display_name AS approved_by_name,
            ui.display_name AS implemented_by_name, uc.display_name AS closed_by_name
       FROM ncr n
       LEFT JOIN subsystem s ON s.id = n.subsystem_id
       LEFT JOIN tag t ON t.id = n.tag_id
       LEFT JOIN contractor c ON c.id = n.contractor_id
       LEFT JOIN app_user ur ON ur.id = n.raised_by
       LEFT JOIN app_user up ON up.id = n.proposed_by
       LEFT JOIN app_user ua ON ua.id = n.approved_by
       LEFT JOIN app_user ui ON ui.id = n.implemented_by
       LEFT JOIN app_user uc ON uc.id = n.closed_by
      WHERE n.project_id = $1 AND ($2::uuid IS NULL OR n.subsystem_id = $2) AND ($3::uuid IS NULL OR n.tag_id = $3)
      ORDER BY (n.status = 'closed'), n.ncr_no`, [projectId, subsystemId, tagId]);
  return rows.map((r) => ({ ...r, escalation: ncrEscalation(camelNcr(r), d, p.ncr_escalation_days) }));
}

export async function ncrHistory(db, { projectId, ncrId }) {
  const { rows } = await db.query(
    `SELECT e.*, u.display_name AS by_name FROM ncr_event e LEFT JOIN app_user u ON u.id = e.by_user
      WHERE e.project_id = $1 AND e.ncr_id = $2 ORDER BY e.at`, [projectId, ncrId]);
  return rows;
}

/**
 * What each subsystem's punch list and NCRs hold against MC and RFSU.
 * Keyed by subsystem id, for the completions module and the board.
 */
export async function qualityBlocks(db, { projectId }) {
  const { rows: punch } = await db.query(
    "SELECT subsystem_id, category, status FROM punch_item WHERE project_id = $1", [projectId]);
  const { rows: ncrs } = await db.query(
    `SELECT COALESCE(n.subsystem_id, t.subsystem_id) AS subsystem_id, n.status
       FROM ncr n LEFT JOIN tag t ON t.id = n.tag_id WHERE n.project_id = $1`, [projectId]);
  const out = {};
  const at = (id) => (out[id] ||= { punch: [], ncr: [] });
  for (const p of punch) at(p.subsystem_id).punch.push(p);
  for (const n of ncrs) if (n.subsystem_id) at(n.subsystem_id).ncr.push(n);
  return Object.fromEntries(Object.entries(out).map(([id, v]) => [id, { ...punchBlocks(v.punch), ncr: ncrBlocks(v.ncr) }]));
}

export async function qualityBoard(db, { projectId, onDate = null }) {
  const d = onDate || today();
  const punch = await listPunch(db, { projectId, onDate: d });
  const ncrs = await listNcr(db, { projectId, onDate: d });
  const { rows: subs } = await db.query("SELECT id, code, name FROM subsystem WHERE project_id = $1 ORDER BY code", [projectId]);
  const blocks = await qualityBlocks(db, { projectId });
  const { rows: [p] } = await db.query("SELECT ncr_escalation_days FROM project WHERE id = $1", [projectId]);
  return {
    today: d, escalationDays: p.ncr_escalation_days, punch, ncrs,
    subsystems: subs.map((s) => ({ ...s, ...(blocks[s.id] || { mc: 0, rfsu: 0, carried: 0, ncr: 0 }) })),
    categories: PUNCH_CATEGORIES, dispositions: DISPOSITIONS, severities: NCR_SEVERITY,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────

async function resolveSubsystem(db, { projectId, subsystemId, tagId, required }) {
  let fromTag = null;
  if (tagId) {
    const { rows: [t] } = await db.query("SELECT subsystem_id FROM tag WHERE id = $1 AND project_id = $2", [tagId, projectId]);
    if (!t) throw notFound("tag");
    if (!t.subsystem_id && required) throw bad("این تگ در هیچ ساب‌سیستمی ثبت نشده؛ Punch آن هیچ چیزی را متوقف نمی‌کرد.");
    fromTag = t.subsystem_id;
  }
  if (subsystemId && fromTag && subsystemId !== fromTag) throw bad("ساب‌سیستم انتخاب‌شده با ساب‌سیستم تگ یکی نیست.");
  const id = subsystemId || fromTag;
  if (!id) {
    if (required) throw bad("ساب‌سیستم یا تگ لازم است.");
    return null;
  }
  const { rows: [s] } = await db.query("SELECT id, code FROM subsystem WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!s) throw notFound("subsystem");
  return s;
}

async function punchEvent(db, { projectId, punchId, event, fromValue = null, toValue = null, note = null, userId }) {
  await db.query(
    `INSERT INTO punch_event (project_id, punch_id, event, from_value, to_value, note, by_user)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`, [projectId, punchId, event, fromValue, toValue, note || null, userId]);
}
async function ncrEvent(db, { projectId, ncrId, event, note = null, userId }) {
  await db.query("INSERT INTO ncr_event (project_id, ncr_id, event, note, by_user) VALUES ($1,$2,$3,$4,$5)",
    [projectId, ncrId, event, note || null, userId]);
}
async function punchRow(db, projectId, id) {
  const { rows: [p] } = await db.query("SELECT * FROM punch_item WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!p) throw notFound("punch item");
  return p;
}
async function ncrRow(db, projectId, id) {
  const { rows: [n] } = await db.query("SELECT * FROM ncr WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!n) throw notFound("NCR");
  return n;
}
const camelPunch = (p) => ({ status: p.status, category: p.category, clearedBy: p.cleared_by, dueOn: iso(p.due_on) });
const camelNcr = (n) => ({
  status: n.status, disposition: n.disposition, proposedBy: n.proposed_by, implementedBy: n.implemented_by,
  rootCause: n.root_cause, correctiveAction: n.corrective_action, responseDue: iso(n.response_due),
});
const blank = (v) => (v === null || v === undefined || !String(v).trim() ? null : String(v).trim());
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));
const today = () => new Date().toISOString().slice(0, 10);
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
