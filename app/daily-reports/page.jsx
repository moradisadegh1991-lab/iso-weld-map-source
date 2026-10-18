"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { localToday, DayHint } from "../../components/ui/WorkDate";

import TableKit from "../../components/ui/TableKit";
import { usePrefs } from "../../lib/client/prefs.mjs";
/**
 * The daily site report: written by the contractor, reviewed, signed and
 * approved stage by stage (lib/reports/workflow.mjs decides who may do
 * what). People, machines and materials are separate lists with their own
 * units; what the project already holds for the day can be brought in, and
 * every row says where it came from.
 */
const EMPTY = { shift: "day", working: true, weather: { condition: "", tempMin: "", tempMax: "", humidity: "" },
  manpower: [], equipment: [], materials: [], work: [], stoppages: [], hse: { incidents: "", permits: "", observations: "", note: "" }, notes: "" };

// each column's label is dl.c.<label key>; each list's title is dl.t.<list>
const COLS = {
  manpower: [["role", "role", "text"], ["discipline", "discipline", "text"], ["employer", "employer", "text"], ["present", "present", "number"],
    ["leave", "leave", "number"], ["night", "night", "number"], ["hours", "hours", "number"]],
  equipment: [["name", "machine", "text"], ["owner", "owner", "text"], ["working", "working", "number"], ["idle", "idle", "number"], ["note", "note", "text"]],
  materials: [["name", "material", "text"], ["unit", "unit", "text"], ["qty", "qty", "number"], ["note", "note", "text"]],
  work: [["description", "work", "text"], ["discipline", "discipline", "text"], ["location", "location", "text"], ["qty", "qty", "number"], ["unit", "unit", "text"]],
  stoppages: [["reason", "reason", "text"], ["scope", "scope", "text"], ["hours", "hours", "number"], ["note", "note", "text"]],
};
// the server's Persian labels, shown in the reader's language by key
const sourceL = (L, labels, k) => L(`daily.source.${k}`, labels.SOURCE[k]);

// which catalogue list a column suggests from (lib/reports/catalog.mjs kinds)
const SUGGEST = { "manpower.role": "dl-person", "manpower.discipline": "dl-disc", "equipment.name": "dl-machine",
  "materials.name": "dl-material", "materials.unit": "dl-unit", "work.discipline": "dl-disc" };
const KINDS = { manpower: ["person"], equipment: ["machine", "tool"], materials: ["consumable", "material", "project_material"] };

function Rows({ list, rows, setRows, labels, readOnly, catalog = [] }) {
  const cols = COLS[list];
  const { t: tr, L } = usePrefs();
  const set = (i, k, v) => setRows(rows.map((r, j) => {
    if (j !== i) return r;
    const next = { ...r, [k]: v, source: r.source === "manual" || !r.source ? "manual" : r.source };
    // a name the catalogue knows brings its discipline and unit — only into empty fields
    const known = (k === "role" || k === "name") && catalog.find((c) => (KINDS[list] || []).includes(c.kind) && c.name === v);
    if (known) {
      if (list === "manpower" && !next.discipline && known.discipline) next.discipline = known.discipline;
      if (list === "materials" && !next.unit && known.unit) next.unit = known.unit;
    }
    return next;
  }));
  if (readOnly && !rows.length) return <p className="muted sm">{tr("dl.notRecorded")}</p>;
  return (
    <div className="tablewrap">
      <TableKit name="daily-reports-1"><table className="dtable">
        <thead><tr>{cols.map(([k, l]) => <th key={k}>{tr(`dl.c.${l}`)}</th>)}<th>{tr("dl.source")}</th>{!readOnly && <th />}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}>
            {cols.map(([k, l, t]) => (
              <td key={k}>{readOnly ? (r[k] ?? "—") : (
                <input aria-label={tr("dl.rowN", { label: tr(`dl.c.${l}`), n: i + 1 })} type={t} list={SUGGEST[`${list}.${k}`]} dir={t === "number" ? "ltr" : undefined} min={t === "number" ? 0 : undefined}
                  step={k === "hours" || k === "qty" ? "any" : 1} value={r[k] ?? ""} onChange={(e) => set(i, k, e.target.value)} />
              )}</td>
            ))}
            <td className="sm muted">{sourceL(L, labels, r.source || "manual")}{r.state === "claimed" ? tr("dl.claimed") : ""}</td>
            {!readOnly && <td><button className="btn ghost sm" type="button" aria-label={tr("dl.removeRow", { n: i + 1 })} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button></td>}
          </tr>
        ))}</tbody>
      </table></TableKit>
      {!readOnly && <button className="btn ghost sm" type="button" onClick={() => setRows([...rows, { source: "manual" }])}>{tr("dl.addRow")}</button>}
    </div>
  );
}

