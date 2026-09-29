"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import TableKit from "../../../components/ui/TableKit";
import Tabs from "../../../components/ui/Tabs";
import Fold from "../../../components/ui/Fold";
import SubmitForm from "../SubmitForm";
import { DesignerTqs, DesignerAsBuilt } from "./DesignerChanges";

/**
 * The designer portal: the designer's side of document control, and all a
 * designer account can open. Its documents on the register, the
 * transmittals it sent with the project's code on each item once replied,
 * and the comments the project returned — each answered here, in the
 * designer's own name. The project's internal review (who is reviewing,
 * comments not yet sent back) is not on this page and not in its data.
 */
const STATE = { under_review: ["warn", "در بررسی پروژه"], overdue: ["bad", "مهلت پاسخ پروژه گذشته"], replied: ["ok", "پاسخ داده شد"] };

export default function DesignerPortal() {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/doc-control/designer?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);

  async function reply(commentId, text) {
    setMsg(null);
    try {
      await call("/api/doc-control/designer", { method: "POST", body: JSON.stringify({ projectId, kind: "reply", commentId, reply: text }) });
      reload(); return true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const items = data.transmittals.flatMap((t) => t.items);
  const waiting = items.filter((i) => !i.returnCode).length;
  const toAnswer = data.comments.filter((c) => c.status === "open" && !c.designerReply).length;
  const rejected = items.filter((i) => i.returnCode === 3).length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>پرتال طراح</h1>
        <span className="sub">{data.transmittals.length} ترانسمیتال ارسالی · {items.length} رویژن</span>
      </div>
      {msg && <p className="err" role="alert">{msg}</p>}

      <div className="kpis">
        <Kpi v={waiting} l="منتظر پاسخ پروژه" tone={waiting ? "warn" : ""} />
        <Kpi v={toAnswer} l="کامنت بی‌پاسخ" b="برگشته از پروژه" tone={toAnswer ? "bad" : "ok"} />
        <Kpi v={rejected} l="رد شده (کد ۳)" b="ارسال مجدد لازم" tone={rejected ? "bad" : ""} />
      </div>

      <Tabs name="designer">
        <div className="card">
          <h2>کامنت‌های برگشتی</h2>
          <p className="muted sm">کامنت‌هایی که پروژه با ترانسمیتال پاسخ برای شما فرستاده است. پاسخ هر کامنت را همین‌جا بنویسید؛ بستن آن با بررسی‌کنندهٔ پروژه است. تا بسته نشده، پاسخ قابل اصلاح است.</p>
          {data.comments.length === 0 ? <p className="empty-note">کامنتی برای شما برنگشته است.</p> : (
            <TableKit name="designer-comments">
              <table className="dtable">
                <thead><tr><th>مدرک</th><th>Rev</th><th>رشته</th><th>ارجاع</th><th>کامنت</th><th>پاسخ شما</th><th>وضعیت</th></tr></thead>
                <tbody>{data.comments.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.docNo}<div className="muted sm">{c.returnedIn}</div></td>
                    <td className="mono">{c.revision}</td>
                    <td className="sm">{c.discipline}</td>
                    <td className="sm">{c.ref || "—"}</td>
                    <td>{c.text}</td>
                    <td>{c.status === "open" ? <ReplyBox c={c} onSave={reply} /> : <span className="sm">{c.designerReply}</span>}</td>
                    <td>{c.status === "open"
                      ? <span className={`pill ${c.designerReply ? "warn" : "bad"}`}>{c.designerReply ? "پاسخ داده شد — منتظر بستن" : "بی‌پاسخ"}</span>
                      : <span className="pill ok">بسته{c.closedRevision && ` در Rev.${c.closedRevision}`}</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </TableKit>
          )}
        </div>

        <div className="card">
          <h2>ترانسمیتال‌های ارسالی</h2>
          {data.reviewDays === null && <p className="muted sm">مهلت بررسی پروژه اعلام نشده — «مهلت پاسخ» نامعلوم است.</p>}
          {data.transmittals.length === 0 ? <p className="empty-note">هنوز ترانسمیتالی نفرستاده‌اید.</p> : data.transmittals.map((t) => (
            <div key={t.id} style={{ marginBottom: 14 }}>
              <p className="sm"><b className="mono">{t.transmittalNo}</b> · {t.fromParty} · {t.purpose} · تاریخ {fa(t.sentOn)} · تحویل {fa(t.receivedOn)}</p>
              <TableKit name="designer-transmittals">
                <table className="dtable">
                  <thead><tr><th>مدرک</th><th>رویژن</th><th>فایل</th><th>مهلت پاسخ پروژه</th><th>وضعیت</th><th>کد پاسخ</th><th /></tr></thead>
                  <tbody>{t.items.map((i) => (
                    <tr key={i.id}>
                      <td><span className="mono">{i.docNo}</span><div className="muted sm">{i.title}</div>
                        {i.flags.map((f) => <div key={f} className="pill warn sm" style={{ marginTop: 2 }}>{f}</div>)}</td>
                      <td className="mono">Rev.{i.revision} · {i.purpose}</td>
                      <td>{i.hasFile ? <a href={`/api/doc-control/file?projectId=${projectId}&revisionId=${i.revisionId}`} target="_blank" rel="noreferrer">{i.fileName || "فایل"}</a> : "—"}</td>
                      <td className="mono">{i.dueOn ? fa(i.dueOn) : "نامعلوم"}</td>
                      <td><span className={`pill ${STATE[i.state][0]}`}>{STATE[i.state][1]}</span></td>
                      <td className="sm">{i.returnCode ? `${data.returnCodes[i.returnCode]} · ${i.replyNo} · ${fa(i.returnedOn)}` : "—"}</td>
                      <td>{i.returnCode && <a className="sm" href={`/api/doc-control/designer?projectId=${projectId}&crs=${i.mdrId}`}>CRS</a>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </TableKit>
            </div>
          ))}
          <Fold title="ارسال ترانسمیتال"><SubmitForm data={data} projectId={projectId} reload={reload} setMsg={setMsg} /></Fold>
        </div>

        <div className="card">
          <h2>مدارک رجیستر (MDR)</h2>
          <p className="muted sm">فهرست مدارکی که پروژه از شما انتظار دارد، با آخرین رویژن ارسالی و آخرین کد پاسخ.</p>
          {data.documents.length === 0 ? <p className="empty-note">مدرکی در رجیستر نیست.</p> : (
            <TableKit name="designer-mdr">
              <table className="dtable">
                <thead><tr><th>شمارهٔ مدرک</th><th>عنوان</th><th>رشته</th><th>نوع</th><th>آخرین رویژن</th><th>آخرین کد</th></tr></thead>
                <tbody>{data.documents.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{d.docNo}</td><td>{d.title}</td><td className="sm">{d.discipline || "—"}</td><td className="sm">{d.type || "—"}</td>
                    <td className="mono">{d.latest || <span className="muted">ارسال نشده</span>}</td>
                    <td className="sm">{d.lastCode ? data.returnCodes[d.lastCode] : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </TableKit>
          )}
        </div>
        <DesignerTqs />
        <DesignerAsBuilt />
      </Tabs>
    </div>
  );
}

function ReplyBox({ c, onSave }) {
  const [text, setText] = useState(c.designerReply || "");
  return (
    <form style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
          onSubmit={async (e) => { e.preventDefault(); await onSave(c.id, text); }}>
      <input aria-label={`پاسخ ${c.docNo} ${c.ref || ""}`} dir="auto" value={text} onChange={(e) => setText(e.target.value)} style={{ minWidth: 200 }} />
      <button className="btn ghost" type="submit" disabled={!text.trim() || text === c.designerReply}>{c.designerReply ? "اصلاح پاسخ" : "ثبت پاسخ"}</button>
    </form>
  );
}

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}

const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
