"use client";
import { useState } from "react";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { useTreeDrag } from "../../components/ui/treeDrag";

import TableKit from "../../components/ui/TableKit";
/**
 * The contract's EPS: its PMSs, and under each the versions of its
 * schedule. A version is dragged onto another PMS to move there, or above
 * or below another version to change the order; a PMS likewise among the
 * PMSs. Each version's WBS opens from here. One version of each PMS may be
 * its master plan (the baseline the delay claim is measured against).
 */
const fmt = (v) => (v == null || v === "" ? "—" : Number(v).toLocaleString("fa-IR", { maximumFractionDigits: 2 }));
const day = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("fa-IR") : "—");
const BLANK_PMS = { id: null, code: "", title: "", pmsType: "", description: "", registeredOn: "", planStart: "", planEnd: "", actualStart: "", actualEnd: "" };
const BLANK_VER = { id: null, pmsId: "", code: "", title: "", description: "", registeredOn: "", startOn: "", endOn: "", budgetPlan: "", budgetActual: "" };
const span = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1 : null);

export default function EpsPage() {
  const { projectId, contractId, contract, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => (contractId ? `/api/eps?projectId=${id}&contractId=${contractId}` : null), [contractId]);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [pf, setPf] = useState(null);
  const [vf, setVf] = useState(null);
  const [imp, setImp] = useState(null);
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
      <td><b>{may && <span className="muted" aria-hidden="true">⠿ </span>}▾ <span className="mono">{p.code}</span></b></td>
      <td><b>{p.title}</b>{p.pms_type && <span className="chip" style={{ marginInlineStart: 6 }}>{p.pms_type}</span>}{p.description && <div className="sm muted">{p.description}</div>}</td>
      <td className="mono sm">{day(p.registered_on)}</td>
      <td className="mono sm">{day(p.plan_start)} — {day(p.plan_end)}</td><td className="mono">{fmt(p.planDays)}</td>
      <td className="mono sm">{day(p.actual_start)} — {day(p.actual_end)}</td><td className="mono">{fmt(p.actualDays)}</td>
      <td className="mono">{p.versions.length}</td>
      <td style={{ whiteSpace: "nowrap" }}>{may && <>
        <button className="btn ghost sm" type="button" onClick={() => { setVf({ ...BLANK_VER, pmsId: p.id, code: `${p.code}-R${p.versions.length + 1}` }); setPf(null); }}>+ نسخه</button>
        <button className="btn ghost sm" type="button" onClick={() => { setPf({ id: p.id, code: p.code, title: p.title, pmsType: p.pms_type || "", description: p.description || "", registeredOn: p.registered_on || "", planStart: p.plan_start || "",
          planEnd: p.plan_end || "", actualStart: p.actual_start || "", actualEnd: p.actual_end || "" }); setVf(null); }}>ویرایش</button>
        <button className="btn ghost sm" type="button" onClick={() => post({ kind: "eps-remove", epsKind: "pms", id: p.id }, () => "حذف شد.")}>حذف</button></>}</td>
    </tr>);
  const versionRow = (p, v) => (
    <tr key={v.id} data-version={v.code} {...(may ? { ...dnd.source({ id: v.id, kind: "version" }), ...dnd.target({ id: v.id, kind: "version", pmsId: p.id }) } : {})}
      style={{ cursor: may ? "grab" : undefined, ...dnd.look({ id: v.id }) }}>
      <td style={{ paddingInlineStart: 28 }}>{may && <span className="muted" aria-hidden="true">⠿ </span>}<span className="mono">{v.code}</span>
        {v.master && <span className="chip" style={{ marginInlineStart: 6, borderColor: "var(--ok, #1e8449)", color: "var(--ok, #1e8449)" }} data-master={v.code}>Master plan</span>}</td>
      <td>{v.title}{v.description && <div className="sm muted">{v.description}</div>}</td>
      <td className="mono sm">{day(v.registered_on)}</td>
      <td className="mono sm">{day(v.start_on)} — {day(v.end_on)}</td><td className="mono">{fmt(v.days)}</td>
      <td className="sm" colSpan={2}>بودجه: {fmt(v.budget_plan)} / واقعی {fmt(v.budget_actual)}</td>
      <td className="mono">{v.nodes} گره</td>
      <td style={{ whiteSpace: "nowrap" }}>
        <Link className="btn sm" href={`/eps/wbs?version=${v.id}`}>WBS</Link>
        <Link className="btn ghost sm" href={`/eps/activities?version=${v.id}`}>فعالیت‌ها</Link>
        {may && <label className="sm" style={{ marginInline: 6, whiteSpace: "nowrap" }} title="فقط یک نسخه از هر PMS برنامهٔ اصلی است">
          <input type="radio" name={`master-${p.id}`} checked={!!v.master} aria-label={`برنامهٔ اصلی ${v.code}`}
            onChange={() => post({ kind: "version-master", id: v.id, master: true }, () => `نسخهٔ ${v.code} برنامهٔ اصلی (Master plan) PMS ${p.code} شد.`)} /> Master</label>}
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
      {may && !pf && !vf && <p><button className="btn" type="button" onClick={() => setPf({ ...BLANK_PMS })}>+ PMS تازه</button>{" "}
        {data.pms.length > 0 && <button className="btn ghost" type="button" data-import-open onClick={() => setImp({ pmsId: data.pms[0].id, versionCode: "", fileKind: "mspdi", file: null })}>ورود برنامه از فایل (MS Project / PMS اکسل)</button>}</p>}
      {imp && <ImportPlan data={data} imp={imp} setImp={setImp} projectId={projectId} done={(m) => { setImp(null); setOk(m); reload(); }} fail={setMsg} />}
      {pf && (
        <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "pms", ...pf }, (r) => `PMS ${r.row.code} ذخیره شد.`)) setPf(null); }}>
          <h2>{pf.id ? `ویرایش PMS ${pf.code}` : "PMS تازه"}</h2>
          <div className="grid2">
            {F(pf, setPf, "code", "کد PMS", "text", { required: true, placeholder: "PM01" })}{F(pf, setPf, "title", "عنوان PMS", "text", { required: true })}
            <div className="field"><label htmlFor="ep-pmsType">نوع PMS</label>
              <input id="ep-pmsType" dir="ltr" list="pms-types" value={pf.pmsType} onChange={(e) => setPf({ ...pf, pmsType: e.target.value })} placeholder="Level 3" />
              <datalist id="pms-types">{(data.labels.pmsTypes || []).map((t) => <option key={t} value={t} />)}</datalist></div>
            {F(pf, setPf, "description", "شرح PMS")}
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
          <div className="tablewrap"><TableKit name="eps-1"><table className="dtable">
            <thead><tr><th>کد</th><th>عنوان</th><th>تاریخ ثبت</th><th>برنامه‌ای (شروع — پایان)</th><th>مدت</th><th>واقعی (شروع — پایان)</th><th>مدت واقعی</th><th>نسخه / گره</th><th /></tr></thead>
            <tbody>{data.pms.flatMap((p) => [pmsRow(p), ...p.versions.map((v) => versionRow(p, v))])}</tbody></table></TableKit></div>)}
        {may && data.pms.length > 0 && <p className="sm muted">نسخه را روی یک PMS رها کنید تا به آن برود؛ بالا یا پایین یک نسخه یا PMS رها کنید تا ترتیب عوض شود.
          از نسخه‌های هر PMS فقط یکی «Master plan» است؛ انتخاب نسخهٔ دیگر آن را جابه‌جا می‌کند.</p>}
      </div>
    </div>
  );
}

