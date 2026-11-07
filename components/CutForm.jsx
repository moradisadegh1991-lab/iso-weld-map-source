"use client";
import { useState } from "react";
import FormDialog from "./ui/FormDialog";
import Pick from "./ui/Pick";
import { isUid } from "../lib/sheet/mark-identity.mjs";
import { indexItems, resolveRef, editCut } from "../lib/register/cut-identity.mjs";
import { endSpoolMarks } from "../lib/register/cut-model.mjs";

/**
 * One piece of the sheet's cut table (CUT PIPE LENGTH) in a form — view, edit or add; the table only shows. Nothing reaches the sheet
 * until «ذخیره»/«ثبت».
 *
 * Phase 9: the two end welds and the spool are chosen BY IDENTITY (uid of the weld / spool mark of THIS revision); the printed numbers
 * shown beside them are labels. A legacy reference (a printed number, no uid) is shown as such: it is resolved only if exactly one weld /
 * spool has that number, else the form says it is ambiguous and the person picks one. Unknown attributes of the piece are kept as they are.
 *
 *   mode, cut   "view" | "edit" | "create", and the piece ({} for a new one)
 *   cuts        the sheet's pieces (the number must stay unique)
 *   items       the sheet's marks (welds, spools): the pickers are made from them
 *   onSave(cut), onClose, readOnly
 */
