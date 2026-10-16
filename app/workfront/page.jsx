"use client";
import { useState } from "react";
import { useProjectData } from "../../lib/client/platform.mjs";
import TableKit from "../../components/ui/TableKit";
import { FRONTS, HORIZONS, inHorizon } from "../../lib/workfront.mjs";

/**
 * The work front: what can be started, on which front, and when.
 *
 * An item is on the front when the step it needs next has every
 * predecessor done; when it can start is its material — in the warehouse
 * (or not needed) today, arriving by PO this week or this month, later, or
 * not known. Fronts with work at the same horizon are crews that can work
 * side by side: the spool shop does not wait for the foundations.
 */
const MAT = { ready: ["ok", "موجود"], na: ["", "لازم نیست"], short: ["warn", "کسری"], unknown: ["bad", "نامعلوم"] };
const WHEN = { day: ["ok", "امروز"], week: ["warn", "این هفته"], month: ["warn", "این ماه"], later: ["", "بعدتر"], unknown: ["bad", "مواد نامعلوم"], blocked: ["", "منتظر پیش‌نیاز"] };
const STATE = { not_started: "", in_progress: "در جریان", claimed: "اعلام انجام — منتظر کارفرما" };
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");

export default function WorkFrontPage() {
  const [horizon, setHorizon] = useState("day");
  const { data, error } = useProjectData((id) => `/api/workfront?projectId=${id}`, []);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال محاسبهٔ جبههٔ کاری…</p>;
  const shown = data.items.filter((i) => inHorizon(i, horizon));
  const parallel = horizon === "all" ? data.fronts.map((f) => f.key) : data.parallel[horizon];
  const unknown = data.items.filter((i) => i.horizon === "unknown");

  return (
    <div className="page">
      <div className="pagehead"><h1>جبههٔ کاری</h1>
        <span className="sub">بر اساس زنجیرهٔ کار و مواد موجود · {fa(data.today)}</span></div>

      <div role="tablist" aria-label="بازهٔ زمانی" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {Object.entries(HORIZONS).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={horizon === k} className={`btn ${horizon === k ? "" : "ghost"}`} onClick={() => setHorizon(k)}>
            {t} <span className="mono">({data.items.filter((i) => inHorizon(i, k)).length})</span>
          </button>
        ))}
      </div>

      <div className="card" data-parallel>
        <h2>جبهه‌های هم‌زمان</h2>
        {parallel.length === 0 ? <p className="empty-note">در این بازه جبهه‌ای باز نیست.</p> : (
          <p className="sm" style={{ marginTop: 0 }}>
            {parallel.length > 1
              ? <>این {parallel.length} جبهه به هم وابسته نیستند و <b>هم‌زمان</b> کار می‌کنند: {parallel.map((k) => FRONTS[k]).join(" · ")}</>
              : <>یک جبهه باز است: {FRONTS[parallel[0]]}</>}
          </p>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
          {data.fronts.map((f) => (
            <div key={f.key} className="card" data-front={f.key} style={{ margin: 0, opacity: f.count[horizon] ? 1 : 0.55 }}>
              <b className="sm">{f.title}</b>
              <div style={{ display: "flex", gap: 10, marginTop: 4 }} className="sm">
                <span>امروز <b className="mono">{f.count.day}</b></span><span>هفته <b className="mono">{f.count.week}</b></span>
                <span>ماه <b className="mono">{f.count.month}</b></span><span>کل <b className="mono">{f.count.all}</b></span>
              </div>
              {(f.blocked > 0 || f.unknown > 0) && <div className="muted sm">{f.blocked ? `${f.blocked} منتظر پیش‌نیاز` : ""}{f.blocked && f.unknown ? " · " : ""}{f.unknown ? `${f.unknown} مواد نامعلوم` : ""}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>کارهای {HORIZONS[horizon]}</h2>
        {shown.length === 0 ? <p className="empty-note">کاری در این بازه نیست.</p> : (
          <TableKit name={`workfront-${horizon}`}>
            <table className="dtable" data-workfront>
              <thead><tr><th>جبهه</th><th>آیتم</th><th>مرحلهٔ بعد</th><th>وضعیت</th><th>مواد</th><th>رسیدن مواد</th><th>شروع</th></tr></thead>
              <tbody>{shown.map((i) => (
                <tr key={`${i.kind}:${i.id}`} data-item={i.item}>
                  <td className="sm">{FRONTS[i.front]}</td><td className="mono">{i.item}{i.subsystem && <div className="muted sm">{i.subsystem}</div>}</td>
                  <td>{i.step}{!i.open && i.waitingOn.length > 0 && <div className="muted sm">منتظر: {i.waitingOn.join("، ")}</div>}</td>
                  <td className="sm">{STATE[i.state] || ""}</td>
                  <td>{i.material ? <><span className={`pill ${MAT[i.material.state][0]}`}>{MAT[i.material.state][1]}</span>
                    {i.material.text && <div className="muted sm">{i.material.text}</div>}</> : <span className="muted sm">—</span>}</td>
                  <td className="mono sm">{i.eta ? `${fa(i.eta)} (${i.inDays >= 0 ? `${i.inDays} روز` : `${-i.inDays} روز دیر`})` : "—"}</td>
                  <td><span className={`pill ${WHEN[i.horizon][0]}`}>{WHEN[i.horizon][1]}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </TableKit>
        )}
      </div>

      {unknown.length > 0 && (
        <div className="card">
          <h2>مواد نامعلوم — جبهه باز است ولی مواد روشن نیست</h2>
          <p className="muted sm">این‌ها «آماده» حساب نمی‌شوند: فهرست مواد اسپول یا کد کالای انبار یا PO تجهیز ثبت نشده است.</p>
          <ul className="sm">{unknown.map((i) => <li key={`${i.kind}:${i.id}`}><b className="mono">{i.item}</b> — {i.step}: {i.material.text}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
