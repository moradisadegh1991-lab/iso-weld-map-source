"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { usePrefs } from "../../../lib/client/prefs.mjs";
import { useEpsFmt } from "../../../components/eps/ActivityDetail";
import ActivityGrid, { useSplit } from "../../../components/eps/ActivityGrid";
import { SEPARATOR_NAMES, fitTo100 } from "../../../lib/eps/wbs.mjs";
import { COLUMNS, useVersion, wIn, wOut } from "../../../components/eps/shared";

import TableKit from "../../../components/ui/TableKit";
/**
 * A PMS's WBS — one tree for all its versions (083); a version plans its
 * activities on the planning page. The tree is the activities page's own
 * (owner's requirements 2026-10-22: «ساختار صفحه WBS & activities دقیقا شبیه
 * بخش ساختار درختی صفحه activities») with the WBS nodes only (2026-10-24: «فقط
 * ردیف های جدول WBS نمایش داده شود»; the activities are the activities
 * page's): W.F, W.V, budgets, volumes and dates, a node's row edited where
 * it stands, a child node added under it from the right-click menu, copied /
 * cut / pasted with everything under it onto another node, moved above or
 * below its sibling, deleted with its activities. «W.F بالای ۱۰۰٪» lists
 * every node whose children (nodes and activities together) pass 100%, and
 * the PMS itself when its top nodes do, and brings them down to 100% in
 * proportion (lib/eps/wbs.mjs fitTo100). Below the tree, its sub-forms: PMS DETAIL (the PMS and the
 * root's budget), WBS DETAIL (the node picked, every field), the node's
 * activities (from a template or by hand) and the WBS settings — a colour
 * per level, how each level is numbered, how budget and weight relate.
 * Every derived figure comes from the server's rules (lib/eps/wbs.mjs).
 */
const BLANK_NODE = { name: "", code: "", budgetPlan: "", budgetActual: "", qty: "", unit: "", volumePlan: "", volumeActual: "", wf: "",
  planStart: "", planEnd: "", actualStart: "", actualEnd: "", description: "", templateId: "" };
const toForm = (n) => ({ id: n.id, parentId: n.parent_id, code: n.code, name: n.name, budgetPlan: n.budget_plan ?? "", budgetActual: n.budget_actual ?? "",
  qty: n.qty ?? "", unit: n.unit || "", volumePlan: n.volume_plan ?? "", volumeActual: n.volume_actual ?? "", wf: wIn(n.wf_typed ?? n.wf),
  planStart: n.plan_start || "", planEnd: n.plan_end || "", actualStart: n.actual_start || "", actualEnd: n.actual_end || "",
  description: n.description || "", templateId: n.template_id || "" });
const TABS = ["pms", "wbs", "acts", "settings"];
const DEFAULT_COLS = ["code", "name", "wf", "wv", "budget", "budgetA", "unit", "volPlan", "volActual", "start", "finish", "dur", "aStart", "aFinish", "tpl", "description"];

