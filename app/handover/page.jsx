"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Maintenance from "./Maintenance";

/**
 * Handover to maintenance.
 *
 * Every equipment tag with what its CMMS record needs, item by item. An item
 * the platform has no source for is shown as "unknown", not as done — and
 * holds the tag just as a missing one does. The export is neutral CSV (the
 * CMMS administrator maps it to their import layout), logged with its hash.
 *
 * The other tabs are what the CMMS needs besides the asset master: the
 * maintenance plan, spare parts and periodic calibration (./Maintenance.jsx).
 */
const TABS = [["master", "شناسنامهٔ تجهیزات"], ["pm", "برنامهٔ PM"], ["spares", "قطعات یدکی (SPIR)"], ["calibration", "کالیبراسیون دوره‌ای"]];
export default function HandoverPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/handover?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState("master");
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

      <div className="tabs" role="tablist" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {TABS.map(([k, t]) => <button key={k} role="tab" aria-selected={tab === k} className={`btn ${tab === k ? "" : "ghost"}`} onClick={() => setTab(k)}>{t}</button>)}
      </div>
      {tab !== "master" ? <Maintenance key={tab} tab={tab} may={may} /> : <>
      <div className="kpis">
        <Kpi v={`${ready}/${tags.length}`} l="آمادهٔ تحویل" tone={ready && ready === tags.length ? "ok" : ""} />
        <Kpi v={count("class")} l="بدون کلاس ISO 14224" tone={count("class") ? "warn" : ""} />
        <Kpi v={count("criticality")} l="بدون Criticality" tone={count("criticality") ? "warn" : ""} />
        <Kpi v={tags.filter((t) => t.open.some((k) => ["manufacturer", "model", "serial"].includes(k))).length} l="پلاک ناقص" b="سازنده، مدل، سریال" />
        <Kpi v={count("mc")} l="MC پذیرفته نشده" />
        <Kpi v={count("iom")} l="دفترچهٔ O&M تأییدنشده یا نامعلوم" />
        <Kpi v={count("pm")} l="بدون برنامهٔ PM تأییدشده" tone={count("pm") ? "warn" : ""} />
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
                  <td className="mono" style={{ whiteSpace: "nowrap" }}><a href={`/asset?tag=${encodeURIComponent(t.tagNo)}`}>{t.tagNo}</a><div className="muted sm">{t.description}</div>
                    {(t.master.designPressureBarg || t.master.designTempMinC || t.master.designTempMaxC) && (
                      <div className="muted sm">{t.master.designPressureBarg ? `${t.master.designPressureBarg} barg` : ""}
                        {(t.master.designTempMinC || t.master.designTempMaxC) ? ` · ${t.master.designTempMinC ?? "?"}…${t.master.designTempMaxC ?? "?"}°C` : ""}
                        {t.datasheetLabel ? ` (${t.datasheetLabel})` : ""}</div>)}
                    {t.dcsPoints > 0 && <div className="muted sm">DCS/Historian: {t.dcsPoints} پارامتر</div>}</td>
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
            <li key={e.id}>{new Date(e.at).toLocaleString("fa-IR")} — {EXPORT_FA[e.kind] || e.kind} — {e.by_name || "?"} — {e.rows_total} ردیف{e.kind === "asset_master" ? ` (${e.rows_ready} آماده)` : ""} — <span className="mono">SHA-256 {e.sha256.slice(0, 16)}…</span></li>
          ))}</ul>
        </div>
      )}
      </>}
    </div>
  );
}

const EXPORT_FA = { asset_master: "شناسنامه", pm_plan: "برنامهٔ PM", spares: "قطعات یدکی", calibration: "کالیبراسیون" };

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}

