/**
 * A handover form's content as it goes on paper: its header fields in a
 * strip, then its table, with the number columns summed at the foot. Drawn
 * from the definition the report was made with (content.def).
 */
const show = (f, v) => (v === null || v === undefined || v === "" ? "—" : f.type === "check" ? (v ? "✓" : "—")
  : f.type === "number" ? Number(v).toLocaleString("fa-IR") : f.type === "date" ? new Date(`${v}T00:00:00`).toLocaleDateString("fa-IR") : String(v));

export default function FormPrintBody({ content: c, totals = {} }) {
  const def = c?.def;
  if (!def) return null;
  const rows = c.rows || [];
  const sums = def.columns.some((x) => x.type === "number");
  return (
    <div className="rp-daily">
      {def.header.length > 0 && (
        <div className="rp-strip">{def.header.map((f) => <span key={f.key}>{f.label}: <b>{show(f, c.header?.[f.key])}</b></span>)}</div>)}
      <table className="rp-t">
        <thead><tr><th>ردیف</th>{def.columns.map((x) => <th key={x.key}>{x.label}</th>)}</tr></thead>
        <tbody>{rows.length ? rows.map((r, i) => (
          <tr key={r.id || i}><td>{(i + 1).toLocaleString("fa-IR")}</td>{def.columns.map((x) => <td key={x.key}>{show(x, r[x.key])}</td>)}</tr>))
          : <tr><td colSpan={def.columns.length + 1} className="rp-none">ردیفی ثبت نشده</td></tr>}</tbody>
        {sums && rows.length > 0 && (
          <tfoot><tr><td><b>جمع</b></td>{def.columns.map((x) => <td key={x.key}>{x.type === "number" ? <b>{Number(totals[x.key] || 0).toLocaleString("fa-IR")}</b> : ""}</td>)}</tr></tfoot>)}
      </table>
    </div>
  );
}
