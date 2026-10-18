"use client";
import { useEffect, useMemo, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { localToday } from "../../components/ui/WorkDate";
import { flatten } from "../../components/ui/TreeEditor";
import { Workflow, Actions, History } from "../../components/reports/WorkflowPanel";

import TableKit from "../../components/ui/TableKit";
import { usePrefs } from "../../lib/client/prefs.mjs";
/**
 * The contract's daily report (owner's spec 2026-10-15, steps 5–6).
 * A report belongs to a contract. The first stage writes its rows; a later
 * stage confirms a row («تأیید») or writes its own numbers for it
 * («ویرایش»), and a row a stage changed is shown under the original in the
 * stage's colour, latest stage first. What each person may do is the
 * workflow's (stages, groups, final approver) — this page only asks it.
 */
const FIELDS = {
  narrative: [["categoryId", "dr.f.category", "cat"], ["title", "dr.f.title", "text"], ["description", "dr.f.description", "text"], ["unit", "dr.f.unit", "text"], ["qty", "dr.f.qty", "num"], ["notes", "dr.f.notes", "text"]],
  problems: [["description", "dr.f.problem", "text"], ["scope", "dr.f.scope", "text"], ["cause", "dr.f.cause", "text"], ["hours", "dr.f.hours", "num"]],
  // the lower part of the resources section (owner's review, item 8): the work group, the resource, the counts and their totals
  resources: [["workGroupId", "dr.f.workGroup", "wg"], ["resourceId", "dr.f.resource", "res"], ["day", "dr.f.day", "num"], ["night", "dr.f.night", "num"], ["leave", "dr.f.leave", "num"],
    ["sick", "dr.f.sick", "num"], ["_total", "dr.f.total", "calc"], ["local", "dr.f.local", "num"], ["nonLocal", "dr.f.nonLocal", "num"], ["_lnl", "dr.f.lnl", "calc"]],
};
const calc = (k, e) => (k === "_total" ? rowTotal(e) : (Number(e?.local) || 0) + (Number(e?.nonLocal) || 0));
const HEADER = [["startTime", "dr.h.start", "time"], ["endTime", "dr.h.end", "time"], ["dayStatus", "dr.h.dayStatus", "day"], ["tempMin", "dr.h.tempMin", "num"],
  ["tempMax", "dr.h.tempMax", "num"], ["weather", "dr.h.weather", "weather"], ["humidity", "dr.h.humidity", "num"]];
// numbers in the reader's own digits
const useFmt = () => { const { num } = usePrefs(); return (v) => (v == null || v === "" ? "—" : typeof v === "number" ? num(v) : v); };
// the server's labels are Persian; each is shown in the reader's language by its key
const dayL = (L, labels, k) => L(`report.day.${k}`, labels.dayStatus[k]);
const weatherL = (L, labels, k) => L(`weather.${k}`, labels.weather[k]);
const newId = () => `r${Math.random().toString(36).slice(2, 10)}`;
const rowTotal = (e) => ["day", "night", "leave", "sick"].reduce((s, k) => s + (Number(e?.[k]) || 0), 0);

export default function ContractReportsPage() {
  const { projectId, contractId, contract, call } = usePlatform();
  const { t } = usePrefs();
  const [openId, setOpenId] = useState(null);
  const { data, error, reload } = useProjectData((id) => `/api/contract-reports?projectId=${id}${contractId ? `&contractId=${contractId}` : ""}`, [contractId]);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/contract-reports", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  useEffect(() => { const id = new URLSearchParams(window.location.search).get("id"); if (id) setOpenId(id); }, []);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  return (
    <div className="page">
      <div className="pagehead"><h1>{t("dr.title")}</h1>
        <span className="sub">{t("dr.sub")}</span></div>
      {!openId && msg && <p className="err" role="alert">{msg}</p>}
      {!openId && ok && <p className="okmsg" role="status">{ok}</p>}
      {!openId && <>
        {(data.legacyDaily > 0 || !data.contracts?.length) && <p className="sm muted" data-legacy-link>
          {data.contracts?.length ? t("dr.legacyHas", { n: data.legacyDaily }) : t("dr.noContracts")}
          <a href="/daily-reports">{t("dr.projectDaily")}</a></p>}
        {contract ? <p className="sm"><b>{t("dr.contract")} {contract.contract_no}</b> — {contract.title}</p>
          : <p className="empty-note">{t("cs.pick")}</p>}
        {!data.typeReady && (
          <div className="card"><h2>{t("dr.flow")}</h2>
            <p className="sm">{t("dr.noFlow")}</p>
            {data.may.setup && <button className="btn" type="button" onClick={() => post({ kind: "setup-type" }, () => t("dr.flowBuilt"))}>{t("dr.buildFlow")}</button>}</div>)}
        {contractId && <ReportList data={data} contractId={contractId} post={post} open={setOpenId} />}
      </>}
      {openId && <ReportView projectId={projectId} id={openId} call={call} labels={data.labels} users={data.users} close={() => { setOpenId(null); setOk(null); setMsg(null); reload(); }} />}
    </div>
  );
}

