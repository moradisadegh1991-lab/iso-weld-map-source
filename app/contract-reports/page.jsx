"use client";
import { useEffect, useMemo, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { localToday } from "../../components/ui/WorkDate";
import { flatten } from "../../components/ui/TreeEditor";

/**
 * The contract's daily report (owner's spec 2026-10-15, steps 5–6).
 * A report belongs to a contract. The first stage writes its rows; a later
 * stage confirms a row («تأیید») or writes its own numbers for it
 * («ویرایش»), and a row a stage changed is shown under the original in the
 * stage's colour, latest stage first. What each person may do is the
 * workflow's (stages, groups, final approver) — this page only asks it.
 */
const FIELDS = {
  narrative: [["categoryId", "دسته", "cat"], ["title", "عنوان", "text"], ["description", "شرح", "text"], ["unit", "واحد", "text"], ["qty", "مقدار", "num"], ["notes", "توضیحات", "text"]],
  problems: [["description", "شرح مشکل", "text"], ["scope", "محدوده", "text"], ["cause", "عامل مشکل", "text"], ["hours", "میزان ساعت", "num"]],
  resources: [["resourceId", "منبع", "res"], ["day", "روز", "num"], ["night", "شب", "num"], ["leave", "مرخصی", "num"], ["sick", "خرابی / استعلاجی", "num"],
    ["local", "بومی", "num"], ["nonLocal", "غیربومی", "num"]],
};
const HEADER = [["startTime", "ساعت شروع", "time"], ["endTime", "ساعت پایان", "time"], ["dayStatus", "وضعیت فعالیت روز", "day"], ["tempMin", "حداقل دما °C", "num"],
  ["tempMax", "حداکثر دما °C", "num"], ["weather", "وضعیت آب‌وهوا", "weather"], ["humidity", "رطوبت ٪", "num"]];
const fmt = (v) => (v == null || v === "" ? "—" : typeof v === "number" ? v.toLocaleString("fa-IR") : v);
const newId = () => `r${Math.random().toString(36).slice(2, 10)}`;
const rowTotal = (e) => ["day", "night", "leave", "sick"].reduce((s, k) => s + (Number(e?.[k]) || 0), 0);

export default function ContractReportsPage() {
  const { projectId, call } = usePlatform();
  const [contractId, setContractId] = useState("");
  const [openId, setOpenId] = useState(null);
  const { data, error, reload } = useProjectData((id) => `/api/contract-reports?projectId=${id}${contractId ? `&contractId=${contractId}` : ""}`, [contractId]);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/contract-reports", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  useEffect(() => { const id = new URLSearchParams(window.location.search).get("id"); if (id) setOpenId(id); }, []);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  return (
    <div className="page">
      <div className="pagehead"><h1>گزارش روزانهٔ قرارداد</h1>
        <span className="sub">شرح کار، مشکلات و منابع روزانه؛ هر مرحله ردیف‌ها را تأیید یا اصلاح می‌کند و تغییرات هر مرحله با رنگ خودش نشان داده می‌شود</span></div>
      {!openId && msg && <p className="err" role="alert">{msg}</p>}
      {!openId && ok && <p className="okmsg" role="status">{ok}</p>}
      {!openId && <>
        <div className="field" style={{ maxWidth: 420 }}><label htmlFor="cr-c">قرارداد</label>
          <select id="cr-c" value={contractId} onChange={(e) => setContractId(e.target.value)}>
            <option value="">— انتخاب قرارداد —</option>{data.contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} — {c.title}</option>)}</select></div>
        {!data.typeReady && (
          <div className="card"><h2>گردش کار</h2>
            <p className="sm">گردش کار گزارش روزانهٔ قرارداد هنوز ساخته نشده است. با «ساخت» مراحل پیمانکار ← نظارت ← کارفرما ساخته می‌شود؛ اعضای گروه‌ها، تأییدکنندهٔ نهایی و جانشین هر مرحله و رنگ تغییرات آن در «تنظیم گردش‌کار» تعیین می‌شوند.</p>
            {data.may.setup && <button className="btn" type="button" onClick={() => post({ kind: "setup-type" }, () => "گردش کار ساخته شد؛ اعضا را در «تنظیم گردش‌کار» تعیین کنید.")}>ساخت گردش کار</button>}</div>)}
        {contractId && <ReportList data={data} contractId={contractId} post={post} open={setOpenId} />}
      </>}
      {openId && <ReportView projectId={projectId} id={openId} call={call} labels={data.labels} users={data.users} close={() => { setOpenId(null); setOk(null); setMsg(null); reload(); }} />}
    </div>
  );
}

