"use client";
import { useMemo, useRef, useState } from "react";
import Viewer3D, { SPOOL_COLORS } from "../components/Viewer3D";
import WeldMap2D from "../components/WeldMap2D";
import { exportWorkbook } from "../lib/excel";
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

const ROW = ["TOP", "MIDDLE", "BOTTOM"];
const COL = ["LEFT", "CENTRE", "RIGHT"];

/* A dense A1 sheet loses its BOM text if sent whole — the vision model downsamples
   anything past ~1568 px. So crop a grid: the finer the source, the finer the grid. */
function tiles(img, max, quality, grid) {
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const n = grid;
  const ox = (W / n) * 0.14, oy = (H / n) * 0.14;
  const defs = [["FULL SHEET", 0, 0, W, H]];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const sx = Math.max(0, (W / n) * c - ox);
      const sy = Math.max(0, (H / n) * r - oy);
      defs.push([
        `${n === 2 ? ROW[r * 2] : ROW[r]}-${n === 2 ? COL[c * 2] : COL[c]} TILE`,
        sx, sy, W / n + ox * 2, H / n + oy * 2,
      ]);
    }
  }
  return defs.map(([label, sx, sy, sw, sh]) => ({
    label, mediaType: "image/jpeg",
    data: renderCrop(img, sx, sy, Math.min(sw, W - sx), Math.min(sh, H - sy), max, quality),
  }));
}