function MasterForm({ t, data, save }) {
  const [f, setF] = useState({ isoClass: t.master.isoClass || "", criticality: t.master.criticality || "",
    criticalityBasis: t.master.criticalityBasis || "", manufacturer: t.master.manufacturer || "", model: t.master.model || "",
    serialNo: t.master.serialNo || "", yearBuilt: t.master.yearBuilt ?? "",
    designPressureBarg: t.master.designPressureBarg ?? "", designTempMinC: t.master.designTempMinC ?? "",
    designTempMaxC: t.master.designTempMaxC ?? "", datasheetRevisionId: t.master.datasheetRevisionId || "" });
  const [hist, setHist] = useState(null);
  const [datasheets, setDatasheets] = useState([]);
  const [points, setPoints] = useState([]);
  const [pf, setPf] = useState({ label: "", dcsTag: "", historianTag: "", uom: "" });
  const [pmsg, setPmsg] = useState(null);
  const { projectId, call } = usePlatform();
  // Re-read after every successful save — even one that changed nothing is
  // a revision on record.
  const [saved, setSaved] = useState(0);
  useEffect(() => {
    call(`/api/handover?projectId=${projectId}&tagId=${t.id}`).then((r) => { setHist(r.history); setDatasheets(r.datasheets); setPoints(r.dcsPoints); }).catch(() => { setHist([]); setDatasheets([]); setPoints([]); });
  }, [t.id, saved, projectId, call]);
  async function addPoint(e) {
    e.preventDefault(); setPmsg(null);
    if (await save({ kind: "dcs-add", tagId: t.id, ...pf })) { setPf({ label: "", dcsTag: "", historianTag: "", uom: "" }); setSaved((n) => n + 1); }
    else setPmsg("ثبت نشد");
  }
  return (
    <>
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
      <p className="sm muted" style={{ marginTop: 10, marginBottom: 2 }}>شرایط طراحی — فقط با ارجاع به رویژن دیتاشیت همین تگ در کنترل مدارک</p>
      <div className="grid2">
        <div className="field"><label htmlFor={`ds-${t.id}`}>رویژن دیتاشیت</label>
          <select id={`ds-${t.id}`} value={f.datasheetRevisionId} onChange={(e) => setF({ ...f, datasheetRevisionId: e.target.value })}>
            <option value="">—</option>
            {datasheets.map((d) => <option key={d.id} value={d.id}>{d.doc_no} Rev.{d.revision} ({d.purpose})</option>)}
          </select>
          {!datasheets.length && <span className="muted sm">دیتاشیتی برای این تگ در کنترل مدارک ثبت نشده</span>}</div>
        <Field id={`dp-${t.id}`} label="فشار طراحی (barg)" value={f.designPressureBarg} on={(v) => setF({ ...f, designPressureBarg: v })} />
        <Field id={`tmin-${t.id}`} label="کمینهٔ دمای طراحی (°C)" value={f.designTempMinC} on={(v) => setF({ ...f, designTempMinC: v })} />
        <Field id={`tmax-${t.id}`} label="بیشینهٔ دمای طراحی (°C)" value={f.designTempMaxC} on={(v) => setF({ ...f, designTempMaxC: v })} />
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
    <div style={{ marginTop: 14 }}>
      <p className="sm muted" style={{ marginBottom: 4 }}>شناسه‌های DCS / Historian</p>
      {points.length > 0 && (
        <table className="dtable" style={{ marginBottom: 8 }}>
          <thead><tr><th>پارامتر</th><th>DCS</th><th>Historian</th><th>واحد</th><th /></tr></thead>
          <tbody>{points.map((p) => (
            <tr key={p.id}>
              <td className="sm">{p.label}</td><td className="mono sm">{p.dcs_tag || "—"}</td>
              <td className="mono sm">{p.historian_tag || "—"}</td><td className="sm">{p.uom || "—"}</td>
              <td><button type="button" className="btn ghost sm" onClick={async () => { if (await save({ kind: "dcs-remove", id: p.id })) setSaved((n) => n + 1); }}>حذف</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <form onSubmit={addPoint} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <Field id={`pl-${t.id}`} label="پارامتر" value={pf.label} on={(v) => setPf({ ...pf, label: v })} />
        <Field id={`pd-${t.id}`} label="DCS tag" value={pf.dcsTag} on={(v) => setPf({ ...pf, dcsTag: v })} />
        <Field id={`ph-${t.id}`} label="Historian tag" value={pf.historianTag} on={(v) => setPf({ ...pf, historianTag: v })} />
        <Field id={`pu-${t.id}`} label="واحد" value={pf.uom} on={(v) => setPf({ ...pf, uom: v })} />
        <button className="btn ghost" type="submit">افزودن</button>
        {pmsg && <span className="err sm">{pmsg}</span>}
      </form>
    </div>
    </>
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
