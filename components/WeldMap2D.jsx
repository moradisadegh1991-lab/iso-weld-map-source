"use client";
import { useMemo, useRef, useState } from "react";

/* True piping-isometric projection: the three axes sit 120 deg apart.
   Model frame is x = East, y = Elevation, z = North. */
const COS30 = Math.cos(Math.PI / 6);
const proj = (p) => ({ x: COS30 * (p.x - p.z), y: 0.5 * (p.x + p.z) - p.y });

const SPOOL_COLORS = ["#D9A15B", "#4FB2A3", "#7FA8DB", "#C98CA7", "#9FBF6A", "#B99CE0"];
const C_FIELD = "#FF6B4A";
const C_SHOP = "#8FA3B0";
const INK = "#DDE7EE";
const DIM = "#6F8492";
const CY = "#43A0B4";

export default function WeldMap2D({ model, meta, selected, onSelect, showDims, colorBy }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const svgRef = useRef(null);

  const scene = useMemo(() => {
    const pts = [];
    model.elements.forEach((e) => {
      pts.push(proj(e.a), proj(e.b));
      if (e.v) pts.push(proj(e.v));
    });
    model.register.forEach((w) => pts.push(proj(w.at)));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const S = span / 100;                       // one "unit" of drawing furniture
    const pad = span * 0.16;

    const spoolIdx = new Map(model.spoolIds.map((s, i) => [s, i]));
    const sizes = [...new Set(model.elements.map((e) => e.nps || model.nps))].sort((a, b) => b - a);
    const colorOf = (e) => {
      if (colorBy === "size") return SPOOL_COLORS[sizes.indexOf(e.nps || model.nps) % SPOOL_COLORS.length];
      if (colorBy === "none") return "#8FA3B0";
      return SPOOL_COLORS[(spoolIdx.get(e.spool) ?? 0) % SPOOL_COLORS.length];
    };
    const widthOf = (e) => {
      const n = e.nps || model.nps || 1;
      const mx = Math.max(...sizes, 1);
      return S * (0.5 + 0.9 * (n / mx));
    };

    // ── weld tag placement with simple collision avoidance ──
    const TW = S * 8.5, TH = S * 4.4;
    const placed = [];
    const tags = model.register.map((w) => {
      const at = proj(w.at);
      const host = model.elements.find((e) =>
        Math.hypot(e.a.x - w.at.x, e.a.y - w.at.y, e.a.z - w.at.z) < 2 ||
        Math.hypot(e.b.x - w.at.x, e.b.y - w.at.y, e.b.z - w.at.z) < 2);
      let d = { x: 1, y: 0 };
      if (host) {
        const a = proj(host.a), b = proj(host.b);
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        d = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
      }
      const perp = { x: -d.y, y: d.x };
      let box = null;
      outer:
      for (const r of [3.5, 6, 8.5, 11, 14]) {
        for (const s of [1, -1]) {
          const c = { x: at.x + perp.x * s * S * r, y: at.y + perp.y * s * S * r };
          if (!placed.some((p) => Math.abs(p.x - c.x) < TW && Math.abs(p.y - c.y) < TH)) {
            placed.push(c); box = c; break outer;
          }
        }
      }
      if (!box) box = { x: at.x + perp.x * S * 16, y: at.y + perp.y * S * 16 };
      return { w, at, box, tick: perp };
    });

    const dims = showDims
      ? model.elements
          .filter((e) => e.kind === "pipe" && e.length > 400)
          .map((e) => {
            const a = proj(e.a), b = proj(e.b);
            return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: Math.round(e.length).toLocaleString("en-US") };
          })
      : [];

    return { minX, minY, maxX, maxY, span, S, pad, colorOf, widthOf, tags, dims, TW, TH, sizes };
  }, [model, showDims, colorBy]);

  const { minX, minY, maxX, maxY, S, pad, colorOf, widthOf, tags, dims, TW, TH } = scene;
  const vbW = (maxX - minX + pad * 2) / zoom;
  const vbH = (maxY - minY + pad * 2) / zoom;
  const vbX = minX - pad + pan.x + ((maxX - minX + pad * 2) - vbW) / 2;
  const vbY = minY - pad + pan.y + ((maxY - minY + pad * 2) - vbH) / 2;

  function onWheel(e) {
    e.preventDefault();
    setZoom((z) => Math.max(0.4, Math.min(14, z * (1 - e.deltaY * 0.0012))));
  }
  function onDown(e) { drag.current = { x: e.clientX, y: e.clientY, pan }; }
  function onMove(e) {
    if (!drag.current) return;
    const k = vbW / (svgRef.current?.clientWidth || 1);
    setPan({
      x: drag.current.pan.x - (e.clientX - drag.current.x) * k,
      y: drag.current.pan.y - (e.clientY - drag.current.y) * k,
    });
  }
  const onUp = () => { drag.current = null; };

  function downloadSvg() {
    const el = svgRef.current.cloneNode(true);
    el.setAttribute("viewBox", `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
    el.setAttribute("style", "background:#0A0F13");
    const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + el.outerHTML],
      { type: "image/svg+xml;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(meta?.drawingNo || "weld-map").replace(/\s+/g, "_")}_weld_map.svg`;
    a.click();
  }

  return (
    <div className="map2d">
      <svg ref={svgRef} viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove}
        onPointerUp={onUp} onPointerLeave={onUp}
        onClick={(e) => { if (e.target === svgRef.current) onSelect(null); }}>

        {/* pipe bodies */}
        {model.elements.map((e, i) => {
          const a = proj(e.a), b = proj(e.b);
          const c = colorOf(e);
          const w = widthOf(e);
          if (e.kind === "fitting" && e.v) {
            const v = proj(e.v);
            return <path key={i} d={`M${a.x} ${a.y} Q${v.x} ${v.y} ${b.x} ${b.y}`}
              fill="none" stroke={c} strokeWidth={w} strokeLinecap="round"
              strokeDasharray={e.ghost ? `${S * 1.6} ${S * 1.6}` : undefined}
              opacity={e.ghost ? 0.35 : e.kind === "pup" ? 0.7 : 1} />;
          }
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={c} strokeWidth={e.kind === "pup" ? w * 0.72 : w}
            strokeDasharray={e.ghost ? `${S * 1.6} ${S * 1.6}` : undefined}
            strokeLinecap="round" opacity={e.ghost ? 0.35 : e.kind === "pup" ? 0.75 : 1} />;
        })}

        {/* dimensions */}
        {dims.map((d, i) => (
          <text key={i} x={d.x} y={d.y - S * 1.6} fill={CY} fontSize={S * 2.1}
            textAnchor="middle" fontFamily="ui-monospace, monospace">{d.t}</text>
        ))}

        {/* weld ticks, leaders and tags */}
        {tags.map(({ w, at, box, tick }) => {
          const on = w.no === selected;
          const col = on ? "#fff" : w.loc === "Field" ? C_FIELD : C_SHOP;
          const t = S * 2.2;
          return (
            <g key={w.no} onClick={(ev) => { ev.stopPropagation(); onSelect(on ? null : w.no); }}
              style={{ cursor: "pointer" }}>
              <line x1={at.x - tick.x * t} y1={at.y - tick.y * t}
                x2={at.x + tick.x * t} y2={at.y + tick.y * t}
                stroke={col} strokeWidth={S * 0.55} strokeLinecap="round" />
              <line x1={at.x} y1={at.y} x2={box.x} y2={box.y}
                stroke={col} strokeWidth={S * 0.22} opacity={0.55} />
              <rect x={box.x - TW / 2} y={box.y - TH / 2} width={TW} height={TH} rx={S * 0.5}
                fill={on ? "#fff" : "#0A0F13"} stroke={col} strokeWidth={S * 0.28} />
              <text x={box.x} y={box.y + S * 0.85} textAnchor="middle"
                fontSize={S * 2.4} fontFamily="ui-monospace, monospace" fontWeight="600"
                fill={on ? "#0A0F13" : col}>{w.no}</text>
            </g>
          );
        })}

        {/* tie-in callouts */}
        {model.nodes.filter((n) => n.type === "tie-in").map((n, i) => {
          const p = proj({ x: n.E - model.origin.E, y: n.EL - model.origin.EL, z: n.N - model.origin.N });
          return (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={S * 1.5} fill="none" stroke={C_FIELD} strokeWidth={S * 0.4} />
              <text x={p.x} y={p.y + S * 6} textAnchor="middle" fontSize={S * 2}
                fontFamily="ui-monospace, monospace" fill={DIM}>
                {n.ref || "CONT."}
              </text>
              <text x={p.x} y={p.y + S * 8.6} textAnchor="middle" fontSize={S * 1.9}
                fontFamily="ui-monospace, monospace" fill={DIM}>
                EL {Math.round(n.EL).toLocaleString("en-US")}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="map2d-bar">
        <button className="ghost" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>بازنشانی نما</button>
        <button className="ghost" onClick={downloadSvg}>دانلود SVG</button>
        <span className="muted sm">تصویر برداری است — در هر ابعادی بدون افت چاپ می‌شود</span>
      </div>
    </div>
  );
}
