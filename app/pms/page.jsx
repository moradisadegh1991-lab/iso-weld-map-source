"use client";
import { useMemo, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import Tabs from "../../components/ui/Tabs";

/**
 * Schedule and PMS: the MS Project plan and the weighted progress
 * measurement, side by side. The PMS is shown as the workbook stated it and
 * as it stands now (with the progress reported since); the plan curve covers
 * only the elements linked to a schedule task, and says how much that is.
 */
const pct = (v, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const pct100 = (v, d = 1) => (v == null ? "—" : `${Number(v).toFixed(d)}%`);
const num = (v) => (v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }));
const today = () => new Date().toISOString().slice(0, 10);
const NOWRAP = { whiteSpace: "nowrap" };
const days = (a, b) => (a && b ? Math.round((Date.parse(a) - Date.parse(b)) / 86400000) : null);

export default function PmsPage() {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/pms?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);

  async function post(body) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/pms", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  async function upload(kind, file, extra = {}) {
    setMsg(null); setOk(null);
    const form = new FormData(); form.set("projectId", projectId); form.set("kind", kind); form.set("file", file);
    for (const [k, v] of Object.entries(extra)) if (v) form.set(k, v);
    const res = await fetch("/api/pms", { method: "POST", body: form, credentials: "same-origin" });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(b.error || `پاسخ ${res.status}`); return null; }
    reload(); return b;
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const may = data.may.edit;
  const s = data.schedule, p = data.pms;
  const root = data.tasks.find((t) => t.level === 0) || null;
  const slip = root ? days(root.finish, root.bl_finish) : null;

  return (
    <div className="page">
      <div className="pagehead"><h1>برنامه و PMS</h1>
        <span className="sub">{s ? <bdi>{s.title}</bdi> : "برنامهٔ زمان‌بندی وارد نشده"}{s?.status_date && ` · تاریخ وضعیت برنامه ${s.status_date}`}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}

      {(s || p) && (
        <div className="moneyrow">
          {p && <div><span>پیشرفت PMS (اکنون)</span><b>{pct(p.nodes[0]?.now, 2)}</b></div>}
          {p && <div><span>پیشرفت نوشته‌شده در فایل</span><b>{pct(p.import.stated_total, 2)}</b></div>}
          {p && <div><span>تاریخ دادهٔ PMS</span><b>{p.import.data_date || "نامعلوم"}</b></div>}
          {root && <div><span>پایان برنامه / مبنا</span><b className="mono">{root.finish} / {root.bl_finish}</b></div>}
          {slip != null && <div><span>جابه‌جایی پایان</span><b style={{ color: slip > 0 ? "var(--bad)" : undefined }}>{slip > 0 ? `${slip} روز دیرتر` : slip < 0 ? `${-slip} روز زودتر` : "بدون تأخیر"}</b></div>}
          {p && <div><span>آیتم‌های پیوندخورده</span><b>{p.elements.filter((e) => e.uid != null).length} از {p.elements.length}</b></div>}
        </div>
      )}

      {p && !p.import.data_date && (
        <div className="card" data-keep="1">
          <p className="sm"><b>تاریخ دادهٔ این PMS در فایل نوشته نشده است.</b> پیشرفت {pct(p.import.stated_total, 2)} معلوم است، ولی معلوم نیست
            مال چه روزی است؛ پس روی منحنی گذاشته نمی‌شود و با برنامه مقایسه نمی‌شود.
            {p.import.file_saved_at && <> آخرین ذخیرهٔ فایل: <span className="mono">{String(p.import.file_saved_at).slice(0, 10)}</span> — این تاریخ ذخیره است، نه تاریخ داده.</>}</p>
          {may && <DataDateForm onSave={(d) => post({ kind: "data-date", pmsImportId: p.import.id, dataDate: d })} />}
        </div>
      )}

      <Tabs name="pms">
        {p?.curve && <CurveCard p={p} />}
        {p && <PmsTree p={p} tasks={data.tasks} may={may} post={post} />}
        {s && <ScheduleCard tasks={data.tasks} />}
        {p && <ProblemsCard p={p} problemFa={data.problemFa} />}
        {may && <ImportCard s={s} p={p} upload={upload} setOk={setOk} />}
        {!s && !p && !may && <div className="card"><h2>برنامه و PMS</h2><p className="empty-note">هنوز چیزی وارد نشده است.</p></div>}
      </Tabs>
    </div>
  );
}

