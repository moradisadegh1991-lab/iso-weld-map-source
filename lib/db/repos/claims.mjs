/**
 * Work handed over by the contractor and accepted by the employer
 * (migration 055).
 *
 * With the project's `site_work_approval` on, a step a contractor-side member
 * records as done is a claim: kept in progress with the date claimed, and
 * counted nowhere until a member who signs for the employer (inspection
 * party «company») approves it. The one who claimed does not approve. A
 * rejection keeps the step open, with its reason.
 *
 * Each recorder (tag, spool, cable, instrument, coating step) asks
 * `claimFor` before it writes and calls `stampClaim` after; everything else
 * — the chains, progress, EV, statements, MC — already counts only `done`.
 *
 * Call inside `withProject`.
 */
import { chainFor } from "../../platform/precedence.mjs";
import { logEvent } from "./log.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });

/** The activity tables, the column naming their item, and the chain their steps belong to. Constants: written into SQL. */
export const CLAIM_TABLES = {
  tag_activity:        { item: "tag_id",        section: "equipment" },
  spool_activity:      { item: "spool_id",      section: "piping",          chain: "piping_spool" },
  cable_activity:      { item: "cable_id",      section: "electrical",      chain: "cable" },
  instrument_activity: { item: "instrument_id", section: "instrumentation", chain: "instrument" },
  coating_activity:    { item: "item_id",       section: "coating",         chain: "coating" },
};

