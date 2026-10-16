"use client";
import Link from "next/link";
import { useProjectData } from "../../lib/client/platform.mjs";
import Tabs from "../../components/ui/Tabs";
import TableKit from "../../components/ui/TableKit";

/**
 * Reports and KPIs, inside the platform. Each figure is read from the same
 * records its module page shows (lib/db/repos/kpi.mjs) and links there; a
 * figure with nothing recorded under it says so instead of showing zero.
 */
const fmt = (v) => (typeof v === "number" ? v.toLocaleString("fa-IR", { maximumFractionDigits: 2 }) : v);
const TONE = { ok: "var(--ok)", warn: "var(--warn, #b7791f)", bad: "var(--bad)" };

export default function ReportsPage() {
  const { data, error } = useProjectData((id) => `/api/kpi?projectId=${id}`, []);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const shown = data.sections.filter((s) => s.kpis.length);

  return (
    <div className="page">
      <div className="pagehead">
        <h1>گزارش‌ها و KPI</h1>
        <span className="sub">از داده‌های همین پروژه، تا امروز {data.today} · روی هر شاخص بزنید تا صفحهٔ جزئیاتش باز شود</span>
      </div>

      <Tabs name="reports">
        <div className="card">
          <h2>خلاصهٔ پروژه</h2>
          {shown.map((s) => (
            <section key={s.key} style={{ marginBottom: 18 }}>
              <h3>{s.title}</h3>
              <div className="kpigrid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
                {s.kpis.map((k) => <Kpi key={k.label} k={k} />)}
              </div>
            </section>
          ))}
        </div>

        <div className="card">
          <h2>ریسک‌های باز</h2>
          {data.risks.length === 0 ? <p className="empty-note">ریسک بازی ثبت نشده است.</p> : (
            <table className="dtable">
              <thead><tr><th>کد</th><th>عنوان</th><th>امتیاز ذاتی</th><th>امتیاز باقیمانده</th><th>مسئول</th><th>مهلت</th></tr></thead>
              <tbody>{data.risks.map((r) => (
                <tr key={r.code}><td className="mono">{r.code}</td><td>{r.title}</td><td>{r.score}</td><td>{r.residual_score ?? "—"}</td>
                  <td className="sm">{r.owner || "—"}</td><td className="mono sm">{r.due_on ? String(r.due_on).slice(0, 10) : "—"}</td></tr>
              ))}</tbody>
            </table>
          )}
          <p className="sm"><Link href="/controls">رجیستر کامل ریسک ←</Link></p>
        </div>

        <div className="card">
          <h2>پیشرفت خطوط</h2>
          {data.lines.length === 0 ? <p className="empty-note">هنوز رجیستر جوشی تأیید نشده است.</p> : (
            <TableKit name="reports-lines">
              <table className="dtable">
                <thead><tr><th>خط</th><th>کلاس</th><th>جوش</th><th>زده‌شده</th><th>بازرسی‌شده</th><th>در انتظار NDT</th><th>پیشرفت</th></tr></thead>
                <tbody>{data.lines.map((l, i) => (
                  <tr key={l.line_no || i}>
                    <td className="mono">{l.line_no || "—"}</td><td className="mono">{l.piping_class || "—"}</td>
                    <td className="mono">{l.welds_total}</td><td className="mono">{l.welds_done}</td>
                    <td className="mono">{l.welds_examined}</td><td className="mono">{l.awaiting_ndt}</td>
                    <td><span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="bar"><i style={{ width: `${Number(l.pct_welded || 0)}%` }} /></span>
                      <span className="mono sm">{Number(l.pct_welded || 0)}%</span></span></td>
                  </tr>
                ))}</tbody>
              </table>
            </TableKit>
          )}
        </div>

        <div className="card">
          <h2>عملکرد جوشکاران</h2>
          {data.welders.length === 0 ? <p className="empty-note">هنوز نتیجهٔ NDT برای جوشکاری ثبت نشده است.</p> : (
            <table className="dtable">
              <thead><tr><th>مهر</th><th>نام</th><th>جوش</th><th>شات</th><th>رد</th><th>نرخ تعمیر</th></tr></thead>
              <tbody>{data.welders.map((w) => (
                <tr key={w.stamp_no}><td className="mono">{w.stamp_no}</td><td>{w.welder_name}</td><td>{w.welds_made}</td><td>{w.shots}</td><td>{w.rejects}</td>
                  <td style={{ color: Number(w.repair_rate_pct) > 5 ? "var(--bad)" : undefined }}>{w.repair_rate_pct == null ? "—" : `${w.repair_rate_pct}%`}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </Tabs>
    </div>
  );
}

function Kpi({ k }) {
  const body = (
    <div className="card" style={{ padding: "10px 12px", margin: 0, height: "100%", borderInlineStart: k.tone ? `4px solid ${TONE[k.tone]}` : undefined }}
      title={k.def || undefined}>
      <div className="sm muted">{k.label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: k.tone ? TONE[k.tone] : undefined }}>
        {k.value == null ? <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>ثبت نشده</span>
          : <>{fmt(k.value)}{k.unit && <span className="sm" style={{ fontWeight: 400 }}> {k.unit}</span>}</>}
      </div>
      {k.sub && <div className="sm muted">{k.sub}</div>}
    </div>
  );
  return k.href ? <Link href={k.href} style={{ color: "inherit", textDecoration: "none" }}>{body}</Link> : body;
}
