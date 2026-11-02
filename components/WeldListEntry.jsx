"use client";
import { useMemo, useRef, useState } from "react";
import TemplateButton from "./ui/TemplateButton";
import BomForm from "./BomForm";
import TableKit from "./ui/TableKit";
import Pick, { useValueLists } from "./ui/Pick";
import { COLUMN_LIST } from "../lib/register/value-lists.mjs";
import SaveBar from "./SaveBar";
import RegistryCheck from "./RegistryCheck";
import BomWelds from "./BomWelds";
import WorkspaceFrame from "./workspace/WorkspaceFrame";
import WorkspaceTabs from "./workspace/WorkspaceTabs";
import Explorer from "./workspace/Explorer";
import MarkForm from "./MarkForm";
import { STATE_COLORS } from "./SheetReview";
import SheetMarkup from "./SheetMarkup";
import MarkTables from "./MarkTables";
import EquipmentTable from "./EquipmentTable";
import IsoInfo from "./IsoInfo";
import { cutVsBom } from "../lib/register/cut-bom.mjs";
import { itemsFromWeldRows, weldRowsFromItems, withRowIds, registerRow, rowTyped } from "../lib/sheet/weld-list-marks.mjs";
import { normalize as normalizeMarks, addMark, updateMark, placeAt } from "../lib/sheet/markup.mjs";
import { usage } from "../lib/register/bom-allocation.mjs";
import { parseDelimited, guessMapping, normalizeLoc } from "../lib/truth/parse.mjs";
import { LIST_PATTERNS, modelFromWeldList } from "../lib/register/weld-list.mjs";
import { splitWeldLog, weldLogSheetName } from "../lib/register/weld-log-import.mjs";

/**
 * A weld register from a weld list: typed row by row, or read from the
 * weld map's Excel / CSV — for a sheet with no geometry to extract.
 *
 * What is entered is user-provided data and is saved as such. The server
 * checks it with the same function this page previews with
 * (lib/register/weld-list.mjs), refuses a list that is not a register row
 * by row, and never fills a blank; an engineer approves it like any other.
 *
 * `initial` and `run` are set when a saved list is opened from the review
 * queue: its rows come back for correction (saving again makes a new run
 * of the same sheet), and an engineer can approve it here.
 *
 * `sheet` ({ src, page }) puts the drawing beside the rows: each weld's mark where its number was
 * read or where a person put it, kept with the payload as `weldMarkup`;
 * each row ticked once a person has checked it against the drawing
 * (`reviewed`), and saving with rows unticked asks first. `progress`
 * ({ [weldNo]: "done" | "inspection" | "open" }) colours a saved sheet by
 * where each joint stands on site.
 *
 * With the drawing beside it, the form is the engine's sheet (SheetMarkup,
 * MarkTables): one table of welds, spools and supports, each row joined to
 * its mark on the sheet by the buttons at its end, a leader from every
 * mark to its place on the pipe, and the plain number in each frame. The
 * rows are still the register (lib/sheet/weld-list-marks.mjs). A saved
 * sheet paints each weld by where its joint stands on site.
 */
