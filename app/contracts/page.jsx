"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import EntityLog from "../../components/ui/EntityLog";
import { money, Field } from "../../components/contracts/ui";
import FormNo from "../../components/ui/FormNo";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * Contracts and subcontracts: the terms every payment statement applies,
 * and the payment items (BOQ) — each on a WBS element, each saying how its
 * quantity is measured. A signed contract's terms and items do not change
 * here; that is an amendment.
 */
const BLANK = { contractNo: "", title: "", kind: "subcontract", contractorId: "", counterparty: "", employerCompanyId: "", contractorCompanyId: "", currency: "", value: "", startOn: "", endOn: "",
  advancePct: "0", advanceRecoveryPct: "", retentionPct: "10", insurancePct: "5", withholdingPct: "3", vatPct: "9", overrunLimitPct: "25", scope: "" };

export default function ContractsPage() {
  const { projectId, role, call } = usePlatform();
  const { t, L } = usePrefs();
  const { data, error, reload } = useProjectData((id) => `/api/contracts?projectId=${id}`, []);
  const [sel, setSel] = useState(null);
  const [msg, setMsg] = useState(null);
  const [f, setF] = useState(BLANK);
  const [editing, setEditing] = useState(false);
  const may = can({ role }, ACTIONS.MANAGE_CONTRACTS);

  async function post(body, done) {
    setMsg(null);
    try { const r = await call("/api/contracts", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); done?.(r); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const c = data.contracts.find((x) => x.id === sel) || null;
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const signed = data.contracts.filter((x) => x.status === "signed");

  function edit(x) {
    setF({ contractNo: x.no, title: x.title, kind: x.kind, contractorId: x.contractorId || "", counterparty: x.counterparty || "",
      employerCompanyId: x.employerCompanyId || "", contractorCompanyId: x.contractorCompanyId || "", currency: x.currency,
      value: x.value ?? "", startOn: x.startOn || "", endOn: x.endOn || "", advancePct: String(x.terms.advancePct), advanceRecoveryPct: x.terms.advanceRecoveryPct ?? "",
      retentionPct: String(x.terms.retentionPct), insurancePct: String(x.terms.insurancePct), withholdingPct: String(x.terms.withholdingPct),
      vatPct: String(x.terms.vatPct), overrunLimitPct: String(x.terms.overrunLimitPct), scope: x.scope || "" });
    setEditing(true);
  }

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{t("ct.title")}</h1>
        <span className="sub">{t("ct.sub", { n: data.contracts.length, signed: signed.length })}</span>
      </div>
      {msg && <p className="err" role="alert">{msg}</p>}

      <div className="card">
        <h2>{t("ct.list")}</h2>
        {data.contracts.length === 0 ? <p className="empty-note">{t("ct.empty")}</p> : (
          <TableKit name="contracts">
            <table className="dtable">
              <thead><tr><th>{t("c.no")}</th><th>{t("c.title")}</th><th>{t("ct.h.kind")}</th><th>{t("ct.h.employer")}</th><th>{t("ct.h.counterparty")}</th><th>{t("ct.h.value")}</th><th>BOQ</th><th>{t("ct.h.certified")}</th><th>{t("c.status")}</th><th /></tr></thead>
              <tbody>{data.contracts.map((x) => (
                <tr key={x.id} className={x.id === sel ? "sel" : ""}>
                  <td className="mono">{x.no}</td><td>{x.title}</td><td className="sm">{L(`contract.kind.${x.kind}`, data.kinds[x.kind])}</td><td className="sm">{x.employerCompany || "—"}</td><td className="sm">{x.contractor}</td>
                  <td className="mono sm">{money(x.value, x.currency)}</td><td className="mono sm">{money(x.boq)}</td>
                  <td className="mono sm">{money(x.certified)}</td>
                  <td><span className={`pill ${x.status === "signed" ? "ok" : x.status === "closed" ? "" : "warn"}`}>{L(`contract.status.${x.status}`, x.statusFa)}</span></td>
                  <td><button className="btn ghost" onClick={() => setSel(sel === x.id ? null : x.id)}>{sel === x.id ? t("common.close") : t("ct.details")}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </TableKit>
        )}
        {may && (
          <Fold key={editing ? `e-${f.contractNo}` : "new"} title={editing ? t("ct.editTitle", { no: f.contractNo }) : t("ct.new")} defaultOpen={editing}>
            <form onSubmit={async (e) => {
              e.preventDefault();
              // The contract's own type travels as contractKind: `kind` names the request.
              const { kind: contractKind, ...rest } = f;
              await post({ ...rest, kind: "contract", contractKind, contractorId: f.contractorId || null }, () => { setF(BLANK); setEditing(false); });
            }}>
              <div className="grid2">
                <FormNo id="ct-no" form="contract" label={t("ct.no")} value={f.contractNo} on={(v) => setF({ ...f, contractNo: v })} readOnly={editing} />
                <Field id="ct-title" label={t("c.title")} value={f.title} on={on("title")} required />
                <div className="field"><label htmlFor="ct-kind">{t("ct.h.kind")}</label>
                  <select id="ct-kind" value={f.kind} onChange={on("kind")}>{Object.entries(data.kinds).map(([k, v]) => <option key={k} value={k}>{L(`contract.kind.${k}`, v)}</option>)}</select></div>
                <div className="field"><label htmlFor="ct-con">{t("ct.contractor")}</label>
                  <select id="ct-con" value={f.contractorId} onChange={on("contractorId")}>
                    <option value="">{t("ct.noContractor")}</option>
                    {data.contractors.map((k) => <option key={k.id} value={k.id}>{k.code} — {k.name}</option>)}
                  </select></div>
                <Field id="ct-party" label={t("ct.counterpartyTyped")} value={f.counterparty} on={on("counterparty")} />
                {[["ct-emp", "employerCompanyId", t("ct.employerCo")], ["ct-ccmp", "contractorCompanyId", t("ct.contractorCo")]].map(([id, k, l]) => (
                  <div className="field" key={k}><label htmlFor={id}>{l}</label>
                    <select id={id} value={f[k]} onChange={on(k)}>
                      <option value="">—</option>{(data.companies || []).map((co) => <option key={co.id} value={co.id}>{co.code} — {co.name}</option>)}
                    </select></div>))}
                <Field id="ct-cur" label={t("ct.currency", { cur: data.currency ? `: ${data.currency}` : "" })} value={f.currency} on={on("currency")} ltr />
                <Field id="ct-value" label={t("ct.value")} type="number" value={f.value} on={on("value")} />
                <Field id="ct-start" label={t("ct.start")} type="date" value={f.startOn} on={on("startOn")} />
                <Field id="ct-end" label={t("ct.end")} type="date" value={f.endOn} on={on("endOn")} />
                <Field id="ct-adv" label={t("ct.advance")} type="number" value={f.advancePct} on={on("advancePct")} />
                <Field id="ct-advrec" label={t("ct.advanceRec")} type="number" value={f.advanceRecoveryPct} on={on("advanceRecoveryPct")} />
                <Field id="ct-ret" label={t("ct.retention")} type="number" value={f.retentionPct} on={on("retentionPct")} />
                <Field id="ct-ins" label={t("ct.insurance")} type="number" value={f.insurancePct} on={on("insurancePct")} />
                <Field id="ct-wht" label={t("ct.withholding")} type="number" value={f.withholdingPct} on={on("withholdingPct")} />
                <Field id="ct-vat" label={t("ct.vat")} type="number" value={f.vatPct} on={on("vatPct")} />
                <Field id="ct-over" label={t("ct.overrun")} type="number" value={f.overrunLimitPct} on={on("overrunLimitPct")} />
                <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="ct-scope">{t("ct.scope")}</label>
                  <textarea id="ct-scope" rows={2} value={f.scope} onChange={on("scope")} /></div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" type="submit">{editing ? t("ct.saveChanges") : t("ct.save")}</button>
                {editing && <button className="btn ghost" type="button" onClick={() => { setF(BLANK); setEditing(false); }}>{t("common.cancel")}</button>}
              </div>
            </form>
          </Fold>
        )}
      </div>

      {c && <ContractDetail c={c} data={data} may={may} post={post} onEdit={() => edit(c)} />}
    </div>
  );
}

function ContractDetail({ c, data, may, post, onEdit }) {
  const { t, L, date } = usePrefs();
  const [reason, setReason] = useState("");
  const [refresh, setRefresh] = useState(0);
  const status = async (to) => { if (await post({ kind: "contract-status", contractId: c.id, to, comment: reason })) { setReason(""); setRefresh((n) => n + 1); } };
  const open = ["draft", "in_review"].includes(c.status);
  return (
    <div className="card">
      <h2>{t("ct.detailTitle", { no: c.no, title: c.title })}</h2>
      <div className="moneyrow">
        <div><span>{t("c.status")}</span><b>{L(`contract.status.${c.status}`, c.statusFa)}</b></div>
        <div><span>{t("ct.m.value")}</span><b>{money(c.value, c.currency)}</b></div>
        <div><span>{t("ct.m.boq")}</span><b>{money(c.boq, c.currency)}</b></div>
        <div><span>{t("ct.m.certified")}</span><b>{money(c.certified, c.currency)}</b></div>
        <div><span>{t("ct.m.paid")}</span><b>{money(c.paid, c.currency)}</b></div>
        <div><span>{t("ct.m.retention")}</span><b>{money(c.retentionHeld, c.currency)}</b></div>
      </div>
      <p className="sm muted">
        {t("ct.terms", { adv: c.terms.advancePct, rec: c.terms.advanceRecoveryPct ?? c.terms.advancePct, ret: c.terms.retentionPct, ins: c.terms.insurancePct,
          wht: c.terms.withholdingPct, vat: c.terms.vatPct, over: c.terms.overrunLimitPct })}
        {c.signedOn && t("ct.signedOn", { date: date(c.signedOn) })}
      </p>
      {may && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          {open && <button className="btn ghost" onClick={onEdit}>{t("ct.editTerms")}</button>}
          {c.status === "draft" && <button className="btn" onClick={() => status("in_review")}>{t("ct.toReview")}</button>}
          {c.status === "in_review" && <button className="btn" onClick={() => status("signed")}>{t("ct.sign")}</button>}
          {c.status === "in_review" && <><input aria-label={t("ct.returnReason")} placeholder={t("ct.returnPh")} value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="btn ghost" onClick={() => status("draft")} disabled={!reason.trim()}>{t("ct.toDraft")}</button></>}
          {c.status === "signed" && <button className="btn ghost" onClick={() => status("closed")}>{t("ct.close")}</button>}
        </div>
      )}

      <h3>{t("ct.boq")}</h3>
      {c.lines.length === 0 ? <p className="empty-note">{t("ct.boqEmpty")}</p> : (
        <TableKit name="boq">
          <table className="dtable">
            <thead><tr><th>{t("c.row")}</th><th>{t("c.description")}</th><th>{t("ct.h.unit")}</th><th>{t("ct.h.qty")}</th><th>{t("ct.h.rate")}</th><th>{t("ct.h.amount")}</th><th>WBS</th><th>{t("ct.h.measure")}</th></tr></thead>
            <tbody>{c.lines.map((l) => (
              <tr key={l.id}>
                <td className="mono">{l.itemNo}</td><td>{l.description}</td><td className="sm">{l.unit}</td>
                <td className="mono">{l.qty}</td><td className="mono">{money(l.rate)}</td><td className="mono">{money(l.amount)}</td>
                <td className="mono sm">{l.wbs || <span className="pill warn">{t("ct.noWbs")}</span>}</td>
                <td className="sm">{L(`boq.method.${l.method}`, data.methods[l.method])}{l.metric && <div className="muted">{L(`metric.${l.metric}`, data.metrics[l.metric])}{l.subsystem ? ` · ${l.subsystem}` : ""}</div>}
                  {l.designCode && <div className="muted mono">{l.designCode}</div>}</td>
              </tr>
            ))}</tbody>
          </table>
        </TableKit>
      )}
      {may && open && <LineForm c={c} data={data} post={post} />}

      <h3>{t("ct.statements")}</h3>
      {c.statements.length === 0 ? <p className="muted sm">{t("ct.noStatements")}</p> : (
        <ul className="sm">{c.statements.map((s) => <li key={s.id}>{t("ct.statementLine", { seq: s.seq, date: date(s.periodTo), status: L(`statement.status.${s.status}`, s.statusFa) })}
          {s.net !== null && t("ct.net", { x: money(s.net, c.currency) })}</li>)}</ul>
      )}

      <h3>{t("ct.flow")}</h3>
      {/* i18n: stored — the log keeps its label with each event, in Persian whatever the reader's language */}
      <EntityLog section="contracts" entityType="contract" entityId={c.id} label={`قرارداد ${c.no}`} refreshKey={refresh} />
    </div>
  );
}

function LineForm({ c, data, post }) {
  const { t, L } = usePrefs();
  const blank = { itemNo: "", description: "", unit: "", qty: "", rate: "", accountId: "", method: "platform", metric: "", subsystemId: "", designCode: "" };
  const [l, setL] = useState(blank);
  const on = (k) => (e) => setL({ ...l, [k]: e.target.value });
  return (
    <Fold title={t("ct.newLine")}>
      <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "line", contractId: c.id, ...l, accountId: l.accountId || null, subsystemId: l.subsystemId || null })) setL(blank); }}>
        <div className="grid2">
          <Field id="ln-no" label={t("ct.lineNo")} value={l.itemNo} on={on("itemNo")} required ltr />
          <Field id="ln-desc" label={t("c.description")} value={l.description} on={on("description")} required />
          <div className="field"><label htmlFor="ln-method">{t("ct.method")}</label>
            <select id="ln-method" value={l.method} onChange={on("method")}>{Object.entries(data.methods).map(([k, v]) => <option key={k} value={k}>{L(`boq.method.${k}`, v)}</option>)}</select></div>
          {l.method === "platform" && (
            <>
              <div className="field"><label htmlFor="ln-metric">{t("ct.metric")}</label>
                <select id="ln-metric" value={l.metric} onChange={on("metric")} required>
                  <option value="">—</option>{Object.entries(data.metrics).map(([k, v]) => <option key={k} value={k}>{L(`metric.${k}`, v)}</option>)}
                </select></div>
              <div className="field"><label htmlFor="ln-sub">{t("ct.onlySub")}</label>
                <select id="ln-sub" value={l.subsystemId} onChange={on("subsystemId")}>
                  <option value="">{t("ct.wholeProject")}</option>{data.subsystems.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
                </select></div>
            </>
          )}
          {l.method === "design" && (
            <div className="field"><label htmlFor="ln-design">{t("ct.designItem")}</label>
              <select id="ln-design" value={l.designCode} onChange={on("designCode")} required>
                <option value="">—</option>{data.design.map((d) => <option key={d.code} value={d.code}>{d.code} — {d.description} ({d.qty} {d.unit}, Rev.{d.modelRev})</option>)}
              </select>
              {data.design.length === 0 && <span className="hint">{t("ct.designFirst")}</span>}</div>
          )}
          {(l.method === "measured" || l.method === "lump_sum") && <Field id="ln-unit" label={t("ct.h.unit")} value={l.unit} on={on("unit")} ltr />}
          <Field id="ln-qty" label={t("ct.contractQty")} type="number" value={l.qty} on={on("qty")} required />
          <Field id="ln-rate" label={t("ct.rateIn", { cur: c.currency })} type="number" value={l.rate} on={on("rate")} required />
          <div className="field"><label htmlFor="ln-wbs">{t("ct.wbsElement")}</label>
            <select id="ln-wbs" value={l.accountId} onChange={on("accountId")} required={l.method === "design" || l.method === "lump_sum"}>
              <option value="">—</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.title}</option>)}
            </select>
            {data.accounts.length === 0 && <span className="hint">{t("ct.wbsFrom")}</span>}</div>
        </div>
        <button className="btn" type="submit">{t("ct.saveLine")}</button>
      </form>
    </Fold>
  );
}
