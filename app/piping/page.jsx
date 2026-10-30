"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Viewer3D, { SPOOL_COLORS } from "../../components/Viewer3D";
import WeldMap2D from "../../components/WeldMap2D";
import { exportWorkbook } from "../../lib/excel";
import { buildModel, registerCsv } from "../../lib/engine";
import { DEMO } from "../../lib/demo";
import { TYPE_FA } from "../../lib/standards";
import { sanitize, score, acceptRepair } from "../../lib/extraction/sanitize.mjs";
import { mergePasses } from "../../lib/extraction/merge.mjs";
import { compareReads } from "../../lib/extraction/second-read.mjs";
import { seedFromPass, fromReaderTags, fromEngine, normalize as normalizeMarks, unplaced as unplacedMarks } from "../../lib/sheet/markup.mjs";
import SheetMarkup from "../../components/SheetMarkup";
import { weldListFromMarks } from "../../lib/register/weld-marks.mjs";
import SaveBar from "../../components/SaveBar";
import TabNav from "../../components/TabNav";
import TruthBar from "../../components/TruthBar";
import EquipmentBar from "../../components/EquipmentBar";
import WeldListEntry from "../../components/WeldListEntry";
import CutList from "../../components/CutList";
import LlmEndpoints from "../../components/LlmEndpoints";
import { StageRail } from "../../components/PlatformShell";
import { STAGES } from "../../lib/platform/workflow.mjs";
import ReviewQueue from "../../components/ReviewQueue";
import EditPanel from "../../components/EditPanel";
import { useSession } from "../../lib/client/session.mjs";
import { useProjectData } from "../../lib/client/platform.mjs";
import { prepare, prepareSource } from "../../lib/client/image-prep.mjs";
import { isPdf, openPdf, renderPage } from "../../lib/client/pdf.mjs";
import PdfSheetPicker from "../../components/PdfSheetPicker";
import { base64FromBuffer } from "../../lib/client/base64.mjs";
import { DISCLAIMER_FA } from "../../lib/disclaimer.mjs";

/**
 * For now the isometric is shown as the SHEET with its welds, spools and
 * supports marked on it (components/SheetMarkup.jsx); the 2D weld map and the
 * 3D model are not built. Their code is kept: set this false to bring them back.
 */
const SHEET_MARKUP = true;

