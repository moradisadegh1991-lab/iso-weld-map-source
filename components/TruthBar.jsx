"use client";
import { useState } from "react";
import TemplateButton from "./ui/TemplateButton";
import { parseDelimited, guessMapping, toRegister, scopeRows } from "../lib/truth/parse.mjs";
import { compareRegister, toGoldenExpect } from "../lib/truth/compare.mjs";
import TableKit from "./ui/TableKit";

/**
 * The contractor's weld register, against ours.
 *
 * Until this exists the project can say the ENGINE is right — twenty-six
 * test cases say so — but not that the EXTRACTION is, because nothing here
 * knows what the people who welded the line actually recorded. This is the
 * only place that number can come from.
 *
 * Paste or a file: a register arrives as an Excel sheet about as often as a
 * CSV, and on a phone pasting is easier than finding a file, so both work.
 * A contractor's joint history covers the whole project; when it has a
 * drawing column, only this sheet's rows are compared (lib/truth/parse.mjs
 * scopeRows).
 *
 * `computed` overrides the model's register — for a register read from the
 * drawing's printed weld numbers, which is compared as it was read, before
 * anyone completes it.
 */
const BIG = 200_000;

const FIELD_FA = { loc: "محل (Field/Shop)", kind: "نوع جوش", nps: "قطر" };

