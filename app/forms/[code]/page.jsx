"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { localToday } from "../../../components/ui/WorkDate";
import { Workflow, Actions, History } from "../../../components/reports/WorkflowPanel";

import TableKit from "../../../components/ui/TableKit";
/**
 * One handover form: its reports, a new one for a day — its rows typed, or
 * taken from the work the employer accepted that day in the form's section
 * — and a report through its workflow: edited while its stage allows,
 * signed, approved, printed. What each person may do is the workflow's.
 */
const shown = (f, v) => (v === null || v === undefined || v === "" ? "—" : f.type === "check" ? (v ? "✓" : "—")
  : f.type === "number" ? Number(v).toLocaleString("fa-IR") : String(v));

function Input({ f, value, on, id }) {
  if (f.type === "select") return <select id={id} aria-label={f.label} value={value ?? ""} onChange={(e) => on(e.target.value)}>
    <option value="">—</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
  if (f.type === "check") return <input id={id} aria-label={f.label} type="checkbox" checked={!!value} onChange={(e) => on(e.target.checked)} />;
  return <input id={id} aria-label={f.label} type={f.type === "date" ? "date" : "text"} dir={f.type === "number" || f.type === "date" ? "ltr" : undefined}
    inputMode={f.type === "number" ? "decimal" : undefined} value={value ?? ""} onChange={(e) => on(e.target.value)} />;
}

