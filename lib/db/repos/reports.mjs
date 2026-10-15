/**
 * Reports with a staged review: types and their workflow, and each report's
 * content, signatures and decisions (migration 058).
 *
 * The rules are lib/reports/workflow.mjs: this module loads a snapshot, asks
 * it, and writes only what it allows. Content, signatures and decisions are
 * only ever added; the current state is read from them.
 *
 * Every step goes to the «گزارش‌ها» log. Call inside `withProject`.
 */
import { createHash } from "node:crypto";
import { numberOr } from "./numbering.mjs";
import { logEvent } from "./log.mjs";
import { latestToday } from "../../civil/concrete.mjs";
import * as wf from "../../reports/workflow.mjs";
import { currentSignature } from "./signatures.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const forbidden = (m) => Object.assign(new Error(m), { status: 403, code: "FORBIDDEN" });
const notFound = (w) => Object.assign(new Error(`${w} not found`), { status: 404 });
const blank = (v) => { const s = String(v ?? "").trim(); return s || null; };
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const hash = (content) => createHash("sha256").update(wf.canonical(content), "utf8").digest("hex");
const T = "(extract(epoch from at) * 1000000)::bigint::text";   // ordering to the microsecond

export const STATUS_FA = { open: "در گردش", approved: "تأیید نهایی", cancelled: "لغو شده" };

const LOG = (db, projectId, r, action, extra = {}) =>
  logEvent(db, { projectId, section: "reports", entityType: "report", entityId: r.id, label: r.report_no, action, ...extra });

const allow = (verdict) => { if (!verdict.ok) throw forbidden(verdict.reason); return verdict; };

// ── workflow definition ──────────────────────────────────────────────────

export async function upsertReportType(db, { projectId, code, name, description = null, active = true }) {
  if (!blank(code) || !blank(name)) throw bad("کد و نام نوع گزارش لازم است.");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,11}$/.test(code.trim())) throw bad("کد نوع گزارش: حروف و رقم لاتین، حداکثر ۱۲ نویسه.");
  const { rows: [t] } = await db.query(
    `INSERT INTO report_type (project_id, code, name, description, active) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (project_id, code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, active = EXCLUDED.active
     RETURNING *`, [projectId, code.trim(), blank(name), blank(description), active !== false]);
  return t;
}

export async function upsertStage(db, { projectId, reportTypeId, seq, name }) {
  if (!Number.isInteger(seq) || seq < 1) throw bad("شمارهٔ ترتیب مرحله باید عدد صحیح مثبت باشد.");
  if (!blank(name)) throw bad("نام مرحله لازم است.");
  const { rows: [s] } = await db.query(
    `INSERT INTO report_stage (project_id, report_type_id, seq, name) VALUES ($1,$2,$3,$4)
     ON CONFLICT (report_type_id, seq) DO UPDATE SET name = EXCLUDED.name RETURNING *`,
    [projectId, reportTypeId, seq, blank(name)]);
  return s;
}

export async function upsertGroup(db, { projectId, stageId, seq, name, title = null, description = null }) {
  if (!Number.isInteger(seq) || seq < 1) throw bad("اولویت گروه باید عدد صحیح مثبت باشد.");
  if (!blank(name)) throw bad("نام گروه لازم است.");
  const { rows: [g] } = await db.query(
    `INSERT INTO review_group (project_id, stage_id, seq, name, title, description) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (stage_id, name) DO UPDATE SET seq = EXCLUDED.seq, title = EXCLUDED.title, description = EXCLUDED.description
     RETURNING *`, [projectId, stageId, seq, blank(name), blank(title), blank(description)]);
  return g;
}

