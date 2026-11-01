"use client";
import { useMemo } from "react";
import { cutList, cutListTable } from "../lib/register/cut-list.mjs";
import { DISCLAIMER_EN } from "../lib/disclaimer.mjs";
import TableKit from "./ui/TableKit";

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * The cut list pane of the piping page (lib/register/cut-list.mjs): the
 * pieces per spool, the drawing's own table beside them when it prints one,
 * and a printable page (print / save as PDF) of the same table.
 */
export default function CutList({ model, data }) {
  const cl = useMemo(() => cutList(model, data), [model, data]);
  const meta = data?.meta || {};

  function print() {
    const { head, rows } = cutListTable(cl);
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cut list ${esc(meta.drawingNo)} Rev ${esc(meta.rev)}</title>
<style>body{font:12px/1.4 system-ui,sans-serif;margin:12mm}h1{font-size:16px;margin:0 0 4px}p{margin:2px 0;color:#444}
table{border-collapse:collapse;width:100%;margin-top:8px}th,td{border:1px solid #999;padding:3px 6px;text-align:left}th{background:#eee}
td.n{text-align:right;font-variant-numeric:tabular-nums}.warn{color:#a40}@page{size:A4 landscape;margin:10mm}</style></head><body>
<h1>CUT LIST — ${esc(meta.drawingNo)} Rev ${esc(meta.rev)}${meta.sheet ? ` · Sheet ${esc(meta.sheet)}` : ""}</h1>
<p>${esc(meta.lineNo || "")} ${esc(meta.pipingClass || "")} · Lengths between weld points as dimensioned; no root gap or allowance applied.</p>
<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>
${rows.map((r) => `<tr>${r.map((c, i) => `<td${[0, 3, 5, 9].includes(i) ? ' class="n"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("\n")}
<tr><th colspan="5">Total</th><td class="n"><b>${cl.total}</b></td><td colspan="4"></td></tr></tbody></table>
${cl.unmatchedPrinted.map((c) => `<p class="warn">Drawing piece &lt;${esc(c.piece)}&gt; ${esc(c.len)} mm (${esc(c.nps)}") — no computed piece matches.</p>`).join("")}
<p style="margin-top:10px;font-size:10px">${esc(DISCLAIMER_EN)}</p></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  if (!cl.rows.length) return <div className="pane"><p className="muted sm">این نقشه قطعهٔ لوله‌ای برای برش ندارد.</p></div>;
  return (
    <div className="pane" data-cut-list>
      <div className="tot mono">
        {cl.rows.length} قطعه · {(cl.total / 1000).toFixed(3)} m ·{" "}
        {cl.bySize.map((g) => `${g.key}": ${g.pieces} قطعه ${(g.lengthMm / 1000).toFixed(2)} m`).join(" · ")}
      </div>
      <TableKit name="cut-list"><table className="dtable">
        <thead><tr><th>#</th><th>اسپول</th><th>قطعه</th><th>Ø</th><th>طول برش mm</th><th>دو سر</th><th>جدول نقشه</th></tr></thead>
        <tbody>{cl.rows.map((r) => (
          <tr key={r.no} data-piece={r.no}>
            <td className="mono">{r.no}</td><td className="mono">{r.spool}</td><td className="sm">{r.kind === "pup" ? "Pup" : "Pipe"}</td>
            <td className="mono sm">{r.nps}&quot;{r.schedule ? ` ${r.schedule}` : ""}</td>
            <td className="mono b">{r.lengthMm.toLocaleString("en-US")}</td>
            <td className="mono sm">{r.endA || "?"} ↔ {r.endB || "?"}</td>
            <td className="mono sm" data-printed={r.printed ? r.printed.piece : ""}>{r.printed ? `<${r.printed.piece}> ${r.printed.len}` : cl.printedCount ? "—" : ""}</td>
          </tr>))}</tbody>
      </table></TableKit>
      {cl.unmatchedPrinted.length > 0 && (
        <div className="check warn" data-cut-unmatched><b>! در جدول CUT PIPE LENGTH نقشه هست، در محاسبه نیست</b>
          <span className="mono sm">{cl.unmatchedPrinted.map((c) => `<${c.piece}> ${c.len} mm (${c.nps}")`).join("، ")}</span></div>)}
      {cl.printedCount === 0 && <p className="muted sm">نقشه جدول CUT PIPE LENGTH نداشت یا خوانده نشد؛ طول‌ها فقط از هندسه است.</p>}
      <div className="row">
        <button className="ghost" type="button" onClick={print} data-cut-print>چاپ / ذخیرهٔ PDF</button>
      </div>
      <p className="muted sm">طول بین دو نقطهٔ جوش، همان‌طور که نقشه اندازه می‌دهد؛ درز ریشه و اضافهٔ برش کم یا اضافه نشده — آن روال کارگاه است.</p>
    </div>
  );
}
