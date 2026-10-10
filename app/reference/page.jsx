"use client";
import Link from "next/link";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import Tabs from "../../components/ui/Tabs";

/**
 * How an EPC project for a petrochemical plant or refinery runs, and where
 * the platform carries each part: phases and gates, deliverables, handover
 * certificates and checklists, standards. The checklists and standards
 * become the project's only when a person adopts them.
 */
export default function ReferencePage() {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/reference?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/reference", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const may = data.may.edit;

  return (
    <div className="page">
      <div className="pagehead"><h1>مرجع EPC</h1>
        <span className="sub">چرخهٔ پروژهٔ EPC پتروشیمی و پالایشگاه — فازها، مدارک، تحویل و استانداردها، و جای هرکدام در پلتفرم</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      <p className="sm muted">این صفحه راهنمای رویهٔ رایج صنعت است (NORSOK Z-007، FIDIC Silver Book، IOGP/CFIHOS، ISO 14224، IPS). تصمیم با قرارداد و مشخصات فنی پروژه است؛
        چک‌لیست‌ها و استانداردها فقط وقتی مال پروژه می‌شوند که شخصی آن‌ها را بپذیرد.</p>

      <Tabs name="reference">
        <div className="card">
          <h2>فازها و دروازه‌ها</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "stretch" }}>
            {data.phases.map((p, i) => (
              <div key={p.code} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="card" style={{ margin: 0, padding: "10px 12px", width: 210, minHeight: 150 }}>
                  <div className="sm muted mono" dir="ltr">{p.code} · {p.en}</div>
                  <b>{p.title}</b>
                  <div className="sm" style={{ marginTop: 4 }}>{p.work}</div>
                  <div className="sm" style={{ marginTop: 6, color: "var(--cy)" }}>◆ {p.gate}</div>
                  {p.href && <div className="sm"><Link href={p.href}>در پلتفرم ←</Link></div>}
                </div>
                {i < data.phases.length - 1 && <span aria-hidden="true" style={{ fontSize: 20, color: "var(--dim)" }}>◂</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>مدارک هر رشته</h2>
          {data.deliverables.map((d) => (
            <section key={d.discipline}>
              <h3>{d.discipline}</h3>
              <table className="dtable"><thead><tr><th>مدرک</th><th>فاز صدور</th><th>در پلتفرم / آنچه خوانده می‌شود</th></tr></thead>
                <tbody>{d.docs.map(([t, ph, where]) => (
                  <tr key={t}><td>{t}</td><td className="sm mono">{ph}</td>
                    <td className="sm">{where ? (where.startsWith("/") ? <Link href={where.split(" ")[0]}>{where}</Link> : where) : <span className="muted">—</span>}</td></tr>
                ))}</tbody></table>
            </section>
          ))}
          <p className="sm">مدارکی که ستون آخرشان شماره‌هایی را نام می‌برد، پس از کد ۱/۲ در <Link href="/documents/intake">خواندن مدارک</Link> خوانده می‌شوند.</p>
        </div>

        <div className="card">
          <h2>گواهی‌های تحویل</h2>
          <table className="dtable"><thead><tr><th>گواهی</th><th>شرط</th><th>در پلتفرم</th></tr></thead>
            <tbody>{data.certificates.map((c) => (
              <tr key={c.code}><td><b className="mono">{c.code}</b><div className="sm">{c.title}</div></td>
                <td className="sm"><ul style={{ margin: 0 }}>{c.requires.map((r) => <li key={r}>{r}</li>)}</ul></td>
                <td className="sm"><Link href={c.href}>{c.href}</Link><div className="muted">{c.platform}</div></td></tr>
            ))}</tbody></table>
        </div>

        <div className="card">
          <h2>چک‌لیست‌های تحویل</h2>
          <p className="sm">چک‌لیست‌های پیش‌راه‌اندازی (ITR-B) و راه‌اندازی. با «پذیرش» به چک‌لیست‌های پروژه در <Link href="/precom">پیش‌راه‌اندازی</Link> اضافه می‌شوند و از آن پس نسخهٔ پروژه است.
            چک‌لیست‌های MC (ITR-A) را ماژول تکمیل از خود رکوردها (تست، پانچ، NCR) حساب می‌کند و تیک دستی نمی‌خورد.</p>
          {data.checklists.map((c) => {
            const adopted = data.adopted.includes(c.code);
            return (
              <details key={c.code} className="inlinefold" style={{ marginBottom: 8 }}>
                <summary><b className="mono">{c.code}</b> — {c.title} <span className="sm muted">({data.precomPhases[c.phase]} · {data.applies[c.appliesTo]})</span>
                  {adopted && <span className="pill ok" style={{ marginInlineStart: 8 }}>پذیرفته در پروژه</span>}</summary>
                <ol className="sm">{c.items.map((x) => <li key={x}>{x}</li>)}</ol>
                {may && !adopted && <button className="btn sm" type="button" onClick={() => post({ kind: "adopt", code: c.code }, () => `${c.code} به چک‌لیست‌های پروژه اضافه شد.`)}>پذیرش در پروژه</button>}
              </details>
            );
          })}
        </div>

        <StandardsCard data={data} may={may} post={post} />
      </Tabs>
    </div>
  );
}

function StandardsCard({ data, may, post }) {
  const BLANK = { code: "", title: "", edition: "", scope: "", source: "" };
  const [f, setF] = useState(BLANK);
  const mine = new Map(data.projectStandards.map((s) => [s.code, s]));
  return (
    <div className="card">
      <h2>استانداردها</h2>
      <h3>رجیستر استانداردهای این پروژه</h3>
      <p className="sm">ویرایش هر استاندارد واقعیتی از قرارداد پروژه است و حدس زده نمی‌شود؛ استانداردی بدون ویرایش در «اطلاعات ناقص» می‌آید.</p>
      {data.projectStandards.length === 0 ? <p className="empty-note">هنوز استانداردی برای پروژه ثبت نشده.</p> : (
        <table className="dtable"><thead><tr><th>کد</th><th>عنوان</th><th>ویرایش</th><th>دامنه</th><th>منبع</th>{may && <th />}</tr></thead>
          <tbody>{data.projectStandards.map((s) => (
            <tr key={s.id}><td className="mono"><bdi>{s.code}</bdi></td><td className="sm">{s.title || "—"}</td>
              <td className="mono">{s.edition || <span className="err sm">ثبت نشده</span>}</td><td className="sm">{s.scope || "—"}</td><td className="sm">{s.source || "—"}</td>
              {may && <td style={{ whiteSpace: "nowrap" }}><button className="btn ghost sm" type="button" onClick={() => setF({ code: s.code, title: s.title || "", edition: s.edition || "", scope: s.scope || "", source: s.source || "" })}>ویرایش</button>
                <button className="btn ghost sm" type="button" onClick={() => post({ kind: "standard-remove", id: s.id })}>حذف</button></td>}</tr>
          ))}</tbody></table>
      )}
      {may && (
        <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "standard", ...f }, (r) => `${r.row.code} ثبت شد.`)) setF(BLANK); }}>
          <div className="grid2">
            {[["code", "کد (مثلاً ASME B31.3)"], ["edition", "ویرایش (مثلاً 2022)"], ["title", "عنوان"], ["scope", "دامنه در این پروژه"], ["source", "منبع (پیوست قرارداد، مشخصات فنی…)"]].map(([k, l]) => (
              <div className="field" key={k}><label htmlFor={`st-${k}`}>{l}</label><input id={`st-${k}`} dir={k === "code" || k === "edition" ? "ltr" : undefined}
                required={k === "code"} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
            ))}
          </div>
          <button className="btn" type="submit">ثبت استاندارد</button>
        </form>
      )}
      <h3 style={{ marginTop: 16 }}>استانداردهای رایج و جای آن‌ها در پلتفرم</h3>
      {data.standards.map((g) => (
        <section key={g.group}>
          <h4>{g.group}</h4>
          <table className="dtable"><thead><tr><th>کد</th><th>موضوع</th><th>در پلتفرم</th>{may && <th />}</tr></thead>
            <tbody>{g.items.map(([code, title, engine]) => (
              <tr key={code}><td className="mono"><bdi>{code}</bdi></td><td className="sm">{title}</td><td className="sm">{engine || <span className="muted">—</span>}</td>
                {may && <td>{mine.has(code.toUpperCase()) ? <span className="pill ok">در رجیستر</span>
                  : <button className="btn ghost sm" type="button" onClick={() => setF({ ...BLANK, code, title })}>افزودن به پروژه</button>}</td>}</tr>
            ))}</tbody></table>
        </section>
      ))}
    </div>
  );
}
