"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import Tabs from "../../../components/ui/Tabs";
import TreeEditor, { flatten } from "../../../components/ui/TreeEditor";
import { usePrefs } from "../../../lib/client/prefs.mjs";

import TableKit from "../../../components/ui/TableKit";
/**
 * Step 2 of the organisation's process: one contract's currencies (at the
 * contract's own rate) and budget, its stakeholders, its addenda and
 * extensions, and its category trees for resources and the narrative.
 * Everything a budget row shows beyond its forecast is derived.
 */

export default function ContractSetupPage() {
  const { projectId, contractId, call } = usePlatform();
  const { t } = usePrefs();
  const { data, error, reload } = useProjectData((id) => `/api/org?projectId=${id}${contractId ? `&contractId=${contractId}` : ""}`, [contractId]);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/org", { method: "POST", body: JSON.stringify({ projectId, contractId, ...body }) }); reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const may = data.may.contract;
  const C = data.contract;
  return (
    <div className="page">
      <div className="pagehead"><h1>{t("cs.title")}</h1>
        <span className="sub">{t("cs.sub")}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      {data.contracts.length === 0 ? <p className="empty-note">{t("cs.noContracts")}</p>
        : !C && <p className="empty-note">{t("cs.pick")}</p>}
      {C && <p className="sm"><b>{t("cs.contract", { no: C.contract.contract_no })}</b> — {C.contract.title}</p>}
      {C && (
        <Tabs name="contract-setup" key={contractId}>
          <Budget data={data} C={C} may={may} post={post} />
          <Parties data={data} C={C} may={may} post={post} />
          <Amendments data={data} C={C} may={may} post={post} />
          <Trees data={data} C={C} may={may} post={post} />
        </Tabs>
      )}
    </div>
  );
}

function Budget({ data, C, may, post }) {
  const { t, num } = usePrefs();
  const fmt = (v) => num(v, { maximumFractionDigits: 2 });
  const [f, setF] = useState({ currency: "", rate: "", budget: "", doneTyped: "" });
  const main = C.contract.currency;
  return (
    <div className="card">
      <h2>{t("cs.budget")}</h2>
      <p className="sm muted">{t("cs.budgetNote", { main })}</p>
      {may && (
        <form className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}
          onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "contract-currency", ...f }, () => t("cs.added", { x: f.currency }))) setF({ currency: "", rate: "", budget: "", doneTyped: "" }); }}>
          <div className="field"><label htmlFor="cc-cur">{t("cs.currency")}</label><select id="cc-cur" required value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            <option value="">—</option>{data.currencies.map((x) => <option key={x.code} value={x.code}>{x.code} ({Number(x.rate)})</option>)}</select></div>
          <div className="field"><label htmlFor="cc-rate">{t("cs.rate")}</label><input id="cc-rate" dir="ltr" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder={t("cs.projectRate")} /></div>
          <div className="field"><label htmlFor="cc-b">{t("cs.forecast")}</label><input id="cc-b" dir="ltr" required inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} /></div>
          {f.currency && f.currency !== main && <div className="field"><label htmlFor="cc-d">{t("cs.doneTyped")}</label><input id="cc-d" dir="ltr" inputMode="decimal" value={f.doneTyped} onChange={(e) => setF({ ...f, doneTyped: e.target.value })} /></div>}
          <button className="btn" type="submit">{t("c.submit")}</button>
        </form>)}
      {data.currencies.length === 0 && <p className="empty-note">{t("cs.noCurrencies")}</p>}
      <div className="tablewrap"><TableKit name="contracts-setup-1"><table className="dtable">
        <thead><tr><th>{t("cs.currency")}</th><th>{t("cs.h.rate")}</th><th>{t("cs.forecast")}</th><th>{t("cs.h.weight")}</th><th>{t("cs.h.done")}</th><th>{t("cs.h.remaining")}</th><th>{t("cs.h.decrease")}</th><th>{t("cs.h.increase")}</th><th>{t("cs.h.newItems")}</th><th>{t("cs.h.needed")}</th><th>{t("cs.h.base")}</th>{may && <th />}</tr></thead>
        <tbody>{C.budget.rows.map((r) => (
          <tr key={r.currency}><td className="mono">{r.currency}</td><td className="mono" dir="ltr">{r.rate}</td><td className="mono">{fmt(r.forecast)}</td>
            <td className="mono">{r.weightPct == null ? "—" : `${r.weightPct}%`}</td>
            <td className="mono">{fmt(r.done)}{r.doneSource && <div className="sm muted">{r.doneSource === "statements" ? t("cs.fromStatements") : t("cs.typed")}</div>}</td>
            <td className="mono">{fmt(r.remaining)}</td><td className="mono">{fmt(r.decrease)}</td><td className="mono">{fmt(r.increase)}</td><td className="mono">{fmt(r.newItems)}</td>
            <td className="mono"><b>{fmt(r.needed)}</b></td><td className="mono">{fmt(r.base.needed)}</td>
            {may && <td><button className="btn ghost sm" type="button" onClick={() => setF({ currency: r.currency, rate: String(r.rate), budget: String(r.forecast),
              doneTyped: r.doneSource === "typed" ? String(r.done) : "" })}>{t("cs.edit")}</button></td>}</tr>))}
          {C.budget.rows.length > 0 && <tr><td colSpan={2}><b>{t("cs.total")}</b></td><td className="mono">{fmt(C.budget.total.forecast)}</td><td /><td className="mono">{fmt(C.budget.total.done)}</td>
            <td colSpan={4} /><td /><td className="mono"><b>{fmt(C.budget.total.needed)}</b></td></tr>}
        </tbody></table></TableKit></div>
      <p className="sm">{t("cs.duration", { from: C.contract.start_on ? String(C.contract.start_on).slice(0, 10) : "—", to: C.contract.end_on ? String(C.contract.end_on).slice(0, 10) : "—" })}
        {C.revised && C.revised.days !== 0 && <>{t("cs.afterExt")}<b>{C.revised.endOn}</b> ({C.revised.days > 0 ? "+" : ""}{t("cs.days", { n: C.revised.days })})</>}</p>
    </div>
  );
}

