"use client";
import { useRef } from "react";
import { pageSize, footerOrder, footerRows, fill } from "../../lib/reports/print.mjs";

/**
 * One report on paper, drawn in millimetres from its layout
 * (lib/reports/print.mjs). Used twice:
 *
 *  - print   a table whose header and footer the browser repeats on every
 *            printed page; the body flows over as many pages as it needs
 *  - preview one page, scaled to fit, with the section dividers and the
 *            header cells' lower edges draggable (`onLayout` gets the change)
 */
const MM = 96 / 25.4;   // CSS px in a millimetre

const textStyle = (t) => ({ fontFamily: t.font === "inherit" ? undefined : `"${t.font}", inherit`, fontSize: `${t.size}pt`,
  fontWeight: t.bold ? 700 : 400, textAlign: t.align });

function Header({ layout, values, logoUrl, onCell }) {
  const h = layout.heights.header;
  const logos = (ids) => (
    <div className="rp-logos">{ids.map((id) => <img key={id} src={logoUrl(id)} alt="" style={{ maxHeight: `${h - 4}mm` }} />)}</div>
  );
  return (
    <div className="rp-header" style={{ height: `${h}mm` }}>
      <div className="rp-hcol rp-side">{logos(layout.header.right.logos)}</div>
      <div className="rp-hcol rp-center">
        {layout.header.center.cells.map((c, k) => (
          <div key={k} className="rp-cell" style={{ height: `${c.height}mm`, ...textStyle(c), justifyContent: { right: "flex-start", center: "center", left: "flex-end" }[c.align] }}>
            <span>{fill(c.text, values)}</span>
            {onCell && <span className="rp-drag rp-drag-cell no-print" title="کشیدن برای تغییر ارتفاع خانه" onPointerDown={(e) => onCell(e, k)} />}
          </div>
        ))}
      </div>
      <div className="rp-hcol rp-side">{logos(layout.header.left.logos)}</div>
    </div>
  );
}

function Footer({ layout, boxes, signatureUrl }) {
  const els = footerOrder(layout);
  const rows = footerRows(layout, boxes.length);
  const landscape = layout.page.orientation === "landscape";
  const line = (e, box, sig) => {
    const st = textStyle(e);
    switch (e.key) {
      case "stage": return <div key={e.key} className="rp-l" style={st}>{box.stageName}</div>;
      case "group": return <div key={e.key} className="rp-l" style={st}>{box.name}</div>;
      case "groupTitle": return box.title || box.description ? <div key={e.key} className="rp-l" style={st}>{[box.title, box.description].filter(Boolean).join(" — ")}</div> : null;
      case "signature": return <div key={e.key} className="rp-sigimg" style={st}>{sig?.signatureId ? <img src={signatureUrl(sig.signatureId)} alt="" /> : null}</div>;
      case "user": return <div key={e.key} className="rp-l" style={st}>{sig?.name || " "}</div>;
      case "date": return <div key={e.key} className="rp-l" style={st}>{sig ? new Date(sig.at).toLocaleDateString("fa-IR") : " "}</div>;
      default: return null;
    }
  };
  const head = els.filter((e) => ["stage", "group", "groupTitle"].includes(e.key));
  const each = els.filter((e) => !["stage", "group", "groupTitle"].includes(e.key));
  return (
    <div className="rp-footer" style={{ height: `${layout.heights.footer}mm` }}>
      {rows.map((row, r) => (
        <div key={r} className="rp-frow" style={{ justifyContent: layout.footer.align === "left" ? "flex-end" : "flex-start", flex: landscape ? 1 : undefined }}>
          {row.map((k) => {
            const box = boxes[k];
            const sigs = box.signatures.filter((s) => s.current);
            return (
              <div key={box.groupId} className="rp-box" style={{ flex: `0 0 ${100 / row.length}%` }}>
                {head.map((e) => line(e, box))}
                <div className="rp-third">
                  {/* a stage its deadline approved: its text where the signatures would be (owner's requirements 2026-10-22, item 2-a) */}
                  {!sigs.length && box.autoText ? <div className="rp-signer" data-auto-text>{box.autoText}</div>
                    : (sigs.length ? sigs : [null]).map((s, j) => <div key={j} className="rp-signer">{each.map((e) => line(e, box, s))}</div>)}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * @param layout      a checked layout
 * @param values      the header's {placeholders}
 * @param boxes       signature boxes: [{groupId, stageName, name, title, description, signatures:[{signatureId,name,at,current}], autoText?}]
 * @param children    the body
 * @param mode        "print" | "preview"
 * @param scale       preview only: how much to shrink the page
 * @param onLayout    preview only: called with a changed layout while dragging
 */
export default function PrintSheet({ layout, values, boxes, logoUrl, signatureUrl, children, mode = "print", scale = 1, onLayout }) {
  const { width, height } = pageSize(layout);
  const sheet = useRef(null);
  const drag = (apply) => (e, ...args) => {
    if (!onLayout) return;
    e.preventDefault();
    const start = e.clientY;
    const target = e.currentTarget; target.setPointerCapture(e.pointerId);
    const snapshot = JSON.parse(JSON.stringify(layout));
    const move = (ev) => {
      const dmm = (ev.clientY - start) / (MM * scale);
      onLayout(apply(JSON.parse(JSON.stringify(snapshot)), Math.round(dmm * 2) / 2, ...args));
    };
    const up = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); };
    target.addEventListener("pointermove", move); target.addEventListener("pointerup", up);
  };
  const header = <Header layout={layout} values={values} logoUrl={logoUrl}
    onCell={mode === "preview" && onLayout ? drag((l, d, k) => { l.header.center.cells[k].height = Math.max(4, base(l.header.center.cells[k].height + d)); return l; }) : null} />;
  const footer = <Footer layout={layout} boxes={boxes} signatureUrl={signatureUrl} />;

  if (mode === "print") {
    return (
      <div className="rp-printroot" style={{ width: `${width}mm` }}>
        <style>{`@page { size: ${layout.page.size} ${layout.page.orientation}; margin: 0 }`}</style>
        <table className="rp-table" style={{ width: `${width}mm` }}>
          <thead><tr><td>{header}</td></tr></thead>
          <tfoot><tr><td>{footer}</td></tr></tfoot>
          <tbody><tr><td><div className="rp-body">{children}</div></td></tr></tbody>
        </table>
      </div>
    );
  }
  const bodyH = height - layout.heights.header - layout.heights.footer;
  return (
    <div className="rp-previewwrap" style={{ width: `${width * MM * scale}px`, height: `${height * MM * scale}px` }}>
      <div ref={sheet} className="rp-sheet" style={{ width: `${width}mm`, height: `${height}mm`, transform: `scale(${scale})` }}>
        {header}
        {onLayout && <div className="rp-drag rp-drag-line" title="کشیدن: ارتفاع سربرگ"
          onPointerDown={drag((l, d) => { l.heights.header = base(l.heights.header + d); return l; })} />}
        <div className="rp-body rp-body-preview" style={{ height: `${bodyH}mm` }}>{children}</div>
        {onLayout && <div className="rp-drag rp-drag-line" title="کشیدن: ارتفاع پاورقی"
          onPointerDown={drag((l, d) => { l.heights.footer = base(l.heights.footer - d); return l; })} />}
        {footer}
      </div>
    </div>
  );
}

function base(v) { return Math.max(4, Math.round(v * 2) / 2); }
