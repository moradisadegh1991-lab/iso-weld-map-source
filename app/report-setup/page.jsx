"use client";
import { useMemo, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import Fold from "../../components/ui/Fold";
import TreeEditor from "../../components/ui/TreeEditor";
import TableKit from "../../components/ui/TableKit";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * Workflow setup (owner's requirements of 2026-10-18, items 1–3):
 *
 *   forms        each report type and the workflow it follows
 *   duties       a post with the access it carries, and who holds it now
 *   the tree     workflows in folders; a node with stages is a workflow
 *   a workflow   its stages in order, the review groups of each in priority
 *                order, the people named in a group and the duties placed in
 *                it — each with its rights, days to review, the pages it
 *                reaches and the tree rows it may change — and its pages
 *
 * What the rights allow is decided by lib/reports/workflow.mjs; this page
 * only says who holds them. A form's designer sees only the workflows their
 * forms follow; the forms, the duties and the tree are the project manager's.
 */
const blankDuty = { id: null, code: "", name: "", description: "", permissions: ["view"] };

export default function ReportSetupPage() {
  const { projectId, call } = usePlatform();
  const { t: tr, L } = usePrefs();
  const { data, error, reload } = useProjectData((id) => `/api/report-setup?projectId=${id}&trees=1`, []);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  // a form's designer arrives from the forms page with ?type=ID: its workflow opens
  const [typeId] = useState(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("type")) || null);
  const [wfId, setWfId] = useState(null);
  const [nt, setNt] = useState({ code: "", name: "", description: "" });
  const [nw, setNw] = useState({ name: "", code: "", parentId: "" });
  const [nd, setNd] = useState(blankDuty);

  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/report-setup", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); if (done) setOk(done); return r || true; }
    catch (e) { setMsg(e.message); return null; }
  }
  const perm = (k) => L(`report.perm.${k}`, data.permissions[k]);
  const tree = useMemo(() => {
    if (!data) return [];
    const by = new Map(data.workflows.map((w) => [w.id, { ...w, children: [] }]));
    const roots = [];
    for (const w of by.values()) (w.parentId && by.has(w.parentId) ? by.get(w.parentId).children : roots).push(w);
    return roots;
  }, [data]);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{tr("common.loading")}</p>;
  const may = data.may || {};
  const fromType = data.types.find((x) => x.id === typeId)?.workflow_id;
  const wf = data.workflows.find((w) => w.id === (wfId || fromType)) || data.workflows.find((w) => w.stages > 0) || null;

  return (
    <div className="page">
      <div className="pagehead"><h1>{tr("rs.title")}</h1>
        <span className="sub">{tr("rs.sub2", { forms: data.types.length, flows: data.workflows.filter((w) => w.stages).length, duties: data.duties.length })}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}

      <div className="card">
        <h2>{tr("rs.forms")}</h2>
        {data.types.length === 0 ? <p className="empty-note">{tr("rs.noTypes")}</p> : (
          <TableKit name="report-setup-forms"><table className="dtable">
            <thead><tr><th>{tr("rs.code")}</th><th>{tr("rs.name")}</th><th>{tr("rs.workflow")}</th><th>{tr("rs.reportsN")}</th></tr></thead>
            <tbody>{data.types.map((x) => (
              <tr key={x.id} data-form={x.code}>
                <td className="mono">{x.code}</td><td>{x.name}</td>
                <td>{may.types ? (
                  <select aria-label={tr("rs.workflowOf", { name: x.name })} value={x.workflow_id || ""} disabled={x.reports > 0}
                    title={x.reports > 0 ? tr("rs.attachLocked") : undefined}
                    onChange={(e) => post({ kind: "attach", reportTypeId: x.id, workflowId: e.target.value || null }, tr("rs.attached"))}>
                    <option value="">{tr("rs.noWorkflow")}</option>
                    {data.workflows.filter((w) => w.stages > 0).map((w) => <option key={w.id} value={w.id}>{w.code ? `${w.code} — ` : ""}{w.name}</option>)}</select>
                ) : (x.workflow_name || tr("rs.noWorkflow"))}
                  {x.workflow_id && <button className="btn ghost sm" type="button" style={{ marginInlineStart: 6 }} onClick={() => setWfId(x.workflow_id)}>{tr("rs.open")}</button>}</td>
                <td className="mono">{x.reports}</td>
              </tr>))}</tbody></table></TableKit>)}
        {may.types && <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!data.types.some((x) => x.code === "DR") && (
              <button className="btn" type="button" onClick={() => post({ kind: "template" })}>{tr("rs.template")}</button>)}
          </div>
          <Fold title={tr("rs.defineType")}>
            <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "type", ...nt })) setNt({ code: "", name: "", description: "" }); }}>
              <div className="grid2">
                <div className="field"><label htmlFor="rt-code">{tr("rs.code")}</label><input id="rt-code" dir="ltr" required value={nt.code} onChange={(e) => setNt({ ...nt, code: e.target.value })} /></div>
                <div className="field"><label htmlFor="rt-name">{tr("rs.name")}</label><input id="rt-name" required value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} /></div>
                <div className="field"><label htmlFor="rt-desc">{tr("rs.desc")}</label><input id="rt-desc" value={nt.description} onChange={(e) => setNt({ ...nt, description: e.target.value })} /></div>
              </div>
              <button className="btn" type="submit">{tr("rs.saveType")}</button>
            </form>
          </Fold></>}
        {!may.types && <p className="sm muted">{tr("rs.formsOnly")}</p>}
      </div>

      {may.duties && (
        <div className="card" data-duties>
          <h2>{tr("rs.duties")}</h2>
          <p className="sm muted">{tr("rs.dutiesNote")}</p>
          {data.duties.length === 0 ? <p className="empty-note">{tr("rs.noDuties")}</p> : (
            <TableKit name="report-setup-duties"
              onDelete={(id) => post({ kind: "duty-remove", id })}
              rowEdit={{
                fields: [{ col: tr("rs.code"), name: "code", type: "text" }, { col: tr("rs.duty"), name: "name", type: "text" }],
                value: (id) => { const d = data.duties.find((x) => x.id === id); return { code: d?.code || "", name: d?.name || "" }; },
                onSave: (id, v) => { const d = data.duties.find((x) => x.id === id); return post({ kind: "duty", id, code: v.code, name: v.name, description: d.description, permissions: d.permissions }, tr("rs.dutySaved")); },
                onAdd: (v) => post({ kind: "duty", code: v.code, name: v.name, permissions: ["view"] }, tr("rs.dutySaved")),
              }}><table className="dtable">
              <thead><tr><th>{tr("rs.code")}</th><th>{tr("rs.duty")}</th><th>{tr("rs.h.rights")}</th><th>{tr("rs.holders")}</th><th>{tr("rs.usedIn")}</th><th /></tr></thead>
              <tbody>{data.duties.map((d) => (
                <tr key={d.id} data-key={d.id} data-duty={d.code || d.name}>
                  <td className="mono">{d.code || "—"}</td><td>{d.name}</td>
                  <td className="sm">{d.permissions.map(perm).join(tr("c.sep"))}</td>
                  <td><Holders duty={d} users={data.users} post={post} /></td>
                  <td className="sm">{d.usedIn.join(" · ") || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn ghost sm" type="button" onClick={() => setNd({ id: d.id, code: d.code || "", name: d.name, description: d.description || "", permissions: d.permissions })}>{tr("dr.edit")}</button>
                    <button className="btn ghost sm" type="button" onClick={() => post({ kind: "duty-remove", id: d.id })}>{tr("dr.remove")}</button></td>
                </tr>))}</tbody></table></TableKit>)}
          <Fold title={nd.id ? tr("rs.editDuty", { name: nd.name }) : tr("rs.newDuty")} open={nd.id ? true : undefined} onClose={() => setNd(blankDuty)}>
            <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "duty", ...nd }, tr("rs.dutySaved"))) setNd(blankDuty); }}>
              <div className="grid2">
                <div className="field"><label htmlFor="du-name">{tr("rs.duty")}</label><input id="du-name" required value={nd.name} onChange={(e) => setNd({ ...nd, name: e.target.value })} /></div>
                <div className="field"><label htmlFor="du-code">{tr("rs.code")}</label><input id="du-code" dir="ltr" value={nd.code} onChange={(e) => setNd({ ...nd, code: e.target.value })} /></div>
                <div className="field"><label htmlFor="du-desc">{tr("rs.desc")}</label><input id="du-desc" value={nd.description} onChange={(e) => setNd({ ...nd, description: e.target.value })} /></div>
              </div>
              <Rights value={nd.permissions} on={(p) => setNd({ ...nd, permissions: p })} data={data} perm={perm} tr={tr} label={tr("rs.dutyRights")} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn" type="submit">{tr("rs.saveDuty")}</button>
                {nd.id && <button className="btn ghost" type="button" onClick={() => setNd(blankDuty)}>{tr("common.cancel")}</button>}</div>
            </form>
          </Fold>
        </div>)}

      <div className="card" data-workflow-tree>
        <h2>{tr("rs.tree")}</h2>
        <p className="sm muted">{tr("rs.treeNote")}</p>
        <TreeEditor nodes={tree} editable={!!may.tree} label={tr("rs.workflow")}
          onMove={(id, parentId) => { const w = data.workflows.find((x) => x.id === id); post({ kind: "workflow", id, parentId, name: w.name, code: w.code, description: w.description, seq: w.seq }); }}
          render={(n) => (
            <button type="button" className={`linkbtn${wf?.id === n.id ? " on" : ""}`} data-wf={n.code || n.name} onClick={() => setWfId(n.id)}
              style={{ fontWeight: wf?.id === n.id ? 700 : 400 }}>
              {n.code && <span className="mono sm">{n.code} </span>}{n.name}
              <span className="sm muted"> {n.stages ? tr("rs.nodeStages", { n: n.stages }) : tr("rs.folder")}{n.forms.length ? ` · ${n.forms.map((f) => f.code).join(tr("c.sep"))}` : ""}</span>
            </button>)}
          actions={may.tree ? (n) => <button className="btn ghost sm" type="button" onClick={() => post({ kind: "workflow-remove", id: n.id })}>{tr("dr.remove")}</button> : null} />
        {may.tree && (
          <Fold title={tr("rs.newNode")}>
            <form onSubmit={async (e) => { e.preventDefault(); const r = await post({ kind: "workflow", ...nw, parentId: nw.parentId || null }); if (r?.row) { setWfId(r.row.id); setNw({ name: "", code: "", parentId: "" }); } }}>
              <div className="grid2">
                <div className="field"><label htmlFor="wf-name">{tr("rs.name")}</label><input id="wf-name" required value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} /></div>
                <div className="field"><label htmlFor="wf-code">{tr("rs.code")}</label><input id="wf-code" dir="ltr" value={nw.code} onChange={(e) => setNw({ ...nw, code: e.target.value })} /></div>
                <div className="field"><label htmlFor="wf-parent">{tr("rs.parent")}</label>
                  <select id="wf-parent" value={nw.parentId} onChange={(e) => setNw({ ...nw, parentId: e.target.value })}>
                    <option value="">{tr("rs.root")}</option>{data.workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
              </div>
              <button className="btn" type="submit">{tr("rs.saveNode")}</button>
            </form>
          </Fold>)}
      </div>

      {wf && <Workflow key={wf.id} wf={wf} data={data} post={post} perm={perm} tr={tr} />}
    </div>
  );
}