function Parties({ data, C, may, post }) {
  const BLANK = { id: null, companyId: "", role: "employer", note: "" };
  const [f, setF] = useState(BLANK);
  const [p, setP] = useState({ employerId: C.contract.employer_company_id || "", contractorId: C.contract.contractor_company_id || "" });
  const { t, L } = usePrefs();
  const R = Object.fromEntries(Object.entries(data.labels.contractRoles).map(([k, v]) => [k, L(`contract.role.${k}`, v)]));
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
          <div className="field"><label htmlFor="cs-role">{t("cs.role")}</label><select id="cs-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {Object.entries(R).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
          <div className="field"><label htmlFor="cs-note">{t("cs.note")}</label><input id="cs-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          <button className="btn" type="submit">{f.id ? t("ct.saveChanges") : t("cs.add")}</button>
          {f.id && <button className="btn ghost" type="button" onClick={() => setF(BLANK)}>{t("common.cancel")}</button>}
        </form>)}
      {C.stakeholders.length === 0 ? <p className="empty-note">{t("cs.none")}</p> : (
        <TableKit name="contracts-setup-2"><table className="dtable"><thead><tr><th>{t("cs.role")}</th><th>{t("cs.company")}</th><th>{t("cs.note")}</th>{may && <th />}</tr></thead>
          <tbody>{C.stakeholders.map((s) => <tr key={s.id}><td>{R[s.role]}</td><td><span className="mono">{s.code}</span> — {s.name}</td><td className="sm">{s.note || "—"}</td>
            {may && <td><button className="btn ghost sm" type="button" onClick={() => setF({ id: s.id, companyId: s.company_id, role: s.role, note: s.note || "" })}>{t("cs.edit")}</button>
              <button className="btn ghost sm" type="button" onClick={() => post({ kind: "contract-stakeholder-remove", id: s.id })}>{t("cs.remove")}</button></td>}</tr>)}</tbody></table></TableKit>)}
    </div>
  );
}

