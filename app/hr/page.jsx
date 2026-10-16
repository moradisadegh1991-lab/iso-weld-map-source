"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Tabs from "../../components/ui/Tabs";
import Fold from "../../components/ui/Fold";
import { localToday, DayHint } from "../../components/ui/WorkDate";

/**
 * Human resources: the project's personnel — the same register HSE names on
 * permits — with their employer, position and mobilisation, and each
 * person's daily hours on a WBS element. Hours by contractor sit beside the
 * HSE man-hours of the same month so the two can be reconciled.
 */
const BLANK = { idNo: "", fullName: "", employer: "contractor", contractorId: "", position: "", department: "", trade: "", mobilizedOn: "", demobilizedOn: "", phone: "", email: "" };
const STATUS = { on_site: ["ok", "در پروژه"], demobilized: ["", "خارج‌شده"], not_mobilized: ["warn", "ورود ثبت نشده"] };

export default function HrPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/hr?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [f, setF] = useState(BLANK);
  const [editing, setEditing] = useState(false);
  const [t, setT] = useState({ personId: "", workDate: localToday(), hours: "8", overtime: "0", accountId: "", note: "" });
  const may = can({ role }, ACTIONS.MANAGE_HR);

  async function post(body) {
    setMsg(null);
    try { await call("/api/hr", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); return true; }
    catch (e) { setMsg(e.message); return false; }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ot = (k) => (e) => setT({ ...t, [k]: e.target.value });
  function edit(id) {
    const p = data.people.find((x) => x.id === id);
    setF({ idNo: p.idNo, fullName: p.fullName, employer: p.employer, contractorId: p.contractorId || "", position: p.position || "", department: p.department || "",
      trade: p.trade || "", mobilizedOn: p.mobilizedOn || "", demobilizedOn: p.demobilizedOn || "", phone: p.phone || "", email: p.email || "" });
    setEditing(true);
  }

  return (
    <div className="page">
      <div className="pagehead"><h1>منابع انسانی</h1><span className="sub">{data.people.length} نفر · {data.headcount.total} نفر در پروژه</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      <div className="moneyrow">
        <div><span>در پروژه (امروز)</span><b>{data.headcount.total}</b></div>
        {data.headcount.byParty.slice(0, 5).map((g) => <div key={g.key}><span>{g.key}</span><b>{g.n}</b></div>)}
      </div>

      <Tabs name="hr">
        <div className="card">
          <h2>پرسنل</h2>
          {data.people.length === 0 ? <p className="empty-note">کسی ثبت نشده است.</p> : (
            <TableKit name="hr-people" onEdit={may ? edit : undefined}>
              <table className="dtable">
                <thead><tr><th>نام</th><th>کد ملی / پرسنلی</th><th>کارفرما</th><th>سمت</th><th>واحد</th><th>ورود</th><th>خروج</th><th>کارکرد (ساعت)</th><th>وضعیت</th></tr></thead>
                <tbody>{data.people.map((p) => (
                  <tr key={p.id} data-key={p.id}>
                    <td>{p.fullName}{p.trade && <div className="muted sm">{p.trade}</div>}</td><td className="mono">{p.idNo}</td>
                    <td className="sm">{p.contractor || p.employerFa}</td><td className="sm">{p.position || "—"}</td><td className="sm">{p.department || "—"}</td>
                    <td className="mono sm">{p.mobilizedOn ? new Date(p.mobilizedOn).toLocaleDateString("fa-IR") : "—"}</td>
                    <td className="mono sm">{p.demobilizedOn ? new Date(p.demobilizedOn).toLocaleDateString("fa-IR") : "—"}</td>
                    <td className="mono">{p.hours}</td><td><span className={`pill ${STATUS[p.status][0]}`}>{STATUS[p.status][1]}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </TableKit>
          )}
          {may && (
            <Fold key={editing ? `e-${f.idNo}` : "new"} title={editing ? `ویرایش ${f.fullName}` : "ثبت فرد"} defaultOpen={editing}>
              <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "person", ...f, contractorId: f.contractorId || null })) { setF(BLANK); setEditing(false); } }}>
                <div className="grid2">
                  <div className="field"><label htmlFor="hr-id">کد ملی / شمارهٔ پرسنلی</label><input id="hr-id" dir="ltr" required readOnly={editing} value={f.idNo} onChange={on("idNo")} /></div>
                  <div className="field"><label htmlFor="hr-name">نام و نام خانوادگی</label><input id="hr-name" required value={f.fullName} onChange={on("fullName")} /></div>
                  <div className="field"><label htmlFor="hr-emp">کارفرمای فرد</label>
                    <select id="hr-emp" value={f.employer} onChange={on("employer")}>{Object.entries(data.employers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                  {f.employer === "contractor" && <div className="field"><label htmlFor="hr-con">پیمانکار</label>
                    <select id="hr-con" value={f.contractorId} onChange={on("contractorId")} required><option value="">—</option>
                      {data.contractors.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select></div>}
                  <div className="field"><label htmlFor="hr-pos">سمت</label><input id="hr-pos" value={f.position} onChange={on("position")} /></div>
                  <div className="field"><label htmlFor="hr-dep">واحد سازمانی</label><input id="hr-dep" value={f.department} onChange={on("department")} /></div>
                  <div className="field"><label htmlFor="hr-trade">حرفه</label><input id="hr-trade" value={f.trade} onChange={on("trade")} /></div>
                  <div className="field"><label htmlFor="hr-mob">تاریخ ورود به پروژه</label><input id="hr-mob" type="date" dir="ltr" max={localToday()} value={f.mobilizedOn} onChange={on("mobilizedOn")} /><DayHint date={f.mobilizedOn} /></div>
                  <div className="field"><label htmlFor="hr-demob">تاریخ خروج</label><input id="hr-demob" type="date" dir="ltr" value={f.demobilizedOn} onChange={on("demobilizedOn")} /></div>
                  <div className="field"><label htmlFor="hr-phone">تلفن</label><input id="hr-phone" type="tel" dir="ltr" value={f.phone} onChange={on("phone")} /></div>
                  <div className="field"><label htmlFor="hr-email">ایمیل</label><input id="hr-email" type="email" dir="ltr" value={f.email} onChange={on("email")} /></div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" type="submit">{editing ? "ذخیرهٔ تغییرات" : "ثبت فرد"}</button>
                  {editing && <button className="btn ghost" type="button" onClick={() => { setF(BLANK); setEditing(false); }}>انصراف</button>}
                </div>
              </form>
            </Fold>
          )}
          <p className="muted sm">همان فهرستی است که HSE در مجوز کار نام می‌برد: کسی که اینجا ثبت شود، کارت صلاحیتش در HSE ثبت می‌شود و برعکس.</p>
        </div>

        <div className="card">
          <h2>کارکرد روزانه</h2>
          {may && (
            <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "timesheet", ...t, accountId: t.accountId || null })) setT({ ...t, note: "" }); }}>
              <div className="grid2">
                <div className="field"><label htmlFor="ts-p">فرد</label>
                  <select id="ts-p" value={t.personId} onChange={ot("personId")} required><option value="">—</option>
                    {data.people.filter((p) => p.status === "on_site").map((p) => <option key={p.id} value={p.id}>{p.fullName} ({p.idNo})</option>)}</select></div>
                <div className="field"><label htmlFor="ts-d">تاریخ</label><input id="ts-d" type="date" dir="ltr" max={localToday()} value={t.workDate} onChange={ot("workDate")} /><DayHint date={t.workDate} /></div>
                <div className="field"><label htmlFor="ts-h">ساعت کار</label><input id="ts-h" type="number" step="0.5" dir="ltr" value={t.hours} onChange={ot("hours")} /></div>
                <div className="field"><label htmlFor="ts-o">اضافه‌کار</label><input id="ts-o" type="number" step="0.5" dir="ltr" value={t.overtime} onChange={ot("overtime")} /></div>
                <div className="field"><label htmlFor="ts-w">روی WBS</label>
                  <select id="ts-w" value={t.accountId} onChange={ot("accountId")}><option value="">—</option>
                    {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.title}</option>)}</select></div>
                <div className="field"><label htmlFor="ts-n">یادداشت</label><input id="ts-n" value={t.note} onChange={ot("note")} /></div>
              </div>
              <button className="btn" type="submit">ثبت کارکرد</button>
            </form>
          )}
          <TableKit name="hr-timesheets">
            <table className="dtable"><thead><tr><th>تاریخ</th><th>فرد</th><th>ساعت</th><th>اضافه‌کار</th><th>WBS</th><th>یادداشت</th></tr></thead>
              <tbody>{data.recent.map((r) => <tr key={r.id}><td className="mono">{new Date(r.workDate).toLocaleDateString("fa-IR")}</td><td>{r.person}</td>
                <td className="mono">{r.hours}</td><td className="mono">{r.overtime}</td><td className="mono sm">{r.wbs || "—"}</td><td className="sm">{r.note || ""}</td></tr>)}</tbody></table>
          </TableKit>
        </div>

        <div className="card">
          <h2>ساعت کار به تفکیک ماه و WBS</h2>
          <table className="dtable"><thead><tr><th>ماه</th><th>طرف</th><th>نفر</th><th>ساعت</th><th>اضافه‌کار</th><th>ساعت‌کار HSE همان ماه</th></tr></thead>
            <tbody>{data.byMonth.map((r) => (
              <tr key={`${r.month}-${r.party}`}><td className="mono">{r.month}</td><td className="sm">{r.party}</td><td className="mono">{r.people}</td>
                <td className="mono">{r.hours}</td><td className="mono">{r.overtime}</td>
                <td className="mono">{r.hseHours === null ? <span className="muted">ثبت نشده</span> : r.hseHours}
                  {r.hseHours !== null && Math.abs(r.hseHours - r.hours - r.overtime) > 0.5 && <span className="pill warn"> اختلاف {Math.round((r.hseHours - r.hours - r.overtime) * 10) / 10}</span>}</td></tr>
            ))}</tbody></table>
          <h3>به تفکیک WBS</h3>
          <table className="dtable"><thead><tr><th>WBS</th><th>عنوان</th><th>ساعت</th></tr></thead>
            <tbody>{data.byWbs.map((r) => <tr key={r.wbs}><td className="mono">{r.wbs}</td><td>{r.title || "—"}</td><td className="mono">{r.hours}</td></tr>)}</tbody></table>
        </div>
      </Tabs>
    </div>
  );
}
