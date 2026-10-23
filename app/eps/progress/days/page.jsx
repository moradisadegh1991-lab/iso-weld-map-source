"use client";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../../../lib/client/platform.mjs";
import ActivityGrid from "../../../../components/eps/ActivityGrid";
import { useEpsFmt } from "../../../../components/eps/ActivityDetail";
import { COLUMNS, useVersion } from "../../../../components/eps/shared";
import { usePrefs } from "../../../../lib/client/prefs.mjs";

/**
 * Several days side by side (owner's «PMS» document, last page): the days
 * are picked from a list like Excel's filter (search, select all, clear);
 * only the activities with work, or planned work, on one of them are shown,
 * under their WBS nodes.
 *
 * Columns (owner's requirements 2026-10-18, item 6; the figures are
 * lib/eps/activities.mjs `periodColumns`): fifteen of what was planned and
 * done before, to date and in the chosen days — quantity and percentage —
 * with SPI (done ÷ planned) and VAR (planned − done); then for each chosen
 * day two columns, P what the plan puts on it and AC what was recorded.
 */
// [key, heading, what it is] — the headings are the owner's own abbreviations
const PERIOD_COLS = [
  ["LWP", "L.W.P", "pd.LWP"], ["LWA", "L.W.A", "pd.LWA"], ["TWP", "T.W.P", "pd.TWP"], ["TWA", "T.W.A", "pd.TWA"],
  ["LPP", "L.P.P%", "pd.LPP"], ["LPA", "L.P.A%", "pd.LPA"], ["TPP", "T.P.P%", "pd.TPP"], ["TPA", "T.P.A%", "pd.TPA"],
  ["TSPI", "T.SPI%", "pd.TSPI"], ["VAR", "VAR%", "pd.VAR"], ["CPP", "C.P.P%", "pd.CPP"], ["CPA", "C.P.A%", "pd.CPA"],
  ["CWP", "C.W.P", "pd.CWP"], ["CWA", "C.W.A", "pd.CWA"], ["CSPI", "C.SPI%", "pd.CSPI"],
];
export default function DaysPage() {
  const { contractId } = usePlatform();
  const { pmsId, versionId, plan, picker } = useVersion(contractId);
  const [days, setDays] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(new Set());
  const [find, setFind] = useState("");
  const { data, error } = useProjectData((id) => (plan ? `/api/eps/activities?projectId=${id}&${plan}&days=${days.join(",")}` : null), [plan, days.join(",")]);
  const [sel, setSel] = useState(null);
  const { t } = usePrefs();
  const { day } = useEpsFmt();
  // the activities with work on a chosen day, or with work planned on one
  const keep = useCallback((a) => !!data?.matrix?.[a.id] || (data?.period?.[a.id]?.CWP || 0) > 0, [data]);
  const columns = useMemo(() => {
    const base = COLUMNS.filter((c) => ["code", "name", "unit", "volActual"].includes(c.key));
    const P = data?.period || {};
    const period = PERIOD_COLS.map(([k, title, tip]) => ({ key: `p:${k}`, title, tip: t(tip), width: 74, mono: true,
      get: (r, x) => { const v = P[r.id]?.[k]; return v === undefined ? "" : x.fmt(v); } }));
    const per = (data?.days || []).flatMap((d) => [
      { key: `d:${d}:p`, title: `${day(d)} P`, tip: t("pd.P"), width: 84, mono: true, get: (r, x) => (r.kind === "act" ? x.fmt(P[r.id]?.byDay?.[d]?.p) : "") },
      { key: `d:${d}:ac`, title: `${day(d)} AC`, tip: t("pd.AC"), width: 84, mono: true, get: (r, x) => (r.kind === "act" ? x.fmt(P[r.id]?.byDay?.[d]?.ac) : "") }]);
    return [...base, ...period, ...per];
  }, [data, t, day]);
  const head = (
    <div className="pagehead"><h1>{t("ep.days.title")}</h1>
      <span className="sub">{picker} <Link href="/eps/progress">{t("ep.link.entry")}</Link> · <Link href="/eps/activities">{t("ep.link.activities")}</Link></span></div>);
  if (!contractId) return <div className="page"><div className="pagehead"><h1>{t("ep.days.title")}</h1></div><p className="empty-note">{t("cs.pick")}</p></div>;
  if (error) return <div className="page">{head}<p className="err">{error}</p></div>;
  if (!plan) return <div className="page">{head}<p className="empty-note">{t("ep.noPlan")}</p></div>;
  if (!data) return <div className="page">{head}<p className="muted">{t("common.loading")}</p></div>;
  const all = data.allDays || [];
  const shown = all.filter((d) => !find || d.includes(find) || day(d).includes(find));
  const picker2 = (
    <span style={{ position: "relative" }}>
      <button type="button" className="btn sm" data-days-filter onClick={() => { setDraft(new Set(days)); setOpen(!open); }} aria-expanded={open}>{t("ep.days.days", { n: days.length })} ▾</button>
      {open && (
        <div className="p6-days-pick card" role="dialog" aria-label={t("ep.days.pick")}>
          <input type="search" placeholder={t("ep.days.find")} aria-label={t("ep.days.find")} value={find} onChange={(e) => setFind(e.target.value)} style={{ width: "100%" }} />
          <label style={{ display: "block", borderBottom: "1px solid var(--rule)", padding: "4px 0" }}>
            <input type="checkbox" checked={shown.length > 0 && shown.every((d) => draft.has(d))} onChange={(e) => { const n = new Set(draft); shown.forEach((d) => (e.target.checked ? n.add(d) : n.delete(d))); setDraft(n); }} /> {t("ep.days.all")}</label>
          {shown.map((d) => (
            <label key={d} style={{ display: "block" }} data-day={d}><input type="checkbox" checked={draft.has(d)} onChange={() => { const n = new Set(draft); n.has(d) ? n.delete(d) : n.add(d); setDraft(n); }} /> {day(d)} <span className="sm muted mono">{d}</span></label>))}
          {all.length === 0 && <p className="sm muted">{t("ep.days.none")}</p>}
          <p className="row" style={{ gap: 6, marginTop: 6 }}>
            <button type="button" className="btn sm" onClick={() => { setDays([...draft].sort()); setOpen(false); }}>{t("ep.ok")}</button>
            <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>{t("ep.cancel")}</button></p>
        </div>)}
    </span>);
  return (
    <div className="page">
      {head}
      {days.length === 0 && <p className="sm muted">{t("ep.days.hint")}</p>}
      <div style={{ height: "calc(100vh - 200px)", minHeight: 360 }}>
        <ActivityGrid data={data} columns={columns} defaultCols={columns.map((c) => c.key)} storeKey="p6-days" persist={false} gantt={false}
          keep={keep} selected={sel} onSelect={(r) => setSel(r.id)} toolbar={picker2} />
      </div>
    </div>
  );
}
