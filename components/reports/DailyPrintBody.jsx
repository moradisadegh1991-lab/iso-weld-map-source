/**
 * The daily report's content as it goes on paper: compact tables, each list
 * in its own unit, the source of every row shown in small type.
 */
const T = (head, rows) => (
  <table className="rp-t"><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c ?? "—"}</td>)}</tr>)
      : <tr><td colSpan={head.length} className="rp-none">ثبت نشده</td></tr>}</tbody></table>
);

export default function DailyPrintBody({ content: c, totals: t, labels: L }) {
  const src = (s) => <span className="rp-src">{L.SOURCE[s || "manual"]}</span>;
  return (
    <div className="rp-daily">
      <div className="rp-strip">
        <span>شیفت: <b>{L.SHIFT[c.shift] || "—"}</b></span>
        <span>{c.working ? "روز کاری" : "تعطیل / غیرکاری"}</span>
        <span>آب‌وهوا: <b>{L.WEATHER[c.weather?.condition] || "—"}</b></span>
        <span>دما: <b>{c.weather?.tempMin ?? "—"} / {c.weather?.tempMax ?? "—"} °C</b></span>
        <span>رطوبت: <b>{c.weather?.humidity ?? "—"}٪</b></span>
      </div>
      <div className="rp-strip">
        <span>نفرات حاضر: <b>{t.people}</b></span><span>مرخصی: <b>{t.onLeave}</b></span>
        <span>ماشین‌آلات فعال / غیرفعال: <b>{t.machinesWorking} / {t.machinesIdle}</b></span><span>ساعت توقف: <b>{t.stoppageHours}</b></span>
      </div>
      <h4>نیروی انسانی (نفر)</h4>
      {T(["سمت", "رشته", "پیمانکار", "حاضر", "مرخصی", "شب‌کار", "ساعت", "منبع"],
        c.manpower.map((r) => [r.role, r.discipline, r.employer, r.present, r.leave, r.night, r.hours, src(r.source)]))}
      <h4>ماشین‌آلات (دستگاه)</h4>
      {T(["دستگاه", "مالک", "فعال", "غیرفعال", "توضیح", "منبع"], c.equipment.map((r) => [r.name, r.owner, r.working, r.idle, r.note, src(r.source)]))}
      <h4>مصالح و مصرفی</h4>
      {T(["شرح", "مقدار", "واحد", "توضیح", "منبع"], c.materials.map((r) => [r.name, r.qty, r.unit, r.note, src(r.source)]))}
      <h4>کار انجام‌شده</h4>
      {T(["شرح کار", "رشته", "محل", "مقدار", "واحد", "منبع"],
        c.work.map((r) => [r.description, r.discipline, r.location, r.qty, r.unit, <>{src(r.source)}{r.state === "claimed" ? " · ادعای پیمانکار" : ""}</>]))}
      <h4>توقف‌ها و موانع</h4>
      {T(["علت", "محدوده", "ساعت", "توضیح"], c.stoppages.map((r) => [r.reason, r.scope, r.hours, r.note]))}
      <h4>HSE</h4>
      <p>حوادث: <b>{c.hse?.incidents ?? "—"}</b> · مجوزهای کار معتبر: <b>{c.hse?.permits ?? "—"}</b> · مشاهدات: <b>{c.hse?.observations ?? "—"}</b>
        {c.hse?.note ? ` · ${c.hse.note}` : ""} {src(c.hse?.source)}</p>
      {c.notes && <><h4>توضیحات</h4><p className="rp-notes">{c.notes}</p></>}
    </div>
  );
}
