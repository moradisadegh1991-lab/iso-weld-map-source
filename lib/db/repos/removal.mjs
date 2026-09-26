/**
 * Deleting a record — only one nothing else stands on.
 *
 * Most of what the platform holds is evidence: a signed test, an issued
 * permit, a revision, a receipt. Those are never deleted; they are revised,
 * revoked or closed, and their own tables refuse a DELETE. What can go is a
 * register row entered by mistake — a contractor, a person, a guarantee —
 * and only while no other row points at it. Many of those references are
 * declared ON DELETE CASCADE or SET NULL for good reasons elsewhere, so
 * letting the database follow them here would quietly erase or orphan
 * evidence: the references are counted first, from the catalogue (so a
 * table added later is covered without touching this file), and any one of
 * them refuses the delete and says where the record is used.
 *
 * ENTITIES is the whole list of what can be deleted, with the action a
 * person needs and any state the row must be in (a performance test only
 * before it is signed). `owned` names child tables that are part of the
 * record itself (a draft JSA's steps) and go with it.
 *
 * Call inside `withProject`: RLS keeps the count and the delete to the
 * project.
 */
import { ACTIONS } from "../../authz.mjs";

export const ENTITIES = {
  contractor: { table: "contractor", need: ACTIONS.MANAGE_MEMBERS, title: "پیمانکار" },
  "contract-package": { table: "contract_package", need: ACTIONS.MANAGE_MEMBERS, title: "پکیج کاری" },
  "hse-person": { table: "hse_person", need: ACTIONS.RECORD_HSE, title: "فرد" },
  "hse-equipment": { table: "hse_equipment", need: ACTIONS.RECORD_HSE, title: "داربست / جرثقیل" },
  "hse-jsa": { table: "hse_jsa", need: ACTIONS.RECORD_HSE, title: "JSA", owned: ["hse_jsa_step"],
    state: { sql: "status = 'draft'", why: "JSA تأییدشده حذف نمی‌شود؛ رویژن جدید بزنید" } },
  "precom-template": { table: "precom_template", need: ACTIONS.SIGN_MC, title: "چک‌لیست / روال" },
  guarantee: { table: "performance_guarantee", need: ACTIONS.SIGN_MC, title: "تضمین عملکرد" },
  "perf-test": { table: "performance_test", need: ACTIONS.RECORD_COMPLETIONS, title: "آزمون عملکرد", owned: ["performance_result"],
    state: { sql: "signed_at IS NULL", why: "آزمون امضاشده ثابت است؛ آزمون مجدد، آزمون جدیدی است" } },
  "control-account": { table: "control_account", need: ACTIONS.MANAGE_CONTROLS, title: "حساب کنترلی" },
  "mdr-document": { table: "mdr_document", need: ACTIONS.CONTROL_DOCUMENTS, title: "مدرک" },
  "coating-system": { table: "coating_system", need: ACTIONS.EDIT_EXTRACTION, title: "سیستم رنگ" },
  "weld-joint": { table: "weld_joint", need: ACTIONS.EDIT_EXTRACTION, title: "جوش" },
};

