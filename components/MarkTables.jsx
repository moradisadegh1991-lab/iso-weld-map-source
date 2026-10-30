"use client";
import { useState } from "react";
import { KINDS, ATTRS, updateMark, removeMark, problems, rules } from "../lib/sheet/markup.mjs";
import MarkShape from "./MarkShape";

/**
 * The marks of a sheet as tables a person edits: welds, spools, supports
 * (lib/sheet/markup.mjs ATTRS). A row and its mark on the sheet are one
 * thing — picking either picks both; an edit here is the person's, like a
 * mark moved on the sheet. Under the tables, the rules the sheet's welds,
 * spools and supports answer to, as problems to see.
 *
 *   items       every mark of the sheet
 *   onChange    (items) after every edit
 *   selectedId  the mark picked on the sheet; onSelect(id) picks one here
 *   onAdd       (kind) — arm the sheet to place a new mark of that kind
 *   tabs        which tables to show (a weld list kept elsewhere leaves "weld" out)
 *   weldList    those welds, as rows { no, loc, spool }, for the spool rules
 */
const TABS = [["weld", "سرجوش‌ها"], ["spool", "اسپول‌ها"], ["support", "ساپورت‌ها"]];
const ADD = { weld: "weld-field", spool: "spool", support: "support" };

export default function MarkTables({ items = [], onChange, selectedId = null, onSelect, onAdd, readOnly = false, tabs = ["weld", "spool", "support"], weldList = null }) {
  const shown = TABS.filter(([k]) => tabs.includes(k));
  const [tab, setTab] = useState(shown[0]?.[0] || "weld");
  const rows = items.filter((m) => KINDS[m.kind]?.cls === tab);
  const issues = [...problems(items), ...rules(items, weldList)].filter((p) =>
    tab === "weld" ? /سرجوش/.test(p) : tab === "spool" ? /اسپول/.test(p) : /ساپورت/.test(p));
  const set = (id, patch) => onChange?.(updateMark(items, id, patch));
  return (
    <div className="mark-tables" data-mark-tables>
      <div className="row" style={{ gap: 4, flexWrap: "wrap" }} role="tablist">
        {shown.map(([k, label]) => (
          <button key={k} type="button" role="tab" data-mark-tab={k} className={tab === k ? "on" : "ghost"} onClick={() => setTab(k)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <MarkShape kind={ADD[k] === "weld-field" ? "weld-shop" : ADD[k]} no="" size={0.5} />
            {label} ({items.filter((m) => KINDS[m.kind]?.cls === k).length})
          </button>
        ))}
        <span className="grow" />
        {!readOnly && onAdd && (
          <button type="button" className="ghost sm" data-mark-add={tab} onClick={() => onAdd(ADD[tab])}>
            + {tab === "weld" ? "سرجوش" : tab === "spool" ? "اسپول" : "ساپورت"} (روی نقشه کلیک کنید)
          </button>)}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="dtable" data-mark-table={tab}>
          <thead><tr>
            <th>شماره</th>
            {tab === "weld" && <th>محل</th>}
            {ATTRS[tab].map(([k, label]) => <th key={k}>{label}</th>)}
            <th>منبع</th><th />
          </tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} data-mark-row={m.id} className={m.id === selectedId ? "sel" : undefined} onClick={() => onSelect?.(m.id)}>
                <td><input data-cell="no" dir="ltr" className="mono" style={{ width: 70 }} value={m.no} disabled={readOnly}
                  onChange={(e) => set(m.id, { no: e.target.value })} /></td>
                {tab === "weld" && (
                  <td><select data-cell="kind" value={m.kind} disabled={readOnly} onChange={(e) => set(m.id, { kind: e.target.value })}>
                    <option value="weld-shop">کارگاه (دایره)</option>
                    <option value="weld-field">سایت (مربع)</option>
                    <option value="weld-unknown">نامعلوم</option>
                  </select></td>)}
                {ATTRS[tab].map(([k, , ph]) => (
                  <td key={k}><input data-cell={k} dir="ltr" style={{ width: k === "note" ? 140 : 90 }} placeholder={ph}
                    value={m.attrs?.[k] ?? ""} disabled={readOnly} onChange={(e) => set(m.id, { attrs: { [k]: e.target.value } })} /></td>
                ))}
                <td className="muted sm">{m.src === "engine" ? "موتور" : m.src === "model" ? "مدل" : m.src === "reader" ? "OCR" : "دستی"}</td>
                <td>{!readOnly && <button type="button" className="ghost" aria-label={`حذف ${m.no}`} data-row-delete={m.id}
                  onClick={(e) => { e.stopPropagation(); onChange?.(removeMark(items, m.id)); }}>×</button>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={ATTRS[tab].length + 4} className="muted sm">هنوز چیزی روی نقشه نیست.</td></tr>}
          </tbody>
        </table>
      </div>
      {issues.length > 0 && (
        <ul className="sm" data-mark-rules style={{ margin: "6px 0", paddingInlineStart: 18 }}>
          {issues.map((x) => <li key={x} className="err">{x}</li>)}
        </ul>)}
      {tab === "spool" && (
        <p className="muted sm" data-spool-rules>قاعده‌ها: هر سرجوش کارگاهی داخل یک اسپول است و آن را نام می‌برد؛ هر اسپولی که نام برده شده بیضی‌اش روی نقشه هست؛
          هر بیضی روی نقشه دست‌کم یک سرجوش دارد؛ شمارهٔ اسپول تکراری نیست. سرجوش سایت دو اسپول را به هم وصل می‌کند و اسپول خودش را لازم ندارد.</p>)}
      {tab === "support" && (
        <p className="muted sm">قاعده‌ها: شمارهٔ ساپورت تکراری نیست و نوع هر ساپورت مشخص است.</p>)}
    </div>
  );
}