function DataDateForm({ onSave }) {
  const [d, setD] = useState("");
  return (
    <form className="row" style={{ gap: 8, alignItems: "end" }} onSubmit={async (e) => { e.preventDefault(); await onSave(d); }}>
      <div className="field"><label htmlFor="pms-dd">تاریخ دادهٔ PMS (تا چه روزی اندازه‌گیری شده)</label>
        <input id="pms-dd" type="date" max={today()} required value={d} onChange={(e) => setD(e.target.value)} /></div>
      <button className="btn" type="submit">ثبت تاریخ داده</button>
    </form>
  );
}

// ── S-curve ──────────────────────────────────────────────────────────────

function CurveCard({ p }) {
  const c = p.curve;
  const W = 720, H = 240, L = 40, R = 14, T = 12, B = 28;
  const t = (d) => Date.parse(`${d}T00:00:00Z`);
  const all = [...c.dates, ...c.actual.map((a) => a.on)].sort();
  const t0 = t(all[0]), t1 = t(all.at(-1));
  const x = (d) => L + ((t(d) - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - v / 100) * (H - T - B);
  const line = (pts) => pts.filter((q) => q.pct != null).map((q, i) => `${i ? "L" : "M"}${x(q.on).toFixed(1)},${y(q.pct).toFixed(1)}`).join(" ");
  const share = c.totalWf > 0 ? c.coveredWf / c.totalWf : 0;
  return (
    <div className="card">
      <h2>منحنی S</h2>
      <p className="sm muted">برنامه از تاریخ‌های <b>خط مبنا</b> و <b>برنامهٔ جاری</b> MS Project، با پخش یکنواخت وزن هر آیتم روی روزهای فعالیتش (مقدار محاسبه‌شده).
        این منحنی فقط آیتم‌هایی را می‌پوشاند که به فعالیت برنامه پیوند خورده‌اند: <b>{pct(share)}</b> وزن آیتم‌های PMS
        ({p.elements.filter((e) => e.uid != null).length} از {p.elements.length} آیتم).</p>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, direction: "ltr" }} role="img" aria-label="S-curve plan vs actual">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--rule)" strokeWidth="1" />
            <text x={L - 6} y={y(v) + 3} fontSize="9" textAnchor="end" fill="var(--dim)">{v}%</text></g>
        ))}
        <path d={line(c.baseline)} fill="none" stroke="var(--dim)" strokeWidth="2" strokeDasharray="5 4" />
        <path d={line(c.forecast)} fill="none" stroke="var(--cy)" strokeWidth="2" />
        {c.actual.map((a) => <circle key={a.on} cx={x(a.on)} cy={y(a.pct)} r="4.5" fill="var(--ok)" />)}
        <text x={L} y={H - 8} fontSize="9" fill="var(--dim)">{all[0]}</text>
        <text x={W - R} y={H - 8} fontSize="9" textAnchor="end" fill="var(--dim)">{all.at(-1)}</text>
      </svg>
      <div className="sm" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span><span style={{ borderTop: "2px dashed var(--dim)", display: "inline-block", width: 22, verticalAlign: "middle" }} /> برنامهٔ مبنا</span>
        <span><span style={{ borderTop: "2px solid var(--cy)", display: "inline-block", width: 22, verticalAlign: "middle" }} /> برنامهٔ جاری</span>
        <span><span style={{ background: "var(--ok)", display: "inline-block", width: 9, height: 9, borderRadius: 9 }} /> واقعی (PMS)</span>
      </div>
      {c.undated != null && <p className="sm">واقعی همین آیتم‌ها در فایل: <b>{pct100(c.undated, 2)}</b> — بدون تاریخ، پس روی منحنی نیست.</p>}
      <div className="tablewrap"><table className="dtable">
        <thead><tr><th>تاریخ</th><th>برنامهٔ مبنا</th><th>برنامهٔ جاری</th></tr></thead>
        <tbody>{c.dates.map((d, i) => <tr key={d}><td className="mono">{d}</td><td>{pct100(c.baseline[i].pct)}</td><td>{pct100(c.forecast[i].pct)}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}

// ── the PMS tree ─────────────────────────────────────────────────────────

function PmsTree({ p, tasks, may, post }) {
  const kids = useMemo(() => {
    const m = new Map(p.nodes.map((n) => [n.seq, []]));
    for (const n of p.nodes) if (n.parent != null) m.get(n.parent).push(n.seq);
    return m;
  }, [p.nodes]);
  const elementBy = useMemo(() => new Map(p.elements.map((e) => [e.seq, e])), [p.elements]);
  const taskBy = useMemo(() => new Map(tasks.map((t) => [t.uid, t])), [tasks]);
  const summaries = useMemo(() => tasks.filter((t) => t.is_summary), [tasks]);
  const [open, setOpen] = useState(() => new Set(p.nodes.filter((n) => n.level <= 1).map((n) => n.seq)));
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null); // {seq, kind}
  const toggle = (seq) => setOpen((o) => { const n = new Set(o); n.has(seq) ? n.delete(seq) : n.add(seq); return n; });

  const rows = [];
  if (q.trim()) {
    const s = q.trim().toLowerCase();
    for (const n of p.nodes) if (`${n.name} ${n.code || ""}`.toLowerCase().includes(s)) rows.push(n);
  } else {
    const walk = (seq) => { const n = p.nodes[seq]; rows.push(n); if (open.has(seq)) for (const c of kids.get(seq)) walk(c); };
    for (const n of p.nodes) if (n.parent == null) walk(n.seq);
  }
  const shown = rows.slice(0, 800);
  return (
    <div className="card">
      <h2>PMS</h2>
      <p className="sm muted"><bdi>{p.import.title}</bdi> · <bdi>{p.import.source_name}</bdi> · وزن‌ها و پیشرفت همان است که فایل نوشته؛ «اکنون» پیشرفت گزارش‌شده بعد از فایل را هم دارد
        ({p.reports} گزارش). جمع وزنی گام‌ها: <b>{pct(p.import.computed_total, 4)}</b> — فایل: <b>{pct(p.import.stated_total, 4)}</b>.</p>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <div className="field" style={{ flex: 1 }}><label htmlFor="pms-q">جست‌وجو (نام یا کد)</label><input id="pms-q" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn ghost sm" type="button" onClick={() => setOpen(new Set(p.nodes.filter((n) => n.kind === "group").map((n) => n.seq)))}>باز کردن همه</button>
        <button className="btn ghost sm" type="button" onClick={() => setOpen(new Set(p.nodes.filter((n) => n.level <= 1).map((n) => n.seq)))}>بستن</button>
      </div>
      <div className="tablewrap"><table className="dtable">
        <thead><tr><th>شرح</th><th>کد</th><th>واحد</th><th>مقدار</th><th>W.F</th><th>وزن گام</th><th>پیشرفت فایل</th><th>اکنون</th><th>فعالیت برنامه</th>{may && <th />}</tr></thead>
        <tbody>{shown.map((n) => {
          const el = elementBy.get(n.seq);
          const task = el?.uid != null ? taskBy.get(el.uid) : null;
          const hasKids = kids.get(n.seq).length > 0;
          const moved = n.now != null && n.progress != null && Math.abs(n.now - n.progress) > 1e-9;
          return [
            <tr key={n.seq} style={n.kind === "group" ? { fontWeight: n.level <= 2 ? 700 : 600 } : undefined}>
              <td style={{ paddingInlineStart: 6 + n.level * 14 }}>
                {hasKids && !q && <button type="button" className="linkish" onClick={() => toggle(n.seq)} aria-label={open.has(n.seq) ? "بستن" : "باز کردن"}>{open.has(n.seq) ? "▾" : "◂"}</button>} <bdi>{n.name}</bdi>
              </td>
              <td className="mono sm">{n.code || ""}</td><td className="sm">{n.unit || ""}</td>
              <td className="sm">{n.qty != null ? num(n.qty) : ""}</td>
              <td className="sm mono">{n.wf != null ? (n.wf * 100).toFixed(4) : ""}</td>
              <td className="sm">{n.stepWeight != null ? pct(n.stepWeight, 0) : ""}</td>
              <td className="sm">{pct(n.progress)}</td>
              <td className="sm" style={moved ? { color: "var(--ok)", fontWeight: 700 } : undefined}>
                {pct(n.now)}{n.report && <div className="muted sm">{n.report.as_of} · {n.report.source}</div>}</td>
              <td className="sm">{el ? (task ? <><bdi>{task.name}</bdi><div className="muted sm">{el.by === "person" ? "پیوند دستی" : el.by === "code" ? "هم‌کد" : "هم‌نام"} · {task.bl_start}→{task.bl_finish}</div></> : <span className="muted">بدون پیوند</span>) : ""}</td>
              {may && <td>
                {n.kind === "step" && <button className="btn ghost sm" type="button" onClick={() => setEdit({ seq: n.seq, kind: "progress" })}>ثبت پیشرفت</button>}
                {el && <button className="btn ghost sm" type="button" onClick={() => setEdit({ seq: n.seq, kind: "link" })}>پیوند</button>}
              </td>}
            </tr>,
            edit?.seq === n.seq && (
              <tr key={`${n.seq}-edit`}><td colSpan={may ? 10 : 9}>
                {edit.kind === "progress"
                  ? <ProgressForm n={n} onCancel={() => setEdit(null)} onSave={async (f) => { if (await post({ kind: "progress", seq: n.seq, ...f })) setEdit(null); }} />
                  : <LinkForm el={el} summaries={summaries} onCancel={() => setEdit(null)} onSave={async (uid) => { if (await post({ kind: "link", seq: n.seq, taskUid: uid })) setEdit(null); }} />}
              </td></tr>
            ),
          ];
        })}</tbody>
      </table></div>
      {rows.length > shown.length && <p className="muted sm">{shown.length} ردیف از {rows.length} نشان داده شد؛ جست‌وجو را دقیق‌تر کنید.</p>}
    </div>
  );
}