// Where a record is used, in words — a table name is the schema, not an answer.
export const USED_IN = {
  contract_package: "پکیج کاری", control_account: "حساب کنترلی", hse_manhours: "نفرساعت", hse_incident: "رویداد HSE",
  hse_permit: "مجوز کار", hse_observation: "مشاهدهٔ ایمنی", hse_person: "فرد HSE", hse_competence: "کارت صلاحیت",
  hse_equipment: "داربست / جرثقیل", hse_equipment_inspection: "بازرسی داربست / جرثقیل", hse_jsa: "JSA", hse_jsa_step: "گام JSA",
  hse_permit_crew: "خدمهٔ مجوز", punch_item: "Punch", ncr: "NCR", cable: "کابل", instrument: "ابزار", foundation_spec: "فونداسیون",
  structure_spec: "سازه", coating_item: "آیتم رنگ", coating_record: "رکورد رنگ", spool_activity: "فعالیت اسپول", pipe_support: "ساپورت",
  material_lot: "لات کالا", material_movement: "تراکنش انبار", material_requirement: "نیاز MTO", material_reservation: "رزرو",
  stock_count_line: "انبارگردانی", po_line: "ردیف PO", purchase_order: "PO", vendor_document: "مدرک فروشنده", bid: "پیشنهاد",
  mr_award: "واگذاری", mdr_revision: "رویژن مدرک", transmittal_item: "ترانسمیتال", doc_reply: "پاسخ مدرک", doc_review: "بررسی مدرک",
  precom_attempt: "ثبت چک‌لیست", performance_result: "نتیجهٔ آزمون عملکرد", control_baseline_point: "خط مبنا",
  control_baseline_revision: "رویژن خط مبنا", control_progress: "پیشرفت", cost_entry: "هزینه", control_risk: "ریسک",
  ev_snapshot: "اسنپ‌شات EV", welder_qualification: "صلاحیت جوشکار", weld_execution: "اجرای جوش", joint_ndt_record: "NDT",
  joint_ndt_selection: "انتخاب NDT", joint_progressive_draw: "نمونه‌گیری", spare_part: "قطعهٔ یدکی", tag: "تگ",
  tag_activity: "فعالیت تجهیز", cable_activity: "فعالیت کابل", instrument_activity: "فعالیت ابزار", coating_activity: "فعالیت رنگ",
  concrete_pour: "بتن‌ریزی", mr_line: "ردیف درخواست خرید", doc_comment: "کامنت مدرک", ndt_progressive_draw: "نمونه‌گیری NDT",
  weld_joint: "جوش سازه / تجهیز",
};

export async function dependents(db, table, id, owned = []) {
  const { rows: fks } = await db.query(
    `SELECT c.conrelid::regclass::text AS tbl, quote_ident(a.attname) AS col
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = $1::regclass AND cardinality(c.conkey) = 1
      ORDER BY 1, 2`, [table]);
  const found = [];
  for (const { tbl, col } of fks) {
    if (owned.includes(tbl)) continue;
    // Both names come from the catalogue, quoted by Postgres itself.
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${tbl} WHERE ${col} = $1`, [id]);
    if (rows[0].n) found.push({ table: tbl, n: rows[0].n });
  }
  return found;
}

/**
 * Why this record cannot be deleted, in one sentence — or null when it can.
 * Its state first (a signed record is never deleted, whatever points at
 * it), then every place it is used.
 */
// Own keys only: «constructor» or «__proto__» from a request are not kinds of record.
export const entityOf = (entity) => (typeof entity === "string" && Object.hasOwn(ENTITIES, entity) ? ENTITIES[entity] : null);

export async function removalBlocker(db, { entity, id }) {
  const e = entityOf(entity);
  if (!e) throw bad("این نوع رکورد حذف‌شدنی نیست.");
  if (!UUID.test(String(id || ""))) throw bad("شناسهٔ رکورد معتبر نیست.");
  const { rows } = await db.query(`SELECT ${e.state ? `(${e.state.sql})` : "true"} AS ok FROM ${e.table} WHERE id = $1`, [id]);
  if (!rows.length) throw Object.assign(new Error("رکورد پیدا نشد."), { status: 404, code: "NOT_FOUND" });
  if (!rows[0].ok) return `${e.title} حذف نمی‌شود: ${e.state.why}.`;
  const used = await dependents(db, e.table, id, e.owned);
  if (used.length) return `${e.title} حذف نمی‌شود؛ به آن ارجاع هست: ${used.map((d) => `${d.n} ${USED_IN[d.table] || "رکورد دیگر"}`).join("، ")}.`;
  return null;
}

export async function removeRecord(db, { entity, id }) {
  const e = entityOf(entity);
  const why = await removalBlocker(db, { entity, id });
  if (why) throw Object.assign(new Error(why), { status: 409, code: "IN_USE" });
  const { rowCount } = await db.query(`DELETE FROM ${e.table} WHERE id = $1`, [id]);
  if (!rowCount) throw Object.assign(new Error("رکورد پیدا نشد."), { status: 404, code: "NOT_FOUND" });
  return { entity, id };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