export default function CutForm({ mode: mode0 = "view", cut = {}, cuts = [], items = [], lists, onSave, onClose, readOnly = false }) {
  const [mode, setMode] = useState(readOnly ? "view" : mode0);
  const [start] = useState(() => ({ piece: "", lengthMm: "", ns: "", from: "", to: "", spool: "", angle: "", note: "", material: "", schedule: "", ...cut }));
  const [d, setD] = useState(start);
  const [err, setErr] = useState("");
  const [auto, setAuto] = useState(false);     // the spool was filled in from the end welds (not chosen by the person): it may be recomputed
  const dirty = JSON.stringify(d) !== JSON.stringify(start);
  const set = (patch) => { setErr(""); setD((x) => ({ ...x, ...patch })); };
  const ix = indexItems(items);
  const welds = ix.welds.list.filter((m) => isUid(m.uid) && String(m.no ?? "").trim());
  const spools = ix.spools.list.filter((m) => isUid(m.uid) && String(m.no ?? "").trim());
  const tag = (m) => `${String(m.no).trim()} · ${String(m.uid).slice(0, 8)}`;

  const save = () => {
    const piece = String(d.piece ?? "").trim();
    const len = Number(String(d.lengthMm ?? "").trim());
    if (!piece) { setErr("شمارهٔ قطعه لازم است."); return; }
    if (!(len > 0)) { setErr("طول برش باید عددی بزرگ‌تر از صفر باشد (mm)."); return; }
    if (cuts.some((c) => c !== cut && String(c.piece ?? "").trim() === piece)) { setErr(`قطعهٔ ${piece} روی این برگ هست.`); return; }
    const a = String(d.angle ?? "").trim();
    if (a && !(Number(a) > 0 && Number(a) <= 90)) { setErr("زاویهٔ برش باید عددی بین ۰ تا ۹۰ باشد."); return; }
    if (d.fromUid && d.fromUid === d.toUid) { setErr("ابتدا و انتهای قطعه یک سرجوش است."); return; }
    if (!d.fromUid && String(d.from ?? "").trim() && String(d.from).trim() === String(d.to ?? "").trim()) { setErr("ابتدا و انتهای قطعه یک سرجوش است."); return; }
    const next = { ...d, piece: /^\d+$/.test(piece) ? Number(piece) : piece, lengthMm: len };
    for (const k of ["material", "schedule", "angle", "note"]) if (!String(next[k] ?? "").trim() && !(k in cut)) delete next[k];
    onSave?.(cut && cut.piece !== undefined && cut.uid ? editCut(cut, next) : { ...next, src: "hand" });
  };

  const f = (k, label, node) => <label className="mk-f" data-form-field={k}><span className="muted sm">{label}</span>{node}</label>;
  const txt = (k, label, props = {}) => f(k, label, <input data-input={k} dir="ltr" value={d[k] ?? ""} onChange={(e) => set({ [k]: e.target.value })} {...props} />);

  /** A uid-based picker: value = the entity's uid; the printed number is its label; a reference that resolves to nothing is said, not hidden. */
  const refPick = (lab, key, set_, list, label, kind) => {
    const r = resolveRef(set_, { uid: d[key], label: d[lab] });
    const uidVal = r.mark && isUid(r.mark.uid) ? r.mark.uid : "";
    const note = r.state === "dangling" ? `uid ${String(r.uid).slice(0, 8)} در این رویژن نیست` : r.state === "ambiguous" ? `«${d[lab]}» چند مورد است — یکی را انتخاب کنید`
      : r.state === "unresolved" && String(d[lab] ?? "").trim() ? `«${d[lab]}» روی این برگ نیست` : r.state === "legacy" ? "ارجاع قدیمی (شمارهٔ چاپی)؛ با ذخیره به شناسه تبدیل می‌شود" : "";
    return (
      <div className="mk-f" data-form-field={lab} data-ref-state={r.state}>
        <label><span className="muted sm">{label}</span>
          <select data-input={lab} data-ref-uid={uidVal} dir="ltr" value={uidVal}
            onChange={(e) => {
              const m = list.find((x) => x.uid === e.target.value);
              if (kind === "spool") setAuto(false);
              const next = { [key]: m ? m.uid : "", [lab]: m ? String(m.no).trim() : "" };
              const merged = { ...d, ...next };
              // the two end welds' spool, by IDENTITY: one spool → preselect it; two different ones, an unknown or an ambiguous one → do not guess.
              // A spool the PERSON chose is never touched; one this form filled in is recomputed (and withdrawn when the ends disagree).
              const es = kind === "weld" && (!d.spoolUid || auto) ? endSpoolMarks(merged, items) : null;
              const sp = es && es.length === 1 && isUid(es[0].uid) ? spools.find((s) => s.uid.toLowerCase() === es[0].uid.toLowerCase()) : null;
              if (es) setAuto(Boolean(sp));
              set({ ...next, ...(sp ? { spoolUid: sp.uid, spool: String(sp.no).trim() } : es && auto ? { spoolUid: "", spool: "" } : {}) });
            }}>
            <option value="">—</option>
            {list.map((m) => <option key={m.uid} value={m.uid}>{tag(m)}</option>)}
          </select></label>
        {note && <span className="sm warnish" data-ref-note>{note}</span>}
        {r.mark && isUid(r.mark.uid) && (
          <span className="muted sm mono" dir="ltr" data-ref-identity>{String(r.mark.no).trim()} · uid {r.mark.uid}</span>)}
      </div>);
  };

  return (
    <FormDialog title={mode === "create" ? "ثبت قطعهٔ برش" : `قطعهٔ برش <${start.piece}>`} mode={mode} dirty={dirty} canEdit={!readOnly}
      onEdit={() => setMode("edit")} onSave={save} onClose={onClose} error={err} data-cut-form>
      {isUid(cut?.uid) && <p className="muted sm mono" dir="ltr" data-cut-identity style={{ margin: "0 0 6px" }}>uid {cut.uid}</p>}
      <div className="mk-grid">
        {txt("piece", "شمارهٔ قطعه *", { className: "mono", "data-autofocus": true })}
        {txt("lengthMm", "طول برش (mm) *", { className: "mono", inputMode: "decimal" })}
        {f("ns", "N.S.", <Pick data-input="ns" list="nps" lists={lists} value={d.ns} placeholder="؟" empty="؟" onChange={(v) => set({ ns: v })} />)}
        {f("material", "جنس", <Pick data-input="material" list="material" lists={lists} value={d.material} placeholder="—" empty="—" onChange={(v) => set({ material: v })} />)}
        {f("schedule", "Sch", <Pick data-input="schedule" list="schedule" lists={lists} value={d.schedule} placeholder="—" empty="—" onChange={(v) => set({ schedule: v })} />)}
        {refPick("from", "fromUid", ix.welds, welds, "سرجوش ابتدا", "weld")}
        {refPick("to", "toUid", ix.welds, welds, "سرجوش انتها", "weld")}
        {refPick("spool", "spoolUid", ix.spools, spools, "اسپول", "spool")}
        {txt("angle", "زاویهٔ برش (°)", { inputMode: "decimal", placeholder: "۹۰" })}
      </div>
      <div className="mk-grid one">{txt("note", "توضیح")}</div>
      {d.orig && <p className="muted sm" data-cut-orig>مقدار خوانده‌شده از نقشه (تصحیح‌شده توسط کاربر): {Object.entries(d.orig).map(([k, v]) => `${k}: ${v}`).join("، ")}</p>}
    </FormDialog>
  );
}