function ReportList({ data, contractId, post, open }) {
  const [f, setF] = useState({ title: "", reportDate: localToday(), copyFromId: "", header: { startTime: "07:00", endTime: "17:00", dayStatus: "working", tempMin: "", tempMax: "", weather: "", humidity: "" } });
  const { t, L } = usePrefs();
  return (
    <>
      {data.may.create && (
        <div className="card">
          <h2>{t("dr.new")}</h2>
          <form onSubmit={async (e) => { e.preventDefault(); const r = await post({ kind: "create", contractId, ...f, copyFromId: f.copyFromId || null }, () => t("dr.created")); if (r?.row) open(r.row.id); }}>
            <div className="grid2">
              <div className="field"><label htmlFor="nr-t">{t("dr.name")}</label><input id="nr-t" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
              <div className="field"><label htmlFor="nr-d">{t("dr.workDate")}</label><input id="nr-d" type="date" required value={f.reportDate} onChange={(e) => setF({ ...f, reportDate: e.target.value })} /></div>
              <HeaderFields value={f.header} on={(h) => setF({ ...f, header: h })} labels={data.labels} idp="nr" />
              <div className="field"><label htmlFor="nr-cp">{t("dr.copyFrom")}</label><select id="nr-cp" value={f.copyFromId} onChange={(e) => setF({ ...f, copyFromId: e.target.value })}>
                <option value="">{t("dr.empty")}</option>{data.reports.map((r) => <option key={r.id} value={r.id}>{r.report_no} — {String(r.report_date).slice(0, 10)} — {r.title}</option>)}</select></div>
            </div>
            <button className="btn" type="submit">{t("dr.create")}</button>
          </form>
        </div>)}
      <div className="card">
        <h2>{t("dr.list")}</h2>
        {data.reports.length === 0 ? <p className="empty-note">{t("dr.none")}</p> : (
          <TableKit name="contract-reports-1"><table className="dtable"><thead><tr><th>{t("c.no")}</th><th>{t("dr.h.workDate")}</th><th>{t("dr.h.name")}</th><th>{t("dr.h.stage")}</th><th>{t("c.status")}</th><th>{t("dr.h.version")}</th><th /></tr></thead>
            <tbody>{data.reports.map((r) => (
              <tr key={r.id}><td className="mono">{r.report_no}</td><td className="mono">{String(r.report_date).slice(0, 10)}</td><td>{r.title}</td><td>{r.stage_name}</td>
                <td><span className={`pill ${r.status === "approved" ? "ok" : r.status === "cancelled" ? "bad" : ""}`}>{L(`report.status.${r.status}`, r.status_fa)}</span></td><td className="mono">{r.version_no}</td>
                <td><button className="btn ghost sm" type="button" onClick={() => open(r.id)}>{t("dr.open")}</button></td></tr>))}</tbody></table></TableKit>)}
      </div>
    </>
  );
}

function HeaderFields({ value, on, labels, idp, disabled = false }) {
  const { t: tr, L } = usePrefs();
  return HEADER.map(([k, l, t]) => (
    <div className="field" key={k}><label htmlFor={`${idp}-${k}`}>{tr(l)}</label>
      {t === "day" || t === "weather" ? (
        <select id={`${idp}-${k}`} disabled={disabled} value={value[k] ?? ""} onChange={(e) => on({ ...value, [k]: e.target.value })}>
          <option value="">—</option>{Object.keys(t === "day" ? labels.dayStatus : labels.weather).map((x) => <option key={x} value={x}>{t === "day" ? dayL(L, labels, x) : weatherL(L, labels, x)}</option>)}</select>
      ) : <input id={`${idp}-${k}`} disabled={disabled} type={t === "time" ? "time" : "text"} dir="ltr" inputMode={t === "num" ? "decimal" : undefined}
        value={value[k] ?? ""} onChange={(e) => on({ ...value, [k]: e.target.value })} />}
    </div>));
}

