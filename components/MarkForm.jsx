"use client";
import { useMemo, useState } from "react";
import FormDialog from "./ui/FormDialog";
import BomPick from "./BomPick";
import Pick from "./ui/Pick";
import TieInPick, { TieInReferrers } from "./TieInPick";
import { KINDS, ATTRS, EQUIPMENT_STATUS, isPlaced, weldsOf, accessoriesOf, accessoriesText, bomSnapshot, nextNo, isMark, markRef } from "../lib/sheet/markup.mjs";

/**
 * The form of one mark of the sheet — a weld, spool, support or installed
 * item — for viewing it, editing it or adding one (owner's request of
 * 2026-11-02: the tables only show; a row is added, viewed and edited in a
 * form, from the table or from the sheet's right-click menu alike).
 *
 * It edits a draft; nothing reaches the sheet until «ذخیره»/«افزودن»
 * (`onSave({ kind, no, attrs })`), and «انصراف» drops it. The same pickers as
 * before: the project's lists, the sheet's BOM rows (a row with no welded end
 * left is not offered), the sheet's spools and weld numbers.
 *
 *   mode     "view" | "edit" | "create"
 *   mark     the mark (view/edit), or { kind } for a new one
 *   items, bom, lists   the sheet's marks, BOM rows and the project's pick lists
 *   onSave, onClose, onEdit (view → edit), readOnly (an approved register: view only)
 */
const WELD_KINDS = [["weld-shop", "کارگاه (دایره)"], ["weld-field", "سایت (مربع)"], ["weld-unknown", "نامعلوم"]];
const LIST_OF = {
  weld: { type: "jointType", size: "nps", schedule: "schedule", material: "material", wps: "wps" },
  spool: { size: "nps", material: "material" },
  support: { type: "supportType", size: "nps" },
  equipment: { type: "equipmentType" },
};
const NEW_ID = "__draft__";
const rowText = (b) => `PT ${b.pt} — ${String(b.description || b.group || "").slice(0, 46)}${b.diam ? ` (${b.diam})` : ""}`;

