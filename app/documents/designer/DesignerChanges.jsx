"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { localToday } from "../../../components/ui/WorkDate";

/**
 * The designer's part of site changes: the TQs put to it, to answer; and the
 * approved site changes (site-run, field change, as-built) to put on the
 * drawing — the as-built revision, which then comes to the project by
 * transmittal like any other revision.
 */
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");

export function DesignerTqs() {
  const { data, error, reload, post, msg } = useChanges();
  const [ans, setAns] = useState({});
  if (error) return <div className="card"><h2>پرسش‌های فنی (TQ)</h2><p className="err">{error}</p></div>;
  if (!data) return <div className="card"><h2>پرسش‌های فنی (TQ)</h2><p className="muted">در حال بارگذاری…</p></div>;
  return (
    <div className="card">
      <h2>پرسش‌های فنی (TQ)</h2>
      {msg && <p className="err">{msg}</p>}
      {data.tqs.length === 0 ? <p className="empty-note">TQ به شما ارجاع نشده است.</p> : (
        <table className="dtable" data-designer-tqs>
          <thead><tr><th>شماره</th><th>پرسش</th><th>مدرک</th><th>مهلت</th><th>پاسخ</th></tr></thead>
          <tbody>{data.tqs.map((t) => (
            <tr key={t.id} data-tq={t.tq_no}>
              <td className="mono">{t.tq_no}</td>
              <td><b>{t.subject}</b><div className="sm">{t.question}</div>{t.proposal && <div className="muted sm">پیشنهاد سایت: {t.proposal}</div>}</td>
              <td className="mono sm">{t.doc_no || "—"}</td>
              <td className="mono sm">{fa(t.reply_due)}{t.overdue && <span className="pill bad"> گذشته</span>}</td>
              <td>{t.status === "open" ? (
                <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "tq-answer", tqId: t.id, answer: ans[t.id], answeredOn: localToday() })) reload(); }}
                      style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <input aria-label={`پاسخ ${t.tq_no}`} dir="auto" value={ans[t.id] || ""} onChange={(e) => setAns({ ...ans, [t.id]: e.target.value })} style={{ minWidth: 220 }} />
                  <button className="btn" type="submit" disabled={!(ans[t.id] || "").trim()}>ارسال پاسخ</button>
                </form>
              ) : <span className="sm">{t.answer} <span className="muted">· {fa(t.answered_on)} · {t.statusFa}</span></span>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

export function DesignerAsBuilt() {
  const { data, error, reload, post, msg } = useChanges();
  const [rev, setRev] = useState({});
  if (error || !data) return <div className="card"><h2>As-built تغییرات سایت</h2>{error ? <p className="err">{error}</p> : <p className="muted">در حال بارگذاری…</p>}</div>;
  return (
    <div className="card">
      <h2>As-built تغییرات سایت</h2>
      <p className="muted sm">تغییرهایی که پروژه تأیید کرده (سایت‌ران، تغییر در سایت، انحراف As-built): رویژن As-built نقشه را اعلام کنید و خود رویژن را با ترانسمیتال بفرستید.</p>
      {msg && <p className="err">{msg}</p>}
      {data.changes.length === 0 ? <p className="empty-note">تغییری منتظر As-built نیست.</p> : (
        <table className="dtable" data-designer-changes>
          <thead><tr><th>شماره</th><th>نوع</th><th>تغییر</th><th>نقشه</th><th>As-built</th></tr></thead>
          <tbody>{data.changes.map((c) => (
            <tr key={c.id} data-fcr={c.fcr_no}>
              <td className="mono">{c.fcr_no}</td><td className="sm">{c.kindFa}</td><td>{c.title}<div className="muted sm">{c.description}</div></td>
              <td className="mono sm">{c.doc_no || "—"}{c.line_no && <div className="muted sm">{c.line_no}</div>}</td>
              <td>{c.status === "approved" ? (
                <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "asbuilt", changeId: c.id, revision: rev[c.id], submittedOn: localToday() })) reload(); }}
                      style={{ display: "flex", gap: 4 }}>
                  <input aria-label={`رویژن As-built ${c.fcr_no}`} dir="ltr" placeholder="رویژن" value={rev[c.id] || ""} onChange={(e) => setRev({ ...rev, [c.id]: e.target.value })} style={{ width: 80 }} />
                  <button className="btn" type="submit" disabled={!(rev[c.id] || "").trim()}>اعلام As-built</button>
                </form>
              ) : <span className="sm">Rev.{c.asbuilt_revision} · {fa(c.asbuilt_on)} · {c.statusFa}</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function useChanges() {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/changes?projectId=${id}&view=designer`, []);
  const [msg, setMsg] = useState(null);
  async function post(body) {
    setMsg(null);
    try { await call("/api/changes", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); return true; }
    catch (e) { setMsg(e.message); return false; }
  }
  return { data, error, reload, post, msg };
}