export default function FormReportsPage() {
  const { code } = useParams();
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/forms?projectId=${id}&code=${encodeURIComponent(code)}`, [code]);
  const [openId, setOpenId] = useState(null);
  // a request named in the link (the desk's «open», owner's requirements 2026-10-22, item 14) opens at once
  useEffect(() => { const r = new URLSearchParams(window.location.search).get("report"); if (r) setOpenId(r); }, []);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  useEffect(() => { const id = new URLSearchParams(window.location.search).get("id"); if (id) setOpenId(id); }, []);
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/forms", { method: "POST", body: JSON.stringify({ projectId, code, ...body }) }); reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const T = data.type;
  return (
    <div className="page">
      <div className="pagehead"><h1>{T.name}</h1>
        <span className="sub"><span className="mono">{T.code}</span> · {data.labels.sections[T.section]} · گردش کار: {data.stages.map((s) => s.name).join(" ← ")}</span></div>
      {!openId && msg && <p className="err" role="alert">{msg}</p>}
      {!openId && ok && <p className="okmsg" role="status">{ok}</p>}
      {openId ? <ReportView projectId={projectId} id={openId} call={call} users={data.users} close={() => { setOpenId(null); reload(); }} />
        : <>
          {data.may.create ? <NewReport T={T} projectId={projectId} code={code} call={call} post={post} open={setOpenId} />
            : <p className="sm muted">ساخت گزارش این فرم با اعضای مرحلهٔ اول گردش کار آن است که حق «ایجاد گزارش» دارند.</p>}
          <div className="card">
            <h2>گزارش‌ها</h2>
            {data.reports.length === 0 ? <p className="empty-note">گزارشی نیست.</p> : (
              <TableKit name="forms-code-1"><table className="dtable"><thead><tr><th>شماره</th><th>تاریخ</th><th>عنوان</th><th>مرحله</th><th>وضعیت</th><th>نسخه</th><th /></tr></thead>
                <tbody>{data.reports.map((r) => (
                  <tr key={r.id}><td className="mono">{r.report_no}</td><td className="mono">{String(r.report_date).slice(0, 10)}</td><td>{r.title}</td><td>{r.stage_name}</td>
                    <td><span className={`pill ${r.status === "approved" ? "ok" : r.status === "cancelled" ? "bad" : ""}`}>{r.status_fa}</span></td><td className="mono">{r.version_no}</td>
                    <td><button className="btn ghost sm" type="button" onClick={() => setOpenId(r.id)}>باز کردن</button>
                      <Link className="btn ghost sm" href={`/forms/${code}/print?id=${r.id}`}>چاپ / PDF</Link></td></tr>))}</tbody></table></TableKit>)}
          </div>
        </>}
    </div>
  );
}

function NewReport({ T, projectId, code, call, post, open }) {
  const def = T.form;
  const [f, setF] = useState({ reportDate: localToday(), title: "", header: {}, fromWork: def.source === "claims" });
  const [work, setWork] = useState(null);
  useEffect(() => {
    if (!f.fromWork || !f.reportDate) { setWork(null); return; }
    call(`/api/forms?projectId=${projectId}&code=${encodeURIComponent(code)}&work=${f.reportDate}`).then((r) => setWork(r.work)).catch(() => setWork(null));
  }, [f.fromWork, f.reportDate, projectId, code, call]);
  return (
    <form className="card" onSubmit={async (e) => {
      e.preventDefault();
      const r = await post({ kind: "create", reportDate: f.reportDate, title: f.title || null, header: f.header, fromWork: f.fromWork }, () => "گزارش ساخته شد.");
      if (r?.row) open(r.row.id);
    }}>
      <h2>گزارش تازه</h2>
      <div className="grid2">
        <div className="field"><label htmlFor="nf-d">تاریخ تحویل</label><input id="nf-d" type="date" required value={f.reportDate} onChange={(e) => setF({ ...f, reportDate: e.target.value })} /></div>
        <div className="field"><label htmlFor="nf-t">عنوان (خالی: نام فرم و تاریخ)</label><input id="nf-t" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        {def.header.map((h) => (
          <div className="field" key={h.key}><label htmlFor={`nf-h-${h.key}`}>{h.label}{h.required && " *"}</label>
            <Input id={`nf-h-${h.key}`} f={h} value={f.header[h.key]} on={(v) => setF({ ...f, header: { ...f.header, [h.key]: v } })} /></div>))}
      </div>
      {def.source === "claims" && (
        <label className="sm" style={{ display: "flex", gap: 6, alignItems: "center", margin: "8px 0" }}>
          <input id="nf-w" type="checkbox" checked={f.fromWork} onChange={(e) => setF({ ...f, fromWork: e.target.checked })} />
          ردیف‌ها از کارهایی که کارفرما در این روز تحویل گرفته
          {f.fromWork && work && <b data-work-count={work.length}> — {work.length.toLocaleString("fa-IR")} کار تحویل‌گرفته در {f.reportDate}</b>}</label>)}
      <button className="btn" type="submit">ساخت گزارش</button>
    </form>
  );
}

function ReportView({ projectId, id, call, users, close }) {
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [draft, setDraft] = useState(null);
  const [tab, setTab] = useState("content");
  const load = () => call(`/api/forms?projectId=${projectId}&id=${id}`).then((x) => { setV(x); setDraft(null); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/forms", { method: "POST", body: JSON.stringify({ projectId, reportId: id, ...body }) }); await load(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  if (err) return <p className="err">{err}</p>;
  if (!v) return <p className="muted">در حال بارگذاری…</p>;
  const def = v.def;
  const c = draft || v.content;
  const editing = !!draft;
  const setRow = (i, k, val) => setDraft({ ...c, rows: c.rows.map((r, j) => (j === i ? { ...r, [k]: val } : r)) });
  const nums = def.columns.filter((x) => x.type === "number");
  const sum = (k) => c.rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  return (
    <>
      <p className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn ghost" type="button" onClick={close}>بازگشت به فهرست</button>
        <Link className="btn ghost" href={`/forms/${v.type.code}/print?id=${id}`}>چاپ / PDF {v.report.status === "approved" ? "(نسخهٔ مرجع)" : ""}</Link>
      </p>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      <div className="card">
        <h2>{v.report.title} <span className="mono sm muted">{v.report.report_no}</span></h2>
        <p className="sm">{v.type.name} · {v.type.sectionName} · تاریخ <b className="mono">{String(v.report.report_date).slice(0, 10)}</b> · نسخهٔ {v.versionNo} · <b>{v.report.status_fa}</b>
          {v.report.status === "open" && <> — مرحلهٔ جاری: <b>{v.report.stage_name}</b></>}</p>
        <Workflow v={v} />
        {!v.may.edit && v.report.status === "open" && v.may.editWhy && /امضا/.test(v.may.editWhy) && <p className="sm" role="status">🔒 {v.may.editWhy}</p>}
      </div>
      <div className="ptabs no-print" role="tablist">
        {[["content", "محتوا"], ["actions", "امضا، تأیید و ارسال"], ["history", "تاریخچه"]].map(([k, t]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t}</button>))}
      </div>
      {tab === "content" && (
        <div className="card">
          {def.header.length > 0 && (
            <div className={editing ? "grid2" : "sm"} style={editing ? undefined : { display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
              {def.header.map((h) => editing
                ? <div className="field" key={h.key}><label htmlFor={`eh-${h.key}`}>{h.label}</label>
                  <Input id={`eh-${h.key}`} f={h} value={c.header[h.key]} on={(val) => setDraft({ ...c, header: { ...c.header, [h.key]: val } })} /></div>
                : <span key={h.key}>{h.label}: <b>{shown(h, c.header[h.key])}</b></span>)}
            </div>)}
          <div className="tablewrap"><TableKit name="forms-code-2"><table className="dtable">
            <thead><tr><th>ردیف</th>{def.columns.map((x) => <th key={x.key}>{x.label}{x.bind && <span className="sm muted" title="از کار تحویل‌گرفته"> ⇄</span>}</th>)}{editing && <th />}</tr></thead>
            <tbody>{c.rows.map((r, i) => (
              <tr key={r.id} data-form-row={i}>
                <td className="mono">{i + 1}</td>
                {def.columns.map((x) => <td key={x.key}>{editing ? <Input f={x} value={r[x.key]} on={(val) => setRow(i, x.key, val)} /> : shown(x, r[x.key])}</td>)}
                {editing && <td><button className="btn ghost sm" type="button" onClick={() => setDraft({ ...c, rows: c.rows.filter((_, j) => j !== i) })}>حذف</button></td>}
              </tr>))}</tbody>
            {nums.length > 0 && c.rows.length > 0 && (
              <tfoot><tr><td><b>جمع</b></td>{def.columns.map((x) => <td key={x.key} className="mono">{x.type === "number" ? <b>{sum(x.key).toLocaleString("fa-IR")}</b> : ""}</td>)}{editing && <td />}</tr></tfoot>)}
          </table></TableKit></div>
          {c.rows.length === 0 && <p className="empty-note">ردیفی ثبت نشده.</p>}
          {v.may.edit && !editing && <button className="btn" type="button" onClick={() => setDraft(structuredClone(v.content))}>ویرایش</button>}
          {editing && (
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button className="btn ghost" type="button" onClick={() => setDraft({ ...c, rows: [...c.rows, { id: `n${Date.now().toString(36)}` }] })}>+ ردیف</button>
              <button className="btn" type="button" onClick={() => post({ kind: "edit", header: c.header, rows: c.rows }, () => "ذخیره شد.")}>ذخیره</button>
              <button className="btn ghost" type="button" onClick={() => setDraft(null)}>انصراف</button>
            </div>)}
        </div>)}
      {tab === "actions" && <Actions v={v} users={users} post={post} />}
      {tab === "history" && <History v={v} />}
    </>
  );
}
