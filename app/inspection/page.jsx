"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * Inspection: the ITP (who holds, who witnesses, what is checked against
 * what) and the requests made against it.
 *
 * The state of a request — awaiting, released, rejected — is the engine's
 * reading of the results (lib/inspection/itp.mjs); this page never works it
 * out. A step the project's ITP holds is refused on every discipline's page
 * until its request is released, and the refusal names the ITP row.
 */
// Tones; the words are the section's dictionary (lib/i18n/sections/quality.mjs: insp.st.*, insp.kind.*)
// and the ITP's own labels (lib/i18n/labels.mjs: itp.*).
const STATE_TONE = { awaiting: "warn", released: "ok", rejected: "bad", cancelled: "" };
const OUT_TONE = { accepted: "ok", accepted_comments: "ok", rejected: "bad", not_attended: "warn" };

export default function InspectionPage() {
  const { projectId, role, call } = usePlatform();
  const { t, L } = usePrefs();
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
  if (!data) return <p className="muted">{t("common.loading")}</p>;
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
        <h1>{t("insp.title")}</h1>
        <span className="sub">{t("insp.sub", { itps: data.itps.filter((i) => i.status === "approved").length, live: live.length,
          party: data.myParty ? L(`itp.party.${data.myParty}`, data.parties[data.myParty]) : t("insp.noParty") })}</span>
      </div>
      {msg && <p className="err" role="alert">{msg}</p>}

      <div className="kpis">
        <Kpi v={next24.length} l={t("insp.kpi.next24")} />
        <Kpi v={overdue.length} l={t("insp.kpi.overdue")} b={t("insp.kpi.overdueB")} tone={overdue.length ? "bad" : "ok"} />
        <Kpi v={live.length} l={t("insp.kpi.live")} tone={live.length ? "warn" : ""} />
        <Kpi v={firstPass === null ? "—" : `${firstPass}%`} l={t("insp.kpi.firstPass")} b={t("insp.kpi.decided", { n: firstTime.length })} />
        <Kpi v={data.noticeHours ? `${data.noticeHours} h` : "—"} l={t("insp.kpi.notice")} tone={data.noticeHours ? "" : "warn"}
             b={data.noticeHours ? t("insp.kpi.noticeB") : t("insp.kpi.noticeNone")} />
      </div>
      {!data.myParty && (may.record) && (
        <p className="muted sm">{t("insp.setParty")}</p>
      )}

      <div className="ptabs no-print" role="tablist">
        {[["board", t("insp.tab.board")], ["itp", t("insp.tab.itp")], ["item", t("insp.tab.item")]].map(([k, x]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{x}</button>
        ))}
      </div>

      {tab === "board" && <>
        {may.record && data.myParty === "contractor" && (
          // Re-inspecting a rejected request opens the form, filled in.
          <Fold key={raiseFrom?.id || "new"} title={raiseFrom ? t("insp.reinspectAfter", { no: raiseFrom.ir_no }) : t("insp.newRequest")} defaultOpen={!!raiseFrom}>
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
  const { t, L, dateTime } = usePrefs();
  const [filter, setFilter] = useState("live");
  const [open, setOpen] = useState(null);
  const now = Date.now();
  const rows = data.board.filter((r) => filter === "all" || (filter === "live" ? r.state.state === "awaiting"
    : filter === "overdue" ? r.state.state === "awaiting" && Date.parse(r.planned_at) < now - 3_600_000 : r.state.state === filter));
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2>{t("insp.tab.board")}</h2>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }} className="no-print">
          <select aria-label={t("c.filter")} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="live">{t("insp.kpi.live")}</option><option value="overdue">{t("insp.kpi.overdue")}</option>
            <option value="released">{t("insp.f.released")}</option><option value="rejected">{t("insp.f.rejected")}</option><option value="all">{t("c.all")}</option>
          </select>
          <button className="btn ghost" onClick={() => window.print()}>{t("insp.printPlan")}</button>
        </div>
      </div>
      {rows.length === 0 ? <p className="empty-note">{t("insp.empty")}</p> : (
        <TableKit name="inspection-1">
          <table className="dtable">
            <thead><tr><th>{t("c.no")}</th><th>{t("c.item")}</th><th>{t("insp.h.itpActivity")}</th><th>{t("insp.h.when")}</th><th>{t("insp.h.parties")}</th><th>{t("c.status")}</th><th className="no-print" /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const tone = STATE_TONE[r.state.state], label = t(`insp.st.${r.state.state}`);
                const late = r.state.state === "awaiting" && Date.parse(r.planned_at) < now - 3_600_000;
                return [
                  <tr key={r.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{r.ir_no}{r.reinspection_of && <div className="muted sm">{t("insp.reinspection")}</div>}</td>
                    <td><bdi dir="ltr" className="mono">{r.itemLabel}</bdi> <span className="muted sm">{t(`insp.kind.${r.item_kind}`)}{r.subsystem_code && <> · <bdi dir="ltr">{r.subsystem_code}</bdi></>}</span>
                      {r.location && <div className="muted sm">{r.location}</div>}</td>
                    <td><bdi dir="ltr" className="mono sm">{r.itp_no} rev {r.revision} · {r.seq}</bdi><div>{r.activity.title}</div></td>
                    <td className={`sm ${late ? "bad" : ""}`} style={{ whiteSpace: "nowrap" }}><bdi>{dateTime(r.planned_at)}</bdi>
                      <div className="muted sm">{notice(t, r, data.noticeHours)}</div></td>
                    <td><Parties r={r} data={data} /></td>
                    <td><span className={`pill ${tone}`}>{label}</span>{r.ncr_no && <div className="sm mono">{r.ncr_no}</div>}</td>
                    <td className="no-print"><button className="btn ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? t("common.close") : t("c.action")}</button></td>
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
  const { t, L } = usePrefs();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {r.state.parties.map((p) => (
        <span key={p.party} className="sm" title={p.why || ""}>
          <b className="mono">{p.point}</b> {L(`itp.party.${p.party}`, data.parties[p.party])}:{" "}
          {p.outcome ? <span className={`pill ${OUT_TONE[p.outcome]}`}>{L(`itp.outcome.${p.outcome}`, data.outcomes[p.outcome])}</span>
            : <span className="muted">{p.point === "H" || p.point === "W" ? "—" : t("insp.optional")}</span>}
          {!p.satisfied && p.why && p.outcome && <span className="muted"> ({p.why})</span>}
        </span>
      ))}
    </div>
  );
}

function IrPanel({ r, data, post, may, onReinspect }) {
  const { t, L, dateTime } = usePrefs();
  const party = (p) => L(`itp.party.${p}`, data.parties[p]);
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
        {r.activity.reference && <div>{t("c.reference")}: {r.activity.reference}</div>}
        {r.activity.criteria && <div>{t("c.criteria")}: {r.activity.criteria}</div>}
        {r.activity.record && <div>{t("c.record")}: {r.activity.record}</div>}
        {r.note && <div>{t("c.note")}: {r.note}</div>}
        <div className="muted">{t("insp.raisedBy", { name: r.raised_by_name || "—", at: dateTime(r.raised_at) })}</div>
      </div>
      {r.results.length > 0 && (
        <ol className="sm" style={{ margin: 0, paddingInlineStart: 18 }}>
          {r.results.map((x) => <li key={x.id}>{dateTime(x.recorded_at)} — <b>{party(x.party)}</b>: {L(`itp.outcome.${x.outcome}`, data.outcomes[x.outcome])}
            {x.inspector_name && ` (${x.inspector_name})`}{x.by_name && t("insp.signedBy", { name: x.by_name })}{x.comments && `: «${x.comments}»`}</li>)}
        </ol>
      )}
      {r.cancelled_at && <p className="muted sm">{t("insp.cancelled", { reason: r.cancel_reason })}</p>}
      {canSign && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <div className="field"><label htmlFor={`o-${r.id}`}>{t("insp.resultOf", { party: party(mine) })}</label>
            <select id={`o-${r.id}`} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>
              {["accepted", "accepted_comments", "rejected"].map((o) => <option key={o} value={o}>{L(`itp.outcome.${o}`, data.outcomes[o])}</option>)}
              {mine === "contractor" && absentees.length > 0 && <option value="not_attended">{t("insp.otherAbsent")}</option>}
            </select></div>
          {f.outcome === "not_attended" && (
            <div className="field"><label htmlFor={`a-${r.id}`}>{t("insp.whoAbsent")}</label>
              <select id={`a-${r.id}`} value={f.aboutParty} onChange={(e) => setF({ ...f, aboutParty: e.target.value })}>
                <option value="">—</option>{absentees.map((p) => <option key={p.party} value={p.party}>{party(p.party)} ({p.point})</option>)}
              </select></div>
          )}
          {f.outcome !== "not_attended" && <div className="field"><label htmlFor={`n-${r.id}`}>{t("insp.inspectorName")}</label>
            <input id={`n-${r.id}`} value={f.inspectorName} onChange={(e) => setF({ ...f, inspectorName: e.target.value })} /></div>}
          <div className="field" style={{ flex: "1 1 240px" }}><label htmlFor={`c-${r.id}`}>{f.outcome === "rejected" ? t("insp.rejectReason") : t("insp.comments")}</label>
            <input id={`c-${r.id}`} value={f.comments} onChange={(e) => setF({ ...f, comments: e.target.value })} /></div>
          <button className="btn" onClick={() => post({ kind: "result", irId: r.id, ...f })}>{t("insp.signResult")}</button>
        </div>
      )}
      {may.record && mine === "contractor" && r.state.state === "awaiting" && (
        <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <div className="field" style={{ flex: "1 1 240px" }}><label htmlFor={`x-${r.id}`}>{t("insp.cancelReason")}</label>
            <input id={`x-${r.id}`} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <button className="btn ghost" onClick={() => post({ kind: "cancel", irId: r.id, reason })}>{t("insp.cancel")}</button>
        </div>
      )}
      {r.state.state === "rejected" && (
        <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          {may.record && mine === "contractor" && <button className="btn" onClick={() => onReinspect(r)}>{t("insp.reinspect")}</button>}
          {may.ncr && !r.ncr_id && <>
            <div className="field"><label htmlFor={`s-${r.id}`}>{t("insp.ncrSeverity")}</label>
              <select id={`s-${r.id}`} value={sev} onChange={(e) => setSev(e.target.value)}><option value="minor">{L("ncr.sev.minor", "جزئی")}</option><option value="major">{L("ncr.sev.major", "عمده")}</option></select></div>
            <button className="btn ghost" onClick={() => post({ kind: "ncr", irId: r.id, severity: sev })}>{t("insp.raiseNcr")}</button>
          </>}
        </div>
      )}
      {!mine && may.record && <p className="muted sm">{t("insp.noPartySign")}</p>}
    </div>
  );
}

function RaiseForm({ data, post, from, onDone }) {
  const { projectId, call } = usePlatform();
  const { t, L } = usePrefs();
  const scopeTitle = (k) => L(`itp.scope.${k}`, data.scopes[k]?.title);
  const stepTitle = (k, s) => L(`chain.${k}.${s.code}`, s.title);
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
      // The kind of item a scope inspects is the server's (lib/inspection SCOPES), not a copy kept here.
      const kind = data.scopes[scope]?.item;
      if (await post({ kind: "raise", activityId: f.activityId, itemKind: kind, itemId: f.itemId, plannedAt: new Date(f.plannedAt).toISOString(),
        location: f.location, note: f.note, reinspectionOf: reinspect?.id || null })) { setF(blank); setReinspect(null); onDone(); }
    }}>
      <h2>{reinspect ? t("insp.reinspectAfter", { no: reinspect.ir_no }) : t("insp.newRequest")}</h2>
      {!approved.length ? <p className="empty-note">{t("insp.noItp")}</p> : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <div className="field"><label htmlFor="r-scope">{t("c.workType")}</label>
            <select id="r-scope" value={scope} onChange={(e) => { setScope(e.target.value); setF({ ...f, activityId: "", itemId: "" }); }}>
              <option value="">—</option>{scopes.map((s) => <option key={s} value={s}>{scopeTitle(s)}</option>)}
            </select></div>
          <div className="field" style={{ flex: "1 1 220px" }}><label htmlFor="r-act">{t("insp.h.itpActivity")}</label>
            <select id="r-act" value={f.activityId} onChange={(e) => setF({ ...f, activityId: e.target.value })}>
              <option value="">—</option>{acts.map((a) => <option key={a.id} value={a.id}>{a.itpNo} · {a.seq} — {a.title} ({pointsText(a.points)})</option>)}
            </select></div>
          <div className="field"><label htmlFor="r-item">{t("c.item")}</label>
            <select id="r-item" value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
              <option value="">—</option>{items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select></div>
          <div className="field"><label htmlFor="r-at">{t("insp.h.when")}</label>
            <input id="r-at" type="datetime-local" dir="ltr" value={f.plannedAt} onChange={(e) => setF({ ...f, plannedAt: e.target.value })} /></div>
          <div className="field"><label htmlFor="r-loc">{t("c.location")}</label>
            <input id="r-loc" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
          <div className="field" style={{ flex: "1 1 200px" }}><label htmlFor="r-note">{t("c.note")}</label>
            <input id="r-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          <button className="btn" type="submit" disabled={!f.activityId || !f.itemId}>{t("insp.submit")}</button>
          {reinspect && <button className="btn ghost" type="button" onClick={() => { setReinspect(null); setF(blank); onDone(); }}>{t("common.cancel")}</button>}
        </div>
      )}
      {act && <p className="sm muted">{act.criteria && t("insp.criteriaLine", { x: act.criteria })}{act.record && t("insp.recordLine", { x: act.record })}
        {act.stepCode ? t("insp.stepLocked", { step: (() => { const s = data.scopes[scope].steps.find((x) => x.code === act.stepCode); return s ? stepTitle(scope, s) : act.stepCode; })() })
          : t("insp.noStep")}</p>}
      {hours !== null && <p className={`sm ${short ? "err" : "muted"}`}>{t("insp.noticeLine", { h: Math.max(0, Math.round(hours)) })}
        {data.noticeHours ? `${t("insp.noticeMin", { n: data.noticeHours })}${short ? t("insp.noticeShort") : ""}` : t("insp.noticeUnset")}</p>}
    </form>
  );
}

