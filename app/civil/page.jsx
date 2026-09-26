"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import { SPECIMENS, individualLimit } from "../../lib/civil/concrete.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import Tabs from "../../components/ui/Tabs";

/**
 * Civil: foundations from excavation to handover, and the concrete that
 * decides whether they may carry a machine.
 *
 * The board leads with what can start today, as on the piping page. Next to
 * it sits the strength verdict, because that is the step a site most wants
 * to tick early and the one this platform will not let it: it comes from the
 * pour card and the lab, judged by ACI 318, and a foundation whose class is
 * under a low-strength investigation is not handed over, however long ago it
 * was poured.
 */
const VERDICT = {
  accepted: ["ok", "پذیرفته"],
  provisional: ["", "موقت — کلاس کمتر از ۳ آزمون دارد"],
  low: ["bad", "زیر حد فردی"],
  investigate: ["bad", "بررسی مقاومت پایین"],
};

export default function CivilPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/civil?projectId=${id}`, []);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [msg, setMsg] = useState(null);
  const mayRecord = can({ role }, ACTIONS.ASSIGN_WELD);
  const mayRegister = can({ role }, ACTIONS.EDIT_EXTRACTION);

  const load = async (tagId) => setDetail(await call(`/api/civil?projectId=${projectId}&tagId=${tagId}`));

  async function expand(tagId) {
    if (open === tagId) { setOpen(null); setDetail(null); return; }
    setOpen(tagId); setDetail(null);
    try { await load(tagId); } catch (e) { setMsg(e.message); }
  }

  async function post(body) {
    setMsg(null);
    try {
      await call("/api/civil", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      if (open) await load(open);
      reload();
      return true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;

  const handed = data.foundations.filter((f) => f.ready).length;
  const held = data.foundations.filter((f) => f.strength?.note?.level === "bad").length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>سیویل</h1>
        <span className="sub">
          {data.foundations.length} فونداسیون · {handed} تحویل‌شده به مکانیک
          {held > 0 && ` · ${held} با مقاومت پذیرفته‌نشده`}
        </span>
      </div>

      <Tabs name="civil">
      {msg && <p className="err">{msg}</p>}

      {data.spec.curingDays === null && (
        <div className="card" data-keep style={{ borderColor: "rgba(224,163,62,.5)" }}>
          <h2 style={{ color: "var(--warn)" }}>مدت عمل‌آوری بتن ثبت نشده</h2>
          <p className="muted sm">
            مرحلهٔ عمل‌آوری هیچ فونداسیونی حکم نمی‌گیرد تا مدت آن در{" "}
            <a href="/project" className="cy">مشخصات پروژه ← مشخصات بتن</a> ثبت شود.
            این عدد تعیین می‌کند قالب کی باز شود؛ سامانه آن را فرض نمی‌کند.
          </p>
        </div>
      )}

      <div className="card">
        <h2>فونداسیون‌ها</h2>
        {data.foundations.length === 0 ? (
          <p className="empty-note">هنوز فونداسیونی ثبت نشده است.</p>
        ) : (
          <TableKit name="civil">
            <table className="dtable">
              <thead>
                <tr><th>فونداسیون</th><th>تجهیز / سازه</th><th>ساب‌سیستم</th><th>بتن مشخصات</th>
                    <th>پیشرفت</th><th>امروز می‌شود</th><th>مقاومت</th><th /></tr>
              </thead>
              <tbody>
                {data.foundations.map((f) => (
                  <FoundationRow key={f.id} f={f} open={open === f.id}
                    detail={open === f.id ? detail : null} onToggle={() => expand(f.id)}
                    mayRecord={mayRecord} post={post} />
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
        {mayRegister && <Fold title="ثبت فونداسیون جدید"><AddFoundation equipment={data.equipment} post={post} /></Fold>}
      </div>

      <Classes classes={data.classes} />
      </Tabs>
    </div>
  );
}

function FoundationRow({ f, open, detail, onToggle, mayRecord, post }) {
  const s = f.strength;
  return (
    <>
      <tr>
        <td className="mono">{f.tag_no}</td>
        <td className="mono">{f.carries_tag_no || "—"}</td>
        <td className="mono">{f.subsystem || "—"}</td>
        <td className="mono">{f.concrete_class} · {Number(f.fc_mpa)} MPa</td>
        <td><Bar pct={f.pct} /></td>
        <td className="sm">
          {f.ready ? <span className="pill ok">تحویل‌شده</span> : f.next.map((n) => n.title).join("، ") || "—"}
          {f.outOfOrder.length > 0 && <div><span className="pill bad">خارج از ترتیب: {f.outOfOrder.join("، ")}</span></div>}
        </td>
        <td>
          {!s || s.status === "not_started" && !s.note ? <span className="muted sm">—</span>
            : s.status === "done" ? <span className="pill ok">پذیرفته</span>
            : s.note?.level === "bad" ? <span className="pill bad">پذیرفته نشده</span>
            : <span className="pill">در انتظار نتیجه</span>}
        </td>
        <td><button className="btn ghost" style={{ padding: "4px 10px" }} onClick={onToggle}>
          {open ? "بستن" : "جزئیات"}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} style={{ background: "rgba(255,255,255,.02)" }}>
            {!detail ? <span className="muted sm">در حال بارگذاری…</span>
              : <FoundationDetail f={f} detail={detail} mayRecord={mayRecord} post={post} />}
          </td>
        </tr>
      )}
    </>
  );
}

function FoundationDetail({ f, detail, mayRecord, post }) {
  const steps = detail.status.steps || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))" }}>
        {steps.map((s) => (
          <div key={s.code} className="card" style={{ padding: 10, gap: 6,
            borderColor: s.note?.level === "bad" ? "rgba(226,87,76,.6)"
              : s.status === "done" ? "rgba(63,178,127,.5)"
              : s.blocked ? undefined : "rgba(67,160,180,.6)" }}>
            <span className="sm"><b>{s.derived ? "⚙ " : ""}{s.title}</b></span>
            <span className="sm muted">
              {s.status === "done" ? `انجام شد${s.doneAt ? " · " + fa(s.doneAt) : ""}`
                : s.note?.level === "bad" ? "رد — اصلاح لازم است"
                : s.status === "in_progress" ? "در حال انجام"
                : s.blocked ? `منتظر: ${s.waitingOn.map((w) => w.title).join("، ")}`
                : "آمادهٔ شروع"}
              {s.refNo ? ` · ${s.refNo}` : ""}
            </span>
            {s.note && <span className={"sm " + (s.note.level === "bad" ? "err" : "muted")}>{s.note.text}</span>}
            {s.outOfOrder && <span className="pill bad">خارج از ترتیب ثبت شده</span>}
            {mayRecord && !s.derived && s.status !== "done" && !s.blocked && (
              <button className="btn" style={{ padding: "4px 10px" }}
                      onClick={() => post({ kind: "activity", tagId: f.id, code: s.code, doneAt: today() })}>
                ثبت انجام (امروز)</button>
            )}
          </div>
        ))}
      </div>
      <p className="muted sm">
        مراحل ⚙ از پور کارت، مدت عمل‌آوری مشخصات و نتایج آزمایشگاه خوانده می‌شوند.
        {f.anchor_bolt_ref && <> نقشهٔ انکر بولت وندور: <span className="mono">{f.anchor_bolt_ref}</span>.</>}
      </p>

      <Pours f={f} pours={detail.pours} mayRecord={mayRecord} post={post} />
    </div>
  );
}

function Pours({ f, pours, mayRecord, post }) {
  const blank = { pourNo: "", pouredOn: today(), volumeM3: f.volume_m3 ?? "",
    concreteClass: "", fcMpa: "", ticketRef: "" };
  const [p, setP] = useState(blank);
  const [sp, setSp] = useState({ pourId: "", sampleNo: "", specimenType: "cyl150", ageDays: 28, results: "" });

  return (
    <div className="card" style={{ padding: 12 }}>
      <h2>بتن‌ریزی و نتایج</h2>
      {pours.length === 0 ? <p className="empty-note">هنوز بتن‌ریزی ثبت نشده است.</p> : (
        <TableKit name="civil">
          <table className="dtable">
            <thead><tr><th>پور کارت</th><th>تاریخ</th><th>حجم m³</th><th>کلاس تحویلی</th><th>نمونه‌ها</th></tr></thead>
            <tbody>
              {pours.map((x) => (
                <tr key={x.id}>
                  <td className="mono">{x.pour_no}</td>
                  <td className="mono">{fa(x.poured_on)}</td>
                  <td className="mono">{x.volume_m3 ?? "—"}</td>
                  <td className="mono">
                    {x.concrete_class} · {Number(x.fc_mpa)}
                    {(x.concrete_class !== f.concrete_class || Number(x.fc_mpa) !== Number(f.fc_mpa)) &&
                      <span className="pill bad" style={{ marginInlineStart: 6 }}>≠ مشخصات</span>}
                  </td>
                  <td className="mono sm">
                    {(x.specimens || []).length === 0 ? "—" : groupSpecimens(x.specimens)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}

      {mayRecord && (
        <>
          <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
            e.preventDefault();
            if (await post({ kind: "pour", tagId: f.id, ...p })) setP(blank);
          }}>
            <Field id="p-no" label="شمارهٔ پور کارت" value={p.pourNo} on={(v) => setP({ ...p, pourNo: v })} required />
            <Field id="p-on" label="تاریخ بتن‌ریزی" type="date" value={p.pouredOn} on={(v) => setP({ ...p, pouredOn: v })} required />
            <Field id="p-vol" label="حجم (m³)" type="number" value={p.volumeM3} on={(v) => setP({ ...p, volumeM3: v })} />
            <Field id="p-cls" label={`کلاس تحویلی (مشخصات: ${f.concrete_class})`} value={p.concreteClass}
                   on={(v) => setP({ ...p, concreteClass: v })} required
                   hint="از بارنامه، نه از مشخصات — مقایسه همین‌جا انجام می‌شود" />
            <Field id="p-fc" label={`f′c تحویلی MPa (مشخصات: ${Number(f.fc_mpa)})`} type="number"
                   value={p.fcMpa} on={(v) => setP({ ...p, fcMpa: v })} required />
            <div><button className="btn" type="submit">ثبت بتن‌ریزی</button></div>
          </form>

          {pours.length > 0 && (
            <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
              e.preventDefault();
              const results = sp.results.split(/[\s,،]+/).filter(Boolean).map(Number);
              if (await post({ kind: "specimens", ...sp, pourId: sp.pourId || pours[pours.length - 1].id,
                ageDays: Number(sp.ageDays), results })) setSp({ ...sp, results: "" });
            }}>
              <div className="field"><label htmlFor="s-pour">پور</label>
                <select id="s-pour" value={sp.pourId || pours[pours.length - 1].id}
                        onChange={(e) => setSp({ ...sp, pourId: e.target.value })}>
                  {pours.map((x) => <option key={x.id} value={x.id}>{x.pour_no}</option>)}
                </select></div>
              <Field id="s-no" label="شمارهٔ نمونه" value={sp.sampleNo} on={(v) => setSp({ ...sp, sampleNo: v })} required />
              <div className="field"><label htmlFor="s-type">نوع نمونه</label>
                <select id="s-type" value={sp.specimenType} onChange={(e) => setSp({ ...sp, specimenType: e.target.value })}>
                  {Object.entries(SPECIMENS).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
                </select></div>
              <Field id="s-age" label="سن (روز)" type="number" value={sp.ageDays} on={(v) => setSp({ ...sp, ageDays: v })} required />
              <Field id="s-res" label="نتایج شکست (MPa)، با فاصله" value={sp.results}
                     on={(v) => setSp({ ...sp, results: v })} required
                     hint={`هر استوانه جدا — یک آزمون دست‌کم ${SPECIMENS[sp.specimenType]?.minPerTest} نمونه`} />
              <div><button className="btn" type="submit">ثبت نتایج</button></div>
            </form>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Each class judged as a whole, test by test in the order they were made.
 *
 * This is where the three-test average is visible: a foundation can be held
 * not because its own test failed but because it sits in a window of its
 * class whose average did, and the table has to show that or the hold looks
 * arbitrary.
 */
function Classes({ classes }) {
  if (!classes.length) return null;
  return (
    <div className="card">
      <h2>پذیرش بتن به تفکیک کلاس (ACI 318 §26.12.3.1)</h2>
      <p className="muted sm">
        (الف) میانگین هر سه آزمون متوالی یک کلاس ≥ f′c · (ب) هیچ آزمونی بیش از
        3.5 MPa (برای f′c ≤ 35) یا 10٪ (برای f′c &gt; 35) زیر f′c نباشد. آزمون = میانگین
        دست‌کم دو استوانهٔ ۱۵۰×۳۰۰ در سن مشخص‌شده. نتیجهٔ مکعبی با این معیار سنجیده نمی‌شود.
      </p>
      {classes.map((c) => (
        <div key={`${c.concreteClass}-${c.fcMpa}`} style={{ marginTop: 8 }}>
          <div className="sm" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <b className="mono">{c.concreteClass}</b>
            <span className="muted">f′c {c.fcMpa} MPa · حد فردی {individualLimit(c.fcMpa)} MPa · {c.fcAgeDays} روزه</span>
            {c.satisfactory === true && <span className="pill ok">سطح مقاومت کلاس رضایت‌بخش</span>}
            {c.satisfactory === false && <span className="pill bad">سطح مقاومت کلاس رضایت‌بخش نیست</span>}
            {c.satisfactory === null && <span className="pill">کمتر از سه آزمون — هنوز قابل قضاوت نیست</span>}
          </div>
          <TableKit name="civil">
            <table className="dtable">
              <thead><tr><th>پور / نمونه</th><th>تاریخ</th><th>آزمون MPa</th><th>میانگین سه‌تایی</th><th>حکم</th></tr></thead>
              <tbody>
                {c.tests.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.id}</td>
                    <td className="mono">{fa(t.at)}</td>
                    <td className="mono">{t.mpa} <span className="muted">({t.n} نمونه)</span></td>
                    <td className="mono">{t.window ?? "—"}</td>
                    <td><span className={"pill " + VERDICT[t.verdict][0]}>{VERDICT[t.verdict][1]}</span></td>
                  </tr>
                ))}
                {c.rejected.map((r) => (
                  <tr key={`${r.pourNo}-${r.sampleNo}-rej`}>
                    <td className="mono">{r.pourNo}/{r.sampleNo}</td>
                    <td className="mono">{fa(r.at)}</td>
                    <td colSpan={2} className="sm err">{r.reason}</td>
                    <td><span className="pill bad">آزمون معتبر نیست</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableKit>
        </div>
      ))}
    </div>
  );
}

function AddFoundation({ equipment, post }) {
  const blank = { tagNo: "", carriesTagId: "", concreteClass: "C30", fcMpa: 30, volumeM3: "", anchorBoltRef: "" };
  const [f, setF] = useState(blank);
  return (
    <form className="card" onSubmit={async (e) => {
      e.preventDefault();
      if (await post({ kind: "foundation", ...f, carriesTagId: f.carriesTagId || null,
        volumeM3: f.volumeM3 === "" ? null : Number(f.volumeM3), fcMpa: Number(f.fcMpa) })) setF(blank);
    }}>
      <h2>فونداسیون جدید</h2>
      <div className="grid2">
        <Field id="f-no" label="شمارهٔ فونداسیون" value={f.tagNo} on={(v) => setF({ ...f, tagNo: v })} required />
        <div className="field"><label htmlFor="f-carries">تجهیز یا سازه‌ای که روی آن می‌نشیند</label>
          <select id="f-carries" value={f.carriesTagId} onChange={(e) => setF({ ...f, carriesTagId: e.target.value })}>
            <option value="">— هیچ —</option>
            {equipment.map((t) => <option key={t.id} value={t.id}>{t.tag_no} — {t.description || ""}</option>)}
          </select>
          <span className="hint">مرحلهٔ «فونداسیون» تجهیز یا سازهٔ انتخاب‌شده از همین‌جا خوانده می‌شود.</span>
        </div>
        <Field id="f-cls" label="کلاس بتن مشخصات" value={f.concreteClass} on={(v) => setF({ ...f, concreteClass: v })} required />
        <Field id="f-fc" label="f′c (MPa، استوانه‌ای)" type="number" value={f.fcMpa} on={(v) => setF({ ...f, fcMpa: v })} required />
        <Field id="f-vol" label="حجم طرح (m³)" type="number" value={f.volumeM3} on={(v) => setF({ ...f, volumeM3: v })} />
        <Field id="f-ab" label="نقشهٔ انکر بولت وندور" value={f.anchorBoltRef} on={(v) => setF({ ...f, anchorBoltRef: v })}
               hint="نسخهٔ certified، نه preliminary" />
      </div>
      <div><button className="btn" type="submit" disabled={!f.tagNo}>ثبت فونداسیون</button></div>
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

function groupSpecimens(specimens) {
  const g = new Map();
  for (const s of specimens) {
    const k = `${s.sample_no} · ${s.age_days}d`;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(Number(s.mpa));
  }
  return [...g.entries()].map(([k, v]) => `${k}: ${v.join(" / ")}`).join(" — ");
}

const today = () => new Date().toISOString().slice(0, 10);
const fa = (d) => new Date(d).toLocaleDateString("fa-IR");
