"use client";
import { useEffect, useRef, useState } from "react";

/**
 * The in-app scanner. The phone's own camera app reads our labels too (they
 * carry a plain URL); this saves leaving the page when working a list.
 *
 * The browser's own BarcodeDetector where there is one (Chrome on Android),
 * jsQR on the camera frames where there is not. The camera is only offered
 * in a secure context — https, or localhost — because browsers refuse it
 * anywhere else, and saying so beats a black box that never opens.
 */
export default function Scanner({ onResult, onClose }) {
  const video = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let stream = null, stop = false, timer = null;
    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError("دوربین فقط روی https یا localhost در دسترس است. برچسب را با دوربین خود گوشی اسکن کنید — آدرس آن مستقیم همین صفحه را باز می‌کند.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch (e) {
        setError(`دوربین باز نشد: ${e.message}`);
        return;
      }
      if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});
      const detector = "BarcodeDetector" in window ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
      const jsQR = detector ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const tick = async () => {
        if (stop) return;
        const v = video.current;
        if (v && v.readyState >= 2) {
          try {
            let text = null;
            if (detector) {
              const found = await detector.detect(v);
              text = found[0]?.rawValue || null;
            } else {
              canvas.width = v.videoWidth; canvas.height = v.videoHeight;
              const ctx = canvas.getContext("2d", { willReadFrequently: true });
              ctx.drawImage(v, 0, 0);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              text = jsQR(img.data, img.width, img.height)?.data || null;
            }
            if (text) { onResult(text); return; }
          } catch { /* a bad frame; try the next */ }
        }
        timer = setTimeout(tick, 200);
      };
      tick();
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onResult]);

  return (
    <div className="card" style={{ padding: 10 }}>
      {error ? <p className="err">{error}</p>
        : <video ref={video} playsInline muted style={{ width: "100%", maxHeight: 360, background: "#000", borderRadius: 4 }} />}
      <button className="btn ghost" onClick={onClose} style={{ marginTop: 8 }}>بستن دوربین</button>
    </div>
  );
}
