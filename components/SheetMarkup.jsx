"use client";
import { useEffect, useRef, useState } from "react";
import { KINDS, KIND_IDS, addMark, updateMark, removeMark, problems } from "../lib/sheet/markup.mjs";
import Shape, { COLOR } from "./MarkShape";

/**
 * The isometric sheet itself, marked: a circle on a shop weld, a square on a
 * site weld, an oval on a spool number, a hexagon on a support number (a
 * dashed circle where Shop/Field is not known). What the model read starts
 * the marks off; every one of them can be moved by dragging, renumbered,
 * retyped, deleted, and new ones put where the sheet is clicked.
 *
 *   items     [{ id, kind, no, x, y, src }]  — x, y fractions of the sheet (lib/sheet/markup.mjs)
 *   onChange  (items) — called with the new list after every edit
 *   unplaced  [{ kind, no }] welds and spools the register has that the sheet does not yet show;
 *             one is picked, then put where the sheet is clicked
 *   readOnly  look only
 *
 * Nothing here decides Shop or Field: a mark's kind is what the project's
 * symbols, the engine's register or the person said.
 */
/** The sheet with its marks burnt in, as a PNG at the sheet's own resolution. */
export async function renderMarkedPng(src, items) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("تصویر نقشه باز نشد")); i.src = src; });
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const g = cv.getContext("2d");
  g.drawImage(img, 0, 0);
  const s = cv.width / 1500;
  // the leaders first, so each frame sits over the end of its own
  g.strokeStyle = "#111"; g.lineWidth = 1.4 * s;
  for (const m of items) {
    if (m.ax == null || m.ay == null) continue;
    g.beginPath(); g.moveTo(m.ax * cv.width, m.ay * cv.height); g.lineTo(m.x * cv.width, m.y * cv.height); g.stroke();
    g.beginPath(); g.arc(m.ax * cv.width, m.ay * cv.height, 2.6 * s, 0, Math.PI * 2); g.fillStyle = "#111"; g.fill();
  }
  for (const m of items) {
    const cx = m.x * cv.width, cy = m.y * cv.height, c = COLOR[m.kind], shape = KINDS[m.kind].shape;
    g.save(); g.translate(cx, cy); g.scale(s, s);
    g.lineWidth = 1.6; g.strokeStyle = c; g.fillStyle = "rgba(255,255,255,.95)";
    g.setLineDash(shape === "circle-dashed" ? [4, 3] : []);
    g.beginPath();
    if (shape === "circle" || shape === "circle-dashed") g.arc(0, 0, 13, 0, Math.PI * 2);
    else if (shape === "square") g.rect(-13, -13, 26, 26);
    else if (shape === "oval") g.ellipse(0, 0, 18, 12, 0, 0, Math.PI * 2);
    else { g.moveTo(-10, -12); g.lineTo(10, -12); g.lineTo(18, 0); g.lineTo(10, 12); g.lineTo(-10, 12); g.lineTo(-18, 0); g.closePath(); }
    g.fill(); g.stroke();
    g.setLineDash([]); g.fillStyle = "#111"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `700 ${String(m.no).length > 4 ? 7.5 : String(m.no).length > 3 ? 9 : String(m.no).length > 2 ? 10.5 : 12.5}px system-ui,sans-serif`;
    g.fillText(String(m.no), 0, 1);
    g.restore();
  }
  return cv.toDataURL("image/png");
}

