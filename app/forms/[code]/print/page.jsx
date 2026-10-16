"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { usePlatform } from "../../../../lib/client/platform.mjs";
import PrintSheet from "../../../../components/reports/PrintSheet";
import FormPrintBody from "../../../../components/reports/FormPrintBody";

/**
 * A handover form's report on paper, with its form's print layout: the
 * browser's own print (to a printer or to PDF) repeats the header and the
 * signature boxes on every page the table runs to.
 */
export default function FormReportPrint() {
  const { code } = useParams();
  const { projectId, call } = usePlatform();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!projectId || !id) return;
    call(`/api/report-print?projectId=${projectId}&reportId=${id}`).then(setData).catch((e) => setError(e.message));
  }, [projectId, call]);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const r = data.report;
  const values = { report_no: r.report_no, report_date: new Date(r.report_date).toLocaleDateString("fa-IR"), title: r.title || "",
    project: data.project?.name || "", stage: r.status === "open" ? r.stage_name : r.status_fa, version: data.versionNo };
  const boxes = data.signatureBoxes.flatMap((st) => st.groups.map((g) => ({ ...g, stageName: st.stageName })));
  return (
    <div className="page">
      <div className="pagehead no-print"><h1>چاپ {r.report_no}</h1>
        <span className="sub">قالب چاپ نسخهٔ {data.layoutVersion || "پیش‌فرض"} · {r.status_fa}</span></div>
      <p className="no-print" style={{ display: "flex", gap: 8 }}>
        <button className="btn" type="button" onClick={() => window.print()}>چاپ / ذخیرهٔ PDF</button>
        <Link className="btn ghost" href={`/forms/${code}?id=${r.id}`}>بازگشت</Link>
        {r.status !== "approved" && <span className="muted sm">این گزارش هنوز تأیید نهایی نشده است؛ چاپ آن رکورد رسمی نیست.</span>}
      </p>
      <div className="rp-printhost">
        <PrintSheet mode="print" layout={data.layout} values={values} boxes={boxes}
          logoUrl={(id) => `/api/report-print?projectId=${projectId}&logo=${id}`}
          signatureUrl={(id) => `/api/signature?projectId=${projectId}&id=${id}`}>
          <FormPrintBody content={data.content} totals={data.totals} />
        </PrintSheet>
      </div>
    </div>
  );
}
