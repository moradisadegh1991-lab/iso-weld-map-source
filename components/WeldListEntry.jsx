"use client";
import { useMemo, useState } from "react";
import TemplateButton from "./ui/TemplateButton";
import SaveBar from "./SaveBar";
import SheetReview from "./SheetReview";
import MarkTables from "./MarkTables";
import { normalize as normalizeMarks } from "../lib/sheet/markup.mjs";
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
 * `sheet` ({ src, page }) puts the drawing beside the rows
 * (components/SheetReview.jsx): each weld's marker where its number was
 * read or where a person put it, kept with the payload as `weldMarkup`;
 * each row ticked once a person has checked it against the drawing
 * (`reviewed`), and saving with rows unticked asks first. `progress`
 * ({ [weldNo]: "done" | "inspection" | "open" }) colours a saved sheet by
 * where each joint stands on site.
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
const BLANK_META = { drawingNo: "", rev: "", sheet: "1/1", lineNo: "", unit: "", pipingClass: "", nps: "", schedule: "" };
export default function WeldListEntry({ session, initial = null, run = null, onSaved, onClose, sheet = null, progress = null }) {
  const [meta, setMeta] = useState({ ...BLANK_META, ...(initial?.meta || {}) });
  const [rows, setRows] = useState(initial?.weldList?.length ? initial.weldList.map((r) => ({ ...BLANK_ROW, ...r })) : [{ ...BLANK_ROW }, { ...BLANK_ROW }, { ...BLANK_ROW }]);
  const [file, setFile] = useState(null);
  const [paste, setPaste] = useState("");
  const [read, setRead] = useState(null);
  const [approval, setApproval] = useState({ phase: "idle" });
  // a weld log of many drawings (Piping.Tools, this platform's Weld Log, a contractor's register): one sheet is loaded at a time
  const [log, setLog] = useState(null);
  // the drawing beside the rows: where each weld is on it, and which rows a person has checked against it
  const [marks, setMarks] = useState(() => ({ ...(initial?.weldMarkup?.marks || {}) }));
  const [reviewed, setReviewed] = useState(() => new Set(initial?.reviewed || []));
  const [picked, setPicked] = useState(null);
  const [extraTool, setExtraTool] = useState(null);
  const [extraAttach, setExtraAttach] = useState(null);   // the spool/support row waiting for its place on the sheet
  const [extraSel, setExtraSel] = useState(null);
  // the spool numbers (oval) and support numbers (hexagon) marked on the sheet, kept with the payload
  const [extras, setExtras] = useState(() => normalizeMarks(initial?.sheetMarkup?.items).filter((m) => m.kind === "spool" || m.kind === "support"));

  const typed = rows.filter((r) => Object.values(r).some((v) => String(v ?? "").trim()));
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
    ...(extras.length ? { sheetMarkup: { page: sheet?.page ?? initial?.sheetMarkup?.page ?? 1, items: extras } } : {}) }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [meta, typed, initial, JSON.stringify(keptMarks), keptReviewed.join("|"), sheet?.page, JSON.stringify(extras)]);
  // a weld is drawn in the shape of where it is welded, as the register says: unsaid stays unsaid (dashed)
  const kinds = Object.fromEntries(typed.map((r) => String(r.no ?? "").trim()).filter(Boolean).map((no) => {
    const loc = String(typed.find((r) => String(r.no ?? "").trim() === no)?.loc ?? "").trim().toLowerCase();
    return [no, loc === "shop" ? "weld-shop" : loc === "field" ? "weld-field" : "weld-unknown"];
  }));
  const model = useMemo(() => (typed.length ? modelFromWeldList(data) : { error: "هنوز جوشی وارد نشده است." }), [data, typed.length]);

  const setCell = (i, k, v) => {
    // a weld renumbered keeps its place on the drawing and its tick
    if (k === "no") {
      const was = String(rows[i]?.no ?? "").trim(), now = String(v ?? "").trim();
      if (was && now && was !== now && marks[was] && !marks[now]) { const m = { ...marks, [now]: marks[was] }; delete m[was]; setMarks(m); }
      if (was && reviewed.has(was)) { const r = new Set(reviewed); r.delete(was); setReviewed(r); }
      if (picked === was) setPicked(now || null);
    }
    setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  };
  const tick = (no, on) => { const r = new Set(reviewed); if (on) r.add(no); else r.delete(no); setReviewed(r); };
  const place = (no, p) => setMarks({ ...marks, [no]: { ...p, src: "hand" } });
  const unchecked = nos.filter((no) => !reviewed.has(no));
  const states = Object.fromEntries(nos.map((no) => [no, progress ? progress[no] || "open" : reviewed.has(no) ? "checked" : "unchecked"]));
  const pick = (no) => {
    setPicked(no);
    const row = document.querySelector(`[data-wl-row="${CSS.escape(no)}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const beforeSave = async () => !sheet || !unchecked.length
    || window.confirm(`${unchecked.length} جوش هنوز با نقشه بررسی نشده (${unchecked.slice(0, 8).join("، ")}${unchecked.length > 8 ? "، …" : ""}). همین حالا ذخیره شود؟`);
  const onMeta = (k) => (e) => setMeta({ ...meta, [k]: e.target.value });

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

      <div className="wl-grid">
        {[["drawingNo", "شمارهٔ نقشه (ISO)", true], ["rev", "رویژن", true], ["sheet", "شیت"], ["lineNo", "شمارهٔ خط"],
          ["unit", "واحد"], ["pipingClass", "کلاس لوله"], ["nps", "قطر پیش‌فرض NPS"], ["schedule", "Schedule"]].map(([k, label, req]) => (
          <label key={k} className="wl-f">
            <span className="muted sm">{label}{req && " *"}</span>
            <input id={`wl-${k}`} dir="ltr" value={meta[k] ?? ""} onChange={onMeta(k)} required={req} />
          </label>
        ))}
      </div>

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

      <datalist id="wl-locs"><option value="Shop" /><option value="Field" /></datalist>
      <datalist id="wl-kinds"><option value="BW" /><option value="SW" /><option value="Tie-in" /><option value="Closure" /><option value="Branch" /></datalist>
      <div className={sheet ? "wl-review" : undefined}>
      {sheet && (
        <div className="wl-sheet" data-wl-sheet>
          <SheetReview src={sheet.src} marks={keptMarks} states={states} selected={picked} onSelect={pick}
            kinds={kinds} extras={extras} onExtras={run?.run?.status === "approved" ? undefined : setExtras}
            extraTool={extraTool} onExtraTool={setExtraTool} extraSel={extraSel} onExtraSel={setExtraSel}
            extraAttach={extraAttach} onExtraAttach={setExtraAttach}
            onPlace={run?.run?.status === "approved" ? undefined : place}
            legend={progress ? [["done", "جوش و NDT پذیرفته"], ["inspection", "جوش‌شده، منتظر بازرسی/NDT"], ["open", "باز"]]
              : [["checked", "بررسی شد"], ["unchecked", "بررسی نشده"]]} />
          <p className="note mono sm" data-wl-review-count>
            {nos.length - unchecked.length} از {nos.length} جوش با نقشه بررسی شد · {Object.keys(keptMarks).length} روی نقشه جا دارد
            {nos.length > 0 && <> · <button type="button" className="ghost sm" onClick={() => setReviewed(new Set(nos))}>همه بررسی شد</button></>}
          </p>
          <MarkTables items={extras} onChange={run?.run?.status === "approved" ? undefined : setExtras} tabs={["spool", "support"]}
            readOnly={run?.run?.status === "approved"} weldList={typed} selectedId={extraSel} onSelect={setExtraSel}
            attachId={extraAttach} onAttach={setExtraAttach} />
        </div>)}
      <div className="wl-table">
        <table className="dtable">
          <thead><tr><th>#</th>{sheet && <th title="با نقشه بررسی شد">✓</th>}{COLS.map(([k, label]) => <th key={k}>{label}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map((r, i) => { const no = String(r.no ?? "").trim(); return (
              <tr key={i} data-wl-row={no || undefined} className={sheet && no && picked === no ? "sel" : undefined}
                onFocus={() => sheet && no && setPicked(no)}>
                <td className="mono sm" style={sheet && no ? { cursor: "pointer" } : undefined} onClick={() => sheet && no && setPicked(no)}
                  title={sheet && no ? (marks[no] ? "روی نقشه هست — برای دیدنش کلیک کنید" : "روی نقشه جا ندارد") : undefined}>
                  {i + 1}{sheet && no ? (marks[no] ? " ⌖" : " ·") : ""}</td>
                {sheet && <td><input type="checkbox" aria-label={`ردیف ${i + 1} با نقشه بررسی شد`} disabled={!no} data-wl-check={no}
                  checked={Boolean(no) && reviewed.has(no)} onChange={(e) => tick(no, e.target.checked)} /></td>}
                {COLS.map(([k, label, ph]) => (
                  <td key={k}>
                    <input aria-label={`${label} ردیف ${i + 1}`} dir="ltr" value={r[k] ?? ""} placeholder={i === 0 ? ph : ""}
                      list={k === "loc" ? "wl-locs" : k === "kind" ? "wl-kinds" : undefined}
                      inputMode={k === "nps" ? "decimal" : undefined}
                      onChange={(e) => setCell(i, k, e.target.value)} />
                  </td>
                ))}
                <td><button className="ghost" type="button" aria-label={`حذف ردیف ${i + 1}`}
                  onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ ...BLANK_ROW }])}>×</button></td>
              </tr>); })}
          </tbody>
        </table>
      </div>
      </div>
      <div className="row">
        <button className="ghost" type="button" onClick={() => setRows([...rows, { ...BLANK_ROW }])}>+ ردیف</button>
        <button className="ghost" type="button" onClick={() => setRows([...rows, ...Array.from({ length: 10 }, () => ({ ...BLANK_ROW }))])}>+ ۱۰ ردیف</button>
      </div>

      {model.problems ? (
        <div className="err" role="alert"><b>{model.problems.length} ایراد — تا رفع نشود ذخیره نمی‌شود:</b>
          <ul>{model.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
      ) : model.register ? (
        <p className="note mono">
          {model.totals.welds} جوش · کارگاه {model.totals.shop} · سایت {model.totals.field} ·
          اسپول‌ها: {model.spoolIds.join("، ") || "—"}
        </p>
      ) : <p className="muted sm">{model.error}</p>}

      <label className="wl-f">
        <span className="muted sm">فایل نقشه (اختیاری) — PDF همین شیت، اگر دارید، همراه رجیستر ذخیره می‌شود</span>
        <input id="wl-drawing" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </label>

      {!approved && <SaveBar session={session} data={data} model={model} sourceFile={file || sheet?.file || null} onSaved={onSaved} beforeSave={beforeSave} />}
      {run && !approved && (
        <div className="row">
          <button className="ghost" onClick={approve} disabled={approval.phase === "busy"}>تأیید رجیستر (مهندس) — {run.run.docNo} Rev {run.run.revision}</button>
          {approval.msg && <span className={approval.phase === "error" ? "err" : "note mono"}>{approval.msg}</span>}
        </div>
      )}
      {approved && <p className="muted sm">✓ این رجیستر تأیید شده و قفل است. تغییر بعدی رویژن جدید نقشه می‌خواهد.</p>}
    </div>
  );
}