export default function WbsPage() {
  const { projectId, contractId, call } = usePlatform();
  const { pmsId, picker, reloadBoard } = useVersion(contractId, { version: false });
  const { data, error, reload } = useProjectData((id) => (pmsId ? `/api/eps?projectId=${id}&pmsId=${pmsId}` : null), [pmsId]);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [sel, setSel] = useState(null);                 // the selected row {kind, id, item}
  const [adding, setAdding] = useState(null);           // a new node's full form: { parentId, code }
  const [tab, setTab] = useState("wbs");
  const [overOpen, setOverOpen] = useState(false);
  // the tree as the grid shows it: the WBS nodes, without their activities
  const nodesOnly = useMemo(() => {
    if (!data) return null;
    const strip = (n) => ({ ...n, activities: [], children: n.children.map(strip) });
    return { ...data, roots: data.roots.map(strip) };
  }, [data]);
  const { t } = usePrefs();
  const { w } = useEpsFmt();
  const { height, grip } = useSplit("p6-wbs", 430);
  const live = useRef({});
  live.current = { reload, reloadBoard };
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/eps", { method: "POST", body: JSON.stringify({ projectId, pmsId, ...body }) }); reload(); reloadBoard(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  const mode = data?.settings?.budgetMode;
  // the rows in place: a node's own fields, an activity's name, W.F and description; a row added under a node is a child node
  const ops = useMemo(() => {
    if (!data?.may?.edit) return null;
    const send = (body) => call("/api/eps", { method: "POST", body: JSON.stringify({ projectId, pmsId, ...body }) });
    const batch = async (list, done) => {
      setMsg(null); setOk(null);
      try { for (const b of list) await send(b); live.current.reload(); live.current.reloadBoard(); if (done) setOk(done); return true; }
      catch (e) { setMsg(e.message); live.current.reload(); return false; }
    };
    const num = (v) => (v === "" || v === undefined ? null : v);
    // a field the budget mode works out is not typed; the stored value is sent back as it was
    const nodeBody = (it, v) => ({ kind: "node", id: it.id, parentId: it.parent_id || null, code: it.code, templateId: it.template_id || null, qty: it.qty ?? null,
      name: v.name, wf: v.wf === undefined ? it.wf_typed ?? null : wOut(v.wf), budgetPlan: v.budget === undefined ? it.budget_plan ?? null : num(v.budget),
      budgetActual: num(v.budgetA), unit: v.unit, volumePlan: num(v.volPlan), volumeActual: num(v.volActual),
      planStart: v.start || null, planEnd: v.finish || null, actualStart: v.aStart || null, actualEnd: v.aFinish || null, description: v.description });
    const actBody = (a, v) => ({ kind: "activity", id: a.id, nodeId: a.node_id, code: a.code, name: v.name, wf: wOut(v.wf), progress: a.progress ?? null, description: v.description });
    const siblings = (it) => {
      const find = (ns) => { for (const n of ns) { if (n.id === it.parent_id) return n.children; const c = find(n.children); if (c) return c; } return null; };
      return it.parent_id ? find(data.roots) || [] : data.roots;
    };
    return {
      draftKind: "node",
      fields: (row) => (row.kind === "act" ? [{ key: "name", type: "text" }, { key: "wf", type: "number" }, { key: "description", type: "text" }]
        : [{ key: "name", type: "text" }, ...(mode === "budget_to_wf" ? [] : [{ key: "wf", type: "number" }]), ...(mode === "wf_to_budget" ? [] : [{ key: "budget", type: "number" }]),
          { key: "budgetA", type: "number" }, { key: "unit", type: "text" }, { key: "volPlan", type: "number" }, { key: "volActual", type: "number" },
          { key: "start", type: "date" }, { key: "finish", type: "date" }, { key: "aStart", type: "date" }, { key: "aFinish", type: "date" }, { key: "description", type: "text" }]),
      value: (row) => {
        const it = row.item;
        if (row.kind === "act") return { name: it.name ?? "", wf: wIn(it.wf), description: it.description ?? "" };
        const v = { name: it.name ?? "", budgetA: it.budget_actual ?? "", unit: it.unit ?? "", volPlan: it.volume_plan ?? "", volActual: it.volume_actual ?? "",
          start: it.plan_start || "", finish: it.plan_end || "", aStart: it.actual_start || "", aFinish: it.actual_end || "", description: it.description ?? "" };
        if (mode !== "budget_to_wf") v.wf = wIn(it.wf_typed ?? it.wf);
        if (mode !== "wf_to_budget") v.budget = it.budget_plan ?? "";
        return v;
      },
      save: (row, v) => batch([row.kind === "act" ? actBody(row.item, v) : nodeBody(row.item, v)], t("ep.wb.saved", { code: row.item.code })),
      create: (node, v) => batch([{ ...nodeBody({ parent_id: node.id }, v), id: null, code: null }], t("ep.wb.added")),
      remove: (rows) => {
        const nodes = rows.filter((x) => x.kind === "node");
        // the activities are not on this page, but they go with their node: the question counts them
        const full = (id) => { const f = (ns) => { for (const n of ns) { if (n.id === id) return n; const c = f(n.children); if (c) return c; } return null; }; return f(data.roots); };
        const acts = nodes.reduce((k, n) => k + (full(n.id)?.activities.length || 0), 0);
        if (acts && !window.confirm(t("ep.wb.removeWithActs", { nodes: nodes.length, acts }))) return false;
        // nodes go deepest first, so a branch picked whole goes
        return batch([...nodes].sort((a, b) => b.level - a.level).map((n) => ({ kind: "node-remove", id: n.id })), t("ep.removed"));
      },
      paste: (node, rows, how) => {
        const nodes = rows.filter((x) => x.kind === "node"), inNode = new Set(nodes.map((n) => n.id));
        const top = nodes.filter((n) => !inNode.has(n.parentId)), lone = rows.filter((x) => x.kind === "act" && !inNode.has(x.parentId));
        return batch([
          ...top.map((n) => (how === "cut" ? { kind: "node-move", id: n.id, parentId: node.id } : { kind: "node-copy", id: n.id, parentId: node.id })),
          ...lone.map((a) => ({ kind: "activity", nodeId: node.id, name: a.item.name, wf: a.item.wf, description: a.item.description || null })),
          ...(how === "cut" ? lone.map((a) => ({ kind: "activity-remove", id: a.id })) : []),
        ], t("ep.wb.pastedN", { n: rows.length }));
      },
      reorder: (row, dir) => {
        const sib = siblings(row.item), i = sib.findIndex((x) => x.id === row.id), to = sib[i + dir];
        if (!to) return true;
        return batch([{ kind: "node-move", id: row.id, parentId: row.item.parent_id || null, [dir < 0 ? "beforeId" : "afterId"]: to.id }], t("ep.wb.moved"));
      },
    };
  }, [data, projectId, pmsId, call, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  // keep the selection's figures current after a reload
  useEffect(() => {
    if (!sel || !data) return;
    const find = (ns) => { for (const n of ns) { if (n.id === sel.id) return n; const a = n.activities.find((x) => x.id === sel.id); if (a) return a; const c = find(n.children); if (c) return c; } return null; };
    const it = find(data.roots);
    if (!it) setSel(null); else if (it !== sel.item) setSel({ ...sel, item: it });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!contractId) return <div className="page"><div className="pagehead"><h1>{t("ep.wb.title")}</h1></div><p className="empty-note">{t("cs.pick")}</p></div>;
  const head = (
    <div className="pagehead"><h1>{t("ep.wb.title")}</h1>
      <span className="sub">{picker}
        {" "}<Link href="/eps">{t("ep.link.board")}</Link> · <Link href="/eps/activities">{t("ep.link.activities")}</Link> · <Link href="/eps/templates">{t("ep.tp.title")}</Link></span></div>);
  if (error) return <div className="page">{head}<p className="err">{error}</p></div>;
  if (!pmsId) return <div className="page">{head}<p className="empty-note">{t("ep.noPlan")}</p></div>;
  if (!data) return <div className="page">{head}<p className="muted">{t("common.loading")}</p></div>;
  const may = data.may.edit;
  const S = data.settings;
  const withActs = data.templates.filter((x) => x.activities.length > 0);
  const findNode = (id) => { const f = (ns) => { for (const n of ns) { if (n.id === id) return n; const c = f(n.children); if (c) return c; } return null; }; return f(data.roots); };
  // the node picked, as the server sent it (with its activities: the grid's rows leave them out)
  const node = sel ? findNode(sel.kind === "node" ? sel.id : sel.item.node_id) : null;
  async function openAdd(parentId) {
    let code = "";
    try { code = (await call(`/api/eps?projectId=${projectId}&pmsId=${pmsId}&suggest=1${parentId ? `&parentId=${parentId}` : ""}`)).code; } catch { /* typed by hand */ }
    setAdding({ parentId, code }); setTab("wbs");
  }
  const toolbar = may && <>
    <button type="button" className="btn sm" data-add-top onClick={() => openAdd(null)}>{t("ep.wb.addTop")}</button>
    <button type="button" className="btn ghost sm" disabled={!node} data-add-child onClick={() => node && openAdd(node.id)}>+ {t("ep.wb.child")}</button>
    {S.budgetMode !== "manual" && <button className="btn ghost sm" type="button" data-refresh-weights
      title={t(S.budgetMode === "wf_to_budget" ? "ep.wb.refreshBudgetTip" : "ep.wb.refreshWfTip")}
      onClick={() => { if (window.confirm(t("ep.wb.refreshAsk"))) post({ kind: "refresh-weights" }, (r) => t("ep.wb.refreshed", { n: r.row.updated })); }}>{t("ep.wb.refresh")}</button>}
    <span className="sm muted" data-root-wf>{t("ep.wb.rootSum", { code: data.version.pms_code, wf: data.rootWf == null ? "—" : w(data.rootWf) })}</span></>;
  const overBtn = (
    <button type="button" className={`btn sm ${data.overflows.length ? "danger" : "ghost"}`} data-over-open aria-expanded={overOpen}
      onClick={() => setOverOpen(!overOpen)}>{t("ep.wb.over", { n: data.overflows.length })}</button>);
  return (
    <div className="page">
      {head}
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg toast" role="status">{ok}</p>}
      {data.problems.length > 0 && <div className="card" style={{ borderColor: "var(--bad)" }}><b>{t("ep.ac.problems")}</b><ul className="sm">{data.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      {overOpen && <Overflows list={data.overflows} pmsCode={data.version.pms_code} may={may} mode={S.budgetMode} post={post} close={() => setOverOpen(false)}
        pick={(id) => { const n = findNode(id); if (n) { setSel({ kind: "node", id, item: n }); setTab("wbs"); } }} />}
      <div style={{ height }} data-wbs-tree>
        <ActivityGrid data={nodesOnly} columns={COLUMNS} defaultCols={DEFAULT_COLS} storeKey="p6-wbs" customKey="eps-wbs" selected={sel?.id} onSelect={(r) => { setSel(r); setAdding(null); }}
          toolbar={<>{toolbar}{overBtn}</>} ops={ops} />
      </div>
      {grip}
      <div className="p6-detail">
        <div className="p6-tabs" role="tablist">
          {TABS.map((k) => <button key={k} type="button" role="tab" data-wbs-tab={k} aria-selected={tab === k} className={tab === k ? "on" : undefined} onClick={() => setTab(k)}>{t(`ep.wb.tab.${k}`)}</button>)}
        </div>
        {tab === "pms" && <PmsDetail p={data.pms} labels={data.labels} rootWf={data.rootWf} may={may} post={post} contractId={contractId} />}
        {tab === "wbs" && (adding ? <NodeForm key={`add-${adding.parentId}`} init={{ mode: "add", ...BLANK_NODE, parentId: adding.parentId, code: adding.code }} mode={S.budgetMode}
            templates={withActs} post={post} may={may} close={() => setAdding(null)} parent={adding.parentId ? findNode(adding.parentId) : null} />
          : node ? <NodeForm key={node.id} init={{ mode: "edit", ...toForm(node) }} n={node} mode={S.budgetMode} templates={data.templates} post={post} may={may} />
          : <p className="empty-note">{t("ep.wb.pickNode")}</p>)}
        {tab === "acts" && (node ? <Activities n={node} may={may} post={post} templates={withActs} /> : <p className="empty-note">{t("ep.wb.pickNode")}</p>)}
        {tab === "settings" && <Settings S={S} labels={data.labels} may={may} post={post} pmsCode={data.version.pms_code} />}
      </div>
    </div>
  );
}

/**
 * Where the W.F of a node's children (its child nodes and its activities
 * together), or of the PMS's top nodes, add up past 100% — each with its
 * children as they are and as «fit to 100%» would leave them: every one
 * brought down in proportion to its own, so they total exactly 100%.
 */
function Overflows({ list, pmsCode, may, mode, post, close, pick }) {
  const { t } = usePrefs();
  const { w } = useEpsFmt();
  const [open, setOpen] = useState(() => new Set());
  const fit = async (o) => {
    if (!window.confirm(t("ep.wb.fitAsk", { code: o.code || pmsCode, sum: w(o.sum) }))) return;
    await post({ kind: "wf-fit", nodeId: o.id }, (r) => t("ep.wb.fitted", { code: o.code || pmsCode, n: r.row.updated }));
  };
  const fitAll = async () => {
    if (!window.confirm(t("ep.wb.fitAllAsk", { n: list.length }))) return;
    for (const o of list) if (!(await post({ kind: "wf-fit", nodeId: o.id }, () => t("ep.wb.fittedAll", { n: list.length })))) return;
  };
  return (
    <div className="card" data-overflows>
      <h2>{t("ep.wb.overTitle")} <button className="btn ghost sm" type="button" onClick={close}>{t("ep.close")}</button></h2>
      <p className="sm muted">{t("ep.wb.overNote")}</p>
      {mode === "budget_to_wf" && <p className="sm" style={{ color: "var(--warn)" }}>{t("ep.wb.overBudgetMode")}</p>}
      {list.length === 0 ? <p className="empty-note" data-over-none>{t("ep.wb.overNone")}</p> : <>
        {may && <p><button className="btn" type="button" data-fit-all onClick={fitAll}>{t("ep.wb.fitAll", { n: list.length })}</button></p>}
        <table className="dtable"><thead><tr><th>{t("ep.code")}</th><th>{t("ep.name")}</th><th>{t("ep.wb.overSum")}</th><th>{t("ep.wb.overKids")}</th><th /></tr></thead>
          <tbody>{list.map((o) => {
            const key = o.id || "root", after = new Map(fitTo100(o.children).map((k) => [k.id, k.wf]));
            return [
              <tr key={key} data-over={o.code || "PMS"}>
                <td className="mono">{o.id ? <button type="button" className="btn ghost sm mono" onClick={() => pick(o.id)}>{o.code}</button> : <b>{pmsCode}</b>}</td>
                <td>{o.id ? o.name : t("ep.wb.overRoot")}</td>
                <td className="mono" style={{ color: "var(--bad)" }} data-over-sum>{w(o.sum)}</td>
                <td><button type="button" className="btn ghost sm" onClick={() => setOpen((x) => { const n = new Set(x); n.has(key) ? n.delete(key) : n.add(key); return n; })}>
                  {t("ep.wb.overKidsN", { n: o.children.length })} {open.has(key) ? "▾" : "◂"}</button></td>
                <td>{may && <button className="btn sm" type="button" data-fit={o.code || "PMS"} onClick={() => fit(o)}>{t("ep.wb.fit")}</button>}</td>
              </tr>,
              ...(open.has(key) ? o.children.map((k) => (
                <tr key={`${key}:${k.id}`} className="sm muted">
                  <td className="mono" style={{ paddingInlineStart: 24 }}>{k.code}</td><td>{k.kind === "activity" ? `▸ ${k.name}` : k.name}</td>
                  <td className="mono" colSpan={2}>{w(k.wf)}{after.has(k.id) ? ` → ${w(after.get(k.id))}` : ""}</td><td /></tr>)) : []),
            ];
          })}</tbody></table></>}
    </div>);
}

/** PMS DETAIL: the PMS itself — its code, title, type, dates and the root's budget (083: the budget modes take a child's share of it). */
function PmsDetail({ p, labels, rootWf, may, post, contractId }) {
  const { t } = usePrefs();
  const { w } = useEpsFmt();
  const init = () => ({ id: p.id, contractId, code: p.code, title: p.title, pmsType: p.pms_type || "", description: p.description || "", registeredOn: p.registered_on || "",
    planStart: p.plan_start || "", planEnd: p.plan_end || "", actualStart: p.actual_start || "", actualEnd: p.actual_end || "", budgetPlan: p.budget_plan ?? "", budgetActual: p.budget_actual ?? "" });
  const [f, setF] = useState(init);
  useEffect(() => setF(init()), [p]); // eslint-disable-line react-hooks/exhaustive-deps
  const F = (k, l, type = "text", extra = {}) => (
    <div className="field" key={k}><label htmlFor={`pd-${k}`}>{l}</label>
      <input id={`pd-${k}`} type={type} dir={type === "text" && k !== "title" && k !== "description" ? "ltr" : undefined} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></div>);
  return (
    <form data-pms-detail onSubmit={async (e) => { e.preventDefault(); if (window.confirm(t("gr.saveAsk"))) await post({ kind: "pms", ...f }, () => t("ep.bd.pmsSaved", { code: f.code })); }}>
      <fieldset disabled={!may} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="grid2">
          {F("code", t("ep.bd.pmsCode"), "text", { required: true })}{F("title", t("ep.bd.pmsTitle"), "text", { required: true })}
          <div className="field"><label htmlFor="pd-pmsType">{t("ep.bd.pmsType")}</label>
            <input id="pd-pmsType" dir="ltr" list="pd-types" value={f.pmsType} onChange={(e) => setF({ ...f, pmsType: e.target.value })} />
            <datalist id="pd-types">{(labels.pmsTypes || []).map((x) => <option key={x} value={x} />)}</datalist></div>
          {F("description", t("ep.bd.pmsDesc"))}{F("registeredOn", t("ep.bd.registered"), "date")}
          {F("planStart", t("ep.planStart"), "date")}{F("planEnd", t("ep.planEnd"), "date")}
          {F("actualStart", t("ep.actualStart"), "date")}{F("actualEnd", t("ep.actualEnd"), "date")}
          {F("budgetPlan", t("ep.bd.rootBudget"), "text", { inputMode: "decimal" })}{F("budgetActual", t("ep.d.budgetActual"), "text", { inputMode: "decimal" })}
        </div>
        <p className="sm muted">{t("ep.wb.rootWfNote", { wf: w(rootWf) })}</p>
        {may && <button className="btn" type="submit" data-pms-save>{t("ep.save")}</button>}
      </fieldset>
    </form>);
}

function Settings({ S, labels, may, post, pmsCode }) {
  const { t, L } = usePrefs();
  const mode = (k) => L(`eps.budgetMode.${k}`, labels.budgetModes[k]);
  const sepName = (k) => L(`eps.separator.${SEPARATOR_NAMES[k]}`, labels.separators[k]);
  const [s, setS] = useState(S);
  useEffect(() => setS(S), [S]);
  const lvl = (i, k, v) => setS({ ...s, levels: s.levels.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  // what the codes will look like, from the settings as they stand in the form
  const sample = s.levels.reduce((acc, l, i) => [...acc, [acc[i] || pmsCode, ...(l.prefix ? [l.prefix] : []), "1".padStart(l.digits, "0")].join(s.separator)], []);
  return (
    <div data-wbs-settings>
      <p className="sm"><b>{t("ep.ws.title")}</b> <span className="muted">— {mode(S.budgetMode)} · {t("ep.ws.summary", { sep: S.separator, n: S.levels.length })}</span></p>
      <fieldset disabled={!may} style={{ border: 0, padding: 0, margin: "8px 0 0" }}>
        <div role="radiogroup" aria-label={t("ep.ws.budgetMode")} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {Object.keys(labels.budgetModes).map((k) => (
            <label key={k} className="sm"><input type="radio" name="bmode" value={k} checked={s.budgetMode === k} onChange={() => setS({ ...s, budgetMode: k })} /> {mode(k)}</label>))}
        </div>
        <div className="field" style={{ maxWidth: 220, marginTop: 8 }}><label htmlFor="ws-sep">{t("ep.ws.separator")}</label>
          <select id="ws-sep" value={s.separator} onChange={(e) => setS({ ...s, separator: e.target.value })}>
            {Object.keys(labels.separators).map((k) => <option key={k} value={k}>{sepName(k)}</option>)}</select></div>
        <table className="dtable" style={{ marginTop: 8 }}>
          <thead><tr><th>{t("ep.ws.level")}</th><th>{t("ep.ws.color")}</th><th>{t("ep.ws.prefix")}</th><th>{t("ep.ws.digits")}</th><th>{t("ep.ws.sample")}</th><th /></tr></thead>
          <tbody>{s.levels.map((l, i) => (
            <tr key={i}><td className="mono">{i + 1}</td>
              <td><input type="color" aria-label={t("ep.ws.colorOf", { n: i + 1 })} value={l.color} onChange={(e) => lvl(i, "color", e.target.value)} /></td>
              <td><input aria-label={t("ep.ws.prefixOf", { n: i + 1 })} dir="ltr" value={l.prefix} onChange={(e) => lvl(i, "prefix", e.target.value.toUpperCase())} style={{ width: 80 }} /></td>
              <td><input aria-label={t("ep.ws.digitsOf", { n: i + 1 })} type="number" min={1} max={6} dir="ltr" value={l.digits} onChange={(e) => lvl(i, "digits", Number(e.target.value))} style={{ width: 60 }} /></td>
              <td className="mono" style={{ color: l.color }}>{sample[i]}</td>
              <td>{s.levels.length > 1 && <button className="btn ghost sm" type="button" onClick={() => setS({ ...s, levels: s.levels.filter((_, j) => j !== i) })}>{t("ep.remove")}</button>}</td></tr>))}</tbody></table>
        <button className="btn ghost sm" type="button" onClick={() => setS({ ...s, levels: [...s.levels, { prefix: "", digits: 2, color: "#566573" }] })}>{t("ep.ws.addLevel")}</button>
        {may && <p><button className="btn" type="button" onClick={() => post({ kind: "settings", settings: s }, () => t("ep.ws.saved"))}>{t("ep.ws.save")}</button></p>}
      </fieldset>
    </div>
  );
}

/**
 * WBS DETAIL: the node picked, every field of it, with what the server works
 * out from them beside (W.F and budget under the budget mode, W.V, the
 * children's W.F, durations); or a new node's form, its code suggested.
 */
function NodeForm({ init, n = null, parent = null, mode, templates, post, may, close = null }) {
  const { t } = usePrefs();
  const { fmt, w } = useEpsFmt();
  const [form, setForm] = useState(init);
  const code = useRef(null);
  // a new node's suggested code is selected, so typing replaces it and leaving it keeps it
  useEffect(() => { if (init.mode === "add") { code.current?.focus(); code.current?.select(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const F = (k, l, extra = {}) => (
    <div className="field" key={k}><label htmlFor={`nf-${k}`}>{l}</label>
      <input id={`nf-${k}`} value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...extra} /></div>);
  const save = async (e) => {
    e.preventDefault();
    if (!window.confirm(t(form.mode === "add" ? "gr.addAsk" : "gr.saveAsk"))) return;
    const { mode: m, ...b } = form;
    const r = await post({ kind: "node", ...b, wf: wOut(b.wf), templateId: b.templateId || null }, (x) => t("ep.wb.saved", { code: x.row.code }));
    if (r && close) close();
  };
  // its activities go with it, and the question counts them (a node with child nodes is refused by the server)
  const remove = () => {
    if (window.confirm(n.activities.length ? t("ep.wb.removeAskActs", { code: n.code, acts: n.activities.length }) : t("ep.wb.removeAsk", { code: n.code }))) post({ kind: "node-remove", id: n.id }, () => t("ep.removed"));
  };
  return (
    <form onSubmit={save} data-wbs-detail={form.mode === "add" ? "new" : n?.code}>
      <h3 style={{ margin: "0 0 6px" }}>{form.mode === "add" ? (parent ? t("ep.wb.newUnder", { code: parent.code }) : t("ep.wb.new")) : t("ep.wb.edit", { code: form.code })}</h3>
      <fieldset disabled={!may} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="grid2">
          {F("code", t("ep.wb.codeField"), { ref: code, dir: "ltr", required: true })}
          {F("name", t("ep.wb.name"), { required: true })}
          {F("budgetPlan", t(mode === "wf_to_budget" ? "ep.wb.budgetFromWf" : "ep.wb.budgetPlan"), { dir: "ltr", inputMode: "decimal", disabled: mode === "wf_to_budget" })}
          {F("budgetActual", t("ep.d.budgetActual"), { dir: "ltr", inputMode: "decimal" })}
          {F("wf", t(mode === "budget_to_wf" ? "ep.wb.wfFromBudget" : "ep.wb.wf"), { dir: "ltr", inputMode: "decimal", disabled: mode === "budget_to_wf" })}
          {F("qty", t("ep.wb.qty"), { dir: "ltr", inputMode: "decimal" })}{F("unit", t("ep.unit"))}
          {F("volumePlan", t("ep.wb.volPlan"), { dir: "ltr", inputMode: "decimal" })}{F("volumeActual", t("ep.volActual"), { dir: "ltr", inputMode: "decimal" })}
          {F("planStart", t("ep.planStart"), { type: "date" })}{F("planEnd", t("ep.planEnd"), { type: "date" })}
          {F("actualStart", t("ep.actualStart"), { type: "date" })}{F("actualEnd", t("ep.actualEnd"), { type: "date" })}
          <div className="field"><label htmlFor="nf-tpl">{t("ep.wb.template")}</label>
            <select id="nf-tpl" value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
              <option value="">—</option>{templates.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name} ({t("ep.g.count", { n: x.activities.length })})</option>)}</select></div>
          {F("description", t("ep.description"))}
        </div>
        {n && <div className="p6-kv" data-worked-out>
          <fieldset><legend>{t("ep.wb.workedOut")}</legend>
            <div className="kv"><span>W.F / W.V</span><b dir="ltr">{w(n.wf)} / {w(n.wv, 10)}</b></div>
            <div className="kv"><span>{t("ep.wb.childWf")}</span><b dir="ltr">{n.children.length ? w(n.childWf) : "—"}</b></div>
            <div className="kv"><span>{t("ep.wb.actWf")}</span><b dir="ltr">{n.activities.length ? w(n.activityWf) : "—"}</b></div>
            <div className="kv"><span>{t("ep.wb.budgetPlan")}</span><b dir="ltr">{fmt(n.budgetPlan)}</b></div>
            <div className="kv"><span>{t("ep.dur")}</span><b dir="ltr">{fmt(n.planDays)} / {fmt(n.actualDays)}</b></div></fieldset></div>}
        <p className="sm muted">{t("ep.wb.wvNote")}</p>
        {may && <p className="row" style={{ gap: 6 }}><button className="btn" type="submit" data-node-save>{t("ep.save")}</button>
          {close && <button className="btn ghost" type="button" onClick={close}>{t("ep.cancel")}</button>}
          {n && <button className="btn ghost danger" type="button" data-node-remove onClick={remove}>{t("ep.remove")}</button>}</p>}
      </fieldset>
    </form>
  );
}

function Activities({ n, may, post, templates }) {
  const { t } = usePrefs();
  const { fmt, day, w } = useEpsFmt();
  const [tpl, setTpl] = useState(n.template_id || "");
  const [f, setF] = useState(null);
  return (
    <div style={{ padding: "4px 0" }} data-activities={n.code}>
      <TableKit name="eps-wbs-3"><table className="dtable">
        <thead><tr><th>{t("ep.cd.code")}</th><th>{t("ep.wb.tplActivity")}</th><th>{t("ep.activityName")}</th><th>W.F</th><th>W.V</th><th>{t("ep.wb.budgets")}</th><th>{t("ep.wb.volumes")}</th>
          <th>{t("ep.wb.planned")}</th><th>{t("ep.wb.actual")}</th><th>{t("ep.col.pct")}</th>{may && <th />}</tr></thead>
        <tbody>{n.activities.map((a) => (
          <tr key={a.id} data-activity={a.code}><td className="mono">{a.code}</td><td className="mono sm">{a.template_code || t("ep.wb.manual")}</td><td>{a.name}</td>
            <td className="mono">{w(a.wf)}</td><td className="mono">{w(a.wv, 10)}</td>
            <td className="mono">{fmt(a.budgetPlan)} / {fmt(a.budgetActual)}</td><td className="mono">{fmt(a.volumePlan)} / {fmt(a.volumeActual)} {a.unit || ""}</td>
            <td className="mono sm">{day(a.plan_start)} — {day(a.plan_end)}</td><td className="mono sm">{day(a.actual_start)} — {day(a.actual_end)}</td>
            <td className="mono">{a.progress == null ? "—" : `${fmt(a.progress)}%`}</td>
            {may && <td style={{ whiteSpace: "nowrap" }}>
              <button className="btn ghost sm" type="button" onClick={() => setF({ id: a.id, code: a.code, name: a.name, wf: wIn(a.wf), progress: a.progress ?? "", description: a.description || "" })}>{t("ep.edit")}</button>
              <button className="btn ghost sm" type="button" onClick={() => { if (window.confirm(t("ep.wb.removeActAsk", { code: a.code }))) post({ kind: "activity-remove", id: a.id }, () => t("ep.removed")); }}>{t("ep.remove")}</button></td>}</tr>))}
          {n.activities.length > 0 && <tr><td colSpan={3}><b>{t("ep.total")}</b></td><td className="mono"><b>{w(n.activityWf)}</b></td><td colSpan={may ? 7 : 6} /></tr>}</tbody></table></TableKit>
      {n.activities.length === 0 && <p className="sm muted">{t("ep.wb.noActivities")}</p>}
      {may && (
        <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 6 }}>
          <div className="field"><label htmlFor={`at-${n.id}`}>{t("ep.wb.attachTpl")}</label>
            <select id={`at-${n.id}`} value={tpl} onChange={(e) => setTpl(e.target.value)}>
              <option value="">{t("ep.wb.pickTpl")}</option>{templates.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name} ({x.activities.length})</option>)}</select></div>
          <button className="btn sm" type="button" disabled={!tpl} onClick={() => post({ kind: "attach", nodeId: n.id, templateId: tpl },
            (r) => t(r.row.skipped ? "ep.ac.attachedSkip" : "ep.ac.attached", { n: r.row.added, skipped: r.row.skipped }))}>{t("ep.ac.attachBtn")}</button>
          <button className="btn ghost sm" type="button" onClick={() => setF({ id: null, code: "", name: "", wf: "", progress: "", description: "" })}>{t("ep.ac.manual")}</button>
        </div>)}
      {f && (
        <form className="row" style={{ gap: 6, alignItems: "end", flexWrap: "wrap", marginTop: 6 }}
          onSubmit={async (e) => { e.preventDefault(); if (!window.confirm(t(f.id ? "gr.saveAsk" : "gr.addAsk"))) return; if (await post({ kind: "activity", nodeId: n.id, ...f, wf: wOut(f.wf) }, () => t(f.id ? "ep.activitySaved" : "ep.tp.actAdded"))) setF(null); }}>
          <div className="field" style={{ width: 170 }}><label htmlFor={`af-c-${n.id}`}>{t("ep.ac.codeNext")}</label><input id={`af-c-${n.id}`} dir="ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="field"><label htmlFor={`af-n-${n.id}`}>{t("ep.activityName")}</label><input id={`af-n-${n.id}`} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field" style={{ width: 100 }}><label htmlFor={`af-w-${n.id}`}>W.F</label><input id={`af-w-${n.id}`} dir="ltr" inputMode="decimal" value={f.wf} onChange={(e) => setF({ ...f, wf: e.target.value })} /></div>
          <div className="field" style={{ width: 100 }}><label htmlFor={`af-p-${n.id}`}>{t("ep.col.pct")}</label><input id={`af-p-${n.id}`} dir="ltr" inputMode="decimal" value={f.progress} onChange={(e) => setF({ ...f, progress: e.target.value })} /></div>
          <div className="field"><label htmlFor={`af-d-${n.id}`}>{t("ep.description")}</label><input id={`af-d-${n.id}`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <button className="btn sm" type="submit">{t("ep.save")}</button><button className="btn ghost sm" type="button" onClick={() => setF(null)}>{t("ep.cancel")}</button>
        </form>)}
      <p className="sm muted">{t("ep.wb.actNote")}</p>
    </div>
  );
}
