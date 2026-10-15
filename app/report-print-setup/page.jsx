"use client";
import { useEffect, useRef, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import PrintSheet from "../../components/reports/PrintSheet";
import DailyPrintBody from "../../components/reports/DailyPrintBody";

/**
 * The daily report's print layout: paper, the heights of header, body and
 * footer (typed, or dragged on the preview), the header's text cells and
 * logos, and how the signature boxes are drawn. Saved as a new version; the
 * rules are lib/reports/print.mjs, checked again by the server.
 */
const MM = 96 / 25.4;
const SAMPLE = {
  content: { shift: "day", working: true, weather: { condition: "hot", tempMin: 29, tempMax: 43, humidity: 55 },
    manpower: [{ role: "جوشکار آرگون", discipline: "پایپینگ", employer: "پیمانکار", present: 12, leave: 1, night: 0, hours: 96, source: "hr" }],
    equipment: [{ name: "جرثقیل ۵۰ تن", working: 2, idle: 1, source: "manual" }], materials: [{ name: "الکترود E7018", unit: "کیلوگرم", qty: 40, source: "manual" }],
    work: [{ description: "فیت‌آپ خط نمونه", discipline: "پایپینگ", qty: 6, unit: "اینچ‌قطر", source: "manual" }], stoppages: [{ reason: "باد شدید", hours: 2 }],
    hse: { incidents: 0, permits: 3, observations: 1, source: "platform" }, notes: "نمونهٔ پیش‌نمایش" },
  totals: { people: 12, onLeave: 1, machinesWorking: 2, machinesIdle: 1, stoppageHours: 2 },
};

export default function ReportPrintSetup() {
  const { projectId, call } = usePlatform();
  const [typeCode, setTypeCode] = useState("DR");
  const { data, error, reload } = useProjectData((id) => `/api/report-print?projectId=${id}&typeCode=${typeCode}`, [typeCode]);
  const [layout, setLayout] = useState(null);
  const [sample, setSample] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [logo, setLogo] = useState({ name: "", file: null });
  const [width, setWidth] = useState(700);
  const box = useRef(null);

  useEffect(() => { if (data?.layout) setLayout(JSON.parse(JSON.stringify(data.layout))); }, [data]);
  useEffect(() => {
    if (!data?.sampleReportId) return;
    call(`/api/report-print?projectId=${projectId}&reportId=${data.sampleReportId}`).then(setSample).catch(() => {});
  }, [data, projectId, call]);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth)); ro.observe(el);
    return () => ro.disconnect();
  }, [layout === null]);

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  if (!data.type) return <div className="page"><div className="pagehead"><h1>قالب چاپ</h1></div>
    <div className="field" style={{ maxWidth: 320 }}><label htmlFor="pt-type">نوع گزارش</label>
        <select id="pt-type" value={typeCode} onChange={(e) => { setLayout(null); setTypeCode(e.target.value); }}>
          <option value="DR">گزارش روزانه (DR)</option><option value="CR">گزارش روزانهٔ قرارداد (CR)</option></select></div>
    <p className="empty-note">این نوع گزارش هنوز تعریف نشده است (تنظیم گردش‌کار).</p></div>;
  if (!layout) return <p className="muted">در حال بارگذاری…</p>;
  const C = data.choices;
  const may = data.may.edit;
  const set = (fn) => setLayout((l) => { const n = JSON.parse(JSON.stringify(l)); fn(n); return n; });
  const pageW = (layout.page.orientation === "landscape" ? { A4: 297, A3: 420, Letter: 279.4 } : { A4: 210, A3: 297, Letter: 215.9 })[layout.page.size];
  const scale = Math.min(1, (width - 4) / (pageW * MM));
  const v = sample || SAMPLE;
  const boxes = sample ? sample.signatureBoxes.flatMap((st) => st.groups.map((g) => ({ ...g, stageName: st.stageName })))
    : [{ groupId: "a", stageName: "پیمانکار", name: "مدیریت کارگاه", signatures: [] }, { groupId: "b", stageName: "نظارت", name: "نظارت مقیم", signatures: [] },
      { groupId: "c", stageName: "کارفرما", name: "نمایندهٔ کارفرما", signatures: [] }];
  const values = { report_no: sample?.report.report_no || "DR-R0001", report_date: new Date(sample?.report.report_date || Date.now()).toLocaleDateString("fa-IR"),
    title: sample?.report.title || "", project: data.project?.name || "", stage: sample?.report.stage_name || "پیمانکار", version: sample?.versionNo || 1 };

  async function save() {
    setMsg(null); setOk(null);
    try { const r = await call("/api/report-print", { method: "POST", body: JSON.stringify({ projectId, kind: "layout", reportTypeId: data.type.id, layout }) });
      setOk(`قالب نسخهٔ ${r.version} ذخیره شد.`); reload(); }
    catch (e) { setMsg(e.message); }
  }
  async function upload() {
    setMsg(null); setOk(null);
    if (!logo.file || !logo.name.trim()) { setMsg("نام و فایل لوگو لازم است."); return; }
    const form = new FormData(); form.set("projectId", projectId); form.set("name", logo.name); form.set("file", logo.file);
    const res = await fetch("/api/report-print", { method: "POST", body: form, credentials: "same-origin" });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(b.error || `پاسخ ${res.status}`); return; }
    setLogo({ name: "", file: null }); setOk(b.logo.duplicate ? "این لوگو از قبل هست." : "لوگو بارگذاری شد."); reload();
  }
  const Sel = ({ id, value, onChange, options }) => (
    <select id={id} disabled={!may} value={value} onChange={(e) => onChange(e.target.value)}>
      {Object.entries(options).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
  );
  const fonts = Object.fromEntries(C.fonts.map((f) => [f, f === "inherit" ? "پیش‌فرض" : f]));
  const sizes = (id, value, on) => <input id={id} type="number" min={6} max={28} dir="ltr" readOnly={!may} value={value} onChange={(e) => on(Number(e.target.value))} style={{ width: 64 }} />;

  return (
    <div className="page">
      <div className="field" style={{ maxWidth: 320 }}><label htmlFor="pt-type">نوع گزارش</label>
        <select id="pt-type" value={typeCode} onChange={(e) => { setLayout(null); setTypeCode(e.target.value); }}>
          <option value="DR">گزارش روزانه (DR)</option><option value="CR">گزارش روزانهٔ قرارداد (CR)</option></select></div>
      <div className="pagehead"><h1>قالب چاپ — {data.type.name}</h1>
        <span className="sub">{data.version ? `نسخهٔ ${data.version}` : "پیش‌فرض (هنوز ذخیره نشده)"}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      {!may && <p className="muted sm">فقط مدیر اعضای پروژه قالب را تغییر می‌دهد؛ این صفحه برای شما فقط نمایش است.</p>}

      <div className="card">
        <h2>کاغذ و بخش‌ها</h2>
        <div className="grid2">
          <div className="field"><label htmlFor="pp-size">اندازهٔ کاغذ</label>
            <Sel id="pp-size" value={layout.page.size} onChange={(x) => set((l) => { l.page.size = x; })} options={Object.fromEntries(C.papers.map((p) => [p, p]))} /></div>
          <div className="field"><label htmlFor="pp-or">جهت</label>
            <Sel id="pp-or" value={layout.page.orientation} onChange={(x) => set((l) => { l.page.orientation = x; })} options={C.orientations} /></div>
          <div className="field"><label htmlFor="pp-hh">ارتفاع سربرگ (mm)</label>
            <input id="pp-hh" type="number" dir="ltr" readOnly={!may} value={layout.heights.header} onChange={(e) => set((l) => { l.heights.header = Number(e.target.value); })} /></div>
          <div className="field"><label htmlFor="pp-fh">ارتفاع پاورقی (mm)</label>
            <input id="pp-fh" type="number" dir="ltr" readOnly={!may} value={layout.heights.footer} onChange={(e) => set((l) => { l.heights.footer = Number(e.target.value); })} /></div>
        </div>
        <p className="muted sm">روی پیش‌نمایش، خط‌چین‌های آبی را بکشید تا ارتفاع سربرگ، پاورقی و هر خانهٔ سربرگ تغییر کند.</p>
      </div>

      <div className="card">
        <h2>پیش‌نمایش {sample ? `(${sample.report.report_no})` : "(نمونه)"}</h2>
        <div ref={box} style={{ width: "100%" }}>
          <PrintSheet mode="preview" scale={scale} layout={layout} values={values} boxes={boxes} onLayout={may ? setLayout : undefined}
            logoUrl={(id) => `/api/report-print?projectId=${projectId}&logo=${id}`} signatureUrl={(id) => `/api/signature?projectId=${projectId}&id=${id}`}>
            <DailyPrintBody content={v.content} totals={v.totals} labels={sample?.labels || { SOURCE: { manual: "ورود دستی", hr: "کارکرد منابع انسانی", platform: "داده‌های پروژه" },
              SHIFT: { day: "روز" }, WEATHER: { hot: "گرمای شدید" } }} />
          </PrintSheet>
        </div>
        {may && <button className="btn" type="button" onClick={save}>ذخیرهٔ قالب</button>}
      </div>

      <div className="card">
        <h2>سربرگ: ستون میانی</h2>
        <p className="muted sm">جای‌گذارها: {Object.entries(C.placeholders).map(([k, t]) => `{${k}} ${t}`).join(" · ")}</p>
        <div className="tablewrap"><table className="dtable">
          <thead><tr><th>متن</th><th>قلم</th><th>اندازه (pt)</th><th>پررنگ</th><th>تراز</th><th>ارتفاع (mm)</th><th /></tr></thead>
          <tbody>{layout.header.center.cells.map((c, k) => (
            <tr key={k}>
              <td><input aria-label={`متن خانهٔ ${k + 1}`} readOnly={!may} value={c.text} onChange={(e) => set((l) => { l.header.center.cells[k].text = e.target.value; })} /></td>
              <td><Sel id={`hc-f-${k}`} value={c.font} onChange={(x) => set((l) => { l.header.center.cells[k].font = x; })} options={fonts} /></td>
              <td>{sizes(`hc-s-${k}`, c.size, (x) => set((l) => { l.header.center.cells[k].size = x; }))}</td>
              <td><input type="checkbox" aria-label="پررنگ" disabled={!may} checked={c.bold} onChange={(e) => set((l) => { l.header.center.cells[k].bold = e.target.checked; })} /></td>
              <td><Sel id={`hc-a-${k}`} value={c.align} onChange={(x) => set((l) => { l.header.center.cells[k].align = x; })} options={C.align} /></td>
              <td><input type="number" dir="ltr" aria-label="ارتفاع" readOnly={!may} value={c.height} style={{ width: 64 }}
                onChange={(e) => set((l) => { l.header.center.cells[k].height = Number(e.target.value); })} /></td>
              <td>{may && layout.header.center.cells.length > 1 && <button className="btn ghost sm" type="button" onClick={() => set((l) => { l.header.center.cells.splice(k, 1); })}>×</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {may && <button className="btn ghost sm" type="button" onClick={() => set((l) => { l.header.center.cells.push({ text: "", font: "inherit", size: 10, bold: false, align: "center", height: 6 }); })}>+ خانه</button>}
      </div>

      <div className="card">
        <h2>سربرگ: لوگوها</h2>
        {data.logos.length === 0 ? <p className="empty-note">لوگویی بارگذاری نشده است.</p> : (
          <div className="tablewrap"><table className="dtable">
            <thead><tr><th>لوگو</th><th>نام</th><th>ستون راست</th><th>ستون چپ</th></tr></thead>
            <tbody>{data.logos.map((g) => (
              <tr key={g.id}>
                <td><img src={`/api/report-print?projectId=${projectId}&logo=${g.id}`} alt={g.name} style={{ maxHeight: 32, background: "#fff" }} /></td><td>{g.name}</td>
                {["right", "left"].map((side) => (
                  <td key={side}><input type="checkbox" aria-label={`${g.name} در ستون ${side === "right" ? "راست" : "چپ"}`} disabled={!may}
                    checked={layout.header[side].logos.includes(g.id)} onChange={(e) => set((l) => {
                      l.header[side].logos = e.target.checked ? [...l.header[side].logos, g.id] : l.header[side].logos.filter((x) => x !== g.id); })} /></td>
                ))}
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {may && (
          <div className="grid2">
            <div className="field"><label htmlFor="lg-name">نام لوگو</label><input id="lg-name" value={logo.name} onChange={(e) => setLogo({ ...logo, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="lg-file">فایل (PNG، JPEG یا WebP، حداکثر ۱ مگابایت)</label>
              <input id="lg-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setLogo({ ...logo, file: e.target.files?.[0] || null })} /></div>
            <div className="field" style={{ alignSelf: "end" }}><button className="btn ghost" type="button" onClick={upload}>بارگذاری لوگو</button></div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>پاورقی: کادرهای امضا</h2>
        <div className="grid2">
          <div className="field"><label htmlFor="ft-al">چینش کادرها</label>
            <Sel id="ft-al" value={layout.footer.align} onChange={(x) => set((l) => { l.footer.align = x; })} options={{ right: "از راست", left: "از چپ" }} /></div>
          <div className="field"><label htmlFor="ft-pr">کادر در هر ردیف (عمودی)</label>
            <input id="ft-pr" type="number" min={1} max={12} dir="ltr" readOnly={!may} value={layout.footer.perRow} onChange={(e) => set((l) => { l.footer.perRow = Number(e.target.value); })} /></div>
        </div>
        <p className="muted sm">در کاغذ افقی همهٔ کادرها در یک ردیف می‌آیند و ردیف سوم تا انتهای پاورقی کشیده می‌شود.</p>
        <div className="tablewrap"><table className="dtable">
          <thead><tr><th>جزء</th><th>نمایش</th><th>ترتیب</th><th>تراز</th><th>قلم</th><th>اندازه</th><th>پررنگ</th></tr></thead>
          <tbody>{Object.entries(C.elements).map(([k, t]) => {
            const e = layout.footer.elements[k];
            const up = (fn) => set((l) => fn(l.footer.elements[k]));
            return (
              <tr key={k}>
                <td>{t}</td>
                <td><input type="checkbox" aria-label={`نمایش ${t}`} disabled={!may} checked={e.show} onChange={(x) => up((y) => { y.show = x.target.checked; })} /></td>
                <td><input type="number" aria-label={`ترتیب ${t}`} min={1} max={99} dir="ltr" readOnly={!may} value={e.order} style={{ width: 56 }} onChange={(x) => up((y) => { y.order = Number(x.target.value); })} /></td>
                <td><Sel id={`fe-a-${k}`} value={e.align} onChange={(x) => up((y) => { y.align = x; })} options={C.align} /></td>
                <td><Sel id={`fe-f-${k}`} value={e.font} onChange={(x) => up((y) => { y.font = x; })} options={fonts} /></td>
                <td>{sizes(`fe-s-${k}`, e.size, (x) => up((y) => { y.size = x; }))}</td>
                <td><input type="checkbox" aria-label={`پررنگ ${t}`} disabled={!may} checked={e.bold} onChange={(x) => up((y) => { y.bold = x.target.checked; })} /></td>
              </tr>
            );
          })}</tbody>
        </table></div>
        {may && <button className="btn" type="button" onClick={save}>ذخیرهٔ قالب</button>}
      </div>
    </div>
  );
}
