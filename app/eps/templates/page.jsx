"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { usePrefs } from "../../../lib/client/prefs.mjs";
import ActivityGrid, { useSplit } from "../../../components/eps/ActivityGrid";
import { wIn, wOut } from "../../../components/eps/shared";
import { COST_FIELDS, costValues } from "../../../lib/eps/costs.mjs";
/**
 * Activity templates, built as the activities page's tree table is (owner's
 * request 2026-10-24: «الگو … مطابق لیست جدول فعالیت ها قابل ساختن باشد»): the
 * templates as the tree's nodes, each with its activities under it — row
 * number (its code is the template's code and two digits), name, W.F,
 * description, and the activity table's own fields (2026-10-25: type,
 * Activity ID, WF rate, planned volume, and every column the project added
 * to the activities table, «eps-activities»), which the activities made from
 * it take (lib/db/repos/eps.mjs attachTemplate, syncTemplate). A row is edited where it stands; an activity is typed into a
 * new row under its template from the right-click menu; templates and
 * activities are copied, cut and pasted onto another template (a template
 * with everything under it), moved above or below their sibling, and
 * deleted. «اعمال روی WBS» pushes the picked template's activities as they
 * are now onto every WBS node that took them (lib/db/repos/eps.mjs
 * syncTemplate).
 */
const BLANK_T = { id: null, parentId: "", code: "", name: "", description: "" };
const COLORS = ["#1f6f8b", "#7d3c98", "#b9770e", "#566573"];
// the activity table's columns (components/eps/shared.jsx COLUMNS), as far as a template's activity carries them
const TPL_COLUMNS = [
  { key: "code", title: "Activity / WBS No.", width: 170, mono: true, hits: true, get: (r) => r.item.code },
  { key: "name", title: "ep.col.name", width: 240, hits: true, get: (r) => r.item.name },
  { key: "number", title: "ep.tp.row", width: 55, mono: true, get: (r) => (r.kind === "act" ? r.item.number : "") },
  { key: "actType", title: "Type", width: 110, get: (r) => (r.kind === "act" ? r.item.act_type || "" : "") },
  { key: "activityNo", title: "Activity ID", width: 95, mono: true, hits: true, get: (r) => (r.kind === "act" ? r.item.activity_no || "" : "") },
  { key: "wf", title: "W.F", width: 100, mono: true, get: (r, x) => (r.kind === "act" ? x.w(r.item.wf) : r.item.activities.length ? `Σ${x.w(r.item.wfTotal)}` : "") },
  { key: "wfRate", title: "WF rate", width: 95, mono: true, get: (r, x) => (r.kind === "act" && r.item.wf_rate != null ? x.fmt(Number(r.item.wf_rate), 10) : "") },
  { key: "volPlan", title: "ep.col.volPlan", width: 85, mono: true, get: (r, x) => (r.kind === "act" && r.item.volume_plan != null ? x.fmt(Number(r.item.volume_plan)) : "") },
  { key: "count", title: "ep.activity", width: 70, mono: true, get: (r) => (r.kind === "node" ? r.item.activities.length || "" : "") },
  { key: "description", title: "ep.description", width: 220, hits: true, get: (r) => r.item.description || "" },
  // the activity table's cost and float (091), handed to the activity made from the template
  ...COST_FIELDS.map((f) => ({ key: f.key, title: f.head, width: 120, mono: true, get: (r, x) => (r.kind === "act" && r.item[f.col] != null ? x.fmt(Number(r.item[f.col]), 4) : "") })),
];
const DEFAULT_COLS = ["code", "name", "number", "actType", "activityNo", "wf", "wfRate", "volPlan", "count", "description", ...COST_FIELDS.map((f) => f.key)];
const ACT_FIELDS = [{ key: "name", type: "text" }, { key: "actType", type: "text" }, { key: "activityNo", type: "text" }, { key: "wf", type: "number" },
  { key: "wfRate", type: "number" }, { key: "volPlan", type: "number" }, { key: "description", type: "text" }, ...COST_FIELDS.map((f) => ({ key: f.key, type: "number" }))];
// the templates as the grid's tree: a template is a node, its activities the rows under it
const asTree = (rows) => {
  const by = new Map(rows.map((r) => [r.id, { ...r, children: [], activities: r.activities.map((a) => ({ ...a, node_id: r.id })) }]));
  const roots = [];
  for (const r of by.values()) (r.parent_id && by.has(r.parent_id) ? by.get(r.parent_id).children : roots).push(r);
  const lay = (xs, level) => { xs.sort((a, b) => a.seq - b.seq || a.code.localeCompare(b.code)); xs.forEach((x) => { x.level = level; x.color = COLORS[(level - 1) % COLORS.length]; lay(x.children, level + 1); }); };
  lay(roots, 1);
  return { roots, relations: [] };
};

