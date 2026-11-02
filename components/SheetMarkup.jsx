"use client";
import { useEffect, useRef, useState } from "react";
import { KINDS, KIND_IDS, SHEET_SIZE, addMark, updateMark, placeAt, isPlaced, notOnSheet, plainNo, duplicateMark, removeMark, dependents } from "../lib/sheet/markup.mjs";
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
 *   states    { [id]: { state, color } } — a mark painted in its state's colour (where its joint
 *             stands on site); without it every mark is black, as the designer draws them
 *   legend    [[color, label]] for those colours
 *   onEdit    (id) — open the mark's row for editing (the page shows its table); without it, the mark is picked
 *
 * A right click (or the menu key, or Shift+F10, on a mark in focus) opens the
 * sheet's menu: on a mark — its properties, edit, a copy with everything it
 * records, move (the next click on the sheet is its new weld point; Escape
 * cancels), delete (what else names it said first); on the empty sheet — a
 * weld, spool or support put where it was clicked.
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
    const label = KINDS[m.kind].cls === "weld" ? plainNo(m.no) : String(m.no), wide = g.measureText(label).width;
    if (wide > geo.fit) { g.translate(vw / 2, vh / 2); g.scale(geo.fit / wide, 1); g.fillText(label, 0, 0.5); }
    else g.fillText(label, vw / 2, vh / 2 + 0.5);
    g.restore();
  }
  return cv.toDataURL("image/png");
}

