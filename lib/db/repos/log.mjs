/**
 * One log per section of the project: every step a record took through its
 * workflow, who took it, and every comment on it.
 *
 * Two sources, read as one list:
 *  - workflow_event: the steps of the modules that keep no signature
 *    columns of their own (contracts, statements, payments, HR) and every
 *    comment anyone writes on any record;
 *  - the signatures the older sections already keep in their own tables
 *    (MC signed_by/accepted_by, a punch's raised/cleared/closed, an IR…),
 *    read in place. Copying them into a second table would give two answers
 *    to "who signed this"; reading them cannot disagree with the record.
 *
 * Call inside `withProject`.
 */

export const SECTION_FA = {
  project: "پروژه", equipment: "تجهیزات", documents: "مدارک", procurement: "خرید و انبار",
  civil: "سیویل و سازه", quality: "کیفیت و بازرسی", piping: "پایپینگ", hse: "HSE",
  completions: "تکمیل و راه‌اندازی", coating: "رنگ و عایق", ei: "برق و ابزار دقیق",
  handover: "تحویل به نگهداری", controls: "کنترل پروژه", contracts: "قراردادها و پیمان‌ها",
  finance: "مالی", hr: "منابع انسانی",
};

export const ACTION_FA = {
  created: "ایجاد", updated: "ویرایش", submitted: "ارسال", verified: "تأیید فنی", approved: "تأیید",
  returned: "برگشت", signed: "امضا", accepted: "پذیرش", paid: "پرداخت", closed: "بستن", commented: "کامنت",
  raised: "ثبت", cleared: "رفع", recorded: "ثبت", issued: "صدور", sent: "ارسال", received: "دریافت",
  replied: "پاسخ", cancelled: "لغو", awarded: "واگذاری", measured: "اندازه‌گیری", imported: "ورود فایل",
};

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });

