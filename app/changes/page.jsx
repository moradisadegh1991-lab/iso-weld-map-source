"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import Tabs from "../../components/ui/Tabs";
import Fold from "../../components/ui/Fold";
import FormNo from "../../components/ui/FormNo";
import { localToday, DayHint } from "../../components/ui/WorkDate";

import TableKit from "../../components/ui/TableKit";
/**
 * Work outside the contract, and the changes behind it.
 *
 *   TQ           the site asks the designer; the designer answers in its
 *                portal; an engineer closes it — no change, or a change
 *   تغییر سایت    a site-run line, a field change or an as-built deviation:
 *                approved by an engineer other than who raised it; the
 *                designer puts it on the drawing (as-built revision); closed
 *                once that revision is in the MDR
 *   دستور کار     work a contract does not cover: prepared, issued by someone
 *                else, and paid as a variation item of the contract
 */
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
const TONE = { open: "warn", answered: "warn", closed: "ok", raised: "warn", approved: "warn", rejected: "bad", asbuilt_submitted: "warn",
  draft: "", issued: "warn", completed: "ok", cancelled: "bad" };

export default function ChangesPage() {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/changes?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  async function post(body) {
    setMsg(null);
    try { await call("/api/changes", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); return true; }
    catch (e) { setMsg(e.message); return false; }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const open = { tq: data.tqs.filter((t) => t.status !== "closed").length, fcr: data.changes.filter((c) => !["closed", "rejected"].includes(c.status)).length,
    wo: data.workOrders.filter((w) => ["draft", "issued"].includes(w.status)).length };

  return (
    <div className="page">
      <div className="pagehead"><h1>دستور کار، TQ و تغییرات سایت</h1>
        <span className="sub">{open.tq} TQ باز · {open.fcr} تغییر باز · {open.wo} دستور کار در جریان</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      <Tabs name="changes">
        <TqCard data={data} post={post} />
        <ChangeCard data={data} post={post} />
        <WoCard data={data} post={post} />
      </Tabs>
    </div>
  );
}

function TqCard({ data, post }) {
  const blank = { tqNo: "", subject: "", question: "", proposal: "", mdrDocumentId: "", lineId: "", raisedOn: localToday(), replyDue: "" };
  const [f, setF] = useState(blank);
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="card">
      <h2>پرسش‌های فنی (TQ)</h2>
      {data.may.raise && (
        <Fold title="TQ جدید">
          <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "tq", ...f, mdrDocumentId: f.mdrDocumentId || null, lineId: f.lineId || null, replyDue: f.replyDue || null })) setF(blank); }}>
            <div className="grid2">
              <FormNo id="tq-no" form="tq" label="شمارهٔ TQ" value={f.tqNo} on={(v) => setF({ ...f, tqNo: v })} />
              <div className="field"><label htmlFor="tq-s">موضوع</label><input id="tq-s" value={f.subject} onChange={on("subject")} required /></div>
              <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="tq-q">پرسش</label><textarea id="tq-q" rows={2} value={f.question} onChange={on("question")} required /></div>
              <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="tq-p">پیشنهاد سایت (اختیاری)</label><input id="tq-p" value={f.proposal} onChange={on("proposal")} /></div>
              <div className="field"><label htmlFor="tq-d">مدرک / نقشه</label><select id="tq-d" value={f.mdrDocumentId} onChange={on("mdrDocumentId")}><option value="">—</option>
                {data.docs.map((d) => <option key={d.id} value={d.id}>{d.doc_no} — {d.title}</option>)}</select></div>
              <div className="field"><label htmlFor="tq-l">خط</label><select id="tq-l" value={f.lineId} onChange={on("lineId")}><option value="">—</option>
                {data.lines.map((l) => <option key={l.id} value={l.id}>{l.line_no}</option>)}</select></div>
              <div className="field"><label htmlFor="tq-on">تاریخ</label><input id="tq-on" type="date" dir="ltr" max={localToday()} value={f.raisedOn} onChange={on("raisedOn")} /><DayHint date={f.raisedOn} /></div>
              <div className="field"><label htmlFor="tq-due">مهلت پاسخ طراح</label><input id="tq-due" type="date" dir="ltr" value={f.replyDue} onChange={on("replyDue")} /></div>
            </div>
            <button className="btn" type="submit">ثبت TQ</button>
          </form>
        </Fold>
      )}
      {data.tqs.length === 0 ? <p className="empty-note">TQ ثبت نشده است.</p> : (
        <TableKit name="changes-1"><table className="dtable" data-tqs>
          <thead><tr><th>شماره</th><th>موضوع</th><th>مدرک</th><th>وضعیت</th><th>پاسخ طراح</th><th>نتیجه</th>{data.may.decide && <th />}</tr></thead>
          <tbody>{data.tqs.map((t) => (
            <tr key={t.id} data-tq={t.tq_no}>
              <td className="mono">{t.tq_no}</td><td>{t.subject}<div className="muted sm">{t.question}</div></td>
              <td className="mono sm">{t.doc_no || t.line_no || "—"}</td>
              <td><span className={`pill ${TONE[t.status]}`}>{t.statusFa}</span>{t.overdue && <span className="pill bad"> مهلت گذشته</span>}</td>
              <td className="sm">{t.answer ? <>{t.answer}<div className="muted sm">{t.answered_name} · {fa(t.answered_on)}</div></> : "—"}</td>
              <td className="sm">{t.outcomeFa || "—"}</td>
              {data.may.decide && <td>{t.status === "answered" && <span style={{ display: "flex", gap: 4 }}>
                <button className="btn ghost" type="button" onClick={() => post({ kind: "tq-close", tqId: t.id, outcome: "no_change" })}>بستن: بدون تغییر</button>
                <button className="btn" type="button" onClick={() => post({ kind: "tq-close", tqId: t.id, outcome: "change_required" })}>بستن: تغییر لازم است</button>
              </span>}</td>}
            </tr>
          ))}</tbody>
        </table></TableKit>
      )}
    </div>
  );
}

