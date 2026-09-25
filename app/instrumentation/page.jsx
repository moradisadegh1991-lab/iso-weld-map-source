"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import { CATEGORIES } from "../../lib/instrumentation/isa.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";

/**
 * Instrumentation: the instrument index read by ISA 5.1, each instrument
 * from the bench to its loop check, and the loops themselves.
 *
 * Two things here cannot be ticked. A transmitter's or gauge's calibration
 * comes from its points; a loop check is signed once for the loop, and only
 * when every instrument in it is calibrated, installed, hooked up and wired.
 */
export default function InstrumentationPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/instrumentation?projectId=${id}`, []);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [msg, setMsg] = useState(null);
  const [q, setQ] = useState("");
  const mayRecord = can({ role }, ACTIONS.ASSIGN_WELD);
  const mayRegister = can({ role }, ACTIONS.EDIT_EXTRACTION);

  const load = async (id) => setDetail(await call(`/api/instrumentation?projectId=${projectId}&instrumentId=${id}`));
  async function expand(id) {
    if (open === id) { setOpen(null); setDetail(null); return; }
    setOpen(id); setDetail(null);
    try { await load(id); } catch (e) { setMsg(e.message); }
  }
  async function post(body) {
    setMsg(null);
    try {
      const r = await call("/api/instrumentation", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      if (open) await load(open);
      reload();
      return r || true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;

  const list = data.instruments;
  const shown = list.filter((i) => !q || `${i.tagNo} ${i.service || ""} ${i.loopNo || ""} ${i.eqTagNo || ""}`
    .toLowerCase().includes(q.toLowerCase()));
  const ready = list.filter((i) => i.ready).length;
  const calBad = list.filter((i) => i.calibration.note?.level === "bad").length;
  const unread = list.filter((i) => !i.category).length;
  const checked = data.loops.filter((l) => l.checked).length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>ابزار دقیق</h1>
        <span className="sub">
          {list.length} ابزار · {data.loops.length} لوپ ({checked} لوپ‌چک‌شده) · {ready} آماده
          {calBad > 0 && ` · ${calBad} کالیبراسیون ردشده`}
          {unread > 0 && ` · ${unread} تگ ناخوانا`}
        </span>
      </div>
      {msg && <p className="err">{msg}</p>}

      {data.spec.tolerancePct === null && (
        <div className="card" style={{ borderColor: "rgba(224,163,62,.5)" }}>
          <h2 style={{ color: "var(--warn)" }}>تلورانس کالیبراسیون پروژه ثبت نشده</h2>
          <p className="muted sm">
            ابزاری که تلورانس دیتاشیت خودش را ندارد حکم کالیبراسیون نمی‌گیرد تا در{" "}
            <a href="/project" className="cy">مشخصات پروژه ← ابزار دقیق</a> ثبت شود. ±0.1% و ±1% هر دو درست‌اند، برای ابزارهای متفاوت.
          </p>
        </div>
      )}

      <Loops loops={data.loops} mayRecord={mayRecord} post={post} />

      <div className="card">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ marginInlineEnd: "auto" }}>ابزارها</h2>
          <input className="search" placeholder="جستجوی تگ، سرویس، لوپ…" value={q} onChange={(e) => setQ(e.target.value)}
                 style={{ maxWidth: 260 }} aria-label="جستجو" />
        </div>
        {list.length === 0 ? <p className="empty-note">هنوز لیست ابزاری وارد نشده است.</p> : (
          <TableKit name="instrumentation">
            <table className="dtable">
              <thead>
                <tr><th>تگ</th><th>نوع (ISA 5.1)</th><th>سرویس</th><th>لوپ</th><th>تجهیز</th><th>رنج</th>
                    <th>پیشرفت</th><th>امروز می‌شود</th><th>کالیبراسیون</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <Row key={i.id} i={i} open={open === i.id} detail={open === i.id ? detail : null}
                       onToggle={() => expand(i.id)} mayRecord={mayRecord} mayRegister={mayRegister}
                       post={post} tags={data.tags} />
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
      </div>

      {mayRegister && <Fold title="ورود لیست ابزار (Instrument Index)"><Import post={post} /></Fold>}
    </div>
  );
}

function Loops({ loops, mayRecord, post }) {
  const [ref, setRef] = useState("");
  if (!loops.length) return null;
  return (
    <div className="card">
      <h2>لوپ‌ها</h2>
      <p className="muted sm">لوپ چک یک‌بار برای کل لوپ امضا می‌شود و فقط وقتی همهٔ ابزارهای لوپ کالیبره، نصب، هوک‌آپ و سیم‌بندی شده باشند.</p>
      <TableKit name="instrumentation">
        <table className="dtable">
          <thead><tr><th>لوپ</th><th>ابزارها</th><th>وضعیت</th><th /></tr></thead>
          <tbody>
            {loops.map((l) => (
              <tr key={l.loopNo}>
                <td className="mono">{l.loopNo}</td>
                <td className="mono sm">{l.members.join("، ")}</td>
                <td>{l.checked ? <span className="pill ok">لوپ‌چک‌شده</span>
                  : l.ready ? <span className="pill">آمادهٔ لوپ چک</span>
                  : <span className="muted sm">ابزارها هنوز کامل نیستند</span>}</td>
                <td>{mayRecord && !l.checked && l.ready && (
                  <span style={{ display: "flex", gap: 6 }}>
                    <input className="search" placeholder="شمارهٔ فرم لوپ چک" value={ref} onChange={(e) => setRef(e.target.value)}
                           style={{ maxWidth: 150 }} aria-label="شمارهٔ فرم" />
                    <button className="btn" style={{ padding: "4px 10px" }}
                            onClick={() => post({ kind: "loop", loopNo: l.loopNo, checkedOn: today(), refNo: ref || null })}>
                      امضای لوپ چک</button>
                  </span>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableKit>
    </div>
  );
}

function Row({ i, open, detail, onToggle, mayRecord, mayRegister, post, tags }) {
  const c = i.calibration;
  return (
    <>
      <tr>
        <td className="mono">{i.tagNo}</td>
        <td className="sm">{i.category ? CATEGORIES[i.category] : <span className="pill bad">ناخوانا</span>}</td>
        <td className="sm">{i.service || "—"}</td>
        <td className="mono sm">{i.loopNo || "—"}{i.loopDerived && <span className="muted"> (ISA)</span>}</td>
        <td className="mono">{i.eqTagNo || "—"}</td>
        <td className="mono sm">{i.range || "—"}</td>
        <td><Bar pct={i.pct} /></td>
        <td className="sm">
          {i.ready ? <span className="pill ok">آماده</span> : i.next.map((n) => n.title).join("، ") || "—"}
          {i.outOfOrder.length > 0 && <div><span className="pill bad">خارج از ترتیب: {i.outOfOrder.join("، ")}</span></div>}
        </td>
        <td>{c.status === "done" ? <span className="pill ok">{c.derived ? "پذیرفته" : "امضاشده"}</span>
          : c.note?.level === "bad" ? <span className="pill bad">رد</span>
          : c.note?.level === "warn" ? <span className="pill">بدون حکم</span>
          : <span className="muted sm">—</span>}</td>
        <td><button className="btn ghost" style={{ padding: "4px 10px" }} onClick={onToggle}>
          {open ? "بستن" : "جزئیات"}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10} style={{ background: "rgba(255,255,255,.02)" }}>
            {!detail ? <span className="muted sm">در حال بارگذاری…</span>
              : <Detail i={i} s={detail.status} mayRecord={mayRecord} mayRegister={mayRegister} post={post} tags={tags} />}
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ i, s, mayRecord, mayRegister, post, tags }) {
  const req = s.calibration.requirement;
  const v = s.calibration.verdict;
  const [pts, setPts] = useState("");
  const [cref, setCref] = useState("");
  const hint = req.reason ? "" : req.output === "mA"
    ? `مثلاً ${[0, 0.25, 0.5, 0.75, 1].map((f) => `${round(req.lo + f * (req.hi - req.lo))}:${round(4 + 16 * f)}`).join(" ")}`
    : `مثلاً ${[0, 0.25, 0.5, 0.75, 1].map((f) => { const a = round(req.lo + f * (req.hi - req.lo)); return `${a}:${a}`; }).join(" ")}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))" }}>
        {s.steps.map((x) => (
          <div key={x.code} className="card" style={{ padding: 10, gap: 6,
            borderColor: x.note?.level === "bad" ? "rgba(226,87,76,.6)"
              : x.status === "done" ? "rgba(63,178,127,.5)"
              : x.blocked ? undefined : "rgba(67,160,180,.6)" }}>
            <span className="sm"><b>{x.derived ? "⚙ " : ""}{x.title}</b></span>
            <span className="sm muted">
              {x.status === "done" ? `انجام شد${x.doneAt ? " · " + fa(x.doneAt) : ""}${x.refNo ? " · " + x.refNo : ""}`
                : x.note?.level === "bad" ? "رد — اصلاح لازم است"
                : x.derived && x.note?.level === "warn" ? "بدون حکم"
                : x.blocked ? `منتظر: ${x.waitingOn.map((w) => w.title).join("، ")}`
                : x.derived && x.code === "loop_check" ? `در جدول لوپ‌ها، برای لوپ ${i.loopNo}`
                : "آمادهٔ شروع"}
            </span>
            {x.note && <span className={"sm " + (x.note.level === "bad" ? "err" : "muted")}>{x.note.text}</span>}
            {x.outOfOrder && <span className="pill bad">خارج از ترتیب ثبت شده</span>}
            {mayRecord && !x.derived && x.status !== "done" && !x.blocked && (
              <button className="btn" style={{ padding: "4px 10px" }}
                      onClick={() => post({ kind: "activity", instrumentId: i.id, code: x.code, doneAt: today() })}>
                ثبت انجام (امروز)</button>
            )}
          </div>
        ))}
      </div>

      {!req.reason || s.calibration.history.length > 0 ? (
        <div className="card" style={{ padding: 12 }}>
          <h2>کالیبراسیون</h2>
          <p className="muted sm">
            {req.reason || `رنج ${req.lo}–${req.hi} · خروجی ${req.output === "mA" ? "4–20 mA" : "واحد مهندسی"} · تلورانس ±${req.tolerancePct}% اسپن · دست‌کم ۵ نقطه تا دو سر رنج. آخرین کالیبراسیون حکم می‌گیرد.`}
          </p>
          {v?.points && (
            <TableKit name="instrumentation">
              <table className="dtable">
                <thead><tr><th>اعمالی</th><th>انتظار</th><th>خروجی</th><th>خطا % اسپن</th></tr></thead>
                <tbody>
                  {v.points.map((p, k) => (
                    <tr key={k}>
                      <td className="mono">{p.applied}</td><td className="mono">{p.expected}</td>
                      <td className="mono">{p.output}</td>
                      <td className="mono" style={{ color: p.errPct > req.tolerancePct ? "var(--bad)" : undefined }}>{p.errPct}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableKit>
          )}
          {mayRecord && !req.reason && (
            <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
              e.preventDefault();
              if (await post({ kind: "calibration", instrumentId: i.id, points: pts, calibratedOn: today(),
                calibratorRef: cref || null })) setPts("");
            }}>
              <Field id="cal-p" label="نقاط (اعمالی:خروجی)، با فاصله" value={pts} on={setPts} required hint={hint} />
              <Field id="cal-ref" label="کالیبراتور مرجع / گواهی" value={cref} on={setCref} />
              <div><button className="btn" type="submit">ثبت کالیبراسیون</button></div>
            </form>
          )}
        </div>
      ) : null}

      {mayRegister && <Correct i={i} post={post} tags={tags} />}
    </div>
  );
}

