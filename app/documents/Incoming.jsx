"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";

/**
 * What the designer sends: receipt with files, distribution to disciplines,
 * comments that stay with the document, and the coded reply.
 * Rules: lib/documents/review.mjs.
 */
const STATE = { received: "", in_review: "warn", ready: "ok", overdue: "bad", replied: "ok" };

export default function Incoming({ bar }) {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/doc-control/incoming?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null);
  const may = { dcc: can({ role }, ACTIONS.CONTROL_DOCUMENTS), review: can({ role }, ACTIONS.EDIT_EXTRACTION) };

  async function post(body) {
    setMsg(null);
    try {
      const r = await call("/api/doc-control/incoming", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return r || true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const items = data.transmittals.flatMap((t) => t.items);
  const overdue = items.filter((i) => i.state.code === "overdue").length;
  const openComments = new Set(items.flatMap((i) => i.comments.filter((c) => c.status === "open").map((c) => c.id))).size;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>کنترل مدارک</h1>
        <span className="sub">{data.transmittals.length} ترانسمیتال ورودی · {items.length} مدرک · {overdue} پاسخ معوق · {openComments} کامنت باز</span>
      </div>
      {bar}
      {msg && <p className="err">{msg}</p>}
      {data.reviewDays === null && (
        <p className="err">مهلت بررسی مدارک طراح در <a href="/project">مشخصات پروژه</a> تعیین نشده — مهلت پاسخ ترانسمیتال‌ها «نامعلوم» است و معوق شدن سنجیده نمی‌شود.</p>
      )}

      <div className="card">
        <h2>ترانسمیتال‌های ورودی از طراح</h2>
        {data.transmittals.length === 0 ? <p className="empty-note">ترانسمیتال ورودی ثبت نشده.</p> : data.transmittals.map((t) => (
          <div key={t.id} style={{ marginBottom: 14 }}>
            <p className="sm"><b className="mono">{t.transmittalNo}</b> از {t.fromParty} · {t.purpose} · ارسال {fa(t.sentOn)} · دریافت {fa(t.receivedOn)}</p>
            <TableKit name="incoming"><table className="dtable">
              <thead><tr><th>مدرک</th><th>رویژن</th><th>فایل</th><th>مهلت پاسخ</th><th>وضعیت</th><th>پاسخ</th><th /></tr></thead>
              <tbody>{t.items.map((i) => (
                <tr key={i.id}>
                  <td><span className="mono">{i.docNo}</span><div className="muted sm">{i.title}</div>
                    {i.flags.map((f) => <div key={f} className="pill warn sm" style={{ marginTop: 2 }}>{f}</div>)}</td>
                  <td className="mono">Rev.{i.revision} · {i.purpose}</td>
                  <td>{i.hasFile ? <a href={`/api/doc-control/file?projectId=${projectId}&revisionId=${i.revisionId}`} target="_blank" rel="noreferrer">{i.fileName || "فایل"}</a> : "—"}</td>
                  <td className="mono">{i.dueOn ? fa(i.dueOn) : "نامعلوم"}</td>
                  <td><span className={`pill ${STATE[i.state.code]}`}>{i.state.text}</span></td>
                  <td className="sm">{i.returnCode ? `${data.returnCodes[i.returnCode]} · ${i.replyNo} · ${fa(i.returnedOn)}` : "—"}</td>
                  <td><button className="btn ghost" onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? "بستن" : "بررسی"}</button></td>
                </tr>
              ))}</tbody>
            </table></TableKit>
            {t.items.filter((i) => i.id === open).map((i) => <ItemDetail key={i.id} i={i} projectId={projectId} post={post} may={may} />)}
            {may.dcc && t.items.some((i) => !i.returnCode) && <Fold title={`پاسخ به ${t.transmittalNo}`}><ReplyForm t={t} data={data} post={post} /></Fold>}
          </div>
        ))}
        {may.dcc && <Fold title="ثبت ترانسمیتال ورودی"><Register data={data} projectId={projectId} reload={reload} setMsg={setMsg} /></Fold>}
      </div>
    </div>
  );
}