// ── ITP ──────────────────────────────────────────────────────────────────

function ItpTab({ data, post, may }) {
  const { t, L, date } = usePrefs();
  const [sel, setSel] = useState(data.itps[0]?.id || null);
  const itp = data.itps.find((i) => i.id === sel);
  const [nf, setNf] = useState({ itpNo: "", revision: "0", title: "", scope: "foundation" });
  const [hours, setHours] = useState(data.noticeHours ?? "");
  return (
    <>
      <div className="card">
        <h2>{t("insp.itps")}</h2>
        {data.itps.length === 0 ? <p className="empty-note">{t("insp.noItps")}</p> : (
          <TableKit name="inspection-2"><table className="dtable">
            <thead><tr><th>{t("c.no")}</th><th>{t("c.revision")}</th><th>{t("c.title")}</th><th>{t("c.workType")}</th><th>{t("c.row")}</th><th>{t("insp.h.points")}</th><th>{t("c.status")}</th><th>{t("insp.h.preparedApproved")}</th></tr></thead>
            <tbody>{data.itps.map((i) => (
              <tr key={i.id} onClick={() => setSel(i.id)} style={{ cursor: "pointer", background: sel === i.id ? "var(--raise)" : undefined }}>
                <td className="mono">{i.itp_no}</td><td className="mono">{i.revision}</td><td>{i.title}</td><td>{L(`itp.scope.${i.scope}`, i.scopeTitle)}</td>
                <td className="mono">{i.activities.length}</td>
                <td className="mono">{i.activities.filter((a) => Object.values(a.points).some((p) => p === "H" || p === "W")).length}</td>
                <td><span className={`pill ${i.status === "approved" ? "ok" : i.status === "draft" ? "warn" : ""}`}>
                  {t(`insp.itp.${i.status}`)}</span></td>
                <td className="sm">{i.prepared_by_name || "—"}{i.approved_by_name && ` / ${i.approved_by_name} (${date(i.approved_on)})`}</td>
              </tr>))}</tbody>
          </table></TableKit>
        )}
        {may.itp && (
          <Fold title={t("insp.itp.new")} hint={t("insp.itp.newHint")}>
          <form style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }} onSubmit={async (e) => {
            e.preventDefault();
            const r = await post({ kind: "itp", ...nf });
            if (r?.itp) setSel(r.itp.id);
          }}>
            <div className="field"><label htmlFor="n-no">{t("insp.itp.no")}</label><input id="n-no" dir="ltr" value={nf.itpNo} onChange={(e) => setNf({ ...nf, itpNo: e.target.value })} /></div>
            <div className="field"><label htmlFor="n-rev">{t("c.revision")}</label><input id="n-rev" dir="ltr" size={4} value={nf.revision} onChange={(e) => setNf({ ...nf, revision: e.target.value })} /></div>
            <div className="field" style={{ flex: "1 1 200px" }}><label htmlFor="n-t">{t("c.title")}</label><input id="n-t" value={nf.title} onChange={(e) => setNf({ ...nf, title: e.target.value })} /></div>
            <div className="field"><label htmlFor="n-s">{t("c.workType")}</label>
              <select id="n-s" value={nf.scope} onChange={(e) => setNf({ ...nf, scope: e.target.value })}>
                {Object.entries(data.scopes).map(([k, v]) => <option key={k} value={k}>{L(`itp.scope.${k}`, v.title)}</option>)}</select></div>
            <button className="btn ghost" type="submit">{t("insp.itp.new")}</button>
          </form>
          </Fold>
        )}
        {may.itp && (
          <div style={{ display: "flex", gap: 8, alignItems: "end", marginTop: 8 }}>
            <div className="field"><label htmlFor="n-h">{t("insp.noticeHours")}</label>
              <input id="n-h" type="number" dir="ltr" min={1} value={hours} onChange={(e) => setHours(e.target.value)} /></div>
            <button className="btn ghost" onClick={() => post({ kind: "notice", hours })}>{t("c.save")}</button>
            <span className="muted sm">{t("insp.noticePolicy")}</span>
          </div>
        )}
      </div>
      {itp && <ItpMatrix itp={itp} data={data} post={post} may={may} />}
      <div className="card sm muted">
        {Object.entries(data.points).map(([k, v]) => <span key={k} style={{ marginInlineEnd: 16 }}><b className="mono">{k}</b> {L(`itp.point.${k}`, v)}</span>)}
      </div>
    </>
  );
}

