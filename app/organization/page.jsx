"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import Tabs from "../../components/ui/Tabs";

/**
 * Step 1 of the organisation's process: the companies (one directory for
 * every project, each with its logos), the project's stakeholders chosen
 * from them, its currencies with their value in the base unit, and its
 * budgets in those currencies.
 */
const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString("fa-IR", { maximumFractionDigits: 6 }));

export default function OrganizationPage() {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/org?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/org", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const may = data.may.project;
  return (
    <div className="page">
      <div className="pagehead"><h1>تعریف پروژه</h1>
        <span className="sub">شرکت‌ها و لوگوها، ذی‌نفعان پروژه، ارزها و بودجه‌ها — مرحلهٔ ۱ فرایند سازمان</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      <Tabs name="org">
        <Companies data={data} may={may} post={post} projectId={projectId} setMsg={setMsg} setOk={setOk} reload={reload} />
        <Stakeholders data={data} may={may} post={post} />
        <Money data={data} may={may} post={post} />
      </Tabs>
    </div>
  );
}

function Companies({ data, may, post, projectId, setMsg, setOk, reload }) {
  const BLANK = { id: null, code: "", name: "", nameEn: "", nationalId: "", taxCode: "", phone: "", email: "", address: "" };
  const [f, setF] = useState(BLANK);
  const [logo, setLogo] = useState({ companyId: "", name: "", file: null });
  async function upload() {
    setMsg(null); setOk(null);
    if (!logo.companyId || !logo.name.trim() || !logo.file) { setMsg("شرکت، نام و فایل لوگو لازم است."); return; }
    const form = new FormData();
    form.set("projectId", projectId); form.set("companyId", logo.companyId); form.set("name", logo.name); form.set("file", logo.file);
    const res = await fetch("/api/org", { method: "POST", body: form, credentials: "same-origin" });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(b.error || `پاسخ ${res.status}`); return; }
    setLogo({ ...logo, name: "", file: null }); setOk(b.logo.duplicate ? "این لوگو از قبل هست." : "لوگو اضافه شد."); reload();
  }
  return (
    <div className="card">
      <h2>شرکت‌ها</h2>
      <p className="sm muted">فهرست شرکت‌ها برای همهٔ پروژه‌ها یکی است: کارفرما، پیمانکار یا سازنده‌ای که در چند پروژه هست یک بار تعریف می‌شود. هر شرکت می‌تواند چند لوگو داشته باشد.</p>
      {may && (
        <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "company", ...f }, (r) => `شرکت ${r.company.code} ثبت شد.`)) setF(BLANK); }}>
          <div className="grid2">
            {[["code", "کد (لاتین)", "ltr"], ["name", "نام"], ["nameEn", "نام لاتین", "ltr"], ["nationalId", "شناسهٔ ملی", "ltr"], ["taxCode", "کد مالیاتی (اقتصادی)", "ltr"], ["phone", "تلفن", "ltr"], ["email", "ایمیل", "ltr"], ["address", "نشانی"]].map(([k, l, dir]) => (
              <div className="field" key={k}><label htmlFor={`co-${k}`}>{l}</label><input id={`co-${k}`} dir={dir} required={k === "code" || k === "name"} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
            ))}
          </div>
          <button className="btn" type="submit">{f.id ? "ذخیرهٔ تغییرات" : "افزودن شرکت"}</button>
          {f.id && <button className="btn ghost" type="button" onClick={() => setF(BLANK)}>انصراف</button>}
        </form>
      )}
      <div className="tablewrap"><table className="dtable">
        <thead><tr><th>کد</th><th>نام</th><th>شناسهٔ ملی / کد مالیاتی</th><th>تماس</th><th>لوگوها</th>{may && <th />}</tr></thead>
        <tbody>{data.companies.map((c) => (
          <tr key={c.id}><td className="mono">{c.code}</td><td>{c.name}{c.name_en && <div className="sm muted" dir="ltr">{c.name_en}</div>}</td>
            <td className="sm mono" dir="ltr">{[c.national_id, c.tax_code].map((x) => x || "—").join(" / ")}</td>
            <td className="sm" dir="ltr">{[c.phone, c.email].filter(Boolean).join(" · ") || "—"}</td>
            <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>{c.logos.map((l) => (
              <span key={l.id} title={l.name} style={{ opacity: l.active ? 1 : 0.35 }}>
                <img src={`/api/org?projectId=${projectId}&logo=${l.id}`} alt={l.name} style={{ height: 28, maxWidth: 80, objectFit: "contain", verticalAlign: "middle" }} />
                {may && <button className="btn ghost sm" type="button" onClick={() => post({ kind: "logo-active", id: l.id, active: !l.active })}>{l.active ? "غیرفعال" : "فعال"}</button>}
                {may && <button className="btn ghost sm" type="button" title="تغییر نام لوگو"
                  onClick={() => { const n = prompt("نام تازهٔ لوگو", l.name); if (n && n.trim() && n !== l.name) post({ kind: "logo-rename", id: l.id, name: n }, () => "نام لوگو تغییر کرد."); }}>✎</button>}
              </span>))}{!c.logos.length && <span className="muted sm">—</span>}</div></td>
            {may && <td><button className="btn ghost sm" type="button" onClick={() => setF({ id: c.id, code: c.code, name: c.name, nameEn: c.name_en || "", nationalId: c.national_id || "", taxCode: c.tax_code || "",
              phone: c.phone || "", email: c.email || "", address: c.address || "" })}>ویرایش</button></td>}</tr>
        ))}</tbody></table></div>
      {may && data.companies.length > 0 && (
        <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}>
          <div className="field"><label htmlFor="lg-co">شرکت</label><select id="lg-co" value={logo.companyId} onChange={(e) => setLogo({ ...logo, companyId: e.target.value })}>
            <option value="">—</option>{data.companies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select></div>
          <div className="field"><label htmlFor="lg-name">نام لوگو</label><input id="lg-name" value={logo.name} onChange={(e) => setLogo({ ...logo, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="lg-file">فایل (PNG، JPEG یا WebP، تا ۱ مگابایت)</label>
            <input id="lg-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setLogo({ ...logo, file: e.target.files?.[0] || null })} /></div>
          <button className="btn" type="button" onClick={upload}>افزودن لوگو</button>
        </div>
      )}
    </div>
  );
}

function Stakeholders({ data, may, post }) {
  const BLANK = { id: null, companyId: "", role: "owner", note: "" };
  const [f, setF] = useState(BLANK);
  return (
    <div className="card">
      <h2>ذی‌نفعان پروژه</h2>
      {may && (data.companies.length === 0 ? <p className="empty-note">اول در «شرکت‌ها» شرکت تعریف کنید.</p> : (
        <form className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}
          onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "stakeholder", ...f }, () => (f.id ? "ذی‌نفع ویرایش شد." : "ذی‌نفع اضافه شد."))) setF(BLANK); }}>
          <div className="field"><label htmlFor="sh-co">شرکت</label><select id="sh-co" required value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
            <option value="">—</option>{data.companies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select></div>
          <div className="field"><label htmlFor="sh-role">نقش</label><select id="sh-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {Object.entries(data.roles).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
          <div className="field"><label htmlFor="sh-note">توضیح</label><input id="sh-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          <button className="btn" type="submit">{f.id ? "ذخیرهٔ تغییرات" : "افزودن"}</button>
          {f.id && <button className="btn ghost" type="button" onClick={() => setF(BLANK)}>انصراف</button>}
        </form>))}
      {data.stakeholders.length === 0 ? <p className="empty-note">هنوز ذی‌نفعی ثبت نشده.</p> : (
        <table className="dtable"><thead><tr><th>نقش</th><th>شرکت</th><th>توضیح</th>{may && <th />}</tr></thead>
          <tbody>{data.stakeholders.map((s) => (
            <tr key={s.id}><td>{data.roles[s.role]}</td><td><span className="mono">{s.code}</span> — {s.name}</td><td className="sm">{s.note || "—"}</td>
              {may && <td><button className="btn ghost sm" type="button" onClick={() => setF({ id: s.id, companyId: s.company_id, role: s.role, note: s.note || "" })}>ویرایش</button>
                <button className="btn ghost sm" type="button" onClick={() => post({ kind: "stakeholder-remove", id: s.id })}>حذف</button></td>}</tr>
          ))}</tbody></table>)}
    </div>
  );
}

