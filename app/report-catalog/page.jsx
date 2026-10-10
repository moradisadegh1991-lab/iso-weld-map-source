"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";

/**
 * The daily report's catalogue: the roles, machines and materials the form
 * suggests as the writer types, each with its kind and — for what is not
 * counted in heads or machines — its unit. The old Access daily report's
 * list can be brought in once; items it got wrong are listed, not hidden.
 */
const BLANK = { itemKind: "person", name: "", discipline: "", unit: "" };

export default function ReportCatalogPage() {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/report-catalog?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [f, setF] = useState(BLANK);

  async function post(body) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/report-catalog", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const may = data.may.edit;
  const counts = Object.fromEntries(Object.keys(data.kinds).map((k) => [k, data.items.filter((i) => i.kind === k).length]));
  const shown = data.items.filter((i) => (!kind || i.kind === kind) && (!q || `${i.name} ${i.discipline || ""} ${i.name_en || ""}`.includes(q)));

  return (
    <div className="page">
      <div className="pagehead"><h1>فهرست منابع گزارش روزانه</h1>
        <span className="sub">{data.items.length} مورد · {data.items.filter((i) => i.active).length} فعال</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}

      <div className="moneyrow">
        {Object.entries(data.kinds).map(([k, t]) => <div key={k}><span>{t}</span><b>{counts[k]}</b></div>)}
      </div>

      {data.bundled && (
        <div className="card">
          <h2>فهرست گزارش روزانهٔ قبلی (Access)</h2>
          <p className="sm">{data.bundled.items} مورد از <span className="mono">{data.bundled.source}</span>؛ {data.bundled.duplicates} نام تکراری یکی شد.
            سمت‌ها بدون واحد «نفرساعت» وارد می‌شوند (عددهای آن فایل تعداد نفر بود، نه ساعت). مواردی که این پروژه از قبل دارد دست نمی‌خورند.</p>
          {may && <button className="btn" type="button" onClick={async () => {
            const r = await post({ kind: "import-access" }); if (r) setOk(`${r.row.added} مورد افزوده شد؛ ${r.row.kept} مورد از قبل بود.`); }}>ورود این فهرست به پروژه</button>}
          <details className="inlinefold"><summary>{data.bundled.problems.length} مورد که باید بررسی شود</summary>
            <ul className="sm">{data.bundled.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </details>
        </div>
      )}

      <div className="card">
        <h2>فهرست</h2>
        <div className="grid2">
          <div className="field"><label htmlFor="c-kind">نوع</label>
            <select id="c-kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">همه</option>
              {Object.entries(data.kinds).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
          <div className="field"><label htmlFor="c-q">جست‌وجو</label><input id="c-q" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {shown.length === 0 ? <p className="empty-note">موردی نیست.</p> : (
          <div className="tablewrap"><table className="dtable">
            <thead><tr><th>نام</th><th>نوع</th><th>رشته / گروه</th><th>واحد</th><th>منبع</th><th>وضعیت</th></tr></thead>
            <tbody>{shown.slice(0, 500).map((i) => (
              <tr key={i.id} style={i.active ? undefined : { opacity: 0.55 }}>
                <td>{i.name}{i.name_en && <div className="muted sm" dir="ltr">{i.name_en}</div>}</td>
                <td className="sm">{data.kinds[i.kind]}</td><td className="sm">{i.discipline || "—"}</td>
                <td className="sm">{i.unit || (["person", "machine"].includes(i.kind) ? (i.kind === "person" ? "نفر" : "دستگاه") : "—")}</td>
                <td className="sm muted">{i.source === "manual" ? "ورود دستی" : "گزارش روزانهٔ قبلی"}</td>
                <td>{may ? <button className="btn ghost sm" type="button" onClick={() => post({ kind: "active", id: i.id, active: !i.active })}>
                  {i.active ? "فعال — غیرفعال کن" : "غیرفعال — فعال کن"}</button> : (i.active ? "فعال" : "غیرفعال")}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {shown.length > 500 && <p className="muted sm">۵۰۰ مورد اول نشان داده شد؛ جست‌وجو را دقیق‌تر کنید.</p>}
      </div>

      {may && (
        <div className="card">
          <h2>افزودن مورد</h2>
          <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "add", ...f })) setF({ ...BLANK, itemKind: f.itemKind }); }}>
            <div className="grid2">
              <div className="field"><label htmlFor="a-kind">نوع</label>
                <select id="a-kind" value={f.itemKind} onChange={(e) => setF({ ...f, itemKind: e.target.value })}>
                  {Object.entries(data.kinds).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
              <div className="field"><label htmlFor="a-name">نام</label><input id="a-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
              <div className="field"><label htmlFor="a-disc">رشته / گروه</label><input id="a-disc" value={f.discipline} onChange={(e) => setF({ ...f, discipline: e.target.value })} /></div>
              {!["person", "machine"].includes(f.itemKind) && (
                <div className="field"><label htmlFor="a-unit">واحد</label><input id="a-unit" required value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
              )}
            </div>
            <button className="btn" type="submit">افزودن</button>
          </form>
        </div>
      )}
    </div>
  );
}
