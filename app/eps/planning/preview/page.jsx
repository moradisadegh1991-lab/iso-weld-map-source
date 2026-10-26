"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../../../lib/client/platform.mjs";
import ActivityGrid, { useSplit } from "../../../../components/eps/ActivityGrid";
import ActivityDetail from "../../../../components/eps/ActivityDetail";
import { Requirements, Comments, Status } from "../../../../components/eps/PlanningSubforms";
import { COLUMNS, PLAN_COST_COLUMNS, useVersion } from "../../../../components/eps/shared";
import { usePrefs } from "../../../../lib/client/prefs.mjs";

/**
 * The planning preview (owner's requirements 2026-10-22, items 13–28): the
 * tree of the activities a version plans — only those, under the nodes that
 * hold them — laid out like the activities page. Only the planning figures
 * are edited here, in the activity's own row: start, days, finish, done
 * before, planned and description. Below, the selected activity's
 * sub-forms: its detail (image 1), requirements (image 2), resources,
 * planning detail — every version that plans it (image 3) — relationships
 * (image 4), comments and follow-up (image 5), status with its holds
 * (image 6), the daily report history (image 7, read only) and documents.
 */
const TABS = ["detail", "requirements", "roles", "groups", "relations", "comments", "status", "reports", "docs"];

/** The tree cut down to the activities the version plans, and the nodes above them. */
function plannedOnly(roots) {
  const cut = (n) => {
    const children = n.children.map(cut).filter(Boolean);
    const activities = n.activities.filter((a) => a.plan);
    return children.length || activities.length ? { ...n, children, activities } : null;
  };
  return roots.map(cut).filter(Boolean);
}

