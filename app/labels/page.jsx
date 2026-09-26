"use client";
import { useEffect, useMemo, useState } from "react";
import { usePlatform } from "../../lib/client/platform.mjs";
import { fieldUrl, qrSvg, KINDS } from "../../lib/field/qr.mjs";

/**
 * QR labels, a sheet at a time, for printing.
 *
 * Each label carries the URL of its item's field page, on the server
 * address given here. That address matters: a sheet printed from a phone
 * running the platform on localhost says "localhost", which no other phone
 * can open — the page says so rather than printing a sheet of dead labels.
 */
const ORIGIN = "epc.labelOrigin";

export default function LabelsPage() {
  const { projectId, project, call } = usePlatform();
  const [pack, setPack] = useState(null);
  const [error, setError] = useState(null);
  const [kind, setKind] = useState("t");
  const [subsystemId, setSubsystemId] = useState("");
  const [origin, setOrigin] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let o = window.location.origin;
    try { o = localStorage.getItem(ORIGIN) || o; } catch { /* ignore */ }
    setOrigin(o);
  }, []);
  useEffect(() => {
    if (!projectId) return;
    setPack(null);
    call(`/api/field?projectId=${projectId}${subsystemId ? `&subsystemId=${subsystemId}` : ""}`)
      .then(setPack, (e) => setError(e.message));
  }, [projectId, subsystemId, call]);

  const items = useMemo(() => {
    if (!pack) return [];
    const list = { t: pack.tags, s: pack.spools, c: pack.cables, i: pack.instruments }[kind] || [];
    return list.filter((x) => !filter || String(x.no).includes(filter.toUpperCase()))
      .map((x) => ({ no: x.no, desc: x.description || x.line || x.tag || "" }));
  }, [pack, kind, filter]);

  const local = /localhost|127\.0\.0\.1|\[::1\]/.test(origin);
  const saveOrigin = (v) => { setOrigin(v); try { localStorage.setItem(ORIGIN, v); } catch { /* ignore */ } };

  if (error) return <p className="err">{error}</p>;
  return (
    <div className="page">
      <div className="pagehead no-print">
        <h1>برچسب QR</h1>
        <span className="sub">{items.length} برچسب · {KINDS[kind]}</span>
      </div>
      <div className="card no-print">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <div className="field"><label htmlFor="lk">نوع</label>
            <select id="lk" value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KINDS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select></div>
          <div className="field"><label htmlFor="ls">ساب‌سیستم</label>
            <select id="ls" value={subsystemId} onChange={(e) => setSubsystemId(e.target.value)}>
              <option value="">کل پروژه</option>
              {(pack?.subsystems || []).map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
            </select></div>
          <div className="field"><label htmlFor="lf">فیلتر شماره</label>
            <input id="lf" dir="ltr" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
          <div className="field" style={{ flex: "1 1 260px" }}><label htmlFor="lo">آدرس سرور روی برچسب</label>
            <input id="lo" dir="ltr" value={origin} onChange={(e) => saveOrigin(e.target.value)} /></div>
          <button className="btn" disabled={!items.length || local} onClick={() => window.print()}>چاپ</button>
        </div>
        {local && <p className="err sm">این آدرس «localhost» است و روی هیچ گوشی دیگری باز نمی‌شود. آدرسی را بنویسید که گوشی‌های سایت به آن دسترسی دارند (مثلاً دامنهٔ سرور).</p>}
        <p className="muted sm">برچسب نشانی صفحهٔ «سایت» همان آیتم را دارد؛ دوربین معمولی هر گوشی آن را باز می‌کند. سطح تصحیح خطا Q — خراش و رنگ لبه را تحمل می‌کند.</p>
      </div>
      {!pack ? <p className="muted">در حال بارگذاری…</p> : (
        <div className="labels">
          {items.map((x) => {
            const url = fieldUrl({ origin, projectCode: project?.code || pack.project.code, kind, no: x.no });
            return (
              <div key={x.no} className="label">
                <div dangerouslySetInnerHTML={{ __html: qrSvg(url, { size: 150 }) }} />
                <div className="no">{x.no}</div>
                <div className="desc">{x.desc}</div>
                <div className="desc">{project?.code}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
