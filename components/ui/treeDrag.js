"use client";
import { useRef, useState } from "react";

/**
 * Drag and drop for tree rows. A row dropped on the top quarter of another
 * goes before it, on the bottom quarter after it (the same parent, a new
 * order), in the middle under it. `onDrop(dragged, target, zone)` gets
 * "before" | "after" | "inside".
 *
 * Rows are spread with these props from plain functions, never from a
 * component defined during render: such a component is new on every hover,
 * React remounts the element being dragged, and the browser ends the drag.
 */
export function useTreeDrag(onDrop, { inside = () => true, sibling = () => true } = {}) {
  const [over, setOver] = useState(null);
  const drag = useRef(null);
  const [dragging, setDragging] = useState(null);
  const zoneOf = (e, item) => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / Math.max(r.height, 1);
    const d = drag.current;
    const canIn = d && inside(d, item), canSib = d && sibling(d, item);
    if (canSib && y < 0.28) return "before";
    if (canSib && y > 0.72) return "after";
    return canIn ? "inside" : canSib ? (y < 0.5 ? "before" : "after") : null;
  };
  const source = (item) => ({
    draggable: true,
    onDragStart: (e) => { e.stopPropagation(); drag.current = item; setDragging(item.id); e.dataTransfer.setData("text/plain", item.id); e.dataTransfer.effectAllowed = "move"; },
    onDragEnd: () => { drag.current = null; setDragging(null); setOver(null); },
  });
  const target = (item) => ({
    onDragOver: (e) => {
      const d = drag.current;
      if (!d || d.id === item.id) return;
      const z = zoneOf(e, item);
      if (!z) return;
      e.preventDefault();
      if (over?.id !== item.id || over?.zone !== z) setOver({ id: item.id, zone: z });
    },
    onDragLeave: () => setOver((o) => (o?.id === item.id ? null : o)),
    onDrop: (e) => {
      e.preventDefault();
      const d = drag.current, z = zoneOf(e, item);
      drag.current = null; setDragging(null); setOver(null);
      if (d && z && d.id !== item.id) onDrop(d, item, z);
    },
  });
  const look = (item) => (over?.id !== item.id ? (dragging === item.id ? { opacity: 0.5 } : {})
    : over.zone === "inside" ? { outline: "2px dashed var(--cy, #1b7f99)", outlineOffset: -2 }
      : { boxShadow: `inset 0 ${over.zone === "before" ? 3 : -3}px 0 var(--cy, #1b7f99)` });
  return { source, target, look, dragging };
}
