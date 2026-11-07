"use client";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The drawing of a P&ID page with its recognized items drawn over it (read-only: it shows the draft, it changes none of it).
 *   src         the page as an image (rendered from the stored PDF), or null — the frame still shows the boxes on a blank sheet of the page's size
 *   page        { width, height } of the ORIGINAL page (the boxes are normalized 0..1 against it)
 *   items       the draft's items; a box where the reader gave one, a marker at the centre where it gave a point
 *   selectedUid, highlight (a Set of connected uids), focusTick (bumped when a register row is picked: the view moves to the item)
 *   onSelect(uid)
 * Zoom with the buttons or the wheel, pan by dragging; the original PDF stays the governing source.
 */
const STATUS_COLOR = { extracted: "#e0a63a", needs_review: "#e0a63a", corrected: "#43A0B4", approved: "#3fb27f", rejected: "#8a8f94", unresolved: "#e2574c", ambiguous: "#e2574c", superseded: "#8a8f94" };
const LABEL = { extracted: "استخراج‌شده", needs_review: "نیازمند بازبینی", corrected: "اصلاح‌شده", approved: "تأییدشده", rejected: "ردشده", unresolved: "حل‌نشده", ambiguous: "مبهم", superseded: "جایگزین‌شده" };
const clampZ = (z) => Math.max(0.3, Math.min(8, z));

export default function PidViewer({ src = null, page = { width: 1000, height: 800 }, items = [], selectedUid = null, highlight = null, focusTick = 0, onSelect, showLabels = true }) {
  const box = useRef(null), drag = useRef(null);
  const [v, setV] = useState({ x: 0, y: 0, k: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const aspect = page.width > 0 && page.height > 0 ? page.width / page.height : 1.414;
  useEffect(() => { const el = box.current; if (!el) return undefined; const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight }); return () => ro.disconnect(); }, []);
  // the page at zoom 1 fits the frame
  const base = useMemo(() => { const w = Math.min(size.w, size.h * aspect) || size.w || 1, h = w / aspect; return { w, h }; }, [size, aspect]);
  const sel = items.find((i) => i.uid === selectedUid);
  useEffect(() => {
    if (!focusTick || !sel) return;
    const c = sel.center || (sel.bbox && { x: (sel.bbox.x0 + sel.bbox.x1) / 2, y: (sel.bbox.y0 + sel.bbox.y1) / 2 });
    if (!c) return;
    setV((o) => { const k = Math.max(o.k, 2); return { k, x: size.w / 2 - (size.w - base.w) / 2 - k * c.x * base.w, y: size.h / 2 - (size.h - base.h) / 2 - k * c.y * base.h }; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);
  const zoom = (f, cx = size.w / 2, cy = size.h / 2) => setV((o) => { const k = clampZ(o.k * f), r = k / o.k, ox = (size.w - base.w) / 2, oy = (size.h - base.h) / 2; return { k, x: (cx - ox) - (cx - ox - o.x) * r, y: (cy - oy) - (cy - oy - o.y) * r }; });
  const onWheel = (e) => { e.preventDefault(); const r = box.current.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); };
  useEffect(() => { const el = box.current; if (!el) return undefined; const h = (e) => onWheel(e); el.addEventListener("wheel", h, { passive: false }); return () => el.removeEventListener("wheel", h); });
  const down = (e) => { if (e.target.closest("[data-pid-box]")) return; drag.current = { x: e.clientX, y: e.clientY, o: v }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = (e) => { const d = drag.current; if (d) setV({ ...d.o, x: d.o.x + e.clientX - d.x, y: d.o.y + e.clientY - d.y }); };
  const up = () => { drag.current = null; };
  const offX = (size.w - base.w) / 2, offY = (size.h - base.h) / 2;
  return (
    <div className="pid-viewer" data-pid-viewer>
      <div className="pid-tools row" style={{ gap: 4 }}>
        <button type="button" className="ghost sm" aria-label="zoom in" data-pid-zoom="in" onClick={() => zoom(1.25)}>+</button>
        <button type="button" className="ghost sm" aria-label="zoom out" data-pid-zoom="out" onClick={() => zoom(1 / 1.25)}>−</button>
        <button type="button" className="ghost sm" data-pid-zoom="fit" onClick={() => setV({ x: 0, y: 0, k: 1 })}>جا شدن</button>
        <span className="muted sm mono" data-pid-zoom-level>{Math.round(v.k * 100)}%</span>
      </div>
      <div className="pid-stage" ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ touchAction: "none" }}>
        <div className="pid-sheet" style={{ width: base.w, height: base.h, left: offX, top: offY, transform: `translate(${v.x}px, ${v.y}px) scale(${v.k})`, transformOrigin: "0 0" }} data-pid-sheet>
          {src ? <img src={src} alt="P&ID" draggable={false} style={{ width: "100%", height: "100%", display: "block", userSelect: "none" }} /> : <div className="pid-blank" data-pid-blank />}
          {items.map((i) => {
            const b = i.bbox, c = i.center;
            if (!b && !c) return null;
            const color = STATUS_COLOR[i.review?.status || "extracted"], on = i.uid === selectedUid, hl = highlight?.has(i.uid);
            const st = b ? { left: `${b.x0 * 100}%`, top: `${b.y0 * 100}%`, width: `${(b.x1 - b.x0) * 100}%`, height: `${(b.y1 - b.y0) * 100}%` } : { left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: 14 / v.k, height: 14 / v.k, transform: "translate(-50%,-50%)", borderRadius: "50%" };
            return (
              <button type="button" key={i.uid} data-pid-box={i.uid} data-pid-status={i.review?.status || "extracted"} data-pid-cls={i.cls} aria-pressed={on} aria-label={`${i.cls} ${i.tag || i.printed || ""}`}
                className={`pid-box ${on ? "on" : ""} ${hl ? "hl" : ""}`} style={{ ...st, borderColor: color, boxShadow: on ? `0 0 0 ${2 / v.k}px ${color}` : undefined, background: hl ? "rgba(67,160,180,.18)" : "transparent", borderWidth: Math.max(1, 1.5 / v.k) }}
                onClick={(e) => { e.stopPropagation(); onSelect?.(i.uid); }}>
                {showLabels && (on || hl || v.k >= 2) && <span className="pid-lab mono" dir="ltr" style={{ fontSize: Math.max(8, 11 / v.k), background: color }}>{i.tag || i.printed || i.cls}{i.confidence != null ? ` · ${Math.round(i.confidence * 100)}%` : ""}</span>}
              </button>);
          })}
        </div>
      </div>
      <p className="muted sm" data-pid-legend style={{ margin: "4px 0 0" }}>
        {Object.entries({ extracted: "استخراج‌شده", corrected: "اصلاح‌شده", approved: "تأییدشده", ambiguous: "مبهم/حل‌نشده", rejected: "ردشده" }).map(([k, l]) => (
          <span key={k} style={{ marginInlineEnd: 10 }}><i style={{ display: "inline-block", width: 10, height: 10, border: `2px solid ${STATUS_COLOR[k === "ambiguous" ? "ambiguous" : k]}`, marginInlineEnd: 4 }} />{l}</span>))}
        · PDF اصلی مرجع است؛ جعبه‌ها پیشنهاد خواندن‌اند
      </p>
    </div>
  );
}
export { LABEL as STATUS_LABEL };
