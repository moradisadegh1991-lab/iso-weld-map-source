"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlatform } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import { parseFieldCode, KINDS } from "../../lib/field/qr.mjs";
import { newOp, opProblems } from "../../lib/field/ops.mjs";
import { savePack, loadPack, enqueue, listOps, updateOp, removeOp } from "../../lib/client/offline-store.mjs";
import Scanner from "../../components/field/Scanner";

/**
 * The field page: scan or type, see the item, record what was done —
 * with or without a network.
 *
 * What it shows is the pack: the server's judgement of every item at the
 * time printed on it. What someone records here is QUEUED and shown as
 * such beside the item, never folded into its status: only the server's
 * engines decide what a step's record makes of the chain, and they may
 * refuse it. Refusals come back and stay on screen with their reason.
 */
const STATUS_FA = { done: "انجام‌شده", in_progress: "در جریان", not_started: "شروع نشده", blocked: "منتظر پیش‌نیاز" };

export default function FieldPage() {
  const P = usePlatform();
  const { projectId, projects, setProjectId, user, role, online, project } = P;
  const [pack, setPack] = useState(null);          // { savedAt, pack }
  const [ops, setOps] = useState([]);
  const [item, setItem] = useState(null);          // { kind, no }
  const [query, setQuery] = useState("");
  const [scan, setScan] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState(today());
  const [subsystemId, setSubsystemId] = useState("");
  const mayStep = can({ role }, ACTIONS.ASSIGN_WELD);
  const mayPunch = can({ role }, ACTIONS.RECORD_QUALITY);

  // A label opened this page: /field?p=<project>&k=<kind>&n=<no>.
  useEffect(() => {
    const u = new URL(window.location.href);
    const k = u.searchParams.get("k"), n = u.searchParams.get("n"), p = u.searchParams.get("p");
    if (k && n) setItem({ kind: k, no: n });
    if (p && projects?.length) {
      const target = projects.find((x) => x.code === p);
      if (target && target.id !== projectId) setProjectId(target.id);
      if (!target) setMsg(`برچسب مال پروژهٔ «${p}» است که شما عضو آن نیستید.`);
    }
  }, [projects]);   // eslint-disable-line react-hooks/exhaustive-deps

  const refreshOps = useCallback(async () => {
    if (!projectId) return;
    try { setOps(await listOps(projectId)); } catch (e) { setMsg(e.message); }
  }, [projectId]);

  const fetchPack = useCallback(async (sub = subsystemId) => {
    if (!projectId) return;
    setBusy(true);
    try {
      const fresh = await P.call(`/api/field?projectId=${projectId}${sub ? `&subsystemId=${sub}` : ""}`);
      await savePack(projectId, fresh);
      setPack(await loadPack(projectId));
    } catch (e) {
      setMsg(`بستهٔ تازه گرفته نشد (${e.message}) — بستهٔ ذخیره‌شده نمایش داده می‌شود.`);
    } finally { setBusy(false); }
  }, [projectId, subsystemId, P]);

  // On opening: what this phone holds, then — with a network — a fresh copy.
  useEffect(() => {
    if (!projectId) return;
    (async () => {
      try { setPack(await loadPack(projectId)); } catch (e) { setMsg(e.message); }
      await refreshOps();
      if (navigator.onLine !== false && !P.offline) fetchPack();
    })();
  }, [projectId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const sync = useCallback(async () => {
    if (!projectId) return;
    const all = await listOps(projectId);
    const mine = all.filter((o) => o.state === "queued" && o.userId === user?.id);
    if (!mine.length) return;
    setBusy(true);
    try {
      const { results } = await P.call("/api/field", { method: "POST",
        body: JSON.stringify({ projectId, ops: mine.map(({ state, error, userId, label, ...op }) => op) }) });
      for (const r of results) {
        const o = mine.find((x) => x.opId === r.opId);
        if (!o) continue;
        if (r.status === "applied") await removeOp(o.opId);
        else if (r.status === "rejected") await updateOp({ ...o, state: "rejected", error: r.error });
        // "retry": a server fault; it stays queued.
      }
      const applied = results.filter((r) => r.status === "applied").length;
      const refused = results.filter((r) => r.status === "rejected").length;
      setMsg(`همگام‌سازی: ${applied} ثبت شد${refused ? ` · ${refused} رد شد (دلیل پایین صفحه)` : ""}.`);
      await fetchPack();
    } catch (e) {
      setMsg(e?.res?.status === 401 ? "نشست منقضی شده — دوباره وارد شوید؛ صف روی گوشی حفظ شده است."
        : `همگام‌سازی انجام نشد (${e.message}) — صف حفظ شد.`);
    } finally { setBusy(false); await refreshOps(); }
  }, [projectId, user, P, fetchPack, refreshOps]);

  // The network coming back is the moment to send what waited for it.
  useEffect(() => { if (online && !P.offline) sync(); }, [online, P.offline]);  // eslint-disable-line react-hooks/exhaustive-deps
  // And, while anything waits: every minute, and whenever the page is looked
  // at again — a phone in a pocket does not fire "online" when a weak
  // signal steadies.
  useEffect(() => {
    const waiting = ops.some((o) => o.state === "queued" && o.userId === user?.id);
    if (!waiting) return;
    const t = setInterval(() => { if (navigator.onLine !== false) sync(); }, 60_000);
    const seen = () => { if (document.visibilityState === "visible" && navigator.onLine !== false) sync(); };
    document.addEventListener("visibilitychange", seen);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", seen); };
  }, [ops, user, sync]);

  async function capture(kind, payload, label) {
    const op = { ...newOp(kind, payload, { projectId }), userId: user?.id, label };
    const problems = opProblems(op, { today: today() });
    if (problems.length) { setMsg(problems.join(" · ")); return; }
    try { await enqueue(op); } catch (e) { setMsg(`روی گوشی ذخیره نشد: ${e.message}`); return; }
    await refreshOps();
    if (navigator.onLine !== false && !P.offline) await sync();
    else setMsg("در صف ماند — با برگشت شبکه ارسال می‌شود.");
  }

  const p = pack?.pack;
  const found = useMemo(() => (p && item ? find(p, item) : null), [p, item]);

  function go(text) {
    const code = parseFieldCode(text);
    if (!code) { setMsg("این کد مال این سامانه نیست یا شمارهٔ معتبری نیست."); return; }
    if (code.project && project && code.project !== project.code) {
      const target = projects.find((x) => x.code === code.project);
      if (!target) { setMsg(`این برچسب مال پروژهٔ «${code.project}» است.`); return; }
      setProjectId(target.id);
    }
    setMsg(null); setScan(false); setQuery("");
    setItem(code);
  }

  const queued = ops.filter((o) => o.state === "queued");
  const rejected = ops.filter((o) => o.state === "rejected");
  const foreign = queued.filter((o) => o.userId !== user?.id);

  return (
    <div className="page field-page">
      <div className="pagehead">
        <h1>سایت</h1>
        <span className="sub">{online && !P.offline ? "آنلاین" : "آفلاین"} · {queued.length} ثبت در صف
          {p && ` · بسته: ${new Date(p.generatedAt).toLocaleString("fa-IR")}`}</span>
      </div>
      {msg && <p className={/رد شد|نشد|نیست|مال/.test(msg) ? "err" : "muted"} role="status">{msg}</p>}

      <div className="card">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <div className="field" style={{ flex: "1 1 200px" }}><label htmlFor="fq">شمارهٔ تگ، اسپول، کابل یا ابزار</label>
            <input id="fq" dir="ltr" value={query} onChange={(e) => setQuery(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") go(query); }} placeholder="P-1203A" /></div>
          <button className="btn" onClick={() => go(query)}>برو</button>
          <button className="btn ghost" onClick={() => setScan(!scan)}>اسکن QR</button>
          <div className="field"><label htmlFor="fday">تاریخ کار</label>
            <input id="fday" type="date" dir="ltr" value={day} max={today()} onChange={(e) => setDay(e.target.value)} /></div>
        </div>
        {scan && <div style={{ marginTop: 8 }}><Scanner onResult={go} onClose={() => setScan(false)} /></div>}
      </div>

      {!p ? (
        <div className="card"><p className="empty-note">{online ? "در حال گرفتن بستهٔ سایت…" : "بسته‌ای روی این گوشی نیست. یک بار با شبکه این صفحه را باز کنید."}</p></div>
      ) : found ? (
        <ItemCard found={found} p={p} ops={queued} day={day} capture={capture} mayStep={mayStep} mayPunch={mayPunch} onBack={() => setItem(null)} />
      ) : item ? (
        <div className="card"><p className="err">«{item.no}» در بستهٔ این گوشی نیست{pack?.pack?.subsystemId ? " (بسته فقط یک ساب‌سیستم است)" : ""}.</p>
          <button className="btn ghost" onClick={() => setItem(null)}>فهرست</button></div>
      ) : (
        <Browse p={p} ops={queued} open={(kind, no) => setItem({ kind, no })} />
      )}

      {(queued.length > 0 || rejected.length > 0) && (
        <div className="card">
          <h2>صف روی این گوشی</h2>
          {foreign.length > 0 && <p className="err sm">{foreign.length} ثبت مال کاربر دیگری روی این گوشی است و با حساب شما ارسال نمی‌شود.</p>}
          {queued.map((o) => <p key={o.opId} className="queued">در صف — {o.label} · {new Date(o.capturedAt).toLocaleString("fa-IR")}</p>)}
          {rejected.map((o) => (
            <div key={o.opId} className="sm" style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0" }}>
              <span><span className="pill bad">رد شد</span> {o.label}: {o.error}</span>
              <button className="btn ghost" onClick={async () => { await removeOp(o.opId); refreshOps(); }}>دیدم، حذف از فهرست</button>
            </div>
          ))}
          <button className="btn" disabled={busy || !queued.length || !online} onClick={sync}>همگام‌سازی</button>
        </div>
      )}

      <div className="card no-print">
        <h2>آماده‌سازی برای کار بدون شبکه</h2>
        <p className="muted sm">بسته را برای ساب‌سیستمی که امروز در آن کار می‌کنید بگیرید؛ این صفحه و بسته روی گوشی می‌مانند.</p>
        <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <div className="field"><label htmlFor="fsub">ساب‌سیستم</label>
            <select id="fsub" value={subsystemId} onChange={(e) => setSubsystemId(e.target.value)}>
              <option value="">کل پروژه</option>
              {subsystemsOf(p).map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
            </select></div>
          <button className="btn ghost" disabled={busy || !online} onClick={() => fetchPack(subsystemId)}>دریافت بسته</button>
          {pack && <span className="muted sm">روی گوشی: {p.tags.length} تگ، {p.spools.length} اسپول، {p.cables.length} کابل، {p.instruments.length} ابزار</span>}
        </div>
      </div>
    </div>
  );
}

function Browse({ p, ops, open }) {
  const [f, setF] = useState("");
  const rows = p.tags.filter((t) => !f || t.no.includes(f.toUpperCase())).slice(0, 60);
  return (
    <div className="card">
      <div className="field"><label htmlFor="ff">فیلتر تگ‌ها</label><input id="ff" dir="ltr" value={f} onChange={(e) => setF(e.target.value)} /></div>
      {rows.map((t) => {
        const q = ops.filter((o) => o.payload.tagId === t.id).length;
        return (
          <button key={t.id} className="field-step" style={{ width: "100%", background: "none", border: 0, color: "inherit", cursor: "pointer", textAlign: "start" }}
                  onClick={() => open("t", t.no)}>
            <span className="mono">{t.no}</span>
            <span className="muted sm">{t.description}</span>
            <span className="sm">{t.pct === null ? "—" : `${t.pct}%`}{q ? <span className="pill warn"> {q} در صف</span> : null}</span>
          </button>
        );
      })}
    </div>
  );
}

function ItemCard({ found, p, ops, day, capture, mayStep, mayPunch, onBack }) {
  const { kind, row } = found;
  const [punch, setPunch] = useState({ category: "B", description: "" });
  const [clearNote, setClearNote] = useState({});
  const mine = ops.filter((o) => (kind === "t" && o.payload.tagId === row.id) || (kind === "s" && o.payload.spoolId === row.id));
  const openPunch = kind === "t" ? p.punch.filter((x) => x.tag_id === row.id) : [];
  const stepKind = kind === "t" ? "tag_step" : "spool_step";
  const idKey = kind === "t" ? "tagId" : "spoolId";
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="mono" style={{ margin: 0 }}>{KINDS[kind]} {row.no}</h2>
        <button className="btn ghost" onClick={onBack}>فهرست</button>
      </div>
      {row.description && <p className="muted sm">{row.description}</p>}
      <p className="sm">وضعیت طبق بسته ({new Date(p.generatedAt).toLocaleString("fa-IR")}): {row.pct !== undefined && row.pct !== null ? `${row.pct}%` : "—"}
        {row.ready ? <span className="pill ok"> آماده</span> : null}{kind === "t" && <> · <a href={`/asset?tag=${encodeURIComponent(row.no)}`}>شناسنامه</a></>}</p>

      {(kind === "c" || kind === "i") && (
        <p className="sm">{kind === "c" ? `کشش: ${row.is_pulled ? "بله" : "نه"} · آمادهٔ برق‌دار شدن: ${row.is_ready ? "بله" : "نه"}`
          : `نصب: ${row.is_installed ? "بله" : "نه"} · لوپ چک: ${row.is_loop_checked ? "بله" : "نه"} · آماده: ${row.is_ready ? "بله" : "نه"}`}
          {row.tag && ` · تجهیز ${row.tag}`} <span className="muted">(ثبت کابل و ابزار از صفحهٔ رشتهٔ خودش)</span></p>
      )}

      {row.steps && row.steps.map((s) => {
        const q = mine.find((o) => o.payload.code === s.code);
        const canRecord = mayStep && !s.derived && !s.na && s.status !== "done" && !q;
        return (
          <div key={s.code} className="field-step">
            <span>{s.title}</span>
            <span className="sm">
              {s.na ? <span className="muted">لازم نیست</span>
                : <span className={`pill ${s.status === "done" ? "ok" : ""}`}>{STATUS_FA[s.status] || s.status}</span>}
              {s.derived && <span className="muted"> · از داده</span>}
              {q && <span className="queued"> در صف ({q.payload.doneOn})</span>}
            </span>
            {canRecord && <button className="btn ghost" onClick={() => capture(stepKind, { [idKey]: row.id, code: s.code, doneOn: day },
              `${row.no}: ${s.title}`)}>انجام شد</button>}
          </div>
        );
      })}
      {row.steps === null && kind === "t" && <p className="muted sm">برای نوع این تگ زنجیرهٔ پیش‌نیاز تعریف نشده.</p>}

      {kind === "t" && (
        <div style={{ marginTop: 10 }}>
          <b className="sm">Punch باز</b>
          {openPunch.length === 0 && <p className="muted sm">ندارد</p>}
          {openPunch.map((x) => {
            const q = mine.find((o) => o.kind === "punch_clear" && o.payload.punchId === x.id);
            return (
              <div key={x.id} className="field-step">
                <span className="sm"><span className={`pill ${x.category === "A" ? "bad" : "warn"}`}>{x.category}</span> {x.punch_no} — {x.description}</span>
                {x.status === "cleared" ? <span className="muted sm">رفع‌شده، منتظر تأیید</span>
                  : q ? <span className="queued">رفع در صف</span>
                  : mayPunch && <span style={{ display: "flex", gap: 6 }}>
                      <input aria-label="شرح رفع" dir="auto" placeholder="چه کاری انجام شد" value={clearNote[x.id] || ""}
                             onChange={(e) => setClearNote({ ...clearNote, [x.id]: e.target.value })} />
                      <button className="btn ghost" onClick={() => capture("punch_clear", { punchId: x.id, note: clearNote[x.id] || "", clearedOn: day },
                        `${x.punch_no}: رفع`)}>رفع شد</button>
                    </span>}
              </div>
            );
          })}
          {mine.filter((o) => o.kind === "punch_raise").map((o) => <p key={o.opId} className="queued">Punch در صف: {o.payload.category} — {o.payload.description}</p>)}
          {mayPunch && (
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <select aria-label="دسته" value={punch.category} onChange={(e) => setPunch({ ...punch, category: e.target.value })}>
                <option>A</option><option>B</option><option>C</option></select>
              <input aria-label="شرح Punch" dir="auto" style={{ flex: 1 }} placeholder="شرح آیتم Punch" value={punch.description}
                     onChange={(e) => setPunch({ ...punch, description: e.target.value })} />
              <button className="btn ghost" onClick={async () => {
                await capture("punch_raise", { tagId: row.id, category: punch.category, description: punch.description, raisedOn: day },
                  `${row.no}: Punch ${punch.category}`);
                setPunch({ ...punch, description: "" });
              }}>ثبت Punch</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Find an item in the pack. A bare typed number may be any kind; a label says which. */
function find(p, { kind, no }) {
  const N = String(no).toUpperCase();
  const lists = { t: p.tags, s: p.spools, c: p.cables, i: p.instruments };
  const order = kind === "t" ? ["t", "s", "c", "i"] : [kind];
  for (const k of order) {
    const row = (lists[k] || []).find((x) => String(x.no).toUpperCase() === N);
    if (row) return { kind: k, row };
  }
  return null;
}

const subsystemsOf = (p) => p?.subsystems || [];

const today = () => new Date().toISOString().slice(0, 10);
