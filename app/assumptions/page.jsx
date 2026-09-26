"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import { STATUSES } from "../../lib/db/repos/assumptions.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import Tabs from "../../components/ui/Tabs";

/**
 * What the project does not know, and what it has assumed.
 *
 * The top half is computed: every fact the engines refuse to judge without,
 * with how many items wait on it and where it is entered. It cannot drift
 * from the engines because it reads the same data. The bottom half is the
 * assumption register — statements the design depends on, each with an
 * owner, a status and a history (Master Plan §2.51–2.53).
 */
const IMPACT = { high: ["bad", "بالا"], medium: ["", "متوسط"], low: ["", "کم"] };
const STATUS_PILL = { approved: "ok", rejected: "bad", superseded: "", under_review: "", proposed: "", unknown: "bad" };

export default function AssumptionsPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/assumptions?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null);
  const [history, setHistory] = useState(null);
  const mayEdit = can({ role }, ACTIONS.EDIT_EXTRACTION);
  const mayDecide = can({ role }, ACTIONS.APPROVE_REGISTER);

  async function post(body) {
    setMsg(null);
    try {
      const r = await call("/api/assumptions", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      if (open) setHistory((await call(`/api/assumptions?projectId=${projectId}&assumptionId=${open}`)).history);
      return r || true;
    } catch (e) { setMsg(e.message); return false; }
  }
  async function toggle(id) {
    if (open === id) { setOpen(null); setHistory(null); return; }
    setOpen(id); setHistory(null);
    try { setHistory((await call(`/api/assumptions?projectId=${projectId}&assumptionId=${id}`)).history); }
    catch (e) { setMsg(e.message); }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const high = data.missing.filter((m) => m.impact === "high");
  const approved = data.assumptions.filter((a) => a.status === "approved").length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>فرضیات و اطلاعات ناقص</h1>
        <span className="sub">
          {data.missing.length} اطلاع ناقص ({high.length} مانع حکم) · {data.assumptions.length} فرض ({approved} تأییدشده)
        </span>
      </div>
      {msg && <p className="err">{msg}</p>}

      <Tabs name="assumptions">
      <div className="card">
        <h2>اطلاعات ناقص (UNKNOWN)</h2>
        <p className="muted sm">
          از همان داده‌ای حساب می‌شود که موتورها با آن حکم می‌دهند؛ هر ردیف یعنی سامانه به‌جای حدس زدن، منتظر این عدد مانده است.
        </p>
        {data.missing.length === 0 ? <p className="empty-note">چیزی منتظر اطلاعات نیست.</p> : (
          <TableKit name="assumptions">
            <table className="dtable">
              <thead><tr><th>اطلاعات لازم</th><th>رشتهٔ مسئول</th><th>اثر</th><th>منتظر</th><th>چرا</th><th /></tr></thead>
              <tbody>
                {data.missing.map((m) => (
                  <tr key={m.key}>
                    <td className="sm"><b>{m.title}</b></td>
                    <td className="sm">{m.discipline}</td>
                    <td><span className={"pill " + IMPACT[m.impact][0]}>{IMPACT[m.impact][1]}</span></td>
                    <td className="mono">{m.count} {m.unit}</td>
                    <td className="sm muted">{m.why}</td>
                    <td><a className="btn ghost" style={{ padding: "4px 10px" }} href={m.fixAt}>ثبت</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ marginInlineEnd: "auto" }}>ثبت فرضیات پروژه</h2>
          {mayEdit && (
            <button className="btn ghost" style={{ padding: "4px 10px" }} onClick={() => post({ kind: "baseline" })}>
              افزودن فرضیات پایهٔ Master Plan</button>
          )}
        </div>
        <p className="muted sm">
          فرض، دادهٔ تأییدشدهٔ پروژه نیست. تغییر هر فرض یک رویژن جدید است و تأیید قبلی را به «در دست بررسی» برمی‌گرداند.
        </p>
        {data.assumptions.length === 0 ? <p className="empty-note">هنوز فرضی ثبت نشده است.</p> : (
          <TableKit name="assumptions">
            <table className="dtable">
              <thead><tr><th>کد</th><th>دسته</th><th>شرح</th><th>مقدار</th><th>مالک</th><th>اثر</th><th>وضعیت</th><th>Rev</th><th /></tr></thead>
              <tbody>
                {data.assumptions.map((a) => (
                  <Row key={a.id} a={a} open={open === a.id} history={open === a.id ? history : null}
                       onToggle={() => toggle(a.id)} mayEdit={mayEdit} mayDecide={mayDecide} post={post} />
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
        {mayEdit && <Fold title="پیشنهاد فرض جدید"><Propose post={post} /></Fold>}
      </div>
      </Tabs>
    </div>
  );
}

function Row({ a, open, history, onToggle, mayEdit, mayDecide, post }) {
  return (
    <>
      <tr>
        <td className="mono">{a.code}</td>
        <td className="sm">{a.category}</td>
        <td className="sm">{a.description}</td>
        <td className="mono sm">{a.value || "—"}</td>
        <td className="sm">{a.owner || "—"}</td>
        <td><span className={"pill " + IMPACT[a.impact][0]}>{IMPACT[a.impact][1]}</span></td>
        <td><span className={"pill " + (STATUS_PILL[a.status] || "")}>{STATUSES[a.status]}</span>
          {a.decided_by_name && <div className="muted sm">{a.decided_by_name}</div>}</td>
        <td className="mono">{a.revision}</td>
        <td><button className="btn ghost" style={{ padding: "4px 10px" }} onClick={onToggle}>{open ? "بستن" : "جزئیات"}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} style={{ background: "rgba(255,255,255,.02)" }}>
            <Detail a={a} history={history} mayEdit={mayEdit} mayDecide={mayDecide} post={post} />
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ a, history, mayEdit, mayDecide, post }) {
  const [f, setF] = useState({ description: a.description, value: a.value || "", source: a.source || "",
    owner: a.owner || "", impact: a.impact, risk: a.risk || "", reason: "" });
  const [why, setWhy] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p className="sm muted">منبع: {a.source || "—"}{a.risk && <> · اگر نادرست باشد: {a.risk}</>}</p>
      {mayDecide && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input className="search" placeholder="دلیل (برای رد / جایگزینی / بازبینی الزامی)" value={why}
                 onChange={(e) => setWhy(e.target.value)} style={{ maxWidth: 320 }} aria-label="دلیل" />
          {a.status !== "approved" && <button className="btn" style={{ padding: "4px 10px" }}
            onClick={() => post({ kind: "decide", assumptionId: a.id, status: "approved", reason: why || null })}>تأیید</button>}
          {a.status !== "rejected" && <button className="btn ghost" style={{ padding: "4px 10px" }}
            onClick={() => post({ kind: "decide", assumptionId: a.id, status: "rejected", reason: why })}>رد</button>}
          {a.status !== "superseded" && <button className="btn ghost" style={{ padding: "4px 10px" }}
            onClick={() => post({ kind: "decide", assumptionId: a.id, status: "superseded", reason: why })}>جایگزین‌شده</button>}
          {a.status !== "under_review" && <button className="btn ghost" style={{ padding: "4px 10px" }}
            onClick={() => post({ kind: "decide", assumptionId: a.id, status: "under_review", reason: why })}>بازگشت به بررسی</button>}
        </div>
      )}
      {mayEdit && (
        <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
          e.preventDefault();
          const { reason, ...patch } = f;
          await post({ kind: "revise", assumptionId: a.id, patch, reason });
        }}>
          <Field id="rv-desc" label="شرح" value={f.description} on={(v) => setF({ ...f, description: v })} />
          <Field id="rv-val" label="مقدار" value={f.value} on={(v) => setF({ ...f, value: v })} />
          <Field id="rv-src" label="منبع" value={f.source} on={(v) => setF({ ...f, source: v })} />
          <Field id="rv-own" label="مالک" value={f.owner} on={(v) => setF({ ...f, owner: v })} />
          <Field id="rv-risk" label="اگر نادرست باشد چه می‌شود" value={f.risk} on={(v) => setF({ ...f, risk: v })} />
          <Field id="rv-why" label="دلیل تغییر (الزامی)" value={f.reason} on={(v) => setF({ ...f, reason: v })} required
                 hint={a.status === "approved" ? "تغییر محتوا، فرض را به «در دست بررسی» برمی‌گرداند" : null} />
          <div><button className="btn ghost" type="submit">ثبت رویژن جدید</button></div>
        </form>
      )}
      {history && history.length > 0 && (
        <TableKit name="assumptions">
          <table className="dtable">
            <thead><tr><th>Rev</th><th>وضعیت</th><th>مقدار</th><th>دلیل تغییر بعدی</th><th>توسط</th><th>زمان</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.revision}>
                  <td className="mono">{h.revision}</td>
                  <td className="sm">{STATUSES[h.snapshot.status]}</td>
                  <td className="mono sm">{h.snapshot.value || "—"}</td>
                  <td className="sm">{h.reason || "—"}</td>
                  <td className="sm">{h.changed_by_name || "—"}</td>
                  <td className="mono sm">{new Date(h.changed_at).toLocaleString("fa-IR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
    </div>
  );
}

function Propose({ post }) {
  const blank = { category: "", description: "", value: "", source: "", owner: "", impact: "medium", risk: "" };
  const [f, setF] = useState(blank);
  return (
    <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "propose", ...f })) setF(blank); }}>
      <h2>فرض جدید</h2>
      <div className="grid2">
        <Field id="pa-cat" label="دسته" value={f.category} on={(v) => setF({ ...f, category: v })} required />
        <Field id="pa-desc" label="شرح" value={f.description} on={(v) => setF({ ...f, description: v })} required />
        <Field id="pa-val" label="مقدار" value={f.value} on={(v) => setF({ ...f, value: v })} />
        <Field id="pa-src" label="منبع" value={f.source} on={(v) => setF({ ...f, source: v })} hint="مدرک، جلسه، یا Master Plan" />
        <Field id="pa-own" label="مالک (رشته / نقش)" value={f.owner} on={(v) => setF({ ...f, owner: v })} />
        <div className="field"><label htmlFor="pa-imp">اثر</label>
          <select id="pa-imp" value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value })}>
            <option value="high">بالا</option><option value="medium">متوسط</option><option value="low">کم</option>
          </select></div>
        <Field id="pa-risk" label="اگر نادرست باشد چه می‌شود" value={f.risk} on={(v) => setF({ ...f, risk: v })} />
      </div>
      <div><button className="btn" type="submit" disabled={!f.category || !f.description}>ثبت (پیشنهادی)</button></div>
    </form>
  );
}

function Field({ id, label, value, on, required, hint }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} dir="auto" required={required} value={value} onChange={(e) => on(e.target.value)} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}
