"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import { newOp } from "../../lib/field/ops.mjs";
import { PHOTO_STAGES } from "../../lib/quality/photo.mjs";
import { compressPhoto, blobToBase64 } from "../../lib/client/photo.mjs";
import PhotoStrip from "../../components/quality/PhotoStrip";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import Tabs from "../../components/ui/Tabs";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * Punch list and NCRs, and what they hold against each subsystem's MC.
 *
 * The screen offers only the next legal step for each record; the rules
 * behind it (verifier ≠ clearer, a concession is an engineering signature,
 * no close without a root cause) are the engine's, and the refusal text
 * comes back from it unchanged.
 */
// Tones; the words are the section's dictionary (lib/i18n/sections/quality.mjs: q.ps.*, q.ns.*, q.ev.*).
const PUNCH_TONE = { open: "", overdue: "bad", cleared: "warn", closed: "ok" };
const NCR_TONE = { open: "bad", proposed: "warn", approved: "warn", implemented: "warn", closed: "ok" };

export default function QualityPage() {
  const { projectId, role, call } = usePlatform();
  const { t } = usePrefs();
  const { data, error, reload } = useProjectData((id) => `/api/quality?projectId=${id}`, []);
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
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const openPunch = data.punch.filter((p) => p.status !== "closed");
  const openA = openPunch.filter((p) => p.category === "A").length;
  const overdue = data.punch.filter((p) => p.state === "overdue").length;
  const openNcr = data.ncrs.filter((n) => n.status !== "closed");
  const esc2 = openNcr.filter((n) => n.escalation.level === 2).length;
  const esc1 = openNcr.filter((n) => n.escalation.level === 1).length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{t("q.title")}</h1>
        <span className="sub">{t("q.sub", { punch: openPunch.length, a: openA, ncr: openNcr.length })}</span>
      </div>
      {msg && <p className="err">{msg}</p>}

      <div className="kpis">
        <Kpi v={openA} l={t("q.kpi.openA")} b={t("q.kpi.blocksMc")} tone={openA ? "bad" : "ok"} />
        <Kpi v={openPunch.length - openA} l={t("q.kpi.openBC")} />
        <Kpi v={overdue} l={t("q.kpi.overdue")} tone={overdue ? "warn" : ""} />
        <Kpi v={openNcr.length} l={t("q.kpi.openNcr")} tone={openNcr.length ? "warn" : "ok"} />
        <Kpi v={esc1} l={t("q.kpi.lateNcr")} b={t("q.kpi.toContractor")} tone={esc1 ? "warn" : ""} />
        <Kpi v={data.escalationDays ? esc2 : "—"} l={t("q.kpi.escalated")} tone={esc2 ? "bad" : ""}
             b={data.escalationDays ? t("q.kpi.escDays", { n: data.escalationDays }) : t("q.kpi.noEsc")} />
      </div>

      <Tabs name="quality">
        <PunchTab data={data} post={post} may={may} />
        <NcrTab data={data} post={post} may={may} role={role} />
      <div className="card">
        <h2>{t("q.held.title")}</h2>
        <TableKit name="quality-1">
          <table className="dtable">
            <thead><tr><th>{t("c.subsystem")}</th><th>{t("q.held.a")}</th><th>{t("q.held.ab")}</th><th>{t("q.held.c")}</th><th>{t("q.kpi.openNcr")}</th></tr></thead>
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
        </TableKit>
      </div>
      </Tabs>
    </div>
  );
}

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}

// ── punch ────────────────────────────────────────────────────────────────

