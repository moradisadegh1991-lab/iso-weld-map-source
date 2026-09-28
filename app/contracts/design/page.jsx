"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../../lib/authz.mjs";
import { parseDelimited, guessMapping } from "../../../lib/truth/parse.mjs";
import TableKit from "../../../components/ui/TableKit";

/**
 * The design model's quantities — the MTO / bulk report of PDMS or E3D —
 * by model revision. A payment item measured «by design» takes its quantity
 * from here and its progress from its WBS element. Columns are found by
 * their header names; a WBS code that is not a control account is named,
 * never guessed.
 */
const S = "[\\s_.\\-]*";
const PATTERNS = {
  code: [new RegExp(`\\b(item${S}code|commodity${S}code|code|ident|item)\\b`, "i"), /کد/],
  description: [/\b(description|desc|name)\b/i, /شرح/],
  unit: [/\b(unit|uom)\b/i, /واحد/],
  qty: [/\b(qty|quantity|total|amount)\b/i, /مقدار|تعداد/],
  wbs: [/\bwbs\b/i, /\b(cbs|control${S}account)\b/i],
  area: [/\b(area|zone|site)\b/i, /ناحیه|محدوده/],
};

export default function DesignQuantitiesPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/contracts?projectId=${id}`, []);
  const [rev, setRev] = useState("");
  const [source, setSource] = useState("PDMS");
  const [rows, setRows] = useState(null);
  const [report, setReport] = useState(null);
  const [msg, setMsg] = useState(null);
  const may = can({ role }, ACTIONS.MANAGE_CONTRACTS);

  async function read(f) {
    setMsg(null); setReport(null);
    let text;
    if (/\.(xlsx?|xlsm)$/i.test(f.name)) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      text = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
    } else text = await f.text();
    const { headers, rows: raw } = parseDelimited(text);
    const { mapping, unmapped } = guessMapping(headers, PATTERNS);
    if (mapping.code == null || mapping.qty == null || mapping.unit == null) {
      setMsg(`ستون‌های کد، مقدار و واحد پیدا نشد. سرستون‌ها: ${headers.join("، ")}`); return;
    }
    const got = raw.map((r) => Object.fromEntries(Object.keys(PATTERNS).map((k) => [k, mapping[k] == null ? "" : r[mapping[k]]])))
      .filter((r) => String(r.code || "").trim());
    setRows({ name: f.name, rows: got, unmapped });
  }

  async function save() {
    setMsg(null);
    try {
      const r = await call("/api/contracts", { method: "POST", body: JSON.stringify({ projectId, kind: "design-import", modelRev: rev, source, rows: rows.rows }) });
      setReport(r.report); setRows(null); reload();
    } catch (e) { setMsg(e.message); }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  return (
    <div className="page">
      <div className="pagehead"><h1>مقادیر طراحی (PDMS)</h1><span className="sub">{data.design.length} آیتم</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {may && (
        <div className="card">
          <h2>ورود گزارش مقادیر مدل</h2>
          <p className="muted sm">گزارش MTO یا Bulk مدل (PDMS / E3D / Plant 3D) را به‌صورت Excel یا CSV بدهید؛ ستون‌ها: کد آیتم، شرح، واحد، مقدار، WBS (کد حساب کنترلی) و ناحیه. همان کد با رویژن جدید، ردیف تازه می‌سازد و رویژن قبلی می‌ماند.</p>
          <div className="grid2">
            <div className="field"><label htmlFor="dq-rev">رویژن مدل</label><input id="dq-rev" dir="ltr" value={rev} onChange={(e) => setRev(e.target.value)} /></div>
            <div className="field"><label htmlFor="dq-src">منبع</label><input id="dq-src" dir="ltr" value={source} onChange={(e) => setSource(e.target.value)} /></div>
            <div className="field"><label htmlFor="dq-file">فایل</label><input id="dq-file" type="file" accept=".xlsx,.xls,.csv,.txt" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} /></div>
          </div>
          {rows && (
            <div>
              <p className="note sm">«{rows.name}»: {rows.rows.length} ردیف{rows.unmapped.length ? ` · بدون ستون: ${rows.unmapped.join("، ")}` : ""}</p>
              <button className="btn" disabled={!rev.trim()} onClick={save}>ثبت {rows.rows.length} ردیف با رویژن {rev || "؟"}</button>
            </div>
          )}
          {report && <p className="note sm">{report.imported} ردیف ثبت شد{report.problems.length ? ` · ${report.problems.length} ردیف رد شد: ${report.problems.slice(0, 3).join("؛ ")}` : ""}
            {report.noWbs.length ? ` · WBS ناشناخته (بدون WBS ثبت شد): ${report.noWbs.slice(0, 5).join("، ")}` : ""}</p>}
        </div>
      )}
      <div className="card">
        <h2>آیتم‌های مدل (آخرین رویژن)</h2>
        {data.design.length === 0 ? <p className="empty-note">هنوز گزارشی از مدل وارد نشده است.</p> : (
          <TableKit name="design-qty">
            <table className="dtable">
              <thead><tr><th>کد</th><th>شرح</th><th>مقدار</th><th>واحد</th><th>WBS</th><th>ناحیه</th><th>منبع</th></tr></thead>
              <tbody>{data.design.map((d) => (
                <tr key={d.id}><td className="mono">{d.code}</td><td>{d.description || "—"}</td><td className="mono">{d.qty}</td><td className="sm">{d.unit}</td>
                  <td className="mono sm">{d.wbs || <span className="pill warn">بدون WBS</span>}</td><td className="sm">{d.area || "—"}</td>
                  <td className="sm">{d.source} Rev.{d.modelRev}</td></tr>
              ))}</tbody>
            </table>
          </TableKit>
        )}
      </div>
    </div>
  );
}
