"use client";
import { useState } from "react";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import { useRemove } from "../../lib/client/remove.mjs";
import FormNo from "../../components/ui/FormNo";
import { usePrefs } from "../../lib/client/prefs.mjs";
import { EQUIPMENT_KINDS } from "../../lib/hse/safework.mjs";

/**
 * Safe work before the permit: the project's rules, people and their
 * competence cards, scaffolds and cranes with their inspections, and JSAs.
 * Each of these is checked when a permit is issued (lib/hse/safework.mjs).
 */
const CARD = { valid: "ok", expired: "bad", revoked: "", future: "warn", unknown: "warn" };
const EQ = { valid: "ok", failed: "bad", expired: "bad", never: "warn", unknown: "warn", dismantled: "" };
// tones; the words are hs.jsa.<status>
const JSA = { draft: "warn", approved: "ok", superseded: "" };
/** The Persian names, the fallback of a label (lib/hse/safework.mjs is where they are declared). */
export const EQ_FA = Object.fromEntries(Object.entries(EQUIPMENT_KINDS).map(([k, v]) => [k, v.title]));
/**
 * A card's or a scaffold's state in the reader's language, from its code and
 * its own dates (the server's text is Persian, with ISO dates inside).
 */
export function cardStateText(c, t, date) {
  const code = c.state.code;
  if (code === "valid") return c.noExpiry ? t("hs.card.validNoExpiry") : t("hs.card.validUntil", { on: date(c.expiresOn) });
  if (code === "revoked") return t("hs.card.revoked", { on: date(c.revokedOn) });
  if (code === "future") return t("hs.card.future", { on: date(c.issuedOn) });
  if (code === "expired") return c.expiresOn ? t("hs.card.expired", { on: date(c.expiresOn) }) : t("hs.card.none");
  return t("hs.card.noExpiryDate");
}
export function eqStateText(e, t, date) {
  const { code, validUntil } = e.state;
  if (code === "dismantled") return t("hs.eq.dismantled", { on: date(e.dismantled_on) });
  if (code === "never") return t("hs.eq.never");
  if (code === "failed") return t("hs.eq.failed", { on: date(e.last?.inspectedOn) });
  if (code === "unknown") return t("hs.eq.unknown");
  if (code === "expired") return t("hs.eq.expired", { on: date(validUntil) });
  return t("hs.eq.valid", { on: date(validUntil) });
}
const tone = (r) => (r === null ? "" : r > 15 ? "bad" : r > 6 ? "warn" : "ok");
/** ISO dates inside Persian text flip under RTL; each is isolated as a left-to-right run. */
export const Dates = ({ text }) => String(text).split(/(\d{4}-\d{2}-\d{2})/).map((t, i) => (i % 2 ? <bdi key={i} dir="ltr">{t}</bdi> : t));
const Score = ({ l, s, r }) => <span className={`pill ${tone(r)}`} dir="ltr">{l}×{s}={r}</span>;

export default function SafeWork({ data, post, reload, mayRecord, mayIssue, mayAdmin }) {
  const s = data.safeWork;
  return (
    <>
      <Rules data={data} post={post} mayAdmin={mayAdmin} />
      <People s={s} data={data} post={post} reload={reload} mayRecord={mayRecord} />
      <Equipment s={s} data={data} post={post} reload={reload} mayRecord={mayRecord} />
      <Jsas s={s} data={data} post={post} reload={reload} mayRecord={mayRecord} mayIssue={mayIssue} />
    </>
  );
}

