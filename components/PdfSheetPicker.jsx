"use client";
import { useEffect, useState } from "react";
import { renderThumbnail } from "../lib/client/pdf.mjs";

/**
 * Choosing which sheet to work on.
 *
 * An isometric PDF is a bundle: the one we opened carries fourteen drawings
 * behind three cover pages. Nobody knows page numbers, so the thumbnails do
 * the identifying — a piping engineer recognises the routing shape of their
 * own line at a glance, long before the title block is legible.
 *
 * Thumbnails render lazily, one at a time, so opening a large document does
 * not freeze the tab while it draws pages nobody asked for.
 */
export default function PdfSheetPicker({ doc, pages, onPick, busy }) {
  const [thumbs, setThumbs] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const p of pages) {
        if (cancelled) return;
        try {
          const url = await renderThumbnail(doc, p.index);
          if (!cancelled) setThumbs((t) => ({ ...t, [p.index]: url }));
        } catch (e) {
          // A page that will not render is still selectable — but say so.
          // A silently blank thumbnail once hid a pdf.js build incompatibility
          // that broke every render in the document.
          console.warn(`thumbnail for page ${p.index} failed to render:`, e);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [doc, pages]);

  return (
    <div className="sheetpicker">
      <div className="ask-q">کدام برگ؟ <span className="muted sm">({pages.length} صفحه)</span></div>
      <div className="sheets">
        {pages.map((p) => (
          <button key={p.index} className="sheet" disabled={busy} onClick={() => onPick(p.index)}>
            {thumbs[p.index]
              ? <img src={thumbs[p.index]} alt={`صفحه ${p.index}`} />
              : <div className="sheet-blank">…</div>}
            <b className="mono">{p.index}</b>
            <span className="mono sm">{p.label}</span>
          </button>
        ))}
      </div>
      <p className="muted sm">
        نقشهٔ برداری در ۳۰۰ DPI رندر می‌شود — تمیزتر از هر اسکنی از همان برگ، و
        رزولوشن یک <b>انتخاب</b> است نه چیزی که از اپراتور اسکنر به ارث رسیده.
      </p>
    </div>
  );
}
