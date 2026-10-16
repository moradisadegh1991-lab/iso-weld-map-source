"use client";
import { useState } from "react";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";

/**
 * Handover forms: the employer's supervision of a section designs the forms
 * the section's work is handed over on — header fields, the table's columns,
 * and whether the rows come from the work the employer accepted that day —
 * then sets the form's workflow (stages, groups, signers) and its print
 * layout. Each form is a tile of its own, given to people one by one.
 */
const BLANK_FIELD = { label: "", key: "", type: "text", required: false, options: "", bind: "" };
const BLANK = { id: null, code: "", name: "", description: "", section: "", source: "", header: [], columns: [] };
// a starting point for a form whose rows are the day's accepted work: every column bound to what that work carries
const WORK_COLUMNS = [
  { label: "آیتم", type: "text", bind: "item" }, { label: "مرحلهٔ کار", type: "text", bind: "step" },
  { label: "پیمانکار", type: "text", bind: "contractor" }, { label: "تاریخ انجام", type: "date", bind: "doneAt" },
  { label: "شمارهٔ مرجع", type: "text", bind: "refNo" }, { label: "تحویل‌گیرندهٔ کارفرما", type: "text", bind: "approver" },
  { label: "ملاحظات", type: "text" },
].map((c) => ({ ...BLANK_FIELD, ...c }));

const toForm = (t) => ({ id: t.id, code: t.code, name: t.name, description: t.description || "", section: t.section, source: t.form.source || "",
  header: t.form.header.map((f) => ({ ...BLANK_FIELD, ...f, options: (f.options || []).join("، ") })),
  columns: t.form.columns.map((f) => ({ ...BLANK_FIELD, ...f, options: (f.options || []).join("، "), bind: f.bind || "" })) });
const toDefinition = (f) => ({ source: f.source || null,
  header: f.header.map(({ bind, ...x }) => ({ ...x, options: x.options })),
  columns: f.columns.map((x) => ({ ...x, bind: f.source ? x.bind || null : null })) });