/** Who holds a duty: a checklist of the project's people, saved as a whole. */
function Holders({ duty, users, post }) {
  const { t: tr } = usePrefs();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(duty.members.map((m) => m.userId));
  return (
    <div>
      <span className="sm">{duty.members.map((m) => m.name).join(tr("c.sep")) || "—"}</span>{" "}
      <button className="btn ghost sm" type="button" onClick={() => { setPick(duty.members.map((m) => m.userId)); setOpen(!open); }}>{tr("rs.holdersEdit")}</button>
      {open && (
        <div className="permgrid" role="group" aria-label={tr("rs.holdersOf", { name: duty.name })} style={{ marginTop: 6 }}>
          {users.filter((u) => u.active).map((u) => (
            <label key={u.id}><input type="checkbox" checked={pick.includes(u.id)} onChange={(e) => setPick(e.target.checked ? [...pick, u.id] : pick.filter((x) => x !== u.id))} /> {u.name}</label>))}
          <button className="btn sm" type="button" onClick={async () => { if (await post({ kind: "duty-members", dutyId: duty.id, userIds: pick, name: duty.name })) setOpen(false); }}>{tr("rs.saveHolders")}</button>
        </div>)}
    </div>
  );
}

function Rights({ value, on, data, perm, tr, label }) {
  return (
    <div className="permgrid" role="group" aria-label={label}>
      {Object.keys(data.permissions).map((k) => (
        <label key={k} title={tr(`rs.help.${k}`)}><input type="checkbox" checked={value.includes(k)}
          onChange={(e) => on(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} /> {perm(k)}</label>))}
    </div>
  );
}

/** The parts of the forms that follow a workflow, for its pages: every kind's, when no form follows it yet. */
function sectionsOf(wf, data) {
  const kinds = wf.forms.map((f) => (data.sections[f.code] ? f.code : "form"));
  const use = kinds.length ? [...new Set(kinds)] : Object.keys(data.sections);
  return Object.assign({}, ...use.map((k) => data.sections[k]));
}

function Workflow({ wf, data, post, perm, tr }) {
  const { L } = usePrefs();
  const [ns, setNs] = useState({ seq: "", name: "" });
  const [ng, setNg] = useState({});        // per stage: { seq, name, title, description }
  const [nm, setNm] = useState({});        // per group: { userId, permissions[] }
  const [np, setNp] = useState({ pageNo: "", name: "", sections: [] });
  const gform = (sid) => ng[sid] || { seq: "", name: "", title: "", description: "" };
  const mform = (gid) => nm[gid] || { userId: "", permissions: ["view"] };
  const reports = wf.forms.reduce((s, f) => s + f.reports, 0);
  const sections = sectionsOf(wf, data);
  const secName = (k) => L(`report.part.${k}`, sections[k] || k);
  const name = (uid) => data.users.find((u) => u.id === uid)?.name || "—";
  return (
    <>
      <div className="card" data-workflow={wf.code || wf.name}>
        <h2>{tr("rs.stagesOf", { name: wf.name })}</h2>
        <p className="sm muted">{wf.forms.length ? tr("rs.followedBy", { forms: wf.forms.map((f) => `${f.code} ${f.name}`).join(tr("c.sep")) }) : tr("rs.followedByNone")}</p>
        {reports > 0 && <p className="muted sm">{tr("rs.hasReports", { n: reports })}</p>}
        {wf.stageList.length === 0 && <p className="empty-note">{tr("rs.noStages")}</p>}
        {wf.stageList.map((st) => (
          <div className="stagebox" key={st.id}>
            <h3>{tr("rs.stage", { seq: st.seq, name: st.name })}
              {reports === 0 && <button className="btn ghost sm" type="button" style={{ marginInlineStart: 8 }}
                onClick={() => post({ kind: "stage-remove", stageId: st.id })}>{tr("rs.removeStage")}</button>}</h3>
            <StageApprover st={st} post={post} />
            {st.groups.length === 0 && <p className="muted sm">{tr("rs.noGroups")}</p>}
            {st.groups.map((g) => (
              <div className="groupbox" key={g.id}>
                <b>{g.seq}. {g.name}</b>{g.title && <span className="muted sm"> — {g.title}</span>}
                {g.description && <div className="muted sm">{g.description}</div>}
                <TableKit name="report-setup-1"><table className="dtable" style={{ marginTop: 6 }}>
                  <thead><tr><th>{tr("rs.h.member")}</th><th>{tr("rs.via")}</th><th>{tr("rs.h.rights")}</th><th /></tr></thead>
                  <tbody>
                    {g.members.length === 0 && <tr><td colSpan={4} className="muted sm">{tr("rs.noMembers")}</td></tr>}
                    {g.members.map((m) => (
                      <tr key={m.userId}>
                        <td>{m.name || name(m.userId)}</td>
                        <td className="sm">{(m.via || []).join(tr("c.sep")) || tr("rs.direct")}</td>
                        <td className="sm">{m.permissions.map(perm).join(tr("c.sep"))}</td>
                        <td>{!(m.via || []).length && <button className="btn ghost sm" type="button" onClick={() => post({ kind: "member-remove", groupId: g.id, userId: m.userId })}>{tr("rs.removeMember")}</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></TableKit>
                <GroupDuties g={g} wf={wf} data={data} post={post} perm={perm} tr={tr} secName={secName} />
                <details className="inlinefold"><summary>{tr("rs.memberFold")}</summary>
                  <form onSubmit={async (e) => {
                    e.preventDefault(); const f = mform(g.id);
                    if (await post({ kind: "member", groupId: g.id, userId: f.userId, permissions: f.permissions })) setNm({ ...nm, [g.id]: undefined });
                  }}>
                    <div className="field"><label htmlFor={`gm-u-${g.id}`}>{tr("rs.user")}</label>
                      <select id={`gm-u-${g.id}`} required value={mform(g.id).userId} onChange={(e) => {
                        const have = g.members.find((m) => m.userId === e.target.value && !(m.via || []).length);
                        setNm({ ...nm, [g.id]: { userId: e.target.value, permissions: have ? have.permissions : mform(g.id).permissions } });
                      }}>
                        <option value="">—</option>
                        {data.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}{u.email && u.email !== u.name ? ` (${u.email})` : ""}</option>)}
                      </select></div>
                    <Rights value={mform(g.id).permissions} on={(p) => setNm({ ...nm, [g.id]: { ...mform(g.id), permissions: p } })} data={data} perm={perm} tr={tr} label={tr("rs.h.rights")} />
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
          <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "stage", workflowId: wf.id, ...ns })) setNs({ seq: "", name: "" }); }}>
            <div className="grid2">
              <div className="field"><label htmlFor="st-seq">{tr("rs.stageSeq")}</label><input id="st-seq" type="number" min={1} dir="ltr" required value={ns.seq} onChange={(e) => setNs({ ...ns, seq: e.target.value })} /></div>
              <div className="field"><label htmlFor="st-name">{tr("rs.stageName")}</label><input id="st-name" required value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} /></div>
            </div>
            <button className="btn" type="submit">{tr("rs.saveStage")}</button>
          </form>
        </Fold>
        <p className="muted sm">{tr("rs.priorityNote")}</p>
      </div>

      <div className="card" data-pages>
        <h2>{tr("rs.pagesOf", { name: wf.name })}</h2>
        <p className="sm muted">{tr("rs.pagesNote")}</p>
        {wf.pages.length === 0 ? <p className="empty-note">{tr("rs.noPages")}</p> : (
          <TableKit name="report-setup-pages"
            onDelete={(id) => post({ kind: "page-remove", id, workflowId: wf.id })}
            rowEdit={{
              fields: [{ col: tr("rs.pageNo"), name: "pageNo", type: "number" }, { col: tr("rs.name"), name: "name", type: "text" }],
              value: (id) => { const p = wf.pages.find((x) => x.id === id); return { pageNo: String(p?.pageNo ?? ""), name: p?.name || "" }; },
              onSave: (id, v) => { const p = wf.pages.find((x) => x.id === id); return post({ kind: "page", workflowId: wf.id, id, pageNo: Number(v.pageNo), name: v.name, sections: p.sections }); },
            }}><table className="dtable">
            <thead><tr><th>{tr("rs.pageNo")}</th><th>{tr("rs.name")}</th><th>{tr("rs.parts")}</th><th /></tr></thead>
            <tbody>{wf.pages.map((p) => (
              <tr key={p.id} data-key={p.id} data-page={p.pageNo}><td className="mono">{p.pageNo}</td><td>{p.name}</td>
                <td className="sm">{p.sections.length ? p.sections.map(secName).join(tr("c.sep")) : tr("rs.allParts")}</td>
                <td><button className="btn ghost sm" type="button" onClick={() => setNp({ id: p.id, pageNo: p.pageNo, name: p.name, sections: p.sections })}>{tr("dr.edit")}</button>
                  <button className="btn ghost sm" type="button" onClick={() => post({ kind: "page-remove", id: p.id, workflowId: wf.id })}>{tr("dr.remove")}</button></td></tr>))}</tbody>
          </table></TableKit>)}
        <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "page", workflowId: wf.id, ...np, pageNo: Number(np.pageNo) })) setNp({ pageNo: "", name: "", sections: [] }); }}>
          <div className="grid2">
            <div className="field"><label htmlFor="pg-no">{tr("rs.pageNo")}</label><input id="pg-no" type="number" min={1} dir="ltr" required value={np.pageNo} onChange={(e) => setNp({ ...np, pageNo: e.target.value })} /></div>
            <div className="field"><label htmlFor="pg-name">{tr("rs.name")}</label><input id="pg-name" required value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} /></div>
          </div>
          <div className="permgrid" role="group" aria-label={tr("rs.parts")}>
            {Object.keys(sections).map((k) => (
              <label key={k}><input type="checkbox" checked={np.sections.includes(k)}
                onChange={(e) => setNp({ ...np, sections: e.target.checked ? [...np.sections, k] : np.sections.filter((x) => x !== k) })} /> {secName(k)}</label>))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn" type="submit">{np.id ? tr("rs.savePage") : tr("rs.addPage")}</button>
            {np.id && <button className="btn ghost" type="button" onClick={() => setNp({ pageNo: "", name: "", sections: [] })}>{tr("common.cancel")}</button>}</div>
        </form>
      </div>
    </>
  );
}

