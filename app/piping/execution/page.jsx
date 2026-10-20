"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../../lib/authz.mjs";
import { CHAINS, spoolStageTitle } from "../../../lib/platform/precedence.mjs";
import TableKit from "../../../components/ui/TableKit";
import Tabs from "../../../components/ui/Tabs";
import Fold from "../../../components/ui/Fold";
import { WorkDateScope, WorkDateField, useWorkDate } from "../../../components/ui/WorkDate";
import { usePrefs } from "../../../lib/client/prefs.mjs";

/**
 * Piping execution: every spool's place in its chain, the supports, and
 * how much of the piping is in the ground.
 *
 * The board leads, sorted worst first, because the question on site each
 * morning is "what can we start", not "what have we done". Derived steps are
 * shown with a marker and no button: they come from the weld register, and a
 * button beside them would invite exactly the double entry they replace.
 */
const CHAIN = CHAINS.piping_spool;
// the support kinds; their words are pi.sup.kind.<kind>
const KINDS = ["shoe", "guide", "anchor", "line_stop", "spring_hanger", "rigid_hanger", "trunnion", "resting", "other"];
/** A spool chain step's name in the reader's language. */
const stepName = (x, L) => L(`chain.piping_spool.${x.code}`, x.title);

function PipingExecutionBody() {
  const workOn = useWorkDate();
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/piping/execution?projectId=${id}`, []);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [msg, setMsg] = useState(null);
  const mayRecord = can({ role }, ACTIONS.ASSIGN_WELD);
  const { t, L } = usePrefs();

  const detailUrl = (spoolId) => `/api/piping/execution?projectId=${projectId}&spoolId=${spoolId}`;

  async function expand(spoolId) {
    if (open === spoolId) { setOpen(null); setDetail(null); return; }
    setOpen(spoolId); setDetail(null);
    try { setDetail(await call(detailUrl(spoolId))); } catch (e) { setMsg(e.message); }
  }

  async function record(spoolId, code, refNo = null) {
    setMsg(null);
    try {
      await call("/api/piping/execution", { method: "POST", body: JSON.stringify({
        projectId, kind: "activity", spoolId, code, doneAt: workOn, refNo }) });
      setDetail(await call(detailUrl(spoolId)));
      reload();
    } catch (e) { setMsg(e.message); }
  }

  async function reserveMaterial(spoolId) {
    setMsg(null);
    try {
      await call("/api/piping/execution", { method: "POST", body: JSON.stringify({ projectId, kind: "reserve_material", spoolId }) });
      setDetail(await call(detailUrl(spoolId)));
    } catch (e) { setMsg(e.message); }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{t("pi.ex.title")}</h1>
        <span className="sub">{t("pi.ex.sub", { spools: data.board.length, supports: data.supports.length })}</span>
      </div>
      <WorkDateField />

      <Tabs name="piping-execution">
      {msg && <p className="err">{msg}</p>}

      <div className="card">
        <h2>{t("pi.ex.steps")}</h2>
        <p className="muted sm">
          {CHAIN.map((s) => stepName(s, L)).join(" ← ")}.
          {" "}{t("pi.ex.derivedNote")}
        </p>
        {data.board.length === 0 ? (
          <p className="empty-note">{t("pi.ex.noRegister")}</p>
        ) : (
          <TableKit name="execution-1">
            <table className="dtable">
              <thead>
                <tr><th>{t("pi.spool")}</th><th>{t("pi.line")}</th><th>{t("pi.ex.stage")}</th><th>{t("eq.progress")}</th><th>{t("co.canToday")}</th>
                    <th>{t("eq.waitingFor")}</th><th>{t("pi.ex.buried")}</th><th /></tr>
              </thead>
              <tbody>
                {data.board.map((b) => (
                  <SpoolRow key={b.spoolId} b={b} open={open === b.spoolId}
                    detail={open === b.spoolId ? detail : null}
                    onToggle={() => expand(b.spoolId)}
                    onRecord={mayRecord ? (code, ref) => record(b.spoolId, code, ref) : null}
                    onReserve={mayRecord ? () => reserveMaterial(b.spoolId) : null} />
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
      </div>

      <Supports data={data} projectId={projectId} call={call} reload={reload}
                mayRecord={mayRecord} setMsg={setMsg} />

      <Buried data={data} />
      </Tabs>
    </div>
  );
}

function SpoolRow({ b, open, detail, onToggle, onRecord, onReserve }) {
  const [refs, setRefs] = useState({});
  const { t, L, date } = usePrefs();
  const stage = (code) => (code === "planned" ? t("wa.spool.planned") : !code || code === "unknown" ? t("wa.spool.unknown") : L(`chain.piping_spool.${code}`, spoolStageTitle(code)));
  return (
    <>
      <tr>
        <td className="mono"><a href={`/piping/joint?q=${encodeURIComponent(b.spoolNo)}`} title={t("pi.ex.weldsOf")}>{b.spoolNo}</a></td>
        <td className="mono">{b.lineNo || "—"}</td>
        <td className="sm">{stage(b.stage)}</td>
        <td><Bar pct={b.pct} /></td>
        <td className="sm">{b.ready ? <span className="pill ok">{t("co.delivered")}</span>
          : b.next.map((n) => stepName(n, L)).join(t("c.sep")) || "—"}</td>
        <td className="sm muted">{b.waitingOn.map((n) => stepName(n, L)).join(t("c.sep")) || "—"}</td>
        <td>{b.buried === null ? <span className="muted sm">{t("hs.unknown")}</span>
          : b.buried ? <span className="pill warn">{t("pi.ex.buried")}</span>
          : <span className="pill">{t("pi.ex.above")}</span>}</td>
        <td><button className="btn ghost" style={{ padding: "4px 10px" }} onClick={onToggle}>
          {open ? t("common.close") : t("eq.steps")}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} style={{ background: "rgba(255,255,255,.02)" }}>
            {!detail ? <span className="muted sm">{t("common.loading")}</span> : (
              <div style={{ display: "grid", gap: 6,
                gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))" }}>
                {detail.steps.map((s) => (
                  <div key={s.code} className="card" style={{ padding: 10, gap: 6,
                    opacity: s.na ? 0.55 : 1,
                    borderColor: s.na ? undefined : s.status === "done" ? "rgba(63,178,127,.5)"
                      : s.blocked ? undefined : "rgba(67,160,180,.6)" }}>
                    <span className="sm"><b>{s.derived ? "⚙ " : ""}{stepName(s, L)}</b></span>
                    <span className="sm muted">
                      {s.na ? t("pi.ex.na")
                        : s.status === "done" ? (s.doneAt ? t("st.doneOn", { on: date(s.doneAt) }) : t("st.done"))
                        : s.claimedOn ? t("st.claimed", { on: date(s.claimedOn) })
                        : s.rejected ? t("st.rejected", { why: s.rejected })
                        : s.status === "in_progress" ? t("st.inProgress")
                        : s.claimable ? t("st.claimable")
                        : s.blocked ? t("st.waiting", { list: s.waitingOn.map((w) => stepName(w, L)).join(t("c.sep")) })
                        : t("st.ready")}
                      {s.refNo ? ` · ${s.refNo}` : ""}
                    </span>
                    {s.outOfOrder && <span className="pill bad">{t("st.outOfOrder")}</span>}
                    {onRecord && !s.derived && s.status !== "done" && (!s.blocked || s.claimable) && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input aria-label={t("st.refOf", { step: stepName(s, L) })} placeholder={t("st.ref")} dir="ltr" style={{ width: 120 }}
                               value={refs[s.code] || ""} onChange={(e) => setRefs({ ...refs, [s.code]: e.target.value })} />
                        <button className="btn" style={{ padding: "4px 10px" }}
                                onClick={() => onRecord(s.code, refs[s.code] || null)}>{t("st.record")}</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {detail?.material && <SpoolMaterial m={detail.material} onReserve={onReserve} />}
          </td>
        </tr>
      )}
    </>
  );
}

const MAT_TONE = { reserved: "ok", issued: "ok", available: "warn", short: "bad", no_item: "bad", uom: "bad", unmatched: "bad" };

/** The line state as a sentence, built from the codes — the server text stays Persian. */
function matText(l, t) {
  switch (l.state) {
    case "reserved": case "issued": return t(`pi.ex.mat.${l.state}`);
    case "available": return t("pi.ex.mat.available", { n: l.need, uom: l.uom });
    case "short": return t("pi.ex.mat.short", { need: l.need, free: l.free, uom: l.uom });
    case "no_item": return t("pi.ex.mat.noItem", { code: l.stockCode });
    case "uom": return t("pi.ex.mat.uom", { item: l.itemUom, line: l.uom });
    default: return l.text; // i18n: the register's own reason (unmatched)
  }
}

/** The spool's material from its register, against the warehouse (lib/piping/spool-bom.mjs). */
function SpoolMaterial({ m, onReserve }) {
  const { t } = usePrefs();
  if (!m.lines.length) return <p className="muted sm" style={{ marginTop: 8 }}>{t("pi.ex.noBom")}</p>;
  return (
    <div style={{ marginTop: 10 }}>
      <b className="sm">{t("pi.ex.bom")}</b>
      <table className="dtable">
        <thead><tr><th>{t("pi.ex.itemCode")}</th><th>{t("c.description")}</th><th>{t("pi.jt.size")}</th><th>{t("pu.h.qty")}</th><th>{t("pi.ex.reservedIssued")}</th><th>{t("c.status")}</th></tr></thead>
        <tbody>{m.lines.map((l, i) => (
          <tr key={i}><td className="mono">{l.stockCode || "—"}</td><td className="sm">{l.description || l.type || t("pi.ex.pipe")}</td>
            <td className="mono">{l.nps}"</td><td className="mono">{l.qty} {l.uom}</td>
            <td className="mono">{l.reserved !== undefined ? `${Math.round(l.reserved * 1000) / 1000} / ${l.issued}` : "—"}</td>
            <td><span className={`pill ${MAT_TONE[l.state]}`}>{matText(l, t)}</span></td></tr>
        ))}</tbody>
      </table>
      {onReserve && m.toReserve > 0 && (m.blocking === 0
        ? <button className="btn" onClick={onReserve}>{t("pi.ex.reserve")}</button>
        : <p className="muted sm">{t("pi.ex.allOrNothing", { n: m.blocking })}</p>)}
    </div>
  );
}

/**
 * How much of the piping is in the ground.
 *
 * With no grade elevation recorded this says so and points at where to
 * record it — rather than a column of zeros that reads as "nothing is buried".
 */
function Buried({ data }) {
  const { t, num } = usePrefs();
  const known = data.buried.some((r) => r.welds > r.unknown);
  if (!known) {
    return (
      <div className="card" data-keep style={{ borderColor: "rgba(224,163,62,.5)" }}>
        <h2 style={{ color: "var(--warn)" }}>{t("pi.bu.noGrade")}</h2>
        <p className="muted sm">
          {t("pi.bu.noGradeNote")}
          {" "}<a href="/project" className="cy">{t("pi.bu.projectLink")}</a>{t("pi.bu.noGradeEnd")}
        </p>
      </div>
    );
  }
  const rows = data.buried.filter((r) => r.welds > 0);
  return (
    <div className="card">
      <h2>{t("pi.bu.title")}</h2>
      <p className="muted sm">
        {t("pi.bu.note")}
        {data.grade !== null ? ` (EL ${num(data.grade)} mm${data.datum ? t("c.sep") + data.datum : ""})` : ""}.
        {" "}{t("pi.bu.note2")}
      </p>
      {rows.length === 0 ? <p className="empty-note">{t("pi.bu.none")}</p> : (
        <TableKit name="execution-2">
          <table className="dtable">
            <thead><tr><th>{t("pi.line")}</th><th>{t("pi.welds")}</th><th>{t("pi.ex.buried")}</th><th>{t("pi.ex.above")}</th>
                       <th>{t("hs.unknown")}</th><th>{t("pi.bu.grade")}</th>
                       <th>{t("pi.bu.deepest")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.lineId || r.lineNo}>
                  <td className="mono">{r.lineNo || "—"}</td>
                  <td className="mono">{r.welds}</td>
                  <td className="mono">{r.buried}</td>
                  <td className="mono">{r.aboveGround}</td>
                  <td className="mono">{r.unknown || "—"}</td>
                  <td className="mono">
                    {r.gradeMinMm === null ? t("hs.notRecorded")
                      : r.gradeMinMm === r.gradeMaxMm ? num(r.gradeMinMm)
                      : `${num(r.gradeMinMm)} – ${num(r.gradeMaxMm)}`}
                  </td>
                  <td className="mono" dir="ltr">
                    {r.deepestMm === null ? "—" : `${(r.deepestMm / 1000).toFixed(2)} m`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
    </div>
  );
}

function Supports({ data, projectId, call, reload, mayRecord, setMsg }) {
  const workOn = useWorkDate();
  const blank = { supportNo: "", supportKind: "shoe", loadKn: "", drawingRef: "", spoolId: "" };
  const [f, setF] = useState(blank);
  const { t, date } = usePrefs();

  async function add(e) {
    e.preventDefault();
    setMsg(null);
    try {
      // `kind` routes the request; the support's own type travels as
      // `supportKind`. Sending both as `kind` made every support a "support".
      await call("/api/piping/execution", { method: "POST",
        body: JSON.stringify({ projectId, kind: "support", ...f, spoolId: f.spoolId || null }) });
      setF({ ...blank, supportKind: f.supportKind });
      reload();
    } catch (e2) { setMsg(e2.message); }
  }

  async function mark(id, step) {
    setMsg(null);
    try {
      await call("/api/piping/execution", { method: "POST",
        body: JSON.stringify({ projectId, kind: "support_mark", supportId: id, step, on: workOn }) });
      reload();
    } catch (e) { setMsg(e.message); }
  }

  const small = { padding: "3px 9px" };
  return (
    <div className="card">
      <h2>{t("pi.sup.title")}</h2>
      <p className="muted sm">{t("pi.sup.note")}</p>
      {data.supports.length === 0 ? (
        <p className="empty-note">{t("pi.sup.none")}</p>
      ) : (
        <TableKit name="execution-3">
          <table className="dtable">
            <thead><tr><th>{t("c.no")}</th><th>{t("hs.type")}</th><th>{t("pi.line")}</th><th>{t("pi.spool")}</th><th>{t("pi.sup.load")}</th>
                       <th>{t("pi.sup.installed")}</th><th>{t("pi.sup.inspection")}</th></tr></thead>
            <tbody>
              {data.supports.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.support_no}</td>
                  <td>{KINDS.includes(s.kind) ? t(`pi.sup.kind.${s.kind}`) : s.kind}</td>
                  <td className="mono">{s.line_no || "—"}</td>
                  <td className="mono">{s.spool_no || "—"}</td>
                  <td className="mono">{s.load_kn ?? "—"}</td>
                  <td className="mono">{s.installed_at ? date(s.installed_at)
                    : mayRecord ? <button className="btn ghost" style={small}
                        onClick={() => mark(s.id, "installed")}>{t("pi.sup.markInstalled")}</button> : "—"}</td>
                  <td className="mono">{s.inspected_at ? date(s.inspected_at)
                    : s.installed_at && mayRecord ? <button className="btn ghost" style={small}
                        onClick={() => mark(s.id, "inspected")}>{t("pi.sup.markInspected")}</button> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}

      {mayRecord && (
        <Fold title={t("pi.sup.new")}>
        <form onSubmit={add} className="grid2" style={{ alignItems: "end" }}>
          <div className="field"><label htmlFor="s-no">{t("pi.sup.no")}</label>
            <input id="s-no" dir="ltr" required value={f.supportNo}
                   onChange={(e) => setF({ ...f, supportNo: e.target.value })} /></div>
          <div className="field"><label htmlFor="s-kind">{t("hs.type")}</label>
            <select id="s-kind" value={f.supportKind}
                    onChange={(e) => setF({ ...f, supportKind: e.target.value })}>
              {KINDS.map((k) => <option key={k} value={k}>{t(`pi.sup.kind.${k}`)}</option>)}
            </select></div>
          <div className="field"><label htmlFor="s-load">{t("pi.sup.loadLong")}</label>
            <input id="s-load" type="number" step="0.1" dir="ltr" value={f.loadKn}
                   onChange={(e) => setF({ ...f, loadKn: e.target.value })} />
            {f.supportKind === "spring_hanger" && <span className="hint">{t("pi.sup.springNeeds")}</span>}
          </div>
          <div className="field"><label htmlFor="s-spool">{t("pi.sup.spool")}</label>
            <select id="s-spool" value={f.spoolId} onChange={(e) => setF({ ...f, spoolId: e.target.value })}>
              <option value="">—</option>
              {data.board.map((b) => <option key={b.spoolId} value={b.spoolId}>{b.lineNo} / {b.spoolNo}</option>)}
            </select>
            <span className="hint">{t("pi.sup.spoolHint")}</span></div>
          <div className="field"><label htmlFor="s-ref">{t("pi.sup.stdDrawing")}</label>
            <input id="s-ref" dir="ltr" value={f.drawingRef}
                   onChange={(e) => setF({ ...f, drawingRef: e.target.value })} /></div>
          <div><button className="btn" type="submit" disabled={!f.supportNo}>{t("pi.sup.add")}</button></div>
        </form>
        </Fold>
      )}
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

/** Every one-click record on this page carries the day chosen at its head (components/ui/WorkDate). */
export default function PipingExecution() {
  return <WorkDateScope><PipingExecutionBody /></WorkDateScope>;
}