const COLS = [
  ["no", "شمارهٔ جوش", "W-01"],
  ["spool", "اسپول", "SP-01"],
  ["loc", "محل (Shop / Field)", "Shop"],
  ["kind", "نوع (BW، SW، Tie-in…)", "BW"],
  ["nps", "قطر NPS", ""],
  ["schedule", "Sch / ضخامت", "40S"],
  ["material", "جنس", "A312-TP304"],
  ["wps", "WPS", ""],
  ["ref", "اتصال به (برای Tie-in)", ""],
];
const BLANK_ROW = { no: "", spool: "", loc: "", kind: "", nps: "", schedule: "", material: "", wps: "", ref: "" };
// the line data of the title block, as the reader (tools/iso-read.py read_line_data) names it
const LINE_DATA = [
  ["lineNo", "شمارهٔ خط"], ["lineClass", "کلاس خط"], ["designPressure", "فشار طراحی"], ["operatingPressure", "فشار کاری"],
  ["designTemp", "دمای طراحی"], ["operatingTemp", "دمای کاری"], ["testFluid", "سیال تست"], ["testPressure", "فشار تست"],
  ["insulationType", "نوع عایق"], ["insulationThk", "ضخامت عایق"], ["paint", "رنگ"], ["ndt", "NDT"], ["pwht", "PWHT"],
];
const BLANK_META = { drawingNo: "", rev: "", sheet: "1/1", lineNo: "", unit: "", pipingClass: "", nps: "", schedule: "" };
export default function WeldListEntry({ session, initial = null, run = null, onSaved, onClose, sheet = null, progress = null, sheets = null, styleTab = null }) {
  const lists = useValueLists();
  const [meta, setMeta] = useState({ ...BLANK_META, ...(initial?.meta || {}) });
  const [rows, setRowsRaw] = useState(() => withRowIds(initial?.weldList?.length ? initial.weldList.map((r) => ({ ...BLANK_ROW, ...r })) : [{ ...BLANK_ROW }, { ...BLANK_ROW }, { ...BLANK_ROW }]));
  // every row keeps an id of its own: its mark on the sheet is the same thing
  const setRows = (rs) => setRowsRaw(withRowIds(rs));
  const [file, setFile] = useState(null);
  // the workspace panel's tab: the register once there are marks, else the sheet's identity to settle first
  const [wsTab, setWsTab] = useState(() => (initial?.weldList?.length ? "welds" : "info"));
  const [paste, setPaste] = useState("");
  const [read, setRead] = useState(null);
  const [approval, setApproval] = useState({ phase: "idle" });
  // a weld log of many drawings (Piping.Tools, this platform's Weld Log, a contractor's register): one sheet is loaded at a time
  const [log, setLog] = useState(null);
  // the drawing beside the rows: where each weld is on it, and which rows a person has checked against it
  const [marks, setMarks] = useState(() => ({ ...(initial?.weldMarkup?.marks || {}) }));
  const [reviewed, setReviewed] = useState(() => new Set(initial?.reviewed || []));
  // the line data and the BOM read off the sheet (OCR, for a person to check): kept with the payload
  const [lineData, setLineData] = useState(() => (initial?.lineData ? { ...initial.lineData } : null));
  // the sheet's BOM as read, corrected and completed here by a person (a row the OCR did not read, a
  // quantity, a size): it is what is saved as the sheet's BOM, and what its welds are counted from
  const [bomRows, setBomRows] = useState(() => (Array.isArray(initial?.bom) ? initial.bom.map((b) => ({ ...b })) : []));
  const bom = useMemo(() => bomRows.map((b) => ({ ...b,
    pt: b.pt === "" || b.pt == null ? null : Number(b.pt),
    qty: b.qty === "" || b.qty == null || !Number.isFinite(Number(b.qty)) ? null : Number(b.qty) })), [bomRows]);
  const setBom = (i, k, v) => setBomRows(bomRows.map((b, j) => (j === i ? { ...b, [k]: v } : b)));
  const [bomForm, setBomForm] = useState(null);  // { mode: "view"|"edit"|"create", i } — the BOM row's form
  // the first PT number missing from the run, else the next one
  const nextBomPt = () => {
    const pts = new Set(bom.map((b) => b.pt).filter(Number.isInteger));
    const last = pts.size ? Math.max(...pts) : 0;
    return Array.from({ length: last }, (_, i) => i + 1).find((n) => !pts.has(n)) ?? last + 1;
  };
  const cutLengths = Array.isArray(initial?.cutLengths) ? initial.cutLengths : [];
  // the spool numbers (oval) and support numbers (hexagon) marked on the sheet, kept with the payload
  const [extras, setExtras] = useState(() => normalizeMarks(initial?.sheetMarkup?.items).filter((m) => m.kind === "spool" || m.kind === "support"));

  const typed = rows.filter(rowTyped).map(registerRow);
  // A list read from the drawing's printed markers keeps what the model read
  // (weldMarks) beside what was completed by hand — the evidence for each row.
  const nos = typed.map((r) => String(r.no ?? "").trim()).filter(Boolean);
  const keptMarks = Object.fromEntries(Object.entries(marks).filter(([no]) => nos.includes(no)));
  const keptReviewed = nos.filter((no) => reviewed.has(no));
  const data = useMemo(() => ({ meta: { ...meta, nps: meta.nps === "" ? null : Number(meta.nps) }, weldList: typed,
    ...(initial?.weldMarks ? { weldMarks: initial.weldMarks } : {}),
    // the page of the file the sheet is, kept even with nothing placed yet: a PDF of many sheets opens on this one
    ...(Object.keys(keptMarks).length || sheet ? { weldMarkup: { page: sheet?.page ?? initial?.weldMarkup?.page ?? 1, marks: keptMarks } } : {}),
    ...(keptReviewed.length ? { reviewed: keptReviewed } : {}),
    ...(lineData && Object.values(lineData).some((v) => String(v ?? "").trim()) ? { lineData } : {}),
    ...(bom.length ? { bom } : {}),
    ...(cutLengths.length ? { cutLengths } : {}),
    ...(extras.length ? { sheetMarkup: { page: sheet?.page ?? initial?.sheetMarkup?.page ?? 1, items: extras } } : {}) }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [meta, typed, initial, JSON.stringify(keptMarks), keptReviewed.join("|"), sheet?.page, JSON.stringify(extras), JSON.stringify(lineData), JSON.stringify(bom)]);
  const model = useMemo(() => (typed.length ? modelFromWeldList(data) : { error: "هنوز جوشی وارد نشده است." }), [data, typed.length]);

  const setCell = (i, k, v) => {
    // a weld renumbered keeps its place on the drawing and its tick
    if (k === "no") {
      const was = String(rows[i]?.no ?? "").trim(), now = String(v ?? "").trim();
      if (was && now && was !== now && marks[was] && !marks[now]) { const m = { ...marks, [now]: marks[was] }; delete m[was]; setMarks(m); }
      if (was && reviewed.has(was)) { const r = new Set(reviewed); r.delete(was); setReviewed(r); }
    }
    setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  };
  const tick = (no, on) => { const r = new Set(reviewed); if (on) r.add(no); else r.delete(no); setReviewed(r); };
  const unchecked = nos.filter((no) => !reviewed.has(no));
  const beforeSave = async () => !sheet || !unchecked.length
    || window.confirm(`${unchecked.length} جوش هنوز با نقشه بررسی نشده (${unchecked.slice(0, 8).join("، ")}${unchecked.length > 8 ? "، …" : ""}). همین حالا ذخیره شود؟`);
  const onMeta = (k) => (e) => setMeta({ ...meta, [k]: e.target.value });

  // the drawing beside the rows, as the engine's sheet is drawn (one table, a leader on every mark)
  const locked = run?.run?.status === "approved";
  const sheetMode = Boolean(sheet);
  const [markSel, setMarkSel] = useState(null);
  // «edit» from the sheet's menu: the welds tab, the mark's row in focus
  const [editFocus, setEditFocus] = useState(null);
  // a mark is viewed, edited and added in its form (components/MarkForm.jsx), from the tables and from the sheet's menu alike
  const [form, setForm] = useState(null);   // { mode, id, kind, point, aspect }
  const tabOf = (k) => (k === "equipment" ? "equip" : k === "spool" ? "spools" : k === "support" ? "supports" : "welds");
  const openForm = (mode, id, kind, point = null, aspect = Math.SQRT2) => {
    const k = kind || itemsRef.current.find((m) => m.id === id)?.kind;
    if (id) { setMarkSel(id); setEditFocus((f) => ({ id, n: (f?.n || 0) + 1 })); }
    setWsTab(tabOf(k));
    setForm({ mode: locked ? "view" : mode, id, kind: k, point, aspect });
  };
  const editMark = (id, kind) => openForm("edit", id, kind);
  // layers of the sheet (a view setting): toggled from the navigator
  const [hiddenLayers, setHiddenLayers] = useState(() => new Set());
  const toggleLayer = (k) => setHiddenLayers((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const [attachId, setAttachId] = useState(null);
  const items = useMemo(() => (sheetMode ? itemsFromWeldRows(rows, marks, extras) : []), [sheetMode, rows, marks, extras]);
  const itemsRef = useRef(items); itemsRef.current = items;
  // who uses what of this sheet's BOM: the welds' ends against each row's (lib/register/bom-allocation.mjs)
  const alloc = useMemo(() => usage(items, bom), [items, bom]);
  // a saved sheet: each weld painted by where its joint stands on site
  const progressStates = progress ? Object.fromEntries(items.filter((m) => m.kind.startsWith("weld")).map((m) => {
    const st = progress[m.no] || "open";
    return [m.id, { state: st, color: STATE_COLORS[st] }];
  })) : null;
  function onItems(next) {
    const got = weldRowsFromItems(next, rows);
    // a weld renumbered is not checked any more under its new number
    const was = new Map(rows.map((r) => [r._id, String(r.no ?? "").trim()]));
    const r = new Set(reviewed);
    for (const row of got.rows) { const old = was.get(row._id); if (old && old !== row.no) r.delete(old); }
    for (const [id, old] of was) if (old && !got.rows.some((x) => x._id === id)) r.delete(old);
    setReviewed(r);
    setRowsRaw(got.rows.length ? got.rows : withRowIds([{ ...BLANK_ROW }]));
    setMarks(got.marks);
    setExtras(got.extras);
  }

  /** Header row + rows, however they arrived: the columns are found by name, never by position. */
  function fromText(text, source) {
    const { headers, rows: raw, suspectDelimiter } = parseDelimited(text);
    if (!headers.length) return setRead({ error: `${source}: خالی است.` });
    if (suspectDelimiter) return setRead({ error: `${source}: ستون‌ها از هم جدا نشدند — از Excel کپی کنید یا CSV بدهید.` });
    const { mapping, unmapped } = guessMapping(headers, LIST_PATTERNS, raw);
    if (mapping.no == null) return setRead({ error: `${source}: ستون «شمارهٔ جوش» (Weld No) پیدا نشد. سرستون‌ها: ${headers.join("، ")}` });
    const got = raw.map((r) => Object.fromEntries(COLS.map(([k]) => [k, mapping[k] == null ? "" : String(r[mapping[k]] ?? "").trim()])))
      .filter((r) => r.no)
      // «کارگاه» / «Site» / «F» read as the register says them; an unreadable one stays as typed, and the check names it.
      .map((r) => ({ ...r, loc: normalizeLoc(r.loc) || r.loc }));
    setRows(got.length ? got : [{ ...BLANK_ROW }]);
    setRead({ source, rows: got.length, found: Object.keys(mapping).map((k) => `${COLS.find((c) => c[0] === k)[1]} ← «${headers[mapping[k]]}»`), unmapped });
  }

  async function onSheet(f) {
    if (!f) return;
    setRead(null);
    try {
      if (/\.(xlsx?|xlsm)$/i.test(f.name)) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
        const name = weldLogSheetName(wb.SheetNames);
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
        const split = splitWeldLog(aoa);
        // a log that names its drawings: pick the sheet to load
        if (!split.error && split.groups.some((g) => g.drawingNo)) return openLog({ aoa, source: `«${f.name}» (برگ ${name})`, byLine: false });
        fromText(XLSX.utils.sheet_to_csv(wb.Sheets[name]), `«${f.name}» (برگ ${name})`);
      } else fromText(await f.text(), `«${f.name}»`);
    } catch (e) { setRead({ error: `«${f.name}»: ${e.message}` }); }
  }

  function openLog({ aoa, source, byLine }) {
    const split = splitWeldLog(aoa, { byLine });
    setLog({ aoa, source, byLine, ...split });
    setRead(null);
  }
  function loadGroup(key) {
    const g = log.groups.find((x) => x.key === key);
    if (!g) return;
    setRows(g.rows.map((r) => ({ ...BLANK_ROW, ...r, loc: normalizeLoc(r.loc) || r.loc })));
    setMeta({ ...meta, drawingNo: g.drawingNo || meta.drawingNo, sheet: g.sheet || meta.sheet, rev: g.rev || meta.rev, lineNo: g.lineNo || meta.lineNo });
    setRead({ source: `${log.source} · ${g.drawingNo} ${g.sheet}${log.byLine && g.lines[0] ? ` · ${g.lines[0]}` : ""}`, rows: g.rows.length,
      found: Object.entries(log.found).map(([k, h]) => `${COLS.find((c) => c[0] === k)[1]} ← «${h}»`), unmapped: log.unmapped });
  }

  async function approve() {
    setApproval({ phase: "busy" });
    try {
      const { run: r } = await session.call(`/api/runs/${run.run.id}/approve`, { method: "POST", body: JSON.stringify({ projectId: session.projectId }) });
      setApproval({ phase: "done", msg: `تأیید شد · ${r.approved_sha256.slice(0, 12)}…` });
      onSaved?.(run.run.id);
    } catch (e) { setApproval({ phase: "error", msg: e.message }); }
  }

  const approved = run?.run?.status === "approved";
  const metaGrid = (
    <>
      <div className="wl-grid">
        {[["drawingNo", "شمارهٔ نقشه (ISO)", true], ["rev", "رویژن", true], ["sheet", "شیت"], ["lineNo", "شمارهٔ خط"],
          ["unit", "واحد"], ["pipingClass", "کلاس لوله"], ["nps", "قطر پیش‌فرض NPS"], ["schedule", "Schedule"]].map(([k, label, req]) => (
          <label key={k} className="wl-f">
            <span className="muted sm">{label}{req && " *"}</span>
            {COLUMN_LIST[k]
              ? <Pick id={`wl-${k}`} list={COLUMN_LIST[k]} lists={lists} value={meta[k]} onChange={(v) => setMeta({ ...meta, [k]: v })} />
              : <input id={`wl-${k}`} dir="ltr" value={meta[k] ?? ""} onChange={onMeta(k)} required={req} />}
          </label>
        ))}
      </div>

    </>
  );
  const registryBlock = (
    <>
      {!run && <RegistryCheck session={session} meta={meta} lineData={lineData} />}

    </>
  );
  const lineDataBlock = (
    <>
      {lineData && (
        <details className="intake-more" open data-line-data>
          <summary>مشخصات خط (Line Data) — خوانده‌شده با OCR از title block؛ با نقشه بررسی کنید</summary>
          <div className="wl-grid">
            {LINE_DATA.map(([k, label]) => (
              <label key={k} className="wl-f">
                <span className="muted sm">{label}</span>
                {COLUMN_LIST[k]
                  ? <Pick data-line={k} list={COLUMN_LIST[k]} lists={lists} value={lineData[k]} placeholder="خوانده نشد" empty="خوانده نشد" disabled={locked}
                    onChange={(v) => setLineData({ ...lineData, [k]: v })} />
                  : <input data-line={k} dir="ltr" value={lineData[k] ?? ""} placeholder="خوانده نشد" disabled={locked}
                    onChange={(e) => setLineData({ ...lineData, [k]: e.target.value })} />}
              </label>
            ))}
          </div>
        </details>)}
    </>
  );
  const bomBlock = (
    <>
      {bom.length > 0 && (
        <details className="intake-more" data-bom={bom.length}>
          <summary>BOM همین برگ — {bom.length} ردیف، خوانده‌شده با OCR؛ با نقشه بررسی و اصلاح کنید (همین جدول با رجیستر ذخیره می‌شود)</summary>
          <div style={{ overflowX: "auto" }}>
            <TableKit name="iso-bom"><table className="dtable">
              <thead><tr><th>PT</th><th>گروه</th><th>شرح</th><th>N.S.</th><th>کد کالا</th><th>تعداد</th><th>واحد</th><th title="سرهای جوشی‌شدنی این ردیف که سرجوش‌ها نام برده‌اند">سر جوش: رزرو/ظرفیت</th><th></th></tr></thead>
              <tbody>{bomRows.map((b, i) => (
                <tr key={i} data-bom-row={b.pt}>
                  <td className="mono b" dir="ltr" data-bom-cell="pt">{b.pt ?? "—"}</td>
                  <td className="sm" data-bom-cell="group">{b.group || "—"}</td>
                  <td className="sm" dir="ltr" data-bom-cell="description">{b.description || "—"}</td>
                  <td className="mono" data-bom-cell="diam">{b.diam || "؟"}</td>
                  <td className="mono sm" dir="ltr" data-bom-cell="stockCode">{b.stockCode || "—"}</td>
                  <td className="mono" dir="ltr" data-bom-cell="qty">{b.qty === "" || b.qty == null ? "؟" : b.qty}</td>
                  <td className="sm" data-bom-cell="qtyUnit">{b.qtyUnit === "pcs" ? "عدد" : b.qtyUnit === "m" ? "m" : "؟"}</td>
                  <td className="mono sm" data-bom-alloc={b.pt} dir="ltr">{(() => { const u = alloc.get(String(b.pt)); if (!u) return "—"; if (u.cap.mode === "length") return "طولی"; if (u.cap.mode === "none") return u.used ? `${u.used}/۰` : "—"; return u.cap.capacity == null ? (u.used ? `${u.used}/؟` : "؟") : `${u.used}/${u.cap.capacity}`; })()}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="ghost sm" data-bom-view={b.pt} onClick={() => setBomForm({ mode: "view", i })}>مشاهده</button>
                    {!locked && <button type="button" className="ghost sm" data-bom-edit={b.pt} onClick={() => setBomForm({ mode: "edit", i })}>ویرایش</button>}
                    {!locked && <button type="button" className="ghost sm" onClick={() => setBomRows(bomRows.filter((_, j) => j !== i))}>حذف</button>}
                  </td>
                </tr>))}</tbody>
            </table></TableKit>
          </div>
          {!locked && <button type="button" className="ghost sm" data-bom-add onClick={() => setBomForm({ mode: "create", i: -1 })}>+ ردیف BOM (ردیفی که خوانده نشده)</button>}
        </details>)}
      {bomForm && (
        <BomForm key={`${bomForm.mode}-${bomForm.i}`} mode={bomForm.mode} lists={lists} readOnly={locked} rows={bomRows}
          row={bomForm.i >= 0 ? bomRows[bomForm.i] : { pt: nextBomPt() }}
          onClose={() => setBomForm(null)}
          onSave={(r) => {
            setBomRows(bomForm.i >= 0 ? bomRows.map((x, j) => (j === bomForm.i ? r : x)) : [...bomRows, r].sort((a, b) => (Number(a.pt) || 0) - (Number(b.pt) || 0)));
            setBomForm(null);
          }} />)}

    </>
  );
  const bomWeldsBlock = (
    <>
      {bom.length > 0 && <BomWelds bom={bom} welds={typed} />}

    </>
  );
  const cutBom = useMemo(() => cutVsBom(cutLengths, bom), [cutLengths, bom]);
  const SZ = (n) => (n == null ? "؟" : `${n}"`);
  const cutBlock = (
    <>
      {cutLengths.length > 0 && (
        <div className="cut-bom" data-cut-bom>
          <b className="sm">برش در برابر BOM</b>
          <TableKit name="iso-cut-bom"><table className="dtable">
            <thead><tr><th>قطر</th><th>قطعه</th><th>جمع برش (m)</th><th>لولهٔ BOM (m)</th><th>وضعیت</th></tr></thead>
            <tbody>{cutBom.sizes.map((z) => (
              <tr key={String(z.size)} data-cut-size={z.size ?? "?"} data-cut-status={z.status}>
                <td className="mono" dir="ltr">{SZ(z.size)}</td><td className="mono">{z.pieces}</td><td className="mono">{z.cutM}</td>
                <td className="mono">{z.bomM ?? "—"}</td>
                <td className={z.status === "ok" ? "ok sm" : "sm warnish"}>{{ ok: "هم‌خوان", over: "برش بیش از BOM", noBom: "ردیف لولهٔ BOM نیست", noSize: "قطر خوانده نشد" }[z.status]}</td>
              </tr>))}</tbody>
          </table></TableKit>
          {cutBom.problems.length > 0 && <ul className="sm" data-cut-problems style={{ margin: "6px 0", paddingInlineStart: 18 }}>{cutBom.problems.map((x) => <li key={x} className="err">{x}</li>)}</ul>}
        </div>)}
      {cutLengths.length > 0 && (
        <details className="intake-more" data-cut-lengths={cutLengths.length}>
          <summary>جدول برش لوله (CUT PIPE LENGTH) — {cutLengths.length} قطعه، خوانده‌شده با OCR؛ با نقشه بررسی کنید</summary>
          <TableKit name="iso-cut-read"><table className="dtable">
            <thead><tr><th>قطعه</th><th>طول برش (mm)</th><th>N.S.</th></tr></thead>
            <tbody>{cutLengths.map((c) => (
              <tr key={c.piece} data-cut-row={c.piece}><td className="mono">&lt;{c.piece}&gt;</td><td className="mono">{c.lengthMm}</td><td className="mono" dir="ltr">{c.ns ?? "؟"}</td></tr>))}</tbody>
          </table></TableKit>
        </details>)}

    </>
  );
  const importBlock = (
    <>
      <details className="intake-more" open={!initial}>
        <summary>خواندن از فایل (Excel / CSV) یا چسباندن از Excel</summary>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <input id="wl-file" type="file" accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt" onChange={(e) => onSheet(e.target.files?.[0])} />
          <TemplateButton kind="weldList" className="ghost" />
        </div>
        <textarea id="wl-paste" rows={4} dir="ltr" value={paste} onChange={(e) => setPaste(e.target.value)}
          placeholder={"Weld No\tSpool No\tShop/Field\tWeld Type\tNPS\nW-01\t\tField\tTie-in\t3"} style={{ width: "100%", minHeight: 0, height: 90 }} />
        <button className="ghost" type="button" disabled={!paste.trim()} onClick={() => fromText(paste, "متن چسبانده‌شده")}>خواندن متن</button>
        {log && (
          <div className="wl-log" data-weld-log={log.groups.length}>
            <p className="note sm">{log.source}: {log.groups.length} برگ نقشه، {log.groups.reduce((n, g) => n + g.rows.length, 0)} جوش. یک برگ را برای این رجیستر انتخاب کنید؛ هر برگ رجیستر خودش است.</p>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              <select id="wl-group" defaultValue="" onChange={(e) => loadGroup(e.target.value)}>
                <option value="" disabled>— برگ نقشه —</option>
                {log.groups.map((g) => <option key={g.key} value={g.key}>
                  {g.drawingNo || "بدون شمارهٔ نقشه"} · برگ {g.sheet || "؟"}{log.byLine && g.lines[0] ? ` · ${g.lines[0]}` : ""} · {g.rows.length} جوش{!log.byLine && g.lines.length > 1 ? ` · ${g.lines.length} خط` : ""}
                </option>)}
              </select>
              {log.hasLine && <label className="sm"><input id="wl-byline" type="checkbox" checked={log.byLine}
                onChange={(e) => openLog({ aoa: log.aoa, source: log.source, byLine: e.target.checked })} /> هر برگ به تفکیک خط (ستون System)</label>}
            </div>
            {!log.byLine && log.groups.some((g) => g.lines.length > 1) && (
              <p className="muted sm">برگی که جوش‌های چند خط را زیر یک شمارهٔ نقشه آورده، احتمالاً چند نقشه را یکی کرده است — شماره‌های تکراری را بررسی بالا نشان می‌دهد. تفکیک به خط را امتحان کنید.</p>)}
          </div>)}
        {read?.error && <p className="err">{read.error}</p>}
        {read?.rows != null && (
          <p className="note sm">
            {read.source}: {read.rows} جوش خوانده شد · {read.found.join(" · ")}
            {read.unmapped.length > 0 && <> · بدون ستون: {read.unmapped.map((k) => COLS.find((c) => c[0] === k)[1]).join("، ")}</>}
          </p>
        )}
      </details>

    </>
  );
  const datalists = (
    <>
      <datalist id="wl-locs"><option value="Shop" /><option value="Field" /></datalist>
      <datalist id="wl-kinds"><option value="BW" /><option value="SW" /><option value="Tie-in" /><option value="Closure" /><option value="Branch" /></datalist>
    </>
  );
  const summaryBlock = (
    <>
      {model.problems ? (
        <div className="err" role="alert"><b>{model.problems.length} ایراد — تا رفع نشود ذخیره نمی‌شود:</b>
          <ul>{model.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
      ) : model.register ? (
        <p className="note mono">
          {model.totals.welds} جوش · کارگاه {model.totals.shop} · سایت {model.totals.field} ·
          اسپول‌ها: {model.spoolIds.join("، ") || "—"}
        </p>
      ) : <p className="muted sm">{model.error}</p>}

    </>
  );
  const fileBlock = (
    <>
      <label className="wl-f">
        <span className="muted sm">فایل نقشه (اختیاری) — PDF همین شیت، اگر دارید، همراه رجیستر ذخیره می‌شود</span>
        <input id="wl-drawing" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </label>

    </>
  );
  const saveBlock = (
    <>
      {!approved && <SaveBar session={session} data={data} model={model} sourceFile={file || sheet?.file || null} onSaved={onSaved} beforeSave={beforeSave} />}
      {run && !approved && (
        <div className="row">
          <button className="ghost" onClick={approve} disabled={approval.phase === "busy"}>تأیید رجیستر (مهندس) — {run.run.docNo} Rev {run.run.revision}</button>
          {approval.msg && <span className={approval.phase === "error" ? "err" : "note mono"}>{approval.msg}</span>}
        </div>
      )}
      {approved && <p className="muted sm">✓ این رجیستر تأیید شده و قفل است. تغییر بعدی رویژن جدید نقشه می‌خواهد.</p>}
    </>
  );
  // built only with a sheet open (it reads the sheet)
  const sheetBlock = () => (
    <>
        <div className="wl-sheet" data-wl-sheet>
          <SheetMarkup src={sheet.src} items={items} onChange={locked ? undefined : onItems} readOnly={locked} height={640}
            fileName={meta.drawingNo || "iso-marked"} selectedId={markSel} onSelect={setMarkSel} attachId={attachId} onAttach={setAttachId}
            onEdit={locked ? null : editMark} onView={(id, k) => openForm("view", id, k)}
            onAdd={locked ? null : (k, p, aspect) => openForm("create", null, k, p, aspect)}
            hidden={hiddenLayers} onToggleLayer={toggleLayer} states={progressStates} legend={progress ? [[STATE_COLORS.done, "جوش و NDT پذیرفته"], [STATE_COLORS.inspection, "جوش‌شده، منتظر بازرسی/NDT"], [STATE_COLORS.open, "باز"]] : []} />
          <p className="note mono sm" data-wl-review-count>
            {nos.length - unchecked.length} از {nos.length} جوش با نقشه بررسی شد · {Object.keys(keptMarks).length} روی نقشه جا دارد
            {nos.length > 0 && !locked && <> · <button type="button" className="ghost sm" onClick={() => setReviewed(new Set(nos))}>همه بررسی شد</button></>}
          </p>
        </div>

    </>
  );
  // built only with a sheet open (it reads the sheet)
  const registerTable = (tabs = ["weld"]) => (
    <>
        <div className="wl-table">
          <MarkTables tabs={tabs} items={items} onChange={locked ? undefined : onItems} readOnly={locked} weldList={typed}
            selectedId={markSel} onSelect={setMarkSel} attachId={attachId} onAttach={setAttachId} bom={bom} focus={editFocus}
            onOpen={(mode, id, k) => openForm(mode, id, k)}
            checked={locked ? null : { has: (no) => reviewed.has(no), onTick: tick }} />
        </div>

    </>
  );

  if (!sheetMode) {
    return (
      <div className="weldlist">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>رجیستر جوش از فهرست — ورود دستی یا فایل Excel / CSV</b>
        {onClose && <button className="ghost" onClick={onClose}>بستن</button>}
      </div>
      {run && (
        <p className="note mono" data-run-status={run.run.status}>
          در سامانه: {run.run.docNo} · Rev {run.run.revision} · {run.register?.length ?? 0} جوش ·{" "}
          {approved ? `تأییدشده${run.run.approvedBy ? ` (${run.run.approvedBy})` : ""}` : "منتظر تأیید مهندس"}
        </p>
      )}
      <p className="muted sm">
        برای نقشه‌ای که هندسه‌اش را وارد نمی‌کنید. هر جوش همان است که شما از وِلد مپ وارد می‌کنید — «دادهٔ واردشده توسط کاربر»؛
        سامانه فقط بررسی می‌کند (شمارهٔ تکراری، محل نامعلوم، جوش کارگاهی بدون اسپول، قطر) و چیزی را حدس نمی‌زند. تراز و زیرزمینی/روزمینی نامعلوم می‌ماند.
      </p>

        {metaGrid}
        {registryBlock}
        {lineDataBlock}
        {bomBlock}
        {bomWeldsBlock}
        {cutBlock}
        {importBlock}
        {datalists}
      <div>
        <div className="wl-table">
          <TableKit name="weld-list-typed"><table className="dtable">
            <thead><tr><th>#</th>{COLS.map(([k, label]) => <th key={k}>{label}</th>)}<th /></tr></thead>
            <tbody>
              {rows.map((r, i) => { const no = String(r.no ?? "").trim(); return (
                <tr key={r._id} data-wl-row={no || undefined}>
                  <td className="mono sm">{i + 1}</td>
                  {COLS.map(([k, label, ph]) => (
                    <td key={k}>
                      {COLUMN_LIST[k]
                        ? <Pick aria-label={`${label} ردیف ${i + 1}`} list={COLUMN_LIST[k]} lists={lists} value={r[k]} onChange={(v) => setCell(i, k, v)} />
                        : <input aria-label={`${label} ردیف ${i + 1}`} dir="ltr" value={r[k] ?? ""} placeholder={i === 0 ? ph : ""}
                          onChange={(e) => setCell(i, k, e.target.value)} />}
                    </td>
                  ))}
                  <td><button className="ghost" type="button" aria-label={`حذف ردیف ${i + 1}`}
                    onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ ...BLANK_ROW }])}>×</button></td>
                </tr>); })}
            </tbody>
          </table></TableKit>
        </div>
        </div>

      <div className="row">
        <button className="ghost" type="button" onClick={() => setRows([...rows, { ...BLANK_ROW }])}>+ ردیف</button>
        <button className="ghost" type="button" onClick={() => setRows([...rows, ...Array.from({ length: 10 }, () => ({ ...BLANK_ROW }))])}>+ ۱۰ ردیف</button>
      </div>

        {summaryBlock}
        {fileBlock}
        {saveBlock}
      </div>
    );
  }

  // ── the sheet is open: the engineering workspace (components/workspace) ──────────────────────────
  // The same sections, in the same components with the same state, in the panel's tabs instead of one
  // long page, so the drawing stays in view beside the register; nothing is recomputed here.
  const problems = model.problems?.length || 0;
  const reviewedN = nos.length - unchecked.length;
  const runWord = !run ? "ذخیره‌نشده" : approved ? "تأییدشده" : "در بازبینی";
  const tabs = [
    { k: "info", label: "مشخصات", hint: "شمارهٔ نقشه، رویژن، خط و مشخصات خط", node: (<><IsoInfo meta={meta} lineData={lineData} onMeta={setMeta} onLineData={setLineData} lists={lists} locked={locked} run={run} />{registryBlock}</>) },
    { k: "welds", label: "سرجوش‌ها", hint: "رجیستر جوش‌ها و نشان‌های روی نقشه", badge: nos.length ? `${reviewedN}/${nos.length}` : "",
      tone: problems ? "bad" : undefined, node: (<>{registerTable()}{summaryBlock}</>) },
    { k: "spools", label: "اسپول‌ها", hint: "اسپول‌های نقشه و سرجوش‌های هر کدام", badge: items.filter((m) => m.kind === "spool").length || "",
      node: (<>{registerTable(["spool"])}</>) },
    { k: "supports", label: "ساپورت‌ها", hint: "ساپورت‌های نقشه", badge: items.filter((m) => m.kind === "support").length || "",
      node: (<>{registerTable(["support"])}</>) },
    { k: "equip", label: "تجهیزات", hint: "تجهیزات نصب، سرجوش‌های متصل و متعلقات", badge: items.filter((m) => m.kind === "equipment").length || "",
      node: (<EquipmentTable items={items} onChange={locked ? undefined : onItems} readOnly={locked} bom={bom} selectedId={markSel} onSelect={setMarkSel}
        attachId={attachId} onAttach={setAttachId} focus={editFocus} onOpen={(mode, id, k) => openForm(mode, id, k)} />) },
    { k: "bom", label: "BOM", hint: "BOM همین برگ و سرجوش‌های مورد انتظار از آن", badge: bom.length || "",
      node: (<>{bomBlock}{bomWeldsBlock}{bom.length === 0 && <p className="muted sm">BOM خوانده نشد.</p>}</>) },
    { k: "cut", label: "برش", hint: "جدول برش لوله و مقایسه با BOM", badge: cutLengths.length || "", tone: cutBom.problems.length ? "bad" : undefined,
      node: (<>{cutBlock}{cutLengths.length === 0 && <p className="muted sm">جدول برش روی این برگ خوانده نشد.</p>}</>) },
    ...(styleTab ? [{ k: "style", label: "الگوی نقشه", hint: "الگوی این سبک نقشه: خانهٔ هر مقدار روی نقشه", node: styleTab }] : []),
    { k: "import", label: "ورود", hint: "خواندن از Excel / CSV یا چسباندن", node: (<>{importBlock}</>) },
    { k: "save", label: "ثبت", hint: "ذخیره و تأیید", tone: problems ? "bad" : undefined, badge: problems || "",
      node: (<>{fileBlock}{saveBlock}</>) },
  ];
  return (
    <div className="weldlist" data-sheet-mode>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>رجیستر جوش — کنار نقشه</b>
        {onClose && <button className="ghost" onClick={onClose}>بستن</button>}
      </div>
      {run && (
        <p className="note mono" data-run-status={run.run.status}>
          در سامانه: {run.run.docNo} · Rev {run.run.revision} · {run.register?.length ?? 0} جوش ·{" "}
          {approved ? `تأییدشده${run.run.approvedBy ? ` (${run.run.approvedBy})` : ""}` : "منتظر تأیید مهندس"}
        </p>
      )}
      {datalists}
      <WorkspaceFrame
        toolbar={(<>
          <span className="chip mono" dir="ltr" data-ws-chip="drawing">{meta.drawingNo || "؟"} · REV {meta.rev || "؟"} · {meta.sheet || "؟"}</span>
          {meta.lineNo && <span className="chip mono cy" dir="ltr" data-ws-chip="line">{meta.lineNo}</span>}
          <span className={`chip ${approved ? "cy" : ""}`} data-ws-chip="status">{runWord}</span>
          <span className="muted sm" data-ws-chip="counts">{nos.length} جوش · {reviewedN} بررسی‌شده{problems ? ` · ${problems} ایراد` : ""}</span>
        </>)}
        explorer={<Explorer meta={meta} sheets={sheets} items={items} selectedId={markSel} onSelect={setMarkSel} checked={locked ? null : { has: (no) => reviewed.has(no) }}
          layers={{ hidden: hiddenLayers, onToggle: toggleLayer }} />}
        panel={<WorkspaceTabs tabs={tabs} value={wsTab} onChange={setWsTab} />}>
        {sheetBlock()}
      </WorkspaceFrame>
      {form && (
        <MarkForm key={`${form.mode}-${form.id || "new"}-${form.kind}`} mode={form.mode}
          mark={form.id ? items.find((m) => m.id === form.id) : { kind: form.kind }} items={items} bom={bom} lists={lists} readOnly={locked}
          onClose={() => setForm(null)}
          onSave={(d) => {
            if (form.id) onItems(updateMark(items, form.id, { kind: d.kind, no: d.no, attrs: d.attrs }));
            else {
              let next = addMark(items, { kind: d.kind, no: d.no });
              const nid = next[next.length - 1].id;
              next = updateMark(next, nid, { attrs: d.attrs });
              // added on the sheet: where it was clicked; added from a table: the sheet waits for its place
              if (form.point) next = placeAt(next, nid, form.point, form.aspect);
              onItems(next); setMarkSel(nid);
              if (!form.point) setAttachId(nid);
            }
            setForm(null);
          }} />)}
    </div>
  );
}
