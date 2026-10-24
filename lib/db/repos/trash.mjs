/**
 * The project's trash (migration 089): what lib/db/repos/removal.mjs
 * deletes is kept here for TRASH_DAYS, and can be put back.
 *
 * An item holds the rows the record was — itself, then the rows it owned —
 * as they stood. A restore inserts them again under the same ids, so
 * whatever pointed at them by id before (nothing, or removal would have
 * refused) and whatever they point at line up again; if what they pointed
 * at is gone meanwhile, or another row has taken their number, the restore
 * is refused with the reason and the item stays.
 *
 * Call inside `withProject`: RLS keeps every item to its project.
 */
export const TRASH_DAYS = 30;

const bad = (m, status = 400, code = "INVALID_INPUT") => Object.assign(new Error(m), { status, code });
const notFound = () => bad("این مورد در سطل بازیافت نیست.", 404, "NOT_FOUND");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// the columns a person recognises a row by, in the order they are tried
const LABEL_KEYS = ["code", "doc_no", "joint_no", "weld_no", "number", "title", "name", "full_name", "description"];
const labelOf = (row) => {
  const parts = LABEL_KEYS.map((k) => row[k]).filter((v) => v != null && String(v).trim()).map(String);
  return parts.slice(0, 2).join(" — ").slice(0, 200) || null;
};

/** The column of `child` that points at `parent` (one, single-column), from the catalogue. */
async function ownerColumn(db, child, parent) {
  const { rows } = await db.query(
    `SELECT a.attname AS col FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.conrelid = $1::regclass AND c.confrelid = $2::regclass AND cardinality(c.conkey) = 1`, [child, parent]);
  if (rows.length !== 1) throw new Error(`${child} → ${parent}: expected one reference, found ${rows.length}`);
  return rows[0].col;
}

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

/**
 * Keep a record about to be deleted: its row, then the rows of its `owned`
 * tables that point at it. Returns the trash item. Called by removeRecord,
 * in the same transaction as the DELETE.
 */
export async function toTrash(db, { projectId = null, entity, table, owned = [], id, userId = null }) {
  const { rows: [self] } = await db.query(`SELECT to_jsonb(t) AS row FROM ${quote(table)} t WHERE id = $1`, [id]);
  if (!self) throw bad("رکورد پیدا نشد.", 404, "NOT_FOUND");
  const rows = [{ table, row: self.row }];
  for (const child of owned) {
    const col = await ownerColumn(db, child, table);
    const { rows: kids } = await db.query(`SELECT to_jsonb(t) AS row FROM ${quote(child)} t WHERE ${quote(col)} = $1 ORDER BY t.id`, [id]);
    for (const k of kids) rows.push({ table: child, row: k.row });
  }
  const { rows: [item] } = await db.query(
    `INSERT INTO trash_item (project_id, entity, record_id, label, rows, deleted_by)
     VALUES (COALESCE($1::uuid, current_project_id()), $2, $3, $4, $5, $6) RETURNING *`,
    [projectId, entity, id, labelOf(self.row), JSON.stringify(rows), userId]);
  return item;
}

/** Items older than TRASH_DAYS leave the trash for good. */
export async function purgeExpired(db, { now = null } = {}) {
  const { rowCount } = await db.query(
    `DELETE FROM trash_item WHERE deleted_at < COALESCE($1::timestamptz, clock_timestamp()) - make_interval(days => $2)`, [now, TRASH_DAYS]);
  return rowCount;
}

/** What is in the trash, newest first, each with the day it goes for good. Expired items are let go first. */
export async function listTrash(db, { now = null } = {}) {
  await purgeExpired(db, { now });
  const { rows } = await db.query(
    `SELECT t.id, t.entity, t.record_id, t.label, t.deleted_at, u.display_name AS deleted_by_name,
            jsonb_array_length(t.rows) - 1 AS owned_rows,
            (t.deleted_at + make_interval(days => $1)) AS expires_at
       FROM trash_item t LEFT JOIN app_user u ON u.id = t.deleted_by
      ORDER BY t.deleted_at DESC`, [TRASH_DAYS]);
  return rows;
}

export async function trashItem(db, { id }) {
  if (!UUID.test(String(id || ""))) throw bad("شناسهٔ مورد معتبر نیست.");
  const { rows: [item] } = await db.query("SELECT * FROM trash_item WHERE id = $1", [id]);
  if (!item) throw notFound();
  return item;
}

/** The columns a row can be inserted with: every stored, non-generated column the saved row names. */
async function insertable(db, table, row) {
  const { rows } = await db.query(
    `SELECT attname FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = ''
      ORDER BY attnum`, [table]);
  return rows.map((r) => r.attname).filter((c) => Object.hasOwn(row, c));
}

/**
 * Put a record back, under its own ids, and take it out of the trash. A
 * restore that cannot be done whole is not done at all: the reason comes
 * back and the item stays.
 */
export async function restoreItem(db, { id }) {
  const item = await trashItem(db, { id });
  const put = async (tx) => {
    for (const { table, row } of item.rows) {
      const cols = await insertable(tx, table, row);
      const list = cols.map(quote).join(", ");
      try {
        await tx.query(`INSERT INTO ${quote(table)} (${list}) SELECT ${list} FROM jsonb_populate_record(NULL::${quote(table)}, $1)`, [JSON.stringify(row)]);
      } catch (e) {
        if (e.code === "23505") throw bad("بازگردانی نشد: رکورد دیگری با همین شماره/کد یا همین شناسه از آن پس ثبت شده است.", 409, "CONFLICT");
        if (e.code === "23503") throw bad("بازگردانی نشد: رکوردی که به آن وابسته بود (مثلاً پیمانکار یا قرارداد آن) دیگر نیست.", 409, "CONFLICT");
        if (e.code === "23514" || e.code === "23502") throw bad(`بازگردانی نشد: با قواعد فعلی جدول سازگار نیست (${e.message}).`, 409, "CONFLICT");
        throw e;
      }
    }
    await tx.query("DELETE FROM trash_item WHERE id = $1", [item.id]);
    return { entity: item.entity, id: item.record_id };
  };
  return db.inTransaction || !db.transaction ? put(db) : db.transaction(put);
}

/** Let an item go now, before its 30 days. */
export async function purgeItem(db, { id }) {
  const item = await trashItem(db, { id });
  await db.query("DELETE FROM trash_item WHERE id = $1", [item.id]);
  return { entity: item.entity, id: item.record_id };
}
