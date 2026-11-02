"use client";
import { canTake, usage } from "../lib/register/bom-allocation.mjs";

/**
 * A weld's component: one PT row of this sheet's BOM, shown with its
 * description and size. What it was when picked is kept beside it (c1s/c2s)
 * so a BOM row changed later is reported. A PT the BOM does not have stays,
 * marked; with no BOM on the sheet the PT is typed.
 */
export default function BomPick({ bom, value, onPick, disabled, items, weldId, slot, ...rest }) {
  const v = String(value ?? "").trim();
  const rows = (bom || []).filter((b) => b && b.pt != null && String(b.pt).trim());
  // a row with none of its welded ends left is not offered to another weld, and says why (lib/register/bom-allocation.mjs)
  const take = new Map(rows.map((b) => [String(b.pt), canTake(items, bom, weldId, slot, b.pt)]));
  const use = usage(items, bom);
  if (!rows.length) return <input dir="ltr" className="mono" style={{ width: 70 }} value={v} placeholder="PT" disabled={disabled} onChange={(e) => onPick(e.target.value, null)} {...rest} />;
  const known = !v || rows.some((b) => String(b.pt) === v);
  return (
    <select dir="ltr" style={{ width: "100%", minWidth: 170 }} value={v} disabled={disabled} data-bom-pick title={known ? undefined : `PT ${v} در BOM این برگ نیست`}
      onChange={(e) => onPick(e.target.value, rows.find((b) => String(b.pt) === e.target.value) || null)} {...rest}>
      <option value="">—</option>
      {!known && <option value={v}>PT {v} (در BOM نیست)</option>}
      {rows.map((b) => {
        const t = take.get(String(b.pt)), u = use.get(String(b.pt));
        const left = u?.cap?.capacity != null ? ` · مانده ${Math.max(0, u.left)}/${u.cap.capacity}` : "";
        return <option key={b.pt} value={String(b.pt)} disabled={!t.ok} title={t.why || undefined}>{`PT ${b.pt} — ${String(b.description || b.group || "").slice(0, 38)}${b.diam ? ` (${b.diam})` : ""}${left}${t.ok ? "" : " ✕"}`}</option>;
      })}
    </select>
  );
}