function Rules({ data, post, mayAdmin }) {
  const s = data.safeWork;
  const rules = s.settings.hse_competence_rules;
  const jsaList = s.settings.hse_jsa_required_types;
  const [edit, setEdit] = useState(false);
  const { t, L } = usePrefs();
  return (
    <div className="card">
      <h2>{t("hs.rules.title")}</h2>
      <p className="muted sm">
        {t("hs.rules.note1")} <a href="/assumptions">{t("hs.rules.missing")}</a>{t("hs.rules.note2")} <a href="/project">{t("hs.projectSpec")}</a>:
        {" "}{t("hs.rules.settings", { scaffold: s.settings.hse_scaffold_inspection_days ?? "—", crane: s.settings.hse_crane_inspection_days ?? "—", risk: s.settings.hse_risk_max_residual ?? "—" })}
      </p>
      <TableKit name="hse-rules">
        <table className="dtable">
          <thead><tr><th>{t("hs.rules.permitType")}</th><th>{t("hs.rules.competence")}</th><th>JSA</th></tr></thead>
          <tbody>
            {Object.entries(data.permitTypes).map(([key, x]) => {
              const pt = { ...x, key };
              const r = rules && key in rules ? rules[key] : null;
              return (
                <tr key={key}>
                  <td>{L(`hse.permit.${pt.key}`, pt.title)}</td>
                  <td className="sm">{r === null ? <span className="pill warn">{t("hs.rules.unset")}</span> : r.length === 0 ? <span className="muted">{t("hs.rules.none")}</span>
                    : r.map((k) => <span key={k} className="pill" style={{ marginInlineEnd: 4 }}>{L(`hse.comp.${k}`, s.competences[k])}</span>)}</td>
                  <td className="sm">{jsaList == null ? <span className="pill warn">{t("hs.rules.unset")}</span> : jsaList.includes(pt.key) ? <span className="pill ok">{t("pu.required")}</span> : <span className="muted">{t("hs.notNeeded")}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableKit>
      {mayAdmin && <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setEdit(!edit)}>{edit ? t("common.close") : t("hs.rules.edit")}</button>}
      {edit && <RulesForm data={data} post={async (b) => { if (await post(b)) setEdit(false); }} />}
    </div>
  );
}

function RulesForm({ data, post }) {
  const s = data.safeWork;
  const init = s.settings.hse_competence_rules || {};
  const [rules, setRules] = useState(Object.fromEntries(Object.keys(data.permitTypes).map((type) => [type, type in init ? [...init[type]] : null])));
  const [jsaStated, setJsaStated] = useState(s.settings.hse_jsa_required_types != null);
  const [jsa, setJsa] = useState(new Set(s.settings.hse_jsa_required_types || []));
  const toggle = (type, k) => setRules({ ...rules, [type]: rules[type].includes(k) ? rules[type].filter((x) => x !== k) : [...rules[type], k] });
  const { t, L } = usePrefs();
  return (
    <form style={{ marginTop: 10 }} onSubmit={(e) => {
      e.preventDefault();
      const declared = Object.fromEntries(Object.entries(rules).filter(([, v]) => v !== null));
      post({ kind: "sw-rules", competenceRules: Object.keys(declared).length ? declared : null, jsaRequiredTypes: jsaStated ? [...jsa] : null });
    }}>
      {Object.entries(data.permitTypes).map(([type, pt]) => (
        <fieldset key={type} className="card" style={{ padding: 8, marginBottom: 6 }}>
          <legend className="sm"><label><input type="checkbox" checked={rules[type] !== null}
            onChange={(e) => setRules({ ...rules, [type]: e.target.checked ? [] : null })} /> {L(`hse.permit.${type}`, pt.title)} — {t("hs.rules.stated")}</label></legend>
          {rules[type] !== null && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {Object.entries(s.competences).map(([k, title]) => (
                <label key={k} className="sm"><input type="checkbox" checked={rules[type].includes(k)} onChange={() => toggle(type, k)} /> {L(`hse.comp.${k}`, title)}</label>
              ))}
            </div>
          )}
        </fieldset>
      ))}
      <fieldset className="card" style={{ padding: 8 }}>
        <legend className="sm"><label><input type="checkbox" checked={jsaStated} onChange={(e) => setJsaStated(e.target.checked)} /> {t("hs.rules.jsaTypes")} — {t("hs.rules.stated")}</label></legend>
        {jsaStated && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {Object.entries(data.permitTypes).map(([type, pt]) => (
              <label key={type} className="sm"><input type="checkbox" checked={jsa.has(type)}
                onChange={() => { const n = new Set(jsa); n.has(type) ? n.delete(type) : n.add(type); setJsa(n); }} /> {L(`hse.permit.${type}`, pt.title)}</label>
            ))}
          </div>
        )}
      </fieldset>
      <button className="btn" type="submit" style={{ marginTop: 8 }}>{t("hs.rules.save")}</button>
    </form>
  );
}

function People({ s, data, post, reload, mayRecord }) {
  const [editing, setEditing] = useState(null);
  const removal = useRemove("hse-person", reload);
  const { t, L, date } = usePrefs();
  return (
    <div className="card">
      <h2>{t("hs.people.title")}</h2>
      <p className="muted sm">{t("hs.people.note")}</p>
      {s.people.length === 0 ? <p className="empty-note">{t("hs.people.empty")}</p> : (
        <TableKit name="hse-people" {...(mayRecord ? removal : {})}
                  onEdit={mayRecord ? (id) => setEditing(s.people.find((p) => p.id === id)) : undefined}
                  rowEdit={mayRecord ? { fields: [{ col: t("pu.v.name"), name: "fullName" }], value: (id) => personOf(s.people.find((p) => p.id === id)),
                    onSave: (id, v) => post({ kind: "person", ...v }) } : undefined}>
          <table className="dtable">
            <thead><tr><th>{t("pu.v.name")}</th><th>{t("hs.people.idNo")}</th><th>{t("hs.people.contractorTrade")}</th><th>{t("hs.people.cards")}</th></tr></thead>
            <tbody>
              {s.people.map((p) => (
                <tr key={p.id} data-key={p.id}>
                  <td>{p.full_name}</td>
                  <td className="mono sm">{p.id_no}</td>
                  <td className="sm">{[p.contractor_code, p.trade].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="sm">{p.cards.length === 0 ? <span className="muted">—</span> : p.cards.map((c) => (
                    <span key={c.id} className={`pill ${CARD[c.state.code]}`} style={{ marginInlineEnd: 4 }} title={[c.certNo, c.issuer, c.revokedReason].filter(Boolean).join(" · ")}>
                      {L(`hse.comp.${c.kind}`, c.title)}: {cardStateText(c, t, date)}</span>))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {mayRecord && <Fold title={t("hs.people.add")}><PersonForm data={data} post={post} /></Fold>}
      {mayRecord && (
        <Fold title={t("hs.people.edit", { name: editing?.full_name || "" })} button={false} open={!!editing} onClose={() => setEditing(null)}>
          {editing && <PersonForm key={editing.id} initial={editing} data={data} post={post} onDone={() => setEditing(null)} />}
        </Fold>
      )}
      {mayRecord && s.people.length > 0 && <Fold title={t("hs.card.add")}><CardForm s={s} post={post} /></Fold>}
      {mayRecord && s.people.some((p) => p.cards.some((c) => !c.revokedOn)) && <Fold title={t("hs.card.revokeFold")}><RevokeForm s={s} post={post} /></Fold>}
    </div>
  );
}

/** New, or the same form filled with a person to amend (the ID number is the key and stays). */
const personOf = (p) => ({ idNo: p.id_no, fullName: p.full_name, contractorId: p.contractor_id || "", trade: p.trade || "" });

function PersonForm({ data, post, initial = null, onDone }) {
  const blank = { idNo: "", fullName: "", contractorId: "", trade: "" };
  const [f, setF] = useState(initial ? personOf(initial) : blank);
  const x = initial ? "pe" : "ps";
  const { t } = usePrefs();
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault();
      if (await post({ kind: "person", ...f })) { if (initial) onDone?.(); else setF(blank); }
    }}>
      <Field id={`${x}-id`} label={t("hs.people.idNoHelp")} value={f.idNo} on={(v) => setF({ ...f, idNo: v })} required readOnly={!!initial} />
      <Field id={`${x}-name`} label={t("hs.people.fullName")} value={f.fullName} on={(v) => setF({ ...f, fullName: v })} required />
      <div className="field"><label htmlFor={`${x}-c`}>{t("c.contractor")}</label>
        <select id={`${x}-c`} value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}>
          <option value="">{t("hs.epcStaff")}</option>
          {data.contractors.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
        </select></div>
      <Field id={`${x}-trade`} label={t("hs.people.trade")} value={f.trade} on={(v) => setF({ ...f, trade: v })} />
      <div><button className="btn" type="submit">{initial ? t("pu.v.saveChanges") : t("hs.people.add")}</button></div>
    </form>
  );
}

function CardForm({ s, post }) {
  const blank = { personId: s.people[0]?.id || "", kind: "induction", certNo: "", issuer: "", issuedOn: "", expiresOn: "", noExpiry: false };
  const [f, setF] = useState(blank);
  const { t, L } = usePrefs();
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault();
      const { kind: cardKind, ...rest } = f;
      if (await post({ ...rest, kind: "card", cardKind })) setF({ ...blank, personId: f.personId });
    }}>
      <div className="field"><label htmlFor="cd-p">{t("hs.card.person")}</label>
        <select id="cd-p" value={f.personId} onChange={(e) => setF({ ...f, personId: e.target.value })}>
          {s.people.map((p) => <option key={p.id} value={p.id}>{p.full_name} — {p.id_no}</option>)}
        </select></div>
      <div className="field"><label htmlFor="cd-k">{t("hs.card.competence")}</label>
        <select id="cd-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {Object.entries(s.competences).map(([k, x]) => <option key={k} value={k}>{L(`hse.comp.${k}`, x)}</option>)}
        </select></div>
      <Field id="cd-no" label={t("hs.card.no")} value={f.certNo} on={(v) => setF({ ...f, certNo: v })} />
      <Field id="cd-is" label={t("hs.card.issuer")} value={f.issuer} on={(v) => setF({ ...f, issuer: v })} />
      <Field id="cd-from" label={t("hs.card.issuedOn")} type="date" value={f.issuedOn} on={(v) => setF({ ...f, issuedOn: v })} required />
      <Field id="cd-to" label={t("hs.card.expiresOn")} type="date" value={f.expiresOn} on={(v) => setF({ ...f, expiresOn: v, noExpiry: false })} />
      <label className="sm"><input type="checkbox" checked={f.noExpiry} onChange={(e) => setF({ ...f, noExpiry: e.target.checked, expiresOn: e.target.checked ? "" : f.expiresOn })} /> {t("hs.card.noExpiryBox")}</label>
      <div><button className="btn" type="submit">{t("hs.card.save")}</button></div>
    </form>
  );
}

function RevokeForm({ s, post }) {
  const cards = s.people.flatMap((p) => p.cards.filter((c) => !c.revokedOn).map((c) => ({ ...c, who: p.full_name })));
  const [f, setF] = useState({ competenceId: cards[0]?.id || "", revokedOn: "", reason: "" });
  const { t, L } = usePrefs();
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "card-revoke", ...f })) setF({ ...f, reason: "" }); }}>
      <div className="field"><label htmlFor="rv-c">{t("hs.card.card")}</label>
        <select id="rv-c" value={f.competenceId} onChange={(e) => setF({ ...f, competenceId: e.target.value })}>
          {cards.map((c) => <option key={c.id} value={c.id}>{c.who} — {L(`hse.comp.${c.kind}`, c.title)}</option>)}
        </select></div>
      <Field id="rv-d" label={t("hs.card.revokedOn")} type="date" value={f.revokedOn} on={(v) => setF({ ...f, revokedOn: v })} required />
      <Field id="rv-r" label={t("pu.vdt.reason")} value={f.reason} on={(v) => setF({ ...f, reason: v })} required />
      <div><button className="btn" type="submit">{t("hs.card.revoke")}</button></div>
    </form>
  );
}

