"use client";
import { useEffect, useState } from "react";
import { useProjectData } from "../../lib/client/platform.mjs";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * What the activity pages share: the columns the grid offers, and the version
 * the page opens. A column's title is a translation key (ActivityGrid shows
 * `t(title)`); `get(row, x)` gets the page's formatters `x` = { fmt, day,
 * statusOf, t } so its value is written in the reader's language.
 */
const SRC = { equipment: "ep.src.equipment", piping: "ep.src.piping", electrical: "ep.src.electrical", instrumentation: "ep.src.instrumentation", civil: "ep.src.civil", structural: "ep.src.structural" };
export const COLUMNS = [
  { key: "code", title: "Activity / WBS No.", width: 190, mono: true, hits: true, get: (r) => r.item.code },
  { key: "name", title: "ep.col.name", width: 230, hits: true, get: (r) => r.item.name },
  { key: "actType", title: "Type", width: 110, get: (r) => (r.kind === "act" ? r.item.act_type || "" : "") },
  { key: "activityNo", title: "Activity ID", width: 95, mono: true, hits: true, get: (r) => (r.kind === "act" ? r.item.activity_no || "" : "") },
  { key: "wfRate", title: "WF rate", width: 95, mono: true, get: (r, x) => (r.kind === "act" && r.item.wf_rate != null ? x.fmt(Number(r.item.wf_rate), 10) : "") },
  { key: "description", title: "ep.description", width: 200, hits: true, get: (r) => r.item.description || "" },
  { key: "wf", title: "W.F %", width: 70, mono: true, get: (r, x) => (r.item.wf == null ? "" : x.fmt(r.item.wf, 4)) },
  { key: "wv", title: "W.V %", width: 80, mono: true, get: (r, x) => (r.item.wv == null ? "" : x.fmt(r.item.wv, 5)) },
  { key: "unit", title: "ep.unit", width: 55, get: (r) => r.item.unit || "" },
  { key: "volPlan", title: "ep.col.volPlan", width: 85, mono: true, get: (r, x) => x.fmt(r.kind === "act" ? r.item.volumePlan : r.item.volume_plan) },
  { key: "volActual", title: "ep.col.volActual", width: 85, mono: true, get: (r, x) => x.fmt(r.kind === "act" ? r.item.volumeActual : r.item.volume_actual) },
  { key: "done", title: "ep.done", width: 85, mono: true, get: (r, x) => (r.kind === "act" ? x.fmt(r.item.done) : "") },
  { key: "pct", title: "ep.col.pct", width: 75, mono: true, get: (r, x) => (r.item.pct == null ? (r.kind === "act" ? "?" : "") : x.fmt(r.item.pct)) },
  { key: "remain", title: "ep.remain", width: 85, mono: true, get: (r, x) => (r.kind === "act" ? x.fmt(r.item.remain) : "") },
  { key: "status", title: "ep.status", width: 80, get: (r, x) => (r.kind === "act" ? x.statusOf(r.item) : "") },
  { key: "start", title: "ep.start", width: 90, mono: true, get: (r, x) => x.day(r.item.plan_start) },
  { key: "finish", title: "ep.finish", width: 90, mono: true, get: (r, x) => x.day(r.item.plan_end) },
  { key: "dur", title: "ep.dur", width: 55, mono: true, get: (r, x) => x.fmt(r.item.planDays) },
  { key: "aStart", title: "ep.actualStart", width: 90, mono: true, get: (r, x) => x.day(r.item.actual_start) },
  { key: "aFinish", title: "ep.actualEnd", width: 90, mono: true, get: (r, x) => x.day(r.item.actual_end) },
  { key: "budget", title: "ep.col.budgetPlan", width: 110, mono: true, get: (r, x) => x.fmt(r.item.budgetPlan) },
  { key: "budgetA", title: "ep.col.budgetActual", width: 110, mono: true, get: (r, x) => x.fmt(r.item.budgetActual) },
  { key: "float", title: "Free float", width: 70, mono: true, get: (r, x) => (r.kind === "act" ? x.fmt(r.item.freeFloat) : "") },
  { key: "tpl", title: "ep.col.template", width: 90, mono: true, get: (r) => r.item.template_code || "" },
  { key: "src", title: "ep.col.source", width: 120, get: (r, x) => (r.kind !== "act" ? "" : r.item.scope
    ? `${r.item.scope_removed ? "✗ " : "⛓ "}${x.t(SRC[r.item.scope.discipline] || "ep.src.platform")}` : x.t("ep.src.reports")) },
  { key: "manual", title: "ep.manualPct", width: 80, mono: true, get: (r, x) => (r.kind === "act" ? x.fmt(r.item.progress) : "") },
];

/**
 * The PMS and the version the page opens (owner's requirements 2026-10-22):
 * the PMS list holds only the contract's PMSs and comes first; the WBS is
 * the PMS's, and the version — by default its master plan — decides the
 * dates and planned quantities read over it. ?version=… or ?pms=… open one.
 * `plan` is the query the activity routes take (versionId=… or pmsId=…).
 * With `{ version: false }` only the PMS is picked (the WBS page).
 */
export function useVersion(contractId, { version: withVersion = true } = {}) {
  const { t } = usePrefs();
  const [pmsId, setPmsId] = useState(null);
  const [versionId, setVersionId] = useState(null);
  const [asked, setAsked] = useState(null);
  useEffect(() => { const q = new URLSearchParams(window.location.search); setAsked({ version: q.get("version"), pms: q.get("pms") }); }, []);
  const board = useProjectData((id) => (contractId ? `/api/eps?projectId=${id}&contractId=${contractId}` : null), [contractId]);
  const pmsList = board.data?.pms || [];
  const versions = pmsList.flatMap((p) => p.versions.map((v) => ({ ...v, pmsCode: p.code })));
  const pick = (p, v = undefined) => {
    setPmsId(p?.id || null);
    const mine = p ? p.versions : [];
    setVersionId(v !== undefined ? v : withVersion ? (mine.find((x) => x.master) || mine[0])?.id || null : null);
  };
  useEffect(() => {
    if (!asked || !pmsList.length) return;
    if (pmsId && pmsList.some((p) => p.id === pmsId)) return;
    const byVersion = asked.version && pmsList.find((p) => p.versions.some((v) => v.id === asked.version));
    if (byVersion) return pick(byVersion, withVersion ? asked.version : null);
    pick(pmsList.find((p) => p.id === asked.pms) || pmsList.find((p) => p.versions.some((v) => v.master)) || pmsList[0]);
  }, [asked, pmsList.length, contractId]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = pmsList.find((p) => p.id === pmsId);
  const picker = (
    <span className="row" style={{ gap: 4, display: "inline-flex" }} data-plan-picker>
      <select aria-label="PMS" value={pmsId || ""} onChange={(e) => pick(pmsList.find((p) => p.id === e.target.value))} data-pick="pms">
        {pmsList.length === 0 && <option value="">{t("ep.noVersion")}</option>}
        {pmsList.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.title}</option>)}</select>
      {withVersion && <select aria-label={t("ep.version")} value={versionId || ""} onChange={(e) => setVersionId(e.target.value || null)} data-pick="version">
        <option value="">{t("ep.pl.noVersion")}</option>
        {(cur?.versions || []).map((v) => <option key={v.id} value={v.id}>{v.code} — {v.title}{v.master ? " (Master)" : ""}</option>)}</select>}
    </span>);
  const plan = versionId ? `versionId=${versionId}` : pmsId ? `pmsId=${pmsId}` : null;
  return { pmsId, versionId, plan, picker, versions, pms: cur || null, reloadBoard: board.reload };
}
