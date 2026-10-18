"use client";
import { useState } from "react";

import TableKit from "../ui/TableKit";
import { usePrefs } from "../../lib/client/prefs.mjs";
/**
 * A staged report's workflow on screen, shared by every report kind (the
 * contract's daily report, handover forms): the stages side by side with
 * their groups' signatures, the actions the caller may take now, and the
 * history of versions and decisions. Each takes the report's view
 * (`v`: stages, signatureBoxes, may, versions, decisions, record) and,
 * for actions, `post(body, done)` that sends to the report kind's own route.
 */
/** 6.5: the stages side by side — title (green once approved), the current one marked; under each, its groups and their signatures. */
export function Workflow({ v }) {
  const boxes = new Map(v.signatureBoxes.map((b) => [b.stageSeq, b]));
  const { t } = usePrefs();
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto", margin: "8px 0" }} aria-label={t("wf.label")}>
      {v.stages.map((s) => (
        <div key={s.seq} style={{ flex: "1 0 200px", border: `2px solid ${s.approved ? "var(--ok, #2e7d32)" : "var(--rule, #ccd)"}`, borderRadius: 8, position: "relative" }}>
          <div style={{ padding: "6px 10px", fontWeight: 700, background: s.approved ? "rgba(46,125,50,.12)" : undefined, borderBottom: "1px solid var(--rule, #ccd)" }}>
            {s.seq}. {s.name}
            {s.current && <span data-current-stage style={{ position: "absolute", top: 6, insetInlineEnd: 8, fontSize: 11, fontWeight: 400, display: "flex", gap: 4, alignItems: "center" }}>
              <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: "#000", display: "inline-block" }} />{t("wf.current")}</span>}
            {s.approverName && <div className="sm muted" style={{ fontWeight: 400 }}>{t("wf.approver", { name: s.approverName })}{s.deputyName ? t("wf.deputy", { name: s.deputyName }) : ""}</div>}
          </div>
          <div style={{ display: "flex", gap: 6, padding: 6, flexWrap: "wrap" }}>
            {(boxes.get(s.seq)?.groups || []).map((g) => (
              <div key={g.groupId} style={{ flex: "1 0 90px", border: "1px solid var(--rule, #ccd)", borderRadius: 6, padding: 4 }}>
                <div className="sm"><b>{g.name}</b></div>
                {g.signatures.length === 0 ? <div className="sm muted">—</div> : g.signatures.map((x) => (
                  <div key={x.userId} className="sm" style={{ opacity: x.current ? 1 : 0.5 }}>✓ {x.onBehalfOf ? t("wf.onBehalf", { name: x.onBehalfOf }) : ""}{x.name}</div>))}
              </div>))}
          </div>
        </div>))}
    </div>
  );
}

export function Actions({ v, users, post }) {
  const [comment, setComment] = useState("");
  const [to, setTo] = useState([]);
  const [note, setNote] = useState("");
  const m = v.may;
  const { t } = usePrefs();
  const groupName = (gid) => v.signatureBoxes.flatMap((s) => s.groups).find((g) => g.groupId === gid)?.name;
  return (
    <div className="card">
      <h2>{t("wf.actions")}</h2>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {m.signFor.map((g) => <button key={g} className="btn" type="button" onClick={() => post({ kind: "sign", groupId: g }, () => t("wf.signed"))}>{t("wf.signFor", { group: groupName(g) })}</button>)}
        {m.withdraw && <button className="btn ghost" type="button" onClick={() => post({ kind: "withdraw" }, () => t("wf.withdrawn"))}>{t("wf.withdraw")}</button>}
        {m.approve && <button className="btn" type="button" onClick={() => post({ kind: "approve", comment }, () => t("wf.approved"))}>{t("wf.approve")}</button>}
      </div>
      {!m.signFor.length && !m.withdraw && !m.approve && <p className="sm muted">{t("wf.nothing")}</p>}
      {(m.return || m.cancel) && (
        <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ac-c">{t("wf.reason")}</label><input id="ac-c" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          {m.return && <button className="btn ghost" type="button" onClick={() => post({ kind: "return", comment }, () => t("wf.returned"))}>{t("wf.return")}</button>}
          {m.cancel && <button className="btn ghost" type="button" style={{ color: "var(--bad)" }} onClick={() => post({ kind: "cancel", comment }, () => t("wf.cancelled"))}>{t("wf.cancel")}</button>}
        </div>)}
      <h3 style={{ marginTop: 16 }}>{t("wf.send")}</h3>
      <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <div className="field"><label htmlFor="ac-to">{t("wf.to")}</label><select id="ac-to" multiple size={Math.min(6, users.length)} value={to} onChange={(e) => setTo([...e.target.selectedOptions].map((o) => o.value))}>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div className="field" style={{ flex: 1 }}><label htmlFor="ac-n">{t("wf.note")}</label><input id="ac-n" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button className="btn" type="button" disabled={!to.length} onClick={async () => { if (await post({ kind: "send", userIds: to, note }, (r) => t("wf.sent", { n: r.row }))) setTo([]); }}>{t("wf.sendBtn")}</button>
      </div>
    </div>
  );
}

export function History({ v }) {
  const { t, dateTime } = usePrefs();
  return (
    <div className="card">
      <h2>{t("wf.history")}</h2>
      <p className="sm muted">{t("wf.versionsNote")}{v.record ? t("wf.record", { n: v.record.versionNo }) : t("wf.noRecord")}</p>
      <TableKit name="reports-workflowpanel-1" min={8}><table className="dtable"><thead><tr><th>{t("wf.h.version")}</th><th>{t("wf.h.stage")}</th><th>{t("wf.h.editor")}</th><th>{t("wf.h.time")}</th></tr></thead>
        <tbody>{v.versions.map((x) => <tr key={x.version_no} style={v.record?.versionNo === x.version_no ? { fontWeight: 700 } : undefined}>
          <td className="mono">{x.version_no}{v.record?.versionNo === x.version_no && t("wf.recordMark")}</td><td>{v.stages.find((s) => s.seq === x.stage_seq)?.name}</td>
          <td>{x.edited_by || "—"}</td><td className="mono sm">{dateTime(x.edited_at)}</td></tr>)}</tbody></table></TableKit>
      <h3>{t("wf.decisions")}</h3>
      {v.decisions.length === 0 ? <p className="empty-note">—</p> : <TableKit name="reports-workflowpanel-2" min={8}><table className="dtable"><thead><tr><th>{t("wf.h.stage")}</th><th>{t("wf.h.decision")}</th><th>{t("wf.h.version")}</th><th>{t("wf.h.by")}</th><th>{t("wf.h.comment")}</th><th>{t("wf.h.time")}</th></tr></thead>
        <tbody>{v.decisions.map((d, i) => <tr key={i}><td>{v.stages.find((s) => s.seq === d.stageSeq)?.name}</td><td>{t(`wf.act.${d.action}`)}</td><td className="mono">{d.versionNo}</td>
          <td>{d.by}</td><td className="sm">{d.comment || "—"}</td><td className="mono sm">{dateTime(d.at)}</td></tr>)}</tbody></table></TableKit>}
    </div>
  );
}