function PunchTab({ data, post, may }) {
  const { t, L, date } = usePrefs();
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("live");
  const rows = data.punch.filter((p) => filter === "all" || p.status !== "closed");
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2>{t("q.punch.title")}</h2>
        <div className="field" style={{ margin: 0 }}>
          <select aria-label={t("c.filter")} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="live">{t("q.punch.live")}</option><option value="all">{t("c.all")}</option>
          </select>
        </div>
      </div>
      {rows.length === 0 ? <p className="empty-note">{t("q.punch.empty")}</p> : (
        <TableKit name="quality-2">
          <table className="dtable">
            <thead><tr><th>{t("c.no")}</th><th>{t("c.category")}</th><th>{t("c.description")}</th><th>{t("c.tag")}</th><th>{t("c.contractor")}</th><th>{t("c.due")}</th><th>{t("c.status")}</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => {
                const tone = PUNCH_TONE[p.state], label = t(`q.ps.${p.state}`);
                return [
                  <tr key={p.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{p.punch_no}</td>
                    <td><span className={`pill ${p.category === "A" ? "bad" : p.category === "B" ? "warn" : ""}`}>{p.category}</span>
                      {p.recategorised > 0 && <div className="muted sm" title={t("q.punch.recat")}>↺ {p.recategorised}</div>}</td>
                    <td>{p.description}{p.clear_note && <div className="muted sm">{t("q.punch.clearNote", { note: p.clear_note, by: p.cleared_by_name || "?" })}</div>}</td>
                    <td className="mono">{p.tag_no ? <a href={`/asset?tag=${encodeURIComponent(p.tag_no)}`}>{p.tag_no}</a> : "—"}</td>
                    <td className="mono">{p.contractor_code || "—"}</td>
                    <td className="mono sm">{date(p.due_on)}</td>
                    <td><span className={`pill ${tone}`}>{label}</span></td>
                    <td><button className="btn ghost" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? t("common.close") : t("c.action")}</button></td>
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
        </TableKit>
      )}
      {may && <Fold title={t("q.punch.new")}><PunchForm data={data} post={post} /></Fold>}
    </div>
  );
}

function PunchPanel({ p, post, may, categories }) {
  const { projectId, call } = usePlatform();
  const { t, L } = usePrefs();
  const [note, setNote] = useState("");
  const [cat, setCat] = useState(p.category);
  const [photos, setPhotos] = useState([]);
  const [stage, setStage] = useState(p.status === "open" ? "raised" : "cleared");
  const [shot, setShot] = useState(null);           // null | "busy" | error text
  const [n, setN] = useState(0);
  // The day it was cleared or verified — typed, because the walk-down sheet is often entered the day after.
  const [onDate, setOnDate] = useState(today());
  const act = async (action, extra = {}) => { if (await post({ kind: "punch-action", punchId: p.id, action, note, onDate, ...extra })) setNote(""); };
  // A photo from the desk goes the way a phone's does: one operation, with
  // its own id, through the same sync — so a double click is one photo.
  async function upload(file) {
    if (!file) return;
    setShot("busy");
    try {
      const blob = await compressPhoto(file);
      const op = newOp("punch_photo", { punchId: p.id, stage, takenOn: today(), data: await blobToBase64(blob) }, { projectId });
      const { results: [r] } = await call("/api/field", { method: "POST", body: JSON.stringify({ projectId, ops: [op] }) });
      if (r.status !== "applied") throw new Error(r.error || t("q.punch.notSaved"));
      setShot(null); setN(n + 1);
    } catch (e) { setShot(e.message); }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <History url={`punchId=${p.id}`} stamp={`${p.status}${p.category}${p.cleared_on}${n}`} onLoad={(r) => setPhotos(r.photos || [])} />
      <PhotoStrip projectId={projectId} photos={photos} />
      {may && p.status !== "closed" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <div className="field"><label htmlFor={`ps-${p.id}`}>{t("q.punch.photoStage")}</label>
            <select id={`ps-${p.id}`} value={stage} onChange={(e) => setStage(e.target.value)}>
              {Object.entries(PHOTO_STAGES).filter(([k]) => k !== "cleared" || p.status !== "open")
                .map(([k, v]) => <option key={k} value={k}>{L(`punch.photo.${k}`, v)}</option>)}
            </select></div>
          <label className="btn ghost photo-btn">{shot === "busy" ? t("q.punch.sending") : t("q.punch.addPhoto")}
            <input type="file" accept="image/*" aria-label={t("q.punch.addPhoto")} disabled={shot === "busy"}
                   onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; upload(f); }} /></label>
          {shot && shot !== "busy" && <span className="err sm">{shot}</span>}
        </div>
      )}
      {may && p.status !== "closed" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <div className="field" style={{ flex: "1 1 260px" }}><label htmlFor={`pn-${p.id}`}>{t("c.note")}</label>
            <input id={`pn-${p.id}`} value={note} onChange={(e) => setNote(e.target.value)}
                   placeholder={p.status === "open" ? t("q.punch.whatDone") : t("q.punch.reason")} /></div>
          <div className="field"><label htmlFor={`pd-${p.id}`}>{t("c.date")}</label>
            <input id={`pd-${p.id}`} type="date" dir="ltr" value={onDate} onChange={(e) => setOnDate(e.target.value)} /></div>
          {p.status === "open" && <button className="btn" onClick={() => act("clear")}>{t("q.punch.clear")}</button>}
          {p.status === "cleared" && <>
            <button className="btn" onClick={() => act("verify")}>{t("q.punch.verify")}</button>
            <button className="btn ghost" onClick={() => act("reject")}>{t("q.punch.reject")}</button>
          </>}
          <div className="field"><label htmlFor={`pc-${p.id}`}>{t("q.punch.newCat")}</label>
            <select id={`pc-${p.id}`} value={cat} onChange={(e) => setCat(e.target.value)}>
              {Object.keys(categories).map((c) => <option key={c} value={c}>{c}</option>)}
            </select></div>
          <button className="btn ghost" onClick={() => act("recategorise", { category: cat })}>{t("q.punch.recategorise")}</button>
        </div>
      )}
    </div>
  );
}