export default function SheetMarkup({ src, items = [], onChange, readOnly = false, height = 680, fileName = "iso-marked", onSeedEngine = null,
  selectedId: selectedProp, onSelect, attachId: attachProp, onAttach, states = null, legend = [], onEdit = null }) {
  const [zoom, setZoom] = useState(1);
  // the picked mark and the mark waiting for its weld point may be held by the page, whose table picks the same mark
  const [selectedOwn, setSelectedOwn] = useState(null);
  const [attachOwn, setAttachOwn] = useState(null);
  const selectedId = onSelect ? selectedProp : selectedOwn, setSelectedId = onSelect || setSelectedOwn;
  const pointFor = onAttach ? attachProp : attachOwn, setPointFor = onAttach || setAttachOwn;
  const [tool, setTool] = useState(null);     // a kind, to be put where the sheet is next clicked
  const [drag, setDrag] = useState(null);
  const [busy, setBusy] = useState("");
  const [menu, setMenu] = useState(null);     // the right-click menu: { x, y (viewport px), id (a mark) | p (a sheet point) }
  const menuRef = useRef(null);
  const [aspect, setAspect] = useState(Math.SQRT2);   // the sheet's width / height, once its image is loaded
  const sheet = useRef(null);
  const box = useRef(null);
  // which kinds of mark (and the leaders) are drawn: a view setting only, nothing in `items` changes
  const [hidden, setHidden] = useState(() => new Set());
  const [panning, setPanning] = useState(false);
  const pan = useRef(null);          // a drag of the empty sheet: where it started and the scroll then
  const panned = useRef(false);      // that drag moved: the click that ends it is not a click on the sheet
  const pickedHere = useRef(false);  // the mark was picked on this sheet (already in view): no need to scroll to it
  const zoomAt = useRef(null);       // the point under the pointer while zooming with it, to keep it there
  const layerOf = (m) => KINDS[m.kind].cls;
  const placedItems = items.filter(isPlaced);
  const shown = placedItems.filter((m) => !hidden.has(layerOf(m)));
  const loose = notOnSheet(items);
  const toggleLayer = (k) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const at = (e) => {
    const r = sheet.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const commit = (next) => onChange?.(next);

  function onSheetClick(e) {
    if (panned.current) { panned.current = false; return; }
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
    pickedHere.current = true;
    setSelectedId(m.id);
    // a right (or middle) button picks the mark only: its menu opens, nothing is dragged
    if (readOnly || (e.pointerType === "mouse" && e.button !== 0)) return;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* a synthetic pointer: the drag still follows the sheet */ }
    setDrag({ id: m.id, part, moved: false });
  }
  function move(e) {
    if (pan.current) {
      const dx = e.clientX - pan.current.x, dy = e.clientY - pan.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) panned.current = true;
      box.current.scrollLeft = pan.current.left - dx;
      box.current.scrollTop = pan.current.top - dy;
      return;
    }
    if (drag) setDrag({ ...drag, moved: true, p: at(e) });
  }
  function up(e) {
    if (pan.current) { pan.current = null; setPanning(false); try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* not captured */ } return; }
    if (drag?.moved && drag.p) commit(updateMark(items, drag.id, drag.part === "anchor" ? { ax: drag.p.x, ay: drag.p.y } : drag.p));
    setTimeout(() => setDrag(null), 0);
  }
  // dragging the empty sheet moves it (a mouse or a pen; a finger already scrolls the box); not while a mark is
  // being put or joined, when the click is the point
  // ── the right-click menu ──────────────────────────────────────────────
  function openMenu(e) {
    const el = e.target.closest?.("[data-mark-id]");
    const id = el?.getAttribute("data-mark-id") || null;
    if (!id && (readOnly || !sheet.current)) return;      // look-only: no menu on the empty sheet (the browser's own stays)
    e.preventDefault();
    e.stopPropagation();
    if (id) { pickedHere.current = true; setSelectedId(id); }
    setMenu({ x: e.clientX, y: e.clientY, id, p: id ? null : at(e) });
  }
  const closeMenu = () => setMenu(null);
  const view = (id) => {
    setSelectedId(id);
    // the workspace's inspector, when this sheet is in one: opened and brought into view
    const insp = document.querySelector("[data-ws-inspector]");
    if (insp) { insp.open = true; insp.scrollIntoView({ block: "nearest" }); }
  };
  const edit = (id) => { setSelectedId(id); onEdit?.(id); };
  function duplicate(id) {
    const { items: next, id: nid } = duplicateMark(items, id, aspect);
    if (!nid) return;
    commit(next);
    setSelectedId(nid);
  }
  function remove(id) {
    const m = items.find((x) => x.id === id);
    if (!m) return;
    const deps = dependents(items, id);
    const ask = `${KINDS[m.kind].label} ${m.no || ""} حذف شود؟` +
      (deps.length ? `\n\nاین‌ها هنوز به آن ارجاع می‌دهند و همان‌طور می‌مانند (بعد از حذف در قاعده‌ها دیده می‌شوند):\n– ${deps.slice(0, 12).join("\n– ")}${deps.length > 12 ? "\n…" : ""}` : "");
    if (!window.confirm(ask)) return;
    if (pointFor === id) setPointFor(null);
    if (selectedId === id) setSelectedId(null);
    commit(removeMark(items, id));
  }
  function addHere(kind, p) {
    const next = addMark(items, { kind });
    const id = next[next.length - 1].id;
    commit(placeAt(next, id, p, aspect));
    setSelectedId(id);
    onEdit?.(id);
  }
  const menuItems = !menu ? [] : menu.id ? [
    { k: "view", label: "مشاهدهٔ مشخصات", icon: "ⓘ", run: () => view(menu.id) },
    ...(readOnly ? [] : [
      { k: "edit", label: "ویرایش مشخصات", icon: "✎", run: () => edit(menu.id) },
      { k: "duplicate", label: "کپی با همهٔ مشخصات", icon: "⧉", run: () => duplicate(menu.id) },
      { k: "move", label: "جابه‌جایی روی نقشه", icon: "✥", run: () => { setTool(null); setSelectedId(menu.id); setPointFor(menu.id); } },
      { k: "delete", label: "حذف…", icon: "✕", danger: true, run: () => remove(menu.id) },
    ]),
  ] : [
    ...KIND_IDS.filter((k) => k !== "weld-unknown").map((k) => ({ k: `add-${k}`, label: `افزودن ${KINDS[k].label} همین‌جا`, kind: k, run: () => addHere(k, menu.p) })),
  ];
  // the menu stays inside the window, opens toward the space there is, and takes the keys while open
  useEffect(() => {
    if (!menu) return undefined;
    const el = menuRef.current;
    if (el) {
      const r = el.getBoundingClientRect(), pad = 6;
      const x = Math.max(pad, Math.min(menu.x, window.innerWidth - r.width - pad));
      const y = Math.max(pad, Math.min(menu.y, window.innerHeight - r.height - pad));
      el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.visibility = "visible";
      el.querySelector("[role=menuitem]")?.focus();
    }
    const out = (e) => { if (!menuRef.current?.contains(e.target)) closeMenu(); };
    const key = (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeMenu(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
      const els = [...(menuRef.current?.querySelectorAll("[role=menuitem]") || [])];
      const i = els.indexOf(document.activeElement);
      const to = e.key === "Home" ? 0 : e.key === "End" ? els.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length;
      e.preventDefault(); els[to]?.focus();
    };
    const gone = () => closeMenu();
    window.addEventListener("pointerdown", out, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", gone);
    box.current?.addEventListener("scroll", gone);
    const b = box.current;
    return () => { window.removeEventListener("pointerdown", out, true); window.removeEventListener("keydown", key, true); window.removeEventListener("resize", gone); b?.removeEventListener("scroll", gone); };
  }, [menu]);

  function startPan(e) {
    if (e.button !== 0 || e.pointerType === "touch" || tool || pointFor) return;
    if (e.target.closest("[data-mark-id],[data-anchor-id]")) return;
    pan.current = { x: e.clientX, y: e.clientY, left: box.current.scrollLeft, top: box.current.scrollTop };
    panned.current = false;
    setPanning(true);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* a synthetic pointer */ }
  }

  // a mark picked elsewhere (the table, the explorer) is brought into view; one picked here already is
  useEffect(() => {
    if (pickedHere.current) { pickedHere.current = false; return; }
    if (!selectedId || !box.current) return;
    const el = box.current.querySelector(`[data-mark-id="${CSS.escape(String(selectedId))}"]`);
    if (!el) return;
    const b = box.current.getBoundingClientRect(), r = el.getBoundingClientRect(), pad = 40;
    if (r.left < b.left + pad || r.right > b.right - pad) box.current.scrollLeft += (r.left + r.width / 2) - (b.left + b.width / 2);
    if (r.top < b.top + pad || r.bottom > b.bottom - pad) box.current.scrollTop += (r.top + r.height / 2) - (b.top + b.height / 2);
  }, [selectedId]);

  // Ctrl (or Cmd) + wheel zooms about the pointer; the plain wheel still scrolls. A native listener: React's is passive.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const h = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt.current = { cx: e.clientX - r.left, cy: e.clientY - r.top,
        fx: (el.scrollLeft + e.clientX - r.left) / el.scrollWidth, fy: (el.scrollTop + e.clientY - r.top) / el.scrollHeight };
      setZoom((z) => Math.min(6, Math.max(0.5, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);
  useEffect(() => {
    const z = zoomAt.current, el = box.current;
    if (!z || !el) return;
    zoomAt.current = null;
    el.scrollLeft = z.fx * el.scrollWidth - z.cx;
    el.scrollTop = z.fy * el.scrollHeight - z.cy;
  }, [zoom]);

  // Arrow keys move through the marks in the order they are listed (the table's), Home and End to the first and last;
  // Enter or Space picks the one in focus. Only the picked mark (or the first) is a tab stop, so Tab crosses the sheet once.
  function markKey(e, m) {
    const ids = shown.map((x) => x.id);
    const i = ids.indexOf(m.id);
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? ids[Math.min(ids.length - 1, i + 1)]
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? ids[Math.max(0, i - 1)]
      : e.key === "Home" ? ids[0] : e.key === "End" ? ids[ids.length - 1] : null;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(m.id); return; }
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      setSelectedId(m.id);
      setMenu({ x: r.left + r.width / 2, y: r.bottom, id: m.id, p: null });
      return;
    }
    if (to == null) return;
    e.preventDefault();
    setSelectedId(to);
    requestAnimationFrame(() => box.current?.querySelector(`[data-mark-id="${CSS.escape(String(to))}"]`)?.focus());
  }

  useEffect(() => {
    const h = (e) => {
      if (readOnly || !selectedId || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) return;
      if (e.key === "Escape" && !menu) { setSelectedId(null); setTool(null); setPointFor(null); }
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
        {legend.map(([c, label]) => <span key={label} className="sm"><i className="dot" style={{ background: c }} /> {label}</span>)}
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
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }} data-layers role="group" aria-label="لایه‌های نمایش">
        <span className="muted sm">نمایش:</span>
        {[["weld", "سرجوش‌ها"], ["spool", "اسپول‌ها"], ["support", "ساپورت‌ها"], ["leader", "خط‌های راهنما"]].map(([k, label]) => (
          <button key={k} type="button" className={`ghost sm${hidden.has(k) ? "" : " on"}`} aria-pressed={!hidden.has(k)} data-layer={k}
            onClick={() => toggleLayer(k)}>{hidden.has(k) ? "پنهان: " : ""}{label}</button>))}
        {hidden.size > 0 && <span className="muted sm" data-layers-note>فقط نمای صفحه است؛ داده و دانلود PNG همهٔ نشان‌ها را دارند.</span>}
      </div>
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

      <div className="sheet-box" ref={box} data-panning={panning ? "true" : "false"} style={{ height, overflow: "auto", position: "relative", background: "#fff" }}
        onPointerDown={startPan} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div ref={sheet} data-sheet style={{ position: "relative", width: `${zoom * 100}%`, cursor: (tool || pointFor) ? "crosshair" : panning ? "grabbing" : "grab" }} onClick={onSheetClick}
          onContextMenu={openMenu}>
          {src
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={src} alt="نقشه ایزومتریک" draggable={false} style={{ display: "block", width: "100%", userSelect: "none" }}
                onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setAspect(i.naturalWidth / i.naturalHeight); }} />
            : <div className="muted" style={{ padding: 40 }}>تصویر نقشه در دسترس نیست.</div>}
          {/* each leader from its weld point on the pipe to its frame; the frame drawn over its end */}
          <svg viewBox={`0 0 1000 ${1000 / aspect}`} data-leaders hidden={hidden.has("leader")}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
            {shown.filter((m) => m.ax != null && m.ay != null).map((m) => {
              const f = drag?.id === m.id && drag.p && drag.part !== "anchor" ? drag.p : m;
              const a = drag?.id === m.id && drag.p && drag.part === "anchor" ? { ax: drag.p.x, ay: drag.p.y } : m;
              const k = 1000 / aspect;
              // as thin as the drawing's own leaders, and no blob at the weld point to cover the drawing
              return <line key={m.id} data-leader={m.id} data-ax={a.ax} data-ay={a.ay} data-fx={f.x} data-fy={f.y}
                x1={a.ax * 1000} y1={a.ay * k} x2={f.x * 1000} y2={f.y * k}
                stroke={m.id === selectedId ? "#b8860b" : "#111"} strokeWidth={SHEET_SIZE.leader * 1000 * (m.id === selectedId ? 2 : 1)} />;
            })}
          </svg>
          {shown.filter((m) => m.ax != null && m.ay != null).map((m) => {
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
          {shown.map((m, mi) => {
            const p = drag?.id === m.id && drag.p && drag.part !== "anchor" ? drag.p : m;
            const stop = selectedId != null && shown.some((x) => x.id === selectedId) ? m.id === selectedId : mi === 0;
            return (
              <div key={m.id} data-mark-id={m.id} role="button" aria-pressed={m.id === selectedId} tabIndex={stop ? 0 : -1}
                aria-label={`${KINDS[m.kind].label} ${m.no}`} onKeyDown={(e) => markKey(e, m)} data-picked={m.id === selectedId ? "true" : "false"} data-state={states?.[m.id]?.state} data-kind={m.kind} data-shape={KINDS[m.kind].shape} data-no={m.no} data-src={m.src}
                title={`${KINDS[m.kind].label} ${m.no}${m.src === "model" ? " (پیشنهاد مدل)" : ""}`}
                onPointerDown={(e) => down(e, m)}
                style={{ position: "absolute", left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: "translate(-50%,-50%)",
                  width: `${geometryOf(m.kind).box * 100}%`, aspectRatio: `${geometryOf(m.kind).vb[0]} / ${geometryOf(m.kind).vb[1]}`,
                  cursor: readOnly ? "default" : "grab", touchAction: "none" }}>
                <Shape kind={m.kind} no={KINDS[m.kind].cls === "weld" ? plainNo(m.no) : m.no} on={m.id === selectedId} tint={states?.[m.id]?.color || null} fluid />
              </div>);
          })}
        </div>
      </div>
      {menu && menuItems.length > 0 && (
        <div ref={menuRef} className="sheet-menu" role="menu" data-sheet-menu={menu.id ? "mark" : "sheet"}
          aria-label={menu.id ? `${KINDS[items.find((m) => m.id === menu.id)?.kind]?.label || ""} ${items.find((m) => m.id === menu.id)?.no || ""}` : "افزودن روی نقشه"}
          style={{ position: "fixed", left: menu.x, top: menu.y, visibility: "hidden", zIndex: 1000 }}
          onContextMenu={(e) => e.preventDefault()}>
          {menu.id && (() => { const m = items.find((x) => x.id === menu.id); return m ? <div className="sheet-menu-h" aria-hidden><Shape kind={m.kind} no="" size={0.45} /> {KINDS[m.kind].label} <b className="mono">{m.no}</b></div> : null; })()}
          {!menu.id && <div className="sheet-menu-h" aria-hidden>افزودن روی نقشه</div>}
          {menuItems.map((it) => (
            <button key={it.k} type="button" role="menuitem" data-menu-item={it.k} className={it.danger ? "danger" : undefined}
              onClick={() => { closeMenu(); it.run(); }}>
              <span className="ic" aria-hidden>{it.kind ? <Shape kind={it.kind} no="" size={0.4} /> : it.icon}</span>{it.label}
            </button>))}
        </div>)}
    </div>
  );
}
