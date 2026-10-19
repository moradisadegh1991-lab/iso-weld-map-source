"use client";
import Link from "next/link";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { useVersion } from "../../../components/eps/shared";
import { useScopeL, Pending } from "../../../components/eps/ScopePanel";
import { useEpsFmt } from "../../../components/eps/ActivityDetail";
import { usePrefs } from "../../../lib/client/prefs.mjs";

import TableKit from "../../../components/ui/TableKit";
/**
 * The PMS against the platform's records, for one version: every link
 * (activity or WBS node ↔ equipment, welds, cables, instruments, foundations,
 * structures) with what changed since it was applied, and the items the
 * platform holds that no activity covers yet — what a new drawing, P&ID or
 * register brought into the project and the PMS does not plan.
 */
const NO_LABELS = { disciplines: {}, measures: {} };

export default function ScopePage() {
  const { projectId, contractId, call } = usePlatform();
  const { versionId, picker } = useVersion(contractId);
  const { t } = usePrefs();
  const { fmt } = useEpsFmt();
  const v = useProjectData((id) => (versionId ? `/api/eps/activities?projectId=${id}&versionId=${versionId}` : null), [versionId]);
  const u = useProjectData((id) => (versionId ? `/api/eps/activities?projectId=${id}&versionId=${versionId}&unplanned=1` : null), [versionId]);
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const S = useScopeL(v.data?.labels?.scope || NO_LABELS);
  async function apply(ruleId) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/eps/activities", { method: "POST", body: JSON.stringify({ projectId, kind: "scope-apply", ruleId }) });
      setOk(t(r.row.made ? "ep.sp.appliedMade" : "ep.sc.applied", { added: r.row.added, removed: r.row.removed, made: r.row.made })); v.reload(); u.reload(); }
    catch (e) { setMsg(e.message); }
  }
  // the link alone (its activity stays, as planned), or the linked activity with it
  async function remove(rule, withActivity, asked = false) {
    if (!asked && !confirm(t(withActivity ? "ep.sp.askActivity" : "ep.sp.askLink"))) return false;
    setMsg(null); setOk(null);
    try {
      await call(withActivity ? "/api/eps" : "/api/eps/activities", { method: "POST", body: JSON.stringify(withActivity
        ? { projectId, kind: "activity-remove", id: rule.activity_id } : { projectId, kind: "scope-rule-remove", id: rule.id }) });
      setOk(t(withActivity ? "ep.sp.activityRemoved" : "ep.sc.linkRemoved")); v.reload(); u.reload(); return true;
    } catch (e) { setMsg(e.message); return false; }
  }
  const head = (
    <div className="pagehead"><h1>{t("ep.sp.title")}</h1>
      <span className="sub">{picker} <Link href="/eps/activities">{t("ep.link.activities")}</Link></span></div>);
  if (!contractId) return <div className="page"><div className="pagehead"><h1>{t("ep.sp.title")}</h1></div><p className="empty-note">{t("cs.pick")}</p></div>;
  if (v.error || u.error) return <div className="page">{head}<p className="err">{v.error || u.error}</p></div>;
  if (!v.data || !u.data) return <div className="page">{head}<p className="muted">{t("common.loading")}</p></div>;
  const where = (r) => {
    const find = (ns) => { for (const n of ns) { if (n.id === r.node_id) return n; const a = n.activities.find((x) => x.id === r.activity_id); if (a) return a; const c = find(n.children); if (c) return c; } return null; };
    return find(v.data.roots);
  };
  return (
    <div className="page">
      {head}
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      <div className="card">
        <h2>{t("ep.sp.links")}</h2>
        {v.data.scope.length === 0 ? <p className="empty-note">{t("ep.sp.none")}</p> : (
          <TableKit name="eps-scope-1" canDelete={() => v.data.may.edit || t("ep.sp.noRight")} deleteLabel={t("ep.sc.unlink")}
            onDelete={async (id) => { const s = v.data.scope.find((x) => x.rule.id === id); return s ? remove(s.rule, false, true) : false; }}><table className="dtable"><thead><tr><th>{t("ep.sp.target")}</th><th>{t("ep.type")}</th><th>{t("ep.sp.scope")}</th><th>{t("ep.sp.items")}</th><th>{t("ep.volume")}</th><th>{t("ep.progress")}</th><th>{t("ep.sp.pending")}</th><th /></tr></thead>
            <tbody>{v.data.scope.map((s) => {
              const w = where(s.rule);
              return (
                <tr key={s.rule.id} data-key={s.rule.id} data-rule={w?.code}><td><span className="mono" dir="ltr">{w?.code}</span> {w?.name}</td>
                  <td className="sm">{t(s.rule.mode === "per_item" ? "ep.sp.perItem" : "ep.sp.one")}{s.rule.auto_apply ? ` · ${t("ep.sp.auto")}` : ""}</td>
                  <td className="sm">{S.describe(s.rule, v.data.scopeChoices)}</td><td className="mono">{fmt(s.summary.items)}</td>
                  <td className="mono">{fmt(s.summary.qty)} {s.summary.unknown ? <span className="sm" style={{ color: "var(--warn)" }}>{t("ep.sp.unknownN", { n: s.summary.unknown })}</span> : ""}</td>
                  <td className="mono">{s.summary.pct == null ? "—" : `${fmt(s.summary.pct)}%`}</td>
                  <td><Pending pending={s.pending} firstApply={s.firstApply} /></td>
                  <td style={{ whiteSpace: "nowrap" }}>{v.data.may.edit && (s.pending.any || s.firstApply) && <button className="btn sm" type="button" onClick={() => apply(s.rule.id)}>{t("ep.sp.apply")}</button>}
                    {v.data.may.edit && <button className="btn ghost sm" type="button" data-unlink onClick={() => remove(s.rule, false)}>{t("ep.sc.unlink")}</button>}
                    {v.data.may.edit && s.rule.activity_id && <button className="btn danger sm" type="button" data-remove-activity onClick={() => remove(s.rule, true)}>{t("ep.sp.removeActivity")}</button>}</td></tr>);
            })}</tbody></table></TableKit>)}
      </div>
      <div className="card">
        <h2>{t("ep.sp.unplanned")}</h2>
        <p className="sm muted">{t("ep.sp.unplannedNote")}</p>
        <TableKit name="eps-scope-2"><table className="dtable"><thead><tr><th>{t("ep.sc.discipline")}</th><th>{t("ep.sp.total")}</th><th>{t("ep.sp.inPms")}</th><th>{t("ep.sp.outPms")}</th><th /></tr></thead>
          <tbody>{Object.entries(u.data.unplanned).map(([d, x]) => (
            <tr key={d} data-unplanned={d}><td>{S.disc(d)}</td><td className="mono">{fmt(x.total)}</td><td className="mono">{fmt(x.covered)}</td>
              <td className="mono" style={{ color: x.total - x.covered ? "var(--warn)" : undefined }}><b>{fmt(x.total - x.covered)}</b></td>
              <td>{x.items.length > 0 && <button className="btn ghost sm" type="button" onClick={() => setOpen(open === d ? null : d)}>{t(open === d ? "ep.close" : "ep.sp.list")}</button>}</td></tr>))}</tbody></table></TableKit>
        {open && (
          <div className="tablewrap" style={{ maxHeight: 360, marginTop: 8 }}><TableKit name="eps-scope-3"><table className="dtable">
            <thead><tr><th>{t("ep.sc.item")}</th><th>{t("ep.description")}</th><th>{t("ep.sc.subsystemH")}</th><th>{t("ep.type")}</th>{open === "piping" && <th>{t("ep.sp.line")}</th>}</tr></thead>
            <tbody>{u.data.unplanned[open].items.map((i) => <tr key={i.key}><td className="mono" dir="ltr">{i.label}</td><td className="sm">{i.name || ""}</td><td className="mono sm">{i.subsystem || "—"}</td>
              <td className="sm">{i.kind || "—"}</td>{open === "piping" && <td className="mono">{i.group || "—"}</td>}</tr>)}</tbody></table></TableKit>
            {u.data.unplanned[open].more > 0 && <p className="sm muted">{t("ep.sc.more", { n: u.data.unplanned[open].more })}</p>}</div>)}
      </div>
    </div>
  );
}