function Correct({ i, post, tags }) {
  const [f, setF] = useState({ eqTagId: i.eqTagId || "", loopNo: i.loopNo || "", range: "", tolerancePct: i.tolerancePct ?? "" });
  return (
    <form className="card" style={{ padding: 12 }} onSubmit={async (e) => {
      e.preventDefault();
      const changed = (a, b) => String(a ?? "") !== String(b ?? "");
      await post({ kind: "correct", instrumentId: i.id,
        eqTagId: changed(f.eqTagId, i.eqTagId) ? f.eqTagId || null : undefined,
        loopNo: changed(f.loopNo, i.loopNo) ? f.loopNo : undefined,
        range: f.range ? f.range : undefined,
        tolerancePct: changed(f.tolerancePct, i.tolerancePct) ? f.tolerancePct : undefined });
    }}>
      <h2>اصلاح مشخصات ابزار</h2>
      <div className="grid2">
        <div className="field"><label htmlFor="ic-eq">تجهیز</label>
          <select id="ic-eq" value={f.eqTagId} onChange={(e) => setF({ ...f, eqTagId: e.target.value })}>
            <option value="">— هیچ —</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.tag_no}</option>)}
          </select>
          <span className="hint">مرحلهٔ «ابزار دقیق» همان تجهیز از این ابزار خوانده می‌شود</span>
        </div>
        <Field id="ic-loop" label="شمارهٔ لوپ" value={f.loopNo} on={(v) => setF({ ...f, loopNo: v })}
               hint="خالی = بدون لوپ (مثلاً PSV)؛ لوپ دستی با ورود مجدد لیست عوض نمی‌شود" />
        <Field id="ic-range" label={`رنج جدید (فعلی: ${i.range || "—"})`} value={f.range} on={(v) => setF({ ...f, range: v })}
               hint="مثلاً 0-25 bar" />
        <Field id="ic-tol" label="تلورانس دیتاشیت (% اسپن)" type="number" value={f.tolerancePct}
               on={(v) => setF({ ...f, tolerancePct: v })} hint="خالی = تلورانس پروژه" />
      </div>
      <div><button className="btn" type="submit">ذخیرهٔ اصلاح</button></div>
    </form>
  );
}

