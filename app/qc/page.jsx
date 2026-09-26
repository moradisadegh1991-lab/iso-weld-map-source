"use client";
import { useProjectData } from "../../lib/client/platform.mjs";
import TableKit from "../../components/ui/TableKit";
import PipingNav from "../../components/ui/PipingNav";

/**
 * Quality control: what has been welded and not yet examined.
 *
 * The handover gap is the list, because it is the one that decides whether a
 * system can be handed over. A weld that is welded and never examined is an
 * ITR that will be missing from the dossier, and it is discovered at MC
 * unless something surfaces it now.
 */
export default function QcPage() {
  const { data, error } = useProjectData((id) => `/api/reports/dashboard?projectId=${id}`, []);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;

  const gap = data.handoverGap || data.gap || [];
  const welders = data.welders || data.welderPerformance || [];

  return (
    <div className="page">
      <div className="pagehead">
        <h1>کنترل کیفیت</h1>
        <span className="sub">شکاف تحویل و عملکرد جوشکاران</span>
      </div>
      <PipingNav here="/qc" />

      <div className="card">
        <h2>{gap.length} جوشِ زده‌شده بدون بازرسی</h2>
        <p className="muted sm">
          هر کدام یک ITR است که در dossier نخواهد بود. اگر الان دیده نشود، در
          MC کشف می‌شود.
        </p>
        {gap.length === 0 ? (
          <p className="empty-note">شکافی نیست.</p>
        ) : (
          <TableKit name="qc">
            <table className="dtable">
              <thead><tr><th>جوش</th><th>خط</th><th>محل</th><th>NDT لازم</th><th>جوشکار</th></tr></thead>
              <tbody>
                {gap.slice(0, 200).map((g, i) => (
                  <tr key={g.weld_uid || i}>
                    <td className="mono">{g.weld_uid ? <a href={`/piping/joint?uid=${encodeURIComponent(g.weld_uid)}`}>{g.weld_no}</a> : g.weld_no}</td>
                    <td className="mono">{g.line_no || "—"}</td>
                    <td>{g.shop_field}</td>
                    <td className="mono">{g.ndt_requirement || "—"}</td>
                    <td className="mono">{g.stamp_no || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
      </div>

      {welders.length > 0 && (
        <div className="card">
          <h2>نرخ تعمیر جوشکاران</h2>
          <p className="muted sm">
            فقط روی <b>شات اول</b> حساب می‌شود. شمردن شات‌های بعدی یک جوشکار را
            دو بار بابت یک عیب جریمه می‌کند و آن‌که ریجکتش دوباره تست نشده را
            پاداش می‌دهد.
          </p>
          <TableKit name="qc">
            <table className="dtable">
              <thead><tr><th>مهر</th><th>نام</th><th>فرایند</th><th>جوش</th>
                         <th>شات</th><th>ریجکت</th><th>نرخ تعمیر</th></tr></thead>
              <tbody>
                {welders.map((w, i) => (
                  <tr key={w.welder_key || i}>
                    <td className="mono">{w.stamp_no}</td>
                    <td>{w.welder_name}</td>
                    <td className="mono sm">{w.processes || "—"}</td>
                    <td className="mono">{w.welds_made}</td>
                    <td className="mono">{w.shots}</td>
                    <td className="mono">{w.rejects}</td>
                    <td className="mono">
                      {w.repair_rate_pct == null ? "—" : `${w.repair_rate_pct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableKit>
        </div>
      )}
    </div>
  );
}
