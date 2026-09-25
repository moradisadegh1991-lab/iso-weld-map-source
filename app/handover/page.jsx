"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";

/**
 * Handover to maintenance.
 *
 * Every equipment tag with what its CMMS record needs, item by item. An item
 * the platform has no source for is shown as "unknown", not as done — and
 * holds the tag just as a missing one does. The export is neutral CSV (the
 * CMMS administrator maps it to their import layout), logged with its hash.
 */
export default function HandoverPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/handover?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("all");
  const may = can({ role }, ACTIONS.MANAGE_HANDOVER);

  async function save(body) {
    setMsg(null);
    try {
      await call("/api/handover", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const tags = data.tags;
  const ready = tags.filter((t) => t.ready).length;
  const count = (k) => tags.filter((t) => t.open.includes(k)).length;
  const rows = filter === "ready" ? tags.filter((t) => t.ready) : filter === "open" ? tags.filter((t) => !t.ready) : tags;
  const s = data.settings;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>تحویل به نگهداری (CMMS)</h1>
        <span className="sub">{ready} از {tags.length} تگ تجهیز آمادهٔ تحویل</span>
      </div>
      {msg && <p className="err">{msg}</p>}
      {(!s.flocTemplate || !s.levels.length) && (
        <p className="err">در <a href="/project">مشخصات پروژه</a> {!s.flocTemplate && "الگوی Functional Location"}{!s.flocTemplate && !s.levels.length && " و "}{!s.levels.length && "سطوح Criticality"} تعیین نشده — تا تعیین نشود، هیچ تگی آمادهٔ تحویل نیست.</p>
      )}

      <div className="kpis">
        <Kpi v={`${ready}/${tags.length}`} l="آمادهٔ تحویل" tone={ready && ready === tags.length ? "ok" : ""} />
        <Kpi v={count("class")} l="بدون کلاس ISO 14224" tone={count("class") ? "warn" : ""} />
        <Kpi v={count("criticality")} l="بدون Criticality" tone={count("criticality") ? "warn" : ""} />
        <Kpi v={tags.filter((t) => t.open.some((k) => ["manufacturer", "model", "serial"].includes(k))).length} l="پلاک ناقص" b="سازنده، مدل، سریال" />
        <Kpi v={count("mc")} l="MC پذیرفته نشده" />
        <Kpi v={count("iom")} l="دفترچهٔ O&M تأییدنشده یا نامعلوم" />
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>شناسنامهٔ نگهداری تجهیزات</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="field" style={{ margin: 0 }}>
              <select aria-label="فیلتر" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">همه</option><option value="open">ناقص</option><option value="ready">آماده</option>
              </select>
            </div>
            {may && <a className="btn" href={`/api/handover?projectId=${projectId}&format=csv`} download>خروجی CSV (همه)</a>}
            {may && <a className="btn ghost" href={`/api/handover?projectId=${projectId}&format=csv&readyOnly=1`} download>فقط آماده‌ها</a>}
          </div>
        </div>
        <p className="muted sm">کلاس از ISO 14224 پیوست A و به انتخاب مهندس — از پیشوند تگ حدس زده نمی‌شود. «نامعلوم» یعنی پلتفرم منبعی برای قضاوت ندارد و مثل «ناقص» تحویل را نگه می‌دارد.</p>
        <TableKit name="handover">
          <table className="dtable">
            <thead><tr><th>تگ</th><th>Functional Location</th><th>کلاس</th><th>Crit.</th><th>سازنده / مدل / سریال</th><th>باز</th><th /></tr></thead>
            <tbody>
              {rows.map((t) => [
                <tr key={t.id}>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}><a href={`/asset?tag=${encodeURIComponent(t.tagNo)}`}>{t.tagNo}</a><div className="muted sm">{t.description}</div></td>
                  <td className="mono sm">{t.floc.code || <span className="muted">{t.floc.reason}</span>}</td>
                  <td className="sm">{t.master.isoClass ? <><span className="mono">{t.master.isoClass}</span> <span className="muted">{t.classLabel}</span></> : "—"}</td>
                  <td className="mono">{t.master.criticality || "—"}</td>
                  <td className="sm">{[t.master.manufacturer, t.master.model, t.master.serialNo].map((x) => x || "—").join(" / ")}
                    {!t.master.manufacturer && t.vendorHint && <div className="muted">فروشندهٔ PO: {t.vendorHint} (تأیید نشده)</div>}</td>
                  <td className="sm">{t.ready ? <span className="pill ok">آماده</span> : t.items.filter((i) => i.ok !== true).map((i) => (
                    <span key={i.key} className={`pill ${i.ok === null ? "" : "bad"}`} style={{ marginInlineEnd: 4 }} title={i.note || ""}>
                      {data.checks[i.key]}{i.ok === null ? " — نامعلوم" : ""}</span>))}</td>
                  <td>{may && <button className="btn ghost" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? "بستن" : "ویرایش"}</button>}</td>
                </tr>,
                open === t.id && <tr key={t.id + "-x"}><td colSpan={7}><MasterForm t={t} data={data} save={save} /></td></tr>,
              ])}
            </tbody>
          </table>
        </TableKit>
      </div>

      {data.exports.length > 0 && (
        <div className="card">
          <h2>خروجی‌های گرفته‌شده</h2>
          <ul className="sm">{data.exports.map((e) => (
            <li key={e.id}>{new Date(e.at).toLocaleString("fa-IR")} — {e.by_name || "?"} — {e.rows_total} ردیف ({e.rows_ready} آماده) — <span className="mono">SHA-256 {e.sha256.slice(0, 16)}…</span></li>
          ))}</ul>
        </div>
      )}
    </div>
  );
}

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}

