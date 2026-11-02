"use client";
import { useEffect, useRef } from "react";
import { KINDS, EQUIPMENT_STATUS, addMark, updateMark, removeMark, unplace, isPlaced, equipmentChecks, dependents, weldsOf, accessoriesOf, accessoriesText, bomSnapshot } from "../lib/sheet/markup.mjs";
import { pieceUsage } from "../lib/register/bom-allocation.mjs";
import MarkShape from "./MarkShape";
import TableKit from "./ui/TableKit";
import Pick, { useValueLists } from "./ui/Pick";

/**
 * Installation equipment of the sheet (docs/epc-llm/17-equipment.md): each is a
 * triangle on the drawing and a row here — the same mark (lib/sheet/markup.mjs,
 * kind "equipment"), so the sheet, this table, the explorer and the inspector
 * are one record. A row says what it is (type, tag), which BOM row it is, the
 * spool it stands in, the welds it joins (picked from this sheet's welds), its
 * accessories (rows of the same BOM, with their quantities) and how far its
 * installation is. What it takes of the BOM is bounded by the row's quantity
 * (lib/register/bom-allocation.mjs), and kept with the register when saved.
 *
 *   items, onChange   the sheet's marks and their new list
 *   bom               the sheet's BOM rows
 *   selectedId, onSelect, attachId, onAttach   the picked mark and the row waiting for its place
 *   focus             { id, n } — a row to bring into view (the sheet's «edit»)
 */
const rowText = (b) => `PT ${b.pt} — ${String(b.description || b.group || "").slice(0, 40)}${b.diam ? ` (${b.diam})` : ""}`;