export default function FormsPage() {
  const { projectId, call, reload: reloadShell } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/forms?projectId=${id}`, []);
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const L = data.labels;
  async function save(e) {
    e.preventDefault(); setMsg(null); setOk(null);
    try {
      const r = await call("/api/forms", { method: "POST", body: JSON.stringify({ projectId, kind: "save-type", id: f.id, code: f.code, name: f.name,
        description: f.description, section: f.section, definition: toDefinition(f) }) });
      setOk(`فرم ${r.row.code} ذخیره شد.${f.id ? "" : " گردش کار پیش‌فرض (پیمانکار ← نظارت کارفرما) ساخته شد؛ امضاکنندگان را تعیین کنید."}`);
      setF(null); reload(); reloadShell();          // a new form is a new tile in the menu
    } catch (e2) { setMsg(e2.message); }
  }
  return (
    <div className="page">
      <div className="pagehead"><h1>فرم‌های تحویل کار</h1>
        <span className="sub">طراحی فرم، گردش کار و امضاکنندگان، و قالب چاپ — با نظارت کارفرمای هر بخش</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      <div className="card">
        <h2>فرم‌ها</h2>
        {data.types.length === 0 ? <p className="empty-note">هنوز فرمی طراحی نشده است.</p> : (
          <div className="tiles">{data.types.map((t) => (
            <div key={t.id} className="tile" style={{ cursor: "default" }} data-form={t.code}>
              <span className="ic">⇄</span>
              <span className="t">{t.name}</span>
              <span className="d"><span className="mono">{t.code}</span> · {L.sections[t.section]} · {t.form.columns.length} ستون · {t.reports} گزارش
                {t.form.source && " · ردیف‌ها از کار تحویل‌گرفته"}</span>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                <Link className="btn sm" href={`/forms/${t.code}`}>گزارش‌ها</Link>
                {data.designable.includes(t.section) && <>
                  <button className="btn ghost sm" type="button" onClick={() => { setF(toForm(t)); setOk(null); }}>ویرایش طراحی</button>
                  <Link className="btn ghost sm" href={`/report-setup?type=${t.id}`}>گردش کار و امضاکنندگان</Link>
                  <Link className="btn ghost sm" href={`/report-print-setup?type=${t.code}`}>قالب چاپ</Link></>}
              </span>
            </div>))}</div>)}
      </div>
      {data.designable.length > 0 && !f && (
        <p><button className="btn" type="button" onClick={() => setF({ ...BLANK, section: data.designable[0], columns: [{ ...BLANK_FIELD }] })}>+ طراحی فرم تازه</button></p>)}
      {data.designable.length === 0 && <p className="sm muted">طراحی فرم با مدیر پروژه، یا با عضوی است که «طرف بازرسی: کارفرما» دارد و در آن بخش کار می‌کند.</p>}
      {f && <Designer f={f} setF={setF} L={L} sections={data.designable} save={save} />}
    </div>
  );
}

function FieldRows({ list, set, L, kind, source }) {
  const put = (i, k, v) => set(list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const move = (i, d) => { const n = [...list]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); set(n); };
  return (
    <div className="tablewrap"><table className="dtable">
      <thead><tr><th>#</th><th>عنوان</th><th>کلید (لاتین)</th><th>نوع</th><th>گزینه‌ها (برای انتخابی)</th><th>لازم</th>{kind === "column" && source && <th>پر شدن خودکار از</th>}<th /></tr></thead>
      <tbody>{list.map((x, i) => (
        <tr key={i} data-field-row={kind}>
          <td className="mono">{i + 1}</td>
          <td><input aria-label={`عنوان ${i + 1}`} value={x.label} onChange={(e) => put(i, "label", e.target.value)} required /></td>
          <td><input aria-label={`کلید ${i + 1}`} dir="ltr" value={x.key} placeholder={`${kind === "header" ? "h" : "c"}${i + 1}`} onChange={(e) => put(i, "key", e.target.value)} style={{ width: 110 }} /></td>
          <td><select aria-label={`نوع ${i + 1}`} value={x.type} onChange={(e) => put(i, "type", e.target.value)}>
            {Object.entries(L.fieldTypes).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></td>
          <td>{x.type === "select" ? <input aria-label={`گزینه‌ها ${i + 1}`} value={x.options} placeholder="با ، جدا کنید" onChange={(e) => put(i, "options", e.target.value)} /> : <span className="muted">—</span>}</td>
          <td><input type="checkbox" aria-label={`لازم ${i + 1}`} checked={!!x.required} onChange={(e) => put(i, "required", e.target.checked)} /></td>
          {kind === "column" && source && <td><select aria-label={`منبع ${i + 1}`} value={x.bind} onChange={(e) => put(i, "bind", e.target.value)}>
            <option value="">— دستی —</option>{Object.entries(L.claimFields).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></td>}
          <td style={{ whiteSpace: "nowrap" }}>
            <button className="btn ghost sm" type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="بالا">▲</button>
            <button className="btn ghost sm" type="button" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="پایین">▼</button>
            <button className="btn ghost sm" type="button" onClick={() => set(list.filter((_, j) => j !== i))}>حذف</button></td>
        </tr>))}</tbody></table>
      <button className="btn ghost sm" type="button" onClick={() => set([...list, { ...BLANK_FIELD }])}>+ {kind === "header" ? "فیلد سربرگ" : "ستون"}</button>
    </div>
  );
}

function Designer({ f, setF, L, sections, save }) {
  return (
    <form className="card" onSubmit={save}>
      <h2>{f.id ? `ویرایش طراحی ${f.code}` : "فرم تازه"}</h2>
      {f.id && <p className="sm muted">گزارش‌هایی که پیش‌تر ساخته شده‌اند با همان طراحی زمان ساختشان می‌مانند؛ تغییر طراحی فقط گزارش‌های تازه را عوض می‌کند.</p>}
      <div className="grid2">
        <div className="field"><label htmlFor="fd-code">کد فرم (لاتین)</label><input id="fd-code" dir="ltr" required value={f.code} placeholder="HO-PIP"
          onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></div>
        <div className="field"><label htmlFor="fd-name">نام فرم</label><input id="fd-name" required value={f.name} placeholder="صورتجلسهٔ تحویل روزانهٔ کار پایپینگ"
          onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="fd-sec">بخش</label><select id="fd-sec" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })}>
          {sections.map((s) => <option key={s} value={s}>{L.sections[s]}</option>)}</select></div>
        <div className="field"><label htmlFor="fd-desc">توضیح</label><input id="fd-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      </div>
      <label className="sm" style={{ display: "flex", gap: 6, alignItems: "center", margin: "8px 0" }}>
        <input id="fd-src" type="checkbox" checked={f.source === "claims"} onChange={(e) => setF({ ...f, source: e.target.checked ? "claims" : "" })} />
        {L.sources.claims} — ردیف‌های گزارش هر روز از کارهایی پر می‌شود که نمایندهٔ کارفرما همان روز در این بخش تأیید کرده است</label>
      {f.source === "claims" && f.columns.every((c) => !c.bind) && (
        <p><button className="btn ghost sm" type="button" onClick={() => setF({ ...f, columns: WORK_COLUMNS })}>ستون‌های پیشنهادی برای کار تحویل‌گرفته</button></p>)}
      <h3>فیلدهای سربرگ <span className="sm muted">(یک بار در هر گزارش، مثل محدوده، شمارهٔ صورتجلسه، نمایندهٔ پیمانکار)</span></h3>
      <FieldRows list={f.header} set={(header) => setF({ ...f, header })} L={L} kind="header" />
      <h3 style={{ marginTop: 12 }}>ستون‌های جدول <span className="sm muted">(هر ردیف یک کار تحویل‌شده)</span></h3>
      <FieldRows list={f.columns} set={(columns) => setF({ ...f, columns })} L={L} kind="column" source={f.source === "claims"} />
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn" type="submit">{f.id ? "ذخیرهٔ طراحی" : "ساخت فرم"}</button>
        <button className="btn ghost" type="button" onClick={() => setF(null)}>انصراف</button>
      </div>
    </form>
  );
}
