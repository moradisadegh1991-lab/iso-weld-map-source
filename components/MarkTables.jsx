"use client";
import { useState } from "react";
import { KINDS, ATTRS, addMark, updateMark, removeMark, unplace, isPlaced, notOnSheet, engineRow, problems, rules } from "../lib/sheet/markup.mjs";
import MarkShape from "./MarkShape";
import TableKit from "./ui/TableKit";
import Pick, { useValueLists } from "./ui/Pick";

// which list each column picks from, by the table it is in (null: typed by hand — numbers, lengths and notes)
const PICK = {
  weld: { type: "jointType", size: "nps", schedule: "schedule", material: "material", spool: "spools", wps: "wps" },
  spool: { size: "nps", material: "material" },
  support: { type: "supportType", size: "nps" },
};

/**
 * The one table of a sheet's welds, spools and supports. A row and its mark
 * on the drawing are one thing: picking either picks both, and each row ends
 * in what joins it to the drawing —
 *
 *   «اتصال به نقشه»          a row not on the drawing: the next click on the
 *                            sheet is its weld point; its frame and leader are made there
 *   «جابه‌جایی روی نقشه»     a row on the drawing: the next click is its new weld point
 *   «حذف»                    the row, and its mark, gone
 *
 * Rows a person adds here ("+") start not joined to the drawing, and a row
 * not on the drawing is named above the table. A weld row also shows what the
 * engine says of that weld (Shop/Field, level, NDT) beside the editable
 * details; those are the register's and are not edited here.
 *
 *   items       every mark of the sheet
 *   onChange    (items) after every edit
 *   model       buildModel() result, for the engine's columns (optional)
 *   selectedId  the mark picked on the sheet; onSelect(id) picks one here
 *   attachId    the mark whose weld point the sheet is waiting for; onAttach(id|null)
 *   tabs        which tables to show
 *   weldList    welds kept as rows beside the sheet (the weld-list form), for the spool rules
 *   checked     { has(no), onTick(no, on) } — a weld row ticked once a person has checked it against
 *               the drawing (the weld-list form); without it there is no tick column
 */
const TABS = [["weld", "سرجوش‌ها"], ["spool", "اسپول‌ها"], ["support", "ساپورت‌ها"]];
const NEW_KIND = { weld: "weld-unknown", spool: "spool", support: "support" };
const WORD = { weld: "سرجوش", spool: "اسپول", support: "ساپورت" };

