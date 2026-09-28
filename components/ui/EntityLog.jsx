"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
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
  if (!data) return <p className="muted sm">در حال بارگذاری گردش…</p>;
  return (
    <div className="entitylog">
      <LogList log={data.log} />
      {may && (
        <form onSubmit={send} style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <input aria-label={`کامنت روی ${label}`} dir="auto" value={text} onChange={(e) => setText(e.target.value)}
                 placeholder="کامنت بنویسید…" style={{ flex: 1, minWidth: 220 }} />
          <button className="btn ghost" type="submit" disabled={!text.trim()}>ثبت کامنت</button>
        </form>
      )}
      {msg && <p className="err">{msg}</p>}
    </div>
  );
}

const TONE = { approved: "ok", accepted: "ok", signed: "ok", paid: "ok", verified: "ok", closed: "ok", returned: "bad", cancelled: "bad", commented: "warn" };

/** A log as a timeline, newest first. */
export function LogList({ log, showSection = false }) {
  if (!log.length) return <p className="empty-note">هنوز چیزی ثبت نشده است.</p>;
  return (
    <ol className="loglist">
      {log.map((e, i) => (
        <li key={i} data-action={e.action}>
          <span className={`pill ${TONE[e.action] || ""}`}>{e.actionFa}</span>
          <b>{e.user}</b>
          <span className="sm">{e.label}</span>
          {showSection && e.sectionFa && <span className="muted sm">[{e.sectionFa}]</span>}
          {(e.from || e.to) && <span className="muted sm">{e.from ? `از «${state(e.from)}» ` : ""}{e.to ? `به «${state(e.to)}»` : ""}</span>}
          <span className="muted sm mono">{fa(e.at)}</span>
          {e.comment && <div className="logcomment" dir="auto">{e.comment}</div>}
        </li>
      ))}
    </ol>
  );
}

// States in words: a statement's and a contract's share some names (draft); either reads the same.
const state = (k) => STATUS[k]?.split(" — ")[0] || CONTRACT_STATUS[k] || k;
const fa = (d) => (d ? new Date(d).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) : "—");