function ProgressForm({ n, onSave, onCancel }) {
  const [f, setF] = useState({ asOf: today(), pct: n.now != null ? Math.round(n.now * 100) : "", source: "" });
  return (
    <form className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <b className="sm"><bdi>{n.code}</bdi> — <bdi>{n.name}</bdi></b>
      <div className="field"><label htmlFor={`pg-d-${n.seq}`}>تاریخ</label><input id={`pg-d-${n.seq}`} type="date" max={today()} required value={f.asOf} onChange={(e) => setF({ ...f, asOf: e.target.value })} /></div>
      <div className="field"><label htmlFor={`pg-p-${n.seq}`}>درصد انجام (تجمعی)</label><input id={`pg-p-${n.seq}`} type="number" min="0" max="100" step="any" required value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} /></div>
      <div className="field"><label htmlFor={`pg-s-${n.seq}`}>منبع (مثلاً شمارهٔ گزارش روزانه)</label><input id={`pg-s-${n.seq}`} required value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></div>
      <button className="btn" type="submit">ثبت</button><button className="btn ghost" type="button" onClick={onCancel}>انصراف</button>
    </form>
  );
}

function LinkForm({ el, summaries, onSave, onCancel }) {
  const [uid, setUid] = useState(el?.uid ?? "");
  return (
    <form className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); onSave(uid === "" ? null : Number(uid)); }}>
      <div className="field" style={{ minWidth: 320 }}><label htmlFor={`lk-${el.seq}`}>فعالیت خلاصهٔ برنامه</label>
        <select id={`lk-${el.seq}`} value={uid} onChange={(e) => setUid(e.target.value)}>
          <option value="">— بدون پیوند —</option>
          {summaries.map((t) => <option key={t.uid} value={t.uid}>{t.outline} · {t.name}</option>)}
        </select></div>
      <button className="btn" type="submit">ذخیره</button><button className="btn ghost" type="button" onClick={onCancel}>انصراف</button>
    </form>
  );
}

