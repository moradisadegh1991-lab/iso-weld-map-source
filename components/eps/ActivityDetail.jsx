"use client";
import { useState } from "react";
import Link from "next/link";
import { ScopeTab } from "./ScopePanel";

/**
 * The detail sub-forms under the activity view, for the selected activity
 * (owner's «PMS» document: images 1–9 and 11–12). Every figure comes from the
 * server (lib/db/repos/eps-activities.mjs activityDetail); a form here only
 * sends what a person typed.
 *
 *   detail     planned and actual status, budget, weights, float; the
 *              activity's own fields (editable on the activity page)
 *   workfront  its days from planned start to finish: plan, done, cumulative, cost
 *   groups     the versions (planning groups) that carry an activity of its code
 *   relations  predecessors and successors
 *   progress   done against its actual volume
 *   roles      contract resources on it and their cost
 *   reports    its lines in the daily reports (editable as each report's workflow allows)
 *   codes      its activity codes
 *   overall    its lines in the delay claim, against the master plan
 *   docs       the photos and files of the reports its work is in
 *   scope      its link to the platform's records (components/eps/ScopePanel.jsx)
 */
export const fmt = (v, d = 2) => (v == null || v === "" ? "—" : Number(v).toLocaleString("fa-IR", { maximumFractionDigits: d }));
export const day = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("fa-IR") : "—");
export const TABS = {
  detail: "Activity Detail", workfront: "Work Front", groups: "Planning Group", relations: "Relationship", progress: "Progress",
  roles: "Role", reports: "Daily Report", codes: "Activity Code", overall: "Activity Overall Detail", docs: "Document", scope: "Scope (پلتفرم)",
};
export function statusOf(a) {
  if ((a.pct != null && a.pct >= 100) || a.actual_end) return "تمام‌شده";
  if (a.done > 0 || a.actual_start) return "در جریان";
  return "شروع‌نشده";
}
const KV = ({ k, v }) => <div className="kv"><span>{k}</span><b>{v}</b></div>;

export default function ActivityDetail({ d, tab, may, post, acts = [], codes = [], resources = [], companies = [], projectId, readOnly = false, labels = null }) {
  const a = d.activity;
  switch (tab) {
    case "detail": return <Detail a={a} may={may && !readOnly} post={post} />;
    case "workfront": return <WorkFront wf={d.workFront} unit={a.unit} />;
    case "groups": return <Groups groups={d.groups} />;
    case "relations": return <Relations d={d} may={may && !readOnly} post={post} acts={acts} />;
    case "progress": return <Progress a={a} codes={d.codes} />;
    case "roles": return <Roles d={d} may={may && !readOnly} post={post} resources={resources} />;
    case "reports": return <Reports d={d} post={post} companies={companies} />;
    case "codes": return <Codes d={d} may={may && !readOnly} post={post} codes={codes} />;
    case "overall": return <Overall d={d} may={may && !readOnly} post={post} />;
    case "docs": return <Docs d={d} projectId={projectId} />;
    case "scope": return <ScopeTab d={d} may={may && !readOnly} post={post} L={(labels || d.labels).scope} />;
    default: return null;
  }
}

