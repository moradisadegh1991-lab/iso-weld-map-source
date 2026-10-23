"use client";
import { useState } from "react";
import Link from "next/link";
import { useProjectData } from "../../lib/client/platform.mjs";
import { usePrefs } from "../../lib/client/prefs.mjs";
import TableKit from "../../components/ui/TableKit";

/**
 * The desk (owner's requirements of 2026-10-22, items 13 and 14): the
 * requests the signed-in person takes part in, in two lists — active (still
 * in their workflow; what waits on them first) and archived (approved or
 * cancelled) — each opening on its own form's page; the forms they may start;
 * and how many notifications wait on them. lib/db/repos/desk.mjs decides
 * what is theirs and what waits on them.
 */
export default function DeskPage() {
  const { t, date, dateTime } = usePrefs();
  const { data, error } = useProjectData((id) => `/api/desk?projectId=${id}`, []);
  const [tab, setTab] = useState("active");
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const waiting = data.active.filter((r) => r.waits.length).length;
  const rows = tab === "active" ? data.active : data.archive;
  return (
    <div className="page">
      <div className="pagehead"><h1>{t("dk.title")}</h1>
        <span className="sub">{t("dk.sub", { n: data.active.length, w: waiting })}{" · "}
          <Link href="/notifications" data-desk-notes>{t("dk.notes", { u: data.notifications.unread, r: data.notifications.awaitingReply })}</Link></span></div>

      <div className="card" data-desk-start>
        <h2>{t("dk.start")}</h2>
        <p className="sm muted">{t("dk.startNote")}</p>
        {data.start.length === 0 ? <p className="empty-note">{t("dk.noStart")}</p>
          : <p className="row" style={{ gap: 6, flexWrap: "wrap" }}>{data.start.map((f) => (
            <Link key={f.code} className="btn ghost sm" href={f.href} data-start={f.code}>{f.code} — {f.name}</Link>))}</p>}
      </div>

      <div className="card">
        <div className="p6-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "active"} className={tab === "active" ? "on" : undefined} data-desk-tab="active" onClick={() => setTab("active")}>{t("dk.active", { n: data.active.length })}</button>
          <button type="button" role="tab" aria-selected={tab === "archive"} className={tab === "archive" ? "on" : undefined} data-desk-tab="archive" onClick={() => setTab("archive")}>{t("dk.archive", { n: data.archive.length })}</button>
        </div>
        {rows.length === 0 ? <p className="empty-note">{t("dk.none")}</p> : (
          <div className="tablewrap"><TableKit name={`desk-${tab}`}><table className="dtable" data-desk-list={tab}>
            <thead><tr><th>{t("dk.form")}</th><th>{t("dk.no")}</th><th>{t("dk.date")}</th><th>{t("dk.titleCol")}</th>
              {tab === "active" ? <><th>{t("dk.stage")}</th><th>{t("dk.waits")}</th><th>{t("dk.due")}</th></> : <th>{t("dk.status")}</th>}<th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} data-key={r.id} data-request={r.reportNo} style={r.waits?.length ? { fontWeight: 600 } : undefined}>
                <td className="mono">{r.typeCode}</td><td className="mono">{r.reportNo}</td><td className="mono">{date(r.reportDate)}</td><td>{r.title || ""}</td>
                {tab === "active" ? <>
                  <td>{r.stageSeq}. {r.stageName}</td>
                  <td data-waits>{r.waits.map((w) => t(`dk.w.${w}`)).join(t("c.sep")) || "—"}</td>
                  <td className="sm">{r.overdue && <div style={{ color: "var(--bad)" }}>{t("dk.overdue")}</div>}
                    {r.reviewDue && !r.overdue && <div className="mono">{date(r.reviewDue)}</div>}
                    {r.deadlineAt && <div style={{ color: "var(--warn, #b26a00)" }}>{t("dk.deadline", { date: dateTime(r.deadlineAt) })}</div>}
                    {!r.reviewDue && !r.deadlineAt && "—"}</td></>
                  : <td>{t(`dk.st.${r.status}`)}</td>}
                <td>{r.href && <Link className="btn ghost sm" href={r.href} data-open={r.reportNo}>{t("dk.open")}</Link>}</td>
              </tr>))}</tbody></table></TableKit></div>)}
      </div>
    </div>
  );
}
