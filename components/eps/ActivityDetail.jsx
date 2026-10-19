"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ScopeTab } from "./ScopePanel";
import { usePrefs } from "../../lib/client/prefs.mjs";
import { BUDGET_UNITS as BUDGET_FA, ROLE_STATUS as ROLE_FA } from "../../lib/eps/activities.mjs";

import TableKit from "../ui/TableKit";
/**
 * The detail sub-forms under the activity view, for the selected activity
 * (owner's «PMS» document: images 1–9 and 11–12). Every figure comes from the
 * server (lib/db/repos/eps-activities.mjs activityDetail); a form here only
 * sends what a person typed.
 *
 *   detail     planned and actual status, budget, weights, float; the
 *              activity's own fields (editable on the activity page)
 *   workfront  its days from planned start to finish: plan, done, cumulative, cost
 *   groups     the versions (planning groups) that carry an activity of its code
 *   relations  predecessors and successors
 *   progress   done against its actual volume
 *   roles      contract resources on it and their cost
 *   reports    its lines in the daily reports (editable as each report's workflow allows)
 *   codes      its activity codes
 *   overall    its lines in the delay claim, against the master plan
 *   docs       the photos and files of the reports its work is in
 *   scope      its link to the platform's records (components/eps/ScopePanel.jsx)
 */
/** The sub-forms, in the owner's P6 order; their titles are `ep.tab.<key>`. */
export const TABS = ["detail", "workfront", "groups", "relations", "progress", "roles", "reports", "codes", "overall", "docs", "scope"];
/** An activity's state from what was done: done, in progress, not started. */
export function statusKey(a) {
  if ((a.pct != null && a.pct >= 100) || a.actual_end) return "ep.st.done";
  if (a.done > 0 || a.actual_start) return "ep.st.active";
  return "ep.st.idle";
}
/** Numbers and dates as the reader's language writes them, and an activity's state in words. */
export function useEpsFmt() {
  const { num, date, t } = usePrefs();
  return useMemo(() => ({
    fmt: (v, d = 2) => (v == null || v === "" ? "—" : num(Number(v), { maximumFractionDigits: d })),
    // a bare day is a local day, not UTC midnight
    day: (d) => (d ? date(/^\d{4}-\d\d-\d\d$/.test(d) ? `${d}T00:00:00` : d) : "—"),
    statusOf: (a) => t(statusKey(a)),
  }), [num, date, t]);
}
const KV = ({ k, v }) => <div className="kv"><span>{k}</span><b>{v}</b></div>;

export default function ActivityDetail({ d, tab, may, post, acts = [], codes = [], resources = [], companies = [], projectId, readOnly = false, labels = null }) {
  const a = d.activity;
  switch (tab) {
    case "detail": return <Detail a={a} may={may && !readOnly} post={post} />;
    case "workfront": return <WorkFront wf={d.workFront} unit={a.unit} />;
    case "groups": return <Groups groups={d.groups} />;
    case "relations": return <Relations d={d} may={may && !readOnly} post={post} acts={acts} />;
    case "progress": return <Progress a={a} codes={d.codes} />;
    case "roles": return <Roles d={d} may={may && !readOnly} post={post} resources={resources} />;
    case "reports": return <Reports d={d} post={post} companies={companies} />;
    case "codes": return <Codes d={d} may={may && !readOnly} post={post} codes={codes} />;
    case "overall": return <Overall d={d} may={may && !readOnly} post={post} />;
    case "docs": return <Docs d={d} projectId={projectId} />;
    case "scope": return <ScopeTab d={d} may={may && !readOnly} post={post} L={(labels || d.labels).scope} />;
    default: return null;
  }
}

