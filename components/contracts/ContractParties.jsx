"use client";
import { useState } from "react";
import { usePrefs } from "../../lib/client/prefs.mjs";
import StructureSharing from "./StructureSharing";
import TableKit from "../ui/TableKit";

export default function Parties({ data, C, may, post }) {
  const BLANK = { id: null, companyId: "", role: "", note: "" };
  const [f, setF] = useState(BLANK);
  const [p, setP] = useState({ employerId: C.contract.employer_company_id || "", contractorId: C.contract.contractor_company_id || "" });
  const { t, L } = usePrefs();
  const R = Object.fromEntries(Object.entries(data.labels.contractRoles).map(([k, v]) => [k, data.roleCatalog.find((r) => r.code === k)?.project_id ? v : L(`contract.role.${k}`, v)]));
  const roleNames = { ...Object.fromEntries(data.roleCatalog.map((r) => [r.code, r.name])), ...R };
  const pick = (id, v, on) => (
    <select id={id} value={v} disabled={!may} onChange={(e) => on(e.target.value)}>
      <option value="">—</option>{data.companies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select>);
  return (
    <div className="card">
      <h2>{t("cs.parties")}</h2>
      <p className="sm muted">{t("cs.partiesNote")}</p>
      {data.companies.length === 0 ? <p className="empty-note">{t("cs.noCompanies")}</p> : (
        <form className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}
          onSubmit={(e) => { e.preventDefault(); post({ kind: "contract-parties", ...p }, () => t("cs.partiesSaved")); }}>
          <div className="field"><label htmlFor="cp-e">{t("ct.h.employer")}</label>{pick("cp-e", p.employerId, (v) => setP({ ...p, employerId: v }))}</div>
          <div className="field"><label htmlFor="cp-c">{t("ct.contractor")}</label>{pick("cp-c", p.contractorId, (v) => setP({ ...p, contractorId: v }))}</div>
          {may && <button className="btn" type="submit">{t("cs.saveParties")}</button>}
        </form>)}
      <h2 style={{ marginTop: 16 }}>{t("cs.stakeholders")}</h2>
      {may && (
        <form className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}
          onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "contract-stakeholder", ...f }, () => (f.id ? t("cs.edited") : t("cs.addedShort")))) setF(BLANK); }}>
          <div className="field"><label htmlFor="cs-co">{t("cs.company")}</label><select id="cs-co" required value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
            <option value="">—</option>{data.companies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select></div>
          <div className="field"><label htmlFor="cs-role">{t("cs.role")}</label><select id="cs-role" required value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="">{t("cs.role")}</option>
            {f.id && !R[f.role] && <option value={f.role}>{roleNames[f.role] || f.role}</option>}
            {Object.entries(R).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
          <div className="field"><label htmlFor="cs-note">{t("cs.note")}</label><input id="cs-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          <button className="btn" type="submit">{f.id ? t("ct.saveChanges") : t("cs.add")}</button>
          {f.id && <button className="btn ghost" type="button" onClick={() => setF(BLANK)}>{t("common.cancel")}</button>}
        </form>)}
      {C.stakeholders.length === 0 ? <p className="empty-note">{t("cs.none")}</p> : (
        <TableKit name="contracts-setup-2"><table className="dtable"><thead><tr><th>{t("cs.role")}</th><th>{t("cs.company")}</th><th>{t("cs.note")}</th>{may && <th />}</tr></thead>
          <tbody>{C.stakeholders.map((s) => <tr key={s.id}><td>{roleNames[s.role] || s.role}</td><td><span className="mono">{s.code}</span> — {s.name}</td><td className="sm">{s.note || "—"}</td>
            {may && <td><button className="btn ghost sm" type="button" onClick={() => setF({ id: s.id, companyId: s.company_id, role: s.role, note: s.note || "" })}>{t("cs.edit")}</button>
              <button className="btn ghost sm" type="button" onClick={() => post({ kind: "contract-stakeholder-remove", id: s.id })}>{t("cs.remove")}</button></td>}</tr>)}</tbody></table></TableKit>)}
      {may && C.stakeholders.length > 0 && <StructureSharing contractId={C.contract.id} stakeholders={C.stakeholders} labels={roleNames} />}
    </div>
  );
}