function PunchForm({ data, post }) {
  const { t, L } = usePrefs();
  const blank = { subsystemId: "", tagId: "", category: "A", description: "", location: "", actionContractorId: "", raisedOn: today(), dueOn: "" };
  const [f, setF] = useState(blank);
  const tags = data.tags.filter((t) => !f.subsystemId || t.subsystem_id === f.subsystemId);
  return (
    <form style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "punch", ...f })) setF({ ...blank, subsystemId: f.subsystemId }); }}>
      <h2>{t("q.punch.form")}</h2>
      <div className="grid2">
        <Select id="pf-s" label={t("c.subsystem")} value={f.subsystemId} on={(v) => setF({ ...f, subsystemId: v, tagId: "" })}
                opts={data.subsystems.map((s) => [s.id, s.code])} blank={t("q.punch.fromTag")} />
        <Select id="pf-t" label={t("c.tag")} value={f.tagId} on={(v) => setF({ ...f, tagId: v })} opts={tags.map((x) => [x.id, x.tag_no])} blank="—" />
        <Select id="pf-c" label={t("c.category")} value={f.category} on={(v) => setF({ ...f, category: v })}
                opts={Object.entries(data.categories).map(([k, v]) => [k, `${k} — ${L(`punch.cat.${k}`, v)}`])} />
        <Select id="pf-k" label={t("c.contractorResp")} value={f.actionContractorId} on={(v) => setF({ ...f, actionContractorId: v })}
                opts={data.contractors.map((c) => [c.id, c.code])} blank="—" />
        <Field id="pf-d" label={t("c.description")} value={f.description} on={(v) => setF({ ...f, description: v })} required />
        <Field id="pf-l" label={t("c.location")} value={f.location} on={(v) => setF({ ...f, location: v })} />
        <Field id="pf-r" label={t("c.raisedOn")} type="date" value={f.raisedOn} on={(v) => setF({ ...f, raisedOn: v })} required />
        <Field id="pf-u" label={t("q.punch.dueOn")} type="date" value={f.dueOn} on={(v) => setF({ ...f, dueOn: v })} />
      </div>
      <div><button className="btn" type="submit">{t("c.submit")}</button></div>
    </form>
  );
}

// ── NCR ──────────────────────────────────────────────────────────────────

