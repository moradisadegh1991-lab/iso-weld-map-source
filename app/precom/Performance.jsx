"use client";
import { useState } from "react";
import { usePlatform } from "../../lib/client/platform.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";

/**
 * Performance test against the contract's guarantees
 * (lib/completions/performance.mjs): a test only once every subsystem in
 * its scope has an accepted RFSU; verdicts computed, never entered; a
 * signed test is fixed; a guarantee stands on its latest accepted test.
 */
const STATUS = { met: ["ok", "برآورده"], not_met: ["bad", "برآورده نشده"], untested: ["", "آزموده نشده"] };

export default function Performance({ data, post, may }) {
  const p = data.performance;
  const scopeText = (unitId) => {
    const sc = p.scopes[unitId || "plant"];
    return sc ? `${sc.rfsuAccepted}/${sc.subsystems} ساب‌سیستم با RFSU پذیرفته` : "—";
  };
  const unitName = (id) => (id ? p.units.find((u) => u.id === id)?.code || "?" : "کل کارخانه");
  return (
    <div className="card">
      <h2>آزمون عملکرد (Performance Test)</h2>
      <p className="muted sm">تضمین‌ها از قرارداد، با بند مرجع؛ رواداری‌ای که قرارداد نگفته اعمال نمی‌شود. آزمون فقط وقتی ثبت می‌شود که RFSU همهٔ ساب‌سیستم‌های محدوده‌اش پذیرفته شده باشد.
        حکم هر نتیجه محاسبه می‌شود؛ آزمونِ امضاشده ثابت است و آزمون مجدد، آزمون جدیدی است.</p>
      {p.guarantees.length === 0 ? <p className="empty-note">تضمینی تعریف نشده است.</p> : (
        <TableKit name="perf-g"><table className="dtable">
          <thead><tr><th>کد</th><th>پارامتر</th><th>محدوده</th><th>تضمین</th><th>حداقل مدت</th><th>بند قرارداد</th><th>وضعیت</th></tr></thead>
          <tbody>{p.guarantees.map((g) => {
            const st = p.status.find((x) => x.guaranteeId === g.id);
            const [tone, label] = STATUS[st.status];
            return (
              <tr key={g.id}>
                <td><bdi dir="ltr" className="mono">{g.code}</bdi></td>
                <td>{g.parameter}</td>
                <td className="sm">{g.unitCode ? `واحد ${g.unitCode}` : "کل کارخانه"}</td>
                <td className="sm">{p.directions[g.direction]} <bdi dir="ltr" className="mono">{g.guaranteedValue} {g.uom}</bdi></td>
                <td className="sm">{g.minDurationH ? `${g.minDurationH} ساعت` : <span className="muted">در قرارداد نیامده</span>}</td>
                <td className="sm">{g.basis}</td>
                <td><span className={`pill ${tone}`} title={st.reason || ""}>{label}{st.status !== "untested" && <> · <bdi dir="ltr">{st.measured}</bdi></>}</span>
                  {st.reason && <div className="muted sm">{st.reason}</div>}</td>
              </tr>
            );
          })}</tbody>
        </table></TableKit>
      )}
      {may.sign && <Fold title="تعریف / اصلاح تضمین"><GuaranteeForm p={p} post={post} /></Fold>}

      <h3 style={{ marginTop: 14 }}>آزمون‌ها</h3>
      {p.tests.length === 0 ? <p className="empty-note">آزمونی ثبت نشده است.</p> : p.tests.map((t) => (
        <TestCard key={t.id} t={t} p={p} post={post} may={may} unitName={unitName} />
      ))}
      {may.record && (
        <Fold title="ثبت آزمون">
          <TestForm p={p} post={post} scopeText={scopeText} />
        </Fold>
      )}
    </div>
  );
}