function Equipment({ s, data, post, reload, mayRecord }) {
  const live = s.equipment.filter((e) => e.state.code !== "dismantled");
  const removal = useRemove("hse-equipment", reload);
  const { t, L, date } = usePrefs();
  return (
    <div className="card">
      <h2>{t("hs.eq.title")}</h2>
      <p className="muted sm">{t("hs.eq.note")}</p>
      {s.equipment.length === 0 ? <p className="empty-note">{t("hs.eq.empty")}</p> : (
        <TableKit name="hse-eq" {...(mayRecord ? removal : {})}>
          <table className="dtable">
            <thead><tr><th>{t("c.no")}</th><th>{t("hs.type")}</th><th>{t("hs.area")}</th><th>{t("c.status")}</th><th>{t("hs.eq.lastInspection")}</th></tr></thead>
            <tbody>
              {s.equipment.map((e) => (
                <tr key={e.id} data-key={e.id}>
                  <td className="mono">{e.ref_no}</td>
                  <td className="sm">{L(`hse.eq.${e.kind}`, e.kindTitle)}{e.capacity_t ? <> · <bdi dir="ltr">{Number(e.capacity_t)} t</bdi></> : ""}</td>
                  <td className="sm">{e.area || "—"}</td>
                  <td><span className={`pill ${EQ[e.state.code]}`}>{eqStateText(e, t, date)}</span></td>
                  <td className="sm">{e.last ? <>{date(e.last.inspectedOn)}{` · ${e.last.result === "pass" ? t("hs.eq.pass") : t("hs.eq.fail")} · ${e.last.inspector_name}${e.last.findings ? ` — ${e.last.findings}` : ""}`}</> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {mayRecord && <Fold title={t("hs.eq.add")}><EquipmentForm data={data} post={post} /></Fold>}
      {mayRecord && live.length > 0 && <Fold title={t("hs.eq.inspectFold")}><InspectForm s={s} live={live} post={post} /></Fold>}
    </div>
  );
}

function EquipmentForm({ data, post }) {
  const blank = { equipmentKind: "scaffold", refNo: "", area: "", description: "", contractorId: "", capacityT: "" };
  const [f, setF] = useState(blank);
  const { t, L } = usePrefs();
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "equipment", ...f })) setF(blank); }}>
      <div className="field"><label htmlFor="eq-k">{t("hs.type")}</label>
        <select id="eq-k" value={f.equipmentKind} onChange={(e) => setF({ ...f, equipmentKind: e.target.value })}>
          {Object.entries(data.safeWork.equipmentKinds).map(([k, x]) => <option key={k} value={k}>{L(`hse.eq.${k}`, x.title)}</option>)}
        </select></div>
      <Field id="eq-no" label={t("hs.eq.refNo")} value={f.refNo} on={(v) => setF({ ...f, refNo: v })} required />
      <Field id="eq-a" label={t("hs.area")} value={f.area} on={(v) => setF({ ...f, area: v })} />
      <Field id="eq-d" label={t("c.description")} value={f.description} on={(v) => setF({ ...f, description: v })} />
      {f.equipmentKind === "crane" && <Field id="eq-cap" label={t("hs.eq.capacity")} type="number" value={f.capacityT} on={(v) => setF({ ...f, capacityT: v })} />}
      <div><button className="btn" type="submit">{t("c.submit")}</button></div>
    </form>
  );
}