export default function MarkTables({ items = [], onChange, model = null, selectedId = null, onSelect, attachId = null, onAttach,
  readOnly = false, tabs = ["weld", "spool", "support"], weldList = null, checked = null }) {
  const shown = TABS.filter(([k]) => tabs.includes(k));
  const [tab, setTab] = useState(shown[0]?.[0] || "weld");
  const lists = useValueLists();
  // a weld's spool is one of the spools on this sheet, when there are any
  const spoolNos = [...new Set(items.filter((m) => m.kind === "spool" && String(m.no ?? "").trim()).map((m) => String(m.no).trim()))];
  const rows = items.filter((m) => KINDS[m.kind]?.cls === tab);
  const loose = notOnSheet(items);
  const issues = [...problems(items), ...rules(items, weldList)];
  const set = (id, patch) => onChange?.(updateMark(items, id, patch));
  const add = () => {
    const next = addMark(items, { kind: NEW_KIND[tab] });
    onChange?.(next);
    const row = next[next.length - 1];
    onSelect?.(row.id);
    onAttach?.(row.id);   // the sheet waits for its weld point at once
  };
  const withEngine = tab === "weld" && model && !model.error;
  const ticks = tab === "weld" && checked;
  const colSpan = ATTRS[tab].length + 3 + (tab === "weld" ? 1 : 0) + (withEngine ? 2 : 0) + (ticks ? 1 : 0);
  return (
    <div className="mark-tables" data-mark-tables>
      <div className="row" style={{ gap: 4, flexWrap: "wrap" }} role="tablist">
        {shown.map(([k, label]) => (
          <button key={k} type="button" role="tab" data-mark-tab={k} className={tab === k ? "on" : "ghost"} onClick={() => setTab(k)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <MarkShape kind={k === "weld" ? "weld-shop" : k} no="" size={0.5} />
            {label} ({items.filter((m) => KINDS[m.kind]?.cls === k).length})
          </button>
        ))}
        <span className="grow" />
        {!readOnly && (
          <button type="button" className="ghost sm" data-mark-add={tab} onClick={add}>+ {WORD[tab]} (بعد روی نقشه، محل آن را کلیک کنید)</button>)}
      </div>

      {loose.length > 0 && (
        <p className="err sm" role="alert" data-loose>
          {loose.length} ردیف به نقشه وصل نیست: {loose.slice(0, 8).map((m) => `${WORD[KINDS[m.kind].cls]} ${m.no || "بدون شماره"}`).join("، ")}
          {loose.length > 8 ? "، …" : ""} — روی «اتصال به نقشه» در انتهای ردیف بزنید و محلش را روی نقشه کلیک کنید.
        </p>)}
      {attachId && <p className="note sm" data-attach-hint>روی نقشه، همان‌جا که سرجوش (یا اسپول/ساپورت) روی لوله است کلیک کنید. <button type="button" className="ghost sm" onClick={() => onAttach?.(null)}>انصراف</button></p>}

      <div style={{ overflowX: "auto" }}>
        <TableKit key={tab} name={`marks-${tab}`}><table className="dtable" data-mark-table={tab}>
          <thead><tr>
            {ticks && <th title="با نقشه بررسی شد">✓</th>}
            <th>شماره</th>
            {tab === "weld" && <th>محل</th>}
            {ATTRS[tab].map(([k, label]) => <th key={k}>{label}</th>)}
            {withEngine && <><th title="از رجیستر موتور">NDT</th><th title="از رجیستر موتور">EL</th></>}
            <th>روی نقشه</th>
          </tr></thead>
          <tbody>
            {rows.map((m) => {
              const e = tab === "weld" ? engineRow(model, m.no) : null;
              const placed = isPlaced(m);
              return (
                <tr key={m.id} data-mark-row={m.id} data-placed={placed ? "yes" : "no"} className={m.id === selectedId ? "sel" : undefined} onClick={() => onSelect?.(m.id)}>
                  {ticks && <td><input type="checkbox" aria-label={`جوش ${m.no} با نقشه بررسی شد`} disabled={!m.no} data-wl-check={m.no}
                    checked={Boolean(m.no) && checked.has(m.no)} onClick={(ev) => ev.stopPropagation()} onChange={(ev) => checked.onTick(m.no, ev.target.checked)} /></td>}
                  <td><input data-cell="no" dir="ltr" className="mono" style={{ width: 64 }} value={m.no} disabled={readOnly}
                    onChange={(ev) => set(m.id, { no: ev.target.value })} /></td>
                  {tab === "weld" && (
                    <td><select data-cell="kind" value={m.kind} disabled={readOnly} onChange={(ev) => set(m.id, { kind: ev.target.value })}>
                      <option value="weld-shop">کارگاه (دایره)</option>
                      <option value="weld-field">سایت (مربع)</option>
                      <option value="weld-unknown">نامعلوم</option>
                    </select></td>)}
                  {ATTRS[tab].map(([k, , ph]) => {
                    const list = PICK[tab][k];
                    const onPick = (v) => set(m.id, { attrs: { [k]: v } });
                    return (
                      <td key={k}>{list
                        ? <Pick data-cell={k} list={list} lists={lists} items={list === "spools" ? (spoolNos.length ? spoolNos : null) : undefined}
                          style={{ width: 96 }} placeholder={ph} value={m.attrs?.[k]} disabled={readOnly} onChange={onPick}
                          onClick={(ev) => ev.stopPropagation()} />
                        : <input data-cell={k} dir="ltr" style={{ width: k === "note" ? 130 : 84 }} placeholder={ph}
                          value={m.attrs?.[k] ?? ""} disabled={readOnly} onChange={(ev) => onPick(ev.target.value)} />}</td>);
                  })}
                  {withEngine && <>
                    <td className="mono sm" data-engine="ndt">{e?.ndt ?? "—"}</td>
                    <td className="mono sm" data-engine="el">{e?.el != null ? Math.round(e.el).toLocaleString("en-US") : "—"}</td>
                  </>}
                  <td style={{ whiteSpace: "nowrap" }}>
                    {!readOnly && (<>
                      <button type="button" className={attachId === m.id ? "on sm" : "ghost sm"} data-row-attach={m.id}
                        onClick={(ev) => { ev.stopPropagation(); onSelect?.(m.id); onAttach?.(attachId === m.id ? null : m.id); }}>
                        {placed ? "جابه‌جایی روی نقشه" : "اتصال به نقشه"}
                      </button>
                      {placed && <button type="button" className="ghost sm" data-row-unplace={m.id}
                        onClick={(ev) => { ev.stopPropagation(); onChange?.(unplace(items, m.id)); }}>برداشتن از نقشه</button>}
                      <button type="button" className="ghost sm" aria-label={`حذف ${m.no}`} data-row-delete={m.id}
                        onClick={(ev) => { ev.stopPropagation(); if (attachId === m.id) onAttach?.(null); onChange?.(removeMark(items, m.id)); }}>حذف</button>
                    </>)}
                    {readOnly && <span className="muted sm">{placed ? "روی نقشه" : "وصل نیست"}</span>}
                  </td>
                </tr>);
            })}
            {!rows.length && <tr><td colSpan={colSpan} className="muted sm">هنوز چیزی در این جدول نیست — «+ {WORD[tab]}» را بزنید.</td></tr>}
          </tbody>
        </table></TableKit>
      </div>
      {issues.length > 0 && (
        <ul className="sm" data-mark-rules style={{ margin: "6px 0", paddingInlineStart: 18 }}>
          {issues.map((x) => <li key={x} className="err">{x}</li>)}
        </ul>)}
      {tab === "weld" && (
        <p className="muted sm">محل، نوع اتصال، قطر، اسپول و جنس را موتور، خوانش نقشه یا BOM پر کرده‌اند (جایی که گفته نشده خالی می‌ماند) و همه قابل ویرایش‌اند{withEngine ? "؛ NDT و EL از رجیستر موتورند و اینجا ویرایش نمی‌شوند" : ""}.</p>)}
      {tab === "spool" && (
        <p className="muted sm" data-spool-rules>قاعده‌ها: هر سرجوش کارگاهی داخل یک اسپول است و آن را نام می‌برد؛ هر اسپولی که نام برده شده بیضی‌اش روی نقشه هست؛
          هر بیضی روی نقشه دست‌کم یک سرجوش دارد؛ شمارهٔ اسپول تکراری نیست. سرجوش سایت دو اسپول را به هم وصل می‌کند و اسپول خودش را لازم ندارد.</p>)}
      {tab === "support" && (
        <p className="muted sm">قاعده‌ها: شمارهٔ ساپورت تکراری نیست و نوع هر ساپورت مشخص است.</p>)}
    </div>
  );
}
