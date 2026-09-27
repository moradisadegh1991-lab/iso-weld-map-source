"use client";
import { useState } from "react";

/**
 * The designer's transmittal: its number, date and the revisions it carries,
 * each with its file. Sent whole or not at all (lib/db/repos/incoming.mjs).
 */
export default function SubmitForm({ data, projectId, reload, setMsg }) {
  const today = new Date().toISOString().slice(0, 10);
  const blankRow = { docNo: "", title: "", revision: "", purpose: "IFA", file: null };
  const [f, setF] = useState({ transmittalNo: "", fromParty: "", sentOn: today, receivedOn: today, purpose: "" });
  const [rows, setRows] = useState([{ ...blankRow }]);
  const [busy, setBusy] = useState(false);
  const setRow = (k, patch) => setRows(rows.map((r, j) => (j === k ? { ...r, ...patch } : r)));
  async function submit(e) {
    e.preventDefault();
    setMsg(null); setBusy(true);
    const form = new FormData();
    form.set("meta", JSON.stringify({ projectId, ...f, items: rows.map(({ file, ...r }) => r) }));
    rows.forEach((r, k) => { if (r.file) form.set(`file_${k}`, r.file); });
    try {
      const res = await fetch("/api/doc-control/designer", { method: "POST", body: form, credentials: "same-origin" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `پاسخ ${res.status}`);
      setRows([{ ...blankRow }]); setF({ ...f, transmittalNo: "" });
      reload();
    } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit}>
      <div className="grid2">
        <Field id="in-no" label="شمارهٔ ترانسمیتال طراح" value={f.transmittalNo} on={(v) => setF({ ...f, transmittalNo: v })} />
        <Field id="in-from" label="فرستنده (نام شرکت طراح)" value={f.fromParty} on={(v) => setF({ ...f, fromParty: v })} />
        <Field id="in-sent" label="تاریخ ترانسمیتال" type="date" value={f.sentOn} on={(v) => setF({ ...f, sentOn: v })} />
        <Field id="in-recv" label="تاریخ تحویل به پروژه" type="date" value={f.receivedOn} on={(v) => setF({ ...f, receivedOn: v })} />
        <Field id="in-purpose" label="هدف ارسال" value={f.purpose} on={(v) => setF({ ...f, purpose: v })} />
      </div>
      <table className="dtable">
        <thead><tr><th>شمارهٔ مدرک</th><th>عنوان (اگر در MDR نیست)</th><th>رویژن</th><th>هدف</th><th>فایل</th><th /></tr></thead>
        <tbody>{rows.map((r, k) => (
          <tr key={k}>
            <td><input aria-label={`مدرک ${k + 1}`} dir="ltr" value={r.docNo} onChange={(e) => setRow(k, { docNo: e.target.value })} /></td>
            <td><input aria-label={`عنوان ${k + 1}`} dir="auto" value={r.title} onChange={(e) => setRow(k, { title: e.target.value })} /></td>
            <td><input aria-label={`رویژن ${k + 1}`} dir="ltr" style={{ width: 60 }} value={r.revision} onChange={(e) => setRow(k, { revision: e.target.value })} /></td>
            <td><select aria-label={`هدف ${k + 1}`} value={r.purpose} onChange={(e) => setRow(k, { purpose: e.target.value })}>
              {Object.entries(data.purposes).map(([p, t]) => <option key={p} value={p}>{t}</option>)}</select></td>
            <td><input aria-label={`فایل ${k + 1}`} type="file" onChange={(e) => setRow(k, { file: e.target.files?.[0] || null })} /></td>
            <td>{rows.length > 1 && <button type="button" className="btn ghost" onClick={() => setRows(rows.filter((_, j) => j !== k))}>حذف</button>}</td>
          </tr>
        ))}</tbody>
      </table>
      <p><button type="button" className="btn ghost" onClick={() => setRows([...rows, { ...blankRow }])}>ردیف دیگر</button>{" "}
        <button className="btn" disabled={busy}>{busy ? "در حال ثبت…" : "ثبت ترانسمیتال"}</button></p>
      <p className="muted sm">کل ترانسمیتال با هم ثبت می‌شود یا هیچ‌کدام. فایلی که عیناً همان فایل رویژن قبلی باشد رد می‌شود؛ مدرکِ خارج از MDR با برچسب ثبت می‌شود.</p>
    </form>
  );
}

function Field({ id, label, value, on, type = "text" }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} dir={type === "text" ? "auto" : "ltr"} value={value} onChange={(e) => on(e.target.value)} />
    </div>
  );
}
