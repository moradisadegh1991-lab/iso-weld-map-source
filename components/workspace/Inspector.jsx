"use client";
import { KINDS, ATTRS, isPlaced, engineRow } from "../../lib/sheet/markup.mjs";
import { sizesOf } from "../../lib/register/weld-marks.mjs";

/**
 * The engineering inspector: what is known about the mark picked on the
 * sheet (or in the table, or the explorer), from the page's own state and
 * nothing else. A value nobody gave is shown as unknown, never filled in; a
 * list is the items it was given.
 *
 *   item      the picked mark (lib/sheet/markup.mjs), or null
 *   items     all the marks (for the spool's welds)
 *   model     the engine's model, when there is one (its register row for a weld)
 *   bom       the sheet's BOM rows (what is bought at the weld's size)
 *   reviewed  { has(no) } — a weld ticked as checked against the drawing, when the review tracks it
 *
 * Display only: it edits nothing, and an engineer's decisions are made where
 * they always were (the table, the review).
 */
const SRC = { reader: "خواندن بدون مدل", model: "مدل هوش مصنوعی (تقریبی)", engine: "موتور مهندسی", person: "شخص" };
const unk = <span className="muted">نامعلوم</span>;
const Row = ({ k, v }) => (<><dt>{k}</dt><dd className="mono" dir="auto">{v === undefined || v === null || v === "" ? unk : v}</dd></>);

export default function Inspector({ item, items = [], model = null, bom = [], reviewed = null }) {
  if (!item) return <p className="muted sm" data-inspector="empty">یک نشان را روی نقشه، در جدول یا در ناوبر انتخاب کنید تا مشخصاتش اینجا بیاید.</p>;
  const cls = KINDS[item.kind].cls, a = item.attrs || {};
  const labels = Object.fromEntries((ATTRS[cls] || []).map(([k, l]) => [k, l]));
  const placed = isPlaced(item);
  const no = String(item.no ?? "").trim();
  const eng = cls === "weld" ? engineRow(model, item.no) : null;
  // what the sheet's BOM lists at this size (a row of the same diameter, or of a two-size item that has it)
  const size = Number(String(a.size || eng?.nps || "").replace(/[^\d./]/g, "").split(" ")[0]) || sizesOf(a.size || eng?.nps)[0] || null;
  const bomHere = size ? bom.filter((b) => sizesOf(b.diam ?? b.size).includes(size)) : [];
  const onSpool = cls === "spool" ? items.filter((m) => KINDS[m.kind].cls === "weld" && String(m.attrs?.spool ?? "").trim() === no) : [];
  const spoolOf = cls === "weld" && a.spool ? items.find((m) => m.kind === "spool" && String(m.no ?? "").trim() === String(a.spool).trim()) : null;
  const tickable = cls === "weld" && reviewed?.has;
  return (
    <div className="ws-insp" data-inspector={cls} data-inspector-no={no}>
      <div className="ws-insp-h">
        <b className="mono" dir="auto">{no || "؟"}</b>
        <span>{KINDS[item.kind].label}</span>
        {tickable && <span className={reviewed.has(no) ? "ok" : "muted sm"}>{reviewed.has(no) ? "✓ با نقشه بررسی شد" : "هنوز بررسی نشده"}</span>}
      </div>
      <dl className="ws-insp-dl">
        {(ATTRS[cls] || []).map(([k]) => <Row key={k} k={labels[k]} v={a[k]} />)}
        {cls === "spool" && <Row k="سرجوش‌های این اسپول" v={onSpool.length ? onSpool.map((m) => m.no).join("، ") : undefined} />}
        {spoolOf && <Row k="اسپول در نقشه" v={`${spoolOf.no}${spoolOf.attrs?.lengthMm ? ` · ${spoolOf.attrs.lengthMm} mm` : ""}`} />}
      </dl>
      {eng && (
        <>
          <div className="ws-insp-s">از موتور مهندسی (محاسبه‌شده، قابل‌ویرایش نیست)</div>
          <dl className="ws-insp-dl" data-inspector-engine>
            <Row k="محل" v={eng.loc === "Field" ? "سایت" : eng.loc === "Shop" ? "کارگاه" : eng.loc} />
            <Row k="نقش" v={eng.role} />
            <Row k="نوع اتصال" v={eng.kind} />
            <Row k="قطر" v={eng.size} />
            <Row k="تراز (EL)" v={eng.el != null ? Math.round(eng.el).toLocaleString("en-US") : undefined} />
            <Row k="NDT (موقت)" v={eng.ndt} />
            <Row k="اسپول" v={eng.spool} />
          </dl>
        </>)}
      <div className="ws-insp-s">روی نقشه</div>
      <dl className="ws-insp-dl">
        <Row k="جای نشان" v={placed ? "روی نقشه" : "هنوز جا ندارد"} />
        {cls === "weld" && <Row k="نقطهٔ جوش روی لوله" v={item.ax != null ? "دارد" : "ندارد"} />}
        <Row k="منشأ نشان" v={SRC[item.src] || item.src} />
      </dl>
      {cls === "weld" && (
        <>
          <div className="ws-insp-s">BOM در قطر {size ? `${size}"` : "؟"} ({bomHere.length})</div>
          {!size ? <p className="muted sm">قطر این جوش معلوم نیست، پس ردیف BOM مربوطش هم معلوم نیست.</p>
            : bomHere.length === 0 ? <p className="muted sm">هیچ ردیفی از BOM این برگ این قطر را ندارد.</p>
            : <ul className="ws-insp-bom" data-inspector-bom>{bomHere.slice(0, 8).map((b, i) => (
                <li key={`${b.pt}-${i}`}><span className="mono">PT {b.pt ?? "؟"}</span> <span dir="ltr">{String(b.description || "").slice(0, 70)}</span>
                  {b.qty != null && <span className="mono"> × {b.qty}{b.qtyUnit === "m" ? " m" : ""}</span>}</li>))}
              {bomHere.length > 8 && <li className="muted sm">و {bomHere.length - 8} ردیف دیگر — تب BOM</li>}</ul>}
        </>)}
    </div>
  );
}
