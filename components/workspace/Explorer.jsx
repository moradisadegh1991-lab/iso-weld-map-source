"use client";

/**
 * The workspace's navigator (the start-side panel): what is on the screen
 * now, from the page's own state — the drawing's identity, the sheets of the
 * open PDF, and the marks on the sheet (welds, spools, supports) with where
 * each stands. Nothing here is made up: a count is a count of the items it
 * is given, an identity the reading did not give is shown as unknown.
 *
 *   meta       { drawingNo, rev, sheet, lineNo }
 *   sheets     { pages: [{ index }], current, onPick(i) } — the PDF's pages, when one is open
 *   items      the marks (lib/sheet/markup.mjs): { id, kind, no, x, y, ax, ay, attrs }
 *   selectedId, onSelect(id)
 *   checked    { has(no) } — a weld ticked as checked against the drawing, when the review tracks it
 */
const GROUPS = [
  ["weld", "سرجوش‌ها", (k) => String(k).startsWith("weld")],
  ["spool", "اسپول‌ها", (k) => k === "spool"],
  ["support", "ساپورت‌ها", (k) => k === "support"],
];
const placed = (m) => Number.isFinite(m?.x) && Number.isFinite(m?.y);
const KIND_MARK = { "weld-shop": "●", "weld-field": "■", "weld-unknown": "○", spool: "⬭", support: "⬢" };

export default function Explorer({ meta = {}, sheets = null, items = [], selectedId = null, onSelect, checked = null }) {
  const unk = <span className="muted">نامعلوم</span>;
  return (
    <div className="ws-ex" data-explorer-body>
      <div className="ws-ex-sec" data-ex="doc">
        <div className="ws-ex-h">نقشه</div>
        <dl className="ws-ex-dl">
          <dt>شمارهٔ نقشه</dt><dd className="mono" dir="ltr">{meta.drawingNo || unk}</dd>
          <dt>رویژن</dt><dd className="mono" dir="ltr">{meta.rev || unk}</dd>
          <dt>شیت</dt><dd className="mono" dir="ltr">{meta.sheet || unk}</dd>
          <dt>خط</dt><dd className="mono" dir="ltr">{meta.lineNo || unk}</dd>
        </dl>
      </div>
      {sheets?.pages?.length > 1 && (
        <div className="ws-ex-sec" data-ex="sheets">
          <div className="ws-ex-h">برگ‌های فایل ({sheets.pages.length})</div>
          <ul className="ws-ex-list">
            {sheets.pages.map((p) => (
              <li key={p.index}>
                <button type="button" className={p.index === sheets.current ? "on" : ""} aria-current={p.index === sheets.current ? "true" : undefined}
                  data-ex-sheet={p.index} onClick={() => p.index !== sheets.current && sheets.onPick?.(p.index)}>برگ {p.index}</button>
              </li>))}
          </ul>
        </div>)}
      {GROUPS.map(([g, title, is]) => {
        const rows = items.filter((m) => is(m.kind));
        return (
          <div className="ws-ex-sec" key={g} data-ex={g}>
            <div className="ws-ex-h">{title} ({rows.length})</div>
            {rows.length === 0 ? <p className="muted sm">هیچ‌کدام ثبت نشده.</p> : (
              <ul className="ws-ex-list marks">
                {rows.map((m) => {
                  const no = String(m.no ?? "").trim();
                  const ok = g === "weld" && checked?.has?.(no);
                  return (
                    <li key={m.id}>
                      <button type="button" className={m.id === selectedId ? "on" : ""} aria-pressed={m.id === selectedId} data-ex-mark={m.id}
                        title={placed(m) ? "روی نقشه جا دارد" : "هنوز روی نقشه جا ندارد"} onClick={() => onSelect?.(m.id)}>
                        <span className="mk" aria-hidden="true">{KIND_MARK[m.kind] || "•"}</span>
                        <span className="mono">{no || "؟"}</span>
                        <span className={`st ${placed(m) ? "" : "off"}`} aria-label={placed(m) ? "روی نقشه" : "روی نقشه نیست"}>{placed(m) ? "" : "بدون جا"}</span>
                        {ok && <span className="ok" aria-label="بررسی شد">✓</span>}
                      </button>
                    </li>);
                })}
              </ul>)}
          </div>);
      })}
    </div>
  );
}
