"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The frame of the engineering workspace: a toolbar, an explorer at the
 * inline-start side, the drawing in the middle, and the data panel at the
 * inline-end side or at the bottom. Layout only — it holds no engineering
 * data and changes none; what goes in each slot is the caller's.
 *
 *   toolbar   the drawing / revision / status chips and the caller's buttons
 *   explorer  the left (right in RTL) panel; collapsible
 *   children  the drawing
 *   panel     the data panel: tabs and what they hold
 *
 * The panel can be docked at the end or at the bottom, resized by dragging
 * its edge (or with the arrow keys on the focused edge) and collapsed; the
 * explorer collapses. The choices are kept in this browser (localStorage,
 * guarded — the page works without it). Below 900 px the three stack in one
 * column and the panel's size is the page's.
 *
 * Sides are the inline sides (CSS logical properties), so the explorer sits
 * at the start in Persian (right) and in English (left).
 */
const KEY = "epc.workspace";
const LIMITS = { end: [300, 760], bottom: [180, 620] };
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null") || {}; } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

export default function WorkspaceFrame({ toolbar, explorer, panel, children, panelLabel = "داده‌های مهندسی", explorerLabel = "ناوبر" }) {
  const [st, setSt] = useState({ dock: "end", size: { end: 460, bottom: 300 }, explorerOpen: true, panelOpen: true });
  const [ready, setReady] = useState(false);
  const drag = useRef(null);
  const frame = useRef(null);

  // the saved layout, after the first paint (the server cannot know it)
  useEffect(() => {
    const s = read();
    setSt((o) => ({ ...o, ...s, size: { ...o.size, ...(s.size || {}) } }));
    setReady(true);
  }, []);
  useEffect(() => { if (ready) write(st); }, [st, ready]);

  const set = useCallback((patch) => setSt((o) => ({ ...o, ...patch })), []);
  const setSize = useCallback((n) => setSt((o) => ({ ...o, size: { ...o.size, [o.dock]: clamp(n, LIMITS[o.dock]) } })), []);

  // dragging the panel's edge: its size is the distance from the frame's far edge to the pointer
  const onDown = (e) => {
    e.preventDefault();
    drag.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag.current || !frame.current) return;
    const r = frame.current.getBoundingClientRect();
    if (st.dock === "bottom") setSize(r.bottom - e.clientY);
    else {
      const rtl = getComputedStyle(frame.current).direction === "rtl";
      setSize(rtl ? e.clientX - r.left : r.right - e.clientX);
    }
  };
  const onUp = (e) => { drag.current = null; e.currentTarget.releasePointerCapture?.(e.pointerId); };
  const onKey = (e) => {
    const step = e.shiftKey ? 48 : 16;
    const grow = st.dock === "bottom" ? ["ArrowUp"] : [getComputedStyle(frame.current).direction === "rtl" ? "ArrowRight" : "ArrowLeft"];
    const shrink = st.dock === "bottom" ? ["ArrowDown"] : [getComputedStyle(frame.current).direction === "rtl" ? "ArrowLeft" : "ArrowRight"];
    if (grow.includes(e.key)) { e.preventDefault(); setSize(st.size[st.dock] + step); }
    else if (shrink.includes(e.key)) { e.preventDefault(); setSize(st.size[st.dock] - step); }
    else if (e.key === "Home") { e.preventDefault(); setSize(LIMITS[st.dock][0]); }
    else if (e.key === "End") { e.preventDefault(); setSize(LIMITS[st.dock][1]); }
  };

  const [lo, hi] = LIMITS[st.dock];
  const size = st.size[st.dock];
  return (
    <div className="ws" ref={frame} data-workspace data-dock={st.dock} data-explorer={st.explorerOpen ? "open" : "closed"} data-panel={st.panelOpen ? "open" : "closed"}
      style={{ "--ws-panel": `${size}px` }}>
      <div className="ws-bar" role="toolbar" aria-label="نوار ابزار Workspace">
        <button type="button" className="ghost sm" aria-pressed={st.explorerOpen} aria-controls="ws-explorer" data-ws-toggle="explorer"
          onClick={() => set({ explorerOpen: !st.explorerOpen })}>{explorerLabel}</button>
        <div className="ws-bar-main">{toolbar}</div>
        <button type="button" className="ghost sm" data-ws-toggle="dock"
          onClick={() => set({ dock: st.dock === "end" ? "bottom" : "end", panelOpen: true })}
          title={st.dock === "end" ? "پنل داده را زیر نقشه بگذار" : "پنل داده را کنار نقشه بگذار"}>
          {st.dock === "end" ? "پنل: کنار" : "پنل: پایین"}
        </button>
        <button type="button" className="ghost sm" aria-pressed={st.panelOpen} aria-controls="ws-panel" data-ws-toggle="panel"
          onClick={() => set({ panelOpen: !st.panelOpen })}>{panelLabel}</button>
      </div>
      <div className="ws-body">
        {explorer && st.explorerOpen && <nav id="ws-explorer" className="ws-explorer" aria-label={explorerLabel} data-ws-explorer>{explorer}</nav>}
        <div className="ws-center" role="region" aria-label="نقشه" data-ws-center>{children}</div>
        {panel && st.panelOpen && (
          <>
            <div className="ws-handle" role="separator" tabIndex={0} aria-orientation={st.dock === "bottom" ? "horizontal" : "vertical"}
              aria-label="تغییر اندازهٔ پنل" aria-valuemin={lo} aria-valuemax={hi} aria-valuenow={size} data-ws-handle
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}
              onDoubleClick={() => setSize(st.dock === "bottom" ? 300 : 460)} />
            <section id="ws-panel" className="ws-panel" aria-label={panelLabel} data-ws-panel>{panel}</section>
          </>)}
      </div>
    </div>
  );
}