function Editor({ value, setValue, labels, readOnly, onPrefill, catalog = [] }) {
  const v = value;
  const up = (patch) => setValue({ ...v, ...patch });
  const { t: tr, L } = usePrefs();
  return (
    <>
      <div className="grid2">
        <div className="field"><label htmlFor="d-shift">{tr("dl.shift")}</label>
          <select id="d-shift" disabled={readOnly} value={v.shift} onChange={(e) => up({ shift: e.target.value })}>
            {Object.entries(labels.SHIFT).map(([k, x]) => <option key={k} value={k}>{L(`daily.shift.${k}`, x)}</option>)}</select></div>
        <div className="field"><label htmlFor="d-work">{tr("dl.workingDay")}</label>
          <select id="d-work" disabled={readOnly} value={v.working ? "1" : "0"} onChange={(e) => up({ working: e.target.value === "1" })}>
            <option value="1">{tr("dl.working")}</option><option value="0">{tr("dl.off")}</option></select></div>
        <div className="field"><label htmlFor="d-wc">{tr("dl.weather")}</label>
          <select id="d-wc" disabled={readOnly} value={v.weather.condition || ""} onChange={(e) => up({ weather: { ...v.weather, condition: e.target.value } })}>
            <option value="">—</option>{Object.entries(labels.WEATHER).map(([k, x]) => <option key={k} value={k}>{L(`weather.${k}`, x)}</option>)}</select></div>
        {[["tempMin", "dr.h.tempMin"], ["tempMax", "dr.h.tempMax"], ["humidity", "dr.h.humidity"]].map(([k, l]) => (
          <div className="field" key={k}><label htmlFor={`d-${k}`}>{tr(l)}</label>
            <input id={`d-${k}`} type="number" dir="ltr" readOnly={readOnly} value={v.weather[k] ?? ""} onChange={(e) => up({ weather: { ...v.weather, [k]: e.target.value } })} /></div>
        ))}
      </div>
      {onPrefill && !readOnly && (
        <p><button className="btn ghost" type="button" onClick={onPrefill}>{tr("dl.prefill")}</button>
          <span className="muted sm">{tr("dl.prefillNote")}</span></p>
      )}
      {Object.keys(COLS).map((list) => (
        <section key={list} className="dsection"><h3>{tr(`dl.t.${list}`)}</h3>
          <Rows list={list} rows={v[list]} setRows={(rows) => up({ [list]: rows })} labels={labels} readOnly={readOnly} catalog={catalog} /></section>
      ))}
      <section className="dsection"><h3>{tr("dl.hse")}</h3>
        <div className="grid2">
          {[["incidents", "dl.incidents"], ["permits", "dl.permits"], ["observations", "dl.observations"]].map(([k, l]) => (
            <div className="field" key={k}><label htmlFor={`h-${k}`}>{tr(l)}</label>
              <input id={`h-${k}`} type="number" min={0} dir="ltr" readOnly={readOnly} value={v.hse[k] ?? ""} onChange={(e) => up({ hse: { ...v.hse, [k]: e.target.value, source: "manual" } })} /></div>
          ))}
          <div className="field"><label htmlFor="h-note">{tr("dl.hseNote")}</label>
            <input id="h-note" readOnly={readOnly} value={v.hse.note ?? ""} onChange={(e) => up({ hse: { ...v.hse, note: e.target.value } })} /></div>
        </div>
        <p className="muted sm">{tr("dl.sourceLine", { x: sourceL(L, labels, v.hse.source || "manual") })}</p>
      </section>
      {!readOnly && <Datalists catalog={catalog} />}
      <div className="field"><label htmlFor="d-notes">{tr("dl.notes")}</label>
        <textarea id="d-notes" rows={3} readOnly={readOnly} value={v.notes ?? ""} onChange={(e) => up({ notes: e.target.value })} /></div>
    </>
  );
}

