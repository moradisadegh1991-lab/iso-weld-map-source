"use client";
import { useMemo, useState } from "react";
import { ACTIONS, CATEGORIES } from "../lib/engineering/validation.mjs";

/**
 * The Reconciliation Center (docs/audit/phase-7-engineering-validation.md): the engine's findings (lib/engineering/validation.mjs) in one place —
 * summary, a filterable table, details, and the way to each finding's existing form. It never edits data: «open the form» goes where the data
 * is edited (the weld/equipment/BOM forms), and the one thing done here is closing a STORED warning after its relationship exists.
 *
 * Two sources, always labelled: the page's DRAFT (a live preview, recomputed as you edit) and the SAVED revision (the server's, authoritative).
 */
const CAT = { pid: "P&ID", identity: "هویت", geometry: "هندسه", weld: "سرجوش", bom: "BOM", allocation: "تخصیص", equipment: "تجهیز", spool: "اسپول", support: "ساپورت", revision: "رویژن", "data-integrity": "یکپارچگی داده" };
const SEV = { error: "ایراد", warning: "هشدار", info: "اطلاع" };
const RANK = { error: 0, warning: 1, info: 2 };
const ENTITY = { line: "خط", instrument: "ابزار", valve: "شیر", inline: "قطعهٔ خط", connector: "اتصال بین‌برگی", edge: "اتصال", weld: "سرجوش", "sheet-weld-mark": "نشان روی نقشه", equipment: "تجهیز", spool: "اسپول", support: "ساپورت", "bom-row": "ردیف BOM", allocation: "تخصیص", revision: "رویژن", mark: "نشان", cut: "برش" };
const short = (u) => (u ? String(u).slice(0, 8) : "—");