function ReportList({ data, contractId, post, open }) {
  const [f, setF] = useState({ title: "", reportDate: localToday(), copyFromId: "", header: { startTime: "07:00", endTime: "17:00", dayStatus: "working", tempMin: "", tempMax: "", weather: "", humidity: "" } });
  const L = data.labels;
  return (
    <>
      {data.may.create && (
        <div className="card">
          <h2>گزارش تازه</h2>
          <form onSubmit={async (e) => { e.preventDefault(); const r = await post({ kind: "create", contractId, ...f, copyFromId: f.copyFromId || null }, () => "گزارش ساخته شد."); if (r?.row) open(r.row.id); }}>
            <div className="grid2">
              <div className="field"><label htmlFor="nr-t">نام گزارش</label><input id="nr-t" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
              <div className="field"><label htmlFor="nr-d">تاریخ انجام کار</label><input id="nr-d" type="date" required value={f.reportDate} onChange={(e) => setF({ ...f, reportDate: e.target.value })} /></div>
              <HeaderFields value={f.header} on={(h) => setF({ ...f, header: h })} labels={L} idp="nr" />
              <div className="field"><label htmlFor="nr-cp">کپی محتوا از گزارش قبلی</label><select id="nr-cp" value={f.copyFromId} onChange={(e) => setF({ ...f, copyFromId: e.target.value })}>
                <option value="">— خالی —</option>{data.reports.map((r) => <option key={r.id} value={r.id}>{r.report_no} — {String(r.report_date).slice(0, 10)} — {r.title}</option>)}</select></div>
            </div>
            <button className="btn" type="submit">ساخت گزارش</button>
          </form>
        </div>)}
      <div className="card">
        <h2>گزارش‌های این قرارداد</h2>
        {data.reports.length === 0 ? <p className="empty-note">گزارشی نیست.</p> : (
          <table className="dtable"><thead><tr><th>شماره</th><th>تاریخ کار</th><th>نام</th><th>مرحله</th><th>وضعیت</th><th>نسخه</th><th /></tr></thead>
            <tbody>{data.reports.map((r) => (
              <tr key={r.id}><td className="mono">{r.report_no}</td><td className="mono">{String(r.report_date).slice(0, 10)}</td><td>{r.title}</td><td>{r.stage_name}</td>
                <td><span className={`pill ${r.status === "approved" ? "ok" : r.status === "cancelled" ? "bad" : ""}`}>{r.status_fa}</span></td><td className="mono">{r.version_no}</td>
                <td><button className="btn ghost sm" type="button" onClick={() => open(r.id)}>باز کردن</button></td></tr>))}</tbody></table>)}
      </div>
    </>
  );
}

function HeaderFields({ value, on, labels, idp, disabled = false }) {
  return HEADER.map(([k, l, t]) => (
    <div className="field" key={k}><label htmlFor={`${idp}-${k}`}>{l}</label>
      {t === "day" || t === "weather" ? (
        <select id={`${idp}-${k}`} disabled={disabled} value={value[k] ?? ""} onChange={(e) => on({ ...value, [k]: e.target.value })}>
          <option value="">—</option>{Object.entries(t === "day" ? labels.dayStatus : labels.weather).map(([x, y]) => <option key={x} value={x}>{y}</option>)}</select>
      ) : <input id={`${idp}-${k}`} disabled={disabled} type={t === "time" ? "time" : "text"} dir="ltr" inputMode={t === "num" ? "decimal" : undefined}
        value={value[k] ?? ""} onChange={(e) => on({ ...value, [k]: e.target.value })} />}
    </div>));
}

