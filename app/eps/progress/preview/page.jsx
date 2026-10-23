"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../../../lib/client/platform.mjs";
import ActivityGrid, { useSplit } from "../../../../components/eps/ActivityGrid";
import ActivityDetail, { useEpsFmt } from "../../../../components/eps/ActivityDetail";
import { Status } from "../../../../components/eps/PlanningSubforms";
import { COLUMNS, useVersion } from "../../../../components/eps/shared";
import { effective } from "../../../../lib/reports/contract-daily.mjs";
import { usePrefs } from "../../../../lib/client/prefs.mjs";
import TableKit from "../../../../components/ui/TableKit";

/**
 * The daily report preview (owner's requirements 2026-10-22, items 30–36):
 * like the planning preview, but the tree holds only the activities the
 * chosen report records work on. What the report holds for an activity —
 * its quantity, mark and notes in this report — is edited in the activity's
 * own row (when the report has one line for it; several lines are edited
 * below). Below, for the selected activity:
 *   lines      its lines in this report
 *   PMS        the activities under its parent node, with the progress worked
 *              out from the reports right now (image 8)
 *   status     its status against the PMS version picked, with the holds (image 9)
 *   narrative  the report's narrative rows (image 10)
 */
const TABS = ["lines", "pms", "status", "narrative"];
const today = () => new Date().toISOString().slice(0, 10);

