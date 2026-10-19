"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * Search, filter, sort, export — and three ways to look at any table on the
 * platform: the page's own table, a data grid, or cards.
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
 *
 * The views (the person's default is a setting; each table remembers its
 * own, per browser, under `epc.tk.<name>`):
 *
 *   table  the page's table as designed: search, filter, sort (Shift+click
 *          for several columns), export.
 *   grid   a data grid. Columns are hidden, pinned, moved (drag a heading)
 *          and resized (drag its edge) without touching the cells React
 *          owns: the table becomes a CSS grid whose rows are subgrids, and
 *          each column's place, width and visibility is a rule in a style
 *          sheet scoped to this table. Each heading's menu (⋮, or a right
 *          click) sorts, filters by value, text or range, totals (sum,
 *          average, min, max, count), pins, hides and groups. Groups are
 *          rows this kit adds and folds; totals are a footer it adds;
 *          pages hide the rest with `data-tk-off`.
 *   cards  one card per row, each value beside its column's heading, with
 *          the same columns, groups, totals and pages as the grid.
 *
 * Row actions. A click on a row selects it (clicks on its own buttons,
 * links and fields do not); the bar then offers:
 *   - «مشاهده» on every table: the row as a card, each column's heading
 *     beside its value (`view(key)` may add more below);
 *   - «ویرایش» when the page passes `onEdit(key)`;
 *   - «حذف» when the page passes `onDelete(key)`, asked for confirmation
 *     first.
 * The key is the row's `data-key`. `canEdit(key)` / `canDelete(key)` return
 * true or the reason the action is not open for that row — a signed or
 * evidence record is revised or revoked, never deleted, and the disabled
 * button says so rather than disappearing.
 *
 * Several rows (owner's requirements 2026-10-18, items 4, 7, 15). Every row
 * has a box at the start of its first cell (and the heading one for all the
 * rows shown); Ctrl- or Shift-click picks too. The picked rows are copied
 * (tab-separated, as Excel pastes), cut or deleted together — cut and delete
 * when the page passes `onDelete`, paste when it passes `onPaste(rows)`. A
 * right click on a row opens the same actions for it.
 *
 * Editing a row in place, when the page passes `rowEdit`:
 *   { fields: [{ col: heading text, name, type: text|number|date|select, options: [[value, label]] }],
 *     value(key) → { name: value }, onSave(key, values) → truthy, onAdd(values) → truthy (optional) }
 * A click on a row opens it for editing where it stands — framed and written
 * in blue, its editable cells as fields, with save, cancel and delete; no
 * dialog opens. Leaving it changed asks whether to save or discard. With
 * `onAdd`, a «+» under the last row opens a new row the same way.
 */
export default function TableKit({ children, name = "table", min = 1, onEdit, onDelete, canEdit, canDelete, checkDelete, view, editLabel, deleteLabel, onPaste, rowEdit }) {
  const { t, num, prefs, dir } = usePrefs();
  editLabel = editLabel || t("tk.edit");
  deleteLabel = deleteLabel || t("tk.delete");
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const box = useRef(null);
  const st = useRef({ orig: [], tbody: null, observer: null, grp: new Map(), foot: null });
  const [lay, setLay, resetLay] = useLayout(name);
  const mode = lay.mode || prefs.grid || "table";
  const rich = mode !== "table";
  const [q, setQ] = useState("");
  const [col, setCol] = useState("");
  const [val, setVal] = useState("");
  const [filters, setFilters] = useState({});            // column key → { vals?, text?, from?, to? }
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [page, setPage] = useState(0);
  const [meta, setMeta] = useState({ heads: [], total: 0, shown: 0, values: [], pages: 1, pg: 0 });
  const [pinOff, setPinOff] = useState({});
  const [live, setLive] = useState(null);                 // a column being resized: { key, w }
  const [menu, setMenu] = useState(null);                 // a column's menu: { key, rect }
  const [chooser, setChooser] = useState(null);           // the columns panel: { rect }
  const [sel, setSel] = useState(null);                   // { row, key } — the selected main row
  const [dialog, setDialog] = useState(null);             // "view" | "delete"
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [probe, setProbe] = useState(null);               // null | "…" | true | "why not"
  const [picks, setPicks] = useState(0);                  // how many rows are picked (the rows: st.current.picks)
  const [rowMenu, setRowMenu] = useState(null);           // a row's right-click menu: { x, y, row }
  const [clip, setClip] = useState(null);                 // rows copied or cut: [[cell…]…]
  const [ed, setEd] = useState(null);                     // a row open for editing: { row|null (new), key, values, orig, tr }
  const [leave, setLeave] = useState(null);               // leaving a changed row: { next }

  const heads = meta.heads;
  const disp = useMemo(() => displayOrder(heads, lay), [heads, lay]);

  const apply = useCallback(() => {
    const table = box.current?.querySelector("table");
    const tbody = table?.tBodies?.[0];
    if (!tbody) { setMeta((m) => (m.total ? { heads: [], total: 0, shown: 0, values: [], pages: 1, pg: 0 } : m)); return; }
    const s = st.current;
    const obs = s.observer;
    // Records first: disconnect() drops whatever is still queued.
    if (obs) { absorb(s, obs.takeRecords()); obs.disconnect(); }
    if (s.tbody !== tbody) { s.tbody = tbody; s.orig = [...tbody.rows].filter(own); s.grp = new Map(); s.foot = null; }
    // Keep the tracked order to the rows that exist (a re-render may have
    // replaced some without a record we saw).
    const inDom = new Set(tbody.rows);
    s.orig = s.orig.filter((r) => inDom.has(r));
    if (s.picks) for (const r of [...s.picks]) if (!inDom.has(r)) s.picks.delete(r);
    const have = new Set(s.orig);
    for (const r of tbody.rows) if (own(r) && !have.has(r)) s.orig.push(r);

    const headCells = [...(table.tHead?.rows?.[0]?.cells || [])];
    const used = new Set();
    const hs = headCells.map((c, i) => {
      const label = c.textContent.replace(/\s+/g, " ").trim();
      let key = label || `#${i + 1}`;
      if (used.has(key)) key = `${key}#${i + 1}`;
      used.add(key);
      return { i, key, label };
    });
    const idx = new Map(hs.map((h) => [h.key, h.i]));
    const order = rich ? displayOrder(hs, lay) : hs.map((h) => h.key);
    setSel((cur) => (cur && !inDom.has(cur.row) ? null : cur));

    const groups = [];
    for (const r of s.orig) {
      const detail = isDetail(r);
      flag(r, "tkDetail", detail);
      if (detail && groups.length) groups[groups.length - 1].rest.push(r);
      else groups.push({ main: r, rest: [] });
    }
    if (mode === "cards") {
      for (const g of groups) [...g.main.cells].forEach((c, k) => { const l = hs[k]?.label || ""; if (c.dataset.tkLabel !== l) c.dataset.tkLabel = l; });
    }

    // Filter: the search, the quick column filter, and each column's own.
    const needle = norm(q);
    const ci = col === "" ? -1 : Number(col);
    const fl = Object.entries(filters).map(([k, f]) => [idx.get(k), f]).filter(([i, f]) => i !== undefined && active(f));
    let shown = 0;
    for (const g of groups) {
      const ok = (!needle || norm(g.main.textContent).includes(needle))
        && (ci < 0 || val === "" || cellOf(g.main, ci) === val)
        && fl.every(([i, f]) => passes(cellOf(g.main, i), f));
      g.ok = ok;
      g.main.hidden = !ok;
      for (const r of g.rest) r.hidden = !ok;
      if (ok) shown++;
    }

    // Order: React's, or sorted on one or more columns — groups move whole.
    const sorts = (lay.sort || []).map((x) => ({ i: idx.get(x.k), dir: x.dir })).filter((x) => x.i !== undefined);
    const ordered = sorts.length ? [...groups].sort((a, b) => {
      for (const x of sorts) { const c = compare(cellOf(a.main, x.i), cellOf(b.main, x.i)); if (c) return x.dir * c; }
      return 0;
    }) : groups;

    // Groups by a column's value (grid and cards).
    const gi = rich && lay.group ? idx.get(lay.group) : undefined;
    let buckets;
    if (gi !== undefined) {
      const m = new Map();
      for (const g of ordered) { const v = cellOf(g.main, gi); (m.get(v) || m.set(v, []).get(v)).push(g); }
      const gdir = sorts[0]?.i === gi ? sorts[0].dir : 1;
      buckets = [...m.entries()].sort((a, b) => gdir * compare(a[0], b[0])).map(([v, gs]) => ({ v, gs }));
    } else buckets = [{ v: null, gs: ordered }];

    // Pages (grid and cards): rows off the page carry data-tk-off.
    const size = rich ? Number(lay.size) || 0 : 0;
    const visible = buckets.flatMap((b) => b.gs.filter((g) => g.ok && !(gi !== undefined && collapsed.has(b.v))));
    const pages = size ? Math.max(1, Math.ceil(visible.length / size)) : 1;
    const pg = Math.min(page, pages - 1);
    const onPage = new Set(size ? visible.slice(pg * size, pg * size + size) : visible);
    for (const b of buckets) for (const g of b.gs) {
      const off = g.ok && !onPage.has(g);
      flag(g.main, "tkOff", off);
      for (const r of g.rest) flag(r, "tkOff", off);
    }

    // Totals: each column's chosen figure over the filtered rows.
    const aggs = rich ? Object.entries(lay.aggs || {}).filter(([k, f]) => idx.has(k) && f && f !== "none") : [];
    const figure = (rows, i, f) => aggregate(rows.map((g) => cellOf(g.main, i)), f, (v) => num(v, { maximumFractionDigits: 2 }));
    const firstShown = order[0] !== undefined ? idx.get(order[0]) : 0;

    const want = [];
    const keepGrp = new Set();
    for (const b of buckets) {
      if (gi !== undefined) {
        const tr = groupRow(s, b.v, hs.length);
        keepGrp.add(tr);
        const okRows = b.gs.filter((g) => g.ok);
        const shut = collapsed.has(b.v);
        tr.hidden = !okRows.length || (!shut && !okRows.some((g) => onPage.has(g)));
        tr.dataset.tkShut = shut ? "1" : "0";
        const cells = [...tr.cells];
        cells.forEach((c, k) => {
          const f = lay.aggs?.[hs[k]?.key];
          const text = k === firstShown
            ? `${shut ? "▸" : "▾"} ${hs[gi].label || hs[gi].key}: ${b.v || t("tk.empty")} · ${t("tk.groupRows", { n: num(okRows.length) })}`
            : f && f !== "none" ? figure(okRows, k, f) : "";
          if (c.textContent !== text) c.textContent = text;
        });
        want.push(tr);
      }
      for (const g of b.gs) { want.push(g.main, ...g.rest); if (s.editTr && s.editFor === g.main) want.push(s.editTr); }
    }
    if (s.editTr && !s.editFor) want.push(s.editTr);           // a new row: last
    for (const [v, tr] of s.grp) if (!keepGrp.has(tr)) { tr.remove(); s.grp.delete(v); }
    if (want.length !== tbody.rows.length || want.some((r, k) => tbody.rows[k] !== r)) for (const r of want) tbody.appendChild(r);

    if (aggs.length) {
      const foot = footRow(s, table, hs.length);
      const okRows = groups.filter((g) => g.ok);
      [...foot.rows[0].cells].forEach((c, k) => {
        const f = lay.aggs?.[hs[k]?.key];
        const text = f && f !== "none" ? figure(okRows, k, f) : k === firstShown ? t("tk.totals") : "";
        if (c.textContent !== text) c.textContent = text;
        const l = f && f !== "none" ? `${hs[k]?.label || ""} · ${t(`tk.agg.${f}`)}` : "";
        if (c.dataset.tkLabel !== l) c.dataset.tkLabel = l;
      });
    } else if (s.foot) { s.foot.remove(); s.foot = null; }

    // Headings: sort state, filters, and in the grid a drag handle.
    headCells.forEach((th, k) => {
      if (!hs[k].label) return;
      th.classList.add("tk-sort");
      const si = sorts.findIndex((x) => x.i === k);
      th.classList.toggle("asc", si >= 0 && sorts[si].dir === 1);
      th.classList.toggle("desc", si >= 0 && sorts[si].dir === -1);
      if (sorts.length > 1 && si >= 0) th.dataset.tkSortN = String(si + 1); else delete th.dataset.tkSortN;
      th.classList.toggle("tk-filtered", fl.some(([i]) => i === k));
      const drag = mode === "grid";
      if (th.draggable !== drag) th.draggable = drag;
    });
    const values = ci >= 0
      ? [...new Set(groups.map((g) => cellOf(g.main, ci)).filter(Boolean))].sort((a, b) => compare(a, b)).slice(0, 80)
      : [];
    setMeta((m) => (m.total === groups.length && m.shown === shown && m.pages === pages && m.pg === pg
      && m.heads.map((h) => h.key).join("|") === hs.map((h) => h.key).join("|") && m.values.join("|") === values.join("|")
      ? m : { heads: hs, total: groups.length, shown, values, pages, pg }));

    // Pinned columns: each one's offset is the width of the pinned ones before it.
    if (mode === "grid" && lay.pinned?.length) {
      const offs = {};
      let x = 0;
      for (const k of order) {
        if (!lay.pinned.includes(k)) break;
        offs[k] = Math.round(x);
        x += headCells[idx.get(k)].getBoundingClientRect().width;
      }
      setPinOff((p) => (JSON.stringify(p) === JSON.stringify(offs) ? p : offs));
    }
    if (obs) {
      obs.takeRecords();
      obs.observe(box.current, { childList: true, subtree: true, characterData: true });
    }
  }, [q, col, val, filters, lay, mode, rich, collapsed, page, t, num]);

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

  // Back to the first page when what is shown changes.
  useEffect(() => { setPage(0); }, [q, col, val, filters, lay.group, lay.size]);

  // ── sorting, a column's menu, resizing, moving ─────────────────────────
  const sortBy = (key, dir, add) => setLay((l) => {
    const cur = l.sort || [];
    if (dir === 0) return { ...l, sort: cur.filter((x) => x.k !== key) };
    if (dir) return { ...l, sort: add ? [...cur.filter((x) => x.k !== key), { k: key, dir }] : [{ k: key, dir }] };
    const was = cur.find((x) => x.k === key);
    const next = !was ? 1 : was.dir === 1 ? -1 : 0;
    const rest = add ? cur.filter((x) => x.k !== key) : [];
    if (!next) return { ...l, sort: rest };
    return { ...l, sort: add && was ? cur.map((x) => (x.k === key ? { k: key, dir: next } : x)) : [...rest, { k: key, dir: next }] };
  });

  const headOf = (e) => {
    const th = e.target.closest("th");
    if (!th || !box.current?.contains(th) || !th.closest("thead") || th.closest("table") !== box.current.querySelector("table")) return null;
    const h = heads[th.cellIndex];
    return h ? { th, h } : null;
  };
  // Where in a heading the pointer is: its far edge resizes, the ⋮ beside it opens the menu.
  const zone = (th, x) => {
    const r = th.getBoundingClientRect();
    const d = dir === "rtl" ? x - r.left : r.right - x;
    return d <= 6 ? "edge" : d <= 26 ? "menu" : "sort";
  };

  function onHeadClick(e) {
    const hit = headOf(e);
    if (hit && hit.th.cellIndex === 0 && inBox(hit.th, e.clientX, dir)) { pickAll(); return; }
    if (!hit || !hit.h.label) return;
    if (mode === "grid") {
      const z = zone(hit.th, e.clientX);
      if (z === "edge") return;
      if (z === "menu") { setMenu({ key: hit.h.key, rect: hit.th.getBoundingClientRect() }); return; }
    }
    sortBy(hit.h.key, null, e.shiftKey);
  }
  function onContext(e) {
    const tr = e.target.closest?.("tbody tr");
    if (tr && box.current?.contains(tr) && !tr.classList.contains("tk-grp") && !tr.classList.contains("tk-edit") && !isDetail(tr)
      && tr.closest("table") === box.current.querySelector("table")) {
      e.preventDefault();
      setRowMenu({ x: e.clientX, y: e.clientY, row: tr });
      return;
    }
    if (mode !== "grid") return;
    const hit = headOf(e);
    if (!hit) return;
    e.preventDefault();
    setMenu({ key: hit.h.key, rect: hit.th.getBoundingClientRect() });
  }
  function onDown(e) {
    if (mode !== "grid" || e.button !== 0) return;
    const hit = headOf(e);
    if (!hit || zone(hit.th, e.clientX) !== "edge") return;
    e.preventDefault();                                  // no text selection
    st.current.resizing = true;                          // and no column drag (onDragStart)
    const x0 = e.clientX, w0 = hit.th.getBoundingClientRect().width, key = hit.h.key, sign = dir === "rtl" ? -1 : 1;
    let w = w0;
    const move = (m) => { w = Math.max(48, Math.min(900, w0 + sign * (m.clientX - x0))); setLive({ key, w }); };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      st.current.resizing = false;
      setLive(null);
      setLay((l) => ({ ...l, widths: { ...l.widths, [key]: Math.round(w) } }));
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }
  function onDragStart(e) {
    const hit = headOf(e);
    if (!hit || mode !== "grid") return;
    if (st.current.resizing) { e.preventDefault(); return; }
    e.dataTransfer.setData("text/x-tk-col", hit.h.key);
    e.dataTransfer.effectAllowed = "move";
  }
  function onDragOver(e) {
    const hit = headOf(e);
    if (!hit || ![...e.dataTransfer.types].includes("text/x-tk-col")) return;
    e.preventDefault();
    box.current.querySelectorAll("th.tk-drop").forEach((x) => x !== hit.th && x.classList.remove("tk-drop"));
    hit.th.classList.add("tk-drop");
  }
  function onDrop(e) {
    const hit = headOf(e);
    box.current?.querySelectorAll("th.tk-drop").forEach((x) => x.classList.remove("tk-drop"));
    const from = e.dataTransfer.getData("text/x-tk-col");
    if (!hit || !from || from === hit.h.key) return;
    e.preventDefault();
    moveCol(from, hit.h.key);
  }
  const moveCol = (from, before) => setLay((l) => {
    const keys = fullOrder(heads, l).filter((k) => k !== from);
    const at = keys.indexOf(before);
    keys.splice(at < 0 ? keys.length : at, 0, from);
    return { ...l, order: keys };
  });
  const stepCol = (key, by) => setLay((l) => {
    const keys = fullOrder(heads, l);
    const i = keys.indexOf(key), j = i + by;
    if (i < 0 || j < 0 || j >= keys.length) return l;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    return { ...l, order: keys };
  });
  const toggleIn = (field, key, on) => setLay((l) => {
    const cur = l[field] || [];
    const has = cur.includes(key);
    const want = on === undefined ? !has : on;
    return { ...l, [field]: want ? (has ? cur : [...cur, key]) : cur.filter((k) => k !== key) };
  });

  const valuesOf = (key) => {
    const i = heads.find((h) => h.key === key)?.i;
    if (i === undefined) return [];
    const m = new Map();
    for (const r of st.current.orig) if (!isDetail(r)) { const v = cellOf(r, i); m.set(v, (m.get(v) || 0) + 1); }
    return [...m.entries()].sort((a, b) => compare(a[0], b[0])).slice(0, 400);
  };

  // ── selecting a row: a click or a double click on it, not on what it holds ──
  function pick(e) {
    const tr = e.target.closest("tr");
    if (!tr || !box.current?.contains(tr) || !tr.closest("tbody") || tr.closest("table") !== box.current.querySelector("table")) return;
    if (tr.classList.contains("tk-grp")) {
      const v = tr.dataset.tkGrp;
      setCollapsed((c) => { const n = new Set(c); n.has(v) ? n.delete(v) : n.add(v); return n; });
      return;
    }
    if (tr.classList.contains("tk-edit")) return;
    if (e.target.closest("button, a, input, select, textarea, label, summary, details, [contenteditable]")) return;
    const row = tr;
    if (isDetail(row)) return;                          // an opened panel belongs to its row
    if (e.type === "click" && (e.ctrlKey || e.metaKey || e.shiftKey || (row.cells[0] && inBox(row.cells[0], e.clientX, dir)))) {
      togglePick(row, e.shiftKey);
      return;
    }
    if (rowEdit && e.type === "click" && mayEditRow(row)) { guard(() => openEdit(row)); }
    const cur = st.current.selRow;
    if (cur && cur !== row) delete cur.dataset.tkSel;
    if (cur === row && e.type === "click" && e.detail === 1) { delete row.dataset.tkSel; st.current.selRow = null; setSel(null); return; }
    row.dataset.tkSel = "";
    st.current.selRow = row;
    setSel({ row, key: row.dataset.key || null });
    setErr("");
    if (e.type === "dblclick") setDialog("view");
  }
  // ── several rows: pick, copy, cut, delete, paste ─────────────────────────
  const picksOf = () => { const s = st.current; if (!s.picks) s.picks = new Set(); return s.picks; };
  const mainRows = () => (st.current.orig || []).filter((r) => !isDetail(r) && !r.hidden);
  function togglePick(row, range) {
    const set = picksOf();
    const rows = mainRows();
    const last = st.current.lastPick;
    const span = range && last && rows.includes(last) ? rows.slice(Math.min(rows.indexOf(last), rows.indexOf(row)), Math.max(rows.indexOf(last), rows.indexOf(row)) + 1) : [row];
    const on = !set.has(row);
    for (const r of span) { if (on) set.add(r); else set.delete(r); flag(r, "tkPick", on); }
    st.current.lastPick = row;
    setPicks(set.size);
  }
  function pickAll() {
    const set = picksOf();
    const rows = mainRows();
    const on = !(rows.length && rows.every((r) => set.has(r)));
    for (const r of rows) { if (on) set.add(r); else set.delete(r); flag(r, "tkPick", on); }
    flag(box.current?.querySelector("thead tr") || document.createElement("tr"), "tkPickAll", on);
    setPicks(set.size);
  }
  function clearPicks() {
    for (const r of picksOf()) flag(r, "tkPick", false);
    picksOf().clear();
    const hr = box.current?.querySelector("thead tr"); if (hr) flag(hr, "tkPickAll", false);
    setPicks(0);
  }
  const rowsText = (rows) => rows.map((r) => [...r.cells].map((c) => c.textContent.replace(/\s+/g, " ").trim()));
  function copyRows(rows) {
    const data = rowsText(rows);
    setClip(data);
    try { navigator.clipboard?.writeText(data.map((x) => x.join("\t")).join("\n")); } catch { /* not allowed here */ }
  }
  async function deleteRows(rows, ask = true) {
    const keyed = rows.filter((r) => r.dataset.key);
    if (!onDelete || !keyed.length) return false;
    const refused = keyed.map((r) => [r, canDelete ? canDelete(r.dataset.key) : true]).filter(([, v]) => !(v === true || v === undefined || v === null));
    if (refused.length) { setErr(`${deleteLabel}: ${String(refused[0][1] || t("tk.notOpen"))}`); return false; }
    if (ask && !window.confirm(t("tk.deleteMany", { n: num(keyed.length) }))) return false;
    setBusy(true); setErr("");
    try { for (const r of keyed) { if (await onDelete(r.dataset.key) === false) throw new Error(t("tk.deleteFailed")); } clearPicks(); return true; }
    catch (e) { setErr(e?.message || t("tk.deleteError")); return false; }
    finally { setBusy(false); }
  }
  const cutRows = async (rows) => { copyRows(rows); await deleteRows(rows); };
  const picked = () => [...picksOf()].filter((r) => box.current?.contains(r));

  // ── editing a row where it stands ───────────────────────────────────────
  const edDirty = !!ed && JSON.stringify(ed.values) !== JSON.stringify(ed.orig);
  const guard = (next) => (edDirty ? setLeave({ next }) : next());
  function closeEdit() {
    const s = st.current;
    if (s.editFor) flag(s.editFor, "tkEditing", false);
    s.editTr?.remove();
    s.editTr = null; s.editFor = null;
    setEd(null);
  }
  // a row a page says is not open for editing (signed, evidence, no right) only selects
  const mayEditRow = (row) => { const k = row?.dataset.key; return !!k && (!canEdit || canEdit(k) === true); };
  function openEdit(row) {
    closeEdit();
    const key = row ? row.dataset.key : null;
    if (row && !key) return;
    const tr = document.createElement("tr");
    tr.className = "tk-edit";
    const s = st.current;
    s.editTr = tr; s.editFor = row || null;
    if (row) { flag(row, "tkEditing", true); row.after(tr); } else box.current?.querySelector("tbody")?.appendChild(tr);
    const v = row ? (rowEdit.value ? rowEdit.value(key) : {}) : Object.fromEntries(rowEdit.fields.map((f) => [f.name, ""]));
    setEd({ row, key, values: v || {}, orig: v || {}, tr });
  }
  async function saveEdit() {
    if (!ed) return true;
    setBusy(true); setErr("");
    try {
      const ok = ed.row ? await rowEdit.onSave(ed.key, ed.values) : await rowEdit.onAdd(ed.values);
      if (ok) { closeEdit(); return true; }
      return false;
    } catch (e) { setErr(e?.message || t("tk.saveError")); return false; }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!rowMenu) return undefined;
    const close = () => setRowMenu(null);
    window.addEventListener("click", close); window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); };
  }, [rowMenu]);
  // a click outside the row being edited, when it has changed, asks first
  useEffect(() => {
    if (!ed) return undefined;
    const away = (e) => {
      if (!edDirty || e.target.closest?.(".tk-edit, .tk-leave, .tk-rowmenu")) return;
      if (box.current?.contains(e.target) && e.target.closest("tbody tr")) return;   // another row: the row click asks
      e.preventDefault(); e.stopPropagation();
      setLeave({ next: () => {} });
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [ed, edDirty]);

  useEffect(() => {
    // A row React replaced takes the selection with it.
    if (!sel && st.current.selRow) { delete st.current.selRow.dataset.tkSel; st.current.selRow = null; }
  }, [sel]);

  const gate = (fn, key) => {
    if (!sel) return t("tk.pickFirst");
    if (!key) return t("tk.noKey");
    if (!fn) return true;
    const r = fn(key);
    return r === true || r === undefined || r === null ? true : String(r || t("tk.notOpen"));
  };
  const editGate = onEdit ? gate(canEdit, sel?.key) : null;
  const delGate = onDelete ? gate(canDelete, sel?.key) : null;

  async function openDelete() {
    setErr(""); setDialog("delete");
    if (!checkDelete) { setProbe(true); return; }
    setProbe("…");
    try { setProbe(await checkDelete(sel.key)); } catch (e) { setProbe(e?.message || t("tk.notChecked")); }
  }

  async function doDelete() {
    if (delGate !== true || probe !== true) return;
    setBusy(true); setErr("");
    try {
      const ok = await onDelete(sel.key);
      if (ok === false) setErr(t("tk.deleteFailed"));
      else { setDialog(null); setSel(null); }
    } catch (e) { setErr(e?.message || t("tk.deleteError")); }
    setBusy(false);
  }

  // ── export: the filtered rows (every page), the columns as shown ────────
  function exportRows() {
    const table = box.current?.querySelector("table");
    if (!table) return null;
    const cols = rich ? disp.map((k) => heads.find((h) => h.key === k)).filter(Boolean) : heads;
    const rows = [];
    for (const r of table.tBodies[0]?.rows || []) {
      if (r.hidden || r.classList.contains("tk-grp") || isDetail(r)) continue;
      rows.push(cols.map((h) => (r.cells[h.i]?.textContent || "").replace(/\s+/g, " ").trim()));
    }
    return { head: cols.map((h) => h.label), rows };
  }
  const stamp = () => `${name}-${new Date().toISOString().slice(0, 10)}`;
  function exportCsv() {
    const x = exportRows();
    if (!x) return;
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [x.head.map(esc).join(","), ...x.rows.map((r) => r.map(esc).join(","))];
    // BOM: Excel opens UTF-8 Persian correctly only with it.
    download(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `${stamp()}.csv`);
  }
  async function exportXlsx() {
    const x = exportRows();
    if (!x) return;
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([x.head, ...x.rows.map((r) => r.map(asCell))]);
    ws["!cols"] = x.head.map((h, k) => ({ wch: Math.min(50, Math.max(6, ...[h, ...x.rows.slice(0, 300).map((r) => r[k])].map((v) => String(v).length + 2))) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet1");
    if (dir === "rtl") wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.writeFile(wb, `${stamp()}.xlsx`);
  }

  const anyFilter = Object.values(filters).some(active);
  const filtering = q || (col !== "" && val !== "") || (lay.sort || []).length || anyFilter;
  const clearAll = () => { setQ(""); setCol(""); setVal(""); setFilters({}); setLay((l) => ({ ...l, sort: [] })); };
  // A table with row actions always shows its bar: the actions live there.
  const showBar = meta.total >= min || (meta.total > 0 && !!(onEdit || onDelete)) || filtering;
  const cells = sel ? [...sel.row.cells].map((c, i) => [heads[i]?.label || "", c.textContent.replace(/\s+/g, " ").trim()]).filter(([h, v]) => h || v) : [];
  const title = cells.find(([, v]) => v)?.[1] || t("tk.row");
  const css = useMemo(() => layoutCss(`.tk[data-tk-id="${uid}"]`, mode, heads, disp, lay, pinOff, live), [uid, mode, heads, disp, lay, pinOff, live]);
  const MODES = [["table", "☰"], ["grid", "▦"], ["cards", "▣"]];
  return (
    <div className="tk" data-tk-id={uid} data-tk-mode={mode}>
      {css && <style>{css}</style>}
      {showBar && (
        <div className="tk-bar no-print">
          <input className="tk-q" type="search" placeholder={t("tk.search")} aria-label={t("tk.search")}
                 value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label={t("tk.colFilter")} value={col} onChange={(e) => { setCol(e.target.value); setVal(""); }}>
            <option value="">{t("tk.colFilterPick")}</option>
            {heads.map((h) => h.label && <option key={h.i} value={h.i}>{h.label}</option>)}
          </select>
          {col !== "" && (
            <select aria-label={t("tk.filterValue")} value={val} onChange={(e) => setVal(e.target.value)}>
              <option value="">{t("tk.filterAll")}</option>
              {meta.values.map((v) => <option key={v} value={v}>{v.length > 40 ? v.slice(0, 40) + "…" : v}</option>)}
            </select>
          )}
          <span className="tk-n">{meta.shown === meta.total ? t("tk.rows", { n: num(meta.total) }) : t("tk.rowsOf", { shown: num(meta.shown), total: num(meta.total) })}</span>
          {filtering && <button type="button" onClick={clearAll}>{t("tk.clear")}</button>}
          <span className="tk-modes" role="radiogroup" aria-label={t("tk.mode")}>
            {MODES.map(([m, ic]) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} data-mode={m}
                      title={t(`tk.mode.${m}`)} onClick={() => setLay((l) => ({ ...l, mode: m }))}><span aria-hidden>{ic}</span> {t(`tk.mode.${m}`)}</button>
            ))}
          </span>
          {rich && (
            <>
              <button type="button" className="tk-cols" aria-haspopup="dialog" onClick={(e) => setChooser({ rect: e.currentTarget.getBoundingClientRect() })}>⚙ {t("tk.columns")}</button>
              <select aria-label={t("tk.groupBy")} value={lay.group || ""} onChange={(e) => { setCollapsed(new Set()); setLay((l) => ({ ...l, group: e.target.value || null })); }}>
                <option value="">{t("tk.noGroup")}</option>
                {heads.map((h) => h.label && <option key={h.key} value={h.key}>{t("tk.groupBy")}: {h.label}</option>)}
              </select>
              <select aria-label={t("tk.perPage")} value={lay.size || 0} onChange={(e) => setLay((l) => ({ ...l, size: Number(e.target.value) }))}>
                {[0, 25, 50, 100, 250].map((n) => <option key={n} value={n}>{t("tk.perPage")}: {n ? num(n) : t("tk.allRows")}</option>)}
              </select>
            </>
          )}
          <button type="button" onClick={exportCsv} title={t("tk.exportTitle")}>{t("tk.exportCsv")}</button>
          <button type="button" onClick={exportXlsx} title={t("tk.exportTitle")}>{t("tk.exportXlsx")}</button>
          {picks > 0 && (
            <span className="tk-bulk" data-tk-bulk>
              <b>{t("tk.picked", { n: num(picks) })}</b>
              <button type="button" onClick={() => copyRows(picked())}>{t("tk.copy")}</button>
              {onDelete && <button type="button" onClick={() => cutRows(picked())}>{t("tk.cut")}</button>}
              {onDelete && <button type="button" className="danger" data-tk-bulk-delete disabled={busy} onClick={() => deleteRows(picked())}>{deleteLabel}</button>}
              <button type="button" onClick={clearPicks}>{t("tk.unpick")}</button>
            </span>)}
          {onPaste && clip && <button type="button" data-tk-paste onClick={async () => { if (await onPaste(clip)) setClip(null); }}>{t("tk.paste", { n: num(clip.length) })}</button>}
          <span className="tk-acts">
            <button type="button" disabled={!sel} onClick={() => setDialog("view")}
                    title={sel ? t("tk.viewTitle") : t("tk.pickFirst")}>{t("tk.view")}</button>
            {onEdit && <button type="button" disabled={editGate !== true} title={editGate === true ? undefined : editGate}
                               onClick={() => editGate === true && onEdit(sel.key)}>{editLabel}</button>}
            {onDelete && <button type="button" className="danger" disabled={delGate !== true} title={delGate === true ? undefined : delGate}
                                 onClick={() => openDelete()}>{deleteLabel}</button>}
          </span>
        </div>
      )}
      {sel && (editGate && editGate !== true || delGate && delGate !== true) && (
        <p className="muted sm tk-why no-print">{[editGate !== true && editGate && `${editLabel}: ${editGate}`, delGate !== true && delGate && `${deleteLabel}: ${delGate}`].filter(Boolean).join(" · ")}</p>
      )}
      {showBar && meta.total > 0 && meta.shown === 0 && <p className="empty-note">{t("tk.noMatch")}</p>}
      <div className="wrap" ref={box} onClick={(e) => { onHeadClick(e); pick(e); }} onDoubleClick={pick} onContextMenu={onContext}
           onPointerDown={onDown} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}
           onDragEnd={() => box.current?.querySelectorAll("th.tk-drop").forEach((x) => x.classList.remove("tk-drop"))}>{children}</div>
      {rowEdit?.onAdd && !(ed && !ed.row) && (
        <button type="button" className="tk-add no-print" data-tk-add onClick={() => guard(() => openEdit(null))}>{t("tk.addRow")}</button>)}
      {err && !dialog && <p className="err sm no-print" role="alert">{err}</p>}
      {ed && createPortal(heads.map((h, k) => {
        const f = rowEdit.fields.find((x) => x.col === h.key || x.col === h.label);
        const last = k === heads.length - 1;
        const set = (v) => setEd((x) => ({ ...x, values: { ...x.values, [f.name]: v } }));
        return (
          <td key={h.key}>
            {f ? (f.type === "select"
              ? <select aria-label={h.label} value={ed.values[f.name] ?? ""} onChange={(e) => set(e.target.value)}>
                  <option value="">—</option>{(f.options || []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              : <input aria-label={h.label} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} step="any"
                  dir={f.type === "text" ? "auto" : "ltr"} value={ed.values[f.name] ?? ""} onChange={(e) => set(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") closeEdit(); }} />)
              : ed.row ? <span className="tk-ed-ro">{ed.row.cells[h.i]?.textContent || ""}</span> : null}
            {last && (
              <span className="tk-ed-btns">
                <button type="button" className="btn sm" data-tk-save disabled={busy} onClick={saveEdit}>{t("common.save")}</button>
                <button type="button" className="btn ghost sm" onClick={closeEdit}>{t("common.cancel")}</button>
                {ed.row && onDelete && <button type="button" className="btn ghost sm danger" onClick={async () => { if (await deleteRows([ed.row])) closeEdit(); }}>{deleteLabel}</button>}
              </span>)}
          </td>);
      }), ed.tr)}
      {leave && createPortal(
        <div className="tk-leave card" role="alertdialog" aria-label={t("tk.leaveTitle")} data-tk-leave>
          <b>{t("tk.leaveTitle")}</b>
          <p style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button type="button" className="btn sm" onClick={async () => { const nx = leave.next; setLeave(null); if (await saveEdit()) nx(); }}>{t("tk.leaveSave")}</button>
            <button type="button" className="btn ghost sm" onClick={() => { const nx = leave.next; setLeave(null); closeEdit(); nx(); }}>{t("tk.leaveDrop")}</button></p>
        </div>, document.body)}
      {rowMenu && createPortal(
        <div className="tk-rowmenu card" role="menu" aria-label={t("tk.rowMenu")} style={{ left: rowMenu.x, top: rowMenu.y }} onClick={(e) => e.stopPropagation()} data-tk-rowmenu>
          {(() => {
            const r = rowMenu.row, k = r.dataset.key || null;
            const many = picksOf().has(r) ? picked() : [r];
            const done = () => setRowMenu(null);
            return <>
              <button type="button" role="menuitem" onClick={() => { done(); pick({ target: r.cells[0] || r, type: "dblclick" }); }}>{t("tk.view")}</button>
              {rowEdit && k && mayEditRow(r) && <button type="button" role="menuitem" onClick={() => { done(); guard(() => openEdit(r)); }}>{t("tk.edit")}</button>}
              {!rowEdit && onEdit && k && <button type="button" role="menuitem" onClick={() => { done(); onEdit(k); }}>{editLabel}</button>}
              {rowEdit?.onAdd && <button type="button" role="menuitem" onClick={() => { done(); guard(() => openEdit(null)); }}>{t("tk.add")}</button>}
              <button type="button" role="menuitem" onClick={() => { done(); copyRows(many); }}>{t("tk.copy")}</button>
              {onDelete && <button type="button" role="menuitem" onClick={() => { done(); cutRows(many); }}>{t("tk.cut")}</button>}
              {onPaste && <button type="button" role="menuitem" disabled={!clip} onClick={async () => { done(); if (await onPaste(clip)) setClip(null); }}>{t("tk.pasteShort")}</button>}
              {onDelete && <button type="button" role="menuitem" className="danger" onClick={() => { done(); deleteRows(many); }}>{deleteLabel}</button>}
            </>;
          })()}
        </div>, document.body)}
      {rich && meta.pages > 1 && (
        <div className="tk-pager no-print">
          <button type="button" disabled={meta.pg === 0} onClick={() => setPage(meta.pg - 1)}>{t("tk.prev")}</button>
          <span>{t("tk.page", { p: num(meta.pg + 1), n: num(meta.pages) })}</span>
          <button type="button" disabled={meta.pg >= meta.pages - 1} onClick={() => setPage(meta.pg + 1)}>{t("tk.next")}</button>
        </div>
      )}
      {menu && createPortal(
        <ColumnMenu h={heads.find((x) => x.key === menu.key)} rect={menu.rect} dir={dir} t={t} num={num} lay={lay}
                    filter={filters[menu.key] || {}} values={valuesOf(menu.key)}
                    onClose={() => setMenu(null)}
                    onSort={(d) => sortBy(menu.key, d, false)}
                    onFilter={(f) => setFilters((all) => ({ ...all, [menu.key]: f }))}
                    onAgg={(f) => setLay((l) => ({ ...l, aggs: { ...l.aggs, [menu.key]: f } }))}
                    onPin={() => toggleIn("pinned", menu.key)}
                    onHide={() => { toggleIn("hidden", menu.key, true); setMenu(null); }}
                    onGroup={() => { setCollapsed(new Set()); setLay((l) => ({ ...l, group: l.group === menu.key ? null : menu.key })); setMenu(null); }} />,
        document.body)}
      {chooser && createPortal(
        <Chooser rect={chooser.rect} dir={dir} t={t} heads={heads} order={fullOrder(heads, lay)} lay={lay}
                 onClose={() => setChooser(null)}
                 onShow={(k, on) => toggleIn("hidden", k, !on)}
                 onPin={(k) => toggleIn("pinned", k)}
                 onStep={stepCol}
                 onShowAll={() => setLay((l) => ({ ...l, hidden: [] }))}
                 onReset={() => { resetLay(); setFilters({}); setCollapsed(new Set()); setChooser(null); }} />,
        document.body)}
      {dialog && sel && createPortal(
        <div className="tk-view" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setDialog(null); }}
             onKeyDown={(e) => { if (e.key === "Escape") setDialog(null); }}>
          <div role="dialog" aria-modal="true" aria-label={dialog === "delete" ? `${deleteLabel} ${title}` : title}>
            <header><b>{dialog === "delete" ? t("tk.deleteQ", { label: deleteLabel }) : t("tk.view")}</b><span className="muted sm">{title}</span>
              <button type="button" autoFocus onClick={() => setDialog(null)}>✕ {t("common.close")}</button></header>
            <dl>{cells.map(([h, v], i) => <FragmentPair key={i} h={h} v={v} />)}</dl>
            {dialog === "view" && view && sel.key && <div className="tk-extra">{view(sel.key)}</div>}
            {dialog === "delete" && (
              <div className="tk-extra">
                {probe === "…" ? <p className="muted">{t("tk.checking")}</p>
                  : probe === true ? <p>{t("tk.deleteSure")}</p>
                  : <p className="err tk-blocked">{probe}</p>}
                {err && <p className="err">{err}</p>}
                <div style={{ display: "flex", gap: 8 }}>
                  {probe === true && <button type="button" className="btn danger" disabled={busy || delGate !== true} onClick={doDelete}>{busy ? "…" : t("tk.deleteFinal", { label: deleteLabel })}</button>}
                  <button type="button" className="btn ghost" onClick={() => setDialog(null)}>{t("common.cancel")}</button>
                </div>
              </div>
            )}
          </div>
        </div>, document.body)}
    </div>
  );
}

function FragmentPair({ h, v }) {
  return <><dt>{h || "—"}</dt><dd>{v || <span className="muted">—</span>}</dd></>;
}

/** A popover beside a heading or a button, kept inside the window, closed by Escape or a click elsewhere. */
function Pop({ rect, dir, width = 280, onClose, label, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === "Escape") onClose(); };
    const t = setTimeout(() => document.addEventListener("pointerdown", down), 0);
    document.addEventListener("keydown", key);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [onClose]);
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const left = Math.max(8, Math.min(vw - width - 8, dir === "rtl" ? rect.left : rect.right - width));
  return (
    <div ref={ref} className="tk-pop" role="dialog" aria-label={label} dir={dir}
         style={{ left, top: Math.min(rect.bottom + 4, (typeof window === "undefined" ? 800 : window.innerHeight) - 120), width }}>
      {children}
    </div>
  );
}

function ColumnMenu({ h, rect, dir, t, num, lay, filter, values, onClose, onSort, onFilter, onAgg, onPin, onHide, onGroup }) {
  const [find, setFind] = useState("");
  if (!h) return null;
  const s = (lay.sort || []).find((x) => x.k === h.key);
  const allowed = filter.vals ? new Set(filter.vals) : null;
  const shownValues = find ? values.filter(([v]) => norm(v).includes(norm(find))) : values;
  const setVals = (next) => onFilter({ ...filter, vals: next && next.length === values.length ? undefined : next });
  return (
    <Pop rect={rect} dir={dir} width={300} onClose={onClose} label={t("tk.colMenu", { name: h.label })}>
      <div className="tk-pop-h">{h.label}</div>
      <div className="tk-pop-row">
        <button type="button" className={s?.dir === 1 ? "on" : ""} onClick={() => onSort(1)}>▲ {t("tk.sortAsc")}</button>
        <button type="button" className={s?.dir === -1 ? "on" : ""} onClick={() => onSort(-1)}>▼ {t("tk.sortDesc")}</button>
        {s && <button type="button" onClick={() => onSort(0)}>{t("tk.unsort")}</button>}
      </div>
      <p className="tk-pop-hint">{t("tk.sortAdd")}</p>
      <fieldset>
        <legend>{t("tk.filter")}</legend>
        <input type="search" placeholder={t("tk.filterText")} aria-label={t("tk.filterText")} value={filter.text || ""}
               onChange={(e) => onFilter({ ...filter, text: e.target.value })} />
        <div className="tk-pop-row">
          <input placeholder={t("tk.filterFrom")} aria-label={t("tk.filterFrom")} value={filter.from || ""} onChange={(e) => onFilter({ ...filter, from: e.target.value })} />
          <input placeholder={t("tk.filterTo")} aria-label={t("tk.filterTo")} value={filter.to || ""} onChange={(e) => onFilter({ ...filter, to: e.target.value })} />
        </div>
        <div className="tk-pop-row tk-pop-vals-h">
          <span>{t("tk.filterValues")}</span>
          <button type="button" onClick={() => setVals(undefined)}>{t("tk.filterAll")}</button>
          <button type="button" onClick={() => setVals([])}>{t("tk.filterNone")}</button>
        </div>
        {values.length > 8 && <input type="search" placeholder="…" aria-label={t("tk.filterValues")} value={find} onChange={(e) => setFind(e.target.value)} />}
        <div className="tk-pop-vals">
          {shownValues.map(([v, n]) => (
            <label key={v}>
              <input type="checkbox" checked={!allowed || allowed.has(v)}
                     onChange={(e) => {
                       const cur = allowed ? [...allowed] : values.map(([x]) => x);
                       setVals(e.target.checked ? [...new Set([...cur, v])] : cur.filter((x) => x !== v));
                     }} />
              <span className="v">{v || t("tk.empty")}</span><span className="n">{num(n)}</span>
            </label>
          ))}
        </div>
        {active(filter) && <button type="button" onClick={() => onFilter({})}>{t("tk.filterClear")}</button>}
      </fieldset>
      <label className="tk-pop-agg">{t("tk.agg")}
        <select value={lay.aggs?.[h.key] || "none"} onChange={(e) => onAgg(e.target.value)}>
          {["none", "sum", "avg", "min", "max", "count"].map((f) => <option key={f} value={f}>{t(`tk.agg.${f}`)}</option>)}
        </select>
      </label>
      <div className="tk-pop-row">
        <button type="button" onClick={onPin}>📌 {(lay.pinned || []).includes(h.key) ? t("tk.unpin") : t("tk.pin")}</button>
        <button type="button" onClick={onGroup}>{lay.group === h.key ? t("tk.noGroup") : t("tk.groupHere")}</button>
        <button type="button" onClick={onHide}>{t("tk.hide")}</button>
      </div>
    </Pop>
  );
}

function Chooser({ rect, dir, t, heads, order, lay, onClose, onShow, onPin, onStep, onShowAll, onReset }) {
  const byKey = new Map(heads.map((h) => [h.key, h]));
  const hidden = new Set(lay.hidden || []);
  const pinned = new Set(lay.pinned || []);
  return (
    <Pop rect={rect} dir={dir} width={320} onClose={onClose} label={t("tk.columns")}>
      <div className="tk-pop-h">{t("tk.columns")}</div>
      <p className="tk-pop-hint">{t("tk.dragHint")}</p>
      <ol className="tk-chooser">
        {order.map((k, n) => {
          const h = byKey.get(k);
          if (!h) return null;
          return (
            <li key={k}>
              <label><input type="checkbox" checked={!hidden.has(k)} onChange={(e) => onShow(k, e.target.checked)} /> {h.label || `#${h.i + 1}`}</label>
              <button type="button" className={pinned.has(k) ? "on" : ""} title={pinned.has(k) ? t("tk.unpin") : t("tk.pin")} aria-pressed={pinned.has(k)} onClick={() => onPin(k)}>📌</button>
              <button type="button" title={t("tk.moveUp")} aria-label={`${t("tk.moveUp")}: ${h.label}`} disabled={n === 0} onClick={() => onStep(k, -1)}>↑</button>
              <button type="button" title={t("tk.moveDown")} aria-label={`${t("tk.moveDown")}: ${h.label}`} disabled={n === order.length - 1} onClick={() => onStep(k, 1)}>↓</button>
            </li>
          );
        })}
      </ol>
      <div className="tk-pop-row">
        <button type="button" onClick={onShowAll}>{t("tk.showAll")}</button>
        <button type="button" title={t("tk.resetTitle")} onClick={onReset}>↺ {t("tk.reset")}</button>
      </div>
    </Pop>
  );
}

// ── the layout a table remembers ─────────────────────────────────────────
const EMPTY = { mode: null, hidden: [], order: [], widths: {}, pinned: [], group: null, aggs: {}, size: 0, sort: [] };
function useLayout(name) {
  const key = `epc.tk.${name}`;
  const [lay, setRaw] = useState(EMPTY);
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(key) || "null"); if (v && typeof v === "object") setRaw({ ...EMPTY, ...v }); } catch { /* private mode */ }
  }, [key]);
  const setLay = useCallback((fn) => setRaw((cur) => {
    const next = typeof fn === "function" ? fn(cur) : { ...cur, ...fn };
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  }), [key]);
  const reset = useCallback(() => setRaw((cur) => {
    const next = { ...EMPTY, mode: cur.mode };
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  }), [key]);
  return [lay, setLay, reset];
}