export default function MarkForm({ mode: mode0 = "view", mark, items = [], bom = [], lists, onSave, onClose, readOnly = false, thisDoc = "", thisSheet = "" }) {
  const [mode, setMode] = useState(readOnly ? "view" : mode0);
  const cls = KINDS[mark?.kind]?.cls || "weld";
  const start = useMemo(() => ({
    kind: mark?.kind || "weld-unknown",
    no: mark?.no ?? (mode0 === "create" ? nextNo(items, mark?.kind || "weld-unknown") : ""),
    attrs: { ...(mark?.attrs || {}) },
  }), [mark]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [d, setD] = useState(start);
  const [err, setErr] = useState("");
  const dirty = JSON.stringify(d) !== JSON.stringify(start);
  const a = d.attrs;
  const setA = (patch) => setD((x) => ({ ...x, attrs: { ...x.attrs, ...patch } }));
  // the sheet as it would be with this draft in it: what is left of each BOM row is counted with it
  const id = mark ? (markRef(mark) || NEW_ID) : NEW_ID;
  const withDraft = useMemo(() => {
    const me = { id, kind: d.kind, no: d.no, attrs: d.attrs };
    return items.some((m) => isMark(m, id)) ? items.map((m) => (isMark(m, id) ? { ...m, ...me } : m)) : [...items, me];
  }, [items, d, id]);
  const spools = [...new Set(items.filter((m) => m.kind === "spool" && String(m.no ?? "").trim()).map((m) => String(m.no).trim()))];
  const welds = items.filter((m) => KINDS[m.kind]?.cls === "weld" && !isMark(m, id));
  const bomRows = (bom || []).filter((b) => b && b.pt != null && String(b.pt).trim());
  const labels = Object.fromEntries((ATTRS[cls] || []).map(([k, l, ph]) => [k, [l, ph]]));
  const acc = accessoriesOf(a.acc);

  const save = () => {
    const no = String(d.no ?? "").trim();
    if (!no) { setErr("شماره لازم است."); return; }
    const dup = items.find((m) => !(mark && isMark(m, mark.uid || mark.id)) && KINDS[m.kind]?.cls === cls && String(m.no ?? "").trim() === no);
    if (dup) { setErr(`${KINDS[mark?.kind || d.kind].label} «${no}» روی این برگ هست.`); return; }
    onSave?.({ kind: d.kind, no, attrs: d.attrs });
  };

  const field = (k, node) => (
    <label key={k} className="mk-f" data-form-field={k}>
      <span className="muted sm">{labels[k]?.[0] || k}</span>{node}
    </label>);
  const text = (k, props = {}) => field(k, <input dir="ltr" value={a[k] ?? ""} placeholder={labels[k]?.[1] || ""} onChange={(e) => setA({ [k]: e.target.value })} data-input={k} {...props} />);
  const pick = (k) => field(k, <Pick data-input={k} list={LIST_OF[cls][k]} lists={lists} value={a[k]} placeholder={labels[k]?.[1] || ""} onChange={(v) => setA({ [k]: v })} />);
  const spoolSel = (k) => field(k, spools.length
    ? <select data-input={k} dir="ltr" value={a[k] ?? ""} onChange={(e) => setA({ [k]: e.target.value })}>
        <option value="">—</option>
        {a[k] && !spools.includes(String(a[k])) && <option value={a[k]}>{a[k]} (روی برگ نیست)</option>}
        {spools.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    : <input data-input={k} dir="ltr" value={a[k] ?? ""} placeholder="SP-1" onChange={(e) => setA({ [k]: e.target.value })} />);

  const title = mode === "create" ? `افزودن ${KINDS[d.kind]?.label || ""}` : `${KINDS[d.kind]?.label || ""} ${d.no || ""}`;
  return (
    <FormDialog title={title} subtitle={mark && mode !== "create" ? (isPlaced(mark) ? "روی نقشه جا دارد" : "هنوز روی نقشه جا ندارد") : ""}
      mode={mode} dirty={dirty} canEdit={!readOnly} onEdit={() => setMode("edit")} onSave={save} onClose={onClose} error={err}
      data-mark-form={cls}>
      <div className="mk-grid">
        <label className="mk-f" data-form-field="no"><span className="muted sm">شماره *</span>
          <input data-input="no" data-autofocus dir="ltr" className="mono" value={d.no ?? ""} onChange={(e) => { setErr(""); setD((x) => ({ ...x, no: e.target.value })); }} /></label>
        {cls === "weld" && (
          <label className="mk-f" data-form-field="kind"><span className="muted sm">محل (کارگاه / سایت)</span>
            <select data-input="kind" value={d.kind} onChange={(e) => setD((x) => ({ ...x, kind: e.target.value }))}>
              {WELD_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>)}
      </div>

      {cls === "weld" && (<>
        <h4 className="mk-h">قطعه‌های اتصال (از BOM همین برگ)</h4>
        <div className="mk-grid two">
          {["c1", "c2"].map((k) => field(k, <BomPick data-input={k} bom={bom} items={withDraft} weldId={id} slot={k} value={a[k]}
            onPick={(v, row) => setA({ [k]: v, [`${k}s`]: row ? bomSnapshot(row) : "" })} />))}
        </div>
        <h4 className="mk-h">مشخصات جوش</h4>
        <div className="mk-grid">
          {pick("type")}{pick("size")}{pick("schedule")}{pick("material")}{spoolSel("spool")}{pick("wps")}
          {field("ref", <TieInPick data-input="ref" value={a.ref} weldNos={welds.map((w) => String(w.no ?? "").trim()).filter(Boolean)} thisDoc={thisDoc} onChange={(v) => setA({ ref: v })} />)}
        </div>
        <div className="mk-grid one">{text("note")}</div>
        {mode !== "create" && mark?.no && <TieInReferrers doc={thisDoc} sheet={thisSheet} weld={start.no} />}
      </>)}

      {cls === "spool" && <div className="mk-grid">{pick("size")}{pick("material")}{text("lengthMm", { inputMode: "decimal" })}{text("note")}</div>}
      {cls === "support" && <div className="mk-grid">{pick("type")}{pick("size")}{text("note")}</div>}

      {cls === "equipment" && (<>
        <div className="mk-grid">
          {pick("type")}{text("tag")}
          {field("c1", <select data-input="c1" dir="ltr" value={a.c1 ?? ""} onChange={(e) => setA({ c1: e.target.value, c1s: bomSnapshot(bomRows.find((b) => String(b.pt) === e.target.value)) })}>
            <option value="">—</option>
            {a.c1 && !bomRows.some((b) => String(b.pt) === String(a.c1)) && <option value={a.c1}>PT {a.c1} (در BOM نیست)</option>}
            {bomRows.map((b) => <option key={b.pt} value={String(b.pt)}>{rowText(b)}</option>)}</select>)}
          {spoolSel("spool")}
          {field("status", <select data-input="status" value={a.status || "planned"} onChange={(e) => setA({ status: e.target.value })}>
            {EQUIPMENT_STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>)}
        </div>
        <h4 className="mk-h">سرجوش‌های متصل</h4>
        <div className="mk-checks" role="group" aria-label="سرجوش‌های متصل" data-form-field="welds">
          {welds.length === 0 && <span className="muted sm">سرجوشی روی این برگ نیست.</span>}
          {welds.map((w) => { const no = String(w.no).trim(), on = weldsOf(a.welds).includes(no); return (
            <label key={w.id}><input type="checkbox" data-weld-pick={no} checked={on}
              onChange={(e) => setA({ welds: (e.target.checked ? [...weldsOf(a.welds), no] : weldsOf(a.welds).filter((x) => x !== no)).join(", ") })} /> {no}</label>); })}
        </div>
        <h4 className="mk-h">متعلقات (از BOM همین برگ)</h4>
        <ul className="equip-acc" data-form-field="acc">
          {acc.length === 0 && <li className="muted sm" style={{ border: 0 }}>متعلقی ندارد.</li>}
          {acc.map((x) => { const row = bomRows.find((b) => String(b.pt) === x.pt); return (
            <li key={x.pt} data-acc={x.pt}><span title={row ? rowText(row) : "در BOM نیست"}>PT {x.pt} × {x.qty}</span>
              {mode !== "view" && <button type="button" className="ghost sm" aria-label={`برداشتن PT ${x.pt}`} onClick={() => setA({ acc: accessoriesText(acc.filter((y) => y.pt !== x.pt)) })}>×</button>}</li>); })}
        </ul>
        {mode !== "view" && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }} data-acc-form>
            <select id="mk-acc-pt" dir="ltr" aria-label="متعلق" defaultValue="" style={{ minWidth: 220 }}><option value="">+ متعلق…</option>{bomRows.map((b) => <option key={b.pt} value={String(b.pt)}>{rowText(b)}</option>)}</select>
            <input id="mk-acc-qty" type="number" min="0" step="any" dir="ltr" defaultValue={1} aria-label="تعداد" style={{ width: 70 }} />
            <button type="button" className="ghost sm" data-acc-add onClick={() => {
              const pt = document.getElementById("mk-acc-pt")?.value, qty = Number(document.getElementById("mk-acc-qty")?.value);
              if (!pt || !(qty > 0)) return;
              setA({ acc: accessoriesText(accessoriesOf(`${accessoriesText(acc)}, ${pt}×${qty}`)) });
            }}>افزودن متعلق</button>
          </div>)}
        <div className="mk-grid one">{text("note")}</div>
      </>)}
    </FormDialog>
  );
}