function InspectForm({ s, live, post }) {
  const blank = { equipmentId: live[0]?.id || "", inspectedOn: "", result: "pass", inspectorId: s.people[0]?.id || "", certRef: "", findings: "" };
  const [f, setF] = useState(blank);
  const { t, L } = usePrefs();
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "equipment-inspect", ...f })) setF({ ...blank, equipmentId: f.equipmentId }); }}>
      <div className="field"><label htmlFor="in-e">{t("hs.eq.which")}</label>
        <select id="in-e" value={f.equipmentId} onChange={(e) => setF({ ...f, equipmentId: e.target.value })}>
          {live.map((e) => <option key={e.id} value={e.id}>{e.ref_no} — {L(`hse.eq.${e.kind}`, e.kindTitle)}</option>)}
        </select></div>
      <Field id="in-d" label={t("pu.f.inspectedOn")} type="date" value={f.inspectedOn} on={(v) => setF({ ...f, inspectedOn: v })} required />
      <div className="field"><label htmlFor="in-r">{t("c.result")}</label>
        <select id="in-r" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}>
          <option value="pass">{t("hs.eq.passTag")}</option><option value="fail">{t("hs.eq.failTag")}</option>
        </select></div>
      <div className="field"><label htmlFor="in-i">{t("c.inspector")}</label>
        <select id="in-i" value={f.inspectorId} onChange={(e) => setF({ ...f, inspectorId: e.target.value })}>
          {s.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select></div>
      <Field id="in-c" label={t("hs.eq.certRef")} value={f.certRef} on={(v) => setF({ ...f, certRef: v })} />
      <Field id="in-f" label={t("hs.eq.findings")} value={f.findings} on={(v) => setF({ ...f, findings: v })} />
      <div><button className="btn" type="submit">{t("hs.eq.saveInspection")}</button></div>
    </form>
  );
}