/** Add a user to a group, or change their rights in it. */
export async function setGroupMember(db, { projectId, groupId, userId, permissions }) {
  const perms = [...new Set(permissions || [])].filter((p) => !wf.RETIRED_PERMISSIONS.includes(p));
  const unknown = perms.filter((p) => !wf.PERMISSIONS[p]);
  if (unknown.length) throw bad(`دسترسی ناشناخته: ${unknown.join("، ")}`);
  if (!perms.length) throw bad("دست‌کم یک دسترسی لازم است.");
  const { rows: [m] } = await db.query(
    "SELECT 1 FROM project_member WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
  if (!m) throw bad("این کاربر عضو پروژه نیست.");
  const { rows: [r] } = await db.query(
    `INSERT INTO group_member (project_id, group_id, user_id, permissions) VALUES ($1,$2,$3,$4)
     ON CONFLICT (group_id, user_id) DO UPDATE SET permissions = EXCLUDED.permissions RETURNING *`,
    [projectId, groupId, userId, perms]);
  return r;
}

export async function removeGroupMember(db, { projectId, groupId, userId }) {
  await db.query("DELETE FROM group_member WHERE project_id = $1 AND group_id = $2 AND user_id = $3", [projectId, groupId, userId]);
}

/**
 * A stage's one final approver and their deputy. Both must be able to sign
 * at the stage (a member of one of its groups with `sign`): final approval
 * needs the approver's own signature. Null clears.
 */
export async function setStageApprover(db, { projectId, stageId, approverId = null, deputyId = null }) {
  const { rows: [st] } = await db.query("SELECT * FROM report_stage WHERE id = $1 AND project_id = $2", [stageId, projectId]);
  if (!st) throw notFound("stage");
  if (deputyId && !approverId) throw bad("جانشین بدون تأییدکنندهٔ نهایی معنا ندارد.");
  if (deputyId && deputyId === approverId) throw bad("جانشین نمی‌تواند خود تأییدکنندهٔ نهایی باشد.");
  for (const [u, label] of [[approverId, "تأییدکنندهٔ نهایی"], [deputyId, "جانشین"]]) {
    if (!u) continue;
    const { rows: [m] } = await db.query(
      `SELECT 1 FROM group_member m JOIN review_group g ON g.id = m.group_id WHERE g.stage_id = $1 AND m.user_id = $2 AND 'sign' = ANY(m.permissions)`, [stageId, u]);
    if (!m) throw bad(`${label} باید عضو یکی از گروه‌های همین مرحله با حق امضا باشد.`);
  }
  const { rows: [r] } = await db.query("UPDATE report_stage SET approver_id = $2, deputy_id = $3 WHERE id = $1 RETURNING *", [stageId, approverId, deputyId]);
  return r;
}

/** The colour a stage's changed rows are shown in (#rrggbb). */
export async function setStageColor(db, { projectId, stageId, color }) {
  if (!/^#[0-9a-fA-F]{6}$/.test(String(color || ""))) throw bad("رنگ باید به شکل ‎#rrggbb باشد.");
  const { rows: [r] } = await db.query("UPDATE report_stage SET change_color = $3 WHERE id = $1 AND project_id = $2 RETURNING *", [stageId, projectId, color]);
  if (!r) throw notFound("stage");
  return r;
}

/**
 * Remove a stage — only from a type no report has used yet: a report's
 * history names its stages by their order, and that must keep meaning the same.
 */
export async function removeStage(db, { projectId, stageId }) {
  const { rows: [st] } = await db.query("SELECT * FROM report_stage WHERE id = $1 AND project_id = $2", [stageId, projectId]);
  if (!st) throw notFound("stage");
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM report WHERE report_type_id = $1", [st.report_type_id]);
  if (n) throw bad(`با این نوع ${n} گزارش ثبت شده است؛ مرحله حذف نمی‌شود. نام آن را می‌توان تغییر داد.`);
  await db.query("DELETE FROM report_stage WHERE id = $1", [stageId]);
}

/** Remove a group — only one nobody has signed for. Its members go with it. */
export async function removeGroup(db, { projectId, groupId }) {
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM report_signature WHERE group_id = $1 AND project_id = $2", [groupId, projectId]);
  if (n) throw bad("برای این گروه امضا ثبت شده است؛ حذف نمی‌شود. اعضایش را می‌توان برداشت.");
  await db.query("DELETE FROM review_group WHERE id = $1 AND project_id = $2", [groupId, projectId]);
}

/**
 * The daily report as agreed with the owner: contractor (planning, then site
 * management) → supervision → client. Groups only — who sits in them is the
 * project's to decide. Running it again changes nothing that exists.
 */
export const DAILY_TEMPLATE = {
  code: "DR", name: "گزارش روزانه", description: "گزارش روزانهٔ کارگاه: نیرو، ماشین‌آلات، مصالح، کار انجام‌شده، توقف‌ها و HSE",
  stages: [
    { seq: 1, name: "پیمانکار", groups: [
      { seq: 1, name: "برنامه‌ریزی", title: "دفتر فنی و برنامه‌ریزی پیمانکار" },
      { seq: 2, name: "مدیریت کارگاه", title: "رئیس کارگاه پیمانکار" }] },
    { seq: 2, name: "نظارت", groups: [{ seq: 1, name: "نظارت مقیم", title: "دستگاه نظارت" }] },
    { seq: 3, name: "کارفرما", groups: [{ seq: 1, name: "نمایندهٔ کارفرما", title: "کارفرما" }] },
  ],
};

export async function applyDailyTemplate(db, { projectId }) {
  const T = DAILY_TEMPLATE;
  const { rows: [have] } = await db.query("SELECT * FROM report_type WHERE project_id = $1 AND code = $2", [projectId, T.code]);
  const type = have || await upsertReportType(db, { projectId, code: T.code, name: T.name, description: T.description });
  const { rows: stages } = await db.query("SELECT seq FROM report_stage WHERE report_type_id = $1", [type.id]);
  if (stages.length) return { type, created: false };      // a workflow already set up is the project's, left alone
  for (const st of T.stages) {
    const s = await upsertStage(db, { projectId, reportTypeId: type.id, seq: st.seq, name: st.name });
    for (const g of st.groups) await upsertGroup(db, { projectId, stageId: s.id, ...g });
  }
  return { type, created: true };
}

/** Every report type of the project, each with its workflow. */
export async function reportTypes(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT t.*, (SELECT count(*)::int FROM report r WHERE r.report_type_id = t.id) AS reports
       FROM report_type t WHERE t.project_id = $1 ORDER BY t.code`, [projectId]);
  return Promise.all(rows.map(async (t) => ({ ...t, stages: await workflowOf(db, { projectId, reportTypeId: t.id }) })));
}

/** A type's stages in order, each with its groups in priority order and their members. */
export async function workflowOf(db, { projectId, reportTypeId }) {
  const { rows: stages } = await db.query(
    `SELECT s.id, s.seq, s.name, s.approver_id, s.deputy_id, s.change_color, a.display_name AS approver_name, d.display_name AS deputy_name
       FROM report_stage s LEFT JOIN app_user a ON a.id = s.approver_id LEFT JOIN app_user d ON d.id = s.deputy_id
      WHERE s.project_id = $1 AND s.report_type_id = $2 ORDER BY s.seq`, [projectId, reportTypeId]);
  const { rows: groups } = await db.query(
    `SELECT g.id, g.stage_id, g.seq, g.name, g.title, g.description FROM review_group g
       JOIN report_stage s ON s.id = g.stage_id WHERE s.report_type_id = $1 ORDER BY g.seq`, [reportTypeId]);
  const { rows: members } = await db.query(
    `SELECT m.group_id, m.user_id, m.permissions, u.display_name, u.email FROM group_member m
       JOIN review_group g ON g.id = m.group_id JOIN report_stage s ON s.id = g.stage_id
       LEFT JOIN app_user u ON u.id = m.user_id WHERE s.report_type_id = $1`, [reportTypeId]);
  return stages.map((s) => ({
    id: s.id, seq: s.seq, name: s.name, approverId: s.approver_id, deputyId: s.deputy_id, changeColor: s.change_color || null,
    approverName: s.approver_name || null, deputyName: s.deputy_name || null,
    groups: groups.filter((g) => g.stage_id === s.id).map((g) => ({
      id: g.id, seq: g.seq, name: g.name, title: g.title, description: g.description,
      members: members.filter((m) => m.group_id === g.id)
        .map((m) => ({ userId: m.user_id, permissions: m.permissions, name: m.display_name || m.email || null })),
    })),
  }));
}

// ── a report ─────────────────────────────────────────────────────────────

export async function snapshotOf(db, { projectId, reportId }) {
  const { rows: [r] } = await db.query(
    `SELECT r.*, (extract(epoch from r.created_at) * 1000000)::bigint::text AS created_t, t.code AS type_code, t.name AS type_name
       FROM report r JOIN report_type t ON t.id = r.report_type_id WHERE r.id = $1 AND r.project_id = $2`, [reportId, projectId]);
  if (!r) throw notFound("report");
  const stages = await workflowOf(db, { projectId, reportTypeId: r.report_type_id });
  const { rows: [v] } = await db.query(
    "SELECT version_no, content, content_hash FROM report_version WHERE report_id = $1 ORDER BY version_no DESC LIMIT 1", [reportId]);
  const { rows: sigs } = await db.query(
    `SELECT stage_seq, group_id, user_id, action, version_no, signature_id, on_behalf_of, ${T} AS t FROM report_signature WHERE report_id = $1 ORDER BY at`, [reportId]);
  const { rows: decs } = await db.query(
    `SELECT stage_seq, action, version_no, user_id, comment, ${T} AS t FROM report_decision WHERE report_id = $1 ORDER BY at`, [reportId]);
  const { rows: rec } = await db.query("SELECT DISTINCT user_id FROM report_recipient WHERE report_id = $1", [reportId]);
  return {
    report: r, content: v.content, contentHash: v.content_hash,
    snapshot: {
      status: r.status, stageSeq: r.stage_seq, versionNo: v.version_no, createdT: BigInt(r.created_t), stages,
      signatures: sigs.map((s) => ({ stageSeq: s.stage_seq, groupId: s.group_id, userId: s.user_id, action: s.action, versionNo: s.version_no,
        signatureId: s.signature_id, onBehalfOf: s.on_behalf_of, t: BigInt(s.t) })),
      decisions: decs.map((d) => ({ stageSeq: d.stage_seq, action: d.action, versionNo: d.version_no, userId: d.user_id, comment: d.comment, t: BigInt(d.t) })),
    },
    recipients: rec.map((x) => x.user_id),
  };
}

export async function createReport(db, { projectId, reportTypeId, reportDate, title = null, content = {}, reportNo = null, userId }) {
  const { rows: [type] } = await db.query("SELECT * FROM report_type WHERE id = $1 AND project_id = $2", [reportTypeId, projectId]);
  if (!type) throw notFound("report type");
  if (!type.active) throw bad(`نوع گزارش «${type.name}» غیرفعال است.`);
  if (!reportDate) throw bad("تاریخ گزارش لازم است.");
  if (iso(reportDate) > latestToday()) throw bad(`تاریخ ${iso(reportDate)} هنوز نرسیده است.`);
  const stages = await workflowOf(db, { projectId, reportTypeId });
  allow(wf.checkCreate(stages, userId));
  const no = await numberOr(db, { projectId, form: "report", scope: type.code, typed: reportNo });
  const { rows: [r] } = await db.query(
    `INSERT INTO report (project_id, report_type_id, report_no, report_date, title, stage_seq, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [projectId, reportTypeId, no, reportDate, blank(title), stages[0].seq, userId]);
  await db.query(
    `INSERT INTO report_version (project_id, report_id, version_no, stage_seq, content, content_hash, edited_by)
     VALUES ($1,$2,1,$3,$4,$5,$6)`, [projectId, r.id, stages[0].seq, JSON.stringify(content), hash(content), userId]);
  await LOG(db, projectId, r, "created", { to: stages[0].name, comment: blank(title), userId });
  return r;
}

/** A new version of the content. The same content again is refused: it would only make signatures lapse. */
export async function editReport(db, { projectId, reportId, content, userId, inspect = null }) {
  const s = await snapshotOf(db, { projectId, reportId });
  // a report kind with row rules says what this change does (rows added / changed / removed), or refuses it
  const change = inspect ? await inspect(s.content, s.snapshot) : null;
  const verdict = allow(wf.checkEdit(s.snapshot, userId, change));
  if (hash(content) === s.contentHash) throw bad("محتوا تغییری نکرده است.");
  const versionNo = s.snapshot.versionNo + 1;
  await db.query(
    `INSERT INTO report_version (project_id, report_id, version_no, stage_seq, content, content_hash, edited_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`, [projectId, reportId, versionNo, s.snapshot.stageSeq, JSON.stringify(content), hash(content), userId]);
  await LOG(db, projectId, s.report, "updated", {
    comment: verdict.lapses.length ? `نسخهٔ ${versionNo}؛ ${verdict.lapses.length} امضا باید دوباره داده شود` : `نسخهٔ ${versionNo}`, userId });
  return { versionNo, lapsed: verdict.lapses.length };
}

export async function signReport(db, { projectId, reportId, groupId = null, userId }) {
  const s = await snapshotOf(db, { projectId, reportId });
  const v = allow(wf.checkSign(s.snapshot, userId, groupId));
  // the image in use now goes with the signature: changing it later does not change what was signed
  const image = await currentSignature(db, { userId });
  await db.query(
    `INSERT INTO report_signature (project_id, report_id, stage_seq, group_id, user_id, action, version_no, signature_id, on_behalf_of)
     VALUES ($1,$2,$3,$4,$5,'sign',$6,$7,$8)`, [projectId, reportId, s.snapshot.stageSeq, v.groupId, userId, s.snapshot.versionNo, image?.id || null,
      wf.onBehalfOf(s.snapshot, s.snapshot.stageSeq, userId)]);
  await LOG(db, projectId, s.report, "signed", { comment: `نسخهٔ ${s.snapshot.versionNo}`, userId });
}

export async function withdrawSignature(db, { projectId, reportId, groupId = null, userId }) {
  const s = await snapshotOf(db, { projectId, reportId });
  const v = allow(wf.checkWithdraw(s.snapshot, userId, groupId));
  const own = wf.signaturesAt(s.snapshot, s.snapshot.stageSeq).find((x) => x.userId === userId && x.groupId === v.groupId);
  await db.query(
    `INSERT INTO report_signature (project_id, report_id, stage_seq, group_id, user_id, action, version_no)
     VALUES ($1,$2,$3,$4,$5,'withdraw',$6)`, [projectId, reportId, s.snapshot.stageSeq, v.groupId, userId, own.versionNo]);
  await LOG(db, projectId, s.report, "withdrawn", { userId });
}

/** Final approval of the stage the report is at: on to the next stage, or — at the last — the record. */
export async function approveStage(db, { projectId, reportId, comment = null, userId }) {
  const s = await snapshotOf(db, { projectId, reportId });
  const v = allow(wf.checkApprove(s.snapshot, userId));
  const stage = s.snapshot.stages.find((x) => x.seq === s.snapshot.stageSeq);
  await db.query(
    `INSERT INTO report_decision (project_id, report_id, stage_seq, action, version_no, user_id, comment, on_behalf_of)
     VALUES ($1,$2,$3,'approved',$4,$5,$6,$7)`, [projectId, reportId, s.snapshot.stageSeq, s.snapshot.versionNo, userId, blank(comment), v.onBehalfOf || null]);
  let r;
  if (v.final) {
    ({ rows: [r] } = await db.query(
      `UPDATE report SET status = 'approved', approved_version = $2, approved_hash = $3, approved_at = now() WHERE id = $1 RETURNING *`,
      [reportId, s.snapshot.versionNo, s.contentHash]));
  } else {
    ({ rows: [r] } = await db.query("UPDATE report SET stage_seq = $2 WHERE id = $1 RETURNING *", [reportId, v.next]));
  }
  const to = v.final ? STATUS_FA.approved : s.snapshot.stages.find((x) => x.seq === v.next).name;
  await LOG(db, projectId, s.report, "approved", { from: stage.name, to, comment: blank(comment), userId });
  return r;
}

export async function returnReport(db, { projectId, reportId, comment, userId }) {
  const s = await snapshotOf(db, { projectId, reportId });
  const v = allow(wf.checkReturn(s.snapshot, userId, comment));
  await db.query(
    `INSERT INTO report_decision (project_id, report_id, stage_seq, action, version_no, user_id, comment)
     VALUES ($1,$2,$3,'returned',$4,$5,$6)`, [projectId, reportId, s.snapshot.stageSeq, s.snapshot.versionNo, userId, blank(comment)]);
  const { rows: [r] } = await db.query("UPDATE report SET stage_seq = $2 WHERE id = $1 RETURNING *", [reportId, v.to]);
  const name = (seq) => s.snapshot.stages.find((x) => x.seq === seq).name;
  await LOG(db, projectId, s.report, "returned", { from: name(s.snapshot.stageSeq), to: name(v.to), comment: blank(comment), userId });
  return r;
}

/** Cancel — the report and its history stay, marked cancelled. */
export async function cancelReport(db, { projectId, reportId, comment, userId }) {
  const s = await snapshotOf(db, { projectId, reportId });
  allow(wf.checkCancel(s.snapshot, userId, comment));
  await db.query(
    `INSERT INTO report_decision (project_id, report_id, stage_seq, action, version_no, user_id, comment)
     VALUES ($1,$2,$3,'cancelled',$4,$5,$6)`, [projectId, reportId, s.snapshot.stageSeq, s.snapshot.versionNo, userId, blank(comment)]);
  const { rows: [r] } = await db.query("UPDATE report SET status = 'cancelled' WHERE id = $1 RETURNING *", [reportId]);
  await LOG(db, projectId, s.report, "cancelled", { comment: blank(comment), userId });
  return r;
}

/** Send to one or more project members at once; they may then read it. */
export async function sendReport(db, { projectId, reportId, userIds = [], note = null, userId }) {
  const s = await snapshotOf(db, { projectId, reportId });
  if (!wf.canView(s.snapshot.stages, userId, s.recipients)) throw forbidden("شما به این گزارش دسترسی ندارید.");
  const ids = [...new Set(userIds)].filter((x) => x && x !== userId);
  if (!ids.length) throw bad("دست‌کم یک گیرنده انتخاب کنید.");
  const { rows: members } = await db.query(
    "SELECT user_id FROM project_member WHERE project_id = $1 AND user_id = ANY($2::uuid[])", [projectId, ids]);
  if (members.length !== ids.length) throw bad("همهٔ گیرنده‌ها باید عضو پروژه باشند.");
  for (const id of ids) {
    await db.query(
      "INSERT INTO report_recipient (project_id, report_id, user_id, sent_by, stage_seq, note) VALUES ($1,$2,$3,$4,$5,$6)",
      [projectId, reportId, id, userId, s.snapshot.stageSeq, blank(note)]);
  }
  await LOG(db, projectId, s.report, "sent", { comment: `${ids.length} گیرنده`, userId });
  return ids.length;
}

/**
 * One report as `userId` may see it: content, what they may do now, the
 * signature boxes, versions and decisions. Refused to anyone not in its
 * workflow and not sent it.
 */
export async function reportView(db, { projectId, reportId, userId }) {
  const s = await snapshotOf(db, { projectId, reportId });
  if (!wf.canView(s.snapshot.stages, userId, s.recipients)) throw forbidden("شما به این گزارش دسترسی ندارید.");
  const { rows: versions } = await db.query(
    `SELECT v.version_no, v.stage_seq, v.content_hash, v.edited_at, u.display_name AS edited_by
       FROM report_version v LEFT JOIN app_user u ON u.id = v.edited_by WHERE v.report_id = $1 ORDER BY v.version_no`, [reportId]);
  const { rows: names } = await db.query(
    "SELECT id, display_name, email FROM app_user WHERE id = ANY($1::uuid[])",
    [[...new Set(s.snapshot.signatures.flatMap((x) => [x.userId, x.onBehalfOf]).concat(s.snapshot.decisions.map((d) => d.userId)).filter(Boolean))]]);
  const who = new Map(names.map((n) => [n.id, n.display_name || n.email || null]));
  const at = (t) => new Date(Number(t / 1000n)).toISOString();
  const can = (v) => v.ok;
  const snap = s.snapshot;
  return {
    report: { ...s.report, created_t: undefined, status_fa: STATUS_FA[s.report.status],
      stage_name: snap.stages.find((x) => x.seq === snap.stageSeq)?.name || null },
    content: s.content, versionNo: snap.versionNo, contentHash: s.contentHash,
    record: s.report.status === "approved" ? { versionNo: s.report.approved_version, hash: s.report.approved_hash } : null,
    may: {
      edit: can(wf.checkEdit(snap, userId, {})),
      // why not, when the user works at the stage but the content is signed: the page says it is view-only
      editWhy: can(wf.checkEdit(snap, userId, {})) ? null : wf.checkEdit(snap, userId, {}).reason,
      // the groups the user can sign for now (several when they sit in more than one)
      signFor: wf.groupsOf(snap.stages, userId, snap.stageSeq).filter((g) => can(wf.checkSign(snap, userId, g.groupId))).map((g) => g.groupId),
      withdraw: can(wf.checkWithdraw(snap, userId)) || wf.signaturesAt(snap, snap.stageSeq).filter((x) => x.userId === userId).length > 1,
      approve: can(wf.checkApprove(snap, userId)), return: can(wf.checkReturn(snap, userId, "-")),
      cancel: can(wf.checkCancel(snap, userId, "-")),
    },
    signatureBoxes: wf.signatureBoxes(snap).map((st) => ({ ...st, groups: st.groups.map((g) => ({ ...g,
      signatures: g.signatures.map((x) => ({ userId: x.userId, name: who.get(x.userId) || null, versionNo: x.versionNo, current: x.current,
        signatureId: x.signatureId, at: at(x.t), onBehalfOf: x.onBehalfOf ? (who.get(x.onBehalfOf) || "—") : null })) })) })),
    versions,
    decisions: snap.decisions.map((d) => ({ stageSeq: d.stageSeq, action: d.action, versionNo: d.versionNo, by: who.get(d.userId) || null, comment: d.comment, at: at(d.t) })),
  };
}

/** The content of one version, for comparing or printing an earlier state. */
export async function reportVersion(db, { projectId, reportId, versionNo, userId }) {
  const s = await snapshotOf(db, { projectId, reportId });
  if (!wf.canView(s.snapshot.stages, userId, s.recipients)) throw forbidden("شما به این گزارش دسترسی ندارید.");
  const { rows: [v] } = await db.query(
    "SELECT version_no, stage_seq, content, content_hash, edited_by, edited_at FROM report_version WHERE report_id = $1 AND version_no = $2",
    [reportId, versionNo]);
  if (!v) throw notFound("version");
  return v;
}

/** The reports of a type that `userId` may see, newest first. */
export async function listReports(db, { projectId, reportTypeId, userId }) {
  const stages = await workflowOf(db, { projectId, reportTypeId });
  const inWorkflow = wf.canView(stages, userId);
  const { rows } = await db.query(
    `SELECT r.id, r.report_no, r.report_date, r.title, r.status, r.stage_seq, s.name AS stage_name,
            (SELECT max(version_no) FROM report_version v WHERE v.report_id = r.id) AS version_no
       FROM report r LEFT JOIN report_stage s ON s.report_type_id = r.report_type_id AND s.seq = r.stage_seq
      WHERE r.project_id = $1 AND r.report_type_id = $2
        AND ($3 OR EXISTS (SELECT 1 FROM report_recipient x WHERE x.report_id = r.id AND x.user_id = $4))
      ORDER BY r.report_date DESC, r.report_no DESC`, [projectId, reportTypeId, inWorkflow, userId]);
  return rows.map((r) => ({ ...r, status_fa: STATUS_FA[r.status] }));
}