function ChangeCard({ data, post }) {
  const blank = { fcrNo: "", changeKind: "site_run", title: "", description: "", reason: "", tqId: "", mdrDocumentId: "", lineId: "", raisedOn: localToday() };
  const [f, setF] = useState(blank);
  const [note, setNote] = useState({});
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const changeTqs = data.tqs.filter((t) => t.status === "closed" && t.outcome === "change_required");
  return (
    <div className="card">
      <h2>تغییرات سایت (سایت‌ران، تغییر در سایت، As-built)</h2>
      {data.may.raise && (
        <Fold title="ثبت تغییر سایت">
          <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "change", ...f, tqId: f.tqId || null, mdrDocumentId: f.mdrDocumentId || null, lineId: f.lineId || null })) setF(blank); }}>
            <div className="grid2">
              <FormNo id="fc-no" form="site_change" label="شمارهٔ تغییر" value={f.fcrNo} on={(v) => setF({ ...f, fcrNo: v })} />
              <div className="field"><label htmlFor="fc-k">نوع</label><select id="fc-k" value={f.changeKind} onChange={on("changeKind")}>
                {Object.entries(data.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div className="field"><label htmlFor="fc-t">عنوان</label><input id="fc-t" value={f.title} onChange={on("title")} required /></div>
              <div className="field"><label htmlFor="fc-q">TQ مبنا (اختیاری)</label><select id="fc-q" value={f.tqId} onChange={on("tqId")}><option value="">—</option>
                {changeTqs.map((t) => <option key={t.id} value={t.id}>{t.tq_no} — {t.subject}</option>)}</select></div>
              <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="fc-d">شرح</label><textarea id="fc-d" rows={2} value={f.description} onChange={on("description")} required /></div>
              <div className="field"><label htmlFor="fc-m">نقشه‌ای که باید As-built شود</label><select id="fc-m" value={f.mdrDocumentId} onChange={on("mdrDocumentId")}><option value="">—</option>
                {data.docs.map((d) => <option key={d.id} value={d.id}>{d.doc_no} — {d.title}</option>)}</select></div>
              <div className="field"><label htmlFor="fc-l">خط</label><select id="fc-l" value={f.lineId} onChange={on("lineId")}><option value="">—</option>
                {data.lines.map((l) => <option key={l.id} value={l.id}>{l.line_no}</option>)}</select></div>
              <div className="field"><label htmlFor="fc-r">دلیل</label><input id="fc-r" value={f.reason} onChange={on("reason")} /></div>
              <div className="field"><label htmlFor="fc-on">تاریخ</label><input id="fc-on" type="date" dir="ltr" max={localToday()} value={f.raisedOn} onChange={on("raisedOn")} /><DayHint date={f.raisedOn} /></div>
            </div>
            <button className="btn" type="submit">ثبت تغییر</button>
          </form>
        </Fold>
      )}
      {data.changes.length === 0 ? <p className="empty-note">تغییری ثبت نشده است.</p> : (
        <TableKit name="changes-2"><table className="dtable" data-changes>
          <thead><tr><th>شماره</th><th>نوع</th><th>عنوان</th><th>نقشه</th><th>وضعیت</th><th>As-built طراح</th>{data.may.decide && <th />}</tr></thead>
          <tbody>{data.changes.map((c) => (
            <tr key={c.id} data-fcr={c.fcr_no}>
              <td className="mono">{c.fcr_no}{c.tq_no && <div className="muted sm">{c.tq_no}</div>}</td><td className="sm">{c.kindFa}</td>
              <td>{c.title}<div className="muted sm">{c.description}</div></td><td className="mono sm">{c.doc_no || "—"}</td>
              <td><span className={`pill ${TONE[c.status]}`}>{c.statusFa}</span>{c.decision_note && <div className="muted sm">{c.decision_note}</div>}</td>
              <td className="sm">{c.asbuilt_revision ? `Rev.${c.asbuilt_revision} · ${fa(c.asbuilt_on)}` : "—"}</td>
              {data.may.decide && <td>
                {c.status === "raised" && <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <button className="btn" type="button" onClick={() => post({ kind: "change-decide", changeId: c.id, decision: "approve" })}>تأیید</button>
                  <input aria-label={`دلیل رد ${c.fcr_no}`} placeholder="دلیل رد…" value={note[c.id] || ""} onChange={(e) => setNote({ ...note, [c.id]: e.target.value })} style={{ width: 130 }} />
                  <button className="btn ghost" type="button" disabled={!(note[c.id] || "").trim()} onClick={() => post({ kind: "change-decide", changeId: c.id, decision: "reject", note: note[c.id] })}>رد</button>
                </span>}
                {c.status === "asbuilt_submitted" && <button className="btn" type="button" onClick={() => post({ kind: "change-close", changeId: c.id })}>بستن (As-built در MDR)</button>}
              </td>}
            </tr>
          ))}</tbody>
        </table></TableKit>
      )}
    </div>
  );
}

