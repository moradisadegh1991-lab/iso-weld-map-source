"use client";
import { useLayoutEffect, useRef, useState } from "react";

/**
 * A floating panel (a column chooser, a right-click menu, a column's menu) the
 * person can move and resize (owner's requirements 2026-10-22, item 8): shown
 * where it was opened but pulled inside the window, dragged by its grip,
 * resized from its lower corner (CSS `resize`, class `float-panel`). Closing
 * on a click outside stays the panel's own business.
 *
 *   const f = useFloat();
 *   <div ref={f.ref} className="… float-panel" style={{ …, ...f.style }}>{f.grip}…</div>
 */
export function useFloat() {
  const ref = useRef(null);
  const [d, setD] = useState({ x: 0, y: 0 });
  // inside the window: shifted back by whatever it sticks out
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const dx = r.right > vw - 8 ? Math.max(8 - r.left, vw - 8 - r.right) : r.left < 8 ? 8 - r.left : 0;
      const dy = r.bottom > vh - 8 ? Math.max(8 - r.top, vh - 8 - r.bottom) : r.top < 8 ? 8 - r.top : 0;
      if (dx || dy) setD((p) => ({ x: p.x + dx, y: p.y + dy }));
    };
    fit();
    // its content may come after it opened: pulled in again then, once
    const t = setTimeout(fit, 60);
    return () => clearTimeout(t);
  }, []);
  const start = (e) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, from = d;
    const move = (m) => setD({ x: from.x + m.clientX - sx, y: from.y + m.clientY - sy });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return {
    ref,
    style: { transform: `translate(${d.x}px, ${d.y}px)` },
    grip: <div className="float-grip" onPointerDown={start} aria-hidden="true" data-float-grip>⠿</div>,
  };
}

/** A floating panel as a component: movable, resizable, inside the window; `onClose` (when given) on a click outside it or Escape. */
export function FloatBox({ className = "", style = {}, onClose = null, children, ...rest }) {
  const f = useFloat();
  useLayoutEffect(() => {
    if (!onClose) return undefined;
    const down = (e) => { if (f.ref.current && !f.ref.current.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === "Escape") onClose(); };
    const t = setTimeout(() => document.addEventListener("pointerdown", down), 0);
    document.addEventListener("keydown", key);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={f.ref} className={`${className} float-panel`} style={{ ...style, ...f.style }} {...rest}>{f.grip}{children}</div>;
}

/**
 * A row's lower edge, dragged, sets that row's height (owner's requirements
 * 2026-10-22, item 7). `rowEdgeHover` marks the cell under the pointer when
 * it is within a few pixels of the row's bottom (the cursor turns); a
 * pointerdown there (`rowEdgeDown`, returning true when it took the event)
 * drags the height, kept on the row for as long as it is on the page.
 */
const EDGE = 4;
const edgeCell = (e) => {
  const td = e.target?.closest?.("tbody td");
  if (!td) return null;
  const r = td.getBoundingClientRect();
  return r.bottom - e.clientY <= EDGE && r.bottom - e.clientY >= -1 ? td : null;
};
export function rowEdgeHover(e) {
  const td = e.target?.closest?.("tbody td");
  const at = edgeCell(e);
  if (td) td.classList.toggle("tk-row-edge", !!at);
}
export function rowEdgeDown(e) {
  if (e.button !== 0) return false;
  const td = edgeCell(e);
  if (!td) return false;
  const tr = td.parentElement;
  e.preventDefault(); e.stopPropagation();
  const y0 = e.clientY, h0 = tr.getBoundingClientRect().height;
  const move = (m) => { const h = Math.max(18, Math.min(400, Math.round(h0 + m.clientY - y0))); tr.style.height = `${h}px`; for (const c of tr.cells) c.style.height = `${h}px`; };
  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  return true;
}
