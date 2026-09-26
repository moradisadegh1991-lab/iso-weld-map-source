"use client";
import { useState } from "react";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import { useRemove } from "../../lib/client/remove.mjs";

/**
 * Safe work before the permit: the project's rules, people and their
 * competence cards, scaffolds and cranes with their inspections, and JSAs.
 * Each of these is checked when a permit is issued (lib/hse/safework.mjs).
 */
const CARD = { valid: "ok", expired: "bad", revoked: "", future: "warn", unknown: "warn" };
const EQ = { valid: "ok", failed: "bad", expired: "bad", never: "warn", unknown: "warn", dismantled: "" };
const JSA = { draft: ["warn", "پیش‌نویس"], approved: ["ok", "تأییدشده"], superseded: ["", "منسوخ"] };
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
  return (
    <div className="card">
      <h2>قواعد کار ایمن پروژه</h2>
      <p className="muted sm">
        سیاست کارفرما است و پیش‌فرضی ندارد. «تعیین نشده» یعنی سامانه آن را نمی‌سنجد و در <a href="/assumptions">اطلاعات ناقص</a> می‌آید؛
        «هیچ» یک تصمیم است. فاصلهٔ بازرسی داربست/جرثقیل و حد ریسک JSA در <a href="/project">مشخصات پروژه</a> است:
        {" "}داربست {s.settings.hse_scaffold_inspection_days ?? "—"} روز · جرثقیل {s.settings.hse_crane_inspection_days ?? "—"} روز · ریسک باقیمانده ≤ {s.settings.hse_risk_max_residual ?? "—"}
      </p>
      <TableKit name="hse-rules">
        <table className="dtable">
          <thead><tr><th>نوع مجوز</th><th>صلاحیت لازم برای هر نفر از خدمه</th><th>JSA</th></tr></thead>
          <tbody>
            {Object.entries(data.permitTypes).map(([t, pt]) => {
              const r = rules && t in rules ? rules[t] : null;
              return (
                <tr key={t}>
                  <td>{pt.title}</td>
                  <td className="sm">{r === null ? <span className="pill warn">تعیین نشده</span> : r.length === 0 ? <span className="muted">هیچ</span>
                    : r.map((k) => <span key={k} className="pill" style={{ marginInlineEnd: 4 }}>{s.competences[k]}</span>)}</td>
                  <td className="sm">{jsaList == null ? <span className="pill warn">تعیین نشده</span> : jsaList.includes(t) ? <span className="pill ok">لازم</span> : <span className="muted">لازم نیست</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableKit>
      {mayAdmin && <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setEdit(!edit)}>{edit ? "بستن" : "ویرایش قواعد"}</button>}
      {edit && <RulesForm data={data} post={async (b) => { if (await post(b)) setEdit(false); }} />}
    </div>
  );
}

function RulesForm({ data, post }) {
  const s = data.safeWork;
  const init = s.settings.hse_competence_rules || {};
  const [rules, setRules] = useState(Object.fromEntries(Object.keys(data.permitTypes).map((t) => [t, t in init ? [...init[t]] : null])));
  const [jsaStated, setJsaStated] = useState(s.settings.hse_jsa_required_types != null);
  const [jsa, setJsa] = useState(new Set(s.settings.hse_jsa_required_types || []));
  const toggle = (t, k) => setRules({ ...rules, [t]: rules[t].includes(k) ? rules[t].filter((x) => x !== k) : [...rules[t], k] });
  return (
    <form style={{ marginTop: 10 }} onSubmit={(e) => {
      e.preventDefault();
      const declared = Object.fromEntries(Object.entries(rules).filter(([, v]) => v !== null));
      post({ kind: "sw-rules", competenceRules: Object.keys(declared).length ? declared : null, jsaRequiredTypes: jsaStated ? [...jsa] : null });
    }}>
      {Object.entries(data.permitTypes).map(([t, pt]) => (
        <fieldset key={t} className="card" style={{ padding: 8, marginBottom: 6 }}>
          <legend className="sm"><label><input type="checkbox" checked={rules[t] !== null}
            onChange={(e) => setRules({ ...rules, [t]: e.target.checked ? [] : null })} /> {pt.title} — قاعده تعیین شده</label></legend>
          {rules[t] !== null && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {Object.entries(s.competences).map(([k, title]) => (
                <label key={k} className="sm"><input type="checkbox" checked={rules[t].includes(k)} onChange={() => toggle(t, k)} /> {title}</label>
              ))}
            </div>
          )}
        </fieldset>
      ))}
      <fieldset className="card" style={{ padding: 8 }}>
        <legend className="sm"><label><input type="checkbox" checked={jsaStated} onChange={(e) => setJsaStated(e.target.checked)} /> انواع مجوزی که JSA تأییدشده لازم دارند — تعیین شده</label></legend>
        {jsaStated && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {Object.entries(data.permitTypes).map(([t, pt]) => (
              <label key={t} className="sm"><input type="checkbox" checked={jsa.has(t)}
                onChange={() => { const n = new Set(jsa); n.has(t) ? n.delete(t) : n.add(t); setJsa(n); }} /> {pt.title}</label>
            ))}
          </div>
        )}
      </fieldset>
      <button className="btn" type="submit" style={{ marginTop: 8 }}>ذخیرهٔ قواعد</button>
    </form>
  );
}

function People({ s, data, post, reload, mayRecord }) {
  const [editing, setEditing] = useState(null);
  const removal = useRemove("hse-person", reload);
  return (
    <div className="card">
      <h2>افراد و کارت صلاحیت</h2>
      <p className="muted sm">کارت بدون تاریخ انقضا فقط وقتی معتبر است که «بدون انقضا» روی خود کارت آمده باشد. کارت پاک نمی‌شود؛ ابطال با دلیل ثبت می‌شود.</p>
      {s.people.length === 0 ? <p className="empty-note">کسی ثبت نشده است.</p> : (
        <TableKit name="hse-people" {...(mayRecord ? removal : {})}
                  onEdit={mayRecord ? (id) => setEditing(s.people.find((p) => p.id === id)) : undefined}>
          <table className="dtable">
            <thead><tr><th>نام</th><th>شمارهٔ شناسایی</th><th>پیمانکار / حرفه</th><th>کارت‌ها</th></tr></thead>
            <tbody>
              {s.people.map((p) => (
                <tr key={p.id} data-key={p.id}>
                  <td>{p.full_name}</td>
                  <td className="mono sm">{p.id_no}</td>
                  <td className="sm">{[p.contractor_code, p.trade].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="sm">{p.cards.length === 0 ? <span className="muted">—</span> : p.cards.map((c) => (
                    <span key={c.id} className={`pill ${CARD[c.state.code]}`} style={{ marginInlineEnd: 4 }} title={[c.certNo, c.issuer, c.revokedReason].filter(Boolean).join(" · ")}>
                      {c.title}: <Dates text={c.state.text} /></span>))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {mayRecord && <Fold title="ثبت فرد"><PersonForm data={data} post={post} /></Fold>}
      {mayRecord && (
        <Fold title={`ویرایش ${editing?.full_name || ""}`} button={false} open={!!editing} onClose={() => setEditing(null)}>
          {editing && <PersonForm key={editing.id} initial={editing} data={data} post={post} onDone={() => setEditing(null)} />}
        </Fold>
      )}
      {mayRecord && s.people.length > 0 && <Fold title="ثبت کارت صلاحیت"><CardForm s={s} post={post} /></Fold>}
      {mayRecord && s.people.some((p) => p.cards.some((c) => !c.revokedOn)) && <Fold title="ابطال کارت"><RevokeForm s={s} post={post} /></Fold>}
    </div>
  );
}

/** New, or the same form filled with a person to amend (the ID number is the key and stays). */
function PersonForm({ data, post, initial = null, onDone }) {
  const blank = { idNo: "", fullName: "", contractorId: "", trade: "" };
  const [f, setF] = useState(initial ? { idNo: initial.id_no, fullName: initial.full_name, contractorId: initial.contractor_id || "", trade: initial.trade || "" } : blank);
  const x = initial ? "pe" : "ps";
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault();
      if (await post({ kind: "person", ...f })) { if (initial) onDone?.(); else setF(blank); }
    }}>
      <Field id={`${x}-id`} label="شمارهٔ شناسایی (کد ملی / پرسنلی)" value={f.idNo} on={(v) => setF({ ...f, idNo: v })} required readOnly={!!initial} />
      <Field id={`${x}-name`} label="نام و نام خانوادگی" value={f.fullName} on={(v) => setF({ ...f, fullName: v })} required />
      <div className="field"><label htmlFor={`${x}-c`}>پیمانکار</label>
        <select id={`${x}-c`} value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}>
          <option value="">کارکنان EPC</option>
          {data.contractors.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
        </select></div>
      <Field id={`${x}-trade`} label="حرفه" value={f.trade} on={(v) => setF({ ...f, trade: v })} />
      <div><button className="btn" type="submit">{initial ? "ذخیرهٔ تغییرات" : "ثبت فرد"}</button></div>
    </form>
  );
}

function CardForm({ s, post }) {
  const blank = { personId: s.people[0]?.id || "", kind: "induction", certNo: "", issuer: "", issuedOn: "", expiresOn: "", noExpiry: false };
  const [f, setF] = useState(blank);
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault();
      const { kind: cardKind, ...rest } = f;
      if (await post({ ...rest, kind: "card", cardKind })) setF({ ...blank, personId: f.personId });
    }}>
      <div className="field"><label htmlFor="cd-p">فرد</label>
        <select id="cd-p" value={f.personId} onChange={(e) => setF({ ...f, personId: e.target.value })}>
          {s.people.map((p) => <option key={p.id} value={p.id}>{p.full_name} — {p.id_no}</option>)}
        </select></div>
      <div className="field"><label htmlFor="cd-k">صلاحیت</label>
        <select id="cd-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {Object.entries(s.competences).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select></div>
      <Field id="cd-no" label="شمارهٔ کارت / گواهی" value={f.certNo} on={(v) => setF({ ...f, certNo: v })} />
      <Field id="cd-is" label="صادرکننده" value={f.issuer} on={(v) => setF({ ...f, issuer: v })} />
      <Field id="cd-from" label="تاریخ صدور" type="date" value={f.issuedOn} on={(v) => setF({ ...f, issuedOn: v })} required />
      <Field id="cd-to" label="تاریخ انقضا" type="date" value={f.expiresOn} on={(v) => setF({ ...f, expiresOn: v, noExpiry: false })} />
      <label className="sm"><input type="checkbox" checked={f.noExpiry} onChange={(e) => setF({ ...f, noExpiry: e.target.checked, expiresOn: e.target.checked ? "" : f.expiresOn })} /> روی کارت «بدون تاریخ انقضا» آمده</label>
      <div><button className="btn" type="submit">ثبت کارت</button></div>
    </form>
  );
}

function RevokeForm({ s, post }) {
  const cards = s.people.flatMap((p) => p.cards.filter((c) => !c.revokedOn).map((c) => ({ ...c, who: p.full_name })));
  const [f, setF] = useState({ competenceId: cards[0]?.id || "", revokedOn: "", reason: "" });
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "card-revoke", ...f })) setF({ ...f, reason: "" }); }}>
      <div className="field"><label htmlFor="rv-c">کارت</label>
        <select id="rv-c" value={f.competenceId} onChange={(e) => setF({ ...f, competenceId: e.target.value })}>
          {cards.map((c) => <option key={c.id} value={c.id}>{c.who} — {c.title}</option>)}
        </select></div>
      <Field id="rv-d" label="تاریخ ابطال" type="date" value={f.revokedOn} on={(v) => setF({ ...f, revokedOn: v })} required />
      <Field id="rv-r" label="دلیل" value={f.reason} on={(v) => setF({ ...f, reason: v })} required />
      <div><button className="btn" type="submit">ابطال</button></div>
    </form>
  );
}