function ReportView({ projectId, id, call, labels, users, close }) {
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [tab, setTab] = useState("narrative");
  const { t, L, dateTime } = usePrefs();
  const load = () => call(`/api/contract-reports?projectId=${projectId}&id=${id}`).then(setV).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/contract-reports", { method: "POST", body: JSON.stringify({ projectId, reportId: id, ...body }) }); await load(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  if (err) return <p className="err">{err}</p>;
  if (!v) return <p className="muted">{t("common.loading")}</p>;
  const S = String(v.report.stage_seq);
  const first = v.report.stage_seq === v.firstSeq;
  const editable = v.may.edit;
  // every change is a new version of the whole content, built here and judged by the server
  const save = (mutate, done) => { const c = structuredClone(v.content); mutate(c); return post({ kind: "edit", content: c }, () => done); };
  const ops = {
    add: (kind, values) => save((c) => { c[kind].push(first ? { id: newId(), base: values, stages: {} } : { id: newId(), base: null, stages: { [S]: values } }); }, t("dr.rowAdded")),
    update: (kind, rid, values) => save((c) => { const r = c[kind].find((x) => x.id === rid); if (first) r.base = values; else r.stages[S] = { ...values }; },
      first ? t("dr.rowSaved") : t("dr.stageValue", { stage: v.report.stage_name })),
    confirm: (kind, rid) => save((c) => { const r = c[kind].find((x) => x.id === rid); r.stages[S] = { ...(r.stages[S] || {}), confirmed: true }; }, t("dr.rowConfirmed")),
    remove: (kind, rid) => save((c) => {
      const r = c[kind].find((x) => x.id === rid);
      if (first || (r.addedAt === Number(S) && !r.base)) c[kind] = c[kind].filter((x) => x.id !== rid);
      else r.stages[S] = { removed: true };
    }, t("dr.rowRemoved")),
    header: (values) => save((c) => { if (first) c.header.base = values; else c.header.stages[S] = values; }, t("dr.headerSaved")),
  };
  return (
    <>
      <p className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn ghost" type="button" onClick={close}>{t("dr.back")}</button>
        <a className="btn ghost" href={`/contract-reports/print?id=${id}`}>{t("dr.print")} {v.report.status === "approved" ? t("dr.printRecord") : ""}</a>
      </p>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      <div className="card">
        <h2>{v.report.title} <span className="mono sm muted">{v.report.report_no}</span></h2>
        <p className="sm">{t("dr.contract")} <b className="mono">{v.contract.contract_no}</b> — {v.contract.title} · {t("dr.workDate")} <b className="mono">{String(v.report.report_date).slice(0, 10)}</b>
          {" "}· {t("dr.createdAt")} {dateTime(v.report.created_at)} · {t("dr.versionN", { n: v.versionNo })} · <b>{L(`report.status.${v.report.status}`, v.report.status_fa)}</b>{v.report.status === "open" && <>{t("dr.currentStage")}<b>{v.report.stage_name}</b></>}</p>
        <Workflow v={v} />
        <HeaderBox v={v} labels={labels} editable={editable} save={ops.header} first={first} />
      </div>
      <div className="ptabs no-print" role="tablist">
        {[["narrative", t("dr.tab.narrative")], ["problems", t("dr.tab.problems")], ["resources", t("dr.tab.resources")], ["activities", t("dr.tab.activities", { n: (v.lines.activities || []).length })],
          ["photos", t("dr.tab.photos", { n: v.files.filter((f) => f.kind === "photo" && !f.removed_at).length })],
          ["files", t("dr.tab.files", { n: v.files.filter((f) => f.kind === "file" && !f.removed_at).length })], ["actions", t("dr.tab.actions")], ["history", t("dr.tab.history")]].map(([k, x]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{x}</button>))}
      </div>
      {/* i18n: reads the server's Persian reason to show only the "signed, now read-only" one */}
      {!editable && v.report.status === "open" && v.may.editWhy && /امضا/.test(v.may.editWhy) && (
        <p className="sm" role="status" style={{ padding: 8, borderRadius: 6, background: "var(--surf2, #f5f7f9)" }}>🔒 {v.may.editWhy}</p>)}
      {["narrative", "problems"].includes(tab) && (
        <div className="card">
          <h2>{L(`report.section.${tab}`, labels.sections[tab])}</h2>
          <Section kind={tab} v={v} labels={labels} editable={editable} first={first} ops={ops} />
        </div>)}
      {tab === "activities" && (
        <div className="card">
          <h2>{t("dr.activities")}</h2>
          <p className="sm muted">{(() => { const [a, b] = t("dr.activitiesNote").split("{link}"); return <>{a}<a href="/eps/progress">{t("dr.dailyEntry")}</a>{b}</>; })()}</p>
          {(v.lines.activities || []).length === 0 ? <p className="empty-note">{t("dr.noRows")}</p> : (
            <TableKit name="contract-reports-2"><table className="dtable"><thead><tr><th>#</th><th>{t("dr.h.activity")}</th><th>{t("dr.h.area")}</th><th>Mark</th><th>{t("dr.f.qty")}</th><th>{t("dr.f.unit")}</th><th>{t("dr.h.note")}</th><th>{t("dr.h.stageChanges")}</th></tr></thead>
              <tbody>{v.lines.activities.map((l, i) => {
                const e = l.effective || {}, a = v.activityInfo?.[e.activityId] || {};
                return (
                  <tr key={l.id} style={{ textDecoration: e.removed ? "line-through" : undefined }}><td>{i + 1}</td><td><span className="mono" dir="ltr">{a.code || "—"}</span> {a.name || ""}</td>
                    <td>{v.companies?.find((c) => c.id === e.areaId)?.name || "—"}</td><td>{e.mark || "—"}</td><td className="mono">{e.qty ?? "—"}</td><td>{a.unit || "—"}</td><td className="sm">{e.notes || ""}</td>
                    <td className="sm">{l.lines.map((x) => <div key={x.seq} style={{ color: x.color || undefined }}>{x.stage}: {x.removed ? t("dr.removedWord") : x.values.qty}</div>)}</td></tr>);
              })}</tbody></table></TableKit>)}
        </div>)}
      {tab === "resources" && <Resources v={v} projectId={projectId} call={call} labels={labels} editable={editable} first={first} ops={ops} />}
      {(tab === "photos" || tab === "files") && <Files kind={tab === "photos" ? "photo" : "file"} v={v} projectId={projectId} editable={editable} post={post} setMsg={setMsg} reload={load} />}
      {tab === "actions" && <Actions v={v} users={users} post={post} />}
      {tab === "history" && <History v={v} />}
    </>
  );
}


