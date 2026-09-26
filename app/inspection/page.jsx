"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";

/**
 * Inspection: the ITP (who holds, who witnesses, what is checked against
 * what) and the requests made against it.
 *
 * The state of a request — awaiting, released, rejected — is the engine's
 * reading of the results (lib/inspection/itp.mjs); this page never works it
 * out. A step the project's ITP holds is refused on every discipline's page
 * until its request is released, and the refusal names the ITP row.
 */
const STATE = { awaiting: ["warn", "منتظر"], released: ["ok", "آزاد شد"], rejected: ["bad", "رد"], cancelled: ["", "لغو"] };
const OUT_TONE = { accepted: "ok", accepted_comments: "ok", rejected: "bad", not_attended: "warn" };
const ITEM_KIND_FA = { tag: "تگ", spool: "اسپول", cable: "کابل", instrument: "ابزار", coating_item: "رنگ", lot: "لات انبار" };

export default function InspectionPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/inspection?projectId=${id}`, []);
  const [tab, setTab] = useState("board");
  const [msg, setMsg] = useState(null);
  const [raiseFrom, setRaiseFrom] = useState(null);     // a rejected request to re-inspect
  const may = { record: can({ role }, ACTIONS.RECORD_INSPECTION), itp: can({ role }, ACTIONS.MANAGE_ITP), ncr: can({ role }, ACTIONS.RECORD_QUALITY) };

  async function post(body) {
    setMsg(null);
    try {
      const r = await call("/api/inspection", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return r || true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const now = Date.now();
  const live = data.board.filter((r) => r.state.state === "awaiting");
  const overdue = live.filter((r) => Date.parse(r.planned_at) < now - 3_600_000);
  const next24 = live.filter((r) => Date.parse(r.planned_at) >= now && Date.parse(r.planned_at) < now + 86_400_000);
  const decided = data.board.filter((r) => ["released", "rejected"].includes(r.state.state));
  const firstTime = decided.filter((r) => !r.reinspection_of);
  const firstPass = firstTime.length ? Math.round(100 * firstTime.filter((r) => r.state.state === "released").length / firstTime.length) : null;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>بازرسی</h1>
        <span className="sub">{data.itps.filter((i) => i.status === "approved").length} ITP در حال اجرا · {live.length} درخواست منتظر
          · طرف شما: {data.myParty ? data.parties[data.myParty] : "تعیین نشده"}</span>
      </div>
      {msg && <p className="err" role="alert">{msg}</p>}

      <div className="kpis">
        <Kpi v={next24.length} l="بازرسی ۲۴ ساعت آینده" />
        <Kpi v={overdue.length} l="گذشته و بی‌نتیجه" b="زمان بازرسی گذشته" tone={overdue.length ? "bad" : "ok"} />
        <Kpi v={live.length} l="منتظر نتیجه" tone={live.length ? "warn" : ""} />
        <Kpi v={firstPass === null ? "—" : `${firstPass}%`} l="قبولی در بار اول" b={`${firstTime.length} بازرسی تصمیم‌گرفته`} />
        <Kpi v={data.noticeHours ? `${data.noticeHours} h` : "—"} l="اطلاع‌رسانی لازم" tone={data.noticeHours ? "" : "warn"}
             b={data.noticeHours ? "پیش از زمان بازرسی" : "اعلام نشده — غیبت Witness چیزی را آزاد نمی‌کند"} />
      </div>
      {!data.myParty && (may.record) && (
        <p className="muted sm">برای ثبت درخواست یا امضای نتیجه، مدیر پروژه باید در «کاربران و دسترسی» طرف بازرسی شما را تعیین کند (پیمانکار، کارفرما یا TPI).</p>
      )}

      <div className="tabs" role="tablist" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[["board", "درخواست‌های بازرسی"], ["itp", "ITP"], ["item", "پروندهٔ آیتم"]].map(([k, t]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`btn ${tab === k ? "" : "ghost"}`} onClick={() => setTab(k)}>{t}</button>
        ))}
      </div>

      {tab === "board" && <>
        {may.record && data.myParty === "contractor" && (
          // Re-inspecting a rejected request opens the form, filled in.
          <Fold key={raiseFrom?.id || "new"} title={raiseFrom ? `بازرسی دوباره پس از رد ${raiseFrom.ir_no}` : "درخواست بازرسی جدید"} defaultOpen={!!raiseFrom}>
            <RaiseForm data={data} post={post} from={raiseFrom} onDone={() => setRaiseFrom(null)} />
          </Fold>
        )}
        <Board data={data} post={post} may={may} onReinspect={(r) => { setRaiseFrom(r); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
      </>}
      {tab === "itp" && <ItpTab data={data} post={post} may={may} />}
      {tab === "item" && <ItemTab data={data} />}
    </div>
  );
}

// ── requests ─────────────────────────────────────────────────────────────

function Board({ data, post, may, onReinspect }) {
  const [filter, setFilter] = useState("live");
  const [open, setOpen] = useState(null);
  const now = Date.now();
  const rows = data.board.filter((r) => filter === "all" || (filter === "live" ? r.state.state === "awaiting"
    : filter === "overdue" ? r.state.state === "awaiting" && Date.parse(r.planned_at) < now - 3_600_000 : r.state.state === filter));
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2>درخواست‌های بازرسی</h2>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }} className="no-print">
          <select aria-label="فیلتر" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="live">منتظر نتیجه</option><option value="overdue">گذشته و بی‌نتیجه</option>
            <option value="released">آزادشده</option><option value="rejected">رد</option><option value="all">همه</option>
          </select>
          <button className="btn ghost" onClick={() => window.print()}>چاپ برنامه</button>
        </div>
      </div>
      {rows.length === 0 ? <p className="empty-note">درخواستی نیست.</p> : (
        <TableKit name="inspection">
          <table className="dtable">
            <thead><tr><th>شماره</th><th>آیتم</th><th>فعالیت ITP</th><th>زمان بازرسی</th><th>طرف‌ها</th><th>وضعیت</th><th className="no-print" /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const [tone, label] = STATE[r.state.state];
                const late = r.state.state === "awaiting" && Date.parse(r.planned_at) < now - 3_600_000;
                return [
                  <tr key={r.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{r.ir_no}{r.reinspection_of && <div className="muted sm">بازرسی دوباره</div>}</td>
                    <td><bdi dir="ltr" className="mono">{r.itemLabel}</bdi> <span className="muted sm">{ITEM_KIND_FA[r.item_kind]}{r.subsystem_code && <> · <bdi dir="ltr">{r.subsystem_code}</bdi></>}</span>
                      {r.location && <div className="muted sm">{r.location}</div>}</td>
                    <td><bdi dir="ltr" className="mono sm">{r.itp_no} rev {r.revision} · {r.seq}</bdi><div>{r.activity.title}</div></td>
                    <td className={`sm ${late ? "bad" : ""}`} style={{ whiteSpace: "nowrap" }}><bdi>{when(r.planned_at)}</bdi>
                      <div className="muted sm">{notice(r, data.noticeHours)}</div></td>
                    <td><Parties r={r} data={data} /></td>
                    <td><span className={`pill ${tone}`}>{label}</span>{r.ncr_no && <div className="sm mono">{r.ncr_no}</div>}</td>
                    <td className="no-print"><button className="btn ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "بستن" : "اقدام"}</button></td>
                  </tr>,
                  open === r.id && <tr key={r.id + "-x"} className="no-print"><td colSpan={7}><IrPanel r={r} data={data} post={post} may={may} onReinspect={onReinspect} /></td></tr>,
                ];
              })}
            </tbody>
          </table>
        </TableKit>
      )}
    </div>
  );
}

function Parties({ r, data }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {r.state.parties.map((p) => (
        <span key={p.party} className="sm" title={p.why || ""}>
          <b className="mono">{p.point}</b> {data.parties[p.party]}:{" "}
          {p.outcome ? <span className={`pill ${OUT_TONE[p.outcome]}`}>{data.outcomes[p.outcome]}</span>
            : <span className="muted">{p.point === "H" || p.point === "W" ? "—" : "اختیاری"}</span>}
          {!p.satisfied && p.why && p.outcome && <span className="muted"> ({p.why})</span>}
        </span>
      ))}
    </div>
  );
}

function IrPanel({ r, data, post, may, onReinspect }) {
  const mine = data.myParty;
  const [f, setF] = useState({ outcome: "accepted", aboutParty: "", inspectorName: "", comments: "" });
  const [reason, setReason] = useState("");
  const [sev, setSev] = useState("minor");
  const signed = r.results.map((x) => x.party);
  const canSign = may.record && mine && r.state.state === "awaiting";
  const absentees = r.state.parties.filter((p) => p.party !== "contractor" && !signed.includes(p.party));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="sm">
        {r.activity.reference && <div>مرجع: {r.activity.reference}</div>}
        {r.activity.criteria && <div>معیار پذیرش: {r.activity.criteria}</div>}
        {r.activity.record && <div>سند: {r.activity.record}</div>}
        {r.note && <div>یادداشت: {r.note}</div>}
        <div className="muted">ثبت: {r.raised_by_name || "—"} · {when(r.raised_at)}</div>
      </div>
      {r.results.length > 0 && (
        <ol className="sm" style={{ margin: 0, paddingInlineStart: 18 }}>
          {r.results.map((x) => <li key={x.id}>{when(x.recorded_at)} — <b>{data.parties[x.party]}</b>: {data.outcomes[x.outcome]}
            {x.inspector_name && ` (${x.inspector_name})`}{x.by_name && ` — ثبت: ${x.by_name}`}{x.comments && `: «${x.comments}»`}</li>)}
        </ol>
      )}
      {r.cancelled_at && <p className="muted sm">لغو شد: {r.cancel_reason}</p>}
      {canSign && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <div className="field"><label htmlFor={`o-${r.id}`}>نتیجه ({data.parties[mine]})</label>
            <select id={`o-${r.id}`} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>
              <option value="accepted">پذیرفته</option><option value="accepted_comments">پذیرفته با ملاحظات</option><option value="rejected">رد</option>
              {mine === "contractor" && absentees.length > 0 && <option value="not_attended">طرف دیگر حاضر نشد</option>}
            </select></div>
          {f.outcome === "not_attended" && (
            <div className="field"><label htmlFor={`a-${r.id}`}>چه کسی حاضر نشد</label>
              <select id={`a-${r.id}`} value={f.aboutParty} onChange={(e) => setF({ ...f, aboutParty: e.target.value })}>
                <option value="">—</option>{absentees.map((p) => <option key={p.party} value={p.party}>{data.parties[p.party]} ({p.point})</option>)}
              </select></div>
          )}
          {f.outcome !== "not_attended" && <div className="field"><label htmlFor={`n-${r.id}`}>نام بازرس</label>
            <input id={`n-${r.id}`} value={f.inspectorName} onChange={(e) => setF({ ...f, inspectorName: e.target.value })} /></div>}
          <div className="field" style={{ flex: "1 1 240px" }}><label htmlFor={`c-${r.id}`}>{f.outcome === "rejected" ? "دلیل رد (لازم)" : "ملاحظات"}</label>
            <input id={`c-${r.id}`} value={f.comments} onChange={(e) => setF({ ...f, comments: e.target.value })} /></div>
          <button className="btn" onClick={() => post({ kind: "result", irId: r.id, ...f })}>ثبت و امضا</button>
        </div>
      )}
      {may.record && mine === "contractor" && r.state.state === "awaiting" && (
        <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <div className="field" style={{ flex: "1 1 240px" }}><label htmlFor={`x-${r.id}`}>دلیل لغو</label>
            <input id={`x-${r.id}`} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <button className="btn ghost" onClick={() => post({ kind: "cancel", irId: r.id, reason })}>لغو درخواست</button>
        </div>
      )}
      {r.state.state === "rejected" && (
        <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          {may.record && mine === "contractor" && <button className="btn" onClick={() => onReinspect(r)}>درخواست بازرسی دوباره</button>}
          {may.ncr && !r.ncr_id && <>
            <div className="field"><label htmlFor={`s-${r.id}`}>شدت NCR</label>
              <select id={`s-${r.id}`} value={sev} onChange={(e) => setSev(e.target.value)}><option value="minor">جزئی</option><option value="major">عمده</option></select></div>
            <button className="btn ghost" onClick={() => post({ kind: "ncr", irId: r.id, severity: sev })}>ثبت NCR از این رد</button>
          </>}
        </div>
      )}
      {!mine && may.record && <p className="muted sm">طرف بازرسی شما تعیین نشده؛ امضا ممکن نیست.</p>}
    </div>
  );
}

function RaiseForm({ data, post, from, onDone }) {
  const { projectId, call } = usePlatform();
  const approved = data.itps.filter((i) => i.status === "approved");
  const [scope, setScope] = useState("");
  const [items, setItems] = useState([]);
  const blank = { activityId: "", itemId: "", plannedAt: soon(), location: "", note: "" };
  const [f, setF] = useState(blank);
  const [reinspect, setReinspect] = useState(null);
  const scopes = [...new Set(approved.map((i) => i.scope))];
  const acts = approved.filter((i) => i.scope === scope).flatMap((i) => i.activities.map((a) => ({ ...a, itpNo: i.itp_no, rev: i.revision })));

  useEffect(() => {
    if (!from) return;
    const itp = approved.find((i) => i.itp_no === from.itp_no);
    setScope(itp?.scope || from.scope);
    const act = itp?.activities.find((a) => a.seq === from.seq);
    setF({ ...blank, activityId: act?.id || "", itemId: from.item_id, location: from.location || "" });
    setReinspect(from);
  }, [from]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!scope) { setItems([]); return; }
    let live = true;
    call(`/api/inspection?projectId=${projectId}&scope=${scope}`).then((r) => live && setItems(r.items)).catch(() => live && setItems([]));
    return () => { live = false; };
  }, [scope, projectId, call]);

  const hours = f.plannedAt ? (Date.parse(f.plannedAt) - Date.now()) / 3_600_000 : null;
  const short = data.noticeHours && hours !== null && hours < data.noticeHours;
  const act = acts.find((a) => a.id === f.activityId);
  return (
    <form className="card" onSubmit={async (e) => {
      e.preventDefault();
      const kind = SCOPE_ITEM[scope];
      if (await post({ kind: "raise", activityId: f.activityId, itemKind: kind, itemId: f.itemId, plannedAt: new Date(f.plannedAt).toISOString(),
        location: f.location, note: f.note, reinspectionOf: reinspect?.id || null })) { setF(blank); setReinspect(null); onDone(); }
    }}>
      <h2>{reinspect ? `بازرسی دوباره پس از رد ${reinspect.ir_no}` : "درخواست بازرسی جدید"}</h2>
      {!approved.length ? <p className="empty-note">هنوز ITP تأییدشده‌ای نیست؛ درخواست بازرسی در برابر ITP در حال اجرا ثبت می‌شود.</p> : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <div className="field"><label htmlFor="r-scope">نوع کار</label>
            <select id="r-scope" value={scope} onChange={(e) => { setScope(e.target.value); setF({ ...f, activityId: "", itemId: "" }); }}>
              <option value="">—</option>{scopes.map((s) => <option key={s} value={s}>{data.scopes[s].title}</option>)}
            </select></div>
          <div className="field" style={{ flex: "1 1 220px" }}><label htmlFor="r-act">فعالیت ITP</label>
            <select id="r-act" value={f.activityId} onChange={(e) => setF({ ...f, activityId: e.target.value })}>
              <option value="">—</option>{acts.map((a) => <option key={a.id} value={a.id}>{a.itpNo} · {a.seq} — {a.title} ({pointsText(a.points)})</option>)}
            </select></div>
          <div className="field"><label htmlFor="r-item">آیتم</label>
            <select id="r-item" value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
              <option value="">—</option>{items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select></div>
          <div className="field"><label htmlFor="r-at">زمان بازرسی</label>
            <input id="r-at" type="datetime-local" dir="ltr" value={f.plannedAt} onChange={(e) => setF({ ...f, plannedAt: e.target.value })} /></div>
          <div className="field"><label htmlFor="r-loc">محل</label>
            <input id="r-loc" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
          <div className="field" style={{ flex: "1 1 200px" }}><label htmlFor="r-note">یادداشت</label>
            <input id="r-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          <button className="btn" type="submit" disabled={!f.activityId || !f.itemId}>ثبت درخواست</button>
          {reinspect && <button className="btn ghost" type="button" onClick={() => { setReinspect(null); setF(blank); onDone(); }}>انصراف</button>}
        </div>
      )}
      {act && <p className="sm muted">{act.criteria && `معیار: ${act.criteria} · `}{act.record && `سند: ${act.record} · `}
        {act.stepCode ? `مرحلهٔ «${data.scopes[scope].steps.find((s) => s.code === act.stepCode)?.title}» تا آزادسازی ثبت نمی‌شود` : "به مرحلهٔ زنجیره وصل نیست"}</p>}
      {hours !== null && <p className={`sm ${short ? "err" : "muted"}`}>اطلاع‌رسانی: {Math.max(0, Math.round(hours))} ساعت
        {data.noticeHours ? ` · حداقل پروژه ${data.noticeHours} ساعت${short ? " — کمتر است؛ غیبت Witness کار را آزاد نمی‌کند" : ""}` : " · حداقل پروژه اعلام نشده"}</p>}
    </form>
  );
}

// ── ITP ──────────────────────────────────────────────────────────────────

function ItpTab({ data, post, may }) {
  const [sel, setSel] = useState(data.itps[0]?.id || null);
  const itp = data.itps.find((i) => i.id === sel);
  const [nf, setNf] = useState({ itpNo: "", revision: "0", title: "", scope: "foundation" });
  const [hours, setHours] = useState(data.noticeHours ?? "");
  return (
    <>
      <div className="card">
        <h2>ITPها</h2>
        {data.itps.length === 0 ? <p className="empty-note">ITP تعریف نشده است. تا ITP تأییدشده‌ای نباشد، هیچ مرحله‌ای به بازرسی گره نمی‌خورد.</p> : (
          <TableKit name="inspection"><table className="dtable">
            <thead><tr><th>شماره</th><th>رویژن</th><th>عنوان</th><th>نوع کار</th><th>ردیف</th><th>H/W</th><th>وضعیت</th><th>تهیه / تأیید</th></tr></thead>
            <tbody>{data.itps.map((i) => (
              <tr key={i.id} onClick={() => setSel(i.id)} style={{ cursor: "pointer", background: sel === i.id ? "var(--raise)" : undefined }}>
                <td className="mono">{i.itp_no}</td><td className="mono">{i.revision}</td><td>{i.title}</td><td>{i.scopeTitle}</td>
                <td className="mono">{i.activities.length}</td>
                <td className="mono">{i.activities.filter((a) => Object.values(a.points).some((p) => p === "H" || p === "W")).length}</td>
                <td><span className={`pill ${i.status === "approved" ? "ok" : i.status === "draft" ? "warn" : ""}`}>
                  {{ approved: "در حال اجرا", draft: "پیش‌نویس", superseded: "منسوخ" }[i.status]}</span></td>
                <td className="sm">{i.prepared_by_name || "—"}{i.approved_by_name && ` / ${i.approved_by_name} (${fa(i.approved_on)})`}</td>
              </tr>))}</tbody>
          </table></TableKit>
        )}
        {may.itp && (
          <Fold title="ITP یا رویژن جدید" hint="رویژن جدید از رویژن قبلی کپی می‌شود">
          <form style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }} onSubmit={async (e) => {
            e.preventDefault();
            const r = await post({ kind: "itp", ...nf });
            if (r?.itp) setSel(r.itp.id);
          }}>
            <div className="field"><label htmlFor="n-no">شمارهٔ ITP</label><input id="n-no" dir="ltr" value={nf.itpNo} onChange={(e) => setNf({ ...nf, itpNo: e.target.value })} /></div>
            <div className="field"><label htmlFor="n-rev">رویژن</label><input id="n-rev" dir="ltr" size={4} value={nf.revision} onChange={(e) => setNf({ ...nf, revision: e.target.value })} /></div>
            <div className="field" style={{ flex: "1 1 200px" }}><label htmlFor="n-t">عنوان</label><input id="n-t" value={nf.title} onChange={(e) => setNf({ ...nf, title: e.target.value })} /></div>
            <div className="field"><label htmlFor="n-s">نوع کار</label>
              <select id="n-s" value={nf.scope} onChange={(e) => setNf({ ...nf, scope: e.target.value })}>
                {Object.entries(data.scopes).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}</select></div>
            <button className="btn ghost" type="submit">ITP یا رویژن جدید</button>
          </form>
          </Fold>
        )}
        {may.itp && (
          <div style={{ display: "flex", gap: 8, alignItems: "end", marginTop: 8 }}>
            <div className="field"><label htmlFor="n-h">ساعت اطلاع‌رسانی لازم پیش از بازرسی</label>
              <input id="n-h" type="number" dir="ltr" min={1} value={hours} onChange={(e) => setHours(e.target.value)} /></div>
            <button className="btn ghost" onClick={() => post({ kind: "notice", hours })}>ذخیره</button>
            <span className="muted sm">سیاست پروژه (معمولاً در یادداشت‌های عمومی ITP). بدون آن، غیبت طرف Witness چیزی را آزاد نمی‌کند.</span>
          </div>
        )}
      </div>
      {itp && <ItpMatrix itp={itp} data={data} post={post} may={may} />}
      <div className="card sm muted">
        {Object.entries(data.points).map(([k, v]) => <span key={k} style={{ marginInlineEnd: 16 }}><b className="mono">{k}</b> {v}</span>)}
      </div>
    </>
  );
}

function ItpMatrix({ itp, data, post, may }) {
  const draft = itp.status === "draft" && may.itp;
  const blank = { id: null, seq: String((Math.max(0, ...itp.activities.map((a) => a.seq)) || 0) + 10), title: "", stepCode: "", reference: "", criteria: "", record: "",
    points: { contractor: "", company: "", tpi: "" } };
  const [f, setF] = useState(blank);
  useEffect(() => setF(blank), [itp.id, itp.activities.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  const steps = data.scopes[itp.scope].steps;
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2 className="mono">{itp.itp_no} rev {itp.revision} — {itp.title}</h2>
        {draft && <button className="btn" onClick={() => post({ kind: "approve", itpId: itp.id })}>تأیید و اجرا</button>}
      </div>
      <p className="muted sm">{itp.status === "draft" ? "پیش‌نویس: تا تأیید، هیچ مرحله‌ای به آن گره نمی‌خورد. تأییدکننده نباید تهیه‌کننده باشد."
        : itp.status === "approved" ? "در حال اجرا و ثابت؛ برای تغییر، رویژن جدید بسازید." : "منسوخ؛ درخواست‌های قبلی همچنان به آن ارجاع دارند."}</p>
      <TableKit name="inspection"><table className="dtable">
        <thead><tr><th>ردیف</th><th>فعالیت</th><th>مرحلهٔ زنجیره</th><th>مرجع</th><th>معیار پذیرش</th><th>سند</th>
          {Object.keys(data.parties).map((p) => <th key={p}>{data.parties[p]}</th>)}{draft && <th />}</tr></thead>
        <tbody>{itp.activities.map((a) => (
          <tr key={a.id}>
            <td className="mono">{a.seq}</td><td>{a.title}</td>
            <td className="sm">{a.stepCode ? steps.find((s) => s.code === a.stepCode)?.title || a.stepCode : <span className="muted">—</span>}</td>
            <td className="sm">{a.reference || "—"}</td><td className="sm">{a.criteria || "—"}</td><td className="sm mono">{a.record || "—"}</td>
            {Object.keys(data.parties).map((p) => <td key={p} className={`mono ${a.points[p] === "H" ? "bad" : a.points[p] === "W" ? "warn" : ""}`}>{a.points[p] || ""}</td>)}
            {draft && <td style={{ whiteSpace: "nowrap" }}>
              <button className="btn ghost" onClick={() => setF({ ...a, seq: String(a.seq), stepCode: a.stepCode || "", reference: a.reference || "", criteria: a.criteria || "",
                record: a.record || "", points: { contractor: a.points.contractor || "", company: a.points.company || "", tpi: a.points.tpi || "" } })}>ویرایش</button>
              <button className="btn ghost" onClick={() => post({ kind: "activity-remove", itpId: itp.id, id: a.id })}>حذف</button></td>}
          </tr>))}</tbody>
      </table></TableKit>
      {draft && (
        <form style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginTop: 8 }} onSubmit={async (e) => {
          e.preventDefault();
          if (await post({ kind: "activity", itpId: itp.id, ...f, seq: Number(f.seq) })) setF(blank);
        }}>
          <div className="field"><label htmlFor="a-seq">ردیف</label><input id="a-seq" type="number" dir="ltr" style={{ width: 70 }} value={f.seq} onChange={(e) => setF({ ...f, seq: e.target.value })} /></div>
          <div className="field" style={{ flex: "1 1 200px" }}><label htmlFor="a-title">فعالیت</label><input id="a-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="field"><label htmlFor="a-step">مرحلهٔ زنجیره (گره)</label>
            <select id="a-step" value={f.stepCode} onChange={(e) => setF({ ...f, stepCode: e.target.value })}>
              <option value="">— بدون گره —</option>{steps.map((s) => <option key={s.code} value={s.code}>{s.title}{s.derived ? " (از داده)" : ""}</option>)}
            </select></div>
          <div className="field"><label htmlFor="a-ref">مرجع</label><input id="a-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
          <div className="field"><label htmlFor="a-cr">معیار پذیرش</label><input id="a-cr" value={f.criteria} onChange={(e) => setF({ ...f, criteria: e.target.value })} /></div>
          <div className="field"><label htmlFor="a-rec">سند</label><input id="a-rec" dir="ltr" value={f.record} onChange={(e) => setF({ ...f, record: e.target.value })} /></div>
          {Object.keys(data.parties).map((p) => (
            <div className="field" key={p}><label htmlFor={`a-${p}`}>{data.parties[p]}</label>
              <select id={`a-${p}`} value={f.points[p]} onChange={(e) => setF({ ...f, points: { ...f.points, [p]: e.target.value } })}>
                <option value="">—</option>{Object.keys(data.points).map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
          ))}
          <button className="btn ghost" type="submit">{f.id ? "ذخیرهٔ ردیف" : "افزودن ردیف"}</button>
          {f.stepCode && steps.find((s) => s.code === f.stepCode)?.derived && <span className="muted sm">این مرحله از داده خوانده می‌شود؛ ردیف در پرونده دیده می‌شود ولی ثبت دستی‌ای نیست که نگه دارد.</span>}
        </form>
      )}
    </div>
  );
}

// ── one item ─────────────────────────────────────────────────────────────

function ItemTab({ data }) {
  const { projectId, call } = usePlatform();
  const [scope, setScope] = useState("");
  const [items, setItems] = useState([]);
  const [itemId, setItemId] = useState("");
  const [file, setFile] = useState(null);
  useEffect(() => {
    if (!scope) return;
    call(`/api/inspection?projectId=${projectId}&scope=${scope}`).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [scope, projectId, call]);
  useEffect(() => {
    if (!itemId) { setFile(null); return; }
    call(`/api/inspection?projectId=${projectId}&itemKind=${SCOPE_ITEM[scope]}&itemId=${itemId}`).then(setFile).catch(() => setFile(null));
  }, [itemId, scope, projectId, call]);
  const owed = file ? file.activities.filter((a) => a.latest?.state.state !== "released") : [];
  return (
    <div className="card">
      <h2>پروندهٔ بازرسی یک آیتم</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <div className="field"><label htmlFor="i-scope">نوع کار</label>
          <select id="i-scope" value={scope} onChange={(e) => { setScope(e.target.value); setItemId(""); }}>
            <option value="">—</option>{Object.entries(data.scopes).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}</select></div>
        <div className="field"><label htmlFor="i-item">آیتم</label>
          <select id="i-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">—</option>{items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></div>
      </div>
      {file && (file.activities.length === 0 ? <p className="empty-note">برای این نوع کار ITP تأییدشده‌ای نیست.</p> : <>
        <p className="sm">{file.activities.length - owed.length} از {file.activities.length} فعالیت آزاد شده
          {owed.length > 0 && <> · <span className="warn">مانده: {owed.map((a) => a.seq).join("، ")}</span></>}</p>
        <TableKit name="inspection"><table className="dtable">
          <thead><tr><th>ITP · ردیف</th><th>فعالیت</th><th>نقاط</th><th>آخرین درخواست</th><th>وضعیت</th></tr></thead>
          <tbody>{file.activities.map((a) => {
            const st = a.latest?.state.state;
            const [tone, label] = st ? STATE[st]
              : a.stepDone ? ["", "درخواست نشده — مرحله پیش از ITP ثبت شده"]
              : a.gates && a.stepCode ? ["bad", "درخواست نشده — مرحله قفل"] : ["", "درخواست نشده"];
            return (
              <tr key={a.id}>
                <td className="mono sm"><bdi dir="ltr">{a.itpNo} · {a.seq}</bdi></td><td>{a.title}</td><td className="mono sm">{pointsText(a.points)}</td>
                <td className="mono sm">{a.latest ? `${a.latest.ir_no} (rev ${a.latest.revision}) · ${when(a.latest.planned_at)}` : "—"}
                  {a.history.length > 1 && <div className="muted">{a.history.length} درخواست</div>}</td>
                <td><span className={`pill ${tone}`}>{label}</span></td>
              </tr>);
          })}</tbody>
        </table></TableKit>
      </>)}
    </div>
  );
}

// ── shared ───────────────────────────────────────────────────────────────

const SCOPE_ITEM = { foundation: "tag", structure: "tag", rotating: "tag", static: "tag", fired: "tag", piping_spool: "spool",
  cable: "cable", instrument: "instrument", coating: "coating_item", material: "lot" };

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}

function notice(r, needed) {
  const h = Math.round((Date.parse(r.planned_at) - Date.parse(r.raised_at)) / 3_600_000);
  return `اطلاع ${h} ساعت${needed ? (h >= needed ? "" : ` (کمتر از ${needed})`) : ""}`;
}
const pointsText = (p) => Object.entries(p).filter(([, v]) => v).map(([k, v]) => `${{ contractor: "Con", company: "Co", tpi: "TPI" }[k]}:${v}`).join(" ");
const when = (d) => (d ? new Date(d).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) : "—");
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
function soon() {
  const d = new Date(Date.now() + 26 * 3_600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}