function Equipment({ s, data, post, reload, mayRecord }) {
  const live = s.equipment.filter((e) => e.state.code !== "dismantled");
  const removal = useRemove("hse-equipment", reload);
  return (
    <div className="card">
      <h2>داربست و جرثقیل</h2>
      <p className="muted sm">آخرین بازرسی تصمیم می‌گیرد: ردِ بعد از قبول، برچسب قرمز است. اعتبار = آخرین قبول + فاصلهٔ بازرسی پروژه. بازرس باید در همان روز کارت معتبر داشته باشد.</p>
      {s.equipment.length === 0 ? <p className="empty-note">داربست یا جرثقیلی ثبت نشده است.</p> : (
        <TableKit name="hse-eq" {...(mayRecord ? removal : {})}>
          <table className="dtable">
            <thead><tr><th>شماره</th><th>نوع</th><th>محدوده</th><th>وضعیت</th><th>آخرین بازرسی</th></tr></thead>
            <tbody>
              {s.equipment.map((e) => (
                <tr key={e.id} data-key={e.id}>
                  <td className="mono">{e.ref_no}</td>
                  <td className="sm">{e.kindTitle}{e.capacity_t ? <> · <bdi dir="ltr">{Number(e.capacity_t)} t</bdi></> : ""}</td>
                  <td className="sm">{e.area || "—"}</td>
                  <td><span className={`pill ${EQ[e.state.code]}`}><Dates text={e.state.text} /></span></td>
                  <td className="sm">{e.last ? <><bdi dir="ltr">{e.last.inspectedOn}</bdi>{` · ${e.last.result === "pass" ? "قبول" : "رد"} · ${e.last.inspector_name}${e.last.findings ? ` — ${e.last.findings}` : ""}`}</> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {mayRecord && <Fold title="ثبت داربست / جرثقیل"><EquipmentForm data={data} post={post} /></Fold>}
      {mayRecord && live.length > 0 && <Fold title="ثبت بازرسی"><InspectForm s={s} live={live} post={post} /></Fold>}
    </div>
  );
}

function EquipmentForm({ data, post }) {
  const blank = { equipmentKind: "scaffold", refNo: "", area: "", description: "", contractorId: "", capacityT: "" };
  const [f, setF] = useState(blank);
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "equipment", ...f })) setF(blank); }}>
      <div className="field"><label htmlFor="eq-k">نوع</label>
        <select id="eq-k" value={f.equipmentKind} onChange={(e) => setF({ ...f, equipmentKind: e.target.value })}>
          {Object.entries(data.safeWork.equipmentKinds).map(([k, t]) => <option key={k} value={k}>{t.title}</option>)}
        </select></div>
      <Field id="eq-no" label="شمارهٔ برچسب / ثبت" value={f.refNo} on={(v) => setF({ ...f, refNo: v })} required />
      <Field id="eq-a" label="محدوده" value={f.area} on={(v) => setF({ ...f, area: v })} />
      <Field id="eq-d" label="شرح" value={f.description} on={(v) => setF({ ...f, description: v })} />
      {f.equipmentKind === "crane" && <Field id="eq-cap" label="ظرفیت اسمی (تن)" type="number" value={f.capacityT} on={(v) => setF({ ...f, capacityT: v })} />}
      <div><button className="btn" type="submit">ثبت</button></div>
    </form>
  );
}

