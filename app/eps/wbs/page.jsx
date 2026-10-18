"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { useTreeDrag } from "../../../components/ui/treeDrag";
import { usePrefs } from "../../../lib/client/prefs.mjs";
import { useEpsFmt } from "../../../components/eps/ActivityDetail";
import { SEPARATOR_NAMES } from "../../../lib/eps/wbs.mjs";

import TableKit from "../../../components/ui/TableKit";
/**
 * A version's WBS. Part one: the settings — a colour per level, how each
 * level is numbered and the separator, and how budget and weight relate
 * (typed by hand / budget from W.F / W.F from budget). Part two: the tree
 * under the PMS code — nodes added, edited, moved under another node by drag
 * and drop or above / below a sibling, copied with everything under them,
 * opened and closed by level — and each node's activities, from a template
 * or by hand. Every derived figure comes from the server's rules
 * (lib/eps/wbs.mjs); this page only shows them.
 */
const BLANK_NODE = { name: "", code: "", budgetPlan: "", budgetActual: "", qty: "", unit: "", volumePlan: "", volumeActual: "", wf: "",
  planStart: "", planEnd: "", actualStart: "", actualEnd: "", description: "", templateId: "" };
const toForm = (n) => ({ id: n.id, parentId: n.parent_id, code: n.code, name: n.name, budgetPlan: n.budget_plan ?? "", budgetActual: n.budget_actual ?? "",
  qty: n.qty ?? "", unit: n.unit || "", volumePlan: n.volume_plan ?? "", volumeActual: n.volume_actual ?? "", wf: n.wf_typed ?? n.wf ?? "",
  planStart: n.plan_start || "", planEnd: n.plan_end || "", actualStart: n.actual_start || "", actualEnd: n.actual_end || "",
  description: n.description || "", templateId: n.template_id || "" });