export default function PlanningPreviewPage() {
  const { projectId, contractId, call } = usePlatform();
  const { t } = usePrefs();
  const { pmsId, versionId, picker } = useVersion(contractId);
  const tree = useProjectData((id) => (versionId ? `/api/eps/activities?projectId=${id}&versionId=${versionId}` : null), [versionId]);
  const [sel, setSel] = useState(null);
  const detail = useProjectData((id) => (sel?.kind === "act" && versionId ? `/api/eps/activities?projectId=${id}&activityId=${sel.id}&versionId=${versionId}` : null), [sel?.id, versionId]);
  const sub = useProjectData((id) => (sel?.kind === "act" && versionId ? `/api/eps/planning?projectId=${id}&versionId=${versionId}&activityId=${sel.id}` : null), [sel?.id, versionId]);
  const [tab, setTab] = useState("detail");
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const { height, grip } = useSplit("p6-plan-preview", 380);
  const data = useMemo(() => (tree.data ? { ...tree.data, roots: plannedOnly(tree.data.roots) } : null), [tree.data]);
  const acts = useMemo(() => { const out = []; const walk = (n) => { out.push(...n.activities); n.children.forEach(walk); }; (tree.data?.roots || []).forEach(walk); return out; }, [tree.data]);
  useEffect(() => { setSel(null); }, [versionId]);

  // the loaders of this render: a save from a row the grid kept open must reload the activity selected now, not the one of its render
  const live = useRef({});
  live.current = { tree, detail, sub };
  async function send(url, body, done) {
    setMsg(null); setOk(null);
    try {
      const r = await call(url, { method: "POST", body: JSON.stringify({ projectId, pmsId, versionId, ...body }) });
      for (const x of Object.values(live.current)) x.reload();
      if (done) setOk(done(r)); return r;
    }
    catch (e) { setMsg(e.message); return null; }
  }
  // the sub-forms of the activity page send (url, body, done); the preview's own send (body, done) to the planning route
  const post = (url, body, done) => send(url, body, done);
  const postPlan = (body, done) => send("/api/eps/planning", body, done);

  const columns = useMemo(() => [...COLUMNS,
    { key: "pStart", title: t("ep.pl.start"), width: 95, mono: true, get: (r, x) => (r.item.plan ? x.day(r.item.plan.start_on) : "") },
    { key: "pDays", title: t("ep.pl.days"), width: 60, mono: true, get: (r, x) => (r.item.plan ? x.fmt(r.item.plan.days) : "") },
    { key: "pFinish", title: t("ep.pl.finish"), width: 95, mono: true, get: (r, x) => (r.item.plan ? x.day(r.item.plan.end_on) : "") },
    { key: "pBefore", title: t("ep.pl.doneBefore"), width: 90, mono: true, get: (r, x) => (r.item.plan ? x.fmt(r.item.plan.done_before, 10) : "") },
    { key: "pPlanned", title: t("ep.pl.planned"), width: 95, mono: true, get: (r, x) => (r.item.plan ? x.fmt(r.item.plan.volume_plan, 10) : "") },
    { key: "pDesc", title: t("ep.pl.planDesc"), width: 180, get: (r) => r.item.plan?.description || "" },
    // the version's cost and float (item 4): six typed, the two percentages worked out
    ...PLAN_COST_COLUMNS,
  ], [t]);
  // only the planning figures are edited here, in the activity's own row
  const ops = useMemo(() => {
    if (!tree.data?.may?.edit) return null;
    return {
      fields: (row) => (row.kind === "act" ? [{ key: "pStart", type: "date" }, { key: "pDays", type: "number" }, { key: "pFinish", type: "date" },
        { key: "pBefore", type: "number" }, { key: "pPlanned", type: "number" }, { key: "pDesc", type: "text" },
        ...PLAN_COST_COLUMNS.filter((c) => !c.field.derived).map((c) => ({ key: c.key, type: "number" }))] : []),
      value: (row) => { const p = row.item.plan; return { pStart: p.start_on || "", pDays: p.days ?? "", pFinish: p.end_on || "", pBefore: p.done_before ?? "", pPlanned: p.volume_plan ?? "", pDesc: p.description || "",
        ...Object.fromEntries(PLAN_COST_COLUMNS.map((c) => [c.key, p[c.field.col] ?? ""])) }; },
      save: async (row, v) => {
        const p = row.item.plan;
        const endChanged = (v.pFinish || "") !== (p.end_on || "");
        const byDays = !endChanged && String(v.pDays).trim() !== "" && (String(v.pDays) !== String(p.days ?? "") || (v.pStart || "") !== (p.start_on || ""));
        return !!(await postPlan({ kind: "plan-edit", id: p.id, startOn: v.pStart, endOn: byDays ? undefined : v.pFinish, days: byDays ? v.pDays : undefined,
          doneBefore: v.pBefore, volumePlan: v.pPlanned, description: v.pDesc,
          ...Object.fromEntries(PLAN_COST_COLUMNS.filter((c) => !c.field.derived).map((c) => [c.field.key, v[c.key]])) }, () => t("ep.pl.saved", { code: row.item.code })));
      },
    };
  }, [tree.data?.may?.edit, versionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const head = (
    <div className="pagehead"><h1>{t("ep.pv.title")}</h1>
      <span className="sub">{picker} <Link href={versionId ? `/eps/planning?version=${versionId}` : "/eps/planning"}>{t("ep.link.planning")}</Link> · <Link href="/eps/activities">{t("ep.link.activities")}</Link></span></div>);
  if (!contractId) return <div className="page"><div className="pagehead"><h1>{t("ep.pv.title")}</h1></div><p className="empty-note">{t("cs.pick")}</p></div>;
  if (tree.error) return <div className="page">{head}<p className="err">{tree.error}</p></div>;
  if (!pmsId) return <div className="page">{head}<p className="empty-note">{t("ep.noPlan")}</p></div>;
  if (!versionId) return <div className="page">{head}<p className="empty-note">{t("ep.pl.pickVersion")}</p></div>;
  if (!data) return <div className="page">{head}<p className="muted">{t("common.loading")}</p></div>;
  const may = data.may.edit;
  const a = detail.data?.activity;
  const body = () => {
    if (sel?.kind !== "act") return <p className="empty-note">{t("ep.pickActivity")}</p>;
    if (detail.error || sub.error) return <p className="err">{detail.error || sub.error}</p>;
    if (!detail.data || !sub.data) return <p className="muted">{t("common.loading")}</p>;
    if (tab === "requirements") return <Requirements p={sub.data} a={a} acts={acts} may={sub.data.may.edit} post={postPlan} />;
    if (tab === "comments") return <Comments p={sub.data} a={a} may={sub.data.may.edit} post={postPlan} />;
    if (tab === "status") return <Status p={sub.data} a={a} />;
    return <ActivityDetail d={detail.data} tab={tab} may={may} post={post} acts={acts} labels={data.labels} codes={data.codes} resources={data.resources}
      companies={data.companies} projectId={projectId} history={tab === "reports"} planCosts />;
  };
  return (
    <div className="page">
      {head}
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg toast" role="status">{ok}</p>}
      {data.roots.length === 0 ? <p className="empty-note">{t("ep.pl.empty")}</p> : (
        <div style={{ height }}>
          <ActivityGrid data={data} columns={columns} defaultCols={["code", "activityNo", "name", "unit", "volActual", "done", "pct", "pStart", "pDays", "pFinish", "pBefore", "pPlanned", "pDesc", ...PLAN_COST_COLUMNS.map((c) => c.key)]}
            storeKey="p6-plan-preview" selected={sel?.id} onSelect={(r) => setSel(r)} ops={ops} />
        </div>)}
      {grip}
      <div className="p6-detail" data-preview-tabs>
        <div className="p6-tabs" role="tablist">{TABS.map((k) => <button key={k} type="button" role="tab" data-tab={k} aria-selected={tab === k} className={tab === k ? "on" : undefined}
          onClick={() => setTab(k)}>{t(`ep.pv.tab.${k}`)}</button>)}</div>
        {body()}
      </div>
    </div>
  );
}