function InspectForm({ s, live, post }) {
  const blank = { equipmentId: live[0]?.id || "", inspectedOn: "", result: "pass", inspectorId: s.people[0]?.id || "", certRef: "", findings: "" };
  const [f, setF] = useState(blank);
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "equipment-inspect", ...f })) setF({ ...blank, equipmentId: f.equipmentId }); }}>
      <div className="field"><label htmlFor="in-e">داربست / جرثقیل</label>
        <select id="in-e" value={f.equipmentId} onChange={(e) => setF({ ...f, equipmentId: e.target.value })}>
          {live.map((e) => <option key={e.id} value={e.id}>{e.ref_no} — {e.kindTitle}</option>)}
        </select></div>
      <Field id="in-d" label="تاریخ بازرسی" type="date" value={f.inspectedOn} on={(v) => setF({ ...f, inspectedOn: v })} required />
      <div className="field"><label htmlFor="in-r">نتیجه</label>
        <select id="in-r" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}>
          <option value="pass">قبول — برچسب سبز</option><option value="fail">رد — برچسب قرمز</option>
        </select></div>
      <div className="field"><label htmlFor="in-i">بازرس</label>
        <select id="in-i" value={f.inspectorId} onChange={(e) => setF({ ...f, inspectorId: e.target.value })}>
          {s.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select></div>
      <Field id="in-c" label="شمارهٔ برچسب / گزارش" value={f.certRef} on={(v) => setF({ ...f, certRef: v })} />
      <Field id="in-f" label="ایرادها (برای رد لازم)" value={f.findings} on={(v) => setF({ ...f, findings: v })} />
      <div><button className="btn" type="submit">ثبت بازرسی</button></div>
    </form>
  );
}