function Amendments({ data, C, may, post }) {
  const BLANK = { id: null, amendmentNo: "", amendmentKind: "time", title: "", signedOn: "", days: "", note: "", lines: [] };
  const [f, setF] = useState(BLANK);
  const { t, L, num } = usePrefs();
  const fmt = (v) => num(v, { maximumFractionDigits: 2 });
  const K = Object.fromEntries(Object.entries(data.labels.amendmentKinds).map(([k, v]) => [k, L(`amendment.kind.${k}`, v)]));
  const curs = C.budget.rows.map((r) => r.currency);
  const money = f.amendmentKind !== "time", time = f.amendmentKind !== "financial";
  return (
    <div className="card">
      <h2>{t("cs.amendments")}</h2>
      {may && (
        <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "amendment", ...f, days: time ? f.days : 0, lines: money ? f.lines : [] }, () => (f.id ? t("cs.amFixed") : t("cs.amSaved")))) setF(BLANK); }}>
          <div className="grid2">
            <div className="field"><label htmlFor="am-no">{t("cs.amNo")}</label><input id="am-no" required value={f.amendmentNo} onChange={(e) => setF({ ...f, amendmentNo: e.target.value })} /></div>
            <div className="field"><label htmlFor="am-k">{t("ct.h.kind")}</label><select id="am-k" value={f.amendmentKind} onChange={(e) => setF({ ...f, amendmentKind: e.target.value })}>
              {Object.entries(K).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
            <div className="field"><label htmlFor="am-t">{t("c.title")}</label><input id="am-t" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
            <div className="field"><label htmlFor="am-s">{t("cs.signedOn")}</label><input id="am-s" type="date" value={f.signedOn} onChange={(e) => setF({ ...f, signedOn: e.target.value })} /></div>
            {time && <div className="field"><label htmlFor="am-d">{t("cs.daysChange")}</label><input id="am-d" dir="ltr" required inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></div>}
          </div>
          {money && (
            <div>
              {f.lines.map((l, i) => (
                <div key={i} className="row" style={{ gap: 8, alignItems: "end" }}>
                  <div className="field"><label htmlFor={`al-c${i}`}>{t("cs.currency")}</label><select id={`al-c${i}`} value={l.currency} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, currency: e.target.value } : x)) })}>
                    <option value="">—</option>{curs.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
                  <div className="field"><label htmlFor={`al-k${i}`}>{t("ct.h.kind")}</label><select id={`al-k${i}`} value={l.kind} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)) })}>
                    <option value="change">{t("cs.lineKind.change")}</option><option value="new_items">{t("cs.lineKind.new_items")}</option></select></div>
                  <div className="field"><label htmlFor={`al-a${i}`}>{t("cs.amount")}</label><input id={`al-a${i}`} dir="ltr" inputMode="decimal" value={l.amount} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} /></div>
                  <button className="btn ghost sm" type="button" onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })}>×</button>
                </div>))}
              <button className="btn ghost sm" type="button" onClick={() => setF({ ...f, lines: [...f.lines, { currency: curs[0] || "", kind: "change", amount: "" }] })}>{t("cs.addAmount")}</button>
            </div>)}
          <div className="field"><label htmlFor="am-n">{t("cs.note")}</label><input id="am-n" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          <button className="btn" type="submit">{f.id ? t("cs.saveFix") : t("cs.saveAm")}</button>
          {f.id && <button className="btn ghost" type="button" onClick={() => setF(BLANK)}>{t("common.cancel")}</button>}
        </form>)}
      {C.amendments.length === 0 ? <p className="empty-note">{t("cs.noAm")}</p> : (
        <TableKit name="contracts-setup-3"><table className="dtable"><thead><tr><th>{t("c.no")}</th><th>{t("ct.h.kind")}</th><th>{t("c.title")}</th><th>{t("c.date")}</th><th>{t("cs.h.duration")}</th><th>{t("cs.h.amounts")}</th>{may && <th />}</tr></thead>
          <tbody>{C.amendments.map((a) => (
            <tr key={a.id}><td className="mono">{a.amendment_no}</td><td>{K[a.kind]}</td><td>{a.title}</td><td className="mono">{a.signed_on ? String(a.signed_on).slice(0, 10) : "—"}</td>
              <td className="mono">{a.days ? `${a.days > 0 ? "+" : ""}${t("cs.days", { n: a.days })}` : "—"}</td>
              <td className="sm">{a.lines.length ? a.lines.map((l) => <div key={l.id}>{l.kind === "new_items" ? t("cs.newItem") : Number(l.amount) > 0 ? t("cs.increase") : t("cs.decrease")} {fmt(Math.abs(Number(l.amount)))} {l.currency}</div>) : "—"}</td>
              {may && <td><button className="btn ghost sm" type="button" onClick={() => setF({ id: a.id, amendmentNo: a.amendment_no, amendmentKind: a.kind, title: a.title,
                signedOn: a.signed_on ? String(a.signed_on).slice(0, 10) : "", days: a.days ? String(a.days) : "", note: a.note || "",
                lines: a.lines.map((l) => ({ currency: l.currency, kind: l.kind, amount: String(Number(l.amount)) })) })}>{t("cs.edit")}</button></td>}</tr>))}</tbody></table></TableKit>)}
    </div>
  );
}