function TestCard({ t, p, post, may, unitName }) {
  const { user } = usePlatform();
  const inScope = p.guarantees.filter((g) => (g.unitId || null) === (t.unitId || null));
  const [f, setF] = useState({ guaranteeId: inScope[0]?.id || "", measured: "", method: "" });
  return (
    <div className="card" style={{ padding: 10, marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        <b><bdi dir="ltr" className="mono">{t.testNo}</bdi></b>
        <span className="sm">{unitName(t.unitId)}</span>
        <span className="muted sm">{fa(t.startedAt)} ← {fa(t.endedAt)} · {t.durationH} ساعت</span>
        {t.acceptedAt ? <span className="pill ok">پذیرفته — {t.acceptedByName || "?"}</span>
          : t.signedAt ? <span className="pill warn">امضا ({t.signedByName || "?"})، منتظر پذیرش</span>
          : <span className="pill">در حال ثبت</span>}
      </div>
      {t.results.length > 0 && (
        <table className="dtable" style={{ marginTop: 6 }}>
          <thead><tr><th>تضمین</th><th>اندازه‌گیری</th><th>روش</th><th>حکم</th></tr></thead>
          <tbody>{t.results.map((r) => (
            <tr key={r.guaranteeId}>
              <td><bdi dir="ltr" className="mono">{r.code}</bdi></td>
              <td><bdi dir="ltr" className="mono">{r.measured}</bdi></td>
              <td className="sm">{r.method || "—"}</td>
              <td>{r.verdict.ok ? <span className="pill ok">برآورده</span> : <span className="pill bad" title={r.verdict.reason}>برآورده نشده</span>}
                {r.verdict.reason && <div className="muted sm">{r.verdict.reason}</div>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "end" }}>
        {!t.signedAt && may.record && inScope.length > 0 && (
          <form style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }} onSubmit={async (e) => {
            e.preventDefault(); if (await post({ kind: "perf-result", testId: t.id, ...f })) setF({ ...f, measured: "", method: "" });
          }}>
            <div className="field"><label htmlFor={`pr-g-${t.id}`}>تضمین</label>
              <select id={`pr-g-${t.id}`} value={f.guaranteeId} onChange={(e) => setF({ ...f, guaranteeId: e.target.value })}>
                {inScope.map((g) => <option key={g.id} value={g.id}>{g.code} — {g.parameter} ({g.uom})</option>)}
              </select></div>
            <div className="field"><label htmlFor={`pr-m-${t.id}`}>مقدار اندازه‌گیری‌شده</label>
              <input id={`pr-m-${t.id}`} dir="ltr" type="number" step="any" value={f.measured} onChange={(e) => setF({ ...f, measured: e.target.value })} required /></div>
            <div className="field"><label htmlFor={`pr-x-${t.id}`}>روش / مرجع</label>
              <input id={`pr-x-${t.id}`} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} /></div>
            <button className="btn ghost" type="submit">ثبت نتیجه</button>
          </form>
        )}
        {!t.signedAt && may.sign && <button className="btn" onClick={() => post({ kind: "perf-sign", testId: t.id })}>امضای آزمون</button>}
        {t.signedAt && !t.acceptedAt && may.sign && t.signedBy !== user?.id && (
          <button className="btn" onClick={() => post({ kind: "perf-accept", testId: t.id })}>پذیرش (کارفرما)</button>)}
      </div>
    </div>
  );
}

function GuaranteeForm({ p, post }) {
  const blank = { code: "", parameter: "", unitId: "", uom: "", direction: "min", guaranteedValue: "", minDurationH: "", basis: "" };
  const [f, setF] = useState(blank);
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "guarantee", ...f })) setF(blank); }}>
      <Field id="gu-code" label="کد" value={f.code} on={(v) => setF({ ...f, code: v })} ltr required />
      <Field id="gu-par" label="پارامتر" value={f.parameter} on={(v) => setF({ ...f, parameter: v })} required />
      <div className="field"><label htmlFor="gu-unit">محدوده</label>
        <select id="gu-unit" value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}>
          <option value="">کل کارخانه</option>
          {p.units.map((u) => <option key={u.id} value={u.id}>واحد {u.code} — {u.name}</option>)}
        </select></div>
      <div className="field"><label htmlFor="gu-dir">جهت</label>
        <select id="gu-dir" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
          {Object.entries(p.directions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></div>
      <Field id="gu-val" label="مقدار تضمین‌شده" type="number" value={f.guaranteedValue} on={(v) => setF({ ...f, guaranteedValue: v })} ltr required />
      <Field id="gu-uom" label="واحد" value={f.uom} on={(v) => setF({ ...f, uom: v })} ltr required />
      <Field id="gu-dur" label="حداقل مدت آزمون (ساعت) — فقط اگر قرارداد گفته" type="number" value={f.minDurationH} on={(v) => setF({ ...f, minDurationH: v })} ltr />
      <Field id="gu-basis" label="بند قرارداد" value={f.basis} on={(v) => setF({ ...f, basis: v })} required />
      <div><button className="btn" type="submit">ذخیرهٔ تضمین</button></div>
    </form>
  );
}

function TestForm({ p, post, scopeText }) {
  const blank = { testNo: "", unitId: "", startedAt: "", endedAt: "", note: "" };
  const [f, setF] = useState(blank);
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault();
      if (await post({ kind: "perf-test", ...f, startedAt: new Date(f.startedAt).toISOString(), endedAt: new Date(f.endedAt).toISOString() })) setF(blank);
    }}>
      <Field id="pt-no2" label="شمارهٔ آزمون" value={f.testNo} on={(v) => setF({ ...f, testNo: v })} ltr required />
      <div className="field"><label htmlFor="pt-unit">محدوده</label>
        <select id="pt-unit" value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}>
          <option value="">کل کارخانه — {scopeText(null)}</option>
          {p.units.map((u) => <option key={u.id} value={u.id}>واحد {u.code} — {scopeText(u.id)}</option>)}
        </select></div>
      <Field id="pt-from2" label="شروع" type="datetime-local" value={f.startedAt} on={(v) => setF({ ...f, startedAt: v })} required />
      <Field id="pt-to2" label="پایان" type="datetime-local" value={f.endedAt} on={(v) => setF({ ...f, endedAt: v })} required />
      <Field id="pt-note" label="یادداشت" value={f.note} on={(v) => setF({ ...f, note: v })} />
      <div><button className="btn" type="submit">ثبت آزمون</button></div>
    </form>
  );
}

function Field({ id, label, value, on, type = "text", required, ltr }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} dir={ltr ? "ltr" : "auto"} type={type} step={type === "number" ? "any" : undefined} value={value} required={required}
        onChange={(e) => on(e.target.value)} />
    </div>
  );
}

const fa = (d) => (d ? new Date(d).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) : "—");