function MasterForm({ t, data, save }) {
  const [f, setF] = useState({ isoClass: t.master.isoClass || "", criticality: t.master.criticality || "",
    criticalityBasis: t.master.criticalityBasis || "", manufacturer: t.master.manufacturer || "", model: t.master.model || "",
    serialNo: t.master.serialNo || "", yearBuilt: t.master.yearBuilt ?? "" });
  const [hist, setHist] = useState(null);
  const { projectId, call } = usePlatform();
  // Re-read after every successful save — even one that changed nothing is
  // a revision on record.
  const [saved, setSaved] = useState(0);
  useEffect(() => {
    call(`/api/handover?projectId=${projectId}&tagId=${t.id}`).then((r) => setHist(r.history)).catch(() => setHist([]));
  }, [t.id, saved, projectId, call]);
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await save({ tagId: t.id, ...f })) setSaved((n) => n + 1); }}>
      <div className="grid2">
        <div className="field"><label htmlFor={`ic-${t.id}`}>کلاس ISO 14224</label>
          <select id={`ic-${t.id}`} value={f.isoClass} onChange={(e) => setF({ ...f, isoClass: e.target.value })}>
            <option value="">—</option>
            {Object.entries(data.classes).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
          </select></div>
        <div className="field"><label htmlFor={`cr-${t.id}`}>Criticality</label>
          <select id={`cr-${t.id}`} value={f.criticality} onChange={(e) => setF({ ...f, criticality: e.target.value })} disabled={!data.settings.levels.length}>
            <option value="">—</option>
            {data.settings.levels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select></div>
        <Field id={`cb-${t.id}`} label="مبنای Criticality (گزارش ارزیابی)" value={f.criticalityBasis} on={(v) => setF({ ...f, criticalityBasis: v })} />
        <Field id={`mf-${t.id}`} label="سازنده (از پلاک)" value={f.manufacturer} on={(v) => setF({ ...f, manufacturer: v })} />
        <Field id={`md-${t.id}`} label="مدل" value={f.model} on={(v) => setF({ ...f, model: v })} />
        <Field id={`sn-${t.id}`} label="شمارهٔ سریال" value={f.serialNo} on={(v) => setF({ ...f, serialNo: v })} />
        <Field id={`yb-${t.id}`} label="سال ساخت" value={f.yearBuilt} on={(v) => setF({ ...f, yearBuilt: v })} />
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "start", marginTop: 8 }}>
        <button className="btn" type="submit">ذخیره</button>
        {hist && hist.length > 0 && (
          <ol className="sm muted" style={{ margin: 0 }}>{hist.map((h) => (
            <li key={h.id}>{new Date(h.at).toLocaleString("fa-IR")} — {h.by_name || "?"}: {h.snapshot.isoClass || "—"} · {h.snapshot.criticality || "—"} · {h.snapshot.serialNo || "—"}</li>
          ))}</ol>
        )}
      </div>
    </form>
  );
}

function Field({ id, label, value, on }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} dir="auto" value={value} onChange={(e) => on(e.target.value)} />
    </div>
  );
}
