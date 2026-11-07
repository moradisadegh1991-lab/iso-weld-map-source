"use client";
import { useMemo, useState } from "react";
import { collectFindings } from "../lib/register/workspace-validation.mjs";

/**
 * The Validation tab: every finding the page's existing checks produce, in one list, grouped by source.
 * A finding with a `ref` selects its mark (same selection as the drawing and the tables). Read-only —
 * fixing happens where the data is edited; the server still re-checks on save.
 */
const SOURCE = { register: "رجیستر", sheet: "نشان‌های نقشه", "weld parts": "قطعات سرجوش", equipment: "تجهیزات", bom: "BOM", cut: "برش" };

export default function ValidationPanel({ input, onSelect }) {
  const { findings, total } = useMemo(() => collectFindings(input), [input]);
  const [only, setOnly] = useState("all");
  const shown = only === "all" ? findings : findings.filter((f) => f.level === only);
  return (
    <div data-validation>
      <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <b data-validation-total>{total ? `${total} مورد` : "ایرادی پیدا نشد"}</b>
        <select value={only} aria-label="validation filter" data-validation-filter onChange={(e) => setOnly(e.target.value)}>
          <option value="all">همه</option><option value="error">فقط ایراد</option><option value="warn">فقط هشدار</option>
        </select>
        <span className="muted sm">فقط همین بررسی‌های موجود صفحه؛ سرور هنگام ذخیره دوباره می‌سنجد.</span>
      </div>
      {total === 0 && <p className="muted" data-validation-empty>همهٔ بررسی‌های صفحه (رجیستر، نشان‌ها، BOM، قطعات، تجهیزات، برش) گذشت.</p>}
      <ul className="sm" style={{ paddingInlineStart: 18 }}>
        {shown.map((f, i) => (
          <li key={i} className={f.level === "error" ? "err" : ""} data-finding={f.source} data-level={f.level}>
            <span className="muted">[{SOURCE[f.source] || f.source}]</span>{" "}
            {f.ref ? <button type="button" className="ghost sm" data-finding-select={f.ref} onClick={() => onSelect?.(f.ref)}>{f.message}</button> : f.message}
          </li>))}
      </ul>
    </div>
  );
}