/** Every column in the order the person set (new columns at the end). */
function fullOrder(heads, lay) {
  const all = heads.map((h) => h.key);
  const known = new Set(all);
  const set = (lay.order || []).filter((k) => known.has(k));
  return [...set, ...all.filter((k) => !set.includes(k))];
}
/** The columns shown, in their order: pinned ones first. */
function displayOrder(heads, lay) {
  const hidden = new Set(lay.hidden || []);
  const pinned = new Set(lay.pinned || []);
  const o = fullOrder(heads, lay).filter((k) => !hidden.has(k));
  return [...o.filter((k) => pinned.has(k)), ...o.filter((k) => !pinned.has(k))];
}

/** This table's columns as CSS: each one's place and visibility, and in the grid its width and pin. */
function layoutCss(sel, mode, heads, disp, lay, pinOff, live) {
  if (mode === "table" || !heads.length) return "";
  const pos = new Map(disp.map((k, n) => [k, n]));
  const nth = (h, part = "") => `${sel} .dtable ${part}tr > :nth-child(${h.i + 1})`;
  const out = [];
  for (const h of heads) out.push(pos.has(h.key) ? `${nth(h)}{order:${pos.get(h.key)}}` : `${nth(h)}{display:none}`);
  const byKey = new Map(heads.map((h) => [h.key, h]));
  if (mode === "grid") {
    const w = (k) => { const v = live?.key === k ? live.w : lay.widths?.[k]; return v ? `${Math.round(v)}px` : "fit-content(340px)"; };
    out.push(`${sel} .dtable{grid-template-columns:${disp.map(w).join(" ")} minmax(0,1fr)}`);
    const pins = disp.filter((k) => (lay.pinned || []).includes(k) && pinOff[k] !== undefined);
    for (const k of pins) {
      const h = byKey.get(k);
      out.push(`${nth(h)}{position:sticky;inset-inline-start:${pinOff[k]}px;z-index:2}`);
      out.push(`${nth(h, "thead ")}{z-index:5}`);
    }
    if (pins.length) out.push(`${nth(byKey.get(pins[pins.length - 1]))}{box-shadow:var(--pin-edge)}`);
  }
  if (mode === "cards" && disp.length) {
    const h = byKey.get(disp[0]);
    out.push(`${sel} .dtable tbody tr:not(.tk-grp):not([data-tk-detail]) > :nth-child(${h.i + 1}){grid-template-columns:1fr;font-weight:600;font-size:13.5px;padding-bottom:6px;margin-bottom:4px;border-bottom:1px solid var(--rule-soft)}`);
    out.push(`${sel} .dtable tbody tr:not(.tk-grp):not([data-tk-detail]) > :nth-child(${h.i + 1})::before{display:none}`);
  }
  return out.join("\n");
}

