"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import { newOp } from "../../lib/field/ops.mjs";
import { PHOTO_STAGES } from "../../lib/quality/photo.mjs";
import { compressPhoto, blobToBase64 } from "../../lib/client/photo.mjs";
import PhotoStrip from "../../components/quality/PhotoStrip";

/**
 * Punch list and NCRs, and what they hold against each subsystem's MC.
 *
 * The screen offers only the next legal step for each record; the rules
 * behind it (verifier ≠ clearer, a concession is an engineering signature,
 * no close without a root cause) are the engine's, and the refusal text
 * comes back from it unchanged.
 */
const PUNCH_STATE = { open: ["", "باز"], overdue: ["bad", "معوق"], cleared: ["warn", "رفع‌شده — منتظر تأیید"], closed: ["ok", "بسته"] };
const NCR_STATUS = { open: ["bad", "باز"], proposed: ["warn", "دیسپوزیشن پیشنهاد شد"], approved: ["warn", "تأیید شد — در اجرا"],
  implemented: ["warn", "اجرا شد — منتظر بستن"], closed: ["ok", "بسته"] };
const EVENT_FA = { raised: "ثبت", cleared: "رفع", rejected: "برگشت", closed: "بستن", recategorised: "تغییر دسته",
  propose: "پیشنهاد دیسپوزیشن", approve: "تأیید", rejectDisposition: "رد دیسپوزیشن", implement: "اجرا", close: "بستن" };

