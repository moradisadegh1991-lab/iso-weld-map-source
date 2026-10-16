"use client";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../../../lib/client/platform.mjs";
import ActivityGrid from "../../../../components/eps/ActivityGrid";
import { fmt, day } from "../../../../components/eps/ActivityDetail";
import { COLUMNS, useVersion } from "../../../../components/eps/shared";

/**
 * Several days side by side (owner's «PMS» document, last page): the days
 * are picked from a list like Excel's filter (search, select all, clear);
 * only the activities with work on one of them are shown, under their WBS
 * nodes, with one column per day — the quantity done that day — and the
 * total over the chosen days.
 */
export default function DaysPage() {
  const { contractId } = usePlatform();
  const { versionId, picker } = useVersion(contractId);
  const [days, setDays] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(new Set());
  const [find, setFind] = useState("");
  const { data, error } = useProjectData((id) => (versionId ? `/api/eps/activities?projectId=${id}&versionId=${versionId}&days=${days.join(",")}` : null), [versionId, days.join(",")]);
  const [sel, setSel] = useState(null);
  const keep = useCallback((a) => !!data?.matrix?.[a.id], [data]);
  const columns = useMemo(() => {
    const base = COLUMNS.filter((c) => ["code", "name", "unit", "volActual", "done", "pct"].includes(c.key));
    const per = (data?.days || []).map((d) => ({ key: `d:${d}`, title: day(d), width: 90, mono: true,
      get: (r) => (r.kind === "act" ? fmt(data.matrix[r.id]?.byDay[d]) : "") }));
    return [...base, ...per, { key: "total", title: "جمع روزهای انتخابی", width: 110, mono: true, get: (r) => (r.kind === "act" ? fmt(data.matrix[r.id]?.total) : "") }];
  }, [data]);
  const head = (
    <div className="pagehead"><h1>کار انجام‌شده در چند روز</h1>
      <span className="sub">{picker} <Link href="/eps/progress">ثبت کار روزانه</Link> · <Link href="/eps/activities">فعالیت‌ها</Link></span></div>);
  if (!contractId) return <div className="page"><div className="pagehead"><h1>کار انجام‌شده در چند روز</h1></div><p className="empty-note">قرارداد را از فهرست بالای صفحه انتخاب کنید.</p></div>;
  if (error) return <div className="page">{head}<p className="err">{error}</p></div>;
  if (!versionId) return <div className="page">{head}<p className="empty-note">اول در «EPS و PMS» یک PMS و نسخه بسازید.</p></div>;
  if (!data) return <div className="page">{head}<p className="muted">در حال بارگذاری…</p></div>;
  const all = data.allDays || [];
  const shown = all.filter((d) => !find || d.includes(find) || day(d).includes(find));
  const picker2 = (
    <span style={{ position: "relative" }}>
      <button type="button" className="btn sm" data-days-filter onClick={() => { setDraft(new Set(days)); setOpen(!open); }} aria-expanded={open}>روزها ({days.length}) ▾</button>
      {open && (
        <div className="p6-days-pick card" role="dialog" aria-label="انتخاب روزها">
          <input type="search" placeholder="جستجو…" value={find} onChange={(e) => setFind(e.target.value)} style={{ width: "100%" }} />
          <label style={{ display: "block", borderBottom: "1px solid var(--rule)", padding: "4px 0" }}>
            <input type="checkbox" checked={shown.length > 0 && shown.every((d) => draft.has(d))} onChange={(e) => { const n = new Set(draft); shown.forEach((d) => (e.target.checked ? n.add(d) : n.delete(d))); setDraft(n); }} /> (انتخاب همه)</label>
          {shown.map((d) => (
            <label key={d} style={{ display: "block" }} data-day={d}><input type="checkbox" checked={draft.has(d)} onChange={() => { const n = new Set(draft); n.has(d) ? n.delete(d) : n.add(d); setDraft(n); }} /> {day(d)} <span className="sm muted mono">{d}</span></label>))}
          {all.length === 0 && <p className="sm muted">هنوز در هیچ روزی کاری ثبت نشده است.</p>}
          <p className="row" style={{ gap: 6, marginTop: 6 }}>
            <button type="button" className="btn sm" onClick={() => { setDays([...draft].sort()); setOpen(false); }}>تأیید</button>
            <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>انصراف</button></p>
        </div>)}
    </span>);
  return (
    <div className="page">
      {head}
      {days.length === 0 && <p className="sm muted">روزها را از «روزها ▾» انتخاب کنید؛ فقط روزهایی که کار ثبت‌شده دارند فهرست می‌شوند.</p>}
      <div style={{ height: "calc(100vh - 200px)", minHeight: 360 }}>
        <ActivityGrid data={data} columns={columns} defaultCols={columns.map((c) => c.key)} storeKey="p6-days" persist={false} gantt={false}
          keep={keep} selected={sel} onSelect={(r) => setSel(r.id)} toolbar={picker2} />
      </div>
    </div>
  );
}