export default function TemplatesPage() {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/eps?projectId=${id}&templates=1`, []);
  const { t } = usePrefs();
  const [sel, setSel] = useState(null);
  const [tf, setTf] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const { height, grip } = useSplit("p6-templates", 460);
  const live = useRef({});
  live.current = { reload };
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/eps", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  const tree = useMemo(() => (data ? asTree(data.templates) : null), [data]);
  const ops = useMemo(() => {
    if (!data?.may?.edit) return null;
    const send = (body) => call("/api/eps", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
    const batch = async (list, done) => {
      setMsg(null); setOk(null);
      try { for (const b of list) await send(b); live.current.reload(); if (done) setOk(done); return true; }
      catch (e) { setMsg(e.message); live.current.reload(); return false; }
    };
    const blank = (x) => (x === "" || x === undefined ? null : x);
    const actBody = (templateId, v, it = {}) => ({ kind: "template-activity", id: it.id || null, templateId, number: it.number ?? null, name: v.name, wf: wOut(v.wf),
      description: v.description || null, actType: v.actType ?? null, activityNo: v.activityNo ?? null, wfRate: blank(v.wfRate), volumePlan: blank(v.volPlan),
      ...Object.fromEntries(COST_FIELDS.map((f) => [f.key, blank(v[f.key])])) });
    const siblings = (row) => data.templates.filter((x) => (x.parent_id || null) === (row.item.parent_id || null)).sort((a, b) => a.seq - b.seq || a.code.localeCompare(b.code));
    return {
      fields: (row) => (row.kind === "act" ? ACT_FIELDS
        : [{ key: "code", type: "text" }, { key: "name", type: "text" }, { key: "description", type: "text" }]),
      value: (row) => (row.kind === "act" ? { name: row.item.name ?? "", actType: row.item.act_type ?? "", activityNo: row.item.activity_no ?? "", wf: wIn(row.item.wf),
        wfRate: row.item.wf_rate ?? "", volPlan: row.item.volume_plan ?? "", description: row.item.description ?? "", ...costValues(row.item) }
        : { code: row.item.code ?? "", name: row.item.name ?? "", description: row.item.description ?? "" }),
      save: (row, v) => batch([row.kind === "act" ? actBody(row.item.node_id, v, row.item)
        : { kind: "template", id: row.id, parentId: row.item.parent_id || null, code: String(v.code || "").toUpperCase(), name: v.name, description: v.description || null }],
      row.kind === "act" ? t("ep.tp.actEdited") : t("ep.tp.saved", { code: v.code || row.item.code })),
      // a row typed under a template is one of its activities, numbered after the last
      create: (node, v) => batch([actBody(node.id, v)], t("ep.tp.actAdded")),
      remove: (rows) => {
        const nodes = rows.filter((x) => x.kind === "node"), gone = new Set(nodes.map((n) => n.id));
        // an activity goes with its template; templates go deepest first, so a branch picked whole goes
        return batch([...rows.filter((x) => x.kind === "act" && !gone.has(x.parentId)).map((x) => ({ kind: "template-activity-remove", id: x.id })),
          ...[...nodes].sort((a, b) => b.level - a.level).map((n) => ({ kind: "template-remove", id: n.id }))], t("ep.removed"));
      },
      paste: (node, rows, how) => {
        const nodes = rows.filter((x) => x.kind === "node"), inNode = new Set(nodes.map((n) => n.id));
        const top = nodes.filter((n) => !inNode.has(n.parentId)), lone = rows.filter((x) => x.kind === "act" && !inNode.has(x.parentId));
        // an activity goes with its fields and its project-column values: copied as a new row, or moved as itself
        return batch([
          ...top.map((n) => (how === "cut" ? { kind: "template-move", id: n.id, parentId: node.id } : { kind: "template-copy", id: n.id, parentId: node.id })),
          ...lone.map((a) => ({ kind: "template-activity-place", id: a.id, templateId: node.id, move: how === "cut" })),
        ], t("ep.tp.pastedN", { n: rows.length, code: node.item.code }));
      },
      reorder: (row, dir) => {
        const sib = siblings(row), i = sib.findIndex((x) => x.id === row.id), to = sib[i + dir];
        if (!to) return true;
        return batch([{ kind: "template-move", id: row.id, parentId: row.item.parent_id || null, [dir < 0 ? "beforeId" : "afterId"]: to.id }], t("ep.tp.moved"));
      },
    };
  }, [data, projectId, call]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const may = data.may.edit;
  const picked = sel ? data.templates.find((x) => x.id === (sel.kind === "node" ? sel.id : sel.item.node_id)) : null;
  async function sync(T) {
    setMsg(null); setOk(null);
    try {
      const dry = (await call("/api/eps", { method: "POST", body: JSON.stringify({ projectId, kind: "template-sync", templateId: T.id, dryRun: true }) })).row;
      if (!dry.updated && !dry.added) { setOk(t("ep.tp.inSync", { code: T.code })); return; }
      if (!window.confirm(t("ep.tp.syncAsk", { code: T.code, updated: dry.updated, added: dry.added, nodes: dry.nodes.join(t("ep.sep")), versions: dry.versions.join(t("ep.sep")) }))) return;
      await post({ kind: "template-sync", templateId: T.id }, (r) => t("ep.tp.synced", { updated: r.row.updated, added: r.row.added }));
    } catch (e) { setMsg(e.message); }
  }
  const toolbar = may && <>
    <button className="btn sm" type="button" data-tpl-new onClick={() => setTf({ ...BLANK_T })}>{t("ep.tp.new")}</button>
    <button className="btn ghost sm" type="button" data-tpl-child disabled={!picked} onClick={() => picked && setTf({ ...BLANK_T, parentId: picked.id })}>{t("ep.tp.addChild")}</button>
    <button className="btn ghost sm" type="button" data-sync={picked?.code || ""} disabled={!picked?.activities.length} title={t("ep.tp.syncNote")}
      onClick={() => picked && sync(picked)}>{t("ep.tp.sync")}</button></>;
  return (
    <div className="page">
      <div className="pagehead"><h1>{t("ep.tp.title")}</h1>
        <span className="sub">{t("ep.tp.sub")} <Link href="/eps/wbs">WBS</Link> · <Link href="/eps/activities">{t("ep.link.activities")}</Link></span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg toast" role="status">{ok}</p>}
      {tf && (
        <form className="card" data-tpl-form onSubmit={async (e) => { e.preventDefault(); if (!window.confirm(t("gr.addAsk"))) return;
          if (await post({ kind: "template", ...tf, parentId: tf.parentId || null }, (r) => t("ep.tp.saved", { code: r.row.code }))) setTf(null); }}>
          <h2>{tf.parentId ? t("ep.tp.childOf", { code: data.templates.find((x) => x.id === tf.parentId)?.code }) : t("ep.tp.newTitle")}</h2>
          <div className="grid2">
            <div className="field"><label htmlFor="tp-code">{t("ep.col.template")}</label><input id="tp-code" dir="ltr" required value={tf.code} onChange={(e) => setTf({ ...tf, code: e.target.value.toUpperCase() })} placeholder="T-PIP" /></div>
            <div className="field"><label htmlFor="tp-name">{t("ep.tp.name")}</label><input id="tp-name" required value={tf.name} onChange={(e) => setTf({ ...tf, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="tp-desc">{t("ep.description")}</label><input id="tp-desc" value={tf.description} onChange={(e) => setTf({ ...tf, description: e.target.value })} /></div>
          </div>
          <button className="btn" type="submit">{t("ep.save")}</button> <button className="btn ghost" type="button" onClick={() => setTf(null)}>{t("ep.cancel")}</button>
        </form>)}
      {data.templates.length === 0 && !tf ? <div className="card"><p className="empty-note">{t("ep.tp.none")}</p>
        {may && <p><button className="btn" type="button" data-tpl-new onClick={() => setTf({ ...BLANK_T })}>{t("ep.tp.new")}</button></p>}</div> : data.templates.length > 0 && <>
        <div style={{ height }} data-templates-tree>
          <ActivityGrid data={tree} columns={TPL_COLUMNS} defaultCols={DEFAULT_COLS} storeKey="p6-templates-2" customKey="eps-activities" selected={sel?.id} onSelect={setSel}
            gantt={false} toolbar={toolbar} ops={ops} />
        </div>
        {grip}
        <p className="sm muted">{t("ep.tp.gridHint")}</p></>}
    </div>
  );
}
