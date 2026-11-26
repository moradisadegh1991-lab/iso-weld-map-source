import { validCalendarDate, shiftMinutes } from "../../eps/calendar.mjs";

const bad = (message) => Object.assign(new Error(message), { status: 400, code: "INVALID_INPUT" });
const missing = () => Object.assign(new Error("تقویم پیدا نشد."), { status: 404, code: "NOT_FOUND" });

export async function listCalendars(db, { projectId, contractId }) {
  return (await db.query(
    "SELECT * FROM contract_calendar WHERE contract_id = $1 AND project_id = $2 ORDER BY is_default DESC, name, id",
    [contractId, projectId])).rows;
}

export async function calendarById(db, { projectId, contractId, calendarId }) {
  if (!calendarId) return null;
  if (typeof calendarId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(calendarId)) throw bad("شناسهٔ تقویم نامعتبر است.");
  const { rows: [row] } = await db.query(
    "SELECT * FROM contract_calendar WHERE id = $1 AND contract_id = $2 AND project_id = $3", [calendarId, contractId, projectId]);
  if (!row) throw bad("تقویم باید از همین قرارداد انتخاب شود.");
  return row;
}

export function defaultCalendar(calendars) {
  return calendars.find((c) => c.is_default) ?? null;
}

export async function saveCalendar(db, { projectId, contractId, id = null, name, weekdays, exceptions = {}, shifts, isDefault = false }) {
  const title = typeof name === "string" ? name.trim() : "";
  if (!title || title.length > 80) throw bad("نام تقویم باید ۱ تا ۸۰ نویسه باشد.");
  if (!Array.isArray(weekdays) || !weekdays.length || !weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) throw bad("حداقل یک روز کاری هفته را انتخاب کنید.");
  if (!exceptions || typeof exceptions !== "object" || Array.isArray(exceptions)) throw bad("استثناهای تقویم نامعتبرند.");
  const extra = Object.entries(exceptions);
  if (extra.length > 3660 || extra.some(([date, state]) => !validCalendarDate(date) || typeof state !== "boolean")) throw bad("تاریخ یا وضعیت استثنای تقویم نامعتبر است.");
  if (shifts !== undefined && (!shifts || typeof shifts !== "object" || Array.isArray(shifts) ||
    Object.entries(shifts).some(([key,periods]) => !(/^[0-6]$/.test(key) || validCalendarDate(key)) || shiftMinutes(periods) == null))) {
    throw bad("بازه‌های هر شیفت باید به ترتیب زمان، بدون تداخل و در یک روز باشند.");
  }
  const write = async (tx) => {
    const { rows: [contract] } = await tx.query("SELECT id FROM contract WHERE id = $1 AND project_id = $2 FOR NO KEY UPDATE", [contractId, projectId]);
    if (!contract) throw missing();
    const current = await listCalendars(tx, { projectId, contractId });
    const old = current.find((c) => c.id === id);
    if (id && !old) throw missing();
    if (current.some((c) => c.id !== id && c.name === title)) throw bad("نام تقویم در این قرارداد تکراری است.");
    const makeDefault = isDefault === true || !!old?.is_default || !current.length;
    if (makeDefault && !old?.is_default) {
      const previous = defaultCalendar(current);
      if (previous) {
        await tx.query("UPDATE eps_pms SET calendar_id = $2 WHERE contract_id = $1 AND calendar_id IS NULL", [contractId, previous.id]);
        await tx.query("UPDATE contract_calendar SET is_default = false WHERE id = $1", [previous.id]);
      }
    }
    const values = [title, [...new Set(weekdays)].sort(), JSON.stringify(exceptions), makeDefault];
    const result = id
      ? await tx.query("UPDATE contract_calendar SET name=$2, weekdays=$3, exceptions=$4, is_default=$5 WHERE id=$1 RETURNING *", [id, ...values])
      : await tx.query("INSERT INTO contract_calendar (project_id,contract_id,name,weekdays,exceptions,is_default) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [projectId, contractId, ...values]);
    if (shifts !== undefined) {
      await tx.query("UPDATE contract_calendar SET shifts=$2 WHERE id=$1",[result.rows[0].id, JSON.stringify(shifts)]);
      result.rows[0].shifts=shifts;
    }
    return result.rows[0];
  };
  return db.inTransaction || !db.transaction ? write(db) : db.transaction(write);
}

export async function removeCalendar(db, { projectId, contractId, id }) {
  const remove = async (tx) => {
    const { rows: [contract] } = await tx.query("SELECT id FROM contract WHERE id=$1 AND project_id=$2 FOR NO KEY UPDATE", [contractId, projectId]);
    if (!contract) throw missing();
    const calendar = await calendarById(tx, { projectId, contractId, calendarId: id });
    if (!calendar) throw missing();
    if (calendar.is_default) throw bad("ابتدا تقویم دیگری را پیش‌فرض کنید.");
    const { rows: [used] } = await tx.query(
      `SELECT EXISTS (SELECT 1 FROM eps_pms WHERE calendar_id=$1
        UNION ALL SELECT 1 FROM eps_version WHERE calendar_id=$1
        UNION ALL SELECT 1 FROM wbs_activity WHERE calendar_id=$1
        UNION ALL SELECT 1 FROM activity_plan WHERE calendar_id=$1
        UNION ALL SELECT 1 FROM activity_role WHERE calendar_id=$1) AS found`, [id]);
    if (used.found) throw bad("این تقویم در برنامه یا منابع استفاده می‌شود.");
    await tx.query("DELETE FROM contract_calendar WHERE id=$1 AND project_id=$2 AND contract_id=$3", [id, projectId, contractId]);
    return { id };
  };
  return db.inTransaction || !db.transaction ? remove(db) : db.transaction(remove);
}
