"use client";
import { useEffect, useState } from "react";
import { usePlatform } from "../../../lib/client/platform.mjs";
import PrintSheet from "../../../components/reports/PrintSheet";

/**
 * A contract report on paper, with its type's print layout (header with the
 * logos, signature boxes by stage and group). The browser prints it, or saves
 * it as PDF; once the last stage has approved, what prints is the record.
 */
const COLS = {
  narrative: [["categoryId", "دسته"], ["title", "عنوان"], ["description", "شرح"], ["unit", "واحد"], ["qty", "مقدار"], ["notes", "توضیحات"]],
  problems: [["description", "شرح مشکل"], ["scope", "محدوده"], ["cause", "عامل"], ["hours", "ساعت"]],
  resources: [["resourceId", "منبع"], ["day", "روز"], ["night", "شب"], ["leave", "مرخصی"], ["sick", "خرابی/استعلاجی"], ["local", "بومی"], ["nonLocal", "غیربومی"]],
};
const total = (e) => ["day", "night", "leave", "sick"].reduce((s, k) => s + (Number(e?.[k]) || 0), 0);

export default function ContractReportPrint() {
  const { projectId, call } = usePlatform();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!projectId || !id) return;
    Promise.all([call(`/api/report-print?projectId=${projectId}&reportId=${id}`), call(`/api/contract-reports?projectId=${projectId}&id=${id}`)])
      .then(([p, v]) => setD({ p, v })).catch((e) => setError(e.message));
  }, [projectId, call]);
  if (error) return <p className="err">{error}</p>;
  if (!d) return <p className="muted">در حال بارگذاری…</p>;
  const { p, v } = d;
  const r = v.report;
  const values = { report_no: r.report_no, report_date: new Date(r.report_date).toLocaleDateString("fa-IR"), title: r.title || "", project: p.project?.name || "",
    stage: r.status === "open" ? r.stage_name : r.status_fa, version: v.versionNo };
  const boxes = p.signatureBoxes.flatMap((st) => st.groups.map((g) => ({ ...g, stageName: st.stageName })));
  const cat = (id) => { const walk = (ns, pre = "") => ns.flatMap((n) => [[n.id, pre ? `${pre} › ${n.name}` : n.name], ...walk(n.children, pre ? `${pre} › ${n.name}` : n.name)]);
    return new Map(walk(v.narrativeTree)).get(id) || "—"; };
  const res = (id) => v.resources.find((x) => x.id === id)?.name || "—";
  const show = (k, val) => (val == null || val === "" ? "—" : k === "categoryId" ? cat(val) : k === "resourceId" ? res(val) : val);
  const h = { ...(v.content.header?.base || {}) };
  for (const [, x] of Object.entries(v.content.header?.stages || {}).sort(([a], [b]) => a - b)) for (const [k, y] of Object.entries(x)) if (k !== "confirmed" && y != null) h[k] = y;
  return (
    <div className="page">
      <div className="pagehead no-print"><h1>چاپ {r.report_no}</h1><span className="sub">{r.status_fa} · نسخهٔ {v.versionNo}</span></div>
      <p className="no-print" style={{ display: "flex", gap: 8 }}>
        <button className="btn" type="button" onClick={() => window.print()}>چاپ / ذخیرهٔ PDF</button>
        <a className="btn ghost" href={`/contract-reports?id=${r.id}`}>بازگشت</a>
        {r.status !== "approved" && <span className="muted sm">این گزارش هنوز تأیید نهایی نشده است؛ چاپ آن سند مرجع نیست.</span>}
      </p>
      <div className="rp-printhost">
        <PrintSheet mode="print" layout={p.layout} values={values} boxes={boxes}
          logoUrl={(id) => `/api/report-print?projectId=${projectId}&logo=${id}`} signatureUrl={(id) => `/api/signature?projectId=${projectId}&id=${id}`}>
          <div className="sm" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
            <span>قرارداد: <b>{v.contract.contract_no}</b> — {v.contract.title}</span><span>ساعت: {h.startTime || "—"} تا {h.endTime || "—"}</span>
            <span>وضعیت روز: {v.labels?.dayStatus?.[h.dayStatus] || h.dayStatus || "—"}</span><span>دما: {h.tempMin ?? "—"} تا {h.tempMax ?? "—"} °C</span>
            <span>هوا: {v.labels?.weather?.[h.weather] || "—"}</span><span>رطوبت: {h.humidity ?? "—"}٪</span>
          </div>
          {Object.entries(COLS).map(([kind, cols]) => (
            <section key={kind} style={{ marginBottom: 6 }}>
              <b>{({ narrative: "شرح کار", problems: "مشکلات", resources: "منابع" })[kind]}</b>
              <table className="cr-pt" style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt" }}>
                <thead><tr><th>#</th><th>مرحله</th>{cols.map(([k, l]) => <th key={k}>{l}</th>)}{kind === "resources" && <th>کل</th>}</tr></thead>
                <tbody>{v.lines[kind].flatMap((line, i) => [
                  <tr key={line.id}><td>{i + 1}</td><td>{line.base ? "" : "افزوده"}</td>{cols.map(([k]) => <td key={k}>{line.base ? show(k, line.base[k]) : "—"}</td>)}
                    {kind === "resources" && <td>{line.base ? total(line.base) : "—"}</td>}</tr>,
                  ...line.lines.map((l) => <tr key={`${line.id}${l.seq}`} style={{ color: l.color || "#c0392b" }}><td /><td>{l.stage}{l.removed ? " (حذف)" : ""}</td>
                    {cols.map(([k]) => <td key={k}>{show(k, l.values[k])}</td>)}{kind === "resources" && <td>{total(l.values)}</td>}</tr>),
                ])}</tbody>
              </table>
            </section>))}
          <p className="sm">کل نفرات: <b>{v.summary.total}</b> (روز {v.summary.day} · شب {v.summary.night} · مرخصی {v.summary.leave}) — {Object.entries(v.summary.byUnit).map(([u, n]) => `${n} ${u}`).join(" · ")}</p>
        </PrintSheet>
      </div>
    </div>
  );
}