/**
 * A plan file as a new version of a PMS: the MS Project schedule (Save As ◄
 * XML) or the PMS workbook. The plan lives in the EPS — there is no second
 * schedule page beside it. What was imported before (into the old «برنامه و
 * PMS» page) is carried over from here too, without the file.
 */
function ImportPlan({ data, imp, setImp, projectId, done, fail }) {
  const [busy, setBusy] = useState(false);
  const pms = data.pms.find((p) => p.id === imp.pmsId);
  async function send(e) {
    e.preventDefault(); setBusy(true); fail(null);
    try {
      const form = new FormData();
      for (const [k, v] of Object.entries({ projectId, kind: "import-plan", pmsId: imp.pmsId, versionCode: imp.versionCode, fileKind: imp.fileKind })) form.set(k, v);
      form.set("file", imp.file);
      const res = await fetch("/api/eps", { method: "POST", body: form, credentials: "same-origin" });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || `پاسخ ${res.status}`);
      const r = b.row;
      done(`نسخهٔ ${r.version.code}: ${r.nodes} گره، ${r.activities} فعالیت، ${r.relations} رابطه.${r.problems.length ? ` · ${r.problems.length} نکته: ${r.problems.slice(0, 3).join(" · ")}` : ""}`);
    } catch (e2) { fail(e2.message); } finally { setBusy(false); }
  }
  async function convert(source, importId, label) {
    const code = imp.versionCode;
    if (!code) { fail("کد نسخهٔ تازه را بالا بنویسید."); return; }
    setBusy(true); fail(null);
    try {
      const res = await fetch("/api/eps", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, kind: "convert-legacy", pmsId: imp.pmsId, versionCode: code, source, importId }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || `پاسخ ${res.status}`);
      done(`نسخهٔ ${b.row.version.code} از «${label}» ساخته شد: ${b.row.nodes} گره، ${b.row.activities} فعالیت.`);
    } catch (e2) { fail(e2.message); } finally { setBusy(false); }
  }
  const legacy = data.legacy || { schedules: [], pms: [] };
  return (
    <form className="card" onSubmit={send} data-import-plan>
      <h2>ورود برنامه از فایل</h2>
      <p className="sm muted">برنامه نسخهٔ تازه‌ای از یک PMS این قرارداد می‌شود: تسک‌های خلاصه گرهٔ WBS، تسک‌های زیرشان فعالیت و پیوندها رابطه.
        W.F فقط از ستون WF فایل خوانده می‌شود و پیشرفت اعلام‌شده تا ثبت گزارش روزانه می‌ماند. نسخه خودکار Master نمی‌شود.</p>
      <div className="grid2">
        <div className="field"><label htmlFor="im-pms">PMS</label>
          <select id="im-pms" value={imp.pmsId} onChange={(e) => setImp({ ...imp, pmsId: e.target.value })}>
            {data.pms.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.title}</option>)}</select></div>
        <div className="field"><label htmlFor="im-code">کد نسخهٔ تازه</label>
          <input id="im-code" dir="ltr" required value={imp.versionCode} placeholder={`${pms?.code || "PM01"}-R${(pms?.versions.length || 0) + 1}`}
            onChange={(e) => setImp({ ...imp, versionCode: e.target.value })} /></div>
        <div className="field"><label htmlFor="im-kind">نوع فایل</label>
          <select id="im-kind" value={imp.fileKind} onChange={(e) => setImp({ ...imp, fileKind: e.target.value })}>
            <option value="mspdi">MS Project (XML — Save As ◄ XML Format)</option>
            <option value="pms">PMS اکسل (گام‌ها با ستون CC)</option></select></div>
        <div className="field"><label htmlFor="im-file">فایل</label>
          <input id="im-file" type="file" required accept={imp.fileKind === "mspdi" ? ".xml" : ".xlsx,.xls"} onChange={(e) => setImp({ ...imp, file: e.target.files?.[0] || null })} /></div>
      </div>
      <button className="btn" type="submit" disabled={busy || !imp.file || !imp.versionCode}>{busy ? "در حال ورود…" : "ورود به‌عنوان نسخهٔ تازه"}</button>{" "}
      <button className="btn ghost" type="button" onClick={() => setImp(null)}>انصراف</button>
      {(legacy.schedules.length > 0 || legacy.pms.length > 0) && (
        <div style={{ marginTop: 12 }} data-legacy>
          <h3>ورودی‌های قبلی (صفحهٔ قدیمی «برنامه و PMS»)</h3>
          <p className="sm muted">این فایل‌ها پیش از یکی شدن برنامه‌ها وارد شده‌اند. با «کد نسخهٔ تازه» بالا، هر کدام را به نسخه‌ای از PMS انتخاب‌شده تبدیل کنید؛ فایل لازم نیست.</p>
          <ul className="sm">
            {legacy.schedules.map((s) => <li key={s.id}>برنامهٔ MS Project «{s.source_name}» ({s.task_count} تسک) <button type="button" className="btn ghost sm" disabled={busy}
              onClick={() => convert("schedule", s.id, s.source_name)}>تبدیل به نسخه</button></li>)}
            {legacy.pms.map((s) => <li key={s.id}>PMS اکسل «{s.source_name}»{s.data_date && ` (تاریخ داده ${s.data_date})`} <button type="button" className="btn ghost sm" disabled={busy}
              onClick={() => convert("pms", s.id, s.source_name)}>تبدیل به نسخه</button></li>)}
          </ul>
        </div>)}
    </form>
  );
}
