"use client";
import { useEffect, useRef, useState } from "react";

// the values a template may mark (lib/db/repos/drawing-styles.mjs STYLE_FIELDS), as the form names them
const FIELDS = [
  ["drawingNo", "شمارهٔ نقشه"], ["sheet", "شیت"], ["rev", "رویژن"], ["lineNo", "شمارهٔ خط"], ["lineClass", "کلاس خط"],
  ["designPressure", "فشار طراحی"], ["operatingPressure", "فشار کاری"], ["designTemp", "دمای طراحی"], ["operatingTemp", "دمای کاری"],
  ["testPressure", "فشار تست"], ["testFluid", "سیال تست"], ["ndt", "NDT"], ["pwht", "PWHT"], ["paint", "رنگ"],
  ["insulationType", "نوع عایق"], ["insulationThk", "ضخامت عایق"],
];
const LABEL = Object.fromEntries(FIELDS);

/**
 * A drawing style's template (app/api/drawing-styles; docs/epc-llm/13-style-templates.md):
 * which template the sheet was read by and what it read, and — on the sheet
 * beside — a person marks the cell of each value (two opposite corners), once
 * for the style. Only where each value is printed is kept, never the value:
 * a later sheet of the style is read from those cells, each value kept only
 * when its readings agree.
 */