function Jsas({ s, data, post, reload, mayRecord, mayIssue }) {
  return (
    <div className="card">
      <h2>JSA / TRA</h2>
      <p className="muted sm">ریسک = احتمال × شدت (۱ تا ۵). تأیید فقط وقتی هر گام اقدام کنترلی و ریسک باقیمانده دارد، کنترل ریسک را بالا نبرده و ریسک باقیمانده از حد پروژه بیشتر نیست. تهیه‌کننده تأیید نمی‌کند؛ تغییرِ JSA تأییدشده رویژن جدید است.</p>
      {s.jsas.length === 0 ? <p className="empty-note">JSA ثبت نشده است.</p> : s.jsas.map((j) => (
        <JsaCard key={j.id} j={j} post={post} reload={reload} mayRecord={mayRecord} mayIssue={mayIssue} />
      ))}
      {mayRecord && <Fold title="JSA جدید"><JsaForm data={data} post={post} /></Fold>}
    </div>
  );
}

function JsaCard({ j, post, reload, mayRecord, mayIssue }) {
  const [st, label] = JSA[j.status];
  const [rev, setRev] = useState("");
  const [editing, setEditing] = useState(null);
  const removal = useRemove("hse-jsa", reload);
  const draft = j.status === "draft";
  const locked = draft ? true : "گام JSA تأییدشده تغییر نمی‌کند؛ رویژن جدید بزنید";
  return (
    <div className="card" style={{ padding: 10, marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <b className="mono">{j.jsa_no} Rev {j.revision}</b><span>{j.title}</span><span className={`pill ${st}`}>{label}</span>
        <span className="muted sm">تهیه: {j.prepared_by_name || "?"}{j.approved_by_name && <> · تأیید: {j.approved_by_name} (<bdi dir="ltr">{String(j.approved_on).slice(0, 10)}</bdi>)</>}</span>
      </div>
      {j.steps.length > 0 && (
        <TableKit name={`jsa-${j.jsa_no}`} min={4}
                  onEdit={mayRecord ? (seq) => setEditing(j.steps.find((x) => String(x.seq) === seq)) : undefined} canEdit={() => locked}
                  onDelete={mayRecord ? (seq) => post({ kind: "jsa-step-remove", jsaId: j.id, seq }) : undefined} canDelete={() => locked}>
        <table className="dtable" style={{ marginTop: 6 }}>
          <thead><tr><th>#</th><th>گام</th><th>خطر</th><th>کنترل</th><th>ریسک اولیه</th><th>باقیمانده</th></tr></thead>
          <tbody>{j.steps.map((x) => (
            <tr key={x.seq} data-key={x.seq}><td className="mono">{x.seq}</td><td className="sm">{x.step}</td><td className="sm">{x.hazard}</td><td className="sm">{x.controls || "—"}</td>
              <td><Score l={x.likelihood} s={x.severity} r={x.initial} /></td>
              <td>{x.residual === null ? "—" : <Score l={x.residualLikelihood} s={x.residualSeverity} r={x.residual} />}</td></tr>
          ))}</tbody>
        </table>
        </TableKit>
      )}
      {j.status === "draft" && j.problems.length > 0 && <p className="muted sm">تا تأیید: {j.problems.join(" · ")}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        {mayIssue && j.status === "draft" && <button className="btn" onClick={() => post({ kind: "jsa-approve", jsaId: j.id })}>تأیید</button>}
        {mayRecord && draft && (
          <button className="btn ghost" onClick={async () => {
            const why = await removal.checkDelete(j.id).catch((e) => e.message);
            if (why !== true) { window.alert(why); return; }
            if (window.confirm(`پیش‌نویس ${j.jsa_no} Rev ${j.revision} با گام‌هایش حذف شود؟`)) await removal.onDelete(j.id).catch((e) => window.alert(e.message));
          }}>حذف پیش‌نویس</button>
        )}
        {mayRecord && j.status === "approved" && (
          <form style={{ display: "flex", gap: 6 }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "jsa-revise", jsaId: j.id, revision: rev })) setRev(""); }}>
            <input aria-label="رویژن جدید" placeholder="رویژن جدید" value={rev} onChange={(e) => setRev(e.target.value)} style={{ width: 110 }} />
            <button className="btn ghost" type="submit">رویژن جدید</button>
          </form>
        )}
      </div>
      {mayRecord && draft && <Fold title="افزودن گام"><StepForm j={j} post={post} /></Fold>}
      {mayRecord && draft && (
        <Fold title={`اصلاح گام ${editing?.seq || ""}`} button={false} open={!!editing} onClose={() => setEditing(null)}>
          {editing && <StepForm key={editing.seq} j={j} post={post} initial={editing} onDone={() => setEditing(null)} />}
        </Fold>
      )}
    </div>
  );
}