function Jsas({ s, data, post, reload, mayRecord, mayIssue }) {
  const { t } = usePrefs();
  return (
    <div className="card">
      <h2>JSA / TRA</h2>
      <p className="muted sm">{t("hs.jsa.note")}</p>
      {s.jsas.length === 0 ? <p className="empty-note">{t("hs.jsa.empty")}</p> : s.jsas.map((j) => (
        <JsaCard key={j.id} j={j} post={post} reload={reload} mayRecord={mayRecord} mayIssue={mayIssue} />
      ))}
      {mayRecord && <Fold title={t("hs.jsa.new")}><JsaForm data={data} post={post} /></Fold>}
    </div>
  );
}

function JsaCard({ j, post, reload, mayRecord, mayIssue }) {
  const st = JSA[j.status];
  const { t, date } = usePrefs();
  const [rev, setRev] = useState("");
  const [editing, setEditing] = useState(null);
  const removal = useRemove("hse-jsa", reload);
  const draft = j.status === "draft";
  const locked = draft ? true : t("hs.jsa.locked");
  return (
    <div className="card" style={{ padding: 10, marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <b className="mono">{j.jsa_no} Rev {j.revision}</b><span>{j.title}</span><span className={`pill ${st}`}>{t(`hs.jsa.${j.status}`)}</span>
        <span className="muted sm">{t("hs.jsa.prepared")} {j.prepared_by_name || "?"}{j.approved_by_name && <> · {t("hs.jsa.approvedBy")} {j.approved_by_name} ({date(j.approved_on)})</>}</span>
      </div>
      {j.steps.length > 0 && (
        <TableKit name={`jsa-${j.jsa_no}`} min={4}
                  onEdit={mayRecord ? (seq) => setEditing(j.steps.find((x) => String(x.seq) === seq)) : undefined} canEdit={() => locked}
                  rowEdit={mayRecord ? { fields: [{ col: t("hs.jsa.step"), name: "step" }, { col: t("hs.jsa.hazard"), name: "hazard" }, { col: t("hs.jsa.control"), name: "controls" }],
                    value: (seq) => stepOf(j.steps.find((x) => String(x.seq) === seq)), onSave: (seq, v) => post({ kind: "jsa-step", jsaId: j.id, ...v }) } : undefined}
                  onDelete={mayRecord ? (seq) => post({ kind: "jsa-step-remove", jsaId: j.id, seq }) : undefined} canDelete={() => locked}>
        <table className="dtable" style={{ marginTop: 6 }}>
          <thead><tr><th>#</th><th>{t("hs.jsa.step")}</th><th>{t("hs.jsa.hazard")}</th><th>{t("hs.jsa.control")}</th><th>{t("hs.jsa.initial")}</th><th>{t("hs.jsa.residual")}</th></tr></thead>
          <tbody>{j.steps.map((x) => (
            <tr key={x.seq} data-key={x.seq}><td className="mono">{x.seq}</td><td className="sm">{x.step}</td><td className="sm">{x.hazard}</td><td className="sm">{x.controls || "—"}</td>
              <td><Score l={x.likelihood} s={x.severity} r={x.initial} /></td>
              <td>{x.residual === null ? "—" : <Score l={x.residualLikelihood} s={x.residualSeverity} r={x.residual} />}</td></tr>
          ))}</tbody>
        </table>
        </TableKit>
      )}
      {j.status === "draft" && j.problems.length > 0 && <p className="muted sm">{t("hs.jsa.beforeApproval")} {j.problems.join(" · ")}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        {mayIssue && j.status === "draft" && <button className="btn" onClick={() => post({ kind: "jsa-approve", jsaId: j.id })}>{t("hs.jsa.approve")}</button>}
        {mayRecord && draft && (
          <button className="btn ghost" onClick={async () => {
            const why = await removal.checkDelete(j.id).catch((e) => e.message);
            if (why !== true) { window.alert(why); return; }
            if (window.confirm(t("hs.jsa.confirmDelete", { no: j.jsa_no, rev: j.revision }))) await removal.onDelete(j.id).catch((e) => window.alert(e.message));
          }}>{t("hs.jsa.deleteDraft")}</button>
        )}
        {mayRecord && j.status === "approved" && (
          <form style={{ display: "flex", gap: 6 }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "jsa-revise", jsaId: j.id, revision: rev })) setRev(""); }}>
            <input aria-label={t("hs.jsa.newRev")} placeholder={t("hs.jsa.newRev")} value={rev} onChange={(e) => setRev(e.target.value)} style={{ width: 110 }} />
            <button className="btn ghost" type="submit">{t("hs.jsa.newRev")}</button>
          </form>
        )}
      </div>
      {mayRecord && draft && <Fold title={t("hs.jsa.addStep")}><StepForm j={j} post={post} /></Fold>}
      {mayRecord && draft && (
        <Fold title={t("hs.jsa.editStep", { seq: editing?.seq || "" })} button={false} open={!!editing} onClose={() => setEditing(null)}>
          {editing && <StepForm key={editing.seq} j={j} post={post} initial={editing} onDone={() => setEditing(null)} />}
        </Fold>
      )}
    </div>
  );
}

