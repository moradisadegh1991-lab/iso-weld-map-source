"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";

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
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/subsystems?projectId=${id}`, []);
  const mayFile = can({ role }, ACTIONS.EDIT_EXTRACTION);
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
        <div className="card" data-keep style={{ borderColor: "rgba(224,163,62,.5)" }}>
          <h2 style={{ color: "var(--warn)" }}>{unfiledTotal} قلم کار بدون ساب‌سیستم</h2>
          <p className="muted sm">
            این اقلام زیر هیچ ساب‌سیستمی ثبت نشده‌اند، پس در هیچ درصد آمادگی
            پایین دیده نمی‌شوند. <b>درصدی که فقط روی اقلام ثبت‌شده حساب شود، هرچه
            شکست کار ناقص‌تر باشد بالاتر می‌رود</b> — و همان عدد است که در جلسه
            خوانده می‌شود.
          </p>
          <TableKit name="subsystems">
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
          </TableKit>
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
          <TableKit name="subsystems">
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
          </TableKit>
        )}
      </div>

      {(data.unfiledLines || []).length > 0 && (
        <div className="card" data-keep>
          <h2>خطوطی که زیر هیچ ساب‌سیستمی نیستند</h2>
          <p className="muted sm">جوش‌های این خطوط در پکیج تست و MC هیچ ساب‌سیستمی دیده نمی‌شوند. خطی که ایزومتریکش در MDR زیر ساب‌سیستمی ثبت شده باشد، خودش همان‌جا می‌رود.</p>
          <TableKit name="unfiled-lines">
            <table className="dtable">
              <thead><tr><th>خط</th><th>کلاس</th><th>جوش</th>{mayFile && <th>ساب‌سیستم</th>}</tr></thead>
              <tbody>{data.unfiledLines.map((l) => (
                <tr key={l.id}><td className="mono">{l.line_no}</td><td className="mono">{l.piping_class || "—"}</td><td className="mono">{l.welds}</td>
                  {mayFile && <td><FileLine line={l} subsystems={data.subsystems} projectId={projectId} call={call} onDone={reload} /></td>}</tr>
              ))}</tbody>
            </table>
          </TableKit>
        </div>
      )}
    </div>
  );
}

function FileLine({ line, subsystems, projectId, call, onDone }) {
  const [sub, setSub] = useState("");
  const [err, setErr] = useState(null);
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <select aria-label={`ساب‌سیستم ${line.line_no}`} value={sub} onChange={(e) => setSub(e.target.value)}>
        <option value="">—</option>{subsystems.map((s) => <option key={s.id} value={s.id}>{s.code}{s.name ? ` — ${s.name}` : ""}</option>)}
      </select>
      <button className="btn ghost" disabled={!sub} onClick={async () => {
        setErr(null);
        try { await call("/api/subsystems", { method: "POST", body: JSON.stringify({ projectId, kind: "file-line", lineId: line.id, subsystemId: sub }) }); onDone(); }
        catch (e) { setErr(e.message); }
      }}>ثبت</button>
      {err && <span className="err sm">{err}</span>}
    </span>
  );
}
