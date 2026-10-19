"use client";
import { useState } from "react";
import TemplateButton from "../../components/ui/TemplateButton";
import { useProjectData } from "../../lib/client/platform.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * MESC numbers of the stock items, checked against the owner's catalogue.
 * Rules: lib/warehouse/mesc.mjs — the platform holds no MESC numbers of its own.
 */
const TONE = { none: "", unverified: "warn", unknown: "bad", uom: "bad", ok: "ok" };

export default function Mesc({ projectId, call, may }) {
  const { data, error, reload } = useProjectData((id) => `/api/warehouse/mesc?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null);
  const { t } = usePrefs();

  async function post(body) {
    setMsg(null);
    try {
      const r = await call("/api/warehouse/mesc", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return r || true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return null;
  const coded = data.items.filter((i) => i.mesc_code).length;
  const bad = data.items.filter((i) => ["unknown", "uom"].includes(i.state.code)).length;

  return (
    <div className="card">
      <h2>{t("wa.mesc.title")}</h2>
      <p className="muted sm">
        {t("wa.mesc.note")}{" "}
        {data.entries ? t("wa.mesc.catalogue", { edition: data.edition, n: data.entries }) : t("wa.mesc.noCatalogue")}
        {" "}{t("wa.mesc.coded", { n: coded, of: data.items.length })}{bad > 0 && t("wa.mesc.bad", { n: bad })}.
      </p>
      {msg && <p className="err">{msg}</p>}
      <TableKit name="mesc">
        <table className="dtable">
          <thead><tr><th>{t("pu.f.item")}</th><th>{t("c.description")}</th><th>{t("wa.uom")}</th><th>MESC</th><th>{t("c.status")}</th><th>{t("wa.mesc.group")}</th><th /></tr></thead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.id}>
                <td className="mono">{i.code}</td><td>{i.description}</td><td className="mono">{i.uom}</td>
                <td className="mono" dir="ltr">{i.formatted || "—"}{i.mesc_description && <div className="muted sm">{i.mesc_description}</div>}</td>
                <td><span className={`pill ${TONE[i.state.code]}`}>{t(`wa.mesc.st.${i.state.code}`, { cat: i.state.catalogueUom, uom: i.uom })}</span></td>
                <td className="sm">{i.path ? i.path.map((p) => p.title || `${p.prefix} (?)`).join(" › ") : "—"}</td>
                <td>{may && <button className="btn ghost" onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? t("common.close") : t("wa.mesc.assign")}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableKit>
      {data.items.filter((i) => i.id === open).map((i) => <Assign key={i.id} i={i} projectId={projectId} call={call} post={post} />)}
      {may && <Fold title={t("wa.mesc.loadFold")}><Catalogue post={post} imports={data.imports} /></Fold>}
    </div>
  );
}

function Assign({ i, projectId, call, post }) {
  const [code, setCode] = useState(i.formatted || "");
  const [q, setQ] = useState(i.description);
  const [found, setFound] = useState(null);
  const { t } = usePrefs();
  async function search(e) {
    e.preventDefault();
    const r = await call(`/api/warehouse/mesc?projectId=${projectId}&q=${encodeURIComponent(q)}`);
    setFound(r.matches);
  }
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3>{i.code} — {i.description}</h3>
      <form onSubmit={search} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <div className="field" style={{ flex: 1 }}><label htmlFor={`mq-${i.id}`}>{t("wa.mesc.searchLabel")}</label>
          <input id={`mq-${i.id}`} dir="auto" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn ghost">{t("pu.v.search")}</button>
      </form>
      {found && (found.length === 0 ? <p className="muted sm">{t("wa.mesc.notFound")}</p> : (
        <table className="dtable">
          <thead><tr><th>MESC</th><th>{t("wa.mesc.catDesc")}</th><th>{t("wa.uom")}</th><th /></tr></thead>
          <tbody>
            {found.map((f) => (
              <tr key={f.code}>
                <td className="mono" dir="ltr">{f.formatted}</td><td>{f.description}</td><td className="mono">{f.uom || "—"}</td>
                <td>{f.usedBy ? <span className="muted sm">{t("wa.mesc.usedBy", { item: f.usedBy })}</span>
                  : <button className="btn ghost" onClick={() => setCode(f.formatted)}>{t("wa.mesc.pick")}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <form style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}
            onSubmit={async (e) => { e.preventDefault(); await post({ kind: "item", itemId: i.id, mescCode: code }); }}>
        <div className="field"><label htmlFor={`mc-${i.id}`}>{t("wa.mesc.code")}</label>
          <input id={`mc-${i.id}`} dir="ltr" placeholder="XX.XX.XX.XXX.X" value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <button className="btn">{t("wa.mesc.saveCode")}</button>
        {i.mesc_code && <button type="button" className="btn ghost" onClick={() => post({ kind: "item", itemId: i.id, mescCode: "" })}>{t("wa.mesc.removeCode")}</button>}
      </form>
    </div>
  );
}

function Catalogue({ post, imports }) {
  const [f, setF] = useState({ edition: "", text: "" });
  const { t, date } = usePrefs();
  async function file(e) {
    const fl = e.target.files?.[0];
    if (!fl) return;
    if (/\.(xlsx?|xlsm)$/i.test(fl.name)) {        // the first sheet, as CSV: code, description, unit
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await fl.arrayBuffer(), { type: "array" });
      setF({ ...f, text: XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]) });
    } else setF({ ...f, text: await fl.text() });
  }
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "catalogue", ...f })) setF({ edition: "", text: "" }); }}>
      <p className="muted sm">{t("wa.mesc.fileNote")}</p>
      <div className="field"><label htmlFor="mesc-ed">{t("wa.mesc.edition")}</label>
        <input id="mesc-ed" dir="auto" value={f.edition} onChange={(e) => setF({ ...f, edition: e.target.value })} /></div>
      <div className="field"><label htmlFor="mesc-file">{t("wa.mesc.file")}</label><input id="mesc-file" type="file" accept=".xlsx,.xls,.xlsm,.csv,.txt,.tsv" onChange={file} />
        <TemplateButton kind="mesc" /></div>
      <div className="field"><label htmlFor="mesc-text">{t("wa.mesc.text")}</label>
        <textarea id="mesc-text" dir="ltr" rows={5} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></div>
      <button className="btn">{t("wa.mesc.load")}</button>
      {imports.length > 0 && <ul className="sm">{imports.map((m, k) => <li key={k}>{m.edition} — {t("wa.mesc.imported", { n: m.entries, groups: m.groups })} — {date(m.at)}{m.by_name && ` — ${m.by_name}`}</li>)}</ul>}
    </form>
  );
}
