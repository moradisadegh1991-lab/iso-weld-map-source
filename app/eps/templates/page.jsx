"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { useTreeDrag } from "../../../components/ui/treeDrag";
import { usePrefs } from "../../../lib/client/prefs.mjs";

import TableKit from "../../../components/ui/TableKit";
import { useEpsFmt } from "../../../components/eps/ActivityDetail";
import { wIn, wOut } from "../../../components/eps/shared";
/**
 * Activity templates: a tree of templates, each with its activities — row
 * number (its code is the template's code and two digits), name, W.F and
 * description. A template is copied with its activities and pasted as the
 * child of another; templates move by drag and drop. Each template opens
 * and closes in the tree to show its sub-templates and its activities; «اعمال
 * روی WBS» pushes the template's activities as they are now onto every WBS
 * node that took them (lib/db/repos/eps.mjs syncTemplate).
 */
const BLANK_T = { id: null, parentId: "", code: "", name: "", description: "" };
const BLANK_A = { id: null, number: "", name: "", wf: "", description: "" };
const tree = (rows) => {
  const by = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const r of by.values()) (r.parent_id && by.has(r.parent_id) ? by.get(r.parent_id).children : roots).push(r);
  const sort = (xs) => { xs.sort((a, b) => a.seq - b.seq || a.code.localeCompare(b.code)); xs.forEach((x) => sort(x.children)); };
  sort(roots);
  return roots;
};