/** An ITP line as its form holds it — the whole form, and the row edited in place. */
const activityOf = (a) => ({ ...a, seq: String(a.seq), stepCode: a.stepCode || "", reference: a.reference || "", criteria: a.criteria || "",
  record: a.record || "", points: { contractor: a.points.contractor || "", company: a.points.company || "", tpi: a.points.tpi || "" } });

function ItpMatrix({ itp, data, post, may }) {
  const { t, L } = usePrefs();
  const party = (p) => L(`itp.party.${p}`, data.parties[p]);
  const stepTitle = (s) => L(`chain.${itp.scope}.${s.code}`, s.title);
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
        {draft && <button className="btn" onClick={() => post({ kind: "approve", itpId: itp.id })}>{t("insp.itp.approve")}</button>}
      </div>
      <p className="muted sm">{t(`insp.itp.${itp.status}Note`)}</p>
      <TableKit name="inspection-3"
                onEdit={(id) => setF(activityOf(itp.activities.find((x) => x.id === id)))}
                rowEdit={may.itp ? { fields: [{ col: t("c.activity"), name: "title" }, { col: t("c.reference"), name: "reference" },
                    { col: t("c.criteria"), name: "criteria" }, { col: t("c.record"), name: "record" },
                    ...Object.keys(data.parties).map((p) => ({ col: party(p), name: `pt_${p}`, type: "select", options: Object.keys(data.points).map((k) => [k, k]) }))],
                  value: (id) => { const a = activityOf(itp.activities.find((x) => x.id === id));
                    return { ...a, ...Object.fromEntries(Object.entries(a.points).map(([p, v]) => [`pt_${p}`, v])) }; },
                  onSave: (id, v) => post({ kind: "activity", itpId: itp.id, ...v, seq: Number(v.seq),
                    points: Object.fromEntries(Object.keys(v.points).map((p) => [p, v[`pt_${p}`] || ""])) }) } : undefined}
                onDelete={(id) => post({ kind: "activity-remove", itpId: itp.id, id })}
                canEdit={() => (draft ? true : t("insp.itp.fixed"))} canDelete={() => (draft ? true : t("insp.itp.fixed"))}>
      <table className="dtable">
        <thead><tr><th>{t("c.row")}</th><th>{t("c.activity")}</th><th>{t("insp.h.chainStep")}</th><th>{t("c.reference")}</th><th>{t("c.criteria")}</th><th>{t("c.record")}</th>
          {Object.keys(data.parties).map((p) => <th key={p}>{party(p)}</th>)}</tr></thead>
        <tbody>{itp.activities.map((a) => (
          <tr key={a.id} data-key={a.id}>
            <td className="mono">{a.seq}</td><td>{a.title}</td>
            <td className="sm">{a.stepCode ? (steps.find((s) => s.code === a.stepCode) ? stepTitle(steps.find((s) => s.code === a.stepCode)) : a.stepCode) : <span className="muted">—</span>}</td>
            <td className="sm">{a.reference || "—"}</td><td className="sm">{a.criteria || "—"}</td><td className="sm mono">{a.record || "—"}</td>
            {Object.keys(data.parties).map((p) => <td key={p} className={`mono ${a.points[p] === "H" ? "bad" : a.points[p] === "W" ? "warn" : ""}`}>{a.points[p] || ""}</td>)}
          </tr>))}</tbody>
      </table></TableKit>
      {draft && (
        <form style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginTop: 8 }} onSubmit={async (e) => {
          e.preventDefault();
          if (await post({ kind: "activity", itpId: itp.id, ...f, seq: Number(f.seq) })) setF(blank);
        }}>
          <div className="field"><label htmlFor="a-seq">{t("c.row")}</label><input id="a-seq" type="number" dir="ltr" style={{ width: 70 }} value={f.seq} onChange={(e) => setF({ ...f, seq: e.target.value })} /></div>
          <div className="field" style={{ flex: "1 1 200px" }}><label htmlFor="a-title">{t("c.activity")}</label><input id="a-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="field"><label htmlFor="a-step">{t("insp.chainStepNode")}</label>
            <select id="a-step" value={f.stepCode} onChange={(e) => setF({ ...f, stepCode: e.target.value })}>
              <option value="">{t("insp.noNode")}</option>{steps.map((s) => <option key={s.code} value={s.code}>{stepTitle(s)}{s.derived ? t("insp.fromData") : ""}</option>)}
            </select></div>
          <div className="field"><label htmlFor="a-ref">{t("c.reference")}</label><input id="a-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
          <div className="field"><label htmlFor="a-cr">{t("c.criteria")}</label><input id="a-cr" value={f.criteria} onChange={(e) => setF({ ...f, criteria: e.target.value })} /></div>
          <div className="field"><label htmlFor="a-rec">{t("c.record")}</label><input id="a-rec" dir="ltr" value={f.record} onChange={(e) => setF({ ...f, record: e.target.value })} /></div>
          {Object.keys(data.parties).map((p) => (
            <div className="field" key={p}><label htmlFor={`a-${p}`}>{party(p)}</label>
              <select id={`a-${p}`} value={f.points[p]} onChange={(e) => setF({ ...f, points: { ...f.points, [p]: e.target.value } })}>
                <option value="">—</option>{Object.keys(data.points).map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
          ))}
          <button className="btn ghost" type="submit">{f.id ? t("insp.saveRow") : t("insp.addRow")}</button>
          {f.stepCode && steps.find((s) => s.code === f.stepCode)?.derived && <span className="muted sm">{t("insp.derivedNote")}</span>}
        </form>
      )}
    </div>
  );
}

