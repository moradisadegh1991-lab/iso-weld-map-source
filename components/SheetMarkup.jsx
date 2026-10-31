"use client";
import { useEffect, useRef, useState } from "react";
import { KINDS, KIND_IDS, SHEET_SIZE, addMark, updateMark, placeAt, isPlaced, notOnSheet } from "../lib/sheet/markup.mjs";
import Shape, { COLOR, geometryOf } from "./MarkShape";

/**
 * The isometric sheet itself, marked: a circle on a shop weld, a square on a
 * site weld, an oval on a spool number, a hexagon on a support number (a
 * dashed circle where Shop/Field is not known). What the model read starts
 * the marks off; every one of them can be moved by dragging, renumbered,
 * retyped, deleted, and new ones put where the sheet is clicked.
 *
 *   items     [{ id, kind, no, x, y, src }]  — x, y fractions of the sheet (lib/sheet/markup.mjs)
 *   onChange  (items) — called with the new list after every edit
 *   selectedId, onSelect, attachId, onAttach  the picked mark and the row waiting for its weld point,
 *             held by the page so its table and this sheet pick and join the same mark
 *   readOnly  look only
 *
 * Nothing here decides Shop or Field: a mark's kind is what the project's
 * symbols, the engine's register or the person said.
 */
/** The sheet with its marks burnt in, as a PNG at the sheet's own resolution, each mark at the example sheet's size. */
export async function renderMarkedPng(src, items) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("تصویر نقشه باز نشد")); i.src = src; });
  const cv = document.createElement("canvas");
  const W = cv.width = img.naturalWidth, H = cv.height = img.naturalHeight;
  const g = cv.getContext("2d");
  g.drawImage(img, 0, 0);
  // the leaders first, thin as the drawing's own, so each frame sits over the end of its own
  g.strokeStyle = "#111"; g.lineWidth = Math.max(1, SHEET_SIZE.leader * W);
  for (const m of items) {
    if (m.ax == null || m.ay == null) continue;
    g.beginPath(); g.moveTo(m.ax * W, m.ay * H); g.lineTo(m.x * W, m.y * H); g.stroke();
  }
  for (const m of items) {
    const geo = geometryOf(m.kind), [vw, vh] = geo.vb, k = (geo.box * W) / vw, shape = KINDS[m.kind].shape;
    g.save(); g.translate(m.x * W - (vw * k) / 2, m.y * H - (vh * k) / 2); g.scale(k, k);
    g.lineWidth = geo.stroke; g.strokeStyle = COLOR[m.kind]; g.fillStyle = "rgba(255,255,255,.95)";
    g.setLineDash(shape === "circle-dashed" ? [3, 2.4] : []);
    g.beginPath();
    if (shape === "circle" || shape === "circle-dashed") g.arc(vw / 2, vh / 2, 13, 0, Math.PI * 2);
    else if (shape === "square") g.rect(2, 2, 26, 26);
    else if (shape === "oval") g.ellipse(30, 14, 28, 12.4, 0, 0, Math.PI * 2);
    else { [[2, 18], [11, 2.4], [33, 2.4], [42, 18], [33, 33.6], [11, 33.6]].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); }
    g.fill(); g.stroke();
    g.setLineDash([]); g.fillStyle = "#111"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `700 ${geo.font}px "Times New Roman",Times,serif`;
    const label = String(m.no), wide = g.measureText(label).width;
    if (wide > geo.fit) { g.translate(vw / 2, vh / 2); g.scale(geo.fit / wide, 1); g.fillText(label, 0, 0.5); }
    else g.fillText(label, vw / 2, vh / 2 + 0.5);
    g.restore();
  }
  return cv.toDataURL("image/png");
}