function StepForm({ j, post, initial = null, onDone }) {
  const next = (j.steps.at(-1)?.seq || 0) + 10;
  const blank = { seq: String(next), step: "", hazard: "", controls: "", likelihood: "", severity: "", residualLikelihood: "", residualSeverity: "" };
  const s0 = (v) => (v === null || v === undefined ? "" : String(v));
  const [f, setF] = useState(initial ? { seq: String(initial.seq), step: initial.step, hazard: initial.hazard, controls: s0(initial.controls),
    likelihood: s0(initial.likelihood), severity: s0(initial.severity), residualLikelihood: s0(initial.residualLikelihood), residualSeverity: s0(initial.residualSeverity) } : blank);
  const k = initial ? `e-${j.id}` : j.id;
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault();
      if (await post({ kind: "jsa-step", jsaId: j.id, ...f })) { if (initial) onDone?.(); else setF({ ...blank, seq: String(Number(f.seq) + 10) }); }
    }}>
      <Field id={`js-q-${k}`} label="ردیف" type="number" value={f.seq} on={(v) => setF({ ...f, seq: v })} required readOnly={!!initial} />
      <Field id={`js-s-${k}`} label="گام کار" value={f.step} on={(v) => setF({ ...f, step: v })} required />
      <Field id={`js-h-${k}`} label="خطر" value={f.hazard} on={(v) => setF({ ...f, hazard: v })} required />
      <Field id={`js-c-${k}`} label="اقدام کنترلی" value={f.controls} on={(v) => setF({ ...f, controls: v })} />
      <Field id={`js-l-${k}`} label="احتمال (۱–۵)" type="number" value={f.likelihood} on={(v) => setF({ ...f, likelihood: v })} required />
      <Field id={`js-v-${k}`} label="شدت (۱–۵)" type="number" value={f.severity} on={(v) => setF({ ...f, severity: v })} required />
      <Field id={`js-rl-${k}`} label="احتمال پس از کنترل" type="number" value={f.residualLikelihood} on={(v) => setF({ ...f, residualLikelihood: v })} />
      <Field id={`js-rv-${k}`} label="شدت پس از کنترل" type="number" value={f.residualSeverity} on={(v) => setF({ ...f, residualSeverity: v })} />
      <div><button className="btn" type="submit">{initial ? "ذخیرهٔ اصلاح" : "ذخیرهٔ گام"}</button></div>
    </form>
  );
}

function JsaForm({ data, post }) {
  const blank = { jsaNo: "", revision: "0", title: "", area: "", contractorId: "" };
  const [f, setF] = useState(blank);
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "jsa", ...f })) setF(blank); }}>
      <Field id="jn-no" label="شمارهٔ JSA" value={f.jsaNo} on={(v) => setF({ ...f, jsaNo: v })} required />
      <Field id="jn-rev" label="رویژن" value={f.revision} on={(v) => setF({ ...f, revision: v })} required />
      <Field id="jn-t" label="عنوان کار" value={f.title} on={(v) => setF({ ...f, title: v })} required />
      <Field id="jn-a" label="محدوده" value={f.area} on={(v) => setF({ ...f, area: v })} />
      <div className="field"><label htmlFor="jn-c">پیمانکار</label>
        <select id="jn-c" value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}>
          <option value="">—</option>
          {data.contractors.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
        </select></div>
      <div><button className="btn" type="submit">ثبت پیش‌نویس</button></div>
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
