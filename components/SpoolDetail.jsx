"use client";
import { useMemo } from "react";
import TableKit from "./ui/TableKit";
import { isUid } from "../lib/sheet/mark-identity.mjs";
import { spoolView } from "../lib/register/cut-identity.mjs";
import { cutBomReport } from "../lib/register/cut-bom.mjs";

/**
 * The detail of one spool (docs/audit/phase-9-spool-cutlist.md §6): its number and stable uid, the welds that name it (by uid), shop/field
 * counts, its cut pieces and their total length, the size/material/schedule breakdown, the pipe they consume against the BOM, and the
 * validation findings that concern it. Everything is DERIVED from the draft — nothing here is stored or editable.
 * The BOM figures are a PREVIEW of the draft; the server's saved BOM is the authority.
 *
 *   spools    the spool marks of the sheet        selectedUid   the spool shown
 *   payload   { sheetMarkup.items, weldList, cutLengths, bom } as drafted
 *   findings  the Validation Center's draft findings
 *   onSelect(uid), onGo({ kind, uid })  navigate to a spool / weld / cut piece
 */
export default function SpoolDetail({ spools = [], selectedUid, payload, findings = [], onSelect, onGo }) {
  const sp = spools.find((m) => isUid(m.uid) && m.uid === selectedUid) || spools.find((m) => isUid(m.uid)) || null;
  const v = useMemo(() => (sp ? spoolView(payload, sp.uid) : null), [payload, sp]);
  const bom = useMemo(() => (v ? cutBomReport(v.cuts, payload.bom || []) : null), [v, payload.bom]);
  if (!spools.length) return <p className="muted sm" data-spool-detail="none">اسپولی روی برگ نیست.</p>;
  if (!sp || !v) return <p className="muted sm" data-spool-detail="none">اسپول‌های این برگ شناسهٔ پایدار ندارند؛ ابتدا ذخیره کنید.</p>;
  const mine = new Set([sp.uid, ...v.welds.map((w) => w.uid), ...v.cuts.map((c) => c.uid)].filter(Boolean).map((u) => String(u).toLowerCase()));
  const own = findings.filter((f) => (f.entityUid && mine.has(String(f.entityUid).toLowerCase())) || String(f.detail?.spoolUid || "").toLowerCase() === sp.uid.toLowerCase());
  const len = (n) => `${Math.round(n * 1000) / 1000}`;
  return (
    <section className="spool-detail" data-spool-detail={sp.uid} style={{ marginTop: 10 }}>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b>جزئیات اسپول</b>
        <select dir="ltr" data-spool-pick value={sp.uid} onChange={(e) => onSelect?.(e.target.value)} aria-label="اسپول">
          {spools.filter((m) => isUid(m.uid)).map((m) => <option key={m.uid} value={m.uid}>{String(m.no).trim() || "؟"} · {m.uid.slice(0, 8)}</option>)}
        </select>
        <button type="button" className="ghost sm" data-spool-go onClick={() => onGo?.({ kind: "spool", uid: sp.uid })}>نمایش روی نقشه</button>
      </div>
      <p className="mono sm muted" dir="ltr" data-spool-uid style={{ margin: "4px 0" }}>{String(sp.no).trim()} · uid {sp.uid}</p>
      <p className="sm" data-spool-counts>
        سرجوش‌ها: <b>{v.welds.length}</b> (کارگاهی <b data-count="shop">{v.shop}</b> · سایت <b data-count="field">{v.field}</b>
        {v.welds.length - v.shop - v.field > 0 ? ` · نامعلوم ${v.welds.length - v.shop - v.field}` : ""}) · قطعه‌های برش: <b data-count="cuts">{v.cuts.length}</b> · جمع طول برش: <b data-count="total" className="mono">{len(v.totalMm)} mm</b>
      </p>
      {v.welds.length > 0 && (
        <ul className="sm" data-spool-welds style={{ margin: "4px 0", paddingInlineStart: 18 }}>
          {v.welds.map((w) => <li key={w.uid || w.id}>{w.no || "؟"} <span className="muted mono" dir="ltr">{String(w.uid || "").slice(0, 8)}</span>{" "}
            <button type="button" className="ghost sm" data-spool-weld-go={w.uid} onClick={() => onGo?.({ kind: "weld", uid: w.uid })}>نمایش</button></li>)}
        </ul>)}
      {v.cuts.length > 0 && (
        <TableKit name="iso-spool-cuts"><table className="dtable" data-spool-cuts>
          <thead><tr><th>قطعه</th><th>طول (mm)</th><th>N.S.</th><th>جنس</th><th>Sch</th><th>ابتدا</th><th>انتها</th><th></th></tr></thead>
          <tbody>{v.cuts.map((c) => (
            <tr key={c.uid || c.piece}><td className="mono">&lt;{c.piece}&gt;</td><td className="mono">{c.lengthMm}</td><td className="mono" dir="ltr">{c.ns || "؟"}</td>
              <td className="mono sm" dir="ltr">{c.material || "—"}</td><td className="mono sm" dir="ltr">{c.schedule || "—"}</td>
              <td className="mono sm" dir="ltr">{c.from || "—"}</td><td className="mono sm" dir="ltr">{c.to || "—"}</td>
              <td><button type="button" className="ghost sm" data-spool-cut-go={c.uid} onClick={() => onGo?.({ kind: "cut", uid: c.uid })}>نمایش</button></td></tr>))}</tbody>
        </table></TableKit>)}
      {bom && bom.sizes.length > 0 && (
        <div data-spool-bom>
          <b className="sm">مصرف لوله از BOM — پیش‌نمایش پیش‌نویس (BOM ذخیره‌شدهٔ سرور مرجع است)</b>
          <TableKit name="iso-spool-bom"><table className="dtable">
            <thead><tr><th>قطر</th><th>جنس</th><th>Sch</th><th>قطعه</th><th>جمع برش (m)</th><th>لولهٔ BOM (m)</th><th>باقی‌ماندهٔ نظری (m)</th><th>وضعیت</th></tr></thead>
            <tbody>{bom.sizes.map((z, i) => (
              <tr key={i} data-spool-bom-status={z.status}><td className="mono" dir="ltr">{z.size == null ? "؟" : `${z.size}"`}</td><td className="mono sm" dir="ltr">{z.material || "—"}</td><td className="mono sm" dir="ltr">{z.schedule || "—"}</td>
                <td className="mono">{z.pieces}</td><td className="mono">{z.cutM}</td><td className="mono">{z.bomM ?? "—"}</td><td className="mono">{z.remainingM ?? "—"}</td>
                <td className={z.status === "ok" ? "ok sm" : "sm warnish"}>{{ ok: "هم‌خوان", over: "برش بیش از BOM", noBom: "ردیف لولهٔ BOM نیست", noSize: "قطر خوانده نشد", mismatch: "جنس/Sch نمی‌خواند" }[z.status]}</td></tr>))}</tbody>
          </table></TableKit>
          <p className="muted sm" style={{ margin: "2px 0" }}>این اسپول فقط تکهٔ خودش را نشان می‌دهد؛ لولهٔ BOM بین همهٔ اسپول‌های برگ مشترک است و «باقی‌ماندهٔ نظری» موجودی قابل‌استفاده نیست.</p>
        </div>)}
      <div data-spool-findings>
        <b className="sm">یافته‌های اعتبارسنجی ({own.length})</b>
        {own.length === 0 ? <p className="muted sm" style={{ margin: "2px 0" }}>یافته‌ای برای این اسپول نیست.</p>
          : <ul className="sm" style={{ margin: "4px 0", paddingInlineStart: 18 }}>{own.map((f) => <li key={f.id} className={f.severity === "error" ? "err" : ""} data-finding={f.code}>{f.message}</li>)}</ul>}
      </div>
    </section>
  );
}