function Datalists({ catalog }) {
  const names = (kinds) => [...new Set(catalog.filter((c) => kinds.includes(c.kind)).map((c) => c.name))];
  const lists = { "dl-person": names(KINDS.manpower), "dl-machine": names(KINDS.equipment), "dl-material": names(KINDS.materials),
    "dl-disc": [...new Set(catalog.filter((c) => c.kind === "person" && c.discipline).map((c) => c.discipline))],
    "dl-unit": [...new Set(catalog.filter((c) => c.unit && KINDS.materials.includes(c.kind)).map((c) => c.unit))] };
  return <>{Object.entries(lists).map(([id, xs]) => <datalist key={id} id={id}>{xs.map((x) => <option key={x} value={x} />)}</datalist>)}</>;
}

const fromContent = (c) => ({ ...EMPTY, ...c, weather: { ...EMPTY.weather, ...(c?.weather || {}) }, hse: { ...EMPTY.hse, ...(c?.hse || {}) } });

export default function DailyReportsPage() {
  const { projectId, call } = usePlatform();
  const { t, L: lbl, date: dateOf, dateTime } = usePrefs();
  const { data, error, reload } = useProjectData((id) => `/api/daily-reports?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [view, setView] = useState(null);
  const [draft, setDraft] = useState(null);          // a new report being written
  const [date, setDate] = useState(localToday());
  const [title, setTitle] = useState("");
  const [edit, setEdit] = useState(null);            // content being edited on an open report
  const [comment, setComment] = useState("");
  const [send, setSend] = useState({ userIds: [], note: "" });

  async function open(id) {
    setMsg(null); setOpenId(id); setEdit(null); setComment("");
    try { setView(await call(`/api/daily-reports?projectId=${projectId}&id=${id}`)); } catch (e) { setMsg(e.message); }
  }
  async function post(body, after) {
    setMsg(null);
    try { const r = await call("/api/daily-reports", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); if (after) await after(r); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  async function prefill(target, setTarget, day) {
    setMsg(null);
    try {
      const p = await call(`/api/daily-reports?projectId=${projectId}&prefill=${day}`);
      setTarget({ ...target,
        manpower: [...target.manpower.filter((r) => r.source !== "hr"), ...p.manpower],
        work: [...target.work.filter((r) => r.source !== "platform"), ...p.work],
        hse: { ...target.hse, ...p.hse } });
      if (!p.found.people && !p.found.work) setMsg(t("dl.noData", { day }));
    } catch (e) { setMsg(e.message); }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const [before, after] = t("dl.legacy").split("{link}");
  const legacyNote = data.contracts > 0 && <p className="note" data-legacy-daily>{before}<a href="/contract-reports">{t("dr.title")}</a>{after}</p>;
  if (!data.type) return (
    <div className="page"><div className="pagehead"><h1>{t("dl.title")}</h1></div>
      {legacyNote || <p className="empty-note">{t("dl.noFlow")}</p>}</div>
  );
  const L = data.labels;
  const v = view;
  const status = (r) => lbl(`report.status.${r.status}`, r.status_fa);

  return (
    <div className="page">
      <div className="pagehead"><h1>{t("dl.title")}</h1>
        <span className="sub">{t("dl.sub", { n: data.reports.length, stages: data.type.stages.map((s) => s.name).join(" ← ") })}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {legacyNote}

      <div className="card">
        <h2>{t("dl.reports")}</h2>
        {data.may.create && !draft && (
          <p><button className="btn" type="button" onClick={() => { setDraft(fromContent({})); setOpenId(null); setView(null); }}>{t("dl.new")}</button></p>
        )}
        {data.reports.length === 0 ? <p className="empty-note">{t("dr.none")}</p> : (
          <div className="tablewrap"><TableKit name="daily-reports-2"><table className="dtable">
            <thead><tr><th>{t("c.no")}</th><th>{t("dl.h.date")}</th><th>{t("c.title")}</th><th>{t("dr.h.stage")}</th><th>{t("c.status")}</th><th>{t("dr.h.version")}</th><th /></tr></thead>
            <tbody>{data.reports.map((r) => (
              <tr key={r.id} className={openId === r.id ? "sel" : ""}>
                <td className="mono">{r.report_no}</td><td className="mono sm">{dateOf(r.report_date)}</td>
                <td>{r.title || "—"}</td><td className="sm">{r.status === "open" ? r.stage_name : "—"}</td>
                <td><span className={`pill ${r.status === "approved" ? "ok" : r.status === "cancelled" ? "" : "warn"}`}>{status(r)}</span></td>
                <td className="mono">{r.version_no}</td>
                <td><button className="btn ghost sm" type="button" onClick={() => { setDraft(null); open(r.id); }}>{t("dr.open")}</button></td>
              </tr>
            ))}</tbody>
          </table></TableKit></div>
        )}
      </div>

      {draft && (
        <div className="card">
          <h2>{t("dl.new")}</h2>
          <div className="grid2">
            <div className="field"><label htmlFor="n-date">{t("dl.date")}</label>
              <input id="n-date" type="date" dir="ltr" max={localToday()} value={date} onChange={(e) => setDate(e.target.value)} /><DayHint date={date} /></div>
            <div className="field"><label htmlFor="n-title">{t("dl.titleOpt")}</label><input id="n-title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          </div>
          <Editor value={draft} setValue={setDraft} labels={L} catalog={data.catalog} onPrefill={() => prefill(draft, setDraft, date)} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" type="button" onClick={() => post({ kind: "create", reportDate: date, title, content: draft },
              async (r) => { setDraft(null); setTitle(""); await open(r.row.id); })}>{t("dl.save")}</button>
            <button className="btn ghost" type="button" onClick={() => setDraft(null)}>{t("common.cancel")}</button>
          </div>
        </div>
      )}

      {v && (
        <div className="card" id="report">
          <h2>{v.report.report_no} — {dateOf(v.report.report_date)}{v.report.title ? ` — ${v.report.title}` : ""}</h2>
          <p className="sm">
            <span className={`pill ${v.report.status === "approved" ? "ok" : v.report.status === "cancelled" ? "" : "warn"}`}>{status(v.report)}</span>
            {v.report.status === "open" && <>{t("dl.atStage")}<b>{v.report.stage_name}</b></>} · {t("dr.versionN", { n: v.versionNo })}
            {v.record && <>{t("dl.recordLine", { n: v.record.versionNo })}<span className="mono">{v.record.hash.slice(0, 12)}…</span></>}
          </p>
          <p><a className="btn ghost sm" href={`/daily-reports/print?id=${v.report.id}`}>{t("dl.printView")}</a></p>
          <div className="moneyrow">
            <div><span>{t("dl.m.people")}</span><b>{v.totals.people}</b></div>
            <div><span>{t("dl.m.leave")}</span><b>{v.totals.onLeave}</b></div>
            <div><span>{t("dl.m.working")}</span><b>{v.totals.machinesWorking}</b></div>
            <div><span>{t("dl.m.idle")}</span><b>{v.totals.machinesIdle}</b></div>
            <div><span>{t("dl.m.stoppage")}</span><b>{v.totals.stoppageHours}</b></div>
          </div>

          {edit ? (
            <>
              <Editor value={edit} setValue={setEdit} labels={L} catalog={data.catalog} onPrefill={() => prefill(edit, setEdit, String(v.report.report_date).slice(0, 10))} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" type="button" onClick={() => post({ kind: "edit", reportId: v.report.id, content: edit }, () => open(v.report.id))}>{t("dl.saveVersion")}</button>
                <button className="btn ghost" type="button" onClick={() => setEdit(null)}>{t("common.cancel")}</button>
              </div>
            </>
          ) : (
            <>
              <Editor value={fromContent(v.content)} setValue={() => {}} labels={L} readOnly />
              {v.may.edit && <button className="btn ghost" type="button" onClick={() => setEdit(fromContent(v.content))}>{t("dr.edit")}</button>}
            </>
          )}

          <h3 style={{ marginTop: 16 }}>{t("dl.signatures")}</h3>
          <div className="sigrow">
            {v.signatureBoxes.flatMap((st) => st.groups.map((g) => (
              <div className="sigcell" key={g.groupId}>
                <div className="sigstage">{st.stageName}</div>
                <div className="siggroup">{g.title || g.name}</div>
                {g.signatures.length === 0 ? <div className="muted sm">—</div> : g.signatures.map((s) => (
                  <div key={s.userId} className={s.current ? "" : "stale"}>
                    {s.signatureId ? <img src={`/api/signature?projectId=${projectId}&id=${s.signatureId}`} alt={t("dl.signatureOf", { name: s.name || "" })} /> : null}
                    <div className="sm">{s.onBehalfOf && <span className="muted">{t("wf.onBehalf", { name: s.onBehalfOf })}</span>}{s.name || "—"}</div>
                    <div className="mono sm">{dateTime(s.at)}</div>
                    {!s.current && <div className="sm warn">{t("dl.stale", { n: s.versionNo })}</div>}
                  </div>
                ))}
              </div>
            )))}
          </div>

          {v.report.status === "open" && (
            <div className="actions">
              {v.may.signFor.map((gid) => {
                const g = v.signatureBoxes.flatMap((s) => s.groups).find((x) => x.groupId === gid);
                return <button key={gid} className="btn" type="button" onClick={() => post({ kind: "sign", reportId: v.report.id, groupId: gid }, () => open(v.report.id))}>
                  {t("dl.sign")}{v.may.signFor.length > 1 ? t("dl.signFor", { name: g?.name }) : ""}</button>;
              })}
              {v.may.withdraw && <button className="btn ghost" type="button" onClick={() => post({ kind: "withdraw", reportId: v.report.id }, () => open(v.report.id))}>{t("dl.withdraw")}</button>}
              {v.may.approve && <button className="btn" type="button" onClick={() => post({ kind: "approve", reportId: v.report.id, comment }, () => open(v.report.id))}>{t("wf.approve")}</button>}
              {(v.may.return || v.may.cancel) && (
                <div className="field" style={{ flexBasis: "100%" }}><label htmlFor="r-comment">{t("dl.reason")}</label>
                  <input id="r-comment" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
              )}
              {v.may.return && <button className="btn ghost" type="button" onClick={() => post({ kind: "return", reportId: v.report.id, comment }, () => open(v.report.id))}>{t("wf.return")}</button>}
              {v.may.cancel && <button className="btn ghost" type="button" onClick={() => post({ kind: "cancel", reportId: v.report.id, comment }, () => open(v.report.id))}>{t("dl.cancel")}</button>}
            </div>
          )}

          <details className="inlinefold"><summary>{t("dl.sendFold")}</summary>
            <div className="permgrid" role="group" aria-label={t("wf.to")}>
              {data.users.map((u) => (
                <label key={u.id}><input type="checkbox" checked={send.userIds.includes(u.id)} onChange={(e) => setSend({ ...send,
                  userIds: e.target.checked ? [...send.userIds, u.id] : send.userIds.filter((x) => x !== u.id) })} /> {u.name}</label>
              ))}
            </div>
            <div className="field"><label htmlFor="s-note">{t("wf.note")}</label><input id="s-note" value={send.note} onChange={(e) => setSend({ ...send, note: e.target.value })} /></div>
            <button className="btn ghost" type="button" onClick={() => post({ kind: "send", reportId: v.report.id, ...send }, () => setSend({ userIds: [], note: "" }))}>{t("wf.sendBtn")}</button>
          </details>

          <details className="inlinefold"><summary>{t("dl.history", { v: v.versions.length, d: v.decisions.length })}</summary>
            <TableKit name="daily-reports-3"><table className="dtable">
              <thead><tr><th>{t("wf.h.version")}</th><th>{t("wf.h.stage")}</th><th>{t("wf.h.editor")}</th><th>{t("wf.h.time")}</th><th>{t("dl.h.hash")}</th></tr></thead>
              <tbody>{v.versions.map((x) => (
                <tr key={x.version_no}><td className="mono">{x.version_no}</td><td>{x.stage_seq}</td><td>{x.edited_by || "—"}</td>
                  <td className="mono sm">{dateTime(x.edited_at)}</td><td className="mono sm">{x.content_hash.slice(0, 12)}…</td></tr>
              ))}</tbody>
            </table></TableKit>
            <TableKit name="daily-reports-4"><table className="dtable">
              <thead><tr><th>{t("wf.h.stage")}</th><th>{t("wf.h.decision")}</th><th>{t("wf.h.version")}</th><th>{t("wf.h.by")}</th><th>{t("wf.h.comment")}</th><th>{t("wf.h.time")}</th></tr></thead>
              <tbody>{v.decisions.map((d, i) => (
                <tr key={i}><td>{d.stageSeq}</td><td>{t(d.action === "approved" ? "dl.act.approved" : `wf.act.${d.action}`)}</td><td className="mono">{d.versionNo}</td>
                  <td>{d.by || "—"}</td><td className="sm">{d.comment || "—"}</td><td className="mono sm">{dateTime(d.at)}</td></tr>
              ))}</tbody>
            </table></TableKit>
          </details>
        </div>
      )}
    </div>
  );
}
