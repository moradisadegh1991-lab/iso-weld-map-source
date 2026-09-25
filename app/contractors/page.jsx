"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";

/**
 * The companies doing the work, and what each one holds.
 *
 * The lapsed-prequalification banner is the reason this page exists rather
 * than being a tab somewhere: an expired certificate on a company with no
 * open package is paperwork, and the same certificate on one currently
 * welding is an audit finding. The server already separates them; this puts
 * the second kind where it cannot be missed.
 */
const DISCIPLINE_FA = {
  piping: "پایپینگ", structural: "استراکچر", electrical: "برق",
  instrumentation: "ابزار دقیق", civil: "سیویل", equipment: "تجهیزات", coating: "رنگ و عایق",
};
const STATUS_FA = {
  prospective: "در دست بررسی", active: "فعال",
  suspended: "تعلیق", demobilised: "خاتمه‌یافته",
};

export default function ContractorsPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/contractors?projectId=${id}`, []);
  const [adding, setAdding] = useState(false);
  const mayEdit = can({ role }, ACTIONS.MANAGE_MEMBERS);

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;

  const { contractors, packages, lapsed } = data;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>پیمانکاران</h1>
        <span className="sub">{contractors.length} شرکت · {packages.length} پکیج کاری</span>
        <span className="grow" />
        {mayEdit && (
          <button className="btn" onClick={() => setAdding((v) => !v)}>
            {adding ? "بستن" : "افزودن پیمانکار"}
          </button>
        )}
      </div>

      {lapsed.length > 0 && (
        <div className="card" style={{ borderColor: "rgba(226,87,76,.5)" }}>
          <h2 style={{ color: "var(--bad)" }}>صلاحیت منقضی، با کار باز</h2>
          <p className="muted sm">
            این شرکت‌ها هم‌اکنون پکیج کاری در دست دارند و تأییدیهٔ صلاحیت‌شان
            منقضی شده است. همین ترکیب است که در ممیزی یافته می‌شود.
          </p>
          <div className="wrap">
            <table className="dtable">
              <thead><tr><th>کد</th><th>نام</th><th>انقضا</th><th>پکیج‌ها</th></tr></thead>
              <tbody>
                {lapsed.map((l) => (
                  <tr key={l.contractor_code}>
                    <td className="mono">{l.contractor_code}</td>
                    <td>{l.contractor_name}</td>
                    <td className="mono">{fmtDate(l.prequalified_until)}</td>
                    <td className="mono">{l.packages}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {adding && <AddContractor projectId={projectId} call={call}
                                onDone={() => { setAdding(false); reload(); }} />}

      <div className="card">
        <h2>شرکت‌ها</h2>
        {contractors.length === 0 ? (
          <p className="empty-note">هنوز پیمانکاری ثبت نشده است.</p>
        ) : (
          <div className="wrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th>کد</th><th>نام</th><th>وضعیت</th><th>رشته‌ها</th>
                  <th>صلاحیت تا</th><th>پکیج</th><th>مبلغ</th>
                </tr>
              </thead>
              <tbody>
                {contractors.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.code}</td>
                    <td>{c.name}</td>
                    <td><span className={"pill " + (c.status === "active" ? "ok" : "")}>
                      {STATUS_FA[c.status] || c.status}</span></td>
                    <td>{c.disciplines.map((d) => DISCIPLINE_FA[d] || d).join("، ") || "—"}</td>
                    <td className="mono">
                      {c.prequalifiedUntil
                        ? <span className={c.expired ? "pill bad" : ""}>{fmtDate(c.prequalifiedUntil)}</span>
                        : <span className="muted">ثبت نشده</span>}
                    </td>
                    <td className="mono">{c.packages}</td>
                    <td className="mono">{c.awardedValue == null ? "—" : c.awardedValue.toLocaleString("fa-IR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>محدودهٔ کاری و پیشرفت</h2>
        <p className="muted sm">
          پکیجی که ساب‌سیستم ندارد، کل آن رشته در پروژه را پوشش می‌دهد.
        </p>
        {packages.length === 0 ? (
          <p className="empty-note">هنوز پکیج کاری تعریف نشده است.</p>
        ) : (
          <div className="wrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th>پکیج</th><th>پیمانکار</th><th>رشته</th><th>محدوده</th>
                  <th>اقلام</th><th>نصب</th><th>تست</th><th>پیشرفت</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.packageId}>
                    <td className="mono">{p.code}</td>
                    <td>{p.contractor}</td>
                    <td>{DISCIPLINE_FA[p.discipline] || p.discipline}</td>
                    <td className="mono">{p.scope}</td>
                    <td className="mono">{p.items}</td>
                    <td className="mono">{p.installed}</td>
                    <td className="mono">{p.tested}</td>
                    <td>
                      {p.pctReady == null ? <span className="muted">—</span> : (
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="bar"><i style={{ width: `${p.pctReady}%` }} /></span>
                          <span className="mono sm">{p.pctReady}%</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AddContractor({ projectId, call, onDone }) {
  const [f, setF] = useState({ code: "", name: "", status: "active", disciplines: [] });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  function toggle(d) {
    setF((x) => ({ ...x,
      disciplines: x.disciplines.includes(d)
        ? x.disciplines.filter((y) => y !== d)
        : [...x.disciplines, d] }));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await call("/api/contractors", {
        method: "POST", body: JSON.stringify({ ...f, projectId }) });
      onDone();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>پیمانکار جدید</h2>
      <div className="grid2">
        <div className="field">
          <label htmlFor="c-code">کد</label>
          <input id="c-code" required value={f.code} dir="ltr"
                 onChange={(e) => setF({ ...f, code: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="c-name">نام شرکت</label>
          <input id="c-name" required value={f.name}
                 onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="c-status">وضعیت</label>
          <select id="c-status" value={f.status}
                  onChange={(e) => setF({ ...f, status: e.target.value })}>
            {Object.entries(STATUS_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="c-pq">صلاحیت معتبر تا</label>
          <input id="c-pq" type="date" dir="ltr" value={f.prequalifiedUntil || ""}
                 onChange={(e) => setF({ ...f, prequalifiedUntil: e.target.value })} />
          <span className="hint">بدون تاریخ، انقضا قابل پایش نیست.</span>
        </div>
      </div>

      <div className="field">
        <label>رشته‌های مجاز</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.entries(DISCIPLINE_FA).map(([k, v]) => (
            <button type="button" key={k} onClick={() => toggle(k)}
                    className={"btn ghost" + (f.disciplines.includes(k) ? " on" : "")}
                    style={{ padding: "5px 12px",
                      borderColor: f.disciplines.includes(k) ? "var(--cy)" : undefined,
                      color: f.disciplines.includes(k) ? "var(--cy)" : undefined }}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {err && <p className="err">{err}</p>}
      <div>
        <button className="btn" type="submit" disabled={busy || !f.code || !f.name}>
          {busy ? "در حال ثبت…" : "ثبت"}
        </button>
      </div>
    </form>
  );
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