export default function SheetMarkup({ src, items = [], onChange, readOnly = false, height = 680, fileName = "iso-marked", onSeedEngine = null,
  selectedId: selectedProp, onSelect, attachId: attachProp, onAttach }) {
  const [zoom, setZoom] = useState(1);
  // the picked mark and the mark waiting for its weld point may be held by the page, whose table picks the same mark
  const [selectedOwn, setSelectedOwn] = useState(null);
  const [attachOwn, setAttachOwn] = useState(null);
  const selectedId = onSelect ? selectedProp : selectedOwn, setSelectedId = onSelect || setSelectedOwn;
  const pointFor = onAttach ? attachProp : attachOwn, setPointFor = onAttach || setAttachOwn;
  const [tool, setTool] = useState(null);     // a kind, to be put where the sheet is next clicked
  const [drag, setDrag] = useState(null);
  const [busy, setBusy] = useState("");
  const [aspect, setAspect] = useState(Math.SQRT2);   // the sheet's width / height, once its image is loaded
  const sheet = useRef(null);
  const placedItems = items.filter(isPlaced);
  const loose = notOnSheet(items);

  const at = (e) => {
    const r = sheet.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const commit = (next) => onChange?.(next);

  function onSheetClick(e) {
    if (drag?.moved) return;
    if (readOnly || e.target.closest("[data-mark-id],[data-anchor-id]")) return;
    const p = at(e);
    // a row of the table waiting for its weld point: the leader ends here, the frame is set beside it
    if (pointFor) {
      commit(placeAt(items, pointFor, p, aspect));
      setPointFor(null);
      return;
    }
    // a new mark by the tool: its weld point is the click, with its leader and frame, like any other
    if (tool) {
      const next = addMark(items, { kind: tool });
      const id = next[next.length - 1].id;
      commit(placeAt(next, id, p, aspect));
      setSelectedId(id);
      setTool(null);
      return;
    }
    setSelectedId(null);
  }
  function down(e, m, part = "frame") {
    e.stopPropagation();
    setSelectedId(m.id);
    if (readOnly) return;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* a synthetic pointer: the drag still follows the sheet */ }
    setDrag({ id: m.id, part, moved: false });
  }
  function move(e) { if (drag) setDrag({ ...drag, moved: true, p: at(e) }); }
  function up() {
    if (drag?.moved && drag.p) commit(updateMark(items, drag.id, drag.part === "anchor" ? { ax: drag.p.x, ay: drag.p.y } : drag.p));
    setTimeout(() => setDrag(null), 0);
  }

  useEffect(() => {
    const h = (e) => {
      if (readOnly || !selectedId || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) return;
      if (e.key === "Escape") { setSelectedId(null); setTool(null); setPointFor(null); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  async function download() {
    setBusy("در حال ساخت تصویر…");
    try {
      const url = await renderMarkedPng(src, items);
      const a = document.createElement("a"); a.href = url; a.download = `${fileName}.png`; a.click();
    } catch (e) { setBusy(e.message); return; }
    setBusy("");
  }

  const count = (cls) => items.filter((m) => KINDS[m.kind].cls === cls).length;
  return (
    <div className="sheet-markup" data-sheet-markup>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="ghost sm" onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))} aria-label="zoom out">−</button>
        <span className="mono sm" data-zoom>{Math.round(zoom * 100)}%</span>
        <button type="button" className="ghost sm" onClick={() => setZoom((z) => Math.min(6, z * 1.25))} aria-label="zoom in">+</button>
        <button type="button" className="ghost sm" onClick={() => setZoom(1)}>⤢</button>
        <span className="grow" />
        {onSeedEngine && !readOnly && (
          <button type="button" className="ghost sm" data-seed-engine disabled={!src}
            onClick={() => { const im = sheet.current?.querySelector("img"); onSeedEngine(im?.naturalWidth && im?.naturalHeight ? im.naturalWidth / im.naturalHeight : Math.SQRT2); }}>
            سرجوش‌های موتور روی نقشه
          </button>)}
        <button type="button" className="ghost sm" data-download onClick={download} disabled={!src}>دانلود نقشهٔ نشان‌دار (PNG)</button>
      </div>
      {!readOnly && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }} data-tools>
          <span className="muted sm">افزودن مستقیم روی نقشه:</span>
          {KIND_IDS.filter((k) => k !== "weld-unknown").map((k) => (
            <button key={k} type="button" data-tool={k} className={tool === k ? "on" : "ghost"} onClick={() => { setTool(tool === k ? null : k); setPointFor(null); }}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Shape kind={k} no="" size={0.5} />{KINDS[k].label}
            </button>
          ))}
        </div>
      )}
      <p className="muted sm" data-hint>
        {readOnly ? "نقشه با نشان‌ها — فقط دیدن."
          : pointFor ? "روی نقشه، محل سرجوش (روی خود لوله) را کلیک کنید تا خط راهنما از آن‌جا به شماره‌اش وصل شود."
          : tool ? `${KINDS[tool].label}: محل آن را روی لوله کلیک کنید.`
          : "قاب را بکشید تا جابه‌جا شود؛ نقطهٔ اتصال هر نشان با کشیدن سر خطِ نشان انتخاب‌شده عوض می‌شود. شماره، جزئیات، اتصال به نقشه و حذف در جدول سمت چپ/زیر نقشه است."}
      </p>
      <p className="mono sm" data-counts>
        سرجوش‌ها {count("weld")} · اسپول‌ها {count("spool")} · ساپورت‌ها {count("support")}
        {loose.length > 0 && ` · ${loose.length} ردیف به نقشه وصل نیست`}
        {items.some((m) => m.src === "model" || m.src === "engine") && " · محل نشان‌های خودکار تقریبی است (سرجوش‌ها را موتور تعیین کرده، جایشان روی نقشه را مدل)، با نقشه بسنجید"}
      </p>
      {busy && <p className="muted sm">{busy}</p>}

      <div className="sheet-box" style={{ height, overflow: "auto", position: "relative", background: "#fff" }} onPointerMove={move} onPointerUp={up}>
        <div ref={sheet} data-sheet style={{ position: "relative", width: `${zoom * 100}%`, cursor: (tool || pointFor) ? "crosshair" : "default" }} onClick={onSheetClick}>
          {src
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={src} alt="نقشه ایزومتریک" draggable={false} style={{ display: "block", width: "100%", userSelect: "none" }}
                onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setAspect(i.naturalWidth / i.naturalHeight); }} />
            : <div className="muted" style={{ padding: 40 }}>تصویر نقشه در دسترس نیست.</div>}
          {/* each leader from its weld point on the pipe to its frame; the frame drawn over its end */}
          <svg viewBox={`0 0 1000 ${1000 / aspect}`} data-leaders
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
            {placedItems.filter((m) => m.ax != null && m.ay != null).map((m) => {
              const f = drag?.id === m.id && drag.p && drag.part !== "anchor" ? drag.p : m;
              const a = drag?.id === m.id && drag.p && drag.part === "anchor" ? { ax: drag.p.x, ay: drag.p.y } : m;
              const k = 1000 / aspect;
              // as thin as the drawing's own leaders, and no blob at the weld point to cover the drawing
              return <line key={m.id} data-leader={m.id} data-ax={a.ax} data-ay={a.ay} data-fx={f.x} data-fy={f.y}
                x1={a.ax * 1000} y1={a.ay * k} x2={f.x * 1000} y2={f.y * k}
                stroke={m.id === selectedId ? "#b8860b" : "#111"} strokeWidth={SHEET_SIZE.leader * 1000 * (m.id === selectedId ? 2 : 1)} />;
            })}
          </svg>
          {placedItems.filter((m) => m.ax != null && m.ay != null).map((m) => {
            const a = drag?.id === m.id && drag.p && drag.part === "anchor" ? { ax: drag.p.x, ay: drag.p.y } : m;
            const on = m.id === selectedId;
            return (
              <div key={`a${m.id}`} data-anchor-id={m.id} title={on && !readOnly ? "محل سرجوش روی لوله — بکشید تا جابه‌جا شود" : undefined}
                onPointerDown={on && !readOnly ? (e) => down(e, m, "anchor") : undefined}
                style={{ position: "absolute", left: `${a.ax * 100}%`, top: `${a.ay * 100}%`, transform: "translate(-50%,-50%)",
                  width: 12, height: 12, borderRadius: "50%", background: "transparent",
                  border: on ? "2px solid #b8860b" : 0, cursor: on && !readOnly ? "grab" : "default", touchAction: "none",
                  pointerEvents: on && !readOnly ? "auto" : "none" }} />);
          })}
          {placedItems.map((m) => {
            const p = drag?.id === m.id && drag.p && drag.part !== "anchor" ? drag.p : m;
            return (
              <div key={m.id} data-mark-id={m.id} data-kind={m.kind} data-shape={KINDS[m.kind].shape} data-no={m.no} data-src={m.src}
                title={`${KINDS[m.kind].label} ${m.no}${m.src === "model" ? " (پیشنهاد مدل)" : ""}`}
                onPointerDown={(e) => down(e, m)}
                style={{ position: "absolute", left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: "translate(-50%,-50%)",
                  width: `${geometryOf(m.kind).box * 100}%`, aspectRatio: `${geometryOf(m.kind).vb[0]} / ${geometryOf(m.kind).vb[1]}`,
                  cursor: readOnly ? "default" : "grab", touchAction: "none" }}>
                <Shape kind={m.kind} no={m.no} on={m.id === selectedId} fluid />
              </div>);
          })}
        </div>
      </div>
    </div>
  );
}
