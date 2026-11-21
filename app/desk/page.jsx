"use client";
import { useState } from "react";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { usePrefs } from "../../lib/client/prefs.mjs";
import TableKit from "../../components/ui/TableKit";
import TreeEditor from "../../components/ui/TreeEditor";

const codesOf = (node) => node.code ? [node.code] : (node.children || []).flatMap(codesOf);

export default function DeskPage() {
  const { contractId, projectId } = usePlatform();
  const { t, date } = usePrefs();
  const { data, error } = useProjectData((id) => `/api/desk?projectId=${id}&contractId=${contractId}`);
  return <div className="page">
    <div className="pagehead"><h1>{t("dk.title")}</h1>
      {data && <span className="sub">
        {t("dk.sub", { n: data.active.length, w: data.active.filter((row) => row.waits.length).length })} ·{" "}
        <Link href="/notifications" data-desk-notes>{t("dk.notes", { u: data.notifications.unread, r: data.notifications.awaitingReply })}</Link>
      </span>}
    </div>
    {error && <p className="err" role="alert">{error}</p>}
    {!data && !error && <p className="muted">{t("common.loading")}</p>}
    {data && <RequestLists key={`${projectId}:${contractId}`} data={data} t={t} date={date} />}
  </div>;
}

function RequestLists({ data, t, date }) {
  const [filter, setFilter] = useState("types");
  const [status, setStatus] = useState("");
  const [codes, setCodes] = useState([]);
  const [id, setId] = useState("");
  const rows = [...data.active, ...data.archive]
    .filter((request) => (!status || request.status === status) && (!codes.length || codes.includes(request.typeCode)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.reportDate.localeCompare(a.reportDate));
  const selected = rows.find((row) => row.id === id);
  return <>
    <section className="card" data-desk-start>
      <h2>{t("dk.start")}</h2>
      {data.start.length ? <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{data.start.map((form) =>
        <Link key={form.code} className="btn ghost sm" href={form.href} data-start={form.code}>{form.code} — {form.name}</Link>)}</div>
        : <p className="empty-note">{t("dk.noStart")}</p>}
    </section>
    <div className="desk-columns">
      <section className="card">
        <div className="p6-tabs" role="tablist">
          {["types", "states"].map((view) => <button key={view} type="button" role="tab"
            aria-selected={filter === view} className={filter === view ? "on" : ""} onClick={() => setFilter(view)}>{t(`dk.${view}`)}</button>)}
        </div>
        {filter === "types" ? <TreeEditor nodes={data.types || []} editable={false} searchable render={(node) => {
          const choices = codesOf(node);
          const count = choices.filter((code) => codes.includes(code)).length;
          return <label><input type="checkbox" checked={count === choices.length}
            ref={(el) => { if (el) el.indeterminate = count > 0 && count < choices.length; }}
            onChange={(event) => setCodes(event.target.checked ? [...new Set([...codes, ...choices])] : codes.filter((code) => !choices.includes(code)))} /> {node.name}</label>;
        }} /> : <div className="desk-states">
          {[["", "dk.allStates"], ["open", "dk.st.open"], ["approved", "dk.st.approved"], ["cancelled", "dk.rejected"]].map(([value, label]) =>
            <label key={value}><input type="radio" name="request-status" checked={status === value} onChange={() => setStatus(value)} /> {t(label)}</label>)}
        </div>}
      </section>
      <section className="card">
        <div className="tablewrap">
          <TableKit name="desk-requests" min={1} onRowNavigate={setId}><table className="dtable" data-desk-list={status || "all"}>
            <thead><tr><th>{t("dk.form")}</th><th>{t("dk.no")}</th><th>{t("dk.date")}</th><th>{t("dk.titleCol")}</th><th>{t("dk.status")}</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id} data-key={row.id} data-request={row.reportNo} data-current={row.id === id || undefined}
              onClick={() => setId(row.id)} style={{ fontWeight: row.acted === false ? 700 : undefined }}>
              <td className="mono">{row.typeCode}</td>
              <td><button className="linkbtn mono" type="button" onClick={() => setId(row.id)}>{row.reportNo}</button></td>
              <td className="mono">{date(row.reportDate)}</td><td>{row.title || "—"}</td>
              <td>{t(`dk.st.${row.status}`)}{row.waits?.length > 0 && <div className="sm" data-waits>{row.waits.map((action) => t(`dk.w.${action}`)).join(t("c.sep"))}</div>}</td>
            </tr>)}
            {!rows.length && <tr><td colSpan={5}>{t("dk.none")}</td></tr>}</tbody>
          </table></TableKit>
        </div>
      </section>
      <section className="card">
        <h2>{t("dk.details")}</h2>
        {selected ? <RequestDetail key={selected.id} request={selected} /> : <p className="empty-note">{t("dk.pickRequest")}</p>}
      </section>
    </div>
  </>;
}