function Money({ data, may, post }) {
  const [c, setC] = useState({ code: "", name: "", rate: "" });
  const [b, setB] = useState({ id: null, title: "", currency: "", amount: "", note: "" });
  const rate = new Map(data.currencies.map((x) => [x.code, Number(x.rate)]));
  return (
    <div className="card">
      <h2>ارزها و بودجهٔ پروژه</h2>
      <h3>ارزها</h3>
      <p className="sm muted">ارزش هر ارز در واحد پایه: مثلاً اگر واحد پایه دلار باشد، USD = 1 و IRR = 0.00732.</p>
      {may && (
        <form className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}
          onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "currency", ...c }, (r) => `${r.row.code} ثبت شد.`)) setC({ code: "", name: "", rate: "" }); }}>
          <div className="field"><label htmlFor="cu-code">کد</label><input id="cu-code" dir="ltr" required maxLength={3} value={c.code} onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase() })} placeholder="USD" /></div>
          <div className="field"><label htmlFor="cu-name">نام</label><input id="cu-name" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="cu-rate">ارزش در واحد پایه</label><input id="cu-rate" dir="ltr" required inputMode="decimal" value={c.rate} onChange={(e) => setC({ ...c, rate: e.target.value })} /></div>
          <button className="btn" type="submit">ثبت ارز</button>
        </form>)}
      <table className="dtable"><thead><tr><th>کد</th><th>نام</th><th>ارزش در واحد پایه</th>{may && <th />}</tr></thead>
        <tbody>{data.currencies.map((x) => <tr key={x.id}><td className="mono">{x.code}</td><td>{x.name}</td><td className="mono" dir="ltr">{Number(x.rate)}</td>
          {may && <td><button className="btn ghost sm" type="button" onClick={() => setC({ code: x.code, name: x.name, rate: String(Number(x.rate)) })}>ویرایش</button></td>}</tr>)}</tbody></table>
      <h3 style={{ marginTop: 16 }}>بودجه‌ها</h3>
      {may && data.currencies.length > 0 && (
        <form className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}
          onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "budget", ...b }, () => (b.id ? "بودجه ویرایش شد." : "بودجه ثبت شد."))) setB({ id: null, title: "", currency: b.currency, amount: "", note: "" }); }}>
          <div className="field"><label htmlFor="bu-t">عنوان</label><input id="bu-t" required value={b.title} onChange={(e) => setB({ ...b, title: e.target.value })} /></div>
          <div className="field"><label htmlFor="bu-c">ارز</label><select id="bu-c" required value={b.currency} onChange={(e) => setB({ ...b, currency: e.target.value })}>
            <option value="">—</option>{data.currencies.map((x) => <option key={x.code} value={x.code}>{x.code}</option>)}</select></div>
          <div className="field"><label htmlFor="bu-a">مبلغ</label><input id="bu-a" dir="ltr" required inputMode="decimal" value={b.amount} onChange={(e) => setB({ ...b, amount: e.target.value })} /></div>
          <div className="field"><label htmlFor="bu-n">توضیح</label><input id="bu-n" value={b.note} onChange={(e) => setB({ ...b, note: e.target.value })} /></div>
          <button className="btn" type="submit">{b.id ? "ذخیرهٔ بودجه" : "افزودن بودجه"}</button>
          {b.id && <button className="btn ghost" type="button" onClick={() => setB({ id: null, title: "", currency: b.currency, amount: "", note: "" })}>انصراف</button>}
        </form>)}
      {data.budgets.length === 0 ? <p className="empty-note">هنوز بودجه‌ای ثبت نشده.</p> : (
        <table className="dtable"><thead><tr><th>عنوان</th><th>ارز</th><th>مبلغ</th><th>به واحد پایه</th><th>توضیح</th>{may && <th />}</tr></thead>
          <tbody>{data.budgets.map((x) => (
            <tr key={x.id}><td>{x.title}</td><td className="mono">{x.currency}</td><td className="mono">{fmt(x.amount)}</td>
              <td className="mono">{fmt(Number(x.amount) * (rate.get(x.currency) || 0))}</td><td className="sm">{x.note || "—"}</td>
              {may && <td><button className="btn ghost sm" type="button" onClick={() => setB({ id: x.id, title: x.title, currency: x.currency, amount: String(Number(x.amount)), note: x.note || "" })}>ویرایش</button>
                <button className="btn ghost sm" type="button" onClick={() => post({ kind: "budget-remove", id: x.id })}>حذف</button></td>}</tr>))}
            <tr><td colSpan={3}><b>جمع به واحد پایه</b></td><td className="mono"><b>{fmt(data.budgetInBase)}</b></td><td colSpan={may ? 2 : 1} /></tr>
          </tbody></table>)}
    </div>
  );
}
