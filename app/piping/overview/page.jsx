"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../../lib/authz.mjs";
import TableKit from "../../../components/ui/TableKit";
import Tabs from "../../../components/ui/Tabs";
import Fold from "../../../components/ui/Fold";
import { usePrefs } from "../../../lib/client/prefs.mjs";

/**
 * Piping on one page: progress in welds and inch-dia, NDT compliance as each
 * weld's requirement defines it (lib/ndt/compliance.mjs), lines, welders,
 * and what is missing for any of it to be known.
 */
const TONE = { rejected: "bad", full_examination: "bad", progressive: "warn", awaiting: "warn", awaiting_sample: "warn",
  sample_not_drawn: "bad", unknown: "bad", no_welder: "bad", welder_unsampled: "bad" };

export default function PipingOverview() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/piping/hub?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const mayDraw = can({ role }, ACTIONS.DRAW_NDT_SAMPLE);
  const { t: tr, L, num } = usePrefs();
  async function drawLot(l) {
    setMsg(null);
    try {
      const r = await call("/api/piping/hub", { method: "POST", body: JSON.stringify({ projectId, kind: "progressive-draw", lineId: l.lineId, method: l.method, welderId: l.welderId }) });
      setMsg({ ok: true, text: tr("pi.ov.drawn", { list: r.result.weldNos.join(tr("c.sep")), seed: r.result.seed }) });
      reload();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{tr("common.loading")}</p>;
  const t = data.totals;
  const pct = (a, b) => (b ? `${num(Math.round((a / b) * 1000) / 10)}%` : "—");
  const st = (k) => L(`ndt.status.${k}`, data.statusText[k]);
  const open = Object.entries(data.byStatus).filter(([k]) => !["accepted", "accepted_by_sample", "not_welded"].includes(k));
  const m = data.missing;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{tr("pi.ov.title")}</h1>
        <span className="sub">{tr("pi.ov.sub", { lines: data.lines.length, dwg: t.drawings, appr: t.drawingsApproved, welds: t.welds })}</span>
      </div>

      <div className="kpis">
        <Kpi v={pct(t.welded, t.welds)} l={tr("pi.ov.k.welded")} b={tr("pi.ov.k.ofN", { a: t.welded, b: t.welds })} />
        <Kpi v={pct(t.diWelded, t.di)} l={tr("pi.ov.k.di")} b={tr("pi.ov.k.ofDi", { a: t.diWelded, b: t.di })} />
        <Kpi v={pct(t.ndtDone, t.welded)} l={tr("pi.ov.k.ndt")} b={tr("pi.ov.k.ndtB", { a: t.ndtDone, b: t.diDone })} tone={t.welded && t.ndtDone < t.welded ? "warn" : "ok"} />
        <Kpi v={t.field} l={tr("pi.ov.k.field")} b={tr("pi.ov.k.shop", { n: t.welds - t.field })} />
        <Kpi v={t.supports ? `${t.supports.installed}/${t.supports.total}` : "—"} l={tr("pi.ov.k.supports")} b={t.supports ? tr("pi.ov.k.inspected", { n: t.supports.inspected }) : ""} />
        <Kpi v={`${t.packs.accepted}/${t.packs.total}`} l={tr("pi.ov.k.packs")} />
      </div>
      {t.unsized > 0 && <p className="muted sm">{tr("pi.ov.unsized", { n: t.unsized })}</p>}

      <Tabs name="piping-overview">
      <div className="card">
        <h2>{tr("pi.ov.ndtOpen")}</h2>
        <p className="muted sm">{tr("pi.ov.ndtNote")}</p>
        {open.length === 0 ? <p className="empty-note">{tr("pi.ov.ndtAll")}</p> : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {open.map(([k, n]) => <span key={k} className={`pill ${TONE[k] || ""}`}>{st(k)}: {n}</span>)}
          </div>
        )}
      </div>

      {msg && <p className={msg.ok ? "muted" : "err"}>{msg.text}</p>}
      {data.lots.length > 0 && (
        <div className="card">
          <h2>{tr("pi.ov.prog")}</h2>
          <p className="muted sm">{tr("pi.ov.progNote")}</p>
          <TableKit name="progressive-lots">
            <table className="dtable">
              <thead><tr><th>{tr("pi.line")}</th><th>{tr("pi.method")}</th><th>{tr("pi.welder")}</th><th>{tr("pi.ov.tier")}</th><th>{tr("pi.ov.defects")}</th><th>{tr("pi.ov.draw")}</th><th>{tr("c.status")}</th></tr></thead>
              <tbody>{data.lots.map((l) => (
                <tr key={`${l.lineId}|${l.method}|${l.welderId}`}>
                  <td className="mono">{l.lineNo}</td><td className="mono">{l.method}</td><td className="mono">{l.stamp}</td>
                  <td>{l.status === "full_examination" ? tr("pi.ov.tierD") : l.tier === "a" ? tr("pi.ov.tierA") : tr("pi.ov.tierB")}</td>
                  <td className="mono">{l.defects.join(tr("c.sep")) || "—"}</td>
                  <td className="mono">{l.drawn.join(tr("c.sep")) || "—"}</td>
                  <td>{l.status === "full_examination" ? <span className="pill bad">{tr("pi.ov.allLot")}</span>
                    : l.drawNeeded !== null ? (mayDraw ? <button className="btn" onClick={() => drawLot(l)}>{tr("pi.ov.drawN", { n: l.drawNeeded })}</button>
                      : <span className="pill warn">{tr("pi.ov.awaitDraw", { n: l.drawNeeded })}</span>)
                    : <span className="pill warn">{tr("pi.ov.awaitNdt")} {l.waiting.join(tr("c.sep"))}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </TableKit>
        </div>
      )}

      <div className="card">
        <h2>{tr("pi.ov.lines")}</h2>
        <p className="sm"><a href={`/api/piping/hub?projectId=${projectId}&export=weldlog`}>{tr("pi.ov.weldlog")}</a></p>
        <TableKit name="piping-lines">
          <table className="dtable">
            <thead><tr><th>{tr("pi.line")}</th><th>{tr("pi.ov.classService")}</th><th>{tr("pi.welds")}</th><th>{tr("pi.ov.di")}</th><th>{tr("pi.ov.ndtReq")}</th><th>{tr("pi.ov.openNdt")}</th><th>{tr("pi.spool")}</th><th>{tr("pi.ov.pack")}</th></tr></thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.lineNo}{l.subsystem && <div className="muted sm">{l.subsystem}</div>}</td>
                  <td className="sm">{l.pipingClass || "—"}{!l.classLinked && <div className="pill bad">{tr("pi.ov.noClass")}</div>}{l.service && <div className="muted">{l.service}</div>}</td>
                  <td className="mono">{l.welded}/{l.welds}<div className="muted sm">{tr("pi.ov.ndtDone", { n: l.ndtDone })}</div></td>
                  <td className="mono">{l.diWelded}/{l.di.di}<div className="muted sm">{tr("pi.ov.ndtDone", { n: l.diDone })}{l.di.unsized > 0 && ` · ${tr("pi.ov.unsizedN", { n: l.di.unsized })}`}</div></td>
                  <td className="sm">{l.requirements.join(tr("c.sep")) || tr("pi.ov.notSet")}
                    {l.samples.map((s) => <div key={s.method} className="muted">{tr("pi.ov.sample", { method: s.method, pct: s.percent, n: s.drawn })}</div>)}</td>
                  <td className="sm">{Object.entries(l.open).map(([k, n]) => <div key={k}><span className={`pill ${TONE[k] || ""}`}>{st(k)}: {n}</span></div>)}{!Object.keys(l.open).length && "—"}</td>
                  <td className="sm">{Object.entries(l.spools).map(([k, n]) => `${L(`chain.piping_spool.${k}`, k)}: ${n}`).join(" · ") || "—"}</td>
                  <td className="sm">{l.pack ? <span className={`pill ${l.pack.accepted ? "ok" : "warn"}`}>{l.pack.no}{l.pack.accepted ? ` — ${tr("co.v.accepted")}` : ""}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      </div>

      <div className="card">
        <h2>{tr("pi.welders")}</h2>
        {data.welders.length === 0 ? <p className="empty-note">{tr("pi.ov.noWelders")}</p> : (
          <TableKit name="piping-welders">
            <table className="dtable">
              <thead><tr><th>{tr("pi.stamp")}</th><th>{tr("pu.v.name")}</th><th>{tr("pi.welds")}</th><th>{tr("pi.ov.firstShots")}</th><th>{tr("pi.ov.rejects")}</th><th>{tr("pi.repairRate")}</th></tr></thead>
              <tbody>{data.welders.map((w) => (
                <tr key={w.stamp_no}><td className="mono">{w.stamp_no}</td><td>{w.welder_name}</td><td className="mono">{w.welds_made}</td>
                  <td className="mono">{w.shots}</td><td className="mono">{w.rejects}</td>
                  <td className="mono">{w.repair_rate_pct === null ? "—" : `${num(w.repair_rate_pct)}%`}</td></tr>
              ))}</tbody>
            </table>
          </TableKit>
        )}
      </div>

      {(m.linesWithoutClass.length > 0 || m.noRequirement > 0 || m.samplesNotDrawn.length > 0 || m.unsized > 0) && (
        <div className="card">
          <h2>{tr("pi.ov.missing")}</h2>
          <ul className="sm">
            {m.linesWithoutClass.length > 0 && <li>{tr("pi.ov.m.noClass")} {m.linesWithoutClass.join(tr("c.sep"))}</li>}
            {m.noRequirement > 0 && <li>{tr("pi.ov.m.noReq", { n: m.noRequirement })}</li>}
            {m.samplesNotDrawn.length > 0 && <li>{tr("pi.ov.m.noDraw", { list: m.samplesNotDrawn.join(tr("c.sep")) })}</li>}
            {m.unsized > 0 && <li>{tr("pi.ov.m.unsized", { n: m.unsized })}</li>}
          </ul>
        </div>
      )}
      <PipingClasses may={can({ role }, ACTIONS.MANAGE_PIPING_CLASS)} />
      </Tabs>
    </div>
  );
}

// B31.3 fluid-service categories: the standard's own English terms, in every language
const SERVICE_FA = { normal: "Normal", category_d: "Category D", category_m: "Category M", severe_cyclic: "Severe cyclic", high_pressure: "High pressure (Ch. IX)" };

/**
 * The project's piping classes. A line names its class on the drawing; the
 * class's design pressure is what a test pack's pressure is computed from
 * (B31.3 §345.4.2), and its service category is the floor under every
 * weld's NDT. Without a class the pack cannot say what pressure is enough.
 */
function PipingClasses({ may }) {
  const { projectId, call } = usePlatform();
  const { t } = usePrefs();
  const { data, reload } = useProjectData((id) => `/api/piping-classes?projectId=${id}`, []);
  const blank = { code: "", description: "", serviceCategory: "normal", materialSpec: "", corrosionAllowMm: "", designTempC: "", designPressBarg: "", pwhtAboveMm: "" };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState(null);
  const num = (v) => (v === "" ? null : Number(v));
  const write = (v) => call("/api/piping-classes", { method: "POST", body: JSON.stringify({ projectId, ...v,
    corrosionAllowMm: num(v.corrosionAllowMm), designTempC: num(v.designTempC), designPressBarg: num(v.designPressBarg), pwhtAboveMm: num(v.pwhtAboveMm) }) });
  async function save(e) {
    e.preventDefault(); setMsg(null);
    try { await write(f); setF(blank); reload(); } catch (err) { setMsg(err.message); }
  }
  const classOf = (c) => ({ code: c.code, description: c.description || "", serviceCategory: c.service_category, materialSpec: c.material_spec || "",
    corrosionAllowMm: c.corrosion_allow_mm ?? "", designTempC: c.design_temp_c ?? "", designPressBarg: c.design_press_barg ?? "", pwhtAboveMm: c.pwht_above_mm ?? "" });
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const classes = data?.classes || [];
  return (
    <div className="card">
      <h2>{t("pi.pc.title")}</h2>
      {classes.length === 0 ? <p className="empty-note">{t("pi.pc.empty")}</p> : (
        <TableKit name="piping-class" onEdit={may ? (id) => setF(classOf(classes.find((x) => x.id === id))) : undefined}
          rowEdit={may ? { fields: [{ col: t("c.description"), name: "description" }, { col: t("pi.pc.service"), name: "serviceCategory", type: "select", options: Object.entries(SERVICE_FA) },
            { col: t("pi.pc.material"), name: "materialSpec" }, { col: t("pi.pc.ca"), name: "corrosionAllowMm", type: "number" }, { col: t("pi.pc.t"), name: "designTempC", type: "number" },
            { col: t("pi.pc.p"), name: "designPressBarg", type: "number" }, { col: t("pi.pc.pwht"), name: "pwhtAboveMm", type: "number" }],
            value: (id) => classOf(classes.find((x) => x.id === id)),
            onSave: async (id, v) => { setMsg(null); try { await write(v); reload(); return true; } catch (err) { setMsg(err.message); return false; } } } : undefined}>
          <table className="dtable">
            <thead><tr><th>{t("pi.pc.class")}</th><th>{t("c.description")}</th><th>{t("pi.pc.service")}</th><th>{t("pi.pc.material")}</th><th>{t("pi.pc.ca")}</th><th>{t("pi.pc.t")}</th><th>{t("pi.pc.p")}</th><th>{t("pi.pc.pwht")}</th></tr></thead>
            <tbody>{classes.map((c) => (
              <tr key={c.id} data-key={c.id}>
                <td className="mono">{c.code}</td><td>{c.description || "—"}</td><td className="sm">{SERVICE_FA[c.service_category] || c.service_category}</td>
                <td className="sm">{c.material_spec || "—"}</td><td className="mono">{c.corrosion_allow_mm ?? "—"}</td>
                <td className="mono">{c.design_temp_c ?? "—"}</td><td className="mono">{c.design_press_barg ?? <span className="pill warn">{t("hs.unknown")}</span>}</td>
                <td className="mono">{c.pwht_above_mm ?? "—"}</td>
              </tr>))}</tbody>
          </table>
        </TableKit>
      )}
      {may && (
        <Fold title={t("pi.pc.fold")}>
          <form onSubmit={save}>
            <div className="grid2">
              <div className="field"><label htmlFor="pc-code">{t("pi.pc.code")}</label><input id="pc-code" dir="ltr" value={f.code} onChange={on("code")} required /></div>
              <div className="field"><label htmlFor="pc-desc">{t("c.description")}</label><input id="pc-desc" dir="auto" value={f.description} onChange={on("description")} /></div>
              <div className="field"><label htmlFor="pc-svc">{t("pi.pc.serviceB")}</label>
                <select id="pc-svc" value={f.serviceCategory} onChange={on("serviceCategory")}>
                  {Object.entries(SERVICE_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div className="field"><label htmlFor="pc-mat">{t("wa.spec")}</label><input id="pc-mat" dir="ltr" value={f.materialSpec} onChange={on("materialSpec")} /></div>
              <div className="field"><label htmlFor="pc-ca">{t("pi.pc.caLong")}</label><input id="pc-ca" type="number" step="any" dir="ltr" value={f.corrosionAllowMm} onChange={on("corrosionAllowMm")} /></div>
              <div className="field"><label htmlFor="pc-t">{t("pi.pc.tLong")}</label><input id="pc-t" type="number" step="any" dir="ltr" value={f.designTempC} onChange={on("designTempC")} /></div>
              <div className="field"><label htmlFor="pc-p">{t("pi.pc.pLong")}</label><input id="pc-p" type="number" step="any" dir="ltr" value={f.designPressBarg} onChange={on("designPressBarg")} /></div>
              <div className="field"><label htmlFor="pc-pwht">{t("pi.pc.pwhtLong")}</label><input id="pc-pwht" type="number" step="any" dir="ltr" value={f.pwhtAboveMm} onChange={on("pwhtAboveMm")} /></div>
            </div>
            {msg && <p className="err">{msg}</p>}
            <div><button className="btn" type="submit">{t("pi.pc.save")}</button></div>
            <p className="muted sm">{t("pi.pc.note")}</p>
          </form>
        </Fold>
      )}
    </div>
  );
}

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}