function RequestDetail({ request }) {
  const { projectId, call } = usePlatform();
  const { t, dateTime } = usePrefs();
  const { data, error } = useProjectData((id) => `/api/desk?projectId=${id}&id=${request.id}`);
  const [recipients, setRecipients] = useState([]);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  async function send(event) {
    event.preventDefault();
    if (busy || !recipients.length) return;
    setBusy(true);
    setMessage(null);
    try {
      await call("/api/desk", { method: "POST", body: JSON.stringify({ projectId, reportId: request.id, userIds: recipients, note }) });
      setRecipients([]); setNote("");
      setMessage({ text: t("dk.sent") });
    } catch (failure) {
      setMessage({ error: true, text: failure.message });
    } finally { setBusy(false); }
  }
  return <>
    {request.href && <Link className="btn ghost sm" href={request.href} data-open={request.reportNo}>{t("dk.open")}</Link>}
    {error && <p className="err" role="alert">{error}</p>}
    {!data && !error && <p>{t("common.loading")}</p>}
    {data && <>
      {data.editable && <p className="okmsg" role="status">{t("dk.editable")}</p>}
      <div className="desk-stages">{data.stages.map((stage) => {
        const status = data.status === "approved" || stage.stageSeq < data.stage ? t("dk.st.approved")
          : data.status === "cancelled" ? t("dk.st.cancelled") : stage.stageSeq === data.stage ? t("dk.st.open") : t("dk.stagePending");
        return <article key={stage.stageSeq}>
          <strong>{stage.stageName}</strong><span className="sm muted">{status}</span>
          {stage.groups.map((group) => <div className="desk-group" key={group.groupId}>
            <b>{group.name}</b>
            {group.here && data.status === "open" && <span className="desk-clock" title={t("dk.waitingGroup")} aria-label={t("dk.waitingGroup")}>◷</span>}
            {group.signatures.length ? <ul>{group.signatures.map((signature) => <li key={`${signature.userId}:${signature.at}`} className={signature.current ? "" : "muted"}>
              {signature.name || "—"} <time dateTime={signature.at}>{dateTime(signature.at)}</time>
            </li>)}</ul> : <span className="sm muted">{t("dk.stagePending")}</span>}
          </div>)}
        </article>;
      })}</div>
      {data.users.length > 0 && <details><summary>{t("dk.share")}</summary>
        <form onSubmit={send}>
          <label>{t("dk.recipients")}<select multiple required value={recipients}
            onChange={(event) => setRecipients([...event.target.selectedOptions].map((option) => option.value))}>
            {data.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select></label>
          <label>{t("dk.sendNote")} <textarea value={note} maxLength={10000} onChange={(event) => setNote(event.target.value)} /></label>
          <button className="btn sm" type="submit" disabled={busy || !recipients.length}>{t("dk.share")}</button>
          {message && <p className={message.error ? "err" : "okmsg"} role={message.error ? "alert" : "status"}>{message.text}</p>}
        </form>
      </details>}
    </>}
  </>;
}
