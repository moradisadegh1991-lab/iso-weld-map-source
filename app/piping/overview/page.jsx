"use client";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import TableKit from "../../../components/ui/TableKit";
import PipingNav from "../../../components/ui/PipingNav";

/**
 * Piping on one page: progress in welds and inch-dia, NDT compliance as each
 * weld's requirement defines it (lib/ndt/compliance.mjs), lines, welders,
 * and what is missing for any of it to be known.
 */
const TONE = { rejected: "bad", full_examination: "bad", progressive: "warn", awaiting: "warn", awaiting_sample: "warn",
  sample_not_drawn: "bad", unknown: "bad", no_welder: "bad", welder_unsampled: "bad" };

export default function PipingOverview() {
  const { projectId } = usePlatform();
  const { data, error } = useProjectData((id) => `/api/piping/hub?projectId=${id}`, []);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const t = data.totals;
  const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}٪` : "—");
  const open = Object.entries(data.byStatus).filter(([k]) => !["accepted", "accepted_by_sample", "not_welded"].includes(k));
  const m = data.missing;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>داشبورد پایپینگ</h1>
        <span className="sub">{data.lines.length} خط · {t.drawings} نقشه ({t.drawingsApproved} رجیستر تأییدشده) · {t.welds} جوش</span>
      </div>
      <PipingNav here="/piping/overview" />

      <div className="kpis">
        <Kpi v={pct(t.welded, t.welds)} l="جوش زده‌شده" b={`${t.welded} از ${t.welds}`} />
        <Kpi v={pct(t.diWelded, t.di)} l="اینچ-قطر جوش‌شده" b={`${t.diWelded} از ${t.di} DI`} />
        <Kpi v={pct(t.ndtDone, t.welded)} l="NDT کامل (از جوش‌شده‌ها)" b={`${t.ndtDone} جوش · ${t.diDone} DI`} tone={t.welded && t.ndtDone < t.welded ? "warn" : "ok"} />
        <Kpi v={t.field} l="جوش فیلد" b={`${t.welds - t.field} شاپ`} />
        <Kpi v={t.supports ? `${t.supports.installed}/${t.supports.total}` : "—"} l="ساپورت نصب‌شده" b={t.supports ? `${t.supports.inspected} بازرسی‌شده` : ""} />
        <Kpi v={`${t.packs.accepted}/${t.packs.total}`} l="پکیج تست پذیرفته" />
      </div>
      {t.unsized > 0 && <p className="muted sm">{t.unsized} جوش سایز (NPS) ندارد و در اینچ-قطر نیامده — صفر حساب نشده.</p>}

      <div className="card">
        <h2>NDT: آنچه هنوز کامل نیست</h2>
        <p className="muted sm">«کامل» یعنی آنچه الزام هر جوش می‌خواهد: ۱۰۰٪ با NDT خود جوش؛ درصد تصادفی با نمونهٔ جوشکار در قرعهٔ خط، و در صورت رد، بازرسی تدریجی ASME B31.3 §341.3.4.</p>
        {open.length === 0 ? <p className="empty-note">همهٔ جوش‌های زده‌شده NDT کامل دارند.</p> : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {open.map(([k, n]) => <span key={k} className={`pill ${TONE[k] || ""}`}>{data.statusText[k]}: {n}</span>)}
          </div>
        )}
      </div>

      <div className="card">
        <h2>خطوط</h2>
        <p className="sm"><a href={`/api/piping/hub?projectId=${projectId}&export=weldlog`}>دریافت Weld Log کل پروژه (CSV)</a></p>
        <TableKit name="piping-lines">
          <table className="dtable">
            <thead><tr><th>خط</th><th>کلاس / سرویس</th><th>جوش</th><th>اینچ-قطر</th><th>الزام NDT</th><th>باز در NDT</th><th>اسپول</th><th>پکیج تست</th></tr></thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.lineNo}{l.subsystem && <div className="muted sm">{l.subsystem}</div>}</td>
                  <td className="sm">{l.pipingClass || "—"}{!l.classLinked && <div className="pill bad">کلاس متصل نیست</div>}{l.service && <div className="muted">{l.service}</div>}</td>
                  <td className="mono">{l.welded}/{l.welds}<div className="muted sm">NDT کامل {l.ndtDone}</div></td>
                  <td className="mono">{l.diWelded}/{l.di.di}<div className="muted sm">NDT کامل {l.diDone}{l.di.unsized > 0 && ` · ${l.di.unsized} بی‌سایز`}</div></td>
                  <td className="sm">{l.requirements.join("، ") || "تعیین نشده"}
                    {l.samples.map((s) => <div key={s.method} className="muted">قرعهٔ {s.method} {s.percent}٪: {s.drawn} جوش</div>)}</td>
                  <td className="sm">{Object.entries(l.open).map(([k, n]) => <div key={k}><span className={`pill ${TONE[k] || ""}`}>{data.statusText[k]}: {n}</span></div>)}{!Object.keys(l.open).length && "—"}</td>
                  <td className="sm">{Object.entries(l.spools).map(([k, n]) => `${k}: ${n}`).join(" · ") || "—"}</td>
                  <td className="sm">{l.pack ? <span className={`pill ${l.pack.accepted ? "ok" : "warn"}`}>{l.pack.no}{l.pack.accepted ? " — پذیرفته" : ""}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      </div>

      <div className="card">
        <h2>جوشکاران</h2>
        {data.welders.length === 0 ? <p className="empty-note">جوشی به جوشکاری نسبت داده نشده.</p> : (
          <TableKit name="piping-welders">
            <table className="dtable">
              <thead><tr><th>مهر</th><th>نام</th><th>جوش</th><th>شات اول</th><th>رد</th><th>نرخ تعمیر</th></tr></thead>
              <tbody>{data.welders.map((w) => (
                <tr key={w.stamp_no}><td className="mono">{w.stamp_no}</td><td>{w.welder_name}</td><td className="mono">{w.welds_made}</td>
                  <td className="mono">{w.shots}</td><td className="mono">{w.rejects}</td>
                  <td className="mono">{w.repair_rate_pct === null ? "—" : `${w.repair_rate_pct}٪`}</td></tr>
              ))}</tbody>
            </table>
          </TableKit>
        )}
      </div>

      {(m.linesWithoutClass.length > 0 || m.noRequirement > 0 || m.samplesNotDrawn.length > 0 || m.unsized > 0) && (
        <div className="card">
          <h2>اطلاعات ناقص</h2>
          <ul className="sm">
            {m.linesWithoutClass.length > 0 && <li>خط بدون Piping Class متصل (الزام NDT فقط از کف کد): {m.linesWithoutClass.join("، ")}</li>}
            {m.noRequirement > 0 && <li>{m.noRequirement} جوش بدون الزام NDT — «کامل» برای آن‌ها قابل سنجش نیست</li>}
            {m.samplesNotDrawn.length > 0 && <li>خط با الزام تصادفی ولی بدون قرعه: {m.samplesNotDrawn.join("، ")} — قرعه در صفحهٔ ایزومتریک</li>}
            {m.unsized > 0 && <li>{m.unsized} جوش بدون سایز — در اینچ-قطر نمی‌آید</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}
