"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import TableKit from "../../../components/ui/TableKit";
import { usePrefs } from "../../../lib/client/prefs.mjs";

/**
 * Joint history (Master Plan §12): one weld, from the drawing revision that
 * first carried it to the pressure test of its line — every record the
 * platform already holds about it, in order, and what among them does not
 * add up. Nothing is typed here; each section is another module's record.
 *
 * ?uid= opens a weld directly; ?q= starts with a search (a spool, a line).
 */
// tones; the words are pi.jt.res.<result>, pi.jt.kind.<kind> and wa.mtc.<state>
const RESULT = { accept: "ok", reject: "bad", pending: "" };
// the same three results in the owner's NDT status style (app/ui-ux-ndt.css)
const NDT_STATUS = { accept: "passed", reject: "failed", pending: "pending" };
const KINDS = ["drawing", "material", "fitup", "inspection", "weld", "pwht", "ndt", "test"];
const MTC = { pending: "", accepted: "ok", rejected: "bad" };

export default function JointPage() {
  const { projectId, call } = usePlatform();
  const [q, setQ] = useState("");
  const [uid, setUid] = useState("");
  const [h, setH] = useState(null);
  const [err, setErr] = useState(null);
  const { data: list } = useProjectData((id) => `/api/welds?projectId=${id}&q=${encodeURIComponent(q)}`, [q]);
  const { t } = usePrefs();

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("uid")) setUid(p.get("uid"));
    if (p.get("q")) setQ(p.get("q"));
  }, []);

  useEffect(() => {
    if (!uid || !projectId) { setH(null); return; }
    setErr(null); setH(null);
    call(`/api/welds/${encodeURIComponent(uid)}?projectId=${projectId}`).then(setH).catch((e) => setErr(e.message));
    window.history.replaceState(null, "", `/piping/joint?uid=${encodeURIComponent(uid)}`);
  }, [uid, projectId, call]);

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{t("pi.jt.title")}</h1>
        <span className="sub">{t("pi.jt.sub")}</span>
      </div>
      {!uid && <Finder q={q} setQ={setQ} list={list} open={setUid} />}
      {uid && (
        <div><button className="btn ghost" onClick={() => { setUid(""); window.history.replaceState(null, "", "/piping/joint"); }}>{t("pi.jt.back")}</button></div>
      )}
      {err && <p className="err">{err}</p>}
      {uid && !h && !err && <p className="muted">{t("common.loading")}</p>}
      {h && <History h={h} />}
    </div>
  );
}

