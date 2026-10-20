"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import { useRemove } from "../../lib/client/remove.mjs";
import Tabs from "../../components/ui/Tabs";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * NDT of support, structural and equipment welds, as the project's NDT
 * matrix requires. Rules: lib/ndt/joints.mjs and lib/ndt/compliance.mjs.
 */
const TONE = { accepted: "ok", accepted_by_sample: "ok", not_welded: "", awaiting: "warn", awaiting_sample: "warn", progressive: "warn",
  rejected: "bad", full_examination: "bad", extension_unknown: "bad", unknown: "bad", sample_not_drawn: "bad", welder_unsampled: "bad", no_welder: "bad" };
// the tones in the owner's NDT status style (app/ui-ux-ndt.css); a joint not yet welded has none
const NDT_STATUS = { ok: "passed", warn: "pending", bad: "failed" };
const ndtStatus = (k) => `ndt-status${NDT_STATUS[TONE[k]] ? ` ndt-status--${NDT_STATUS[TONE[k]]}` : ""}`;

export default function NdtJointsPage() {
  const { projectId, role, call } = usePlatform();
  const { t, L } = usePrefs();
  const { data, error, reload } = useProjectData((id) => `/api/ndt-joints?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null);
  const may = { eng: can({ role }, ACTIONS.EDIT_EXTRACTION), weld: can({ role }, ACTIONS.ASSIGN_WELD),
    ndt: can({ role }, ACTIONS.RECORD_NDT), draw: can({ role }, ACTIONS.DRAW_NDT_SAMPLE) };
  const removeJoint = useRemove("weld-joint", reload);

  async function post(body, done) {
    setMsg(null);
    try {
      const r = await call("/api/ndt-joints", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      if (done) setMsg({ ok: true, text: done(r.result) });
      reload();
      return true;
    } catch (e) { setMsg({ ok: false, text: e.message }); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const c = data.counts;
  const scope = (k) => L(`ndt.scope.${k}`, data.scopes[k]);
  const jt = (k) => L(`ndt.joint.${k}`, data.jointTypes[k]);
  const status = (k) => L(`ndt.status.${k}`, data.statusText[k]);
  const list = (xs) => xs.join(t("c.sep"));

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{t("ndtj.title")}</h1>
        <span className="sub">{t("ndtj.sub", { total: c.total, welded: c.welded, done: c.done, unknown: c.unknown })}</span>
      </div>
      {msg && <p className={msg.ok ? "muted" : "err"}>{msg.text}</p>}

      {/* the same four counts as the line above, as summary cards */}
      <div className="ndt-summary">
        {[["total", c.total], ["welded", c.welded], ["done", c.done], ["unknown", c.unknown]].map(([k, v]) => (
          <div key={k} className="ndt-summary__card" data-count={k}>
            <span className="ndt-summary__label">{t(`ndtj.sum.${k}`)}</span>
            <span className="ndt-summary__value">{v}</span>
          </div>
        ))}
      </div>

      <Tabs name="ndt-joints">
      <div className="card">
        <h2>{t("ndtj.matrix")}</h2>
        <p className="muted sm">{t("ndtj.matrixNote")}</p>
        {data.matrix.length === 0 ? <p className="empty-note">{t("ndtj.noRules")}</p> : (
          <TableKit name="ndt-matrix" onDelete={may.eng ? (ruleId) => post({ kind: "rule-remove", ruleId }) : undefined}>
          <table className="dtable">
            <thead><tr><th>{t("ndtj.h.scope")}</th><th>{t("ndtj.h.jointType")}</th><th>{t("c.method")}</th><th>{t("ndtj.h.percent")}</th><th>{t("ndtj.h.extension")}</th><th>{t("c.reference")}</th></tr></thead>
            <tbody>{data.matrix.map((r) => (
              <tr key={r.id} data-key={r.id}><td>{scope(r.scope)}</td><td>{jt(r.joint_type)}</td><td className="mono">{r.method}</td>
                <td className="mono">{r.percent}%</td><td className="sm">{r.percent < 100 ? (data.extensions[r.extension] ? L(`ndt.ext.${r.extension}`, data.extensions[r.extension]) : t("ndtj.unset")) : "—"}</td>
                <td className="sm">{r.basis}</td></tr>
            ))}</tbody>
          </table>
          </TableKit>
        )}
        {may.eng && <Fold title={t("ndtj.newRule")}><RuleForm data={data} post={post} /></Fold>}
      </div>

      {(data.needSample.length > 0 || data.lots.length > 0) && (
        <div className="card">
          <h2>{t("ndtj.sampling")}</h2>
          {data.needSample.map((g) => (
            <p key={`${g.group}|${g.jointType}|${g.method}`} className="sm">
              <b>{g.groupLabel}</b> — {jt(g.jointType)} — {g.method} {g.percent}%: {t("ndtj.notDrawn")}{" "}
              {may.draw && <button className="btn" onClick={() => post({ kind: "sample", group: g.group, jointType: g.jointType, method: g.method },
                (r) => t("ndtj.drawn", { list: list(r.jointNos), seed: r.seed }))}>{t("ndtj.draw")}</button>}</p>
          ))}
          {data.lots.map((l) => (
            <p key={`${l.group}|${l.jointType}|${l.method}|${l.welderId}`} className="sm">
              <b>{l.groupLabel}</b> — {l.method} — {t("ndtj.welderStamp", { stamp: l.stamp })}: <span className={ndtStatus(l.status)}>{status(l.status)}</span>
              {l.defects.length > 0 && t("ndtj.defects", { list: list(l.defects) })}
              {l.drawn.length > 0 && t("ndtj.drawnList", { list: list(l.drawn) })}
              {l.waiting.length > 0 && t("ndtj.waiting", { list: list(l.waiting) })}
              {l.drawNeeded !== null && may.draw && <> {" "}<button className="btn" onClick={() => post({ kind: "progressive", group: l.group, jointType: l.jointType, method: l.method, welderId: l.welderId },
                (r) => t("ndtj.progressiveDrawn", { list: list(r.jointNos) }))}>{t("ndtj.drawN", { n: l.drawNeeded })}</button></>}</p>
          ))}
        </div>
      )}

      <div className="card">
        <h2>{t("ndtj.register")}</h2>
        {data.joints.length === 0 ? <p className="empty-note">{t("ndtj.noJoints")}</p> : (
          <TableKit name="ndt-joints" {...(may.eng ? removeJoint : {})}>
            <table className="dtable">
              <thead><tr><th>{t("ndtj.h.joint")}</th><th>{t("ndtj.h.scope")}</th><th>{t("ndtj.h.parent")}</th><th>{t("ndtj.h.type")}</th><th>{t("ndtj.h.requirement")}</th><th>{t("c.welder")}</th><th>{t("c.status")}</th><th /></tr></thead>
              <tbody>{data.joints.map((j) => (
                <tr key={j.id} data-key={j.id}>
                  <td className="mono">{j.jointNo}</td><td className="sm">{scope(j.scope)}</td><td className="mono">{j.parent}</td>
                  <td className="sm">{jt(j.jointType)}{j.thicknessMm && ` · ${j.thicknessMm} mm`}</td>
                  <td>{j.methods.length ? <span className="ndt-methods">{j.methods.map((m) => <span key={m.method} className="ndt-method">{m.method} {m.percent}%</span>)}</span> : "—"}</td>
                  <td className="mono">{j.stamp || "—"}{j.weldedOn && <div className="muted sm">{j.weldedOn}</div>}</td>
                  <td><span className={ndtStatus(j.status)}>{status(j.status)}</span>
                    {j.methods.length > 1 && <div className="muted sm">{j.methods.map((m) => `${m.method}: ${m.text}`).join(" · ")}</div>}</td>
                  <td><button className="btn ghost" onClick={() => setOpen(open === j.id ? null : j.id)}>{open === j.id ? t("common.close") : t("ndtj.record")}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </TableKit>
        )}
        {data.joints.filter((j) => j.id === open).map((j) => <JointActions key={j.id} j={j} data={data} post={post} may={may} />)}
        {may.eng && <Fold title={t("ndtj.newJoint")}><JointForm data={data} post={post} /></Fold>}
      </div>
      </Tabs>
    </div>
  );
}

function RuleForm({ data, post }) {
  const { t, L } = usePrefs();
  const blank = { scope: "structural", jointType: "cjp", method: "VT", percent: "100", extension: "", basis: "" };
  const [f, setF] = useState(blank);
  const on = (k) => (v) => setF({ ...f, [k]: v });
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "rule", ...f, extension: f.extension || null })) setF({ ...blank, scope: f.scope }); }}>
      <div className="grid2">
        <Select id="r-s" label={t("ndtj.h.scope")} value={f.scope} on={on("scope")} opts={Object.entries(data.scopes).map(([k, v]) => [k, L(`ndt.scope.${k}`, v)])} />
        <Select id="r-j" label={t("ndtj.h.jointType")} value={f.jointType} on={on("jointType")} opts={Object.entries(data.jointTypes).map(([k, v]) => [k, L(`ndt.joint.${k}`, v)])} />
        <Select id="r-m" label={t("c.method")} value={f.method} on={on("method")} opts={data.methods.map((m) => [m, m])} />
        <Field id="r-p" label={t("ndtj.h.percent")} type="number" value={f.percent} on={on("percent")} />
        {Number(f.percent) < 100 && <Select id="r-e" label={t("ndtj.extensionOnSample")} value={f.extension} on={on("extension")}
          opts={Object.entries(data.extensions).map(([k, v]) => [k, L(`ndt.ext.${k}`, v)])} blank={t("ndtj.unsetLong")} />}
        <Field id="r-b" label={t("ndtj.basis")} value={f.basis} on={on("basis")} />
      </div>
      <button className="btn">{t("ndtj.saveRule")}</button>
    </form>
  );
}

function JointForm({ data, post }) {
  const { t, L } = usePrefs();
  const blank = { scope: "structural", jointNo: "", parent: "", jointType: "cjp", thicknessMm: "", drawingRef: "" };
  const [f, setF] = useState(blank);
  const on = (k) => (v) => setF({ ...f, [k]: v });
  const parents = f.scope === "support" ? data.supports.map((s) => [s.id, `${s.support_no}${s.line_no ? ` · ${s.line_no}` : ""}`])
    : data.tags.filter((t) => t.discipline === (f.scope === "structural" ? "structural" : "equipment")).map((t) => [t.id, t.tag_no]);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const { parent, ...rest } = f;
      if (await post({ kind: "joint", ...rest, tagId: f.scope === "support" ? null : parent, supportId: f.scope === "support" ? parent : null })) setF({ ...blank, scope: f.scope, parent: f.parent });
    }}>
      <div className="grid2">
        <Select id="j-s" label={t("ndtj.h.scope")} value={f.scope} on={(v) => setF({ ...f, scope: v, parent: "" })} opts={Object.entries(data.scopes).map(([k, v]) => [k, L(`ndt.scope.${k}`, v)])} />
        <Select id="j-p" label={f.scope === "support" ? t("ndtj.support") : t("c.tag")} value={f.parent} on={on("parent")} opts={parents} blank="—" />
        <Field id="j-n" label={t("ndtj.jointNo")} value={f.jointNo} on={on("jointNo")} />
        <Select id="j-t" label={t("ndtj.h.jointType")} value={f.jointType} on={on("jointType")} opts={Object.entries(data.jointTypes).map(([k, v]) => [k, L(`ndt.joint.${k}`, v)])} />
        <Field id="j-th" label={t("ndtj.thickness")} type="number" value={f.thicknessMm} on={on("thicknessMm")} />
        <Field id="j-d" label={t("ndtj.drawing")} value={f.drawingRef} on={on("drawingRef")} />
      </div>
      <button className="btn">{t("ndtj.saveJoint")}</button>
    </form>
  );
}

function JointActions({ j, data, post, may }) {
  const { t } = usePrefs();
  const today = new Date().toISOString().slice(0, 10);
  const [w, setW] = useState({ welderId: "", weldedOn: today });
  const [n, setN] = useState({ method: j.methods[0]?.method || "VT", result: "accept", reportNo: "", defectType: "", inspectedOn: today, inspector: "" });
  return (
    <div className="card" style={{ marginTop: 8 }}>
      <h3>{j.jointNo}</h3>
      {may.weld && (
        <form style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }} onSubmit={async (e) => { e.preventDefault(); await post({ kind: "weld", jointId: j.id, ...w }); }}>
          <Select id={`w-${j.id}`} label={t("c.welder")} value={w.welderId} on={(v) => setW({ ...w, welderId: v })} opts={data.welders.map((x) => [x.id, `${x.stamp_no} — ${x.name}`])} blank="—" />
          <Field id={`wd-${j.id}`} label={t("ndtj.weldedOn")} type="date" value={w.weldedOn} on={(v) => setW({ ...w, weldedOn: v })} />
          <button className="btn ghost">{t("ndtj.saveWeld")}</button>
        </form>
      )}
      {may.ndt && j.weldedOn && (
        <form style={{ marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "ndt", jointId: j.id, ...n })) setN({ ...n, reportNo: "", defectType: "" }); }}>
          <div className="grid2">
            <Select id={`nm-${j.id}`} label={t("c.method")} value={n.method} on={(v) => setN({ ...n, method: v })} opts={data.methods.map((m) => [m, m])} />
            <Select id={`nr-${j.id}`} label={t("c.result")} value={n.result} on={(v) => setN({ ...n, result: v })}
                    opts={[["accept", t("ndtj.accept")], ["reject", t("ndtj.reject")], ["pending", t("ndtj.pending")]]} />
            {n.result === "reject" && <Field id={`nd-${j.id}`} label={t("ndtj.defectType")} value={n.defectType} on={(v) => setN({ ...n, defectType: v })} />}
            <Field id={`nn-${j.id}`} label={t("ndtj.reportNo")} value={n.reportNo} on={(v) => setN({ ...n, reportNo: v })} />
            <Field id={`no-${j.id}`} label={t("c.date")} type="date" value={n.inspectedOn} on={(v) => setN({ ...n, inspectedOn: v })} />
            <Field id={`ni-${j.id}`} label={t("c.inspector")} value={n.inspector} on={(v) => setN({ ...n, inspector: v })} />
          </div>
          <button className="btn">{t("ndtj.saveNdt")}</button>
        </form>
      )}
    </div>
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

function Field({ id, label, value, on, type = "text" }) {
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <input id={id} type={type} step={type === "number" ? "any" : undefined} dir={type === "text" ? "auto" : "ltr"} value={value} onChange={(e) => on(e.target.value)} /></div>
  );
}
