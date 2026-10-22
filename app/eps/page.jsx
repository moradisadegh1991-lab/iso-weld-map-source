"use client";
import { useState } from "react";
import TemplateButton from "../../components/ui/TemplateButton";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { useTreeDrag } from "../../components/ui/treeDrag";
import { usePrefs } from "../../lib/client/prefs.mjs";
import { useEpsFmt } from "../../components/eps/ActivityDetail";

import TableKit from "../../components/ui/TableKit";
/**
 * The contract's EPS: its PMSs, and under each the versions of its
 * schedule. A version is dragged onto another PMS to move there, or above
 * or below another version to change the order; a PMS likewise among the
 * PMSs. Each version's WBS opens from here. One version of each PMS may be
 * its master plan (the baseline the delay claim is measured against).
 */
const BLANK_PMS = { id: null, code: "", title: "", pmsType: "", description: "", registeredOn: "", planStart: "", planEnd: "", actualStart: "", actualEnd: "", budgetPlan: "", budgetActual: "" };
const BLANK_VER = { id: null, pmsId: "", code: "", title: "", description: "", registeredOn: "", startOn: "", endOn: "", budgetPlan: "", budgetActual: "" };
const span = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1 : null);

export default function EpsPage() {
  const { projectId, contractId, contract, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => (contractId ? `/api/eps?projectId=${id}&contractId=${contractId}` : null), [contractId]);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [pf, setPf] = useState(null);
  const [vf, setVf] = useState(null);
  const [imp, setImp] = useState(null);
  const { t } = usePrefs();
  const { fmt, day } = useEpsFmt();
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/eps", { method: "POST", body: JSON.stringify({ projectId, contractId, ...body }) }); reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  const dnd = useTreeDrag((d, to, zone) => {
    if (d.kind === "pms") post({ kind: "eps-move", epsKind: "pms", id: d.id, [zone === "before" ? "beforeId" : "afterId"]: to.id }, () => t("ep.bd.pmsOrder"));
    else if (to.kind === "pms") post({ kind: "eps-move", epsKind: "version", id: d.id, pmsId: to.id }, () => t("ep.bd.versionMoved", { code: to.code }));
    else post({ kind: "eps-move", epsKind: "version", id: d.id, pmsId: to.pmsId, [zone === "before" ? "beforeId" : "afterId"]: to.id }, () => t("ep.bd.versionOrder"));
  }, {
    inside: (d, t) => d.kind === "version" && t.kind === "pms",
    sibling: (d, t) => d.kind === t.kind,
  });
  if (!contractId) return <div className="page"><div className="pagehead"><h1>{t("ep.link.board")}</h1></div><p className="empty-note">{t("cs.pick")}</p></div>;
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const may = data.may.edit;
  const pmsRow = (p) => (
    <tr key={p.id} data-pms={p.code} {...(may ? { ...dnd.source({ id: p.id, kind: "pms" }), ...dnd.target({ id: p.id, kind: "pms", code: p.code }) } : {})}
      style={{ background: "var(--surf2, #f5f7f9)", cursor: may ? "grab" : undefined, ...dnd.look({ id: p.id }) }}>
      <td><b>{may && <span className="muted" aria-hidden="true">⠿ </span>}▾ <span className="mono">{p.code}</span></b></td>
      <td><b>{p.title}</b>{p.pms_type && <span className="chip" style={{ marginInlineStart: 6 }}>{p.pms_type}</span>}{p.description && <div className="sm muted">{p.description}</div>}</td>
      <td className="mono sm">{day(p.registered_on)}</td>
      <td className="mono sm">{day(p.plan_start)} — {day(p.plan_end)}</td><td className="mono">{fmt(p.planDays)}</td>
      <td className="mono sm">{day(p.actual_start)} — {day(p.actual_end)}</td><td className="mono">{fmt(p.actualDays)}</td>
      <td className="mono">{t("ep.bd.pmsCounts", { v: p.versions.length, n: p.nodes })}</td>
      <td style={{ whiteSpace: "nowrap" }}><Link className="btn sm" href={`/eps/wbs?pms=${p.id}`}>WBS</Link>{may && <>
        <button className="btn ghost sm" type="button" onClick={() => { setVf({ ...BLANK_VER, pmsId: p.id, code: `${p.code}-R${p.versions.length + 1}` }); setPf(null); }}>{t("ep.bd.addVersion")}</button>
        <button className="btn ghost sm" type="button" onClick={() => { setPf({ id: p.id, code: p.code, title: p.title, pmsType: p.pms_type || "", description: p.description || "", registeredOn: p.registered_on || "", planStart: p.plan_start || "",
          planEnd: p.plan_end || "", actualStart: p.actual_start || "", actualEnd: p.actual_end || "", budgetPlan: p.budget_plan ?? "", budgetActual: p.budget_actual ?? "" }); setVf(null); }}>{t("ep.edit")}</button>
        <button className="btn ghost sm" type="button" onClick={() => post({ kind: "eps-remove", epsKind: "pms", id: p.id }, () => t("ep.removed"))}>{t("ep.remove")}</button></>}</td>
    </tr>);
  const versionRow = (p, v) => (
    <tr key={v.id} data-version={v.code} {...(may ? { ...dnd.source({ id: v.id, kind: "version" }), ...dnd.target({ id: v.id, kind: "version", pmsId: p.id }) } : {})}
      style={{ cursor: may ? "grab" : undefined, ...dnd.look({ id: v.id }) }}>
      <td style={{ paddingInlineStart: 28 }}>{may && <span className="muted" aria-hidden="true">⠿ </span>}<span className="mono">{v.code}</span>
        {v.master && <span className="chip" style={{ marginInlineStart: 6, borderColor: "var(--ok, #1e8449)", color: "var(--ok, #1e8449)" }} data-master={v.code}>Master plan</span>}</td>
      <td>{v.title}{v.description && <div className="sm muted">{v.description}</div>}</td>
      <td className="mono sm">{day(v.registered_on)}</td>
      <td className="mono sm">{day(v.start_on)} — {day(v.end_on)}</td><td className="mono">{fmt(v.days)}</td>
      <td className="sm" colSpan={2}>{t("ep.bd.budget", { plan: fmt(v.budget_plan), actual: fmt(v.budget_actual) })}</td>
      <td className="mono">{t("ep.bd.planned", { n: v.planned })}</td>
      <td style={{ whiteSpace: "nowrap" }}>
        <Link className="btn sm" href={`/eps/planning?version=${v.id}`}>{t("ep.link.planning")}</Link>
        <Link className="btn ghost sm" href={`/eps/activities?version=${v.id}`}>{t("ep.link.activities")}</Link>
        {may && <label className="sm" style={{ marginInline: 6, whiteSpace: "nowrap" }} title={t("ep.bd.masterTip")}>
          <input type="radio" name={`master-${p.id}`} checked={!!v.master} aria-label={t("ep.bd.masterOf", { code: v.code })}
            onChange={() => post({ kind: "version-master", id: v.id, master: true }, () => t("ep.bd.masterSet", { code: v.code, pms: p.code }))} /> Master</label>}
        {may && <>
          <button className="btn ghost sm" type="button" onClick={() => { setVf({ id: v.id, pmsId: p.id, code: v.code, title: v.title, description: v.description || "", registeredOn: v.registered_on || "",
            startOn: v.start_on || "", endOn: v.end_on || "", budgetPlan: v.budget_plan ?? "", budgetActual: v.budget_actual ?? "" }); setPf(null); }}>{t("ep.edit")}</button>
          <button className="btn ghost sm" type="button" onClick={() => post({ kind: "eps-remove", epsKind: "version", id: v.id }, () => t("ep.removed"))}>{t("ep.remove")}</button></>}</td>
    </tr>);
  const F = (st, set, k, l, type = "text", extra = {}) => (
    <div className="field" key={k}><label htmlFor={`ep-${k}`}>{l}</label>
      <input id={`ep-${k}`} type={type} dir={type === "text" && k !== "title" && k !== "description" ? "ltr" : undefined} value={st[k] ?? ""} onChange={(e) => set({ ...st, [k]: e.target.value })} {...extra} /></div>);
  return (
    <div className="page">
      <div className="pagehead"><h1>{t("ep.link.board")}</h1>
        <span className="sub">{t("ep.bd.sub", { no: contract?.contract_no || "", title: contract?.title || "" })}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg toast" role="status">{ok}</p>}
      {may && !pf && !vf && <p><button className="btn" type="button" onClick={() => setPf({ ...BLANK_PMS })}>{t("ep.bd.newPms")}</button>{" "}
        {data.pms.length > 0 && <button className="btn ghost" type="button" data-import-open onClick={() => setImp({ pmsId: data.pms[0].id, versionCode: "", fileKind: "mspdi", file: null })}>{t("ep.bd.importOpen")}</button>}</p>}
      {imp && <ImportPlan data={data} imp={imp} setImp={setImp} projectId={projectId} done={(m) => { setImp(null); setOk(m); reload(); }} fail={setMsg} />}
      {pf && (
        <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "pms", ...pf }, (r) => t("ep.bd.pmsSaved", { code: r.row.code }))) setPf(null); }}>
          <h2>{pf.id ? t("ep.bd.pmsEdit", { code: pf.code }) : t("ep.bd.pmsNew")}</h2>
          <div className="grid2">
            {F(pf, setPf, "code", t("ep.bd.pmsCode"), "text", { required: true, placeholder: "PM01" })}{F(pf, setPf, "title", t("ep.bd.pmsTitle"), "text", { required: true })}
            <div className="field"><label htmlFor="ep-pmsType">{t("ep.bd.pmsType")}</label>
              <input id="ep-pmsType" dir="ltr" list="pms-types" value={pf.pmsType} onChange={(e) => setPf({ ...pf, pmsType: e.target.value })} placeholder="Level 3" />
              <datalist id="pms-types">{(data.labels.pmsTypes || []).map((x) => <option key={x} value={x} />)}</datalist></div>
            {F(pf, setPf, "description", t("ep.bd.pmsDesc"))}
            {F(pf, setPf, "registeredOn", t("ep.bd.registered"), "date")}
            {F(pf, setPf, "planStart", t("ep.planStart"), "date")}{F(pf, setPf, "planEnd", t("ep.planEnd"), "date")}
            {F(pf, setPf, "actualStart", t("ep.actualStart"), "date")}{F(pf, setPf, "actualEnd", t("ep.actualEnd"), "date")}
            {F(pf, setPf, "budgetPlan", t("ep.bd.rootBudget"), "text", { inputMode: "decimal" })}{F(pf, setPf, "budgetActual", t("ep.d.budgetActual"), "text", { inputMode: "decimal" })}
          </div>
          <p className="sm muted">{t("ep.bd.spans", { plan: fmt(span(pf.planStart, pf.planEnd)), actual: fmt(span(pf.actualStart, pf.actualEnd)) })}</p>
          <button className="btn" type="submit">{t("ep.save")}</button> <button className="btn ghost" type="button" onClick={() => setPf(null)}>{t("ep.cancel")}</button>
        </form>)}
      {vf && (
        <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "version", ...vf }, (r) => t("ep.bd.verSaved", { code: r.row.code }))) setVf(null); }}>
          <h2>{vf.id ? t("ep.bd.verEdit", { code: vf.code }) : t("ep.bd.verNew", { pms: data.pms.find((p) => p.id === vf.pmsId)?.code || "" })}</h2>
          <div className="grid2">
            {F(vf, setVf, "code", t("ep.bd.verCode"), "text", { required: true })}{F(vf, setVf, "title", t("ep.bd.verTitle"), "text", { required: true })}
            {F(vf, setVf, "description", t("ep.bd.verDesc"))}{F(vf, setVf, "registeredOn", t("ep.bd.registered"), "date")}
            {F(vf, setVf, "startOn", t("ep.bd.verStart"), "date")}{F(vf, setVf, "endOn", t("ep.bd.verEnd"), "date")}
            {F(vf, setVf, "budgetPlan", t("ep.bd.budgetPlan"), "text", { inputMode: "decimal" })}{F(vf, setVf, "budgetActual", t("ep.d.budgetActual"), "text", { inputMode: "decimal" })}
          </div>
          <button className="btn" type="submit">{t("ep.save")}</button> <button className="btn ghost" type="button" onClick={() => setVf(null)}>{t("ep.cancel")}</button>
        </form>)}
      <div className="card">
        <h2>{t("ep.bd.contractEps")}</h2>
        {data.pms.length === 0 ? <p className="empty-note">{t("ep.bd.none")}</p> : (
          <div className="tablewrap"><TableKit name="eps-1"><table className="dtable">
            <thead><tr><th>{t("ep.code")}</th><th>{t("ep.title")}</th><th>{t("ep.g.registered")}</th><th>{t("ep.bd.planSpan")}</th><th>{t("ep.dur")}</th><th>{t("ep.bd.actualSpan")}</th><th>{t("ep.bd.actualDur")}</th><th>{t("ep.bd.versionsNodes")}</th><th /></tr></thead>
            <tbody>{data.pms.flatMap((p) => [pmsRow(p), ...p.versions.map((v) => versionRow(p, v))])}</tbody></table></TableKit></div>)}
        {may && data.pms.length > 0 && <p className="sm muted">{t("ep.bd.dragHint")}</p>}
      </div>
    </div>
  );
}

