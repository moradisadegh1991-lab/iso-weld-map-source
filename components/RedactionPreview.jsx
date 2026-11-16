"use client";
import { useEffect, useRef, useState } from "react";
import { prepareMaskedSource } from "../lib/client/image-redaction.mjs";
import { copyRedactionImages, hasCompleteTileGrid, makeRedactionBundle } from "../lib/client/redaction-bundle.mjs";

const TILE_NAMES = {
  "TOP-LEFT TILE": "بالا چپ", "TOP-CENTRE TILE": "بالا وسط", "TOP-RIGHT TILE": "بالا راست",
  "MIDDLE-LEFT TILE": "وسط چپ", "MIDDLE-CENTRE TILE": "وسط", "MIDDLE-RIGHT TILE": "وسط راست",
  "BOTTOM-LEFT TILE": "پایین چپ", "BOTTOM-CENTRE TILE": "پایین وسط", "BOTTOM-RIGHT TILE": "پایین راست",
};

/** Local preview only. It does not authorize or perform any model request. */
export default function RedactionPreview({ src }) {
  const image = useRef(null), origin = useRef(null), revision = useRef(0);
  const [boxes, setBoxes] = useState([]), [drag, setDrag] = useState(null), [masked, setMasked] = useState(null), [error, setError] = useState("");
  useEffect(() => { revision.current += 1; origin.current = null; setBoxes([]); setDrag(null); setMasked(null); setError(""); }, [src]);
  const invalidate = () => { revision.current += 1; setMasked(null); setError(""); };
  const point = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };
  const box = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
  const down = (e) => { if (e.button !== 0) return; e.preventDefault(); invalidate(); e.currentTarget.setPointerCapture(e.pointerId); origin.current = point(e); setDrag(box(origin.current, origin.current)); };
  const move = (e) => { if (origin.current) setDrag(box(origin.current, point(e))); };
  const up = (e) => {
    if (!origin.current) return;
    const b = box(origin.current, point(e)); origin.current = null; setDrag(null);
    if (b.width < 0.002 || b.height < 0.002) return;
    setBoxes((old) => [...old, b]); invalidate();
  };
  const preview = async () => {
    const epoch = ++revision.current;
    setMasked(null); setError("");
    try {
      const result = prepareMaskedSource(image.current, boxes);
      // Plain HTTP cannot use Web Crypto. Preserve the local preview, but do not
      // display a fingerprint or imply that this version is ready to send.
      const bundle = globalThis.crypto?.subtle ? await makeRedactionBundle(result.images)
        : { images: copyRedactionImages(result.images), sha256: null };
      if (epoch !== revision.current) return;
      setMasked({ bundle, source: src, completeGrid: hasCompleteTileGrid(bundle.images) });
    } catch { if (epoch === revision.current) { setMasked(null); setError("پیش‌نمایش ساخته نشد؛ کادرها، تصویر و اتصال امن مرورگر را بررسی کنید."); } }
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
      <button type="button" className="btn ghost sm" disabled={!boxes.length} onClick={() => { setBoxes((old) => old.slice(0, -1)); invalidate(); }}>حذف آخرین کادر</button>
      <button type="button" className="btn ghost sm" disabled={!boxes.length} onClick={() => { setBoxes([]); invalidate(); }}>پاک‌کردن کادرها</button>
      <button type="button" className="btn sm" disabled={!boxes.length} onClick={preview}>ساخت پیش‌نمایش پوشیده</button>
    </div>
    {error && <p className="err" role="alert">{error}</p>}
    {masked && masked.source === src && <div data-redaction-result data-preview-sha256={masked.bundle.sha256}>
      <p className="sm">{masked.bundle.images.length} تصویر پوشیده برای بازبینی ساخته شد. هر تصویر را باز کنید؛ خروجی هنوز به هیچ مدلی ارسال نشده است.</p>
      {!masked.completeGrid && <p className="err">به دلیل محدودیت حجم، همهٔ کاشی‌ها در خروجی نیستند؛ این خروجی تمام نقشه را پوشش نمی‌دهد.</p>}
      {masked.bundle.sha256 ? <p className="sm muted">شناسهٔ پیش‌نمایش: <code dir="ltr">{masked.bundle.sha256}</code></p>
        : <p className="sm muted">برای ساخت شناسهٔ پیش‌نمایش، سامانه را با HTTPS باز کنید. در هر حال ارسال به مدل غیرفعال است.</p>}
      {masked.bundle.images.map((im, i) => <details key={`${im.label}-${i}`} open={i === 0} data-redaction-image={i} data-image-label={im.label}>
        <summary>{i === 0 ? "تصویر کامل پوشیده" : `کاشی ${i} · ${TILE_NAMES[im.label] || im.label}`}</summary>
        <img src={`data:${im.mediaType};base64,${im.data}`} alt={i === 0 ? "پیش‌نمایش تصویر کامل پوشیده" : `پیش‌نمایش کاشی پوشیده ${i}`} style={{ display: "block", maxWidth: "min(100%, 800px)" }} />
      </details>)}
    </div>}
  </details>;
}
