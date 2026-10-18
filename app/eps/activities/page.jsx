"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import ActivityGrid, { useSplit } from "../../../components/eps/ActivityGrid";
import ActivityDetail, { TABS, fmt, day } from "../../../components/eps/ActivityDetail";
import { COLUMNS, useVersion } from "../../../components/eps/shared";
import { NodeScope } from "../../../components/eps/ScopePanel";

import TableKit from "../../../components/ui/TableKit";
/**
 * The activity view of a version, after Primavera P6: the WBS and its
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
  const { versionId, picker } = useVersion(contractId);
  const { data, error, reload } = useProjectData((id) => (versionId ? `/api/eps/activities?projectId=${id}&versionId=${versionId}` : null), [versionId]);
  const [sel, setSel] = useState(null);                // the selected row {kind, id, item}
  const detail = useProjectData((id) => (sel?.kind === "act" ? `/api/eps/activities?projectId=${id}&activityId=${sel.id}` : null), [sel?.id]);
  const [tab, setTab] = useState("detail");
  const [tabs, setTabs] = useState(PAGE_TABS);
  const [pickTabs, setPickTabs] = useState(false);
  const [modal, setModal] = useState(null);            // "attach" | "manual"
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const { height, grip } = useSplit("p6-activities", 430);
  useEffect(() => {
    // a sub-form added since the choice was saved shows until it is unticked
    const known = read("p6-activities:known", PAGE_TABS.filter((k) => k !== "scope"));
    const saved = read("p6-activities:tabs", PAGE_TABS);
    setTabs(PAGE_TABS.filter((k) => saved.includes(k) || !known.includes(k)));
  }, []);
  useEffect(() => { write("p6-activities:tabs", tabs); write("p6-activities:known", PAGE_TABS); if (!tabs.includes(tab) && tabs.length) setTab(tabs[0]); }, [tabs]); // eslint-disable-line react-hooks/exhaustive-deps
  async function post(url, body, done) {
    setMsg(null); setOk(null);
    try { const r = await call(url, { method: "POST", body: JSON.stringify({ projectId, versionId, ...body }) }); reload(); detail.reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
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
    <div className="pagehead"><h1>فعالیت‌ها (نمای P6)</h1>
      <span className="sub">{picker} <Link href="/eps">EPS و PMS</Link> · <Link href="/eps/wbs">WBS</Link> · <Link href="/eps/codes">کدهای فعالیت</Link> · <Link href="/eps/scope">محدودهٔ پلتفرم</Link> · <Link href="/eps/progress">ثبت کار روزانه</Link></span></div>);
  if (!contractId) return <div className="page"><div className="pagehead"><h1>فعالیت‌ها (نمای P6)</h1></div><p className="empty-note">قرارداد را از فهرست بالای صفحه انتخاب کنید.</p></div>;
  if (error) return <div className="page">{head}<p className="err">{error}</p></div>;
  if (!versionId) return <div className="page">{head}<p className="empty-note">اول در «EPS و PMS» یک PMS و نسخه بسازید.</p></div>;
  if (!data) return <div className="page">{head}<p className="muted">در حال بارگذاری…</p></div>;
  const may = data.may.edit;
  const node = sel ? (sel.kind === "node" ? sel.item : null) : null;
  const nodeOfSel = sel?.kind === "act" ? sel.item.node_id : sel?.id;
  const toolbar = may && <>
    <button type="button" className="btn sm" disabled={!nodeOfSel} title={nodeOfSel ? "" : "اول یک گره یا فعالیت را انتخاب کنید"} onClick={() => setModal("attach")}>الصاق از الگو…</button>
    <button type="button" className="btn ghost sm" disabled={!nodeOfSel} onClick={() => setModal("manual")}>+ فعالیت دستی</button></>;
  const nodeName = (id) => { const f = (ns) => { for (const n of ns) { if (n.id === id) return n; const c = f(n.children); if (c) return c; } return null; }; return f(data.roots); };
  const target = nodeOfSel ? nodeName(nodeOfSel) : null;

  return (
    <div className="page">
      {head}
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      {data.autoApplied?.length > 0 && <div className="card" data-auto-applied><b>تغییرات تازهٔ پلتفرم در PMS اعمال شد</b><ul className="sm">{data.autoApplied.map((x) => (
        <li key={x.ruleId}>{x.error ? <span className="err">{x.error}</span> : `+${x.added} قلم تازه، −${x.removed} قلم حذف‌شده${x.made ? `، ${x.made} فعالیت ساخته شد` : ""}${x.dropped ? `، ${x.dropped} فعالیت حذف شد` : ""}${x.kept ? `، ${x.kept} فعالیت با W.F صفر نگه داشته شد` : ""}`}</li>))}</ul></div>}
      {data.scope?.some((x) => !x.rule.auto_apply && (x.pending.any || x.firstApply)) && <p className="sm" style={{ color: "var(--warn)" }}>
        {data.scope.filter((x) => !x.rule.auto_apply && (x.pending.any || x.firstApply)).length} پیوند پلتفرم تغییر اعمال‌نشده دارد (زبانهٔ Scope یا <Link href="/eps/scope">محدودهٔ پلتفرم</Link>).</p>}
      {data.problems.length > 0 && <div className="card" style={{ borderColor: "var(--bad)" }}><b>ناسازگاری‌ها</b><ul className="sm">{data.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      <div style={{ height }}>
        <ActivityGrid data={data} columns={COLUMNS} defaultCols={["code", "name", "wf", "wv", "unit", "volActual", "done", "pct", "src", "start", "finish", "dur"]}
          storeKey="p6-activities" selected={sel?.id} onSelect={(r) => setSel(r)} toolbar={toolbar} />
      </div>
      {grip}
      <div className="p6-detail">
        <div className="p6-tabs" role="tablist">
          {tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : undefined} onClick={() => setTab(k)}>{TABS[k]}</button>)}
          <span style={{ position: "relative", marginInlineStart: "auto" }}>
            <button type="button" className="btn ghost sm" onClick={() => setPickTabs(!pickTabs)}>زیرفرم‌ها ▾</button>
            {pickTabs && <div className="p6-chooser card">{PAGE_TABS.map((k) => (
              <label key={k} style={{ display: "block" }}><input type="checkbox" checked={tabs.includes(k)} onChange={() => setTabs(tabs.includes(k) ? tabs.filter((x) => x !== k) : PAGE_TABS.filter((x) => x === k || tabs.includes(x)))} /> {TABS[k]}</label>))}
              <button type="button" className="btn sm" onClick={() => setPickTabs(false)}>بستن</button></div>}
          </span>
        </div>
        {!sel && <p className="empty-note">یک فعالیت را در جدول یا گانت انتخاب کنید.</p>}
        {node && <NodeSummary n={node} />}
        {node && <NodeScope node={node} state={data.scope?.find((x) => x.rule.node_id === node.id)} may={may} post={post} L={data.labels.scope} choices={data.scopeChoices} />}
        {sel?.kind === "act" && (detail.error ? <p className="err">{detail.error}</p> : !detail.data ? <p className="muted">در حال بارگذاری…</p>
          : <ActivityDetail d={detail.data} tab={tab} may={may} post={post} acts={acts} labels={data.labels} codes={data.codes} resources={data.resources} companies={data.companies} projectId={projectId} />)}
      </div>
      {modal === "attach" && target && <Attach node={target} templates={data.templates} post={post} close={() => setModal(null)} />}
      {modal === "manual" && target && <Manual node={target} post={post} close={() => setModal(null)} />}
    </div>
  );
}

function NodeSummary({ n }) {
  return (
    <div className="p6-kv">
      <fieldset><legend>گرهٔ WBS</legend>
        <div className="kv"><span>کد</span><b dir="ltr">{n.code}</b></div><div className="kv"><span>نام</span><b>{n.name}</b></div>
        <div className="kv"><span>W.F / W.V</span><b>{fmt(n.wf, 4)}٪ / {fmt(n.wv, 5)}٪</b></div>
        <div className="kv"><span>پیشرفت وزنی</span><b>{n.pct == null ? "—" : `${fmt(n.pct)}٪`}</b></div></fieldset>
      <fieldset><legend>برنامه</legend>
        <div className="kv"><span>شروع — پایان</span><b>{day(n.plan_start)} — {day(n.plan_end)}</b></div><div className="kv"><span>مدت</span><b>{fmt(n.planDays)}</b></div>
        <div className="kv"><span>بودجه</span><b>{fmt(n.budgetPlan)}</b></div><div className="kv"><span>فعالیت‌ها</span><b>{n.activities.length} (Σ W.F {fmt(n.activityWf, 4)}٪)</b></div></fieldset>
    </div>);
}

/** Attach from a template: only templates that have activities; each one's activities shown before it is chosen. */
function Attach({ node, templates, post, close }) {
  const [pick, setPick] = useState(templates[0]?.id || "");
  const t = templates.find((x) => x.id === pick);
  const sep = node.code.match(/[.\-/_]/)?.[0] || ".";
  return (
    <div className="p6-modal" role="dialog" aria-label="الصاق از الگو" onClick={close}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h2>الصاق فعالیت از الگو به <span className="mono" dir="ltr">{node.code}</span> — {node.name}</h2>
        {templates.length === 0 ? <p className="empty-note">الگویی که فعالیت داشته باشد نیست (الگوهای فعالیت).</p> : <>
          <div className="field"><label htmlFor="at-t">الگو</label><select id="at-t" value={pick} onChange={(e) => setPick(e.target.value)}>
            {templates.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name} ({x.activities.length} فعالیت)</option>)}</select></div>
          {t && <TableKit name="eps-activities-1"><table className="dtable"><thead><tr><th>کد تازه</th><th>کد الگو</th><th>نام</th><th>W.F</th><th>W.V</th><th>بودجه</th></tr></thead>
            <tbody>{t.activities.map((a) => (
              <tr key={a.id}><td className="mono" dir="ltr">{node.code}{sep}{String(a.number).slice(-2).padStart(2, "0")}</td><td className="mono">{a.code}</td><td>{a.name}</td>
                <td className="mono">{fmt(a.wf, 4)}</td><td className="mono">{a.wf != null && node.wv != null ? fmt((a.wf * node.wv) / 100, 5) : "—"}</td>
                <td className="mono">{a.wf != null && node.budgetPlan != null ? fmt((a.wf * node.budgetPlan) / 100) : "—"}</td></tr>))}</tbody></table></TableKit>}
          <p className="sm muted">حجم‌ها و تاریخ‌ها از گره خوانده می‌شوند؛ بودجه‌ها = W.F × بودجهٔ گره؛ پیشرفت از گزارش‌های روزانه. فعالیتی که قبلاً از همین الگو الصاق شده تکرار نمی‌شود.</p>
          <button className="btn" type="button" onClick={async () => { if (await post("/api/eps", { kind: "attach", nodeId: node.id, templateId: pick }, (r) => `${r.row.added} فعالیت الصاق شد${r.row.skipped ? `؛ ${r.row.skipped} از پیش بود` : ""}.`)) close(); }}>الصاق</button></>}
        {" "}<button className="btn ghost" type="button" onClick={close}>بستن</button>
      </div>
    </div>);
}

