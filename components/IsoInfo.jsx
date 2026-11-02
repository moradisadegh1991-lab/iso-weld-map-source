"use client";
import { useRef, useState } from "react";
import Pick from "./ui/Pick";
import { COLUMN_LIST } from "../lib/register/value-lists.mjs";
import { INFO_SECTIONS, infoProblems, infoValue } from "../lib/register/iso-info.mjs";

/**
 * The isometric's own information, in logical sections (lib/register/iso-info.mjs):
 *
 *   View  every value, read-only, «نامعلوم» where nobody gave one; what the
 *         register keeps of the run beside it.
 *   Edit  the same values as fields (project lists as pickers), with the
 *         problems that apply — a missing drawing number or revision blocks
 *         «اعمال», the rest are warnings. «اعمال» takes the edit into the page's
 *         state (it is saved with the register); «انصراف» puts every value
 *         back as it was when Edit was opened; leaving a changed form asks.
 *
 *   meta, lineData       the page's two stores (lineData may be null: not read)
 *   onMeta(next), onLineData(next)   called with the whole new object
 *   lists                the project's pick lists (components/ui/Pick.jsx useValueLists)
 *   locked               an approved register: View only
 *   run                  the register saved in the system, when there is one
 */
const KIND = { draft: "پیش‌نویس", extracted: "استخراج‌شده", in_review: "در بازبینی", approved: "تأییدشده", superseded: "منسوخ" };

export default function IsoInfo({ meta, lineData, onMeta, onLineData, lists, locked = false, run = null }) {
  const [editing, setEditing] = useState(false);
  const snap = useRef(null);
  const line = lineData || {};
  const dirty = editing && snap.current && JSON.stringify([meta, lineData]) !== snap.current;
  const { errors, warnings } = infoProblems(meta, line);

  const open = () => { snap.current = JSON.stringify([meta, lineData]); setEditing(true); };
  const apply = () => { if (errors.length) return; snap.current = null; setEditing(false); };
  const cancel = () => {
    if (dirty && !window.confirm("تغییرهای این فرم برگردانده شود؟")) return;
    if (snap.current) { const [m, l] = JSON.parse(snap.current); onMeta?.(m); onLineData?.(l); }
    snap.current = null; setEditing(false);
  };
  const set = (f, v) => {
    if (f.from === "meta") {
      onMeta?.({ ...meta, [f.key]: v });
      // the line number is also a value of the line list the sheet printed: one value, two stores
      if (f.key === "lineNo" && lineData) onLineData?.({ ...lineData, lineNo: v });
    } else onLineData?.({ ...line, [f.key]: v });
  };
  const missing = <span className="muted">نامعلوم</span>;

  return (
    <div className="iso-info" data-iso-info data-mode={editing ? "edit" : "view"}>
      <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <b>مشخصات نقشه</b>
        <span className="muted sm">{editing ? "حالت ویرایش" : "فقط دیدن"}</span>
        <span className="grow" />
        {!editing && !locked && <button type="button" data-iso-edit onClick={open}>ویرایش</button>}
        {!editing && locked && <span className="muted sm">رجیستر تأیید شده — ویرایش بسته است</span>}
        {editing && <>
          {dirty && <span className="pill warn" data-iso-dirty>تغییرات اعمال‌نشده</span>}
          <button type="button" data-iso-apply onClick={apply} disabled={errors.length > 0}>اعمال</button>
          <button type="button" className="ghost" data-iso-cancel onClick={cancel}>انصراف</button>
        </>}
      </div>

      {editing && errors.length > 0 && <ul className="err sm" role="alert" data-iso-errors style={{ margin: "6px 0", paddingInlineStart: 18 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {warnings.length > 0 && <ul className="sm" data-iso-warnings style={{ margin: "6px 0", paddingInlineStart: 18 }}>{warnings.map((w) => <li key={w} className="warnish">{w}</li>)}</ul>}
      {!lineData && !editing && <p className="muted sm">مشخصات خط (فشار، دما، تست…) از این نقشه خوانده نشده؛ در حالت ویرایش می‌توانید وارد کنید.</p>}

      {INFO_SECTIONS.map((s) => (
        <section key={s.id} className="iso-info-sec" data-info-section={s.id}>
          <h4>{s.title}</h4>
          {editing ? (
            <div className="wl-grid">
              {s.fields.map((f) => {
                const list = COLUMN_LIST[f.key];
                const v = f.from === "meta" ? meta?.[f.key] : line[f.key];
                return (
                  <label key={f.key} className="wl-f">
                    <span className="muted sm">{f.label}{f.required && " *"}</span>
                    {list
                      ? <Pick data-info={f.key} id={`wl-${f.key}`} list={list} lists={lists} value={v} onChange={(x) => set(f, x)} />
                      : <input data-info={f.key} id={f.from === "meta" ? `wl-${f.key}` : undefined} dir="ltr" value={v ?? ""} required={f.required} aria-invalid={f.required && !String(v ?? "").trim() ? "true" : undefined}
                          placeholder={f.hint || (f.from === "line" ? "خوانده نشد" : "")} onChange={(e) => set(f, e.target.value)} />}
                  </label>);
              })}
            </div>
          ) : (
            <dl className="ws-insp-dl" style={{ gridTemplateColumns: "minmax(110px, auto) 1fr" }}>
              {s.fields.map((f) => { const v = infoValue(f, meta, line); return (
                <div key={f.key} style={{ display: "contents" }} data-info-row={f.key}>
                  <dt>{f.label}</dt><dd className="mono" dir="ltr">{v || missing}</dd>
                </div>); })}
            </dl>
          )}
        </section>))}

      {run?.run && (
        <section className="iso-info-sec" data-info-section="register">
          <h4>ثبت در سامانه (فقط دیدن)</h4>
          <dl className="ws-insp-dl" style={{ gridTemplateColumns: "minmax(110px, auto) 1fr" }}>
            <div style={{ display: "contents" }}><dt>وضعیت رجیستر</dt><dd>{KIND[run.run.status] || run.run.status}</dd></div>
            <div style={{ display: "contents" }}><dt>نقشه و رویژن ثبت‌شده</dt><dd className="mono" dir="ltr">{run.run.docNo} · Rev {run.run.revision}</dd></div>
            <div style={{ display: "contents" }}><dt>تعداد جوش در رجیستر</dt><dd className="mono">{run.register?.length ?? 0}</dd></div>
            {run.run.approvedBy && <div style={{ display: "contents" }}><dt>تأییدکننده</dt><dd>{run.run.approvedBy}</dd></div>}
          </dl>
        </section>)}
    </div>
  );
}