/** The duties placed in a group, and the form that places one: its rights, days to review, pages and tree rows. */
function GroupDuties({ g, wf, data, post, perm, tr, secName }) {
  const fresh = { dutyId: "", permissions: [], reviewDays: "", pages: [], scope: [] };
  const [f, setF] = useState(fresh);
  const [open, setOpen] = useState(false);
  const duty = data.duties.find((d) => d.id === f.dutyId);
  const edit = (d) => { setF({ dutyId: d.dutyId, permissions: d.permissions, reviewDays: d.reviewDays || "", pages: d.pages, scope: d.scope }); setOpen(true); };
  return (
    <div style={{ marginTop: 6 }} data-group-duties={g.name}>
      {g.duties.length > 0 && (
        <TableKit name="report-setup-gduties"><table className="dtable">
          <thead><tr><th>{tr("rs.duty")}</th><th>{tr("rs.holders")}</th><th>{tr("rs.h.rights")}</th><th>{tr("rs.reviewDays")}</th><th>{tr("rs.pages")}</th><th>{tr("rs.rows")}</th><th /></tr></thead>
          <tbody>{g.duties.map((d) => (
            <tr key={d.id}>
              <td>{d.name}</td><td className="sm">{d.holders.join(tr("c.sep")) || "—"}</td>
              <td className="sm">{d.permissions.map(perm).join(tr("c.sep"))}</td>
              <td className="mono">{d.reviewDays || "—"}</td>
              <td className="sm">{d.pages.length ? d.pages.map((id) => wf.pages.find((p) => p.id === id)?.pageNo).join(tr("c.sep")) : tr("rs.allPages")}</td>
              <td className="sm">{d.scope.length ? tr("rs.rowsN", { n: d.scope.length }) : tr("rs.allRows")}</td>
              <td style={{ whiteSpace: "nowrap" }}><button className="btn ghost sm" type="button" onClick={() => edit(d)}>{tr("dr.edit")}</button>
                <button className="btn ghost sm" type="button" onClick={() => post({ kind: "group-duty-remove", groupId: g.id, dutyId: d.dutyId })}>{tr("dr.remove")}</button></td>
            </tr>))}</tbody></table></TableKit>)}
      <details className="inlinefold" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}><summary>{tr("rs.dutyFold")}</summary>
        {data.duties.length === 0 ? <p className="sm muted">{tr("rs.noDutiesYet")}</p> : (
          <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "group-duty", groupId: g.id, ...f, permissions: f.permissions.length ? f.permissions : null })) { setF(fresh); setOpen(false); } }}>
            <div className="grid2">
              <div className="field"><label htmlFor={`gd-d-${g.id}`}>{tr("rs.duty")}</label>
                <select id={`gd-d-${g.id}`} required value={f.dutyId} onChange={(e) => { const d = data.duties.find((x) => x.id === e.target.value); setF({ ...f, dutyId: e.target.value, permissions: d ? d.permissions : [] }); }}>
                  <option value="">—</option>{data.duties.map((d) => <option key={d.id} value={d.id}>{d.name}{d.members.length ? ` (${d.members.map((m) => m.name).join(tr("c.sep"))})` : ""}</option>)}</select></div>
              <div className="field"><label htmlFor={`gd-r-${g.id}`}>{tr("rs.reviewDays")}</label>
                <input id={`gd-r-${g.id}`} type="number" min={1} dir="ltr" value={f.reviewDays} onChange={(e) => setF({ ...f, reviewDays: e.target.value })} /></div>
            </div>
            {duty && <Rights value={f.permissions} on={(p) => setF({ ...f, permissions: p })} data={data} perm={perm} tr={tr} label={tr("rs.h.rights")} />}
            <div className="permgrid" role="group" aria-label={tr("rs.pages")} style={{ marginTop: 6 }}>
              <span className="sm muted">{tr("rs.pages")}:</span>
              {wf.pages.length === 0 && <span className="sm muted">{tr("rs.allPages")}</span>}
              {wf.pages.map((p) => (
                <label key={p.id}><input type="checkbox" checked={f.pages.includes(p.id)}
                  onChange={(e) => setF({ ...f, pages: e.target.checked ? [...f.pages, p.id] : f.pages.filter((x) => x !== p.id) })} /> {p.pageNo}. {p.name}</label>))}
            </div>
            <ScopePicker value={f.scope} on={(s) => setF({ ...f, scope: s })} trees={data.scope} tr={tr} />
            <button className="btn" type="submit" style={{ marginTop: 8 }}>{tr("rs.saveGroupDuty")}</button>
          </form>)}
      </details>
    </div>
  );
}

