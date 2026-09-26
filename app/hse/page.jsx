"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import SafeWork, { Dates } from "./SafeWork";

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
const STATE = {
  requested: ["warn", "درخواست"], active: ["ok", "فعال"], expired: ["bad", "منقضی — باز مانده"],
  lapsed: ["", "منقضی — صادر نشد"], closed: ["", "بسته"], cancelled: ["", "لغو"],
};
const OBS = { open: ["warn", "باز"], overdue: ["bad", "معوق"], closed: ["ok", "بسته"], no_due: ["", "بدون مهلت"] };
const CLS_TONE = { FAT: "bad", LWC: "bad", RWC: "warn", MTC: "warn", FAC: "", NM: "" };

export default function HsePage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/hse?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const mayRecord = can({ role }, ACTIONS.RECORD_HSE);
  const mayIssue = can({ role }, ACTIONS.ISSUE_PERMIT);
  const mayAdmin = can({ role }, ACTIONS.MANAGE_MEMBERS);

  async function post(body) {
    setMsg(null);
    try {
      const r = await call("/api/hse", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return r || true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
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
          {active} مجوز فعال{expired > 0 && ` · ${expired} مجوز منقضی و باز`}{simops > 0 && ` · ${simops} مجوز با تداخل SIMOPS`}
          {` · ${data.incidents.length} رویداد`}{overdue > 0 && ` · ${overdue} مشاهدهٔ معوق`}
        </span>
      </div>
      {msg && <p className="err">{msg}</p>}

      <div className="kpis">
        <Kpi v={fmt(s.hours)} l="نفرساعت ثبت‌شده" />
        <Kpi v={s.daysSinceLti ?? "—"} l="روز بدون LTI" b={s.lastLti ? `آخرین: ${fa(s.lastLti)}` : "LTI ثبت نشده"} />
        <Kpi v={s.lti} l="LTI (FAT + LWC)" tone={s.lti ? "bad" : "ok"} />
        <Kpi v={s.recordable} l="قابل ثبت (TRC)" tone={s.recordable ? "warn" : "ok"} />
        <Kpi v={rate(s.ltif.iogp)} l="LTIF" b="در هر ۱٬۰۰۰٬۰۰۰ نفرساعت (IOGP)" />
        <Kpi v={rate(s.ltif.osha)} l="LTIR" b="در هر ۲۰۰٬۰۰۰ نفرساعت (OSHA)" />
        <Kpi v={rate(s.trir.iogp)} l="TRIR" b="در هر ۱٬۰۰۰٬۰۰۰ نفرساعت (IOGP)" />
        <Kpi v={rate(s.trir.osha)} l="TRIR" b="در هر ۲۰۰٬۰۰۰ نفرساعت (OSHA)" />
      </div>
      {(s.unclassified > 0 || s.incidentsWithoutHours.length > 0) && (
        <p className="err">
          {s.unclassified > 0 && `${s.unclassified} رویداد بدون طبقه — واقعیت‌هایش کامل ثبت نشده و در نرخ‌ها نیامده. `}
          {s.incidentsWithoutHours.length > 0 && `نفرساعت پیمانکارِ ${s.incidentsWithoutHours.join("، ")} ثبت نشده؛ این رویدادها در نرخ پروژه هست ولی نرخ پیمانکار ندارد.`}
        </p>
      )}

      <div className="card">
        <h2>به تفکیک پیمانکار</h2>
        <TableKit name="hse">
          <table className="dtable">
            <thead><tr><th>پیمانکار</th><th>نفرساعت</th><th>LTI</th><th>TRC</th><th>LTIF (IOGP)</th><th>TRIR (IOGP)</th><th>TRIR (OSHA)</th></tr></thead>
            <tbody>
              {s.byContractor.map((c) => (
                <tr key={c.code}><td className="mono">{c.code}</td><td className="mono">{fmt(c.hours)}</td><td>{c.lti}</td><td>{c.recordable}</td>
                  <td className="mono">{rate(c.ltif.iogp)}</td><td className="mono">{rate(c.trir.iogp)}</td><td className="mono">{rate(c.trir.osha)}</td></tr>
              ))}
            </tbody>
          </table>
        </TableKit>
        {mayRecord && <Manhours contractors={data.contractors} post={post} />}
      </div>

      <div className="card">
        <h2>مجوز کار (PTW)</h2>
        {unset.length > 0 && (
          <p className="err">
            تعیین‌نشده در <a href="/project">مشخصات پروژه</a>: {unset.map((k) => data.limitTitles[k]).join("، ")} —
            مجوز کار گرم و فضای بسته تا تعیین این‌ها صادر نمی‌شود (پیش‌فرضی در کار نیست).
          </p>
        )}
        {data.permits.length === 0 ? <p className="empty-note">مجوزی ثبت نشده است.</p> : (
          <TableKit name="hse">
            <table className="dtable">
              <thead><tr><th>شماره</th><th>نوع</th><th>محدوده</th><th>اعتبار</th><th>وضعیت</th><th>تست گاز</th><th>آمادگی / SIMOPS</th><th /></tr></thead>
              <tbody>
                {data.permits.map((p) => <PermitRow key={p.id} p={p} post={post} mayRecord={mayRecord} mayIssue={mayIssue} />)}
              </tbody>
            </table>
          </TableKit>
        )}
        {mayRecord && <Fold title="درخواست مجوز کار"><PermitForm data={data} post={post} /></Fold>}
      </div>

      <SafeWork data={data} post={post} mayRecord={mayRecord} mayIssue={mayIssue} mayAdmin={mayAdmin} />

      <div className="card">
        <h2>رویدادها</h2>
        <p className="muted sm">طبقه انتخاب نمی‌شود؛ از واقعیت‌ها (فوت، روز غیبت، روز کار محدود، نوع درمان) طبق IOGP به دست می‌آید. هر تغییر واقعیت با دلیلش ثبت می‌شود.</p>
        {data.incidents.length === 0 ? <p className="empty-note">رویدادی ثبت نشده است.</p> : (
          <TableKit name="hse">
            <table className="dtable">
              <thead><tr><th>شماره</th><th>زمان</th><th>پیمانکار</th><th>محدوده</th><th>شرح</th><th>طبقه</th><th /></tr></thead>
              <tbody>
                {data.incidents.map((i) => <IncidentRow key={i.id} i={i} data={data} post={post} mayRecord={mayRecord} call={call} projectId={projectId} />)}
              </tbody>
            </table>
          </TableKit>
        )}
        {mayRecord && <Fold title="گزارش رویداد"><IncidentForm data={data} post={post} /></Fold>}
      </div>

      <div className="card">
        <h2>مشاهدات ایمنی</h2>
        {data.observations.length === 0 ? <p className="empty-note">مشاهده‌ای ثبت نشده است.</p> : (
          <TableKit name="hse">
            <table className="dtable">
              <thead><tr><th>تاریخ</th><th>نوع</th><th>شدت</th><th>محدوده</th><th>شرح</th><th>اقدام</th><th>مهلت</th><th>وضعیت</th><th /></tr></thead>
              <tbody>
                {data.observations.map((o) => <ObservationRow key={o.id} o={o} data={data} post={post} mayRecord={mayRecord} />)}
              </tbody>
            </table>
          </TableKit>
        )}
        {mayRecord && <Fold title="ثبت مشاهدهٔ ایمنی"><ObservationForm data={data} post={post} /></Fold>}
      </div>
    </div>
  );
}

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}

