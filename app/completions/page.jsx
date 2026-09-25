"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";

/**
 * Mechanical completion, subsystem by subsystem, and the pressure-test
 * packages behind it.
 *
 * A subsystem can be signed only when the list of what is open is empty;
 * the list is the engine's and is shown in full, not as a percentage. A
 * package can be tested only when the walkdown the data can answer finds
 * nothing, at the pressure B31.3 gives from the stated inputs.
 */
const PACK_STATE = { not_ready: ["", "آمادهٔ تست نیست"], ready: ["warn", "آمادهٔ تست"], passed: ["warn", "قبول — منتظر پذیرش"], accepted: ["ok", "پذیرفته‌شده"] };

export default function CompletionsPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/completions?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null);
  const mayRecord = can({ role }, ACTIONS.RECORD_COMPLETIONS);
  const maySign = can({ role }, ACTIONS.SIGN_MC);

  async function post(body) {
    setMsg(null);
    try {
      await call("/api/completions", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const subs = data.subsystems;
  const signed = subs.filter((s) => s.signed_at).length;
  const accepted = subs.filter((s) => s.accepted_at).length;
  const readyNow = subs.filter((s) => s.ready && !s.signed_at).length;
  const packs = data.packages;
  const packsAccepted = packs.filter((p) => p.state === "accepted").length;
  const packsReady = packs.filter((p) => p.state === "ready").length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>تکمیل مکانیکی و پکیج تست</h1>
        <span className="sub">{signed} از {subs.length} ساب‌سیستم امضاشده · {packsAccepted} از {packs.length} پکیج تست پذیرفته‌شده</span>
      </div>
      {msg && <p className="err">{msg}</p>}

      <div className="kpis">
        <Kpi v={`${accepted}/${subs.length}`} l="MC پذیرفته‌شده (کارفرما)" tone={accepted === subs.length && subs.length ? "ok" : ""} />
        <Kpi v={signed - accepted} l="MC امضاشده، منتظر پذیرش" />
        <Kpi v={readyNow} l="آمادهٔ امضای MC" tone={readyNow ? "ok" : ""} />
        <Kpi v={subs.filter((s) => s.reopened).length} l="امضاشده ولی دوباره باز" b="Punch A یا NCR جدید" tone={subs.some((s) => s.reopened) ? "bad" : ""} />
        <Kpi v={packsReady} l="پکیج آمادهٔ تست" tone={packsReady ? "warn" : ""} />
        <Kpi v={packs.length - packsAccepted} l="پکیج باز" />
      </div>

      <div className="card">
        <h2>ساب‌سیستم‌ها — آنچه MC را نگه داشته</h2>
        <p className="muted sm">امضای MC فقط وقتی ممکن است که این فهرست خالی باشد: همهٔ تگ‌ها آماده، همهٔ خطوط در پکیج با تست پذیرفته، همهٔ کابل‌ها و ابزارها تست‌شده، و هیچ Punch A و NCR بازی نمانده. امضاکننده و پذیرندهٔ کارفرما دو نفرند.</p>
        <TableKit name="completions">
          <table className="dtable">
            <thead><tr><th>ساب‌سیستم</th><th>MC هدف</th><th>محدوده</th><th>باز</th><th>وضعیت</th><th /></tr></thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>{s.code}{s.name && <div className="muted sm">{s.name}</div>}</td>
                  <td className="mono sm">{s.target_mc_date ? fa(s.target_mc_date) : "—"}</td>
                  <td className="sm">{s.tags.length} تگ · {s.lines.length} خط</td>
                  <td className="sm">
                    {s.blockers.length === 0 ? <span className="pill ok">چیزی باز نیست</span> : s.blockers.map((b) => (
                      <div key={b.kind} title={b.detail.join("، ")}>
                        <span className={`pill ${b.kind === "empty" ? "" : "bad"}`}>{data.blockerNames[b.kind]}{b.count ? ` · ${b.count}` : ""}</span>
                        {b.detail.length > 0 && <span className="muted"> {b.detail.slice(0, 3).join("، ")}{b.detail.length > 3 ? ` و ${b.detail.length - 3} مورد دیگر` : ""}</span>}
                      </div>
                    ))}
                  </td>
                  <td className="sm">
                    {s.accepted_at ? <span className="pill ok">پذیرفته — {s.accepted_by_name}</span>
                      : s.signed_at ? <span className="pill warn">امضا — {s.signed_by_name}</span> : <span className="muted">امضا نشده</span>}
                    {s.reopened && <div><span className="pill bad">پس از امضا دوباره باز شد</span></div>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {maySign && !s.signed_at && <button className="btn" disabled={!s.ready} onClick={() => post({ kind: "mc-sign", subsystemId: s.id })}>امضای MC</button>}
                    {maySign && s.signed_at && !s.accepted_at && <button className="btn ghost" onClick={() => post({ kind: "mc-accept", subsystemId: s.id })}>پذیرش کارفرما</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      </div>

      <div className="card">
        <h2>پکیج‌های تست فشار</h2>
        <p className="muted sm">فشار تست طبق ASME B31.3: هیدرو ۱٫۵ × P × Rr (§345.4.2)، پنوماتیک ۱٫۱ × P (§345.5.4)، نگه‌داشت حداقل ۱۰ دقیقه. P از کلاس لولهٔ هر خط؛ Rr = ST/S ورودی مهندسی پکیج است و پیش‌فرض ندارد.</p>
        {packs.length === 0 ? <p className="empty-note">پکیجی تعریف نشده است.</p> : (
          <TableKit name="completions">
            <table className="dtable">
              <thead><tr><th>پکیج</th><th>ساب‌سیستم</th><th>نوع</th><th>خطوط</th><th>فشار تست</th><th>وضعیت</th><th /></tr></thead>
              <tbody>
                {packs.map((p) => {
                  const [tone, label] = PACK_STATE[p.state];
                  return [
                    <tr key={p.package.id}>
                      <td className="mono">{p.package.pack_no}</td>
                      <td className="mono">{p.subsystemCode || "—"}</td>
                      <td>{data.media[p.package.medium]}</td>
                      <td className="mono">{p.lines.length}</td>
                      <td className="mono">{p.pressure.barg !== null ? `${p.pressure.barg} barg` : <span className="muted sm">{p.pressure.reason}</span>}
                        {p.mixed && <div><span className="pill warn">فشار طراحی خطوط یکسان نیست</span></div>}</td>
                      <td><span className={`pill ${tone}`}>{label}</span></td>
                      <td><button className="btn ghost" onClick={() => setOpen(open === p.package.id ? null : p.package.id)}>{open === p.package.id ? "بستن" : "جزئیات"}</button></td>
                    </tr>,
                    open === p.package.id && (
                      <tr key={p.package.id + "-x"}><td colSpan={7}>
                        <PackDetail p={p} data={data} post={post} may={mayRecord} />
                      </td></tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </TableKit>
        )}
        {mayRecord && <Fold title="پکیج تست جدید"><PackForm data={data} post={post} /></Fold>}
      </div>
    </div>
  );
}

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}

function PackDetail({ p, data, post, may }) {
  const [line, setLine] = useState("");
  const [t, setT] = useState({ testedOn: today(), achievedBarg: "", holdMin: "", gaugeCert: "", leaks: "", witness: "" });
  const free = data.lines.filter((l) => !l.pack_no);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {p.pressure.basis && <p className="mono sm">{p.pressure.basis} = {p.pressure.barg} barg</p>}
      <TableKit name="completions">
        <table className="dtable">
          <thead><tr><th>خط</th><th>کلاس</th><th>P طراحی</th><th>جوش</th><th>انجام</th><th>NDT پذیرفته</th><th>PWHT</th><th>ساپورت</th><th /></tr></thead>
          <tbody>
            {p.lines.map((l) => (
              <tr key={l.id}>
                <td className="mono">{l.lineNo}</td><td className="mono">{l.classCode || "—"}</td>
                <td className="mono">{l.designBarg ?? <span className="bad">؟</span>}</td>
                <td className="mono">{l.welds}</td>
                <td className={`mono ${l.welded < l.welds ? "warn" : "ok"}`}>{l.welded}</td>
                <td className={`mono ${l.examined < l.welds ? "warn" : "ok"}`}>{l.examined}</td>
                <td className="mono">{l.pwhtRequired ? `${l.pwhtDone}/${l.pwhtRequired}` : "—"}</td>
                <td className={`mono ${l.supportsInstalled < l.supports ? "warn" : ""}`}>{l.supports ? `${l.supportsInstalled}/${l.supports}` : "—"}</td>
                <td>{may && !p.accepted && <button className="btn ghost" onClick={() => post({ kind: "line-remove", packageId: p.package.id, lineId: l.id })}>حذف</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableKit>
      {p.blockers.length > 0 && (
        <div className="sm"><b>آنچه تست را نگه داشته:</b>
          <ul style={{ margin: 0 }}>{p.blockers.map((b, i) => <li key={i}>{b.line && <span className="mono">{b.line}: </span>}{b.what}</li>)}</ul>
        </div>
      )}
      {p.tests.length > 0 && (
        <TableKit name="completions"><table className="dtable">
          <thead><tr><th>تاریخ</th><th>لازم</th><th>اعمال‌شده</th><th>نگه‌داشت</th><th>گیج</th><th>شاهد</th><th>نتیجه</th><th /></tr></thead>
          <tbody>{p.tests.map((r) => (
            <tr key={r.id}>
              <td className="mono sm">{fa(r.tested_on)}</td><td className="mono">{Number(r.required_barg)}</td>
              <td className="mono">{r.achieved_barg ?? "—"}</td><td className="mono">{r.hold_min ?? "—"}</td>
              <td className="mono sm">{r.gauge_cert || "—"}</td><td className="sm">{r.witness || "—"}</td>
              <td>{r.verdict === "pass" ? <span className="pill ok">قبول</span> : <span className="pill bad" title={r.reasons.join(" · ")}>رد</span>}
                {r.verdict === "fail" && <div className="muted sm">{r.reasons.join(" · ")}</div>}
                {r.accepted_by_name && <div className="muted sm">پذیرش: {r.accepted_by_name}</div>}</td>
              <td>{may && r.verdict === "pass" && !r.accepted_by && <button className="btn" onClick={() => post({ kind: "test-accept", recordId: r.id })}>پذیرش</button>}</td>
            </tr>))}</tbody>
        </table></TableKit>
      )}
      {may && !p.accepted && (
        <div className="grid2">
          <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
            <Select id={`pl-${p.package.id}`} label="افزودن خط" value={line} on={setLine} opts={free.map((l) => [l.id, l.line_no])} blank="—" />
            <button className="btn ghost" disabled={!line} onClick={async () => { if (await post({ kind: "lines-add", packageId: p.package.id, lineIds: [line] })) setLine(""); }}>افزودن</button>
          </div>
          {p.state !== "passed" && (
            <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "test", packageId: p.package.id, ...t })) setT({ ...t, achievedBarg: "", holdMin: "" }); }}>
              <b>ثبت تست</b>
              <div className="grid2">
                <Field id={`td-${p.package.id}`} label="تاریخ" type="date" value={t.testedOn} on={(v) => setT({ ...t, testedOn: v })} />
                <Field id={`ta-${p.package.id}`} label="فشار اعمال‌شده (barg)" type="number" value={t.achievedBarg} on={(v) => setT({ ...t, achievedBarg: v })} />
                <Field id={`th-${p.package.id}`} label="نگه‌داشت (دقیقه)" type="number" value={t.holdMin} on={(v) => setT({ ...t, holdMin: v })} />
                <Field id={`tg-${p.package.id}`} label="گواهی کالیبراسیون گیج" value={t.gaugeCert} on={(v) => setT({ ...t, gaugeCert: v })} />
                <Select id={`tl-${p.package.id}`} label="نشتی" value={t.leaks} on={(v) => setT({ ...t, leaks: v })}
                        opts={[["false", "بدون نشتی"], ["true", "نشتی دیده شد"]]} blank="ثبت نشده" />
                <Field id={`tw-${p.package.id}`} label="شاهد (کارفرما / TPI)" value={t.witness} on={(v) => setT({ ...t, witness: v })} />
              </div>
              <button className="btn" type="submit">ثبت تست</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function PackForm({ data, post }) {
  const blank = { packNo: "", subsystemId: "", medium: "hydrostatic", stressRatio: "", description: "" };
  const [f, setF] = useState(blank);
  return (
    <form style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "package", ...f })) setF(blank); }}>
      <h2>پکیج تست جدید / ویرایش</h2>
      <div className="grid2">
        <Field id="pk-no" label="شمارهٔ پکیج" value={f.packNo} on={(v) => setF({ ...f, packNo: v })} required />
        <Select id="pk-s" label="ساب‌سیستم" value={f.subsystemId} on={(v) => setF({ ...f, subsystemId: v })} opts={data.subsystems.map((s) => [s.id, s.code])} blank="—" />
        <Select id="pk-m" label="نوع تست" value={f.medium} on={(v) => setF({ ...f, medium: v })} opts={Object.entries(data.media)} />
        {f.medium === "hydrostatic" && <Field id="pk-rr" label="Rr = ST/S (از محاسبات مهندسی)" type="number" value={f.stressRatio} on={(v) => setF({ ...f, stressRatio: v })} />}
        <Field id="pk-d" label="شرح" value={f.description} on={(v) => setF({ ...f, description: v })} />
      </div>
      <div><button className="btn" type="submit">ثبت پکیج</button></div>
    </form>
  );
}

function Select({ id, label, value, on, opts, blank }) {
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => on(e.target.value)}>
        {blank !== undefined && <option value="">{blank}</option>}
        {opts.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
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
