"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { filterTree, splitHits } from "../../lib/eps/activities.mjs";

/**
 * The activity view after Primavera P6: on the left a tree table of the WBS
 * nodes and their activities, on the right a Gantt chart of the same rows —
 * the two scroll together, the line between them is dragged to change their
 * widths. Above them: a filter that keeps the rows above every match and
 * marks the matched text, buttons 1…N that open the tree to that level, and
 * the column chooser (which columns, in what order); each column's width is
 * dragged at its head's edge. Nodes are tinted in their level's colour.
 *
 * Props:
 *   data        the version as /api/eps/activities returns it (roots, relations, settings)
 *   columns     [{key, title, width, get(row) → value, mono, hits}] every column the chooser offers
 *   defaultCols the keys shown at first
 *   storeKey    where the layout (columns, widths, pane width) is remembered in this browser
 *   selected    the selected row's id; onSelect(row)
 *   keep        optional (activity) → bool: only these activities (and the nodes above them) are shown
 *   onVisible   gets the activities shown now (after filter, keep and closing) whenever they change
 *   gantt       false to leave the chart out
 *   toolbar     extra elements for the toolbar
 *   persist     false: the columns follow `defaultCols` (they change with the data) and are not remembered
 */
const ROW = 26;
const DAY = 86400000;
const ms = (d) => Date.parse(`${d}T00:00:00Z`);
const read = (k, dflt) => { try { const v = JSON.parse(window.localStorage.getItem(k) || "null"); return v ?? dflt; } catch { return dflt; } };
const write = (k, v) => { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

/** The tree as rows: nodes, and under each node its activities before its child nodes. */
export function flatRows(roots) {
  const out = [];
  const walk = (n, parentId) => {
    out.push({ kind: "node", id: n.id, parentId, level: n.level, item: n, color: n.color });
    for (const a of n.activities) out.push({ kind: "act", id: a.id, parentId: n.id, level: n.level + 1, item: a, color: n.color });
    n.children.forEach((c) => walk(c, n.id));
  };
  roots.forEach((r) => walk(r, null));
  return out;
}

export function Hl({ text, q }) {
  return <>{splitHits(text, q).map((p, i) => (p.hit ? <mark key={i} style={{ background: "#ffe14d", color: "#111", padding: 0 }}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</>;
}

export default function ActivityGrid({ data, columns, defaultCols, storeKey, selected, onSelect, keep = null, onVisible = null, gantt = true, toolbar = null, persist = true }) {
  const all = useMemo(() => flatRows(data.roots), [data]);
  const [q, setQ] = useState("");
  const [shut, setShut] = useState(new Set());
  const [cols, setCols] = useState(defaultCols);
  const [widths, setWidths] = useState({});
  const [leftW, setLeftW] = useState(760);
  const [zoom, setZoom] = useState("day");
  const [chooser, setChooser] = useState(false);
  useEffect(() => { if (!persist) setCols(defaultCols); }, [persist, defaultCols.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const s = persist ? read(storeKey, null) : null;
    if (s) {
      if (Array.isArray(s.cols)) setCols(s.cols.filter((k) => columns.some((c) => c.key === k)));
      if (s.widths) setWidths(s.widths);
      if (s.leftW) setLeftW(s.leftW);
      if (s.zoom) setZoom(s.zoom);
    }
  }, [storeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (persist) write(storeKey, { cols, widths, leftW, zoom }); }, [persist, storeKey, cols, widths, leftW, zoom]);

  // which rows: kept activities and the nodes above them; the filter's matches and the rows above them; closed nodes hide what is under them
  const kept = useMemo(() => {
    if (!keep) return null;
    const ok = new Set();
    const parent = new Map(all.map((r) => [r.id, r.parentId]));
    for (const r of all) if (r.kind === "act" && keep(r.item)) for (let x = r.id; x && !ok.has(x); x = parent.get(x)) ok.add(x);
    return ok;
  }, [all, keep]);
  const filt = useMemo(() => filterTree(all.map((r) => ({ id: r.id, parentId: r.parentId, text: `${r.item.code} ${r.item.name}` })), q), [all, q]);
  const rows = useMemo(() => {
    const hidden = new Set();
    const out = [];
    for (const r of all) {
      if (r.parentId && hidden.has(r.parentId)) { hidden.add(r.id); continue; }
      if (kept && !kept.has(r.id)) { hidden.add(r.id); continue; }
      if (filt && !filt.visible.has(r.id)) { hidden.add(r.id); continue; }
      out.push(r);
      if (!filt && shut.has(r.id)) hidden.add(r.id);
    }
    return out;
  }, [all, kept, filt, shut]);
  const visibleActs = useMemo(() => rows.filter((r) => r.kind === "act").map((r) => r.item), [rows]);
  useEffect(() => { if (onVisible) onVisible(visibleActs); }, [visibleActs]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxLevel = all.reduce((m, r) => Math.max(m, r.level), 1);
  const openTo = (k) => setShut(new Set(all.filter((r) => r.kind === "node" && r.level >= k).map((r) => r.id)));
  const flip = (id) => setShut((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const hasKids = useMemo(() => new Set(all.map((r) => r.parentId).filter(Boolean)), [all]);

  // the two panes scroll together
  const left = useRef(null), right = useRef(null), syncing = useRef(false);
  const sync = (from, to) => () => {
    if (syncing.current) { syncing.current = false; return; }
    if (to.current && from.current && to.current.scrollTop !== from.current.scrollTop) { syncing.current = true; to.current.scrollTop = from.current.scrollTop; }
  };

  // dragging: the pane line, a column's edge
  const dragFrom = (e, start, apply) => {
    e.preventDefault();
    const x0 = e.clientX;
    const move = (ev) => apply(start + (ev.clientX - x0));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const shown = cols.map((k) => columns.find((c) => c.key === k)).filter(Boolean);
  const width = (c) => widths[c.key] || c.width || 100;

  // the chart's span: every date of every row, a few days either side
  const span = useMemo(() => {
    let lo = null, hi = null;
    for (const r of all) for (const k of ["plan_start", "plan_end", "actual_start", "actual_end"]) {
      const d = r.item[k];
      if (!d) continue;
      const t = ms(d);
      lo = lo === null ? t : Math.min(lo, t); hi = hi === null ? t : Math.max(hi, t);
    }
    if (lo === null) return null;
    return { lo: lo - 3 * DAY, hi: hi + 4 * DAY };
  }, [all]);
  const px = { day: 22, week: 7, month: 2.4 }[zoom];
  const xOf = (d) => ((ms(d) - span.lo) / DAY) * px;
  const chartW = span ? Math.max(((span.hi - span.lo) / DAY) * px, 300) : 300;
  const ticks = useMemo(() => {
    if (!span) return { months: [], marks: [] };
    const months = [], marks = [];
    for (let t = span.lo; t <= span.hi; t += DAY) {
      const d = new Date(t);
      if (d.getUTCDate() === 1 || t === span.lo) months.push({ x: ((t - span.lo) / DAY) * px, label: d.toLocaleDateString("fa-IR", { year: "numeric", month: "short", timeZone: "UTC" }) });
      if (zoom === "day") marks.push({ x: ((t - span.lo) / DAY) * px, label: d.toLocaleDateString("fa-IR", { day: "numeric", timeZone: "UTC" }), weekend: d.getUTCDay() === 5 });
      else if (zoom === "week" && d.getUTCDay() === 6) marks.push({ x: ((t - span.lo) / DAY) * px, label: d.toLocaleDateString("fa-IR", { day: "numeric", month: "numeric", timeZone: "UTC" }) });
    }
    return { months, marks };
  }, [span, px, zoom]);
  const today = new Date().toISOString().slice(0, 10);
  const rowIndex = new Map(rows.map((r, i) => [r.id, i]));

  const cell = (r, c) => {
    const v = c.get(r);
    // <bdi>: a name like "20-E-201 — CW cooler" keeps its own direction inside the RTL table
    if (c.hits && typeof v === "string") return c.key === "name" ? <bdi><Hl text={v} q={q} /></bdi> : <Hl text={v} q={q} />;
    return v;
  };
  const tint = (c) => (c ? `${c}22` : undefined);

  return (
    <div className="p6">
      <div className="p6-bar">
        <input className="p6-filter" type="search" placeholder="فیلتر: کد یا نام…" aria-label="فیلتر فعالیت‌ها" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="p6-levels" dir="ltr" aria-label="باز کردن تا سطح">
          {Array.from({ length: maxLevel }, (_, i) => i + 1).map((k) => <button key={k} type="button" className="btn ghost sm" data-level={k} onClick={() => openTo(k)} title={`تا سطح ${k}`}>{k}</button>)}
          <button type="button" className="btn ghost sm" onClick={() => setShut(new Set())} title="همه باز">⊞</button>
        </span>
        <span className="sm muted">{visibleActs.length} فعالیت</span>
        {gantt && <select aria-label="مقیاس گانت" value={zoom} onChange={(e) => setZoom(e.target.value)}>
          <option value="day">روز</option><option value="week">هفته</option><option value="month">ماه</option></select>}
        <span style={{ position: "relative" }}>
          <button type="button" className="btn ghost sm" onClick={() => setChooser(!chooser)} aria-expanded={chooser}>ستون‌ها ▾</button>
          {chooser && (
            <div className="p6-chooser card" role="dialog" aria-label="انتخاب ستون‌ها">
              {[...shown, ...columns.filter((c) => !cols.includes(c.key))].map((c) => {
                const on = cols.includes(c.key), i = cols.indexOf(c.key);
                return (
                  <div key={c.key} className="row" style={{ gap: 4, alignItems: "center" }}>
                    <label style={{ flex: 1 }}><input type="checkbox" checked={on} onChange={() => setCols(on ? cols.filter((k) => k !== c.key) : [...cols, c.key])} /> {c.title}</label>
                    {on && <>
                      <button type="button" className="btn ghost sm" disabled={i === 0} aria-label="بالا" onClick={() => { const n = [...cols]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setCols(n); }}>▲</button>
                      <button type="button" className="btn ghost sm" disabled={i === cols.length - 1} aria-label="پایین" onClick={() => { const n = [...cols]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setCols(n); }}>▼</button></>}
                  </div>);
              })}
              <p className="row" style={{ gap: 4 }}><button type="button" className="btn ghost sm" onClick={() => { setCols(defaultCols); setWidths({}); }}>پیش‌فرض</button>
                <button type="button" className="btn sm" onClick={() => setChooser(false)}>بستن</button></p>
            </div>)}
        </span>
        {toolbar}
      </div>
      <div className="p6-panes" dir="ltr">
        <div className="p6-left" ref={left} onScroll={sync(left, right)} style={{ width: gantt ? leftW : "100%" }}>
          <table className="p6-table" style={{ width: shown.reduce((s, c) => s + width(c), 0) }}>
            <colgroup>{shown.map((c) => <col key={c.key} style={{ width: width(c) }} />)}</colgroup>
            <thead><tr>{shown.map((c) => (
              <th key={c.key} dir="rtl" title={c.title}>{c.title}
                <span className="p6-colgrip" onMouseDown={(e) => dragFrom(e, width(c), (w) => setWidths((x) => ({ ...x, [c.key]: Math.max(40, Math.round(w)) })))} /></th>))}</tr></thead>
            <tbody>{rows.map((r) => {
              const isSel = r.id === selected;
              return (
                <tr key={r.id} data-row={r.item.code} data-kind={r.kind} className={isSel ? "sel" : undefined} onClick={() => onSelect && onSelect(r)}
                  style={{ height: ROW, background: r.kind === "node" ? tint(r.color) : undefined, fontWeight: r.kind === "node" ? 600 : undefined }}>
                  {shown.map((c, ci) => (
                    <td key={c.key} className={c.mono ? "mono" : undefined} dir={c.dir || (c.mono ? "ltr" : "rtl")}
                      style={ci === 0 ? { paddingLeft: 4 + (r.level - 1) * 14, borderLeft: `3px solid ${r.color || "transparent"}` } : undefined}>
                      {ci === 0 && (r.kind === "node"
                        ? <button type="button" className="p6-tog" aria-label={shut.has(r.id) ? "باز کردن" : "بستن"} onClick={(e) => { e.stopPropagation(); flip(r.id); }}
                          style={{ visibility: hasKids.has(r.id) ? "visible" : "hidden" }}>{shut.has(r.id) && !filt ? "▸" : "▾"}</button>
                        : <span className="p6-tog" aria-hidden="true">·</span>)}
                      {cell(r, c)}
                    </td>))}
                </tr>);
            })}</tbody>
          </table>
          {rows.length === 0 && <p className="empty-note" dir="rtl">ردیفی نیست.</p>}
        </div>
        {gantt && <>
          <div className="p6-vsplit" role="separator" aria-orientation="vertical" title="کشیدن برای تغییر پهنا" onMouseDown={(e) => dragFrom(e, leftW, (w) => setLeftW(Math.max(200, Math.round(w))))} />
          <div className="p6-right" ref={right} onScroll={sync(right, left)}>
            {!span ? <p className="empty-note" dir="rtl">هیچ ردیفی تاریخ ندارد؛ گانت خالی است.</p> : (
              <div style={{ width: chartW, position: "relative" }}>
                <div className="p6-ghead" style={{ width: chartW }}>
                  <div className="p6-months">{ticks.months.map((m) => <span key={m.x} style={{ left: m.x }}>{m.label}</span>)}</div>
                  <div className="p6-days">{ticks.marks.map((m) => <span key={m.x} style={{ left: m.x, width: zoom === "day" ? px : undefined }} className={m.weekend ? "we" : undefined}>{m.label}</span>)}</div>
                </div>
                <svg width={chartW} height={rows.length * ROW} className="p6-svg" role="img" aria-label="نمودار گانت">
                  <defs><marker id="p6-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="var(--dim)" /></marker></defs>
                  {rows.map((r, i) => <rect key={`bg${r.id}`} x={0} y={i * ROW} width={chartW} height={ROW} fill={r.id === selected ? "var(--cy-soft)" : i % 2 ? "var(--hover)" : "transparent"}
                    onClick={() => onSelect && onSelect(r)} />)}
                  {today >= new Date(span.lo).toISOString().slice(0, 10) && today <= new Date(span.hi).toISOString().slice(0, 10) &&
                    <line x1={xOf(today)} x2={xOf(today)} y1={0} y2={rows.length * ROW} stroke="var(--fld)" strokeDasharray="3 3" />}
                  {rows.map((r, i) => {
                    const a = r.item, y = i * ROW;
                    const bar = (s, e) => (s && e ? { x: xOf(s), w: Math.max(xOf(e) - xOf(s) + px, 2) } : null);
                    const plan = bar(a.plan_start, a.plan_end), act = bar(a.actual_start, a.actual_end);
                    if (r.kind === "node") return plan && (
                      <g key={r.id} data-gantt={a.code}><rect x={plan.x} y={y + 9} width={plan.w} height={6} fill={r.color} />
                        <path d={`M${plan.x},${y + 9} l0,10 l5,-4 z M${plan.x + plan.w},${y + 9} l0,10 l-5,-4 z`} fill={r.color} /></g>);
                    return (
                      <g key={r.id} data-gantt={a.code} onClick={() => onSelect && onSelect(r)}>
                        {plan && <rect x={plan.x} y={y + 5} width={plan.w} height={8} rx={2} fill="#3b82c4" opacity={0.85}><title>{`${a.code} — ${a.plan_start} → ${a.plan_end}`}</title></rect>}
                        {plan && a.pct != null && <rect x={plan.x} y={y + 5} width={(plan.w * Math.min(a.pct, 100)) / 100} height={8} rx={2} fill="#1f4f7a" />}
                        {act && <rect x={act.x} y={y + 15} width={act.w} height={6} rx={2} fill="#2fa36b"><title>{`واقعی ${a.actual_start} → ${a.actual_end}`}</title></rect>}
                      </g>);
                  })}
                  {(data.relations || []).map((rel) => {
                    const pi = rowIndex.get(rel.pred_id), si = rowIndex.get(rel.succ_id);
                    if (pi === undefined || si === undefined) return null;
                    const p = rows[pi].item, s = rows[si].item;
                    const fromEnd = rel.rel_type === "FS" || rel.rel_type === "FF", toEnd = rel.rel_type === "FF" || rel.rel_type === "SF";
                    const fd = fromEnd ? p.plan_end : p.plan_start, td = toEnd ? s.plan_end : s.plan_start;
                    if (!fd || !td) return null;
                    const x1 = xOf(fd) + (fromEnd ? px : 0), y1 = pi * ROW + 9, x2 = xOf(td) + (toEnd ? px : 0), y2 = si * ROW + 9;
                    const bend = fromEnd ? x1 + 6 : x1 - 6;
                    return <path key={rel.id} d={`M${x1},${y1} L${bend},${y1} L${bend},${y2} L${x2 + (toEnd ? 0 : -1)},${y2}`} fill="none" stroke="var(--dim)" strokeWidth={1} markerEnd="url(#p6-arrow)" />;
                  })}
                </svg>
              </div>)}
          </div></>}
      </div>
    </div>
  );
}

/** A height the user drags: the line between the activities and their details. */
export function useSplit(storeKey, initial = 420) {
  const [h, setH] = useState(initial);
  useEffect(() => { const v = read(`${storeKey}:h`, null); if (v) setH(v); }, [storeKey]);
  useEffect(() => { write(`${storeKey}:h`, h); }, [storeKey, h]);
  const grip = (
    <div className="p6-hsplit" role="separator" aria-orientation="horizontal" title="کشیدن برای تغییر ارتفاع"
      onMouseDown={(e) => {
        e.preventDefault();
        const y0 = e.clientY, h0 = h;
        const move = (ev) => setH(Math.max(160, Math.min(window.innerHeight - 120, h0 + ev.clientY - y0)));
        const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
        window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
      }} />);
  return { height: h, grip };
}