function HeaderBox({ v, labels, editable, save, first }) {
  const eff = { ...(v.content.header?.base || {}), ...Object.fromEntries(Object.entries(v.content.header?.stages || {}).sort(([a], [b]) => a - b)
    .flatMap(([, x]) => Object.entries(x).filter(([k, y]) => k !== "confirmed" && y != null))) };
  const [h, setH] = useState(eff);
  const [open, setOpen] = useState(false);
  const { t: tr, L } = usePrefs();
  return (
    <div>
      <div className="sm" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {HEADER.map(([k, l, t]) => <span key={k}>{tr(l)}: <b>{eff[k] == null || eff[k] === "" ? "—" : t === "day" ? dayL(L, labels, eff[k]) : t === "weather" ? weatherL(L, labels, eff[k]) : eff[k]}</b></span>)}
      </div>
      {editable && !open && <button className="btn ghost sm" type="button" onClick={() => { setH(eff); setOpen(true); }}>{first ? tr("dr.editHeader") : tr("dr.fixHeader")}</button>}
      {open && (
        <form onSubmit={async (e) => { e.preventDefault(); if (await save(h)) setOpen(false); }}>
          <div className="grid2"><HeaderFields value={h} on={setH} labels={labels} idp="hd" /></div>
          <button className="btn" type="submit">{tr("dr.save")}</button> <button className="btn ghost" type="button" onClick={() => setOpen(false)}>{tr("common.cancel")}</button>
        </form>)}
    </div>
  );
}

function Cell({ f, value, v, row }) {
  const fmt = useFmt();
  const [k, , t] = f;
  if (t === "calc") return <b className="mono">{fmt(calc(k, row))}</b>;
  if (t === "cat") return <>{flatten(v.narrativeTree).find((x) => x.id === value)?.path || "—"}</>;
  if (t === "wg") return <>{flatten(v.workGroupTree || []).find((x) => x.id === value)?.path || "—"}</>;
  if (t === "res") { const r = v.resources.find((x) => x.id === value); return <>{r ? r.name : "—"}</>; }
  return <>{fmt(value)}</>;
}