const s0 = (v) => (v === null || v === undefined ? "" : String(v));
const stepOf = (x) => ({ seq: String(x.seq), step: x.step, hazard: x.hazard, controls: s0(x.controls),
  likelihood: s0(x.likelihood), severity: s0(x.severity), residualLikelihood: s0(x.residualLikelihood), residualSeverity: s0(x.residualSeverity) });

function StepForm({ j, post, initial = null, onDone }) {
  const next = (j.steps.at(-1)?.seq || 0) + 10;
  const blank = { seq: String(next), step: "", hazard: "", controls: "", likelihood: "", severity: "", residualLikelihood: "", residualSeverity: "" };
  const [f, setF] = useState(initial ? stepOf(initial) : blank);
  const k = initial ? `e-${j.id}` : j.id;
  const { t } = usePrefs();
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault();
      if (await post({ kind: "jsa-step", jsaId: j.id, ...f })) { if (initial) onDone?.(); else setF({ ...blank, seq: String(Number(f.seq) + 10) }); }
    }}>
      <Field id={`js-q-${k}`} label={t("c.row")} type="number" value={f.seq} on={(v) => setF({ ...f, seq: v })} required readOnly={!!initial} />
      <Field id={`js-s-${k}`} label={t("hs.jsa.workStep")} value={f.step} on={(v) => setF({ ...f, step: v })} required />
      <Field id={`js-h-${k}`} label={t("hs.jsa.hazard")} value={f.hazard} on={(v) => setF({ ...f, hazard: v })} required />
      <Field id={`js-c-${k}`} label={t("hs.jsa.controlAction")} value={f.controls} on={(v) => setF({ ...f, controls: v })} />
      <Field id={`js-l-${k}`} label={t("hs.jsa.likelihood")} type="number" value={f.likelihood} on={(v) => setF({ ...f, likelihood: v })} required />
      <Field id={`js-v-${k}`} label={t("hs.jsa.sev")} type="number" value={f.severity} on={(v) => setF({ ...f, severity: v })} required />
      <Field id={`js-rl-${k}`} label={t("hs.jsa.resLikelihood")} type="number" value={f.residualLikelihood} on={(v) => setF({ ...f, residualLikelihood: v })} />
      <Field id={`js-rv-${k}`} label={t("hs.jsa.resSeverity")} type="number" value={f.residualSeverity} on={(v) => setF({ ...f, residualSeverity: v })} />
      <div><button className="btn" type="submit">{initial ? t("hs.jsa.saveEdit") : t("hs.jsa.saveStep")}</button></div>
    </form>
  );
}

