"use client";
import { useEffect, useRef, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * My signature: drawn here with a mouse, finger or pen, or a scanned image
 * uploaded. Every image is kept; the latest is the one in use, and a report
 * signed earlier keeps the image it was signed with.
 */
export default function SignaturePage() {
  const { projectId } = usePlatform();
  const { t, L, date, num } = usePrefs();
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
        if (!inked) throw new Error(t("sg.drawFirst"));
        blob = await new Promise((res) => canvas.current.toBlob(res, "image/png"));
      } else if (!file) throw new Error(t("sg.pickFile"));
      const form = new FormData();
      form.set("projectId", projectId); form.set("kind", mode); form.set("file", blob, mode === "drawn" ? "signature.png" : file.name);
      const res = await fetch("/api/signature", { method: "POST", body: form, credentials: "same-origin" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t("dr.reply", { n: res.status }));
      setOk(body.signature.duplicate ? t("sg.same") : t("sg.saved"));
      if (mode === "drawn") clear(); else setFile(null);
      reload();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const cur = data.current;
  const kind = (k) => L(`signature.kind.${k}`, data.kinds[k]);
  return (
    <div className="page">
      <div className="pagehead"><h1>{t("sg.title")}</h1>
        <span className="sub">{cur ? `${kind(cur.kind)} · ${date(cur.uploaded_at)}` : t("sg.none")}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}

      <div className="card">
        <h2>{t("sg.current")}</h2>
        {cur ? (
          <div className="sigbox"><img src={`/api/signature?projectId=${projectId}&id=${cur.id}`} alt={t("sg.current")} /></div>
        ) : <p className="empty-note">{t("sg.noImage")}</p>}
        {data.history.length > 1 && <p className="muted sm">{t("sg.kept", { n: num(data.history.length - 1) })}</p>}
      </div>

      <div className="card">
        <h2>{t("sg.new")}</h2>
        <div className="seg" role="radiogroup" aria-label={t("sg.kind")}>
          {Object.keys(data.kinds).map((k) => (
            <label key={k}><input type="radio" name="sigkind" value={k} checked={mode === k} onChange={() => setMode(k)} /> {kind(k)}</label>
          ))}
        </div>
        {mode === "drawn" ? (
          <>
            <canvas ref={canvas} className="sigpad" width={600} height={200} aria-label={t("sg.pad")}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" type="button" disabled={busy} onClick={save}>{t("sg.save")}</button>
              <button className="btn ghost" type="button" onClick={clear}>{t("sg.clear")}</button>
            </div>
          </>
        ) : (
          <>
            <div className="field"><label htmlFor="sig-file">{t("sg.file", { mb: num(data.maxBytes / 1024 / 1024) })}</label>
              <input id="sig-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
            <button className="btn" type="button" disabled={busy} onClick={save}>{t("sg.save")}</button>
          </>
        )}
        <p className="muted sm">{t("sg.final")}</p>
      </div>
    </div>
  );
}