function RowForm({ kind, v, initial, onSave, onCancel, label }) {
  const [f, setF] = useState(() => Object.fromEntries(FIELDS[kind].filter(([, , t]) => t !== "calc").map(([k]) => [k, initial?.[k] ?? ""])));
  const { t: tr } = usePrefs();
  const fmt = useFmt();
  return (
    <form className="row" style={{ gap: 6, alignItems: "end", flexWrap: "wrap", padding: 6, background: "var(--surf2, #f5f7f9)", borderRadius: 6 }}
      onSubmit={async (e) => { e.preventDefault(); if (await onSave(f)) onCancel?.(); }}>
      {FIELDS[kind].map(([k, l, t]) => t === "calc" ? (
        <div className="field" key={k} style={{ minWidth: 80 }}><span className="sm muted">{tr(l)}</span><b className="mono">{fmt(calc(k, f))}</b></div>
      ) : (
        <div className="field" key={k} style={{ minWidth: t === "num" ? 80 : 140 }}><label htmlFor={`rf-${kind}-${k}`}>{tr(l)}</label>
          {t === "wg" ? <select id={`rf-${kind}-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
            <option value="">—</option>{flatten(v.workGroupTree || []).map((x) => <option key={x.id} value={x.id}>{x.path}</option>)}</select>
          : t === "cat" ? <select id={`rf-${kind}-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
            <option value="">—</option>{flatten(v.narrativeTree).map((x) => <option key={x.id} value={x.id}>{x.path}</option>)}</select>
          : t === "res" ? <select id={`rf-${kind}-${k}`} required value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
            <option value="">—</option>{v.resources.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.unit})</option>)}</select>
          : <input id={`rf-${kind}-${k}`} dir={t === "num" ? "ltr" : undefined} inputMode={t === "num" ? "decimal" : undefined} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}
        </div>))}
      <button className="btn sm" type="submit">{label}</button>
      {onCancel && <button className="btn ghost sm" type="button" onClick={onCancel}>{tr("common.cancel")}</button>}
    </form>
  );
}

/** One section: each row as first written, the stages' changes under it (latest first, in their colour), and the row's buttons. */
function Section({ kind, v, labels, editable, first, ops, filter = null }) {
  const [editing, setEditing] = useState(null);
  const { t } = usePrefs();
  const fmt = useFmt();
  const cols = FIELDS[kind];
  // the lower resources part shows the rows of the resource picked above (all, when none is)
  const shown = v.lines[kind].map((line, i) => ({ line, i })).filter(({ line }) => !filter || line.effective.resourceId === filter);
  const sumOf = (field) => shown.filter(({ line }) => !line.effective.removed).reduce((s, { line }) => s + (field.startsWith("_") ? calc(field, line.effective) : Number(line.effective[field]) || 0), 0);
  const stageName = v.report.stage_name;
  const S = String(v.report.stage_seq);
  return (
    <div className="tablewrap">
      <TableKit name="contract-reports-3"><table className="dtable">
        <thead><tr><th>{t("c.row")}</th><th>{t("dr.h.stage")}</th>{cols.map(([k, l]) => <th key={k}>{t(l)}</th>)}<th /></tr></thead>
        <tbody>{shown.map(({ line, i }) => {
          const raw = v.content[kind].find((r) => r.id === line.id);
          const mineNow = raw?.stages?.[S];
          const baseVals = line.base || {};
          return [
            <tr key={line.id} style={{ textDecoration: line.effective.removed ? "line-through" : undefined }}>
              <td className="mono">{i + 1}</td>
              <td className="sm">{line.base ? v.stages.find((s) => s.seq === v.firstSeq)?.name : <span className="muted">{t("dr.addedBy", { stage: v.stages.find((s) => s.seq === raw.addedAt)?.name })}</span>}
                {line.confirmedBy.length > 0 && <div className="sm" style={{ color: "var(--ok)" }}>✓ {line.confirmedBy.join(t("c.sep"))}</div>}</td>
              {cols.map((f) => <td key={f[0]}>{line.base ? <Cell f={f} value={baseVals[f[0]]} v={v} row={baseVals} /> : "—"}</td>)}
              <td style={{ whiteSpace: "nowrap" }}>{editable && !line.effective.removed && <>
                {!first && !mineNow?.confirmed && <button className="btn ghost sm" type="button" onClick={() => ops.confirm(kind, line.id)}>{t("dr.confirm")}</button>}
                <button className="btn ghost sm" type="button" onClick={() => setEditing(editing === line.id ? null : line.id)}>{t("dr.edit")}</button>
                <button className="btn ghost sm" type="button" onClick={() => ops.remove(kind, line.id)}>{t("dr.remove")}</button></>}</td>
            </tr>,
            ...line.lines.map((l) => (
              <tr key={`${line.id}-${l.seq}`} style={{ color: l.color || "var(--bad)", textDecoration: l.removed ? "line-through" : undefined }}>
                <td /><td className="sm"><b>{l.stage}</b>{l.removed && t("dr.removedRow")}</td>
                {cols.map((f) => <td key={f[0]}><Cell f={f} value={l.values[f[0]]} v={v} row={l.values} /></td>)}<td />
              </tr>)),
            editing === line.id && <tr key={`${line.id}-edit`}><td colSpan={cols.length + 3}>
              <RowForm kind={kind} v={v} initial={first ? baseVals : { ...line.effective }} label={first ? t("dr.save") : t("dr.recordStage", { stage: stageName })}
                onSave={(f) => ops.update(kind, line.id, f)} onCancel={() => setEditing(null)} /></td></tr>,
          ];
        })}</tbody>
        {kind === "resources" && shown.length > 0 && (
          <tfoot><tr><td colSpan={2}><b>{t("dr.totalRows")}</b></td>
            {cols.map(([k, , t]) => <td key={k} className="mono">{t === "num" || t === "calc" ? <b>{fmt(sumOf(k))}</b> : ""}</td>)}<td /></tr></tfoot>)}
      </table></TableKit>
      {shown.length === 0 && <p className="empty-note">{t("dr.noneRecorded")}</p>}
      {editable && <div style={{ marginTop: 8 }}><b className="sm">{t("dr.newRow")}{first ? "" : t("dr.newRowStage", { stage: stageName })}</b>
        <RowForm key={`${v.versionNo}-${filter || ""}`} kind={kind} v={v} label={t("dr.add")} initial={filter ? { resourceId: filter } : null} onSave={(f) => ops.add(kind, f)} /></div>}
      {kind === "resources" && v.resources.length === 0 && <p className="sm muted">{t("dr.noResources")}</p>}
    </div>
  );
}

