"use client";
import { useEffect, useRef, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import PrintSheet from "../../components/reports/PrintSheet";
import DailyPrintBody from "../../components/reports/DailyPrintBody";
import FormPrintBody from "../../components/reports/FormPrintBody";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * The daily report's print layout: paper, the heights of header, body and
 * footer (typed, or dragged on the preview), the header's text cells and
 * logos, and how the signature boxes are drawn. Saved as a new version; the
 * rules are lib/reports/print.mjs, checked again by the server.
 */
const MM = 96 / 25.4;
// i18n: the sample report the preview prints; the printed sheet is a Persian document
const SAMPLE = {
  content: { shift: "day", working: true, weather: { condition: "hot", tempMin: 29, tempMax: 43, humidity: 55 },
    // i18n: sample content of the printed sheet
    manpower: [{ role: "جوشکار آرگون", discipline: "پایپینگ", employer: "پیمانکار", present: 12, leave: 1, night: 0, hours: 96, source: "hr" }],
    // i18n: sample content of the printed sheet
    equipment: [{ name: "جرثقیل ۵۰ تن", working: 2, idle: 1, source: "manual" }], materials: [{ name: "الکترود E7018", unit: "کیلوگرم", qty: 40, source: "manual" }],
    // i18n: sample content of the printed sheet
    work: [{ description: "فیت‌آپ خط نمونه", discipline: "پایپینگ", qty: 6, unit: "اینچ‌قطر", source: "manual" }], stoppages: [{ reason: "باد شدید", hours: 2 }],
    // i18n: sample content of the printed sheet
    hse: { incidents: 0, permits: 3, observations: 1, source: "platform" }, notes: "نمونهٔ پیش‌نمایش" },
  totals: { people: 12, onLeave: 1, machinesWorking: 2, machinesIdle: 1, stoppageHours: 2 },
};

export default function ReportPrintSetup() {
  const { projectId, call } = usePlatform();
  const { t, L } = usePrefs();
  // a form's designer arrives from the form's page with ?type=CODE
  const [typeCode, setTypeCode] = useState(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("type")) || "DR");
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
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  if (!data.type) return <div className="page"><div className="pagehead"><h1>{t("rp.title")}</h1></div>
    <div className="field" style={{ maxWidth: 320 }}><label htmlFor="pt-type">{t("rp.type")}</label>
        <select id="pt-type" value={typeCode} onChange={(e) => { setLayout(null); setTypeCode(e.target.value); }}>
          {(data.types?.length ? data.types : [{ code: "DR", name: t("rp.dr") }, { code: "CR", name: t("rp.cr") }])
            .map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}</select></div>
    <p className="empty-note">{t("rp.noType")}</p></div>;
  if (!layout) return <p className="muted">{t("common.loading")}</p>;
  const C = data.choices;
  const may = data.may.edit;
  const set = (fn) => setLayout((l) => { const n = JSON.parse(JSON.stringify(l)); fn(n); return n; });
  const pageW = (layout.page.orientation === "landscape" ? { A4: 297, A3: 420, Letter: 279.4 } : { A4: 210, A3: 297, Letter: 215.9 })[layout.page.size];
  const scale = Math.min(1, (width - 4) / (pageW * MM));
  const v = sample || SAMPLE;
  const boxes = sample ? sample.signatureBoxes.flatMap((st) => st.groups.map((g) => ({ ...g, stageName: st.stageName })))
    // i18n: sample signature boxes of the printed sheet
    : [{ groupId: "a", stageName: "پیمانکار", name: "مدیریت کارگاه", signatures: [] }, { groupId: "b", stageName: "نظارت", name: "نظارت مقیم", signatures: [] },
      // i18n: sample signature boxes of the printed sheet
      { groupId: "c", stageName: "کارفرما", name: "نمایندهٔ کارفرما", signatures: [] }];
  // i18n: the printed sheet's values, a Persian document
  const values = { report_no: sample?.report.report_no || "DR-R0001", report_date: new Date(sample?.report.report_date || Date.now()).toLocaleDateString("fa-IR"),
    // i18n: the printed sheet's values, a Persian document
    title: sample?.report.title || "", project: data.project?.name || "", stage: sample?.report.stage_name || "پیمانکار", version: sample?.versionNo || 1 };

  async function save() {
    setMsg(null); setOk(null);
    try { const r = await call("/api/report-print", { method: "POST", body: JSON.stringify({ projectId, kind: "layout", reportTypeId: data.type.id, layout }) });
      setOk(t("rp.saved", { n: r.version })); reload(); }
    catch (e) { setMsg(e.message); }
  }
  async function upload() {
    setMsg(null); setOk(null);
    if (!logo.file || !logo.name.trim()) { setMsg(t("rp.logoNeeds")); return; }
    const form = new FormData(); form.set("projectId", projectId); form.set("name", logo.name); form.set("file", logo.file);
    const res = await fetch("/api/report-print", { method: "POST", body: form, credentials: "same-origin" });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(b.error || t("dr.reply", { n: res.status })); return; }
    setLogo({ name: "", file: null }); setOk(b.logo.duplicate ? t("rp.logoThere") : t("rp.logoUp")); reload();
  }
  const Sel = ({ id, value, onChange, options }) => (
    <select id={id} disabled={!may} value={value} onChange={(e) => onChange(e.target.value)}>
      {Object.entries(options).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select>
  );
  // the server's Persian choice names, shown in the reader's language by key
  const tr = (prefix, obj) => Object.fromEntries(Object.entries(obj).map(([k, x]) => [k, L(`print.${prefix}.${k}`, x)]));
  const fonts = Object.fromEntries(C.fonts.map((f) => [f, f === "inherit" ? t("rp.defaultFont") : f]));
  const sizes = (id, value, on) => <input id={id} type="number" min={6} max={28} dir="ltr" readOnly={!may} value={value} onChange={(e) => on(Number(e.target.value))} style={{ width: 64 }} />;

  return (
    <div className="page">
      <div className="field" style={{ maxWidth: 320 }}><label htmlFor="pt-type">{t("rp.type")}</label>
        <select id="pt-type" value={typeCode} onChange={(e) => { setLayout(null); setTypeCode(e.target.value); }}>
          {(data.types?.length ? data.types : [{ code: "DR", name: t("rp.dr") }, { code: "CR", name: t("rp.cr") }])
            .map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}</select></div>
      <div className="pagehead"><h1>{t("rp.heading", { name: data.type.name })}</h1>
        <span className="sub">{data.version ? t("rp.version", { n: data.version }) : t("rp.default")}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      {!may && <p className="muted sm">{t("rp.viewOnly")}</p>}

      <div className="card">
        <h2>{t("rp.paper")}</h2>
        <div className="grid2">
          <div className="field"><label htmlFor="pp-size">{t("rp.size")}</label>
            <Sel id="pp-size" value={layout.page.size} onChange={(x) => set((l) => { l.page.size = x; })} options={Object.fromEntries(C.papers.map((p) => [p, p]))} /></div>
          <div className="field"><label htmlFor="pp-or">{t("rp.orientation")}</label>
            <Sel id="pp-or" value={layout.page.orientation} onChange={(x) => set((l) => { l.page.orientation = x; })} options={tr("orientation", C.orientations)} /></div>
          <div className="field"><label htmlFor="pp-hh">{t("rp.headerH")}</label>
            <input id="pp-hh" type="number" dir="ltr" readOnly={!may} value={layout.heights.header} onChange={(e) => set((l) => { l.heights.header = Number(e.target.value); })} /></div>
          <div className="field"><label htmlFor="pp-fh">{t("rp.footerH")}</label>
            <input id="pp-fh" type="number" dir="ltr" readOnly={!may} value={layout.heights.footer} onChange={(e) => set((l) => { l.heights.footer = Number(e.target.value); })} /></div>
        </div>
        <p className="muted sm">{t("rp.dragHint")}</p>
      </div>

      <div className="card">
        <h2>{t("rp.preview")} {sample ? `(${sample.report.report_no})` : t("rp.sample")}</h2>
        <div ref={box} style={{ width: "100%" }}>
          <PrintSheet mode="preview" scale={scale} layout={layout} values={values} boxes={boxes} onLayout={may ? setLayout : undefined}
            logoUrl={(id) => `/api/report-print?projectId=${projectId}&logo=${id}`} signatureUrl={(id) => `/api/signature?projectId=${projectId}&id=${id}`}>
            {/* the body each kind of report prints: a form its own table, the daily report its lists */}
            {sample?.content?.schema === "form1" ? <FormPrintBody content={sample.content} totals={sample.totals} />
              : data.type.form ? <FormPrintBody content={{ def: data.type.form, header: {}, rows: [] }} />
              : sample && sample.content?.schema !== undefined ? <p className="muted sm">{t("rp.bodyElsewhere")}</p>
              // i18n: the sample sheet's labels; the printed sheet is a Persian document
              : <DailyPrintBody content={v.content} totals={v.totals} labels={sample?.labels || { SOURCE: { manual: "ورود دستی", hr: "کارکرد منابع انسانی", platform: "داده‌های پروژه" },
                // i18n: the sample sheet's labels; the printed sheet is a Persian document
                SHIFT: { day: "روز" }, WEATHER: { hot: "گرمای شدید" } }} />}
          </PrintSheet>
        </div>
        {may && <button className="btn" type="button" onClick={save}>{t("rp.save")}</button>}
      </div>

      <div className="card">
        <h2>{t("rp.center")}</h2>
        <p className="muted sm">{t("rp.placeholders")}{Object.entries(tr("placeholder", C.placeholders)).map(([k, x]) => `{${k}} ${x}`).join(" · ")}</p>
        <div className="tablewrap"><table className="dtable">
          <thead><tr><th>{t("rp.h.text")}</th><th>{t("rp.h.font")}</th><th>{t("rp.h.size")}</th><th>{t("rp.h.bold")}</th><th>{t("rp.h.align")}</th><th>{t("rp.h.height")}</th><th /></tr></thead>
          <tbody>{layout.header.center.cells.map((c, k) => (
            <tr key={k}>
              <td><input aria-label={t("rp.cellText", { n: k + 1 })} readOnly={!may} value={c.text} onChange={(e) => set((l) => { l.header.center.cells[k].text = e.target.value; })} /></td>
              <td><Sel id={`hc-f-${k}`} value={c.font} onChange={(x) => set((l) => { l.header.center.cells[k].font = x; })} options={fonts} /></td>
              <td>{sizes(`hc-s-${k}`, c.size, (x) => set((l) => { l.header.center.cells[k].size = x; }))}</td>
              <td><input type="checkbox" aria-label={t("rp.h.bold")} disabled={!may} checked={c.bold} onChange={(e) => set((l) => { l.header.center.cells[k].bold = e.target.checked; })} /></td>
              <td><Sel id={`hc-a-${k}`} value={c.align} onChange={(x) => set((l) => { l.header.center.cells[k].align = x; })} options={tr("align", C.align)} /></td>
              <td><input type="number" dir="ltr" aria-label={t("rp.height")} readOnly={!may} value={c.height} style={{ width: 64 }}
                onChange={(e) => set((l) => { l.header.center.cells[k].height = Number(e.target.value); })} /></td>
              <td>{may && layout.header.center.cells.length > 1 && <button className="btn ghost sm" type="button" onClick={() => set((l) => { l.header.center.cells.splice(k, 1); })}>×</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {may && <button className="btn ghost sm" type="button" onClick={() => set((l) => { l.header.center.cells.push({ text: "", font: "inherit", size: 10, bold: false, align: "center", height: 6 }); })}>{t("rp.addCell")}</button>}
      </div>

      <div className="card">
        <h2>{t("rp.logos")}</h2>
        {data.logos.length === 0 ? <p className="empty-note">{t("rp.noLogos")}</p> : (
          <div className="tablewrap"><table className="dtable">
            <thead><tr><th>{t("rp.h.logo")}</th><th>{t("rp.h.name")}</th><th>{t("rp.h.right")}</th><th>{t("rp.h.left")}</th></tr></thead>
            <tbody>{data.logos.map((g) => (
              <tr key={g.id}>
                <td><img src={`/api/report-print?projectId=${projectId}&logo=${g.id}`} alt={g.name} style={{ maxHeight: 32, background: "#fff" }} /></td><td>{g.name}</td>
                {["right", "left"].map((side) => (
                  <td key={side}><input type="checkbox" aria-label={t("rp.inColumn", { name: g.name, side: t(side === "right" ? "rp.right" : "rp.left") })} disabled={!may}
                    checked={layout.header[side].logos.includes(g.id)} onChange={(e) => set((l) => {
                      l.header[side].logos = e.target.checked ? [...l.header[side].logos, g.id] : l.header[side].logos.filter((x) => x !== g.id); })} /></td>
                ))}
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {may && (
          <div className="grid2">
            <div className="field"><label htmlFor="lg-name">{t("rp.logoName")}</label><input id="lg-name" value={logo.name} onChange={(e) => setLogo({ ...logo, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="lg-file">{t("rp.logoFile")}</label>
              <input id="lg-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setLogo({ ...logo, file: e.target.files?.[0] || null })} /></div>
            <div className="field" style={{ alignSelf: "end" }}><button className="btn ghost" type="button" onClick={upload}>{t("rp.uploadLogo")}</button></div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>{t("rp.footer")}</h2>
        <div className="grid2">
          <div className="field"><label htmlFor="ft-al">{t("rp.boxAlign")}</label>
            <Sel id="ft-al" value={layout.footer.align} onChange={(x) => set((l) => { l.footer.align = x; })} options={{ right: t("rp.fromRight"), left: t("rp.fromLeft") }} /></div>
          <div className="field"><label htmlFor="ft-pr">{t("rp.perRow")}</label>
            <input id="ft-pr" type="number" min={1} max={12} dir="ltr" readOnly={!may} value={layout.footer.perRow} onChange={(e) => set((l) => { l.footer.perRow = Number(e.target.value); })} /></div>
        </div>
        <p className="muted sm">{t("rp.landscapeNote")}</p>
        <div className="tablewrap"><table className="dtable">
          <thead><tr><th>{t("rp.h.element")}</th><th>{t("rp.h.show")}</th><th>{t("rp.h.order")}</th><th>{t("rp.h.align")}</th><th>{t("rp.h.font")}</th><th>{t("rp.h.size")}</th><th>{t("rp.h.bold")}</th></tr></thead>
          <tbody>{Object.entries(tr("element", C.elements)).map(([k, x]) => {
            const e = layout.footer.elements[k];
            const up = (fn) => set((l) => fn(l.footer.elements[k]));
            return (
              <tr key={k}>
                <td>{x}</td>
                <td><input type="checkbox" aria-label={t("rp.showX", { x })} disabled={!may} checked={e.show} onChange={(z) => up((y) => { y.show = z.target.checked; })} /></td>
                <td><input type="number" aria-label={t("rp.orderX", { x })} min={1} max={99} dir="ltr" readOnly={!may} value={e.order} style={{ width: 56 }} onChange={(z) => up((y) => { y.order = Number(z.target.value); })} /></td>
                <td><Sel id={`fe-a-${k}`} value={e.align} onChange={(z) => up((y) => { y.align = z; })} options={tr("align", C.align)} /></td>
                <td><Sel id={`fe-f-${k}`} value={e.font} onChange={(z) => up((y) => { y.font = z; })} options={fonts} /></td>
                <td>{sizes(`fe-s-${k}`, e.size, (z) => up((y) => { y.size = z; }))}</td>
                <td><input type="checkbox" aria-label={t("rp.boldX", { x })} disabled={!may} checked={e.bold} onChange={(z) => up((y) => { y.bold = z.target.checked; })} /></td>
              </tr>
            );
          })}</tbody>
        </table></div>
        {may && <button className="btn" type="button" onClick={save}>{t("rp.save")}</button>}
      </div>
    </div>
  );
}
