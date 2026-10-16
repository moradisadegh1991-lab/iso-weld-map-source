"use client";
import Link from "next/link";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { useVersion } from "../../../components/eps/shared";
import { describeRule, Pending } from "../../../components/eps/ScopePanel";
import { fmt } from "../../../components/eps/ActivityDetail";

/**
 * The PMS against the platform's records, for one version: every link
 * (activity or WBS node ↔ equipment, welds, cables, instruments, foundations,
 * structures) with what changed since it was applied, and the items the
 * platform holds that no activity covers yet — what a new drawing, P&ID or
 * register brought into the project and the PMS does not plan.
 */
export default function ScopePage() {
  const { projectId, contractId, call } = usePlatform();
  const { versionId, picker } = useVersion(contractId);
  const v = useProjectData((id) => (versionId ? `/api/eps/activities?projectId=${id}&versionId=${versionId}` : null), [versionId]);
  const u = useProjectData((id) => (versionId ? `/api/eps/activities?projectId=${id}&versionId=${versionId}&unplanned=1` : null), [versionId]);
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  async function apply(ruleId) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/eps/activities", { method: "POST", body: JSON.stringify({ projectId, kind: "scope-apply", ruleId }) });
      setOk(`اعمال شد: +${r.row.added} / −${r.row.removed}${r.row.made ? `، ${r.row.made} فعالیت ساخته شد` : ""}.`); v.reload(); u.reload(); }
    catch (e) { setMsg(e.message); }
  }
  const head = (
    <div className="pagehead"><h1>محدودهٔ پلتفرم در PMS</h1>
      <span className="sub">{picker} <Link href="/eps/activities">فعالیت‌ها</Link></span></div>);
  if (!contractId) return <div className="page"><div className="pagehead"><h1>محدودهٔ پلتفرم در PMS</h1></div><p className="empty-note">قرارداد را از فهرست بالای صفحه انتخاب کنید.</p></div>;
  if (v.error || u.error) return <div className="page">{head}<p className="err">{v.error || u.error}</p></div>;
  if (!v.data || !u.data) return <div className="page">{head}<p className="muted">در حال بارگذاری…</p></div>;
  const L = v.data.labels.scope;
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
        <h2>پیوندهای این نسخه</h2>
        {v.data.scope.length === 0 ? <p className="empty-note">هنوز فعالیت یا گره‌ای به داده‌های پلتفرم پیوند نشده است (فعالیت‌ها ◄ زبانهٔ Scope، یا انتخاب یک گره).</p> : (
          <table className="dtable"><thead><tr><th>فعالیت / گره</th><th>نوع</th><th>محدوده</th><th>اقلام</th><th>حجم</th><th>پیشرفت</th><th>تغییرات اعمال‌نشده</th><th /></tr></thead>
            <tbody>{v.data.scope.map((s) => {
              const w = where(s.rule);
              return (
                <tr key={s.rule.id} data-rule={w?.code}><td><span className="mono" dir="ltr">{w?.code}</span> {w?.name}</td>
                  <td className="sm">{s.rule.mode === "per_item" ? "هر قلم یک فعالیت" : "یک فعالیت"}{s.rule.auto_apply ? " · خودکار" : ""}</td>
                  <td className="sm">{describeRule(s.rule, L, v.data.scopeChoices)}</td><td className="mono">{fmt(s.summary.items)}</td>
                  <td className="mono">{fmt(s.summary.qty)} {s.summary.unknown ? <span className="sm" style={{ color: "var(--warn)" }}>(+{s.summary.unknown} نامعلوم)</span> : ""}</td>
                  <td className="mono">{s.summary.pct == null ? "—" : `${fmt(s.summary.pct)}٪`}</td>
                  <td><Pending pending={s.pending} firstApply={s.firstApply} /></td>
                  <td>{v.data.may.edit && (s.pending.any || s.firstApply) && <button className="btn sm" type="button" onClick={() => apply(s.rule.id)}>اعمال</button>}</td></tr>);
            })}</tbody></table>)}
      </div>
      <div className="card">
        <h2>اقلامی از پلتفرم که در هیچ فعالیتی نیستند</h2>
        <p className="sm muted">تجهیزات، خطوط، کابل‌ها، ابزارها، فونداسیون‌ها و سازه‌هایی که نقشه‌ها، P&IDها و فهرست‌ها به پروژه آورده‌اند و هیچ پیوندی از این نسخه آن‌ها را نمی‌گیرد.</p>
        <table className="dtable"><thead><tr><th>رشته</th><th>کل اقلام</th><th>در PMS</th><th>بیرون از PMS</th><th /></tr></thead>
          <tbody>{Object.entries(u.data.unplanned).map(([d, x]) => (
            <tr key={d} data-unplanned={d}><td>{L.disciplines[d].title}</td><td className="mono">{fmt(x.total)}</td><td className="mono">{fmt(x.covered)}</td>
              <td className="mono" style={{ color: x.total - x.covered ? "var(--warn)" : undefined }}><b>{fmt(x.total - x.covered)}</b></td>
              <td>{x.items.length > 0 && <button className="btn ghost sm" type="button" onClick={() => setOpen(open === d ? null : d)}>{open === d ? "بستن" : "فهرست"}</button>}</td></tr>))}</tbody></table>
        {open && (
          <div className="tablewrap" style={{ maxHeight: 360, marginTop: 8 }}><table className="dtable">
            <thead><tr><th>قلم</th><th>شرح</th><th>زیرسیستم</th><th>نوع</th>{open === "piping" && <th>خط</th>}</tr></thead>
            <tbody>{u.data.unplanned[open].items.map((i) => <tr key={i.key}><td className="mono" dir="ltr">{i.label}</td><td className="sm">{i.name || ""}</td><td className="mono sm">{i.subsystem || "—"}</td>
              <td className="sm">{i.kind || "—"}</td>{open === "piping" && <td className="mono">{i.group || "—"}</td>}</tr>)}</tbody></table>
            {u.data.unplanned[open].more > 0 && <p className="sm muted">و {u.data.unplanned[open].more} قلم دیگر…</p>}</div>)}
      </div>
    </div>
  );
}