// ── one item ─────────────────────────────────────────────────────────────

function ItemTab({ data }) {
  const { projectId, call } = usePlatform();
  const { t, L, dateTime } = usePrefs();
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
    call(`/api/inspection?projectId=${projectId}&itemKind=${data.scopes[scope]?.item}&itemId=${itemId}`).then(setFile).catch(() => setFile(null));
  }, [itemId, scope, projectId, call]);
  const owed = file ? file.activities.filter((a) => a.latest?.state.state !== "released") : [];
  return (
    <div className="card">
      <h2>{t("insp.itemFile")}</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <div className="field"><label htmlFor="i-scope">{t("c.workType")}</label>
          <select id="i-scope" value={scope} onChange={(e) => { setScope(e.target.value); setItemId(""); }}>
            <option value="">—</option>{Object.entries(data.scopes).map(([k, v]) => <option key={k} value={k}>{L(`itp.scope.${k}`, v.title)}</option>)}</select></div>
        <div className="field"><label htmlFor="i-item">{t("c.item")}</label>
          <select id="i-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">—</option>{items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></div>
      </div>
      {file && (file.activities.length === 0 ? <p className="empty-note">{t("insp.noItpForScope")}</p> : <>
        <p className="sm">{t("insp.releasedOf", { done: file.activities.length - owed.length, all: file.activities.length })}
          {owed.length > 0 && <> · <span className="warn">{t("insp.owed", { list: owed.map((a) => a.seq).join(t("c.sep")) })}</span></>}</p>
        <TableKit name="inspection-4"><table className="dtable">
          <thead><tr><th>{t("insp.h.itpRow")}</th><th>{t("c.activity")}</th><th>{t("insp.h.pointsCol")}</th><th>{t("insp.h.latest")}</th><th>{t("c.status")}</th></tr></thead>
          <tbody>{file.activities.map((a) => {
            const st = a.latest?.state.state;
            const [tone, label] = st ? [STATE_TONE[st], t(`insp.st.${st}`)]
              : a.stepDone ? ["", t("insp.notRequestedDone")]
              : a.gates && a.stepCode ? ["bad", t("insp.notRequestedLocked")] : ["", t("insp.notRequested")];
            return (
              <tr key={a.id}>
                <td className="mono sm"><bdi dir="ltr">{a.itpNo} · {a.seq}</bdi></td><td>{a.title}</td><td className="mono sm">{pointsText(a.points)}</td>
                <td className="mono sm">{a.latest ? `${a.latest.ir_no} (rev ${a.latest.revision}) · ${dateTime(a.latest.planned_at)}` : "—"}
                  {a.history.length > 1 && <div className="muted">{t("insp.requests", { n: a.history.length })}</div>}</td>
                <td><span className={`pill ${tone}`}>{label}</span></td>
              </tr>);
          })}</tbody>
        </table></TableKit>
      </>)}
    </div>
  );
}

// ── shared ───────────────────────────────────────────────────────────────


function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}

function notice(t, r, needed) {
  const h = Math.round((Date.parse(r.planned_at) - Date.parse(r.raised_at)) / 3_600_000);
  return `${t("insp.noticeShortCell", { h })}${needed && h < needed ? t("insp.lessThan", { n: needed }) : ""}`;
}
const pointsText = (p) => Object.entries(p).filter(([, v]) => v).map(([k, v]) => `${{ contractor: "Con", company: "Co", tpi: "TPI" }[k]}:${v}`).join(" ");
function soon() {
  const d = new Date(Date.now() + 26 * 3_600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}