function ReportView({ projectId, id, call, labels, users, close }) {
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [tab, setTab] = useState("narrative");
  const load = () => call(`/api/contract-reports?projectId=${projectId}&id=${id}`).then(setV).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/contract-reports", { method: "POST", body: JSON.stringify({ projectId, reportId: id, ...body }) }); await load(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  if (err) return <p className="err">{err}</p>;
  if (!v) return <p className="muted">در حال بارگذاری…</p>;
  const S = String(v.report.stage_seq);
  const first = v.report.stage_seq === v.firstSeq;
  const editable = v.may.edit;
  // every change is a new version of the whole content, built here and judged by the server
  const save = (mutate, done) => { const c = structuredClone(v.content); mutate(c); return post({ kind: "edit", content: c }, () => done); };
  const ops = {
    add: (kind, values) => save((c) => { c[kind].push(first ? { id: newId(), base: values, stages: {} } : { id: newId(), base: null, stages: { [S]: values } }); }, "ردیف اضافه شد."),
    update: (kind, rid, values) => save((c) => { const r = c[kind].find((x) => x.id === rid); if (first) r.base = values; else r.stages[S] = { ...values }; },
      first ? "ردیف ذخیره شد." : `مقدار مرحلهٔ «${v.report.stage_name}» ثبت شد.`),
    confirm: (kind, rid) => save((c) => { const r = c[kind].find((x) => x.id === rid); r.stages[S] = { ...(r.stages[S] || {}), confirmed: true }; }, "ردیف تأیید شد."),
    remove: (kind, rid) => save((c) => {
      const r = c[kind].find((x) => x.id === rid);
      if (first || (r.addedAt === Number(S) && !r.base)) c[kind] = c[kind].filter((x) => x.id !== rid);
      else r.stages[S] = { removed: true };
    }, "ردیف حذف شد."),
    header: (values) => save((c) => { if (first) c.header.base = values; else c.header.stages[S] = values; }, "سربرگ ذخیره شد."),
  };
  return (
    <>
      <p className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn ghost" type="button" onClick={close}>بازگشت به فهرست</button>
        <a className="btn ghost" href={`/contract-reports/print?id=${id}`}>چاپ / PDF {v.report.status === "approved" ? "(نسخهٔ مرجع)" : ""}</a>
      </p>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      <div className="card">
        <h2>{v.report.title} <span className="mono sm muted">{v.report.report_no}</span></h2>
        <p className="sm">قرارداد <b className="mono">{v.contract.contract_no}</b> — {v.contract.title} · تاریخ انجام کار <b className="mono">{String(v.report.report_date).slice(0, 10)}</b>
          {" "}· ایجاد {new Date(v.report.created_at).toLocaleString("fa-IR")} · نسخهٔ {v.versionNo} · <b>{v.report.status_fa}</b>{v.report.status === "open" && <> — مرحلهٔ جاری: <b>{v.report.stage_name}</b></>}</p>
        <Workflow v={v} />
        <HeaderBox v={v} labels={labels} editable={editable} save={ops.header} first={first} />
      </div>
      <div className="ptabs no-print" role="tablist">
        {[["narrative", "شرح کار (Narrative)"], ["problems", "مشکلات"], ["resources", "منابع"], ["photos", `عکس‌ها (${v.files.filter((f) => f.kind === "photo" && !f.removed_at).length})`],
          ["files", `پیوست‌ها (${v.files.filter((f) => f.kind === "file" && !f.removed_at).length})`], ["actions", "امضا، تأیید و ارسال"], ["history", "تاریخچه"]].map(([k, t]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t}</button>))}
      </div>
      {["narrative", "problems", "resources"].includes(tab) && (
        <div className="card">
          <h2>{labels.sections[tab]}</h2>
          {tab === "resources" && <ResourceSummary v={v} projectId={projectId} call={call} labels={labels} />}
          <Section kind={tab} v={v} labels={labels} editable={editable} first={first} ops={ops} />
        </div>)}
      {(tab === "photos" || tab === "files") && <Files kind={tab === "photos" ? "photo" : "file"} v={v} projectId={projectId} editable={editable} post={post} setMsg={setMsg} reload={load} />}
      {tab === "actions" && <Actions v={v} users={users} post={post} />}
      {tab === "history" && <History v={v} />}
    </>
  );
}

