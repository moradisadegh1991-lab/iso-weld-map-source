"use client";
import { usePrefs } from "../../lib/client/prefs.mjs";
import { useEpsFmt } from "./ActivityDetail";

/** The bottom panel shows only the selected activity's history, not all
 * planning rows. Derived quantities are read-only and computed server-side.
 */
export default function PlanningActivityHistory({ data, selected, loading, error }) {
  const { t } = usePrefs();
  const { fmt, day } = useEpsFmt();
  if (!selected || selected.kind !== "act") {
    return <p className="empty-note" data-plan-history-empty>برای مشاهده تاریخچه، یک فعالیت را از جدول بالا انتخاب کنید.</p>;
  }
  if (error) return <p className="err" role="alert">{error}</p>;
  if (loading || !data) return <p className="muted">{t("common.loading")}</p>;
  const fields = [
    ["versionCode", "کد نسخه"],
    ["versionTitle", "نام نسخه"],
    ["versionDescription", "شرح نسخه"],
    ["plannedStart", "شروع برنامه‌ای", "date"],
    ["plannedEnd", "پایان برنامه‌ای", "date"],
    ["plannedDays", "مدت برنامه‌ای"],
    ["actualStart", "شروع واقعی", "date"],
    ["actualEnd", "پایان واقعی", "date"],
    ["actualDays", "مدت واقعی"],
    ["plannedVolume", "حجم برنامه‌شده این دوره"],
    ["actualVolume", "حجم واقعی فعالیت"],
    ["doneBefore", "انجام‌شده قبل از برنامه"],
    ["doneToDate", "انجام‌شده تاکنون"],
    ["doneThisPeriod", "انجام‌شده این دوره"],
    ["remainingVolume", "حجم باقی‌مانده"],
    ["progressPct", "پیشرفت فعالیت (%)", "percent"],
    ["periodProgressPct", "پیشرفت این دوره (%)", "percent"],
    ["remark", "Remark"],
    ["status", "وضعیت فعالیت"],
  ];
  const display = (row, key, kind) => {
    const v = row[key];
    if (v == null || v === "") return "—";
    if (kind === "date") return day(v);
    if (kind === "percent") return fmt(v, 2);
    if (typeof v === "number") return fmt(v, 10);
    if (key === "status") return ({ completed: "تکمیل‌شده", in_progress: "در حال اجرا", not_started: "شروع‌نشده" })[v] || v;
    return String(v);
  };
  return <section data-plan-history>
    <p className="sm muted">تاریخچه نسخه‌های فعالیت <strong dir="ltr">{data.activity?.code || selected.item?.code}</strong> — {data.activity?.name || selected.item?.name || ""}
      {" · "}مقادیر محاسباتی فقط خواندنی هستند.</p>
    {!data.rows?.length ? <p className="empty-note">این فعالیت هنوز در هیچ نسخه‌ای برنامه‌ریزی نشده است.</p> :
      <div className="tablewrap" style={{ overflowX: "auto" }}>
        <table className="dtable" data-plan-history-table>
          <thead><tr>{fields.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
          <tbody>{data.rows.map((row) => <tr key={row.id} data-key={row.id}
            style={{ background: row.current ? "var(--cy-soft)" : undefined }}>
            {fields.map(([key, , kind]) => <td key={key} className={kind === "date" || kind === "percent" || typeof row[key] === "number" ? "mono" : undefined}>
              {display(row, key, kind)}</td>)}
          </tr>)}</tbody>
        </table>
      </div>}
    <p className="sm muted">انجام‌شده این دوره = انجام‌شده تاکنون − انجام‌شده قبل از برنامه؛ پیشرفت فعالیت = انجام‌شده تاکنون ÷ حجم واقعی × ۱۰۰؛ پیشرفت دوره = انجام‌شده دوره ÷ حجم برنامه‌شده دوره × ۱۰۰. در صورت نبود مخرج معتبر، درصد خالی می‌ماند.</p>
  </section>;
}