export default function WbsPage() {
  const { projectId, contractId, call } = usePlatform();
  const [versionId, setVersionId] = useState(null);
  useEffect(() => { const v = new URLSearchParams(window.location.search).get("version"); if (v) setVersionId(v); }, []);
  const board = useProjectData((id) => (contractId ? `/api/eps?projectId=${id}&contractId=${contractId}` : null), [contractId]);
  const { data, error, reload } = useProjectData((id) => (versionId ? `/api/eps?projectId=${id}&versionId=${versionId}` : null), [versionId]);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [closed, setClosed] = useState(new Set());
  const [openActs, setOpenActs] = useState(new Set());
  const [form, setForm] = useState(null);           // { mode: "add"|"edit", parentId, ...fields }
  const [clip, setClip] = useState(null);
  const { t } = usePrefs();
  const { fmt, day } = useEpsFmt();
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/eps", { method: "POST", body: JSON.stringify({ projectId, versionId, ...body }) }); reload(); board.reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  const dnd = useTreeDrag((d, to, zone) => post(zone === "inside" ? { kind: "node-move", id: d.id, parentId: to.id === "root" ? null : to.id }
    : { kind: "node-move", id: d.id, parentId: to.parentId, [zone === "before" ? "beforeId" : "afterId"]: to.id }, () => t("ep.wb.moved")),
  { sibling: (d, to) => to.id !== "root" });
  const versions = (board.data?.pms || []).flatMap((p) => p.versions.map((v) => ({ ...v, pmsCode: p.code })));
  useEffect(() => { if (!versionId && versions.length) setVersionId(versions[0].id); }, [versions.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!contractId) return <div className="page"><div className="pagehead"><h1>{t("ep.wb.title")}</h1></div><p className="empty-note">{t("cs.pick")}</p></div>;
  const head = (
    <div className="pagehead"><h1>{t("ep.wb.title")}</h1>
      <span className="sub"><select aria-label={t("ep.version")} value={versionId || ""} onChange={(e) => { setVersionId(e.target.value); setForm(null); }}>
        {versions.length === 0 && <option value="">{t("ep.noVersion")}</option>}
        {versions.map((v) => <option key={v.id} value={v.id}>{v.pmsCode} › {v.code} — {v.title}</option>)}</select>
        {" "}<Link href="/eps">{t("ep.link.board")}</Link> · <Link href="/eps/templates">{t("ep.tp.title")}</Link></span></div>);
  if (error) return <div className="page">{head}<p className="err">{error}</p></div>;
  if (!versionId) return <div className="page">{head}<p className="empty-note">{t("ep.noPlan")}</p></div>;
  if (!data) return <div className="page">{head}<p className="muted">{t("common.loading")}</p></div>;
  const may = data.may.edit;
  const S = data.settings;
  const mode = S.budgetMode;
  const maxLevel = (function deep(ns, l) { return ns.reduce((m, n) => Math.max(m, deep(n.children, l + 1)), ns.length ? l : l - 1); })(data.roots, 1);
  const openTo = (lvl) => {
    const c = new Set();
    const walk = (ns) => ns.forEach((n) => { if (n.level >= lvl) c.add(n.id); walk(n.children); });
    walk(data.roots); setClosed(c);
  };
  const flip = (set, setter, id) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); setter(n); };
  const withActs = data.templates.filter((x) => x.activities.length > 0);
  const tint = (c) => `${c}1a`;

  async function openAdd(parentId) {
    let code = "";
    try { code = (await call(`/api/eps?projectId=${projectId}&versionId=${versionId}&suggest=1${parentId ? `&parentId=${parentId}` : ""}`)).code; } catch { /* typed by hand */ }
    setForm({ mode: "add", parentId, ...BLANK_NODE, code });
  }
  const nodeRow = (n) => {
    const kids = n.children.length > 0, isClosed = closed.has(n.id);
    return [
      <tr key={n.id} data-wbs={n.code} {...(may ? { ...dnd.source({ id: n.id }), ...dnd.target({ id: n.id, parentId: n.parent_id || null }) } : {})}
        style={{ background: tint(n.color), borderInlineStart: `4px solid ${n.color}`, cursor: may ? "grab" : undefined, ...dnd.look({ id: n.id }) }}>
        <td style={{ paddingInlineStart: 6 + (n.level - 1) * 18, whiteSpace: "nowrap" }}>
          <button type="button" className="btn ghost sm" aria-label={t(isClosed ? "ep.g.open" : "ep.close")} disabled={!kids} onClick={() => flip(closed, setClosed, n.id)}
            style={{ visibility: kids ? "visible" : "hidden", padding: "0 4px" }}>{isClosed ? "◂" : "▾"}</button>
          <span className="mono" style={{ color: n.color, fontWeight: 600 }}>{n.code}</span></td>
        <td>{n.name}{n.description && <div className="sm muted">{n.description}</div>}</td>
        <td className="mono">{fmt(n.budgetPlan)}</td><td className="mono">{fmt(n.budgetActual)}</td>
        <td className="mono">{fmt(n.qty)}</td><td className="mono">{fmt(n.volume_plan)} / {fmt(n.volume_actual)} {n.unit || ""}</td>
        <td className="mono">{n.wf == null ? "—" : `${fmt(n.wf, 4)}%`}{kids && <div className="sm muted" title={t("ep.wb.childWf")}>Σ {fmt(n.childWf, 4)}%</div>}</td>
        <td className="mono">{n.wv == null ? "—" : `${fmt(n.wv, 4)}%`}</td>
        <td className="mono sm">{day(n.plan_start)} — {day(n.plan_end)}{n.planDays && <div className="muted">{t("ep.wb.days", { n: fmt(n.planDays) })}</div>}</td>
        <td className="mono sm">{day(n.actual_start)} — {day(n.actual_end)}{n.actualDays && <div className="muted">{t("ep.wb.days", { n: fmt(n.actualDays) })}</div>}</td>
        <td className="sm">{n.template_id ? <span className="mono">{data.templates.find((x) => x.id === n.template_id)?.code}</span> : "—"}
          <div><button type="button" className="btn ghost sm" onClick={() => flip(openActs, setOpenActs, n.id)} data-acts={n.code}>{t("ep.g.count", { n: n.activities.length })} {openActs.has(n.id) ? "▴" : "▾"}</button></div></td>
        <td style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>{may && <>
          <button className="btn ghost sm" type="button" onClick={() => openAdd(n.id)} title={t("ep.wb.child")}>+</button>
          <button className="btn ghost sm" type="button" onClick={() => setForm({ mode: "edit", ...toForm(n) })}>{t("ep.edit")}</button>
          <button className="btn ghost sm" type="button" onClick={() => { setClip(n); setOk(t("ep.wb.copied", { code: n.code })); }}>{t("ep.tp.copy")}</button>
          {clip && clip.id !== n.id && <button className="btn ghost sm" type="button" onClick={() => post({ kind: "node-copy", id: clip.id, parentId: n.id }, (r) => t("ep.wb.pasted", { code: r.row.code }))}>{t("ep.tp.paste")}</button>}
          <button className="btn ghost sm" type="button" onClick={() => post({ kind: "node-remove", id: n.id }, () => t("ep.removed"))}>{t("ep.remove")}</button></>}</td>
      </tr>,
      openActs.has(n.id) && <tr key={`${n.id}-acts`}><td colSpan={12} style={{ background: "var(--surf, #fff)" }}><Activities n={n} may={may} post={post} templates={withActs} /></td></tr>,
      ...(isClosed ? [] : n.children.flatMap(nodeRow)),
    ];
  };
  return (
    <div className="page">
      {head}
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      {data.problems.length > 0 && <div className="card" style={{ borderColor: "var(--bad)" }}><b>{t("ep.ac.problems")}</b><ul className="sm">{data.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      <Settings S={S} labels={data.labels} may={may} post={post} pmsCode={data.version.pms_code} />
      {form && <NodeForm form={form} setForm={setForm} mode={mode} templates={withActs} post={post} />}
      <div className="card">
        <h2>{t("ep.wb.structure", { pms: data.version.pms_code })} <span className="sm muted">{t("ep.wb.rootBudget", { code: data.version.code, budget: fmt(data.version.budget_plan) })}</span></h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <span className="sm">{t("ep.g.levels")}:</span>
          {Array.from({ length: Math.max(maxLevel, 1) }, (_, i) => i + 1).map((l) => <button key={l} className="btn ghost sm" type="button" onClick={() => openTo(l)}>{l}</button>)}
          <button className="btn ghost sm" type="button" onClick={() => setClosed(new Set())}>{t("ep.wb.all")}</button>
          {clip && <span className="sm">{t("ep.wb.clip")} <b className="mono">{clip.code}</b> <button className="btn ghost sm" type="button" onClick={() => setClip(null)}>×</button></span>}
        </div>
        <div className="tablewrap"><TableKit name="eps-wbs-1"><table className="dtable" data-wbs-table="">
          <thead><tr><th>{t("ep.wb.code")}</th><th>{t("ep.wb.name")}</th><th>{t("ep.wb.budgetPlan")}</th><th>{t("ep.d.budgetActual")}</th><th>{t("ep.wb.qty")}</th><th>{t("ep.wb.volumes")}</th><th>W.F</th><th>W.V</th>
            <th>{t("ep.wb.planned")}</th><th>{t("ep.wb.actual")}</th><th>{t("ep.wb.tplActs")}</th><th /></tr></thead>
          <tbody>
            <tr data-wbs-root="" {...(may ? dnd.target({ id: "root" }) : {})} style={{ fontWeight: 700, ...dnd.look({ id: "root" }) }}>
              <td className="mono">{data.version.pms_code}</td><td>{data.version.pms_title} — {data.version.title}</td>
              <td className="mono">{fmt(data.version.budget_plan)}</td><td className="mono">{fmt(data.version.budget_actual)}</td><td /><td />
              <td className="mono sm">Σ {fmt(data.rootWf, 4)}%</td><td className="mono">{fmt(100)}%</td>
              <td className="mono sm">{day(data.version.start_on)} — {day(data.version.end_on)}</td><td /><td />
              <td style={{ whiteSpace: "nowrap" }}>{may && <><button className="btn sm" type="button" onClick={() => openAdd(null)}>{t("ep.wb.addTop")}</button>
                {clip && <button className="btn ghost sm" type="button" onClick={() => post({ kind: "node-copy", id: clip.id, parentId: null }, (r) => t("ep.wb.pasted", { code: r.row.code }))}>{t("ep.tp.paste")}</button>}</>}</td>
            </tr>
            {data.roots.flatMap(nodeRow)}
          </tbody></table></TableKit></div>
        {may && <p className="sm muted">{t("ep.wb.dragHint")}</p>}
      </div>
    </div>
  );
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
    <details className="card" open={false}>
      <summary><b>{t("ep.ws.title")}</b> <span className="sm muted">— {mode(S.budgetMode)} · {t("ep.ws.summary", { sep: S.separator, n: S.levels.length })}</span></summary>
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
    </details>
  );
}