function Import({ post }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  return (
    <form className="card" onSubmit={async (e) => {
      e.preventDefault();
      const r = await post({ kind: "import", text });
      if (r) { setResult(r); setText(""); }
    }}>
      <h2>ورود لیست ابزار (Instrument Index)</h2>
      <p className="muted sm">
        ستون‌ها از سرتیتر شناخته می‌شوند: Tag No، Service، Type، Range، Loop، Equipment، Tolerance.
        نوع ابزار از حروف تگ با جدول ISA 5.1 خوانده می‌شود؛ اگر ستون Loop نباشد، لوپ با قاعدهٔ ISA ساخته و «(ISA)» علامت می‌خورد.
      </p>
      <div className="field">
        <label htmlFor="iimp">لیست ابزار</label>
        <textarea id="iimp" dir="ltr" rows={6} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder={"Tag No,Service,Type,Range,Equipment\nPT-1203A,P-1203A discharge,Smart transmitter,0-25 bar,P-1203A"} />
      </div>
      <div><button className="btn" type="submit" disabled={!text.trim()}>ورود</button></div>
      {result && (
        <div className="sm">
          <p className="pill ok">{result.imported} ابزار وارد شد</p>
          {result.unmatched.length > 0 && <p className="muted">بدون تجهیز: <span className="mono">{result.unmatched.join("، ")}</span></p>}
          {result.problems.map((p, k) => <p key={k} className="err">ردیف {p.line} {p.tagNo || ""}: {p.text}</p>)}
        </div>
      )}
    </form>
  );
}

function Field({ id, label, value, on, type = "text", required, hint }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} step={type === "number" ? "any" : undefined}
             dir={type === "text" ? "auto" : "ltr"} required={required}
             value={value} onChange={(e) => on(e.target.value)} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function Bar({ pct }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="bar"><i style={{ width: `${pct}%` }} /></span>
      <span className="mono sm">{pct}%</span>
    </span>
  );
}

const round = (n) => Math.round(n * 1000) / 1000;
const today = () => new Date().toISOString().slice(0, 10);
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
