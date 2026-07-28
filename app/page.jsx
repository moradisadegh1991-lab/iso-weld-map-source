"use client";
import { useMemo, useRef, useState } from "react";
import Viewer3D, { SPOOL_COLORS } from "../components/Viewer3D";
import { buildModel, registerCsv } from "../lib/engine";
import { DEMO } from "../lib/demo";
import { TYPE_FA } from "../lib/standards";

export default function Page() {
  const [data, setData] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [tab, setTab] = useState("weld");
  const [selected, setSelected] = useState(null);
  const [exploded, setExploded] = useState(false);
  const [showTags, setShowTags] = useState(true);
  const [showDims, setShowDims] = useState(false);
  const [view, setView] = useState("iso");
  const [editing, setEditing] = useState("");
  const fileRef = useRef(null);

  const model = useMemo(() => (data ? buildModel(data) : null), [data]);
  const sel = model && !model.error ? model.register.find((w) => w.no === selected) : null;

  async function onFile(f) {
    if (!f) return;
    setErr(null); setBusy(true); setSelected(null);
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1]);
        r.onerror = () => rej(new Error("خواندن فایل ناموفق بود"));
        r.readAsDataURL(f);
      });
      setPreview(URL.createObjectURL(f));
      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageBase64: b64, mediaType: f.type || "image/jpeg", apiKey: apiKey || undefined }),
      });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j.error || "استخراج ناموفق بود");
      setData(j.data);
      setEditing(JSON.stringify(j.data, null, 2));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function loadDemo() {
    setErr(null); setPreview(null); setSelected(null);
    setData(DEMO);
    setEditing(JSON.stringify(DEMO, null, 2));
  }

  function applyEdit() {
    try {
      const p = JSON.parse(editing);
      setData(p); setErr(null); setSelected(null);
    } catch (e) { setErr("JSON نامعتبر: " + e.message); }
  }

  function download() {
    const csv = registerCsv(model, data.meta);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${(data.meta?.drawingNo || "weld-register").replace(/\s+/g, "_")}_weld_register.csv`;
    a.click();
  }

  return (
    <main dir="rtl">
      <header>
        <span className="brand">ISO&nbsp;WELD&nbsp;MAP</span>
        <span className="sub">آیزومتریک ← مدل سه‌بعدی ← رجیستر جوش</span>
        <div className="grow" />
        {data?.meta?.drawingNo && (
          <span className="chip mono">{data.meta.drawingNo} · REV {data.meta.rev || "?"}</span>
        )}
        {data?.meta?.pipingClass && (
          <span className="chip mono cy">{data.meta.pipingClass} · {data.meta.nps}&quot; · {data.meta.schedule}</span>
        )}
      </header>

      {!data && (
        <section className="intake">
          <div className="drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
            onClick={() => fileRef.current?.click()}>
            <div className="big">{busy ? "در حال خواندن نقشه…" : "نقشه ایزومتریک را اینجا رها کنید"}</div>
            <div className="muted">JPG یا PNG · حداقل ۲۰۰ DPI برای خوانده‌شدن BOM</div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
              onChange={(e) => onFile(e.target.files?.[0])} />
          </div>

          <div className="key">
            <label className="muted">کلید Anthropic API (اختیاری — اگر روی Vercel متغیر محیطی گذاشته‌اید لازم نیست)</label>
            <input type="password" placeholder="sk-ant-…" value={apiKey}
              onChange={(e) => setApiKey(e.target.value)} className="mono" />
            <button className="ghost" onClick={loadDemo}>نمونه بدون کلید: SW 265022A</button>
          </div>

          {err && <div className="err">{err}</div>}

          <ol className="how">
            <li>تصویر خوانده می‌شود و فقط <b>داده خام</b> استخراج می‌گردد: title block، BOM، و مختصات گره‌ها.</li>
            <li>موتور قطعی، take-out استاندارد B16.9 را اعمال و <b>سرجوش‌گذاری</b> را تولید می‌کند — نه مدل زبانی.</li>
            <li>سه چک متقاطع اجرا می‌شود؛ اگر نخواند، هشدار می‌بینید و می‌توانید JSON را اصلاح کنید.</li>
          </ol>
        </section>
      )}

      {model?.error && <div className="err">{model.error}</div>}

      {model && !model.error && (
        <section className="stage">
          <div className="canvas">
            <Viewer3D model={model} selected={selected} onSelect={setSelected}
              exploded={exploded} showTags={showTags} showDims={showDims} view={view} />
            <div className="ctl">
              <div className="row">
                {[["iso", "ایزو"], ["elev", "نما"], ["plan", "پلان"]].map(([k, t]) => (
                  <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{t}</button>
                ))}
              </div>
              <button className={exploded ? "on wide" : "wide"} onClick={() => setExploded(!exploded)}>اسپول باز</button>
              <button className={showTags ? "on wide" : "wide"} onClick={() => setShowTags(!showTags)}>تگ جوش</button>
              <button className={showDims ? "on wide" : "wide"} onClick={() => setShowDims(!showDims)}>ابعاد</button>
            </div>
            <div className="legend">
              {model.spoolIds.map((id, i) => (
                <span key={id}><i style={{ background: SPOOL_COLORS[i % SPOOL_COLORS.length] }} /><b className="mono">{id}</b></span>
              ))}
              <span className="sep" />
              <span><i className="dot" style={{ background: "#FF6B4A" }} />سایت ({model.totals.field})</span>
              <span><i className="dot" style={{ background: "#CFDDE6" }} />کارگاه ({model.totals.shop})</span>
            </div>
            <div className="hint">بکشید تا بچرخد · اسکرول یا پینچ زوم · روی حلقه جوش بزنید</div>
          </div>

          <aside>
            <nav>
              {[["weld", "سرجوش"], ["check", "اعتبارسنجی"], ["line", "Line Data"], ["mto", "MTO"], ["json", "JSON"]]
                .map(([k, t]) => (
                  <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t}</button>
                ))}
            </nav>

            {tab === "weld" && (
              <div className="pane">
                <div className="tot mono">
                  {model.totals.welds} جوش · {model.spoolIds.length} اسپول ·
                  لوله {(model.totals.pipeLen / 1000).toFixed(2)} m ·
                  CL {(model.totals.clCalc / 1000).toFixed(2)} m
                </div>
                <table>
                  <thead><tr><th>No</th><th>Spool</th><th>محل</th><th>نوع</th><th>اتصال</th><th>EL</th><th>NDT</th></tr></thead>
                  <tbody>
                    {model.register.map((w) => (
                      <tr key={w.no} className={selected === w.no ? "sel" : ""}
                        onClick={() => setSelected(selected === w.no ? null : w.no)}>
                        <td className="mono b">{w.no}</td>
                        <td className="mono">{w.spool}</td>
                        <td className={w.loc === "Field" ? "fld" : ""}>{w.loc === "Field" ? "سایت" : "کارگاه"}</td>
                        <td className="mono">{w.kind}</td>
                        <td className="mono sm">{w.role}</td>
                        <td className="mono sm">{w.el.toLocaleString("en-US")}</td>
                        <td className={"mono sm " + (w.ndt.includes("100") ? "fld" : "")}>{w.ndt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="ghost" onClick={download}>دانلود Weld Register (CSV)</button>
                <p className="muted sm">
                  ستون‌های WPS No، Welder ID، NDT Report و Status در فایل CSV خالی گذاشته شده تا QC پر کند.
                  درصد NDT پیش‌فرض بر مبنای ASME B31.3 §341.4.1 برای Normal Fluid Service است؛ Piping Class پروژه حاکم است.
                </p>
              </div>
            )}

            {tab === "check" && (
              <div className="pane">
                {model.checks.map((c, i) => (
                  <div key={i} className={"check " + c.status}>
                    <b>{c.status === "ok" ? "✓" : c.status === "warn" ? "!" : "–"} {c.label}</b>
                    <span className="mono sm">{c.detail}</span>
                  </div>
                ))}
                <p className="muted sm">
                  «محاسبه» از مختصات گره‌ها و take-out استاندارد B16.9 به‌دست می‌آید و «نقشه» از BOM و title block.
                  اگر اختلاف زیاد بود یعنی یک گره یا یک عدد اشتباه خوانده شده — در تب JSON اصلاحش کنید.
                </p>
                {data.unreadable?.length > 0 && (
                  <div className="check warn">
                    <b>! خوانده نشد</b>
                    <span className="sm">{data.unreadable.join(" · ")}</span>
                  </div>
                )}
              </div>
            )}

            {tab === "line" && (
              <div className="pane">
                <table className="kv"><tbody>
                  {Object.entries(data.meta || {}).map(([k, v]) => (
                    <tr key={k}><td className="muted sm">{k}</td><td className="mono sm">{String(v ?? "—")}</td></tr>
                  ))}
                </tbody></table>
                <h4>گره‌ها</h4>
                <table><thead><tr><th>ID</th><th>نوع</th><th>E</th><th>N</th><th>EL</th></tr></thead>
                  <tbody>{(data.nodes || []).map((n) => (
                    <tr key={n.id}><td className="mono">{n.id}</td><td className="sm">{TYPE_FA[n.type] || n.type}</td>
                      <td className="mono sm">{n.E}</td><td className="mono sm">{n.N}</td><td className="mono sm">{n.EL}</td></tr>
                  ))}</tbody></table>
              </div>
            )}

            {tab === "mto" && (
              <div className="pane">
                <table><thead><tr><th>PT</th><th>شرح</th><th>Ø</th><th>Stock</th><th>Qty</th></tr></thead>
                  <tbody>{(data.bom || []).map((b, i) => (
                    <tr key={i}><td className="mono">{b.pt}</td><td className="sm">{b.description}</td>
                      <td className="mono sm">{b.diam}</td><td className="mono sm">{b.stockCode}</td>
                      <td className="mono">{b.qty}</td></tr>
                  ))}</tbody></table>
              </div>
            )}

            {tab === "json" && (
              <div className="pane">
                <textarea className="mono" value={editing} onChange={(e) => setEditing(e.target.value)} spellCheck={false} />
                <div className="row">
                  <button className="ghost" onClick={applyEdit}>اعمال</button>
                  <button className="ghost" onClick={() => { setData(null); setPreview(null); setErr(null); }}>نقشه جدید</button>
                </div>
                {preview && <img src={preview} alt="نقشه آپلودشده" className="thumb" />}
              </div>
            )}

            {sel && (
              <div className="card">
                <b className="mono">{sel.no}</b>
                <span className="mono sm">{sel.role} · {sel.size} · {sel.kind}</span>
                <span className="mono sm">{sel.spool} · {sel.loc === "Field" ? "جوش سایت" : "جوش کارگاه"} · EL {sel.el.toLocaleString("en-US")}</span>
                <span className="mono sm">{sel.ndt} · پیش‌گرم ۱۰°C min · P1↔P1</span>
              </div>
            )}
            {err && <div className="err">{err}</div>}
          </aside>
        </section>
      )}
    </main>
  );
}
