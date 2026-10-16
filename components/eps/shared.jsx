"use client";
import { useEffect, useState } from "react";
import { useProjectData } from "../../lib/client/platform.mjs";
import { fmt, day, statusOf } from "./ActivityDetail";

/** What the activity pages share: the columns the grid offers, and the version the page opens. */
export const COLUMNS = [
  { key: "code", title: "Activity / WBS No.", width: 190, mono: true, hits: true, get: (r) => r.item.code },
  { key: "name", title: "نام (Task name)", width: 230, hits: true, get: (r) => r.item.name },
  { key: "wf", title: "W.F ٪", width: 70, mono: true, get: (r) => (r.item.wf == null ? "" : fmt(r.item.wf, 4)) },
  { key: "wv", title: "W.V ٪", width: 80, mono: true, get: (r) => (r.item.wv == null ? "" : fmt(r.item.wv, 5)) },
  { key: "unit", title: "واحد", width: 55, get: (r) => r.item.unit || "" },
  { key: "volPlan", title: "حجم برنامه", width: 85, mono: true, get: (r) => fmt(r.kind === "act" ? r.item.volumePlan : r.item.volume_plan) },
  { key: "volActual", title: "حجم واقعی", width: 85, mono: true, get: (r) => fmt(r.kind === "act" ? r.item.volumeActual : r.item.volume_actual) },
  { key: "done", title: "انجام‌شده", width: 85, mono: true, get: (r) => (r.kind === "act" ? fmt(r.item.done) : "") },
  { key: "pct", title: "پیشرفت ٪", width: 75, mono: true, get: (r) => (r.item.pct == null ? (r.kind === "act" ? "؟" : "") : fmt(r.item.pct)) },
  { key: "remain", title: "باقیمانده", width: 85, mono: true, get: (r) => (r.kind === "act" ? fmt(r.item.remain) : "") },
  { key: "status", title: "وضعیت", width: 80, get: (r) => (r.kind === "act" ? statusOf(r.item) : "") },
  { key: "start", title: "شروع", width: 90, mono: true, get: (r) => day(r.item.plan_start) },
  { key: "finish", title: "پایان", width: 90, mono: true, get: (r) => day(r.item.plan_end) },
  { key: "dur", title: "مدت", width: 55, mono: true, get: (r) => fmt(r.item.planDays) },
  { key: "aStart", title: "شروع واقعی", width: 90, mono: true, get: (r) => day(r.item.actual_start) },
  { key: "aFinish", title: "پایان واقعی", width: 90, mono: true, get: (r) => day(r.item.actual_end) },
  { key: "budget", title: "بودجهٔ برنامه", width: 110, mono: true, get: (r) => fmt(r.item.budgetPlan) },
  { key: "budgetA", title: "بودجهٔ واقعی", width: 110, mono: true, get: (r) => fmt(r.item.budgetActual) },
  { key: "float", title: "Free float", width: 70, mono: true, get: (r) => (r.kind === "act" ? fmt(r.item.freeFloat) : "") },
  { key: "tpl", title: "کد الگو", width: 90, mono: true, get: (r) => r.item.template_code || "" },
  { key: "src", title: "منبع پیشرفت", width: 120, get: (r) => (r.kind !== "act" ? "" : r.item.scope ? `${r.item.scope_removed ? "✗ " : "⛓ "}${{ equipment: "تجهیزات", piping: "پایپینگ", electrical: "برق", instrumentation: "ابزار دقیق", civil: "سیویل", structural: "سازه" }[r.item.scope.discipline] || "پلتفرم"}` : "گزارش روزانه") },
  { key: "manual", title: "پیشرفت دستی", width: 80, mono: true, get: (r) => (r.kind === "act" ? fmt(r.item.progress) : "") },
];

/** The version the page opens: ?version=…, else the master plan, else the first. */
export function useVersion(contractId) {
  const [versionId, setVersionId] = useState(null);
  useEffect(() => { const v = new URLSearchParams(window.location.search).get("version"); if (v) setVersionId(v); }, []);
  const board = useProjectData((id) => (contractId ? `/api/eps?projectId=${id}&contractId=${contractId}` : null), [contractId]);
  const versions = (board.data?.pms || []).flatMap((p) => p.versions.map((v) => ({ ...v, pmsCode: p.code })));
  useEffect(() => {
    if (!versions.length) return;
    if (!versionId || !versions.some((v) => v.id === versionId)) setVersionId((versions.find((v) => v.master) || versions[0]).id);
  }, [versions.length, contractId]); // eslint-disable-line react-hooks/exhaustive-deps
  const picker = (
    <select aria-label="نسخه" value={versionId || ""} onChange={(e) => setVersionId(e.target.value)}>
      {versions.length === 0 && <option value="">— نسخه‌ای نیست —</option>}
      {versions.map((v) => <option key={v.id} value={v.id}>{v.pmsCode} › {v.code} — {v.title}{v.master ? " (Master)" : ""}</option>)}</select>);
  return { versionId, picker, versions };
}