function JsaForm({ data, post }) {
  const blank = { jsaNo: "", revision: "0", title: "", area: "", contractorId: "" };
  const [f, setF] = useState(blank);
  const { t } = usePrefs();
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "jsa", ...f })) setF(blank); }}>
      <FormNo id="jn-no" form="jsa" label={t("hs.jsa.no")} value={f.jsaNo} on={(v) => setF({ ...f, jsaNo: v })} />
      <Field id="jn-rev" label={t("c.revision")} value={f.revision} on={(v) => setF({ ...f, revision: v })} required />
      <Field id="jn-t" label={t("hs.jsa.title")} value={f.title} on={(v) => setF({ ...f, title: v })} required />
      <Field id="jn-a" label={t("hs.area")} value={f.area} on={(v) => setF({ ...f, area: v })} />
      <div className="field"><label htmlFor="jn-c">{t("c.contractor")}</label>
        <select id="jn-c" value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}>
          <option value="">—</option>
          {data.contractors.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
        </select></div>
      <div><button className="btn" type="submit">{t("pu.mr.saveDraft")}</button></div>
    </form>
  );
}

function Field({ id, label, value, on, type = "text", required, readOnly }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} dir="auto" type={type} value={value} required={required} readOnly={readOnly} onChange={(e) => on(e.target.value)} />
    </div>
  );
}
