"use client";
import { useState } from "react";
import FormDialog from "./ui/FormDialog";
import Pick from "./ui/Pick";
import { endSpools } from "../lib/register/cut-model.mjs";

/**
 * One piece of the sheet's cut table (CUT PIPE LENGTH) in a form — view, edit or add;
 * the cut table only shows (like the BOM and the marks). Nothing reaches the sheet until
 * «ذخیره»/«ثبت».
 *
 *   mode, cut   "view" | "edit" | "create", and the piece ({} for a new one)
 *   cuts        the sheet's pieces (the number must stay unique)
 *   spools      the spool numbers of the sheet, to say which spool a piece goes to
 *   items       the sheet's marks: the welds a piece starts and ends at are picked from them (lib/register/cut-model.mjs)
 *   onSave(cut), onClose, readOnly
 */
export default function CutForm({ mode: mode0 = "view", cut = {}, cuts = [], spools = [], items = [], lists, onSave, onClose, readOnly = false }) {
  const [mode, setMode] = useState(readOnly ? "view" : mode0);
  const [start] = useState(() => ({ piece: "", lengthMm: "", ns: "", from: "", to: "", spool: "", angle: "", note: "", ...cut }));
  const [d, setD] = useState(start);
  const [err, setErr] = useState("");
  const dirty = JSON.stringify(d) !== JSON.stringify(start);
  const set = (patch) => { setErr(""); setD((x) => ({ ...x, ...patch })); };
  const save = () => {
    const piece = String(d.piece ?? "").trim();
    const len = Number(String(d.lengthMm ?? "").trim());
    if (!piece) { setErr("شمارهٔ قطعه لازم است."); return; }
    if (!(len > 0)) { setErr("طول برش باید عددی بزرگ‌تر از صفر باشد (mm)."); return; }
    if (cuts.some((c) => c !== cut && String(c.piece ?? "").trim() === piece)) { setErr(`قطعهٔ ${piece} روی این برگ هست.`); return; }
    const a = String(d.angle ?? "").trim();
    if (a && !(Number(a) > 0 && Number(a) <= 90)) { setErr("زاویهٔ برش باید عددی بین ۰ تا ۹۰ باشد."); return; }
    if (String(d.from ?? "").trim() && String(d.from).trim() === String(d.to ?? "").trim()) { setErr("ابتدا و انتهای قطعه یک سرجوش است."); return; }
    onSave?.({ ...d, piece: /^\d+$/.test(piece) ? Number(piece) : piece, lengthMm: len });
  };
  const f = (k, label, node) => <label className="mk-f" data-form-field={k}><span className="muted sm">{label}</span>{node}</label>;
  const weldNos = items.filter((m) => /^weld/.test(m.kind) && String(m.no ?? "").trim()).map((m) => String(m.no).trim());
  const end = (k, label) => f(k, label, <select data-input={k} dir="ltr" value={d[k] ?? ""}
    onChange={(e) => { const next = { ...d, [k]: e.target.value }; const es = endSpools(next, items);
      set({ [k]: e.target.value, ...(!String(d.spool ?? "").trim() && es.length === 1 ? { spool: es[0] } : {}) }); }}>
    <option value="">—</option>
    {d[k] && !weldNos.includes(String(d[k])) && <option value={d[k]}>{d[k]} (روی برگ نیست)</option>}
    {weldNos.map((n) => <option key={n} value={n}>{n}</option>)}
  </select>);
  const txt = (k, label, props = {}) => f(k, label, <input data-input={k} dir="ltr" value={d[k] ?? ""} onChange={(e) => set({ [k]: e.target.value })} {...props} />);
  return (
    <FormDialog title={mode === "create" ? "ثبت قطعهٔ برش" : `قطعهٔ برش <${start.piece}>`} mode={mode} dirty={dirty} canEdit={!readOnly}
      onEdit={() => setMode("edit")} onSave={save} onClose={onClose} error={err} data-cut-form>
      <div className="mk-grid">
        {txt("piece", "شمارهٔ قطعه *", { className: "mono", "data-autofocus": true })}
        {txt("lengthMm", "طول برش (mm) *", { className: "mono", inputMode: "decimal" })}
        {f("ns", "N.S.", <Pick data-input="ns" list="nps" lists={lists} value={d.ns} placeholder="؟" empty="؟" onChange={(v) => set({ ns: v })} />)}
        {end("from", "سرجوش ابتدا")}{end("to", "سرجوش انتها")}
        {f("spool", "اسپول", spools.length
          ? <select data-input="spool" dir="ltr" value={d.spool ?? ""} onChange={(e) => set({ spool: e.target.value })}>
              <option value="">—</option>
              {d.spool && !spools.includes(String(d.spool)) && <option value={d.spool}>{d.spool} (روی برگ نیست)</option>}
              {spools.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          : <input data-input="spool" dir="ltr" value={d.spool ?? ""} placeholder="SP-1" onChange={(e) => set({ spool: e.target.value })} />)}
        {txt("angle", "زاویهٔ برش (°)", { inputMode: "decimal", placeholder: "۹۰" })}
      </div>
      <div className="mk-grid one">{txt("note", "توضیح")}</div>
    </FormDialog>
  );
}
