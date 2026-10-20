"use client";
import { useProjectData } from "../../lib/client/platform.mjs";
import TableKit from "../../components/ui/TableKit";
import Tabs from "../../components/ui/Tabs";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * Quality control: what has been welded and not yet examined.
 *
 * The handover gap is the list, because it is the one that decides whether a
 * system can be handed over. A weld that is welded and never examined is an
 * ITR that will be missing from the dossier, and it is discovered at MC
 * unless something surfaces it now.
 */
export default function QcPage() {
  const { data, error } = useProjectData((id) => `/api/reports/dashboard?projectId=${id}`, []);
  const { t, num } = usePrefs();
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;

  const gap = data.handoverGap || data.gap || [];
  const welders = data.welders || data.welderPerformance || [];

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{t("pi.qc.title")}</h1>
        <span className="sub">{t("pi.qc.sub")}</span>
      </div>

      <Tabs name="qc">
      <div className="card" data-tab="gap" data-tab-title={t("pi.qc.tab")} data-badge={gap.length} data-tone="warn">
        <h2>{t("pi.qc.gap", { n: gap.length })}</h2>
        <p className="muted sm">{t("pi.qc.gapNote")}</p>
        {gap.length === 0 ? (
          <p className="empty-note">{t("pi.qc.noGap")}</p>
        ) : (
          <TableKit name="qc-1">
            <table className="dtable">
              <thead><tr><th>{t("pi.weld")}</th><th>{t("pi.line")}</th><th>{t("pi.location")}</th><th>{t("pi.qc.ndtReq")}</th><th>{t("pi.welder")}</th></tr></thead>
              <tbody>
                {gap.slice(0, 200).map((g, i) => (
                  <tr key={g.weld_uid || i}>
                    <td className="mono">{g.weld_uid ? <a href={`/piping/joint?uid=${encodeURIComponent(g.weld_uid)}`}>{g.weld_no}</a> : g.weld_no}</td>
                    <td className="mono">{g.line_no || "—"}</td>
                    <td>{g.shop_field === "Shop" ? t("pi.shop") : t("pi.field")}</td>
                    <td className="mono">{g.ndt_requirement || "—"}</td>
                    <td className="mono">{g.stamp_no || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
      </div>

      {welders.length > 0 && (
        <div className="card">
          <h2>{t("pi.qc.repair")}</h2>
          <p className="muted sm">{t("pi.qc.repairNote")}</p>
          <TableKit name="qc-2">
            <table className="dtable">
              <thead><tr><th>{t("pi.stamp")}</th><th>{t("pu.v.name")}</th><th>{t("pi.process")}</th><th>{t("pi.welds")}</th>
                         <th>{t("pi.qc.shots")}</th><th>{t("pi.qc.rejects")}</th><th>{t("pi.repairRate")}</th></tr></thead>
              <tbody>
                {welders.map((w, i) => (
                  <tr key={w.welder_key || i}>
                    <td className="mono">{w.stamp_no}</td>
                    <td>{w.welder_name}</td>
                    <td className="mono sm">{w.processes || "—"}</td>
                    <td className="mono">{w.welds_made}</td>
                    <td className="mono">{w.shots}</td>
                    <td className="mono">{w.rejects}</td>
                    <td className="mono">
                      {w.repair_rate_pct == null ? "—" : `${num(w.repair_rate_pct)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableKit>
        </div>
      )}
      </Tabs>
    </div>
  );
}
