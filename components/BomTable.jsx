"use client";
import { useEffect, useMemo, useState } from "react";
import { decorate, view, ledgerByPt, deleteCheck, BOM_FILTERS } from "../lib/register/bom-table.mjs";

/**
 * The BOM tab's table: the sheet's BOM rows with search, filter, sort, per-row checks, the live use
 * (the welds' ends against the row — lib/register/bom-allocation.mjs) and the SAVED ledger of the revision
 * (reserved / installed / left, GET /api/bom-allocations). It shows and routes; a row is viewed, edited and
 * added in components/BomForm.jsx and the draft is saved with the register, where the server enforces the
 * locks (approved revision, installed lines, BOM_IN_USE). Nothing is written from here.
 *
 *   rows        the draft rows (as typed)            live    usage(items, bom) Map
 *   locked      approved register: view only          session { projectId, call }, documentId — for the saved ledger
 *   onView(i) onEdit(i) onAdd() onDelete(i)  — i is the index in `rows`
 *   savedHadRows  the saved BOM had rows: deleting the last one makes the next save an explicit clear (`bom: []`)
 */
const FILTER_LABEL = { all: "همه", issues: "با ایراد", reserved: "رزرو/استفاده‌شده", installed: "نصب‌شده", unused: "بدون استفاده" };
const COLS = [["pt", "PT"], ["group", "گروه"], ["description", "شرح"], ["diam", "N.S."], ["stockCode", "کد کالا"], ["qty", "تعداد"], ["qtyUnit", "واحد"]];
const SORTABLE = new Set(["pt", "group", "description", "diam", "qty"]);