export default function StyleTemplate({ session, preview, read, sample }) {
  const [styles, setStyles] = useState([]);
  const [fields, setFields] = useState({});
  const [name, setName] = useState("");
  const [field, setField] = useState("lineNo");
  const [first, setFirst] = useState(null);       // the first corner clicked
  const [picking, setPicking] = useState(false);
  const [zoom, setZoom] = useState(2);
  const [msg, setMsg] = useState(null);
  const img = useRef(null);
  const pid = session?.projectId;

  async function load() {
    try {
      const r = await session.call(`/api/drawing-styles?projectId=${pid}`);
      setStyles(r.styles || []);
      // the template this sheet was read by: its cells to start from
      const used = (r.styles || []).find((s) => s.id === read?.template?.id);
      if (used) { setFields(used.fields || {}); setName(used.name); }
    } catch { session.setError?.(null); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (pid) load(); }, [pid, read?.template?.id]);

  function onClick(e) {
    if (!picking || !img.current) return;
    const r = img.current.getBoundingClientRect();
    const p = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height].map((v) => Math.min(1, Math.max(0, v)));
    if (!first) return setFirst(p);
    setFields({ ...fields, [field]: { box: [Math.min(first[0], p[0]), Math.min(first[1], p[1]), Math.max(first[0], p[0]), Math.max(first[1], p[1])] } });
    setFirst(null); setPicking(false);
    // on to the next value not yet marked
    const next = FIELDS.find(([k]) => k !== field && !fields[k]);
    if (next) setField(next[0]);
  }

  async function save() {
    setMsg(null);
    try {
      const r = await session.call("/api/drawing-styles", { method: "POST", body: JSON.stringify({
        projectId: pid, name, fingerprint: read?.fingerprint || [], fields, sample }) });
      setMsg({ ok: true, text: `الگوی «${r.style.name}» با ${Object.keys(r.style.fields).length} خانه ذخیره شد. برگ‌های بعدی همین سبک از این خانه‌ها هم خوانده می‌شوند.` });
      load();
    } catch (e) { setMsg({ ok: false, text: e.message }); session.setError?.(null); }
  }

  async function remove(id) {
    if (!window.confirm("این الگو حذف شود؟")) return;
    try { await session.call(`/api/drawing-styles?projectId=${pid}&id=${id}`, { method: "DELETE" }); load(); }
    catch (e) { setMsg({ ok: false, text: e.message }); session.setError?.(null); }
  }

  const t = read?.template;
  const fromTpl = t ? Object.entries(t.read || {}).filter(([, v]) => v != null) : [];
  return (
    <div className="pane" data-style-template={t ? "applied" : "none"}>
      {read?.style === "generic" && (t ? (
        <p className="note mono" data-template-used={t.name}>
          این برگ با الگوی «{t.name}» هم خوانده شد (شباهت جدول عنوان {Math.round(t.score * 100)}٪) — از خانه‌های الگو: {fromTpl.length
            ? fromTpl.map(([k, v]) => `${LABEL[k] || k} ${v}`).join("، ") : "مقداری با اطمینان خوانده نشد"}.
          {t.conflicts.length > 0 && <span className="err"> مغایرت برچسب و الگو (هیچ‌کدام پذیرفته نشد): {t.conflicts.map((c) => `${LABEL[c.key] || c.key}: ${c.labels} / ${c.template}`).join("، ")}.</span>}
        </p>
      ) : (
        <p className="muted sm">برای این سبک نقشه الگویی ذخیره نشده — اگر مقداری خوانده نشد، خانه‌اش را یک بار روی نقشه نشان دهید تا برگ‌های بعدی همین طراح از همان خانه خوانده شوند.</p>
      ))}
      <details className="intake-more" data-template-teach>
        <summary>الگوی این سبک نقشه — خانهٔ هر مقدار را روی نقشه نشان دهید ({Object.keys(fields).length} خانه)</summary>
        <p className="muted sm">
          فقط جای هر مقدار ذخیره می‌شود، نه خود مقدار: هر برگ، خانهٔ خودش را چند بار می‌خواند و فقط وقتی همه یکی باشند می‌پذیرد.
          کادر را دور خودِ مقدار بکشید، بی برچسبش.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={field} onChange={(e) => setField(e.target.value)} data-template-field>
            {FIELDS.map(([k, l]) => <option key={k} value={k}>{l}{fields[k] ? " ✓" : ""}</option>)}
          </select>
          <button type="button" className="btn sm" data-template-pick onClick={() => { setPicking(true); setFirst(null); }} disabled={!preview}>
            {picking ? (first ? "گوشهٔ مقابل را بزنید…" : "گوشهٔ اول خانه را بزنید…") : "نشان دادن خانه روی نقشه"}
          </button>
          {fields[field] && <button type="button" className="ghost sm" onClick={() => { const f = { ...fields }; delete f[field]; setFields(f); }}>برداشتن خانهٔ {LABEL[field]}</button>}
          <label className="sm">بزرگ‌نمایی <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>{[1, 2, 3, 4].map((z) => <option key={z} value={z}>{z}×</option>)}</select></label>
        </div>
        {preview && (
          <div style={{ overflow: "auto", maxHeight: 520, border: "1px solid var(--line)", marginTop: 8, cursor: picking ? "crosshair" : "default" }}>
            <div style={{ position: "relative", width: `${zoom * 100}%` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={img} src={preview} alt="نقشه" style={{ width: "100%", display: "block" }} onClick={onClick} data-template-sheet />
              {Object.entries(fields).map(([k, f]) => {
                const [x0, y0, x1, y1] = f.box;
                return (<div key={k} data-template-box={k} style={{ position: "absolute", left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%`,
                  border: `2px solid ${k === field ? "var(--accent)" : "var(--warn)"}`, pointerEvents: "none" }}>
                  <span className="sm" style={{ position: "absolute", top: -16, insetInlineStart: 0, background: "var(--bg)", whiteSpace: "nowrap" }}>{LABEL[k]}</span>
                </div>);
              })}
              {first && <div style={{ position: "absolute", left: `${first[0] * 100}%`, top: `${first[1] * 100}%`, width: 8, height: 8, marginLeft: -4, marginTop: -4, background: "var(--accent)", pointerEvents: "none" }} />}
            </div>
          </div>)}
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input dir="auto" placeholder="نام الگو (مثلاً طراح یا پیمانکار)" value={name} onChange={(e) => setName(e.target.value)} data-template-name />
          <button type="button" className="btn" onClick={save} disabled={!name.trim() || !Object.keys(fields).length || !read?.fingerprint?.length} data-template-save>ذخیرهٔ الگو</button>
          {!read?.fingerprint?.length && <span className="muted sm">الگو از برگی ساخته می‌شود که بدون مدل خوانده شده و سبکش ناشناخته است.</span>}
        </div>
        {msg && <p className={msg.ok ? "note sm" : "err sm"} data-template-msg>{msg.text}</p>}
        {styles.length > 0 && (
          <p className="muted sm">الگوهای این پروژه: {styles.map((s) => (
            <span key={s.id} style={{ marginInlineEnd: 10 }}>«{s.name}» ({Object.keys(s.fields || {}).length} خانه){" "}
              <button type="button" className="ghost sm" onClick={() => remove(s.id)}>حذف</button></span>))}</p>)}
      </details>
    </div>
  );
}