function Detail({ a, may, post }) {
  const { t } = usePrefs();
  const { fmt, day, statusOf } = useEpsFmt();
  const [f, setF] = useState(null);
  const open = () => setF({ name: a.name, wf: a.wf ?? "", description: a.description || "", progress: a.progress ?? "",
    planStart: a.own?.plan_start || "", planEnd: a.own?.plan_end || "", actualStart: a.own?.actual_start || "", actualEnd: a.own?.actual_end || "",
    volumePlan: a.own?.volume_plan ?? "", volumeActual: a.own?.volume_actual ?? "" });
  const costDone = a.budgetPlan != null && a.pct != null ? (a.budgetPlan * a.pct) / 100 : null;
  return (
    <div>
      <p className="row" style={{ gap: 12, alignItems: "center" }}><b className="mono" dir="ltr">{a.code}</b> <span>{a.name}</span>
        <span className="sm muted">{t("ep.node")} <span className="mono" dir="ltr">{a.node_code}</span> — {a.node_name}</span>
        {a.template_code && <span className="sm muted">{t("ep.template")} <span className="mono">{a.template_code}</span></span>}
        {may && !f && <button className="btn ghost sm" type="button" onClick={open}>{t("ep.editActivity")}</button>}</p>
      <div className="p6-kv">
        <fieldset><legend>{t("ep.d.original")}</legend>
          <KV k={t("ep.start")} v={day(a.plan_start)} /><KV k={t("ep.durDays")} v={fmt(a.planDays)} /><KV k={t("ep.finish")} v={day(a.plan_end)} />
          <KV k={t("ep.d.remainDays")} v={fmt(a.remainDays)} /></fieldset>
        <fieldset><legend>{t("ep.d.actual")}</legend>
          <KV k={t("ep.start")} v={day(a.actual_start)} /><KV k={t("ep.durDays")} v={fmt(a.actualDays)} /><KV k={t("ep.finish")} v={day(a.actual_end)} />
          <KV k={t("ep.status")} v={statusOf(a)} /><KV k={t(a.scopeLinked ? "ep.d.pctPlatform" : "ep.d.pctReports")} v={a.pct == null ? t("ep.d.pctUnknown") : `${fmt(a.pct)}%`} />
          <KV k={t("ep.manualPct")} v={a.progress == null ? "—" : `${fmt(a.progress)}%`} /></fieldset>
        <fieldset><legend>{t("ep.d.budget")}</legend>
          <KV k={t("ep.d.budgetPlan")} v={fmt(a.budgetPlan)} /><KV k={t("ep.d.budgetActual")} v={fmt(a.budgetActual)} />
          <KV k={t("ep.d.costDone")} v={fmt(costDone)} /></fieldset>
        <fieldset><legend>{t("ep.d.weight")}</legend>
          <KV k="W.F" v={a.wf == null ? "—" : `${fmt(a.wf, 4)}%`} /><KV k="W.V" v={a.wv == null ? "—" : `${fmt(a.wv, 6)}%`} />
          <KV k={t("ep.d.volPlan", { unit: a.unit || "" })} v={fmt(a.volumePlan)} /><KV k={t("ep.d.volActual")} v={fmt(a.volumeActual)} />
          <KV k={t("ep.d.done")} v={fmt(a.done)} /><KV k={t("ep.d.remain")} v={fmt(a.remain)} /></fieldset>
        <fieldset><legend>Float</legend><KV k={t("ep.d.freeFloat")} v={fmt(a.freeFloat)} /></fieldset>
      </div>
      {a.description && <p className="sm">{a.description}</p>}
      {f && (
        <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await post("/api/eps", { kind: "activity", nodeId: a.node_id, id: a.id, ...f }, () => t("ep.activitySaved"))) setF(null); }}>
          <div className="grid2">
            {[["name", t("ep.activityName")], ["wf", "W.F %"], ["progress", t("ep.manualPctField")], ["description", t("ep.description")]].map(([k, l]) => (
              <div className="field" key={k}><label htmlFor={`ad-${k}`}>{l}</label><input id={`ad-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required={k === "name"} /></div>))}
          </div>
          <p className="sm muted">{t("ep.d.ownHint")}</p>
          <div className="grid2">
            {[["planStart", t("ep.planStart"), "date"], ["planEnd", t("ep.planEnd"), "date"], ["actualStart", t("ep.actualStart"), "date"], ["actualEnd", t("ep.actualEnd"), "date"],
              ["volumePlan", t("ep.volPlan"), "text"], ["volumeActual", t("ep.volActual"), "text"]].map(([k, l, ty]) => (
              <div className="field" key={k}><label htmlFor={`ad-${k}`}>{l}</label><input id={`ad-${k}`} type={ty} dir="ltr" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>))}
          </div>
          <button className="btn" type="submit">{t("ep.save")}</button> <button className="btn ghost" type="button" onClick={() => setF(null)}>{t("ep.cancel")}</button>
        </form>)}
    </div>);
}

function WorkFront({ wf, unit }) {
  const { t } = usePrefs();
  const { fmt, day } = useEpsFmt();
  if (!wf.rows.length) return <p className="empty-note">{t("ep.wf.none")}</p>;
  return (
    <div>
      <p className="sm muted">{t("ep.wf.note", { days: fmt(wf.days), perDay: fmt(wf.perDay, 4), unit: unit || "" })}</p>
      <div className="tablewrap" style={{ maxHeight: 320 }}><TableKit name="eps-activitydetail-1" min={8}><table className="dtable">
        <thead><tr><th>{t("ep.date")}</th><th>{t("ep.wf.plan")}</th><th>{t("ep.wf.planCum")}</th><th>{t("ep.wf.planPct")}</th><th>{t("ep.wf.done")}</th><th>{t("ep.wf.doneCum")}</th>
          <th>{t("ep.wf.dayPct")}</th><th>{t("ep.wf.cumPct")}</th><th>{t("ep.wf.cost")}</th><th>{t("ep.wf.costCum")}</th></tr></thead>
        <tbody>{wf.rows.map((r) => (
          <tr key={r.date} style={{ opacity: r.inPlan ? 1 : 0.7 }} data-wf-day={r.date}><td className="mono">{day(r.date)}{!r.inPlan && <span className="sm muted"> {t("ep.wf.outside")}</span>}</td>
            <td className="mono">{fmt(r.plan, 3)}</td><td className="mono">{fmt(r.planCum, 3)}</td><td className="mono">{fmt(r.planPct)}</td>
            <td className="mono">{r.done ? fmt(r.done, 3) : ""}</td><td className="mono">{fmt(r.doneCum, 3)}</td><td className="mono">{r.done ? fmt(r.donePct) : ""}</td>
            <td className="mono">{fmt(r.doneCumPct)}</td><td className="mono">{r.done ? fmt(r.cost) : ""}</td><td className="mono">{fmt(r.costCum)}</td></tr>))}</tbody></table></TableKit></div>
    </div>);
}

function Groups({ groups }) {
  const { t } = usePrefs();
  const { fmt, day } = useEpsFmt();
  return (
    <div className="tablewrap"><TableKit name="eps-activitydetail-2" min={8}><table className="dtable">
      <thead><tr><th>PMS</th><th>{t("ep.g.version")}</th><th>{t("ep.title")}</th><th>{t("ep.description")}</th><th>{t("ep.g.registered")}</th><th>{t("ep.start")}</th><th>{t("ep.dur")}</th><th>{t("ep.finish")}</th><th>{t("ep.g.lastWork")}</th>
        <th>{t("ep.volume")}</th><th>W.V</th><th>{t("ep.done")}</th><th>{t("ep.remain")}</th><th>{t("ep.progress")}</th></tr></thead>
      <tbody>{groups.map((g) => (
        <tr key={g.versionId} style={{ fontWeight: g.current ? 600 : undefined }} data-group={g.code}>
          <td className="mono">{g.pms}</td><td className="mono">{g.code}{g.master && <span className="chip" style={{ marginInlineStart: 4 }}>Master</span>}{g.current && <span className="sm muted"> {t("ep.g.this")}</span>}</td>
          <td>{g.title}</td><td className="sm">{g.description || "—"}</td><td className="mono">{day(g.registered)}</td>
          <td className="mono">{day(g.plan_start)}</td><td className="mono">{fmt(g.planDays)}</td><td className="mono">{day(g.plan_end)}</td><td className="mono">{day(g.lastWork)}</td>
          <td className="mono">{fmt(g.volumeActual)}</td><td className="mono">{g.wv == null ? "—" : `${fmt(g.wv, 6)}%`}</td><td className="mono">{fmt(g.done)}</td>
          <td className="mono">{fmt(g.remain)}</td><td className="mono">{g.pct == null ? "—" : `${fmt(g.pct)}%`}</td></tr>))}</tbody></table></TableKit></div>);
}

function Relations({ d, may, post, acts }) {
  const { t } = usePrefs();
  const { fmt, day } = useEpsFmt();
  const [f, setF] = useState({ side: "pred", other: "", relType: "FS", lag: "0" });
  const table = (list, title, color, side) => (
    <div style={{ flex: 1, minWidth: 320 }}>
      <h3 style={{ background: color, color: "#fff", padding: "3px 8px", margin: 0, fontSize: 13 }}>— {title} —</h3>
      <TableKit name="eps-activitydetail-3" min={8}><table className="dtable"><thead><tr><th>{t("ep.code")}</th><th>{t("ep.activityName")}</th><th>WBS</th><th>{t("ep.type")}</th><th>Lag</th><th>{t("ep.start")}</th><th>{t("ep.dur")}</th>{may && <th />}</tr></thead>
        <tbody>{list.map((r) => (
          <tr key={r.id} data-rel={`${side}:${r.code}`}><td className="mono" dir="ltr">{r.code}</td><td>{r.name}</td><td className="mono sm" dir="ltr">{r.wbs}</td>
            <td className="mono">{r.rel_type}</td><td className="mono">{r.lag}</td><td className="mono">{day(r.plan_start)}</td><td className="mono">{fmt(r.planDays)}</td>
            {may && <td><button className="btn ghost sm" type="button" onClick={() => post("/api/eps/activities", { kind: "relation-remove", id: r.id }, () => t("ep.rel.removed"))}>{t("ep.remove")}</button></td>}</tr>))}
          {list.length === 0 && <tr><td colSpan={8} className="muted sm">—</td></tr>}</tbody></table></TableKit></div>);
  return (
    <div>
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
        {table(d.predecessors, t("ep.rel.preds"), "#1e8449", "pred")}{table(d.successors, t("ep.rel.succs"), "#c0392b", "succ")}</div>
      {may && (
        <form className="row" style={{ gap: 6, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const [predId, succId] = f.side === "pred" ? [f.other, d.activity.id] : [d.activity.id, f.other];
            if (await post("/api/eps/activities", { kind: "relation", predId, succId, relType: f.relType, lag: f.lag }, () => t("ep.rel.saved"))) setF({ ...f, other: "" });
          }}>
          <div className="field"><label htmlFor="rl-side">{t("ep.add")}</label><select id="rl-side" value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })}>
            <option value="pred">{t("ep.rel.pred")}</option><option value="succ">{t("ep.rel.succ")}</option></select></div>
          <div className="field"><label htmlFor="rl-other">{t("ep.activity")}</label><select id="rl-other" required value={f.other} onChange={(e) => setF({ ...f, other: e.target.value })}>
            <option value="">—</option>{acts.filter((x) => x.id !== d.activity.id).map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select></div>
          <div className="field"><label htmlFor="rl-type">{t("ep.type")}</label><select id="rl-type" value={f.relType} onChange={(e) => setF({ ...f, relType: e.target.value })}>
            {["FS", "SS", "FF", "SF"].map((x) => <option key={x}>{x}</option>)}</select></div>
          <div className="field" style={{ width: 80 }}><label htmlFor="rl-lag">{t("ep.rel.lag")}</label><input id="rl-lag" dir="ltr" value={f.lag} onChange={(e) => setF({ ...f, lag: e.target.value })} /></div>
          <button className="btn" type="submit">{t("ep.rel.add")}</button>
        </form>)}
    </div>);
}

function Progress({ a, codes }) {
  const { t } = usePrefs();
  const { fmt, day, statusOf } = useEpsFmt();
  const cats = codes[0]?.categories || [];
  return (
    <div className="tablewrap"><TableKit name="eps-activitydetail-4" min={8}><table className="dtable">
      <thead><tr>{["A", "B", "C", "D", "E", "F", "G", "H"].map((x) => <th key={x}>Category {x}</th>)}<th>Activity No.</th><th>Description</th><th>Unit</th>
        <th>W.F</th><th>W.V</th><th>Actual weight</th><th>Progress</th><th>Total work</th><th>Status</th><th>Original start</th><th>Orig. dur.</th><th>Original finish</th></tr></thead>
      <tbody><tr data-progress={a.code}>{Array.from({ length: 8 }, (_, i) => <td key={i} className="sm">{cats[i] || "—"}</td>)}
        <td className="mono" dir="ltr">{a.code}</td><td>{a.name}</td><td>{a.unit || "—"}</td><td className="mono">{a.wf == null ? "—" : `${fmt(a.wf, 4)}%`}</td>
        <td className="mono">{a.wv == null ? "—" : `${fmt(a.wv, 6)}%`}</td><td className="mono">{fmt(a.volumeActual)}</td>
        <td className="mono"><b>{a.pct == null ? t("ep.unknown") : `${fmt(a.pct)}%`}</b></td><td className="mono">{fmt(a.done)}</td><td>{statusOf(a)}</td>
        <td className="mono">{day(a.plan_start)}</td><td className="mono">{fmt(a.planDays)}</td><td className="mono">{day(a.plan_end)}</td></tr></tbody></table></TableKit>
      <p className="sm muted">{t("ep.pr.note")}</p></div>);
}

function Roles({ d, may, post, resources }) {
  const { t, L } = usePrefs();
  const { fmt, day } = useEpsFmt();
  const blank = { id: null, resourceId: "", budgetUnit: "hour", perDay: "", rate: "", actualTime: "", status: "planned", remark: "" };
  const [f, setF] = useState(blank);
  const a = d.activity;
  return (
    <div>
      <div className="tablewrap"><TableKit name="eps-activitydetail-5" min={8}><table className="dtable">
        <thead><tr><th>Activity No.</th><th>{t("ep.ro.role")}</th><th>{t("ep.category")}</th><th>{t("ep.start")}</th><th>{t("ep.dur")}</th><th>{t("ep.finish")}</th><th>{t("ep.ro.budgetUnit")}</th><th>{t("ep.ro.perDay")}</th><th>{t("ep.ro.rate")}</th>
          <th>{t("ep.ro.totalTime")}</th><th>{t("ep.ro.totalPrice")}</th><th>{t("ep.ro.actualTime")}</th><th>{t("ep.ro.actualPrice")}</th><th>{t("ep.status")}</th><th>{t("ep.remark")}</th>{may && <th />}</tr></thead>
        <tbody>{d.roles.map((r) => (
          <tr key={r.id} data-role={r.resource_name}><td className="mono" dir="ltr">{a.code}</td><td>{r.resource_name}</td><td className="sm">{r.category || "—"}</td>
            <td className="mono">{day(a.plan_start)}</td><td className="mono">{fmt(a.planDays)}</td><td className="mono">{day(a.plan_end)}</td>
            <td>{L(`eps.budgetUnit.${r.budget_unit}`, BUDGET_FA[r.budget_unit])}</td><td className="mono">{fmt(r.per_day)}</td><td className="mono">{fmt(r.rate)}</td>
            <td className="mono">{fmt(r.totalTime)}</td><td className="mono"><b>{fmt(r.totalPrice)}</b></td><td className="mono">{fmt(r.actualTime)}</td><td className="mono">{fmt(r.actualPrice)}</td>
            <td>{L(`eps.roleStatus.${r.status}`, ROLE_FA[r.status])}</td><td className="sm">{r.remark || ""}</td>
            {may && <td style={{ whiteSpace: "nowrap" }}><button className="btn ghost sm" type="button" onClick={() => setF({ id: r.id, resourceId: r.resource_id, budgetUnit: r.budget_unit, perDay: r.per_day ?? "",
              rate: r.rate ?? "", actualTime: r.actual_time ?? "", status: r.status, remark: r.remark || "" })}>{t("ep.edit")}</button>
              <button className="btn ghost sm" type="button" onClick={() => post("/api/eps/activities", { kind: "role-remove", id: r.id }, () => t("ep.removed"))}>{t("ep.remove")}</button></td>}</tr>))}
          {d.roles.length > 0 && <tr><td colSpan={10}><b>{t("ep.ro.total")}</b></td><td className="mono"><b>{fmt(d.roles.reduce((s, r) => s + (r.totalPrice || 0), 0))}</b></td><td />
            <td className="mono"><b>{fmt(d.roles.reduce((s, r) => s + (r.actualPrice || 0), 0))}</b></td><td colSpan={may ? 3 : 2} /></tr>}</tbody></table></TableKit></div>
      {may && (
        <form className="row" style={{ gap: 6, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}
          onSubmit={async (e) => { e.preventDefault(); if (await post("/api/eps/activities", { kind: "role", activityId: a.id, ...f }, () => t("ep.ro.saved"))) setF(blank); }}>
          <div className="field"><label htmlFor="ro-res">{t("ep.ro.roleField")}</label><select id="ro-res" required value={f.resourceId} onChange={(e) => setF({ ...f, resourceId: e.target.value })}>
            <option value="">—</option>{resources.map((r) => <option key={r.id} value={r.id}>{r.name}{r.unit ? ` (${r.unit})` : ""}</option>)}</select></div>
          <div className="field"><label htmlFor="ro-bu">{t("ep.ro.budgetUnit")}</label><select id="ro-bu" value={f.budgetUnit} onChange={(e) => setF({ ...f, budgetUnit: e.target.value })}>
            {Object.keys(BUDGET_FA).map((k) => <option key={k} value={k}>{L(`eps.budgetUnit.${k}`, BUDGET_FA[k])}</option>)}</select></div>
          {[["perDay", t(f.budgetUnit === "unit" ? "ep.ro.qtyTotal" : "ep.ro.perDay")], ["rate", t("ep.ro.rateField")], ["actualTime", t("ep.ro.actualTime")], ["remark", t("ep.remark")]].map(([k, l]) => (
            <div className="field" key={k} style={{ width: k === "remark" ? 180 : 110 }}><label htmlFor={`ro-${k}`}>{l}</label><input id={`ro-${k}`} dir={k === "remark" ? undefined : "ltr"} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>))}
          <div className="field"><label htmlFor="ro-st">{t("ep.status")}</label><select id="ro-st" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {Object.keys(ROLE_FA).map((k) => <option key={k} value={k}>{L(`eps.roleStatus.${k}`, ROLE_FA[k])}</option>)}</select></div>
          <button className="btn" type="submit">{f.id ? t("ep.save") : t("ep.ro.add")}</button>{f.id && <button className="btn ghost" type="button" onClick={() => setF(blank)}>{t("ep.cancel")}</button>}
        </form>)}
      {resources.length === 0 && <p className="sm muted">{t("ep.ro.noResources")}</p>}
    </div>);
}

function Reports({ d, post, companies }) {
  const { t } = usePrefs();
  const { fmt, day } = useEpsFmt();
  const [edit, setEdit] = useState(null);
  const a = d.activity;
  if (!d.reports.length) return <p className="empty-note">{t("ep.rp.none")}</p>;
  return (
    <div className="tablewrap"><table className="dtable">
      <thead><tr><th>{t("ep.activity")}</th><th>{t("ep.rp.area")}</th><th>Mark</th><th>{t("ep.unit")}</th><th>{t("ep.rp.qty")}</th><th>{t("ep.rp.report")}</th><th>{t("ep.date")}</th><th>{t("ep.rp.stage")}</th><th>{t("ep.remark")}</th><th /></tr></thead>
      <tbody>{d.reports.map((l) => {
        const m = d.reportMay?.[l.reportId];
        const mine = edit && edit.rowId === l.rowId && edit.reportId === l.reportId;
        return (
          <tr key={`${l.reportId}-${l.rowId}`} data-line={`${l.reportNo}`}>
            <td className="sm"><span className="mono" dir="ltr">{a.code}</span> {a.name}</td>
            <td>{mine ? <select aria-label={t("ep.rp.areaShort")} value={edit.areaId || ""} onChange={(e) => setEdit({ ...edit, areaId: e.target.value })}><option value="">—</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : l.areaName || "—"}</td>
            <td>{mine ? <input aria-label="Mark" value={edit.mark || ""} onChange={(e) => setEdit({ ...edit, mark: e.target.value })} style={{ width: 80 }} /> : l.mark || "—"}</td>
            <td>{a.unit || "—"}</td>
            <td className="mono">{mine ? <input aria-label={t("ep.qty")} dir="ltr" value={edit.qty} onChange={(e) => setEdit({ ...edit, qty: e.target.value })} style={{ width: 90 }} /> : <b>{fmt(l.qty, 4)}</b>}</td>
            <td className="mono"><Link href={`/contract-reports?id=${l.reportId}`}>{l.reportNo}</Link></td><td className="mono">{day(l.date)}</td>
            <td className="sm">{l.status === "approved" ? t("ep.rp.approved") : l.stageName || "—"}</td><td className="sm">{l.notes || ""}</td>
            <td style={{ whiteSpace: "nowrap" }}>{m?.edit ? (mine ? <>
              <button className="btn sm" type="button" onClick={async () => { if (await post("/api/eps/activities", { kind: "progress-edit", reportId: l.reportId, rowId: l.rowId, qty: edit.qty, areaId: edit.areaId, mark: edit.mark }, () => t("ep.rp.saved"))) setEdit(null); }}>{t("ep.save")}</button>
              <button className="btn ghost sm" type="button" onClick={() => setEdit(null)}>{t("ep.cancel")}</button></> : <>
              <button className="btn ghost sm" type="button" onClick={() => setEdit({ reportId: l.reportId, rowId: l.rowId, qty: String(l.qty), areaId: l.areaId || "", mark: l.mark || "" })}>{t("ep.edit")}</button>
              <button className="btn ghost sm" type="button" onClick={() => post("/api/eps/activities", { kind: "progress-edit", reportId: l.reportId, rowId: l.rowId, remove: true }, () => t("ep.rp.rowRemoved"))}>{t("ep.remove")}</button></>)
              : <span className="sm muted" title={m?.why || ""}>{t("ep.viewOnly")}</span>}</td>
          </tr>);
      })}
        <tr><td colSpan={4}><b>{t("ep.total")}</b></td><td className="mono"><b>{fmt(d.reports.reduce((s, l) => s + Number(l.qty || 0), 0), 4)}</b></td><td colSpan={5} /></tr></tbody></table>
      <p className="sm muted">{t("ep.rp.note")}</p></div>);
}

function Codes({ d, may, post, codes }) {
  const { t } = usePrefs();
  const [pick, setPick] = useState("");
  const have = new Set(d.codes.map((c) => c.id));
  return (
    <div>
      <div className="tablewrap"><TableKit name="eps-activitydetail-7" min={8}><table className="dtable">
        <thead><tr><th>Activity No.</th><th>Active Code</th><th>{t("ep.cd.kind")}</th>{["A", "B", "C", "D", "E", "F"].map((x) => <th key={x}>Category {x}</th>)}<th>Unit</th><th>Valid</th><th>Remark</th>{may && <th />}</tr></thead>
        <tbody>{d.codes.map((c) => (
          <tr key={c.id} data-code={c.code}><td className="mono" dir="ltr">{d.activity.code}</td><td className="mono" dir="ltr">{c.code}</td><td>{c.name}</td>
            {Array.from({ length: 6 }, (_, i) => <td key={i} className="sm">{c.categories?.[i] || "—"}</td>)}<td>{c.unit || "—"}</td><td>{c.valid ? "✓" : "✗"}</td><td className="sm">{c.remark || ""}</td>
            {may && <td><button className="btn ghost sm" type="button" onClick={() => post("/api/eps/activities", { kind: "code-assign", codeId: c.id, activityIds: [d.activity.id], remove: true }, () => t("ep.cd.taken"))}>{t("ep.cd.take")}</button></td>}</tr>))}
          {d.codes.length === 0 && <tr><td colSpan={13} className="muted sm">{t("ep.cd.none")}</td></tr>}</tbody></table></TableKit></div>
      {may && (
        <form className="row" style={{ gap: 6, alignItems: "end", marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); if (await post("/api/eps/activities", { kind: "code-assign", codeId: pick, activityIds: [d.activity.id] }, () => t("ep.cd.given"))) setPick(""); }}>
          <div className="field"><label htmlFor="cd-pick">{t("ep.cd.code")}</label><select id="cd-pick" required value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">—</option>{codes.filter((c) => c.valid && !have.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select></div>
          <button className="btn" type="submit">{t("ep.cd.give")}</button> <Link className="sm" href="/eps/codes">{t("ep.cd.define")}</Link>
        </form>)}
    </div>);
}

function Overall({ d, may, post }) {
  const { t } = usePrefs();
  const { fmt, day } = useEpsFmt();
  const blank = { id: null, description: "", delayCode: "", acceptStart: "", acceptFinish: "", critical: false, remark: "" };
  const [f, setF] = useState(blank);
  const a = d.activity;
  return (
    <div>
      {!d.baseline && <p className="sm" style={{ color: "var(--warn)" }}>{t("ep.ov.noBaseline")}</p>}
      {d.baseline && <p className="sm muted">{t("ep.ov.baseline", { from: day(d.baseline.plan_start), to: day(d.baseline.plan_end), days: fmt(d.baseline.planDays) })} <span className="mono">{d.baseline.version}</span></p>}
      <div className="tablewrap"><TableKit name="eps-activitydetail-8" min={8}><table className="dtable">
        <thead><tr><th>No.</th><th>Description</th><th>Delay code</th><th>WBS</th><th>Task name</th><th>Actual start</th><th>Act. dur.</th><th>Actual finish</th>
          <th>Start delay</th><th>Delay (day)</th><th>Finish delay</th><th>Baseline start</th><th>Base dur.</th><th>Baseline finish</th><th>Free float</th>
          <th>Accept start</th><th>Accp. delay</th><th>Accept finish</th><th>Critical</th><th>Remark</th>{may && <th />}</tr></thead>
        <tbody>{d.delays.map((x) => (
          <tr key={x.id} data-delay={x.no}><td className="mono">{x.no}</td><td>{x.description}</td><td className="mono">{x.delay_code || "—"}</td><td className="mono sm" dir="ltr">{a.node_code}</td><td className="sm">{a.name}</td>
            <td className="mono">{day(x.actualStart)}</td><td className="mono">{fmt(x.actualDays)}</td><td className="mono">{day(x.actualFinish)}</td>
            <td className="mono">{fmt(x.startDelay)}</td><td className="mono" style={{ background: "rgba(255,170,120,.15)" }}><b>{fmt(x.delay)}</b></td><td className="mono">{fmt(x.finishDelay)}</td>
            <td className="mono">{day(x.baselineStart)}</td><td className="mono">{fmt(x.baselineDays)}</td><td className="mono">{day(x.baselineFinish)}</td><td className="mono">{fmt(a.freeFloat)}</td>
            <td className="mono">{day(x.acceptStart)}</td><td className="mono"><b>{fmt(x.acceptDelay)}</b></td><td className="mono">{day(x.acceptFinish)}</td>
            <td>{x.critical ? "✓" : ""}</td><td className="sm">{x.remark || ""}</td>
            {may && <td style={{ whiteSpace: "nowrap" }}><button className="btn ghost sm" type="button" onClick={() => setF({ id: x.id, description: x.description, delayCode: x.delay_code || "",
              acceptStart: x.acceptStart || "", acceptFinish: x.acceptFinish || "", critical: x.critical, remark: x.remark || "" })}>{t("ep.edit")}</button>
              <button className="btn ghost sm" type="button" onClick={() => post("/api/eps/activities", { kind: "delay-remove", id: x.id }, () => t("ep.removed"))}>{t("ep.remove")}</button></td>}</tr>))}
          {d.delays.length === 0 && <tr><td colSpan={21} className="muted sm">{t("ep.ov.none")}</td></tr>}</tbody></table></TableKit></div>
      {may && (
        <form className="row" style={{ gap: 6, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}
          onSubmit={async (e) => { e.preventDefault(); if (await post("/api/eps/activities", { kind: "delay", activityId: a.id, ...f }, () => t("ep.ov.saved"))) setF(blank); }}>
          <div className="field"><label htmlFor="dl-d">{t("ep.description")}</label><input id="dl-d" required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <div className="field" style={{ width: 100 }}><label htmlFor="dl-c">{t("ep.ov.code")}</label><input id="dl-c" dir="ltr" value={f.delayCode} onChange={(e) => setF({ ...f, delayCode: e.target.value })} /></div>
          <div className="field"><label htmlFor="dl-as">{t("ep.ov.acceptStart")}</label><input id="dl-as" type="date" value={f.acceptStart} onChange={(e) => setF({ ...f, acceptStart: e.target.value })} /></div>
          <div className="field"><label htmlFor="dl-af">{t("ep.ov.acceptFinish")}</label><input id="dl-af" type="date" value={f.acceptFinish} onChange={(e) => setF({ ...f, acceptFinish: e.target.value })} /></div>
          <label className="sm"><input type="checkbox" checked={f.critical} onChange={(e) => setF({ ...f, critical: e.target.checked })} /> {t("ep.ov.critical")}</label>
          <div className="field"><label htmlFor="dl-r">{t("ep.remark")}</label><input id="dl-r" value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></div>
          <button className="btn" type="submit">{f.id ? t("ep.save") : t("ep.ov.add")}</button>{f.id && <button className="btn ghost" type="button" onClick={() => setF(blank)}>{t("ep.cancel")}</button>}
        </form>)}
    </div>);
}

function Docs({ d, projectId }) {
  const { t } = usePrefs();
  const { day } = useEpsFmt();
  if (!d.files.length) return <p className="empty-note">{t("ep.doc.none")}</p>;
  return (
    <TableKit name="eps-activitydetail-9" min={8}><table className="dtable"><thead><tr><th>{t("ep.rp.report")}</th><th>{t("ep.date")}</th><th>{t("ep.type")}</th><th>{t("ep.name")}</th><th>{t("ep.description")}</th></tr></thead>
      <tbody>{d.files.map((f) => (
        <tr key={f.id}><td className="mono">{f.report_no}</td><td className="mono">{day(f.report_date)}</td><td>{t(f.kind === "photo" ? "ep.doc.photo" : "ep.doc.file")}</td>
          <td><a href={`/api/contract-reports?projectId=${projectId}&file=${f.id}`} target="_blank" rel="noreferrer">{f.name}</a></td><td className="sm">{f.caption || ""}</td></tr>))}</tbody></table></TableKit>);
}
