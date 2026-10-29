"use client";
import { useEffect, useRef, useState } from "react";
import MarkShape from "./MarkShape";
import { KINDS, addMark, updateMark, removeMark } from "../lib/sheet/markup.mjs";

/**
 * The drawing beside its weld list: the sheet as an image, a marker on it
 * for each weld whose place is known, and the row and the marker kept
 * together — picking one picks the other.
 *
 *   marks     { [weldNo]: { x, y, src } }, x and y fractions of the sheet;
 *             `src` "reader" (read off the sheet with no model,
 *             tools/iso-read.py) or "hand" (put there by a person)
 *   states    { [weldNo]: "done" | "inspection" | "open" | "checked" | "unchecked" },
 *             the colour of each marker
 *   onPlace   (no, {x, y}) — when set, a picked weld is put where the sheet is
 *             clicked, and a marker can be dragged; without it the sheet is
 *             only looked at
 *
 *   kinds     { [weldNo]: "weld-shop" | "weld-field" | "weld-unknown" } — when given, a weld is drawn
 *             in its shape (circle shop, square site, dashed circle unknown) painted in its state's colour
 *   extras    [{ id, kind: "spool"|"support", no, x, y }] — the spool numbers (oval) and support numbers
 *             (hexagon) marked on the sheet; with `onExtras` a person adds, moves, renumbers and deletes them
 *
 * Nothing here decides anything about a weld: the place is where a person
 * or the reader saw its number; the colour is a state given from outside,
 * and Shop/Field is the register's.
 */
export const STATE_COLORS = {
  done: "#2e9d5b", inspection: "#d39b18", open: "#d2453a",
  checked: "#2e9d5b", unchecked: "#5b8def",
};