export default function SheetMarkup({ src, items = [], onChange, unplaced = [], readOnly = false, height = 680, fileName = "iso-marked", onSeedEngine = null }) {
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [tool, setTool] = useState(null);     // a kind, to be put where the sheet is next clicked
  const [armed, setArmed] = useState(null);   // { kind, no } picked from `unplaced`
  const [drag, setDrag] = useState(null);
  const [busy, setBusy] = useState("");
  const sheet = useRef(null);
  const selected = items.find((m) => m.id === selectedId) || null;
  const issues = problems(items);

  const at = (e) => {
    const r = sheet.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const commit = (next) => onChange?.(next);

  function onSheetClick(e) {
    if (drag?.moved) return;
    if (readOnly || e.target.closest("[data-mark-id],[data-anchor-id]")) return;
    const p = at(e);
    const what = armed || (tool ? { kind: tool, no: "" } : null);
    if (!what) { setSelectedId(null); return; }
    const next = addMark(items, { ...what, ...p });
    commit(next);
    setSelectedId(next[next.length - 1].id);
    setArmed(null); setTool(null);
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
  function remove() { if (selected) { commit(removeMark(items, selected.id)); setSelectedId(null); } }

  useEffect(() => {
    const h = (e) => {
      if (readOnly || !selectedId || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); commit(removeMark(items, selectedId)); setSelectedId(null); }
      if (e.key === "Escape") { setSelectedId(null); setTool(null); setArmed(null); }
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
          <span className="muted sm">افزودن با کلیک روی نقشه:</span>
          {KIND_IDS.filter((k) => k !== "weld-unknown").map((k) => (
            <button key={k} type="button" data-tool={k} className={tool === k ? "on" : "ghost"} onClick={() => { setTool(tool === k ? null : k); setArmed(null); }}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Shape kind={k} no="" size={0.5} />{KINDS[k].label}
            </button>
          ))}
        </div>
      )}
      <p className="muted sm" data-hint>
        {readOnly ? "نقشه با نشان‌ها — فقط دیدن."
          : armed ? `«${armed.no}» انتخاب شد — روی محلش در نقشه کلیک کنید.`
          : tool ? `${KINDS[tool].label}: روی محلش در نقشه کلیک کنید.`
          : "نشان را بکشید تا جابه‌جا شود؛ با کلیک انتخابش کنید تا شماره یا نوعش را عوض کنید یا پاکش کنید (Delete). نقطهٔ زرد سر خط، محل سرجوش روی لوله است و آن هم کشیدنی است."}
      </p>
      <p className="mono sm" data-counts>
        سرجوش‌ها {count("weld")} · اسپول‌ها {count("spool")} · ساپورت‌ها {count("support")}
        {items.some((m) => m.src === "model" || m.src === "engine") && " · محل نشان‌های خودکار تقریبی است (سرجوش‌ها را موتور تعیین کرده، جایشان روی نقشه را مدل)، با نقشه بسنجید"}
      </p>
      {issues.map((x) => <p key={x} className="err sm" data-problem>{x}</p>)}

      {selected && !readOnly && (
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", margin: "6px 0" }} data-inspector>
          <label className="sm">شماره <input data-edit-no className="mono" style={{ width: 90 }} value={selected.no}
            onChange={(e) => commit(updateMark(items, selected.id, { no: e.target.value }))} /></label>
          <label className="sm">نوع <select data-edit-kind value={selected.kind} onChange={(e) => commit(updateMark(items, selected.id, { kind: e.target.value }))}>
            {KIND_IDS.map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
          </select></label>
          <span className="muted sm">{selected.src === "model" ? "پیشنهاد مدل" : selected.src === "engine" ? "سرجوش موتور، محل از مدل" : "دستی"}</span>
          <button type="button" className="ghost sm" data-delete onClick={remove}>حذف</button>
        </div>
      )}

      {!readOnly && unplaced.length > 0 && (
        <details className="sm" data-unplaced style={{ margin: "6px 0" }}>
          <summary>{unplaced.length} مورد از رجیستر هنوز روی نقشه نیست — یکی را بردارید و روی محلش کلیک کنید</summary>
          <div className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: 4 }}>
            {unplaced.map((u) => (
              <button key={`${u.kind}|${u.no}`} type="button" data-unplaced-item={u.no} className={armed?.no === u.no && armed?.kind === u.kind ? "on" : "ghost"}
                onClick={() => { setArmed(armed?.no === u.no && armed?.kind === u.kind ? null : u); setTool(null); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "0 4px" }}>
                <Shape kind={u.kind} no="" size={0.45} />{u.no}
              </button>
            ))}
          </div>
        </details>
      )}
      {busy && <p className="muted sm">{busy}</p>}

      <div className="sheet-box" style={{ height, overflow: "auto", position: "relative", background: "#fff" }} onPointerMove={move} onPointerUp={up}>
        <div ref={sheet} data-sheet style={{ position: "relative", width: `${zoom * 100}%`, cursor: (tool || armed) ? "crosshair" : "default" }} onClick={onSheetClick}>
          {src
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={src} alt="نقشه ایزومتریک" draggable={false} style={{ display: "block", width: "100%", userSelect: "none" }} />
            : <div className="muted" style={{ padding: 40 }}>تصویر نقشه در دسترس نیست.</div>}
          {/* each leader from its weld point on the pipe to its frame; the frame drawn over its end */}
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" data-leaders
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
            {items.filter((m) => m.ax != null && m.ay != null).map((m) => {
              const f = drag?.id === m.id && drag.p && drag.part !== "anchor" ? drag.p : m;
              const a = drag?.id === m.id && drag.p && drag.part === "anchor" ? { ax: drag.p.x, ay: drag.p.y } : m;
              return <line key={m.id} data-leader={m.id} x1={a.ax} y1={a.ay} x2={f.x} y2={f.y} stroke="#111" strokeWidth={m.id === selectedId ? 2.2 : 1.3} vectorEffect="non-scaling-stroke" />;
            })}
          </svg>
          {items.filter((m) => m.ax != null && m.ay != null).map((m) => {
            const a = drag?.id === m.id && drag.p && drag.part === "anchor" ? { ax: drag.p.x, ay: drag.p.y } : m;
            const on = m.id === selectedId;
            return (
              <div key={`a${m.id}`} data-anchor-id={m.id} title={on && !readOnly ? "محل سرجوش روی لوله — بکشید تا جابه‌جا شود" : undefined}
                onPointerDown={on && !readOnly ? (e) => down(e, m, "anchor") : undefined}
                style={{ position: "absolute", left: `${a.ax * 100}%`, top: `${a.ay * 100}%`, transform: "translate(-50%,-50%)",
                  width: on ? 12 : 6, height: on ? 12 : 6, borderRadius: "50%", background: on ? "#ffd400" : "#111",
                  border: on ? "2px solid #111" : 0, cursor: on && !readOnly ? "grab" : "default", touchAction: "none",
                  pointerEvents: on && !readOnly ? "auto" : "none" }} />);
          })}
          {items.map((m) => {
            const p = drag?.id === m.id && drag.p && drag.part !== "anchor" ? drag.p : m;
            return (
              <div key={m.id} data-mark-id={m.id} data-kind={m.kind} data-shape={KINDS[m.kind].shape} data-no={m.no} data-src={m.src}
                title={`${KINDS[m.kind].label} ${m.no}${m.src === "model" ? " (پیشنهاد مدل)" : ""}`}
                onPointerDown={(e) => down(e, m)}
                style={{ position: "absolute", left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: "translate(-50%,-50%)",
                  cursor: readOnly ? "default" : "grab", touchAction: "none" }}>
                <Shape kind={m.kind} no={m.no} on={m.id === selectedId} />
              </div>);
          })}
        </div>
      </div>
    </div>
  );
}