export default function Page() {
  const [data, setData] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const [modelName, setModelName] = useState("");
  const [repairModel, setRepairModel] = useState("");
  // a second, independent reading of the sheet; "" = off (it costs two more model calls)
  const [secondModel, setSecondModel] = useState("");
  const [tab, setTab] = useState("weld");
  const [selected, setSelected] = useState(null);
  const [exploded, setExploded] = useState(false);
  const [showTags, setShowTags] = useState(true);
  const [showDims, setShowDims] = useState(false);
  const [view, setView] = useState("iso");
  const [dim, setDim] = useState(SHEET_MARKUP ? "2d" : null);
  const [strictBom, setStrictBom] = useState(true);
  // What the rules said about a register read from the printed joint numbers.
  const [marksInfo, setMarksInfo] = useState(null);
  // How a sheet is read: a model (the three passes), or with no model at all —
  // OpenCV and a local tesseract on this server read the printed weld markers
  // (app/api/read-local, tools/iso-read.py). Remembered on this browser.
  const [reader, setReaderState] = useState("model");
  useEffect(() => { try { const r = localStorage.getItem("epc.isoReader"); if (r === "local" || r === "model") setReaderState(r); } catch { /* ignore */ } }, []);
  const setReader = (r) => { setReaderState(r); try { localStorage.setItem("epc.isoReader", r); } catch { /* ignore */ } };
  const [renderMode, setRenderMode] = useState("solid");
  const [colorBy, setColorBy] = useState("spool");
  const [editing, setEditing] = useState("");
  const [sourceFile, setSourceFile] = useState(null);
  // The run currently open for review, loaded from the server. Null while the
  // page is holding a fresh extraction that has not been saved yet — and that
  // distinction is what decides between "save" and "apply a correction".
  const [openRun, setOpenRun] = useState(null);
  // An isometric PDF is a bundle of sheets, so opening one is two steps:
  // choose the drawing, then extract it.
  const [pdf, setPdf] = useState(null);
  const [pdfPage, setPdfPage] = useState(null);
  const fileRef = useRef(null);
  const session = useSession();
  // the sheet of a saved run, fetched from the server for the review beside it
  const [runSheet, setRunSheet] = useState(null);
  useEffect(() => {
    setRunSheet(null);
    const r = openRun?.run;
    if (!r?.hasFile || !r.documentId || !session.projectId) return;
    let gone = false, url = null;
    (async () => {
      try {
        const res = await fetch(`/api/documents?projectId=${session.projectId}&file=${r.documentId}`, { credentials: "same-origin" });
        if (!res.ok) return;
        const blob = await res.blob();
        const page = openRun.payload?.weldMarkup?.page || 1;
        let src;
        if ((r.fileType || blob.type) === "application/pdf") {
          const { doc } = await openPdf(blob);
          const { canvas } = await renderPage(doc, page, { dpi: 150 });
          src = canvas.toDataURL("image/jpeg", 0.8);
        } else src = url = URL.createObjectURL(blob);
        if (!gone) setRunSheet({ src, page });
      } catch { /* no sheet to show: the rows are reviewed without it */ }
    })();
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [openRun, session.projectId]);
  // where each joint of a saved run stands on site: welded and its NDT accepted, welded, or not yet
  const progress = useMemo(() => openRun?.register?.length
    ? Object.fromEntries(openRun.register.map((w) => [String(w.weld_no).trim(), w.is_accepted ? "done" : w.is_welded ? "inspection" : "open"]))
    : null, [openRun]);


  /* Open a persisted run for review: its payload becomes what is on screen. */
  async function openRunForReview(runId) {
    setErr(null);
    setBusy("خواندن اجرا…");
    try {
      const body = await session.call(`/api/runs/${runId}?projectId=${session.projectId}`);
      setOpenRun(body);
      setData(body.payload);
      setEditing(JSON.stringify(body.payload, null, 2));
      setSelected(null);
      setSourceFile(null);
      setTab("weld");
      if (body.run.engineError) setErr(body.run.engineError);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }

  /* What the server can actually run — see app/api/models/route.js. */
  async function loadModels() {
    try {
      // with the project, so the endpoints its admin registered are listed too
      const res = await fetch(`/api/models${session.projectId ? `?projectId=${session.projectId}` : ""}`, { credentials: "same-origin" });
      const c = await res.json();
      if (!res.ok) throw new Error(c.error || `پاسخ ${res.status}`);
      setCatalogue(c);
      setModelName((m) => m || c.defaultModel);
      setRepairModel((m) => m || c.repairModel || c.defaultModel);
      setErr(null);
    } catch (e) {
      setCatalogue(null);
      setErr("فهرست مدل‌ها خوانده نشد: " + e.message);
    }
  }

  const MODELS = catalogue?.models || [];
  // the models grouped by provider — Claude, Gemini, the in-house server — each saying whether it is set up here
  const PROVIDER_GROUPS = (catalogue?.providers || [{ id: catalogue?.provider, label: catalogue?.provider, configured: catalogue?.configured }])
    .map((p) => ({ ...p, models: MODELS.filter((m) => (m.provider || catalogue?.provider) === p.id) }))
    .filter((p) => p.models.length);
  const modelPicker = (value, set, withNote) => PROVIDER_GROUPS.map((p) => (
    <div key={p.id} className="model-group" data-provider={p.id}>
      <div className="muted sm">{p.label}{p.via === "relay" ? " · از رله" : ""}{p.own ? " · ثبت‌شده در این پروژه" : ""}{p.configured ? "" : " — روی سرور پیکربندی نشده"}</div>
      <div className="models">
        {p.models.map((m) => (
          <button key={m.id} className={value === m.id ? "on" : ""} disabled={!p.configured} data-model={m.id}
            title={p.configured ? undefined : "این ارائه‌دهنده روی سرور تنظیم نشده (کلید یا نشانی)"}
            onClick={() => set(m.id)}>
            <b className="mono">{m.label}</b>
            {withNote && m.note && <span>{m.note}</span>}
          </button>
        ))}
      </div>
    </div>
  ));

  // The project's grade elevation, so the preview can say which welds are
  // buried before anything is saved. Absent, the engine gives no verdict.
  //
  // The grade is chosen by the same rule the database uses: the unit printed
  // in the title block, matched EXACTLY to a declared unit, if that unit
  // overrides the grade; otherwise the project grade. A preview that chose
  // differently would promise one buried count and save another.
  const profile = useProjectData((id) => `/api/project?projectId=${id}`, []);
  const units = useProjectData((id) => `/api/units?projectId=${id}`, []);
  const printedUnit = data?.meta?.unit ? String(data.meta.unit).trim() : null;
  const unitGrade = units.data?.units?.find((u) => u.code === printedUnit)?.grade_elevation_mm ?? null;
  const gradeElevationMm = unitGrade ?? profile.data?.project?.grade_elevation_mm ?? null;
  const gradeSource = unitGrade !== null ? `گرید واحد ${printedUnit}` : "گرید پروژه";
  // A register typed from a weld list has no geometry for the engine to
  // draw: it opens in its own form (components/WeldListEntry.jsx).
  const listed = Array.isArray(data?.weldList);
  const model = useMemo(
    () => (data && !listed ? buildModel(data, { strictBom, gradeElevationMm }) : null),
    [data, listed, strictBom, gradeElevationMm]);
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
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        // the project the model's tokens are accounted to (lib/llm/accounting.mjs)
        body: JSON.stringify({ pass, images, ...extra, projectId: session.projectId,
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

      const verdict = acceptRepair(m, after, base, fixed);
      if (!verdict.accept) return { data: base, ran: true, kept: true, why: verdict.why };
      return { data: fixed, ran: true, notes: r.data.repairNotes || [] };
    } catch (e) {
      return { data: base, ran: true, failed: true, why: e.message };
    }
  }

  async function onFile(f) {
    if (!f) return;
    setErr(null); setNote(null); setSelected(null);

    if (isPdf(f)) {
      try {
        setBusy("خواندن PDF…");
        const { doc, pages } = await openPdf(f);
        setSourceFile(f);
        setPdf({ doc, pages, file: f });
        setBusy("");
        // One sheet needs no choosing.
        if (pages.length === 1) await onPdfPage(1, { doc, pages, file: f });
      } catch (e) {
        setErr("PDF باز نشد: " + e.message);
        setBusy("");
      }
      return;
    }

    if (reader === "local") {
      setErr("خواندن بدون مدل فقط برای فایل PDF است؛ برای تصویر، روش «مدل» را انتخاب کنید یا PDF نقشه را بدهید.");
      return;
    }
    try {
      setBusy("آماده‌سازی تصویر…");
      setSourceFile(f);
      setPreview(URL.createObjectURL(f));
      setPdf(null);
      setPdfPage(null);
      await runExtraction(await prepare(f));
    } catch (e) {
      setErr(e.message);
      setBusy("");
    }
  }

  /**
   * Everything downstream of having tiles: the two passes, the merge, the
   * repair pass and the reporting. Shared, because a sheet rendered from a
   * PDF and a photographed drawing differ only in how the pixels were made.
   */
  async function runExtraction({ images, bytes, w, h, grid, long }, { prefix = "", page = null } = {}) {
    try {
      setNote(`${prefix}${w}×${h} px → شبکه ${grid}×${grid} · ${images.length} کاشی · ${(bytes / 1e6).toFixed(2)} MB`);

      setBusy(secondModel ? "خواندن نقشه — پنج پاس موازی (با خوانش دوم)…" : "خواندن نقشه — سه پاس موازی…");
      const [ra, rb, rc, rs, rn2, rm2] = await Promise.allSettled([
        callPass("meta", images),
        callPass("nodes", images),
        // The joint numbers printed on the sheet, when the designer printed them.
        callPass("welds", images),
        // every numbered marker with its place on the sheet: the marks the person starts from
        callPass("sheetmarks", images),
        // the second reading of the same sheet, by the second reader
        ...(secondModel ? [callPass("nodes", images, 0, {}, secondModel), callPass("meta", images, 0, {}, secondModel)] : []),
      ]);

      if (ra.status === "rejected" && rb.status === "rejected") {
        throw new Error(ra.reason.message);
      }
      const a = ra.status === "fulfilled" ? ra.value : null;
      const b = rb.status === "fulfilled" ? rb.value : null;

      const merged = mergePasses(a, b);

      const fixes = sanitize(merged);
      // Where the two readings disagree, the engine raises it as a check, so the repair pass is shown it.
      let second2 = null;
      if (rn2?.status === "fulfilled") {
        second2 = mergePasses(rm2?.status === "fulfilled" ? rm2.value : null, rn2.value);
        sanitize(second2);
        const cuts2 = rm2?.status === "fulfilled" ? rm2.value?.data?.cutLengths : undefined;
        const cmp = compareReads({ nodes: merged.nodes, bom: merged.bom, cutLengths: a?.data?.cutLengths },
          { nodes: second2.nodes, bom: second2.bom, cutLengths: cuts2 });
        merged.secondRead = { model: rn2.value.model, issues: cmp.issues };
      }
      let final = merged, rep = { ran: false };
      if (a && b) { rep = await repair(merged, images); final = rep.data; }
      sanitize(final);
      // the repair may have changed the geometry: say what still disagrees with the second reading now
      if (second2 && final.secondRead) {
        const cmp2 = compareReads({ nodes: final.nodes, bom: final.bom, cutLengths: a?.data?.cutLengths },
          { nodes: second2.nodes, bom: second2.bom, cutLengths: rm2?.status === "fulfilled" ? rm2.value?.data?.cutLengths : undefined });
        final = { ...final, secondRead: { ...final.secondRead, issues: cmp2.issues } };
      }

      // A sheet whose designer printed every joint: the register is the one
      // printed, read marker by marker and turned into rows by rule
      // (lib/register/weld-marks.mjs). It opens in the weld-list form for a
      // person to complete whatever the drawing did not say.
      const printed = rc.status === "fulfilled" ? rc.value?.data : null;
      let marksNote = "";
      setMarksInfo(null);
      if (printed?.marks?.some((m) => String(m.outline || "").toLowerCase() !== "dashed")) {
        const conv = weldListFromMarks({ ...final, weldMarks: printed },
          { shop: profile.data?.project?.weld_symbol_shop, field: profile.data?.project?.weld_symbol_field,
            thdLabelled: Boolean(profile.data?.project?.weld_thd_labelled) });
        final = { ...final, weldMarks: printed, weldList: conv.weldList };
        setMarksInfo(conv);
        marksNote = ` · رجیستر از ${conv.weldList.length} شمارهٔ جوش چاپ‌شده روی نقشه` +
          (conv.problems.length ? ` · ${conv.problems.join(" ")}` : "") + (conv.notes.length ? ` · ${conv.notes.join(" · ")}` : "");
      }

      // the marks drawn on the sheet start from what the model saw printed on it
      let seedNote = "";
      if (SHEET_MARKUP) {
        if (rs.status === "fulfilled") {
          const seed = seedFromPass(rs.value?.data, { shop: profile.data?.project?.weld_symbol_shop, field: profile.data?.project?.weld_symbol_field });
          final = { ...final, sheetMarkup: { page: page || 1, items: seed.items } };
          seedNote = ` · نشان‌های روی نقشه: ${seed.items.length} پیشنهاد مدل` + (seed.dropped.length ? ` (${seed.dropped.length} مورد بی‌شماره یا بی‌محل کنار گذاشته شد)` : "");
        } else {
          final = { ...final, sheetMarkup: { page: page || 1, items: [] } };
          seedNote = " · نشان‌های چاپی از نقشه خوانده نشد";
        }
        // a sheet with no weld numbers printed: the engine's welds, each where the model saw its node drawn
        if (!final.sheetMarkup.items.some((m) => m.kind.startsWith("weld"))) {
          const eng = fromEngine(buildModel(final, { strictBom, gradeElevationMm }), final.nodes, w / h, final.bom);
          final = { ...final, sheetMarkup: { ...final.sheetMarkup, items: normalizeMarks([...final.sheetMarkup.items, ...eng.items]) } };
          seedNote += ` · ${eng.items.length} سرجوش موتور روی نقشه گذاشته شد` + (eng.missing.length ? `، ${eng.missing.length} جا نیفتاد (گره‌اش روی نقشه دیده نشد) — از فهرست بگذارید` : "");
        }
      }

      setData(final);
      setEditing(JSON.stringify(final, null, 2));
      setOpenRun(null);

      // A half-failure is recoverable: open the editor on the missing half.
      if (!a || !b) {
        setTab("json");
        setErr((!a ? ra.reason.message : rb.reason.message) +
          `\n\nنیمه دیگر استخراج شد. ${!b ? "گره‌ها" : "title block و BOM"} را در همین تب دستی وارد و «اعمال» بزنید.`);
      }

      const tok = (x) => (x && x.usage ? `${x.usage.input_tokens || "?"}/${x.usage.output_tokens || "?"}` : "?");
      setNote(`${prefix}${w}×${h} px · شبکه ${grid}×${grid} · ${images.length} کاشی · ${(bytes / 1e6).toFixed(2)} MB · ` +
        `${(a || b).model} · meta ${a ? (a.ms / 1000).toFixed(1) + "s " + tok(a) : "ناموفق"} · ` +
        `nodes ${b ? (b.ms / 1000).toFixed(1) + "s " + tok(b) : "ناموفق"}` +
        (fixes.length ? ` · اصلاح خودکار: ${fixes.join(" · ")}` : "") +
        (rep.ran
          ? rep.failed ? ` · پاس اصلاح ناموفق (${rep.why || "?"})`
            : rep.kept ? ` · پاس اصلاح رد شد (${rep.why}) — نسخه اول نگه داشته شد`
              : ` · پاس اصلاح اعمال شد${rep.notes?.length ? `: ${rep.notes.join(" ")}` : ""}`
          : " · همه چک‌ها پاس") + marksNote + seedNote +
        (secondModel
          ? rn2?.status !== "fulfilled" ? " · خوانش دوم ناموفق (نتیجهٔ خوانش اول بدون مقایسه)"
            : final.secondRead?.issues?.length ? ` · خوانش دوم (${final.secondRead.model}): ${final.secondRead.issues.length} اختلاف`
              : ` · خوانش دوم (${final.secondRead?.model}): هم‌خوان` : ""));
      if (long < 2200) {
        setErr(`رزولوشن منبع ${w}×${h} px است. برای خواندن مطمئن BOM و ابعاد ریز، ضلع بلند حداقل ۲۵۰۰ px لازم است — ترجیحاً اسکن ۳۰۰ DPI از PDF اصلی. نتیجه فعلی را حتماً در تب JSON بازبینی کنید.`);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }

  /** Render one sheet of an open PDF, then run the same pipeline an image takes. */
  async function onPdfPage(index, source = pdf) {
    if (!source) return;
    setErr(null); setNote(null); setSelected(null);
    if (reader === "local") return readLocal(index, source);
    try {
      setBusy(`رندر برگ ${index} در ۳۰۰ DPI…`);
      const { canvas, effectiveDpi } = await renderPage(source.doc, index, { dpi: 300 });
      setPreview(canvas.toDataURL("image/jpeg", 0.6));
      setPdfPage(index);
      await runExtraction(prepareSource(canvas), {
        prefix: `برگ ${index} · ${effectiveDpi} DPI · `, page: index,
      });
    } catch (e) {
      setErr(e.message);
      setBusy("");
    }
  }

  /**
   * Read one sheet with no model: the server finds the weld frames and reads
   * their numbers (OpenCV + tesseract). What comes back is what a model's
   * `welds` pass returns — number, frame shape, outline, label — and goes
   * through the same rules (lib/register/weld-marks.mjs) into the weld-list
   * form, where a person completes size, type and spool. The title block's
   * isometric number, sheet and revision prefill the form when they were
   * read for certain; the BOM is not read here.
   */
  async function readLocal(index, source) {
    try {
      setBusy(`خواندن برگ ${index} بدون مدل (OCR روی سرور)…`);
      // the sheet the rows are reviewed beside: sharp enough to read a weld number at a zoom
      const { canvas } = await renderPage(source.doc, index, { dpi: 150 });
      setPreview(canvas.toDataURL("image/jpeg", 0.8));
      setPdfPage(index);
      const pdfBase64 = base64FromBuffer(new Uint8Array(await source.file.arrayBuffer()));
      const r = await session.call("/api/read-local", { method: "POST",
        body: JSON.stringify({ projectId: session.projectId, pdfBase64, page: index }) });
      const title = r.meta || {};
      const meta = { drawingNo: title.drawingNo || "", rev: title.rev || "", sheet: title.sheet || "", lineNo: "", unit: "", pipingClass: "", nps: null, schedule: "" };
      // which reader produced the markers travels with them: the review says so, and the saved run keeps
      // it, with what the title block read (OCR, for a person to check — not verified data)
      const weldMarks = { marks: r.marks.map(({ at, ...m }) => m), reader: "local", readerVersion: r.reader, titleRead: title };
      // where each number was read on the sheet, for the review beside it; a person moves or adds the rest
      const placed = Object.fromEntries(r.marks.filter((m) => Array.isArray(m.at) && String(m.outline || "").toLowerCase() !== "dashed")
        .map((m) => [String(m.no).trim(), { x: m.at[0], y: m.at[1], src: "reader" }]));
      const conv = weldListFromMarks({ meta, bom: [], weldMarks },
        { shop: profile.data?.project?.weld_symbol_shop, field: profile.data?.project?.weld_symbol_field,
          thdLabelled: Boolean(profile.data?.project?.weld_thd_labelled) });
      // the spool numbers (ovals) and support numbers (hexagons) the reader found, to be moved or corrected on the sheet
      const tags = fromReaderTags(r.tags);
      const final = { meta, bom: [], nodes: [], edges: [], notes: [], weldMarks, weldList: conv.weldList,
        ...(Object.keys(placed).length ? { weldMarkup: { page: index, marks: placed } } : {}),
        ...(tags.length ? { sheetMarkup: { page: index, items: tags } } : {}) };
      setMarksInfo(conv);
      setData(final);
      setEditing(JSON.stringify(final, null, 2));
      setOpenRun(null);
      setNote(`برگ ${index} · بدون مدل و بدون توکن · ${(r.ms / 1000).toFixed(1)}s · ${r.marks.length} نشانگر جوش` + (tags.length ? ` · ${tags.filter((t) => t.kind === "spool").length} اسپول · ${tags.filter((t) => t.kind === "support").length} ساپورت` : "") +
        (r.orientation ? ` · صفحه ${r.orientation}° چرخانده شد` : "") +
        (conv.problems.length ? ` · ${conv.problems.join(" ")}` : "") + (conv.notes.length ? ` · ${conv.notes.join(" · ")}` : ""));
    } catch (e) {
      setErr(e.message);
      // session.call already put the same message in the model box above; once is enough
      session.setError(null);
    } finally {
      setBusy("");
    }
  }

  function loadDemo() {
    setErr(null); setNote(null); setPreview(null); setSelected(null); setSourceFile(null);
    setOpenRun(null);
    setData(DEMO);
    setEditing(JSON.stringify(DEMO, null, 2));
  }

  /**
   * The drawing is here but no model read it (none configured, or the read
   * failed): the register is keyed by hand, in the JSON tab, and saved with
   * THIS file — the engine still computes every weld. Nothing is prefilled:
   * a drawing number guessed from a file name would be a fact nobody read.
   */
  function manualEntry() {
    const blank = { meta: { drawingNo: "", rev: "", sheet: "1/1", lineNo: "", unit: "", pipingClass: "", nps: null, schedule: "" },
      bom: [], nodes: [], edges: [], notes: [] };
    setErr(null); setNote(null); setPdf(null); setOpenRun(null); setSelected(null);
    setData(blank);
    setEditing(JSON.stringify(blank, null, 2));
    setTab("json");
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
    <main dir="rtl" className="page">
      <div className="pagehead">
        <h1>پایپینگ</h1>
        <span className="sub">ایزومتریک ← مدل سه‌بعدی ← رجیستر جوش</span>
        <span className="grow" />
        {data?.meta?.drawingNo && <span className="chip mono">{data.meta.drawingNo} · REV {data.meta.rev || "?"}</span>}
        {data?.meta?.pipingClass && (
          <span className="chip mono cy">{data.meta.pipingClass} · {data.meta.nps}&quot; · {data.meta.schedule}</span>
        )}
      </div>
      {/* The stage is derived from what is actually true right now rather
          than tracked separately, so it cannot drift out of step with the
          screen: a saved-and-approved run is approved, a saved one is under
          review, a computed one is extracted, an engine error is failed. */}
      <StageRail stage={
        model?.error ? STAGES.FAILED
        : openRun?.run?.status === "approved" ? STAGES.APPROVED
        : openRun ? STAGES.IN_REVIEW
        : data ? STAGES.EXTRACTED
        : STAGES.DRAFT
      } />

      {!data && (
        <section className="intake">
          <div className="ask">
            {!SHEET_MARKUP && <div className="ask-q">با کدام نما شروع کنیم؟</div>}
            {!SHEET_MARKUP && <div className="ask-opts">
              <button className={dim === "2d" ? "on" : ""} onClick={() => setDim("2d")}>
                <b>نقشه دوبعدی</b>
                <span>تصویر ایزومتریک با تگ جوش — همان چیزی که QC چاپ می‌کند. خروجی SVG برداری.</span>
              </button>
              <button className={dim === "3d" ? "on" : ""} onClick={() => setDim("3d")}>
                <b>مدل سه‌بعدی</b>
                <span>چرخش آزاد، حالت شفاف و تک‌خط، اسپول باز. برای بررسی مسیر و تداخل.</span>
              </button>
            </div>}
            <label className="chk">
              <input type="checkbox" checked={strictBom} onChange={(e) => setStrictBom(e.target.checked)} />
              <span>فقط اقلامی رسم شود که در MTO وجود دارند
                <em>اتصالی که هیچ ردیفی در لیست متریال ندارد از طراحی حذف و گزارش می‌شود</em>
              </span>
            </label>
          </div>

          <div className="iso-reader" data-reader={reader}>
            <span className="muted sm">روش خواندن نقشه:</span>
            <label className="sm"><input type="radio" name="iso-reader" value="model" checked={reader === "model"}
              onChange={() => setReader("model")} /> مدل هوش مصنوعی (کلید API، توکن)</label>
            <label className="sm"><input type="radio" name="iso-reader" value="local" checked={reader === "local"}
              onChange={() => setReader("local")} /> بدون مدل — OCR روی همین سرور، بدون توکن (فقط PDF)</label>
            {reader === "local" && <span className="muted sm">شمارهٔ جوش، شکل قاب و برچسب THD/FFW/BR خوانده می‌شود؛ شمارهٔ نقشه، قطر، نوع اتصال و اسپول را شخص در فرم کامل می‌کند.</span>}
          </div>

          <div className={"drop" + (dim ? "" : " locked")}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (dim) onFile(e.dataTransfer.files?.[0]); }}
            onClick={() => dim && !busy && fileRef.current?.click()}>
            <div className="big">{busy || (dim ? "نقشه ایزومتریک را اینجا رها کنید (PDF یا تصویر)" : "اول نما را انتخاب کنید")}</div>
            <div className="muted">
              PDF · JPG · PNG — PDF برداری بهترین ورودی است و در ۳۰۰ DPI رندر می‌شود. تقسیم به کاشی و فشرده‌سازی در مرورگر شما انجام می‌شود، پس فایل اصلی جایی نمی‌رود
            </div>
            <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden
              onChange={(e) => onFile(e.target.files?.[0])} />
          </div>

          <div className="key">
            <label className="muted">
              مدل استخراج — کلید API روی سرور نگه داشته می‌شود (Environment یا ثبت‌شده در همین صفحه) و هرگز به مرورگر برنمی‌گردد
            </label>
            <div className="row">
              <button className="ghost" onClick={() => loadModels()}>خواندن مدل‌ها</button>
            </div>
            <LlmEndpoints session={session} onChange={() => loadModels()} />
            {session.error && <div className="err">{session.error}</div>}

            {catalogue && (
              <>
                <div className="note mono" data-providers>
                  ارائه‌دهنده‌ها: {(catalogue.providers || []).map((p) => `${p.label}${p.configured ? " ✓" : " (تنظیم نشده)"}`).join(" · ") || catalogue.provider}
                </div>
                <label className="muted">مدل استخراج</label>
                {modelPicker(modelName, setModelName, true)}
                <label className="muted">
                  مدل پاس اصلاح — فقط وقتی چک‌ها نخوانند اجرا می‌شود؛ خروجی‌اش کوچک است
                  پس ارتقا به مدل قوی‌تر تقریباً رایگان است؛ می‌تواند از ارائه‌دهندهٔ دیگری باشد
                </label>
                {modelPicker(repairModel, setRepairModel, false)}
                <label className="muted">
                  خوانش دوم — نقشه را یک‌بار دیگر (گره‌ها و BOM) با مدل دیگری می‌خواند و هر عددی را که دو خوانش
                  یکی نخواندند نام می‌برد؛ دو پاس بیشتر هزینه دارد. مدل متفاوت از مدل استخراج بگذارید
                </label>
                <div data-second-reader>
                  <div className="models"><button className={secondModel === "" ? "on" : ""} data-second-off onClick={() => setSecondModel("")}><b>خاموش</b></button></div>
                  {modelPicker(secondModel, setSecondModel, false)}
                </div>
              </>
            )}
            <button className="ghost" disabled={!dim} onClick={loadDemo}>نمونه بدون سرور: SW 265022A</button>
          </div>

          {note && <div className="note mono">{note}</div>}
          {err && <div className="err">{err}</div>}
          {sourceFile && !busy && (
            <div className="row">
              <button className="ghost" onClick={manualEntry}>ورود دستی (JSON) برای همین نقشه</button>
              <span className="muted sm">«{sourceFile.name}» همراه رجیستر ذخیره می‌شود؛ هندسه و MTO را در تب JSON بنویسید یا بچسبانید — جوش‌ها را باز هم موتور می‌سازد.</span>
            </div>
          )}

          {pdf && pdf.pages.length > 1 && !data && (
            <div className="queuebox">
              <PdfSheetPicker doc={pdf.doc} pages={pdf.pages} busy={!!busy}
                onPick={(i) => onPdfPage(i)} />
            </div>
          )}

          {session.projectId && (
            <div className="queuebox">
              <div className="ask-q">صف بازبینی</div>
              <ReviewQueue session={session} onOpen={openRunForReview}
                currentRunId={openRun?.run?.id} />
            </div>
          )}

          {/* An equipment list is usually the FIRST document on a project —
              it often arrives before a single isometric is issued. Putting
              it only behind the drawing tabs would make it unreachable at
              exactly the moment it is useful. */}
          {/* No drawing to extract, but a weld map or its Excel: the register
              is typed or read from the list, and checked the same way. */}
          <details className="intake-more" id="weld-list-entry">
            <summary>فهرست جوش دارید؟ سرجوش‌ها را دستی یا از فایل Excel وارد کنید</summary>
            <WeldListEntry session={session} onSaved={openRunForReview} />
          </details>

          <details className="intake-more">
            <summary>لیست تجهیزات دارید؟ تگ‌ها و زیرسیستم‌ها را همین‌جا بخوانید</summary>
            <EquipmentBar />
          </details>

          <ol className="how">
            <li>تصویر در مرورگر به <b>یک نمای کامل + چهار کاشی هم‌پوشان</b> تقسیم می‌شود تا متن ریز BOM خوانده شود و حجم زیر سقف Vercel بماند.</li>
            <li>مدل فقط <b>داده خام</b> برمی‌گرداند: title block، BOM، و مختصات گره‌ها.</li>
            <li>موتور قطعی، take-out استاندارد B16.9 را اعمال و <b>سرجوش‌گذاری</b> را تولید می‌کند — نه مدل زبانی.</li>
            <li>سه چک متقاطع اجرا می‌شود؛ اگر نخواند، هشدار می‌بینید و می‌توانید JSON را اصلاح کنید.</li>
          </ol>
        </section>
      )}

      {data && listed && (
        // one column: the weld list (and the drawing beside its rows) takes the page's width
        <section className="stage listed">
          {data.weldMarks && marksInfo && (
            <div className="pane" data-weld-marks>
              {data.weldMarks.reader === "local" ? (<>
                <p className="note mono" data-reader="local">
                  رجیستر از {marksInfo.weldList.length} شمارهٔ جوش چاپ‌شده روی نقشه — خوانده‌شده بدون مدل و بدون توکن (OCR روی سرور):
                  شماره، شکل قاب و برچسب کنار آن؛ محل از نماد اعلام‌شدهٔ پروژه تعیین شد. قطر، نوع اتصال و اسپول را تکمیل کنید.
                </p>
                <p className="note mono" data-title-read>
                  جدول عنوان (OCR، پیش از ذخیره بررسی کنید): {[["drawingNo", "شمارهٔ نقشه"], ["sheet", "شیت"], ["rev", "رویژن"]].map(([k, l]) =>
                    `${l} ${data.weldMarks.titleRead?.[k] || "خوانده نشد"}`).join(" · ")}
                </p>
              </>) : (
                <p className="note mono">
                  رجیستر از {marksInfo.weldList.length} شمارهٔ جوش چاپ‌شده روی نقشه — مدل فقط شماره و شکل قاب را خواند؛
                  محل از نماد اعلام‌شدهٔ پروژه و نوع از BOM همین برگ تعیین شد. جای خالی را تکمیل کنید.
                </p>
              )}
              {marksInfo.problems.map((x) => <p key={x} className="err sm">{x}</p>)}
              {marksInfo.notes.map((x) => <p key={x} className="muted sm">{x}</p>)}
            </div>
          )}
          <div className="pane">
            <WeldListEntry key={openRun?.run?.id || "new"} session={session} initial={data} run={openRun}
              sheet={openRun ? runSheet : preview ? { src: preview, page: pdfPage || 1, file: sourceFile } : null}
              progress={openRun ? progress : null}
              onSaved={openRunForReview} onClose={() => { setData(null); setOpenRun(null); }} />
          </div>
          {data.weldMarks && (
            <details className="pane">
              <summary>مقایسه با رجیستر پیمانکار (حقیقت مرجع) — همان‌طور که از نقشه خوانده شد</summary>
              <TruthBar data={data} computed={data.weldList.map((r) => ({
                no: r.no, loc: r.loc || null, kind: r.kind || null, nps: Number(r.nps) || null }))} />
            </details>
          )}
        </section>
      )}

      {data && !listed && (
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
          ) : SHEET_MARKUP ? (
            <div className="canvas" data-sheet-stage style={{ overflow: "auto", padding: 12 }}>
              <SheetMarkup src={openRun ? runSheet?.src : preview}
                items={data.sheetMarkup?.items || []}
                unplaced={unplacedMarks(model.register, model.spoolIds, data.sheetMarkup?.items || [])}
                onSeedEngine={(aspect) => {
                  // the engine's welds again, where the model saw their nodes: what a person placed or kept stays
                  const kept = (data.sheetMarkup?.items || []).filter((m) => m.src !== "engine");
                  const eng = fromEngine(model, data.nodes, aspect, data.bom).items.filter((m) => !kept.some((k) => k.kind.startsWith("weld") && k.no === m.no));
                  const next = { ...data, sheetMarkup: { page: data.sheetMarkup?.page || pdfPage || 1, items: normalizeMarks([...kept, ...eng]) } };
                  setData(next);
                  setEditing(JSON.stringify(next, null, 2));
                }}
                fileName={`${data.meta?.drawingNo || "iso"}-${data.meta?.sheet || "1"}-marked`.replace(/[^\w.-]+/g, "_")}
                onChange={(items) => {
                  const next = { ...data, sheetMarkup: { page: data.sheetMarkup?.page || pdfPage || 1, items: normalizeMarks(items) } };
                  setData(next);
                  setEditing(JSON.stringify(next, null, 2));
                }} />
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
                <button className={strictBom ? "on wide" : "wide"} onClick={() => setStrictBom(!strictBom)}
                  title="اقلام خارج از MTO رسم نشوند">فقط اقلام MTO</button>
              </div>
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
            <TabNav tab={tab} setTab={setTab} model={model} data={data} />

            {tab === "weld" && !model.error && (
              <div className="pane">
                <div className="tot mono">
                  {model.totals.welds} جوش · {model.spoolIds.length} اسپول ·
                  لوله {(model.totals.pipeLen / 1000).toFixed(2)} m ·
                  CL {(model.totals.clCalc / 1000).toFixed(2)} m
                  {model.totals.girth > 0 ? ` · ${model.totals.girth} girth` : ""}
                  {model.totals.buried === null
                    ? " · زیرزمینی: تراز گرید ثبت نشده"
                    : ` · ${model.totals.buried} زیرزمینی / ${model.totals.aboveGround} روزمینی (${gradeSource})`}
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
                  <button className="ghost" onClick={() => exportWorkbook(model, data)}>دانلود Excel (۶ شیت)</button>
                  <button className="ghost" onClick={download}>CSV</button>
                </div>
                <SaveBar session={session} data={data} model={model} sourceFile={sourceFile}
                  strictBom={strictBom} onSaved={openRunForReview} />
                <p className="muted sm">
                  ستون‌های WPS No، Welder ID، NDT Report و Status در CSV خالی گذاشته شده تا QC پر کند.
                </p>
                <div className="disclaimer">{DISCLAIMER_FA}</div>
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

            {tab === "cut" && !model.error && <CutList model={model} data={data} />}

            {tab === "review" && (
              <div className="pane">
                {openRun ? (
                  <>
                    <div className="tot mono">
                      {openRun.run.docNo} · REV {openRun.run.revision} · {openRun.run.status}
                    </div>
                    <EditPanel session={session} run={openRun} edited={editing}
                      onApplied={() => openRunForReview(openRun.run.id)} />
                  </>
                ) : (
                  <>
                    <p className="muted sm">
                      این نقشه هنوز در سامانه ذخیره نشده است. اول از تب سرجوش ذخیره‌اش کنید،
                      یا یک اجرای موجود را از صف بازبینی باز کنید.
                    </p>
                    <ReviewQueue session={session} onOpen={openRunForReview} />
                  </>
                )}
              </div>
            )}

            {tab === "equip" && <EquipmentBar />}
            {tab === "truth" && <TruthBar model={model} data={data} />}

            {tab === "json" && (
              <div className="pane">
                <textarea className="mono" value={editing} onChange={(e) => setEditing(e.target.value)} spellCheck={false} />
                <div className="row">
                  <button className="ghost" onClick={applyEdit}>اعمال محلی</button>
                  <button className="ghost" onClick={() => {
                    setData(null); setPreview(null); setErr(null); setNote(null); setOpenRun(null);
                  }}>نقشه جدید</button>
                </div>
                {openRun && (
                  <p className="muted sm">
                    «اعمال محلی» فقط نمای همین مرورگر را تازه می‌کند. برای ثبت اصلاح روی سرور —
                    با لاگ فیلدبه‌فیلد — به تب <b>بازبینی</b> بروید.
                  </p>
                )}
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
