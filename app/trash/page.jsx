"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { usePrefs } from "../../lib/client/prefs.mjs";
import TableKit from "../../components/ui/TableKit";

/**
 * The project's trash: what was deleted from a register (app/api/records)
 * stays here for 30 days — with the rows it owned — and can be put back
 * where it was, or let go of now. Restoring needs what deleting it needed;
 * the rules are lib/db/repos/trash.mjs.
 */
export default function TrashPage() {
  const { projectId, call } = usePlatform();
  const { t, dateTime, date } = usePrefs();
  const { data, error, reload } = useProjectData((id) => `/api/trash?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  async function act(kind, item) {
    const label = item.label || t("tr.noLabel");
    if (!window.confirm(t(kind === "restore" ? "tr.restoreAsk" : "tr.purgeAsk", { label }))) return;
    setMsg(null); setOk(null);
    try {
      await call("/api/trash", { method: "POST", body: JSON.stringify({ projectId, kind, id: item.id }) });
      await reload();
      setOk(t(kind === "restore" ? "tr.restored" : "tr.purged"));
    } catch (e) { setMsg(e.message); }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  return (
    <div className="page">
      <div className="pagehead"><h1>{t("tr.title")}</h1><span className="sub">{t("tr.sub", { days: data.days })}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg toast" role="status">{ok}</p>}
      <div className="card">
        {data.items.length === 0 ? <p className="empty-note">{t("tr.empty")}</p> : (
          <TableKit name="trash"><table className="dtable" data-trash>
            <thead><tr><th>{t("tr.kind")}</th><th>{t("tr.label")}</th><th>{t("tr.owned")}</th><th>{t("tr.by")}</th><th>{t("tr.at")}</th><th>{t("tr.expires")}</th><th /></tr></thead>
            <tbody>{data.items.map((x) => (
              <tr key={x.id} data-key={x.id} data-trash-item={x.label || x.record_id}>
                <td>{t(`tr.e.${x.entity}`)}</td><td>{x.label || t("tr.noLabel")}</td>
                <td className="sm">{x.owned_rows ? t("tr.ownedN", { n: x.owned_rows }) : "—"}</td>
                <td>{x.deleted_by_name || "—"}</td><td className="mono sm">{dateTime(x.deleted_at)}</td><td className="mono sm">{date(x.expires_at)}</td>
                <td className="row" style={{ gap: 6 }}>{x.mayRestore && <>
                  <button className="btn sm" type="button" data-restore onClick={() => act("restore", x)}>{t("tr.restore")}</button>
                  <button className="btn ghost sm" type="button" data-purge onClick={() => act("purge", x)}>{t("tr.purge")}</button></>}</td>
              </tr>))}</tbody></table></TableKit>)}
      </div>
    </div>
  );
}
