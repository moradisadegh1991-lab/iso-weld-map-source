"use client";
import { useState } from "react";
import FormDialog from "./ui/FormDialog";
import Pick from "./ui/Pick";

/**
 * One BOM row of the sheet in a form (view / edit / create) — the BOM table only
 * shows; a row is added, viewed and edited here, like the marks (components/MarkForm.jsx).
 * It edits a draft; nothing reaches the sheet until «ذخیره»/«افزودن».
 *
 *   mode, row   "view" | "edit" | "create", and the row ({} for a new one)
 *   rows        the sheet's BOM rows (PT numbers must stay unique)
 *   onSave(row), onClose, readOnly (approved register: view only)
 */
export default function BomForm({ mode: mode0 = "view", row = {}, rows = [], lists, onSave, onClose, readOnly = false }) {
  const [mode, setMode] = useState(readOnly ? "view" : mode0);
  const [start] = useState(() => ({ pt: "", group: "", description: "", diam: "", stockCode: "", qty: "", qtyUnit: "pcs", ...row }));
  const [d, setD] = useState(start);
  const [err, setErr] = useState("");
  const dirty = JSON.stringify(d) !== JSON.stringify(start);
  const set = (patch) => { setErr(""); setD((x) => ({ ...x, ...patch })); };
  const save = () => {
    const pt = String(d.pt ?? "").trim();
    if (!pt) { setErr("شمارهٔ PT لازم است."); return; }
    if (rows.some((r) => r !== row && String(r.pt ?? "").trim() === pt)) { setErr(`PT ${pt} روی این برگ هست.`); return; }
    onSave?.({ ...d, pt });
  };
  const f = (k, label, node) => <label className="mk-f" data-form-field={k}><span className="muted sm">{label}</span>{node}</label>;
  const txt = (k, label, props = {}) => f(k, label, <input data-input={k} dir="ltr" value={d[k] ?? ""} onChange={(e) => set({ [k]: e.target.value })} {...props} />);
  return (
    <FormDialog title={mode === "create" ? "افزودن ردیف BOM" : `ردیف BOM — PT ${start.pt}`} mode={mode} dirty={dirty} canEdit={!readOnly}
      onEdit={() => setMode("edit")} onSave={save} onClose={onClose} error={err} data-bom-form>
      <div className="mk-grid">
        {txt("pt", "PT *", { className: "mono", "data-autofocus": true })}
        {f("group", "گروه", <Pick data-input="group" list="bomGroup" lists={lists} value={d.group} onChange={(v) => set({ group: v })} />)}
        {f("diam", "N.S.", <Pick data-input="diam" list="nps" lists={lists} value={d.diam} placeholder="؟" empty="؟" onChange={(v) => set({ diam: v })} />)}
        {txt("stockCode", "کد کالا", { className: "mono" })}
        {txt("qty", "تعداد", { className: "mono", placeholder: "؟", inputMode: "decimal" })}
        {f("qtyUnit", "واحد", <select data-input="qtyUnit" value={d.qtyUnit || ""} onChange={(e) => set({ qtyUnit: e.target.value || null })}>
          <option value="">؟</option><option value="pcs">عدد</option><option value="m">m</option></select>)}
      </div>
      <div className="mk-grid one">{txt("description", "شرح")}</div>
    </FormDialog>
  );
}
