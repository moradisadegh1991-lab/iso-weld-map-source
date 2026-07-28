"use client";
import { useMemo, useRef, useState } from "react";
import Viewer3D, { SPOOL_COLORS } from "../components/Viewer3D";
import { buildModel, registerCsv } from "../lib/engine";
import { DEMO } from "../lib/demo";
import { TYPE_FA } from "../lib/standards";

/* ── client-side image prep ────────────────────────────────────
   Vercel functions cap the request body at ~4.5 MB and the vision
   model downsamples anything past ~1568 px on the long edge.
   So: send the full sheet for routing plus overlapping quadrant
   crops for the small text, each already scaled to a useful size. */

function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("تصویر باز نشد. فرمت JPG یا PNG باشد."));
    img.src = URL.createObjectURL(file);
  });
}

function renderCrop(img, sx, sy, sw, sh, max, quality) {
  const scale = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality).split(",")[1];
}

function tiles(img, max, quality) {
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const ox = W * 0.07, oy = H * 0.07;
  const defs = [
    ["FULL SHEET", 0, 0, W, H],
    ["TOP-LEFT QUADRANT", 0, 0, W / 2 + ox, H / 2 + oy],
    ["TOP-RIGHT QUADRANT", W / 2 - ox, 0, W / 2 + ox, H / 2 + oy],
    ["BOTTOM-LEFT QUADRANT", 0, H / 2 - oy, W / 2 + ox, H / 2 + oy],
    ["BOTTOM-RIGHT QUADRANT", W / 2 - ox, H / 2 - oy, W / 2 + ox, H / 2 + oy],
  ];
  return defs.map(([label, sx, sy, sw, sh]) => ({
    label, mediaType: "image/jpeg",
    data: renderCrop(img, sx, sy, Math.min(sw, W - sx), Math.min(sh, H - sy), max, quality),
  }));
}

const LIMIT = 3_400_000; // keep well under the 4.5 MB body cap

async function prepare(file) {
  const img = await loadImage(file);
  let out = tiles(img, 1500, 0.82);
  let bytes = out.reduce((a, i) => a + i.data.length, 0);
  if (bytes > LIMIT) { out = tiles(img, 1250, 0.68); bytes = out.reduce((a, i) => a + i.data.length, 0); }
  if (bytes > LIMIT) { out = tiles(img, 1000, 0.55); bytes = out.reduce((a, i) => a + i.data.length, 0); }
  if (bytes > LIMIT) { out = out.slice(0, 3); bytes = out.reduce((a, i) => a + i.data.length, 0); }
  return { images: out, bytes, w: img.naturalWidth, h: img.naturalHeight };
}

export default function Page() {
  const [data, setData] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("");
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
    setErr(null); setNote(null); setSelected(null);
    try {
      setBusy("آماده‌سازی تصویر…");
      setPreview(URL.createObjectURL(f));
      const { images, bytes, w, h } = await prepare(f);
      setNote(`${w}×${h} px → ${images.length} تصویر · ${(bytes / 1e6).toFixed(2)} MB ارسال شد`);

      setBusy("در حال خواندن نقشه…");
      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ images, apiKey: apiKey || undefined, model: modelName || undefined }),
      });

      // The function can fail at platform level and return HTML/plain text,
      // so never call resp.json() blind.
      const raw = await resp.text();
      let j = null;
      try { j = JSON.parse(raw); } catch { /* not JSON */ }

      if (!resp.ok || !j) {
        const snippet = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);
        throw new Error(
          j?.error ||
          `پاسخ ${resp.status} از سرور، محتوایش JSON نبود: «${snippet || "خالی"}»` +
          (resp.status === 413 ? " \u2014 فایل بیش از حد بزرگ است." : "") +
          (resp.status === 504 ? " \u2014 تابع تایم‌اوت شد؛ تصویر کوچک‌تری بدهید." : "")
        );
      }

      setData(j.data);
      setEditing(JSON.stringify(j.data, null, 2));
      if (j.usage) setNote((n) => `${n} · ${j.model} · ${j.usage.input_tokens} in / ${j.usage.output_tokens} out`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }

  function loadDemo() {
    setErr(null); setNote(null); setPreview(null); setSelected(null);
    setData(DEMO);
    setEditing(JSON.stringify(DEMO, null, 2));
  }

  function applyEdit() {
    try {
      setData(JSON.parse(editing)); setErr(null); setSelected(null);
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
        {data?.meta?.drawingNo && <span className="chip mono">{data.meta.drawingNo} · REV {data.meta.rev || "?"}</span>}
        {data?.meta?.pipingClass && (
          <span className="chip mono cy">{data.meta.pipingClass} · {data.meta.nps}&quot; · {data.meta.schedule}</span>
        )}
      </header>

      {!data && (
        <section className="intake">
          <div className="drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
            onClick={() => !busy && fileRef.current?.click()}>
            <div className="big">{busy || "نقشه ایزومتریک را اینجا رها کنید"}</div>
            <div className="muted">
              JPG یا PNG · هرچه رزولوشن بالاتر بهتر — تصویر در مرورگر شما به چند کاشی تقسیم و فشرده می‌شود
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
              onChange={(e) => onFile(e.target.files?.[0])} />
          </div>

          <div className="key">
            <label className="muted">کلید Anthropic API (اگر روی Vercel متغیر محیطی گذاشته‌اید خالی بگذارید)</label>
            <input type="password" placeholder="sk-ant-…" value={apiKey}
              onChange={(e) => setApiKey(e.target.value)} className="mono" />
            <label className="muted">نام مدل (اختیاری — پیش‌فرض claude-sonnet-5)</label>
            <input type="text" placeholder="claude-sonnet-5" value={modelName}
              onChange={(e) => setModelName(e.target.value)} className="mono" />
            <button className="ghost" onClick={loadDemo}>نمونه بدون کلید: SW 265022A</button>
          </div>

          {note && <div className="note mono">{note}</div>}
          {err && <div className="err">{err}</div>}

          <ol className="how">
            <li>تصویر در مرورگر به <b>یک نمای کامل + چهار کاشی هم‌پوشان</b> تقسیم می‌شود تا متن ریز BOM خوانده شود و حجم زیر سقف Vercel بماند.</li>
            <li>مدل فقط <b>داده خام</b> برمی‌گرداند: title block، BOM، و مختصات گره‌ها.</li>
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
                  ستون‌های WPS No، Welder ID، NDT Report و Status در CSV خالی گذاشته شده تا QC پر کند.
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
                  «محاسبه» از مختصات گره‌ها و take-out استاندارد B16.9 می‌آید و «نقشه» از BOM و title block.
                  اختلاف زیاد یعنی یک گره یا یک عدد اشتباه خوانده شده — در تب JSON اصلاحش کنید.
                </p>
                {data.unreadable?.length > 0 && (
                  <div className="check warn"><b>! خوانده نشد</b><span className="sm">{data.unreadable.join(" · ")}</span></div>
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
                  <tbody>{(data.nodes || []).map((n, i) => (
                    <tr key={n.id || i}><td className="mono">{n.id}</td><td className="sm">{TYPE_FA[n.type] || n.type}</td>
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
                  <button className="ghost" onClick={() => { setData(null); setPreview(null); setErr(null); setNote(null); }}>نقشه جدید</button>
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
            {note && <div className="note mono">{note}</div>}
            {err && <div className="err">{err}</div>}
          </aside>
        </section>
      )}
    </main>
  );
}
