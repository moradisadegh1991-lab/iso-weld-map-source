"use client";
import { useConfirm, askDelete } from "./ui/ConfirmDialog";
import { useEffect, useRef, useState } from "react";
import { KINDS, ATTRS, addMark, updateMark, removeMark, unplace, isPlaced, notOnSheet, engineRow, problems, rules, componentChecks, bomSnapshot, dependents, markRef, isMark, findMark } from "../lib/sheet/markup.mjs";
import { allocationChecks } from "../lib/register/bom-allocation.mjs";
import MarkShape from "./MarkShape";
import TableKit from "./ui/TableKit";
import { useTieInStatus, TIE_TEXT } from "./TieInPick";

// which list each column picks from, by the table it is in (null: typed by hand — numbers, lengths and notes)
const PICK = {
  weld: { c1: "bom", c2: "bom", type: "jointType", size: "nps", schedule: "schedule", material: "material", spool: "spools", wps: "wps" },
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

const isUidLike = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v ?? ""));
export default function MarkTables({ protect = null, items = [], onChange, model = null, selectedId = null, onSelect, attachId = null, onAttach,
  readOnly = false, tabs = ["weld", "spool", "support"], weldList = null, checked = null, bom = [], focus = null, onOpen = null, cuts = [] }) {
  const shown = TABS.filter(([k]) => tabs.includes(k));
  const [tab, setTab] = useState(shown[0]?.[0] || "weld");
  const rows = items.filter((m) => KINDS[m.kind]?.cls === tab);
  const tieStatus = useTieInStatus(items.filter((m) => KINDS[m.kind]?.cls === "weld").map((m) => m.attrs?.ref));
  // a table of one class (the workspace's own tab for spools or supports) speaks of its own class
  const mine = new Set(shown.map(([k]) => k));
  const loose = notOnSheet(items).filter((m) => mine.has(KINDS[m.kind]?.cls));
  const only = shown.length === 1 && !mine.has("weld") ? shown[0][0] : null;
  const all = [...problems(items), ...rules(items, weldList), ...componentChecks(items, bom), ...allocationChecks(items, bom)];
  const issues = only === "spool" ? all.filter((x) => /اسپول/.test(x)) : only === "support" ? all.filter((x) => /ساپورت/.test(x)) : all;
  // «edit» from the sheet's menu: this mark's table, its row in view, its first field in focus
  const box = useRef(null);
  const [ask, dialog] = useConfirm();
  const done = useRef(null);      // the «edit» already acted on: the person may change tab after it
  useEffect(() => {
    if (!focus?.id || done.current === focus.n) return;
    const m = findMark(items, focus.id);
    if (!m) return;
    const cls = KINDS[m.kind]?.cls;
    if (cls && cls !== tab && shown.some(([k]) => k === cls)) { setTab(cls); return; }   // its row is focused once this tab renders
    done.current = focus.n;
    const row = box.current?.querySelector(`[data-mark-row="${CSS.escape(String(m ? markRef(m) : focus.id))}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "nearest" });
    row.querySelector("[data-row-edit]")?.focus();
  }, [focus?.id, focus?.n, tab]);  // eslint-disable-line react-hooks/exhaustive-deps
  // a mark picked elsewhere (the drawing, the explorer) is shown here: its class's table, its row in view. Acts once per picked mark, so the
  // person may then look at another table.
  const followed = useRef(null);
  useEffect(() => {
    if (!selectedId || followed.current === selectedId) return;
    const m = findMark(items, selectedId);
    if (!m) return;
    const cls = KINDS[m.kind]?.cls;
    if (cls && cls !== tab && shown.some(([k]) => k === cls)) { setTab(cls); return; }
    followed.current = selectedId;
    box.current?.querySelector(`[data-mark-row="${CSS.escape(String(markRef(m)))}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId, tab]);  // eslint-disable-line react-hooks/exhaustive-deps
  // a row is added, viewed and edited in its form (components/MarkForm.jsx), which the page holds
  const open = (mode, m) => onOpen?.(mode, m ? markRef(m) : null, m?.kind || NEW_KIND[tab]);
  const add = () => {
    if (onOpen) { open("create", null); return; }
    const next = addMark(items, { kind: NEW_KIND[tab] });
    onChange?.(next);
    const row = next[next.length - 1];
    onSelect?.(markRef(row));
    onAttach?.(markRef(row));   // the sheet waits for its weld point at once
  };
  const withEngine = tab === "weld" && model && !model.error;
  const ticks = tab === "weld" && checked;
  const bomText = (pt) => { if (!pt) return "—"; const b = (bom || []).find((r) => String(r.pt) === String(pt)); return b ? `PT ${pt} — ${String(b.description || b.group || "").slice(0, 28)}` : `PT ${pt} (در BOM نیست)`; };
  const KIND_TEXT = { "weld-shop": "کارگاه", "weld-field": "سایت", "weld-unknown": "نامعلوم" };
  const colSpan = ATTRS[tab].length + 3 + (tab === "weld" ? 1 : 0) + (tab === "spool" ? 1 : 0) + (withEngine ? 2 : 0) + (ticks ? 1 : 0);
  // a spool's welds: the weld marks that name it (read-only, from the sheet)
  // by IDENTITY (attrs.spoolUid); a weld with no spool uid is counted by its printed number only when exactly one spool carries that number
  const spoolNoCount = items.filter((x) => x.kind === "spool").reduce((c, x) => c.set(String(x.no ?? "").trim(), (c.get(String(x.no ?? "").trim()) || 0) + 1), new Map());
  const weldsOfSpool = (no, uid) => items.filter((w) => KINDS[w.kind]?.cls === "weld" && (isUidLike(w.attrs?.spoolUid) ? isUidLike(uid) && String(w.attrs.spoolUid).toLowerCase() === String(uid).toLowerCase()
    : String(w.attrs?.spool ?? "").trim() === String(no ?? "").trim() && String(no ?? "").trim() && spoolNoCount.get(String(no).trim()) === 1)).map((w) => w.no);
  const equipOfSpool = (uid) => items.filter((x) => KINDS[x.kind]?.cls === "equipment" && isUidLike(uid) && String(x.attrs?.spoolUid ?? "").toLowerCase() === String(uid).toLowerCase());
  return (
    <div className="mark-tables" data-mark-tables ref={box}>
      {dialog}
      <div className="row" style={{ gap: 4, flexWrap: "wrap" }} role={shown.length > 1 ? "tablist" : undefined}>
        {shown.length === 1 && <b data-mark-title>{shown[0][1]} ({rows.length})</b>}
        {shown.length > 1 && shown.map(([k, label]) => (
          <button key={k} type="button" role="tab" data-mark-tab={k} className={tab === k ? "on" : "ghost"} onClick={() => setTab(k)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <MarkShape kind={k === "weld" ? "weld-shop" : k} no="" size={0.5} />
            {label} ({items.filter((m) => KINDS[m.kind]?.cls === k).length})
          </button>
        ))}
        <span className="grow" />
        {!readOnly && (
          <button type="button" className="ghost sm" data-mark-add={tab} onClick={add}>+ {WORD[tab]}</button>)}
      </div>

      {loose.length > 0 && (
        <p className="err sm" role="alert" data-loose>
          {loose.length} ردیف به نقشه وصل نیست: {loose.slice(0, 8).map((m) => `${WORD[KINDS[m.kind].cls]} ${m.no || "بدون شماره"}`).join("، ")}
          {loose.length > 8 ? "، …" : ""} — روی «اتصال به نقشه» در انتهای ردیف بزنید و محلش را روی نقشه کلیک کنید.
        </p>)}
      {attachId && mine.has(KINDS[findMark(items, attachId)?.kind]?.cls) && <p className="note sm" data-attach-hint>روی نقشه، همان‌جا که سرجوش (یا اسپول/ساپورت) روی لوله است کلیک کنید. <button type="button" className="ghost sm" onClick={() => onAttach?.(null)}>انصراف</button></p>}

      <div style={{ overflowX: "auto" }}>
        <TableKit key={tab} name={`marks-${tab}`}><table className="dtable" data-mark-table={tab}>
          <thead><tr>
            {ticks && <th title="با نقشه بررسی شد">✓</th>}
            <th>شماره</th>
            {tab === "weld" && <th>محل</th>}
            {ATTRS[tab].map(([k, label]) => <th key={k}>{label}</th>)}
            {withEngine && <><th title="از رجیستر موتور">NDT</th><th title="از رجیستر موتور">EL</th></>}
            {tab === "spool" && <th title="سرجوش‌هایی که این اسپول را نام برده‌اند">سرجوش‌ها</th>}
            <th>روی نقشه</th>
          </tr></thead>
          <tbody>
            {rows.map((m) => {
              const e = tab === "weld" ? engineRow(model, m.no) : null;
              const placed = isPlaced(m);
              return (
                <tr key={m.id} data-mark-row={markRef(m)} data-placed={placed ? "yes" : "no"} className={isMark(m, selectedId) ? "sel" : undefined} aria-selected={isMark(m, selectedId) || undefined} onClick={() => onSelect?.(markRef(m))}>
                  {ticks && <td><input type="checkbox" aria-label={`جوش ${m.no} با نقشه بررسی شد`} disabled={!m.no} data-wl-check={m.no}
                    checked={Boolean(m.no) && checked.has(m.no)} onClick={(ev) => ev.stopPropagation()} onChange={(ev) => checked.onTick(m.no, ev.target.checked)} /></td>}
                  <td className="mono b" data-cell="no" dir="ltr">{m.no || "—"}</td>
                  {tab === "weld" && <td data-cell="kind">{KIND_TEXT[m.kind]}</td>}
                  {ATTRS[tab].map(([k]) => (
                    <td key={k} data-cell={k} className={k === "note" ? "sm" : "mono sm"} dir={k === "note" ? "auto" : "ltr"}
                      title={k === "c1" || k === "c2" ? bomText(m.attrs?.[k]) : undefined}>
                      {k === "c1" || k === "c2" ? (m.attrs?.[k] ? bomText(m.attrs[k]) : "—") : (m.attrs?.[k] || "—")}
                      {k === "ref" && tieStatus[m.attrs?.ref] && tieStatus[m.attrs.ref].status !== "ok" && <span className="warnish" data-tie-status={tieStatus[m.attrs.ref].status} title={TIE_TEXT[tieStatus[m.attrs.ref].status]}> ⚠</span>}
                    </td>))}
                  {tab === "spool" && (() => { const ws = weldsOfSpool(m.no, m.uid), eq = equipOfSpool(m.uid); return <td className="mono sm" data-spool-welds={ws.length} data-spool-equipment={eq.length}>{ws.length ? `${ws.length}: ${ws.slice(0, 8).join("، ")}${ws.length > 8 ? "…" : ""}` : "—"}{eq.length > 0 && <span className="muted"> · تجهیز: {eq.map((x) => x.no || "؟").join("، ")}</span>}</td>; })()}
                  {withEngine && <>
                    <td className="mono sm" data-engine="ndt">{e?.ndt ?? "—"}</td>
                    <td className="mono sm" data-engine="el">{e?.el != null ? Math.round(e.el).toLocaleString("en-US") : "—"}</td>
                  </>}
                  <td style={{ whiteSpace: "nowrap" }}>
                    {onOpen && <button type="button" className="ghost sm" data-row-view={markRef(m)} onClick={(ev) => { ev.stopPropagation(); onSelect?.(markRef(m)); open("view", m); }}>مشاهده</button>}
                    {onOpen && !readOnly && <button type="button" className="ghost sm" data-row-edit={markRef(m)} onClick={(ev) => { ev.stopPropagation(); onSelect?.(markRef(m)); open("edit", m); }}>ویرایش</button>}
                    {!readOnly && (<>
                      <button type="button" className={isMark(m, attachId) ? "on sm" : "ghost sm"} data-row-attach={markRef(m)}
                        onClick={(ev) => { ev.stopPropagation(); onSelect?.(markRef(m)); onAttach?.(isMark(m, attachId) ? null : markRef(m)); }}>
                        {placed ? "جابه‌جایی روی نقشه" : "اتصال به نقشه"}
                      </button>
                      {placed && <button type="button" className="ghost sm" data-row-unplace={markRef(m)}
                        onClick={(ev) => { ev.stopPropagation(); onChange?.(unplace(items, markRef(m))); }}>برداشتن از نقشه</button>}
                      <button type="button" className="ghost sm" aria-label={`حذف ${m.no}`} data-row-delete={markRef(m)}
                        onClick={async (ev) => {
                          ev.stopPropagation();
                          const yes = await askDelete(ask, { label: WORD[KINDS[m.kind].cls], no: m.no, pr: protect?.(markRef(m)), deps: dependents(items, markRef(m), cuts) });
                          if (!yes) return;
                          if (isMark(m, attachId)) onAttach?.(null);
                          onChange?.(removeMark(items, markRef(m)));
                        }}>حذف</button>
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
        <p className="muted sm">قطعهٔ ۱ و ۲ هر سرجوش از ردیف‌های BOM همین برگ انتخاب می‌شوند (اگر ردیف بعداً عوض شود، هشدار می‌آید). محل، نوع اتصال، قطر، اسپول و جنس را موتور، خوانش نقشه یا BOM پر کرده‌اند (جایی که گفته نشده خالی می‌ماند) و همه قابل ویرایش‌اند{withEngine ? "؛ NDT و EL از رجیستر موتورند و اینجا ویرایش نمی‌شوند" : ""}.</p>)}
      {tab === "spool" && (
        <p className="muted sm" data-spool-rules>قاعده‌ها: هر سرجوش کارگاهی داخل یک اسپول است و آن را نام می‌برد؛ هر اسپولی که نام برده شده بیضی‌اش روی نقشه هست؛
          هر بیضی روی نقشه دست‌کم یک سرجوش دارد؛ شمارهٔ اسپول تکراری نیست. سرجوش سایت دو اسپول را به هم وصل می‌کند و اسپول خودش را لازم ندارد.</p>)}
      {tab === "support" && (
        <p className="muted sm">قاعده‌ها: شمارهٔ ساپورت تکراری نیست و نوع هر ساپورت مشخص است.</p>)}
    </div>
  );
}
