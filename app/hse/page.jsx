"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import SafeWork, { Dates, EQ_FA, eqStateText } from "./SafeWork";
import Tabs from "../../components/ui/Tabs";
import FormNo from "../../components/ui/FormNo";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * HSE: hours worked, what went wrong, the permits that let work start, and
 * what was seen on the walk.
 *
 * An incident's class is never picked — it is what the recorded facts make
 * it (IOGP), so the MTC that becomes two days off becomes an LWC by itself,
 * and every change to the facts carries a reason. Rates show their base:
 * per 1 000 000 hours (IOGP) and per 200 000 (OSHA). A hot-work or
 * confined-space permit is not issued without a passing gas test against
 * limits the project wrote down, and never by the person who asked for it.
 */
// tones; the words are hs.permit.<state> and hs.obs.<state>
const STATE = { requested: "warn", active: "ok", expired: "bad", lapsed: "", closed: "", cancelled: "" };
const OBS = { open: "warn", overdue: "bad", closed: "ok", no_due: "" };
const CLS_TONE = { FAT: "bad", LWC: "bad", RWC: "warn", MTC: "warn", FAC: "", NM: "" };

export default function HsePage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/hse?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const mayRecord = can({ role }, ACTIONS.RECORD_HSE);
  const mayIssue = can({ role }, ACTIONS.ISSUE_PERMIT);
  const mayAdmin = can({ role }, ACTIONS.MANAGE_MEMBERS);
  const { t, L, num, date } = usePrefs();
  const rate = (r) => (r === null || r === undefined ? "—" : num(r, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  async function post(body) {
    setMsg(null);
    try {
      const r = await call("/api/hse", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return r || true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const s = data.stats;
  const active = data.permits.filter((p) => p.state === "active").length;
  const expired = data.permits.filter((p) => p.state === "expired").length;
  const simops = data.permits.filter((p) => p.simopsWith.length && ["requested", "active"].includes(p.state)).length;
  const overdue = data.observations.filter((o) => o.state === "overdue").length;
  const unset = Object.keys(data.limitTitles).filter((k) => data.limits[k] === null);

  return (
    <div className="page">
      <div className="pagehead">
        <h1>HSE</h1>
        <span className="sub">
          {t("hs.sub.active", { n: active })}{expired > 0 && ` · ${t("hs.sub.expired", { n: expired })}`}{simops > 0 && ` · ${t("hs.sub.simops", { n: simops })}`}
          {` · ${t("hs.sub.incidents", { n: data.incidents.length })}`}{overdue > 0 && ` · ${t("hs.sub.overdue", { n: overdue })}`}
        </span>
      </div>
      {msg && <p className="err">{msg}</p>}

      <div className="kpis">
        <Kpi v={num(s.hours || 0)} l={t("hs.k.hours")} />
        <Kpi v={s.daysSinceLti ?? "—"} l={t("hs.k.daysNoLti")} b={s.lastLti ? t("hs.k.last", { on: date(s.lastLti) }) : t("hs.k.noLti")} />
        <Kpi v={s.lti} l="LTI (FAT + LWC)" tone={s.lti ? "bad" : "ok"} />
        <Kpi v={s.recordable} l={t("hs.k.recordable")} tone={s.recordable ? "warn" : "ok"} />
        <Kpi v={rate(s.ltif.iogp)} l="LTIF" b={t("hs.k.per", { n: num(1_000_000), base: "IOGP" })} />
        <Kpi v={rate(s.ltif.osha)} l="LTIR" b={t("hs.k.per", { n: num(200_000), base: "OSHA" })} />
        <Kpi v={rate(s.trir.iogp)} l="TRIR" b={t("hs.k.per", { n: num(1_000_000), base: "IOGP" })} />
        <Kpi v={rate(s.trir.osha)} l="TRIR" b={t("hs.k.per", { n: num(200_000), base: "OSHA" })} />
      </div>
      {(s.unclassified > 0 || s.incidentsWithoutHours.length > 0) && (
        <p className="err">
          {s.unclassified > 0 && `${t("hs.unclassified", { n: s.unclassified })} `}
          {s.incidentsWithoutHours.length > 0 && t("hs.noHours", { list: s.incidentsWithoutHours.join(t("c.sep")) })}
        </p>
      )}

      <Tabs name="hse">
      <div className="card" data-badge={expired + simops} data-tone="bad">
        <h2>{t("hs.ptw")}</h2>
        {unset.length > 0 && (
          <p className="err">
            {t("hs.unsetIn")} <a href="/project">{t("hs.projectSpec")}</a>: {unset.map((k) => L(`hse.limit.${k}`, data.limitTitles[k])).join(t("c.sep"))} —{" "}
            {t("hs.unsetNote")}
          </p>
        )}
        {data.permits.length === 0 ? <p className="empty-note">{t("hs.noPermit")}</p> : (
          <TableKit name="hse-1">
            <table className="dtable">
              <thead><tr><th>{t("c.no")}</th><th>{t("hs.type")}</th><th>{t("hs.area")}</th><th>{t("hs.validity")}</th><th>{t("c.status")}</th><th>{t("hs.gasTest")}</th><th>{t("hs.readiness")}</th><th /></tr></thead>
              <tbody>
                {data.permits.map((p) => <PermitRow key={p.id} p={p} post={post} mayRecord={mayRecord} mayIssue={mayIssue} />)}
              </tbody>
            </table>
          </TableKit>
        )}
        {mayRecord && <Fold title={t("hs.requestPermitFold")}><PermitForm data={data} post={post} /></Fold>}
      </div>

      <SafeWork data={data} post={post} reload={reload} mayRecord={mayRecord} mayIssue={mayIssue} mayAdmin={mayAdmin} />

      <div className="card" data-badge={s.unclassified} data-tone="warn">
        <h2>{t("hs.incidents")}</h2>
        <p className="muted sm">{t("hs.incNote")}</p>
        {data.incidents.length === 0 ? <p className="empty-note">{t("hs.noIncident")}</p> : (
          <TableKit name="hse-2">
            <table className="dtable">
              <thead><tr><th>{t("c.no")}</th><th>{t("hs.time")}</th><th>{t("c.contractor")}</th><th>{t("hs.area")}</th><th>{t("c.description")}</th><th>{t("hs.class")}</th><th /></tr></thead>
              <tbody>
                {data.incidents.map((i) => <IncidentRow key={i.id} i={i} data={data} post={post} mayRecord={mayRecord} call={call} projectId={projectId} />)}
              </tbody>
            </table>
          </TableKit>
        )}
        {mayRecord && <Fold title={t("hs.reportIncident")}><IncidentForm data={data} post={post} /></Fold>}
      </div>

      <div className="card" data-badge={overdue} data-tone="bad">
        <h2>{t("hs.observations")}</h2>
        {data.observations.length === 0 ? <p className="empty-note">{t("hs.noObservation")}</p> : (
          <TableKit name="hse-3">
            <table className="dtable">
              <thead><tr><th>{t("c.date")}</th><th>{t("hs.type")}</th><th>{t("hs.severity")}</th><th>{t("hs.area")}</th><th>{t("c.description")}</th><th>{t("c.action")}</th><th>{t("c.due")}</th><th>{t("c.status")}</th><th /></tr></thead>
              <tbody>
                {data.observations.map((o) => <ObservationRow key={o.id} o={o} data={data} post={post} mayRecord={mayRecord} />)}
              </tbody>
            </table>
          </TableKit>
        )}
        {mayRecord && <Fold title={t("hs.recordObsFold")}><ObservationForm data={data} post={post} /></Fold>}
      </div>

      <div className="card">
        <h2>{t("hs.byContractor")}</h2>
        <TableKit name="hse-4">
          <table className="dtable">
            <thead><tr><th>{t("c.contractor")}</th><th>{t("hs.manhours")}</th><th>LTI</th><th>TRC</th><th>LTIF (IOGP)</th><th>TRIR (IOGP)</th><th>TRIR (OSHA)</th></tr></thead>
            <tbody>
              {s.byContractor.map((c) => (
                <tr key={c.code}><td className="mono">{c.code}</td><td className="mono">{num(c.hours || 0)}</td><td>{c.lti}</td><td>{c.recordable}</td>
                  <td className="mono">{rate(c.ltif.iogp)}</td><td className="mono">{rate(c.trir.iogp)}</td><td className="mono">{rate(c.trir.osha)}</td></tr>
              ))}
            </tbody>
          </table>
        </TableKit>
        {mayRecord && <Manhours contractors={data.contractors} post={post} />}
      </div>
      </Tabs>
    </div>
  );
}

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}

function Manhours({ contractors, post }) {
  const [f, setF] = useState({ contractorId: "", workDate: today(), hours: "", headcount: "" });
  const { t } = usePrefs();
  return (
    <form className="grid2" style={{ alignItems: "end", marginTop: 10 }} onSubmit={async (e) => {
      e.preventDefault(); if (await post({ kind: "manhours", ...f })) setF({ ...f, hours: "", headcount: "" });
    }}>
      <div className="field"><label htmlFor="mh-c">{t("c.contractor")}</label>
        <select id="mh-c" value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}>
          <option value="">{t("hs.epcStaff")}</option>
          {contractors.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
        </select></div>
      <Field id="mh-d" label={t("c.date")} type="date" value={f.workDate} on={(v) => setF({ ...f, workDate: v })} required />
      <Field id="mh-h" label={t("hs.manhours")} type="number" value={f.hours} on={(v) => setF({ ...f, hours: v })} required />
      <Field id="mh-n" label={t("hs.headcount")} type="number" value={f.headcount} on={(v) => setF({ ...f, headcount: v })} />
      <div><button className="btn" type="submit">{t("hs.saveHours")}</button></div>
    </form>
  );
}

function PermitRow({ p, post, mayRecord, mayIssue }) {
  const [gas, setGas] = useState(false);
  const { t, L, dateTime } = usePrefs();
  const st = STATE[p.state];
  const g = p.gasVerdict;
  const open = ["requested", "active"].includes(p.state);
  return (
    <>
      <tr>
        <td className="mono">{p.permit_no}</td>
        <td>{L(`hse.permit.${p.type}`, p.typeTitle)}</td>
        <td className="mono">{p.area}
          {(p.equipment || p.jsa || p.crew.length > 0) && (
            <div className="muted sm" style={{ fontFamily: "inherit" }}>
              {p.equipment && <div>{L(`hse.eq.${p.equipment.kind}`, EQ_FA[p.equipment.kind])}: <bdi dir="ltr" style={{ whiteSpace: "nowrap" }}>{p.equipment.refNo}</bdi></div>}
              {p.jsa && <div>JSA: <bdi dir="ltr" style={{ whiteSpace: "nowrap" }}>{p.jsa.jsaNo} Rev {p.jsa.revision}</bdi></div>}
              {p.crew.length > 0 && <div>{t("hs.crew")}: {p.crew.map((c) => c.name).join(t("c.sep"))}</div>}
            </div>
          )}</td>
        <td className="mono sm">{dateTime(p.valid_from)} – {dateTime(p.valid_to)}</td>
        <td><span className={`pill ${st}`}>{t(`hs.permit.${p.state}`)}</span>{p.issued_by_name && <div className="muted sm">{t("hs.issuedBy", { who: p.issued_by_name })}</div>}</td>
        <td>{!p.needsGas ? <span className="muted sm">{t("hs.notNeeded")}</span>
          : !p.last_gas ? <span className="pill warn">{t("hs.notRecorded")}</span>
          : g.ok === null ? <span className="pill warn" title={g.reason}>{t("hs.noVerdict")}</span>
          : g.ok ? <span className="pill ok">{t("hs.gasPass", { at: dateTime(p.last_gas.tested_at) })}</span>
          : <span className="pill bad" title={g.failures.join(" · ")}>{t("hs.gasFail")} {g.failures.join(" · ")}</span>}</td>
        <td className="sm">
          {p.readiness && !p.readiness.ok && <div className="muted"><Dates text={p.readiness.reasons.join(" · ")} /></div>}
          {p.readiness?.ok && <span className="pill ok">{t("hs.ready")}</span>}
          {p.readiness?.notes?.length > 0 && <div className="muted" style={{ opacity: 0.8 }}>{t("hs.notChecked")} {p.readiness.notes.join(" · ")}</div>}
          {p.simopsWith.length > 0 && open && <div><span className="pill bad">{t("hs.simopsWith", { list: p.simopsWith.join(t("c.sep")) })}</span></div>}
        </td>
        <td style={{ whiteSpace: "nowrap" }}>
          {mayRecord && p.needsGas && open && <button className="btn ghost" onClick={() => setGas(!gas)}>{t("hs.gasTest")}</button>}
          {mayIssue && p.state === "requested" && <button className="btn" onClick={() => post({ kind: "activate", permitId: p.id })}>{t("hs.issue")}</button>}
          {mayRecord && ["active", "expired"].includes(p.state) && <button className="btn ghost" onClick={() => post({ kind: "close", permitId: p.id })}>{t("common.close")}</button>}
          {mayRecord && ["requested", "lapsed"].includes(p.state) && <button className="btn ghost" onClick={() => post({ kind: "cancel", permitId: p.id })}>{t("hs.cancel")}</button>}
        </td>
      </tr>
      {gas && (
        <tr><td colSpan={8}>
          <GasForm onSubmit={async (f) => { if (await post({ kind: "gas", permitId: p.id, ...f })) setGas(false); }} id={p.id} />
        </td></tr>
      )}
    </>
  );
}

function GasForm({ onSubmit, id }) {
  const [f, setF] = useState({ testedAt: nowLocal(), o2Pct: "", lelPct: "", h2sPpm: "", coPpm: "", testerName: "", instrument: "" });
  const { t } = usePrefs();
  return (
    <form className="card grid2" style={{ padding: 10, alignItems: "end" }} onSubmit={(e) => {
      e.preventDefault(); onSubmit({ ...f, testedAt: new Date(f.testedAt).toISOString() });
    }}>
      <Field id={`g-t-${id}`} label={t("hs.testedAt")} type="datetime-local" value={f.testedAt} on={(v) => setF({ ...f, testedAt: v })} required />
      <Field id={`g-o-${id}`} label="O2 (%)" type="number" value={f.o2Pct} on={(v) => setF({ ...f, o2Pct: v })} />
      <Field id={`g-l-${id}`} label="LEL (%)" type="number" value={f.lelPct} on={(v) => setF({ ...f, lelPct: v })} />
      <Field id={`g-h-${id}`} label="H2S (ppm)" type="number" value={f.h2sPpm} on={(v) => setF({ ...f, h2sPpm: v })} />
      <Field id={`g-c-${id}`} label="CO (ppm)" type="number" value={f.coPpm} on={(v) => setF({ ...f, coPpm: v })} />
      <Field id={`g-n-${id}`} label={t("hs.tester")} value={f.testerName} on={(v) => setF({ ...f, testerName: v })} />
      <Field id={`g-i-${id}`} label={t("hs.instrument")} value={f.instrument} on={(v) => setF({ ...f, instrument: v })} />
      <div><button className="btn" type="submit">{t("hs.saveGas")}</button></div>
    </form>
  );
}

function PermitForm({ data, post }) {
  const blank = { permitNo: "", type: "hot", area: "", description: "", contractorId: "", requesterName: "",
    validFrom: nowLocal(), validTo: nowLocal(8), attendant: "", isolationRef: "", equipmentId: "", jsaId: "", crew: [] };
  const sw = data.safeWork;
  const eqKind = { work_at_height: "scaffold", lifting: "crane" };
  const [f, setF] = useState(blank);
  const { t, L, date } = usePrefs();
  return (
    <form style={{ marginTop: 10 }} onSubmit={async (e) => {
      e.preventDefault();
      if (await post({ kind: "permit", ...f, validFrom: new Date(f.validFrom).toISOString(), validTo: new Date(f.validTo).toISOString() }))
        setF(blank);
    }}>
      <h2>{t("hs.requestPermit")}</h2>
      <div className="grid2">
        <FormNo id="pt-no" form="permit" label={t("hs.permitNo")} value={f.permitNo} on={(v) => setF({ ...f, permitNo: v })} />
        <div className="field"><label htmlFor="pt-type">{t("hs.type")}</label>
          <select id="pt-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, equipmentId: "" })}>
            {Object.entries(data.permitTypes).map(([k, x]) => <option key={k} value={k}>{L(`hse.permit.${k}`, x.title)}{x.gas ? ` — ${t("hs.gasTest")}` : ""}</option>)}
          </select></div>
        <Field id="pt-area" label={t("hs.areaUnit")} value={f.area} on={(v) => setF({ ...f, area: v })} required />
        <Field id="pt-desc" label={t("hs.workDesc")} value={f.description} on={(v) => setF({ ...f, description: v })} required />
        <div className="field"><label htmlFor="pt-c">{t("c.contractor")}</label>
          <select id="pt-c" value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}>
            <option value="">—</option>
            {data.contractors.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select></div>
        <Field id="pt-req" label={t("hs.performing")} value={f.requesterName} on={(v) => setF({ ...f, requesterName: v })} />
        <Field id="pt-from" label={t("hs.from")} type="datetime-local" value={f.validFrom} on={(v) => setF({ ...f, validFrom: v })} required />
        <Field id="pt-to" label={t("hs.to")} type="datetime-local" value={f.validTo} on={(v) => setF({ ...f, validTo: v })} required />
        {f.type === "confined_space" && <Field id="pt-att" label={t("hs.attendant")} value={f.attendant} on={(v) => setF({ ...f, attendant: v })} />}
        {f.type === "electrical_isolation" && <Field id="pt-iso" label={t("hs.isolationRef")} value={f.isolationRef} on={(v) => setF({ ...f, isolationRef: v })} />}
        {eqKind[f.type] && (
          <div className="field"><label htmlFor="pt-eq">{L(`hse.eq.${eqKind[f.type]}`, EQ_FA[eqKind[f.type]])}</label>
            <select id="pt-eq" value={f.equipmentId} onChange={(e) => setF({ ...f, equipmentId: e.target.value })}>
              <option value="">—</option>
              {sw.equipment.filter((e) => e.kind === eqKind[f.type] && e.state.code !== "dismantled").map((e) => (
                <option key={e.id} value={e.id}>{e.ref_no} — {eqStateText(e, t, date)}</option>))}
            </select></div>
        )}
        <div className="field"><label htmlFor="pt-jsa">JSA</label>
          <select id="pt-jsa" value={f.jsaId} onChange={(e) => setF({ ...f, jsaId: e.target.value })}>
            <option value="">—</option>
            {sw.jsas.filter((j) => j.status === "approved").map((j) => <option key={j.id} value={j.id}>{j.jsa_no} Rev {j.revision} — {j.title}</option>)}
          </select></div>
      </div>
      {sw.people.length > 0 && (
        <fieldset className="card" style={{ padding: 8, marginTop: 8 }}>
          <legend className="sm">{t("hs.crewLegend")}</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {sw.people.map((p) => (
              <label key={p.id} className="sm"><input type="checkbox" checked={f.crew.includes(p.id)}
                onChange={() => setF({ ...f, crew: f.crew.includes(p.id) ? f.crew.filter((x) => x !== p.id) : [...f.crew, p.id] })} /> {p.full_name}</label>
            ))}
          </div>
        </fieldset>
      )}
      <p className="muted sm">{t("hs.issueOther")}</p>
      <div><button className="btn" type="submit">{t("hs.saveRequest")}</button></div>
    </form>
  );
}

function IncidentRow({ i, data, post, mayRecord, call, projectId }) {
  const [open, setOpen] = useState(false);
  const [hist, setHist] = useState(null);
  const { t, L, dateTime } = usePrefs();
  const yn = (v) => (v === true ? t("hs.yes") : v === false ? t("hs.no") : t("hs.unknown"));
  async function toggle() {
    const next = !open; setOpen(next);
    if (next) { try { setHist((await call(`/api/hse?projectId=${projectId}&incidentId=${i.id}`)).history); } catch { setHist([]); } }
  }
  return (
    <>
      <tr>
        <td className="mono">{i.ref_no}</td>
        <td className="mono sm">{dateTime(i.occurred_at)}</td>
        <td className="mono">{i.contractor_code || "EPC"}</td>
        <td className="mono">{i.area || "—"}</td>
        <td>{i.description}</td>
        <td>{i.cls ? <span className={`pill ${CLS_TONE[i.cls]}`}>{i.cls} · {L(`hse.cls.${i.cls}`, i.clsTitle)}</span>
          : <span className="pill warn" title={i.clsReason}>{t("hs.noClass")}</span>}
          {!i.cls && <div className="muted sm">{i.clsReason}</div>}</td>
        <td><button className="btn ghost" onClick={toggle}>{open ? t("common.close") : t("pu.details")}</button></td>
      </tr>
      {open && (
        <tr><td colSpan={7}>
          <p className="sm">
            {t("hs.f.injured")}: {yn(i.injured)} · {t("hs.f.fatal")}: {yn(i.fatal)} · {t("hs.f.daysAway")}: {i.days_away ?? "—"} · {t("hs.f.restricted")}: {i.restricted_days ?? "—"} ·
            {" "}{t("hs.f.treatment")}: {i.treatment ? L(`hse.treat.${i.treatment}`, data.treatments[i.treatment]) : "—"}
          </p>
          {hist?.length > 0 && (
            <ul className="sm">
              {hist.map((h) => (
                <li key={h.id}>{dateTime(h.created_at)} — {h.changed_by_name || "?"}: {Object.keys(h.after).map((k) =>
                  `${k}: ${h.before[k] ?? "—"} → ${h.after[k] ?? "—"}`).join(t("c.sep"))} — «{h.reason}»</li>
              ))}
            </ul>
          )}
          {mayRecord && <FactsForm i={i} data={data} post={post} />}
        </td></tr>
      )}
    </>
  );
}

function FactsForm({ i, data, post }) {
  const init = { injured: tri(i.injured), fatal: tri(i.fatal), daysAway: i.days_away ?? "", restrictedDays: i.restricted_days ?? "",
    treatment: i.treatment || "" };
  const [f, setF] = useState(init);
  const [reason, setReason] = useState("");
  const { t } = usePrefs();
  return (
    <form className="card grid2" style={{ padding: 10, alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault();
      const patch = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== init[k]));
      if (await post({ kind: "incident-update", incidentId: i.id, patch, reason })) setReason("");
    }}>
      <Facts f={f} setF={setF} data={data} id={i.id} />
      <Field id={`rs-${i.id}`} label={t("hs.changeWhy")} value={reason} on={setReason} required />
      <div><button className="btn" type="submit">{t("hs.saveFacts")}</button></div>
    </form>
  );
}

function Facts({ f, setF, data, id }) {
  const { t, L } = usePrefs();
  const tri3 = (k, label) => (
    <div className="field"><label htmlFor={`${k}-${id}`}>{label}</label>
      <select id={`${k}-${id}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
        <option value="">{t("hs.unknown")}</option><option value="true">{t("hs.yes")}</option><option value="false">{t("hs.no")}</option>
      </select></div>
  );
  return (
    <>
      {tri3("injured", t("hs.q.injured"))}
      {tri3("fatal", t("hs.q.fatal"))}
      <Field id={`da-${id}`} label={t("hs.q.daysAway")} type="number" value={f.daysAway} on={(v) => setF({ ...f, daysAway: v })} />
      <Field id={`rd-${id}`} label={t("hs.f.restricted")} type="number" value={f.restrictedDays} on={(v) => setF({ ...f, restrictedDays: v })} />
      <div className="field"><label htmlFor={`tr-${id}`}>{t("hs.f.treatment")}</label>
        <select id={`tr-${id}`} value={f.treatment} onChange={(e) => setF({ ...f, treatment: e.target.value })}>
          <option value="">{t("hs.unknown")}</option>
          {Object.entries(data.treatments).map(([k, x]) => <option key={k} value={k}>{L(`hse.treat.${k}`, x)}</option>)}
        </select></div>
    </>
  );
}

function IncidentForm({ data, post }) {
  const blank = { refNo: "", occurredAt: nowLocal(), area: "", contractorId: "", description: "",
    injured: "", fatal: "", daysAway: "", restrictedDays: "", treatment: "" };
  const [f, setF] = useState(blank);
  const { t } = usePrefs();
  return (
    <form style={{ marginTop: 10 }} onSubmit={async (e) => {
      e.preventDefault();
      if (await post({ kind: "incident", ...f, occurredAt: new Date(f.occurredAt).toISOString() })) setF(blank);
    }}>
      <h2>{t("hs.reportIncident")}</h2>
      <div className="grid2">
        <FormNo id="in-ref" form="incident" label={t("c.no")} value={f.refNo} on={(v) => setF({ ...f, refNo: v })} />
        <Field id="in-at" label={t("hs.time")} type="datetime-local" value={f.occurredAt} on={(v) => setF({ ...f, occurredAt: v })} required />
        <Field id="in-area" label={t("hs.area")} value={f.area} on={(v) => setF({ ...f, area: v })} />
        <div className="field"><label htmlFor="in-c">{t("c.contractor")}</label>
          <select id="in-c" value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}>
            <option value="">{t("hs.epcStaff")}</option>
            {data.contractors.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select></div>
        <Field id="in-desc" label={t("c.description")} value={f.description} on={(v) => setF({ ...f, description: v })} required />
        <Facts f={f} setF={setF} data={data} id="new" />
      </div>
      <p className="muted sm">{t("hs.incFormNote")}</p>
      <div><button className="btn" type="submit">{t("hs.saveIncident")}</button></div>
    </form>
  );
}

function ObservationRow({ o, data, post, mayRecord }) {
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const [closedOn, setClosedOn] = useState(today());
  const { t, L, date } = usePrefs();
  const st = OBS[o.state];
  return (
    <>
      <tr>
        <td className="mono sm">{date(o.observed_on)}</td>
        <td>{L(`hse.obs.${o.kind}`, data.observationKinds[o.kind])}</td>
        <td>{o.severity ? L(`hse.sev.${o.severity}`, data.severities[o.severity]) : "—"}</td>
        <td className="mono">{o.area || "—"}{o.contractor_code && <div className="muted sm">{o.contractor_code}</div>}</td>
        <td>{o.description}</td>
        <td>{o.action || "—"}{o.closed_note && <div className="muted sm">{t("hs.done")} {o.closed_note}</div>}</td>
        <td className="mono sm">{o.due_on ? date(o.due_on) : "—"}</td>
        <td><span className={`pill ${st}`}>{t(`hs.obs.${o.state}`)}</span></td>
        <td>{mayRecord && !o.closed_on && o.kind !== "good_practice" && <button className="btn ghost" onClick={() => setClosing(!closing)}>{t("common.close")}</button>}</td>
      </tr>
      {closing && (
        <tr><td colSpan={9}>
          <form style={{ display: "flex", gap: 8 }} onSubmit={async (e) => {
            e.preventDefault(); if (await post({ kind: "observation-close", observationId: o.id, closedOn, note })) setClosing(false);
          }}>
            <input className="search" aria-label={t("hs.actionDone")} placeholder={t("hs.actionDone")} value={note} onChange={(e) => setNote(e.target.value)} required />
            <input type="date" dir="ltr" aria-label={t("hs.closedOn")} value={closedOn} onChange={(e) => setClosedOn(e.target.value)} required />
            <button className="btn" type="submit">{t("hs.saveClose")}</button>
          </form>
        </td></tr>
      )}
    </>
  );
}

function ObservationForm({ data, post }) {
  const blank = { observedOn: today(), kind: "unsafe_condition", severity: "medium", area: "", contractorId: "",
    description: "", action: "", dueOn: "" };
  const [f, setF] = useState(blank);
  const good = f.kind === "good_practice";
  const { t, L } = usePrefs();
  return (
    <form style={{ marginTop: 10 }} onSubmit={async (e) => {
      // `kind` is the request's; the observation's own kind travels as obsKind.
      e.preventDefault(); const { kind: obsKind, ...rest } = f;
      if (await post({ ...rest, obsKind, kind: "observation" })) setF(blank);
    }}>
      <h2>{t("hs.recordObs")}</h2>
      <div className="grid2">
        <Field id="ob-d" label={t("c.date")} type="date" value={f.observedOn} on={(v) => setF({ ...f, observedOn: v })} required />
        <div className="field"><label htmlFor="ob-k">{t("hs.type")}</label>
          <select id="ob-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {Object.entries(data.observationKinds).map(([k, x]) => <option key={k} value={k}>{L(`hse.obs.${k}`, x)}</option>)}
          </select></div>
        {!good && <div className="field"><label htmlFor="ob-s">{t("hs.severity")}</label>
          <select id="ob-s" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>
            {Object.entries(data.severities).map(([k, x]) => <option key={k} value={k}>{L(`hse.sev.${k}`, x)}</option>)}
          </select></div>}
        <Field id="ob-a" label={t("hs.area")} value={f.area} on={(v) => setF({ ...f, area: v })} />
        <div className="field"><label htmlFor="ob-c">{t("c.contractor")}</label>
          <select id="ob-c" value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}>
            <option value="">—</option>
            {data.contractors.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select></div>
        <Field id="ob-desc" label={t("c.description")} value={f.description} on={(v) => setF({ ...f, description: v })} required />
        {!good && <Field id="ob-act" label={t("hs.corrective")} value={f.action} on={(v) => setF({ ...f, action: v })} required />}
        {!good && <Field id="ob-due" label={t("c.due")} type="date" value={f.dueOn} on={(v) => setF({ ...f, dueOn: v })} required />}
      </div>
      <div><button className="btn" type="submit">{t("hs.recordObs")}</button></div>
    </form>
  );
}

function Field({ id, label, value, on, type = "text", required, hint }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} step={type === "number" ? "any" : undefined} dir={type === "text" ? "auto" : "ltr"}
             required={required} value={value} onChange={(e) => on(e.target.value)} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, "0");
function nowLocal(plusHours = 0) {
  const d = new Date(Date.now() + plusHours * 3_600_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const tri = (v) => (v === true ? "true" : v === false ? "false" : "");