/** 6.5: the stages side by side — title (green once approved), the current one marked; under each, its groups and their signatures. */
function Workflow({ v }) {
  const boxes = new Map(v.signatureBoxes.map((b) => [b.stageSeq, b]));
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto", margin: "8px 0" }} aria-label="گردش کار">
      {v.stages.map((s) => (
        <div key={s.seq} style={{ flex: "1 0 200px", border: `2px solid ${s.approved ? "var(--ok, #2e7d32)" : "var(--rule, #ccd)"}`, borderRadius: 8, position: "relative" }}>
          <div style={{ padding: "6px 10px", fontWeight: 700, background: s.approved ? "rgba(46,125,50,.12)" : undefined, borderBottom: "1px solid var(--rule, #ccd)" }}>
            {s.seq}. {s.name}
            {s.current && <span style={{ position: "absolute", top: 6, right: 8, fontSize: 11, fontWeight: 400, display: "flex", gap: 4, alignItems: "center" }}>
              <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: "#000", display: "inline-block" }} />مرحله جاری</span>}
            {s.approverName && <div className="sm muted" style={{ fontWeight: 400 }}>تأییدکنندهٔ نهایی: {s.approverName}{s.deputyName ? ` · جانشین: ${s.deputyName}` : ""}</div>}
          </div>
          <div style={{ display: "flex", gap: 6, padding: 6, flexWrap: "wrap" }}>
            {(boxes.get(s.seq)?.groups || []).map((g) => (
              <div key={g.groupId} style={{ flex: "1 0 90px", border: "1px solid var(--rule, #ccd)", borderRadius: 6, padding: 4 }}>
                <div className="sm"><b>{g.name}</b></div>
                {g.signatures.length === 0 ? <div className="sm muted">—</div> : g.signatures.map((x) => (
                  <div key={x.userId} className="sm" style={{ opacity: x.current ? 1 : 0.5 }}>✓ {x.onBehalfOf ? `از طرف ${x.onBehalfOf} — ` : ""}{x.name}</div>))}
              </div>))}
          </div>
        </div>))}
    </div>
  );
}

function HeaderBox({ v, labels, editable, save, first }) {
  const eff = { ...(v.content.header?.base || {}), ...Object.fromEntries(Object.entries(v.content.header?.stages || {}).sort(([a], [b]) => a - b)
    .flatMap(([, x]) => Object.entries(x).filter(([k, y]) => k !== "confirmed" && y != null))) };
  const [h, setH] = useState(eff);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="sm" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {HEADER.map(([k, l, t]) => <span key={k}>{l}: <b>{eff[k] == null || eff[k] === "" ? "—" : t === "day" ? labels.dayStatus[eff[k]] : t === "weather" ? labels.weather[eff[k]] : eff[k]}</b></span>)}
      </div>
      {editable && !open && <button className="btn ghost sm" type="button" onClick={() => { setH(eff); setOpen(true); }}>{first ? "ویرایش سربرگ" : "اصلاح سربرگ در این مرحله"}</button>}
      {open && (
        <form onSubmit={async (e) => { e.preventDefault(); if (await save(h)) setOpen(false); }}>
          <div className="grid2"><HeaderFields value={h} on={setH} labels={labels} idp="hd" /></div>
          <button className="btn" type="submit">ذخیره</button> <button className="btn ghost" type="button" onClick={() => setOpen(false)}>انصراف</button>
        </form>)}
    </div>
  );
}

function Cell({ f, value, v }) {
  const [k, , t] = f;
  if (t === "cat") return <>{flatten(v.narrativeTree).find((x) => x.id === value)?.path || "—"}</>;
  if (t === "res") { const r = v.resources.find((x) => x.id === value); return <>{r ? r.name : "—"}</>; }
  return <>{fmt(value)}</>;
}

