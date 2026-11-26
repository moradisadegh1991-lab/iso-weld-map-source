"use client";
import InheritedStructure from "../../components/contracts/InheritedStructure";
import { useState } from "react";
import Link from "next/link";
import TreeEditor from "../../components/ui/TreeEditor";
import { SECTIONS } from "../../lib/platform/navigation.mjs";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";

/**
 * Handover forms: the employer's supervision of a section designs the forms
 * the section's work is handed over on — header fields, the table's columns,
 * and whether the rows come from the work the employer accepted that day —
 * then sets the form's workflow (stages, groups, signers) and its print
 * layout. Each form is a tile of its own, given to people one by one.
 */
const BLANK_FIELD = { label: "", key: "", type: "text", required: false, options: "", bind: "" };
const BLANK = { id: null, code: "", name: "", description: "", section: "", source: "", visibility: "project", navigation: "handover", header: [], columns: [] };
// a starting point for a form whose rows are the day's accepted work: every column bound to what that work carries
const WORK_COLUMNS = [
  { label: "آیتم", type: "text", bind: "item" }, { label: "مرحلهٔ کار", type: "text", bind: "step" },
  { label: "پیمانکار", type: "text", bind: "contractor" }, { label: "تاریخ انجام", type: "date", bind: "doneAt" },
  { label: "شمارهٔ مرجع", type: "text", bind: "refNo" }, { label: "تحویل‌گیرندهٔ کارفرما", type: "text", bind: "approver" },
  { label: "ملاحظات", type: "text" },
].map((c) => ({ ...BLANK_FIELD, ...c }));

const SCOPES = { contract: "قرارداد جاری", company:"شرکت", project: "پروژه جاری", global: "سراسری" };
const PARENTS = SECTIONS.flatMap((group) => group.items);
const scopeOf = (form) => form.published ? "global" : form.form_company_id ? "company" : form.form_contract_id ? "contract" : "project";

const toForm = (t) => ({ id: t.id, companyId: t.form_company_id || "", visibility: scopeOf(t), navigation: t.form_navigation || "handover", code: t.code, name: t.name, description: t.description || "", section: t.section, source: t.form.source || "",
  header: t.form.header.map((f) => ({ ...BLANK_FIELD, ...f, options: (f.options || []).join("، ") })),
  columns: t.form.columns.map((f) => ({ ...BLANK_FIELD, ...f, options: (f.options || []).join("، "), bind: f.bind || "" })) });
const toDefinition = (f) => ({ source: f.source || null,
  header: f.header.map(({ bind, ...x }) => ({ ...x, options: x.options })),
  columns: f.columns.map((x) => ({ ...x, bind: f.source ? x.bind || null : null })) });