function Finder({ q, setQ, list, open }) {
  const [input, setInput] = useState(q);
  const { t } = usePrefs();
  useEffect(() => setInput(q), [q]);
  const welds = list?.welds || [];
  return (
    <div className="card">
      <form style={{ display: "flex", gap: 8, flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); setQ(input.trim()); }}>
        <input className="search" dir="ltr" value={input} onChange={(e) => setInput(e.target.value)} style={{ maxWidth: 320 }}
               placeholder={t("pi.jt.searchHint")} aria-label={t("pi.jt.searchLabel")} />
        <button className="btn" type="submit">{t("pu.v.search")}</button>
      </form>
      {!list ? <p className="muted">{t("common.loading")}</p> : welds.length === 0 ? <p className="empty-note">{t("pi.jt.none")}</p> : (
        <TableKit name="joint-1">
          <table className="dtable">
            <thead><tr><th>{t("pi.weld")}</th><th>{t("pi.line")}</th><th>{t("pi.spool")}</th><th>{t("pi.jt.drawing")}</th><th>Shop/Field</th><th>{t("pi.jt.size")}</th><th>{t("pi.welder")}</th><th>{t("c.status")}</th><th /></tr></thead>
            <tbody>
              {welds.map((w) => (
                <tr key={w.weld_uid}>
                  <td className="mono">{w.weld_no}</td><td className="mono sm">{w.line_no || "—"}</td>
                  <td className="mono sm">{w.spool_no || "—"}</td><td className="mono sm">{w.doc_no} Rev {w.revision}</td>
                  <td>{w.shop_field === "Shop" ? t("pi.shop") : t("pi.field")}</td><td className="mono">{w.nps ?? "—"}"</td><td className="mono">{w.stamp_no || "—"}</td>
                  <td>{!w.is_welded ? <span className="pill">{t("pi.jt.notWelded")}</span> : w.is_accepted ? <span className="pill ok">{t("co.v.accepted")}</span>
                    : w.is_examined ? <span className="pill bad">{t("pi.jt.ndtOpen")}</span> : <span className="pill">{t("pi.wd.awaitNdt")}</span>}</td>
                  <td><button className="btn ghost" style={{ padding: "4px 10px" }} onClick={() => open(w.weld_uid)}>{t("pi.jt.history")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
    </div>
  );
}

function History({ h }) {
  const { identity: id, status: st, execution: ex } = h;
  const { t, L, date } = usePrefs();
  const fa = date;
  const shopField = (v) => (v === "Shop" ? t("pi.shop") : v === "Field" ? t("pi.field") : v);
  return (
    <>
      <div className="card">
        <h2 style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <bdi dir="ltr" className="mono">{id.weldNo}</bdi>
          <span className="pill">{shopField(id.shopField)}</span>
          {!id.current && <span className="weld-status weld-status--rejected">{t("pi.jt.notCurrent")}</span>}
          {st.accepted ? <span className="weld-status weld-status--approved">{t("pi.jt.ndtAccepted")}</span>
            : st.examined ? <span className="weld-status weld-status--rejected">{t("pi.jt.ndtOpen")}</span>
            : <span className="weld-status weld-status--pending">{st.welded ? t("pi.wd.awaitNdt") : t("pi.jt.notWelded")}</span>}
          {st.repairs > 0 && <span className="weld-status weld-status--repair">{t("pi.jt.repairs", { n: st.repairs })}</span>}
        </h2>
        <div className="kv">
          <KV k={t("pi.line")} v={id.lineNo} mono /><KV k={t("pi.jt.class")} v={id.pipingClass} mono /><KV k={t("pi.spool")} v={id.spoolNo} mono />
          <KV k={t("pi.jt.drawing")} v={`${id.docNo} Rev ${id.revision}`} mono /><KV k={t("hs.type")} v={`${id.kind || "—"}${id.jointRole ? ` · ${id.jointRole}` : ""}`} />
          <KV k={t("pi.jt.size")} v={id.nps != null ? `${id.nps}"${id.schedule ? ` · ${id.schedule}` : ""}` : null} mono />
          <KV k={t("pi.qc.ndtReq")} v={id.ndtRequirement} mono />
          <KV k={t("pi.jt.buried")} v={id.buried === null ? t("pi.jt.buriedUnknown")
            : id.buried ? t("pi.jt.buriedYes", { mm: Math.round(Math.abs(id.heightAboveGradeMm)) }) : t("pi.jt.buriedNo", { mm: Math.round(id.heightAboveGradeMm) })} />
          <KV k={t("pi.jt.uid")} v={id.weldUid} mono />
        </div>
      </div>

      {h.attention.length > 0 && (
        <div className="card" style={{ borderColor: "var(--warn)" }}>
          <h2>{t("pi.jt.attention")}</h2>
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {h.attention.map((a, i) => <li key={i} className="sm" style={{ color: a.level === "bad" ? "var(--bad)" : "var(--warn)" }}>{a.text}</li>)}
          </ul>
        </div>
      )}

      <div className="card">
        <h2>{t("pi.jt.timeline")}</h2>
        {h.timeline.length === 0 ? <p className="empty-note">{t("hs.noIncident")}</p> : (
          <ol className="joint-history">
            {h.timeline.map((e, i) => (
              <li key={i} className="joint-history__item" data-tone={e.tone || undefined}>
                <div className="joint-history__header">
                  <h3 className="joint-history__title">{KINDS.includes(e.kind) ? t(`pi.jt.kind.${e.kind}`) : e.kind}</h3>
                  <div className="joint-history__meta mono">{e.on ? date(e.on) : t("pi.jt.undated")}</div>
                </div>
                <p className="joint-history__description sm">{e.text}</p>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="grid2">
        <div className="card">
          <h2>{t("pi.wd.welding")}</h2>
          {!ex ? <p className="empty-note">{t("pi.jt.noWelding")}</p> : <>
            <div className="kv">
              <KV k={t("pi.welder")} v={`${ex.welder.stampNo || "—"}${ex.welder.name ? ` — ${ex.welder.name}` : ""}`} />
              <KV k={t("c.contractor")} v={ex.welder.employer} /><KV k="WPS" v={ex.wpsNo} mono /><KV k="PQR" v={ex.pqrNo} mono />
              <KV k={t("pi.jt.processPosition")} v={[ex.process, ex.position].filter(Boolean).join(" · ")} mono />
              <KV k={t("c.date")} v={fa(ex.weldedOn)} /><KV k={t("pi.jt.visual")} v={RESULT[ex.visual] !== undefined ? t(`pi.jt.res.${ex.visual}`) : null} />
              <KV k="PWHT" v={ex.pwhtRequired ? (ex.pwhtReportNo ? `${ex.pwhtReportNo} · ${fa(ex.pwhtOn)}` : t("pi.jt.pwhtMissing")) : t("hs.notNeeded")} />
              <KV k={t("pi.jt.recordedBy")} v={ex.recordedBy} />
            </div>
            <p className="sm muted" style={{ marginTop: 8 }}>
              {t("pi.jt.verdict")}{" "}
              {ex.verdict?.ok === false ? <span className="pill bad">{t("pi.jt.blocked")}</span> : (ex.verdict?.warnings || []).length
                ? <span className="pill">{t("pi.jt.warnings", { n: ex.verdict.warnings.length })}</span> : <span className="pill ok">{t("pi.jt.clean")}</span>}
            </p>
          </>}
        </div>
        <div className="card">
          <h2>{t("pi.jt.ndtRepair")}</h2>
          {h.status.compliance && (
            <p className="sm">{t("pi.jt.requirement")} <b>{h.status.compliance.method ? `${h.status.compliance.method} ${h.status.compliance.percent}%` : t("pi.ov.notSet")}</b> —{" "}
              <span className={`pill ${h.status.compliance.done ? "ok" : "warn"}`}>{L(`ndt.status.${h.status.compliance.status}`, h.status.compliance.text)}</span>
              {h.status.compliance.lot?.drawNeeded && <span className="muted"> — {t("pi.jt.drawPending", { n: h.status.compliance.lot.drawNeeded.count })}</span>}
              {h.status.compliance.lot?.needed > 0 && <span className="muted"> — {t("pi.jt.drawnNotExamined", { n: h.status.compliance.lot.needed })}</span>}</p>
          )}
          {h.selection.length > 0 && (
            <p className="sm">{t("pi.jt.sampling")} {h.selection.map((s) => `${s.method} ${s.percent}% (${fa(s.on)}): ${s.selected ? t("pi.jt.selected") : t("pi.jt.notSelected")}`).join(" · ")}</p>
          )}
          {h.ndt.length === 0 ? <p className="empty-note">{t("pi.jt.noNdt")}</p> : (
            <div className="ndt-table-wrap"><table className="ndt-table">
              <thead><tr><th>{t("pi.method")}</th><th>{t("pi.jt.cycle")}</th><th>{t("c.result")}</th><th>{t("pi.jt.defect")}</th><th>{t("pi.jt.report")}</th><th>{t("c.date")}</th><th>{t("c.inspector")}</th></tr></thead>
              <tbody>{h.ndt.map((n, i) => (
                <tr key={i}><td><span className="ndt-method">{n.method}</span></td><td className="mono">{n.cycle === 0 ? t("pi.jt.first") : `R${n.cycle}`}</td>
                  <td><span className={`ndt-status${NDT_STATUS[n.result] ? ` ndt-status--${NDT_STATUS[n.result]}` : ""}`}>{RESULT[n.result] !== undefined ? t(`pi.jt.res.${n.result}`) : n.result}</span></td>
                  <td className="sm">{n.defect || "—"}</td><td className="mono sm">{n.reportNo || "—"}</td>
                  <td className="sm">{fa(n.inspectedOn)}</td><td className="sm">{n.inspector || "—"}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>{t("pi.jt.revisions")}</h2>
        <TableKit name="joint-2">
          <table className="dtable">
            <thead><tr><th>{t("pi.jt.drawing")}</th><th>{t("c.revision")}</th><th>{t("pi.jt.issued")}</th><th>{t("pi.jt.register")}</th><th>{t("pi.jt.weldNo")}</th><th>Shop/Field</th><th>{t("pi.spool")}</th><th>{t("pi.jt.change")}</th></tr></thead>
            <tbody>{h.revisions.map((r, i) => (
              <tr key={i}><td className="mono sm">{r.docNo}</td><td className="mono">{r.revision}{r.current && <span className="pill ok" style={{ marginInlineStart: 6 }}>{t("pi.jt.current")}</span>}</td>
                <td className="sm">{r.issuedOn ? fa(r.issuedOn) : <span className="muted" title={t("pi.jt.registeredTip")}>{t("pi.jt.registered", { on: fa(r.registeredOn) })}</span>}</td><td className="sm">{r.runStatus === "approved" ? t("hs.jsa.approved") : r.runStatus === "superseded" ? t("hs.jsa.superseded") : t("hs.jsa.draft")}</td>
                <td className="mono">{r.weldNo}</td><td>{shopField(r.shopField)}</td><td className="mono sm">{r.spoolNo || "—"}</td>
                <td className="sm">{r.changes.length ? r.changes.map((c) => `${c.field}: ${c.from ?? "—"} → ${c.to ?? "—"}`).join(" · ") : "—"}</td></tr>
            ))}</tbody>
          </table>
        </TableKit>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>{t("pi.jt.material")}</h2>
          {h.material.length === 0 ? <p className="empty-note">{t("pi.jt.noMaterial")}</p> : (
            <table className="dtable">
              <thead><tr><th>{t("pu.f.item")}</th><th>{t("pi.jt.heat")}</th><th>MTC</th><th>{t("pu.receipt")}</th><th>{t("pu.h.qty")}</th><th>{t("c.date")}</th></tr></thead>
              <tbody>{h.material.map((m, i) => (
                <tr key={i}><td className="mono sm">{m.code}</td><td className="mono">{m.heatNo || "—"}</td>
                  <td><span className={"pill " + (MTC[m.mtcStatus] || "")}>{MTC[m.mtcStatus] !== undefined ? t(`wa.mtc.${m.mtcStatus}`) : m.mtcStatus}</span></td>
                  <td className="mono sm">{m.receiptNo}</td><td className="mono">{m.kind === "return" ? "−" : ""}{m.qty} {m.uom}</td><td className="sm">{fa(m.on)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2>{t("pi.jt.spoolTest")}</h2>
          {!h.spool ? <p className="empty-note">{t("pi.jt.noSpool")}</p> : (
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {h.spool.steps.map((s) => (
                <li key={s.code} className="sm">{L(`chain.piping_spool.${s.code}`, s.title)}: {s.na ? t("hs.notNeeded") : s.status === "done" ? `✓ ${s.doneAt ? fa(s.doneAt) : ""}${s.refNo ? ` (${s.refNo})` : ""}` : s.status === "in_progress" ? t("co.v.inProgress") : "—"}</li>
              ))}
            </ul>
          )}
          <p className="sm" style={{ marginTop: 8 }}>
            {h.testPack ? t("pi.jt.pack", { no: h.testPack.packNo, medium: h.testPack.medium === "hydrostatic" ? t("pi.jt.hydro") : t("pi.jt.pneumatic"),
              what: h.testPack.records.length
                ? h.testPack.records.map((r) => `${fa(r.on)} ${r.verdict === "pass" ? t("pi.jt.pass") : t("pi.jt.fail")}${r.accepted ? ` ${t("pi.jt.andAccepted")}` : ""}`).join(" · ") : t("pi.jt.notTested") })
              : t("pi.jt.noPack")}
          </p>
        </div>
      </div>

      {h.inspections.length > 0 && (
        <div className="card">
          <h2>{t("pi.jt.irs")}</h2>
          <table className="dtable">
            <thead><tr><th>IR</th><th>{t("pi.jt.itpLine")}</th><th>{t("c.activity")}</th><th>{t("hs.time")}</th><th>{t("c.status")}</th><th>NCR</th></tr></thead>
            <tbody>{h.inspections.map((i) => (
              <tr key={i.irNo}><td className="mono">{i.irNo}</td><td className="mono sm">{i.itpNo} · {i.seq}</td><td className="sm">{i.title}</td>
                <td className="sm">{fa(i.plannedAt)}</td><td><span className={"pill " + (i.state === "released" ? "ok" : i.state === "rejected" ? "bad" : "")}>{i.state}</span></td>
                <td className="mono">{i.ncrNo || "—"}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {h.edits.length > 0 && (
        <div className="card">
          <h2>{t("pi.jt.edits")}</h2>
          <p className="muted sm">{t("pi.jt.editsNote")}</p>
          <table className="dtable">
            <thead><tr><th>Rev</th><th>{t("pi.jt.path")}</th><th>{t("pi.jt.before")}</th><th>{t("pi.jt.after")}</th><th>{t("pu.vdt.reason")}</th><th>{t("pi.jt.by")}</th></tr></thead>
            <tbody>{h.edits.map((e, i) => (
              <tr key={i}><td className="mono">{e.revision}</td><td className="mono sm">{e.path}</td><td className="mono sm">{JSON.stringify(e.before)}</td>
                <td className="mono sm">{JSON.stringify(e.after)}</td><td className="sm">{e.reason || "—"}</td><td className="sm">{e.by || "—"}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

function KV({ k, v, mono }) {
  const empty = v === null || v === undefined || v === "";
  // Codes (lines, spools, drawings) read left to right even on a right-to-left page.
  return <div><span className="muted sm">{k}</span><div>{empty ? "—" : mono ? <bdi dir="ltr" className="mono">{v}</bdi> : v}</div></div>;
}
