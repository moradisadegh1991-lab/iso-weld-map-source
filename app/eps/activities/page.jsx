"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import ActivityGrid, { useSplit } from "../../../components/eps/ActivityGrid";
import ActivityDetail, { useEpsFmt } from "../../../components/eps/ActivityDetail";
import { usePrefs } from "../../../lib/client/prefs.mjs";
import { COLUMNS, useVersion, wIn, wOut } from "../../../components/eps/shared";
import { NodeScope } from "../../../components/eps/ScopePanel";
import { COST_FIELDS, costValues } from "../../../lib/eps/costs.mjs";

import TableKit from "../../../components/ui/TableKit";
/**
 * The activity view of a PMS as one of its versions plans it (the master
 * plan unless another is picked), after Primavera P6: the WBS and its
 * activities as a tree table beside their Gantt chart, the details of the
 * selected activity below — the line between them dragged to share the
 * height. Activities are attached here from a template (only templates that
 * have activities are offered) or by hand. Which detail sub-forms show is
 * the user's choice, remembered in this browser.
 */
const read = (k, d) => { try { return JSON.parse(window.localStorage.getItem(k) || "null") ?? d; } catch { return d; } };
const write = (k, v) => { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const PAGE_TABS = ["detail", "scope", "workfront", "groups", "relations", "progress", "roles", "reports", "codes", "overall"];

export default function ActivitiesPage() {
  const { projectId, contractId, call } = usePlatform();
  const { pmsId, versionId, plan, picker } = useVersion(contractId);
  const { t } = usePrefs();
  const { data, error, reload } = useProjectData((id) => (plan ? `/api/eps/activities?projectId=${id}&${plan}` : null), [plan]);
  const [sel, setSel] = useState(null);                // the selected row {kind, id, item}
  const detail = useProjectData((id) => (sel?.kind === "act" ? `/api/eps/activities?projectId=${id}&activityId=${sel.id}${versionId ? `&versionId=${versionId}` : ""}` : null), [sel?.id, versionId]);
  const [tab, setTab] = useState("detail");
  const [tabs, setTabs] = useState(PAGE_TABS);
  const [pickTabs, setPickTabs] = useState(false);
  const [modal, setModal] = useState(null);            // "attach" | "manual"
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const { height, grip } = useSplit("p6-activities", 430);
  // the loaders of this render, for the row operations kept in a memo: they reload the activity selected now
  const live = useRef({});
  live.current = { reload, detail };
  useEffect(() => {
    // a sub-form added since the choice was saved shows until it is unticked
    const known = read("p6-activities:known", PAGE_TABS.filter((k) => k !== "scope"));
    const saved = read("p6-activities:tabs", PAGE_TABS);
    setTabs(PAGE_TABS.filter((k) => saved.includes(k) || !known.includes(k)));
  }, []);
  useEffect(() => { write("p6-activities:tabs", tabs); write("p6-activities:known", PAGE_TABS); if (!tabs.includes(tab) && tabs.length) setTab(tabs[0]); }, [tabs]); // eslint-disable-line react-hooks/exhaustive-deps
  async function post(url, body, done) {
    setMsg(null); setOk(null);
    try { const r = await call(url, { method: "POST", body: JSON.stringify({ projectId, pmsId, versionId, ...body }) }); reload(); detail.reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  // editing rows in place, adding under a node, cut / copy / paste / delete (owner's requirements 2026-10-18, items 4, 7, 15)
  const ops = useMemo(() => {
    if (!data?.may?.edit) return null;
    const send = ({ url = "/api/eps", ...body }) => call(url, { method: "POST", body: JSON.stringify({ projectId, pmsId, versionId, ...body }) });
    const batch = async (list, done) => {
      setMsg(null); setOk(null);
      try { for (const b of list) await send(b); live.current.reload(); live.current.detail.reload(); if (done) setOk(done); return true; }
      catch (e) { setMsg(e.message); live.current.reload(); return false; }
    };
    const own = (v) => ({ name: v.name, wf: wOut(v.wf), volumeActual: v.volActual === "" ? null : v.volActual,
      actType: v.actType, activityNo: v.activityNo, wfRate: v.wfRate === "" ? null : v.wfRate, description: v.description,
      ...Object.fromEntries(COST_FIELDS.map((f) => [f.key, v[f.key] === "" ? null : v[f.key]])) });
    const actBody = (v) => ({ ...own(v), planStart: v.start || null, planEnd: v.finish || null, volumePlan: v.volPlan === "" ? null : v.volPlan });
    const valueOf = (it) => ({ name: it.name ?? "", wf: wIn(it.wf), volPlan: it.volumePlan ?? "", volActual: it.volumeActual ?? "",
      start: it.plan_start ? String(it.plan_start).slice(0, 10) : "", finish: it.plan_end ? String(it.plan_end).slice(0, 10) : "",
      actType: it.act_type ?? "", activityNo: it.activity_no ?? "", wfRate: it.wf_rate ?? "", description: it.description ?? "", ...costValues(it) });
    // under a version that plans the activity, its dates and planned quantity are the version's row (owner's requirements 2026-10-22)
    const planned = (row) => !!(versionId && row.item?.plan);
    const toPlan = (row, v) => ({ url: "/api/eps/planning", kind: "plan-edit", id: row.item.plan.id, startOn: v.start || "", endOn: v.finish || "", volumePlan: v.volPlan });
    return {
      fields: (row) => (row.kind === "act" ? [{ key: "name", type: "text" }, { key: "actType", type: "text" }, { key: "activityNo", type: "text" },
        { key: "wf", type: "number" }, { key: "wfRate", type: "number" }, { key: "volPlan", type: "number" },
        { key: "volActual", type: "number" }, { key: "start", type: "date" }, { key: "finish", type: "date" }, { key: "description", type: "text" },
        ...COST_FIELDS.map((f) => ({ key: f.key, type: "number" }))] : []),
      value: (row) => valueOf(row.item),
      save: (row, v) => (planned(row) ? batch([{ kind: "activity", id: row.id, nodeId: row.item.node_id, ...own(v) }, toPlan(row, v)])
        : batch([{ kind: "activity", id: row.id, nodeId: row.item.node_id, ...actBody(v) }])),
      create: (node, v) => batch([{ kind: "activity", nodeId: node.id, ...actBody(v) }]),
      // here a node picked for deletion takes only its activities: nodes are deleted on the WBS page (owner's requirements 2026-10-22)
      removable: (rows) => rows.filter((x) => x.kind === "act"),
      remove: (rows) => batch(rows.filter((x) => x.kind === "act").map((x) => ({ kind: "activity-remove", id: x.id }))),
      paste: (node, rows, mode) => {
        const nodes = rows.filter((x) => x.kind === "node"), inNode = new Set(nodes.flatMap((n) => [n.id]));
        // an activity whose node is pasted too travels with it
        const lone = rows.filter((x) => x.kind === "act" && !inNode.has(x.parentId));
        const top = nodes.filter((n) => !inNode.has(n.parentId));
        return batch([
          ...top.map((n) => (mode === "cut" ? { kind: "node-move", id: n.id, parentId: node.id } : { kind: "node-copy", id: n.id, parentId: node.id })),
          ...lone.map((a) => ({ kind: "activity", nodeId: node.id, ...actBody(valueOf(a.item)) })),
          ...(mode === "cut" ? lone.map((a) => ({ kind: "activity-remove", id: a.id })) : []),
        ]);
      },
    };
  }, [data?.may?.edit, projectId, versionId, call]); // eslint-disable-line react-hooks/exhaustive-deps
  const acts = useMemo(() => {
    const out = []; const walk = (n) => { out.push(...n.activities); n.children.forEach(walk); }; (data?.roots || []).forEach(walk); return out;
  }, [data]);
  // keep the selection's figures current after a reload
  useEffect(() => {
    if (!sel || !data) return;
    const find = (ns) => { for (const n of ns) { if (n.id === sel.id) return n; const a = n.activities.find((x) => x.id === sel.id); if (a) return a; const c = find(n.children); if (c) return c; } return null; };
    const it = find(data.roots);
    if (!it) setSel(null); else if (it !== sel.item) setSel({ ...sel, item: it });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const head = (
    <div className="pagehead"><h1>{t("ep.ac.title")}</h1>
      <span className="sub">{picker} <Link href="/eps">{t("ep.link.board")}</Link> · <Link href="/eps/wbs">WBS</Link> · <Link href="/eps/codes">{t("ep.co.title")}</Link> · <Link href="/eps/scope">{t("ep.link.scope")}</Link> · <Link href="/eps/progress">{t("ep.link.entry")}</Link></span></div>);
  if (!contractId) return <div className="page"><div className="pagehead"><h1>{t("ep.ac.title")}</h1></div><p className="empty-note">{t("cs.pick")}</p></div>;
  if (error) return <div className="page">{head}<p className="err">{error}</p></div>;
  if (!plan) return <div className="page">{head}<p className="empty-note">{t("ep.noPlan")}</p></div>;
  if (!data) return <div className="page">{head}<p className="muted">{t("common.loading")}</p></div>;
  const may = data.may.edit;
  const node = sel ? (sel.kind === "node" ? sel.item : null) : null;
  const nodeOfSel = sel?.kind === "act" ? sel.item.node_id : sel?.id;
  const toolbar = may && <>
    <button type="button" className="btn sm" disabled={!nodeOfSel} title={nodeOfSel ? "" : t("ep.ac.pickFirst")} onClick={() => setModal("attach")}>{t("ep.ac.attach")}</button>
    <button type="button" className="btn ghost sm" disabled={!nodeOfSel} onClick={() => setModal("manual")}>{t("ep.ac.manual")}</button></>;
  const nodeName = (id) => { const f = (ns) => { for (const n of ns) { if (n.id === id) return n; const c = f(n.children); if (c) return c; } return null; }; return f(data.roots); };
  const target = nodeOfSel ? nodeName(nodeOfSel) : null;

  return (
    <div className="page">
      {head}
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg toast" role="status">{ok}</p>}
      {data.autoApplied?.length > 0 && <div className="card" data-auto-applied><b>{t("ep.ac.autoTitle")}</b><ul className="sm">{data.autoApplied.map((x) => (
        <li key={x.ruleId}>{x.error ? <span className="err">{x.error}</span> : [t("ep.ac.autoItems", { added: x.added, removed: x.removed }),
          x.made ? t("ep.ac.autoMade", { n: x.made }) : "", x.dropped ? t("ep.ac.autoDropped", { n: x.dropped }) : "", x.kept ? t("ep.ac.autoKept", { n: x.kept }) : ""].filter(Boolean).join(t("ep.sep"))}</li>))}</ul></div>}
      {data.scope?.some((x) => !x.rule.auto_apply && (x.pending.any || x.firstApply)) && <p className="sm" style={{ color: "var(--warn)" }}>
        {t("ep.ac.pendingLinks", { n: data.scope.filter((x) => !x.rule.auto_apply && (x.pending.any || x.firstApply)).length })} <Link href="/eps/scope">{t("ep.link.scope")}</Link></p>}
      {data.problems.length > 0 && <div className="card" style={{ borderColor: "var(--bad)" }}><b>{t("ep.ac.problems")}</b><ul className="sm">{data.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      <div style={{ height }}>
        <ActivityGrid data={data} columns={COLUMNS} defaultCols={["code", "actType", "activityNo", "name", "wf", "wfRate", "wv", "unit", "volActual", "done", "pct", "src", "start", "finish", "dur", "description", ...COST_FIELDS.map((f) => f.key)]}
          storeKey="p6-activities" customKey="eps-activities" selected={sel?.id} onSelect={(r) => setSel(r)} toolbar={toolbar} ops={ops} />
      </div>
      {grip}
      <div className="p6-detail">
        <div className="p6-tabs" role="tablist">
          {tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : undefined} onClick={() => setTab(k)}>{t(`ep.tab.${k}`)}</button>)}
          <span style={{ position: "relative", marginInlineStart: "auto" }}>
            <button type="button" className="btn ghost sm" onClick={() => setPickTabs(!pickTabs)}>{t("ep.ac.subforms")} ▾</button>
            {pickTabs && <div className="p6-chooser card">{PAGE_TABS.map((k) => (
              <label key={k} style={{ display: "block" }}><input type="checkbox" checked={tabs.includes(k)} onChange={() => setTabs(tabs.includes(k) ? tabs.filter((x) => x !== k) : PAGE_TABS.filter((x) => x === k || tabs.includes(x)))} /> {t(`ep.tab.${k}`)}</label>))}
              <button type="button" className="btn sm" onClick={() => setPickTabs(false)}>{t("ep.close")}</button></div>}
          </span>
        </div>
        {!sel && <p className="empty-note">{t("ep.ac.pick")}</p>}
        {node && <NodeSummary n={node} />}
        {node && <NodeScope node={node} state={data.scope?.find((x) => x.rule.node_id === node.id)} may={may} post={post} L={data.labels.scope} choices={data.scopeChoices} />}
        {sel?.kind === "act" && (detail.error ? <p className="err">{detail.error}</p> : !detail.data ? <p className="muted">{t("common.loading")}</p>
          : <ActivityDetail d={detail.data} tab={tab} may={may} post={post} acts={acts} labels={data.labels} codes={data.codes} resources={data.resources} companies={data.companies} projectId={projectId} />)}
      </div>
      {modal === "attach" && target && <Attach node={target} templates={data.templates} post={post} close={() => setModal(null)} />}
      {modal === "manual" && target && <Manual node={target} post={post} close={() => setModal(null)} />}
    </div>
  );
}

function NodeSummary({ n }) {
  const { t } = usePrefs();
  const { fmt, day, w } = useEpsFmt();
  return (
    <div className="p6-kv">
      <fieldset><legend>{t("ep.ac.wbsNode")}</legend>
        <div className="kv"><span>{t("ep.code")}</span><b dir="ltr">{n.code}</b></div><div className="kv"><span>{t("ep.name")}</span><b>{n.name}</b></div>
        <div className="kv"><span>W.F / W.V</span><b>{w(n.wf)} / {w(n.wv, 10)}</b></div>
        <div className="kv"><span>{t("ep.ac.weighted")}</span><b>{n.pct == null ? "—" : `${fmt(n.pct)}%`}</b></div></fieldset>
      <fieldset><legend>{t("ep.ac.plan")}</legend>
        <div className="kv"><span>{t("ep.ac.startEnd")}</span><b>{day(n.plan_start)} — {day(n.plan_end)}</b></div><div className="kv"><span>{t("ep.dur")}</span><b>{fmt(n.planDays)}</b></div>
        <div className="kv"><span>{t("ep.ac.budget")}</span><b>{fmt(n.budgetPlan)}</b></div><div className="kv"><span>{t("ep.link.activities")}</span><b>{n.activities.length} (Σ W.F {w(n.activityWf)})</b></div></fieldset>
    </div>);
}

/** Attach from a template: only templates that have activities; each one's activities shown before it is chosen. */
function Attach({ node, templates, post, close }) {
  const { t: tx } = usePrefs();          // `t` is the template here
  const { fmt, w } = useEpsFmt();
  const [pick, setPick] = useState(templates[0]?.id || "");
  const t = templates.find((x) => x.id === pick);
  const sep = node.code.match(/[.\-/_]/)?.[0] || ".";
  return (
    <div className="p6-modal" role="dialog" aria-label={tx("ep.ac.attachTitle")} onClick={close}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h2>{tx("ep.ac.attachTo")} <span className="mono" dir="ltr">{node.code}</span> — {node.name}</h2>
        {templates.length === 0 ? <p className="empty-note">{tx("ep.ac.noTemplates")}</p> : <>
          <div className="field"><label htmlFor="at-t">{tx("ep.template")}</label><select id="at-t" value={pick} onChange={(e) => setPick(e.target.value)}>
            {templates.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name} ({tx("ep.g.count", { n: x.activities.length })})</option>)}</select></div>
          {t && <TableKit name="eps-activities-1"><table className="dtable"><thead><tr><th>{tx("ep.ac.newCode")}</th><th>{tx("ep.col.template")}</th><th>{tx("ep.name")}</th><th>W.F</th><th>W.V</th><th>{tx("ep.ac.budget")}</th></tr></thead>
            <tbody>{t.activities.map((a) => (
              <tr key={a.id}><td className="mono" dir="ltr">{node.code}{sep}{String(a.number).slice(-2).padStart(2, "0")}</td><td className="mono">{a.code}</td><td>{a.name}</td>
                <td className="mono">{w(a.wf)}</td><td className="mono">{a.wf != null && node.wv != null ? w((a.wf * node.wv) / 100, 10) : "—"}</td>
                <td className="mono">{a.wf != null && node.budgetPlan != null ? fmt((a.wf * node.budgetPlan) / 100) : "—"}</td></tr>))}</tbody></table></TableKit>}
          <p className="sm muted">{tx("ep.ac.attachNote")}</p>
          <button className="btn" type="button" onClick={async () => { if (await post("/api/eps", { kind: "attach", nodeId: node.id, templateId: pick }, (r) => tx(r.row.skipped ? "ep.ac.attachedSkip" : "ep.ac.attached", { n: r.row.added, skipped: r.row.skipped }))) close(); }}>{tx("ep.ac.attachBtn")}</button></>}
        {" "}<button className="btn ghost" type="button" onClick={close}>{tx("ep.close")}</button>
      </div>
    </div>);
}

function Manual({ node, post, close }) {
  const { t } = usePrefs();
  const [f, setF] = useState({ code: "", name: "", wf: "", description: "" });
  return (
    <div className="p6-modal" role="dialog" aria-label={t("ep.ac.manualTitle")} onClick={close}>
      <form className="card" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => { e.preventDefault(); if (await post("/api/eps", { kind: "activity", nodeId: node.id, ...f, wf: wOut(f.wf) }, (r) => t("ep.ac.manualAdded", { code: r.row.code }))) close(); }}>
        <h2>{t("ep.ac.manualUnder")} <span className="mono" dir="ltr">{node.code}</span></h2>
        <div className="grid2">
          <div className="field"><label htmlFor="mn-code">{t("ep.ac.codeNext")}</label><input id="mn-code" dir="ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder={`${node.code}.NN`} /></div>
          <div className="field"><label htmlFor="mn-name">{t("ep.activityName")}</label><input id="mn-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="mn-wf">W.F</label><input id="mn-wf" dir="ltr" value={f.wf} onChange={(e) => setF({ ...f, wf: e.target.value })} /></div>
          <div className="field"><label htmlFor="mn-d">{t("ep.description")}</label><input id="mn-d" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        </div>
        <p className="sm muted">{t("ep.ac.manualNote")}</p>
        <button className="btn" type="submit">{t("ep.add")}</button> <button className="btn ghost" type="button" onClick={close}>{t("ep.cancel")}</button>
      </form>
    </div>);
}