/**
 * The tree rows a duty may change: the contracts' narrative branches,
 * resource categories and resources, work groups and the master plans' WBS.
 * Ticking a row takes everything under it; none ticked → every row.
 */
function ScopePicker({ value, on, trees, tr }) {
  const [q, setQ] = useState("");
  if (!trees) return null;
  const kinds = [["narrative", "rs.tree.narrative"], ["resource", "rs.tree.resource"], ["work_group", "rs.tree.workGroup"], ["wbs", "rs.tree.wbs"]];
  const rowsOf = (list) => {
    const kids = new Map();
    for (const n of list) (kids.get(n.parentId || null) || kids.set(n.parentId || null, []).get(n.parentId || null)).push(n);
    const out = [];
    const walk = (pid, depth) => { for (const n of kids.get(pid) || []) { out.push({ ...n, depth }); walk(n.id, depth + 1); } };
    walk(null, 0);
    return out;
  };
  const toggle = (id, on2) => on(on2 ? [...new Set([...value, id])] : value.filter((x) => x !== id));
  return (
    <details className="inlinefold" style={{ marginTop: 6 }}><summary>{tr("rs.rows")}: {value.length ? tr("rs.rowsN", { n: value.length }) : tr("rs.allRows")}</summary>
      <input type="search" aria-label={tr("rs.rowsFind")} placeholder={tr("rs.rowsFind")} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", marginBottom: 6 }} />
      <div style={{ maxHeight: 280, overflow: "auto" }}>
        {kinds.map(([k, label]) => {
          const rows = rowsOf(trees[k] || []).filter((n) => !q || n.name.includes(q) || (n.group || "").includes(q));
          if (!rows.length) return null;
          return (
            <div key={k} data-scope-tree={k}><b className="sm">{tr(label)}</b>
              {rows.map((n) => (
                <label key={n.id} style={{ display: "block", paddingInlineStart: 8 + n.depth * 16 }} className="sm">
                  <input type="checkbox" checked={value.includes(n.id)} onChange={(e) => toggle(n.id, e.target.checked)} /> {n.name}
                  {n.depth === 0 && n.group && <span className="muted mono"> {n.group}</span>}</label>))}
            </div>);
        })}
      </div>
    </details>
  );
}

/**
 * Each stage's one final approver and their deputy, and the colour the
 * stage's changes are shown in. With an approver named, only they or the
 * deputy approve the stage; the deputy's signature shows «از طرف».
 */
function StageApprover({ st, post }) {
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
