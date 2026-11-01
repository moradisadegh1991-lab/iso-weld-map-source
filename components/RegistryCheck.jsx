"use client";
import { useEffect, useState } from "react";

const LABEL = {
  lineClass: "کلاس خط", designPressure: "فشار طراحی", operatingPressure: "فشار کاری", designTemp: "دمای طراحی",
  operatingTemp: "دمای کاری", testPressure: "فشار تست", testFluid: "سیال تست", ndt: "NDT", pwht: "PWHT", paint: "رنگ",
  insulationType: "نوع عایق", insulationThk: "ضخامت عایق",
};

/**
 * The sheet against what the project has on file, before it is saved
 * (app/api/registry-check): is this drawing, sheet and revision registered,
 * which revision is in force, is the line registered, and where the line
 * list read on the sheet differs from the line's. It says what is on file;
 * saving decides nothing more than it did — the line's empty values are
 * filled, a differing one is kept and reported.
 */
export default function RegistryCheck({ session, meta, lineData }) {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const can = Boolean(session?.projectId && (meta.drawingNo || meta.lineNo));

  async function check() {
    if (!can) return;
    setBusy(true); setErr(null);
    try {
      setRes(await session.call("/api/registry-check", { method: "POST", body: JSON.stringify({
        projectId: session.projectId, docNo: meta.drawingNo || null, sheet: meta.sheet || "1/1", rev: meta.rev || null,
        lineNo: meta.lineNo || null, lineData: lineData || {} }) }));
    } catch (e) {
      setErr(e.message);
      session.setError?.(null);
    } finally {
      setBusy(false);
    }
  }
  // once, as the sheet opens with what was read off it; again on the button after a correction
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { check(); }, []);

  const d = res?.document, l = res?.line;
  return (
    <div className="pane" data-registry-check={d?.status || (res ? "none" : "")}>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong className="sm">بررسی ثبت قبلی در سامانه</strong>
        <button type="button" className="btn sm" onClick={check} disabled={!can || busy} data-registry-recheck>
          {busy ? "در حال بررسی…" : "بررسی دوباره"}
        </button>
        {!can && <span className="muted sm">شمارهٔ نقشه یا شمارهٔ خط را وارد کنید.</span>}
      </div>
      {err && <p className="err sm">{err}</p>}
      {d && (
        <p className="sm" data-doc-status={d.status}>
          {d.status === "new" && <>نقشهٔ <span className="mono" dir="ltr">{meta.drawingNo}</span> شیت {meta.sheet || "1/1"} در سامانه نیست — با ذخیره ثبت می‌شود.</>}
          {d.status === "registered" && <>همین نقشه، شیت و رویژن ({meta.rev}) قبلاً ثبت شده{d.approved ? " و رجیسترش تأیید شده — برای تغییر، رویژن جدید لازم است." : d.saved ? "؛ ذخیرهٔ دوباره نسخهٔ تازه‌ای از رجیستر همین رویژن می‌سازد." : "، بدون رجیستر ذخیره‌شده."}</>}
          {(d.status === "new-revision" || d.status === "sheet-on-file") && <>این شیت با رویژن {d.revisions.map((r) => r.revision).join("، ")} ثبت شده
            {d.inForce ? ` (در جریان: ${d.inForce})` : ""}؛ رویژن {meta.rev || "؟"} روی فایل نیست و با ذخیره ثبت می‌شود. کدام رویژن جدیدتر است را شماره‌گذاری پروژه می‌گوید، نه این بررسی.</>}
        </p>)}
      {d?.otherLine && (
        <p className="err sm" data-other-line>
          همین شمارهٔ نقشه و شیت با خط دیگری (<span className="mono" dir="ltr">{d.otherLine}</span>) ذخیره شده است: این شماره ممکن است شمارهٔ بستهٔ نقشه‌ها باشد، نه این ایزومتریک.
          اگر چنین است، شمارهٔ خط را به‌جای شمارهٔ نقشه وارد کنید تا روی آن ذخیره نشود.
        </p>)}
      {res && !l && meta.drawingNo && !meta.lineNo && <p className="muted sm">شمارهٔ خط خوانده نشد — وارد کنید تا خط و مشخصاتش بررسی و ثبت شود.</p>}
      {l && (
        <div className="sm" data-line-status={l.exists ? "exists" : "new"}>
          <p>{l.exists ? <>خط <span className="mono" dir="ltr">{l.lineNo}</span> در سامانه ثبت شده است.</> : <>خط <span className="mono" dir="ltr">{l.lineNo}</span> ثبت نشده — با ذخیره ثبت می‌شود.</>}
            {l.fills.length > 0 && ` ${l.fills.length} مقدار مشخصات خط (${l.fills.map((k) => LABEL[k] || k).join("، ")}) از نقشه ثبت می‌شود.`}</p>
          {l.conflicts.length > 0 && (
            <ul className="err" data-line-conflicts={l.conflicts.length}>
              {l.conflicts.map((c) => <li key={c.key}>{LABEL[c.key] || c.key}: ثبت‌شده <span className="mono" dir="ltr">{c.onFile}</span>، روی نقشه <span className="mono" dir="ltr">{c.read}</span> — مقدار ثبت‌شده بازنویسی نمی‌شود؛ بررسی کنید.</li>)}
            </ul>)}
        </div>)}
    </div>
  );
}