/** Fold React's own insertions and removals into the order it believes in. */
function absorb(s, records) {
  for (const rec of records) {
    if (rec.type !== "childList" || rec.target !== s.tbody) continue;
    for (const n of rec.removedNodes) s.orig = s.orig.filter((r) => r !== n);
    const added = [...rec.addedNodes].filter((n) => n.nodeName === "TR" && own(n));
    if (!added.length) continue;
    const at = rec.nextSibling ? s.orig.indexOf(rec.nextSibling) : -1;
    for (const n of added) s.orig = s.orig.filter((r) => r !== n);
    if (at < 0) s.orig.push(...added);
    else s.orig.splice(s.orig.indexOf(rec.nextSibling), 0, ...added);
  }
}

/** A group's heading row: this kit's own, one cell per column so it lines up with the grid. */
function groupRow(s, v, n) {
  let tr = s.grp.get(v);
  if (!tr || tr.cells.length !== n) {
    tr?.remove();
    tr = document.createElement("tr");
    tr.className = "tk-grp";
    tr.dataset.tkGrp = v;
    for (let k = 0; k < n; k++) tr.appendChild(document.createElement("td"));
    s.grp.set(v, tr);
  }
  return tr;
}
/** The totals footer: this kit's own <tfoot>, one cell per column. */
function footRow(s, table, n) {
  if (!s.foot || s.foot.rows[0]?.cells.length !== n || s.foot.parentNode !== table) {
    s.foot?.remove();
    const f = document.createElement("tfoot");
    f.className = "tk-foot";
    const tr = f.appendChild(document.createElement("tr"));
    for (let k = 0; k < n; k++) tr.appendChild(document.createElement("td"));
    table.appendChild(f);
    s.foot = f;
  }
  return s.foot;
}

