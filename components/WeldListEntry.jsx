"use client";
import { useMemo, useState } from "react";
import SaveBar from "./SaveBar";
import { parseDelimited, guessMapping, normalizeLoc } from "../lib/truth/parse.mjs";
import { LIST_PATTERNS, modelFromWeldList } from "../lib/register/weld-list.mjs";

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
 */
const COLS = [
  ["no", "شمارهٔ جوش", "W-01"],
  ["spool", "اسپول", "SP-01"],
  ["loc", "محل (Shop / Field)", "Shop"],
  ["kind", "نوع (BW، SW، Tie-in…)", "BW"],
  ["nps", "قطر NPS", ""],
  ["ref", "اتصال به (برای Tie-in)", ""],
];
const BLANK_ROW = { no: "", spool: "", loc: "", kind: "", nps: "", ref: "" };
const BLANK_META = { drawingNo: "", rev: "", sheet: "1/1", lineNo: "", unit: "", pipingClass: "", nps: "", schedule: "" };
const TEMPLATE_HEAD = ["Weld No", "Spool No", "Shop/Field", "Weld Type", "NPS", "Tie-in Ref"];

export default function WeldListEntry({ session, initial = null, run = null, onSaved, onClose }) {
  const [meta, setMeta] = useState({ ...BLANK_META, ...(initial?.meta || {}) });
  const [rows, setRows] = useState(initial?.weldList?.length ? initial.weldList.map((r) => ({ ...BLANK_ROW, ...r })) : [{ ...BLANK_ROW }, { ...BLANK_ROW }, { ...BLANK_ROW }]);
  const [file, setFile] = useState(null);
  const [paste, setPaste] = useState("");
  const [read, setRead] = useState(null);
  const [approval, setApproval] = useState({ phase: "idle" });

  const typed = rows.filter((r) => Object.values(r).some((v) => String(v ?? "").trim()));
  const data = useMemo(() => ({ meta: { ...meta, nps: meta.nps === "" ? null : Number(meta.nps) }, weldList: typed }), [meta, typed]);
  const model = useMemo(() => (typed.length ? modelFromWeldList(data) : { error: "هنوز جوشی وارد نشده است." }), [data, typed.length]);

  const setCell = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const onMeta = (k) => (e) => setMeta({ ...meta, [k]: e.target.value });

  /** Header row + rows, however they arrived: the columns are found by name, never by position. */
  function fromText(text, source) {
    const { headers, rows: raw, suspectDelimiter } = parseDelimited(text);
    if (!headers.length) return setRead({ error: `${source}: خالی است.` });
    if (suspectDelimiter) return setRead({ error: `${source}: ستون‌ها از هم جدا نشدند — از Excel کپی کنید یا CSV بدهید.` });
    const { mapping, unmapped } = guessMapping(headers, LIST_PATTERNS);
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
        fromText(XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]), `«${f.name}» (برگ ${wb.SheetNames[0]})`);
      } else fromText(await f.text(), `«${f.name}»`);
    } catch (e) { setRead({ error: `«${f.name}»: ${e.message}` }); }
  }

  async function template() {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEAD,
      ["W-01", "", "Field", "Tie-in", 3, "P-7001 discharge N2"], ["W-02", "SP-01", "Shop", "BW", 3, ""]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Weld list");
    XLSX.writeFile(wb, "weld-list-template.xlsx");
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
          <button className="ghost" type="button" onClick={template}>دانلود قالب Excel</button>
        </div>
        <textarea id="wl-paste" rows={4} dir="ltr" value={paste} onChange={(e) => setPaste(e.target.value)}
          placeholder={"Weld No\tSpool No\tShop/Field\tWeld Type\tNPS\nW-01\t\tField\tTie-in\t3"} style={{ width: "100%", minHeight: 0, height: 90 }} />
        <button className="ghost" type="button" disabled={!paste.trim()} onClick={() => fromText(paste, "متن چسبانده‌شده")}>خواندن متن</button>
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
      <div className="wl-table">
        <table className="dtable">
          <thead><tr><th>#</th>{COLS.map(([k, label]) => <th key={k}>{label}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="mono sm">{i + 1}</td>
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
              </tr>
            ))}
          </tbody>
        </table>
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

      {!approved && <SaveBar session={session} data={data} model={model} sourceFile={file} onSaved={onSaved} />}
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
