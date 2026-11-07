"use client";
import { useEffect, useRef } from "react";
import { KINDS, EQUIPMENT_STATUS, removeMark, unplace, isPlaced, equipmentChecks, dependents, weldsOf, accessoriesOf, markRef, isMark } from "../lib/sheet/markup.mjs";
import TableKit from "./ui/TableKit";

/**
 * Installation equipment of the sheet (docs/epc-llm/17-equipment.md): each is a
 * triangle on the drawing and a row here — the same mark (lib/sheet/markup.mjs,
 * kind "equipment"). The table only shows: an item is added, viewed and edited
 * in its form (components/MarkForm.jsx, opened through `onOpen`), from here or
 * from the sheet's right-click menu alike. Joining it to the drawing, taking it
 * off and deleting it are the row's own buttons.
 *
 *   items, onChange   the sheet's marks and their new list
 *   bom               the sheet's BOM rows
 *   selectedId, onSelect, attachId, onAttach   the picked mark and the row waiting for its place
 *   onOpen(mode, id, kind)   open the form: "view" | "edit" | "create"
 *   focus             { id, n } — a row to bring into view
 */
export default function EquipmentTable({ protect = null, items = [], onChange, bom = [], selectedId = null, onSelect, attachId = null, onAttach, readOnly = false, focus = null, onOpen = null }) {
  const rows = items.filter((m) => KINDS[m.kind]?.cls === "equipment");
  const issues = equipmentChecks(items, bom);
  const status = Object.fromEntries(EQUIPMENT_STATUS);
  const bomText = (pt) => { if (!pt) return "—"; const b = (bom || []).find((r) => String(r.pt) === String(pt)); return b ? `PT ${pt} — ${String(b.description || b.group || "").slice(0, 30)}` : `PT ${pt} (در BOM نیست)`; };
  const box = useRef(null);
  const done = useRef(null);
  useEffect(() => {
    if (!focus?.id || done.current === focus.n) return;
    const row = box.current?.querySelector(`[data-equip-row="${CSS.escape(String(focus.id))}"]`);
    if (!row) return;
    done.current = focus.n;
    row.scrollIntoView({ block: "nearest" });
    row.querySelector("[data-row-edit]")?.focus();
  }, [focus?.id, focus?.n, rows.length]);

  // an equipment mark picked on the drawing is brought into view here
  const followed = useRef(null);
  useEffect(() => {
    if (!selectedId || followed.current === selectedId) return;
    const m = rows.find((r) => isMark(r, selectedId));
    if (!m) return;
    followed.current = selectedId;
    box.current?.querySelector(`[data-equip-row="${CSS.escape(String(markRef(m)))}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId, rows.length]);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="equip-table" data-equip-table ref={box}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <b>تجهیزات نصب ({rows.length})</b>
        <span className="grow" />
        {!readOnly && onOpen && <button type="button" className="ghost sm" data-equip-add onClick={() => onOpen("create", null, "equipment")}>+ تجهیز</button>}
      </div>
      {attachId && rows.some((r) => isMark(r, attachId)) && <p className="note sm" data-attach-hint>روی نقشه، همان‌جا که تجهیز روی لوله است کلیک کنید. <button type="button" className="ghost sm" onClick={() => onAttach?.(null)}>انصراف</button></p>}
      <div style={{ overflowX: "auto" }}>
        <TableKit name="equipment-marks">
          <table className="dtable" data-equip-marks>
            <thead><tr><th>شماره</th><th>نوع</th><th>تگ</th><th>ردیف BOM تجهیز</th><th>اسپول</th><th>سرجوش‌های متصل</th><th>متعلقات</th><th>وضعیت نصب</th><th>روی نقشه</th></tr></thead>
            <tbody>
              {rows.map((m) => {
                const a = m.attrs || {}, placed = isPlaced(m), acc = accessoriesOf(a.acc);
                return (
                  <tr key={m.id} data-equip-row={markRef(m)} data-placed={placed ? "yes" : "no"} className={isMark(m, selectedId) ? "sel" : undefined} aria-selected={isMark(m, selectedId) || undefined} onClick={() => onSelect?.(markRef(m))}>
                    <td className="mono b" dir="ltr" data-cell="no">{m.no || "—"}</td>
                    <td className="sm" data-cell="type">{a.type || "—"}</td>
                    <td className="mono sm" dir="ltr" data-cell="tag">{a.tag || "—"}</td>
                    <td className="mono sm" dir="ltr" data-cell="c1">{bomText(a.c1)}</td>
                    <td className="mono sm" dir="ltr" data-cell="spool">{a.spool || "—"}</td>
                    <td className="mono sm" dir="ltr" data-cell="welds">{weldsOf(a.welds).join("، ") || "—"}</td>
                    <td className="mono sm" dir="ltr" data-cell="acc">{acc.length ? acc.map((x) => `PT ${x.pt}×${x.qty}`).join("، ") : "—"}</td>
                    <td className="sm" data-cell="status">{status[a.status] || status.planned}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {onOpen && <button type="button" className="ghost sm" data-row-view={markRef(m)} onClick={(e) => { e.stopPropagation(); onSelect?.(markRef(m)); onOpen("view", markRef(m), m.kind); }}>مشاهده</button>}
                      {onOpen && !readOnly && <button type="button" className="ghost sm" data-row-edit={markRef(m)} onClick={(e) => { e.stopPropagation(); onSelect?.(markRef(m)); onOpen("edit", markRef(m), m.kind); }}>ویرایش</button>}
                      {!readOnly && (<>
                        <button type="button" className={isMark(m, attachId) ? "on sm" : "ghost sm"} data-row-attach={markRef(m)}
                          onClick={(e) => { e.stopPropagation(); onSelect?.(markRef(m)); onAttach?.(isMark(m, attachId) ? null : markRef(m)); }}>{placed ? "جابه‌جایی روی نقشه" : "اتصال به نقشه"}</button>
                        {placed && <button type="button" className="ghost sm" onClick={(e) => { e.stopPropagation(); onChange?.(unplace(items, markRef(m))); }}>برداشتن از نقشه</button>}
                        <button type="button" className="ghost sm" data-row-delete={m.id} aria-label={`حذف ${m.no}`} onClick={(e) => {
                          e.stopPropagation();
                          const pr = protect?.(markRef(m));
                          if (pr?.blocked) { window.alert(`تجهیز ${m.no || ""} حذف نمی‌شود:\n– ${pr.reasons.join("\n– ")}`); return; }
                          const deps = [...(pr?.reasons || []), ...dependents(items, markRef(m))];
                          if (!window.confirm(`تجهیز ${m.no || ""} حذف شود؟${deps.length ? `\n\n– ${deps.join("\n– ")}` : ""}`)) return;
                          if (isMark(m, attachId)) onAttach?.(null);
                          onChange?.(removeMark(items, markRef(m)));
                        }}>حذف</button>
                      </>)}
                      {readOnly && <span className="muted sm">{placed ? "روی نقشه" : "وصل نیست"}</span>}
                    </td>
                  </tr>);
              })}
              {!rows.length && <tr><td colSpan={9} className="muted sm">هنوز تجهیزی نیست — «+ تجهیز» را بزنید یا روی نقشه راست‌کلیک کنید.</td></tr>}
            </tbody>
          </table>
        </TableKit>
      </div>
      {issues.length > 0 && <ul className="sm" data-equip-issues style={{ margin: "6px 0", paddingInlineStart: 18 }}>{issues.map((x) => <li key={x} className="err">{x}</li>)}</ul>}
    </div>
  );
}