const own = (r) => !r.classList?.contains("tk-grp") && !r.classList?.contains("tk-edit");
// the box drawn at the start of a row's first cell: a click within this many pixels of the cell's start picks the row
const BOX = 24;
const inBox = (cell, x, dir) => { const r = cell.getBoundingClientRect(); return dir === "rtl" ? r.right - x <= BOX : x - r.left <= BOX; };
const isDetail = (r) => r.cells.length === 1 && r.cells[0].colSpan > 1;
const cellOf = (r, i) => (r.cells[i]?.textContent || "").replace(/\s+/g, " ").trim();
const flag = (el, k, on) => { if (on) { if (!(k in el.dataset)) el.dataset[k] = ""; } else if (k in el.dataset) delete el.dataset[k]; };
const DIGITS = { "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",   // i18n: letters and digits the search and sort normalise, not text shown
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };   // i18n: letters and digits the search and sort normalise, not text shown
const latin = (t) => String(t).replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d]);   // i18n: letters and digits the search and sort normalise, not text shown
function norm(t) {
  return latin(t).replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[‌‏‎]/g, "").replace(/\s+/g, " ").toLowerCase().trim();   // i18n: letters and digits the search and sort normalise, not text shown
}
const isBlank = (t) => /^[—–\-]?$/.test(String(t).trim());
function compare(a, b) {
  // "—" and "-" are how the pages print "nothing": they sort with the empties, last.
  const blank = (t) => (isBlank(t) ? "" : t);
  const x = blank(latin(a).replace(/[,٬]/g, "")), y = blank(latin(b).replace(/[,٬]/g, ""));   // i18n: letters and digits the search and sort normalise, not text shown
  const nx = /^-?\d+(\.\d+)?%?$/.test(x.trim()) ? parseFloat(x) : NaN;
  const ny = /^-?\d+(\.\d+)?%?$/.test(y.trim()) ? parseFloat(y) : NaN;
  if (Number.isFinite(nx) && Number.isFinite(ny)) return nx - ny;
  if (!x && y) return 1;
  if (x && !y) return -1;
  return x.localeCompare(y, "fa", { numeric: true });
}
/** A cell as a number, when it is one ("1,234.5", "۱۲٫۵", "40%"); otherwise NaN. */
function toNum(v) {
  const x = latin(v).replace(/٫/g, ".").replace(/[,٬\s]/g, "").replace(/%$/, "");   // i18n: letters and digits the search and sort normalise, not text shown
  return /^-?\d+(\.\d+)?$/.test(x) ? parseFloat(x) : NaN;
}
const active = (f) => !!f && (f.vals !== undefined || !!f.text || !!f.from || !!f.to);
function passes(v, f) {
  if (f.vals && !f.vals.includes(v)) return false;
  if (f.text && !norm(v).includes(norm(f.text))) return false;
  if ((f.from || f.to) && isBlank(v)) return false;
  if (f.from && compare(v, f.from) < 0) return false;
  if (f.to && compare(v, f.to) > 0) return false;
  return true;
}
function aggregate(cells, f, fmt) {
  if (f === "count") return fmt(cells.filter((v) => !isBlank(v)).length);
  const ns = cells.map(toNum).filter(Number.isFinite);
  if (!ns.length) return "—";
  const sum = ns.reduce((a, b) => a + b, 0);
  const v = f === "sum" ? sum : f === "avg" ? sum / ns.length : f === "min" ? Math.min(...ns) : f === "max" ? Math.max(...ns) : NaN;
  return Number.isFinite(v) ? fmt(Math.round(v * 100) / 100) : "";
}
/** A cell for Excel: a number stays a number, unless it is a code with leading zeros. */
function asCell(v) {
  const n = toNum(v);
  return Number.isFinite(n) && !/^0\d/.test(latin(v).trim()) ? n : v;
}
function download(blob, file) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