function NcrTab({ data, post, may, role }) {
  const { t, L, date } = usePrefs();
  const [open, setOpen] = useState(null);
  return (
    <div className="card">
      <h2>{t("q.ncr.title")}</h2>
      {data.ncrs.length === 0 ? <p className="empty-note">{t("q.ncr.empty")}</p> : (
        <TableKit name="quality-3">
          <table className="dtable">
            <thead><tr><th>{t("c.no")}</th><th>{t("c.title")}</th><th>{t("q.ncr.severity")}</th><th>{t("q.ncr.where")}</th><th>{t("c.contractor")}</th><th>{t("q.ncr.disposition")}</th><th>{t("q.ncr.responseDue")}</th><th>{t("c.status")}</th><th /></tr></thead>
            <tbody>
              {data.ncrs.map((n) => {
                const tone = NCR_TONE[n.status], label = t(`q.ns.${n.status}`);
                const e = n.escalation;
                return [
                  <tr key={n.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{n.ncr_no}</td>
                    <td>{n.title}{n.requirement && <div className="muted sm">{t("q.ncr.requirement", { x: n.requirement })}</div>}</td>
                    <td><span className={`pill ${n.severity === "major" ? "bad" : "warn"}`}>{L(`ncr.sev.${n.severity}`, data.severities[n.severity])}</span></td>
                    <td className="mono sm">{n.subsystem_code || "—"}{n.tag_no && <> · <a href={`/asset?tag=${encodeURIComponent(n.tag_no)}`}>{n.tag_no}</a></>}</td>
                    <td className="mono">{n.contractor_code || "—"}</td>
                    <td className="sm">{n.disposition ? L(`ncr.disp.${n.disposition}`, data.dispositions[n.disposition]) : "—"}</td>
                    <td className="mono sm">{date(n.response_due)}
                      {e.level > 0 && <div><span className={`pill ${e.level === 2 ? "bad" : "warn"}`}>
                        {t("q.ncr.daysLate", { n: e.daysOverdue })}{e.level === 2 ? t("q.ncr.toPm") : ""}{e.capped ? t("q.ncr.capped") : ""}</span></div>}</td>
                    <td><span className={`pill ${tone}`}>{label}</span></td>
                    <td><button className="btn ghost" onClick={() => setOpen(open === n.id ? null : n.id)}>{open === n.id ? t("common.close") : t("c.action")}</button></td>
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
        </TableKit>
      )}
      {may && <Fold title={t("q.ncr.new")}><NcrForm data={data} post={post} /></Fold>}
    </div>
  );
}

function NcrPanel({ n, data, post, may, role }) {
  const { t, L } = usePrefs();
  const [f, setF] = useState({ disposition: "rework", dispositionNote: "", note: "", rootCause: n.root_cause || "", correctiveAction: n.corrective_action || "" });
  const act = (action) => post({ kind: "ncr-action", ncrId: n.id, action, ...f });
  const concession = ["use_as_is", "repair"].includes(n.disposition);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p className="sm">{n.description}</p>
      {n.disposition_note && <p className="sm"><b>{t("q.ncr.dispositionBy")}</b> {n.disposition_note} — {n.proposed_by_name || "?"}{n.approved_by_name && t("q.ncr.approvedBy", { name: n.approved_by_name })}</p>}
      {(n.root_cause || n.corrective_action) && <p className="sm"><b>{t("q.ncr.rootCause")}:</b> {n.root_cause || "—"} · <b>{t("q.ncr.corrective")}:</b> {n.corrective_action || "—"}</p>}
      <History url={`ncrId=${n.id}`} stamp={`${n.status}${n.disposition}`} />
      {may && n.status !== "closed" && (
        <div className="grid2">
          {n.status === "open" && <>
            <Select id={`nd-${n.id}`} label={t("q.ncr.disposition")} value={f.disposition} on={(v) => setF({ ...f, disposition: v })}
                    opts={Object.entries(data.dispositions).map(([k, v]) => [k, L(`ncr.disp.${k}`, v)])} />
            <Field id={`ndn-${n.id}`} label={t("q.ncr.dispositionNote")} value={f.dispositionNote} on={(v) => setF({ ...f, dispositionNote: v })} />
          </>}
          {["proposed", "approved"].includes(n.status) &&
            <Field id={`nn-${n.id}`} label={n.status === "proposed" ? t("q.ncr.reasonIfRejected") : t("q.ncr.howDone")} value={f.note}
                   on={(v) => setF({ ...f, note: v })} />}
          {n.status !== "proposed" && <>
            <Field id={`nr-${n.id}`} label={t("q.ncr.rootCause")} value={f.rootCause} on={(v) => setF({ ...f, rootCause: v })} />
            <Field id={`nc-${n.id}`} label={t("q.ncr.correctiveLong")} value={f.correctiveAction} on={(v) => setF({ ...f, correctiveAction: v })} />
          </>}
          <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            {n.status === "open" && <button className="btn" onClick={() => act("propose")}>{t("q.ncr.propose")}</button>}
            {n.status === "proposed" && <>
              <button className="btn" onClick={() => act("approve")} title={concession && !can({ role }, ACTIONS.APPROVE_CONCESSION) ? t("q.ncr.concession") : ""}>{t("q.ncr.approve")}</button>
              <button className="btn ghost" onClick={() => act("rejectDisposition")}>{t("q.ncr.rejectDisposition")}</button>
            </>}
            {n.status === "approved" && <button className="btn" onClick={() => act("implement")}>{t("q.ncr.implement")}</button>}
            {n.status === "implemented" && <button className="btn" onClick={() => act("close")}>{t("q.ncr.close")}</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function NcrForm({ data, post }) {
  const { t, L } = usePrefs();
  const blank = { title: "", description: "", requirement: "", source: "", severity: "minor", subsystemId: "", tagId: "",
    contractorId: "", raisedOn: today(), responseDue: "" };
  const [f, setF] = useState(blank);
  return (
    <form style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "ncr", ...f })) setF(blank); }}>
      <h2>{t("q.ncr.form")}</h2>
      <div className="grid2">
        <Field id="nf-t" label={t("c.title")} value={f.title} on={(v) => setF({ ...f, title: v })} required />
        <Select id="nf-v" label={t("q.ncr.severity")} value={f.severity} on={(v) => setF({ ...f, severity: v })}
                opts={Object.entries(data.severities).map(([k, v]) => [k, L(`ncr.sev.${k}`, v)])} />
        <Field id="nf-d" label={t("q.ncr.desc")} value={f.description} on={(v) => setF({ ...f, description: v })} required />
        <Field id="nf-q" label={t("q.ncr.violated")} value={f.requirement} on={(v) => setF({ ...f, requirement: v })} />
        <Select id="nf-s" label={t("c.subsystem")} value={f.subsystemId} on={(v) => setF({ ...f, subsystemId: v })} opts={data.subsystems.map((s) => [s.id, s.code])} blank="—" />
        <Select id="nf-g" label={t("c.tag")} value={f.tagId} on={(v) => setF({ ...f, tagId: v })} opts={data.tags.map((x) => [x.id, x.tag_no])} blank="—" />
        <Select id="nf-c" label={t("c.contractorResp")} value={f.contractorId} on={(v) => setF({ ...f, contractorId: v })} opts={data.contractors.map((c) => [c.id, c.code])} blank="—" />
        <Field id="nf-o" label={t("q.ncr.source")} value={f.source} on={(v) => setF({ ...f, source: v })} />
        <Field id="nf-r" label={t("c.raisedOn")} type="date" value={f.raisedOn} on={(v) => setF({ ...f, raisedOn: v })} required />
        <Field id="nf-p" label={t("q.ncr.responseDue")} type="date" value={f.responseDue} on={(v) => setF({ ...f, responseDue: v })} />
      </div>
      <div><button className="btn" type="submit">{t("q.ncr.form")}</button></div>
    </form>
  );
}

// ── shared ───────────────────────────────────────────────────────────────

function History({ url, stamp, onLoad }) {
  const { projectId, call } = usePlatform();
  const { t, dateTime } = usePrefs();
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
        <li key={e.id}>{dateTime(e.at)} — <b>{t(`q.ev.${e.event}`)}</b>
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
