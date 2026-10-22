"use client";
import { useState } from "react";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { usePrefs } from "../../../lib/client/prefs.mjs";

import TableKit from "../../../components/ui/TableKit";
/**
 * The contract's activity codes: each code names an activity type (e.g.
 * Excavation) and places it in up to eight categories (A–H), with its unit.
 * Activities are given codes on the activity page; the daily progress page
 * sums their work per code and per area / contractor.
 */
const CATS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const BLANK = { id: null, code: "", name: "", categories: Array(8).fill(""), unit: "", valid: true, remark: "" };

export default function CodesPage() {
  const { projectId, contractId, contract, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => (contractId ? `/api/eps/activities?projectId=${id}&contractId=${contractId}&codes=1` : null), [contractId]);
  const { t } = usePrefs();
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/eps/activities", { method: "POST", body: JSON.stringify({ projectId, contractId, ...body }) }); reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  if (!contractId) return <div className="page"><div className="pagehead"><h1>{t("ep.co.title")}</h1></div><p className="empty-note">{t("cs.pick")}</p></div>;
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const may = data.may.edit;
  return (
    <div className="page">
      <div className="pagehead"><h1>{t("ep.co.titleFull")}</h1>
        <span className="sub">{t("ep.co.sub", { no: contract?.contract_no || "" })} · <Link href="/eps/activities">{t("ep.link.activities")}</Link></span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg toast" role="status">{ok}</p>}
      {may && !f && <p><button className="btn" type="button" onClick={() => setF({ ...BLANK, categories: Array(8).fill("") })}>{t("ep.co.new")}</button></p>}
      {f && (
        <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "code", ...f }, (r) => t("ep.co.saved", { code: r.row.code }))) setF(null); }}>
          <h2>{f.id ? t("ep.co.edit", { code: f.code }) : t("ep.co.newTitle")}</h2>
          <div className="grid2">
            <div className="field"><label htmlFor="ac-code">Active Code</label><input id="ac-code" dir="ltr" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="6002/0101/0001" /></div>
            <div className="field"><label htmlFor="ac-name">{t("ep.co.name")}</label><input id="ac-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Excavation" /></div>
            {CATS.map((c, i) => (
              <div className="field" key={c}><label htmlFor={`ac-c${c}`}>Category {c}</label>
                <input id={`ac-c${c}`} value={f.categories[i] || ""} onChange={(e) => { const n = [...f.categories]; n[i] = e.target.value; setF({ ...f, categories: n }); }} /></div>))}
            <div className="field"><label htmlFor="ac-unit">{t("ep.unit")}</label><input id="ac-unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="m³" /></div>
            <div className="field"><label htmlFor="ac-rem">{t("ep.remark")}</label><input id="ac-rem" value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></div>
          </div>
          <label className="sm"><input type="checkbox" checked={f.valid} onChange={(e) => setF({ ...f, valid: e.target.checked })} /> {t("ep.co.valid")}</label>
          <p><button className="btn" type="submit">{t("ep.save")}</button> <button className="btn ghost" type="button" onClick={() => setF(null)}>{t("ep.cancel")}</button></p>
        </form>)}
      <div className="card">
        {data.codes.length === 0 ? <p className="empty-note">{t("ep.co.none")}</p> : (
          <div className="tablewrap"><TableKit name="eps-codes-1"><table className="dtable">
            <thead><tr><th>Active Code</th><th>{t("ep.cd.kind")}</th>{CATS.map((c) => <th key={c}>Category {c}</th>)}<th>{t("ep.unit")}</th><th>Valid</th><th>{t("ep.link.activities")}</th><th>{t("ep.remark")}</th>{may && <th />}</tr></thead>
            <tbody>{data.codes.map((c) => (
              <tr key={c.id} data-code={c.code}><td className="mono" dir="ltr">{c.code}</td><td>{c.name}</td>{CATS.map((x, i) => <td key={x} className="sm">{c.categories[i] || "—"}</td>)}
                <td>{c.unit || "—"}</td><td>{c.valid ? "✓" : "✗"}</td><td className="mono">{c.used}</td><td className="sm">{c.remark || ""}</td>
                {may && <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn ghost sm" type="button" onClick={() => setF({ id: c.id, code: c.code, name: c.name, categories: [...c.categories, ...Array(8).fill("")].slice(0, 8), unit: c.unit || "", valid: c.valid, remark: c.remark || "" })}>{t("ep.edit")}</button>
                  <button className="btn ghost sm" type="button" onClick={() => post({ kind: "code-remove", id: c.id }, () => t("ep.removed"))}>{t("ep.remove")}</button></td>}</tr>))}</tbody></table></TableKit></div>)}
      </div>
    </div>
  );
}