// ── the schedule ─────────────────────────────────────────────────────────

function ScheduleCard({ tasks }) {
  const [onlySummary, setOnlySummary] = useState(true);
  const [q, setQ] = useState("");
  const shown = tasks.filter((t) => (!onlySummary || t.is_summary || t.is_milestone) && (!q || t.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="card">
      <h2>برنامهٔ زمان‌بندی</h2>
      <div className="row" style={{ gap: 12, alignItems: "end" }}>
        <div className="field" style={{ flex: 1 }}><label htmlFor="sc-q">جست‌وجو</label><input id="sc-q" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="sm"><input type="checkbox" checked={onlySummary} onChange={(e) => setOnlySummary(e.target.checked)} /> فقط خلاصه‌ها و نقاط عطف</label>
      </div>
      <div className="tablewrap"><table className="dtable">
        <thead><tr><th>WBS</th><th>فعالیت</th><th>شروع</th><th>پایان</th><th>شروع مبنا</th><th>پایان مبنا</th><th>جابه‌جایی پایان</th><th>مدت (روز)</th><th>% انجام</th></tr></thead>
        <tbody>{shown.map((t) => {
          const d = days(t.finish, t.bl_finish);
          return (
            <tr key={t.uid} style={t.is_summary ? { fontWeight: 700 } : undefined}>
              <td className="mono sm">{t.outline}</td>
              <td style={{ paddingInlineStart: 6 + (t.level || 0) * 12 }}>{t.is_milestone && !t.is_summary ? "◆ " : ""}<bdi>{t.name}</bdi></td>
              <td className="mono sm" style={NOWRAP}>{t.start}</td><td className="mono sm" style={NOWRAP}>{t.finish}</td>
              <td className="mono sm muted" style={NOWRAP}>{t.bl_start || "—"}</td><td className="mono sm muted" style={NOWRAP}>{t.bl_finish || "—"}</td>
              <td className="sm" style={d > 0 ? { color: "var(--bad)", ...NOWRAP } : NOWRAP}><bdi dir="ltr">{d == null ? "—" : d > 0 ? `+${d}` : d}</bdi></td>
              <td className="sm">{t.duration_days ?? "—"}</td><td className="sm">{t.pct == null ? "—" : `${t.pct}%`}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </div>
  );
}

// ── problems ─────────────────────────────────────────────────────────────

function ProblemsCard({ p, problemFa }) {
  const unlinked = p.elements.filter((e) => e.uid == null).length;
  return (
    <div className="card" data-badge={p.problems.length || undefined} data-tone={p.problems.length ? "bad" : undefined}>
      <h2>ناسازگاری‌ها</h2>
      <p className="sm">موتور، وزن‌ها و پیشرفت هر گروه را از گام‌ها دوباره حساب کرد و با آنچه فایل نوشته مقایسه کرد. هیچ‌کدام اصلاح نشده‌اند — فقط نشان داده می‌شوند.</p>
      {p.problems.length === 0 ? <p className="empty-note">ناسازگاری‌ای پیدا نشد.</p> : (
        <div className="tablewrap"><table className="dtable">
          <thead><tr><th>ردیف اکسل</th><th>کد</th><th>شرح</th><th>مشکل</th><th>جزئیات</th></tr></thead>
          <tbody>{p.problems.map((x, i) => (
            <tr key={i}><td className="mono">{x.row}</td><td className="mono sm">{x.code || ""}</td><td><bdi>{x.name}</bdi></td>
              <td className="sm">{problemFa[x.kind] || x.kind}</td>
              <td className="sm mono" dir="ltr">{Object.entries(x.detail).map(([k, v]) => `${k}=${typeof v === "number" ? +v.toFixed(6) : v}`).join("  ")}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="sm">{unlinked} آیتم PMS به هیچ فعالیت برنامه پیوند ندارد؛ وزن آن‌ها در منحنی برنامه نیست. از جدول PMS با دکمهٔ «پیوند» وصلشان کنید.</p>
    </div>
  );
}

// ── imports ──────────────────────────────────────────────────────────────

function ImportCard({ s, p, upload, setOk }) {
  const [sf, setSf] = useState(null);
  const [pf, setPf] = useState(null);
  const [dd, setDd] = useState("");
  const [branch, setBranch] = useState("");
  return (
    <div className="card">
      <h2>ورود فایل</h2>
      <h3>برنامهٔ زمان‌بندی (MS Project)</h3>
      <p className="sm">در MS Project: <b>File ◄ Save As ◄ XML Format (*.xml)</b>. فایل ‎.mpp مستقیم خوانده نمی‌شود. هر ورود نگه داشته می‌شود و تازه‌ترین، برنامهٔ جاری است.
        {s && <> جاری: <span className="mono">{s.source_name}</span> ({s.task_count} فعالیت، {String(s.created_at).slice(0, 10)})</>}</p>
      <form className="row" style={{ gap: 8, alignItems: "end" }} onSubmit={async (e) => {
        e.preventDefault(); const r = await upload("schedule", sf); if (r) setOk(`${r.tasks} فعالیت و ${r.links} پیوند وارد شد.`); }}>
        <div className="field"><label htmlFor="up-s">فایل XML</label><input id="up-s" type="file" accept=".xml" required onChange={(e) => setSf(e.target.files[0] || null)} /></div>
        <button className="btn" type="submit">ورود برنامه</button>
      </form>
      <h3>PMS (اکسل)</h3>
      <p className="sm">برگهٔ PMS: سطح در ستون‌های B تا G، کد گام در H، شرح I، واحد J، وزن گام K، W.F در L، مقدار M، پیشرفت کل در AA.
        {p && <> جاری: <span className="mono">{p.import.source_name}</span> ({String(p.import.created_at).slice(0, 10)})</>}</p>
      <form onSubmit={async (e) => {
        e.preventDefault(); const r = await upload("pms", pf, { dataDate: dd, linkWithin: branch });
        if (r) setOk(`${r.steps} گام وارد شد؛ ${r.problems} ناسازگاری؛ ${r.linked} از ${r.elements} آیتم به برنامه پیوند خورد.`); }}>
        <div className="grid2">
          <div className="field"><label htmlFor="up-p">فایل اکسل</label><input id="up-p" type="file" accept=".xlsx,.xls" required onChange={(e) => setPf(e.target.files[0] || null)} /></div>
          <div className="field"><label htmlFor="up-d">تاریخ داده (اگر می‌دانید)</label><input id="up-d" type="date" max={today()} value={dd} onChange={(e) => setDd(e.target.value)} /></div>
          <div className="field"><label htmlFor="up-b">پیوند خودکار به برنامه برای شاخهٔ (مثلاً OLF1)</label><input id="up-b" dir="ltr" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="خالی: بدون پیوند خودکار" /></div>
        </div>
        <button className="btn" type="submit">ورود PMS</button>
      </form>
    </div>
  );
}
