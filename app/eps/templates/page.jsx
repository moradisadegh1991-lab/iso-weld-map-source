"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { useTreeDrag } from "../../../components/ui/treeDrag";

import TableKit from "../../../components/ui/TableKit";
/**
 * Activity templates: a tree of templates, each with its activities — row
 * number (its code is the template's code and two digits), name, W.F and
 * description. A template is copied with its activities and pasted as the
 * child of another; templates move by drag and drop. Each template opens
 * and closes in the tree to show its sub-templates and its activities; «اعمال
 * روی WBS» pushes the template's activities as they are now onto every WBS
 * node that took them (lib/db/repos/eps.mjs syncTemplate).
 */
const BLANK_T = { id: null, parentId: "", code: "", name: "", description: "" };
const BLANK_A = { id: null, number: "", name: "", wf: "", description: "" };
const tree = (rows) => {
  const by = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const r of by.values()) (r.parent_id && by.has(r.parent_id) ? by.get(r.parent_id).children : roots).push(r);
  const sort = (xs) => { xs.sort((a, b) => a.seq - b.seq || a.code.localeCompare(b.code)); xs.forEach((x) => sort(x.children)); };
  sort(roots);
  return roots;
};

export default function TemplatesPage() {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/eps?projectId=${id}&templates=1`, []);
  const [sel, setSel] = useState(null);
  const [tf, setTf] = useState(null);
  const [af, setAf] = useState(BLANK_A);
  const [clip, setClip] = useState(null);
  const [shut, setShut] = useState(new Set());       // templates closed in the tree
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/eps", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  const dnd = useTreeDrag((d, t, zone) => post(zone === "inside" ? { kind: "template-move", id: d.id, parentId: t.id }
    : { kind: "template-move", id: d.id, parentId: t.parentId || null, [zone === "before" ? "beforeId" : "afterId"]: t.id }, () => "الگو جابه‌جا شد."));
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const may = data.may.edit;
  const T = data.templates.find((t) => t.id === sel) || null;
  const flip = (id) => setShut((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function sync(t) {
    setMsg(null); setOk(null);
    try {
      const dry = (await call("/api/eps", { method: "POST", body: JSON.stringify({ projectId, kind: "template-sync", templateId: t.id, dryRun: true }) })).row;
      if (!dry.updated && !dry.added) { setOk(`فعالیت‌های WBS با الگوی ${t.code} یکی هستند؛ تغییری لازم نیست.`); return; }
      if (!window.confirm(`الگوی ${t.code}: ${dry.updated} فعالیت به‌روز و ${dry.added} فعالیت اضافه می‌شود، در گره‌های ${dry.nodes.join("، ")} (نسخه‌های ${dry.versions.join("، ")}). ادامه؟`)) return;
      await post({ kind: "template-sync", templateId: t.id }, (r) => `اعمال شد: ${r.row.updated} فعالیت به‌روز، ${r.row.added} فعالیت اضافه.`);
    } catch (e) { setMsg(e.message); }
  }
  const rows = (nodes, depth) => nodes.flatMap((t) => [
    <tr key={t.id} data-template={t.code} {...(may ? { ...dnd.source({ id: t.id }), ...dnd.target({ id: t.id, parentId: t.parent_id }) } : {})}
      onClick={() => { setSel(t.id); setAf(BLANK_A); }}
      style={{ cursor: "pointer", background: sel === t.id ? "var(--hl, #eef6f8)" : undefined, ...dnd.look({ id: t.id }) }}>
      <td style={{ paddingInlineStart: 8 + depth * 20, whiteSpace: "nowrap" }}>
        <button type="button" className="btn ghost sm" style={{ padding: "0 4px", visibility: t.children.length || t.activities.length ? "visible" : "hidden" }}
          aria-label={shut.has(t.id) ? "باز کردن" : "بستن"} onClick={(e) => { e.stopPropagation(); flip(t.id); }}>{shut.has(t.id) ? "◂" : "▾"}</button>
        {may && <span className="muted" aria-hidden="true">⠿ </span>}<span className="mono">{t.code}</span></td>
      <td>{t.name}</td><td className="mono">{t.activities.length}</td>
      <td className="mono" style={{ color: t.wfTotal > 100 ? "var(--bad)" : undefined }}>{t.activities.length ? `${t.wfTotal}٪` : "—"}</td>
      <td style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>{may && <>
        <button className="btn ghost sm" type="button" onClick={() => { setClip(t); setOk(`الگوی ${t.code} کپی شد؛ «چسباندن» را روی الگوی مقصد بزنید.`); }}>کپی</button>
        {clip && clip.id !== t.id && <button className="btn ghost sm" type="button"
          onClick={() => post({ kind: "template-copy", id: clip.id, parentId: t.id }, (r) => `الگوی ${r.row.code} زیر ${t.code} ساخته شد.`)}>چسباندن</button>}
        <button className="btn ghost sm" type="button" onClick={() => setTf({ ...BLANK_T, parentId: t.id })}>+ زیرالگو</button>
        <button className="btn ghost sm" type="button" onClick={() => setTf({ id: t.id, parentId: t.parent_id || "", code: t.code, name: t.name, description: t.description || "" })}>ویرایش</button>
        <button className="btn ghost sm" type="button" onClick={() => post({ kind: "template-remove", id: t.id }, () => "حذف شد.")}>حذف</button></>}</td>
    </tr>,
    ...(shut.has(t.id) ? [] : [
      ...t.activities.map((a) => (
        <tr key={a.id} className="sm" data-tree-activity={a.code} onClick={() => { setSel(t.id); setAf({ id: a.id, number: String(a.number), name: a.name, wf: a.wf ?? "", description: a.description || "" }); }}
          style={{ cursor: "pointer" }}>
          <td style={{ paddingInlineStart: 34 + depth * 20 }}><span className="mono muted">{a.code}</span></td><td className="muted">{a.name}</td><td />
          <td className="mono muted">{a.wf ?? "—"}</td><td /></tr>)),
      ...rows(t.children, depth + 1)])]);
  const all = (ns) => ns.flatMap((t) => [t.id, ...all(t.children)]);
  const flat = data.templates;
  return (
    <div className="page">
      <div className="pagehead"><h1>الگوهای فعالیت</h1><span className="sub">الگوها به‌صورت درختی، هر الگو با فعالیت‌های زیرمجموعه؛ کپی و چسباندن با فعالیت‌ها</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      {may && !tf && <p style={{ display: "flex", gap: 8 }}><button className="btn" type="button" onClick={() => setTf({ ...BLANK_T })}>+ الگوی تازه</button>
        {clip && <button className="btn ghost" type="button" onClick={() => post({ kind: "template-copy", id: clip.id, parentId: null }, (r) => `الگوی ${r.row.code} در بالاترین سطح ساخته شد.`)}>چسباندن {clip.code} در بالاترین سطح</button>}</p>}
      {tf && (
        <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "template", ...tf, parentId: tf.parentId || null }, (r) => `الگوی ${r.row.code} ذخیره شد.`)) setTf(null); }}>
          <h2>{tf.id ? `ویرایش الگوی ${tf.code}` : tf.parentId ? `زیرالگوی ${flat.find((x) => x.id === tf.parentId)?.code}` : "الگوی تازه"}</h2>
          <div className="grid2">
            <div className="field"><label htmlFor="tp-code">کد الگو</label><input id="tp-code" dir="ltr" required value={tf.code} onChange={(e) => setTf({ ...tf, code: e.target.value.toUpperCase() })} placeholder="T-PIP" /></div>
            <div className="field"><label htmlFor="tp-name">نام الگو</label><input id="tp-name" required value={tf.name} onChange={(e) => setTf({ ...tf, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="tp-desc">توضیحات</label><input id="tp-desc" value={tf.description} onChange={(e) => setTf({ ...tf, description: e.target.value })} /></div>
          </div>
          <button className="btn" type="submit">ذخیره</button> <button className="btn ghost" type="button" onClick={() => setTf(null)}>انصراف</button>
        </form>)}
      <div className="card">
        <h2>الگوها</h2>
        {flat.length > 0 && <p className="row" style={{ gap: 6 }}>
          <button className="btn ghost sm" type="button" onClick={() => setShut(new Set())}>باز کردن همه</button>
          <button className="btn ghost sm" type="button" onClick={() => setShut(new Set(all(tree(flat))))}>بستن همه</button></p>}
        {flat.length === 0 ? <p className="empty-note">هنوز الگویی نیست.</p> : (
          <div className="tablewrap"><TableKit name="eps-templates-1"><table className="dtable">
            <thead><tr><th>کد</th><th>نام</th><th>فعالیت</th><th>جمع W.F</th><th /></tr></thead>
            <tbody>{rows(tree(flat), 0)}</tbody></table></TableKit></div>)}
        {may && flat.length > 1 && <p className="sm muted">الگو را روی الگوی دیگر رها کنید تا زیر آن برود؛ بالا یا پایینش رها کنید تا ترتیب عوض شود.</p>}
      </div>
      {T && (
        <div className="card">
          <h2>فعالیت‌های الگوی <span className="mono">{T.code}</span> — {T.name}</h2>
          {may && T.activities.length > 0 && <p><button className="btn" type="button" data-sync={T.code} onClick={() => sync(T)}>اعمال تغییرات الگو روی فعالیت‌های WBS</button>
            <span className="sm muted"> نام، W.F، توضیحات و شمارهٔ هر فعالیت روی فعالیت‌هایی که از این الگو الصاق شده‌اند نوشته می‌شود و فعالیت تازهٔ الگو به گره‌هایی که الگو را گرفته‌اند اضافه می‌شود؛ اگر جایی جمع W.F از ۱۰۰٪ بگذرد هیچ تغییری اعمال نمی‌شود.</span></p>}
          <TableKit name="eps-templates-2"><table className="dtable">
            <thead><tr><th>ردیف</th><th>کد فعالیت</th><th>نام فعالیت</th><th>درصد وزنی W.F</th><th>توضیحات</th>{may && <th />}</tr></thead>
            <tbody>{T.activities.map((a) => (
              <tr key={a.id} data-template-activity={a.code}><td className="mono">{a.number}</td><td className="mono">{a.code}</td><td>{a.name}</td><td className="mono">{a.wf ?? "—"}</td>
                <td className="sm">{a.description || "—"}</td>
                {may && <td><button className="btn ghost sm" type="button" onClick={() => setAf({ id: a.id, number: String(a.number), name: a.name, wf: a.wf ?? "", description: a.description || "" })}>ویرایش</button>
                  <button className="btn ghost sm" type="button" onClick={() => post({ kind: "template-activity-remove", id: a.id }, () => "حذف شد.")}>حذف</button></td>}</tr>))}
              {T.activities.length > 0 && <tr><td colSpan={3}><b>جمع</b></td><td className="mono"><b>{T.wfTotal}٪</b></td><td colSpan={may ? 2 : 1} /></tr>}</tbody></table></TableKit>
          {may && (
            <form className="row" style={{ gap: 6, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}
              onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "template-activity", templateId: T.id, ...af }, () => (af.id ? "فعالیت ویرایش شد." : "فعالیت اضافه شد."))) setAf(BLANK_A); }}>
              <div className="field" style={{ width: 90 }}><label htmlFor="ta-n">ردیف (خالی: بعدی)</label><input id="ta-n" dir="ltr" inputMode="numeric" value={af.number} onChange={(e) => setAf({ ...af, number: e.target.value })} /></div>
              <div className="field"><label htmlFor="ta-name">نام فعالیت</label><input id="ta-name" required value={af.name} onChange={(e) => setAf({ ...af, name: e.target.value })} /></div>
              <div className="field" style={{ width: 110 }}><label htmlFor="ta-wf">W.F ٪</label><input id="ta-wf" dir="ltr" inputMode="decimal" value={af.wf} onChange={(e) => setAf({ ...af, wf: e.target.value })} /></div>
              <div className="field"><label htmlFor="ta-d">توضیحات</label><input id="ta-d" value={af.description} onChange={(e) => setAf({ ...af, description: e.target.value })} /></div>
              <button className="btn" type="submit">{af.id ? "ذخیره" : "افزودن فعالیت"}</button>
              {af.id && <button className="btn ghost" type="button" onClick={() => setAf(BLANK_A)}>انصراف</button>}
            </form>)}
        </div>)}
    </div>
  );
}
