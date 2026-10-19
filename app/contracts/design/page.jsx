"use client";
import { useState } from "react";
import TemplateButton from "../../../components/ui/TemplateButton";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../../lib/authz.mjs";
import { parseDelimited, guessMapping } from "../../../lib/truth/parse.mjs";
import { DESIGN_PATTERNS as PATTERNS } from "../../../lib/contracts/design-import.mjs";
import TableKit from "../../../components/ui/TableKit";
import { usePrefs } from "../../../lib/client/prefs.mjs";

/**
 * The design model's quantities — the MTO / bulk report of PDMS or E3D —
 * by model revision. A payment item measured «by design» takes its quantity
 * from here and its progress from its WBS element. Columns are found by
 * their header names; a WBS code that is not a control account is named,
 * never guessed.
 */

export default function DesignQuantitiesPage() {
  const { projectId, role, call } = usePlatform();
  const { t } = usePrefs();
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
      setMsg(t("dq.missingCols", { heads: headers.join(t("c.sep")) })); return;
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
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  return (
    <div className="page">
      <div className="pagehead"><h1>{t("dq.title")}</h1><span className="sub">{t("dq.sub", { n: data.design.length })}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {may && (
        <div className="card">
          <h2>{t("dq.import")}</h2>
          <p className="muted sm">{t("dq.importNote")}</p>
          <div className="grid2">
            <div className="field"><label htmlFor="dq-rev">{t("dq.rev")}</label><input id="dq-rev" dir="ltr" value={rev} onChange={(e) => setRev(e.target.value)} /></div>
            <div className="field"><label htmlFor="dq-src">{t("dq.source")}</label><input id="dq-src" dir="ltr" value={source} onChange={(e) => setSource(e.target.value)} /></div>
            <div className="field"><label htmlFor="dq-file">{t("dq.file")}</label><input id="dq-file" type="file" accept=".xlsx,.xls,.csv,.txt" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
              <TemplateButton kind="design" /></div>
          </div>
          {rows && (
            <div>
              <p className="note sm">{t("dq.read", { name: rows.name, n: rows.rows.length })}{rows.unmapped.length ? t("dq.unmapped", { list: rows.unmapped.join(t("c.sep")) }) : ""}</p>
              <button className="btn" disabled={!rev.trim()} onClick={save}>{t("dq.save", { n: rows.rows.length, rev: rev || t("st.q") })}</button>
            </div>
          )}
          {report && <p className="note sm">{t("dq.done", { n: report.imported })}{report.problems.length ? t("dq.rejected", { n: report.problems.length, list: report.problems.slice(0, 3).join("; ") }) : ""}
            {report.noWbs.length ? t("dq.noWbs", { list: report.noWbs.slice(0, 5).join(t("c.sep")) }) : ""}</p>}
        </div>
      )}
      <div className="card">
        <h2>{t("dq.items")}</h2>
        {data.design.length === 0 ? <p className="empty-note">{t("dq.empty")}</p> : (
          <TableKit name="design-qty">
            <table className="dtable">
              <thead><tr><th>{t("dq.h.code")}</th><th>{t("c.description")}</th><th>{t("ct.h.qty")}</th><th>{t("ct.h.unit")}</th><th>WBS</th><th>{t("dq.h.area")}</th><th>{t("dq.source")}</th></tr></thead>
              <tbody>{data.design.map((d) => (
                <tr key={d.id}><td className="mono">{d.code}</td><td>{d.description || "—"}</td><td className="mono">{d.qty}</td><td className="sm">{d.unit}</td>
                  <td className="mono sm">{d.wbs || <span className="pill warn">{t("ct.noWbs")}</span>}</td><td className="sm">{d.area || "—"}</td>
                  <td className="sm">{d.source} Rev.{d.modelRev}</td></tr>
              ))}</tbody>
            </table>
          </TableKit>
        )}
      </div>
    </div>
  );
}
