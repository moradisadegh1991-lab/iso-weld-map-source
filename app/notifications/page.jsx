"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { usePrefs } from "../../lib/client/prefs.mjs";
import Fold from "../../components/ui/Fold";
import TableKit from "../../components/ui/TableKit";

/**
 * Notifications (owner's requirements of 2026-10-22, item 15): a message to
 * other members of the project with files and, if a reply is asked for, the
 * day it is due by; what came to the signed-in person, read on opening and
 * answered once; and what they sent, with each recipient's state. The rules
 * are lib/db/repos/notifications.mjs.
 */
const blank = { recipients: [], title: "", body: "", replyDue: "" };

export default function NotificationsPage() {
  const { projectId, call } = usePlatform();
  const { t, date, dateTime } = usePrefs();
  const { data, error, reload } = useProjectData((id) => `/api/notifications?projectId=${id}`, []);
  const [f, setF] = useState(blank);
  const [files, setFiles] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [answer, setAnswer] = useState("");
  const [tab, setTab] = useState("inbox");
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/notifications", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); await reload(); if (done) setOk(done); return r || true; }
    catch (e) { setMsg(e.message); return null; }
  }
  async function send(e) {
    e.preventDefault();
    if (!window.confirm(t("nt.sendAsk", { n: f.recipients.length }))) return;
    setMsg(null); setOk(null);
    const form = new FormData();
    for (const [k, v] of Object.entries({ projectId, kind: "send", title: f.title, body: f.body, replyDue: f.replyDue, recipients: JSON.stringify(f.recipients) })) form.set(k, v);
    for (const x of files) form.append("file", x);
    try {
      const res = await fetch("/api/notifications", { method: "POST", body: form, credentials: "same-origin" });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || String(res.status));
      setF(blank); setFiles([]); setOk(t("nt.sent")); setTab("outbox"); reload();
    } catch (e2) { setMsg(e2.message); }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const opened = data.inbox.find((n) => n.id === openId) || data.sent.find((n) => n.id === openId) || null;
  const mineIn = opened && data.inbox.some((n) => n.id === opened.id);
  const open = (n, inbox) => { setOpenId(n.id); setAnswer(""); if (inbox && !n.read_at) post({ kind: "read", id: n.id }); };
  const fileLink = (x) => <a key={x.id} href={`/api/notifications?projectId=${projectId}&file=${x.id}`} className="sm" data-file={x.name}>{x.name}</a>;
  const state = (s) => <span className={s === "overdue" ? "err" : undefined} data-state={s}>{t(`nt.s.${s}`)}</span>;
  return (
    <div className="page">
      <div className="pagehead"><h1>{t("nt.title")}</h1></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg toast" role="status">{ok}</p>}

      <div className="card" data-compose-card>
      <h2>{t("nt.title")}</h2>
      <Fold title={t("nt.new")}>
        <form onSubmit={send} data-compose>
          <div className="field"><label htmlFor="nt-title">{t("nt.subject")}</label>
            <input id="nt-title" required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="field"><label htmlFor="nt-body">{t("nt.body")}</label>
            <textarea id="nt-body" rows={4} maxLength={10000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></div>
          <div className="permgrid" role="group" aria-label={t("nt.to")}>
            <span className="sm muted">{t("nt.to")}:</span>
            {data.people.map((u) => (
              <label key={u.id}><input type="checkbox" checked={f.recipients.includes(u.id)} data-to={u.name}
                onChange={(e) => setF({ ...f, recipients: e.target.checked ? [...f.recipients, u.id] : f.recipients.filter((x) => x !== u.id) })} /> {u.name}</label>))}
          </div>
          <div className="grid2">
            <div className="field"><label htmlFor="nt-due">{t("nt.due")}</label>
              <input id="nt-due" type="date" value={f.replyDue} onChange={(e) => setF({ ...f, replyDue: e.target.value })} /></div>
            <div className="field"><label htmlFor="nt-files">{t("nt.files")}</label>
              <input id="nt-files" type="file" multiple onChange={(e) => setFiles([...(e.target.files || [])])} /></div>
          </div>
          <button className="btn" type="submit" disabled={!f.recipients.length} data-send>{t("nt.send")}</button>
        </form>
      </Fold>
      </div>

      <div className="card">
        <div className="p6-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "inbox"} className={tab === "inbox" ? "on" : undefined} data-nt-tab="inbox" onClick={() => setTab("inbox")}>{t("nt.inbox", { n: data.inbox.length })}</button>
          <button type="button" role="tab" aria-selected={tab === "outbox"} className={tab === "outbox" ? "on" : undefined} data-nt-tab="outbox" onClick={() => setTab("outbox")}>{t("nt.outbox", { n: data.sent.length })}</button>
        </div>
        {tab === "inbox" && (data.inbox.length === 0 ? <p className="empty-note">{t("nt.noInbox")}</p> : (
          <TableKit name="notifications-inbox"><table className="dtable" data-inbox>
            <thead><tr><th>{t("nt.subject")}</th><th>{t("nt.from")}</th><th>{t("nt.at")}</th><th>{t("nt.due")}</th><th>{t("nt.state")}</th></tr></thead>
            <tbody>{data.inbox.map((n) => (
              <tr key={n.id} data-key={n.id} data-note={n.title} onClick={() => open(n, true)} style={{ cursor: "pointer", fontWeight: n.read_at ? undefined : 700 }}>
                <td>{n.title}</td><td>{n.sender_name}</td><td className="mono sm">{dateTime(n.created_at)}</td>
                <td className="mono">{n.reply_due ? date(n.reply_due) : "—"}</td><td>{state(n.state)}</td></tr>))}</tbody></table></TableKit>))}
        {tab === "outbox" && (data.sent.length === 0 ? <p className="empty-note">{t("nt.noOutbox")}</p> : (
          <TableKit name="notifications-sent"><table className="dtable" data-outbox>
            <thead><tr><th>{t("nt.subject")}</th><th>{t("nt.at")}</th><th>{t("nt.due")}</th><th>{t("nt.to")}</th></tr></thead>
            <tbody>{data.sent.map((n) => (
              <tr key={n.id} data-key={n.id} data-note={n.title} onClick={() => open(n, false)} style={{ cursor: "pointer" }}>
                <td>{n.title}</td><td className="mono sm">{dateTime(n.created_at)}</td><td className="mono">{n.reply_due ? date(n.reply_due) : "—"}</td>
                <td className="sm">{n.recipients.map((r) => <div key={r.userId}>{r.name}: {state(r.state)}</div>)}</td></tr>))}</tbody></table></TableKit>))}
      </div>

      {opened && (
        <div className="card" data-opened={opened.title}>
          <h2>{opened.title} <button className="btn ghost sm" type="button" onClick={() => setOpenId(null)}>{t("nt.close")}</button></h2>
          <p className="sm muted">{opened.sender_name} · {dateTime(opened.created_at)}{opened.reply_due ? ` · ${t("nt.dueOn", { date: date(opened.reply_due) })}` : ""}</p>
          {opened.body && <p style={{ whiteSpace: "pre-wrap" }} data-body>{opened.body}</p>}
          {opened.files.length > 0 && <p className="row" style={{ gap: 10 }}>{t("nt.files")}: {opened.files.map(fileLink)}</p>}
          {mineIn && (opened.reply
            ? <p data-my-reply>{t("nt.yourReply", { text: opened.reply })}</p>
            : <form onSubmit={async (e) => { e.preventDefault(); if (window.confirm(t("nt.replyAsk")) && await post({ kind: "reply", id: opened.id, text: answer }, t("nt.replied"))) setAnswer(""); }}>
                <div className="field"><label htmlFor="nt-reply">{t("nt.reply")}</label>
                  <textarea id="nt-reply" rows={3} required maxLength={5000} value={answer} onChange={(e) => setAnswer(e.target.value)} /></div>
                <button className="btn" type="submit" data-reply>{t("nt.replyGo")}</button>
              </form>)}
          {!mineIn && opened.recipients && (
            <div data-recipients><b className="sm">{t("nt.recipients")}</b>
              <ul className="sm">{opened.recipients.map((r) => <li key={r.userId}>{r.name}: {state(r.state)}{r.reply ? ` — ${r.reply}` : ""}</li>)}</ul></div>)}
        </div>)}
    </div>
  );
}
