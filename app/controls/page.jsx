"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";

/**
 * Project controls: each control account's planned curve, what has been
 * earned and from where, what it cost, and the indices — then the risks.
 *
 * PV is read off the planner's points. EV is either counted by the
 * platform (installed and tested items, under the project's rule of credit)
 * or reported by a person — the table says which, every row. No money is
 * shown without the contract currency, and no ratio over a zero.
 */
const RISK = { open: ["", "باز"], overdue: ["bad", "معوق"], no_response: ["warn", "بدون پاسخ"], closed: ["ok", "بسته"] };

export default function ControlsPage() {
  const { projectId, role, call } = usePlatform();
  const [asOf, setAsOf] = useState("");
  const { data, error, reload } = useProjectData((id) => `/api/controls?projectId=${id}${asOf ? `&asOf=${asOf}` : ""}`, [asOf]);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null);
  const may = can({ role }, ACTIONS.MANAGE_CONTROLS);

  async function post(body) {
    setMsg(null);
    try {
      const r = await call("/api/controls", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return r || true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const cur = data.currency;
  const t = data.total;
  const m = t.money;
  const behind = data.accounts.filter((a) => a.spi !== null && a.spi < 1).length;
  const openRisks = data.risks.filter((r) => r.status === "open").length;
  const overdueRisks = data.risks.filter((r) => r.state === "overdue").length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>کنترل پروژه</h1>
        <span className="sub">
          {data.accounts.length} حساب کنترلی{behind > 0 && ` · ${behind} عقب از برنامه`} · {openRisks} ریسک باز
          {overdueRisks > 0 && ` · ${overdueRisks} اقدام معوق`} · ارز: {cur || "تعیین نشده"}
        </span>
      </div>
      {msg && <p className="err">{msg}</p>}
      {!cur && <p className="err">ارز قرارداد در <a href="/project">مشخصات پروژه</a> تعیین نشده — بودجه و هزینه ثبت نمی‌شود و فقط SPI درصدی نشان داده می‌شود.</p>}

      <div className="card">
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <div className="field"><label htmlFor="asof">تاریخ داده (Data date)</label>
            <input id="asof" type="date" dir="ltr" value={asOf || data.asOf} onChange={(e) => setAsOf(e.target.value === data.today ? "" : e.target.value)} /></div>
          {asOf && <button className="btn ghost" onClick={() => setAsOf("")}>امروز</button>}
          <span className="muted sm" style={{ flex: 1, minWidth: 220 }}>EV پلتفرم برای امروز شمارش زنده است؛ برای تاریخ گذشته از آخرین اسنپ‌شات تا آن تاریخ خوانده می‌شود — هرگز شمارش امروز به‌جای گذشته.</span>
          {may && !asOf && (
            data.snapshots.dates[0] === data.today
              ? <span className="pill ok">اسنپ‌شات امروز ثبت شده</span>
              : <button className="btn" onClick={() => post({ kind: "snapshot" })}>ثبت اسنپ‌شات امروز</button>
          )}
        </div>
      </div>

      <div className="kpis">
        <Kpi v={money(m?.bac, cur)} l="BAC" b={cur || ""} />
        <Kpi v={money(m?.pv, cur)} l="PV — ارزش برنامه‌ریزی‌شده" />
        <Kpi v={money(m?.ev, cur)} l="EV — ارزش کسب‌شده" />
        <Kpi v={money(m?.ac, cur)} l="AC — هزینهٔ واقعی" />
        <Kpi v={idx(t.spi)} l="SPI" b="EV / PV" tone={tone(t.spi)} />
        <Kpi v={idx(m?.cpi)} l="CPI" b="EV / AC" tone={tone(m?.cpi)} />
        <Kpi v={money(m?.eac, cur)} l="EAC" b="BAC / CPI" />
        <Kpi v={money(m?.vac, cur)} l="VAC" b="BAC − EAC" tone={m?.vac != null ? (m.vac < 0 ? "bad" : "ok") : ""} />
      </div>
      {t.excluded.length > 0 && data.accounts.length > 0 && (
        <p className="muted sm">در جمع پروژه نیامده (بدون BAC، PV یا EV): {t.excluded.join("، ")}</p>
      )}

      <div className="card">
        <h2>حساب‌های کنترلی</h2>
        {data.accounts.length === 0 ? <p className="empty-note">حساب کنترلی تعریف نشده است.</p> : (
          <TableKit name="controls">
            <table className="dtable">
              <thead><tr><th>کد</th><th>عنوان</th><th>منبع EV</th><th>PV %</th><th>EV %</th><th>SPI</th><th>CPI</th><th>AC</th><th>EAC</th><th>خط مبنا</th><th /></tr></thead>
              <tbody>
                {data.accounts.map((a) => (
                  <AccountRow key={a.id} a={a} data={data} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)}
                              post={post} may={may} call={call} projectId={projectId} />
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
        {may && <Fold title="حساب کنترلی جدید"><AccountForm data={data} post={post} /></Fold>}
      </div>

      <Snapshots data={data} />

      <Risks data={data} post={post} may={may} />
    </div>
  );
}

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}

function AccountRow({ a, data, open, onToggle, post, may, call, projectId }) {
  const cur = data.currency;
  return (
    <>
      <tr>
        <td className="mono">{a.code}</td>
        <td>{a.title}{a.contractorCode && <div className="muted sm">{a.contractorCode}</div>}</td>
        <td className="sm">
          {a.evMethod === "platform"
            ? <><span className="pill ok">محاسبه‌شده</span> {data.platformDisciplines[a.evDiscipline]}{a.subsystemCode && ` · ${a.subsystemCode}`}
                {a.ev.source === "snapshot" && <div><span className="pill">اسنپ‌شات {fa(a.ev.detail.snapshotOn)}</span></div>}
                {a.ev.detail && a.ev.detail.items != null && <div className="muted">{a.ev.detail.items} آیتم · {a.ev.detail.installed} نصب · {a.ev.detail.tested} تست · سهم نصب {a.creditInstalledPct ?? "؟"}٪</div>}</>
            : <><span className="pill warn">گزارشی</span>{a.ev.detail && <span className="muted"> {a.ev.detail.source} ({fa(a.ev.detail.asOf)})</span>}</>}
          {a.ev.reason && <div className="muted">{a.ev.reason}</div>}
        </td>
        <td className="mono">{pct(a.pvPct)}</td>
        <td className="mono">{pct(a.ev.pct)}</td>
        <td className={`mono ${tone(a.spi)}`}>{idx(a.spi)}</td>
        <td className={`mono ${tone(a.money?.cpi)}`}>{idx(a.money?.cpi)}</td>
        <td className="mono">{a.ac === null ? "—" : money(a.ac, cur)}</td>
        <td className="mono">{money(a.money?.eac, cur)}</td>
        <td className="mono">{a.baselineRev ? `Rev.${a.baselineRev}` : <span className="pill bad">ندارد</span>}</td>
        <td><button className="btn ghost" onClick={onToggle}>{open ? "بستن" : "جزئیات"}</button></td>
      </tr>
      {open && (
        <tr><td colSpan={11}>
          <AccountDetail a={a} data={data} post={post} may={may} call={call} projectId={projectId} />
        </td></tr>
      )}
    </>
  );
}

function AccountDetail({ a, data, post, may, call, projectId }) {
  const [more, setMore] = useState(null);
  const load = async () => { try { setMore(await call(`/api/controls?projectId=${projectId}&accountId=${a.id}`)); } catch { setMore({ baselines: [], costs: [] }); } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [a.id]);
  const cur = data.currency;
  const m = a.money;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SCurve points={a.points} asOf={data.asOf} ev={a.ev.pct} pv={a.pvPct} />
      {m && (
        <p className="mono sm">
          BAC {money(m.bac, cur)} · PV {money(m.pv, cur)} · EV {money(m.ev, cur)} · AC {money(m.ac, cur)} ·
          SV {money(m.sv, cur)} · CV {money(m.cv, cur)} · VAC {money(m.vac, cur)} · TCPI {idx(m.tcpi)}
        </p>
      )}
      {more?.baselines?.length > 0 && (
        <div className="sm"><b>رویژن‌های خط مبنا</b>
          <ul>{more.baselines.map((b) => <li key={b.id}>Rev.{b.revision} — {fa(b.created_at)} — {b.issued_by_name || "?"}: «{b.reason}» ({b.points.length} نقطه، پایان {b.points[b.points.length - 1].date})</li>)}</ul>
        </div>
      )}
      {more?.costs?.length > 0 && (
        <TableKit name="controls"><table className="dtable">
          <thead><tr><th>تاریخ</th><th>سند</th><th>مبلغ</th><th>شرح</th></tr></thead>
          <tbody>{more.costs.map((c) => <tr key={c.id}><td className="mono sm">{fa(c.posted_on)}</td><td className="mono">{c.ref_no}</td>
            <td className={`mono ${Number(c.amount) < 0 ? "bad" : ""}`}>{money(Number(c.amount), cur)}</td><td className="sm">{c.note || ""}</td></tr>)}</tbody>
        </table></TableKit>
      )}
      {may && (
        <div className="grid2">
          <BaselineForm a={a} post={async (b) => { const r = await post(b); if (r) load(); return r; }} />
          {a.evMethod === "manual" && <ProgressForm a={a} post={post} />}
          {cur && <CostForm a={a} cur={cur} post={async (b) => { const r = await post(b); if (r) load(); return r; }} />}
        </div>
      )}
    </div>
  );
}

/** The planner's curve, the data date, and EV against it. */
function SCurve({ points, asOf, ev, pv }) {
  if (!points.length) return <p className="muted sm">خط مبنا ثبت نشده — PV و SPI حساب نمی‌شود.</p>;
  const W = 640, H = 180, L = 36, R = 12, T = 10, B = 24;
  const t = (d) => Date.parse(d + "T00:00:00Z");
  const t0 = t(points[0].date), t1 = Math.max(t(points[points.length - 1].date), t(asOf));
  const x = (d) => L + ((t(d) - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - v / 100) * (H - T - B);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.pct).toFixed(1)}`).join(" ");
  const xa = Math.min(x(asOf), W - R);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, direction: "ltr" }} role="img" aria-label="S-curve">
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--rule)" strokeWidth="1" />
          <text x={L - 6} y={y(v) + 3} fontSize="9" textAnchor="end" fill="var(--dim)">{v}%</text></g>
      ))}
      <path d={path} fill="none" stroke="var(--cy)" strokeWidth="2" />
      {points.map((p) => <circle key={p.date} cx={x(p.date)} cy={y(p.pct)} r="2.5" fill="var(--cy)" />)}
      <line x1={xa} x2={xa} y1={T} y2={H - B} stroke="var(--dim)" strokeDasharray="3 3" />
      <text x={xa} y={H - 8} fontSize="9" textAnchor="middle" fill="var(--dim)">{asOf}</text>
      {pv !== null && <circle cx={xa} cy={y(pv)} r="4" fill="none" stroke="var(--cy)" strokeWidth="2" />}
      {ev !== null && <circle cx={xa} cy={y(ev)} r="4.5" fill={ev < (pv ?? 0) ? "var(--bad)" : "var(--ok)"} />}
      <text x={L} y={H - 8} fontSize="9" fill="var(--dim)">{points[0].date}</text>
    </svg>
  );
}

function BaselineForm({ a, post }) {
  const [f, setF] = useState({ text: a.points.map((p) => `${p.date}, ${p.pct}`).join("\n"), revision: "", reason: "" });
  return (
    <form className="card" style={{ padding: 10 }} onSubmit={async (e) => {
      e.preventDefault();
      const points = f.text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const [date, v] = l.split(/[,\t;]\s*|\s+/); return { date, pct: v };
      });
      if (await post({ kind: "baseline", accountId: a.id, points, revision: f.revision, reason: f.reason })) setF({ ...f, revision: "", reason: "" });
    }}>
      <b>صدور خط مبنا</b>
      <div className="field"><label htmlFor={`bl-${a.id}`}>نقاط تجمعی — هر خط: تاریخ، درصد</label>
        <textarea id={`bl-${a.id}`} dir="ltr" style={{ minHeight: 150 }} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder={"2026-01-01, 0\n2026-06-30, 45\n2026-12-31, 100"} /></div>
      <Field id={`blr-${a.id}`} label="رویژن" value={f.revision} on={(v) => setF({ ...f, revision: v })} required />
      <Field id={`bls-${a.id}`} label="دلیل (مثلاً IFC یا دستور تغییر)" value={f.reason} on={(v) => setF({ ...f, reason: v })} required />
      <div><button className="btn" type="submit">صدور</button></div>
    </form>
  );
}

function ProgressForm({ a, post }) {
  const [f, setF] = useState({ asOf: today(), pct: "", source: "" });
  return (
    <form className="card" style={{ padding: 10 }} onSubmit={async (e) => {
      e.preventDefault(); if (await post({ kind: "progress", accountId: a.id, ...f })) setF({ ...f, pct: "", source: "" });
    }}>
      <b>گزارش پیشرفت (دستی)</b>
      <Field id={`pa-${a.id}`} label="تاریخ" type="date" value={f.asOf} on={(v) => setF({ ...f, asOf: v })} required />
      <Field id={`pp-${a.id}`} label="درصد تجمعی" type="number" value={f.pct} on={(v) => setF({ ...f, pct: v })} required />
      <Field id={`ps-${a.id}`} label="منبع (شمارهٔ گزارش پیشرفت)" value={f.source} on={(v) => setF({ ...f, source: v })} required />
      <div><button className="btn" type="submit">ثبت گزارش</button></div>
    </form>
  );
}

function CostForm({ a, cur, post }) {
  const [f, setF] = useState({ postedOn: today(), amount: "", refNo: "", note: "" });
  return (
    <form className="card" style={{ padding: 10 }} onSubmit={async (e) => {
      e.preventDefault(); if (await post({ kind: "cost", accountId: a.id, ...f })) setF({ ...f, amount: "", refNo: "", note: "" });
    }}>
      <b>ثبت هزینه ({cur})</b>
      <Field id={`cd-${a.id}`} label="تاریخ" type="date" value={f.postedOn} on={(v) => setF({ ...f, postedOn: v })} required />
      <Field id={`ca-${a.id}`} label="مبلغ (منفی = برگشت)" type="number" value={f.amount} on={(v) => setF({ ...f, amount: v })} required />
      <Field id={`cr-${a.id}`} label="شمارهٔ سند" value={f.refNo} on={(v) => setF({ ...f, refNo: v })} required />
      <Field id={`cn-${a.id}`} label="شرح (برای برگشت الزامی)" value={f.note} on={(v) => setF({ ...f, note: v })} />
      <div><button className="btn" type="submit">ثبت</button></div>
    </form>
  );
}

function AccountForm({ data, post }) {
  const blank = { code: "", title: "", contractorId: "", bac: "", evMethod: "manual", evDiscipline: "piping", evSubsystemId: "", creditInstalledPct: "" };
  const [f, setF] = useState(blank);
  return (
    <form style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "account", ...f })) setF(blank); }}>
      <h2>حساب کنترلی</h2>
      <div className="grid2">
        <Field id="ac-code" label="کد (WBS/CBS)" value={f.code} on={(v) => setF({ ...f, code: v })} required />
        <Field id="ac-title" label="عنوان" value={f.title} on={(v) => setF({ ...f, title: v })} required />
        <div className="field"><label htmlFor="ac-c">پیمانکار</label>
          <select id="ac-c" value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}>
            <option value="">—</option>{data.contractors.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select></div>
        <Field id="ac-bac" label={`BAC (${data.currency || "ارز تعیین نشده"})`} type="number" value={f.bac} on={(v) => setF({ ...f, bac: v })} />
        <div className="field"><label htmlFor="ac-m">منبع EV</label>
          <select id="ac-m" value={f.evMethod} onChange={(e) => setF({ ...f, evMethod: e.target.value })}>
            <option value="manual">گزارش دستی</option><option value="platform">محاسبه از پلتفرم</option>
          </select></div>
        {f.evMethod === "platform" && <>
          <div className="field"><label htmlFor="ac-d">آیتم‌ها</label>
            <select id="ac-d" value={f.evDiscipline} onChange={(e) => setF({ ...f, evDiscipline: e.target.value })}>
              {Object.entries(data.platformDisciplines).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select></div>
          <div className="field"><label htmlFor="ac-s">ساب‌سیستم</label>
            <select id="ac-s" value={f.evSubsystemId} onChange={(e) => setF({ ...f, evSubsystemId: e.target.value })}>
              <option value="">همه</option>{data.subsystems.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
            </select></div>
          <Field id="ac-k" label="سهم نصب از 100 (باقی در تست)" type="number" value={f.creditInstalledPct} on={(v) => setF({ ...f, creditInstalledPct: v })} />
        </>}
      </div>
      <div><button className="btn" type="submit">ثبت حساب</button></div>
    </form>
  );
}

function Risks({ data, post, may }) {
  const blank = { code: "", title: "", category: "", owner: "", probability: "3", impact: "3", response: "", dueOn: "", residualP: "", residualI: "" };
  const [f, setF] = useState(blank);
  return (
    <div className="card">
      <h2>رجیستر ریسک</h2>
      <p className="muted sm">امتیاز = احتمال × اثر (1 تا 5). مرز «زیاد/متوسط» سیاست شرکت است و این‌جا فرض نمی‌شود؛ ریسک‌ها به ترتیب امتیاز می‌آیند.</p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Heat title="ذاتی" g={data.heat.inherent} />
        <Heat title="باقیمانده" g={data.heat.residual} />
      </div>
      {data.risks.length > 0 && (
        <TableKit name="controls">
          <table className="dtable">
            <thead><tr><th>کد</th><th>ریسک</th><th>مالک</th><th>P×I</th><th>پاسخ</th><th>مهلت</th><th>باقیمانده</th><th>وضعیت</th><th /></tr></thead>
            <tbody>
              {data.risks.map((r) => {
                const [st, label] = RISK[r.state];
                return (
                  <tr key={r.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{r.code}</td>
                    <td>{r.title}{r.category && <div className="muted sm">{r.category}{r.account_code && ` · ${r.account_code}`}</div>}</td>
                    <td>{r.owner || "—"}</td>
                    <td className="mono">{r.probability}×{r.impact} = <b>{r.score}</b></td>
                    <td className="sm">{r.response || "—"}</td>
                    <td className="mono sm">{r.due_on ? fa(r.due_on) : "—"}</td>
                    <td className="mono">{r.residualScore ?? "—"}</td>
                    <td><span className={`pill ${st}`}>{label}</span></td>
                    <td>{may && r.status === "open" && <button className="btn ghost" onClick={() => post({ kind: "risk-close", riskId: r.id, closedOn: today() })}>بستن</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableKit>
      )}
      {may && (
        <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "risk", ...f })) setF(blank); }}>
          <div className="grid2">
            <Field id="rk-code" label="کد" value={f.code} on={(v) => setF({ ...f, code: v })} required />
            <Field id="rk-title" label="عنوان" value={f.title} on={(v) => setF({ ...f, title: v })} required />
            <Field id="rk-cat" label="دسته" value={f.category} on={(v) => setF({ ...f, category: v })} />
            <Field id="rk-own" label="مالک" value={f.owner} on={(v) => setF({ ...f, owner: v })} />
            <Scale id="rk-p" label="احتمال" value={f.probability} on={(v) => setF({ ...f, probability: v })} />
            <Scale id="rk-i" label="اثر" value={f.impact} on={(v) => setF({ ...f, impact: v })} />
            <Field id="rk-resp" label="اقدام پاسخ" value={f.response} on={(v) => setF({ ...f, response: v })} />
            <Field id="rk-due" label="مهلت اقدام" type="date" value={f.dueOn} on={(v) => setF({ ...f, dueOn: v })} />
            <Scale id="rk-rp" label="احتمال باقیمانده" value={f.residualP} on={(v) => setF({ ...f, residualP: v })} blank />
            <Scale id="rk-ri" label="اثر باقیمانده" value={f.residualI} on={(v) => setF({ ...f, residualI: v })} blank />
          </div>
          <div><button className="btn" type="submit">ثبت ریسک</button></div>
        </form>
      )}
    </div>
  );
}

function Snapshots({ data }) {
  const h = data.snapshots;
  if (!h.dates.length) {
    return (
      <div className="card">
        <h2>تاریخچهٔ ماهانه (اسنپ‌شات)</h2>
        <p className="empty-note">هنوز اسنپ‌شاتی ثبت نشده. EV پلتفرم شمارش لحظه‌ای است و اگر در پایان هر ماه ثبت نشود، رقم آن ماه از دست می‌رود — با دکمهٔ «ثبت اسنپ‌شات امروز» یا زمان‌بندی <span className="mono">npm run controls:snapshot</span>.</p>
      </div>
    );
  }
  const dates = [...h.dates].reverse();
  const accounts = [...new Map(h.ev.map((r) => [r.accountId, r.code])).entries()];
  const disciplines = [...new Set(h.progress.map((r) => r.discipline))];
  const evAt = (id, d) => h.ev.find((r) => r.accountId === id && r.asOf === d);
  const prAt = (k, d) => h.progress.find((r) => r.discipline === k && r.asOf === d);
  return (
    <div className="card">
      <h2>تاریخچهٔ ماهانه (اسنپ‌شات)</h2>
      <p className="muted sm">رقم ثبت‌شدهٔ هر تاریخ همان است که آن روز بود — اسنپ‌شات اصلاح یا حذف نمی‌شود.</p>
      {accounts.length > 0 && (
        <TableKit name="controls-ev-history">
          <table className="dtable">
            <thead><tr><th>حساب</th>{dates.map((d) => <th key={d} className="mono">{fa(d)}</th>)}</tr></thead>
            <tbody>
              {accounts.map(([id, code]) => (
                <tr key={id}>
                  <td className="mono">{code}</td>
                  {dates.map((d) => {
                    const r = evAt(id, d);
                    return <td key={d} className="mono sm" title={r?.reason || ""}>{r ? <>PV {pct(r.pvPct)}<br />EV {pct(r.evPct)}</> : "—"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {disciplines.length > 0 && (
        <TableKit name="controls-progress-history">
          <table className="dtable">
            <thead><tr><th>رشته</th>{dates.map((d) => <th key={d} className="mono">{fa(d)}</th>)}</tr></thead>
            <tbody>
              {disciplines.map((k) => (
                <tr key={k}>
                  <td>{data.platformDisciplines[k] || k}</td>
                  {dates.map((d) => {
                    const r = prAt(k, d);
                    return <td key={d} className="mono sm">{r ? <>{r.installed}/{r.items} نصب<br />{r.tested} تست</> : "—"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
    </div>
  );
}

function Heat({ title, g }) {
  const max = Math.max(1, ...g.flat());
  return (
    <div>
      <div className="muted sm">{title} — سطر: احتمال، ستون: اثر</div>
      <table style={{ borderCollapse: "collapse", direction: "ltr" }}>
        <tbody>
          {[4, 3, 2, 1, 0].map((p) => (
            <tr key={p}><td className="muted sm" style={{ padding: "0 6px" }}>{p + 1}</td>
              {g[p].map((n, i) => {
                const s = (p + 1) * (i + 1);
                return <td key={i} title={`P${p + 1} × I${i + 1} = ${s}`} style={{ width: 30, height: 24, textAlign: "center", fontSize: 11,
                  border: "1px solid var(--rule)", background: n ? `rgba(226,87,76,${0.15 + 0.6 * (n / max)})` : "transparent" }}>{n || ""}</td>;
              })}</tr>
          ))}
          <tr><td />{[1, 2, 3, 4, 5].map((i) => <td key={i} className="muted sm" style={{ textAlign: "center" }}>{i}</td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}

function Scale({ id, label, value, on, blank }) {
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => on(e.target.value)}>
        {blank && <option value="">—</option>}
        {[1, 2, 3, 4, 5].map((v) => <option key={v} value={String(v)}>{v}</option>)}
      </select></div>
  );
}

function Field({ id, label, value, on, type = "text", required }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} step={type === "number" ? "any" : undefined} dir={type === "text" ? "auto" : "ltr"}
             required={required} value={value} onChange={(e) => on(e.target.value)} />
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
const pct = (v) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}`);
const idx = (v) => (v === null || v === undefined ? "—" : v.toFixed(2));
const tone = (v) => (v === null || v === undefined ? "" : v < 0.95 ? "bad" : v < 1 ? "warn" : "ok");
function money(v, cur) {
  if (v === null || v === undefined || !cur) return "—";
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}k` : a.toFixed(0);
  return (v < 0 ? "−" : "") + s;
}
