import { KINDS, SHEET_SIZE } from "../lib/sheet/markup.mjs";

/**
 * One mark of the sheet, drawn as the designer draws it: a hollow frame with
 * a thin black line and the number inside in a bold serif, a circle for a
 * shop weld, a square for a site weld, an oval for a spool number, a hexagon
 * for a support number, a dashed grey circle for a weld whose Shop/Field is
 * not known (lib/sheet/markup.mjs).
 *
 * `fluid` draws it at the size a mark has on the sheet (SHEET_SIZE, a share of
 * the sheet's width): the parent sizes the box, the frame and its number
 * scale with it. Otherwise it is an icon `size` times 30 px high.
 * `tint` paints the frame in a state's colour (checked, accepted, …) with
 * white text, where the kind alone is told by the shape.
 */
export const COLOR = {
  "weld-shop": "#111", "weld-field": "#111", "weld-unknown": "#6b7280", spool: "#111", support: "#111",
};

/**
 * Each shape in its own box, with the frame filling it but for the line's
 * margin. `box` is the box's width as a share of the sheet's width; the
 * proportions are the example sheet's (lib/sheet/markup.mjs SHEET_SIZE).
 */
export const GEOMETRY = {
  weld: { vb: [30, 30], frame: 26, font: 15, fit: 23, box: SHEET_SIZE.weld.w * 30 / 26, stroke: 1 },
  spool: { vb: [60, 28], frame: 56, font: 12.5, fit: 46, box: SHEET_SIZE.spool.w * 60 / 56, stroke: 1.15 },
  support: { vb: [44, 36], frame: 40, font: 12, fit: 32, box: SHEET_SIZE.support.w * 44 / 40, stroke: 1.1 },
};
export const geometryOf = (kind) => GEOMETRY[KINDS[kind]?.cls] || GEOMETRY.weld;

export default function MarkShape({ kind, no, on = false, size = 1, tint = null, fluid = false }) {
  const g = geometryOf(kind);
  const [W, H] = g.vb;
  const c = tint || COLOR[kind], shape = KINDS[kind].shape;
  const sw = on ? g.stroke * 2.4 : g.stroke;
  const common = tint
    ? { fill: tint, fillOpacity: 0.92, stroke: on ? "#111" : "#fff", strokeWidth: sw }
    : { fill: "#fff", fillOpacity: 0.95, stroke: c, strokeWidth: sw };
  const label = String(no ?? "");
  // a long number is drawn narrower to stay inside its frame, as the designer's do
  const long = label.length * g.font * 0.55 > g.fit;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={fluid ? "100%" : (W / H) * 30 * size} height={fluid ? "100%" : 30 * size}
      style={{ display: "block", overflow: "visible", filter: on ? "drop-shadow(0 0 3px rgba(255,200,0,.95))" : "none" }}>
      {shape === "circle" && <circle cx={W / 2} cy={H / 2} r={13} {...common} />}
      {shape === "circle-dashed" && <circle cx={W / 2} cy={H / 2} r={13} {...common} strokeDasharray="3 2.4" />}
      {shape === "square" && <rect x={2} y={2} width={26} height={26} {...common} />}
      {shape === "oval" && <ellipse cx={30} cy={14} rx={28} ry={12.4} {...common} />}
      {shape === "hexagon" && <polygon points="2,18 11,2.4 33,2.4 42,18 33,33.6 11,33.6" {...common} />}
      {label && (
        <text x={W / 2} y={H / 2} dominantBaseline="central" textAnchor="middle" fontSize={g.font}
          fontFamily="'Times New Roman',Times,serif" fontWeight="700" fill={tint ? "#fff" : "#111"}
          {...(long ? { textLength: g.fit, lengthAdjust: "spacingAndGlyphs" } : {})} style={{ userSelect: "none" }}>{label}</text>
      )}
    </svg>
  );
}
