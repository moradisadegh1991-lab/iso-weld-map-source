"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Search, filter, sort and export for any table on the platform.
 *
 *   <TableKit name="punch"><table className="dtable">…</table></TableKit>
 *
 * It works on the rendered rows rather than on the page's data, so every
 * table gets it without each page re-plumbing its state — and a page keeps
 * rendering its rows exactly as before.
 *
 * Rows are grouped: a row whose only cell spans columns (an "action" panel
 * opened under a row) belongs to the row above it, and is shown, hidden and
 * moved with it.
 *
 * Filtering hides rows with the `hidden` attribute, which React never
 * writes. Sorting moves rows, which React does not expect: so the order
 * React believes in is tracked from the mutation records (each insertion
 * names the node it went before), restored before React's next change is
 * read, and the sort applied again after. React never sees an order it did
 * not make at the moment it makes a change.
 *
 * Searching ignores the Arabic/Persian letter variants (ي/ی, ك/ک), the
 * zero-width non-joiner and Persian digits, so «۱۲۰۳» finds «1203».
 */
export default function TableKit({ children, name = "table", min = 6 }) {
  const box = useRef(null);
  const st = useRef({ orig: [], tbody: null, observer: null });
  const [q, setQ] = useState("");
  const [col, setCol] = useState("");
  const [val, setVal] = useState("");
  const [sort, setSort] = useState(null);                 // { i, dir: 1 | -1 }
  const [meta, setMeta] = useState({ heads: [], total: 0, shown: 0, values: [] });

  const apply = useCallback(() => {
    const table = box.current?.querySelector("table");
    const tbody = table?.tBodies?.[0];
    if (!tbody) { setMeta((m) => (m.total ? { heads: [], total: 0, shown: 0, values: [] } : m)); return; }
    const s = st.current;
    const obs = s.observer;
    // Records first: disconnect() drops whatever is still queued.
    if (obs) { absorb(s, obs.takeRecords()); obs.disconnect(); }
    if (s.tbody !== tbody) { s.tbody = tbody; s.orig = [...tbody.rows]; }
    // Keep the tracked order to the rows that exist (a re-render may have
    // replaced some without a record we saw).
    const live = new Set(tbody.rows);
    s.orig = s.orig.filter((r) => live.has(r));
    for (const r of tbody.rows) if (!s.orig.includes(r)) s.orig.push(r);

    const heads = [...(table.tHead?.rows?.[0]?.cells || [])].map((c) => c.textContent.trim());
    const groups = [];
    for (const r of s.orig) {
      if (isDetail(r) && groups.length) groups[groups.length - 1].rest.push(r);
      else groups.push({ main: r, rest: [] });
    }
    const needle = norm(q);
    const ci = col === "" ? -1 : Number(col);
    let shown = 0;
    for (const g of groups) {
      const text = norm(g.main.textContent);
      const cell = ci >= 0 ? (g.main.cells[ci]?.textContent || "").trim() : "";
      const ok = (!needle || text.includes(needle)) && (ci < 0 || val === "" || cell === val);
      g.main.hidden = !ok;
      for (const r of g.rest) r.hidden = !ok;
      if (ok) shown++;
    }
    // Order: React's, or sorted — groups move whole.
    const ordered = sort ? [...groups].sort((a, b) => sort.dir * compare(cellOf(a.main, sort.i), cellOf(b.main, sort.i))) : groups;
    const want = ordered.flatMap((g) => [g.main, ...g.rest]);
    if (want.some((r, k) => tbody.rows[k] !== r)) for (const r of want) tbody.appendChild(r);
    // Header state
    [...(table.tHead?.rows?.[0]?.cells || [])].forEach((th, k) => {
      if (!th.textContent.trim()) return;
      th.classList.add("tk-sort");
      th.classList.toggle("asc", sort?.i === k && sort.dir === 1);
      th.classList.toggle("desc", sort?.i === k && sort.dir === -1);
    });
    const values = ci >= 0
      ? [...new Set(groups.map((g) => (g.main.cells[ci]?.textContent || "").trim()).filter(Boolean))].sort((a, b) => compare(a, b)).slice(0, 80)
      : [];
    setMeta((m) => (m.total === groups.length && m.shown === shown && m.heads.join("|") === heads.join("|") && m.values.join("|") === values.join("|")
      ? m : { heads, total: groups.length, shown, values }));
    if (obs) {
      obs.takeRecords();
      obs.observe(box.current, { childList: true, subtree: true, characterData: true });
    }
  }, [q, col, val, sort]);

  useEffect(() => {
    const s = st.current;
    let frame = 0;
    const obs = new MutationObserver((records) => {
      absorb(s, records);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });
    s.observer = obs;
    obs.observe(box.current, { childList: true, subtree: true, characterData: true });
    apply();
    return () => { cancelAnimationFrame(frame); obs.disconnect(); s.observer = null; };
  }, [apply]);

  function onHeadClick(e) {
    const th = e.target.closest("th");
    if (!th || !box.current?.contains(th) || !th.closest("thead") || !th.textContent.trim()) return;
    const i = th.cellIndex;
    setSort((s) => (!s || s.i !== i ? { i, dir: 1 } : s.dir === 1 ? { i, dir: -1 } : null));
  }

  function exportCsv() {
    const table = box.current?.querySelector("table");
    if (!table) return;
    const esc = (t) => `"${String(t).replace(/\s+/g, " ").trim().replace(/"/g, '""')}"`;
    const lines = [meta.heads.map(esc).join(",")];
    for (const r of table.tBodies[0]?.rows || []) {
      if (r.hidden || isDetail(r)) continue;
      lines.push([...r.cells].map((c) => esc(c.textContent)).join(","));
    }
    // BOM: Excel opens UTF-8 Persian correctly only with it.
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const filtering = q || (col !== "" && val !== "") || sort;
  const showBar = meta.total >= min || filtering;
  return (
    <div className="tk">
      {showBar && (
        <div className="tk-bar no-print">
          <input className="tk-q" type="search" placeholder="جست‌وجو در جدول…" aria-label="جست‌وجو در جدول"
                 value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="فیلتر ستون" value={col} onChange={(e) => { setCol(e.target.value); setVal(""); }}>
            <option value="">فیلتر ستون…</option>
            {meta.heads.map((h, i) => h && <option key={i} value={i}>{h}</option>)}
          </select>
          {col !== "" && (
            <select aria-label="مقدار فیلتر" value={val} onChange={(e) => setVal(e.target.value)}>
              <option value="">همه</option>
              {meta.values.map((v) => <option key={v} value={v}>{v.length > 40 ? v.slice(0, 40) + "…" : v}</option>)}
            </select>
          )}
          <span className="tk-n">{meta.shown === meta.total ? `${fa(meta.total)} ردیف` : `${fa(meta.shown)} از ${fa(meta.total)} ردیف`}</span>
          {filtering && <button type="button" onClick={() => { setQ(""); setCol(""); setVal(""); setSort(null); }}>پاک کردن</button>}
          <button type="button" onClick={exportCsv} title="ردیف‌های نمایش‌داده، برای Excel">خروجی CSV</button>
        </div>
      )}
      {showBar && meta.total > 0 && meta.shown === 0 && <p className="empty-note">ردیفی با این جست‌وجو یا فیلتر نیست.</p>}
      <div className="wrap" ref={box} onClick={onHeadClick}>{children}</div>
    </div>
  );
}

/** Fold React's own insertions and removals into the order it believes in. */
function absorb(s, records) {
  for (const rec of records) {
    if (rec.type !== "childList" || rec.target !== s.tbody) continue;
    for (const n of rec.removedNodes) s.orig = s.orig.filter((r) => r !== n);
    const added = [...rec.addedNodes].filter((n) => n.nodeName === "TR");
    if (!added.length) continue;
    const at = rec.nextSibling ? s.orig.indexOf(rec.nextSibling) : -1;
    for (const n of added) s.orig = s.orig.filter((r) => r !== n);
    if (at < 0) s.orig.push(...added);
    else s.orig.splice(s.orig.indexOf(rec.nextSibling), 0, ...added);
  }
}

const isDetail = (r) => r.cells.length === 1 && r.cells[0].colSpan > 1;
const cellOf = (r, i) => (r.cells[i]?.textContent || "").trim();
const DIGITS = { "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };
const latin = (t) => String(t).replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d]);
function norm(t) {
  return latin(t).replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[‌‏‎]/g, "").replace(/\s+/g, " ").toLowerCase().trim();
}
function compare(a, b) {
  // "—" and "-" are how the pages print "nothing": they sort with the empties, last.
  const blank = (t) => (/^[—–\-]?$/.test(t.trim()) ? "" : t);
  const x = blank(latin(a).replace(/[,٬]/g, "")), y = blank(latin(b).replace(/[,٬]/g, ""));
  const nx = /^-?\d+(\.\d+)?%?$/.test(x.trim()) ? parseFloat(x) : NaN;
  const ny = /^-?\d+(\.\d+)?%?$/.test(y.trim()) ? parseFloat(y) : NaN;
  if (Number.isFinite(nx) && Number.isFinite(ny)) return nx - ny;
  if (!x && y) return 1;
  if (x && !y) return -1;
  return x.localeCompare(y, "fa", { numeric: true });
}
const fa = (n) => Number(n).toLocaleString("fa-IR");
