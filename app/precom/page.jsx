"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import Performance from "./Performance";

/**
 * Pre-commissioning → RFC → commissioning → RFSU, per subsystem, after MC;
 * then the performance test against the contract's guarantees.
 *
 * What is owed is the project's checklists × the items each applies to —
 * declared, never guessed. A pass counts once someone else accepts it; a
 * certificate is offered only when the engine (lib/completions/precom.mjs)
 * finds nothing open, and the server checks again.
 */
const STATE = { accepted: ["ok", "پذیرفته"], passed: ["warn", "قبول — منتظر پذیرش"], failed: ["bad", "رد"], open: ["", "انجام نشده"] };

export default function PrecomPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/precom?projectId=${id}`, []);
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState(null);
  const [n, setN] = useState(0);
  const may = { sign: can({ role }, ACTIONS.SIGN_MC), record: can({ role }, ACTIONS.RECORD_COMPLETIONS) };

  async function post(body) {
    setMsg(null);
    try {
      await call("/api/precom", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload(); setN((x) => x + 1);
      return true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const b = data.board;
  const mcOk = b.filter((s) => s.mc_accepted_at).length;
  const rfc = b.filter((s) => s.rfc_accepted_at).length;
  const rfsu = b.filter((s) => s.rfsu_accepted_at).length;
  const readyNow = b.filter((s) => (s.rfc.ready && !s.rfc_signed_at) || (s.rfsu.ready && !s.rfsu_signed_at)).length;
  const owed = b.reduce((t, s) => t + (s.mc_accepted_at && !s.rfc_signed_at ? s.counts.precom.total - s.counts.precom.accepted : 0)
    + (s.rfc_accepted_at && !s.rfsu_signed_at ? s.counts.commissioning.total - s.counts.commissioning.accepted : 0), 0);
  const blocked = (r) => (r.ready ? <span className="ok">هیچ</span> : r.blockers.map((x) => `${data.blockerNames[x.kind]}${x.count ? ` (${x.count})` : ""}`).join("، "));

  return (
    <div className="page">
      <div className="pagehead">
        <h1>پیش‌راه‌اندازی، RFC، راه‌اندازی و RFSU</h1>
        <span className="sub">{data.templates.filter((t) => t.active && t.phase === "precom").length} چک‌لیست پیش‌راه‌اندازی · {data.templates.filter((t) => t.active && t.phase === "commissioning").length} روال راه‌اندازی · {mcOk} ساب‌سیستم با MC پذیرفته</span>
      </div>
      {msg && <p className="err" role="alert">{msg}</p>}
      <div className="kpis">
        <Kpi v={mcOk} l="MC پذیرفته" b={`از ${b.length} ساب‌سیستم`} />
        <Kpi v={owed} l="چک‌لیست / روال باز" b="در مرحلهٔ جاری هر ساب‌سیستم" tone={owed ? "warn" : ""} />
        <Kpi v={readyNow} l="آمادهٔ امضای RFC یا RFSU" tone={readyNow ? "ok" : ""} />
        <Kpi v={rfc} l="RFC پذیرفته" tone={rfc ? "ok" : ""} />
        <Kpi v={rfsu} l="RFSU پذیرفته" tone={rfsu ? "ok" : ""} />
      </div>

      <div className="card">
        <h2>ساب‌سیستم‌ها</h2>
        <TableKit name="precom"><table className="dtable">
          <thead><tr><th>ساب‌سیستم</th><th>MC</th><th>پیش‌راه‌اندازی</th><th>RFC</th><th>راه‌اندازی</th><th>RFSU</th><th /></tr></thead>
          <tbody>{b.map((s) => [
            <tr key={s.id}>
              <td><bdi dir="ltr" className="mono">{s.code}</bdi>{s.name && <span className="muted sm"> {s.name}</span>}</td>
              <td>{s.mc_accepted_at ? <span className="pill ok">پذیرفته</span> : s.mc_signed_at ? <span className="pill warn">امضا، منتظر پذیرش</span> : <span className="muted sm">—</span>}</td>
              <td className="mono"><Count c={s.counts.precom} /></td>
              <td className="sm"><Cert signed={s.rfc_signed_at} accepted={s.rfc_accepted_at} />
                {s.rfc_carried && <div className="muted">از RFSU پیشین منتقل شد</div>}
                {!s.rfc_signed_at && <div className="muted">باز: {blocked(s.rfc)}</div>}
                {s.rfcReopened && <div className="bad">پس از امضا چیزی باز شده</div>}</td>
              <td className="mono"><Count c={s.counts.commissioning} /></td>
              <td className="sm"><Cert signed={s.rfsu_signed_at} accepted={s.rfsu_accepted_at} />
                {s.legacyRfsu && <div className="muted">پیش از جداشدن RFC امضا شده</div>}
                {!s.rfsu_signed_at && s.rfc_accepted_at && <div className="muted">باز: {blocked(s.rfsu)}</div>}
                {s.reopened && <div className="bad">پس از امضا چیزی باز شده</div>}</td>
              <td><button className="btn ghost" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? "بستن" : "جزئیات"}</button></td>
            </tr>,
            open === s.id && <tr key={s.id + "-x"}><td colSpan={7}><SubsystemPanel id={s.id} row={s} data={data} post={post} may={may} stamp={n} /></td></tr>,
          ])}</tbody>
        </table></TableKit>
      </div>

      <Templates data={data} post={post} may={may} />
      <Performance data={data} post={post} may={may} />
    </div>
  );
}

function SubsystemPanel({ id, row, data, post, may, stamp }) {
  const { projectId, call, user } = usePlatform();
  const [s, setS] = useState(null);
  useEffect(() => {
    let live = true;
    call(`/api/precom?projectId=${projectId}&subsystemId=${id}`).then((r) => live && setS(r)).catch(() => live && setS(null));
    return () => { live = false; };
  }, [id, projectId, call, stamp]);
  if (!s) return <p className="muted sm">…</p>;
  const sub = s.subsystem;
  const open = { precom: may.record && !!sub.mc_accepted_at && !sub.rfc_signed_at,
    commissioning: may.record && !!sub.rfc_accepted_at && !sub.rfsu_signed_at };
  const note = { precom: !sub.mc_accepted_at ? "پس از پذیرش MC ثبت می‌شود." : sub.rfc_signed_at ? "RFC امضا شده؛ پیش‌راه‌اندازی بسته است." : null,
    commissioning: !sub.rfc_accepted_at ? "پس از پذیرش RFC ثبت می‌شود." : sub.rfsu_signed_at ? "RFSU امضا شده؛ راه‌اندازی بسته است." : null };
  const blocked = (r) => r.blockers.map((x) => `${data.blockerNames[x.kind]}${x.count ? ` (${x.count})` : ""}`).join("، ");
  const phaseView = (phase, title) => {
    const list = s.checks.filter((c) => c.phase === phase);
    return (
      <div>
        <h3 className="sm" style={{ margin: "6px 0" }}>{title}{note[phase] && <span className="muted"> — {note[phase]}</span>}</h3>
        {list.length === 0 ? <p className="empty-note">چیزی از این مرحله به آیتم‌های این ساب‌سیستم اعمال نمی‌شود.</p> : (
          <TableKit name="precom"><table className="dtable">
            <thead><tr><th>چک‌لیست</th><th>آیتم</th><th>وضعیت</th><th>آخرین رکورد</th><th /></tr></thead>
            <tbody>{list.map((c) => (
              <CheckRow key={`${c.templateId}:${c.itemRef}`} c={c} subsystemId={id} post={post} may={may} canRecord={open[phase]} me={user?.id} />
            ))}</tbody>
          </table></TableKit>
        )}
      </div>
    );
  };
  const signView = ({ kind, label, r, signedAt, acceptedAt, signedBy, acceptedBy, needs }) => (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {may.sign && !signedAt && needs && (
        <button className="btn" disabled={!r.ready} onClick={() => post({ kind: `${kind}-sign`, subsystemId: id })}>امضای {label}</button>
      )}
      {may.sign && signedAt && !acceptedAt && (
        <button className="btn" onClick={() => post({ kind: `${kind}-accept`, subsystemId: id })}>پذیرش {label} (کارفرما)</button>
      )}
      {!signedAt && needs && !r.ready && <span className="muted sm">{label} — باز: {blocked(r)}</span>}
      {signedAt && <span className="sm">{label} — امضا: {signedBy || "—"} · {fa(signedAt)}{acceptedAt && ` · پذیرش: ${acceptedBy || "—"} · ${fa(acceptedAt)}`}</span>}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {phaseView("precom", "چک‌لیست‌های پیش‌راه‌اندازی (قبل از RFC)")}
      {signView({ kind: "rfc", label: "RFC", r: s.rfc, signedAt: sub.rfc_signed_at, acceptedAt: sub.rfc_accepted_at,
        signedBy: sub.rfc_signed_by_name, acceptedBy: sub.rfc_accepted_by_name, needs: true })}
      {phaseView("commissioning", "روال‌های راه‌اندازی (بین RFC و RFSU)")}
      {signView({ kind: "rfsu", label: "RFSU", r: s.rfsu, signedAt: sub.rfsu_signed_at, acceptedAt: sub.rfsu_accepted_at,
        signedBy: sub.rfsu_signed_by_name, acceptedBy: sub.rfsu_accepted_by_name, needs: !!sub.rfc_accepted_at })}
    </div>
  );
}

function CheckRow({ c, subsystemId, post, may, canRecord, me }) {
  const [f, setF] = useState({ result: "pass", performedOn: today(), witnessedBy: "", note: "" });
  const [form, setForm] = useState(false);
  const [tone, label] = STATE[c.state];
  const l = c.latest;
  return <>
    <tr>
      <td><bdi dir="ltr" className="mono sm">{c.code}</bdi> {c.title}</td>
      <td><bdi dir="ltr" className="mono">{c.label}</bdi></td>
      <td><span className={`pill ${tone}`}>{label}</span>{c.attempts.length > 1 && <div className="muted sm">{c.attempts.length} بار</div>}</td>
      <td className="sm">{l ? <>{fa(l.performedOn)} — {l.performedByName || "—"}{l.witnessedBy && ` · شاهد: ${l.witnessedBy}`}{l.note && `: «${l.note}»`}
        {l.acceptedByName && <div className="muted">پذیرش: {l.acceptedByName}</div>}</> : "—"}</td>
      <td style={{ whiteSpace: "nowrap" }}>
        {canRecord && <button className="btn ghost" onClick={() => setForm(!form)}>{form ? "بستن" : "ثبت"}</button>}
        {may.record && c.state === "passed" && l && l.performedBy !== me && (
          <button className="btn ghost" onClick={() => post({ kind: "accept", attemptId: l.id })}>پذیرش</button>)}
      </td>
    </tr>
    {form && <tr><td colSpan={5}>
      <form style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }} onSubmit={async (e) => {
        e.preventDefault();
        if (await post({ kind: "attempt", subsystemId, templateId: c.templateId, itemRef: c.itemRef, ...f })) setForm(false);
      }}>
        <div className="field"><label htmlFor={`r-${c.templateId}-${c.itemRef}`}>نتیجه</label>
          <select id={`r-${c.templateId}-${c.itemRef}`} value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}>
            <option value="pass">قبول</option><option value="fail">رد</option></select></div>
        <div className="field"><label htmlFor={`d-${c.templateId}-${c.itemRef}`}>تاریخ</label>
          <input id={`d-${c.templateId}-${c.itemRef}`} type="date" dir="ltr" max={today()} value={f.performedOn} onChange={(e) => setF({ ...f, performedOn: e.target.value })} /></div>
        <div className="field"><label htmlFor={`w-${c.templateId}-${c.itemRef}`}>شاهد</label>
          <input id={`w-${c.templateId}-${c.itemRef}`} value={f.witnessedBy} onChange={(e) => setF({ ...f, witnessedBy: e.target.value })} /></div>
        <div className="field" style={{ flex: "1 1 220px" }}><label htmlFor={`n-${c.templateId}-${c.itemRef}`}>{f.result === "fail" ? "شرح رد (لازم)" : "یادداشت"}</label>
          <input id={`n-${c.templateId}-${c.itemRef}`} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        <button className="btn" type="submit">ثبت</button>
      </form>
    </td></tr>}
  </>;
}

function Templates({ data, post, may }) {
  const blank = { code: "", title: "", appliesTo: "subsystem", phase: "precom", criteria: "" };
  const [f, setF] = useState(blank);
  return (
    <div className="card">
      <h2>چک‌لیست‌ها و روال‌های راه‌اندازی پروژه</h2>
      <p className="muted sm">از رویهٔ راه‌اندازی پروژه: هر چک‌لیست به یک مرحله و یک نوع آیتم تعلق دارد و برای همهٔ آیتم‌های آن نوع در هر ساب‌سیستم لازم است.
        بدون چک‌لیست پیش‌راه‌اندازی RFC، و بدون روال راه‌اندازی RFSU امضا نمی‌شود — مرحلهٔ تعریف‌نشده «کامل» نیست.</p>
      {data.templates.length > 0 && <TableKit name="precom"><table className="dtable">
        <thead><tr><th>کد</th><th>عنوان</th><th>مرحله</th><th>اعمال به</th><th>معیار</th><th>فعال</th></tr></thead>
        <tbody>{data.templates.map((t) => (
          <tr key={t.id} onClick={() => may.sign && setF({ code: t.code, title: t.title, appliesTo: t.appliesTo, phase: t.phase, criteria: t.criteria || "", active: t.active })}
              style={{ cursor: may.sign ? "pointer" : undefined }}>
            <td><bdi dir="ltr" className="mono">{t.code}</bdi></td><td>{t.title}</td><td className="sm">{t.phaseTitle}</td><td>{t.appliesTitle}</td><td className="sm">{t.criteria || "—"}</td>
            <td>{t.active ? "✓" : <span className="muted">—</span>}</td>
          </tr>))}</tbody>
      </table></TableKit>}
      {may.sign && (
        <Fold title={f.code && data.templates.some((t) => t.code === f.code) ? `ویرایش چک‌لیست ${f.code}` : "چک‌لیست جدید"}
              key={f.code || "new"} defaultOpen={!!f.code}>
        <form style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }} onSubmit={async (e) => {
          e.preventDefault();
          if (await post({ kind: "template", ...f })) setF(blank);
        }}>
          <div className="field"><label htmlFor="t-code">کد</label><input id="t-code" dir="ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="field" style={{ flex: "1 1 200px" }}><label htmlFor="t-title">عنوان</label><input id="t-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="field"><label htmlFor="t-ph">مرحله</label>
            <select id="t-ph" value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value })}>
              {Object.entries(data.phases).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="field"><label htmlFor="t-app">اعمال به</label>
            <select id="t-app" value={f.appliesTo} onChange={(e) => setF({ ...f, appliesTo: e.target.value })}>
              {Object.entries(data.applies).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="field" style={{ flex: "1 1 200px" }}><label htmlFor="t-cr">معیار پذیرش</label><input id="t-cr" value={f.criteria} onChange={(e) => setF({ ...f, criteria: e.target.value })} /></div>
          {"active" in f && <label className="sm"><input type="checkbox" checked={f.active !== false} onChange={(e) => setF({ ...f, active: e.target.checked })} /> فعال</label>}
          <button className="btn ghost" type="submit">ذخیرهٔ چک‌لیست</button>
        </form>
        </Fold>
      )}
    </div>
  );
}

function Count({ c }) {
  if (!c.total) return <span className="muted">—</span>;
  return <>{c.accepted}/{c.total}{c.failed > 0 && <span className="bad"> · {c.failed} رد</span>}</>;
}

function Cert({ signed, accepted }) {
  return accepted ? <span className="pill ok">پذیرفته</span> : signed ? <span className="pill warn">امضا، منتظر پذیرش</span> : <span className="muted">—</span>;
}

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}
const today = () => new Date().toISOString().slice(0, 10);
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