function Detail({ a, may, post }) {
  const [f, setF] = useState(null);
  const open = () => setF({ name: a.name, wf: a.wf ?? "", description: a.description || "", progress: a.progress ?? "",
    planStart: a.own?.plan_start || "", planEnd: a.own?.plan_end || "", actualStart: a.own?.actual_start || "", actualEnd: a.own?.actual_end || "",
    volumePlan: a.own?.volume_plan ?? "", volumeActual: a.own?.volume_actual ?? "" });
  const costDone = a.budgetPlan != null && a.pct != null ? (a.budgetPlan * a.pct) / 100 : null;
  return (
    <div>
      <p className="row" style={{ gap: 12, alignItems: "center" }}><b className="mono" dir="ltr">{a.code}</b> <span>{a.name}</span>
        <span className="sm muted">گره <span className="mono" dir="ltr">{a.node_code}</span> — {a.node_name}</span>
        {a.template_code && <span className="sm muted">الگو <span className="mono">{a.template_code}</span></span>}
        {may && !f && <button className="btn ghost sm" type="button" onClick={open}>ویرایش فعالیت</button>}</p>
      <div className="p6-kv">
        <fieldset><legend>Original (برنامه‌ای)</legend>
          <KV k="شروع" v={day(a.plan_start)} /><KV k="مدت (روز)" v={fmt(a.planDays)} /><KV k="پایان" v={day(a.plan_end)} />
          <KV k="مدت باقیمانده تا پایان" v={fmt(a.remainDays)} /></fieldset>
        <fieldset><legend>Actual (واقعی)</legend>
          <KV k="شروع" v={day(a.actual_start)} /><KV k="مدت (روز)" v={fmt(a.actualDays)} /><KV k="پایان" v={day(a.actual_end)} />
          <KV k="وضعیت" v={statusOf(a)} /><KV k={a.scopeLinked ? "پیشرفت از داده‌های پلتفرم" : "پیشرفت از گزارش‌ها"} v={a.pct == null ? "نامعلوم (حجم واقعی ثبت نشده)" : `${fmt(a.pct)}٪`} />
          <KV k="پیشرفت دستی" v={a.progress == null ? "—" : `${fmt(a.progress)}٪`} /></fieldset>
        <fieldset><legend>Budget (بودجه)</legend>
          <KV k="بودجهٔ برنامه‌ای (W.F × گره)" v={fmt(a.budgetPlan)} /><KV k="بودجهٔ واقعی" v={fmt(a.budgetActual)} />
          <KV k="هزینهٔ کار انجام‌شده" v={fmt(costDone)} /></fieldset>
        <fieldset><legend>Weight (وزن و حجم)</legend>
          <KV k="W.F" v={a.wf == null ? "—" : `${fmt(a.wf, 4)}٪`} /><KV k="W.V" v={a.wv == null ? "—" : `${fmt(a.wv, 6)}٪`} />
          <KV k={`حجم برنامه‌ای (Estimate) ${a.unit || ""}`} v={fmt(a.volumePlan)} /><KV k="حجم واقعی (Actual weight)" v={fmt(a.volumeActual)} />
          <KV k="انجام‌شده (Total worked)" v={fmt(a.done)} /><KV k="باقیمانده (Remain)" v={fmt(a.remain)} /></fieldset>
        <fieldset><legend>Float</legend><KV k="Free float (روز)" v={fmt(a.freeFloat)} /></fieldset>
      </div>
      {a.description && <p className="sm">{a.description}</p>}
      {f && (
        <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await post("/api/eps", { kind: "activity", nodeId: a.node_id, id: a.id, ...f }, () => "فعالیت ذخیره شد.")) setF(null); }}>
          <div className="grid2">
            {[["name", "نام فعالیت"], ["wf", "W.F ٪"], ["progress", "پیشرفت دستی ٪"], ["description", "توضیحات"]].map(([k, l]) => (
              <div className="field" key={k}><label htmlFor={`ad-${k}`}>{l}</label><input id={`ad-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required={k === "name"} /></div>))}
          </div>
          <p className="sm muted">تاریخ‌ها و حجم‌ها را فقط وقتی پر کنید که با گرهٔ WBS فرق دارند؛ خالی یعنی از گره خوانده شود.</p>
          <div className="grid2">
            {[["planStart", "شروع برنامه‌ای", "date"], ["planEnd", "پایان برنامه‌ای", "date"], ["actualStart", "شروع واقعی", "date"], ["actualEnd", "پایان واقعی", "date"],
              ["volumePlan", "حجم برنامه‌ای", "text"], ["volumeActual", "حجم واقعی", "text"]].map(([k, l, t]) => (
              <div className="field" key={k}><label htmlFor={`ad-${k}`}>{l}</label><input id={`ad-${k}`} type={t} dir="ltr" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>))}
          </div>
          <button className="btn" type="submit">ذخیره</button> <button className="btn ghost" type="button" onClick={() => setF(null)}>انصراف</button>
        </form>)}
    </div>);
}

function WorkFront({ wf, unit }) {
  if (!wf.rows.length) return <p className="empty-note">فعالیت تاریخ برنامه‌ای ندارد و کاری برایش ثبت نشده است.</p>;
  return (
    <div>
      <p className="sm muted">برنامهٔ روزانه = حجم ÷ {fmt(wf.days)} روز = {fmt(wf.perDay, 4)} {unit || ""} در روز (یکنواخت). انجام‌شده از گزارش‌های روزانه.</p>
      <div className="tablewrap" style={{ maxHeight: 320 }}><table className="dtable">
        <thead><tr><th>تاریخ</th><th>برنامهٔ روز</th><th>برنامهٔ تجمعی</th><th>٪ برنامه</th><th>انجام روز (This work)</th><th>انجام تجمعی (Total)</th>
          <th>٪ روز</th><th>٪ تجمعی</th><th>هزینهٔ روز</th><th>هزینهٔ تجمعی</th></tr></thead>
        <tbody>{wf.rows.map((r) => (
          <tr key={r.date} style={{ opacity: r.inPlan ? 1 : 0.7 }} data-wf-day={r.date}><td className="mono">{day(r.date)}{!r.inPlan && <span className="sm muted"> (خارج برنامه)</span>}</td>
            <td className="mono">{fmt(r.plan, 3)}</td><td className="mono">{fmt(r.planCum, 3)}</td><td className="mono">{fmt(r.planPct)}</td>
            <td className="mono">{r.done ? fmt(r.done, 3) : ""}</td><td className="mono">{fmt(r.doneCum, 3)}</td><td className="mono">{r.done ? fmt(r.donePct) : ""}</td>
            <td className="mono">{fmt(r.doneCumPct)}</td><td className="mono">{r.done ? fmt(r.cost) : ""}</td><td className="mono">{fmt(r.costCum)}</td></tr>))}</tbody></table></div>
    </div>);
}

function Groups({ groups }) {
  return (
    <div className="tablewrap"><table className="dtable">
      <thead><tr><th>PMS</th><th>نسخه (Scheduling No.)</th><th>عنوان</th><th>شرح</th><th>تاریخ ثبت</th><th>شروع</th><th>مدت</th><th>پایان</th><th>آخرین کار</th>
        <th>حجم</th><th>W.V</th><th>انجام‌شده</th><th>باقیمانده</th><th>پیشرفت</th></tr></thead>
      <tbody>{groups.map((g) => (
        <tr key={g.versionId} style={{ fontWeight: g.current ? 600 : undefined }} data-group={g.code}>
          <td className="mono">{g.pms}</td><td className="mono">{g.code}{g.master && <span className="chip" style={{ marginInlineStart: 4 }}>Master</span>}{g.current && <span className="sm muted"> (همین)</span>}</td>
          <td>{g.title}</td><td className="sm">{g.description || "—"}</td><td className="mono">{day(g.registered)}</td>
          <td className="mono">{day(g.plan_start)}</td><td className="mono">{fmt(g.planDays)}</td><td className="mono">{day(g.plan_end)}</td><td className="mono">{day(g.lastWork)}</td>
          <td className="mono">{fmt(g.volumeActual)}</td><td className="mono">{g.wv == null ? "—" : `${fmt(g.wv, 6)}٪`}</td><td className="mono">{fmt(g.done)}</td>
          <td className="mono">{fmt(g.remain)}</td><td className="mono">{g.pct == null ? "—" : `${fmt(g.pct)}٪`}</td></tr>))}</tbody></table></div>);
}

function Relations({ d, may, post, acts }) {
  const [f, setF] = useState({ side: "pred", other: "", relType: "FS", lag: "0" });
  const table = (list, title, color, side) => (
    <div style={{ flex: 1, minWidth: 320 }}>
      <h3 style={{ background: color, color: "#fff", padding: "3px 8px", margin: 0, fontSize: 13 }}>— {title} —</h3>
      <table className="dtable"><thead><tr><th>کد</th><th>نام فعالیت</th><th>WBS</th><th>نوع</th><th>Lag</th><th>شروع</th><th>مدت</th>{may && <th />}</tr></thead>
        <tbody>{list.map((r) => (
          <tr key={r.id} data-rel={`${side}:${r.code}`}><td className="mono" dir="ltr">{r.code}</td><td>{r.name}</td><td className="mono sm" dir="ltr">{r.wbs}</td>
            <td className="mono">{r.rel_type}</td><td className="mono">{r.lag}</td><td className="mono">{day(r.plan_start)}</td><td className="mono">{fmt(r.planDays)}</td>
            {may && <td><button className="btn ghost sm" type="button" onClick={() => post("/api/eps/activities", { kind: "relation-remove", id: r.id }, () => "رابطه حذف شد.")}>حذف</button></td>}</tr>))}
          {list.length === 0 && <tr><td colSpan={8} className="muted sm">—</td></tr>}</tbody></table></div>);
  return (
    <div>
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
        {table(d.predecessors, "Predecessors (پیش‌نیازها)", "#1e8449", "pred")}{table(d.successors, "Successors (پس‌نیازها)", "#c0392b", "succ")}</div>
      {may && (
        <form className="row" style={{ gap: 6, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const [predId, succId] = f.side === "pred" ? [f.other, d.activity.id] : [d.activity.id, f.other];
            if (await post("/api/eps/activities", { kind: "relation", predId, succId, relType: f.relType, lag: f.lag }, () => "رابطه ثبت شد.")) setF({ ...f, other: "" });
          }}>
          <div className="field"><label htmlFor="rl-side">افزودن</label><select id="rl-side" value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })}>
            <option value="pred">پیش‌نیاز</option><option value="succ">پس‌نیاز</option></select></div>
          <div className="field"><label htmlFor="rl-other">فعالیت</label><select id="rl-other" required value={f.other} onChange={(e) => setF({ ...f, other: e.target.value })}>
            <option value="">—</option>{acts.filter((x) => x.id !== d.activity.id).map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select></div>
          <div className="field"><label htmlFor="rl-type">نوع</label><select id="rl-type" value={f.relType} onChange={(e) => setF({ ...f, relType: e.target.value })}>
            {["FS", "SS", "FF", "SF"].map((t) => <option key={t}>{t}</option>)}</select></div>
          <div className="field" style={{ width: 80 }}><label htmlFor="rl-lag">Lag (روز)</label><input id="rl-lag" dir="ltr" value={f.lag} onChange={(e) => setF({ ...f, lag: e.target.value })} /></div>
          <button className="btn" type="submit">ثبت رابطه</button>
        </form>)}
    </div>);
}

function Progress({ a, codes }) {
  const cats = codes[0]?.categories || [];
  return (
    <div className="tablewrap"><table className="dtable">
      <thead><tr>{["A", "B", "C", "D", "E", "F", "G", "H"].map((x) => <th key={x}>Category {x}</th>)}<th>Activity No.</th><th>Description</th><th>Unit</th>
        <th>W.F</th><th>W.V</th><th>Actual weight</th><th>Progress</th><th>Total work</th><th>Status</th><th>Original start</th><th>Orig. dur.</th><th>Original finish</th></tr></thead>
      <tbody><tr data-progress={a.code}>{Array.from({ length: 8 }, (_, i) => <td key={i} className="sm">{cats[i] || "—"}</td>)}
        <td className="mono" dir="ltr">{a.code}</td><td>{a.name}</td><td>{a.unit || "—"}</td><td className="mono">{a.wf == null ? "—" : `${fmt(a.wf, 4)}٪`}</td>
        <td className="mono">{a.wv == null ? "—" : `${fmt(a.wv, 6)}٪`}</td><td className="mono">{fmt(a.volumeActual)}</td>
        <td className="mono"><b>{a.pct == null ? "نامعلوم" : `${fmt(a.pct)}٪`}</b></td><td className="mono">{fmt(a.done)}</td><td>{statusOf(a)}</td>
        <td className="mono">{day(a.plan_start)}</td><td className="mono">{fmt(a.planDays)}</td><td className="mono">{day(a.plan_end)}</td></tr></tbody></table>
      <p className="sm muted">پیشرفت = جمع مقادیر انجام‌شده در گزارش‌های روزانه ÷ حجم واقعی فعالیت. بدون حجم واقعی، پیشرفت نامعلوم می‌ماند و حدس زده نمی‌شود. دسته‌ها از کد فعالیت اول آن.</p></div>);
}

function Roles({ d, may, post, resources }) {
  const blank = { id: null, resourceId: "", budgetUnit: "hour", perDay: "", rate: "", actualTime: "", status: "planned", remark: "" };
  const [f, setF] = useState(blank);
  const a = d.activity;
  return (
    <div>
      <div className="tablewrap"><table className="dtable">
        <thead><tr><th>Activity No.</th><th>نقش (منبع)</th><th>دسته</th><th>شروع</th><th>مدت</th><th>پایان</th><th>واحد بودجه</th><th>مقدار در روز</th><th>نرخ</th>
          <th>کل زمان</th><th>کل مبلغ</th><th>زمان واقعی</th><th>مبلغ واقعی</th><th>وضعیت</th><th>توضیح</th>{may && <th />}</tr></thead>
        <tbody>{d.roles.map((r) => (
          <tr key={r.id} data-role={r.resource_name}><td className="mono" dir="ltr">{a.code}</td><td>{r.resource_name}</td><td className="sm">{r.category || "—"}</td>
            <td className="mono">{day(a.plan_start)}</td><td className="mono">{fmt(a.planDays)}</td><td className="mono">{day(a.plan_end)}</td>
            <td>{{ hour: "ساعت", day: "روز", unit: "مقطوع" }[r.budget_unit]}</td><td className="mono">{fmt(r.per_day)}</td><td className="mono">{fmt(r.rate)}</td>
            <td className="mono">{fmt(r.totalTime)}</td><td className="mono"><b>{fmt(r.totalPrice)}</b></td><td className="mono">{fmt(r.actualTime)}</td><td className="mono">{fmt(r.actualPrice)}</td>
            <td>{{ planned: "برنامه‌ای", active: "در کار", done: "تمام" }[r.status]}</td><td className="sm">{r.remark || ""}</td>
            {may && <td style={{ whiteSpace: "nowrap" }}><button className="btn ghost sm" type="button" onClick={() => setF({ id: r.id, resourceId: r.resource_id, budgetUnit: r.budget_unit, perDay: r.per_day ?? "",
              rate: r.rate ?? "", actualTime: r.actual_time ?? "", status: r.status, remark: r.remark || "" })}>ویرایش</button>
              <button className="btn ghost sm" type="button" onClick={() => post("/api/eps/activities", { kind: "role-remove", id: r.id }, () => "حذف شد.")}>حذف</button></td>}</tr>))}
          {d.roles.length > 0 && <tr><td colSpan={10}><b>جمع هزینهٔ نقش‌ها</b></td><td className="mono"><b>{fmt(d.roles.reduce((s, r) => s + (r.totalPrice || 0), 0))}</b></td><td />
            <td className="mono"><b>{fmt(d.roles.reduce((s, r) => s + (r.actualPrice || 0), 0))}</b></td><td colSpan={may ? 3 : 2} /></tr>}</tbody></table></div>
      {may && (
        <form className="row" style={{ gap: 6, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}
          onSubmit={async (e) => { e.preventDefault(); if (await post("/api/eps/activities", { kind: "role", activityId: a.id, ...f }, () => "نقش ذخیره شد.")) setF(blank); }}>
          <div className="field"><label htmlFor="ro-res">نقش (منبع قرارداد)</label><select id="ro-res" required value={f.resourceId} onChange={(e) => setF({ ...f, resourceId: e.target.value })}>
            <option value="">—</option>{resources.map((r) => <option key={r.id} value={r.id}>{r.name}{r.unit ? ` (${r.unit})` : ""}</option>)}</select></div>
          <div className="field"><label htmlFor="ro-bu">واحد بودجه</label><select id="ro-bu" value={f.budgetUnit} onChange={(e) => setF({ ...f, budgetUnit: e.target.value })}>
            <option value="hour">ساعت</option><option value="day">روز</option><option value="unit">مقطوع</option></select></div>
          {[["perDay", f.budgetUnit === "unit" ? "مقدار کل" : "مقدار در روز"], ["rate", "نرخ (مبلغ هر واحد)"], ["actualTime", "زمان واقعی"], ["remark", "توضیح"]].map(([k, l]) => (
            <div className="field" key={k} style={{ width: k === "remark" ? 180 : 110 }}><label htmlFor={`ro-${k}`}>{l}</label><input id={`ro-${k}`} dir={k === "remark" ? undefined : "ltr"} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>))}
          <div className="field"><label htmlFor="ro-st">وضعیت</label><select id="ro-st" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="planned">برنامه‌ای</option><option value="active">در کار</option><option value="done">تمام</option></select></div>
          <button className="btn" type="submit">{f.id ? "ذخیره" : "افزودن نقش"}</button>{f.id && <button className="btn ghost" type="button" onClick={() => setF(blank)}>انصراف</button>}
        </form>)}
      {resources.length === 0 && <p className="sm muted">قرارداد منبعی ندارد (قراردادها ◄ منابع قرارداد).</p>}
    </div>);
}

function Reports({ d, post, companies }) {
  const [edit, setEdit] = useState(null);
  const a = d.activity;
  if (!d.reports.length) return <p className="empty-note">هنوز در گزارش روزانه‌ای کاری برای این فعالیت ثبت نشده است.</p>;
  return (
    <div className="tablewrap"><table className="dtable">
      <thead><tr><th>فعالیت</th><th>ناحیه / پیمانکار</th><th>Mark</th><th>واحد</th><th>مقدار انجام‌شده</th><th>گزارش</th><th>تاریخ</th><th>مرحله</th><th>توضیح</th><th /></tr></thead>
      <tbody>{d.reports.map((l) => {
        const m = d.reportMay?.[l.reportId];
        const mine = edit && edit.rowId === l.rowId && edit.reportId === l.reportId;
        return (
          <tr key={`${l.reportId}-${l.rowId}`} data-line={`${l.reportNo}`}>
            <td className="sm"><span className="mono" dir="ltr">{a.code}</span> {a.name}</td>
            <td>{mine ? <select aria-label="ناحیه" value={edit.areaId || ""} onChange={(e) => setEdit({ ...edit, areaId: e.target.value })}><option value="">—</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : l.areaName || "—"}</td>
            <td>{mine ? <input aria-label="Mark" value={edit.mark || ""} onChange={(e) => setEdit({ ...edit, mark: e.target.value })} style={{ width: 80 }} /> : l.mark || "—"}</td>
            <td>{a.unit || "—"}</td>
            <td className="mono">{mine ? <input aria-label="مقدار" dir="ltr" value={edit.qty} onChange={(e) => setEdit({ ...edit, qty: e.target.value })} style={{ width: 90 }} /> : <b>{fmt(l.qty, 4)}</b>}</td>
            <td className="mono"><Link href={`/contract-reports?id=${l.reportId}`}>{l.reportNo}</Link></td><td className="mono">{day(l.date)}</td>
            <td className="sm">{l.status === "approved" ? "تأیید نهایی" : l.stageName || "—"}</td><td className="sm">{l.notes || ""}</td>
            <td style={{ whiteSpace: "nowrap" }}>{m?.edit ? (mine ? <>
              <button className="btn sm" type="button" onClick={async () => { if (await post("/api/eps/activities", { kind: "progress-edit", reportId: l.reportId, rowId: l.rowId, qty: edit.qty, areaId: edit.areaId, mark: edit.mark }, () => "ردیف گزارش ذخیره شد.")) setEdit(null); }}>ذخیره</button>
              <button className="btn ghost sm" type="button" onClick={() => setEdit(null)}>انصراف</button></> : <>
              <button className="btn ghost sm" type="button" onClick={() => setEdit({ reportId: l.reportId, rowId: l.rowId, qty: String(l.qty), areaId: l.areaId || "", mark: l.mark || "" })}>ویرایش</button>
              <button className="btn ghost sm" type="button" onClick={() => post("/api/eps/activities", { kind: "progress-edit", reportId: l.reportId, rowId: l.rowId, remove: true }, () => "ردیف حذف شد.")}>حذف</button></>)
              : <span className="sm muted" title={m?.why || ""}>فقط نمایش</span>}</td>
          </tr>);
      })}
        <tr><td colSpan={4}><b>جمع</b></td><td className="mono"><b>{fmt(d.reports.reduce((s, l) => s + Number(l.qty || 0), 0), 4)}</b></td><td colSpan={5} /></tr></tbody></table>
      <p className="sm muted">هر ردیف در گردش کار همان گزارش است: در مرحلهٔ اول خود ردیف، در مرحله‌های بعد مقدار همان مرحله نوشته می‌شود؛ پس از امضا، برای امضاکننده فقط نمایش است.</p></div>);
}

function Codes({ d, may, post, codes }) {
  const [pick, setPick] = useState("");
  const have = new Set(d.codes.map((c) => c.id));
  return (
    <div>
      <div className="tablewrap"><table className="dtable">
        <thead><tr><th>Activity No.</th><th>Active Code</th><th>نوع فعالیت</th>{["A", "B", "C", "D", "E", "F"].map((x) => <th key={x}>Category {x}</th>)}<th>Unit</th><th>Valid</th><th>Remark</th>{may && <th />}</tr></thead>
        <tbody>{d.codes.map((c) => (
          <tr key={c.id} data-code={c.code}><td className="mono" dir="ltr">{d.activity.code}</td><td className="mono" dir="ltr">{c.code}</td><td>{c.name}</td>
            {Array.from({ length: 6 }, (_, i) => <td key={i} className="sm">{c.categories?.[i] || "—"}</td>)}<td>{c.unit || "—"}</td><td>{c.valid ? "✓" : "✗"}</td><td className="sm">{c.remark || ""}</td>
            {may && <td><button className="btn ghost sm" type="button" onClick={() => post("/api/eps/activities", { kind: "code-assign", codeId: c.id, activityIds: [d.activity.id], remove: true }, () => "کد برداشته شد.")}>برداشتن</button></td>}</tr>))}
          {d.codes.length === 0 && <tr><td colSpan={13} className="muted sm">کدی داده نشده.</td></tr>}</tbody></table></div>
      {may && (
        <form className="row" style={{ gap: 6, alignItems: "end", marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); if (await post("/api/eps/activities", { kind: "code-assign", codeId: pick, activityIds: [d.activity.id] }, () => "کد داده شد.")) setPick(""); }}>
          <div className="field"><label htmlFor="cd-pick">کد فعالیت</label><select id="cd-pick" required value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">—</option>{codes.filter((c) => c.valid && !have.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select></div>
          <button className="btn" type="submit">دادن کد</button> <Link className="sm" href="/eps/codes">تعریف کدهای فعالیت</Link>
        </form>)}
    </div>);
}

function Overall({ d, may, post }) {
  const blank = { id: null, description: "", delayCode: "", acceptStart: "", acceptFinish: "", critical: false, remark: "" };
  const [f, setF] = useState(blank);
  const a = d.activity;
  return (
    <div>
      {!d.baseline && <p className="sm" style={{ color: "var(--warn)" }}>PMS این فعالیت «Master plan» ندارد یا فعالیت هم‌کد در آن نیست؛ تأخیرها محاسبه نمی‌شوند (EPS و PMS ◄ Master).</p>}
      {d.baseline && <p className="sm muted">مبنا: برنامهٔ اصلی <span className="mono">{d.baseline.version}</span> — {day(d.baseline.plan_start)} تا {day(d.baseline.plan_end)} ({fmt(d.baseline.planDays)} روز)</p>}
      <div className="tablewrap"><table className="dtable">
        <thead><tr><th>No.</th><th>Description</th><th>Delay code</th><th>WBS</th><th>Task name</th><th>Actual start</th><th>Act. dur.</th><th>Actual finish</th>
          <th>Start delay</th><th>Delay (day)</th><th>Finish delay</th><th>Baseline start</th><th>Base dur.</th><th>Baseline finish</th><th>Free float</th>
          <th>Accept start</th><th>Accp. delay</th><th>Accept finish</th><th>Critical</th><th>Remark</th>{may && <th />}</tr></thead>
        <tbody>{d.delays.map((x) => (
          <tr key={x.id} data-delay={x.no}><td className="mono">{x.no}</td><td>{x.description}</td><td className="mono">{x.delay_code || "—"}</td><td className="mono sm" dir="ltr">{a.node_code}</td><td className="sm">{a.name}</td>
            <td className="mono">{day(x.actualStart)}</td><td className="mono">{fmt(x.actualDays)}</td><td className="mono">{day(x.actualFinish)}</td>
            <td className="mono">{fmt(x.startDelay)}</td><td className="mono" style={{ background: "rgba(255,170,120,.15)" }}><b>{fmt(x.delay)}</b></td><td className="mono">{fmt(x.finishDelay)}</td>
            <td className="mono">{day(x.baselineStart)}</td><td className="mono">{fmt(x.baselineDays)}</td><td className="mono">{day(x.baselineFinish)}</td><td className="mono">{fmt(a.freeFloat)}</td>
            <td className="mono">{day(x.acceptStart)}</td><td className="mono"><b>{fmt(x.acceptDelay)}</b></td><td className="mono">{day(x.acceptFinish)}</td>
            <td>{x.critical ? "✓" : ""}</td><td className="sm">{x.remark || ""}</td>
            {may && <td style={{ whiteSpace: "nowrap" }}><button className="btn ghost sm" type="button" onClick={() => setF({ id: x.id, description: x.description, delayCode: x.delay_code || "",
              acceptStart: x.acceptStart || "", acceptFinish: x.acceptFinish || "", critical: x.critical, remark: x.remark || "" })}>ویرایش</button>
              <button className="btn ghost sm" type="button" onClick={() => post("/api/eps/activities", { kind: "delay-remove", id: x.id }, () => "حذف شد.")}>حذف</button></td>}</tr>))}
          {d.delays.length === 0 && <tr><td colSpan={21} className="muted sm">این فعالیت در لایحهٔ تأخیرات ردیفی ندارد.</td></tr>}</tbody></table></div>
      {may && (
        <form className="row" style={{ gap: 6, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}
          onSubmit={async (e) => { e.preventDefault(); if (await post("/api/eps/activities", { kind: "delay", activityId: a.id, ...f }, () => "ردیف لایحه ذخیره شد.")) setF(blank); }}>
          <div className="field"><label htmlFor="dl-d">شرح</label><input id="dl-d" required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <div className="field" style={{ width: 100 }}><label htmlFor="dl-c">کد تأخیر</label><input id="dl-c" dir="ltr" value={f.delayCode} onChange={(e) => setF({ ...f, delayCode: e.target.value })} /></div>
          <div className="field"><label htmlFor="dl-as">شروع پذیرفته</label><input id="dl-as" type="date" value={f.acceptStart} onChange={(e) => setF({ ...f, acceptStart: e.target.value })} /></div>
          <div className="field"><label htmlFor="dl-af">پایان پذیرفته</label><input id="dl-af" type="date" value={f.acceptFinish} onChange={(e) => setF({ ...f, acceptFinish: e.target.value })} /></div>
          <label className="sm"><input type="checkbox" checked={f.critical} onChange={(e) => setF({ ...f, critical: e.target.checked })} /> تأخیر بحرانی</label>
          <div className="field"><label htmlFor="dl-r">توضیح</label><input id="dl-r" value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></div>
          <button className="btn" type="submit">{f.id ? "ذخیره" : "افزودن ردیف لایحه"}</button>{f.id && <button className="btn ghost" type="button" onClick={() => setF(blank)}>انصراف</button>}
        </form>)}
    </div>);
}

function Docs({ d, projectId }) {
  if (!d.files.length) return <p className="empty-note">گزارش‌هایی که کار این فعالیت در آن‌هاست عکس یا پیوستی ندارند.</p>;
  return (
    <table className="dtable"><thead><tr><th>گزارش</th><th>تاریخ</th><th>نوع</th><th>نام</th><th>شرح</th></tr></thead>
      <tbody>{d.files.map((f) => (
        <tr key={f.id}><td className="mono">{f.report_no}</td><td className="mono">{day(f.report_date)}</td><td>{f.kind === "photo" ? "عکس" : "پیوست"}</td>
          <td><a href={`/api/contract-reports?projectId=${projectId}&file=${f.id}`} target="_blank" rel="noreferrer">{f.name}</a></td><td className="sm">{f.caption || ""}</td></tr>))}</tbody></table>);
}
