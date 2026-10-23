"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { FloatBox, rowEdgeDown, rowEdgeHover } from "../ui/float";
import { createPortal } from "react-dom";
import { filterTree, splitHits } from "../../lib/eps/activities.mjs";
import { usePrefs } from "../../lib/client/prefs.mjs";
import { useEpsFmt } from "./ActivityDetail";
import { useCustomColumns, CustomColumns, showCustom } from "../ui/customColumns";

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
 *   onOpen      a double click on an activity row: onOpen(row) (the planning page adds it, as «add item single»)
 *   keep        optional (activity) → bool: only these activities (and the nodes above them) are shown
 *   onVisible   gets the activities shown now (after filter, keep and closing) whenever they change
 *   gantt       false to leave the chart out
 *   toolbar     extra elements for the toolbar
 *   persist     false: the columns follow `defaultCols` (they change with the data) and are not remembered
 *   customKey   the table's name for the project's own columns (components/ui/customColumns.jsx): shown after
 *               the page's, typed in with the row, «+ ستون» for the project's admin
 *   ops         what the page lets a person do to rows in place (owner's requirements 2026-10-18,
 *               items 4, 7, 9, 15) — every member optional:
 *                 fields(row)            the columns editable on this row: [{ key: column key, type: text|number|date }]
 *                 removable(rows)        of the rows picked, those `remove` deletes (the count the question names)
 *                 value(row)             the row's current values, by column key
 *                 save(row, values)      → truthy when saved
 *                 create(nodeRow, values) a new activity under a node, typed in a draft row
 *                 remove(rows)           delete
 *                 paste(nodeRow, rows, mode)  copy ("copy") or move ("cut") rows under a node
 *                 draftKind              "node": a row added under a node is a child node (the WBS page); else an activity
 *                 reorder(row, ±1)       a row moved above (−1) or below (+1) its sibling, from the row menu
 *                 reorderable(row)       which rows `reorder` takes (default: nodes)
 *               With `ops`, rows carry a checkbox (a node's takes its whole branch), a click
 *               opens the row for editing in place (leaving it changed asks to save or
 *               discard), and a right click opens copy / cut / paste / delete / add / edit.
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

export default function ActivityGrid({ data, columns: own, defaultCols, storeKey, selected, onSelect, onOpen = null, keep = null, onVisible = null, gantt = true, toolbar = null, persist = true, ops = null, customKey = null }) {
  const all = useMemo(() => flatRows(data.roots), [data]);
  const { t, locale } = usePrefs();
  // the project's own columns (owner's requirements 2026-10-22, item 7): shown after the page's, unless unticked; a row's value kept by its id
  const cc = useCustomColumns(customKey);
  const [colDlg, setColDlg] = useState(null);
  const [cfOff, setCfOff] = useState([]);
  const yesNo = { yes: t("tk.yes"), no: t("tk.no") };
  const cfCols = (cc.custom?.fields || []).map((f) => ({ key: `cf:${f.id}`, title: f.label, width: 110, mono: f.data_type === "number" || f.data_type === "date", field: f,
    get: (r) => (r.kind === "draft" ? "" : showCustom(yesNo, f, cc.custom.values.get(`${f.id}|${r.id}`))) }));
  const columns = [...own, ...cfCols];
  // what a column's get(row, x) writes with: numbers, dates and words in the reader's language
  const x = { ...useEpsFmt(), t };
  const [picked, setPicked] = useState(() => new Set());
  const [editing, setEditing] = useState(null);         // { id, row, values, orig, draftOf? }
  const [ask, setAsk] = useState(null);                 // leaving a changed row: { next }
  const [menu, setMenu] = useState(null);               // the right-click menu: { x, y, row }
  const [clip, setClip] = useState(null);               // { mode: copy|cut, rows }
  const [busy, setBusy] = useState(false);
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
      if (Array.isArray(s.cols)) setCols(s.cols.filter((k) => k.startsWith("cf:") || columns.some((c) => c.key === k)));
      if (Array.isArray(s.cfOff)) setCfOff(s.cfOff);
      if (s.widths) setWidths(s.widths);
      if (s.leftW) setLeftW(s.leftW);
      if (s.zoom) setZoom(s.zoom);
    }
  }, [storeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (persist) write(storeKey, { cols, widths, leftW, zoom, cfOff }); }, [persist, storeKey, cols, widths, leftW, zoom, cfOff]);

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
  // a new row being typed sits first under its node
  const shownRows = useMemo(() => {
    if (!editing?.draftOf) return rows;
    const i = rows.findIndex((r) => r.id === editing.draftOf.id);
    if (i < 0) return rows;
    const d = { kind: "draft", id: "__draft", parentId: editing.draftOf.id, level: editing.draftOf.level + 1, item: { code: "", name: "" }, color: editing.draftOf.color };
    return [...rows.slice(0, i + 1), d, ...rows.slice(i + 1)];
  }, [rows, editing]);
  const visibleActs = useMemo(() => rows.filter((r) => r.kind === "act").map((r) => r.item), [rows]);
  useEffect(() => { if (onVisible) onVisible(visibleActs); }, [visibleActs]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxLevel = all.reduce((m, r) => Math.max(m, r.level), 1);
  const openTo = (k) => setShut(new Set(all.filter((r) => r.kind === "node" && r.level >= k).map((r) => r.id)));
  const flip = (id) => setShut((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const hasKids = useMemo(() => new Set(all.map((r) => r.parentId).filter(Boolean)), [all]);

  // ── picking, editing in place, the right-click menu (only with `ops`) ──
  const under = useMemo(() => {
    const kids = new Map();
    for (const r of all) if (r.parentId) (kids.get(r.parentId) || kids.set(r.parentId, []).get(r.parentId)).push(r.id);
    return (id) => { const out = [id]; for (let i = 0; i < out.length; i++) out.push(...(kids.get(out[i]) || [])); return out; };
  }, [all]);
  // a node's box takes its whole branch: ticked when it is all ticked, and a click ticks or clears all of it
  const pick = (r) => setPicked((s) => {
    const ids = r.kind === "node" ? under(r.id) : [r.id];
    const n = new Set(s);
    const all2 = ids.every((x) => n.has(x));
    ids.forEach((x) => (all2 ? n.delete(x) : n.add(x)));
    return n;
  });
  const pickedRows = all.filter((r) => picked.has(r.id));
  const dirty = !!editing && JSON.stringify(editing.values) !== JSON.stringify(editing.orig);
  const guard = (next) => (dirty ? setAsk({ next }) : next());
  // a row's project columns are typed in with the rest, when the member may fill them
  const cfFields = (r) => (r.kind === "draft" || !cc.custom?.may?.fill ? [] : cfCols.map(({ key, field: f }) => (f.data_type === "list" || f.data_type === "bool"
    ? { key, type: "select", options: f.data_type === "bool" ? [["true", t("tk.yes")], ["false", t("tk.no")]] : f.options.map((o) => [o, o]) }
    : { key, type: f.data_type === "number" ? "number" : f.data_type === "date" ? "date" : "text" })));
  const fieldsOf = (r) => (ops?.fields ? [...(ops.fields(r) || []), ...cfFields(r)] : []);
  const edit = (r) => {
    if (!ops?.fields || !fieldsOf(r).length) { setEditing(null); return; }
    const v = { ...(ops.value ? ops.value(r) : {}), ...Object.fromEntries(cfFields(r).map((f) => [f.key, cc.custom.values.get(`${f.key.slice(3)}|${r.id}`) ?? ""])) };
    setEditing({ id: r.id, row: r, values: v, orig: v });
  };
  const open = (r) => guard(() => { onSelect && onSelect(r); edit(r); });
  const addUnder = (node) => guard(() => {
    if (!ops?.create) return;
    setShut((s) => { const n = new Set(s); n.delete(node.id); return n; });
    const blank = Object.fromEntries((ops.fields({ kind: ops.draftKind || "act", item: {} }) || []).map((f) => [f.key, ""]));
    setEditing({ id: "__draft", draftOf: node, row: { kind: "draft", item: {} }, values: blank, orig: blank });
  });
  const run = async (fn) => { setBusy(true); try { return await fn(); } finally { setBusy(false); } };
  // owner's requirements 2026-10-22, item 7: a row is written only once the person says so
  const save = async (ask = true) => {
    if (!editing) return true;
    if (ask && !window.confirm(t(editing.draftOf ? "gr.addAsk" : "gr.saveAsk"))) return false;
    const { values, orig } = editing;
    const own = Object.fromEntries(Object.entries(values).filter(([k]) => !k.startsWith("cf:")));
    const ownChanged = Object.keys(own).some((k) => own[k] !== orig[k]);
    const ok = await run(async () => {
      if (editing.draftOf) return ops.create(editing.draftOf, own);
      // the project's columns first, each on its own; then the row, if anything of its own changed
      for (const [k, v] of Object.entries(values)) {
        if (!k.startsWith("cf:") || v === orig[k]) continue;
        try { await cc.saveValue(cc.custom.fields.find((f) => f.id === k.slice(3)), editing.row.id, v); }
        catch (e) { window.alert(e.message); return false; }
      }
      return ownChanged ? ops.save(editing.row, own) : true;
    });
    if (ok) setEditing(null);
    return ok;
  };
  const nodeOf = (r) => (r.kind === "node" ? r : all.find((x) => x.id === r.parentId));
  const copyOut = (rowsToClip, mode) => {
    setClip({ mode, rows: rowsToClip });
    // what is copied is on the system clipboard too, as tab-separated text Excel takes
    const text = rowsToClip.map((r) => shown.map((c) => String(c.get(r, x) ?? "")).join("\t")).join("\n");
    try { navigator.clipboard?.writeText(text); } catch { /* not allowed here */ }
  };
  const removeRows = async (list) => {
    if (!list.length || !ops?.remove) return;
    // a page may delete only some of what is picked (the activities page: activities, never their nodes)
    const gone = ops.removable ? ops.removable(list) : list;
    if (!gone.length) { window.alert(t("gr.nothingToDelete")); return; }
    // what goes with a node goes too, and the question says how much
    const inside = new Set(gone.flatMap((r) => (r.kind === "node" ? under(r.id).slice(1) : [])));
    for (const r of gone) inside.delete(r.id);
    if (!window.confirm(inside.size ? t("gr.deleteAskTree", { n: gone.length, k: inside.size }) : t("gr.deleteAsk", { n: gone.length }))) return;
    if (await run(() => ops.remove(list))) { setPicked(new Set()); setEditing(null); }
  };
  const pasteInto = async (node) => {
    if (!clip || !node || !ops?.paste) return;
    if (await run(() => ops.paste(node, clip.rows, clip.mode))) { if (clip.mode === "cut") setClip(null); setPicked(new Set()); }
  };
  const exportExcel = async () => {
    // the tree as it shows, each row with its parent's code in the column before its own
    const XLSX = await import("xlsx");
    const code = new Map(all.map((r) => [r.id, r.item.code]));
    const head = [t("gr.level"), t("gr.parentCode"), t("gr.code"), ...shown.filter((c) => c.key !== "code").map((c) => t(c.title))];
    const body = rows.map((r) => [r.level, r.parentId ? code.get(r.parentId) || "" : "", r.item.code,
      ...shown.filter((c) => c.key !== "code").map((c) => { const v = c.get(r, x); return v == null ? "" : String(v); })]);
    const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "WBS");
    XLSX.writeFile(wb, `${storeKey || "tree"}.xlsx`);
  };

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
  const shown = [...cols.map((k) => columns.find((c) => c.key === k)).filter(Boolean), ...cfCols.filter((c) => !cols.includes(c.key) && !cfOff.includes(c.key))];
  const shownKeys = shown.map((c) => c.key);
  // the chooser sets the shown list as a whole: a project column left out is remembered as unticked
  const setShown = (n) => { setCols(n); setCfOff(cfCols.map((c) => c.key).filter((k) => !n.includes(k))); };
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
      if (d.getUTCDate() === 1 || t === span.lo) months.push({ x: ((t - span.lo) / DAY) * px, label: d.toLocaleDateString(locale, { year: "numeric", month: "short", timeZone: "UTC" }) });
      if (zoom === "day") marks.push({ x: ((t - span.lo) / DAY) * px, label: d.toLocaleDateString(locale, { day: "numeric", timeZone: "UTC" }), weekend: d.getUTCDay() === 5 });
      else if (zoom === "week" && d.getUTCDay() === 6) marks.push({ x: ((t - span.lo) / DAY) * px, label: d.toLocaleDateString(locale, { day: "numeric", month: "numeric", timeZone: "UTC" }) });
    }
    return { months, marks };
  }, [span, px, zoom, locale]);
  const today = new Date().toISOString().slice(0, 10);
  const rowIndex = new Map(shownRows.map((r, i) => [r.id, i]));

  const cell = (r, c) => {
    const v = c.get(r, x);
    // <bdi>: a name like "20-E-201 — CW cooler" keeps its own direction inside the RTL table
    if (c.hits && typeof v === "string") return c.key === "name" ? <bdi><Hl text={v} q={q} /></bdi> : <Hl text={v} q={q} />;
    return v;
  };
  const tint = (c) => (c ? `${c}22` : undefined);

  return (
    <div className="p6">
      <div className="p6-bar" data-p6-bar>
        <input className="p6-filter" type="search" placeholder={t("ep.g.filter")} aria-label={t("ep.g.filterLabel")} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="p6-levels" dir="ltr" aria-label={t("ep.g.levels")}>
          {Array.from({ length: maxLevel }, (_, i) => i + 1).map((k) => <button key={k} type="button" className="btn ghost sm" data-level={k} onClick={() => openTo(k)} title={t("ep.g.toLevel", { k })}>{k}</button>)}
          <button type="button" className="btn ghost sm" onClick={() => setShut(new Set())} title={t("ep.g.openAll")}>⊞</button>
        </span>
        <span className="sm muted">{t("ep.g.count", { n: visibleActs.length })}</span>
        {gantt && <select aria-label={t("ep.g.zoom")} value={zoom} onChange={(e) => setZoom(e.target.value)}>
          <option value="day">{t("ep.g.day")}</option><option value="week">{t("ep.g.week")}</option><option value="month">{t("ep.g.month")}</option></select>}
        <span style={{ position: "relative" }}>
          <button type="button" className="btn ghost sm" onClick={() => setChooser(!chooser)} aria-expanded={chooser}>{t("ep.g.columns")} ▾</button>
          {chooser && (
            <FloatBox className="p6-chooser card" role="dialog" aria-label={t("ep.g.chooseColumns")} onClose={() => setChooser(false)}>
              {[...shown, ...columns.filter((c) => !shownKeys.includes(c.key))].map((c) => {
                const on = shownKeys.includes(c.key), i = shownKeys.indexOf(c.key);
                return (
                  <div key={c.key} className="row" style={{ gap: 4, alignItems: "center" }} data-chooser-col={c.key}>
                    {on && <span className="sm muted" style={{ cursor: "grab", padding: "0 2px", touchAction: "none" }} aria-hidden="true" data-col-grip
                      // dragged by this handle onto another shown column, it takes that one's place
                      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); const up = (u) => { window.removeEventListener("pointerup", up);
                        const k = document.elementFromPoint(u.clientX, u.clientY)?.closest?.("[data-chooser-col]")?.dataset.chooserCol;
                        if (!k || k === c.key || !shownKeys.includes(k)) return;
                        const n = shownKeys.filter((x) => x !== c.key); n.splice(n.indexOf(k) + (i < shownKeys.indexOf(k) ? 1 : 0), 0, c.key); setShown(n); };
                        window.addEventListener("pointerup", up); }}>⠿</span>}
                    <label style={{ flex: 1 }}><input type="checkbox" checked={on} onChange={() => setShown(on ? shownKeys.filter((k) => k !== c.key) : [...shownKeys, c.key])} /> {t(c.title)}</label>
                    {on && <>
                      <button type="button" className="btn ghost sm" disabled={i === 0} aria-label={t("ep.g.up")} onClick={() => { const n = [...shownKeys]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setShown(n); }}>▲</button>
                      <button type="button" className="btn ghost sm" disabled={i === shownKeys.length - 1} aria-label={t("ep.g.down")} onClick={() => { const n = [...shownKeys]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setShown(n); }}>▼</button></>}
                  </div>);
              })}
              <p className="row" style={{ gap: 4 }}><button type="button" className="btn ghost sm" onClick={() => { setCols(defaultCols); setCfOff([]); setWidths({}); }}>{t("ep.g.default")}</button>
                <button type="button" className="btn sm" onClick={() => setChooser(false)}>{t("ep.close")}</button></p>
            </FloatBox>)}
        </span>
        <button type="button" className="btn ghost sm" data-excel onClick={exportExcel}>{t("gr.excel")}</button>
        {customKey && cc.custom?.may?.define && <button type="button" className="btn ghost sm" data-tk-addcol onClick={() => setColDlg(colDlg ? null : { label: "", dataType: "text", options: "" })}>{t("tk.addColumn")}</button>}
        {ops && picked.size > 0 && (
          <span className="p6-bulk" data-bulk>
            <b className="sm">{t("gr.picked", { n: picked.size })}</b>
            <button type="button" className="btn ghost sm" onClick={() => copyOut(pickedRows, "copy")}>{t("gr.copy")}</button>
            {ops.paste && <button type="button" className="btn ghost sm" onClick={() => copyOut(pickedRows, "cut")}>{t("gr.cut")}</button>}
            {ops.remove && <button type="button" className="btn ghost sm" data-bulk-delete onClick={() => removeRows(pickedRows)}>{t("gr.delete")}</button>}
            <button type="button" className="btn ghost sm" onClick={() => setPicked(new Set())}>{t("gr.clear")}</button></span>)}
        {ops && clip && <span className="sm muted" data-clip>{t("gr.clipped", { n: clip.rows.length, mode: t(clip.mode === "cut" ? "gr.cut" : "gr.copy") })}</span>}
        {toolbar}
      </div>
      {colDlg && <CustomColumns custom={cc.custom} dlg={colDlg} setDlg={setColDlg} platform={cc.platform} name={customKey} reload={cc.reload} />}
      <div className="p6-panes" dir="ltr">
        <div className="p6-left" ref={left} onScroll={sync(left, right)} style={{ width: gantt ? leftW : "100%" }}>
          <table className="p6-table" style={{ width: shown.reduce((s, c) => s + width(c), 0) + (ops ? 28 : 0) }}
            // rows take a height of their own only without the Gantt beside them, whose bars keep to the row grid
            onPointerDownCapture={gantt ? undefined : (e) => rowEdgeDown(e)} onPointerMove={gantt ? undefined : rowEdgeHover}>
            <colgroup>{ops && <col style={{ width: 28 }} />}{shown.map((c) => <col key={c.key} style={{ width: width(c) }} />)}</colgroup>
            <thead><tr>{ops && <th className="p6-pick"><input type="checkbox" aria-label={t("gr.pickAll")} checked={rows.length > 0 && rows.every((r) => picked.has(r.id))}
              onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>}{shown.map((c) => (
              <th key={c.key} dir="auto" title={t(c.tip || c.title)}>{t(c.title)}
                <span className="p6-colgrip" onMouseDown={(e) => dragFrom(e, width(c), (w) => setWidths((x) => ({ ...x, [c.key]: Math.max(40, Math.round(w)) })))} /></th>))}</tr></thead>
            <tbody>{shownRows.map((r) => {
              const isSel = r.id === selected;
              const ed = editing && editing.id === r.id ? editing : null;
              const fs = ed ? (r.kind === "draft" ? ops.fields({ kind: ops.draftKind || "act", item: {} }) : fieldsOf(r)) : [];
              const field = (key) => fs.find((f) => f.key === key);
              return (
                <tr key={r.id} data-row={r.item.code || (r.kind === "draft" ? "__draft" : "")} data-kind={r.kind} className={[isSel ? "sel" : "", ed ? "p6-editing" : ""].join(" ").trim() || undefined}
                  onClick={(e) => { if (e.target.closest("input,select,button,textarea")) return; if (r.kind === "draft" || ed) return; ops ? open(r) : onSelect && onSelect(r); }}
                  onDoubleClick={onOpen ? (e) => { if (e.target.closest("input,select,button,textarea") || r.kind !== "act") return; onOpen(r); } : undefined}
                  onContextMenu={ops && r.kind !== "draft" ? (e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, row: r }); } : undefined}
                  style={{ height: ROW, background: r.kind === "node" ? tint(r.color) : undefined, fontWeight: r.kind === "node" ? 600 : undefined }}>
                  {ops && <td className="p6-pick">{r.kind !== "draft" && <input type="checkbox" aria-label={t("gr.pickRow", { code: r.item.code })}
                    checked={r.kind === "node" ? under(r.id).every((x) => picked.has(x)) : picked.has(r.id)} onChange={() => pick(r)}
                    // part of a node's branch picked: half-ticked; a click then picks the whole branch
                    ref={(el) => { if (el) el.indeterminate = r.kind === "node" && !under(r.id).every((x) => picked.has(x)) && under(r.id).some((x) => picked.has(x)); }} />}</td>}
                  {shown.map((c, ci) => (
                    <td key={c.key} className={c.mono ? "mono" : undefined} dir={c.dir || (c.mono ? "ltr" : "rtl")}
                      style={ci === 0 ? { paddingLeft: 4 + (r.level - 1) * 14, borderLeft: `3px solid ${r.color || "transparent"}` } : undefined}>
                      {ci === 0 && (r.kind === "node"
                        ? <button type="button" className="p6-tog" aria-label={t(shut.has(r.id) ? "ep.g.open" : "ep.close")} onClick={(e) => { e.stopPropagation(); flip(r.id); }}
                          style={{ visibility: hasKids.has(r.id) ? "visible" : "hidden" }}>{shut.has(r.id) && !filt ? "▸" : "▾"}</button>
                        : <span className="p6-tog" aria-hidden="true">·</span>)}
                      {ed && field(c.key)?.type === "select" ? (
                        <select className="p6-in" aria-label={t(c.title)} value={ed.values[c.key] ?? ""} onChange={(e) => setEditing({ ...ed, values: { ...ed.values, [c.key]: e.target.value } })}>
                          <option value="">—</option>{field(c.key).options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                      ) : ed && field(c.key) ? (
                        <input className="p6-in" aria-label={t(c.title)} type={field(c.key).type === "number" ? "number" : field(c.key).type === "date" ? "date" : "text"}
                          step="any" dir={field(c.key).type === "text" ? "auto" : "ltr"} value={ed.values[c.key] ?? ""}
                          onChange={(e) => setEditing({ ...ed, values: { ...ed.values, [c.key]: e.target.value } })}
                          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(null); }} />
                      ) : r.kind === "draft" ? (ci === 0 ? <span className="muted">{t("gr.newRow")}</span> : null) : cell(r, c)}
                      {ed && ci === 0 && (
                        <span className="p6-edbtns">
                          <button type="button" className="btn sm" disabled={busy} data-row-save onClick={save}>{t("gr.save")}</button>
                          <button type="button" className="btn ghost sm" onClick={() => setEditing(null)}>{t("gr.cancel")}</button>
                          {r.kind !== "draft" && ops.remove && <button type="button" className="btn ghost sm" onClick={() => removeRows([r])}>{t("gr.delete")}</button>}
                        </span>)}
                    </td>))}
                </tr>);
            })}</tbody>
          </table>
          {rows.length === 0 && <p className="empty-note">{t("ep.g.noRows")}</p>}
          {menu && typeof document !== "undefined" && createPortal(
            <FloatBox className="p6-menu card" role="menu" aria-label={t("gr.menu")} style={{ left: menu.x, top: menu.y }} onClose={() => setMenu(null)} onClick={(e) => e.stopPropagation()} data-row-menu>
              {fieldsOf(menu.row).length > 0 && <button type="button" role="menuitem" onClick={() => { setMenu(null); open(menu.row); }}>{t("gr.edit")}</button>}
              {ops.create && <button type="button" role="menuitem" onClick={() => { const n = nodeOf(menu.row); setMenu(null); if (n) addUnder(n); }}>{t("gr.addChild", { name: nodeOf(menu.row)?.item.name || "" })}</button>}
              {ops.reorder && (ops.reorderable ? ops.reorderable(menu.row) : menu.row.kind === "node") && <>
                <button type="button" role="menuitem" data-move-up onClick={() => { const r = menu.row; setMenu(null); run(() => ops.reorder(r, -1)); }}>{t("gr.moveUp")}</button>
                <button type="button" role="menuitem" data-move-down onClick={() => { const r = menu.row; setMenu(null); run(() => ops.reorder(r, 1)); }}>{t("gr.moveDown")}</button></>}
              <button type="button" role="menuitem" onClick={() => { copyOut(picked.has(menu.row.id) ? pickedRows : [menu.row], "copy"); setMenu(null); }}>{t("gr.copy")}</button>
              {ops.paste && <button type="button" role="menuitem" onClick={() => { copyOut(picked.has(menu.row.id) ? pickedRows : [menu.row], "cut"); setMenu(null); }}>{t("gr.cut")}</button>}
              {ops.paste && <button type="button" role="menuitem" disabled={!clip} onClick={() => { const n = nodeOf(menu.row); setMenu(null); pasteInto(n); }}>{t("gr.pasteInto", { name: nodeOf(menu.row)?.item.name || "" })}</button>}
              {ops.remove && <button type="button" role="menuitem" onClick={() => { const l = picked.has(menu.row.id) ? pickedRows : [menu.row]; setMenu(null); removeRows(l); }}>{t("gr.delete")}</button>}
            </FloatBox>, document.body)}
          {ask && typeof document !== "undefined" && createPortal(
            <div className="p6-ask card" role="alertdialog" aria-label={t("gr.leaveTitle")} data-leave-ask>
              <b>{t("gr.leaveTitle")}</b>
              <p className="row" style={{ gap: 6, marginTop: 8 }}>
                <button type="button" className="btn sm" onClick={async () => { const nx = ask.next; setAsk(null); if (await save(false)) nx(); }}>{t("gr.leaveSave")}</button>
                <button type="button" className="btn ghost sm" onClick={() => { const nx = ask.next; setAsk(null); setEditing(null); nx(); }}>{t("gr.leaveDrop")}</button></p>
            </div>, document.body)}
        </div>
        {gantt && <>
          <div className="p6-vsplit" role="separator" aria-orientation="vertical" title={t("ep.g.dragWidth")} onMouseDown={(e) => dragFrom(e, leftW, (w) => setLeftW(Math.max(200, Math.round(w))))} />
          <div className="p6-right" ref={right} onScroll={sync(right, left)}>
            {!span ? <p className="empty-note">{t("ep.g.noDates")}</p> : (
              <div style={{ width: chartW, position: "relative" }}>
                <div className="p6-ghead" style={{ width: chartW }}>
                  <div className="p6-months">{ticks.months.map((m) => <span key={m.x} style={{ left: m.x }}>{m.label}</span>)}</div>
                  <div className="p6-days">{ticks.marks.map((m) => <span key={m.x} style={{ left: m.x, width: zoom === "day" ? px : undefined }} className={m.weekend ? "we" : undefined}>{m.label}</span>)}</div>
                </div>
                <svg width={chartW} height={shownRows.length * ROW} className="p6-svg" role="img" aria-label={t("ep.g.gantt")}>
                  <defs><marker id="p6-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="var(--dim)" /></marker></defs>
                  {shownRows.map((r, i) => <rect key={`bg${r.id}`} x={0} y={i * ROW} width={chartW} height={ROW} fill={r.id === selected ? "var(--cy-soft)" : i % 2 ? "var(--hover)" : "transparent"}
                    onClick={() => onSelect && onSelect(r)} />)}
                  {today >= new Date(span.lo).toISOString().slice(0, 10) && today <= new Date(span.hi).toISOString().slice(0, 10) &&
                    <line x1={xOf(today)} x2={xOf(today)} y1={0} y2={shownRows.length * ROW} stroke="var(--fld)" strokeDasharray="3 3" />}
                  {shownRows.map((r, i) => {
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
                        {act && <rect x={act.x} y={y + 15} width={act.w} height={6} rx={2} fill="#2fa36b"><title>{t("ep.g.actualBar", { from: a.actual_start, to: a.actual_end })}</title></rect>}
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
  const { t } = usePrefs();
  const [h, setH] = useState(initial);
  useEffect(() => { const v = read(`${storeKey}:h`, null); if (v) setH(v); }, [storeKey]);
  useEffect(() => { write(`${storeKey}:h`, h); }, [storeKey, h]);
  const grip = (
    <div className="p6-hsplit" role="separator" aria-orientation="horizontal" title={t("ep.g.dragHeight")}
      onMouseDown={(e) => {
        e.preventDefault();
        const y0 = e.clientY, h0 = h;
        const move = (ev) => setH(Math.max(160, Math.min(window.innerHeight - 120, h0 + ev.clientY - y0)));
        const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
        window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
      }} />);
  return { height: h, grip };
}