function WoCard({ data, post }) {
  const blank = { woNo: "", contractId: "", title: "", description: "", origin: "site_change", tqId: "", siteChangeId: "", accountId: "", unit: "", qty: "", rate: "" };
  const [f, setF] = useState(blank);
  const [when, setWhen] = useState(localToday());
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const money = (v) => Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <div className="card">
      <h2>دستور کار (کار خارج از قرارداد)</h2>
      {data.may.prepareWo && (
        <Fold title="دستور کار جدید">
          <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "wo", ...f, tqId: f.tqId || null, siteChangeId: f.siteChangeId || null, accountId: f.accountId || null })) setF(blank); }}>
            <div className="grid2">
              <FormNo id="wo-no" form="work_order" label="شمارهٔ دستور کار" value={f.woNo} on={(v) => setF({ ...f, woNo: v })} />
              <div className="field"><label htmlFor="wo-c">قرارداد (امضاشده)</label><select id="wo-c" value={f.contractId} onChange={on("contractId")} required><option value="">—</option>
                {data.contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} — {c.contractor || c.title}</option>)}</select></div>
              <div className="field"><label htmlFor="wo-t">عنوان</label><input id="wo-t" value={f.title} onChange={on("title")} required /></div>
              <div className="field"><label htmlFor="wo-o">منشأ</label><select id="wo-o" value={f.origin} onChange={on("origin")}>
                {Object.entries(data.origins).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              {f.origin === "tq" && <div className="field"><label htmlFor="wo-q">TQ</label><select id="wo-q" value={f.tqId} onChange={on("tqId")} required><option value="">—</option>
                {data.tqs.filter((t) => t.outcome === "change_required").map((t) => <option key={t.id} value={t.id}>{t.tq_no} — {t.subject}</option>)}</select></div>}
              {f.origin === "site_change" && <div className="field"><label htmlFor="wo-s">تغییر سایت</label><select id="wo-s" value={f.siteChangeId} onChange={on("siteChangeId")} required><option value="">—</option>
                {data.changes.filter((c) => ["approved", "asbuilt_submitted", "closed"].includes(c.status)).map((c) => <option key={c.id} value={c.id}>{c.fcr_no} — {c.title}</option>)}</select></div>}
              <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="wo-d">شرح کار</label><textarea id="wo-d" rows={2} value={f.description} onChange={on("description")} required /></div>
              <div className="field"><label htmlFor="wo-w">عنصر WBS</label><select id="wo-w" value={f.accountId} onChange={on("accountId")}><option value="">—</option>
                {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.title}</option>)}</select></div>
              <div className="field"><label htmlFor="wo-u">واحد</label><input id="wo-u" value={f.unit} onChange={on("unit")} required /></div>
              <div className="field"><label htmlFor="wo-qty">مقدار</label><input id="wo-qty" type="number" step="any" dir="ltr" value={f.qty} onChange={on("qty")} required /></div>
              <div className="field"><label htmlFor="wo-r">بهای واحد (توافق‌شده)</label><input id="wo-r" type="number" step="any" dir="ltr" value={f.rate} onChange={on("rate")} required /></div>
            </div>
            <button className="btn" type="submit">ثبت پیش‌نویس</button>
          </form>
        </Fold>
      )}
      {data.workOrders.length === 0 ? <p className="empty-note">دستور کاری ثبت نشده است.</p> : (
        <>
          {(data.may.issueWo || data.may.prepareWo) && <div className="field" style={{ maxWidth: 220 }}><label htmlFor="wo-when">تاریخ ابلاغ / انجام</label>
            <input id="wo-when" type="date" dir="ltr" max={localToday()} value={when} onChange={(e) => setWhen(e.target.value)} /><DayHint date={when} /></div>}
          <TableKit name="changes-3"><table className="dtable" data-wos>
            <thead><tr><th>شماره</th><th>قرارداد</th><th>کار</th><th>منشأ</th><th>مقدار × بها</th><th>WBS</th><th>تأییدشده در صورت وضعیت</th><th>وضعیت</th><th /></tr></thead>
            <tbody>{data.workOrders.map((w) => (
              <tr key={w.id} data-wo={w.wo_no}>
                <td className="mono">{w.wo_no}</td><td className="mono sm">{w.contract_no}<div className="muted sm">{w.contractor}</div></td>
                <td>{w.title}<div className="muted sm">{w.description}</div></td>
                <td className="sm">{w.originFa}{w.tq_no ? ` ${w.tq_no}` : ""}{w.fcr_no ? ` ${w.fcr_no}` : ""}</td>
                <td className="mono sm">{w.qty} {w.unit} × {money(w.rate)} = {money(w.amount)}</td><td className="mono sm">{w.wbs || "—"}</td>
                <td className="mono sm">{w.certified_qty ?? "—"}</td>
                <td><span className={`pill ${TONE[w.status]}`}>{w.statusFa}</span>{w.issued_name && <div className="muted sm">ابلاغ: {w.issued_name} · {fa(w.issued_on)}</div>}</td>
                <td>{w.status === "draft" && data.may.issueWo && <button className="btn" type="button" onClick={() => post({ kind: "wo-issue", workOrderId: w.id, issuedOn: when })}>ابلاغ به پیمانکار</button>}
                  {w.status === "issued" && data.may.prepareWo && <button className="btn ghost" type="button" onClick={() => post({ kind: "wo-complete", workOrderId: w.id, completedOn: when })}>انجام شد</button>}</td>
              </tr>
            ))}</tbody>
          </table></TableKit>
          <p className="muted sm">ابلاغ یک دستور کار، ردیف پرداخت «{`WO-…`}» با روش صورت‌جلسه و روی همان WBS به قرارداد اضافه می‌کند؛ صورت وضعیت بعدی آن را اندازه می‌گیرد و پرداخت می‌کند.</p>
        </>
      )}
    </div>
  );
}