export default function EquipmentTable({ items = [], onChange, bom = [], selectedId = null, onSelect, attachId = null, onAttach, readOnly = false, focus = null }) {
  const lists = useValueLists();
  const rows = items.filter((m) => KINDS[m.kind]?.cls === "equipment");
  const welds = items.filter((m) => KINDS[m.kind]?.cls === "weld");
  const spools = [...new Set(items.filter((m) => m.kind === "spool" && String(m.no ?? "").trim()).map((m) => String(m.no).trim()))];
  const bomRows = (bom || []).filter((b) => b && b.pt != null && String(b.pt).trim());
  const use = pieceUsage(items, bom);
  const issues = equipmentChecks(items, bom);
  const set = (id, patch) => onChange?.(updateMark(items, id, patch));
  const attr = (id, k, v) => set(id, { attrs: { [k]: v } });
  const box = useRef(null);
  const done = useRef(null);
  useEffect(() => {
    if (!focus?.id || done.current === focus.n) return;
    const row = box.current?.querySelector(`[data-equip-row="${CSS.escape(String(focus.id))}"]`);
    if (!row) return;
    done.current = focus.n;
    row.scrollIntoView({ block: "nearest" });
    row.querySelector("[data-cell]")?.focus();
  }, [focus?.id, focus?.n, rows.length]);

  const add = () => {
    const next = addMark(items, { kind: "equipment" });
    onChange?.(next);
    const row = next[next.length - 1];
    onSelect?.(row.id);
    onAttach?.(row.id);   // the sheet waits for its place
  };
  const toggleWeld = (m, no, on) => {
    const cur = weldsOf(m.attrs?.welds);
    const next = on ? [...cur, no] : cur.filter((x) => x !== no);
    attr(m.id, "welds", next.join(", "));
  };
  const setAcc = (m, list) => attr(m.id, "acc", accessoriesText(list));

  return (
    <div className="equip-table" data-equip-table ref={box}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className="muted sm">تجهیز نصب‌شده روی لوله (شیر، صافی، ابزار دقیق…) با مثلث روی نقشه نشان داده می‌شود؛ می‌تواند به چند سرجوش وصل باشد و متعلقاتش (واشر، پیچ، مهره) از ردیف‌های BOM همین برگ‌اند.</span>
        <span className="grow" />
        {!readOnly && <button type="button" className="ghost sm" data-equip-add onClick={add}>+ تجهیز (بعد روی نقشه، محل آن را کلیک کنید)</button>}
      </div>
      {attachId && rows.some((r) => r.id === attachId) && <p className="note sm" data-attach-hint>روی نقشه، همان‌جا که تجهیز روی لوله است کلیک کنید. <button type="button" className="ghost sm" onClick={() => onAttach?.(null)}>انصراف</button></p>}
      <div style={{ overflowX: "auto" }}>
        <TableKit name="equipment-marks">
          <table className="dtable" data-equip-marks>
            <thead><tr><th>شماره</th><th>نوع</th><th>تگ</th><th>ردیف BOM تجهیز</th><th>اسپول</th><th>سرجوش‌های متصل</th><th>متعلقات</th><th>وضعیت نصب</th><th>روی نقشه</th></tr></thead>
            <tbody>
              {rows.map((m) => {
                const a = m.attrs || {};
                const placed = isPlaced(m);
                const joined = weldsOf(a.welds);
                const acc = accessoriesOf(a.acc);
                const u = use.get(String(a.c1 ?? "").trim());
                return (
                  <tr key={m.id} data-equip-row={m.id} data-placed={placed ? "yes" : "no"} className={m.id === selectedId ? "sel" : undefined} onClick={() => onSelect?.(m.id)}>
                    <td><input data-cell="no" dir="ltr" className="mono" style={{ width: 70 }} value={m.no} disabled={readOnly} onChange={(e) => set(m.id, { no: e.target.value })} /></td>
                    <td><Pick data-cell="type" list="equipmentType" lists={lists} style={{ width: 130 }} value={a.type} disabled={readOnly} placeholder="Gate Valve" onChange={(v) => attr(m.id, "type", v)} onClick={(e) => e.stopPropagation()} /></td>
                    <td><input data-cell="tag" dir="ltr" className="mono" style={{ width: 90 }} placeholder="GV-001" value={a.tag ?? ""} disabled={readOnly} onChange={(e) => attr(m.id, "tag", e.target.value)} /></td>
                    <td>
                      <select data-cell="c1" dir="ltr" style={{ width: 190 }} value={a.c1 ?? ""} disabled={readOnly} onClick={(e) => e.stopPropagation()}
                        title={u && u.total != null ? `از این ردیف ${u.total} عدد هست؛ ${u.used} به تجهیزات و متعلقات داده شده` : undefined}
                        onChange={(e) => set(m.id, { attrs: { c1: e.target.value, c1s: bomSnapshot(bomRows.find((b) => String(b.pt) === e.target.value)) } })}>
                        <option value="">—</option>
                        {a.c1 && !bomRows.some((b) => String(b.pt) === String(a.c1)) && <option value={a.c1}>PT {a.c1} (در BOM نیست)</option>}
                        {bomRows.map((b) => <option key={b.pt} value={String(b.pt)}>{rowText(b)}</option>)}
                      </select>
                    </td>
                    <td>
                      <select data-cell="spool" dir="ltr" style={{ width: 90 }} value={a.spool ?? ""} disabled={readOnly} onClick={(e) => e.stopPropagation()} onChange={(e) => attr(m.id, "spool", e.target.value)}>
                        <option value="">—</option>
                        {a.spool && !spools.includes(String(a.spool)) && <option value={a.spool}>{a.spool} (روی برگ نیست)</option>}
                        {spools.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td data-cell="welds" onClick={(e) => e.stopPropagation()}>
                      <details className="equip-pop">
                        <summary data-cell="welds-summary">{joined.length ? joined.join("، ") : "—"}</summary>
                        <div className="equip-pop-body" role="group" aria-label="سرجوش‌های متصل">
                          {welds.length === 0 && <span className="muted sm">سرجوشی روی این برگ نیست.</span>}
                          {welds.map((w) => (
                            <label key={w.id}><input type="checkbox" data-weld-pick={w.no} disabled={readOnly} checked={joined.some((n) => n === String(w.no).trim())}
                              onChange={(e) => toggleWeld(m, String(w.no).trim(), e.target.checked)} /> {w.no}</label>))}
                        </div>
                      </details>
                    </td>
                    <td data-cell="acc" onClick={(e) => e.stopPropagation()}>
                      <ul className="equip-acc">
                        {acc.map((x) => {
                          const row = bomRows.find((b) => String(b.pt) === x.pt);
                          return (
                            <li key={x.pt} data-acc={x.pt}><span title={row ? rowText(row) : "در BOM نیست"}>PT {x.pt} × {x.qty}</span>
                              {!readOnly && <button type="button" className="ghost sm" aria-label={`برداشتن PT ${x.pt}`} onClick={() => setAcc(m, acc.filter((y) => y.pt !== x.pt))}>×</button>}</li>);
                        })}
                      </ul>
                      {!readOnly && (
                        <form className="row" style={{ gap: 4 }} data-acc-form onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget), pt = String(f.get("pt") || ""), qty = Number(f.get("qty"));
                          if (!pt || !(qty > 0)) return;
                          setAcc(m, accessoriesOf(`${accessoriesText(acc)}, ${pt}×${qty}`));
                          e.currentTarget.reset();
                        }}>
                          <select name="pt" dir="ltr" style={{ width: 120 }} aria-label="متعلق"><option value="">+ متعلق…</option>{bomRows.map((b) => <option key={b.pt} value={String(b.pt)}>{rowText(b)}</option>)}</select>
                          <input name="qty" type="number" min="0" step="any" dir="ltr" defaultValue={1} style={{ width: 54 }} aria-label="تعداد" />
                          <button type="submit" className="ghost sm">افزودن</button>
                        </form>)}
                    </td>
                    <td>
                      <select data-cell="status" value={a.status || "planned"} disabled={readOnly} onClick={(e) => e.stopPropagation()} onChange={(e) => attr(m.id, "status", e.target.value)}>
                        {EQUIPMENT_STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {!readOnly ? (<>
                        <button type="button" className={attachId === m.id ? "on sm" : "ghost sm"} data-row-attach={m.id}
                          onClick={(e) => { e.stopPropagation(); onSelect?.(m.id); onAttach?.(attachId === m.id ? null : m.id); }}>{placed ? "جابه‌جایی روی نقشه" : "اتصال به نقشه"}</button>
                        {placed && <button type="button" className="ghost sm" onClick={(e) => { e.stopPropagation(); onChange?.(unplace(items, m.id)); }}>برداشتن از نقشه</button>}
                        <button type="button" className="ghost sm" data-row-delete={m.id} aria-label={`حذف ${m.no}`} onClick={(e) => {
                          e.stopPropagation();
                          const deps = dependents(items, m.id);
                          if (deps.length && !window.confirm(`تجهیز ${m.no || ""} حذف شود؟\n\n– ${deps.join("\n– ")}`)) return;
                          if (attachId === m.id) onAttach?.(null);
                          onChange?.(removeMark(items, m.id));
                        }}>حذف</button>
                      </>) : <span className="muted sm">{placed ? "روی نقشه" : "وصل نیست"}</span>}
                    </td>
                  </tr>);
              })}
              {!rows.length && <tr><td colSpan={9} className="muted sm">هنوز تجهیزی نیست — «+ تجهیز» را بزنید یا روی نقشه راست‌کلیک کنید.</td></tr>}
            </tbody>
          </table>
        </TableKit>
      </div>
      {issues.length > 0 && <ul className="sm" data-equip-issues style={{ margin: "6px 0", paddingInlineStart: 18 }}>{issues.map((x) => <li key={x} className="err">{x}</li>)}</ul>}
      <p className="muted sm">سرجوش‌های متصل و متعلقات با «ذخیره» در رجیستر تجهیزات نگه داشته می‌شوند و از ردیف BOM بیش از تعدادش رزرو نمی‌شود. تجهیز یا متعلقِ نصب‌شده یا تست‌شده با حذف نشان از نقشه پاک نمی‌شود؛ ابتدا وضعیتش را برگردانید.</p>
    </div>
  );
}
