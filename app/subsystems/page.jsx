"use client";
import { useProjectData } from "../../lib/client/platform.mjs";

/**
 * Readiness per subsystem, across every discipline that has filed anything.
 *
 * `unfiled` is shown as prominently as the table, not tucked under it: a
 * readiness percentage computed over only the filed items climbs as the
 * breakdown gets LESS complete, and that is the number people quote in a
 * meeting.
 */
const DISCIPLINE_FA = {
  piping: "پایپینگ", structural: "استراکچر", electrical: "برق",
  instrumentation: "ابزار دقیق", civil: "سیویل", equipment: "تجهیزات",
};

export default function SubsystemsPage() {
  const { data, error } = useProjectData((id) => `/api/subsystems?projectId=${id}`, []);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;

  const rows = data.readiness.filter((r) => r.subsystemId);
  const unfiledTotal = data.unfiled.reduce((a, u) => a + Number(u.items), 0);

  return (
    <div className="page">
      <div className="pagehead">
        <h1>سیستم و ساب‌سیستم</h1>
        <span className="sub">آمادگی تحویل مکانیکی</span>
      </div>

      {unfiledTotal > 0 && (
        <div className="card" style={{ borderColor: "rgba(224,163,62,.5)" }}>
          <h2 style={{ color: "var(--warn)" }}>{unfiledTotal} قلم کار بدون ساب‌سیستم</h2>
          <p className="muted sm">
            این اقلام زیر هیچ ساب‌سیستمی ثبت نشده‌اند، پس در هیچ درصد آمادگی
            پایین دیده نمی‌شوند. <b>درصدی که فقط روی اقلام ثبت‌شده حساب شود، هرچه
            شکست کار ناقص‌تر باشد بالاتر می‌رود</b> — و همان عدد است که در جلسه
            خوانده می‌شود.
          </p>
          <div className="wrap">
            <table className="dtable">
              <thead><tr><th>رشته</th><th>اقلام</th></tr></thead>
              <tbody>
                {data.unfiled.map((u) => (
                  <tr key={u.discipline}>
                    <td>{DISCIPLINE_FA[u.discipline] || u.discipline}</td>
                    <td className="mono">{u.items}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2>آمادگی ساب‌سیستم‌ها</h2>
        {rows.length === 0 ? (
          <p className="empty-note">
            هنوز هیچ کاری زیر یک ساب‌سیستم ثبت نشده است. شکست سیستم معمولاً با
            لیست تجهیزات وارد می‌شود.
          </p>
        ) : (
          <div className="wrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th>ساب‌سیستم</th><th>سیستم</th><th>نام</th><th>رشته</th>
                  <th>اقلام</th><th>نصب</th><th>تست</th><th>آمادگی</th><th>MC برنامه‌ای</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.subsystemId}-${r.discipline}`}>
                    <td className="mono">{r.code}</td>
                    <td className="mono">{r.system}</td>
                    <td>{r.name || "—"}</td>
                    <td>{DISCIPLINE_FA[r.discipline] || r.discipline}</td>
                    <td className="mono">{r.items}</td>
                    <td className="mono">{r.installed}</td>
                    <td className="mono">{r.tested}</td>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="bar"><i style={{ width: `${r.pctReady ?? 0}%` }} /></span>
                        <span className="mono sm">{r.pctReady ?? 0}%</span>
                      </span>
                    </td>
                    <td className="mono">
                      {r.targetMcDate ? new Date(r.targetMcDate).toLocaleDateString("fa-IR") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
