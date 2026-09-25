"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";

/**
 * Pre-commissioning and RFSU, per subsystem, after MC.
 *
 * What is owed is the project's checklists × the items each applies to —
 * declared, never guessed. A pass counts once someone else accepts it; RFSU
 * is offered only when the engine (lib/completions/precom.mjs) finds
 * nothing open, and the server checks again.
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
  const rfsu = b.filter((s) => s.rfsu_accepted_at).length;
  const readyNow = b.filter((s) => s.ready && !s.rfsu_signed_at).length;
  const owed = b.reduce((t, s) => t + (s.mc_accepted_at ? s.counts.total - s.counts.accepted : 0), 0);

  return (
    <div className="page">
      <div className="pagehead">
        <h1>پیش‌راه‌اندازی و RFSU</h1>
        <span className="sub">{data.templates.filter((t) => t.active).length} چک‌لیست تعریف‌شده · {mcOk} ساب‌سیستم با MC پذیرفته</span>
      </div>
      {msg && <p className="err" role="alert">{msg}</p>}
      <div className="kpis">
        <Kpi v={mcOk} l="MC پذیرفته" b={`از ${b.length} ساب‌سیستم`} />
        <Kpi v={owed} l="چک‌لیست باز" b="در ساب‌سیستم‌های پس از MC" tone={owed ? "warn" : ""} />
        <Kpi v={readyNow} l="آمادهٔ امضای RFSU" tone={readyNow ? "ok" : ""} />
        <Kpi v={rfsu} l="RFSU پذیرفته" tone={rfsu ? "ok" : ""} />
      </div>

      <div className="card">
        <h2>ساب‌سیستم‌ها</h2>
        <div className="wrap"><table className="dtable">
          <thead><tr><th>ساب‌سیستم</th><th>MC</th><th>چک‌لیست‌ها</th><th>آنچه RFSU را نگه داشته</th><th>RFSU</th><th /></tr></thead>
          <tbody>{b.map((s) => [
            <tr key={s.id}>
              <td><bdi dir="ltr" className="mono">{s.code}</bdi>{s.name && <span className="muted sm"> {s.name}</span>}</td>
              <td>{s.mc_accepted_at ? <span className="pill ok">پذیرفته</span> : s.mc_signed_at ? <span className="pill warn">امضا، منتظر پذیرش</span> : <span className="muted sm">—</span>}</td>
              <td className="mono">{s.counts.accepted}/{s.counts.total}{s.counts.failed > 0 && <span className="bad"> · {s.counts.failed} رد</span>}</td>
              <td className="sm">{s.ready ? <span className="ok">هیچ</span> : s.blockers.map((x) => `${data.blockerNames[x.kind]}${x.count ? ` (${x.count})` : ""}`).join("، ")}</td>
              <td>{s.rfsu_accepted_at ? <span className="pill ok">پذیرفته</span> : s.rfsu_signed_at ? <span className="pill warn">امضا، منتظر پذیرش</span> : <span className="muted sm">—</span>}
                {s.reopened && <div className="bad sm">پس از امضا چیزی باز شده</div>}</td>
              <td><button className="btn ghost" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? "بستن" : "جزئیات"}</button></td>
            </tr>,
            open === s.id && <tr key={s.id + "-x"}><td colSpan={6}><SubsystemPanel id={s.id} row={s} data={data} post={post} may={may} stamp={n} /></td></tr>,
          ])}</tbody>
        </table></div>
      </div>

      <Templates data={data} post={post} may={may} />
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
  const locked = !!s.subsystem.rfsu_signed_at;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!s.subsystem.mc_accepted_at && <p className="muted sm">پیش‌راه‌اندازی پس از پذیرش MC این ساب‌سیستم ثبت می‌شود.</p>}
      {s.checks.length === 0 ? <p className="empty-note">چک‌لیستی به آیتم‌های این ساب‌سیستم اعمال نمی‌شود.</p> : (
        <div className="wrap"><table className="dtable">
          <thead><tr><th>چک‌لیست</th><th>آیتم</th><th>وضعیت</th><th>آخرین رکورد</th><th /></tr></thead>
          <tbody>{s.checks.map((c) => (
            <CheckRow key={`${c.templateId}:${c.itemRef}`} c={c} subsystemId={id} post={post} may={may}
              canRecord={may.record && !!s.subsystem.mc_accepted_at && !locked} me={user?.id} />
          ))}</tbody>
        </table></div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {may.sign && !row.rfsu_signed_at && (
          <button className="btn" disabled={!s.ready} onClick={() => post({ kind: "rfsu-sign", subsystemId: id })}>امضای RFSU</button>
        )}
        {may.sign && row.rfsu_signed_at && !row.rfsu_accepted_at && (
          <button className="btn" onClick={() => post({ kind: "rfsu-accept", subsystemId: id })}>پذیرش RFSU (کارفرما)</button>
        )}
        {!s.ready && <span className="muted sm">باز: {s.blockers.map((x) => `${data.blockerNames[x.kind]}${x.count ? ` (${x.count})` : ""}`).join("، ")}</span>}
        {row.rfsu_signed_at && <span className="sm">امضا: {row.rfsu_signed_by_name || "—"} · {fa(row.rfsu_signed_at)}
          {row.rfsu_accepted_at && ` · پذیرش: ${row.rfsu_accepted_by_name || "—"} · ${fa(row.rfsu_accepted_at)}`}</span>}
      </div>
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
  const blank = { code: "", title: "", appliesTo: "subsystem", criteria: "" };
  const [f, setF] = useState(blank);
  return (
    <div className="card">
      <h2>چک‌لیست‌های پیش‌راه‌اندازی پروژه</h2>
      <p className="muted sm">از رویهٔ راه‌اندازی پروژه: هر چک‌لیست به یک نوع آیتم اعمال می‌شود و برای همهٔ آیتم‌های آن نوع در هر ساب‌سیستم لازم است.
        بدون چک‌لیست، RFSU امضا نمی‌شود — پیش‌راه‌اندازیِ تعریف‌نشده «کامل» نیست.</p>
      {data.templates.length > 0 && <div className="wrap"><table className="dtable">
        <thead><tr><th>کد</th><th>عنوان</th><th>اعمال به</th><th>معیار</th><th>فعال</th></tr></thead>
        <tbody>{data.templates.map((t) => (
          <tr key={t.id} onClick={() => may.sign && setF({ code: t.code, title: t.title, appliesTo: t.appliesTo, criteria: t.criteria || "", active: t.active })}
              style={{ cursor: may.sign ? "pointer" : undefined }}>
            <td><bdi dir="ltr" className="mono">{t.code}</bdi></td><td>{t.title}</td><td>{t.appliesTitle}</td><td className="sm">{t.criteria || "—"}</td>
            <td>{t.active ? "✓" : <span className="muted">—</span>}</td>
          </tr>))}</tbody>
      </table></div>}
      {may.sign && (
        <form style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginTop: 8 }} onSubmit={async (e) => {
          e.preventDefault();
          if (await post({ kind: "template", ...f })) setF(blank);
        }}>
          <div className="field"><label htmlFor="t-code">کد</label><input id="t-code" dir="ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="field" style={{ flex: "1 1 200px" }}><label htmlFor="t-title">عنوان</label><input id="t-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="field"><label htmlFor="t-app">اعمال به</label>
            <select id="t-app" value={f.appliesTo} onChange={(e) => setF({ ...f, appliesTo: e.target.value })}>
              {Object.entries(data.applies).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="field" style={{ flex: "1 1 200px" }}><label htmlFor="t-cr">معیار پذیرش</label><input id="t-cr" value={f.criteria} onChange={(e) => setF({ ...f, criteria: e.target.value })} /></div>
          {"active" in f && <label className="sm"><input type="checkbox" checked={f.active !== false} onChange={(e) => setF({ ...f, active: e.target.checked })} /> فعال</label>}
          <button className="btn ghost" type="submit">ذخیرهٔ چک‌لیست</button>
        </form>
      )}
    </div>
  );
}

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}
const today = () => new Date().toISOString().slice(0, 10);
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
