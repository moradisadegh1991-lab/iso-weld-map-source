"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import Tabs from "../../components/ui/Tabs";

import TableKit from "../../components/ui/TableKit";
/**
 * Work the contractor hands over and the employer accepts.
 *
 * With the project's approval on, every step a contractor-side member
 * records as done — a spool erected, a pump set, a cable pulled — arrives
 * here as a claim. It counts nowhere (progress, EV, payment statements, MC)
 * until someone who signs for the employer approves it; rejected, it stays
 * open with the reason, for the contractor to put right and claim again.
 */
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
const DISC = { equipment: "تجهیزات/سیویل/سازه", piping: "پایپینگ", electrical: "برق", instrumentation: "ابزار دقیق", coating: "رنگ و عایق" };

export default function WorkApprovalPage() {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/work?projectId=${id}`, []);
  const [picked, setPicked] = useState(new Set());
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState(null);
  const key = (x) => `${x.table}:${x.id}`;

  async function post(body) {
    setMsg(null);
    try { await call("/api/work", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); setPicked(new Set()); setReason(""); reload(); }
    catch (e) { setMsg(e.message); }
  }
  const decide = (decision, items) => post({ kind: "decide", decision, reason, items: items.map((x) => ({ table: x.table, id: x.id })) });

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const pending = data.pending;
  const chosen = pending.filter((x) => picked.has(key(x)));
  const toggle = (x) => setPicked((s) => { const n = new Set(s); n.has(key(x)) ? n.delete(key(x)) : n.add(key(x)); return n; });

  return (
    <div className="page">
      <div className="pagehead"><h1>تحویل کار پیمانکار</h1>
        <span className="sub">{data.enabled ? `${pending.length} مورد منتظر تأیید کارفرما` : "تأیید کارفرما خاموش است"}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}

      <div className="card" data-keep>
        <p className="sm" style={{ margin: 0 }}>
          {data.enabled
            ? "روشن: هر مرحله‌ای که عضوی از طرف پیمانکار «انجام شد» ثبت کند، پیش‌نویس (اعلام انجام) است و تا تأیید نمایندهٔ کارفرما در پیشرفت، EV، صورت وضعیت و MC شمرده نمی‌شود. ثبت خود نمایندهٔ کارفرما مستقیم است."
            : "خاموش: ثبت هر عضو همان لحظه قطعی است. با روشن کردن، ثبت‌های طرف پیمانکار تا تأیید کارفرما پیش‌نویس می‌مانند."}
        </p>
        {data.me.canSet && (
          <label className="sm" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
            <input type="checkbox" checked={data.enabled} onChange={(e) => post({ kind: "setting", enabled: e.target.checked })} />
            کار پیمانکار پیش از قطعی شدن، تأیید کارفرما لازم دارد
          </label>
        )}
      </div>

      <Tabs name="work-approval">
        <div className="card">
          <h2>منتظر تأیید کارفرما</h2>
          {pending.length === 0 ? <p className="empty-note">موردی منتظر تأیید نیست.</p> : (
            <>
              <TableKit name="work-approval-1"><table className="dtable" data-claims>
                <thead><tr>{data.me.canDecide && <th><input type="checkbox" aria-label="انتخاب همه"
                  checked={chosen.length === pending.length} onChange={(e) => setPicked(e.target.checked ? new Set(pending.map(key)) : new Set())} /></th>}
                  <th>رشته</th><th>آیتم</th><th>مرحله</th><th>تاریخ اعلام انجام</th><th>مرجع</th><th>پیمانکار</th><th>اعلام‌کننده</th>
                  {data.me.canDecide && <th />}</tr></thead>
                <tbody>{pending.map((x) => (
                  <tr key={key(x)} data-claim={`${x.item} ${x.step}`}>
                    {data.me.canDecide && <td><input type="checkbox" aria-label={`انتخاب ${x.item} ${x.step}`} checked={picked.has(key(x))}
                      disabled={x.claimantId === data.me.id} onChange={() => toggle(x)} /></td>}
                    <td className="sm">{DISC[x.discipline] || x.discipline}</td><td className="mono">{x.item}</td><td>{x.step}</td>
                    <td className="mono sm">{fa(x.claimedOn)}</td><td className="mono sm">{x.refNo || "—"}</td>
                    <td className="sm">{x.contractor || "—"}</td><td className="sm">{x.claimant || "—"}</td>
                    {data.me.canDecide && <td>{x.claimantId === data.me.id ? <span className="muted sm">اعلام خودتان</span>
                      : <button className="btn ghost" type="button" onClick={() => decide("approve", [x])}>تأیید</button>}</td>}
                  </tr>
                ))}</tbody>
              </table></TableKit>
              {data.me.canDecide ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                  <button className="btn" type="button" disabled={!chosen.length} onClick={() => decide("approve", chosen)}>تأیید {chosen.length || ""} مورد انتخاب‌شده</button>
                  <input aria-label="دلیل رد" placeholder="دلیل رد (برای پیمانکار)…" value={reason} onChange={(e) => setReason(e.target.value)} style={{ minWidth: 240 }} />
                  <button className="btn ghost" type="button" disabled={!chosen.length || !reason.trim()} onClick={() => decide("reject", chosen)}>رد</button>
                </div>
              ) : <p className="muted sm">تأیید یا رد با عضوی است که از طرف کارفرما امضا می‌کند (پروژه › کاربران و دسترسی › طرف بازرسی: کارفرما).</p>}
            </>
          )}
        </div>

        <div className="card">
          <h2>تصمیم‌های کارفرما</h2>
          {data.decided.length === 0 ? <p className="empty-note">هنوز تصمیمی ثبت نشده است.</p> : (
            <TableKit name="work-approval-2"><table className="dtable">
              <thead><tr><th>آیتم</th><th>مرحله</th><th>تصمیم</th><th>توسط</th><th>تاریخ کار</th><th>دلیل</th></tr></thead>
              <tbody>{data.decided.map((x) => (
                <tr key={key(x)}><td className="mono">{x.item}</td><td>{x.step}</td>
                  <td>{x.approver ? <span className="pill ok">تأیید</span> : <span className="pill bad">رد</span>}</td>
                  <td className="sm">{x.approver || x.rejecter}</td><td className="mono sm">{fa(x.doneAt)}</td><td className="sm">{x.reason || ""}</td></tr>
              ))}</tbody>
            </table></TableKit>
          )}
        </div>
      </Tabs>
    </div>
  );
}