export default function SheetReview({ src, marks = {}, states = {}, legend = [], selected = null, onSelect, onPlace, height = 640, kinds = null, extras = null, onExtras }) {
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState(null);
  const [tool, setTool] = useState(null);       // "spool" | "support": put where the sheet is next clicked
  const [extraId, setExtraId] = useState(null); // the spool or support mark picked
  const editExtras = Boolean(extras && onExtras);
  const extra = extras?.find((m) => m.id === extraId) || null;
  const box = useRef(null);
  const sheet = useRef(null);

  // a weld picked in the list is brought into view on the sheet
  useEffect(() => {
    const m = selected && marks[selected];
    const b = box.current, s = sheet.current;
    if (!m || !b || !s) return;
    const x = m.x * s.clientWidth - b.clientWidth / 2, y = m.y * s.clientHeight - b.clientHeight / 2;
    b.scrollTo({ left: Math.max(0, x), top: Math.max(0, y), behavior: "smooth" });
  }, [selected, marks, zoom]);

  const at = (e) => {
    const r = sheet.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const round = (p) => ({ x: Math.round(p.x * 10000) / 10000, y: Math.round(p.y * 10000) / 10000 });

  function onSheetClick(e) {
    if (drag?.moved) return;
    if (editExtras && tool && !e.target.closest("[data-mark],[data-extra]")) {
      const next = addMark(extras, { kind: tool, ...round(at(e)) });
      onExtras(next); setExtraId(next[next.length - 1].id); setTool(null);
      return;
    }
    if (editExtras && !e.target.closest("[data-mark],[data-extra]")) setExtraId(null);
    if (!onPlace || !selected || e.target.closest("[data-mark]")) return;
    onPlace(selected, round(at(e)));
  }
  function down(e, no) {
    e.stopPropagation();
    onSelect?.(no);
    if (!onPlace) return;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* no live pointer (a pen lifted, a synthetic event): the drag still follows the sheet */ }
    setDrag({ no, moved: false });
  }
  function downExtra(e, m) {
    e.stopPropagation();
    setExtraId(m.id);
    if (!editExtras) return;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* a synthetic pointer: the drag still follows the sheet */ }
    setDrag({ extra: m.id, moved: false });
  }
  function move(e) {
    if (!drag) return;
    setDrag({ ...drag, moved: true, p: at(e) });
  }
  function up() {
    if (drag?.moved && drag.p && drag.extra) onExtras(updateMark(extras, drag.extra, round(drag.p)));
    else if (drag?.moved && drag.p) onPlace(drag.no, round(drag.p));
    // the click that ends a drag is not a placement
    setTimeout(() => setDrag(null), 0);
  }

  const shown = Object.entries(marks).filter(([, m]) => m && Number.isFinite(m.x) && Number.isFinite(m.y));
  const missing = selected && !marks[selected];
  return (
    <div className="sheet-review" data-sheet-review>
      <div className="row sheet-tools" style={{ gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="ghost sm" onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))} aria-label="zoom out">−</button>
        <span className="mono sm" data-zoom>{Math.round(zoom * 100)}%</span>
        <button type="button" className="ghost sm" onClick={() => setZoom((z) => Math.min(6, z * 1.25))} aria-label="zoom in">+</button>
        <button type="button" className="ghost sm" onClick={() => setZoom(1)}>⤢</button>
        <span className="grow" />
        {legend.map(([k, label]) => <span key={k} className="sm"><i className="dot" style={{ background: STATE_COLORS[k] }} /> {label}</span>)}
      </div>
      {editExtras && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }} data-extras-tools>
          <span className="muted sm">افزودن با کلیک روی نقشه:</span>
          {["spool", "support"].map((k) => (
            <button key={k} type="button" data-extra-tool={k} className={tool === k ? "on" : "ghost"} onClick={() => setTool(tool === k ? null : k)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <MarkShape kind={k} no="" size={0.5} />{KINDS[k].label}
            </button>
          ))}
          {tool && <span className="muted sm">{KINDS[tool].label}: روی محلش در نقشه کلیک کنید.</span>}
          {extra && (<>
            <label className="sm">شماره <input data-extra-no className="mono" style={{ width: 90 }} value={extra.no}
              onChange={(e) => onExtras(updateMark(extras, extra.id, { no: e.target.value }))} /></label>
            <label className="sm">نوع <select data-extra-kind value={extra.kind} onChange={(e) => onExtras(updateMark(extras, extra.id, { kind: e.target.value }))}>
              {["spool", "support"].map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
            </select></label>
            <button type="button" className="ghost sm" data-extra-delete onClick={() => { onExtras(removeMark(extras, extra.id)); setExtraId(null); }}>حذف</button>
          </>)}
        </div>
      )}
      {onPlace && <p className="muted sm" data-place-hint>{missing
        ? `جوش ${selected} روی نقشه جا ندارد — روی محلش در نقشه کلیک کنید.`
        : selected ? `جوش ${selected}: نشانگرش را بکشید تا جابه‌جا شود، یا جای دیگری از نقشه را کلیک کنید.` : "ردیفی را انتخاب کنید، بعد روی محل جوش در نقشه کلیک کنید."}</p>}
      <div ref={box} className="sheet-box" style={{ height, overflow: "auto", position: "relative", background: "#fff" }}
        onPointerMove={move} onPointerUp={up}>
        <div ref={sheet} style={{ position: "relative", width: `${zoom * 100}%`, cursor: onPlace && selected ? "crosshair" : "default" }} onClick={onSheetClick}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="sheet" draggable={false} style={{ display: "block", width: "100%", userSelect: "none" }} />
          {shown.map(([no, m]) => {
            const p = drag?.no === no && drag.p ? drag.p : m;
            const on = selected === no;
            return (
              <button key={no} type="button" data-mark={no} data-state={states[no] || ""} data-src={m.src || ""}
                data-kind={kinds?.[no] || undefined} data-shape={kinds?.[no] ? KINDS[kinds[no]].shape : undefined}
                data-picked={on ? "true" : "false"}
                title={`${no}${m.src === "hand" ? " (دستی)" : m.src === "reader" ? " (خوانده‌شده از نقشه)" : ""}`}
                onPointerDown={(e) => down(e, no)}
                style={kinds?.[no]
                  ? { position: "absolute", left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: "translate(-50%,-50%)",
                      padding: 0, border: 0, background: "none", cursor: onPlace ? "grab" : "pointer", touchAction: "none" }
                  : { position: "absolute", left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: "translate(-50%,-50%)",
                  minWidth: 22, height: 22, padding: "0 4px", borderRadius: 11, border: on ? "3px solid #111" : "2px solid #fff",
                  background: STATE_COLORS[states[no]] || "#5b8def", color: "#fff", font: "700 11px/16px system-ui", cursor: onPlace ? "grab" : "pointer",
                  boxShadow: on ? "0 0 0 4px rgba(255,214,0,.85)" : "0 1px 3px rgba(0,0,0,.5)", opacity: 0.92, touchAction: "none" }}>
                {kinds?.[no] ? <MarkShape kind={kinds[no]} no={no} on={on} tint={STATE_COLORS[states[no]] || "#5b8def"} /> : no}
              </button>);
          })}
          {(extras || []).map((m) => {
            const p = drag?.extra === m.id && drag.p ? drag.p : m;
            return (
              <div key={m.id} data-extra={m.id} data-kind={m.kind} data-shape={KINDS[m.kind].shape} data-no={m.no} data-src={m.src}
                title={`${KINDS[m.kind].label} ${m.no}`} onPointerDown={(e) => downExtra(e, m)}
                style={{ position: "absolute", left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: "translate(-50%,-50%)",
                  cursor: editExtras ? "grab" : "default", touchAction: "none" }}>
                <MarkShape kind={m.kind} no={m.no} on={m.id === extraId} />
              </div>);
          })}
        </div>
      </div>
    </div>
  );
}