function Manual({ node, post, close }) {
  const [f, setF] = useState({ code: "", name: "", wf: "", description: "" });
  return (
    <div className="p6-modal" role="dialog" aria-label="فعالیت دستی" onClick={close}>
      <form className="card" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => { e.preventDefault(); if (await post("/api/eps", { kind: "activity", nodeId: node.id, ...f }, (r) => `فعالیت ${r.row.code} اضافه شد.`)) close(); }}>
        <h2>فعالیت دستی زیر <span className="mono" dir="ltr">{node.code}</span></h2>
        <div className="grid2">
          <div className="field"><label htmlFor="mn-code">کد (خالی: بعدی)</label><input id="mn-code" dir="ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder={`${node.code}.NN`} /></div>
          <div className="field"><label htmlFor="mn-name">نام فعالیت</label><input id="mn-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="mn-wf">W.F ٪</label><input id="mn-wf" dir="ltr" value={f.wf} onChange={(e) => setF({ ...f, wf: e.target.value })} /></div>
          <div className="field"><label htmlFor="mn-d">توضیحات</label><input id="mn-d" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        </div>
        <p className="sm muted">کد الگو خالی می‌ماند؛ W.V، بودجه، حجم و تاریخ مانند فعالیت الگو از گره خوانده می‌شوند.</p>
        <button className="btn" type="submit">افزودن</button> <button className="btn ghost" type="button" onClick={close}>انصراف</button>
      </form>
    </div>);
}
