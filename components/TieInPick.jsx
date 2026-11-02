"use client";
import { useEffect, useMemo, useState } from "react";
import { usePlatformMaybe } from "../lib/client/platform.mjs";
import { formatRef, parseRef } from "../lib/sheet/tie-in.mjs";

/**
 * The Tie-in of a weld, picked: the isometric (this sheet, or another drawing of the
 * project), its sheet, and the weld on it (lib/sheet/tie-in.mjs writes the reference).
 * A reference typed before (an external note) stays as it is, shown as «متن آزاد».
 *
 *   value, onChange(ref)   the weld's attrs.ref
 *   weldNos                the weld numbers of this sheet (the choices for «همین برگ»)
 *   thisDoc                this sheet's drawing number, left out of the other isometrics
 */
const THIS = "__this__", FREE = "__free__";
export default function TieInPick({ value, onChange, weldNos = [], thisDoc = "", disabled, ...rest }) {
  const platform = usePlatformMaybe();
  const [iso, setIso] = useState([]);
  useEffect(() => {
    if (!platform?.projectId || !platform.call) return undefined;
    let live = true;
    platform.call(`/api/tie-in-targets?projectId=${encodeURIComponent(platform.projectId)}`).then((r) => { if (live) setIso(r.isometrics || []); }).catch(() => {});
    return () => { live = false; };
  }, [platform?.projectId, platform?.call]);
  const p = parseRef(value);
  const others = useMemo(() => iso.filter((x) => x.doc !== String(thisDoc).trim()), [iso, thisDoc]);
  // the choice made in the first select sticks even while its value is still empty («متن آزاد» with nothing typed yet)
  const [forced, setForced] = useState(null);
  const derived = p.doc ? p.doc : (p.weld && !weldNos.includes(p.weld) ? FREE : THIS);
  const mode = forced && (forced === FREE || forced === THIS) && !p.doc ? forced : derived;
  const cur = others.find((x) => x.doc === p.doc);
  const sheets = cur?.sheets || [];
  const sh = sheets.find((s) => s.sheet === p.sheet);
  const emit = (n) => onChange?.(formatRef(n));
  return (
    <div className="mk-tie" data-tie-in {...rest}>
      <select data-tie="doc" aria-label="شمارهٔ ایزومتریک" disabled={disabled} value={mode}
        onChange={(e) => { const v = e.target.value; setForced(v === FREE || v === THIS ? v : null); if (v === THIS) emit({ weld: "" }); else if (v === FREE) emit({ weld: p.weld || "" }); else emit({ doc: v, sheet: "", weld: "" }); }}>
        <option value={THIS}>همین برگ</option>
        {others.map((x) => <option key={x.doc} value={x.doc}>{x.doc}</option>)}
        {p.doc && !others.some((x) => x.doc === p.doc) && <option value={p.doc}>{p.doc} (در پروژه نیست)</option>}
        <option value={FREE}>متن آزاد / ارجاع بیرونی</option>
      </select>
      {mode === THIS && (
        <select data-tie="weld" aria-label="سرجوش" dir="ltr" disabled={disabled} value={p.weld} onChange={(e) => emit({ weld: e.target.value })}>
          <option value="">—</option>
          {p.weld && !weldNos.includes(p.weld) && <option value={p.weld}>{p.weld}</option>}
          {weldNos.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>)}
      {mode === FREE && <input data-tie="free" dir="ltr" disabled={disabled} value={p.weld} onChange={(e) => emit({ weld: e.target.value })} />}
      {mode !== THIS && mode !== FREE && (<>
        <select data-tie="sheet" aria-label="شیت" dir="ltr" disabled={disabled} value={p.sheet} onChange={(e) => emit({ doc: p.doc, sheet: e.target.value, weld: "" })}>
          <option value="">شیت…</option>
          {p.sheet && !sh && <option value={p.sheet}>{p.sheet}</option>}
          {sheets.map((s) => <option key={s.sheet} value={s.sheet}>{s.sheet} · Rev {s.revision}</option>)}
        </select>
        <select data-tie="weld" aria-label="سرجوش" dir="ltr" disabled={disabled} value={p.weld} onChange={(e) => emit({ doc: p.doc, sheet: p.sheet, weld: e.target.value })}>
          <option value="">سرجوش…</option>
          {p.weld && !(sh?.welds || []).includes(p.weld) && <option value={p.weld}>{p.weld}</option>}
          {(sh?.welds || []).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </>)}
    </div>
  );
}
