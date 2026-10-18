"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { usePrefs } from "../../lib/client/prefs.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import { STATUS, CONTRACT_STATUS } from "../../lib/contracts/statement.mjs";

/**
 * A record's trail — every step it took, who took it, when, and every
 * comment — with a box to add a comment. The section's full log is the
 * «لاگ و گردش» tab (app/log/[section]).
 *
 *   <EntityLog section="contracts" entityType="statement" entityId={id} label="صورت وضعیت 1 — SC-01" />
 */
export default function EntityLog({ section, entityType, entityId, label, refreshKey = 0 }) {
  const { t } = usePrefs();
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData(
    (id) => `/api/log?projectId=${id}&section=${section}&entityId=${entityId}`, [section, entityId, refreshKey]);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState(null);
  const may = can({ role }, ACTIONS.COMMENT);

  async function send(e) {
    e.preventDefault(); setMsg(null);
    try {
      await call("/api/log", { method: "POST", body: JSON.stringify({ projectId, section, entityType, entityId, label, comment: text }) });
      setText(""); reload();
    } catch (err) { setMsg(err.message); }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted sm">{t("log.loading")}</p>;
  return (
    <div className="entitylog">
      <LogList log={data.log} />
      {may && (
        <form onSubmit={send} style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <input aria-label={t("log.commentOn", { label })} dir="auto" value={text} onChange={(e) => setText(e.target.value)}
                 placeholder={t("log.placeholder")} style={{ flex: 1, minWidth: 220 }} />
          <button className="btn ghost" type="submit" disabled={!text.trim()}>{t("log.submit")}</button>
        </form>
      )}
      {msg && <p className="err">{msg}</p>}
    </div>
  );
}

const TONE = { approved: "ok", accepted: "ok", signed: "ok", paid: "ok", verified: "ok", closed: "ok", returned: "bad", cancelled: "bad", commented: "warn" };

/** A log as a timeline, newest first. */
export function LogList({ log, showSection = false }) {
  const { t, L, dateTime } = usePrefs();
  if (!log.length) return <p className="empty-note">{t("log.empty")}</p>;
  return (
    <ol className="loglist">
      {log.map((e, i) => (
        <li key={i} data-action={e.action}>
          <span className={`pill ${TONE[e.action] || ""}`}>{L(`log.action.${e.action}`, e.actionFa)}</span>
          <b>{e.user}</b>
          <span className="sm">{e.label}</span>
          {showSection && e.sectionFa && <span className="muted sm">[{e.sectionFa}]</span>}
          {(e.from || e.to) && <span className="muted sm">{e.from ? t("log.from", { x: state(L, e.from) }) : ""}{e.to ? t("log.to", { x: state(L, e.to) }) : ""}</span>}
          <span className="muted sm mono">{dateTime(e.at)}</span>
          {e.comment && <div className="logcomment" dir="auto">{e.comment}</div>}
        </li>
      ))}
    </ol>
  );
}

// States in words: a statement's and a contract's share some names (draft); either reads the same.
// A statement's state is its first part ("verified — awaiting the contracts department" → "verified").
const state = (L, k) => (STATUS[k] ? L(`statement.status.${k}`, STATUS[k]).split(" — ")[0]
  : CONTRACT_STATUS[k] ? L(`contract.status.${k}`, CONTRACT_STATUS[k]) : k);
