"use client";
import { useEffect, useRef, useState } from "react";
import { prepareMaskedSource } from "../lib/client/image-redaction.mjs";

/** Local preview only. It does not authorize or perform any model request. */
export default function RedactionPreview({ src }) {
  const image = useRef(null), origin = useRef(null);
  const [boxes, setBoxes] = useState([]), [drag, setDrag] = useState(null), [masked, setMasked] = useState(null), [error, setError] = useState("");
  useEffect(() => { origin.current = null; setBoxes([]); setDrag(null); setMasked(null); setError(""); }, [src]);
  const point = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };
  const box = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
  const down = (e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); origin.current = point(e); setDrag(box(origin.current, origin.current)); };
  const move = (e) => { if (origin.current) setDrag(box(origin.current, point(e))); };
  const up = (e) => {
    if (!origin.current) return;
    const b = box(origin.current, point(e)); origin.current = null; setDrag(null);
    if (b.width < 0.002 || b.height < 0.002) return;
    setBoxes((old) => [...old, b]); setMasked(null); setError("");
  };
  const preview = () => {
    try {
      const result = prepareMaskedSource(image.current, boxes);
      setMasked({ url: result.masked.toDataURL("image/png"), count: result.images.length }); setError("");
    } catch { setMasked(null); setError("پیش‌نمایش ساخته نشد؛ کادرها و تصویر را بررسی کنید."); }
  };
  return <details className="pane" data-redaction-preview>
    <summary>پیش‌نمایش محلی پوشاندن اطلاعات محرمانه</summary>
    <p className="sm muted">روی نام پروژه، کارفرما، لوگو و هر اطلاعات محرمانهٔ دیگر کادر بکشید. فقط نواحی انتخاب‌شده پوشانده می‌شوند. این پیش‌نمایش هیچ چیزی به مدل نمی‌فرستد و تمام ناشناس‌سازی را تضمین نمی‌کند.</p>
    <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { origin.current = null; setDrag(null); }}
      style={{ position: "relative", width: "min(100%, 800px)", touchAction: "none", cursor: "crosshair" }} data-redaction-source>
      <img ref={image} src={src} alt="نقشه برای انتخاب نواحی محرمانه" draggable={false} style={{ display: "block", width: "100%" }} />
      {[...boxes, ...(drag ? [drag] : [])].map((b, i) => <span key={i} style={{ position: "absolute", pointerEvents: "none", left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.width * 100}%`, height: `${b.height * 100}%`, background: "black", opacity: 0.8, border: "1px solid white" }} />)}
    </div>
    <div className="row" style={{ gap: 8, marginTop: 8 }}>
      <span className="sm">{boxes.length} کادر</span>
      <button type="button" className="btn ghost sm" disabled={!boxes.length} onClick={() => { setBoxes((old) => old.slice(0, -1)); setMasked(null); }}>حذف آخرین کادر</button>
      <button type="button" className="btn ghost sm" disabled={!boxes.length} onClick={() => { setBoxes([]); setMasked(null); }}>پاک‌کردن کادرها</button>
      <button type="button" className="btn sm" disabled={!boxes.length} onClick={preview}>ساخت پیش‌نمایش پوشیده</button>
    </div>
    {error && <p className="err" role="alert">{error}</p>}
    {masked && <div data-redaction-result><p className="sm">پیش‌نمایش محلی؛ {masked.count} تصویر از نسخهٔ پوشیده ساخته شد. خروجی هنوز به هیچ مدلی ارسال نشده است.</p>
      <img src={masked.url} alt="پیش‌نمایش نقشهٔ پوشیده" style={{ display: "block", maxWidth: "min(100%, 800px)" }} /></div>}
  </details>;
}