export default function BomTable({ rows, live, locked = false, session = null, documentId = null, savedHadRows = false, onView, onEdit, onAdd, onDelete }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState(null);
  const [ledger, setLedger] = useState({ phase: documentId ? "loading" : "none", map: null, error: "" });
  const [msg, setMsg] = useState("");

  // the saved ledger of this revision (read-only; the server decides what a save may change)
  useEffect(() => {
    if (!documentId || !session?.projectId) { setLedger({ phase: "none", map: null, error: "" }); return undefined; }
    let gone = false;
    setLedger((l) => ({ ...l, phase: "loading", error: "" }));
    (async () => {
      try {
        const r = await session.call(`/api/bom-allocations?projectId=${session.projectId}&documentId=${documentId}`);
        if (!gone) setLedger({ phase: "ok", map: ledgerByPt(r), error: "" });
      } catch (e) { if (!gone) setLedger({ phase: "error", map: null, error: e?.message || "ledger" }); }
    })();
    return () => { gone = true; };
  }, [documentId, session?.projectId, rows.length]);

  const all = useMemo(() => decorate(rows, { live, ledger: ledger.map }), [rows, live, ledger.map]);
  const list = useMemo(() => view(all, { query, filter, sort }), [all, query, filter, sort]);
  const issueCount = all.filter((d) => d.issues.length).length;
  const clickSort = (k) => setSort((s) => (s?.key !== k ? { key: k, dir: "asc" } : s.dir === "asc" ? { key: k, dir: "desc" } : null));

  const remove = (d) => {
    const c = deleteCheck(d, { locked });
    if (!c.ok) { setMsg(c.message); return; }
    if (c.warn && !window.confirm(`${c.message}\nادامه می‌دهید؟`)) return;
    if (rows.length === 1 && savedHadRows && !window.confirm("با حذف آخرین ردیف، BOM ذخیره‌شده با ذخیرهٔ بعدی به‌صورت صریح خالی می‌شود. ادامه می‌دهید؟")) return;
    setMsg("");
    onDelete?.(d.index);
  };
  const usedCell = (d) => {
    const u = d.live;
    const liveTxt = !u ? "—" : u.cap.mode === "length" ? "طولی" : u.cap.mode === "none" ? (u.used ? `${u.used}/۰` : "—")
      : u.cap.capacity == null ? (u.used ? `${u.used}/؟` : "؟") : `${u.used}/${u.cap.capacity}`;
    return liveTxt;
  };

  return (
    <div className="bom-table" data-bom-table>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input type="search" data-bom-search value={query} placeholder="جستجو در PT، شرح، کد کالا…" aria-label="BOM search" onChange={(e) => setQuery(e.target.value)} />
        <select data-bom-filter value={filter} aria-label="BOM filter" onChange={(e) => setFilter(e.target.value)}>
          {BOM_FILTERS.map((f) => <option key={f} value={f}>{FILTER_LABEL[f]}{f === "issues" && issueCount ? ` (${issueCount})` : ""}</option>)}
        </select>
        <span className="muted sm" data-bom-count>{list.length === rows.length ? `${rows.length} ردیف` : `${list.length} از ${rows.length} ردیف`}</span>
        <span className="grow" />
        {!locked && <button type="button" className="ghost sm" data-bom-add onClick={onAdd}>+ ردیف BOM</button>}
      </div>
      {locked && <p className="muted sm" data-bom-locked>رجیستر تأیید شده؛ BOM فقط‌خواندنی است. تغییر آن با ثبت رویژن جدید نقشه انجام می‌شود.</p>}
      {ledger.phase === "none" && <p className="muted sm" data-ledger-state="none">تخصیص ذخیره‌شده فقط برای برگی که ذخیره شده نشان داده می‌شود؛ ستون «مصرف» استفادهٔ زندهٔ سرجوش‌هاست.</p>}
      {ledger.phase === "loading" && <p className="muted sm" data-ledger-state="loading">در حال خواندن تخصیص ذخیره‌شده…</p>}
      {ledger.phase === "error" && <p className="sm" role="alert" data-ledger-state="error">خواندن تخصیص ذخیره‌شده نشد: {ledger.error}</p>}
      {msg && <p className="sm" role="alert" data-bom-msg>{msg}</p>}

      {rows.length === 0 ? (
        <p className="muted" data-bom-empty>
          BOM این برگ خالی است (خوانده نشد یا ردیفی ثبت نشده).{!locked && " با «+ ردیف BOM» ردیف اضافه کنید؛ BOM خالی ذخیره‌شده تغییری نمی‌کند."}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="dtable">
            <thead><tr>
              {COLS.map(([k, label]) => (
                <th key={k} aria-sort={sort?.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                  {SORTABLE.has(k)
                    ? <button type="button" className="ghost sm" data-bom-sort={k} onClick={() => clickSort(k)}>{label}{sort?.key === k ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</button>
                    : label}
                </th>))}
              <th title="سرهای جوشی‌شدنی این ردیف که سرجوش‌ها نام برده‌اند">مصرف زنده</th>
              <th title="تخصیص ذخیره‌شده در دفتر این رویژن">رزرو / نصب / مانده</th>
              <th>بررسی</th><th></th>
            </tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={COLS.length + 4} className="muted" data-bom-nomatch>ردیفی با این جستجو/فیلتر نیست.</td></tr>}
              {list.map((d) => {
                const b = d.row, s = d.saved;
                return (
                  <tr key={d.index} data-bom-row={b.pt} data-bom-index={d.index}>
                    <td className="mono b" dir="ltr" data-bom-cell="pt">{b.pt === "" || b.pt == null ? "—" : b.pt}</td>
                    <td className="sm" data-bom-cell="group">{b.group || "—"}</td>
                    <td className="sm" dir="ltr" data-bom-cell="description">{b.description || "—"}</td>
                    <td className="mono" data-bom-cell="diam">{b.diam || "؟"}</td>
                    <td className="mono sm" dir="ltr" data-bom-cell="stockCode">{b.stockCode || "—"}</td>
                    <td className="mono" dir="ltr" data-bom-cell="qty">{b.qty === "" || b.qty == null ? "؟" : b.qty}</td>
                    <td className="sm" data-bom-cell="qtyUnit">{b.qtyUnit === "pcs" ? "عدد" : b.qtyUnit === "m" ? "m" : "؟"}</td>
                    <td className="mono sm" dir="ltr" data-bom-alloc={b.pt}>{usedCell(d)}</td>
                    <td className="mono sm" dir="ltr" data-bom-ledger={b.pt}>
                      {s ? `${s.reserved ?? 0} / ${s.installed ?? 0} / ${s.left == null ? "؟" : s.left}` : ledger.phase === "ok" ? "—" : ""}
                    </td>
                    <td className="sm" data-bom-issues={d.issues.length}>{d.issues.length ? <span title={d.issues.join(" · ")}>⚠ {d.issues.length}</span> : "✓"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="ghost sm" data-bom-view={b.pt} onClick={() => onView?.(d.index)}>مشاهده</button>
                      {!locked && <button type="button" className="ghost sm" data-bom-edit={b.pt} onClick={() => onEdit?.(d.index)}>ویرایش</button>}
                      {!locked && <button type="button" className="ghost sm" data-bom-delete={b.pt} onClick={() => remove(d)}>حذف</button>}
                    </td>
                  </tr>);
              })}
            </tbody>
          </table>
        </div>)}
    </div>
  );
}