export default function ValidationPanel({ draft, saved, source, onSource, onRefresh, loading, error, selectedUid, onSelect, onOpen, onResolve, locked, resolveBusy }) {
  const result = source === "saved" ? saved : draft;
  const findings = result?.findings || [], summary = result?.summary || { total: 0, open: 0, errors: 0, warnings: 0, info: 0, resolved: 0, blocking: 0 };
  const [q, setQ] = useState(""), [cat, setCat] = useState("all"), [sev, setSev] = useState("all"), [status, setStatus] = useState("open"), [sort, setSort] = useState("severity"), [group, setGroup] = useState("none");
  const [pick, setPick] = useState(null), [note, setNote] = useState(""), [msg, setMsg] = useState("");
  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = findings.filter((f) => (cat === "all" || f.category === cat) && (sev === "all" || f.severity === sev)
      && (status === "all" || (status === "open" ? !f.resolved : status === "resolved" ? f.resolved : status === "blocking" ? f.blocking && !f.resolved : true))
      && (!needle || [f.message, f.title, f.entityNumber, f.entityUid, f.code].some((x) => String(x ?? "").toLowerCase().includes(needle))));
    const by = { severity: (a, b) => RANK[a.severity] - RANK[b.severity] || a.category.localeCompare(b.category), category: (a, b) => a.category.localeCompare(b.category) || RANK[a.severity] - RANK[b.severity],
      entity: (a, b) => String(a.entityNumber ?? "").localeCompare(String(b.entityNumber ?? ""), undefined, { numeric: true }) || RANK[a.severity] - RANK[b.severity], code: (a, b) => a.code.localeCompare(b.code) };
    list = [...list].sort(by[sort] || by.severity);
    if (group === "none") return [{ key: "", rows: list }];
    const g = new Map();
    for (const f of list) { const k = group === "category" ? CAT[f.category] : `${ENTITY[f.entityType] || f.entityType} ${f.entityNumber ?? ""}`.trim(); g.set(k, [...(g.get(k) || []), f]); }
    return [...g].map(([key, rows]) => ({ key, rows }));
  }, [findings, q, cat, sev, status, sort, group]);
  const shown = view.reduce((n, g) => n + g.rows.length, 0);
  const current = findings.find((f) => f.id === pick) || null;

  const select = (f) => { setPick(f.id); setMsg(""); setNote(""); if (f.entityUid && f.entityType !== "allocation") onSelect?.(f.entityUid); };
  // a mark picked on the drawing / in a table highlights its findings
  const isSel = (f) => Boolean(selectedUid) && f.entityUid && String(f.entityUid).toLowerCase() === String(selectedUid).toLowerCase();
  const doResolve = async (f) => {
    setMsg("");
    const r = await onResolve?.(f, note);
    if (r?.error) setMsg(r.error); else { setNote(""); setMsg("هشدار بسته شد؛ تاریخچه‌اش می‌ماند."); }
  };

  return (
    <div data-validation className="vc">
      <div className="row vc-head">
        <div className="vc-source" role="group" aria-label="validation source">
          <button type="button" className={source === "draft" ? "" : "ghost"} data-vc-source="draft" aria-pressed={source === "draft"} onClick={() => onSource?.("draft")}>پیش‌نویس (پیش‌نمایش صفحه)</button>
          <button type="button" className={source === "saved" ? "" : "ghost"} data-vc-source="saved" aria-pressed={source === "saved"} onClick={() => onSource?.("saved")} disabled={!saved && !loading}>ذخیره‌شده (سرور)</button>
        </div>
        <button type="button" className="ghost" data-vc-refresh onClick={onRefresh} disabled={loading}>{loading ? "در حال بررسی…" : "↻ تازه‌سازی"}</button>
        <span className="muted sm" data-vc-source-note>
          {source === "saved" ? `وضعیت ذخیره‌شدهٔ سرور${saved?.generatedAt ? ` · ${new Date(saved.generatedAt).toLocaleTimeString("fa-IR")}` : ""}` : "پیش‌نمایش زنده از پیش‌نویس؛ دفتر تخصیص و تجهیزات از سرور"}
        </span>
      </div>
      {error && <p className="note bad" role="alert" data-vc-error>{error}</p>}
      {source === "saved" && !saved && !loading && <p className="muted" data-vc-no-saved>این برگ هنوز ذخیره نشده؛ نتیجهٔ سرور ندارد.</p>}

      <div className="vc-cards" data-vc-summary>
        {[["total", "کل", summary.total, ""], ["errors", "ایراد", summary.errors, summary.errors ? "bad" : ""], ["warnings", "هشدار", summary.warnings, summary.warnings ? "warn" : ""],
          ["info", "اطلاع", summary.info, ""], ["resolved", "حل‌شده", summary.resolved, summary.resolved ? "ok" : ""], ["blocking", "مانع ذخیره/تأیید", summary.blocking, summary.blocking ? "bad" : ""]].map(([k, label, n, tone]) => (
          <div key={k} className={`vc-card ${tone}`} data-vc-card={k}><b className="mono">{n}</b><span className="sm muted">{label}</span></div>))}
      </div>

      <div className="vc-filters">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجو (شماره، شناسه، متن)" aria-label="search findings" data-vc-search />
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="category" data-vc-category><option value="all">همهٔ دسته‌ها</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CAT[c]}</option>)}</select>
        <select value={sev} onChange={(e) => setSev(e.target.value)} aria-label="severity" data-vc-severity><option value="all">همهٔ شدت‌ها</option>{Object.entries(SEV).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="status" data-vc-status><option value="open">باز</option><option value="blocking">مانع</option><option value="resolved">حل‌شده</option><option value="all">همه</option></select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="sort" data-vc-sort><option value="severity">مرتب: شدت</option><option value="category">مرتب: دسته</option><option value="entity">مرتب: شماره</option><option value="code">مرتب: کد</option></select>
        <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="group" data-vc-group><option value="none">بدون گروه</option><option value="category">گروه: دسته</option><option value="entity">گروه: موجودیت</option></select>
      </div>
      <p className="muted sm" data-vc-count>{shown} از {findings.length} مورد</p>

      {shown === 0 ? <p className="muted" data-validation-empty>{findings.length ? "موردی با این فیلتر نیست." : "ایرادی پیدا نشد."}</p> : (
        <div className="vc-scroll">
          <table className="vc-table" data-vc-table>
            <thead><tr><th>شدت</th><th>دسته</th><th>موجودیت</th><th>شناسه</th><th>شرح</th><th>اقدام پیشنهادی</th><th>وضعیت</th></tr></thead>
            {view.map((g) => (
              <tbody key={g.key || "all"}>
                {g.key && <tr className="vc-group"><th colSpan={7}>{g.key} <span className="muted">({g.rows.length})</span></th></tr>}
                {g.rows.map((f) => (
                  <tr key={f.id} tabIndex={0} data-finding={f.code} data-finding-id={f.id} data-severity={f.severity} data-category={f.category} data-resolved={f.resolved ? "1" : "0"}
                    className={`${pick === f.id ? "on" : ""} ${isSel(f) ? "sel" : ""}`} aria-selected={pick === f.id} onClick={() => select(f)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(f); } }}>
                    <td><span className={`vc-sev ${f.severity}`}>{SEV[f.severity]}</span>{f.blocking && <span className="vc-block" title="سرور ذخیره/تأیید را به همین دلیل رد می‌کند">مانع</span>}</td>
                    <td>{CAT[f.category]}</td>
                    <td>{ENTITY[f.entityType] || f.entityType}{f.entityNumber ? <> <b className="mono">{f.entityNumber}</b></> : null}</td>
                    <td className="mono sm" dir="ltr" title={f.entityUid || ""}>{short(f.entityUid)}</td>
                    <td>{f.message}</td>
                    <td className="sm">{ACTIONS[f.suggestedAction] || f.suggestedAction}</td>
                    <td>{f.resolved ? "حل‌شده" : "باز"}</td>
                  </tr>))}
              </tbody>))}
          </table>
        </div>)}

      {current && (
        <section className="vc-detail" data-vc-detail aria-label="finding details">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <b>{current.title}</b>
            <button type="button" className="ghost sm" onClick={() => setPick(null)} aria-label="close details">×</button>
          </div>
          <p>{current.message}</p>
          <dl className="vc-dl sm">
            <dt>کد</dt><dd className="mono" dir="ltr">{current.code}</dd>
            <dt>موجودیت</dt><dd>{ENTITY[current.entityType] || current.entityType} {current.entityNumber ? <b className="mono">{current.entityNumber}</b> : null}</dd>
            <dt>شناسهٔ پایدار (UID)</dt><dd className="mono" dir="ltr" data-vc-uid>{current.entityUid || "—"}</dd>
            <dt>رویژن</dt><dd className="mono" dir="ltr">{current.revision?.docNo || "—"} · REV {current.revision?.rev ?? "—"}{current.revision?.sheet ? ` · ${current.revision.sheet}` : ""}</dd>
            <dt>منبع</dt><dd className="mono" dir="ltr">{current.source}</dd>
            <dt>شدت / دسته</dt><dd>{SEV[current.severity]} · {CAT[current.category]}{current.blocking ? " · مانع ذخیره/تأیید" : ""}</dd>
            {current.detail?.pt != null && (<><dt>PT (BOM)</dt><dd className="mono">{current.detail.pt}</dd></>)}
            {current.detail?.used != null && (<><dt>خواسته / ظرفیت</dt><dd className="mono">{current.detail.used} / {current.detail.capacity ?? current.detail.total ?? "؟"}</dd></>)}
            {current.detail?.preview != null && (<><dt>پیش‌نمایش / دفتر سرور</dt><dd className="mono">{current.detail.preview} / {(current.detail.reserved ?? 0) + (current.detail.installed ?? 0)}</dd></>)}
            {current.detail?.weldNo && (<><dt>شمارهٔ قدیمی سرجوش</dt><dd className="mono">{current.detail.weldNo}</dd></>)}
            {current.detail?.attrs && Object.keys(current.detail.attrs).length > 0 && (<><dt>ویژگی‌های نشان</dt><dd className="mono sm" dir="ltr">{Object.entries(current.detail.attrs).map(([k, v]) => `${k}=${v}`).join(" · ")}</dd></>)}
            {current.detail?.resolution && (<><dt>راه‌حل ثبت‌شده</dt><dd data-vc-resolution>{current.detail.resolution}</dd></>)}
          </dl>
          <div className="row vc-actions">
            {!["warnings", "save", "new-revision"].includes(current.suggestedAction) && (
              <button type="button" data-vc-open={current.suggestedAction} onClick={() => onOpen?.(current)}>{ACTIONS[current.suggestedAction] || "باز کردن"}</button>)}
            {current.entityUid && current.suggestedAction !== "drawing" && <button type="button" className="ghost" data-vc-drawing onClick={() => onOpen?.({ ...current, suggestedAction: "drawing" })}>نمایش روی نقشه</button>}
          </div>
          {current.detail?.warningId && !current.resolved && (
            <div className="vc-resolve" data-vc-resolve>
              <p className="muted sm">بستن هشدار فقط پس از برقراری رابطه است (مثلاً انتخاب سرجوش درست در فرم تجهیز و ذخیره). سرور بررسی می‌کند؛ چیزی خودکار وصل یا جدا نمی‌شود و تاریخچه می‌ماند.</p>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت راه‌حل (الزامی)" aria-label="resolution note" data-vc-note disabled={locked} />
              <button type="button" data-vc-resolve-btn disabled={locked || resolveBusy || !note.trim()} onClick={() => doResolve(current)}>{resolveBusy ? "…" : "حل شد"}</button>
              {locked && <span className="muted sm">رویژن تأییدشده است؛ رویژن جدید ثبت کنید.</span>}
            </div>)}
          {msg && <p className="note" role="status" data-vc-msg>{msg}</p>}
        </section>)}
    </div>
  );
}
