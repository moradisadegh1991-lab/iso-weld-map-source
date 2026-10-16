"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../../lib/authz.mjs";
import TableKit from "../../../components/ui/TableKit";
import Tabs from "../../../components/ui/Tabs";
import Fold from "../../../components/ui/Fold";

/**
 * Piping on one page: progress in welds and inch-dia, NDT compliance as each
 * weld's requirement defines it (lib/ndt/compliance.mjs), lines, welders,
 * and what is missing for any of it to be known.
 */
const TONE = { rejected: "bad", full_examination: "bad", progressive: "warn", awaiting: "warn", awaiting_sample: "warn",
  sample_not_drawn: "bad", unknown: "bad", no_welder: "bad", welder_unsampled: "bad" };

export default function PipingOverview() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/piping/hub?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const mayDraw = can({ role }, ACTIONS.DRAW_NDT_SAMPLE);
  async function drawLot(l) {
    setMsg(null);
    try {
      const r = await call("/api/piping/hub", { method: "POST", body: JSON.stringify({ projectId, kind: "progressive-draw", lineId: l.lineId, method: l.method, welderId: l.welderId }) });
      setMsg({ ok: true, text: `قرعه کشیده شد: ${r.result.weldNos.join("، ")} — seed ${r.result.seed}` });
      reload();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  }
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

      <div className="kpis">
        <Kpi v={pct(t.welded, t.welds)} l="جوش زده‌شده" b={`${t.welded} از ${t.welds}`} />
        <Kpi v={pct(t.diWelded, t.di)} l="اینچ-قطر جوش‌شده" b={`${t.diWelded} از ${t.di} DI`} />
        <Kpi v={pct(t.ndtDone, t.welded)} l="NDT کامل (از جوش‌شده‌ها)" b={`${t.ndtDone} جوش · ${t.diDone} DI`} tone={t.welded && t.ndtDone < t.welded ? "warn" : "ok"} />
        <Kpi v={t.field} l="جوش فیلد" b={`${t.welds - t.field} شاپ`} />
        <Kpi v={t.supports ? `${t.supports.installed}/${t.supports.total}` : "—"} l="ساپورت نصب‌شده" b={t.supports ? `${t.supports.inspected} بازرسی‌شده` : ""} />
        <Kpi v={`${t.packs.accepted}/${t.packs.total}`} l="پکیج تست پذیرفته" />
      </div>
      {t.unsized > 0 && <p className="muted sm">{t.unsized} جوش سایز (NPS) ندارد و در اینچ-قطر نیامده — صفر حساب نشده.</p>}

      <Tabs name="piping-overview">
      <div className="card">
        <h2>NDT: آنچه هنوز کامل نیست</h2>
        <p className="muted sm">«کامل» یعنی آنچه الزام هر جوش می‌خواهد: ۱۰۰٪ با NDT خود جوش؛ درصد تصادفی با نمونهٔ جوشکار در قرعهٔ خط، و در صورت رد، بازرسی تدریجی ASME B31.3 §341.3.4.</p>
        {open.length === 0 ? <p className="empty-note">همهٔ جوش‌های زده‌شده NDT کامل دارند.</p> : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {open.map(([k, n]) => <span key={k} className={`pill ${TONE[k] || ""}`}>{data.statusText[k]}: {n}</span>)}
          </div>
        )}
      </div>

      {msg && <p className={msg.ok ? "muted" : "err"}>{msg.text}</p>}
      {data.lots.length > 0 && (
        <div className="card">
          <h2>بازرسی تدریجی (B31.3 §341.3.4)</h2>
          <p className="muted sm">نمونهٔ جوشکار رد شده: به ازای هر نقص دو جوش دیگر از جوش‌های نمونه‌نشدهٔ همان جوشکار در همان خط، با قرعهٔ ثبت‌شده (seed) انتخاب می‌شود — نه هر جوشی که شات خورده. اگر در مرحلهٔ دوم هم رد باشد، همهٔ جوش‌های لات بازرسی می‌شوند.</p>
          <TableKit name="progressive-lots">
            <table className="dtable">
              <thead><tr><th>خط</th><th>روش</th><th>جوشکار</th><th>مرحله</th><th>جوش‌های معیوب</th><th>قرعه</th><th>وضعیت</th></tr></thead>
              <tbody>{data.lots.map((l) => (
                <tr key={`${l.lineId}|${l.method}|${l.welderId}`}>
                  <td className="mono">{l.lineNo}</td><td className="mono">{l.method}</td><td className="mono">{l.stamp}</td>
                  <td>{l.status === "full_examination" ? "(d) لات کامل" : l.tier === "a" ? "(a) دو به ازای هر نقص" : "(b) دو به ازای هر نقص جدید"}</td>
                  <td className="mono">{l.defects.join("، ") || "—"}</td>
                  <td className="mono">{l.drawn.join("، ") || "—"}</td>
                  <td>{l.status === "full_examination" ? <span className="pill bad">همهٔ جوش‌های لات</span>
                    : l.drawNeeded !== null ? (mayDraw ? <button className="btn" onClick={() => drawLot(l)}>قرعهٔ {l.drawNeeded} جوش</button>
                      : <span className="pill warn">منتظر قرعهٔ {l.drawNeeded} جوش</span>)
                    : <span className="pill warn">منتظر NDT: {l.waiting.join("، ")}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </TableKit>
        </div>
      )}

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
      <PipingClasses may={can({ role }, ACTIONS.MANAGE_PIPING_CLASS)} />
      </Tabs>
    </div>
  );
}

const SERVICE_FA = { normal: "Normal", category_d: "Category D", category_m: "Category M", severe_cyclic: "Severe cyclic", high_pressure: "High pressure (Ch. IX)" };

/**
 * The project's piping classes. A line names its class on the drawing; the
 * class's design pressure is what a test pack's pressure is computed from
 * (B31.3 §345.4.2), and its service category is the floor under every
 * weld's NDT. Without a class the pack cannot say what pressure is enough.
 */
function PipingClasses({ may }) {
  const { projectId, call } = usePlatform();
  const { data, reload } = useProjectData((id) => `/api/piping-classes?projectId=${id}`, []);
  const blank = { code: "", description: "", serviceCategory: "normal", materialSpec: "", corrosionAllowMm: "", designTempC: "", designPressBarg: "", pwhtAboveMm: "" };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState(null);
  const num = (v) => (v === "" ? null : Number(v));
  async function save(e) {
    e.preventDefault(); setMsg(null);
    try {
      await call("/api/piping-classes", { method: "POST", body: JSON.stringify({ projectId, ...f,
        corrosionAllowMm: num(f.corrosionAllowMm), designTempC: num(f.designTempC), designPressBarg: num(f.designPressBarg), pwhtAboveMm: num(f.pwhtAboveMm) }) });
      setF(blank); reload();
    } catch (err) { setMsg(err.message); }
  }
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const classes = data?.classes || [];
  return (
    <div className="card">
      <h2>کلاس‌های لوله (Piping Class)</h2>
      {classes.length === 0 ? <p className="empty-note">کلاس لوله‌ای تعریف نشده — فشار تست پکیج‌ها و کف NDT خطوط از کلاس خوانده می‌شوند.</p> : (
        <TableKit name="piping-class" onEdit={may ? (id) => { const c = classes.find((x) => x.id === id);
          setF({ code: c.code, description: c.description || "", serviceCategory: c.service_category, materialSpec: c.material_spec || "",
            corrosionAllowMm: c.corrosion_allow_mm ?? "", designTempC: c.design_temp_c ?? "", designPressBarg: c.design_press_barg ?? "", pwhtAboveMm: c.pwht_above_mm ?? "" }); } : undefined}>
          <table className="dtable">
            <thead><tr><th>کلاس</th><th>شرح</th><th>سرویس B31.3</th><th>مواد</th><th>CA mm</th><th>T طراحی °C</th><th>P طراحی barg</th><th>PWHT بالای mm</th></tr></thead>
            <tbody>{classes.map((c) => (
              <tr key={c.id} data-key={c.id}>
                <td className="mono">{c.code}</td><td>{c.description || "—"}</td><td className="sm">{SERVICE_FA[c.service_category] || c.service_category}</td>
                <td className="sm">{c.material_spec || "—"}</td><td className="mono">{c.corrosion_allow_mm ?? "—"}</td>
                <td className="mono">{c.design_temp_c ?? "—"}</td><td className="mono">{c.design_press_barg ?? <span className="pill warn">نامعلوم</span>}</td>
                <td className="mono">{c.pwht_above_mm ?? "—"}</td>
              </tr>))}</tbody>
          </table>
        </TableKit>
      )}
      {may && (
        <Fold title="کلاس لولهٔ جدید یا ویرایش">
          <form onSubmit={save}>
            <div className="grid2">
              <div className="field"><label htmlFor="pc-code">کد کلاس</label><input id="pc-code" dir="ltr" value={f.code} onChange={on("code")} required /></div>
              <div className="field"><label htmlFor="pc-desc">شرح</label><input id="pc-desc" dir="auto" value={f.description} onChange={on("description")} /></div>
              <div className="field"><label htmlFor="pc-svc">سرویس (B31.3)</label>
                <select id="pc-svc" value={f.serviceCategory} onChange={on("serviceCategory")}>
                  {Object.entries(SERVICE_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div className="field"><label htmlFor="pc-mat">مشخصات مواد</label><input id="pc-mat" dir="ltr" value={f.materialSpec} onChange={on("materialSpec")} /></div>
              <div className="field"><label htmlFor="pc-ca">خوردگی مجاز (mm)</label><input id="pc-ca" type="number" step="any" dir="ltr" value={f.corrosionAllowMm} onChange={on("corrosionAllowMm")} /></div>
              <div className="field"><label htmlFor="pc-t">دمای طراحی (°C)</label><input id="pc-t" type="number" step="any" dir="ltr" value={f.designTempC} onChange={on("designTempC")} /></div>
              <div className="field"><label htmlFor="pc-p">فشار طراحی (barg)</label><input id="pc-p" type="number" step="any" dir="ltr" value={f.designPressBarg} onChange={on("designPressBarg")} /></div>
              <div className="field"><label htmlFor="pc-pwht">PWHT برای ضخامت بالای (mm)</label><input id="pc-pwht" type="number" step="any" dir="ltr" value={f.pwhtAboveMm} onChange={on("pwhtAboveMm")} /></div>
            </div>
            {msg && <p className="err">{msg}</p>}
            <div><button className="btn" type="submit">ثبت کلاس</button></div>
            <p className="muted sm">همان کد دوباره ثبت شود، کلاس به‌روز می‌شود. خالی یعنی نامعلوم — پیش‌فرضی جای آن نمی‌نشیند.</p>
          </form>
        </Fold>
      )}
    </div>
  );
}

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}