function Trees({ data, C, may, post }) {
  const { t, L } = usePrefs();
  const [tree, setTree] = useState("resource");
  const [f, setF] = useState({ name: "", discipline: "", parentId: "" });
  const nodes = C.trees[tree];
  return (
    <div className="card">
      <h2>{t("cs.trees")}</h2>
      <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <div className="field"><label htmlFor="tr-t">{t("cs.tree")}</label><select id="tr-t" value={tree} onChange={(e) => { setTree(e.target.value); setF({ ...f, parentId: "" }); /* a branch of one tree is no parent in another */ }}>
          {Object.entries(data.labels.trees).map(([k, v]) => <option key={k} value={k}>{L(`tree.${k}`, v)}</option>)}</select></div>
      </div>
      {may && (
        <form className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}
          onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "category", tree, ...f }, (r) => t("cs.catAdded", { name: r.row.name }))) setF({ ...f, name: "" }); }}>
          <div className="field"><label htmlFor="tr-n">{t("cs.catName")}</label><input id="tr-n" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="tr-d">{t("cs.discipline")}</label><input id="tr-d" value={f.discipline} onChange={(e) => setF({ ...f, discipline: e.target.value })} /></div>
          <div className="field"><label htmlFor="tr-p">{t("cs.under")}</label><select id="tr-p" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
            <option value="">{t("cs.topLevel")}</option>{flatten(nodes).map((x) => <option key={x.id} value={x.id}>{x.path}</option>)}</select></div>
          <button className="btn" type="submit">{t("cs.add")}</button>
        </form>)}
      <TreeEditor nodes={nodes} editable={may} label={t("cs.category")} onMove={(id, parentId) => post({ kind: "category-move", id, parentId }, () => t("cs.moved"))}
        render={(n) => <><span className="mono sm muted">{n.seq}.</span> {n.name}{n.discipline && <span className="sm muted"> · {n.discipline}</span>}</>}
        actions={may ? (n) => <>
          <button className="btn ghost sm" type="button" onClick={() => {
            const name = prompt(t("cs.promptName"), n.name); if (name === null) return;
            const discipline = prompt(t("cs.discipline"), n.discipline || ""); if (discipline === null) return;
            const seq = prompt(t("cs.promptSeq"), String(n.seq ?? "")); if (seq === null) return;
            post({ kind: "category-rename", id: n.id, name, discipline, seq }, () => t("cs.edited"));
          }}>{t("cs.edit")}</button>
          <button className="btn ghost sm" type="button" onClick={() => post({ kind: "category-remove", id: n.id }, () => t("cs.removed"))}>{t("cs.remove")}</button></> : null} />
    </div>
  );
}