function NodeForm({ form, setForm, mode, templates, post }) {
  const { t } = usePrefs();
  const code = useRef(null);
  // the suggested code is selected, so typing replaces it and leaving it keeps it
  useEffect(() => { code.current?.focus(); code.current?.select(); }, [form.mode, form.parentId, form.id]);
  const F = (k, l, extra = {}) => (
    <div className="field" key={k}><label htmlFor={`nf-${k}`}>{l}</label>
      <input id={`nf-${k}`} value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...extra} /></div>);
  const save = async (e) => {
    e.preventDefault();
    const { mode: m, ...b } = form;
    if (await post({ kind: "node", ...b, templateId: b.templateId || null }, (r) => t("ep.wb.saved", { code: r.row.code }))) setForm(null);
  };
  return (
    <form className="card" onSubmit={save}>
      <h2>{form.mode === "add" ? t("ep.wb.new") : t("ep.wb.edit", { code: form.code })}</h2>
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
      <p className="sm muted">{t("ep.wb.wvNote")}</p>
      <button className="btn" type="submit">{t("ep.save")}</button> <button className="btn ghost" type="button" onClick={() => setForm(null)}>{t("ep.cancel")}</button>
    </form>
  );
}

function Activities({ n, may, post, templates }) {
  const { t } = usePrefs();
  const { fmt, day } = useEpsFmt();
  const [tpl, setTpl] = useState(n.template_id || "");
  const [f, setF] = useState(null);
  return (
    <div style={{ padding: "4px 0" }} data-activities={n.code}>
      <TableKit name="eps-wbs-3"><table className="dtable">
        <thead><tr><th>{t("ep.cd.code")}</th><th>{t("ep.wb.tplActivity")}</th><th>{t("ep.activityName")}</th><th>W.F</th><th>W.V</th><th>{t("ep.wb.budgets")}</th><th>{t("ep.wb.volumes")}</th>
          <th>{t("ep.wb.planned")}</th><th>{t("ep.wb.actual")}</th><th>{t("ep.col.pct")}</th>{may && <th />}</tr></thead>
        <tbody>{n.activities.map((a) => (
          <tr key={a.id} data-activity={a.code}><td className="mono">{a.code}</td><td className="mono sm">{a.template_code || t("ep.wb.manual")}</td><td>{a.name}</td>
            <td className="mono">{a.wf == null ? "—" : `${fmt(a.wf, 4)}%`}</td><td className="mono">{a.wv == null ? "—" : `${fmt(a.wv, 4)}%`}</td>
            <td className="mono">{fmt(a.budgetPlan)} / {fmt(a.budgetActual)}</td><td className="mono">{fmt(a.volumePlan)} / {fmt(a.volumeActual)} {a.unit || ""}</td>
            <td className="mono sm">{day(a.plan_start)} — {day(a.plan_end)}</td><td className="mono sm">{day(a.actual_start)} — {day(a.actual_end)}</td>
            <td className="mono">{a.progress == null ? "—" : `${fmt(a.progress)}%`}</td>
            {may && <td style={{ whiteSpace: "nowrap" }}>
              <button className="btn ghost sm" type="button" onClick={() => setF({ id: a.id, code: a.code, name: a.name, wf: a.wf ?? "", progress: a.progress ?? "", description: a.description || "" })}>{t("ep.edit")}</button>
              <button className="btn ghost sm" type="button" onClick={() => post({ kind: "activity-remove", id: a.id }, () => t("ep.removed"))}>{t("ep.remove")}</button></td>}</tr>))}
          {n.activities.length > 0 && <tr><td colSpan={3}><b>{t("ep.total")}</b></td><td className="mono"><b>{fmt(n.activityWf, 4)}%</b></td><td colSpan={may ? 7 : 6} /></tr>}</tbody></table></TableKit>
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
          onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "activity", nodeId: n.id, ...f }, () => t(f.id ? "ep.activitySaved" : "ep.tp.actAdded"))) setF(null); }}>
          <div className="field" style={{ width: 170 }}><label htmlFor={`af-c-${n.id}`}>{t("ep.ac.codeNext")}</label><input id={`af-c-${n.id}`} dir="ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="field"><label htmlFor={`af-n-${n.id}`}>{t("ep.activityName")}</label><input id={`af-n-${n.id}`} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field" style={{ width: 100 }}><label htmlFor={`af-w-${n.id}`}>W.F %</label><input id={`af-w-${n.id}`} dir="ltr" inputMode="decimal" value={f.wf} onChange={(e) => setF({ ...f, wf: e.target.value })} /></div>
          <div className="field" style={{ width: 100 }}><label htmlFor={`af-p-${n.id}`}>{t("ep.col.pct")}</label><input id={`af-p-${n.id}`} dir="ltr" inputMode="decimal" value={f.progress} onChange={(e) => setF({ ...f, progress: e.target.value })} /></div>
          <div className="field"><label htmlFor={`af-d-${n.id}`}>{t("ep.description")}</label><input id={`af-d-${n.id}`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <button className="btn sm" type="submit">{t("ep.save")}</button><button className="btn ghost sm" type="button" onClick={() => setF(null)}>{t("ep.cancel")}</button>
        </form>)}
      <p className="sm muted">{t("ep.wb.actNote")}</p>
    </div>
  );
}
