"use client";
import { useProjectData } from "../../lib/client/platform.mjs";

/**
 * Progress and KPI.
 *
 * These read the same reporting views Power BI connects to, so a number here
 * and a number in a report file cannot disagree. That is the whole reason
 * the star schema exists — two sources for one figure is how a dashboard
 * stops being believed.
 */
export default function ReportsPage() {
  const { data, error } = useProjectData((id) => `/api/reports/dashboard?projectId=${id}`, []);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;

  const lines = data.lines || data.lineProgress || [];
  return (
    <div className="page">
      <div className="pagehead">
        <h1>گزارش‌ها</h1>
        <span className="sub">همان ویوهایی که Power BI به آن وصل می‌شود</span>
      </div>

      <div className="card">
        <h2>پیشرفت خطوط</h2>
        {lines.length === 0 ? (
          <p className="empty-note">هنوز رجیستری ثبت نشده است.</p>
        ) : (
          <div className="wrap">
            <table className="dtable">
              <thead>
                <tr><th>خط</th><th>کلاس</th><th>جوش</th><th>زده‌شده</th>
                    <th>بازرسی‌شده</th><th>در انتظار NDT</th><th>پیشرفت</th></tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.line_key || l.lineKey || i}>
                    <td className="mono">{l.line_no || l.lineNo || "—"}</td>
                    <td className="mono">{l.piping_class || l.pipingClass || "—"}</td>
                    <td className="mono">{l.welds_total ?? l.weldsTotal}</td>
                    <td className="mono">{l.welds_done ?? l.weldsDone}</td>
                    <td className="mono">{l.welds_examined ?? l.weldsExamined}</td>
                    <td className="mono">{l.awaiting_ndt ?? l.awaitingNdt}</td>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="bar">
                          <i style={{ width: `${Number(l.pct_welded ?? l.pctWelded ?? 0)}%` }} />
                        </span>
                        <span className="mono sm">{Number(l.pct_welded ?? l.pctWelded ?? 0)}%</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>اتصال Power BI</h2>
        <p className="muted sm">
          اسکیمای <code className="mono">reporting</code> با
          {" "}<code className="mono">security_invoker</code> ساخته شده، پس سیاست‌های
          سطح سطر روی همان کاربری اعمال می‌شود که کوئری می‌زند — نه مالک ویو.
          رشتهٔ اتصال باید <code className="mono">app.project_id</code> را حمل کند:
        </p>
        <p className="mono sm" dir="ltr" style={{ wordBreak: "break-all" }}>
          postgresql://app_report@host/db?options=-c%20app.project_id%3D&lt;uuid&gt;
        </p>
      </div>
    </div>
  );
}