function ItemDetail({ i, projectId, post, may }) {
  const [disc, setDisc] = useState("");
  const [c, setC] = useState({ discipline: "", ref: "", text: "" });
  const replied = !!i.returnCode;
  const openDisc = i.reviews.filter((r) => r.status === "open").map((r) => r.discipline);
  return (
    <div className="card" style={{ marginTop: 8 }}>
      <h3>{i.docNo} Rev.{i.revision}</h3>
      <p className="sm"><b>توزیع برای بررسی:</b>{" "}
        {i.reviews.length === 0 ? "هنوز توزیع نشده" : i.reviews.map((r) => (
          <span key={r.id} style={{ marginInlineEnd: 10 }}>
            <span className={`pill ${r.status === "open" ? "warn" : "ok"}`}>{r.discipline}: {r.status === "open" ? "در بررسی" : r.status === "done" ? "تمام" : `معاف — ${r.waiveReason}`}</span>
            {may.review && r.status === "open" && <button className="btn ghost" onClick={() => post({ kind: "finish", reviewId: r.id })}>پایان بررسی</button>}
          </span>
        ))}
      </p>
      {may.dcc && !replied && (
        <form style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}
              onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "assign", itemId: i.id, disciplines: disc.split(/[,،]/) })) setDisc(""); }}>
          <div className="field"><label htmlFor={`as-${i.id}`}>رشته‌های بررسی‌کننده (با ویرگول)</label>
            <input id={`as-${i.id}`} dir="auto" value={disc} onChange={(e) => setDisc(e.target.value)} placeholder="Process، Piping، Instrument" /></div>
          <button className="btn ghost">توزیع</button>
        </form>
      )}

      <h3>کامنت‌های این مدرک (همهٔ رویژن‌ها)</h3>
      {i.comments.length === 0 ? <p className="empty-note">کامنتی نیست.</p> : (
        <table className="dtable">
          <thead><tr><th>Rev</th><th>رشته</th><th>ارجاع</th><th>کامنت</th><th>پاسخ طراح</th><th>وضعیت</th></tr></thead>
          <tbody>{i.comments.map((m) => (
            <tr key={m.id}>
              <td className="mono">{m.revision}</td><td>{m.discipline}</td><td className="sm">{m.ref || "—"}</td><td>{m.text}</td>
              <td className="sm">{m.designerReply || "—"}</td>
              <td>{m.status === "open" ? (may.review ? <CloseComment m={m} itemId={i.id} post={post} /> : <span className="pill warn">باز</span>)
                : <span className="pill ok">بسته{m.closedRevision && ` در Rev.${m.closedRevision}`}</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="sm"><a href={`/api/doc-control/incoming?projectId=${projectId}&crs=${i.mdrId}`}>دریافت شیت پاسخ کامنت‌ها (CRS) — CSV</a></p>
      {may.review && !replied && openDisc.length > 0 && (
        <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "comment", itemId: i.id, ...c })) setC({ ...c, ref: "", text: "" }); }}>
          <div className="grid2">
            <div className="field"><label htmlFor={`cd-${i.id}`}>رشته</label>
              <select id={`cd-${i.id}`} value={c.discipline} onChange={(e) => setC({ ...c, discipline: e.target.value })}>
                <option value="">—</option>{openDisc.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
            <div className="field"><label htmlFor={`cr-${i.id}`}>ارجاع (شیت، بند، تگ)</label>
              <input id={`cr-${i.id}`} dir="auto" value={c.ref} onChange={(e) => setC({ ...c, ref: e.target.value })} /></div>
          </div>
          <div className="field"><label htmlFor={`ct-${i.id}`}>کامنت</label>
            <textarea id={`ct-${i.id}`} dir="auto" rows={2} value={c.text} onChange={(e) => setC({ ...c, text: e.target.value })} /></div>
          <button className="btn ghost">ثبت کامنت</button>
        </form>
      )}
    </div>
  );
}

function CloseComment({ m, itemId, post }) {
  const [reply, setReply] = useState("");
  return (
    <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      <input aria-label="پاسخ طراح" placeholder="پاسخ طراح" value={reply} onChange={(e) => setReply(e.target.value)} style={{ width: 160 }} />
      <button className="btn ghost" onClick={() => post({ kind: "close-comment", commentId: m.id, designerReply: reply, onItemId: itemId })}>بستن کامنت</button>
    </span>
  );
}

function ReplyForm({ t, data, post }) {
  const [f, setF] = useState({ replyNo: "", sentOn: new Date().toISOString().slice(0, 10) });
  const [codes, setCodes] = useState({});
  const open = t.items.filter((i) => !i.returnCode);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const list = Object.entries(codes).filter(([, c]) => c).map(([itemId, code]) => ({ itemId, code: Number(code) }));
      if (await post({ kind: "reply", incomingId: t.id, ...f, codes: list })) setCodes({});
    }}>
      <p className="muted sm">کد را شما می‌دهید؛ پلتفرم کدی را که با سابقه نمی‌خواند رد می‌کند: بررسی باز، کد ۱ با کامنت باز، کد ۲ بدون کامنت روی این رویژن، کد ۳ بدون کامنت باز.</p>
      <table className="dtable">
        <thead><tr><th>مدرک</th><th>وضعیت</th><th>کد پاسخ</th></tr></thead>
        <tbody>{open.map((i) => (
          <tr key={i.id}>
            <td className="mono">{i.docNo} Rev.{i.revision}</td><td className="sm">{i.state.text}</td>
            <td><select aria-label={`کد ${i.docNo}`} value={codes[i.id] || ""} onChange={(e) => setCodes({ ...codes, [i.id]: e.target.value })}>
              <option value="">— بعداً —</option>{Object.entries(data.returnCodes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
          </tr>
        ))}</tbody>
      </table>
      <div className="grid2">
        <Field id={`rp-no-${t.id}`} label="شمارهٔ ترانسمیتال پاسخ" value={f.replyNo} on={(v) => setF({ ...f, replyNo: v })} />
        <Field id={`rp-on-${t.id}`} label="تاریخ پاسخ" type="date" value={f.sentOn} on={(v) => setF({ ...f, sentOn: v })} />
      </div>
      <button className="btn">ثبت پاسخ</button>
    </form>
  );
}

function Register({ data, projectId, reload, setMsg }) {
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
      const res = await fetch("/api/doc-control/incoming", { method: "POST", body: form, credentials: "same-origin" });
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
        <Field id="in-from" label="فرستنده (طراح)" value={f.fromParty} on={(v) => setF({ ...f, fromParty: v })} />
        <Field id="in-sent" label="تاریخ ترانسمیتال" type="date" value={f.sentOn} on={(v) => setF({ ...f, sentOn: v })} />
        <Field id="in-recv" label="تاریخ دریافت" type="date" value={f.receivedOn} on={(v) => setF({ ...f, receivedOn: v })} />
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

const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
