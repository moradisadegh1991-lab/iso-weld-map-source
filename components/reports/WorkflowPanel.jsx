"use client";
import { useState } from "react";

import TableKit from "../ui/TableKit";
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
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto", margin: "8px 0" }} aria-label="گردش کار">
      {v.stages.map((s) => (
        <div key={s.seq} style={{ flex: "1 0 200px", border: `2px solid ${s.approved ? "var(--ok, #2e7d32)" : "var(--rule, #ccd)"}`, borderRadius: 8, position: "relative" }}>
          <div style={{ padding: "6px 10px", fontWeight: 700, background: s.approved ? "rgba(46,125,50,.12)" : undefined, borderBottom: "1px solid var(--rule, #ccd)" }}>
            {s.seq}. {s.name}
            {s.current && <span style={{ position: "absolute", top: 6, right: 8, fontSize: 11, fontWeight: 400, display: "flex", gap: 4, alignItems: "center" }}>
              <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: "#000", display: "inline-block" }} />مرحله جاری</span>}
            {s.approverName && <div className="sm muted" style={{ fontWeight: 400 }}>تأییدکنندهٔ نهایی: {s.approverName}{s.deputyName ? ` · جانشین: ${s.deputyName}` : ""}</div>}
          </div>
          <div style={{ display: "flex", gap: 6, padding: 6, flexWrap: "wrap" }}>
            {(boxes.get(s.seq)?.groups || []).map((g) => (
              <div key={g.groupId} style={{ flex: "1 0 90px", border: "1px solid var(--rule, #ccd)", borderRadius: 6, padding: 4 }}>
                <div className="sm"><b>{g.name}</b></div>
                {g.signatures.length === 0 ? <div className="sm muted">—</div> : g.signatures.map((x) => (
                  <div key={x.userId} className="sm" style={{ opacity: x.current ? 1 : 0.5 }}>✓ {x.onBehalfOf ? `از طرف ${x.onBehalfOf} — ` : ""}{x.name}</div>))}
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
  const groupName = (gid) => v.signatureBoxes.flatMap((s) => s.groups).find((g) => g.groupId === gid)?.name;
  return (
    <div className="card">
      <h2>امضا، تأیید و ارسال</h2>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {m.signFor.map((g) => <button key={g} className="btn" type="button" onClick={() => post({ kind: "sign", groupId: g }, () => "امضا شد.")}>امضا برای «{groupName(g)}»</button>)}
        {m.withdraw && <button className="btn ghost" type="button" onClick={() => post({ kind: "withdraw" }, () => "امضا لغو شد.")}>لغو امضای من</button>}
        {m.approve && <button className="btn" type="button" onClick={() => post({ kind: "approve", comment }, () => "تأیید نهایی مرحله ثبت شد؛ گزارش برای این مرحله قفل شد.")}>تأیید نهایی مرحله</button>}
      </div>
      {!m.signFor.length && !m.withdraw && !m.approve && <p className="sm muted">در مرحلهٔ فعلی امضا یا تأییدی از شما انتظار نمی‌رود. تأیید نهایی تا امضای تأییدکنندهٔ نهایی صادر نمی‌شود؛ پس از امضا، فقط با لغو امضا می‌توان دوباره ویرایش کرد.</p>}
      {(m.return || m.cancel) && (
        <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ac-c">دلیل (برای برگشت یا لغو)</label><input id="ac-c" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          {m.return && <button className="btn ghost" type="button" onClick={() => post({ kind: "return", comment }, () => "به مرحلهٔ قبل برگشت.")}>برگشت به مرحلهٔ قبل</button>}
          {m.cancel && <button className="btn ghost" type="button" style={{ color: "var(--bad)" }} onClick={() => post({ kind: "cancel", comment }, () => "گزارش لغو شد.")}>لغو گزارش</button>}
        </div>)}
      <h3 style={{ marginTop: 16 }}>ارسال برای چند کاربر</h3>
      <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <div className="field"><label htmlFor="ac-to">گیرندگان</label><select id="ac-to" multiple size={Math.min(6, users.length)} value={to} onChange={(e) => setTo([...e.target.selectedOptions].map((o) => o.value))}>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div className="field" style={{ flex: 1 }}><label htmlFor="ac-n">یادداشت</label><input id="ac-n" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button className="btn" type="button" disabled={!to.length} onClick={async () => { if (await post({ kind: "send", userIds: to, note }, (r) => `برای ${r.row} نفر ارسال شد.`)) setTo([]); }}>ارسال</button>
      </div>
    </div>
  );
}

export function History({ v }) {
  const ACT = { approved: "تأیید نهایی", returned: "برگشت", cancelled: "لغو" };
  return (
    <div className="card">
      <h2>تاریخچه</h2>
      <p className="sm muted">هر ذخیره یک نسخه است و همهٔ نسخه‌ها می‌مانند. {v.record ? `نسخهٔ ${v.record.versionNo} که در آخرین مرحله تأیید شد، سند مرجع گزارش است.` : "گزارش هنوز تأیید نهایی نشده است."}</p>
      <TableKit name="reports-workflowpanel-1" min={8}><table className="dtable"><thead><tr><th>نسخه</th><th>مرحله</th><th>ویرایشگر</th><th>زمان</th></tr></thead>
        <tbody>{v.versions.map((x) => <tr key={x.version_no} style={v.record?.versionNo === x.version_no ? { fontWeight: 700 } : undefined}>
          <td className="mono">{x.version_no}{v.record?.versionNo === x.version_no && " (مرجع)"}</td><td>{v.stages.find((s) => s.seq === x.stage_seq)?.name}</td>
          <td>{x.edited_by || "—"}</td><td className="mono sm">{new Date(x.edited_at).toLocaleString("fa-IR")}</td></tr>)}</tbody></table></TableKit>
      <h3>تصمیم‌ها</h3>
      {v.decisions.length === 0 ? <p className="empty-note">—</p> : <TableKit name="reports-workflowpanel-2" min={8}><table className="dtable"><thead><tr><th>مرحله</th><th>تصمیم</th><th>نسخه</th><th>توسط</th><th>توضیح</th><th>زمان</th></tr></thead>
        <tbody>{v.decisions.map((d, i) => <tr key={i}><td>{v.stages.find((s) => s.seq === d.stageSeq)?.name}</td><td>{ACT[d.action]}</td><td className="mono">{d.versionNo}</td>
          <td>{d.by}</td><td className="sm">{d.comment || "—"}</td><td className="mono sm">{new Date(d.at).toLocaleString("fa-IR")}</td></tr>)}</tbody></table></TableKit>}
    </div>
  );
}

