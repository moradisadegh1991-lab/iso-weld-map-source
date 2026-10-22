"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import ActivityGrid, { useSplit } from "../../../components/eps/ActivityGrid";
import ActivityDetail, { useEpsFmt } from "../../../components/eps/ActivityDetail";
import { COLUMNS, useVersion } from "../../../components/eps/shared";
import { codeSummary, periodColumns } from "../../../lib/eps/activities.mjs";
import { usePrefs } from "../../../lib/client/prefs.mjs";

import TableKit from "../../../components/ui/TableKit";
import TemplateButton from "../../../components/ui/TemplateButton";
/**
 * The work done each day, entered against the WBS activities (owner's «PMS»
 * document, images 10–12). The activity's own figures are not edited here.
 * Above the activities: how much was done — a number, the remaining work or
 * a percentage of the activity's volume — the day and that day's daily
 * report of the contract, the area / contractor, and «add item single» (the
 * selected activity) or «add item multi» (every activity the filter shows).
 * Each line becomes a row of the daily report, so the report's workflow
 * decides who may add, change or remove it and when.
 *
 * Owner's requirements 2026-10-22, item 29: the PMS and its version come
 * first (the master plan by default; the planned dates are the version's),
 * a double click on an activity adds it as «add item single» does, the work
 * is read from an Excel sheet too (with its template), and in the daily
 * report sub-form a line's report number and activity code are list boxes.
 */
const TABS = ["reports", "detail", "codes", "docs"];
const today = () => new Date().toISOString().slice(0, 10);
const flatActs = (roots) => { const out = []; const walk = (n) => { out.push(...n.activities); n.children.forEach(walk); }; roots.forEach(walk); return out; };