/**
 * The resources section in two parts (owner's review, item 8). Above: every
 * resource of the contract in its resource tree, with this report's rows
 * summed, and the sums per unit at the foot. Below: the rows of the resource
 * picked above — one per executive work group — where rows are added and
 * changed, with their totals worked out and summed at the foot.
 */
function Resources({ v, projectId, call, labels, editable, first, ops }) {
  const [pick, setPick] = useState(null);
  const B = v.board;
  const picked = B.items.find((x) => x.type === "resource" && x.id === pick) || null;
  const { t, L, num: n } = usePrefs();
  const fmt = useFmt();
  const num = (x) => <td className="mono">{x ? fmt(x) : <span className="muted">{n(0)}</span>}</td>;
  return (
    <>
      <div className="card">
        <h2>{t("dr.resSummary")}</h2>
        <ResourceSummary v={v} projectId={projectId} call={call} labels={labels} />
        <p className="sm muted">{t("dr.resPickHint")}</p>
        <div className="tablewrap"><TableKit name="contract-reports-4"><table className="dtable">
          <thead><tr><th>{t("dr.h.resCategory")}</th><th>{t("dr.f.resource")}</th><th>{t("dr.h.resKind")}</th><th>{t("dr.f.unit")}</th>{["day", "night", "leave", "sick", "total", "local", "nonLocal"].map((k) => <th key={k}>{t(`dr.f.${k}`)}</th>)}</tr></thead>
          <tbody>{B.items.map((x) => x.type === "branch" ? (
            <tr key={`b-${x.id}`} style={{ background: "var(--surf2, #f5f7f9)" }}><td colSpan={11} style={{ paddingInlineStart: 8 + x.depth * 18 }}><b>▾ {x.name}</b></td></tr>
          ) : (
            <tr key={x.id} data-board-resource={x.id} onClick={() => setPick(pick === x.id ? null : x.id)}
              style={{ cursor: "pointer", background: pick === x.id ? "var(--hl, #eef6f8)" : undefined, outline: pick === x.id ? "2px solid var(--cy, #1b7f99)" : undefined }}>
              <td className="sm muted" style={{ paddingInlineStart: 8 + x.depth * 18 }}>{x.category}</td><td>{x.name}{x.rows > 1 && <span className="sm muted">{t("dr.rowsN", { n: x.rows })}</span>}</td>
              <td className="sm">{L(`resource.kind.${x.kind}`, labels.kinds[x.kind] || x.kind)}</td><td className="sm">{x.unit}</td>
              {num(x.day)}{num(x.night)}{num(x.leave)}{num(x.sick)}<td className="mono"><b>{fmt(x.total)}</b></td>{num(x.local)}{num(x.nonLocal)}
            </tr>))}</tbody>
          <tfoot>{Object.entries(B.byUnit).map(([u, t]) => (
            <tr key={u}><td colSpan={3}><b>{t("dr.totalUnit", { u })}</b></td><td className="sm">{u}</td>
              {["day", "night", "leave", "sick", "total", "local", "nonLocal"].map((k) => <td key={k} className="mono"><b>{fmt(t[k])}</b></td>)}</tr>))}</tfoot>
        </table></TableKit></div>
        {v.resources.length === 0 && <p className="sm muted">{t("dr.noResources")}</p>}
      </div>
      <div className="card">
        <h2>{picked ? t("dr.rowsOf", { name: picked.name }) : t("dr.allRows")}
          {picked && <button className="btn ghost sm" type="button" onClick={() => setPick(null)} style={{ marginInlineStart: 8 }}>{t("dr.showAll")}</button>}</h2>
        {(v.workGroupTree || []).length === 0 && <p className="sm muted">{t("dr.noWorkGroups")}</p>}
        <Section kind="resources" v={v} labels={labels} editable={editable} first={first} ops={ops} filter={pick} />
      </div>
    </>
  );
}