/** Record one step. `section` is a key of SECTION_FA. */
export async function logEvent(db, { projectId, section, entityType, entityId = null, label, action,
  from = null, to = null, comment = null, userId = null }) {
  if (!SECTION_FA[section]) throw bad(`بخش «${section}» شناخته نشد.`);
  const { rows: [e] } = await db.query(
    `INSERT INTO workflow_event (project_id, section, entity_type, entity_id, entity_label, action, from_state, to_state, comment, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [projectId, section, entityType, entityId, label, action, from, to, comment || null, userId]);
  return e;
}

/** A comment on any record, in its section's log. */
export async function addComment(db, { projectId, section, entityType, entityId = null, label, comment, userId }) {
  if (!String(comment || "").trim()) throw bad("متن کامنت خالی است.");
  return logEvent(db, { projectId, section, entityType, entityId, label, action: "commented", comment: String(comment).trim(), userId });
}

/**
 * Signatures the sections keep in their own tables, as log rows. Each entry:
 * [section, SQL selecting (at, user_id, action, entity_type, entity_label, comment)].
 * Only rows with a person and a time: a step nobody signed is not a log line.
 */
const u = (by, at, action, type, label, comment = "NULL") =>
  `SELECT ${at}::timestamptz AS at, ${by} AS user_id, '${action}'::text AS action, '${type}'::text AS entity_type, (${label})::text AS entity_label, (${comment})::text AS comment`;
const DERIVED = [
  ["piping", `${u("r.approved_by", "r.approved_at", "approved", "register", "'رجیستر جوش ' || d.doc_no || ' Rev.' || d.revision")}
     FROM extraction_run r JOIN document d ON d.id = r.document_id WHERE r.project_id = $1 AND r.approved_by IS NOT NULL`],
  ["piping", `${u("a.recorded_by", "a.recorded_at", "recorded", "spool", "'اسپول ' || s.spool_no || ' — ' || a.code", "a.ref_no")}
     FROM spool_activity a JOIN spool s ON s.id = a.spool_id WHERE a.project_id = $1 AND a.recorded_by IS NOT NULL`],
  ["piping", `${u("e.created_by", "e.created_at", "recorded", "weld", "'جوشکاری ' || e.weld_uid")}
     FROM weld_execution e WHERE e.project_id = $1 AND e.created_by IS NOT NULL`],
  ["piping", `${u("n.created_by", "n.created_at", "recorded", "ndt", "'NDT ' || n.report_no || ' — ' || n.result::text")}
     FROM ndt_record n WHERE n.project_id = $1 AND n.created_by IS NOT NULL`],
  ["equipment", `${u("a.recorded_by", "a.recorded_at", "recorded", "tag", "t.tag_no || ' — ' || a.code", "a.ref_no")}
     FROM tag_activity a JOIN tag t ON t.id = a.tag_id WHERE a.project_id = $1 AND a.recorded_by IS NOT NULL AND t.kind <> 'foundation' AND t.kind <> 'structure'`],
  ["civil", `${u("a.recorded_by", "a.recorded_at", "recorded", "tag", "t.tag_no || ' — ' || a.code", "a.ref_no")}
     FROM tag_activity a JOIN tag t ON t.id = a.tag_id WHERE a.project_id = $1 AND a.recorded_by IS NOT NULL AND t.kind IN ('foundation', 'structure')`],
  ["civil", `${u("p.recorded_by", "p.created_at", "recorded", "pour", "'بتن‌ریزی ' || p.pour_no")}
     FROM concrete_pour p WHERE p.project_id = $1 AND p.recorded_by IS NOT NULL`],
  ["ei", `${u("a.recorded_by", "a.recorded_at", "recorded", "cable", "'کابل ' || c.cable_no || ' — ' || a.code", "a.ref_no")}
     FROM cable_activity a JOIN cable c ON c.id = a.cable_id WHERE a.project_id = $1 AND a.recorded_by IS NOT NULL`],
  ["ei", `${u("a.recorded_by", "a.recorded_at", "recorded", "instrument", "'ابزار ' || i.tag_no || ' — ' || a.code", "a.ref_no")}
     FROM instrument_activity a JOIN instrument i ON i.id = a.instrument_id WHERE a.project_id = $1 AND a.recorded_by IS NOT NULL`],
  ["ei", `${u("l.recorded_by", "l.created_at", "recorded", "loop", "'لوپ چک ' || l.loop_no", "l.ref_no")}
     FROM loop_check l WHERE l.project_id = $1 AND l.recorded_by IS NOT NULL`],
  ["coating", `${u("r.recorded_by", "r.created_at", "recorded", "coating", "'رنگ — لایهٔ ' || r.coat_no")}
     FROM coating_record r WHERE r.project_id = $1 AND r.recorded_by IS NOT NULL`],
  ["quality", `${u("i.prepared_by", "i.created_at", "created", "itp", "'ITP ' || i.itp_no")} FROM itp i WHERE i.project_id = $1 AND i.prepared_by IS NOT NULL`],
  ["quality", `${u("i.approved_by", "i.approved_on", "approved", "itp", "'ITP ' || i.itp_no")} FROM itp i WHERE i.project_id = $1 AND i.approved_by IS NOT NULL`],
  ["quality", `${u("r.raised_by", "r.raised_at", "raised", "ir", "'درخواست بازرسی ' || r.ir_no", "r.note")} FROM inspection_request r WHERE r.project_id = $1 AND r.raised_by IS NOT NULL`],
  ["quality", `${u("r.cancelled_by", "r.cancelled_at", "cancelled", "ir", "'درخواست بازرسی ' || r.ir_no", "r.cancel_reason")} FROM inspection_request r WHERE r.project_id = $1 AND r.cancelled_by IS NOT NULL`],
  ["quality", `${u("p.raised_by", "p.raised_on", "raised", "punch", "'پانچ ' || p.punch_no")} FROM punch_item p WHERE p.project_id = $1 AND p.raised_by IS NOT NULL`],
  ["quality", `${u("p.cleared_by", "p.cleared_on", "cleared", "punch", "'پانچ ' || p.punch_no", "p.clear_note")} FROM punch_item p WHERE p.project_id = $1 AND p.cleared_by IS NOT NULL`],
  ["quality", `${u("p.closed_by", "p.closed_on", "closed", "punch", "'پانچ ' || p.punch_no")} FROM punch_item p WHERE p.project_id = $1 AND p.closed_by IS NOT NULL`],
  ["quality", `${u("n.raised_by", "n.raised_on", "raised", "ncr", "'NCR ' || n.ncr_no")} FROM ncr n WHERE n.project_id = $1 AND n.raised_by IS NOT NULL`],
  ["quality", `${u("n.approved_by", "n.approved_on", "approved", "ncr", "'NCR ' || n.ncr_no", "n.disposition_note")} FROM ncr n WHERE n.project_id = $1 AND n.approved_by IS NOT NULL`],
  ["quality", `${u("n.closed_by", "n.closed_on", "closed", "ncr", "'NCR ' || n.ncr_no")} FROM ncr n WHERE n.project_id = $1 AND n.closed_by IS NOT NULL`],
  ["completions", `${u("t.recorded_by", "t.created_at", "recorded", "test", "'تست فشار ' || tp.pack_no")} FROM test_record t JOIN test_package tp ON tp.id = t.package_id WHERE t.project_id = $1 AND t.recorded_by IS NOT NULL`],
  ["completions", `${u("t.accepted_by", "t.accepted_at", "accepted", "test", "'تست فشار ' || tp.pack_no")} FROM test_record t JOIN test_package tp ON tp.id = t.package_id WHERE t.project_id = $1 AND t.accepted_by IS NOT NULL`],
  ...[["mc_certificate", "MC"], ["rfc_certificate", "RFC"], ["rfsu_certificate", "RFSU"]].flatMap(([tb, n]) => [
    ["completions", `${u("c.signed_by", "c.signed_at", "signed", n.toLowerCase(), `'${n} ' || s.code`)} FROM ${tb} c JOIN subsystem s ON s.id = c.subsystem_id WHERE c.project_id = $1 AND c.signed_by IS NOT NULL`],
    ["completions", `${u("c.accepted_by", "c.accepted_at", "accepted", n.toLowerCase(), `'${n} ' || s.code`)} FROM ${tb} c JOIN subsystem s ON s.id = c.subsystem_id WHERE c.project_id = $1 AND c.accepted_by IS NOT NULL`],
  ]),
  ["completions", `${u("a.performed_by", "a.created_at", "recorded", "precom", "'چک‌لیست پیش‌راه‌اندازی'", "a.note")} FROM precom_attempt a WHERE a.project_id = $1 AND a.performed_by IS NOT NULL`],
  ["completions", `${u("a.accepted_by", "a.accepted_at", "accepted", "precom", "'چک‌لیست پیش‌راه‌اندازی'")} FROM precom_attempt a WHERE a.project_id = $1 AND a.accepted_by IS NOT NULL`],
  ["completions", `${u("p.signed_by", "p.signed_at", "signed", "performance", "'آزمون عملکرد ' || p.test_no")} FROM performance_test p WHERE p.project_id = $1 AND p.signed_by IS NOT NULL`],
  ["completions", `${u("p.accepted_by", "p.accepted_at", "accepted", "performance", "'آزمون عملکرد ' || p.test_no")} FROM performance_test p WHERE p.project_id = $1 AND p.accepted_by IS NOT NULL`],
  ["documents", `${u("t.sent_by", "t.created_at", "sent", "transmittal", "'ترانسمیتال ' || t.transmittal_no")} FROM transmittal t WHERE t.project_id = $1 AND t.sent_by IS NOT NULL`],
  ["documents", `${u("t.received_by", "t.received_on", "received", "transmittal", "'ترانسمیتال ' || t.transmittal_no")} FROM transmittal t WHERE t.project_id = $1 AND t.received_by IS NOT NULL`],
  ["documents", `${u("c.raised_by", "c.raised_at", "commented", "doc_comment", "'کامنت مدرک'", "c.text")} FROM doc_comment c WHERE c.project_id = $1 AND c.raised_by IS NOT NULL`],
  ["documents", `${u("c.designer_replied_by", "c.designer_replied_at", "replied", "doc_comment", "'پاسخ طراح به کامنت'", "c.designer_reply")} FROM doc_comment c WHERE c.project_id = $1 AND c.designer_replied_by IS NOT NULL`],
  ["documents", `${u("c.closed_by", "c.closed_at", "closed", "doc_comment", "'کامنت مدرک'")} FROM doc_comment c WHERE c.project_id = $1 AND c.closed_by IS NOT NULL`],
  ["documents", `${u("r.sent_by", "r.created_at", "sent", "reply", "'پاسخ ' || r.reply_no")} FROM doc_reply r WHERE r.project_id = $1 AND r.sent_by IS NOT NULL`],
  ["procurement", `${u("m.created_by", "m.created_at", "created", "mr", "'درخواست خرید ' || m.mr_no")} FROM material_requisition m WHERE m.project_id = $1 AND m.created_by IS NOT NULL`],
  ["procurement", `${u("b.tech_by", "b.tech_at", "verified", "bid", "'ارزیابی فنی پیشنهاد'", "b.tech_note")} FROM bid b WHERE b.project_id = $1 AND b.tech_by IS NOT NULL`],
  ["procurement", `${u("a.awarded_by", "a.awarded_at", "awarded", "award", "'واگذاری'")} FROM mr_award a WHERE a.project_id = $1 AND a.awarded_by IS NOT NULL`],
  ["procurement", `${u("p.created_by", "p.created_at", "issued", "po", "'سفارش خرید ' || p.po_no")} FROM purchase_order p WHERE p.project_id = $1 AND p.created_by IS NOT NULL`],
  ["procurement", `${u("f.recorded_by", "f.created_at", "recorded", "fat", "'FAT ' || COALESCE(f.irn_no, '')", "f.note")} FROM fat_record f WHERE f.project_id = $1 AND f.recorded_by IS NOT NULL`],
  ["procurement", `${u("l.recorded_by", "l.created_at", "received", "lot", "'رسید ' || l.receipt_no")} FROM material_lot l WHERE l.project_id = $1 AND l.recorded_by IS NOT NULL`],
  ["hse", `${u("p.requested_by", "p.created_at", "created", "permit", "'مجوز کار ' || p.permit_no")} FROM hse_permit p WHERE p.project_id = $1 AND p.requested_by IS NOT NULL`],
  ["hse", `${u("p.issued_by", "p.issued_at", "issued", "permit", "'مجوز کار ' || p.permit_no")} FROM hse_permit p WHERE p.project_id = $1 AND p.issued_by IS NOT NULL`],
  ["hse", `${u("p.closed_by", "p.closed_at", "closed", "permit", "'مجوز کار ' || p.permit_no")} FROM hse_permit p WHERE p.project_id = $1 AND p.closed_by IS NOT NULL`],
  ["hse", `${u("i.reported_by", "i.created_at", "raised", "incident", "'رویداد ' || i.ref_no")} FROM hse_incident i WHERE i.project_id = $1 AND i.reported_by IS NOT NULL`],
  ["hse", `${u("j.prepared_by", "j.created_at", "created", "jsa", "'JSA ' || j.jsa_no")} FROM hse_jsa j WHERE j.project_id = $1 AND j.prepared_by IS NOT NULL`],
  ["hse", `${u("j.approved_by", "j.approved_on", "approved", "jsa", "'JSA ' || j.jsa_no")} FROM hse_jsa j WHERE j.project_id = $1 AND j.approved_by IS NOT NULL`],
  ["controls", `${u("b.issued_by", "b.created_at", "issued", "baseline", "'خط مبنا ' || a.code || ' Rev.' || b.revision", "b.reason")} FROM control_baseline_revision b JOIN control_account a ON a.id = b.account_id WHERE b.project_id = $1 AND b.issued_by IS NOT NULL`],
  ["controls", `${u("c.recorded_by", "c.created_at", "recorded", "cost", "'هزینه ' || a.code || ' — ' || c.ref_no", "c.note")} FROM cost_entry c JOIN control_account a ON a.id = c.account_id WHERE c.project_id = $1 AND c.recorded_by IS NOT NULL`],
  ["project", `${u("a.decided_by", "a.decided_at", "approved", "assumption", "'فرض ' || a.code || ' — ' || a.status::text")} FROM project_assumption a WHERE a.project_id = $1 AND a.decided_by IS NOT NULL`],
  ["handover", `${u("t.prepared_by", "t.created_at", "created", "pm", "'تسک PM'")} FROM pm_task t WHERE t.project_id = $1 AND t.prepared_by IS NOT NULL`],
  ["handover", `${u("t.approved_by", "t.approved_at", "approved", "pm", "'تسک PM'")} FROM pm_task t WHERE t.project_id = $1 AND t.approved_by IS NOT NULL`],
];

/**
 * The log of one section, newest first: its steps, signatures and comments,
 * with who and when. `entityId` narrows it to one record's own trail.
 */
export async function sectionLog(db, { projectId, section, entityType = null, entityId = null, limit = 300 }) {
  if (!SECTION_FA[section]) throw bad(`بخش «${section}» شناخته نشد.`);
  const parts = [`SELECT e.at, e.user_id, e.action, e.entity_type, e.entity_label, e.comment, e.from_state, e.to_state, e.entity_id, 'log' AS source
       FROM workflow_event e WHERE e.project_id = $1 AND e.section = $2
        AND ($3::text IS NULL OR e.entity_type = $3) AND ($4::uuid IS NULL OR e.entity_id = $4)`];
  // A single record's trail comes from the log; the derived signatures are the section's timeline.
  if (!entityId) {
    for (const [s, sql] of DERIVED) if (s === section) parts.push(`SELECT x.*, NULL::text, NULL::text, NULL::uuid, 'record' FROM (${sql}) x WHERE $2 = $2 AND ($3::text IS NULL OR x.entity_type = $3)`);
  }
  const { rows } = await db.query(
    `SELECT l.*, u.display_name AS user_name, u.email AS user_email FROM (${parts.join(" UNION ALL ")}) l
       LEFT JOIN app_user u ON u.id = l.user_id
      WHERE l.at IS NOT NULL ORDER BY l.at DESC LIMIT ${Math.min(Number(limit) || 300, 2000)}`,
    [projectId, section, entityType, entityId]);
  return rows.map((r) => ({
    at: r.at, userId: r.user_id, user: r.user_name || r.user_email || "—", action: r.action, actionFa: ACTION_FA[r.action] || r.action,
    entityType: r.entity_type, entityId: r.entity_id, label: r.entity_label, comment: r.comment,
    from: r.from_state, to: r.to_state, source: r.source,
  }));
}

/** Who has signed or commented in a section, and how often — the people behind its log. */
export function peopleOf(log) {
  const m = new Map();
  for (const e of log) {
    const p = m.get(e.user) || { user: e.user, signed: 0, comments: 0, last: e.at };
    if (e.action === "commented") p.comments++; else p.signed++;
    if (e.at > p.last) p.last = e.at;
    m.set(e.user, p);
  }
  return [...m.values()].sort((a, b) => (b.signed + b.comments) - (a.signed + a.comments));
}
