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

/** The version the page opens: ?version=…, else the master plan, else the first. */
export function useVersion(contractId) {
  const { t } = usePrefs();
  const [versionId, setVersionId] = useState(null);
  useEffect(() => { const v = new URLSearchParams(window.location.search).get("version"); if (v) setVersionId(v); }, []);
  const board = useProjectData((id) => (contractId ? `/api/eps?projectId=${id}&contractId=${contractId}` : null), [contractId]);
  const versions = (board.data?.pms || []).flatMap((p) => p.versions.map((v) => ({ ...v, pmsCode: p.code })));
  useEffect(() => {
    if (!versions.length) return;
    if (!versionId || !versions.some((v) => v.id === versionId)) setVersionId((versions.find((v) => v.master) || versions[0]).id);
  }, [versions.length, contractId]); // eslint-disable-line react-hooks/exhaustive-deps
  const picker = (
    <select aria-label={t("ep.version")} value={versionId || ""} onChange={(e) => setVersionId(e.target.value)}>
      {versions.length === 0 && <option value="">{t("ep.noVersion")}</option>}
      {versions.map((v) => <option key={v.id} value={v.id}>{v.pmsCode} › {v.code} — {v.title}{v.master ? " (Master)" : ""}</option>)}</select>);
  return { versionId, picker, versions };
}