/** 6.3.1: today's people at a glance, every unit's total, and the same over a period with filters. */
function ResourceSummary({ v, projectId, call, labels }) {
  const s = v.summary;
  const [q, setQ] = useState({ kind: "", categoryId: "", name: "", from: "", to: "" });
  const [range, setRange] = useState(null);
  const { t, L } = usePrefs();
  const fmt = useFmt();
  const run = async () => {
    const p = new URLSearchParams({ projectId, summary: "1", contractId: v.contract.id, ...Object.fromEntries(Object.entries(q).filter(([, x]) => x)) });
    try { setRange(await call(`/api/contract-reports?${p}`)); } catch { setRange(null); }
  };
  const name = (rid) => v.resources.find((r) => r.id === rid)?.name || "—";
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="moneyrow">
        <div><span>{t("dr.s.day")}</span><b>{fmt(s.day)}</b></div><div><span>{t("dr.s.night")}</span><b>{fmt(s.night)}</b></div>
        <div><span>{t("dr.s.leave")}</span><b>{fmt(s.leave)}</b></div><div><span>{t("dr.s.total")}</span><b>{fmt(s.total)}</b></div>
      </div>
      <p className="sm">{t("dr.s.volumes")}{Object.entries(s.byUnit).map(([u, n]) => <span key={u} style={{ marginInlineEnd: 12 }}><b>{fmt(n)}</b> {u}</span>)}</p>
      <details className="inlinefold"><summary>{t("dr.s.filter")}</summary>
        <div className="row" style={{ gap: 6, alignItems: "end", flexWrap: "wrap" }}>
          <div className="field"><label htmlFor="sf-k">{t("dr.h.resKind")}</label><select id="sf-k" value={q.kind} onChange={(e) => setQ({ ...q, kind: e.target.value })}>
            <option value="">{t("c.all")}</option>{Object.entries(labels.kinds).map(([k, x]) => <option key={k} value={k}>{L(`resource.kind.${k}`, x)}</option>)}</select></div>
          <div className="field"><label htmlFor="sf-c">{t("dr.s.group")}</label><select id="sf-c" value={q.categoryId} onChange={(e) => setQ({ ...q, categoryId: e.target.value })}>
            <option value="">{t("c.all")}</option>{flatten(v.resourceTree).map((x) => <option key={x.id} value={x.id}>{x.path}</option>)}</select></div>
          <div className="field"><label htmlFor="sf-n">{t("dr.f.resource")}</label><input id="sf-n" value={q.name} onChange={(e) => setQ({ ...q, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="sf-f">{t("dr.s.from")}</label><input id="sf-f" type="date" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} /></div>
          <div className="field"><label htmlFor="sf-t">{t("dr.s.to")}</label><input id="sf-t" type="date" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} /></div>
          <button className="btn sm" type="button" onClick={run}>{t("dr.s.show")}</button>
        </div>
        {range && <>
          <p className="sm">{t("dr.s.range", { reports: fmt(range.reports), day: fmt(range.summary.day), night: fmt(range.summary.night), leave: fmt(range.summary.leave), total: fmt(range.summary.total) })}
            {" "}· {Object.entries(range.summary.byUnit).map(([u, n]) => `${fmt(n)} ${u}`).join(" · ")}</p>
          {range.byResource.length > 0 && <TableKit name="contract-reports-5"><table className="dtable"><thead><tr><th>{t("dr.s.resource")}</th><th>{t("dr.f.day")}</th><th>{t("dr.f.night")}</th><th>{t("dr.f.leave")}</th><th>{t("dr.f.sick")}</th><th>{t("dr.s.all")}</th></tr></thead>
            <tbody>{range.byResource.map((r) => <tr key={r.resourceId}><td>{name(r.resourceId)}</td><td className="mono">{fmt(r.day)}</td><td className="mono">{fmt(r.night)}</td>
              <td className="mono">{fmt(r.leave)}</td><td className="mono">{fmt(r.sick)}</td><td className="mono"><b>{fmt(r.total)}</b></td></tr>)}</tbody></table></TableKit>}
        </>}
      </details>
    </div>
  );
}

