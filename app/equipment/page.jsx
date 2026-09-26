"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { parseEquipmentList, summarise } from "../../lib/equipment/parse.mjs";
import { EQUIPMENT_KINDS } from "../../lib/platform/precedence.mjs";
import TableKit from "../../components/ui/TableKit";
import Tabs from "../../components/ui/Tabs";

/**
 * Equipment tags: import a list, then work the two queues it produces.
 *
 * The queues are the screen. A tag nobody could classify has no precedence
 * chain, so nothing knows what it is waiting for; a tag that IS classified
 * has a chain, and the useful question becomes which crew can move today.
 * Both are shown by name — a count sends nobody anywhere.
 */
// One list, declared beside the chains — see EQUIPMENT_KINDS.
const KIND_FA = EQUIPMENT_KINDS;
const DISCIPLINE_FA = {
  piping: "پایپینگ", structural: "استراکچر", electrical: "برق",
  instrumentation: "ابزار دقیق", civil: "سیویل", equipment: "تجهیزات",
};

export default function EquipmentPage() {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/equipment?projectId=${id}`, []);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [report, setReport] = useState(null);
  const [msg, setMsg] = useState(null);

  function read(raw) {
    setMsg(null); setParsed(null); setReport(null);
    const r = parseEquipmentList(raw);
    if (r.error) return setMsg(r.error);
    if (!r.tags.length) return setMsg("هیچ ردیفی با شمارهٔ تگ پیدا نشد.");
    setParsed(r);
  }

  async function onFile(file) {
    if (!file) return;
    try {
      if (/\.(xlsx?|xlsm)$/i.test(file.name)) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
        setText(csv); read(csv);
      } else {
        const t = await file.text();
        setText(t); read(t);
      }
    } catch (e) { setMsg("فایل خوانده نشد: " + e.message); }
  }

  async function doImport(dryRun) {
    setMsg(null);
    try {
      const { report: r } = await call("/api/equipment", {
        method: "POST",
        body: JSON.stringify({ projectId, tags: parsed.tags, dryRun }),
      });
      setReport({ ...r, dryRun });
      if (!dryRun) { setParsed(null); setText(""); await reload(); }
    } catch (e) { setMsg(e.message); }
  }

  async function classify(tagId, kind) {
    try {
      await call("/api/equipment", { method: "POST", body: JSON.stringify({ projectId, tagId, kind }) });
      await reload();
    } catch (e) { setMsg(e.message); }
  }

  if (error) return <p className="err">{error}</p>;
  const sum = parsed ? summarise(parsed) : null;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>تجهیزات</h1>
        <span className="sub">{data ? `${data.tags.length} تگ` : "…"}</span>
      </div>

      <Tabs name="equipment">
      {data?.unclassified?.length > 0 && (
        <div className="card" data-keep style={{ borderColor: "rgba(224,163,62,.5)" }}>
          <h2 style={{ color: "var(--warn)" }}>
            {data.unclassified.length} تگ در انتظار تعیین نوع
          </h2>
          <p className="muted sm">
            پارسر عمداً حدس نزده. یک ماشین دوّار الایمنت و کنترل تنش لوله دارد و
            یک تجهیز ثابت ندارد؛ حدسِ غلط یعنی برداشتن یک hold point واقعی.
          </p>
          <TableKit name="equipment">
            <table className="dtable">
              <thead><tr><th>تگ</th><th>شرح</th><th>تعیین نوع</th></tr></thead>
              <tbody>
                {data.unclassified.map((t) => (
                  <tr key={t.id}>
                    <td className="mono"><a className="cy" href={`/asset?tag=${encodeURIComponent(t.tag_no)}`}>{t.tag_no}</a></td>
                    <td>{t.description || "—"}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      {Object.entries(KIND_FA).map(([k, v]) => (
                        <button key={k} className="btn ghost" style={{ padding: "4px 10px" }}
                                onClick={() => classify(t.id, k)}>{v}</button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableKit>
        </div>
      )}

      {data?.blocked?.length > 0 && (
        <div className="card">
          <h2>چه کاری امروز می‌تواند شروع شود</h2>
          <p className="muted sm">
            «بسته» ذخیره نمی‌شود — هر بار از روی پیش‌نیازها حساب می‌شود، پس لحظه‌ای
            که پیش‌نیاز تمام شود این فهرست خودش عوض می‌شود.
          </p>
          <TableKit name="equipment">
            <table className="dtable">
              <thead><tr><th>تگ</th><th>پیشرفت</th><th>منتظرِ</th><th>رشته</th></tr></thead>
              <tbody>
                {data.blocked.map((b) => (
                  <tr key={b.tagId}>
                    <td className="mono">{b.tagNo}</td>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="bar"><i style={{ width: `${b.pct}%` }} /></span>
                        <span className="mono sm">{b.pct}%</span>
                      </span>
                    </td>
                    <td>{b.rootCauses.map((c) => c.title).join("، ") || "—"}</td>
                    <td className="sm">
                      {[...new Set(b.rootCauses.map((c) => DISCIPLINE_FA[c.discipline] || c.discipline))]
                        .join("، ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableKit>
        </div>
      )}

      {data?.tags?.length > 0 && (
        <div className="card">
          <h2>تگ‌ها</h2>
          <TableKit name="equipment">
            <table className="dtable">
              <thead><tr><th>تگ</th><th>شرح</th><th>نوع</th><th>ساب‌سیستم</th></tr></thead>
              <tbody>
                {data.tags.map((t) => (
                  <tr key={t.id}>
                    <td className="mono"><a className="cy" href={`/asset?tag=${encodeURIComponent(t.tag_no)}`}>{t.tag_no}</a></td>
                    <td>{t.description || "—"}</td>
                    <td className={t.kind ? "" : "muted"}>{KIND_FA[t.kind] || "نامشخص"}</td>
                    <td className="mono">{t.subsystem || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableKit>
        </div>
      )}

      <div className="card">
        <h2>ورود لیست تجهیزات</h2>
        <p className="muted sm">
          <b>هیچ مدلی اینجا اجرا نمی‌شود</b> — یک جدول را پارسر می‌خواند، و پارسر
          نمی‌تواند تگی بسازد که در فایل نبوده.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label className="btn ghost" style={{ cursor: "pointer" }}>
            فایل (Excel یا CSV)
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm" hidden
                   onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <button className="btn ghost" onClick={() => read(text)} disabled={!text.trim()}>
            خواندن متن
          </button>
        </div>
        <div className="field">
          <textarea className="mono" dir="ltr" value={text} spellCheck={false}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={"Tag No,Description,Type,Subsystem\nP-2101A,Feed Pump,Centrifugal,21-01"} />
        </div>

        {msg && <p className="err">{msg}</p>}

        {sum && (
          <>
            <p className="mono sm">
              {sum.total} تگ · {Object.entries(KIND_FA).map(([k, v]) => `${v} ${sum[k]}`).join(" · ")}
              {sum.unclassified > 0 && ` · نامشخص ${sum.unclassified}`} · {sum.pctClassified}% خودکار
              {parsed.skipped.length > 0 && ` · ${parsed.skipped.length} سطر تگ نبود`}
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn ghost" onClick={() => doImport(true)}>پیش‌نمایش</button>
              <button className="btn" onClick={() => doImport(false)}>ثبت در پروژه</button>
            </div>
          </>
        )}

        {report && (
          <p className={"pill " + (report.dryRun ? "" : "ok")}>
            {report.dryRun ? "پیش‌نمایش: " : "ثبت شد: "}
            {report.created} جدید · {report.updated} به‌روزرسانی ·
            {" "}{report.subsystems} ساب‌سیستم
            {report.unclassified.length > 0 && ` · ${report.unclassified.length} نامشخص`}
            {report.unfiled.length > 0 && ` · ${report.unfiled.length} بدون ساب‌سیستم`}
          </p>
        )}
      </div>
      </Tabs>
    </div>
  );
}
