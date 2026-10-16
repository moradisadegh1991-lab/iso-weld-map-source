"use client";
import { useEffect, useRef, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";

/**
 * My signature: drawn here with a mouse, finger or pen, or a scanned image
 * uploaded. Every image is kept; the latest is the one in use, and a report
 * signed earlier keeps the image it was signed with.
 */
export default function SignaturePage() {
  const { projectId } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/signature?projectId=${id}&mine=1`, []);
  const [mode, setMode] = useState("drawn");
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [busy, setBusy] = useState(false);
  const [inked, setInked] = useState(false);
  const canvas = useRef(null);
  const pen = useRef(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c || mode !== "drawn") return;
    const ctx = c.getContext("2d");
    ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111";
  }, [mode, data]);

  const point = (e) => {
    const r = canvas.current.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.current.width / r.width), (e.clientY - r.top) * (canvas.current.height / r.height)];
  };
  const down = (e) => { e.preventDefault(); canvas.current.setPointerCapture(e.pointerId); pen.current = point(e); };
  const move = (e) => {
    if (!pen.current) return;
    const ctx = canvas.current.getContext("2d");
    const [x, y] = point(e);
    ctx.beginPath(); ctx.moveTo(...pen.current); ctx.lineTo(x, y); ctx.stroke();
    pen.current = [x, y]; setInked(true);
  };
  const up = () => { pen.current = null; };
  const clear = () => { canvas.current.getContext("2d").clearRect(0, 0, canvas.current.width, canvas.current.height); setInked(false); };

  async function save() {
    setMsg(null); setOk(null); setBusy(true);
    try {
      let blob = file;
      if (mode === "drawn") {
        if (!inked) throw new Error("ابتدا امضا را در کادر رسم کنید.");
        blob = await new Promise((res) => canvas.current.toBlob(res, "image/png"));
      } else if (!file) throw new Error("فایل امضای اسکن‌شده را انتخاب کنید.");
      const form = new FormData();
      form.set("projectId", projectId); form.set("kind", mode); form.set("file", blob, mode === "drawn" ? "signature.png" : file.name);
      const res = await fetch("/api/signature", { method: "POST", body: form, credentials: "same-origin" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `پاسخ ${res.status}`);
      setOk(body.signature.duplicate ? "همین امضا از قبل در حال استفاده است." : "امضا ذخیره شد و از این پس استفاده می‌شود.");
      if (mode === "drawn") clear(); else setFile(null);
      reload();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const cur = data.current;
  return (
    <div className="page">
      <div className="pagehead"><h1>امضای من</h1>
        <span className="sub">{cur ? `${data.kinds[cur.kind]} · ${new Date(cur.uploaded_at).toLocaleDateString("fa-IR")}` : "هنوز امضایی ثبت نشده"}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}

      <div className="card">
        <h2>امضای فعلی</h2>
        {cur ? (
          <div className="sigbox"><img src={`/api/signature?projectId=${projectId}&id=${cur.id}`} alt="امضای فعلی" /></div>
        ) : <p className="empty-note">بدون امضای تصویری، در کادر امضای گزارش فقط نام و تاریخ چاپ می‌شود.</p>}
        {data.history.length > 1 && <p className="muted sm">{data.history.length - 1} امضای قبلی نگه داشته شده است؛ گزارش‌هایی که با آن‌ها امضا شده‌اند همان امضا را نشان می‌دهند.</p>}
      </div>

      <div className="card">
        <h2>امضای جدید</h2>
        <div className="seg" role="radiogroup" aria-label="نوع امضا">
          {Object.entries(data.kinds).map(([k, v]) => (
            <label key={k}><input type="radio" name="sigkind" value={k} checked={mode === k} onChange={() => setMode(k)} /> {v}</label>
          ))}
        </div>
        {mode === "drawn" ? (
          <>
            <canvas ref={canvas} className="sigpad" width={600} height={200} aria-label="کادر رسم امضا"
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" type="button" disabled={busy} onClick={save}>ذخیرهٔ امضا</button>
              <button className="btn ghost" type="button" onClick={clear}>پاک کردن</button>
            </div>
          </>
        ) : (
          <>
            <div className="field"><label htmlFor="sig-file">تصویر امضا (PNG، JPEG یا WebP، حداکثر {data.maxBytes / 1024 / 1024} مگابایت)</label>
              <input id="sig-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
            <button className="btn" type="button" disabled={busy} onClick={save}>ذخیرهٔ امضا</button>
          </>
        )}
        <p className="muted sm">امضای ذخیره‌شده دیگر عوض یا حذف نمی‌شود؛ امضای تازه جای آن را برای امضاهای بعدی می‌گیرد.</p>
      </div>
    </div>
  );
}