export default function QualityPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/quality?projectId=${id}`, []);
  const [tab, setTab] = useState("punch");
  const [msg, setMsg] = useState(null);
  const may = can({ role }, ACTIONS.RECORD_QUALITY);

  async function post(body) {
    setMsg(null);
    try {
      await call("/api/quality", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const openPunch = data.punch.filter((p) => p.status !== "closed");
  const openA = openPunch.filter((p) => p.category === "A").length;
  const overdue = data.punch.filter((p) => p.state === "overdue").length;
  const openNcr = data.ncrs.filter((n) => n.status !== "closed");
  const esc2 = openNcr.filter((n) => n.escalation.level === 2).length;
  const esc1 = openNcr.filter((n) => n.escalation.level === 1).length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>Punch و NCR</h1>
        <span className="sub">{openPunch.length} آیتم Punch باز ({openA} دستهٔ A) · {openNcr.length} NCR باز</span>
      </div>
      {msg && <p className="err">{msg}</p>}

      <div className="kpis">
        <Kpi v={openA} l="Punch A باز" b="مانع MC" tone={openA ? "bad" : "ok"} />
        <Kpi v={openPunch.length - openA} l="Punch B/C باز" />
        <Kpi v={overdue} l="Punch معوق" tone={overdue ? "warn" : ""} />
        <Kpi v={openNcr.length} l="NCR باز" tone={openNcr.length ? "warn" : "ok"} />
        <Kpi v={esc1} l="NCR معوق" b="ارجاع به پیمانکار" tone={esc1 ? "warn" : ""} />
        <Kpi v={data.escalationDays ? esc2 : "—"} l="NCR تشدیدشده" tone={esc2 ? "bad" : ""}
             b={data.escalationDays ? `بیش از ${data.escalationDays} روز — مدیر پروژه` : "مهلت تشدید تعیین نشده"} />
      </div>

      <div className="card">
        <h2>آنچه هر ساب‌سیستم را نگه داشته</h2>
        <div className="wrap">
          <table className="dtable">
            <thead><tr><th>ساب‌سیستم</th><th>Punch A (مانع MC)</th><th>A+B (مانع RFSU)</th><th>C (به تحویل)</th><th>NCR باز</th></tr></thead>
            <tbody>
              {data.subsystems.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.code}{s.name && <span className="muted sm"> {s.name}</span>}</td>
                  <td className={`mono ${s.mc ? "bad" : "ok"}`}>{s.mc}</td>
                  <td className={`mono ${s.rfsu ? "warn" : "ok"}`}>{s.rfsu}</td>
                  <td className="mono">{s.carried}</td>
                  <td className={`mono ${s.ncr ? "bad" : "ok"}`}>{s.ncr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tabs" role="tablist" style={{ display: "flex", gap: 8 }}>
        <button role="tab" aria-selected={tab === "punch"} className={`btn ${tab === "punch" ? "" : "ghost"}`} onClick={() => setTab("punch")}>Punch list</button>
        <button role="tab" aria-selected={tab === "ncr"} className={`btn ${tab === "ncr" ? "" : "ghost"}`} onClick={() => setTab("ncr")}>NCR</button>
      </div>

      {tab === "punch" ? <PunchTab data={data} post={post} may={may} /> : <NcrTab data={data} post={post} may={may} role={role} />}
    </div>
  );
}

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}

// ── punch ────────────────────────────────────────────────────────────────

function PunchTab({ data, post, may }) {
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("live");
  const rows = data.punch.filter((p) => filter === "all" || p.status !== "closed");
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2>Punch list</h2>
        <div className="field" style={{ margin: 0 }}>
          <select aria-label="فیلتر" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="live">فقط باز</option><option value="all">همه</option>
          </select>
        </div>
      </div>
      {rows.length === 0 ? <p className="empty-note">آیتمی نیست.</p> : (
        <div className="wrap">
          <table className="dtable">
            <thead><tr><th>شماره</th><th>دسته</th><th>شرح</th><th>تگ</th><th>پیمانکار</th><th>مهلت</th><th>وضعیت</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => {
                const [tone, label] = PUNCH_STATE[p.state];
                return [
                  <tr key={p.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{p.punch_no}</td>
                    <td><span className={`pill ${p.category === "A" ? "bad" : p.category === "B" ? "warn" : ""}`}>{p.category}</span>
                      {p.recategorised > 0 && <div className="muted sm" title="دسته تغییر کرده — تاریخچه را ببینید">↺ {p.recategorised}</div>}</td>
                    <td>{p.description}{p.clear_note && <div className="muted sm">رفع: {p.clear_note} — {p.cleared_by_name || "?"}</div>}</td>
                    <td className="mono">{p.tag_no ? <a href={`/asset?tag=${encodeURIComponent(p.tag_no)}`}>{p.tag_no}</a> : "—"}</td>
                    <td className="mono">{p.contractor_code || "—"}</td>
                    <td className="mono sm">{p.due_on ? fa(p.due_on) : "—"}</td>
                    <td><span className={`pill ${tone}`}>{label}</span></td>
                    <td><button className="btn ghost" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? "بستن" : "اقدام"}</button></td>
                  </tr>,
                  open === p.id && (
                    <tr key={p.id + "-x"}><td colSpan={8}>
                      <PunchPanel p={p} post={post} may={may} categories={data.categories} />
                    </td></tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {may && <PunchForm data={data} post={post} />}
    </div>
  );
}

function PunchPanel({ p, post, may, categories }) {
  const { projectId, call } = usePlatform();
  const [note, setNote] = useState("");
  const [cat, setCat] = useState(p.category);
  const [photos, setPhotos] = useState([]);
  const [stage, setStage] = useState(p.status === "open" ? "raised" : "cleared");
  const [shot, setShot] = useState(null);           // null | "busy" | error text
  const [n, setN] = useState(0);
  const act = async (action, extra = {}) => { if (await post({ kind: "punch-action", punchId: p.id, action, note, ...extra })) setNote(""); };
  // A photo from the desk goes the way a phone's does: one operation, with
  // its own id, through the same sync — so a double click is one photo.
  async function upload(file) {
    if (!file) return;
    setShot("busy");
    try {
      const blob = await compressPhoto(file);
      const op = newOp("punch_photo", { punchId: p.id, stage, takenOn: today(), data: await blobToBase64(blob) }, { projectId });
      const { results: [r] } = await call("/api/field", { method: "POST", body: JSON.stringify({ projectId, ops: [op] }) });
      if (r.status !== "applied") throw new Error(r.error || "ثبت نشد");
      setShot(null); setN(n + 1);
    } catch (e) { setShot(e.message); }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <History url={`punchId=${p.id}`} stamp={`${p.status}${p.category}${p.cleared_on}${n}`} onLoad={(r) => setPhotos(r.photos || [])} />
      <PhotoStrip projectId={projectId} photos={photos} />
      {may && p.status !== "closed" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <div className="field"><label htmlFor={`ps-${p.id}`}>مرحلهٔ عکس</label>
            <select id={`ps-${p.id}`} value={stage} onChange={(e) => setStage(e.target.value)}>
              {Object.entries(PHOTO_STAGES).filter(([k]) => k !== "cleared" || p.status !== "open")
                .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <label className="btn ghost photo-btn">{shot === "busy" ? "در حال ارسال…" : "افزودن عکس"}
            <input type="file" accept="image/*" aria-label="افزودن عکس" disabled={shot === "busy"}
                   onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; upload(f); }} /></label>
          {shot && shot !== "busy" && <span className="err sm">{shot}</span>}
        </div>
      )}
      {may && p.status !== "closed" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <div className="field" style={{ flex: "1 1 260px" }}><label htmlFor={`pn-${p.id}`}>یادداشت</label>
            <input id={`pn-${p.id}`} value={note} onChange={(e) => setNote(e.target.value)}
                   placeholder={p.status === "open" ? "چه کاری انجام شد" : "دلیل"} /></div>
          {p.status === "open" && <button className="btn" onClick={() => act("clear")}>رفع شد</button>}
          {p.status === "cleared" && <>
            <button className="btn" onClick={() => act("verify")}>تأیید و بستن</button>
            <button className="btn ghost" onClick={() => act("reject")}>رفع پذیرفته نشد</button>
          </>}
          <div className="field"><label htmlFor={`pc-${p.id}`}>دستهٔ جدید</label>
            <select id={`pc-${p.id}`} value={cat} onChange={(e) => setCat(e.target.value)}>
              {Object.keys(categories).map((c) => <option key={c} value={c}>{c}</option>)}
            </select></div>
          <button className="btn ghost" onClick={() => act("recategorise", { category: cat })}>تغییر دسته</button>
        </div>
      )}
    </div>
  );
}

function PunchForm({ data, post }) {
  const blank = { subsystemId: "", tagId: "", category: "A", description: "", location: "", actionContractorId: "", raisedOn: today(), dueOn: "" };
  const [f, setF] = useState(blank);
  const tags = data.tags.filter((t) => !f.subsystemId || t.subsystem_id === f.subsystemId);
  return (
    <form style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "punch", ...f })) setF({ ...blank, subsystemId: f.subsystemId }); }}>
      <h2>ثبت آیتم Punch</h2>
      <div className="grid2">
        <Select id="pf-s" label="ساب‌سیستم" value={f.subsystemId} on={(v) => setF({ ...f, subsystemId: v, tagId: "" })}
                opts={data.subsystems.map((s) => [s.id, s.code])} blank="از روی تگ" />
        <Select id="pf-t" label="تگ" value={f.tagId} on={(v) => setF({ ...f, tagId: v })} opts={tags.map((t) => [t.id, t.tag_no])} blank="—" />
        <Select id="pf-c" label="دسته" value={f.category} on={(v) => setF({ ...f, category: v })}
                opts={Object.entries(data.categories).map(([k, t]) => [k, `${k} — ${t}`])} />
        <Select id="pf-k" label="پیمانکار مسئول" value={f.actionContractorId} on={(v) => setF({ ...f, actionContractorId: v })}
                opts={data.contractors.map((c) => [c.id, c.code])} blank="—" />
        <Field id="pf-d" label="شرح" value={f.description} on={(v) => setF({ ...f, description: v })} required />
        <Field id="pf-l" label="محل" value={f.location} on={(v) => setF({ ...f, location: v })} />
        <Field id="pf-r" label="تاریخ ثبت" type="date" value={f.raisedOn} on={(v) => setF({ ...f, raisedOn: v })} required />
        <Field id="pf-u" label="مهلت رفع" type="date" value={f.dueOn} on={(v) => setF({ ...f, dueOn: v })} />
      </div>
      <div><button className="btn" type="submit">ثبت</button></div>
    </form>
  );
}

// ── NCR ──────────────────────────────────────────────────────────────────

function NcrTab({ data, post, may, role }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="card">
      <h2>عدم انطباق (NCR)</h2>
      {data.ncrs.length === 0 ? <p className="empty-note">NCR ثبت نشده است.</p> : (
        <div className="wrap">
          <table className="dtable">
            <thead><tr><th>شماره</th><th>عنوان</th><th>شدت</th><th>ساب‌سیستم / تگ</th><th>پیمانکار</th><th>دیسپوزیشن</th><th>مهلت پاسخ</th><th>وضعیت</th><th /></tr></thead>
            <tbody>
              {data.ncrs.map((n) => {
                const [tone, label] = NCR_STATUS[n.status];
                const e = n.escalation;
                return [
                  <tr key={n.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{n.ncr_no}</td>
                    <td>{n.title}{n.requirement && <div className="muted sm">الزام: {n.requirement}</div>}</td>
                    <td><span className={`pill ${n.severity === "major" ? "bad" : "warn"}`}>{data.severities[n.severity]}</span></td>
                    <td className="mono sm">{n.subsystem_code || "—"}{n.tag_no && <> · <a href={`/asset?tag=${encodeURIComponent(n.tag_no)}`}>{n.tag_no}</a></>}</td>
                    <td className="mono">{n.contractor_code || "—"}</td>
                    <td className="sm">{n.disposition ? data.dispositions[n.disposition] : "—"}</td>
                    <td className="mono sm">{n.response_due ? fa(n.response_due) : "—"}
                      {e.level > 0 && <div><span className={`pill ${e.level === 2 ? "bad" : "warn"}`}>
                        {e.daysOverdue} روز تأخیر{e.level === 2 ? " — مدیر پروژه" : ""}{e.capped ? " (مهلت تشدید؟)" : ""}</span></div>}</td>
                    <td><span className={`pill ${tone}`}>{label}</span></td>
                    <td><button className="btn ghost" onClick={() => setOpen(open === n.id ? null : n.id)}>{open === n.id ? "بستن" : "اقدام"}</button></td>
                  </tr>,
                  open === n.id && (
                    <tr key={n.id + "-x"}><td colSpan={9}>
                      <NcrPanel n={n} data={data} post={post} may={may} role={role} />
                    </td></tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {may && <NcrForm data={data} post={post} />}
    </div>
  );
}

function NcrPanel({ n, data, post, may, role }) {
  const [f, setF] = useState({ disposition: "rework", dispositionNote: "", note: "", rootCause: n.root_cause || "", correctiveAction: n.corrective_action || "" });
  const act = (action) => post({ kind: "ncr-action", ncrId: n.id, action, ...f });
  const concession = ["use_as_is", "repair"].includes(n.disposition);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p className="sm">{n.description}</p>
      {n.disposition_note && <p className="sm"><b>دیسپوزیشن:</b> {n.disposition_note} — {n.proposed_by_name || "?"}{n.approved_by_name && `، تأیید: ${n.approved_by_name}`}</p>}
      {(n.root_cause || n.corrective_action) && <p className="sm"><b>علت ریشه‌ای:</b> {n.root_cause || "—"} · <b>اقدام اصلاحی:</b> {n.corrective_action || "—"}</p>}
      <History url={`ncrId=${n.id}`} stamp={`${n.status}${n.disposition}`} />
      {may && n.status !== "closed" && (
        <div className="grid2">
          {n.status === "open" && <>
            <Select id={`nd-${n.id}`} label="دیسپوزیشن" value={f.disposition} on={(v) => setF({ ...f, disposition: v })}
                    opts={Object.entries(data.dispositions)} />
            <Field id={`ndn-${n.id}`} label="شرح دیسپوزیشن" value={f.dispositionNote} on={(v) => setF({ ...f, dispositionNote: v })} />
          </>}
          {["proposed", "approved"].includes(n.status) &&
            <Field id={`nn-${n.id}`} label={n.status === "proposed" ? "دلیل (در صورت رد)" : "شرح اجرا"} value={f.note}
                   on={(v) => setF({ ...f, note: v })} />}
          {n.status !== "proposed" && <>
            <Field id={`nr-${n.id}`} label="علت ریشه‌ای" value={f.rootCause} on={(v) => setF({ ...f, rootCause: v })} />
            <Field id={`nc-${n.id}`} label="اقدام اصلاحی (جلوگیری از تکرار)" value={f.correctiveAction} on={(v) => setF({ ...f, correctiveAction: v })} />
          </>}
          <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            {n.status === "open" && <button className="btn" onClick={() => act("propose")}>پیشنهاد دیسپوزیشن</button>}
            {n.status === "proposed" && <>
              <button className="btn" onClick={() => act("approve")} title={concession && !can({ role }, ACTIONS.APPROVE_CONCESSION) ? "ارفاق — امضای مهندسی لازم است" : ""}>تأیید</button>
              <button className="btn ghost" onClick={() => act("rejectDisposition")}>رد دیسپوزیشن</button>
            </>}
            {n.status === "approved" && <button className="btn" onClick={() => act("implement")}>اجرا شد</button>}
            {n.status === "implemented" && <button className="btn" onClick={() => act("close")}>تأیید و بستن NCR</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function NcrForm({ data, post }) {
  const blank = { title: "", description: "", requirement: "", source: "", severity: "minor", subsystemId: "", tagId: "",
    contractorId: "", raisedOn: today(), responseDue: "" };
  const [f, setF] = useState(blank);
  return (
    <form style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "ncr", ...f })) setF(blank); }}>
      <h2>ثبت NCR</h2>
      <div className="grid2">
        <Field id="nf-t" label="عنوان" value={f.title} on={(v) => setF({ ...f, title: v })} required />
        <Select id="nf-v" label="شدت" value={f.severity} on={(v) => setF({ ...f, severity: v })} opts={Object.entries(data.severities)} />
        <Field id="nf-d" label="شرح عدم انطباق" value={f.description} on={(v) => setF({ ...f, description: v })} required />
        <Field id="nf-q" label="الزام نقض‌شده (نقشه / مشخصات / بند کد)" value={f.requirement} on={(v) => setF({ ...f, requirement: v })} />
        <Select id="nf-s" label="ساب‌سیستم" value={f.subsystemId} on={(v) => setF({ ...f, subsystemId: v })} opts={data.subsystems.map((s) => [s.id, s.code])} blank="—" />
        <Select id="nf-g" label="تگ" value={f.tagId} on={(v) => setF({ ...f, tagId: v })} opts={data.tags.map((t) => [t.id, t.tag_no])} blank="—" />
        <Select id="nf-c" label="پیمانکار مسئول" value={f.contractorId} on={(v) => setF({ ...f, contractorId: v })} opts={data.contractors.map((c) => [c.id, c.code])} blank="—" />
        <Field id="nf-o" label="منبع (بازرسی، ممیزی، کارفرما…)" value={f.source} on={(v) => setF({ ...f, source: v })} />
        <Field id="nf-r" label="تاریخ ثبت" type="date" value={f.raisedOn} on={(v) => setF({ ...f, raisedOn: v })} required />
        <Field id="nf-p" label="مهلت پاسخ" type="date" value={f.responseDue} on={(v) => setF({ ...f, responseDue: v })} />
      </div>
      <div><button className="btn" type="submit">ثبت NCR</button></div>
    </form>
  );
}

// ── shared ───────────────────────────────────────────────────────────────

function History({ url, stamp, onLoad }) {
  const { projectId, call } = usePlatform();
  const [h, setH] = useState(null);
  useEffect(() => {
    let live = true;
    call(`/api/quality?projectId=${projectId}&${url}`).then((r) => { if (live) { setH(r.history); onLoad?.(r); } })
      .catch(() => live && setH([]));
    return () => { live = false; };
  }, [url, stamp, projectId, call]);
  if (!h) return <p className="muted sm">…</p>;
  return (
    <ol className="sm" style={{ margin: 0, paddingInlineStart: 18 }}>
      {h.map((e) => (
        <li key={e.id}>{new Date(e.at).toLocaleString("fa-IR")} — <b>{EVENT_FA[e.event] || e.event}</b>
          {e.from_value && ` ${e.from_value} ← ${e.to_value}`}{e.event === "raised" && e.to_value && ` (${e.to_value})`}
          {e.by_name && ` — ${e.by_name}`}{e.note && `: «${e.note}»`}</li>
      ))}
    </ol>
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
      <input id={id} type={type} dir={type === "text" ? "auto" : "ltr"} required={required} value={value} onChange={(e) => on(e.target.value)} />
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
