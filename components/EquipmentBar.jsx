"use client";
import { useState } from "react";
import { parseEquipmentList, summarise } from "../lib/equipment/parse.mjs";

/**
 * Importing an equipment list.
 *
 * NO MODEL RUNS HERE. An equipment list is a table, and for a table a parser
 * beats a model on every axis that matters: it is instant, it is free, and
 * it cannot return a tag number that was not in the file. The model is kept
 * for the scanned case only (the `equipment` pass in app/api/extract).
 *
 * The screen is built around the number that decides whether the import is
 * safe to accept: how many tags the parser could NOT place. Those are the
 * ones a person has to look at, and they are shown by name rather than as a
 * count, because "۳ مورد نامشخص" sends nobody anywhere.
 */

const KIND_FA = { rotating: "دوّار", static: "ثابت" };

export default function EquipmentBar() {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [err, setErr] = useState(null);

  function read(raw) {
    setErr(null);
    setParsed(null);
    try {
      const r = parseEquipmentList(raw);
      if (r.error) return setErr(r.error);
      if (!r.tags.length) return setErr("هیچ ردیفی با شمارهٔ تگ پیدا نشد.");
      setParsed(r);
    } catch (e) { setErr(e.message); }
  }

  async function onFile(file) {
    if (!file) return;
    setErr(null);
    try {
      if (/\.(xlsx?|xlsm)$/i.test(file.name)) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
        setText(csv);
        read(csv);
      } else {
        const t = await file.text();
        setText(t);
        read(t);
      }
    } catch (e) { setErr("فایل خوانده نشد: " + e.message); }
  }

  const sum = parsed ? summarise(parsed) : null;
  const unplaced = parsed ? parsed.tags.filter((t) => !t.kind) : [];

  function downloadJson() {
    const blob = new Blob([JSON.stringify({ tags: parsed.tags }, null, 2)],
      { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "equipment-tags.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="pane">
      <p className="muted sm">
        لیست تجهیزات را اینجا بگذارید تا تگ‌ها و زیرسیستم‌ها خوانده شوند.
        <b> هیچ مدلی اینجا اجرا نمی‌شود</b> — یک جدول را پارسر می‌خواند، و
        پارسر نمی‌تواند تگی بسازد که در فایل نبوده.
      </p>

      <div className="row">
        <label className="ghost filelabel">
          فایل (Excel یا CSV)
          <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm"
                 onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <button className="ghost" onClick={() => read(text)} disabled={!text.trim()}>
          خواندن متن
        </button>
      </div>

      <textarea
        className="mono truth-paste"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"از Excel کپی کنید:\n\n"
          + "Tag No,Description,Type,Subsystem\n"
          + "P-2101A,Feed Pump,Centrifugal,21-01\n"
          + "V-2101,Feed Surge Drum,Vertical,21-01"}
        spellCheck={false}
      />

      {err && <p className="err">{err}</p>}

      {sum && (
        <>
          <div className="tot mono">
            {sum.total} تگ · دوّار {sum.rotating} · ثابت {sum.static}
            {sum.unclassified > 0 && ` · نامشخص ${sum.unclassified}`}
            {parsed.skipped.length > 0 && ` · ${parsed.skipped.length} سطر تگ نبود`}
          </div>

          <div className={"check " + (sum.unclassified === 0 ? "ok" : "warn")}>
            <b>{sum.unclassified === 0 ? "✓" : "!"} تشخیص نوع</b>
            <span className="mono sm">{sum.pctClassified}% خودکار</span>
          </div>

          {parsed.duplicates.length > 0 && (
            <p className="err sm">
              تکراری: {parsed.duplicates.join("، ")} — دو سطر برای یک تگ، که ممکن
              است با هم نخوانند. فقط اولی نگه داشته شد.
            </p>
          )}

          {unplaced.length > 0 && (
            <>
              <p className="muted sm">
                این‌ها را <b>پارسر عمداً حدس نزده</b>. زنجیرهٔ پیش‌نیاز یک ماشین
                دوّار الایمنت و کنترل تنش لوله دارد و یک تجهیز ثابت ندارد؛ حدسِ
                غلط یعنی برداشتن یک hold point واقعی.
              </p>
              <table>
                <thead><tr><th>تگ</th><th>شرح</th><th>چرا تعیین نشد</th></tr></thead>
                <tbody>
                  {unplaced.map((t) => (
                    <tr key={t.tagNo}>
                      <td className="mono">{t.tagNo}</td>
                      <td>{t.description || "—"}</td>
                      <td className="muted sm">{t.kindReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="tot mono">تگ‌های خوانده‌شده</div>
          <table>
            <thead><tr><th>تگ</th><th>شرح</th><th>نوع</th><th>زیرسیستم</th></tr></thead>
            <tbody>
              {parsed.tags.map((t) => (
                <tr key={t.tagNo}>
                  <td className="mono">{t.tagNo}</td>
                  <td>{t.description || "—"}</td>
                  <td className={t.kind ? "" : "muted"}>{KIND_FA[t.kind] || "نامشخص"}</td>
                  <td className="mono">{t.subsystem || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {parsed.skipped.length > 0 && (
            <p className="muted sm">
              تگ به نظر نرسید و رد شد: {parsed.skipped.join("، ")} — سطر عنوان،
              جمع یا جداکننده. رد شدن‌شان عمدی است: یک سطر «TOTAL» که تگ شود،
              زیرسیستمی می‌سازد که تا ابد منتظرش می‌ماند.
            </p>
          )}

          <div className="row">
            <button className="ghost" onClick={downloadJson}>دانلود تگ‌ها (JSON)</button>
          </div>
        </>
      )}
    </div>
  );
}