function RowForm({ kind, v, initial, onSave, onCancel, label }) {
  const [f, setF] = useState(() => Object.fromEntries(FIELDS[kind].map(([k]) => [k, initial?.[k] ?? ""])));
  return (
    <form className="row" style={{ gap: 6, alignItems: "end", flexWrap: "wrap", padding: 6, background: "var(--surf2, #f5f7f9)", borderRadius: 6 }}
      onSubmit={async (e) => { e.preventDefault(); if (await onSave(f)) onCancel?.(); }}>
      {FIELDS[kind].map(([k, l, t]) => (
        <div className="field" key={k} style={{ minWidth: t === "num" ? 80 : 140 }}><label htmlFor={`rf-${kind}-${k}`}>{l}</label>
          {t === "cat" ? <select id={`rf-${kind}-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
            <option value="">—</option>{flatten(v.narrativeTree).map((x) => <option key={x.id} value={x.id}>{x.path}</option>)}</select>
          : t === "res" ? <select id={`rf-${kind}-${k}`} required value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
            <option value="">—</option>{v.resources.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.unit})</option>)}</select>
          : <input id={`rf-${kind}-${k}`} dir={t === "num" ? "ltr" : undefined} inputMode={t === "num" ? "decimal" : undefined} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}
        </div>))}
      {kind === "resources" && <span className="sm muted">کل نفرات: <b>{rowTotal(f)}</b></span>}
      <button className="btn sm" type="submit">{label}</button>
      {onCancel && <button className="btn ghost sm" type="button" onClick={onCancel}>انصراف</button>}
    </form>
  );
}

/** One section: each row as first written, the stages' changes under it (latest first, in their colour), and the row's buttons. */
function Section({ kind, v, labels, editable, first, ops }) {
  const [editing, setEditing] = useState(null);
  const cols = FIELDS[kind];
  const stageName = v.report.stage_name;
  const S = String(v.report.stage_seq);
  return (
    <div className="tablewrap">
      <table className="dtable">
        <thead><tr><th>ردیف</th><th>مرحله</th>{cols.map(([k, l]) => <th key={k}>{l}</th>)}{kind === "resources" && <th>کل نفرات</th>}<th /></tr></thead>
        <tbody>{v.lines[kind].map((line, i) => {
          const raw = v.content[kind].find((r) => r.id === line.id);
          const mineNow = raw?.stages?.[S];
          const baseVals = line.base || {};
          return [
            <tr key={line.id} style={{ textDecoration: line.effective.removed ? "line-through" : undefined }}>
              <td className="mono">{i + 1}</td>
              <td className="sm">{line.base ? v.stages.find((s) => s.seq === v.firstSeq)?.name : <span className="muted">افزودهٔ {v.stages.find((s) => s.seq === raw.addedAt)?.name}</span>}
                {line.confirmedBy.length > 0 && <div className="sm" style={{ color: "var(--ok)" }}>✓ {line.confirmedBy.join("، ")}</div>}</td>
              {cols.map((f) => <td key={f[0]}>{line.base ? <Cell f={f} value={baseVals[f[0]]} v={v} /> : "—"}</td>)}
              {kind === "resources" && <td className="mono">{line.base ? rowTotal(baseVals) : "—"}</td>}
              <td style={{ whiteSpace: "nowrap" }}>{editable && !line.effective.removed && <>
                {!first && !mineNow?.confirmed && <button className="btn ghost sm" type="button" onClick={() => ops.confirm(kind, line.id)}>تأیید</button>}
                <button className="btn ghost sm" type="button" onClick={() => setEditing(editing === line.id ? null : line.id)}>ویرایش</button>
                <button className="btn ghost sm" type="button" onClick={() => ops.remove(kind, line.id)}>حذف</button></>}</td>
            </tr>,
            ...line.lines.map((l) => (
              <tr key={`${line.id}-${l.seq}`} style={{ color: l.color || "var(--bad)", textDecoration: l.removed ? "line-through" : undefined }}>
                <td /><td className="sm"><b>{l.stage}</b>{l.removed && " — حذف‌شده"}</td>
                {cols.map((f) => <td key={f[0]}><Cell f={f} value={l.values[f[0]]} v={v} /></td>)}
                {kind === "resources" && <td className="mono">{rowTotal(l.values)}</td>}<td />
              </tr>)),
            editing === line.id && <tr key={`${line.id}-edit`}><td colSpan={cols.length + 3 + (kind === "resources" ? 1 : 0)}>
              <RowForm kind={kind} v={v} initial={first ? baseVals : { ...line.effective }} label={first ? "ذخیره" : `ثبت مقدار مرحلهٔ «${stageName}»`}
                onSave={(f) => ops.update(kind, line.id, f)} onCancel={() => setEditing(null)} /></td></tr>,
          ];
        })}</tbody>
      </table>
      {v.lines[kind].length === 0 && <p className="empty-note">ردیفی ثبت نشده.</p>}
      {editable && <div style={{ marginTop: 8 }}><b className="sm">ردیف تازه{first ? "" : ` (مرحلهٔ ${stageName})`}</b>
        <RowForm key={v.versionNo} kind={kind} v={v} label="افزودن" onSave={(f) => ops.add(kind, f)} /></div>}
      {kind === "resources" && v.resources.length === 0 && <p className="sm muted">این قرارداد هنوز منبعی ندارد (قراردادها ◄ منابع قرارداد).</p>}
    </div>
  );
}

/** 6.3.1: today's people at a glance, every unit's total, and the same over a period with filters. */
function ResourceSummary({ v, projectId, call, labels }) {
  const s = v.summary;
  const [q, setQ] = useState({ kind: "", categoryId: "", name: "", from: "", to: "" });
  const [range, setRange] = useState(null);
  const run = async () => {
    const p = new URLSearchParams({ projectId, summary: "1", contractId: v.contract.id, ...Object.fromEntries(Object.entries(q).filter(([, x]) => x)) });
    try { setRange(await call(`/api/contract-reports?${p}`)); } catch { setRange(null); }
  };
  const name = (rid) => v.resources.find((r) => r.id === rid)?.name || "—";
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="moneyrow">
        <div><span>نفرات فعال روز</span><b>{fmt(s.day)}</b></div><div><span>نفرات فعال شب</span><b>{fmt(s.night)}</b></div>
        <div><span>مرخصی</span><b>{fmt(s.leave)}</b></div><div><span>کل نفرات</span><b>{fmt(s.total)}</b></div>
      </div>
      <p className="sm">جمع همهٔ احجام: {Object.entries(s.byUnit).map(([u, n]) => <span key={u} style={{ marginInlineEnd: 12 }}><b>{fmt(n)}</b> {u}</span>)}</p>
      <details className="inlinefold"><summary>فیلتر منابع در بازهٔ تاریخ</summary>
        <div className="row" style={{ gap: 6, alignItems: "end", flexWrap: "wrap" }}>
          <div className="field"><label htmlFor="sf-k">نوع منبع</label><select id="sf-k" value={q.kind} onChange={(e) => setQ({ ...q, kind: e.target.value })}>
            <option value="">همه</option>{Object.entries(labels.kinds).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
          <div className="field"><label htmlFor="sf-c">گروه / دسته</label><select id="sf-c" value={q.categoryId} onChange={(e) => setQ({ ...q, categoryId: e.target.value })}>
            <option value="">همه</option>{flatten(v.resourceTree).map((x) => <option key={x.id} value={x.id}>{x.path}</option>)}</select></div>
          <div className="field"><label htmlFor="sf-n">نام منبع</label><input id="sf-n" value={q.name} onChange={(e) => setQ({ ...q, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="sf-f">از تاریخ</label><input id="sf-f" type="date" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} /></div>
          <div className="field"><label htmlFor="sf-t">تا تاریخ</label><input id="sf-t" type="date" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} /></div>
          <button className="btn sm" type="button" onClick={run}>نمایش</button>
        </div>
        {range && <>
          <p className="sm">{range.reports} گزارش · روز {fmt(range.summary.day)} · شب {fmt(range.summary.night)} · مرخصی {fmt(range.summary.leave)} · کل نفرات {fmt(range.summary.total)}
            {" "}· {Object.entries(range.summary.byUnit).map(([u, n]) => `${fmt(n)} ${u}`).join(" · ")}</p>
          {range.byResource.length > 0 && <table className="dtable"><thead><tr><th>منبع</th><th>روز</th><th>شب</th><th>مرخصی</th><th>خرابی / استعلاجی</th><th>کل</th></tr></thead>
            <tbody>{range.byResource.map((r) => <tr key={r.resourceId}><td>{name(r.resourceId)}</td><td className="mono">{fmt(r.day)}</td><td className="mono">{fmt(r.night)}</td>
              <td className="mono">{fmt(r.leave)}</td><td className="mono">{fmt(r.sick)}</td><td className="mono"><b>{fmt(r.total)}</b></td></tr>)}</tbody></table>}
        </>}
      </details>
    </div>
  );
}

function Files({ kind, v, projectId, editable, post, setMsg, reload }) {
  const [f, setF] = useState({ name: "", caption: "", tags: "", file: null });
  const list = v.files.filter((x) => x.kind === kind);
  const url = (id) => `/api/contract-reports?projectId=${projectId}&file=${id}`;
  async function upload(e) {
    e.preventDefault();
    if (!f.file) { setMsg("فایل را انتخاب کنید."); return; }
    const form = new FormData();
    for (const [k, x] of Object.entries({ projectId, reportId: v.report.id, kind, name: f.name || f.file.name, caption: f.caption, tags: f.tags })) form.set(k, x);
    form.set("file", f.file);
    const res = await fetch("/api/contract-reports", { method: "POST", body: form, credentials: "same-origin" });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(b.error || `پاسخ ${res.status}`); return; }
    setF({ name: "", caption: "", tags: "", file: null }); e.target.reset(); reload();
  }
  return (
    <div className="card">
      <h2>{kind === "photo" ? "عکس‌ها" : "پیوست‌ها"}</h2>
      {editable && (
        <form className="row" style={{ gap: 6, alignItems: "end", flexWrap: "wrap" }} onSubmit={upload}>
          <div className="field"><label htmlFor={`fu-${kind}`}>{kind === "photo" ? "عکس (PNG، JPEG، WebP)" : "فایل"}</label>
            <input id={`fu-${kind}`} type="file" accept={kind === "photo" ? "image/png,image/jpeg,image/webp" : undefined} onChange={(e) => setF({ ...f, file: e.target.files?.[0] || null })} /></div>
          <div className="field"><label htmlFor={`fn-${kind}`}>نام</label><input id={`fn-${kind}`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          {kind === "photo" && <>
            <div className="field"><label htmlFor="fc">شرح عکس</label><input id="fc" value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} /></div>
            <div className="field"><label htmlFor="ft">برچسب‌ها (با ، جدا کنید)</label><input id="ft" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></div></>}
          <button className="btn" type="submit">افزودن</button>
        </form>)}
      {list.length === 0 ? <p className="empty-note">چیزی اضافه نشده.</p> : kind === "photo" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 10 }}>
          {list.map((x) => (
            <figure key={x.id} style={{ margin: 0, opacity: x.removed_at ? 0.4 : 1 }}>
              <img src={url(x.id)} alt={x.caption || x.name} style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 6 }} />
              <figcaption className="sm">{x.caption || x.name}{x.removed_at && " (حذف‌شده)"}
                <div>{x.tags.map((t) => <span key={t} className="pill" style={{ marginInlineEnd: 4 }}>{t}</span>)}</div>
                <div className="muted">{x.uploaded_name} · {new Date(x.uploaded_at).toLocaleString("fa-IR")}</div>
                {editable && !x.removed_at && <button className="btn ghost sm" type="button" onClick={() => post({ kind: "file-remove", fileId: x.id })}>حذف</button>}</figcaption>
            </figure>))}
        </div>
      ) : (
        <table className="dtable"><thead><tr><th>فایل</th><th>حجم</th><th>بارگذاری</th><th /></tr></thead>
          <tbody>{list.map((x) => <tr key={x.id} style={{ opacity: x.removed_at ? 0.4 : 1 }}><td><a href={url(x.id)}>{x.name}</a>{x.removed_at && " (حذف‌شده)"}</td>
            <td className="mono">{Math.ceil(x.byte_size / 1024)} KB</td><td className="sm">{x.uploaded_name} · {new Date(x.uploaded_at).toLocaleString("fa-IR")}</td>
            <td>{editable && !x.removed_at && <button className="btn ghost sm" type="button" onClick={() => post({ kind: "file-remove", fileId: x.id })}>حذف</button>}</td></tr>)}</tbody></table>)}
    </div>
  );
}

function Actions({ v, users, post }) {
  const [comment, setComment] = useState("");
  const [to, setTo] = useState([]);
  const [note, setNote] = useState("");
  const m = v.may;
  const groupName = (gid) => v.signatureBoxes.flatMap((s) => s.groups).find((g) => g.groupId === gid)?.name;
  return (
    <div className="card">
      <h2>امضا، تأیید و ارسال</h2>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {m.signFor.map((g) => <button key={g} className="btn" type="button" onClick={() => post({ kind: "sign", groupId: g }, () => "امضا شد.")}>امضا برای «{groupName(g)}»</button>)}
        {m.withdraw && <button className="btn ghost" type="button" onClick={() => post({ kind: "withdraw" }, () => "امضا لغو شد.")}>لغو امضای من</button>}
        {m.approve && <button className="btn" type="button" onClick={() => post({ kind: "approve", comment }, () => "تأیید نهایی مرحله ثبت شد؛ گزارش برای این مرحله قفل شد.")}>تأیید نهایی مرحله</button>}
      </div>
      {!m.signFor.length && !m.withdraw && !m.approve && <p className="sm muted">در مرحلهٔ فعلی امضا یا تأییدی از شما انتظار نمی‌رود. تأیید نهایی تا امضای تأییدکنندهٔ نهایی صادر نمی‌شود؛ پس از امضا، فقط با لغو امضا می‌توان دوباره ویرایش کرد.</p>}
      {(m.return || m.cancel) && (
        <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ac-c">دلیل (برای برگشت یا لغو)</label><input id="ac-c" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          {m.return && <button className="btn ghost" type="button" onClick={() => post({ kind: "return", comment }, () => "به مرحلهٔ قبل برگشت.")}>برگشت به مرحلهٔ قبل</button>}
          {m.cancel && <button className="btn ghost" type="button" style={{ color: "var(--bad)" }} onClick={() => post({ kind: "cancel", comment }, () => "گزارش لغو شد.")}>لغو گزارش</button>}
        </div>)}
      <h3 style={{ marginTop: 16 }}>ارسال برای چند کاربر</h3>
      <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <div className="field"><label htmlFor="ac-to">گیرندگان</label><select id="ac-to" multiple size={Math.min(6, users.length)} value={to} onChange={(e) => setTo([...e.target.selectedOptions].map((o) => o.value))}>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div className="field" style={{ flex: 1 }}><label htmlFor="ac-n">یادداشت</label><input id="ac-n" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button className="btn" type="button" disabled={!to.length} onClick={async () => { if (await post({ kind: "send", userIds: to, note }, (r) => `برای ${r.row} نفر ارسال شد.`)) setTo([]); }}>ارسال</button>
      </div>
    </div>
  );
}

function History({ v }) {
  const ACT = { approved: "تأیید نهایی", returned: "برگشت", cancelled: "لغو" };
  return (
    <div className="card">
      <h2>تاریخچه</h2>
      <p className="sm muted">هر ذخیره یک نسخه است و همهٔ نسخه‌ها می‌مانند. {v.record ? `نسخهٔ ${v.record.versionNo} که در آخرین مرحله تأیید شد، سند مرجع گزارش است.` : "گزارش هنوز تأیید نهایی نشده است."}</p>
      <table className="dtable"><thead><tr><th>نسخه</th><th>مرحله</th><th>ویرایشگر</th><th>زمان</th></tr></thead>
        <tbody>{v.versions.map((x) => <tr key={x.version_no} style={v.record?.versionNo === x.version_no ? { fontWeight: 700 } : undefined}>
          <td className="mono">{x.version_no}{v.record?.versionNo === x.version_no && " (مرجع)"}</td><td>{v.stages.find((s) => s.seq === x.stage_seq)?.name}</td>
          <td>{x.edited_by || "—"}</td><td className="mono sm">{new Date(x.edited_at).toLocaleString("fa-IR")}</td></tr>)}</tbody></table>
      <h3>تصمیم‌ها</h3>
      {v.decisions.length === 0 ? <p className="empty-note">—</p> : <table className="dtable"><thead><tr><th>مرحله</th><th>تصمیم</th><th>نسخه</th><th>توسط</th><th>توضیح</th><th>زمان</th></tr></thead>
        <tbody>{v.decisions.map((d, i) => <tr key={i}><td>{v.stages.find((s) => s.seq === d.stageSeq)?.name}</td><td>{ACT[d.action]}</td><td className="mono">{d.versionNo}</td>
          <td>{d.by}</td><td className="sm">{d.comment || "—"}</td><td className="mono sm">{new Date(d.at).toLocaleString("fa-IR")}</td></tr>)}</tbody></table>}
    </div>
  );
}
