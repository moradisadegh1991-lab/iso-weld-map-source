"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import Fold from "../../components/ui/Fold";

import TableKit from "../../components/ui/TableKit";
import { usePrefs } from "../../lib/client/prefs.mjs";
/**
 * The workflow of each report type: stages in order, the review groups of
 * each stage in priority order, and who sits in each group with which
 * rights. What the rights allow is decided by lib/reports/workflow.mjs; this
 * page only says who holds them.
 */
// what each right allows, as a tooltip: rs.help.<right>

export default function ReportSetupPage() {
  const { projectId, call } = usePlatform();
  const { t: tr, L } = usePrefs();
  const { data, error, reload } = useProjectData((id) => `/api/report-setup?projectId=${id}`, []);
  const perm = (k) => L(`report.perm.${k}`, data.permissions[k]);
  const [msg, setMsg] = useState(null);
  // a form's designer arrives from the forms page with ?type=ID
  const [typeId, setTypeId] = useState(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("type")) || null);
  const [nt, setNt] = useState({ code: "", name: "", description: "" });
  const [ns, setNs] = useState({ seq: "", name: "" });
  const [ng, setNg] = useState({});        // per stage: { seq, name, title, description }
  const [nm, setNm] = useState({});        // per group: { userId, permissions[] }

  async function post(body) {
    setMsg(null);
    try { const r = await call("/api/report-setup", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{tr("common.loading")}</p>;
  const type = data.types.find((t) => t.id === typeId) || data.types[0] || null;
  const name = (uid) => data.users.find((u) => u.id === uid)?.name || "—";
  const gform = (sid) => ng[sid] || { seq: "", name: "", title: "", description: "" };
  const mform = (gid) => nm[gid] || { userId: "", permissions: ["view"] };

  return (
    <div className="page">
      <div className="pagehead"><h1>{tr("rs.title")}</h1>
        <span className="sub">{tr("rs.sub", { n: data.types.length })}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}

      <div className="card">
        <h2>{tr("rs.types")}</h2>
        {data.types.length === 0 ? (
          <p className="empty-note">{tr("rs.noTypes")}</p>
        ) : (
          <div className="seg" role="radiogroup" aria-label={tr("rs.type")}>
            {data.types.map((t) => (
              <label key={t.id}><input type="radio" name="rtype" checked={type?.id === t.id} onChange={() => setTypeId(t.id)} />
                <span className="mono">{t.code}</span> — {t.name} <span className="muted sm">{tr("rs.typeCounts", { stages: t.stages.length, reports: t.reports })}</span></label>
            ))}
          </div>
        )}
        {data.may?.types !== false && <>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!data.types.some((t) => t.code === "DR") && (
            <button className="btn" type="button" onClick={() => post({ kind: "template" })}>{tr("rs.template")}</button>
          )}
        </div>
        <Fold title={tr("rs.defineType")}>
          <form onSubmit={async (e) => { e.preventDefault(); const r = await post({ kind: "type", ...nt }); if (r) { setNt({ code: "", name: "", description: "" }); setTypeId(r.row.id); } }}>
            <div className="grid2">
              <div className="field"><label htmlFor="rt-code">{tr("rs.code")}</label><input id="rt-code" dir="ltr" required value={nt.code} onChange={(e) => setNt({ ...nt, code: e.target.value })} /></div>
              <div className="field"><label htmlFor="rt-name">{tr("rs.name")}</label><input id="rt-name" required value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} /></div>
              <div className="field"><label htmlFor="rt-desc">{tr("rs.desc")}</label><input id="rt-desc" value={nt.description} onChange={(e) => setNt({ ...nt, description: e.target.value })} /></div>
            </div>
            <button className="btn" type="submit">{tr("rs.saveType")}</button>
          </form>
        </Fold></>}
        {data.may?.types === false && <p className="sm muted">{tr("rs.formsOnly")}</p>}
      </div>

      {type && (
        <div className="card">
          <h2>{tr("rs.stagesOf", { name: type.name })}</h2>
          {type.reports > 0 && <p className="muted sm">{tr("rs.hasReports", { n: type.reports })}</p>}
          {type.stages.length === 0 && <p className="empty-note">{tr("rs.noStages")}</p>}
          {type.stages.map((st) => (
            <div className="stagebox" key={st.id}>
              <h3>{tr("rs.stage", { seq: st.seq, name: st.name })}
                {type.reports === 0 && <button className="btn ghost sm" type="button" style={{ marginInlineStart: 8 }}
                  onClick={() => post({ kind: "stage-remove", stageId: st.id })}>{tr("rs.removeStage")}</button>}</h3>
              <StageApprover st={st} users={data.users} post={post} />
              {st.groups.length === 0 && <p className="muted sm">{tr("rs.noGroups")}</p>}
              {st.groups.map((g) => (
                <div className="groupbox" key={g.id}>
                  <b>{g.seq}. {g.name}</b>{g.title && <span className="muted sm"> — {g.title}</span>}
                  {g.description && <div className="muted sm">{g.description}</div>}
                  <TableKit name="report-setup-1"><table className="dtable" style={{ marginTop: 6 }}>
                    <thead><tr><th>{tr("rs.h.member")}</th><th>{tr("rs.h.rights")}</th><th /></tr></thead>
                    <tbody>
                      {g.members.length === 0 && <tr><td colSpan={3} className="muted sm">{tr("rs.noMembers")}</td></tr>}
                      {g.members.map((m) => (
                        <tr key={m.userId}>
                          <td>{m.name || name(m.userId)}</td>
                          <td className="sm">{m.permissions.map(perm).join(tr("c.sep"))}</td>
                          <td><button className="btn ghost sm" type="button" onClick={() => post({ kind: "member-remove", groupId: g.id, userId: m.userId })}>{tr("rs.removeMember")}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table></TableKit>
                  <details className="inlinefold"><summary>{tr("rs.memberFold")}</summary>
                    <form onSubmit={async (e) => {
                      e.preventDefault(); const f = mform(g.id);
                      if (await post({ kind: "member", groupId: g.id, userId: f.userId, permissions: f.permissions })) setNm({ ...nm, [g.id]: undefined });
                    }}>
                      <div className="field"><label htmlFor={`gm-u-${g.id}`}>{tr("rs.user")}</label>
                        <select id={`gm-u-${g.id}`} required value={mform(g.id).userId} onChange={(e) => {
                          const have = g.members.find((m) => m.userId === e.target.value);
                          setNm({ ...nm, [g.id]: { userId: e.target.value, permissions: have ? have.permissions : mform(g.id).permissions } });
                        }}>
                          <option value="">—</option>
                          {data.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}{u.email && u.email !== u.name ? ` (${u.email})` : ""}</option>)}
                        </select></div>
                      <div className="permgrid" role="group" aria-label={tr("rs.h.rights")}>
                        {Object.keys(data.permissions).map((k) => (
                          <label key={k} title={tr(`rs.help.${k}`)}><input type="checkbox" checked={mform(g.id).permissions.includes(k)} onChange={(e) => {
                            const f = mform(g.id);
                            setNm({ ...nm, [g.id]: { ...f, permissions: e.target.checked ? [...f.permissions, k] : f.permissions.filter((x) => x !== k) } });
                          }} /> {perm(k)}</label>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button className="btn" type="submit">{tr("rs.saveMember")}</button>
                        <button className="btn ghost" type="button" onClick={() => post({ kind: "group-remove", groupId: g.id })}>{tr("rs.removeGroup")}</button>
                      </div>
                    </form>
                  </details>
                </div>
              ))}
              <details className="inlinefold"><summary>{tr("rs.groupFold")}</summary>
                <form onSubmit={async (e) => {
                  e.preventDefault(); const f = gform(st.id);
                  if (await post({ kind: "group", stageId: st.id, ...f })) setNg({ ...ng, [st.id]: undefined });
                }}>
                  <div className="grid2">
                    <div className="field"><label htmlFor={`g-seq-${st.id}`}>{tr("rs.priority")}</label><input id={`g-seq-${st.id}`} type="number" min={1} dir="ltr" required
                      value={gform(st.id).seq} onChange={(e) => setNg({ ...ng, [st.id]: { ...gform(st.id), seq: e.target.value } })} /></div>
                    <div className="field"><label htmlFor={`g-name-${st.id}`}>{tr("rs.groupName")}</label><input id={`g-name-${st.id}`} required
                      value={gform(st.id).name} onChange={(e) => setNg({ ...ng, [st.id]: { ...gform(st.id), name: e.target.value } })} /></div>
                    <div className="field"><label htmlFor={`g-title-${st.id}`}>{tr("rs.groupTitle")}</label><input id={`g-title-${st.id}`}
                      value={gform(st.id).title} onChange={(e) => setNg({ ...ng, [st.id]: { ...gform(st.id), title: e.target.value } })} /></div>
                    <div className="field"><label htmlFor={`g-desc-${st.id}`}>{tr("rs.desc")}</label><input id={`g-desc-${st.id}`}
                      value={gform(st.id).description} onChange={(e) => setNg({ ...ng, [st.id]: { ...gform(st.id), description: e.target.value } })} /></div>
                  </div>
                  <button className="btn" type="submit">{tr("rs.saveGroup")}</button>
                </form>
              </details>
            </div>
          ))}
          <Fold title={tr("rs.stageFold")}>
            <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "stage", reportTypeId: type.id, ...ns })) setNs({ seq: "", name: "" }); }}>
              <div className="grid2">
                <div className="field"><label htmlFor="st-seq">{tr("rs.stageSeq")}</label><input id="st-seq" type="number" min={1} dir="ltr" required value={ns.seq} onChange={(e) => setNs({ ...ns, seq: e.target.value })} /></div>
                <div className="field"><label htmlFor="st-name">{tr("rs.stageName")}</label><input id="st-name" required value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} /></div>
              </div>
              <button className="btn" type="submit">{tr("rs.saveStage")}</button>
            </form>
          </Fold>
          <p className="muted sm">{tr("rs.priorityNote")}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Each stage's one final approver and their deputy, and the colour the
 * stage's changes are shown in. With an approver named, only they or the
 * deputy approve the stage; the deputy's signature shows «از طرف».
 */
function StageApprover({ st, users, post }) {
  const signers = [...new Map(st.groups.flatMap((g) => g.members.filter((m) => m.permissions.includes("sign")).map((m) => [m.userId, m.name]))).entries()];
  const [f, setF] = useState({ approverId: st.approverId || "", deputyId: st.deputyId || "", color: st.changeColor || "#c0392b" });
  const { t } = usePrefs();
  return (
    <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap", marginBottom: 8 }}>
      <div className="field"><label htmlFor={`ap-${st.id}`}>{t("rs.approver")}</label>
        <select id={`ap-${st.id}`} value={f.approverId} onChange={(e) => setF({ ...f, approverId: e.target.value })}>
          <option value="">{t("rs.anyApprover")}</option>{signers.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></div>
      <div className="field"><label htmlFor={`dp-${st.id}`}>{t("rs.deputy")}</label>
        <select id={`dp-${st.id}`} value={f.deputyId} disabled={!f.approverId} onChange={(e) => setF({ ...f, deputyId: e.target.value })}>
          <option value="">—</option>{signers.filter(([id]) => id !== f.approverId).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></div>
      <button className="btn ghost sm" type="button" onClick={() => post({ kind: "approver", stageId: st.id, approverId: f.approverId || null, deputyId: (f.approverId && f.deputyId) || null })}>{t("rs.saveApprover")}</button>
      <div className="field"><label htmlFor={`cl-${st.id}`}>{t("rs.color")}</label>
        <input id={`cl-${st.id}`} type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></div>
      <button className="btn ghost sm" type="button" onClick={() => post({ kind: "stage-color", stageId: st.id, color: f.color })}>{t("rs.saveColor")}</button>
      {signers.length === 0 && <span className="sm muted">{t("rs.approverRule")}</span>}
    </div>
  );
}