export default function TruthBar({ model, data, computed: given = null }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [err, setErr] = useState(null);

  function read(raw) {
    setErr(null);
    try {
      const { headers, rows, suspectDelimiter } = parseDelimited(raw);
      if (!headers.length) return setErr("چیزی خوانده نشد.");
      if (suspectDelimiter) {
        return setErr(
          "جداکنندهٔ ستون‌ها شناخته نشد — کل سطر در یک ستون افتاد. " +
          "از Excel کپی کنید (Tab می‌گذارد)، یا ستون‌ها را با «کاما» یا " +
          "«دست‌کم دو فاصله» از هم جدا کنید.");
      }
      const { mapping, unmapped } = guessMapping(headers, undefined, rows);
      if (mapping.no == null) {
        return setErr(`ستون شمارهٔ جوش پیدا نشد. سرستون‌ها: ${headers.join(" · ")}`);
      }
      const meta = data?.meta || {};
      const scope = scopeRows(headers, rows, { drawingNo: meta.drawingNo, sheet: meta.sheet, rev: meta.rev });
      const truth = toRegister(scope.rows, mapping);
      if (!truth.length) {
        return setErr(scope.scoped
          ? (scope.note || `در رجیستر (${rows.length} ردیف) جوشی برای نقشهٔ «${meta.drawingNo || "—"}» برگ ${meta.sheet || "—"} پیدا نشد.`)
          : "هیچ ردیفی با شمارهٔ جوش پیدا نشد.");
      }
      setParsed({ headers, mapping, unmapped, truth, scope: { ...scope, total: rows.length } });
    } catch (e) { setErr(e.message); }
  }

  async function onFile(file) {
    if (!file) return;
    setErr(null);
    try {
      if (/\.(xlsx?|xlsm)$/i.test(file.name)) {
        // Loaded on demand: a session that only ever pastes never pays for it.
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        // A project's joint history runs to megabytes: read it, but do not
        // put it in the text box, where it would freeze the page.
        setText(csv.length > BIG ? "" : csv);
        read(csv);
      } else {
        const t = await file.text();
        setText(t);
        read(t);
      }
    } catch (e) { setErr("فایل خوانده نشد: " + e.message); }
  }

  const computed = given || (model && !model.error ? model.register : []);
  const result = parsed ? compareRegister(parsed.truth, computed) : null;

  function downloadGolden() {
    const golden = {
      id: (data?.meta?.drawingNo || "golden").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, ""),
      title: `Golden — ${data?.meta?.drawingNo || ""}`,
      provenance: "رجیستر جوش پیمانکار",
      verifiedBy: "",
      options: { strictBom: true },
      input: data,
      expect: toGoldenExpect(parsed.truth),
    };
    const blob = new Blob([JSON.stringify(golden, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${golden.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="pane">
      <p className="muted sm">
        رجیستر جوش پیمانکار را اینجا بگذارید تا با آنچه استخراج و محاسبه شده
        مقایسه شود. <b>این تنها جایی است که دقت استخراج عدد می‌شود</b> — بقیهٔ
        چک‌ها نقشه را می‌سنجند، نه خواندن نقشه را.
      </p>

      <div className="row">
        <label className="ghost filelabel">
          فایل (CSV یا Excel)
          <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm"
                 onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <TemplateButton kind="truth" className="ghost" />
        <button className="ghost" onClick={() => read(text)} disabled={!text.trim()}>
          خواندن متن
        </button>
      </div>

      <textarea
        className="mono truth-paste"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"از Excel کپی کنید، یا ستون‌ها را با کاما یا دو فاصله جدا کنید:\n\n"
          + "Weld No,Location,Type,Size\nW-01,Field,Tie-in,28\nW-02,Shop,BW,28"}
        spellCheck={false}
      />

      {err && <p className="err">{err}</p>}

      {parsed && (
        <>
          <div className="tot mono">
            {parsed.truth.length} ردیف خوانده شد
            {parsed.scope.scoped && ` (از ${parsed.scope.total} ردیف کل رجیستر، فقط این نقشه و برگ)`}
            {parsed.unmapped.length > 0 && ` · ستون نگاشته‌نشده: ${parsed.unmapped.join("، ")}`}
          </div>
          {parsed.scope.note && <p className="muted sm">{parsed.scope.note}</p>}
          {parsed.unmapped.length > 0 && (
            <p className="muted sm">
              ستونی که شناخته نشد <b>حدس زده نمی‌شود</b> — آن فیلد اصلاً سنجیده
              نمی‌شود، نه غلط حساب می‌شود نه درست.
            </p>
          )}
        </>
      )}

      {result && (
        <>
          <div className={"check " + (result.weldCountExact ? "ok" : "warn")}>
            <b>{result.weldCountExact ? "✓" : "!"} تعداد جوش</b>
            <span className="mono sm">
              پیمانکار {result.counts.truth} · محاسبه {result.counts.computed}
              {result.counts.missing > 0 && ` · ${result.counts.missing} جوش پیدا نشد`}
              {result.counts.extra > 0 && ` · ${result.counts.extra} جوش اضافه ساخته شد`}
            </span>
          </div>

          {result.counts.missing > 0 && (
            <p className="err sm">
              پیدا نشد: {result.missing.map((w) => w.no).join("، ")} — این‌ها در
              رجیستر پیمانکار هستند و در محاسبه نیستند. جوشی که پیدا نشود،
              بازرسی هم نمی‌شود.
            </p>
          )}
          {result.counts.extra > 0 && (
            <p className="err sm">
              اضافه: {result.extra.map((w) => w.no).join("، ")} — این‌ها محاسبه
              شده‌اند و در رجیستر پیمانکار نیستند.
            </p>
          )}

          <TableKit name="truth-fields"><table className="dtable">
            <thead><tr><th>فیلد</th><th>سنجیده</th><th>درست</th><th>دقت</th></tr></thead>
            <tbody>
              {Object.entries(result.fields).map(([f, s]) => (
                <tr key={f}>
                  <td>{FIELD_FA[f] || f}</td>
                  <td className="mono">{s.compared}</td>
                  <td className="mono">{s.correct}</td>
                  <td className="mono">
                    {s.measured ? `${Math.round((s.correct / s.compared) * 100)}%` : "سنجیده نشد"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></TableKit>

          {result.matched.some((m) => m.diffs.some((d) => !d.same)) && (
            <>
              <div className="tot mono">اختلاف‌ها</div>
              <TableKit name="truth-diffs"><table className="dtable">
                <thead><tr><th>جوش</th><th>فیلد</th><th>پیمانکار</th><th>محاسبه</th></tr></thead>
                <tbody>
                  {result.matched.flatMap((m) =>
                    m.diffs.filter((d) => !d.same).map((d) => (
                      <tr key={m.no + d.field}>
                        <td className="mono">{m.no}</td>
                        <td>{FIELD_FA[d.field] || d.field}</td>
                        <td className="mono">{String(d.truth)}</td>
                        <td className="mono">{String(d.computed)}</td>
                      </tr>
                    )))}
                </tbody>
              </table></TableKit>
            </>
          )}

          <div className="row">
            <button className="ghost" onClick={downloadGolden} disabled={!data}>
              دانلود مورد آزمون golden
            </button>
          </div>
          <p className="muted sm">
            فایل دانلودی <code>expect</code> را <b>از رجیستر پیمانکار</b> می‌نویسد،
            نه از خروجی این موتور. آن را در <code>eval/cases/golden/</code> بگذارید
            و <code>verifiedBy</code> را پر کنید. انتظاری که از خروجی خودمان
            ساخته شود، هر اجرای بعدی را با باگ‌های امروز موافق می‌کند.
          </p>
        </>
      )}
    </div>
  );
}
