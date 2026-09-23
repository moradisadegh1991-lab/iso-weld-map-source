"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";

/**
 * Electrical: the cable schedule, each cable from route to energisation, and
 * the insulation test that decides whether it may be energised.
 *
 * The schedule is read by rule (lib/electrical/cable.mjs); what the rules
 * cannot read — a cable whose To names no tag, a construction or rating the
 * parser does not recognise — is shown as a job for a person, never filled
 * with a default. The IR column cannot be ticked: the recorded readings and
 * IEC 60364-6 answer it.
 */
export default function ElectricalPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/electrical?projectId=${id}`, []);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [msg, setMsg] = useState(null);
  const [q, setQ] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const mayRecord = can({ role }, ACTIONS.ASSIGN_WELD);
  const mayRegister = can({ role }, ACTIONS.EDIT_EXTRACTION);

  const load = async (id) => setDetail(await call(`/api/electrical?projectId=${projectId}&cableId=${id}`));
  async function expand(id) {
    if (open === id) { setOpen(null); setDetail(null); return; }
    setOpen(id); setDetail(null);
    try { await load(id); } catch (e) { setMsg(e.message); }
  }
  async function post(body) {
    setMsg(null);
    try {
      const r = await call("/api/electrical", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      if (open) await load(open);
      reload();
      return r || true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;

  const cables = data.cables;
  const issue = (c) => !c.toTagNo || !c.voltageClass || !c.cores || c.ir.note?.level === "bad";
  const shown = cables.filter((c) => (!onlyIssues || issue(c))
    && (!q || `${c.cableNo} ${c.from} ${c.to} ${c.toTagNo || ""}`.toLowerCase().includes(q.toLowerCase())));
  const ready = cables.filter((c) => c.ready).length;
  const irBad = cables.filter((c) => c.ir.note?.level === "bad").length;
  const noTag = cables.filter((c) => !c.toTagNo).length;
  const noClass = cables.filter((c) => !c.voltageClass || !c.cores).length;
  const hasMv = cables.some((c) => c.voltageClass === "MV");

  return (
    <div className="page">
      <div className="pagehead">
        <h1>برق</h1>
        <span className="sub">
          {cables.length} کابل · {ready} آماده برای برق‌دار شدن
          {irBad > 0 && ` · ${irBad} با IR ردشده`}
          {noTag > 0 && ` · ${noTag} بدون تجهیز`}
          {noClass > 0 && ` · ${noClass} با مشخصات ناخوانا`}
        </span>
      </div>

      {msg && <p className="err">{msg}</p>}

      {(data.spec.lvSystemVoltageV === null || (hasMv && (data.spec.mvTestVoltageV === null || data.spec.mvMinMohm === null))) && (
        <div className="card" style={{ borderColor: "rgba(224,163,62,.5)" }}>
          <h2 style={{ color: "var(--warn)" }}>معیار تست عایقی کامل نیست</h2>
          <p className="muted sm">
            {data.spec.lvSystemVoltageV === null && "ولتاژ نامی مدارهای فشار ضعیف ثبت نشده — کابل LV که لیست کابل ولتاژ مدارش را نگفته، حکم IR نمی‌گیرد. "}
            {hasMv && (data.spec.mvTestVoltageV === null || data.spec.mvMinMohm === null) && "معیار IR کابل فشار متوسط ثبت نشده — IEC 60364-6 آن را پوشش نمی‌دهد. "}
            در <a href="/project" className="cy">مشخصات پروژه ← برق</a> ثبت کنید.
          </p>
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ marginInlineEnd: "auto" }}>کابل‌ها</h2>
          <input placeholder="جستجوی کابل، مبدأ، مقصد…" value={q} onChange={(e) => setQ(e.target.value)}
                 style={{ maxWidth: 260 }} aria-label="جستجو" />
          <label className="sm" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
            فقط موارد نیازمند اقدام
          </label>
        </div>
        {cables.length === 0 ? <p className="empty-note">هنوز لیست کابلی وارد نشده است.</p> : (
          <div className="wrap">
            <table className="dtable">
              <thead>
                <tr><th>کابل</th><th>از → به</th><th>تجهیز</th><th>مشخصات</th><th>رده</th><th>طول m</th>
                    <th>پیشرفت</th><th>امروز می‌شود</th><th>IR</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <CableRow key={c.id} c={c} open={open === c.id} detail={open === c.id ? detail : null}
                    onToggle={() => expand(c.id)} mayRecord={mayRecord} mayRegister={mayRegister}
                    post={post} tags={data.tags} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {mayRegister && <Import post={post} />}
    </div>
  );
}

function CableRow({ c, open, detail, onToggle, mayRecord, mayRegister, post, tags }) {
  return (
    <>
      <tr>
        <td className="mono">{c.cableNo}</td>
        <td className="sm">{c.from || "—"} → {c.to || "—"}</td>
        <td className="mono">{c.toTagNo || <span className="pill bad">نامشخص</span>}</td>
        <td className="mono sm">{c.cores ? `${c.cores}×${c.sizeMm2}` : <span className="pill bad">ناخوانا</span>}</td>
        <td className="mono sm">{c.voltageClass ? `${c.voltageClass} · ${c.rating}` : <span className="pill bad">نامشخص</span>}</td>
        <td className="mono">{c.lengthM ?? "—"}</td>
        <td><Bar pct={c.pct} /></td>
        <td className="sm">
          {c.ready ? <span className="pill ok">آماده</span> : c.next.map((n) => n.title).join("، ") || "—"}
          {c.outOfOrder.length > 0 && <div><span className="pill bad">خارج از ترتیب: {c.outOfOrder.join("، ")}</span></div>}
        </td>
        <td>{c.ir.status === "done" ? <span className="pill ok">پذیرفته</span>
          : c.ir.note?.level === "bad" ? <span className="pill bad">رد</span>
          : c.ir.note?.level === "warn" ? <span className="pill">بدون حکم</span>
          : <span className="muted sm">—</span>}</td>
        <td><button className="btn ghost" style={{ padding: "4px 10px" }} onClick={onToggle}>
          {open ? "بستن" : "جزئیات"}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10} style={{ background: "rgba(255,255,255,.02)" }}>
            {!detail ? <span className="muted sm">در حال بارگذاری…</span>
              : <Detail c={c} s={detail.status} mayRecord={mayRecord} mayRegister={mayRegister} post={post} tags={tags} />}
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ c, s, mayRecord, mayRegister, post, tags }) {
  const req = s.ir.requirement;
  const [t, setT] = useState({ testVoltageV: req.testV || "", readings: "", testedOn: today(), instrumentRef: "" });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))" }}>
        {s.steps.map((x) => (
          <div key={x.code} className="card" style={{ padding: 10, gap: 6,
            borderColor: x.note?.level === "bad" ? "rgba(226,87,76,.6)"
              : x.status === "done" ? "rgba(63,178,127,.5)"
              : x.blocked ? undefined : "rgba(67,160,180,.6)" }}>
            <span className="sm"><b>{x.derived && !x.na ? "⚙ " : ""}{x.title}</b></span>
            <span className="sm muted">
              {x.na ? "برای کابل فشار ضعیف کاربرد ندارد"
                : x.status === "done" ? `انجام شد${x.doneAt ? " · " + fa(x.doneAt) : ""}`
                : x.note?.level === "bad" ? "رد — اصلاح لازم است"
                : x.derived && x.note?.level === "warn" ? "بدون حکم"
                : x.blocked ? `منتظر: ${x.waitingOn.map((w) => w.title).join("، ")}`
                : "آمادهٔ شروع"}
            </span>
            {x.note && <span className={"sm " + (x.note.level === "bad" ? "err" : "muted")}>{x.note.text}</span>}
            {x.outOfOrder && <span className="pill bad">خارج از ترتیب ثبت شده</span>}
            {mayRecord && !x.derived && !x.na && x.status !== "done" && !x.blocked && (
              <button className="btn" style={{ padding: "4px 10px" }}
                      onClick={() => post({ kind: "activity", cableId: c.id, code: x.code, doneAt: today() })}>
                ثبت انجام (امروز)</button>
            )}
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 12 }}>
        <h2>تست مقاومت عایقی {req.cite && <span className="muted sm">— {req.cite}</span>}</h2>
        <p className="muted sm">
          {req.reason ? req.reason
            : `ولتاژ تست ≥ ${req.testV} V DC · حداقل ${req.minMohm} MΩ · ${c.cores ?? "?"} قرائت (هر رشته). آخرین تست حکم می‌گیرد.`}
        </p>
        {s.ir.tests.length > 0 && (
          <div className="wrap">
            <table className="dtable">
              <thead><tr><th>تاریخ</th><th>ولتاژ تست V</th><th>قرائت‌ها MΩ</th><th>دستگاه</th></tr></thead>
              <tbody>
                {s.ir.tests.map((x, i) => (
                  <tr key={i}>
                    <td className="mono">{fa(x.tested_on)}</td>
                    <td className="mono">{x.test_voltage_v}</td>
                    <td className="mono">{(x.readings || []).join(" / ")}</td>
                    <td className="mono">{x.instrument_ref || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {mayRecord && (
          <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
            e.preventDefault();
            if (await post({ kind: "ir", cableId: c.id, ...t })) setT({ ...t, readings: "" });
          }}>
            <Field id="ir-v" label="ولتاژ تست (V DC)" type="number" value={t.testVoltageV}
                   on={(v) => setT({ ...t, testVoltageV: v })} required />
            <Field id="ir-r" label="قرائت‌ها (MΩ)، با فاصله" value={t.readings} on={(v) => setT({ ...t, readings: v })}
                   required hint={`${c.cores ?? "?"} قرائت؛ «>2000» همان‌طور که دستگاه نشان داد`} />
            <Field id="ir-on" label="تاریخ" type="date" value={t.testedOn} on={(v) => setT({ ...t, testedOn: v })} required />
            <Field id="ir-inst" label="دستگاه / شمارهٔ کالیبراسیون" value={t.instrumentRef}
                   on={(v) => setT({ ...t, instrumentRef: v })} />
            <div><button className="btn" type="submit">ثبت تست</button></div>
          </form>
        )}
      </div>

      {mayRegister && <Correct c={c} post={post} tags={tags} />}
    </div>
  );
}

/** What the schedule could not say, said by a person. */
function Correct({ c, post, tags }) {
  const [f, setF] = useState({ toTagId: c.toTagId || "", spec: c.spec || "", rating: c.rating || "",
    systemVoltageV: c.systemVoltageV ?? "" });
  return (
    <form className="card" style={{ padding: 12 }} onSubmit={async (e) => {
      e.preventDefault();
      // Only what changed: re-sending an unreadable construction would refuse
      // a correction that was only about the tag.
      const changed = (a, b) => String(a ?? "") !== String(b ?? "");
      await post({ kind: "correct", cableId: c.id,
        toTagId: changed(f.toTagId, c.toTagId) ? f.toTagId || null : undefined,
        spec: changed(f.spec, c.spec) && f.spec ? f.spec : undefined,
        rating: changed(f.rating, c.rating) && f.rating ? f.rating : undefined,
        systemVoltageV: changed(f.systemVoltageV, c.systemVoltageV) ? f.systemVoltageV : undefined });
    }}>
      <h2>اصلاح مشخصات کابل</h2>
      <div className="grid2">
        <div className="field"><label htmlFor="cr-tag">تجهیزی که تغذیه می‌کند</label>
          <select id="cr-tag" value={f.toTagId} onChange={(e) => setF({ ...f, toTagId: e.target.value })}>
            <option value="">— هیچ —</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.tag_no}</option>)}
          </select>
          <span className="hint">مرحلهٔ «ترمینیشن برق» همان تجهیز از این کابل خوانده می‌شود</span>
        </div>
        <Field id="cr-spec" label="ساختار (مثلاً 3Cx95 XLPE/SWA)" value={f.spec} on={(v) => setF({ ...f, spec: v })} />
        <Field id="cr-rating" label="ردهٔ ولتاژ (مثلاً 0.6/1kV)" value={f.rating} on={(v) => setF({ ...f, rating: v })} />
        <Field id="cr-v" label="ولتاژ نامی مدار (V)" type="number" value={f.systemVoltageV}
               on={(v) => setF({ ...f, systemVoltageV: v })} hint="خالی = ولتاژ فشار ضعیف پروژه" />
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
      <h2>ورود لیست کابل</h2>
      <p className="muted sm">
        از اکسل کپی کنید (Tab) یا CSV بچسبانید. ستون‌ها از روی سرتیتر شناخته می‌شوند: Cable No، From، To،
        Type، Voltage، System Voltage، Length. کابل موجود به‌روز می‌شود و اصلاح دستی شما (تجهیز، ولتاژ مدار) پاک نمی‌شود.
      </p>
      <div className="field">
        <label htmlFor="imp">لیست کابل</label>
        <textarea id="imp" dir="ltr" rows={6} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder={"Cable No,From,To,Cable Type,Voltage,Length (m)\nEC-001,MCC-12,P-1203A,3Cx35 XLPE/SWA,0.6/1kV,85"} />
      </div>
      <div><button className="btn" type="submit" disabled={!text.trim()}>ورود</button></div>
      {result && (
        <div className="sm">
          <p className="pill ok">{result.imported} کابل وارد شد</p>
          {result.unmatched.length > 0 && <p className="muted">بدون تجهیز (با «اصلاح» مشخص کنید): <span className="mono">{result.unmatched.join("، ")}</span></p>}
          {result.problems.map((p, i) => <p key={i} className="err">ردیف {p.line} {p.cableNo || ""}: {p.text}</p>)}
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

const today = () => new Date().toISOString().slice(0, 10);
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
