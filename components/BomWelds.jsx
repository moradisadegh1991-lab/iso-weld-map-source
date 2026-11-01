"use client";
import { useMemo } from "react";
import { compareBomWelds } from "../lib/register/bom-welds.mjs";

const KIND = { BW: "جوش لب‌به‌لب (BW)", SW: "جوش ساکتی (SW)", OLET: "انشعاب روی لوله (OLET)", SO: "فلنج اسلیپ‌آن (SO)", THD: "اتصال رزوه‌ای (THD — جوش نیست)" };
const sizeText = (s) => (s == null ? "؟" : `${s}"`);

/**
 * The welds the sheet's BOM implies (lib/register/bom-welds.mjs) beside the
 * welds of the list being reviewed: size by size and kind by kind. It
 * counts and names; which weld is missing, or which two fittings share a
 * weld, a person decides on the drawing.
 */
export default function BomWelds({ bom, welds }) {
  const c = useMemo(() => compareBomWelds(bom, welds), [bom, welds]);
  if (!c.ends.length && !c.unclassified.length) return null;
  const short = c.complete && c.weldCount < c.least;
  return (
    <details className="intake-more" open data-bom-welds={c.total} data-bom-complete={c.complete ? "yes" : "no"}>
      <summary>سرجوش‌ها از روی BOM — {c.total} سر جوشیِ اتصالات{c.threaded ? ` و ${c.threaded} اتصال رزوه‌ای` : ""}؛ در فهرست {c.weldCount} جوش</summary>
      <p className="muted sm">
        هر قطعه با سرهای جوشی‌اش شمرده شده، همان‌طور که شرحش می‌گوید (زانویی دو سر، سه‌راهی سه سر، فلنج گلودار یک سر، شیر فلنجی هیچ).
        لوله و نیپل شمرده نمی‌شوند — سرشان همان ساکت یا پخ اتصالی است که به آن جوش می‌شوند.
        پس جوش‌های اتصالات این برگ حداکثر {c.total} و حداقل {c.least} است (دو اتصالی که مستقیم به هم جوش شوند یک جوش‌اند)؛
        جوش لوله به لوله و اتصال به برگ بعد در BOM نیست.
      </p>
      {!c.complete && (
        <p className="err sm" data-bom-incomplete>
          شمارش کامل نیست —{" "}
          {[c.missingPts.length && `ردیف PT ${c.missingPts.join("، ")} خوانده نشده`,
            c.noQty.length && `تعداد PT ${c.noQty.map((r) => r.pt ?? "؟").join("، ")} خوانده نشده`,
            c.unclassified.length && `شرح ${c.unclassified.map((r) => `PT ${r.pt ?? "؟"}`).join("، ")} نمی‌گوید سرهایش چگونه وصل می‌شوند`].filter(Boolean).join("؛ ")}.
          این ردیف‌ها را با نقشه کامل کنید؛ عدد بالا فقط ردیف‌های شمرده‌شده است.
        </p>)}
      {short && (
        <p className="err sm" data-bom-short>
          فهرست {c.weldCount} جوش دارد، کمتر از حداقلی که BOM می‌گوید ({c.least}): احتمالاً سرجوشی روی نقشه پیدا یا وارد نشده است.
        </p>)}
      <table className="dtable">
        <thead><tr><th>قطر</th><th>نوع</th><th>سر جوشی در BOM</th><th>ردیف‌های BOM</th><th>در فهرست</th></tr></thead>
        <tbody>{c.rows.map((r) => (
          <tr key={`${r.size}|${r.kind}`} data-bom-weld-row={`${r.size ?? "?"}|${r.kind}`} className={r.bomEnds !== r.welds ? "warn" : undefined}>
            <td className="mono" dir="ltr">{sizeText(r.size)}</td><td className="sm">{KIND[r.kind] || r.kind}</td>
            <td className="mono">{r.bomEnds}</td><td className="mono sm">{r.pts.length ? r.pts.join("، ") : "—"}</td><td className="mono">{r.welds}</td>
          </tr>))}</tbody>
      </table>
      {c.unsized.length > 0 && <p className="muted sm">{c.unsized.length} جوش فهرست هنوز قطر یا نوع ندارد و در جدول نیامده است.</p>}
    </details>
  );
}