function Files({ kind, v, projectId, editable, post, setMsg, reload }) {
  const [f, setF] = useState({ name: "", caption: "", tags: "", file: null });
  const list = v.files.filter((x) => x.kind === kind);
  const url = (id) => `/api/contract-reports?projectId=${projectId}&file=${id}`;
  const { t, dateTime } = usePrefs();
  async function upload(e) {
    e.preventDefault();
    if (!f.file) { setMsg(t("dr.pickFile")); return; }
    const form = new FormData();
    for (const [k, x] of Object.entries({ projectId, reportId: v.report.id, kind, name: f.name || f.file.name, caption: f.caption, tags: f.tags })) form.set(k, x);
    form.set("file", f.file);
    const res = await fetch("/api/contract-reports", { method: "POST", body: form, credentials: "same-origin" });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(b.error || t("dr.reply", { n: res.status })); return; }
    setF({ name: "", caption: "", tags: "", file: null }); e.target.reset(); reload();
  }
  return (
    <div className="card">
      <h2>{kind === "photo" ? t("dr.photos") : t("dr.files")}</h2>
      {editable && (
        <form className="row" style={{ gap: 6, alignItems: "end", flexWrap: "wrap" }} onSubmit={upload}>
          <div className="field"><label htmlFor={`fu-${kind}`}>{kind === "photo" ? t("dr.photoFile") : t("dr.file")}</label>
            <input id={`fu-${kind}`} type="file" accept={kind === "photo" ? "image/png,image/jpeg,image/webp" : undefined} onChange={(e) => setF({ ...f, file: e.target.files?.[0] || null })} /></div>
          <div className="field"><label htmlFor={`fn-${kind}`}>{t("dr.h.name")}</label><input id={`fn-${kind}`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          {kind === "photo" && <>
            <div className="field"><label htmlFor="fc">{t("dr.caption")}</label><input id="fc" value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} /></div>
            <div className="field"><label htmlFor="ft">{t("dr.tags")}</label><input id="ft" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></div></>}
          <button className="btn" type="submit">{t("dr.add")}</button>
        </form>)}
      {list.length === 0 ? <p className="empty-note">{t("dr.nothing")}</p> : kind === "photo" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 10 }}>
          {list.map((x) => (
            <figure key={x.id} style={{ margin: 0, opacity: x.removed_at ? 0.4 : 1 }}>
              <img src={url(x.id)} alt={x.caption || x.name} style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 6 }} />
              <figcaption className="sm">{x.caption || x.name}{x.removed_at && t("dr.removedFile")}
                <div>{x.tags.map((t) => <span key={t} className="pill" style={{ marginInlineEnd: 4 }}>{t}</span>)}</div>
                <div className="muted">{x.uploaded_name} · {dateTime(x.uploaded_at)}</div>
                {editable && !x.removed_at && <button className="btn ghost sm" type="button" onClick={() => post({ kind: "file-remove", fileId: x.id })}>{t("dr.remove")}</button>}</figcaption>
            </figure>))}
        </div>
      ) : (
        <TableKit name="contract-reports-6"><table className="dtable"><thead><tr><th>{t("dr.file")}</th><th>{t("dr.h.size")}</th><th>{t("dr.h.upload")}</th><th /></tr></thead>
          <tbody>{list.map((x) => <tr key={x.id} style={{ opacity: x.removed_at ? 0.4 : 1 }}><td><a href={url(x.id)}>{x.name}</a>{x.removed_at && t("dr.removedFile")}</td>
            <td className="mono">{Math.ceil(x.byte_size / 1024)} KB</td><td className="sm">{x.uploaded_name} · {dateTime(x.uploaded_at)}</td>
            <td>{editable && !x.removed_at && <button className="btn ghost sm" type="button" onClick={() => post({ kind: "file-remove", fileId: x.id })}>{t("dr.remove")}</button>}</td></tr>)}</tbody></table></TableKit>)}
    </div>
  );
}