export default function TemplatesPage() {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/eps?projectId=${id}&templates=1`, []);
  const { t: tx } = usePrefs();          // `t` is a template in this file
  const { w } = useEpsFmt();
  const [sel, setSel] = useState(null);
  const [tf, setTf] = useState(null);
  const [af, setAf] = useState(BLANK_A);
  const [clip, setClip] = useState(null);
  const [shut, setShut] = useState(new Set());       // templates closed in the tree
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/eps", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  const dnd = useTreeDrag((d, t, zone) => post(zone === "inside" ? { kind: "template-move", id: d.id, parentId: t.id }
    : { kind: "template-move", id: d.id, parentId: t.parentId || null, [zone === "before" ? "beforeId" : "afterId"]: t.id }, () => tx("ep.tp.moved")));
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{tx("common.loading")}</p>;
  const may = data.may.edit;
  const T = data.templates.find((t) => t.id === sel) || null;
  const flip = (id) => setShut((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function sync(t) {
    setMsg(null); setOk(null);
    try {
      const dry = (await call("/api/eps", { method: "POST", body: JSON.stringify({ projectId, kind: "template-sync", templateId: t.id, dryRun: true }) })).row;
      if (!dry.updated && !dry.added) { setOk(tx("ep.tp.inSync", { code: t.code })); return; }
      if (!window.confirm(tx("ep.tp.syncAsk", { code: t.code, updated: dry.updated, added: dry.added, nodes: dry.nodes.join(tx("ep.sep")), versions: dry.versions.join(tx("ep.sep")) }))) return;
      await post({ kind: "template-sync", templateId: t.id }, (r) => tx("ep.tp.synced", { updated: r.row.updated, added: r.row.added }));
    } catch (e) { setMsg(e.message); }
  }
  const rows = (nodes, depth) => nodes.flatMap((t) => [
    <tr key={t.id} data-template={t.code} {...(may ? { ...dnd.source({ id: t.id }), ...dnd.target({ id: t.id, parentId: t.parent_id }) } : {})}
      onClick={() => { setSel(t.id); setAf(BLANK_A); }}
      style={{ cursor: "pointer", background: sel === t.id ? "var(--hl, #eef6f8)" : undefined, ...dnd.look({ id: t.id }) }}>
      <td style={{ paddingInlineStart: 8 + depth * 20, whiteSpace: "nowrap" }}>
        <button type="button" className="btn ghost sm" style={{ padding: "0 4px", visibility: t.children.length || t.activities.length ? "visible" : "hidden" }}
          aria-label={tx(shut.has(t.id) ? "ep.g.open" : "ep.close")} onClick={(e) => { e.stopPropagation(); flip(t.id); }}>{shut.has(t.id) ? "◂" : "▾"}</button>
        {may && <span className="muted" aria-hidden="true">⠿ </span>}<span className="mono">{t.code}</span></td>
      <td>{t.name}</td><td className="mono">{t.activities.length}</td>
      <td className="mono" style={{ color: t.wfTotal > 100 ? "var(--bad)" : undefined }}>{t.activities.length ? w(t.wfTotal) : "—"}</td>
      <td style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>{may && <>
        <button className="btn ghost sm" type="button" onClick={() => { setClip(t); setOk(tx("ep.tp.copied", { code: t.code })); }}>{tx("ep.tp.copy")}</button>
        {clip && clip.id !== t.id && <button className="btn ghost sm" type="button"
          onClick={() => post({ kind: "template-copy", id: clip.id, parentId: t.id }, (r) => tx("ep.tp.pasted", { code: r.row.code, under: t.code }))}>{tx("ep.tp.paste")}</button>}
        <button className="btn ghost sm" type="button" onClick={() => setTf({ ...BLANK_T, parentId: t.id })}>{tx("ep.tp.addChild")}</button>
        <button className="btn ghost sm" type="button" onClick={() => setTf({ id: t.id, parentId: t.parent_id || "", code: t.code, name: t.name, description: t.description || "" })}>{tx("ep.edit")}</button>
        <button className="btn ghost sm" type="button" onClick={() => post({ kind: "template-remove", id: t.id }, () => tx("ep.removed"))}>{tx("ep.remove")}</button></>}</td>
    </tr>,
    ...(shut.has(t.id) ? [] : [
      ...t.activities.map((a) => (
        <tr key={a.id} className="sm" data-tree-activity={a.code} onClick={() => { setSel(t.id); setAf({ id: a.id, number: String(a.number), name: a.name, wf: wIn(a.wf), description: a.description || "" }); }}
          style={{ cursor: "pointer" }}>
          <td style={{ paddingInlineStart: 34 + depth * 20 }}><span className="mono muted">{a.code}</span></td><td className="muted">{a.name}</td><td />
          <td className="mono muted">{w(a.wf)}</td><td /></tr>)),
      ...rows(t.children, depth + 1)])]);
  const all = (ns) => ns.flatMap((t) => [t.id, ...all(t.children)]);
  const flat = data.templates;
  return (
    <div className="page">
      <div className="pagehead"><h1>{tx("ep.tp.title")}</h1><span className="sub">{tx("ep.tp.sub")}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg toast" role="status">{ok}</p>}
      {may && !tf && <p style={{ display: "flex", gap: 8 }}><button className="btn" type="button" onClick={() => setTf({ ...BLANK_T })}>{tx("ep.tp.new")}</button>
        {clip && <button className="btn ghost" type="button" onClick={() => post({ kind: "template-copy", id: clip.id, parentId: null }, (r) => tx("ep.tp.pastedTop", { code: r.row.code }))}>{tx("ep.tp.pasteTop", { code: clip.code })}</button>}</p>}
      {tf && (
        <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "template", ...tf, parentId: tf.parentId || null }, (r) => tx("ep.tp.saved", { code: r.row.code }))) setTf(null); }}>
          <h2>{tf.id ? tx("ep.tp.edit", { code: tf.code }) : tf.parentId ? tx("ep.tp.childOf", { code: flat.find((x) => x.id === tf.parentId)?.code }) : tx("ep.tp.newTitle")}</h2>
          <div className="grid2">
            <div className="field"><label htmlFor="tp-code">{tx("ep.col.template")}</label><input id="tp-code" dir="ltr" required value={tf.code} onChange={(e) => setTf({ ...tf, code: e.target.value.toUpperCase() })} placeholder="T-PIP" /></div>
            <div className="field"><label htmlFor="tp-name">{tx("ep.tp.name")}</label><input id="tp-name" required value={tf.name} onChange={(e) => setTf({ ...tf, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="tp-desc">{tx("ep.description")}</label><input id="tp-desc" value={tf.description} onChange={(e) => setTf({ ...tf, description: e.target.value })} /></div>
          </div>
          <button className="btn" type="submit">{tx("ep.save")}</button> <button className="btn ghost" type="button" onClick={() => setTf(null)}>{tx("ep.cancel")}</button>
        </form>)}
      <div className="card">
        <h2>{tx("ep.tp.list")}</h2>
        {flat.length > 0 && <p className="row" style={{ gap: 6 }}>
          <button className="btn ghost sm" type="button" onClick={() => setShut(new Set())}>{tx("ep.g.openAll")}</button>
          <button className="btn ghost sm" type="button" onClick={() => setShut(new Set(all(tree(flat))))}>{tx("ep.tp.closeAll")}</button></p>}
        {flat.length === 0 ? <p className="empty-note">{tx("ep.tp.none")}</p> : (
          <div className="tablewrap"><TableKit name="eps-templates-1"><table className="dtable">
            <thead><tr><th>{tx("ep.code")}</th><th>{tx("ep.name")}</th><th>{tx("ep.activity")}</th><th>{tx("ep.tp.wfTotal")}</th><th /></tr></thead>
            <tbody>{rows(tree(flat), 0)}</tbody></table></TableKit></div>)}
        {may && flat.length > 1 && <p className="sm muted">{tx("ep.tp.dragHint")}</p>}
      </div>
      {T && (
        <div className="card">
          <h2>{tx("ep.tp.activitiesOf")} <span className="mono">{T.code}</span> — {T.name}</h2>
          {may && T.activities.length > 0 && <p><button className="btn" type="button" data-sync={T.code} onClick={() => sync(T)}>{tx("ep.tp.sync")}</button>
            <span className="sm muted"> {tx("ep.tp.syncNote")}</span></p>}
          <TableKit name="eps-templates-2"><table className="dtable">
            <thead><tr><th>{tx("ep.tp.row")}</th><th>{tx("ep.cd.code")}</th><th>{tx("ep.activityName")}</th><th>{tx("ep.tp.wf")}</th><th>{tx("ep.description")}</th>{may && <th />}</tr></thead>
            <tbody>{T.activities.map((a) => (
              <tr key={a.id} data-template-activity={a.code}><td className="mono">{a.number}</td><td className="mono">{a.code}</td><td>{a.name}</td><td className="mono">{w(a.wf)}</td>
                <td className="sm">{a.description || "—"}</td>
                {may && <td><button className="btn ghost sm" type="button" onClick={() => setAf({ id: a.id, number: String(a.number), name: a.name, wf: wIn(a.wf), description: a.description || "" })}>{tx("ep.edit")}</button>
                  <button className="btn ghost sm" type="button" onClick={() => post({ kind: "template-activity-remove", id: a.id }, () => tx("ep.removed"))}>{tx("ep.remove")}</button></td>}</tr>))}
              {T.activities.length > 0 && <tr><td colSpan={3}><b>{tx("ep.total")}</b></td><td className="mono"><b>{w(T.wfTotal)}</b></td><td colSpan={may ? 2 : 1} /></tr>}</tbody></table></TableKit>
          {may && (
            <form className="row" style={{ gap: 6, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}
              onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "template-activity", templateId: T.id, ...af, wf: wOut(af.wf) }, () => tx(af.id ? "ep.tp.actEdited" : "ep.tp.actAdded"))) setAf(BLANK_A); }}>
              <div className="field" style={{ width: 90 }}><label htmlFor="ta-n">{tx("ep.tp.rowNext")}</label><input id="ta-n" dir="ltr" inputMode="numeric" value={af.number} onChange={(e) => setAf({ ...af, number: e.target.value })} /></div>
              <div className="field"><label htmlFor="ta-name">{tx("ep.activityName")}</label><input id="ta-name" required value={af.name} onChange={(e) => setAf({ ...af, name: e.target.value })} /></div>
              <div className="field" style={{ width: 110 }}><label htmlFor="ta-wf">W.F</label><input id="ta-wf" dir="ltr" inputMode="decimal" value={af.wf} onChange={(e) => setAf({ ...af, wf: e.target.value })} /></div>
              <div className="field"><label htmlFor="ta-d">{tx("ep.description")}</label><input id="ta-d" value={af.description} onChange={(e) => setAf({ ...af, description: e.target.value })} /></div>
              <button className="btn" type="submit">{af.id ? tx("ep.save") : tx("ep.tp.addActivity")}</button>
              {af.id && <button className="btn ghost" type="button" onClick={() => setAf(BLANK_A)}>{tx("ep.cancel")}</button>}
            </form>)}
        </div>)}
    </div>
  );
}