/** Whether this user's "done" is a claim: the project asks for approval, and the user does not sign for the employer. */
export async function isClaimant(db, { projectId, userId }) {
  const { rows: [p] } = await db.query("SELECT site_work_approval FROM project WHERE id = $1", [projectId]);
  if (!p?.site_work_approval) return false;
  const { rows: [m] } = await db.query("SELECT inspection_party FROM project_member WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
  return m?.inspection_party !== "company";
}

/**
 * Before a recorder writes: a contractor's "done" becomes a claim — status in
 * progress, no done date, the claimed date kept. A step the employer has
 * already approved is not re-opened by the contractor.
 */
export async function claimFor(db, { projectId, userId, table, itemId, code, status, doneAt }) {
  const t = CLAIM_TABLES[table];
  if (!t) throw new Error(`not a claim table: ${table}`);
  if (status !== "done" || !(await isClaimant(db, { projectId, userId }))) return { status, doneAt, claimedOn: null };
  const { rows: [have] } = await db.query(
    `SELECT status, approved_by FROM ${table} WHERE project_id = $1 AND ${t.item} = $2 AND code = $3`, [projectId, itemId, code]);
  if (have?.status === "done") throw bad("این مرحله انجام‌شده و تأییدشده است؛ تغییرش با نمایندهٔ کارفرماست.");
  return { status: "in_progress", doneAt: null, claimedOn: doneAt };
}

/** After a recorder writes: the row carries its claim, or — recorded directly — none. */
export async function stampClaim(db, { table, row, claimedOn, userId }) {
  if (!CLAIM_TABLES[table] || !row) return row;
  if (!claimedOn && !row.claimed_on) return row;
  const { rows: [r] } = await db.query(
    `UPDATE ${table} SET claimed_on = $2,
        rejected_by = CASE WHEN $2::date IS NULL THEN rejected_by ELSE NULL END,
        rejected_at = CASE WHEN $2::date IS NULL THEN rejected_at ELSE NULL END,
        rejected_reason = CASE WHEN $2::date IS NULL THEN rejected_reason ELSE NULL END
      WHERE id = $1 RETURNING *`, [row.id, claimedOn]);
  if (claimedOn) {
    const [label] = await labels(db, table, [r]);
    await logEvent(db, { projectId: r.project_id, section: "work", entityType: "claim", entityId: r.id,
      label: `${label.item} — ${label.step}`, action: "submitted", to: "claimed", comment: `اعلام انجام در ${claimedOn}`, userId });
  }
  return { ...r, claimed: !!claimedOn };
}

export async function labels(db, table, rows) {
  const t = CLAIM_TABLES[table];
  const ids = rows.map((r) => r[t.item]);
  const q = {
    tag_activity: "SELECT id, tag_no AS item, kind FROM tag WHERE id = ANY($1)",
    spool_activity: "SELECT s.id, s.spool_no || COALESCE(' · ' || l.line_no, '') AS item FROM spool s LEFT JOIN line l ON l.id = s.line_id WHERE s.id = ANY($1)",
    cable_activity: "SELECT id, cable_no AS item FROM cable WHERE id = ANY($1)",
    instrument_activity: "SELECT id, tag_no AS item FROM instrument WHERE id = ANY($1)",
    coating_activity: `SELECT ci.id, COALESCE(s.spool_no, t.tag_no, '—') AS item FROM coating_item ci
                         LEFT JOIN spool s ON s.id = ci.spool_id LEFT JOIN tag t ON t.id = ci.tag_id WHERE ci.id = ANY($1)`,
  }[table];
  const { rows: items } = await db.query(q, [ids]);
  const byId = new Map(items.map((i) => [i.id, i]));
  return rows.map((r) => {
    const it = byId.get(r[t.item]) || {};
    const chain = chainFor(t.chain || it.kind) || [];
    return { item: it.item || "—", step: chain.find((s) => s.code === r.code)?.title || r.code };
  });
}

/** Every claim waiting for the employer, and the latest decisions — across disciplines. */
export async function claimsBoard(db, { projectId, limit = 100 }) {
  const out = { pending: [], decided: [] };
  for (const table of Object.keys(CLAIM_TABLES)) {
    const { rows } = await db.query(
      `SELECT a.*, c.code AS contractor, u.display_name AS claimant, ua.display_name AS approver, ur.display_name AS rejecter
         FROM ${table} a LEFT JOIN contractor c ON c.id = a.contractor_id
         LEFT JOIN app_user u ON u.id = a.recorded_by LEFT JOIN app_user ua ON ua.id = a.approved_by LEFT JOIN app_user ur ON ur.id = a.rejected_by
        WHERE a.project_id = $1 AND (a.claimed_on IS NOT NULL OR a.approved_by IS NOT NULL OR a.rejected_by IS NOT NULL)
        ORDER BY COALESCE(a.approved_at, a.rejected_at, a.recorded_at) DESC LIMIT ${Number(limit) || 100}`, [projectId]);
    const ls = await labels(db, table, rows);
    rows.forEach((r, k) => {
      const x = { table, id: r.id, discipline: CLAIM_TABLES[table].section, item: ls[k].item, step: ls[k].step, code: r.code,
        claimedOn: iso(r.claimed_on), doneAt: iso(r.done_at), refNo: r.ref_no, contractor: r.contractor, claimant: r.claimant,
        claimantId: r.recorded_by, approver: r.approver, approvedAt: r.approved_at, rejecter: r.rejecter, rejectedAt: r.rejected_at,
        reason: r.rejected_reason };
      if (r.claimed_on) out.pending.push(x); else out.decided.push(x);
    });
  }
  out.pending.sort((a, b) => (a.claimedOn < b.claimedOn ? -1 : 1));
  out.decided.sort((a, b) => String(b.approvedAt || b.rejectedAt).localeCompare(String(a.approvedAt || a.rejectedAt)));
  const { rows: [p] } = await db.query("SELECT site_work_approval FROM project WHERE id = $1", [projectId]);
  return { enabled: !!p?.site_work_approval, ...out };
}

/**
 * The employer's decision on claims, one or many: approve (the step is done
 * on the claimed date) or reject (it stays open, with the reason). Only a
 * member who signs for the employer decides, and never on their own claim.
 */
export async function decideClaims(db, { projectId, items = [], decision, reason = null, userId }) {
  if (!["approve", "reject"].includes(decision)) throw bad("تصمیم باید تأیید یا رد باشد.");
  if (!items.length) throw bad("هیچ موردی انتخاب نشده است.");
  if (decision === "reject" && !String(reason || "").trim()) throw bad("رد کار دلیل می‌خواهد.");
  const { rows: [m] } = await db.query("SELECT inspection_party FROM project_member WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
  if (m?.inspection_party !== "company") throw bad("تأیید یا رد کار پیمانکار با عضوی است که از طرف کارفرما امضا می‌کند (طرف بازرسی: کارفرما).");
  const problems = [];
  const rows = [];
  for (const { table, id } of items) {
    if (!CLAIM_TABLES[table]) { problems.push(`جدول ${table}`); continue; }
    const { rows: [r] } = await db.query(`SELECT * FROM ${table} WHERE id = $1 AND project_id = $2`, [id, projectId]);
    if (!r || !r.claimed_on) { problems.push("موردی که در انتظار تأیید نیست"); continue; }
    if (r.recorded_by === userId) { problems.push("اعلام‌کنندهٔ کار، آن را تأیید یا رد نمی‌کند"); continue; }
    rows.push({ table, r });
  }
  if (problems.length) throw bad([...new Set(problems)].join(" · "));
  for (const { table, r } of rows) {
    const [label] = await labels(db, table, [r]);
    if (decision === "approve") {
      await db.query(
        `UPDATE ${table} SET status = 'done', done_at = claimed_on, claimed_on = NULL, approved_by = $2, approved_at = now(),
            rejected_by = NULL, rejected_at = NULL, rejected_reason = NULL WHERE id = $1`, [r.id, userId]);
    } else {
      await db.query(
        `UPDATE ${table} SET claimed_on = NULL, rejected_by = $2, rejected_at = now(), rejected_reason = $3 WHERE id = $1`,
        [r.id, userId, String(reason).trim()]);
    }
    await logEvent(db, { projectId, section: "work", entityType: "claim", entityId: r.id,
      label: `${label.item} — ${label.step}`, action: decision === "approve" ? "approved" : "returned",
      from: "claimed", to: decision === "approve" ? "done" : "rejected", comment: decision === "reject" ? String(reason).trim() : null, userId });
  }
  return claimsBoard(db, { projectId });
}

function iso(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null; }
