"use client";
import { usePrefs } from "../../lib/client/prefs.mjs";
import { useEpsFmt } from "./ActivityDetail";

/** The bottom panel shows only the selected activity's history, not all
 * planning rows. Derived quantities are read-only and computed server-side.
 */
export default function PlanningActivityHistory({ data, selected, loading, error }) {
  const { t } = usePrefs();
  const { fmt, day } = useEpsFmt();
  if (!selected || selected.kind !== "act") {
    return <p className="empty-note" data-plan-history-empty>{t("ep.historySelect")}</p>;
  }
  if (error) return <p className="err" role="alert">{error}</p>;
  if (loading || !data) return <p className="muted">{t("common.loading")}</p>;
  const fields = [
    ["versionCode", t("ep.historyVersionCode")],
    ["versionTitle", t("ep.historyVersionTitle")],
    ["versionDescription", t("ep.historyVersionDescription")],
    ["plannedStart", t("ep.historyPlannedStart"), "date"],
    ["plannedEnd", t("ep.historyPlannedEnd"), "date"],
    ["plannedDays", t("ep.historyPlannedDays")],
    ["actualStart", t("ep.historyActualStart"), "date"],
    ["actualEnd", t("ep.historyActualEnd"), "date"],
    ["actualDays", t("ep.historyActualDays")],
    ["plannedVolume", t("ep.historyPlannedVolume")],
    ["actualVolume", t("ep.historyActualVolume")],
    ["doneBefore", t("ep.historyDoneBefore")],
    ["doneToDate", t("ep.historyDoneToDate")],
    ["doneThisPeriod", t("ep.historyDoneThisPeriod")],
    ["remainingVolume", t("ep.historyRemaining")],
    ["progressPct", t("ep.historyProgress"), "percent"],
    ["periodProgressPct", t("ep.historyPeriodProgress"), "percent"],
    ["remark", t("ep.historyRemark")],
    ["status", t("ep.historyStatus")],
  ];
  const display = (row, key, kind) => {
    const v = row[key];
    if (v == null || v === "") return "—";
    if (kind === "date") return day(v);
    if (kind === "percent") return fmt(v, 2);
    if (typeof v === "number") return fmt(v, 10);
    if (key === "status") return ({ completed: t("ep.historyCompleted"), in_progress: t("ep.historyInProgress"), not_started: t("ep.historyNotStarted") })[v] || v;
    return String(v);
  };
  return <section data-plan-history>
    <p className="sm muted">{t("ep.historyCaption")} <strong dir="ltr">{data.activity?.code || selected.item?.code}</strong> — {data.activity?.name || selected.item?.name || ""}
      {" · "}{t("ep.historyReadOnly")}</p>
    <p className="sm muted">{t("ep.historyLiveActuals")}</p>
    {!data.rows?.length ? <p className="empty-note">{t("ep.historyEmpty")}</p> :
      <div className="tablewrap" style={{ overflowX: "auto" }}>
        <table className="dtable" data-plan-history-table>
          <thead><tr>{fields.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
          <tbody>{data.rows.map((row) => <tr key={row.id} data-key={row.id}
            style={{ background: row.current ? "var(--cy-soft)" : undefined }}>
            {fields.map(([key, , kind]) => <td key={key} className={kind === "date" || kind === "percent" || typeof row[key] === "number" ? "mono" : undefined}>
              {display(row, key, kind)}</td>)}
          </tr>)}</tbody>
        </table>
      </div>}
    <p className="sm muted">{t("ep.historyFormula")}</p>
  </section>;
}