const MODELS = [
  { id: "claude-opus-5", label: "Opus 5", note: "دقیق‌ترین — برای نقشه‌های شلوغ" },
  { id: "claude-sonnet-5", label: "Sonnet 5", note: "پیش‌فرض — تعادل دقت و سرعت" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", note: "سریع — فقط برای نقشه‌های ساده" },
];
const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_REPAIR = "claude-opus-5";   // repair output is small, so escalate freely

const LIMIT = 3_400_000; // keep well under the 4.5 MB body cap

async function prepare(file) {
  const img = await loadImage(file);
  const long = Math.max(img.naturalWidth, img.naturalHeight);
  const grid = long >= 3200 ? 3 : 2;          // 10 tiles for a real scan, 5 for a photo
  const sum = (o) => o.reduce((a, i) => a + i.data.length, 0);
  let out = tiles(img, 1500, 0.82, grid);
  if (sum(out) > LIMIT) out = tiles(img, 1350, 0.7, grid);
  if (sum(out) > LIMIT) out = tiles(img, 1150, 0.58, grid);
  if (sum(out) > LIMIT && grid === 3) out = tiles(img, 1400, 0.75, 2);
  if (sum(out) > LIMIT) out = out.slice(0, 3);
  return { images: out, bytes: sum(out), w: img.naturalWidth, h: img.naturalHeight, grid, long };
}

/* Cheap deterministic guards that no model can talk its way past. */
function sanitize(d) {
  const notes = [];
  d.meta = d.meta || {};
  const bomSizes = [...new Set((d.bom || []).map((b) => Number(b.diam)).filter((n) => n > 0))]
    .sort((a, b) => b - a);
  if (bomSizes.length) {
    const n = Number(d.meta.nps);
    if (!n || !bomSizes.includes(n)) {
      notes.push(`nps از ${n || "خالی"} به ${bomSizes[0]}" اصلاح شد (ستون DIAM در MTO)`);
      d.meta.nps = bomSizes[0];
    }
    (d.edges || []).forEach((e) => { if (!bomSizes.includes(Number(e.nps))) e.nps = d.meta.nps; });
  }
  const before = (d.nodes || []).length;
  const seen = new Set();
  d.nodes = (d.nodes || []).filter((n) => {
    if (![n.E, n.N, n.EL].every((v) => typeof v === "number" && isFinite(v))) return false;
    const k = `${n.E}|${n.N}|${n.EL}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  if (d.nodes.length !== before) notes.push(`${before - d.nodes.length} گره تکراری یا بی‌مختصات حذف شد`);
  const ids = new Set(d.nodes.map((n) => n.id));
  if (Array.isArray(d.edges)) d.edges = d.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  return notes;
}

/* error counts far more than a warning — a repair that breaks the model is never an improvement */
const score = (m) => (m.error ? 1000 : 0) + ((m.checks || []).filter((c) => c.status === "warn").length);

export default function Page() {
  const [data, setData] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState(DEFAULT_MODEL);
  const [repairModel, setRepairModel] = useState(DEFAULT_REPAIR);
  const [tab, setTab] = useState("weld");
  const [selected, setSelected] = useState(null);
  const [exploded, setExploded] = useState(false);
  const [showTags, setShowTags] = useState(true);
  const [showDims, setShowDims] = useState(false);
  const [view, setView] = useState("iso");
  const [dim, setDim] = useState("3d");
  const [renderMode, setRenderMode] = useState("solid");
  const [colorBy, setColorBy] = useState("spool");
  const [editing, setEditing] = useState("");
  const fileRef = useRef(null);

  const model = useMemo(() => (data ? buildModel(data) : null), [data]);
  const sel = model && !model.error ? model.register.find((w) => w.no === selected) : null;

  /* One serverless invocation per pass. Passes run in parallel so total wall
     time is the slower of the two, not their sum — that is what keeps each
     invocation inside Vercel's function duration limit. */
  async function callPass(pass, images, attempt = 0, extra = {}, overrideModel) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 115000);
    try {
      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({ pass, images, ...extra, apiKey: apiKey || undefined,
          model: overrideModel || modelName || undefined }),
      });
      const raw = await resp.text();
      let j = null;
      try { j = JSON.parse(raw); } catch { /* platform error page, not JSON */ }

      if (!resp.ok || !j) {
        const snippet = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
        if ((resp.status === 504 || resp.status === 502) && attempt === 0 && !(j && j.raw)) {
          return callPass(pass, images, 1, extra, overrideModel);
        }
        throw new Error(
          ((j && j.error) ||
            `پاس «${pass}» \u2014 پاسخ ${resp.status}: «${snippet || "خالی"}»` +
            (resp.status === 504
              ? " \u2014 تابع تایم‌اوت شد. روی پلن Hobby سقف ۶۰ ثانیه است؛ دکمه «مدل سریع» را بزنید."
              : "")) +
          (j && j.raw ? `\n\nخروجی خام مدل:\n${j.raw}` : "")
        );
      }
      return j;
    } catch (e) {
      if (e.name === "AbortError") throw new Error(`پاس «${pass}» بیش از ۱۱۵ ثانیه طول کشید و لغو شد.`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function repair(base, images) {
    const m = buildModel(base);
    const issues = m.error
      ? [m.error]
      : (m.checks || []).filter((c) => c.status === "warn").map((c) => `${c.label}: ${c.detail}`);
    if (!issues.length) return { data: base, ran: false };

    setBusy(`چک‌ها نخواندند — پاس اصلاح با ${MODELS.find((x) => x.id === repairModel)?.label || repairModel}…`);
    try {
      const r = await callPass("repair", images, 0, { json: base, issues }, repairModel);
      const fixed = { ...base, ...r.data };
      sanitize(fixed);
      const after = buildModel(fixed);

      // Accept ONLY a strict improvement that keeps the geometry intact.
      // The old guard read an empty `checks` array on a broken model as "zero
      // warnings" and happily accepted a repair that had deleted the route.
      const lostGeometry = (fixed.nodes || []).length < (base.nodes || []).length;
      const tooFew = (fixed.nodes || []).length < 2;
      const better = score(after) < score(m);

      if (tooFew || lostGeometry || !better) {
        return { data: base, ran: true, kept: true,
          why: tooFew ? "نتیجه کمتر از دو گره داشت"
            : lostGeometry ? "پاس اصلاح گره حذف کرده بود"
              : "چک‌ها بهتر نشدند" };
      }
      return { data: fixed, ran: true, notes: r.data.repairNotes || [] };
    } catch (e) {
      return { data: base, ran: true, failed: true, why: e.message };
    }
  }

  async function onFile(f) {
    if (!f) return;
    setErr(null); setNote(null); setSelected(null);
    try {
      setBusy("آماده‌سازی تصویر…");
      setPreview(URL.createObjectURL(f));
      const { images, bytes, w, h, grid, long } = await prepare(f);
      setNote(`${w}×${h} px → شبکه ${grid}×${grid} · ${images.length} کاشی · ${(bytes / 1e6).toFixed(2)} MB`);

      setBusy("خواندن نقشه — دو پاس موازی…");
      const [ra, rb] = await Promise.allSettled([
        callPass("meta", images),
        callPass("nodes", images),
      ]);

      if (ra.status === "rejected" && rb.status === "rejected") {
        throw new Error(ra.reason.message);
      }
      const a = ra.status === "fulfilled" ? ra.value : null;
      const b = rb.status === "fulfilled" ? rb.value : null;

      const merged = {
        meta: { ...((a && a.data.meta) || {}), nps: (b && b.data.nps) ?? (a && a.data.meta?.nps) },
        bom: (a && a.data.bom) || [],
        nodes: (b && b.data.nodes) || [],
        notes: (a && a.data.notes) || [],
        unreadable: [...((a && a.data.unreadable) || []), ...((b && b.data.unreadable) || [])],
      };

      const fixes = sanitize(merged);
      let final = merged, rep = { ran: false };
      if (a && b) { rep = await repair(merged, images); final = rep.data; }
      sanitize(final);

      setData(final);
      setEditing(JSON.stringify(final, null, 2));

      // A half-failure is recoverable: open the editor on the missing half.
      if (!a || !b) {
        setTab("json");
        setErr((!a ? ra.reason.message : rb.reason.message) +
          `\n\nنیمه دیگر استخراج شد. ${!b ? "گره‌ها" : "title block و BOM"} را در همین تب دستی وارد و «اعمال» بزنید.`);
      }

      const tok = (x) => (x && x.usage ? `${x.usage.input_tokens || "?"}/${x.usage.output_tokens || "?"}` : "?");
      setNote(`${w}×${h} px · شبکه ${grid}×${grid} · ${images.length} کاشی · ${(bytes / 1e6).toFixed(2)} MB · ` +
        `${(a || b).model} · meta ${a ? (a.ms / 1000).toFixed(1) + "s " + tok(a) : "ناموفق"} · ` +
        `nodes ${b ? (b.ms / 1000).toFixed(1) + "s " + tok(b) : "ناموفق"}` +
        (fixes.length ? ` · اصلاح خودکار: ${fixes.join(" · ")}` : "") +
        (rep.ran
          ? rep.failed ? ` · پاس اصلاح ناموفق (${rep.why || "?"})`
            : rep.kept ? ` · پاس اصلاح رد شد (${rep.why}) — نسخه اول نگه داشته شد`
              : ` · پاس اصلاح اعمال شد${rep.notes?.length ? `: ${rep.notes.join(" ")}` : ""}`
          : " · همه چک‌ها پاس"));
      if (long < 2200) {
        setErr(`رزولوشن منبع ${w}×${h} px است. برای خواندن مطمئن BOM و ابعاد ریز، ضلع بلند حداقل ۲۵۰۰ px لازم است — ترجیحاً اسکن ۳۰۰ DPI از PDF اصلی. نتیجه فعلی را حتماً در تب JSON بازبینی کنید.`);
      }
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
            <label className="muted">مدل استخراج</label>
            <div className="models">
              {MODELS.map((m) => (
                <button key={m.id} className={modelName === m.id ? "on" : ""}
                  onClick={() => setModelName(m.id)}>
                  <b className="mono">{m.label}</b>
                  <span>{m.note}</span>
                </button>
              ))}
            </div>
            <label className="muted">
              مدل پاس اصلاح — فقط وقتی چک‌ها نخوانند اجرا می‌شود؛ خروجی‌اش کوچک است
              پس ارتقا به مدل قوی‌تر تقریباً رایگان است
            </label>
            <div className="models">
              {MODELS.map((m) => (
                <button key={m.id} className={repairModel === m.id ? "on" : ""}
                  onClick={() => setRepairModel(m.id)}>
                  <b className="mono">{m.label}</b>
                </button>
              ))}
            </div>
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

      {data && (
        <section className="stage">
          {model.error ? (
            <div className="canvas empty">
              <div>
                <div className="big">هندسه ناقص است</div>
                <p className="muted sm">{model.error}</p>
                <p className="muted sm">
                  در تب JSON، آرایه <code>nodes</code> را کامل کنید: هر گره یک <code>type</code>
                  (tie-in / elbow90 / elbow45 / tee / reducer / flange-wn / valve-bw) و مختصات
                  <code>E</code>، <code>N</code>، <code>EL</code> بر حسب میلی‌متر می‌خواهد،
                  به ترتیب مسیر از یک سر خط تا سر دیگر.
                </p>
              </div>
            </div>
          ) : (
            <div className="canvas">
            {dim === "3d" ? (
              <Viewer3D model={model} selected={selected} onSelect={setSelected}
                exploded={exploded} showTags={showTags} showDims={showDims} view={view}
                renderMode={renderMode} colorBy={colorBy} />
            ) : (
              <WeldMap2D model={model} meta={data.meta} selected={selected} onSelect={setSelected}
                showDims={showDims} colorBy={colorBy} />
            )}
            <div className="ctl">
              <div className="row seg">
                {[["3d", "سه‌بعدی"], ["2d", "نقشه ۲بعدی"]].map(([k, t]) => (
                  <button key={k} className={dim === k ? "on" : ""} onClick={() => setDim(k)}>{t}</button>
                ))}
              </div>
              {dim === "3d" && (
                <>
                  <div className="row">
                    {[["iso", "ایزو"], ["elev", "نما"], ["plan", "پلان"]].map(([k, t]) => (
                      <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{t}</button>
                    ))}
                  </div>
                  <div className="row">
                    {[["solid", "توپر"], ["xray", "شفاف"], ["wire", "مش"], ["centerline", "تک‌خط"]].map(([k, t]) => (
                      <button key={k} className={renderMode === k ? "on" : ""} onClick={() => setRenderMode(k)}>{t}</button>
                    ))}
                  </div>
                </>
              )}
              <div className="row">
                <span className="lbl">رنگ:</span>
                {[["spool", "اسپول"], ["size", "قطر"], ["none", "خنثی"]].map(([k, t]) => (
                  <button key={k} className={colorBy === k ? "on" : ""} onClick={() => setColorBy(k)}>{t}</button>
                ))}
              </div>
              {dim === "3d" && (
                <button className={exploded ? "on wide" : "wide"} onClick={() => setExploded(!exploded)}>اسپول باز</button>
              )}
              {dim === "3d" && (
                <button className={showTags ? "on wide" : "wide"} onClick={() => setShowTags(!showTags)}>تگ جوش</button>
              )}
              <button className={showDims ? "on wide" : "wide"} onClick={() => setShowDims(!showDims)}>ابعاد</button>
            </div>
            <div className="legend">
              {colorBy === "size"
                ? [...new Set(model.elements.map((e) => e.nps || model.nps))].sort((a, b) => b - a).map((n, i) => (
                    <span key={n}><i style={{ background: SPOOL_COLORS[i % SPOOL_COLORS.length] }} />
                      <b className="mono">{n}&quot;</b></span>
                  ))
                : colorBy === "spool" && model.spoolIds.map((id, i) => (
                <span key={id}><i style={{ background: SPOOL_COLORS[i % SPOOL_COLORS.length] }} /><b className="mono">{id}</b></span>
              ))}
              <span className="sep" />
              <span><i className="dot" style={{ background: "#FF6B4A" }} />سایت ({model.totals.field})</span>
              <span><i className="dot" style={{ background: "#CFDDE6" }} />کارگاه ({model.totals.shop})</span>
            </div>
            <div className="hint">{dim === "3d"
              ? "بکشید تا بچرخد · اسکرول یا پینچ زوم · روی حلقه جوش بزنید"
              : "بکشید تا جابه‌جا شود · اسکرول زوم · روی تگ جوش بزنید"}</div>
          </div>
          )}

          <aside>
            <nav>
              {[["weld", "سرجوش"], ["check", "اعتبارسنجی"], ["line", "Line Data"], ["mto", "MTO"], ["json", "JSON"]]
                .map(([k, t]) => (
                  <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t}</button>
                ))}
            </nav>

            {tab === "weld" && !model.error && (
              <div className="pane">
                <div className="tot mono">
                  {model.totals.welds} جوش · {model.spoolIds.length} اسپول ·
                  لوله {(model.totals.pipeLen / 1000).toFixed(2)} m ·
                  CL {(model.totals.clCalc / 1000).toFixed(2)} m
                  {model.totals.girth > 0 ? ` · ${model.totals.girth} girth` : ""}
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
                <div className="row">
                  <button className="ghost" onClick={() => exportWorkbook(model, data)}>دانلود Excel (۵ شیت)</button>
                  <button className="ghost" onClick={download}>CSV</button>
                </div>
                <p className="muted sm">
                  ستون‌های WPS No، Welder ID، NDT Report و Status در CSV خالی گذاشته شده تا QC پر کند.
                  درصد NDT پیش‌فرض بر مبنای ASME B31.3 §341.4.1 برای Normal Fluid Service است؛ Piping Class پروژه حاکم است.
                </p>
              </div>
            )}

            {tab === "check" && !model.error && (
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
                <p className="muted sm">
                  اگر هندسه ناقص ماند، معمولاً سریع‌ترین راه این است که آرایه <code>nodes</code> را
                  خودتان از روی نقشه بنویسید: هر گره یک <code>type</code> و مختصات
                  <code>E</code>/<code>N</code>/<code>EL</code> بر حسب میلی‌متر، به ترتیب مسیر.
                  مختصات دو سر خط روی نقشه چاپ شده‌اند؛ گره‌های میانی از ابعاد جاری درمی‌آیند.
                  موتور بقیه را خودش می‌سازد.
                </p>
                {preview && <img src={preview} alt="نقشه آپلودشده" className="thumb" />}
              </div>
            )}

            {sel && !model.error && (
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
