"use client";
import { useState } from "react";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { useTreeDrag } from "../../components/ui/treeDrag";

/**
 * The contract's EPS: its PMSs, and under each the versions of its
 * schedule. A version is dragged onto another PMS to move there, or above
 * or below another version to change the order; a PMS likewise among the
 * PMSs. Each version's WBS opens from here.
 */
const fmt = (v) => (v == null || v === "" ? "—" : Number(v).toLocaleString("fa-IR", { maximumFractionDigits: 2 }));
const day = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("fa-IR") : "—");
const BLANK_PMS = { id: null, code: "", title: "", registeredOn: "", planStart: "", planEnd: "", actualStart: "", actualEnd: "" };
const BLANK_VER = { id: null, pmsId: "", code: "", title: "", description: "", registeredOn: "", startOn: "", endOn: "", budgetPlan: "", budgetActual: "" };
const span = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1 : null);

export default function EpsPage() {
  const { projectId, contractId, contract, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => (contractId ? `/api/eps?projectId=${id}&contractId=${contractId}` : null), [contractId]);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [pf, setPf] = useState(null);
  const [vf, setVf] = useState(null);
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/eps", { method: "POST", body: JSON.stringify({ projectId, contractId, ...body }) }); reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  const dnd = useTreeDrag((d, t, zone) => {
    if (d.kind === "pms") post({ kind: "eps-move", epsKind: "pms", id: d.id, [zone === "before" ? "beforeId" : "afterId"]: t.id }, () => "ترتیب PMSها تغییر کرد.");
    else if (t.kind === "pms") post({ kind: "eps-move", epsKind: "version", id: d.id, pmsId: t.id }, () => `نسخه به PMS ${t.code} رفت.`);
    else post({ kind: "eps-move", epsKind: "version", id: d.id, pmsId: t.pmsId, [zone === "before" ? "beforeId" : "afterId"]: t.id }, () => "ترتیب نسخه‌ها تغییر کرد.");
  }, {
    inside: (d, t) => d.kind === "version" && t.kind === "pms",
    sibling: (d, t) => d.kind === t.kind,
  });
  if (!contractId) return <div className="page"><div className="pagehead"><h1>EPS و PMS</h1></div><p className="empty-note">قرارداد را از فهرست بالای صفحه انتخاب کنید.</p></div>;
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const may = data.may.edit;
  const pmsRow = (p) => (
    <tr key={p.id} data-pms={p.code} {...(may ? { ...dnd.source({ id: p.id, kind: "pms" }), ...dnd.target({ id: p.id, kind: "pms", code: p.code }) } : {})}
      style={{ background: "var(--surf2, #f5f7f9)", cursor: may ? "grab" : undefined, ...dnd.look({ id: p.id }) }}>
      <td><b>{may && <span className="muted" aria-hidden="true">⠿ </span>}▾ <span className="mono">{p.code}</span></b></td><td><b>{p.title}</b></td>
      <td className="mono sm">{day(p.registered_on)}</td>
      <td className="mono sm">{day(p.plan_start)} — {day(p.plan_end)}</td><td className="mono">{fmt(p.planDays)}</td>
      <td className="mono sm">{day(p.actual_start)} — {day(p.actual_end)}</td><td className="mono">{fmt(p.actualDays)}</td>
      <td className="mono">{p.versions.length}</td>
      <td style={{ whiteSpace: "nowrap" }}>{may && <>
        <button className="btn ghost sm" type="button" onClick={() => { setVf({ ...BLANK_VER, pmsId: p.id, code: `${p.code}-R${p.versions.length + 1}` }); setPf(null); }}>+ نسخه</button>
        <button className="btn ghost sm" type="button" onClick={() => { setPf({ id: p.id, code: p.code, title: p.title, registeredOn: p.registered_on || "", planStart: p.plan_start || "",
          planEnd: p.plan_end || "", actualStart: p.actual_start || "", actualEnd: p.actual_end || "" }); setVf(null); }}>ویرایش</button>
        <button className="btn ghost sm" type="button" onClick={() => post({ kind: "eps-remove", epsKind: "pms", id: p.id }, () => "حذف شد.")}>حذف</button></>}</td>
    </tr>);
  const versionRow = (p, v) => (
    <tr key={v.id} data-version={v.code} {...(may ? { ...dnd.source({ id: v.id, kind: "version" }), ...dnd.target({ id: v.id, kind: "version", pmsId: p.id }) } : {})}
      style={{ cursor: may ? "grab" : undefined, ...dnd.look({ id: v.id }) }}>
      <td style={{ paddingInlineStart: 28 }}>{may && <span className="muted" aria-hidden="true">⠿ </span>}<span className="mono">{v.code}</span></td>
      <td>{v.title}{v.description && <div className="sm muted">{v.description}</div>}</td>
      <td className="mono sm">{day(v.registered_on)}</td>
      <td className="mono sm">{day(v.start_on)} — {day(v.end_on)}</td><td className="mono">{fmt(v.days)}</td>
      <td className="sm" colSpan={2}>بودجه: {fmt(v.budget_plan)} / واقعی {fmt(v.budget_actual)}</td>
      <td className="mono">{v.nodes} گره</td>
      <td style={{ whiteSpace: "nowrap" }}>
        <Link className="btn sm" href={`/eps/wbs?version=${v.id}`}>WBS</Link>
        {may && <>
          <button className="btn ghost sm" type="button" onClick={() => { setVf({ id: v.id, pmsId: p.id, code: v.code, title: v.title, description: v.description || "", registeredOn: v.registered_on || "",
            startOn: v.start_on || "", endOn: v.end_on || "", budgetPlan: v.budget_plan ?? "", budgetActual: v.budget_actual ?? "" }); setPf(null); }}>ویرایش</button>
          <button className="btn ghost sm" type="button" onClick={() => post({ kind: "eps-remove", epsKind: "version", id: v.id }, () => "حذف شد.")}>حذف</button></>}</td>
    </tr>);
  const F = (st, set, k, l, type = "text", extra = {}) => (
    <div className="field" key={k}><label htmlFor={`ep-${k}`}>{l}</label>
      <input id={`ep-${k}`} type={type} dir={type === "text" && k !== "title" && k !== "description" ? "ltr" : undefined} value={st[k] ?? ""} onChange={(e) => set({ ...st, [k]: e.target.value })} {...extra} /></div>);
  return (
    <div className="page">
      <div className="pagehead"><h1>EPS و PMS</h1>
        <span className="sub">قرارداد {contract?.contract_no} — {contract?.title} · PMSها و نسخه‌های برنامهٔ زمان‌بندی؛ با کشیدن و رها کردن جابه‌جا و مرتب می‌شوند</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      {may && !pf && !vf && <p><button className="btn" type="button" onClick={() => setPf({ ...BLANK_PMS })}>+ PMS تازه</button></p>}
      {pf && (
        <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "pms", ...pf }, (r) => `PMS ${r.row.code} ذخیره شد.`)) setPf(null); }}>
          <h2>{pf.id ? `ویرایش PMS ${pf.code}` : "PMS تازه"}</h2>
          <div className="grid2">
            {F(pf, setPf, "code", "کد PMS", "text", { required: true, placeholder: "PM01" })}{F(pf, setPf, "title", "عنوان PMS", "text", { required: true })}
            {F(pf, setPf, "registeredOn", "تاریخ ثبت (خالی: امروز)", "date")}
            {F(pf, setPf, "planStart", "تاریخ شروع برنامه‌ای", "date")}{F(pf, setPf, "planEnd", "تاریخ پایان برنامه‌ای", "date")}
            {F(pf, setPf, "actualStart", "تاریخ شروع واقعی", "date")}{F(pf, setPf, "actualEnd", "تاریخ پایان واقعی", "date")}
          </div>
          <p className="sm muted">مدت برنامه‌ای: <b>{fmt(span(pf.planStart, pf.planEnd))}</b> روز · مدت واقعی: <b>{fmt(span(pf.actualStart, pf.actualEnd))}</b> روز (محاسبه‌شده)</p>
          <button className="btn" type="submit">ذخیره</button> <button className="btn ghost" type="button" onClick={() => setPf(null)}>انصراف</button>
        </form>)}
      {vf && (
        <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "version", ...vf }, (r) => `نسخهٔ ${r.row.code} ذخیره شد.`)) setVf(null); }}>
          <h2>{vf.id ? `ویرایش نسخهٔ ${vf.code}` : `نسخهٔ تازه برای ${data.pms.find((p) => p.id === vf.pmsId)?.code}`}</h2>
          <div className="grid2">
            {F(vf, setVf, "code", "کد نسخه", "text", { required: true })}{F(vf, setVf, "title", "عنوان نسخه", "text", { required: true })}
            {F(vf, setVf, "description", "شرح نسخه")}{F(vf, setVf, "registeredOn", "تاریخ ثبت (خالی: امروز)", "date")}
            {F(vf, setVf, "startOn", "تاریخ شروع نسخه", "date")}{F(vf, setVf, "endOn", "تاریخ پایان نسخه", "date")}
            {F(vf, setVf, "budgetPlan", "بودجهٔ برنامه‌ای (ریشهٔ WBS)", "text", { inputMode: "decimal" })}{F(vf, setVf, "budgetActual", "بودجهٔ واقعی", "text", { inputMode: "decimal" })}
          </div>
          <button className="btn" type="submit">ذخیره</button> <button className="btn ghost" type="button" onClick={() => setVf(null)}>انصراف</button>
        </form>)}
      <div className="card">
        <h2>EPS قرارداد</h2>
        {data.pms.length === 0 ? <p className="empty-note">هنوز PMSی تعریف نشده است.</p> : (
          <div className="tablewrap"><table className="dtable">
            <thead><tr><th>کد</th><th>عنوان</th><th>تاریخ ثبت</th><th>برنامه‌ای (شروع — پایان)</th><th>مدت</th><th>واقعی (شروع — پایان)</th><th>مدت واقعی</th><th>نسخه / گره</th><th /></tr></thead>
            <tbody>{data.pms.flatMap((p) => [pmsRow(p), ...p.versions.map((v) => versionRow(p, v))])}</tbody></table></div>)}
        {may && data.pms.length > 0 && <p className="sm muted">نسخه را روی یک PMS رها کنید تا به آن برود؛ بالا یا پایین یک نسخه یا PMS رها کنید تا ترتیب عوض شود.</p>}
      </div>
    </div>
  );
}
