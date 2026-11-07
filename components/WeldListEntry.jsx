"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import TemplateButton from "./ui/TemplateButton";
import BomForm from "./BomForm";
import BomTable from "./BomTable";
import ValidationPanel from "./ValidationPanel";
import RevisionPanel from "./RevisionPanel";
import { useRevisionCenter } from "../lib/client/revision-center.mjs";
import CutForm from "./CutForm";
import SpoolDetail from "./SpoolDetail";
import { cutChecks, cutIssues } from "../lib/register/cut-model.mjs";
import { duplicateCut, spoolDependents } from "../lib/register/cut-identity.mjs";
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
import { cutBomReport } from "../lib/register/cut-bom.mjs";
import { useSavedProtection } from "../lib/client/saved-protection.mjs";
import { useValidationCenter } from "../lib/client/validation-center.mjs";
import { isUid, newUid } from "../lib/sheet/mark-identity.mjs";
import { KINDS } from "../lib/sheet/markup.mjs";
import { itemsFromWeldRows, weldRowsFromItems, withRowIds, registerRow, rowTyped, adoptLegacyPlacement, legacyMarks, extraMarks } from "../lib/sheet/weld-list-marks.mjs";
import { normalize as normalizeMarks, addMark, updateMark, placeAt, findMark, isPlaced } from "../lib/sheet/markup.mjs";
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
  const wsTabRef = useRef(wsTab); wsTabRef.current = wsTab;
  const [paste, setPaste] = useState("");
  const [read, setRead] = useState(null);
  const [approval, setApproval] = useState({ phase: "idle" });
  // a weld log of many drawings (Piping.Tools, this platform's Weld Log, a contractor's register): one sheet is loaded at a time
  const [log, setLog] = useState(null);
  // the drawing beside the rows: where each weld is on it, and which rows a person has checked against it
  // where each weld is on the drawing: by the row's persistent identity (`byUid`), with the legacy number-keyed places (`marks`) kept
  // as a fallback for a number that is one row's alone; a legacy place is adopted under its row's identity at load
  const [marks, setMarks] = useState(() => ({ ...(initial?.weldMarkup?.marks || {}) }));
  const [byUid, setByUid] = useState(() => adoptLegacyPlacement(rows, initial?.weldMarkup?.marks || {}, initial?.weldMarkup?.byUid || {}));
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
  // the sheet's cut table (CUT PIPE LENGTH) as read, corrected and completed by a person through its form
  const [cutRows, setCutRows] = useState(() => (Array.isArray(initial?.cutLengths) ? initial.cutLengths.map((c) => ({ ...c })) : []));
  const cutLengths = cutRows;
  const [cutForm, setCutForm] = useState(null);  // { mode, i }
  // the spool numbers (oval) and support numbers (hexagon) marked on the sheet, kept with the payload
  const [extras, setExtras] = useState(() => extraMarks(normalizeMarks(initial?.sheetMarkup?.items)));
  // Sheet weld marks that are NOT any typed row (their uid is no row's): kept exactly as saved, shown on the drawing and in the Validation tab,
  // never turned into rows, never matched to a row by number or position, never deleted by a save (docs/audit/phase-7 §3)
  const [orphans, setOrphans] = useState(() => {
    const rowUids = new Set((initial?.weldList || []).map((r) => (isUid(r?.uid) ? r.uid.toLowerCase() : null)).filter(Boolean));
    return normalizeMarks(initial?.sheetMarkup?.items).filter((m) => KINDS[m.kind]?.cls === "weld" && !(isUid(m.uid) && rowUids.has(m.uid.toLowerCase())));
  });

  const typed = rows.filter(rowTyped).map(registerRow);
  // A list read from the drawing's printed markers keeps what the model read
  // (weldMarks) beside what was completed by hand — the evidence for each row.
  const nos = typed.map((r) => String(r.no ?? "").trim()).filter(Boolean);
  // the places that go with the payload: by identity for every typed row, and the legacy number-keyed form for the unique numbers
  const placement = useMemo(() => adoptLegacyPlacement(rows.filter(rowTyped), marks, byUid), [rows, marks, byUid]);
  const keptByUid = Object.fromEntries(typed.filter((r) => r.uid && placement[r.uid]).map((r) => [r.uid, placement[r.uid]]));
  const keptMarks = legacyMarks(typed, keptByUid);
  const keptReviewed = nos.filter((no) => reviewed.has(no));
  const data = useMemo(() => ({ meta: { ...meta, nps: meta.nps === "" ? null : Number(meta.nps) }, weldList: typed,
    ...(initial?.weldMarks ? { weldMarks: initial.weldMarks } : {}),
    // the page of the file the sheet is, kept even with nothing placed yet: a PDF of many sheets opens on this one
    ...(Object.keys(keptByUid).length || Object.keys(keptMarks).length || sheet ? { weldMarkup: { page: sheet?.page ?? initial?.weldMarkup?.page ?? 1, marks: keptMarks, ...(Object.keys(keptByUid).length ? { byUid: keptByUid } : {}) } } : {}),
    ...(keptReviewed.length ? { reviewed: keptReviewed } : {}),
    ...(lineData && Object.values(lineData).some((v) => String(v ?? "").trim()) ? { lineData } : {}),
    // three states (lib/db/repos/register-persistence.mjs): rows replace the BOM; [] is the person emptying a BOM the sheet had (the
    // server refuses while anything holds it); no key leaves the saved BOM as it is
    ...(bom.length ? { bom } : Array.isArray(initial?.bom) && initial.bom.length ? { bom: [] } : {}),
    ...(cutLengths.length ? { cutLengths } : {}),
    ...(extras.length || orphans.length ? { sheetMarkup: { page: sheet?.page ?? initial?.sheetMarkup?.page ?? 1, items: [...extras, ...orphans] } } : {}) }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [meta, typed, initial, JSON.stringify(keptMarks), JSON.stringify(keptByUid), keptReviewed.join("|"), sheet?.page, JSON.stringify(extras), JSON.stringify(orphans), JSON.stringify(lineData), JSON.stringify(bom)]);
  const model = useMemo(() => (typed.length ? modelFromWeldList(data) : { error: "هنوز جوشی وارد نشده است." }), [data, typed.length]);

  const setCell = (i, k, v) => {
    // a weld renumbered keeps its place on the drawing and its tick
    if (k === "no") {
      const was = String(rows[i]?.no ?? "").trim(), now = String(v ?? "").trim();
      // (a renumbered weld keeps its place by its identity — nothing to move; the number is only what it is called)
      if (was && reviewed.has(was)) { const r = new Set(reviewed); r.delete(was); setReviewed(r); }
    }
    // a weld's spool typed in the table: tied to the spool mark by identity ONLY when exactly one spool has that number
    let patch = { [k]: v };
    if (k === "spool") { const hits = extras.filter((m) => m.kind === "spool" && isUid(m.uid) && String(m.no ?? "").trim() === String(v ?? "").trim()); patch = { spool: v, spoolUid: String(v ?? "").trim() && hits.length === 1 ? hits[0].uid : "" }; }
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
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
  // a mark picked on the drawing or in the explorer: while the panel shows a register table, it shows the table of that mark's class
  const orphanIds = useMemo(() => new Set(orphans.map((m) => m.id)), [orphans]);
  const pickMark = (id) => {
    setMarkSel(id);
    if (orphanIds.has(id)) { setWsTab("validation"); return; }
    const m = findMark(itemsRef.current, id);
    if (m && ["welds", "spools", "supports", "equip"].includes(wsTabRef.current)) setWsTab(tabOf(m.kind));
  };
  // «edit» from the sheet's menu: the welds tab, the mark's row in focus
  const [editFocus, setEditFocus] = useState(null);
  // a mark is viewed, edited and added in its form (components/MarkForm.jsx), from the tables and from the sheet's menu alike
  const [form, setForm] = useState(null);   // { mode, id, kind, point, aspect }
  const tabOf = (k) => (k === "equipment" ? "equip" : k === "spool" ? "spools" : k === "support" ? "supports" : "welds");
  const openForm = (mode, id, kind, point = null, aspect = Math.SQRT2) => {
    if (id && orphanIds.has(id)) { setMarkSel(id); setWsTab("validation"); return; }   // not a row: it has no form, only a finding
    const k = kind || findMark(itemsRef.current, id)?.kind;
    if (id) { setMarkSel(id); setEditFocus((f) => ({ id, n: (f?.n || 0) + 1 })); }
    setWsTab(tabOf(k));
    setForm({ mode: locked ? "view" : mode, id, kind: k, point, aspect });
  };
  const editMark = (id, kind) => openForm("edit", id, kind);
  // layers of the sheet (a view setting): toggled from the navigator
  const [hiddenLayers, setHiddenLayers] = useState(() => new Set());
  const toggleLayer = (k) => setHiddenLayers((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const [attachId, setAttachId] = useState(null);
  const items = useMemo(() => (sheetMode ? itemsFromWeldRows(rows, marks, extras, byUid) : []), [sheetMode, rows, marks, byUid, extras]);
  const itemsRef = useRef(items); itemsRef.current = items;
  // what the SAVED revision holds against deleting a mark (lib/client/saved-protection.mjs): advice before the confirm; the server decides
  const { protect, saved } = useSavedProtection({ session, documentId: run?.run?.documentId || null, items, status: run?.run?.status });
  const revisionInfo = useMemo(() => ({ docNo: meta.drawingNo || null, rev: meta.rev ?? null, sheet: meta.sheet || null }), [meta.drawingNo, meta.rev, meta.sheet]);
  const vc = useValidationCenter({ session, documentId: run?.run?.documentId || null, runId: run?.run?.id || null, status: run?.run?.status, payload: data, revision: revisionInfo });
  const [vcSource, setVcSource] = useState("draft");
  const rc = useRevisionCenter({ session, documentId: run?.run?.documentId || null });
  const validationTotal = vc.draft.summary.errors + vc.draft.summary.warnings;
  // who uses what of this sheet's BOM: the welds' ends against each row's (lib/register/bom-allocation.mjs)
  const alloc = useMemo(() => usage(items, bom), [items, bom]);
  // a saved sheet: each weld painted by where its joint stands on site
  const progressStates = progress ? Object.fromEntries(items.filter((m) => m.kind.startsWith("weld")).map((m) => {
    const st = progress[m.no] || "open";
    return [m.id, { state: st, color: STATE_COLORS[st] }];
  })) : null;
  const drawStates = useMemo(() => (orphans.length ? { ...(progressStates || {}), ...Object.fromEntries(orphans.map((m) => [m.id, { state: "unlinked", color: "#E2574C" }])) } : progressStates),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orphans, progress, items]);
  // what the drawing shows: the register's marks and the unlinked sheet weld marks (drawn apart, in their own colour)
  const drawItems = useMemo(() => [...items, ...orphans], [items, orphans]);
  function onDrawItems(next) {
    // the drawing may move or delete an unlinked mark (a person's own action); it can never make one a row
    setOrphans(next.filter((m) => orphanIds.has(m.id)));
    onItems(next.filter((m) => !orphanIds.has(m.id)));
  }
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
    setByUid(got.byUid);
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
      <BomTable rows={bomRows} live={alloc} locked={locked} session={session} documentId={run?.run?.documentId || null}
        savedHadRows={Array.isArray(initial?.bom) && initial.bom.length > 0}
        onView={(i) => setBomForm({ mode: "view", i })} onEdit={(i) => setBomForm({ mode: "edit", i })}
        onAdd={() => setBomForm({ mode: "create", i: -1 })} onDelete={(i) => setBomRows(bomRows.filter((_, j) => j !== i))} />
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
  const nextCutPiece = () => { const n = cutRows.map((c) => Number(c.piece)).filter(Number.isFinite); return (n.length ? Math.max(...n) : 0) + 1; };
  const cutProblems = useMemo(() => cutChecks(cutRows, items), [cutRows, items]);
  const cutIssueList = useMemo(() => cutIssues(cutRows, items), [cutRows, items]);
  const cutBom = useMemo(() => cutBomReport(cutLengths, bom), [cutLengths, bom]);
  const [cutQ, setCutQ] = useState(""), [cutFilter, setCutFilter] = useState("all"), [cutSort, setCutSort] = useState("piece");
  const [selCut, setSelCut] = useState(null), [spoolSel, setSpoolSel] = useState(null);
  // Printed numbers are LABELS of identities: when a weld or a spool is renumbered, the labels that name it (cut ends, cut spool, a weld's
  // spool) follow by uid. Only the label changes; the references, the pieces and the order are untouched. (The server settles the same on save.)
  useEffect(() => {
    if (locked) return;
    const lcu = (u) => (isUid(u) ? u.toLowerCase() : null);
    const weldNo = new Map(rows.filter(rowTyped).filter((r) => lcu(r.uid)).map((r) => [lcu(r.uid), String(r.no ?? "").trim()]));
    const spoolNo = new Map(extras.filter((m) => m.kind === "spool" && lcu(m.uid)).map((m) => [lcu(m.uid), String(m.no ?? "").trim()]));
    let cutsChanged = false;
    const nextCuts = cutRows.map((c) => {
      let x = c;
      for (const [lab, key, map] of [["from", "fromUid", weldNo], ["to", "toUid", weldNo], ["spool", "spoolUid", spoolNo]]) {
        const no = lcu(c[key]) && map.get(lcu(c[key]));
        if (no && String(x[lab] ?? "").trim() !== no) x = { ...x, [lab]: no };
      }
      if (x !== c) cutsChanged = true;
      return x;
    });
    if (cutsChanged) setCutRows(nextCuts);
    let rowsChanged = false;
    const nextRows = rows.map((r) => { const no = lcu(r.spoolUid) && spoolNo.get(lcu(r.spoolUid)); if (no && String(r.spool ?? "").trim() !== no) { rowsChanged = true; return { ...r, spool: no }; } return r; });
    if (rowsChanged) setRows(nextRows);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, extras, cutRows]);
  const SZ = (n) => (n == null ? "؟" : `${n}"`);
  // ── navigation / selection between the cut table, the drawing and the spool detail (all by uid) ──
  const markOfUid = (u) => (isUid(u) ? drawItems.find((m) => isUid(m.uid) && m.uid.toLowerCase() === u.toLowerCase()) || null : null);
  const goUid = ({ kind, uid }) => {
    if (kind === "cut") { setSelCut(uid); setWsTab("cut"); return; }
    const m = markOfUid(uid);
    if (!m) return;
    setMarkSel(m.id);
    if (kind === "spool") { setSpoolSel(uid); setWsTab("spools"); } else if (orphanIds.has(m.id)) setWsTab("validation");
  };
  const cutKey = (c, i) => (isUid(c.uid) ? c.uid : `i${i}`);
  const selMarkU = (() => { const m = markSel ? findMark(drawItems, markSel) : null; return m && isUid(m.uid) ? m.uid.toLowerCase() : null; })();
  const rank = { none: 0, info: 1, warning: 2, error: 3 };
  const cutView = useMemo(() => {
    const q = cutQ.trim().toLowerCase();
    const list = cutRows.map((c, i) => ({ c, i, flag: (() => { const f = cutIssueList.filter((x) => (c.uid && x.uid === c.uid) || (!c.uid && x.piece === String(c.piece ?? "").trim())); return f.reduce((w, x) => (rank[x.level] > rank[w] ? x.level : w), "none"); })() }))
      .filter(({ c }) => !q || [c.piece, c.lengthMm, c.ns, c.material, c.schedule, c.from, c.to, c.spool, c.note].some((v) => String(v ?? "").toLowerCase().includes(q)))
      .filter(({ flag }) => cutFilter === "all" || (cutFilter === "issues" ? flag === "error" || flag === "warning" : flag === "none"));
    const by = { piece: (x) => Number(x.c.piece) || 0, length: (x) => Number(x.c.lengthMm) || 0, spool: (x) => String(x.c.spool ?? "") };
    return list.sort((x, y) => { const a = by[cutSort](x), b = by[cutSort](y); return typeof a === "number" ? a - b : a.localeCompare(b, "en", { numeric: true }); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cutRows, cutIssueList, cutQ, cutFilter, cutSort]);
  const sortCuts = (list) => list.sort((a, b) => (Number(a.piece) || 0) - (Number(b.piece) || 0));
  const dupCut = (i) => {
    const c = cutRows[i];
    const src = isUid(c.uid) ? c : { ...c, uid: newUid() };           // a legacy piece is given its identity now, so the copy can be proven distinct
    const copy = duplicateCut([src], src.uid, nextCutPiece());
    setCutRows(sortCuts([...cutRows.map((x, j) => (j === i ? src : x)), copy]));
    setSelCut(copy.uid);
  };
  const delCut = (i) => {
    const c = cutRows[i];
    const lines = [`قطعهٔ برش <${c.piece}> حذف شود؟`,
      isUid(c.uid) ? `شناسه: ${c.uid}` : "شناسه: ندارد (ردیف قدیمی)",
      `ابتدا: ${c.from || "—"} · انتها: ${c.to || "—"} · اسپول: ${c.spool || "—"}`,
      `وابسته‌ای ندارد؛ ${c.lengthMm} mm از مجموع برشِ قطر ${c.ns || "؟"} کم می‌شود (مصرف لوله از BOM).`,
      "سرجوش‌ها و اسپول دست‌نخورده می‌مانند."];
    if (window.confirm(lines.join("\n"))) { setCutRows(cutRows.filter((_, j) => j !== i)); if (selCut === cutKey(c, i)) setSelCut(null); }
  };
  const FLAG = { error: ["خطا", "err"], warning: ["هشدار", "warnish"], info: ["اطلاع", "muted"] };
  const cutBlock = (
    <>
      {cutLengths.length > 0 && (
        <div className="cut-bom" data-cut-bom>
          <b className="sm">برش در برابر BOM</b> <span className="muted sm" data-cut-bom-preview>پیش‌نمایش پیش‌نویس — BOM ذخیره‌شدهٔ سرور مرجع است؛ باقی‌ماندهٔ نظری موجودی قابل‌استفاده نیست</span>
          <TableKit name="iso-cut-bom"><table className="dtable">
            <thead><tr><th>قطر</th><th>جنس</th><th>Sch</th><th>قطعه</th><th>جمع برش (m)</th><th>لولهٔ BOM (m)</th><th>باقی‌ماندهٔ نظری (m)</th><th>وضعیت</th></tr></thead>
            <tbody>{cutBom.sizes.map((z, i) => (
              <tr key={i} data-cut-size={z.size ?? "?"} data-cut-status={z.status}>
                <td className="mono" dir="ltr">{SZ(z.size)}</td><td className="mono sm" dir="ltr">{z.material || "—"}</td><td className="mono sm" dir="ltr">{z.schedule || "—"}</td>
                <td className="mono">{z.pieces}</td><td className="mono">{z.cutM}</td>
                <td className="mono">{z.bomM ?? "—"}</td><td className="mono">{z.remainingM ?? "—"}</td>
                <td className={z.status === "ok" ? "ok sm" : "sm warnish"}>{{ ok: "هم‌خوان", over: "برش بیش از BOM", noBom: "ردیف لولهٔ BOM نیست", noSize: "قطر خوانده نشد", mismatch: "جنس/Sch با BOM نمی‌خواند" }[z.status]}</td>
              </tr>))}</tbody>
          </table></TableKit>
          {cutBom.problems.length > 0 && <ul className="sm" data-cut-problems style={{ margin: "6px 0", paddingInlineStart: 18 }}>{cutBom.problems.map((x) => <li key={x} className="err">{x}</li>)}</ul>}
        </div>)}
      <div className="cut-read" data-cut-lengths={cutLengths.length}>
        <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <b className="sm">جدول برش لوله (CUT PIPE LENGTH) — {cutLengths.length} قطعه</b>
          <span className="muted sm">خوانده‌شده با OCR؛ با نقشه بررسی کنید</span>
          <span className="grow" />
          {cutLengths.length > 0 && (<>
            <input type="search" dir="ltr" className="sm" data-cut-search placeholder="جست‌وجو" aria-label="جست‌وجوی قطعه" value={cutQ} onChange={(e) => setCutQ(e.target.value)} style={{ width: 120 }} />
            <select className="sm" data-cut-filter aria-label="فیلتر" value={cutFilter} onChange={(e) => setCutFilter(e.target.value)}><option value="all">همه</option><option value="issues">دارای ایراد</option><option value="clean">بدون ایراد</option></select>
            <select className="sm" data-cut-sort aria-label="مرتب‌سازی" value={cutSort} onChange={(e) => setCutSort(e.target.value)}><option value="piece">شماره</option><option value="length">طول</option><option value="spool">اسپول</option></select>
          </>)}
          {!locked && <button type="button" className="ghost sm" data-cut-add onClick={() => setCutForm({ mode: "create", i: -1 })}>+ ثبت قطعه</button>}
        </div>
        {cutLengths.length > 0 && cutProblems.length > 0 && <ul className="sm" data-cut-model-problems style={{ margin: "6px 0", paddingInlineStart: 18 }}>{cutProblems.map((x) => <li key={x} className="err">{x}</li>)}</ul>}
        {cutLengths.length > 0 && (
          <TableKit name="iso-cut-read"><table className="dtable">
            <thead><tr><th></th><th>قطعه</th><th>طول برش (mm)</th><th>N.S.</th><th>جنس</th><th>Sch</th><th>ابتدا</th><th>انتها</th><th>اسپول</th><th>زاویه</th><th>توضیح</th><th></th></tr></thead>
            <tbody>{cutView.map(({ c, i, flag }) => {
              const hl = selMarkU && [c.fromUid, c.toUid, c.spoolUid].some((u) => isUid(u) && u.toLowerCase() === selMarkU);
              return (
              <tr key={cutKey(c, i)} data-cut-row={c.piece} data-cut-uid={isUid(c.uid) ? c.uid : ""} data-cut-flag={flag} aria-selected={selCut === cutKey(c, i)} data-cut-hl={hl ? "1" : undefined}
                className={selCut === cutKey(c, i) || hl ? "sel" : ""} style={selCut === cutKey(c, i) || hl ? { background: "var(--sel, rgba(80,140,255,.14))" } : undefined}
                onClick={() => { setSelCut(cutKey(c, i)); const m = markOfUid(c.fromUid) || markOfUid(c.toUid); if (m) setMarkSel(m.id); }}>
                <td data-cut-cell="flag" title={flag === "none" ? "" : FLAG[flag][0]}>{flag !== "none" && <span className={`${FLAG[flag][1]} sm`} data-cut-indicator={flag}>{flag === "info" ? "ⓘ" : "⚠"}</span>}</td>
                <td className="mono" data-cut-cell="piece">&lt;{c.piece}&gt;</td><td className="mono" data-cut-cell="lengthMm">{c.lengthMm}</td>
                <td className="mono" dir="ltr" data-cut-cell="ns">{c.ns ?? "؟"}</td>
                <td className="mono sm" dir="ltr" data-cut-cell="material">{c.material || "—"}</td>
                <td className="mono sm" dir="ltr" data-cut-cell="schedule">{c.schedule || "—"}</td>
                <td className="mono sm" dir="ltr" data-cut-cell="from">{c.from || "—"}</td>
                <td className="mono sm" dir="ltr" data-cut-cell="to">{c.to || "—"}</td>
                <td className="mono sm" dir="ltr" data-cut-cell="spool">{c.spool || "—"}</td>
                <td className="mono sm" dir="ltr" data-cut-cell="angle">{c.angle || "—"}</td>
                <td className="sm" data-cut-cell="note">{c.note || "—"}</td>
                <td className="row" style={{ gap: 4, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="ghost sm" data-cut-view={c.piece} onClick={() => setCutForm({ mode: "view", i })}>مشاهده</button>
                  {markOfUid(c.fromUid) && <button type="button" className="ghost sm" data-cut-go-from={c.piece} onClick={() => goUid({ kind: "weld", uid: c.fromUid })}>◂ ابتدا</button>}
                  {markOfUid(c.toUid) && <button type="button" className="ghost sm" data-cut-go-to={c.piece} onClick={() => goUid({ kind: "weld", uid: c.toUid })}>انتها ▸</button>}
                  {markOfUid(c.spoolUid) && <button type="button" className="ghost sm" data-cut-go-spool={c.piece} onClick={() => goUid({ kind: "spool", uid: c.spoolUid })}>اسپول</button>}
                  {!locked && <button type="button" className="ghost sm" data-cut-edit={c.piece} onClick={() => setCutForm({ mode: "edit", i })}>ویرایش</button>}
                  {!locked && <button type="button" className="ghost sm" data-cut-dup={c.piece} onClick={() => dupCut(i)}>رونوشت</button>}
                  {!locked && <button type="button" className="ghost sm" data-cut-delete={c.piece} onClick={() => delCut(i)}>حذف</button>}
                </td>
              </tr>); })}</tbody>
          </table></TableKit>)}
        {cutLengths.length > 0 && cutView.length === 0 && <p className="muted sm" data-cut-empty>هیچ قطعه‌ای با این جست‌وجو/فیلتر نیست.</p>}
      </div>
      {cutForm && (
        <CutForm key={`${cutForm.mode}-${cutForm.i}`} mode={cutForm.mode} lists={lists} readOnly={locked} cuts={cutRows} items={items}
          cut={cutForm.i >= 0 ? cutRows[cutForm.i] : { piece: nextCutPiece() }}
          onClose={() => setCutForm(null)}
          onSave={(c) => {
            const saved = { ...c, uid: isUid(c.uid) ? c.uid : newUid() };
            setCutRows(cutForm.i >= 0 ? cutRows.map((x, j) => (j === cutForm.i ? saved : x)) : sortCuts([...cutRows, saved]));
            setSelCut(saved.uid);
            setCutForm(null);
          }} />)}
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
          <SheetMarkup protect={protect} cuts={cutRows} src={sheet.src} items={drawItems} onChange={locked ? undefined : onDrawItems} readOnly={locked} height={640}
            fileName={meta.drawingNo || "iso-marked"} selectedId={markSel} onSelect={pickMark} attachId={attachId} onAttach={setAttachId}
            onEdit={locked ? null : editMark} onView={(id, k) => openForm("view", id, k)}
            onAdd={locked ? null : (k, p, aspect) => openForm("create", null, k, p, aspect)}
            hidden={hiddenLayers} onToggleLayer={toggleLayer} states={drawStates} legend={progress ? [[STATE_COLORS.done, "جوش و NDT پذیرفته"], [STATE_COLORS.inspection, "جوش‌شده، منتظر بازرسی/NDT"], [STATE_COLORS.open, "باز"]] : []} />
          <p className="note mono sm" data-wl-review-count>
            {nos.length - unchecked.length} از {nos.length} جوش با نقشه بررسی شد · {items.filter((m) => m.kind.startsWith("weld") && isPlaced(m)).length} روی نقشه جا دارد
            {nos.length > 0 && !locked && <> · <button type="button" className="ghost sm" onClick={() => setReviewed(new Set(nos))}>همه بررسی شد</button></>}
          </p>
        </div>

    </>
  );
  // built only with a sheet open (it reads the sheet)
  const registerTable = (tabs = ["weld"]) => (
    <>
        <div className="wl-table">
          <MarkTables protect={protect} cuts={cutRows} tabs={tabs} items={items} onChange={locked ? undefined : onItems} readOnly={locked} weldList={typed}
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
  // a finding's way to the place where it is fixed: always an existing form, table or the drawing; nothing is edited from the list
  const openFinding = (f) => {
    const uid = f.entityUid, mark = uid ? findMark(items, uid) : null;
    const pt = f.detail?.pt != null ? Number(f.detail.pt) : null;
    switch (f.suggestedAction) {
      case "weld-form": case "equipment-form": case "spool-form": case "support-form":
        if (mark) return openForm(locked ? "view" : "edit", mark.id, mark.kind);
        if (f.code === "W_PT_MISSING" || f.code.startsWith("W_")) { setWsTab("welds"); return; }
        return setWsTab(f.suggestedAction === "equipment-form" ? "equip" : f.suggestedAction === "spool-form" ? "spools" : f.suggestedAction === "support-form" ? "supports" : "welds");
      case "bom-form": {
        setWsTab("bom");
        const i = pt != null ? bomRows.findIndex((b) => Number(b.pt) === pt) : Number.isInteger(f.detail?.index) ? f.detail.index : -1;
        if (i >= 0) setBomForm({ mode: locked ? "view" : "edit", i });
        return;
      }
      case "ledger": return setWsTab("bom");
      case "cut-form": return setWsTab("cut");
      case "save": return setWsTab("save");
      case "revisions": return setWsTab("revisions");
      case "drawing": {
        const target = (uid && (findMark(drawItems, uid) || drawItems.find((m) => m.uid === uid))) || null;
        if (target) setMarkSel(target.id);
        return;
      }
      default: return undefined;
    }
  };
  const selectedUid = (() => { const m = markSel ? findMark(drawItems, markSel) : null; return m ? (isUid(m.uid) ? m.uid : m.id) : null; })();   // (not a hook: this runs after the sheet-less early return)
  const tabs = [
    { k: "info", label: "مشخصات", hint: "شمارهٔ نقشه، رویژن، خط و مشخصات خط", node: (<><IsoInfo meta={meta} lineData={lineData} onMeta={setMeta} onLineData={setLineData} lists={lists} locked={locked} run={run} />{registryBlock}</>) },
    { k: "welds", label: "سرجوش‌ها", hint: "رجیستر جوش‌ها و نشان‌های روی نقشه", badge: nos.length ? `${reviewedN}/${nos.length}` : "",
      tone: problems ? "bad" : undefined, node: (<>{registerTable()}{summaryBlock}</>) },
    { k: "spools", label: "اسپول‌ها", hint: "اسپول‌های نقشه و سرجوش‌های هر کدام", badge: items.filter((m) => m.kind === "spool").length || "",
      node: (<>{registerTable(["spool"])}
        <SpoolDetail spools={items.filter((m) => m.kind === "spool")} selectedUid={spoolSel || (selectedUid && isUid(selectedUid) ? selectedUid : null)} payload={data} findings={vc.draft.findings} onSelect={(u) => { setSpoolSel(u); const m = markOfUid(u); if (m) setMarkSel(m.id); }} onGo={goUid} /></>) },
    { k: "supports", label: "ساپورت‌ها", hint: "ساپورت‌های نقشه", badge: items.filter((m) => m.kind === "support").length || "",
      node: (<>{registerTable(["support"])}</>) },
    { k: "equip", label: "تجهیزات", hint: "تجهیزات نصب، سرجوش‌های متصل و متعلقات", badge: items.filter((m) => m.kind === "equipment").length || "",
      node: (<EquipmentTable protect={protect} items={items} onChange={locked ? undefined : onItems} readOnly={locked} bom={bom} selectedId={markSel} onSelect={setMarkSel}
        attachId={attachId} onAttach={setAttachId} focus={editFocus} onOpen={(mode, id, k) => openForm(mode, id, k)} />) },
    { k: "bom", label: "BOM", hint: "BOM همین برگ و سرجوش‌های مورد انتظار از آن", badge: bom.length || "",
      node: (<>{bomBlock}{bomWeldsBlock}</>) },
    { k: "cut", label: "برش", hint: "جدول برش لوله و مقایسه با BOM", badge: cutLengths.length || "", tone: cutBom.problems.length || cutProblems.length ? "bad" : undefined,
      node: (<>{cutBlock}{cutLengths.length === 0 && <p className="muted sm">جدول برش روی این برگ خوانده نشد.</p>}</>) },
    { k: "validation", label: "اعتبارسنجی", hint: "مرکز تطبیق: همهٔ ایرادهای مهندسی یک‌جا", tone: vc.draft.summary.errors ? "bad" : undefined, badge: validationTotal || "",
      node: (<ValidationPanel draft={vc.draft} saved={vc.server} source={vcSource} onSource={setVcSource} onRefresh={vc.refresh} loading={vc.loading} error={vc.error}
        selectedUid={selectedUid} onSelect={(uid) => { const m = findMark(drawItems, uid); if (m) setMarkSel(m.id); }} onOpen={openFinding}
        onResolve={vc.resolve} resolveBusy={vc.resolveBusy} locked={locked} />) },
    ...(run?.run?.documentId ? [{ k: "revisions", label: "نسخه‌ها", hint: "رویژن‌های این برگ: زمان‌بندی، مقایسه و انتقال کنترل‌شده", badge: rc.compare?.summary?.requiresReview || "",
      node: (<RevisionPanel rc={rc} session={session} current={run.run.documentId} locked={locked} selectedUid={selectedUid} onSelect={(uid) => { const m = findMark(drawItems, uid); if (m) setMarkSel(m.id); }}
        onOpenRun={(id) => id && onSaved?.(id)} onValidate={() => { setVcSource("saved"); setWsTab("validation"); }} />) }] : []),
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
        explorer={<Explorer meta={meta} sheets={sheets} items={items} selectedId={markSel} onSelect={pickMark} checked={locked ? null : { has: (no) => reviewed.has(no) }}
          layers={{ hidden: hiddenLayers, onToggle: toggleLayer }} />}
        panel={<WorkspaceTabs tabs={tabs} value={wsTab} onChange={setWsTab} />}>
        {sheetBlock()}
      </WorkspaceFrame>
      {form && (
        <MarkForm key={`${form.mode}-${form.id || "new"}-${form.kind}`} mode={form.mode}
          mark={form.id ? findMark(items, form.id) : { kind: form.kind }} items={items} bom={bom} lists={lists} readOnly={locked} thisDoc={meta.drawingNo} thisSheet={meta.sheet} saved={saved}
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