/**
 * A plan file as a new version of a PMS: the MS Project schedule (Save As ◄
 * XML) or the PMS workbook. The plan lives in the EPS — there is no second
 * schedule page beside it. What was imported before (into the old «برنامه و
 * PMS» page) is carried over from here too, without the file.
 */
function ImportPlan({ data, imp, setImp, projectId, done, fail }) {
  const { t } = usePrefs();
  const [busy, setBusy] = useState(false);
  const pms = data.pms.find((p) => p.id === imp.pmsId);
  async function send(e) {
    e.preventDefault(); setBusy(true); fail(null);
    try {
      const form = new FormData();
      for (const [k, v] of Object.entries({ projectId, kind: "import-plan", pmsId: imp.pmsId, versionCode: imp.versionCode, fileKind: imp.fileKind })) form.set(k, v);
      form.set("file", imp.file);
      const res = await fetch("/api/eps", { method: "POST", body: form, credentials: "same-origin" });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || t("ep.im.status", { n: res.status }));
      const r = b.row;
      done(t("ep.im.done", { code: r.version.code, nodes: r.nodes, acts: r.activities, rels: r.relations })
        + (r.problems.length ? ` · ${t("ep.im.notes", { n: r.problems.length })} ${r.problems.slice(0, 3).join(" · ")}` : ""));
    } catch (e2) { fail(e2.message); } finally { setBusy(false); }
  }
  async function convert(source, importId, label) {
    const code = imp.versionCode;
    if (!code) { fail(t("ep.im.needCode")); return; }
    setBusy(true); fail(null);
    try {
      const res = await fetch("/api/eps", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, kind: "convert-legacy", pmsId: imp.pmsId, versionCode: code, source, importId }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || t("ep.im.status", { n: res.status }));
      done(t("ep.im.converted", { code: b.row.version.code, label, nodes: b.row.nodes, acts: b.row.activities }));
    } catch (e2) { fail(e2.message); } finally { setBusy(false); }
  }
  const legacy = data.legacy || { schedules: [], pms: [] };
  return (
    <form className="card" onSubmit={send} data-import-plan>
      <h2>{t("ep.im.title")}</h2>
      <p className="sm muted">{t("ep.im.note")}</p>
      <div className="grid2">
        <div className="field"><label htmlFor="im-pms">PMS</label>
          <select id="im-pms" value={imp.pmsId} onChange={(e) => setImp({ ...imp, pmsId: e.target.value })}>
            {data.pms.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.title}</option>)}</select></div>
        <div className="field"><label htmlFor="im-code">{t("ep.im.code")}</label>
          <input id="im-code" dir="ltr" required value={imp.versionCode} placeholder={`${pms?.code || "PM01"}-R${(pms?.versions.length || 0) + 1}`}
            onChange={(e) => setImp({ ...imp, versionCode: e.target.value })} /></div>
        <div className="field"><label htmlFor="im-kind">{t("ep.im.kind")}</label>
          <select id="im-kind" value={imp.fileKind} onChange={(e) => setImp({ ...imp, fileKind: e.target.value })}>
            <option value="mspdi">MS Project (XML — Save As ◄ XML Format)</option>
            <option value="pms">{t("ep.im.kindPms")}</option>
            <option value="sheet">{t("ep.im.kindSheet")}</option></select></div>
        <div className="field"><label htmlFor="im-file">{t("ep.im.file")}</label>
          <input id="im-file" type="file" required accept={imp.fileKind === "mspdi" ? ".xml" : ".xlsx,.xls"} onChange={(e) => setImp({ ...imp, file: e.target.files?.[0] || null })} />
          {imp.fileKind !== "mspdi" && <TemplateButton kind={imp.fileKind === "sheet" ? "eps" : "pms"} />}</div>
      </div>
      <button className="btn" type="submit" disabled={busy || !imp.file || !imp.versionCode}>{busy ? t("ep.im.busy") : t("ep.im.go")}</button>{" "}
      <button className="btn ghost" type="button" onClick={() => setImp(null)}>{t("ep.cancel")}</button>
      {(legacy.schedules.length > 0 || legacy.pms.length > 0) && (
        <div style={{ marginTop: 12 }} data-legacy>
          <h3>{t("ep.im.legacy")}</h3>
          <p className="sm muted">{t("ep.im.legacyNote")}</p>
          <ul className="sm">
            {legacy.schedules.map((s) => <li key={s.id}>{t("ep.im.legacySchedule", { name: s.source_name, n: s.task_count })} <button type="button" className="btn ghost sm" disabled={busy}
              onClick={() => convert("schedule", s.id, s.source_name)}>{t("ep.im.convert")}</button></li>)}
            {legacy.pms.map((s) => <li key={s.id}>{t("ep.im.legacyPms", { name: s.source_name })}{s.data_date && ` ${t("ep.im.dataDate", { d: s.data_date })}`} <button type="button" className="btn ghost sm" disabled={busy}
              onClick={() => convert("pms", s.id, s.source_name)}>{t("ep.im.convert")}</button></li>)}
          </ul>
        </div>)}
    </form>
  );
}