export default function ProgressPage() {
  const { projectId, contractId, call } = usePlatform();
  const { pmsId, versionId, plan, picker } = useVersion(contractId);
  const { data, error, reload } = useProjectData((id) => (plan ? `/api/eps/activities?projectId=${id}&${plan}` : null), [plan]);
  const lines = useProjectData((id) => (plan ? `/api/eps/activities?projectId=${id}&${plan}&lines=1` : null), [plan]);
  const [sel, setSel] = useState(null);
  const detail = useProjectData((id) => (sel?.kind === "act" ? `/api/eps/activities?projectId=${id}&activityId=${sel.id}` : null), [sel?.id]);
  const [visible, setVisible] = useState([]);
  const [tab, setTab] = useState("reports");
  const [f, setF] = useState({ mode: "number", value: "", day: today(), reportId: "", areaId: "", mark: "", notes: "" });
  const reports = useProjectData((id) => (contractId && f.day ? `/api/eps/activities?projectId=${id}&contractId=${contractId}&day=${f.day}` : null), [contractId, f.day]);
  const allReports = useProjectData((id) => (contractId ? `/api/contract-reports?projectId=${id}&contractId=${contractId}` : null), [contractId]);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const { height, grip } = useSplit("p6-progress", 400);
  useEffect(() => {
    const list = reports.data?.reports || [];
    if (!list.some((r) => r.id === f.reportId)) setF((x) => ({ ...x, reportId: (list.find((r) => r.may.edit) || list[0])?.id || "" }));
  }, [reports.data]); // eslint-disable-line react-hooks/exhaustive-deps
  async function post(url, body, done) {
    setMsg(null); setOk(null);
    try { const r = await call(url, { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); lines.reload(); detail.reload(); reports.reload(); allReports.reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  async function importFile(file) {
    setMsg(null); setOk(null);
    try {
      const form = new FormData();
      for (const [k, v] of Object.entries({ projectId, kind: "progress-import", contractId })) form.set(k, v);
      form.set("file", file);
      const res = await fetch("/api/eps/activities", { method: "POST", body: form, credentials: "same-origin" });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || t("ep.im.status", { n: res.status }));
      reload(); lines.reload(); detail.reload(); reports.reload();
      setOk(t("ep.pg.imported", { n: b.row.added, reports: b.row.reports.join(", ") }));
    } catch (e) { setMsg(e.message); }
  }
  const add = (ids) => post("/api/eps/activities", { kind: "progress-add", reportId: f.reportId, activityIds: ids, mode: f.mode, value: f.value, areaId: f.areaId || null, mark: f.mark, notes: f.notes },
    () => t("ep.pg.added", { n: ids.length, no: (reports.data?.reports || []).find((r) => r.id === f.reportId)?.report_no || "" }));
  const summary = useMemo(() => (data && lines.data ? codeSummary(data.codes, visible, lines.data.lines) : []), [data, lines.data, visible]);
  // planned and actual progress up to the chosen day, from the volumes recorded so far (owner's requirements 2026-10-18, item 5)
  const { t, num } = usePrefs();
  const { fmt } = useEpsFmt();
  const toDay = useMemo(() => (data && lines.data && f.day ? periodColumns([{ id: "__all", activities: [], children: data.roots }], lines.data.lines, [f.day]) : new Map()),
    [data, lines.data, f.day]);
  const columns = useMemo(() => [...COLUMNS,
    { key: "dayPlan", title: t("pg.planPct"), tip: t("pg.planPctTip"), width: 90, mono: true, get: (r, x) => { const v = toDay.get(r.id)?.TPP; return v === undefined ? "" : x.fmt(v); } },
    { key: "dayActual", title: t("pg.actualPct"), tip: t("pg.actualPctTip"), width: 90, mono: true, get: (r, x) => { const v = toDay.get(r.id)?.TPA; return v === undefined ? "" : x.fmt(v); } }], [toDay, t]);
  const [codePick, setCodePick] = useState(null);

  const head = (
    <div className="pagehead"><h1>{t("ep.pg.title")}</h1>
      <span className="sub">{picker} <Link href="/eps/activities">{t("ep.link.activities")}</Link> · <Link href="/eps/progress/days">{t("ep.link.days")}</Link> · <Link href={`/eps/progress/preview?${new URLSearchParams({ ...(f.reportId ? { report: f.reportId } : {}), ...(versionId ? { version: versionId } : pmsId ? { pms: pmsId } : {}) })}`} data-report-preview>{t("ep.link.reportPreview")}</Link> · <Link href="/contract-reports">{t("ep.link.contractReport")}</Link></span></div>);
  if (!contractId) return <div className="page"><div className="pagehead"><h1>{t("ep.pg.title")}</h1></div><p className="empty-note">{t("cs.pick")}</p></div>;
  if (error) return <div className="page">{head}<p className="err">{error}</p></div>;
  if (!plan) return <div className="page">{head}<p className="empty-note">{t("ep.noPlan")}</p></div>;
  if (!data) return <div className="page">{head}<p className="muted">{t("common.loading")}</p></div>;
  const rep = (reports.data?.reports || []).find((r) => r.id === f.reportId);
  const canAdd = rep?.may.edit && (f.mode === "remain" || String(f.value).trim() !== "");
  const companyName = new Map(data.companies.map((c) => [c.id, c.name]));
  const picked = summary.find((c) => c.id === codePick) || null;

  return (
    <div className="page">
      {head}
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      <div className="toolbar-left" data-entry-bar>
        <span className="field"><label htmlFor="pg-day" className="sm">{t("pg.day")}</label><input id="pg-day" type="date" value={f.day} max={today()} onChange={(e) => setF({ ...f, day: e.target.value })} /></span>
        <span className="field"><label htmlFor="pg-rep" className="sm">{t("pg.reportNo")}</label>
          <select id="pg-rep" value={f.reportId} onChange={(e) => setF({ ...f, reportId: e.target.value })}>
            {(reports.data?.reports || []).length === 0 && <option value="">{t("pg.noReport")}</option>}
            {(reports.data?.reports || []).map((r) => <option key={r.id} value={r.id}>{r.report_no} — {r.stage || r.status}{r.may.edit ? "" : t("pg.viewOnly")}</option>)}</select></span>
        <button className="btn" type="button" disabled={!canAdd || sel?.kind !== "act"} data-add="single" onClick={() => add([sel.id])}>{t("pg.addSingle")}</button>
        <button className="btn" type="button" disabled={!canAdd || visible.length === 0} data-add="multi"
          onClick={() => { if (window.confirm(t("pg.addMultiAsk", { n: visible.length }))) add(visible.map((a) => a.id)); }}>{t("pg.addMulti", { n: visible.length })}</button>
        <TemplateButton kind="daily" />
        <label className="btn ghost sm" style={{ cursor: "pointer" }}>{t("ep.pl.import")}
          <input type="file" accept=".xlsx,.xls" hidden data-progress-import onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ""; if (x && window.confirm(t("ep.pg.importAsk", { name: x.name }))) importFile(x); }} /></label>
        <span className="sm" data-day-progress>{t("pg.dayProgress", { day: f.day, plan: num(toDay.get("__all")?.TPP ?? null, { maximumFractionDigits: 2 }), actual: num(toDay.get("__all")?.TPA ?? null, { maximumFractionDigits: 2 }) })}</span>
      </div>
      <div className="card row" style={{ gap: 18, flexWrap: "wrap", alignItems: "flex-start" }} data-entry-box>
        <fieldset style={{ border: "1px solid var(--rule)", borderRadius: 4, padding: "6px 10px" }}>
          <legend className="sm">{t("ep.pg.input")}</legend>
          {[["number", t("ep.pg.mode.number")], ["remain", t("ep.pg.mode.remain")], ["percent", t("ep.pg.mode.percent")]].map(([k, l]) => (
            <label key={k} style={{ display: "flex", gap: 6, alignItems: "center", margin: "3px 0" }}>
              <input type="radio" name="qmode" checked={f.mode === k} onChange={() => setF({ ...f, mode: k })} /> {l}
              {k !== "remain" && f.mode === k && <input aria-label={t(k === "number" ? "ep.qty" : "ep.pg.percent")} dir="ltr" style={{ width: 90 }} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />}
            </label>))}
        </fieldset>
        <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "6px 8px", alignItems: "center" }}>
          <label htmlFor="pg-area" className="sm">{t("ep.rp.area")}</label>
          <select id="pg-area" value={f.areaId} onChange={(e) => setF({ ...f, areaId: e.target.value })}><option value="">—</option>
            {data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <label htmlFor="pg-mark" className="sm">{t("ep.pg.markNote")}</label>
          <span className="row" style={{ gap: 4 }}><input id="pg-mark" style={{ width: 90 }} value={f.mark} onChange={(e) => setF({ ...f, mark: e.target.value })} placeholder="Mark" />
            <input aria-label={t("ep.remark")} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={t("ep.remark")} /></span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rep && !rep.may.edit && <span className="sm" style={{ color: "var(--warn)" }}>{rep.may.editWhy || t("ep.pg.noRight")}</span>}
          {(reports.data?.reports || []).length === 0 && <Link className="sm" href="/contract-reports">{t("ep.pg.makeReport")}</Link>}
        </div>
      </div>
      <div style={{ height }}>
        <ActivityGrid data={data} columns={columns} defaultCols={["code", "name", "unit", "volActual", "done", "pct", "dayPlan", "dayActual", "remain", "start", "finish"]}
          storeKey="p6-progress" selected={sel?.id} onSelect={(r) => setSel(r)} onVisible={setVisible}
          onOpen={(r) => { setSel(r); if (canAdd) add([r.id]); else setMsg(rep ? t("ep.pg.needQty") : t("pg.noReport")); }} />
      </div>
      {grip}
      <div className="p6-detail">
        <div className="p6-tabs" role="tablist">{TABS.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : undefined} onClick={() => setTab(k)}>{t(`ep.tab.${k}`)}</button>)}</div>
        {tab === "codes" ? (
          <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div className="tablewrap" style={{ flex: 2, minWidth: 420 }}><TableKit name="eps-progress-1"><table className="dtable">
              <thead><tr><th>Active Code</th><th>{t("ep.cd.kind")}</th><th>Category A</th><th>Category B</th><th>Category C</th><th>Category D</th><th>Unit</th>
                <th>{t("ep.link.activities")}</th><th>Original weight</th><th>Actual weight</th><th>Work weight</th><th>Remain</th><th>Progress %</th></tr></thead>
              <tbody>{summary.filter((c) => c.activities > 0).map((c) => (
                <tr key={c.id} onClick={() => setCodePick(c.id)} style={{ cursor: "pointer", background: codePick === c.id ? "var(--cy-soft)" : undefined }} data-sum={c.code}>
                  <td className="mono" dir="ltr">{c.code}</td><td>{c.name}</td>{[0, 1, 2, 3].map((i) => <td key={i} className="sm">{c.categories[i] || "—"}</td>)}<td>{c.unit || "—"}</td>
                  <td className="mono">{c.activities}</td><td className="mono">{fmt(c.plan)}</td><td className="mono">{fmt(c.actual)}</td><td className="mono"><b>{fmt(c.done)}</b></td>
                  <td className="mono">{fmt(c.remain)}</td><td className="mono"><b>{c.pct == null ? "—" : `${fmt(c.pct)}%`}</b></td></tr>))}
                {summary.every((c) => !c.activities) && <tr><td colSpan={13} className="muted sm">{t("ep.pg.noCodes")}</td></tr>}</tbody></table></TableKit>
              <p className="sm muted">{t("ep.pg.codesNote")}</p></div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <h3 className="sm">{t("ep.pg.byArea")}{picked ? ` — ${picked.code}` : ""}</h3>
              {!picked ? <p className="sm muted">{t("ep.pg.pickCode")}</p> : (
                <TableKit name="eps-progress-2"><table className="dtable"><thead><tr><th>Area / Contract name</th><th>Work weight</th></tr></thead>
                  <tbody>{Object.entries(picked.byArea).map(([k, v]) => <tr key={k}><td>{k ? companyName.get(k) || "—" : t("ep.pg.noArea")}</td><td className="mono">{fmt(v)}</td></tr>)}
                    <tr><td><b>{t("ep.total")}</b></td><td className="mono"><b>{fmt(picked.done)}</b></td></tr></tbody></table></TableKit>)}
            </div>
          </div>
        ) : sel?.kind !== "act" ? <p className="empty-note">{t("ep.pickActivity")}</p>
          : detail.error ? <p className="err">{detail.error}</p> : !detail.data ? <p className="muted">{t("common.loading")}</p>
            : <ActivityDetail d={detail.data} tab={tab === "detail" ? "detail" : tab} may={false} readOnly post={post} companies={data.companies} projectId={projectId}
              acts={flatActs(data.roots)} reportList={allReports.data?.reports || []} />}
      </div>
    </div>
  );
}