export default function DailyReportPreviewPage() {
  const { projectId, contractId, call } = usePlatform();
  const { t } = usePrefs();
  const { fmt, day, statusOf, w } = useEpsFmt();
  const { pmsId, versionId, plan, picker } = useVersion(contractId);
  const [d0, setDay] = useState(today());
  const [reportId, setReportId] = useState("");
  useEffect(() => { const r = new URLSearchParams(window.location.search).get("report"); if (r) setReportId(r); }, []);
  const all = useProjectData((id) => (contractId ? `/api/contract-reports?projectId=${id}&contractId=${contractId}` : null), [contractId]);
  // a report opened by its link sets the day to its own
  useEffect(() => {
    const r = (all.data?.reports || []).find((x) => x.id === reportId);
    if (r) setDay(String(r.report_date).slice(0, 10));
  }, [all.data, reportId]);
  const dayReports = (all.data?.reports || []).filter((r) => String(r.report_date).slice(0, 10) === d0 && r.status !== "cancelled");
  // once the reports are known: keep the report asked for when it is the day's, else the day's first
  useEffect(() => {
    if (!all.data) return;
    setReportId((cur) => (dayReports.some((r) => r.id === cur) ? cur : dayReports[0]?.id || ""));
  }, [d0, all.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const tree = useProjectData((id) => (plan ? `/api/eps/activities?projectId=${id}&${plan}` : null), [plan]);
  const lines = useProjectData((id) => (plan ? `/api/eps/activities?projectId=${id}&${plan}&lines=1` : null), [plan]);
  const report = useProjectData((id) => (reportId ? `/api/contract-reports?projectId=${id}&id=${reportId}` : null), [reportId]);
  const [sel, setSel] = useState(null);
  const detail = useProjectData((id) => (sel?.kind === "act" ? `/api/eps/activities?projectId=${id}&activityId=${sel.id}${versionId ? `&versionId=${versionId}` : ""}` : null), [sel?.id, versionId]);
  const sub = useProjectData((id) => (sel?.kind === "act" && versionId ? `/api/eps/planning?projectId=${id}&versionId=${versionId}&activityId=${sel.id}` : null), [sel?.id, versionId]);
  const [tab, setTab] = useState("lines");
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const { height, grip } = useSplit("p6-report-preview", 360);
  const live = useRef({});
  live.current = { tree, lines, report, detail, sub, all };

  async function post(url, body, done) {
    setMsg(null); setOk(null);
    try { const r = await call(url, { method: "POST", body: JSON.stringify({ projectId, ...body }) }); for (const x of Object.values(live.current)) x.reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }

  // this report's lines, by activity
  const mine = useMemo(() => {
    const m = new Map();
    for (const l of lines.data?.lines || []) if (l.reportId === reportId) (m.get(l.activityId) || m.set(l.activityId, []).get(l.activityId)).push(l);
    return m;
  }, [lines.data, reportId]);
  const data = useMemo(() => {
    if (!tree.data) return null;
    const cut = (n) => {
      const children = n.children.map(cut).filter(Boolean);
      const activities = n.activities.filter((a) => mine.has(a.id));
      return children.length || activities.length ? { ...n, children, activities } : null;
    };
    return { ...tree.data, roots: tree.data.roots.map(cut).filter(Boolean) };
  }, [tree.data, mine]);
  const acts = useMemo(() => { const out = []; const walk = (n) => { out.push(...n.activities); n.children.forEach(walk); }; (tree.data?.roots || []).forEach(walk); return out; }, [tree.data]);
  const one = (r) => (r.kind === "act" && mine.get(r.id)?.length === 1 ? mine.get(r.id)[0] : null);
  const columns = useMemo(() => [...COLUMNS,
    { key: "dQty", title: t("ep.dp.qty"), width: 95, mono: true, get: (r, x) => { const l = mine.get(r.id); return l ? x.fmt(l.reduce((s, y) => s + Number(y.qty || 0), 0), 10) : ""; } },
    { key: "dMark", title: t("ep.dp.mark"), width: 90, get: (r) => (one(r)?.mark || (mine.get(r.id)?.length > 1 ? t("ep.dp.lines", { n: mine.get(r.id).length }) : "")) },
    { key: "dNotes", title: t("ep.dp.notes"), width: 160, get: (r) => one(r)?.notes || "" },
  ], [mine, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const may = !!report.data?.may?.edit;
  const ops = useMemo(() => (!may ? null : {
    fields: (row) => (one(row) ? [{ key: "dQty", type: "number" }, { key: "dMark", type: "text" }, { key: "dNotes", type: "text" }] : []),
    value: (row) => { const l = one(row); return { dQty: l.qty ?? "", dMark: l.mark || "", dNotes: l.notes || "" }; },
    save: async (row, v) => { const l = one(row); return !!(await post("/api/eps/activities", { kind: "progress-edit", reportId, rowId: l.rowId, qty: v.dQty, mark: v.dMark, notes: v.dNotes }, () => t("ep.rp.saved"))); },
  }), [may, mine, reportId]); // eslint-disable-line react-hooks/exhaustive-deps

  const head = (
    <div className="pagehead"><h1>{t("ep.dp.title")}</h1>
      <span className="sub">{picker} <Link href="/eps/progress">{t("ep.link.entry")}</Link> · <Link href={reportId ? `/contract-reports?id=${reportId}` : "/contract-reports"}>{t("ep.link.contractReport")}</Link></span></div>);
  if (!contractId) return <div className="page"><div className="pagehead"><h1>{t("ep.dp.title")}</h1></div><p className="empty-note">{t("cs.pick")}</p></div>;
  if (tree.error) return <div className="page">{head}<p className="err">{tree.error}</p></div>;
  if (!plan) return <div className="page">{head}<p className="empty-note">{t("ep.noPlan")}</p></div>;
  const bar = (
    <div className="toolbar-left" data-report-bar>
      <span className="field"><label htmlFor="dp-day" className="sm">{t("pg.day")}</label><input id="dp-day" type="date" value={d0} onChange={(e) => setDay(e.target.value)} /></span>
      <span className="field"><label htmlFor="dp-rep" className="sm">{t("pg.reportNo")}</label>
        <select id="dp-rep" value={reportId} onChange={(e) => setReportId(e.target.value)}>
          {dayReports.length === 0 && <option value="">{t("pg.noReport")}</option>}
          {dayReports.map((r) => <option key={r.id} value={r.id}>{r.report_no} — {r.title || ""}</option>)}</select></span>
      {report.data && <span className="sm muted">{report.data.report?.stage_name || report.data.report?.status}{may ? "" : t("pg.viewOnly")}</span>}
    </div>);
  if (!reportId) return <div className="page">{head}{bar}<p className="empty-note">{t("ep.dp.pickReport")}</p></div>;
  if (!data || !lines.data) return <div className="page">{head}{bar}<p className="muted">{t("common.loading")}</p></div>;

  const a = sel?.kind === "act" ? acts.find((x) => x.id === sel.id) : null;
  const body = () => {
    if (tab === "narrative") return <Narrative r={report.data} />;
    if (!a) return <p className="empty-note">{t("ep.pickActivity")}</p>;
    if (tab === "pms") return <PmsTab data={tree.data} a={a} fmt={fmt} day={day} statusOf={statusOf} w={w} />;
    if (tab === "status") {
      if (!versionId) return <p className="empty-note">{t("ep.pl.pickVersion")}</p>;
      if (sub.error) return <p className="err">{sub.error}</p>;
      if (!sub.data) return <p className="muted">{t("common.loading")}</p>;
      return <>{!sub.data.planned && <p className="sm" style={{ color: "var(--warn)" }}>{t("ep.dp.notPlanned")}</p>}<Status p={sub.data} a={a} /></>;
    }
    if (detail.error) return <p className="err">{detail.error}</p>;
    if (!detail.data) return <p className="muted">{t("common.loading")}</p>;
    const d = { ...detail.data, reports: detail.data.reports.filter((l) => l.reportId === reportId) };
    return <ActivityDetail d={d} tab="reports" may={may} post={post} companies={tree.data.companies} projectId={projectId} acts={acts} reportList={all.data?.reports || []} />;
  };
  return (
    <div className="page">
      {head}
      {bar}
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg toast" role="status">{ok}</p>}
      {data.roots.length === 0 ? <p className="empty-note">{t("ep.dp.empty")}</p> : (
        <div style={{ height }}>
          <ActivityGrid data={data} columns={columns} defaultCols={["code", "activityNo", "name", "unit", "volActual", "done", "pct", "start", "finish", "dQty", "dMark", "dNotes"]}
            storeKey="p6-report-preview" selected={sel?.id} onSelect={(r) => setSel(r)} ops={ops} />
        </div>)}
      {grip}
      <div className="p6-detail" data-report-tabs>
        <div className="p6-tabs" role="tablist">{TABS.map((k) => <button key={k} type="button" role="tab" data-tab={k} aria-selected={tab === k} className={tab === k ? "on" : undefined}
          onClick={() => setTab(k)}>{t(`ep.dp.tab.${k}`)}</button>)}</div>
        {body()}
      </div>
    </div>
  );
}

/** Image 8: the activities under the selected activity's parent node, as the reports make them right now, with totals. */
function PmsTab({ data, a, fmt, day, statusOf, w }) {
  const { t } = usePrefs();
  let node = null;
  const find = (n) => { if (n.activities.some((x) => x.id === a.id)) node = n; n.children.forEach(find); };
  data.roots.forEach(find);
  if (!node) return null;
  const codeOf = new Map((data.codes || []).map((c) => [c.id, c]));
  const cats = (x) => codeOf.get((x.codeIds || [])[0])?.categories || [];
  const list = node.activities;
  const sum = (k) => list.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const wfSum = sum("wf");
  // the node's progress: the activities' progress weighted by W.F, over the W.F that has one
  const known = list.filter((x) => x.pct != null);
  const kw = known.reduce((s, x) => s + (Number(x.wf) || 0), 0);
  const prog = kw > 0 ? known.reduce((s, x) => s + (Number(x.wf) || 0) * x.pct, 0) / kw : null;
  return (
    <div data-sub="pms">
      <p className="sm muted">{t("ep.dp.pmsNote")} <b className="mono" dir="ltr">{node.code}</b> — {node.name}</p>
      <div className="tablewrap"><TableKit name="eps-report-pms" min={1}><table className="dtable">
        <thead><tr><th>WBS NO.</th>{["A", "B", "C", "D", "E", "F", "G", "H"].map((x) => <th key={x}>Category {x}</th>)}<th>ACTIVITY NO.</th><th>Description</th><th>Unit</th>
          <th>W.F</th><th>W.V</th><th>Actual Weight</th><th>Progress</th><th>Total Work</th><th>Status</th><th>Original Start</th><th>Orig. Durat</th><th>Original Finish</th></tr></thead>
        <tbody>{list.map((x) => (
          <tr key={x.id} data-pms-row={x.code} style={{ fontWeight: x.id === a.id ? 600 : undefined }}>
            <td className="mono" dir="ltr">{node.code}</td>{Array.from({ length: 8 }, (_, i) => <td key={i} className="sm">{cats(x)[i] || ""}</td>)}
            <td className="mono" dir="ltr">{x.code}</td><td>{x.name}</td><td>{x.unit || ""}</td>
            <td className="mono">{w(x.wf)}</td><td className="mono">{w(x.wv, 10)}</td>
            <td className="mono">{fmt(x.volumeActual)}</td><td className="mono"><b>{x.pct == null ? "—" : `${fmt(x.pct)}%`}</b></td><td className="mono">{fmt(x.done)}</td>
            <td>{statusOf(x)}</td><td className="mono">{day(x.plan_start)}</td><td className="mono">{fmt(x.planDays)}</td><td className="mono">{day(x.plan_end)}</td></tr>))}
          <tr data-pms-total><td colSpan={12} /><td className="mono"><b>{w(wfSum)}</b></td><td className="mono"><b>{w(sum("wv"), 10)}</b></td>
            <td className="mono"><b>{fmt(sum("volumeActual"))}</b></td><td className="mono"><b>{prog == null ? "—" : `${fmt(prog)}%`}</b></td><td className="mono"><b>{fmt(sum("done"))}</b></td><td colSpan={4} /></tr>
        </tbody></table></TableKit></div>
    </div>);
}

/** Image 10: the narrative rows of this report, with their category, its parent and the report's number and date. */
function Narrative({ r }) {
  const { t } = usePrefs();
  const { fmt, day } = useEpsFmt();
  if (!r) return <p className="muted">{t("common.loading")}</p>;
  const cat = new Map();
  const walk = (ns, parent) => ns.forEach((n) => { cat.set(n.id, { name: n.name, parent: parent?.name || null, top: parent ? cat.get(parent.id)?.top || parent.name : null }); walk(n.children || [], n); });
  walk(r.narrativeTree || [], null);
  const rows = (r.content?.narrative || []).map((x) => effective(x)).filter((x) => !x.removed);
  if (!rows.length) return <p className="empty-note">{t("ep.dp.noNarrative")}</p>;
  return (
    <div data-sub="narrative" className="tablewrap"><TableKit name="eps-report-narrative" min={1}><table className="dtable">
      <thead><tr><th>Narrative Name</th><th>Narrative Discipline</th><th>Narrative Group</th><th>Period NO.</th><th>Period Date</th><th>Row</th><th>Activity Title</th>
        <th>Activity Description</th><th>unit</th><th>Total Weight</th><th>Remark</th></tr></thead>
      <tbody>{rows.map((x, i) => { const c = cat.get(x.categoryId) || {}; return (
        <tr key={i} data-narrative={i + 1}><td>{c.name || "—"}</td><td>{c.top || c.parent || "—"}</td><td>{c.parent || "—"}</td>
          <td className="mono">{r.report?.report_no}</td><td className="mono">{day(String(r.report?.report_date || "").slice(0, 10))}</td>
          <td className="mono" style={{ background: "rgba(231,76,60,.25)" }}>{i + 1}</td><td>{x.title || ""}</td><td>{x.description || ""}</td><td>{x.unit || ""}</td>
          <td className="mono">{fmt(x.qty, 4)}</td><td className="sm">{x.notes || ""}</td></tr>); })}</tbody></table></TableKit></div>);
}