function Manhours({ contractors, post }) {
  const [f, setF] = useState({ contractorId: "", workDate: today(), hours: "", headcount: "" });
  return (
    <form className="grid2" style={{ alignItems: "end", marginTop: 10 }} onSubmit={async (e) => {
      e.preventDefault(); if (await post({ kind: "manhours", ...f })) setF({ ...f, hours: "", headcount: "" });
    }}>
      <div className="field"><label htmlFor="mh-c">پیمانکار</label>
        <select id="mh-c" value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}>
          <option value="">کارکنان EPC</option>
          {contractors.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
        </select></div>
      <Field id="mh-d" label="تاریخ" type="date" value={f.workDate} on={(v) => setF({ ...f, workDate: v })} required />
      <Field id="mh-h" label="نفرساعت" type="number" value={f.hours} on={(v) => setF({ ...f, hours: v })} required />
      <Field id="mh-n" label="تعداد نفرات" type="number" value={f.headcount} on={(v) => setF({ ...f, headcount: v })} />
      <div><button className="btn" type="submit">ثبت نفرساعت روز</button></div>
    </form>
  );
}

function PermitRow({ p, post, mayRecord, mayIssue }) {
  const [gas, setGas] = useState(false);
  const [st, label] = STATE[p.state];
  const g = p.gasVerdict;
  const open = ["requested", "active"].includes(p.state);
  return (
    <>
      <tr>
        <td className="mono">{p.permit_no}</td>
        <td>{p.typeTitle}</td>
        <td className="mono">{p.area}
          {(p.equipment || p.jsa || p.crew.length > 0) && (
            <div className="muted sm" style={{ fontFamily: "inherit" }}>
              {p.equipment && <div>{p.equipment.kind === "scaffold" ? "داربست" : "جرثقیل"}: <bdi dir="ltr" style={{ whiteSpace: "nowrap" }}>{p.equipment.refNo}</bdi></div>}
              {p.jsa && <div>JSA: <bdi dir="ltr" style={{ whiteSpace: "nowrap" }}>{p.jsa.jsaNo} Rev {p.jsa.revision}</bdi></div>}
              {p.crew.length > 0 && <div>خدمه: {p.crew.map((c) => c.name).join("، ")}</div>}
            </div>
          )}</td>
        <td className="mono sm">{dt(p.valid_from)} ← {dt(p.valid_to)}</td>
        <td><span className={`pill ${st}`}>{label}</span>{p.issued_by_name && <div className="muted sm">صادرکننده: {p.issued_by_name}</div>}</td>
        <td>{!p.needsGas ? <span className="muted sm">لازم نیست</span>
          : !p.last_gas ? <span className="pill warn">ثبت نشده</span>
          : g.ok === null ? <span className="pill warn" title={g.reason}>بدون حکم</span>
          : g.ok ? <span className="pill ok">قبول · {dt(p.last_gas.tested_at)}</span>
          : <span className="pill bad" title={g.failures.join(" · ")}>رد: {g.failures.join(" · ")}</span>}</td>
        <td className="sm">
          {p.readiness && !p.readiness.ok && <div className="muted"><Dates text={p.readiness.reasons.join(" · ")} /></div>}
          {p.readiness?.ok && <span className="pill ok">آمادهٔ صدور</span>}
          {p.readiness?.notes?.length > 0 && <div className="muted" style={{ opacity: 0.8 }}>سنجیده نشد: {p.readiness.notes.join(" · ")}</div>}
          {p.simopsWith.length > 0 && open && <div><span className="pill bad">SIMOPS با {p.simopsWith.join("، ")}</span></div>}
        </td>
        <td style={{ whiteSpace: "nowrap" }}>
          {mayRecord && p.needsGas && open && <button className="btn ghost" onClick={() => setGas(!gas)}>تست گاز</button>}
          {mayIssue && p.state === "requested" && <button className="btn" onClick={() => post({ kind: "activate", permitId: p.id })}>صدور</button>}
          {mayRecord && ["active", "expired"].includes(p.state) && <button className="btn ghost" onClick={() => post({ kind: "close", permitId: p.id })}>بستن</button>}
          {mayRecord && ["requested", "lapsed"].includes(p.state) && <button className="btn ghost" onClick={() => post({ kind: "cancel", permitId: p.id })}>لغو</button>}
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
  return (
    <form className="card grid2" style={{ padding: 10, alignItems: "end" }} onSubmit={(e) => {
      e.preventDefault(); onSubmit({ ...f, testedAt: new Date(f.testedAt).toISOString() });
    }}>
      <Field id={`g-t-${id}`} label="زمان تست" type="datetime-local" value={f.testedAt} on={(v) => setF({ ...f, testedAt: v })} required />
      <Field id={`g-o-${id}`} label="O2 (%)" type="number" value={f.o2Pct} on={(v) => setF({ ...f, o2Pct: v })} />
      <Field id={`g-l-${id}`} label="LEL (%)" type="number" value={f.lelPct} on={(v) => setF({ ...f, lelPct: v })} />
      <Field id={`g-h-${id}`} label="H2S (ppm)" type="number" value={f.h2sPpm} on={(v) => setF({ ...f, h2sPpm: v })} />
      <Field id={`g-c-${id}`} label="CO (ppm)" type="number" value={f.coPpm} on={(v) => setF({ ...f, coPpm: v })} />
      <Field id={`g-n-${id}`} label="تست‌کننده" value={f.testerName} on={(v) => setF({ ...f, testerName: v })} />
      <Field id={`g-i-${id}`} label="دستگاه (شماره و تاریخ Bump test)" value={f.instrument} on={(v) => setF({ ...f, instrument: v })} />
      <div><button className="btn" type="submit">ثبت تست گاز</button></div>
    </form>
  );
}

function PermitForm({ data, post }) {
  const blank = { permitNo: "", type: "hot", area: "", description: "", contractorId: "", requesterName: "",
    validFrom: nowLocal(), validTo: nowLocal(8), attendant: "", isolationRef: "", equipmentId: "", jsaId: "", crew: [] };
  const sw = data.safeWork;
  const eqKind = { work_at_height: "scaffold", lifting: "crane" };
  const [f, setF] = useState(blank);
  return (
    <form style={{ marginTop: 10 }} onSubmit={async (e) => {
      e.preventDefault();
      if (await post({ kind: "permit", ...f, validFrom: new Date(f.validFrom).toISOString(), validTo: new Date(f.validTo).toISOString() }))
        setF(blank);
    }}>
      <h2>درخواست مجوز</h2>
      <div className="grid2">
        <Field id="pt-no" label="شمارهٔ مجوز" value={f.permitNo} on={(v) => setF({ ...f, permitNo: v })} required />
        <div className="field"><label htmlFor="pt-type">نوع</label>
          <select id="pt-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, equipmentId: "" })}>
            {Object.entries(data.permitTypes).map(([k, t]) => <option key={k} value={k}>{t.title}{t.gas ? " — تست گاز" : ""}</option>)}
          </select></div>
        <Field id="pt-area" label="محدوده (واحد / تجهیز)" value={f.area} on={(v) => setF({ ...f, area: v })} required />
        <Field id="pt-desc" label="شرح کار" value={f.description} on={(v) => setF({ ...f, description: v })} required />
        <div className="field"><label htmlFor="pt-c">پیمانکار</label>
          <select id="pt-c" value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}>
            <option value="">—</option>
            {data.contractors.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select></div>
        <Field id="pt-req" label="مسئول اجرا (Performing Authority)" value={f.requesterName} on={(v) => setF({ ...f, requesterName: v })} />
        <Field id="pt-from" label="از" type="datetime-local" value={f.validFrom} on={(v) => setF({ ...f, validFrom: v })} required />
        <Field id="pt-to" label="تا" type="datetime-local" value={f.validTo} on={(v) => setF({ ...f, validTo: v })} required />
        {f.type === "confined_space" && <Field id="pt-att" label="نگهبان فضای بسته" value={f.attendant} on={(v) => setF({ ...f, attendant: v })} />}
        {f.type === "electrical_isolation" && <Field id="pt-iso" label="شمارهٔ گواهی ایزولاسیون (LOTO)" value={f.isolationRef} on={(v) => setF({ ...f, isolationRef: v })} />}
        {eqKind[f.type] && (
          <div className="field"><label htmlFor="pt-eq">{eqKind[f.type] === "scaffold" ? "داربست" : "جرثقیل / بالابر"}</label>
            <select id="pt-eq" value={f.equipmentId} onChange={(e) => setF({ ...f, equipmentId: e.target.value })}>
              <option value="">—</option>
              {sw.equipment.filter((e) => e.kind === eqKind[f.type] && e.state.code !== "dismantled").map((e) => (
                <option key={e.id} value={e.id}>{e.ref_no} — {e.state.text}</option>))}
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
          <legend className="sm">خدمه (صلاحیت هر نفر طبق قواعد پروژه سنجیده می‌شود)</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {sw.people.map((p) => (
              <label key={p.id} className="sm"><input type="checkbox" checked={f.crew.includes(p.id)}
                onChange={() => setF({ ...f, crew: f.crew.includes(p.id) ? f.crew.filter((x) => x !== p.id) : [...f.crew, p.id] })} /> {p.full_name}</label>
            ))}
          </div>
        </fieldset>
      )}
      <p className="muted sm">صدور با امضای شخص دیگری غیر از درخواست‌کننده انجام می‌شود.</p>
      <div><button className="btn" type="submit">ثبت درخواست</button></div>
    </form>
  );
}

function IncidentRow({ i, data, post, mayRecord, call, projectId }) {
  const [open, setOpen] = useState(false);
  const [hist, setHist] = useState(null);
  async function toggle() {
    const next = !open; setOpen(next);
    if (next) { try { setHist((await call(`/api/hse?projectId=${projectId}&incidentId=${i.id}`)).history); } catch { setHist([]); } }
  }
  return (
    <>
      <tr>
        <td className="mono">{i.ref_no}</td>
        <td className="mono sm">{dt(i.occurred_at)}</td>
        <td className="mono">{i.contractor_code || "EPC"}</td>
        <td className="mono">{i.area || "—"}</td>
        <td>{i.description}</td>
        <td>{i.cls ? <span className={`pill ${CLS_TONE[i.cls]}`}>{i.cls} · {i.clsTitle}</span>
          : <span className="pill warn" title={i.clsReason}>بدون طبقه</span>}
          {!i.cls && <div className="muted sm">{i.clsReason}</div>}</td>
        <td><button className="btn ghost" onClick={toggle}>{open ? "بستن" : "جزئیات"}</button></td>
      </tr>
      {open && (
        <tr><td colSpan={7}>
          <p className="sm">
            آسیب: {yn(i.injured)} · فوت: {yn(i.fatal)} · روز غیبت: {i.days_away ?? "—"} · روز کار محدود: {i.restricted_days ?? "—"} ·
            درمان: {i.treatment ? data.treatments[i.treatment] : "—"}
          </p>
          {hist?.length > 0 && (
            <ul className="sm">
              {hist.map((h) => (
                <li key={h.id}>{dt(h.created_at)} — {h.changed_by_name || "?"}: {Object.keys(h.after).map((k) =>
                  `${k}: ${h.before[k] ?? "—"} ← ${h.after[k] ?? "—"}`).join("، ")} — «{h.reason}»</li>
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
  return (
    <form className="card grid2" style={{ padding: 10, alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault();
      const patch = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== init[k]));
      if (await post({ kind: "incident-update", incidentId: i.id, patch, reason })) setReason("");
    }}>
      <Facts f={f} setF={setF} data={data} id={i.id} />
      <Field id={`rs-${i.id}`} label="دلیل تغییر" value={reason} on={setReason} required />
      <div><button className="btn" type="submit">ثبت تغییر واقعیت‌ها</button></div>
    </form>
  );
}

function Facts({ f, setF, data, id }) {
  const tri3 = (k, label) => (
    <div className="field"><label htmlFor={`${k}-${id}`}>{label}</label>
      <select id={`${k}-${id}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
        <option value="">نامعلوم</option><option value="true">بله</option><option value="false">خیر</option>
      </select></div>
  );
  return (
    <>
      {tri3("injured", "کسی آسیب دید؟")}
      {tri3("fatal", "فوت؟")}
      <Field id={`da-${id}`} label="روز غیبت از کار" type="number" value={f.daysAway} on={(v) => setF({ ...f, daysAway: v })} />
      <Field id={`rd-${id}`} label="روز کار محدود" type="number" value={f.restrictedDays} on={(v) => setF({ ...f, restrictedDays: v })} />
      <div className="field"><label htmlFor={`tr-${id}`}>درمان</label>
        <select id={`tr-${id}`} value={f.treatment} onChange={(e) => setF({ ...f, treatment: e.target.value })}>
          <option value="">نامعلوم</option>
          {Object.entries(data.treatments).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select></div>
    </>
  );
}

function IncidentForm({ data, post }) {
  const blank = { refNo: "", occurredAt: nowLocal(), area: "", contractorId: "", description: "",
    injured: "", fatal: "", daysAway: "", restrictedDays: "", treatment: "" };
  const [f, setF] = useState(blank);
  return (
    <form style={{ marginTop: 10 }} onSubmit={async (e) => {
      e.preventDefault();
      if (await post({ kind: "incident", ...f, occurredAt: new Date(f.occurredAt).toISOString() })) setF(blank);
    }}>
      <h2>گزارش رویداد</h2>
      <div className="grid2">
        <Field id="in-ref" label="شماره" value={f.refNo} on={(v) => setF({ ...f, refNo: v })} required />
        <Field id="in-at" label="زمان" type="datetime-local" value={f.occurredAt} on={(v) => setF({ ...f, occurredAt: v })} required />
        <Field id="in-area" label="محدوده" value={f.area} on={(v) => setF({ ...f, area: v })} />
        <div className="field"><label htmlFor="in-c">پیمانکار</label>
          <select id="in-c" value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}>
            <option value="">کارکنان EPC</option>
            {data.contractors.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select></div>
        <Field id="in-desc" label="شرح" value={f.description} on={(v) => setF({ ...f, description: v })} required />
        <Facts f={f} setF={setF} data={data} id="new" />
      </div>
      <p className="muted sm">آنچه هنوز معلوم نیست «نامعلوم» بماند؛ رویداد تا کامل‌شدن واقعیت‌ها بدون طبقه نشان داده می‌شود.</p>
      <div><button className="btn" type="submit">ثبت رویداد</button></div>
    </form>
  );
}

function ObservationRow({ o, data, post, mayRecord }) {
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const [st, label] = OBS[o.state];
  return (
    <>
      <tr>
        <td className="mono sm">{fa(o.observed_on)}</td>
        <td>{data.observationKinds[o.kind]}</td>
        <td>{o.severity ? data.severities[o.severity] : "—"}</td>
        <td className="mono">{o.area || "—"}{o.contractor_code && <div className="muted sm">{o.contractor_code}</div>}</td>
        <td>{o.description}</td>
        <td>{o.action || "—"}{o.closed_note && <div className="muted sm">انجام شد: {o.closed_note}</div>}</td>
        <td className="mono sm">{o.due_on ? fa(o.due_on) : "—"}</td>
        <td><span className={`pill ${st}`}>{label}</span></td>
        <td>{mayRecord && !o.closed_on && o.kind !== "good_practice" && <button className="btn ghost" onClick={() => setClosing(!closing)}>بستن</button>}</td>
      </tr>
      {closing && (
        <tr><td colSpan={9}>
          <form style={{ display: "flex", gap: 8 }} onSubmit={async (e) => {
            e.preventDefault(); if (await post({ kind: "observation-close", observationId: o.id, closedOn: today(), note })) setClosing(false);
          }}>
            <input className="search" aria-label="اقدام انجام‌شده" placeholder="اقدام انجام‌شده" value={note} onChange={(e) => setNote(e.target.value)} required />
            <button className="btn" type="submit">ثبت بستن</button>
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
  return (
    <form style={{ marginTop: 10 }} onSubmit={async (e) => {
      // `kind` is the request's; the observation's own kind travels as obsKind.
      e.preventDefault(); const { kind: obsKind, ...rest } = f;
      if (await post({ ...rest, obsKind, kind: "observation" })) setF(blank);
    }}>
      <h2>ثبت مشاهده</h2>
      <div className="grid2">
        <Field id="ob-d" label="تاریخ" type="date" value={f.observedOn} on={(v) => setF({ ...f, observedOn: v })} required />
        <div className="field"><label htmlFor="ob-k">نوع</label>
          <select id="ob-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {Object.entries(data.observationKinds).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select></div>
        {!good && <div className="field"><label htmlFor="ob-s">شدت</label>
          <select id="ob-s" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>
            {Object.entries(data.severities).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select></div>}
        <Field id="ob-a" label="محدوده" value={f.area} on={(v) => setF({ ...f, area: v })} />
        <div className="field"><label htmlFor="ob-c">پیمانکار</label>
          <select id="ob-c" value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}>
            <option value="">—</option>
            {data.contractors.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select></div>
        <Field id="ob-desc" label="شرح" value={f.description} on={(v) => setF({ ...f, description: v })} required />
        {!good && <Field id="ob-act" label="اقدام اصلاحی" value={f.action} on={(v) => setF({ ...f, action: v })} required />}
        {!good && <Field id="ob-due" label="مهلت" type="date" value={f.dueOn} on={(v) => setF({ ...f, dueOn: v })} required />}
      </div>
      <div><button className="btn" type="submit">ثبت مشاهده</button></div>
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
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
const dt = (d) => (d ? new Date(d).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) : "—");
const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const rate = (r) => (r === null || r === undefined ? "—" : r.toFixed(2));
const yn = (v) => (v === true ? "بله" : v === false ? "خیر" : "نامعلوم");
const tri = (v) => (v === true ? "true" : v === false ? "false" : "");
