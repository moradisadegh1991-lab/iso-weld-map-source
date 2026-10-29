import { KINDS } from "../lib/sheet/markup.mjs";

/**
 * One mark of the sheet, as drawn: a circle for a shop weld, a square for a
 * site weld, an oval for a spool number, a hexagon for a support number, a
 * dashed circle for a weld whose Shop/Field is not known (lib/sheet/markup.mjs).
 * `tint` paints the shape in a state's colour (checked, accepted, …) with
 * white text, where the kind alone is shown by the shape.
 */
export const COLOR = {
  "weld-shop": "#1f6feb", "weld-field": "#d2453a", "weld-unknown": "#6b7280", spool: "#1a8f4a", support: "#7c3aed",
};

export default function MarkShape({ kind, no, on = false, size = 1, tint = null }) {
  const c = tint || COLOR[kind], shape = KINDS[kind].shape;
  const common = tint
    ? { fill: tint, fillOpacity: 0.92, stroke: on ? "#111" : "#fff", strokeWidth: on ? 3.5 : 2 }
    : { fill: "#fff", fillOpacity: 0.92, stroke: c, strokeWidth: on ? 3.5 : 2.5 };
  const len = String(no).length;
  return (
    <svg width={40 * size} height={30 * size} viewBox="0 0 40 30"
      style={{ display: "block", overflow: "visible", filter: on ? "drop-shadow(0 0 4px rgba(255,214,0,.95))" : "none" }}>
      {shape === "circle" && <circle cx="20" cy="15" r="13" {...common} />}
      {shape === "circle-dashed" && <circle cx="20" cy="15" r="13" {...common} strokeDasharray="4 3" />}
      {shape === "square" && <rect x="7" y="2" width="26" height="26" {...common} />}
      {shape === "oval" && <ellipse cx="20" cy="15" rx="18" ry="12" {...common} />}
      {shape === "hexagon" && <polygon points="10,3 30,3 38,15 30,27 10,27 2,15" {...common} />}
      <text x="20" y="19" textAnchor="middle" fontSize={len > 4 ? 8.5 : len > 2 ? 10.5 : 12.5}
        fontFamily="system-ui,sans-serif" fontWeight="700" fill={tint ? "#fff" : "#111"} style={{ userSelect: "none" }}>{no}</text>
    </svg>
  );
}