export default function FormsPage() {
  const { projectId, contractId, role, call, reload: reloadShell } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/forms?projectId=${id}&contractId=${contractId}`, [contractId]);
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [busy, setBusy] = useState(false);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const L = data.labels;
  const admin = ["admin", "developer"].includes(role);
  const editable = (form) => !form.template && (!form.published || admin) && data.designable.includes(form.section);
  const tree = PARENTS.map((parent) => ({
    id: parent.key, name: parent.title,
    children: data.types.filter((type) => type.form_navigation === parent.key).map((type) => ({
      id: type.id || `shared-${type.code}`, name: `${type.code} — ${type.name}`, type,
    })),
  }));
  const newForm = (navigation = "handover") => setF({ ...BLANK, navigation, section: data.designable[0], columns: [{ ...BLANK_FIELD }] });
  async function send(kind, body, success) {
    if (busy) return false;
    setMsg(null); setOk(null); setBusy(true);
    try {
      await call("/api/forms", { method: "POST", body: JSON.stringify({ projectId, contractId: contractId || null, kind, ...body }) });
      setOk(success); await Promise.all([reload(), reloadShell()]); return true;
    } catch (error) { setMsg(error.message); return false; }
    finally { setBusy(false); }
  }
  function saveForm(form) {
    return send("save-type", { id: form.id, code: form.code, name: form.name, description: form.description,
      section: form.section, definition: toDefinition(form), navigation: form.navigation, visibility: form.visibility, companyId: form.companyId }, `فرم ${form.code} ذخیره شد.`);
  }
  async function save(event) {
    event.preventDefault();
    if (await saveForm(f)) setF(null);
  }
  async function move(id, parentId) {
    const form = data.types.find((type) => type.id === id);
    if (!form || !editable(form) || !PARENTS.some((parent) => parent.key === parentId) || form.form_navigation === parentId) return;
    if (await saveForm({ ...toForm(form), navigation: parentId })) setF(null);
  }
  return (
    <div className="page">
      <div className="pagehead"><h1>فرم‌های تحویل کار</h1>
        <span className="sub">طراحی فرم، گردش کار و امضاکنندگان، و قالب چاپ — با نظارت کارفرمای هر بخش</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      <div className="card">
        <h2>فرم‌ها</h2>
        <div className="form-tree-head"><b>فرم و کد</b><b>دسترسی</b></div>
        <TreeEditor nodes={tree} searchable editable={data.designable.length > 0} onMove={move}
          canDrag={(node) => !!node.type && editable(node.type)} canDrop={(node) => !!node && !node.type}
          render={(node) => !node.type ? node.name : <span className="form-tree-row">
            <Link href={`/forms/${node.type.code}`}>{node.name}</Link><span>{SCOPES[scopeOf(node.type)]}</span>
          </span>}
          actions={(node) => {
            const form = node.type;
            if (!form) return data.designable.length > 0 && <button className="btn ghost sm" type="button" disabled={busy} onClick={() => newForm(node.id)}>+ فرم</button>;
            if (!editable(form)) return null;
            return <span className="row" style={{ gap: 5 }}>
              <button className="btn ghost sm" type="button" disabled={busy} onClick={() => { setF(toForm(form)); setOk(null); }}>ویرایش</button>
              <button className="btn ghost sm" type="button" disabled={busy} onClick={async () => {
                if (window.confirm(`فرم «${form.name}» حذف شود؟`) && await send("remove-type", { id: form.id }, "فرم از فهرست حذف شد.") && f?.id === form.id) setF(null);
              }}>حذف</button>
              <Link className="btn ghost sm" href={`/report-setup?type=${form.id}`}>گردش کار</Link>
              <Link className="btn ghost sm" href={`/report-print-setup?type=${form.code}`}>قالب چاپ</Link>
            </span>;
          }} />
      </div>
      <InheritedStructure category="forms" title="فرم‌های مشترک" />
      {data.designable.length > 0 && !f && (
        <p><button className="btn" type="button" onClick={() => newForm()}>+ طراحی فرم تازه</button></p>)}
      {data.designable.length === 0 && <p className="sm muted">طراحی فرم با مدیر پروژه، یا با عضوی است که «طرف بازرسی: کارفرما» دارد و در آن بخش کار می‌کند.</p>}
      {f && <Designer companies={data.companies} f={f} setF={setF} L={L} sections={data.designable} save={save} busy={busy} admin={admin} contractId={contractId} />}
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

function Designer({ companies, f, setF, L, sections, save, busy, admin, contractId }) {
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
        <div className="field"><label htmlFor="fd-parent">فرم والد</label>
          <select id="fd-parent" value={f.navigation} onChange={(e) => setF({ ...f, navigation: e.target.value })}>
            {PARENTS.map((parent) => <option key={parent.key} value={parent.key}>{parent.title}</option>)}
          </select></div>
        <div className="field"><label htmlFor="fd-visibility">دسترسی</label>
          <select id="fd-visibility" value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value, source: ["contract","company"].includes(e.target.value) ? "" : f.source })}>
            {Object.entries(SCOPES).map(([key, label]) => <option key={key} value={key}
              disabled={["contract","company"].includes(key) && !contractId || key === "global" && !admin}>{label}</option>)}
          </select></div>
        {f.visibility === "company" && <label>شرکت ذی‌نفع <select required value={f.companyId || ""} onChange={(e) => setF({...f, companyId:e.target.value})}>
          <option value="">انتخاب شرکت</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <div className="field"><label htmlFor="fd-desc">توضیح</label><input id="fd-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      </div>
      <label className="sm" style={{ display: "flex", gap: 6, alignItems: "center", margin: "8px 0" }}>
        <input id="fd-src" type="checkbox" checked={f.source === "claims"} disabled={["contract","company"].includes(f.visibility)} onChange={(e) => setF({ ...f, source: e.target.checked ? "claims" : "" })} />
        {L.sources.claims} — ردیف‌های گزارش هر روز از کارهایی پر می‌شود که نمایندهٔ کارفرما همان روز در این بخش تأیید کرده است</label>
      {f.source === "claims" && f.columns.every((c) => !c.bind) && (
        <p><button className="btn ghost sm" type="button" onClick={() => setF({ ...f, columns: WORK_COLUMNS })}>ستون‌های پیشنهادی برای کار تحویل‌گرفته</button></p>)}
      <h3>فیلدهای سربرگ <span className="sm muted">(یک بار در هر گزارش، مثل محدوده، شمارهٔ صورتجلسه، نمایندهٔ پیمانکار)</span></h3>
      <FieldRows list={f.header} set={(header) => setF({ ...f, header })} L={L} kind="header" />
      <h3 style={{ marginTop: 12 }}>ستون‌های جدول <span className="sm muted">(هر ردیف یک کار تحویل‌شده)</span></h3>
      <FieldRows list={f.columns} set={(columns) => setF({ ...f, columns })} L={L} kind="column" source={f.source === "claims"} />
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn" type="submit" disabled={busy}>{f.id ? "ذخیرهٔ طراحی" : "ساخت فرم"}</button>
        <button className="btn ghost" type="button" onClick={() => setF(null)}>انصراف</button>
      </div>
    </form>
  );
}
